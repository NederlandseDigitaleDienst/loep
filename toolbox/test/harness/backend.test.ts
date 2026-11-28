import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentArgs, chooseBackend, finalTextOf, regieArgs, regieEnvOf, stepOf, transcriptText } from "../../src/harness/backend.ts";

/*
 * The agent is a fact of the machine, not part of loep: `LOEP_REGIE` picks one, otherwise the first that
 * is installed. What differs between claude and opencode is the command line, the environment and the
 * stream; these tests hold those three, so a run says which step it is on whichever agent answers.
 */

/** A PATH with only the programs named, so `which` finds what this test wants it to find. */
function pathWith(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "backend-path-"));
  for (const name of names) {
    writeFileSync(join(dir, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, name), 0o755);
  }
  // `which` itself comes from the system, so the system stays on the path.
  return `${dir}:/usr/bin:/bin`;
}

test("LOEP_REGIE kiest de agent, en een naam die niet bestaat is een fout met de keuzes erin", () => {
  const path = pathWith("opencode", "claude");
  assert.deepEqual(chooseBackend({ PATH: path, LOEP_REGIE: "opencode" }).backend, "opencode");
  assert.throws(() => chooseBackend({ PATH: path, LOEP_REGIE: "codex" }), /kies uit vlam-claude, claude, opencode/);
  assert.throws(() => chooseBackend({ PATH: path, LOEP_REGIE: "vlam-claude" }), /staat niet op het pad/);
});

test("zonder LOEP_REGIE wint de eerste die geinstalleerd is", () => {
  assert.equal(chooseBackend({ PATH: pathWith("claude", "opencode") }).backend, "claude");
  assert.equal(chooseBackend({ PATH: pathWith("vlam-claude", "claude") }).backend, "vlam-claude");
  assert.equal(chooseBackend({ PATH: pathWith("opencode") }).backend, "opencode");
  assert.throws(() => chooseBackend({ PATH: pathWith() }), /geen agent gevonden/);
});

test("de commandoregel van de regie verschilt per agent, en de weigeringen zijn er bij allebei", () => {
  const claude = regieArgs("claude", "prompt", "/runs/voorbeeld");
  assert.equal(claude[0], "-p");
  assert.equal(claude[claude.indexOf("--output-format") + 1], "stream-json");
  assert.equal(claude[claude.indexOf("--add-dir") + 1], "/runs/voorbeeld");
  const denials = claude.slice(claude.indexOf("--disallowedTools") + 1);
  assert.ok(denials.includes("WebFetch"));

  const opencode = regieArgs("opencode", "prompt", "/runs/voorbeeld");
  assert.deepEqual(opencode.slice(0, 3), ["run", "--format", "json"]);
  // Zonder deze vlag zou een vraag om toestemming de run laten hangen: er is niemand om te antwoorden.
  assert.ok(!opencode.includes("--auto"));
  assert.equal(opencode.at(-1), "prompt");
});

test("de omgeving van opencode is een laag over de configuratie van de gebruiker", () => {
  const home = mkdtempSync(join(tmpdir(), "backend-home-"));
  const before = process.env["LOEP_HOME"];
  process.env["LOEP_HOME"] = home;
  try {
    const env = regieEnvOf("opencode");
    const path = String(env["OPENCODE_CONFIG"]);
    assert.equal(path, join(home, ".loep", "opencode", "opencode.json"));
    const config = JSON.parse(readFileSync(path, "utf8")) as { skills: string[]; permission: Record<string, unknown> };
    // De skills van deze checkout, niet van een wereldwijde installatie.
    assert.equal(config.skills.length, 1);
    assert.match(config.skills[0]!, /skills$/);
    // De site blijft buiten: geen webfetch, geen websearch, en de gewone vormen van een eigen verzoek.
    assert.equal(config.permission["webfetch"], "deny");
    assert.equal(config.permission["websearch"], "deny");
    assert.deepEqual((config.permission["bash"] as Record<string, string>)["curl*"], "deny");
    // Een agent schrijft in de run, en die staat naast zijn werkmap en niet eronder.
    assert.equal(config.permission["external_directory"], "allow");
    // Er staat geen sleutel in het bestand: de provider en het model komen uit de configuratie van de gebruiker.
    assert.equal(JSON.stringify(config).includes("apiKey"), false);
    assert.equal(env["CLAUDE_CONFIG_DIR"], undefined);
  } finally {
    if (before === undefined) delete process.env["LOEP_HOME"];
    else process.env["LOEP_HOME"] = before;
  }
});

test("de stream van opencode leest dezelfde stappen als die van claude", () => {
  const bash = (command: string): string => JSON.stringify({ type: "tool_use", part: { tool: "bash", state: { input: { command } } } });
  assert.equal(stepOf("opencode", bash("node /x/toolbox/src/cli.ts audit check-gate --run /r")), "check-gate");
  assert.equal(stepOf("opencode", bash("ls /r")), null);
  assert.equal(stepOf("opencode", JSON.stringify({ type: "tool_use", part: { tool: "task", state: { input: {} } } })), "subagent");
  assert.equal(stepOf("opencode", '{"type":"step_start"}'), "gestart");
  assert.equal(stepOf("opencode", "geen json"), null);

  const text = JSON.stringify({ type: "text", part: { text: "De run is klaar." } });
  assert.equal(transcriptText("opencode", text), "De run is klaar.");
  assert.equal(transcriptText("opencode", JSON.stringify({ type: "tool_use", part: { tool: "bash", state: { input: {} } } })), "[bash]");
});

test("het antwoord van een agent komt uit de laatste tekst, niet uit het hele spoor", () => {
  const opencode = [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "text", part: { text: "Ik ga kijken." } }),
    JSON.stringify({ type: "tool_use", part: { tool: "bash", state: { input: { command: "ls" } } } }),
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "text", part: { text: "{\"phase\":\"done\"}" } }),
  ].join("\n");
  assert.equal(finalTextOf("opencode", opencode), '{"phase":"done"}');

  const claude = [JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "result", result: "klaar" })].join("\n");
  assert.equal(finalTextOf("claude", claude), "klaar");
  assert.equal(finalTextOf("claude", JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.equal(finalTextOf("opencode", ""), null);
});

test("een agent van de golven krijgt dezelfde rechten als de regie, met een model als de rol er een kiest", () => {
  const withModel = agentArgs("claude", "prompt", "/runs/voorbeeld", "haiku");
  assert.equal(withModel[withModel.indexOf("--output-format") + 1], "json");
  assert.equal(withModel[withModel.indexOf("--model") + 1], "haiku");
  assert.ok(withModel.includes("--add-dir"));
  // Op opencode geldt het model van de configuratie; een rolmodelel bestaat daar niet.
  const opencode = agentArgs("opencode", "prompt", "/runs/voorbeeld", "haiku");
  assert.ok(!opencode.includes("--model"));
  assert.equal(opencode.at(-1), "prompt");
});

test("de overlay staat op een map die alleen de gebruiker leest", () => {
  const home = mkdtempSync(join(tmpdir(), "backend-mode-"));
  const before = process.env["LOEP_HOME"];
  process.env["LOEP_HOME"] = home;
  try {
    mkdirSync(join(home, ".loep"), { recursive: true });
    const env = regieEnvOf("opencode");
    const dir = String(env["OPENCODE_CONFIG"]).replace(/\/opencode\.json$/, "");
    assert.equal(dir, join(home, ".loep", "opencode"));
  } finally {
    if (before === undefined) delete process.env["LOEP_HOME"];
    else process.env["LOEP_HOME"] = before;
  }
});
