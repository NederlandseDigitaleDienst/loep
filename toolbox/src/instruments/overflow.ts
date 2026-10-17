import type { BrowserContext, Page } from "playwright";
import { call } from "../browser/call.ts";
import { wholePageScreenshot } from "../browser/screenshot.ts";
import { collectClickables, type Described } from "./facts.ts";

export interface ViewportProbe {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  note: string;
}

export const VIEWPORT_PROBES: ViewportProbe[] = [
  { name: "reflow", viewport: { width: 320, height: 256 }, deviceScaleFactor: 1, note: "WCAG 1.4.10: 320 by 256 CSS pixels, equal to 1280 by 1024 at 400% zoom" },
  { name: "zoom200", viewport: { width: 640, height: 400 }, deviceScaleFactor: 2, note: "WCAG 1.4.4: the 1280 by 800 window at 200% browser zoom" },
  { name: "portrait", viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1, note: "WCAG 1.3.4: portrait orientation" },
];

/** What a visitor has on the page as it is drawn: headings, images and blocks of text by their own words, and what is drawn a quarter turn. */
export interface ContentInventory {
  viewport: { width: number; height: number };
  headings: string[];
  images: string[];
  textBlocks: string[];
  rotatedQuarterTurn: (Described & { angle: number })[];
  /** Rules in the stylesheets that only hold in one orientation. */
  orientationRules: number;
}

export interface OverflowResult {
  report: Record<string, unknown>;
  visibleControls: string[];
  clickables: Described[];
  /** The content at this size, to lay next to the content in the default window. */
  content: ContentInventory;
}

/** What runs past the edge of the window or is cut off at its current size, with a picture of the whole page. */
export async function overflowProbe(page: Page, screenshotPath: string): Promise<OverflowResult> {
  const report = await call<Record<string, unknown>>(page, "overflowReport");
  const visibleControls = (await call<{ text: string; tag: string }[]>(page, "targetSizes")).map((target) => `${target.tag}:${target.text}`).sort();
  const { clippedAt } = await wholePageScreenshot(page, { path: screenshotPath });
  if (clippedAt) report.screenshotClippedAt = clippedAt;
  // Some clickable elements only exist at this size, such as a menu button on a narrow screen.
  const clickables = await collectClickables(page);
  return { report, visibleControls, clickables, content: await call<ContentInventory>(page, "contentInventory") };
}

/**
 * The same measurement on a page that is already open, by resizing its window and putting
 * it back. A page that only arranges itself while loading is measured better on a fresh page at that size.
 */
export async function overflowAtSize(page: Page, viewport: { width: number; height: number }, screenshotPath: string): Promise<OverflowResult> {
  const original = page.viewportSize();
  await page.setViewportSize(viewport);
  await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS);
  try {
    return await overflowProbe(page, screenshotPath);
  } finally {
    if (original) {
      await page.setViewportSize(original);
      await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS);
    }
  }
}

/**
 * Only the geometry at a size, with a picture: what runs past the edge and what is cut off.
 * It asks nothing that only Chromium can answer, so it also runs in a second browser.
 */
export async function overflowGeometryAtSize(page: Page, viewport: { width: number; height: number }, screenshotPath: string): Promise<Record<string, unknown>> {
  const original = page.viewportSize();
  await page.setViewportSize(viewport);
  await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS);
  try {
    const report = await call<Record<string, unknown>>(page, "overflowReport");
    const { clippedAt } = await wholePageScreenshot(page, { path: screenshotPath });
    if (clippedAt) report.screenshotClippedAt = clippedAt;
    return report;
  } finally {
    if (original) {
      await page.setViewportSize(original);
      await page.waitForTimeout(SETTLE_AFTER_RESIZE_MS);
    }
  }
}

const SETTLE_AFTER_RESIZE_MS = 250;
export const TEXT_SPACING_NOTE = "WCAG 1.4.12: line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em, forced in the document and in every shadow root, also in shadow roots that appear later";

export interface TextSpacingResult {
  note: string;
  shadowRootsStyled: number;
  textWithoutSpacing: unknown[];
  textWithoutSpacingCount: number;
  clippedBefore: number;
  newlyClipped: { path: string[] }[];
  horizontalScrollAfter: boolean;
}

/**
 * Text spacing: measure clipping before and after forcing the WCAG values. The page keeps the
 * wider spacing unless `restore` is set, so by default it is meant for a page that is then thrown away.
 */
export async function textSpacing(page: Page, screenshotPath: string, restore = false): Promise<TextSpacingResult> {
  const before = await call<{ clipped: { path: string[] }[] }>(page, "overflowReport");
  const result = await spacingEffect(page, before.clipped, screenshotPath);
  if (restore) {
    await call(page, "removeTextSpacing");
    await page.waitForTimeout(250);
  }
  return result;
}

/**
 * Force the WCAG values on the page as it is now and say what is cut off that was not in
 * `clippedBefore`. For a state of the site model the values are in force before the state is
 * opened, and `clippedBefore` comes from the same state opened without them.
 */
export async function spacingEffect(page: Page, clippedBefore: { path: string[] }[], screenshotPath: string): Promise<TextSpacingResult> {
  const applied = await call<{ shadowRootsStyled: number; resistant: unknown[]; resistantCount: number }>(page, "applyTextSpacing");
  await page.waitForTimeout(250);
  const after = await call<{ clipped: { path: string[] }[]; horizontalScroll: boolean }>(page, "overflowReport");
  const already = new Set(clippedBefore.map((item) => item.path.join(" >>> ")));
  await wholePageScreenshot(page, { path: screenshotPath });
  return {
    note: TEXT_SPACING_NOTE,
    shadowRootsStyled: applied.shadowRootsStyled,
    textWithoutSpacing: applied.resistant,
    textWithoutSpacingCount: applied.resistantCount,
    clippedBefore: clippedBefore.length,
    newlyClipped: after.clipped.filter((item) => !already.has(item.path.join(" >>> "))),
    horizontalScrollAfter: after.horizontalScroll,
  };
}

export type Control = Described & { tag: string; text: string; ariaLabel: string | null; region: string | null; path: string[] };
export const controlKey = (control: Control): string => `${control.tag}|${control.text.slice(0, 40) || control.ariaLabel || ""}|${control.region}`;
const controlNl = (control: Control): string => `${control.tag} "${(control.text || control.ariaLabel || "").slice(0, 40)}" [${control.region ?? "-"}]`;

/** The controls that are visible now, by a key that is the same before and after a change of layout. */
export async function visibleControlKeys(page: Page): Promise<string[]> {
  return (await call<Control[]>(page, "hoverTargets")).map(controlKey);
}

/** How many controls that only exist with the wider spacing are opened on one page. */
const MAX_OPENED_WITH_SPACING = 4;

export interface SpacingControls {
  /** Controls that are there with the wider spacing and were not without it, such as a button that takes what no longer fits. */
  appeared: {
    control: string;
    where: string;
    /** For a button or expander: what it showed when it was activated with the spacing in force. Absent for a link or a field. */
    opened?: { controls: string[]; text: string[]; clipped: { text: string; where: string }[]; screenshot: string | null; failedNl?: string };
  }[];
  /** Controls that were there without the wider spacing and are gone with it, and whether one of the opened buttons shows them. */
  disappeared: { control: string; foundBehind: string | null }[];
}

/**
 * What the wider text spacing does to the controls of a page: which ones come and which ones
 * go. A header that no longer fits moves links behind a button that was not there before;
 * that button is activated here, with the spacing still in force, and what it shows is laid
 * next to what went. `before` is `visibleControlKeys` of the page without the spacing; the
 * page has the spacing now.
 */
export async function controlsOnlyWithSpacing(page: Page, before: string[], screenshot: (index: number) => { path: string; relative: string }): Promise<SpacingControls> {
  const was = new Set(before);
  const now = await call<Control[]>(page, "hoverTargets");
  const here = new Set(now.map(controlKey));
  const gone = [...new Set(before.filter((key) => !here.has(key)))];
  const triggers = new Set((await call<Control[]>(page, "triggers")).map((trigger) => trigger.path.join(" >>> ")));
  const appeared: SpacingControls["appeared"] = [];
  const behind = new Map<string, string>();
  let opened = 0;
  for (const control of now.filter((entry) => !was.has(controlKey(entry)))) {
    const where = control.path.join(" >>> ");
    const row: SpacingControls["appeared"][number] = { control: controlNl(control), where };
    appeared.push(row);
    if (!triggers.has(where) || opened >= MAX_OPENED_WITH_SPACING) continue;
    opened++;
    try {
      const textBefore = new Set(await call<string[]>(page, "textChunks"));
      const keysBefore = new Set((await call<Control[]>(page, "hoverTargets")).map(controlKey));
      const handle = (await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), control.path)).asElement();
      if (!handle) throw new Error("het element was er niet meer");
      await handle.click({ timeout: 3000 });
      await page.waitForTimeout(400);
      const shown = (await call<Control[]>(page, "hoverTargets")).filter((entry) => !keysBefore.has(controlKey(entry)));
      const text = (await call<string[]>(page, "textChunks")).filter((chunk) => !textBefore.has(chunk));
      const report = await call<{ clipped: Control[] }>(page, "overflowReport");
      const shownPaths = shown.map((entry) => entry.path.join(" >>> "));
      const shot = screenshot(opened);
      await page.screenshot({ path: shot.path, animations: "disabled" });
      row.opened = { controls: shown.map(controlNl), text: text.slice(0, 20).map((chunk) => chunk.slice(0, 80)), clipped: report.clipped.filter((entry) => shownPaths.some((path) => entry.path.join(" >>> ").startsWith(path) || path.startsWith(entry.path.join(" >>> ")))).map((entry) => ({ text: entry.text.slice(0, 80), where: entry.path.join(" >>> ") })), screenshot: shot.relative };
      for (const entry of shown) if (!behind.has(controlKey(entry))) behind.set(controlKey(entry), row.control);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    } catch (error) {
      row.opened = { controls: [], text: [], clipped: [], screenshot: null, failedNl: (error as Error).message.split("\n")[0]! };
    }
  }
  const nameOf = (key: string): string => {
    const [tag, text, region] = key.split("|");
    return `${tag} "${text}" [${region === "null" ? "-" : region}]`;
  };
  return { appeared, disappeared: gone.map((key) => ({ control: nameOf(key), foundBehind: behind.get(key) ?? null })) };
}

/**
 * Put the WCAG values in force in every document a browser context loads, from the moment
 * the document is there: before a recipe opens anything. A menu that is laid out while it
 * opens, or a hint that is placed once, is then measured as a user with wider spacing gets it.
 */
export async function spacingFromLoad(context: BrowserContext): Promise<void> {
  // The library is defined by a later init script; it is there once the document has loaded.
  await context.addInitScript(() => addEventListener("DOMContentLoaded", () => (window as unknown as { __loep?: { applyTextSpacing: () => unknown } }).__loep?.applyTextSpacing()));
}
