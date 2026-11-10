import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Daemon, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { TEST_FILE } from "../src/session/commands.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/** `upload` puts the test file of loep in a file field (#467), and sends nothing. */

let site: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-upload-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

function raw(command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Response> {
  return daemon.handle({ op: "command", session: "main", command, args, options });
}

async function loep(command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await raw(command, args, options);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

function observation(id: string): Observation {
  const split = id.lastIndexOf("-");
  return JSON.parse(readFileSync(join(run, "observations", id.slice(0, split), `${id.slice(split + 1)}.json`), "utf8")) as Observation;
}

const commandsUsed = async (): Promise<number> => Number(String((await loep("status")).commands).split(" ")[0]);

test("the test file says it is a test file of loep", () => {
  assert.match(readFileSync(TEST_FILE, "utf8"), /testbestand van loep/);
});

test("upload chooses the test file in a file field, reports what the form shows and sends nothing", async () => {
  const sentBefore = site.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD").length;
  await loep("open", ["/upload.html"]);
  const chosen = await loep("upload", ["css:#bijlage"]);
  assert.equal(chosen.chosen, "loep-testbestand.txt");
  assert.equal(chosen.accept, ".txt,.pdf");
  assert.ok(JSON.stringify(chosen.live ?? chosen.appeared).includes("Gekozen: loep-testbestand.txt"), JSON.stringify(chosen));
  // The page tries to send the file as soon as it is chosen: the guard stops that, and says so.
  assert.ok((chosen.blocked as string[]).some((line) => /POST .*\/upload-direct/.test(line)), JSON.stringify(chosen));
  const recorded = observation(chosen.id).result as { file: string; field: { files: string[] } };
  assert.deepEqual(recorded.field.files, ["loep-testbestand.txt"]);
  const field = await loep("find", ["css:#gekozen"]);
  assert.match((field.found as string[])[0]!, /Gekozen: loep-testbestand.txt/);
  // Nothing but reads reached the site.
  assert.equal(site.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD").length, sentBefore);
  assert.equal(site.requests.some((request) => request.path.startsWith("/upload-")), false);
  // The step is part of the recipe, and a fresh page does the same.
  const steps = observation(field.id).state.steps;
  assert.deepEqual(steps.map((step) => step.command), ["upload"]);
  const replayed = await loep("replay", [field.id]);
  assert.equal(replayed.verdict, "same", JSON.stringify(replayed));
  assert.equal(site.requests.some((request) => request.path.startsWith("/upload-")), false);
});

test("upload takes the label of a file field, and refuses what is not one without costing the budget", async () => {
  await loep("open", ["/upload.html"]);
  assert.equal((await loep("upload", ["css:#bijlage-label"])).chosen, "loep-testbestand.txt");
  const used = await commandsUsed();
  const text = await raw("upload", ["css:#naam"]);
  assert.equal(text.ok, false);
  assert.match(String(text.print.error), /^dit is geen bestandsveld maar een <input>/);
  assert.match(String((await raw("upload", ["css:#naam-label"])).print.error), /^dit is geen bestandsveld/);
  assert.match(String((await raw("upload", ["css:#uit"])).print.error), /uitgeschakeld/);
  assert.equal(await commandsUsed(), used);
});
