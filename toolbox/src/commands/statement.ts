import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readJson, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { loadDecisions } from "../lib/decisions.ts";
import { evaluationHash } from "../lib/evaluation.ts";
import { answerSheetDocument, LEGAL_VERSION, renderAnswerSheet, renderStatement, statementDocument, type StatementDocument, type StatementInput } from "../lib/statement.ts";
import { makePdf, type PdfResult } from "../lib/typst.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";

export const STATEMENT_INPUT_FILE = "verklaring-invoer.json";

export interface StatementFiles {
  files: string[];
  status: string;
  openItems: string[];
  /** The statement as PDF, or null when it could not be made. */
  pdf: string | null;
  /** Problems found while making or checking the PDFs; empty when every check passed. */
  pdfChecks: string[];
  /** What the reader should know but does not stop the statement, such as text of the site set as code points. */
  pdfWarnings: string[];
  /** For status B: which deviations have no measure with a date; null when none is missing. */
  missingMeasuresNl: string | null;
}

/** The PDF of a document model, in the identity of the report and under the same checks. */
async function documentPdf(document: StatementDocument, output: string, date: string): Promise<PdfResult> {
  // The model only has to live as long as the compilation that reads it.
  const scratch = await mkdtemp(join(tmpdir(), "loep-"));
  try {
    const model = join(scratch, "document.json");
    await writeJson(model, document);
    return await makePdf({ template: "verklaring.typ", output: resolve(output), inputs: { document: model }, title: document.title, date });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Write the accessibility statement, the answer sheet for the register and a
 * machine-readable version. A statement that is not a concept needs a signature
 * that belongs to exactly this evaluation. The measures come from what the organisation
 * decided per defect (`decide`), and from `measuresNl` for a run without decisions.
 */
export async function statement(runDir: string, concept: boolean): Promise<StatementFiles> {
  const evaluation = await readEvaluation(join(runDir, "evaluation.json"));
  if (!concept && !signatureIsCurrent(evaluation)) {
    throw new Error("the evaluation is not signed, or it changed after signing; sign it first, or pass --concept to write a draft");
  }
  const inputPath = join(runDir, STATEMENT_INPUT_FILE);
  const input: StatementInput = existsSync(inputPath) ? await readJson<StatementInput>(inputPath) : { organisation: evaluation.site.organisation ?? "[nog invullen: naam van de overheidsinstantie]" };
  const { decisions } = await loadDecisions(runDir, evaluation.defects);
  const result = renderStatement(evaluation, input, { concept, decisions });
  const dir = join(runDir, "verklaring");
  const files = [join(dir, "verklaring.md"), join(dir, "invulassistent.md"), join(dir, "verklaring.json")];
  await writeFileAtomic(files[0]!, result.markdown);
  await writeFileAtomic(files[1]!, renderAnswerSheet(evaluation, input, decisions));
  await writeJson(files[2]!, {
    schema: "loep/verklaring/1",
    concept,
    model: "Besluit modeltoegankelijkheidsverklaring digitale toegankelijkheid overheid (Stcrt. 2026, 515)",
    site: evaluation.site,
    status: result.status,
    standard: { legal: `WCAG ${LEGAL_VERSION} niveau A en AA`, en301549: evaluation.standards.en301549 },
    evaluation: { sha256: evaluationHash(evaluation), evaluatedAt: evaluation.evaluatedAt, type: "automatisch onderzoek", performedBy: "in eigen beheer", method: `${evaluation.method.name} ${evaluation.method.version}`, reportUrl: input.reportUrl ?? null },
    notMet: evaluation.criteria.filter((criterion) => criterion.outcome === "failed").map((criterion) => ({ id: criterion.id, titleNl: criterion.titleNl, wcag: criterion.versions, en301549: criterion.en301549 })),
    notDetermined: evaluation.criteria.filter((criterion) => criterion.outcome === "cantTell").map((criterion) => ({ id: criterion.id, titleNl: criterion.titleNl, wcag: criterion.versions })),
    openItems: result.openItems,
    signature: evaluation.signature,
  });

  // Same content as the Markdown, from the same block model; the evaluation's date keeps the PDF reproducible.
  const pdf = await documentPdf(statementDocument(evaluation, input, { concept, decisions }), join(dir, "verklaring.pdf"), evaluation.evaluatedAt);
  const sheet = await documentPdf(answerSheetDocument(evaluation, input, decisions), join(dir, "invulassistent.pdf"), evaluation.evaluatedAt);
  if (pdf.pdf) files.push(join(dir, "verklaring.pdf"));
  if (sheet.pdf) files.push(join(dir, "invulassistent.pdf"));
  // Without Typst both report the same thing; say it once.
  const sheetChecks = sheet.pdfChecks.filter((problem) => !pdf.pdfChecks.includes(problem)).map((problem) => `invulassistent.pdf: ${problem}`);
  return { files, status: result.status, openItems: result.openItems, pdf: pdf.pdf ? join(dir, "verklaring.pdf") : null, pdfChecks: [...pdf.pdfChecks, ...sheetChecks], pdfWarnings: [...new Set([...pdf.pdfWarnings, ...sheet.pdfWarnings])], missingMeasuresNl: result.missingMeasuresNl };
}
