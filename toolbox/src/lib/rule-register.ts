/**
 * A register of what is known about each rule of each rule engine: what the engine says about it,
 * how it did on the test cases of the ACT rules, and what the judges of finished evaluations ruled
 * about it. A measurement, not a step of an evaluation: nothing reads it yet. Pure functions;
 * `scripts/rule-register.ts` gathers the files and writes the outcome.
 *
 * The two field records are loep's own verdicts, which were never checked against experts, and a
 * judge saw the engine's output when it ruled. They rank rules; they prove nothing.
 */
import type { CalibrationReport } from "./calibration.ts";
import { compareCriterionIds } from "./wcag.ts";

/** An ACT rule stands behind it, or it checks a WCAG technique, or neither. */
export type RuleKind = "act" | "technique" | "other";

/** What an engine says about a rule: `regels.json` of a calibration. */
export interface CatalogueRule {
  act: string[];
  criteria: string[];
  title?: string;
}
export type RuleCatalogue = Record<string, Record<string, CatalogueRule>>;

/** How a rule did on the test cases of the ACT rules it implements. */
export interface CalibrationRecord {
  /** The ACT rules the cases belong to. */
  act: string[];
  /** Other rules of the same engine that answer the same ACT rules: the cases were judged on all of them together. */
  sharedWith: string[];
  judged: number;
  failures: number;
  found: number;
  missed: number;
  unsureOnFailure: number;
  falseAlarm: number;
  rightlySilent: number;
}

/** What judges ruled where they named the rule, counted per site: a site counts once however many runs it has. */
export interface RulingRecord {
  sites: number;
  /** Sites where a ruling on the rule was a finding. */
  confirmed: number;
  /** Sites without a finding where a ruling said there was no issue. */
  dismissed: number;
  /** Sites where the rulings were only "another criterion" or "open". */
  other: number;
  rulings: { finding: number; noIssue: number; otherCriterion: number; open: number };
}

/**
 * Coarser, and for every engine: on the sites where the rule failed somewhere an agent ran the
 * engines, how the criterion ended. A criterion that fails on every site says nothing about the
 * rule, so the same count over all sites stands next to it.
 */
export interface SessionRecord {
  criterion: string;
  sites: number;
  criterionFailed: number;
  criterionPassed: number;
  criterionOther: number;
  /** Over all sites in the register, whether the rule failed there or not. */
  base: { sites: number; failed: number };
}

export interface RuleRecord {
  engine: string;
  rule: string;
  title: string | null;
  criteria: string[];
  act: string[];
  kind: RuleKind;
  /** False for a rule that failed on a site and gave no outcome on any test case: the calibration does not know it, the field does. */
  catalogued: boolean;
  calibration: CalibrationRecord | null;
  rulings: RulingRecord | null;
  sessions: SessionRecord[];
}

export interface RuleRegister {
  schema: 1;
  kind: "rule-register";
  date: string;
  calibration: { date: string; engines: Record<string, string> };
  field: { runs: number; sites: number; runsWithRulings: number; runsWithSessions: number; rulesNotInCatalogue: string[] };
  rules: RuleRecord[];
}

/** A finished evaluation, as far as the register reads it. */
export interface FieldRun {
  /** What tells one site from another, such as its origin. Never written to the register. */
  site: string;
  criteria: { id: string; outcome: string; observations?: { engineRules?: string[]; ruling?: string }[] }[];
  /** The elements of every `rules` observation of a session: `result.grouped.elements`. */
  elements: { criterion: string; verdicts?: Record<string, string>; rules?: Record<string, string[]> }[];
}

export const ruleKind = (rule: string, info: Pick<CatalogueRule, "act">): RuleKind => (info.act.length > 0 ? "act" : /^QW-WCAG-T\d/.test(rule) ? "technique" : "other");

/** The record of every rule of the engines on the ACT cases: a rule takes the tally of the ACT rules it answers. */
export function calibrationRecords(report: Pick<CalibrationReport, "rules">): Map<string, CalibrationRecord> {
  const records = new Map<string, CalibrationRecord>();
  for (const act of report.rules) {
    for (const [engine, mapped] of Object.entries(act.instruments)) {
      const rules = (mapped as { rules?: string[] }).rules ?? [];
      const tally = (mapped as { tally: Omit<CalibrationRecord, "act" | "sharedWith"> }).tally;
      for (const rule of rules) {
        const key = `${engine}\n${rule}`;
        const record = records.get(key) ?? { act: [], sharedWith: [], judged: 0, failures: 0, found: 0, missed: 0, unsureOnFailure: 0, falseAlarm: 0, rightlySilent: 0 };
        record.act.push(act.rule);
        for (const other of rules) if (other !== rule && !record.sharedWith.includes(other)) record.sharedWith.push(other);
        for (const field of ["judged", "failures", "found", "missed", "unsureOnFailure", "falseAlarm", "rightlySilent"] as const) record[field] += tally[field];
        records.set(key, record);
      }
    }
  }
  for (const record of records.values()) {
    record.act.sort();
    record.sharedWith.sort();
  }
  return records;
}

/** What a judge can rule about a rule of an engine it names. */
export const RULINGS = ["finding", "noIssue", "otherCriterion", "open"] as const;
export type Ruling = (typeof RULINGS)[number];

/**
 * What the judges ruled about each rule they named. A verdict names a rule without its engine;
 * the catalogue says whose it is. A name the catalogue does not have is returned apart.
 */
export function rulingRecords(runs: readonly FieldRun[], engineOf: (rule: string) => string | null): { records: Map<string, RulingRecord>; unknown: string[] } {
  const perSite = new Map<string, Map<string, Record<Ruling, number>>>();
  const unknown = new Set<string>();
  for (const run of runs) {
    for (const criterion of run.criteria) {
      for (const observation of criterion.observations ?? []) {
        if (!RULINGS.includes(observation.ruling as Ruling)) continue;
        for (const rule of observation.engineRules ?? []) {
          const engine = engineOf(rule);
          if (!engine) {
            unknown.add(rule);
            continue;
          }
          const key = `${engine}\n${rule}`;
          const sites = perSite.get(key) ?? new Map<string, Record<Ruling, number>>();
          const counts = sites.get(run.site) ?? { finding: 0, noIssue: 0, otherCriterion: 0, open: 0 };
          counts[observation.ruling as Ruling] += 1;
          sites.set(run.site, counts);
          perSite.set(key, sites);
        }
      }
    }
  }
  const records = new Map<string, RulingRecord>();
  for (const [key, sites] of perSite) {
    const record: RulingRecord = { sites: sites.size, confirmed: 0, dismissed: 0, other: 0, rulings: { finding: 0, noIssue: 0, otherCriterion: 0, open: 0 } };
    for (const counts of sites.values()) {
      for (const ruling of RULINGS) record.rulings[ruling] += counts[ruling];
      if (counts.finding > 0) record.confirmed += 1;
      else if (counts.noIssue > 0) record.dismissed += 1;
      else record.other += 1;
    }
    records.set(key, record);
  }
  return { records, unknown: [...unknown].sort() };
}

/**
 * Per rule and criterion: on the sites where the rule failed in a session, how the criterion ended
 * in the run it failed in. Another run of the same site is another measurement, with another
 * version of loep or of the site: its outcome says nothing about this failure.
 */
export function sessionRecords(runs: readonly FieldRun[]): Map<string, SessionRecord[]> {
  type Ending = "failed" | "passed" | "other";
  const ending = (outcomes: ReadonlySet<string>): Ending => (outcomes.has("failed") ? "failed" : outcomes.size === 1 && outcomes.has("passed") ? "passed" : "other");
  // Over all runs of a site, for the base: a criterion failed there when any run failed it.
  const ofSite = new Map<string, Map<string, Set<string>>>();
  // Per rule and criterion, per site: the outcomes of the runs in which the rule failed.
  const whereFailed = new Map<string, Map<string, Map<string, Set<string>>>>();
  for (const run of runs) {
    const outcomes = new Map(run.criteria.map((criterion) => [criterion.id, criterion.outcome]));
    const site = ofSite.get(run.site) ?? new Map<string, Set<string>>();
    for (const [criterion, outcome] of outcomes) site.set(criterion, (site.get(criterion) ?? new Set<string>()).add(outcome));
    ofSite.set(run.site, site);
    for (const element of run.elements) {
      const outcome = outcomes.get(element.criterion);
      if (outcome === undefined) continue;
      for (const [engine, verdict] of Object.entries(element.verdicts ?? {})) {
        if (verdict !== "failed") continue;
        for (const rule of element.rules?.[engine] ?? []) {
          const key = `${engine}\n${rule}`;
          const perCriterion = whereFailed.get(key) ?? new Map<string, Map<string, Set<string>>>();
          const perSite = perCriterion.get(element.criterion) ?? new Map<string, Set<string>>();
          perSite.set(run.site, (perSite.get(run.site) ?? new Set<string>()).add(outcome));
          perCriterion.set(element.criterion, perSite);
          whereFailed.set(key, perCriterion);
        }
      }
    }
  }
  const base = (criterion: string): SessionRecord["base"] => {
    const judged = [...ofSite.values()].map((site) => site.get(criterion)).filter((outcomes) => outcomes !== undefined);
    return { sites: judged.length, failed: judged.filter((outcomes) => ending(outcomes) === "failed").length };
  };
  const records = new Map<string, SessionRecord[]>();
  for (const [key, perCriterion] of whereFailed) {
    const list: SessionRecord[] = [];
    for (const [criterion, perSite] of perCriterion) {
      const ends = [...perSite.values()].map(ending);
      list.push({ criterion, sites: ends.length, criterionFailed: ends.filter((end) => end === "failed").length, criterionPassed: ends.filter((end) => end === "passed").length, criterionOther: ends.filter((end) => end === "other").length, base: base(criterion) });
    }
    records.set(key, list.sort((a, b) => compareCriterionIds(a.criterion, b.criterion)));
  }
  return records;
}

export interface RegisterInput {
  date: string;
  catalogue: RuleCatalogue;
  calibration: Pick<CalibrationReport, "rules" | "date" | "instruments">;
  runs: readonly FieldRun[];
}

export function buildRegister(input: RegisterInput): RuleRegister {
  const owners = new Map<string, string[]>();
  for (const [engine, rules] of Object.entries(input.catalogue)) for (const rule of Object.keys(rules)) owners.set(rule, [...(owners.get(rule) ?? []), engine]);
  // A name two engines share cannot be given to one of them.
  const engineOf = (rule: string): string | null => (owners.get(rule)?.length === 1 ? owners.get(rule)![0]! : null);
  const calibration = calibrationRecords(input.calibration);
  const { records: rulings, unknown } = rulingRecords(input.runs, engineOf);
  const sessions = sessionRecords(input.runs);
  const rules: RuleRecord[] = [];
  for (const [engine, ofEngine] of Object.entries(input.catalogue)) {
    for (const [rule, info] of Object.entries(ofEngine)) {
      const key = `${engine}\n${rule}`;
      // A catalogue from before the calibration wrote Alfa's ACT rules into it: the calibration record knows them.
      const act = info.act.length > 0 ? [...info.act].sort() : (calibration.get(key)?.act ?? []);
      rules.push({ engine, rule, title: info.title ?? null, criteria: [...info.criteria].sort(compareCriterionIds), act, kind: ruleKind(rule, { act }), catalogued: true, calibration: calibration.get(key) ?? null, rulings: rulings.get(key) ?? null, sessions: sessions.get(key) ?? [] });
    }
  }
  // A rule that only applies to what the test cases do not have, such as a second landmark, is in no catalogue. It failed on a site, so it gets a record.
  for (const [key, records] of sessions) {
    const [engine, rule] = key.split("\n") as [string, string];
    if (input.catalogue[engine]?.[rule]) continue;
    rules.push({ engine, rule, title: null, criteria: records.map((record) => record.criterion), act: [], kind: ruleKind(rule, { act: [] }), catalogued: false, calibration: null, rulings: null, sessions: records });
  }
  rules.sort((a, b) => a.engine.localeCompare(b.engine) || a.rule.localeCompare(b.rule, "en", { numeric: true }));
  const withRulings = input.runs.filter((run) => run.criteria.some((criterion) => (criterion.observations ?? []).some((observation) => (observation.engineRules ?? []).length > 0)));
  return {
    schema: 1,
    kind: "rule-register",
    date: input.date,
    calibration: { date: input.calibration.date, engines: Object.fromEntries(input.calibration.instruments.filter((instrument) => instrument.kind === "ruleset").map((instrument) => [instrument.id, instrument.version])) },
    field: { runs: input.runs.length, sites: new Set(input.runs.map((run) => run.site)).size, runsWithRulings: withRulings.length, runsWithSessions: input.runs.filter((run) => run.elements.length > 0).length, rulesNotInCatalogue: unknown },
    rules,
  };
}

const ENGINE_NAMES: Record<string, string> = { "axe-core": "axe-core", alfa: "Alfa", ibm: "IBM", qualweb: "QualWeb" };
const KIND_NL: Record<RuleKind, string> = { act: "ACT-regel", technique: "techniek", other: "overig" };
const cell = (text: string): string => text.replace(/\|/g, "\\|");

/** The register for a reader: how much there is to go on, and the rules that stand out. */
export function registerMarkdown(register: RuleRegister): string {
  const lines: string[] = [`# Regelregister van ${register.date}`, ""];
  lines.push(
    `Wat er per regel van elke regelset bekend is. De ijkmeting is van ${register.calibration.date}, met ${Object.entries(register.calibration.engines).map(([engine, version]) => `${ENGINE_NAMES[engine] ?? engine} ${version}`).join(", ")}. Het veld is ${register.field.runs} afgeronde onderzoeken van ${register.field.sites} sites: in ${register.field.runsWithRulings} daarvan legde een beoordelaar per regel een uitspraak vast, in ${register.field.runsWithSessions} draaide een agent de regelsets in een sessie.`,
    "",
  );
  lines.push("## Hoeveel er is", "", "| Regelset | Regels | ACT-regel | Techniek | Overig | Met ijkmeting | Met uitspraak van een beoordelaar | Met een uitslag uit sessies |", "|---|---|---|---|---|---|---|---|");
  const engines = [...new Set(register.rules.map((rule) => rule.engine))];
  for (const engine of engines) {
    const rules = register.rules.filter((rule) => rule.engine === engine);
    const count = (test: (rule: RuleRecord) => boolean): number => rules.filter(test).length;
    lines.push(`| ${ENGINE_NAMES[engine] ?? engine} | ${rules.length} | ${count((rule) => rule.kind === "act")} | ${count((rule) => rule.kind === "technique")} | ${count((rule) => rule.kind === "other")} | ${count((rule) => rule.calibration !== null && rule.calibration.judged > 0)} | ${count((rule) => rule.rulings !== null)} | ${count((rule) => rule.sessions.length > 0)} |`);
  }
  const ruled = register.rules.filter((rule) => rule.rulings !== null);
  const thin = ruled.filter((rule) => rule.rulings!.sites < 3).length;
  lines.push("", `Van de ${ruled.length} regels met een uitspraak van een beoordelaar rusten er ${thin} op minder dan drie sites.`, "");

  lines.push("## Wat beoordelaars over een regel zeiden", "", "Alleen regels met een uitspraak op twee of meer sites. Bevestigd: op die site werd het een bevinding. Verworpen: geen bevinding, en de beoordelaar zei dat er niets aan de hand was.", "", "| Regelset | Regel | Soort | Sites | Bevestigd | Verworpen | Anders |", "|---|---|---|---|---|---|---|");
  for (const rule of ruled.filter((entry) => entry.rulings!.sites >= 2).sort((a, b) => b.rulings!.sites - a.rulings!.sites || a.engine.localeCompare(b.engine) || a.rule.localeCompare(b.rule)))
    lines.push(`| ${ENGINE_NAMES[rule.engine] ?? rule.engine} | ${cell(rule.rule)} | ${KIND_NL[rule.kind]} | ${rule.rulings!.sites} | ${rule.rulings!.confirmed} | ${rule.rulings!.dismissed} | ${rule.rulings!.other} |`);

  lines.push("", "## Regels die afkeuren waar het criterium toch slaagt", "", "Uit de sessies, voor alle vier de regelsets: de regel keurde ergens af op de site, en het onderzoek keurde het criterium goed. Alleen regels waar dat op twee of meer sites gebeurde. De laatste kolom zegt op hoeveel van alle sites het criterium is afgekeurd.", "", "| Regelset | Regel | Soort | Criterium | Sites waar de regel afkeurde | Criterium afgekeurd | Criterium goedgekeurd | Criterium afgekeurd op alle sites |", "|---|---|---|---|---|---|---|---|");
  const passedDespite = register.rules.flatMap((rule) => rule.sessions.filter((session) => session.criterionPassed >= 2).map((session) => ({ rule, session })));
  for (const { rule, session } of passedDespite.sort((a, b) => b.session.criterionPassed - a.session.criterionPassed || a.rule.engine.localeCompare(b.rule.engine) || a.rule.rule.localeCompare(b.rule.rule)))
    lines.push(`| ${ENGINE_NAMES[rule.engine] ?? rule.engine} | ${cell(rule.rule)} | ${KIND_NL[rule.kind]} | ${session.criterion} | ${session.sites} | ${session.criterionFailed} | ${session.criterionPassed} | ${session.base.failed} van ${session.base.sites} |`);

  lines.push("", "## Op de testgevallen van de ACT-regels", "", "Regels die op de testgevallen iets onterecht meldden of iets misten. Een regel die een ACT-regel deelt met een andere regel van dezelfde regelset, is met die andere samen beoordeeld.", "", "| Regelset | Regel | Beoordeeld | Gebreken | Gevonden | Gemist | Onterecht gemeld | Twijfel bij een gebrek |", "|---|---|---|---|---|---|---|---|");
  for (const rule of register.rules.filter((entry) => entry.calibration && (entry.calibration.falseAlarm > 0 || entry.calibration.missed > 0)).sort((a, b) => b.calibration!.falseAlarm - a.calibration!.falseAlarm || b.calibration!.missed - a.calibration!.missed || a.rule.localeCompare(b.rule)))
    lines.push(`| ${ENGINE_NAMES[rule.engine] ?? rule.engine} | ${cell(rule.rule)}${rule.calibration!.sharedWith.length > 0 ? ` (met ${rule.calibration!.sharedWith.map(cell).join(", ")})` : ""} | ${rule.calibration!.judged} | ${rule.calibration!.failures} | ${rule.calibration!.found} | ${rule.calibration!.missed} | ${rule.calibration!.falseAlarm} | ${rule.calibration!.unsureOnFailure} |`);
  if (register.field.rulesNotInCatalogue.length > 0) lines.push("", `Namen die een beoordelaar noemde en die geen regel van één regelset zijn: ${register.field.rulesNotInCatalogue.map((rule) => `\`${rule}\``).join(", ")}.`);
  lines.push("", "Alle regels staan in register.json.", "");
  return lines.join("\n");
}
