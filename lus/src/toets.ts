import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.ts";
import { dateStamp, repoRoot, stateDir } from "./paths.ts";
import { alive } from "./state.ts";

/*
 * The checks of this repository, run the way the pipeline runs them: every step is a task of the
 * justfile, so lus does not keep its own copy of what a check is. The value over typing `just test` is
 * the same value lus has for a site: one at a time, a log per step, the state on disk, and a kill that
 * costs only the step that was running.
 *
 * A check writes nothing in the repository: the logs and what the veegronde produces go to
 * ~/onderzoeken/.lus/toetsen/<moment>/, next to the runs, for the same reason lus writes no file in a
 * run folder.
 */

export interface Step {
  /** The name the command line and the state use: the task of the justfile. */
  name: string;
  /** What it checks, in the words of the summary. */
  taskNl: string;
  /** The task and its flags, as they go to just. */
  args: string[];
  /** Minutes instead of seconds: only with --all. */
  slow?: boolean;
  /** Gets the folder of the toets as --out, so what it writes stays out of the repository. */
  out?: boolean;
}

export const STEPS: Step[] = [
  { name: "reuse", taskNl: "elk bestand heeft een rechthebbende en een licentie", args: ["reuse"] },
  { name: "check", taskNl: "de types van de toolbox", args: ["check"] },
  { name: "lus-check", taskNl: "de types van lus", args: ["lus-check"] },
  { name: "procedures", taskNl: "de procedurecatalogus", args: ["procedures"] },
  { name: "test-quick", taskNl: "de tests zonder browser", args: ["test-quick"] },
  { name: "lus-test", taskNl: "de tests van lus", args: ["lus-test"] },
  { name: "test", taskNl: "alle tests, met browser", args: ["test"], slow: true },
  { name: "veegronde", taskNl: "de regressietoets van de veegronde op de testsite", args: ["sweep-check", "--at-once", "3"], slow: true, out: true },
  { name: "ijkmeting", taskNl: "de ijkmeting op de gevallen van de W3C", args: ["calibrate"], slow: true },
];

export const STEP_NAMES = STEPS.map((step) => step.name);

export interface StepResult {
  name: string;
  startedAt: string;
  endedAt: string;
  /** The exit code of just; null when a signal stopped it. */
  code: number | null;
}

export interface Toets {
  dir: string;
  startedAt: string;
  pid: number | null;
  /** The step that was running when lus last wrote the state. */
  step: string | null;
  results: StepResult[];
}

export const toetsPath = (): string => join(stateDir(), "toets.json");

export function readToets(path: string): Toets | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Toets>;
    if (typeof parsed.dir !== "string" || !Array.isArray(parsed.results)) return null;
    return { dir: parsed.dir, startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "", pid: typeof parsed.pid === "number" ? parsed.pid : null, step: typeof parsed.step === "string" ? parsed.step : null, results: parsed.results };
  } catch {
    return null;
  }
}

export function writeToets(path: string, toets: Toets): void {
  writeAtomic(path, `${JSON.stringify(toets, null, 2)}\n`);
}

/** The moment a toets starts, as a folder name: one toets per start, so two never mix their logs. */
export function toetsDirFor(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return join(stateDir(), "toetsen", `${dateStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`);
}

export const logPathFor = (dir: string, step: string): string => join(dir, `${step}.log`);

/** The steps of a toets: everything, or only the ones the person named. */
export function stepsFor(options: { all?: boolean | undefined; only?: string | undefined }): Step[] {
  if (options.only !== undefined) {
    const wanted = STEPS.filter((step) => step.name === options.only);
    if (wanted.length === 0) throw new Error(`geen toets "${options.only}"; ik ken ${STEP_NAMES.join(", ")}`);
    return wanted;
  }
  return options.all === true ? STEPS : STEPS.filter((step) => step.slow !== true);
}

/** What a step left behind: the exit code of just, and the one line that explains a step without one. */
interface Outcome {
  code: number | null;
  note: string | null;
}

/** Run one step of the justfile, its output to its own log, and wait for the exit code. */
function runStep(step: Step, dir: string, env: NodeJS.ProcessEnv): Promise<Outcome> {
  const args = step.out === true ? [...step.args, "--out", join(dir, step.name)] : step.args;
  const fd = openSync(logPathFor(dir, step.name), "a");
  return new Promise((resolve) => {
    const child = spawn("just", args, { cwd: repoRoot, env, stdio: ["ignore", fd, fd] });
    let settled = false;
    const finish = (outcome: Outcome): void => {
      if (settled) return;
      settled = true;
      closeSync(fd);
      resolve(outcome);
    };
    child.on("error", (error) => finish({ code: null, note: `just startte niet: ${error.message}` }));
    child.on("close", (code, signal) => finish({ code, note: signal === null ? null : `gestopt door ${signal}` }));
  });
}

export interface ToetsOptions {
  all?: boolean | undefined;
  only?: string | undefined;
  /** Begin a new toets instead of going on with one that stopped. */
  fresh?: boolean | undefined;
  /** Where the toets keeps its logs; the tests send it somewhere else than the home of lus. */
  dir?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  onStep?: ((line: string) => void) | undefined;
}

/** The toets to go on with: one that stopped before a step was done, and whose process is gone. */
export function unfinished(toets: Toets | null, steps: Step[]): Toets | null {
  if (toets === null) return null;
  if (toets.pid !== null && alive(toets.pid)) return null;
  const done = new Set(toets.results.filter((result) => result.code === 0).map((result) => result.name));
  return steps.every((step) => done.has(step.name)) ? null : toets;
}

export interface ToetsResult {
  toets: Toets;
  /** The step that failed, or why a step failed without an exit code. */
  failed: { step: Step; code: number | null; noteNl: string } | null;
}

/**
 * Run the measurements. A step that succeeded is not run again, so a toets that stopped goes on where
 * it stopped; a step that fails stops the toets, as the pipeline stops, so the first failure is the
 * one a person sees.
 */
export async function runToets(options: ToetsOptions = {}): Promise<ToetsResult> {
  const steps = stepsFor(options);
  const env = options.env ?? process.env;
  const path = toetsPath();
  const continued = options.fresh === true ? null : unfinished(readToets(path), steps);
  const dir = continued?.dir ?? options.dir ?? toetsDirFor();
  mkdirSync(dir, { recursive: true });
  const toets: Toets = { dir, startedAt: continued?.startedAt ?? new Date().toISOString(), pid: process.pid, step: null, results: [...(continued?.results ?? [])] };
  writeToets(path, toets);
  const done = (): Set<string> => new Set(toets.results.filter((result) => result.code === 0).map((result) => result.name));

  for (const step of steps) {
    if (done().has(step.name)) {
      options.onStep?.(`ok  ${step.name} (al gedaan)`);
      continue;
    }
    toets.step = step.name;
    writeToets(path, toets);
    options.onStep?.(`... ${step.name}`);
    const startedAt = new Date().toISOString();
    const outcome = await runStep(step, dir, env);
    const endedAt = new Date().toISOString();
    appendFileSync(logPathFor(dir, step.name), `\n[${step.name}] ${outcome.note ?? `exit ${String(outcome.code)}`}\n`);
    toets.results = [...toets.results.filter((result) => result.name !== step.name), { name: step.name, startedAt, endedAt, code: outcome.code }];
    writeToets(path, toets);
    options.onStep?.(`${outcome.code === 0 ? "ok " : "NEE"} ${step.name} (${durationNl(startedAt, endedAt)})`);
    if (outcome.code !== 0) {
      toets.step = null;
      toets.pid = null;
      writeToets(path, toets);
      return { toets, failed: { step, code: outcome.code, noteNl: outcome.note ?? "" } };
    }
  }
  toets.step = null;
  toets.pid = null;
  writeToets(path, toets);
  return { toets, failed: null };
}

/** The time a step took, in the units a person uses for it. */
export function durationNl(from: string, to: string): string {
  const seconds = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "onbekend";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} uur ${minutes % 60} min`;
}

/** The last lines of the log of a step: what a person needs to see the failure without opening the file. */
export function lastLines(path: string, count: number): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").slice(-count);
}

/** The summary of a toets: one line per step, and what became of it. */
export function toetsTextNl(toets: Toets, steps: Step[] = STEPS): string {
  const byName = new Map(toets.results.map((result) => [result.name, result]));
  const rows = steps.map((step) => {
    const result = byName.get(step.name);
    const stand = result === undefined ? "nog niet gedaan" : result.code === 0 ? `ok (${durationNl(result.startedAt, result.endedAt)})` : `niet in orde (${result.code === null ? "gestopt" : `exit ${String(result.code)}`})`;
    return [step.name, stand, step.taskNl];
  });
  const width = Math.max(...rows.map((row) => row[0]!.length));
  return `${rows.map((row) => `${row[0]!.padEnd(width)}  ${row[1]!.padEnd(18)} ${row[2]!}`).join("\n")}\nDe logboeken staan in ${toets.dir}\n`;
}
