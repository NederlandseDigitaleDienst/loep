import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The order of commands for an evaluation is written down twice: in the skill, for the agent
// that runs an evaluation, and in the justfile, for whoever does it by hand. They have to
// say the same thing up to and including the gate; after that the skill decides per phase.
const ROOT = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");
const upToGate = (commands: string[]): string[] => commands.slice(0, commands.indexOf("gate") + 1);

/** The commands of the steps in the skill: every line of a code block that starts with `LOEP`. */
function skillSequence(text: string): string[] {
  return text.split("\n").flatMap((line) => /^\s*LOEP ([a-z-]+)/.exec(line)?.[1] ?? []);
}

/** The commands a task of the justfile runs: every line of its recipe that calls the toolbox. */
function justSequence(text: string, task: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${task}( [^:]*)?:`).test(line));
  assert.notEqual(start, -1, `de justfile heeft geen taak ${task}`);
  const commands: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const command = /^\s+[-@]*\{\{cli\}\} ([a-z-]+)/.exec(line)?.[1];
    if (command) commands.push(command);
  }
  return commands;
}

test("the skill and the justfile run the same commands in the same order, up to and including the gate", () => {
  const skill = upToGate(skillSequence(read("skills/nldd-a11y-audit/SKILL.md")));
  const justfile = read("justfile");
  const just = upToGate([...justSequence(justfile, "explore"), ...justSequence(justfile, "sweep")]);
  assert.ok(skill.includes("gate"), "de skill noemt het commando gate niet in een stap");
  assert.ok(just.includes("gate"), "de justfile draait het commando gate niet in explore of sweep");
  assert.ok(skill.length >= 5, `de skill geeft maar ${skill.length} commando's tot en met de poort`);
  assert.deepEqual(just, skill, "de reeks commando's in de justfile (taken explore en sweep) wijkt af van de stappen in de skill");
});

test("the reading of both files finds the commands, also behind a dash or an at sign", () => {
  assert.deepEqual(skillSequence("tekst met `LOEP inventory` erin\n   LOEP sample --run RUN\n   LOEP check-site --run RUN\n"), ["sample", "check-site"]);
  assert.deepEqual(justSequence("a run:\n    {{cli}} collect --run {{run}}\n    -{{cli}} gate --run {{run}}\n    @echo klaar\n\nb:\n    {{cli}} tasks\n", "a"), ["collect", "gate"]);
});
