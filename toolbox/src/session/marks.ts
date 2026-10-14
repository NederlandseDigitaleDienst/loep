import { PNG } from "pngjs";

export interface Mark {
  label: string;
  box: { x: number; y: number; width: number; height: number };
  colour: [number, number, number];
  /** Line width of the frame around the element. */
  frame: number;
}

// Digits as 5 by 7 bitmaps, one string per row. Drawn by hand so that marking a
// screenshot never touches the page: an overlay in the DOM would change what is measured.
const DIGITS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
const SCALE = 2;
const PADDING = 2;
const CHIP_HEIGHT = 7 * SCALE + 2 * PADDING;
const chipWidth = (label: string): number => label.length * 6 * SCALE - SCALE + 2 * PADDING;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function fill(image: PNG, rect: Rect, colour: [number, number, number]): void {
  for (let y = Math.max(0, rect.y); y < Math.min(image.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(image.width, rect.x + rect.width); x++) {
      image.data.set([...colour, 255], (y * image.width + x) * 4);
    }
  }
}

/** How much of what is painted in a part of the picture is not its background: the pixels that differ clearly from the most common colour there. */
function ink(data: Buffer, imageWidth: number, imageHeight: number, rect: Rect): number {
  const counts = new Map<number, number>();
  const colours: number[] = [];
  for (let y = Math.max(0, rect.y); y < Math.min(imageHeight, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(imageWidth, rect.x + rect.width); x++) {
      const at = (y * imageWidth + x) * 4;
      // Coarse steps: anti-aliasing must not make one background look like many colours.
      const colour = ((data[at]! >> 4) << 8) | ((data[at + 1]! >> 4) << 4) | (data[at + 2]! >> 4);
      colours.push(colour);
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  let common = 0;
  let most = 0;
  for (const [colour, count] of counts) if (count > most) [common, most] = [colour, count];
  const far = (colour: number): boolean => Math.abs((colour >> 8) - (common >> 8)) + Math.abs(((colour >> 4) & 15) - ((common >> 4) & 15)) + Math.abs((colour & 15) - (common & 15)) > 3;
  return colours.filter(far).length;
}

/**
 * Draw a frame and a numbered chip for every mark. A chip goes next to its element, on the
 * spot where it hides the least: not another chip, not another marked element, and as little
 * text or picture as possible. Only when there is no room outside does it go inside the element.
 */
export function drawMarks(image: PNG, marks: Mark[]): void {
  const placed: Rect[] = [];
  // What the page looked like before anything was drawn on it: that decides where a chip hides nothing.
  const original = Buffer.from(image.data);
  for (const mark of marks) {
    const { x, y, width, height } = mark.box;
    const line = mark.frame;
    fill(image, { x, y, width, height: line }, mark.colour);
    fill(image, { x, y: y + height - line, width, height: line }, mark.colour);
    fill(image, { x, y, width: line, height }, mark.colour);
    fill(image, { x: x + width - line, y, width: line, height }, mark.colour);
  }
  for (const mark of marks) {
    const { x, y, width, height } = mark.box;
    const chip = { width: chipWidth(mark.label), height: CHIP_HEIGHT };
    const middle = y + Math.round((height - chip.height) / 2);
    const candidates: Rect[] = [
      { x, y: y - chip.height, ...chip },
      { x: x - chip.width, y, ...chip },
      { x: x - chip.width, y: middle, ...chip },
      { x: x + width, y: middle, ...chip },
      { x: x + width - chip.width, y: y - chip.height, ...chip },
      { x: x + width, y, ...chip },
      { x, y: y + height, ...chip },
      { x: x + width - chip.width, y: y + height, ...chip },
      { x, y, ...chip },
    ].map((rect) => ({ ...rect, x: Math.max(0, Math.min(image.width - chip.width, rect.x)), y: Math.max(0, Math.min(image.height - chip.height, rect.y)) }));
    // The cost of a spot: another chip there rules it out, another marked element or the element itself weighs heavily, and every pixel of text or picture under it counts.
    const cost = (rect: Rect): number =>
      (placed.some((other) => overlaps(rect, other)) ? 1_000_000 : 0) + (marks.some((other) => other !== mark && overlaps(rect, other.box)) ? 2000 : 0) + (overlaps(rect, mark.box) ? 1000 : 0) + ink(original, image.width, image.height, rect);
    let spot = candidates[0]!;
    let lowest = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const own = cost(candidate);
      if (own < lowest) [spot, lowest] = [candidate, own];
    }
    placed.push(spot);
    fill(image, spot, mark.colour);
    for (const [index, digit] of [...mark.label].entries()) {
      const rows = DIGITS[digit];
      if (!rows) continue;
      for (const [row, bits] of rows.entries()) {
        for (const [column, bit] of [...bits].entries()) {
          if (bit === "1") fill(image, { x: spot.x + PADDING + index * 6 * SCALE + column * SCALE, y: spot.y + PADDING + row * SCALE, width: SCALE, height: SCALE }, [255, 255, 255]);
        }
      }
    }
  }
}

export const MARK_COLOURS: Record<string, [number, number, number]> = {
  control: [196, 0, 143],
  clickable: [180, 83, 9],
  heading: [29, 78, 216],
  image: [4, 120, 87],
  frame: [4, 120, 87],
  dialog: [55, 65, 81],
  table: [55, 65, 81],
};
