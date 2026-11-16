/**
 * `summarize` and `check-summary`: the summary for the leadership at the top of the report. One
 * agent reads the report as text and writes a few paragraphs; a check holds them to the report;
 * only a summary that passed, for exactly this report and this task, is put into the evaluation.
 * The pattern is the one of the weighing (`weigh`, `check-weigh`).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import type { Evaluation } from "../lib/evaluation.ts";
import { clearSummary, readingSentences, SUMMARY_PARAGRAPHS_MAX, SUMMARY_PARAGRAPHS_MIN, SUMMARY_PARTS, SUMMARY_WORDS_MAX, validateReading, validateSummary, type SummaryProposal, type SummaryReading, type SummaryStaleReason } from "../lib/executive-summary.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { cleanModel } from "../lib/models.ts";
import { deriveReport, summarySourceText } from "../lib/report-markdown.ts";
import { readTemplate } from "../lib/templates.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { readEvaluation, signatureIsCurrent, writeEvaluation } from "./sign.ts";

const TASK = join("tasks", "samenvatting", "taak.md");
const SOURCE = join("tasks", "samenvatting", "rapport.md");
const PROPOSAL = join("verdicts", "samenvatting.json");
const STAMP = join("verdicts", "samenvatting.stamp.json");
const READ_TASK = join("tasks", "samenvatting", "lees.md");
const READING = join("verdicts", "samenvatting-lezing.json");
const WORK = "samenvatting";
const READ_WORK = "samenvatting-lezer";

/** Proof of what a summary was checked against; one that no longer matches is not in the report. */
interface SummaryStamp {
  sourceSha256: string;
  promptSha256: string;
  proposalSha256: string;
  stampedAt: string;
}

export interface SummarizeResult {
  /** "stale": there is a summary, but it is not in the report; `reason` says why. */
  summary: "not-run" | "stale" | "applied";
  reason?: SummaryStaleReason;
  /** The task of the writer. */
  task: string;
  /** The task of the second reader, once a summary passed the check. */
  readTask?: string;
  /** How many sentences the second reader did not find in the report. */
  refuted?: number;
}

const STALE_NL: Record<SummaryStaleReason, string> = {
  unchecked: "Er staat een samenvatting die check-summary niet heeft goedgekeurd, of die daarna is gewijzigd.",
  report: "De samenvatting is geschreven voor een rapport dat sindsdien is veranderd.",
  task: "De samenvatting is geschreven met een andere versie van de opdracht.",
  unread: "De samenvatting doorstond check-summary, maar een tweede lezer heeft haar nog niet naast dit rapport gelegd.",
  refuted: "De tweede lezer vond in de samenvatting iets wat het rapport niet draagt.",
};

/** What a command says about the summary after it ran, in one line. */
export function summaryLineNl(result: SummarizeResult): string {
  if (result.summary === "applied") return "samenvatting voor de leiding toegepast: het rapport opent ermee";
  if (result.summary === "not-run") return `samenvatting voor de leiding niet geschreven: het rapport opent met de zin van loep; de opdracht staat in ${result.task}`;
  const reason = result.reason ?? "report";
  const next =
    reason === "unchecked" ? "Draai check-summary"
    : reason === "unread" ? `Start een nieuwe agent, niet de schrijver, met ${result.readTask}, en draai daarna summarize opnieuw`
    : reason === "refuted" ? `Het gaat om ${result.refuted === 1 ? "1 zin" : `${result.refuted} zinnen`}; wat de lezer vond staat in ${READING}. Laat de schrijver haar herstellen met ${result.task}`
    : `Laat haar opnieuw schrijven; de opdracht staat in ${result.task}`;
  return `${STALE_NL[reason]} Ze staat niet in het rapport. ${next}`;
}

/** The CLI as the task names it: `node`, then the path of any installation up to its `src/cli.ts`. */
const CLI_IN_TASK = /node [^\n`]*?[\\/]src[\\/]cli\.ts/g;

/** The hash of the task as the agent got it, without the paths of this run and of the installation: a run that was moved has the same task. */
async function taskSha256(runDir: string): Promise<string> {
  const text = await readFile(join(runDir, TASK), "utf8");
  return sha256(text.split(resolve(runDir)).join("<run>").replace(CLI_IN_TASK, "node <cli>"));
}

/** The defects by which a group is stopped at a core task, as the report names them. */
const stoppingDefects = (evaluation: Evaluation): string[] => (deriveReport(evaluation).weighing?.stopped ?? []).flatMap((task) => task.causes.flatMap((cause) => cause.defects.map((defect) => defect.id)));

async function standing(runDir: string, sourceSha256: string): Promise<"none" | "current" | SummaryStaleReason> {
  if (!existsSync(join(runDir, PROPOSAL))) return "none";
  if (!existsSync(join(runDir, STAMP))) return "unchecked";
  const stamp = await readJson<SummaryStamp>(join(runDir, STAMP));
  if (stamp.proposalSha256 !== (await sha256File(join(runDir, PROPOSAL)))) return "unchecked";
  if (stamp.sourceSha256 !== sourceSha256) return "report";
  return stamp.promptSha256 === (await taskSha256(runDir)) ? "current" : "task";
}

/** Write the report as the writer reads it, and the task. Nothing here decides anything. */
async function writeTask(runDir: string, evaluation: Evaluation): Promise<string> {
  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const source = summarySourceText(evaluation);
  const sourceSha256 = sha256(source);
  await mkdir(join(runDir, "tasks", "samenvatting"), { recursive: true });
  await writeFileAtomic(join(runDir, SOURCE), source);
  const values: Record<string, string> = {
    site: evaluation.site.name,
    source: join(absoluteRun, SOURCE),
    reportSha256: sourceSha256,
    output: join(absoluteRun, PROPOSAL),
    check: `node ${cli} check-summary --run ${absoluteRun}`,
    reading: join(absoluteRun, READING),
    wordsMax: String(SUMMARY_WORDS_MAX),
    paragraphsMin: String(SUMMARY_PARAGRAPHS_MIN),
    paragraphsMax: String(SUMMARY_PARAGRAPHS_MAX),
    parts: Object.entries(SUMMARY_PARTS).map(([id, meaning]) => `- \`${id}\`: ${meaning}`).join("\n"),
    workDir: await makeWorkDir(runDir, WORK),
  };
  const text = readTemplate("samenvat").replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
  await writeFileAtomic(join(runDir, TASK), text);
  await mkdir(join(runDir, "verdicts"), { recursive: true });
  return sourceSha256;
}

/** Write the task of the second reader: the sentences of a summary that passed the check, and what they are held to. */
async function writeReadTask(runDir: string, evaluation: Evaluation, proposal: SummaryProposal, sourceSha256: string): Promise<void> {
  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const values: Record<string, string> = {
    site: evaluation.site.name,
    source: join(absoluteRun, SOURCE),
    sentences: readingSentences(proposal).map((sentence, index) => `${index + 1}. ${sentence}`).join("\n"),
    output: join(absoluteRun, READING),
    reportSha256: sourceSha256,
    proposalSha256: await sha256File(join(runDir, PROPOSAL)),
    taskSha256: sha256(readTemplate("samenvat-lees")),
    check: `node ${cli} check-reading --run ${absoluteRun}`,
    workDir: await makeWorkDir(runDir, READ_WORK),
  };
  const text = readTemplate("samenvat-lees").replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
  await writeFileAtomic(join(runDir, READ_TASK), text);
}

/** The reading that stands for this summary and this report, held to both; null when there is none that counts. */
async function standingReading(runDir: string, proposal: SummaryProposal, source: string): Promise<{ reading: SummaryReading; problems: string[]; refuted: { n: number; sentence: string; noteNl: string }[] } | null> {
  if (!existsSync(join(runDir, READING))) return null;
  let reading: SummaryReading;
  try {
    reading = await readJson<SummaryReading>(join(runDir, READING));
  } catch (error) {
    return { reading: { sentences: [] }, problems: [`${READING} is niet te lezen: ${(error as Error).message}`], refuted: [] };
  }
  const problems: string[] = [];
  if (reading?.reportSha256 !== sha256(source)) problems.push(`het oordeel is over een ander rapport dan dat van nu: reportSha256 is niet ${sha256(source)}`);
  if (reading?.proposalSha256 !== (await sha256File(join(runDir, PROPOSAL)))) problems.push("het oordeel is over een andere tekst van de samenvatting dan die er nu staat: proposalSha256 klopt niet");
  if (reading?.taskSha256 !== sha256(readTemplate("samenvat-lees"))) problems.push(`het oordeel is gemaakt met een andere versie van de opdracht dan die van nu: taskSha256 is niet ${sha256(readTemplate("samenvat-lees"))}. Lees ${READ_TASK} opnieuw en oordeel opnieuw`);
  const held = validateReading(reading, readingSentences(proposal), source);
  return { reading, problems: [...problems, ...held.problems], refuted: held.refuted };
}

/**
 * Put the summary into an evaluation, when one stands that was checked against exactly this
 * report and this task. The task is always written, so whoever leads the run can start the writer.
 * Without a summary that counts the evaluation has none, and the report opens as loep writes it.
 */
export async function summaryInto(runDir: string, evaluation: Evaluation): Promise<SummarizeResult> {
  clearSummary(evaluation);
  const none = { summary: "not-run" as const, task: join(runDir, TASK) };
  const sourceSha256 = await writeTask(runDir, evaluation);
  const state = await standing(runDir, sourceSha256);
  if (state === "none") return none;
  if (state !== "current") {
    evaluation.executiveSummary = { status: "stale", reason: state };
    return { ...none, summary: "stale", reason: state };
  }
  const proposal = await readJson<SummaryProposal>(join(runDir, PROPOSAL));
  // The stamp says a check passed once; the check of this version of loep is the one that counts, and it is cheap.
  if (proposal.reportSha256 !== sourceSha256) {
    evaluation.executiveSummary = { status: "stale", reason: "report" };
    return { ...none, summary: "stale", reason: "report" };
  }
  if (validateSummary(proposal, evaluation, summarySourceText(evaluation), stoppingDefects(evaluation)).length > 0) {
    evaluation.executiveSummary = { status: "stale", reason: "unchecked" };
    return { ...none, summary: "stale", reason: "unchecked" };
  }
  // A second reader holds every sentence to the report; the check above cannot see what a sentence means.
  await writeReadTask(runDir, evaluation, proposal, sourceSha256);
  const readTask = join(runDir, READ_TASK);
  const read = await standingReading(runDir, proposal, summarySourceText(evaluation));
  if (!read || read.problems.length > 0) {
    evaluation.executiveSummary = { status: "stale", reason: "unread" };
    return { ...none, summary: "stale", reason: "unread", readTask };
  }
  if (read.refuted.length > 0) {
    evaluation.executiveSummary = { status: "stale", reason: "refuted" };
    return { ...none, summary: "stale", reason: "refuted", readTask, refuted: read.refuted.length };
  }
  const model = cleanModel(proposal.model);
  const readerModel = cleanModel(read.reading.model);
  evaluation.executiveSummary = {
    status: "applied",
    paragraphs: proposal.paragraphs.map((paragraph) => paragraph.textNl.trim()),
    sources: proposal.paragraphs.map((paragraph) => paragraph.sources),
    ...(model ? { model } : {}),
    ...(readerModel ? { readerModel } : {}),
    templateSha256: sha256(readTemplate("samenvat")),
    proposalSha256: await sha256File(join(runDir, PROPOSAL)),
    readingSha256: await sha256File(join(runDir, READING)),
  };
  return { ...none, summary: "applied" };
}

/** Run the step on an evaluation that exists already: write the task, and apply a summary that was checked. */
export async function summarize(runDir: string): Promise<SummarizeResult> {
  const startedAt = stepStart();
  const path = join(runDir, "evaluation.json");
  const evaluation = await readEvaluation(path);
  // The summary is part of the report that was signed; writing another would quietly turn it back into a concept.
  if (signatureIsCurrent(evaluation)) throw new Error("het rapport is afgetekend; een andere samenvatting zou veranderen wat is getekend");
  const result = await summaryInto(runDir, evaluation);
  await writeEvaluation(path, evaluation);
  await writeManifest(runDir, { command: "summarize", startedAt, summary: result.summary });
  return result;
}

/** Hold the summary to the report as it is now; one that passes is stamped. */
export async function checkSummary(runDir: string): Promise<string[]> {
  const evaluation = await readEvaluation(join(runDir, "evaluation.json"));
  const source = summarySourceText(evaluation);
  if (!existsSync(join(runDir, SOURCE)) || (await readFile(join(runDir, SOURCE), "utf8")) !== source) return [`${SOURCE} is niet het rapport van deze evaluatie; draai eerst summarize`];
  let proposal: unknown;
  try {
    proposal = await readJson<unknown>(join(runDir, PROPOSAL));
  } catch (error) {
    return [`${PROPOSAL} is niet te lezen: ${(error as Error).message}`];
  }
  // A summary written from another report is not held to this one: the numbers may fit by chance, the rest was never read against it.
  if ((proposal as SummaryProposal | null)?.reportSha256 !== sha256(source)) return [`de samenvatting is geschreven voor een ander rapport dan dat van nu: reportSha256 is niet ${sha256(source)}. Lees ${SOURCE} opnieuw, schrijf de samenvatting opnieuw en neem reportSha256 over uit de opdracht`];
  const problems = validateSummary(proposal, evaluation, source, stoppingDefects(evaluation));
  if (problems.length > 0) return problems;
  const stamp = { sourceSha256: sha256(source), promptSha256: await taskSha256(runDir), proposalSha256: await sha256File(join(runDir, PROPOSAL)) };
  // A stamp that says the same already is left as it is: the file is under the seal of the run.
  if (existsSync(join(runDir, STAMP))) {
    const standingStamp = await readJson<SummaryStamp>(join(runDir, STAMP));
    if (standingStamp.sourceSha256 === stamp.sourceSha256 && standingStamp.promptSha256 === stamp.promptSha256 && standingStamp.proposalSha256 === stamp.proposalSha256) return [];
  }
  if (signatureIsCurrent(evaluation)) return ["het rapport is afgetekend; een nieuwe controle zou veranderen wat is getekend"];
  await writeJson(join(runDir, STAMP), { ...stamp, stampedAt: new Date().toISOString() } satisfies SummaryStamp);
  return [];
}

/**
 * Hold the reading of the second reader to the summary and the report. `problems` are faults in the
 * reading itself; `refuted` are the sentences the reader did not find in the report, which is a
 * valid outcome: the summary then stays out of the report until it is repaired. Writes nothing.
 */
export async function checkReading(runDir: string): Promise<{ problems: string[]; refuted: { n: number; sentence: string; noteNl: string }[] }> {
  const evaluation = await readEvaluation(join(runDir, "evaluation.json"));
  const source = summarySourceText(evaluation);
  if (!existsSync(join(runDir, PROPOSAL))) return { problems: [`${PROPOSAL} ontbreekt; er is geen samenvatting om te lezen`], refuted: [] };
  const proposal = await readJson<SummaryProposal>(join(runDir, PROPOSAL));
  const read = await standingReading(runDir, proposal, source);
  if (!read) return { problems: [`${READING} ontbreekt`], refuted: [] };
  return { problems: read.problems, refuted: read.refuted };
}
