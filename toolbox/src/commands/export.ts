import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Defect } from "../lib/defects.ts";
import { evaluationHash, type Evaluation, type ReportFinding } from "../lib/evaluation.ts";
import { groupLabelNl } from "../lib/groups.ts";
import { pageLabels, sortDefects } from "../lib/report-markdown.ts";
import { CONSEQUENCE_NL, TASK_ALL } from "../lib/weighing.ts";
import { compareCriterionIds } from "../lib/wcag.ts";
import { readEvaluation } from "./sign.ts";

/**
 * The work list of an evaluation in a form another tool reads: a CSV file for a spreadsheet,
 * or one Markdown block per line for an issue tracker. Each line is a defect: findings about
 * the same place with the same cause, under every criterion they break. Nothing is sent: the
 * blocks are written for `gh issue create`, and whoever runs that decides what goes out.
 */

/** For a defect that was weighed and hinders no group: it stays a defect. */
const NO_GROUP_NL = "Uit de bevindingen blijkt geen gevolg voor een groep bezoekers. Het blijft een afwijking van de norm.";

const upperFirst = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const EXPORT_FORMATS = ["csv", "issues"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** One line of the work list, with what whoever repairs it needs. */
export interface WorkLine {
  id: string;
  titleNl: string;
  severity: ReportFinding["severity"];
  owner: string;
  mainCriterion: string;
  /** The main criterion first, then the others in WCAG order. */
  criteria: string[];
  pages: string[];
  morePages: boolean;
  component: string | null;
  element: string | null;
  main: ReportFinding;
  findings: ReportFinding[];
  /** Who the defect hinders, a sentence per group with the worst that happens to it; without a weighing, what the judge of the main finding wrote. */
  impactNl: string;
  /** The hindered groups with what happens to each, in a few words; empty without a weighing and when no group is hindered. */
  groupsNl: string;
  /** The core task visitors need the part for, "elke kerntaak", or empty. */
  taskNl: string;
}

/** The lines of the work list, heaviest first as in the report. An evaluation from before defects existed gives a line per finding. */
export function workLines(evaluation: Evaluation): WorkLine[] {
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const defects: Defect[] =
    evaluation.defects ??
    findings.map((finding) => ({ id: finding.id, titleNl: finding.titleNl, mainCriterion: finding.criterion, mainFindingId: finding.id, alsoCriteria: [], findingIds: [finding.id], pages: [...new Set(finding.locations.map((location) => location.page))], morePages: false, component: finding.component, element: null, severity: finding.severity, owner: finding.owner, mergedBy: [], mainReasonNl: null }));
  const labels = pageLabels(evaluation);
  const tasks = evaluation.weighing?.tasks ?? [];
  const closed = (text: string): string => text.trim().replace(/([^.!?])$/, "$1.");
  return sortDefects(defects).map((defect) => ({
    impactNl: !defect.weighing
      ? byId.get(defect.mainFindingId)!.impactNl
      : defect.weighing.affected.length > 0
        ? defect.weighing.affected.map((entry) => `${upperFirst(groupLabelNl(entry.group))} (${CONSEQUENCE_NL[entry.consequence]}): ${closed(entry.howNl)} ${closed(entry.whatNl)}`).join(" ")
        : NO_GROUP_NL,
    groupsNl: (defect.weighing?.affected ?? []).map((entry) => `${groupLabelNl(entry.group)} (${CONSEQUENCE_NL[entry.consequence]})`).join("; "),
    taskNl: !defect.weighing || defect.weighing.task === null ? "" : defect.weighing.task === TASK_ALL ? "elke kerntaak" : (tasks.find((task) => task.id === defect.weighing!.task)?.nameNl ?? defect.weighing.task),
    id: defect.id,
    titleNl: defect.titleNl,
    severity: defect.severity,
    owner: defect.owner,
    mainCriterion: defect.mainCriterion,
    criteria: [defect.mainCriterion, ...defect.alsoCriteria.filter((id) => id !== defect.mainCriterion).sort(compareCriterionIds)],
    pages: labels.filter((label) => defect.pages.includes(label)).concat(defect.pages.filter((page) => !labels.includes(page))),
    morePages: defect.morePages,
    component: defect.component,
    element: defect.element,
    main: byId.get(defect.mainFindingId)!,
    findings: defect.findingIds.map((id) => byId.get(id)!),
  }));
}

const CSV_HEADER = ["gebrek", "titel", "ernst", "eigenaar", "hoofdcriterium", "criteria", "paginas", "onderdeel", "element", "wat_is_er_mis", "wie_heeft_er_last_van", "oplossing", "bevindingen", "groepen", "kerntaak"];

/** A field as RFC 4180 writes it: in double quotes when it holds a comma, a quote or a line break, with a quote doubled. */
const csvField = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The work list as CSV: a header and one row per line, separated by commas, in UTF-8. */
export function workListCsv(evaluation: Evaluation): string {
  const rows = workLines(evaluation).map((line) => [
    line.id,
    line.titleNl,
    line.severity,
    line.owner,
    line.mainCriterion,
    line.criteria.join(" "),
    `${line.pages.join(" ")}${line.morePages ? " e.a." : ""}`,
    line.component ?? "",
    line.element ?? "",
    line.main.observedNl,
    line.impactNl,
    line.main.fixNl,
    line.findings.map((finding) => finding.id).join(" "),
    line.groupsNl,
    line.taskNl,
  ]);
  return `${[CSV_HEADER, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export interface IssueBlock {
  id: string;
  title: string;
  body: string;
}

/** Per line of the work list a title and a body in Markdown, for an issue tracker. */
export function workListIssues(evaluation: Evaluation): IssueBlock[] {
  const labels = pageLabels(evaluation);
  const urlOf = new Map(labels.map((label, index) => [label, evaluation.sample.items[index]?.url ?? ""]));
  const hash = evaluationHash(evaluation).slice(0, 12);
  return workLines(evaluation).map((line) => {
    const others = line.criteria.slice(1);
    const body = [
      `- Gebrek: ${line.id}`,
      `- Ernst: ${line.severity}`,
      `- Eigenaar: ${line.owner}`,
      `- WCAG-succescriteria: ${line.mainCriterion} (hoofdcriterium)${others.length > 0 ? `, raakt ook ${others.join(", ")}` : ""}`,
      `- Pagina's: ${line.pages.join(", ")}${line.morePages ? " en meer" : ""}`,
      ...(line.taskNl ? [`- Kerntaak: ${line.taskNl}`] : []),
      ...(line.component ? [`- Onderdeel: ${line.component}`] : []),
      ...(line.element ? [`- Element: \`${line.element.replace(/`/g, "'")}\``] : []),
      "",
      "## Wat is er mis",
      "",
      line.main.observedNl,
      "",
      "## Wie heeft er last van",
      "",
      line.impactNl,
      "",
      "## Oplossing",
      "",
      line.main.fixNl,
      "",
      "## Waar",
      "",
      ...line.findings.flatMap((finding) => finding.locations.map((location) => `- ${location.page}${urlOf.get(location.page) ? ` (${urlOf.get(location.page)})` : ""}: ${location.where}`)).filter((entry, index, all) => all.indexOf(entry) === index),
      "",
      "## Bevindingen",
      "",
      ...line.findings.map((finding) => `- ${finding.id} onder ${finding.criterion}: ${finding.titleNl}`),
      "",
      `Uit het toegankelijkheidsonderzoek van ${evaluation.site.name}, evaluatie ${hash}. De bevindingen staan met hun onderbouwing in het rapport.`,
      "",
    ].join("\n");
    return { id: line.id, title: line.titleNl, body };
  });
}

/** The blocks after each other, each opened by a comment with the defect and a heading with its title. */
export const issuesMarkdown = (blocks: IssueBlock[]): string => blocks.map((block) => `<!-- ${block.id} -->\n# ${block.title}\n\n${block.body}`).join("\n");

export interface ExportResult {
  format: ExportFormat;
  lines: number;
  /** The files written; empty when the export went to standard output. */
  written: string[];
  /** The text, when no --out was given. */
  text: string | null;
}

/**
 * Write the work list of a run. CSV goes to the file `out`; issues go to the directory `out`,
 * one file per line whose first line is the title and the rest the body. Without `out` the text
 * goes to standard output. Nothing is written into the run: a file added there would no longer
 * match its seal.
 */
export async function exportWorkList(options: { run: string; format: string | undefined; out?: string }): Promise<ExportResult> {
  if (!EXPORT_FORMATS.includes(options.format as ExportFormat)) throw new Error(`export verwacht --format ${EXPORT_FORMATS.join(" of ")}`);
  const format = options.format as ExportFormat;
  const evaluation = await readEvaluation(resolve(options.run, "evaluation.json"));
  if (format === "csv") {
    const text = workListCsv(evaluation);
    const lines = workLines(evaluation).length;
    if (!options.out) return { format, lines, written: [], text };
    await writeFile(options.out, text);
    return { format, lines, written: [options.out], text: null };
  }
  const blocks = workListIssues(evaluation);
  if (!options.out) return { format, lines: blocks.length, written: [], text: issuesMarkdown(blocks) };
  await mkdir(options.out, { recursive: true });
  const written: string[] = [];
  for (const block of blocks) {
    const path = join(options.out, `${block.id}.md`);
    await writeFile(path, `# ${block.title}\n\n${block.body}`);
    written.push(path);
  }
  return { format, lines: blocks.length, written, text: null };
}
