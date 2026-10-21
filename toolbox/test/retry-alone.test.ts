import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { collect } from "../src/commands/collect.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import type { Facts } from "../src/lib/rundata.ts";

/**
 * With more pages at once, a page that failed is tried again alone: after the pages that were being
 * measured are done, and before a new one starts. On a loaded machine the first try can fail because
 * of the other pages (no answer in time, a crashed renderer); the second try then has the machine to itself.
 */

let server: Server;
let origin: string;
let scratch: string;
/** Every request for a page, in the order the server got them. */
const requests: string[] = [];

const PAGE = (title: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>Tekst op de pagina.</p></main></body></html>`;
const PATHS = ["/een", "/twee", "/mislukt", "/later"];

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-retry-alone-"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!PATHS.includes(path)) return void response.writeHead(404).end();
    requests.push(path);
    // The first load of `/mislukt` fails: an answer that is no HTTP, which the browser does not try again by itself.
    if (path === "/mislukt" && requests.filter((entry) => entry === path).length === 1) return void request.socket.end("geen http\r\n\r\n");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE(path.slice(1)));
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

test("collect with three at once tries a page that failed again alone, after the pages that ran and before the next one", { timeout: 600_000 }, async () => {
  const dir = await runFor(PATHS);
  await collect({ run: dir, atOnce: 3 });

  for (const path of PATHS) assert.equal((await readJson<Facts>(join(dir, "pages", path.slice(1), "facts.json"))).collectError, undefined, `${path} measured`);
  const of = (path: string): number[] => requests.flatMap((entry, at) => (entry === path ? [at] : []));
  const [second, last] = [of("/mislukt")[1]!, of("/mislukt").at(-1)!];
  assert.ok(second !== undefined, "the page that failed was asked for again");
  // The pages that ran next to the first try were done before the second try began.
  assert.deepEqual([...of("/een"), ...of("/twee")].filter((at) => at > second), [], requests.join(" "));
  // The next page began after the second try.
  assert.ok(of("/later").length > 0 && of("/later").every((at) => at > last), requests.join(" "));
});
