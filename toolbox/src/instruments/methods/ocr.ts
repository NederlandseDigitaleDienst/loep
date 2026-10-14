import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { binary, binaryCommand, Unavailable } from "./registry.ts";

const run = promisify(execFile);

export interface OcrAnswer {
  /** Whether the picture holds text a person would read: at least two words recognised with confidence. */
  hasText: boolean;
  text: string;
  words: number;
  /** Mean confidence of the words kept, from 0 to 100. */
  confidence: number | null;
  languages: string;
  /** The picture was enlarged before recognition; small text is otherwise not read. */
  scale: number;
  /** How many of the words only the reading for scattered text found; absent when that reading was not asked for. */
  sparseWords?: number;
}

/** A word counts when Tesseract is at least this sure of it. */
export const MIN_CONFIDENCE = 60;
const WORD = /[\p{L}\p{N}]{2,}|^\p{N}$/u;
/** Pictures lower than this are enlarged: at screen size the letters are too small for recognition. */
const ENLARGE_BELOW = 200;

/** Enlarge a picture by a whole factor, with the values between pixels interpolated. */
export function enlarge(source: PNG, factor: number): PNG {
  const out = new PNG({ width: source.width * factor, height: source.height * factor });
  for (let y = 0; y < out.height; y++) {
    const sy = Math.min(source.height - 1, y / factor);
    const y0 = Math.floor(sy);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(source.width - 1, x / factor);
      const x0 = Math.floor(sx);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let channel = 0; channel < 4; channel++) {
        const at = (px: number, py: number): number => source.data[(py * source.width + px) * 4 + channel]!;
        const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
        const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
        out.data[(y * out.width + x) * 4 + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

/** A surface holds a square of this many pixels in one colour: wider than the stroke of a letter, narrower than a button or a tile. */
const SURFACE_SQUARE = 9;
/** Colours this close together (sum over the three channels) are one surface. */
const SURFACE_TOLERANCE = 24;
/** How far from a pixel the surface around its letter is looked for. */
const SURFACE_REACH = 40;

/**
 * The same picture with every surface made white and what stands on a surface made black.
 * A surface is a part of one colour that holds a whole square; it is followed from there into
 * the narrow room between letters. What is left is thinner than that square: letters, lines,
 * the edge of a letter. Recognition makes one black and white version of a picture, and a white
 * letter on a coloured tile then ends up as a hole in a dark block, which it does not read.
 * Here the letter is dark on white whatever the colours were.
 */
export function levelled(source: PNG): PNG {
  const { width, height, data } = source;
  const count = width * height;
  const size = SURFACE_SQUARE;
  // Per pixel: the largest difference in one channel within the square that has this pixel as its top left corner.
  const spread = new Uint8Array(count);
  for (let channel = 0; channel < 3; channel++) {
    const lowest = new Uint8Array(count);
    const highest = new Uint8Array(count);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let low = 255;
        let high = 0;
        for (let step = x; step < Math.min(width, x + size); step++) {
          const value = data[(y * width + step) * 4 + channel]!;
          if (value < low) low = value;
          if (value > high) high = value;
        }
        lowest[y * width + x] = low;
        highest[y * width + x] = high;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let low = 255;
        let high = 0;
        for (let step = y; step < Math.min(height, y + size); step++) {
          if (lowest[step * width + x]! < low) low = lowest[step * width + x]!;
          if (highest[step * width + x]! > high) high = highest[step * width + x]!;
        }
        if (high - low > spread[y * width + x]!) spread[y * width + x] = high - low;
      }
    }
  }
  const colourAt = (index: number): number => (data[index * 4]! << 16) | (data[index * 4 + 1]! << 8) | data[index * 4 + 2]!;
  const apart = (first: number, second: number): number => Math.abs((first >> 16) - (second >> 16)) + Math.abs(((first >> 8) & 255) - ((second >> 8) & 255)) + Math.abs((first & 255) - (second & 255));
  // The colour of the surface a pixel belongs to; -1 for a pixel on no surface.
  const surface = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let queued = 0;
  for (let y = 0; y + size <= height; y++) {
    for (let x = 0; x + size <= width; x++) {
      if (spread[y * width + x]! * 3 > SURFACE_TOLERANCE) continue;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const index = (y + dy) * width + x + dx;
          if (surface[index] !== -1) continue;
          surface[index] = colourAt(index);
          queue[queued++] = index;
        }
      }
    }
  }
  for (let next = 0; next < queued; next++) {
    const index = queue[next]!;
    const x = index % width;
    for (const neighbour of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
      if (neighbour < 0 || neighbour >= count || surface[neighbour] !== -1) continue;
      if (apart(colourAt(neighbour), surface[index]!) > SURFACE_TOLERANCE) continue;
      surface[neighbour] = surface[index]!;
      queue[queued++] = neighbour;
    }
  }
  // The inside of an o is cut off from the surface around the letter. Seen from there, the first surface in any direction is that one, and it has the same colour.
  const enclosed: number[] = [];
  for (let index = 0; index < count; index++) {
    if (surface[index] !== -1) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      let found = -1;
      for (let step = 1, nx = x + dx, ny = y + dy; step <= SURFACE_REACH && nx >= 0 && nx < width && ny >= 0 && ny < height; step++, nx += dx, ny += dy) {
        if (surface[ny * width + nx] === -1) continue;
        found = surface[ny * width + nx]!;
        break;
      }
      if (found === -1 || apart(colourAt(index), found) > SURFACE_TOLERANCE) continue;
      enclosed.push(index, found);
      break;
    }
  }
  for (let entry = 0; entry < enclosed.length; entry += 2) surface[enclosed[entry]!] = enclosed[entry + 1]!;
  const out = new PNG({ width, height });
  out.data.fill(255);
  /** What lies within this many pixels of a place and on no surface, or the surface next to it. */
  const around = (x: number, y: number, reach: number, each: (index: number) => void): void => {
    for (let ny = Math.max(0, y - reach); ny <= Math.min(height - 1, y + reach); ny++) for (let nx = Math.max(0, x - reach); nx <= Math.min(width - 1, x + reach); nx++) each(ny * width + nx);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (surface[index] !== -1) continue;
      // A pixel beside a surface is the edge of a letter, where both colours are mixed: as dark as it is far from the surface, set against the middle of the letter.
      let beside = -1;
      around(x, y, 1, (other) => {
        if (beside === -1 && surface[other] !== -1) beside = surface[other]!;
      });
      let grey = 0;
      if (beside !== -1) {
        let most = 1;
        around(x, y, 2, (other) => {
          if (surface[other] === -1) most = Math.max(most, apart(colourAt(other), beside));
        });
        grey = 255 - Math.round((255 * apart(colourAt(index), beside)) / most);
      }
      out.data[index * 4] = out.data[index * 4 + 1] = out.data[index * 4 + 2] = grey;
    }
  }
  return out;
}

const OCR_LIMIT_MS = 30_000;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Word {
  text: string;
  confidence: number;
  /** Block, paragraph and line of Tesseract: words with the same key are one line. */
  line: string;
  /** In pixels of the picture as it was given, not of the enlarged one. */
  box: Box;
}

/** One run of Tesseract: its page mode, extra arguments, and whether it reads the picture with its surfaces levelled. */
interface Pass {
  psm: "6" | "11";
  extra?: string[];
  levelled?: boolean;
}

/** Lines of text under each other, as in a block: what Tesseract is run with first. */
const BLOCK: Pass = { psm: "6" };
/**
 * Scattered text: single words and letters on coloured surfaces. Measured on the pictures of the test site: page mode 11
 * and 12 find the same words, 12 takes a quarter longer, and neither finds a letter on a tile until the surfaces are levelled.
 */
const SPARSE: Pass = { psm: "11", levelled: true };

/** Run Tesseract over a picture and return every word it reports, whatever its confidence. One run for each pass. */
async function recognise(imagePath: string, passes: Pass[] = [BLOCK]): Promise<{ words: Word[][]; languages: string; scale: number }> {
  const tesseract = await binary("tesseract");
  if (!tesseract.available) throw new Unavailable(tesseract.hint ?? "Tesseract ontbreekt");
  const picture = PNG.sync.read(await readFile(imagePath));
  const scale = picture.height < ENLARGE_BELOW ? 2 : 1;
  let input = imagePath;
  if (scale > 1) {
    input = imagePath.replace(/\.png$/, "-enlarged.png");
    await writeFile(input, PNG.sync.write(enlarge(picture, scale)));
  }
  let flat: string | null = null;
  if (passes.some((pass) => pass.levelled)) {
    flat = imagePath.replace(/\.png$/, "-levelled.png");
    const surfaces = levelled(picture);
    await writeFile(flat, PNG.sync.write(scale > 1 ? enlarge(surfaces, scale) : surfaces));
  }
  const languages = tesseract.languages ?? "eng";
  const words = await Promise.all(
    passes.map(async (pass) => {
      const { stdout } = await run(binaryCommand("tesseract"), [pass.levelled ? flat! : input, "-", "-l", languages, "--psm", pass.psm, ...(pass.extra ?? []), "tsv"], { timeout: OCR_LIMIT_MS, maxBuffer: 16 * 1024 * 1024 });
      const found: Word[] = [];
      for (const row of stdout.split("\n").slice(1)) {
        const cells = row.split("\t");
        // Level 5 is a word; columns 7 to 10 are its box, the last two are confidence and text.
        if (cells[0] !== "5") continue;
        const [left, top, width, height] = cells.slice(6, 10).map((cell) => Number(cell) / scale) as [number, number, number, number];
        found.push({ text: (cells[11] ?? "").trim(), confidence: Number(cells[10]), line: cells.slice(2, 5).join("."), box: { x: left, y: top, width, height } });
      }
      return found;
    }),
  );
  return { words, languages, scale };
}

/** In the reading for scattered text one letter is a word too: a letter on a button, a step of a scale. */
const SPARSE_WORD = /[\p{L}\p{N}]/u;

/**
 * Read the text in a picture with Tesseract. Needs the binary; without it the method is unavailable.
 * With `sparse` a second reading looks for scattered words and letters, and adds the ones the first did not find.
 */
export async function ocr(imagePath: string, options: { sparse?: boolean } = {}): Promise<OcrAnswer> {
  const { words, languages, scale } = await recognise(imagePath, options.sparse ? [BLOCK, SPARSE] : [BLOCK]);
  const kept = words[0]!.filter((word) => word.confidence >= MIN_CONFIDENCE && WORD.test(word.text));
  const added = (words[1] ?? []).filter((word) => word.confidence >= MIN_CONFIDENCE && SPARSE_WORD.test(word.text) && !words[0]!.some((other) => overlapShare(other.box, word.box) > 0.5));
  const all = [...kept, ...added];
  const text = all.map((word) => word.text).join(" ");
  return { hasText: all.length >= 2, text: text.slice(0, 400), words: all.length, confidence: all.length > 0 ? Math.round(all.reduce((sum, word) => sum + word.confidence, 0) / all.length) : null, languages, scale, ...(options.sparse ? { sparseWords: added.length } : {}) };
}

export interface OcrLine {
  text: string;
  /** Mean confidence of the words of the line, from 0 to 100. */
  confidence: number;
  /** The box around the words, in pixels of the picture. */
  box: Box;
  /** Which reading found the line: the one for lines in a block, or the one for scattered words and letters. */
  reading: Reading;
}

export type Reading = "block" | "sparse";

/** A line whose words are on average less sure than this is noise of the recognition, not text somebody could mean. */
const NOISE_BELOW = 30;

function overlapShare(first: Box, second: Box): number {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return width <= 0 || height <= 0 ? 0 : (width * height) / Math.min(first.width * first.height, second.width * second.height);
}

/** A word more than this many times as high as the lowest word of its line has a box that holds more than the word. */
const TOO_HIGH = 2;

/**
 * One line from the words Tesseract reports for it. The pass with a threshold per part of the
 * picture gives some words a box that is too high, reaching to an edge in the picture below or
 * above the line, and reports some of them a second time with the box of the word itself. Which
 * words get which differs between versions of Tesseract, so the line is built to come out the same:
 * a word reported twice is the lower box, and the height of the line is that of its lower words.
 */
export function lineOf(words: Word[], reading: Reading = "block"): OcrLine {
  const parts: Word[] = [];
  for (const word of words) {
    const same = parts.findIndex((other) => overlapShare(other.box, word.box) > 0.5);
    if (same < 0) {
      parts.push(word);
      continue;
    }
    const [lower, higher] = word.box.height < parts[same]!.box.height ? [word, parts[same]!] : [parts[same]!, word];
    // The lower box sometimes misses the last letter of the word: the higher one then has the text and the width.
    const longer = higher.text.length > lower.text.length && higher.text.includes(lower.text);
    const left = longer ? Math.min(lower.box.x, higher.box.x) : lower.box.x;
    const right = longer ? Math.max(lower.box.x + lower.box.width, higher.box.x + higher.box.width) : lower.box.x + lower.box.width;
    parts[same] = { ...(longer ? higher : lower), box: { x: left, y: lower.box.y, width: right - left, height: lower.box.height } };
  }
  const confidence = Math.round(parts.reduce((sum, word) => sum + word.confidence, 0) / parts.length);
  const lowest = Math.min(...parts.map((word) => word.box.height));
  const level = parts.filter((word) => word.box.height <= TOO_HIGH * lowest);
  const left = Math.min(...parts.map((word) => word.box.x));
  const top = Math.min(...level.map((word) => word.box.y));
  return { text: parts.map((word) => word.text).join(" "), confidence, box: { x: left, y: top, width: Math.max(...parts.map((word) => word.box.x + word.box.width)) - left, height: Math.max(...level.map((word) => word.box.y + word.box.height)) - top }, reading };
}

/** Words of one line further apart than this many times their height are not one piece of text: letters on tiles next to each other. */
const SPARSE_GAP = 1.5;

/** The words of one line of the reading for scattered text, cut where the room between two words is wide. */
export function sparsePieces(words: Word[]): Word[][] {
  const pieces: Word[][] = [];
  for (const word of [...words].sort((a, b) => a.box.x - b.box.x)) {
    const piece = pieces.at(-1);
    const last = piece?.at(-1);
    if (piece && last && word.box.x - (last.box.x + last.box.width) <= SPARSE_GAP * Math.max(last.box.height, word.box.height)) piece.push(word);
    else pieces.push([word]);
  }
  return pieces;
}

/**
 * The lines of text in a picture, each with its box. Tesseract looks for lines on a black and
 * white version of the picture, made with one threshold for the whole picture; text with little
 * contrast falls on the wrong side of it and is not found. A second pass with a threshold per
 * part of the picture finds that text. A line both passes found is kept once, as the surer one.
 *
 * Both look for lines in a block. A third reading looks for scattered text, on the picture with
 * its surfaces levelled: single words and letters on buttons, cards and the steps of a scale. It
 * adds only what the first two did not find and what it is sure of, so it brings no noise of its own.
 */
export async function ocrLines(imagePath: string): Promise<{ lines: OcrLine[]; languages: string; scale: number }> {
  const { words, languages, scale } = await recognise(imagePath, [BLOCK, { ...BLOCK, extra: ["-c", "thresholding_method=1"] }, SPARSE]);
  return { lines: mergeReadings(words.slice(0, 2), words[2]!), languages, scale };
}

/** The lines of the readings for a block, and after them what only the reading for scattered text found. */
export function mergeReadings(block: Word[][], sparse: Word[]): OcrLine[] {
  const lines: OcrLine[] = [];
  const perLine = (words: Word[], pattern: RegExp): Word[][] => {
    const byLine = new Map<string, Word[]>();
    for (const word of words) if (pattern.test(word.text)) byLine.set(word.line, [...(byLine.get(word.line) ?? []), word]);
    return [...byLine.values()];
  };
  for (const pass of block) {
    for (const all of perLine(pass, WORD)) {
      const line = lineOf(all);
      if (line.confidence < NOISE_BELOW) continue;
      const same = lines.findIndex((other) => overlapShare(other.box, line.box) > 0.5);
      if (same < 0) lines.push(line);
      else if (line.confidence > lines[same]!.confidence) lines[same] = line;
    }
  }
  const found = [...lines];
  for (const all of perLine(sparse, SPARSE_WORD)) {
    for (const piece of sparsePieces(all)) {
      const line = lineOf(piece, "sparse");
      if (line.confidence < MIN_CONFIDENCE || found.some((other) => overlapShare(other.box, line.box) > 0)) continue;
      lines.push(line);
    }
  }
  return lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The share of the words read from the picture that are also in the text alternative. */
export function overlap(read: string, alternative: string): number | null {
  const inPicture = tokens(read);
  if (inPicture.length === 0) return null;
  const inAlternative = new Set(tokens(alternative));
  return Math.round((inPicture.filter((token) => inAlternative.has(token)).length / inPicture.length) * 100) / 100;
}
