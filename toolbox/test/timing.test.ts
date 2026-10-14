import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Manifest, type ManifestStep, stepStart, writeManifest } from "../src/lib/manifest.ts";
import { agentPhaseTimings, elapsedSeconds, sessionLimit, stageTimings } from "../src/lib/timing.ts";

const COMMANDS_DIR = fileURLToPath(new URL("../src/commands/", import.meta.url));
const readManifest = (run: string): Manifest => JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")) as Manifest;

test("a step keeps when its command began and how long it took, and a run without begin times stays readable", async () => {
  const run = mkdtempSync(join(tmpdir(), "timing-"));
  // A manifest from before the begin was recorded: steps with `at` only.
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ steps: [{ command: "inventory", at: "2026-10-10T08:52:25.870Z" }], browser: { name: "chromium", version: "1" } }));
  const startedAt = new Date(Date.now() - 90_000).toISOString();
  await writeManifest(run, { command: "collect", startedAt, pages: 3 });
  await writeManifest(run, { command: "gate" });
  const steps = readManifest(run).steps;
  assert.deepEqual(steps[0], { command: "inventory", at: "2026-10-10T08:52:25.870Z" }, "an older step is kept as it was");
  assert.equal(steps[1]!.startedAt, startedAt);
  assert.equal(steps[1]!.seconds, 90);
  assert.equal(steps[1]!.pages, 3);
  assert.ok(Date.parse(steps[1]!.at) >= Date.parse(startedAt));
  assert.ok(!("seconds" in steps[2]!) && !("startedAt" in steps[2]!), "a step without a begin has no duration");
  assert.match(stepStart(), /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
});

test("every command that writes a step gives its begin along", () => {
  const problems: string[] = [];
  let calls = 0;
  for (const file of readdirSync(COMMANDS_DIR).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(COMMANDS_DIR, file), "utf8");
    for (const line of source.split("\n")) {
      if (!line.includes("await writeManifest(")) continue;
      calls++;
      if (!/\{ command: "[a-z-]+", startedAt, /.test(line)) problems.push(`${file}: ${line.trim().slice(0, 80)}`);
    }
    if (source.includes("await writeManifest(") && !source.includes("const startedAt = stepStart();")) problems.push(`${file}: neemt het begin niet met stepStart()`);
  }
  assert.ok(calls >= 13, "the reading of the commands finds the calls of writeManifest");
  assert.deepEqual(problems, []);
});

/** A session as the session process leaves it: session.json, and one record per command. */
function session(run: string, name: string, startedAt: string, stoppedAt: string | null, lastCommandAt?: string, maxSessions = 9): void {
  const dir = join(run, "observations", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify({ session: name, startedAt, ...(stoppedAt ? { stoppedAt } : {}), limits: { maxSessions } }));
  if (lastCommandAt) writeFileSync(join(dir, "0001.json"), JSON.stringify({ time: lastCommandAt }));
}

test("the phases with agents are timed from their session files: begin, end, agents, and sum and median per agent", () => {
  const run = mkdtempSync(join(tmpdir(), "timing-"));
  assert.deepEqual(agentPhaseTimings(run), [], "a run without sessions has no phases");
  assert.equal(sessionLimit(run), null);
  session(run, "regie", "2026-10-13T10:00:00.000Z", null, undefined, 4);
  session(run, "verken", "2026-10-13T10:00:10.000Z", "2026-10-13T10:08:00.000Z", undefined, 4);
  session(run, "r-start", "2026-10-13T11:00:00.000Z", "2026-10-13T11:05:00.000Z");
  session(run, "r-over", "2026-10-13T11:00:30.000Z", "2026-10-13T11:07:30.000Z");
  session(run, "r-zoek", "2026-10-13T11:06:00.000Z", "2026-10-13T11:09:00.000Z");
  session(run, "b-111", "2026-10-13T11:10:00.000Z", "2026-10-13T11:12:00.000Z");
  // An agent that never stopped its session: it ends at its last command.
  session(run, "b-121", "2026-10-13T11:10:20.000Z", null, "2026-10-13T11:14:20.000Z");
  const [walks, judges, ...rest] = agentPhaseTimings(run);
  assert.deepEqual(rest, [], "a phase without sessions is left out");
  assert.deepEqual(walks, { phase: "walks", startedAt: "2026-10-13T11:00:00.000Z", endedAt: "2026-10-13T11:09:00.000Z", seconds: 540, agents: 3, stopped: 3, sumSeconds: 300 + 420 + 180, medianSeconds: 300 });
  assert.deepEqual(judges, { phase: "judges", startedAt: "2026-10-13T11:10:00.000Z", endedAt: "2026-10-13T11:14:20.000Z", seconds: 260, agents: 2, stopped: 1, sumSeconds: 120 + 240, medianSeconds: 180 });
  assert.equal(sessionLimit(run), 9, "the limit is that of the latest session");
});

test("the parts of an audit are timed from the steps: by their own seconds, or by the step before in a run without begin times", () => {
  const at = (minutes: number): string => new Date(Date.parse("2026-10-10T08:00:00.000Z") + minutes * 60_000).toISOString();
  // A run from before the begin was recorded, as the runs the estimate was calibrated on.
  const old: ManifestStep[] = [
    { command: "inventory", at: at(0) },
    { command: "sample", at: at(0) },
    { command: "explore", at: at(0), round: 1 },
    { command: "check-site", at: at(8) },
    { command: "check-site", at: at(9) },
    { command: "collect", at: at(25) },
    { command: "contrast", at: at(26) },
    { command: "states", at: at(35) },
    { command: "gate", at: at(35) },
    { command: "explore", at: at(35.5), round: 2 },
    { command: "check-site", at: at(36.5) },
    { command: "gate", at: at(37) },
    { command: "gate", at: at(38) },
    { command: "tasks", at: at(38) },
    { command: "tasks", at: at(60) },
    { command: "evaluate", at: at(61) },
  ];
  assert.deepEqual(stageTimings(old), {
    explore: { seconds: 9 * 60, derived: false },
    collect: { seconds: 16 * 60, derived: true },
    contrast: { seconds: 60, derived: true },
    states: { seconds: 9 * 60, derived: true },
    // The gate sent the explorer back once: that round and the look at the sheets are the gate.
    gate: { seconds: 0 + 60 + 30 + 60, derived: true },
    report: { seconds: 60, derived: true },
  });
  assert.equal(elapsedSeconds(old), 61 * 60);
  // A run with begin times: a step counts its own seconds, and the wait before it is nobody's step.
  const timed: ManifestStep[] = [
    { command: "inventory", startedAt: at(0), at: at(2), seconds: 120 },
    { command: "explore", startedAt: at(3), at: at(3), seconds: 0 },
    { command: "check-site", startedAt: at(11), at: at(12), seconds: 60 },
    { command: "collect", startedAt: at(20), at: at(30), seconds: 600 },
    { command: "gate", startedAt: at(30), at: at(30.5), seconds: 30 },
    { command: "gate", startedAt: at(32), at: at(32.5), seconds: 30 },
    { command: "tasks", startedAt: at(33), at: at(33), seconds: 0 },
  ];
  assert.deepEqual(stageTimings(timed), {
    inventory: { seconds: 120, derived: false },
    explore: { seconds: 9 * 60, derived: false },
    collect: { seconds: 600, derived: false },
    gate: { seconds: 30 + 120, derived: false },
  });
  assert.equal(elapsedSeconds(timed), 33 * 60);
  assert.deepEqual(stageTimings([]), {});
});
