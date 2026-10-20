import { join, resolve } from "node:path";
import { writeFileAtomic } from "../lib/canonical.ts";
import { loadDecisions } from "../lib/decisions.ts";
import { deriveReport, renderMarkdown, REPORT_TEXT } from "../lib/report-markdown.ts";
import { makePdf } from "../lib/typst.ts";
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
}

/**
 * Write the report for a run: Markdown always, and a PDF when Typst is available.
 * All come from evaluation.json and nothing else, so none is edited by hand.
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
  const decisions = signed ? await loadDecisions(runDir, evaluation.defects) : { decisions: [], sha256: null };
  const markdown = join(dir, "rapport.md");
  await writeFileAtomic(markdown, renderMarkdown(evaluation, decisions));

  const title = `${REPORT_TEXT.title} ${evaluation.site.name}`;
  const request = {
    template: "rapport.typ",
    inputs: { evaluation: source, derived: JSON.stringify(deriveReport(evaluation, decisions)) },
    // The evaluation's own date, so the same evaluation gives the same PDF.
    date: evaluation.evaluatedAt,
  };
  const full = await makePdf({ ...request, output: join(dir, "rapport.pdf"), title });
  // Without Typst there is one message about that, not two.
  if (full.pdf === null) return { markdown, pdf: null, shortPdf: null, pdfChecks: full.pdfChecks };
  const short = await makePdf({ ...request, inputs: { ...request.inputs, part: "short" }, output: join(dir, "rapport-kort.pdf"), title: `${title}, ${REPORT_TEXT.shortVersion}` });
  return { markdown, pdf: full.pdf, shortPdf: short.pdf, pdfChecks: [...full.pdfChecks, ...short.pdfChecks.map((problem) => `Korte versie: ${problem}`)] };
}
