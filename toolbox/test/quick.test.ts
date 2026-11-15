import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { quick } from "../src/commands/quick.ts";
import { buildQuickSummary, compareQuick, elementMark, groupedChangesNl, QUICK_MARK_FILE, quickComparisonMarkdown, quickFindings, quickSignals, quickSummaryMarkdown, type GroupedElement, type QuickPage, type QuickSummary } from "../src/lib/quick.ts";

const element = (criterion: string, where: string, verdicts: Record<string, string>): GroupedElement => ({
  criterion,
  where,
  message: `melding bij ${where}`,
  verdicts,
  rules: Object.fromEntries(Object.entries(verdicts).filter(([, verdict]) => verdict === "failed").map(([engine]) => [engine, [`regel-${criterion}`]])),
});

/** A page whose engines gave the opening tag of an element with its selector, as axe-core, IBM and QualWeb do. */
const withTags = (measured: QuickPage, tags: Record<string, string>): QuickPage => ({
  ...measured,
  measurements: measured.measurements.map((measurement) => ({ ...measurement, rules: { ...measurement.rules, methods: [{ implementation: "axe-core", version: "4.14.0", result: { findings: Object.entries(tags).map(([where, html]) => ({ where, html })) } }] } })),
});

const page = (url: string, light: GroupedElement[], dark: GroupedElement[] = light, layout: Partial<Pick<QuickPage, "reflow" | "zoom">> = {}): QuickPage => ({
  url,
  title: "Pagina",
  httpStatus: 200,
  screenshot: null,
  reflow: layout.reflow ?? { horizontalScroll: false, offenders: 0 },
  zoom: layout.zoom ?? { horizontalScroll: false, offenders: 0 },
  measurements: [
    { scheme: "light", observation: "quick-0001", reasonNl: null, rules: { methods: [{ implementation: "axe-core", version: "4.14.0" }, { implementation: "accessibility-checker-engine", version: "4.0.34" }], grouped: { elements: light } } },
    { scheme: "dark", observation: "quick-0002", reasonNl: null, rules: { grouped: { elements: dark } } },
  ],
});

const summaryOf = (pages: QuickPage[], site = "https://voorbeeld.test/"): QuickSummary =>
  buildQuickSummary({ site, startedAt: "2026-11-15T10:00:00.000Z", finishedAt: "2026-11-15T10:01:00.000Z", maxPages: 15, pagesFound: pages.length, pageLimitReached: false, planned: pages.length, pages });

test("a place counts once over light and dark, and failing in one scheme is failing", () => {
  const findings = quickFindings([
    page(
      "https://voorbeeld.test/",
      [element("1.4.3", "main > p", { "axe-core": "passed", alfa: "passed" }), element("4.1.2", "nav > a", { "axe-core": "failed", alfa: "failed" })],
      [element("1.4.3", "main > p", { "axe-core": "failed", alfa: "passed" }), element("4.1.2", "nav > a", { "axe-core": "failed", alfa: "failed" })],
    ),
  ]);
  assert.equal(findings.length, 2);
  const [agreed, contrast] = findings;
  assert.deepEqual([agreed!.criterion, agreed!.agreement, agreed!.schemes], ["4.1.2", "agreed", ["light", "dark"]]);
  // Alfa passed the paragraph in both schemes and axe-core failed it in dark: a contradiction, seen in dark only.
  assert.deepEqual([contrast!.criterion, contrast!.agreement, contrast!.schemes, contrast!.engines], ["1.4.3", "contradicted", ["dark"], ["axe-core"]]);
});

test("the strongest ground of a criterion comes first, and a layout probe is a ground of its own", () => {
  const pages = [
    page("https://voorbeeld.test/", [element("2.4.4", "a.meer", { "axe-core": "failed", alfa: "failed" }), element("1.3.1", "table", { qualweb: "failed" })], undefined, { reflow: { horizontalScroll: true, offenders: 2 } }),
    page("https://voorbeeld.test/contact", [element("1.3.1", "ul", { qualweb: "failed" })]),
  ];
  const signals = quickSignals(pages, quickFindings(pages));
  assert.deepEqual(signals.map((signal) => [signal.criterion, signal.ground, signal.pages]), [["2.4.4", "engines-agree", 1], ["1.4.10", "layout-probe", 1], ["1.3.1", "engine-alone", 2]]);
  assert.match(signals[1]!.sentenceNl, /Bij 320 pixels breed valt er inhoud buiten beeld op 1 pagina\./);
  assert.match(signals[2]!.sentenceNl, /Eén meetprogramma keurt 2 plekken af, op 2 pagina's/);
});

test("the summary leaves AAA out, names the engines and says what it is not", () => {
  const summary = summaryOf([page("https://voorbeeld.test/", [element("1.4.6", "p", { "axe-core": "failed", alfa: "failed" }), element("1.4.3", "p", { "axe-core": "failed", alfa: "failed" })])]);
  assert.deepEqual(summary.signals.map((signal) => signal.criterion), ["1.4.3"]);
  assert.deepEqual(summary.engines, [{ id: "axe-core", version: "4.14.0" }, { id: "ibm", version: "4.0.34" }]);
  assert.deepEqual(summary.counts, [{ path: "/", criterion: "1.4.3", rule: "alfa:regel-1.4.3", element: "p", places: 1 }, { path: "/", criterion: "1.4.3", rule: "axe-core:regel-1.4.3", element: "p", places: 1 }]);
  assert.equal(summary.partial, false);
  const text = quickSummaryMarkdown(summary);
  assert.match(text, /geen oordeel over toegankelijkheid/);
  assert.match(text, /## Niet gemeten/);
  assert.doesNotMatch(text, /—/);
});

test("a page that could not be measured makes the summary partial", () => {
  const broken: QuickPage = { ...page("https://voorbeeld.test/stuk", []), measurements: [{ scheme: "light", observation: null, reasonNl: "openen mislukt: time-out", rules: null }, { scheme: "dark", observation: null, reasonNl: "openen mislukt: time-out", rules: null }] };
  const summary = summaryOf([page("https://voorbeeld.test/", []), broken]);
  assert.equal(summary.partial, true);
  assert.deepEqual([summary.coverage.measured, summary.coverage.failed], [1, 1]);
  assert.deepEqual(summary.pages[1]!.reasonsNl, ["licht: openen mislukt: time-out", "donker: openen mislukt: time-out"]);
});

test("the same outcome on another origin is no change, so a preview compares with the live site", () => {
  const elements = [element("2.4.4", "a.meer", { "axe-core": "failed", alfa: "failed" })];
  const comparison = compareQuick(summaryOf([page("https://voorbeeld.test/nieuws?p=2", elements)]), summaryOf([page("http://localhost:8080/nieuws?p=2", elements)], "http://localhost:8080/"));
  assert.equal(comparison.ok, true);
  assert.deepEqual([comparison.worse, comparison.better, comparison.notMeasured, comparison.newPages], [[], [], [], []]);
  assert.match(quickComparisonMarkdown(comparison), /Niets is veranderd/);
});

test("a place more under a rule is worse, a place fewer is better, and a false alarm in both stops nothing", () => {
  const alarm = element("1.3.1", "table", { qualweb: "failed" });
  const before = summaryOf([page("https://voorbeeld.test/", [alarm, element("2.4.4", "a.meer", { "axe-core": "failed" })])]);
  const after = summaryOf([page("https://voorbeeld.test/", [alarm, element("1.4.3", "p.klein", { "axe-core": "failed", alfa: "failed" }), element("1.4.3", "p.grijs", { "axe-core": "failed", alfa: "failed" })], undefined, { reflow: { horizontalScroll: false, offenders: 3 } })]);
  const comparison = compareQuick(before, after);
  assert.equal(comparison.ok, false);
  assert.deepEqual(comparison.worse.map((change) => [change.criterion, change.rule, change.element, change.before, change.now]), [
    ["1.4.3", "alfa:regel-1.4.3", "p.grijs", 0, 1],
    ["1.4.3", "alfa:regel-1.4.3", "p.klein", 0, 1],
    ["1.4.3", "axe-core:regel-1.4.3", "p.grijs", 0, 1],
    ["1.4.3", "axe-core:regel-1.4.3", "p.klein", 0, 1],
    ["1.4.10", "reflow", "", 0, 3],
  ]);
  assert.deepEqual(comparison.better.map((change) => [change.criterion, change.before, change.now]), [["2.4.4", 1, 0]]);
  assert.deepEqual(groupedChangesNl(comparison.worse), ["/: 1.4.3 Contrast (minimum), 2 plekken erbij volgens 2 meetprogramma's. Het gaat om `p.grijs`, `p.klein`.", "/: 1.4.10 Reflow, 3 plekken erbij volgens de proef op 320 pixels breed."]);
  // Better alone never stops a pipeline.
  assert.equal(compareQuick(after, before).ok, false);
  assert.equal(compareQuick(before, summaryOf([page("https://voorbeeld.test/", [alarm])])).ok, true);
});

test("the mark of an element says what it is and where on the page, not which one in a row it is", () => {
  assert.equal(elementMark("#top > div:nth-of-type(1) > footer > div:nth-of-type(2) > a:nth-of-type(3)", '<a href="https://voorbeeld.test/contact.html#mastodon" class="rond groot">'), 'a[href="/contact.html#mastodon"] in footer');
  // The same link one place further, on a preview: the same mark.
  assert.equal(elementMark("#top > div:nth-of-type(1) > footer > div:nth-of-type(2) > a:nth-of-type(4)", '<a class="rond" href="http://localhost:8080/contact.html#mastodon">'), 'a[href="/contact.html#mastodon"] in footer');
  assert.equal(elementMark("#cookiemelding > img", '<img src="/beeld/schild.svg" alt="logo" width="32">'), 'img[alt="logo"][src="/beeld/schild.svg"] in #cookiemelding');
  // An id a framework numbers on every load is left out; one a person wrote is kept.
  assert.equal(elementMark("main > form > input:nth-of-type(2)", '<input id=":r1a:" type="email" name="mail">'), 'input[name="mail"][type="email"] in form');
  assert.equal(elementMark("main > input", '<input id="zoekveld" type="search">'), 'input[id="zoekveld"][type="search"] in main');
  // Alfa gives no tag: the selector without its counting says what there is to say.
  assert.equal(elementMark("#hoofddeel > ul:nth-of-type(3) > li:nth-of-type(1) > img", null), "img in #hoofddeel");
  assert.equal(elementMark(null, null), "");
});

test("one defect gone and another new on the same page under the same rule is one better and one worse", () => {
  const failing = { "axe-core": "failed", alfa: "failed" };
  const footer = "footer > a:nth-of-type(1)";
  const before = summaryOf([withTags(page("https://voorbeeld.test/", [element("2.4.4", footer, failing)]), { [footer]: '<a href="/mastodon">' })]);
  const after = summaryOf([withTags(page("https://voorbeeld.test/", [element("2.4.4", footer, failing)]), { [footer]: '<a href="/nieuwsbrief">' })]);
  // The count is the same: one place under each rule. Only the element differs.
  assert.deepEqual(before.counts.map((count) => count.places), after.counts.map((count) => count.places));
  const comparison = compareQuick(before, after);
  assert.equal(comparison.ok, false);
  assert.deepEqual(groupedChangesNl(comparison.worse), ['/: 2.4.4 Linkdoel (in context), 1 plek erbij volgens 2 meetprogramma\'s. Het gaat om `a[href="/nieuwsbrief"] in footer`.']);
  assert.deepEqual(groupedChangesNl(comparison.better), ['/: 2.4.4 Linkdoel (in context), 1 plek minder volgens 2 meetprogramma\'s. Het gaat om `a[href="/mastodon"] in footer`.']);
});

test("an element that only moved, or got another class, is no change", () => {
  const failing = { "axe-core": "failed", alfa: "failed" };
  const before = summaryOf([withTags(page("https://voorbeeld.test/", [element("2.4.4", "footer > a:nth-of-type(1)", failing)]), { "footer > a:nth-of-type(1)": '<a href="/mastodon" class="rond">' })]);
  const after = summaryOf([withTags(page("https://voorbeeld.test/", [element("2.4.4", "footer > div > a:nth-of-type(3)", failing)]), { "footer > div > a:nth-of-type(3)": '<a class="vierkant" href="/mastodon">' })]);
  const comparison = compareQuick(before, after);
  assert.deepEqual([comparison.ok, comparison.worse, comparison.better], [true, [], []]);
});

test("a page of the baseline that is not measured now fails the comparison; a new page does not", () => {
  const home = page("https://voorbeeld.test/", []);
  const contact = page("https://voorbeeld.test/contact", [element("3.3.2", "input", { "axe-core": "failed", ibm: "failed" })]);
  const gone = compareQuick(summaryOf([home, contact]), summaryOf([home]));
  assert.deepEqual([gone.ok, gone.notMeasured], [false, ["/contact"]]);
  assert.match(quickComparisonMarkdown(gone), /## Niet meer gemeten/);
  const added = compareQuick(summaryOf([home]), summaryOf([home, contact]));
  assert.deepEqual([added.ok, added.newPages, added.worse], [true, ["/contact"], []]);
});

/** A loep that answers as the real one does, without a browser. */
function fakeLoep(run: string, calls: string[][], options: { failOpen?: string } = {}) {
  let nr = 0;
  return async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    calls.push(args);
    const answer = (value: unknown) => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" });
    if (args[0] === "inventory") {
      mkdirSync(run, { recursive: true });
      writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://voorbeeld.test/", origin: "https://voorbeeld.test", pages: [{}, {}], skipped: [{ url: "https://voorbeeld.test/x", reason: "page limit of 2 reached" }] }));
      return answer({});
    }
    if (args[0] === "sample") {
      writeFileSync(join(run, "sample.json"), JSON.stringify({ items: [{ url: "https://voorbeeld.test/" }, { url: "https://voorbeeld.test/contact" }, { url: "https://elders.test/venster" }] }));
      return answer({});
    }
    const [, command, first] = args;
    if (command === "start" || command === "stop") return answer({ session: "quick" });
    if (command === "open") return first === options.failOpen ? answer({ error: "time-out" }) : answer({ status: 200, url: first, title: "Pagina" });
    if (command === "look") return answer({ image: "observations/quick/0001.png" });
    if (command === "reflow") return answer({ horizontalScroll: false, offenders: 1, first: ["button: Menu"] });
    if (command === "zoom") return answer({ horizontalScroll: false, offenders: 0 });
    if (command === "rules") {
      nr += 1;
      mkdirSync(join(run, "observations", "quick"), { recursive: true });
      const number = String(nr).padStart(4, "0");
      writeFileSync(join(run, "observations", "quick", `${number}.json`), JSON.stringify({ id: `quick-${number}`, result: { methods: [{ implementation: "axe-core", version: "4.14.0" }], grouped: { elements: [element("2.4.4", "a.meer", { "axe-core": "failed", alfa: "failed" })] } } }));
      return answer({ id: `quick-${number}` });
    }
    return { code: 1, stdout: "", stderr: `onbekend: ${args.join(" ")}` };
  };
}

test("quick finds the pages, measures its own origin in light and dark, marks the run and writes the summary", async () => {
  const run = join(mkdtempSync(join(tmpdir(), "loep-quick-")), "run");
  const calls: string[][] = [];
  const { summary, comparison } = await quick({ url: "https://voorbeeld.test/", run, maxPages: 2, loep: fakeLoep(run, calls), say: () => undefined });
  assert.equal(comparison, null);
  assert.deepEqual(calls[0], ["inventory", "https://voorbeeld.test/", "--out", run, "--max-pages", "2"]);
  // The window of someone else in the sample is not measured.
  assert.deepEqual(summary.pages.map((entry) => entry.url), ["https://voorbeeld.test/", "https://voorbeeld.test/contact"]);
  assert.deepEqual(calls.filter((args) => args[1] === "open").map((args) => args.slice(2, 5)), [
    ["https://voorbeeld.test/", "--scheme", "light"],
    ["https://voorbeeld.test/", "--scheme", "dark"],
    ["https://voorbeeld.test/contact", "--scheme", "light"],
    ["https://voorbeeld.test/contact", "--scheme", "dark"],
  ]);
  assert.equal(calls.filter((args) => args[1] === "reflow").length, 2);
  assert.deepEqual(calls.at(-1), ["session", "stop", "--run", run]);
  assert.deepEqual(summary.signals.map((signal) => [signal.criterion, signal.ground]), [["2.4.4", "engines-agree"], ["1.4.10", "layout-probe"]]);
  assert.equal(summary.coverage.pageLimitReached, true);
  assert.ok(existsSync(join(run, QUICK_MARK_FILE)));
  assert.match(readFileSync(join(run, "quick", "samenvatting.md"), "utf8"), /# Snelle meting van https:\/\/voorbeeld\.test\//);
  assert.deepEqual(JSON.parse(readFileSync(join(run, "quick", "summary.json"), "utf8")).counts.length, 4);
  const steps = (JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")) as { steps: { command: string }[] }).steps;
  assert.equal(steps.at(-1)!.command, "quick");
});

test("quick holds the outcome against a baseline, stops the session when a page fails, and refuses a run of an evaluation", async () => {
  const folder = mkdtempSync(join(tmpdir(), "loep-quick-"));
  const first = join(folder, "eerste");
  await quick({ url: "https://voorbeeld.test/", run: first, maxPages: 2, loep: fakeLoep(first, []), say: () => undefined });
  const second = join(folder, "tweede");
  const calls: string[][] = [];
  const { summary, comparison } = await quick({ url: "https://voorbeeld.test/", run: second, maxPages: 2, baseline: join(first, "quick", "summary.json"), loep: fakeLoep(second, calls, { failOpen: "https://voorbeeld.test/contact" }), say: () => undefined });
  assert.equal(summary.partial, true);
  assert.deepEqual([comparison!.ok, comparison!.notMeasured, comparison!.worse], [false, ["/contact"], []]);
  assert.ok(existsSync(join(second, "quick", "verschil.md")));
  assert.deepEqual(calls.at(-1), ["session", "stop", "--run", second]);

  await assert.rejects(quick({ url: "https://voorbeeld.test/", run: first, maxPages: 2, loep: fakeLoep(first, []), say: () => undefined }), /heeft al een inventaris/);
  writeFileSync(join(first, "site.json"), "{}");
  await assert.rejects(quick({ run: first, maxPages: 2, loep: fakeLoep(first, []), say: () => undefined }), /heeft een sitemodel en is dus van een onderzoek/);
  await assert.rejects(quick({ run: second, maxPages: 2, baseline: join(first, "manifest.json"), loep: fakeLoep(second, []), say: () => undefined }), /geen summary\.json van een snelle meting/);
});
