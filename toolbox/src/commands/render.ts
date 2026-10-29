import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeFileAtomic } from "../lib/canonical.ts";
import { writeCutouts } from "../lib/cutout.ts";
import { loadDecisions } from "../lib/decisions.ts";
import { deriveReport, renderMarkdown, REPORT_TEXT } from "../lib/report-markdown.ts";
import { makePdf } from "../lib/typst.ts";
import { loadRechecks } from "./recheck.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";
import { SIGNED_DIR } from "./verify.ts";

export interface RenderResult {
  markdown: string;
  /** The full report. */
  pdf: string | null;
  /** The same report without appendix A, which is most of its pages; null when no PDF could be made. */
  shortPdf: string | null;
  /** Problems found while making or checking the PDFs; empty when every check passed. */
  pdfChecks: string[];
  /** What the reader should know but does not stop the report, such as text of the site set as code points. */
  pdfWarnings: string[];
  /** Cutouts that were left out: their picture changed, or the pieces of the report reached their limit. The report is still whole. */
  cutoutNotes: string[];
}

/** The directory, next to the report, with a piece of a screenshot for each finding that has one. */
export const CUTOUT_DIR = "uitsneden";

/**
 * Write the report for a run: Markdown always, and a PDF when Typst is available.
 * All come from evaluation.json and nothing else, so none is edited by hand; the pieces of
 * screenshots at the findings are cut from the pictures of the run that the evaluation names,
 * by path and sha256.
 * The PDF is made twice: in full, and without appendix A for a reader who wants the work
 * list and the results. Both carry the mark of the same evaluation.
 *
 * The concept goes to `report/` and is sealed with the rest of the run: it is what the signer
 * reads. Once the run is signed, the report that names the signer goes to `signed/`, outside
 * the seal, so that making it changes nothing that was signed. That report also has the chapter
 * with what the organisation decided per defect (`decide`): the decisions stand outside the seal
 * too, so `render` can make it again after every decision without touching the evaluation.
 */
export async function render(runDir: string): Promise<RenderResult> {
  const source = resolve(runDir, "evaluation.json");
  const evaluation = await readEvaluation(source);
  const signed = signatureIsCurrent(evaluation);
  const dir = join(runDir, signed ? SIGNED_DIR : "report");
  const decisions = signed ? { ...(await loadDecisions(runDir, evaluation.defects)), rechecks: loadRechecks(runDir) } : { decisions: [], sha256: null };
  const markdown = join(dir, "rapport.md");
  // The pieces are made anew every time, from the pictures the evaluation names.
  await rm(join(dir, CUTOUT_DIR), { recursive: true, force: true });
  const cutouts = await writeCutouts(runDir, evaluation, join(dir, CUTOUT_DIR));
  const pictures = Object.fromEntries(Object.entries(cutouts.files).map(([id, file]) => [id, { file: `${CUTOUT_DIR}/${file.file}`, altNl: file.altNl }]));
  await writeFileAtomic(markdown, renderMarkdown(evaluation, decisions, pictures));

  const title = `${REPORT_TEXT.title} ${evaluation.site.name}`;
  const request = {
    template: "rapport.typ",
    inputs: { evaluation: source, derived: JSON.stringify({ ...deriveReport(evaluation, decisions), cutouts: Object.fromEntries(Object.entries(cutouts.files).map(([id, file]) => [id, { path: file.absolute, width: file.width, altNl: file.altNl }])) }) },
    // The evaluation's own date, so the same evaluation gives the same PDF.
    date: evaluation.evaluatedAt,
  };
  const full = await makePdf({ ...request, output: join(dir, "rapport.pdf"), title });
  // Without Typst there is one message about that, not two.
  if (full.pdf === null) return { markdown, pdf: null, shortPdf: null, pdfChecks: full.pdfChecks, pdfWarnings: [], cutoutNotes: cutouts.problems };
  const short = await makePdf({ ...request, inputs: { ...request.inputs, part: "short" }, output: join(dir, "rapport-kort.pdf"), title: `${title}, ${REPORT_TEXT.shortVersion}` });
  return {
    markdown,
    pdf: full.pdf,
    shortPdf: short.pdf,
    pdfChecks: [...full.pdfChecks, ...short.pdfChecks.map((problem) => `Korte versie: ${problem}`)],
    // The short report quotes the same site; a text set as code points is named once.
    pdfWarnings: [...new Set([...full.pdfWarnings, ...short.pdfWarnings])],
    cutoutNotes: cutouts.problems,
  };
}
