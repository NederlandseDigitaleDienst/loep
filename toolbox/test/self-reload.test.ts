import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadSampled, measureLoaded, newContext, SELF_NAVIGATION_TRIES } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import { setRunScope } from "../src/session/safety.ts";

// A window that reloads itself as soon as something in it gets focus, as a check against robots reloads
// its window once it is passed. `once` remembers in a cookie that it did, so a second load in the same
// context stays; `always` reloads every time. Focus is what a measurement gives, never a load, so the
// reload falls in the middle of the measurement every time, without depending on timing.
const reloading = (once: boolean): string => `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Venster</title></head>
<body><main><h1>Venster</h1><a href="#verder">Verder</a></main>
<script>
document.addEventListener("focusin", () => {
  if (${once} && document.cookie.includes("passed=1")) return;
  document.cookie = "passed=1; path=/";
  location.reload();
});
</script></body></html>
`;

const host = (window: string): string => `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Pagina</title></head>
<body><main><h1>Pagina</h1><iframe src="${window}" title="Venster" width="400" height="300"></iframe></main></body></html>
`;

// A window that reloads itself on its own without end, as a check against robots does whose cookie never comes back.
const ENDLESS = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Een ogenblik geduld</title></head>
<body><main><h1>Een ogenblik geduld</h1><a href="#verder">Verder</a></main>
<script>setTimeout(() => location.reload(), 20);</script></body></html>
`;

let server: Server;
let origin: string;
let browser: Browser;
const loads = new Map<string, number>();

before(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    loads.set(path, (loads.get(path) ?? 0) + 1);
    const body = path === "/once.html" ? reloading(true) : path === "/always.html" ? reloading(false) : path === "/host-once.html" ? host("/once.html") : path === "/host-always.html" ? host("/always.html") : path === "/endless.html" ? ENDLESS : path === "/host-endless.html" ? host("/endless.html") : null;
    response.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/** A measurement that gives focus and then reads the document, as the walk with Tab does. */
const measure = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    document.querySelector("a")!.focus();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return document.title;
  });

test("an embedded window that reloads itself during the measurement is loaded again in the same context and measured", async () => {
  const item = { url: `${origin}/once.html`, embeddedOn: [`${origin}/host-once.html`] };
  const context = await newContext(browser);
  try {
    await context.addInitScript({ path: INPAGE_PATH });
    // Without measuring it again, the measurement falls into the reload: this is what collect did.
    const { page: first } = await loadSampled(await context.newPage(), item);
    await assert.rejects(measure(first), /Execution context was destroyed|Cannot find context with specified id/);
    await context.clearCookies();
    loads.clear();
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
    let title: string;
    try {
      title = await measureLoaded(item.url, async () => loadSampled(await context.newPage(), item), ({ page, placement }) => {
        assert.equal(placement?.inPlaceOn, item.embeddedOn[0], "measured where it stands");
        return measure(page);
      });
    } finally {
      process.stderr.write = write;
    }
    assert.equal(title, "Venster");
    // The first load, its reload during the measurement, and the load that was measured.
    assert.equal(loads.get("/once.html"), 3);
    assert.equal(lines.filter((line) => line.includes("laadde zichzelf opnieuw tijdens het meten")).length, 1);
  } finally {
    await context.close();
  }
});

test("a window that keeps reloading itself is not measured, and says so in Dutch", async () => {
  const item = { url: `${origin}/always.html`, embeddedOn: [`${origin}/host-always.html`] };
  const context = await newContext(browser);
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    await context.addInitScript({ path: INPAGE_PATH });
    loads.clear();
    await assert.rejects(
      measureLoaded(item.url, async () => loadSampled(await context.newPage(), item), ({ page }) => measure(page)),
      new RegExp(`^Error: de pagina laadde zichzelf tijdens het meten steeds opnieuw, ${SELF_NAVIGATION_TRIES} keer: `),
    );
    assert.equal(loads.get("/host-always.html"), SELF_NAVIGATION_TRIES);
  } finally {
    process.stderr.write = write;
    await context.close();
  }
});

test("a window that reloads itself without end gives the reason in Dutch, within a limited time", async () => {
  const item = { url: `${origin}/endless.html`, embeddedOn: [`${origin}/host-endless.html`] };
  const context = await newContext(browser);
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const began = Date.now();
  try {
    await context.addInitScript({ path: INPAGE_PATH });
    await assert.rejects(
      measureLoaded(item.url, async () => loadSampled(await context.newPage(), item), ({ page }) => measure(page)),
      new RegExp(`^Error: de pagina laadde zichzelf tijdens het meten steeds opnieuw, ${SELF_NAVIGATION_TRIES} keer: `),
    );
    assert.ok(Date.now() - began < 60_000, `took ${Date.now() - began} ms`);
  } finally {
    process.stderr.write = write;
    await context.close();
  }
});

test("an error that is not a navigation is not measured again", async () => {
  let loaded = 0;
  await assert.rejects(
    measureLoaded(
      "http://127.0.0.1/",
      // The same document before and after: nothing navigated.
      async () => (loaded++, { page: { evaluate: async () => 1 } as unknown as Page }),
      () => Promise.reject(new Error("iets anders")),
    ),
    /iets anders/,
  );
  assert.equal(loaded, 1);
});

test("collect measures an embedded window that reloads itself once as the walk with Tab gives it focus", { timeout: 600_000 }, async () => {
  // The reload lands between two calls of the walk: the next call runs in the new document before it has a body.
  const run = mkdtempSync(join(tmpdir(), "loep-self-reload-"));
  const host = `${origin}/host-once.html`;
  const window = `${origin}/once.html`;
  try {
    await writeJson(join(run, "inventory.json"), { baseUrl: host, origin, sitemapUrls: 0, notFoundProbe: `${origin}/404`, pages: [{ url: host }], skipped: [], totals: {} });
    writeFileSync(join(run, "site.json"), JSON.stringify({ version: 1, baseUrl: host, descriptionNl: "Een proefsite.", pageTypes: [{ id: "start", descriptionNl: "Startpagina", representative: host, pages: [host] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] }, null, 2));
    await writeJson(join(run, "site-check.json"), { ok: true, siteSha256: await sha256File(join(run, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
    await writeJson(join(run, "sample.json"), { method: "fixed-list", seed: "seed", populationSize: 1, note: "", items: [{ id: "P1", url: window, embeddedOn: [host], slug: "venster", kind: "embedded", reason: "test", templateHash: "t", contentHash: "c", title: "Venster", status: 200, aliases: [] }] });
    setRunScope(run);
    await collect({ run });
    const facts = await readJson<Record<string, unknown>>(join(run, "pages", "venster", "facts.json"));
    assert.equal(facts.collectError, undefined);
    assert.equal((await readJson<{ inPlaceOn: string | null }>(join(run, "pages", "venster", "probes", "placement.json"))).inPlaceOn, host);
  } finally {
    setRunScope(null);
    rmSync(run, { recursive: true, force: true });
  }
});
