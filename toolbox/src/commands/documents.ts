import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measurePdf, PREVIEW_PAGES, renderPage } from "../instruments/documents/pdf.ts";
import { readJson, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { documentDir, emptyFacts, NOT_READ_REASON_NL, originalPath, READ_KINDS, type DocumentFacts, type SampleDocument } from "../lib/documents.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { runBlockade } from "../session/blockade.ts";
import { guardedDownload, scopeForRun, type Guard, type Scope } from "../session/safety.ts";
import type { Sample } from "./sample.ts";

/** A document larger than this is not fetched; the reason is recorded. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_MS = 60_000;
/** Pause between two downloads from the same site. */
const POLITE_MS = 500;

/** Measure one file that is already on disk. `dir` is where its facts live, relative to the run. `contentType` is what the server said when it was fetched. */
export async function measureDocument(runDir: string, document: SampleDocument, file: string, bytes: number, contentType: string | null = null): Promise<DocumentFacts> {
  const dir = documentDir(document);
  const facts = emptyFacts(document.label, document.url, document.kind, "read", null);
  facts.bytes = bytes;
  facts.sha256 = await sha256File(file);
  const scratch = await mkdtemp(join(tmpdir(), "loep-document-"));
  try {
    if (document.kind === "pdf") {
      const measured = await measurePdf(file, scratch);
      Object.assign(facts, measured.facts);
      await writeFileAtomic(join(runDir, dir, "text.txt"), measured.text);
      facts.files.text = join(dir, "text.txt");
      if (measured.tagTree) {
        await writeFileAtomic(join(runDir, dir, "tags.txt"), measured.tagTree);
        facts.files.tagTree = join(dir, "tags.txt");
      }
      for (let page = 1; page <= Math.min(PREVIEW_PAGES, facts.pages ?? 0); page++) {
        const picture = await renderPage(file, page, join(runDir, dir, `page-${page}.png`));
        if (picture) facts.files.pageImages.push(join(dir, `page-${page}.png`));
      }
      if (facts.files.pageImages.length === 0 && (facts.pages ?? 0) > 0) facts.notMeasuredNl.push("pdftoppm (poppler) is niet geïnstalleerd of kon de pagina's niet tekenen: er is geen beeld van de eerste pagina's.");
    } else if (document.kind === "text") {
      const { measureText } = await import("../instruments/documents/text.ts");
      const measured = await measureText(file, document.url, contentType);
      Object.assign(facts, measured.facts);
      await writeFileAtomic(join(runDir, dir, "text.txt"), measured.text);
      facts.files.text = join(dir, "text.txt");
    } else {
      const { measureOffice } = await import("../instruments/documents/office.ts");
      const measured = await measureOffice(file, document.kind);
      Object.assign(facts, measured.facts);
      await writeFileAtomic(join(runDir, dir, "text.txt"), measured.text);
      facts.files.text = join(dir, "text.txt");
    }
  } catch (error) {
    facts.status = "failed";
    facts.reasonNl = ((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 300);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return facts;
}

async function fetchAndMeasure(runDir: string, document: SampleDocument, scope: Scope, guard: Guard): Promise<DocumentFacts> {
  const reason = NOT_READ_REASON_NL[document.kind];
  if (!READ_KINDS.includes(document.kind)) return emptyFacts(document.label, document.url, document.kind, "notRead", reason ?? "deze soort wordt niet ingelezen");
  if (document.bytes !== null && document.bytes > MAX_DOCUMENT_BYTES) return emptyFacts(document.label, document.url, document.kind, "failed", `het bestand is ${Math.round(document.bytes / 1024 / 1024)} MB; de grens is ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  await mkdir(join(runDir, documentDir(document)), { recursive: true });
  const file = join(runDir, originalPath(document));
  // A short pause the site asked for is waited out first; an origin that refused the evaluation is not asked.
  const blockade = runBlockade()?.blockade;
  await blockade?.pause(document.url);
  const fetched = await guardedDownload(scope, guard, document.url, file, { resourceType: "document", maxBytes: MAX_DOCUMENT_BYTES + 1, timeoutMs: DOWNLOAD_MS, blockade });
  if (!fetched.ok) return emptyFacts(document.label, document.url, document.kind, "failed", `niet op te halen: ${fetched.reason}`);
  if (fetched.truncated) {
    await rm(file, { force: true });
    return emptyFacts(document.label, document.url, document.kind, "failed", fetched.truncated === "size" ? `het bestand is groter dan ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB` : "het bestand kwam niet binnen de tijd binnen");
  }
  return measureDocument(runDir, document, file, fetched.bytes, fetched.contentType);
}

export interface DocumentsResult {
  documents: number;
  read: number;
  notRead: number;
  failed: number;
}

const DOCUMENT_TOOLS: { implementation: string; command: string; args: string[]; licence: string }[] = [
  { implementation: "poppler", command: "pdfinfo", args: ["-v"], licence: "GPL-2.0-or-later" },
  { implementation: "qpdf", command: "qpdf", args: ["--version"], licence: "Apache-2.0" },
  { implementation: "veraPDF", command: "verapdf", args: ["--version"], licence: "GPL-3.0-or-later of MPL-2.0" },
  { implementation: "tesseract", command: "tesseract", args: ["--version"], licence: "Apache-2.0" },
];

/** The programs the document measurements call, each with the version on this machine; null when it is not installed. */
export async function documentTools(): Promise<{ implementation: string; version: string | null; licence: string }[]> {
  const { execFile } = await import("node:child_process");
  const versionOf = (command: string, args: string[]): Promise<string | null> =>
    new Promise((resolve) => execFile(command, args, { timeout: 15_000 }, (error, stdout, stderr) => resolve(error && !stdout && !stderr ? null : (/\d+\.\d+(?:\.\d+)*/.exec(`${stdout}\n${stderr}`)?.[0] ?? null))));
  return Promise.all(DOCUMENT_TOOLS.map(async (tool) => ({ implementation: tool.implementation, version: await versionOf(tool.command, tool.args), licence: tool.licence })));
}

/**
 * Fetch and measure every document of the sample, without a language model. A run without
 * documents writes nothing but its line in the manifest.
 */
export async function documents(runDir: string): Promise<DocumentsResult> {
  const startedAt = stepStart();
  const sample = await readJson<Sample>(join(runDir, "sample.json"));
  const chosen = sample.documents ?? [];
  const result: DocumentsResult = { documents: chosen.length, read: 0, notRead: 0, failed: 0 };
  if (chosen.length > 0) {
    const scope = await scopeForRun(runDir, { strict: true });
    const guard: Guard = { blocked: [], outsideScopeLoaded: {} };
    for (const [index, document] of chosen.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, POLITE_MS));
      const facts = await fetchAndMeasure(runDir, document, scope, guard);
      await writeJson(join(runDir, documentDir(document), "facts.json"), facts);
      result[facts.status === "read" ? "read" : facts.status === "notRead" ? "notRead" : "failed"]++;
      process.stderr.write(`documents ${document.label} ${facts.status}${facts.reasonNl ? ` (${facts.reasonNl})` : ""} ${document.url}\n`);
    }
    if (guard.blocked.length > 0) await writeJson(join(runDir, "documents", "blocked.json"), guard.blocked);
  }
  // Which programs measured, with their versions: a report must be able to say what ran.
  await writeManifest(runDir, { command: "documents", startedAt, ...result, ...(chosen.length > 0 ? { tools: await documentTools() } : {}) });
  return result;
}
