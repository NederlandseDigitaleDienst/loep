import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PNG } from "pngjs";
import type { Browser } from "playwright";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { render } from "../src/commands/render.ts";
import { wholePageScreenshot } from "../src/browser/screenshot.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { collectFacts } from "../src/instruments/facts.ts";
import { canonicalJson, sha256 } from "../src/lib/canonical.ts";
import { tool } from "../src/lib/typst.ts";
import { cutPiece, CUTOUT_MARGIN, CUTOUT_MAX, drawOutline, findingCutout, pieceAround, writeCutouts, type FindingCutout } from "../src/lib/cutout.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import { indexObservations } from "../src/lib/verdict.ts";
import { cutoutOutcome } from "../src/session/cutout-command.ts";
import { Images } from "../src/session/observations.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-cutout-"));
const outside = mkdtempSync(join(tmpdir(), "loep-cutout-outside-"));
let fixture: FixtureServer;
let browser: Browser;

before(async () => {
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(dir, "server.log") });
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** A picture of 40 by 30 pixels: white, with a red block from (10,5) of 8 by 6. */
function picture(): PNG {
  const png = new PNG({ width: 40, height: 30 });
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 40; x++) {
      const red = x >= 10 && x < 18 && y >= 5 && y < 11;
      const at = (y * 40 + x) * 4;
      png.data.set([255, red ? 0 : 255, red ? 0 : 255, 255], at);
    }
  }
  return png;
}
const pixel = (png: PNG, x: number, y: number): number[] => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];

test("a piece is the rectangle of the picture, and the outline lies just outside the element", () => {
  const piece = cutPiece(picture(), { x: 6, y: 1, width: 16, height: 14 });
  assert.deepEqual([piece.width, piece.height], [16, 14]);
  assert.deepEqual(pixel(piece, 4, 4), [255, 0, 0], "the red block starts at (10,5) of the picture, (4,4) of the piece");
  drawOutline(piece, { x: 4, y: 4, width: 8, height: 6 });
  assert.deepEqual(pixel(piece, 4, 4), [255, 0, 0], "the element itself is not painted over");
  assert.deepEqual(pixel(piece, 3, 6), [255, 255, 255], "right against the element a white line");
  assert.deepEqual(pixel(piece, 2, 6), [178, 0, 32], "then the dark red band");
  assert.throws(() => cutPiece(picture(), { x: 30, y: 20, width: 20, height: 20 }), /valt buiten de schermafbeelding van 40 bij 30 pixels/);
});

test("the rectangle around an element has a margin, stays in the picture and is no larger than the largest piece", () => {
  assert.deepEqual(pieceAround({ x: 100, y: 200, width: 50, height: 20 }, { width: 1280, height: 3000 }), { at: { x: 100 - CUTOUT_MARGIN, y: 200 - CUTOUT_MARGIN, width: 50 + 2 * CUTOUT_MARGIN, height: 20 + 2 * CUTOUT_MARGIN }, element: { x: CUTOUT_MARGIN, y: CUTOUT_MARGIN, width: 50, height: 20 } });
  assert.deepEqual(pieceAround({ x: 5, y: 0, width: 50, height: 20 }, { width: 1280, height: 3000 })!.at, { x: 0, y: 0, width: 55 + CUTOUT_MARGIN, height: 20 + CUTOUT_MARGIN });
  const large = pieceAround({ x: 0, y: 0, width: 1280, height: 2000 }, { width: 1280, height: 3000 })!;
  assert.deepEqual([large.at.width, large.at.height], [CUTOUT_MAX.width, CUTOUT_MAX.height]);
  assert.equal(pieceAround({ x: 0, y: 3100, width: 10, height: 10 }, { width: 1280, height: 3000 }), null, "below a picture that stops at its limit there is nothing to cut");
  assert.equal(pieceAround({ x: 10, y: 10, width: 0, height: 10 }, { width: 1280, height: 3000 }), null);
});

test("a finding gets a piece of the screenshot of the sweep of the test site, with the element outlined", async () => {
  const run = join(dir, "run");
  const pageDir = join("pages", "contact");
  mkdirSync(join(run, pageDir), { recursive: true });
  const url = `${fixture.origins.defect}/contact.html`;
  const context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, url);
  await wholePageScreenshot(page, { path: join(run, pageDir, "screenshot-light.png") });
  const facts = await collectFacts(page);
  await context.close();
  writeFileSync(join(run, pageDir, "facts.json"), JSON.stringify(facts));

  // A link away from the edge of the page, as a judge cites it from an observation of the session.
  const links = facts.links as { path: string[]; box: { x: number; y: number; width: number; height: number }; visible: boolean }[];
  const link = links.find((entry) => entry.visible && entry.box.x > 2 * CUTOUT_MARGIN && entry.box.y > 2 * CUTOUT_MARGIN && entry.box.width > 4 && entry.box.height > 4)!;
  assert.ok(link, "the test page has a link to cut out");
  const observation = { id: "b-1-0001", command: "contrast", error: null, target: { path: link.path }, page: { url, scheme: "light", viewport: { width: 1280, height: 800 } }, state: { id: "s0", steps: [] }, result: {}, images: [] };
  const records = new Map<string, unknown>([[observation.id, observation]]);
  const pages = [{ label: "P01", url, dir: pageDir }];
  const cutout = findingCutout({ evidence: [observation.id] }, { runDir: run, records, pages })!;
  const screenshot = readFileSync(join(run, pageDir, "screenshot-light.png"));
  assert.equal(cutout.from, join(pageDir, "screenshot-light.png"));
  assert.equal(cutout.fromSha256, sha256(screenshot));
  assert.equal(cutout.boxFrom, join(pageDir, "facts.json"));
  assert.deepEqual(cutout.element, { x: CUTOUT_MARGIN, y: CUTOUT_MARGIN, width: link.box.width, height: link.box.height });
  assert.deepEqual([cutout.at.x, cutout.at.y], [link.box.x - CUTOUT_MARGIN, link.box.y - CUTOUT_MARGIN]);

  // Not in another state, scheme or width: then the screenshot of the sweep does not show what the judge saw.
  const other = (change: Record<string, unknown>): FindingCutout | null => findingCutout({ evidence: ["x"] }, { runDir: run, records: new Map([["x", { ...observation, ...change }]]), pages });
  assert.equal(other({ state: { id: "s1", steps: [{ command: "click" }] } }), null);
  assert.equal(other({ page: { ...observation.page, scheme: "dark" } }), null);
  assert.equal(other({ page: { ...observation.page, viewport: { width: 360, height: 740 } } }), null);
  assert.equal(other({ target: { path: ["#nergens"] } }), null, "an element the sweep did not record has no box");

  // The report cuts the piece, outlines the element and leaves the pixels inside it as they were.
  const evaluation = exampleEvaluation();
  const finding = evaluation.criteria.flatMap((criterion) => criterion.findings)[0]!;
  finding.cutout = cutout;
  const { files, problems } = await writeCutouts(run, evaluation, join(run, "report", "uitsneden"));
  assert.deepEqual(problems, []);
  const piece = PNG.sync.read(readFileSync(files[finding.id]!.absolute));
  const source = PNG.sync.read(screenshot);
  assert.deepEqual([piece.width, piece.height], [cutout.at.width, cutout.at.height]);
  const middle = { x: cutout.element.x + Math.floor(cutout.element.width / 2), y: cutout.element.y + Math.floor(cutout.element.height / 2) };
  assert.deepEqual(pixel(piece, middle.x, middle.y), pixel(source, cutout.at.x + middle.x, cutout.at.y + middle.y));
  assert.deepEqual(pixel(piece, cutout.element.x - 3, middle.y), [178, 0, 32]);
  assert.deepEqual(pixel(piece, 0, 0), pixel(source, cutout.at.x, cutout.at.y), "the margin is the page itself");

  // A picture that changed after the evaluation gives no piece, and says so.
  const changed = await writeCutouts(run, { ...evaluation, criteria: evaluation.criteria.map((criterion) => ({ ...criterion, findings: criterion.findings.map((entry) => (entry.cutout ? { ...entry, cutout: { ...entry.cutout, fromSha256: "0".repeat(64) } } : entry)) })) }, join(run, "elders"));
  assert.deepEqual(changed.files, {});
  assert.match(changed.problems[0]!, /ontbreekt of is veranderd sinds de evaluatie/);
  // Past the limit for one report there are no more pieces.
  const spent = await writeCutouts(run, evaluation, join(run, "krap"), 10);
  assert.deepEqual(spent.files, {});
  assert.match(spent.problems[0]!, /1 uitsneden weggelaten: samen zouden ze groter worden dan/);
});

test("the report shows the piece at the finding, in the Markdown and in the PDF, and nothing at a finding without one", async (context) => {
  const run = join(dir, "report-run");
  mkdirSync(join(run, "pages", "home"), { recursive: true });
  writeFileSync(join(run, "pages", "home", "screenshot-light.png"), PNG.sync.write(picture()));
  const evaluation: Evaluation = exampleEvaluation();
  const [first, second] = evaluation.criteria.flatMap((criterion) => criterion.findings);
  first!.cutout = { from: join("pages", "home", "screenshot-light.png"), fromSha256: sha256(PNG.sync.write(picture())), at: { x: 4, y: 0, width: 20, height: 17 }, element: { x: 6, y: 5, width: 8, height: 6 }, page: "P01", boxFrom: "pages/home/facts.json" };
  writeFileSync(join(run, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(run);
  assert.deepEqual(result.cutoutNotes, []);
  const markdown = readFileSync(result.markdown, "utf8");
  const card = (id: string): string => markdown.split(`<a id="${id}"></a>`)[1]!.split("<a id=")[0]!;
  const image = /!\[Uitsnede van P01: het element van de bevinding, rood omlijnd\.\]\((uitsneden\/[0-9a-f]{16}\.png)\)/.exec(card(first!.id));
  assert.ok(image, "the card of the finding shows its piece");
  assert.ok(existsSync(join(run, "report", image[1]!)));
  assert.ok(!card(second!.id).includes("!["), "a finding without a picture shows none, and says nothing about it");
  if (result.pdf === null) return context.skip("Typst is not installed");
  const missingAllowed = (problem: string): boolean => problem.includes("is niet geïnstalleerd") && !(process.env.CI === "true" && problem.includes("veraPDF"));
  assert.deepEqual(result.pdfChecks.filter((problem) => !missingAllowed(problem)), [], "the PDF with a picture still passes its checks, with the alternative text");
  const listed = await tool("pdfimages", ["-list", result.pdf]);
  if (listed.found) assert.equal(listed.stdout.trim().split("\n").filter((line) => /^\s*\d+\s+\d+\s+image\s+20\s+17\b/.test(line)).length, 1, "the piece of 20 by 17 pixels is in the PDF");
});

mkdirSync(join(dir, "pages", "home"), { recursive: true });
mkdirSync(join(dir, "observations", "b-111"), { recursive: true });
const bytes = PNG.sync.write(picture());
writeFileSync(join(dir, "pages", "home", "screenshot-light.png"), bytes);
writeFileSync(join(dir, "pages", "home", "facts.json"), "{}");
writeFileSync(join(outside, "elders.png"), bytes);
// A link inside the run to a picture outside it: the picture is still outside the run.
symlinkSync(join(outside, "elders.png"), join(dir, "pages", "home", "verwijzing.png"));

test("the session command cutout cuts a piece out of a screenshot of the run and names where it came from", async () => {
  const images = new Images(dir, join("observations", "b-111", "0001"));
  const outcome = await cutoutOutcome(dir, ["pages/home/screenshot-light.png"], { at: "10,5,8,6" }, images);
  assert.deepEqual(outcome.result, { from: join("pages", "home", "screenshot-light.png"), fromSha256: sha256(bytes), at: { x: 10, y: 5, width: 8, height: 6 }, pictureSize: { width: 40, height: 30 } });
  assert.equal(outcome.print.size, "8x6 uit 40x30");
  const piece = PNG.sync.read(readFileSync(join(dir, outcome.print.image as string)));
  assert.deepEqual([piece.width, piece.height], [8, 6]);
  assert.ok([...Array(48).keys()].every((index) => piece.data[index * 4] === 255 && piece.data[index * 4 + 1] === 0), "the piece is the red block, and only that");
  assert.equal((await images.hashed()).length, 1, "the piece is kept with the observation");
});

test("cutout refuses a picture outside the run, a file that is no png and a box outside the picture, and says what to give", async () => {
  const images = new Images(dir, join("observations", "b-111", "0002"));
  await assert.rejects(cutoutOutcome(dir, [], { at: "0,0,1,1" }, images), /cutout verwacht het pad van een schermafbeelding in de run/);
  // Each refusal on its own, with the whole message: a file that is not there, and a picture outside the run, given in full or through a link.
  await assert.rejects(cutoutOutcome(dir, ["pages/home/bestaat-niet.png"], { at: "0,0,1,1" }, images), { message: "er is geen bestand pages/home/bestaat-niet.png in de run; geef het pad zoals het dossier of een eerder antwoord het noemt" });
  await assert.rejects(cutoutOutcome(dir, [join(outside, "elders.png")], { at: "0,0,1,1" }, images), { message: `${join(outside, "elders.png")} ligt buiten de run; cutout snijdt alleen uit een schermafbeelding van deze run` });
  await assert.rejects(cutoutOutcome(dir, ["pages/home/verwijzing.png"], { at: "0,0,1,1" }, images), { message: "pages/home/verwijzing.png ligt buiten de run; cutout snijdt alleen uit een schermafbeelding van deze run" });
  await assert.rejects(cutoutOutcome(dir, ["pages/home/facts.json"], { at: "0,0,1,1" }, images), /is geen png/);
  await assert.rejects(cutoutOutcome(dir, ["pages/home/screenshot-light.png"], {}, images), /verwacht --at x,y,breedte,hoogte .* is 40 bij 30 pixels/);
  await assert.rejects(cutoutOutcome(dir, ["pages/home/screenshot-light.png"], { at: "30,20,20,20" }, images), /valt buiten de schermafbeelding: .* is 40 bij 30 pixels\. Kies een kader binnen 0,0,40,30/);
});

test("cutout refuses an --at that is not a whole box inside the picture, and says what it expects", async () => {
  const images = new Images(dir, join("observations", "b-111", "0003"));
  const expected = "cutout verwacht --at x,y,breedte,hoogte in hele pixels vanaf de linkerbovenhoek van de schermafbeelding, zoals --at 0,120,640,300; pages/home/screenshot-light.png is 40 bij 30 pixels";
  for (const at of ["5,5,0,5", "5,5,5,0", "-1,5,5,5", "5,5,-5,5", "5,5,5,-5", "5,-1,5,5", "1.5,5,5,5", "5,5,5"]) {
    await assert.rejects(cutoutOutcome(dir, ["pages/home/screenshot-light.png"], { at }, images), { message: expected }, `--at ${at}`);
  }
});

test("a cutout is a look that can be made again without a page to open", () => {
  const index = indexObservations([{ id: "b-111-0001", command: "cutout", error: null, state: { start: null }, result: {} }]);
  assert.equal(index.get("b-111-0001")!.replayable, true);
});
