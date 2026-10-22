import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { frozenSweepNl, otherToolboxNl, toolboxVersion } from "../src/lib/manifest.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const runs: string[] = [];
after(() => runs.forEach((run) => rmSync(run, { recursive: true, force: true })));

function runOf(version: string): string {
  const run = mkdtempSync(join(tmpdir(), "loep-other-toolbox-"));
  runs.push(run);
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ toolbox: { commit: null, dirty: false, lockfileSha256: "x", version }, steps: [] }));
  return run;
}

test("a command that changes a run refuses a run of another version of loep, and says what to do", async () => {
  const run = runOf("0.0.0-andere");
  const refusal = otherToolboxNl(run, "tasks", false)!;
  assert.match(refusal, /^deze run is gemaakt met loep 0\.0\.0-andere, en dit is loep /);
  assert.match(refusal, /--other-toolbox/);
  await assert.rejects(promisify(execFile)(process.execPath, [CLI, "tasks", "--run", run]), (error: { stderr: string }) => /deze run is gemaakt met loep 0\.0\.0-andere/.test(error.stderr));
});

test("reading a run of another version, the same version, a run without a manifest and --other-toolbox are let through", () => {
  const other = runOf("0.0.0-andere");
  for (const command of ["pending", "estimate", "gaps", "feedback", "verify", "procedures"]) assert.equal(otherToolboxNl(other, command, false), null, command);
  // A finished, possibly sealed run is still rendered, signed and decided on after a release: these measure nothing.
  for (const command of ["render", "statement", "compare", "decide", "sign", "seal"]) assert.equal(otherToolboxNl(other, command, false), null, command);
  // What measures or writes tasks still refuses.
  for (const command of ["collect", "contrast", "states", "tasks", "evaluate", "merge"]) assert.notEqual(otherToolboxNl(other, command, false), null, command);
  assert.equal(otherToolboxNl(other, "tasks", true), null);
  assert.equal(otherToolboxNl(runOf(toolboxVersion()), "tasks", false), null);
  const empty = mkdtempSync(join(tmpdir(), "loep-other-toolbox-"));
  runs.push(empty);
  assert.equal(otherToolboxNl(empty, "tasks", false), null);
});

/** A copy made with `variant` of a sweep of version `sweep`, whose manifest was last written by version `last`. */
function copyOf(sweep: string, last = sweep): string {
  const run = runOf(last);
  const toolbox = (version: string) => ({ commit: null, dirty: false, lockfileSha256: "x", version });
  writeFileSync(join(run, "variant.json"), JSON.stringify({ schema: "loep/variant/1", name: "v", from: { run: "bevroren", toolbox: toolbox(sweep), variant: null }, toolbox: toolbox(last) }));
  return run;
}

test("a copy made with variant goes on with the agent phases under another version, and says which version the sweep is of", async () => {
  const copy = copyOf("0.0.0-andere");
  for (const command of ["tasks", "skip", "check-walk", "check-verdict", "evaluate", "merge", "pending"]) assert.equal(otherToolboxNl(copy, command, false), null, command);
  assert.match(frozenSweepNl(copy, "tasks")!, /^de veegronde van deze kopie is van loep 0\.0\.0-andere; de fasen van de agents draaien met loep /);
  assert.equal(frozenSweepNl(copy, "pending"), null);
  // tasks gets past the version check and stops further on, at the missing site model, after naming the version of the sweep.
  await assert.rejects(promisify(execFile)(process.execPath, [CLI, "tasks", "--run", copy]), (error: { stderr: string }) => /de veegronde van deze kopie is van loep 0\.0\.0-andere/.test(error.stderr) && !/gemaakt met loep/.test(error.stderr));
});

test("the sweep of a copy is held to its own version, also after the copy was made or went on with newer code", async () => {
  // Made with this version: variant and the agent phases wrote this version into the manifest, the sweep is of another.
  const copy = copyOf("0.0.0-andere", toolboxVersion());
  for (const command of ["collect", "contrast", "states", "documents", "inventory", "explore", "gate"]) {
    assert.match(otherToolboxNl(copy, command, false) ?? "", /^de veegronde van deze kopie is gemaakt met loep 0\.0\.0-andere/, command);
  }
  await assert.rejects(promisify(execFile)(process.execPath, [CLI, "collect", "--run", copy]), (error: { stderr: string }) => /de veegronde van deze kopie is gemaakt met loep 0\.0\.0-andere/.test(error.stderr));
  assert.equal(otherToolboxNl(copy, "collect", true), null);
  assert.equal(otherToolboxNl(copyOf(toolboxVersion()), "collect", false), null);
  assert.equal(frozenSweepNl(copyOf(toolboxVersion()), "tasks"), null);
  // A run that is no copy refuses the agent phases as before.
  assert.match(otherToolboxNl(runOf("0.0.0-andere"), "tasks", false)!, /^deze run is gemaakt met loep 0\.0\.0-andere/);
  assert.equal(frozenSweepNl(runOf("0.0.0-andere"), "tasks"), null);
});
