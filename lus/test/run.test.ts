import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Site } from "../src/backlog.ts";
import { isSealed, readQuestion, stepOf } from "../src/run.ts";
import { handOutMissing, runSite, spaceProblemNl } from "../src/runner.ts";
import { readState, siteState } from "../src/state.ts";

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
  // De schijf van de machine waar de proef draait zegt niets over wat hier getest wordt.
  process.env["LUS_MIN_FREE_GB"] = "0";
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

test("een regie die haar beurt teruggeeft met een half af onderzoek wordt door lus verder gestuurd", async () => {
  // Precies wat er in de praktijk gebeurde: de regie meldt dat de verkenner bezig is en stopt.
  const home = fakeHome(`alles="$@"
run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
n=0; [ -f beurten ] && n=$(cat beurten); n=$((n + 1)); echo $n > beurten
echo "$alles" > "args-$n.txt"
if [ "$n" = "1" ]; then echo vooruitgang > "$run/vooruitgang.txt"; fi
if [ "$n" = "2" ]; then echo '{}' > "$run/evidence-index.json"; fi
echo '{"type":"result","result":"klaar"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.phase, "klaar");
  assert.equal(state.continues, 0, "een afgemaakte run telt geen beurten meer");
  const dir = join(home, ".lus", "voorbeeld.nl");
  assert.equal(readFileSync(join(dir, "beurten"), "utf8").trim(), "2");
  const tweede = readFileSync(join(dir, "args-2.txt"), "utf8");
  assert.match(tweede, /De vorige beurt stopte zonder een vraag/);
  assert.match(tweede, /pending --run .* --brief/);
  assert.match(readFileSync(join(dir, "lus.log"), "utf8"), /beurt 1 van 20/);
});

test("een regie die de run niet laat groeien krijgt geen tweede beurt", async () => {
  // Zonder deze grens kost een regie die vastloopt twintig keer dezelfde minuten.
  const home = fakeHome(`n=0; [ -f beurten ] && n=$(cat beurten); n=$((n + 1)); echo $n > beurten
echo '{"type":"result","result":"niets"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.phase, "fout");
  const dir = join(home, ".lus", "voorbeeld.nl");
  assert.equal(readFileSync(join(dir, "beurten"), "utf8").trim(), "1");
  assert.match(readFileSync(join(dir, "lus.log"), "utf8"), /niet veranderd/);
});

test("een tweede run van dezelfde dag komt naast de eerste, niet erover heen", async () => {
  // Een run hoort bij één checkout; na een nieuwe versie is er geen doorgaan maar een nieuwe run.
  const home = fakeHome(`run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo '{}' > "$run/evidence-index.json"
echo '{"type":"result","result":"klaar"}'`);
  const first = await runSite({ site: site() });
  assert.equal(first.phase, "klaar");
  const second = await runSite({ site: site(), newRun: true });
  assert.equal(second.phase, "klaar");
  assert.notEqual(first.run, second.run);
  assert.match(second.run ?? "", /-\d+$/);
  assert.ok(existsSync(first.run ?? ""));
  assert.ok(existsSync(second.run ?? ""));
});

test("een run uit een andere checkout hervat niet, en --new zegt wat dan wel kan", async () => {
  const home = fakeHome(`run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo '{}' > "$run/evidence-index.json"
echo '{"type":"result","result":"klaar"}'`);
  await runSite({ site: site() });
  const path = join(home, ".lus", "state.json");
  const state = readState(path);
  state.sites["voorbeeld.nl"]!.version = { plugin: "0.1.0", describe: "v0.1.0-1-g0000000", sha: "0000000" };
  writeFileSync(path, JSON.stringify(state));
  await assert.rejects(() => runSite({ site: site() }), /--new/);
  const fresh = await runSite({ site: site(), newRun: true });
  assert.equal(fresh.phase, "klaar");
  assert.notEqual(readState(path).sites["voorbeeld.nl"]!.version?.sha, "0000000");
});

test("een verzegelde run zonder evaluatie geeft geen rapport uit, en zegt dat", async () => {
  const home = fakeHome(`run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo '{}' > "$run/evidence-index.json"
echo '{"type":"result","result":"klaar"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.phase, "klaar");
  assert.deepEqual(state.handouts, []);
  assert.match(readFileSync(join(home, ".lus", "voorbeeld.nl", "lus.log"), "utf8"), /geen rapport om uit te geven/);
});

test("een verzegelde run met een evaluatie geeft het rapport uit onder de naam van de site", async () => {
  // De hele keten: lus roept loep handout aan, en de naam zegt de slug en niet de host van de url.
  const home = fakeHome(`run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo '{}' > "$run/evidence-index.json"
mkdir -p "$run/report"
echo '{"site":{"baseUrl":"https://www.voorbeeld.nl/","name":"Voorbeeld"},"evaluatedAt":"2026-11-23T10:00:00.000Z","criteria":[]}' > "$run/evaluation.json"
echo pdf > "$run/report/rapport.pdf"
echo '{"type":"result","result":"klaar"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.phase, "klaar");
  assert.deepEqual(state.handouts.map((file) => file.slice(file.lastIndexOf("/") + 1)), ["rapport-voorbeeld.nl-2026-11-23-concept.pdf"]);
  assert.ok(existsSync(join(home, "rapporten", "rapport-voorbeeld.nl-2026-11-23-concept.pdf")));
  assert.equal(readFileSync(join(home, "rapporten", "rapport-voorbeeld.nl-2026-11-23-concept.pdf"), "utf8"), "pdf\n");
});

test("een run die klaar was voordat lus rapporten uitgaf, krijgt ze alsnog", async () => {
  const home = fakeHome(`run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo '{}' > "$run/evidence-index.json"
mkdir -p "$run/report"
echo '{"site":{"baseUrl":"https://www.voorbeeld.nl/","name":"Voorbeeld"},"evaluatedAt":"2026-11-23T10:00:00.000Z","criteria":[]}' > "$run/evaluation.json"
echo pdf > "$run/report/rapport.pdf"
echo '{"type":"result","result":"klaar"}'`);
  const state = await runSite({ site: site() });
  assert.equal(state.handouts.length, 1);
  // De stand van toen: klaar, maar zonder de kopie.
  const path = join(home, ".lus", "state.json");
  const older = readState(path);
  older.sites["voorbeeld.nl"]!.handouts = [];
  writeFileSync(path, JSON.stringify(older));
  rmSync(join(home, "rapporten"), { recursive: true, force: true });
  const again = handOutMissing("voorbeeld.nl", siteState(readState(path), "voorbeeld.nl"));
  assert.equal(again.length, 1);
  assert.deepEqual(readState(path).sites["voorbeeld.nl"]!.handouts, again);
  assert.ok(existsSync(again[0]!));
});

test("onder de vijftien gigabyte begint lus geen run", () => {
  // Een run van uren schrijft gigabytes; loopt de schijf vol, dan is de run weg en het rapport ook.
  delete process.env["LUS_MIN_FREE_GB"];
  assert.match(spaceProblemNl(9) ?? "", /9 GB vrij; onder 15 GB/);
  assert.equal(spaceProblemNl(15), null);
  assert.equal(spaceProblemNl(null), null, "een schijf die niet te lezen is, is geen reden om te weigeren");
});
