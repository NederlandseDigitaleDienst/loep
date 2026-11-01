import { briefPending, BUDGETS, instrumentPending } from "../src/commands/instrument-tasks.ts";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { estimateOutput, estimateRun, type RunEstimate } from "../src/commands/estimate.ts";
import { CALIBRATION, COEFFICIENTS, durationNl, type EstimateBasis, estimate, estimateTextNl, phaseMinutes, type RowId, typicalSweep, USAGE_BASELINE } from "../src/lib/estimate.ts";
import { makespan, type PageWork, runningStep, slowestLane, SWEEP_COEFFICIENTS, sweepPlans, type SweepWork } from "../src/lib/estimate-sweep.ts";
import { ProgressFile, readProgress, type StepProgress } from "../src/lib/progress.ts";
import type { ManifestStep } from "../src/lib/manifest.ts";
import { MAX_DOWN_TARGETS, MAX_HOVER_TARGETS, STATES_GROUPS } from "../src/commands/states.ts";
import { FINISH_FACTOR } from "../src/lib/verdict.ts";
import { PRICES } from "../src/lib/prices.ts";
import { recordWrites, type WritePermission } from "../src/lib/writes.ts";

const REMOTE: EstimateBasis = { pages: 29, pagesSource: "sample", pageTypes: 18, pageTypesSource: "tasks", criteria: 56, criteriaSource: "tasks", atOnce: 8, atOnceSource: "option", local: false, scheduling: "pool" };
const near = (actual: number | null, expected: number, what: string): void => assert.ok(actual !== null && Math.abs(actual - expected) <= 1, `${what}: ${actual}, verwacht ${expected}`);
const row = (result: { rows: { id: RowId }[] }, id: RowId) => {
  const found = result.rows.find((entry) => entry.id === id);
  assert.ok(found, `geen rij ${id}`);
  return found as RunEstimate["rows"][number];
};
const at = (minutes: number): string => new Date(Date.parse("2026-10-13T08:00:00.000Z") + minutes * 60_000).toISOString();

/** The sweep of the fixed basis: so many typical pages, nothing timed. */
const SWEEP_OF_REMOTE = sweepPlans(typicalSweep(REMOTE), 1, false);
const SWEEP_SECONDS = SWEEP_OF_REMOTE.collect.seconds + SWEEP_OF_REMOTE.contrast.seconds + SWEEP_OF_REMOTE.states.seconds;
/** Every part of the fixed basis but the sweep and the finishing round: explore, gate, walks, judges, verifiers, report and between. */
const OTHER_SECONDS = 600 + 90 + 1188 + 2256 + 1767 + 60 + 210;

/** A page as the inventory of this version writes it: its template, how long it loaded and what there is to operate. */
const inventoryPage = (templateHash: string, index: number, page: { loadMs?: number; links?: number; controls?: number } = {}) => ({ slug: `p${index}`, templateHash, loadMs: page.loadMs ?? 600, operable: { links: page.links ?? 30, controls: page.controls ?? 15 }, counts: { forms: 1 } });

/** A run directory with what the commands leave behind, as far as the estimate reads it. */
function makeRun(files: { baseUrl: string; templates: string[]; sample?: number; documents?: number; pageTypes?: number; tasks?: { walks: number; criteria: number }; steps?: ManifestStep[]; totals?: Record<string, number>; pages?: Record<string, unknown>[] }): string {
  const run = mkdtempSync(join(tmpdir(), "estimate-"));
  const write = (name: string, value: unknown): void => {
    mkdirSync(join(run, name, ".."), { recursive: true });
    writeFileSync(join(run, name), JSON.stringify(value));
  };
  write("inventory.json", { baseUrl: files.baseUrl, pages: files.pages ?? files.templates.map((templateHash, index) => inventoryPage(templateHash, index)), totals: files.totals ?? {} });
  if (files.sample !== undefined) write("sample.json", { items: Array.from({ length: files.sample }, (_, index) => ({ slug: `p${index}` })), ...(files.documents ? { documents: Array.from({ length: files.documents }, () => ({})) } : {}) });
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
  assert.deepEqual(seconds, { explore: 600, collect: SWEEP_OF_REMOTE.collect.seconds, contrast: SWEEP_OF_REMOTE.contrast.seconds, states: SWEEP_OF_REMOTE.states.seconds, gate: 90, walks: 1188, judges: 2256, verifiers: 1767, finishers: 2097, report: 60, between: 210 });
  near(row(result, "finishers").estimatedSeconds, 4.7 * FINISH_FACTOR * (9 / 8 + 1) * 60, "afmaakronde");
  const counted = OTHER_SECONDS + SWEEP_SECONDS;
  assert.equal(result.totals.estimatedSeconds, counted + 2097);
  assert.equal(result.totals.remainingSeconds, counted + 2097, "nothing is done, so everything is still to come");
  assert.equal(result.totals.finished, false);
  assert.ok(result.rows.every((entry) => entry.status === "todo" && entry.measuredSeconds === null));
  // The band of the round, from no criterion to 30 percent of them, widens the margin on both sides.
  const band = row(result, "finishers").bandSeconds!;
  assert.equal(band[0], 0);
  near(band[1], 4.7 * FINISH_FACTOR * (17 / 8 + 1) * 60, "afmaakronde op haar meest");
  assert.deepEqual(result.totals.estimatedRange, [Math.round(counted * 0.75), Math.round((counted + band[1]) * 1.4)]);
  assert.match(row(result, "finishers").noteNl!, /^aantal vooraf onbekend: gerekend met 9 van 56 criteria, 0 s \(geen\) tot 51 min \(17\); niet gemeten$/);
  assert.match(estimateTextNl(result, "run"), /^afmaakronde +35 min +aantal vooraf onbekend/m);
  assert.match(estimateTextNl(result, "run"), /40 procent langer, en de afmaakronde van niets tot haar meeste\)/);
  // Tokens per role as the average agent of that role in the baseline: 18 walks, 56 judges, 56 verifiers, 9 finishers and 5 rounds asking what is open.
  assert.deepEqual(Object.fromEntries(Object.entries(result.tokens.byRole).map(([role, use]) => [role, use.agents])), { walks: 18, judges: 56, verifiers: 56, finishers: 9, status: 5 });
  assert.equal(result.tokens.agents, 18 + 56 + 56 + 9 + 5);
  assert.equal(result.tokens.byRole.finishers.tokens, Math.round(9 * (74 + 120_000 + 3_700_000 + 5_669)));

  // Once the tasks say how many criteria the evaluation left open, the round is a number: none here, and the estimate is the one from before the round existed.
  const none = estimate({ ...REMOTE, finishers: 0 });
  assert.deepEqual([row(none, "finishers").estimatedSeconds, row(none, "finishers").bandSeconds, row(none, "finishers").noteNl], [0, undefined, "niet nodig: geen criterium bleef open door het onderzoek zelf"]);
  assert.equal(none.totals.estimatedSeconds, counted);
  assert.deepEqual(none.totals.estimatedRange, [Math.round(counted * 0.75), Math.round(counted * 1.4)]);
  assert.deepEqual([none.tokens.agents, none.tokens.byRole.finishers.tokens, none.tokens.byRole.status.agents], [18 + 56 + 56 + 4, 0, 4], "no finishing round: no finishers and no round asking for them");
  assert.ok(none.tokens.estimated < result.tokens.estimated && none.cost.dollars < result.cost.dollars);
  const eight = estimate({ ...REMOTE, finishers: 8 });
  near(row(eight, "finishers").estimatedSeconds, 4.7 * FINISH_FACTOR * 1.75 * 60, "acht agents op acht plaatsen: zo lang als de traagste");
  assert.match(row(eight, "finishers").noteNl!, /^8 criteria bleven open door het onderzoek zelf/);

  // The same site on this machine is quicker, and fewer agents at a time take longer.
  const local = estimate({ ...REMOTE, local: true });
  assert.ok(row(local, "collect").estimatedSeconds! < SWEEP_OF_REMOTE.collect.seconds && row(local, "judges").estimatedSeconds! < 2256);
  assert.ok(estimate({ ...REMOTE, atOnce: 3 }).totals.estimatedSeconds > result.totals.estimatedSeconds);
  // In groups every group waits for its slowest agent: that is what the calibration runs did.
  const groups = estimate({ ...REMOTE, scheduling: "groups" });
  near(row(groups, "walks").estimatedSeconds, 7.2 * 1.12 * 3 * 60, "rondgangen in groepen");
  near(row(groups, "judges").estimatedSeconds, 4.7 * 1.75 * 7 * 60, "beoordelen in groepen");
  assert.ok(groups.totals.estimatedSeconds > result.totals.estimatedSeconds);
});

test("tokens and cost: the baseline of 19 October reckoned again, with the share from the cache, a range and the subscription", () => {
  // The audit the baseline was counted on: 16 page types, 56 criteria, one criterion in the finishing round.
  const baseline = estimate({ ...REMOTE, pages: 31, pageTypes: 16, atOnce: 10, finishers: 1 });
  assert.equal(baseline.tokens.agents, 134);
  assert.ok(Math.abs(baseline.tokens.estimated - 526_000_000) < 1_000_000, `ongeveer 526 miljoen: ${baseline.tokens.estimated}`);
  assert.equal(Math.round((baseline.tokens.cacheRead / baseline.tokens.estimated) * 100), 97);
  assert.deepEqual(baseline.cost, { model: "claude-opus-5-5", dollars: 184, range: [147, 248] });
  assert.deepEqual(baseline.tokens.range, [Math.round(baseline.tokens.estimated * 0.8), Math.round(baseline.tokens.estimated * 1.35)]);
  assert.equal(Math.round((baseline.tokens.byRole.judges.tokens / baseline.tokens.estimated) * 100), 57, "the judges, as in the table of the baseline");
  // Twice the criteria is twice the judges and the verifiers, not twice the walks.
  const fewer = estimate({ ...REMOTE, pages: 31, pageTypes: 16, criteria: 28, finishers: 1 });
  assert.equal(fewer.tokens.byRole.judges.tokens * 2, baseline.tokens.byRole.judges.tokens);
  assert.equal(fewer.tokens.byRole.walks.tokens, baseline.tokens.byRole.walks.tokens);

  const text = estimateTextNl(baseline, "run");
  assert.match(text, /^Tokens voor de 134 agents van de werkstroom: ongeveer 526,\d miljoen \(marge 420,\d tot 710,\d\), waarvan 97 procent uit de cache\. Per rol, in miljoenen: beoordelaars 301,7, verifieerders 159,0, rondgangen 61,2, afmaakronde 3,8, stand 0,4\.$/m);
  assert.match(text, /^Kosten met de prijzen van de API voor Opus 5\.5 van 19 oktober 2026: ongeveer 184 dollar \(marge 147 tot 248\)\./m);
  assert.match(text, /groot deel van de weeklimiet gebruiken\. Hoe groot die limiet is, verschilt per abonnement\.$/m);
  assert.match(text, /nulmeting van 19 oktober 2026 \(validatie\/verbruik\/README\.md\): één onderzoek met loep 0\.10\.0/);
  assert.doesNotMatch(text, /afmaakronde 0,0/);
  assert.doesNotMatch(estimateTextNl(estimate({ ...REMOTE, finishers: 0 }), "run"), /afmaakronde \d/, "no finishing round, no tokens for it");
  assert.ok(PRICES[USAGE_BASELINE.model], "the model of the baseline has a price");
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

test("a budget for sending that is used up stops the next phase: pending and estimate say so, also on this machine", async () => {
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a"], sample: 1, pageTypes: 1 });
  const permission: WritePermission = { origin: "http://localhost:8081", local: true, declaredBy: null, declaredAt: "2026-10-30T09:00:00.000Z", maxWrites: 4, spacingSeconds: 0 };
  await recordWrites(run, permission);
  mkdirSync(join(run, "tasks"), { recursive: true });
  writeFileSync(join(run, "tasks", "index.json"), JSON.stringify({ flow: "instrumenten", templates: {}, withoutProcedure: [], only: [], walks: [{ pageType: "start", page: "P1", prompt: "rondgang/start.md", output: "rondgang/start.json", session: "r-start", maxCommands: 1, maxMinutes: 1 }], tasks: [] }));
  const send = (count: number): void => appendFileSync(join(run, "writes.jsonl"), `${JSON.stringify({ at: "2026-10-30T09:00:00.000Z", source: "states", method: "POST", path: "/aanmelden/" })}\n`.repeat(count));

  // Nearly used up on this machine, without a mailbox: there is no recipient to spare.
  send(3);
  assert.equal((await instrumentPending(run)).sendingLow, undefined);
  // With a mailbox the same budget has a share to keep, so it warns before the end.
  await recordWrites(run, { ...permission, keepShare: true });
  assert.match((await instrumentPending(run)).sendingLow ?? "", /nog 1 van 4 verzendingen/);

  await recordWrites(run, permission);
  send(1);
  const pending = await instrumentPending(run);
  assert.match(pending.sendingLow ?? "", /nog 0 van 4 verzendingen/);
  assert.equal(briefPending(pending).sendingLow, pending.sendingLow);
  assert.match(pending.noteNl, /^LET OP: het budget voor versturen is op \(4 van 4 verstuurd\).*writes --run <run> --max-writes <aantal>/);
  assert.match(estimateRun(run, { voiceover: null }).notesNl.join("\n"), /LET OP: het budget voor versturen is op/);
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
  assert.equal(row(sweep, "states").remainingSeconds, sweep.sweep.steps.states.seconds, "states is still to come as a whole");
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
  assert.match(text, /^collect +\d+ min +15 min +klaar$/m);
  assert.match(text, /^states +\d+ min$/m, "one group at a time: nothing to say about the slowest");
  assert.match(text, /^Veegronde per pagina gerekend uit de tellingen van de inventaris, 45 tot 45 links en bedieningselementen per pagina, laadtijd gemiddeld 0,6 s \(traagste 0,6 s\)\.$/m);
  assert.match(text, /Nog te gaan: ongeveer \d u \d\d \(marge /);
  assert.match(text, /Geijkt op 6 runs op twee sites .*commit 5051033/);
  assert.match(text, /Niet gedekt: .*een site die tijdens het onderzoek trager wordt dan bij de inventaris/);
  assert.doesNotMatch(text, /laadtijd van de pagina's niet gemeten/, "the inventory timed every page");
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
  const { sweep: _sweep, ...basis } = result.basis;
  assert.deepEqual(basis, { ...REMOTE, atOnceSource: "session", scheduling: "groups" });
  assert.ok(result.rows.every((entry) => entry.status === "done" && entry.remainingSeconds === 0 && entry.measuredSeconds !== null && entry.estimatedSeconds !== null), "every part has both numbers; the inventory, which this run could not time, is left out");
  assert.deepEqual(Object.fromEntries(result.rows.map((entry) => [entry.id, entry.measuredSeconds! / 60])), { explore: 8, collect: 33, contrast: 3, states: 25, gate: 1, walks: 23, judges: 56, verifiers: 42, report: 1, between: 6 });
  assert.deepEqual(result.rows.filter((entry) => entry.derived).map((entry) => entry.id), ["collect", "contrast", "states", "gate", "report"]);
  assert.equal(result.totals.measuredSeconds, 198 * 60);
  assert.equal(result.totals.remainingSeconds, 0);
  const text = estimateTextNl(result, result.run, result.notesNl);
  assert.match(text, /^collect +\d+ min +~33 min +klaar$/m);
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
  for (const name of ["lib/estimate.ts", "lib/estimate-sweep.ts", "lib/progress.ts", "commands/estimate.ts", "lib/timing.ts"]) {
    assert.ok(!/\/Users\/|\/home\/|declaredBy/.test(source(name)), `${name} noemt een thuismap of leest wie iets verklaarde`);
  }
  // A number of the estimate lives in COEFFICIENTS; the command only reads the run.
  assert.ok(!/\d\.\d/.test(source("commands/estimate.ts")), "commands/estimate.ts bevat een coëfficiënt; die hoort in lib/estimate.ts");
});


/** Synthetic work for the sweep: `pages` pages with these links and controls and this load, on a site elsewhere. */
function work(pages: number, page: Partial<PageWork> = {}, rest: Partial<SweepWork> = {}): SweepWork {
  return {
    pages: Array.from({ length: pages }, (_, index) => ({ loadSeconds: 1, links: 40, controls: 5, forms: 0, newTemplate: index < 5, arrowWalks: null, newOperable: null, pressable: null, ...page })),
    source: "inventory",
    narrowPages: 5,
    modelStates: 5,
    capturedStates: 5,
    navigationDelaySeconds: 1,
    limits: { press: 600, hover: 400 },
    ...rest,
  };
}

const laneTotal = (plan: { lanes: { id: string; parts: { units: number[] }[] }[] }, id: string): number => plan.lanes.find((entry) => entry.id === id)!.parts.reduce((total, part) => total + part.units.reduce((a, b) => a + b, 0), 0);

test("makespan: jobs taken in order by whichever lane is free first", () => {
  assert.equal(makespan([], 3), 0);
  assert.equal(makespan([5, 5, 5, 5], 1), 20);
  assert.equal(makespan([5, 5, 5, 5], 2), 10);
  assert.equal(makespan([10, 1, 1, 1], 4), 10, "the slowest job sets the end");
  assert.equal(makespan([4, 4], 2, [6]), 8, "a lane that is busy takes on later");
});

test("the sweep per page: more to operate and a slower load take longer, and the probes of states stop at their limits", () => {
  const plain = sweepPlans(work(20), 1, false);
  const busy = sweepPlans(work(20, { links: 160, controls: 20 }), 1, false);
  const slow = sweepPlans(work(20, { loadSeconds: 6 }), 1, false);
  for (const command of ["collect", "contrast", "states"] as const) {
    assert.ok(busy[command].seconds >= plain[command].seconds, `${command}: meer te bedienen duurt niet korter`);
    assert.ok(slow[command].seconds > plain[command].seconds, `${command}: een trage site duurt langer`);
  }
  assert.ok(busy.collect.seconds > plain.collect.seconds * 2, "collect walks every link with Tab");
  // Every load of collect waits on the site: five seconds more per load is that times the loads of each page, and of each state of the model.
  near(slow.collect.seconds - plain.collect.seconds, (20 + 5 * SWEEP_COEFFICIENTS.collect.capturedStateShare) * SWEEP_COEFFICIENTS.collect.loads * 5, "collect op een trage site");
  // Past the limits a page costs its loads and a look: the pointer group grows less with the 300th page than with the 20th.
  const many = sweepPlans(work(300, { links: 160, controls: 20 }), 1, false);
  const more = sweepPlans(work(301, { links: 160, controls: 20 }), 1, false);
  near(laneTotal(more.states, "pointer") - laneTotal(many.states, "pointer"), 2 * (1 + SWEEP_COEFFICIENTS.states.pointer.perPage), "één pagina na de grenzen");
  assert.ok(laneTotal(busy.states, "pointer") - laneTotal(plain.states, "pointer") > 100, "before the limits every kind is pointed at and pressed");
});

test("the sweep with --at-once: collect spreads its pages, contrast its four passes, states its five groups and the pages within them", () => {
  const sites = work(20);
  const one = sweepPlans(sites, 1, false);
  const four = sweepPlans(sites, 4, false);
  const groups = (plan: ReturnType<typeof sweepPlans>["states"]): number[] => plan.lanes.map((lane) => laneTotal(plan, lane.id));
  const lane = (plan: ReturnType<typeof sweepPlans>["states"], id: string) => plan.lanes.find((entry) => entry.id === id)!;
  // One at a time every lane follows the other.
  near(one.states.seconds, groups(one.states).reduce((a, b) => a + b, 0), "states één tegelijk");
  near(one.collect.seconds, one.collect.lanes.flatMap((lane) => lane.parts.flatMap((part) => part.units)).reduce((a, b) => a + b, 0), "collect één tegelijk");
  // Four pages at once: about a quarter, each page the slower for the others, and never faster than the navigations allow.
  const spread = (units: number[]): number => makespan(units.map((unit) => unit * four.collect.slowdown), 4);
  near(four.collect.seconds, Math.max(four.collect.floorSeconds, spread(four.collect.lanes[0]!.parts[0]!.units) + spread(four.collect.lanes[1]!.parts[0]!.units)), "collect vier tegelijk");
  assert.ok(four.collect.seconds < one.collect.seconds / 2);
  // Contrast has four passes: more than four at once gains nothing.
  assert.equal(sweepPlans(sites, 8, false).contrast.seconds, four.contrast.seconds);
  // States: the five groups start together and share the browsers with the pages within them. The keys, pointing and
  // pressing and the arrow keys spread their pages over the browsers; forms and buttons go page after page, and the
  // states of the site model one after the other.
  const five = sweepPlans(sites, 5, false);
  assert.equal(five.states.atOnce, 5);
  near(laneTotal(five.states, "keys"), makespan(lane(one.states, "keys").parts[0]!.units, 5), "toetsen over vijf browsers");
  assert.deepEqual(lane(five.states, "forms"), lane(one.states, "forms"), "forms and buttons page after page");
  assert.deepEqual(lane(five.states, "keysInStates"), lane(one.states, "keysInStates"), "the keys in the states one after the other");
  assert.deepEqual(lane(five.states, "pointer").parts.at(-1), lane(one.states, "pointer").parts.at(-1), "pointing and pressing in the states one after the other");
  // The step lasts as long as its slowest group, and no less than all the work shared over the browsers.
  near(five.states.floorSeconds, (groups(one.states).reduce((a, b) => a + b, 0) * five.states.slowdown) / 5, "al het werk over vijf browsers");
  near(five.states.seconds, Math.max(Math.max(...groups(five.states)) * five.states.slowdown, five.states.floorSeconds), "states vijf tegelijk");
  const two = sweepPlans(sites, 2, false);
  near(two.states.seconds, two.states.floorSeconds, "two browsers are full the whole time");
  // More browsers gain until one group sets the pace: pointing and pressing on the first page, where every control is
  // new, or forms and buttons page after page.
  const eight = sweepPlans(sites, 8, false);
  assert.ok(eight.states.seconds < five.states.seconds && five.states.seconds < four.states.seconds && four.states.seconds < two.states.seconds);
  near(eight.states.seconds, Math.max(...groups(eight.states)) * eight.states.slowdown, "de traagste groep bepaalt de duur");
  assert.equal(sweepPlans(sites, 12, false).states.seconds, eight.states.seconds, "past that more at once gains nothing");
  assert.equal(slowestLane(sweepPlans(work(20, { forms: 2 }), 8, false).states)?.id, "forms");
  // Many at once wait for the time between two navigations to the same site.
  const quick = sweepPlans(work(20, { loadSeconds: 0, links: 0, controls: 0 }, { navigationDelaySeconds: 10, modelStates: 0, capturedStates: 0 }), 4, false);
  assert.equal(quick.collect.floorSeconds, 20 * SWEEP_COEFFICIENTS.collect.loads * 10);
  assert.equal(quick.collect.seconds, quick.collect.floorSeconds);
});

test("a step that runs is carried on at the pace each lane kept, and a lane that did not begin goes as planned", () => {
  const sites = work(19, { links: 140, controls: 5 });
  const plans = sweepPlans(sites, 5, false);
  const when = (minutes: number): string => new Date(Date.parse("2026-10-16T07:00:00.000Z") + minutes * 60_000).toISOString();
  const lanes = (entries: StepProgress["lanes"]): StepProgress => ({ command: "states", startedAt: when(0), updatedAt: when(20), atOnce: 5, lanes: entries });
  const pointer = plans.states.lanes.find((lane) => lane.id === "pointer")!;
  const sumOf = (units: number[]): number => units.reduce((a, b) => a + b, 0);
  // With five at once the pages of a part are spread over the browsers: the plan has one unit for the part, and four of 19 pages are that share of it.
  const doneSeconds = sumOf(pointer.parts[0]!.units) + sumOf(pointer.parts[1]!.units) + (sumOf(pointer.parts[2]!.units) * 4) / 19;
  const total = laneTotal(plans.states, "pointer");
  // Twenty minutes in: four groups are done, pressing is at page 4 of 19.
  const progress = lanes({
    forms: { startedAt: when(0), endedAt: when(6), parts: { "formulieren en knoppen": { done: 19, total: 19 }, "knoppen smal": { done: 19, total: 19 } } },
    keys: { startedAt: when(0), endedAt: when(4), parts: { toetsen: { done: 19, total: 19 } } },
    keysInStates: { startedAt: when(0), endedAt: when(3), parts: { "toetsen in toestand": { done: 5, total: 5 } } },
    pointer: { startedAt: when(0), endedAt: null, parts: { aanwijzen: { done: 19, total: 19 }, "aanwijzen smal": { done: 5, total: 5 }, indrukken: { done: 4, total: 19 } } },
    arrows: { startedAt: when(0), endedAt: when(2), parts: { pijltoetsen: { done: 19, total: 19 } } },
  });
  const step = runningStep(plans.states, progress);
  assert.equal(step.elapsedSeconds, 1200);
  assert.deepEqual([step.lanesDone, step.lanes], [4, 5]);
  assert.deepEqual(step.slowest && [step.slowest.id, step.slowest.part, step.slowest.done, step.slowest.total], ["pointer", "indrukken", 4, 19]);
  // The pointer group goes on at its own pace: twenty minutes for what the plan gave `doneSeconds`.
  near(step.remainingSeconds, (total - doneSeconds) * (1200 / doneSeconds), "de rest van aanwijzen en indrukken");
  assert.ok(step.pace !== null && step.pace > 0);
  // A group that has not begun goes as planned, however slow the others are: the groups differ too much to take each other's pace.
  const formsDone = sumOf(plans.states.lanes[0]!.parts[0]!.units.slice(0, 2));
  const waiting = runningStep(plans.states, lanes({ forms: { startedAt: when(0), endedAt: null, parts: { "formulieren en knoppen": { done: 2, total: 19 } } } }));
  const others = plans.states.lanes.slice(1).map((lane) => laneTotal(plans.states, lane.id) * plans.states.slowdown);
  near(waiting.remainingSeconds, Math.max((laneTotal(plans.states, "forms") - formsDone) * (1200 / formsDone), ...others), "de traagste van de lopende en de wachtende groepen");
  // Asked a minute after the last line of progress: that minute of work is off what is left.
  near(runningStep(plans.states, progress, when(21)).remainingSeconds, step.remainingSeconds - 60, "een minuut later");
  // Nothing done yet: the plan stands.
  const fresh = runningStep(plans.states, lanes({ pointer: { startedAt: when(0), endedAt: null, parts: {} } }));
  assert.equal(fresh.pace, null);
  near(fresh.remainingSeconds, plans.states.seconds, "zonder tempo de schatting");

  // collect with six at once: eight of nineteen pages in ten minutes, then the states of the site model.
  const collectPlan = sweepPlans(sites, 6, false).collect;
  const pages = collectPlan.lanes[0]!.parts[0]!.units;
  const collecting = runningStep(collectPlan, { command: "collect", startedAt: when(0), updatedAt: when(10), atOnce: 6, lanes: { pages: { startedAt: when(0), endedAt: null, parts: { pages: { done: 8, total: 19 } } }, siteStates: { startedAt: null, endedAt: null, parts: {} } } });
  const pace = 600 / sumOf(pages.slice(0, 8));
  const statesLeft = makespan(collectPlan.lanes[1]!.parts[0]!.units.map((unit) => unit * collectPlan.slowdown), 6) * (pace / (collectPlan.slowdown / 6));
  near(collecting.remainingSeconds, sumOf(pages.slice(8)) * pace + statesLeft, "de rest van collect");
  assert.deepEqual(collecting.pages, { done: 8, total: 19 });
});

test("from a run: the counts per page of the inventory, the at-once of the sweep so far, a step that runs, and a step that stopped", () => {
  const pages = Array.from({ length: 6 }, (_, index) => inventoryPage(`t${index % 2}`, index, { loadMs: 2000 + index * 100, links: 100, controls: 10 }));
  const steps: ManifestStep[] = [
    { command: "inventory", startedAt: at(0), at: at(5), seconds: 300 },
    { command: "check-site", startedAt: at(9), at: at(10), seconds: 60, ok: true },
    { command: "collect", startedAt: at(11), at: at(31), seconds: 1200, atOnce: 4 },
  ];
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: [], pages, sample: 6, pageTypes: 2, steps });
  const before = estimateRun(run, { now: new Date(at(32)) });
  assert.equal(before.basis.sweepAtOnce, 4, "without --at-once the sweep goes on as its last step went");
  assert.equal(before.sweep.source, "inventory");
  assert.deepEqual(before.sweep.loadSeconds, { mean: 2.3, most: 2.5 });
  assert.equal(before.notCoveredNl.filter((line) => /trage/.test(line)).length, 1);
  assert.match(estimateTextNl(before, before.run), /laadtijd gemiddeld 2,3 s \(traagste 2,5 s\)/);
  // contrast runs: one of its four passes is done, the others are halfway.
  const progress: StepProgress = {
    command: "contrast",
    startedAt: at(31),
    updatedAt: at(41),
    atOnce: 4,
    lanes: Object.fromEntries(["light", "dark", "light-320", "dark-320"].map((lane, index) => [lane, { startedAt: at(31), endedAt: index === 0 ? at(39) : null, parts: { pages: { done: index === 0 ? 6 : 3, total: 6 } } }])),
  };
  mkdirSync(join(run, "progress"), { recursive: true });
  writeFileSync(join(run, "progress", "contrast.json"), JSON.stringify(progress));
  const running = estimateRun(run, { now: new Date(at(41)) });
  const contrastRow = row(running, "contrast");
  assert.deepEqual([contrastRow.status, contrastRow.measuredSeconds], ["running", 600]);
  assert.match(contrastRow.noteNl!, /^1 van 4 rondes klaar; (licht|donker)( 320 breed)? bij pagina 3 van 6; .*(keer zo lang als geschat|procent van de geschatte tijd)$/);
  // Three passes halfway after ten minutes: about ten more; the pages still to come load a little slower.
  assert.ok(contrastRow.remainingSeconds >= 600 && contrastRow.remainingSeconds < 700, `nog ${contrastRow.remainingSeconds} s`);
  assert.equal(running.totals.measuredSeconds, 41 * 60, "the run went on until the progress was written");
  assert.match(estimateTextNl(running, running.run), /^contrast +\d+ (s|min) +10 min +loopt, 1 van 4 rondes klaar; .*, nog 1[01] min$/m);
  assert.equal(running.notesNl.some((note) => /voortgang/.test(note)), false);
  // Half an hour without a word: the estimate asks whether the step still runs.
  const quiet = estimateRun(run, { now: new Date(at(80)) });
  assert.ok(quiet.notesNl.some((note) => /^contrast schreef zijn voortgang 39 min geleden voor het laatst; loopt de stap nog\?/.test(note)));
  // Once contrast is done after it began, its progress is no longer read.
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ toolbox: { commit: `${CALIBRATION.commit}abc`, version: "0.0.1" }, steps: [...steps, { command: "contrast", startedAt: at(31), at: at(50), seconds: 1140 }] }));
  assert.equal(row(estimateRun(run), "contrast").status, "done");
  // An inventory from before the counts: a typical page, said so, and the slow site not covered.
  const older = estimateRun(makeRun({ baseUrl: "https://voorbeeld.example/", templates: [], pages: [{ slug: "p0", templateHash: "a" }], sample: 1, pageTypes: 1 }));
  assert.equal(older.sweep.source, "typical");
  assert.equal(older.sweep.loadSeconds, null);
  assert.ok(older.notesNl.some((note) => /telt de links en bedieningselementen per pagina nog niet/.test(note)));
  assert.match(older.notCoveredNl[0]!, /^een trage site: deze inventaris heeft de laadtijd/);
});

test("after collect the counts come from its measurements: links and controls with the blockers closed, and the walks with the arrow keys", () => {
  const run = makeRun({ baseUrl: "https://voorbeeld.example/", templates: ["a", "b"], sample: 2, pageTypes: 2 });
  const inventoryOnly = estimateRun(run);
  for (const slug of ["p0", "p1"]) {
    mkdirSync(join(run, "pages", slug, "probes"), { recursive: true });
    writeFileSync(join(run, "pages", slug, "facts.json"), JSON.stringify({ links: Array.from({ length: 200 }, () => ({})), controls: [{}], counts: { forms: 0 } }));
    writeFileSync(join(run, "pages", slug, "probes", "tabwalk.json"), JSON.stringify({ arrowReach: [{}, {}] }));
  }
  const measured = estimateRun(run);
  assert.equal(measured.sweep.source, "collect");
  assert.deepEqual(
    measured.basis.sweep!.pages.map((page) => [page.links, page.controls, page.arrowWalks]),
    [
      [200, 1, 2],
      [200, 1, 2],
    ],
  );
  assert.ok(measured.sweep.steps.states.seconds > inventoryOnly.sweep.steps.states.seconds);
  assert.match(estimateTextNl(measured, measured.run), /^Veegronde per pagina gerekend uit de metingen van collect, 201 tot 201 links/m);
});

test("the plan names its lanes and parts as the commands name them in their progress, so that a running step can be read", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/commands/states.ts", import.meta.url)), "utf8");
  const plans = sweepPlans(work(2), 1, false);
  assert.deepEqual(plans.states.lanes.map((lane) => lane.id), [...STATES_GROUPS], "the groups of states, in their order");
  assert.deepEqual(plans.contrast.lanes.map((lane) => lane.id), ["light", "dark", "light-320", "dark-320"], "the passes of contrast, as it names them");
  // A pointer probe names its part in the narrow window after itself: "aanwijzen" and "aanwijzen smal".
  const named = (id: string): boolean => source.includes(`"${id}"`) || (id.endsWith(" smal") && source.includes("`${probe} smal`") && source.includes(`"${id.slice(0, -" smal".length)}"`));
  for (const lane of plans.states.lanes) {
    for (const part of lane.parts) assert.ok(named(part.id), `states.ts noemt het deel "${part.id}" niet: de voortgang en de schatting lopen uit elkaar`);
  }
});

test("a step writes how far it is while it runs, and on finishing gives the seconds of each lane and removes the file", () => {
  const run = mkdtempSync(join(tmpdir(), "estimate-"));
  let clock = Date.parse("2026-10-16T08:00:00.000Z");
  const now = (): Date => new Date(clock);
  const file = new ProgressFile(run, "states", ["forms", "pointer"], 5, now);
  assert.deepEqual(readProgress(run, "states")?.lanes.forms, { startedAt: null, endedAt: null, parts: {} });
  file.start("forms");
  file.start("pointer");
  clock += 60_000;
  file.tick("pointer", "aanwijzen", 3, 19);
  clock += 1000;
  // Within two seconds of the last write a tick is kept in memory only; a lane that ends is written at once.
  file.tick("pointer", "aanwijzen", 4, 19);
  assert.deepEqual(readProgress(run, "states")?.lanes.pointer?.parts, { aanwijzen: { done: 3, total: 19 } });
  clock += 29_000;
  file.end("forms");
  const written = readProgress(run, "states")!;
  assert.deepEqual(written.lanes.pointer?.parts, { aanwijzen: { done: 4, total: 19 } });
  assert.equal(written.lanes.forms?.endedAt, "2026-10-16T08:01:30.000Z");
  assert.equal(written.updatedAt, "2026-10-16T08:01:30.000Z");
  clock += 30_000;
  file.end("pointer");
  assert.deepEqual(file.finish(), { forms: 90, pointer: 120 });
  assert.equal(readProgress(run, "states"), null);
  assert.ok(!existsSync(join(run, "progress")), "no empty folder is left in the run");
});

test("the two runs elsewhere that the old estimate missed: collect at the pace of its links, and states as long as its slowest group with the pages within it one after the other", () => {
  // 223 pages one at a time, about 87 links a page: collect took 112 seconds a page, where the fixed estimate said 68.
  const many = sweepPlans(work(223, { links: 85, controls: 8, loadSeconds: null }, { narrowPages: 11, modelStates: 17, capturedStates: 17 }), 1, false);
  const perPage = many.collect.lanes[0]!.parts[0]!.units[0]!;
  assert.ok(perPage > 100 && perPage < 125, `collect per pagina ${perPage} s`);
  // 19 pages six at once, with these links and controls per page and these new to the probes, as collect measured them.
  const operable = [126, 177, 118, 108, 146, 169, 156, 45, 118, 35, 30, 118, 47, 32, 40, 32, 0, 0, 0];
  const fresh = [123, 49, 50, 74, 18, 34, 103, 10, 42, 0, 0, 50, 13, 1, 6, 1, 0, 0, 0];
  const pages = operable.map((count, index) => ({ loadSeconds: null, links: count, controls: 0, forms: 0, newTemplate: index < 17, arrowWalks: 0, newOperable: fresh[index]!, pressable: count > 0 }));
  const site = { pages, source: "collect" as const, narrowPages: 11, modelStates: 18, capturedStates: 18, navigationDelaySeconds: 1, limits: { press: 600, hover: 400 } };
  // That run had the five groups at the same time and the pages within a group one after the other, as `states` did
  // before it spread them too: its slowest group is the whole group of one page after the other, as slow as five groups at once make it.
  const six = sweepPlans(site, 6, false);
  // It took 30 minutes, nearly all of it pointing and pressing; the fixed estimate said 10.
  const pointing = laneTotal(sweepPlans(site, 1, false).states, "pointer") * six.states.slowdown;
  assert.ok(pointing > 25 * 60 && pointing < 35 * 60, `aanwijzen en indrukken ${durationNl(pointing)}`);
  assert.equal(slowestLane(sweepPlans(site, 1, false).states)?.id, "pointer");
  // Now that the pages within a group run at the same time too, the same site with six at once is reckoned well under that.
  assert.ok(six.states.seconds < pointing / 2, `states nu ${durationNl(six.states.seconds)}`);
  // Before collect counted what each page adds, it reckons with a third of every page after the first: the limits then decide.
  const before = laneTotal(sweepPlans({ ...site, pages: pages.map((page) => ({ ...page, newOperable: null, pressable: null })), source: "inventory" }, 1, false).states, "pointer") * six.states.slowdown;
  assert.ok(before > 25 * 60 && before < 40 * 60, `aanwijzen en indrukken vóór collect ${durationNl(before)}`);
});

test("the method names the numbers of the sweep as the code has them", () => {
  const method = readFileSync(fileURLToPath(new URL("../../docs/methode.md", import.meta.url)), "utf8");
  const nl = (value: number): string => String(value).replace(".", ",");
  const c = SWEEP_COEFFICIENTS;
  const collect = `${c.collect.loads} × de laadtijd + ${nl(c.collect.perPage)} + ${nl(c.collect.perLink)} per link + ${nl(c.collect.perControl)} per ander bedieningselement; daarna per toestand uit het sitemodel ${nl(c.collect.capturedStateShare)} × een gemiddelde pagina`;
  assert.ok(method.includes(collect), `docs/methode.md noemt collect niet als: ${collect}`);
  assert.ok(method.includes(`1 + (n − 1) × ${nl(c.slowdown.collect)} voor \`collect\`, × ${nl(c.slowdown.contrast)} voor \`contrast\` en × ${nl(c.slowdown.states)} voor \`states\``), "docs/methode.md noemt de vertraging met meer tegelijk niet zoals de code");
  assert.ok(method.includes(`Indrukken stopt bij ${MAX_DOWN_TARGETS} soorten en aanwijzen bij ${MAX_HOVER_TARGETS}`), "docs/methode.md noemt de grenzen van states niet zoals de code");
  assert.ok(method.includes(`1,2 per aangewezen element en ${nl(c.states.pointer.perPress)} + ${nl(c.states.pointer.freshAfterPress)} × de laadtijd per ingedrukt element`) && c.states.pointer.perHover === 1.2, "docs/methode.md noemt aanwijzen en indrukken niet zoals de code");
});
