import assert from "node:assert/strict";
import { readDossierInFull } from "./fixtures/dossier-reads.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { answer } from "../src/commands/answer.ts";
import { gatherVerdicts } from "../src/commands/evaluate.ts";
import { BUDGETS, checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, NO_VERDICT_NL, skip, unruledCrossPoints, type InstrumentTask } from "../src/commands/instrument-tasks.ts";
import { render } from "../src/commands/render.ts";
import { writeEvaluation } from "../src/commands/sign.ts";
import { checkSeal, seal } from "../src/commands/verify.ts";
import { type CriterionResult, type Evaluation, openCriteria, resolveCriterion, summarise } from "../src/lib/evaluation.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { deriveReport, renderMarkdown } from "../src/lib/report-markdown.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { FINISH_FACTOR, openPoint, type Verdict } from "../src/lib/verdict.ts";
import { criterionById } from "../src/lib/wcag.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

// The finishing round and the answers of a person, on a run as small as task generation allows.
// Every criterion here ends "cantTell" after the verifier, each for another reason.
const HOME = "https://site.test/";
const CONTACT = "https://site.test/contact/";
const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const SWEEP = "veegronde mist: het geopende menu is vooraf niet op het smalle scherm gemeten op de contactpagina.";
const BUDGET = "budget op: de vergrote weergave is op een van de twee pagina's bekeken; de contactpagina is niet bekeken.";
const PROBE = "proef werkte niet: de meting met ruimere tekstafstand gaf op de startpagina geen antwoord.";
const PERSON = "mens nodig: of de melding na het versturen door een schermlezer wordt voorgelezen, is met een schermlezer na te gaan op de contactpagina.";
const CHOICE = "keuze nodig: of de afbeelding in de kop een logo is, bepaalt de eigenaar van de site.";

function makeRun(only: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "loep-finish-"));
  dirs.push(dir);
  const run = {
    dir,
    inventory: { baseUrl: HOME },
    writes: null,
    pages: [{ label: "P1", item: { url: HOME } }, { label: "P2", item: { url: CONTACT } }],
    siteModel: { version: 1, baseUrl: HOME, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: HOME, pages: [HOME] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
  } as unknown as RunData;
  const options = { run, only, buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: {} } }) };
  const write = (path: string, value: unknown): void => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  let made = 0;
  /** A recorded observation, as a session writes it. */
  const observe = (session: string, command: string, error: string | null = null): string => {
    const id = `${session}-${String(++made).padStart(4, "0")}`;
    write(join("observations", session, `${String(made).padStart(4, "0")}.json`), { id, command, error, state: { id: "s1", start: { url: HOME }, steps: [] }, target: null, page: { url: HOME }, result: {} });
    return id;
  };
  write("sample.json", { items: [{ url: HOME }, { url: CONTACT }] });
  const digits = (id: string): string => id.replaceAll(".", "");
  const task = async (id: string): Promise<InstrumentTask> => (await loadInstrumentIndex(dir)).tasks.find((entry) => entry.criterion === id)!;
  const seen = (evidence: string[], ruling: "noIssue" | "open" | "finding" = "noIssue", finding?: string): Verdict["observations"][number] => ({ checkedNl: "De pagina's van de steekproef", howNl: "Bekeken en gemeten in de sessie", observedNl: "Wat er op de pagina staat, zoals gemeten", evidence, ruling, ...(finding ? { finding } : {}) });
  /** The session file of a session that used its budget and extended it as often as it may. */
  const extendedTwice = (session: string): void =>
    write(join("observations", session, "session.json"), { session, startedAt: "2026-01-01T10:00:00.000Z", commands: 160, limits: { maxCommands: 160, maxMinutes: 60 }, extensions: [1, 2].map(() => ({ at: "2026-01-01T10:20:00.000Z", reasonNl: "De contactpagina is nog niet vergroot bekeken.", commands: 40, minutes: 15, usedCommands: 80, usedMinutes: 12 })) });
  /** Judge and verifier both leave the criterion open with these points. */
  const leaveOpen = async (id: string, points: string[]): Promise<void> => {
    const open = (session: string): Verdict => ({ criterion: id, outcome: "cantTell", rule: "R9", summaryNl: "Er is geen afwijking gezien, maar niet alles is vastgesteld.", observations: [seen([observe(session, "look")], "open")], findings: [], missingNl: points });
    write(join("verdicts", id, "oordeel.json"), open(`b-${digits(id)}`));
    if (points.some((point) => point.startsWith("budget op:"))) {
      // A point about the budget is only accepted from a session that extended twice.
      assert.match((await checkInstrumentVerdict(dir, id, "judge")).join("\n"), /"budget op:" may only stand in the verdict of a session that extended its budget 2 times, and session "b-\d+" did so 0 times/);
      extendedTwice(`b-${digits(id)}`);
    }
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "judge"), [], `judge ${id}`);
  };
  const verifyOpen = async (id: string, points: string[]): Promise<void> => {
    const session = `v-${digits(id)}`;
    const look = observe(session, "look");
    if (points.some((point) => point.startsWith("budget op:"))) extendedTwice(session);
    write(join("verdicts", id, "final.json"), { criterion: id, outcome: "cantTell", rule: "R9", summaryNl: "Ook bij de controle is niet alles vastgesteld.", observations: [seen([look], "open")], findings: [], missingNl: points, verification: { judgeOutcome: "cantTell", findings: [], attackNl: "Geprobeerd het open punt te beslechten met een tweede blik op de startpagina.", attackEvidence: [look] } } satisfies Verdict);
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "final"), [], `final ${id}`);
  };
  /** The observations a pass has to cite for this criterion, made in the given session. */
  const passEvidence = async (id: string, session: string): Promise<string[]> => (readDossierInFull(dir, session, id), [observe(session, "look"), ...(await task(id)).passCommands.map((command) => observe(session, command))]);
  return { dir, options, write, observe, digits, task, seen, leaveOpen, verifyOpen, passEvidence };
}

const CRITERIA = { sweep: "1.3.4", budget: "1.4.4", probe: "1.4.12", mixed: "2.2.1", person: "1.4.5", none: "1.4.3", passed: "1.4.11" };
const flow = makeRun(Object.values(CRITERIA));
const { dir } = flow;
const finding = (evidence: string[]): Verdict["findings"][number] => ({ key: "F1", titleNl: "Tekst valt weg bij vergroten", observedNl: "Bij 200% vergroting valt de laatste regel van de inleiding buiten beeld.", impactNl: "Slechtzienden missen een deel van de tekst.", fixNl: "Laat de tekst meegroeien met het venster en meet opnieuw op 320 pixels en op een tussenbreedte.", severity: "hoog", owner: "techniek", component: null, locations: [{ page: "P2", where: "inleiding", wholePage: true }], pagesAffected: "gemeten op P2", evidence });

test("a run with open criteria of every kind gets a finishing task for what the evaluation itself left open, and none for what asks a person", async () => {
  await instrumentTasks(dir, flow.options);
  await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(dir, flow.options);
  const points: Record<string, string[]> = { [CRITERIA.sweep]: [SWEEP], [CRITERIA.budget]: [BUDGET], [CRITERIA.probe]: [PROBE], [CRITERIA.mixed]: [PERSON, SWEEP], [CRITERIA.person]: [PERSON, CHOICE] };
  for (const [id, missing] of Object.entries(points)) await flow.leaveOpen(id, missing);
  // One judge passes, and one never gives a valid verdict.
  flow.write(join("verdicts", CRITERIA.passed, "oordeel.json"), { criterion: CRITERIA.passed, outcome: "passed", rule: "R6", summaryNl: "Randen en pictogrammen steken genoeg af op de bekeken pagina's.", observations: [flow.seen(await flow.passEvidence(CRITERIA.passed, `b-${flow.digits(CRITERIA.passed)}`))], findings: [] });
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.passed, "judge"), []);
  await skip(dir, { criterion: CRITERIA.none }, "De agent leverde twee keer geen geldig oordeel.");
  assert.equal((await instrumentTasks(dir, flow.options)).finishers, 0, "while a verifier is still out, nobody knows which criteria need the round");
  assert.equal((await instrumentPending(dir)).phase, "verifiers");
  assert.deepEqual((await instrumentPending(dir)).finishers, []);

  for (const [id, missing] of Object.entries(points)) await flow.verifyOpen(id, missing);
  const attack = await flow.passEvidence(CRITERIA.passed, `v-${flow.digits(CRITERIA.passed)}`);
  flow.write(join("verdicts", CRITERIA.passed, "final.json"), { criterion: CRITERIA.passed, outcome: "passed", rule: "R6", summaryNl: "Ook bij de controle steken randen en pictogrammen genoeg af.", observations: [flow.seen(attack)], findings: [], verification: { judgeOutcome: "passed", findings: [], attackNl: "Gezocht naar een rand die te licht is op de contactpagina; geen gevonden.", attackEvidence: attack } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.passed, "final"), []);

  // Every verifier is in: the phase is the finishing round, and the tasks are not written yet.
  const before = await instrumentPending(dir);
  assert.equal(before.phase, "finishers");
  assert.match(before.noteNl, /Draai `tasks`/);
  assert.deepEqual(await instrumentTasks(dir, flow.options), { walks: 1, judges: 7, verifiers: 6, finishers: 5 });
  const index = await loadInstrumentIndex(dir);
  const withTask = index.tasks.filter((entry) => entry.finish).map((entry) => entry.criterion).sort();
  assert.deepEqual(withTask, [CRITERIA.sweep, CRITERIA.none, CRITERIA.budget, CRITERIA.probe, CRITERIA.mixed].sort());
  assert.ok(!(await flow.task(CRITERIA.person)).finish, "a criterion that only waits for a person or a choice gets no finishing round");
  assert.ok(!(await flow.task(CRITERIA.passed)).finish);
  assert.equal(index.finishDecided, true);
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "finishers");
  assert.deepEqual(pending.finishers.map((entry) => entry.criterion).sort(), withTask);
  assert.deepEqual(pending.finishers.find((entry) => entry.criterion === CRITERIA.sweep)!.session, "a-134");

  // The task names the open points to the letter, with the earlier verdict and a budget of its own.
  const mixed = (await flow.task(CRITERIA.mixed)).finish!;
  assert.deepEqual(mixed.points, [PERSON, SWEEP], "every open point is listed, also the one that asks a person");
  const prompt = readFileSync(join(dir, mixed.prompt), "utf8");
  assert.doesNotMatch(prompt, /\{\{\w+\}\}/, "no placeholder is left");
  assert.ok(prompt.includes(`werkmap: \`${join(dir, "werk", mixed.session)}\``) && existsSync(join(dir, "werk", mixed.session)), "the finisher has a work folder of its own session");
  assert.ok(prompt.includes(`1. ${PERSON}`) && prompt.includes(`2. ${SWEEP}`));
  assert.ok(prompt.includes(join(dir, "verdicts", CRITERIA.mixed, "final.json")) && prompt.includes(join(dir, "tasks", CRITERIA.mixed, "dossier.json")));
  assert.deepEqual([BUDGETS.finish.commands, BUDGETS.finish.minutes], [BUDGETS.judge.commands * FINISH_FACTOR, BUDGETS.judge.minutes * FINISH_FACTOR]);
  assert.ok(FINISH_FACTOR >= 3 && FINISH_FACTOR <= 4, "three to four times what a judge gets");
  assert.match(prompt, new RegExp(`session start --run \\S+ --session a-221 --max-commands ${BUDGETS.finish.commands} --max-minutes ${BUDGETS.finish.minutes} `));
  assert.match(prompt, /check-verdict --run \S+ --criterion 2\.2\.1 --round finish/);
  // A verdict that never came is an open point of the evaluation too.
  const none = (await flow.task(CRITERIA.none)).finish!;
  assert.deepEqual(none.points, [NO_VERDICT_NL]);
  assert.match(readFileSync(join(dir, none.prompt), "utf8"), /Er is geen eerder oordeel/);
});

test("a finishing verdict that still names missing coverage or a spent budget is refused, and an instrument that did not work needs a real attempt", async () => {
  const session = "a-134";
  const look = flow.observe(session, "look");
  const still = (missingNl: string[], extra: Partial<Verdict["finish"]> = {}): Verdict => ({ criterion: CRITERIA.sweep, outcome: "cantTell", rule: "R9", summaryNl: "Het menu is opnieuw bekeken, maar niet overal gemeten.", observations: [flow.seen([look], "open")], findings: [], missingNl, finish: { points: [{ point: 1, settled: false, howNl: "Het menu is op één pagina bekeken, niet op de andere.", evidence: [look] }], coverageNl: "Gemeten op 1 van de 2 pagina's, alleen breed.", findings: [], ...extra } });
  const out = join("verdicts", CRITERIA.sweep, "afmaak.json");
  flow.write(out, still([SWEEP]));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /missingNl\[0\]: "veegronde mist:" cannot stay after the finishing round/);
  flow.write(out, still([BUDGET]));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /"budget op:" cannot stay after the finishing round/);
  assert.equal((await instrumentPending(dir)).finishers.some((entry) => entry.criterion === CRITERIA.sweep), true, "a refused verdict leaves the task open");
  // An instrument that did not work: said, tried in more than one way, and shown in the log.
  flow.write(out, still([PROBE]));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /stays open only after a real attempt/);
  flow.write(out, still([PROBE], { attempts: [{ missing: 1, triedNl: "De meting is op de startpagina gestart en gaf geen antwoord.", evidence: [look] }] }));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /cite at least 2 observations of session "a-134"/);
  const failed = flow.observe(session, "spacing", "geen antwoord binnen de tijd");
  flow.write(out, still([PROBE], { attempts: [{ missing: 1, triedNl: "De meting is op de startpagina gestart en daarna op de contactpagina; beide keren kwam er geen antwoord.", evidence: [look, failed] }] }));
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish"), []);
  // What asks a person may stay; every point of the task is accounted for; no verifier's block.
  flow.write(out, { ...still([PERSON]), finish: { points: [], coverageNl: "Gemeten op 2 van de 2 pagina's.", findings: [] } });
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /finish\.points, point 1: every point of the task needs exactly one entry/);
  flow.write(out, still([PERSON]));
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish"), []);
  // A pass settles every point, with an observation of the finisher's own session.
  const evidence = await flow.passEvidence(CRITERIA.sweep, session);
  const passed: Verdict = { criterion: CRITERIA.sweep, outcome: "passed", rule: "R5", summaryNl: "Het geopende menu werkt staand en liggend op beide pagina's.", observations: [flow.seen(evidence)], findings: [], finish: { points: [{ point: 1, settled: false, howNl: "Het menu is op één pagina bekeken, niet op de andere.", evidence }], coverageNl: "Gemeten op 2 van de 2 pagina's, breed en op 320 pixels, met het menu open.", findings: [] } };
  flow.write(out, passed);
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /a "passed" outcome settles every point that stood open/);
  flow.write(out, { ...passed, finish: { ...passed.finish!, points: [{ point: 1, settled: true, howNl: "Het menu is op beide pagina's geopend op 320 pixels en bekeken.", evidence: [flow.observe("v-134", "look")] }] } });
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish")).join("\n"), /a settled point needs at least one look or measure observation of session "a-134"/);
  flow.write(out, { ...passed, finish: { ...passed.finish!, points: [{ point: 1, settled: true, howNl: "Het menu is op beide pagina's geopend op 320 pixels en bekeken.", evidence }] } });
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.sweep, "finish"), []);
  assert.equal((await instrumentPending(dir)).finishers.some((entry) => entry.criterion === CRITERIA.sweep), false);
});

test("a finding of the finishing round is shown twice, the second time from a fresh page", async () => {
  const session = "a-144";
  const first = flow.observe(session, "zoom");
  const second = flow.observe(session, "zoom");
  const verdict = (finish: Verdict["finish"]): Verdict => ({ criterion: CRITERIA.budget, outcome: "failed", rule: "R1", summaryNl: "Op de contactpagina valt tekst weg bij 200% vergroting.", observations: [flow.seen([first], "finding", "F1")], findings: [finding([first, second])], finish });
  const points = [{ point: 1, settled: true, howNl: "De contactpagina is op 200% bekeken en gemeten.", evidence: [first] }];
  const coverageNl = "Gemeten op 2 van de 2 pagina's op 200% vergroting.";
  const out = join("verdicts", CRITERIA.budget, "afmaak.json");
  flow.write(out, verdict({ points, coverageNl, findings: [] }));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.budget, "finish")).join("\n"), /finish\.findings "F1": every finding needs exactly one entry/);
  flow.write(out, verdict({ points, coverageNl, findings: [{ key: "F1", first: [first], repeated: [second] }] }));
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.budget, "finish")).join("\n"), /has to be seen again from a fresh page/);
  flow.observe(session, "open");
  const again = flow.observe(session, "zoom");
  flow.write(out, { ...verdict({ points, coverageNl, findings: [{ key: "F1", first: [first], repeated: [again] }] }), findings: [finding([first, again])] });
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.budget, "finish"), []);
});

/** The criterion as `evaluate` resolves it, from what the run holds. */
async function resolved(id: string): Promise<CriterionResult> {
  const gathered = await gatherVerdicts(dir, await flow.task(id));
  return resolveCriterion({ criterion: criterionById(id)!, verdicts: gathered.verdicts, answers: gathered.answers, procedure: null, provenance: { dossierSha256: null, verdictSha256: gathered.hashes } }, "SITE");
}

/** The example evaluation with the criteria of this run in it. */
async function evaluationOfRun(): Promise<Evaluation> {
  const evaluation = exampleEvaluation();
  const mine = new Map<string, CriterionResult>();
  for (const id of Object.values(CRITERIA)) mine.set(id, await resolved(id));
  const criteria = evaluation.criteria.map((criterion) => mine.get(criterion.id) ?? criterion);
  return { ...evaluation, criteria, summary: summarise(criteria), defects: undefined };
}

test("a valid finishing verdict is the final outcome, the earlier verdict is kept, and the report says how it was established", async () => {
  const sweep = await resolved(CRITERIA.sweep);
  assert.equal(sweep.outcome, "passed");
  assert.deepEqual(sweep.rounds, { a: "cantTell", b: null, final: "cantTell", finish: "passed" });
  assert.equal(sweep.established?.by, "finishing");
  assert.deepEqual(sweep.established?.before, { roundNl: "controle", outcome: "cantTell", summaryNl: "Ook bij de controle is niet alles vastgesteld.", missingNl: [SWEEP] });
  assert.deepEqual(sweep.missingNl, []);
  assert.ok(existsSync(join(dir, "verdicts", CRITERIA.sweep, "final.json")), "the verdict of the verifier stays in the run");
  assert.ok(typeof sweep.provenance.verdictSha256.finish === "string" && typeof sweep.provenance.verdictSha256.final === "string");
  const budget = await resolved(CRITERIA.budget);
  assert.equal(budget.outcome, "failed");
  assert.deepEqual(budget.findings.map((entry) => entry.titleNl), ["Tekst valt weg bij vergroten"]);
  // A criterion without a finishing round is established by the verifier, as before.
  const passed = await resolved(CRITERIA.passed);
  assert.equal(passed.established?.by, "verification");
  assert.ok(!("finish" in passed.rounds) && !("finish" in passed.provenance.verdictSha256));

  const evaluation = await evaluationOfRun();
  // `evaluate` marks a finding of the finishing round as seen twice by the same agent.
  evaluation.criteria.find((criterion) => criterion.id === CRITERIA.budget)!.findings[0]!.verification = { status: "repeated", evidence: [] };
  const markdown = renderMarkdown(evaluation);
  const derived = deriveReport(evaluation);
  assert.equal(derived.briefs[CRITERIA.sweep]!.establishedNl, "aanvullende meting");
  assert.equal(derived.briefs[CRITERIA.passed]!.establishedNl, "controle");
  assert.match(derived.briefs[CRITERIA.sweep]!.certaintyNl, /^Vastgesteld in een aanvullende meting: .* Daarvoor kwam de controle op kan niet bepalen\.$/);
  assert.equal(derived.briefs[CRITERIA.sweep]!.coverageNl, "Gemeten op 2 van de 2 pagina's, breed en op 320 pixels, met het menu open.");
  assert.match(markdown, /^\| \[1\.3\.4 [^|]+\| AA \| ● Voldoet \| aanvullende meting \| 0 \|$/m);
  assert.ok(markdown.includes("Eerste beoordeling: Kan niet bepalen. Controle: Kan niet bepalen. Aanvullende meting, tevens eindoordeel: Voldoet."));
  assert.ok(markdown.includes(`- Stond open: ${SWEEP.replace(/\.$/, "")}`), "what stood open before the round is kept in the appendix");
  assert.ok(markdown.includes("Controle: Uit de aanvullende meting, twee keer gezien door één beoordelaar"));
  assert.match(markdown, /\*\*Afmaken\.\*\* Bleef een criterium na de controle open door een beperking van het onderzoek/);
  assert.ok(!derived.quiet.includes(CRITERIA.sweep), "an outcome from the finishing round keeps its block in the main part");
});

test("the report counts honestly: what asks a person apart from what the evaluation did not establish, and says when it is not finished", async () => {
  const evaluation = await evaluationOfRun();
  const open = openCriteria(evaluation.criteria);
  // The probe that did not work is still out, and so is the verdict that never came: both are the evaluation's.
  assert.ok(open.evaluation.includes(CRITERIA.probe) && open.evaluation.includes(CRITERIA.none) && open.evaluation.includes(CRITERIA.mixed));
  assert.ok(open.owner.includes(CRITERIA.person) && !open.evaluation.includes(CRITERIA.person));
  assert.ok(!open.owner.includes(CRITERIA.sweep) && !open.evaluation.includes(CRITERIA.sweep), "what the finishing round settled is not open");
  const line = deriveReport(evaluation).statusLine;
  assert.equal(line.unfinished, true);
  assert.match(line.openNl, new RegExp(`^Open criteria: ${open.owner.length + open.evaluation.length}\\. ${open.owner.length} vra(agt|gen) een mens of een keuze van de eigenaar \\([^)]*1\\.4\\.5[^)]*\\); ${open.evaluation.length} (is|zijn) door dit onderzoek niet vastgesteld \\([^)]*1\\.4\\.12[^)]*\\)\\. Zolang er een criterium open is, is status A of B niet mogelijk\\.`));
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.indexOf("**Het onderzoek is onvolledig.** Open criteria:") < markdown.indexOf("## Samenvatting"), "it stands at the top, with the status");
  // With nothing open through the evaluation itself the report says what is left for a person, and nothing about unfinished.
  const closed = evaluation.criteria.map((criterion) => (open.evaluation.includes(criterion.id) ? { ...criterion, outcome: "passed" as const, missingNl: [] } : criterion));
  const done = deriveReport({ ...evaluation, criteria: closed, summary: summarise(closed) }).statusLine;
  // The rule for the status itself did not change: a criterion that waits for a person still means C.
  assert.match(done.headingNl, /status: C/i);
  assert.equal(done.unfinished, false);
  // A reason that holds for no criterion is left out, and with one reason the count is not repeated.
  assert.match(done.openNl, new RegExp(`^Open criteria: ${open.owner.length}, vra(agt|gen) een mens of een keuze van de eigenaar \\([^)]*\\)\\. Daar kan geen instrument verder mee`));
  assert.doesNotMatch(done.openNl, /\b0 (is|zijn)\b/);
  const none = closed.map((criterion) => (criterion.outcome === "cantTell" || criterion.outcome === "untested" ? { ...criterion, outcome: "passed" as const, missingNl: [] } : criterion));
  assert.equal(deriveReport({ ...evaluation, criteria: none, summary: summarise(none) }).statusLine.openNl, "Open criteria: geen. Elk criterium heeft een oordeel.");
});

const PERSON_NAME = "Een Toetser";

test("the answer of a person closes a criterion, stands in the report and under the seal, and the name is not in the report", async () => {
  // What the evaluation itself left open goes to the finishing round first.
  await assert.rejects(answer({ run: dir, criterion: CRITERIA.mixed, point: 1, did: "Met een schermlezer de melding beluisterd op de contactpagina.", outcome: "passed", name: PERSON_NAME, role: "Toetser" }), /nog geen afmaakronde gehad/);
  await assert.rejects(answer({ run: dir, criterion: CRITERIA.passed }), /geen open punt om te beantwoorden/);

  const listed = await answer({ run: dir, criterion: CRITERIA.person });
  assert.deepEqual(listed.points.map((point) => [point.number, point.kindNl, point.answered]), [[1, "mens nodig", null], [2, "keuze nodig", null]]);
  assert.equal(listed.written, null, "without a point nothing is written");
  assert.ok(!existsSync(join(dir, "antwoorden")));
  const given = { run: dir, criterion: CRITERIA.person, name: PERSON_NAME, role: "Toetser" };
  await assert.rejects(answer({ ...given, point: 3, did: "Met een schermlezer de melding beluisterd.", outcome: "passed" }), /--point is het nummer van een open punt: 1 tot en met 2/);
  await assert.rejects(answer({ ...given, point: 1, did: "Gedaan.", outcome: "passed" }), /--did zegt wat de persoon heeft gedaan/);
  await assert.rejects(answer({ ...given, point: 1, did: "Met een schermlezer de melding beluisterd.", outcome: "cantTell" }), /--outcome is de uitkomst/);
  await assert.rejects(answer({ run: dir, criterion: CRITERIA.person, point: 1, did: "Met een schermlezer de melding beluisterd.", outcome: "passed", role: "Toetser" }), /de naam staat alleen in antwoorden/);

  // One of two points answered: the criterion is still open, with the point that is left.
  const one = await answer({ ...given, point: 1, did: "Met VoiceOver in Safari het formulier op de contactpagina verstuurd; de melding wordt voorgelezen.", outcome: "passed" });
  assert.deepEqual([one.written, one.left], [join("antwoorden", `${CRITERIA.person}.json`), 1]);
  const half = await resolved(CRITERIA.person);
  assert.deepEqual([half.outcome, half.missingNl, half.established?.by, half.answers?.length], ["cantTell", [CHOICE], "verification", 1]);
  // Both answered: the outcome is the person's, and it says so.
  await answer({ ...given, point: 2, did: "De afbeelding in de kop is het logo van de organisatie; dat is zo besloten.", outcome: "passed", role: "Eigenaar van de site" });
  const closed = await resolved(CRITERIA.person);
  assert.equal(closed.outcome, "passed");
  assert.equal(closed.established?.by, "person");
  assert.match(closed.established!.noteNl, /^Vastgesteld door een persoon, niet door een instrument \(functie: Toetser, Eigenaar van de site\)/);
  assert.deepEqual(closed.missingNl, []);
  assert.deepEqual(closed.rounds, { a: "cantTell", b: null, final: "cantTell" }, "what the agents concluded stays as it was");
  assert.ok(!JSON.stringify(closed).includes(PERSON_NAME), "the evaluation carries the role, not the name");
  assert.ok(readFileSync(join(dir, "antwoorden", `${CRITERIA.person}.json`), "utf8").includes(PERSON_NAME), "the name stands in the file of the run");

  // After its finishing round a criterion that still asks a person can be answered; a point found failing fails it.
  const look = flow.observe("a-221", "look");
  flow.write(join("verdicts", CRITERIA.mixed, "afmaak.json"), { criterion: CRITERIA.mixed, outcome: "cantTell", rule: "R9", summaryNl: "Het menu is nu gemeten; wat een schermlezer voorleest blijft open.", observations: [flow.seen([look], "open")], findings: [], missingNl: [PERSON], finish: { points: [{ point: 1, settled: false, howNl: "Geen instrument van de sessie kan dit vaststellen.", evidence: [] }, { point: 2, settled: true, howNl: "Het menu is op 320 pixels geopend en gemeten.", evidence: [look] }], coverageNl: "Gemeten op 2 van de 2 pagina's op 320 pixels.", findings: [] } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.mixed, "finish"), []);
  await answer({ run: dir, criterion: CRITERIA.mixed, point: 1, did: "Met NVDA in Firefox het formulier verstuurd; de melding wordt niet voorgelezen.", outcome: "failed", name: PERSON_NAME, role: "Toetser" });
  const failed = await resolved(CRITERIA.mixed);
  assert.deepEqual([failed.outcome, failed.established?.by, failed.established?.before?.roundNl, failed.rounds.finish], ["failed", "person", "aanvullende meting", "cantTell"]);

  // In the report: who established it, by function; and in the run: sealed with everything else.
  const evaluation = await evaluationOfRun();
  const markdown = renderMarkdown(evaluation);
  assert.ok(!markdown.includes(PERSON_NAME), "the report does not name the person");
  assert.match(markdown, /^\| \[1\.4\.5 [^|]+\| AA \| ● Voldoet \| een persoon \| 0 \|$/m);
  assert.ok(markdown.includes("Zekerheid: Vastgesteld door een persoon, niet door een instrument (functie: Toetser, Eigenaar van de site)."));
  assert.ok(markdown.includes("Een persoon, niet een instrument, tevens eindoordeel: Voldoet."));
  assert.match(markdown, /Antwoord van een persoon \(functie: Toetser, \d+ \w+ \d{4}\): Met VoiceOver in Safari het formulier op de contactpagina verstuurd; de melding wordt voorgelezen\. Uitkomst op dit punt: voldoet\./);
  assert.match(markdown, /\*\*Door een persoon vastgesteld\*\*\n\n[^\n]+\n\n- \[2\.2\.1 [^\]]+\]\(#sc-2\.2\.1\): Met NVDA in Firefox het formulier verstuurd; de melding wordt niet voorgelezen \(functie: Toetser\)/);
  assert.ok(!openCriteria(evaluation.criteria).owner.includes(CRITERIA.person), "an answered criterion is no longer open");

  await writeEvaluation(join(dir, "evaluation.json"), evaluation);
  await writeManifest(dir, { command: "evaluate" });
  const report = await render(dir);
  assert.ok(!readFileSync(report.markdown, "utf8").includes(PERSON_NAME));
  assert.ok(!readFileSync(join(dir, "evaluation.json"), "utf8").includes(PERSON_NAME));
  if (report.pdf !== null) assert.deepEqual(report.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  await seal(dir);
  const sealed = Object.keys(JSON.parse(readFileSync(join(dir, "evidence-index.json"), "utf8")).files);
  assert.ok(sealed.includes(`antwoorden/${CRITERIA.person}.json`) && sealed.includes(`antwoorden/${CRITERIA.mixed}.json`) && sealed.includes(`verdicts/${CRITERIA.sweep}/afmaak.json`), "the answers and the finishing verdicts are sealed with the run");
  // An answer that is changed after the seal is seen.
  const path = join(dir, "antwoorden", `${CRITERIA.person}.json`);
  writeFileSync(path, readFileSync(path, "utf8").replace("VoiceOver", "een schermlezer"));
  assert.deepEqual((await checkSeal(dir))!.problems, [`gewijzigd: antwoorden/${CRITERIA.person}.json`]);
});

test("an answer belongs to the verdict it was given to: after another verdict it no longer counts", async () => {
  // The verifier of the criterion writes another final verdict: the answers were given to the earlier one.
  const id = CRITERIA.person;
  const look = flow.observe(`v-${flow.digits(id)}`, "look");
  flow.write(join("verdicts", id, "final.json"), { criterion: id, outcome: "cantTell", rule: "R9", summaryNl: "Na een tweede controle staat alleen de keuze nog open.", observations: [flow.seen([look], "open")], findings: [], missingNl: [CHOICE], verification: { judgeOutcome: "cantTell", findings: [], attackNl: "Opnieuw gekeken naar de afbeelding in de kop van de startpagina.", attackEvidence: [look] } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, id, "final"), []);
  const gathered = await gatherVerdicts(dir, await flow.task(id));
  assert.deepEqual(gathered.answers, []);
  assert.deepEqual(gathered.rejected, [`${id}/answer: 2 given to an earlier verdict`]);
  assert.equal((await resolved(id)).outcome, "cantTell");
});

test("a run without a criterion that the evaluation left open skips the phase and behaves as before", async () => {
  const small = makeRun([CRITERIA.passed, CRITERIA.person]);
  await instrumentTasks(small.dir, small.options);
  await skip(small.dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(small.dir, small.options);
  await small.leaveOpen(CRITERIA.person, [PERSON]);
  const judged = await small.passEvidence(CRITERIA.passed, "b-1411");
  small.write(join("verdicts", CRITERIA.passed, "oordeel.json"), { criterion: CRITERIA.passed, outcome: "passed", rule: "R6", summaryNl: "Randen en pictogrammen steken genoeg af op de bekeken pagina's.", observations: [small.seen(judged)], findings: [] });
  assert.deepEqual(await checkInstrumentVerdict(small.dir, CRITERIA.passed, "judge"), []);
  await instrumentTasks(small.dir, small.options);
  await small.verifyOpen(CRITERIA.person, [PERSON]);
  const attack = await small.passEvidence(CRITERIA.passed, "v-1411");
  small.write(join("verdicts", CRITERIA.passed, "final.json"), { criterion: CRITERIA.passed, outcome: "passed", rule: "R6", summaryNl: "Ook bij de controle steken randen en pictogrammen genoeg af.", observations: [small.seen(attack)], findings: [], verification: { judgeOutcome: "passed", findings: [], attackNl: "Gezocht naar een rand die te licht is op de contactpagina; geen gevonden.", attackEvidence: attack } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(small.dir, CRITERIA.passed, "final"), []);

  assert.deepEqual(await instrumentTasks(small.dir, small.options), { walks: 1, judges: 2, verifiers: 2, finishers: 0 });
  const pending = await instrumentPending(small.dir);
  assert.deepEqual([pending.phase, pending.finishers, pending.verifiers], ["done", [], []]);
  assert.match(pending.noteNl, /Ga door met `evaluate`/);
  const index = await loadInstrumentIndex(small.dir);
  assert.ok(index.tasks.every((entry) => !entry.finish), "no task has a finishing round");
  assert.ok(!existsSync(join(small.dir, "tasks", CRITERIA.person, "afmaak.md")) && !existsSync(join(small.dir, "tasks", CRITERIA.passed, "afmaak.md")));
  assert.match((await checkInstrumentVerdict(small.dir, CRITERIA.passed, "finish")).join(), /no task for the finishing round/);
  await assert.rejects(skip(small.dir, { criterion: CRITERIA.passed, round: "finish" }, "Er is geen afmaakronde voor dit criterium."), /exists in this run/);
  // The outcome is that of the verifier, with the shape an evaluation always had.
  const gathered = await gatherVerdicts(small.dir, index.tasks.find((entry) => entry.criterion === CRITERIA.passed)!);
  assert.deepEqual(Object.keys(gathered.hashes), ["a", "b", "final"]);
  const result = resolveCriterion({ criterion: criterionById(CRITERIA.passed)!, verdicts: gathered.verdicts, answers: gathered.answers, procedure: null, provenance: { dossierSha256: null, verdictSha256: gathered.hashes } }, "SITE");
  assert.deepEqual([result.outcome, result.rounds, result.established?.by, result.answers], ["passed", { a: "passed", b: null, final: "passed" }, "verification", undefined]);
});

test("what a judge passes on to another criterion counts there: unruled it leaves the criterion open, and without a verifier the finishing round gets it", async () => {
  const cross = makeRun([CRITERIA.person, CRITERIA.passed]);
  await instrumentTasks(cross.dir, cross.options);
  await skip(cross.dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(cross.dir, cross.options);
  // The judge of 1.4.5 sees something that belongs to 1.4.11 and passes it on; the judge of 1.4.11 never gives a verdict.
  const look = cross.observe("b-145", "look");
  const crop = cross.observe("b-145", "crop");
  cross.write(join("verdicts", CRITERIA.person, "oordeel.json"), { criterion: CRITERIA.person, outcome: "cantTell", rule: "R9", summaryNl: "Er is geen afwijking gezien, maar niet alles is vastgesteld.", observations: [cross.seen([look], "open"), { ...cross.seen([crop]), ruling: "otherCriterion" }], findings: [], missingNl: [PERSON], crossCandidates: [{ criterion: CRITERIA.passed, page: "P1", where: "rand van het zoekveld", evidence: [crop], noteNl: "De rand van het zoekveld is lichtgrijs op wit." }] } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(cross.dir, CRITERIA.person, "judge"), []);
  await skip(cross.dir, { criterion: CRITERIA.passed }, "De agent leverde twee keer geen geldig oordeel.");
  await instrumentTasks(cross.dir, cross.options);
  await cross.verifyOpen(CRITERIA.person, [PERSON]);
  assert.equal((await instrumentTasks(cross.dir, cross.options)).finishers, 1);
  const finish = (await cross.task(CRITERIA.passed)).finish!;
  assert.deepEqual((JSON.parse(readFileSync(join(cross.dir, finish.candidates), "utf8")) as { id: string }[]).map((candidate) => candidate.id), ["X145-01"], "without a verifier, the finishing round rules on what was passed on");

  // A verdict that ruled on it says nothing more; one that did not leaves the criterion open, with a point for the finishing round.
  const judged = new Map([[CRITERIA.person, JSON.parse(readFileSync(join(cross.dir, "verdicts", CRITERIA.person, "oordeel.json"), "utf8")) as Verdict]]);
  const passed: Verdict = { criterion: CRITERIA.passed, outcome: "passed", rule: "R6", summaryNl: "Randen steken genoeg af.", observations: [cross.seen([look])], findings: [] };
  const ruled: Verdict = { ...passed, candidates: [{ id: "X145-01", ruling: "noIssue", reasonNl: "Gemeten: de rand is 3,4 op 1.", evidence: [look] }] };
  assert.deepEqual(unruledCrossPoints(judged, CRITERIA.passed, [null, ruled]), []);
  const points = unruledCrossPoints(judged, CRITERIA.passed, [null, passed]);
  assert.deepEqual(points, ["veegronde mist: de beoordelaar van 1.4.5 zag op P1 (rand van het zoekveld) iets dat bij dit criterium hoort, en geen verifieerder of afmaakronde heeft dat beoordeeld (X145-01): De rand van het zoekveld is lichtgrijs op wit."]);
  assert.equal(openPoint(points[0]!).kind?.reader, "toolbox", "the evaluation itself is not finished");
  const base = { criterion: criterionById(CRITERIA.passed)!, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  const open = resolveCriterion({ ...base, verdicts: { a: null, final: null, finish: passed }, unruledNl: points }, "SITE");
  assert.equal(open.outcome, "cantTell");
  assert.deepEqual(open.missingNl, points);
  assert.match(open.summaryNl, /^Niet vastgesteld: een waarneming die een andere beoordelaar doorgaf, is door niemand beoordeeld\. Het oordeel zonder die waarneming was voldoet: /);
  assert.deepEqual(openCriteria([open]).evaluation, [CRITERIA.passed]);
  // A failure stays a failure: what was passed on can only add to it.
  assert.equal(resolveCriterion({ ...base, verdicts: { a: null, final: null, finish: { ...passed, outcome: "failed", findings: [finding([look])] } }, unruledNl: points }, "SITE").outcome, "failed");
});
