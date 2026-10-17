import type { Page } from "playwright";

/**
 * The tallest picture of a whole page the sweep takes, in device pixels. Chromium paints a picture
 * of at most 16384 pixels high in one go; a picture of a much taller page (a page of tens of
 * thousands of words) timed out or crashed the renderer, and stopped the whole sweep. A taller page
 * is pictured from the top down to this height, and the facts say so.
 */
export const MAX_SCREENSHOT_HEIGHT = 16384;

/** A picture of the whole page that stops at the limit: the height of the page and the height where the picture ends, both in CSS pixels. */
export interface ScreenshotClip {
  pageHeight: number;
  limit: number;
}

/**
 * A picture of the whole page, as `page.screenshot({ fullPage: true })`, but never taller than
 * `MAX_SCREENSHOT_HEIGHT` device pixels. `clippedAt` is null when the whole page is in the picture.
 */
export async function wholePageScreenshot(page: Page, options: { path?: string } = {}): Promise<{ image: Buffer; clippedAt: ScreenshotClip | null }> {
  // The same measures Playwright takes for the size of the whole page.
  const size = await page
    .evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        width: Math.max(root.scrollWidth, root.offsetWidth, root.clientWidth, body?.scrollWidth ?? 0, body?.offsetWidth ?? 0),
        height: Math.max(root.scrollHeight, root.offsetHeight, root.clientHeight, body?.scrollHeight ?? 0, body?.offsetHeight ?? 0),
        ratio: window.devicePixelRatio || 1,
      };
    })
    .catch(() => null);
  const limit = size ? Math.floor(MAX_SCREENSHOT_HEIGHT / size.ratio) : null;
  if (!size || limit === null || size.height <= limit) return { image: await page.screenshot({ ...options, fullPage: true, animations: "disabled" }), clippedAt: null };
  const image = await page.screenshot({ ...options, fullPage: true, clip: { x: 0, y: 0, width: size.width, height: limit }, animations: "disabled" });
  return { image, clippedAt: { pageHeight: size.height, limit } };
}
