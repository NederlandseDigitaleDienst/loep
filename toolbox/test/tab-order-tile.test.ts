import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { collapseWithoutStops, sheetText, tabOrderPicture, tile, type Sheet } from "../src/commands/gate.ts";

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

test("a long page with stops from top to bottom shows its last stops, those in the footer (#653)", () => {
  // About 3800 pixels with 37 stops: no stretch is long enough to fold with the usual context.
  const stopsAt = Array.from({ length: 37 }, (_, index) => 40 + index * 100);
  const long = picture(3800, stopsAt);
  const scale = 1280 / 480;
  assert.ok(collapseWithoutStops(long).height / scale > 1100, "with the usual context the tile cuts off the footer");
  const { picture: folded, cut } = tabOrderPicture(long);
  assert.equal(cut, false);
  assert.equal(tile(folded).height, Math.round(folded.height / scale), "the tile takes all of it");
  assert.equal(rowsWithStop(folded), rowsWithStop(long), "every row with a stop is still there");

  const short = picture(600, [50, 300, 550]);
  assert.deepEqual(tabOrderPicture(short), { picture: short, cut: false }, "a picture that fits stays as it is");
  // Stops on every row cannot be folded: the tile ends before the bottom, and says so.
  assert.equal(tabOrderPicture(picture(4000, Array.from({ length: 200 }, (_, index) => index * 20))).cut, true);
});

test("beside the sheet stands how many stops the walk counted, and whether tile 3 shows them all (#653)", () => {
  const sheet: Sheet = { pageType: "home", page: "P1", url: "https://site.example/", file: "gate/sheet-home.png", sha256: "x", componentsNl: [], tiles: [] };
  assert.doesNotMatch(sheetText(sheet, "/run"), /Tab-proef telde/, "a sheet of an older run has no count");
  assert.match(sheetText({ ...sheet, tabStops: { count: 37, cut: false } }, "/run"), /De Tab-proef telde op deze pagina 37 Tab-stops, genummerd van 1 tot en met 37\. Vak 3 toont de pagina tot onderaan\. In een stuk zonder nummer, ook achter een grijs gestreepte band, staat geen Tab-stop\./);
  // A list with one Tab stop: the rows behind the band have no number, and the count says there is none to miss.
  assert.match(sheetText({ ...sheet, tabStops: { count: 1, cut: false } }, "/run"), /telde op deze pagina 1 Tab-stop\. Vak 3 toont de pagina tot onderaan\./);
  assert.match(sheetText({ ...sheet, tabStops: { count: 80, cut: true } }, "/run"), /80 Tab-stops, genummerd van 1 tot en met 80\. Vak 3 houdt op vóór het eind van de pagina\. Een stop met een hoger nummer dan het laatste in beeld is met Tab bereikt en staat onder de rand van het vak\./);
});
