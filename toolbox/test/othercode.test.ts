import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { otherCodeNl } from "../src/commands/evaluate.ts";

test("evaluate names a session that measured with other code than the run", () => {
  const run = mkdtempSync(join(tmpdir(), "loep-othercode-"));
  const session = (name: string, toolbox?: { commit: string; dirty: boolean }): void => {
    mkdirSync(join(run, "observations", name), { recursive: true });
    writeFileSync(join(run, "observations", name, "session.json"), JSON.stringify({ session: name, ...(toolbox ? { toolbox } : {}) }));
  };
  session("b-221", { commit: "a".repeat(40), dirty: false });
  session("a-221-2", { commit: "b".repeat(40), dirty: false });
  session("r-start");
  assert.deepEqual(otherCodeNl(run, "a".repeat(40)), [`De sessie a-221-2 is gedaan met loep commit ${"b".repeat(12)}, de rest van het onderzoek met commit ${"a".repeat(12)}.`]);
  assert.deepEqual(otherCodeNl(run, "b".repeat(40)), [`De sessie b-221 is gedaan met loep commit ${"a".repeat(12)}, de rest van het onderzoek met commit ${"b".repeat(12)}.`]);
});
