import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { updateSite } from "../../src/harness/state.ts";

/*
 * `loep audit <stap> <site>` is the same line as `loep audit <stap> --run <run>`: the step itself knows no
 * backlog. The tests below run loep as a person types it, over a home of its own, and read the refusal that
 * comes back: a step that got `--run` refuses a run without sitemodel, and a step that did not says it
 * needs `--run`. A step with a person in it goes to the harness, and its refusal tells which site it looked up.
 */

const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const harness = fileURLToPath(new URL("../../src/harness/cli.ts", import.meta.url));

/** A home with one site in the backlog, and a run for it unless `started` is false. */
function home(started = true): { call: (...args: string[]) => ReturnType<typeof spawnSync> } {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-"));
  const env = { ...process.env, LOEP_HOME: dir, LOEP_MIN_FREE_GB: "0" };
  const added = spawnSync("node", [harness, "add", "https://www.voorbeeld.nl/", "--organisation", "Ministerie van Voorbeeld", "--name", "Voorbeeld"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(added.status, 0, String(added.stderr));
  if (started) {
    const run = join(dir, "voorbeeld.nl", "2026-11-28");
    mkdirSync(run, { recursive: true });
    updateSite(join(dir, ".loep", "state.json"), "voorbeeld.nl", { run });
  }
  return { call: (...args: string[]) => spawnSync("node", [cli, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
}

test("een site op de regel wordt de run van die site", () => {
  const { call } = home();
  const result = call("audit", "tasks", "voorbeeld.nl");
  // De run heeft geen sitemodel: die weigering komt pas als de stap een run heeft gekregen.
  assert.match(String(result.stderr), /geen sitemodel/);
  assert.notEqual(result.status, 0);
});

test("het woord na een optie met een waarde is geen site", () => {
  // Zonder deze regel zou `--only voorbeeld.nl` de run van de site als criterium invullen.
  const { call } = home();
  const result = call("audit", "tasks", "--only", "voorbeeld.nl");
  assert.match(String(result.stderr), /tasks needs --run/);
});

test("een stap met een mens erin gaat naar het harnas", () => {
  const { call } = home();
  // Het harnas kent de inlog van de site, en die is hier niet opgegeven.
  const result = call("audit", "login", "voorbeeld.nl");
  assert.match(String(result.stderr), /geen inlog in de backlog/);
  assert.notEqual(result.status, 0);
});

test("een site die nog niet begonnen is zegt hoe je hem start", () => {
  const { call } = home(false);
  const result = call("audit", "tasks", "voorbeeld.nl");
  assert.match(String(result.stderr), /voorbeeld\.nl is nog niet begonnen; start hem met: loep run --only voorbeeld\.nl/);
});

test("--help gaat voor de site", () => {
  const { call } = home(false);
  const result = call("audit", "tasks", "voorbeeld.nl", "--help");
  assert.doesNotMatch(String(result.stderr), /nog niet begonnen/);
  assert.match(String(result.stdout), /loep audit <stap>/);
});

test("een site die de backlog niet kent laat de regel zoals hij is", () => {
  const { call } = home();
  const result = call("audit", "tasks", "onbekend.nl");
  assert.match(String(result.stderr), /tasks needs --run/);
});
