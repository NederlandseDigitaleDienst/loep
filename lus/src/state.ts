import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
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
}

export interface State {
  sites: Record<string, SiteState>;
}

export function emptySite(slug: string): SiteState {
  return { slug, phase: "nieuw", run: null, startedAt: null, updatedAt: new Date().toISOString(), step: null, question: null, version: null, pid: null };
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
  return state.sites[slug] ?? emptySite(slug);
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
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
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

/** Take the lock of the runner. One lus runs sites at a time; a lock of a process that is gone is taken over. */
export function acquireLock(path: string, slug: string | null): { ok: true; stale: RunnerLock | null } | { ok: false; lock: RunnerLock } {
  const current = readLock(path);
  const mine = hostname();
  if (current && current.host === mine && current.pid !== process.pid && alive(current.pid)) return { ok: false, lock: current };
  writeAtomic(path, `${JSON.stringify({ pid: process.pid, host: mine, since: new Date().toISOString(), slug } satisfies RunnerLock, null, 2)}\n`);
  return { ok: true, stale: current && (current.host !== mine || !alive(current.pid)) ? current : null };
}

export function releaseLock(path: string): void {
  const current = readLock(path);
  if (current && current.pid === process.pid && existsSync(path)) unlinkSync(path);
}
