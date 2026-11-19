import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser } from "../src/browser/session.ts";
import { gateChecks, route } from "../src/commands/gate.ts";
import { inventory } from "../src/commands/inventory.ts";
import { ModelSweep, type CapturedState } from "../src/commands/modelsweep.ts";
import { sha256File, writeJson } from "../src/lib/canonical.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { Daemon } from "../src/session/daemon.ts";

// A page with a menu behind a button and one stylesheet of its own. While the page was loaded no more than
// `brokenUpTo` times, the stylesheet does not arrive: the connection is cut before an answer, or with `busy` the
// server answers 503. The page is drawn without it. The page also asks for a script the site does not have and for
// one the server sends in a broken packing: both fail for every visitor, and are the site as it is.
const PAGE = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Start - Proefsite</title><link rel="stylesheet" href="/style.css"><script src="/missing.js"></script><script src="/broken.js"></script></head>
<body><header><button type="button" id="menuknop" aria-expanded="false" aria-controls="paneel">Menu</button><div id="paneel" hidden><a href="/">Alles over ons</a></div></header><main><h1>Start</h1></main>
<script>document.getElementById("menuknop").addEventListener("click", (event) => { event.currentTarget.setAttribute("aria-expanded", "true"); document.getElementById("paneel").hidden = false; });</script></body></html>`;

let server: Server;
let origin: string;
let run: string;
let browser: Browser;
let pageLoads = 0;
let brokenUpTo = 0;
let busy = false;

before(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://site").pathname;
    if (path === "/style.css") {
      if (pageLoads <= brokenUpTo) return busy ? void response.writeHead(503, { "content-type": "text/plain" }).end("busy") : void request.socket.destroy();
      return void response.writeHead(200, { "content-type": "text/css", "cache-control": "no-store" }).end("body { font-family: sans-serif; color: #111; background: #fff }");
    }
    if (path === "/broken.js") return void response.writeHead(200, { "content-type": "text/javascript", "content-encoding": "gzip" }).end("not packed");
    if (path !== "/") return void response.writeHead(404).end();
    pageLoads++;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = mkdtempSync(join(tmpdir(), "loep-state-not-loaded-"));
  // Nothing is broken until the recipe is saved.
  brokenUpTo = -1;
  await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 1, fixedUrls: [`${origin}/`] });
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
});

after(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(run, { recursive: true, force: true });
});

/** One sweep over the states of the model, with the stylesheet cut off for the first `broken` loads of the page. */
async function sweepStates(broken: number): Promise<{ menu: CapturedState; reused: boolean; loads: number }> {
  pageLoads = 0;
  brokenUpTo = broken;
  const sweep = await ModelSweep.load(run, browser);
  const states = await sweep.captureStates();
  return { menu: states.find((state) => state.id === "component-menu")!, reused: sweep.reusedStates.includes("component-menu"), loads: pageLoads };
}

test("a state captured without a stylesheet of the site says so, and the next sweep captures it again with the same recipe", { timeout: 600_000 }, async () => {
  // The stylesheet never arrives: the state is opened once more, and then recorded with what was missing.
  // The scripts that fail for every visitor are not among it.
  const without = await sweepStates(Number.POSITIVE_INFINITY);
  assert.equal(without.menu.reached, true, without.menu.reasonNl ?? "");
  assert.deepEqual(without.menu.notLoaded?.map((entry) => [entry.resourceType, entry.address]), [["stylesheet", `${new URL(origin).host}/style.css`]]);

  // The gate hands it to the sweep, not to the explorer; when no new sweep is left it is a limitation.
  const checked = gateChecks({ pages: [], dir: "", inventory: { baseUrl: `${origin}/`, notFoundProbe: `${origin}/404`, skipped: [], totals: {} }, sample: { items: [] }, states: { dialogs: [], skipped: [], singleKeys: { states: [] }, hoverCoverage: { kinds: 0, notExamined: 0, narrowPages: [], states: [] }, downEventCoverage: { notExamined: 0, narrowPages: [], states: [] } }, contrast: [], siteStates: { states: [without.menu], dismissals: [] } } as unknown as RunData);
  const gaps = checked.gaps.filter((gap) => gap.check === "state-resource-not-loaded");
  assert.deepEqual(gaps.map((gap) => [gap.state, gap.fixedBy]), [["component-menu", "sweep"]]);
  assert.match(gaps[0]!.missingNl, /kwam de stylesheet \S+\/style\.css niet binnen/);
  assert.equal(route(gaps, [], false, [{ command: "explore" }, { command: "collect" }, { command: "gate" }], () => false).next, "sweep");
  const spent = route(gaps, [], false, [{ command: "explore" }, { command: "collect" }, { command: "collect" }, { command: "collect" }, { command: "gate" }], () => false);
  assert.deepEqual(spent.gaps, []);
  assert.match(spent.limitations[0]!.missingNl, /^Bij het vastleggen van deze toestand kwam de stylesheet \S+\/style\.css ook bij een nieuwe poging niet binnen\. /);
  assert.doesNotMatch(spent.limitations[0]!.missingNl, /veegronde|net::|\(/);

  // The same recipe, and the stylesheet arrives now: captured again, nothing missing. One load fewer than before, without the second opening.
  const again = await sweepStates(0);
  assert.equal(again.reused, false, "the earlier capture is not kept");
  assert.equal(again.menu.notLoaded, undefined);
  assert.equal(again.loads, without.loads - 1);

  // A capture in which everything arrived is kept by the sweep after it.
  assert.equal((await sweepStates(0)).reused, true);

  // The stylesheet misses on the first opening only: opened once more before measuring, and nothing is missing in what is kept.
  rmSync(join(run, "site-states"), { recursive: true, force: true });
  const once = await sweepStates(1);
  assert.equal(once.menu.notLoaded, undefined);
  assert.equal(once.loads, again.loads + 1, "one more load than a capture in which everything arrived");

  // A server too busy to hand out the stylesheet answers, and the page is as bare as without an answer.
  rmSync(join(run, "site-states"), { recursive: true, force: true });
  busy = true;
  assert.deepEqual((await sweepStates(Number.POSITIVE_INFINITY)).menu.notLoaded, [{ resourceType: "stylesheet", address: `${new URL(origin).host}/style.css`, error: "HTTP 503" }]);
});
