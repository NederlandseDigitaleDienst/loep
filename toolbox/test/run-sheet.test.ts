import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chmodSync } from "node:fs";
import { contribute, contributeAll, contributionNl, contributorKey, defaultKeyFile, manyContributionsNl, runsUnder, sessionElements } from "../src/commands/contribute.ts";
import { buildRegister, type RuleCatalogue } from "../src/lib/rule-register.ts";
import { buildSheet, fieldRunOfSheet, findingsBucket, modelId, populationBucket, sheetLeaks, siteAddress, TECHNOLOGIES, type SheetSource } from "../src/lib/run-sheet.ts";

/** An evaluation with the name and address of the site in every place a sentence can stand. */
const EVALUATION = {
  evaluatedAt: "2026-11-02T22:27:36.379Z",
  site: { baseUrl: "https://www.voorbeeldstad.nl/inwoners/", name: "Voorbeeldstad", organisation: "Gemeente Voorbeeldstad" },
  toolchain: { toolbox: { version: "0.31.0" }, browser: { version: "153.0.8010.12" }, packages: { "axe-core": "4.14.0", "@siteimprove/alfa-rules": "0.120.0", "accessibility-checker-engine": "4.0.34", "@qualweb/act-rules": "0.8.6", "een-ander-pakket": "1.0.0" } },
  judgment: { models: [{ role: "judge", notGiven: 1, models: [{ model: "Claude Opus 5.5 (claude-opus-5-5)", agents: 2 }, { model: "claude-opus-5-5[1m]", agents: 1 }, { model: "Claude Opus 4.5", agents: 4 }] }], extensions: [{ role: "judge", sessions: 56, extended: 5, extensions: 6 }] },
  purpose: "verbeteren",
  technologies: ["HTML", "Web Components (shadow DOM)", "Iets van https://www.voorbeeldstad.nl/"],
  sample: { items: [{ url: "https://www.voorbeeldstad.nl/inwoners/afval" }, { url: "https://www.voorbeeldstad.nl/inwoners/paspoort" }], pageTypes: [{ id: "afval" }], populationSize: 199, documents: [] },
  scope: { frames: [{ address: "https://kaart.voorbeeldstad.nl/" }] },
  defects: [{ severity: "hoog", owner: "techniek", titleNl: "Knop van Voorbeeldstad heeft geen naam" }, { severity: "laag", owner: "content" }, { severity: "hoog", owner: "content" }],
  aiGenerated: { humanReview: { criteriaByPerson: ["2.4.4"] } },
  criteria: [
    {
      id: "2.4.4",
      outcome: "failed",
      basis: "measured",
      agreement: "eens",
      established: { by: "verification", noteNl: "Vastgesteld bij de controle op voorbeeldstad.nl" },
      rounds: { a: "failed", b: null, final: "failed" },
      provenance: { verdictSha256: { a: "aaa1", b: null, final: "fff1" } },
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
    { criterion: "2.4.4", page: "https://www.voorbeeldstad.nl/inwoners/afval", where: "#afvalwijzer > a", verdicts: { "axe-core": "failed", alfa: "failed", ibm: "passed", onbekend: "failed" }, rules: { "axe-core": ["link-name"], alfa: ["sia-r11"], onbekend: ["x"] } },
    // The same element of the same page, asked for by a second agent: counted once.
    { criterion: "2.4.4", page: "https://www.voorbeeldstad.nl/inwoners/afval", where: "#afvalwijzer > a", verdicts: { "axe-core": "failed", alfa: "failed", ibm: "passed" }, rules: { "axe-core": ["link-name"], alfa: ["sia-r11"] } },
    // The same selector on another page is another element.
    { criterion: "2.4.4", page: "https://www.voorbeeldstad.nl/inwoners/paspoort", where: "#afvalwijzer > a", verdicts: { "axe-core": "failed" }, rules: { "axe-core": ["link-name"] } },
    { criterion: "2.1.1", verdicts: { qualweb: "failed" }, rules: { qualweb: ["QW-WCAG-T24"] } },
  ],
  sweepPages: [
    { page: "afval-1a2b", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 2 }, { engine: "alfa", rule: "sia-r66", outcome: "cantTell", nodeCount: 1 }, { engine: "axe-core", rule: "region", outcome: "passed", nodeCount: 9 }] },
    { page: "afval-1a2b", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 2 }] },
    { page: "paspoort-3c4d", results: [{ engine: "axe-core", rule: "link-name", outcome: "failed", nodeCount: 1 }] },
  ],
  steps: [{ command: "collect", seconds: 100 }, { command: "collect", seconds: 20 }, { command: "inventory", seconds: 30 }, { command: "sample" }],
  runMark: "zaad-van-deze-run",
  signed: true,
};

test("a sheet holds rule ids, criteria, outcomes and counts, and no word of the site", () => {
  const sheet = buildSheet(SOURCE, "een-sleutel");
  assert.deepEqual([sheet.kind, sheet.month, sheet.toolbox.version, sheet.browser, sheet.models, sheet.purpose], ["run-sheet", "2026-11", "0.31.0", "153.0.8010.12", ["claude-opus-5-5"], "verbeteren"]);
  assert.deepEqual(sheet.engines, { "axe-core": "4.14.0", alfa: "0.120.0", ibm: "4.0.34", qualweb: "0.8.6" });
  // A label that carries an address is not one of loep's own words: it is left out.
  assert.deepEqual(sheet.technologies, ["HTML", "Web Components (shadow DOM)"]);
  // The pages of the site as a range, and the findings under a criterion too: exact, they tie a sheet to a published report.
  assert.deepEqual(sheet.size, { pages: 2, pageTypes: 1, population: "50-199", documents: 0, frames: 1 });
  assert.deepEqual(sheet.criteria, [
    { id: "1.1.1", outcome: "passed", basis: "observed", agreement: "onvolledig", establishedBy: null, rounds: { a: null, b: null, final: null }, findings: "0", open: {} },
    // Of an open point only the kind: the sentence after it is about the site.
    { id: "2.4.4", outcome: "failed", basis: "measured", agreement: "eens", establishedBy: "verification", rounds: { a: "failed", b: null, final: "failed" }, findings: "1", open: { anders: 1, "mens nodig": 2, "veegronde mist": 1 } },
  ]);
  // A ruling that does not exist and a rule name that is no rule id are not copied.
  assert.deepEqual(sheet.rulings, [
    { rule: "link-name", criterion: "2.4.4", finding: 1, noIssue: 0, otherCriterion: 0, open: 0 },
    { rule: "sia-r11", criterion: "2.4.4", finding: 1, noIssue: 1, otherCriterion: 0, open: 0 },
  ]);
  // On the first element two engines fail and a third passes: agreed, and counted once though two agents asked. On the other page only axe-core has a verdict: alone.
  assert.deepEqual(sheet.sessions, [
    { engine: "alfa", rule: "sia-r11", criterion: "2.4.4", elements: 1, agreed: 1, alone: 0, contradicted: 0 },
    { engine: "axe-core", rule: "link-name", criterion: "2.4.4", elements: 2, agreed: 1, alone: 1, contradicted: 0 },
    { engine: "qualweb", rule: "QW-WCAG-T24", criterion: "2.1.1", elements: 1, agreed: 0, alone: 1, contradicted: 0 },
  ]);
  // Light and dark of one page are one page, and their elements are counted once.
  assert.deepEqual(sheet.sweep, [
    { engine: "alfa", rule: "sia-r66", pagesFailed: 0, pagesCantTell: 1, pagesPassed: 0, elementsFailed: 0 },
    { engine: "axe-core", rule: "link-name", pagesFailed: 2, pagesCantTell: 0, pagesPassed: 0, elementsFailed: 3 },
    { engine: "axe-core", rule: "region", pagesFailed: 0, pagesCantTell: 0, pagesPassed: 1, elementsFailed: 0 },
  ]);
  // Which model ran in which role, with how many agents: the id only, not what an agent wrote around it.
  // An agent that named its model in words without an id still ran: under "other", not gone.
  assert.deepEqual(sheet.modelsPerRole, [{ role: "judge", model: "claude-opus-5-5", agents: 3 }, { role: "judge", model: "other", agents: 4 }, { role: "judge", model: "notGiven", agents: 1 }]);
  assert.deepEqual([sheet.followsUp, sheet.probes, sheet.gate, sheet.quick], [false, null, null, null]);
  assert.deepEqual(sheet.defects, { total: 3, bySeverity: { hoog: 2, laag: 1 }, byOwner: { content: 2, techniek: 1 } });
  assert.deepEqual(sheet.human, { signed: true, criteriaByPerson: 1, decisions: {}, rechecks: 0, statement: null });
  assert.deepEqual(sheet.seconds, { collect: 120, inventory: 30 });
  assert.deepEqual(sheet.sessionsPerRole, [{ role: "judge", sessions: 56, extended: 5, extensions: 6 }]);
  assert.deepEqual(sheetLeaks(sheet, { baseUrl: EVALUATION.site.baseUrl, names: [EVALUATION.site.name, EVALUATION.site.organisation] }), []);
  assert.doesNotMatch(JSON.stringify(sheet), /voorbeeld|afval|paspoort|inwoners|Naam|redacteur|http/i);
});

test("a judge names a rule in its own words: only a name an engine of the run gave is copied", () => {
  const evaluation = { ...EVALUATION, criteria: [{ id: "2.4.4", outcome: "failed", observations: [{ engineRules: ["link-name", "voorbeeldstad", "nav-hoofdmenu", "sia-r11"], ruling: "finding" }] }] };
  const sheet = buildSheet({ ...SOURCE, evaluation, sessionElements: [], sweepPages: [{ page: "p", results: [{ engine: "axe-core", rule: "link-name", outcome: "passed" }] }] }, "een-sleutel");
  // sia-r11 is a real rule, and no engine of this run gave it: not copied either. The sheet takes no one's word for a name.
  assert.deepEqual(sheet.rulings.map((entry) => entry.rule), ["link-name"]);
});

test("the technologies a sheet may name are the ones evaluate can name", () => {
  const source = readFileSync(new URL("../src/commands/evaluate.ts", import.meta.url), "utf8");
  const named = new Set([...source.matchAll(/technologies\.add\("([^"]+)"\)/g)].map((match) => match[1]!));
  for (const label of /const technologies = new Set<string>\(\[([^\]]*)\]\)/.exec(source)![1]!.matchAll(/"([^"]+)"/g)) named.add(label[1]!);
  assert.deepEqual([...named].sort(), [...TECHNOLOGIES].sort());
  assert.deepEqual([findingsBucket(0), findingsBucket(1), findingsBucket(2), findingsBucket(5), findingsBucket(6)], ["0", "1", "2-5", "2-5", "6+"]);
  assert.deepEqual([populationBucket(49), populationBucket(50), populationBucket(199), populationBucket(200), populationBucket(1000), populationBucket(undefined)], ["0-49", "50-199", "50-199", "200-999", "1000+", null]);
});

test("the key of a site is the same for one contributor and different for another", () => {
  const mine = buildSheet(SOURCE, "mijn-sleutel");
  assert.equal(mine.siteKey, buildSheet({ ...SOURCE, runMark: "een-andere-run" }, "mijn-sleutel").siteKey);
  assert.notEqual(mine.siteKey, buildSheet(SOURCE, "hun-sleutel").siteKey);
  assert.match(mine.siteKey, /^[0-9a-f]{16}$/);
  // A site under a path on a shared host is a site of its own; a page deeper is not.
  assert.equal(siteAddress("https://www.voorbeeldstad.nl/inwoners/afval/"), "voorbeeldstad.nl/inwoners");
  // The same site reached another way is the same site: with or without www, over http, by its index file, in capitals.
  for (const address of ["https://voorbeeldstad.nl/", "https://www.voorbeeldstad.nl/", "http://voorbeeldstad.nl/", "https://voorbeeldstad.nl/index.html", "https://WWW.Voorbeeldstad.NL"]) assert.equal(siteAddress(address), "voorbeeldstad.nl/", address);
  // A port tells one site on a machine from another.
  assert.equal(siteAddress("http://localhost:8080/"), "localhost:8080/");
  assert.equal(siteAddress(undefined), null);
  // An evaluation and a quick measurement of one site, from the same contributor: one key, by the start address of the inventory.
  const quick = buildSheet({ ...SOURCE, baseUrl: "https://voorbeeldstad.nl/inwoners/index.html", evaluation: { criteria: [] } }, "mijn-sleutel");
  assert.equal(quick.siteKey, mine.siteKey);
});

test("the id is of the run: the same after it is evaluated or weighed again, another for a second judging or another run", () => {
  const id = (change: Partial<SheetSource>, key = "een-sleutel"): string => buildSheet({ ...SOURCE, ...change }, key).id;
  const first = id({});
  // The evaluation written again: other bytes, a person who established a criterion, a decision more. The same run.
  assert.equal(id({ evaluationText: `${SOURCE.evaluationText} ` }), first);
  const answered = { ...EVALUATION, criteria: EVALUATION.criteria.map((criterion) => ({ ...criterion, outcome: "passed", established: { by: "person" } })) };
  assert.equal(id({ evaluation: answered, decisions: ["opgelost"], signed: false }), first);
  // Who contributes it makes no difference to which run it is.
  assert.equal(id({}, "hun-sleutel"), first);
  // The same sweep judged a second time: other verdicts, another run.
  const again = { ...EVALUATION, criteria: EVALUATION.criteria.map((criterion) => ({ ...criterion, provenance: { verdictSha256: { final: "een-ander-oordeel" } } })) };
  assert.notEqual(id({ evaluation: again }), first);
  // Another run of the same site.
  assert.notEqual(id({ runMark: "een-andere-run" }), first);
  // A run from before a verdict had a hash is told by the outcomes of its rounds.
  const old = (final: string) => ({ ...EVALUATION, criteria: [{ id: "1.1.1", outcome: "passed", rounds: { a: "passed", b: null, final } }] });
  assert.equal(id({ evaluation: old("passed") }), id({ evaluation: { ...old("passed"), criteria: [{ ...old("passed").criteria[0]!, outcome: "failed" }] } }));
  assert.notEqual(id({ evaluation: old("passed") }), id({ evaluation: old("failed") }));
});

test("the check holds a sheet to what it may contain, and a site with an ordinary name or host is not refused", () => {
  const sheet = buildSheet(SOURCE, "een-sleutel");
  // Names that are words of the sheet itself: the field `open`, `siteKey`, a year, a number.
  for (const site of [{ baseUrl: "https://open.overheid.nl/" }, { baseUrl: "https://www.example.nl/jaarverslag/2026/", names: ["Demo site"] }, { baseUrl: "http://127.0.0.1:8080/" }, { baseUrl: "https://www.voorbeeld.nl/", names: ["Open", "HTML", "judge"] }]) {
    assert.deepEqual(sheetLeaks(sheet, site), [], JSON.stringify(site));
  }
  // A host of one word, as in a pipeline: part of "qualweb", "inapplicable", "siteKey" and "untested", and no leak.
  for (const host of ["web", "app", "site", "test", "localhost"]) assert.deepEqual(sheetLeaks(sheet, { baseUrl: `http://${host}:8080/` }), [], host);
  // That same host as a model or a rule an agent gave is one.
  assert.deepEqual(sheetLeaks({ ...sheet, models: ["web"] }, { baseUrl: "http://web:8080/" }), ["de host van de site, in models"]);
  const site = { baseUrl: EVALUATION.site.baseUrl, names: [EVALUATION.site.name, EVALUATION.site.organisation] };
  assert.deepEqual(sheetLeaks(sheet, site), []);
  // The host of the site in a value, with or without www. What is said names the kind and the field, never the value: it is passed on in the open.
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "www.voorbeeldstad.nl" }, site), ["de host van de site, in purpose", "een adres, in purpose"]);
  assert.deepEqual(sheetLeaks({ ...sheet, models: ["voorbeeldstad.nl-model"] }, site), ["de host van de site, in models", "een adres, in models"]);
  // The name of the site where an agent or an engine gave a string: as a model, as a rule.
  assert.deepEqual(sheetLeaks({ ...sheet, models: ["Voorbeeldstad"] }, site), ["de naam van de site, in models"]);
  assert.deepEqual(sheetLeaks({ ...sheet, sweep: [{ ...sheet.sweep[0]!, rule: "voorbeeldstad" }] }, site), ["de naam van de site, in sweep"]);
  // Anything that is not a word of loep, a technology it does not know, a field that is not of a sheet.
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "zie https://elders.test" }, site), ["een waarde die geen woord van loep is, in purpose"]);
  assert.deepEqual(sheetLeaks({ ...sheet, purpose: "elders.nl" }, site), ["een adres, in purpose"]);
  assert.deepEqual(sheetLeaks({ ...sheet, technologies: ["Thema Voorbeeld"] }, site), ["een techniek die loep niet kent, in technologies"]);
  assert.deepEqual(sheetLeaks({ ...sheet, pagina: "x" } as never, site), ["een veld dat niet op een meetblad hoort"]);
  for (const leak of sheetLeaks({ ...sheet, purpose: "www.voorbeeldstad.nl", models: ["Voorbeeldstad"], technologies: ["Thema Voorbeeldstad"] }, site)) assert.doesNotMatch(leak, /voorbeeld/i);
});

test("how a criterion was established is copied as loep writes it, capital and all", () => {
  const by = (value: string) => buildSheet({ ...SOURCE, evaluation: { ...EVALUATION, criteria: [{ id: "2.2.1", outcome: "passed", established: { by: value } }] } }, "een-sleutel").criteria[0]!.establishedBy;
  assert.deepEqual(["verification", "finishing", "person", "sessionWatch"].map(by), ["verification", "finishing", "person", "sessionWatch"]);
  assert.equal(by("iets van voorbeeldstad"), null);
});

test("the id of a model out of what an agent wrote", () => {
  assert.equal(modelId("Claude Opus 5.5 (claude-opus-5-5)"), "claude-opus-5-5");
  assert.equal(modelId("claude-sonnet-5-5"), "claude-sonnet-5-5");
  // A dot in the id is part of it, and a suffix in brackets is not: two spellings of one model are one.
  assert.equal(modelId("claude-opus-4.5"), "claude-opus-4.5");
  assert.equal(modelId("claude-opus-5-5[1m] (Opus 5.5)"), "claude-opus-5-5");
  assert.equal(modelId("Kimi-K3-prepaid"), "kimi-k3-prepaid");
  // No id in the text: null, and the sheet counts the agent under "other". It copies no free text.
  for (const text of ["Claude Opus 4.5", "o3", "gemini 2.5 pro", "onbekend", "niet opgegeven"]) assert.equal(modelId(text), null, text);
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
  // Under the element stand two rules of axe-core: one failed it, one only doubted it. Only the first counts.
  const where = "#afvalwijzer > a";
  const observation = {
    command: "rules",
    page: { url: "https://www.voorbeeldstad.nl/inwoners/afval" },
    result: {
      grouped: { elements: [{ criterion: "2.4.4", where, verdicts: { "axe-core": "failed", ibm: "failed" }, rules: { "axe-core": ["link-name", "link-in-text-block"], ibm: ["a_text_purpose"] } }] },
      methods: [
        { implementation: "axe-core", result: { findings: [{ rule: "link-name", where, outcome: "failed" }, { rule: "link-in-text-block", where, outcome: "cantTell" }] } },
        { implementation: "accessibility-checker-engine", result: { findings: [{ rule: "a_text_purpose", where, outcome: "failed" }] } },
      ],
    },
  };
  writeFileSync(join(run, "observations", "v-244", "0001.json"), JSON.stringify(observation));
  // The same page asked again in another session.
  mkdirSync(join(run, "observations", "a-244"), { recursive: true });
  writeFileSync(join(run, "observations", "a-244", "0001.json"), JSON.stringify(observation));
  mkdirSync(join(run, "signed"));
  writeFileSync(join(run, "signed", "signature.json"), JSON.stringify({ name: "Een Naam", role: "webredacteur" }));
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://www.voorbeeldstad.nl/inwoners/" }));
  writeFileSync(join(run, "observations", "v-244", "0002.json"), JSON.stringify({ command: "look", result: { items: [] } }));
  writeFileSync(join(run, "observations", "v-244", "0003.json"), "{ afgebroken");
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ steps: SOURCE.steps }));
  mkdirSync(join(run, "besluiten"));
  for (const [id, decision] of [["G-1", "opgelost"], ["G-2", "opgelost"], ["G-3", "gepland"]]) writeFileSync(join(run, "besluiten", `${id}.json`), JSON.stringify({ decision, name: "Een Naam", role: "webredacteur", summaryNl: "Hersteld op voorbeeldstad.nl" }));
  writeFileSync(join(run, "besluiten", "index.json"), JSON.stringify({ decisions: 3 }));
  // Two rechecks that were ordered and never measured: no finding was measured again.
  for (const finding of ["VOOR-2.4.4-1a2b", "VOOR-1.1.1-3c4d"]) {
    mkdirSync(join(run, "rechecks", finding, "2026-11-10T10-00-00Z"), { recursive: true });
    writeFileSync(join(run, "rechecks", finding, "2026-11-10T10-00-00Z", "opdracht.json"), JSON.stringify({ criterion: "2.4.4", findings: [{ id: finding, titleNl: "Link van Voorbeeldstad" }] }));
  }
  writeFileSync(join(run, "rechecks", "nametingen.md"), "# Nametingen van voorbeeldstad.nl");
  mkdirSync(join(run, "verklaring"));
  writeFileSync(join(run, "verklaring", "verklaring.json"), JSON.stringify({ status: "B", site: { name: "Voorbeeldstad" }, signature: { name: "Een Naam" } }));
  writeFileSync(join(run, "collect.json"), JSON.stringify({ pages: [{ url: "https://www.voorbeeldstad.nl/", reflow: { horizontalScroll: true, offenders: 0 }, zoom200: { offenders: 2 }, textspacing: { newlyClipped: 1 }, tabwalk: { outcome: "focus-lost" } }, { reflow: { offenders: 1 }, zoom200: { offenders: 0 }, textspacing: { newlyClipped: 0 }, tabwalk: { outcome: "completed" } }, {}] }));
  writeFileSync(join(run, "gate.json"), JSON.stringify({ sufficient: true, exploreRound: 2, resweeps: 1, accepted: [{ textNl: "iets over voorbeeldstad" }] }));
  const before = readdirSync(run).sort();

  const dry = contribute(run, { key: "een-sleutel" });
  assert.deepEqual([dry.file, dry.leaks, dry.sheet.sweep.length, dry.sheet.seconds.collect], [null, [], 3, 120]);
  // The rule that only doubted the element is not among the rules that failed it, and two sessions on one page are one element.
  assert.deepEqual(sessionElements(run).map((element) => element.rules), [{ "axe-core": ["link-name"], ibm: ["a_text_purpose"] }, { "axe-core": ["link-name"], ibm: ["a_text_purpose"] }]);
  assert.deepEqual(dry.sheet.sessions, [
    { engine: "axe-core", rule: "link-name", criterion: "2.4.4", elements: 1, agreed: 1, alone: 0, contradicted: 0 },
    { engine: "ibm", rule: "a_text_purpose", criterion: "2.4.4", elements: 1, agreed: 1, alone: 0, contradicted: 0 },
  ]);
  // What people did with the run, as counts: decisions per kind, findings measured again, the status of the statement. Not who.
  // Signed: the signature stands in signed/signature.json, as `sign` writes it, and not in the evaluation.
  assert.equal(JSON.parse(SOURCE.evaluationText).signature, undefined);
  assert.deepEqual(dry.sheet.human, { signed: true, criteriaByPerson: 1, decisions: { gepland: 1, opgelost: 2 }, rechecks: 0, statement: "B" });
  assert.deepEqual(dry.sheet.probes, { pages: 3, reflow: 2, zoom: 1, textSpacing: 1, tabWalkNotCompleted: 1 });
  assert.deepEqual(dry.sheet.gate, { sufficient: true, exploreRounds: 2, resweeps: 1, accepted: 1 });
  assert.doesNotMatch(JSON.stringify(dry.sheet), /Een Naam|webredacteur|voorbeeld/i);
  assert.match(contributionNl(dry), /Niets geschreven\. Met --out <map> komt het meetblad in die map\. Er wordt niets verstuurd\./);
  assert.match(contributionNl(dry), /Niet erop: het adres en de naam van de site/);
  assert.doesNotMatch(contributionNl(dry), /voorbeeld/i);
  // A refusal names the kind and the field, and not the value: the line is what gets reported, in the open.
  const refused = contributionNl({ sheet: dry.sheet, leaks: ["de host van de site, in purpose"], file: null, evaluatedAt: "" });
  assert.match(refused, /GEWEIGERD: op het meetblad staat iets dat er niet hoort: de host van de site, in purpose\. Het is niet geschreven\./);

  const out = join(folder, "meetbladen");
  const written = contribute(run, { outDir: out, key: "een-sleutel" });
  assert.equal(written.file, join(out, `${written.sheet.id}.json`));
  assert.deepEqual(JSON.parse(readFileSync(written.file!, "utf8")), written.sheet);
  // The run is as it was: a sealed run stays sealed.
  assert.deepEqual(readdirSync(run).sort(), before);
  assert.throws(() => contribute(join(folder, "leeg"), { key: "een-sleutel" }), /alleen een afgerond onderzoek of een snelle meting heeft een meetblad/);
});

test("every finished run under a folder gives a sheet, and the same run in two folders gives one, of the folder evaluated last", () => {
  const root = mkdtempSync(join(tmpdir(), "loep-runs-"));
  const write = (folder: string, evaluation: unknown, mark: string): void => {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "evaluation.json"), typeof evaluation === "string" ? evaluation : JSON.stringify(evaluation));
    writeFileSync(join(root, folder, "manifest.json"), JSON.stringify({ seed: mark }));
  };
  write("voorbeeldstad.nl/2026-11-02", EVALUATION, "run-een");
  // The same run copied and weighed again later: other bytes, a decision more, the same run.
  write("kopie/2026-11-14-weging", { ...EVALUATION, evaluatedAt: "2026-11-14T09:00:00.000Z", purpose: "verantwoorden" }, "run-een");
  // Its evaluation once more in the report of the run is not a run.
  write("voorbeeldstad.nl/2026-11-02/report", EVALUATION, "run-een");
  write("anderestad.nl/pad/2026-11-03", { ...EVALUATION, site: { baseUrl: "https://www.anderestad.nl/", name: "Anderestad" } }, "run-twee");
  write("stuk/2026-11-04", "{ geen json", "run-drie");
  mkdirSync(join(root, "leeg", "2026-11-05"), { recursive: true });
  // A folder that may not be read is passed by and counted, and does not stop the rest.
  mkdirSync(join(root, "dicht"));
  chmodSync(join(root, "dicht"), 0o000);
  const found = runsUnder(root);
  assert.deepEqual(found.runs.map((run) => run.slice(root.length + 1)), ["anderestad.nl/pad/2026-11-03", "kopie/2026-11-14-weging", "stuk/2026-11-04", "voorbeeldstad.nl/2026-11-02"]);
  assert.equal(found.unreadable, process.getuid?.() === 0 ? 0 : 1);

  const out = join(root, "..", `${root.split("/").at(-1)}-meetbladen`);
  const many = contributeAll(root, { outDir: out, key: "een-sleutel" });
  chmodSync(join(root, "dicht"), 0o700);
  assert.deepEqual([many.runs, many.sheets.length, many.written, many.refused], [4, 2, 2, []]);
  assert.equal(many.failed, 1 + found.unreadable);
  assert.deepEqual(readdirSync(out).sort(), many.sheets.map((sheet) => `${sheet.id}.json`).sort());
  // Of the run that stands twice, the sheet of the folder evaluated last.
  assert.deepEqual(many.sheets.map((sheet) => [sheet.month, sheet.purpose]).sort(), [["2026-11", "verantwoorden"], ["2026-11", "verbeteren"]]);
  const text = manyContributionsNl(many, out);
  assert.match(text, /4 afgeronde onderzoeken en snelle metingen gevonden, 2 meetbladen van 2 sites \(1 keer dezelfde run in een andere map\)\./);
  assert.match(text, /mappen waren niet te lezen\.|map was niet te lezen\./);
  assert.match(text, /is het rapport van een onderzoek openbaar, dan kan iemand met toegang tot de verzameling het meetblad eraan koppelen/);
  // What is said about the runs names no folder and no site.
  assert.doesNotMatch(text.replace(out, ""), /voorbeeldstad|anderestad|kopie/);
  // Without a folder to write in: the same count, nothing written.
  assert.deepEqual([contributeAll(root, { key: "een-sleutel" }).written, contributeAll(root, { key: "een-sleutel" }).sheets.length], [0, 2]);
  // A folder that is not there is a mistyped path, not a folder without runs.
  assert.throws(() => runsUnder(join(root, "bestaat-niet")), /bestaat niet of is geen map/);
  assert.throws(() => contributeAll(join(root, "een-bestand-dat-er-niet-is"), { key: "een-sleutel" }), /bestaat niet of is geen map/);
  // A folder that cannot be written in is said out loud: nothing would be contributed.
  writeFileSync(join(root, "een-bestand"), "geen map");
  assert.throws(() => contributeAll(root, { outDir: join(root, "een-bestand", "meetbladen"), key: "een-sleutel" }), /ENOTDIR|EEXIST/);
});

test("a quick measurement gives a sheet too: per rule the places on a strong and on a weak ground, and how the comparison ended", () => {
  const run = join(mkdtempSync(join(tmpdir(), "loep-quick-sheet-")), "run");
  mkdirSync(join(run, "quick"), { recursive: true });
  const count = (path: string, criterion: string, rule: string, strong: boolean, places: number) => ({ path, criterion, rule, element: `a[href="/afvalwijzer"] in nav`, strong, places });
  const summary = {
    kind: "quick",
    site: "https://www.voorbeeldstad.nl/inwoners/",
    finishedAt: "2026-11-15T12:30:14.000Z",
    coverage: { measured: 2 },
    engines: [{ id: "axe-core", version: "4.14.0" }, { id: "qualweb", version: "0.8.6" }, { id: "iets-anders", version: "1" }],
    covering: { layers: ["#cookiemelding"], pages: 2, dismiss: [] },
    counts: [count("/inwoners/", "2.1.1", "qualweb:QW-WCAG-T24", false, 40), count("/inwoners/afval", "2.1.1", "qualweb:QW-WCAG-T24", false, 38), count("/inwoners/", "2.4.4", "axe-core:link-name", true, 2), count("/inwoners/", "2.4.4", "axe-core:link-name", false, 1), count("/inwoners/", "2.4.7", "loep:focus-invisible", true, 12)],
    pages: [{ url: "https://www.voorbeeldstad.nl/inwoners/", title: "Inwoners van Voorbeeldstad" }],
  };
  writeFileSync(join(run, "quick", "summary.json"), JSON.stringify(summary));
  writeFileSync(join(run, "quick", "verschil.json"), JSON.stringify({ ok: false, strict: false, worse: [{ path: "/inwoners/", sentenceNl: "iets op /inwoners/" }], better: [], weak: [{}, {}], unstable: [{}], notMeasured: [] }));
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ toolbox: { version: "0.32.0" }, steps: [{ command: "quick", seconds: 61 }] }));
  const { sheet, leaks } = contribute(run, { key: "een-sleutel" });
  assert.deepEqual(leaks, []);
  assert.deepEqual([sheet.month, sheet.toolbox.version, sheet.engines, sheet.criteria, sheet.size.pages, sheet.seconds], ["2026-11", "0.32.0", { "axe-core": "4.14.0", qualweb: "0.8.6" }, [], 2, { quick: 61 }]);
  assert.deepEqual(sheet.quick, {
    pages: 2,
    dismissed: false,
    covered: true,
    rules: [
      { rule: "axe-core:link-name", criterion: "2.4.4", strong: 2, weak: 1, pages: 1 },
      { rule: "loep:focus-invisible", criterion: "2.4.7", strong: 12, weak: 0, pages: 1 },
      { rule: "qualweb:QW-WCAG-T24", criterion: "2.1.1", strong: 0, weak: 78, pages: 2 },
    ],
    comparison: { ok: false, strict: false, worse: 1, weak: 2, unstable: 1, better: 0, notMeasured: 0 },
  });
  // The same site as the evaluation above, from the same contributor: the same key.
  assert.equal(sheet.siteKey, buildSheet(SOURCE, "een-sleutel").siteKey);
  assert.doesNotMatch(JSON.stringify(sheet), /voorbeeld|inwoners|afval|cookiemelding|http/i);
  assert.match(contributionNl({ sheet, leaks, file: null, evaluatedAt: "" }), /Meetblad [0-9a-f]{16} van een snelle meting: loep 0\.32\.0, 2026-11, 2 pagina's\./);
});

test("the key of a contributor is made once, for that person only, and not by someone who only looks", () => {
  const file = join(mkdtempSync(join(tmpdir(), "loep-sleutel-")), "loep", "bijdrage.sleutel");
  // A look at what a sheet holds writes nothing: a key for that one look, and no file.
  const looking = contributorKey(file, false);
  assert.match(looking, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(file), false);
  const key = contributorKey(file);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(key, looking);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(contributorKey(file), key);
  assert.equal(contributorKey(file, false), key);
  // An empty or short file would make the key of a site guessable: refused.
  writeFileSync(file, "\n");
  assert.throws(() => contributorKey(file), /bevat geen sleutel van 32 tekens of meer/);
  writeFileSync(file, "kort\n");
  assert.throws(() => contributorKey(file, false), /bevat geen sleutel/);
  // An empty XDG_CONFIG_HOME, or one that is no full path, counts as not set: the key must not land in the folder the command runs from.
  const before = process.env.XDG_CONFIG_HOME;
  try {
    for (const value of ["", "relatief/pad"]) {
      process.env.XDG_CONFIG_HOME = value;
      assert.match(defaultKeyFile(), /^\/.*\/\.config\/loep\/bijdrage\.sleutel$/, JSON.stringify(value));
    }
    process.env.XDG_CONFIG_HOME = "/een/eigen/map";
    assert.equal(defaultKeyFile(), "/een/eigen/map/loep/bijdrage.sleutel");
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = before;
  }
});
