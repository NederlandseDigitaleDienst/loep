import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { PNG } from "pngjs";
import { sha256 } from "../src/lib/canonical.ts";
import { indexObservations } from "../src/lib/verdict.ts";
import { cutoutOutcome } from "../src/session/cutout-command.ts";
import { Images } from "../src/session/observations.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-cutout-"));
const outside = mkdtempSync(join(tmpdir(), "loep-cutout-outside-"));
after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** A screenshot of 40 by 30 pixels: white, with a red block from (10,5) of 8 by 6. */
function screenshot(): Buffer {
  const picture = new PNG({ width: 40, height: 30 });
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 40; x++) {
      const red = x >= 10 && x < 18 && y >= 5 && y < 11;
      const at = (y * 40 + x) * 4;
      picture.data[at] = 255;
      picture.data[at + 1] = red ? 0 : 255;
      picture.data[at + 2] = red ? 0 : 255;
      picture.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(picture);
}

mkdirSync(join(dir, "pages", "home"), { recursive: true });
mkdirSync(join(dir, "observations", "b-111"), { recursive: true });
const bytes = screenshot();
writeFileSync(join(dir, "pages", "home", "screenshot-light.png"), bytes);
writeFileSync(join(dir, "pages", "home", "facts.json"), "{}");
writeFileSync(join(outside, "elders.png"), bytes);

test("cutout cuts a piece out of a screenshot of the run and names where it came from", async () => {
  const images = new Images(dir, join("observations", "b-111", "0001"));
  const outcome = await cutoutOutcome(dir, ["pages/home/screenshot-light.png"], { at: "10,5,8,6" }, images);
  assert.deepEqual(outcome.result, { from: join("pages", "home", "screenshot-light.png"), fromSha256: sha256(bytes), at: { x: 10, y: 5, width: 8, height: 6 }, pictureSize: { width: 40, height: 30 } });
  assert.equal(outcome.print.size, "8x6 uit 40x30");
  const piece = PNG.sync.read(readFileSync(join(dir, outcome.print.image as string)));
  assert.equal(piece.width, 8);
  assert.equal(piece.height, 6);
  assert.ok([...Array(48).keys()].every((pixel) => piece.data[pixel * 4] === 255 && piece.data[pixel * 4 + 1] === 0), "the piece is the red block, and only that");
  assert.equal((await images.hashed()).length, 1, "the piece is kept with the observation");
});

test("cutout refuses a picture outside the run, a file that is no png and a box outside the picture, and says what to give", async () => {
  const images = new Images(dir, join("observations", "b-111", "0002"));
  await assert.rejects(cutoutOutcome(dir, [], { at: "0,0,1,1" }, images), /cutout verwacht het pad van een schermafbeelding in de run/);
  await assert.rejects(cutoutOutcome(dir, [join(outside, "elders.png")], { at: "0,0,1,1" }, images), /ligt buiten de run/);
  await assert.rejects(cutoutOutcome(dir, ["../elders.png"], { at: "0,0,1,1" }, images), /er is geen bestand|ligt buiten de run/);
  await assert.rejects(cutoutOutcome(dir, ["pages/home/facts.json"], { at: "0,0,1,1" }, images), /is geen png/);
  await assert.rejects(cutoutOutcome(dir, ["pages/home/screenshot-light.png"], {}, images), /verwacht --at x,y,breedte,hoogte .* is 40 bij 30 pixels/);
  await assert.rejects(cutoutOutcome(dir, ["pages/home/screenshot-light.png"], { at: "30,20,20,20" }, images), /valt buiten de schermafbeelding: .* is 40 bij 30 pixels\. Kies een kader binnen 0,0,40,30/);
});

test("a cutout is a look that can be made again without a page to open", () => {
  const index = indexObservations([{ id: "b-111-0001", command: "cutout", error: null, state: { start: null }, result: {} }]);
  assert.equal(index.get("b-111-0001")!.replayable, true);
});
