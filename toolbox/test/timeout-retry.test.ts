import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser } from "../src/browser/session.ts";
import { inventory } from "../src/commands/inventory.ts";
import { ModelSweep, openComponentOn, type StateOpener } from "../src/commands/modelsweep.ts";
import { sha256File, writeJson } from "../src/lib/canonical.ts";
import { Daemon } from "../src/session/daemon.ts";
import { loadRecipes, replayEnv } from "../src/session/recipe.ts";

// A page with a menu behind a button. While `stalling` is above zero, each load serves the button
// shaking without end: Playwright never finds it stable, and the click stops on its time-out, as a
// click on a page under load can. With `gone` the button is not there at all.
const page = (button: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Start - Proefsite</title>
<style>@keyframes shake { from { transform: translateX(0) } to { transform: translateX(12px) } } .shaking { animation: shake 80ms linear infinite alternate }</style></head>
<body><header>${button}<div id="paneel" hidden><a href="/">Alles over ons</a></div></header><main><h1>Start</h1></main>
<script>document.getElementById("menuknop")?.addEventListener("click", (event) => { event.currentTarget.setAttribute("aria-expanded", "true"); document.getElementById("paneel").hidden = false; });</script></body></html>`;

let server: Server;
let origin: string;
let run: string;
let browser: Browser;
let opener: StateOpener;
let stalling = 0;
let gone = false;
let loads = 0;
// Loads after this many are answered only after SLOW_MS: a page that keeps a fresh attempt waiting past the limit.
let slowAfter: number | null = null;
const SLOW_MS = 6000;

before(async () => {
  server = createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://site").pathname !== "/") return void response.writeHead(404).end();
    loads++;
    const shaking = stalling > 0;
    if (shaking) stalling--;
    const button = gone ? "" : `<button type="button" id="menuknop" aria-expanded="false" aria-controls="paneel"${shaking ? ' class="shaking"' : ""}>Menu</button>`;
    const respond = (): void => void response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page(button));
    if (slowAfter !== null && loads > slowAfter) setTimeout(respond, SLOW_MS);
    else respond();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = mkdtempSync(join(tmpdir(), "loep-timeout-retry-"));
  await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 1, fixedUrls: [`${origin}/`] });

  // The recipe is recorded through a real session, on a page where the button stands still.
  const daemon = await Daemon.create(run, { hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (command: string, args: string[] = []): Promise<Record<string, unknown>> => {
    const response = await daemon.handle({ op: "command", session: "verken", command, args, options: {} });
    assert.equal(response.ok, true, `${command}: ${JSON.stringify(response.print)}`);
    return response.print;
  };
  try {
    await daemon.handle({ op: "start", session: "verken" });
    await loep("open", ["/"]);
    await loep("click", [((await loep("find", ["css:#menuknop"])).found as string[])[0]!.split(" ")[0]!]);
    await loep("state", ["save", "component-menu"]);
  } finally {
    await daemon.close();
  }
  const model = {
    version: 1,
    baseUrl: `${origin}/`,
    descriptionNl: "Een proefsite met een menu achter een knop.",
    pageTypes: [{ id: "type-1", descriptionNl: "Startpagina", representative: `${origin}/`, pages: [`${origin}/`] }],
    blockers: [],
    components: [{ id: "menu", type: "menu", descriptionNl: "Menu achter een knop", pageTypes: ["type-1"], viewport: null, recipe: "component-menu", postcondition: { kind: "expanded", selector: "#menuknop" } }],
    processes: [],
    frames: [],
    notesNl: [],
  };
  writeFileSync(join(run, "site.json"), JSON.stringify(model, null, 2));
  await writeJson(join(run, "site-check.json"), { ok: true, siteSha256: await sha256File(join(run, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
  browser = await launchBrowser();
  opener = (await ModelSweep.load(run, browser)).openers().find((entry) => entry.base.id === "component-menu")!;
  assert.ok(opener.open && opener.openOn, "the menu has a recipe that opens it on its own page and on a page type");
});

after(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(run, { recursive: true, force: true });
});

/** Open the menu as the sweep measures it, and on its page type in a portrait window: what each attempt ended with, and how often the page was loaded. */
async function bothOpenings(stalls: number): Promise<{ reached: boolean; reasonNl: string | null; firstTimeoutNl: string | undefined; loads: number }[]> {
  const results = [];
  for (const openIt of [() => opener.open!(), () => opener.openOn!(`${origin}/`, { width: 800, height: 1280 })]) {
    stalling = stalls;
    loads = 0;
    const opened = await openIt();
    await opened.surface?.context.close().catch(() => undefined);
    results.push({ reached: opened.reached, reasonNl: opened.reasonNl, firstTimeoutNl: opened.firstTimeoutNl, loads });
  }
  return results;
}

test("a click that times out once is tried once more on a freshly loaded page, and the component opens", { timeout: 120_000 }, async () => {
  for (const result of await bothOpenings(1)) {
    assert.equal(result.reached, true, result.reasonNl ?? "");
    assert.match(result.firstTimeoutNl ?? "", /^stap 1 \(click\) klikken lukt niet: .*Timeout \d+ms exceeded/);
    assert.equal(result.loads, 2, "the page was loaded again for the second attempt");
  }
});

test("a click that times out twice leaves the component not opened, and says there was a second attempt", { timeout: 120_000 }, async () => {
  for (const result of await bothOpenings(2)) {
    assert.equal(result.reached, false);
    assert.match(result.reasonNl ?? "", /^stap 1 \(click\) klikken lukt niet: .*Timeout \d+ms exceeded/);
    assert.ok(result.firstTimeoutNl, "the first time-out is recorded next to the reason of the second");
    assert.equal(result.loads, 2, "no third attempt");
  }
});

test("a step that fails without a time-out is not tried again", { timeout: 120_000 }, async () => {
  gone = true;
  try {
    for (const result of await bothOpenings(0)) {
      assert.equal(result.reached, false);
      assert.match(result.reasonNl ?? "", /vond het element niet terug/);
      assert.equal(result.firstTimeoutNl, undefined);
      assert.equal(result.loads, 1);
    }
  } finally {
    gone = false;
  }
});

/** Open the menu on its page within `limitMs`, then wait until every slow page has answered: what it returned, and which contexts are still open. */
async function openWithinLimit(limitMs: number): Promise<{ reached: boolean; reasonNl: string | null; openAfterwards: number }> {
  const env = await replayEnv(browser, run, { navigationDelayMs: 0 });
  const recipe = (await loadRecipes(run))["component-menu"]!;
  assert.equal(browser.contexts().length, 0, "no context is open before");
  const opened = await openComponentOn(env, { ...recipe, start: recipe.start! }, { kind: "expanded", selector: "#menuknop" }, `${origin}/`, { width: 800, height: 1280 }, limitMs);
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 3000));
  return { reached: opened.reached, reasonNl: opened.reasonNl, openAfterwards: browser.contexts().length };
}

test("a page that loads after the limit leaves no context open", { timeout: 120_000 }, async () => {
  slowAfter = 0;
  loads = 0;
  try {
    const result = await openWithinLimit(1500);
    assert.deepEqual(result, { reached: false, reasonNl: "geen antwoord binnen 1.5 seconden", openAfterwards: 0 });
  } finally {
    slowAfter = null;
  }
});

test("a second attempt that is still loading at the limit leaves no context open", { timeout: 120_000 }, async () => {
  // The first load shakes, so its click times out; the second load answers after the limit.
  stalling = 1;
  slowAfter = 1;
  loads = 0;
  try {
    const result = await openWithinLimit(5000);
    assert.deepEqual(result, { reached: false, reasonNl: "geen antwoord binnen 5 seconden", openAfterwards: 0 });
    assert.equal(loads, 2, "the second attempt had started, and no third one followed");
  } finally {
    stalling = 0;
    slowAfter = null;
  }
});
