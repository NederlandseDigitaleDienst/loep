import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "playwright";
import type { MethodResult } from "../methods.ts";
import { ensureHelpers, packageSource } from "./capsule.ts";
import { packageVersion } from "./registry.ts";

/** The id of the simulated screen reader in the register of methods. */
export const SIMULATED_READER = "virtual-screen-reader";

/** Said with every answer: what kind of reader this is. */
export const SIMULATED_NOTE = "nagebootste schermlezer die de standaard volgt, geen echte: eigenaardigheden van NVDA, JAWS of VoiceOver ziet hij niet. Rollen en toestanden staan in het Engels, zoals de standaard ze noemt";

/** Said when a region was hidden before the action and shows now. */
export const REVEALED_NOTE = "dit gebied stond voor de handeling verborgen en is nu zichtbaar. De standaard legt niet vast of een schermlezer dat uitspreekt en echte schermlezers verschillen erin: probeer het met een echte schermlezer. Zeker is het alleen als het gebied al zichtbaar en leeg in de pagina staat en daarna tekst krijgt";

const INPAGE_SPEECH = readFileSync(fileURLToPath(new URL("./inpage-speech.js", import.meta.url)), "utf8");

let composed: string | null = null;

/**
 * The reader as one expression that gives the two functions of `inpage-speech.js`. The package
 * ships one file for a browser, written as a module; its export is turned into a return value
 * so it can run in a page whose policy forbids loading a module from elsewhere.
 *
 * The package would also prepare the page for typing and clicking with made-up events: it
 * replaces the clipboard of the page and the focus function of every element. This toolbox acts
 * with real input and never asks the reader to, so that one call is taken out. Nothing of the
 * page is replaced.
 */
export function speechSource(): string {
  if (composed !== null) return composed;
  const source = packageSource("@guidepup/virtual-screen-reader/browser.js");
  const exported = /export\{(\w+) as Virtual,[\w$]+ as virtual\};?/;
  const prepares = /(this\.#\w+)=\w+\.setup\(\{[^;]*?\}\);/g;
  if (!exported.test(source) || (source.match(prepares) ?? []).length !== 1) throw new Error("de nagebootste schermlezer is anders gebouwd dan de versie waarvoor de toolbox is gemaakt");
  const library = `(function () {\n${source.replace(prepares, "$1=null;").replace(exported, "return $1;")}\n})()`;
  composed = `(${INPAGE_SPEECH})(${library})`;
  return composed;
}

/** What the simulated reader could and could not go through on this page. */
export interface SpeechCoverage {
  /** Open shadow roots the reader went into. */
  shadowRootsRead: number;
  /** Embedded frames on the page: the reader names them and does not go in. */
  framesNotEntered: number;
  /** Custom elements on the page. A role or name such an element sets outside the code (ElementInternals) is not seen by the reader. */
  customElements: number;
  /** A modal dialog is open: only what is inside it is read. */
  modalOpen: boolean;
  /** How many items the whole page has for the reader. */
  items: number;
  /** False when the page has more items than the reader walks. */
  complete: boolean;
}

export interface ReadAloud {
  /** What is said, item by item, in the words of the reader. */
  spoken: string[];
  /** The place of the first item in the walk through the whole page; null when nothing is said. */
  from: number | null;
  /** "element": the element itself is an item. "inside": it is not, and the first item inside it is given. "nothing": it has nothing to say. "hidden": assistive technology does not get it. */
  at: "top" | "element" | "inside" | "nothing" | "hidden" | "gone";
  coverage: SpeechCoverage;
}

/** What the reader says at an element or from the top of the page, for `count` items. `where` is a place in the document of `page`. */
export async function readAloud(page: Page | Frame, where: string | null, count: number): Promise<ReadAloud> {
  await ensureHelpers(page);
  return (await page.evaluate(`${speechSource()}.read(${JSON.stringify({ where, count })})`)) as ReadAloud;
}

export interface Heard {
  /** What was said by itself: a change in a live region that assistive technology already had. */
  spoken: string[];
  /** What a region says that was hidden before and is shown now; whether that is spoken is not settled. */
  revealed: string[];
  /** The text of regions that changed while assistive technology does not get them: not said. */
  suppressed: string[];
  /** Changes of an attribute in a live region that change nothing of what it says. */
  attributeChanges: number;
}

/** Start listening in a document for what is said by itself. Ends with `stopListening`, or when the document goes away. */
export async function startListening(page: Page | Frame): Promise<void> {
  await page.evaluate(`${speechSource()}.listen()`);
}

/** What was said since `startListening`; null when the document that was listened to is gone. */
export async function stopListening(page: Page | Frame): Promise<Heard | null> {
  return page.evaluate(() => (window as unknown as { __loepSpeech?: { stop: () => Promise<Heard> } }).__loepSpeech?.stop() ?? null).catch(() => null);
}

/**
 * What a simulated screen reader said by itself after an action of the sweep, in its own words.
 * It follows the standard and is not a real one. `spoken`: a change in a live region that was
 * already there. `revealed`: what a region says that was hidden before; whether that is spoken
 * is not settled. `notSpoken`: text that changed in a region hidden from assistive technology.
 */
export interface SpokenByItself {
  reader: string;
  spoken: string[];
  revealed: string[];
  notSpoken: string[];
}

const MAX_KEPT = 20;

/** What was heard in one or more documents, in the form the sweep keeps. */
export function spokenByItself(heard: Heard[]): SpokenByItself {
  const all = (list: (entry: Heard) => string[]): string[] => heard.flatMap(list).slice(0, MAX_KEPT);
  return { reader: `${SIMULATED_READER} ${packageVersion("@guidepup/virtual-screen-reader")} (nagebootst)`, spoken: all((entry) => entry.spoken), revealed: all((entry) => entry.revealed), notSpoken: all((entry) => entry.suppressed) };
}

/** What one reader said: the shape a real screen reader's answer has too. */
export interface SpokenBy {
  /** What was said, item by item, in the words of the reader. */
  spoken: string[];
  /** True for a reader that is simulated in the page; a real screen reader is not. */
  simulated: boolean;
}

/** The words of a phrase without the punctuation and the order of role and name that differ between readers. */
const wordsOf = (phrase: string): string => (phrase.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).sort().join(" ");

/**
 * Where two or more readers said something else, item by item. One reader has nothing to
 * differ from. Readers word a role and a state differently and in another order, so two items
 * with the same words count as the same; what remains is for a person to weigh.
 */
export function speechDifferences(sources: Pick<MethodResult<SpokenBy>, "implementation" | "result">[]): string[] {
  const [first, ...others] = sources;
  if (!first) return [];
  const differences: string[] = [];
  for (const other of others) {
    const length = Math.max(first.result.spoken.length, other.result.spoken.length);
    for (let index = 0; index < length; index++) {
      const [said, heard] = [first.result.spoken[index], other.result.spoken[index]];
      if (said !== undefined && heard !== undefined && wordsOf(said) === wordsOf(heard)) continue;
      differences.push(`stap ${index + 1}: ${first.implementation} ${said === undefined ? "zegt niets" : `"${said}"`}, ${other.implementation} ${heard === undefined ? "zegt niets" : `"${heard}"`}`);
    }
  }
  return differences;
}
