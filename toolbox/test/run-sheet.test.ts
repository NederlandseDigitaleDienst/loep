import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contribute, contributeAll, contributionNl, contributorKey, manyContributionsNl, runsUnder } from "../src/commands/contribute.ts";
import { buildRegister, type RuleCatalogue } from "../src/lib/rule-register.ts";
import { buildSheet, fieldRunOfSheet, modelId, sheetLeaks, siteAddress, type SheetSource } from "../src/lib/run-sheet.ts";

/** An evaluation with the name and address of the site in every place a sentence can stand. */
const EVALUATION = {
  evaluatedAt: "2026-11-02T22:27:36.379Z",
  site: { baseUrl: "https://www.voorbeeldstad.nl/inwoners/", name: "Voorbeeldstad", organisation: "Gemeente Voorbeeldstad" },
  toolchain: { toolbox: { version: "0.31.0" }, browser: { version: "153.0.8010.12" }, packages: { "axe-core": "4.14.0", "@siteimprove/alfa-rules": "0.120.0", "accessibility-checker-engine": "4.0.34", "@qualweb/act-rules": "0.8.6", "een-ander-pakket": "1.0.0" } },
  judgment: { models: [{ models: [{ model: "Claude Opus 5.5 (claude-opus-5-5)" }, { model: "claude-opus-5-5" }] }], extensions: [{ role: "judge", sessions: 56, extended: 5, extensions: 6 }] },
  purpose: "verbeteren",
  technologies: ["HTML", "Web Components (shadow DOM)", "Iets van https://www.voorbeeldstad.nl/"],
  sample: { items: [{ url: "https://www.voorbeeldstad.nl/inwoners/afval" }, { url: "https://www.voorbeeldstad.nl/inwoners/paspoort" }], pageTypes: [{ id: "afval" }], populationSize: 199, documents: [] },
  scope: { frames: [{ address: "https://kaart.voorbeeldstad.nl/" }] },
  defects: [{ severity: "hoog", owner: "techniek", titleNl: "Knop van Voorbeeldstad heeft geen naam" }, { severity: "laag", owner: "content" }, { severity: "hoog", owner: "content" }],
  aiGenerated: { humanReview: { criteriaByPerson: ["2.4.4"] } },
  signature: { name: "Een Naam", role: "webredacteur" },
  criteria: [
    {
      id: "2.4.4",
      outcome: "failed",
      basis: "measured",
      agreement: "eens",
      established: { by: "verification", noteNl: "Vastgesteld bij de controle op voorbeeldstad.nl" },
      rounds: { a: "failed", b: null, final: "failed" },
      summaryNl: "Op de pagina over afval van Voorbeeldstad staat een link zonder naam.",
      findings: [{ where: "#afvalwijzer > a", observedNl: "De link naar https://www.voorbeeldstad.nl/inwoners/afval heeft geen naam" }],
      missingNl: ["mens nodig: het formulier achter de inlog van Voorbeeldstad is niet bekeken.", "veegronde mist: de kaart van voorbeeldstad.nl laadde niet", "iets zonder soort over voorbeeldstad"],
      limitsNl: ["mens nodig: nog een punt"],
      observations: [
        { engineRules: ["link-name", "sia-r11"], ruling: "finding", observedNl: "Twee links op voorbeeldstad.nl" },
        { engineRules: ["sia-r11"], ruling: "noIssue" },
        { engineRules: ["link-name"], ruling: "een-uitspraak-die-niet-bestaat" },
        { engineRules: ["https://www.voorbeeldstad.nl/regel"], ruling: "finding" },
      ],
    },
    { id: "1.1.1", outcome: "passed", basis: "observed", agreement: "onvolledig", established: null, rounds: null, findings: [], observations: [] },
  ],
};

const SOURCE: SheetSource = {
  evaluationText: JSON.stringify(EVALUATION),
  evaluation: EVALUATION,
  sessionElements: [
    { criterion: "2.4.4", where: "#afvalwijzer > a", message: "Link has no name", verdicts: { "axe-core": "failed", alfa: "failed", ibm: "passed", onbekend: "failed" }, rules: { "axe-core": ["link-name"], alfa: ["sia-r11"], onbekend: ["x"] } } as never,
    { criterion: "2.4.4", verdicts: { "axe-core": "failed" }, rules: { "axe-core": ["link-name"] } },
    { criterion: "2.1.1", verdicts: { qualweb: "failed" }, rules: { qualweb: ["QW-WCAG-T24"] } },
  ],
  sweepPages: [
    { page: "afval-1a2b", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 2 }, { engine: "alfa", rule: "sia-r66", outcome: "cantTell", nodeCount: 1 }, { engine: "axe-core", rule: "region", outcome: "passed", nodeCount: 9 }] },
    { page: "afval-1a2b", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 2 }] },
    { page: "paspoort-3c4d", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 1 }] },
  ],
  steps: [{ command: "collect", seconds: 100 }, { command: "collect", seconds: 20 }, { command: "inventory", seconds: 30 }, { command: "sample" }],
};

test("a sheet holds rule ids, criteria, outcomes and counts, and no word of the site", () => {
  const sheet = buildSheet(SOURCE, "een-sleutel");
  assert.deepEqual([sheet.kind, sheet.month, sheet.toolbox.version, sheet.browser, sheet.models, sheet.purpose], ["run-sheet", "2026-11", "0.31.0", "153.0.8010.12", ["claude-opus-5-5"], "verbeteren"]);
  assert.deepEqual(sheet.engines, { "axe-core": "4.14.0", alfa: "0.120.0", ibm: "4.0.34", qualweb: "0.8.6" });
  // A label that carries an address is not one of loep's own words: it is left out.
  assert.deepEqual(sheet.technologies, ["HTML", "Web Components (shadow DOM)"]);
  assert.deepEqual(sheet.size, { pages: 2, pageTypes: 1, population: 199, documents: 0, frames: 1 });
  assert.deepEqual(sheet.criteria, [
    { id: "1.1.1", outcome: "passed", basis: "observed", agreement: "onvolledig", establishedBy: null, rounds: { a: null, b: null, final: null }, findings: 0, open: {} },
    // Of an open point only the kind: the sentence after it is about the site.
    { id: "2.4.4", outcome: "failed", basis: "measured", agreement: "eens", establishedBy: "verification", rounds: { a: "failed", b: null, final: "failed" }, findings: 1, open: { anders: 1, "mens nodig": 2, "veegronde mist": 1 } },
  ]);
  // A ruling that does not exist and a rule name that is no rule id are not copied.
  assert.deepEqual(sheet.rulings, [
    { rule: "link-name", criterion: "2.4.4", finding: 1, noIssue: 0, otherCriterion: 0, open: 0 },
    { rule: "sia-r11", criterion: "2.4.4", finding: 1, noIssue: 1, otherCriterion: 0, open: 0 },
  ]);
  assert.deepEqual(sheet.sessions, [
    { engine: "alfa", rule: "sia-r11", criterion: "2.4.4", elements: 1 },
    { engine: "axe-core", rule: "link-name", criterion: "2.4.4", elements: 2 },
    { engine: "qualweb", rule: "QW-WCAG-T24", criterion: "2.1.1", elements: 1 },
  ]);
  // Light and dark of one page are one page, and their elements are counted once.
  assert.deepEqual(sheet.sweep, [
    { engine: "alfa", rule: "sia-r66", pagesFailed: 0, pagesCantTell: 1, elementsFailed: 0 },
    { engine: "axe-core", rule: "link-name", pagesFailed: 2, pagesCantTell: 0, elementsFailed: 3 },
  ]);
  assert.deepEqual(sheet.defects, { total: 3, bySeverity: { hoog: 2, laag: 1 }, byOwner: { content: 2, techniek: 1 } });
  assert.deepEqual(sheet.human, { signed: true, criteriaByPerson: 1 });
  assert.deepEqual(sheet.seconds, { collect: 120, inventory: 30 });
  assert.deepEqual(sheet.sessionsPerRole, [{ role: "judge", sessions: 56, extended: 5, extensions: 6 }]);
  assert.deepEqual(sheetLeaks(sheet, { baseUrl: EVALUATION.site.baseUrl, names: [EVALUATION.site.name, EVALUATION.site.organisation] }), []);
  assert.doesNotMatch(JSON.stringify(sheet), /voorbeeld|afval|paspoort|inwoners|Naam|redacteur|http/i);
});

test("the key of a site is the same for one contributor and different for another, and the id is of the run", () => {
  const mine = buildSheet(SOURCE, "mijn-sleutel");
  const again = buildSheet({ ...SOURCE, evaluationText: `${SOURCE.evaluationText} ` }, "mijn-sleutel");
  const theirs = buildSheet(SOURCE, "hun-sleutel");
  assert.equal(mine.siteKey, again.siteKey);
  assert.notEqual(mine.siteKey, theirs.siteKey);
  // Another evaluation of the same site is another run.
  assert.notEqual(mine.id, again.id);
  assert.equal(mine.id, theirs.id);
  assert.match(mine.siteKey, /^[0-9a-f]{16}$/);
  // A site under a path on a shared host is a site of its own; a page deeper is not.
  assert.equal(siteAddress("https://www.voorbeeldstad.nl/inwoners/afval/"), "https://www.voorbeeldstad.nl/inwoners");
  assert.equal(siteAddress("https://www.voorbeeldstad.nl/"), "https://www.voorbeeldstad.nl/");
  assert.equal(siteAddress(undefined), null);
});

test("the check finds a word of the site when a sheet does carry one", () => {
  const sheet = buildSheet(SOURCE, "een-sleutel");
  const site = { baseUrl: EVALUATION.site.baseUrl, names: [EVALUATION.site.name, EVALUATION.site.organisation] };
  assert.deepEqual(sheetLeaks({ ...sheet, technologies: ["Thema van Voorbeeldstad"] }, site), ["voorbeeldstad"]);
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "www.voorbeeldstad.nl" }, site), ["voorbeeldstad", "www.voorbeeldstad.nl"]);
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "/inwoners/" }, site), ["inwoners"]);
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "zie https://elders.test" }, site), ["een adres (http)"]);
});

test("the id of a model out of what an agent wrote", () => {
  assert.equal(modelId("Claude Opus 5.5 (claude-opus-5-5)"), "claude-opus-5-5");
  assert.equal(modelId("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(modelId("Kimi-K3-prepaid"), "kimi-k3-prepaid");
  assert.equal(modelId("niet opgegeven"), null);
});

test("the register reads a sheet as it reads the run: the same record either way", () => {
  const catalogue: RuleCatalogue = { "axe-core": { "link-name": { act: ["c487ae"], criteria: ["2.4.4", "4.1.2"] } }, alfa: { "sia-r11": { act: ["c487ae"], criteria: ["2.4.4", "4.1.2"] } }, qualweb: { "QW-WCAG-T24": { act: [], criteria: ["2.1.1"] } } };
  const calibration = { date: "2026-11-15", instruments: [], rules: [] };
  const run = fieldRunOfSheet(buildSheet(SOURCE, "een-sleutel"));
  const register = buildRegister({ date: "2026-11-15", catalogue, calibration: calibration as never, runs: [run] });
  const link = register.rules.find((rule) => rule.rule === "link-name")!;
  assert.deepEqual(link.rulings, { sites: 1, confirmed: 1, dismissed: 0, other: 0, rulings: { finding: 1, noIssue: 0, otherCriterion: 0, open: 0 } });
  assert.deepEqual(link.sessions, [{ criterion: "2.4.4", sites: 1, criterionFailed: 1, criterionPassed: 0, criterionOther: 0, base: { sites: 1, failed: 1 } }]);
  assert.deepEqual(register.rules.find((rule) => rule.rule === "sia-r11")!.rulings!.rulings, { finding: 1, noIssue: 1, otherCriterion: 0, open: 0 });
  // The criterion of the technique rule is not in this evaluation: no outcome to hold it against.
  assert.deepEqual(register.rules.find((rule) => rule.rule === "QW-WCAG-T24")!.sessions, []);
});

test("contribute reads a run, writes nothing in it, and writes the sheet under its id only when asked", () => {
  const folder = mkdtempSync(join(tmpdir(), "loep-contribute-"));
  const run = join(folder, "run");
  mkdirSync(join(run, "pages", "afval-1a2b"), { recursive: true });
  mkdirSync(join(run, "observations", "v-244"), { recursive: true });
  writeFileSync(join(run, "evaluation.json"), SOURCE.evaluationText);
  writeFileSync(join(run, "pages", "afval-1a2b", "engines-light.json"), JSON.stringify({ results: SOURCE.sweepPages[0]!.results }));
  writeFileSync(join(run, "observations", "v-244", "0001.json"), JSON.stringify({ command: "rules", result: { grouped: { elements: [SOURCE.sessionElements[1]] } } }));
  writeFileSync(join(run, "observations", "v-244", "0002.json"), JSON.stringify({ command: "look", result: { items: [] } }));
  writeFileSync(join(run, "observations", "v-244", "0003.json"), "{ afgebroken");
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ steps: SOURCE.steps }));
  const before = readdirSync(run).sort();

  const dry = contribute(run, { key: "een-sleutel" });
  assert.deepEqual([dry.file, dry.leaks, dry.sheet.sessions.length, dry.sheet.sweep.length, dry.sheet.seconds.collect], [null, [], 1, 2, 120]);
  assert.match(contributionNl(dry), /Niets geschreven\. Met --out <map> komt het meetblad in die map\. Er wordt niets verstuurd\./);
  assert.match(contributionNl(dry), /Niet erop: het adres en de naam van de site/);
  assert.doesNotMatch(contributionNl(dry), /voorbeeld/i);

  const out = join(folder, "meetbladen");
  const written = contribute(run, { outDir: out, key: "een-sleutel" });
  assert.equal(written.file, join(out, `${written.sheet.id}.json`));
  assert.deepEqual(JSON.parse(readFileSync(written.file!, "utf8")), written.sheet);
  // The run is as it was: a sealed run stays sealed.
  assert.deepEqual(readdirSync(run).sort(), before);
  assert.throws(() => contribute(join(folder, "leeg"), { key: "een-sleutel" }), /alleen een afgerond onderzoek heeft een meetblad/);
});

test("every finished run under a folder gives a sheet, and a copy of a run gives the same sheet once", () => {
  const root = mkdtempSync(join(tmpdir(), "loep-runs-"));
  const write = (folder: string, text: string): void => {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "evaluation.json"), text);
  };
  write("voorbeeldstad.nl/2026-11-02", SOURCE.evaluationText);
  // The same run in another folder, and its evaluation once more in the report of the run.
  write("kopie/2026-11-02", SOURCE.evaluationText);
  write("voorbeeldstad.nl/2026-11-02/report", SOURCE.evaluationText);
  write("anderestad.nl/pad/2026-11-03", JSON.stringify({ ...EVALUATION, evaluatedAt: "2026-11-03T10:00:00.000Z", site: { baseUrl: "https://www.anderestad.nl/", name: "Anderestad" } }));
  write("stuk/2026-11-04", "{ geen json");
  mkdirSync(join(root, "leeg", "2026-11-05"), { recursive: true });
  assert.deepEqual(runsUnder(root).map((run) => run.slice(root.length + 1)), ["anderestad.nl/pad/2026-11-03", "kopie/2026-11-02", "stuk/2026-11-04", "voorbeeldstad.nl/2026-11-02"]);

  const out = join(root, "..", `${root.split("/").at(-1)}-meetbladen`);
  const many = contributeAll(root, { outDir: out, key: "een-sleutel" });
  assert.deepEqual([many.runs, many.sheets.length, many.written, many.refused, many.failed], [4, 2, 2, [], 1]);
  assert.deepEqual(readdirSync(out).sort(), many.sheets.map((sheet) => `${sheet.id}.json`).sort());
  const text = manyContributionsNl(many, out);
  assert.match(text, /4 afgeronde onderzoeken gevonden, 2 meetbladen van 2 sites \(1 keer dezelfde run in een andere map\)\./);
  assert.match(text, /1 map was niet te lezen\./);
  // What is said about the runs names no folder and no site.
  assert.doesNotMatch(text.replace(out, ""), /voorbeeldstad|anderestad|kopie/);
  // Without a folder to write in: the same count, nothing written.
  assert.deepEqual([contributeAll(root, { key: "een-sleutel" }).written, contributeAll(root, { key: "een-sleutel" }).sheets.length], [0, 2]);
});

test("the key of a contributor is made once, for that person only, and read after that", () => {
  const file = join(mkdtempSync(join(tmpdir(), "loep-sleutel-")), "loep", "bijdrage.sleutel");
  const key = contributorKey(file);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(contributorKey(file), key);
  assert.ok(existsSync(file));
});
