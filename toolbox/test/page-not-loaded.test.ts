import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { collect } from "../src/commands/collect.ts";
import { gateChecks, route } from "../src/commands/gate.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import { loadRun, type Facts } from "../src/lib/rundata.ts";
import { CONTENT_VERSION, pageStampPath, readStamp, remeasureReason, SWEEP_STAMP_VERSION, type PageStamp } from "../src/lib/sweepstamp.ts";
import { setRunScope } from "../src/session/safety.ts";

// A page with one stylesheet of its own. While the page was loaded no more than `brokenUpTo` times, the stylesheet does not
// arrive: the connection is cut before an answer. The page also asks for a script the site does not have, which fails for
// every visitor and is the site as it is.
const PAGE = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Start - Proefsite</title><link rel="stylesheet" href="/style.css"><script src="/missing.js"></script></head>
<body><main><h1>Start</h1><p>Tekst op de pagina.</p></main></body></html>`;

let server: Server;
let origin: string;
let run: string;
let pageLoads = 0;
let brokenUpTo = 0;

before(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://site").pathname;
    if (path === "/style.css") {
      if (pageLoads <= brokenUpTo) return void request.socket.destroy();
      return void response.writeHead(200, { "content-type": "text/css", "cache-control": "no-store" }).end("body { font-family: sans-serif; color: #111; background: #fff }");
    }
    if (path !== "/") return void response.writeHead(404).end();
    pageLoads++;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = mkdtempSync(join(tmpdir(), "loep-page-not-loaded-"));
  const url = `${origin}/`;
  await writeJson(join(run, "inventory.json"), { baseUrl: url, origin, sitemapUrls: 0, notFoundProbe: `${origin}/404`, pages: [{ url }], skipped: [], totals: {} });
  writeFileSync(join(run, "site.json"), JSON.stringify({ version: 1, baseUrl: url, descriptionNl: "Een proefsite.", pageTypes: [{ id: "start", descriptionNl: "Startpagina", representative: url, pages: [url] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] }, null, 2));
  await writeJson(join(run, "site-check.json"), { ok: true, siteSha256: await sha256File(join(run, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
  await writeJson(join(run, "sample.json"), { method: "fixed-list", seed: "seed", populationSize: 1, note: "", items: [{ id: "P1", url, slug: "start", kind: "page", reason: "test", templateHash: "t", contentHash: "c", title: "Start", status: 200, aliases: [] }] });
  // As the command line does for a command of the sweep: the scope of the run says which stylesheets are the site's own.
  setRunScope(run);
});

after(async () => {
  setRunScope(null);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(run, { recursive: true, force: true });
});

/** One collect, with the stylesheet cut off for the first `broken` loads of the page. */
async function collectWith(broken: number): Promise<{ facts: Facts; stamp: PageStamp | null; loads: number }> {
  pageLoads = 0;
  brokenUpTo = broken;
  await collect({ run });
  return { facts: await readJson<Facts>(join(run, "pages", "start", "facts.json")), stamp: await readStamp<PageStamp>(pageStampPath(run, "start")), loads: pageLoads };
}

test("a page measured without a stylesheet of the site says so, the gate hands it to the sweep, and the next collect measures it again", { timeout: 600_000 }, async () => {
  // The stylesheet never arrives: the page is loaded once more, and then measured with what was missing.
  // The script the site does not have is not among it.
  const without = await collectWith(Number.POSITIVE_INFINITY);
  const address = `${new URL(origin).host}/style.css`;
  assert.deepEqual(without.facts.notLoaded?.map((entry) => [entry.resourceType, entry.address]), [["stylesheet", address]]);
  assert.deepEqual((without.stamp?.summary.notLoaded as Facts["notLoaded"])?.map((entry) => entry.address), [address]);

  // The gate hands it to the sweep, not to the explorer; when no new sweep is left it is a limitation.
  const checked = gateChecks(await loadRun(run));
  const gaps = checked.gaps.filter((gap) => gap.check === "page-resource-not-loaded");
  assert.deepEqual(gaps.map((gap) => [gap.page, gap.fixedBy]), [["P1", "sweep"]]);
  assert.match(gaps[0]!.missingNl, /^Bij het meten van deze pagina kwam de stylesheet \S+\/style\.css niet binnen /);
  assert.equal(route(gaps, [], false, [{ command: "explore" }, { command: "collect" }, { command: "gate" }], () => false).next, "sweep");
  const spent = route(gaps, [], false, [{ command: "explore" }, { command: "collect" }, { command: "collect" }, { command: "collect" }, { command: "gate" }], () => false);
  assert.deepEqual(spent.gaps, []);
  assert.match(spent.limitations[0]!.missingNl, /^Bij het meten van deze pagina kwam de stylesheet \S+\/style\.css ook bij een nieuwe poging niet binnen\. /);

  // The same content, and the stylesheet arrives now: measured again, nothing missing, and the gate has no gap.
  const again = await collectWith(0);
  assert.equal(again.facts.notLoaded, undefined, "the earlier measurement is not kept");
  assert.equal(again.stamp?.summary.notLoaded, undefined);
  assert.deepEqual(gateChecks(await loadRun(run)).gaps.filter((gap) => gap.check === "page-resource-not-loaded"), []);

  // A measurement in which everything arrived is kept by the collect after it: one load, to compare the content.
  assert.equal((await collectWith(0)).loads, 1);

  // The stylesheet misses on the first load only: loaded once more before measuring, and nothing is missing in what is kept.
  rmSync(pageStampPath(run, "start"));
  const once = await collectWith(1);
  assert.equal(once.facts.notLoaded, undefined);
  assert.equal(once.loads, again.loads + 1, "one load more than a measurement in which everything arrived");

  // A stylesheet that keeps missing can be the site itself: the next collect is the one more try, and missed there it is a
  // limitation at once. It does not send the run back again, and the collect after it keeps that measurement.
  rmSync(pageStampPath(run, "start"));
  assert.equal((await collectWith(Number.POSITIVE_INFINITY)).facts.notLoadedAgain, undefined);
  const twice = await collectWith(Number.POSITIVE_INFINITY);
  assert.equal(twice.facts.notLoadedAgain, true);
  const stays = gateChecks(await loadRun(run));
  assert.deepEqual(stays.gaps.filter((gap) => gap.check === "page-resource-not-loaded"), []);
  assert.deepEqual(stays.limitations.filter((gap) => gap.check === "page-resource-not-loaded").map((gap) => gap.page), ["P1"]);
  assert.match(stays.limitations.find((gap) => gap.check === "page-resource-not-loaded")!.missingNl, /^Bij het meten van deze pagina kwam de stylesheet \S+\/style\.css ook bij een nieuwe poging niet binnen\. /);
  const kept = await collectWith(Number.POSITIVE_INFINITY);
  assert.equal(kept.loads, 1, "only loaded to compare the content");
  assert.equal(kept.facts.notLoadedAgain, true);
});

test("a stamp that says a stylesheet did not arrive is measured again, before the content is compared", async () => {
  const stamp = { key: "k", version: 0, contentVersion: 0, blockers: "b", contentSha256: "c", summary: { notLoaded: [{ resourceType: "stylesheet", address: "example.org/style.css", error: "HTTP 503" }] }, dismissals: [], refusedWrites: [] };
  const fitting = { ...stamp, version: SWEEP_STAMP_VERSION, contentVersion: CONTENT_VERSION };
  let loaded = false;
  const reason = await remeasureReason(fitting, "k", "b", async () => ((loaded = true), { sha256: "c", snapshot: "" }), async () => "");
  assert.equal(reason, "bij de vorige meting kwam de stylesheet example.org/style.css niet binnen (HTTP 503)");
  assert.equal(loaded, false, "the page is not loaded to compare");
  assert.equal(await remeasureReason({ ...fitting, summary: {} }, "k", "b", async () => ({ sha256: "c", snapshot: "" }), async () => ""), null);
  // A measurement that was the one more try already is kept while the content stays the same.
  assert.equal(await remeasureReason({ ...fitting, summary: { ...fitting.summary, notLoadedAgain: true } }, "k", "b", async () => ({ sha256: "c", snapshot: "" }), async () => ""), null);
});
