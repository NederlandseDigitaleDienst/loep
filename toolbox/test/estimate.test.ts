import { BUDGETS } from "../src/commands/instrument-tasks.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { estimateOutput, estimateRun, type RunEstimate } from "../src/commands/estimate.ts";
import { CALIBRATION, COEFFICIENTS, durationNl, type EstimateBasis, estimate, estimateTextNl, phaseMinutes, type RowId } from "../src/lib/estimate.ts";
import type { ManifestStep } from "../src/lib/manifest.ts";
import { FINISH_FACTOR } from "../src/lib/verdict.ts";

const REMOTE: EstimateBasis = { pages: 29, pagesSource: "sample", pageTypes: 18, pageTypesSource: "tasks", criteria: 56, criteriaSource: "tasks", atOnce: 8, atOnceSource: "option", local: false, scheduling: "pool" };
const near = (actual: number | null, expected: number, what: string): void => assert.ok(actual !== null && Math.abs(actual - expected) <= 1, `${what}: ${actual}, verwacht ${expected}`);
const row = (result: { rows: { id: RowId }[] }, id: RowId) => {
  const found = result.rows.find((entry) => entry.id === id);
  assert.ok(found, `geen rij ${id}`);
  return found as RunEstimate["rows"][number];
};
const at = (minutes: number): string => new Date(Date.parse("2026-10-13T08:00:00.000Z") + minutes * 60_000).toISOString();

/** A run directory with what the commands leave behind, as far as the estimate reads it. */
function makeRun(files: { baseUrl: string; templates: string[]; sample?: number; documents?: number; pageTypes?: number; tasks?: { walks: number; criteria: number }; steps?: ManifestStep[]; totals?: Record<string, number> }): string {
  const run = mkdtempSync(join(tmpdir(), "estimate-"));
  const write = (name: string, value: unknown): void => {
    mkdirSync(join(run, name, ".."), { recursive: true });
    writeFileSync(join(run, name), JSON.stringify(value));
  };
  write("inventory.json", { baseUrl: files.baseUrl, pages: files.templates.map((templateHash) => ({ templateHash })), totals: files.totals ?? {} });
  if (files.sample !== undefined) write("sample.json", { items: Array.from({ length: files.sample }, () => ({})), ...(files.documents ? { documents: Array.from({ length: files.documents }, () => ({})) } : {}) });
  if (files.pageTypes !== undefined) write("site.json", { pageTypes: Array.from({ length: files.pageTypes }, () => ({})) });
  if (files.tasks) write("tasks/index.json", { walks: Array.from({ length: files.tasks.walks }, () => ({})), tasks: Array.from({ length: files.tasks.criteria }, () => ({})) });
  // A manifest holds more than its steps; the estimate must not need any of it.
  if (files.steps) write("manifest.json", { toolbox: { commit: `${CALIBRATION.commit}abc`, version: "0.0.1" }, steps: files.steps });
  return run;
}

function session(run: string, name: string, startedAt: string, stoppedAt: string | null, maxSessions = 4): void {
  const dir = join(run, "observations", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify({ session: name, startedAt, ...(stoppedAt ? { stoppedAt } : {}), limits: { maxSessions } }));
}

test("the estimate on a fixed basis: every part, the total with its range, and the tokens", () => {
  const result = estimate(REMOTE);
  const seconds = Object.fromEntries(result.rows.map((entry) => [entry.id, entry.estimatedSeconds]));
  // 29 pages on a site elsewhere, 18 page types, 56 criteria, 8 agents at a time in a pool. How many criteria need a
  // finishing round nobody knows yet: reckoned with 15 percent of them, 9, at the time of a judge times the room the round gets.
  assert.deepEqual(seconds, { explore: 600, collect: 1984, contrast: 174, states: 1462, gate: 90, walks: 1188, judges: 2256, verifiers: 1767, finishers: 2097, report: 60, between: 210 });
  near(row(result, "finishers").estimatedSeconds, 4.7 * FINISH_FACTOR * (9 / 8 + 1) * 60, "afmaakronde");
  assert.equal(result.totals.estimatedSeconds, 9791 + 2097);
  assert.equal(result.totals.remainingSeconds, 9791 + 2097, "nothing is done, so everything is still to come");
  assert.equal(result.totals.finished, false);
  assert.ok(result.rows.every((entry) => entry.status === "todo" && entry.measuredSeconds === null));
  // The band of the round, from no criterion to 30 percent of them, widens the margin on both sides.
  const band = row(result, "finishers").bandSeconds!;
  assert.equal(band[0], 0);
  near(band[1], 4.7 * FINISH_FACTOR * (17 / 8 + 1) * 60, "afmaakronde op haar meest");
  assert.deepEqual(result.totals.estimatedRange, [Math.round(9791 * 0.75), Math.round((9791 + band[1]) * 1.4)]);
  assert.match(row(result, "finishers").noteNl!, /^aantal vooraf onbekend: gerekend met 9 van 56 criteria, 0 s \(geen\) tot 51 min \(17\); niet gemeten$/);
  assert.match(estimateTextNl(result, "run"), /^afmaakronde +35 min +aantal vooraf onbekend/m);
  assert.match(estimateTextNl(result, "run"), /40 procent langer, en de afmaakronde van niets tot haar meeste\)/);
  assert.deepEqual(result.tokens, { agents: 18 + 56 + 56 + 4 + 9 + 1, estimated: (18 + 56 + 56 + 4 + 1 + 9 * FINISH_FACTOR) * 125_000, range: [Math.round(20_812_500 * 0.85), 24_975_000] });

  // Once the tasks say how many criteria the evaluation left open, the round is a number: none here, and the estimate is the one from before the round existed.
  const none = estimate({ ...REMOTE, finishers: 0 });
  assert.deepEqual([row(none, "finishers").estimatedSeconds, row(none, "finishers").bandSeconds, row(none, "finishers").noteNl], [0, undefined, "niet nodig: geen criterium bleef open door het onderzoek zelf"]);
  assert.equal(none.totals.estimatedSeconds, 9791);
  assert.deepEqual(none.totals.estimatedRange, [7343, 13707]);
  assert.deepEqual(none.tokens, { agents: 18 + 56 + 56 + 4, estimated: 16_750_000, range: [14_237_500, 20_100_000] });
  const eight = estimate({ ...REMOTE, finishers: 8 });
  near(row(eight, "finishers").estimatedSeconds, 4.7 * FINISH_FACTOR * 1.75 * 60, "acht agents op acht plaatsen: zo lang als de traagste");
  assert.match(row(eight, "finishers").noteNl!, /^8 criteria bleven open door het onderzoek zelf/);

  // The same site on this machine is quicker, and fewer agents at a time take longer.
  const local = estimate({ ...REMOTE, local: true });
  assert.ok(row(local, "collect").estimatedSeconds! < 1984 && row(local, "judges").estimatedSeconds! < 2256);
  assert.ok(estimate({ ...REMOTE, atOnce: 3 }).totals.estimatedSeconds > result.totals.estimatedSeconds);
  // In groups every group waits for its slowest agent: that is what the calibration runs did.
  const groups = estimate({ ...REMOTE, scheduling: "groups" });
  near(row(groups, "walks").estimatedSeconds, 7.2 * 1.12 * 3 * 60, "rondgangen in groepen");
  near(row(groups, "judges").estimatedSeconds, 4.7 * 1.75 * 7 * 60, "beoordelen in groepen");
  assert.ok(groups.totals.estimatedSeconds > result.totals.estimatedSeconds);
});

test("a phase with agents: one agent, one group, a pool, and nothing", () => {
  const pool = { atOnce: 8, local: false, scheduling: "pool" } as const;
  assert.equal(phaseMinutes("walks", 0, pool), 0);
  assert.equal(phaseMinutes("walks", 1, pool), COEFFICIENTS.agentMinutes.walks.remote);
  // No more agents than places: the phase ends with the slowest of them, pool or not.
  assert.equal(phaseMinutes("walks", 8, pool), phaseMinutes("walks", 8, { ...pool, scheduling: "groups" }));
  assert.equal(phaseMinutes("judges", 56, pool), COEFFICIENTS.agentMinutes.judges.remote * (56 / 8 + COEFFICIENTS.poolTail.judges));
  assert.ok(phaseMinutes("judges", 56, { ...pool, atOnce: 0 }) > phaseMinutes("judges", 56, { ...pool, atOnce: 1 }) - 1, "a number of agents below one counts as one");
  for (const phase of ["walks", "judges", "verifiers"] as const) assert.ok(phaseMinutes(phase, 56, pool) < phaseMinutes(phase, 56, { ...pool, scheduling: "groups" }), `${phase}: de pool is korter dan groepen`);
});

test("a time reads as a person says it", () => {
  assert.deepEqual([45, 89, 90, 1984, 3600, 9791].map(durationNl), ["45 s", "89 s", "2 min", "33 min", "1 u 00", "2 u 43"]);
});

test("right after the inventory the estimate works from the inventory alone and says what is still rough", () => {
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a", "a", "b", "c", "c", "c"], totals: { video: 2, audio: 1 } });
  const result = estimateRun(run);
  assert.deepEqual(
    { pages: result.basis.pages, pagesSource: result.basis.pagesSource, pageTypes: result.basis.pageTypes, pageTypesSource: result.basis.pageTypesSource, criteriaSource: result.basis.criteriaSource, atOnce: result.basis.atOnce, atOnceSource: result.basis.atOnceSource, local: result.basis.local, scheduling: result.basis.scheduling },
    { pages: 6, pagesSource: "inventory", pageTypes: 3, pageTypesSource: "inventory", criteriaSource: "catalogue", atOnce: 3, atOnceSource: "default", local: false, scheduling: "pool" },
  );
  assert.ok(result.basis.criteria > 40, "the criteria are those of the catalogue");
  assert.equal(result.totals.remainingSeconds, result.totals.estimatedSeconds);
  assert.equal(result.notesNl.length, 3);
  assert.match(result.notesNl.join("\n"), /3 keer video of geluid/);
  assert.match(result.notesNl.join("\n"), /nog niet verkend/);
  assert.match(result.notesNl.join("\n"), /steekproef is nog niet getrokken/);
  // Sharper after sample and explore: the sample and the site model take over.
  const sharper = estimateRun(makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a", "a", "b", "c", "c", "c"], sample: 4, documents: 2, pageTypes: 5 }), { atOnce: 6, groups: true });
  assert.deepEqual([sharper.basis.pages, sharper.basis.pagesSource, sharper.basis.pageTypes, sharper.basis.pageTypesSource, sharper.basis.atOnce, sharper.basis.atOnceSource, sharper.basis.scheduling], [4, "sample", 5, "site", 6, "option", "groups"]);
  assert.deepEqual(sharper.notesNl, ["de steekproef heeft 2 documenten; het inlezen daarvan is niet meegeteld"]);
  assert.throws(() => estimateRun(mkdtempSync(join(tmpdir(), "estimate-"))), /draai eerst inventory/);
});

test("with the virtual Mac for VoiceOver set up, the estimate says to start it with the sweep and stop it at the end; without one it says nothing", () => {
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a"], sample: 1, pageTypes: 1 });
  assert.deepEqual(estimateRun(run, { voiceover: null }).notesNl, []);
  const stopped = estimateRun(run, { voiceover: "stopped" }).notesNl;
  assert.equal(stopped.length, 1);
  assert.match(stopped[0]!, /start hem tegelijk met de veegronde \(loep voiceover start, 9 minuten, of 20 tot 30 met een herstart\).*loep voiceover stop/);
  assert.match(estimateRun(run, { voiceover: "running" }).notesNl[0]!, /draait: beoordelaars, verifieerders en de afmaakronde/);
});

test("halfway a run the estimate shows what was measured and what is still to come", () => {
  const steps: ManifestStep[] = [
    { command: "inventory", startedAt: at(0), at: at(1), seconds: 60 },
    { command: "sample", startedAt: at(1), at: at(1), seconds: 0 },
    { command: "explore", startedAt: at(1), at: at(1), seconds: 0, round: 1 },
    { command: "check-site", startedAt: at(9), at: at(10), seconds: 60, ok: true },
    { command: "collect", startedAt: at(11), at: at(26), seconds: 900 },
    { command: "contrast", startedAt: at(26), at: at(27), seconds: 60 },
  ];
  const run = makeRun({ baseUrl: "http://localhost:4710/", templates: Array.from({ length: 25 }, (_, index) => `t${index % 12}`), sample: 20, pageTypes: 5, steps });
  session(run, "regie", at(0), null);
  session(run, "verken", at(1), at(9));
  const sweep = estimateRun(run);
  assert.deepEqual([sweep.basis.local, sweep.basis.atOnce, sweep.basis.atOnceSource], [true, 3, "session"], "one of the four sessions is that of whoever leads");
  assert.deepEqual(sweep.rows.map((entry) => `${entry.id} ${entry.status}`), ["inventory done", "explore done", "collect done", "contrast done", "states todo", "gate todo", "walks todo", "judges todo", "verifiers todo", "finishers todo", "report todo", "between running"]);
  assert.deepEqual([row(sweep, "inventory").measuredSeconds, row(sweep, "explore").measuredSeconds, row(sweep, "collect").measuredSeconds, row(sweep, "contrast").measuredSeconds], [60, 540, 900, 60]);
  assert.equal(row(sweep, "inventory").estimatedSeconds, null, "the inventory is over before there is anything to estimate from");
  assert.equal(row(sweep, "states").measuredSeconds, null);
  assert.equal(row(sweep, "collect").remainingSeconds, 0);
  near(row(sweep, "states").remainingSeconds, 20 * 0.6 * 60, "states");
  near(row(sweep, "walks").remainingSeconds, 5.2 * (5 / 3 + 0.5) * 60, "rondgangen");
  const open = ["states", "gate", "walks", "judges", "verifiers", "finishers", "report", "between"] as const;
  assert.equal(sweep.totals.remainingSeconds, open.reduce((sum, id) => sum + row(sweep, id).remainingSeconds, 0));
  assert.ok(sweep.totals.remainingSeconds < sweep.totals.estimatedSeconds);
  assert.equal(sweep.totals.measuredSeconds, 27 * 60);
  // The finishing round is still of unknown size: the margin runs from without it to with its most.
  const finish = row(sweep, "finishers");
  assert.deepEqual(sweep.totals.remainingRange, [Math.round((sweep.totals.remainingSeconds - finish.remainingSeconds) * 0.75), Math.round((sweep.totals.remainingSeconds - finish.remainingSeconds + finish.bandSeconds![1]) * 1.4)]);
  assert.deepEqual(sweep.notesNl, []);
  const text = estimateTextNl(sweep, sweep.run, sweep.notesNl);
  assert.match(text, /^collect +17 min +15 min +klaar$/m);
  assert.match(text, /^states +12 min$/m);
  assert.match(text, /Nog te gaan: ongeveer \d u \d\d \(marge /);
  assert.match(text, /Geijkt op 6 runs op twee sites .*commit 5051033/);
  assert.match(text, /Niet gedekt: een trage site/);
  assert.ok(!text.includes("~"), "every step of this run has its own begin");

  // The walks run: two of five agents are done, one is busy, two have not started.
  session(run, "r-start", at(40), at(45));
  session(run, "r-over", at(40), at(46));
  session(run, "r-zoek", at(46), null);
  const walking = estimateRun(run);
  assert.equal(row(walking, "gate").status, "done", "agents walk, so the gate let the run through");
  const walks = row(walking, "walks");
  assert.deepEqual([walks.status, walks.noteNl, walks.measuredSeconds], ["running", "2 van 5 klaar", 6 * 60]);
  near(walks.remainingSeconds, 5.2 * 1.12 * 60, "drie rondgangen in één groep");
  assert.equal(walking.totals.measuredSeconds, 46 * 60, "the last thing the run recorded is a session");
  assert.match(estimateTextNl(walking, walking.run), /^rondgangen +\d+ min +6 min +loopt, 2 van 5 klaar, nog 6 min$/m);
  // The next phase began: the walks are over, and what they took is what was measured.
  session(run, "b-111", at(60), null);
  assert.deepEqual([row(estimateRun(run), "walks").status, row(estimateRun(run), "walks").remainingSeconds, row(estimateRun(run), "judges").status], ["done", 0, "running"]);
});

test("a finished run from before begin times shows estimated next to measured for every part", () => {
  const steps: ManifestStep[] = [
    { command: "inventory", at: at(0) },
    { command: "sample", at: at(0) },
    { command: "explore", at: at(0), round: 1 },
    { command: "check-site", at: at(8) },
    { command: "collect", at: at(41) },
    { command: "contrast", at: at(44) },
    { command: "states", at: at(69) },
    { command: "gate", at: at(69), sufficient: false },
    { command: "gate", at: at(70), sufficient: true },
    { command: "tasks", at: at(70) },
    { command: "tasks", at: at(95) },
    { command: "tasks", at: at(153) },
    { command: "tasks", at: at(197) },
    { command: "evaluate", at: at(198) },
  ];
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: Array.from({ length: 29 }, (_, index) => `t${index}`), sample: 29, pageTypes: 18, tasks: { walks: 18, criteria: 56 }, steps });
  session(run, "regie", at(0), at(198), 9);
  session(run, "r-start", at(71), at(78), 9);
  session(run, "r-over", at(72), at(94), 9);
  session(run, "b-111", at(96), at(100), 9);
  session(run, "b-121", at(97), at(152), 9);
  session(run, "v-111", at(154), at(196), 9);
  const result = estimateRun(run, { groups: true });
  assert.equal(result.totals.finished, true);
  assert.deepEqual(result.basis, { ...REMOTE, atOnceSource: "session", scheduling: "groups" });
  assert.ok(result.rows.every((entry) => entry.status === "done" && entry.remainingSeconds === 0 && entry.measuredSeconds !== null && entry.estimatedSeconds !== null), "every part has both numbers; the inventory, which this run could not time, is left out");
  assert.deepEqual(Object.fromEntries(result.rows.map((entry) => [entry.id, entry.measuredSeconds! / 60])), { explore: 8, collect: 33, contrast: 3, states: 25, gate: 1, walks: 23, judges: 56, verifiers: 42, report: 1, between: 6 });
  assert.deepEqual(result.rows.filter((entry) => entry.derived).map((entry) => entry.id), ["collect", "contrast", "states", "gate", "report"]);
  assert.equal(result.totals.measuredSeconds, 198 * 60);
  assert.equal(result.totals.remainingSeconds, 0);
  const text = estimateTextNl(result, result.run, result.notesNl);
  assert.match(text, /^collect +33 min +~33 min +klaar$/m);
  assert.match(text, /^beoordelen +58 min +56 min +klaar$/m);
  assert.match(text, /^totaal +3 u \d\d +3 u 18 +klaar$/m);
  assert.match(text, /gemeten 3 u 18: \d+ (min|s) (korter|langer) dan geschat, binnen de marge\./);
  assert.match(text, /~ gemeten vanaf de stap ervoor/);
  assert.ok(!text.includes("Nog te gaan"));
  // The same as JSON, for whoever computes on.
  const json = JSON.parse(estimateOutput(run, { groups: true, json: true })) as RunEstimate;
  assert.deepEqual(json.rows, result.rows);
  assert.equal(json.calibration.commit, CALIBRATION.commit);
  assert.equal(estimateOutput(run, { groups: true }), text);
});

test("the finishing round: a band while nobody knows, a number once the tasks say, measured when it ran, and no row for a run that had none", () => {
  const steps: ManifestStep[] = [
    { command: "inventory", startedAt: at(0), at: at(1), seconds: 60 },
    { command: "collect", startedAt: at(11), at: at(26), seconds: 900 },
    { command: "gate", startedAt: at(30), at: at(31), seconds: 60, sufficient: true },
  ];
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a", "b"], sample: 2, pageTypes: 2, tasks: { walks: 2, criteria: 10 }, steps });
  session(run, "r-start", at(32), at(38));
  session(run, "b-111", at(40), at(45));
  session(run, "v-111", at(50), at(54));
  const unknown = estimateRun(run);
  assert.equal(unknown.basis.finishers, undefined, "the verifiers are not all in: nobody knows");
  assert.deepEqual([row(unknown, "finishers").status, row(unknown, "finishers").bandSeconds?.[0]], ["todo", 0]);
  // The tasks decided: two of the ten criteria were left open by the evaluation itself.
  writeFileSync(join(run, "tasks", "index.json"), JSON.stringify({ walks: [{}, {}], tasks: Array.from({ length: 10 }, (_, index) => (index < 2 ? { finish: { session: `a-${index}` } } : {})), finishDecided: true }));
  const decided = estimateRun(run);
  assert.equal(decided.basis.finishers, 2);
  assert.deepEqual([row(decided, "finishers").bandSeconds, row(decided, "finishers").noteNl], [undefined, "2 criteria bleven open door het onderzoek zelf; niet gemeten"]);
  assert.deepEqual(decided.totals.remainingRange, [Math.round(decided.totals.remainingSeconds * 0.75), Math.round(decided.totals.remainingSeconds * 1.4)], "a known number has the usual margin");
  // The round runs: the verifiers are over, one of its two agents is done.
  session(run, "a-0", at(60), at(75));
  session(run, "a-1", at(60), null);
  const running = estimateRun(run);
  assert.deepEqual([row(running, "verifiers").status, row(running, "finishers").status, row(running, "finishers").noteNl], ["done", "running", "1 van 2 klaar"]);
  assert.match(estimateTextNl(running, running.run), /^afmaakronde +\d+ min +15 min +loopt, 1 van 2 klaar, nog \d+ min$/m);
  // A run that decided it needs none shows that, and one from before the round existed has no row for it (see the finished run above).
  const none = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a"], sample: 1, pageTypes: 1, steps: [...steps, { command: "evaluate", startedAt: at(80), at: at(81), seconds: 60 }] });
  writeFileSync(join(mkdirSync(join(none, "tasks"), { recursive: true }) ?? join(none, "tasks"), "index.json"), JSON.stringify({ walks: [{}], tasks: [{}, {}], finishDecided: true }));
  assert.deepEqual(estimateRun(none).notesNl, []);
  // The estimate does not reckon with the budget of a task: where a task got more room than the fixed budget, it says so in one line.
  writeFileSync(join(none, "tasks", "index.json"), JSON.stringify({ walks: [{}], tasks: [{ judge: { maxCommands: BUDGETS.judge.commands } }, { judge: { maxCommands: BUDGETS.judge.commands * 2 } }], finishDecided: true }));
  assert.deepEqual(estimateRun(none).notesNl, [`1 van de 2 beoordelaars heeft een ruimer budget dan het vaste van ${BUDGETS.judge.commands} commando's: de schatting rekent met de gemeten tijd per agent, niet met het budget per opdracht, en telt een verlenging niet mee`]);
  const finished = estimateRun(none);
  assert.deepEqual([row(finished, "finishers").status, row(finished, "finishers").estimatedSeconds, row(finished, "finishers").measuredSeconds], ["done", 0, null]);
  assert.match(estimateTextNl(finished, finished.run), /^afmaakronde +0 s +klaar, niet nodig: geen criterium bleef open door het onderzoek zelf$/m);
});

test("the estimate names no path and no person, and keeps its numbers in one place", () => {
  const source = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), "utf8");
  for (const name of ["lib/estimate.ts", "commands/estimate.ts", "lib/timing.ts"]) {
    assert.ok(!/\/Users\/|\/home\/|declaredBy/.test(source(name)), `${name} noemt een thuismap of leest wie iets verklaarde`);
  }
  // A number of the estimate lives in COEFFICIENTS; the command only reads the run.
  assert.ok(!/\d\.\d/.test(source("commands/estimate.ts")), "commands/estimate.ts bevat een coëfficiënt; die hoort in lib/estimate.ts");
});

test("with --at-once the sweep is reckoned with as many at the same time: collect by pages, contrast by its four passes, states by its groups", () => {
  const one = estimate(REMOTE);
  const four = estimate({ ...REMOTE, sweepAtOnce: 4 });
  near(row(four, "collect").estimatedSeconds, 1984 / (1 + 3 * COEFFICIENTS.sweepAtOnce.collect.gain), "collect");
  near(row(four, "contrast").estimatedSeconds, 174 / (1 + 3 * COEFFICIENTS.sweepAtOnce.contrast.gain), "contrast");
  near(row(four, "states").estimatedSeconds, 1462 / (1 + 3 * COEFFICIENTS.sweepAtOnce.states.gain), "states");
  // The agents are not touched, and contrast and states gain nothing above their number of passes and groups.
  assert.equal(row(four, "judges").estimatedSeconds, row(one, "judges").estimatedSeconds);
  const eight = estimate({ ...REMOTE, sweepAtOnce: 8 });
  assert.ok(row(eight, "collect").estimatedSeconds! < row(four, "collect").estimatedSeconds!);
  assert.equal(row(eight, "contrast").estimatedSeconds, row(four, "contrast").estimatedSeconds);
  assert.equal(row(eight, "states").estimatedSeconds, row(four, "states").estimatedSeconds);
  assert.match(estimateTextNl(four, "run"), /in een pool, veegronde 4 tegelijk, site elders/);
  assert.doesNotMatch(estimateTextNl(one, "run"), /veegronde \d+ tegelijk/);

  // From a run: the number given with --at-once counts for the sweep too; without it the sweep goes one page at a time.
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a", "b"], sample: 10, pageTypes: 2 });
  assert.equal(estimateRun(run).basis.sweepAtOnce, undefined);
  assert.equal(estimateRun(run, { atOnce: 6 }).basis.sweepAtOnce, 6);
  assert.ok(row(estimateRun(run, { atOnce: 6 }), "collect").estimatedSeconds! < row(estimateRun(run), "collect").estimatedSeconds!);
});
