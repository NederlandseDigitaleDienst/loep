import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { collapseWithoutStops, tile } from "../src/commands/gate.ts";

const STOP: [number, number, number] = [196, 0, 143];

/** A white picture as wide as the wide screen of a sweep, with a frame in the colour of a Tab stop at each given height. */
function picture(height: number, stopsAt: number[]): PNG {
  const png = new PNG({ width: 1280, height });
  png.data.fill(255);
  for (const top of stopsAt) for (let y = top; y < top + 20; y++) for (let x = 10; x < 300; x++) png.data.set([...STOP, 255], (y * 1280 + x) * 4);
  return png;
}

const rowsWithStop = (png: PNG): number => {
  let count = 0;
  for (let y = 0; y < png.height; y++) if ([...Array(png.width).keys()].some((x) => png.data[(y * png.width + x) * 4 + 1] === 0)) count++;
  return count;
};

test("a long page with a stretch without stops keeps every stop in its tile (#507)", () => {
  const long = picture(9755, [50, 150, 250, 350, 7300, 7400, 9000]);
  const scale = 1280 / 480;
  assert.ok(long.height / scale > 1100, "without folding, the tile cuts this picture after the first stops");
  const folded = collapseWithoutStops(long);
  assert.ok(folded.height / scale <= 1100, `folded to ${folded.height} pixels, within one tile`);
  assert.equal(tile(folded).height, Math.round(folded.height / scale), "the tile takes all of it");
  assert.equal(rowsWithStop(folded), rowsWithStop(long), "every row with a stop is still there");
});

test("a picture with its stops close together, or without any, stays as it is", () => {
  const short = picture(600, [50, 300, 550]);
  assert.equal(collapseWithoutStops(short), short);
  const none = picture(5000, []);
  assert.equal(collapseWithoutStops(none), none);
});
