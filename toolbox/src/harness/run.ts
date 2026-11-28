import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { backendCommand, backendOfLine, keepInTranscript, stepOf, transcriptText, type Backend } from "./backend.ts";
import { cliArgs, toolboxCli } from "./paths.ts";
import type { Question } from "./state.ts";

/*
 * The runner: start the regie, follow its stream, and say where it stopped. The regie runs for hours
 * and is silent for long stretches (a sweep, a phase with a hundred and fifty agents), so the runner
 * never kills it and never guesses from silence: it reports the last step it saw, and the outcome comes
 * from what is on disk (vraag.md, the seal) and from `pending` at the next start.
 */

export interface RegieResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The last step the stream showed, for `status`. */
  step: string | null;
  /** A person stopped loep (Ctrl-C, a kill, a closed terminal): no next turn, no next site. */
  interrupted: boolean;
}

interface ContentBlock {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface StartOptions {
  /** Which agent runs the regie: its stream is read in the words of that backend. */
  backend: Backend;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Every line of the stream, as it came in: the transcript of a run is the only way back into what happened. */
  transcript: string;
  onStep: (step: string) => void;
  /** The pid of the regie as soon as it runs: a loep that is killed leaves the regie behind. */
  onStart?: ((pid: number) => void) | undefined;
}

export function startRegie(options: StartOptions): Promise<RegieResult> {
  return new Promise((resolve, reject) => {
    const command = backendCommand(options.backend);
    const child = spawn(command, options.args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let step: string | null = null;
    let pending = "";
    let interrupted = false;
    // A handler on a signal means node no longer stops by itself, so the runner has to say that the
    // regie stopped because a person wanted it to; without that it reads as a half-done turn and the
    // next turn starts. Every signal counts, also a second Ctrl-C.
    const forward = (): void => {
      interrupted = true;
      // Without a pid there is nothing to stop, and pid 0 would hit the whole process group.
      if (child.pid !== undefined) {
        try {
          process.kill(child.pid, "SIGTERM");
        } catch {
          // The regie is already gone.
        }
      }
    };
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const signal of signals) process.on(signal, forward);
    const finish = (): void => {
      for (const signal of signals) process.off(signal, forward);
    };
    child.on("error", (error) => {
      finish();
      reject(new Error(`${command} start niet: ${error.message}`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.trim() !== "" && keepInTranscript(options.backend, line)) {
          appendFileSync(options.transcript, `${line}\n`, { mode: 0o600 });
          const found = stepOf(options.backend, line);
          // opencode says "started" at every step; a second one must not erase the step before it.
          if (found !== null && !(found === "gestart" && step !== null)) {
            step = found;
            options.onStep(found);
          }
        }
        index = pending.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line.trim() !== "") appendFileSync(options.transcript, `# ${line}\n`, { mode: 0o600 });
    });
    child.on("close", (code, signal) => {
      finish();
      if (pending.trim() !== "") appendFileSync(options.transcript, `${pending}\n`, { mode: 0o600 });
      resolve({ code, signal, step, interrupted });
    });
    // Only now, with every handler in place: a state that cannot be written must not take the handlers
    // down with it. That would leave a regie nobody reads and nobody can stop, which is the orphan this
    // pid is meant to make visible.
    if (child.pid !== undefined) {
      try {
        options.onStart?.(child.pid);
      } catch (error) {
        try {
          appendFileSync(options.transcript, `# de pid van de regie niet bewaard: ${error instanceof Error ? error.message : String(error)}\n`, { mode: 0o600 });
        } catch {
          // There is nothing left to write the note to; the run goes on without it.
        }
      }
    }
  });
}

/** The question the regie left for a person, with the command it wants run; null when it left none. */
export function readQuestion(dir: string): Question | null {
  const path = join(dir, "vraag.md");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  if (text === "") return null;
  const command = /```[a-z]*\n([\s\S]*?)```/.exec(text)?.[1]?.trim() ?? null;
  const textNl = text.replace(/```[a-z]*\n[\s\S]*?```/g, "").replace(/^#.*$/gm, "").trim();
  return { textNl, command };
}

/**
 * A run whose evidence is sealed and still matches its seal. The index alone is not enough: after an
 * answer of a person the run has to go through evaluate, render and seal again, and a regie that stops
 * halfway leaves the old index behind. `verify` recomputes every hash, which costs seconds on a run of
 * hours, and says whether the seal still covers what is there.
 */
export function isSealed(run: string): boolean {
  if (!existsSync(join(run, "evidence-index.json"))) return false;
  return spawnSync("node", cliArgs(toolboxCli, "verify", "--run", run), { stdio: "ignore" }).status === 0;
}

/**
 * What the run holds now: how many files and when the last one changed. A regie that ends its turn
 * without a question or a seal is asked to go on, but not when it left the run exactly as it found it:
 * that is a regie that is stuck, and a second turn would only cost the same minutes again.
 */
export function runSnapshot(run: string): string {
  if (!existsSync(run)) return "leeg";
  let files = 0;
  let latest = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        files += 1;
        const time = statSync(path).mtimeMs;
        if (time > latest) latest = time;
      }
    }
  };
  walk(run);
  return `${files}:${latest}`;
}

/** Shown as the last resort of `status`: the last lines of the transcript, without the JSON around them. */
export function lastWords(transcript: string, lines: number = 8): string[] {
  return readTranscript(transcript).slice(-lines);
}

/**
 * The whole transcript as lines a person can read. The agent that wrote a line is read from the line itself, so
 * `loep log` and `loep status` work on a run of any backend, also one whose state was written before the choice.
 */
export function readTranscript(transcript: string): string[] {
  if (!existsSync(transcript)) return [];
  return readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (line.startsWith("# ") ? line.slice(2) : transcriptText(backendOfLine(line), line)));
}
