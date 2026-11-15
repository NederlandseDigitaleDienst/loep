import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRegister, calibrationRecords, registerMarkdown, ruleKind, rulingRecords, sessionRecords, type FieldRun, type RuleCatalogue } from "../src/lib/rule-register.ts";

const tally = (found: number, falseAlarm = 0, missed = 0) => ({ cases: 10, noOpinion: 0, error: 0, judged: 10, failures: found + missed, found, missed, unsureOnFailure: 0, falseAlarm, rightlySilent: 10 - found - missed - falseAlarm, unsureOnOther: 0 });

const CALIBRATION = {
  date: "2026-11-15",
  instruments: [
    { id: "axe-core", kind: "ruleset" as const, version: "4.14.0", mapping: "" },
    { id: "qualweb", kind: "ruleset" as const, version: "0.8.6", mapping: "" },
    { id: "pixels", kind: "own" as const, version: "1", mapping: "" },
  ],
  rules: [
    { rule: "aaa111", name: "Link has a name", approved: true, expected: { failed: 4, passed: 6, inapplicable: 0 }, instruments: { "axe-core": { rules: ["link-name"], off: [], tally: tally(4) }, qualweb: { rules: ["QW-ACT-R12"], off: [], tally: tally(3, 1, 1) } } },
    { rule: "bbb222", name: "Role is valid", approved: true, expected: { failed: 2, passed: 8, inapplicable: 0 }, instruments: { "axe-core": { rules: ["aria-roles", "aria-deprecated-role"], off: [], tally: tally(2) }, qualweb: { rules: ["QW-ACT-R12"], off: [], tally: tally(2) } } },
  ],
};

const CATALOGUE: RuleCatalogue = {
  "axe-core": { "link-name": { act: ["aaa111"], criteria: ["4.1.2", "2.4.4"], title: "Links must have discernible text" }, "aria-roles": { act: ["bbb222"], criteria: ["4.1.2"] }, "aria-deprecated-role": { act: ["bbb222"], criteria: ["4.1.2"] }, region: { act: [], criteria: [] } },
  qualweb: { "QW-ACT-R12": { act: ["aaa111", "bbb222"], criteria: ["2.4.4", "4.1.2"] }, "QW-WCAG-T24": { act: [], criteria: ["2.1.1"] } },
};

const run = (site: string, outcomes: Record<string, string>, rulings: [string, string[], string][] = [], failed: [string, string, string][] = []): FieldRun => ({
  site,
  criteria: Object.entries(outcomes).map(([id, outcome]) => ({ id, outcome, observations: rulings.filter(([criterion]) => criterion === id).map(([, engineRules, ruling]) => ({ engineRules, ruling })) })),
  elements: failed.map(([criterion, engine, rule]) => ({ criterion, verdicts: { [engine]: "failed" }, rules: { [engine]: [rule] } })),
});

test("a rule is an ACT rule, a technique check or neither", () => {
  assert.equal(ruleKind("QW-ACT-R12", { act: ["aaa111"] }), "act");
  assert.equal(ruleKind("QW-WCAG-T24", { act: [] }), "technique");
  assert.equal(ruleKind("region", { act: [] }), "other");
});

test("a rule takes the tally of every ACT rule it answers, and says with which rules it shared the cases", () => {
  const records = calibrationRecords(CALIBRATION as never);
  assert.deepEqual(records.get("axe-core\nlink-name"), { act: ["aaa111"], sharedWith: [], judged: 10, failures: 4, found: 4, missed: 0, unsureOnFailure: 0, falseAlarm: 0, rightlySilent: 6 });
  // Two rules of one engine behind one ACT rule were judged together.
  assert.deepEqual(records.get("axe-core\naria-roles")!.sharedWith, ["aria-deprecated-role"]);
  // One rule behind two ACT rules: the cases of both.
  assert.deepEqual([records.get("qualweb\nQW-ACT-R12")!.act, records.get("qualweb\nQW-ACT-R12")!.judged, records.get("qualweb\nQW-ACT-R12")!.falseAlarm], [["aaa111", "bbb222"], 20, 1]);
  assert.equal(records.get("qualweb\nQW-WCAG-T24"), undefined);
});

test("what judges ruled counts per site: one finding there confirms the rule, however many runs the site has", () => {
  const runs = [
    run("https://een.test/", { "2.4.4": "failed" }, [["2.4.4", ["link-name"], "finding"], ["2.4.4", ["link-name"], "noIssue"]]),
    run("https://een.test/", { "2.4.4": "failed" }, [["2.4.4", ["link-name"], "finding"]]),
    run("https://twee.test/", { "2.4.4": "passed" }, [["2.4.4", ["link-name", "onbekende-regel"], "noIssue"]]),
    run("https://drie.test/", { "2.4.4": "cantTell" }, [["2.4.4", ["link-name"], "open"], ["2.4.4", ["link-name"], "iets-anders"]]),
  ];
  const { records, unknown } = rulingRecords(runs, (rule) => (rule === "link-name" ? "axe-core" : null));
  assert.deepEqual(records.get("axe-core\nlink-name"), { sites: 3, confirmed: 1, dismissed: 1, other: 1, rulings: { finding: 2, noIssue: 2, otherCriterion: 0, open: 1 } });
  assert.deepEqual(unknown, ["onbekende-regel"]);
});

test("from the sessions: where a rule failed, how the criterion ended, next to how it ended on all sites", () => {
  const runs = [
    run("https://een.test/", { "2.1.1": "passed", "1.3.1": "failed" }, [], [["2.1.1", "qualweb", "QW-WCAG-T24"], ["1.3.1", "qualweb", "QW-ACT-R38"]]),
    run("https://twee.test/", { "2.1.1": "passed", "1.3.1": "failed" }, [], [["2.1.1", "qualweb", "QW-WCAG-T24"]]),
    run("https://drie.test/", { "2.1.1": "failed", "1.3.1": "failed" }, [], [["2.1.1", "qualweb", "QW-WCAG-T24"]]),
    run("https://vier.test/", { "2.1.1": "cantTell", "1.3.1": "failed" }),
  ];
  const records = sessionRecords(runs);
  // The rule failed on three sites; the criterion passed on two of them, and failed on one of all four.
  assert.deepEqual(records.get("qualweb\nQW-WCAG-T24"), [{ criterion: "2.1.1", sites: 3, criterionFailed: 1, criterionPassed: 2, criterionOther: 0, base: { sites: 4, failed: 1 } }]);
  // A criterion that fails everywhere says nothing about the rule: the base says so.
  assert.deepEqual(records.get("qualweb\nQW-ACT-R38"), [{ criterion: "1.3.1", sites: 1, criterionFailed: 1, criterionPassed: 0, criterionOther: 0, base: { sites: 4, failed: 4 } }]);
});

test("the criterion counts as it ended in the run the rule failed in, not in another run of the same site", () => {
  const runs = [run("https://een.test/", { "2.1.1": "passed" }, [], [["2.1.1", "alfa", "sia-r84"]]), run("https://een.test/", { "2.1.1": "failed" })];
  // The rule failed in the run that passed the criterion. The other run failed it for a reason this rule had no part in; the base counts it.
  assert.deepEqual(sessionRecords(runs).get("alfa\nsia-r84"), [{ criterion: "2.1.1", sites: 1, criterionFailed: 0, criterionPassed: 1, criterionOther: 0, base: { sites: 1, failed: 1 } }]);
  // Failed in both runs, with a different end: one site, and failed there.
  const twice = [run("https://een.test/", { "2.1.1": "passed" }, [], [["2.1.1", "alfa", "sia-r84"]]), run("https://een.test/", { "2.1.1": "failed" }, [], [["2.1.1", "alfa", "sia-r84"]])];
  assert.deepEqual(sessionRecords(twice).get("alfa\nsia-r84")![0], { criterion: "2.1.1", sites: 1, criterionFailed: 1, criterionPassed: 0, criterionOther: 0, base: { sites: 1, failed: 1 } });
});

test("the register joins the three records per rule and names no site", () => {
  const runs = [
    run("https://een.test/", { "2.4.4": "failed", "2.1.1": "passed" }, [["2.4.4", ["link-name"], "finding"]], [["2.1.1", "qualweb", "QW-WCAG-T24"]]),
    run("https://twee.test/", { "2.4.4": "passed", "2.1.1": "passed" }, [["2.4.4", ["link-name"], "noIssue"]], [["2.1.1", "qualweb", "QW-WCAG-T24"]]),
  ];
  const register = buildRegister({ date: "2026-11-15", catalogue: CATALOGUE, calibration: CALIBRATION as never, runs });
  assert.deepEqual(register.field, { runs: 2, sites: 2, runsWithRulings: 2, runsWithSessions: 2, rulesNotInCatalogue: [] });
  assert.deepEqual(register.calibration, { date: "2026-11-15", engines: { "axe-core": "4.14.0", qualweb: "0.8.6" } });
  assert.deepEqual(register.rules.map((rule) => `${rule.engine} ${rule.rule}`), ["axe-core aria-deprecated-role", "axe-core aria-roles", "axe-core link-name", "axe-core region", "qualweb QW-ACT-R12", "qualweb QW-WCAG-T24"]);
  const link = register.rules.find((rule) => rule.rule === "link-name")!;
  assert.deepEqual([link.kind, link.criteria, link.title, link.calibration!.found, link.rulings!.confirmed, link.rulings!.dismissed, link.sessions], ["act", ["2.4.4", "4.1.2"], "Links must have discernible text", 4, 1, 1, []]);
  // A rule the test cases never set off, and a site did: in no catalogue, with a record from the field.
  const field = buildRegister({ date: "2026-11-15", catalogue: CATALOGUE, calibration: CALIBRATION as never, runs: [run("https://een.test/", { "1.3.1": "failed" }, [], [["1.3.1", "ibm", "aria_region_labelled"]])] });
  const unlisted = field.rules.find((rule) => rule.rule === "aria_region_labelled")!;
  assert.deepEqual([unlisted.engine, unlisted.catalogued, unlisted.criteria, unlisted.calibration, unlisted.sessions.length], ["ibm", false, ["1.3.1"], null, 1]);
  assert.ok(field.rules.filter((rule) => rule !== unlisted).every((rule) => rule.catalogued));
  const technique = register.rules.find((rule) => rule.rule === "QW-WCAG-T24")!;
  assert.deepEqual([technique.kind, technique.calibration, technique.rulings, technique.sessions[0]!.criterionPassed], ["technique", null, null, 2]);
  const text = registerMarkdown(register);
  assert.match(text, /\| QualWeb \| QW-WCAG-T24 \| techniek \| 2\.1\.1 \| 2 \| 0 \| 2 \| 0 van 2 \|/);
  assert.match(text, /\| axe-core \| link-name \| ACT-regel \| 2 \| 1 \| 1 \| 0 \|/);
  assert.doesNotMatch(`${JSON.stringify(register)}${text}`, /een\.test|twee\.test/);
});
