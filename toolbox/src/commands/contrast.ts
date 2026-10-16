import { progressLine, sayingItRuns } from "../instruments/limit.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { confirmLogin, firstLineOf, INPAGE_PATH, launchBrowser, loadSampled, newContext, retryOnce, type ColorScheme } from "../browser/session.ts";
import { readJson, writeJson } from "../lib/canonical.ts";
import { LoginExpired } from "../lib/login.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { hoverFocusContrast, hoverFocusKey, pageContrast, type PageContrast } from "../instruments/contrast.ts";
import { forcedColoursProbe } from "../instruments/forced.ts";
import { SMALLEST } from "./collect.ts";
import { ModelSweep } from "./modelsweep.ts";
import type { Sample } from "./sample.ts";
import { CONTRAST_STAMP, measuredPages, pageKey, readStamp } from "../lib/sweepstamp.ts";
import { inOrder, sweepAtOnce, withSpacing } from "../lib/atonce.ts";

export { FLAT_BACKGROUND_SHARE, measure, measureControl, measureGraphic, NON_TEXT_RATIO } from "../instruments/contrast.ts";
export type { ContrastMeasurement, ControlContrast, GraphicContrast, PageContrast } from "../instruments/contrast.ts";

type Measured = Record<string, { key: string; contentSha256: string } | null>;

/** A page that did not load, or could not be measured, after its second try: it has no row in contrast.json, which the gate counts as a gap. */
export interface NotMeasured {
  url: string;
  slug: string;
  scheme: ColorScheme;
  width: number | null;
  reasonNl: string;
}

/**
 * Measure the contrast of every piece of visible text against what is actually painted behind it.
 * A page `collect` found unchanged since this was last measured, under the same blockers, keeps
 * its measurements; with `fresh` every page is measured again.
 *
 * There are four passes over the pages: the default window and 320 pixels wide, each light and dark.
 * A pass goes from page to page in one browser context, and a link measured under the pointer on
 * one page is not measured again on the next: within a pass the order counts. With `atOnce` the
 * passes run at the same time, at most four; what is written is the same as with one after the other.
 */
export async function contrast(runDir: string, options: { fresh?: boolean; atOnce?: number } = {}): Promise<PageContrast[]> {
  const startedAt = stepStart();
  const sample = await readJson<Sample>(join(runDir, "sample.json"));
  const settings = sweepAtOnce(runDir, options.atOnce ?? 1);
  if (settings.noteNl) process.stderr.write(`contrast: ${settings.noteNl}\n`);
  const browser = await launchBrowser();
  const passes = [null, SMALLEST].flatMap((viewport) => (["light", "dark"] as ColorScheme[]).map((scheme) => ({ viewport, scheme })));
  // What each pass measured, and what it could not: written in the order of the passes.
  const measuredIn = passes.map(() => ({ results: [] as PageContrast[], notMeasured: [] as NotMeasured[], reused: 0 }));
  const results = (): PageContrast[] => measuredIn.flatMap((pass) => pass.results);
  try {
    const sweep = await ModelSweep.load(runDir, browser);
    // What `collect` says about each page now, against what it said when the contrast was last measured.
    const now = await measuredPages(runDir, sample.items);
    const stamp = options.fresh ? null : await readStamp<{ pages: Measured }>(join(runDir, CONTRAST_STAMP));
    const previous = stamp && existsSync(join(runDir, "contrast.json")) ? await readJson<PageContrast[]>(join(runDir, "contrast.json")) : [];
    const kept = (item: Sample["items"][number], scheme: ColorScheme, width: number | null): PageContrast | null => {
      const [current, then] = [now[item.slug], stamp?.pages[item.slug]];
      if (!current || !then || current.key !== pageKey(sweep.blockersKey, item) || then.key !== current.key || then.contentSha256 !== current.contentSha256) return null;
      return previous.find((entry) => entry.slug === item.slug && entry.scheme === scheme && (entry.width ?? null) === width) ?? null;
    };
    const total = sample.items.length * 4;
    const atOnce = Math.min(settings.atOnce, passes.length);
    if (atOnce > 1) process.stderr.write(`contrast: ${atOnce} rondes tegelijk, ${settings.navigationDelayMs} ms tussen twee navigaties naar dezelfde site\n`);
    await confirmLogin(browser);
    // Each pass notes the blockers it closed apart; they are taken over in the order of the passes.
    const scopes = passes.map(() => sweep.fork());
    const pass = async (index: number): Promise<void> => {
      const { viewport, scheme } = passes[index]!;
      const scope = scopes[index]!;
      const own = measuredIn[index]!;
      // Each page in the default window and at 320 pixels wide, where a menu and a header can have other colours.
      const context = await newContext(browser, { colorScheme: scheme, ...(viewport ? { viewport } : {}) }, scope.guard);
      await context.addInitScript({ path: INPAGE_PATH });
      await scope.install(context);
      try {
        // A link or button is measured under the pointer and with focus on the first page it stands on, once per scheme.
        const seen = new Set<string>();
        for (const [position, item] of sample.items.entries()) {
          const known = kept(item, scheme, viewport?.width ?? null);
          const nr = index * sample.items.length + position;
          // A measurement from before the pointer and focus were measured on every page is not kept in the default window.
          if (known && (viewport || known.hoverFocus)) {
            own.results.push(known);
            for (const row of known.hoverFocus?.rows ?? []) seen.add(hoverFocusKey(row));
            own.reused++;
            continue;
          }
          const what = `${item.url} ${scheme === "dark" ? "donker" : "licht"}${viewport ? ` ${viewport.width} breed` : ""}`;
          const started = Date.now();
          // A try that failed leaves nothing behind: the blockers it closed and the links it measured are forgotten before the next.
          const mark = scope.mark();
          const seenBefore = [...seen];
          const forget = (): void => {
            scope.rewind(mark);
            seen.clear();
            for (const key of seenBefore) seen.add(key);
          };
          const measureOnce = async (): Promise<PageContrast> => {
            forget();
            const tab = await context.newPage();
            try {
              const { page } = await loadSampled(tab, item, (loaded) => scope.dismiss(context, loaded, `contrast:${scheme}${viewport ? `:${viewport.width}` : ""}`, scheme));
              const measured = await pageContrast(page);
              // Forced colours take the colour scheme and the window as they are: once per page is enough to see what a page builds from shadows and backgrounds.
              const forced = scheme === "light" && !viewport ? { forced: await forcedColoursProbe(page) } : {};
              // The colours of links and buttons under the pointer and with focus, in both schemes, in the default window.
              const hoverFocus = !viewport ? { hoverFocus: await hoverFocusContrast(page, seen) } : {};
              return { url: item.url, slug: item.slug, scheme, ...(viewport ? { width: viewport.width } : {}), ...measured, ...forced, ...hoverFocus };
            } finally {
              await tab.close().catch(() => undefined);
            }
          };
          try {
            own.results.push(await sayingItRuns(`contrast ${nr + 1}/${total} ${what}`, () => retryOnce(what, measureOnce)));
            process.stderr.write(progressLine("contrast", null, nr, total, `${what} ${Date.now() - started}ms`));
          } catch (error) {
            if (error instanceof LoginExpired) throw error;
            // A page that fails twice is left out and named; the rest of the pages are measured.
            forget();
            own.notMeasured.push({ url: item.url, slug: item.slug, scheme, width: viewport?.width ?? null, reasonNl: firstLineOf(error) });
            process.stderr.write(progressLine("contrast", null, nr, total, `${what} niet gemeten: ${firstLineOf(error)}`));
          }
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    };
    try {
      await withSpacing({ ...settings, atOnce }, () => inOrder(passes.length, atOnce, pass, (index) => sweep.absorb(scopes[index]!)));
      await confirmLogin(browser);
    } catch (error) {
      // A session that ran out: what was measured until then is kept, and the next run measures the rest.
      if (error instanceof LoginExpired) {
        await writeJson(join(runDir, "contrast.json"), results());
        await writeJson(join(runDir, CONTRAST_STAMP), { pages: now });
      }
      throw error;
    }
    const all = results();
    const reused = measuredIn.reduce((sum, entry) => sum + entry.reused, 0);
    const notMeasured = measuredIn.flatMap((entry) => entry.notMeasured);
    await writeJson(join(runDir, "contrast.json"), all);
    await writeJson(join(runDir, CONTRAST_STAMP), { pages: now });
    if (reused > 0) process.stderr.write(`contrast: ${reused} van ${all.length} metingen overgenomen van pagina's die niet zijn veranderd\n`);
    if (notMeasured.length > 0) process.stderr.write(`contrast: ${notMeasured.length} van ${total} metingen niet gedaan, ook niet bij de tweede poging (${[...new Set(notMeasured.map((entry) => entry.url))].join(", ")}). De bewijspoort telt ze als gat. Draai contrast opnieuw: wat wel is gemeten, wordt overgenomen.\n`);
    const dismissals = { blockersClosedOnPage: sweep.dismissals.filter((entry) => entry.dismissed).length, blockersNotClosed: sweep.dismissals.filter((entry) => !entry.dismissed).length };
    await writeManifest(runDir, { command: "contrast", startedAt, pages: sample.items.length, measurements: all.reduce((sum, page) => sum + page.measurements.length, 0), ...dismissals, ...(atOnce > 1 ? { atOnce } : {}), ...(reused > 0 ? { reused } : {}), ...(notMeasured.length > 0 ? { notMeasured } : {}) }, browser.version());
    return all;
  } finally {
    await browser.close();
  }
}
