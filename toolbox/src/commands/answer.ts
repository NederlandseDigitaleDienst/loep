import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256File, writeJson } from "../lib/canonical.ts";
import type { RecordedVia } from "../lib/recorded.ts";
import { ANSWER_OUTCOMES, type AnswerOutcome, OUTCOME_LABEL, type PointAnswer } from "../lib/evaluation.ts";
import { openPoint, type Verdict } from "../lib/verdict.ts";
import { instrumentVerdictIsCurrent, isInstrumentRun, loadInstrumentIndex, loadObservations, NO_TASKS_NL, pointsToFinish, skipped, standingVerdict, type InstrumentTask } from "./instrument-tasks.ts";

/*
 * What only a person can establish, a person records. An open point of the kind "mens nodig"
 * or "keuze nodig" is no work for an instrument: somebody listens with a screen reader, or the
 * owner decides. This command keeps that answer in the run, next to the verdict it belongs to.
 * A point "versturen niet toegestaan" needs no person: a run with a declared test environment
 * measures it. A person may still answer it, by sending by hand and saying what was sent where.
 * Nothing here is ever made up by an agent: the answer is what the person said. The agent may
 * record it in the conversation, after the person said yes to a repetition of it (`recordedVia`).
 */

/** Where the answers of a run are kept: one file per criterion. Inside the seal, like every other piece of evidence. */
export const ANSWERS_DIR = "antwoorden";
const answersFile = (criterion: string): string => join(ANSWERS_DIR, `${criterion}.json`);

/** Said before a name is asked for and after it is stored, so nobody finds their name somewhere they did not expect. */
export const ANSWER_PRIVACY_NL = `de naam staat alleen in ${ANSWERS_DIR}/<criterium>.json in de map van de run; evaluation.json, het rapport en de verklaring noemen alleen de functie. Het bestand valt onder het zegel. Wie de map van de run deelt of publiceert, deelt ook de naam`;

const MIN_DID = 20;

/** An answer as the run keeps it: with the name of who gave it, and the verdict it answers. */
export interface StoredAnswer extends PointAnswer {
  name: string;
  /** The verdict whose open point this answers: an answer to another verdict does not count. */
  verdict: { round: "final" | "finish"; sha256: string };
}

interface AnswerFile {
  criterion: string;
  answers: StoredAnswer[];
}

/** The verdict of an agent that counts for a criterion: that of the finishing round when there is one, otherwise that of the verifier. */
export interface CountingVerdict {
  round: "final" | "finish";
  verdict: Verdict;
  sha256: string;
}

export async function countingVerdict(runDir: string, task: InstrumentTask, observations = loadObservations(runDir)): Promise<CountingVerdict | null> {
  for (const [round, part] of [["finish", task.finish ?? null], ["final", task.verify]] as const) {
    if (!part || !(await instrumentVerdictIsCurrent(runDir, task, round, observations))) continue;
    const path = join(runDir, part.output);
    return { round, verdict: await readJson<Verdict>(path), sha256: await sha256File(path) };
  }
  return null;
}

/** The answers of a run to the open points of one verdict, without the names: what an evaluation may carry. `stale` counts answers that were given to an earlier verdict. */
export async function loadAnswers(runDir: string, criterion: string, counting: CountingVerdict | null): Promise<{ answers: PointAnswer[]; stale: number }> {
  const path = join(runDir, answersFile(criterion));
  if (!existsSync(path)) return { answers: [], stale: 0 };
  const stored = (await readJson<AnswerFile>(path)).answers ?? [];
  const current = stored.filter((answer) => counting !== null && answer.verdict?.sha256 === counting.sha256);
  return { answers: current.map(({ pointNl, didNl, outcome, role, answeredAt, recordedVia }) => ({ pointNl, didNl, outcome, role, answeredAt, ...(recordedVia ? { recordedVia } : {}) })), stale: stored.length - current.length };
}

export interface AnswerOptions {
  run: string;
  criterion: string;
  /** The number of the open point, counted from 1. Without it the open points are only listed. */
  point?: number | undefined;
  /** What the person did or decided. */
  did?: string | undefined;
  outcome?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  recordedVia?: RecordedVia | undefined;
}

export interface AnswerResult {
  /** The open points of the criterion, each with whether it has an answer. */
  points: { number: number; kindNl: string; textNl: string; answered: AnswerOutcome | null }[];
  /** The file the answer was written to; null when the points were only listed. */
  written: string | null;
  /** Points that still have no answer after this one. */
  left: number;
}

/**
 * List the open points of a criterion, or record the answer of a person to one of them. The
 * answer counts at the next `evaluate`: a point a person found failing fails the criterion, and
 * a criterion whose every open point is answered gets an outcome.
 */
export async function answer(options: AnswerOptions): Promise<AnswerResult> {
  if (!isInstrumentRun(options.run)) throw new Error(NO_TASKS_NL);
  const index = await loadInstrumentIndex(options.run);
  const task = index.tasks.find((entry) => entry.criterion === options.criterion);
  if (!task) throw new Error(`criterium ${options.criterion} is in deze run niet beoordeeld`);
  const observations = loadObservations(options.run);
  const counting = await countingVerdict(options.run, task, observations);
  if (!counting) throw new Error(`criterium ${options.criterion} heeft nog geen geldig eindoordeel: een antwoord hoort bij een open punt van een oordeel`);
  const missing = counting.verdict.missingNl ?? [];
  if (counting.verdict.outcome !== "cantTell" || missing.length === 0) throw new Error(`criterium ${options.criterion} heeft de uitkomst "${OUTCOME_LABEL[counting.verdict.outcome]}" en geen open punt om te beantwoorden`);
  // What the evaluation itself left open is first for the finishing round: a person answers what no instrument could.
  const finishing = counting.round === "final" && pointsToFinish(await standingVerdict(options.run, task, observations)) !== null;
  const givenUp = task.finish ? skipped(options.run, task.finish.output) : false;
  if (finishing && !givenUp) throw new Error(`criterium ${options.criterion} bleef open door het onderzoek zelf en heeft nog geen afmaakronde gehad: draai tasks en pending, en laat de afmaakronde eerst meten wat een instrument kan meten`);

  const path = join(options.run, answersFile(options.criterion));
  const file: AnswerFile = existsSync(path) ? await readJson<AnswerFile>(path) : { criterion: options.criterion, answers: [] };
  // An answer to an earlier verdict says nothing about this one.
  const kept = (file.answers ?? []).filter((entry) => entry.verdict?.sha256 === counting.sha256);
  const listing = (answers: StoredAnswer[]): AnswerResult["points"] =>
    missing.map((point, position) => {
      const { kind, textNl } = openPoint(point);
      return { number: position + 1, kindNl: kind?.prefix ?? "zonder soort", textNl, answered: answers.find((entry) => entry.pointNl === point)?.outcome ?? null };
    });
  if (options.point === undefined) return { points: listing(kept), written: null, left: listing(kept).filter((point) => point.answered === null).length };

  const point = missing[options.point - 1];
  if (!Number.isInteger(options.point) || point === undefined) throw new Error(`--point is het nummer van een open punt: 1 tot en met ${missing.length} (zonder --point toont het commando de punten)`);
  if ((options.did ?? "").trim().length < MIN_DID) throw new Error("--did zegt wat de persoon heeft gedaan of besloten, in een hele zin: waarmee, op welke pagina, en wat eruit kwam");
  if (!(ANSWER_OUTCOMES as readonly string[]).includes(options.outcome ?? "")) throw new Error(`--outcome is de uitkomst voor het criterium op dit punt: ${ANSWER_OUTCOMES.join(", ")}`);
  if (!options.name?.trim() || !options.role?.trim()) throw new Error(`--name en --role zeggen wie dit heeft vastgesteld en in welke functie: ${ANSWER_PRIVACY_NL}`);

  const entry: StoredAnswer = {
    pointNl: point,
    didNl: options.did!.replace(/\s+/g, " ").trim(),
    outcome: options.outcome as AnswerOutcome,
    role: options.role.trim(),
    name: options.name.trim(),
    answeredAt: new Date().toISOString(),
    ...(options.recordedVia ? { recordedVia: options.recordedVia } : {}),
    verdict: { round: counting.round, sha256: counting.sha256 },
  };
  // A second answer to the same point takes the place of the first.
  const answers = [...kept.filter((earlier) => earlier.pointNl !== point), entry].sort((a, b) => missing.indexOf(a.pointNl) - missing.indexOf(b.pointNl));
  await writeJson(path, { criterion: options.criterion, answers } satisfies AnswerFile);
  const points = listing(answers);
  return { points, written: answersFile(options.criterion), left: points.filter((entry) => entry.answered === null).length };
}
