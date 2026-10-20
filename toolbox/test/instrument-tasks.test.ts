import assert from "node:assert/strict";
import { readDossierInFull } from "./fixtures/dossier-reads.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkInstrumentVerdict, checkWalk, instrumentPending, instrumentTasks, loadInstrumentIndex, skip } from "../src/commands/instrument-tasks.ts";
import { useFactor } from "../src/lib/budget.ts";
import { resolveCriterion } from "../src/lib/evaluation.ts";
import type { RunData } from "../src/lib/rundata.ts";
import type { Verdict } from "../src/lib/verdict.ts";
import { criterionById } from "../src/lib/wcag.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-tasks-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HOME = "https://site.test/";
const CONTACT = "https://site.test/contact/";
// The least of a run that task generation reads: two pages, a site model with a type for each.
const run = {
  dir,
  inventory: { baseUrl: HOME },
  writes: null,
  pages: [
    { label: "P1", item: { url: HOME } },
    { label: "P2", item: { url: CONTACT } },
  ],
  siteModel: {
    version: 1,
    baseUrl: HOME,
    pageTypes: [
      { id: "start", descriptionNl: "De startpagina.", representative: HOME, pages: [HOME] },
      { id: "contact", descriptionNl: "De contactpagina.", representative: CONTACT, pages: [CONTACT] },
    ],
    blockers: [{ id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding onderaan.", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#melding" } }],
    components: [{ id: "menu", type: "menu", descriptionNl: "Hoofdmenu achter een knop.", pageTypes: ["start"], viewport: { maxWidth: 767 }, recipe: "component-menu", postcondition: null }],
    processes: [{ id: "contact", descriptionNl: "Contactformulier ingevuld, niet verstuurd.", recipe: "process-contact", postcondition: { kind: "url-contains", text: "contact" } }],
    frames: [],
    notesNl: [],
  },
} as unknown as RunData;
const options = { run, only: ["1.4.3", "1.4.11"], buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: {} } }) };

const write = (path: string, value: unknown): void => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), typeof value === "string" ? value : JSON.stringify(value));
};
let made = 0;
/** A recorded observation, as a session writes it. */
function observe(session: string, command: string): string {
  const id = `${session}-${String(++made).padStart(4, "0")}`;
  write(join("observations", session, `${String(made).padStart(4, "0")}.json`), { id, command, error: null, state: { id: "s1", start: { url: HOME }, steps: [] }, target: command === "contrast" ? { path: ["#kop > h1"] } : null, page: { url: HOME }, result: {} });
  return id;
}

write("sample.json", { items: [{ url: HOME }, { url: CONTACT }] });

/** A task names the work folder of its own session, and the command that wrote the task made it. */
function namesItsWorkDir(prompt: string, session: string): void {
  const workDir = join(dir, "werk", session);
  assert.ok(prompt.includes(`werkmap: \`${workDir}\``), `the task names ${workDir} as its work folder`);
  assert.ok(prompt.includes(`eigen sessienaam mee, \`--session ${session}\``), "the task says to give its own session in every command");
  assert.ok(prompt.includes(`\`<scratchpad>/${session}/\``), "outside the run, the folder carries the session too");
  assert.ok(existsSync(workDir), `${workDir} is there before the agent starts`);
}
write(join("recipes", "process-contact.json"), { start: { url: HOME }, steps: [{ command: "goto", args: [CONTACT] }] });

const finding = (key: string, evidence: string[]): Verdict["findings"][number] => ({ key, titleNl: "Kop te licht op de foto", observedNl: "Wit op lichtgroen, 1,2 op 1.", impactNl: "Slechtzienden lezen de kop niet.", fixNl: "Leg een donkere laag onder de tekst.", severity: "hoog", owner: "design", component: null, locations: [{ page: "P1", where: "#kop > h1", wholePage: true }], pagesAffected: "gemeten op P1", evidence });
const seen = (evidence: string[]): Verdict["observations"][number] => ({ checkedNl: "Tekst op de startpagina", howNl: "Contrast gemeten op de kop", observedNl: "1,2 op 1 bij een eis van 3", evidence, ruling: "noIssue" });

test("a run with a site model starts with a walk per page type and a judge task per criterion", async () => {
  assert.deepEqual(await instrumentTasks(dir, options), { walks: 2, judges: 2, verifiers: 0, finishers: 0 });
  const index = await loadInstrumentIndex(dir);
  assert.deepEqual(index.walks.map((walk) => [walk.pageType, walk.page, walk.session]), [["start", "P1", "r-start"], ["contact", "P2", "r-contact"]]);
  const start = readFileSync(join(dir, "rondgang", "start.md"), "utf8");
  const contact = readFileSync(join(dir, "rondgang", "contact.md"), "utf8");
  assert.doesNotMatch(start + contact, /\{\{\w+\}\}/, "no placeholder is left");
  assert.match(start, /Over de pagina ligt: Cookiemelding onderaan/);
  assert.match(start, /`component-menu`.*--width 360/);
  assert.doesNotMatch(start, /process-contact/, "a process belongs to the walk of the page type it goes to");
  assert.match(contact, /`process-contact`/);
  namesItsWorkDir(start, "r-start");
  namesItsWorkDir(contact, "r-contact");
  const judge = readFileSync(join(dir, "tasks", "1.4.3", "beoordeel.md"), "utf8");
  assert.doesNotMatch(judge, /\{\{\w+\}\}/);
  namesItsWorkDir(judge, "b-143");
  // 1.4.3 is a criterion whose judges ended on their budget in every measured run: it gets twice the floor.
  assert.equal(useFactor("judge", "1.4.3"), 2);
  assert.match(judge, /session start --run \S+ --session b-143 --max-commands 160 --max-minutes 60 /, "the budget in the prompt is the computed one, and the one the session is started with");
  assert.match(judge, /session extend --run \S+ --session b-143 --reason /, "the task says how to extend");
  assert.deepEqual([index.tasks.find((task) => task.criterion === "1.4.3")!.judge.maxCommands, index.tasks.find((task) => task.criterion === "1.4.3")!.judge.maxMinutes], [160, 60]);
  assert.match(judge, /check-verdict --run \S+ --criterion 1\.4\.3 --round judge/);
  assert.equal(index.tasks.every((task) => task.verify === null), true);
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "walks");
  assert.deepEqual(pending.walks.map((walk) => walk.pageType).sort(), ["contact", "start"]);
  const taskSizes = pending.walks.map((walk) => statSync(walk.task).size);
  assert.deepEqual(taskSizes, [...taskSizes].sort((a, b) => b - a), "the walks come longest first");
  assert.deepEqual(pending.judges, [], "judges wait for the walks");
});

test("candidates of a checked walk reach their criterion, by code", async () => {
  const look = observe("r-start", "look");
  write(join("rondgang", "start.json"), { pageType: "start", page: "P1", states: [{ nameNl: "Breed, melding gesloten", evidence: [look] }], candidates: [{ id: "P1-K01", criterion: "1.4.3", page: "P1", where: "kop op de foto", evidence: [look], noteNl: "Witte kop op een lichte foto, moeilijk te lezen.", support: "alleen beeld" }], notWalkedNl: [] });
  assert.deepEqual(await checkWalk(dir, "start"), []);
  assert.match((await checkWalk(dir, "contact")).join(), /cannot read/);
  await skip(dir, { pageType: "contact" }, "De agent leverde twee keer geen geldige lijst.");
  await instrumentTasks(dir, options);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "tasks", "1.4.3", "kandidaten.json"), "utf8")).map((candidate: { id: string }) => candidate.id), ["P1-K01"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "tasks", "1.4.11", "kandidaten.json"), "utf8")), []);
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "judges");
  assert.deepEqual(pending.judges.map((judge) => judge.criterion), ["1.4.3", "1.4.11"]);
  assert.deepEqual(pending.skipped, ["rondgang contact"]);
});

let contrast = "";
test("verifier tasks come when every judge is in, with what other judges handed over", async () => {
  contrast = observe("b-143", "contrast");
  const crop = observe("b-143", "crop");
  const judged: Verdict = {
    criterion: "1.4.3",
    outcome: "failed",
    rule: "R1",
    summaryNl: "De kop op de foto van de startpagina is te licht.",
    observations: [seen(["contrast", contrast])],
    findings: [finding("F1", [contrast]), { ...finding("F2", [crop]), titleNl: "Datum te licht" }],
    candidates: [{ id: "P1-K01", ruling: "finding", finding: "F1", reasonNl: "Gemeten: 1,2 op 1." }],
    crossCandidates: [{ criterion: "1.4.11", page: "P1", where: "rand van het zoekveld", evidence: [crop], noteNl: "De rand van het zoekveld is lichtgrijs op wit." }],
  };
  write(join("verdicts", "1.4.3", "oordeel.json"), judged);
  assert.deepEqual(await checkInstrumentVerdict(dir, "1.4.3", "judge"), []);
  assert.match((await checkInstrumentVerdict(dir, "1.4.3", "final")).join(), /not written yet/);
  assert.deepEqual(await instrumentTasks(dir, options), { walks: 2, judges: 2, verifiers: 0, finishers: 0 }, "one judge is still out");
  await skip(dir, { criterion: "1.4.11" }, "De agent leverde twee keer geen geldig oordeel.");
  assert.deepEqual(await instrumentTasks(dir, options), { walks: 2, judges: 2, verifiers: 1, finishers: 0 });
  const index = await loadInstrumentIndex(dir);
  const verify = index.tasks.find((task) => task.criterion === "1.4.3")!.verify!;
  assert.equal(verify.maxCommands, (20 + 2 * 5) * useFactor("verify", "1.4.3"), "twenty, and five for each finding to reproduce, times what the verifiers of this criterion used before");
  assert.match(readFileSync(join(dir, verify.prompt), "utf8"), /--session v-143 --max-commands 60 /);
  namesItsWorkDir(readFileSync(join(dir, verify.prompt), "utf8"), "v-143");
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "verifiers");
  assert.deepEqual(pending.verifiers.map((entry) => entry.criterion), ["1.4.3"]);
});

test("a cross-candidate is routed to the verifier of the criterion it names", async () => {
  // Now with both judges in: 1.4.11 passes, and its verifier gets what the judge of 1.4.3 saw.
  rmSync(join(dir, "verdicts", "1.4.11", "oordeel.overgeslagen.json"));
  const look = observe("b-1411", "look");
  const measured = observe("b-1411", "contrast");
  const focus = observe("b-1411", "focus");
  write(join("verdicts", "1.4.11", "oordeel.json"), { criterion: "1.4.11", outcome: "passed", rule: "R6", summaryNl: "Randen en pictogrammen steken genoeg af op de bekeken pagina's.", observations: [seen([look, measured, focus])], findings: [] });
  // A pass rests on the dossier: the judge reads the parts the criterion counts on in full, with dossier, in its own session.
  assert.match((await checkInstrumentVerdict(dir, "1.4.11", "judge")).join(), /needs every part of the dossier this criterion counts on read in full with the command dossier in session "b-1411"; not read in full: contrast/);
  readDossierInFull(dir, "v-1411", "1.4.11");
  assert.match((await checkInstrumentVerdict(dir, "1.4.11", "judge")).join(), /not read in full: contrast/, "what another session read does not count");
  readDossierInFull(dir, "b-1411", "1.4.11");
  assert.deepEqual(await checkInstrumentVerdict(dir, "1.4.11", "judge"), []);
  assert.deepEqual(await instrumentTasks(dir, options), { walks: 2, judges: 2, verifiers: 2, finishers: 0 });
  const index = await loadInstrumentIndex(dir);
  const verify = index.tasks.find((task) => task.criterion === "1.4.11")!.verify!;
  const candidates = JSON.parse(readFileSync(join(dir, verify.candidates), "utf8")) as { id: string; where: string }[];
  assert.deepEqual(candidates.map((candidate) => [candidate.id, candidate.where]), [["X143-01", "rand van het zoekveld"]]);
  assert.equal(verify.maxCommands, (20 + 3 + 30) * useFactor("verify", "1.4.11"), "three for the candidate to rule on, thirty to attack a pass, times what the verifiers of this criterion used before");
});

test("a final verdict is checked against the judge, and a changed observation makes both stale", async () => {
  const again = observe("v-143", "contrast");
  const final: Verdict = {
    criterion: "1.4.3",
    outcome: "failed",
    rule: "R1",
    summaryNl: "De kop op de foto is opnieuw gemeten en blijft te licht.",
    observations: [seen([again])],
    findings: [finding("F1", [again])],
    candidates: [{ id: "P1-K01", ruling: "finding", finding: "F1", reasonNl: "Opnieuw gemeten: 1,2 op 1." }],
    verification: { judgeOutcome: "failed", findings: [{ key: "F1", reproduced: true, evidence: [again] }, { key: "F2", reproduced: false, evidence: [], dropped: "notReproduced", reasonNl: "Op een verse pagina meet de datum 4,6 op 1." }] },
  };
  write(join("verdicts", "1.4.3", "final.json"), final);
  assert.deepEqual(await checkInstrumentVerdict(dir, "1.4.3", "final"), []);
  assert.deepEqual((await instrumentPending(dir)).verifiers.map((entry) => entry.criterion), ["1.4.11"]);

  // What a verdict cites is part of what it was reached with.
  const [, nr] = /-(\d+)$/.exec(contrast)!;
  const path = join("observations", "b-143", `${nr}.json`);
  const original = readFileSync(join(dir, path), "utf8");
  write(path, original.replace('"result":{}', '"result":{"changed":true}'));
  const stale = await instrumentPending(dir);
  assert.equal(stale.phase, "judges");
  assert.deepEqual(stale.judges.map((judge) => judge.criterion), ["1.4.3"]);
  write(path, original);
  assert.equal((await instrumentPending(dir)).phase, "verifiers");

  // The evaluation keeps the finding that was dropped, with its reason.
  const judge = JSON.parse(readFileSync(join(dir, "verdicts", "1.4.3", "oordeel.json"), "utf8")) as Verdict;
  const result = resolveCriterion({ criterion: criterionById("1.4.3")!, verdicts: { a: judge, final }, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } }, "SITE");
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.findings.map((entry) => entry.titleNl), ["Kop te licht op de foto"]);
  assert.deepEqual(result.dropped, [{ key: "F2", titleNl: "Datum te licht", locations: [{ page: "P1", where: "#kop > h1", wholePage: true }], reason: "notReproduced", reasonNl: "Op een verse pagina meet de datum 4,6 op 1.", belongsTo: null }]);
  assert.deepEqual(result.droppedNl, ["Datum te licht (P1): niet bevestigd. Op een verse pagina meet de datum 4,6 op 1."]);
});

test("a task that has to be done again gets a session of its own", async () => {
  // Other evidence: every verdict is stale. The sessions that judged and verified have used their budget.
  await instrumentTasks(dir, { ...options, buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: { remeasured: true } } }) });
  const index = await loadInstrumentIndex(dir);
  const task = index.tasks.find((entry) => entry.criterion === "1.4.3")!;
  assert.equal(task.judge.session, "b-143-2");
  assert.match(readFileSync(join(dir, task.judge.prompt), "utf8"), /--session b-143-2 /);
  namesItsWorkDir(readFileSync(join(dir, task.judge.prompt), "utf8"), "b-143-2");
  assert.equal(index.walks.find((walk) => walk.pageType === "start")!.session, "r-start", "a walk that still stands keeps its session");
  assert.equal(index.tasks.find((entry) => entry.criterion === "1.4.11")!.judge.session, "b-1411-2");
  // The old verdict cannot be passed off as the new attempt: its findings rest on the old session.
  assert.match((await checkInstrumentVerdict(dir, "1.4.3", "judge")).join(), /a finding needs at least one observation of session "b-143-2"/);
  // Asking again before anyone started changes nothing.
  await instrumentTasks(dir, { ...options, buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: { remeasured: true } } }) });
  assert.equal((await loadInstrumentIndex(dir)).tasks.find((entry) => entry.criterion === "1.4.3")!.judge.session, "b-143-2");
});
