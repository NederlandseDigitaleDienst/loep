import { join } from "node:path";
import { writeFileAtomic } from "../lib/canonical.ts";
import { compareEvaluations, type Difference, type DifferenceItem, type DifferenceSide, type Examined } from "../lib/difference.ts";
import { OUTCOME_LABEL, type Evaluation } from "../lib/evaluation.ts";
import { dateNl, esc, OUTCOME_SYMBOL } from "../lib/report-markdown.ts";
import { readEvaluation } from "./sign.ts";

const NEW_HEADING: Record<Examined, string> = {
  notExamined: "De plek is toen niet onderzocht: nu voor het eerst gevonden",
  examined: "De plek is toen ook onderzocht: toen gemist of sindsdien ontstaan",
  unknown: "Niet te bepalen of de plek toen is onderzocht",
};
const GONE_HEADING: Record<Examined, string> = {
  examined: "De plek is nu opnieuw onderzocht en het gebrek is niet meer gevonden",
  notExamined: "De plek is nu niet onderzocht: niet meer gevonden, maar ook niet nagegaan",
  unknown: "Niet te bepalen of de plek nu opnieuw is onderzocht",
};
const NEW_SHORT: Record<Examined, string> = { examined: "op een plek die toen ook is onderzocht", notExamined: "op een plek die toen niet is onderzocht", unknown: "waarbij dat niet te bepalen is" };

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The difference as a working document in Markdown. It says at the top what it is and what it is not. */
export function renderDifference(difference: Difference): string {
  const { previous, current } = difference;
  const signedNl = (side: DifferenceSide): string => (side.signed ? `ja, op ${dateNl(side.signedAt!)}` : "nee, concept");
  const line = (item: DifferenceItem, extra: string[] = []): string =>
    `- \`${item.id}\` ${esc(item.titleNl)} (${[item.criterion, `ernst ${item.severity}`, ...(item.defectId ? [`gebrek \`${item.defectId}\``] : []), item.pages.join(", "), ...extra].join(", ")})`;
  const grouped = (items: DifferenceItem[], headings: Record<Examined, string>, order: Examined[]): string[] =>
    order.flatMap((kind) => {
      const group = items.filter((item) => item.examined === kind);
      // Why the place counts as examined or not differs per finding only in a few words, so it stands once per reason.
      const reasons = [...new Set(group.map((item) => item.examinedNl!))];
      return group.length === 0 ? [] : [`### ${headings[kind]} (${group.length})`, "", ...reasons.flatMap((reason) => [`${reason.charAt(0).toUpperCase()}${reason.slice(1)}:`, "", ...group.filter((item) => item.examinedNl === reason).map((item) => line(item)), ""])];
    });
  const defects = (count: number | null): string => (count === null ? "niet te tellen" : String(count));
  const freshKinds = (["notExamined", "examined", "unknown"] as const).map((kind) => [kind, difference.fresh.filter((item) => item.examined === kind).length] as const).filter(([, count]) => count > 0);
  const lines = [
    `# Verschil tussen twee onderzoeken: ${esc(difference.site.name)}`,
    "",
    "> **Werkdocument, geen onderdeel van het rapport.** Dit overzicht is voor wie aan de site werkt. Het legt twee evaluaties naast elkaar en is zelf niet afgetekend. Of de site voldoet, staat in het rapport van het nieuwe onderzoek, niet hier.",
    "",
    `Website: <${difference.site.baseUrl}>`,
    "",
    "| | Vorige evaluatie | Nieuwe evaluatie |",
    "| --- | --- | --- |",
    `| Datum van het onderzoek | ${dateNl(previous.evaluatedAt)} | ${dateNl(current.evaluatedAt)} |`,
    `| Kenmerk (hash) | \`${previous.sha256.slice(0, 12)}\` | \`${current.sha256.slice(0, 12)}\` |`,
    `| Gemaakt met | ${esc(previous.madeWithNl)} | ${esc(current.madeWithNl)} |`,
    `| Afgetekend | ${signedNl(previous)} | ${signedNl(current)} |`,
    `| Onderzochte pagina's | ${previous.pages} | ${current.pages} |`,
    `| Bevindingen | ${previous.findings} | ${current.findings} |`,
    `| Gebreken | ${previous.defects ?? "geen (bestond nog niet)"} | ${current.defects ?? "geen (bestond nog niet)"} |`,
    "",
    "## In het kort",
    "",
    "| | Bevindingen | Gebreken |",
    "| --- | ---: | ---: |",
    `| Opgelost: toen gevonden, nu niet meer | ${difference.resolved.length} | ${defects(difference.defects.resolved)} |`,
    `| Gebleven: toen en nu gevonden | ${difference.remained.length} | ${defects(difference.defects.remained)} |`,
    `| Nieuw: nu gevonden, toen niet | ${difference.fresh.length} | ${defects(difference.defects.fresh)} |`,
    "",
    ...(freshKinds.length > 0 ? [`Van de ${plural(difference.fresh.length, "nieuwe bevinding", "nieuwe bevindingen")}: ${freshKinds.map(([kind, count]) => `${count} ${NEW_SHORT[kind]}`).join(", ")}.`, ""] : []),
    `${plural(difference.outcomes.length, "criterium heeft", "criteria hebben")} een andere uitkomst dan toen.`,
    "",
    "## Criteria met een andere uitkomst",
    "",
    ...(difference.outcomes.length === 0
      ? ["Geen.", ""]
      : ["| Criterium | Toen | Nu |", "| --- | --- | --- |", ...difference.outcomes.map((row) => `| ${row.criterion} ${esc(row.titleNl)} | ${OUTCOME_SYMBOL[row.before]} ${OUTCOME_LABEL[row.before]} | ${OUTCOME_SYMBOL[row.after]} ${OUTCOME_LABEL[row.after]} |`), ""]),
    `## Opgelost (${difference.resolved.length})`,
    "",
    ...(difference.resolved.length === 0 ? ["Geen.", ""] : ["De kenmerken en paginanummers zijn die van de vorige evaluatie.", "", ...grouped(difference.resolved, GONE_HEADING, ["examined", "notExamined", "unknown"])]),
    `## Gebleven (${difference.remained.length})`,
    "",
    ...(difference.remained.length === 0 ? ["Geen.", ""] : [...difference.remained.map((item) => line(item, item.previousId && item.previousId !== item.id ? [`toen \`${item.previousId}\``] : [])), ""]),
    `## Nieuw (${difference.fresh.length})`,
    "",
    ...(difference.fresh.length === 0 ? ["Geen.", ""] : grouped(difference.fresh, NEW_HEADING, ["notExamined", "examined", "unknown"])),
    "## Steekproef",
    "",
    difference.pagesOnlyThen.length + difference.pagesOnlyNow.length === 0 ? "Beide evaluaties onderzochten dezelfde pagina's." : "De twee evaluaties onderzochten niet precies dezelfde pagina's.",
    "",
    ...(difference.pagesOnlyThen.length > 0 ? [`Alleen toen onderzocht (${difference.pagesOnlyThen.length}):`, "", ...difference.pagesOnlyThen.map((url) => `- <${url}>`), ""] : []),
    ...(difference.pagesOnlyNow.length > 0 ? [`Alleen nu onderzocht (${difference.pagesOnlyNow.length}):`, "", ...difference.pagesOnlyNow.map((url) => `- <${url}>`), ""] : []),
    "## Wat dit overzicht niet kan zeggen",
    "",
    ...difference.limitsNl.map((limit) => `- ${limit}`),
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export interface DiffResult {
  difference: Difference;
  markdown: string;
}

/** Lay two evaluations of the same site side by side and write the difference as `verschil.md`. */
export async function diff(previousPath: string, currentPath: string, outDir: string): Promise<DiffResult> {
  const [previous, current] = [await readEvaluation(previousPath), await readEvaluation(currentPath)];
  const origin = (evaluation: Evaluation): string => new URL(evaluation.site.baseUrl).origin;
  if (origin(previous) !== origin(current)) throw new Error(`de twee evaluaties gaan over een andere site (${origin(previous)} en ${origin(current)}); een verschil is alleen te maken tussen twee onderzoeken van dezelfde site`);
  const difference = compareEvaluations(previous, current);
  const markdown = join(outDir, "verschil.md");
  await writeFileAtomic(markdown, renderDifference(difference));
  return { difference, markdown };
}
