import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
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
  citedObservations,
  FINISH_FACTOR,
  indexObservations,
  KINDS_FOR_AGAIN,
  notSentPointProblems,
  openPoint,
  searchableText,
  validateCandidates,
  validateFinish,
  validateJudgeVerdict,
  validateVerification,
  type Candidate,
  type CandidateList,
  type ObservationIndex,
  type ObservationRecordLike,
  type Verdict,
} from "../lib/verdict.ts";
import { CRITERIA, criterionById } from "../lib/wcag.ts";
import { agentLoginNl } from "../lib/login.ts";
import { readsAllowedNl } from "../lib/reads.ts";
import { WRITES_BLOCKED_NL, writesAllowedNl, writesForRun } from "../lib/writes.ts";
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

/**
 * The open points a finishing round has to settle, or null when the criterion needs none. It
 * needs one when the evaluation itself left the question open: the final verdict is "cantTell"
 * with a point about coverage, budget or a probe, or no final verdict came at all. Every open
 * point is listed, also one for the owner of the site: the agent may settle it or leave it.
 */
export function pointsToFinish(standing: Standing): string[] | null {
  if (standing.round !== "final") return [...(standing.verdict?.outcome === "cantTell" ? (standing.verdict.missingNl ?? []) : []), standing.round === "judge" ? NO_FINAL_NL : NO_VERDICT_NL];
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

/**
 * The open points a new finishing round for this criterion starts from, or why it cannot get one.
 * It can when its final verdict is open with a point an instrument can measure once the part of
 * the site loads again or the probe works: "niet bereikbaar" or "proef werkte niet".
 */
async function pointsForAgain(runDir: string, previous: InstrumentIndex | null, id: string, observations: ReturnType<typeof loadObservations>): Promise<string[] | string> {
  if (!criterionById(id)) return `--again: "${id}" is geen succescriterium`;
  const task = previous?.tasks.find((entry) => entry.criterion === id);
  if (!previous || !task) return `--again: ${id} heeft geen opdracht in deze run`;
  if (!previous.finishDecided) return `--again: ${id} kan nog geen nieuwe afmaakronde krijgen, want de afmaakronde is nog niet aan de beurt; draai eerst de fasen ervoor af (tasks en pending)`;
  const counting = await countingOf(runDir, task, observations);
  const kinds = KINDS_FOR_AGAIN.map((kind) => `"${kind}"`).join(" of ");
  if (!counting || counting.verdict.outcome !== "cantTell" || !(counting.verdict.missingNl ?? []).some((point) => (KINDS_FOR_AGAIN as readonly string[]).includes(openPoint(point).kind?.prefix ?? ""))) {
    return `--again: het eindoordeel van ${id} staat niet open met een punt ${kinds}; een nieuwe afmaakronde is alleen voor wat een instrument kan meten zodra het deel van de site weer laadt of de proef werkt`;
  }
  if (counting.round === "final" && task.finish && !skipped(runDir, task.finish.output)) return `--again: de afmaakronde van ${id} staat al klaar; pending noemt haar onder finishers`;
  return counting.verdict.missingNl ?? [];
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

/** What other criteria's judges saw that belongs to this one, as candidates for its verifier. */
function crossCandidates(verdicts: Map<string, Verdict>, criterion: string): Candidate[] {
  const result: Candidate[] = [];
  for (const [from, verdict] of [...verdicts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    (verdict.crossCandidates ?? [])
      .filter((cross) => cross.criterion === criterion)
      .forEach((cross, position) => result.push({ id: `X${from.replaceAll(".", "")}-${String(position + 1).padStart(2, "0")}`, criterion, page: cross.page, where: cross.where, evidence: cross.evidence, noteNl: cross.noteNl, support: "bekeken" }));
  }
  return result;
}

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
  const writesNl = `${run.writes ? `ja, ${writesAllowedNl(run.writes)}` : `nee, ${WRITES_BLOCKED_NL}`}${readsNl ? `. Wel gaat door: ${readsNl} (in het dossier onder \`reads\`)` : ""}`;
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
    const walk: WalkTask = { pageType: type.id, page: page.label, prompt: join("rondgang", `${type.id}.md`), output: join("rondgang", `${type.id}.json`), session, maxCommands: walkLimits.commands, maxMinutes: walkLimits.minutes };
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
    const judge = { prompt: join(dir, "beoordeel.md"), output: join("verdicts", procedure.id, "oordeel.json"), candidates: join(dir, "kandidaten.json"), session: judgeSession, maxCommands: judgeLimits.commands, maxMinutes: judgeLimits.minutes };
    await writeJson(join(runDir, judge.candidates), judgeCandidates);
    const shared = { ...base, id: criterion.id, title: criterion.titleNl, level: criterion.level, dossier: join(absoluteRun, dossierPath), dossierParts: dossierPartsNl(dossier), gate: join(absoluteRun, "gate.json"), writes: writesNl, procedure: procedure.body };
    const writeJudge = async (): Promise<void> => writeFileAtomic(
      join(runDir, judge.prompt),
      fill(templates.beoordeel, { ...shared, session: judge.session, workDir: await makeWorkDir(runDir, judge.session), workName: judge.session, maxCommands: String(judge.maxCommands), maxMinutes: String(judge.maxMinutes), candidates: join(absoluteRun, judge.candidates), notWalked: join(absoluteRun, NOT_WALKED), output: join(absoluteRun, judge.output), check: `node ${cli} check-verdict --run ${absoluteRun} --criterion ${criterion.id} --round judge` }),
    );
    const task: InstrumentTask = { criterion: criterion.id, titleNl: criterion.titleNl, procedureVersion: procedure.version, procedureSha256: procedure.sha256, dossier: dossierPath, dossierSha256, passCommands: procedure.passCommands, decisiveCommands: procedure.decisiveCommands, recommendationRules: procedure.recommendationRules, judge, verify: null };
    await writeJudge();
    if (sessionStarted(runDir, judge.session) && !(await instrumentVerdictIsCurrent(runDir, task, "judge", observations))) {
      judge.session = nextSession(runDir, `b-${digits}`);
      await writeJudge();
    }
    tasks.push(task);
    earlierVerify.set(criterion.id, earlier ?? null);
  }

  // Phase 3: a verifier per criterion, once every judge is in (or given up on).
  const judged = new Map<string, Verdict>();
  let judgesOpen = 0;
  for (const task of tasks) {
    if (await instrumentVerdictIsCurrent(runDir, task, "judge", observations)) judged.set(task.criterion, await readJson<Verdict>(join(runDir, task.judge.output)));
    else if (!skipped(runDir, task.judge.output)) judgesOpen++;
  }
  let verifiers = 0;
  if (judgesOpen === 0) {
    for (const task of tasks) {
      const verdict = judged.get(task.criterion);
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
      const verify = { prompt: join(dir, "verifieer.md"), output: join("verdicts", task.criterion, "final.json"), candidates: join(dir, "kandidaten-verificatie.json"), session: was?.verify?.session ?? `v-${task.criterion.replaceAll(".", "")}`, maxCommands: verifyLimits.commands, maxMinutes: verifyLimits.minutes };
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
    for (const task of tasks) {
      const standing = await standingVerdict(runDir, task, observations);
      const was = earlierVerify.get(task.criterion) ?? null;
      // A round that ran again keeps the points it was given, and the verdicts before it stay where they were set aside.
      let earlierRounds = was?.finish?.earlier ?? [];
      let points = earlierRounds.length > 0 && was?.finish ? was.finish.points : pointsToFinish(standing);
      if (again.has(task.criterion)) {
        if (was?.finish) earlierRounds = [...earlierRounds, ...setFinishAside(runDir, was.finish)];
        points = again.get(task.criterion)!;
      }
      if (!points) continue;
      const procedure = procedures.find((entry) => entry.id === task.criterion)!;
      const criterion = criterionById(task.criterion)!;
      const dir = join("tasks", task.criterion);
      const digits = task.criterion.replaceAll(".", "");
      // What the verifier ruled on with an observation of its own is settled; what it left open, and everything nobody verified, is for this round.
      const all = await readJson<Candidate[]>(join(runDir, (task.verify ?? task.judge).candidates));
      const finishLimits = finishBudget(BUDGETS.finish, { commands: task.judge.maxCommands, minutes: task.judge.maxMinutes }, BUDGETS.judge);
      const ruled = new Set(standing.round === "final" ? (standing.verdict!.candidates ?? []).filter((ruling) => ruling.ruling !== "open").map((ruling) => ruling.id) : []);
      const finish: NonNullable<InstrumentTask["finish"]> = { prompt: join(dir, "afmaak.md"), output: join("verdicts", task.criterion, "afmaak.json"), candidates: join(dir, "kandidaten-afmaak.json"), session: was?.finish?.session ?? `a-${digits}`, maxCommands: finishLimits.commands, maxMinutes: finishLimits.minutes, points, ...(earlierRounds.length > 0 ? { earlier: earlierRounds } : {}) };
      await writeJson(join(runDir, finish.candidates), all.filter((candidate) => !ruled.has(candidate.id)));
      const standingNl =
        standing.round === "final"
          ? `Het eindoordeel van de verifieerder: \`${join(absoluteRun, task.verify!.output)}\`. Het oordeel van de beoordelaar daarvoor: \`${join(absoluteRun, task.judge.output)}\`.`
          : standing.round === "judge"
            ? `Het oordeel van de beoordelaar: \`${join(absoluteRun, task.judge.output)}\`. Een verifieerder heeft het niet gecontroleerd: neem er niets uit over zonder het zelf te meten.`
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

  const index: InstrumentIndex = { flow: INSTRUMENT_FLOW, templates: Object.fromEntries(Object.entries(templates).map(([name, text]) => [name, sha256(text)])), withoutProcedure: missing, only, walks, tasks, finishDecided };
  await writeJson(join(runDir, INDEX), index);
  await writeManifest(runDir, { command: "tasks", startedAt, flow: INSTRUMENT_FLOW, walks: walks.length, criteria: tasks.length, verifiers, finishers, withoutProcedure: missing.length });
  return { walks: walks.length, judges: tasks.length, verifiers, finishers };
}

export interface InstrumentPending {
  flow: typeof INSTRUMENT_FLOW;
  /** The first phase with work left; run `tasks` again when a phase is finished. Each list is longest expected first (walks by the size of the task file, the others by the size of their candidates file), equal sizes in the order of the index. */
  phase: "walks" | "judges" | "verifiers" | "finishers" | "done";
  walks: { pageType: string; task: string; session: string }[];
  judges: { criterion: string; task: string; session: string }[];
  verifiers: { criterion: string; task: string; session: string }[];
  /** The finishing round: one task per criterion the evaluation itself left open. Empty when there is none. */
  finishers: { criterion: string; task: string; session: string }[];
  /** Given up on with `skip`: no walk, or no verdict, will come. */
  skipped: string[];
  noteNl: string;
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
  const given: string[] = [];
  const walks: InstrumentPending["walks"] = [];
  for (const walk of index.walks) {
    if (await walkIsCurrent(runDir, walk, observations)) continue;
    if (skipped(runDir, walk.output)) given.push(`rondgang ${walk.pageType}`);
    else walks.push({ pageType: walk.pageType, task: absolute(walk.prompt), session: walk.session });
  }
  const judges: InstrumentPending["judges"] = [];
  const verifiers: InstrumentPending["verifiers"] = [];
  const candidatesOf = new Map<string, string>();
  let verifierTasksMissing = false;
  for (const task of index.tasks) {
    if (!(await instrumentVerdictIsCurrent(runDir, task, "judge", observations))) {
      if (skipped(runDir, task.judge.output)) given.push(`beoordeling ${task.criterion}`);
      else {
        judges.push({ criterion: task.criterion, task: absolute(task.judge.prompt), session: task.judge.session });
        candidatesOf.set(`judge ${task.criterion}`, absolute(task.judge.candidates));
      }
      continue;
    }
    if (!task.verify) verifierTasksMissing = true;
    else if (!(await instrumentVerdictIsCurrent(runDir, task, "final", observations))) {
      if (skipped(runDir, task.verify.output)) given.push(`verificatie ${task.criterion}`);
      else {
        verifiers.push({ criterion: task.criterion, task: absolute(task.verify.prompt), session: task.verify.session });
        candidatesOf.set(`verify ${task.criterion}`, absolute(task.verify.candidates));
      }
    }
  }
  // The finishing round is decided only when nothing before it is open: until then a verdict can still come that needs none.
  const finishers: InstrumentPending["finishers"] = [];
  let finisherTasksMissing = false;
  if (walks.length + judges.length + verifiers.length === 0 && !verifierTasksMissing) {
    for (const task of index.tasks) {
      // A round that was asked for again is open until its verdict comes, whatever the verdicts before it say.
      if (!task.finish?.earlier?.length && !pointsToFinish(await standingVerdict(runDir, task, observations))) continue;
      if (!task.finish) finisherTasksMissing = true;
      else if (!(await instrumentVerdictIsCurrent(runDir, task, "finish", observations))) {
        if (skipped(runDir, task.finish.output)) given.push(`afmaakronde ${task.criterion}`);
        else {
          finishers.push({ criterion: task.criterion, task: absolute(task.finish.prompt), session: task.finish.session });
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
  if (!walk) return [`no walk for page type ${pageType}`];
  const sample = await readJson<{ items: unknown[] }>(join(runDir, "sample.json"));
  const labels = pageLabels(sample.items.length);
  const observations = loadObservations(runDir);
  let list: unknown;
  try {
    list = await readJson(join(runDir, walk.output));
  } catch (error) {
    return [`cannot read ${walk.output}: ${(error as Error).message}`];
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
  problems.push(...notSentPointProblems(verdict.missingNl, writesForRun(runDir)));
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

/** Record that a walk or a verdict will not come, so the next phase is not held up by it. */
export async function skip(runDir: string, what: { pageType?: string | undefined; criterion?: string | undefined; round?: string | undefined }, reasonNl: string): Promise<string> {
  const index = await loadInstrumentIndex(runDir);
  let output: string | undefined;
  if (what.pageType) output = index.walks.find((walk) => walk.pageType === what.pageType)?.output;
  else if (what.criterion) {
    const task = index.tasks.find((entry) => entry.criterion === what.criterion);
    output = what.round === "final" ? task?.verify?.output : what.round === "finish" ? task?.finish?.output : task?.judge.output;
  }
  if (!output) throw new Error("skip needs --page-type <id> or --criterion <id> [--round judge|final|finish] that exists in this run");
  if (reasonNl.trim().length < 10) throw new Error("skip needs --reason: why no result will come");
  await writeJson(join(runDir, skipOf(output)), { reasonNl, at: new Date().toISOString() });
  return skipOf(output);
}
