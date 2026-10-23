import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { heldBackSearchesNl } from "../src/commands/evaluate.ts";
import { requestsSeen, searchesHeldBack } from "../src/commands/explore.ts";
import { sha256 } from "../src/lib/canonical.ts";
import { heldBackSearches, heldBackSearchNl, onReadOrigin, pathMatches, readDecision, readRequestProblems, readRuleFor, READS_REFUSED_LOG, readsAllowedNl, readsForRun, recordReads, refusedCoveredReads, refusedReadsLog, SEARCH_HELD_BACK_NL, setRunReads, type ReadRequest, type RefusedRead } from "../src/lib/reads.ts";
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
  setRunReads([], null);
  await browser.close();
  await site.close();
});

const REASON = "De zoekvraag van het zoekveld gaat naar de zoekdienst, die alleen resultaten teruggeeft.";
const rule = (change: Partial<ReadRequest> = {}): ReadRequest => ({ id: "zoekdienst", method: "POST", origin: "https://zoek.example.nl", path: "/1/indexes/*/queries", service: "algolia", reasonNl: REASON, observation: "verken-0007", ...change });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));
const posts = (): string[] => site.requests.filter((request) => request.method === "POST").map((request) => `${request.host}${request.path}`);
const QUESTION = JSON.stringify({ requests: [{ indexName: "gemeente", params: "query=afval" }] });
const ADDITION = JSON.stringify({ requests: [{ action: "addObject", indexName: "gemeente", body: { titel: "x" } }] });

test("a read request names one origin, a narrow path and the search service whose form its body has", () => {
  const problems = (change: Partial<Record<keyof ReadRequest, unknown>> & Record<string, unknown>): string[] => readRequestProblems({ ...rule(), ...change }, "readRequests[0]");
  assert.deepEqual(problems({}), []);
  // The path need not say it searches: the body says that, request by request.
  for (const path of ["/multi_search", "/_search", "/*/_search", "/_msearch", "/1/indexes/gemeente/query", "/api/zoeken", "/graphql", "/api/v2/vinden", "/indexes/*/search"]) assert.deepEqual(problems({ path }), [], path);
  const refused = (change: Record<string, unknown>, expected: RegExp): void => {
    const found = problems(change);
    assert.ok(found.some((problem) => expected.test(problem)), `expected ${expected} for ${JSON.stringify(change)} in ${JSON.stringify(found)}`);
  };
  refused({ method: "PUT" }, /method moet "POST" zijn/);
  refused({ method: "GET" }, /GET en HEAD gaan al door/);
  refused({ service: "solr" }, /service moet een van typesense, algolia, elasticsearch, meilisearch, graphql zijn/);
  refused({ service: undefined }, /service moet een van/);
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
  // The words in a path stay a brake: a path that says it changes or records something is never a read, whatever its body.
  refused({ path: "/1/indexes/*/batch" }, /bevat "batch"/);
  refused({ path: "/idx/_update_by_query" }, /bevat "update"/);
  refused({ path: "/idx/_delete_by_query" }, /bevat "delete"/);
  refused({ path: "/indexes/*/documents/delete" }, /bevat "documents"/);
  refused({ path: "/search/track" }, /bevat "track"/);
  refused({ path: "/contact/verstuur" }, /bevat "contact"/);
  refused({ reasonNl: "zoeken" }, /reasonNl ontbreekt of is te kort/);
  refused({ observation: "" }, /observation ontbreekt/);
  refused({ body: "x" }, /kent geen veld "body"/);
});

test("a request passes only when a rule covers its address and its body is a question to the service of the rule", () => {
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/gemeente/queries"), true);
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/*/queries"), true, "Algolia writes the asterisk itself");
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes/a/b/queries"), false);
  assert.equal(pathMatches("/1/indexes/*/queries", "/1/indexes//queries"), false);
  assert.equal(pathMatches("/multi_search", "/multi_search/x"), false);
  const rules = [rule()];
  const at = "https://zoek.example.nl/1/indexes/*/queries?x-algolia-agent=a";
  assert.deepEqual(readDecision(rules, "POST", at, {}, QUESTION), { rule: rule(), pass: true }, "the query of the address does not count");
  const disguised = readDecision(rules, "POST", at, {}, ADDITION);
  assert.equal(disguised?.pass, false, "the address of the search with a body that adds something");
  assert.match(disguised!.pass ? "" : disguised!.reasonNl, /^past bij leesverzoek "zoekdienst", maar de body is geen zoekvraag aan Algolia: een vraag in "requests" bevat "action"/);
  assert.equal(readDecision(rules, "POST", at, {}, null)?.pass, false);
  assert.equal(readDecision(rules, "POST", at, {}, JSON.stringify({ searches: [{ collection: "a", q: "x" }] }))?.pass, false, "a question to another service is no question to this one");
  for (const [method, url] of [["POST", "http://zoek.example.nl/1/indexes/g/queries"], ["POST", "https://zoek.example.nl:8443/1/indexes/g/queries"], ["POST", "https://elders.example.nl/1/indexes/g/queries"], ["PUT", at], ["DELETE", at], ["POST", "https://zoek.example.nl/1/indexes/g/batch"]] as const) {
    assert.equal(readDecision(rules, method, url, {}, QUESTION), null, `${method} ${url} is no read request at all`);
  }
  // A preflight has no body; it only asks whether the POST may come, and that POST is judged on its own.
  assert.deepEqual(readDecision(rules, "OPTIONS", at, { "access-control-request-method": "POST" }, null), { rule: rule(), pass: true });
  assert.equal(readDecision(rules, "OPTIONS", at, { "access-control-request-method": "DELETE" }, null), null);
  assert.equal(readRuleFor(rules, "OPTIONS", at), null);
  assert.equal(readDecision([], "POST", at, {}, QUESTION), null);
  assert.equal(readsAllowedNl([]), null);
  assert.equal(readsAllowedNl(rules), `één adres is toegelaten voor leesverzoeken: POST https://zoek.example.nl/1/indexes/*/queries, zoekvraag aan Algolia (${REASON.slice(0, -1)}). Een verzoek daarheen ging alleen door als loep de body herkende als zoekvraag aan die dienst; elk ander verzoek dat iets kan wijzigen is tegengehouden`);
});

test("a rule for an Algolia search covers both search endpoints on every host of the same application, and the body still decides", () => {
  // A site with a rule for the DSN host that later sends its search to the bare host and the endpoint of one index.
  const dsn = rule({ id: "algolia-dsn", origin: "https://ab12cd34ef-dsn.algolia.net", path: "/1/indexes/*/queries" });
  const rules = [dsn];
  const moved = "https://ab12cd34ef.algolia.net/1/indexes/handboek/query";
  const single = JSON.stringify({ params: "query=knop&hitsPerPage=20" });
  assert.deepEqual(readDecision(rules, "POST", moved, {}, single), { rule: dsn, pass: true });
  assert.deepEqual(readDecision(rules, "POST", `${moved}?x-algolia-agent=a`, {}, QUESTION), { rule: dsn, pass: true }, "the form of the body is not tied to the endpoint");
  for (const origin of ["https://ab12cd34ef.algolia.net", "https://ab12cd34ef-dsn.algolia.net", "https://ab12cd34ef-1.algolianet.com", "https://ab12cd34ef-2.algolianet.com", "https://AB12CD34EF-3.algolianet.com"]) {
    for (const path of ["/1/indexes/*/queries", "/1/indexes/handboek/query", "/1/indexes/%2A/query"]) assert.equal(readRuleFor(rules, "POST", `${origin}${path}`)?.id, "algolia-dsn", `${origin}${path}`);
  }
  // A rule on the endpoint of one index covers the other hosts and the endpoint of all indices too.
  assert.equal(readRuleFor([rule({ origin: "https://ab12cd34ef-2.algolianet.com", path: "/1/indexes/handboek/query" })], "POST", "https://ab12cd34ef-dsn.algolia.net/1/indexes/*/queries")?.id, "zoekdienst");
  for (const url of [
    "https://anderapp01.algolia.net/1/indexes/handboek/query",
    "https://anderapp01-dsn.algolia.net/1/indexes/*/queries",
    "https://ab12cd34ef-4.algolianet.com/1/indexes/*/queries",
    "https://ab12cd34ef.algolianet.com/1/indexes/*/queries",
    "https://ab12cd34ef-dsn.algolianet.com/1/indexes/*/queries",
    "https://ab12cd34ef.algolia.net.example.nl/1/indexes/*/queries",
    "https://zoek.ab12cd34ef.algolia.net/1/indexes/*/queries",
    "http://ab12cd34ef.algolia.net/1/indexes/*/queries",
    "https://ab12cd34ef.algolia.net:8443/1/indexes/*/queries",
    "https://ab12cd34ef.algolia.net/1/indexes/handboek/batch",
    "https://ab12cd34ef.algolia.net/1/indexes/handboek/browse",
    "https://ab12cd34ef.algolia.net/1/indexes/handboek/queries",
    "https://ab12cd34ef.algolia.net/1/indexes/a/b/query",
    "https://ab12cd34ef.algolia.net/1/indexes//query",
    "https://ab12cd34ef.algolia.net/1/indexes/handboek/facets/soort/query",
  ]) {
    assert.equal(readRuleFor(rules, "POST", url), null, url);
    assert.equal(readDecision(rules, "POST", url, {}, single), null, `${url} is held back as any write`);
  }
  // The body stays the gate on every covered host.
  const addition = readDecision(rules, "POST", moved, {}, ADDITION);
  assert.equal(addition?.pass, false);
  assert.match(addition!.pass ? "" : addition!.reasonNl, /^past bij leesverzoek "algolia-dsn", maar de body is geen zoekvraag aan Algolia: een vraag in "requests" bevat "action"/);
  assert.equal(readDecision(rules, "POST", moved, {}, JSON.stringify({ objectID: "1", titel: "x" }))?.pass, false);
  assert.equal(readDecision(rules, "POST", moved, {}, null)?.pass, false);
  for (const method of ["PUT", "DELETE", "GET"]) assert.equal(readDecision(rules, method, moved, {}, single), null, method);
  // A preflight to another host of the application behaves as one to the host of the rule.
  assert.deepEqual(readDecision(rules, "OPTIONS", moved, { "access-control-request-method": "POST" }, null), { rule: dsn, pass: true });
  assert.equal(readDecision(rules, "OPTIONS", moved, { "access-control-request-method": "DELETE" }, null), null);
  assert.equal(readRuleFor(rules, "OPTIONS", moved), null);
  // Only a rule for Algolia, on a search endpoint of Algolia, covers more than its own origin and path.
  assert.equal(readRuleFor([{ ...dsn, service: "elasticsearch" }], "POST", "https://ab12cd34ef.algolia.net/1/indexes/*/queries"), null);
  assert.equal(readRuleFor([{ ...dsn, path: "/1/indexes/*/objects" }], "POST", moved), null);
  assert.equal(readRuleFor([rule()], "POST", moved), null, "a rule on a host of its own covers only that host");
  assert.equal(readRuleFor([rule({ origin: "https://zoek.example.nl", path: "/1/indexes/handboek/query" })], "POST", "https://zoek.example.nl/1/indexes/*/queries"), null);
  // Where a redirect after a read may go: the hosts of the application, and for any other rule only its origin.
  assert.equal(onReadOrigin(dsn, "https://ab12cd34ef-1.algolianet.com/elders"), true);
  assert.equal(onReadOrigin(dsn, "https://anderapp01.algolia.net/"), false);
  assert.equal(onReadOrigin(rule(), "https://zoek.example.nl/elders"), true);
  assert.equal(onReadOrigin(rule(), "https://ab12cd34ef.algolia.net/"), false);
});

test("a search question no rule covers is listed per address, and drops out once a rule covers it", () => {
  const blocked = (url: string, search?: string[], reasonNl?: string) => ({ at: "", kind: "method", method: "POST", url, resourceType: "fetch", ...(search ? { search } : {}), ...(reasonNl ? { reasonNl } : {}) });
  const moved = "https://ab12cd34ef.algolia.net/1/indexes/handboek/query";
  const observations = [
    { id: "verken-0006", blocked: [blocked("https://ab12cd34ef-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=a", ["algolia"])] },
    { id: "a-141-0002", blocked: [blocked(`${moved}?q=geheim`, ["algolia"]), blocked("https://elders.example.nl/api", undefined), { ...blocked("https://elders.example.nl/x", ["typesense"]), kind: "scope" }] },
    { id: "a-141-0003", blocked: [blocked(moved, ["algolia"]), blocked("https://zoek.example.nl/graphql", ["algolia", "graphql"])] },
    { id: "a-141-0004" },
  ];
  assert.deepEqual(heldBackSearches(observations, []), [
    { address: moved, services: ["algolia"], count: 2, observation: "a-141-0002" },
    { address: "https://ab12cd34ef-dsn.algolia.net/1/indexes/*/queries", services: ["algolia"], count: 1, observation: "verken-0006" },
    { address: "https://zoek.example.nl/graphql", services: ["algolia", "graphql"], count: 1, observation: "a-141-0003" },
  ]);
  assert.equal(heldBackSearchNl(heldBackSearches(observations, [])[0]!), `POST ${moved}, zoekvraag aan Algolia: 2 keer tegengehouden, het eerst in waarneming a-141-0002`);
  const dsn = rule({ id: "algolia-dsn", origin: "https://ab12cd34ef-dsn.algolia.net", path: "/1/indexes/*/queries" });
  assert.deepEqual(heldBackSearches(observations, [dsn]).map((entry) => entry.address), ["https://zoek.example.nl/graphql"], "the rule covers both addresses of the application");
  // A request a rule covers whose body loep did not recognise needs a form in loep, not a rule.
  const unknownForm = [
    { id: "a-141-0002", blocked: [blocked(moved)] },
    { id: "a-141-0005", blocked: [blocked(moved, undefined, 'past bij leesverzoek "algolia-dsn", maar de body is geen zoekvraag aan Algolia: Algolia kent "query" niet'), blocked("https://elders.example.nl/api")] },
  ];
  assert.deepEqual(refusedCoveredReads(unknownForm, []), []);
  assert.deepEqual(refusedCoveredReads(unknownForm, [dsn]), [{ address: moved, rule: "algolia-dsn", count: 2, observation: "a-141-0002", reasonNl: 'past bij leesverzoek "algolia-dsn", maar de body is geen zoekvraag aan Algolia: Algolia kent "query" niet' }]);
  assert.deepEqual(heldBackSearches(unknownForm, [dsn]), []);
});

test("evaluate tells whoever leads the audit which search questions were held back and what to do", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-evaluate-"));
  try {
    const moved = "https://ab12cd34ef.algolia.net/1/indexes/handboek/query";
    const records = [
      { id: "beoordeel-2.4.5-0003", blocked: [{ kind: "method", method: "POST", url: moved, search: ["algolia"] }] },
      { id: "afmaak-1.4.1-0002", blocked: [{ kind: "method", method: "POST", url: moved }] },
      { id: "beoordeel-1.1.1-0001", blocked: [] },
    ];
    const task = (criterion: string, judge: string, finish?: string) => ({ criterion, judge: { session: judge } as never, verify: null, ...(finish ? { finish: { session: finish } as never } : {}) });
    const tasks = [task("2.4.5", "beoordeel-2.4.5"), task("1.4.1", "beoordeel-1.4.1", "afmaak-1.4.1"), task("1.1.1", "beoordeel-1.1.1")];
    const [uncovered, ...rest] = heldBackSearchesNl(dir, records, tasks, ["1.1.1", "1.4.1", "2.4.5"]);
    assert.equal(rest.length, 0, "without a rule the request with the unknown body is no read request at all");
    assert.equal(uncovered, `LET OP: loep hield zoekvragen tegen omdat geen leesverzoek van het sitemodel hun adres dekt; wat pas na zoeken te zien is, is daar niet gemeten. POST ${moved}, zoekvraag aan Algolia: 1 keer tegengehouden, het eerst in waarneming beoordeel-2.4.5-0003. Draai explore: de verkenner legt het adres vast in readRequests van site.json, met die waarneming, en draait check-site. Zet daarna een nieuwe afmaakronde klaar met tasks --again 2.4.5 en draai opnieuw evaluate.`);
    // Once check-site passed a rule for the application, only the request whose body loep did not recognise is left, and it needs loep.
    const model = JSON.stringify({ version: 1, readRequests: [rule({ id: "algolia-dsn", origin: "https://ab12cd34ef-dsn.algolia.net", path: "/1/indexes/*/queries" })] });
    writeFileSync(join(dir, "site.json"), model);
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: sha256(model) }));
    const lines = heldBackSearchesNl(dir, records, tasks, ["1.1.1", "1.4.1", "2.4.5"]);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^LET OP: loep hield verzoeken tegen naar een adres dat een leesverzoek dekt, omdat het de body niet als zoekvraag herkende\. POST https:\/\/ab12cd34ef\.algolia\.net\/1\/indexes\/handboek\/query \(leesverzoek algolia-dsn\): 1 keer, het eerst in waarneming afmaak-1\.4\.1-0002\. Een regel van de verkenner verandert dat niet\./);
    assert.match(lines[0]!, /toolbox\/src\/lib\/searchbody\.ts, met tests\. Zet daarna een nieuwe afmaakronde klaar met tasks --again 1\.4\.1 en/);
    assert.deepEqual(heldBackSearchesNl(dir, [records[2]!], tasks, ["1.1.1"]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only the read requests of a model that passed check-site and did not change since are let through", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-approved-"));
  try {
    assert.deepEqual(approvedReads(dir), []);
    const model = JSON.stringify({ version: 1, readRequests: [rule(), rule({ id: "breed", path: "/*" }), { ...rule({ id: "zonder-dienst" }), service: undefined }] });
    writeFileSync(join(dir, "site.json"), model);
    assert.deepEqual(approvedReads(dir), [], "not checked");
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: false, siteSha256: sha256(model) }));
    assert.deepEqual(approvedReads(dir), [], "refused by the check");
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: sha256(model) }));
    assert.deepEqual(approvedReads(dir).map((entry) => entry.id), ["zoekdienst"], "a rule that is too wide or names no service is never let through, whatever the check file says");
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
const SEARCHED = "localhost/1/indexes/*/queries";

test("the network filter of the sweep lets exactly the question through, and notes what a rule covered but was no question", async () => {
  site.requests.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "loep-reads-sweep-"));
  try {
    const closed = await searchPage(undefined);
    await closed.fill("#q", "afval");
    await closed.click("#search-send");
    await settle();
    assert.equal(await closed.textContent("#result"), "Zoeken is mislukt");
    assert.deepEqual(posts(), [], "without a rule the question never leaves");
    await closed.context().close();

    setRunReads([], refusedReadsLog(dir, "collect"));
    const open = await searchPage([searchRule()]);
    await open.fill("#q", "afval");
    await open.click("#search-send");
    await open.waitForFunction(() => document.getElementById("result")!.textContent !== "", undefined, { timeout: 5000 });
    assert.equal(await open.textContent("#result"), "3 resultaten voor afval");
    await open.click("#contact-send");
    await open.click("#disguised-send");
    // A POST to the site itself, a POST below the path of the rule and a PUT stay held back.
    const elsewhere = await open.evaluate((origin) => fetch(`${origin}/submit`, { method: "POST", body: "x" }).then(() => "sent", () => "refused"), site.origin);
    const branch = await open.evaluate((origin) => fetch(`${origin}/1/indexes/gemeente/queries/extra`, { method: "POST", body: "x" }).then(() => "sent", () => "refused"), site.otherOrigin);
    const put = await open.evaluate((origin) => fetch(`${origin}/1/indexes/gemeente/queries`, { method: "PUT", body: "x" }).then(() => "sent", () => "refused"), site.otherOrigin);
    await settle();
    assert.deepEqual([elsewhere, branch, put], ["refused", "refused", "refused"]);
    assert.deepEqual(posts(), [SEARCHED], "only the question arrived; the addition to the address of the search did not");
    assert.ok(!site.requests.some((request) => request.method === "PUT"));
    const refusals = readFileSync(join(dir, READS_REFUSED_LOG), "utf8").trim().split("\n").map((line) => JSON.parse(line) as RefusedRead);
    assert.deepEqual(refusals.map((entry) => `${entry.source} ${entry.method} ${entry.address} ${entry.rule}`), [`collect POST ${site.otherOrigin}/1/indexes/*/queries zoekdienst`]);
    assert.match(refusals[0]!.reasonNl, /geen zoekvraag aan Algolia: een vraag in "requests" bevat "action"/);
    assert.ok(!JSON.stringify(refusals).includes("addObject"), "the log never holds the body");
    await open.context().close();
  } finally {
    setRunReads([], null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the network filter of a session lets the question through to a host outside the scope, and records with a reason what it held back", async () => {
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
    await surface.page.click("#disguised-send");
    await settle();
    assert.deepEqual(posts(), [SEARCHED]);
    assert.deepEqual(surface.guard.reads!.map((entry) => `${entry.rule} ${entry.service} ${entry.method} ${entry.url}`), [`zoekdienst algolia POST ${site.otherOrigin}/1/indexes/*/queries`]);
    const held = surface.guard.blocked.filter((entry) => entry.kind === "method");
    assert.deepEqual(held.map((entry) => `${entry.method} ${entry.url}`), [`POST ${site.otherOrigin}/1/indexes/gemeente/batch`, `POST ${site.otherOrigin}/1/indexes/*/queries`]);
    assert.equal(held[0]!.reasonNl, undefined, "a request no rule covers is held back as any write");
    assert.match(held[1]!.reasonNl!, /past bij leesverzoek "zoekdienst", maar de body is geen zoekvraag aan Algolia/);
    await surface.context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session says which held-back request is a search, and lets it through once check-site passed a model with the read request", async () => {
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
    assert.deepEqual(held.blocked, [`method: POST ${site.otherOrigin}/1/indexes/*/queries (zoekvraag: algolia)`]);
    assert.equal(held.search, SEARCH_HELD_BACK_NL, "the answer says why the search was held back and what to do");
    const addition = await loep("click", await ref("css:#disguised-send"));
    assert.deepEqual(addition.blocked, [`method: POST ${site.otherOrigin}/1/indexes/*/queries`], "a body that adds something is not called a search");
    assert.equal(addition.search, undefined);
    assert.deepEqual(posts(), []);
    // The next round of the explorer hears of it, with the observation for its rule.
    writeFileSync(join(dir, "site.json"), JSON.stringify({ version: 1 }));
    assert.deepEqual(await searchesHeldBack(dir), [{ address: `${site.otherOrigin}/1/indexes/*/queries`, services: ["algolia"], count: 1, observation: held.id }]);
    // The explorer records the rule with the observation that shows it; check-site reads what loep recognised there.
    const model = JSON.stringify({ version: 1, readRequests: [{ ...searchRule(), observation: held.id }] });
    writeFileSync(join(dir, "site.json"), model);
    assert.deepEqual(await requestsSeen(dir), { [held.id as string]: [{ method: "POST", url: `${site.otherOrigin}/1/indexes/*/queries`, search: ["algolia"] }] });
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: sha256(model) }));
    await loep("open", "/search-service.html");
    await loep("type", await ref("css:#q"), "search");
    const passed = await loep("click", await ref("css:#search-send"));
    await settle();
    assert.equal(passed.blocked, undefined);
    assert.equal(passed.search, undefined);
    assert.deepEqual(await searchesHeldBack(dir), [], "a rule that passed check-site covers what was held back before");
    assert.deepEqual(passed.read,[`POST ${site.otherOrigin}/1/indexes/*/queries (leesverzoek zoekdienst)`]);
    assert.equal(((await loep("find", "3 resultaten")).found as string[]).length, 1);
    const record = JSON.parse(readFileSync(join(dir, "observations", "verken", `${(passed.id as string).slice(-4)}.json`), "utf8")) as Observation;
    assert.deepEqual(record.reads!.map((entry) => `${entry.rule} ${entry.service}`), ["zoekdienst algolia"]);
    // The same address with a body that adds something stays held back, now with the reason.
    const disguised = await loep("click", await ref("css:#disguised-send"));
    assert.equal((disguised.blocked as string[]).length, 1);
    assert.match((disguised.blocked as string[])[0]!, /^method: POST .*\/1\/indexes\/\*\/queries \(past bij leesverzoek "zoekdienst", maar de body is geen zoekvraag aan Algolia/);
    assert.deepEqual(posts(), [SEARCHED]);
    assert.ok(!existsSync(join(dir, READS_REFUSED_LOG)), "a session records its refusals in its observations");
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
