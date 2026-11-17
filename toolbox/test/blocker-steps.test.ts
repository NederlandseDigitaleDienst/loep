import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { blockerSteps, Daemon } from "../src/session/daemon.ts";
import { loadRecipes, replayFromClean } from "../src/session/recipe.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness } from "../src/session/safety.ts";
import type { Env } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;
let browser: Browser;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-blocker-steps-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
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

async function click(selector: string): Promise<void> {
  const first = ((await loep("find", [selector])).found as string[])[0];
  assert.ok(first, `nothing found for ${selector}`);
  await loep("click", [Number(first.split(" ")[0])]);
}

test("a recipe that starts by closing a blocker skips those steps when the blocker is already gone, and runs them when it is there", async () => {
  await loep("open", ["/notice.html?melding"]);
  await click("css:#ok");
  await loep("state", ["save", "blocker-cookies"]);
  await loep("open", ["/notice.html?melding"]);
  await click("css:#ok");
  await click("css:#toggle");
  await loep("state", ["save", "component-meer"]);
  writeFileSync(join(run, "site.json"), JSON.stringify({ blockers: [{ id: "cookies", recipe: "blocker-cookies" }], components: [], processes: [] }));
  const recipes = await loadRecipes(run);
  assert.equal(blockerSteps.get(recipes["component-meer"]!.steps), 1, "the first step is the recipe of the blocker");
  assert.equal(blockerSteps.get(recipes["blocker-cookies"]!.steps), undefined, "a blocker's own recipe is not skipped");
  const env: Env = { browser, runDir: run, scope: { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, politeness: new Politeness(0), limits: { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 0 } };
  const expanded = { kind: "expanded", selector: "#toggle" } as never;
  // The notice is not there this time, as when the sweep closed it before or it came too late.
  const without = await replayFromClean(env, recipes["component-meer"]!, expanded, { url: `${site.origin}/notice.html` });
  await without.surface?.context.close();
  assert.equal(without.ok, true, without.reasonNl ?? "");
  // With the notice the recipe runs every step.
  const withNotice = await replayFromClean(env, recipes["component-meer"]!, expanded);
  await withNotice.surface?.context.close();
  assert.equal(withNotice.ok, true, withNotice.reasonNl ?? "");
});

test("the check that a blocker's postcondition does not already hold waits for a notice that a script adds just after the load", async () => {
  await loep("open", ["/late-notice.html"]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await click("css:#ok");
  await loep("state", ["save", "blocker-late"]);
  const recipes = await loadRecipes(run);
  const env: Env = { browser, runDir: run, scope: { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, politeness: new Politeness(0), limits: { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 0 } };
  // On the fresh page the notice is not there yet when the check starts.
  const replay = await replayFromClean(env, recipes["blocker-late"]!, { kind: "not-covering", selector: "#notice" } as never);
  await replay.surface?.context.close();
  assert.equal(replay.ok, true, replay.reasonNl ?? "");
  assert.equal(replay.before?.holds, false, replay.before?.detail ?? "");
});
