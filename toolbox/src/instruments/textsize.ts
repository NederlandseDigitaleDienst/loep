import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import { wholePageScreenshot } from "../browser/screenshot.ts";
import { controlKey, type Control } from "./overflow.ts";

/** The default font size of Chromium, and twice that: what a user sets to read text at 200% without zooming the page. */
export const DEFAULT_FONT_PX = 16;
export const RAISED_FONT_PX = 32;
const DEFAULT_FIXED_PX = 13;
const RAISED_FIXED_PX = 26;
/** Rounding of the drawn size: text that is drawn at 1.95 times its size or more counts as twice as large. */
const DOUBLED = 1.95;
const SETTLE_MS = 250;

export const TEXT_SCALING_NOTE = `WCAG 1.4.4 vraagt één manier om tekst tot 200% te vergroten die de browser biedt (Understanding 1.4.4, F94): zoom van de hele pagina, of alleen de tekst. Zoom is gemeten als het venster gehalveerd; alleen de tekst als de standaardlettergrootte van Chromium van ${DEFAULT_FONT_PX} naar ${RAISED_FONT_PX} pixels, op de gewone breedte`;

interface TextSize {
  tag: string;
  text: string;
  path: string[];
  drawn: number;
}

export interface TextGrowth {
  tag: string;
  text: string;
  path: string[];
  /** The size at which the text is drawn in the default window, in CSS pixels. */
  drawn: number;
  /** How many times larger it is drawn with zoom of the whole page to 200%; null when it is not there at that size. */
  byZoom: number | null;
  /** How many times larger it is drawn with the default font size doubled; null when it is not there then. */
  byTextOnly: number | null;
}

export interface TextScaling {
  note: string;
  blocks: number;
  doubledByZoom: number;
  doubledByTextOnly: number;
  /** Text that zoom does not bring to 200% and the larger default font size does. */
  onlyByTextOnly: TextGrowth[];
  /** Text that neither way brings to 200%. */
  byNeither: TextGrowth[];
  /** What the larger default font size does to the page in the default window: what it cuts off and which controls it takes away. */
  textOnly: { newlyClipped: { tag: string; text: string; path: string[] }[]; controlsGone: string[]; horizontalScroll: boolean };
}

const key = (path: string[]): string => path.join(" >>> ");
const ratio = (after: number | undefined, before: number): number | null => (after === undefined || before <= 0 ? null : Math.round((after / before) * 100) / 100);

/** The drawn size of each block of text, now. */
export const textSizes = (page: Page): Promise<TextSize[]> => call<TextSize[]>(page, "textSizes");

/**
 * Doubles the default font size of the page, measures, and puts it back. A site that sizes its
 * text in rem or em, or calculates with them, grows its text; text in pixels or sized to the
 * window does not. The page is measured in the window it has.
 */
export async function withRaisedFontSize<T>(page: Page, measure: () => Promise<T>): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: RAISED_FONT_PX, fixed: RAISED_FIXED_PX } });
    await page.waitForTimeout(SETTLE_MS);
    return await measure();
  } finally {
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: DEFAULT_FONT_PX, fixed: DEFAULT_FIXED_PX } }).catch(() => undefined);
    await page.waitForTimeout(SETTLE_MS);
    await cdp.detach().catch(() => undefined);
  }
}

/**
 * Lays the sizes of the text in the default window next to those at 200% zoom and those with the
 * larger default font size. `atZoom` are the sizes in the halved window, in CSS pixels: on screen
 * each is drawn twice as large.
 */
export async function textScaling(page: Page, before: TextSize[], atZoom: TextSize[], screenshotPath: string): Promise<TextScaling> {
  const clippedBefore = new Set((await call<{ clipped: { path: string[] }[] }>(page, "overflowReport")).clipped.map((item) => key(item.path)));
  const controlsBefore = (await call<Control[]>(page, "hoverTargets")).map(controlKey);
  const raised = await withRaisedFontSize(page, async () => {
    const sizes = await textSizes(page);
    const report = await call<{ clipped: { tag: string; text: string; path: string[] }[]; horizontalScroll: boolean }>(page, "overflowReport");
    const controls = new Set((await call<Control[]>(page, "hoverTargets")).map(controlKey));
    await wholePageScreenshot(page, { path: screenshotPath });
    return { sizes, report, controls };
  });
  const zoomed = new Map(atZoom.map((size) => [key(size.path), size.drawn * 2]));
  const larger = new Map(raised.sizes.map((size) => [key(size.path), size.drawn]));
  const growth: TextGrowth[] = before.map((size) => ({ tag: size.tag, text: size.text, path: size.path, drawn: size.drawn, byZoom: ratio(zoomed.get(key(size.path)), size.drawn), byTextOnly: ratio(larger.get(key(size.path)), size.drawn) }));
  const doubled = (value: number | null): boolean => value !== null && value >= DOUBLED;
  return {
    note: TEXT_SCALING_NOTE,
    blocks: growth.length,
    doubledByZoom: growth.filter((entry) => doubled(entry.byZoom)).length,
    doubledByTextOnly: growth.filter((entry) => doubled(entry.byTextOnly)).length,
    onlyByTextOnly: growth.filter((entry) => entry.byZoom !== null && !doubled(entry.byZoom) && doubled(entry.byTextOnly)),
    byNeither: growth.filter((entry) => entry.byZoom !== null && !doubled(entry.byZoom) && !doubled(entry.byTextOnly)),
    textOnly: {
      newlyClipped: raised.report.clipped.filter((item) => !clippedBefore.has(key(item.path))).map((item) => ({ tag: item.tag, text: item.text, path: item.path })),
      controlsGone: [...new Set(controlsBefore.filter((control) => !raised.controls.has(control)))],
      horizontalScroll: raised.report.horizontalScroll,
    },
  };
}
