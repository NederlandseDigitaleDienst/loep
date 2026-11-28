import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { jsonIn, runAgent, workDirFor, workflowFunction } from "../../src/harness/waves.ts";

/*
 * The waves run the workflow file that the audit already had, with the three globals the Workflow tool
 * used to give it. These tests hold that wiring: the script loads, the arguments reach it, and an agent
 * that says nothing pauses the run instead of skipping it.
 */

test("de workflow laadt en stopt als de stand zegt dat de run klaar is", async () => {
  const workflow = workflowFunction();
  const seen: string[] = [];
  const agent = async (prompt: string): Promise<unknown> => {
    seen.push(prompt);
    return { phase: "done", walks: [], judges: [], verifiers: [], finishers: [] };
  };
  const result = (await workflow({ cli: "/x/cli.ts", run: "/x/run" }, agent, (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((thunk) => thunk())), () => {})) as { last: string };
  assert.equal(result.last, "done");
  assert.equal(seen.length, 1);
  // De stand krijgt de opdrachten van de toolbox, met de laag erin.
  assert.match(seen[0]!, /audit tasks --run \/x\/run/);
  assert.match(seen[0]!, /audit pending --run \/x\/run --brief/);
});

test("een agent die niets zegt pauzeert de run en slaat niets over", async () => {
  const workflow = workflowFunction();
  const result = (await workflow(
    { cli: "/x/cli.ts", run: "/x/run" },
    async () => {
      throw new Error("geen antwoord");
    },
    (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((thunk) => thunk())),
    () => {},
  )) as { paused: string | null; skipped: string[] };
  assert.match(String(result.paused), /storing van het model/);
  assert.deepEqual(result.skipped, []);
});

test("een antwoord met JSON in een codeblok of met tekst eromheen leest ook", () => {
  assert.deepEqual(jsonIn('{"phase":"done"}'), { phase: "done" });
  assert.deepEqual(jsonIn('```json\n{"phase":"walks"}\n```'), { phase: "walks" });
  assert.deepEqual(jsonIn('Hier is het: {"phase":"judges"} klaar.'), { phase: "judges" });
  assert.equal(jsonIn("geen json"), null);
  assert.equal(jsonIn(""), null);
});

test("de werkmap van een agent is die van de site, ook buiten de vaste map", () => {
  const home = mkdtempSync(join(tmpdir(), "waves-"));
  const before = process.env["LOEP_HOME"];
  process.env["LOEP_HOME"] = home;
  try {
    assert.equal(workDirFor(join(home, "voorbeeld.nl", "2026-11-28")), join(home, ".loep", "voorbeeld.nl"));
    assert.equal(workDirFor("/elders/site/2026-11-28"), "/elders/site");
  } finally {
    if (before === undefined) delete process.env["LOEP_HOME"];
    else process.env["LOEP_HOME"] = before;
  }
});

/*
 * An agent of a wave is a process that can stop with an error of the model: a limit of the subscription, a
 * failure of the service. That is no attempt of its task, so the promise rejects and the workflow gives the
 * task back in the next round instead of counting it.
 */
function fakeClaude(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "waves-agent-"));
  writeFileSync(join(dir, "claude"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return dir;
}

async function withPath<T>(dir: string, body: () => Promise<T>): Promise<T> {
  const before = process.env["PATH"];
  process.env["PATH"] = `${dir}:${before ?? "/usr/bin:/bin"}`;
  try {
    return await body();
  } finally {
    if (before === undefined) delete process.env["PATH"];
    else process.env["PATH"] = before;
  }
}

test("een agent die een antwoord geeft levert het antwoord", async () => {
  const dir = fakeClaude(`printf '%s\\n' '{"type":"result","result":"klaar"}'`);
  const answer = await withPath(dir, async () => runAgent("claude", "vraag", {}, dir, "/x/run"));
  assert.equal(answer, "klaar");
});

test("een fout van het model telt als geen antwoord, ook met code 0", async () => {
  const dir = fakeClaude(`printf '%s\\n' '{"type":"result","is_error":true,"result":"API Error: limiet"}'`);
  await assert.rejects(withPath(dir, async () => runAgent("claude", "vraag", {}, dir, "/x/run")), /geen antwoord \(code 0\)/);
});

test("een agent die met een foutcode stopt telt als geen antwoord", async () => {
  const dir = fakeClaude(`printf '%s\\n' '{"type":"result","result":"klaar"}'\nexit 1`);
  await assert.rejects(withPath(dir, async () => runAgent("claude", "vraag", {}, dir, "/x/run")), /geen antwoord \(code 1\)/);
});
