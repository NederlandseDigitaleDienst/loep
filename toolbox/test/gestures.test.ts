import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { Daemon, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";

/**
 * Drag and swipe in a session (#240), on the variant of the test site with the faults: a photo
 * series that moves on only by a swipe, and a price slider that works only by dragging.
 */

let fixture: FixtureServer;
let scratch: string;
let run: string;
let daemon: Daemon;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-gestures-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  run = join(scratch, "run");
  const origin = fixture.origins.defect;
  daemon = await Daemon.create(run, { hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 50, maxSessions: 1, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  await daemon.close();
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

function raw(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Response> {
  return daemon.handle({ op: "command", session: "main", command, args: args.map(String), options });
}

async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await raw(command, args, options);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

function observation(id: string): Observation {
  const split = id.lastIndexOf("-");
  return JSON.parse(readFileSync(join(run, "observations", id.slice(0, split), `${id.slice(split + 1)}.json`), "utf8")) as Observation;
}

async function found(query: string): Promise<string[]> {
  return (await loep("find", [query])).found as string[];
}

async function ref(query: string): Promise<number> {
  const first = (await found(query))[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

test("swipe on the photo series of the news item shows photo 2, and back again", async () => {
  await loep("open", ["/nieuws/nieuwe-fietsenstalling.html"]);
  const gallery = await ref("css:.galerij");
  assert.match((await found("css:.galerij-teller"))[0]!, /Foto 1 van 3/);

  const swiped = await loep("swipe", [gallery, "left"]);
  assert.match(String(swiped.swiped), /^left, \d+ pixels$/);
  assert.match((await found("css:.galerij-teller"))[0]!, /Foto 2 van 3/, JSON.stringify(swiped));
  const shown = await loep("html", [await ref("css:.galerij-foto:not([hidden])")]);
  assert.match(JSON.stringify(shown), /galerij-2\.svg/, "photo 2 is the one that shows");
  // A picture of the window before and after, both in the record.
  for (const image of [swiped.imageBefore, swiped.image]) assert.ok(typeof image === "string" && existsSync(join(run, image)), String(image));
  const record = observation(swiped.id);
  assert.equal(record.images.length, 2);
  assert.equal((record.result as { direction: string }).direction, "left");
  assert.equal(record.stateAfter !== null, true, "a swipe is a step of the recipe");

  await loep("swipe", [gallery, "right"]);
  assert.match((await found("css:.galerij-teller"))[0]!, /Foto 1 van 3/);
});

test("swipe without a direction is refused and costs nothing", async () => {
  await loep("open", ["/nieuws/nieuwe-fietsenstalling.html"]);
  const gallery = await ref("css:.galerij");
  const before = (await loep("status")).commands;
  const refused = await raw("swipe", [gallery, "sideways"]);
  assert.equal(refused.ok, false);
  assert.match(String(refused.print.error), /left, right, up of down/);
  assert.equal((await loep("status")).commands, before);
});

test("drag on the price slider of the products page changes the number of products", async () => {
  await loep("open", ["/producten.html"]);
  assert.match((await found("css:.aantal"))[0]!, /6 producten gevonden/);
  const thumb = await ref("css:.schuif-knop");
  const dragged = await loep("drag", [thumb, -150, 0]);
  assert.match(String(dragged.dragged), /^-150, 0 pixels/);
  const count = (await found("css:.aantal"))[0]!;
  assert.doesNotMatch(count, /6 producten gevonden/, JSON.stringify(dragged));
  assert.match(count, /\d producten? gevonden/);
});

test("drag --to drags onto a second element, and the step keeps the shift so that a fresh page does the same", async () => {
  await loep("open", ["/producten.html"]);
  const thumb = await ref("css:.schuif-knop");
  // The label of the search field stands above the left part of the slider.
  const label = await ref("css:label[for=productfilter]");
  const dragged = await loep("drag", [thumb], { to: String(label) });
  const result = observation(dragged.id).result as { dx: number; dy: number };
  assert.ok(result.dx < 0, "the label lies left of the thumb at the end of the track");
  const counted = await loep("find", ["css:.aantal"]);
  const count = (counted.found as string[])[0]!;
  assert.doesNotMatch(count, /6 producten gevonden/);
  // The recipe holds the shift, not the number of the second element, which means nothing on a fresh page.
  const step = observation(counted.id).state.steps.at(-1)!;
  assert.equal(step.command, "drag");
  assert.deepEqual(step.args, [String(result.dx), String(result.dy)]);
  assert.equal("to" in step.options, false);
  const replayed = await loep("replay", [counted.id]);
  assert.equal(replayed.verdict, "same", JSON.stringify(replayed));
});

test("drag without a shift or --to is refused", async () => {
  await loep("open", ["/producten.html"]);
  const thumb = await ref("css:.schuif-knop");
  for (const args of [[thumb], [thumb, "left", 0], [thumb, 1, 2, 3]]) {
    const refused = await raw("drag", args);
    assert.equal(refused.ok, false, JSON.stringify(args));
    assert.match(String(refused.print.error), /drag verwacht/);
  }
});
