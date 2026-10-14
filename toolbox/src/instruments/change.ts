import type { Page } from "playwright";
import { ensureHelpers } from "./methods/capsule.ts";

/** Everything on a page that an action can change, read at one moment. */
export interface ChangeState {
  url: string;
  /** Identifies the document: another value means the page was replaced. */
  doc: string;
  dialogs: number;
  /** Visible text, in pieces. */
  chunks: string[];
  live: string[];
  scroll: [number, number];
  /** Where focus is, as a selector chain; null when it is on the page itself. */
  focus: string | null;
  /** The state of everything that has one: ticked, value, open, aria-expanded, aria-pressed and the like, by place. */
  states: Record<string, string>;
  /** The computed properties with which a state is usually shown, of the element the action is about. */
  style: Record<string, string> | null;
}

/**
 * Read what an action can change. `place` is the selector chain (joined with " >>> ") of the
 * element the action is about; its style is read too. One reading for the commands of a
 * session and for the probes of the sweep, so both see the same things.
 */
export async function readChangeState(page: Page, place: string | null = null): Promise<ChangeState> {
  await ensureHelpers(page);
  return page.evaluate((target) => {
    const library = (window as unknown as { __loep: { visibleDialogs: () => unknown[]; textChunks: () => string[]; liveRegionTexts: () => string[]; deepActiveElement: () => Element | null } }).__loep;
    const helpers = (window as unknown as { __loepm: { controlStates: () => Record<string, string>; shownStyles: (place: string) => Record<string, string> | null; where: (element: Element) => string | null } }).__loepm;
    const active = library.deepActiveElement();
    return {
      url: location.href,
      doc: String(performance.timeOrigin),
      dialogs: library.visibleDialogs().length,
      chunks: library.textChunks(),
      live: library.liveRegionTexts(),
      scroll: [Math.round(window.scrollX), Math.round(window.scrollY)] as [number, number],
      focus: active && active !== document.body && active !== document.documentElement ? helpers.where(active) : null,
      states: helpers.controlStates(),
      style: target ? helpers.shownStyles(target) : null,
    };
  }, place);
}

/** The lines that say which states changed, e.g. `#box: checked=false -> checked=true`. */
export function stateChanges(before: Record<string, string>, after: Record<string, string>, short: (text: string) => string = (text) => text): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((place) => before[place] !== after[place]).map((place) => `${short(place)}: ${before[place] ?? "(was er niet)"} -> ${after[place] ?? "(weg)"}`);
}

/** How far the window scrolled, as text; null when it did not. */
export function scrollChange(before: [number, number], after: [number, number]): string | null {
  if (before[0] === after[0] && before[1] === after[1]) return null;
  return `${before[1]} -> ${after[1]}${before[0] !== after[0] ? ` (horizontaal ${before[0]} -> ${after[0]})` : ""}`;
}

/** Which of the shown properties of the element changed. */
export function styleChanges(before: Record<string, string> | null, after: Record<string, string> | null): Record<string, string> {
  if (!before || !after) return {};
  // A colour that only follows the text colour (an underline, a border in currentColor) says nothing the text colour did not say.
  const follows = (name: string): boolean => name !== "color" && name.endsWith("-color") && before[name] === before.color && after[name] === after.color;
  return Object.fromEntries(Object.keys(after).filter((name) => before[name] !== after[name] && !follows(name)).map((name) => [name, `${before[name]} -> ${after[name]}`]));
}

export interface Change {
  /** The document was replaced. Text is then not compared: everything is new. */
  navigated: boolean;
  /** The new address, when it changed. */
  url: string | null;
  dialogs: string | null;
  appeared: string[];
  disappeared: string[];
  live: string[];
  states: string[];
  scrolled: string | null;
  focus: string | null;
  style: Record<string, string>;
}

/** A piece of text with its digits taken out: a clock or a counter is the same text a second later. */
const pattern = (chunk: string): string => chunk.replace(/\d+/g, "#");

/**
 * What differs between two readings. `volatile` holds the patterns of text that changes by
 * itself (see `volatileText`); a piece of text that fits one is not counted as appeared or disappeared.
 */
export function compareChange(before: ChangeState, after: ChangeState, volatile: Set<string> = new Set()): Change {
  const navigated = before.doc !== after.doc;
  const had = new Set(before.chunks);
  const has = new Set(after.chunks);
  const liveBefore = new Set(before.live);
  const counts = (chunk: string): boolean => !volatile.has(pattern(chunk));
  return {
    navigated,
    url: before.url !== after.url ? after.url : null,
    dialogs: before.dialogs !== after.dialogs ? `${before.dialogs} -> ${after.dialogs}` : null,
    appeared: navigated ? [] : after.chunks.filter((chunk) => !had.has(chunk) && counts(chunk)),
    disappeared: navigated ? [] : before.chunks.filter((chunk) => !has.has(chunk) && counts(chunk)),
    live: navigated ? [] : after.live.filter((text) => !liveBefore.has(text) && counts(text)),
    states: navigated ? [] : stateChanges(before.states, after.states),
    scrolled: navigated ? null : scrollChange(before.scroll, after.scroll),
    focus: !navigated && before.focus !== after.focus ? `${before.focus ?? "de pagina"} -> ${after.focus ?? "de pagina"}` : null,
    style: navigated ? {} : styleChanges(before.style, after.style),
  };
}

/**
 * Whether the only thing that changed is a number inside text that is otherwise the same: a
 * clock or a countdown that ticked. Such text changes by itself, whatever was done.
 */
export function onlyDigitsChanged(change: Change): boolean {
  if (change.appeared.length === 0 || change.appeared.length !== change.disappeared.length) return false;
  const gone = change.disappeared.map(pattern).sort();
  return change.appeared.map(pattern).sort().every((entry, index) => entry === gone[index]);
}

/** The digit-free patterns of the text a change names, to set that text aside from then on. */
export const patternsOf = (change: Change): string[] => [...change.appeared, ...change.disappeared, ...change.live].map(pattern);

/** The patterns of the text that differs between two readings taken without anything being done in between. */
export function volatileText(first: ChangeState, second: ChangeState): Set<string> {
  const idle = compareChange(first, second);
  return new Set([...idle.appeared, ...idle.disappeared, ...idle.live].map(pattern));
}

export type ChangeAspect = "url" | "dialogs" | "text" | "states" | "scroll" | "focus" | "style";
const ALL: ChangeAspect[] = ["url", "dialogs", "text", "states", "scroll", "focus", "style"];

/** Whether anything changed, looking only at the given aspects. */
export function hasChange(change: Change, aspects: ChangeAspect[] = ALL): boolean {
  const present: Record<ChangeAspect, boolean> = {
    url: change.navigated || change.url !== null,
    dialogs: change.dialogs !== null,
    text: change.appeared.length > 0 || change.disappeared.length > 0 || change.live.length > 0,
    states: change.states.length > 0,
    scroll: change.scrolled !== null,
    focus: change.focus !== null,
    style: Object.keys(change.style).length > 0,
  };
  return aspects.some((aspect) => present[aspect]);
}

const MAX_LISTED = 3;
const quoted = (texts: string[]): string => `${texts.slice(0, MAX_LISTED).map((text) => `"${text.slice(0, 80)}"`).join(", ")}${texts.length > MAX_LISTED ? ` (+${texts.length - MAX_LISTED})` : ""}`;

/** One line, in Dutch, that says what changed; null when nothing did in the given aspects. */
export function changeNl(change: Change, aspects: ChangeAspect[] = ALL): string | null {
  if (!hasChange(change, aspects)) return null;
  const parts: string[] = [];
  const wanted = (aspect: ChangeAspect): boolean => aspects.includes(aspect);
  if (wanted("url") && change.url !== null) parts.push(`adres gewijzigd naar ${change.url}`);
  else if (wanted("url") && change.navigated) parts.push("pagina opnieuw geladen");
  if (wanted("dialogs") && change.dialogs !== null) parts.push(`dialoog of paneel geopend of gesloten (${change.dialogs})`);
  if (wanted("focus") && change.focus !== null) parts.push(`focus verplaatst: ${change.focus}`);
  if (wanted("states") && change.states.length > 0) parts.push(`toestand gewijzigd: ${change.states.slice(0, MAX_LISTED).join("; ")}${change.states.length > MAX_LISTED ? ` (+${change.states.length - MAX_LISTED})` : ""}`);
  if (wanted("text") && change.appeared.length > 0) parts.push(`tekst verschenen: ${quoted(change.appeared)}`);
  if (wanted("text") && change.live.length > 0) parts.push(`statusmelding: ${quoted(change.live)}`);
  if (wanted("text") && change.disappeared.length > 0) parts.push(`tekst verdwenen: ${quoted(change.disappeared)}`);
  if (wanted("scroll") && change.scrolled !== null) parts.push(`venster gescrold: ${change.scrolled}`);
  if (wanted("style") && Object.keys(change.style).length > 0) parts.push(`stijl van het element gewijzigd: ${Object.entries(change.style).slice(0, MAX_LISTED).map(([name, value]) => `${name} ${value}`).join("; ")}`);
  return parts.join("; ");
}
