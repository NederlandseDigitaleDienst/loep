import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stopRefusedNl, voiceoverStop } from "../src/commands/voiceover.ts";
import { sha256 } from "../src/lib/canonical.ts";
import type { Guest, GuestState } from "../src/lib/voiceover.ts";
import { otherSessionProcesses, type SessionProcess } from "../src/session/client.ts";

/** A guest that stops when it is shut down from the inside, and keeps what was asked of it. */
function fakeGuest(state: GuestState) {
  const guest = { state, commands: [] as string[] };
  const api: Guest = {
    state: async () => guest.state,
    boot: async () => void (guest.state = "running"),
    halt: async () => void (guest.state = "stopped"),
    exec: async (command) => {
      guest.commands.push(command);
      if (command.includes("sudo shutdown -h now")) guest.state = "stopped";
      return "";
    },
  };
  return { guest, api };
}

/** Run a stop and give back its exit code and the one line it printed. */
async function stop(...args: Parameters<typeof voiceoverStop>): Promise<{ code: number; printed: { ok: boolean; stopped: string; error?: string } }> {
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  try {
    const code = await voiceoverStop(...args);
    return { code, printed: JSON.parse(out) };
  } finally {
    process.stdout.write = write;
  }
}

/** A session process as another run has it: a socket that answers `list`, or never answers. */
function listen(path: string, answer: Record<string, unknown> | null): Promise<Server> {
  const server = createServer((connection) => {
    connection.on("error", () => undefined);
    connection.on("data", () => {
      if (answer) connection.end(`${JSON.stringify(answer)}\n`);
    });
  });
  return new Promise((resolve) => server.listen(path, () => resolve(server)));
}

const socketOf = (runDir: string): string => `loep-${sha256(realpathSync(runDir)).slice(0, 16)}.sock`;

test("voiceover stop leaves the virtual Mac up while another run on this machine has sessions", async () => {
  const other: SessionProcess[] = [{ run: "/runs/other", sessions: 3 }];
  const busy = fakeGuest("running");
  const refused = await stop({}, busy.api, async () => other);
  assert.equal(refused.code, 1);
  assert.equal(refused.printed.ok, false);
  assert.equal(busy.guest.state, "running");
  assert.deepEqual(busy.guest.commands, [], "nothing is asked of the guest");
  assert.match(refused.printed.error!, /^geweigerd: de virtuele Mac blijft aan\. Op deze machine heeft een ander onderzoek nog sessies lopen/);
  assert.match(refused.printed.error!, /\/runs\/other \(3 sessies\)/);
  assert.match(refused.printed.error!, /loep voiceover stop --run <run>.*loep voiceover stop --force$/);

  // With --force it shuts down anyway, without looking.
  const forced = await stop({ force: true }, busy.api, async () => assert.fail("--force does not look for other runs"));
  assert.deepEqual([forced.code, forced.printed.stopped, busy.guest.state], [0, "netjes afgesloten", "stopped"]);

  // No other run at work: as before.
  const free = fakeGuest("running");
  const done = await stop({}, free.api, async () => []);
  assert.deepEqual([done.code, done.printed.ok, done.printed.stopped, free.guest.state], [0, true, "netjes afgesloten", "stopped"]);

  // A virtual Mac that does not run has nothing to refuse.
  const down = await stop({}, fakeGuest("stopped").api, async () => assert.fail("a stopped guest is not looked into"));
  assert.deepEqual([down.code, down.printed.stopped], [0, "de virtuele Mac draaide niet"]);
});

test("the refusal counts the runs and names the ones that said who they are", () => {
  const text = stopRefusedNl([{ run: "/runs/a", sessions: 1 }, { run: null, sessions: null }]);
  assert.match(text, /hebben 2 andere onderzoeken nog sessies lopen, en die kunnen VoiceOver nog nodig hebben\. Het gaat om \/runs\/a \(1 sessie\)\./);
  assert.doesNotMatch(stopRefusedNl([{ run: null, sessions: null }]), /Het gaat om/);
});

test("the session processes of other runs are found by the sockets that answer", async () => {
  // Short, because the path of a Unix socket is limited to about a hundred bytes.
  const dir = mkdtempSync(join(tmpdir(), "lp-"));
  const servers: Server[] = [];
  try {
    const ownRun = join(dir, "own");
    mkdirSync(ownRun);
    const session = { name: "regie" };
    servers.push(await listen(join(dir, "loep-00000000000000aa.sock"), { ok: true, run: "/runs/other", print: { sessions: [session, session] } }));
    // The last session is gone and the process is about to end: not at work.
    servers.push(await listen(join(dir, "loep-00000000000000bb.sock"), { ok: true, run: "/runs/ending", print: { sessions: [] } }));
    // A process that is too busy to answer counts as at work.
    servers.push(await listen(join(dir, "loep-00000000000000cc.sock"), null));
    // The own run, by the name its socket has.
    servers.push(await listen(join(dir, socketOf(ownRun)), { ok: true, run: ownRun, print: { sessions: [session] } }));
    // What a run that was cut off left behind, and files that are not a socket of a session process.
    writeFileSync(join(dir, "loep-00000000000000dd.sock"), "");
    writeFileSync(join(dir, "loep-00000000000000ee.log"), "");

    assert.deepEqual(await otherSessionProcesses(ownRun, dir, 300), [
      { run: "/runs/other", sessions: 2 },
      { run: null, sessions: null },
    ]);
    // Without a run of its own, every run with sessions counts.
    assert.equal((await otherSessionProcesses(undefined, dir, 300)).length, 3);
  } finally {
    for (const server of servers) server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
