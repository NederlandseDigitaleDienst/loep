import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeJson } from "../lib/canonical.ts";
import { costOf, PRICES, type Price, type Tokens } from "../lib/prices.ts";
import type { UsageFile } from "./variants.ts";

/*
 * What the agents of a workflow used, counted from their transcripts, as the usage file that
 * `compare-variants --usage` reads (validatie/verbruik/README.md). A run records no tokens; the
 * transcripts do. A workflow keeps one per agent, `agent-<id>.jsonl`, next to `agent-<id>.meta.json`,
 * whose description is the label the workflow gave the agent: the phase and what it works on
 * ("judges 1.1.1", "walks start", "stand 2").
 */

/** The phase in the label of a workflow agent, and the role compare-variants counts it under. */
const ROLE_OF_PHASE: Record<string, string> = { walks: "walk", judges: "judge", verifiers: "verifier", finishers: "finisher", stand: "stand" };
const PER_CRITERION = new Set(["judge", "verifier", "finisher"]);
const ROLE_ORDER = ["walk", "judge", "verifier", "finisher", "stand"];

type Row = UsageFile["agents"][number];

/** The model as a price is looked up: without a context suffix ("[1m]") or a date. */
export const modelId = (name: string): string => name.replace(/\[[a-z0-9]+\]$/i, "").replace(/-\d{8}$/, "");

/**
 * Tokens and turns per model in one transcript. Each assistant message counts once, by its id: a
 * message with several blocks is written as several records with the same usage. Messages the
 * client made itself (model "<synthetic>") used nothing.
 */
export function transcriptUsage(text: string): Map<string, Tokens & { turns: number }> {
  const messages = new Map<string, { model: string; usage: Record<string, unknown> }>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: { type?: unknown; message?: { id?: unknown; model?: unknown; usage?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue; // A line cut off while the agent was still writing it.
    }
    const message = entry.message;
    if (entry.type !== "assistant" || !message || typeof message.model !== "string" || message.model.startsWith("<") || !message.usage || typeof message.usage !== "object") continue;
    messages.set(typeof message.id === "string" ? message.id : `#${messages.size}`, { model: modelId(message.model), usage: message.usage as Record<string, unknown> });
  }
  const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
  const byModel = new Map<string, Tokens & { turns: number }>();
  for (const { model, usage } of messages.values()) {
    const totals = byModel.get(model) ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, turns: 0 };
    totals.input += count(usage.input_tokens);
    totals.cacheWrite += count(usage.cache_creation_input_tokens);
    totals.cacheRead += count(usage.cache_read_input_tokens);
    totals.output += count(usage.output_tokens);
    totals.turns++;
    byModel.set(model, totals);
  }
  return byModel;
}

/** A run folder as runs are compared: with its links resolved where it exists. */
const runPath = (path: string): string => (existsSync(path) ? realpathSync(path) : resolve(path));

/** A task file of an agent (`rondgang/<id>.md`, `tasks/<id>/beoordeel.md`) or `pending --run <run>`: the run folder it names. */
const RUN_NAMED = [/(\/[^\s"'`]+?)\/+(?:rondgang\/[^/\s"'`]+\.md|tasks\/[^/\s"'`]+\/(?:beoordeel|verifieer|afmaak)\.md)/g, /\bpending\s+--run\s+["']?(\/[^\s"'`]+)/g];

/**
 * The run folders the first prompt of a transcript names by an absolute path, to tell the runs of
 * one workflow apart. Empty when it names none.
 */
export function runsNamed(text: string): Set<string> {
  for (const line of text.split("\n")) {
    let entry: { type?: unknown; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    const content = entry.message?.content;
    const prompt = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: { type?: unknown; text?: unknown }) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("\n") : "";
    return new Set(RUN_NAMED.flatMap((pattern) => [...prompt.matchAll(pattern)].map((match) => runPath(match[1]!))));
  }
  return new Set();
}

/** The criteria the run has tasks for, or null without task files. */
function taskCriteria(runDir: string): Set<string> | null {
  const path = join(runDir, "tasks", "index.json");
  if (!existsSync(path)) return null;
  return new Set(((JSON.parse(readFileSync(path, "utf8")) as { tasks?: { criterion: string }[] }).tasks ?? []).map((task) => task.criterion));
}

/**
 * One row per agent and model, from the transcripts in `transcripts`, for the run in `run`. The
 * role and the criterion or page type come from the label of the agent, the model from its
 * messages. A workflow can work on several runs: an agent whose first prompt names a run counts
 * only for that run, and one that names none counts. Refuses transcripts that name a criterion the
 * run has no task for: they belong to another run.
 */
export function usageFromTranscripts(options: { transcripts: string; run: string }): UsageFile {
  const dir = resolve(options.transcripts);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${options.transcripts} is geen map met transcripts`);
  const run = resolve(options.run);
  if (!existsSync(run)) throw new Error(`run ${options.run} bestaat niet`);
  const thisRun = runPath(run);
  const metas = readdirSync(dir).filter((name) => /^agent-.+\.meta\.json$/.test(name)).sort();
  if (metas.length === 0) throw new Error(`${options.transcripts} heeft geen transcripts van agents (agent-<id>.jsonl met agent-<id>.meta.json): geef de map van één werkstroom`);

  const rows: Row[] = [];
  let notCounted = 0;
  let otherRun = 0;
  for (const meta of metas) {
    const transcript = join(dir, meta.replace(/\.meta\.json$/, ".jsonl"));
    const description = (JSON.parse(readFileSync(join(dir, meta), "utf8")) as { description?: unknown }).description;
    if (!existsSync(transcript) || typeof description !== "string" || description.trim() === "") {
      notCounted++;
      continue;
    }
    const [phase = "", ...rest] = description.trim().split(/\s+/);
    const role = ROLE_OF_PHASE[phase] ?? phase;
    const item = rest.join(" ");
    const about = PER_CRITERION.has(role) && item ? { criterion: item } : role === "walk" && item ? { pageType: item } : {};
    const text = readFileSync(transcript, "utf8");
    const named = runsNamed(text);
    if (named.size > 0 && !named.has(thisRun)) {
      otherRun++;
      continue;
    }
    const byModel = transcriptUsage(text);
    if (byModel.size === 0) notCounted++;
    for (const [model, { turns, ...tokens }] of byModel) rows.push({ role, ...about, agent: meta.replace(/^agent-/, "").replace(/\.meta\.json$/, ""), model, ...tokens, turns });
  }

  if (rows.length === 0 && otherRun > 0) throw new Error(`geen van de ${otherRun} agents in ${basename(dir)} werkte aan run ${basename(run)}: hun opdrachten liggen in een andere run`);
  const criteria = taskCriteria(run);
  const foreign = criteria ? [...new Set(rows.flatMap((row) => (row.criterion && !criteria.has(row.criterion) ? [row.criterion] : [])))] : [];
  if (foreign.length > 0) throw new Error(`de transcripts noemen criteria waar run ${basename(run)} geen opdracht voor heeft (${foreign.join(", ")}): horen ze bij een andere run?`);

  const rank = (role: string): number => (ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length);
  rows.sort((a, b) => rank(a.role!) - rank(b.role!) || a.role!.localeCompare(b.role!) || (a.criterion ?? a.pageType ?? "").localeCompare(b.criterion ?? b.pageType ?? "", "nl", { numeric: true }) || a.agent!.localeCompare(b.agent!));
  const prices: Record<string, Price> = {};
  for (const row of rows) if (row.model && PRICES[row.model]) prices[row.model] = PRICES[row.model]!;
  const agents = new Set(rows.map((row) => row.agent)).size;
  return {
    schema: "loep/verbruik/1",
    run: basename(run),
    sourceNl: `Geteld uit de transcripts van ${agents} agents in ${basename(dir)}, elk assistent-bericht één keer${otherRun > 0 ? `; ${otherRun} ${otherRun === 1 ? "agent" : "agents"} van een andere run niet geteld` : ""}${notCounted > 0 ? `; ${notCounted} ${notCounted === 1 ? "agent" : "agents"} zonder transcript, beschrijving of bericht niet geteld` : ""}.`,
    prices,
    agents: rows,
  };
}

export const USAGE_USAGE = `loep usage --transcripts <dir> --run <run> [--out <file>]

Count what the agents of one workflow used, from their transcripts, as the usage file of
compare-variants --usage (schema loep/verbruik/1; validatie/verbruik/README.md). Not a step of an evaluation.

  --transcripts <dir>  The folder of one workflow, with agent-<id>.jsonl and agent-<id>.meta.json per agent
                       (in Claude Code: subagents/workflows/<workflow> of the session)
  --run <run>          The run the workflow worked on; its folder name goes into the file, and a criterion
                       the run has no task for is refused. In a workflow over several runs, an agent whose
                       first prompt names another run (a task file, pending --run) is left out
  --out <file>         Where to write the file; without it the file goes to standard output

Per agent and model: tokens by kind and turns, each assistant message counted once. The role and the
criterion (or page type) come from the label of the agent ("judges 1.1.1"), the model from its messages.
The file carries the prices of the models that have one (Opus and Sonnet); Haiku has none, because above
100,000 tokens in one turn it costs more.
`;

export async function cli(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { transcripts: { type: "string" }, run: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    process.stdout.write(USAGE_USAGE);
    return;
  }
  if (!values.transcripts || !values.run) throw new Error(`usage needs --transcripts <dir> and --run <run>\n\n${USAGE_USAGE}`);
  const file = usageFromTranscripts({ transcripts: values.transcripts, run: values.run });
  if (!values.out) {
    process.stdout.write(`${JSON.stringify(file, null, 2)}\n`);
    return;
  }
  await writeJson(values.out, file);
  const turns = file.agents.reduce((sum, row) => sum + (row.turns ?? 0), 0);
  const priced = file.agents.filter((row) => row.model && file.prices?.[row.model]);
  const cost = priced.reduce((sum, row) => sum + costOf(row, file.prices![row.model!]!), 0);
  const unpriced = [...new Set(file.agents.filter((row) => !priced.includes(row)).map((row) => row.model ?? "onbekend"))];
  process.stdout.write(`${file.agents.length} rijen, ${turns} beurten, ${cost.toFixed(2)} dollar${unpriced.length > 0 ? ` zonder ${unpriced.join(", ")} (geen prijs)` : ""}; ${values.out}\n`);
}
