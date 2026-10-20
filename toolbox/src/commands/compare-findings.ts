import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { canonicalJson, pageLabels, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { documentDir, documentKind, KIND_NAME_NL, READ_KINDS, type DocumentKind } from "../lib/documents.ts";
import { OUTCOME_LABEL, type CriterionOutcome, type Evaluation } from "../lib/evaluation.ts";
import { siteOrigins } from "../lib/origins.ts";
import { loadAllProcedures, TEMPLATES_DIR } from "../lib/procedures.ts";
import { compareCriterionIds } from "../lib/wcag.ts";
import { compare, type Comparison, type ReferenceAudit, type ReferenceFinding } from "./compare.ts";

export const REFERENCE_CLASSES = ["gevonden", "deels", "gemist-bewijs-beoordeling", "gemist-bewijs-dossier", "gemist-geen-bewijs", "niet-meer-aanwezig", "buiten-bereik"] as const;
export type ReferenceClass = (typeof REFERENCE_CLASSES)[number];

/** For a finding of ours that no reference finding has as counterpart. */
export const OWN_CLASSES = ["terecht", "discutabel", "onterecht"] as const;
export type OwnClass = (typeof OWN_CLASSES)[number];
/** "tegenhanger" is never written by a classifier; it follows from being named under a reference finding. */
export type OwnResult = OwnClass | "tegenhanger";

export const COARSE_CLASSES = ["gevonden", "deels", "gemist", "niet-meer-aanwezig", "buiten-bereik"] as const;
export type CoarseClass = (typeof COARSE_CLASSES)[number];

export const coarse = (value: ReferenceClass): CoarseClass => (value.startsWith("gemist") ? "gemist" : (value as CoarseClass));

const CLASS_LABEL: Record<ReferenceClass | CoarseClass | OwnResult, string> = {
  gevonden: "Gevonden",
  deels: "Deels",
  "gemist-bewijs-beoordeling": "Gemist, bewijs aanwezig, beoordeling ging mis",
  "gemist-bewijs-dossier": "Gemist, bewijs aanwezig, niet in het dossier",
  "gemist-geen-bewijs": "Gemist, geen bewijs",
  gemist: "Gemist",
  "niet-meer-aanwezig": "Niet meer aanwezig",
  "buiten-bereik": "Buiten bereik",
  tegenhanger: "Met tegenhanger",
  terecht: "Terecht",
  discutabel: "Discutabel",
  onterecht: "Onterecht",
};

export type CompareRound = "a" | "b";

export interface InputReferenceFinding extends ReferenceFinding {
  /** What we concluded for the criterion of this finding. */
  ourOutcome: CriterionOutcome | null;
  /** Our findings under the same criterion or one of `alsoCriteria`. A place to start looking, not a decision. */
  candidates: string[];
  /** Decided by script; a classification has to repeat it unchanged. */
  fixed?: { class: ReferenceClass; reasonNl: string };
}

export interface InputOwnFinding {
  id: string;
  criterion: string;
  titleNl: string;
  observedNl: string;
  locations: { page: string; where: string }[];
  pagesAffected: string;
  evidence: string[];
}

export interface CompareInput {
  schema: "loep/compare-findings-input/1";
  site: string;
  baseUrl: string;
  noteNl: string;
  evaluationSha256: string;
  /** The reference without its findings: what the comparison per criterion needs. */
  audit: Omit<ReferenceAudit, "findings">;
  legend: Record<string, { url: string; title: string; status: number | null; files: string; evidence: string[] }>;
  /** What was done with documents in this evaluation: the criteria they were judged on and, per document of the sample, what was read. */
  documents: {
    criteria: string[];
    readKinds: DocumentKind[];
    /** Documents the inventory found on the site that were not chosen for the sample, and so not examined. */
    notChosen: number;
    items: Record<string, { url: string; kind: DocumentKind; status: string; reasonNl: string | null; files: string; evidence: string[] }>;
  };
  criteria: { id: string; titleNl: string; outcome: CriterionOutcome; summaryNl: string; missingNl: string[]; findings: number; dossier: string | null }[];
  reference: InputReferenceFinding[];
  ours: InputOwnFinding[];
}

export interface Classification {
  schema: "loep/compare-findings/1";
  reference: { id: string; class: ReferenceClass; ours: string[]; evidence: string[]; reasonNl: string }[];
  ours: { id: string; class: OwnClass; evidence: string[]; reasonNl: string }[];
}

export interface CompareStamp {
  round: CompareRound;
  inputSha256: string;
  promptSha256: string;
  classificationSha256: string;
  stampedAt: string;
}

const DIR = "compare";
const INPUT = join(DIR, "invoer.json");
const promptFile = (round: CompareRound): string => join(DIR, `opdracht-${round}.md`);
const outputFile = (round: CompareRound): string => join(DIR, `${round}.json`);
const stampFile = (round: CompareRound): string => join(DIR, `${round}.stamp.json`);

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
}

function filesUnder(root: string, relative: string): string[] {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(root, join(relative, entry.name)) : [join(relative, entry.name)]))
    .sort();
}

/** The criteria whose procedure takes documents into account: what the evaluation recorded, or else what the procedures say now. */
function documentCriteria(evaluation: Evaluation): string[] {
  return evaluation.documents?.criteria ?? loadAllProcedures().procedures.filter((procedure) => procedure.evidence.includes("documents")).map((procedure) => procedure.id);
}

/**
 * Why a finding about a document is something the toolbox does not examine, or null when it is
 * within reach. Three things put a document out of reach: another origin, a kind that is not
 * read, and a criterion documents are not judged on. Whether this run chose and read the
 * document is not decided here: that is evidence, and the classifier looks for it.
 */
export function documentOutOfReach(finding: ReferenceFinding, baseUrl: string, criteria: string[], origins: readonly string[] = [new URL(baseUrl).origin]): string | null {
  let url: URL | null = null;
  try {
    url = new URL(finding.page, baseUrl);
  } catch {
    // Not an address: a description of the place. Only the criterion can decide then.
  }
  if (url && !origins.includes(url.origin)) return "Het document staat op een ander domein. De toolbox leest alleen documenten op het eigen domein in.";
  const kind = url ? documentKind(url.href) : null;
  if (kind && !READ_KINDS.includes(kind)) return `Het document is van de soort ${KIND_NAME_NL[kind]}. De toolbox telt die soort en leest haar niet in.`;
  const asked = [finding.criterion, ...(finding.alsoCriteria ?? [])];
  if (!asked.some((criterion) => criteria.includes(criterion))) {
    return `De toolbox beoordeelt documenten niet op ${asked.length === 1 ? "criterium" : "de criteria"} ${asked.join(", ")}, alleen op ${criteria.join(", ")}.`;
  }
  return null;
}

export function buildInput(runDir: string, evaluation: Evaluation, reference: ReferenceAudit, evaluationSha256: string): CompareInput {
  if (!reference.findings || reference.findings.length === 0) {
    throw new Error("the reference has no \"findings\"; compare --findings needs one entry per finding (id, criterion, page, descriptionNl), see validatie/README.md");
  }
  const ids = reference.findings.map((finding) => finding.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0) throw new Error(`reference finding ids are not unique: ${[...new Set(repeated)].join(", ")}`);

  const labels = pageLabels(evaluation.sample.items.length);
  const legend: CompareInput["legend"] = {};
  for (const [index, item] of evaluation.sample.items.entries()) {
    const files = join("pages", item.slug);
    legend[labels[index]!] = { url: item.url, title: item.title, status: item.status, files, evidence: filesUnder(runDir, files) };
  }
  const ours: InputOwnFinding[] = evaluation.criteria.flatMap((criterion) =>
    criterion.findings.map((finding) => ({ id: finding.id, criterion: criterion.id, titleNl: finding.titleNl, observedNl: finding.observedNl, locations: finding.locations, pagesAffected: finding.pagesAffected, evidence: finding.evidence })),
  );
  const criteriaForDocuments = documentCriteria(evaluation);
  const documents: CompareInput["documents"] = { criteria: criteriaForDocuments, readKinds: [...READ_KINDS], notChosen: evaluation.documents?.notChosen ?? 0, items: {} };
  for (const item of evaluation.sample.documents ?? []) {
    const measured = evaluation.documents?.items.find((entry) => entry.label === item.label);
    const files = documentDir(item);
    documents.items[item.label] = { url: item.url, kind: item.kind, status: measured?.status ?? "notMeasured", reasonNl: measured?.reasonNl ?? null, files, evidence: filesUnder(runDir, files) };
  }
  const outcomes = new Map(evaluation.criteria.map((criterion) => [criterion.id, criterion.outcome]));
  const { findings, ...audit } = reference;
  return {
    schema: "loep/compare-findings-input/1",
    site: evaluation.site.name,
    baseUrl: evaluation.site.baseUrl,
    noteNl: "De lijst 'candidates' bij een bevinding van de referentie noemt onze bevindingen onder hetzelfde criterium. Het is een plek om te beginnen met zoeken, geen uitspraak. Paden zijn relatief aan de run-map.",
    evaluationSha256,
    audit,
    legend,
    documents,
    criteria: evaluation.criteria.map((criterion) => {
      const dossier = join("tasks", criterion.id, "dossier.json");
      return { id: criterion.id, titleNl: criterion.titleNl, outcome: criterion.outcome, summaryNl: criterion.summaryNl, missingNl: criterion.missingNl, findings: criterion.findings.length, dossier: existsSync(join(runDir, dossier)) ? dossier : null };
    }),
    reference: findings.map((finding) => {
      const criteria = new Set([finding.criterion, ...(finding.alsoCriteria ?? [])]);
      // A document on the site itself, of a kind that is read, on a criterion documents are judged on, is a finding like any other.
      const outOfReach = finding.medium === "document" ? documentOutOfReach(finding, evaluation.site.baseUrl, criteriaForDocuments, siteOrigins(evaluation.site)) : null;
      return {
        ...finding,
        ourOutcome: outcomes.get(finding.criterion) ?? null,
        candidates: ours.filter((own) => criteria.has(own.criterion)).map((own) => own.id),
        ...(outOfReach ? { fixed: { class: "buiten-bereik" as const, reasonNl: outOfReach } } : {}),
      };
    }),
    ours,
  };
}

/** Write the input and the two fixed prompts for classifying each finding. Nothing here classifies anything. */
export async function compareTasks(runDir: string, referencePath: string): Promise<{ reference: number; ours: number; prompts: string[] }> {
  const evaluationPath = join(runDir, "evaluation.json");
  const evaluation = await readJson<Evaluation>(evaluationPath);
  const input = buildInput(runDir, evaluation, await readJson<ReferenceAudit>(referencePath), await sha256File(evaluationPath));
  await writeJson(join(runDir, INPUT), input);
  const absoluteRun = resolve(runDir);
  const template = readFileSync(join(TEMPLATES_DIR, "vergelijk.md"), "utf8");
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const prompts: string[] = [];
  for (const round of ["a", "b"] as const) {
    const path = join(runDir, promptFile(round));
    await writeFileAtomic(
      path,
      fill(template, {
        site: input.site,
        run: absoluteRun,
        input: join(absoluteRun, INPUT),
        output: join(absoluteRun, outputFile(round)),
        check: `node ${cli} compare --findings check --run ${absoluteRun} --round ${round}`,
      }),
    );
    prompts.push(path);
  }
  return { reference: input.reference.length, ours: input.ours.length, prompts };
}

const isText = (value: unknown, minimum = 1): value is string => typeof value === "string" && value.trim().length >= minimum;

/** Check a classification against the rules that keep the counts comparable between rounds and runs. */
export function validateClassification(candidate: unknown, input: CompareInput, runDir: string): string[] {
  if (candidate === null || typeof candidate !== "object") return ["the classification is not a JSON object"];
  const classification = candidate as Partial<Classification>;
  const problems: string[] = [];
  if (classification.schema !== "loep/compare-findings/1") problems.push('schema must be "loep/compare-findings/1"');
  if (!Array.isArray(classification.reference)) problems.push("reference must be a list");
  if (!Array.isArray(classification.ours)) problems.push("ours must be a list");
  if (problems.length > 0) return problems;

  const answerKey = input.audit.kind === "answer-key";
  const ownIds = new Set(input.ours.map((finding) => finding.id));
  const checkEvidence = (refs: unknown, at: string, required: boolean): void => {
    if (!Array.isArray(refs)) {
      problems.push(`${at}: evidence must be a list`);
      return;
    }
    if (required && refs.length === 0) problems.push(`${at}: this class needs at least one evidence path in the run`);
    for (const ref of refs) {
      if (typeof ref !== "string" || isAbsolute(ref) || normalize(ref).startsWith("..")) problems.push(`${at}: evidence "${String(ref)}" must be a path relative to the run`);
      else if (!existsSync(join(runDir, ref))) problems.push(`${at}: evidence "${ref}" does not exist in the run`);
    }
  };

  const counterparts = new Set<string>();
  const seen = new Set<string>();
  for (const [index, entry] of classification.reference!.entries()) {
    const at = `reference[${index}]${isText(entry?.id) ? ` (${entry.id})` : ""}`;
    const known = input.reference.find((finding) => finding.id === entry?.id);
    if (!known) {
      problems.push(`${at}: id is not a finding of the reference`);
      continue;
    }
    if (seen.has(known.id)) problems.push(`${at}: classified more than once`);
    seen.add(known.id);
    if (!REFERENCE_CLASSES.includes(entry.class)) {
      problems.push(`${at}: class must be one of ${REFERENCE_CLASSES.join(", ")}`);
      continue;
    }
    if (!isText(entry.reasonNl, 10)) problems.push(`${at}: reasonNl is missing or too short`);
    if (known.fixed && entry.class !== known.fixed.class) problems.push(`${at}: the input fixes this finding as "${known.fixed.class}"`);
    if (answerKey && !known.fixed && (entry.class === "niet-meer-aanwezig" || entry.class === "buiten-bereik")) {
      problems.push(`${at}: "${entry.class}" is not possible against an answer key; the defect is there by construction`);
    }
    const named = Array.isArray(entry.ours) ? entry.ours : null;
    if (named === null) problems.push(`${at}: ours must be a list (empty when nothing of ours matches)`);
    const found = entry.class === "gevonden" || entry.class === "deels";
    if (found && (named?.length ?? 0) === 0) problems.push(`${at}: "${entry.class}" must name at least one of our findings`);
    if (!found && (named?.length ?? 0) > 0) problems.push(`${at}: "${entry.class}" cannot name a finding of ours; a finding that covers it makes it "gevonden" or "deels"`);
    for (const id of named ?? []) {
      if (!ownIds.has(id)) problems.push(`${at}: "${String(id)}" is not one of our findings`);
      else if (found) counterparts.add(id);
    }
    checkEvidence(entry.evidence, at, entry.class === "gemist-bewijs-beoordeling" || entry.class === "gemist-bewijs-dossier" || (entry.class === "niet-meer-aanwezig" && !known.fixed));
  }
  for (const finding of input.reference) if (!seen.has(finding.id)) problems.push(`reference: finding ${finding.id} is not classified`);

  const classified = new Set<string>();
  for (const [index, entry] of classification.ours!.entries()) {
    const at = `ours[${index}]${isText(entry?.id) ? ` (${entry.id})` : ""}`;
    if (!ownIds.has(entry?.id)) {
      problems.push(`${at}: id is not one of our findings`);
      continue;
    }
    if (classified.has(entry.id)) problems.push(`${at}: classified more than once`);
    classified.add(entry.id);
    if (counterparts.has(entry.id)) problems.push(`${at}: is named as counterpart of a reference finding and cannot be classified here as well`);
    if (!OWN_CLASSES.includes(entry.class)) problems.push(`${at}: class must be one of ${OWN_CLASSES.join(", ")}`);
    if (!isText(entry.reasonNl, 10)) problems.push(`${at}: reasonNl is missing or too short`);
    checkEvidence(entry.evidence, at, false);
  }
  for (const id of ownIds) if (!counterparts.has(id) && !classified.has(id)) problems.push(`ours: finding ${id} is neither a counterpart nor classified`);
  return problems;
}

async function expectedStamp(runDir: string, round: CompareRound): Promise<Omit<CompareStamp, "stampedAt"> | null> {
  for (const file of [INPUT, promptFile(round), outputFile(round)]) if (!existsSync(join(runDir, file))) return null;
  return { round, inputSha256: await sha256File(join(runDir, INPUT)), promptSha256: await sha256File(join(runDir, promptFile(round))), classificationSha256: await sha256File(join(runDir, outputFile(round))) };
}

/** A classification counts only if it was validated against exactly the input and prompt that exist now. */
export async function classificationIsCurrent(runDir: string, round: CompareRound): Promise<boolean> {
  const path = join(runDir, stampFile(round));
  if (!existsSync(path)) return false;
  const { stampedAt: _stampedAt, ...stamp } = await readJson<CompareStamp>(path);
  const expected = await expectedStamp(runDir, round);
  return expected !== null && canonicalJson(stamp) === canonicalJson(expected);
}

export async function checkClassification(runDir: string, round: CompareRound): Promise<string[]> {
  if (!existsSync(join(runDir, INPUT))) return [`no ${INPUT} in the run; run "compare --findings tasks" first`];
  const input = await readJson<CompareInput>(join(runDir, INPUT));
  let classification: unknown;
  try {
    classification = await readJson<unknown>(join(runDir, outputFile(round)));
  } catch (error) {
    return [`cannot read ${outputFile(round)}: ${(error as Error).message}`];
  }
  const problems = validateClassification(classification, input, runDir);
  if (problems.length === 0) await writeJson(join(runDir, stampFile(round)), { ...(await expectedStamp(runDir, round)), stampedAt: new Date().toISOString() });
  return problems;
}

type Column = "a" | "b" | "agreed";
type Tally<K extends string> = Record<K, Record<Column, number>>;

export interface FindingsSummary {
  schema: "loep/compare-findings-summary/2";
  site: string;
  referenceKind: "audit" | "answer-key";
  provenance: { inputSha256: string; evaluationSha256: string; classificationSha256: Record<CompareRound, string>; promptSha256: string };
  reference: {
    total: number;
    /** Findings about a document. Those within reach of the toolbox count like any other finding. */
    documents: number;
    /** Findings about a document the toolbox does not examine (other origin, a kind that is not read, a criterion documents are not judged on): fixed by script as out of reach, and in no denominator. */
    documentsOutOfReach: number;
    /** All findings minus those fixed by script: the denominator of the shares. */
    counted: number;
    /** Counted findings minus those called gone or out of reach, per column. For "agreed": minus those both called so. */
    stillPresent: Record<Column, number>;
    classes: Tally<ReferenceClass>;
    coarse: Tally<CoarseClass>;
    /** A and B gave a different class. Counted on its own, never resolved. */
    disagreed: number;
    /** A and B differ even on found, partly, missed, gone or out of reach. */
    disagreedCoarse: number;
    agreement: number | null;
    agreementCoarse: number | null;
    /** Found as a share of all counted findings and of those still present. */
    foundShare: Record<Column, { ofCounted: number | null; ofStillPresent: number | null }>;
  };
  ours: {
    total: number;
    classes: Tally<OwnResult>;
    disagreed: number;
    agreement: number | null;
    /** Share of the findings without a counterpart, per column. */
    shareWithoutCounterpart: Record<OwnClass, Record<Column, number | null>>;
    /** More than one finding of ours under one reference finding: the surplus counts as repetition. */
    duplicates: Record<Column, { referenceFindings: number; surplus: number }>;
  };
  criteria: Comparison;
  findings: { id: string; criterion: string; page: string; descriptionNl: string; a: ReferenceClass; b: ReferenceClass; agreed: ReferenceClass | null; agreedCoarse: CoarseClass | null; ours: { a: string[]; b: string[] }; reasonNl: { a: string; b: string } }[];
  ownFindings: { id: string; criterion: string; titleNl: string; a: OwnResult; b: OwnResult; agreed: OwnResult | null; reasonNl: { a: string | null; b: string | null } }[];
}

const share = (count: number, total: number): number | null => (total === 0 ? null : Math.round((count / total) * 1000) / 1000);
const emptyTally = <K extends string>(keys: readonly K[]): Tally<K> => Object.fromEntries(keys.map((key) => [key, { a: 0, b: 0, agreed: 0 }])) as Tally<K>;

/** Put two independent classifications next to each other. Where they differ, that is the result. */
export function mergeClassifications(input: CompareInput, a: Classification, b: Classification, evaluation: Evaluation, provenance: FindingsSummary["provenance"]): FindingsSummary {
  const byId = (classification: Classification): Map<string, Classification["reference"][number]> => new Map(classification.reference.map((entry) => [entry.id, entry]));
  const [refA, refB] = [byId(a), byId(b)];
  const classes = emptyTally(REFERENCE_CLASSES);
  const coarseTally = emptyTally(COARSE_CLASSES);
  const findings: FindingsSummary["findings"] = [];
  const counterparts: Record<Column, Map<string, string[]>> = { a: new Map(), b: new Map(), agreed: new Map() };
  for (const finding of input.reference) {
    const [left, right] = [refA.get(finding.id)!, refB.get(finding.id)!];
    const agreed = left.class === right.class ? left.class : null;
    const agreedCoarse = coarse(left.class) === coarse(right.class) ? coarse(left.class) : null;
    counterparts.a.set(finding.id, left.ours);
    counterparts.b.set(finding.id, right.ours);
    counterparts.agreed.set(finding.id, left.ours.filter((id) => right.ours.includes(id)));
    findings.push({ id: finding.id, criterion: finding.criterion, page: finding.page, descriptionNl: finding.descriptionNl, a: left.class, b: right.class, agreed, agreedCoarse, ours: { a: left.ours, b: right.ours }, reasonNl: { a: left.reasonNl, b: right.reasonNl } });
    // Findings fixed by script (a document the toolbox does not examine) stay out of every count but their own.
    if (finding.fixed) continue;
    classes[left.class].a++;
    classes[right.class].b++;
    if (agreed) classes[agreed].agreed++;
    coarseTally[coarse(left.class)].a++;
    coarseTally[coarse(right.class)].b++;
    if (agreedCoarse) coarseTally[agreedCoarse].agreed++;
  }
  const documents = input.reference.filter((finding) => finding.medium === "document").length;
  const documentsOutOfReach = input.reference.filter((finding) => finding.fixed).length;
  const counted = input.reference.length - documentsOutOfReach;
  const countedFindings = findings.filter((_, index) => !input.reference[index]!.fixed);
  const disagreed = countedFindings.filter((finding) => finding.agreed === null).length;
  const disagreedCoarse = countedFindings.filter((finding) => finding.agreedCoarse === null).length;
  const columns = ["a", "b", "agreed"] as const;
  const stillPresent = Object.fromEntries(columns.map((column) => [column, counted - classes["niet-meer-aanwezig"][column] - classes["buiten-bereik"][column]])) as Record<Column, number>;

  const ownClass = (classification: Classification, column: "a" | "b", id: string): { class: OwnResult; reasonNl: string | null } => {
    if ([...counterparts[column].values()].some((ids) => ids.includes(id))) return { class: "tegenhanger", reasonNl: null };
    const entry = classification.ours.find((candidate) => candidate.id === id)!;
    return { class: entry.class, reasonNl: entry.reasonNl };
  };
  const ownTally = emptyTally(["tegenhanger", ...OWN_CLASSES] as const);
  const ownFindings: FindingsSummary["ownFindings"] = input.ours.map((finding) => {
    const [left, right] = [ownClass(a, "a", finding.id), ownClass(b, "b", finding.id)];
    const agreed = left.class === right.class ? left.class : null;
    ownTally[left.class].a++;
    ownTally[right.class].b++;
    if (agreed) ownTally[agreed].agreed++;
    return { id: finding.id, criterion: finding.criterion, titleNl: finding.titleNl, a: left.class, b: right.class, agreed, reasonNl: { a: left.reasonNl, b: right.reasonNl } };
  });
  const ownDisagreed = ownFindings.filter((finding) => finding.agreed === null).length;
  const duplicates = Object.fromEntries(
    columns.map((column) => {
      const multiple = [...counterparts[column].values()].filter((ids) => ids.length > 1);
      return [column, { referenceFindings: multiple.length, surplus: multiple.reduce((sum, ids) => sum + ids.length - 1, 0) }];
    }),
  ) as FindingsSummary["ours"]["duplicates"];

  return {
    schema: "loep/compare-findings-summary/2",
    site: input.site,
    referenceKind: input.audit.kind ?? "audit",
    provenance,
    reference: {
      total: input.reference.length,
      documents,
      documentsOutOfReach,
      counted,
      stillPresent,
      classes,
      coarse: coarseTally,
      disagreed,
      disagreedCoarse,
      agreement: share(counted - disagreed, counted),
      agreementCoarse: share(counted - disagreedCoarse, counted),
      foundShare: Object.fromEntries(columns.map((column) => [column, { ofCounted: share(classes.gevonden[column], counted), ofStillPresent: share(classes.gevonden[column], stillPresent[column]) }])) as FindingsSummary["reference"]["foundShare"],
    },
    ours: {
      total: input.ours.length,
      classes: ownTally,
      disagreed: ownDisagreed,
      agreement: share(input.ours.length - ownDisagreed, input.ours.length),
      shareWithoutCounterpart: Object.fromEntries(
        OWN_CLASSES.map((key) => [key, Object.fromEntries(columns.map((column) => [column, share(ownTally[key][column], input.ours.length - ownTally.tegenhanger[column])]))]),
      ) as FindingsSummary["ours"]["shareWithoutCounterpart"],
      duplicates,
    },
    criteria: compare(evaluation, input.audit as ReferenceAudit),
    findings,
    ownFindings,
  };
}

const percent = (value: number | null): string => (value === null ? "n.v.t." : `${Math.round(value * 100)}%`);
const cell = (text: string): string => text.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

export function findingsMarkdown(summary: FindingsSummary): string {
  const { reference, ours, criteria } = summary;
  const row = (label: string, counts: Record<Column, number>, total: Record<Column, number>): string =>
    `| ${label} | ${counts.a} (${percent(share(counts.a, total.a))}) | ${counts.b} (${percent(share(counts.b, total.b))}) | ${counts.agreed} (${percent(share(counts.agreed, total.agreed))}) |`;
  const allCounted = { a: reference.counted, b: reference.counted, agreed: reference.counted };
  const withoutCounterpart = { a: ours.total - ours.classes.tegenhanger.a, b: ours.total - ours.classes.tegenhanger.b, agreed: ours.total - ours.classes.tegenhanger.agreed };
  const allOurs = { a: ours.total, b: ours.total, agreed: ours.total };
  const missed = criteria.missed.filter((entry) => entry.ours === "passed" || entry.ours === "inapplicable");
  const lines = [
    `# Vergelijking per bevinding: ${summary.site}`,
    "",
    summary.referenceKind === "answer-key"
      ? "De referentie is een antwoordsleutel: de fouten zijn met opzet ingebouwd en bestaan dus zeker."
      : "De referentie is een bestaand onderzoek. Zo'n onderzoek noemt voorbeelden en is niet uitputtend.",
    `Twee beoordelaars (A en B) hebben elke bevinding onafhankelijk van elkaar ingedeeld met dezelfde vaste opdracht. De kolom "Eens" telt alleen bevindingen waar A en B dezelfde klasse gaven. Waar ze verschillen, is dat een eigen getal. Het verschil is niet opgelost.`,
    "",
    "## De getallen die ertoe doen",
    "",
    "| | A | B | Eens |",
    "|---|---|---|---|",
    `| Gevonden, van alle ${reference.counted} bevindingen die meetellen | ${percent(reference.foundShare.a.ofCounted)} | ${percent(reference.foundShare.b.ofCounted)} | ${percent(reference.foundShare.agreed.ofCounted)} |`,
    `| Gevonden, van wat nog bestaat en binnen bereik is (${reference.stillPresent.a}, ${reference.stillPresent.b}, ${reference.stillPresent.agreed}) | ${percent(reference.foundShare.a.ofStillPresent)} | ${percent(reference.foundShare.b.ofStillPresent)} | ${percent(reference.foundShare.agreed.ofStillPresent)} |`,
    `| Eigen bevindingen onterecht, van die zonder tegenhanger | ${percent(ours.shareWithoutCounterpart.onterecht.a)} | ${percent(ours.shareWithoutCounterpart.onterecht.b)} | ${percent(ours.shareWithoutCounterpart.onterecht.agreed)} |`,
    "",
    `- A en B oneens over een bevinding van de referentie: ${reference.disagreed} van ${reference.counted} (${percent(share(reference.disagreed, reference.counted))}).`,
    `- Daarvan ook oneens op hoofdlijn (gevonden, deels, gemist, niet meer aanwezig, buiten bereik): ${reference.disagreedCoarse} (${percent(share(reference.disagreedCoarse, reference.counted))}).`,
    `- A en B oneens over een eigen bevinding: ${ours.disagreed} van ${ours.total} (${percent(share(ours.disagreed, ours.total))}).`,
    `- Criteria die de referentie afkeurt en die wij goedkeurden of niet van toepassing noemden: ${missed.length}${missed.length ? ` (${missed.map((entry) => entry.id).join(", ")})` : ""}.`,
    "",
    "## Bevindingen van de referentie",
    "",
    `${reference.total} bevindingen, waarvan ${reference.documents} over een document. ${reference.documentsOutOfReach === 0 ? "Ze tellen allemaal mee." : `${reference.documentsOutOfReach} daarvan ${reference.documentsOutOfReach === 1 ? "gaat" : "gaan"} over een document dat de toolbox niet onderzoekt (een ander domein, een soort die niet wordt ingelezen of een criterium waarop documenten niet worden beoordeeld) en ${reference.documentsOutOfReach === 1 ? "telt" : "tellen"} nergens mee.`} Percentages zijn van de ${reference.counted} bevindingen die meetellen.`,
    "",
    "| Klasse | A | B | Eens |",
    "|---|---|---|---|",
    ...REFERENCE_CLASSES.map((key) => row(CLASS_LABEL[key], reference.classes[key], allCounted)),
    `| Oneens | | | ${reference.disagreed} (${percent(share(reference.disagreed, reference.counted))}) |`,
    "",
    "Op hoofdlijn:",
    "",
    "| Klasse | A | B | Eens |",
    "|---|---|---|---|",
    ...COARSE_CLASSES.map((key) => row(CLASS_LABEL[key], reference.coarse[key], allCounted)),
    `| Oneens | | | ${reference.disagreedCoarse} (${percent(share(reference.disagreedCoarse, reference.counted))}) |`,
    "",
    "## Onze bevindingen",
    "",
    `${ours.total} bevindingen. "Met tegenhanger" is een aandeel van alle bevindingen. De andere drie zijn een aandeel van de bevindingen zonder tegenhanger (${withoutCounterpart.a} bij A, ${withoutCounterpart.b} bij B, ${withoutCounterpart.agreed} waar ze het eens zijn dat er een tegenhanger is, afgetrokken van het totaal).`,
    "",
    "| Klasse | A | B | Eens |",
    "|---|---|---|---|",
    row(CLASS_LABEL.tegenhanger, ours.classes.tegenhanger, allOurs),
    ...OWN_CLASSES.map((key) => row(CLASS_LABEL[key], ours.classes[key], withoutCounterpart)),
    `| Oneens | | | ${ours.disagreed} (${percent(share(ours.disagreed, ours.total))}) |`,
    "",
    `Herhaling: bij A staan onder ${ours.duplicates.a.referenceFindings} bevindingen van de referentie meer dan één van onze bevindingen (${ours.duplicates.a.surplus} te veel), bij B onder ${ours.duplicates.b.referenceFindings} (${ours.duplicates.b.surplus} te veel).`,
    "",
    "## Per criterium",
    "",
    "| | Aantal |",
    "|---|---|",
    `| Door de referentie afgekeurd | ${criteria.bothFailed.length + criteria.missed.length} |`,
    `| Daarvan ook door ons afgekeurd | ${criteria.bothFailed.length} (${percent(criteria.recall)}) |`,
    `| Daarvan door ons niet beslist | ${criteria.missed.length - missed.length} (${percent(criteria.undecidedRate)}) |`,
    `| Daarvan door ons goedgekeurd of niet van toepassing verklaard | ${missed.length} (${percent(criteria.falsePassRate)}) |`,
    `| Alleen door ons afgekeurd | ${criteria.onlyOurs.length} |`,
    "",
    ...(criteria.missed.length ? ["Andere uitkomst bij ons:", "", ...criteria.missed.map((entry) => `- ${entry.id}: ${OUTCOME_LABEL[entry.ours]}`), ""] : []),
    "## Waar A en B verschillen",
    "",
    ...(reference.disagreed + ours.disagreed === 0
      ? ["Nergens."]
      : [
          "| Nr. | A | B | Reden A | Reden B |",
          "|---|---|---|---|---|",
          ...summary.findings.filter((finding) => finding.agreed === null).map((finding) => `| ${cell(finding.id)} | ${CLASS_LABEL[finding.a]} | ${CLASS_LABEL[finding.b]} | ${cell(finding.reasonNl.a)} | ${cell(finding.reasonNl.b)} |`),
          ...summary.ownFindings.filter((finding) => finding.agreed === null).map((finding) => `| ${cell(finding.id)} | ${CLASS_LABEL[finding.a]} | ${CLASS_LABEL[finding.b]} | ${cell(finding.reasonNl.a ?? "")} | ${cell(finding.reasonNl.b ?? "")} |`),
        ]),
    "",
    "## Bijlage: de bevindingen van de referentie",
    "",
    "| Nr. | SC | Pagina | Kern | Klasse | Onze bevinding |",
    "|---|---|---|---|---|---|",
    ...summary.findings.map((finding) => `| ${cell(finding.id)} | ${finding.criterion} | ${cell(finding.page)} | ${cell(finding.descriptionNl)} | ${finding.agreed ? CLASS_LABEL[finding.agreed] : `Oneens: ${CLASS_LABEL[finding.a]} / ${CLASS_LABEL[finding.b]}`} | ${cell([...new Set([...finding.ours.a, ...finding.ours.b])].join(", "))} |`),
    "",
    "## Bijlage: onze bevindingen",
    "",
    "| Nr. | SC | Kern | Klasse |",
    "|---|---|---|---|",
    ...[...summary.ownFindings].sort((left, right) => compareCriterionIds(left.criterion, right.criterion)).map((finding) => `| ${cell(finding.id)} | ${finding.criterion} | ${cell(finding.titleNl)} | ${finding.agreed ? CLASS_LABEL[finding.agreed] : `Oneens: ${CLASS_LABEL[finding.a]} / ${CLASS_LABEL[finding.b]}`} |`),
    "",
  ];
  return lines.join("\n");
}

/** The two current classifications of a run side by side, without writing anything. Throws when one is missing or no longer current. */
export async function findingsSummary(runDir: string): Promise<FindingsSummary> {
  for (const round of ["a", "b"] as const) {
    if (!(await classificationIsCurrent(runDir, round))) throw new Error(`classification ${round} has no current stamp; run "compare --findings check --round ${round}" (again) first`);
  }
  const input = await readJson<CompareInput>(join(runDir, INPUT));
  const evaluationSha256 = await sha256File(join(runDir, "evaluation.json"));
  if (evaluationSha256 !== input.evaluationSha256) throw new Error("evaluation.json changed after the comparison tasks were written; run \"compare --findings tasks\" again");
  const [a, b] = [await readJson<Classification>(join(runDir, outputFile("a"))), await readJson<Classification>(join(runDir, outputFile("b")))];
  return mergeClassifications(input, a, b, await readJson<Evaluation>(join(runDir, "evaluation.json")), {
    inputSha256: await sha256File(join(runDir, INPUT)),
    evaluationSha256,
    classificationSha256: { a: await sha256File(join(runDir, outputFile("a"))), b: await sha256File(join(runDir, outputFile("b"))) },
    promptSha256: sha256(readFileSync(join(TEMPLATES_DIR, "vergelijk.md"), "utf8")),
  });
}

export async function mergeRun(runDir: string, outDir: string): Promise<FindingsSummary> {
  const summary = await findingsSummary(runDir);
  await writeJson(join(outDir, "bevindingen.json"), summary);
  await writeFileAtomic(join(outDir, "bevindingen.md"), findingsMarkdown(summary));
  return summary;
}

const USAGE = `loep compare --findings <step> [options]

  tasks --run <run> --reference <file>   Write <run>/compare/invoer.json and the two fixed prompts (opdracht-a.md, opdracht-b.md)
  check --run <run> --round <a|b>        Validate <run>/compare/<round>.json; non-zero exit on problems
  merge --run <run> --out <dir>          Put the two classifications side by side; write bevindingen.md and bevindingen.json

The reference needs a list "findings"; see validatie/README.md. Two separate agents each get one prompt.
`;

export async function cli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { findings: { type: "boolean" }, run: { type: "string" }, reference: { type: "string" }, out: { type: "string" }, round: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  const [step] = positionals;
  if (values.help || !step) {
    process.stdout.write(USAGE);
    return;
  }
  switch (step) {
    case "tasks": {
      if (!values.run || !values.reference) throw new Error("compare --findings tasks needs --run and --reference");
      const result = await compareTasks(values.run, values.reference);
      process.stdout.write(`${result.reference} bevindingen van de referentie, ${result.ours} van ons\n${result.prompts.join("\n")}\n`);
      return;
    }
    case "check": {
      if (!values.run || (values.round !== "a" && values.round !== "b")) throw new Error("compare --findings check needs --run and --round a|b");
      const problems = await checkClassification(values.run, values.round);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de indeling voldoet aan de vorm\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "merge": {
      if (!values.run || !values.out) throw new Error("compare --findings merge needs --run and --out");
      const { reference, ours } = await mergeRun(values.run, values.out);
      process.stdout.write(
        `gevonden ${reference.classes.gevonden.agreed} van ${reference.counted} (${percent(reference.foundShare.agreed.ofCounted)}) waar A en B het eens zijn; oneens ${reference.disagreed} van ${reference.counted}, eigen bevindingen oneens ${ours.disagreed} van ${ours.total}\n`,
      );
      return;
    }
    default:
      throw new Error(`unknown step "${step}"\n\n${USAGE}`);
  }
}
