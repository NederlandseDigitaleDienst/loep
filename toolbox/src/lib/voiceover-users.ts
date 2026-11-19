import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./canonical.ts";
import { alive, LIMITS, readRecord, realClock, runningStart, stateDir, VM_NAME, type Clock } from "./voiceover.ts";

/**
 * Which runs use the one virtual Mac of this machine. `voiceover start --run` enters a run and
 * `voiceover stop --run` takes it out again; `stop` leaves the virtual Mac up while another run is
 * entered. A run is entered for the whole evaluation, also while it holds no session, as during
 * the sweep or between two rounds. One file per run, so two runs never write the same file.
 *
 * A run that broke off without taking itself out would hold the virtual Mac for good. So an entry
 * does not count while its run has written nothing for `USER_IDLE_MS`, and is removed when the run
 * is gone. A run that comes back after a longer pause, as on a weekly limit, renews its entry with
 * `pending` (`renewUser`).
 */

/** Longer than a pause for a usage limit (five hours), shorter than a day. */
export const USER_IDLE_MS = 6 * 60 * 60 * 1000;

/** How many entries of a run are looked at for its last write: enough for the top two levels of a run. */
const MAX_ENTRIES = 5000;

export interface VoiceoverUser {
  /** The run directory, as a full path. */
  run: string;
  /** When the run was entered, or its entry last renewed. */
  since: string;
  /** The last write in the run, or null when it could not be read. */
  lastWrite: string | null;
}

const usersDir = (dir: string, name: string): string => join(dir, `${name}.users`);
const entryFile = (dir: string, name: string, runDir: string): string => join(usersDir(dir, name), `${sha256(runDir).slice(0, 16)}.json`);
const fullPath = (runDir: string): string => (existsSync(runDir) ? realpathSync(runDir) : runDir);

/** Write a file whole or not at all: a stop that reads at the same time never sees half an entry. */
function writeWhole(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

/** Enter a run as a user of the virtual Mac, or renew its entry. */
export function enterUser(runDir: string, name = VM_NAME(), dir = stateDir(), now: Date = new Date()): void {
  const run = fullPath(runDir);
  mkdirSync(usersDir(dir, name), { recursive: true });
  writeWhole(entryFile(dir, name, run), `${JSON.stringify({ run, since: now.toISOString() })}\n`);
}

/** Renew the entry of a run that is entered, also one that no longer counts after a long pause; a run that was never entered stays out. */
export function renewUser(runDir: string, name = VM_NAME(), dir = stateDir(), now: Date = new Date()): void {
  if (existsSync(entryFile(dir, name, fullPath(runDir)))) enterUser(runDir, name, dir, now);
}

/** Take a run out again; nothing happens when it was not entered. */
export function leaveUser(runDir: string, name = VM_NAME(), dir = stateDir()): void {
  rmSync(entryFile(dir, name, fullPath(runDir)), { force: true });
}

/**
 * The newest change in the run: the run directory itself and what lies up to two levels below it.
 * A file written in a deeper folder changes the time of that folder.
 */
export function lastWrite(runDir: string): number | null {
  let newest: number | null = null;
  let seen = 0;
  const look = (path: string, depth: number): void => {
    if (seen >= MAX_ENTRIES) return;
    seen += 1;
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    newest = Math.max(newest ?? 0, stats.mtimeMs);
    if (!stats.isDirectory() || depth >= 2) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) look(join(path, entry), depth + 1);
  };
  look(runDir, 0);
  return newest;
}

/**
 * The runs entered as users of the virtual Mac, except `ownRun`. An entry of a run that wrote
 * nothing for `idleMs` since it was entered or renewed does not count; one of a run that is gone is
 * removed.
 */
export function otherUsers(ownRun?: string, name = VM_NAME(), dir = stateDir(), now: Date = new Date(), idleMs = USER_IDLE_MS): VoiceoverUser[] {
  const own = ownRun === undefined ? null : fullPath(ownRun);
  let names: string[] = [];
  try {
    names = readdirSync(usersDir(dir, name)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const found: VoiceoverUser[] = [];
  for (const entry of names) {
    const path = join(usersDir(dir, name), entry);
    let record: { run?: unknown; since?: unknown };
    try {
      record = JSON.parse(readFileSync(path, "utf8")) as typeof record;
    } catch {
      rmSync(path, { force: true });
      continue;
    }
    if (typeof record.run !== "string" || typeof record.since !== "string") {
      rmSync(path, { force: true });
      continue;
    }
    if (record.run === own) continue;
    const written = existsSync(record.run) ? lastWrite(record.run) : null;
    if (written === null) {
      rmSync(path, { force: true });
      continue;
    }
    if (now.getTime() - Math.max(written, Date.parse(record.since) || 0) > idleMs) continue;
    found.push({ run: record.run, since: record.since, lastWrite: new Date(written).toISOString() });
  }
  return found;
}

/** What keeps `voiceover stop` from shutting down: another run entered as a user, or a start that still runs. */
export interface InUse {
  users: VoiceoverUser[];
  starting: { pid: number; since: string } | null;
}

export const inUse = (ownRun?: string): InUse => ({ users: otherUsers(ownRun), starting: runningStart() });

/**
 * A stop that shuts the virtual Mac down leaves word first, and only then looks at the entries; a
 * start leaves word first (its entry, the file of a start that runs), and only then looks for a
 * stop. So of a stop and a start at the same moment, at least one sees the other: the stop refuses,
 * or the start waits until the virtual Mac is down and boots it again.
 */
const stoppingFile = (dir: string, name: string): string => join(dir, `${name}.stopping.json`);

/** Leave word that a stop runs; the function given back takes it away again. */
export function markStopping(name = VM_NAME(), dir = stateDir(), now: Date = new Date()): () => void {
  mkdirSync(dir, { recursive: true });
  const path = stoppingFile(dir, name);
  writeWhole(path, `${JSON.stringify({ pid: process.pid, since: now.toISOString() })}\n`);
  return () => rmSync(path, { force: true });
}

/** Wait while a stop of another process runs, at most as long as a shutdown may take. True when one was waited for. */
export async function awaitStop(name = VM_NAME(), dir = stateDir(), clock: Clock = realClock): Promise<boolean> {
  const deadline = clock.now() + (LIMITS.shutdownSeconds + 60) * 1000;
  let waited = false;
  for (;;) {
    const stopping = readRecord<{ pid: number }>(stoppingFile(dir, name));
    if (!stopping || stopping.pid === process.pid || !alive(stopping.pid) || clock.now() >= deadline) return waited;
    waited = true;
    await clock.sleep(2000);
  }
}
