import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { useFixtureReads } from "../scripts/sweep-check.ts";
import { launchBrowser, loadPage, newContext, settlePage } from "../src/browser/session.ts";
import { EXTRA_FIXED_READS_ENV, extraFixedReadProblems, fixedReadFor, fixedReads, loadFixedReads, setFixedReads } from "../src/lib/reads.ts";
import { setRunScope } from "../src/session/safety.ts";

// The fixture site reads three things that are no plain page: a block of the third party with a GET, a survey of the
// third party that starts with a POST, and a search of the site with a POST in JSON. The sweep loads the block, starts the
// survey only with the fixed read rule of the test server, holds back the visit the survey reports, and holds back the
// search, for which only the site model can have a read rule.
let fixture: FixtureServer;
let dir: string;
let browser: Browser;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "loep-fixture-reads-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(dir, "server.log") });
  browser = await launchBrowser();
});

after(async () => {
  delete process.env[EXTRA_FIXED_READS_ENV];
  setFixedReads(null);
  setRunScope(null);
  await browser.close();
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A run on one variant, as inventory leaves it: the third party is not one of its origins. */
function run(origin: string): string {
  const path = mkdtempSync(join(dir, "run-"));
  writeFileSync(join(path, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, origins: [origin], notFoundProbe: `${origin}/nope`, pages: [{ url: `${origin}/` }] }));
  return path;
}

async function sweepPage(url: string): Promise<Page> {
  const page = await (await newContext(browser, { writes: null })).newPage();
  await loadPage(page, url);
  await settlePage(page);
  return page;
}

/** How often the server answered this path as a read: logged apart from writes. */
const reads = (path: string): number =>
  readFileSync(fixture.logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; path: string }).filter((entry) => entry.kind === "read" && entry.path === path).length;

test("an extra fixed rule names a test server on this machine only, and comes next to the rules of loep", () => {
  const rule = { id: "speler-hier", method: "POST", origin: "http://127.0.0.1:4712", path: "/vragenlijst/start", reasonNl: "De vragenlijst van de testsite haalt hiermee haar vragen op." };
  assert.deepEqual(extraFixedReadProblems(rule, "regel"), []);
  assert.deepEqual(extraFixedReadProblems({ ...rule, origin: "https://localhost:8443" }, "regel"), []);
  assert.match(extraFixedReadProblems({ ...rule, origin: "http://speler.example.nl" }, "regel").join(" "), /alleen een testserver op deze machine/);
  assert.match(extraFixedReadProblems({ ...rule, origin: "https://www.youtube.com" }, "regel").join(" "), /alleen een testserver op deze machine/);
  assert.match(extraFixedReadProblems({ ...rule, path: "/vragenlijst/*" }, "regel").join(" "), /zonder jokerteken/);
  assert.match(extraFixedReadProblems({ ...rule, origin: "ftp://127.0.0.1" }, "regel").join(" "), /origin is precies/);
  // The file of the fixture site passes these checks, and the rules of loep itself keep refusing http.
  assert.equal(loadFixedReads(new URL("../fixtures/fixed-reads.json", import.meta.url).pathname, extraFixedReadProblems).length, 1);
  assert.throws(() => loadFixedReads(new URL("../fixtures/fixed-reads.json", import.meta.url).pathname), /https/);
  const shipped = fixedReads().length;
  process.env[EXTRA_FIXED_READS_ENV] = new URL("../fixtures/fixed-reads.json", import.meta.url).pathname;
  setFixedReads(null);
  try {
    assert.equal(fixedReads().length, shipped + 1);
    assert.equal(fixedReadFor("POST", "http://127.0.0.1:4712/vragenlijst/start")?.id, "testsite-vragenlijst-start");
    assert.equal(fixedReadFor("POST", "http://127.0.0.1:4712/vragenlijst/bezoek"), null);
  } finally {
    delete process.env[EXTRA_FIXED_READS_ENV];
    setFixedReads(null);
  }
});

test("the sweep loads the block of the third party, starts the survey only with the rule of the test server, and holds back the visit and the search", async () => {
  for (const variant of ["defect", "clean"] as const) {
    const origin = fixture.origins[variant];
    setRunScope(run(origin));
    const started = reads("/vragenlijst/start");
    try {
      delete process.env[EXTRA_FIXED_READS_ENV];
      setFixedReads(null);
      const block = await sweepPage(`${origin}/openingstijden.html`);
      assert.equal(await block.locator(".regioblok li").count(), 2, `${variant}: the block of the third party came with a GET`);
      assert.equal(await block.locator(".regioblok img:not([alt])").count(), variant === "defect" ? 2 : 0);

      const without = await sweepPage(`${origin}/veelgestelde-vragen.html`);
      assert.equal(await without.locator(".vragenlijst input").count(), 0, `${variant}: without the rule the survey does not start`);
      assert.equal(reads("/vragenlijst/start"), started);

      useFixtureReads(dir, fixture.origins.thirdParty);
      const survey = await sweepPage(`${origin}/veelgestelde-vragen.html`);
      await survey.locator(".vragenlijst input").first().waitFor();
      assert.equal(await survey.locator(".vragenlijst input[type=radio]").count(), 5, `${variant}: with the rule the survey shows its questions`);
      assert.equal(await survey.locator(".vragenlijst label input").count(), variant === "defect" ? 0 : 5);
      assert.ok(reads("/vragenlijst/start") > started);

      const guide = await sweepPage(`${origin}/afval.html`);
      await guide.getByRole("button", { name: "Weigeren" }).click();
      await guide.locator("#afvalzoeker").fill("batterijen");
      await guide.waitForTimeout(800);
      assert.equal(await guide.locator(".afvalwijzer-resultaten li").count(), 0, `${variant}: the search waits for a read rule of the site model`);
      assert.equal(reads("/zoekdienst/multi_search"), 0);
    } finally {
      delete process.env[EXTRA_FIXED_READS_ENV];
      setFixedReads(null);
      setRunScope(null);
    }
  }
  assert.deepEqual(fixture.writes(), [], "the visit of the survey and the search were held back");
});

test("the server answers the search of the waste guide and the start of the survey as reads, and a visit as a write", async () => {
  const before = fixture.writes().length;
  const search = await fetch(`${fixture.origins.defect}/zoekdienst/multi_search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ searches: [{ collection: "afvalwijzer", q: "batt", query_by: "naam" }] }) });
  const found = (await search.json()) as { results: { found: number; hits: { document: { naam: string } }[] }[] };
  assert.deepEqual([found.results[0]!.found, found.results[0]!.hits.map((hit) => hit.document.naam)], [1, ["Batterijen"]]);
  const preflight = await fetch(`${fixture.origins.thirdParty}/vragenlijst/start`, { method: "OPTIONS", headers: { origin: fixture.origins.clean, "access-control-request-method": "POST" } });
  assert.deepEqual([preflight.status, preflight.headers.get("access-control-allow-origin")], [204, "*"]);
  const start = await fetch(`${fixture.origins.thirdParty}/vragenlijst/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vragenlijst: "m3" }) });
  assert.match(((await start.json()) as { html: string }).html, /<label class="vl-keuze">/);
  assert.equal((await fetch(`${fixture.origins.thirdParty}/vragenlijst/start`, { method: "POST", body: JSON.stringify({ vragenlijst: "../x" }) })).status, 404);
  assert.equal(fixture.writes().length, before, "a read is no write");
  await fetch(`${fixture.origins.thirdParty}/vragenlijst/bezoek`, { method: "POST", body: "{}" });
  assert.deepEqual(fixture.writes().slice(before).map((entry) => entry.path), ["/vragenlijst/bezoek"]);
});
