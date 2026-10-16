import { sayingItRuns } from "../instruments/limit.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { call } from "../browser/call.ts";
import { confirmLogin, INPAGE_PATH, launchBrowser, loadSampled, newContext, RENDERING, retryOnce, type ColorScheme } from "../browser/session.ts";
import { readJson, sha256, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { runEngines } from "../lib/engines.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { collectFacts, collectNamed } from "../instruments/facts.ts";
import { arrowReach, skipLinkProbe, tabWalk } from "../instruments/keyboard.ts";
import { mediaReport } from "../instruments/media.ts";
import { pageOperables } from "../instruments/operables.ts";
import { controlsOnlyWithSpacing, overflowProbe, textSpacing, visibleControlKeys, VIEWPORT_PROBES } from "../instruments/overflow.ts";
import { CONTENT_VERSION, pageContentPath, pageKey, pageStampPath, readStamp, remeasureReason, SWEEP_STAMP_VERSION, type ContentNow, type PageStamp } from "../lib/sweepstamp.ts";
import { languagesOf } from "../instruments/languages.ts";
import { visualOrder } from "../instruments/order.ts";
import { picturesWithText, recountRecognised, type PictureReport } from "../instruments/pictures.ts";
import { inOrder, sweepAtOnce, withSpacing } from "../lib/atonce.ts";
import { betweenWidths } from "../instruments/widths.ts";
import { timeLimits } from "../instruments/timelimits.ts";
import { ModelSweep } from "./modelsweep.ts";
import { SESSION_WATCH_FILE, startSessionWatch } from "./watch-session.ts";
import type { Sample, SampleItem } from "./sample.ts";

/** The narrow window of the sweep: the width of a small phone. */
export const NARROW = { width: 360, height: 740 };
/** The smallest width WCAG speaks of (1.4.10). Sizes, names and text spacing are measured here too: a menu, a header and a button differ most at this width. */
export const SMALLEST = { width: 320, height: 640 };

export interface CollectOptions {
  run: string;
  /** Substring filter on the URL, for working on one page. */
  only?: string | undefined;
  /** Measure everything again, also what an earlier sweep measured and is still valid. */
  fresh?: boolean | undefined;
  /** Pages measured at the same time, at most what the session process of the run allows sessions. Default 1. */
  atOnce?: number | undefined;
}

/** What measuring a page noted besides its files: the hash of its content and the pictures it read. */
interface Noted {
  content?: ContentNow;
  pictures?: PictureReport;
}

/** How long the content of a page may keep changing after it loaded, and how often it is read meanwhile. */
const STEADY = { intervalMs: 500, limitMs: 5000 };

/**
 * The text, structure and controls of the page as a visitor meets them, once two readings half a second
 * apart agree: a block that loads from another address is then filled, or stays empty. What tells a later
 * sweep whether the page changed.
 */
export async function contentOf(page: Page): Promise<ContentNow> {
  let snapshot = await call<string>(page, "visitorSnapshot");
  for (let waited = 0; waited < STEADY.limitMs; waited += STEADY.intervalMs) {
    await page.waitForTimeout(STEADY.intervalMs);
    const again = await call<string>(page, "visitorSnapshot");
    if (again === snapshot) break;
    snapshot = again;
  }
  return { sha256: sha256(snapshot), snapshot };
}

/** Load a page the way the sweep measures it first, with the blockers closed, only to see whether it is still the page that was measured. */
async function contentNow(browser: Browser, entry: SampleItem, sweep: ModelSweep): Promise<ContentNow | null> {
  const mark = sweep.mark();
  const context = await newContext(browser, { colorScheme: "light" }, sweep.guard);
  try {
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, "collect:check", "light"));
    return await contentOf(page);
  } catch {
    return null;
  } finally {
    await context.close().catch(() => undefined);
    // This load is no measurement: what it noted is not part of the sweep.
    sweep.rewind(mark);
  }
}

/** `sweep` closes what covers the page before anything is measured. */
async function collectPage(browser: Browser, entry: SampleItem, runDir: string, sweep: ModelSweep, noted: Noted = {}): Promise<Record<string, unknown>> {
  const dir = join(runDir, "pages", entry.slug);
  const summary: Record<string, unknown> = { url: entry.url, slug: entry.slug };

  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    const context = await newContext(browser, { colorScheme: scheme }, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page, placement } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, `collect:${scheme}`, scheme));
      if (scheme === "light") noted.content = await contentOf(page);
      // Where an embedded window was measured: on the page it stands on, or on its own and why.
      if (scheme === "light" && placement) {
        await writeJson(join(dir, "probes", "placement.json"), placement);
        summary.placement = placement;
      }
      if (scheme === "light") await writeJson(join(dir, "probes", "overlays.json"), await sweep.overlays(page));
      await page.screenshot({ path: join(dir, `screenshot-${scheme}.png`), fullPage: true, animations: "disabled" });
      const engines = await runEngines(page);
      await writeJson(join(dir, `engines-${scheme}.json`), engines);
      summary[`engines-${scheme}`] = engines.summary;
      if (scheme === "light") {
        const facts = await collectFacts(page);
        await writeJson(join(dir, "facts.json"), facts);
        await writeFileAtomic(join(dir, "aria.yaml"), `${await page.locator("body").ariaSnapshot()}\n`);
        await writeJson(join(dir, "probes", "targetsize.json"), await call(page, "targetSizes"));
        // What there is to operate, for the gate to lay next to the site model.
        await writeJson(join(dir, "probes", "operables.json"), await pageOperables(page));
        await writeJson(join(dir, "probes", "scrollregions.json"), await call(page, "scrollRegions"));
        await writeFileAtomic(join(dir, "text.txt"), `${await call<string>(page, "bodyText")}\n`);
        // Headings, images and blocks of text in the default window: what each other size is compared with.
        await writeJson(join(dir, "probes", "content.json"), await call(page, "contentInventory"));
        // The order of the code against the order on screen, and text laid out with spaces or line breaks (1.3.2).
        await writeJson(join(dir, "probes", "order.json"), await visualOrder(page));
        await writeJson(join(dir, "probes", "spacedtext.json"), { candidates: await call(page, "spacedText") });
        // The language of text alternatives and names, which the text of the page does not hold (3.1.2).
        await writeJson(join(dir, "probes", "languages.json"), await languagesOf(page, { blocks: false }));
        // The walk draws its numbered picture itself, before any other key is pressed.
        const walk = await tabWalk(page, { continueAfterFocusLoss: true, focusDir: join(dir, "probes", "focus"), focusPath: "probes/focus", orderPicture: join(dir, "probes", "tabwalk.png") });
        summary.tabwalk = { outcome: walk.outcome, stops: walk.stopCount };
        // Every picture cut out and read with text recognition (1.4.5); this scrolls, so it comes after what is measured in place.
        const pictures = await picturesWithText(page, join(dir, "probes", "pictures"), "probes/pictures", sweep.pictureCache);
        await writeJson(join(dir, "probes", "pictures.json"), pictures);
        noted.pictures = pictures;
        summary.pictures = { found: pictures.pictures.length, recognised: pictures.recognised };
        // The arrow keys can change the page itself: a slide deck turns to the next slide on every
        // stop. So they come after everything that shows the page as it loaded.
        walk.arrowReach = await arrowReach(page, walk.stops as { path: string[]; tag: string }[]);
        await writeJson(join(dir, "probes", "tabwalk.json"), walk);
        // What can be a time limit (2.2.1): every timer with what it did, waiting timers set off now. This changes the page, so it is last.
        const limits = await timeLimits(page, sweep.seededCookies);
        await writeJson(join(dir, "probes", "timelimits.json"), limits);
        summary.timeLimits = { timers: limits.timers.length, forced: limits.timers.filter((timer) => timer.forced).length };
      } else {
        // The focus indicator is measured again on the dark scheme: its colours differ.
        await writeJson(join(dir, "probes", "tabwalk-dark.json"), await tabWalk(page, { continueAfterFocusLoss: true, focusDir: join(dir, "probes", "focus-dark"), focusPath: "probes/focus-dark" }));
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  for (const probe of VIEWPORT_PROBES) {
    const context = await newContext(browser, { viewport: probe.viewport, deviceScaleFactor: probe.deviceScaleFactor }, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, `collect:${probe.name}`));
      const { report, visibleControls, clickables, content } = await overflowProbe(page, join(dir, "probes", `${probe.name}.png`));
      await writeJson(join(dir, "probes", `${probe.name}.json`), { ...probe, ...report, visibleControls, clickables, content });
      summary[probe.name] = { horizontalScroll: report.horizontalScroll, offenders: (report.offenders as unknown[]).length, clipped: (report.clipped as unknown[]).length };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // The page at 320 pixels wide: target sizes, names against visible text, and last the wider text spacing, which the page keeps.
  {
    const context = await newContext(browser, { viewport: SMALLEST }, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, "collect:smallest"));
      const targets = await call(page, "targetSizes");
      const named = await collectNamed(page);
      // The order of the code against the order on screen at this width, where blocks can change places (1.3.2).
      await writeJson(join(dir, "probes", "order-320.json"), await visualOrder(page));
      const before = await visibleControlKeys(page);
      const spacing = await textSpacing(page, join(dir, "probes", "smallest-textspacing.png"));
      // A button that only exists with the wider spacing is opened while the spacing is in force.
      const controls = await controlsOnlyWithSpacing(page, before, (index) => ({ path: join(dir, "probes", `smallest-textspacing-opened-${index}.png`), relative: `probes/smallest-textspacing-opened-${index}.png` }));
      await writeJson(join(dir, "probes", "smallest.json"), { viewport: SMALLEST, targets, ...named, textspacing: { ...spacing, controls } });
      summary.smallest = { targets: (targets as unknown[]).length, newlyClipped: spacing.newlyClipped.length };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // The page in a narrow window, where a menu sits behind a button and the order can differ.
  {
    const context = await newContext(browser, { viewport: NARROW }, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, "collect:narrow"));
      await page.screenshot({ path: join(dir, "screenshot-narrow.png"), fullPage: true, animations: "disabled" });
      await writeJson(join(dir, "probes", "overlays-narrow.json"), await sweep.overlays(page));
      await writeJson(join(dir, "probes", "operables-narrow.json"), await pageOperables(page));
      // What there is to reach with Tab in this window: the walk below is laid next to it.
      await writeJson(join(dir, "probes", "named-narrow.json"), await collectNamed(page));
      const walk = await tabWalk(page, { continueAfterFocusLoss: true, focusDir: join(dir, "probes", "focus-narrow"), focusPath: "probes/focus-narrow", orderPicture: join(dir, "probes", "tabwalk-narrow.png") });
      await writeJson(join(dir, "probes", "tabwalk-narrow.json"), walk);
      summary["tabwalk-narrow"] = { outcome: walk.outcome, stops: walk.stopCount };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // Controls that show at none of the widths above, and the page at a width where they do (1.1.1, 1.3.1).
  {
    const context = await newContext(browser, {}, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, "collect:widths"));
      // A page that cannot be laid out again, such as an embedded window measured in its place, says why.
      const found = await betweenWidths(page, join(dir, "probes"), "probes").catch((error: Error) => ({ widthsTried: [], breakpoints: [], controls: [], measuredAt: [], failedNl: error.message.split("\n")[0]! }));
      await writeJson(join(dir, "probes", "widths.json"), found);
      summary.widths = { tried: found.widthsTried.length, onlyBetween: found.controls.length, measuredAt: found.measuredAt.map((entry) => entry.width) };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // Skip link and moving content, each on a fresh page; motion is measured with animations allowed.
  for (const [name, reducedMotion] of [["skiplink", "reduce"], ["motion", "no-preference"]] as const) {
    const context = await newContext(browser, { reducedMotion }, sweep.guard);
    await context.addInitScript({ path: INPAGE_PATH });
    await sweep.install(context);
    try {
      const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, `collect:${name}`));
      if (name === "skiplink") await writeJson(join(dir, "probes", "skiplink.json"), await skipLinkProbe(page));
      else {
        await page.waitForTimeout(1500);
        await writeJson(join(dir, "probes", "motion.json"), await call(page, "motionReport"));
        // This page is thrown away, so the controls that may stop a sound can be tried here.
        await writeJson(join(dir, "probes", "media.json"), await mediaReport(page, { tryControls: true }));
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // Text spacing: measure clipping before and after, on a page that is then thrown away.
  const context = await newContext(browser, {}, sweep.guard);
  await context.addInitScript({ path: INPAGE_PATH });
  await sweep.install(context);
  try {
    const { page } = await loadSampled(await context.newPage(), entry, (tab) => sweep.dismiss(context, tab, "collect:textspacing"));
    const before = await visibleControlKeys(page);
    const spacing = await textSpacing(page, join(dir, "probes", "textspacing.png"));
    const controls = await controlsOnlyWithSpacing(page, before, (index) => ({ path: join(dir, "probes", `textspacing-opened-${index}.png`), relative: `probes/textspacing-opened-${index}.png` }));
    await writeJson(join(dir, "probes", "textspacing.json"), { ...spacing, controls });
    summary.textspacing = { newlyClipped: spacing.newlyClipped.length };
  } finally {
    await context.close().catch(() => undefined);
  }
  return summary;
}

export async function collect(options: CollectOptions): Promise<void> {
  const startedAt = stepStart();
  const sample = await readJson<Sample>(join(options.run, "sample.json"));
  const pages = sample.items.filter((item) => !options.only || item.url.includes(options.only));
  const settings = sweepAtOnce(options.run, options.atOnce ?? 1);
  if (settings.noteNl) process.stderr.write(`collect: ${settings.noteNl}\n`);
  const browser = await launchBrowser();
  const summaries: Record<string, unknown>[] = [];
  try {
    // In a run with a login: stop before anything is measured when the session ran out.
    await confirmLogin(browser);
    // The watch on the session of a run with a login starts with the sweep and runs alone until evaluate (2.2.1).
    const watch = startSessionWatch(options.run);
    if (watch) process.stderr.write(watch.status === "running" ? `sessieproef loopt (proces ${watch.pid}); de stand staat in ${SESSION_WATCH_FILE}\n` : `sessieproef draait niet: ${watch.reasonNl ?? watch.status}\n`);
    const sweep = await ModelSweep.load(options.run, browser);
    if (settings.atOnce > 1) process.stderr.write(`collect: ${settings.atOnce} pagina's tegelijk, ${settings.navigationDelayMs} ms tussen twee navigaties naar dezelfde site\n`);
    let reused = 0;
    // The pictures read on the pages before: a picture counts as read on the first page that has it, as with one page after the other.
    const seenPictures = new Set<string>();
    type Measured = { summary: Record<string, unknown>; key: string; noted: Noted; reused: boolean; reason: string | null; started: number; scope: ModelSweep };
    await withSpacing(settings, () =>
      inOrder(
        pages.length,
        settings.atOnce,
        async (index): Promise<Measured> => {
          const entry = pages[index]!;
          const started = Date.now();
          // Each page notes the blockers it closed and the writes it refused apart; they are taken over in the order of the pages.
          const scope = sweep.fork();
          // A page an earlier sweep measured under the same blockers, and that still has the same content, is not measured again.
          const key = pageKey(sweep.blockersKey, entry);
          const stamp = options.fresh ? null : await readStamp<PageStamp>(pageStampPath(options.run, entry.slug));
          const reason = options.fresh
            ? "met --fresh wordt alles opnieuw gemeten"
            : await remeasureReason(
                stamp,
                key,
                sweep.blockersKey,
                () => contentNow(browser, entry, scope),
                () => readFile(pageContentPath(options.run, entry.slug), "utf8").then((text) => text.replace(/\n$/, ""), () => null),
              );
          if (stamp && reason === null) {
            scope.restore(stamp as Parameters<ModelSweep["restore"]>[0]);
            return { summary: stamp.summary, key, noted: {}, reused: true, reason, started, scope };
          }
          const noted: Noted = {};
          // A page gets one retry: a page that loaded too slowly once, or a crashed renderer, must not cost the whole run.
          // A page with many measurements takes more than a minute: say every half minute that it still runs.
          const summary = await sayingItRuns(`collect ${index + 1}/${pages.length} ${entry.url}`, () => retryOnce(entry.url, () => collectPage(browser, entry, options.run, scope, noted)));
          return { summary, key, noted, reused: false, reason, started, scope };
        },
        async (index, measured) => {
          const entry = pages[index]!;
          sweep.absorb(measured.scope);
          summaries.push(measured.summary);
          if (measured.reused) {
            reused++;
            process.stderr.write(`collect ${index + 1}/${pages.length} ${entry.url} niet veranderd, niet opnieuw gemeten (${Date.now() - measured.started}ms)\n`);
            return;
          }
          process.stderr.write(`collect ${index + 1}/${pages.length} ${entry.url} opnieuw gemeten: ${measured.reason}\n`);
          const pictures = measured.noted.pictures;
          if (pictures && recountRecognised([pictures], seenPictures).length > 0) {
            await writeJson(join(options.run, "pages", entry.slug, "probes", "pictures.json"), pictures);
            measured.summary.pictures = { found: pictures.pictures.length, recognised: pictures.recognised };
          }
          const content = measured.noted.content;
          if (content) {
            await writeFileAtomic(pageContentPath(options.run, entry.slug), `${content.snapshot}\n`);
            await writeJson(pageStampPath(options.run, entry.slug), { key: measured.key, version: SWEEP_STAMP_VERSION, contentVersion: CONTENT_VERSION, blockers: sweep.blockersKey, contentSha256: content.sha256, summary: measured.summary, ...measured.scope.since({ dismissals: 0, refused: new Map() }) } satisfies PageStamp);
          }
          process.stderr.write(`collect ${index + 1}/${pages.length} ${entry.url} ${Date.now() - measured.started}ms\n`);
        },
      ),
    );
    if (!options.only) await writeJson(join(options.run, "collect.json"), { rendering: RENDERING, pages: summaries });
    // Each blocker as it stands on a page, and each component and process as its recipe opens it.
    const captured = !options.only
      ? await sayingItRuns("collect toestanden uit het sitemodel", async () => {
          const states = await withSpacing(settings, () => sweep.captureStates({ fresh: options.fresh === true, atOnce: settings.atOnce, seenPictures }));
          // A state that did not open because the session ran out is not written down as one that cannot be reached.
          await confirmLogin(browser);
          return sweep.write(states);
        })
      : null;
    const kept = reused + sweep.reusedStates.length > 0 ? { reusedPages: reused, reusedStates: sweep.reusedStates.length } : {};
    await writeManifest(options.run, { command: "collect", startedAt, pages: pages.length, only: options.only ?? null, ...(settings.atOnce > 1 ? { atOnce: settings.atOnce } : {}), ...(captured ? { siteStates: captured.states.length, siteStatesReached: captured.states.filter((state) => state.reached).length } : {}), ...kept }, browser.version());
  } finally {
    await browser.close();
  }
}
