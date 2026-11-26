import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { explore } from "../src/commands/explore.ts";
import { afterEveryReturn, MAX_RETURNS_TO_EXPLORER, route, type Gap } from "../src/commands/gate.ts";
import { EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES, EXPLORE_TOTAL_MINUTES, exploreMinutesUsed, exploreRoundBudget, exploreTotalMinutes, parseExploreMinutes, SWEEP_MINUTES, sweepMinutes } from "../src/lib/explore-budget.ts";
import type { Manifest, ManifestStep } from "../src/lib/manifest.ts";

// A run on a site with many kinds of pages went back to the explorer twice, and its three rounds took
// 191, 60 and 63 minutes from the task of the explorer to the verdict of the gate: half of the run,
// most of it in the sweep and the gate after each round (#730). The rounds share one total of wall time.
const run = mkdtempSync(join(tmpdir(), "loep-explore-budget-"));
after(() => rmSync(run, { recursive: true, force: true }));
writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://voorbeeld.test/", origin: "https://voorbeeld.test", sitemapUrls: 0, notFoundProbe: "", pages: [], skipped: [], totals: {} }));

const manifestPath = join(run, "manifest.json");
const steps = (): ManifestStep[] => (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest).steps;
const gap: Gap = { check: "tab-reach", page: "P1", url: "https://voorbeeld.test/", state: "default", missingNl: "tab-reach ontbreekt." };
const pages = [{ item: { url: "https://voorbeeld.test/" } }];
const at = (from: number, minutes: number): string => new Date(from + minutes * 60_000).toISOString();
const command = (name: string, from: number, begin: number, end: number, extra: Record<string, unknown> = {}): ManifestStep => ({ command: name, startedAt: at(from, begin), at: at(from, end), seconds: Math.round((end - begin) * 60), ...extra });

/**
 * What one round leaves in the manifest after its `explore` at `from`: the explorer's check after `explorer` minutes, a
 * sweep of `sweep` minutes, and the gate's verdict `wall` minutes after the task, after a first gate and a look at the pictures.
 */
function round(from: number, explorer: number, sweep: number, wall: number): ManifestStep[] {
  const quarter = sweep / 4;
  const swept = explorer + sweep;
  return [
    command("check-site", from, explorer - 1, explorer),
    command("collect", from, explorer, explorer + quarter, { only: null }),
    command("contrast", from, explorer + quarter, explorer + 2 * quarter),
    command("states", from, explorer + 2 * quarter, explorer + 3 * quarter),
    command("documents", from, explorer + 3 * quarter, swept),
    command("gate", from, swept, swept + 1),
    command("gate", from, wall - 1, wall),
  ];
}
/** Append the steps of the round that the last `explore` of the run began. */
function finish(explorer: number, sweep: number, wall: number): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const task = manifest.steps.findLast((step) => step.command === "explore")!;
  manifest.steps.push(...round(Date.parse(task.at), explorer, sweep, wall));
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

test("the run of the issue: the second round gets what is left after a sweep, the third does not start", async () => {
  const first = await explore(run);
  assert.deepEqual([first.round, first.minutes, first.totalMinutes, first.usedMinutes], [1, EXPLORE_MAX_MINUTES, EXPLORE_TOTAL_MINUTES, 0]);
  assert.equal(EXPLORE_TOTAL_MINUTES, 240);
  assert.match(readFileSync(first.task, "utf8"), new RegExp(`hooguit ${EXPLORE_MAX_COMMANDS} commando's en ${EXPLORE_MAX_MINUTES} minuten`));
  assert.equal(exploreTotalMinutes(steps()), EXPLORE_TOTAL_MINUTES, "the total is kept in the run");

  // 70 minutes of the explorer, a sweep of 45, and the gate with a second sweep: 191 minutes to the verdict.
  finish(70, 45, 191);
  assert.equal(exploreMinutesUsed(steps()), 191);
  assert.equal(sweepMinutes(steps()), 45);
  const afterFirst = route([gap], [], true, steps(), () => false);
  assert.deepEqual([afterFirst.next, afterFirst.exploreTime], ["explore", { totalMinutes: 240, usedMinutes: 191, sweepMinutes: 45, spent: false }]);
  // 49 minutes are left: the sweep fits, and the explorer gets a short session.
  const second = await explore(run);
  assert.deepEqual([second.round, second.minutes, second.usedMinutes], [2, 10, 191]);
  assert.match(readFileSync(second.task, "utf8"), /--max-commands 50 --max-minutes 10 /);

  // 15 minutes of the explorer, a sweep of 40 and the gate: 60 minutes, 251 together.
  finish(15, 40, 60);
  const now = at(Date.parse(steps().at(-1)!.at), 0);
  const afterSecond = route([gap], [], true, steps(), () => false, now);
  assert.deepEqual([afterSecond.next, afterSecond.returnsLeft, afterSecond.exploreTime?.usedMinutes, afterSecond.exploreTime?.spent], ["stop", 0, 251, true]);
  const limited = afterEveryReturn(afterSecond.next, afterSecond.stage, afterSecond.gaps, pages as never, afterSecond.exploreTime);
  assert.deepEqual([limited.next, limited.gaps.length, limited.degradedLimitations.length], ["proceed", 0, 1]);
  assert.match(limited.degradedLimitations[0]!.missingNl, /^De 240 minuten voor het verkennen van de site waren op voordat dit opnieuw bekeken kon worden: tab-reach ontbreekt\./);

  // explore gives no third round either, unless somebody gives more time.
  await assert.rejects(explore(run), /geen nieuwe ronde voor de verkenner: de tijd voor de verkenning is op: 251 van 240 minuten.*veegronde van ongeveer 40 minuten.*Draai gate/);
  const more = await explore(run, { totalMinutes: 480 });
  assert.deepEqual([more.round, more.minutes, more.totalMinutes], [3, EXPLORE_MAX_MINUTES, 480]);
});

test("the test sites notice nothing: every round they had gets its usual session, and a third would still fit", () => {
  const begin = Date.UTC(2026, 10, 1);
  // Per round from explore to the verdict of the gate: 61 and 32 minutes on one, 61 and 18 on the other.
  for (const [[explorer1, sweep1, wall1], [explorer2, sweep2, wall2]] of [[[15, 40, 61], [8, 20, 32]], [[15, 40, 61], [5, 10, 18]]] as const) {
    const firstRound = [command("explore", begin, 0, 0, { totalMinutes: 240, maxMinutes: 40 }), ...round(begin, explorer1, sweep1, wall1)];
    assert.equal(exploreMinutesUsed(firstRound), wall1);
    assert.deepEqual(exploreRoundBudget(240, exploreMinutesUsed(firstRound), sweepMinutes(firstRound)), { commands: EXPLORE_MAX_COMMANDS, minutes: EXPLORE_MAX_MINUTES });
    const later = begin + (wall1 + 5) * 60_000;
    const both = [...firstRound, command("explore", later, 0, 0, { totalMinutes: 240, maxMinutes: 40 }), ...round(later, explorer2, sweep2, wall2)];
    const routed = route([gap], [], true, both, () => false);
    assert.deepEqual([routed.next, routed.returnsLeft, routed.exploreTime?.usedMinutes, routed.exploreTime?.spent], ["explore", MAX_RETURNS_TO_EXPLORER - 1, wall1 + wall2, false]);
  }
});

test("a run from before the total keeps every round it had, with the usual budget", () => {
  const minute = (offset: number): string => new Date(Date.UTC(2026, 10, 1) + offset * 60_000).toISOString();
  // Two rounds of four hours together, as the runs made before the total: no `totalMinutes` in any step.
  const old = [
    { command: "explore", at: minute(0) },
    { command: "check-site", at: minute(90) },
    { command: "gate", at: minute(120) },
    { command: "explore", at: minute(121) },
    { command: "check-site", at: minute(211) },
    { command: "gate", at: minute(240) },
  ];
  assert.equal(exploreTotalMinutes(old), null);
  assert.deepEqual(exploreRoundBudget(null, exploreMinutesUsed(old), sweepMinutes(old)), { commands: EXPLORE_MAX_COMMANDS, minutes: EXPLORE_MAX_MINUTES });
  const routed = route([gap], [], true, old, () => false, minute(300));
  assert.deepEqual([routed.next, routed.returnsLeft, "exploreTime" in routed], ["explore", MAX_RETURNS_TO_EXPLORER - 1, false]);
  assert.match(afterEveryReturn("stop", "complete", [gap], pages as never, routed.exploreTime).degradedLimitations[0]!.missingNl, /^Na 2 keer terug naar de verkenner nog open: /);
});

test("a pause, a question to a person, a night or a clock that jumps does not use up the budget", () => {
  const begin = Date.UTC(2026, 10, 1);
  const task = command("explore", begin, 0, 0, { totalMinutes: 240, maxMinutes: 40 });
  // The run stopped on a limit during the first round and went on the next morning: ten hours from task to check.
  const night = [task, command("check-site", begin, 599, 600), command("collect", begin, 600, 630), command("gate", begin, 640, 641)];
  assert.equal(exploreMinutesUsed(night), 80 + 1 + 30 + 10 + 1, "the night counts as long as a session can grow, no more");
  assert.equal(route([gap], [], true, night, () => false).next, "explore", "a return is left");
  // A person answered a question after two hours, between two commands of the sweep.
  const question = [task, command("check-site", begin, 29, 30), command("collect", begin, 30, 50), command("contrast", begin, 170, 175), command("gate", begin, 175, 176)];
  assert.equal(exploreMinutesUsed(question), 30 + 20 + 80 + 5 + 1);
  // The time between the verdict of the gate and the next task is a person deciding, and never counts.
  const waited = [...question, command("explore", begin, 900, 900, { totalMinutes: 240, maxMinutes: 40 }), command("gate", begin, 930, 930)];
  assert.equal(exploreMinutesUsed(waited), 136 + 30);
  // A clock that went back counts nothing for that stretch; one that jumped ahead no more than a session.
  assert.equal(exploreMinutesUsed([task, command("check-site", begin, -30, -30), command("gate", begin, -20, -20)]), 10);
  assert.equal(exploreMinutesUsed([task, command("collect", begin, 0, 2000)]), 80);
  // Without its own time a sweep is reckoned as one over a sample of the usual size.
  assert.equal(sweepMinutes([task]), SWEEP_MINUTES);
});

test("the round the gate is judging runs until now", () => {
  const begin = Date.UTC(2026, 10, 1);
  const open = [command("explore", begin, 0, 0, { totalMinutes: 240, maxMinutes: 40 }), command("check-site", begin, 29, 30), command("collect", begin, 30, 75)];
  assert.equal(exploreMinutesUsed(open, at(begin, 80)), 80);
  assert.equal(exploreMinutesUsed(open), 75);
});

test("--explore-minutes takes whole minutes, enough for one short round", () => {
  assert.equal(parseExploreMinutes(undefined), undefined);
  assert.equal(parseExploreMinutes("240"), 240);
  assert.throws(() => parseExploreMinutes("15"), /minstens 20/);
  assert.throws(() => parseExploreMinutes("twee uur"), /heel aantal minuten/);
  assert.equal(exploreRoundBudget(100, 50, 45)?.minutes, 10, "a round that starts gets at least a short session");
  assert.equal(exploreRoundBudget(100, 60, 45), null, "no round when its sweep does not fit");
});

test("a short later round still counts a sweep of full length, and commands that ran at the same time count once", () => {
  const begin = Date.UTC(2026, 10, 1);
  // A round with a session of 10 minutes, and a states of 50 minutes on a large sample: the sweep is no shorter for the short session.
  const short = [command("explore", begin, 0, 0, { totalMinutes: 240, maxMinutes: 10 }), command("check-site", begin, 9, 10), command("states", begin, 10, 60), command("gate", begin, 60, 61)];
  assert.equal(exploreMinutesUsed(short), 61);
  // Two commands of the sweep at the same time: the twenty minutes they share count once.
  const overlap = [command("explore", begin, 0, 0, { totalMinutes: 240, maxMinutes: 40 }), command("collect", begin, 0, 30), command("contrast", begin, 10, 35), command("gate", begin, 35, 36)];
  assert.equal(exploreMinutesUsed(overlap), 36);
});

test("a sweep that is still running or stopped halfway is not the estimate of a sweep", () => {
  const begin = Date.UTC(2026, 10, 1);
  const full = [command("collect", begin, 0, 10, { only: null }), command("contrast", begin, 10, 12), command("states", begin, 12, 32), command("documents", begin, 32, 35)];
  // The next sweep has its collect and contrast in the manifest, its states not yet: the full one before it counts.
  const halfway = [...full, command("collect", begin, 40, 43, { only: null }), command("contrast", begin, 43, 44)];
  assert.equal(sweepMinutes(halfway), 35);
  assert.equal(sweepMinutes(halfway.slice(4)), SWEEP_MINUTES);
});
