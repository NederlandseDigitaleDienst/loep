import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { retryOnce } from "../src/browser/session.ts";
import { contrast, type NotMeasured } from "../src/commands/contrast.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import { pageCoverage } from "../src/lib/extractors.ts";
import { LoginExpired } from "../src/lib/login.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import type { PageData, RunData } from "../src/lib/rundata.ts";

let server: Server;
let origin: string;
let scratch: string;
/** How often each page was asked for. */
const asked = new Map<string, number>();

const PAGE = (title: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>Tekst op de pagina.</p><a href="/a">Naar a</a></main></body></html>`;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-contrast-retry-"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const count = (asked.get(path) ?? 0) + 1;
    asked.set(path, count);
    // `/slow` does not load the first time it is asked for, `/gone` never. The answer is no HTTP, which
    // the browser does not try again by itself (a dropped connection it sometimes does).
    if ((path === "/slow" && count === 1) || path === "/gone") return void request.socket.end("geen http\r\n\r\n");
    if (!["/a", "/slow", "/gone"].includes(path)) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE(path.slice(1)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

/** The least a run needs for `contrast`: the inventory for the scope, a checked site model without blockers, and the sample. */
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

test("a page that does not load is tried once more, and a page that fails twice is named and left as a gap while the rest is measured", { timeout: 180_000 }, async () => {
  const dir = await runFor(["/a", "/slow", "/gone"]);
  const rows = await contrast(dir);

  // Every page in light and dark, in the default window and at 320 pixels wide.
  const of = (slug: string) => rows.filter((row) => row.slug === slug).map((row) => `${row.scheme}:${row.width ?? "standaard"}`).sort();
  const all = ["dark:320", "dark:standaard", "light:320", "light:standaard"];
  assert.deepEqual(of("a"), all);
  assert.deepEqual(of("slow"), all, "the page that did not load the first time was measured on its second try");
  assert.deepEqual(of("gone"), [], "the page that never loads has no row");
  assert.equal(asked.get("/slow"), 5, "one failed try, then four loads");
  assert.equal(asked.get("/gone"), 8, "two tries for each of the four measurements");
  assert.ok(rows.find((row) => row.slug === "slow" && row.scheme === "light" && row.width === undefined)!.measurements.some((entry) => entry.text.includes("Tekst op de pagina")));

  // What was measured is written, and what was not is named in the manifest.
  assert.equal((await readJson<unknown[]>(join(dir, "contrast.json"))).length, 8);
  const step = (await readJson<Manifest>(join(dir, "manifest.json"))).steps.at(-1)!;
  const notMeasured = step.notMeasured as NotMeasured[];
  assert.deepEqual(notMeasured.map((entry) => `${entry.slug} ${entry.scheme}:${entry.width ?? "standaard"}`).sort(), ["gone dark:320", "gone dark:standaard", "gone light:320", "gone light:standaard"]);
  assert.match(notMeasured[0]!.reasonNl, /net::ERR_INVALID_HTTP_RESPONSE/);

  // The gate sees the page that was not measured: every contrast measurement of it is missing.
  const run = { contrast: rows, states: null, siteStates: null } as unknown as RunData;
  const coverage = (slug: string) => pageCoverage({ item: { slug, url: `${origin}/${slug}` }, tabwalk: null, tabwalkDark: null } as unknown as PageData, run);
  const contrastOf = (slug: string) => Object.entries(coverage(slug)).filter(([name]) => name.startsWith("contrast")).map(([name, there]) => `${name}=${there}`);
  assert.ok(contrastOf("gone").every((entry) => entry.endsWith("=false")), contrastOf("gone").join(", "));
  assert.ok(contrastOf("slow").every((entry) => entry.endsWith("=true")), contrastOf("slow").join(", "));
});

test("a session that ran out is not tried again", async () => {
  let tries = 0;
  await assert.rejects(
    retryOnce("test", async () => {
      tries++;
      throw new LoginExpired("verlopen");
    }),
    LoginExpired,
  );
  assert.equal(tries, 1);
  let second = 0;
  assert.equal(await retryOnce("test", async () => (second++ === 0 ? Promise.reject(new Error("eerste keer")) : "gelukt")), "gelukt");
});
