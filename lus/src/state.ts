import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { writeAtomic } from "./atomic.ts";

/*
 * What lus knows about each site, kept outside the run. `loep seal` hashes every file in a run folder and
 * `loep verify` fails on a file nobody wrote there, so lus never writes in a run: progress, questions and
 * transcripts live in .lus/, next to the backlog. The state is a convenience for `status` and for the next
 * start; the run and vraag.md are the truth, and a state that disagrees with them loses.
 */

export type Phase = "nieuw" | "loopt" | "vraagt" | "klaar" | "fout" | "gepauzeerd";

export const PHASES_NL: Record<Phase, string> = {
  nieuw: "nog niet begonnen",
  loopt: "loopt",
  vraagt: "wacht op een mens",
  klaar: "klaar",
  fout: "gestopt met een fout",
  gepauzeerd: "gepauzeerd",
};

/** What the regie asked a person, and the command that answers it. */
export interface Question {
  textNl: string;
  command: string | null;
}

/** The checkout a run was started from: plugin version, git describe and the commit. */
export interface Version {
  plugin: string;
  describe: string;
  sha: string;
  /** A short hash of the changes that were not committed, empty for a clean checkout; absent in a state of an older lus. */
  changes?: string;
}

export interface SiteState {
  slug: string;
  phase: Phase;
  run: string | null;
  startedAt: string | null;
  updatedAt: string;
  /** The last thing the regie was doing, as the stream showed it ("gate", "Workflow stap 6, 34 van 150"). */
  step: string | null;
  question: Question | null;
  version: Version | null;
  /** The process of the regie, so a lock left by a killed process is recognised as stale. */
  pid: number | null;
  /** How often lus continued this run after a regie stopped without a question and without a seal. */
  continues: number;
  /** The report files that were copied out of the run, under a name with the site and the day. */
  handouts: string[];
  /** What a person did through lus (answer, sign, decide, statement) since the regie stopped, for the next resume. */
  humanNl: string | null;
}

export interface State {
  sites: Record<string, SiteState>;
}

export function emptySite(slug: string): SiteState {
  return { slug, phase: "nieuw", run: null, startedAt: null, updatedAt: new Date().toISOString(), step: null, question: null, version: null, pid: null, continues: 0, handouts: [], humanNl: null };
}

export function readState(path: string): State {
  if (!existsSync(path)) return { sites: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
    return { sites: parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {} };
  } catch {
    // A state file that does not parse costs a status line, not a run: the run folder says more anyway.
    return { sites: {} };
  }
}

export function writeState(path: string, state: State): void {
  writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function siteState(state: State, slug: string): SiteState {
  // A state written by an older lus lacks the fields added since; the empty site says what they are.
  return { ...emptySite(slug), ...state.sites[slug], slug };
}

/** Change what lus knows about one site and write it back. */
export function updateSite(path: string, slug: string, patch: Partial<SiteState>): SiteState {
  const state = readState(path);
  const next: SiteState = { ...siteState(state, slug), ...patch, slug, updatedAt: new Date().toISOString() };
  state.sites[slug] = next;
  writeState(path, state);
  return next;
}

export interface RunnerLock {
  pid: number;
  host: string;
  since: string;
  slug: string | null;
}

/** Whether a process of this machine still runs. A process of another user answers EPERM, and that is alive too. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** When a process started, as `ps` says it; null when `ps` cannot say. */
export function processStart(pid: number): Date | null {
  try {
    const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" } }).trim();
    const start = new Date(text);
    return text === "" || Number.isNaN(start.getTime()) ? null : start;
  } catch {
    return null;
  }
}

/**
 * Whether the process that wrote something at `since` still runs. A pid alone is not enough: after a
 * reboot or a long time the number comes back for another process, and a lock or a state of a lus
 * that is long gone would then hold everything up. A process that started after it wrote cannot be
 * the one that wrote; `ps` gives the start to the second, hence the second of slack.
 */
export function stillRuns(pid: number, since: string): boolean {
  if (!alive(pid)) return false;
  const start = processStart(pid);
  const written = new Date(since).getTime();
  return start === null || Number.isNaN(written) || start.getTime() <= written + 1000;
}

/**
 * Whether the process that was running this site is gone while the state still says it runs. A kill
 * leaves nothing behind to write "gestopt", so the state has to be read against the process list;
 * otherwise `status` claims a run of hours is still going.
 */
export function isGone(site: SiteState): boolean {
  return site.phase === "loopt" && (site.pid === null || !stillRuns(site.pid, site.updatedAt));
}

export function readLock(path: string): RunnerLock | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RunnerLock>;
    if (typeof parsed.pid !== "number" || typeof parsed.since !== "string") return null;
    return { pid: parsed.pid, host: typeof parsed.host === "string" ? parsed.host : "", since: parsed.since, slug: typeof parsed.slug === "string" ? parsed.slug : null };
  } catch {
    return null;
  }
}

/**
 * Take the lock of the runner. One lus runs sites at a time; a lock of a process that is gone is taken
 * over. The file is created exclusively, so two lus that start at the same moment cannot both get it.
 * The host is said in the message but decides nothing: macOS changes its host name with the network,
 * and a live lus on this machine then still holds the lock.
 */
export function acquireLock(path: string, slug: string | null): { ok: true; stale: RunnerLock | null } | { ok: false; lock: RunnerLock } {
  const content = `${JSON.stringify({ pid: process.pid, host: hostname(), since: new Date().toISOString(), slug } satisfies RunnerLock, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  let stale: RunnerLock | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(path, "wx", 0o600);
      try {
        writeSync(handle, content);
      } finally {
        closeSync(handle);
      }
      return { ok: true, stale };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const current = readLock(path);
    if (current && current.pid !== process.pid && stillRuns(current.pid, current.since)) return { ok: false, lock: current };
    // A lock of a process that is gone, or one that does not read (a lus killed while writing it).
    stale = current;
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const current = readLock(path);
  if (current) return { ok: false, lock: current };
  throw new Error(`het slot ${path} is niet te pakken`);
}

export function releaseLock(path: string): void {
  const current = readLock(path);
  if (current && current.pid === process.pid && existsSync(path)) unlinkSync(path);
}
