import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Site } from "../src/backlog.ts";
import { isSealed, readQuestion, stepOf } from "../src/run.ts";
import { runSite } from "../src/runner.ts";
import { readState } from "../src/state.ts";

const site = (overrides: Partial<Site> = {}): Site => ({
  url: "https://www.voorbeeld.nl/",
  slug: "voorbeeld.nl",
  name: "Voorbeeld",
  organisation: "Ministerie van Voorbeeld",
  purpose: "verbeteren",
  sending: { allow: false, max: 20 },
  alsoOrigins: [],
  neverOpen: [],
  login: null,
  atOnce: 3,
  mailbox: null,
  vendorTags: [],
  note: "",
  ...overrides,
});

/** A home of lus in a temporary folder, with a `vlam-claude` on the path that does what the body says. */
function fakeHome(body: string): string {
  const home = mkdtempSync(join(tmpdir(), "lus-home-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "vlam-claude"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  process.env["LUS_HOME"] = home;
  process.env["PATH"] = `${bin}:${process.env["PATH"]}`;
  return home;
}

test("een regel van de stream zegt welke stap de regie doet", () => {
  const bash = (command: string): string => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } });
  assert.equal(stepOf(bash("node /x/toolbox/src/cli.ts gate --run /r")), "gate");
  assert.equal(stepOf(bash("node /x/toolbox/src/cli.ts pending --run /r --brief")), "pending");
  assert.equal(stepOf(bash("ls /r")), null);
  assert.equal(stepOf(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Workflow", input: {} }] } })), "werkstroom");
  assert.equal(stepOf(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: {} }] } })), "subagent");
  assert.equal(stepOf('{"type":"system","subtype":"init"}'), "gestart");
  assert.equal(stepOf("geen json"), null);
});

test("een vraag met een commando wordt uit elkaar gehouden", () => {
  const home = fakeHome(":");
  const dir = join(home, "vraag");
  mkdirSync(dir, { recursive: true });
  assert.equal(readQuestion(dir), null);
  writeFileSync(join(dir, "vraag.md"), "# Vraag\n\nMag het versturen?\n\n```\nnode cli.ts inventory x\n```\n");
  assert.deepEqual(readQuestion(dir), { textNl: "Mag het versturen?", command: "node cli.ts inventory x" });
});

test("een regie die een vraag achterlaat, zet de site op vraagt en bewaart het commando", async () => {
  const home = fakeHome(`cat > vraag.md <<'EOF'
# Vraag

Mag de gebruiker inloggen?

\`\`\`
node /x/cli.ts login --run /r --url https://www.voorbeeld.nl/inloggen
\`\`\`
EOF
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node /x/cli.ts gate"}}]}}'
echo "$@" > args.txt
echo "$CLAUDE_CONFIG_DIR" > config.txt
echo '{"type":"result","result":"klaar"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.phase, "vraagt");
  assert.match(state.question?.textNl ?? "", /inloggen/);
  assert.equal(state.question?.command, "node /x/cli.ts login --run /r --url https://www.voorbeeld.nl/inloggen");
  assert.equal(state.step, "gate");
  const dir = join(home, ".lus", "voorbeeld.nl");
  assert.equal((readFileSync(join(dir, "config.txt"), "utf8")).trim(), join(home, ".lus", "claude-home"));
  const args = readFileSync(join(dir, "args.txt"), "utf8");
  assert.match(args, /--plugin-dir/);
  assert.match(args, /Workflow,Task/);
  assert.match(args, /--add-dir/);
  assert.equal(readState(join(home, ".lus", "state.json")).sites["voorbeeld.nl"]?.phase, "vraagt");
});

test("de regie begint in de map van de site en de run staat in de state", async () => {
  const home = fakeHome("pwd > cwd.txt\necho '{\"type\":\"result\",\"result\":\"niets\"}'");
  const state = await runSite({ site: site({ slug: "tweede.example" }) });
  assert.equal(state.phase, "fout");
  assert.equal(state.step, null);
  const dir = join(home, ".lus", "tweede.example");
  // macOS geeft /tmp als /private/var/... terug: de werkmap van de regie moet dezelfde map zijn, niet dezelfde letters.
  assert.equal(realpathSync(readFileSync(join(dir, "cwd.txt"), "utf8").trim()), realpathSync(dir));
  assert.ok(state.run?.startsWith(join(home, "tweede.example")));
});

test("de vraag van een vorige stop wordt bewaard, niet overschreven", async () => {
  const home = fakeHome("echo '{\"type\":\"result\",\"result\":\"niets\"}'");
  const dir = join(home, ".lus", "voorbeeld.nl");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "vraag.md"), "# Vraag\n\neerder\n");
  await runSite({ site: site() });
  const kept = readdirSync(dir).filter((name) => name.startsWith("vraag-") && name.endsWith(".md"));
  assert.equal(kept.length, 1);
  assert.match(readFileSync(join(dir, kept[0]!), "utf8"), /eerder/);
  assert.equal(existsSync(join(dir, "vraag.md")), false);
});

test("een run met een zegel is klaar", () => {
  const home = fakeHome(":");
  const run = join(home, "run");
  mkdirSync(run, { recursive: true });
  assert.equal(isSealed(run), false);
  writeFileSync(join(run, "evidence-index.json"), "{}\n");
  assert.equal(isSealed(run), true);
});
