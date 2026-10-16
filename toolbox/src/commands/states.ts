import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { call } from "../browser/call.ts";
import { confirmLogin, firstLineOf, INPAGE_PATH, launchBrowser, loadPage, loadSampled, newContext, retryOnce, settlePage, type WriteGuard } from "../browser/session.ts";
import { isLogout, LoginExpired, runLoginMark, throwIfLoginExpired } from "../lib/login.ts";
import { canonicalJson, sha256, slugForUrl, writeJson } from "../lib/canonical.ts";
import { measuredPages, pageKey, readStamp, STATES_STAMP } from "../lib/sweepstamp.ts";
import { inOrder, Slots, sweepAtOnce, Turns, withSpacing } from "../lib/atonce.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { loadRun, type FormErrorState, type PageData, type States } from "../lib/rundata.ts";
import type { Described } from "../instruments/activate.ts";
import { DESKTOP, probeTrigger } from "../instruments/dialog.ts";
import { probeForms } from "../instruments/forms.ts";
import { probeHoverTarget } from "../instruments/hover.ts";
import { browserListeners, firstKeyReaction, KEYS, leaveTextEntry, probeArrowFocus } from "../instruments/keys.ts";
import { progressLine, sayingItRuns, STILL_RUNNING_MS, withinTime as limited } from "../instruments/limit.ts";
import { DELEGATING, DOWN_EVENTS, downEventTargets, downKind, probeDownEvent, type DownTarget } from "../instruments/pointer.ts";
import { probeSettings } from "../instruments/settings.ts";
import { holds } from "../session/recipe.ts";
import { ModelSweep, type StateOpener } from "./modelsweep.ts";

/** Where the probes reached each embedded window of the sample: on the page it stands on, or on its own and why. */
type Embedded = NonNullable<States["embedded"]>[number];

/**
 * One group of probes that runs on its own: its own guard, so that nothing a probe submits reaches a
 * server while another group loads a page, its own copy of the sweep for the blockers it closes, and
 * what it skipped and where it reached each embedded window. The groups are taken together in a fixed
 * order, so what is written does not depend on whether they ran one after the other or at the same time.
 */
interface Lane {
  guard: WriteGuard;
  /** Set when the run has a site model: closes what covers a page before a probe acts on it. */
  sweep: ModelSweep | null;
  skipped: { page: string; step: string }[];
  windows: Map<string, Embedded>;
}

/** The group of the whole command, and of every probe that runs outside a group. */
const mainLane: Lane = { guard: { active: false, blocked: 0 }, sweep: null, skipped: [], windows: new Map() };
const lanes = new AsyncLocalStorage<Lane>();
const lane = (): Lane => lanes.getStore() ?? mainLane;
const socketMessagesBlocked = (): number => lane().guard.blocked;

/** A browser context in the group that runs now, in the default window or in another size. */
type OpenContext = (viewport?: { width: number; height: number }) => Promise<BrowserContext>;

/**
 * The browsers all groups of probes share, and how many pages one group goes over at the same time.
 * A piece of work that has a browser open holds a slot; together they never hold more than `atOnce`.
 */
let budget = { atOnce: 1, slots: new Slots(1) };

/** A lane of its own for work next to other work of the same group: a fork of the group's sweep, with notes of its own. */
function laneOf(group: Lane): Lane {
  const fork = group.sweep?.fork() ?? null;
  return { guard: fork?.guard ?? { active: false, blocked: 0 }, sweep: fork, skipped: [], windows: new Map() };
}

/** Take over what a lane noted, after what was taken over before: as one lane would hold it that did both one after the other. */
function takeLane(into: Lane, from: Lane): void {
  if (into.sweep && from.sweep) into.sweep.absorb(from.sweep);
  else into.guard.blocked += from.guard.blocked;
  into.skipped.push(...from.skipped);
  takeWindows(into.windows, from.windows);
}

/**
 * Work on each of `count` pages of the group that runs now, as many at the same time as the budget
 * allows: each page in a browser slot and a lane of its own, so that one page that silences its
 * sockets does not let another speak. What the pages noted is taken over in their order, and the
 * results come back in that order, as with one page after the other.
 */
function perPage<T>(count: number, work: (index: number) => Promise<T>): Promise<T[]> {
  const group = lane();
  const own: Lane[] = [];
  return inOrder(
    count,
    budget.atOnce,
    (index) => {
      own[index] = laneOf(group);
      return budget.slots.run(() => lanes.run(own[index]!, () => work(index)));
    },
    (index) => takeLane(group, own[index]!),
  );
}

/**
 * Two parts of one group at the same time, each with notes of its own, taken over first of the
 * one and then of the other. Both are waited for before a failure is passed on, so that no page is
 * still open when the browser closes.
 */
async function besideEachOther<A, B>(one: () => Promise<A>, other: () => Promise<B>): Promise<[A, B]> {
  const group = lane();
  const own = [laneOf(group), laneOf(group)] as const;
  const [first, second] = await Promise.allSettled([lanes.run(own[0], one), lanes.run(own[1], other)]);
  takeLane(group, own[0]);
  takeLane(group, own[1]);
  if (first.status === "rejected") throw first.reason;
  if (second.status === "rejected") throw second.reason;
  return [first.value, second.value];
}

/** Work in a browser context of its own, closed afterwards. */
async function inContext<T>(open: OpenContext, viewport: { width: number; height: number } | undefined, work: (context: BrowserContext) => Promise<T>): Promise<T> {
  const context = await open(viewport);
  try {
    return await work(context);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * The most controls the hover probe points at in the pages of the sample. It counts kinds of control, not controls:
 * of each kind a few are pointed at, so the number that is reached follows the design of a site and not its size.
 * Far above what a site has; when it is reached all the same, the output names the kinds that were left out.
 */
const MAX_HOVER_TARGETS = 400;
/** How many controls of one kind are pointed at. The second one shows whether the first was an exception. */
const HOVER_EXAMPLES_PER_KIND = 2;
const MOBILE = { width: 360, height: 740 };
/**
 * How many kinds of control the press probe tries on the pages; the output names what was left out. A link counts as a
 * kind per name, so a site of thirty pages reaches three hundred. The states of the model are not held to it: they are
 * few, they come last, and a form that only exists in a state has the controls where a press matters most.
 */
const MAX_DOWN_TARGETS = 600;
/** A probe in a state of the model opens the state again when what it did closed it, at most this often. */
const MAX_REOPENINGS = 12;
/** A state with many controls takes longer than one step on a page. */
const STATE_PROBE_TIMEOUT_MS = 600_000;
/** What is found in the narrow window is counted apart from the same control in the default window: it can look and behave differently there. */
const NARROW_KEY = "smal|";
const DEFAULT_WIDTH = 1280;
/** A state that was recorded in a window narrower than this is a state of the narrow layout. */
const NARROW_BELOW = 768;
const MAX_KEY_REACTIONS_IN_STATE = 8;
const EXAMPLES_NOT_EXAMINED = 25;

const STEP_TIMEOUT_MS = 180_000;
/** Each kind of setting is changed once in a run. */
const seenSettings = new Set<string>();

/**
 * Run one probe step with a time limit. A page that never settles must not stall the
 * whole run; the step is recorded as not examined instead.
 */
async function withinTime<T>(page: string, step: string, fallback: T, work: () => Promise<T>, limitMs = STEP_TIMEOUT_MS): Promise<T> {
  const outcome = await sayingItRuns(`states ${page} ${step}`, () => limited(limitMs, work));
  if (outcome.ok) return outcome.value;
  // A session that ran out is no step that was skipped: the command stops.
  throwIfLoginExpired();
  lane().skipped.push({ page, step: `${step}: ${outcome.reason}` });
  process.stderr.write(`states ${page} ${step} overgeslagen: ${outcome.reason}\n`);
  return fallback;
}

/** Say which probe starts on which page or state, and how far along it is. */
const say = (probe: string, index: number, total: number, what: string): void => void process.stderr.write(progressLine("states", probe, index, total, what));
/** One page or state of a probe: a line when it starts, and a line every half minute while it is busy. */
const step = <T>(probe: string, index: number, total: number, what: string, work: () => Promise<T>): Promise<T> => {
  say(probe, index, total, what);
  return sayingItRuns(`states ${probe} ${index + 1}/${total} ${what}`, work);
};

/** A page of the sample that did not load, also not the second time: the probe that wanted it is noted as not done and the command goes on. */
class PageNotLoaded extends Error {}

/**
 * Load a page of the sample normally, then silence its sockets: from here on only probes act on it.
 * An embedded window is opened the way the sweep measures it: on the page it stands on, with the
 * frame handed to the probe as a page. When it is not there it is opened on its own, and that is kept.
 * A page that does not load is tried once more, as `collect` and `contrast` do.
 */
async function freshPage(context: BrowserContext, data: PageData): Promise<Page> {
  const { guard, sweep, windows } = lane();
  guard.active = false;
  const mark = sweep?.mark();
  const { page, placement } = await retryOnce(`states ${data.label} ${data.item.url}`, async () => {
    // A try that failed leaves no closed blocker behind.
    if (mark) sweep?.rewind(mark);
    const tab = await context.newPage();
    try {
      return await loadSampled(tab, data.item, async (loaded) => void (await sweep?.dismiss(context, loaded, "states")));
    } catch (error) {
      await tab.close().catch(() => undefined);
      throw error;
    }
  }).catch((error: Error) => {
    throwIfLoginExpired();
    if (error instanceof LoginExpired) throw error;
    throw new PageNotLoaded(`de pagina laadde ook bij de tweede poging niet (${firstLineOf(error)})`);
  });
  if (placement) {
    const known = windows.get(data.label) ?? { page: data.label, url: data.item.url, inPlaceOn: placement.inPlaceOn, apartNl: placement.apartNl, failedNl: [] };
    // Once on its own is what the reader has to know, also when other probes found the window in place.
    if (placement.apartNl) Object.assign(known, { inPlaceOn: null, apartNl: placement.apartNl });
    windows.set(data.label, known);
  }
  guard.active = true;
  return page;
}

/** Bring a page that a probe navigated away from back to the page under test, as a fresh page is. */
const restore = (context: BrowserContext, data: PageData) => async (page: Page): Promise<void> => {
  const { guard, sweep } = lane();
  guard.active = false;
  const frame = page.mainFrame();
  if (frame.parentFrame()) {
    // An embedded window that went elsewhere goes back to its own address; the page around it stays as it is.
    await frame.goto(data.item.url, { waitUntil: "load" });
    await settlePage(page);
  } else {
    await loadPage(page, data.item.url);
    await sweep?.dismiss(context, page, "states");
  }
  guard.active = true;
};

/**
 * One probe on one page. Inside an embedded window a probe that fails is written down as not
 * done there and the rest goes on; on a page of the site a failure stops the command, as it did,
 * unless the page did not load twice: then the probe is written down as not done there.
 */
async function inWindow<T>(data: PageData, probeNl: string, fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throwIfLoginExpired();
    const reason = firstLineOf(error);
    const { skipped: skippedSteps, windows } = lane();
    if (!data.item.embeddedOn?.length) {
      if (!(error instanceof PageNotLoaded)) throw error;
      skippedSteps.push({ page: data.label, step: `${probeNl}: ${reason}` });
      process.stderr.write(`states ${data.label} ${probeNl} overgeslagen: ${reason}\n`);
      return fallback;
    }
    const known = windows.get(data.label) ?? { page: data.label, url: data.item.url, inPlaceOn: null, apartNl: null, failedNl: [] };
    known.failedNl.push(`${probeNl}: ${reason}`);
    windows.set(data.label, known);
    skippedSteps.push({ page: data.label, step: `${probeNl} in het ingesloten venster: ${reason}` });
    process.stderr.write(`states ${data.label} ${probeNl} in het ingesloten venster overgeslagen: ${reason}\n`);
    return fallback;
  }
}

async function triggerOnFreshPage(context: BrowserContext, data: PageData, trigger: Described, runDir: string, viewport: string): ReturnType<typeof probeTrigger> {
  const page = await freshPage(context, data);
  try {
    return await probeTrigger(page, trigger, { label: data.label, url: data.item.url, outDir: runDir, viewport, socketMessagesBlocked, seenSettings });
  } finally {
    await page.close();
  }
}

async function probeSingleKeys(open: OpenContext, pages: PageData[]): Promise<States["singleKeys"]> {
  const perPageFound = await perPage(pages.length, async (index) => {
    const data = pages[index]!;
    const reactions: States["singleKeys"]["reactions"] = [];
    await step("toetsen", index, pages.length, data.label, () =>
      inContext(open, undefined, (context) =>
        inWindow(data, "losse toetsen", undefined, async () => {
          let page = await freshPage(context, data);
          let rest = KEYS;
          for (;;) {
            const reaction = await firstKeyReaction(page, rest);
            if (!reaction) break;
            reactions.push({ page: data.label, key: reaction.key, change: reaction.change, details: reaction.details });
            rest = rest.slice(reaction.index + 1);
            await page.close();
            page = await freshPage(context, data);
          }
          await page.close();
        }),
      ),
    );
    return reactions;
  });
  return { pagesExamined: pages.length, keysPressed: KEYS, reactions: perPageFound.flat() };
}

type StateKeys = NonNullable<States["singleKeys"]["states"]>[number];

/** The single keys in one state of the model. After a reaction the state is opened again and the rest of the keys follow. */
async function keysInState(opener: StateOpener & { open: NonNullable<StateOpener["open"]> }): Promise<StateKeys> {
  const row: StateKeys = { state: opener.base.id, examined: false, reasonNl: null, focusAfterOpening: null, focusTakenOutOfTextField: false, keysPressed: 0, reactions: [] };
  let rest = KEYS;
  for (let round = 0; round <= MAX_KEY_REACTIONS_IN_STATE; round++) {
    const opened = await opener.open();
    try {
      if (!opened.reached || !opened.surface) return { ...row, reasonNl: opened.reasonNl ?? "de toestand is niet bereikt" };
      const { page } = opened.surface;
      const focus = await leaveTextEntry(page);
      row.focusAfterOpening = focus.focusWas;
      row.focusTakenOutOfTextField = focus.moved;
      if (focus.moved && opened.post && !(await holds(page, opened.post)).holds) return { ...row, reasonNl: "na het openen stond de focus in een invoerveld, waar een letter invoer is; toen de focus eruit werd gehaald, sloot het onderdeel" };
      const reaction = await firstKeyReaction(page, rest);
      row.examined = true;
      if (!reaction) return { ...row, keysPressed: KEYS.length };
      row.reactions.push({ key: reaction.key, change: reaction.change });
      rest = rest.slice(reaction.index + 1);
      row.keysPressed = KEYS.length - rest.length;
    } finally {
      await opened.surface?.context.close().catch(() => undefined);
    }
  }
  return rest.length > 0 ? { ...row, reasonNl: `gestopt na ${row.reactions.length} reacties`, keysNotPressed: rest } : row;
}

/** The single keys in every state of the model: a shortcut that only works while a dialog or panel is open is found there. */
export async function probeSingleKeysInStates(model: ModelSweep, kept: (opener: StateOpener) => StateKeys | null = () => null): Promise<StateKeys[]> {
  const rows: StateKeys[] = [];
  // A blocker is the same at every size and scheme; its first variant stands for it.
  const openers = model.openers().filter((entry) => entry.primary);
  for (const [index, opener] of openers.entries()) {
    const known = kept(opener);
    if (known) {
      rows.push(known);
      continue;
    }
    const notExamined = (reasonNl: string): StateKeys => ({ state: opener.base.id, examined: false, reasonNl, focusAfterOpening: null, focusTakenOutOfTextField: false, keysPressed: 0, reactions: [] });
    const open = opener.open;
    if (!open) rows.push(notExamined(`de verkenner kon het niet openen: ${opener.notOpenedNl ?? ""}`));
    else {
      say("toetsen in toestand", index, openers.length, opener.base.id);
      rows.push(await withinTime(opener.base.id, "toetsen in toestand", notExamined(`geen antwoord binnen ${STEP_TIMEOUT_MS / 1000} seconden`), () => keysInState({ ...opener, open })));
    }
  }
  return rows;
}

type HoverTarget = Described & { kind?: string; iconOnly?: boolean; showsMore?: string[]; title?: string | null; describedBy?: string | null; nonControl?: boolean };
type HoverCoverage = NonNullable<States["hoverCoverage"]>;
type DownCoverage = NonNullable<States["downEventCoverage"]>;
type HoverInState = NonNullable<HoverCoverage["states"]>[number];
type DownInState = NonNullable<DownCoverage["states"]>[number];

const controlNl = (target: Described): string => `${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`;

/** Where a probe looks: a page of the sample in the default window or in the narrow one, or a state of the model. */
interface Place {
  /** Label of the page, or the name of the state. */
  label: string;
  narrow: boolean;
  state?: string;
  /** Start of the file name of a screenshot made here. */
  shot: string;
}

/** The page a probe works on: the same one as long as it is as it was, a fresh one after `fresh`. Null when there is none any more. */
type PageSource = (fresh?: boolean) => Promise<Page | null>;

/**
 * The turn of one page of the sample among the pages a probe goes over at the same time. Which
 * controls of a page are tried depends on what the pages before it had, so a page waits for `turn`
 * before it chooses, and says `chosen` right after; trying them is done at the same time as the others.
 */
interface PageTurn {
  turn: () => Promise<void>;
  chosen: () => void;
}

/** What pointing at controls found in one place, kept apart until it is that place's turn to be taken over. */
interface HoverRows {
  hover: States["hover"];
  contrast: NonNullable<States["hoverContrast"]>;
  iconOnly: NonNullable<HoverCoverage["iconOnly"]>;
  nonControls: number;
}

/**
 * Point at controls and give them focus, a few of each kind. Controls that are the same
 * element in the same place with the same classes, attributes and colours are one kind; a
 * control with only a pictogram or with a title or description is always pointed at itself.
 * What was seen in an earlier place is not pointed at again in a later one.
 */
export class HoverRun implements HoverRows {
  readonly hover: States["hover"] = [];
  readonly contrast: NonNullable<States["hoverContrast"]> = [];
  readonly iconOnly: NonNullable<HoverCoverage["iconOnly"]> = [];
  private readonly kinds = new Map<string, { controls: Set<string>; examined: number; example: { page: string; control: string } }>();
  examined = 0;
  /** How many of the examined ones are no control. */
  nonControls = 0;
  private readonly runDir: string;
  readonly limit: number;

  constructor(runDir: string, limit = MAX_HOVER_TARGETS) {
    this.runDir = runDir;
    this.limit = limit;
  }

  static rows(): HoverRows {
    return { hover: [], contrast: [], iconOnly: [], nonControls: 0 };
  }

  /** Take over what a place found, in the order of the places. */
  keep(rows: HoverRows): void {
    this.hover.push(...rows.hover);
    this.contrast.push(...rows.contrast);
    this.iconOnly.push(...rows.iconOnly);
    this.nonControls += rows.nonControls;
  }

  /** The controls of a place, and after them what is no control but announces more for whoever points at it: an abbreviation, an icon with a description. */
  private static async targets(page: Page): Promise<HoverTarget[]> {
    return [...(await call<HoverTarget[]>(page, "hoverTargets")), ...(await call<HoverTarget[]>(page, "hoverHints").catch(() => []))];
  }

  /** Note a control of a place. Returns the kind it is of when it is to be pointed at. */
  private pick(place: Place, target: HoverTarget, found: { controls: number; kinds: number }): { kind: { examined: number }; named: { page: string; control: string } } | null {
    const prefix = place.narrow ? NARROW_KEY : "";
    const control = `${prefix}${target.nonControl ? "geen bediening|" : ""}${target.tag}|${target.text.slice(0, 40)}|${target.region}`;
    const key = `${prefix}${target.kind ?? control}`;
    const named = { page: place.label, control: controlNl(target) };
    let kind = this.kinds.get(key);
    if (!kind) {
      kind = { controls: new Set(), examined: 0, example: named };
      this.kinds.set(key, kind);
      found.kinds++;
    }
    if (kind.controls.has(control)) return null;
    kind.controls.add(control);
    found.controls++;
    if (kind.examined >= HOVER_EXAMPLES_PER_KIND || this.examined >= this.limit) return null;
    return { kind, named };
  }

  /** Count a control as pointed at; its number names its screenshots. */
  private take(kind: { examined: number }): number {
    kind.examined++;
    this.examined++;
    return this.examined;
  }

  private async point(page: Page, place: Place, target: HoverTarget, number: number, named: { page: string; control: string }, into: HoverRows): Promise<void> {
    const measured: NonNullable<States["hoverContrast"]> = [];
    const rows = await probeHoverTarget(page, target, { label: place.label, outDir: this.runDir, contrast: measured, screenshot: (trigger) => join("states", `${place.shot}-${trigger}-${number}.png`) });
    const where = { ...(place.state ? { state: place.state } : {}), ...(place.narrow ? { viewport: "smal" as const } : {}) };
    for (const row of rows) into.hover.push({ ...row, ...where });
    for (const row of measured) into.contrast.push({ ...row, ...where });
    // A button with only a pictogram, or a control with a title or description: say what pointing at it showed, also when that is nothing.
    if (target.nonControl) into.nonControls++;
    if (target.iconOnly || target.nonControl || (target.showsMore ?? []).length > 0) into.iconOnly.push({ ...named, ...where, ...(target.nonControl ? { nonControl: true } : {}), iconOnly: target.iconOnly === true, title: target.title ?? null, describedBy: target.describedBy ?? null, contentAppeared: rows.map((row) => row.trigger) });
  }

  /**
   * Go over the controls of one place, one after the other: a control is counted once a page for it
   * is there. For a state of the model, which may not open again. Returns how many controls and kinds
   * were new here and how many were pointed at.
   */
  async on(place: Place, source: PageSource, progress: (done: number, of: number) => void = () => undefined): Promise<{ controls: number; kinds: number; pointedAt: number; complete: boolean }> {
    const first = await source();
    if (!first) return { controls: 0, kinds: 0, pointedAt: 0, complete: false };
    const targets = await HoverRun.targets(first);
    const found = { controls: 0, kinds: 0, pointedAt: 0, complete: true };
    for (const [index, target] of targets.entries()) {
      const picked = this.pick(place, target, found);
      if (!picked) continue;
      const page = await source();
      if (!page) {
        found.complete = false;
        break;
      }
      const number = this.take(picked.kind);
      found.pointedAt++;
      progress(index, targets.length);
      await this.point(page, place, target, number, picked.named, this);
    }
    return found;
  }

  /**
   * Go over the controls of one page of the sample, next to other pages: at its turn the page
   * chooses all controls it points at, then points at them while the next page chooses. What it
   * found goes into `into`, which the caller keeps in the order of the pages. A page of the sample
   * loads again when asked, so every control chosen is pointed at, as `on` would have done.
   */
  async onPage(place: Place, source: PageSource, into: HoverRows, order: PageTurn, progress: (done: number, of: number) => void = () => undefined): Promise<void> {
    const first = await source();
    if (!first) return;
    const targets = await HoverRun.targets(first);
    await order.turn();
    const found = { controls: 0, kinds: 0 };
    const chosen: { index: number; target: HoverTarget; number: number; named: { page: string; control: string } }[] = [];
    for (const [index, target] of targets.entries()) {
      const picked = this.pick(place, target, found);
      if (picked) chosen.push({ index, target, number: this.take(picked.kind), named: picked.named });
    }
    order.chosen();
    for (const { index, target, number, named } of chosen) {
      const page = await source();
      if (!page) break;
      progress(index, targets.length);
      await this.point(page, place, target, number, named, into);
    }
  }

  coverage(): Pick<HoverCoverage, "limit" | "perKind" | "found" | "kinds" | "examined" | "notExamined" | "sameKindNotExamined" | "notExaminedExamples" | "nonControlsExamined"> {
    const all = [...this.kinds.values()];
    const left = all.filter((kind) => kind.examined === 0);
    return {
      limit: this.limit,
      perKind: HOVER_EXAMPLES_PER_KIND,
      found: all.reduce((sum, kind) => sum + kind.controls.size, 0),
      kinds: all.length,
      examined: this.examined,
      notExamined: left.length,
      sameKindNotExamined: all.filter((kind) => kind.examined > 0).reduce((sum, kind) => sum + kind.controls.size - kind.examined, 0),
      notExaminedExamples: left.map((kind) => kind.example).slice(0, EXAMPLES_NOT_EXAMINED),
      nonControlsExamined: this.nonControls,
    };
  }
}

/**
 * Press and release elsewhere, once for every kind of control a down-event can reach a
 * listener through. A page is used for the next control as long as the press changed nothing;
 * after a press that did something the next one gets a fresh page.
 */
export class DownRun {
  readonly results: NonNullable<States["downEvents"]> = [];
  readonly seen = new Set<string>();
  readonly left = new Map<string, { page: string; control: string }>();
  readonly gone: { page: string; control: string }[] = [];

  readonly limit: number;

  constructor(limit = MAX_DOWN_TARGETS) {
    this.limit = limit;
  }

  static rows(): DownRows {
    return { results: [], gone: [] };
  }

  /** Take over what a place found, in the order of the places. */
  keep(rows: DownRows): void {
    this.results.push(...rows.results);
    this.gone.push(...rows.gone);
  }

  /** Note a control of a place: whether it is pressed. A kind is pressed once; after the limit a kind on a page is named as left out. */
  private pick(place: Place, target: DownTarget, found: { kindsFound: number }): boolean {
    const key = `${place.narrow ? NARROW_KEY : ""}${downKind(target)}`;
    if (this.seen.has(key) || this.left.has(key)) return false;
    found.kindsFound++;
    if (!place.state && this.seen.size >= this.limit) {
      this.left.set(key, { page: place.label, control: controlNl(target) });
      return false;
    }
    this.seen.add(key);
    return true;
  }

  /** Press the chosen controls of a place in turn. Returns how many were pressed and whether a page was there for each of them. */
  private async press(place: Place, source: PageSource, chosen: { index: number; target: DownTarget }[], of: number, listening: Set<string>, delegated: boolean, into: DownRows, progress: (done: number, of: number) => void, state = { fresh: false }): Promise<{ pressed: number; complete: boolean }> {
    const done = { pressed: 0, complete: true };
    for (const { index, target } of chosen) {
      const page = await source(state.fresh);
      if (!page) {
        done.complete = false;
        break;
      }
      progress(index, of);
      const before = page.url();
      const result = await probeDownEvent(page, target, { label: place.label, listening: new Set([...listening, ...(delegated ? ["document of window"] : [])]) });
      if (result) {
        into.results.push({ ...result, ...(place.state ? { state: place.state } : {}), ...(place.narrow ? { viewport: "smal" as const } : {}) });
        done.pressed++;
      } else into.gone.push({ page: place.label, control: controlNl(target) });
      // Only a page on which the press did nothing is the page the next control is pressed on.
      state.fresh = !result || result.changeOnDown !== null || result.changeAfterReleaseElsewhere !== null || page.url() !== before;
    }
    return done;
  }

  /** Go over the controls of a state of the model, one after the other: when the state does not open again, the controls after it are not noted. */
  async on(place: Place, source: PageSource, listening: Set<string>, delegated: boolean, progress: (done: number, of: number) => void = () => undefined): Promise<{ kindsFound: number; pressed: number; complete: boolean }> {
    const first = await source();
    if (!first) return { kindsFound: 0, pressed: 0, complete: false };
    const targets = await downEventTargets(first, listening, delegated);
    const found = { kindsFound: 0, pressed: 0, complete: true };
    // Whether the next control gets a fresh page carries over from one control to the next.
    const state = { fresh: false };
    for (const [index, target] of targets.entries()) {
      if (!this.pick(place, target, found)) continue;
      const done = await this.press(place, source, [{ index, target }], targets.length, listening, delegated, this, progress, state);
      found.pressed += done.pressed;
      if (!done.complete) {
        found.complete = false;
        break;
      }
    }
    return found;
  }

  /**
   * Go over the controls of one page of the sample, next to other pages: at its turn the page
   * chooses the kinds it presses, then presses them while the next page chooses. What it found goes
   * into `into`, which the caller keeps in the order of the pages.
   */
  async onPage(place: Place, source: PageSource, listening: Set<string>, delegated: boolean, into: DownRows, order: PageTurn, progress: (done: number, of: number) => void = () => undefined): Promise<void> {
    const first = await source();
    if (!first) return;
    const targets = await downEventTargets(first, listening, delegated);
    await order.turn();
    const chosen = [...targets.entries()].filter(([, target]) => this.pick(place, target, { kindsFound: 0 })).map(([index, target]) => ({ index, target }));
    order.chosen();
    await this.press(place, source, chosen, targets.length, listening, delegated, into, progress);
  }
}

/** What pressing found in one place, kept apart until it is that place's turn to be taken over. */
interface DownRows {
  results: NonNullable<States["downEvents"]>;
  gone: { page: string; control: string }[];
}

/** A page of the sample for a probe that goes over many controls: loaded once, and again when the probe asks for a fresh one. */
function pageSource(context: BrowserContext, data: PageData): { source: PageSource; close: () => Promise<void> } {
  let page: Page | null = null;
  const close = async (): Promise<void> => {
    await page?.close().catch(() => undefined);
    page = null;
  };
  return {
    close,
    source: async (fresh = false) => {
      if (page && !fresh) {
        await page.mouse.move(0, 0).catch(() => undefined);
        return page;
      }
      await close();
      page = await freshPage(context, data);
      return page;
    },
  };
}

type OpenableState = StateOpener & { open: NonNullable<StateOpener["open"]> };

/**
 * A state of the model for a probe that goes over the controls in it. The state is opened by its
 * recipe; when a step of the probe closed it (Escape after a tooltip, a press that acted), it is
 * opened again from a clean page and the probe goes on with the next control.
 */
export async function inState<T extends { complete: boolean }>(opener: OpenableState, work: (source: PageSource, narrow: boolean) => Promise<T>): Promise<{ examined: boolean; reasonNl: string | null; viewport: string | null; found: T | null }> {
  const now: { opened: Awaited<ReturnType<OpenableState["open"]>> | null; openings: number; reasonNl: string | null; viewport: string | null } = { opened: null, openings: 0, reasonNl: null, viewport: null };
  const close = async (): Promise<void> => {
    await now.opened?.surface?.context.close().catch(() => undefined);
    now.opened = null;
  };
  const source: PageSource = async (fresh = false) => {
    const current = now.opened;
    if (current?.surface && !fresh && (!current.post || (await holds(current.surface.page, current.post)).holds)) {
      await current.surface.page.mouse.move(0, 0).catch(() => undefined);
      return current.surface.page;
    }
    await close();
    if (now.openings >= MAX_REOPENINGS) {
      now.reasonNl = `gestopt nadat de toestand ${MAX_REOPENINGS} keer was geopend`;
      return null;
    }
    now.openings++;
    const next = await opener.open();
    if (!next.reached || !next.surface) {
      now.reasonNl = next.reasonNl ?? "de toestand is niet bereikt";
      await next.surface?.context.close().catch(() => undefined);
      return null;
    }
    now.opened = next;
    const size = next.surface.page.viewportSize();
    now.viewport = size ? `${size.width}x${size.height}` : null;
    return next.surface.page;
  };
  try {
    const first = await source();
    if (!first) return { examined: false, reasonNl: now.reasonNl, viewport: now.viewport, found: null };
    const narrow = (first.viewportSize()?.width ?? DEFAULT_WIDTH) < NARROW_BELOW;
    const found = await work(source, narrow);
    return { examined: found.complete, reasonNl: found.complete ? null : now.reasonNl, viewport: now.viewport, found };
  } finally {
    await close();
  }
}

/** Whether the document or the window of a page as it is now listens for a press, apart from what the browser itself registers. */
async function documentListens(page: Page, ownOfBrowser: Record<string, Record<string, number>>): Promise<boolean> {
  const counts = await call<Record<string, Record<string, number>>>(page, "listenerCounts").catch(() => ({}) as Record<string, Record<string, number>>);
  return DOWN_EVENTS.some((event) => DELEGATING.some((target) => (counts[event]?.[target] ?? 0) > (ownOfBrowser[event]?.[target] ?? 0)));
}

/** The pointer probes in one state of the model: what is in the state and was not on a page is pointed at and pressed. */
export async function pointerInState(opener: OpenableState, hovering: HoverRun, pressing: DownRun, ownOfBrowser: Record<string, Record<string, number>>): Promise<{ hover: HoverInState; down: DownInState }> {
  const id = opener.base.id;
  const pointed = await inState(opener, (source, narrow) => hovering.on({ label: id, narrow, state: id, shot: `state-${id}` }, source));
  const pressed = await inState(opener, async (source, narrow) => {
    const page = await source();
    return pressing.on({ label: id, narrow, state: id, shot: `state-${id}` }, source, new Set(), page ? await documentListens(page, ownOfBrowser) : false);
  });
  return {
    hover: { state: id, viewport: pointed.viewport, examined: pointed.examined, reasonNl: pointed.reasonNl, controls: pointed.found?.controls ?? 0, kinds: pointed.found?.kinds ?? 0, pointedAt: pointed.found?.pointedAt ?? 0 },
    down: { state: id, viewport: pressed.viewport, examined: pressed.examined, reasonNl: pressed.reasonNl, kindsFound: pressed.found?.kindsFound ?? 0, pressed: pressed.found?.pressed ?? 0 },
  };
}

/** One page of each page type, for the probes that are repeated in the narrow window. */
function onePagePerType(model: ModelSweep, pages: PageData[]): PageData[] {
  const chosen: PageData[] = [];
  for (const type of model.model.pageTypes) {
    const page = pages.find((entry) => entry.item.url === type.representative) ?? pages.find((entry) => type.pages.includes(entry.item.url));
    if (page && !chosen.includes(page)) chosen.push(page);
  }
  return chosen;
}

/** A page of the sample a pointer probe goes over: in the default window or in the narrow one, with its place in that list. */
interface SamplePlace {
  data: PageData;
  narrow: boolean;
  index: number;
  of: number;
}

/** Every page of the sample in the default window, then one page of each page type in the narrow one. */
const samplePlaces = (pages: PageData[], narrowPages: PageData[]): SamplePlace[] => [...pages.map((data, index) => ({ data, narrow: false, index, of: pages.length })), ...narrowPages.map((data, index) => ({ data, narrow: true, index, of: narrowPages.length }))];

/**
 * A pointer probe on pages of the sample, as many at the same time as the budget allows, each in
 * a browser context of its own. A page chooses its controls at its turn, after the pages before it
 * (see `PageTurn`), so that a limit is used up in the order of the pages, as with one after the
 * other. Returns per page, in their order, what it found and whether it was gone over to the end.
 */
function overPages<P extends SamplePlace, R>(open: OpenContext, places: P[], probe: string, probeNl: string, rows: () => R, work: (place: P, source: PageSource, into: R, order: PageTurn, progress: (done: number, of: number) => void) => Promise<void>): Promise<{ rows: R; reached: boolean }[]> {
  const turns = new Turns(places.length);
  return perPage(places.length, async (at) => {
    const place = places[at]!;
    const { data, narrow, index, of } = place;
    const name = narrow ? `${probe} smal` : probe;
    const into = rows();
    try {
      say(name, index, of, data.label);
      const quiet = { since: Date.now() };
      // A page with many elements takes minutes: say how far it is.
      const progress = (done: number, total: number): void => {
        if (Date.now() - quiet.since <= STILL_RUNNING_MS) return;
        quiet.since = Date.now();
        process.stderr.write(`states ${name} ${index + 1}/${of} ${data.label} loopt nog (element ${done + 1} van ${total})\n`);
      };
      const reached = await inContext(open, narrow ? MOBILE : undefined, (context) => {
        const { source, close } = pageSource(context, data);
        return inWindow(data, narrow ? `${probeNl} op een smal scherm` : probeNl, false, async () => {
          try {
            await work(place, source, into, { turn: () => turns.turn(at), chosen: () => turns.done(at) }, progress);
            return true;
          } finally {
            await close();
          }
        });
      });
      return { rows: into, reached };
    } finally {
      // A page that did not get to choose, because it did not load, lets the next one choose.
      turns.done(at);
    }
  });
}

/** The hover probe on every page of the sample in the default window, and on one page of each page type in the narrow one. */
async function probeHover(open: OpenContext, pages: PageData[], narrowPages: PageData[], run: HoverRun): Promise<string[]> {
  const places = samplePlaces(pages, narrowPages);
  const done = await overPages(open, places, "aanwijzen", "aanwijzen", HoverRun.rows, ({ data, narrow }, source, into, order, progress) =>
    run.onPage({ label: data.label, narrow, shot: `${slugForUrl(data.item.url)}${narrow ? "-smal" : ""}` }, source, into, order, progress),
  );
  for (const { rows } of done) run.keep(rows);
  return places.filter((place, at) => place.narrow && done[at]!.reached).map((place) => place.data.label);
}

/**
 * The press probe on every page of the sample that listens for a press, and on one page of each
 * page type in the narrow window. `ownOfBrowser` is what the test browser itself registers on an
 * empty page: a listener on the document that is the browser's own makes no control a candidate.
 */
async function probeDownEvents(open: OpenContext, pages: PageData[], narrowPages: PageData[], ownOfBrowser: Record<string, Record<string, number>>, run: DownRun): Promise<Pick<DownCoverage, "pagesWithOwnListener" | "pagesWithOnlyDelegatedListener" | "pagesWithoutListener" | "narrowPages">> {
  const places = samplePlaces(pages, narrowPages).map((place) => {
    const ofSite = DOWN_EVENTS.flatMap((event) => Object.entries(place.data.facts.listeners[event] ?? {}).filter(([target, count]) => count > (ownOfBrowser[event]?.[target] ?? 0)).map(([target]) => target));
    const listening = new Set(ofSite.filter((target) => !DELEGATING.includes(target)));
    return { ...place, listening, delegated: ofSite.some((target) => DELEGATING.includes(target)) };
  });
  const listens = (place: (typeof places)[number]): boolean => place.listening.size > 0 || place.delegated;
  const probed = places.filter(listens);
  const done = await overPages(open, probed, "indrukken", "indrukken en elders loslaten", DownRun.rows, ({ data, narrow, listening, delegated }, source, into, order, progress) =>
    run.onPage({ label: data.label, narrow, shot: slugForUrl(data.item.url) }, source, listening, delegated, into, order, progress),
  );
  for (const { rows } of done) run.keep(rows);
  const onPages = places.filter((place) => !place.narrow);
  return {
    pagesWithOwnListener: onPages.filter((place) => place.listening.size > 0).map((place) => place.data.label),
    pagesWithOnlyDelegatedListener: onPages.filter((place) => place.listening.size === 0 && place.delegated).map((place) => place.data.label),
    pagesWithoutListener: onPages.filter((place) => !listens(place)).length,
    narrowPages: places.filter((place) => place.narrow && (!listens(place) || done[probed.indexOf(place)]!.reached)).map((place) => place.data.label),
  };
}

/**
 * The pointer probes in every state of the model, each state once: a blocker in its first variant.
 * A state for which `kept` says yes is left alone: an earlier sweep probed it with the same recipe.
 */
export async function probePointerInStates(model: ModelSweep, hovering: HoverRun, pressing: DownRun, ownOfBrowser: Record<string, Record<string, number>>, kept: (opener: StateOpener) => boolean = () => false): Promise<{ hover: HoverInState[]; down: DownInState[] }> {
  const rows = { hover: [] as HoverInState[], down: [] as DownInState[] };
  const openers = model.openers().filter((entry) => entry.primary);
  for (const [index, opener] of openers.entries()) {
    if (kept(opener)) continue;
    const id = opener.base.id;
    const notExamined = (reasonNl: string): { hover: HoverInState; down: DownInState } => ({ hover: { state: id, viewport: null, examined: false, reasonNl, controls: 0, kinds: 0, pointedAt: 0 }, down: { state: id, viewport: null, examined: false, reasonNl, kindsFound: 0, pressed: 0 } });
    const open = opener.open;
    let row: { hover: HoverInState; down: DownInState };
    if (!open) row = notExamined(`de verkenner kon het niet openen: ${opener.notOpenedNl ?? ""}`);
    else {
      say("aanwijzen en indrukken in toestand", index, openers.length, id);
      row = await withinTime(id, "aanwijzen en indrukken in toestand", notExamined(`geen antwoord binnen ${STATE_PROBE_TIMEOUT_MS / 1000} seconden`), () => pointerInState({ ...opener, open }, hovering, pressing, ownOfBrowser), STATE_PROBE_TIMEOUT_MS);
    }
    rows.hover.push(row.hover);
    rows.down.push(row.down);
  }
  return rows;
}

/** Repeat every arrow-key walk from the keyboard probe and watch whether focus alone changes the context. */
async function arrowFocus(open: OpenContext, pages: PageData[]): Promise<NonNullable<States["arrowFocus"]>> {
  const perPageFound = await perPage(pages.length, async (index) => {
    const data = pages[index]!;
    const walks = data.tabwalk.arrowReach ?? [];
    const results: NonNullable<States["arrowFocus"]> = [];
    if (walks.length === 0) return results;
    say("pijltoetsen", index, pages.length, data.label);
    await inContext(open, undefined, async (context) => {
      for (const walk of walks) {
        await inWindow(data, "pijltoetsen", undefined, async () => {
          const page = await freshPage(context, data);
          try {
            const result = await probeArrowFocus(page, walk, data.label);
            if (result) results.push(result);
          } finally {
            await page.close();
          }
        });
      }
    });
    return results;
  });
  return perPageFound.flat();
}

async function listenersOnEmptyPage(context: BrowserContext): Promise<Record<string, Record<string, number>>> {
  lane().guard.active = false;
  const page = await context.newPage();
  try {
    return await browserListeners(page);
  } finally {
    await page.close();
  }
}

interface StatesStamp {
  /** Hash over every page of the sample as `collect` measured it: the probe goes over all pages and keeps what it saw first, so one changed page makes the whole of it stale. */
  pages: string | null;
  /** Per state of the model the key its keys were pressed against. */
  states: Record<string, string>;
}

/**
 * Everything that only shows after interaction: dialogs, form errors, key shortcuts and hover content.
 * When no page changed since the last time and the blockers are the same, what was found on
 * the pages is kept and only the keys in the states whose recipe changed are pressed again;
 * with `fresh` everything is done again. `limits` sets other limits for the hover and press probes
 * than 400 and 600, for a test that has to reach them on a small site.
 */
export async function states(runDir: string, options: { fresh?: boolean; atOnce?: number; limits?: { hover?: number; down?: number } } = {}): Promise<States> {
  const startedAt = stepStart();
  const run = await loadRun(runDir);
  const settings = sweepAtOnce(runDir, options.atOnce ?? 1);
  if (settings.noteNl) process.stderr.write(`states: ${settings.noteNl}\n`);
  const browser: Browser = await launchBrowser();
  Object.assign(mainLane, { guard: { active: false, blocked: 0 }, skipped: [], windows: new Map() });
  const sweep = await confirmLogin(browser)
    .then(() => ModelSweep.load(runDir, browser, mainLane.guard))
    .catch(async (error: Error) => {
      await browser.close();
      throw error;
    });
  // In a run with a login a control that logs out is never activated: one click ends the session for every probe after it.
  const loggedIn = runLoginMark() !== null;
  const logsOut = (page: string, trigger: Described): boolean => {
    if (!loggedIn || !isLogout({ text: trigger.text || String(trigger.ariaLabel ?? "") })) return false;
    lane().skipped.push({ page, step: `knop "${trigger.text.slice(0, 30)}": logt uit, niet bediend` });
    return true;
  };
  mainLane.sweep = sweep;
  const measured = await measuredPages(runDir, run.sample.items);
  const blockers = sweep.blockersKey;
  const pagesNow = run.sample.items.every((item) => measured[item.slug]?.key === pageKey(blockers, item)) ? sha256(canonicalJson(run.sample.items.map((item) => [item.slug, measured[item.slug]]))) : null;
  const stateKeys = Object.fromEntries(sweep.openers().filter((opener) => opener.primary).map((opener) => [opener.base.id, opener.key]));
  const stamp = options.fresh ? null : await readStamp<StatesStamp>(join(runDir, STATES_STAMP));
  if (stamp && run.states && pagesNow !== null && stamp.pages === pagesNow) {
    try {
      const before = run.states.singleKeys.states ?? [];
      let pressedAgain = 0;
      run.states.singleKeys.states = await probeSingleKeysInStates(sweep, (opener) => {
        const row = before.find((entry) => entry.state === opener.base.id);
        if (row && (row.examined || !opener.open) && stamp.states[opener.base.id] === opener.key) return row;
        pressedAgain++;
        return null;
      });
      // The pointer probes in the states whose recipe changed: what an earlier sweep found in the other states stands.
      const hoverBefore = run.states.hoverCoverage?.states;
      const downBefore = run.states.downEventCoverage?.states;
      if (hoverBefore && downBefore) {
        const hovering = new HoverRun(runDir, options.limits?.hover);
        const pressing = new DownRun(options.limits?.down);
        const again = await probePointerInStates(sweep, hovering, pressing, run.states.browserListeners ?? {}, (opener) => stamp.states[opener.base.id] === opener.key && hoverBefore.some((row) => row.state === opener.base.id && (row.examined || !opener.open)));
        const stands = (row: { state?: string }): boolean => row.state === undefined || (row.state in stateKeys && !again.hover.some((entry) => entry.state === row.state));
        run.states.hover = [...run.states.hover.filter(stands), ...hovering.hover];
        run.states.hoverContrast = [...(run.states.hoverContrast ?? []).filter(stands), ...hovering.contrast];
        run.states.downEvents = [...(run.states.downEvents ?? []).filter(stands), ...pressing.results];
        run.states.hoverCoverage = { ...run.states.hoverCoverage!, iconOnly: [...(run.states.hoverCoverage!.iconOnly ?? []).filter(stands), ...hovering.iconOnly], states: [...hoverBefore.filter(stands), ...again.hover] };
        run.states.downEventCoverage = { ...run.states.downEventCoverage!, states: [...downBefore.filter(stands), ...again.down] };
      }
      process.stderr.write(`states: geen pagina is veranderd; overgenomen wat op de pagina's is gevonden, en in ${pressedAgain} toestanden de toetsen opnieuw ingedrukt\n`);
      await writeJson(join(runDir, "states.json"), run.states);
      await writeJson(join(runDir, STATES_STAMP), { pages: pagesNow, states: stateKeys } satisfies StatesStamp);
      await writeManifest(runDir, { command: "states", startedAt, ...run.states.examined, reused: true, statesProbedAgain: pressedAgain }, browser.version());
      return run.states;
    } finally {
      await browser.close();
    }
  }
  /** A browser context of the group that runs now: with its guard, and seeded and watched by its copy of the sweep. */
  const contextOfLane = async (viewport?: { width: number; height: number }): Promise<BrowserContext> => {
    const { guard, sweep: own } = lane();
    const context = await newContext(browser, viewport ? { viewport } : {}, guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await own?.install(context);
    return context;
  };
  const result: States = { dialogs: [], formErrors: [], singleKeys: { pagesExamined: 0, keysPressed: KEYS, reactions: [] }, hover: [], examined: { triggers: 0, forms: 0, hoverTargets: 0 } };
  try {
    seenSettings.clear();
    // The forms, the buttons and the settings. Each distinct trigger is activated once, on the first page that has it.
    const triggersAndForms = async (): Promise<{ dialogs: States["dialogs"]; formErrors: States["formErrors"]; settings: NonNullable<States["settings"]>; triggers: number }> => {
      const allSettings: NonNullable<States["settings"]> = [];
      const dialogs: States["dialogs"] = [];
      const formErrors: States["formErrors"] = [];
      const seenTriggers = new Set<string>();
      const seenForms = new Set<string>();
      const context = await contextOfLane();
      try {
        for (const [index, data] of run.pages.entries()) {
          say("formulieren en knoppen", index, run.pages.length, `${data.label} ${data.item.url}`);
          const { triggers, inPageForms } = await withinTime(data.label, "formulieren", { triggers: [] as Described[], inPageForms: [] as FormErrorState[] }, async () => {
            const page = await freshPage(context, data);
            const found = await call<Described[]>(page, "triggers");
            const forms = await probeForms(page, { label: data.label, url: data.item.url, outDir: runDir, openedVia: null, socketMessagesBlocked, restore: restore(context, data) });
            await page.close();
            return { triggers: found, inPageForms: forms };
          });
          allSettings.push(
            ...(await withinTime(data.label, "instellingen", [] as NonNullable<States["settings"]>, async () => {
              const settingsPage = await freshPage(context, data);
              const changed = await probeSettings(settingsPage, { label: data.label, openedVia: null, seen: seenSettings });
              await settingsPage.close();
              return changed;
            })),
          );
          for (const form of inPageForms) {
            const key = `${form.fields.map((field) => field.name).join("|")}`;
            if (seenForms.has(key)) continue;
            seenForms.add(key);
            formErrors.push(form);
          }
          for (const trigger of triggers) {
            const key = `${trigger.tag}|${trigger.text.slice(0, 40)}|${trigger.ariaLabel}|${trigger.region}`;
            if (seenTriggers.has(key)) continue;
            seenTriggers.add(key);
            if (logsOut(data.label, trigger)) continue;
            const probed = await withinTime(data.label, `knop "${trigger.text.slice(0, 30)}"`, null, () => triggerOnFreshPage(context, data, trigger, runDir, DESKTOP));
            if (!probed) continue;
            dialogs.push(probed.dialog);
            allSettings.push(...probed.settings);
            for (const form of probed.forms) {
              const formKey = `${form.fields.map((field) => field.name).join("|")}`;
              if (seenForms.has(formKey)) continue;
              seenForms.add(formKey);
              formErrors.push(form);
            }
            process.stderr.write(`states ${data.label} "${probed.dialog.trigger}" -> ${probed.dialog.kind ?? "geen reactie"}\n`);
          }
        }
      } finally {
        await context.close().catch(() => undefined);
      }
      // Some controls only exist on a narrow screen, such as a menu button. Activate those there.
      const mobile = await contextOfLane(MOBILE);
      try {
        for (const [index, data] of run.pages.entries()) {
          say("knoppen smal", index, run.pages.length, data.label);
          const triggers = await inWindow(data, "knoppen op een smal scherm", [] as Described[], async () => {
            const page = await freshPage(mobile, data);
            const found = await call<Described[]>(page, "triggers");
            await page.close();
            return found;
          });
          for (const trigger of triggers) {
            const key = `${trigger.tag}|${trigger.text.slice(0, 40)}|${trigger.ariaLabel}|${trigger.region}`;
            if (seenTriggers.has(key)) continue;
            seenTriggers.add(key);
            if (logsOut(data.label, trigger)) continue;
            const probed = await withinTime(data.label, `knop "${trigger.text.slice(0, 30)}" (smal)`, null, () => triggerOnFreshPage(mobile, data, trigger, runDir, `${MOBILE.width}x${MOBILE.height}`));
            if (!probed) continue;
            dialogs.push(probed.dialog);
            process.stderr.write(`states ${data.label} smal "${probed.dialog.trigger}" -> ${probed.dialog.kind ?? "geen reactie"}\n`);
          }
        }
      } finally {
        await mobile.close().catch(() => undefined);
      }
      return { dialogs, formErrors, settings: allSettings, triggers: seenTriggers.size };
    };
    const keysOnPages = (): Promise<States["singleKeys"]> => probeSingleKeys(contextOfLane, run.pages);
    const keysInStates = (): Promise<StateKeys[]> => budget.slots.run(() => probeSingleKeysInStates(lane().sweep!));
    // The pointer probes: every page in the default window, one page of each page type in the narrow one, and every state of the model.
    const pointer = async () => {
      // What the test browser itself listens for on an empty page: to be subtracted from every page's count.
      const browserListeners = await budget.slots.run(() => inContext(contextOfLane, undefined, listenersOnEmptyPage));
      const narrowPages = onePagePerType(sweep, run.pages);
      const hovering = new HoverRun(runDir, options.limits?.hover);
      const pressing = new DownRun(options.limits?.down);
      // Pointing and pressing keep their own counts and limits: their pages run next to each other.
      const [hoveredNarrow, pressedOn] = await besideEachOther(
        () => probeHover(contextOfLane, run.pages, narrowPages, hovering),
        () => probeDownEvents(contextOfLane, run.pages, narrowPages, browserListeners, pressing),
      );
      // The counts are those of the pages; what a state added is in its own row.
      const pagesHover = hovering.coverage();
      const pagesDown = { kindsFound: pressing.seen.size + pressing.left.size, examined: pressing.results.length };
      const inStates = await budget.slots.run(() => probePointerInStates(lane().sweep!, hovering, pressing, browserListeners));
      return { browserListeners, hovering, pressing, hoveredNarrow, pressedOn, pagesHover, pagesDown, inStates };
    };
    const arrows = (): Promise<NonNullable<States["arrowFocus"]>> => arrowFocus(contextOfLane, run.pages);
    // Five groups, each in browser contexts of its own. They run one after the other or, with atOnce, at the same time; what they found is taken in this order.
    const groups: (() => Promise<unknown>)[] = [() => budget.slots.run(triggersAndForms), keysOnPages, keysInStates, pointer, arrows];
    const own: Lane[] = groups.map(() => laneOf(mainLane));
    // Within a group the pages run at the same time as well: together never more browsers than atOnce.
    const atOnce = settings.atOnce;
    budget = { atOnce, slots: new Slots(atOnce) };
    if (atOnce > 1) process.stderr.write(`states: ${atOnce} browsers tegelijk, voor de vijf groepen proeven en de pagina's binnen een groep, ${settings.navigationDelayMs} ms tussen twee navigaties naar dezelfde site\n`);
    const found = await withSpacing(settings, () =>
      inOrder<unknown>(
        groups.length,
        atOnce > 1 ? groups.length : 1,
        (index) => lanes.run(own[index]!, () => groups[index]!()),
        (index) => takeLane(mainLane, own[index]!),
      ),
    );
    const [forms, keys, keysStates, pointed, arrowed] = found as [Awaited<ReturnType<typeof triggersAndForms>>, States["singleKeys"], StateKeys[], Awaited<ReturnType<typeof pointer>>, NonNullable<States["arrowFocus"]>];
    result.dialogs = forms.dialogs;
    result.formErrors = forms.formErrors;
    result.examined.triggers = forms.triggers;
    result.examined.forms = forms.formErrors.length;
    result.singleKeys = keys;
    result.singleKeys.states = keysStates;
    result.browserListeners = pointed.browserListeners;
    const { hovering, pressing, pagesHover, pagesDown, inStates } = pointed;
    result.hover = hovering.hover;
    result.examined.hoverTargets = hovering.examined;
    result.hoverContrast = hovering.contrast;
    // A kind that the limit left out is named wherever it was found, on a page or in a state.
    const leftOut = hovering.coverage();
    result.hoverCoverage = { ...pagesHover, notExamined: leftOut.notExamined, notExaminedExamples: leftOut.notExaminedExamples, nonControlsExamined: leftOut.nonControlsExamined, iconOnly: hovering.iconOnly, narrowPages: pointed.hoveredNarrow, states: inStates.hover };
    result.downEvents = pressing.results;
    result.examined.downEventTargets = pressing.results.length;
    result.downEventCoverage = { limit: pressing.limit, ...pagesDown, goneBeforePress: pressing.gone, notExamined: pressing.left.size, notExaminedExamples: [...pressing.left.values()].slice(0, EXAMPLES_NOT_EXAMINED), ...pointed.pressedOn, states: inStates.down };
    result.settings = forms.settings;
    result.arrowFocus = arrowed;
    result.skipped = [...mainLane.skipped];
    if (mainLane.windows.size > 0) result.embedded = [...mainLane.windows.values()];
    // What a probe did not reach because the session ran out is not written down as not there.
    await confirmLogin(browser);
    result.blockers = { closedOnPage: sweep.dismissals.filter((entry) => entry.dismissed).length, notClosed: sweep.dismissals.filter((entry) => !entry.dismissed).map((entry) => ({ url: entry.url, blocker: entry.blocker, reasonNl: entry.reasonNl })) };
    await writeJson(join(runDir, "states.json"), result);
    await writeJson(join(runDir, STATES_STAMP), { pages: pagesNow, states: stateKeys } satisfies StatesStamp);
    await writeManifest(runDir, { command: "states", startedAt, ...result.examined, ...(atOnce > 1 ? { atOnce } : {}) }, browser.version());
  } finally {
    await browser.close();
  }
  return result;
}

/**
 * Take over where one group of probes reached each embedded window, after the groups before it:
 * a window opened on its own once stays so, and what failed in it is added. This is what one list
 * kept by every group in turn would hold.
 */
function takeWindows(into: Map<string, Embedded>, from: Map<string, Embedded>): void {
  for (const [label, entry] of from) {
    const known = into.get(label);
    if (!known) {
      into.set(label, entry);
      continue;
    }
    if (entry.apartNl) Object.assign(known, { inPlaceOn: null, apartNl: entry.apartNl });
    known.failedNl.push(...entry.failedNl);
  }
}
