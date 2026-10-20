import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { BrowserContext } from "playwright";
import { PageBusy, PageContexts, SETTLE_ANSWER_MS, withinPageTime } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { contrast, type NotMeasured } from "../src/commands/contrast.ts";
import { inventory } from "../src/commands/inventory.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import type { Facts } from "../src/lib/rundata.ts";
import { pageStampPath } from "../src/lib/sweepstamp.ts";

/** A page whose script keeps the browser busy once it has loaded: nothing in it answers any more (#142). */

let server: Server;
let origin: string;
let scratch: string;

const PAGE = (title: string, body: string, head = ""): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
const BUSY = `<script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 0));</script>`;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-busy-page-"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const html = (status: number, text: string): void => void response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(text);
    if (path === "/") return html(200, PAGE("Start", `<p>Tekst op de pagina.</p><a href="/busy">Bezig</a> <a href="/b">Naar b</a>`));
    if (path === "/busy") return html(200, PAGE("Bezig", "<p>Deze pagina houdt de browser bezig.</p>", BUSY));
    if (path === "/a" || path === "/b") return html(200, PAGE(path.slice(1), "<p>Tekst op de pagina.</p>"));
    html(404, PAGE("Niet gevonden", "<p>Deze pagina bestaat niet.</p>"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

/** The least a run needs for `collect` and `contrast`: the inventory for the scope, a checked site model without blockers, and the sample. */
async function runFor(name: string, paths: string[]): Promise<string> {
  const dir = join(scratch, name);
  const urls = paths.map((path) => `${origin}${path}`);
  await writeJson(join(dir, "inventory.json"), { baseUrl: `${origin}/`, origin, sitemapUrls: 0, notFoundProbe: `${origin}/404`, pages: urls.map((url) => ({ url })), skipped: [], totals: {} });
  writeFileSync(join(dir, "site.json"), JSON.stringify({ version: 1, baseUrl: `${origin}/`, descriptionNl: "Een site om te testen.", pageTypes: [{ id: "tekst", descriptionNl: "Tekstpagina", representative: urls[0], pages: urls }], blockers: [], components: [], processes: [], frames: [], notesNl: [] }, null, 2));
  await writeJson(join(dir, "site-check.json"), { ok: true, siteSha256: await sha256File(join(dir, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
  const items = paths.map((path, index) => ({ id: `P${index + 1}`, url: `${origin}${path}`, slug: path.slice(1), kind: "page", reason: "test", templateHash: "t", contentHash: "c", title: path, status: 200, aliases: [] }));
  await writeJson(join(dir, "sample.json"), { method: "fixed-list", seed: "seed", populationSize: items.length, note: "", items });
  return dir;
}

const BUSY_REASON = new RegExp(`geen antwoord binnen ${SETTLE_ANSWER_MS / 1000} seconden na het laden: een script van de pagina houdt de browser misschien bezig`);

test("work on a page that never answers stops at the time limit: what it ran on is closed and the reason is given", async () => {
  let discarded = false;
  // Like a call to a page: it only ends when the page is closed.
  let close = (): void => undefined;
  const call = (): Promise<never> => new Promise<never>((_, reject) => void (close = () => reject(new Error("Target page, context or browser has been closed"))));
  const started = Date.now();
  await assert.rejects(
    withinPageTime(200, call, async () => {
      discarded = true;
      close();
    }),
    (error: unknown) => error instanceof PageBusy && /^geen antwoord binnen 0.2 seconden: een script van de pagina houdt de browser misschien bezig$/.test(error.message),
  );
  assert.ok(discarded);
  assert.ok(Date.now() - started < 5000);
  // Work that answers in time is left alone, and its own error comes through unchanged.
  assert.equal(await withinPageTime(1000, async () => 7, async () => assert.fail("not discarded")), 7);
  await assert.rejects(withinPageTime(1000, async () => Promise.reject(new Error("eigen fout")), async () => assert.fail("not discarded")), /^Error: eigen fout$/);
});

test("once the time is up, the contexts of a try are closed and no new one is opened", async () => {
  const closed: string[] = [];
  const fake = (name: string) => ({ close: async () => void closed.push(name) }) as unknown as BrowserContext;
  const contexts = new PageContexts();
  contexts.add(fake("eerste"));
  await contexts.closeAll();
  assert.deepEqual(closed, ["eerste"]);
  assert.throws(() => contexts.add(fake("later")), PageBusy);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, ["eerste", "later"]);
});

test("inventory goes on after a page that keeps the browser busy, names it as skipped with the reason, and visits the other pages", { timeout: 300_000 }, async () => {
  const out = join(scratch, "inventory");
  const started = Date.now();
  const found = await inventory({ baseUrl: `${origin}/`, out, maxPages: 10 });
  assert.ok(Date.now() - started < 4 * SETTLE_ANSWER_MS, `took ${Date.now() - started} ms`);
  const busy = found.skipped.find((entry) => entry.url === `${origin}/busy`);
  assert.ok(busy, JSON.stringify(found.skipped));
  assert.match(busy.reason, BUSY_REASON);
  const visited = found.pages.map((page) => new URL(page.url).pathname);
  assert.ok(visited.includes("/") && visited.includes("/b"), visited.join(", "));
  assert.ok(!visited.includes("/busy"));
});

test("collect goes on after a page that keeps the browser busy, notes it as not measured with the reason, and measures the other page", { timeout: 600_000 }, async () => {
  const dir = await runFor("collect", ["/busy", "/a"]);
  await collect({ run: dir });
  const busy = await readJson<Facts>(join(dir, "pages", "busy", "facts.json"));
  assert.match(busy.collectError ?? "", BUSY_REASON);
  assert.ok(!existsSync(pageStampPath(dir, "busy")));
  const measured = await readJson<Facts>(join(dir, "pages", "a", "facts.json"));
  assert.equal(measured.collectError, undefined);
  assert.ok(existsSync(pageStampPath(dir, "a")));
});

test("contrast goes on after a page that keeps the browser busy, names it as not measured with the reason, and measures the other page", { timeout: 600_000 }, async () => {
  const dir = await runFor("contrast", ["/busy", "/a"]);
  const rows = await contrast(dir, { atOnce: 4 });
  assert.deepEqual(rows.filter((row) => row.slug === "busy"), []);
  assert.equal(rows.filter((row) => row.slug === "a").length, 4, "the other page in light and dark, in the default window and at 320 pixels wide");
  const notMeasured = (await readJson<Manifest>(join(dir, "manifest.json"))).steps.at(-1)!.notMeasured as NotMeasured[];
  assert.deepEqual(notMeasured.map((entry) => entry.slug), ["busy", "busy", "busy", "busy"]);
  for (const entry of notMeasured) assert.match(entry.reasonNl, BUSY_REASON);
});
