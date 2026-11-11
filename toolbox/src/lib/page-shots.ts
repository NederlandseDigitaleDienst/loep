import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "jpeg-js";
import { PNG } from "pngjs";
import type { Box } from "./cutout.ts";
import { pageIndex } from "./defects.ts";
import type { Evaluation, ReportFinding } from "./evaluation.ts";

/**
 * The pages of the sample as the reader knows them, with a mark at the place of each finding.
 *
 * The picture is the screenshot of the sweep (light scheme, the whole page). The place of a
 * finding is a box in the pixels of that page, recorded by an observation of an agent: a `crop`
 * (its box on the page), a `find` (the box of each element it found) or a full-page `look`. Such a
 * box counts only when the observation was made on the same address, in the light scheme, at the
 * width of the screenshot, and in the state the sweep saw: no steps, or only the clicks that close
 * a blocker the sweep closed too (a cookie banner). Without such a box the finding gets no mark;
 * nothing is guessed. The report then names it under the picture without a number.
 */

/** One picture of (a part of) a page: the whole page when it is short, a band around marks that lie close together when it is long. */
export interface PagePart {
  /** The picture as a data URI, made smaller and stored as JPEG. */
  src: string;
  width: number;
  height: number;
  /** Where the band starts and ends on the page, in pixels of the page. */
  fromY: number;
  toY: number;
  /** Per finding with a place in this band, its box in the pixels of `src`. */
  marks: Record<string, Box>;
}

export interface PageShot {
  parts: PagePart[];
}

/** The width of the picture in the report: wide enough to recognise the page, small enough for one file. */
export const SHOT_WIDTH = 1024;
/** A page up to this height is shown whole, down to a little below its lowest mark. */
const SHORT_PAGE = 1800;
/** Below the lowest mark the picture goes on this far, in pixels of the page, and no further. */
const BELOW_LAST_MARK = 320;
/** Marks closer together than this share one band. */
const CLUSTER_GAP = 480;
/** Around a band, so the reader sees where on the page it is. */
const BAND_MARGIN = 160;
const BAND_MIN_HEIGHT = 520;
const JPEG_QUALITY = 72;
/** A box bigger than this share of the page says nothing about where the defect is. */
const MAX_SHARE = 0.6;
const MIN_SIDE = 4;
/** Below this spread of brightness a box shows nothing but one colour: it is no place a reader recognises. */
const MIN_SPREAD = 6;

interface ObservationRecord {
  id?: string;
  command?: string;
  error?: string | null;
  page?: { url?: string; scheme?: string; viewport?: { width?: number } } | null;
  state?: { steps?: { command?: string; target?: string[] | null }[] } | null;
  target?: { path?: string[] } | null;
  result?: unknown;
}

const isBox = (value: unknown): value is Box => typeof value === "object" && value !== null && ["x", "y", "width", "height"].every((key) => typeof (value as Record<string, unknown>)[key] === "number");
const keyOf = (url: string, path: string[]): string => `${url}\n${path.join("\u0000")}`;

function readRecords(runDir: string): ObservationRecord[] {
  const root = join(runDir, "observations");
  if (!existsSync(root)) return [];
  const records: ObservationRecord[] = [];
  // Sorted, so the first box recorded for an element is the same one every time.
  for (const session of readdirSync(root).sort()) {
    const dir = join(root, session);
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        records.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as ObservationRecord);
      } catch {
        // A record that cannot be read gives no place.
      }
    }
  }
  return records;
}

/** The selectors of the blockers the sweep closed, such as a cookie banner: clicks inside them change nothing the screenshot shows. */
function blockerSelectors(runDir: string): string[] {
  try {
    const site = JSON.parse(readFileSync(join(runDir, "site.json"), "utf8")) as { blockers?: { postcondition?: { selector?: string } }[] };
    return (site.blockers ?? []).map((blocker) => blocker.postcondition?.selector).filter((selector): selector is string => typeof selector === "string" && selector.length > 0);
  } catch {
    return [];
  }
}

/** The box of every element an agent recorded with a place on the page, in the state of the sweep, by address and path. */
function boxIndex(records: ObservationRecord[], urls: Set<string>, width: (url: string) => number | null, blockers: string[]): Map<string, Box[]> {
  const boxes = new Map<string, Box[]>();
  const add = (url: string, path: unknown, box: unknown): void => {
    if (!Array.isArray(path) || path.length === 0 || !isBox(box) || box.width < 1 || box.height < 1) return;
    const key = keyOf(url, path as string[]);
    boxes.set(key, [...(boxes.get(key) ?? []), box]);
  };
  for (const record of records) {
    const url = record.page?.url;
    if (record.error || !url || !urls.has(url) || record.page?.scheme !== "light" || record.page.viewport?.width !== width(url)) continue;
    const steps = record.state?.steps ?? [];
    if (!steps.every((step) => step.command === "click" && step.target?.[0] && blockers.some((selector) => step.target![0]!.startsWith(selector)))) continue;
    const result = (record.result ?? {}) as { box?: unknown; items?: { path?: unknown; box?: unknown; visible?: boolean }[]; full?: boolean };
    if (record.command === "crop") add(url, record.target?.path, result.box);
    if (record.command === "find") for (const item of result.items ?? []) if (item.visible !== false) add(url, item.path, item.box);
    if (record.command === "look" && result.full) for (const item of result.items ?? []) if (item.visible !== false) add(url, item.path, item.box);
  }
  return boxes;
}

/** Make a picture narrower by averaging the pixels that fall into each new one, and cut it off at `height` pixels of the original. */
function shrink(source: PNG, width: number, height: number): { data: Buffer; width: number; height: number } {
  const scale = source.width / width;
  const outHeight = Math.max(1, Math.round(height / scale));
  const data = Buffer.alloc(width * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * source.width + sx) * 4;
          r += source.data[at]!;
          g += source.data[at + 1]!;
          b += source.data[at + 2]!;
          n++;
        }
      }
      const to = (y * width + x) * 4;
      data[to] = Math.round(r / n);
      data[to + 1] = Math.round(g / n);
      data[to + 2] = Math.round(b / n);
      data[to + 3] = 255;
    }
  }
  return { data, width, height: outHeight };
}

/** Per page label: the picture of the page with the places of its findings, for every page with at least one place. */
export function pageShots(runDir: string, evaluation: Evaluation): Record<string, PageShot> {
  const { labels } = pageIndex(evaluation);
  const items = evaluation.sample.items;
  const urlOf = new Map(items.map((item, index) => [labels[index]!, item.url]));
  const screenshotOf = (index: number): string => join(runDir, "pages", items[index]!.slug, "screenshot-light.png");
  const widths = new Map<string, number | null>();
  items.forEach((item, index) => {
    const path = screenshotOf(index);
    let width: number | null = null;
    try {
      const bytes = readFileSync(path);
      if (bytes.toString("latin1", 12, 16) === "IHDR") width = bytes.readUInt32BE(16);
    } catch {
      width = null;
    }
    widths.set(item.url, width);
  });
  const records = readRecords(runDir);
  const byId = new Map(records.filter((record) => record.id).map((record) => [record.id!, record]));
  const boxes = boxIndex(records, new Set(items.map((item) => item.url)), (url) => widths.get(url) ?? null, blockerSelectors(runDir));

  // Pictures are read once, and only for pages that have a candidate.
  const pictures = new Map<number, PNG | null>();
  const pictureOf = (index: number): PNG | null => {
    if (!pictures.has(index)) {
      try {
        pictures.set(index, PNG.sync.read(readFileSync(screenshotOf(index))));
      } catch {
        pictures.set(index, null);
      }
    }
    return pictures.get(index)!;
  };

  // The place of each finding: the first box of its elements that passes every check. A mark too few beats a wrong one.
  const places = new Map<string, { index: number; box: Box }>();
  const findings: ReportFinding[] = evaluation.criteria.flatMap((criterion) => criterion.findings);
  for (const finding of findings) {
    const candidates: { url: string; path: string[] }[] = [
      ...(finding.targets ?? []).filter((target) => urlOf.has(target.page)).map((target) => ({ url: urlOf.get(target.page)!, path: target.path })),
      ...finding.evidence.map((id) => byId.get(id)).flatMap((record) => (record?.page?.url && record.target?.path?.length ? [{ url: record.page.url, path: record.target.path }] : [])),
    ];
    search: for (const candidate of candidates) {
      const index = items.findIndex((item) => item.url === candidate.url);
      if (index < 0) continue;
      for (const box of boxes.get(keyOf(candidate.url, candidate.path)) ?? []) {
        const picture = pictureOf(index);
        if (picture && plausible(box, picture)) {
          places.set(finding.id, { index, box });
          break search;
        }
      }
    }
  }

  const shots: Record<string, PageShot> = {};
  items.forEach((_item, index) => {
    const own = findings.flatMap((finding) => (places.get(finding.id)?.index === index ? [[finding.id, places.get(finding.id)!.box] as const] : []));
    const picture = own.length > 0 ? pictureOf(index) : null;
    if (!picture) return;
    shots[labels[index]!] = { parts: bands(picture, own).map(([fromY, toY, inBand]) => part(picture, fromY, toY, inBand)) };
  });
  return shots;
}

/** A box that lies wholly on the page, is not tiny and not most of the page, and shows more than one colour. */
function plausible(box: Box, picture: PNG): boolean {
  if (box.width < MIN_SIDE || box.height < MIN_SIDE || box.x < 0 || box.y < 0 || box.x + box.width > picture.width || box.y + box.height > picture.height) return false;
  if (box.width * box.height > MAX_SHARE * picture.width * picture.height) return false;
  // The spread of brightness over a grid of at most 32 by 32 points in the box.
  const steps = 32;
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let row = 0; row < steps; row++) {
    for (let column = 0; column < steps; column++) {
      const x = Math.min(picture.width - 1, Math.floor(box.x + ((column + 0.5) * box.width) / steps));
      const y = Math.min(picture.height - 1, Math.floor(box.y + ((row + 0.5) * box.height) / steps));
      const at = (y * picture.width + x) * 4;
      const light = 0.2126 * picture.data[at]! + 0.7152 * picture.data[at + 1]! + 0.0722 * picture.data[at + 2]!;
      sum += light;
      squares += light * light;
      count++;
    }
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, squares / count - mean * mean)) >= MIN_SPREAD;
}

/** The bands of a page to show: the whole short page, or one band per group of marks that lie close together. */
function bands(picture: PNG, marks: (readonly [string, Box])[]): [number, number, (readonly [string, Box])[]][] {
  const lowest = Math.max(...marks.map(([, box]) => box.y + box.height));
  if (picture.height <= SHORT_PAGE) return [[0, Math.min(picture.height, Math.max(Math.round(lowest + BELOW_LAST_MARK), Math.min(picture.height, 800))), [...marks]]];
  const sorted = [...marks].sort((a, b) => a[1].y - b[1].y || a[0].localeCompare(b[0]));
  const groups: (readonly [string, Box])[][] = [];
  for (const mark of sorted) {
    const last = groups[groups.length - 1];
    const bottom = last ? Math.max(...last.map(([, box]) => box.y + box.height)) : -Infinity;
    if (last && mark[1].y - bottom <= CLUSTER_GAP) last.push(mark);
    else groups.push([mark]);
  }
  const result: [number, number, (readonly [string, Box])[]][] = groups.map((group) => {
    const top = Math.min(...group.map(([, box]) => box.y));
    const bottom = Math.max(...group.map(([, box]) => box.y + box.height));
    const grow = Math.max(0, BAND_MIN_HEIGHT - (bottom - top + 2 * BAND_MARGIN)) / 2;
    const fromY = Math.max(0, Math.round(top - BAND_MARGIN - grow));
    return [fromY, Math.min(picture.height, Math.max(fromY + BAND_MIN_HEIGHT, Math.round(bottom + BAND_MARGIN + grow))), group];
  });
  // Bands that touch become one.
  const merged: typeof result = [];
  for (const band of result) {
    const last = merged[merged.length - 1];
    if (last && band[0] <= last[1] + BAND_MARGIN * 2) merged[merged.length - 1] = [last[0], Math.max(last[1], band[1]), [...last[2], ...band[2]]];
    else merged.push(band);
  }
  return merged;
}

function part(picture: PNG, fromY: number, toY: number, marks: (readonly [string, Box])[]): PagePart {
  const width = Math.min(SHOT_WIDTH, picture.width);
  const band = new PNG({ width: picture.width, height: toY - fromY });
  PNG.bitblt(picture, band, 0, fromY, picture.width, toY - fromY, 0, 0);
  const small = shrink(band, width, band.height);
  const scale = width / picture.width;
  const jpeg = encode({ data: small.data, width: small.width, height: small.height }, JPEG_QUALITY);
  const clip = (value: number, max: number): number => Math.max(0, Math.min(max, value));
  return {
    src: `data:image/jpeg;base64,${Buffer.from(jpeg.data).toString("base64")}`,
    width: small.width,
    height: small.height,
    fromY,
    toY,
    marks: Object.fromEntries(
      marks.map(([id, box]) => {
        const x = clip(Math.round(box.x * scale), small.width - 1);
        const y = clip(Math.round((box.y - fromY) * scale), small.height - 1);
        return [id, { x, y, width: Math.max(2, clip(Math.round(box.width * scale), small.width - x)), height: Math.max(2, clip(Math.round(box.height * scale), small.height - y)) }];
      }),
    ),
  };
}
