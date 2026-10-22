import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { REPLAY_TASK_NL } from "../lib/recordings.ts";
import { join, resolve } from "node:path";
import { EXTENSION, extensionsOf, finishBudget, judgeBudget, verifyBudget, walkBudget, type Coverage } from "../lib/budget.ts";
import { canonicalJson, pageLabels, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { buildDossier } from "../lib/dossier.ts";
import { dossierReads, nameOf, readsOfSession, requiredParts, unreadPartsProblems } from "../lib/dossier-view.ts";

/** The parts of a dossier the criterion counts on, as a task names them: `controls`, `images` en `siteStates`. */
function dossierPartsNl(dossier: Record<string, unknown>): string {
  const names = requiredParts(dossier).map((path) => `\`${nameOf(dossier, path)}\``);
  if (names.length === 0) return "geen";
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} en ${names.at(-1)}`;
}

const dossierPartsOfFile = (runDir: string, path: string): string => dossierPartsNl(JSON.parse(readFileSync(join(runDir, path), "utf8")) as Record<string, unknown>);
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { loadAllProcedures, type Procedure } from "../lib/procedures.ts";
import { readTemplate } from "../lib/templates.ts";
import { loadRun, type RunData } from "../lib/rundata.ts";
import {
  canonicalCommand,
  citedObservations,
  failedEngineRules,
  FINISH_FACTOR,
  frameFocusProblems,
  indexObservations,
  KINDS_FOR_AGAIN,
  MEASURE_COMMANDS,
  notSentPointProblems,
  openPoint,
  rowsToExplain,
  searchableText,
  validateCandidates,
  validateFinish,
  validateJudgeVerdict,
  validateVerification,
  type Candidate,
  type CandidateList,
  type CrossCandidate,
  type CrossLoop,
  type ObservationIndex,
  type ObservationRecordLike,
  type Verdict,
} from "../lib/verdict.ts";
import { CRITERIA, criterionById } from "../lib/wcag.ts";
import { agentLoginNl } from "../lib/login.ts";
import { readsAllowedNl } from "../lib/reads.ts";
import { criterionSender, DEFAULT_MAX_WRITES, DEFAULT_WRITE_SPACING_SECONDS, reservedNl, reservedWrites, spacingNl, WRITES_BLOCKED_NL, writeBudget, writesAllowedNl, writesForRun } from "../lib/writes.ts";
import { sweepCandidates } from "../lib/statusmessages.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { siteHosts, siteLabel } from "../lib/origins.ts";

/*
 * The flow of a run with a site model: an agent walks every page type and leaves candidates,
 * one judge per criterion works from the dossier with instruments, and a verifier reproduces
 * every finding and writes the final verdict. What the evaluation itself then still left open
 * (coverage that was missing, a budget that ran out, a probe that did not work, a verdict that
 * never came) goes to a finishing round: one more agent per such criterion, with a budget of
 * its own. Nothing here judges anything: it writes task files, routes candidates between them,
 * and checks what comes back.
 */

export const INSTRUMENT_FLOW = "instrumenten";

export const BUDGETS = {
  walk: { commands: 110, minutes: 40 },
  judge: { commands: 80, minutes: 30 },
  /** The verifier's commands grow with what there is to reproduce. */
  verify: { base: 20, perFinding: 5, perDismissedCandidate: 3, afterPass: 30, minutes: 30 },
  /** The finishing round: the budget of a judge times `FINISH_FACTOR`, so it follows when a judge gets more or less. */
  get finish(): { commands: number; minutes: number } {
    return { commands: Math.round(this.judge.commands * FINISH_FACTOR), minutes: Math.round(this.judge.minutes * FINISH_FACTOR) };
  },
};

/** The rounds that write a verdict: the judge, the verifier (the final verdict) and the finishing round. */
export const ROUNDS = ["judge", "final", "finish"] as const;
export type Round = (typeof ROUNDS)[number];

export interface WalkTask {
  pageType: string;
  /** Label of the page that is walked. */
  page: string;
  prompt: string;
  output: string;
  session: string;
  maxCommands: number;
  maxMinutes: number;
}

export interface InstrumentTask {
  criterion: string;
  titleNl: string;
  procedureVersion: number;
  procedureSha256: string;
  dossier: string;
  dossierSha256: string;
  passCommands: string[];
  decisiveCommands: string[];
  /** The recommendation rules of the procedure. Absent in an index from before recommendations existed: then none. */
  recommendationRules?: string[];
  /** The lists in the dossier whose rows a pass explains one by one (`pass_explains`). Absent in an index from before: then none. */
  passExplains?: string[];
  judge: { prompt: string; output: string; candidates: string; session: string; maxCommands: number; maxMinutes: number };
  /** Written once every judge verdict of the run is in: only then is it known what other criteria hand over. */
  verify: { prompt: string; output: string; candidates: string; session: string; maxCommands: number; maxMinutes: number } | null;
  /**
   * Written once every verifier is in, and only for a criterion the evaluation itself left open.
   * `points` are the open points the task lists, in that order: the verdict accounts for each.
   * Absent in an index from before the finishing round existed.
   */
  finish?: {
    prompt: string;
    output: string;
    candidates: string;
    session: string;
    maxCommands: number;
    maxMinutes: number;
    points: string[];
    /** The verdicts of earlier finishing rounds of this criterion, oldest first, kept when the round ran again with `--again`. Absent when it ran once. */
    earlier?: string[];
    /** Asked for with `--again`: its points stay as they were asked for, and it also gets what other finishing rounds passed on. */
    again?: true;
  } | null;
}

export interface InstrumentIndex {
  flow: typeof INSTRUMENT_FLOW;
  templates: Record<string, string>;
  withoutProcedure: string[];
  /** Criteria left out on purpose with `--only`; empty for a full run. */
  only: string[];
  walks: WalkTask[];
  tasks: InstrumentTask[];
  /** True once every verifier is in: from then on it is known which criteria get a finishing round. Absent in an older index. */
  finishDecided?: boolean;
  /**
   * The attempts per task whose agent came back without a result that holds, under `<phase>:<id>`
   * (`walks:start`, `judges:1.4.3`). The workflow counts them with `tasks --attempted`, so the count
   * survives a restart. An agent that stopped with an error (a limit or a failure of the model) is no
   * attempt. Absent when there is none.
   */
  attempts?: Record<string, number>;
}

export interface TaskOptions {
  /** Judge only these criteria. */
  only?: string[] | undefined;
  /** Walk only these page types. */
  pageTypes?: string[] | undefined;
  /**
   * A new finishing round for these criteria, also when the run is done: only for a criterion whose
   * final verdict is open with a point "niet bereikbaar" or "proef werkte niet". The earlier verdict is kept.
   */
  again?: string[] | undefined;
  /** For tests: the run data and the dossier builder, instead of what is read from the run directory. */
  run?: RunData;
  buildDossier?: typeof buildDossier;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
}

const INDEX = join("tasks", "index.json");
const NOT_WALKED = join("rondgang", "niet-doorlopen.json");
const stampOf = (path: string): string => path.replace(/\.json$/, ".stamp.json");
const skipOf = (path: string): string => path.replace(/\.json$/, ".overgeslagen.json");
/**
 * Why a walk or a verdict was given up on: the agent came back twice without a result that holds,
 * or the model was not there to do it (a limit of the subscription, a failure of the service).
 * The second is no fault of an agent or of loep, and the report and the finishing round say so.
 */
export const SKIP_KINDS = ["geen geldig resultaat", "storing"] as const;
export type SkipKind = (typeof SKIP_KINDS)[number];
/** The phases of the flow as `pending` names them; the attempts of a task are counted under `<phase>:<id>`. */
export const PHASES = ["walks", "judges", "verifiers", "finishers"] as const;
export type Phase = (typeof PHASES)[number];
/** Where the task file of each phase is, relative to the run. The workflow derives the same paths from the ids `pending --brief` gives. */
export const TASK_FILES: Record<Phase, (id: string) => string> = {
  walks: (id) => join("rondgang", `${id}.md`),
  judges: (id) => join("tasks", id, "beoordeel.md"),
  verifiers: (id) => join("tasks", id, "verifieer.md"),
  finishers: (id) => join("tasks", id, "afmaak.md"),
};
/**
 * The session name for one attempt at a task. A session keeps its budget and its clock for the
 * life of the run, so a task that is done again needs a fresh one: the name it had while its
 * result is current or nobody started on it, and otherwise the first name that has no session yet.
 */
function nextSession(runDir: string, base: string): string {
  for (let attempt = 2; ; attempt++) if (!sessionStarted(runDir, `${base}-${attempt}`)) return `${base}-${attempt}`;
}
const sessionStarted = (runDir: string, name: string): boolean => existsSync(join(runDir, "observations", name));

const sessionPart = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

/** What a command that needs the task files says when they are not there. */
export const NO_TASKS_NL = "deze run heeft geen opdrachten om te beoordelen: draai eerst tasks, en daarvoor explore als de site nog niet is verkend";

export function isInstrumentRun(runDir: string): boolean {
  const path = join(runDir, INDEX);
  return existsSync(path) && (JSON.parse(readFileSync(path, "utf8")) as { flow?: string }).flow === INSTRUMENT_FLOW;
}

export async function loadInstrumentIndex(runDir: string): Promise<InstrumentIndex> {
  return readJson<InstrumentIndex>(join(runDir, INDEX));
}

/** Every observation record of the run, and the hash of the file each came from. */
export function loadObservations(runDir: string): { index: ObservationIndex; records: Map<string, ObservationRecordLike & { target?: { path: string[] } | null; page?: { url: string } | null; state: { id?: string; start: unknown; steps?: unknown[] } | null }>; sha: (id: string) => string | null } {
  const root = join(runDir, "observations");
  const records = new Map<string, ObservationRecordLike & { target?: { path: string[] } | null; page?: { url: string } | null; state: { id?: string; start: unknown; steps?: unknown[] } | null }>();
  const hashes = new Map<string, string>();
  for (const session of existsSync(root) ? readdirSync(root).sort() : []) {
    const dir = join(root, session);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((name) => /^\d+\.json$/.test(name)).sort()) {
      const text = readFileSync(join(dir, file), "utf8");
      const record = JSON.parse(text) as ObservationRecordLike;
      records.set(record.id, record);
      hashes.set(record.id, sha256(text));
    }
  }
  return { index: indexObservations(records.values()), records, sha: (id) => hashes.get(id) ?? null };
}

/** The states a walk goes through, one line each as the walk-through prompt shows them. Empty when the site model names none for the page type. */
function stateLinesFor(run: RunData, typeId: string, recipes: Record<string, { start?: { url?: string } | null; steps?: { command: string; args: string[] }[] }>): string[] {
  const model = run.siteModel!;
  const type = model.pageTypes.find((entry) => entry.id === typeId)!;
  const lines: string[] = [];
  for (const blocker of model.blockers) lines.push(`- Over de pagina ligt: ${blocker.descriptionNl.replace(/\.$/, "")}. Een gewone \`open\` sluit dit vanzelf; met \`--with-blockers\` blijft het staan (stap 1).`);
  for (const component of model.components.filter((entry) => entry.pageTypes.includes(typeId))) {
    const narrow = component.viewport?.maxWidth ? ` Bestaat alleen tot ${component.viewport.maxWidth} pixels breed: open met \`--width 360\`.` : "";
    if (component.recipe) lines.push(`- \`${component.recipe}\`: ${component.descriptionNl.replace(/\.$/, "")}.${narrow}`);
    else lines.push(`- geen recept: ${component.descriptionNl.replace(/\.$/, "")}. ${component.notOpenedNl ?? ""} Probeer het zelf te openen.`);
  }
  for (const process of model.processes) {
    // A process belongs to the page type it ends on: the last page it goes to, or the page it starts on.
    const recipe = recipes[process.recipe];
    const visited = [recipe?.start?.url, ...(recipe?.steps ?? []).filter((step) => step.command === "goto").map((step) => step.args[0])].filter((url): url is string => typeof url === "string");
    const last = visited.at(-1);
    if (last !== undefined && type.pages.includes(last)) lines.push(`- \`${process.recipe}\` (proces): ${process.descriptionNl.replace(/\.$/, "")}.`);
  }
  return lines;
}

const NO_STATES_NL = "- Het sitemodel noemt voor dit paginatype geen meldingen, onderdelen of processen. Loop de pagina door zoals ze laadt, breed en smal.";

/**
 * What a criterion has to cover on this site, for its budget: the page types it applies to and
 * the states that can be opened there. A criterion about something countable (forms, media)
 * applies to the page types where the inventory counted it; any other to all of them.
 */
export function coverageOf(run: RunData, procedure: Pick<Procedure, "inapplicableIfZero">): Coverage {
  const model = run.siteModel;
  if (!model) return { pageTypes: 0, states: 0 };
  const keys = procedure.inapplicableIfZero;
  // Run data built by hand may come without the pages of the inventory: then nothing was counted anywhere.
  const counted = new Set((run.inventory.pages ?? []).filter((page) => keys.some((key) => typeof page.counts[key] === "number" && (page.counts[key] as number) > 0)).map((page) => page.url));
  const types = keys.length === 0 ? model.pageTypes : model.pageTypes.filter((type) => type.pages.some((url) => counted.has(url)));
  const ids = new Set(types.map((type) => type.id));
  const components = model.components.filter((component) => component.pageTypes.some((id) => ids.has(id))).length;
  return { pageTypes: types.length, states: types.length === 0 ? 0 : components + model.processes.length + model.blockers.length };
}

async function readRecipes(runDir: string): Promise<Record<string, { start?: { url?: string } | null; steps?: { command: string; args: string[] }[] }>> {
  const dir = join(runDir, "recipes");
  const recipes: Record<string, { start?: { url?: string } | null; steps?: { command: string; args: string[] }[] }> = {};
  for (const file of existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : []) recipes[file.slice(0, -5)] = await readJson(join(dir, file));
  return recipes;
}

interface WalkStamp {
  promptSha256: string;
  outputSha256: string;
  observations: Record<string, string>;
}

interface VerdictStamp {
  criterion: string;
  round: Round;
  dossierSha256: string;
  procedureSha256: string;
  promptSha256: string;
  candidatesSha256: string;
  verdictSha256: string;
  /** Hash of every observation record the verdict cites: a verdict is stale when one of them changed or is gone. */
  observations: Record<string, string>;
  /** For the final verdict: the judge verdict it verified. */
  judgeSha256?: string;
  /** For the finishing round: the verdicts it built on, each null when there was none that counted. */
  baseSha256?: { judge: string | null; final: string | null };
}

const observationHashes = (ids: string[], sha: (id: string) => string | null): Record<string, string> => Object.fromEntries(ids.map((id) => [id, sha(id) ?? "missing"]));

async function stampMatches(runDir: string, path: string, expected: object | null): Promise<boolean> {
  if (expected === null || !existsSync(join(runDir, stampOf(path)))) return false;
  const { stampedAt: _stampedAt, ...stamp } = await readJson<Record<string, unknown>>(join(runDir, stampOf(path)));
  return canonicalJson(stamp) === canonicalJson(expected);
}

async function walkStamp(runDir: string, walk: WalkTask, sha: (id: string) => string | null): Promise<WalkStamp | null> {
  if (!existsSync(join(runDir, walk.output))) return null;
  const list = await readJson<Partial<CandidateList>>(join(runDir, walk.output));
  const cited = [...(list.states ?? []).flatMap((state) => state.evidence ?? []), ...(list.candidates ?? []).flatMap((candidate) => candidate.evidence ?? [])];
  return { promptSha256: await sha256File(join(runDir, walk.prompt)), outputSha256: await sha256File(join(runDir, walk.output)), observations: observationHashes([...new Set(cited)].sort(), sha) };
}

const partOf = (task: InstrumentTask, round: Round): InstrumentTask["judge"] | null => (round === "judge" ? task.judge : round === "final" ? task.verify : (task.finish ?? null));

async function verdictStamp(runDir: string, task: InstrumentTask, round: Round, observations: ReturnType<typeof loadObservations>): Promise<VerdictStamp | null> {
  const part = partOf(task, round);
  if (!part || !existsSync(join(runDir, part.output)) || !existsSync(join(runDir, part.prompt))) return null;
  let cited: string[];
  try {
    // An agent that was stopped halfway can leave an empty or half-written file: that is no verdict.
    cited = citedObservations(await readJson<Verdict>(join(runDir, part.output)), observations.index);
  } catch {
    return null;
  }
  return {
    criterion: task.criterion,
    round,
    dossierSha256: task.dossierSha256,
    procedureSha256: task.procedureSha256,
    promptSha256: await sha256File(join(runDir, part.prompt)),
    candidatesSha256: await sha256File(join(runDir, part.candidates)),
    verdictSha256: await sha256File(join(runDir, part.output)),
    observations: observationHashes(cited, observations.sha),
    ...(round === "final" ? { judgeSha256: await sha256File(join(runDir, task.judge.output)) } : {}),
    ...(round === "finish" ? { baseSha256: await baseHashes(runDir, task, observations) } : {}),
  };
}

/** The hash of each verdict before the finishing round that counts: a finishing verdict is stale when one of them changed, came or went. */
async function baseHashes(runDir: string, task: InstrumentTask, observations: ReturnType<typeof loadObservations>): Promise<{ judge: string | null; final: string | null }> {
  const hash = async (round: "judge" | "final"): Promise<string | null> => ((await instrumentVerdictIsCurrent(runDir, task, round, observations)) ? sha256File(join(runDir, partOf(task, round)!.output)) : null);
  return { judge: await hash("judge"), final: await hash("final") };
}

export async function walkIsCurrent(runDir: string, walk: WalkTask, observations = loadObservations(runDir)): Promise<boolean> {
  return stampMatches(runDir, walk.output, await walkStamp(runDir, walk, observations.sha));
}

export async function instrumentVerdictIsCurrent(runDir: string, task: InstrumentTask, round: Round, observations = loadObservations(runDir)): Promise<boolean> {
  const part = partOf(task, round);
  if (!part) return false;
  if (!(await stampMatches(runDir, part.output, await verdictStamp(runDir, task, round, observations)))) return false;
  // The stamp of a finishing verdict names the verdicts it built on, so it needs no judge of its own.
  return round !== "final" || instrumentVerdictIsCurrent(runDir, task, "judge", observations);
}

/** The verdict a criterion stands on before the finishing round: that of the verifier, or that of the judge when no verifier's came, or none. */
export interface Standing {
  round: "final" | "judge" | null;
  verdict: Verdict | null;
}

export async function standingVerdict(runDir: string, task: InstrumentTask, observations = loadObservations(runDir)): Promise<Standing> {
  for (const round of ["final", "judge"] as const) {
    if (await instrumentVerdictIsCurrent(runDir, task, round, observations)) return { round, verdict: await readJson<Verdict>(join(runDir, partOf(task, round)!.output)) };
  }
  return { round: null, verdict: null };
}

/** What the finishing round is told when the round before it gave nothing: an open point like any other, so the same rules hold for it. */
export const NO_FINAL_NL = "budget op: de verificatie leverde na twee pogingen geen geldig eindoordeel. Het oordeel van de beoordelaar is daardoor niet gecontroleerd.";
export const NO_VERDICT_NL = "budget op: de beoordeling leverde na twee pogingen geen geldig oordeel. Het criterium is daardoor niet beoordeeld.";
/** The same for a round that was skipped because the model was not there: no budget ran out and no agent failed. */
export const NO_FINAL_OUTAGE_NL = "De verificatie is door een storing van het model niet gedaan. Het oordeel van de beoordelaar is daardoor niet gecontroleerd.";
export const NO_VERDICT_OUTAGE_NL = "De beoordeling is door een storing van het model niet gedaan. Het criterium is daardoor niet beoordeeld.";

/**
 * The open points a finishing round has to settle, or null when the criterion needs none. It
 * needs one when the evaluation itself left the question open: the final verdict is "cantTell"
 * with a point about coverage, budget or a probe, or no final verdict came at all. Every open
 * point is listed, also one for the owner of the site: the agent may settle it or leave it.
 */
export function pointsToFinish(standing: Standing, missedBy: SkipKind | null = null): string[] | null {
  if (standing.round !== "final") {
    const outage = missedBy === "storing";
    const missed = standing.round === "judge" ? (outage ? NO_FINAL_OUTAGE_NL : NO_FINAL_NL) : outage ? NO_VERDICT_OUTAGE_NL : NO_VERDICT_NL;
    return [...(standing.verdict?.outcome === "cantTell" ? (standing.verdict.missingNl ?? []) : []), missed];
  }
  const verdict = standing.verdict!;
  const points = verdict.missingNl ?? [];
  // A point without a kind is from before the kinds existed: nobody can say it is the owner's, so it is the evaluation's.
  return verdict.outcome === "cantTell" && points.some((point) => openPoint(point).kind?.reader !== "owner") ? points : null;
}

/** The verdict that counts for a criterion, as `evaluate` takes it: that of the finishing round when it is current, otherwise that of the verifier. */
async function countingOf(runDir: string, task: InstrumentTask, observations: ReturnType<typeof loadObservations>): Promise<{ round: "finish" | "final"; verdict: Verdict } | null> {
  for (const round of ["finish", "final"] as const) {
    if (await instrumentVerdictIsCurrent(runDir, task, round, observations)) return { round, verdict: await readJson<Verdict>(join(runDir, partOf(task, round)!.output)) };
  }
  return null;
}

/** The current verdict of each round of each of these criteria, for what they passed on to other criteria. */
async function passingOf(runDir: string, tasks: InstrumentTask[], observations: ReturnType<typeof loadObservations>): Promise<Map<string, PassingVerdicts>> {
  const read = async (task: InstrumentTask, round: Round): Promise<Verdict | null> => ((await instrumentVerdictIsCurrent(runDir, task, round, observations)) ? readJson<Verdict>(join(runDir, partOf(task, round)!.output)) : null);
  const result = new Map<string, PassingVerdicts>();
  for (const task of tasks) result.set(task.criterion, { a: await read(task, "judge"), final: await read(task, "final"), finish: await read(task, "finish") });
  return result;
}

/**
 * The open points a new finishing round for this criterion starts from, or why it cannot get one.
 * It can when its final verdict is open with a point an instrument can measure once the part of
 * the site loads again or the probe works: "niet bereikbaar" or "proef werkte niet". It can also
 * when another criterion passed something on to it that none of its verdicts ruled on and it did
 * not fail: what a finishing round passes on reaches no other round by itself, since those run side by side.
 */
async function pointsForAgain(runDir: string, previous: InstrumentIndex | null, id: string, observations: ReturnType<typeof loadObservations>): Promise<string[] | string> {
  if (!criterionById(id)) return `--again: "${id}" is geen succescriterium`;
  const task = previous?.tasks.find((entry) => entry.criterion === id);
  if (!previous || !task) return `--again: ${id} heeft geen opdracht in deze run`;
  if (!previous.finishDecided) return `--again: ${id} kan nog geen nieuwe afmaakronde krijgen, want de afmaakronde is nog niet aan de beurt; draai eerst de fasen ervoor af (tasks en pending)`;
  const counting = await countingOf(runDir, task, observations);
  const kinds = KINDS_FOR_AGAIN.map((kind) => `"${kind}"`).join(" of ");
  const passing = await passingOf(runDir, previous.tasks, observations);
  const unruled = !counting || counting.verdict.outcome === "failed" ? [] : unruledCrossPoints(passing, id, [passing.get(id)?.final, passing.get(id)?.finish], observations.records);
  const open = counting?.verdict.outcome === "cantTell" ? (counting.verdict.missingNl ?? []) : [];
  if (!counting || (unruled.length === 0 && !open.some((point) => (KINDS_FOR_AGAIN as readonly string[]).includes(openPoint(point).kind?.prefix ?? "")))) {
    return `--again: het eindoordeel van ${id} staat niet open met een punt ${kinds}, en niets wat een ander criterium eraan doorgaf, is nog onbeoordeeld; een nieuwe afmaakronde is alleen voor wat een instrument kan meten zodra het deel van de site weer laadt of de proef werkt, of voor wat een ander criterium doorgaf`;
  }
  if (counting.round === "final" && task.finish && !skipped(runDir, task.finish.output)) return `--again: de afmaakronde van ${id} staat al klaar; pending noemt haar onder finishers`;
  return [...open, ...unruled];
}

/**
 * Set the files of the last finishing round of a criterion aside, so a new round can write its
 * own: the verdict with its stamp, the prompt, and a record that it was skipped. They keep their
 * name with a number ("afmaak-1.json"). Returns the verdict that was kept, if there was one.
 */
function setFinishAside(runDir: string, finish: NonNullable<InstrumentTask["finish"]>): string[] {
  const numbered = (path: string, number: number): string => path.replace(/(\.[a-z]+)$/, `-${number}$1`);
  let number = 1;
  while (existsSync(join(runDir, numbered(finish.output, number))) || existsSync(join(runDir, numbered(finish.prompt, number)))) number++;
  const kept: string[] = [];
  for (const [from, to] of [
    [finish.output, numbered(finish.output, number)],
    [stampOf(finish.output), stampOf(numbered(finish.output, number))],
    [skipOf(finish.output), skipOf(numbered(finish.output, number))],
    [finish.prompt, numbered(finish.prompt, number)],
  ] as const) {
    if (!existsSync(join(runDir, from))) continue;
    renameSync(join(runDir, from), join(runDir, to));
    if (from === finish.output) kept.push(to);
  }
  return kept;
}

/** Whether a walk or a verdict was given up on with `skip`. */
export const skipped = (runDir: string, output: string): boolean => existsSync(join(runDir, skipOf(output)));

/** Why a walk or a verdict was given up on, or null when it was not. A record from before the kinds existed was always a task without a valid result. */
export function skipKindOf(runDir: string, output: string): SkipKind | null {
  if (!skipped(runDir, output)) return null;
  const kind = (JSON.parse(readFileSync(join(runDir, skipOf(output)), "utf8")) as { kind?: string }).kind;
  return kind === "storing" ? "storing" : "geen geldig resultaat";
}

/** Why the round a standing verdict lacks was given up on: the judge when there is no verdict, the verifier when there is only the judge's. */
function missedBy(runDir: string, task: InstrumentTask, standing: Standing): SkipKind | null {
  const part = standing.round === null ? task.judge : standing.round === "judge" ? task.verify : null;
  return part ? skipKindOf(runDir, part.output) : null;
}

/**
 * Whether a criterion lacks the verdict that counts because the model was not there: the last
 * round of it that was given up on, was given up on for a storing. Then the report says so, and
 * `feedback` drafts no issue: it is no fault of loep.
 */
export function skippedForOutage(runDir: string, task: InstrumentTask): boolean {
  for (const part of [task.finish, task.verify, task.judge]) if (part && skipped(runDir, part.output)) return skipKindOf(runDir, part.output) === "storing";
  return false;
}

/** The verdicts of one criterion that can pass something on to another: the judge's (slot "a"), the verifier's and the finishing round's. */
export interface PassingVerdicts {
  a?: Verdict | null;
  final?: Verdict | null;
  finish?: Verdict | null;
}
type PassingRound = keyof PassingVerdicts;

/** How a candidate's identifier says who passed it on: "X145-01" the judge of 1.4.5, "XV145-01" its verifier, "XA145-01" its finishing round. */
const PASSED_BY: readonly [PassingRound, string, string][] = [["a", "X", "beoordelaar"], ["final", "XV", "verifieerder"], ["finish", "XA", "afmaakronde"]];

/** A candidate passed on from another criterion, with that criterion and the entry it came from. */
interface PassedOn {
  candidate: Candidate;
  source: string;
  cross: CrossCandidate;
}

function passedOn(verdicts: Map<string, PassingVerdicts>, criterion: string, from: readonly PassingRound[]): PassedOn[] {
  const result: PassedOn[] = [];
  for (const [source, rounds] of [...verdicts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const earlier: { page: string; where: string }[] = [];
    for (const [round, prefix] of PASSED_BY) {
      const passed = (rounds[round]?.crossCandidates ?? []).filter((cross) => cross.criterion === criterion);
      passed.forEach((cross, position) => {
        if (!from.includes(round) || earlier.some((entry) => entry.page === cross.page && entry.where === cross.where)) return;
        result.push({ source, cross, candidate: { id: `${prefix}${source.replaceAll(".", "")}-${String(position + 1).padStart(2, "0")}`, criterion, page: cross.page, where: cross.where, evidence: cross.evidence, noteNl: cross.noteNl, support: "bekeken" } });
      });
      earlier.push(...passed);
    }
  }
  return result;
}

/**
 * What the rounds in `from` of other criteria passed on to this one, as candidates. What a verifier
 * or finishing round passes on that a round before it of the same criterion already did (the same
 * page and place) is not passed on twice.
 */
export function crossCandidates(verdicts: Map<string, PassingVerdicts>, criterion: string, from: readonly PassingRound[] = ["a"]): Candidate[] {
  return passedOn(verdicts, criterion, from).map((entry) => entry.candidate);
}

/** The part of an observation record that says what was measured where. */
export type MeasuredRecords = ReadonlyMap<string, { command: string; target?: { path: string[] } | null; page?: { url: string } | null }>;

/** What the observations a candidate cites measured: which property (the measuring command) of which element (its path) on which page (its address). */
function measuredBy(cross: CrossCandidate, records: MeasuredRecords): Set<string> {
  const measured = new Set<string>();
  for (const ref of Array.isArray(cross.evidence) ? cross.evidence : []) {
    const record = records.get(ref);
    const command = record ? canonicalCommand(record.command) : "";
    if (record?.page?.url && record.target?.path?.length && (MEASURE_COMMANDS as readonly string[]).includes(command)) measured.add(JSON.stringify([record.page.url, record.target.path, command]));
  }
  return measured;
}

/**
 * Whether two candidates are the same: both rest on a measurement of the same property of the same
 * element on the same page, such as the name (`name`) of one region on one address. Agents in
 * different sessions find the same element under the same path, so this holds across sessions. A
 * look shows a place but measures nothing there, so two defects of one element (its border and its
 * text) stay apart as long as each rests on a measurement of its own. Without a measurement of an
 * element on either side, only the same page and the same description of the place make it the same.
 */
function sameCandidate(a: CrossCandidate, b: CrossCandidate, records: MeasuredRecords): boolean {
  const [first, second] = [measuredBy(a, records), measuredBy(b, records)];
  if (first.size > 0 || second.size > 0) return [...first].some((key) => second.has(key));
  const place = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();
  return a.page === b.page && place(a.where) === place(b.where);
}

/**
 * The candidates passed on to this criterion that close a loop: in one of its rounds, this criterion
 * passed the same candidate back to the criterion it came from. Which of the two did so first does
 * not matter, since finishing rounds run side by side. Returns the identifiers of those candidates,
 * and one loop per candidate.
 */
export function crossLoops(verdicts: Map<string, PassingVerdicts>, criterion: string, records: MeasuredRecords, from: readonly PassingRound[] = ["a", "final", "finish"]): { closed: Set<string>; loops: CrossLoop[] } {
  const closed = new Set<string>();
  const loops: { loop: CrossLoop; cross: CrossCandidate }[] = [];
  const own = verdicts.get(criterion);
  const back = PASSED_BY.flatMap(([round]) => own?.[round]?.crossCandidates ?? []);
  for (const { candidate, source, cross } of passedOn(verdicts, criterion, from)) {
    const returned = back.filter((entry) => entry.criterion === source && sameCandidate(cross, entry, records));
    if (returned.length === 0) continue;
    closed.add(candidate.id);
    const undecided = [...(cross.undecidedNl ? [source] : []), ...(returned.some((entry) => entry.undecidedNl) ? [criterion] : [])];
    const known = loops.find((entry) => entry.loop.with === source && sameCandidate(entry.cross, cross, records));
    if (known) {
      const merged = [...new Set([...(known.loop.undecided ?? []), ...undecided])];
      if (merged.length > 0) known.loop.undecided = merged;
      continue;
    }
    loops.push({ cross, loop: { with: source, page: cross.page, where: cross.where, reasons: [{ criterion: source, noteNl: cross.noteNl }, { criterion, noteNl: returned[0]!.noteNl }], ...(undecided.length > 0 ? { undecided } : {}) } });
  }
  return { closed, loops: loops.map((entry) => entry.loop) };
}

/** Who passed a candidate on: "XV1410-01" came from the verifier of 1.4.10. */
const crossSource = (id: string): string => {
  const [, prefix = "X", digits = ""] = /^(X[VA]?)(\d+)-/.exec(id) ?? [];
  return `de ${PASSED_BY.find((entry) => entry[1] === prefix)![2]} van ${digits.slice(0, 1)}.${digits.slice(1, 2)}.${digits.slice(2)}`;
};

/**
 * What the rounds of other criteria passed on to this criterion that no verdict of it ruled on, as
 * open points. The verifier rules on every candidate it is given and the finishing round on what
 * the verifier left; a candidate that neither of them ruled on was not looked at, so the criterion
 * cannot pass. A candidate this criterion passed back closes a loop (`crossLoops`): it was looked
 * at here, and it is no open point.
 */
export function unruledCrossPoints(verdicts: Map<string, PassingVerdicts>, criterion: string, rounds: (Verdict | null | undefined)[], records: MeasuredRecords, from: readonly PassingRound[] = ["a", "final", "finish"]): string[] {
  const ruled = new Set(rounds.flatMap((verdict) => (verdict?.candidates ?? []).map((ruling) => ruling.id)));
  const { closed } = crossLoops(verdicts, criterion, records, from);
  return crossCandidates(verdicts, criterion, from)
    .filter((candidate) => !ruled.has(candidate.id) && !closed.has(candidate.id))
    .map((candidate) => `veegronde mist: ${crossSource(candidate.id)} zag op ${candidate.page} (${candidate.where}) iets dat bij dit criterium hoort, en geen verifieerder of afmaakronde heeft dat beoordeeld (${candidate.id}): ${candidate.noteNl}`);
}

/**
 * What a judge or verifier passed on to this criterion that the verdict it stands on did not rule
 * on, as points for its finishing round, also when the criterion was settled. None when it failed:
 * a failure it can only add to.
 */
function passedOnPoints(passing: Map<string, PassingVerdicts>, criterion: string, standing: Standing, records: MeasuredRecords): string[] {
  return standing.verdict?.outcome === "failed" ? [] : unruledCrossPoints(beforeOwnFinish(passing, criterion), criterion, [standing.round === "final" ? standing.verdict : null], records, ["a", "final"]);
}

/** The verdicts without the finishing round of this criterion: whether it gets that round, and what it is given, cannot follow from what that round wrote. */
const beforeOwnFinish = (passing: Map<string, PassingVerdicts>, criterion: string): Map<string, PassingVerdicts> => new Map([...passing].map(([id, rounds]) => [id, id === criterion ? { ...rounds, finish: null } : rounds]));

/**
 * Write the task files of the phase the run is in. Safe to run again at any time: what it
 * writes follows from the run, so a second call changes nothing unless walks or verdicts came in.
 */
export async function instrumentTasks(runDir: string, options: TaskOptions = {}): Promise<{ walks: number; judges: number; verifiers: number; finishers: number }> {
  const startedAt = stepStart();
  const run = options.run ?? (await loadRun(runDir));
  if (!run.siteModel) throw new Error("this run has no site model; the flow with instruments needs one");
  const { procedures, missing, invalid } = loadAllProcedures();
  if (invalid.length > 0) throw new Error(`invalid procedures:\n${invalid.join("\n")}`);
  const previous = isInstrumentRun(runDir) ? await loadInstrumentIndex(runDir) : null;
  // A new finishing round is asked for by name: every criterion is checked before anything is written.
  const observations = loadObservations(runDir);
  const again = new Map<string, string[]>();
  for (const id of options.again ?? []) {
    const points = await pointsForAgain(runDir, previous, id, observations);
    if (typeof points === "string") throw new Error(points);
    again.set(id, points);
  }
  const only = options.only ?? previous?.only ?? [];
  for (const id of only) if (!criterionById(id)) throw new Error(`--only: "${id}" is not a success criterion`);
  const typeIds = options.pageTypes ?? previous?.walks.map((walk) => walk.pageType) ?? run.siteModel.pageTypes.map((type) => type.id);
  for (const id of typeIds) if (!run.siteModel.pageTypes.some((type) => type.id === id)) throw new Error(`--page-types: "${id}" is not a page type of the site model`);

  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const templates = Object.fromEntries(["rondgang", "beoordeel", "verifieer", "afmaak"].map((name) => [name, readTemplate(name)])) as Record<"rondgang" | "beoordeel" | "verifieer" | "afmaak", string>;
  const base = { run: absoluteRun, cli, siteModel: join(absoluteRun, "site.json"), login: agentLoginNl(run.login) };
  const readsNl = readsAllowedNl(run.reads ?? []);
  // The budget as it was set, not what is left of it: the task stays the same while agents send, and its hash with it.
  const budgetNl = run.writes ? `. Het budget voor versturen is ${run.writes.maxWrites ?? DEFAULT_MAX_WRITES} verzendingen voor de hele run${spacingNl(run.writes.spacingSeconds ?? DEFAULT_WRITE_SPACING_SECONDS)}, gedeeld door alle agents en de veegronde${reservedWrites(run.writes) > 0 ? `; ${reservedNl(reservedWrites(run.writes))}. De sessies van één criterium (beoordelaar, verifieerder, afmaker) tellen samen als één` : ""}; wat er nog over is, zegt \`session list\`` : "";
  const writesNl = `${run.writes ? `ja, ${writesAllowedNl(run.writes)}${budgetNl}. ${REPLAY_TASK_NL}` : `nee, ${WRITES_BLOCKED_NL}`}${readsNl ? `. Wel gaat door: ${readsNl} (in het dossier onder \`reads\`)` : ""}`;
  const criteriaList = CRITERIA.filter((criterion) => procedures.some((procedure) => procedure.id === criterion.id)).map((criterion) => `${criterion.id} ${criterion.titleNl}`).join("\n");
  const recipes = await readRecipes(runDir);

  // Phase 1: one walk per page type, on the page the explorer looked at.
  const walks: WalkTask[] = [];
  for (const type of run.siteModel.pageTypes.filter((entry) => typeIds.includes(entry.id))) {
    const page = run.pages.find((entry) => entry.item.url === type.representative) ?? run.pages.find((entry) => type.pages.includes(entry.item.url));
    if (!page) continue;
    const earlier = previous?.walks.find((entry) => entry.pageType === type.id);
    const session = earlier?.session ?? `r-${sessionPart(type.id)}`;
    const stateLines = stateLinesFor(run, type.id, recipes);
    const walkLimits = walkBudget(BUDGETS.walk, stateLines.length);
    const walk: WalkTask = { pageType: type.id, page: page.label, prompt: TASK_FILES.walks(type.id), output: join("rondgang", `${type.id}.json`), session, maxCommands: walkLimits.commands, maxMinutes: walkLimits.minutes };
    const writeWalk = async (): Promise<void> => writeFileAtomic(
      join(runDir, walk.prompt),
      fill(templates.rondgang, {
        ...base,
        workDir: await makeWorkDir(runDir, walk.session),
        workName: walk.session,
        site: siteLabel(run.inventory),
        pageType: type.id,
        pageTypeDescription: type.descriptionNl.replace(/\.$/, ""),
        page: page.label,
        url: page.item.url,
        session: walk.session,
        maxCommands: String(walk.maxCommands),
        maxMinutes: String(walk.maxMinutes),
        states: stateLines.length > 0 ? stateLines.join("\n") : NO_STATES_NL,
        idPrefix: page.label,
        criteria: criteriaList,
        output: join(absoluteRun, walk.output),
        check: `node ${cli} check-walk --run ${absoluteRun} --page-type ${type.id}`,
      }),
    );
    await writeWalk();
    if (sessionStarted(runDir, walk.session) && !(await walkIsCurrent(runDir, walk, observations))) {
      walk.session = nextSession(runDir, `r-${sessionPart(type.id)}`);
      await writeWalk();
    }
    walks.push(walk);
  }

  // Candidates of the walks that passed their check, per criterion. Routed here, by code.
  const fromWalks = new Map<string, Candidate[]>();
  // What no walk covered goes to every judge: no candidate from there says nothing about what is there.
  const notWalked: { pageType: string; page: string; notWalkedNl: string[] }[] = [];
  for (const walk of walks) {
    if (!(await walkIsCurrent(runDir, walk, observations))) {
      notWalked.push({ pageType: walk.pageType, page: walk.page, notWalkedNl: ["Van dit paginatype is geen geldige rondgang: er zijn geen kandidaten van."] });
      continue;
    }
    const list = await readJson<CandidateList>(join(runDir, walk.output));
    notWalked.push({ pageType: walk.pageType, page: walk.page, notWalkedNl: list.notWalkedNl });
    for (const candidate of list.candidates) fromWalks.set(candidate.criterion, [...(fromWalks.get(candidate.criterion) ?? []), candidate]);
  }
  const unwalkedTypes = run.siteModel.pageTypes.filter((type) => !walks.some((walk) => walk.pageType === type.id)).map((type) => type.id);
  if (unwalkedTypes.length > 0) notWalked.push({ pageType: unwalkedTypes.join(", "), page: "", notWalkedNl: ["Voor deze paginatypen is geen rondgang gedaan."] });
  await writeJson(join(runDir, NOT_WALKED), notWalked);

  // Phase 2: one judge per criterion.
  const tasks: InstrumentTask[] = [];
  const earlierVerify = new Map<string, InstrumentTask | null>();
  const coverage = new Map<string, Coverage>();
  for (const procedure of procedures.filter((entry) => only.length === 0 || only.includes(entry.id))) {
    const criterion = criterionById(procedure.id)!;
    const dir = join("tasks", procedure.id);
    const dossierPath = join(dir, "dossier.json");
    const dossier = (options.buildDossier ?? buildDossier)(run, procedure);
    const dossierSha256 = await writeJson(join(runDir, dossierPath), dossier);
    const digits = procedure.id.replaceAll(".", "");
    const earlier = previous?.tasks.find((entry) => entry.criterion === procedure.id);
    const judgeSession = earlier?.judge.session ?? `b-${digits}`;
    // Besides the walks, the sweep: what it measured that the role alone does not settle.
    const judgeCandidates = [...(fromWalks.get(procedure.id) ?? []), ...sweepCandidates(run).filter((candidate) => candidate.criterion === procedure.id)];
    coverage.set(procedure.id, coverageOf(run, procedure));
    const judgeLimits = judgeBudget(BUDGETS.judge, procedure.id, coverage.get(procedure.id)!, judgeCandidates.length);
    const judge = { prompt: TASK_FILES.judges(procedure.id), output: join("verdicts", procedure.id, "oordeel.json"), candidates: join(dir, "kandidaten.json"), session: judgeSession, maxCommands: judgeLimits.commands, maxMinutes: judgeLimits.minutes };
    await writeJson(join(runDir, judge.candidates), judgeCandidates);
    const shared = { ...base, id: criterion.id, title: criterion.titleNl, level: criterion.level, dossier: join(absoluteRun, dossierPath), dossierParts: dossierPartsNl(dossier), gate: join(absoluteRun, "gate.json"), writes: writesNl, procedure: procedure.body };
    const writeJudge = async (): Promise<void> => writeFileAtomic(
      join(runDir, judge.prompt),
      fill(templates.beoordeel, { ...shared, session: judge.session, workDir: await makeWorkDir(runDir, judge.session), workName: judge.session, maxCommands: String(judge.maxCommands), maxMinutes: String(judge.maxMinutes), candidates: join(absoluteRun, judge.candidates), notWalked: join(absoluteRun, NOT_WALKED), output: join(absoluteRun, judge.output), check: `node ${cli} check-verdict --run ${absoluteRun} --criterion ${criterion.id} --round judge` }),
    );
    const task: InstrumentTask = { criterion: criterion.id, titleNl: criterion.titleNl, procedureVersion: procedure.version, procedureSha256: procedure.sha256, dossier: dossierPath, dossierSha256, passCommands: procedure.passCommands, decisiveCommands: procedure.decisiveCommands, recommendationRules: procedure.recommendationRules, ...(procedure.passExplains.length > 0 ? { passExplains: procedure.passExplains } : {}), judge, verify: null };
    await writeJudge();
    if (sessionStarted(runDir, judge.session) && !(await instrumentVerdictIsCurrent(runDir, task, "judge", observations))) {
      judge.session = nextSession(runDir, `b-${digits}`);
      await writeJudge();
    }
    tasks.push(task);
    earlierVerify.set(criterion.id, earlier ?? null);
  }

  // Phase 3: a verifier per criterion, once every judge is in (or given up on).
  const judged = new Map<string, PassingVerdicts>();
  let judgesOpen = 0;
  for (const task of tasks) {
    if (await instrumentVerdictIsCurrent(runDir, task, "judge", observations)) judged.set(task.criterion, { a: await readJson<Verdict>(join(runDir, task.judge.output)) });
    else if (!skipped(runDir, task.judge.output)) judgesOpen++;
  }
  let verifiers = 0;
  if (judgesOpen === 0) {
    for (const task of tasks) {
      const verdict = judged.get(task.criterion)?.a;
      if (!verdict) continue;
      const procedure = procedures.find((entry) => entry.id === task.criterion)!;
      const criterion = criterionById(task.criterion)!;
      const dir = join("tasks", task.criterion);
      const candidates = [...(await readJson<Candidate[]>(join(runDir, task.judge.candidates))), ...crossCandidates(judged, task.criterion)];
      const dismissed = (verdict.candidates ?? []).filter((ruling) => ruling.ruling === "noIssue").length + candidates.length - (verdict.candidates ?? []).length;
      const budget = BUDGETS.verify;
      const was = earlierVerify.get(task.criterion) ?? null;
      const maxCommands = budget.base + budget.perFinding * verdict.findings.length + budget.perDismissedCandidate * Math.max(0, dismissed) + (verdict.outcome === "failed" ? 0 : budget.afterPass);
      // What there is to reproduce is the floor; what the criterion used before and the size of the site come on top.
      const verifyLimits = verifyBudget({ commands: maxCommands, minutes: budget.minutes }, task.criterion, coverage.get(task.criterion)!);
      const verify = { prompt: TASK_FILES.verifiers(task.criterion), output: join("verdicts", task.criterion, "final.json"), candidates: join(dir, "kandidaten-verificatie.json"), session: was?.verify?.session ?? `v-${task.criterion.replaceAll(".", "")}`, maxCommands: verifyLimits.commands, maxMinutes: verifyLimits.minutes };
      await writeJson(join(runDir, verify.candidates), candidates);
      const writeVerify = async (): Promise<void> => writeFileAtomic(
        join(runDir, verify.prompt),
        fill(templates.verifieer, {
          ...base,
          workDir: await makeWorkDir(runDir, verify.session),
          workName: verify.session,
          id: criterion.id,
          title: criterion.titleNl,
          level: criterion.level,
          dossier: join(absoluteRun, task.dossier),
          dossierParts: dossierPartsOfFile(runDir, task.dossier),
          writes: writesNl,
          procedure: procedure.body,
          session: verify.session,
          maxCommands: String(verify.maxCommands),
          maxMinutes: String(verify.maxMinutes),
          verdict: join(absoluteRun, task.judge.output),
          candidates: join(absoluteRun, verify.candidates),
          output: join(absoluteRun, verify.output),
          check: `node ${cli} check-verdict --run ${absoluteRun} --criterion ${criterion.id} --round final`,
        }),
      );
      task.verify = verify;
      await writeVerify();
      if (sessionStarted(runDir, verify.session) && !(await instrumentVerdictIsCurrent(runDir, task, "final", observations))) {
        verify.session = nextSession(runDir, `v-${task.criterion.replaceAll(".", "")}`);
        await writeVerify();
      }
      verifiers++;
    }
  }

  // Phase 4: a finishing round per criterion the evaluation itself left open, once every verifier is in (or given up on).
  let verifiersOpen = 0;
  if (judgesOpen === 0) {
    for (const task of tasks) if (task.verify && !(await instrumentVerdictIsCurrent(runDir, task, "final", observations)) && !skipped(runDir, task.verify.output)) verifiersOpen++;
  }
  const finishDecided = judgesOpen === 0 && verifiersOpen === 0;
  if (again.size > 0 && !finishDecided) throw new Error("--again: de afmaakronde is niet meer aan de beurt, want er staat weer een beoordeling of verificatie open; draai eerst tasks en pending zonder --again");
  let finishers = 0;
  if (finishDecided) {
    // What every round passed on to another criterion. The finishing round comes after every verifier, so it gets what they passed on;
    // what another finishing round passed on reaches only a round that runs again (`--again`), since they run side by side.
    const passing = await passingOf(runDir, tasks.map((task) => ({ ...task, ...(again.has(task.criterion) ? {} : { finish: earlierVerify.get(task.criterion)?.finish }) })), observations);
    for (const task of tasks) {
      const standing = await standingVerdict(runDir, task, observations);
      const was = earlierVerify.get(task.criterion) ?? null;
      // A round that ran again keeps the points it was given, and the verdicts before it stay where they were set aside.
      let earlierRounds = was?.finish?.earlier ?? [];
      let ranAgain = Boolean(was?.finish && (was.finish.again || earlierRounds.length > 0));
      const missed = missedBy(runDir, task, standing);
      let points = ranAgain ? was!.finish!.points : pointsToFinish(standing, missed);
      const unruled = passedOnPoints(passing, task.criterion, standing, observations.records);
      if (!ranAgain && unruled.length > 0) points = [...(points ?? standing.verdict?.missingNl ?? []), ...unruled];
      if (again.has(task.criterion)) {
        if (was?.finish) earlierRounds = [...earlierRounds, ...setFinishAside(runDir, was.finish)];
        points = again.get(task.criterion)!;
        ranAgain = true;
      }
      if (!points) continue;
      const procedure = procedures.find((entry) => entry.id === task.criterion)!;
      const criterion = criterionById(task.criterion)!;
      const dir = join("tasks", task.criterion);
      const digits = task.criterion.replaceAll(".", "");
      // What the verifier ruled on with an observation of its own is settled; what it left open, and everything nobody verified, is for this round.
      const listed = await readJson<Candidate[]>(join(runDir, (task.verify ?? task.judge).candidates));
      // Nobody else was given what verifiers passed on, nor without a verifier what judges did: this round is, and when it runs again also what other finishing rounds passed on.
      // Not what closes a loop: this criterion passed it back, so it was looked at here already.
      const from: PassingRound[] = ranAgain ? ["a", "final", "finish"] : ["a", "final"];
      const { closed } = crossLoops(beforeOwnFinish(passing, task.criterion), task.criterion, observations.records, from);
      const given = crossCandidates(passing, task.criterion, from).filter((candidate) => !closed.has(candidate.id));
      const all = [...listed, ...given.filter((candidate) => !listed.some((entry) => entry.id === candidate.id))];
      const finishLimits = finishBudget(BUDGETS.finish, { commands: task.judge.maxCommands, minutes: task.judge.maxMinutes }, BUDGETS.judge);
      const ruled = new Set(standing.round === "final" ? (standing.verdict!.candidates ?? []).filter((ruling) => ruling.ruling !== "open").map((ruling) => ruling.id) : []);
      const finish: NonNullable<InstrumentTask["finish"]> = { prompt: TASK_FILES.finishers(task.criterion), output: join("verdicts", task.criterion, "afmaak.json"), candidates: join(dir, "kandidaten-afmaak.json"), session: was?.finish?.session ?? `a-${digits}`, maxCommands: finishLimits.commands, maxMinutes: finishLimits.minutes, points, ...(earlierRounds.length > 0 ? { earlier: earlierRounds } : {}), ...(ranAgain ? { again: true as const } : {}) };
      await writeJson(join(runDir, finish.candidates), all.filter((candidate) => !ruled.has(candidate.id)));
      const standingNl =
        standing.round === "final"
          ? `Het eindoordeel van de verifieerder: \`${join(absoluteRun, task.verify!.output)}\`. Het oordeel van de beoordelaar daarvoor: \`${join(absoluteRun, task.judge.output)}\`.`
          : standing.round === "judge"
            ? `Het oordeel van de beoordelaar: \`${join(absoluteRun, task.judge.output)}\`. Een verifieerder heeft het niet gecontroleerd: neem er niets uit over zonder het zelf te meten.`
            : missed === "storing"
              ? "Er is geen eerder oordeel: de beoordeling is door een storing van het model niet gedaan. Je begint bij de procedure en het dossier."
              : "Er is geen eerder oordeel: de beoordeling leverde geen geldig resultaat. Je begint bij de procedure en het dossier.";
      // A round that runs again starts from the verdict of the round before it, which stays in the run.
      const earlierNl =
        earlierRounds.length > 0
          ? `Een eerdere afmaakronde liet dit criterium open. Haar oordeel blijft bewaard: \`${join(absoluteRun, earlierRounds.at(-1)!)}\`. De punten hierboven komen daaruit. Ze bleven open omdat een deel van de site niet bereikbaar was of een instrument niet werkte. Open dat deel eerst opnieuw: laadt het nu, of werkt het instrument nu, meet dan wat ontbrak. Laadt het nog steeds niet, dan blijft het punt open, met jouw eigen poging in \`finish.attempts\`. ${standingNl}`
          : standingNl;
      const writeFinish = async (): Promise<void> => writeFileAtomic(
        join(runDir, finish.prompt),
        fill(templates.afmaak, {
          ...base,
          workDir: await makeWorkDir(runDir, finish.session),
          workName: finish.session,
          id: criterion.id,
          title: criterion.titleNl,
          level: criterion.level,
          dossier: join(absoluteRun, task.dossier),
          dossierParts: dossierPartsOfFile(runDir, task.dossier),
          writes: writesNl,
          procedure: procedure.body,
          session: finish.session,
          maxCommands: String(finish.maxCommands),
          maxMinutes: String(finish.maxMinutes),
          points: points.map((point, position) => `${position + 1}. ${point.replace(/\s+/g, " ").trim()}`).join("\n"),
          pointCount: String(points.length),
          earlier: earlierNl,
          candidates: join(absoluteRun, finish.candidates),
          notWalked: join(absoluteRun, NOT_WALKED),
          output: join(absoluteRun, finish.output),
          check: `node ${cli} check-verdict --run ${absoluteRun} --criterion ${criterion.id} --round finish`,
        }),
      );
      task.finish = finish;
      await writeFinish();
      if (sessionStarted(runDir, finish.session) && !(await instrumentVerdictIsCurrent(runDir, task, "finish", observations))) {
        finish.session = nextSession(runDir, `a-${digits}`);
        await writeFinish();
      }
      finishers++;
    }
  }

  // The attempts stay with the run; a finishing round that runs again starts counting anew.
  const attempts = { ...(previous?.attempts ?? {}) };
  for (const id of again.keys()) delete attempts[`finishers:${id}`];
  const index: InstrumentIndex = { flow: INSTRUMENT_FLOW, templates: Object.fromEntries(Object.entries(templates).map(([name, text]) => [name, sha256(text)])), withoutProcedure: missing, only, walks, tasks, finishDecided, ...(Object.keys(attempts).length > 0 ? { attempts } : {}) };
  await writeJson(join(runDir, INDEX), index);
  await writeManifest(runDir, { command: "tasks", startedAt, flow: INSTRUMENT_FLOW, walks: walks.length, criteria: tasks.length, verifiers, finishers, withoutProcedure: missing.length });
  return { walks: walks.length, judges: tasks.length, verifiers, finishers };
}

export interface InstrumentPending {
  flow: typeof INSTRUMENT_FLOW;
  /** The first phase with work left; run `tasks` again when a phase is finished. Each list is longest expected first (walks by the size of the task file, the others by the size of their candidates file), equal sizes in the order of the index. */
  phase: "walks" | "judges" | "verifiers" | "finishers" | "done";
  /** Each task with `attempts`: how often an agent came back from it without a result that holds (see `InstrumentIndex.attempts`). */
  walks: { pageType: string; task: string; session: string; attempts: number }[];
  judges: { criterion: string; task: string; session: string; attempts: number }[];
  verifiers: { criterion: string; task: string; session: string; attempts: number }[];
  /** The finishing round: one task per criterion the evaluation itself left open. Empty when there is none. */
  finishers: { criterion: string; task: string; session: string; attempts: number }[];
  /** Given up on with `skip`: no walk, or no verdict, will come. */
  skipped: string[];
  noteNl: string;
}

/**
 * What the workflow asks of `pending`: per phase the ids of the open tasks and their attempts, and no
 * paths, so the agent that reads it out has nothing long to copy. The workflow derives each path from
 * its id, as `TASK_FILES` does.
 */
export function briefPending(pending: InstrumentPending): { phase: InstrumentPending["phase"] } & Record<Phase, { id: string; attempts: number }[]> {
  const brief = (list: { pageType?: string; criterion?: string; attempts: number }[]): { id: string; attempts: number }[] => list.map((entry) => ({ id: entry.pageType ?? entry.criterion!, attempts: entry.attempts }));
  return { phase: pending.phase, walks: brief(pending.walks), judges: brief(pending.judges), verifiers: brief(pending.verifiers), finishers: brief(pending.finishers) };
}

const sizeOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** Largest weight first, equal weights in their given order; the pool takes tasks in list order, so the long ones start first. */
export function longestFirst<T>(items: T[], weight: (item: T) => number): T[] {
  return items
    .map((item, position) => ({ item, position, weight: weight(item) }))
    .sort((a, b) => b.weight - a.weight || a.position - b.position)
    .map((entry) => entry.item);
}

/** What is still to do, per phase. A verdict whose stamp no longer matches dossier, procedure, prompt, candidates or cited observations counts as not there. */
export async function instrumentPending(runDir: string): Promise<InstrumentPending> {
  const index = await loadInstrumentIndex(runDir);
  const observations = loadObservations(runDir);
  const absolute = (path: string): string => join(resolve(runDir), path);
  const attempts = (phase: Phase, id: string): number => index.attempts?.[`${phase}:${id}`] ?? 0;
  const given: string[] = [];
  const walks: InstrumentPending["walks"] = [];
  for (const walk of index.walks) {
    if (await walkIsCurrent(runDir, walk, observations)) continue;
    if (skipped(runDir, walk.output)) given.push(`rondgang ${walk.pageType}`);
    else walks.push({ pageType: walk.pageType, task: absolute(walk.prompt), session: walk.session, attempts: attempts("walks", walk.pageType) });
  }
  const judges: InstrumentPending["judges"] = [];
  const verifiers: InstrumentPending["verifiers"] = [];
  const candidatesOf = new Map<string, string>();
  let verifierTasksMissing = false;
  for (const task of index.tasks) {
    if (!(await instrumentVerdictIsCurrent(runDir, task, "judge", observations))) {
      if (skipped(runDir, task.judge.output)) given.push(`beoordeling ${task.criterion}`);
      else {
        judges.push({ criterion: task.criterion, task: absolute(task.judge.prompt), session: task.judge.session, attempts: attempts("judges", task.criterion) });
        candidatesOf.set(`judge ${task.criterion}`, absolute(task.judge.candidates));
      }
      continue;
    }
    if (!task.verify) verifierTasksMissing = true;
    else if (!(await instrumentVerdictIsCurrent(runDir, task, "final", observations))) {
      if (skipped(runDir, task.verify.output)) given.push(`verificatie ${task.criterion}`);
      else {
        verifiers.push({ criterion: task.criterion, task: absolute(task.verify.prompt), session: task.verify.session, attempts: attempts("verifiers", task.criterion) });
        candidatesOf.set(`verify ${task.criterion}`, absolute(task.verify.candidates));
      }
    }
  }
  // The finishing round is decided only when nothing before it is open: until then a verdict can still come that needs none.
  const finishers: InstrumentPending["finishers"] = [];
  let finisherTasksMissing = false;
  if (walks.length + judges.length + verifiers.length === 0 && !verifierTasksMissing) {
    const passing = await passingOf(runDir, index.tasks.map((task) => ({ ...task, finish: null })), observations);
    for (const task of index.tasks) {
      // A round that was asked for again is open until its verdict comes, whatever the verdicts before it say.
      const standing = await standingVerdict(runDir, task, observations);
      if (!task.finish?.earlier?.length && !task.finish?.again && !pointsToFinish(standing) && passedOnPoints(passing, task.criterion, standing, observations.records).length === 0) continue;
      if (!task.finish) finisherTasksMissing = true;
      else if (!(await instrumentVerdictIsCurrent(runDir, task, "finish", observations))) {
        if (skipped(runDir, task.finish.output)) given.push(`afmaakronde ${task.criterion}`);
        else {
          finishers.push({ criterion: task.criterion, task: absolute(task.finish.prompt), session: task.finish.session, attempts: attempts("finishers", task.criterion) });
          candidatesOf.set(`finish ${task.criterion}`, absolute(task.finish.candidates));
        }
      }
    }
  }
  const phase = walks.length > 0 ? "walks" : judges.length > 0 ? "judges" : verifiers.length > 0 || verifierTasksMissing ? "verifiers" : finishers.length > 0 || finisherTasksMissing ? "finishers" : "done";
  const noteNl =
    phase === "walks"
      ? "Start per paginatype één agent met het opdrachtbestand. Draai daarna `tasks` opnieuw: dan komen de kandidaten bij de criteria."
      : phase === "judges"
        ? "Start per criterium één agent met het opdrachtbestand. Draai daarna `tasks` opnieuw: dan worden de opdrachten voor de verificatie geschreven."
        : phase === "verifiers"
          ? verifierTasksMissing
            ? "Alle beoordelingen zijn binnen. Draai `tasks` om de opdrachten voor de verificatie te schrijven."
            : "Start per criterium één agent met het opdrachtbestand voor de verificatie. Draai daarna `tasks` opnieuw: blijft een criterium open door het onderzoek zelf, dan komt er een opdracht voor de afmaakronde."
          : phase === "finishers"
            ? finisherTasksMissing
              ? "Alle verificaties zijn binnen en er zijn criteria die door het onderzoek zelf open bleven. Draai `tasks` om de opdrachten voor de afmaakronde te schrijven."
              : "Start per criterium één agent met het opdrachtbestand voor de afmaakronde: die meet wat ontbrak en komt tot een oordeel."
            : "Alles is beoordeeld en geverifieerd, en niets bleef open door het onderzoek zelf. Ga door met `evaluate`.";
  const bySize = <T extends { criterion: string }>(list: T[], round: string): T[] => longestFirst(list, (entry) => sizeOf(candidatesOf.get(`${round} ${entry.criterion}`) ?? ""));
  return {
    flow: INSTRUMENT_FLOW,
    phase,
    walks: longestFirst(walks, (walk) => sizeOf(walk.task)),
    judges: phase === "walks" ? [] : bySize(judges, "judge"),
    verifiers: phase === "verifiers" ? bySize(verifiers, "verify") : [],
    finishers: bySize(finishers, "finish"),
    skipped: given,
    noteNl,
  };
}

const stampNow = async (runDir: string, path: string, stamp: object): Promise<void> => void (await writeJson(join(runDir, stampOf(path)), { ...stamp, stampedAt: new Date().toISOString() }));

export async function checkWalk(runDir: string, pageType: string): Promise<string[]> {
  const index = await loadInstrumentIndex(runDir);
  const walk = index.walks.find((entry) => entry.pageType === pageType);
  if (!walk) return [`no walk for page type "${pageType}"; this run has walks for ${index.walks.map((entry) => `"${entry.pageType}"`).join(", ")}`];
  const sample = await readJson<{ items: unknown[] }>(join(runDir, "sample.json"));
  const labels = pageLabels(sample.items.length);
  const observations = loadObservations(runDir);
  const path = join(resolve(runDir), walk.output);
  let list: unknown;
  try {
    list = await readJson(path);
  } catch (error) {
    // Most often the write itself was refused or failed, in the same batch of tool calls as this check: nothing is there yet.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [`there is no list at ${path}: nothing was written there. Look at what the command or tool that should have written it answered; a refused or failed write leaves no file. Write the list there again (if you may not write there directly, write it in your own work folder and copy it with cp), and run this check only once the write has succeeded`];
    return [`cannot read ${path}: ${(error as Error).message.split("\n")[0]}. Write the list there as one JSON object, as the task shows under "Vorm van het resultaat"`];
  }
  const problems = validateCandidates(list, { pageType, pageLabels: labels, criteria: loadAllProcedures().procedures.map((procedure) => procedure.id), idPrefix: walk.page, observations: observations.index });
  if (problems.length === 0) await stampNow(runDir, walk.output, (await walkStamp(runDir, walk, observations.sha))!);
  return problems;
}

/** The text a quotation is looked up in: what an observation recorded of the page, a part of the dossier, or the saved copy of a page of the sample (by its label). */
export function sourceTexts(runDir: string, records: ReadonlyMap<string, ObservationRecordLike & { target?: unknown; page?: unknown }>, dossier: { evidence: Record<string, unknown>; legend: Record<string, unknown> }): (ref: string) => string | null {
  const cache = new Map<string, string | null>();
  const read = (ref: string): string | null => {
    const record = records.get(ref);
    if (record) return searchableText([record.result, record.target, (record.page as { title?: unknown } | null | undefined)?.title]);
    if (ref in dossier.evidence) return searchableText(dossier.evidence[ref]);
    const files = (dossier.legend[ref] as { files?: unknown } | undefined)?.files;
    if (typeof files !== "string") return null;
    return searchableText(["page.html", "text.txt"].map((name) => join(runDir, files, name)).filter((path) => existsSync(path)).map((path) => readFileSync(path, "utf8")));
  };
  return (ref) => {
    if (!cache.has(ref)) cache.set(ref, read(ref));
    return cache.get(ref)!;
  };
}

export async function checkInstrumentVerdict(runDir: string, criterionId: string, round: Round): Promise<string[]> {
  const index = await loadInstrumentIndex(runDir);
  const task = index.tasks.find((entry) => entry.criterion === criterionId);
  if (!task) return [`no task for criterion ${criterionId}`];
  const part = partOf(task, round);
  if (!part) return [round === "finish" ? "this criterion has no task for the finishing round: it comes only for a criterion the evaluation itself left open, once every verifier is in (run tasks again)" : "the task for the verification is not written yet; run tasks again once every judge verdict is in"];
  const observations = loadObservations(runDir);
  const dossierText = readFileSync(join(runDir, task.dossier), "utf8");
  const dossier = JSON.parse(dossierText) as { evidence: Record<string, unknown>; legend: Record<string, unknown>; site?: { baseUrl?: string; origins?: string[] } };
  let verdict: Verdict;
  try {
    verdict = await readJson<Verdict>(join(runDir, part.output));
  } catch (error) {
    return [`cannot read ${part.output}: ${(error as Error).message}`];
  }
  // Whose elements are someone else's is said at inventory; a run without it has no vendor to advise.
  const inventoryPath = join(runDir, "inventory.json");
  const vendorPrefixes = existsSync(inventoryPath) ? (await readJson<{ vendor?: { tagPrefixes?: string[] } }>(inventoryPath)).vendor?.tagPrefixes : undefined;
  const context = {
    criterion: criterionId,
    evidenceNames: [...Object.keys(dossier.evidence), "legend", "inventoryForApplicability", "siteStates"],
    pageLabels: Object.keys(dossier.legend),
    observations: observations.index,
    candidateIds: (await readJson<Candidate[]>(join(runDir, part.candidates))).map((candidate) => candidate.id),
    passCommands: task.passCommands,
    decisiveCommands: task.decisiveCommands,
    recommendationRules: task.recommendationRules ?? [],
    explainOnPass: rowsToExplain(dossier.evidence, task.passExplains ?? []),
    engineFailures: failedEngineRules(dossier.evidence),
    fileExists: (ref: string) => !ref.includes("..") && existsSync(join(runDir, ref)),
    sourceText: sourceTexts(runDir, observations.records, dossier),
    ...(dossier.site?.baseUrl ? { siteHosts: siteHosts(dossier.site) } : {}),
    ...(vendorPrefixes ? { vendorPrefixes } : {}),
  };
  let problems: string[];
  if (round === "judge") {
    problems = validateJudgeVerdict(verdict, { ...context, session: part.session });
    // The task says to read the dossier in full: a pass rests on it, so the parts the criterion counts on must have been read.
    if (verdict.outcome === "passed") problems.push(...unreadPartsProblems(dossier as unknown as Record<string, unknown>, dossierReads(readsOfSession(runDir, part.session), task.dossier, sha256(dossierText)), part.session));
  }
  else if (round === "finish") problems = validateFinish(verdict, { ...context, session: part.session, openPoints: task.finish!.points });
  else if (!(await instrumentVerdictIsCurrent(runDir, task, "judge", observations))) problems = ["the verdict of the judge must be validated, and unchanged since, before the verification"];
  else problems = validateVerification(verdict, { ...context, session: part.session, judge: await readJson<Verdict>(join(runDir, task.judge.output)) });
  problems.push(...budgetPointProblems(runDir, verdict, part.session));
  // Read only once the verdict has its form: it walks the findings and what they cite.
  if (problems.length === 0) problems.push(...frameFocusProblems(verdict, dossier.legend, observations.records));
  const permission = writesForRun(runDir);
  problems.push(...notSentPointProblems(verdict.missingNl, permission, permission ? writeBudget(runDir, permission, Date.now(), criterionSender(task.criterion)) : null));
  if (problems.length === 0) await stampNow(runDir, part.output, (await verdictStamp(runDir, task, round, observations))!);
  return problems;
}

/**
 * A point "budget op:" is only for a session that really ran out: one that extended its budget
 * as often as it may. Before that the agent extends and measures what it would have left open.
 */
export function budgetPointProblems(runDir: string, verdict: Partial<Verdict> | null, session: string): string[] {
  const points = Array.isArray(verdict?.missingNl) ? verdict.missingNl : [];
  const extended = extensionsOf(runDir, session).length;
  if (extended >= EXTENSION.max) return [];
  return points.flatMap((point, position) =>
    typeof point === "string" && openPoint(point).kind?.prefix === "budget op"
      ? [`missingNl[${position}]: "budget op:" may only stand in the verdict of a session that extended its budget ${EXTENSION.max} times, and session "${session}" did so ${extended} ${extended === 1 ? "time" : "times"}. Extend it (session extend --session ${session} --reason "<wat er nog gemeten moet worden>") and measure what is missing`]
      : [],
  );
}

/** What `skip`, `unskip` and `tasks --attempted` name: a walk by its page type, or a round of a criterion. */
export interface TaskName {
  pageType?: string | undefined;
  criterion?: string | undefined;
  round?: string | undefined;
}

/** The output of the walk or the round that is named, and the key its attempts are counted under; null when the run has no such task. */
function partNamed(index: InstrumentIndex, what: TaskName): { output: string; key: string } | null {
  if (what.pageType) {
    const walk = index.walks.find((entry) => entry.pageType === what.pageType);
    return walk ? { output: walk.output, key: `walks:${walk.pageType}` } : null;
  }
  const task = what.criterion ? index.tasks.find((entry) => entry.criterion === what.criterion) : undefined;
  if (!task) return null;
  const round = what.round ?? "judge";
  const part = round === "judge" ? task.judge : round === "final" ? task.verify : round === "finish" ? task.finish : null;
  const phase: Phase = round === "final" ? "verifiers" : round === "finish" ? "finishers" : "judges";
  return part ? { output: part.output, key: `${phase}:${task.criterion}` } : null;
}

const NAMED_NL = "--page-type <id> or --criterion <id> [--round judge|final|finish] that exists in this run";

/** Record that a walk or a verdict will not come, so the next phase is not held up by it. */
export async function skip(runDir: string, what: TaskName, reasonNl: string, kind: string = "geen geldig resultaat"): Promise<string> {
  const part = partNamed(await loadInstrumentIndex(runDir), what);
  if (!part) throw new Error(`skip needs ${NAMED_NL}`);
  if (reasonNl.trim().length < 10) throw new Error("skip needs --reason: why no result will come");
  if (!(SKIP_KINDS as readonly string[]).includes(kind)) throw new Error(`skip --kind is ${SKIP_KINDS.map((entry) => `"${entry}"`).join(" or ")}, not "${kind}"`);
  await writeJson(join(runDir, skipOf(part.output)), { reasonNl, kind, at: new Date().toISOString() });
  return skipOf(part.output);
}

/** Take back a `skip`: the task is open again, with its attempts counted from zero. */
export async function unskip(runDir: string, what: TaskName): Promise<string> {
  const index = await loadInstrumentIndex(runDir);
  const part = partNamed(index, what);
  if (!part) throw new Error(`unskip needs ${NAMED_NL}`);
  if (!skipped(runDir, part.output)) throw new Error(`unskip: ${part.key} is niet overgeslagen`);
  rmSync(join(runDir, skipOf(part.output)));
  if (index.attempts && part.key in index.attempts) {
    delete index.attempts[part.key];
    if (Object.keys(index.attempts).length === 0) delete index.attempts;
    await writeJson(join(runDir, INDEX), index);
  }
  return skipOf(part.output);
}

/**
 * Count one attempt for each task named as `<phase>:<id>` (`walks:start`, `judges:1.4.3`): its agent
 * came back, and whether its result holds shows in `pending`. The workflow names only the agents that
 * came back without an error, so a limit or a failure of the model counts no attempt.
 */
export async function recordAttempts(runDir: string, keys: string[]): Promise<Record<string, number>> {
  const index = await loadInstrumentIndex(runDir);
  const attempts = { ...(index.attempts ?? {}) };
  const rounds: Record<Phase, string | undefined> = { walks: undefined, judges: "judge", verifiers: "final", finishers: "finish" };
  for (const key of keys) {
    const at = key.indexOf(":");
    const phase = key.slice(0, at) as Phase;
    const id = key.slice(at + 1);
    if (at < 0 || !PHASES.includes(phase) || !partNamed(index, phase === "walks" ? { pageType: id } : { criterion: id, round: rounds[phase] })) throw new Error(`--attempted: "${key}" is no task of this run; write <phase>:<id>, with phase ${PHASES.join(", ")}`);
    attempts[key] = (attempts[key] ?? 0) + 1;
  }
  await writeJson(join(runDir, INDEX), { ...index, attempts });
  return attempts;
}
