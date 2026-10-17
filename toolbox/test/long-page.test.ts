import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PNG } from "pngjs";
import { MAX_SCREENSHOT_HEIGHT } from "../src/browser/screenshot.ts";
import { INPAGE_PATH, launchBrowser, newContext } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { gateChecks } from "../src/commands/gate.ts";
import { pageContrast } from "../src/instruments/contrast.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import { loadRun, type Facts } from "../src/lib/rundata.ts";
import { pageStampPath } from "../src/lib/sweepstamp.ts";

let server: Server;
let origin: string;
let scratch: string;

/** Far taller than a picture may be, with text at the top and text far below the limit. */
const LONG = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Lang</title></head><body style="margin:0;background:#fff;color:#000"><main><h1>Lang</h1><p>Tekst bovenaan.</p><div style="height:40000px;position:relative"><p style="position:absolute;top:30000px;margin:0">Tekst onderaan.</p></div></main></body></html>`;
const SHORT = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>a</title></head><body><main><h1>a</h1><p>Tekst op de pagina.</p></main></body></html>`;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-long-page-"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    // `/gone` never answers with HTTP: every measurement of it fails, also the second time.
    if (path === "/gone") return void request.socket.end("geen http\r\n\r\n");
    if (path === "/long") return void response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(LONG);
    if (path === "/a") return void response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SHORT);
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

/** The least a run needs for `collect`: the inventory for the scope, a checked site model without blockers, and the sample. */
async function runFor(paths: string[]): Promise<string> {
  const dir = join(scratch, "run");
  const urls = paths.map((path) => `${origin}${path}`);
  await writeJson(join(dir, "inventory.json"), { baseUrl: `${origin}/`, origin, sitemapUrls: 0, notFoundProbe: `${origin}/404`, pages: urls.map((url) => ({ url })), skipped: [], totals: {} });
  writeFileSync(join(dir, "site.json"), JSON.stringify({ version: 1, baseUrl: `${origin}/`, descriptionNl: "Een site om te testen.", pageTypes: [{ id: "tekst", descriptionNl: "Tekstpagina", representative: urls[0], pages: urls }], blockers: [], components: [], processes: [], frames: [], notesNl: [] }, null, 2));
  await writeJson(join(dir, "site-check.json"), { ok: true, siteSha256: await sha256File(join(dir, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
  const items = paths.map((path, index) => ({ id: `P${index + 1}`, url: `${origin}${path}`, slug: path.slice(1), kind: "page", reason: "test", templateHash: "t", contentHash: "c", title: path, status: 200, aliases: [] }));
  await writeJson(join(dir, "sample.json"), { method: "fixed-list", seed: "seed", populationSize: items.length, note: "", items });
  return dir;
}

test("a very tall page is pictured down to the limit, and a page that fails twice does not stop collect but is a gap of the gate", { timeout: 600_000 }, async () => {
  const dir = await runFor(["/a", "/long", "/gone"]);
  await collect({ run: dir });

  // The tall page: the picture stops at the limit, and its facts say so.
  const facts = await readJson<Facts>(join(dir, "pages", "long", "facts.json"));
  assert.equal(facts.screenshotClippedAt?.limit, MAX_SCREENSHOT_HEIGHT);
  assert.ok(facts.screenshotClippedAt!.pageHeight >= 40000, String(facts.screenshotClippedAt!.pageHeight));
  assert.equal(PNG.sync.read(readFileSync(join(dir, "pages", "long", "screenshot-light.png"))).height, MAX_SCREENSHOT_HEIGHT);
  assert.equal((await readJson<Facts>(join(dir, "pages", "a", "facts.json"))).screenshotClippedAt, undefined, "a short page is pictured whole");

  // The page that never loads: its facts hold the error, it has no stamp, and the rest was measured.
  const gone = await readJson<Facts>(join(dir, "pages", "gone", "facts.json"));
  assert.match(gone.collectError ?? "", /ERR_INVALID_HTTP_RESPONSE/);
  assert.ok(!existsSync(pageStampPath(dir, "gone")));
  assert.ok(existsSync(pageStampPath(dir, "long")));
  const summaries = (await readJson<{ pages: { slug: string; collectError?: string }[] }>(join(dir, "collect.json"))).pages;
  assert.deepEqual(summaries.map((entry) => entry.slug), ["a", "long", "gone"]);

  // The gate names the page that was not measured as a gap, and the tall page as a limitation.
  const run = await loadRun(dir);
  assert.deepEqual(run.pages.map((page) => page.item.slug), ["a", "long"]);
  const { gaps, limitations } = gateChecks(run);
  const notMeasured = gaps.filter((gap) => gap.check === "pages-loaded");
  assert.deepEqual(notMeasured.map((gap) => gap.url), [`${origin}/gone`]);
  assert.match(notMeasured[0]!.missingNl, /ook bij een tweede poging niet meten/);
  assert.deepEqual(limitations.filter((entry) => entry.check === "screenshot-clipped").map((entry) => entry.url), [`${origin}/long`]);
});

test("contrast on a page taller than the limit measures the text above it and marks the text below it as not measured", { timeout: 120_000 }, async () => {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser, { colorScheme: "light" });
    await context.addInitScript({ path: INPAGE_PATH });
    const page = await context.newPage();
    await page.goto(`${origin}/long`);
    const measured = await pageContrast(page);
    assert.equal(measured.screenshotClippedAt?.limit, MAX_SCREENSHOT_HEIGHT);
    const top = measured.measurements.find((entry) => entry.text.includes("Tekst bovenaan"))!;
    const bottom = measured.measurements.find((entry) => entry.text.includes("Tekst onderaan"))!;
    assert.equal(top.outcome, "passed");
    assert.equal(bottom.outcome, "cantTell");
    assert.match(bottom.reason ?? "", /onder de grens van de schermafbeelding/);
  } finally {
    await browser.close();
  }
});
