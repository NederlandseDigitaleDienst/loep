import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { agentArgs, chooseBackend, finalTextOf, regieEnvOf, type Backend } from "./backend.ts";
import { homeDir, stateDir, toolboxCli, workflowFile } from "./paths.ts";

/*
 * The waves of an audit, started by loep and not by the agent: the workflow in
 * `skills/nldd-a11y-audit/onderzoek.workflow.js` is the source of truth for the rounds, the attempts and
 * the pauses, and this file gives it the four things its runtime needs (`args`, `agent`, `parallel`,
 * `log`) on top of whichever agent the machine has.
 *
 * The workflow used to run in the Workflow tool, which only Claude Code has. With these four, the same
 * script runs on `vlam-claude`, `claude` and `opencode`, so the choice of the agent no longer decides
 * whether a site can be audited at all.
 */

export interface WavesOptions {
  run: string;
  /** Agents at the same time; the workflow keeps its own default of three when this is absent. */
  atOnce?: number | null;
  /** The agent that runs each task; without it the same choice as for the regie. */
  backend?: Backend | null;
  /** A model per role (`walks=sonnet`); the workflow checks the roles and the names. */
  models?: Record<string, string> | null;
  /** Sites that no agent of this run may open. */
  neverOpen?: string[] | null;
  /** A person said to go on with what is left of the budget for sending. */
  sendingAccepted?: boolean | null;
  /** Every line of progress, for the terminal and for the log of the run. */
  log?: ((line: string) => void) | undefined;
}

interface AgentOptions {
  label?: string;
  phase?: string;
  model?: string | null;
  schema?: unknown;
  effort?: string;
}

/** The folder an agent works in: the work folder of the site, next to the run, as the regie has it. */
export function workDirFor(run: string): string {
  const inside = relative(homeDir(), dirname(run));
  return inside === "" || inside.startsWith("..") || isAbsolute(inside) ? dirname(run) : join(stateDir(), inside);
}

/** The instruction that turns an answer into the object the workflow asked for. */
function schemaPrompt(prompt: string, schema: unknown): string {
  return `${prompt}\n\nAntwoord met alleen één JSON-object dat aan deze vorm voldoet, zonder uitleg en zonder codeblok:\n${JSON.stringify(schema)}`;
}

/** The JSON in an answer: bare, or in a code block, or with a sentence around it. */
export function jsonIn(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer);
  const candidates = [fenced?.[1], answer, answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.trim() === "") continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // The next form of the same answer.
    }
  }
  return null;
}

/**
 * The agents that are running, so a person who stops the waves stops them too: without that they keep
 * measuring the site, hold their sessions and write into the run after the person believes it stopped.
 */
const live = new Set<ChildProcess>();

/**
 * One agent: one question, one answer, nothing kept. An agent that exited with a non-zero code, or whose
 * stream holds an error of the model, has no answer: the promise rejects, and the workflow counts it as
 * no attempt instead of a failed one, so its task comes back in the next round.
 */
export function runAgent(backend: Backend, prompt: string, options: AgentOptions, cwd: string, run: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(backend, agentArgs(backend, prompt, run, typeof options.model === "string" ? options.model : null), {
      cwd,
      env: regieEnvOf(backend),
      stdio: ["ignore", "pipe", "pipe"],
    });
    live.add(child);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (error) => {
      live.delete(child);
      reject(new Error(`${backend} start niet: ${error.message}`));
    });
    child.on("close", (code) => {
      live.delete(child);
      const answer = finalTextOf(backend, out);
      const last = err.trim().split("\n").at(-1) ?? "";
      if (answer === null || code !== 0) {
        const why = last === "" ? "" : `: ${last}`;
        reject(new Error(`${backend} gaf geen antwoord (code ${String(code)})${why}`));
        return;
      }
      resolve(answer);
    });
  });
}

/**
 * The workflow file as a function of its four globals. The script returns its history, which a module
 * cannot do, so it runs as the body of an async function; the meta block at the top is a `const` here.
 */
export function workflowFunction(): (...values: unknown[]) => Promise<Record<string, unknown>> {
  const source = readFileSync(workflowFile, "utf8").replace(/^export const meta/m, "const meta");
  const AsyncFunction = Object.getPrototypeOf(async (): Promise<void> => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<Record<string, unknown>>;
  return new AsyncFunction("args", "agent", "parallel", "log", source);
}

/** The workflow's `agent()`, with one retry when it asked for a shape and the answer was not that shape. */
function agentFactory(backend: Backend, cwd: string, run: string, log: (line: string) => void): (prompt: string, options?: AgentOptions) => Promise<unknown> {
  return async (prompt: string, options: AgentOptions = {}) => {
    const label = options.label ?? "agent";
    const asked = options.schema === undefined ? prompt : schemaPrompt(prompt, options.schema);
    const started = Date.now();
    log(`${label} begint`);
    let answer = await runAgent(backend, asked, options, cwd, run);
    if (options.schema !== undefined) {
      let parsed = jsonIn(answer);
      if (parsed === null) {
        log(`${label}: geen JSON in het antwoord, één nieuwe poging`);
        answer = await runAgent(backend, `${asked}\n\nJe vorige antwoord was geen JSON-object. Antwoord nu met alleen het JSON-object.`, options, cwd, run);
        parsed = jsonIn(answer);
      }
      if (parsed === null) {
        log(`${label} klaar in ${Math.round((Date.now() - started) / 1000)}s zonder JSON`);
        return null;
      }
      log(`${label} klaar in ${Math.round((Date.now() - started) / 1000)}s`);
      return parsed;
    }
    log(`${label} klaar in ${Math.round((Date.now() - started) / 1000)}s`);
    return answer;
  };
}

/**
 * The workflow of the audit, run by loep. The file is a script for the Workflow tool: it has `args`,
 * `agent`, `parallel` and `log` in scope and returns its history. Wrapping it in a function with those
 * four as parameters runs it anywhere, without a copy of the rounds in a second language.
 */
export async function runWaves(options: WavesOptions): Promise<Record<string, unknown>> {
  // stderr, because the answer of the command is the history on stdout: a person reading along sees the
  // same lines, and whoever pipes the answer gets JSON and nothing else.
  const log = options.log ?? ((line: string): void => console.error(line));
  let backend = options.backend ?? null;
  if (backend === null) {
    const chosen = chooseBackend();
    backend = chosen.backend;
    log(`golven op ${backend} (${chosen.whyNl})`);
  }
  const cwd = workDirFor(options.run);
  // A run of the harness always has its work folder; one started by hand may not.
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  // A person stops the waves with a signal: the agents it started stop with it. Without this they are
  // reparented and keep measuring the site after the person believes the run stopped.
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forward = (signal: NodeJS.Signals): void => {
    for (const child of live) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The agent is already gone.
      }
    }
    process.off(signal, forward);
    process.kill(process.pid, signal);
  };
  for (const signal of signals) process.on(signal, forward);
  const workflow = workflowFunction();
  const args = {
    cli: toolboxCli,
    run: options.run,
    ...(options.atOnce === null || options.atOnce === undefined ? {} : { atOnce: options.atOnce }),
    ...(options.models === null || options.models === undefined || Object.keys(options.models).length === 0 ? {} : { models: options.models }),
    ...(options.neverOpen === null || options.neverOpen === undefined || options.neverOpen.length === 0 ? {} : { neverOpen: options.neverOpen }),
    ...(options.sendingAccepted === true ? { sendingAccepted: true } : {}),
  };
  return workflow(
    args,
    agentFactory(backend, cwd, options.run, log),
    (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((thunk) => thunk())),
    log,
  );
}
