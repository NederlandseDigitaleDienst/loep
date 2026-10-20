import { execFileSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readJson, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import type { CriterionOutcome, Evaluation } from "../lib/evaluation.ts";
import { stepStart, toolchain, writeManifest, type Manifest } from "../lib/manifest.ts";
import { costOf, PRICES, type Price, type Tokens } from "../lib/prices.ts";
import { ROLE_NL, roleOfSession, type AgentRole } from "../lib/models.ts";
import { agentPhaseTimings, type AgentPhaseId } from "../lib/timing.ts";
import { compareCriterionIds, criterionById } from "../lib/wcag.ts";
import { findingsSummary, type FindingsSummary, type ReferenceClass } from "./compare-findings.ts";
import type { ReferenceAudit } from "./compare.ts";
import { gaps } from "./gaps.ts";

/*
 * Measuring a variant of the code on frozen evidence (validatie/verbruik/README.md, "Hoe we meten").
 * `variant` copies a run whose sweep is done and leaves out everything the agent phases wrote, so
 * `tasks` and `pending` start the walks, judges, verifiers and finishing round again on the same
 * evidence. `compare-variants` lays runs of the baseline and of a variant side by side: per
 * criterion, per defect of the answer key, open points, and what each role used. Whether the
 * variant is "not worse" is a paired comparison over the defects and criteria both sides share,
 * with an interval from a bootstrap and a margin fixed before measuring.
 */

export const VARIANT_FILE = "variant.json";

/** What the agent phases wrote, and what was made from their verdicts afterwards. A copy leaves these out. */
const AGENT_OUTPUTS = ["tasks", "rondgang", "verdicts", "evaluation.json", "report", "signed", "verklaring", "verklaring-invoer.json", "evidence-index.json", "antwoorden", "compare", VARIANT_FILE];
/** Points at the session process of the run it was made in: a copy that kept it would send its commands to that run. */
const DAEMON_POINTER = "session-daemon.json";
const AGENT_ROLES: ReadonlySet<AgentRole> = new Set(["walk", "judge", "verifier", "finisher"]);
/** A session of an agent phase, or the work folder of the optional step after `merge`. */
const ofAgentPhase = (session: string): boolean => session === "samenvoeg" || AGENT_ROLES.has(roleOfSession(session) as AgentRole);

export interface VariantRecord {
  schema: "loep/variant/1";
  name: string;
  noteNl: string | null;
  madeAt: string;
  /** The run whose sweep the copy keeps, by folder name; the code that last wrote its manifest; and its own variant when it was a copy too. */
  from: { run: string; toolbox: Manifest["toolbox"] | null; variant: string | null };
  /** The code that made the copy. The agent phases of the copy run with this same code. */
  toolbox: Manifest["toolbox"];
  leftOut: { paths: string[]; sessions: string[]; recipes: string[] };
}

/** Every value under a key "recipe" in the site model: the recipes the sweep stands on. */
function recipesOfSiteModel(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) recipesOfSiteModel(entry, found);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "recipe" && typeof entry === "string") found.add(entry);
      else recipesOfSiteModel(entry, found);
    }
  }
  return found;
}

function clone(sources: string[], targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  if (sources.length === 0) return;
  // Node makes a full copy on macOS even with COPYFILE_FICLONE; cp -c clones on APFS. Elsewhere Node clones where the file system can.
  if (platform() === "darwin") {
    try {
      execFileSync("cp", ["-c", "-R", ...sources, targetDir], { stdio: ["ignore", "ignore", "pipe"] });
      return;
    } catch {
      // A volume that cannot clone: copy below.
    }
  }
  for (const source of sources) cpSync(source, join(targetDir, basename(source)), { recursive: true, force: true, mode: constants.COPYFILE_FICLONE });
}

const readIfThere = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * Copy a run whose sweep is done, without what the agent phases wrote: their task files, walks,
 * verdicts and stamps, their sessions and work folders, the recipes they saved, and the
 * evaluation, report, seal and comparisons made from their verdicts. The copy records which run
 * it came from and which code made it.
 */
export async function variant(options: { run: string; out: string; name: string; noteNl?: string | undefined }): Promise<{ out: string; record: VariantRecord }> {
  const startedAt = stepStart();
  const run = resolve(options.run);
  const out = resolve(options.out);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.name)) throw new Error(`--name "${options.name}": een naam van letters, cijfers, punt, - en _, zoals nulmeting of dossier-commando`);
  if (!existsSync(join(run, "site.json")) || !existsSync(join(run, "gate.json"))) throw new Error(`${options.run} heeft geen afgeronde veegronde (site.json en gate.json): kopieer een run waarvan collect, contrast, states, documents en gate klaar zijn`);
  if (existsSync(out)) throw new Error(`${options.out} bestaat al: kies een nieuwe map voor de kopie`);
  if (out.startsWith(run + sep)) throw new Error("de kopie kan niet in de run zelf staan");

  // A recipe the site model names that an agent later saved over is no longer the sweep's: then there is no frozen sweep to copy.
  const siteRecipes = recipesOfSiteModel(readIfThere(join(run, "site.json")));
  const recipesDir = join(run, "recipes");
  const leftOut: VariantRecord["leftOut"] = { paths: [], sessions: [], recipes: [] };
  const keptRecipes: string[] = [];
  for (const file of existsSync(recipesDir) ? readdirSync(recipesDir).sort() : []) {
    const savedBy = file.endsWith(".json") ? readIfThere<{ savedBy?: unknown }>(join(recipesDir, file))?.savedBy : undefined;
    if (typeof savedBy === "string" && ofAgentPhase(savedBy)) {
      const name = file.slice(0, -5);
      if (siteRecipes.has(name)) throw new Error(`recept ${name} hoort bij het sitemodel, maar sessie ${savedBy} heeft het later overschreven: de veegronde van deze run is niet meer zoals ze was`);
      leftOut.recipes.push(name);
    } else keptRecipes.push(join(recipesDir, file));
  }

  const plain: string[] = [];
  for (const name of readdirSync(run).sort()) {
    if (AGENT_OUTPUTS.includes(name) || name === DAEMON_POINTER) leftOut.paths.push(name);
    else if (name !== "observations" && name !== "werk" && name !== "recipes") plain.push(join(run, name));
  }
  mkdirSync(out, { recursive: true });
  clone(plain, out);
  if (existsSync(recipesDir)) clone(keptRecipes, join(out, "recipes"));
  const sessions = new Set<string>();
  for (const dir of ["observations", "werk"]) {
    if (!existsSync(join(run, dir))) continue;
    const children = readdirSync(join(run, dir)).sort();
    for (const name of children.filter(ofAgentPhase)) sessions.add(name);
    clone(children.filter((name) => !ofAgentPhase(name)).map((name) => join(run, dir, name)), join(out, dir));
  }
  leftOut.sessions = [...sessions].sort();

  const record: VariantRecord = {
    schema: "loep/variant/1",
    name: options.name,
    noteNl: options.noteNl?.trim() || null,
    madeAt: new Date().toISOString(),
    from: { run: basename(run), toolbox: readIfThere<Manifest>(join(run, "manifest.json"))?.toolbox ?? null, variant: readIfThere<VariantRecord>(join(run, VARIANT_FILE))?.name ?? null },
    toolbox: toolchain(null).toolbox,
    leftOut,
  };
  await writeJson(join(out, VARIANT_FILE), record);
  await writeManifest(out, { command: "variant", startedAt, name: options.name, from: basename(run) });
  return { out, record };
}

/* ------------------------------------------------------------------------------------------ */

/**
 * What the agents of one run used, counted outside the run: a run records no tokens and no
 * turns, only the transcripts of the agents do. One row per agent. `session` is the session the
 * agent ran in (b-111, v-111, r-start, a-132); an agent without a session, such as the one that
 * asks for the state between phases, names its `role` instead.
 */
export interface UsageFile {
  schema: "loep/verbruik/1";
  /** The folder name of the run. */
  run: string;
  /** Where the numbers come from, in one sentence. */
  sourceNl?: string;
  /** The model of an agent that names none. */
  model?: string;
  /** Prices for models that `PRICES` does not have, or other ones. */
  prices?: Record<string, Price>;
  agents: (Tokens & { session?: string; role?: string; model?: string; turns?: number })[];
}

export interface RoleUse {
  role: string;
  roleNl: string;
  /** Sessions in the run, or rows in the usage file when there are more. */
  agents: number;
  /** Commands over the sessions of this role, as the session files count them. Null when the role has no session. */
  commands: number | null;
  /** Over the sessions: the time between start and stop of each. Null when the role has no session. */
  sessionSeconds: number | null;
  tokens: Tokens | null;
  turns: number | null;
  /** Null without tokens, or when an agent ran on a model without a price. */
  costUsd: number | null;
}

export interface RunResult {
  run: string;
  side: "baseline" | "variant";
  /** The name in variant.json, or null for a run that is no copy. */
  variant: string | null;
  commit: string | null;
  criteria: string[];
  outcomes: Record<string, CriterionOutcome | null>;
  /** Findings in the evaluation per criterion of the scope. */
  findings: Record<string, number>;
  /** Per defect of the answer key in scope: the class both classifications agree on, "oneens" when they differ, or null when the run has no current classification. */
  defects: Record<string, ReferenceClass | "oneens" | null>;
  /** Why the run has no classes per defect, or null. */
  defectsNl: string | null;
  /** Open points that still stand in the verdict that counts, per kind, over the criteria of the scope. */
  openPoints: Record<string, number>;
  /** The same open points per criterion of the scope. */
  openPointsByCriterion: Record<string, number>;
  /**
   * Per criterion of the scope: findings of the run that belong to no defect of the answer key,
   * because not both classifications of `compare --findings` name them under one. Null without a
   * valid classification.
   */
  falseReports: Record<string, number> | null;
  roles: RoleUse[];
}

export interface CriterionRow {
  criterion: string;
  titleNl: string;
  /** Whether the answer key fails this criterion. */
  keyFails: boolean;
  baseline: (CriterionOutcome | null)[];
  variant: (CriterionOutcome | null)[];
  /** Share of the pairs of baseline runs that put the criterion in a different class (see `classOf`); null with fewer than two runs. */
  spreadBaseline: number | null;
  /** The same over the pairs of variant runs. */
  spreadVariant: number | null;
  /** The same over the pairs of one baseline and one variant run: a difference to read against the two spreads. */
  spreadBetween: number | null;
}

export interface DefectRow {
  id: string;
  criterion: string;
  descriptionNl: string;
  baseline: (ReferenceClass | "oneens" | null)[];
  variant: (ReferenceClass | "oneens" | null)[];
  /** "gevonden" over the runs that were classified, as [found, classified]. */
  foundBaseline: [number, number];
  foundVariant: [number, number];
}

/** A value with its 95% interval from the bootstrap. */
export interface Estimate {
  value: number;
  low: number;
  high: number;
}

/** A paired comparison: both sides on the same units, the difference is variant minus baseline. */
export interface PairedTest {
  /** Units in the comparison: defects of the key, or criteria. */
  units: number;
  /** Why units were left out, or null. */
  leftOutNl: string | null;
  baseline: Estimate;
  variant: Estimate;
  difference: Estimate;
}

export interface Agreement {
  runs: number;
  /** Criteria in the same class in every run, as [same, criteria]. */
  unanimous: [number, number];
  /** Fleiss' kappa over criteria and runs; null with fewer than two runs, or when every run put every criterion in one and the same class. */
  kappa: number | null;
}

export interface Verdict {
  /** The margins, the seed and the number of resamples the verdict was made with. */
  margin: number;
  reportMargin: number;
  seed: number;
  resamples: number;
  /** Share of the defects of the key found per run; null when no defect was classified on both sides. Passes when the lower bound of the difference lies above -margin. */
  found: (PairedTest & { ok: boolean }) | null;
  /** Unjustified reports per run; null when one of the sides has no run with a valid classification. Passes when the upper bound of the difference lies below reportMargin. */
  falseReports: (PairedTest & { ok: boolean }) | null;
  /** Open points per run, for information: not part of the verdict. */
  openPoints: PairedTest;
  /** Both tests that could be made pass; null when neither could be made. */
  notWorse: boolean | null;
}

export interface VariantComparison {
  schema: "loep/variant-comparison/2";
  reference: string;
  criteria: string[];
  /** Runs whose criteria differ from those of the first run, as a warning. */
  scopeNl: string | null;
  runs: RunResult[];
  rows: CriterionRow[];
  defects: DefectRow[];
  /** How alike the runs of each side are, over the criteria; `variant` is null without variant runs. */
  agreement: { baseline: Agreement; variant: Agreement | null };
  /** Null without variant runs. */
  verdict: Verdict | null;
}

/**
 * The margins of "not worse", fixed before measuring (validatie/verbruik/README.md, "Hoe we meten").
 *
 * MARGIN: the variant may find at most 5 percentage points fewer of the defects of the key, with
 * 95% confidence: the lower bound of the interval of the difference has to lie above -0.05. On
 * the 79 defects of the testsite that is about four defects; a wider margin lets through a variant
 * that misses defects an audit should report. It is strict: on the 29 defects under the nine
 * criteria of the measurement, with three runs per side, a variant that is just as good passes it
 * only about four times in ten when a fifth of the defects is found in some runs and not in others
 * (a simulation; about eight in ten at 0.10). Set --margin from the spread of the baseline, before
 * the variant is measured.
 *
 * REPORT_MARGIN: the variant may make less than one unjustified report per run more than the
 * baseline, with 95% confidence: the upper bound of the interval of the difference has to lie
 * below 1. A report too many is a finding a site owner fixes for nothing, so the margin stays at
 * one per run of nine criteria.
 *
 * The interval comes from RESAMPLES draws with replacement over the defects (over the criteria
 * for reports). Each draw takes the same units for both sides, because both work on the same
 * frozen sweep. SEED makes the interval the same every time the command runs.
 */
export const MARGIN = 0.05;
export const REPORT_MARGIN = 1;
export const SEED = 20261020;
export const RESAMPLES = 10_000;

export interface CompareVariantsOptions {
  baseline: string[];
  variant?: string[] | undefined;
  reference: string;
  usage?: string[] | undefined;
  /** Defaults: MARGIN, REPORT_MARGIN and SEED. */
  margin?: number | undefined;
  reportMargin?: number | undefined;
  seed?: number | undefined;
  /** For tests: the classes per defect and per finding of the run, instead of the current classifications of `compare --findings`. */
  findings?: (runDir: string) => Promise<Pick<FindingsSummary, "findings" | "ownFindings">>;
}

const PHASE_ROLE: Record<AgentPhaseId, AgentRole> = { walks: "walk", judges: "judge", verifiers: "verifier", finishers: "finisher" };
const ROLE_ORDER = ["walk", "judge", "verifier", "finisher"];
const emptyTokens = (): Tokens => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function readUsage(path: string): UsageFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as UsageFile;
  if (file.schema !== "loep/verbruik/1" || typeof file.run !== "string" || !Array.isArray(file.agents)) throw new Error(`${path}: geen verbruiksbestand (schema loep/verbruik/1 met run en agents)`);
  file.agents.forEach((agent, position) => {
    if (!agent.session && !agent.role) throw new Error(`${path}: agents[${position}] noemt geen session en geen role`);
    for (const key of ["input", "cacheWrite", "cacheRead", "output"] as const) if (!isCount(agent[key])) throw new Error(`${path}: agents[${position}].${key} is geen aantal tokens`);
    if (agent.turns !== undefined && !isCount(agent.turns)) throw new Error(`${path}: agents[${position}].turns is geen aantal`);
  });
  return file;
}

/** What each role of a run used: sessions, commands and time from the run, tokens, turns and cost from the usage file when there is one. */
function rolesOf(runDir: string, usage: UsageFile | null): RoleUse[] {
  const roles = new Map<string, RoleUse>();
  const roleOf = (key: string): RoleUse => {
    if (!roles.has(key)) roles.set(key, { role: key, roleNl: ROLE_NL[key as AgentRole] ?? key, agents: 0, commands: null, sessionSeconds: null, tokens: null, turns: null, costUsd: null });
    return roles.get(key)!;
  };
  for (const phase of agentPhaseTimings(runDir)) {
    const use = roleOf(PHASE_ROLE[phase.phase]);
    use.agents = phase.agents;
    use.sessionSeconds = phase.sumSeconds;
  }
  const root = join(runDir, "observations");
  for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
    const role = roleOfSession(name);
    const commands = readIfThere<{ commands?: unknown }>(join(root, name, "session.json"))?.commands;
    if (!role || !AGENT_ROLES.has(role) || !isCount(commands)) continue;
    const use = roleOf(role);
    use.commands = (use.commands ?? 0) + commands;
  }
  if (usage) {
    const rows = new Map<string, number>();
    const unpriced = new Set<string>();
    for (const agent of usage.agents) {
      const key = agent.role ?? roleOfSession(agent.session!) ?? agent.session!;
      const use = roleOf(key);
      rows.set(key, (rows.get(key) ?? 0) + 1);
      const tokens = (use.tokens ??= emptyTokens());
      for (const kind of ["input", "cacheWrite", "cacheRead", "output"] as const) tokens[kind] += agent[kind];
      if (agent.turns !== undefined) use.turns = (use.turns ?? 0) + agent.turns;
      const model = agent.model ?? usage.model;
      const price = model ? (usage.prices?.[model] ?? PRICES[model]) : undefined;
      if (!price) unpriced.add(key);
      else use.costUsd = (use.costUsd ?? 0) + costOf(agent, price);
    }
    for (const [key, count] of rows) {
      const use = roleOf(key);
      use.agents = Math.max(use.agents, count);
      if (unpriced.has(key)) use.costUsd = null;
    }
  }
  const rank = (key: string): number => (ROLE_ORDER.includes(key) ? ROLE_ORDER.indexOf(key) : ROLE_ORDER.length);
  return [...roles.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role));
}

async function runResult(runDir: string, side: RunResult["side"], reference: ReferenceAudit, usage: UsageFile | null, findings: NonNullable<CompareVariantsOptions["findings"]>): Promise<RunResult> {
  const index = readIfThere<{ tasks?: { criterion: string }[] }>(join(runDir, "tasks", "index.json"));
  if (!index?.tasks) throw new Error(`${runDir} heeft geen opdrachten (tasks/index.json): draai tasks en de fasen van de agents eerst`);
  const criteria = index.tasks.map((task) => task.criterion).sort(compareCriterionIds);
  const evaluationPath = join(runDir, "evaluation.json");
  if (!existsSync(evaluationPath)) throw new Error(`${runDir} heeft geen evaluation.json: draai evaluate eerst`);
  const evaluation = await readJson<Evaluation>(evaluationPath);
  const byId = new Map(evaluation.criteria.map((criterion) => [criterion.id, criterion]));
  const inScope = (criterion: string): boolean => criteria.includes(criterion);

  const defects: RunResult["defects"] = {};
  let defectsNl: string | null = null;
  let falseReports: RunResult["falseReports"] = null;
  const keyFindings = (reference.findings ?? []).filter((finding) => inScope(finding.criterion));
  try {
    const summary = await findings(runDir);
    const classified = new Map(summary.findings.map((finding) => [finding.id, finding]));
    for (const finding of keyFindings) {
      const entry = classified.get(finding.id);
      defects[finding.id] = entry ? (entry.agreed ?? "oneens") : null;
    }
    if (keyFindings.some((finding) => !classified.has(finding.id))) defectsNl = "de indeling noemt niet elk gebrek uit deze sleutel: is ze met een andere referentie gemaakt?";
    // Like "gevonden": a finding belongs to a defect only when both classifications say so.
    falseReports = Object.fromEntries(criteria.map((id) => [id, 0]));
    for (const own of summary.ownFindings) if (inScope(own.criterion) && own.agreed !== "tegenhanger") falseReports[own.criterion]!++;
  } catch (error) {
    for (const finding of keyFindings) defects[finding.id] = null;
    defectsNl = `geen geldige indeling per bevinding (compare --findings): ${(error as Error).message}`;
  }

  const openPoints: Record<string, number> = {};
  const openPointsByCriterion: Record<string, number> = Object.fromEntries(criteria.map((id) => [id, 0]));
  for (const kind of gaps([runDir]).kinds) {
    for (const entry of kind.criteria.filter((item) => inScope(item.criterion))) {
      const standing = entry.points.filter((point) => point.standing).length;
      if (standing === 0) continue;
      openPoints[kind.kind] = (openPoints[kind.kind] ?? 0) + standing;
      openPointsByCriterion[entry.criterion]! += standing;
    }
  }

  return {
    run: basename(resolve(runDir)),
    side,
    variant: readIfThere<VariantRecord>(join(runDir, VARIANT_FILE))?.name ?? null,
    commit: readIfThere<Manifest>(join(runDir, "manifest.json"))?.toolbox?.commit ?? null,
    criteria,
    outcomes: Object.fromEntries(criteria.map((id) => [id, byId.get(id)?.outcome ?? null])),
    findings: Object.fromEntries(criteria.map((id) => [id, byId.get(id)?.findings.length ?? 0])),
    defects,
    defectsNl,
    openPoints,
    openPointsByCriterion,
    falseReports,
    roles: rolesOf(runDir, usage),
  };
}

const foundShare = ([found, classified]: [number, number]): number | null => (classified === 0 ? null : found / classified);
const tally = (classes: (ReferenceClass | "oneens" | null)[]): [number, number] => [classes.filter((entry) => entry === "gevonden").length, classes.filter((entry) => entry !== null).length];
const sumPoints = (run: RunResult): number => Object.values(run.openPoints).reduce((sum, count) => sum + count, 0);
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]): number | null => (values.length === 0 ? null : sum(values) / values.length);

/** mulberry32: a small generator with a seed, so the same runs give the same interval. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Paired percentile bootstrap. Each unit has a value for the baseline and one for the variant;
 * every draw takes units with replacement and the same draw for both sides. `statistic` is the
 * mean over the units (a share per defect) or the sum (a count per criterion, so per run).
 */
export function pairedBootstrap(units: [number, number][], statistic: "mean" | "sum", options: { seed: number; resamples: number }): Pick<PairedTest, "baseline" | "variant" | "difference"> {
  if (units.length === 0) {
    const zero = { value: 0, low: 0, high: 0 };
    return { baseline: zero, variant: zero, difference: zero };
  }
  const scale = statistic === "mean" ? 1 / units.length : 1;
  const of = (side: 0 | 1, picks: number[]): number => sum(picks.map((index) => units[index]![side])) * scale;
  const all = units.map((_, index) => index);
  const draws: [number[], number[], number[]] = [[], [], []];
  const next = random(options.seed);
  for (let draw = 0; draw < options.resamples; draw++) {
    const picks = all.map(() => Math.floor(next() * units.length));
    const [before, after] = [of(0, picks), of(1, picks)];
    draws[0].push(before);
    draws[1].push(after);
    draws[2].push(after - before);
  }
  const estimate = (value: number, values: number[]): Estimate => {
    const sorted = [...values].sort((a, b) => a - b);
    return { value, low: sorted[Math.floor(0.025 * sorted.length)]!, high: sorted[Math.ceil(0.975 * sorted.length) - 1]! };
  };
  const [before, after] = [of(0, all), of(1, all)];
  return { baseline: estimate(before, draws[0]), variant: estimate(after, draws[1]), difference: estimate(after - before, draws[2]) };
}

/** The class a criterion is in for the spread and the agreement: "voldoet" counts not applicable too, as conformance does; "open" is every outcome without a verdict. */
const classOf = (outcome: CriterionOutcome | null): "voldoet" | "voldoet niet" | "open" => (outcome === "passed" || outcome === "inapplicable" ? "voldoet" : outcome === "failed" ? "voldoet niet" : "open");
const CLASSES = ["voldoet", "voldoet niet", "open"] as const;

/** Share of the pairs (one from each list, or two from one list when `right` is left out) in a different class. */
function spread(left: (CriterionOutcome | null)[], right?: (CriterionOutcome | null)[]): number | null {
  let pairs = 0;
  let differ = 0;
  left.forEach((outcome, i) => {
    for (const [j, other] of (right ?? left).entries()) {
      if (!right && j <= i) continue;
      pairs++;
      if (classOf(outcome) !== classOf(other)) differ++;
    }
  });
  return pairs === 0 ? null : differ / pairs;
}

/** Fleiss' kappa with the criteria as subjects and the runs as raters, and how many criteria every run put in the same class. */
export function agreementOf(perCriterion: (CriterionOutcome | null)[][], runs: number): Agreement {
  const counts = perCriterion.map((outcomes) => CLASSES.map((name) => outcomes.filter((outcome) => classOf(outcome) === name).length));
  const unanimous: [number, number] = [counts.filter((row) => row.includes(runs)).length, counts.length];
  if (runs < 2 || counts.length === 0) return { runs, unanimous, kappa: null };
  const observed = mean(counts.map((row) => (sum(row.map((n) => n * n)) - runs) / (runs * (runs - 1))))!;
  const expected = sum(CLASSES.map((_, k) => (sum(counts.map((row) => row[k]!)) / (counts.length * runs)) ** 2));
  return { runs, unanimous, kappa: expected === 1 ? null : (observed - expected) / (1 - expected) };
}

export async function compareVariants(options: CompareVariantsOptions): Promise<VariantComparison> {
  if (options.baseline.length === 0) throw new Error("compare-variants needs at least one --baseline <run>");
  const reference = await readJson<ReferenceAudit>(options.reference);
  const usage = new Map<string, UsageFile>();
  for (const path of options.usage ?? []) {
    const file = readUsage(path);
    if (usage.has(file.run)) throw new Error(`twee verbruiksbestanden voor run ${file.run}`);
    usage.set(file.run, file);
  }
  const findings = options.findings ?? findingsSummary;
  const runs: RunResult[] = [];
  for (const [side, dirs] of [["baseline", options.baseline], ["variant", options.variant ?? []]] as const) {
    for (const dir of dirs) runs.push(await runResult(dir, side, reference, usage.get(basename(resolve(dir))) ?? null, findings));
  }
  const names = runs.map((run) => run.run);
  const twice = names.find((name, position) => names.indexOf(name) !== position);
  if (twice) throw new Error(`run ${twice} staat er twee keer in: geef elke run een eigen mapnaam`);
  const unknown = [...usage.keys()].filter((name) => !names.includes(name));
  if (unknown.length > 0) throw new Error(`verbruik voor een run die niet wordt vergeleken: ${unknown.join(", ")}`);

  const criteria = [...new Set(runs.flatMap((run) => run.criteria))].sort(compareCriterionIds);
  const differing = runs.filter((run) => run.criteria.join() !== runs[0]!.criteria.join()).map((run) => run.run);
  const scopeNl = differing.length > 0 ? `niet elke run heeft dezelfde criteria als ${runs[0]!.run}: ${differing.join(", ")}` : null;
  const baseline = runs.filter((run) => run.side === "baseline");
  const variants = runs.filter((run) => run.side === "variant");
  const failedByKey = new Set(reference.failed.filter((id) => !(reference.failedOnlyInDocuments ?? []).includes(id)));

  const rows: CriterionRow[] = criteria.map((criterion) => {
    const before = baseline.map((run) => run.outcomes[criterion] ?? null);
    const after = variants.map((run) => run.outcomes[criterion] ?? null);
    return {
      criterion,
      titleNl: criterionById(criterion)?.titleNl ?? "",
      keyFails: failedByKey.has(criterion),
      baseline: before,
      variant: after,
      spreadBaseline: spread(before),
      spreadVariant: spread(after),
      spreadBetween: spread(before, after),
    };
  });

  const defects: DefectRow[] = (reference.findings ?? [])
    .filter((finding) => criteria.includes(finding.criterion))
    .map((finding) => {
      const before = baseline.map((run) => run.defects[finding.id] ?? null);
      const after = variants.map((run) => run.defects[finding.id] ?? null);
      return { id: finding.id, criterion: finding.criterion, descriptionNl: finding.descriptionNl, baseline: before, variant: after, foundBaseline: tally(before), foundVariant: tally(after) };
    })
    .sort((a, b) => compareCriterionIds(a.criterion, b.criterion) || a.id.localeCompare(b.id));

  const agreement = { baseline: agreementOf(rows.map((row) => row.baseline), baseline.length), variant: variants.length === 0 ? null : agreementOf(rows.map((row) => row.variant), variants.length) };
  return { schema: "loep/variant-comparison/2", reference: basename(options.reference), criteria, scopeNl, runs, rows, defects, agreement, verdict: variants.length === 0 ? null : verdictOf(rows, defects, baseline, variants, options) };
}

function verdictOf(rows: CriterionRow[], defects: DefectRow[], baseline: RunResult[], variants: RunResult[], options: CompareVariantsOptions): Verdict {
  const margin = options.margin ?? MARGIN;
  const reportMargin = options.reportMargin ?? REPORT_MARGIN;
  const draw = { seed: options.seed ?? SEED, resamples: RESAMPLES };

  // Per defect the share of the classified runs that found it, on both sides; a defect no run of a side was classified on cannot be paired.
  const shares = defects.map((row) => [foundShare(row.foundBaseline), foundShare(row.foundVariant)] as const);
  const paired = shares.filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
  const unpaired = defects.length - paired.length;
  const found = paired.length === 0 ? null : { units: paired.length, leftOutNl: unpaired === 0 ? null : `${unpaired} van ${defects.length} gebreken zonder geldige indeling aan een van de kanten`, ...pairedBootstrap(paired, "mean", draw) };

  // Per criterion the mean count per run on each side; the sum over the criteria is the count per run.
  const perCriterion = (pick: (run: RunResult) => Record<string, number> | null): { units: [number, number][]; without: number } => {
    const side = (list: RunResult[]) => list.map(pick).filter((counts): counts is Record<string, number> => counts !== null);
    const [before, after] = [side(baseline), side(variants)];
    const units: [number, number][] = before.length === 0 || after.length === 0 ? [] : rows.map((row) => [mean(before.map((counts) => counts[row.criterion] ?? 0))!, mean(after.map((counts) => counts[row.criterion] ?? 0))!]);
    return { units, without: baseline.length + variants.length - before.length - after.length };
  };
  const reports = perCriterion((run) => run.falseReports);
  const falseReports =
    reports.units.length === 0
      ? null
      : { units: reports.units.length, leftOutNl: reports.without === 0 ? null : `${reports.without} ${reports.without === 1 ? "run" : "runs"} zonder geldige indeling niet meegeteld`, ...pairedBootstrap(reports.units, "sum", draw) };
  const points = perCriterion((run) => run.openPointsByCriterion);
  const openPoints = { units: points.units.length, leftOutNl: null, ...pairedBootstrap(points.units, "sum", draw) };

  const withFound = found && { ...found, ok: found.difference.low > -margin };
  const withReports = falseReports && { ...falseReports, ok: falseReports.difference.high < reportMargin };
  const made = [withFound, withReports].filter((test) => test !== null);
  return { margin, reportMargin, seed: draw.seed, resamples: draw.resamples, found: withFound, falseReports: withReports, openPoints, notWorse: made.length === 0 ? null : made.every((test) => test.ok) };
}

/* ------------------------------------------------------------------------------------------ */

const SHORT_OUTCOME: Record<CriterionOutcome, string> = { passed: "voldoet", failed: "voldoet niet", inapplicable: "n.v.t.", cantTell: "kan niet bepalen", untested: "niet beoordeeld" };
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const number = (value: number, digits = 0): string => value.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const millions = (value: number): string => `${number(value / 1_000_000, 2)} M`;
const outcomeCell = (outcome: CriterionOutcome | null): string => (outcome === null ? "-" : SHORT_OUTCOME[outcome]);
const classCell = (value: ReferenceClass | "oneens" | null): string => value ?? "-";

export function comparisonMarkdown(result: VariantComparison): string {
  const baseline = result.runs.filter((run) => run.side === "baseline");
  const variants = result.runs.filter((run) => run.side === "variant");
  const ordered = [...baseline, ...variants];
  const label = (run: RunResult): string => `${run.side === "baseline" ? "N" : "V"}${(run.side === "baseline" ? baseline : variants).indexOf(run) + 1}`;
  const header = ordered.map(label);
  const lines: string[] = [
    "# Vergelijking van varianten",
    "",
    `Sleutel: ${result.reference}. ${result.criteria.length} criteria: ${result.criteria.join(", ")}.`,
    "",
    "| Run | Kant | Variant | Commit |",
    "|---|---|---|---|",
    ...ordered.map((run) => `| ${label(run)} ${cell(run.run)} | ${run.side === "baseline" ? "nulmeting" : "variant"} | ${cell(run.variant ?? "-")} | ${run.commit ? `\`${run.commit.slice(0, 7)}\`` : "onbekend"} |`),
    ...(result.scopeNl ? ["", `Let op: ${result.scopeNl}.`] : []),
    "",
  ];

  const verdict = result.verdict;
  if (verdict) {
    const pct = (value: number): string => `${number(value * 100, 1)}%`;
    const signed = (value: number): string => {
      const text = number(Math.abs(value), 1);
      return text === number(0, 1) ? text : `${value > 0 ? "+" : "-"}${text}`;
    };
    const points = (value: number): string => signed(value * 100);
    const count = signed;
    const interval = (estimate: Estimate, show: (value: number) => string): string => `${show(estimate.value)} (${show(estimate.low)} tot ${show(estimate.high)})`;
    const yesNo = (ok: boolean): string => (ok ? "ja" : "nee");
    const { found, falseReports, openPoints } = verdict;
    lines.push(
      "## Niet slechter",
      "",
      `**${verdict.notWorse === null ? "Niet te bepalen: geen gebrek en geen bevinding met een geldige indeling aan beide kanten." : `Niet slechter: ${yesNo(verdict.notWorse)}.`}**`,
      "",
      "| Toets | Nulmeting | Variant | Verschil (95%-interval) | Marge | Binnen de marge |",
      "|---|---|---|---|---|---|",
      found
        ? `| Gevonden gebreken uit de sleutel, per run (${found.units} gebreken) | ${interval(found.baseline, pct)} | ${interval(found.variant, pct)} | ${interval(found.difference, points)} procentpunt | ondergrens boven ${points(-verdict.margin)} | ${yesNo(found.ok)} |`
        : "| Gevonden gebreken uit de sleutel | - | - | - | - | geen gebrek met een geldige indeling aan beide kanten |",
      falseReports
        ? `| Onterechte meldingen per run (${falseReports.units} criteria) | ${interval(falseReports.baseline, (value) => number(value, 1))} | ${interval(falseReports.variant, (value) => number(value, 1))} | ${interval(falseReports.difference, count)} | bovengrens onder ${count(verdict.reportMargin)} | ${yesNo(falseReports.ok)} |`
        : "| Onterechte meldingen per run | - | - | - | - | geen run met een geldige indeling aan een van de kanten |",
      `| Open punten per run (ter informatie) | ${interval(openPoints.baseline, (value) => number(value, 1))} | ${interval(openPoints.variant, (value) => number(value, 1))} | ${interval(openPoints.difference, count)} | geen | - |`,
      "",
      `Het verschil is variant min nulmeting. Het interval komt uit ${number(verdict.resamples)} trekkingen met teruglegging over de gebreken (bij meldingen en open punten over de criteria), elke trekking met dezelfde gebreken of criteria voor beide kanten, met seed ${verdict.seed}. Een onterechte melding is een bevinding die niet beide indelingen van \`compare --findings\` bij een gebrek uit de sleutel zetten. De marges staan vast voordat de variant wordt gemeten; zie validatie/verbruik/README.md.`,
      ...[found?.leftOutNl, falseReports?.leftOutNl].filter((note): note is string => Boolean(note)).map((note) => `\nLet op: ${note}.`),
      "",
    );
  }

  const agreementRow = (side: string, entry: Agreement): string => `| ${side} | ${entry.runs} | ${entry.unanimous[0]} van ${entry.unanimous[1]} | ${entry.kappa === null ? "-" : number(entry.kappa, 2)} |`;
  lines.push(
    "## Overeenstemming tussen runs",
    "",
    'Per criterium is een uitkomst "voldoet" (ook niet van toepassing), "voldoet niet" of "open" (kan niet bepalen, niet beoordeeld). Fleiss\' kappa is 1 als alle runs gelijk zijn en rond 0 als ze niet meer overeenstemmen dan toeval.',
    "",
    "| Kant | Runs | Zelfde uitkomst in alle runs | Fleiss' kappa |",
    "|---|---|---|---|",
    agreementRow("nulmeting", result.agreement.baseline),
    ...(result.agreement.variant ? [agreementRow("variant", result.agreement.variant)] : []),
    "",
  );

  const spreadCell = (value: number | null): string => (value === null ? "-" : `${number(value * 100)}%`);
  lines.push(
    "## Per criterium",
    "",
    "Spreiding: het aandeel paren runs waarin het criterium een andere uitkomst kreeg, binnen de nulmeting (N), binnen de variant (V) en tussen een run van elk (N tegen V). Ligt N tegen V niet boven N en V, dan verschilt de variant niet meer dan de runs onderling.",
    "",
    `| Criterium | Sleutel | ${header.join(" | ")} | N | V | N tegen V |`,
    `|---|---|${header.map(() => "---|").join("")}---|---|---|`,
  );
  for (const row of result.rows) {
    lines.push(`| ${row.criterion} ${cell(row.titleNl)} | ${row.keyFails ? "voldoet niet" : "geen gebrek"} | ${[...row.baseline, ...row.variant].map(outcomeCell).join(" | ")} | ${spreadCell(row.spreadBaseline)} | ${spreadCell(row.spreadVariant)} | ${spreadCell(row.spreadBetween)} |`);
  }
  lines.push("", "Bevindingen per criterium in de evaluatie:", "", `| Criterium | ${header.join(" | ")} |`, `|---|${header.map(() => "---|").join("")}`);
  for (const criterion of result.criteria) lines.push(`| ${criterion} | ${ordered.map((run) => String(run.findings[criterion] ?? 0)).join(" | ")} |`);

  lines.push("", "## Per gebrek uit de sleutel", "");
  if (result.defects.length === 0) lines.push("De sleutel heeft geen gebreken onder deze criteria.");
  else {
    lines.push(`"gevonden" telt alleen waar beide indelingen van \`compare --findings\` het eens zijn; "-" is een run zonder geldige indeling.`, "", `| Gebrek | ${header.join(" | ")} | Nulmeting | Variant |`, `|---|${header.map(() => "---|").join("")}---|---|`);
    for (const row of result.defects) {
      const share = ([found, classified]: [number, number]): string => (classified === 0 ? "-" : `${found} van ${classified}`);
      lines.push(`| ${row.id} |${[...row.baseline, ...row.variant].map(classCell).join(" | ")} | ${share(row.foundBaseline)} | ${variants.length === 0 ? "-" : share(row.foundVariant)} |`);
    }
  }
  for (const run of ordered.filter((entry) => entry.defectsNl)) lines.push("", `${label(run)}: ${run.defectsNl}`);

  const kinds = [...new Set(ordered.flatMap((run) => Object.keys(run.openPoints)))];
  lines.push("", "## Open punten per soort", "", "Wat nog open staat in het oordeel dat telt, over de criteria hierboven.", "");
  if (kinds.length === 0) lines.push("Geen.");
  else {
    lines.push(`| Soort | ${header.join(" | ")} |`, `|---|${header.map(() => "---|").join("")}`);
    for (const kind of kinds) lines.push(`| ${kind} | ${ordered.map((run) => String(run.openPoints[kind] ?? 0)).join(" | ")} |`);
    lines.push(`| samen | ${ordered.map((run) => String(sumPoints(run))).join(" | ")} |`);
  }

  lines.push("", "## Verbruik per rol", "", "Sessies, commando's en tijd uit de run. Tokens, beurten en kosten alleen uit een verbruiksbestand (--usage), want de run telt die niet.", "");
  lines.push("| Run | Rol | Agents | Commando's | Tijd in sessies | Invoer | Naar de cache | Uit de cache | Uitvoer | Beurten | Kosten |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const run of ordered) {
    for (const use of run.roles) {
      const tokens = use.tokens;
      lines.push(
        `| ${label(run)} | ${use.roleNl} | ${use.agents} | ${use.commands === null ? "-" : number(use.commands)} | ${use.sessionSeconds === null ? "-" : `${number(use.sessionSeconds / 60)} min`} | ${tokens ? number(tokens.input) : "-"} | ${tokens ? millions(tokens.cacheWrite) : "-"} | ${tokens ? millions(tokens.cacheRead) : "-"} | ${tokens ? number(tokens.output) : "-"} | ${use.turns === null ? "-" : number(use.turns)} | ${use.costUsd === null ? (tokens ? "geen prijs" : "-") : `${number(use.costUsd, 2)} dollar`} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeComparison(result: VariantComparison, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  await writeJson(join(outDir, "varianten.json"), result);
  await writeFileAtomic(join(outDir, "varianten.md"), comparisonMarkdown(result));
}

/* ------------------------------------------------------------------------------------------ */

export const VARIANT_USAGE = `loep variant --run <run> --out <copy> --name <variant> [--note <text>]
loep compare-variants --baseline <run>... [--variant <run>...] --reference <file> [--usage <file>...]
                      [--margin <share>] [--margin-reports <count>] [--seed <n>] [--out <dir>] [--json]

Measuring a variant of the code on frozen evidence (validatie/verbruik/README.md, "Hoe we meten").
Not a step of an evaluation.

  variant            Copy a run whose sweep is done, without what the agent phases wrote (task files,
                     walks, verdicts and stamps, their sessions, work folders and saved recipes, and the
                     evaluation, report, seal and comparisons made from them). Then tasks --only and
                     pending start the agent phases again on the same evidence. Run it with the code of
                     the variant: variant.json in the copy records that commit, the run it came from and
                     what was left out. Files are cloned where the file system can (APFS, reflinks)
  compare-variants   Lay runs of the baseline and of a variant side by side, for the criteria of their
                     tasks. Says whether the variant is not worse: the share of the defects of the
                     answer key found per run (from the classifications of compare --findings) and
                     the unjustified reports per run, each a paired difference with a 95% interval
                     from a bootstrap, against a margin fixed beforehand. Below that: how alike the
                     runs of each side are (same outcome in all runs, Fleiss' kappa), per criterion
                     the outcome per run and the spread within and between the sides, per defect how
                     often it was found, open points per kind, and per role the sessions, commands
                     and time. Writes varianten.md and varianten.json with --out; without it prints
                     the Markdown
  --baseline, --variant  Repeatable: one run each. Without --variant: only the spread of the baseline
  --reference <file>     The answer key in the form compare reads (toolbox/fixtures/reference-*.json)
  --usage <file>         Repeatable: tokens and turns per agent of one run, counted from the transcripts
                         outside the run (schema loep/verbruik/1, see toolbox/test/fixtures/verbruik.json)
  --margin <share>       Not worse when the lower bound of the difference in the share found lies above
                         minus this (default ${MARGIN})
  --margin-reports <count>  Not worse when the upper bound of the difference in unjustified reports per
                         run lies below this (default ${REPORT_MARGIN})
  --seed <n>             Seed of the bootstrap (default ${SEED})
`;

const numberOption = (name: string, value: string | undefined, check: (parsed: number) => boolean): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || !check(parsed)) throw new Error(`--${name} ${value}: geen geldige waarde`);
  return parsed;
};

export async function cli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      run: { type: "string" },
      out: { type: "string" },
      name: { type: "string" },
      note: { type: "string" },
      baseline: { type: "string", multiple: true },
      variant: { type: "string", multiple: true },
      reference: { type: "string" },
      usage: { type: "string", multiple: true },
      margin: { type: "string" },
      "margin-reports": { type: "string" },
      seed: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help) {
    process.stdout.write(VARIANT_USAGE);
    return;
  }
  if (command === "variant") {
    if (!values.run || !values.out || !values.name) throw new Error("variant needs --run <run>, --out <copy> and --name <variant>");
    const { out, record } = await variant({ run: values.run, out: values.out, name: values.name, noteNl: values.note });
    const { paths, sessions, recipes } = record.leftOut;
    process.stdout.write(`kopie ${out} (variant ${record.name}, code ${record.toolbox.commit?.slice(0, 7) ?? "zonder commit"}${record.toolbox.dirty ? ", met wijzigingen die niet zijn vastgelegd" : ""}): de veegronde van ${record.from.run}, zonder ${paths.length} bestanden en mappen, ${sessions.length} ${sessions.length === 1 ? "sessie" : "sessies"} en ${recipes.length} ${recipes.length === 1 ? "recept" : "recepten"} van agents\n`);
    process.stdout.write(`verder met: tasks --run ${out} --only <criteria>, en daarna pending\n`);
    return;
  }
  if (command === "compare-variants") {
    if (!values.baseline?.length || !values.reference) throw new Error("compare-variants needs --baseline <run> (one or more) and --reference <file>");
    const result = await compareVariants({
      baseline: values.baseline,
      variant: values.variant,
      reference: values.reference,
      usage: values.usage,
      margin: numberOption("margin", values.margin, (value) => value >= 0 && value < 1),
      reportMargin: numberOption("margin-reports", values["margin-reports"], (value) => value >= 0),
      seed: numberOption("seed", values.seed, Number.isInteger),
    });
    if (values.out) {
      await writeComparison(result, values.out);
      process.stdout.write(`${result.runs.length} runs, ${result.criteria.length} criteria, ${result.defects.length} gebreken uit de sleutel; ${join(values.out, "varianten.md")}\n`);
      const verdict = result.verdict;
      if (verdict) {
        const fixed = (value: number): string => value.toFixed(3);
        const parts = [
          verdict.found ? `gevonden ${fixed(verdict.found.difference.value)} (interval ${fixed(verdict.found.difference.low)} tot ${fixed(verdict.found.difference.high)}, ondergrens boven -${verdict.margin})` : "gevonden niet te bepalen",
          verdict.falseReports ? `onterechte meldingen per run ${fixed(verdict.falseReports.difference.value)} (interval ${fixed(verdict.falseReports.difference.low)} tot ${fixed(verdict.falseReports.difference.high)}, bovengrens onder ${verdict.reportMargin})` : "onterechte meldingen niet te bepalen",
        ];
        process.stdout.write(`niet slechter: ${verdict.notWorse === null ? "niet te bepalen" : verdict.notWorse ? "ja" : "nee"} (${parts.join("; ")})\n`);
      }
    } else process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : comparisonMarkdown(result));
    return;
  }
  throw new Error(`unknown command "${command}"\n\n${VARIANT_USAGE}`);
}
