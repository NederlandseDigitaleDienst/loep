import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, skip, type InstrumentTask } from "../src/commands/instrument-tasks.ts";
import type { RunData } from "../src/lib/rundata.ts";
import type { Verdict } from "../src/lib/verdict.ts";
import { raiseWrites, recordWrites, writesAfterRaises, writesAllowedNl, writesForRun, WRITES_LOG, type WritePermission } from "../src/lib/writes.ts";
import { readDossierInFull } from "./fixtures/dossier-reads.ts";

// A person raises the budget for sending after the run is done: that opens no round but the one asked for (#400).
const HOME = "https://www.example.nl/";
const OUT = "versturen niet toegestaan: het budget voor versturen van deze run is op (5 van 5 verstuurd)";
const PROBE = "proef werkte niet: de proef voor het zoomen gaf geen uitkomst op de contactpagina, ook niet bij een tweede poging.";
const CRITERIA = { sending: "2.4.3", finished: "1.4.5", passed: "1.4.11" };
const permission: WritePermission = { origin: "https://www.example.nl", local: false, declaredBy: { name: "Iemand", role: "beheerder" }, declaredAt: "2026-10-01T10:00:00.000Z", recordedVia: "terminal", maxWrites: 5, spacingSeconds: 0 };
const CONVERSATION = { recordedVia: "gesprek", confirmation: "ja, verhoog maar naar 10", summary: "Het budget gaat van 5 naar 10 verzendingen." } as const;

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A run of three criteria that may send, with the helpers to fill in its rounds. */
async function newRun() {
  const dir = mkdtempSync(join(tmpdir(), "loep-raise-"));
  dirs.push(dir);
  await recordWrites(dir, permission);
  const run = {
    dir,
    inventory: { baseUrl: HOME },
    writes: writesForRun(dir),
    pages: [{ label: "P1", item: { url: HOME } }],
    siteModel: { version: 1, baseUrl: HOME, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: HOME, pages: [HOME] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
  } as unknown as RunData;
  const dossier = { value: { legend: { P1: {} }, evidence: { contrast: {} } } };
  const options = { run, only: Object.values(CRITERIA), buildDossier: () => dossier.value };
  const write = (path: string, value: unknown): void => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  let made = 0;
  const observe = (session: string, command: string, blocked: { kind: string }[] = []): string => {
    const id = `${session}-${String(++made).padStart(4, "0")}`;
    write(join("observations", session, `${String(made).padStart(4, "0")}.json`), { id, command, error: null, state: { id: "s1", start: { url: HOME }, steps: [] }, target: null, page: { url: HOME }, result: {}, blocked });
    return id;
  };
  const task = async (id: string): Promise<InstrumentTask> => (await loadInstrumentIndex(dir)).tasks.find((entry) => entry.criterion === id)!;
  const seen = (evidence: string[], ruling: "noIssue" | "open"): Verdict["observations"][number] => ({ checkedNl: "De pagina's van de steekproef", howNl: "Bekeken en gemeten in de sessie", observedNl: "Wat er op de pagina staat, zoals gemeten", evidence, ruling });
  const passEvidence = async (id: string, session: string): Promise<string[]> => (readDossierInFull(dir, session, id), [observe(session, "look"), ...(await task(id)).passCommands.map((command) => observe(session, command))]);
  const attempts = (points: string[], session: string): Verdict["attempts"] => {
    const tried = points.map((point, position) => ({ missing: position + 1, triedNl: "De proef twee keer opnieuw gedraaid, met tijd ertussen, en het venster bekeken.", evidence: point === PROBE ? [observe(session, "open"), observe(session, "look")] : [observe(session, "press", [{ kind: "method" }])] }));
    return tried.length > 0 ? tried : undefined;
  };
  const judge = async (id: string, points: string[]): Promise<void> => {
    const session = `b-${id.replaceAll(".", "")}`;
    const open = points.length > 0;
    write(join("verdicts", id, "oordeel.json"), { criterion: id, outcome: open ? "cantTell" : "passed", rule: "R9", summaryNl: "Wat de beoordeling vaststelde op de bekeken pagina's.", observations: [seen(open ? [observe(session, "look")] : await passEvidence(id, session), open ? "open" : "noIssue")], findings: [], ...(open ? { missingNl: points, attempts: attempts(points, session) } : {}) } satisfies Verdict);
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "judge"), [], `judge ${id}`);
  };
  const verify = async (id: string, points: string[]): Promise<void> => {
    const session = `v-${id.replaceAll(".", "")}`;
    const open = points.length > 0;
    const evidence = open ? [observe(session, "look")] : await passEvidence(id, session);
    write(join("verdicts", id, "final.json"), { criterion: id, outcome: open ? "cantTell" : "passed", rule: "R9", summaryNl: "Ook bij de controle is dit wat vaststaat.", observations: [seen(evidence, open ? "open" : "noIssue")], findings: [], ...(open ? { missingNl: points, attempts: attempts(points, session) } : {}), verification: { judgeOutcome: open ? "cantTell" : "passed", findings: [], attackNl: "Geprobeerd het oordeel onderuit te halen met een tweede blik op de contactpagina.", attackEvidence: evidence } } satisfies Verdict);
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "final"), [], `final ${id}`);
  };
  const sendAll = (): void => {
    for (let sent = 0; sent < 5; sent++) appendFileSync(join(dir, WRITES_LOG), `${JSON.stringify({ at: new Date(Date.now() - 3_600_000).toISOString(), source: "r-start", method: "POST", path: "/contact" })}\n`);
  };
  /** Up to and including the verifiers. */
  const toVerdicts = async (): Promise<void> => {
    sendAll();
    await instrumentTasks(dir, options);
    await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
    await instrumentTasks(dir, options);
    await judge(CRITERIA.sending, [OUT]);
    await judge(CRITERIA.finished, [PROBE]);
    await judge(CRITERIA.passed, []);
    await instrumentTasks(dir, options);
    await verify(CRITERIA.sending, [OUT]);
    await verify(CRITERIA.finished, [PROBE]);
    await verify(CRITERIA.passed, []);
    await instrumentTasks(dir, options);
  };
  /** The finishing round of 1.4.5 settles its point: this verdict must stay valid through a raise. */
  const finishProbe = async (): Promise<void> => {
    const session = "a-145";
    const evidence = await passEvidence(CRITERIA.finished, session);
    write(join("verdicts", CRITERIA.finished, "afmaak.json"), { criterion: CRITERIA.finished, outcome: "passed", rule: "R5", summaryNl: "De proef werkt nu; op de hele site is geen tekst in beeld gevonden.", observations: [seen(evidence, "noIssue")], findings: [], finish: { points: [{ point: 1, settled: true, howNl: "De proef op de contactpagina opnieuw gedraaid.", evidence }], coverageNl: "Gemeten op 1 van de 1 pagina's.", findings: [] } } satisfies Verdict);
    assert.deepEqual(await checkInstrumentVerdict(dir, CRITERIA.finished, "finish"), []);
  };
  const sessions = async (): Promise<string[]> => (await loadInstrumentIndex(dir)).tasks.flatMap((entry) => [entry.judge.session, entry.verify?.session, entry.finish?.session].filter((name): name is string => Boolean(name)));
  const taskFile = (path: string): string => readFileSync(join(dir, path), "utf8");
  return { dir, run, dossier, options, task, toVerdicts, finishProbe, sessions, taskFile };
}

test("a raise after the end of a run keeps every verdict, tasks --again works at once, and pending names only the finishers asked for", async () => {
  const { dir, run, options, task, toVerdicts, finishProbe, sessions, taskFile } = await newRun();
  await toVerdicts();
  // 1.4.5 gets its finishing round for the probe; 2.4.3 stays open for the budget, which is no point of the evaluation's own.
  assert.deepEqual((await instrumentPending(dir)).finishers.map((entry) => entry.criterion), [CRITERIA.finished]);
  await finishProbe();
  assert.equal((await instrumentPending(dir)).phase, "done");
  const before = { sessions: await sessions(), judge: taskFile((await task(CRITERIA.sending)).judge.prompt), verify: taskFile((await task(CRITERIA.sending)).verify!.prompt), finish: taskFile((await task(CRITERIA.finished)).finish!.prompt), dossier: taskFile((await task(CRITERIA.sending)).dossier) };

  run.writes = await raiseWrites(dir, "10", CONVERSATION);

  // A raise by itself opens nothing: not in pending, and not after a plain tasks.
  assert.equal((await instrumentPending(dir)).phase, "done");
  await instrumentTasks(dir, options);
  assert.equal((await instrumentPending(dir)).phase, "done");

  assert.equal((await instrumentTasks(dir, { ...options, again: [CRITERIA.sending] })).finishers, 2);
  const pending = await instrumentPending(dir);
  assert.deepEqual([pending.phase, pending.finishers.map((entry) => [entry.criterion, entry.session]), pending.judges, pending.verifiers], ["finishers", [[CRITERIA.sending, "a-243"]], [], []]);

  // Only the round that was asked for hears of the raise; what was done keeps its task, its dossier and its session.
  const prompt = taskFile((await task(CRITERIA.sending)).finish!.prompt);
  assert.match(prompt, /budget voor versturen verhoogd van 5 naar 10/);
  assert.match(prompt, /Het budget voor versturen is 10 verzendingen/);
  assert.equal(taskFile((await task(CRITERIA.sending)).judge.prompt), before.judge);
  assert.equal(taskFile((await task(CRITERIA.sending)).verify!.prompt), before.verify);
  assert.equal(taskFile((await task(CRITERIA.finished)).finish!.prompt), before.finish);
  assert.equal(taskFile((await task(CRITERIA.sending)).dossier), before.dossier);
  for (const name of before.sessions) assert.ok((await sessions()).includes(name), `session ${name} stays`);
  assert.equal((await sessions()).length, before.sessions.length + 1);
  assert.equal((await task(CRITERIA.sending)).finish!.raises, 1);
  assert.equal((await task(CRITERIA.finished)).finish!.raises, undefined);
  assert.equal(writesForRun(dir)?.maxWrites, 10);
});

test("a second raise reaches a round that was written after the first and has not started", async () => {
  const { dir, run, options, task, toVerdicts, finishProbe, taskFile } = await newRun();
  await toVerdicts();
  await finishProbe();
  run.writes = await raiseWrites(dir, "10", CONVERSATION);
  await instrumentTasks(dir, { ...options, again: [CRITERIA.sending] });
  const prompt = taskFile((await task(CRITERIA.sending)).finish!.prompt);

  run.writes = await raiseWrites(dir, "20", { ...CONVERSATION, confirmation: "ja, verhoog maar naar 20", summary: "Het budget gaat van 10 naar 20 verzendingen." });
  await instrumentTasks(dir, options);
  // Its agent has not started: the task is still open, so it says what holds now.
  const now = taskFile((await task(CRITERIA.sending)).finish!.prompt);
  assert.notEqual(now, prompt);
  assert.match(now, /Het budget voor versturen is 20 verzendingen/);
  assert.equal((await task(CRITERIA.sending)).finish!.session, "a-243");
});

test("a raise while the run is under way reaches the tasks that are still to start, and leaves verdicts that are in", async () => {
  const { dir, run, options, task, taskFile, toVerdicts } = await newRun();
  await toVerdicts();
  // What came in stays; the finishing round that is open hears of the raise.
  const judge = taskFile((await task(CRITERIA.finished)).judge.prompt);
  assert.doesNotMatch(taskFile((await task(CRITERIA.finished)).finish!.prompt), /verhoogd/);
  run.writes = await raiseWrites(dir, "10", CONVERSATION);
  await instrumentTasks(dir, options);
  assert.match(taskFile((await task(CRITERIA.finished)).finish!.prompt), /budget voor versturen verhoogd van 5 naar 10/);
  assert.equal(taskFile((await task(CRITERIA.finished)).judge.prompt), judge);
  assert.deepEqual((await instrumentPending(dir)).finishers.map((entry) => [entry.criterion, entry.session]), [[CRITERIA.finished, "a-145"]]);
});

test("a plain tasks does not take a finished run back to the judges: it refuses, says what would change and changes nothing", async () => {
  const { dir, dossier, options, task, toVerdicts, finishProbe, sessions, taskFile } = await newRun();
  await toVerdicts();
  await finishProbe();
  const before = { index: taskFile(join("tasks", "index.json")), dossier: taskFile((await task(CRITERIA.passed)).dossier), sessions: await sessions() };

  // A new sweep changed what the dossiers hold.
  dossier.value = { ...dossier.value, evidence: { contrast: { changed: true } } };
  await assert.rejects(instrumentTasks(dir, options), /deze run is af, en dit zou 3 beoordelingen \(.*\) opnieuw openzetten: het dossier van 3 criteria veranderde \(.*\)\. Er is niets gewijzigd\..*tasks --again <criteria>.*tasks --reopen/);
  assert.equal(taskFile(join("tasks", "index.json")), before.index);
  assert.equal(taskFile((await task(CRITERIA.passed)).dossier), before.dossier);
  assert.equal((await instrumentPending(dir)).phase, "done");

  // An --again in that state does not go on either, and leaves the run as it was.
  await assert.rejects(instrumentTasks(dir, { ...options, again: [CRITERIA.finished] }), /--again/);
  assert.equal(taskFile(join("tasks", "index.json")), before.index);
  assert.deepEqual(await sessions(), before.sessions);
  assert.ok(!existsSync(join(dir, "verdicts", CRITERIA.finished, "afmaak-1.json")));

  // Someone who means it, says so: then it is as before, with fresh sessions for what is done again.
  await instrumentTasks(dir, { ...options, reopen: true });
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "judges");
  assert.deepEqual(pending.judges.map((entry) => entry.session).sort(), ["b-1411-2", "b-145-2", "b-243-2"]);
});

test("the permission after a number of raises reads as it did then, and a dossier names no raise", () => {
  const raised: WritePermission = { ...permission, maxWrites: 20, raised: [{ from: 5, to: 10, at: "2026-10-02T10:00:00.000Z", recordedVia: "terminal" }, { from: 10, to: 20, at: "2026-10-03T10:00:00.000Z", recordedVia: "terminal" }] };
  assert.deepEqual(writesAfterRaises(raised, 0), permission);
  assert.equal(writesAfterRaises(raised, 1).maxWrites, 10);
  assert.deepEqual(writesAfterRaises(raised, 1).raised, [raised.raised![0]]);
  assert.equal(writesAfterRaises(raised, 2), raised);
  assert.equal(writesAfterRaises(permission, 0), permission);
  assert.doesNotMatch(writesAllowedNl(writesAfterRaises(raised, 0)), /verhoogd/);
});
