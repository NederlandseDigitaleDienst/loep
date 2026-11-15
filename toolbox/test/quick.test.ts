import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { quick } from "../src/commands/quick.ts";
import { buildQuickSummary, compareQuick, confirmComparison, coveringLayers, elementMark, groupedChangesNl, mediaProbe, orderProbe, QUICK_BACKTEST, spacingProbe, tabProbe, QUICK_MARK_FILE, quickComparisonMarkdown, quickFindings, quickSignals, quickSummaryMarkdown, type GroupedElement, type QuickPage, type QuickSummary } from "../src/lib/quick.ts";

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
  title: `Pagina ${new URL(url).pathname}`,
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
  assert.deepEqual(signals.map((signal) => [signal.criterion, signal.ground, signal.pages]), [["2.4.4", "engines-agree", 1], ["1.4.10", "probe", 1], ["1.3.1", "engine-alone", 2]]);
  assert.match(signals[1]!.sentenceNl, /Bij 320 pixels breed valt er inhoud buiten beeld op 1 pagina\./);
  assert.match(signals[2]!.sentenceNl, /Eén meetprogramma keurt 2 plekken af, op 2 pagina's/);
});

test("the summary leaves AAA out, names the engines and says what it is not", () => {
  const summary = summaryOf([page("https://voorbeeld.test/", [element("1.4.6", "p", { "axe-core": "failed", alfa: "failed" }), element("1.4.3", "p", { "axe-core": "failed", alfa: "failed" })])]);
  assert.deepEqual(summary.signals.map((signal) => signal.criterion), ["1.4.3"]);
  assert.deepEqual(summary.engines, [{ id: "axe-core", version: "4.14.0" }, { id: "ibm", version: "4.0.34" }]);
  assert.deepEqual(summary.counts, [{ path: "/", criterion: "1.4.3", rule: "alfa:regel-1.4.3", element: "p", strong: true, places: 1 }, { path: "/", criterion: "1.4.3", rule: "axe-core:regel-1.4.3", element: "p", strong: true, places: 1 }]);
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
  // The other way round the link that one engine fails is new. One engine alone stops nothing, unless the pipeline asks for it.
  const back = compareQuick(after, before);
  assert.deepEqual([back.ok, back.worse, back.weak.map((change) => [change.criterion, change.rule, change.strong])], [true, [], [["2.4.4", "axe-core:regel-2.4.4", false]]]);
  assert.match(quickComparisonMarkdown(back), /## Zwakke aanwijzingen\n\nEén meetprogramma meldt meer plekken en de andere niet, of een proef die niet elke keer hetzelfde meet ziet iets\. Dat houdt niets tegen/);
  const strict = compareQuick(after, before, true);
  assert.deepEqual([strict.ok, strict.worse.length, strict.weak], [false, 1, []]);
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

test("the probes of loep read the result of an observation, not a sentence of an answer", () => {
  assert.deepEqual(orderProbe({ reversed: [{ tag: "div", text: "Vanaf maandag kunt u uw fiets gratis en bewaakt stallen ", region: "main" }], cssOrder: [{ tag: "nav", text: "Veel gezocht" }], positiveTabindex: [{ tag: "input", text: "", region: "form" }] }), [
    { probe: "order", element: 'div "Vanaf maandag kunt u uw fiets gratis en bewaakt stallen" in main' },
    { probe: "order", element: 'nav "Veel gezocht"' },
    { probe: "tabindex", element: "input in form" },
  ]);
  assert.deepEqual(orderProbe({}), []);
  // Text that is clipped but not lost, such as a line that wraps, is no finding.
  assert.deepEqual(spacingProbe({ newlyClipped: [{ tag: "a", text: "Paspoort of rijbewijs", region: "main", textCut: { lost: true } }, { tag: "p", text: "Lang", textCut: { lost: false } }, { tag: "p", text: "Geen", textCut: null }] }), [{ probe: "spacing", element: 'a "Paspoort of rijbewijs" in main' }]);
  const sound = { tag: "audio", src: "https://voorbeeld.test/media/melodie.ogg", attributes: { autoplay: true }, audioTrack: true, muted: false, canBePausedOrMuted: false };
  assert.deepEqual(mediaProbe({ elements: [sound, { ...sound, canBePausedOrMuted: true }, { ...sound, audioTrack: false }, { ...sound, muted: true }, { ...sound, attributes: { autoplay: false } }] }), [{ probe: "autoplay", element: "audio /media/melodie.ogg" }]);
  const stops = [
    { path: ["header > nav > ul > li:nth-of-type(2) > a"], href: "/nieuws/", focusPixelShare: 0, coveredBy: null },
    { path: ["header > a"], href: "/", focusPixelShare: 0.11, coveredBy: null },
    { path: ["#hoofddeel > p > a"], href: "/contact.html", focusPixelShare: 0, coveredBy: ["#cookiemelding > div:nth-of-type(1) > p"] },
    { path: ["main > a"], href: "/x", focusPixelShare: 0, coveredBy: null, focusNotMeasured: "het element stond niet op de plek" },
  ];
  const walk = { methods: [{ result: { stops } }], focusLost: { next: "#top > footer > div:nth-of-type(1) > a:nth-of-type(2)", throwsAway: true } };
  assert.deepEqual(tabProbe(walk), [
    { probe: "focus-invisible", element: "a in nav naar /nieuws/" },
    { probe: "focus-covered", element: "a in #hoofddeel naar /contact.html" },
    { probe: "focus-thrown", element: "a in footer" },
  ]);
  // A walk that ended because the page has no more stops threw nothing away.
  assert.deepEqual(tabProbe({ methods: [{ result: { stops: [] } }], focusLost: { next: "a", throwsAway: false } }), []);
  assert.deepEqual(coveringLayers(walk), ["#cookiemelding"]);
});

test("the summary says what lay over the pages and how to close it", () => {
  const covered: QuickPage = { ...page("https://voorbeeld.test/", []), covering: ["#cookiemelding"] };
  const text = quickSummaryMarkdown(summaryOf([covered, page("https://voorbeeld.test/contact", [])]));
  assert.match(text, /Over 1 pagina lag iets, zoals een cookiemelding: `#cookiemelding`\. De proeven hebben met die laag gemeten\. Geef de knop die haar sluit mee met --dismiss/);
  const still = buildQuickSummary({ site: "https://voorbeeld.test/", startedAt: "2026-11-15T10:00:00.000Z", finishedAt: "2026-11-15T10:01:00.000Z", maxPages: 15, pagesFound: 1, pageLimitReached: false, planned: 1, pages: [covered], dismiss: ["#weigeren"] });
  assert.match(quickSummaryMarkdown(still), /lag nog iets, ook na het klikken op wat met --dismiss is opgegeven/);
  assert.doesNotMatch(quickSummaryMarkdown(summaryOf([page("https://voorbeeld.test/", [])])), /--dismiss/);
});

test("a rule of one engine that fails every link does not stop a release that adds a link", () => {
  const link = (nr: number) => ({ ...element("2.1.1", `nav > a:nth-of-type(${nr})`, { qualweb: "failed" }), rules: { qualweb: ["QW-WCAG-T24"] } });
  const tags = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`nav > a:nth-of-type(${index + 1})`, `<a href="/pagina-${index + 1}">`]));
  const before = summaryOf([withTags(page("https://voorbeeld.test/", [link(1), link(2)]), tags(2))]);
  const after = summaryOf([withTags(page("https://voorbeeld.test/", [link(1), link(2), link(3)]), tags(3))]);
  const comparison = compareQuick(before, after);
  assert.deepEqual([comparison.ok, comparison.worse], [true, []]);
  assert.deepEqual(groupedChangesNl(comparison.weak), ['/: 2.1.1 Toetsenbord, 1 plek erbij volgens 1 meetprogramma. Het gaat om `a[href="/pagina-3"] in nav`.']);
  // The same link failed by two engines is a release that broke something.
  const both = summaryOf([withTags(page("https://voorbeeld.test/", [link(1), link(2), element("2.1.1", "nav > a:nth-of-type(3)", { qualweb: "failed", alfa: "failed" })]), tags(3))]);
  assert.equal(compareQuick(before, both).ok, false);
});

test("the summary gives what one engine alone fails a line per engine, not a line per criterion", () => {
  const links = Array.from({ length: 5 }, (_, index) => ({ ...element("2.1.1", `nav > a:nth-of-type(${index + 1})`, { qualweb: "failed" }), rules: { qualweb: ["QW-WCAG-T24"] } }));
  const summary = summaryOf([page("https://voorbeeld.test/", [...links, { ...element("3.2.1", "nav > a:nth-of-type(1)", { qualweb: "failed" }), rules: { qualweb: ["QW-WCAG-T24"] } }, element("1.4.3", "p", { alfa: "failed", "axe-core": "passed" })])]);
  assert.deepEqual(summary.single, [
    { engine: "qualweb", places: 6, criteria: ["2.1.1", "3.2.1"], mostRule: { rule: "QW-WCAG-T24", places: 6 } },
    { engine: "alfa", places: 1, criteria: ["1.4.3"], mostRule: { rule: "regel-1.4.3", places: 1 } },
  ]);
  const text = quickSummaryMarkdown(summary);
  assert.match(text, /## Alleen volgens één meetprogramma/);
  assert.match(text, /- QualWeb: 6 plekken onder 2 criteria \(2\.1\.1, 3\.2\.1\)\. Het vaakst regel QW-WCAG-T24, 6 keer\./);
  assert.match(text, /- Alfa: 1 plek onder 1 criterium \(1\.4\.3\)\./);
  assert.doesNotMatch(text, /## Eén meetprogramma|## Meetprogramma's spreken elkaar tegen/);
});

test("the probe for text spacing was not repeatable on a real site, so it stops no pipeline", () => {
  const lost = { probe: "spacing" as const, element: 'span "Meer opties" in nav' };
  const before = summaryOf([page("https://voorbeeld.test/", [])]);
  const after = summaryOf([{ ...page("https://voorbeeld.test/", []), probes: [lost, { probe: "focus-invisible" as const, element: "a in nav" }] }]);
  assert.deepEqual(after.counts.map((count) => [count.rule, count.strong]), [["loep:spacing", false], ["loep:focus-invisible", true]]);
  const comparison = compareQuick(before, after);
  assert.deepEqual([comparison.worse.map((change) => change.rule), comparison.weak.map((change) => change.rule)], [["loep:focus-invisible"], ["loep:spacing"]]);
  const only = compareQuick(before, summaryOf([{ ...page("https://voorbeeld.test/", []), probes: [lost] }]));
  assert.deepEqual([only.ok, only.weak.length], [true, 1]);
  assert.equal(compareQuick(before, summaryOf([{ ...page("https://voorbeeld.test/", []), probes: [lost] }]), true).ok, false);
});

test("the same part on every page is one thing a probe saw", () => {
  const header = { probe: "order" as const, element: 'div "Menu" in header' };
  const summary = summaryOf([{ ...page("https://voorbeeld.test/", []), probes: [header] }, { ...page("https://voorbeeld.test/contact", []), probes: [header] }]);
  assert.equal(summary.signals[0]!.sentenceNl, "De volgorde op het scherm wijkt op 1 plek af van de volgorde in de code. Dat is gezien op 2 pagina's.");
  // The comparison still counts per page: the part gone from one page is one better there.
  assert.equal(summary.counts.length, 2);
});

test("a criterion one engine fails names the rule behind most places", () => {
  const links = Array.from({ length: 5 }, (_, index) => ({ ...element("2.1.1", `nav > a:nth-of-type(${index + 1})`, { qualweb: "failed" }), rules: { qualweb: ["QW-WCAG-T24"] } }));
  const summary = summaryOf([page("https://voorbeeld.test/", [...links, { ...element("2.1.1", "main > div", { qualweb: "failed" }), rules: { qualweb: ["QW-ACT-R62"] } }])]);
  assert.deepEqual(summary.signals[0]!.mostRule, { engine: "qualweb", rule: "QW-WCAG-T24", places: 5 });
  assert.equal(summary.signals[0]!.sentenceNl, "Eén meetprogramma keurt 6 plekken af, op 1 pagina, en de andere zeggen er niets over. Het vaakst: regel QW-WCAG-T24 van QualWeb, 5 keer.");
});

test("the figures every summary quotes are the ones the validation file has", () => {
  const validation = readFileSync(new URL("../../validatie/snelle-meting/README.md", import.meta.url), "utf8");
  const { testsite, precision, recall, sites } = QUICK_BACKTEST;
  assert.ok(validation.includes(`| Alle gebreken | 31 van 79 | 41 van 79 | ${testsite.caught} van ${testsite.defects} |`), "de testsite");
  assert.ok(validation.includes(`(${Math.round(precision * 100)}%) | ${Math.round(recall * 100)}% |`), "precisie en vangst");
  assert.ok(validation.includes(`van elk van ${sites} sites`), "het aantal sites");
  assert.ok(QUICK_BACKTEST.textNl.includes(`${testsite.caught} van de ${testsite.defects}`) && QUICK_BACKTEST.textNl.includes(`${sites} sites`));
});

test("what a probe saw is a signal under its criterion and a count the comparison holds", () => {
  const home: QuickPage = { ...page("https://voorbeeld.test/", []), title: "Gemeente", probes: [{ probe: "focus-invisible", element: "a in nav naar /nieuws/" }, { probe: "focus-invisible", element: "a in nav naar /afval/" }] };
  const news: QuickPage = { ...page("https://voorbeeld.test/nieuws/", []), title: "Gemeente" };
  const summary = summaryOf([home, news]);
  assert.deepEqual(summary.signals.map((signal) => [signal.criterion, signal.ground, signal.probePages]), [["2.4.2", "probe", 2], ["2.4.7", "probe", 1]]);
  assert.equal(summary.signals[0]!.sentenceNl, "2 pagina's hebben dezelfde titel als een andere pagina. Dat is gezien op 2 pagina's.");
  assert.equal(summary.signals[1]!.sentenceNl, "Bij 2 elementen verandert er niets zichtbaars als het de focus krijgt. Dat is gezien op 1 pagina.");
  assert.deepEqual(summary.counts.map((count) => [count.path, count.criterion, count.rule]), [["/", "2.4.2", "loep:title"], ["/", "2.4.7", "loep:focus-invisible"], ["/", "2.4.7", "loep:focus-invisible"], ["/nieuws/", "2.4.2", "loep:title"]]);
  const clean = summaryOf([{ ...home, title: "Home", probes: [] }, { ...news, title: "Nieuws" }]);
  const comparison = compareQuick(clean, summary);
  assert.equal(comparison.ok, false);
  assert.deepEqual(groupedChangesNl(comparison.worse), [
    "/: 2.4.2 Paginatitel, 1 plek erbij volgens een proef van loep. Het gaat om `Gemeente`.",
    "/: 2.4.7 Focus zichtbaar, 2 plekken erbij volgens een proef van loep. Het gaat om `a in nav naar /afval/`, `a in nav naar /nieuws/`.",
    "/nieuws/: 2.4.2 Paginatitel, 1 plek erbij volgens een proef van loep. Het gaat om `Gemeente`.",
  ]);
  assert.equal(compareQuick(summary, clean).ok, true);
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

test("what only one of two measurements finds worse stops nothing; what both find does", () => {
  const failing = { "axe-core": "failed", alfa: "failed" };
  const before = summaryOf([page("https://voorbeeld.test/", []), page("https://voorbeeld.test/contact", [])]);
  const real = element("2.4.4", "a.meer", failing);
  const chance = element("1.4.3", "p.laat", failing);
  const first = compareQuick(before, summaryOf([page("https://voorbeeld.test/", [real, chance]), page("https://voorbeeld.test/contact", [])]));
  const second = compareQuick(before, summaryOf([page("https://voorbeeld.test/", [real]), page("https://voorbeeld.test/contact", [])]));
  const confirmed = confirmComparison(first, second);
  assert.equal(confirmed.ok, false);
  assert.deepEqual([...new Set(confirmed.worse.map((change) => change.criterion))], ["2.4.4"]);
  assert.deepEqual([...new Set(confirmed.unstable.map((change) => change.criterion))], ["1.4.3"]);
  assert.match(quickComparisonMarkdown(confirmed), /## Niet bevestigd\n\nGezien in één van twee metingen van dezelfde pagina\. Dat telt niet als slechter\./);
  // Only chance: the comparison passes, and says what it left out.
  const onlyChance = confirmComparison(compareQuick(before, summaryOf([page("https://voorbeeld.test/", [chance]), page("https://voorbeeld.test/contact", [])])), compareQuick(before, before));
  assert.deepEqual([onlyChance.ok, onlyChance.worse.length, onlyChance.unstable.length], [true, 0, 2]);
  // Something the second measurement finds and the first did not is chance too.
  assert.equal(confirmComparison(compareQuick(before, before), first).ok, true);
});

/** A loep that answers as the real one does, without a browser. */
function fakeLoep(run: string, calls: string[][], options: { failOpen?: string; zoomOnce?: boolean; zoomAlways?: boolean } = {}) {
  let nr = 0;
  let zooms = 0;
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
    if (command === "open") return first === options.failOpen ? answer({ error: "time-out" }) : answer({ status: 200, url: first, title: `Pagina ${new URL(first!).pathname}` });
    if (command === "look") return answer({ image: "observations/quick/0001.png" });
    const observe = (result: unknown) => {
      nr += 1;
      mkdirSync(join(run, "observations", "quick"), { recursive: true });
      const number = String(nr).padStart(4, "0");
      writeFileSync(join(run, "observations", "quick", `${number}.json`), JSON.stringify({ id: `quick-${number}`, result }));
      return answer({ id: `quick-${number}` });
    };
    if (command === "find") return answer(first === "css:#weigeren" ? { total: 1, found: ["4 button: Weigeren"] } : first === "css:button" ? { total: 4, hidden: 1 } : { total: 0, found: [] });
    if (command === "click") return answer({ id: "quick-klik" });
    if (command === "order") return observe({ methods: [{ result: { reversed: [], cssOrder: [], positiveTabindex: [{ tag: "input", text: "", region: "form" }] } }] });
    if (command === "media") return observe({ elements: [] });
    if (command === "taborder") return observe({ methods: [{ result: { stops: [{ path: ["nav > a"], href: "/nieuws/", focusPixelShare: 0, coveredBy: ["#cookiemelding > div"] }] } }], focusLost: null });
    if (command === "spacing") return observe({ methods: [{ result: { newlyClipped: [] } }] });
    if (command === "reflow") return answer({ horizontalScroll: false, offenders: 1, first: ["button: Menu"] });
    if (command === "zoom") return answer({ horizontalScroll: false, offenders: options.zoomAlways || (options.zoomOnce && zooms++ === 0) ? 2 : 0 });
    if (command === "rules") return observe({ methods: [{ implementation: "axe-core", version: "4.14.0" }], grouped: { elements: [element("2.4.4", "a.meer", { "axe-core": "failed", alfa: "failed" })] } });
    return { code: 1, stdout: "", stderr: `onbekend: ${args.join(" ")}` };
  };
}

test("quick finds the pages, measures its own origin in light and dark, marks the run and writes the summary", async () => {
  const run = join(mkdtempSync(join(tmpdir(), "loep-quick-")), "run");
  const calls: string[][] = [];
  const { summary, comparison } = await quick({ url: "https://voorbeeld.test/", run, maxPages: 2, dismiss: ["#weigeren"], loep: fakeLoep(run, calls), say: () => undefined });
  assert.equal(comparison, null);
  // The layer over the page is clicked away after every opening, before anything is measured.
  const commands = calls.filter((args) => args[0] === "session").map((args) => args[1]);
  assert.deepEqual(commands.slice(0, 15), ["start", "open", "find", "click", "look", "rules", "order", "media", "taborder", "reflow", "zoom", "spacing", "open", "find", "click"]);
  assert.deepEqual(summary.covering, { layers: ["#cookiemelding"], pages: 2, dismiss: ["#weigeren"] });
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
  assert.deepEqual(summary.signals.map((signal) => [signal.criterion, signal.ground]), [["2.4.4", "engines-agree"], ["1.4.10", "probe"], ["2.4.3", "probe"], ["2.4.11", "probe"]]);
  assert.equal(summary.coverage.pageLimitReached, true);
  assert.ok(existsSync(join(run, QUICK_MARK_FILE)));
  assert.match(readFileSync(join(run, "quick", "samenvatting.md"), "utf8"), /# Snelle meting van https:\/\/voorbeeld\.test\//);
  assert.deepEqual(JSON.parse(readFileSync(join(run, "quick", "summary.json"), "utf8")).counts.length, 8);
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

  // The page that failed was opened once more before the comparison failed on it.
  assert.equal(calls.filter((args) => args[1] === "open" && args[2] === "https://voorbeeld.test/contact").length, 4);
  assert.equal(calls.filter((args) => args[1] === "open" && args[2] === "https://voorbeeld.test/").length, 2);

  // A finding that is there the first time and gone the second does not stop a pipeline; one that stays does.
  const base = join(first, "quick", "summary.json");
  const chance = join(folder, "toeval");
  const once = await quick({ url: "https://voorbeeld.test/", run: chance, maxPages: 2, baseline: base, loep: fakeLoep(chance, [], { zoomOnce: true }), say: () => undefined });
  assert.deepEqual([once.comparison!.ok, once.comparison!.worse.length, once.comparison!.unstable.map((change) => `${change.path} ${change.rule}`)], [true, 0, ["/ zoom"]]);
  const stays = join(folder, "blijft");
  const twice = await quick({ url: "https://voorbeeld.test/", run: stays, maxPages: 2, baseline: base, loep: fakeLoep(stays, [], { zoomAlways: true }), say: () => undefined });
  assert.deepEqual([twice.comparison!.ok, twice.comparison!.worse.map((change) => `${change.path} ${change.rule}`), twice.comparison!.unstable], [false, ["/ zoom", "/contact zoom"], []]);

  await assert.rejects(quick({ url: "https://voorbeeld.test/", run: first, maxPages: 2, loep: fakeLoep(first, []), say: () => undefined }), /heeft al een inventaris/);
  // A selector that names more than one element is a mistake to say out loud, not a layer to measure along; the session is stopped all the same.
  const third = join(folder, "derde");
  const dismissCalls: string[][] = [];
  await assert.rejects(quick({ url: "https://voorbeeld.test/", run: third, maxPages: 2, dismiss: ["button"], loep: fakeLoep(third, dismissCalls), say: () => undefined }), /--dismiss "button" past op 4 elementen/);
  assert.deepEqual(dismissCalls.at(-1), ["session", "stop", "--run", third]);
  // A selector that is not on the page clicks nothing and measures on.
  const fourth = join(folder, "vierde");
  const quietCalls: string[][] = [];
  await quick({ url: "https://voorbeeld.test/", run: fourth, maxPages: 2, dismiss: ["#bestaat-niet"], loep: fakeLoep(fourth, quietCalls), say: () => undefined });
  assert.equal(quietCalls.filter((args) => args[1] === "click").length, 0);
  writeFileSync(join(first, "site.json"), "{}");
  await assert.rejects(quick({ run: first, maxPages: 2, loep: fakeLoep(first, []), say: () => undefined }), /heeft een sitemodel en is dus van een onderzoek/);
  await assert.rejects(quick({ run: second, maxPages: 2, baseline: join(first, "manifest.json"), loep: fakeLoep(second, []), say: () => undefined }), /geen summary\.json van een snelle meting/);
});
