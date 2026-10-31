import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { regionScreenshot } from "../browser/screenshot.ts";
import { agreementLine, measuredBy, type Measured, type MethodFailure, type MethodResult } from "../instruments/methods.ts";
import { chromiumBackgrounds, CONTRAST_RULES, computedContrast, contrastSummary, engineOpinions, focusStyles, ownMethod, styleChange, TARGET_RULES, verdictDifferences, withoutOpinion, type EngineOpinion, type Verdict } from "../instruments/methods/element.ts";
import { detectLanguages, languageDifferences, languagePieces, languageVerdicts, markKnownLanguages, type LanguagePiece } from "../instruments/methods/lang.ts";
import { apiMotion, changedBetween, pixelMotion } from "../instruments/methods/motion.ts";
import { overflowGeometryAtSize, textSpacing } from "../instruments/overflow.ts";
import { groupAnswers, markKnownNames, nameDifferences, namesOf, sayName, type NameAnswer } from "../instruments/methods/names.ts";
import { fileAsShown, imageTextContrast, pointedContrast, type ImageTextAnswer, type ImageTextLine, type PointedAnswer } from "../instruments/methods/imagetext.ts";
import { ocr, overlap, type OcrAnswer } from "../instruments/methods/ocr.ts";
import { idOf, knownError, methodById, runMethod, sortRan, toolStatus, versionOf, type BrowserVersions, type Ran } from "../instruments/methods/registry.ts";
import { engineOf, flagOf, groupFindings, matchShare, runRuleEngines, type AlfaPage, type ElementGroup, type EngineId, type RulesRun } from "../instruments/methods/rules.ts";
import { compareSource, htmlValidate, locateSourceFindings, sourcePlaces, vnu, type SourceAnswer } from "../instruments/methods/source.ts";
import { compareOrders, lightWalk, orderFromWalk, predictedOrder, type TabOrder, type TabStop } from "../instruments/methods/taborder.ts";
import { readChangeState, scrollChange, stateChanges, styleChanges } from "../instruments/change.ts";
import { ensureHelpers } from "../instruments/methods/capsule.ts";
import { canonicalJson, sha256, sha256File, writeFileAtomic } from "../lib/canonical.ts";
import { writeManifestTools } from "../lib/manifest.ts";
import { criterionById } from "../lib/wcag.ts";
import { UsageError, type Context, type Handler, type Options, type Outcome } from "./commands.ts";
import type { Jobs } from "./jobs.ts";
import type { StateRecord } from "./observations.ts";
import { SecondBrowsers, type SecondBrowser } from "./second.ts";
import { counterpart, pageFacts, remember, syncRefs, tgs, type Surface } from "./surface.ts";

/** What a command gets from the session it runs in, besides the page. Absent when a recorded step is replayed. */
export interface Services {
  session: string;
  /** Id of the observation the command writes. */
  origin: string;
  /** The state the command runs in: what a second browser has to reproduce. */
  state: StateRecord;
  /** The background jobs of the session; null while an observation is replayed, where nothing may run on. */
  jobs: Jobs | null;
  second: SecondBrowsers | null;
}

export const where = (path: string[]): string => path.join(" >>> ");
export const browsersOf = (context: Context): BrowserVersions => context.services?.second?.versions ?? { chromium: context.env.browser.version() };
export const short = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** What was measured on a page in a state, kept for as long as the page stays the way it is. */
const memos = new WeakMap<Surface, { key: string; values: Map<string, unknown> }>();

interface Live {
  hover: string | null;
  focus: string | null;
  scroll: [number, number];
}

/** What the pointer is on, what has focus and where the page is scrolled to: the state of a page that is not in its DOM. */
async function liveState(surface: Surface): Promise<Live> {
  await ensureHelpers(surface.page);
  return surface.page.evaluate(() => ({ ...(window as unknown as { __loepm: { liveState: () => { hover: string | null; focus: string | null } } }).__loepm.liveState(), scroll: [window.scrollX, window.scrollY] as [number, number] }));
}

/** Put the pointer, focus and scroll position back where they were. A measurement may scroll or inject scripts; the state an agent built up must outlast it. */
async function restoreLive(surface: Surface, held: Live): Promise<void> {
  const { page } = surface;
  const now = await liveState(surface).catch(() => null);
  if (!now) return;
  if (now.scroll[0] !== held.scroll[0] || now.scroll[1] !== held.scroll[1]) await page.evaluate(([left, top]) => window.scrollTo({ left: left!, top: top!, behavior: "instant" }), held.scroll).catch(() => undefined);
  if (held.hover && now.hover !== held.hover) {
    const handle = await page.evaluateHandle((place) => (window as unknown as { __loepm: { resolveWhere: (place: string) => Element | null } }).__loepm.resolveWhere(place), held.hover).catch(() => null);
    await handle?.asElement()?.hover({ timeout: 2000 }).catch(() => undefined);
  }
  if (held.focus && now.focus !== held.focus) {
    await page.evaluate((place) => (window as unknown as { __loepm: { resolveWhere: (place: string) => HTMLElement | null } }).__loepm.resolveWhere(place.split(" | ")[0]!)?.focus({ preventScroll: true }), held.focus).catch(() => undefined);
  } else if (!held.focus && now.focus) {
    // Something took focus that had none: an engine that tries what an element does with it.
    await page.evaluate(() => (window as unknown as { __loep: { deepActiveElement: () => HTMLElement | null } }).__loep.deepActiveElement()?.blur()).catch(() => undefined);
  }
}

/** A measuring command that leaves pointer, focus and scroll position as it found them. */
function holding(handler: Handler): Handler {
  return async (context, args, options) => {
    if (!context.services) return handler(context, args, options);
    const held = await liveState(context.surface).catch(() => null);
    try {
      return await handler(context, args, options);
    } finally {
      if (held) await restoreLive(context.surface, held);
    }
  };
}

async function pageKey(surface: Surface): Promise<string> {
  const facts = await pageFacts(surface);
  if (!facts) return `unknown-${Date.now()}`;
  // Hover and focus change what is measured without changing the DOM; they are part of the state a measurement belongs to.
  const live = await liveState(surface).catch(() => null);
  return `${facts.url}|${facts.domSha256}|${facts.viewport.width}x${facts.viewport.height}|${facts.scheme}|${live?.hover ?? ""}|${live?.focus ?? ""}`;
}

/** Compute something once per state of the page. The key of the page is its address, the hash of its DOM, the window and the colour scheme. */
async function memo<T>(surface: Surface, name: string, compute: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const key = await pageKey(surface);
  let entry = memos.get(surface);
  if (!entry || entry.key !== key) {
    entry = { key, values: new Map() };
    memos.set(surface, entry);
  }
  if (entry.values.has(name)) return { value: entry.values.get(name) as T, cached: true };
  const value = await compute();
  // The page may have changed while the measurement ran; what was measured then belongs to no state.
  if ((await pageKey(surface)) === key) entry.values.set(name, value);
  return { value, cached: false };
}

const alfaShare = (surface: Surface): Promise<{ alfaPage?: AlfaPage }> => memo(surface, "alfa", async () => ({}) as { alfaPage?: AlfaPage }).then((found) => found.value);

async function rulesRun(context: Context): Promise<{ run: RulesRun; cached: boolean }> {
  const share = await alfaShare(context.surface);
  const held = await liveState(context.surface).catch(() => null);
  const found = await memo(context.surface, "rules", () => runRuleEngines(context.surface.page, browsersOf(context), share, async () => void (held && (await restoreLive(context.surface, held)))));
  return { run: found.value, cached: found.cached };
}

export interface Slow {
  id: string;
  /** What makes the answer reusable: everything it depends on besides the state of the page. */
  detail: string;
  /** How long a command waits for this method before it returns without it. */
  graceMs: number;
  work: () => Promise<Ran<unknown>>;
  /** Set by `withKeys`; a slow method that comes with one keeps it. */
  key?: string;
}

const WAIT_MS = 75_000;
const BROWSER_GRACE_MS = 300;
const BINARY_GRACE_MS = 2500;
const BROWSER_LIMIT_MS = 60_000;

/**
 * The key under which an answer of a background method is kept: the method, the state of the
 * session, the address and DOM of the page, what the method was asked, and its version.
 * Pointer and focus are left out: a second browser has its own.
 */
async function withKeys(context: Context, slows: Slow[]): Promise<(Slow & { key: string })[]> {
  const facts = await pageFacts(context.surface);
  const page = facts ? `${facts.url}|${facts.domSha256}|${facts.viewport.width}x${facts.viewport.height}|${facts.scheme}` : "unknown";
  const state = stateForSecondBrowser(context.services!.state).id;
  // A slow method that already has a key keeps it: a command that resizes the window asks for the key before it does.
  return Promise.all(slows.map(async (slow) => ({ ...slow, key: slow.key ?? [slow.id, state, page, slow.detail, await versionOf(methodById(slow.id), browsersOf(context))].join("|") })));
}

/**
 * Run the slow methods of a command as background jobs and finish the command with what has
 * come in. What is still running is listed as pending; the command is remembered so `wait`
 * can finish it. `finish` gets the answers that are there and the names of the methods that are not.
 */
export async function withBackground(context: Context, command: string, options: Options, slows: Slow[], finish: (answers: Ran<unknown>[], pending: string[]) => Outcome, onlyKnown = false): Promise<Outcome> {
  const jobs = context.services?.jobs;
  if (!jobs || slows.length === 0) return finish([], []);
  const services = context.services!;
  const all = await withKeys(context, slows);
  // A command that only takes what is there starts nothing: it uses an answer that an earlier command already asked for.
  const keyed = onlyKnown ? all.filter((slow) => jobs.get(slow.key) !== undefined || jobs.isRunning(slow.key)) : all;
  if (keyed.length === 0) return finish([], []);
  for (const slow of keyed) jobs.start(slow.key, slow.id, slow.work);
  await jobs.settle(keyed.map((slow) => slow.key), options.wait === true ? WAIT_MS : Math.max(...keyed.map((slow) => slow.graceMs)));
  const answers = keyed.map((slow) => jobs.get(slow.key)).filter((ran): ran is Ran<unknown> => ran !== undefined);
  const pending = keyed.filter((slow) => jobs.isRunning(slow.key));
  if (pending.length > 0) {
    jobs.defer({ origin: services.origin, command, keys: keyed.map((slow) => slow.key), complete: (all) => finish(all, []) });
  }
  return finish(answers, pending.map((slow) => slow.id));
}

/** Start background methods before the slow part of a command, so they run alongside it. `withBackground` finds them running. */
async function prestart(context: Context, slows: Slow[]): Promise<void> {
  const jobs = context.services?.jobs;
  if (!jobs) return;
  for (const slow of await withKeys(context, slows)) jobs.start(slow.key, slow.id, slow.work);
}

/** Measuring commands that count as a step because they move focus or resize the window, and put the page back when they are done. */
const MEASURING_STEPS = new Set(["tabwalk", "taborder", "reflow", "zoom", "spacing"]);

/**
 * The state a second browser is brought to: the steps of the session without the measurements
 * among them. Walking a page with Tab in WebKit to repeat a walk that was only a measurement
 * would cost a minute and change nothing that the next measurement looks at.
 */
export function stateForSecondBrowser(state: StateRecord): StateRecord {
  // With `--keep` the wider spacing stays: that is a state, not only a measurement.
  const steps = state.steps.filter((step) => !MEASURING_STEPS.has(step.command) || (step.command === "spacing" && step.options.keep === true));
  return steps.length === state.steps.length ? state : { id: sha256(canonicalJson({ start: state.start, steps })).slice(0, 12), start: state.start, steps };
}

/** A method in another browser, on a page brought to the state of the session. */
function inSecondBrowser<T>(context: Context, id: string, browser: SecondBrowser, detail: string, changes: boolean, work: (surface: Surface) => Promise<T>): Slow | null {
  const services = context.services;
  if (!services?.second || !services.jobs) return null;
  const second = services.second;
  const state = stateForSecondBrowser(services.state);
  // The other browser opens the page; the method runs in the document there that this one runs in here.
  // The browser is started first: the record of the measurement then carries the version the running browser gives.
  return { id, detail, graceMs: BROWSER_GRACE_MS, work: async () => {
    await second.started(browser);
    return runMethod(id, second.versions, () => second.use(services.session, browser, state, async (other) => work(await counterpart(other, context.surface)), changes), BROWSER_LIMIT_MS);
  } };
}

/** The lines every multi-method summary ends with: how many methods, which did not answer, which are still running. */
export function methodLines(measured: Measured, known: string[] = []): Record<string, unknown> {
  return {
    methods: agreementLine(measured),
    ...(known.length > 0 ? { knownUnreliable: known } : {}),
    ...(measured.failed.length > 0 ? { noAnswer: measured.failed.map((failure) => `${idOf(failure)}: ${failure.kind === "unavailable" ? "niet beschikbaar, " : ""}${short(failure.reason, 140)}`) } : {}),
    ...(measured.pending.length > 0 ? { pending: measured.pending, hint: "wait haalt de rest op" } : {}),
  };
}

const knownLines = (methods: MethodResult[]): string[] => methods.filter((method) => method.knownUnreliable).map((method) => `${idOf(method)}: bekend onbetrouwbaar hier, ${method.knownUnreliable}`);

export function split<T>(answers: Ran<unknown>[]): { methods: MethodResult<T>[]; failed: MethodFailure[] } {
  return sortRan(answers as Ran<T>[]);
}

// ---------------------------------------------------------------------------------- name

interface WebKitSession {
  send: (method: string, parameters?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * The session of Playwright with WebKit's inspector. This is not part of Playwright's public
 * interface and can be gone in any version; a test calls it on every run of the suite.
 */
export function webkitInspector(page: unknown): WebKitSession | null {
  try {
    const connection = (page as { _connection?: { toImpl?: (object: unknown) => { delegate?: { _session?: WebKitSession } } } })._connection;
    const session = connection?.toImpl?.(page)?.delegate?._session;
    return session && typeof session.send === "function" ? session : null;
  } catch {
    return null;
  }
}

/** Name and role of an element as WebKit's own accessibility tree has them. */
export async function webkitName(surface: Surface, place: string): Promise<NameAnswer> {
  // The inspector session is that of the tab: it looks up an element in the document of the tab.
  if (surface.frame) throw new Error("de inspector van WebKit is van hieruit niet binnen een ingesloten venster te bereiken");
  const inspector = webkitInspector(surface.page);
  if (!inspector) throw new Error("de niet-openbare ingang van Playwright naar de inspector van WebKit bestaat in deze versie niet meer");
  await ensureHelpers(surface.page);
  await inspector.send("DOM.getDocument", {});
  const evaluated = (await inspector.send("Runtime.evaluate", { expression: `window.__loepm.resolveWhere(${JSON.stringify(place)})`, returnByValue: false })) as { result?: { objectId?: string } };
  const objectId = evaluated.result?.objectId;
  if (!objectId) throw new Error("het element is in WebKit niet teruggevonden");
  const { nodeId } = (await inspector.send("DOM.requestNode", { objectId })) as { nodeId: number };
  const { properties } = (await inspector.send("DOM.getAccessibilityPropertiesForNode", { nodeId })) as { properties: Record<string, unknown> & { role?: string; label?: string; ignored?: boolean } };
  const { role, label, ignored, nodeId: _nodeId, exists: _exists, ...rest } = properties;
  return { role: role ?? null, name: (label ?? "").replace(/\s+/g, " ").trim(), ...(ignored ? { ignored: true } : {}), properties: Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== false && value !== "" && !(Array.isArray(value) && value.length === 0) && typeof value !== "object")) };
}

function nameOutcome(methods: MethodResult<NameAnswer>[], failed: MethodFailure[], pending: string[]): Outcome {
  markKnownNames(methods);
  const measured = measuredBy(methods, nameDifferences(methods), { failed, pending });
  const groups = groupAnswers(methods, sayName);
  return {
    result: measured,
    print: {
      answers: groups.map((group) => `${short(group.value, 90)} <- ${group.by.join(", ")}${group.knownUnreliable ? ` [bekend onbetrouwbaar hier: ${group.knownUnreliable}]` : ""}`),
      ...methodLines(measured),
    },
  };
}

async function nameMethods(context: Context, options: Options, command: string, finish: (methods: MethodResult<NameAnswer>[], failed: MethodFailure[], pending: string[]) => Outcome, startWebkit: boolean): Promise<Outcome> {
  const place = where(context.target!.path);
  const fast = await namesOf(context.surface.page, place, browsersOf(context), await alfaShare(context.surface));
  const webkit = inSecondBrowser(context, "webkit", "webkit", place, false, (surface) => webkitName(surface, place));
  return withBackground(
    context,
    command,
    options,
    webkit ? [webkit] : [],
    (answers, pending) => {
      const slow = split<NameAnswer>(answers);
      return finish([...fast.methods, ...slow.methods], [...fast.failed, ...slow.failed], pending);
    },
    !startWebkit,
  );
}

export const name: Handler = holding((context, _args, options) => nameMethods(context, options, "name", nameOutcome, true));

const STATE_PRINT = (answer: NameAnswer): Record<string, unknown> => ({ role: answer.role, name: answer.name, ...(answer.description ? { description: answer.description } : {}), ...(answer.ignored ? { ignored: true } : {}), states: answer.properties ?? {} });

/** `ax`: what Chromium's tree says, as before, with the other name computations next to it. WebKit joins when its page is already there; `name` starts it. */
export const axWith = (single: Handler): Handler => (context, args, options) => {
  if (!context.services) return single(context, args, options);
  return nameMethods(
    context,
    options,
    "ax",
    (methods, failed, pending) => {
      const chromium = methods.find((method) => idOf(method) === "chromium");
      if (!chromium) throw new Error(failed.find((failure) => idOf(failure) === "chromium")?.reason ?? "de browser gaf geen toegankelijkheidsinformatie voor dit element");
      const outcome = nameOutcome(methods, failed, pending);
      const measured = outcome.result as Measured;
      const { answers, methods: line, ...rest } = outcome.print as { answers: string[]; methods: string };
      return { result: measured, print: { ...STATE_PRINT(chromium.result), names: line, ...(measured.agreement === "disagree" || answers.length > 1 ? { answers } : {}), ...rest } };
    },
    false,
  );
};

// --------------------------------------------------------------------------------- rules

const FLAG_NL: Record<string, string> = { agree: "eens", alone: "alleen", contradiction: "oneens", cantTell: "onzeker", passed: "geslaagd" };
const MAX_ELEMENT_LINES = 20;
/** Criteria about a name, where a name glued together from two parts gives another outcome. */
const NAME_CRITERIA = new Set(["2.5.3", "4.1.2", "2.4.4", "1.1.1"]);
const FLAG_ORDER = ["contradiction", "alone", "agree", "cantTell", "passed"];

/** More elements than this with the very same outcome from the very same rules are one line: a rule that fires on every link must not push the rest out of the summary. */
const SAME_OUTCOME_LISTED = 3;

function elementLine(group: ElementGroup & { criteria: string[]; others?: string[] }): string {
  const engines = Object.keys(group.verdicts) as EngineId[];
  const by = (verdict: string): EngineId[] => engines.filter((engine) => group.verdicts[engine] === verdict);
  const withRules = (list: EngineId[]): string => list.map((engine) => `${engine} ${(group.rules[engine] ?? []).join("+")}`.trim()).join(", ");
  const parts = [by("failed").length > 0 ? `failed ${withRules(by("failed"))}` : null, by("cantTell").length > 0 ? `cantTell ${withRules(by("cantTell"))}` : null, by("passed").length > 0 ? `passed ${by("passed").join(", ")}` : null].filter(Boolean);
  // An engine whose answer here is of a kind it is known to get wrong is named when the contradiction rests on it.
  const known = (group.knownUnreliable ?? []).map((entry) => entry.engine);
  const without = Object.fromEntries(Object.entries(group.verdicts).filter(([engine]) => !known.includes(engine as EngineId)));
  const rests = group.flag === "contradiction" && known.length > 0 && flagOf(without) !== "contradiction";
  const places = group.others ? `${[group.where, ...group.others.slice(0, SAME_OUTCOME_LISTED - 1)].map((place) => short(place, 50)).join(", ")}${group.others.length >= SAME_OUTCOME_LISTED ? ` en ${group.others.length - SAME_OUTCOME_LISTED + 1} andere` : ""}` : short(group.where, 70);
  return `${group.criteria.join(",")} ${places} [${FLAG_NL[group.flag]}${rests ? `; ${known.join(", ")} bekend onbetrouwbaar hier` : ""}] ${parts.join("; ")}`;
}

/** Elements that the same engines judge the same way under several criteria become one line, and so do many elements with the same outcome. */
function mergeCriteria(elements: ElementGroup[]): (ElementGroup & { criteria: string[]; others?: string[] })[] {
  const merged = new Map<string, ElementGroup & { criteria: string[] }>();
  for (const element of elements) {
    const key = [element.where, JSON.stringify(element.verdicts), JSON.stringify(element.rules)].join("\n");
    const known = merged.get(key);
    if (known) known.criteria.push(element.criterion);
    else merged.set(key, { ...element, criteria: [element.criterion] });
  }
  const sameOutcome = new Map<string, (ElementGroup & { criteria: string[]; others?: string[] })[]>();
  for (const element of merged.values()) {
    const key = [element.criteria.join(","), JSON.stringify(element.verdicts), JSON.stringify(element.rules), JSON.stringify(element.knownUnreliable ?? [])].join("\n");
    sameOutcome.set(key, [...(sameOutcome.get(key) ?? []), element]);
  }
  return [...sameOutcome.values()].flatMap((group) => (group.length > SAME_OUTCOME_LISTED ? [{ ...group[0]!, others: group.slice(1).map((element) => element.where) }] : group));
}

export const rules: Handler = holding(async (context, _args, options) => {
  const { surface } = context;
  const criterion = typeof options.criterion === "string" ? options.criterion : undefined;
  if (criterion && !criterionById(criterion)) throw new UsageError(`"${criterion}" is geen succescriterium van WCAG 2.2`);
  const { run, cached } = await rulesRun(context);
  let places: Set<string> | undefined;
  if (context.target) {
    const target = where(context.target.path);
    const all = [...new Set(run.methods.flatMap((method) => method.result.findings.map((finding) => finding.where)).filter((place): place is string => place !== null))];
    const relations = await surface.page.evaluate(([element, list]) => (window as unknown as { __loepm: { relate: (target: string, places: string[]) => (string | null)[] } }).__loepm.relate(element as string, list as string[]), [target, all] as const);
    places = new Set(all.filter((_place, index) => relations[index] !== null));
  }
  const grouped = groupFindings(run, { ...(criterion ? { criterion } : {}), ...(places ? { places } : {}) });
  const said = grouped.criteria.filter((entry) => Object.values(entry.verdicts).some((verdict) => verdict !== "silent"));
  const sayCriterion = (entry: (typeof said)[number]): string => {
    const engines = Object.keys(entry.verdicts) as EngineId[];
    const by = (verdict: string): string[] => engines.filter((engine) => entry.verdicts[engine] === verdict).map((engine) => (verdict === "failed" ? `${engine} (${entry.failedElements[engine]})` : engine));
    return `${entry.criterion}: ${[by("failed").length > 0 ? `failed ${by("failed").join(", ")}` : null, by("cantTell").length > 0 ? `cantTell ${by("cantTell").join(", ")}` : null, by("passed").length > 0 ? `passed ${by("passed").join(", ")}` : null].filter(Boolean).join("; ")}`;
  };
  const differences = said.filter((entry) => entry.flag === "contradiction" || entry.flag === "alone").map(sayCriterion);
  const measured = measuredBy(run.methods, differences, { failed: run.failed });
  const narrowed = criterion !== undefined || places !== undefined;
  const lines = mergeCriteria(grouped.elements.filter((element) => narrowed || element.flag !== "cantTell")).sort((a, b) => FLAG_ORDER.indexOf(a.flag) - FLAG_ORDER.indexOf(b.flag));
  const share = matchShare(run);
  const of = (flag: string): typeof said => said.filter((entry) => entry.flag === flag);
  // IBM glues the parts of aria-labelledby together without a space: its answer about such a name is marked.
  const named = grouped.elements.filter((element) => NAME_CRITERIA.has(element.criterion) && element.verdicts.ibm !== undefined && element.verdicts.ibm !== "silent");
  if (named.length > 0) {
    const glued = await surface.page.evaluate((list) => list.map((place) => ((window as unknown as { __loepm: { resolveWhere: (place: string) => Element | null } }).__loepm.resolveWhere(place)?.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/).filter(Boolean).length > 1), named.map((element) => element.where)).catch(() => [] as boolean[]);
    for (const [index, element] of named.entries()) if (glued[index]) element.knownUnreliable = [...(element.knownUnreliable ?? []), { engine: "ibm", reason: knownError("ibm", "labelledby-concatenation")! }];
  }
  const resting = (element: ElementGroup): string[] => {
    const engines = (element.knownUnreliable ?? []).map((entry) => entry.engine);
    const without = Object.fromEntries(Object.entries(element.verdicts).filter(([engine]) => !engines.includes(engine as EngineId)));
    return element.flag === "contradiction" && flagOf(without) !== "contradiction" ? (element.knownUnreliable ?? []).map((entry) => entry.reason) : [];
  };
  const known = [...new Set(grouped.elements.flatMap(resting))];
  // The record holds what every engine said. A pass is one rule and one place; those are kept as lists of places per rule, which is a tenth of the size.
  const kept = (method: (typeof run.methods)[number]): typeof method.result.findings =>
    narrowed ? method.result.findings.filter((finding) => (places ? finding.where !== null && places.has(finding.where) : true) && (criterion ? (method.result.rules[finding.rule]?.criteria ?? []).includes(criterion) : true)) : method.result.findings;
  const count = (method: (typeof run.methods)[number], outcome: string): number => kept(method).filter((finding) => finding.outcome === outcome && !finding.advisory).length;
  const forRecord = run.methods.map((method) => {
    const findings = kept(method);
    const passed: Record<string, (string | null)[]> = {};
    for (const finding of findings) if (finding.outcome === "passed") (passed[finding.rule] ??= []).push(finding.where);
    return { ...method, result: { counts: method.result.counts, matching: method.result.matching, ...(method.result.notes ? { notes: method.result.notes } : {}), rules: narrowed ? {} : Object.fromEntries(Object.entries(method.result.rules).map(([rule, info]) => [rule, { criteria: info.criteria, act: info.act }])), findings: findings.filter((finding) => finding.outcome !== "passed"), passed } };
  });
  const result = { ...measured, methods: forRecord, grouped, matching: share, domUnchanged: run.domUnchanged, ...(criterion ? { criterion } : {}), cached };
  return {
    result,
    print: {
      ...(narrowed ? { filter: [criterion ? `criterium ${criterion}` : null, context.target ? `element ${short(where(context.target.path), 60)} en wat erin zit` : null].filter(Boolean).join(", ") } : {}),
      // With a filter the counts are those of the filter, not of the page.
      engines: Object.fromEntries(run.methods.map((method) => [engineOf(method), `${method.version}: ${count(method, "failed")} failed, ${count(method, "cantTell")} cantTell, ${count(method, "passed")} passed`])),
      ...methodLines(measured, known.map((reason) => `bekend onbetrouwbaar hier: ${reason}`)),
      ...(narrowed ? {} : { matched: `${share.total.exact} van ${share.total.withElement} uitkomsten aan een element gekoppeld${share.total.partial > 0 ? `, ${share.total.partial} deels` : ""}${share.total.unmatched > 0 ? `; niet: ${run.methods.filter((method) => method.result.matching.unmatched > 0).map((method) => `${engineOf(method)} ${method.result.matching.unmatched}`).join(", ")}` : ""}` }),
      ...(of("contradiction").length > 0 ? { disagree: of("contradiction").map(sayCriterion) } : {}),
      ...(of("alone").length > 0 ? { alone: of("alone").map(sayCriterion) } : {}),
      ...(of("agree").length > 0 ? { agree: of("agree").map(sayCriterion) } : {}),
      ...(of("cantTell").length > 0 ? { cantTell: of("cantTell").map((entry) => entry.criterion).join(" ") } : {}),
      ...(narrowed ? {} : { passed: of("passed").length }),
      elements: lines.slice(0, MAX_ELEMENT_LINES).map(elementLine),
      ...(lines.length > MAX_ELEMENT_LINES ? { moreElements: `${lines.length - MAX_ELEMENT_LINES} (vraag door met --criterion of een ref)` } : {}),
      ...(Object.keys(grouped.unlocated).length > 0 ? { notLocated: grouped.unlocated } : {}),
      ...(run.domUnchanged ? {} : { warning: "de pagina was na de engines niet meer dezelfde als ervoor" }),
    },
  };
});

// ------------------------------------------------------------- contrast, focus and target

const sayVerdict = (summary: { id: string; verdict: Verdict; ratio?: number | null }): string => `${summary.id} ${summary.verdict}${typeof summary.ratio === "number" ? ` ${summary.ratio}` : ""}`;

async function elementOpinions(context: Context, rulesByEngine: Partial<Record<EngineId, string[]>>, inside: boolean): Promise<{ methods: MethodResult<EngineOpinion>[]; failed: MethodFailure[] }> {
  const { run } = await rulesRun(context);
  return engineOpinions(context.surface.page, run, where(context.target!.path), rulesByEngine, browsersOf(context), inside);
}

interface Summary {
  id: string;
  verdict: Verdict;
  ratio?: number | null;
  known?: string;
  noOpinion?: string;
  /** Set for a method whose "cannot tell" is its answer: the pixel method on a background that is not flat gives a range. */
  answers?: boolean;
}

const hasNoOpinion = (summary: Summary): string | null => (summary.answers ? null : withoutOpinion(summary));

/** The methods without an opinion, grouped by the reason: "reason: method, method". */
function noOpinionLines(summaries: Summary[]): { list: string[]; print: string[] } {
  const byReason = new Map<string, string[]>();
  const list: string[] = [];
  for (const summary of summaries) {
    const reason = hasNoOpinion(summary);
    if (!reason) continue;
    list.push(`${summary.id}: ${reason}`);
    byReason.set(reason, [...(byReason.get(reason) ?? []), summary.id]);
  }
  return { list, print: [...byReason.entries()].map(([reason, ids]) => `${ids.join(", ")}: ${reason}`) };
}

/** Elements that are a picture: whatever text they show is pixels, found by text recognition and measured within the box of each line. */
const PICTURE_TAGS = new Set(["img", "svg", "canvas", "video", "picture", "object", "embed"]);

interface ElementState {
  tag: string;
  hover: boolean;
  focus: boolean;
  inViewport: boolean;
  hasText: boolean;
  backgroundImage: boolean;
}

const MAX_IMAGE_LINES = 8;

/** How a line names the reading of the text recognition that found it. */
const READINGS = { block: "regels", sparse: "verspreid" } as const;

/** One line of text in a picture as it is printed, with what makes its ratio uncertain next to it. */
const imageLine = (line: ImageTextLine): Record<string, unknown> => ({
  text: short(line.text, 30),
  box: `${line.box.x},${line.box.y} ${line.box.width}x${line.box.height}`,
  sizeEstimate: line.fontSizePx,
  ...(line.ratio === null ? {} : { fg: line.foreground, bg: line.background, ratio: line.ratio, ...(line.bestRatio !== line.ratio ? { best: line.bestRatio } : {}) }),
  required: line.requiredUncertain ? "3 of 4.5" : line.required,
  outcome: line.outcome,
  confidence: line.confidence,
  ...(line.reading ? { reading: READINGS[line.reading] } : {}),
  ...(line.reason ? { reason: line.reason } : {}),
  ...(line.uncertain.length > 0 ? { uncertain: line.uncertain.join("; ") } : {}),
});

function imageSummary(lines: ImageTextLine[]): Summary {
  if (lines.length === 0) return { id: "image-text", verdict: "silent", noOpinion: "vindt geen tekst in het beeld" };
  const ratios = lines.map((line) => line.ratio).filter((ratio): ratio is number => ratio !== null);
  const verdict = lines.some((line) => line.outcome === "failed") ? "failed" : lines.some((line) => line.outcome === "cantTell") ? "cantTell" : "passed";
  return { id: "image-text", verdict, ratio: ratios.length > 0 ? Math.min(...ratios) : null, answers: true };
}

async function elementState(context: Context): Promise<ElementState | null> {
  await ensureHelpers(context.surface.page);
  return context.surface.page.evaluate((place) => (window as unknown as { __loepm: { elementState: (place: string) => ElementState | null } }).__loepm.elementState(place), where(context.target!.path));
}

/** The largest image file that is drawn in the page to be measured in place of the picture on the page. */
const MAX_FILE_PIXELS = 8_000_000;

/** What an image file larger than its picture on the page was used for. */
interface ImageFile {
  /** Sizes in pixels; `file` is absent when the file could not be opened again. */
  file?: { width: number; height: number };
  shown: { width: number; height: number };
  measuredOn: "file" | "page";
  /** Why the picture on the page was measured instead of the file. */
  reasonNl?: string;
}

/**
 * The picture that text in an element is measured on: its picture on the page at `shownPath`, or,
 * for an image the page shows smaller than its file is, the file itself when it stands for what is
 * shown (`fileAsShown`). The file is the one the page loaded, drawn inside the page. Boxes stay in
 * CSS pixels either way: the measurement scales by the width of the picture.
 */
async function pictureToMeasure(context: Context, shownPath: string): Promise<{ path: string; imageFile: ImageFile | null }> {
  const { page } = context.surface;
  await ensureHelpers(page);
  type Found = { width?: number; height?: number; png?: string; reasonNl?: string } | null;
  const found = await page
    .evaluate(([place, max]) => (window as unknown as { __loepm: { imageFile: (place: string, max: number) => Promise<Found> } }).__loepm.imageFile(place, max), [where(context.target!.path), MAX_FILE_PIXELS] as const)
    .catch((): Found => null);
  if (!found || (!found.png && !found.reasonNl)) return { path: shownPath, imageFile: null };
  const shownPicture = PNG.sync.read(await readFile(shownPath));
  const shown = { width: shownPicture.width, height: shownPicture.height };
  const file = found.width && found.height ? { width: found.width, height: found.height } : undefined;
  const onPage = (reasonNl: string) => ({ path: shownPath, imageFile: { ...(file ? { file } : {}), shown, measuredOn: "page" as const, reasonNl } });
  if (!found.png) return onPage(found.reasonNl!);
  const asShown = fileAsShown(PNG.sync.read(Buffer.from(found.png.slice(found.png.indexOf(",") + 1), "base64")), shownPicture);
  if ("reasonNl" in asShown) return onPage(asShown.reasonNl);
  const path = context.images.image("-file");
  await writeFile(path, PNG.sync.write(asShown.picture));
  return { path, imageFile: { file, shown, measuredOn: "file" } };
}

/** How the print says which picture was measured, when the file is larger than the picture on the page. */
function pictureLine(imageFile: ImageFile): string {
  const size = (of: { width: number; height: number }): string => `${of.width}x${of.height}`;
  if (imageFile.measuredOn === "file") return `gemeten op het beeldbestand zelf (${size(imageFile.file!)} pixels), dat de pagina kleiner toont (${size(imageFile.shown)}): verkleind delen dunne letters hun pixels met de achtergrond`;
  return `gemeten op de afbeelding zoals de pagina haar toont (${size(imageFile.shown)} pixels)${imageFile.file ? `; het beeldbestand is ${size(imageFile.file)}` : ""}, maar ${imageFile.reasonNl}`;
}

/** `--at x,y,width,height`: a box in the picture of an element, in CSS pixels from its top left corner. */
function pointedBox(value: string | boolean | undefined, element: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const parts = typeof value === "string" ? value.split(/[,x ]+/).filter((part) => part !== "").map(Number) : [];
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0)) throw new UsageError("--at verwacht x,y,breedte,hoogte: een kader in het beeld van het element, in pixels vanaf de linkerbovenhoek, zoals crop <ref> --margin 0 het toont");
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width < 4 || height < 4) throw new UsageError("--at: het kader moet minstens 4 bij 4 pixels zijn");
  if (x + width > element.width || y + height > element.height) throw new UsageError(`--at: het kader valt buiten het element, dat ${element.width} bij ${element.height} pixels is`);
  return { x, y, width, height };
}

/**
 * Contrast in a box the agent points at in the picture of an element: for a letter or a short label
 * that text recognition does not find. Only the pixels are asked; no other method knows what a box is.
 */
async function contrastAt(context: Context, options: Options): Promise<Outcome> {
  const { page } = context.surface;
  const element = context.target!.box;
  const box = pointedBox(options.at, element);
  const path = context.images.image();
  await regionScreenshot(page, { x: Math.max(0, element.x), y: Math.max(0, element.y), width: element.width, height: element.height }, { path });
  const picture = await pictureToMeasure(context, path);
  const ran = await runMethod<PointedAnswer>("image-box", browsersOf(context), () => pointedContrast(picture.path, element.width, box));
  const measured = measuredBy(ran.ok ? [ran.value] : [], [], { failed: ran.ok ? [] : [ran.failure] });
  const { text: _text, confidence: _confidence, ...line } = ran.ok ? imageLine(ran.value.result.box) : { text: "", confidence: 0 };
  return {
    result: { ...measured, at: box, pointedBy: "agent", ...(picture.imageFile ? { imageFile: picture.imageFile } : {}) },
    print: {
      image: context.images.relative(path),
      ...(picture.imageFile ? { picture: pictureLine(picture.imageFile), ...(picture.path !== path ? { file: context.images.relative(picture.path) } : {}) } : {}),
      at: `${box.x},${box.y} ${box.width}x${box.height}`,
      ...(ran.ok ? { pointed: line } : {}),
      ...methodLines(measured),
      note: "het kader is door de agent aangewezen met --at, niet door tekstherkenning gevonden: de meting zegt niet of er tekst in staat en welke. Gemeten op de pixels binnen het kader (box: CSS-pixels vanaf de linkerbovenhoek van het element, gelijk aan de pixels van image); sizeEstimate en daarmee required zijn geschat uit de hoogte van de letters in het kader",
    },
  };
}

export const contrastWith = (raw: Handler, single: Handler): Handler =>
  holding(async (context, args, options) => {
    if (options.at !== undefined) return contrastAt(context, options);
    if (!context.services) return single(context, args, options);
    const browsers = browsersOf(context);
    const { page } = context.surface;
    const place = where(context.target!.path);
    const state = await elementState(context);
    // The pixels are read from a picture of the window: an element outside it is brought in first, and the page is put back afterwards.
    if (state && !state.inViewport) await page.evaluate((target) => void (window as unknown as { __loepm: { intoView: (target: string) => unknown } }).__loepm.intoView(target), place);
    const started = Date.now();
    const pixels = await raw(context, args, options);
    const methods: MethodResult[] = [await ownMethod("pixels", browsers, pixels.result, Date.now() - started)];
    const failed: MethodFailure[] = [];
    const computed = await runMethod("computed-style", browsers, () => computedContrast(page, place));
    if (computed.ok) methods.push(computed.value);
    else failed.push(computed.failure);
    const holder = computed.ok ? (computed.value.result.pieces[0]?.where ?? null) : null;
    if (holder) {
      const sampled = await runMethod("chromium-backgrounds", browsers, () => chromiumBackgrounds(page, holder));
      if (sampled.ok) methods.push(sampled.value);
      else failed.push(sampled.failure);
    }
    const engines = await elementOpinions(context, CONTRAST_RULES, true);
    methods.push(...engines.methods);
    failed.push(...engines.failed);
    // A picture, or an element that shows nothing but a background picture: whatever text is there is in the pixels.
    const picture = state !== null && (PICTURE_TAGS.has(state.tag) || (state.backgroundImage && !state.hasText));
    const slows: Slow[] = [];
    let imagePath: string | null = null;
    let imageFile: ImageFile | null = null;
    let measuredPath: string | null = null;
    // Why the text in a picture was not read, when it was not: a measurement that did not run says so.
    let notRead: string | null = picture && !context.services.jobs ? "geen achtergrondtaken in deze sessie" : null;
    if (picture && context.services.jobs) {
      const box = context.target!.box;
      if (box.width < 4 || box.height < 4) notRead = `het element is ${Math.round(box.width)}x${Math.round(box.height)} pixels, te klein voor tekstherkenning`;
      else {
        const path = context.images.image();
        const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height };
        await regionScreenshot(page, clip, { path });
        imagePath = path;
        const picture = await pictureToMeasure(context, path);
        ({ imageFile } = picture);
        measuredPath = picture.path;
        slows.push({ id: "image-text", detail: `${place}|${clip.width}x${clip.height}${picture.path === path ? "" : "|file"}`, graceMs: BINARY_GRACE_MS, work: () => runMethod("image-text", browsers, () => imageTextContrast(picture.path, clip.width), 40_000) });
      }
    }
    const overPicture = computed.ok && computed.value.result.pieces.some((piece) => piece.notes?.includes("background-image"));
    const live = state?.hover ? "hover" : state?.focus ? "focus" : null;
    const own = [...methods];
    const ownFailed = [...failed];
    return withBackground(context, "contrast", options, slows, (answers, pending) => {
      const inPicture = split<ImageTextAnswer>(answers);
      // The lowest ratio comes first; a line without a ratio comes last.
      const lines = [...(inPicture.methods[0]?.result.lines ?? [])].sort((a, b) => (a.ratio ?? 99) - (b.ratio ?? 99));
      const methods: MethodResult[] = [...own, ...inPicture.methods];
      const failed = [...ownFailed, ...inPicture.failed];
      const summaries: Summary[] = methods.map((method) => {
        if (idOf(method) === "image-text") return imageSummary(lines);
        const summary: Summary = contrastSummary(method);
        if (summary.id === "pixels") return summary.verdict === "silent" ? { ...summary, noOpinion: "vindt geen tekst om te meten" } : { ...summary, answers: true };
        // Only the pixels show what is behind text on a picture; a method that works from colours in styles has nothing to say there.
        if (overPicture) return { id: summary.id, verdict: "silent", noOpinion: "ziet de achtergrondafbeelding niet" };
        if (summary.id === "alfa" && live) return { id: summary.id, verdict: "silent", noOpinion: knownError("alfa", "live-state")! };
        return summary;
      });
      // A flag says that an answer here is of a kind the method gets wrong. An answer that is the same as everybody else's is not that.
      const sameAsOthers = (own: Summary): boolean => summaries.every((other) => other === own || hasNoOpinion(other) !== null || other.known !== undefined || verdictDifferences([{ ...own, known: undefined } as Summary, other]).length === 0);
      for (const summary of summaries) if (summary.known && (summary.noOpinion || sameAsOthers(summary))) delete summary.known;
      for (const method of methods) if (!summaries.find((summary) => summary.id === idOf(method))?.known) delete method.knownUnreliable;
      const differences = verdictDifferences(summaries);
      const silent = noOpinionLines(summaries);
      const measured = measuredBy(methods, differences, { failed, noOpinion: silent.list, pending });
      const opinions = summaries.filter((summary) => !hasNoOpinion(summary));
      const note =
        lines.length > 0
          ? "tekst in het beeld, per regel gemeten op de pixels binnen het kader (box: CSS-pixels vanaf de linkerbovenhoek van het element); sizeEstimate en daarmee required zijn geschat uit de hoogte van het kader; reading zegt welke lezing de regel vond: regels onder elkaar, of verspreide woorden en letters op gekleurde vlakken; of het een logo of merknaam is, zegt de meting niet"
          : picture
            ? inPicture.methods.length > 0
              ? "dit is een afbeelding en de tekstherkenning vindt er geen tekst in; bekijk haar met crop <ref>"
              : pending.length > 0
                ? "dit is een afbeelding: de tekst in het beeld wordt nog gemeten"
                : `dit is een afbeelding: de tekst in het beeld is niet gemeten (${inPicture.failed[0] ? `image-text: ${inPicture.failed[0].kind === "unavailable" ? "niet beschikbaar, " : ""}${short(inPicture.failed[0].reason, 140)}` : (notRead ?? "reden onbekend")}); bekijk haar met crop <ref>`
            : measured.agreement === "none"
              ? "geen enkele methode vond hier tekst om te meten"
              : overPicture
                ? "tekst op een afbeelding: alleen de pixelmeting geldt, met het ongunstigste en het gunstigste geval"
                : null;
      return {
        result: { ...measured, ...(live ? { liveState: live } : {}), ...(imageFile ? { imageFile } : {}) },
        print: {
          ...pixels.print,
          ...(imageFile ? { picture: pictureLine(imageFile), ...(measuredPath !== imagePath ? { file: context.images.relative(measuredPath!) } : {}) } : {}),
          ...(lines.length > 0 ? { image: context.images.relative(imagePath!), imageText: lines.slice(0, MAX_IMAGE_LINES).map(imageLine), ...(lines.length > MAX_IMAGE_LINES ? { moreImageText: lines.length - MAX_IMAGE_LINES } : {}) } : {}),
          ...(live ? { state: live } : {}),
          ...methodLines(measured, knownLines(methods)),
          ...(differences.length > 0 || opinions.some((summary) => summary.known) ? { byMethod: opinions.map(sayVerdict).join(" | ") } : {}),
          ...(differences.length > 0 ? { disagree: differences } : {}),
          ...(silent.print.length > 0 ? { noOpinion: silent.print } : {}),
          ...(note ? { note } : {}),
        },
      };
    });
  });

export const focusWith = (raw: Handler, single: Handler): Handler => async (context, args, options) => {
  if (!context.services) return single(context, args, options);
  const browsers = browsersOf(context);
  const place = where(context.target!.path);
  const { page } = context.surface;
  // The instrument takes focus away before it measures; the styles without focus are read in that same state.
  await page.evaluate(() => (window as unknown as { __loep: { deepActiveElement: () => HTMLElement | null } }).__loep.deepActiveElement()?.blur());
  const before = await focusStyles(page, place).catch(() => null);
  const started = Date.now();
  const pixels = await raw(context, args, options);
  const measuredPixels = pixels.result as { focusable: boolean; focusPixelShare: number | null };
  const methods: MethodResult[] = [await ownMethod("pixel-diff", browsers, pixels.result, Date.now() - started)];
  const failed: MethodFailure[] = [];
  if (!measuredPixels.focusable) {
    // An element that is not shown cannot take focus; that is another finding than a shown element that is not focusable.
    const shown = await page
      .evaluate((target) => {
        const element = (window as unknown as { __loepm: { resolveWhere: (place: string) => Element | null } }).__loepm.resolveWhere(target);
        return element !== null && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true }));
      }, place)
      .catch(() => true);
    return { result: { ...measuredBy(methods), shown }, print: { ...pixels.print, ...(shown ? {} : { notMeasured: "het element is niet (meer) zichtbaar op de pagina en krijgt daardoor geen focus; kijk opnieuw met look of find" }), methods: agreementLine(measuredBy(methods)) } };
  }
  const styles = await runMethod("style-change", browsers, async () => {
    const after = await focusStyles(page, place);
    if (!before || !after) throw new Error("het element is van de pagina verdwenen");
    return styleChange(before, after);
  });
  if (styles.ok) methods.push(styles.value);
  else failed.push(styles.failure);
  const differences: string[] = [];
  if (styles.ok && measuredPixels.focusPixelShare !== null) {
    const seen = measuredPixels.focusPixelShare > 0;
    const change = styles.value.result;
    const changed = [...Object.keys(change.changed), ...change.ancestors.map((ancestor) => `${short(ancestor.where, 40)}: ${ancestor.changed.join(", ")}`), ...change.generated];
    if (seen !== change.visibleChange) differences.push(seen ? `pixel-diff ziet verandering (${Math.round(measuredPixels.focusPixelShare * 10000) / 10000}); style-change vindt geen gewijzigde stijl` : `pixel-diff ziet geen verandering; style-change vindt gewijzigde stijl: ${short(changed.join(", "), 160)}`);
  }
  // An element that only shows when it has focus, such as a skip link, has no place to compare without focus. It is measured as what appears.
  const appearing: Record<string, unknown> = {};
  if (measuredPixels.focusPixelShare === null) {
    const stop = { ref: context.target!.ref, path: context.target!.path, tag: context.target!.tag, text: context.target!.text, inViewport: true, coveredBy: null, focusPixelShare: null, indicatorRatio: null, focusNotMeasured: "x" } as WalkStop;
    await measureAppearing(context, stop).catch(() => undefined);
    if (stop.appearsOnFocus) {
      // The instrument leaves focus on the element; so does this.
      await page.evaluate((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain)?.focus(), context.target!.path).catch(() => undefined);
      Object.assign(appearing, { pixelShare: stop.focusPixelShare, appearsOnFocus: true, notMeasured: undefined, note: "het element is alleen te zien als het focus heeft; gemeten is wat er dan verschijnt, zonder contrast van een indicator" });
      (pixels.result as { appearsOnFocus?: boolean; appearingPixelShare?: number | null }).appearsOnFocus = true;
      (pixels.result as { appearingPixelShare?: number | null }).appearingPixelShare = stop.focusPixelShare;
    }
  }
  // Pixels that could not be compared (the element moved, or is covered) are no opinion about the indicator.
  const noOpinion = measuredPixels.focusPixelShare === null && !appearing.appearsOnFocus ? ["pixel-diff: kon de beelden niet vergelijken"] : [];
  const measured = measuredBy(methods, differences, { failed, noOpinion });
  return { result: measured, print: { ...pixels.print, ...appearing, ...methodLines(measured), ...(differences.length > 0 ? { disagree: differences } : {}), ...(noOpinion.length > 0 ? { noOpinion } : {}) } };
};

export const targetWith = (raw: Handler, single: Handler): Handler =>
  holding(async (context, args, options) => {
    if (!context.services) return single(context, args, options);
    const browsers = browsersOf(context);
    const started = Date.now();
    const layout = await raw(context, args, options);
    const own = layout.result as { control?: boolean; largeEnough?: boolean; inlineInText?: boolean; tooCloseTo?: unknown };
    const methods: MethodResult[] = [await ownMethod("layout-box", browsers, layout.result, Date.now() - started)];
    const engines = await elementOpinions(context, TARGET_RULES, false);
    methods.push(...engines.methods);
    const ownVerdict: Verdict = own.control === false ? "silent" : own.largeEnough || own.inlineInText || !own.tooCloseTo ? "passed" : "failed";
    const summaries: Summary[] = [{ id: "layout-box", verdict: ownVerdict }, ...engines.methods.map((method) => ({ id: idOf(method), verdict: method.result.verdict, ...(method.knownUnreliable ? { known: method.knownUnreliable } : {}) }))];
    const differences = verdictDifferences(summaries);
    const silent = noOpinionLines(summaries);
    const measured = measuredBy(methods, differences, { failed: engines.failed, noOpinion: silent.list });
    const opinions = summaries.filter((summary) => !hasNoOpinion(summary));
    return {
      result: measured,
      print: { ...layout.print, ...methodLines(measured, knownLines(methods)), ...(differences.length > 0 ? { byMethod: opinions.map(sayVerdict).join(" | "), disagree: differences } : {}), ...(silent.print.length > 0 ? { noOpinion: silent.print } : {}) },
    };
  });

// ------------------------------------------------------------------- what an action changed

type Shown = Record<string, string> | null;

interface Before {
  states: Record<string, string>;
  scroll: [number, number];
  style: Shown;
}

async function beforeAndAfter(context: Context): Promise<Before | null> {
  const place = context.target ? where(context.target.path) : null;
  // The same reading as the key and pointer probes of the sweep take: one implementation for both.
  return readChangeState(context.surface.page, place).catch(() => null);
}

const MAX_STATE_CHANGES = 8;

/**
 * An act command reports what appeared and disappeared in the page. That misses what changes
 * without any text changing: a box that gets ticked, a field that gets a value, something that
 * expands, a window that scrolls, a link that only changes colour. Those are compared here,
 * so "nothing changed" is only said when none of them did.
 */
export const actWith = (raw: Handler): Handler => async (context, args, options) => {
  if (!context.services) return raw(context, args, options);
  const before = await beforeAndAfter(context);
  const outcome = await raw(context, args, options);
  const navigated = (outcome.result as { navigated?: boolean }).navigated === true;
  const after = navigated ? null : await beforeAndAfter(context);
  const extra: Record<string, unknown> = {};
  const record: Record<string, unknown> = {};
  if (before && after) {
    const states = stateChanges(before.states, after.states, (place) => short(place, 60));
    if (states.length > 0) extra.states = [...states.slice(0, MAX_STATE_CHANGES), ...(states.length > MAX_STATE_CHANGES ? [`(+${states.length - MAX_STATE_CHANGES})`] : [])];
    const scrolled = scrollChange(before.scroll, after.scroll);
    if (scrolled) extra.scrolled = scrolled;
    const style = styleChanges(before.style, after.style);
    if (Object.keys(style).length > 0) extra.style = style;
    Object.assign(record, { stateChanges: states, scrollBefore: before.scroll, scrollAfter: after.scroll, styleChanges: style });
  }
  const { changed: nothing, ...print } = outcome.print as { changed?: boolean };
  const changed = Object.keys(extra).length > 0;
  return {
    ...(outcome.step ? { step: outcome.step } : {}),
    result: { ...(outcome.result as object), ...record },
    print: changed
      ? { ...print, ...extra }
      : { ...print, ...(nothing === false ? { changed: false, note: "niets verschenen of verdwenen; ook geen andere toestand (aangevinkt, waarde, uitgeklapt, ingedrukt), scrollpositie of stijl van het element zelf" } : {}) },
  };
};

// ------------------------------------------------------------------------------ taborder

interface WalkStop {
  ref: number | null;
  path: string[];
  tag: string;
  role?: string | null;
  text: string;
  ariaLabel?: string | null;
  inViewport: boolean;
  coveredBy: string[] | null;
  focusPixelShare: number | null;
  indicatorRatio: number | null;
  focusNotMeasured?: string;
  focusScreenshot?: string;
  scroll?: [number, number];
  /** Set by the checks after the walk. */
  coveredWhere?: string;
  appearsOnFocus?: boolean;
}

/**
 * A stop that only shows when it has focus, such as a skip link, has no place to compare
 * without focus. It is measured the other way round: a picture of where it is with focus,
 * and of the same spot once focus is gone.
 */
async function measureAppearing(context: Context, stop: WalkStop): Promise<void> {
  const { page } = context.surface;
  await page.keyboard.press("Shift");
  const box = await page.evaluate((chain) => {
    const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
    if (!element) return null;
    element.focus();
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth ? { x: Math.max(0, Math.floor(rect.x) - 4), y: Math.max(0, Math.floor(rect.y) - 4), width: Math.ceil(rect.width) + 8, height: Math.ceil(rect.height) + 8 } : null;
  }, stop.path);
  if (!box) return;
  const withFocus = PNG.sync.read(await page.screenshot({ clip: box, animations: "disabled" }));
  await page.evaluate(() => (window as unknown as { __loep: { deepActiveElement: () => HTMLElement | null } }).__loep.deepActiveElement()?.blur());
  const without = PNG.sync.read(await page.screenshot({ clip: box, animations: "disabled" }));
  const { changed } = changedBetween(without, withFocus);
  // Nothing appears: then this is not an element that shows on focus, and what the walk said about it stands.
  if (changed === 0) return;
  stop.focusPixelShare = Math.round((changed / (withFocus.width * withFocus.height)) * 10000) / 10000;
  stop.appearsOnFocus = true;
  delete stop.focusNotMeasured;
}

/** After the walk: say for every stop without a visible change whether something lies over it, and measure the stops that only appear on focus. */
async function completeWalk(context: Context, stops: WalkStop[]): Promise<void> {
  const { page } = context.surface;
  await ensureHelpers(page);
  for (const stop of stops) {
    if (stop.coveredBy) {
      stop.coveredWhere = stop.coveredBy.join(" >>> ");
      continue;
    }
    if (stop.focusNotMeasured && stop.path.length > 0) await measureAppearing(context, stop).catch(() => undefined);
    if (stop.focusPixelShare !== null && stop.focusPixelShare > 0) continue;
    const cover = await page
      .evaluate(([place, scroll]) => (window as unknown as { __loepm: { coverOf: (place: string, scroll: [number, number] | null) => string | null } }).__loepm.coverOf(place as string, scroll as [number, number] | null), [where(stop.path), stop.scroll ?? null] as const)
      .catch(() => null);
    if (cover) stop.coveredWhere = cover;
  }
}

function stopLine(stop: WalkStop): string {
  const share = stop.coveredWhere && !(stop.focusPixelShare !== null && stop.focusPixelShare > 0)
    ? "niet te beoordelen"
    : stop.focusPixelShare === null
      ? `niet gemeten${stop.focusNotMeasured ? ` (${short(stop.focusNotMeasured, 50)})` : ""}`
      : `${Math.round(stop.focusPixelShare * 10000) / 10000}${stop.indicatorRatio !== null ? ` ${stop.indicatorRatio}:1` : ""}${stop.appearsOnFocus ? " (verschijnt bij focus)" : ""}`;
  // A field has no text of its own; its place in the page says which one it is.
  const label = stop.text.trim() ? stop.text.slice(0, 40) : stop.ariaLabel?.trim() ? `(aria-label: ${stop.ariaLabel.trim().slice(0, 40)})` : `(${short(stop.path.at(-1)?.split(" > ").slice(-2).join(" > ") ?? "geen tekst", 50)})`;
  // The number of the picture of this stop in the directory of the walk; `sheet` uses the same numbers.
  const picture = /(\d+)\.png$/.exec(stop.focusScreenshot ?? "")?.[1];
  return `${picture ? `[${picture}] ` : ""}${stop.ref ?? "?"} ${stop.role ?? stop.tag}: ${label} | ${share}${stop.coveredWhere ? ` [bedekt door ${short(stop.coveredWhere, 50)}]` : ""}${stop.inViewport ? "" : " [buiten venster]"}`;
}

/** How long `taborder` waits for the second browsers: they walk while Chromium does, so this is rarely used up. */
const WALK_GRACE_MS = 4000;
/** The most stops a walk makes. A page with more is cut off there, and the print says so. */
const WALK_CAP = 120;
const MAX_NOT_REACHED = 10;

interface Focused {
  path: string[];
  tag: string;
  text: string;
}

const focusedNow = (context: Context): Promise<Focused | null> =>
  context.surface.page.evaluate(() => (window as unknown as { __loep: { focusState: () => Focused | null } }).__loep.focusState()).then((state) => (state ? { path: state.path, tag: state.tag, text: state.text } : null));

/**
 * Where the walk has to start so that its first Tab lands on the element given with --from:
 * on the stop before it ("before"), or at the top when it is the first stop of the page
 * ("top"). When the stop before it does not keep focus there is no such place: the walk then
 * starts after the element and the element is put in front as a stop ("after"). Undefined
 * when the element does not take focus at all; the walk goes on from where focus is.
 */
async function startOfWalk(context: Context, firstPredicted: string | null): Promise<{ kind: "before"; path: string[] } | { kind: "top" } | { kind: "after" } | undefined> {
  const { page } = context.surface;
  const took = await page.evaluate((chain) => {
    const library = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; deepActiveElement: () => HTMLElement | null } }).__loep;
    const element = library.resolve(chain);
    element?.focus();
    return element !== null && library.deepActiveElement() === element;
  }, context.target!.path);
  if (!took) return undefined;
  await page.keyboard.press("Shift+Tab");
  const before = await focusedNow(context);
  if (before && where(before.path) !== where(context.target!.path)) return { kind: "before", path: before.path };
  return firstPredicted === where(context.target!.path) ? { kind: "top" } : { kind: "after" };
}

export const taborderWith = (raw: Handler, single: Handler, command: string): Handler => async (context, args, options) => {
  if (!context.services) return single(context, args, options);
  const browsers = browsersOf(context);
  const { page } = context.surface;
  const from = context.target ? where(context.target.path) : undefined;
  // The whole page, unless a lower limit is asked for.
  const max = Math.min(WALK_CAP, Math.max(1, Number(options.max ?? WALK_CAP) || WALK_CAP));
  await ensureHelpers(page);
  // The prediction is made on the page as it is before any key is pressed.
  let firstOfPage: string | null = null;
  const predicted = await runMethod("tabbable", browsers, async () => {
    const order = await predictedOrder(page);
    firstOfPage = order.stops[0]?.where ?? null;
    if (!from) return order;
    const at = order.stops.findIndex((stop) => stop.where === from);
    if (at >= 0) return { ...order, stops: order.stops.slice(at) };
    // The prediction does not know the start element (a frame, a scrollable region): it goes on from the first stop that comes after it in the document.
    const after = await page.evaluate(([start, places]) => {
      const helpers = (window as unknown as { __loepm: { resolveWhere: (place: string) => Element | null } }).__loepm;
      const element = helpers.resolveWhere(start as string);
      if (!element) return -1;
      return (places as string[]).findIndex((place) => {
        const other = helpers.resolveWhere(place);
        return other !== null && (element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !element.contains(other);
      });
    }, [from, order.stops.map((stop) => stop.where)] as const);
    return { ...order, stops: after < 0 ? [] : order.stops.slice(after) };
  });
  // What keeps a user from a predicted stop: such a stop is in the DOM and is no stop of the page as it is now.
  const blocked = new Map<string, string>();
  if (predicted.ok) {
    const places = predicted.value.result.stops.map((stop) => stop.where);
    const reasons = await page.evaluate((list) => (window as unknown as { __loepm: { blockedPlaces: (places: string[]) => (string | null)[] } }).__loepm.blockedPlaces(list), places).catch(() => [] as (string | null)[]);
    places.forEach((place, index) => {
      if (reasons[index]) blocked.set(place, reasons[index]!);
    });
  }
  // What can take focus and is shown, before the walk and after it: a block that swaps its content shows other elements at the two moments.
  const shownNow = async (): Promise<Set<string | null> | null> =>
    page
        .evaluate(() => {
          const helpers = (window as unknown as { __loepm: { deepAll: () => Element[]; where: (element: Element) => string | null } }).__loepm;
          return helpers
            .deepAll()
            .filter((element) => element.ownerDocument === document && element.matches("a,button,input,select,textarea,summary,iframe,audio,video,[tabindex],[contenteditable]") && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })))
            .map((element) => helpers.where(element));
        })
        .then((places) => new Set(places), () => null);
  const existedBefore = await shownNow();
  const walk = (surface: Surface, key: string): Promise<TabOrder> => lightWalk(surface.page, { key, max, from });
  const slows = [
    inSecondBrowser(context, "webkit-tab", "webkit", `${from ?? ""}|${max}`, true, (surface) => walk(surface, "Alt+Tab")),
    inSecondBrowser(context, "firefox-tab", "firefox", `${from ?? ""}|${max}`, true, (surface) => walk(surface, "Tab")),
  ].filter((slow): slow is Slow => slow !== null).map((slow) => ({ ...slow, graceMs: WALK_GRACE_MS }));
  // The second browsers start now and walk while Chromium does.
  await prestart(context, slows);
  // With --from the walk includes the element itself: it starts one stop earlier.
  let walkContext = context;
  let putInFront = false;
  if (context.target) {
    const start = await startOfWalk(context, firstOfPage);
    if (start?.kind === "before") walkContext = { ...context, target: { ...context.target, path: start.path } };
    else if (start?.kind === "top") walkContext = { ...context, target: null };
    else if (start?.kind === "after") putInFront = true;
  }
  const started = Date.now();
  const walked = await raw(walkContext, args, { ...options, max: String(putInFront ? Math.max(1, max - 1) : max) });
  const result = walked.result as { outcome: string; stops: WalkStop[]; initialFocus?: Focused | null };
  // With --from, what had focus before the first Tab is where the walk was put, not a stop of its own.
  if (context.target) result.initialFocus = null;
  if (putInFront && context.target) {
    // The start element could not be reached with Tab from the stop before it; it is a stop all the same, measured by `focus`.
    const target = context.target;
    result.stops.unshift({ ref: target.ref, path: target.path, tag: target.tag, role: null, text: target.text, inViewport: true, coveredBy: null, focusPixelShare: null, indicatorRatio: null, focusNotMeasured: `begin van de wandeling; meet met focus ${target.ref}` });
  }
  await completeWalk(context, result.stops);
  const reached = new Set(result.stops.map((stop) => where(stop.path)));
  const kindList = [...new Set([...reached, ...(predicted.ok ? predicted.value.result.stops.map((stop) => stop.where.split(" | ")[0]!) : [])])];
  const kindsFound = await page.evaluate((list) => (window as unknown as { __loepm: { stopKinds: (places: string[]) => (string | null)[] } }).__loepm.stopKinds(list), kindList).catch(() => [] as (string | null)[]);
  const kinds = new Map(kindList.flatMap((place, index) => (kindsFound[index] ? [[place, kindsFound[index]!] as [string, string]] : [])));
  // A block that swaps its own content puts other elements on the page between the prediction and the walk.
  // What the DOM predicts now and did not predict then, or the other way round, changed by itself: no method is wrong about it.
  if (predicted.ok) {
    const again = await predictedOrder(page).catch(() => null);
    if (again) {
      const [then, now] = [new Set(predicted.value.result.stops.map((stop) => stop.where)), new Set(again.stops.map((stop) => stop.where))];
      for (const place of [...then].filter((entry) => !now.has(entry) && !reached.has(entry))) kinds.set(place, "changed");
      for (const place of [...now].filter((entry) => !then.has(entry) && reached.has(entry))) kinds.set(place, "changed");
    }
    // A stop of the walk that was not on the page at all when the prediction was made came with such a swap too.
    // When the page could not be read at one of the two moments, nothing is concluded from it.
    if (existedBefore) for (const place of reached) if (!existedBefore.has(place) && !kinds.has(place)) kinds.set(place, "changed");
    // And a predicted stop that is no longer shown went with one.
    const shownAfter = await shownNow();
    if (shownAfter) for (const stop of predicted.value.result.stops) if (!reached.has(stop.where) && !shownAfter.has(stop.where) && !kinds.has(stop.where)) kinds.set(stop.where, "changed");
  }

  // "Completed" is only true when focus came round to the start or left the page after the last stop there is.
  // When the DOM predicts more stops after the last one the walk made, focus got lost on the way.
  let lost: { after: string; next: TabStop; nextRef: number | null; remaining: TabStop[]; throwsAway: boolean | null } | null = null;
  if (predicted.ok && result.outcome === "completed" && result.stops.length > 0) {
    const open = predicted.value.result.stops.filter((stop) => !blocked.has(stop.where) && !kinds.has(stop.where));
    const lastAt = Math.max(...result.stops.map((stop) => open.findIndex((entry) => entry.where === where(stop.path))));
    const remaining = lastAt >= 0 ? open.slice(lastAt + 1).filter((stop) => !reached.has(stop.where)) : [];
    if (remaining.length > 0) {
      const next = remaining[0]!;
      const throwsAway = await page.evaluate((place) => (window as unknown as { __loepm: { keepsFocus: (place: string) => boolean | null } }).__loepm.keepsFocus(place), next.where).then((kept) => (kept === null ? null : !kept), () => null);
      const doc = await syncRefs(context.surface);
      const nextRef = (await tgs<(number | null)[]>(context.surface, "refsForPaths", [next.where.split(" >>> ")]).catch(() => [null]))[0] ?? null;
      if (doc && nextRef !== null) remember(context.surface, doc, [{ ref: nextRef, path: next.where.split(" >>> "), tag: next.tag }]);
      lost = { after: where(result.stops.at(-1)!.path), next, nextRef, remaining, throwsAway };
    }
  }
  const outcome = lost ? "focus-lost" : result.outcome;
  const chromium = await ownMethod("chromium-tab", browsers, { ...(walked.result as object), outcome }, Date.now() - started);
  return withBackground(context, command, options, slows, (answers, pending) => {
    const slow = split<TabOrder>(answers);
    // A predicted stop that the walk did not reach and that is blocked is left out of the comparison, and named.
    const leftOut = predicted.ok ? predicted.value.result.stops.filter((stop) => blocked.has(stop.where) && !reached.has(stop.where.split(" | ")[0]!)) : [];
    const forComparison = predicted.ok ? [{ ...predicted.value, result: { ...predicted.value.result, stops: predicted.value.result.stops.filter((stop) => !leftOut.includes(stop)) } }] : [];
    // A walk that lost focus is compared over the stops it made, like a walk that reached its limit.
    const walkedOrder = orderFromWalk(walked.result as Parameters<typeof orderFromWalk>[0]);
    const orders: MethodResult<TabOrder>[] = [{ ...chromium, result: lost ? { ...walkedOrder, outcome: "limit-reached" } : walkedOrder }, ...forComparison, ...slow.methods];
    const comparison = compareOrders(orders, kinds);
    const methods: MethodResult[] = [chromium, ...(predicted.ok ? [predicted.value] : []), ...slow.methods];
    const measured = measuredBy(methods, comparison.differences, { failed: [...(predicted.ok ? [] : [predicted.failure]), ...slow.failed], pending });
    // For every predicted stop the walk did not make: what the walk did there.
    const reasonFor = (stop: TabStop): string =>
      blocked.get(stop.where) ?? (lost && lost.next.where === stop.where ? (lost.throwsAway ? "krijgt focus en gooit die meteen weg" : "hier verdween focus") : lost && lost.remaining.includes(stop) ? "na het punt waar focus verdween; niet bereikt, niet overgeslagen" : result.outcome === "limit-reached" ? "voorbij de grens van de wandeling" : "overgeslagen door Tab, hoewel de DOM het als stop voorspelt");
    // Stops with the same reason are one line: the reason once, the stops by their text or the end of their selector.
    const byReason = new Map<string, string[]>();
    if (predicted.ok) {
      for (const stop of predicted.value.result.stops) {
        if (reached.has(stop.where.split(" | ")[0]!) || kinds.has(stop.where) || (result.initialFocus && where(result.initialFocus.path) === stop.where)) continue;
        const reason = reasonFor(stop);
        byReason.set(reason, [...(byReason.get(reason) ?? []), stop.text.trim() ? `${stop.tag} "${short(stop.text, 28)}"` : short(stop.where.split(" > ").slice(-2).join(" > "), 40)]);
      }
    }
    const notReached = [...byReason.entries()].map(([reason, stops]) => `${reason}: ${stops.slice(0, MAX_NOT_REACHED).join(", ")}${stops.length > MAX_NOT_REACHED ? ` (+${stops.length - MAX_NOT_REACHED})` : ""}`);
    const notes = [
      ...(slow.methods.some((method) => idOf(method) === "webkit-tab") ? [`webkit-tab: ${knownError("webkit-tab", "alt-tab")}`] : []),
      ...(result.initialFocus && !reached.has(where(result.initialFocus.path)) ? [`focus stond al op ${short(where(result.initialFocus.path), 60)} voordat Tab werd ingedrukt en kwam er niet op terug; het telt mee als stop`] : []),
      ...(leftOut.length > 0 ? [`tabbable: ${leftOut.length} voorspelde stops niet meegeteld, want ${[...new Set(leftOut.map((stop) => blocked.get(stop.where)))].slice(0, 3).join("; ")}`] : []),
    ];
    const covered = result.stops.filter((stop) => stop.coveredWhere).length;
    return {
      result: { ...measured, orders: comparison.groups, knownDifferences: comparison.known, leftOut: leftOut.map((stop) => ({ where: stop.where, reason: blocked.get(stop.where) })), notReached, ...(lost ? { focusLost: { after: lost.after, next: lost.next.where, throwsAway: lost.throwsAway, remaining: lost.remaining.map((stop) => stop.where) } } : {}) },
      print: {
        outcome,
        ...(lost
          ? { stopped: `focus verdween na ${short(lost.after, 60)}: de volgende stop volgens de DOM is ref ${lost.nextRef ?? "?"} ${lost.next.tag} "${short(lost.next.text, 30)}"${lost.throwsAway ? ", en die gooit focus weg zodra hij die krijgt" : ""}; daarna zijn nog ${lost.remaining.length - 1} stops niet bereikt. De wandeling is dus niet rond. Ga verder met taborder --from <ref van de stop daarna>` }
          : {}),
        stops: result.stops.map(stopLine),
        ...(result.outcome === "limit-reached" ? { truncated: `afgekapt na ${result.stops.length} stops (--max, hoogstens ${WALK_CAP}); de pagina heeft er meer, en de methoden zijn over deze stops vergeleken` } : {}),
        ...(covered > 0 ? { covered: `${covered} stops liggen onder een ander element; daar zegt "geen verandering" niets over de focusindicator` } : {}),
        images: (walked.print as { images?: string }).images,
        note: "per stop: [nummer van het beeld in images, ook het nummer op sheet <id>] ref, element, aandeel pixels dat met focus verandert en contrast van de focusindicator",
        ...methodLines(measured),
        ...(comparison.groups.length > 1 ? { orders: comparison.groups.map((group) => `${group.by.join(", ")}: ${group.stops} stops`), disagree: comparison.differences.map((line) => short(line, 300)) } : {}),
        ...(notReached.length > 0 && (comparison.differences.length > 0 || lost) ? { notReached } : {}),
        ...(comparison.known.length > 0 ? { knownDifferences: comparison.known.map((line) => short(line, 260)) } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      },
    };
  });
};

// ------------------------------------------------------------- reflow, zoom and spacing

/** What one browser measured of a page at a size or with the wider text spacing: the part of the answer two browsers are compared on. */
export interface LayoutAnswer {
  /** Whether the page scrolls sideways. */
  horizontalScroll: boolean;
  /** Width of the content in CSS pixels; null when the measurement does not give it. */
  scrollWidth: number | null;
  /** Elements that stick out past the edge of the window; absent for the text spacing, which does not list them. */
  offenders?: LayoutPlace[];
  /** Text that is cut off. For the text spacing: text that is cut off with the spacing and was not without it. */
  clipped: LayoutPlace[];
  /** For the text spacing: pieces of text that did not take the spacing. */
  textWithoutSpacing?: number;
}

interface LayoutPlace {
  path: string[];
  tag: string;
  text: string;
}

/** The in-page measurement lists at most this many elements; a list that long is not compared element by element. */
const LAYOUT_LIST_CAP = 50;
const MAX_LAYOUT_NAMED = 5;
const yesNo = (value: boolean): string => (value ? "ja" : "nee");
const placeLine = (place: LayoutPlace): string => `${place.tag}: ${short(place.text.replace(/\s+/g, " ").trim(), 40)}`;

/** One line that says what a browser measured. */
export function layoutLine(answer: LayoutAnswer): string {
  return [
    answer.horizontalScroll ? `schuift opzij${answer.scrollWidth === null ? "" : ` (inhoud ${answer.scrollWidth} px breed)`}` : "schuift niet opzij",
    ...(answer.offenders ? [`${answer.offenders.length} steekt uit`] : []),
    `${answer.clipped.length} afgekapt`,
    ...(answer.textWithoutSpacing === undefined ? [] : [`${answer.textWithoutSpacing} zonder de afstand`]),
  ].join(", ");
}

/**
 * Where two browsers measured something else on the same page in the same state: whether the
 * page scrolls sideways, which elements stick out and which text is cut off. Elements are
 * matched by their selector chain. The width of the content is named and not compared: two
 * browsers set the same text a few pixels apart.
 */
export function layoutDifferences(first: { id: string; answer: LayoutAnswer }, second: { id: string; answer: LayoutAnswer }): string[] {
  const differences: string[] = [];
  const [a, b] = [first.answer, second.answer];
  const width = (answer: LayoutAnswer): string => (answer.scrollWidth === null ? "" : ` (inhoud ${answer.scrollWidth} px breed)`);
  if (a.horizontalScroll !== b.horizontalScroll) differences.push(`opzij schuiven: ${first.id} ${yesNo(a.horizontalScroll)}${width(a)}, ${second.id} ${yesNo(b.horizontalScroll)}${width(b)}`);
  const lists: [string, LayoutPlace[] | undefined, LayoutPlace[] | undefined][] = [["steekt uit", a.offenders, b.offenders], ["afgekapt", a.clipped, b.clipped]];
  for (const [what, inFirst, inSecond] of lists) {
    if (!inFirst || !inSecond) continue;
    if (inFirst.length >= LAYOUT_LIST_CAP || inSecond.length >= LAYOUT_LIST_CAP) {
      if (inFirst.length !== inSecond.length) differences.push(`${what}: ${first.id} ${inFirst.length}, ${second.id} ${inSecond.length}; de lijst is afgekapt op ${LAYOUT_LIST_CAP} en niet per element vergeleken`);
      continue;
    }
    for (const [here, there, id] of [[inFirst, inSecond, first.id], [inSecond, inFirst, second.id]] as const) {
      const known = new Set(there.map((place) => where(place.path)));
      const only = here.filter((place) => !known.has(where(place.path)));
      if (only.length > 0) differences.push(`${what} alleen in ${id}: ${only.slice(0, MAX_LAYOUT_NAMED).map(placeLine).join("; ")}${only.length > MAX_LAYOUT_NAMED ? ` (+${only.length - MAX_LAYOUT_NAMED})` : ""}`);
    }
  }
  if (a.textWithoutSpacing !== undefined && b.textWithoutSpacing !== undefined && a.textWithoutSpacing !== b.textWithoutSpacing) differences.push(`tekst die de afstand niet kreeg: ${first.id} ${a.textWithoutSpacing}, ${second.id} ${b.textWithoutSpacing}`);
  return differences;
}

const overflowAnswer = (result: { horizontalScroll: boolean; scrollWidth: number; offenders: LayoutPlace[]; clipped: LayoutPlace[] }): LayoutAnswer => ({ horizontalScroll: result.horizontalScroll, scrollWidth: result.scrollWidth, offenders: result.offenders, clipped: result.clipped });
const spacingAnswer = (result: { horizontalScrollAfter: boolean; newlyClipped: unknown[]; textWithoutSpacingCount: number }): LayoutAnswer => ({ horizontalScroll: result.horizontalScrollAfter, scrollWidth: null, clipped: result.newlyClipped as LayoutPlace[], textWithoutSpacing: result.textWithoutSpacingCount });

const LAYOUT_OPEN_POINT = "de browsers meten hier iets anders. Dat is een open punt en op zichzelf geen bevinding: bekijk beide beelden en stel vast wat een gebruiker in elke browser verliest";

interface LayoutKind {
  /** The method in Chromium and the same method in WebKit, as the register of methods names them. */
  own: string;
  webkit: string;
  /** What the measurement in WebKit depends on besides the state of the page. */
  detail: (context: Context) => string;
  /** The same measurement on the page of WebKit, with a picture; the page is put back as it was. */
  measure: (size: string, page: Surface["page"], picture: string) => Promise<Record<string, unknown>>;
  answer: (result: never) => LayoutAnswer;
}

const REFLOW_WINDOW = { width: 320, height: 256 };

/** Half the window: the layout of 200% zoom. */
const halfWindow = (context: Context): { width: number; height: number } => {
  const viewport = context.surface.page.viewportSize()!;
  return { width: Math.round(viewport.width / 2), height: Math.round(viewport.height / 2) };
};

const overflowKind = (size: (context: Context) => { width: number; height: number }): LayoutKind => ({
  own: "overflow-geometry",
  webkit: "webkit-overflow",
  detail: (context) => `${size(context).width}x${size(context).height}`,
  measure: async (detail, page, picture) => {
    const [width, height] = detail.split("x").map(Number) as [number, number];
    // What is clickable at this size is not asked again: that needs Chromium, and the browsers are compared on the geometry.
    return { viewport: { width, height }, ...(await overflowGeometryAtSize(page, { width, height }, picture)) };
  },
  answer: overflowAnswer as LayoutKind["answer"],
});

const LAYOUT_KINDS: Record<"reflow" | "zoom" | "spacing", LayoutKind> = {
  reflow: overflowKind(() => REFLOW_WINDOW),
  zoom: overflowKind(halfWindow),
  spacing: {
    own: "forced-text-spacing",
    webkit: "webkit-spacing",
    detail: () => "wcag-1.4.12",
    measure: async (_detail, page, picture) => ({ ...(await textSpacing(page, picture, true)) }),
    answer: spacingAnswer as LayoutKind["answer"],
  },
};

/** How long `reflow`, `zoom` and `spacing` wait for WebKit, which measures while Chromium does. */
const LAYOUT_GRACE_MS = 4000;

/**
 * `reflow`, `zoom` and `spacing`: the measurement in Chromium as before, and the same
 * measurement in WebKit on a page brought to the same state. WebKit starts before Chromium
 * measures and its page stays open, so the three commands after each other load the page in
 * WebKit once. A difference between the browsers is printed as an open point.
 */
export const layoutWith = (raw: Handler, single: Handler, command: "reflow" | "zoom" | "spacing"): Handler => async (context, args, options) => {
  if (!context.services) return single(context, args, options);
  const kind = LAYOUT_KINDS[command];
  const browsers = browsersOf(context);
  // The size is read now: Chromium changes its window while it measures.
  const detail = kind.detail(context);
  const picture = context.images.image("-webkit");
  const image = context.images.relative(picture);
  const webkit = inSecondBrowser(context, kind.webkit, "webkit", detail, false, async (surface) => {
    const result = await kind.measure(detail, surface.page, picture);
    // WebKit can be slower than Chromium, and its picture is then written after the record of the command: the hash of the picture is part of the answer.
    return { ...result, image, imageSha256: await sha256File(picture) };
  });
  // The key is fixed now too: it holds the size of the window.
  const slows = await withKeys(context, webkit ? [{ ...webkit, graceMs: LAYOUT_GRACE_MS }] : []);
  const jobs = context.services.jobs;
  if (jobs) for (const slow of slows) jobs.start(slow.key, slow.id, slow.work);
  const started = Date.now();
  const measured = await raw(context, args, options);
  const own = await ownMethod(kind.own, browsers, measured.result, Date.now() - started);
  return withBackground(context, command, options, slows, (answers, pending) => {
    const slow = split<Record<string, unknown>>(answers);
    const other = slow.methods[0];
    const mine = kind.answer(own.result as never);
    const theirs = other ? kind.answer(other.result as never) : null;
    const differences = theirs ? layoutDifferences({ id: "chromium", answer: mine }, { id: "webkit", answer: theirs }) : [];
    const result = measuredBy<unknown>([own, ...slow.methods], differences, { failed: slow.failed, pending });
    return {
      result,
      print: {
        ...measured.print,
        ...methodLines(result),
        ...(theirs ? { browsers: { chromium: layoutLine(mine), webkit: layoutLine(theirs) }, webkitImage: other!.result.image } : {}),
        ...(differences.length > 0 ? { disagree: differences, note: LAYOUT_OPEN_POINT } : {}),
      },
    };
  });
};

// ---------------------------------------------------------------------------------- lang

const MAX_BLOCKS = 300;
const MAX_MISMATCHES = 8;

export const lang: Handler = async (context) => {
  const { surface } = context;
  const target = context.target ? where(context.target.path) : null;
  const { subject, blocks } = await languagePieces(surface.page, target, MAX_BLOCKS);
  const pieces: LanguagePiece[] = [subject, ...blocks];
  const { methods, failed } = await detectLanguages(pieces, browsersOf(context));
  markKnownLanguages(pieces, methods);
  const verdicts = languageVerdicts(pieces, methods);
  const measured = measuredBy(methods, languageDifferences(pieces, methods), { failed });
  const own = verdicts[0]!;
  const detected = (verdict: (typeof verdicts)[number]): string => {
    const values = [...new Set(Object.values(verdict.detected))];
    return values.length === 1 ? String(values[0] ?? "?") : Object.entries(verdict.detected).map(([id, language]) => `${id} ${language ?? "?"}`).join(", ");
  };
  const print: Record<string, unknown> = { declared: own.declared, detected: detected(own), verdict: own.verdict, words: own.words, ...(own.reason ? { reason: own.reason } : {}) };
  let listed: ((typeof verdicts)[number] & { ref: number | null })[] = [];
  if (!target) {
    const doc = await syncRefs(surface);
    const refs = await tgs<(number | null)[]>(surface, "refsForPaths", blocks.map((block) => block.path ?? []));
    listed = verdicts.slice(1).map((verdict, index) => ({ ...verdict, ref: refs[index] ?? null }));
    if (doc) remember(surface, doc, listed.map((entry) => ({ ref: entry.ref, path: entry.path ?? [] })));
    const of = (wanted: string): typeof listed => listed.filter((entry) => entry.verdict === wanted);
    const mismatches = of("mismatch");
    Object.assign(print, {
      blocks: `${blocks.length} stukken tekst: ${of("match").length} kloppen, ${mismatches.length} wijken af, ${of("cantTell").length} niet te bepalen`,
      ...(mismatches.length > 0 ? { mismatches: mismatches.slice(0, MAX_MISMATCHES).map((entry) => `ref ${entry.ref ?? "?"} ${entry.path?.at(-1)?.split(" > ").at(-1) ?? ""}: ${detected(entry)} (opgegeven ${entry.declared ?? "geen"}): ${short(entry.text, 50)}`) } : {}),
      ...(mismatches.length > MAX_MISMATCHES ? { moreMismatches: mismatches.length - MAX_MISMATCHES } : {}),
    });
  }
  return { result: { ...measured, subject: own, blocks: listed }, print: { ...print, ...methodLines(measured, knownLines(methods)), ...(measured.differences.length > 0 ? { disagree: measured.differences.slice(0, 5).map((line) => short(line, 120)) } : {}) } };
};

// -------------------------------------------------------------------------------- source

const MAX_SOURCE_LINES = 20;

export const source: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const received = surface.received;
  if (!received) throw new Error("van deze pagina is geen antwoord van de server bewaard; open de pagina opnieuw");
  const body = await received.body().catch(() => null);
  if (!body) throw new Error("de browser heeft het antwoord van de server niet meer; open de pagina opnieuw");
  const charset = /charset=([\w-]+)/i.exec(received.headers()["content-type"] ?? "")?.[1] ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(body);
  } catch {
    text = body.toString("utf8");
  }
  const path = images.file("-source.html");
  await writeFileAtomic(path, body);
  const browsers = browsersOf(context);
  const fast = await runMethod("html-validate", browsers, () => htmlValidate(text));
  // Where a selector leads in the page as it is now is looked up here, while the page is at hand; the validator in the background may answer later.
  const places = await sourcePlaces(surface.page, fast.ok ? fast.value.result.findings.map((finding) => finding.selector) : []);
  const slow: Slow = { id: "vnu", detail: String(body.length), graceMs: BINARY_GRACE_MS, work: () => runMethod("vnu", browsers, () => vnu(path), 70_000) };
  return withBackground(context, "parse", options, [slow], (answers, pending) => {
    const background = split<SourceAnswer>(answers);
    const methods = [...background.methods, ...(fast.ok ? [fast.value] : [])];
    const located = locateSourceFindings(methods, places);
    const comparison = compareSource(methods);
    const measured = measuredBy(methods, comparison.differences, { failed: [...background.failed, ...(fast.ok ? [] : [fast.failure])], pending });
    const tag = (line: (typeof comparison.lines)[number]): string => (Object.keys(line.by).length === methods.length && methods.length > 1 ? "beide" : `alleen ${Object.keys(line.by).join(", ")}`);
    return {
      result: { ...measured, url: received.url(), status: received.status(), bytes: body.length, lines: comparison.lines, located },
      print: {
        source: images.relative(path),
        bytes: body.length,
        counts: Object.fromEntries(methods.map((method) => [idOf(method), `${method.result.counts.failed} failed, ${method.result.counts.cantTell} cantTell`])),
        ...methodLines(measured),
        lines: comparison.lines.slice(0, MAX_SOURCE_LINES).map((line) => `r${line.line} [${tag(line)}] ${Object.entries(line.by).map(([id, found]) => `${id} ${[...new Set(found)].join("+")}`).join(" | ")}: ${short(line.message, 70)}`),
        ...(comparison.lines.length > MAX_SOURCE_LINES ? { moreLines: comparison.lines.length - MAX_SOURCE_LINES } : {}),
        located: `${located.located} van ${located.total} meldingen aan een element van de pagina gekoppeld`,
      },
    };
  });
};

// ----------------------------------------------------------------------------------- ocr

export const ocrCommand: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const target = context.target!;
  const place = where(target.path);
  const path = images.image();
  const box = { x: Math.max(0, target.box.x), y: Math.max(0, target.box.y), width: Math.max(1, target.box.width), height: Math.max(1, target.box.height) };
  if (target.box.width < 4 || target.box.height < 4) throw new Error("het element is te klein of niet zichtbaar om te lezen");
  await regionScreenshot(surface.page, box, { path });
  const browsers = browsersOf(context);
  await ensureHelpers(surface.page);
  const alternative = await runMethod("alt-text", browsers, async () => {
    const facts = await surface.page.evaluate((element) => (window as unknown as { __loepm: { imageFacts: (place: string) => (Record<string, unknown> & { alt: string | null }) | null } }).__loepm.imageFacts(element), place);
    if (!facts) throw new Error("het element is van de pagina verdwenen");
    const named = await namesOf(surface.page, place, browsers, await alfaShare(surface)).then((run) => run.methods.find((method) => idOf(method) === "chromium")?.result ?? null);
    return { ...facts, name: named?.name ?? "", ignored: named?.ignored ?? false };
  });
  const slow: Slow = { id: "tesseract", detail: `${place}|${box.width}x${box.height}`, graceMs: BINARY_GRACE_MS, work: () => runMethod("tesseract", browsers, () => ocr(path, { sparse: true }), 40_000) };
  return withBackground(context, "ocr", options, context.services?.jobs ? [slow] : [], (answers, pending) => {
    const read = split<OcrAnswer>(answers);
    const methods: MethodResult[] = [...read.methods, ...(alternative.ok ? [alternative.value] : [])];
    const found = read.methods[0]?.result ?? null;
    const name = alternative.ok ? alternative.value.result.name : "";
    const alt = alternative.ok ? alternative.value.result.alt : null;
    const share = found?.hasText ? overlap(found.text, name) : null;
    const differences: string[] = [];
    if (found?.hasText && alternative.ok) {
      if (name === "") differences.push("tesseract leest tekst in de afbeelding; hulpsoftware krijgt er geen tekst voor");
      else if (share !== null && share < 0.5) differences.push(`tesseract leest tekst waarvan ${Math.round(share * 100)}% in het tekstalternatief staat`);
    }
    const measured = measuredBy(methods, differences, { failed: [...read.failed, ...(alternative.ok ? [] : [alternative.failure])], pending });
    return {
      result: { ...measured, overlap: share },
      print: {
        image: images.relative(path),
        alt,
        ...(name !== (alt ?? "") ? { name } : {}),
        ...(found ? { read: short(found.text, 160), words: found.words, confidence: found.confidence, hasText: found.hasText, ...(found.sparseWords ? { sparseWords: found.sparseWords } : {}), ...(share !== null ? { overlap: share } : {}) } : {}),
        ...methodLines(measured),
        ...(differences.length > 0 ? { disagree: differences } : {}),
      },
    };
  });
};

// -------------------------------------------------------------------------------- motion

export const motion: Handler = async (context, _args, options) => {
  const { surface } = context;
  const seconds = Math.min(6, Math.max(0.5, Number(options.seconds ?? 1) || 1));
  const browsers = browsersOf(context);
  const api = await runMethod("animation-api", browsers, () => apiMotion(surface.page));
  const pixels = await runMethod("screenshot-diff", browsers, () => pixelMotion(surface.page, seconds), 20_000);
  const { methods, failed } = sortRan<unknown>([api, pixels]);
  const differences: string[] = [];
  let ref: number | null = null;
  if (pixels.ok && pixels.value.result.element) {
    const doc = await syncRefs(surface);
    ref = (await tgs<(number | null)[]>(surface, "refsForPaths", [pixels.value.result.element.path]))[0] ?? null;
    if (doc && ref !== null) remember(surface, doc, [{ ref, path: pixels.value.result.element.path }]);
  }
  if (api.ok && pixels.ok && api.value.result.moves !== pixels.value.result.moves) {
    differences.push(pixels.value.result.moves ? "screenshot-diff ziet beweging; animation-api kent geen lopende animatie of spelende video" : "animation-api meldt een lopende animatie of een spelende video; screenshot-diff ziet geen verandering");
  }
  const measured = measuredBy(methods, differences, { failed });
  const moves = api.ok && pixels.ok && api.value.result.moves === pixels.value.result.moves ? api.value.result.moves : null;
  return {
    result: { ...measured, seconds, ref },
    print: {
      ...(moves !== null ? { moves } : {}),
      ...(api.ok ? { api: `${api.value.result.runningAnimations} lopende animaties, ${api.value.result.playingVideo} spelende video's; autoplay (ook geluid) ${api.value.result.autoplayMedia}, marquee of blink ${api.value.result.marqueeBlink}, gif ${api.value.result.gifImages}` } : {}),
      ...(pixels.ok ? { pixels: `${pixels.value.result.changedPixels.filter((count) => count >= 20).length} van ${pixels.value.result.changedPixels.length} beeldparen veranderd in ${Math.round(pixels.value.result.observedMs / 100) / 10} s, ${pixels.value.result.area === "page" ? "hele pagina" : "alleen het venster"}`, ...(pixels.value.result.element ? { region: `ref ${ref ?? "?"} ${pixels.value.result.element.tag}: ${short(pixels.value.result.element.text, 40)}` } : {}) } : {}),
      ...methodLines(measured),
      ...(differences.length > 0 ? { disagree: differences } : {}),
      note: `gemeten over ${seconds} s; WCAG 2.2.2 gaat over beweging die langer dan 5 s duurt (--seconds 6)`,
    },
  };
};

// -------------------------------------------------------------------------- tools and wait

/** Every method with its version and whether it can run on this machine; also written into the manifest of the run. */
export async function toolsOutcome(runDir: string, versions: BrowserVersions): Promise<Outcome> {
  const tools = await toolStatus(versions, (browser) => SecondBrowsers.installed(browser));
  const recorded = await writeManifestTools(runDir, tools);
  const questions = [...new Set(tools.flatMap((tool) => tool.questions))];
  // A method in a virtual machine is not something to install: that it is missing shows in its line, and the manifest keeps the reason.
  const unavailable = tools.filter((tool) => !tool.available && !(typeof methodById(tool.id).source === "object" && "guest" in (methodById(tool.id).source as object)));
  return {
    result: { tools },
    print: {
      // The sha256 of a model is in the record and in the manifest; the printed line names the model only.
      tools: Object.fromEntries(questions.map((question) => [question, tools.filter((tool) => tool.questions.includes(question)).map((tool) => `${tool.id}${tool.available ? "" : " (ontbreekt)"} ${tool.version.replace(/ sha256:[0-9a-f]{64}/, "")}`).join(", ")])),
      ...(unavailable.length > 0 ? { unavailable: [...new Set(unavailable.map((tool) => `${tool.id}: ${tool.hint}`))] } : {}),
      manifest: recorded ? "manifest.json" : "niet bijgewerkt: de run is verzegeld",
    },
  };
}

/** Wait for the background methods of the session and finish the commands that were waiting for them. */
export async function waitOutcome(jobs: Jobs, options: Options, limitMs: number): Promise<Outcome> {
  const seconds = Number(options.timeout ?? 0);
  const drained = await jobs.drain(Number.isFinite(seconds) && seconds > 0 ? Math.min(limitMs, seconds * 1000) : limitMs);
  return {
    result: { completed: drained.completed.map((entry) => ({ completes: entry.origin, command: entry.command, result: entry.outcome.result })), stillRunning: drained.stillRunning },
    print: {
      completed: Object.fromEntries(drained.completed.map((entry) => [entry.origin, { command: entry.command, ...entry.outcome.print }])),
      ...(drained.stillRunning.length > 0 ? { stillRunning: drained.stillRunning } : {}),
      ...(drained.completed.length === 0 && drained.stillRunning.length === 0 ? { note: "er liep niets op de achtergrond" } : {}),
    },
  };
}
