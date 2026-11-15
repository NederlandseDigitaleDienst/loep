/**
 * The sheet of a run (`meetblad.json`): what a finished evaluation says about loep itself, without
 * what it says about the site. Rule ids, criterion ids, outcomes and counts, and nothing else: no
 * address, no selector, no sentence of a page or of a verdict. It is what a run contributes to a
 * shared collection, and what the rule register reads.
 *
 * Built from a closed set of words by construction. `sheetLeaks` checks the result all the same:
 * a field added later that carries text of the site should fail here, not in a repository.
 */
import { createHash, createHmac } from "node:crypto";
import type { FieldRun } from "./rule-register.ts";
import { openPoint } from "./verdict.ts";
import { compareCriterionIds } from "./wcag.ts";

export const SHEET_SCHEMA = 1;
export const SHEET_FILE = "meetblad.json";

const ENGINE_PACKAGES: Record<string, string> = { "axe-core": "axe-core", alfa: "@siteimprove/alfa-rules", ibm: "accessibility-checker-engine", qualweb: "@qualweb/act-rules" };
const OUTCOMES = ["failed", "passed", "cantTell", "inapplicable", "untested"];
const RULINGS = ["finding", "noIssue", "otherCriterion", "open"] as const;
type Ruling = (typeof RULINGS)[number];

export interface RunSheet {
  schema: typeof SHEET_SCHEMA;
  kind: "run-sheet";
  /** Tells one run from another and says nothing about the site: a hash of the evaluation. */
  id: string;
  /**
   * Tells one site from another within the sheets of one contributor: a keyed hash of the address
   * with a key that stays on the contributor's machine. Nobody else can try addresses against it.
   */
  siteKey: string;
  /** Year and month, not the day: the day with the version narrows down which run it was. */
  month: string;
  toolbox: { version: string | null };
  browser: string | null;
  engines: Record<string, string>;
  /** Model ids as the agents gave them, reduced to the id. */
  models: string[];
  purpose: string | null;
  technologies: string[];
  size: { pages: number; pageTypes: number; population: number | null; documents: number; frames: number };
  criteria: { id: string; outcome: string; basis: string | null; agreement: string | null; establishedBy: string | null; rounds: { a: string | null; b: string | null; final: string | null }; findings: number; open: Record<string, number> }[];
  /** What a judge ruled where it named a rule of an engine. */
  rulings: ({ rule: string; criterion: string } & Record<Ruling, number>)[];
  /** Where an agent ran the engines in a session: how many elements a rule failed under a criterion. */
  sessions: { engine: string; rule: string; criterion: string; elements: number }[];
  /** The sweep: on how many pages a rule failed or could not tell, and on how many elements. */
  sweep: { engine: string; rule: string; pagesFailed: number; pagesCantTell: number; elementsFailed: number }[];
  defects: { total: number; bySeverity: Record<string, number>; byOwner: Record<string, number> };
  human: { signed: boolean; criteriaByPerson: number };
  /** Seconds per command of the run, added up. */
  seconds: Record<string, number>;
  /** Sessions and extensions of their budget, per role. */
  sessionsPerRole: { role: string; sessions: number; extended: number; extensions: number }[];
}

/** What of a run the sheet is built from. Every field is optional but the evaluation: an old run has less. */
export interface SheetSource {
  /** The bytes of evaluation.json: the id is their hash. */
  evaluationText: string;
  evaluation: {
    evaluatedAt?: string;
    site?: { baseUrl?: string };
    criteria: { id: string; outcome: string; basis?: string | null; agreement?: string | null; established?: { by?: string } | null; rounds?: { a?: string | null; b?: string | null; final?: string | null } | null; findings?: unknown[]; missingNl?: string[]; limitsNl?: string[]; observations?: { engineRules?: string[]; ruling?: string }[] }[];
    toolchain?: { toolbox?: { version?: string }; browser?: { version?: string }; packages?: Record<string, string> };
    judgment?: { models?: { models?: { model?: string }[] }[]; extensions?: { role?: string; sessions?: number; extended?: number; extensions?: number }[] };
    purpose?: string | null;
    technologies?: string[];
    sample?: { items?: unknown[]; pageTypes?: unknown[]; populationSize?: number; documents?: unknown[] };
    scope?: { frames?: unknown[] };
    defects?: { severity?: string; owner?: string }[];
    aiGenerated?: { humanReview?: { criteriaByPerson?: unknown[] } } | null;
    signature?: unknown;
  };
  /** `result.grouped.elements` of every `rules` observation of a session. */
  sessionElements: { criterion: string; verdicts?: Record<string, string>; rules?: Record<string, string[]> }[];
  /** The results of the engines of the sweep, one list per page and colour scheme. */
  sweepPages: { page: string; results: { engine?: string; rule?: string; outcome?: string; nodeCount?: number }[] }[];
  /** The steps of the manifest. */
  steps: { command?: string; seconds?: number }[];
}

/** A word loep itself made: letters, digits and the few marks its ids and labels use. Anything else is not copied. */
const safeWord = (value: unknown, pattern = /^[\w.:+ ()-]{1,80}$/): string | null => (typeof value === "string" && pattern.test(value) ? value : null);
const count = <T>(items: readonly T[], key: (item: T) => string | null): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const name = key(item);
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

/** The id of a model out of what an agent wrote, such as "Claude Opus 5.5 (claude-opus-5-5)". */
export const modelId = (text: string): string | null => /\b(claude-[a-z0-9-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|kimi-[a-z0-9-]+|[a-z]+-[a-z0-9.-]*\d[a-z0-9.-]*)\b/i.exec(text)?.[1]?.toLowerCase() ?? null;

/** The address of a site as far as it tells one site from another: the origin and the first part of the path. */
export function siteAddress(baseUrl: string | undefined): string | null {
  if (!baseUrl || !URL.canParse(baseUrl)) return null;
  const url = new URL(baseUrl);
  return `${url.origin}/${url.pathname.split("/").filter(Boolean)[0] ?? ""}`;
}

export function buildSheet(source: SheetSource, key: string): RunSheet {
  const { evaluation } = source;
  const packages = evaluation.toolchain?.packages ?? {};
  const outcome = (value: unknown): string | null => (typeof value === "string" && OUTCOMES.includes(value) ? value : null);

  const rulings = new Map<string, { rule: string; criterion: string } & Record<Ruling, number>>();
  for (const criterion of evaluation.criteria) {
    for (const observation of criterion.observations ?? []) {
      if (!RULINGS.includes(observation.ruling as Ruling)) continue;
      for (const named of observation.engineRules ?? []) {
        const rule = safeWord(named, /^[\w.:-]{1,80}$/);
        if (!rule) continue;
        const entry = rulings.get(`${rule}\n${criterion.id}`) ?? { rule, criterion: criterion.id, finding: 0, noIssue: 0, otherCriterion: 0, open: 0 };
        entry[observation.ruling as Ruling] += 1;
        rulings.set(`${rule}\n${criterion.id}`, entry);
      }
    }
  }

  const sessions = new Map<string, RunSheet["sessions"][number]>();
  for (const element of source.sessionElements) {
    for (const [engine, verdict] of Object.entries(element.verdicts ?? {})) {
      if (verdict !== "failed" || !(engine in ENGINE_PACKAGES)) continue;
      for (const named of element.rules?.[engine] ?? []) {
        const rule = safeWord(named, /^[\w.:-]{1,80}$/);
        if (!rule) continue;
        const entry = sessions.get(`${engine}\n${rule}\n${element.criterion}`) ?? { engine, rule, criterion: element.criterion, elements: 0 };
        entry.elements += 1;
        sessions.set(`${engine}\n${rule}\n${element.criterion}`, entry);
      }
    }
  }

  // Per rule, the pages it failed on: light and dark of one page are one page.
  const sweep = new Map<string, { engine: string; rule: string; failed: Set<string>; cantTell: Set<string>; elementsFailed: number }>();
  for (const { page, results } of source.sweepPages) {
    for (const result of results) {
      const rule = safeWord(result.rule, /^[\w.:-]{1,80}$/);
      if (!rule || !result.engine || !(result.engine in ENGINE_PACKAGES) || (result.outcome !== "failed" && result.outcome !== "cantTell")) continue;
      const entry = sweep.get(`${result.engine}\n${rule}`) ?? { engine: result.engine, rule, failed: new Set<string>(), cantTell: new Set<string>(), elementsFailed: 0 };
      if (result.outcome === "failed") {
        // The same elements fail in light and in dark: counted once, on the first scheme that has them.
        if (!entry.failed.has(page)) entry.elementsFailed += result.nodeCount ?? 0;
        entry.failed.add(page);
      } else entry.cantTell.add(page);
      sweep.set(`${result.engine}\n${rule}`, entry);
    }
  }

  const seconds: Record<string, number> = {};
  for (const step of source.steps) {
    const command = safeWord(step.command, /^[a-z-]{1,40}$/);
    if (command && typeof step.seconds === "number") seconds[command] = (seconds[command] ?? 0) + step.seconds;
  }
  const models = new Set<string>();
  for (const role of evaluation.judgment?.models ?? []) for (const entry of role.models ?? []) if (entry.model && modelId(entry.model)) models.add(modelId(entry.model)!);
  const address = siteAddress(evaluation.site?.baseUrl);
  const byRule = <T extends { rule: string }>(a: T, b: T): number => a.rule.localeCompare(b.rule, "en", { numeric: true });

  return {
    schema: SHEET_SCHEMA,
    kind: "run-sheet",
    id: createHash("sha256").update(source.evaluationText).digest("hex").slice(0, 16),
    siteKey: createHmac("sha256", key).update(address ?? source.evaluationText).digest("hex").slice(0, 16),
    month: /^\d{4}-\d{2}/.exec(evaluation.evaluatedAt ?? "")?.[0] ?? "onbekend",
    toolbox: { version: safeWord(evaluation.toolchain?.toolbox?.version, /^[\w.+-]{1,40}$/) },
    browser: safeWord(evaluation.toolchain?.browser?.version, /^[\w.+ -]{1,40}$/),
    engines: Object.fromEntries(Object.entries(ENGINE_PACKAGES).flatMap(([engine, name]) => (safeWord(packages[name], /^[\w.+-]{1,40}$/) ? [[engine, packages[name]!]] : []))),
    models: [...models].sort(),
    purpose: safeWord(evaluation.purpose, /^[a-z-]{1,40}$/),
    technologies: (evaluation.technologies ?? []).map((name) => safeWord(name)).filter((name): name is string => name !== null).sort(),
    size: { pages: evaluation.sample?.items?.length ?? 0, pageTypes: evaluation.sample?.pageTypes?.length ?? 0, population: evaluation.sample?.populationSize ?? null, documents: evaluation.sample?.documents?.length ?? 0, frames: evaluation.scope?.frames?.length ?? 0 },
    criteria: evaluation.criteria
      .map((criterion) => ({
        id: criterion.id,
        outcome: outcome(criterion.outcome) ?? "untested",
        basis: safeWord(criterion.basis, /^[a-z-]{1,40}$/),
        agreement: safeWord(criterion.agreement, /^[a-z-]{1,40}$/),
        establishedBy: safeWord(criterion.established?.by, /^[a-z-]{1,40}$/),
        rounds: { a: outcome(criterion.rounds?.a), b: outcome(criterion.rounds?.b), final: outcome(criterion.rounds?.final) },
        findings: criterion.findings?.length ?? 0,
        // Only the kind of an open point: the sentence after it is about the site.
        open: count([...(criterion.missingNl ?? []), ...(criterion.limitsNl ?? [])], (point) => openPoint(point).kind?.prefix ?? "anders"),
      }))
      .sort((a, b) => compareCriterionIds(a.id, b.id)),
    rulings: [...rulings.values()].sort((a, b) => byRule(a, b) || compareCriterionIds(a.criterion, b.criterion)),
    sessions: [...sessions.values()].sort((a, b) => a.engine.localeCompare(b.engine) || byRule(a, b) || compareCriterionIds(a.criterion, b.criterion)),
    sweep: [...sweep.values()].map((entry) => ({ engine: entry.engine, rule: entry.rule, pagesFailed: entry.failed.size, pagesCantTell: entry.cantTell.size, elementsFailed: entry.elementsFailed })).sort((a, b) => a.engine.localeCompare(b.engine) || byRule(a, b)),
    defects: { total: evaluation.defects?.length ?? 0, bySeverity: count(evaluation.defects ?? [], (defect) => safeWord(defect.severity, /^[a-z]{1,20}$/)), byOwner: count(evaluation.defects ?? [], (defect) => safeWord(defect.owner, /^[a-z]{1,20}$/)) },
    human: { signed: evaluation.signature != null, criteriaByPerson: evaluation.aiGenerated?.humanReview?.criteriaByPerson?.length ?? 0 },
    seconds: Object.fromEntries(Object.entries(seconds).sort(([a], [b]) => a.localeCompare(b))),
    sessionsPerRole: (evaluation.judgment?.extensions ?? []).flatMap((entry) => (safeWord(entry.role, /^[a-z-]{1,40}$/) ? [{ role: entry.role!, sessions: entry.sessions ?? 0, extended: entry.extended ?? 0, extensions: entry.extensions ?? 0 }] : [])),
  };
}

/**
 * Words of the site that stand in a sheet. A sheet holds none by construction; this is the check
 * that it stays so. Given: the address of the site, and the names it goes by.
 */
export function sheetLeaks(sheet: RunSheet, site: { baseUrl?: string | undefined; names?: readonly (string | undefined)[] }): string[] {
  const text = JSON.stringify(sheet).toLowerCase();
  const words = new Set<string>();
  if (site.baseUrl && URL.canParse(site.baseUrl)) {
    const url = new URL(site.baseUrl);
    words.add(url.hostname);
    // The labels of the host apart from "www" and the suffix: "voorbeeldstad" of www.voorbeeldstad.nl.
    for (const label of url.hostname.split(".").slice(0, -1)) if (label !== "www" && label.length >= 3) words.add(label);
    for (const part of url.pathname.split("/")) if (part.length >= 4) words.add(part);
  }
  for (const name of site.names ?? []) for (const word of (name ?? "").split(/\s+/)) if (word.length >= 4) words.add(word);
  const found = [...words].map((word) => word.toLowerCase()).filter((word) => text.includes(word));
  if (/https?:\/\//.test(text)) found.push("een adres (http)");
  return [...new Set(found)].sort();
}

/** A sheet as the rule register reads a run: the same counts, with the site as its key. */
export function fieldRunOfSheet(sheet: RunSheet): FieldRun {
  const observations = new Map<string, { engineRules: string[]; ruling: string }[]>();
  for (const entry of sheet.rulings) {
    const list = observations.get(entry.criterion) ?? [];
    for (const ruling of RULINGS) for (let nr = 0; nr < entry[ruling]; nr += 1) list.push({ engineRules: [entry.rule], ruling });
    observations.set(entry.criterion, list);
  }
  return {
    site: sheet.siteKey,
    criteria: sheet.criteria.map((criterion) => ({ id: criterion.id, outcome: criterion.outcome, observations: observations.get(criterion.id) ?? [] })),
    // One element is enough: the register asks whether a rule failed in the run, not how often.
    elements: sheet.sessions.map((entry) => ({ criterion: entry.criterion, verdicts: { [entry.engine]: "failed" }, rules: { [entry.engine]: [entry.rule] } })),
  };
}
