import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import type { Evaluation } from "../lib/evaluation.ts";
import { GROUPS } from "../lib/groups.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { readTemplate } from "../lib/templates.ts";
import { applyWeighing, clearWeighing, type StaleReason, TASK_WORDS_MAX, TASKS_MAX, TASKS_MIN, TEXT_WORDS_MAX, validateWeighing, weighingInput, WORDS_MAX, WORDS_MIN, type WeighingProposal } from "../lib/weighing.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { readEvaluation, signatureIsCurrent, writeEvaluation } from "./sign.ts";
import { cliCall } from "../lib/commands.ts";

const TASK = join("tasks", "weeg", "taak.md");
const INPUT = join("tasks", "weeg", "invoer.json");
const PROPOSAL = join("verdicts", "weging.json");
const STAMP = join("verdicts", "weging.stamp.json");
/** The work folder of the agent that weighs the findings. */
const WEIGH_WORK = "weeg";

/** Proof of what a weighing was validated against; one that no longer matches is not applied. */
interface WeighStamp {
  inputSha256: string;
  promptSha256: string;
  proposalSha256: string;
  stampedAt: string;
}

export interface WeighResult {
  findings: number;
  /** "stale": there is a weighing, but it is not applied; `reason` says why. */
  weighing: "not-run" | "stale" | "applied";
  reason?: StaleReason;
  raised: number;
  lowered: number;
  same: number;
  noEffect: number;
  unsure: number;
  task: string;
}

/** What a command says about the weighing after it ran, in one line. */
export function weighingLineNl(result: WeighResult): string {
  if (result.weighing === "applied") return `weging toegepast: ${result.raised} bevindingen zwaarder dan de beoordelaars gaven, ${result.lowered} lichter, ${result.same} gelijk; ${result.noEffect} zonder gevolg voor een groep, ${result.unsure} waar de keuze afhangt van een feit dat de bevinding niet geeft`;
  if (result.weighing === "stale") return `${STALE_NL[result.reason ?? "findings"]} Ze is niet toegepast: de ernst is die van de beoordelaars. ${result.reason === "unchecked" ? "Draai check-weigh" : `Weeg opnieuw; de opdracht staat in ${result.task}`}`;
  return `weging niet uitgevoerd: de ernst is die van de beoordelaars; de opdracht staat in ${result.task}`;
}

/** Why a weighing that is there is not applied, as a command says it. */
const STALE_NL: Record<StaleReason, string> = {
  unchecked: "Er staat een weging die check-weigh niet heeft goedgekeurd, of die daarna is gewijzigd.",
  findings: "De weging is gemaakt voor andere bevindingen dan deze.",
  task: "De weging is gemaakt met een andere versie van de opdracht.",
};

function template(): string {
  return readTemplate("weeg");
}

/** The CLI as the task names it: `node`, then the path of any installation up to its `src/cli.ts`. */
const CLI_IN_TASK = /node [^\n`]*?[\\/]src[\\/]cli\.ts/g;

/**
 * The hash of the task as the agent got it, without the paths of this run and of the installation.
 * A run that was moved or copied, and a task written by a toolbox installed somewhere else (another
 * version, or the plugin in another folder), have the same task. Every CLI path counts, not only
 * the one of the installation that hashes: check-weigh hashes the task on disk, which an earlier
 * installation may have written.
 */
async function taskSha256(runDir: string): Promise<string> {
  const text = await readFile(join(runDir, TASK), "utf8");
  return sha256(text.split(resolve(runDir)).join("<run>").replace(CLI_IN_TASK, "node <cli>"));
}

async function currentStamp(runDir: string, inputSha256: string): Promise<Omit<WeighStamp, "stampedAt"> | null> {
  if (!existsSync(join(runDir, PROPOSAL)) || !existsSync(join(runDir, TASK))) return null;
  return { inputSha256, promptSha256: await taskSha256(runDir), proposalSha256: await sha256File(join(runDir, PROPOSAL)) };
}

/** Whether the weighing in the run counts, and when it does not, why: the three causes ask for something else. */
async function standing(runDir: string, inputSha256: string): Promise<"none" | "current" | StaleReason> {
  if (!existsSync(join(runDir, PROPOSAL))) return "none";
  if (!existsSync(join(runDir, STAMP))) return "unchecked";
  const stamp = await readJson<WeighStamp>(join(runDir, STAMP));
  if (stamp.proposalSha256 !== (await sha256File(join(runDir, PROPOSAL)))) return "unchecked";
  if (stamp.inputSha256 !== inputSha256) return "findings";
  return stamp.promptSha256 === (await taskSha256(runDir)) ? "current" : "task";
}

/** Write the input and the fixed prompt of the step. Nothing here decides anything. */
async function writeTask(runDir: string, evaluation: Evaluation): Promise<string> {
  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const inputSha256 = await writeJson(join(runDir, INPUT), weighingInput(evaluation));
  const values: Record<string, string> = {
    site: evaluation.site.name,
    input: join(absoluteRun, INPUT),
    output: join(absoluteRun, PROPOSAL),
    check: cliCall(cli, "check-weigh", "--run", absoluteRun),
    findings: String(evaluation.criteria.reduce((total, criterion) => total + criterion.findings.length, 0)),
    groups: GROUPS.map((group) => `- **${group.id}**: ${group.labelNl}. ${group.howNl}`).join("\n"),
    tasksMin: String(TASKS_MIN),
    tasksMax: String(TASKS_MAX),
    taskWords: String(TASK_WORDS_MAX),
    wordsMin: String(WORDS_MIN),
    wordsMax: String(WORDS_MAX),
    textMax: String(TEXT_WORDS_MAX),
    workDir: await makeWorkDir(runDir, WEIGH_WORK),
    workName: WEIGH_WORK,
  };
  const text = template().replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
  await writeFileAtomic(join(runDir, TASK), text);
  // The agent writes its answer here; the directory has to exist before it does.
  await mkdir(join(runDir, "verdicts"), { recursive: true });
  return inputSha256;
}

/**
 * Weigh the findings of an evaluation. The task is always written. A weighing counts only when
 * it was validated against exactly these findings and this prompt; without one every finding
 * keeps the severity its judge gave, and the evaluation says so.
 */
export async function weighInto(runDir: string, evaluation: Evaluation): Promise<WeighResult> {
  clearWeighing(evaluation);
  const findings = evaluation.criteria.reduce((total, criterion) => total + criterion.findings.length, 0);
  const none = { findings, weighing: "not-run" as const, raised: 0, lowered: 0, same: 0, noEffect: 0, unsure: 0, task: join(runDir, TASK) };
  // Nothing to weigh: no task, so nobody starts an agent for an empty list.
  if (findings === 0) return none;
  const inputSha256 = await writeTask(runDir, evaluation);
  const state = await standing(runDir, inputSha256);
  if (state === "none") return none;
  if (state !== "current") {
    // A weighing that does not count is not applied, and the evaluation says that it is there and why.
    evaluation.weighing = { status: "stale", reason: state };
    return { ...none, weighing: "stale", reason: state };
  }
  const proposal = await readJson<WeighingProposal>(join(runDir, PROPOSAL));
  const counts = applyWeighing(evaluation, proposal);
  evaluation.weighing = { status: "applied", templateSha256: sha256(template()), proposalSha256: await sha256File(join(runDir, PROPOSAL)), tasks: proposal.tasks.map((task) => ({ id: task.id, nameNl: task.nameNl.trim() })), together: (proposal.together ?? []).map((entry) => ({ task: entry.task, group: entry.group, findings: [...entry.findings], stopsNl: entry.stopsNl.trim() })), ...counts };
  return { ...none, weighing: "applied", ...counts };
}

/** Run the step on an evaluation that exists already, after the weighing was validated. */
export async function weigh(runDir: string): Promise<WeighResult> {
  const startedAt = stepStart();
  const path = join(runDir, "evaluation.json");
  const evaluation = await readEvaluation(path);
  // The severities are part of what is signed; changing them would quietly turn the report back into a concept.
  if (signatureIsCurrent(evaluation)) throw new Error("the evaluation is signed; weighing its findings again would change what was signed");
  // The step reads the findings under their defect; an evaluation from before the grouping gets its defects from "evaluate".
  if (!evaluation.defects) throw new Error('the evaluation has no defects yet; run "evaluate" on this run first');
  const result = await weighInto(runDir, evaluation);
  // A weighing changes the report; the summary for the leadership counts again only when the report is the same.
  const { summaryInto, summaryLineNl } = await import("./summarize.ts");
  const summarized = await summaryInto(runDir, evaluation);
  if (summarized.summary === "stale") process.stderr.write(`${summaryLineNl(summarized)}\n`);
  await writeEvaluation(path, evaluation);
  await writeManifest(runDir, { command: "weigh", startedAt, findings: result.findings, weighing: result.weighing });
  return result;
}

/** Validate the weighing against the findings as they are now; one that passes is stamped. */
export async function checkWeigh(runDir: string): Promise<string[]> {
  const evaluation = await readJson<Evaluation>(join(runDir, "evaluation.json"));
  // The input never holds a severity, so an evaluation that was weighed before gives the same input.
  const input = weighingInput(evaluation);
  if (!existsSync(join(runDir, INPUT)) || canonicalJson(await readJson(join(runDir, INPUT))) !== canonicalJson(input)) return [`${INPUT} does not match the evaluation; run "weigh" first`];
  let proposal: unknown;
  try {
    proposal = await readJson<unknown>(join(runDir, PROPOSAL));
  } catch (error) {
    return [`cannot read ${PROPOSAL}: ${(error as Error).message}`];
  }
  const problems = validateWeighing(proposal, evaluation);
  if (problems.length === 0) await writeJson(join(runDir, STAMP), { ...(await currentStamp(runDir, sha256(canonicalJson(input)))), stampedAt: new Date().toISOString() });
  return problems;
}
