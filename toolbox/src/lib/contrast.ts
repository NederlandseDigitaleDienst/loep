import { PNG } from "pngjs";

export type Rgb = [number, number, number];

function channel(value: number): number {
  const normalised = value / 255;
  return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export function blend(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return foreground.map((value, index) => Math.round(value * alpha + background[index]! * (1 - alpha))) as Rgb;
}

/** WCAG "large text": 24 CSS pixels, or 18.66 when bold. Large text needs 3:1, other text 4.5:1. */
export function requiredRatio(fontSizePx: number, bold: boolean): number {
  return fontSizePx >= 24 || (bold && fontSizePx >= 18.66) ? 3 : 4.5;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackgroundSample {
  colour: Rgb;
  /** Share of the region's pixels that have exactly this colour. */
  share: number;
}

/**
 * The colour behind a piece of text, read from what was actually painted: the most
 * common colour in the region around it. Text covers a minority of its own box, so on
 * a flat background the background wins; on a photo or gradient no colour dominates.
 */
export function dominantColour(image: PNG, region: Region, padding = 2): BackgroundSample | null {
  const left = Math.max(0, region.x - padding);
  const top = Math.max(0, region.y - padding);
  const right = Math.min(image.width, region.x + region.width + padding);
  const bottom = Math.min(image.height, region.y + region.height + padding);
  if (right <= left || bottom <= top) return null;
  const counts = new Map<number, number>();
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const key = (image.data[offset]! << 16) | (image.data[offset + 1]! << 8) | image.data[offset + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return { colour: [(best >> 16) & 255, (best >> 8) & 255, best & 255], share: bestCount / ((right - left) * (bottom - top)) };
}

/** Whether the region contains pixels close to the given colour: is the text really painted there? */
export function containsColour(image: PNG, region: Region, colour: Rgb, tolerance = 40): boolean {
  const right = Math.min(image.width, region.x + region.width);
  const bottom = Math.min(image.height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < bottom; y++) {
    for (let x = Math.max(0, region.x); x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const distance = Math.abs(image.data[offset]! - colour[0]) + Math.abs(image.data[offset + 1]! - colour[1]) + Math.abs(image.data[offset + 2]! - colour[2]);
      if (distance <= tolerance) return true;
    }
  }
  return false;
}

/** Colours in a region, most common first, with the share of pixels each covers. */
export function colourShares(image: PNG, region: Region): BackgroundSample[] {
  const right = Math.min(image.width, region.x + region.width);
  const bottom = Math.min(image.height, region.y + region.height);
  const counts = new Map<number, number>();
  let total = 0;
  for (let y = Math.max(0, region.y); y < bottom; y++) {
    for (let x = Math.max(0, region.x); x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const key = (image.data[offset]! << 16) | (image.data[offset + 1]! << 8) | image.data[offset + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({ colour: [(key >> 16) & 255, (key >> 8) & 255, key & 255] as Rgb, share: count / total }));
}

/**
 * Most common colour on the outline of a box, moved outward (positive) or inward
 * (negative) by a number of pixels. Used to read a control's border and what surrounds it.
 */
export function ringColour(image: PNG, box: Region, offset: number): BackgroundSample | null {
  const left = box.x - offset;
  const top = box.y - offset;
  const right = box.x + box.width + offset - 1;
  const bottom = box.y + box.height + offset - 1;
  if (right <= left || bottom <= top) return null;
  const counts = new Map<number, number>();
  let total = 0;
  const sample = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const position = (y * image.width + x) * 4;
    const key = (image.data[position]! << 16) | (image.data[position + 1]! << 8) | image.data[position + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  };
  for (let x = left; x <= right; x++) {
    sample(x, top);
    sample(x, bottom);
  }
  for (let y = top + 1; y < bottom; y++) {
    sample(left, y);
    sample(right, y);
  }
  if (total === 0) return null;
  const [key, count] = [...counts.entries()].sort(([, a], [, b]) => b - a)[0]!;
  return { colour: [(key >> 16) & 255, (key >> 8) & 255, key & 255], share: count / total };
}

/** Round down to one decimal: a ratio is never reported as better than it is. */
export function floorRatio(ratio: number): number {
  return Math.floor(ratio * 10) / 10;
}

export interface FocusIndicator {
  /** Share of the region's pixels that look different with focus. */
  changedShare: number;
  /** Colour of the part of the indicator that stands out most from what it replaced. */
  indicator: Rgb | null;
  /** Most common colour at that part's pixels without focus: what it is drawn over. */
  replaced: Rgb | null;
  /** Contrast between the two, rounded down. WCAG 1.4.11 asks 3:1 for a focus indicator. */
  ratio: number | null;
}

/** A colour has to cover at least this share of the changed pixels to count as part of the indicator. */
const INDICATOR_SHARE = 0.08;

/**
 * Compare a region with and without keyboard focus. An indicator can consist of several
 * parts, such as a faint background tint and a strong ring. It is sufficient when one part
 * of real size stands out, so the part with the highest contrast against what it replaced is reported.
 */
export function focusIndicator(withFocus: PNG, withoutFocus: PNG, noise = 24): FocusIndicator | null {
  if (withFocus.width !== withoutFocus.width || withFocus.height !== withoutFocus.height) return null;
  const parts = new Map<number, Map<number, number>>();
  let changed = 0;
  for (let offset = 0; offset < withFocus.data.length; offset += 4) {
    const delta =
      Math.abs(withFocus.data[offset]! - withoutFocus.data[offset]!) +
      Math.abs(withFocus.data[offset + 1]! - withoutFocus.data[offset + 1]!) +
      Math.abs(withFocus.data[offset + 2]! - withoutFocus.data[offset + 2]!);
    if (delta <= noise) continue;
    changed++;
    const after = (withFocus.data[offset]! << 16) | (withFocus.data[offset + 1]! << 8) | withFocus.data[offset + 2]!;
    const before = (withoutFocus.data[offset]! << 16) | (withoutFocus.data[offset + 1]! << 8) | withoutFocus.data[offset + 2]!;
    const replaced = parts.get(after) ?? new Map<number, number>();
    parts.set(after, replaced);
    replaced.set(before, (replaced.get(before) ?? 0) + 1);
  }
  const rgb = (key: number): Rgb => [(key >> 16) & 255, (key >> 8) & 255, key & 255];
  let best: { indicator: Rgb; replaced: Rgb; ratio: number } | null = null;
  for (const [after, replacedCounts] of parts) {
    const size = [...replacedCounts.values()].reduce((sum, count) => sum + count, 0);
    if (size < Math.max(12, changed * INDICATOR_SHARE)) continue;
    const before = [...replacedCounts.entries()].sort(([, a], [, b]) => b - a)[0]![0];
    const ratio = contrastRatio(rgb(after), rgb(before));
    if (!best || ratio > best.ratio) best = { indicator: rgb(after), replaced: rgb(before), ratio };
  }
  return {
    changedShare: changed / (withFocus.width * withFocus.height),
    indicator: best?.indicator ?? null,
    replaced: best?.replaced ?? null,
    ratio: best ? floorRatio(best.ratio) : null,
  };
}

/**
 * The colour behind a piece of text: the most common colour inside the text's own box
 * once the pixels of the text itself are left out. Reading inside the box matters for a
 * small coloured label, where everything just outside the box is the page, not the label.
 * `share` is the part of the non-text pixels that has this colour; on a photo or gradient it is low.
 */
export function backgroundBehind(image: PNG, region: Region, textColour: Rgb, tolerance = 60): BackgroundSample | null {
  const right = Math.min(image.width, region.x + region.width);
  const bottom = Math.min(image.height, region.y + region.height);
  const counts = new Map<number, number>();
  let other = 0;
  for (let y = Math.max(0, region.y); y < bottom; y++) {
    for (let x = Math.max(0, region.x); x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const distance = Math.abs(image.data[offset]! - textColour[0]) + Math.abs(image.data[offset + 1]! - textColour[1]) + Math.abs(image.data[offset + 2]! - textColour[2]);
      if (distance <= tolerance) continue;
      const key = (image.data[offset]! << 16) | (image.data[offset + 1]! << 8) | image.data[offset + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      other++;
    }
  }
  if (other === 0) return null;
  const [key, count] = [...counts.entries()].sort(([, a], [, b]) => b - a)[0]!;
  return { colour: [(key >> 16) & 255, (key >> 8) & 255, key & 255], share: count / other };
}

export interface BackgroundRange {
  /** Lightest and darkest colour that cover a real part of the background behind the text. */
  lightest: Rgb;
  darkest: Rgb;
  /** Share of the box that has the text colour: the letters, and any background that looks like them. */
  textShare: number;
  /** Pixels just outside the box have the text colour too: part of the background looks like the text. */
  textColourAround: boolean;
}

/** Outliers on either side of this share of the background are a speck, not a background. */
const SUBSTANTIAL_SHARE = 0.05;

/**
 * The range of colours behind text on a photo or gradient, where no single colour is the
 * background. Pixels of the letters are left out, and so is the fringe around them, where
 * the browser mixes text and background. What remains is sorted by luminance; the ends,
 * minus a few percent of outliers, are the lightest and darkest substantial background.
 */
export function backgroundRange(image: PNG, region: Region, textColour: Rgb, tolerance = 60): BackgroundRange | null {
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(image.width, region.x + region.width);
  const bottom = Math.min(image.height, region.y + region.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  const isText = (x: number, y: number): boolean => {
    const offset = (y * image.width + x) * 4;
    return Math.abs(image.data[offset]! - textColour[0]) + Math.abs(image.data[offset + 1]! - textColour[1]) + Math.abs(image.data[offset + 2]! - textColour[2]) <= tolerance;
  };
  const text = new Uint8Array(width * height);
  let textPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isText(left + x, top + y)) {
        text[y * width + x] = 1;
        textPixels++;
      }
    }
  }
  const nearText = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [nx, ny] = [x + dx, y + dy];
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && text[ny * width + nx] === 1) return true;
      }
    }
    return false;
  };
  const collect = (skipFringe: boolean): { colour: Rgb; luminance: number }[] => {
    const found: { colour: Rgb; luminance: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (text[y * width + x] === 1 || (skipFringe && nearText(x, y))) continue;
        const offset = ((top + y) * image.width + left + x) * 4;
        const colour: Rgb = [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!];
        found.push({ colour, luminance: luminance(colour) });
      }
    }
    return found;
  };
  // Dense small text can leave nothing once the fringe is gone; then the fringe is all there is.
  let background = collect(true);
  if (background.length < 12) background = collect(false);
  if (background.length === 0) return null;
  background.sort((a, b) => a.luminance - b.luminance);
  const at = (share: number): Rgb => background[Math.round(share * (background.length - 1))]!.colour;

  // A band of three pixels around the box holds no letters of this text.
  let around = 0;
  let aroundText = 0;
  for (let y = Math.max(0, top - 3); y < Math.min(image.height, bottom + 3); y++) {
    for (let x = Math.max(0, left - 3); x < Math.min(image.width, right + 3); x++) {
      if (x >= left && x < right && y >= top && y < bottom) continue;
      around++;
      if (isText(x, y)) aroundText++;
    }
  }
  return {
    darkest: at(SUBSTANTIAL_SHARE),
    lightest: at(1 - SUBSTANTIAL_SHARE),
    textShare: textPixels / (width * height),
    textColourAround: around > 0 && aroundText / around >= 0.1,
  };
}
