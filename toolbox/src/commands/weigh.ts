import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import type { Evaluation } from "../lib/evaluation.ts";
import { GROUPS } from "../lib/groups.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { readTemplate } from "../lib/templates.ts";
import { applyWeighing, clearWeighing, TASKS_MAX, TASKS_MIN, validateWeighing, weighingInput, WORDS_MAX, WORDS_MIN, type WeighingProposal } from "../lib/weighing.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { readEvaluation, signatureIsCurrent, writeEvaluation } from "./sign.ts";

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
  weighing: "not-run" | "applied";
  raised: number;
  lowered: number;
  same: number;
  noEffect: number;
  unsure: number;
  task: string;
}

function template(): string {
  return readTemplate("weeg");
}

async function currentStamp(runDir: string, inputSha256: string): Promise<Omit<WeighStamp, "stampedAt"> | null> {
  if (!existsSync(join(runDir, PROPOSAL)) || !existsSync(join(runDir, TASK))) return null;
  return { inputSha256, promptSha256: await sha256File(join(runDir, TASK)), proposalSha256: await sha256File(join(runDir, PROPOSAL)) };
}

async function weighingIsCurrent(runDir: string, inputSha256: string): Promise<boolean> {
  if (!existsSync(join(runDir, STAMP))) return false;
  const { stampedAt: _stampedAt, ...stamp } = await readJson<WeighStamp>(join(runDir, STAMP));
  const expected = await currentStamp(runDir, inputSha256);
  return expected !== null && canonicalJson(stamp) === canonicalJson(expected);
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
    check: `node ${cli} check-weigh --run ${absoluteRun}`,
    findings: String(evaluation.criteria.reduce((total, criterion) => total + criterion.findings.length, 0)),
    groups: GROUPS.map((group) => `- **${group.id}**: ${group.labelNl}. ${group.howNl}`).join("\n"),
    tasksMin: String(TASKS_MIN),
    tasksMax: String(TASKS_MAX),
    wordsMin: String(WORDS_MIN),
    wordsMax: String(WORDS_MAX),
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
  if (!(await weighingIsCurrent(runDir, inputSha256))) return none;
  const proposal = await readJson<WeighingProposal>(join(runDir, PROPOSAL));
  const counts = applyWeighing(evaluation, proposal);
  evaluation.weighing = { status: "applied", templateSha256: sha256(template()), proposalSha256: await sha256File(join(runDir, PROPOSAL)), tasks: proposal.tasks.map((task) => ({ id: task.id, nameNl: task.nameNl.trim() })), ...counts };
  return { ...none, weighing: "applied", ...counts };
}

/** Run the step on an evaluation that exists already, after the weighing was validated. */
export async function weigh(runDir: string): Promise<WeighResult> {
  const startedAt = stepStart();
  const path = join(runDir, "evaluation.json");
  const evaluation = await readEvaluation(path);
  // The severities are part of what is signed; changing them would quietly turn the report back into a concept.
  if (signatureIsCurrent(evaluation)) throw new Error("the evaluation is signed; weighing its findings again would change what was signed");
  const result = await weighInto(runDir, evaluation);
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
