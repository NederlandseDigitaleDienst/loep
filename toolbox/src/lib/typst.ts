import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Making a PDF with Typst and checking that it is accessible. The report and the
 * accessibility statement both go through here, so they meet the same requirements.
 */

const run = promisify(execFile);

export const TEMPLATES = fileURLToPath(new URL("../../../templates", import.meta.url));
const FONTS = join(TEMPLATES, "fonts");

interface CommandResult {
  found: boolean;
  ok: boolean;
  stdout: string;
  /** Standard output and standard error together, for messages. */
  output: string;
}

/** Run an external tool without a shell; a missing tool is an answer, not an error. */
export async function tool(command: string, args: string[], timeoutMs = 0): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await run(command, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return { found: true, ok: true, stdout, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (failure.code === "ENOENT") return { found: false, ok: false, stdout: "", output: "" };
    return { found: true, ok: false, stdout: failure.stdout ?? "", output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` || String(failure.message) };
  }
}

/**
 * What can be read from the PDF without a validator: tagged, titled, in Dutch, with
 * bookmarks. It is the floor under the PDF/UA validation, and all there is without veraPDF.
 */
async function basicChecks(pdf: string, expectedTitle: string): Promise<string[]> {
  const info = await tool("pdfinfo", [pdf]);
  if (!info.found) return ["pdfinfo (poppler) is niet geïnstalleerd: titel, tags en taal van de PDF zijn niet gecontroleerd."];
  if (!info.ok) return [`pdfinfo kon de PDF niet lezen: ${info.output.trim()}`];
  const field = (name: string): string => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(info.output)?.[1]?.trim() ?? "";
  const problems: string[] = [];
  if (field("Tagged") !== "yes") problems.push("De PDF is niet getagd.");
  if (field("Title") !== expectedTitle) problems.push(`De titel van de PDF is "${field("Title")}", verwacht was "${expectedTitle}".`);

  // Typst leaves the catalog uncompressed, so language and outline can be read from the bytes.
  const bytes = await readFile(pdf, "latin1");
  const language = /\/Lang\s*\((nl[^)]*)\)/.exec(bytes)?.[1];
  if (!language) problems.push("De documenttaal van de PDF is niet Nederlands (nl).");
  if (!/\/Outlines\s/.test(bytes)) problems.push("De PDF heeft geen bladwijzers.");
  return problems;
}

interface VeraPdfReport {
  report?: {
    jobs?: {
      validationResult?: {
        compliant?: boolean;
        details?: { ruleSummaries?: { clause: string; testNumber: number; description: string; failedChecks: number }[] };
      }[];
    }[];
  };
}

export interface PdfUaResult {
  /** False when veraPDF is not installed or gave no readable result; `reasonNl` then says which. */
  available: boolean;
  compliant: boolean | null;
  reasonNl: string | null;
  failedRules: { clause: string; test: number; description: string; failedChecks: number }[];
}

/** PDF/UA-1 validation with veraPDF: whether the file complies, and every rule it fails with the number of times. */
export async function pdfUa(pdf: string, timeoutMs = 0): Promise<PdfUaResult> {
  // veraPDF exits non-zero on a failed validation; the report on stdout is what counts.
  const result = await tool("verapdf", ["--flavour", "ua1", "--format", "json", pdf], timeoutMs);
  if (!result.found) return { available: false, compliant: null, reasonNl: "veraPDF is niet geïnstalleerd: de volledige PDF/UA-validatie is niet uitgevoerd.", failedRules: [] };
  let validation;
  try {
    validation = (JSON.parse(result.stdout) as VeraPdfReport).report?.jobs?.[0]?.validationResult?.[0];
  } catch {
    validation = undefined;
  }
  if (!validation || typeof validation.compliant !== "boolean") return { available: false, compliant: null, reasonNl: `veraPDF gaf geen leesbare uitslag: ${result.output.trim().slice(0, 300)}`, failedRules: [] };
  return { available: true, compliant: validation.compliant, reasonNl: null, failedRules: (validation.details?.ruleSummaries ?? []).map((rule) => ({ clause: rule.clause, test: rule.testNumber, description: rule.description, failedChecks: rule.failedChecks })) };
}

/** PDF/UA-1 validation of a PDF the toolbox made itself; each failed rule becomes one problem. */
async function validatePdfUa(pdf: string): Promise<string[]> {
  const result = await pdfUa(pdf);
  if (!result.available) return [result.reasonNl!];
  if (result.compliant) return [];
  if (result.failedRules.length === 0) return ["veraPDF PDF/UA-1: de PDF voldoet niet, zonder opgave van een regel."];
  return result.failedRules.map((rule) => `veraPDF PDF/UA-1, clausule ${rule.clause} test ${rule.test} (${rule.failedChecks} keer): ${rule.description}`);
}

export interface PdfRequest {
  /** File name of the template under templates/. */
  template: string;
  output: string;
  /** Values the template reads from `sys.inputs`; file paths must be absolute. */
  inputs: Record<string, string>;
  /** The document title the PDF must carry. */
  title: string;
  /** ISO date for the PDF's creation date, so the same input gives the same PDF. */
  date: string;
}

export interface PdfResult {
  pdf: string | null;
  /** Problems found while making or checking the PDF; empty when every check passed. */
  pdfChecks: string[];
}

/**
 * The texts Typst could not set in any font it has, from its error output. PDF/UA-1 allows no
 * text without a glyph, and the bundled fonts cannot cover every script a site may quote.
 * Typst writes each text as a Rust string literal.
 */
export function unshownTexts(output: string): string[] {
  const texts = [...output.matchAll(/the text `"((?:[^"\\]|\\.)*)"` could not be displayed/g)].map((match) =>
    match[1]!.replace(/\\u\{([0-9a-fA-F]+)\}|\\(.)/g, (_, hex: string | undefined, escaped: string) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[escaped] ?? escaped,
    ),
  );
  return [...new Set(texts)];
}

/** A pattern for Typst's `regex` that matches a run of these texts, trying the longest first. */
export function unshownPattern(texts: string[]): string {
  const alternatives = [...texts]
    .sort((a, b) => b.length - a.length)
    .map((text) => [...text].map((character) => `\\x{${character.codePointAt(0)!.toString(16)}}`).join(""));
  return `(?:${alternatives.join("|")})+`;
}

/**
 * Compile a template to a tagged PDF/UA-1 file and check the result. A text no bundled font
 * can show is set as its code points on a second attempt, so a quote from a site never stops
 * the PDF. Without Typst there is no PDF, and the reason is returned as a problem instead of thrown.
 */
export async function makePdf(request: PdfRequest): Promise<PdfResult> {
  const typst = await tool("typst", ["--version"]);
  if (!typst.found) return { pdf: null, pdfChecks: ["Typst is niet geïnstalleerd: er is geen PDF gemaakt. Installeer Typst en draai dit commando opnieuw."] };

  const temporary = `${request.output}.tmp`;
  const compile = (inputs: Record<string, string>): Promise<CommandResult> => tool("typst", [
    "compile",
    // Templates read their data by absolute path, wherever the run lives.
    "--root",
    "/",
    "--font-path",
    FONTS,
    "--ignore-system-fonts",
    "--format",
    "pdf",
    "--pdf-standard",
    "ua-1",
    "--creation-timestamp",
    String(Math.floor(new Date(request.date).getTime() / 1000)),
    ...Object.entries(inputs).flatMap(([name, value]) => ["--input", `${name}=${value}`]),
    join(TEMPLATES, request.template),
    temporary,
  ]);
  let compiled = await compile(request.inputs);
  const unshown = unshownTexts(compiled.output);
  if (!compiled.ok && unshown.length > 0) compiled = await compile({ ...request.inputs, unshown: unshownPattern(unshown) });
  if (!compiled.ok || !existsSync(temporary)) {
    await rm(temporary, { force: true });
    return { pdf: null, pdfChecks: [`Typst kon de PDF niet maken: ${compiled.output.trim()}`] };
  }
  await rename(temporary, request.output);
  return { pdf: request.output, pdfChecks: [...(await basicChecks(request.output, request.title)), ...(await validatePdfUa(request.output))] };
}
