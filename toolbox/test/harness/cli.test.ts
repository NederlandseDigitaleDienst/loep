import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readState, updateSite } from "../../src/harness/state.ts";

const cli = fileURLToPath(new URL("../../src/harness/cli.ts", import.meta.url));

/** A home of loep with one site and a fake regie that writes its arguments and seals. */
function home(): { home: string; call: (...args: string[]) => ReturnType<typeof spawnSync> } {
  const dir = mkdtempSync(join(tmpdir(), "backlog-cli-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const toolbox = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  writeFileSync(join(bin, "vlam-claude"), `#!/bin/sh
echo "$@" > args.txt
run=""
while [ $# -gt 0 ]; do case "$1" in --add-dir) run="$2"; shift ;; esac; shift; done
echo "{}" > "$run/inventory.json"
node ${toolbox} seal --run "$run" >/dev/null
echo '{"type":"result","result":"klaar"}'
`, { mode: 0o755 });
  // Proeft loep de routes, dan antwoordt deze, zonder een verzoek aan VLAM.
  writeFileSync(join(bin, "vlam-routes"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { ...process.env, LOEP_HOME: dir, LOEP_MIN_FREE_GB: "0", PATH: `${bin}:${process.env["PATH"]}` };
  const call = (...args: string[]) => spawnSync("node", [cli, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  call("add", "https://www.voorbeeld.nl/", "--organisation", "Ministerie van Voorbeeld", "--name", "Voorbeeld");
  return { home: dir, call };
}

test("de opties van loep gaan ongelezen door, ook zonder --", () => {
  // `loep audit login <site> --idle` staat zo in de documentatie en in vraag.md; de backlog kende --idle niet en weigerde.
  const { call } = home();
  const login = call("login", "voorbeeld.nl", "--idle");
  assert.doesNotMatch(String(login.stderr), /Unknown option/);
  const answer = call("answer", "voorbeeld.nl", "--criterion", "1.4.3");
  assert.doesNotMatch(String(answer.stderr), /Unknown option/);
  assert.match(String(answer.stderr), /heeft nog geen run/);
});

test("--new begint een nieuwe run, ook voor een site die klaar is", () => {
  const { home: dir, call } = home();
  const first = call("run");
  assert.equal(first.status, 0, String(first.stderr));
  const state = join(dir, ".loep", "state.json");
  assert.equal(readState(state).sites["voorbeeld.nl"]?.phase, "klaar");
  const before = readState(state).sites["voorbeeld.nl"]?.run;
  const again = call("run", "--only", "voorbeeld.nl", "--new");
  assert.doesNotMatch(String(again.stdout), /Niets te doen/);
  assert.notEqual(readState(state).sites["voorbeeld.nl"]?.run, before);
});

test("pause zet een site die nog loopt niet op stil, maar zegt hoe je de regie stopt", () => {
  const { home: dir, call } = home();
  updateSite(join(dir, ".loep", "state.json"), "voorbeeld.nl", { phase: "loopt", pid: process.pid, run: dir });
  const paused = call("pause", "voorbeeld.nl");
  assert.notEqual(paused.status, 0);
  assert.match(String(paused.stderr), /loopt nu/);
  assert.equal(readState(join(dir, ".loep", "state.json")).sites["voorbeeld.nl"]?.phase, "loopt");
});

test("een site met een levende regie houdt de rest van de backlog niet tegen", () => {
  const { home: dir, call } = home();
  call("add", "https://www.tweede.nl/", "--organisation", "Ministerie van Voorbeeld", "--name", "Tweede");
  const state = join(dir, ".loep", "state.json");
  // De eerste site heeft een regie die loep overleefde; die mag geen tweede krijgen, de tweede site moet door.
  updateSite(state, "voorbeeld.nl", { phase: "loopt", pid: 999_999, regiePid: process.pid, regieSince: new Date().toISOString() });
  const run = call("run", "--sites", "2");
  assert.match(String(run.stdout), /voorbeeld\.nl: de regie loopt nog in proces \d+/);
  assert.equal(run.status, 0, String(run.stderr));
  assert.equal(readState(state).sites["voorbeeld.nl"]?.phase, "loopt", "de bezette site blijft staan");
  assert.equal(readState(state).sites["tweede.nl"]?.phase, "klaar", "de volgende site liep door");
});

test("resume zegt de regie wat een mens via de backlog deed", () => {
  const { home: dir, call } = home();
  call("run");
  updateSite(join(dir, ".loep", "state.json"), "voorbeeld.nl", { phase: "vraagt", humanNl: "De mens legde met answer een antwoord vast. Draai daarna stap 7 opnieuw." });
  call("resume", "voorbeeld.nl");
  const args = readFileSync(join(dir, ".loep", "voorbeeld.nl", "args.txt"), "utf8");
  assert.match(args, /legde met answer een antwoord vast/);
  assert.equal(readState(join(dir, ".loep", "state.json")).sites["voorbeeld.nl"]?.humanNl, null);
});
