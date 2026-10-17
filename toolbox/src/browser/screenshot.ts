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

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size of the whole page in CSS pixels, by the same measures Playwright takes, and the limit in CSS pixels. Null when the page does not answer. */
async function measure(page: Page): Promise<{ width: number; height: number; limit: number } | null> {
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
  return size ? { width: size.width, height: size.height, limit: Math.floor(MAX_SCREENSHOT_HEIGHT / size.ratio) } : null;
}

/**
 * A picture of a region of a page that is taller than the limit, without `fullPage`: with
 * `fullPage` Chromium paints the whole page outside the window first, also with a clip, and on a
 * page of more than a hundred thousand pixels that does not finish. The window is made as tall as
 * the region (never taller than the limit) and scrolled to it, and both are put back before the
 * picture is returned, so whatever is measured after it sees the page as it was.
 */
async function regionInWindow(page: Page, viewport: { width: number; height: number }, region: Region, limit: number, options: { path?: string }): Promise<Buffer> {
  const height = Math.min(region.height, limit);
  const scrolled = await page.evaluate(() => [window.scrollX, window.scrollY] as [number, number]);
  const resize = height > viewport.height;
  try {
    if (resize) await page.setViewportSize({ width: viewport.width, height });
    const [left, top] = await page.evaluate(
      ([x, y]) => {
        window.scrollTo({ left: x!, top: y!, behavior: "instant" });
        return [window.scrollX, window.scrollY] as [number, number];
      },
      [region.x, region.y],
    );
    return await page.screenshot({ ...options, clip: { x: region.x - left, y: region.y - top, width: region.width, height }, animations: "disabled" });
  } finally {
    if (resize) await page.setViewportSize(viewport).catch(() => undefined);
    await page.evaluate(([x, y]) => window.scrollTo({ left: x!, top: y!, behavior: "instant" }), scrolled).catch(() => undefined);
  }
}

/**
 * A picture of the whole page, as `page.screenshot({ fullPage: true })`, but never taller than
 * `MAX_SCREENSHOT_HEIGHT` device pixels. `clippedAt` is null when the whole page is in the picture.
 */
export async function wholePageScreenshot(page: Page, options: { path?: string } = {}): Promise<{ image: Buffer; clippedAt: ScreenshotClip | null }> {
  const size = await measure(page);
  if (!size || size.height <= size.limit) return { image: await page.screenshot({ ...options, fullPage: true, animations: "disabled" }), clippedAt: null };
  const region = { x: 0, y: 0, width: size.width, height: size.limit };
  const viewport = page.viewportSize();
  const image = viewport ? await regionInWindow(page, viewport, region, size.limit, options) : await page.screenshot({ ...options, fullPage: true, clip: region, animations: "disabled" });
  return { image, clippedAt: { pageHeight: size.height, limit: size.limit } };
}

/**
 * A picture of a region of the page in page coordinates, as `page.screenshot({ fullPage: true, clip })`.
 * On a page taller than the limit the region is pictured through the window instead, and a region
 * taller than the limit stops at it.
 */
export async function regionScreenshot(page: Page, region: Region, options: { path?: string } = {}): Promise<Buffer> {
  const size = await measure(page);
  const viewport = page.viewportSize();
  if (!size || !viewport || size.height <= size.limit) return page.screenshot({ ...options, fullPage: true, clip: region, animations: "disabled" });
  return regionInWindow(page, viewport, region, size.limit, options);
}
