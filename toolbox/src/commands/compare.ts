import { join } from "node:path";
import { readJson, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { OUTCOME_LABEL, type CriterionOutcome, type Evaluation } from "../lib/evaluation.ts";
import type { WcagVersion } from "../lib/wcag.ts";

/** One finding of the reference: the smallest unit a run can be said to have found or missed. */
export interface ReferenceFinding {
  /** Stable within the reference. */
  id: string;
  criterion: string;
  /** URL or path on the site, or "alle". */
  page: string;
  descriptionNl: string;
  /** Selector or plain description of the place. */
  where?: string;
  /** The state needed to see it: initial, at 320 px, after opening something. */
  state?: string;
  /** "document": a pdf or office file. Counted like any finding unless the toolbox does not examine that document (see `documentOutOfReach`). */
  medium?: "web" | "document";
  /** Other criteria the same defect touches. */
  alsoCriteria?: string[];
}

/** What an existing, trusted audit concluded: the reference a run is compared against. */
export interface ReferenceAudit {
  /** "answer-key": the defects exist by construction, as on the fixture site. Absent means "audit". */
  kind?: "audit" | "answer-key";
  /** Per finding; needed for `compare --findings`, not for the comparison per criterion. */
  findings?: ReferenceFinding[];
  wcagVersion: WcagVersion;
  sampleNote: string;
  outcomeNote: string;
  failed: string[];
  /** Criteria the audit failed only on documents such as PDFs, which the toolbox does not evaluate. */
  failedOnlyInDocuments?: string[];
  problemCount?: number;
}

export interface Comparison {
  site: string;
  wcagVersion: WcagVersion;
  criteria: number;
  /** Failed in both. */
  bothFailed: string[];
  /** Failed in the reference, and we reached a different outcome. */
  missed: { id: string; ours: CriterionOutcome }[];
  /** Failed by us, not by the reference. Each needs checking: false alarm, or something the audit missed. */
  onlyOurs: string[];
  /** Not failed by either, with our outcome. */
  neitherFailed: Record<string, number>;
  /** Of the criteria the reference failed: the share we also failed. */
  recall: number | null;
  /** Of those, the share we passed or called inapplicable: the error that matters most. */
  falsePassRate: number | null;
  /** Of those, the share we left undecided. */
  undecidedRate: number | null;
}

export function compare(evaluation: Evaluation, reference: ReferenceAudit): Comparison {
  const relevant = evaluation.criteria.filter((criterion) => criterion.versions.includes(reference.wcagVersion));
  // A criterion that was failed on a PDF only says nothing about the web pages the toolbox looked at.
  const documentsOnly = new Set(reference.failedOnlyInDocuments ?? []);
  const referenceFailed = new Set(reference.failed.filter((id) => !documentsOnly.has(id)));
  const bothFailed: string[] = [];
  const missed: Comparison["missed"] = [];
  const onlyOurs: string[] = [];
  const neitherFailed: Record<string, number> = {};
  for (const criterion of relevant) {
    if (referenceFailed.has(criterion.id)) {
      if (criterion.outcome === "failed") bothFailed.push(criterion.id);
      else missed.push({ id: criterion.id, ours: criterion.outcome });
    } else if (criterion.outcome === "failed") onlyOurs.push(criterion.id);
    else neitherFailed[criterion.outcome] = (neitherFailed[criterion.outcome] ?? 0) + 1;
  }
  const total = bothFailed.length + missed.length;
  const share = (count: number): number | null => (total === 0 ? null : Math.round((count / total) * 100) / 100);
  return {
    site: evaluation.site.name,
    wcagVersion: reference.wcagVersion,
    criteria: relevant.length,
    bothFailed,
    missed,
    onlyOurs,
    neitherFailed,
    recall: share(bothFailed.length),
    falsePassRate: share(missed.filter((entry) => entry.ours === "passed" || entry.ours === "inapplicable").length),
    undecidedRate: share(missed.filter((entry) => entry.ours === "cantTell" || entry.ours === "untested").length),
  };
}

function percent(value: number | null): string {
  return value === null ? "n.v.t." : `${Math.round(value * 100)}%`;
}

export function comparisonMarkdown(comparison: Comparison, evaluation: Evaluation, reference: ReferenceAudit): string {
  const title = (id: string): string => `${id} ${evaluation.criteria.find((criterion) => criterion.id === id)?.titleNl ?? ""}`;
  const total = comparison.bothFailed.length + comparison.missed.length;
  const lines = [
    `# Vergelijking met een bestaand onderzoek: ${comparison.site}`,
    "",
    `Norm: WCAG ${comparison.wcagVersion}, ${comparison.criteria} succescriteria. ${reference.sampleNote} ${reference.outcomeNote}`,
    ...(reference.failedOnlyInDocuments?.length ? ["", `Het bestaande onderzoek keurt ${reference.failedOnlyInDocuments.join(" en ")} alleen af op documenten. Die tellen hier niet mee.`] : []),
    "",
    "## Uitkomst per criterium",
    "",
    "| | Aantal |",
    "|---|---|",
    `| Door het bestaande onderzoek afgekeurd | ${total} |`,
    `| Daarvan ook door ons afgekeurd | ${comparison.bothFailed.length} (${percent(comparison.recall)}) |`,
    `| Daarvan door ons niet beslist | ${comparison.missed.filter((entry) => entry.ours === "cantTell" || entry.ours === "untested").length} (${percent(comparison.undecidedRate)}) |`,
    `| Daarvan door ons goedgekeurd of niet van toepassing verklaard | ${comparison.missed.filter((entry) => entry.ours === "passed" || entry.ours === "inapplicable").length} (${percent(comparison.falsePassRate)}) |`,
    `| Alleen door ons afgekeurd | ${comparison.onlyOurs.length} |`,
    "",
    "## Door beide afgekeurd",
    "",
    ...(comparison.bothFailed.length ? comparison.bothFailed.map((id) => `- ${title(id)}`) : ["Geen."]),
    "",
    "## Afgekeurd in het bestaande onderzoek, bij ons een andere uitkomst",
    "",
    ...(comparison.missed.length ? comparison.missed.map((entry) => `- ${title(entry.id)}: ${OUTCOME_LABEL[entry.ours]}`) : ["Geen."]),
    "",
    "## Alleen door ons afgekeurd",
    "",
    "Elk van deze moet worden nagegaan: een valse melding, of een fout die het bestaande onderzoek miste of die er later bij kwam.",
    "",
    ...(comparison.onlyOurs.length ? comparison.onlyOurs.map((id) => `- ${title(id)}`) : ["Geen."]),
    "",
    "## Door geen van beide afgekeurd",
    "",
    ...Object.entries(comparison.neitherFailed).sort(([a], [b]) => a.localeCompare(b)).map(([outcome, count]) => `- ${OUTCOME_LABEL[outcome as CriterionOutcome]}: ${count}`),
    "",
  ];
  return lines.join("\n");
}

export async function compareRun(runDir: string, referencePath: string, outDir: string): Promise<Comparison> {
  const evaluation = await readJson<Evaluation>(join(runDir, "evaluation.json"));
  const reference = await readJson<ReferenceAudit>(referencePath);
  const comparison = compare(evaluation, reference);
  await writeJson(join(outDir, "vergelijking.json"), comparison);
  await writeFileAtomic(join(outDir, "vergelijking.md"), comparisonMarkdown(comparison, evaluation, reference));
  return comparison;
}
