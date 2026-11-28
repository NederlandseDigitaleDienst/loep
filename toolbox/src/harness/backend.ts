import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, stateDir } from "./paths.ts";

/*
 * The agent that runs the regie, and that every agent of the waves runs on: `vlam-claude` and `claude`
 * speak the same command line, `opencode` has its own. Everything that differs between them sits here,
 * so the runner, the wave runner and the doctor ask one module instead of knowing two programs.
 *
 * loep ships no agent: which of the three is there is a fact of the machine. `LOEP_REGIE` picks one; the
 * doctor says which it became and why.
 */

export type Backend = "vlam-claude" | "claude" | "opencode";
export const BACKENDS: readonly Backend[] = ["vlam-claude", "claude", "opencode"];

export interface ChosenBackend {
  backend: Backend;
  /** Why this one, in one line, for `loep doctor`. */
  whyNl: string;
}

const which = (name: string, env: NodeJS.ProcessEnv): string | null => {
  try {
    return execFileSync("which", [name], { encoding: "utf8", env }).trim() || null;
  } catch {
    return null;
  }
};

/** Which agent runs a site. `LOEP_REGIE` wins; without it the first that is installed. */
export function chooseBackend(env: NodeJS.ProcessEnv = process.env): ChosenBackend {
  const given = (env["LOEP_REGIE"] ?? "").trim();
  if (given !== "") {
    if (!(BACKENDS as readonly string[]).includes(given)) {
      throw new Error(`LOEP_REGIE=${given} is geen agent; kies uit ${BACKENDS.join(", ")}, of laat LOEP_REGIE weg en loep zoekt er zelf een`);
    }
    const found = which(given, env);
    if (found === null) throw new Error(`LOEP_REGIE=${given}, maar ${given} staat niet op het pad`);
    return { backend: given as Backend, whyNl: `LOEP_REGIE=${given}` };
  }
  for (const backend of BACKENDS) {
    const found = which(backend, env);
    if (found !== null) return { backend, whyNl: `${backend} gevonden op ${found}` };
  }
  throw new Error(`geen agent gevonden; installeer er een (Claude Code of opencode) of zet LOEP_REGIE op ${BACKENDS.join(" of ")}`);
}

/** The program that runs the regie: the backend itself, since loep ships none. */
export const backendCommand = (backend: Backend): string => backend;

/** `claude` and `vlam-claude` take the same flags; opencode has its own command line. */
const isClaude = (backend: Backend): boolean => backend !== "opencode";

/** The rules that keep the site out of every agent that loep starts: they go to both backends. */
const DENIED_HOSTS_NL = "een verzoek aan de site gaat altijd via loep";

/**
 * The overlay of opencode: the skills of this checkout, and the tools a run must not reach. It sits on
 * top of the configuration of the person, so the provider and the model they chose stay in force.
 */
let overlay: { home: string; path: string } | null = null;

export function opencodeConfig(): string {
  // Once per home: every agent of the waves asks for the environment, and the file is the same.
  const home = stateDir();
  if (overlay !== null && overlay.home === home) return overlay.path;
  const dir = join(home, "opencode");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "opencode.json");
  const config = {
    $schema: "https://opencode.ai/config.json",
    skills: [join(repoRoot, "skills")],
    permission: {
      // Everything a run does is allowed without asking: a headless session has nobody to ask, and a
      // question would hang the run instead of stopping it. The site stays out through the two below.
      external_directory: "allow",
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      task: "allow",
      skill: "allow",
      todowrite: "allow",
      webfetch: "deny",
      websearch: "deny",
      // Bash is open, as in the claude path, and stops the common forms only. It is no boundary: an own
      // script with fetch gets past it, and that rests on the rule in the prompt and on the seal.
      bash: { "*": "allow", "curl*": "deny", "wget*": "deny", "nc*": "deny", "ssh*": "deny" },
    },
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  overlay = { home, path };
  return path;
}

/**
 * The environment of the regie. For claude an empty config folder keeps the settings, the plugins and
 * the CLAUDE.md of the person out of a run; `--safe-mode` cannot do that, because it also switches off
 * the skill. opencode gets the overlay above, since its configuration holds the provider and the key.
 */
export function regieEnvOf(backend: Backend): NodeJS.ProcessEnv {
  if (isClaude(backend)) {
    return { ...process.env, CLAUDE_CONFIG_DIR: join(stateDir(), "claude-home"), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: BG_WAIT_CEILING_MS };
  }
  return { ...process.env, OPENCODE_CONFIG: opencodeConfig() };
}

/**
 * Six hours: `claude -p` waits that long for a subagent that is still running when the turn ends, and
 * stops it after ten minutes by default. The explorer and a round of the workflow take longer than
 * that, so the default kills them and ends the turn with a half-done run.
 */
export const BG_WAIT_CEILING_MS = "21600000";

/** The tools an agent of loep may use: the same set for the regie and for an agent of the waves. */
const ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Workflow", "Task"];
const DISALLOWED_TOOLS = ["WebFetch", "WebSearch", "Bash(curl:*)", "Bash(wget:*)", "Bash(nc:*)", "Bash(ssh:*)"];

/** The flags that hold for every claude session loep starts, the regie and each agent of the waves. */
function claudeFlags(run: string): string[] {
  return [
    "--permission-prompts",
    "none",
    "--permission-mode",
    "acceptEdits",
    "--tools",
    ALLOWED_TOOLS.join(","),
    // Bash is open: the skill writes commands like `cd … && just doctor | tail -60`, and a permission
    // per command refuses those compound forms. The list below stops the common forms and is inherited
    // by every agent, but it is no boundary: `node -e`, `python3` or `/usr/bin/curl` get past it, and
    // Bash writes wherever the user may write.
    "--allowedTools",
    ...ALLOWED_TOOLS,
    "--disallowedTools",
    ...DISALLOWED_TOOLS,
    "--add-dir",
    run,
  ];
}

/** The command line of the regie, as a stream of JSON that `startRegie` reads. */
export function regieArgs(backend: Backend, prompt: string, run: string): string[] {
  if (isClaude(backend)) {
    return ["-p", prompt, "--plugin-dir", repoRoot, "--no-session-persistence", ...claudeFlags(run), "--output-format", "stream-json", "--verbose"];
  }
  return ["run", "--format", "json", "--title", `loep ${run}`, prompt];
}

/**
 * The command line of one agent of the waves: one question, one answer, nothing kept. `model` is a role
 * model (`opus`, `sonnet`, `haiku`) and reaches only claude; opencode runs on the model of the config.
 */
export function agentArgs(backend: Backend, prompt: string, run: string, model: string | null): string[] {
  if (isClaude(backend)) {
    return ["-p", prompt, "--plugin-dir", repoRoot, "--no-session-persistence", ...claudeFlags(run), "--output-format", "json", ...(model === null ? [] : ["--model", model])];
  }
  return ["run", "--format", "json", prompt];
}

interface Block {
  type?: unknown;
  name?: unknown;
  text?: unknown;
  input?: Record<string, unknown>;
}

interface Line {
  type?: unknown;
  subtype?: unknown;
  message?: { content?: unknown };
  result?: unknown;
  part?: { tool?: unknown; text?: unknown; state?: { input?: Record<string, unknown> } };
}

const parseLine = (line: string): Line | null => {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null && typeof parsed === "object" ? (parsed as Line) : null;
  } catch {
    return null;
  }
};

/** The loep command a shell line runs: `cli.ts audit check-gate` is `check-gate`, in the words of `loep status`. */
function stepOfCommand(command: string): string | null {
  const loep = /cli\.ts\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/.exec(command);
  if (loep?.[1] === undefined) return null;
  return loep[1] === "audit" || loep[1] === "dev" ? (loep[2] ?? loep[1]) : loep[1];
}

/**
 * The step a stream line stands for: the loep command, the workflow, or a single subagent. The two
 * backends write a different stream: claude puts a tool use in `message.content`, opencode in `part`.
 */
export function stepOf(backend: Backend, line: string): string | null {
  const event = parseLine(line);
  if (event === null) return null;
  if (isClaude(backend)) {
    if (event.type === "system" && event.subtype === "init") return "gestart";
    const content = event.message?.content;
    if (!Array.isArray(content)) return null;
    for (const block of content as Block[]) {
      if (block.type !== "tool_use") continue;
      if (block.name === "Workflow") return "werkstroom";
      if (block.name === "Task") return "subagent";
      if (block.name === "Bash") return stepOfCommand(typeof block.input?.["command"] === "string" ? block.input["command"] : "");
    }
    return null;
  }
  if (event.type === "step_start") return "gestart";
  if (event.type !== "tool_use") return null;
  const tool = typeof event.part?.tool === "string" ? event.part.tool : "";
  if (tool === "task") return "subagent";
  if (tool === "workflow") return "werkstroom";
  if (tool === "bash") return stepOfCommand(typeof event.part?.state?.input?.["command"] === "string" ? (event.part.state.input["command"] as string) : "");
  return null;
}

/** A line of the transcript a person can read, without the JSON around it. */
export function transcriptText(backend: Backend, line: string): string {
  const event = parseLine(line);
  if (event === null) return line.slice(0, 200);
  if (isClaude(backend)) {
    if (event.type === "system" && event.subtype === "init") return "gestart";
    if (typeof event.result === "string") return event.result.slice(0, 300);
    const content = event.message?.content;
    if (Array.isArray(content)) {
      const texts = (content as Block[])
        .map((block) => (block.type === "text" ? String((block as { text?: unknown }).text ?? "") : block.type === "tool_use" ? `[${String(block.name)}]` : ""))
        .filter((text) => text !== "");
      if (texts.length > 0) return texts.join(" ").slice(0, 300);
    }
    return line.slice(0, 200);
  }
  if (event.type === "step_start") return "gestart";
  if (event.type === "text" && typeof event.part?.text === "string") return event.part.text.slice(0, 300);
  if (event.type === "tool_use") return `[${typeof event.part?.tool === "string" ? event.part.tool : "tool"}]`;
  return line.slice(0, 200);
}

/**
 * The answer of one agent, out of what it wrote: the `result` of claude, or the last block of text of
 * opencode. Null when the agent wrote nothing that can be an answer.
 */
export function finalTextOf(backend: Backend, output: string): string | null {
  let answer: string | null = null;
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseLine(line);
    if (event === null) continue;
    if (isClaude(backend)) {
      if (typeof event.result === "string") answer = event.result;
      continue;
    }
    if (event.type === "text" && typeof event.part?.text === "string") answer = event.part.text;
  }
  return answer === null || answer.trim() === "" ? null : answer.trim();
}

/** What goes into the transcript: the thinking counters of a stream would fill hours with numbers. */
export function keepInTranscript(backend: Backend, line: string): boolean {
  if (!isClaude(backend)) return true;
  const event = parseLine(line);
  return !(event?.type === "system" && event.subtype === "thinking_tokens");
}

export const deniedHostsNl = DENIED_HOSTS_NL;
