import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
}

interface ContentBlock {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * What goes into the transcript. The stream counts thinking tokens a few times a second; a transcript
 * of hours of a run would be mostly those counters, and `lus log` has to stay readable.
 */
export function keepInTranscript(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; subtype?: unknown };
    return !(parsed.type === "system" && parsed.subtype === "thinking_tokens");
  } catch {
    return true;
  }
}

/** The step a stream line stands for: the loep command, the workflow, or a single subagent. */
export function stepOf(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const event = parsed as { type?: unknown; subtype?: unknown; message?: { content?: unknown } };
  if (event.type === "system" && event.subtype === "init") return "gestart";
  const content = event.message?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content as ContentBlock[]) {
    if (block.type !== "tool_use") continue;
    if (block.name === "Workflow") return "werkstroom";
    if (block.name === "Task") return "subagent";
    if (block.name === "Bash") {
      const command = typeof block.input?.["command"] === "string" ? block.input["command"] : "";
      const loep = /cli\.ts\s+([a-z][a-z-]*)/.exec(command);
      if (loep?.[1]) return loep[1];
    }
  }
  return null;
}

export interface StartOptions {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Every line of the stream, as it came in: the transcript of a run is the only way back into what happened. */
  transcript: string;
  onStep: (step: string) => void;
}

export function startRegie(options: StartOptions): Promise<RegieResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("vlam-claude", options.args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let step: string | null = null;
    let pending = "";
    const forward = (): void => {
      // Zonder pid is er niets om te stoppen, en pid 0 zou de hele procesgroep raken.
      if (child.pid !== undefined) process.kill(child.pid, "SIGTERM");
    };
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    const finish = (): void => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
    };
    child.on("error", (error) => {
      finish();
      reject(new Error(`vlam-claude start niet: ${error.message}`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.trim() !== "" && keepInTranscript(line)) {
          appendFileSync(options.transcript, `${line}\n`);
          const found = stepOf(line);
          if (found !== null) {
            step = found;
            options.onStep(found);
          }
        }
        index = pending.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line.trim() !== "") appendFileSync(options.transcript, `# ${line}\n`);
    });
    child.on("close", (code, signal) => {
      finish();
      if (pending.trim() !== "") appendFileSync(options.transcript, `${pending}\n`);
      resolve({ code, signal, step });
    });
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

/** A run whose evidence is sealed: the report exists and nobody can have changed it since. */
export const isSealed = (run: string): boolean => existsSync(join(run, "evidence-index.json"));

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

/** The whole transcript as lines a person can read. */
export function readTranscript(transcript: string): string[] {
  if (!existsSync(transcript)) return [];
  return readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (line.startsWith("# ") ? line.slice(2) : extractText(line)));
}

function extractText(line: string): string {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; subtype?: unknown; message?: { content?: unknown }; result?: unknown };
    if (parsed.type === "system" && parsed.subtype === "init") return "gestart";
    if (typeof parsed.result === "string") return parsed.result.slice(0, 300);
    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      const texts = (content as ContentBlock[]).map((block) => (block.type === "text" ? String((block as { text?: unknown }).text ?? "") : block.type === "tool_use" ? `[${block.name}]` : "")).filter((text) => text !== "");
      if (texts.length > 0) return texts.join(" ").slice(0, 300);
    }
    return line.slice(0, 200);
  } catch {
    return line.slice(0, 200);
  }
}
