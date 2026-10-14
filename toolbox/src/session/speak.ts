import { axInfo } from "../browser/call.ts";
import { measuredBy, type MethodResult } from "../instruments/methods.ts";
import { runMethod, sortRan, type Ran } from "../instruments/methods/registry.ts";
import { readAloud, REVEALED_NOTE, SIMULATED_NOTE, SIMULATED_READER, speechDifferences, startListening, stopListening, type Heard, type ReadAloud, type SpokenBy } from "../instruments/methods/speech.ts";
import { UsageError, type Context, type Handler, type Options, type Outcome } from "./commands.ts";
import { browsersOf, short, where } from "./opinions.ts";
import { TEST_VALUES } from "./safety.ts";
import { documents, locate, pageFacts, sayFrame, tgs, type Surface } from "./surface.ts";

/** The three fixed probes of `speak`. */
export type SpeakProbe = "element" | "walk" | "after-action";

/** What one reader gives for a probe: what it said, and what it could not say anything about. */
export interface SpeakAnswer extends SpokenBy {
  /** For "element" and "walk": where in the page the first item is, and what the reader went through. */
  read?: Pick<ReadAloud, "at" | "from" | "coverage">;
  /** For "after-action": what a region says that was hidden before the action, and what changed out of reach of assistive technology. */
  revealed?: string[];
  suppressed?: string[];
  /** What is said of the element that got focus by the action; null when focus stayed where it was. */
  focus?: string | null;
  /** The documents that were listened in did not all last until the end: the page went to another address. */
  navigated?: boolean;
}

const DEFAULT_STEPS = 15;
const MAX_STEPS = 60;
const MAX_SECONDS = 5;
const LISTEN_MS = 300;
const MAX_DOCUMENTS = 6;
const MAX_LISTED = 6;

/** Whether `speak` acts on the page with these options: then it is a step of the recipe. */
export const speakActs = (options: Options): boolean => options.click === true || options.type !== undefined;

const AT_NL: Record<ReadAloud["at"], string | null> = {
  top: null,
  element: null,
  inside: "het element zelf wordt niet genoemd; dit is het eerste wat erin wordt voorgelezen",
  nothing: "het element heeft geen rol, naam of tekst: er wordt niets voorgelezen",
  hidden: "het element is verborgen voor hulpsoftware: er wordt niets voorgelezen",
  gone: "het element is van de pagina verdwenen",
};

function coverageLines(read: ReadAloud, walked: boolean): string[] {
  const { coverage } = read;
  return [
    coverage.modalOpen ? "er staat een modaal venster open: alleen de inhoud daarvan wordt voorgelezen" : null,
    walked && coverage.framesNotEntered > 0 ? `${coverage.framesNotEntered} ingesloten ${coverage.framesNotEntered === 1 ? "venster" : "vensters"}: de lezer noemt de titel en gaat er niet in; wijs een element in het venster aan om daar te lezen` : null,
    coverage.complete ? null : `de pagina heeft meer dan ${coverage.items} onderdelen; wat daarna komt is niet gelezen`,
    walked && coverage.customElements > 0 ? `de pagina heeft ${coverage.customElements} eigen ${coverage.customElements === 1 ? "element" : "elementen"} (webcomponenten): een rol of naam die een component buiten de code om zet (ElementInternals), ziet de lezer niet; vergelijk daar met ax` : null,
  ].filter((line): line is string => line !== null);
}

/** The answer in the shape that holds every reader side by side; today there is one, and it is simulated. */
function outcomeOf(probe: SpeakProbe, ran: Ran<SpeakAnswer>, print: (answer: SpeakAnswer, method: MethodResult<SpeakAnswer>) => Record<string, unknown>, extra: Record<string, unknown> = {}, acted?: Outcome): Outcome {
  const { methods, failed } = sortRan([ran]);
  const measured = measuredBy(methods, speechDifferences(methods), { failed });
  const method = methods[0];
  const silence = `de nagebootste schermlezer gaf geen antwoord: ${failed[0]?.reason ?? "onbekende reden"}`;
  // The action was done whether the reader answered or not: it stays a step of the recipe, and the answer says what is missing.
  if (!method && acted) return { result: { ...measured, probe, ...extra }, print: { ...acted.print, readerFailed: silence } };
  if (!method) throw new Error(silence);
  return { result: { ...measured, probe, ...extra }, print: { ...print(method.result, method), reader: `${SIMULATED_READER} ${method.version}`, readerNote: SIMULATED_NOTE } };
}

/** What is said at one element, or the first items from it or from the top of the page. */
async function reading(context: Context, options: Options): Promise<Outcome> {
  const walked = options.steps !== undefined || !context.target;
  const steps = Number(options.steps ?? DEFAULT_STEPS);
  if (walked && (!Number.isInteger(steps) || steps < 1)) throw new UsageError("--steps moet een heel getal van 1 of meer zijn");
  const count = walked ? Math.min(MAX_STEPS, steps) : 1;
  const place = context.target ? where(context.target.path) : null;
  let found: ReadAloud | null = null;
  const ran = await runMethod<SpeakAnswer>(SIMULATED_READER, browsersOf(context), async () => {
    found = await readAloud(context.surface.page, place, count);
    return { spoken: found.spoken, simulated: true, read: { at: found.at, from: found.from, coverage: found.coverage } };
  });
  // What the browser itself gives assistive technology for the element. A component can set a role or a name outside the code (ElementInternals); the reader cannot see that, the browser can.
  const tree = context.target && !walked ? await treeOf(context) : null;
  return outcomeOf(walked ? "walk" : "element", ran, (answer) => {
    const read = found!;
    const unseen = tree && tree.name !== "" && !tree.ignored && !(answer.spoken[0] ?? "").includes(tree.name) ? `de browser geeft hulpsoftware hier ${tree.role ?? "geen rol"} "${short(tree.name, 80)}". De lezer leest de code en ziet niet wat een component daarbuiten zet (ElementInternals): houd hier de browser aan (ax)` : null;
    const remarks = [AT_NL[read.at], unseen, ...coverageLines(read, walked)].filter((line): line is string => line !== null);
    return {
      ...(walked ? { steps: answer.spoken.map((phrase, index) => `${index + 1} ${short(phrase, 160)}`), ...(read.from !== null ? { of: `${read.from + 1}-${read.from + answer.spoken.length} van ${read.coverage.items}` } : {}) } : { spoken: answer.spoken[0] ?? null }),
      ...(remarks.length > 0 ? { remarks } : {}),
    };
  }, tree ? { tree } : {});
}

/** Role and name of the element of a command in the accessibility tree of the browser; null when the browser gives none. */
async function treeOf(context: Context): Promise<{ role: string | null; name: string; ignored: boolean } | null> {
  const { page } = context.surface;
  const cdp = await page.context().newCDPSession(page);
  try {
    const info = await axInfo(cdp, await tgs<number>(context.surface, "toRegistry", context.target!.ref));
    return info ? { role: info.role ?? null, name: (info.name ?? "").replace(/\s+/g, " ").trim(), ignored: Boolean(info.ignored) } : null;
  } catch {
    return null;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Listen in the document of the tab and in every embedded frame a visitor sees. */
async function listenEverywhere(surface: Surface): Promise<Surface[]> {
  const all = (await documents(surface.top).catch(() => [surface.top])).slice(0, MAX_DOCUMENTS);
  const listening: Surface[] = [];
  for (const document of all) {
    if (await startListening(document.page).then(() => true, () => false)) listening.push(document);
  }
  return listening;
}

/** Act on an element with real input and say what is spoken by itself afterwards: a status message, an error, the element focus went to. */
async function afterAction(context: Context, options: Options, actions: SpeakActions): Promise<Outcome> {
  const kind = typeof options.type === "string" ? options.type : null;
  if (options.type !== undefined && (kind === null || !(kind in TEST_VALUES))) throw new UsageError(`--type verwacht een vaste testwaarde; kies uit: ${Object.keys(TEST_VALUES).join(", ")}`);
  if (options.click === true && kind !== null) throw new UsageError("kies --click of --type, niet allebei");
  const act = async (): Promise<Outcome> => {
    if (kind === null) return actions.click(context, [], {});
    const typed = await actions.type(context, [kind], {});
    // A visitor leaves the field with Tab, or sends the form with Enter: only then does a page check what was typed.
    const left = await actions.key(context, [options.submit === true ? "Enter" : "Tab"], {});
    return { result: { ...(left.result as object), typed: typed.result }, print: { ...(typed.print.entered !== undefined ? { entered: typed.print.entered } : {}), ...(typed.print.invalid !== undefined ? { invalid: typed.print.invalid } : {}), ...left.print } };
  };
  // A recorded step that is played again does what the visitor did, without a reader next to it.
  if (!context.services) return act();

  const seconds = Number(options.seconds ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) throw new UsageError("--seconds moet een getal zijn");
  const { surface } = context;
  const focusBefore = (await pageFacts(surface))?.focus?.path.join(" >>> ") ?? null;
  const listening = await listenEverywhere(surface);
  let acted: Outcome;
  const heard: { frame: Surface["frame"]; heard: Heard }[] = [];
  let navigated = false;
  try {
    acted = await act();
    await surface.top.page.waitForTimeout(Math.max(LISTEN_MS, Math.min(MAX_SECONDS, seconds) * 1000));
  } finally {
    for (const document of listening) {
      const found = await stopListening(document.page);
      if (found) heard.push({ frame: document.frame, heard: found });
      else navigated = true;
    }
  }
  const focus = (await pageFacts(surface))?.focus ?? null;
  // Focus that came to the element that was acted on says nothing new: a visitor who activates a control is already on it.
  const moved = focus !== null && focus.path.join(" >>> ") !== focusBefore && focus.ref !== context.target!.ref;
  const ran = await runMethod<SpeakAnswer>(SIMULATED_READER, browsersOf(context), async () => {
    if (listening.length === 0) throw new Error("de lezer kon in geen enkel document van de pagina luisteren");
    const tagged = (list: (entry: Heard) => string[]): string[] => heard.flatMap((entry) => list(entry.heard).map((phrase) => (entry.frame && heard.length > 1 ? `${phrase} [in venster: ${sayFrame(entry.frame)}]` : phrase)));
    let focusSpoken: string | null = null;
    if (moved) {
      const home = await locate(surface.top, focus.path);
      if (home) focusSpoken = (await readAloud(home.surface.page, where(home.path), 1)).spoken[0] ?? null;
    }
    return { spoken: tagged((entry) => entry.spoken), simulated: true, revealed: tagged((entry) => entry.revealed), suppressed: tagged((entry) => entry.suppressed), focus: focusSpoken, navigated };
  });
  const listed = (phrases: string[]): string[] => [...phrases.slice(0, MAX_LISTED).map((phrase) => short(phrase, 200)), ...(phrases.length > MAX_LISTED ? [`(+${phrases.length - MAX_LISTED})`] : [])];
  return outcomeOf(
    "after-action",
    ran,
    (answer) => {
      const { live: _live, ...changes } = acted.print;
      return {
        ...changes,
        spoken: listed(answer.spoken),
        ...(answer.revealed!.length > 0 ? { revealed: listed(answer.revealed!), revealedNote: REVEALED_NOTE } : {}),
        ...(answer.suppressed!.length > 0 ? { notSpoken: listed(answer.suppressed!), notSpokenNote: "deze tekst veranderde in een live gebied dat verborgen is voor hulpsoftware: er wordt niets uitgesproken" } : {}),
        ...(answer.focus ? { focusSpoken: short(answer.focus, 200) } : {}),
        ...(answer.navigated ? { navigatedNote: "de pagina is opnieuw geladen: tekst die bij het laden al in een live gebied staat, is geen verandering en wordt niet uit zichzelf uitgesproken" } : {}),
        ...(answer.spoken.length === 0 && answer.revealed!.length === 0 && !answer.focus ? { silent: "er werd niets uit zichzelf uitgesproken" } : {}),
      };
    },
    { action: acted.result },
    acted,
  );
}

export interface SpeakActions {
  click: Handler;
  type: Handler;
  key: Handler;
}

/**
 * `speak`: what a screen reader says, by a reader that is simulated in the page.
 *
 * - `speak <ref>`: what is said when the reader comes to the element.
 * - `speak [<ref>] --steps n`: the first n items from the top of the page, or from the element.
 * - `speak <ref> --click`, `speak <ref> --type <test value> [--submit]`: act, and what is said by itself afterwards.
 */
export const speakWith = (actions: SpeakActions): Handler => async (context, _args, options) => {
  if (!speakActs(options)) return reading(context, options);
  if (!context.target) throw new UsageError("speak --click en speak --type verwachten het nummer van een element");
  return afterAction(context, options, actions);
};
