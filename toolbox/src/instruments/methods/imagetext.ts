import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { contrastRatio, floorRatio, luminance, requiredRatio, type Region, type Rgb } from "../../lib/contrast.ts";
import { MIN_CONFIDENCE, ocrLines, type OcrLine, type Reading } from "./ocr.ts";

export interface ColourGroup {
  /** The most common colour of the group. */
  colour: Rgb;
  /** Most of the group has that one colour; the rest is the edge of a letter, a speck or noise. */
  flat: boolean;
  /** The ends of the group, minus a few percent of outliers on either side; the colour itself when the group is flat. */
  lightest: Rgb;
  darkest: Rgb;
  pixels: number;
}

export interface ColourGroups {
  text: ColourGroup;
  background: ColourGroup;
  /** The rows of the picture in which anything but background lies: the height the letters really have. */
  ink: { top: number; bottom: number };
}

/** Why a box gives no groups: its outline does not lie on one background, or what is inside it is not two colours. */
export type NoGroups = "outline" | "colours";

/** Outliers on either side of this share of a group are specks, not its colour. */
const OUTLIER_SHARE = 0.05;
/** Colours closer together than this (sum over the three channels) are not two colours. */
const MIN_SEPARATION = 30;
/** More than this share of the box between letter and background is no anti-aliasing: the background is a photo or the letters fade into it. */
const MAX_BETWEEN_SHARE = 0.4;

const distance = (first: Rgb, second: Rgb): number => Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) + Math.abs(first[2] - second[2]);

/** Colours this close to the most common one (sum over the three channels) are that colour, with the noise of a compressed picture. */
const SAME_COLOUR = 24;
/** A group is flat when at least this share of it has its most common colour. */
const FLAT_SHARE = 0.5;

function groupOf(colours: Rgb[]): ColourGroup {
  const counts = new Map<number, number>();
  for (const [r, g, b] of colours) counts.set((r << 16) | (g << 8) | b, (counts.get((r << 16) | (g << 8) | b) ?? 0) + 1);
  const key = [...counts.entries()].sort(([, a], [, b]) => b - a)[0]![0];
  const colour: Rgb = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
  // What is left of the edge of a letter has many colours, each a few times; a flat colour is most of its group.
  if (colours.filter((other) => distance(other, colour) <= SAME_COLOUR).length >= FLAT_SHARE * colours.length) return { colour, flat: true, lightest: colour, darkest: colour, pixels: colours.length };
  const sorted = colours.map((entry) => ({ colour: entry, luminance: luminance(entry) })).sort((a, b) => a.luminance - b.luminance);
  const at = (share: number): Rgb => sorted[Math.round(share * (sorted.length - 1))]!.colour;
  return { colour, flat: false, darkest: at(OUTLIER_SHARE), lightest: at(1 - OUTLIER_SHARE), pixels: sorted.length };
}

/** A step between two neighbours on the outline of two colours, and larger than this share of what sets the letters apart, is another surface or a letter, not the background. */
const OUTLINE_STEP = 0.5;
/** Letters that fill less than this share of the height of their box were given a box that is too high. */
const MIN_INK_SHARE = 0.7;

function groupsWithin(image: PNG, region: Region, pad: number): ColourGroups | NoGroups {
  const left = Math.max(0, Math.floor(region.x) - pad);
  const top = Math.max(0, Math.floor(region.y) - pad);
  const right = Math.min(image.width, Math.ceil(region.x + region.width) + pad);
  const bottom = Math.min(image.height, Math.ceil(region.y + region.height) + pad);
  const width = right - left;
  const height = bottom - top;
  if (width < 4 || height < 4) return "colours";
  const at = (x: number, y: number): Rgb => {
    const offset = ((top + y) * image.width + left + x) * 4;
    return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!];
  };
  const colours: Rgb[] = [];
  const apart: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = at(x, y);
      colours.push(colour);
      apart.push(Math.min(distance(colour, at(x, 0)), distance(colour, at(x, height - 1)), distance(colour, at(0, y)), distance(colour, at(width - 1, y))));
    }
  }
  // The pixels that differ most are the middle of a letter; a few percent of them are left out as specks.
  const most = [...apart].sort((a, b) => a - b)[Math.round(0.98 * (apart.length - 1))]!;
  // Once around the outline. On a background, also a gradient, each pixel is close to the one before. A jump is another
  // surface or a letter: what has that colour inside the box would then count as background, whatever it is.
  const outline: Rgb[] = [];
  for (let x = 0; x < width; x++) outline.push(at(x, 0));
  for (let y = 1; y < height; y++) outline.push(at(width - 1, y));
  for (let x = width - 2; x >= 0; x--) outline.push(at(x, height - 1));
  for (let y = height - 2; y >= 0; y--) outline.push(at(0, y));
  if (outline.some((colour, index) => distance(colour, outline[index === 0 ? outline.length - 1 : index - 1]!) > Math.max(MIN_SEPARATION, OUTLINE_STEP * most))) return "outline";
  if (most < MIN_SEPARATION) return "colours";
  const pick = (from: number, to: number): Rgb[] => colours.filter((_, index) => apart[index]! >= from * most && apart[index]! <= to * most);
  const background = pick(0, 0.25);
  const text = pick(0.75, Infinity);
  if (text.length < 6 || background.length < 6) return "colours";
  if ((colours.length - text.length - background.length) / colours.length > MAX_BETWEEN_SHARE) return "colours";
  const inked = apart.map((value, index) => (value > 0.25 * most ? Math.floor(index / width) : -1)).filter((row) => row >= 0);
  const groups = { text: groupOf(text), background: groupOf(background), ink: { top: top + inked[0]!, bottom: top + inked.at(-1)! } };
  return distance(groups.text.colour, groups.background.colour) < MIN_SEPARATION ? "colours" : groups;
}

/**
 * The colour of the letters and of the background in the box of one line of text in a picture.
 * The box is widened a little, so its outline lies on the background. Every pixel is set
 * against the outline in its own row and column: the background there, also on a gradient.
 * Pixels that differ most are the letters, pixels that hardly differ the background. What
 * lies between is the edge of a letter, where both are mixed, and belongs to neither group.
 * An outline that crosses another surface is tried again closer to the box; when no outline
 * lies on one background there are no groups, because the comparison would be with the wrong colour.
 */
export function colourGroups(image: PNG, region: Region): ColourGroups | NoGroups {
  const widest = Math.max(2, Math.round(region.height * 0.15));
  for (const pad of new Set([widest, Math.ceil(widest / 2), 1])) {
    const found = groupsWithin(image, region, pad);
    if (found !== "outline") return found;
  }
  return "outline";
}

export interface ImageTextLine {
  text: string;
  /** In CSS pixels, from the top left corner of the element. */
  box: Region;
  /** How sure the recognition is of the words, from 0 to 100. */
  confidence: number;
  /** Which reading of the recognition found the line; absent for a box that was pointed at. */
  reading?: Reading;
  /** Estimated from the height of the box and the letters recognised in it. */
  fontSizePx: number;
  foreground: string | null;
  background: string | null;
  /** The worst case, rounded down to one decimal; null when the line was not measured. */
  ratio: number | null;
  /** The best case; the same as `ratio` when letters and background are flat. */
  bestRatio: number | null;
  /** The requirement for the estimated size, taking the text as not bold. */
  required: number;
  /** The estimated size is close to where large text begins, or would be large if bold: the requirement is 3 or 4.5. */
  requiredUncertain: boolean;
  outcome: "passed" | "failed" | "cantTell";
  /** Why the line has no ratio. */
  reason: string | null;
  /** What makes the ratio of this line less than certain. */
  uncertain: string[];
}

export interface ImageTextAnswer {
  lines: ImageTextLine[];
  languages: string;
  /** The picture was enlarged before recognition. */
  scale: number;
}

const hex = (colour: Rgb): string => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/** Share of the font size between the baseline and the top of a capital, of a small letter, and below the baseline; of a common sans-serif. */
const CAP_HEIGHT = 0.72;
const X_HEIGHT = 0.52;
const DESCENT = 0.21;

/** The font size that gives a line of this text a box of this height. An estimate: the typeface is not known. */
export function estimatedFontSize(text: string, heightPx: number): number {
  const tall = /[\p{Lu}\p{N}bdfhklt]/u.test(text);
  const low = /[gjpqy]/.test(text);
  return heightPx / ((tall ? CAP_HEIGHT : X_HEIGHT) + (low ? DESCENT : 0));
}

/**
 * `perCssPixel` is the number of pixels of the picture in one CSS pixel. `pointed` is set for a box
 * that somebody pointed at instead of one that text recognition found: there are no words to be unsure
 * of, and the size is estimated from the rows the letters are in, as if they were capitals or digits.
 */
export function measureLine(image: PNG, line: Omit<OcrLine, "reading"> & { reading?: Reading }, perCssPixel: number, pointed = false): ImageTextLine {
  const css = (value: number): number => Math.round(value / perCssPixel);
  const sized = (box: Region) => {
    const height = box.height / perCssPixel;
    const fontSizePx = Math.round(pointed ? height / CAP_HEIGHT : estimatedFontSize(line.text, height));
    // Bold text is large from 18.66 pixels and bold cannot be told from the picture; around 24 the estimate itself decides.
    // Without the words it is not known whether the rows hold small letters, capitals or letters with a tail: the size lies between what each of those gives.
    const requiredUncertain = pointed ? height / X_HEIGHT >= 18.66 && height / (CAP_HEIGHT + DESCENT) < 24 : fontSizePx >= 16 && fontSizePx < 28;
    return { text: line.text, box: { x: css(box.x), y: css(box.y), width: css(box.width), height: css(box.height) }, confidence: line.confidence, ...(line.reading ? { reading: line.reading } : {}), fontSizePx, required: requiredRatio(fontSizePx, false), requiredUncertain };
  };
  const unmeasured = (reason: string): ImageTextLine => ({ ...sized(line.box), foreground: null, background: null, ratio: null, bestRatio: null, outcome: "cantTell", reason, uncertain: [] });
  if (!pointed && line.confidence < MIN_CONFIDENCE) return unmeasured(`de tekstherkenning is hier onzeker (${line.confidence} van 100): niet vast te stellen of dit tekst is, en welke`);
  const groups = colourGroups(image, line.box);
  if (groups === "outline") return unmeasured(pointed ? "de rand van het aangewezen kader ligt niet op één achtergrond: het kader loopt door een letter of een ander vlak, of de achtergrond is een foto; wijs een kader aan dat rondom de letters binnen één vlak ligt" : "de rand van het kader ligt niet op één achtergrond: het kader van de tekstherkenning loopt door een letter of een ander vlak, of de achtergrond is een foto");
  if (groups === "colours") return unmeasured(pointed ? "binnen het aangewezen kader zijn geen twee duidelijke kleurgroepen te onderscheiden: er staat geen tekst in, de letters lopen over in de achtergrond, of de achtergrond is een foto" : "binnen het kader zijn geen twee duidelijke kleurgroepen te onderscheiden: de letters lopen over in de achtergrond, of de achtergrond is een foto");
  // The size comes from the height of the box. A box much higher than the letters in it would make small text large, with the lower requirement.
  const inkHeight = groups.ink.bottom - groups.ink.top + 1;
  const tooHigh = inkHeight < MIN_INK_SHARE * line.box.height;
  // A box that was pointed at is as high as whoever drew it made it: only the rows with letters say something about the size.
  const base = sized(tooHigh || pointed ? { ...line.box, y: groups.ink.top, height: inkHeight } : line.box);
  const { required, requiredUncertain } = base;
  const ratios = [groups.text.lightest, groups.text.darkest].flatMap((text) => [groups.background.lightest, groups.background.darkest].map((background) => contrastRatio(text, background)));
  const ratio = floorRatio(Math.min(...ratios));
  const bestRatio = floorRatio(Math.max(...ratios));
  const uncertain: string[] = [];
  if (!groups.background.flat) uncertain.push(`de achtergrond is niet egaal (${hex(groups.background.darkest)} tot ${hex(groups.background.lightest)})`);
  if (pointed) uncertain.push("de lettergrootte is geschat uit de hoogte van wat in het kader afwijkt van de achtergrond, als een hoofdletter of cijfer: de tekst zelf is niet herkend");
  else if (tooHigh) uncertain.push("het kader van de tekstherkenning was hoger dan de letters: de lettergrootte is geschat uit de rijen waarin letters staan");
  if (!groups.text.flat) uncertain.push(`de letters zijn niet egaal van kleur (${hex(groups.text.darkest)} tot ${hex(groups.text.lightest)}); bij dunne letters komt de achtergrond erdoorheen en kan de werkelijke verhouding hoger zijn`);
  const lowest = requiredUncertain ? 3 : required;
  const highest = requiredUncertain ? 4.5 : required;
  const outcome = ratio >= highest ? "passed" : bestRatio < lowest ? "failed" : "cantTell";
  if (requiredUncertain && ratio < 4.5 && bestRatio >= 3) uncertain.push("de lettergrootte ligt rond de grens voor grote tekst en vet is uit het beeld niet af te leiden: de eis is 3 of 4,5");
  return { ...base, foreground: hex(groups.text.colour), background: hex(groups.background.colour), ratio, bestRatio, outcome, reason: null, uncertain };
}

/**
 * Contrast of the text inside a picture: the lines found by text recognition, and for each
 * the colours of letters and background measured on the pixels within its box. The lines of
 * the reading for scattered text (a letter on a tile, a word on a button) are measured the same way.
 * `cssWidth` is the width of the element on the page, to bring sizes back to CSS pixels.
 */
export async function imageTextContrast(imagePath: string, cssWidth: number): Promise<ImageTextAnswer> {
  const { lines, languages, scale } = await ocrLines(imagePath);
  const image = PNG.sync.read(await readFile(imagePath));
  return { lines: lines.map((line) => measureLine(image, line, image.width / cssWidth)), languages, scale };
}

/** What a box that was pointed at measures: the same as a line, without words and without a confidence. */
export interface PointedAnswer {
  /** Who chose the box. Never text recognition: the measurement does not say that there is text in it, or which. */
  pointedBy: "agent";
  box: ImageTextLine;
}

/**
 * Contrast inside a box that was pointed at in a picture, for letters and short labels that text
 * recognition does not find. `box` is in CSS pixels from the top left corner of the element, as
 * the boxes of the lines are; `cssWidth` is the width of the element on the page.
 */
export async function pointedContrast(imagePath: string, cssWidth: number, box: Region): Promise<PointedAnswer> {
  const image = PNG.sync.read(await readFile(imagePath));
  const perCssPixel = image.width / cssWidth;
  const inPicture = { x: box.x * perCssPixel, y: box.y * perCssPixel, width: box.width * perCssPixel, height: box.height * perCssPixel };
  return { pointedBy: "agent", box: measureLine(image, { text: "", confidence: 100, box: inPicture }, perCssPixel, true) };
}

/** Proportions of the file and of the picture on the page further apart than this share: the page crops or stretches it. */
const MAX_PROPORTION_DIFFERENCE = 0.02;
/** A pixel of the picture on the page whose four neighbours lie this close to it (sum over the three channels) is in a flat area, where scaling down changes nothing. */
const FLAT_NEIGHBOURS = 6;
/** In a flat area the file scaled down and the picture on the page differ by more than this in a channel: not the same colour. */
const SHOWN_DIFFERENCE = 4;
/** More than this share of the flat area not the same colour: something lies over the picture, or the page changes its colours. */
const MAX_DIFFERENT_SHARE = 0.01;
/** Fewer flat pixels than this, as in a photo, and there is nothing to compare the file with. */
const MIN_FLAT_PIXELS = 100;

/**
 * The image file of a picture, to measure in its place when the page shows it smaller than the file
 * is: scaled down, a thin letter shares its pixels with the background around it and seems lighter or
 * darker than it is. The file stands for the picture only when it has the same proportions and,
 * scaled down to the size of `shown`, has the colours of `shown` in its flat areas: the edges of
 * letters differ by how the browser scales, a filter, transparency or something on top differs there too.
 * A transparent part of the file gets the colour the page shows there.
 */
export function fileAsShown(file: PNG, shown: PNG): { picture: PNG } | { reasonNl: string } {
  if (Math.abs(file.width / file.height / (shown.width / shown.height) - 1) > MAX_PROPORTION_DIFFERENCE) return { reasonNl: "het beeldbestand heeft andere verhoudingen dan de afbeelding op de pagina: de pagina snijdt het bij of rekt het uit" };
  const across = file.width / shown.width;
  const down = file.height / shown.height;
  const picture = new PNG({ width: file.width, height: file.height });
  const sums = new Float64Array(shown.width * shown.height * 4);
  for (let y = 0; y < file.height; y++) {
    const row = Math.min(shown.height - 1, Math.floor(y / down));
    for (let x = 0; x < file.width; x++) {
      const at = (row * shown.width + Math.min(shown.width - 1, Math.floor(x / across))) * 4;
      const offset = (y * file.width + x) * 4;
      const alpha = file.data[offset + 3]! / 255;
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.round(alpha * file.data[offset + channel]! + (1 - alpha) * shown.data[at + channel]!);
        picture.data[offset + channel] = value;
        sums[at + channel]! += value;
      }
      picture.data[offset + 3] = 255;
      sums[at + 3]! += 1;
    }
  }
  const colour = (x: number, y: number): Rgb => {
    const at = (y * shown.width + x) * 4;
    return [shown.data[at]!, shown.data[at + 1]!, shown.data[at + 2]!];
  };
  let flat = 0;
  let different = 0;
  for (let y = 1; y < shown.height - 1; y++) {
    for (let x = 1; x < shown.width - 1; x++) {
      const own = colour(x, y);
      if ([colour(x - 1, y), colour(x + 1, y), colour(x, y - 1), colour(x, y + 1)].some((other) => distance(own, other) > FLAT_NEIGHBOURS)) continue;
      flat++;
      const at = (y * shown.width + x) * 4;
      if (own.some((value, channel) => Math.abs(sums[at + channel]! / sums[at + 3]! - value) > SHOWN_DIFFERENCE)) different++;
    }
  }
  if (flat < MIN_FLAT_PIXELS) return { reasonNl: "de afbeelding heeft geen egale vlakken om het beeldbestand mee te vergelijken" };
  if (different > MAX_DIFFERENT_SHARE * flat) return { reasonNl: `op ${Math.round((100 * different) / flat)}% van de egale vlakken heeft het beeldbestand een andere kleur dan de afbeelding op de pagina: er ligt iets over, of de pagina verandert de kleuren` };
  return { picture };
}
