import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as forward, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { launchBrowser, newContext } from "../src/browser/session.ts";
import { inventory, type Inventory } from "../src/commands/inventory.ts";
import { excludedBy, excludedPathNl, excludedPathsOfRun, parseExcludedPath } from "../src/lib/origins.ts";
import { excludedPageNl, guardContext, scopeForRun, setRunScope, type Guard } from "../src/session/safety.ts";

const site = "https://platform.example";

test("an excluded path is an origin of the site and a path, and a page is below it by whole segments", () => {
  assert.equal(parseExcludedPath("/gebruikers/", [site]), `${site}/gebruikers`);
  assert.equal(parseExcludedPath("https://docs.platform.example/archief", [site, "https://docs.platform.example"]), "https://docs.platform.example/archief");
  assert.throws(() => parseExcludedPath("/", [site]), /hele origin/);
  assert.throws(() => parseExcludedPath("gebruikers", [site]), /begint niet met/);
  assert.throws(() => parseExcludedPath("https://elders.example/a", [site]), /niet op een origin van de site/);
  assert.throws(() => parseExcludedPath("/a?b=1", [site]), /vraag of anker/);
  assert.deepEqual(excludedPathsOfRun([site], ["/gebruikers", "/gebruikers/"]), [`${site}/gebruikers`], "each once");

  const excluded = [`${site}/gebruikers`, `${site}/*/*`];
  assert.equal(excludedBy(`${site}/gebruikers`, excluded), `${site}/gebruikers`);
  assert.equal(excludedBy(`${site}/gebruikers/`, excluded), `${site}/gebruikers`);
  assert.equal(excludedBy(`${site}/gebruikers/iemand?tab=1`, excluded), `${site}/gebruikers`);
  assert.equal(excludedBy(`${site}/gebruikersvoorwaarden`, excluded), null, "a path that only starts with the same letters is not below it");
  assert.equal(excludedBy(`${site}/eigenaar/repository`, excluded), `${site}/*/*`, "a * is one segment");
  assert.equal(excludedBy(`${site}/eigenaar/repository/issues`, excluded), `${site}/*/*`);
  assert.equal(excludedBy(`${site}/eigenaar/`, excluded), null, "one segment deep is not two");
  assert.equal(excludedBy(`${site}/over`, excluded), null);
  assert.equal(excludedBy("https://elders.example/gebruikers", excluded), null, "another origin has its own paths");
  assert.equal(excludedBy(`${site}/gebruikers`, []), null, "a run without excluded paths leaves everything in");
});

test("the scope of the report names an excluded path as a choice of scope, with what the inventory found there", () => {
  assert.equal(excludedPathNl(`${site}/gebruikers`, 12), `Pagina's onder ${site}/gebruikers, die bij het begin van het onderzoek buiten de afbakening zijn gehouden. De inventarisatie vond er 12 adressen en opende er geen.`);
  assert.match(excludedPathNl(`${site}/*/*`, 1), /Een \* staat voor één deel van het pad\. De inventarisatie vond er 1 adres en/);
  assert.match(excludedPathNl(`${site}/leeg`, 0), /vond er geen adres\.$/);
});

let fixture: FixtureServer;
let proxy: Server;
let origin: string;
let scratch: string;
/** Every request that reached the test site through the proxy, as method and path. */
const asked: { method: string; path: string }[] = [];

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-exclude-path-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  // The test site logs only what is sent; this proxy in front of it notes every request, also a GET or a HEAD.
  const target = new URL(fixture.origins.defect);
  proxy = createServer((incoming, outgoing) => {
    asked.push({ method: incoming.method ?? "GET", path: new URL(incoming.url ?? "/", "http://x").pathname });
    const upstream = forward({ host: target.hostname, port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    });
    upstream.on("error", () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => void proxy.close(() => resolve()));
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

const below = (path: string): boolean => path.startsWith("/nieuws") || path.startsWith("/documenten");

test("no step of the run opens a page below an excluded path, and the inventory counts what it found there", async (context) => {
  const run = join(scratch, "run");
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 40, excludePaths: ["/nieuws", "/documenten/"] });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  const paths = found.pages.map((page) => new URL(page.url).pathname);
  assert.ok(paths.includes("/") && paths.includes("/contact.html"), "the rest of the site is there");
  assert.deepEqual(paths.filter(below), [], "no page below an excluded path is in the inventory");
  assert.deepEqual((found.documents ?? []).map((each) => each.url).filter((url) => below(new URL(url).pathname)), [], "nor a document");
  assert.deepEqual(asked.filter((entry) => below(entry.path)), [], "and nothing below one was asked for, not even its size");
  assert.deepEqual(found.excludedPaths!.map((each) => each.path), [`${origin}/nieuws`, `${origin}/documenten`]);
  assert.ok(found.excludedPaths!.every((each) => each.found > 0), JSON.stringify(found.excludedPaths));
  const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")) as { steps: { command: string; excludedPaths?: string[] }[] };
  assert.deepEqual(manifest.steps.find((step) => step.command === "inventory")!.excludedPaths, [`${origin}/nieuws`, `${origin}/documenten`], "the run keeps the boundary where it keeps its origins");

  // A session of an agent opens no page there, and says why.
  const scope = await scopeForRun(run, {});
  assert.ok(excludedPageNl(scope, `${origin}/nieuws/zomerfeest.html`)?.startsWith("buiten de afbakening"));
  assert.equal(excludedPageNl(scope, `${origin}/contact.html`), null);
  const browser = await launchBrowser();
  try {
    const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
    const session = await newContext(browser, { writes: null });
    await guardContext(session, scope, guard);
    const page = await session.newPage();
    const before = asked.length;
    // A refused navigation is answered with no content, which the browser reports as an aborted navigation.
    await page.goto(`${origin}/nieuws/zomerfeest.html`).catch(() => null);
    await page.goto(`${origin}/contact.html`);
    assert.deepEqual(asked.slice(before).filter((entry) => below(entry.path)), [], "the session asked nothing below the excluded path");
    assert.ok(guard.blocked.some((entry) => entry.kind === "scope" && entry.url === `${origin}/nieuws/zomerfeest.html` && /buiten de afbakening/.test(entry.reasonNl ?? "")), JSON.stringify(guard.blocked));
    await session.close();

    // Nor does a command of the sweep.
    setRunScope(run);
    const sweep = await newContext(browser, { writes: null });
    const swept = await sweep.newPage();
    const sweptBefore = asked.length;
    await swept.goto(`${origin}/documenten/begroting-2027.pdf`).catch(() => null);
    await swept.goto(`${origin}/afval.html`);
    assert.deepEqual(asked.slice(sweptBefore).filter((entry) => below(entry.path)), [], "the sweep asked nothing below the excluded path");
    assert.ok(asked.slice(sweptBefore).some((entry) => entry.path === "/afval.html"), "a page of the run it opens");
    await sweep.close();
  } finally {
    setRunScope(null);
    await browser.close();
  }
});

test("a run without excluded paths has none in its inventory, its scope or its sweep", async (context) => {
  const run = join(scratch, "without");
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 40 });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  assert.ok(!("excludedPaths" in found));
  assert.ok(found.pages.some((page) => new URL(page.url).pathname.startsWith("/nieuws/")), "the news is part of the site");
  assert.ok(!("excludedPaths" in (await scopeForRun(run, {}))));
});

test("the start address may not lie below an excluded path", async () => {
  await assert.rejects(inventory({ baseUrl: `${origin}/nieuws/`, out: join(scratch, "start"), maxPages: 5, excludePaths: ["/nieuws"] }), /startadres .* ligt onder --exclude-path/);
});
