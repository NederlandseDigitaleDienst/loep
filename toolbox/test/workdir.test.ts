import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { explore } from "../src/commands/explore.ts";
import { checkSeal, seal } from "../src/commands/verify.ts";
import { WORK_DIR } from "../src/lib/workdir.ts";

// Agents run side by side in one run. Two of them once wrote a helper script with the same name in
// a shared folder; one then measured under the other's session. Each session has a folder of its own.
const run = mkdtempSync(join(tmpdir(), "loep-workdir-"));
after(() => rmSync(run, { recursive: true, force: true }));
writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://voorbeeld.test/", origin: "https://voorbeeld.test", sitemapUrls: 0, notFoundProbe: "", pages: [], skipped: [], totals: {} }));

test("the task of the explorer names a work folder of its own session, and explore makes it", async () => {
  const first = readFileSync((await explore(run)).task, "utf8");
  const folder = join(run, WORK_DIR, "verken");
  assert.ok(first.includes(`werkmap: \`${folder}\``), "the task names the folder");
  assert.ok(existsSync(folder), "the folder is there before the agent starts");
  // A later round is another session, and so another folder.
  const second = readFileSync((await explore(run)).task, "utf8");
  assert.ok(second.includes(`werkmap: \`${join(run, WORK_DIR, "verken2")}\``) && existsSync(join(run, WORK_DIR, "verken2")));
});

test("what an agent left in its work folder is sealed: a helper script shows how it called the toolbox", async () => {
  mkdirSync(join(run, WORK_DIR, "b-243"), { recursive: true });
  writeFileSync(join(run, WORK_DIR, "b-243", "loep.sh"), "loep() { node cli.ts session \"$@\" --run . --session b-243; }\n");
  await seal(run);
  assert.deepEqual((await checkSeal(run))!.problems, []);
  writeFileSync(join(run, WORK_DIR, "b-243", "loep.sh"), "loep() { node cli.ts session \"$@\" --run . --session b-245; }\n");
  assert.deepEqual((await checkSeal(run))!.problems, [`gewijzigd: ${WORK_DIR}/b-243/loep.sh`]);
});
