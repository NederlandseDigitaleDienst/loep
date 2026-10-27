import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANSWER_IN_FILE_NL, answerGoesToFile } from "../src/session/client.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "loep-answer-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// Without a session process the client still answers, with an error: enough to see where the answer goes.
const sessionList = (stdout: "pipe" | number, stderr: "pipe" | number = "pipe") => spawnSync(process.execPath, [CLI, "session", "list", "--run", join(dir, "run")], { stdio: ["ignore", stdout, stderr], encoding: "utf8" });
const NO_SESSION = /er loopt geen sessie voor deze run/;

test("answerGoesToFile: only a file that stderr does not also go to", () => {
  const answer = openSync(join(dir, "answer"), "w");
  const other = openSync(join(dir, "other"), "w");
  try {
    assert.equal(answerGoesToFile(answer, other), true);
    assert.equal(answerGoesToFile(answer, answer), false);
  } finally {
    closeSync(answer);
    closeSync(other);
  }
  assert.equal(answerGoesToFile(answer, other), false);
});

test("an answer redirected to a file still lands there, with a warning on stderr", () => {
  const path = join(dir, "p,");
  const fd = openSync(path, "w");
  const result = sessionList(fd);
  closeSync(fd);
  assert.equal(result.stderr, `${ANSWER_IN_FILE_NL}\n`);
  assert.match(JSON.parse(readFileSync(path, "utf8")).error, NO_SESSION);
});

test("an answer through a pipe gets no warning", () => {
  const result = sessionList("pipe");
  assert.equal(result.stderr, "");
  assert.match(JSON.parse(result.stdout).error, NO_SESSION);
});

test("stdout and stderr in one file, as the Bash tool of Claude Code has them, get no warning", () => {
  const path = join(dir, "output");
  const fd = openSync(path, "w");
  sessionList(fd, fd);
  closeSync(fd);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.match(JSON.parse(lines[0]!).error, NO_SESSION);
});
