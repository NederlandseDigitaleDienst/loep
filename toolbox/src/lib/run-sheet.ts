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
import type { QuickComparison, QuickSummary } from "./quick.ts";
import { RULINGS, type FieldRun, type Ruling } from "./rule-register.ts";
import { openPoint } from "./verdict.ts";
import { compareCriterionIds } from "./wcag.ts";

export const SHEET_SCHEMA = 1;
export const SHEET_FILE = "meetblad.json";

const ENGINE_PACKAGES: Record<string, string> = { "axe-core": "axe-core", alfa: "@siteimprove/alfa-rules", ibm: "accessibility-checker-engine", qualweb: "@qualweb/act-rules" };
const OUTCOMES = ["failed", "passed", "cantTell", "inapplicable", "untested"];
/** The technologies `evaluate` can name. A label that is not one of these is not copied: a test holds this list to evaluate.ts. */
export const TECHNOLOGIES = ["CSS", "HTML", "JavaScript", "SVG", "WAI-ARIA", "Web Components (shadow DOM)"];

/** A count made coarse: the exact number of findings under a criterion, next to its outcome, is what ties a sheet to a published report. */
export const findingsBucket = (count: number): string => (count === 0 ? "0" : count === 1 ? "1" : count <= 5 ? "2-5" : "6+");
/** The number of pages of a site, made coarse for the same reason. */
export const populationBucket = (count: number | undefined | null): string | null => (typeof count !== "number" ? null : count < 50 ? "0-49" : count < 200 ? "50-199" : count < 1000 ? "200-999" : "1000+");

export interface RunSheet {
  schema: typeof SHEET_SCHEMA;
  kind: "run-sheet";
  /**
   * Tells one run from another and says nothing about the site: a hash of what the run measured
   * and of its verdicts. The same after a new `evaluate` or `weigh`, so a run contributed twice is
   * one file; different for a second judging of the same sweep.
   */
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
  /** Per role which model how many agents said they ran on; `notGiven` counts the agents that said nothing. */
  modelsPerRole: { role: string; model: string; agents: number }[];
  /** Whether the evaluation follows up on an earlier one of the same site. */
  followsUp: boolean;
  purpose: string | null;
  technologies: string[];
  /** `population`, the pages of the site, is a range. */
  size: { pages: number; pageTypes: number; population: string | null; documents: number; frames: number };
  /** `findings` is a range: 0, 1, 2-5 or 6+. */
  criteria: { id: string; outcome: string; basis: string | null; agreement: string | null; establishedBy: string | null; rounds: { a: string | null; b: string | null; final: string | null }; findings: string; open: Record<string, number> }[];
  /** What a judge ruled where it named a rule of an engine. */
  rulings: ({ rule: string; criterion: string } & Record<Ruling, number>)[];
  /**
   * Where an agent ran the engines in a session: how many elements a rule failed under a criterion,
   * each element of a page once however often an agent asked, and how the other engines stood on
   * those elements. Agreed: another engine failed it too.
   * Contradicted: no other failed it and one passed it. Alone: the others said nothing.
   */
  sessions: { engine: string; rule: string; criterion: string; elements: number; agreed: number; alone: number; contradicted: number }[];
  /** The sweep: on how many pages a rule failed, could not tell or passed, and on how many elements it failed. */
  sweep: { engine: string; rule: string; pagesFailed: number; pagesCantTell: number; pagesPassed: number; elementsFailed: number }[];
  /** The probes of the sweep: on how many pages each saw something. Null for a run without a sweep. */
  probes: { pages: number; reflow: number; zoom: number; textSpacing: number; tabWalkNotCompleted: number } | null;
  /** The evidence gate. Null for a run without one. */
  gate: { sufficient: boolean; exploreRounds: number; resweeps: number; accepted: number } | null;
  defects: { total: number; bySeverity: Record<string, number>; byOwner: Record<string, number> };
  /**
   * What people did with the evaluation: signed it, established a criterion themselves, decided on
   * a defect (per kind of decision), had a finding measured again, and made a statement with a status.
   */
  human: { signed: boolean; criteriaByPerson: number; decisions: Record<string, number>; rechecks: number; statement: string | null };
  /** Seconds per command of the run, added up. */
  seconds: Record<string, number>;
  /** Sessions and extensions of their budget, per role. */
  sessionsPerRole: { role: string; sessions: number; extended: number; extensions: number }[];
  /** For a quick measurement: what it counted, per rule and probe. Null for an evaluation. */
  quick: {
    pages: number;
    dismissed: boolean;
    covered: boolean;
    /** Places per rule (`engine:rule`, or `loep:probe`): on a strong ground, on a weak one, and on how many pages. */
    rules: { rule: string; criterion: string; strong: number; weak: number; pages: number }[];
    /** Held against a baseline: how it ended. */
    comparison: { ok: boolean; strict: boolean; worse: number; weak: number; unstable: number; better: number; notMeasured: number } | null;
  } | null;
}

/** What of a run the sheet is built from. Every field is optional but the evaluation: an old run has less. */
export interface SheetSource {
  /** The bytes of evaluation.json, or of the summary of a quick measurement: the id is their hash. */
  evaluationText: string;
  evaluation: {
    followsUp?: unknown;
    evaluatedAt?: string;
    site?: { baseUrl?: string };
    criteria: { id: string; outcome: string; basis?: string | null; agreement?: string | null; established?: { by?: string } | null; rounds?: { a?: string | null; b?: string | null; final?: string | null } | null; provenance?: { verdictSha256?: { a?: string | null; b?: string | null; final?: string | null } } | null; findings?: unknown[]; missingNl?: string[]; limitsNl?: string[]; observations?: { engineRules?: string[]; ruling?: string }[] }[];
    toolchain?: { toolbox?: { version?: string }; browser?: { version?: string }; packages?: Record<string, string> };
    judgment?: { models?: { role?: string; notGiven?: number; models?: { model?: string; agents?: number }[] }[]; extensions?: { role?: string; sessions?: number; extended?: number; extensions?: number }[] };
    purpose?: string | null;
    technologies?: string[];
    sample?: { items?: unknown[]; pageTypes?: unknown[]; populationSize?: number; documents?: unknown[] };
    scope?: { frames?: unknown[] };
    defects?: { severity?: string; owner?: string }[];
    aiGenerated?: { humanReview?: { criteriaByPerson?: unknown[] } } | null;
    signature?: unknown;
  };
  /**
   * `result.grouped.elements` of every `rules` observation of a session, with the page it was
   * measured on and the selector of the element: they tell one element from another and are not
   * copied. `rules` holds per engine the rules that failed the element.
   */
  sessionElements: { criterion: string; page?: string; where?: string; verdicts?: Record<string, string>; rules?: Record<string, string[]> }[];
  /** The results of the engines of the sweep, one list per page and colour scheme. */
  sweepPages: { page: string; results: { engine?: string; rule?: string; outcome?: string; nodeCount?: number }[] }[];
  /** The steps of the manifest. */
  steps: { command?: string; seconds?: number }[];
  /** What tells this run from another run of the same site: the seed of its manifest, or the hash of its inventory. */
  runMark?: string | undefined;
  /** Whether a person signed the run: the signature stands in a file of its own, not in the evaluation. */
  signed?: boolean | undefined;
  /** The version of the toolbox in the manifest, for a run whose evaluation does not say. */
  toolboxVersion?: string | undefined;
  /** What the sweep summed up per page (collect.json). */
  collectPages?: { reflow?: { horizontalScroll?: boolean; offenders?: number }; zoom200?: { horizontalScroll?: boolean; offenders?: number }; textspacing?: { newlyClipped?: number }; tabwalk?: { outcome?: string } }[] | undefined;
  /** gate.json. */
  gate?: { sufficient?: boolean; exploreRound?: number; resweeps?: number; accepted?: unknown[] } | undefined;
  /** The kind of each decision on a defect (besluiten/). */
  decisions?: string[] | undefined;
  /** How many findings were measured again (rechecks/). */
  rechecks?: number | undefined;
  /** The status of the statement, when there is one. */
  statementStatus?: string | undefined;
  /** quick/summary.json and quick/verschil.json of a quick measurement. */
  quick?: { summary: QuickSummary; comparison: QuickComparison | null } | undefined;
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

/**
 * The id of a model out of what an agent wrote, such as "Claude Opus 5.5 (claude-opus-5-5)": the
 * token with hyphens and a digit, as `modelKey` of the report takes it, without a suffix in
 * brackets. Null when the text has no such token: the sheet copies no free text.
 */
export function modelId(text: string): string | null {
  const tokens = text.match(/[a-z][a-z0-9.]*(?:-[a-z0-9.]+)+/gi) ?? [];
  const id = tokens.find((token) => /\d/.test(token))?.toLowerCase().replace(/\.+$/, "");
  return id && /^[a-z0-9.-]{3,60}$/.test(id) ? id : null;
}

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

  // A judge writes the name of a rule itself. Only a name an engine of this run gave counts: anything else could be a word of the site.
  const produced = new Set<string>();
  for (const element of source.sessionElements) for (const rules of Object.values(element.rules ?? {})) for (const rule of rules) produced.add(rule);
  for (const { results } of source.sweepPages) for (const result of results) if (result.rule) produced.add(result.rule);
  const rulings = new Map<string, { rule: string; criterion: string } & Record<Ruling, number>>();
  for (const criterion of evaluation.criteria) {
    for (const observation of criterion.observations ?? []) {
      if (!RULINGS.includes(observation.ruling as Ruling)) continue;
      for (const named of observation.engineRules ?? []) {
        const rule = produced.has(named) ? safeWord(named, /^[\w.:-]{1,80}$/) : null;
        if (!rule) continue;
        const entry = rulings.get(`${rule}\n${criterion.id}`) ?? { rule, criterion: criterion.id, finding: 0, noIssue: 0, otherCriterion: 0, open: 0 };
        entry[observation.ruling as Ruling] += 1;
        rulings.set(`${rule}\n${criterion.id}`, entry);
      }
    }
  }

  const sessions = new Map<string, RunSheet["sessions"][number]>();
  // An agent asks for the rules on a page more than once: an element of a page counts once per rule.
  const counted = new Set<string>();
  for (const [nr, element] of source.sessionElements.entries()) {
    const verdicts = Object.entries(element.verdicts ?? {}).filter(([engine]) => engine in ENGINE_PACKAGES);
    const failing = verdicts.filter(([, verdict]) => verdict === "failed").length;
    const stand = failing > 1 ? "agreed" : verdicts.some(([, verdict]) => verdict === "passed") ? "contradicted" : "alone";
    // Without a page or a selector there is nothing to tell two elements by: each counts.
    const place = element.where === undefined ? `#${nr}` : `${element.page ?? ""}\n${element.where}`;
    for (const [engine, verdict] of verdicts) {
      if (verdict !== "failed") continue;
      for (const named of element.rules?.[engine] ?? []) {
        const rule = safeWord(named, /^[\w.:-]{1,80}$/);
        if (!rule) continue;
        const key = `${engine}\n${rule}\n${element.criterion}`;
        if (counted.has(`${key}\n${place}`)) continue;
        counted.add(`${key}\n${place}`);
        const entry = sessions.get(key) ?? { engine, rule, criterion: element.criterion, elements: 0, agreed: 0, alone: 0, contradicted: 0 };
        entry.elements += 1;
        entry[stand] += 1;
        sessions.set(key, entry);
      }
    }
  }

  // Per rule, the pages it failed on: light and dark of one page are one page.
  const sweep = new Map<string, { engine: string; rule: string; failed: Set<string>; cantTell: Set<string>; passed: Set<string>; elementsFailed: number }>();
  for (const { page, results } of source.sweepPages) {
    for (const result of results) {
      const rule = safeWord(result.rule, /^[\w.:-]{1,80}$/);
      if (!rule || !result.engine || !(result.engine in ENGINE_PACKAGES) || (result.outcome !== "failed" && result.outcome !== "cantTell" && result.outcome !== "passed")) continue;
      const entry = sweep.get(`${result.engine}\n${rule}`) ?? { engine: result.engine, rule, failed: new Set<string>(), cantTell: new Set<string>(), passed: new Set<string>(), elementsFailed: 0 };
      if (result.outcome === "failed") {
        // The same elements fail in light and in dark: counted once, on the first scheme that has them.
        if (!entry.failed.has(page)) entry.elementsFailed += result.nodeCount ?? 0;
        entry.failed.add(page);
      } else if (result.outcome === "cantTell") entry.cantTell.add(page);
      else entry.passed.add(page);
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
  const perRole: RunSheet["modelsPerRole"] = [];
  for (const role of evaluation.judgment?.models ?? []) {
    const name = safeWord(role.role, /^[a-z-]{1,40}$/);
    if (!name) continue;
    const agents = new Map<string, number>();
    for (const entry of role.models ?? []) {
      // An agent that named its model in words without an id still ran: it counts, under "other".
      const id = (entry.model ? modelId(entry.model) : null) ?? "other";
      agents.set(id, (agents.get(id) ?? 0) + (entry.agents ?? 1));
    }
    for (const [model, count] of [...agents].sort(([a], [b]) => a.localeCompare(b))) perRole.push({ role: name, model, agents: count });
    if ((role.notGiven ?? 0) > 0) perRole.push({ role: name, model: "notGiven", agents: role.notGiven! });
  }
  const loss = (answer: { horizontalScroll?: boolean; offenders?: number } | undefined): boolean => Boolean(answer && (answer.horizontalScroll || (answer.offenders ?? 0) > 0));
  const collected = source.collectPages;
  const quick = source.quick ? quickPart(source.quick.summary, source.quick.comparison) : null;
  const address = siteAddress(evaluation.site?.baseUrl ?? source.quick?.summary.site);
  const byRule = <T extends { rule: string }>(a: T, b: T): number => a.rule.localeCompare(b.rule, "en", { numeric: true });

  return {
    schema: SHEET_SCHEMA,
    kind: "run-sheet",
    id: createHash("sha256").update(runIdentity(source)).digest("hex").slice(0, 16),
    siteKey: createHmac("sha256", key).update(address ?? source.evaluationText).digest("hex").slice(0, 16),
    month: /^\d{4}-\d{2}/.exec(evaluation.evaluatedAt ?? source.quick?.summary.finishedAt ?? "")?.[0] ?? "onbekend",
    toolbox: { version: safeWord(evaluation.toolchain?.toolbox?.version ?? source.toolboxVersion, /^[\w.+-]{1,40}$/) },
    browser: safeWord(evaluation.toolchain?.browser?.version, /^[\w.+ -]{1,40}$/),
    engines: {
      ...Object.fromEntries(Object.entries(ENGINE_PACKAGES).flatMap(([engine, name]) => (safeWord(packages[name], /^[\w.+-]{1,40}$/) ? [[engine, packages[name]!]] : []))),
      ...Object.fromEntries((source.quick?.summary.engines ?? []).flatMap((engine) => (engine.id in ENGINE_PACKAGES && safeWord(engine.version, /^[\w.+-]{1,40}$/) ? [[engine.id, engine.version]] : []))),
    },
    models: [...models].sort(),
    modelsPerRole: perRole,
    followsUp: evaluation.followsUp != null,
    purpose: safeWord(evaluation.purpose, /^[a-z-]{1,40}$/),
    technologies: (evaluation.technologies ?? []).filter((name) => TECHNOLOGIES.includes(name)).sort(),
    size: { pages: evaluation.sample?.items?.length ?? quick?.pages ?? 0, pageTypes: evaluation.sample?.pageTypes?.length ?? 0, population: populationBucket(evaluation.sample?.populationSize), documents: evaluation.sample?.documents?.length ?? 0, frames: evaluation.scope?.frames?.length ?? 0 },
    criteria: evaluation.criteria
      .map((criterion) => ({
        id: criterion.id,
        outcome: outcome(criterion.outcome) ?? "untested",
        basis: safeWord(criterion.basis, /^[a-z-]{1,40}$/),
        agreement: safeWord(criterion.agreement, /^[a-z-]{1,40}$/),
        establishedBy: safeWord(criterion.established?.by, /^[a-z-]{1,40}$/),
        rounds: { a: outcome(criterion.rounds?.a), b: outcome(criterion.rounds?.b), final: outcome(criterion.rounds?.final) },
        findings: findingsBucket(criterion.findings?.length ?? 0),
        // Only the kind of an open point: the sentence after it is about the site.
        open: count([...(criterion.missingNl ?? []), ...(criterion.limitsNl ?? [])], (point) => openPoint(point).kind?.prefix ?? "anders"),
      }))
      .sort((a, b) => compareCriterionIds(a.id, b.id)),
    rulings: [...rulings.values()].sort((a, b) => byRule(a, b) || compareCriterionIds(a.criterion, b.criterion)),
    sessions: [...sessions.values()].sort((a, b) => a.engine.localeCompare(b.engine) || byRule(a, b) || compareCriterionIds(a.criterion, b.criterion)),
    sweep: [...sweep.values()].map((entry) => ({ engine: entry.engine, rule: entry.rule, pagesFailed: entry.failed.size, pagesCantTell: entry.cantTell.size, pagesPassed: [...entry.passed].filter((page) => !entry.failed.has(page)).length, elementsFailed: entry.elementsFailed })).sort((a, b) => a.engine.localeCompare(b.engine) || byRule(a, b)),
    probes: collected
      ? { pages: collected.length, reflow: collected.filter((page) => loss(page.reflow)).length, zoom: collected.filter((page) => loss(page.zoom200)).length, textSpacing: collected.filter((page) => (page.textspacing?.newlyClipped ?? 0) > 0).length, tabWalkNotCompleted: collected.filter((page) => page.tabwalk?.outcome !== undefined && page.tabwalk.outcome !== "completed").length }
      : null,
    gate: source.gate ? { sufficient: source.gate.sufficient === true, exploreRounds: source.gate.exploreRound ?? 0, resweeps: source.gate.resweeps ?? 0, accepted: source.gate.accepted?.length ?? 0 } : null,
    defects: { total: evaluation.defects?.length ?? 0, bySeverity: count(evaluation.defects ?? [], (defect) => safeWord(defect.severity, /^[a-z]{1,20}$/)), byOwner: count(evaluation.defects ?? [], (defect) => safeWord(defect.owner, /^[a-z]{1,20}$/)) },
    human: {
      signed: source.signed ?? evaluation.signature != null,
      criteriaByPerson: evaluation.aiGenerated?.humanReview?.criteriaByPerson?.length ?? 0,
      decisions: count(source.decisions ?? [], (decision) => safeWord(decision, /^[a-z-]{1,40}$/)),
      rechecks: source.rechecks ?? 0,
      statement: safeWord(source.statementStatus, /^[A-D]$/),
    },
    seconds: Object.fromEntries(Object.entries(seconds).sort(([a], [b]) => a.localeCompare(b))),
    sessionsPerRole: (evaluation.judgment?.extensions ?? []).flatMap((entry) => (safeWord(entry.role, /^[a-z-]{1,40}$/) ? [{ role: entry.role!, sessions: entry.sessions ?? 0, extended: entry.extended ?? 0, extensions: entry.extensions ?? 0 }] : [])),
    quick,
  };
}

/** What a quick measurement counted, without the pages and the elements it counted them on. */
function quickPart(summary: QuickSummary, comparison: QuickComparison | null): NonNullable<RunSheet["quick"]> {
  const rules = new Map<string, { rule: string; criterion: string; strong: number; weak: number; pages: Set<string> }>();
  for (const entry of summary.counts ?? []) {
    const rule = safeWord(entry.rule, /^[\w.:-]{1,80}$/);
    // A summary from before a count said how strong its ground is cannot be split: left out, not guessed.
    if (!rule || typeof entry.strong !== "boolean") continue;
    const found = rules.get(`${rule}\n${entry.criterion}`) ?? { rule, criterion: entry.criterion, strong: 0, weak: 0, pages: new Set<string>() };
    found[entry.strong ? "strong" : "weak"] += entry.places;
    found.pages.add(entry.path);
    rules.set(`${rule}\n${entry.criterion}`, found);
  }
  return {
    pages: summary.coverage?.measured ?? 0,
    dismissed: (summary.covering?.dismiss ?? []).length > 0,
    covered: (summary.covering?.layers ?? []).length > 0,
    rules: [...rules.values()].map((entry) => ({ rule: entry.rule, criterion: entry.criterion, strong: entry.strong, weak: entry.weak, pages: entry.pages.size })).sort((a, b) => a.rule.localeCompare(b.rule, "en", { numeric: true }) || compareCriterionIds(a.criterion, b.criterion)),
    comparison: comparison ? { ok: comparison.ok, strict: comparison.strict === true, worse: comparison.worse.length, weak: (comparison.weak ?? []).length, unstable: (comparison.unstable ?? []).length, better: comparison.better.length, notMeasured: comparison.notMeasured.length } : null,
  };
}

/** What makes a run this run and not another: what it measured, and the verdicts it reached. Not the bytes of the evaluation, which change when it is made again or weighed. */
function runIdentity(source: SheetSource): string {
  if (source.quick && source.evaluation.criteria.length === 0) return `quick\n${source.runMark ?? source.evaluationText}`;
  const verdicts = source.evaluation.criteria.map((criterion) => {
    const hashes = criterion.provenance?.verdictSha256;
    // A run from before a verdict had a hash: the outcomes of the rounds, which a person's answer does not change.
    return `${criterion.id}:${hashes?.final ?? hashes?.a ?? `${criterion.rounds?.a ?? ""}/${criterion.rounds?.b ?? ""}/${criterion.rounds?.final ?? criterion.outcome}`}`;
  });
  return `evaluation\n${source.runMark ?? ""}\n${verdicts.sort().join("\n")}`;
}

const SHEET_FIELDS = ["schema", "kind", "id", "siteKey", "month", "toolbox", "browser", "engines", "models", "modelsPerRole", "followsUp", "purpose", "technologies", "size", "criteria", "rulings", "sessions", "sweep", "probes", "gate", "defects", "human", "seconds", "sessionsPerRole", "quick"];

/** Every string in a value, also the names of its fields. */
function stringsOf(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringsOf(entry, into);
  else if (value && typeof value === "object") for (const [name, entry] of Object.entries(value)) stringsOf(entry, stringsOf(name, into));
  return into;
}

/**
 * What is wrong with a sheet: a field that is not one of its own, a value that is not a word of
 * loep, something that looks like an address, or the host of the site. A sheet holds none of these
 * by construction; this is the check that it stays so. It holds a sheet to what it may contain,
 * not to a list of words of the site: a site called "open" has a sheet full of the field `open`.
 */
export function sheetLeaks(sheet: RunSheet, site: { baseUrl?: string | undefined; names?: readonly (string | undefined)[] }): string[] {
  const found = new Set<string>();
  for (const field of Object.keys(sheet)) if (!SHEET_FIELDS.includes(field)) found.add(`een veld dat niet op een meetblad hoort: ${field}`);
  const strings = stringsOf(sheet);
  for (const text of strings) {
    if (!/^[\w.:+ ()-]{1,80}$/.test(text)) found.add(`een waarde die geen woord van loep is: ${text.slice(0, 40)}`);
    else if (/https?:|\/\//i.test(text) || /[a-z0-9-]+\.(nl|com|org|net|eu|app|io|dev|be|de|info|frl|amsterdam)\b/i.test(text)) found.add("een adres");
  }
  for (const technology of sheet.technologies) if (!TECHNOLOGIES.includes(technology)) found.add(`een techniek die loep niet kent: ${technology.slice(0, 40)}`);
  const host = site.baseUrl && URL.canParse(site.baseUrl) ? new URL(site.baseUrl).hostname.toLowerCase() : null;
  // The host of the site, whole or without "www.", anywhere in a value.
  if (host) for (const text of strings) if (text.toLowerCase().includes(host) || text.toLowerCase().includes(host.replace(/^www\./, ""))) found.add(host);
  // The name of the site as a model or a rule: the strings an agent or an engine gave, not the words of the sheet itself. A site called "open" has a sheet full of the field `open`.
  const names = (site.names ?? []).filter((name): name is string => typeof name === "string" && name.trim().length >= 4).map((name) => name.trim().toLowerCase());
  const given = [...sheet.models, ...sheet.modelsPerRole.map((entry) => entry.model), ...sheet.rulings.map((entry) => entry.rule), ...sheet.sessions.map((entry) => entry.rule), ...sheet.sweep.map((entry) => entry.rule), ...(sheet.quick?.rules ?? []).map((entry) => entry.rule)];
  for (const text of given) if (names.includes(text.trim().toLowerCase())) found.add(text.trim().toLowerCase());
  return [...found].sort();
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
