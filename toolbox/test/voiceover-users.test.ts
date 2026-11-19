import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// These tests run without a virtual Mac and without lume. The word `start` and `stop` leave on
// this machine goes to a home directory of the test's own.
const home = mkdtempSync(join(tmpdir(), "loep-voiceover-users-"));
process.env.HOME = home;
process.env.LOEP_VOICEOVER_VM = "loep-voiceover-test";
after(() => rmSync(home, { recursive: true, force: true }));

const { voiceoverStart, voiceoverStop } = await import("../src/commands/voiceover.ts");
const { awaitStop, enterUser, leaveUser, markStopping, otherUsers, renewUser, USER_IDLE_MS } = await import("../src/lib/voiceover-users.ts");
const { stateDir, VM_NAME } = await import("../src/lib/voiceover.ts");
type Guest = import("../src/lib/voiceover.ts").Guest;
type GuestState = import("../src/lib/voiceover.ts").GuestState;

/** A run directory with a file two levels down, all written `ageMs` ago. */
function makeRun(ageMs = 0): string {
  const run = mkdtempSync(join(home, "run-"));
  mkdirSync(join(run, "pages", "a"), { recursive: true });
  writeFileSync(join(run, "pages", "a", "page.json"), "{}");
  const then = new Date(Date.now() - ageMs);
  for (const path of [join(run, "pages", "a", "page.json"), join(run, "pages", "a"), join(run, "pages"), run]) utimesSync(path, then, then);
  return realpathSync(run);
}

/** A guest that runs, shuts down from the inside, and counts how often it was asked to. */
function fakeGuest(state: GuestState = "running") {
  const seen = { state, shutdowns: 0 };
  const api: Guest = {
    state: async () => seen.state,
    boot: async () => void (seen.state = "running"),
    halt: async () => void (seen.state = "stopped"),
    exec: async (command) => {
      if (seen.state !== "running") return null;
      if (command.includes("sudo shutdown -h now")) {
        seen.shutdowns += 1;
        seen.state = "stopped";
      }
      return "";
    },
  };
  return { seen, api };
}

async function printed(action: () => Promise<number>): Promise<{ code: number; out: Record<string, unknown> }> {
  const write = process.stdout.write;
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
  try {
    const code = await action();
    return { code, out: JSON.parse(lines.join("").trim().split("\n").at(-1)!) as Record<string, unknown> };
  } finally {
    process.stdout.write = write;
  }
}

/** No session process of another run: the sockets of this machine are not looked at. */
const noSessions = async (): Promise<never[]> => [];

const clearUsers = (): void => rmSync(join(stateDir(), `${VM_NAME()}.users`), { recursive: true, force: true });

test("an entered run is a user for every other run until it leaves, also without a session", () => {
  clearUsers();
  const first = makeRun();
  const second = makeRun();
  enterUser(first);
  assert.deepEqual(otherUsers(second).map((user) => user.run), [first]);
  assert.deepEqual(otherUsers(first), [], "the own run does not count");
  leaveUser(first);
  assert.deepEqual(otherUsers(second), []);
});

test("an entry lapses when its run wrote nothing for six hours or is gone; a write deep in the run keeps it", () => {
  clearUsers();
  const now = new Date();
  const idle = makeRun(USER_IDLE_MS + 60_000);
  const busy = makeRun(USER_IDLE_MS + 60_000);
  const gone = makeRun();
  enterUser(idle, VM_NAME(), stateDir(), new Date(now.getTime() - USER_IDLE_MS - 60_000));
  enterUser(busy, VM_NAME(), stateDir(), new Date(now.getTime() - USER_IDLE_MS - 60_000));
  enterUser(gone);
  rmSync(gone, { recursive: true, force: true });
  // A file written in a folder deeper down changes the time of that folder.
  writeFileSync(join(busy, "pages", "a", "states.json"), "{}");
  assert.deepEqual(otherUsers(undefined, VM_NAME(), stateDir(), now).map((user) => user.run), [busy]);
  assert.equal(readdirSync(join(stateDir(), `${VM_NAME()}.users`)).length, 2, "the entry of the run that is gone is removed, the idle one is kept");

  // Back after a pause longer than six hours, as on a weekly limit: pending renews the entry, and it counts again.
  renewUser(idle, VM_NAME(), stateDir(), now);
  assert.deepEqual(otherUsers(undefined, VM_NAME(), stateDir(), now).map((user) => user.run).sort(), [busy, idle].sort());
  // A run that was never entered is not entered by a renewal.
  const never = makeRun();
  renewUser(never, VM_NAME(), stateDir(), now);
  assert.ok(!otherUsers(undefined, VM_NAME(), stateDir(), now).some((user) => user.run === never));
});

test("a start waits while a stop of another process shuts the virtual Mac down, and not for a stop that is gone", async () => {
  const clock = { at: 0, sleeps: 0, now: () => clock.at, sleep: async (ms: number) => void ((clock.at += ms), (clock.sleeps += 1)) };
  const marker = join(stateDir(), `${VM_NAME()}.stopping.json`);
  mkdirSync(stateDir(), { recursive: true });
  // The parent of this test stands in for another process that is still stopping.
  writeFileSync(marker, `${JSON.stringify({ pid: process.ppid, since: new Date().toISOString() })}\n`);
  const ended = clock.sleep;
  clock.sleep = async (ms: number) => {
    await ended(ms);
    if (clock.sleeps === 3) rmSync(marker, { force: true });
  };
  assert.equal(await awaitStop(VM_NAME(), stateDir(), clock), true);
  assert.equal(clock.sleeps, 3);
  // A stop whose process is gone is not waited for.
  writeFileSync(marker, `${JSON.stringify({ pid: 2 ** 22 + 1, since: new Date().toISOString() })}\n`);
  assert.equal(await awaitStop(VM_NAME(), stateDir(), clock), false);
  rmSync(marker, { force: true });
  // The own stop leaves word while it runs, and takes it away again.
  const done = markStopping();
  assert.equal(await awaitStop(VM_NAME(), stateDir(), clock), false, "not for the own process");
  done();
  assert.ok(!readdirSync(stateDir()).includes(`${VM_NAME()}.stopping.json`));
});

test("stop leaves the virtual Mac up while another run is entered, and takes the own run out", async () => {
  clearUsers();
  const other = makeRun();
  const own = makeRun();
  enterUser(other);
  enterUser(own);
  const { seen, api } = fakeGuest();
  const refused = await printed(() => voiceoverStop({ run: own }, api, noSessions));
  assert.equal(refused.code, 1);
  assert.equal(refused.out.ok, false);
  assert.match(refused.out.error as string, /^geweigerd: de virtuele Mac blijft aan, want een ander onderzoek gebruikt hem nog \(/);
  assert.ok((refused.out.error as string).includes(other));
  assert.equal(seen.shutdowns, 0);
  assert.equal(seen.state, "running");
  assert.deepEqual(otherUsers(other), [], "the own run left, also though the virtual Mac stays up");

  // Without --run every entered run counts, the own one too.
  enterUser(own);
  leaveUser(other);
  assert.equal((await printed(() => voiceoverStop({}, api, noSessions))).code, 1);

  // The last run that is done shuts it down.
  const stopped = await printed(() => voiceoverStop({ run: own }, api, noSessions));
  assert.equal(stopped.code, 0);
  assert.equal(stopped.out.stopped, "netjes afgesloten");
  assert.equal(seen.shutdowns, 1);
});

test("stop with --force shuts down although another run is entered; a stopped virtual Mac is left as it is", async () => {
  clearUsers();
  enterUser(makeRun());
  const { seen, api } = fakeGuest();
  assert.equal((await printed(() => voiceoverStop({ force: true }, api, noSessions))).code, 0);
  assert.equal(seen.shutdowns, 1);
  const off = await printed(() => voiceoverStop({}, fakeGuest("stopped").api, noSessions));
  assert.equal(off.code, 0);
  assert.equal(off.out.stopped, "de virtuele Mac draaide niet");
});

test("a start that still runs keeps stop from shutting down, also a start without a run", async () => {
  clearUsers();
  mkdirSync(stateDir(), { recursive: true });
  const starting = join(stateDir(), `${VM_NAME()}.starting.json`);
  writeFileSync(starting, `${JSON.stringify({ pid: process.pid, since: new Date().toISOString() })}\n`);
  try {
    const { seen, api } = fakeGuest();
    const refused = await printed(() => voiceoverStop({}, api, noSessions));
    assert.equal(refused.code, 1);
    assert.match(refused.out.error as string, new RegExp(`een start loopt nog \\(proces ${process.pid}\\)`));
    assert.equal(seen.shutdowns, 0);
  } finally {
    rmSync(starting, { force: true });
  }
});

test("start with a run enters it before the boot, so a stop of another run sees it at once", async () => {
  clearUsers();
  const own = makeRun();
  // A guest that is not there: the start ends at once, but the run was entered before it began.
  await printed(() => voiceoverStart({ run: own }, fakeGuest("absent").api));
  assert.deepEqual(otherUsers(makeRun()).map((user) => user.run), [own]);
});

test("with no run entered, the sessions of another run still keep the virtual Mac up; an entered run is told first", async () => {
  clearUsers();
  const { seen, api } = fakeGuest();
  const busy = await printed(() => voiceoverStop({}, api, async () => [{ run: "/runs/other", sessions: 2 }]));
  assert.equal(busy.code, 1);
  assert.match(busy.out.error as string, /nog sessies lopen.*\/runs\/other \(2 sessies\)/);
  enterUser(makeRun());
  const entered = await printed(() => voiceoverStop({}, api, async () => assert.fail("the entries already refuse")));
  assert.match(entered.out.error as string, /een ander onderzoek gebruikt hem nog/);
  assert.equal(seen.shutdowns, 0);
});
