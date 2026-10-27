import assert from "node:assert/strict";
import { readDossierInFull } from "./fixtures/dossier-reads.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gatherVerdicts } from "../src/commands/evaluate.ts";
import { briefPending, checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, recordAttempts, skip, type InstrumentTask } from "../src/commands/instrument-tasks.ts";
import { BLOCKADES_FILE } from "../src/session/blockade.ts";
import { type CriterionResult, openCriteria, resolveCriterion, summarise } from "../src/lib/evaluation.ts";
import { deriveReport, renderMarkdown } from "../src/lib/report-markdown.ts";
import type { RunData } from "../src/lib/rundata.ts";
import type { Verdict } from "../src/lib/verdict.ts";
import { criterionById } from "../src/lib/wcag.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

// A part of the site that did not load during the evaluation, and a new finishing round once it loads again.
const HOME = "https://www.example.nl/";
const CONTACT = "https://www.example.nl/contact/";
const UNREACHABLE = "niet bereikbaar: het chatvenster op P2 (https://chat.example.nl/widget) laadde niet, ook los geopend, tussen 14:05 en 14:40; de andere pagina's laadden wel.";
const PERSON = "mens nodig: of de melding na het versturen door een schermlezer wordt voorgelezen, is met een schermlezer na te gaan op de contactpagina.";
const CRITERIA = { unreachable: "2.4.3", person: "1.4.5", passed: "1.4.11" };

const dir = mkdtempSync(join(tmpdir(), "loep-again-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const run = {
  dir,
  inventory: { baseUrl: HOME },
  writes: null,
  pages: [{ label: "P1", item: { url: HOME } }, { label: "P2", item: { url: CONTACT } }],
  siteModel: { version: 1, baseUrl: HOME, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: HOME, pages: [HOME] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
} as unknown as RunData;
const options = { run, only: Object.values(CRITERIA), buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: {} } }) };
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
const digitsOf = (id: string): string => id.replaceAll(".", "");
const task = async (id: string): Promise<InstrumentTask> => (await loadInstrumentIndex(dir)).tasks.find((entry) => entry.criterion === id)!;
const seen = (evidence: string[], ruling: "noIssue" | "open" = "noIssue"): Verdict["observations"][number] => ({ checkedNl: "De pagina's van de steekproef", howNl: "Bekeken en gemeten in de sessie", observedNl: "Wat er op de pagina staat, zoals gemeten", evidence, ruling });
const passEvidence = async (id: string, session: string): Promise<string[]> => (readDossierInFull(dir, session, id), [observe(session, "look"), ...(await task(id)).passCommands.map((command) => observe(session, command))]);
const again = (ids: string[]): ReturnType<typeof instrumentTasks> => instrumentTasks(dir, { ...options, again: ids });

/** Every round leaves a probe that did not work or a part that did not load only after a real attempt in its own session (#318). */
const attemptsFor = (points: string[], session: string): Verdict["attempts"] => {
  const tried = points.flatMap((point, position) => (/^(proef werkte niet|niet bereikbaar):/.test(point) ? [{ missing: position + 1, triedNl: "Het deel twee keer opnieuw geopend, met tijd ertussen, en het venster bekeken.", evidence: [observe(session, "open"), observe(session, "look")] }] : []));
  return tried.length > 0 ? tried : undefined;
};

async function judgeAndVerify(id: string, outcome: "cantTell" | "passed", points: string[]): Promise<void> {
  const judge = `b-${digitsOf(id)}`;
  const judgeEvidence = outcome === "passed" ? await passEvidence(id, judge) : [observe(judge, "look")];
  write(join("verdicts", id, "oordeel.json"), { criterion: id, outcome, rule: "R9", summaryNl: "Wat de beoordeling vaststelde op de bekeken pagina's.", observations: [seen(judgeEvidence, outcome === "passed" ? "noIssue" : "open")], findings: [], ...(points.length > 0 ? { missingNl: points, attempts: attemptsFor(points, judge) } : {}) } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, id, "judge"), [], `judge ${id}`);
}

async function verify(id: string, outcome: "cantTell" | "passed", points: string[]): Promise<void> {
  const session = `v-${digitsOf(id)}`;
  const evidence = outcome === "passed" ? await passEvidence(id, session) : [observe(session, "look")];
  write(join("verdicts", id, "final.json"), { criterion: id, outcome, rule: "R9", summaryNl: "Ook bij de controle is dit wat vaststaat.", observations: [seen(evidence, outcome === "passed" ? "noIssue" : "open")], findings: [], ...(points.length > 0 ? { missingNl: points, attempts: attemptsFor(points, session) } : {}), verification: { judgeOutcome: outcome, findings: [], attackNl: "Geprobeerd het oordeel onderuit te halen met een tweede blik op de contactpagina.", attackEvidence: evidence } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, id, "final"), [], `final ${id}`);
}

/** The criterion as `evaluate` resolves it, from what the run holds. */
async function resolved(id: string): Promise<CriterionResult> {
  const gathered = await gatherVerdicts(dir, await task(id));
  return resolveCriterion({ criterion: criterionById(id)!, verdicts: gathered.verdicts, answers: gathered.answers, procedure: null, provenance: { dossierSha256: null, verdictSha256: gathered.hashes } }, "SITE");
}

test("a part of the site that did not load gets a finishing round, and stays open after it as not established by the evaluation", async () => {
  await instrumentTasks(dir, options);
  await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(dir, options);
  await judgeAndVerify(CRITERIA.unreachable, "cantTell", [UNREACHABLE]);
  await judgeAndVerify(CRITERIA.person, "cantTell", [PERSON]);
  await judgeAndVerify(CRITERIA.passed, "passed", []);
  await instrumentTasks(dir, options);
  // Before the finishing round is decided, no new one can be asked for.
  await assert.rejects(again([CRITERIA.unreachable]), /--again: 2\.4\.3 kan nog geen nieuwe afmaakronde krijgen/);
  await verify(CRITERIA.unreachable, "cantTell", [UNREACHABLE]);
  await verify(CRITERIA.person, "cantTell", [PERSON]);
  await verify(CRITERIA.passed, "passed", []);

  // A part that did not load is not the owner's: the criterion gets a finishing round, the one that waits for a person does not.
  assert.equal((await instrumentTasks(dir, options)).finishers, 1);
  const pending = await instrumentPending(dir);
  assert.deepEqual([pending.phase, pending.finishers.map((entry) => [entry.criterion, entry.session])], ["finishers", [[CRITERIA.unreachable, "a-243"]]]);
  const prompt = readFileSync(join(dir, (await task(CRITERIA.unreachable)).finish!.prompt), "utf8");
  assert.ok(prompt.includes("`niet bereikbaar:`"), "the task of the finishing round names the kind and when to use it");

  // The finisher tries again, twice and in more than one way, and the part still does not load.
  const session = "a-243";
  const look = observe(session, "look");
  const failed = observe(session, "open", "page.goto: Timeout 45000ms exceeded");
  const still: Verdict = {
    criterion: CRITERIA.unreachable,
    outcome: "cantTell",
    rule: "R9",
    summaryNl: "Het chatvenster laadde ook bij de aanvullende meting niet; de rest is gemeten.",
    observations: [seen([look, failed], "open")],
    findings: [],
    missingNl: [UNREACHABLE],
    finish: { points: [{ point: 1, settled: false, howNl: "Het chatvenster in de pagina en los geopend; het laadde niet.", evidence: [look, failed] }], coverageNl: "Gemeten op 2 van de 2 pagina's, zonder het chatvenster.", findings: [] },
  };
  write(join("verdicts", CRITERIA.unreachable, "afmaak.json"), still);
  assert.match((await checkInstrumentVerdict(dir, CRITERIA.unreachable, "finish")).join("\n"), /a part of the site that did not load stays open only after a real attempt/);
  write(join("verdicts", CRITERIA.unreachable, "afmaak.json"), { ...still, finish: { ...still.finish!, attempts: [{ missing: 1, triedNl: "Het chatvenster op de contactpagina geopend en daarna los; beide keren een time-out, om 14:05 en om 14:40.", evidence: [look, failed] }] } });
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.unreachable, "finish"), []);
  assert.equal((await instrumentPending(dir)).phase, "done");

  // After an outage of the site pending names it for a new finishing round, but only when the verdict was written before the site answered again.
  assert.equal((await instrumentPending(dir)).again, undefined);
  const outage = (back: number): void => write(BLOCKADES_FILE, { origins: [{ origin: "https://www.example.nl", reason: "outage", at: new Date(back - 600_000).toISOString(), until: new Date(back - 300_000).toISOString(), url: HOME, back: new Date(back).toISOString() }] });
  outage(Date.now() - 3_600_000);
  assert.equal((await instrumentPending(dir)).again, undefined);
  outage(Date.now() + 60_000);
  const back = await instrumentPending(dir);
  assert.deepEqual([back.phase, back.again, briefPending(back).again], ["done", [CRITERIA.unreachable], [CRITERIA.unreachable]]);
  assert.match(back.noteNl, /zet een nieuwe afmaakronde klaar met tasks --again 2\.4\.3 en draai daarna pending\.$/);
  rmSync(join(dir, BLOCKADES_FILE));

  // evaluate counts it as not established by the evaluation, and the report says what did not load and when.
  const criterion = await resolved(CRITERIA.unreachable);
  assert.deepEqual([criterion.outcome, criterion.missingNl], ["cantTell", [UNREACHABLE]]);
  const evaluation = exampleEvaluation();
  const mine = new Map([[CRITERIA.unreachable, criterion], [CRITERIA.person, await resolved(CRITERIA.person)]]);
  const criteria = evaluation.criteria.map((entry) => mine.get(entry.id) ?? entry);
  const withRun = { ...evaluation, criteria, summary: summarise(criteria), defects: undefined };
  const open = openCriteria(criteria);
  assert.ok(open.evaluation.includes(CRITERIA.unreachable) && !open.owner.includes(CRITERIA.unreachable));
  const derived = deriveReport(withRun);
  assert.equal(derived.statusLine.unfinished, true);
  assert.match(derived.statusLine.openNl, /bleef er 1 open doordat een deel van de site tijdens het onderzoek niet bereikbaar was \([^)]*2\.4\.3[^)]*\)/);
  assert.deepEqual(derived.todo.investigate.unreachable.map((group) => [group.criterion, group.pointsNl]), [[CRITERIA.unreachable, [UNREACHABLE.replace(/^niet bereikbaar: h/, "H")]]]);
  assert.ok(!derived.todo.investigate.toolbox.some((group) => group.criterion === CRITERIA.unreachable), "not counted as a limit of loep");
  assert.match(renderMarkdown(withRun), /\*\*Niet bereikbaar tijdens het onderzoek\*\*\n\n[^\n]+\n\n- (<a id="[^"]+"><\/a>)?\[2\.4\.3 [^\n]+\n {2}- Het chatvenster op P2 \(https:\/\/chat\.example\.nl\/widget\) laadde niet, ook los geopend, tussen 14:05 en 14:40/);
});

test("tasks --again refuses a criterion that is not open with a part that did not load or a probe that did not work", async () => {
  await assert.rejects(again([CRITERIA.passed]), /--again: het eindoordeel van 1\.4\.11 staat niet open met een punt "proef werkte niet" of "niet bereikbaar"/);
  await assert.rejects(again([CRITERIA.person]), /--again: het eindoordeel van 1\.4\.5 staat niet open/);
  await assert.rejects(again(["9.9.9"]), /--again: "9\.9\.9" is geen succescriterium/);
  await assert.rejects(again(["1.1.1"]), /--again: 1\.1\.1 heeft geen opdracht in deze run/);
  // Nothing was set aside by a refusal.
  assert.ok(existsSync(join(dir, "verdicts", CRITERIA.unreachable, "afmaak.json")) && !existsSync(join(dir, "verdicts", CRITERIA.unreachable, "afmaak-1.json")));
  assert.equal((await instrumentPending(dir)).phase, "done");
});

test("tasks --again writes a new finishing round after done, with a session of its own, keeps the earlier verdict, and the new one counts", async () => {
  // The attempts the workflow counted for the earlier round do not carry over to the new one; those of other tasks stay through every tasks.
  await recordAttempts(dir, [`finishers:${CRITERIA.unreachable}`, `judges:${CRITERIA.unreachable}`]);
  await instrumentTasks(dir, options);
  assert.deepEqual((await loadInstrumentIndex(dir)).attempts, { [`finishers:${CRITERIA.unreachable}`]: 1, [`judges:${CRITERIA.unreachable}`]: 1 });
  assert.equal((await again([CRITERIA.unreachable])).finishers, 1);
  assert.deepEqual((await loadInstrumentIndex(dir)).attempts, { [`judges:${CRITERIA.unreachable}`]: 1 });
  const finish = (await task(CRITERIA.unreachable)).finish!;
  assert.deepEqual([finish.session, finish.points, finish.earlier], ["a-243-2", [UNREACHABLE], [join("verdicts", CRITERIA.unreachable, "afmaak-1.json")]]);
  // The earlier verdict, its stamp and its task stay in the run under a number.
  for (const kept of ["verdicts/2.4.3/afmaak-1.json", "verdicts/2.4.3/afmaak-1.stamp.json", "tasks/2.4.3/afmaak-1.md"]) assert.ok(existsSync(join(dir, kept)), kept);
  assert.ok(!existsSync(join(dir, "verdicts", CRITERIA.unreachable, "afmaak.json")));
  const prompt = readFileSync(join(dir, finish.prompt), "utf8");
  assert.ok(prompt.includes(join(dir, "verdicts", CRITERIA.unreachable, "afmaak-1.json")) && prompt.includes(`1. ${UNREACHABLE}`));
  assert.match(prompt, /--session a-243-2 /);
  const pending = await instrumentPending(dir);
  assert.deepEqual([pending.phase, pending.finishers.map((entry) => [entry.criterion, entry.session])], ["finishers", [[CRITERIA.unreachable, "a-243-2"]]]);
  // A plain tasks keeps the round as it was asked for.
  await instrumentTasks(dir, options);
  assert.deepEqual((await task(CRITERIA.unreachable)).finish, finish);

  // The part loads again: the new round measures it and passes.
  const session = "a-243-2";
  const evidence = await passEvidence(CRITERIA.unreachable, session);
  write(join("verdicts", CRITERIA.unreachable, "afmaak.json"), { criterion: CRITERIA.unreachable, outcome: "passed", rule: "R5", summaryNl: "Het chatvenster laadt nu; de volgorde van de focus is daar en op de rest van de site logisch.", observations: [seen(evidence)], findings: [], finish: { points: [{ point: 1, settled: true, howNl: "Het chatvenster op de contactpagina geopend en met Tab doorlopen.", evidence }], coverageNl: "Gemeten op 2 van de 2 pagina's, met het chatvenster open.", findings: [] } } satisfies Verdict);
  assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.unreachable, "finish"), []);
  assert.equal((await instrumentPending(dir)).phase, "done");
  const criterion = await resolved(CRITERIA.unreachable);
  assert.deepEqual([criterion.outcome, criterion.established?.by, criterion.rounds.finish], ["passed", "finishing", "passed"]);
  assert.deepEqual(criterion.established?.before, { roundNl: "vorige aanvullende meting", outcome: "cantTell", summaryNl: "Het chatvenster laadde ook bij de aanvullende meting niet; de rest is gemeten.", missingNl: [UNREACHABLE] });
  // Once it is settled, there is nothing to ask again for.
  await assert.rejects(again([CRITERIA.unreachable]), /--again: het eindoordeel van 2\.4\.3 staat niet open/);
});
