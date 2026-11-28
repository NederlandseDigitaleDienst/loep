import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_COMMANDS, DEV_COMMANDS } from "../src/lib/commands.ts";

// The command line from outside: a step of an investigation under `audit`, the tool for whoever works
// on loep under `dev`, and the help of each layer. The names themselves are in lib/commands.ts; this
// test proves the parsing, which the descriptions cannot show.
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("a step of the investigation runs under audit, and its layer names it in the help", () => {
  // Without a run, `gate` says what it needs: that message proves the layer reached the step itself.
  const gate = run("audit", "gate");
  assert.equal(gate.status, 1);
  assert.match(String(gate.stderr), /gate needs --run/, "audit gate reikt niet aan de stap zelf");
  const dev = run("dev", "procedures");
  assert.equal(dev.status, 0, String(dev.stderr));
  assert.match(String(dev.stdout), /procedures geldig|valid/);
  assert.match(String(run("dev", "--help").stdout), /^loep dev <verb>/);
  assert.match(String(run("audit", "--help").stdout), /^loep audit <stap>/);
  assert.match(String(run("audit", "gate", "--help").stdout), /^loep audit <stap>/, "de help van een stap is de help van zijn laag");
});

test("a step that does not exist under a layer is refused, with the help of that layer", () => {
  const refused = run("audit", "procedures");
  assert.equal(refused.status, 1);
  assert.match(String(refused.stderr), /loep audit kent "procedures" niet: dat staat onder loep dev/);
  assert.match(String(refused.stderr), /loep audit <stap> \[options\]/, "de weigering zet de help van de laag erbij");
  assert.match(String(run("dev", "inventory").stderr), /loep dev kent "inventory" niet: dat staat onder loep audit/);
});

test("a command without its layer still runs, for the task files of a run that is already on disk", () => {
  const flat = run("procedures");
  assert.equal(flat.status, 0, String(flat.stderr));
  assert.match(String(flat.stdout), /geldig|valid/);
});

test("the help of a layer names every command under it, with the options", () => {
  const help = (layer: string): string => String(run(layer, "--help").stdout);
  for (const command of AUDIT_COMMANDS) assert.match(help("audit"), new RegExp(`^  (?:[a-z-]+, )*${command}\\b`, "m"), `loep audit --help noemt ${command} niet`);
  for (const command of DEV_COMMANDS) assert.match(help("dev"), new RegExp(`^  (?:[a-z-]+, )*${command}\\b`, "m"), `loep dev --help noemt ${command} niet`);
});

test("a command that prints its own help names its layer, not the bare name it had before", () => {
  for (const command of DEV_COMMANDS) {
    const first = String(run("dev", command, "--help").stdout).split("\n")[0];
    assert.match(first ?? "", /^loep dev /, `${command} noemt zichzelf zonder laag: ${first}`);
  }
  assert.match(String(run("audit", "voiceover", "--help").stdout), /^loep audit voiceover/);
});

test("the help of the top level names the layers and not the fifty commands", () => {
  const help = String(run("--help").stdout);
  assert.match(help, /^loep <command>/);
  for (const line of ["audit <stap>", "quick <url>", "statement", "contribute", "session <commando>", "dev <verb>"]) assert.ok(help.includes(line), `de help noemt ${line} niet`);
  assert.doesNotMatch(help, /check-verdict/, "de help van het hoogste niveau noemt de stappen van een onderzoek niet apart");
});
