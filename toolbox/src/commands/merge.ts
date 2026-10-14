import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { applyProposal, carryDefectIds, MERGE_RULES_VERSION, mergeFindings, proposalInput, validateProposal, type Defect, type MergeProposal } from "../lib/defects.ts";
import type { Evaluation } from "../lib/evaluation.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { TEMPLATES_DIR } from "../lib/procedures.ts";
import { readEvaluation, signatureIsCurrent, writeEvaluation } from "./sign.ts";

const TASK = join("tasks", "samenvoeg", "taak.md");
const INPUT = join("tasks", "samenvoeg", "invoer.json");
const PROPOSAL = join("verdicts", "samenvoeg.json");
const STAMP = join("verdicts", "samenvoeg.stamp.json");

/** Proof of what a proposal was validated against; one that no longer matches is not applied. */
interface MergeStamp {
  inputSha256: string;
  promptSha256: string;
  proposalSha256: string;
  stampedAt: string;
}

export interface MergeResult {
  findings: number;
  criteria: number;
  /** Defects after the fixed rules alone. */
  byRules: number;
  /** Defects in the evaluation: after the proposal when one was applied. */
  defects: number;
  proposal: "not-run" | "applied";
  task: string;
}

function template(): string {
  return readFileSync(join(TEMPLATES_DIR, "samenvoeg.md"), "utf8");
}

async function currentStamp(runDir: string, inputSha256: string): Promise<Omit<MergeStamp, "stampedAt"> | null> {
  if (!existsSync(join(runDir, PROPOSAL)) || !existsSync(join(runDir, TASK))) return null;
  return { inputSha256, promptSha256: await sha256File(join(runDir, TASK)), proposalSha256: await sha256File(join(runDir, PROPOSAL)) };
}

async function proposalIsCurrent(runDir: string, inputSha256: string): Promise<boolean> {
  if (!existsSync(join(runDir, STAMP))) return false;
  const { stampedAt: _stampedAt, ...stamp } = await readJson<MergeStamp>(join(runDir, STAMP));
  const expected = await currentStamp(runDir, inputSha256);
  return expected !== null && canonicalJson(stamp) === canonicalJson(expected);
}

/** Write the input and the fixed prompt for the optional second step. Nothing here decides anything. */
async function writeTask(runDir: string, evaluation: Evaluation, byRules: Defect[]): Promise<string> {
  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const inputSha256 = await writeJson(join(runDir, INPUT), proposalInput(evaluation, byRules));
  const values: Record<string, string> = {
    site: evaluation.site.name,
    input: join(absoluteRun, INPUT),
    output: join(absoluteRun, PROPOSAL),
    check: `node ${cli} check-merge --run ${absoluteRun}`,
    findings: String(evaluation.criteria.reduce((total, criterion) => total + criterion.findings.length, 0)),
    defects: String(byRules.length),
  };
  const text = template().replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
  await writeFileAtomic(join(runDir, TASK), text);
  // The agent writes its proposal here; the directory has to exist before it does.
  await mkdir(join(runDir, "verdicts"), { recursive: true });
  return inputSha256;
}

/**
 * Group the findings of an evaluation into defects. The fixed rules always run. A proposal
 * of the second step counts only when it was validated against exactly these findings and
 * this prompt; without one the result of the rules stands and the evaluation says so.
 */
export async function mergeInto(runDir: string, evaluation: Evaluation, previous?: Evaluation): Promise<MergeResult> {
  const byRules = mergeFindings(evaluation);
  const inputSha256 = await writeTask(runDir, evaluation, byRules);
  let defects = byRules;
  evaluation.merge = { rulesVersion: MERGE_RULES_VERSION, proposal: { status: "not-run" } };
  if (await proposalIsCurrent(runDir, inputSha256)) {
    const proposal = await readJson<MergeProposal>(join(runDir, PROPOSAL));
    const applied = applyProposal(evaluation, byRules, proposal);
    defects = applied.defects;
    evaluation.merge.proposal = { status: "applied", templateSha256: sha256(template()), proposalSha256: await sha256File(join(runDir, PROPOSAL)), joined: applied.joined, mainOverridden: applied.mainOverridden };
  }
  if (previous?.defects) carryDefectIds(defects, previous.defects);
  evaluation.defects = defects;
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  return { findings: findings.length, criteria: new Set(findings.map((finding) => finding.criterion)).size, byRules: byRules.length, defects: defects.length, proposal: evaluation.merge.proposal.status, task: join(runDir, TASK) };
}

/** Run the step on an evaluation that exists already, for instance after the proposal was validated. */
export async function merge(runDir: string, previousPath?: string): Promise<MergeResult> {
  const startedAt = stepStart();
  const path = join(runDir, "evaluation.json");
  const evaluation = await readEvaluation(path);
  // Defects are part of what is signed; changing them would quietly turn the report back into a concept.
  if (signatureIsCurrent(evaluation)) throw new Error("the evaluation is signed; grouping its findings again would change what was signed");
  const result = await mergeInto(runDir, evaluation, previousPath ? await readJson<Evaluation>(previousPath) : evaluation);
  await writeEvaluation(path, evaluation);
  await writeManifest(runDir, { command: "merge", startedAt, findings: result.findings, defects: result.defects, proposal: result.proposal });
  return result;
}

/** Validate the proposal of the second step against the findings as they are now; a proposal that passes is stamped. */
export async function checkMerge(runDir: string): Promise<string[]> {
  const evaluation = await readJson<Evaluation>(join(runDir, "evaluation.json"));
  const byRules = mergeFindings(evaluation);
  const input = proposalInput(evaluation, byRules);
  if (!existsSync(join(runDir, INPUT)) || canonicalJson(await readJson(join(runDir, INPUT))) !== canonicalJson(input)) return [`${INPUT} does not match the evaluation; run "merge" first`];
  let proposal: unknown;
  try {
    proposal = await readJson<unknown>(join(runDir, PROPOSAL));
  } catch (error) {
    return [`cannot read ${PROPOSAL}: ${(error as Error).message}`];
  }
  const problems = validateProposal(proposal, evaluation, byRules);
  if (problems.length === 0) await writeJson(join(runDir, STAMP), { ...(await currentStamp(runDir, sha256(canonicalJson(input)))), stampedAt: new Date().toISOString() });
  return problems;
}
