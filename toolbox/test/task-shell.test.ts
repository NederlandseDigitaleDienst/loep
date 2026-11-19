import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { TEMPLATES_DIR } from "../src/lib/procedures.ts";
import { readTemplate } from "../src/lib/templates.ts";

/**
 * A guarded environment refuses a shell line it cannot follow: a function, a loop, a shell
 * variable, or more than one command on a line. An agent then loses its first call. So a task
 * prescribes every command in full, one per call, and this test reads every task for the rest.
 */

/** Every piece of code in a text: the fenced blocks and the spans between backticks. */
function codeOf(text: string): string[] {
  const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]!);
  const spans = [...text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
  return [...blocks, ...spans];
}

/** What makes one piece of code a compound shell line, or null when it is a plain command or no command at all. */
function compound(code: string): string | null {
  if (/\b[A-Za-z_]\w*\s*\(\)\s*\{/.test(code)) return "a shell function";
  if (/\$[A-Za-z_@*#?{(]/.test(code)) return "a shell variable or substitution";
  if (/\b(?:for|while|until)\b[^\n]*;\s*do\b/.test(code)) return "a loop";
  if (/&&|\|\|/.test(code)) return "a chain of commands";
  // A semicolon separates commands only where the code calls the toolbox; elsewhere it is punctuation in a quoted text.
  if (/\{\{cli\}\}|^\s*(?:node|loep|git|cd) /m.test(code) && /;\s*\S/.test(code)) return "more than one command on a line";
  return null;
}

/** The tasks with their shared parts inserted, as an agent reads them before the placeholders are filled. */
const TASKS = readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3));

test("the reading of a task tells a compound shell line from a plain command", () => {
  for (const [code, what] of [
    ['loep() { node {{cli}} session "$@" --run {{run}} --session {{session}}; }', "a shell function"],
    ['node {{cli}} session open "$PAGE" --run {{run}}', "a shell variable or substitution"],
    ["for page in P01 P02; do node {{cli}} session open --run {{run}}; done", "a loop"],
    ["node {{cli}} check-site --run {{run}} && node {{cli}} session stop --run {{run}} --session {{session}}", "a chain of commands"],
    ["node {{cli}} session look --run {{run}}; node {{cli}} session status --run {{run}}", "more than one command on a line"],
  ] as const) assert.equal(compound(code), what, code);
  for (const plain of [
    "node {{cli}} session <commando> --run {{run}} --session {{session}}",
    'node {{cli}} session extend --run {{run}} --session {{session}} --reason "<wat er nog gemeten moet worden en waar>"',
    "find 'css:main > div'",
    "scroll <ref\\|top\\|bottom\\|down\\|up>",
    "buiten de afbakening: het adres; de reden",
  ]) assert.equal(compound(plain), null, plain);
});

test("no task prescribes a shell function, a loop, a shell variable or a chain of commands", () => {
  assert.ok(TASKS.includes("rondgang") && TASKS.includes("verken") && TASKS.includes("beoordeel"), "de opdrachten zijn niet gevonden");
  const problems: string[] = [];
  for (const task of TASKS) for (const code of codeOf(readTemplate(task))) {
    const what = compound(code);
    if (what) problems.push(`templates/${task}.md: ${what} in "${code.trim().slice(0, 120)}"`);
  }
  assert.deepEqual(problems, []);
});

test("a task with a session gives the command in full, with the name of the session, and says to give one per call", () => {
  for (const task of ["rondgang", "beoordeel", "verifieer", "afmaak", "natoets", "verken"]) {
    const text = readTemplate(task);
    assert.ok(text.includes("Daarna is elk commando: `node {{cli}} session <commando> --run {{run}} --session {{session}}`"), task);
    assert.match(text, /Geef elk commando voluit en als een eigen aanroep van je shell: geen shell-functie, geen lus, geen shellvariabele en niet meer dan één commando per aanroep\./, task);
  }
});
