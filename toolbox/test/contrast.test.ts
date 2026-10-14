import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { measure } from "../src/commands/contrast.ts";
import { backgroundRange, blend, contrastRatio, dominantColour, requiredRatio } from "../src/lib/contrast.ts";

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      png.data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return png;
}

const run = { text: "Voorbeeld", colour: [118, 118, 118, 1] as [number, number, number, number], opacity: 1, fontSizePx: 16, bold: false, box: { x: 10, y: 10, width: 80, height: 20 }, disabled: false, ariaHidden: false, tag: "p", region: "main", path: ["html > body > p"] };
// A white field with a band of "text" pixels through the middle of the box.
const textOnWhite = (grey: number) => image(100, 40, (x, y) => (y >= 18 && y < 22 && x >= 10 && x < 90 ? [grey, grey, grey] : [255, 255, 255]));

test("contrast ratios match the WCAG definition", () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(Math.round(contrastRatio([118, 118, 118], [255, 255, 255]) * 100) / 100, 4.54);
  assert.equal(contrastRatio([10, 20, 30], [10, 20, 30]), 1);
  assert.deepEqual(blend([0, 0, 0], 0.5, [255, 255, 255]), [128, 128, 128]);
});

test("large text has the lower threshold", () => {
  assert.equal(requiredRatio(16, false), 4.5);
  assert.equal(requiredRatio(24, false), 3);
  assert.equal(requiredRatio(18.66, true), 3);
  assert.equal(requiredRatio(18.66, false), 4.5);
});

test("the background is the colour that fills most of the area", () => {
  assert.deepEqual(dominantColour(textOnWhite(118), run.box)?.colour, [255, 255, 255]);
});

test("grey that just passes passes, and one shade lighter fails", () => {
  assert.equal(measure(run, textOnWhite(118)).outcome, "passed");
  const lighter = measure({ ...run, colour: [120, 120, 120, 1] }, textOnWhite(120));
  assert.equal(lighter.outcome, "failed");
  assert.equal(lighter.ratio, 4.4, "ratios are rounded down, never up");
});

test("no verdict on a background that is not flat, or when the text colour is not there", () => {
  const noisy = image(100, 40, (x, y) => [(x * 37 + y * 11) % 256, (x * 53) % 256, (y * 91) % 256]);
  // Black text on noise: fine against the light parts, lost against the dark ones.
  assert.equal(measure({ ...run, colour: [0, 0, 0, 1] }, noisy).outcome, "cantTell");
  assert.equal(measure({ ...run, colour: [200, 0, 0, 1] }, textOnWhite(118)).outcome, "cantTell");
  assert.equal(measure({ ...run, disabled: true }, textOnWhite(118)).outcome, "exempt");
});

test("a focus ring is found even when a larger faint tint changes too", async () => {
  const { focusIndicator } = await import("../src/lib/contrast.ts");
  const without = image(40, 20, () => [255, 255, 255]);
  // With focus: the whole box gets a faint tint, and a two-pixel dark ring is drawn around it.
  const withFocus = image(40, 20, (x, y) => (x < 2 || y < 2 || x >= 38 || y >= 18 ? [0, 60, 150] : [240, 244, 250]));
  const result = focusIndicator(withFocus, without, 10)!;
  assert.deepEqual(result.indicator, [0, 60, 150]);
  assert.ok(result.ratio! >= 3);
  assert.equal(focusIndicator(without, without)!.ratio, null);
});

test("text in a small coloured label is measured against the label, not the page around it", () => {
  // White page, a green pill exactly as large as the text box, white letters filling much of it.
  const pill = image(100, 40, (x, y) => {
    const inside = x >= 10 && x < 90 && y >= 10 && y < 30;
    if (!inside) return [255, 255, 255];
    return (x + y) % 3 === 0 ? [255, 255, 255] : [132, 187, 93];
  });
  const result = measure({ ...run, colour: [255, 255, 255, 1] }, pill);
  assert.equal(result.background, "#84bb5d");
  assert.equal(result.outcome, "failed");
  assert.equal(result.ratio, 2.2);
});

// White "letters" as vertical strokes over a photo: a background of many colours between two extremes.
const whiteOnPhoto = (shade: (x: number, y: number) => number) =>
  image(120, 40, (x, y) => {
    const inBox = x >= 10 && x < 90 && y >= 10 && y < 30;
    if (inBox && x % 8 < 2 && y >= 13 && y < 27) return [255, 255, 255];
    const value = shade(x, y);
    return [value, value, value];
  });
const white = { ...run, colour: [255, 255, 255, 1] as [number, number, number, number] };

test("the range behind text leaves out the letters and reports the lightest and darkest background", () => {
  // A gradient from dark to mid grey, left to right; no single colour covers 40% of the box.
  const range = backgroundRange(whiteOnPhoto((x) => 20 + x), white.box, [255, 255, 255])!;
  assert.ok(range.darkest[0] < 45, `darkest ${range.darkest[0]}`);
  assert.ok(range.lightest[0] > 95 && range.lightest[0] < 115, `lightest ${range.lightest[0]}`);
  assert.ok(range.textShare > 0.1 && range.textShare < 0.3);
  assert.equal(range.textColourAround, false);
});

test("text on an uneven background passes only when the worst case meets the requirement", () => {
  // Dark photo: even the lightest part is dark enough for white text.
  const dark = measure(white, whiteOnPhoto((x) => 10 + Math.floor(x / 2)));
  assert.equal(dark.outcome, "passed");
  assert.equal(dark.ratio, dark.range!.worstRatio, "a pass reports the worst case");
  assert.ok(dark.range!.worstRatio >= 4.5 && dark.range!.bestRatio > dark.range!.worstRatio);
  assert.match(dark.reason!, /niet egaal/);
});

test("text on an uneven background fails only when even the best case is too low", () => {
  // Light photo: even the darkest part gives white text too little contrast.
  const light = measure(white, whiteOnPhoto((x) => 150 + Math.floor(x / 2)));
  assert.equal(light.outcome, "failed");
  assert.equal(light.ratio, light.range!.bestRatio, "a failure reports the best case");
  assert.ok(light.range!.bestRatio < 4.5);
});

test("between the two cases there is no verdict, and the reason gives both ratios", () => {
  const mixed = measure(white, whiteOnPhoto((x) => 20 + x * 2));
  assert.equal(mixed.outcome, "cantTell");
  assert.equal(mixed.ratio, null);
  assert.ok(mixed.range!.worstRatio < 4.5 && mixed.range!.bestRatio >= 4.5);
  const nl = (ratio: number): string => `${String(ratio).replace(".", ",")}:1`;
  assert.ok(mixed.reason!.includes(nl(mixed.range!.worstRatio)) && mixed.reason!.includes(nl(mixed.range!.bestRatio)), mixed.reason!);
});

test("a background that partly has the text colour cannot pass", () => {
  // Dark photo with a white band right above and below the text: there the text would vanish.
  const banded = whiteOnPhoto((x, y) => (y < 10 || y >= 30 ? 255 : 10 + Math.floor(x / 2)));
  const result = measure(white, banded);
  assert.equal(backgroundRange(banded, white.box, [255, 255, 255])!.textColourAround, true);
  assert.equal(result.outcome, "cantTell");
  assert.match(result.reason!, /kleur van de tekst/);
});
