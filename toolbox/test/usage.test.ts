import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { transcriptUsage, usageFromTranscripts } from "../src/commands/usage.ts";
import { compareVariants, type UsageFile } from "../src/commands/variants.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
/** Six made-up agents of one workflow: five with a transcript, one without. */
const TRANSCRIPTS = fileURLToPath(new URL("./fixtures/transcripts", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "loep-usage-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

/** A run with tasks for the criteria given and an evaluation that decides nothing. */
function run(name: string, criteria: string[]): string {
  const dir = join(scratch, name);
  write(join(dir, "tasks", "index.json"), { tasks: criteria.map((criterion) => ({ criterion })) });
  write(join(dir, "evaluation.json"), { criteria: criteria.map((id) => ({ id, outcome: "cantTell", findings: [], missingNl: [] })) });
  write(join(dir, "manifest.json"), { toolbox: { commit: "aaaaaaa" }, steps: [] });
  return dir;
}
const measured = run("nulmeting-1", ["1.1.1", "2.1.1"]);

test("each agent once per model, with its role and its criterion or page type from its label", () => {
  const file = usageFromTranscripts({ transcripts: TRANSCRIPTS, run: measured });
  assert.equal(file.schema, "loep/verbruik/1");
  assert.equal(file.run, "nulmeting-1");
  assert.deepEqual(file.agents, [
    { role: "walk", pageType: "start", agent: "a4", model: "claude-opus-5-5", input: 2, cacheWrite: 100, cacheRead: 1000, output: 5, turns: 1 },
    // Two records of one message count once; a message the client made itself and a line cut off count not at all.
    { role: "judge", criterion: "1.1.1", agent: "a1", model: "claude-opus-5-5", input: 3, cacheWrite: 1200, cacheRead: 41000, output: 80, turns: 2 },
    { role: "judge", criterion: "2.1.1", agent: "a3", model: "claude-opus-5-5", input: 1, cacheWrite: 500, cacheRead: 5000, output: 10, turns: 1 },
    { role: "verifier", criterion: "1.1.1", agent: "a2", model: "claude-sonnet-5-5", input: 4, cacheWrite: 3000, cacheRead: 10000, output: 100, turns: 1 },
    { role: "stand", agent: "a5", model: "claude-haiku-5-5", input: 1, cacheWrite: 10, cacheRead: 100, output: 1, turns: 1 },
  ]);
  assert.deepEqual(Object.keys(file.prices!).sort(), ["claude-opus-5-5", "claude-sonnet-5-5"], "the prices it counted with, and none for Haiku");
  assert.equal(file.sourceNl, "Geteld uit de transcripts van 5 agents in transcripts, elk assistent-bericht één keer; 1 agent zonder transcript, beschrijving of bericht niet geteld.");
  assert.ok(!JSON.stringify(file).includes(scratch) && !JSON.stringify(file).includes(TRANSCRIPTS), "no path of this machine in the file");
});

test("an agent that changed model gets a row per model, under the name a price is looked up by", () => {
  const message = (id: string, model: string, output: number): string => JSON.stringify({ type: "assistant", message: { id, model, usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } } });
  const byModel = transcriptUsage([message("m1", "claude-opus-5-5-20261001", 5), message("m2", "claude-sonnet-5-5[1m]", 7), message("m3", "claude-sonnet-5-5", 1), "", "geen json"].join("\n"));
  assert.deepEqual(Object.fromEntries(byModel), {
    "claude-opus-5-5": { input: 1, cacheWrite: 0, cacheRead: 0, output: 5, turns: 1 },
    "claude-sonnet-5-5": { input: 2, cacheWrite: 0, cacheRead: 0, output: 8, turns: 2 },
  });
});

test("transcripts of another run, or a folder without them, are refused", () => {
  assert.throws(() => usageFromTranscripts({ transcripts: TRANSCRIPTS, run: run("alleen-111", ["1.1.1"]) }), /run alleen-111 geen opdracht voor heeft \(2\.1\.1\): horen ze bij een andere run\?/);
  assert.throws(() => usageFromTranscripts({ transcripts: scratch, run: measured }), /geen transcripts van agents/);
  assert.throws(() => usageFromTranscripts({ transcripts: join(scratch, "bestaat-niet"), run: measured }), /geen map met transcripts/);
});

test("compare-variants counts the file per role, with the price of each model, over the criteria of --criteria", async () => {
  const path = join(scratch, "verbruik.json");
  write(path, usageFromTranscripts({ transcripts: TRANSCRIPTS, run: measured }));
  const reference = join(scratch, "sleutel.json");
  write(reference, { kind: "answer-key", wcagVersion: "2.2", sampleNote: "", outcomeNote: "", failed: [], findings: [] });
  const result = await compareVariants({ baseline: [measured], reference, usage: [path], criteria: ["1.1.1"], findings: async () => ({ findings: [], ownFindings: [] }) });
  const roles = Object.fromEntries(result.runs[0]!.roles.map((use) => [use.role, use]));
  assert.deepEqual(Object.keys(roles), ["walk", "judge", "verifier", "stand"]);
  assert.deepEqual([roles.judge!.agents, roles.judge!.turns, roles.judge!.tokens], [1, 2, { input: 3, cacheWrite: 1200, cacheRead: 41000, output: 80 }], "the judge of 2.1.1 is outside --criteria");
  assert.ok(Math.abs(roles.verifier!.costUsd! - 0.009508) < 1e-12, "Sonnet at half the price of Opus");
  assert.equal(roles.stand!.costUsd, null, "Haiku has no price");
});

test("on the command line, the file is written and the total said", async () => {
  const out = join(scratch, "verbruik-cli.json");
  const { stdout } = await promisify(execFile)(process.execPath, [CLI, "usage", "--transcripts", TRANSCRIPTS, "--run", measured, "--out", out]);
  assert.match(stdout, /^5 rijen, 6 beurten, 0\.03 dollar zonder claude-haiku-5-5 \(geen prijs\); .*verbruik-cli\.json\n$/);
  assert.equal((JSON.parse(readFileSync(out, "utf8")) as UsageFile).agents.length, 5);
});
