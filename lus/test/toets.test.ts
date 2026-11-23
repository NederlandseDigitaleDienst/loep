import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { durationNl, lastLines, toetsPath, toetsTextNl, readToets, runToets, stepsFor, unfinished, STEPS } from "../src/toets.ts";

/* A just of our own: it writes what it was asked to the calls file, and fails on the task the env names. */
function fakeJust(home: string): { env: NodeJS.ProcessEnv; calls: () => string[] } {
  // The state of a toets is read through the home of lus, so the test moves that too.
  process.env["LUS_HOME"] = home;
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = join(home, "calls.txt");
  const script = join(bin, "just");
  writeFileSync(script, `#!/bin/sh\necho "$@" >> "${calls}"\nif [ "$1" = "$JUST_FAILS" ]; then echo "deze taak faalt"; exit 1; fi\nexit 0\n`);
  chmodSync(script, 0o755);
  return { env: { ...process.env, LUS_HOME: home, PATH: `${bin}:${process.env["PATH"] ?? ""}`, JUST_FAILS: "" }, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []) };
}

test("elke toets is een taak die in de justfile staat", () => {
  // lus schrijft geen controle zelf: een stap is de naam van een taak, en een tikfout moet hier stukgaan
  // en niet pas in een toets van een half uur.
  const justfile = readFileSync(join(import.meta.dirname, "..", "..", "justfile"), "utf8");
  const tasks = [...justfile.matchAll(/^([a-z][a-z-]*)(?: [^:\n]*)?:(?!=)/gm)].map((match) => match[1]!);
  for (const step of STEPS) assert.ok(tasks.includes(step.args[0]!), `${step.name}: "just ${step.args[0]}" is geen taak van de justfile`);
});

test("zonder --all de snelle toetsen, met --all ook de lange, en een onbekende naam is een fout", () => {
  const fast = stepsFor({}).map((step) => step.name);
  assert.ok(fast.includes("test-quick"));
  assert.ok(!fast.includes("test"), "alle tests met browser zijn niet snel");
  assert.ok(!fast.includes("veegronde"));
  assert.deepEqual(stepsFor({ all: true }).map((step) => step.name), STEPS.map((step) => step.name));
  assert.deepEqual(stepsFor({ only: "veegronde" }).map((step) => step.name), ["veegronde"]);
  assert.throws(() => stepsFor({ only: "bestaatniet" }), /ik ken reuse/);
});

test("een toets stopt bij de eerste stap die faalt, en gaat de volgende keer daar verder", async () => {
  const home = mkdtempSync(join(tmpdir(), "lus-meet-"));
  const { env, calls } = fakeJust(home);
  const failing = { ...env, JUST_FAILS: "check" };
  const first = await runToets({ env: failing });
  assert.equal(first.failed?.step.name, "check");
  assert.equal(first.toets.results.find((result) => result.name === "check")?.code, 1);
  assert.deepEqual(calls(), ["reuse", "check"], "na de fout begint er niets meer");
  const kept = readToets(toetsPath());
  assert.equal(kept?.step, null, "een toets die stilstaat noemt geen lopende stap");
  assert.equal(kept?.pid, null, "een toets die stilstaat wijst geen lopend proces aan");

  // De volgende keer: check is gemaakt, dus reuse wordt niet nog eens gedraaid en de toets loopt door.
  const second = await runToets({ env });
  assert.equal(second.failed, null);
  assert.deepEqual(calls().slice(2), ["check", "lus-check", "procedures", "test-quick", "lus-test"]);
  const done = readToets(toetsPath());
  assert.ok(done?.results.every((result) => result.code === 0));
  assert.equal(stepsFor({}).length, done?.results.length ?? -1);
});

test("de veegronde schrijft wat hij maakt in de map van de toets, niet in de repository", async () => {
  const home = mkdtempSync(join(tmpdir(), "lus-meet-"));
  const { env, calls } = fakeJust(home);
  const result = await runToets({ env, only: "veegronde" });
  assert.equal(result.failed, null);
  assert.deepEqual(calls(), [`sweep-check --at-once 3 --out ${join(result.toets.dir, "veegronde")}`]);
  assert.ok(result.toets.dir.includes("toetsen"), "de toets staat in een eigen map onder de home van lus");
  const log = lastLines(join(result.toets.dir, "veegronde.log"), 5).join("\n");
  assert.match(log, /exit 0/);
});

test("een toets met een proces dat nog leeft wordt niet overgenomen, een afgemaakte wordt niet hervat", async () => {
  const home = mkdtempSync(join(tmpdir(), "lus-meet-"));
  const { env } = fakeJust(home);
  const result = await runToets({ env, only: "reuse" });
  const done = result.toets;
  assert.equal(unfinished({ ...done, pid: process.pid }, stepsFor({ only: "reuse" })), null, "een lopend proces houdt de toets");
  assert.equal(unfinished(done, stepsFor({ only: "reuse" })), null, "alles gedaan is niets om te hervatten");
  const stopped = { ...done, pid: 999_999, results: done.results.map((entry) => ({ ...entry, code: 1 })) };
  assert.deepEqual(unfinished(stopped, stepsFor({ only: "reuse" }))?.dir, done.dir);
});

test("de samenvatting noemt elke stap met wat hij nagaat en waar de logboeken staan", async () => {
  const home = mkdtempSync(join(tmpdir(), "lus-meet-"));
  const { env } = fakeJust(home);
  const result = await runToets({ env, only: "reuse" });
  const text = toetsTextNl(result.toets, stepsFor({ only: "reuse" }));
  assert.match(text, /reuse\s+ok \(/);
  assert.match(text, /licentie/);
  assert.match(text, new RegExp(`De logboeken staan in ${result.toets.dir}`));
});

test("een duur leest in seconden en in minuten", () => {
  assert.equal(durationNl("2026-11-23T08:00:00.000Z", "2026-11-23T08:00:12.000Z"), "12 s");
  assert.equal(durationNl("2026-11-23T08:00:00.000Z", "2026-11-23T08:03:00.000Z"), "3 min");
  assert.equal(durationNl("2026-11-23T08:00:00.000Z", "2026-11-23T09:15:00.000Z"), "1 uur 15 min");
});
