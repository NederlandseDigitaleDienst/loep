import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ManifestStep } from "./manifest.ts";

/**
 * The phases in which agents work, in the order they run. The prefix is that of their sessions.
 * The last one, the finishing round, only runs for the criteria the evaluation itself left open:
 * a run without such a criterion has no session of it.
 */
export const AGENT_PHASES = [
  { id: "walks", prefix: "r-" },
  { id: "judges", prefix: "b-" },
  { id: "verifiers", prefix: "v-" },
  { id: "finishers", prefix: "a-" },
] as const;
export type AgentPhaseId = (typeof AGENT_PHASES)[number]["id"];

/** What the session files of one phase say about how long it took. */
export interface AgentPhaseTiming {
  phase: AgentPhaseId;
  /** Start of the first session and stop of the last one. */
  startedAt: string;
  endedAt: string;
  seconds: number;
  /** Sessions of this phase; a second attempt has a session of its own. */
  agents: number;
  /** Sessions that were stopped. A phase with fewer than `agents` is still running, or an agent left its session open. */
  stopped: number;
  /** Over the sessions: the time between start and stop of each. An agent also reads and writes outside its session, so this is less than the agent took. */
  sumSeconds: number;
  medianSeconds: number;
}

interface SessionFile {
  startedAt?: string;
  stoppedAt?: string;
  limits?: { maxSessions?: number };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function readSessions(runDir: string): { name: string; file: SessionFile; dir: string }[] {
  const root = join(runDir, "observations");
  if (!existsSync(root)) return [];
  const sessions = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name, "session.json");
    if (!existsSync(path)) continue;
    try {
      sessions.push({ name, file: JSON.parse(readFileSync(path, "utf8")) as SessionFile, dir: join(root, name) });
    } catch {
      // A session file that is being written is skipped; the next call reads it.
    }
  }
  return sessions;
}

/** The time of the last command of a session: where a session that was never stopped ends. */
function lastCommandAt(dir: string): number | null {
  const last = readdirSync(dir).filter((file) => /^\d+\.json$/.test(file)).sort().at(-1);
  if (!last) return null;
  try {
    const time = Date.parse((JSON.parse(readFileSync(join(dir, last), "utf8")) as { time?: string }).time ?? "");
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/**
 * Begin, end and the time per agent of each phase with agents, read from the session files
 * (`observations/<session>/session.json`). Every agent starts and stops one session, and the
 * session process writes both moments: that is the one source every run has, also a run that
 * was copied, where the times of the files are those of the copy. A phase without sessions is left out.
 */
export function agentPhaseTimings(runDir: string): AgentPhaseTiming[] {
  const sessions = readSessions(runDir);
  const timings: AgentPhaseTiming[] = [];
  for (const { id, prefix } of AGENT_PHASES) {
    const spans: { start: number; end: number; stopped: boolean }[] = [];
    for (const { name, file, dir } of sessions) {
      if (!name.startsWith(prefix)) continue;
      const start = Date.parse(file.startedAt ?? "");
      if (!Number.isFinite(start)) continue;
      const stop = Date.parse(file.stoppedAt ?? "");
      spans.push({ start, end: Number.isFinite(stop) ? stop : (lastCommandAt(dir) ?? start), stopped: Number.isFinite(stop) });
    }
    if (spans.length === 0) continue;
    const begin = Math.min(...spans.map((span) => span.start));
    const end = Math.max(...spans.map((span) => span.end));
    const each = spans.map((span) => Math.max(0, span.end - span.start) / 1000);
    timings.push({
      phase: id,
      startedAt: new Date(begin).toISOString(),
      endedAt: new Date(end).toISOString(),
      seconds: Math.round((end - begin) / 1000),
      agents: spans.length,
      stopped: spans.filter((span) => span.stopped).length,
      sumSeconds: Math.round(each.reduce((sum, value) => sum + value, 0)),
      medianSeconds: Math.round(median(each)),
    });
  }
  return timings;
}

/** How many sessions the session process of this run allows, as its latest session file says; null when no session was started. */
export function sessionLimit(runDir: string): number | null {
  let latest: { start: number; max: number } | null = null;
  for (const { file } of readSessions(runDir)) {
    const start = Date.parse(file.startedAt ?? "");
    const max = file.limits?.maxSessions;
    if (Number.isFinite(start) && typeof max === "number" && (!latest || start > latest.start)) latest = { start, max };
  }
  return latest?.max ?? null;
}

/** The parts of an audit the steps of the manifest can be counted under. */
export type StepStage = "inventory" | "explore" | "collect" | "contrast" | "states" | "documents" | "gate" | "report";

export interface StageTiming {
  seconds: number;
  /** True when a step had no begin and the time since the step before it was taken instead. */
  derived: boolean;
}

const STAGE_OF: Record<string, StepStage> = { inventory: "inventory", "check-site": "explore", collect: "collect", contrast: "contrast", states: "states", documents: "documents", gate: "gate", evaluate: "report", merge: "report" };
/** Commands that write their step in a moment; what comes before them is somebody else working. */
const INSTANT = new Set(["sample", "explore", "tasks"]);

/**
 * How long each part took, from the steps of the manifest. A step with a begin counts its own
 * seconds. A step without one (a run from before the begin was recorded) counts the time since
 * the step before it, which is what the older runs were measured by; `derived` says so.
 *
 * Two parts are the work of an agent between two steps and are counted whole: exploring runs
 * from the task of the explorer to the last `check-site`, and the gate from its first to its
 * last verdict. The phases with agents are not in the steps: `agentPhaseTimings` reads those.
 */
export function stageTimings(steps: ManifestStep[]): Partial<Record<StepStage, StageTiming>> {
  const stages: Partial<Record<StepStage, StageTiming>> = {};
  const add = (stage: StepStage, seconds: number, derived: boolean): void => {
    const entry = (stages[stage] ??= { seconds: 0, derived: false });
    entry.seconds += Math.max(0, seconds);
    entry.derived ||= derived;
  };
  let afterGate = false;
  for (const [index, step] of steps.entries()) {
    const at = Date.parse(step.at);
    const previous = index > 0 ? Date.parse(steps[index - 1]!.at) : null;
    const gap = previous === null ? null : (at - previous) / 1000;
    const own = typeof step.seconds === "number" ? step.seconds : null;
    if (step.command === "gate") afterGate = true;
    if (step.command === "tasks") afterGate = false;
    const stage = STAGE_OF[step.command];
    if (!stage || INSTANT.has(step.command)) continue;
    // The explorer works between its task and `check-site`, and whoever looks at the sheets between two verdicts of the gate: that wait belongs to the part.
    const agentBefore = step.command === "check-site" || (step.command === "gate" && steps[index - 1]?.command === "gate");
    // A `check-site` after the gate is the gate sending the explorer back.
    const counted = step.command === "check-site" && afterGate ? "gate" : stage;
    if (agentBefore && gap !== null) add(counted, gap, false);
    else if (own !== null) add(counted, own, false);
    else if (gap !== null) add(counted, gap, true);
  }
  for (const entry of Object.values(stages)) entry.seconds = Math.round(entry.seconds);
  return stages;
}

/** Seconds from the begin of the first step to the end of the last one. */
export function elapsedSeconds(steps: ManifestStep[]): number {
  if (steps.length === 0) return 0;
  const first = steps[0]!;
  return Math.round((Date.parse(steps.at(-1)!.at) - Date.parse(first.startedAt ?? first.at)) / 1000);
}
