import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { requestsSeen } from "../src/commands/explore.ts";
import { sha256 } from "../src/lib/canonical.ts";
import { pathMatches, readRequestProblems, readRuleFor, readsAllowedNl, readsForRun, recordReads, type ReadRequest } from "../src/lib/reads.ts";
import { approvedReads } from "../src/lib/sitemodel.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness, scopeForRun } from "../src/session/safety.ts";
import { openSurface } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let browser: Browser;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await site.close();
});

const REASON = "De zoekvraag van het zoekveld gaat naar de zoekdienst, die alleen resultaten teruggeeft.";
const rule = (change: Partial<ReadRequest> = {}): ReadRequest => ({ id: "zoekdienst", method: "POST", origin: "https://zoek.example.nl", path: "/1/indexes/*/queries", reasonNl: REASON, observation: "verken-0007", ...change });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));
const posts = (): string[] => site.requests.filter((request) => request.method === "POST").map((request) => `${request.host}${request.path}`);

test("a read request names one origin and a narrow path of a search service, with a reason and an observation", () => {
  const problems = (change: Partial<Record<keyof ReadRequest, unknown>> & Record<string, unknown>): string[] => readRequestProblems({ ...rule(), ...change }, "readRequests[0]");
  assert.deepEqual(problems({}), []);
  for (const path of ["/multi_search", "/collections/producten/documents/search", "/_search", "/*/_search", "/_msearch", "/1/indexes/gemeente/query", "/api/zoeken", "/multi-search", "/suggest"]) assert.deepEqual(problems({ path }), [], path);
  const refused = (change: Record<string, unknown>, expected: RegExp): void => {
    const found = problems(change);
    assert.ok(found.some((problem) => expected.test(problem)), `expected ${expected} for ${JSON.stringify(change)} in ${JSON.stringify(found)}`);
  };
  refused({ method: "PUT" }, /method moet "POST" zijn/);
  refused({ method: "GET" }, /GET en HEAD gaan al door/);
  refused({ origin: "https://zoek.example.nl/" }, /alleen schema, host en poort/);
  refused({ origin: "https://*.example.nl" }, /origin/);
  refused({ origin: "zoek.example.nl" }, /geen adres met http/);
  // A wildcard never opens a whole origin or a branch of it.
  refused({ path: "/*" }, /eindigt op een jokerteken/);
  refused({ path: "/api/*" }, /eindigt op een jokerteken/);
  refused({ path: "/**/search" }, /alleen een jokerteken hebben als heel deel/);
  refused({ path: "/search*" }, /alleen een jokerteken hebben als heel deel/);
  refused({ path: "/*/*/search" }, /meer dan één jokerteken/);
  refused({ path: "/1/indexes/*/queries?x=1" }, /zonder query/);
  refused({ path: "multi_search" }, /begint met een schuine streep/);
  refused({ path: "/zoeken/" }, /leeg deel/);
  // A path that says it changes or records something stays held back, also when it mentions searching.
  refused({ path: "/1/indexes/*/batch" }, /bevat "batch"/);
  refused({ path: "/idx/_update_by_query" }, /bevat "update"/);
  refused({ path: "/graphql" }, /bevat "graphql"/);
  refused({ path: "/search/track" }, /bevat "track"/);
  refused({ path: "/contact/verstuur" }, /bevat "contact"/);
  // Anything that is not recognisably a search is not a read request at all.
  refused({ path: "/wp-admin/admin-ajax.php" }, /niet herkenbaar als zoekvraag/);
  refused({ reasonNl: "zoeken" }, /reasonNl ontbreekt of is te kort/);
  refused({ observation: "" }, /observation ontbreekt/);
  refused({ body: "x" }, /kent geen veld "body"/);
});

test("a rule matches its method, origin and path, a wildcard one segment, and a preflight for it", () => {
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/gemeente/queries"), true);
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/*/queries"), true, "Algolia writes the asterisk itself");
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/a/b/queries"), false);
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes//queries"), false);
  assert.equal(pathMatches("/multi_search", "/multi_search/x"), false);
  const rules = [rule()];
  assert.equal(readRuleFor(rules, "POST", "https://zoek.example.nl/1/indexes/gemeente/queries?x-algolia-agent=a")?.id, "zoekdienst", "the query does not count");
  assert.equal(readRuleFor(rules, "POST", "http://zoek.example.nl/1/indexes/gemeente/queries"), null, "another scheme is another origin");
  assert.equal(readRuleFor(rules, "POST", "https://zoek.example.nl:8443/1/indexes/gemeente/queries"), null);
  assert.equal(readRuleFor(rules, "POST", "https://elders.example.nl/1/indexes/gemeente/queries"), null);
  assert.equal(readRuleFor(rules, "PUT", "https://zoek.example.nl/1/indexes/gemeente/queries"), null);
  assert.equal(readRuleFor(rules, "DELETE", "https://zoek.example.nl/1/indexes/gemeente/queries"), null);
  assert.equal(readRuleFor(rules, "POST", "https://zoek.example.nl/1/indexes/gemeente/batch"), null);
  assert.equal(readRuleFor(rules, "OPTIONS", "https://zoek.example.nl/1/indexes/gemeente/queries", { "access-control-request-method": "POST" })?.id, "zoekdienst");
  assert.equal(readRuleFor(rules, "OPTIONS", "https://zoek.example.nl/1/indexes/gemeente/queries", { "access-control-request-method": "DELETE" }), null);
  assert.equal(readRuleFor(rules, "OPTIONS", "https://zoek.example.nl/1/indexes/gemeente/queries"), null);
  assert.equal(readRuleFor([], "POST", "https://zoek.example.nl/1/indexes/gemeente/queries"), null);
  assert.equal(readsAllowedNl([]), null);
  assert.equal(readsAllowedNl(rules), `één verzoek is toegelaten als leesverzoek, omdat de verkenner in een waarneming liet zien dat het een zoekvraag is die niets wijzigt: POST https://zoek.example.nl/1/indexes/*/queries (${REASON.slice(0, -1)}). Elk ander verzoek dat iets kan wijzigen is tegengehouden`);
});

test("only the read requests of a model that passed check-site and did not change since are let through", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-approved-"));
  try {
    assert.deepEqual(approvedReads(dir), []);
    const model = JSON.stringify({ version: 1, readRequests: [rule(), rule({ id: "breed", path: "/*" })] });
    writeFileSync(join(dir, "site.json"), model);
    assert.deepEqual(approvedReads(dir), [], "not checked");
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: false, siteSha256: sha256(model) }));
    assert.deepEqual(approvedReads(dir), [], "refused by the check");
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: sha256(model) }));
    assert.deepEqual(approvedReads(dir).map((entry) => entry.id), ["zoekdienst"], "a rule that is too wide is never let through, whatever the check file says");
    writeFileSync(join(dir, "site.json"), model.replace("queries", "query"));
    assert.deepEqual(approvedReads(dir), [], "changed after the check");
    // The manifest keeps what was let through, for the report.
    await recordReads(dir, [rule()]);
    assert.deepEqual(readsForRun(dir), [rule()]);
    await recordReads(dir, []);
    assert.deepEqual(readsForRun(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function searchPage(reads: ReadRequest[] | undefined): Promise<Page> {
  const context = await newContext(browser, { writes: null, ...(reads ? { reads } : {}) });
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}/search-service.html`);
  return page;
}

const searchRule = (): ReadRequest => rule({ origin: site.otherOrigin, path: "/1/indexes/*/queries" });

test("the network filter of the sweep lets exactly the read request through and holds back every other write", async () => {
  site.requests.length = 0;
  const closed = await searchPage(undefined);
  await closed.fill("#q", "afval");
  await closed.click("#search-send");
  await settle();
  assert.equal(await closed.textContent("#result"), "Zoeken is mislukt");
  assert.deepEqual(posts(), [], "without a rule the question never leaves");
  await closed.context().close();

  const open = await searchPage([searchRule()]);
  await open.fill("#q", "afval");
  await open.click("#search-send");
  await open.waitForFunction(() => document.getElementById("result")!.textContent !== "", undefined, { timeout: 5000 });
  assert.equal(await open.textContent("#result"), "3 resultaten voor afval");
  await open.click("#contact-send");
  // A POST to another path of the same service, and a form to the site itself, stay held back.
  const elsewhere = await open.evaluate((origin) => fetch(`${origin}/submit`, { method: "POST", body: "x" }).then(() => "sent", () => "refused"), site.origin);
  const branch = await open.evaluate((origin) => fetch(`${origin}/1/indexes/gemeente/queries/extra`, { method: "POST", body: "x" }).then(() => "sent", () => "refused"), site.otherOrigin);
  const put = await open.evaluate((origin) => fetch(`${origin}/1/indexes/gemeente/queries`, { method: "PUT", body: "x" }).then(() => "sent", () => "refused"), site.otherOrigin);
  await settle();
  assert.deepEqual([elsewhere, branch, put], ["refused", "refused", "refused"]);
  assert.deepEqual(posts(), ["localhost/1/indexes/gemeente/queries"]);
  assert.ok(!site.requests.some((request) => request.method === "PUT"));
  await open.context().close();
});

test("the network filter of a session lets the read request through to a host outside the scope, and records it as a read", async () => {
  site.requests.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-surface-"));
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0), reads: [searchRule()] };
    const { surface } = await openSurface(env, { url: `${site.origin}/search-service.html`, width: 1280, height: 800, scheme: "light" });
    await surface.page.fill("#q", "afval");
    await surface.page.click("#search-send");
    await surface.page.waitForFunction(() => document.getElementById("result")!.textContent !== "", undefined, { timeout: 5000 });
    assert.equal(await surface.page.textContent("#result"), "3 resultaten voor afval");
    await surface.page.click("#contact-send");
    await settle();
    assert.deepEqual(posts(), ["localhost/1/indexes/gemeente/queries"]);
    assert.deepEqual(surface.guard.reads!.map((entry) => `${entry.rule} ${entry.method} ${entry.url}`), [`zoekdienst POST ${site.otherOrigin}/1/indexes/gemeente/queries`]);
    assert.deepEqual(surface.guard.blocked.filter((entry) => entry.kind === "method").map((entry) => `${entry.method} ${entry.url}`), [`POST ${site.otherOrigin}/1/indexes/gemeente/batch`]);
    await surface.context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session holds the search back until check-site passed a model with the read request, and lets it through from the next page on", async () => {
  site.requests.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-session-"));
  const daemon = await Daemon.create(dir, await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session: "verken", command, args, options: {} })).print;
  const ref = async (query: string): Promise<string> => ((await loep("find", query)).found as string[])[0]!.split(" ")[0]!;
  try {
    await daemon.handle({ op: "start", session: "verken" });
    await loep("open", "/search-service.html");
    await loep("type", await ref("css:#q"), "search");
    const held = await loep("click", await ref("css:#search-send"));
    assert.deepEqual(held.blocked, [`method: POST ${site.otherOrigin}/1/indexes/gemeente/queries`]);
    assert.deepEqual(posts(), []);
    // The explorer records the rule with the observation that shows it; the check passes the model as it is.
    const model = JSON.stringify({ version: 1, readRequests: [{ ...searchRule(), observation: held.id }] });
    writeFileSync(join(dir, "site.json"), model);
    // What check-site reads from that observation to see the rule is not made up.
    assert.deepEqual(await requestsSeen(dir), { [held.id as string]: [{ method: "POST", url: `${site.otherOrigin}/1/indexes/gemeente/queries` }] });
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: sha256(model) }));
    await loep("open", "/search-service.html");
    await loep("type", await ref("css:#q"), "search");
    const passed = await loep("click", await ref("css:#search-send"));
    await settle();
    assert.equal(passed.blocked, undefined);
    assert.deepEqual(passed.read, [`POST ${site.otherOrigin}/1/indexes/gemeente/queries (leesverzoek zoekdienst)`]);
    assert.equal(((await loep("find", "3 resultaten")).found as string[]).length, 1);
    const record = JSON.parse(readFileSync(join(dir, "observations", "verken", `${(passed.id as string).slice(-4)}.json`), "utf8")) as Observation;
    assert.deepEqual(record.reads!.map((entry) => entry.rule), ["zoekdienst"]);
    // The other POST of the same page stays held back.
    const other = await loep("click", await ref("css:#contact-send"));
    assert.deepEqual(other.blocked, [`method: POST ${site.otherOrigin}/1/indexes/gemeente/batch`]);
    assert.deepEqual(posts(), ["localhost/1/indexes/gemeente/queries"]);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
