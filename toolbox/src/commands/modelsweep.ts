import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { call } from "../browser/call.ts";
import { wholePageScreenshot } from "../browser/screenshot.ts";
import { frameAsPage } from "../browser/frame.ts";
import type { WriteGuard } from "../browser/session.ts";
import { collectFacts } from "../instruments/facts.ts";
import { timeLimits, timeLimitsAfterSubmit } from "../instruments/timelimits.ts";
import { pageContrast } from "../instruments/contrast.ts";
import { focusCoveredInState, tabWalk } from "../instruments/keyboard.ts";
import { languagesOf } from "../instruments/languages.ts";
import { picturesWithText, recountRecognised, type PictureCache, type PictureReport } from "../instruments/pictures.ts";
import { visualOrder } from "../instruments/order.ts";
import { controlKey, overflowAtSize, spacingEffect, spacingFromLoad, TEXT_SPACING_NOTE, type ContentInventory, type Control } from "../instruments/overflow.ts";
import { withinTime } from "../instruments/limit.ts";
import { readJson, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { inOrder } from "../lib/atonce.ts";
import { runEngines } from "../lib/engines.ts";
import { frameStanding, loadSiteModel, SITE_MODEL_FILE, type Component, type Postcondition, type SiteModel } from "../lib/sitemodel.ts";
import { blockersKey, readStamp, STATE_STAMP, stateKey } from "../lib/sweepstamp.ts";
import { writesForRun } from "../lib/writes.ts";
import { spokenByItself, type SpokenByItself } from "../instruments/methods/speech.ts";
import type { LastStepSpeech, Recipe } from "../session/daemon.ts";
import { adoptPage, frameAt, holds, installReplay, loadRecipes, onceMoreAfterTimeout, overlays, replayEnv, replayFromClean, replaySteps, type Overlay } from "../session/recipe.ts";
import { openSurface, type Env, type Surface } from "../session/surface.ts";

/** One time a blocker was still on a page of the sweep and had to be closed there. */
export interface Dismissal {
  url: string;
  /** Which part of the sweep loaded the page, e.g. "collect:light". */
  where: string;
  blocker: string;
  dismissed: boolean;
  reasonNl: string | null;
}

export type StateKind = "blocker" | "component" | "process";

/** A state of the site model as the sweep captured it: a blocker still in place, a component opened, a process carried out. */
export interface CapturedState {
  /** Name of the state in dossiers, e.g. "component-hoofdmenu". */
  id: string;
  kind: StateKind;
  modelId: string;
  /** Name of the saved state behind it: what `open --state` takes. Null for a blocker in place, which is the page with `--with-blockers`. */
  recipe?: string | null;
  /** The arguments of `loep open` that bring a session into this state. */
  openWith?: string | null;
  /** Requests that were refused while the state was reached and measured: a write request, or a host outside the run. What needs them did not work. */
  refused?: { kind: string; method: string; address: string; count: number }[];
  /** For a blocker: the page type it was captured on. For a component: the page types it occurs on. */
  pageTypes: string[];
  url: string | null;
  viewport: { width: number; height: number } | null;
  /** Whether the state was reached: the recipe ran and its postcondition held, or the blocker was there. */
  reached: boolean;
  reasonNl: string | null;
  /** Whether the postcondition still held after measuring; measuring presses Tab once and scrolls. */
  stillReachedAfterMeasuring: boolean | null;
  dir: string | null;
  files: Record<string, string>;
  engineSummary: Record<string, number> | null;
  /** Counts of text in front; `behindOverlay` is text that lay behind something else and is left out of the other counts. */
  contrast: { measured: number; failed: number; cantTell: number; behindOverlay?: number } | null;
  largestOverlayShare: number | null;
  /** The same counts on the dark colour scheme, for which the state was opened again. Null for a blocker, which has dark states of its own, and when it did not open. Absent in older runs. */
  contrastDark?: { measured: number; failed: number; cantTell: number; behindOverlay?: number } | null;
  /** What was not measured because the state did not open again: with the wider text spacing in force, or on the dark scheme. */
  variantsNotReached?: { variant: string; reasonNl: string | null }[];
  /**
   * For a state inside an embedded window that counts: the address of the window, and whether the measurements are those
   * of the window (as the sweep measures a window of the sample) or of the page around it, with the reason. Absent for a
   * state on the page itself and in older runs, where the page around the window was measured.
   */
  frame?: { address: string; measuredInFrame: boolean; reasonNl: string | null };
  /** What a simulated screen reader said by itself during the step that opened the state. Absent for a blocker in place, when that step replaced the page, and in older runs. */
  spokenByItself?: SpokenByItself;
  /**
   * For a component: its recipe played on one page of every page type it stands on, in a portrait window. The state
   * itself is measured once, on the page the recipe was recorded on; this says whether the component opens on the
   * other page types too and what it shows there. Absent for a blocker and a process, and in older runs.
   */
  perPageType?: StateInstance[];
  /** Why the first opening stopped when a step of the recipe timed out and the sweep tried once more on a freshly loaded page. Absent when the first attempt decided it. */
  firstTimeoutNl?: string;
}

/** One component opened on one page type, in a portrait window. */
export interface StateInstance {
  pageType: string;
  url: string;
  viewport: { width: number; height: number };
  reached: boolean;
  reasonNl: string | null;
  /** The links and controls that were not there before the recipe ran, by their text, in the order of the code. */
  opened: string[];
  screenshot: string | null;
  /** Elements that carry content and are drawn a quarter turn in this window. */
  rotatedQuarterTurn: number;
  /** Why the first attempt on this page stopped, when a step timed out and the recipe was played once more on a freshly loaded page. */
  firstTimeoutNl?: string;
}

/** The portrait window a component that was recorded in the default window is opened in on each page type. */
export const PORTRAIT = { width: 800, height: 1280 };

/**
 * The portrait window for a component: as wide as the model says it needs to exist at least. A component
 * that only stands from 997 pixels up can never open in a window of 800, so the window grows with it and
 * stays taller than wide.
 */
export function portraitFor(viewport: { minWidth?: number; maxWidth?: number } | null): { width: number; height: number } {
  const minWidth = viewport?.minWidth;
  if (minWidth === undefined || minWidth <= PORTRAIT.width) return PORTRAIT;
  return { width: minWidth, height: Math.max(PORTRAIT.height, Math.round(minWidth * 1.6)) };
}
/** A recipe recorded in a window narrower than this is one of the narrow layout: such a window is portrait already. */
const NARROW_LAYOUT_BELOW = 768;
const INSTANCE_TIMEOUT_MS = 60_000;

/**
 * The window a component is opened in on each of its page types: the portrait window, as wide as
 * the model says the component needs, or the window its recipe was recorded in when that is one
 * of the narrow layout, stretched to a portrait.
 */
export function windowOnPageTypes(recordedIn: { width: number; height: number }, viewport: Component["viewport"]): { width: number; height: number } {
  if (recordedIn.width < NARROW_LAYOUT_BELOW) return { width: recordedIn.width, height: Math.max(recordedIn.height, Math.round(recordedIn.width * 1.6)) };
  return portraitFor(viewport);
}

export interface ComponentOnPage {
  surface: Surface | null;
  reached: boolean;
  reasonNl: string | null;
  /** The links and controls that were not there before the recipe ran, by their text, in the order of the code. */
  opened: string[];
  /** Why the first attempt stopped, when a step timed out and the recipe was played once more on a freshly loaded page. */
  firstTimeoutNl?: string;
}

/**
 * A component's recipe played on another page, in a window of another size, within a time limit.
 * The sweep opens a component on a page of every page type this way, and `check-site` tries the
 * same before the sweep; the two must not drift apart. The caller closes the context of the surface.
 */
export async function openComponentOn(env: Env, recipe: Recipe & { start: NonNullable<Recipe["start"]> }, post: Postcondition | null, url: string, size: { width: number; height: number }, limitMs = INSTANCE_TIMEOUT_MS): Promise<ComponentOnPage> {
  // The work goes on past the limit: every context it opens, also one that only comes after the limit, is closed then.
  const contexts = new Set<BrowserContext>();
  let abandoned = false;
  const keep = (context: BrowserContext): void => {
    contexts.add(context);
    if (abandoned) void context.close().catch(() => undefined);
  };
  const limited = await withinTime(limitMs, async (): Promise<ComponentOnPage> => {
    const result = await onceMoreAfterTimeout(async () => {
      if (abandoned) return { surface: null, ok: false, reasonNl: null, opened: [] as string[] };
      let opened: Surface;
      try {
        ({ surface: opened } = await openSurface(env, { ...recipe.start, url, ...size }, keep));
      } catch (error) {
        return { surface: null, ok: false, reasonNl: `de pagina laadt niet: ${(error as Error).message.split("\n")[0]}`, opened: [] as string[] };
      }
      const before = new Set((await call<Control[]>(opened.page, "hoverTargets").catch(() => [])).map(controlKey));
      const replayed = await replaySteps(env, opened, recipe.steps, post);
      const after = replayed.ok ? await call<Control[]>(opened.page, "hoverTargets").catch(() => []) : [];
      return { surface: opened, ok: replayed.ok, reasonNl: replayed.reasonNl, ...(replayed.timedOut ? { timedOut: true } : {}), opened: after.filter((control) => !before.has(controlKey(control))).map((control) => (control.text || control.ariaLabel || control.tag).slice(0, 60)) };
    });
    return { surface: result.surface, reached: result.ok, reasonNl: result.reasonNl, opened: result.opened, ...(result.firstTimeoutNl !== undefined ? { firstTimeoutNl: result.firstTimeoutNl } : {}) };
  });
  if (limited.ok) return limited.value;
  abandoned = true;
  await Promise.all([...contexts].map((context) => context.close().catch(() => undefined)));
  return { surface: null, reached: false, reasonNl: limited.reason, opened: [] };
}

/** How a state is opened again: on the dark scheme, or with the wider text spacing in force from the first document on. */
export interface StateVariant {
  scheme?: "light" | "dark";
  spaced?: boolean;
  /** Opened again for a walk with the keys: as the first opening, without the reader listening. */
  keys?: boolean;
  /** Opened again to send the form the recipe filled in: as the first opening, without the reader listening. */
  submit?: boolean;
}

/** Steps that fill in a field. A recipe that ends with one leaves its form filled in and not sent. */
const FIELD_COMMANDS = ["type", "select", "paste", "check", "uncheck", "fill"];

/** The selector chains of the fields a recipe fills in, when it ends with filling one in; empty when it sends or opens something last. */
export function filledFields(recipe: Pick<Recipe, "steps"> | undefined): string[][] {
  const steps = recipe?.steps ?? [];
  if (steps.length === 0 || !FIELD_COMMANDS.includes(steps.at(-1)!.command)) return [];
  return steps.filter((step) => FIELD_COMMANDS.includes(step.command) && step.target !== null).map((step) => step.target!);
}

export interface Opened {
  surface: Surface | null;
  reached: boolean;
  reasonNl: string | null;
  post: Postcondition | null;
  /** What was said by itself during the last step of the recipe, on the first opening of a state. */
  spoken?: SpokenByItself;
  /** Why the first attempt stopped, when a step timed out and the recipe was played once more. */
  firstTimeoutNl?: string;
}

/** One state of the model and the way to open it. The caller closes the context of the surface it gets. */
export interface StateOpener {
  base: Pick<CapturedState, "id" | "kind" | "modelId" | "pageTypes" | "recipe" | "openWith">;
  /** False for the other window sizes and schemes of a blocker: a probe that needs each state once takes the primary ones. */
  primary: boolean;
  /** True when the state has a colour scheme of its own, as each variant of a blocker has. */
  ownScheme: boolean;
  startUrl: string | null;
  /** Hash of what a measurement of this state depends on: its recipe and its postcondition. A measurement with the same key is still valid. */
  key: string;
  /** The address of the embedded window the state is in, when the model says the window counts: the state is then measured inside it. */
  frame?: string;
  /** Null when the explorer could not open it; `notOpenedNl` then says why. */
  open: ((how?: StateVariant) => Promise<Opened>) | null;
  /** For a component: play its recipe on another page, in a window of another size. `opened` names the controls that the recipe brought. */
  openOn?: (url: string, size: { width: number; height: number }) => Promise<ComponentOnPage>;
  /** The window the recipe was recorded in. */
  recordedIn?: { width: number; height: number };
  notOpenedNl?: string;
}

const spaced = (context: BrowserContext): void => void spacingFromLoad(context);

export interface SiteStates {
  siteSha256: string;
  /** What was put into every browser context of the sweep so the blockers do not come up: the cookies and stored values their recipes left behind. */
  seeded: { blockers: string[]; cookies: number; storedValues: number };
  /** Blockers that came up anyway and were closed on the page itself. */
  dismissals: Dismissal[];
  /** Write requests pages of the sweep tried to send by themselves and that were refused, as every request other than GET is. Content that loads that way is missing from the evidence. */
  refusedWrites?: { url: string; method: string; address: string; count: number }[];
  states: CapturedState[];
}

export const SITE_STATES_FILE = "site-states.json";
const STATE_TIMEOUT_MS = 180_000;
const STATE_TAB_STOPS = 60;
export const BLOCKER_VARIANTS = [
  { suffix: "", width: 1280, height: 800, scheme: "light" },
  { suffix: "-dark", width: 1280, height: 800, scheme: "dark" },
  { suffix: "-narrow", width: 360, height: 740, scheme: "light" },
  { suffix: "-narrow-dark", width: 360, height: 740, scheme: "dark" },
] as const;

/** For each place: what is painted over the middle of the element there, or null when the element itself is on top. */
async function textBehindSomething(page: Page, places: string[]): Promise<(string | null)[]> {
  return page
    .evaluate((list) => {
      const loep = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; describe: (element: Element) => { path: string[] } } }).__loep;
      const original = [window.scrollX, window.scrollY] as const;
      const related = (first: Node, second: Node): boolean => first === second || first.contains(second) || second.contains(first);
      const found = list.map((place) => {
        const element = loep.resolve(place.split(" >>> "));
        if (!element) return null;
        let rect = element.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > innerHeight) {
          element.scrollIntoView({ block: "center", behavior: "instant" });
          rect = element.getBoundingClientRect();
        }
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!top || related(top, element) || top.shadowRoot) return null;
        // Only something that sits over the page counts: a sibling that overlaps in the normal flow is layout, not a layer.
        for (let node: Element | null = top; node; node = node.parentElement) {
          const position: string = getComputedStyle(node).position;
          if (position === "fixed" || position === "sticky" || node.localName === "dialog" || node.matches(":modal")) return loep.describe(top).path.join(" >>> ");
        }
        return null;
      });
      window.scrollTo(original[0], original[1]);
      return found;
    }, places)
    .catch(() => places.map(() => null));
}

/**
 * Show what the postcondition is about: a menu that opens further down the page is not in the window
 * by itself. A control that opened something is shown with what it opened, and both are kept clear of
 * what is fixed or sticky at the top of the window, such as the bar at the top of a site.
 */
export async function showPostcondition(page: Page, post: Postcondition | null): Promise<void> {
  if (!post?.selector) return;
  // What stands in an embedded frame is brought into view from inside that frame; the tab scrolls along.
  const where = post.frame ? frameAt(page, post.frame) : page;
  await where
    ?.evaluate(
      ([selector, kind]) => {
        const loep = (window as unknown as { __loep: { deepQueryAll: (selector: string) => HTMLElement[]; isVisible: (element: Element) => boolean } }).__loep;
        const visible = loep.deepQueryAll(selector).filter((element) => loep.isVisible(element));
        const opened = kind === "expanded" ? visible.find((element) => element.getAttribute("aria-expanded") === "true" || (element.localName === "details" && (element as HTMLDetailsElement).open)) : undefined;
        const shown = opened ?? visible[0];
        if (!shown) return;
        const own = shown.getBoundingClientRect();
        let [top, bottom] = [own.top, own.bottom];
        if (opened) {
          // What it opened: the elements it controls, or else what follows it in the nearest element around it, such as the list under a category in a sidebar.
          const root = opened.getRootNode() as Document | ShadowRoot;
          const controlled = (opened.getAttribute("aria-controls") ?? "").split(/\s+/).flatMap((id) => {
            const element = id ? root.getElementById(id) : null;
            return element && loep.isVisible(element) ? [element.getBoundingClientRect()] : [];
          });
          for (const rect of controlled) [top, bottom] = [Math.min(top, rect.top), Math.max(bottom, rect.bottom)];
          for (let around = controlled.length === 0 ? opened.parentElement : null; around && around !== document.body; around = around.parentElement) {
            const next = [...around.children].find((child) => loep.isVisible(child) && child.getBoundingClientRect().top >= own.bottom - 1);
            if (!next) continue;
            bottom = Math.max(bottom, next.getBoundingClientRect().bottom);
            break;
          }
        }
        // What already stands in the window, also under a bar at the top, is shown as it is.
        if (top >= 0 && bottom <= innerHeight) return;
        let covered = 0;
        for (const x of [own.left + 1, (own.left + own.right) / 2, own.right - 1].filter((at) => at >= 0 && at < innerWidth)) {
          for (const hit of document.elementsFromPoint(x, 0)) {
            const position = getComputedStyle(hit).position;
            const rect = hit.getBoundingClientRect();
            if ((position === "fixed" || position === "sticky") && !hit.contains(shown) && rect.bottom < innerHeight / 2) covered = Math.max(covered, rect.bottom);
          }
        }
        // Scroll margins make the browser bring the whole part into view, also inside a sidebar that scrolls by itself, below the bar.
        const was = [shown.style.scrollMarginTop, shown.style.scrollMarginBottom] as const;
        shown.style.scrollMarginTop = `${own.top - top + covered}px`;
        shown.style.scrollMarginBottom = `${bottom - own.bottom}px`;
        shown.scrollIntoView({ block: bottom - top > innerHeight - covered ? "start" : "center", behavior: "instant" });
        [shown.style.scrollMarginTop, shown.style.scrollMarginBottom] = was;
      },
      [post.selector, post.kind] as const,
    )
    .catch(() => undefined);
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

interface Storage {
  cookies: Awaited<ReturnType<BrowserContext["storageState"]>>["cookies"];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

/**
 * The sweep as the site model steers it. It closes what covers a page before anything is
 * measured, and captures the states the model describes.
 */
export class ModelSweep {
  readonly model: SiteModel;
  /** Sockets are silenced from the moment a recipe step runs on a page: a click may not send anything. */
  readonly guard: WriteGuard;
  readonly dismissals: Dismissal[] = [];
  private readonly env: Env;
  private readonly runDir: string;
  private readonly recipes: Record<string, Recipe>;
  private readonly storage: Storage;
  private readonly seededBlockers: string[];
  private readonly refusedWrites = new Map<string, NonNullable<SiteStates["refusedWrites"]>[number]>();
  /** Ids of the states an earlier sweep captured and this one kept, because their recipes did not change. */
  readonly reusedStates: string[] = [];
  /** What text recognition read per picture in this sweep: the same picture on another page or in a state is read once. */
  readonly pictureCache: PictureCache;

  private constructor(runDir: string, env: Env, model: SiteModel, recipes: Record<string, Recipe>, guard: WriteGuard, shared?: { storage: Storage; seededBlockers: string[]; pictureCache: PictureCache }) {
    this.runDir = runDir;
    this.env = env;
    this.model = model;
    this.recipes = recipes;
    this.guard = guard;
    this.storage = shared?.storage ?? { cookies: [], origins: [] };
    this.seededBlockers = shared?.seededBlockers ?? [];
    this.pictureCache = shared?.pictureCache ?? new Map();
  }

  /**
   * The same sweep for one page, pass or group of probes that runs next to others: the same model,
   * recipes, seeded cookies and pictures read, but a guard of its own, so that one page that silences
   * its sockets does not let another speak, and notes of its own. `absorb` takes the notes over, in
   * the order the pages have, so that they read as they do with one page after the other.
   */
  fork(): ModelSweep {
    return new ModelSweep(this.runDir, this.env, this.model, this.recipes, { active: false, blocked: 0 }, { storage: this.storage, seededBlockers: this.seededBlockers, pictureCache: this.pictureCache });
  }

  /** Take over what a fork noted: the blockers it closed, the write requests it refused and the socket messages it held back. */
  absorb(fork: ModelSweep): void {
    this.restore(fork.since({ dismissals: 0, refused: new Map() }));
    this.guard.blocked += fork.guard.blocked;
  }

  /** Throws when the run has no site model, or has one that was not checked. */
  static async load(runDir: string, browser: Browser, guard: WriteGuard = { active: false, blocked: 0 }): Promise<ModelSweep> {
    const model = await loadSiteModel(runDir);
    if (!model) throw new Error(`${runDir} heeft geen sitemodel (${SITE_MODEL_FILE}): verken de site eerst met explore en check-site`);
    const sweep = new ModelSweep(runDir, await replayEnv(browser, runDir), model, await loadRecipes(runDir), guard);
    await sweep.seed();
    return sweep;
  }

  /**
   * Close every blocker once on a clean page and keep the cookies and stored values that
   * leaves behind. A browser context that starts with those is a visitor who made the
   * choice before: the blocker does not come up and the page is measured undisturbed.
   */
  private async seed(): Promise<void> {
    for (const blocker of this.model.blockers) {
      const replay = await replayFromClean(this.env, this.recipes[blocker.recipe]!, blocker.postcondition);
      try {
        if (!replay.ok || !replay.surface) {
          process.stderr.write(`sitemodel: blokkade ${blocker.id} sluit niet meer: ${replay.reasonNl}\n`);
          continue;
        }
        const state = await replay.surface.context.storageState();
        for (const cookie of state.cookies) if (!this.storage.cookies.some((known) => known.name === cookie.name && known.domain === cookie.domain && known.path === cookie.path)) this.storage.cookies.push(cookie);
        for (const origin of state.origins) {
          const known = this.storage.origins.find((entry) => entry.origin === origin.origin);
          if (!known) this.storage.origins.push({ origin: origin.origin, localStorage: [...origin.localStorage] });
          else for (const item of origin.localStorage) if (!known.localStorage.some((other) => other.name === item.name)) known.localStorage.push(item);
        }
        this.seededBlockers.push(blocker.id);
      } finally {
        await replay.surface?.context.close().catch(() => undefined);
      }
    }
  }

  /** Hash of the part of the model every page in its default state depends on: the blockers and their recipes. */
  get blockersKey(): string {
    return blockersKey(this.model.blockers, this.recipes);
  }

  /** Where the notes about pages stand now: which blockers were closed on a page and which write requests were refused. */
  mark(): { dismissals: number; refused: Map<string, number> } {
    return { dismissals: this.dismissals.length, refused: new Map([...this.refusedWrites].map(([key, entry]) => [key, entry.count])) };
  }

  /** What was noted since a mark: what one page added. */
  since(mark: ReturnType<ModelSweep["mark"]>): { dismissals: Dismissal[]; refusedWrites: NonNullable<SiteStates["refusedWrites"]> } {
    const refusedWrites = [...this.refusedWrites].filter(([key, entry]) => entry.count > (mark.refused.get(key) ?? 0)).map(([key, entry]) => ({ ...entry, count: entry.count - (mark.refused.get(key) ?? 0) }));
    return { dismissals: this.dismissals.slice(mark.dismissals), refusedWrites };
  }

  /** Forget what was noted since a mark: a page that was only loaded to see whether it changed is not a page of the sweep. */
  rewind(mark: ReturnType<ModelSweep["mark"]>): void {
    this.dismissals.length = mark.dismissals;
    for (const [key, entry] of [...this.refusedWrites]) {
      if (!mark.refused.has(key)) this.refusedWrites.delete(key);
      else entry.count = mark.refused.get(key)!;
    }
  }

  /** Take over what an earlier sweep noted for a page whose measurements are kept. */
  restore(noted: { dismissals: Dismissal[]; refusedWrites: NonNullable<SiteStates["refusedWrites"]> }): void {
    this.dismissals.push(...noted.dismissals);
    for (const entry of noted.refusedWrites) {
      const key = `${entry.url} ${entry.method} ${entry.address}`;
      const known = this.refusedWrites.get(key) ?? { ...entry, count: 0 };
      known.count += entry.count;
      this.refusedWrites.set(key, known);
    }
  }

  /** Prepare a browser context of the sweep, before its first page is created. */
  /** The cookies closing the notices left behind, which every context of the sweep starts with. */
  get seededCookies(): { name: string; domain: string; path: string }[] {
    return this.storage.cookies.map(({ name, domain, path }) => ({ name, domain, path }));
  }

  async install(context: BrowserContext): Promise<void> {
    this.guard.active = false;
    await installReplay(context);
    // The sweep refuses every request that is not a GET. Note which pages wanted one: what they load that way is not there.
    context.on("requestfailed", (request) => {
      if (request.method() === "GET" || request.method() === "HEAD") return;
      try {
        const url = request.frame().page().url();
        const target = new URL(request.url());
        const key = `${url} ${request.method()} ${target.host}${target.pathname}`;
        const known = this.refusedWrites.get(key) ?? { url, method: request.method(), address: `${target.host}${target.pathname}`, count: 0 };
        known.count++;
        this.refusedWrites.set(key, known);
      } catch {
        // The page is gone already; nothing to attribute the request to.
      }
    });
    if (this.storage.cookies.length > 0) await context.addCookies(this.storage.cookies);
    if (this.storage.origins.length > 0) {
      await context.addInitScript((origins) => {
        const own = origins.find((entry) => entry.origin === location.origin);
        if (!own) return;
        try {
          for (const item of own.localStorage) if (localStorage.getItem(item.name) === null) localStorage.setItem(item.name, item.value);
        } catch {
          // Storage is not available in this frame; the blocker is then closed on the page itself.
        }
      }, this.storage.origins);
    }
  }

  /**
   * After a page of the sweep has loaded: close whatever blocker is still there, on the
   * page itself. Leaves the page scrolled to the top with focus on nothing, as a fresh page is.
   */
  async dismiss(context: BrowserContext, page: Page, where: string, scheme: "light" | "dark" = "light"): Promise<void> {
    let surface: Surface | null = null;
    for (const blocker of this.model.blockers) {
      if ((await holds(page, blocker.postcondition)).holds) continue;
      this.guard.active = true;
      surface ??= adoptPage(context, page, scheme);
      // A recipe that went on to another page did so after the blocker was closed; only the steps before that belong here.
      const steps = this.recipes[blocker.recipe]!.steps;
      const own = steps.slice(0, steps.findIndex((step) => step.command === "goto") === -1 ? steps.length : steps.findIndex((step) => step.command === "goto"));
      const replay = await replaySteps(this.env, surface, own, blocker.postcondition);
      this.dismissals.push({ url: page.url(), where, blocker: blocker.id, dismissed: replay.ok, reasonNl: replay.reasonNl });
      if (!replay.ok) process.stderr.write(`sitemodel: blokkade ${blocker.id} niet gesloten op ${page.url()} (${where}): ${replay.reasonNl}\n`);
    }
    if (!surface) return;
    await page
      .evaluate(() => {
        // A browser continues the Tab order from where focus last was, also after a blur: put it on the body for a moment.
        const previous = document.body.getAttribute("tabindex");
        document.body.setAttribute("tabindex", "-1");
        document.body.focus({ preventScroll: true });
        if (previous === null) document.body.removeAttribute("tabindex");
        else document.body.setAttribute("tabindex", previous);
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);
    await page.mouse.move(0, 0).catch(() => undefined);
  }

  /** The fixed and sticky elements of a page as the sweep measures it, for the evidence gate. */
  overlays(page: Page): Promise<Overlay[]> {
    return overlays(page);
  }

  /** Where a measurement of a state is written; the file is noted in the state's list of files. */
  private fileIn(id: string, files: Record<string, string>): (key: string, name: string) => string {
    const dir = join("site-states", id);
    return (key, name) => {
      files[key] = join(dir, name);
      return join(this.runDir, dir, name);
    };
  }

  /** Contrast of the page as it is now, with the counts of text in front. */
  private async contrastOf(page: Page): Promise<{ contrast: Awaited<ReturnType<typeof pageContrast>>; counts: NonNullable<CapturedState["contrast"]> }> {
    const contrast = await pageContrast(page);
    // Text that something else is painted over, such as the page behind an open dialog and its dimming layer, was not measured as a visitor sees it.
    const behind = await textBehindSomething(page, contrast.measurements.map((entry) => entry.where));
    contrast.measurements.forEach((entry, index) => {
      if (behind[index]) (entry as typeof entry & { behindOverlay?: string }).behindOverlay = behind[index]!;
    });
    const inFront = contrast.measurements.filter((entry) => !(entry as { behindOverlay?: string }).behindOverlay);
    const count = (outcome: string): number => inFront.filter((entry) => entry.outcome === outcome).length;
    return { contrast, counts: { measured: inFront.length, failed: count("failed"), cantTell: count("cantTell"), behindOverlay: contrast.measurements.length - inFront.length } };
  }

  /**
   * What a state is measured on: the page, or for a state inside an embedded window that counts
   * the window as a page, the way the sweep measures a window of the sample. When the window is
   * not there or cannot be read, the page around it is measured and the reason is kept.
   */
  private async viewOf(page: Page, address: string | undefined): Promise<{ view: Page; frame?: NonNullable<CapturedState["frame"]> }> {
    if (!address) return { view: page };
    const frame = frameAt(page, address);
    const readable = frame ? await frame.evaluate(() => typeof (window as unknown as { __loep?: unknown }).__loep === "object" && document.body !== null).catch(() => false) : false;
    if (frame && readable) {
      const view = await frameAsPage(page, frame).catch(() => null);
      if (view) return { view, frame: { address, measuredInFrame: true, reasonNl: null } };
    }
    return { view: page, frame: { address, measuredInFrame: false, reasonNl: frame ? "het venster was niet te lezen; gemeten is de pagina eromheen" : "het venster stond bij het meten niet op de pagina; gemeten is de pagina eromheen" } };
  }

  /** `outer` is the tab: the postcondition is checked from there. `page` is what is measured: the tab, or an embedded window as a page. */
  private async measure(outer: Page, page: Page, id: string, post: Postcondition | null, files: Record<string, string>): Promise<Pick<CapturedState, "dir" | "files" | "engineSummary" | "contrast" | "largestOverlayShare" | "stillReachedAfterMeasuring"> & { clippedBefore: { path: string[] }[] }> {
    const dir = join("site-states", id);
    const absolute = join(this.runDir, dir);
    const file = this.fileIn(id, files);
    await showPostcondition(outer, post);
    await page.screenshot({ path: file("screenshot", "screenshot.png"), animations: "disabled" });
    await wholePageScreenshot(page, { path: file("screenshotFullPage", "screenshot-full.png") });
    const covering = await overlays(page);
    await writeJson(file("overlays", "overlays.json"), covering);
    const engines = await runEngines(page);
    await writeJson(file("engines", "engines.json"), engines);
    await writeJson(file("facts", "facts.json"), await collectFacts(page));
    await writeFileAtomic(file("accessibilityTree", "aria.yaml"), `${await page.locator("body").ariaSnapshot()}\n`);
    await writeJson(file("targets", "targets.json"), await call(page, "targetSizes"));
    // What is cut off in this state as it is: the wider text spacing is compared with this, on the state opened again.
    const clippedBefore = (await call<{ clipped: { path: string[] }[] }>(page, "overflowReport")).clipped;
    const { contrast, counts } = await this.contrastOf(page);
    await writeJson(file("contrast", "contrast.json"), contrast);
    const stillReached = post ? (await holds(outer, post)).holds : null;
    // The measurements that resize the window come after the ones that count most: they can close what was opened, and say so.
    const stillThere = async (): Promise<boolean | null> => (post ? (await holds(outer, post)).holds : null);
    const extra = async (key: string, name: string, work: () => Promise<Record<string, unknown>>): Promise<void> => {
      try {
        await writeJson(file(key, name), { ...(await work()), stateStillReachedAfterwards: await stillThere() });
      } catch (error) {
        delete files[key];
        process.stderr.write(`sitemodel: ${id} ${key} niet gemeten: ${(error as Error).message.split("\n")[0]}\n`);
      }
    };
    const size = page.viewportSize() ?? DEFAULT_VIEWPORT;
    await extra("order", "order.json", async () => ({ ...(await visualOrder(page)) }));
    // The text of the opened state, and the language of that text and of every text alternative and name in it (3.1.2).
    await writeFileAtomic(file("text", "text.txt"), `${await call<string>(page, "bodyText")}\n`);
    await extra("languages", "languages.json", async () => ({ ...(await languagesOf(page, { blocks: true })) }));
    // Every picture in the state, cut out and read with text recognition (1.1.1, 1.4.5): a picture a page had is not read again.
    await extra("pictures", "pictures.json", async () => ({ ...(await picturesWithText(page, join(absolute, "pictures"), join(dir, "pictures"), this.pictureCache)) }));
    await extra("reflow", "reflow.json", async () => {
      const measured = await overflowAtSize(page, { width: 320, height: 256 }, file("reflowScreenshot", "reflow.png"));
      return { viewport: { width: 320, height: 256 }, ...measured.report, visibleControls: measured.visibleControls };
    });
    await extra("zoom200", "zoom200.json", async () => {
      const half = { width: Math.round(size.width / 2), height: Math.round(size.height / 2) };
      const measured = await overflowAtSize(page, half, file("zoom200Screenshot", "zoom200.png"));
      return { viewport: half, ...measured.report, visibleControls: measured.visibleControls };
    });
    // The Tab walk comes last: it moves focus, which can close what was opened. It starts where focus is, so inside an opened dialog it stays there.
    await writeJson(file("tabwalk", "tabwalk.json"), await tabWalk(page, { continueAfterFocusLoss: true, focusDir: join(absolute, "focus"), focusPath: join(dir, "focus"), maxStops: STATE_TAB_STOPS }));
    // What can be a time limit in this state (2.2.1). Waiting timers are set off, which changes the page: after everything else.
    await extra("timeLimits", "timelimits.json", async () => ({ ...(await timeLimits(page, this.seededCookies)) }));
    return { dir, files, engineSummary: engines.summary, contrast: counts, largestOverlayShare: covering[0]?.share ?? 0, stillReachedAfterMeasuring: stillReached, clippedBefore };
  }

  /**
   * The state opened again for what the first opening cannot show: with the wider text
   * spacing in force before the first step of the recipe, and on the dark colour scheme.
   */
  private async reopened(opener: StateOpener, open: (how: StateVariant) => Promise<Opened>, files: Record<string, string>, clippedBefore: { path: string[] }[]): Promise<Pick<CapturedState, "contrastDark" | "variantsNotReached">> {
    const file = this.fileIn(opener.base.id, files);
    const notReached: NonNullable<CapturedState["variantsNotReached"]> = [];
    const wide = await open({ spaced: true });
    if (wide.reached && wide.surface) {
      await showPostcondition(wide.surface.page, wide.post);
      const effect = await spacingEffect((await this.viewOf(wide.surface.page, opener.frame)).view, clippedBefore, file("textSpacingScreenshot", "textspacing.png"));
      await writeJson(file("textSpacing", "textspacing.json"), { ...effect, appliedBeforeOpening: true, reachedWithSpacing: true, stateStillReachedAfterwards: wide.post ? (await holds(wide.surface.page, wide.post)).holds : null });
    } else {
      // A state that does not open any more with the wider spacing is itself what the measurement found.
      notReached.push({ variant: "textSpacing", reasonNl: wide.reasonNl });
      await writeJson(file("textSpacing", "textspacing.json"), { note: TEXT_SPACING_NOTE, appliedBeforeOpening: true, reachedWithSpacing: false, reasonNl: wide.reasonNl });
    }
    await wide.surface?.context.close().catch(() => undefined);
    // Back with Shift+Tab and along with the arrow keys from where focus is after opening: does a fixed bar cover what has focus (2.4.11)?
    const keys = await open({ keys: true });
    if (keys.reached && keys.surface) {
      const { view } = await this.viewOf(keys.surface.page, opener.frame);
      const walked = await focusCoveredInState(view, join(this.runDir, "site-states", opener.base.id, "focus-covered"), join("site-states", opener.base.id, "focus-covered"));
      await writeJson(file("focusCovered", "focus-covered.json"), { ...walked, stateStillReachedAfterwards: keys.post ? (await holds(keys.surface.page, keys.post)).holds : null });
    } else notReached.push({ variant: "focusCovered", reasonNl: keys.reasonNl });
    await keys.surface?.context.close().catch(() => undefined);
    // A form the recipe filled in and did not send: sent now, as a visitor does, and the timers that starts measured (2.2.1).
    const fields = filledFields(opener.base.recipe ? this.recipes[opener.base.recipe] : undefined);
    if (fields.length > 0) {
      const sent = await open({ submit: true });
      if (sent.reached && sent.surface) {
        const { view } = await this.viewOf(sent.surface.page, opener.frame);
        const permission = writesForRun(this.runDir);
        const mayWrite = (url: string): boolean => permission !== null && URL.canParse(url) && new URL(url).origin === permission.origin;
        try {
          await writeJson(file("timeLimitsAfterSubmit", "timelimits-after-submit.json"), { ...(await timeLimitsAfterSubmit(view, fields, mayWrite, this.seededCookies)) });
        } catch (error) {
          delete files["timeLimitsAfterSubmit"];
          notReached.push({ variant: "timeLimitsAfterSubmit", reasonNl: `versturen en meten mislukte: ${(error as Error).message.split("\n")[0]}` });
        }
      } else notReached.push({ variant: "timeLimitsAfterSubmit", reasonNl: sent.reasonNl });
      await sent.surface?.context.close().catch(() => undefined);
    }
    // A blocker has dark states of its own.
    if (opener.ownScheme) return { contrastDark: null, ...(notReached.length > 0 ? { variantsNotReached: notReached } : {}) };
    let contrastDark: CapturedState["contrastDark"] = null;
    const dark = await open({ scheme: "dark" });
    if (dark.reached && dark.surface) {
      await showPostcondition(dark.surface.page, dark.post);
      const { view } = await this.viewOf(dark.surface.page, opener.frame);
      await view.screenshot({ path: file("screenshotDark", "screenshot-dark.png"), animations: "disabled" });
      const { contrast, counts } = await this.contrastOf(view);
      await writeJson(file("contrastDark", "contrast-dark.json"), contrast);
      contrastDark = counts;
    } else notReached.push({ variant: "contrastDark", reasonNl: dark.reasonNl });
    await dark.surface?.context.close().catch(() => undefined);
    return { contrastDark, ...(notReached.length > 0 ? { variantsNotReached: notReached } : {}) };
  }

  private async capture(opener: StateOpener & { open: NonNullable<StateOpener["open"]> }): Promise<CapturedState> {
    const { base } = opener;
    const empty = { url: null, viewport: null, stillReachedAfterMeasuring: null, dir: null, files: {}, engineSummary: null, contrast: null, largestOverlayShare: null };
    const surfaces: Surface[] = [];
    const open = async (how: StateVariant = {}): Promise<Opened> => {
      const opened = await opener.open(how);
      if (opened.surface) surfaces.push(opened.surface);
      return opened;
    };
    let clippedBefore: { path: string[] }[] = [];
    const limited = await withinTime(STATE_TIMEOUT_MS, async (): Promise<CapturedState> => {
      const opened = await open();
      const where = { url: opened.surface?.page.url() ?? null, viewport: opened.surface?.page.viewportSize() ?? null, ...(opened.firstTimeoutNl !== undefined ? { firstTimeoutNl: opened.firstTimeoutNl } : {}) };
      if (!opened.reached || !opened.surface) return { ...base, ...empty, ...where, reached: false, reasonNl: opened.reasonNl };
      const { view, frame } = await this.viewOf(opened.surface.page, opener.frame);
      const { clippedBefore: clipped, ...measured } = await this.measure(opened.surface.page, view, base.id, opened.post, {});
      clippedBefore = clipped;
      return { ...base, ...where, reached: true, reasonNl: null, ...measured, ...(frame ? { frame } : {}), ...(opened.spoken ? { spokenByItself: opened.spoken } : {}) };
    });
    const refusals = new Map<string, NonNullable<CapturedState["refused"]>[number]>();
    for (const entry of surfaces[0]?.guard.blocked ?? []) {
      let address = entry.url;
      try {
        const parsed = new URL(entry.url.split(" ")[0]!);
        address = `${parsed.host}${parsed.pathname}`;
      } catch {
        // Kept as it was recorded.
      }
      const key = `${entry.kind} ${entry.method} ${address}`;
      refusals.set(key, { kind: entry.kind, method: entry.method, address, count: (refusals.get(key)?.count ?? 0) + 1 });
    }
    const state: CapturedState = { ...(limited.ok ? limited.value : { ...base, ...empty, reached: false, reasonNl: limited.reason }), refused: [...refusals.values()].sort((a, b) => b.count - a.count).slice(0, 20) };
    if (state.reached) {
      // A limit of its own: what the first opening measured stands, whatever happens here.
      const again = await withinTime(STATE_TIMEOUT_MS, () => this.reopened(opener, open, state.files, clippedBefore));
      Object.assign(state, again.ok ? again.value : { contrastDark: null, variantsNotReached: ["textSpacing", "focusCovered", "contrastDark", ...(filledFields(opener.base.recipe ? this.recipes[opener.base.recipe] : undefined).length > 0 ? ["timeLimitsAfterSubmit"] : [])].filter((variant) => !state.files[variant] && !(variant === "contrastDark" && opener.ownScheme)).map((variant) => ({ variant, reasonNl: again.reason })) });
    }
    for (const surface of surfaces) await surface.context.close().catch(() => undefined);
    process.stderr.write(`sitemodel: ${state.id} ${state.reached ? "vastgelegd" : `niet bereikt: ${state.reasonNl}`}${state.firstTimeoutNl !== undefined ? ` (tweede poging; de eerste stopte op een time-out: ${state.firstTimeoutNl})` : ""}\n`);
    return state;
  }

  /**
   * Every state of the model with the way to open it: each blocker as it stands on the page
   * its recipe was recorded on, wide and narrow, light and dark, and each component and
   * process as its recipe opens it. The sweep and the probes open a state through this, and no other way.
   */
  openers(): StateOpener[] {
    const list: StateOpener[] = [];
    for (const blocker of this.model.blockers) {
      const url = this.recipes[blocker.recipe]!.start?.url ?? this.model.baseUrl;
      for (const variant of BLOCKER_VARIANTS) {
        const options = `${variant.width === DEFAULT_VIEWPORT.width ? "" : ` --width ${variant.width}`}${variant.scheme === "light" ? "" : ` --scheme ${variant.scheme}`}`;
        list.push({
          base: { id: `blocker-${blocker.id}${variant.suffix}`, kind: "blocker", modelId: blocker.id, pageTypes: this.model.pageTypes.map((type) => type.id), recipe: null, openWith: `${url} --with-blockers${options}` },
          primary: variant.suffix === "",
          ownScheme: true,
          startUrl: url,
          key: stateKey({ id: `blocker-${blocker.id}${variant.suffix}`, kind: "blocker", startUrl: url }, blocker.postcondition, this.recipes[blocker.recipe]),
          open: async (how = {}) => {
            // A clean context: nothing seeded, so the blocker comes up as it does for a first visit.
            const { surface } = await openSurface(this.env, { url, width: variant.width, height: variant.height, scheme: variant.scheme }, how.spaced ? spaced : undefined);
            const gone = await holds(surface.page, blocker.postcondition);
            return { surface, reached: !gone.holds, reasonNl: gone.holds ? `de blokkade staat niet op deze pagina (${gone.detail})` : null, post: null };
          },
        });
      }
    }
    for (const [kind, entries] of [["component", this.model.components], ["process", this.model.processes]] as const) {
      for (const entry of entries) {
        // The state carries the name of its recipe: the one name a judge can also give to `open --state`.
        const base = { id: entry.recipe ?? `${kind}-${entry.id}`, kind, modelId: entry.id, pageTypes: "pageTypes" in entry ? entry.pageTypes : [], recipe: entry.recipe, openWith: entry.recipe === null ? null : `--state ${entry.recipe}` };
        if (entry.recipe === null) {
          list.push({ base, primary: true, ownScheme: false, startUrl: null, key: "", open: null, notOpenedNl: (entry as { notOpenedNl?: string }).notOpenedNl ?? "" });
          continue;
        }
        const recipe = this.recipes[entry.recipe]!;
        // A state inside an embedded window that counts is measured in that window, not on the page around it.
        const address = (entry as { frame?: string }).frame ?? entry.postcondition?.frame;
        const inFrame = address !== undefined && this.model.frames.some((frame) => frame.address === address && frameStanding(frame).counts);
        list.push({
          base,
          primary: true,
          ownScheme: false,
          ...(inFrame ? { frame: address } : {}),
          startUrl: recipe.start?.url ?? null,
          ...(kind === "component" && recipe.start
            ? {
                recordedIn: { width: recipe.start.width, height: recipe.start.height },
                openOn: (url: string, size: { width: number; height: number }) => openComponentOn(this.env, { ...recipe, start: recipe.start! }, entry.postcondition, url, size),
              }
            : {}),
          key: stateKey({ id: base.id, kind, startUrl: recipe.start?.url ?? null }, entry.postcondition, recipe),
          open: async (how = {}) => {
            // The reader listens once, on the opening that is measured; the other openings repeat it for another scheme or spacing.
            const speech: LastStepSpeech | undefined = how.scheme || how.spaced || how.keys || how.submit ? undefined : { heard: [] };
            const replay = await onceMoreAfterTimeout(() => {
              // What the reader heard on an attempt that stopped does not belong to the opening that counts.
              if (speech) speech.heard.length = 0;
              return replayFromClean(this.env, recipe, entry.postcondition, how.scheme ? { scheme: how.scheme } : {}, how.spaced ? spaced : undefined, speech);
            });
            return { surface: replay.surface, reached: replay.ok, reasonNl: replay.reasonNl, post: entry.postcondition, ...(speech && speech.heard.length > 0 ? { spoken: spokenByItself(speech.heard) } : {}), ...(replay.firstTimeoutNl !== undefined ? { firstTimeoutNl: replay.firstTimeoutNl } : {}) };
          },
        });
      }
    }
    return list;
  }

  /**
   * A component on one page of every page type it stands on, in a portrait window: does it open
   * there and what does it show. What an earlier sweep found for a page type is kept.
   */
  private async instances(opener: StateOpener, state: CapturedState): Promise<StateInstance[]> {
    const rows: StateInstance[] = [];
    const openOn = opener.openOn;
    if (!openOn || !opener.recordedIn) return rows;
    const size = windowOnPageTypes(opener.recordedIn, this.model.components.find((component) => component.id === opener.base.modelId)?.viewport ?? null);
    for (const typeId of state.pageTypes) {
      const type = this.model.pageTypes.find((entry) => entry.id === typeId);
      if (!type) continue;
      const known = state.perPageType?.find((entry) => entry.pageType === typeId && entry.url === type.representative && entry.reached);
      if (known) {
        rows.push(known);
        continue;
      }
      const base = { pageType: typeId, url: type.representative, viewport: size };
      const shot = join("site-states", state.id, "types", `${typeId.replace(/[^a-z0-9-]/gi, "_")}.png`);
      let surface: Surface | null = null;
      const limited = await withinTime(INSTANCE_TIMEOUT_MS, async (): Promise<StateInstance> => {
        const opened = await openOn(type.representative, size);
        surface = opened.surface;
        const retried = opened.firstTimeoutNl !== undefined ? { firstTimeoutNl: opened.firstTimeoutNl } : {};
        if (retried.firstTimeoutNl !== undefined) process.stderr.write(`sitemodel: ${state.id} op ${typeId}: tweede poging na een time-out (${retried.firstTimeoutNl})\n`);
        if (!opened.reached || !opened.surface) return { ...base, reached: false, reasonNl: opened.reasonNl, opened: [], screenshot: null, rotatedQuarterTurn: 0, ...retried };
        await opened.surface.page.screenshot({ path: join(this.runDir, shot), animations: "disabled" });
        const content = await call<ContentInventory>(opened.surface.page, "contentInventory");
        return { ...base, reached: true, reasonNl: null, opened: opened.opened, screenshot: shot, rotatedQuarterTurn: content.rotatedQuarterTurn.length, ...retried };
      });
      await (surface as Surface | null)?.context.close().catch(() => undefined);
      rows.push(limited.ok ? limited.value : { ...base, reached: false, reasonNl: limited.reason, opened: [], screenshot: null, rotatedQuarterTurn: 0 });
    }
    process.stderr.write(`sitemodel: ${state.id} op ${rows.filter((row) => row.reached).length} van ${rows.length} paginatypen geopend in een staand venster\n`);
    return rows;
  }

  /**
   * Capture every state of the model once. A state an earlier sweep captured with the same
   * recipe and postcondition is kept as it is; with `fresh` every state is captured again.
   * With `atOnce` more than one state is captured at the same time; what is written is the same.
   * `seenPictures` holds the pictures the pages of this sweep read: a state counts a picture as read only when no page did.
   */
  async captureStates(options: { fresh?: boolean; atOnce?: number; seenPictures?: Set<string> } = {}): Promise<CapturedState[]> {
    const openers = this.openers();
    const root = join(this.runDir, "site-states");
    // What an earlier sweep captured under names the model no longer has must not linger next to the new states.
    if (options.fresh) await rm(root, { recursive: true, force: true });
    else for (const name of existsSync(root) ? await readdir(root) : []) if (!openers.some((opener) => opener.base.id === name)) await rm(join(root, name), { recursive: true, force: true });
    const captured = await inOrder(openers.length, options.atOnce ?? 1, (index) => this.captureOne(openers[index]!, root), (_, entry) => void (entry.reused && this.reusedStates.push(entry.state.id)));
    // A picture that two states read at the same time counts where it would have with one state after the other.
    const seen = options.seenPictures ?? new Set<string>();
    for (const { state, reused } of captured) {
      const path = state.files.pictures;
      if (reused || !path || !existsSync(join(this.runDir, path))) continue;
      const report = await readJson<PictureReport & Record<string, unknown>>(join(this.runDir, path));
      if (recountRecognised([report], seen).length > 0) await writeJson(join(this.runDir, path), report);
    }
    return captured.map((entry) => entry.state);
  }

  /** One state: kept from an earlier sweep, or captured now. */
  private async captureOne(opener: StateOpener, root: string): Promise<{ state: CapturedState; reused: boolean }> {
    if (!opener.open) {
      return { state: { ...opener.base, refused: [], url: null, viewport: null, reached: false, reasonNl: `de verkenner kon het niet openen: ${opener.notOpenedNl ?? ""}`, stillReachedAfterMeasuring: null, dir: null, files: {}, engineSummary: null, contrast: null, largestOverlayShare: null }, reused: false };
    }
    const stampPath = join(root, opener.base.id, STATE_STAMP);
    const stamp = await readStamp<{ key: string; state: CapturedState }>(stampPath);
    let state: CapturedState;
    const reused = stamp !== null && stamp.key === opener.key && stamp.state.reached;
    if (reused) {
      // The measurement stands; what the model says about the state (the page types it belongs to) is taken from the model as it is now.
      state = { ...stamp.state, ...opener.base };
      process.stderr.write(`sitemodel: ${state.id} al vastgelegd met dit recept, niet opnieuw gemeten\n`);
    } else {
      await rm(join(root, opener.base.id), { recursive: true, force: true });
      state = await this.capture({ ...opener, open: opener.open });
      // A state that did not open is tried again by the next sweep.
      if (state.reached) await writeJson(stampPath, { key: opener.key, state });
    }
    // A component on each page type it stands on; the measurement of the state itself stands as it is.
    if (state.reached && state.kind === "component") {
      const before = JSON.stringify(state.perPageType ?? null);
      state.perPageType = await this.instances(opener, state);
      if (JSON.stringify(state.perPageType) !== before) await writeJson(stampPath, { key: opener.key, state });
    }
    // A process belongs to the page type it ends on, or else the one it started on.
    if (state.pageTypes.length === 0) {
      const typeOf = (url: string | null | undefined): string | undefined => this.model.pageTypes.find((type) => url !== null && url !== undefined && type.pages.includes(url))?.id;
      const type = typeOf(state.url) ?? typeOf(opener.startUrl);
      if (type) state.pageTypes = [type];
    }
    return { state, reused };
  }

  async write(states: CapturedState[]): Promise<SiteStates> {
    const result: SiteStates = {
      siteSha256: await sha256File(join(this.runDir, SITE_MODEL_FILE)),
      seeded: { blockers: this.seededBlockers, cookies: this.storage.cookies.length, storedValues: this.storage.origins.reduce((sum, origin) => sum + origin.localStorage.length, 0) },
      dismissals: this.dismissals,
      refusedWrites: [...this.refusedWrites.values()].sort((a, b) => a.url.localeCompare(b.url) || a.address.localeCompare(b.address)),
      states,
    };
    await writeJson(join(this.runDir, SITE_STATES_FILE), result);
    return result;
  }
}
