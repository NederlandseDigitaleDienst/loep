import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { sha256 } from "./canonical.ts";
import type { Evaluation, ReportFinding } from "./evaluation.ts";

/**
 * A piece of a screenshot that is already in the run. Nothing is measured on the site again: a
 * piece names the picture it came from with its sha256 and the rectangle, so anyone can cut the
 * same piece again. The report shows one at every finding, with the element outlined.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the cutout of a finding comes from, as the evaluation records it. */
export interface FindingCutout {
  /** The picture, relative to the run directory, and its sha256. */
  from: string;
  fromSha256: string;
  /** The rectangle cut out, in pixels of that picture. */
  at: Box;
  /** The element inside the piece: where the outline goes. */
  element: Box;
  /** The page label of the element. */
  page: string;
  /** What gave the bounding box: an observation id, or the facts of the sweep for the page. */
  boxFrom: string;
}

/** Room around the element, in pixels of the picture. */
export const CUTOUT_MARGIN = 24;
/** The largest piece. A taller or wider element is shown from its top left corner. */
export const CUTOUT_MAX = { width: 800, height: 500 } as const;
/** Together the pieces of one report stay under this many bytes, so the PDF stays small enough to send. */
export const CUTOUT_BUDGET_BYTES = 12 * 1024 * 1024;

/** Cut a rectangle out of a picture. The rectangle has to lie inside it. */
export function cutPiece(source: PNG, at: Box): PNG {
  if (at.x < 0 || at.y < 0 || at.width < 1 || at.height < 1 || at.x + at.width > source.width || at.y + at.height > source.height) {
    throw new Error(`het kader ${at.x},${at.y},${at.width},${at.height} valt buiten de schermafbeelding van ${source.width} bij ${source.height} pixels`);
  }
  const piece = new PNG({ width: at.width, height: at.height });
  PNG.bitblt(source, piece, at.x, at.y, at.width, at.height, 0, 0);
  return piece;
}

/** The outline: a dark red band of three pixels with a white pixel on each side, so it shows on a light and on a dark page. */
const OUTLINE: [number, number, number][] = [[255, 255, 255], [178, 0, 32], [178, 0, 32], [178, 0, 32], [255, 255, 255]];

/** Draw a frame just outside the element; what falls outside the piece is left out. */
export function drawOutline(piece: PNG, element: Box): void {
  const paint = (x: number, y: number, [red, green, blue]: [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= piece.width || y >= piece.height) return;
    const at = (y * piece.width + x) * 4;
    piece.data[at] = red;
    piece.data[at + 1] = green;
    piece.data[at + 2] = blue;
    piece.data[at + 3] = 255;
  };
  OUTLINE.forEach((colour, ring) => {
    // Ring 0 is the outermost: it lies five pixels outside the element, the last one right against it.
    const offset = OUTLINE.length - ring;
    const [left, top, right, bottom] = [element.x - offset, element.y - offset, element.x + element.width - 1 + offset, element.y + element.height - 1 + offset];
    for (let x = left; x <= right; x++) {
      paint(x, top, colour);
      paint(x, bottom, colour);
    }
    for (let y = top; y <= bottom; y++) {
      paint(left, y, colour);
      paint(right, y, colour);
    }
  });
}

/** The rectangle around an element: the element with a margin, inside the picture and no larger than the largest piece. */
export function pieceAround(element: Box, picture: { width: number; height: number }): { at: Box; element: Box } | null {
  const box = { x: Math.round(element.x), y: Math.round(element.y), width: Math.round(element.width), height: Math.round(element.height) };
  if (box.width < 1 || box.height < 1 || box.x >= picture.width || box.y >= picture.height || box.x + box.width <= 0 || box.y + box.height <= 0) return null;
  const x = Math.max(0, box.x - CUTOUT_MARGIN);
  const y = Math.max(0, box.y - CUTOUT_MARGIN);
  const width = Math.min(picture.width, box.x + box.width + CUTOUT_MARGIN, x + CUTOUT_MAX.width) - x;
  const height = Math.min(picture.height, box.y + box.height + CUTOUT_MARGIN, y + CUTOUT_MAX.height) - y;
  if (width < 1 || height < 1) return null;
  return { at: { x, y, width, height }, element: { x: box.x - x, y: box.y - y, width: box.width, height: box.height } };
}

// ---------------------------------------------------------------- where a finding's picture comes from

/** What `findingCutout` reads of an observation record. */
interface RecordLike {
  id?: string;
  command?: string;
  error?: string | null;
  target?: { path?: string[] } | null;
  page?: { url?: string; scheme?: string; viewport?: { width: number; height: number } } | null;
  state?: { id?: string; steps?: unknown[] } | null;
  options?: Record<string, unknown>;
  result?: unknown;
  images?: { path: string; sha256: string }[];
}

export interface CutoutContext {
  runDir: string;
  records: Map<string, unknown>;
  /** The pages of the sample: label, address and the directory of the sweep, relative to the run. */
  pages: { label: string; url: string; dir: string }[];
}

const samePath = (a: string[] | undefined, b: string[] | undefined): boolean => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((piece, index) => piece === b[index]);
const isBox = (value: unknown): value is Box => typeof value === "object" && value !== null && ["x", "y", "width", "height"].every((key) => typeof (value as Record<string, unknown>)[key] === "number");

/** Element lists of the facts of the sweep: every one has a path and a box in pixels of the whole page. */
const FACT_LISTS = ["headings", "landmarks", "images", "backgroundImages", "links", "controls", "clickables", "langParts", "iframes", "tables"];

function pictureSize(path: string): { width: number; height: number } | null {
  try {
    const bytes = readFileSync(path);
    // The width and height stand in the header of a PNG; the rest need not be read.
    if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** `width`: the width the picture must have for the box to be in its pixels; a picture made at another scale is passed over. */
function fromPicture(runDir: string, relative: string, element: Box, page: string, boxFrom: string, width?: number): FindingCutout | null {
  const absolute = join(runDir, relative);
  if (!existsSync(absolute)) return null;
  const size = pictureSize(absolute);
  if (!size || (width !== undefined && size.width !== width)) return null;
  const piece = pieceAround(element, size);
  if (!piece) return null;
  return { from: relative, fromSha256: sha256(readFileSync(absolute)), at: piece.at, element: piece.element, page, boxFrom };
}

/**
 * The picture and bounding box for the cutout of a finding, or null when there is none. Read
 * from what the run recorded, in this order, for the elements the observations it cites name:
 *
 * 1. a `look --plain` among its observations, made in the same state on the same page, that
 *    lists the element with its box in the pixels of its picture;
 * 2. a `crop` of the element, which records where the element lies in the piece it made;
 * 3. the screenshot of the sweep, for an element in the state the page opens in, seen in the
 *    light scheme at the width of that screenshot, with the box from the facts of the sweep;
 * 4. a `look` with numbers drawn on it, as 1.
 *
 * Without such a picture and box there is no cutout; nothing is guessed.
 */
export function findingCutout(finding: Pick<ReportFinding, "evidence">, context: CutoutContext): FindingCutout | null {
  const records = finding.evidence.map((id) => context.records.get(id) as RecordLike | undefined).filter((record): record is RecordLike => record !== undefined && !record.error);
  const targets = records.filter((record) => record.target?.path?.length && record.page?.url);
  const labelOf = (url: string | undefined): string | null => context.pages.find((page) => page.url === url)?.label ?? null;
  const looks = records.filter((record) => record.command === "look" && record.images?.length);

  const fromLook = (plain: boolean): FindingCutout | null => {
    for (const target of targets) {
      for (const look of looks) {
        if (Boolean(look.options?.plain) !== plain || look.page?.url !== target.page!.url || look.state?.id !== target.state?.id) continue;
        const items = (look.result as { items?: { path?: string[]; box?: unknown }[] } | null)?.items ?? [];
        const item = items.find((entry) => samePath(entry.path, target.target!.path) && isBox(entry.box));
        const label = labelOf(target.page!.url);
        if (!item || !label) continue;
        // The boxes of a look are in CSS pixels: only a picture made at scale 1 has them in its own pixels.
        const cut = fromPicture(context.runDir, look.images![0]!.path, item.box as Box, label, look.id ?? "", look.page?.viewport?.width);
        if (cut) return cut;
      }
    }
    return null;
  };
  const fromCrop = (): FindingCutout | null => {
    for (const target of targets) {
      const inImage = (target.result as { inImage?: unknown } | null)?.inImage;
      const label = labelOf(target.page!.url);
      if (target.command !== "crop" || !isBox(inImage) || !target.images?.length || !label) continue;
      const cut = fromPicture(context.runDir, target.images[0]!.path, inImage, label, target.id ?? "");
      if (cut) return cut;
    }
    return null;
  };
  const fromSweep = (): FindingCutout | null => {
    for (const target of targets) {
      const page = context.pages.find((entry) => entry.url === target.page!.url);
      if (!page || (target.state?.steps?.length ?? 0) > 0 || target.page!.scheme !== "light") continue;
      const screenshot = join(page.dir, "screenshot-light.png");
      if (target.page!.viewport?.width === undefined) continue;
      let facts: Record<string, unknown>;
      try {
        facts = JSON.parse(readFileSync(join(context.runDir, page.dir, "facts.json"), "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      const element = FACT_LISTS.flatMap((list) => (Array.isArray(facts[list]) ? (facts[list] as { path?: string[]; box?: unknown; visible?: boolean }[]) : [])).find((entry) => samePath(entry.path, target.target!.path) && entry.visible !== false && isBox(entry.box));
      if (!element) continue;
      const cut = fromPicture(context.runDir, screenshot, element.box as Box, page.label, join(page.dir, "facts.json"), target.page!.viewport.width);
      if (cut) return cut;
    }
    return null;
  };
  return fromLook(true) ?? fromCrop() ?? fromSweep() ?? fromLook(false);
}

// ---------------------------------------------------------------- the pieces of a report

export interface CutoutFile {
  /** The file name inside the directory of the pieces. */
  file: string;
  absolute: string;
  width: number;
  height: number;
  altNl: string;
}

/**
 * Cut the pieces for every finding that has a cutout, outline the element and write them to
 * `dir`. A piece whose picture is gone or changed since the evaluation is left out with a
 * problem, and so is every piece past the budget: the report then shows no piece there, as for
 * a finding without one. Findings with the same piece share one file.
 */
export async function writeCutouts(runDir: string, evaluation: Evaluation, dir: string, budget = CUTOUT_BUDGET_BYTES): Promise<{ files: Record<string, CutoutFile>; problems: string[] }> {
  const files: Record<string, CutoutFile> = {};
  const problems: string[] = [];
  const made = new Map<string, CutoutFile>();
  const pictures = new Map<string, PNG | null>();
  let spent = 0;
  let overBudget = 0;
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings).filter((finding) => finding.cutout);
  if (findings.length > 0) await mkdir(dir, { recursive: true });
  for (const finding of findings) {
    const cutout = finding.cutout!;
    const key = sha256(JSON.stringify([cutout.fromSha256, cutout.at, cutout.element]));
    const altNl = `Uitsnede van ${cutout.page}: het element van de bevinding, rood omlijnd.`;
    const known = made.get(key);
    if (known) {
      files[finding.id] = known;
      continue;
    }
    if (!pictures.has(cutout.from)) {
      const path = join(runDir, cutout.from);
      const bytes = existsSync(path) ? readFileSync(path) : null;
      pictures.set(cutout.from, bytes && sha256(bytes) === cutout.fromSha256 ? PNG.sync.read(bytes) : null);
    }
    const picture = pictures.get(cutout.from);
    if (!picture) {
      problems.push(`Uitsnede bij ${finding.id} weggelaten: ${cutout.from} ontbreekt of is veranderd sinds de evaluatie.`);
      continue;
    }
    let piece: PNG;
    try {
      piece = cutPiece(picture, cutout.at);
    } catch (error) {
      problems.push(`Uitsnede bij ${finding.id} weggelaten: ${(error as Error).message}.`);
      continue;
    }
    drawOutline(piece, cutout.element);
    const bytes = PNG.sync.write(piece, { deflateLevel: 9 });
    if (spent + bytes.length > budget) {
      overBudget++;
      continue;
    }
    spent += bytes.length;
    const file = `${key.slice(0, 16)}.png`;
    const entry = { file, absolute: resolve(dir, file), width: piece.width, height: piece.height, altNl };
    await writeFile(entry.absolute, bytes);
    made.set(key, entry);
    files[finding.id] = entry;
  }
  if (overBudget > 0) problems.push(`${overBudget} uitsneden weggelaten: samen zouden ze groter worden dan ${Math.round(budget / 1024 / 1024)} MB, de grens voor één rapport.`);
  return { files, problems };
}
