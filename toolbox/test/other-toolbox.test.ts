import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { otherToolboxNl, toolboxVersion } from "../src/lib/manifest.ts";

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
