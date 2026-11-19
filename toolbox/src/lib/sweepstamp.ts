import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, readJson, sha256, writeJson } from "./canonical.ts";
import type { Step } from "../session/observations.ts";
import type { Blocker, Postcondition } from "./sitemodel.ts";

/**
 * What a measurement of the sweep is valid against. A sweep that runs a second time, after
 * the explorer changed the site model, measures only what the change touches: a page in its
 * default state depends on the blockers (they decide what is closed before measuring) and
 * on its own content; a state of the model depends on its own recipe. Every measurement
 * leaves a stamp with the hash of what it depends on. The next sweep compares.
 */

/**
 * Raise when the sweep starts to measure or record something else, so that what an older toolbox
 * measured is measured again. No test can see that for you: what the sweep writes differs with the
 * tools on the machine and with what a page happens to hold. 6: what is spoken by itself at each
 * attempt of the form probe and when a state of the site model is opened. 7: the pointer probes by kind of control, in the narrow
 * window and in every state; the content at each size; the controls of the narrow window; what comes and goes with the wider
 * text spacing; each component on every page type it stands on. 8: per page the order of code and screen wide and at 320, text
 * laid out with spaces, the language of text alternatives, every picture read with text recognition and the controls that only
 * show between the measured widths; per state its text and language, its pictures, and the walks back and with the arrow keys.
 * 9: per page and per state every timer with what it did (waiting ones set off at the end), the meta refreshes, the cookies
 * and the stored values (2.2.1). 10: the wider text spacing stays on shadow roots that appear later, so a menu that makes
 * its items anew is measured with it; per state that fills a form, the timers that start after sending it (2.2.1). 11: on that same sending, the
 * messages that appear, with their region, how the region was before (hidden, empty, absent) and the focus (4.1.3). 12: a key
 * or a press that asks for full screen is a reaction (2.1.4, 2.5.2). 13: the numbered Tab picture is taken right after the
 * walk, before the arrow keys move a slide. 14: the boxes on that picture follow sticky and fixed elements to where the
 * picture shows them, and the Tab walks run without smooth scrolling, so a focus clip is no longer taken on the way there.
 * 15: per page the hosts a plain load asks something of, the baseline for hosts refused in a state of the model. 16: a read of
 * data (fetch, XHR) from a host outside the scope of the run is refused, as in a session, so what it would fill is no longer measured.
 * 17: a page is quiet after 500 ms without a request in flight that is younger than 2 s, instead of after 500 ms without any
 * request: a long-poll or a hanging beacon no longer holds every page until the cap of 10 s. 18: after loading, the page is
 * scrolled through once and back to the top, so content that only shows when it comes into view is measured as shown. 19: text
 * that an animation on scroll hides again once it is out of view keeps its shown state when the page is back at the top.
 */
export const SWEEP_STAMP_VERSION = 19;

/**
 * How the content of a page is read for its stamp. Raise when that changes: an older hash can then never match,
 * and the stamp says why the page is measured again. 2: what a visitor meets (`visitorSnapshot`), without the
 * head, class names, ids, data attributes, states, tokens in addresses and dates and times, once the page stopped
 * changing; before, every attribute counted.
 */
export const CONTENT_VERSION = 2;

interface RecipeSteps {
  start?: unknown;
  steps: Step[];
}

/** A recipe as far as it decides what happens: where it starts and its steps, not who saved it or when. */
const recipePart = (recipe: RecipeSteps | undefined): unknown => (recipe ? { start: recipe.start ?? null, steps: recipe.steps } : null);

/** The part of the site model every page in its default state depends on: the blockers and how each is closed. */
export function blockersKey(blockers: Blocker[], recipes: Record<string, RecipeSteps>): string {
  return sha256(canonicalJson({ version: SWEEP_STAMP_VERSION, blockers: blockers.map((blocker) => ({ id: blocker.id, postcondition: blocker.postcondition, recipe: recipePart(recipes[blocker.recipe]) })) }));
}

/** What a page of the sample is measured against, apart from its content: the blockers, and whether it is a page or an embedded window. */
export function pageKey(blockers: string, item: { url: string; slug: string; kind: string; embeddedOn?: string[] }): string {
  // An embedded window is measured on the page it stands on: another page, another measurement.
  return sha256(canonicalJson({ blockers, url: item.url, slug: item.slug, kind: item.kind, ...(item.embeddedOn?.[0] ? { on: item.embeddedOn[0] } : {}) }));
}

/** What a captured state is measured against: its name, how it is opened and what has to hold then. */
export function stateKey(state: { id: string; kind: string; startUrl: string | null }, postcondition: Postcondition | null, recipe: RecipeSteps | undefined): string {
  return sha256(canonicalJson({ version: SWEEP_STAMP_VERSION, id: state.id, kind: state.kind, startUrl: state.startUrl, postcondition, recipe: recipePart(recipe) }));
}

export const PAGE_STAMP = "sweep.stamp.json";
export const STATE_STAMP = "sweep.stamp.json";
export const CONTRAST_STAMP = "contrast.stamp.json";
export const STATES_STAMP = "states.stamp.json";

/** What `collect` leaves with the measurements of one page. */
export interface PageStamp {
  key: string;
  /** `SWEEP_STAMP_VERSION`, `CONTENT_VERSION` and the blockers part of the key: what a later sweep says why it measures again with. Absent in an older stamp. */
  version?: number;
  contentVersion?: number;
  blockers?: string;
  /** Hash of the text and structure of the page as it was measured, with the blockers closed. */
  contentSha256: string;
  /** What this page added to the files that are about every page: its line in collect.json, and the blockers closed and write requests refused on it. */
  summary: Record<string, unknown>;
  dismissals: unknown[];
  refusedWrites: unknown[];
}

/** The stamp of a page, when there is one that can be read. */
export async function readStamp<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    return await readJson<T>(path);
  } catch {
    return null;
  }
}

export const pageStampPath = (runDir: string, slug: string): string => join(runDir, "pages", slug, PAGE_STAMP);
/** The content the hash of a page stamp was made of: what a later sweep shows the first difference with. */
export const pageContentPath = (runDir: string, slug: string): string => join(runDir, "pages", slug, "sweep.content.txt");

/** The page as a later sweep sees it before measuring: the hash and what it was made of, or null when it did not load. */
export interface ContentNow {
  sha256: string;
  snapshot: string;
}

/** The first line where two snapshots of a page differ, shortened, so that a person can see what changed. */
export function firstDifference(before: string, now: string): string {
  const [old, current] = [before.split("\n"), now.split("\n")];
  const index = old.findIndex((line, at) => line !== current[at]);
  const at = index === -1 ? old.length : index;
  // A line is a tag or a text in quotes, as it stands in the file next to the stamp.
  const shown = (line: string | undefined): string => (line === undefined ? "(niets)" : line.trim().length > 80 ? `${line.trim().slice(0, 77)}...` : line.trim());
  return `regel ${at + 1}: ${shown(old[at])} werd ${shown(current[at])}`;
}

const depthOf = (line: string): number => (line.length - line.trimStart().length) / 2;

/** The opening lines of an element and of each of its ancestors, from the element up: where it stands on the page. */
function ancestry(lines: string[], at: number): string[] {
  const chain = [lines[at]!];
  for (let index = at - 1, depth = depthOf(lines[at]!); index >= 0 && depth > 0; index--) {
    if (depthOf(lines[index]!) < depth && lines[index]!.trimStart().startsWith("<")) {
      chain.push(lines[index]!);
      depth = depthOf(lines[index]!);
    }
  }
  return chain;
}

/** Where the subtree of the element on line `at` ends: the first line after it that is not inside it. */
function subtreeEnd(lines: string[], at: number, from = at + 1): number {
  let end = from;
  while (end < lines.length && depthOf(lines[end]!) > depthOf(lines[at]!)) end++;
  return end;
}

/** The elements of a stretch of lines by depth and tag only: what a part with another text in it keeps. */
const skeleton = (lines: string[]): string => lines.filter((line) => line.trimStart().startsWith("<")).map((line) => line.replace(/^(\s*<[^\s>]+).*$/, "$1")).join("\n");

/**
 * The part of the page that holds every difference between two snapshots of it, when that part stands on every other
 * page in `others` too, in the same place, with the same fixed lines around what differs and the same elements inside:
 * a panel or a carousel that shows another text on every load. Null when the difference is anywhere else, when the
 * part has no fixed text or attribute of its own that tells it apart (a paragraph of the main text is on every page too),
 * when the elements inside it changed, or when no other page shows it with another text than this page had: a part
 * that reads the same on every page and now reads otherwise is a change of the site, not a text that varies by itself.
 * Such a difference is one of the part, not of the page: measuring every page again for it would measure the same part every time.
 */
export function siteWidePart(before: string, now: string, others: string[]): string | null {
  if (others.length < 2) return null;
  const [old, current] = [before.split("\n"), now.split("\n")];
  let start = 0;
  while (start < old.length && start < current.length && old[start] === current[start]) start++;
  let [endOld, endCurrent] = [old.length, current.length];
  while (endOld > start && endCurrent > start && old[endOld - 1] === current[endCurrent - 1]) [endOld, endCurrent] = [endOld - 1, endCurrent - 1];
  const changed = [...old.slice(start, endOld), ...current.slice(start, endCurrent)];
  if (changed.length === 0) return null;
  const middle = old.slice(start, endOld);
  if (skeleton(current.slice(start, endCurrent)) !== skeleton(middle)) return null;
  const changedDepth = Math.min(...changed.map(depthOf));
  // From the nearest element that holds every changed line up to the children of <body>: the first that is on every other page.
  for (let at = start - 1, depth = changedDepth; at >= 0; at--) {
    const line = old[at]!;
    if (depthOf(line) >= depth || !line.trimStart().startsWith("<")) continue;
    depth = depthOf(line);
    if (depth === 0) return null;
    const head = old.slice(at, start);
    const tail = old.slice(endOld, subtreeEnd(old, at, endOld));
    const fixed = [...head, ...tail];
    if (!fixed.slice(1).some((entry) => entry.trimStart().startsWith('"')) && !fixed.some((entry) => /^\s*<.*=/.test(entry))) continue;
    const chain = ancestry(old, at).join("\n");
    // What the part holds between its fixed lines on another page, or null when the part is not there.
    const middleOn = (other: string): string | null => {
      const lines = other.split("\n");
      for (const [index, entry] of lines.entries()) {
        if (entry !== line || lines.slice(index, index + head.length).join("\n") !== head.join("\n")) continue;
        const end = subtreeEnd(lines, index);
        if (end - tail.length < index + head.length || lines.slice(end - tail.length, end).join("\n") !== tail.join("\n")) continue;
        const inside = lines.slice(index + head.length, end - tail.length);
        if (skeleton(inside) === skeleton(middle) && ancestry(lines, index).join("\n") === chain) return inside.join("\n");
      }
      return null;
    };
    const elsewhere = others.map(middleOn);
    if (elsewhere.every((inside) => inside !== null) && elsewhere.some((inside) => inside !== middle.join("\n"))) return line.trim().length > 80 ? `${line.trim().slice(0, 77)}...` : line.trim();
  }
  return null;
}

/**
 * Why a measurement is taken again because a rule engine ran out of time in it, given what `enginesToRetry` says of it;
 * null when none did. An engine that runs out of time again in the retry is not tried a third time: the gate makes it a limitation.
 */
export function engineRetryReason(timedOut: { engine: string; error: string }[]): string | null {
  return timedOut.length === 0 ? null : `regelset gaf eerder geen uitslag (${timedOut.map((entry) => `${entry.engine}: ${entry.error.slice(0, 120)}`).join("; ")})`;
}

/**
 * What did not arrive, in a few words for the person who runs the sweep and for the gate, with how the browser or the server
 * said so. With `again` for the reader of the report: it did not arrive on a new attempt either, without the technical reason.
 */
export const missedNl = (missed: { resourceType: string; address: string; error: string }[], again = false): string =>
  `${missed.length === 1 ? "kwam" : "kwamen"} ${missed.slice(0, 3).map((entry) => `${entry.resourceType === "stylesheet" ? "de stylesheet" : "het script"} ${entry.address}`).join(", ")}${missed.length > 3 ? ` en ${missed.length - 3} andere` : ""} ${again ? "ook bij een nieuwe poging niet binnen" : `niet binnen (${missed[0]!.error})`}`;

/**
 * Why a page of the sample is measured again instead of keeping what an earlier sweep measured, in one
 * line for the person who runs it; null when the earlier measurement still holds. `now` is only asked
 * for when the stamp and the key agree: loading the page costs time. `timedOut` is what `enginesToRetry`
 * says of the earlier measurement: a rule engine that ran out of time there gets one more try. With `siteWide`, a
 * difference only in a part that stands on every other page (`siteWidePart`) keeps the earlier measurement, and is noted.
 */
export async function remeasureReason(
  stamp: PageStamp | null,
  key: string,
  blockers: string,
  now: () => Promise<ContentNow | null>,
  before: () => Promise<string | null>,
  timedOut: { engine: string; error: string }[] = [],
  siteWide?: { others: () => Promise<string[]>; noted: (part: string) => void },
): Promise<string | null> {
  if (!stamp) return "geen stempel van een eerdere meting";
  if (stamp.version !== SWEEP_STAMP_VERSION || stamp.contentVersion !== CONTENT_VERSION) return "stempel van een andere versie van loep";
  if (stamp.key !== key) return stamp.blockers !== blockers ? "blokkades of hoe ze worden gesloten anders" : "pagina anders in de steekproef (soort of ingesloten venster)";
  const retry = engineRetryReason(timedOut);
  if (retry) return retry;
  const current = await now();
  if (!current) return "pagina niet te laden om de inhoud te vergelijken";
  if (current.sha256 === stamp.contentSha256) return null;
  const earlier = await before();
  if (earlier === null) return "inhoud anders";
  // A difference only in a part that stands on every page is kept as the earlier measurement of that part.
  const part = siteWide ? siteWidePart(earlier, current.snapshot, await siteWide.others()) : null;
  if (part !== null) {
    siteWide!.noted(part);
    return null;
  }
  return `inhoud anders, ${firstDifference(earlier, current.snapshot)}`;
}

/** The pages of the sample as `collect` last measured them: what `contrast` and `states` hold their own measurements against. */
export async function measuredPages(runDir: string, items: { slug: string }[]): Promise<Record<string, { key: string; contentSha256: string } | null>> {
  const pages: Record<string, { key: string; contentSha256: string } | null> = {};
  for (const item of items) {
    const stamp = await readStamp<PageStamp>(pageStampPath(runDir, item.slug));
    pages[item.slug] = stamp ? { key: stamp.key, contentSha256: stamp.contentSha256 } : null;
  }
  return pages;
}

export { writeJson as writeStamp };
