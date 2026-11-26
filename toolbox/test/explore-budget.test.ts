import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { explore } from "../src/commands/explore.ts";
import { afterEveryReturn, MAX_RETURNS_TO_EXPLORER, route, type Gap } from "../src/commands/gate.ts";
import { EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES, EXPLORE_TOTAL_MINUTES, exploreMinutesUsed, exploreRoundBudget, exploreTotalMinutes, parseExploreMinutes } from "../src/lib/explore-budget.ts";
import type { Manifest, ManifestStep } from "../src/lib/manifest.ts";

// An explorer on a site with many kinds of pages used three full sessions, each with both
// extensions, and so half of a run, for a report about the same sample (#730). The rounds share one total.
const run = mkdtempSync(join(tmpdir(), "loep-explore-budget-"));
after(() => rmSync(run, { recursive: true, force: true }));
writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://voorbeeld.test/", origin: "https://voorbeeld.test", sitemapUrls: 0, notFoundProbe: "", pages: [], skipped: [], totals: {} }));

const manifestPath = join(run, "manifest.json");
const steps = (): ManifestStep[] => (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest).steps;
/** The explorer ran its check this many minutes after its last task. */
function checkedAfter(minutes: number): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const task = manifest.steps.findLast((step) => step.command === "explore")!;
  manifest.steps.push({ command: "check-site", at: new Date(Date.parse(task.at) + minutes * 60_000).toISOString() });
  writeFileSync(manifestPath, JSON.stringify(manifest));
}
const gap: Gap = { check: "tab-reach", page: "P1", url: "https://voorbeeld.test/", state: "default", missingNl: "tab-reach ontbreekt." };
const pages = [{ item: { url: "https://voorbeeld.test/" } }];

test("the rounds of the explorer share one total of minutes, and a round gets what is left of it", async () => {
  const first = await explore(run);
  assert.deepEqual([first.round, first.minutes, first.totalMinutes, first.usedMinutes], [1, EXPLORE_MAX_MINUTES, EXPLORE_TOTAL_MINUTES, 0]);
  assert.match(readFileSync(first.task, "utf8"), new RegExp(`hooguit ${EXPLORE_MAX_COMMANDS} commando's en ${EXPLORE_MAX_MINUTES} minuten`));
  assert.equal(exploreTotalMinutes(steps()), EXPLORE_TOTAL_MINUTES, "the total is kept in the run");

  // The first round took 100 of the 120 minutes, with its extensions: 20 are left, so a round of 10 that fits with both of its own.
  checkedAfter(100);
  const second = await explore(run);
  assert.deepEqual([second.round, second.minutes, second.usedMinutes], [2, 10, 100]);
  const task = readFileSync(second.task, "utf8");
  assert.match(task, /hooguit 50 commando's en 10 minuten/);
  assert.match(task, /--max-commands 50 --max-minutes 10 /);

  // The gate sees it too: a return is left by count, but no round fits any more.
  checkedAfter(15);
  assert.equal(exploreMinutesUsed(steps()), 115);
  const routed = route([gap], [], true, steps(), () => false);
  assert.deepEqual([routed.next, routed.returnsLeft, routed.exploreTime], ["stop", 0, { totalMinutes: 120, usedMinutes: 115, spent: true }]);
  // And goes on with limitations, the way it does after the last return, saying why.
  const after = afterEveryReturn(routed.next, routed.stage, routed.gaps, pages as never, routed.exploreTime);
  assert.deepEqual([after.next, after.gaps.length, after.degradedLimitations.length], ["proceed", 0, 1]);
  assert.match(after.degradedLimitations[0]!.missingNl, /^Nog open toen de tijd voor de verkenning op was \(115 van 120 minuten voor alle rondes samen\): tab-reach ontbreekt\./);

  // explore itself gives no round either, unless somebody gives more time.
  await assert.rejects(explore(run), /geen nieuwe ronde voor de verkenner: de tijd voor de verkenning is op: 115 van 120 minuten.*Draai gate/);
  const more = await explore(run, { totalMinutes: 240 });
  assert.deepEqual([more.round, more.minutes, more.totalMinutes], [3, EXPLORE_MAX_MINUTES, 240]);
});

test("a run from before the total keeps every round it had, with the usual budget", () => {
  const minute = (offset: number): string => new Date(Date.UTC(2026, 10, 1) + offset * 60_000).toISOString();
  // Three rounds of four hours together, as the runs made before the total: no `totalMinutes` in any step.
  const old = [
    { command: "explore", at: minute(0) },
    { command: "check-site", at: minute(90) },
    { command: "gate", at: minute(120) },
    { command: "explore", at: minute(121) },
    { command: "check-site", at: minute(211) },
    { command: "gate", at: minute(240) },
  ];
  assert.equal(exploreTotalMinutes(old), null);
  assert.deepEqual(exploreRoundBudget(null, exploreMinutesUsed(old)), { commands: EXPLORE_MAX_COMMANDS, minutes: EXPLORE_MAX_MINUTES });
  const routed = route([gap], [], true, old, () => false);
  assert.deepEqual([routed.next, routed.returnsLeft, "exploreTime" in routed], ["explore", MAX_RETURNS_TO_EXPLORER - 1, false]);
  assert.match(afterEveryReturn("stop", "complete", [gap], pages as never, routed.exploreTime).degradedLimitations[0]!.missingNl, /^Na 2 keer terug naar de verkenner nog open: /);
});

test("--explore-minutes takes whole minutes, enough for one short round", () => {
  assert.equal(parseExploreMinutes(undefined), undefined);
  assert.equal(parseExploreMinutes("240"), 240);
  assert.throws(() => parseExploreMinutes("15"), /minstens 20/);
  assert.throws(() => parseExploreMinutes("twee uur"), /heel aantal minuten/);
  assert.equal(exploreRoundBudget(20, 0)?.minutes, 10);
});
