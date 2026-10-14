import type { Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../../browser/call.ts";
import { ensureHelpers } from "./capsule.ts";

export interface ApiMotion {
  /** Whether the page itself reports something that moves: a running animation or media that plays by itself. */
  moves: boolean;
  runningAnimations: number;
  /** Videos that are playing now. */
  playingVideo: number;
  /** Audio and video with autoplay, playing or not: counted, not part of the verdict. */
  autoplayMedia: number;
  /** Things that can move without the animation API knowing: counted, not part of the verdict. */
  marqueeBlink: number;
  gifImages: number;
  longOrInfinite: unknown[];
  intervals: number;
}

interface MotionReport {
  runningAnimations: number;
  longOrInfinite: unknown[];
  gifImages: number;
  autoplayMedia: number;
  marqueeBlink: number;
  intervals: number;
}

/** What the page says about itself through the animation API. */
export async function apiMotion(page: Page): Promise<ApiMotion> {
  const report = await call<MotionReport>(page, "motionReport");
  // Sound that plays by itself is no movement; only a picture that plays is.
  const playingVideo = await page.evaluate(() => [...document.querySelectorAll("video")].filter((video) => !video.paused && !video.ended).length).catch(() => 0);
  return { moves: report.runningAnimations > 0 || playingVideo > 0, playingVideo, runningAnimations: report.runningAnimations, autoplayMedia: report.autoplayMedia, marqueeBlink: report.marqueeBlink, gifImages: report.gifImages, longOrInfinite: report.longOrInfinite.slice(0, 5), intervals: report.intervals };
}

export interface PixelMotion {
  moves: boolean;
  /** Pixels that differ between each picture and the next, stray ones left out. */
  changedPixels: number[];
  observedMs: number;
  /** What the pictures show: the whole page, or only the window when the page is too long for that. */
  area: "page" | "window";
  /** The part of the pictures in which anything changed, in coordinates of the document. */
  region: { x: number; y: number; width: number; height: number } | null;
  /** The element painted at the middle of that part. */
  element: { where: string; path: string[]; tag: string; text: string } | null;
}

/** A colour channel must differ more than this for a pixel to count as changed. */
const CHANNEL_TOLERANCE = 24;
/** Fewer changed pixels than this in one place is noise, such as a blinking caret or the edge of a picture that is drawn a little differently the next time. */
const MIN_CHANGED = 20;
/** Changed pixels in squares of this size that touch each other are one place. */
const CELL = 16;
const PICTURES = 6;
/** A page higher than this is watched through the window only: a picture of all of it takes too long to take six in a second. */
const MAX_PAGE_HEIGHT = 6000;

type Box = { left: number; top: number; right: number; bottom: number };

const around = (first: Box | null, second: Box): Box => (first ? { left: Math.min(first.left, second.left), top: Math.min(first.top, second.top), right: Math.max(first.right, second.right), bottom: Math.max(first.bottom, second.bottom) } : second);

/**
 * The places where two pictures differ: changed pixels that lie together, with their number and
 * the box around them. A few pixels far from the rest are a place of their own, so that they
 * can be left out and do not stretch the box of what moves to where nothing moves.
 */
export function changedPlaces(first: PNG, second: PNG): { changed: number; box: Box }[] {
  const width = Math.min(first.width, second.width);
  const height = Math.min(first.height, second.height);
  const columns = Math.ceil(width / CELL);
  const cells = new Map<number, { changed: number; box: Box }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * first.width + x) * 4;
      const b = (y * second.width + x) * 4;
      if (Math.abs(first.data[a]! - second.data[b]!) <= CHANNEL_TOLERANCE && Math.abs(first.data[a + 1]! - second.data[b + 1]!) <= CHANNEL_TOLERANCE && Math.abs(first.data[a + 2]! - second.data[b + 2]!) <= CHANNEL_TOLERANCE) continue;
      const key = Math.floor(y / CELL) * columns + Math.floor(x / CELL);
      const cell = cells.get(key);
      if (!cell) cells.set(key, { changed: 1, box: { left: x, top: y, right: x, bottom: y } });
      else {
        cell.changed++;
        // Rows come from top to bottom, so only the sides and the bottom can still move.
        cell.box.left = Math.min(cell.box.left, x);
        cell.box.right = Math.max(cell.box.right, x);
        cell.box.bottom = y;
      }
    }
  }
  const places: { changed: number; box: Box }[] = [];
  for (const start of [...cells.keys()]) {
    if (!cells.has(start)) continue;
    const place = { changed: 0, box: cells.get(start)!.box };
    const open = [start];
    while (open.length > 0) {
      const key = open.pop()!;
      const cell = cells.get(key);
      if (!cell) continue;
      cells.delete(key);
      place.changed += cell.changed;
      place.box = around(place.box, cell.box);
      const column = key % columns;
      for (const down of [-columns, 0, columns]) for (const across of [-1, 0, 1]) if (column + across >= 0 && column + across < columns) open.push(key + down + across);
    }
    places.push(place);
  }
  return places;
}

/** Count the pixels that differ between two pictures of the same size and note the box around them. */
export function changedBetween(first: PNG, second: PNG): { changed: number; box: Box | null } {
  const places = changedPlaces(first, second);
  return { changed: places.reduce((sum, place) => sum + place.changed, 0), box: places.reduce<Box | null>((box, place) => around(box, place.box), null) };
}

/**
 * Take pictures of the window over a few seconds and see whether anything changes between
 * them. This finds movement however it is made: a marquee, a script, a video, an animated image.
 */
export async function pixelMotion(page: Page, seconds: number): Promise<PixelMotion> {
  await ensureHelpers(page);
  const pause = Math.max(50, Math.round((seconds * 1000) / (PICTURES - 1)) - 40);
  const page_ = await page.evaluate(() => ({ height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), scroll: [window.scrollX, window.scrollY] as [number, number] }));
  const fullPage = page_.height <= MAX_PAGE_HEIGHT;
  const started = Date.now();
  const pictures: PNG[] = [];
  for (let index = 0; index < PICTURES; index++) {
    if (index > 0) await page.waitForTimeout(pause);
    pictures.push(PNG.sync.read(await page.screenshot({ animations: "allow", caret: "hide", fullPage })));
  }
  const observedMs = Date.now() - started;
  const changedPixels: number[] = [];
  let union: Box | null = null;
  for (let index = 1; index < pictures.length; index++) {
    const places = changedPlaces(pictures[index - 1]!, pictures[index]!).filter((place) => place.changed >= MIN_CHANGED);
    changedPixels.push(places.reduce((sum, place) => sum + place.changed, 0));
    for (const place of places) union = around(union, place.box);
  }
  // A picture of the window starts at the scroll position; a picture of the page at its top.
  const [offsetX, offsetY] = fullPage ? [0, 0] : page_.scroll;
  const region = union ? { x: union.left + offsetX, y: union.top + offsetY, width: union.right - union.left + 1, height: union.bottom - union.top + 1 } : null;
  const element = region
    ? await page.evaluate(([x, y]) => (window as unknown as { __loepm: { elementAtDocument: (x: number, y: number) => PixelMotion["element"] } }).__loepm.elementAtDocument(x!, y!), [region.x + region.width / 2, region.y + region.height / 2])
    : null;
  return { moves: region !== null, changedPixels, observedMs, area: fullPage ? "page" : "window", region, element };
}
