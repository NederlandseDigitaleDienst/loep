import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * How far a step of the sweep is while it runs, so that `estimate` can take its pace instead of
 * the calibration. A step works in lanes: `collect` one over the pages, `contrast` one per pass,
 * `states` one per group of probes. The lanes run one after the other or, with `--at-once`, at
 * the same time. A lane goes through parts in turn (the probes of a group of `states`), each over
 * a list of pages or states. The file exists while the step runs; when it is done, the step in the
 * manifest says how long each lane took and the file is removed.
 */
export type SweepCommand = "collect" | "contrast" | "states";

export interface PartProgress {
  done: number;
  total: number;
}

export interface LaneProgress {
  startedAt: string | null;
  endedAt: string | null;
  /** Per part of the lane, in the order the lane began them: how many of its pages or states are done. */
  parts: Record<string, PartProgress>;
}

export interface StepProgress {
  command: SweepCommand;
  startedAt: string;
  updatedAt: string;
  /** Lanes at the same time. */
  atOnce: number;
  lanes: Record<string, LaneProgress>;
}

export const progressPath = (runDir: string, command: SweepCommand): string => join(runDir, "progress", `${command}.json`);

/** What a running step wrote about how far it is; null when it wrote nothing or the file is being replaced. */
export function readProgress(runDir: string, command: SweepCommand): StepProgress | null {
  const path = progressPath(runDir, command);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StepProgress;
  } catch {
    return null;
  }
}

/** Writing more often than this says nothing new to whoever reads it, and costs the step time. */
const WRITE_EVERY_MS = 2000;

/** The progress of one step as it runs, written to `progress/<command>.json`. */
export class ProgressFile {
  private readonly state: StepProgress;
  private readonly path: string;
  private readonly now: () => Date;
  private lastWrite = 0;

  constructor(runDir: string, command: SweepCommand, lanes: string[], atOnce: number, now: () => Date = () => new Date()) {
    this.now = now;
    const at = now().toISOString();
    this.path = progressPath(runDir, command);
    this.state = { command, startedAt: at, updatedAt: at, atOnce, lanes: Object.fromEntries(lanes.map((lane) => [lane, { startedAt: null, endedAt: null, parts: {} }])) };
    this.write(true);
  }

  private lane(id: string): LaneProgress {
    return (this.state.lanes[id] ??= { startedAt: null, endedAt: null, parts: {} });
  }

  start(lane: string): void {
    this.lane(lane).startedAt ??= this.now().toISOString();
    this.write(true);
  }

  /** `done` of the `total` pages or states of a part of a lane are done. Pages that run at the same time may say so out of order: a part does not go back. */
  tick(lane: string, part: string, done: number, total: number): void {
    const entry = this.lane(lane);
    entry.startedAt ??= this.now().toISOString();
    const before = entry.parts[part]?.total === total ? entry.parts[part]!.done : 0;
    entry.parts[part] = { done: Math.max(before, Math.min(done, total)), total };
    this.write(false);
  }

  end(lane: string): void {
    const entry = this.lane(lane);
    entry.startedAt ??= this.now().toISOString();
    for (const part of Object.values(entry.parts)) part.done = part.total;
    entry.endedAt = this.now().toISOString();
    this.write(true);
  }

  /** The step is done: the seconds of each lane that ran, for the manifest, and the file is removed. */
  finish(): Record<string, number> {
    rmSync(this.path, { force: true });
    try {
      if (readdirSync(dirname(this.path)).length === 0) rmdirSync(dirname(this.path));
    } catch {
      // Another step may be writing its progress there.
    }
    const seconds: Record<string, number> = {};
    for (const [id, lane] of Object.entries(this.state.lanes)) {
      if (lane.startedAt && lane.endedAt) seconds[id] = Math.round((Date.parse(lane.endedAt) - Date.parse(lane.startedAt)) / 1000);
    }
    return seconds;
  }

  /** A step that stops without finishing leaves the file as it last was: `estimate` then says since when nothing moved. */
  private write(always: boolean): void {
    const now = this.now();
    if (!always && now.getTime() - this.lastWrite < WRITE_EVERY_MS) return;
    this.lastWrite = now.getTime();
    this.state.updatedAt = now.toISOString();
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.state, null, 2));
      renameSync(temporary, this.path);
    } catch {
      // Progress is for whoever waits; a step does not fail on it.
    }
  }
}
