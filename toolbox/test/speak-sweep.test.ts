import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { packageVersion } from "../src/instruments/methods/registry.ts";
import { spokenByItself } from "../src/instruments/methods/speech.ts";
import { Daemon, type LastStepSpeech, type Recipe } from "../src/session/daemon.ts";
import { replayFromClean } from "../src/session/recipe.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness } from "../src/session/safety.ts";
import type { Env } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;
let browser: Browser;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-speak-sweep-"));
  daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

async function loep(command: string, args: (string | number)[] = []): Promise<Record<string, unknown>> {
  const response = await daemon.handle({ op: "command", session: "main", command, args: args.map(String), options: {} });
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print;
}

async function ref(query: string): Promise<number> {
  const first = ((await loep("find", [query])).found as string[])[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

test("the sweep hears what is said by itself during the step that opens a state, on the page and in an embedded frame", async () => {
  const env: Env = { browser, runDir: run, scope: { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, politeness: new Politeness(0), limits: { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 0 } };
  const heardWhile = async (selector: string, name: string): Promise<ReturnType<typeof spokenByItself>> => {
    await loep("open", ["/speech.html"]);
    await loep("click", [await ref(selector)]);
    await loep("state", ["save", name]);
    const recipe = JSON.parse(readFileSync(join(run, "recipes", `${name}.json`), "utf8")) as Recipe;
    const speech: LastStepSpeech = { heard: [] };
    const replay = await replayFromClean(env, recipe, null, {}, undefined, speech);
    await replay.surface?.context.close();
    assert.equal(replay.ok, true, replay.reasonNl ?? "");
    return spokenByItself(speech.heard);
  };
  const reader = `virtual-screen-reader ${packageVersion("@guidepup/virtual-screen-reader")} (nagebootst)`;
  assert.deepEqual(await heardWhile("css:#send-shown", "melding-zichtbaar"), { reader, spoken: ["polite: Bedankt voor uw bericht."], revealed: [], notSpoken: [] });
  assert.deepEqual(await heardWhile("css:#send-hidden", "melding-verborgen"), { reader, spoken: [], revealed: ["polite: Bedankt voor uw bericht."], notSpoken: [] });
  assert.deepEqual(await heardWhile("css:#frame-load", "melding-in-venster"), { reader, spoken: ["polite: De kaart is geladen."], revealed: [], notSpoken: [] });
});
