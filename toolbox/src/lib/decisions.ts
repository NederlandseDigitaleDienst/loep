import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256File } from "./canonical.ts";
import type { CheckedRecheck } from "../commands/recheck.ts";
import type { Defect } from "./defects.ts";
import type { RecordedVia } from "./recorded.ts";

/*
 * What the organisation decides about each defect, after the report is signed. A decision is no
 * part of the evaluation and no part of the seal: it comes later and may change, and recording one
 * leaves the signed evaluation as it was. The decisions are a layer of their own next to the seal,
 * like the signature: one file per defect and an index with the hash of each file. The hash of
 * that index is the mark of the layer, which the report and `verify` name.
 */

export const DECISIONS_DIR = "besluiten";
const INDEX = "index.json";
export const DECISIONS_INDEX = `${DECISIONS_DIR}/${INDEX}`;
export const decisionFile = (defectId: string): string => `${DECISIONS_DIR}/${defectId}.json`;

/** What can be decided about a defect. "onbesloten" records that it was discussed and stays open. */
export const DECISION_KINDS = ["opgelost", "gepland", "zienswijze", "onevenredig", "onbesloten"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** "Opgelost" is what the organisation says; only a new measurement shows that the defect is gone (docs/methode.md). `decisionLabelNl` adds what the rechecks show. */
export const DECISION_LABEL_NL: Record<DecisionKind, string> = {
  opgelost: "Opgelost volgens de organisatie",
  gepland: "Herstel gepland",
  zienswijze: "Andere zienswijze",
  onevenredig: "Onevenredige last",
  onbesloten: "Nog niet besloten",
};

/** What `whatNl` holds for each kind, for the messages of `decide`. */
export const DECISION_WHAT_NL: Record<DecisionKind, string> = {
  opgelost: "wat er is hersteld",
  gepland: "wat er gaat gebeuren",
  zienswijze: "waarom de organisatie het anders ziet",
  onevenredig: "de afweging",
  onbesloten: "waarom er nog geen besluit is",
};

export interface Decision {
  /** The defect as the evaluation named it when the decision was recorded. */
  defect: { id: string; titleNl: string; mainCriterion: string };
  decision: DecisionKind;
  whatNl: string | null;
  /** jjjj-mm-dd: by when (gepland) or since when (opgelost). Null for the other kinds. */
  date: string | null;
  /** The alternative a visitor has meanwhile; with "onevenredig". */
  alternativeNl: string | null;
  /** The name stays in this file, outside the seal; the report shows the role. */
  name: string;
  role: string;
  decidedAt: string;
  /** How it came about: confirmed at a terminal, or recorded by the agent in the conversation. `decidedAt` is the moment of the confirmation. Absent in no decision `decide` writes. */
  recordedVia?: RecordedVia;
  /** With "gesprek": what the person said, word for word, and the summary they confirmed. */
  confirmationNl?: string;
  summaryNl?: string;
  /** The seal of the signed run the decision was recorded for. */
  sealSha256: string;
}

/** A decision as the run keeps it: the one that counts, with every earlier one about the same defect, newest first. */
export interface DecisionFile extends Decision {
  previous: Decision[];
}

export interface DecisionLayer {
  /** The decisions about defects that are in the evaluation. */
  decisions: DecisionFile[];
  /** The hash of the index of the layer; null when nothing was decided. */
  sha256: string | null;
  /** The rechecks of findings that passed their check, and how many did not; they say whether "opgelost" was measured again. */
  rechecks?: { checked: CheckedRecheck[]; unchecked: number };
}

/** Said before a name is asked for and after it is stored. */
export const DECISION_PRIVACY_NL = `de naam staat alleen in ${DECISIONS_DIR}/<gebrek>.json in de map van de run; het rapport en de verklaring noemen alleen de functie. De map ${DECISIONS_DIR}/ valt niet onder het zegel. Wie de map van de run deelt of publiceert, deelt ook de naam`;

function decisionNames(runDir: string): string[] {
  const dir = join(runDir, DECISIONS_DIR);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json") && name !== INDEX).sort() : [];
}

export async function readIndex(runDir: string): Promise<Record<string, string>> {
  const path = join(runDir, DECISIONS_INDEX);
  return existsSync(path) ? ((await readJson<{ files?: Record<string, string> }>(path)).files ?? {}) : {};
}

/** The decisions of a run about the defects of its evaluation. A decision about a defect that is no longer there does not count; `verify` names it. */
export async function loadDecisions(runDir: string, defects: Defect[] | undefined): Promise<DecisionLayer> {
  const ids = new Set((defects ?? []).map((defect) => defect.id));
  const decisions: DecisionFile[] = [];
  for (const name of decisionNames(runDir)) {
    const decision = await readJson<DecisionFile>(join(runDir, DECISIONS_DIR, name));
    if (ids.has(decision.defect?.id)) decisions.push(decision);
  }
  const index = join(runDir, DECISIONS_INDEX);
  return { decisions, sha256: existsSync(index) ? await sha256File(index) : null };
}

export interface DecisionCheck {
  decisions: number;
  viaConversation: number;
  viaTerminal: number;
  sha256: string | null;
  problems: string[];
}

/** Recompute the layer of decisions: every file against the index, and every decision against the defects of the evaluation. Null when nothing was decided. */
export async function checkDecisions(runDir: string, defects: Defect[] | undefined): Promise<DecisionCheck | null> {
  const names = decisionNames(runDir);
  const indexed = await readIndex(runDir).catch(() => null);
  if (names.length === 0 && !existsSync(join(runDir, DECISIONS_INDEX))) return null;
  const problems: string[] = [];
  if (indexed === null) problems.push(`onleesbaar: ${DECISIONS_INDEX}`);
  const ids = new Set((defects ?? []).map((defect) => defect.id));
  let viaConversation = 0;
  let viaTerminal = 0;
  for (const name of names) {
    const path = `${DECISIONS_DIR}/${name}`;
    const hash = await sha256File(join(runDir, path));
    if (indexed && !(name in indexed)) problems.push(`niet in de laag met besluiten: ${path}`);
    else if (indexed && indexed[name] !== hash) problems.push(`gewijzigd: ${path}`);
    const decision = await readJson<DecisionFile>(join(runDir, path)).catch(() => null);
    if (!decision) problems.push(`onleesbaar: ${path}`);
    else if (!ids.has(decision.defect?.id)) problems.push(`${path}: het gebrek ${decision.defect?.id ?? "zonder nummer"} staat niet in deze evaluatie`);
    else if (decision.recordedVia === "terminal") viaTerminal++;
    else if (decision.recordedVia === "gesprek" && decision.confirmationNl && decision.summaryNl) viaConversation++;
    else problems.push(`${path}: zegt niet hoe het besluit is vastgelegd (in een terminal, of in een gesprek met de letterlijke bevestiging en de samenvatting)`);
  }
  for (const name of Object.keys(indexed ?? {})) if (!names.includes(name)) problems.push(`ontbreekt: ${DECISIONS_DIR}/${name}`);
  const index = join(runDir, DECISIONS_INDEX);
  return { decisions: names.length, viaConversation, viaTerminal, sha256: existsSync(index) ? await sha256File(index) : null, problems };
}

/** The date of a measure: by when it will be done, or since when it is done. Null for a decision that is no measure. */
export function measureDate(decision: Decision): string | null {
  if (decision.decision === "gepland") return decision.date;
  if (decision.decision === "opgelost") return decision.date ?? decision.decidedAt.slice(0, 10);
  return null;
}

/** A recheck of a finding that passed its check (`check-recheck`), as `loadRechecks` gives it. */
export interface FindingRecheck {
  finding: string;
  outcome: "nog aanwezig" | "opgelost" | "niet na te gaan";
  measuredAt: string;
}

export const NOT_REMEASURED_NL = "nog niet nagemeten";

/**
 * What the rechecks say about the findings of a defect, as a phrase: the latest recheck of each
 * finding counts. One finding still there says so; "opgelost" only when every finding was measured
 * again as gone. `date` writes out the moment of a measurement.
 */
export function remeasuredNl(findingIds: string[], rechecks: FindingRecheck[], date: (iso: string) => string): string {
  const latest = findingIds.map((id) => rechecks.filter((entry) => entry.finding === id).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)).at(-1));
  const on = (entries: (FindingRecheck | undefined)[]): string => date(entries.map((entry) => entry!.measuredAt).sort().at(-1)!);
  const of = (count: number): string => (findingIds.length === 1 ? "" : `${count} van de ${findingIds.length} bevindingen `);
  const present = latest.filter((entry) => entry?.outcome === "nog aanwezig");
  if (present.length > 0) return `nagemeten op ${on(present)}: ${of(present.length)}nog aanwezig`;
  const solved = latest.filter((entry) => entry?.outcome === "opgelost");
  if (solved.length === 0) return NOT_REMEASURED_NL;
  return `nagemeten op ${on(solved)}: ${solved.length === findingIds.length ? "opgelost" : `${of(solved.length)}opgelost, de andere ${NOT_REMEASURED_NL}`}`;
}

/** The label of a decision with its date, already written out. "Opgelost" also says what the rechecks show (`remeasuredNl`). */
export function decisionLabelNl(kind: DecisionKind, date: string | null, remeasured = NOT_REMEASURED_NL): string {
  const dated = `${DECISION_LABEL_NL[kind]}${date && (kind === "gepland" || kind === "opgelost") ? ` (${date})` : ""}`;
  return kind === "opgelost" ? `${dated}, ${remeasured}` : dated;
}
