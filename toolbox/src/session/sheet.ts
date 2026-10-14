import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { UsageError, type Outcome } from "./commands.ts";
import { drawMarks, type Mark } from "./marks.ts";
import { readObservation, type Images } from "./observations.ts";

const SHEET_WIDTH = 1280;
const GAP = 10;
/** Room above each picture for its number. */
const LABEL_ROOM = 20;
const MAX_CELL = { width: 420, height: 220 };
const MAX_CELLS = 150;
const LABEL_COLOUR: [number, number, number] = [196, 0, 143];

interface Cell {
  label: string;
  says: string;
  picture: PNG;
}

/** A picture cut down to what fits in a cell; the top left corner is kept, where the element and its indicator start. */
function fitted(picture: PNG): PNG {
  const width = Math.min(picture.width, MAX_CELL.width);
  const height = Math.min(picture.height, MAX_CELL.height);
  if (width === picture.width && height === picture.height) return picture;
  const out = new PNG({ width, height });
  PNG.bitblt(picture, out, 0, 0, width, height, 0, 0);
  return out;
}

/**
 * Lay the pictures of one or more observations out on one sheet, each with a number, so that
 * forty pictures of a focus indicator are one look instead of forty. For a walk with Tab the
 * number is the number of the stop.
 */
export async function sheetOutcome(runDir: string, ids: string[], images: Images): Promise<Outcome> {
  if (ids.length === 0) throw new UsageError("sheet verwacht het nummer van een of meer waarnemingen met beelden, bijvoorbeeld: sheet main-0012");
  const cells: Cell[] = [];
  for (const id of ids) {
    const observation = await readObservation(runDir, id).catch((error: Error) => {
      throw new UsageError(error.message);
    });
    const stops = ((observation.result as { methods?: { result?: { stops?: { ref?: number | null; tag?: string; text?: string; focusScreenshot?: string }[] } }[] } | null)?.methods?.[0]?.result?.stops ?? []).filter((stop) => typeof stop.focusScreenshot === "string");
    if (stops.length > 0) {
      // A walk: one picture per stop, numbered as the stops are.
      for (const stop of stops) {
        const path = join(runDir, stop.focusScreenshot!);
        if (!existsSync(path)) continue;
        const number = Number(/(\d+)\.png$/.exec(stop.focusScreenshot!)?.[1] ?? cells.length + 1);
        cells.push({ label: String(number), says: `${number}: ${ids.length > 1 ? `${id} ` : ""}ref ${stop.ref ?? "?"} ${stop.tag ?? ""} ${(stop.text ?? "").slice(0, 30)}`.trim(), picture: fitted(PNG.sync.read(await readFile(path))) });
      }
      continue;
    }
    for (const image of observation.images.filter((entry) => entry.path.endsWith(".png"))) {
      const number = cells.length + 1;
      cells.push({ label: String(number), says: `${number}: ${id} ${observation.command}${observation.target ? ` ref ${observation.target.ref} ${observation.target.tag} ${observation.target.text.slice(0, 30)}` : ""}${image.path.includes("unfocused") ? " (zonder focus)" : ""}`, picture: fitted(PNG.sync.read(await readFile(join(runDir, image.path)))) });
    }
  }
  if (cells.length === 0) throw new UsageError(`geen beelden bij ${ids.join(", ")}`);
  const shown = cells.slice(0, MAX_CELLS);
  // Rows are filled from left to right; a row is as high as its highest picture.
  const placed: { cell: Cell; x: number; y: number }[] = [];
  let x = GAP;
  let y = GAP;
  let rowHeight = 0;
  for (const cell of shown) {
    if (x + cell.picture.width + GAP > SHEET_WIDTH && x > GAP) {
      x = GAP;
      y += rowHeight + LABEL_ROOM + GAP;
      rowHeight = 0;
    }
    placed.push({ cell, x, y: y + LABEL_ROOM });
    x += Math.max(cell.picture.width, 40) + GAP;
    rowHeight = Math.max(rowHeight, cell.picture.height);
  }
  const sheet = new PNG({ width: SHEET_WIDTH, height: y + rowHeight + LABEL_ROOM + GAP });
  sheet.data.fill(238);
  for (let at = 3; at < sheet.data.length; at += 4) sheet.data[at] = 255;
  for (const { cell, x: left, y: top } of placed) PNG.bitblt(cell.picture, sheet, 0, 0, cell.picture.width, cell.picture.height, left, top);
  const marks: Mark[] = placed.map(({ cell, x: left, y: top }) => ({ label: cell.label, box: { x: left, y: top, width: cell.picture.width, height: cell.picture.height }, colour: LABEL_COLOUR, frame: 0 }));
  drawMarks(sheet, marks);
  const path = images.image();
  await writeFile(path, PNG.sync.write(sheet));
  return {
    result: { observations: ids, cells: shown.map((cell) => cell.says), size: { width: sheet.width, height: sheet.height }, notShown: cells.length - shown.length },
    print: { image: images.relative(path), size: `${sheet.width}x${sheet.height}`, pictures: shown.map((cell) => cell.says), ...(cells.length > shown.length ? { notShown: cells.length - shown.length } : {}) },
  };
}
