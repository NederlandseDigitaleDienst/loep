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
 * criterion, per defect of the answer key, open points, and what each role used.
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
  roles: RoleUse[];
}

export interface CriterionRow {
  criterion: string;
  titleNl: string;
  /** Whether the answer key fails this criterion. */
  keyFails: boolean;
  baseline: (CriterionOutcome | null)[];
  variant: (CriterionOutcome | null)[];
  /** A variant run reached an outcome no baseline run reached. */
  deviates: boolean;
  /** A variant run failed it where the key does not and no baseline run did. */
  newReport: boolean;
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
  /** Found in a smaller share of the variant runs than of the baseline runs. */
  fewer: boolean;
}

export interface VariantComparison {
  schema: "loep/variant-comparison/1";
  reference: string;
  criteria: string[];
  /** Runs whose criteria differ from those of the first run, as a warning. */
  scopeNl: string | null;
  runs: RunResult[];
  rows: CriterionRow[];
  defects: DefectRow[];
  /** The four checks of "gelijk of beter"; null without variant runs. */
  checks: { outcomes: string[]; defects: string[]; newReports: string[]; openPoints: { baseline: number; variant: number; more: boolean } } | null;
}

export interface CompareVariantsOptions {
  baseline: string[];
  variant?: string[] | undefined;
  reference: string;
  usage?: string[] | undefined;
  /** For tests: the classes per defect, instead of the current classifications of `compare --findings`. */
  findings?: (runDir: string) => Promise<Pick<FindingsSummary, "findings">>;
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
  const keyFindings = (reference.findings ?? []).filter((finding) => inScope(finding.criterion));
  try {
    const classified = new Map((await findings(runDir)).findings.map((finding) => [finding.id, finding]));
    for (const finding of keyFindings) {
      const entry = classified.get(finding.id);
      defects[finding.id] = entry ? (entry.agreed ?? "oneens") : null;
    }
    if (keyFindings.some((finding) => !classified.has(finding.id))) defectsNl = "de indeling noemt niet elk gebrek uit deze sleutel: is ze met een andere referentie gemaakt?";
  } catch (error) {
    for (const finding of keyFindings) defects[finding.id] = null;
    defectsNl = `geen geldige indeling per bevinding (compare --findings): ${(error as Error).message}`;
  }

  const openPoints: Record<string, number> = {};
  for (const kind of gaps([runDir]).kinds) {
    const standing = kind.criteria.filter((entry) => inScope(entry.criterion)).flatMap((entry) => entry.points).filter((point) => point.standing).length;
    if (standing > 0) openPoints[kind.kind] = standing;
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
    roles: rolesOf(runDir, usage),
  };
}

const foundShare = ([found, classified]: [number, number]): number | null => (classified === 0 ? null : found / classified);
const tally = (classes: (ReferenceClass | "oneens" | null)[]): [number, number] => [classes.filter((entry) => entry === "gevonden").length, classes.filter((entry) => entry !== null).length];
const sumPoints = (run: RunResult): number => Object.values(run.openPoints).reduce((sum, count) => sum + count, 0);
const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

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
    const keyFails = failedByKey.has(criterion);
    return {
      criterion,
      titleNl: criterionById(criterion)?.titleNl ?? "",
      keyFails,
      baseline: before,
      variant: after,
      deviates: after.some((outcome) => !before.includes(outcome)),
      newReport: !keyFails && after.includes("failed") && !before.includes("failed"),
    };
  });

  const defects: DefectRow[] = (reference.findings ?? [])
    .filter((finding) => criteria.includes(finding.criterion))
    .map((finding) => {
      const before = baseline.map((run) => run.defects[finding.id] ?? null);
      const after = variants.map((run) => run.defects[finding.id] ?? null);
      const [shareBefore, shareAfter] = [foundShare(tally(before)), foundShare(tally(after))];
      return { id: finding.id, criterion: finding.criterion, descriptionNl: finding.descriptionNl, baseline: before, variant: after, foundBaseline: tally(before), foundVariant: tally(after), fewer: shareBefore !== null && shareAfter !== null && shareAfter < shareBefore };
    })
    .sort((a, b) => compareCriterionIds(a.criterion, b.criterion) || a.id.localeCompare(b.id));

  const pointsBefore = mean(baseline.map(sumPoints));
  const pointsAfter = mean(variants.map(sumPoints));
  return {
    schema: "loep/variant-comparison/1",
    reference: basename(options.reference),
    criteria,
    scopeNl,
    runs,
    rows,
    defects,
    checks:
      variants.length === 0
        ? null
        : {
            outcomes: rows.filter((row) => row.deviates).map((row) => row.criterion),
            defects: defects.filter((row) => row.fewer).map((row) => row.id),
            newReports: rows.filter((row) => row.newReport).map((row) => row.criterion),
            openPoints: { baseline: pointsBefore, variant: pointsAfter, more: pointsAfter > pointsBefore },
          },
  };
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

  if (result.checks) {
    const { outcomes, defects, newReports, openPoints } = result.checks;
    const ok = (list: string[]): string => (list.length === 0 ? "ja" : `nee: ${list.join(", ")}`);
    lines.push(
      "## Gelijk of beter",
      "",
      "| Toets | Uitkomst |",
      "|---|---|",
      `| Geen uitkomst die de nulmeting niet had | ${ok(outcomes)} |`,
      `| Geen gebrek dat minder vaak is gevonden | ${ok(defects)} |`,
      `| Geen melding zonder gebrek in de sleutel die de nulmeting niet had | ${ok(newReports)} |`,
      `| Niet meer open punten (gemiddeld per run) | ${openPoints.more ? "nee" : "ja"}: ${number(openPoints.baseline, 1)} in de nulmeting, ${number(openPoints.variant, 1)} in de variant |`,
      "",
    );
  }

  lines.push("## Per criterium", "", `| Criterium | Sleutel | ${header.join(" | ")} |`, `|---|---|${header.map(() => "---|").join("")}`);
  for (const row of result.rows) {
    const marks = [row.deviates ? "andere uitkomst" : "", row.newReport ? "nieuwe melding" : ""].filter(Boolean).join(", ");
    lines.push(`| ${row.criterion} ${cell(row.titleNl)}${marks ? ` (${marks})` : ""} | ${row.keyFails ? "voldoet niet" : "geen gebrek"} | ${[...row.baseline, ...row.variant].map(outcomeCell).join(" | ")} |`);
  }
  lines.push("", "Bevindingen per criterium in de evaluatie:", "", `| Criterium | ${header.join(" | ")} |`, `|---|${header.map(() => "---|").join("")}`);
  for (const criterion of result.criteria) lines.push(`| ${criterion} | ${ordered.map((run) => String(run.findings[criterion] ?? 0)).join(" | ")} |`);

  lines.push("", "## Per gebrek uit de sleutel", "");
  if (result.defects.length === 0) lines.push("De sleutel heeft geen gebreken onder deze criteria.");
  else {
    lines.push(`"gevonden" telt alleen waar beide indelingen van \`compare --findings\` het eens zijn; "-" is een run zonder geldige indeling.`, "", `| Gebrek | ${header.join(" | ")} | Nulmeting | Variant |`, `|---|${header.map(() => "---|").join("")}---|---|`);
    for (const row of result.defects) {
      const share = ([found, classified]: [number, number]): string => (classified === 0 ? "-" : `${found} van ${classified}`);
      lines.push(`| ${row.id}${row.fewer ? " (minder vaak)" : ""} | ${[...row.baseline, ...row.variant].map(classCell).join(" | ")} | ${share(row.foundBaseline)} | ${variants.length === 0 ? "-" : share(row.foundVariant)} |`);
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
loep compare-variants --baseline <run>... [--variant <run>...] --reference <file> [--usage <file>...] [--out <dir>] [--json]

Measuring a variant of the code on frozen evidence (validatie/verbruik/README.md, "Hoe we meten").
Not a step of an evaluation.

  variant            Copy a run whose sweep is done, without what the agent phases wrote (task files,
                     walks, verdicts and stamps, their sessions, work folders and saved recipes, and the
                     evaluation, report, seal and comparisons made from them). Then tasks --only and
                     pending start the agent phases again on the same evidence. Run it with the code of
                     the variant: variant.json in the copy records that commit, the run it came from and
                     what was left out. Files are cloned where the file system can (APFS, reflinks)
  compare-variants   Lay runs of the baseline and of a variant side by side, for the criteria of their
                     tasks: the outcome per run, per defect of the answer key how often it was found
                     (from the classifications of compare --findings), reports the key does not have,
                     open points per kind, and per role the sessions, commands and time. Writes
                     varianten.md and varianten.json with --out; without it prints the Markdown
  --baseline, --variant  Repeatable: one run each. Without --variant: only the spread of the baseline
  --reference <file>     The answer key in the form compare reads (toolbox/fixtures/reference-*.json)
  --usage <file>         Repeatable: tokens and turns per agent of one run, counted from the transcripts
                         outside the run (schema loep/verbruik/1, see toolbox/test/fixtures/verbruik.json)
`;

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
    const result = await compareVariants({ baseline: values.baseline, variant: values.variant, reference: values.reference, usage: values.usage });
    if (values.out) {
      await writeComparison(result, values.out);
      const checks = result.checks;
      process.stdout.write(`${result.runs.length} runs, ${result.criteria.length} criteria, ${result.defects.length} gebreken uit de sleutel; ${join(values.out, "varianten.md")}\n`);
      if (checks) process.stdout.write(`gelijk of beter: ${checks.outcomes.length + checks.defects.length + checks.newReports.length === 0 && !checks.openPoints.more ? "ja" : "nee"} (andere uitkomst ${checks.outcomes.length}, minder vaak gevonden ${checks.defects.length}, nieuwe meldingen ${checks.newReports.length}, open punten ${checks.openPoints.more ? "meer" : "niet meer"})\n`);
    } else process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : comparisonMarkdown(result));
    return;
  }
  throw new Error(`unknown command "${command}"\n\n${VARIANT_USAGE}`);
}
