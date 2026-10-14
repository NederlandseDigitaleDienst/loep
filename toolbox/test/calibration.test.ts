import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { alfaMapping, describeSource, runCalibration, serveTestcases } from "../src/commands/calibrate.ts";
import {
  calibrate,
  calibrationMarkdown,
  cellOf,
  count,
  emptyTally,
  engineSaid,
  mappedRules,
  nameSaid,
  OWN_MAPPINGS,
  ratesOf,
  strongest,
  together,
  type CaseRow,
  type Catalogue,
  type NamedElement,
  type PageMeasurement,
  type TestCase,
} from "../src/lib/calibration.ts";
import type { EngineId } from "../src/instruments/methods/rules.ts";

// The calibration against the ACT test cases of W3C runs on request only (`just calibrate`): it
// fetches the cases. What is tested here needs no network: the tie between a rule of an
// instrument and an ACT rule, the counting, and one run on a handful of cases written for this test.
const FIXTURE = fileURLToPath(new URL("./fixtures/calibration", import.meta.url));

test("one failure makes a page fail, one doubt makes it doubtful, and nothing at all is not applicable", () => {
  assert.equal(strongest(["passed", "failed", "cantTell"]), "failed");
  assert.equal(strongest(["passed", "cantTell", "inapplicable"]), "cantTell");
  assert.equal(strongest(["inapplicable", "passed"]), "passed");
  assert.equal(strongest([]), "inapplicable");
});

test("an instrument without a rule for an ACT rule says nothing, and a rule that is switched off does not count", () => {
  const catalogue: Catalogue = {
    "name-a": { act: ["aaaaaa"], runs: true },
    "name-b": { act: ["aaaaaa", "bbbbbb"], runs: true },
    "best-practice": { act: ["cccccc"], runs: false },
    other: { act: [], runs: true },
  };
  assert.deepEqual(mappedRules(catalogue, "aaaaaa"), { rules: ["name-a", "name-b"], off: [] });
  assert.deepEqual(mappedRules(catalogue, "cccccc"), { rules: [], off: ["best-practice"] });
  // One of two rules fails: the page fails. A rule that gave no outcome on the page counts as not applicable.
  assert.equal(engineSaid({ "name-a": "passed", "name-b": "failed" }, mappedRules(catalogue, "aaaaaa")), "failed");
  assert.equal(engineSaid({ other: "failed" }, mappedRules(catalogue, "aaaaaa")), "inapplicable");
  // No rule, or only one that is off: nothing said, which is not the same as missed.
  assert.equal(engineSaid({ "best-practice": "failed" }, mappedRules(catalogue, "cccccc")), null);
  assert.equal(engineSaid({ other: "failed" }, mappedRules(catalogue, "dddddd")), null);
});

test("a case lands in one cell, and the shares carry the numbers they were made of", () => {
  assert.equal(cellOf("failed", "failed"), "found");
  assert.equal(cellOf("failed", "passed"), "missed");
  assert.equal(cellOf("failed", "inapplicable"), "missed");
  assert.equal(cellOf("passed", "failed"), "falseAlarm");
  assert.equal(cellOf("inapplicable", "failed"), "falseAlarm");
  assert.equal(cellOf("inapplicable", "passed"), "rightlySilent");
  assert.equal(cellOf("failed", "cantTell"), "unsure");
  assert.equal(cellOf("passed", "error"), "error");
  const tally = emptyTally();
  for (const [expected, answer] of [["failed", "failed"], ["failed", "failed"], ["failed", "passed"], ["failed", "cantTell"], ["passed", "failed"], ["passed", "passed"], ["inapplicable", "cantTell"], ["failed", null], ["passed", "error"]] as const) count(tally, expected, answer);
  assert.deepEqual(tally, { cases: 9, noOpinion: 1, error: 1, judged: 7, failures: 4, found: 2, missed: 1, unsureOnFailure: 1, falseAlarm: 1, rightlySilent: 1, unsureOnOther: 1 });
  const rates = ratesOf(tally);
  // Doubt on a failure counts as not found: two of four, not two of three.
  assert.deepEqual(rates.hitRate, { count: 2, of: 4, share: 0.5 });
  assert.deepEqual(rates.falseReports, { count: 1, of: 3, share: 0.333 });
  assert.deepEqual(rates.falseAlarmRate, { count: 1, of: 3, share: 0.333 });
  assert.equal(ratesOf(emptyTally()).hitRate.share, null);
});

test("a name method fails a page when an element the rule is about has an empty name in its computation", () => {
  const element = (role: string | null, names: Record<string, string | null>, rest: Partial<NamedElement> = {}): NamedElement => ({ role, ignored: false, imageInput: false, names, ...rest });
  const button = OWN_MAPPINGS.find((mapping) => mapping.act === "97a4e1")!;
  const imageButton = OWN_MAPPINGS.find((mapping) => mapping.act === "59796f")!;
  const elements = [element("button", { chromium: "Opslaan", "axe-name": "" }), element("link", { chromium: "", "axe-name": "" }), element(null, { chromium: "", "axe-name": "" })];
  assert.equal(nameSaid(elements, button, "chromium"), "passed");
  assert.equal(nameSaid(elements, button, "axe-name"), "failed");
  // What Chromium keeps out of its tree is not what the rule is about, and neither is another role.
  assert.equal(nameSaid([element("button", { chromium: "" }, { ignored: true }), element("link", { chromium: "" })], button, "chromium"), "inapplicable");
  // The rule on buttons leaves image buttons to the rule on image buttons.
  const image = [element("button", { chromium: "" }, { imageInput: true })];
  assert.equal(nameSaid(image, button, "chromium"), "inapplicable");
  assert.equal(nameSaid(image, imageButton, "chromium"), "failed");
  // A method that gave no answer at all did not run; one that answered for a part cannot tell.
  assert.equal(nameSaid([element("button", { chromium: "Zoek", playwright: null })], button, "playwright"), "error");
  assert.equal(nameSaid([element("button", { playwright: null }), element("button", { playwright: "Zoek" })], button, "playwright"), "cantTell");
});

const ROW = (rule: string, id: string, expected: TestCase["expected"], approved = true): TestCase => ({ ruleId: rule, ruleName: `regel ${rule}`, expected, testcaseId: id, relativePath: `testcases/${rule}/${id}.html`, approved });

test("the count per instrument and per rule: found, missed, falsely reported, nothing said, and a page that did not load", () => {
  const catalogues: Record<EngineId, Catalogue> = {
    "axe-core": { "a-name": { act: ["aaaaaa"], runs: true }, "a-best": { act: ["bbbbbb"], runs: false } },
    alfa: { "sia-x": { act: ["aaaaaa", "bbbbbb"], runs: true } },
    ibm: {},
    qualweb: { "QW-1": { act: ["aaaaaa"], runs: true } },
  };
  const page = (engines: PageMeasurement["engines"]): PageMeasurement => ({ engines, own: {} });
  const pages = new Map<string, PageMeasurement>([
    ["fout", page({ "axe-core": { "a-name": "failed" }, alfa: { "sia-x": "failed" }, ibm: {}, qualweb: { "QW-1": "passed" } })],
    ["goed", page({ "axe-core": { "a-name": "passed", "a-best": "failed" }, alfa: { "sia-x": "failed" }, ibm: {}, qualweb: "QualWeb gaf geen antwoord binnen 45 seconden" })],
    // "leeg" is a test case of two rules and is measured once.
    ["leeg", page({ "axe-core": {}, alfa: { "sia-x": "cantTell" }, ibm: {}, qualweb: {} })],
  ]);
  const cases = [ROW("aaaaaa", "fout", "failed"), ROW("aaaaaa", "goed", "passed"), ROW("aaaaaa", "leeg", "inapplicable"), ROW("bbbbbb", "leeg", "failed", false), ROW("aaaaaa", "weg", "failed")];
  const counted = calibrate(cases, pages, catalogues);
  const pick = (id: string) => {
    const { cases: all, noOpinion, error, found, missed, falseAlarm, rightlySilent, unsureOnFailure, unsureOnOther } = counted.totals[id]!;
    return { cases: all, noOpinion, error, found, missed, falseAlarm, rightlySilent, unsureOnFailure, unsureOnOther };
  };
  // axe-core: its only rule for bbbbbb is off, so it says nothing there, though that rule failed on another page. The page "weg" was never measured.
  assert.deepEqual(pick("axe-core"), { cases: 5, noOpinion: 1, error: 1, found: 1, missed: 0, falseAlarm: 0, rightlySilent: 2, unsureOnFailure: 0, unsureOnOther: 0 });
  assert.deepEqual(pick("alfa"), { cases: 5, noOpinion: 0, error: 1, found: 1, missed: 0, falseAlarm: 1, rightlySilent: 0, unsureOnFailure: 1, unsureOnOther: 1 });
  assert.deepEqual(pick("ibm"), { cases: 5, noOpinion: 5, error: 0, found: 0, missed: 0, falseAlarm: 0, rightlySilent: 0, unsureOnFailure: 0, unsureOnOther: 0 });
  // QualWeb did not run on "goed": an error, not a miss and not a pass.
  assert.deepEqual(pick("qualweb"), { cases: 5, noOpinion: 1, error: 2, found: 0, missed: 1, falseAlarm: 0, rightlySilent: 1, unsureOnFailure: 0, unsureOnOther: 0 });
  assert.deepEqual(counted.totals.alfa!.hitRate, { count: 1, of: 2, share: 0.5 });
  // The totals over approved rules leave bbbbbb out.
  assert.equal(counted.approvedTotals.alfa!.cases, 4);
  assert.equal(counted.approvedTotals.alfa!.unsureOnFailure, 0);
  const row = counted.rules.find((entry) => entry.rule === "bbbbbb")!;
  assert.deepEqual(row.expected, { failed: 1, passed: 0, inapplicable: 0 });
  assert.deepEqual(row.instruments["axe-core"], { rules: [], off: ["a-best"], tally: emptyTally() });
  assert.deepEqual(Object.keys(row.instruments).sort(), ["alfa", "axe-core"]);
  assert.deepEqual(counted.cases.find((entry) => entry.rule === "aaaaaa" && entry.id === "fout")!.said, { "axe-core": "failed", alfa: "failed", qualweb: "passed" });
  // On "fout" two fail and one passes: split, and the majority is right. On "goed" axe-core passes what Alfa fails: a tie, and no failure.
  assert.deepEqual(counted.together.all.split, { cases: 2, majorityRight: 1, majorityWrong: 0, tie: 1 });
  assert.deepEqual(counted.disagreements.map((entry) => entry.id), ["fout", "goed"]);
  assert.deepEqual(counted.together.all.rightWhenSplit, { "axe-core": { count: 2, of: 2, share: 1 }, alfa: { count: 1, of: 2, share: 0.5 }, qualweb: { count: 0, of: 1, share: 0 } });
});

test("the engines next to each other: who is right when they are split, and how often a flag of the toolbox is a failure", () => {
  const entry = (expected: CaseRow["expected"], said: CaseRow["said"]): CaseRow => ({ rule: "aaaaaa", id: JSON.stringify(said), expected, said });
  const cases = [
    entry("failed", { "axe-core": "failed", alfa: "failed", ibm: "failed" }),
    entry("passed", { "axe-core": "passed", alfa: "inapplicable" }),
    entry("failed", { "axe-core": "passed", alfa: "passed" }),
    entry("passed", { "axe-core": "failed", alfa: "passed", ibm: "passed", qualweb: "passed" }),
    entry("failed", { "axe-core": "failed", alfa: "inapplicable", ibm: "inapplicable" }),
    entry("failed", { "axe-core": "cantTell", alfa: "inapplicable" }),
    entry("failed", { "axe-core": "failed", alfa: "error" }),
    entry("failed", {}),
  ];
  const { summary, split } = together(cases, ["axe-core", "alfa", "ibm", "qualweb"]);
  // Compared: the cases with two answers that are no doubt and no error.
  assert.equal(summary.compared, 5);
  assert.deepEqual(summary.unanimous, { cases: 3, right: 2 });
  // Split twice: three passes against one failure, the majority is right; two "not applicable" against one failure, the majority is wrong.
  assert.deepEqual(summary.split, { cases: 2, majorityRight: 1, majorityWrong: 1, tie: 0 });
  assert.equal(split.length, 2);
  assert.deepEqual(summary.rightWhenSplit["axe-core"], { count: 1, of: 2, share: 0.5 });
  // In the words of the toolbox "not applicable" is silence: one engine that fails next to silent ones stands alone.
  assert.deepEqual(summary.flags, {
    agree: { cases: 1, failures: 1 },
    alone: { cases: 2, failures: 2 },
    contradiction: { cases: 1, failures: 0 },
    cantTell: { cases: 1, failures: 1 },
    passed: { cases: 2, failures: 1 },
  });
});

test("the copy of the test cases is described by its hashes and served under the path the cases use", async () => {
  const { source, testcases } = describeSource(FIXTURE, "een-commit");
  assert.equal(source.testcases, 9);
  assert.equal(source.pages, 7);
  assert.equal(source.rules, 5);
  assert.equal(source.files, 7);
  assert.match(source.testcasesSha256, /^[0-9a-f]{64}$/);
  assert.match(source.filesSha256, /^[0-9a-f]{64}$/);
  assert.equal(testcases[0]!.ruleId, "97a4e1");
  assert.deepEqual(alfaMapping(FIXTURE).perRule, { "sia-r12": ["97a4e1"], "sia-r11": ["c487ae"], "sia-r69": ["afw4f7"] });
  const server = await serveTestcases(FIXTURE);
  try {
    const page = await fetch(server.urlOf("testcases/knop/knop-met-naam.html"));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Opslaan/);
    assert.match(server.urlOf("x"), /^http:\/\/127\.0\.0\.1:\d+\/WAI\/content-assets\/wcag-act-rules\/x$/);
    // Nothing outside the served part, also not with a path that climbs out of it.
    assert.equal((await fetch(`${server.origin}/WAI/content-assets/wcag-act-rules/%2e%2e/%2e%2e/_data/wcag-act-rules/implementations/alfa.json`)).status, 404);
    assert.equal((await fetch(`${server.origin}/testcases.json`)).status, 404);
    const part = await fetch(server.urlOf("testcases.json"), { headers: { range: "bytes=0-9" } });
    assert.equal(part.status, 206);
    assert.equal((await part.text()).length, 10);
  } finally {
    await server.close();
  }
});

test("a run on a handful of own cases: every rule set finds the button without a name, and nothing is asked outside this machine", async () => {
  const { report, cases } = await runCalibration({ dir: FIXTURE, commit: "een-commit", concurrency: 2 });
  assert.equal(report.run.pagesMeasured, 7);
  assert.equal(report.run.pagesNotLoaded, 0);
  // One page names an image on another machine; the request was refused.
  assert.ok(report.run.requestsRefused >= 1, "het verzoek naar buiten is niet geweigerd");
  const button = report.rules.find((row) => row.rule === "97a4e1")!;
  assert.deepEqual(button.expected, { failed: 1, passed: 1, inapplicable: 1 });
  for (const engine of ["axe-core", "alfa", "ibm", "qualweb"]) {
    const { tally, rules } = button.instruments[engine]!;
    assert.ok(rules.length > 0, `${engine} noemt geen regel voor 97a4e1`);
    assert.deepEqual([tally.found, tally.missed, tally.falseAlarm, tally.error], [1, 0, 0, 0], `${engine} op de knop zonder naam`);
    // The made-up rule has no rule of any engine behind it: nothing said, and so not missed.
    assert.equal(report.totals[engine]!.noOpinion >= 1, true);
    assert.equal(report.rules.find((row) => row.rule === "zzzzzz")!.instruments[engine], undefined);
  }
  // Alfa's tie comes from the report in the copy, the others' from their own packages.
  assert.deepEqual(button.instruments.alfa!.rules, ["sia-r12"]);
  assert.ok(button.instruments["axe-core"]!.rules.includes("button-name"));
  // The own measurements, each on the rule that asks what it measures.
  for (const method of ["chromium", "alfa-aria", "axe-name", "playwright", "dom-accessibility-api"]) {
    const { tally } = button.instruments[method]!;
    assert.deepEqual([tally.found, tally.missed, tally.falseAlarm, tally.rightlySilent, tally.error], [1, 0, 0, 2, 0], `${method} op de knop zonder naam`);
  }
  const contrast = report.rules.find((row) => row.rule === "afw4f7")!.instruments.pixels!.tally;
  assert.deepEqual([contrast.found, contrast.missed, contrast.falseAlarm, contrast.rightlySilent], [1, 0, 0, 1]);
  const language = report.rules.find((row) => row.rule === "ucwvc8")!.instruments["eld+cld3"]!.tally;
  assert.deepEqual([language.found, language.missed, language.falseAlarm, language.rightlySilent], [1, 0, 0, 1]);
  // The page without a button is a case of two rules and was measured once.
  assert.deepEqual(cases.filter((entry) => entry.id === "geen-knop").map((entry) => entry.rule), ["97a4e1", "c487ae"]);
  assert.equal(report.together.all.flags.agree.cases, report.together.all.flags.agree.failures);
  // The outcome names no directory of this machine, and reads as a text with its numbers.
  assert.ok(!JSON.stringify(report).includes(homedir()), "de uitkomst noemt de thuismap");
  const text = calibrationMarkdown(report);
  assert.match(text, /^# IJkmeting op de testgevallen van de ACT-regels/);
  assert.match(text, /\| axe-core \| \d+ \| \d+ \| \d+ \|/);
  assert.match(text, /100,0% \(\d+ van \d+\)/);
  assert.match(text, /commit `een-commit`/);
});
