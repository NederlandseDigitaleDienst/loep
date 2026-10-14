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
 * or a press that asks for full screen is a reaction (2.1.4, 2.5.2).
 */
export const SWEEP_STAMP_VERSION = 12;

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
