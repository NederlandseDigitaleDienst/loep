import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPage } from "../instruments/documents/pdf.ts";
import { readJson } from "../lib/canonical.ts";
import { KIND_NAME_NL, loadDocuments, originalPath, type DocumentData, type SampleDocument } from "../lib/documents.ts";
import { UsageError, type Options, type Outcome } from "./commands.ts";
import type { Images } from "./observations.ts";

const MAX_TEXT = 6000;
const MAX_TAG_LINES = 200;
const LOOK_DPI = 100;

/** The parts of text.txt that belong to one page, slide or sheet. */
export function sectionsOf(text: string, page: number): string[] {
  return text.split(/^(?==== )/m).filter((section) => new RegExp(`^=== (?:pagina|dia|blad) ${page}\\b`).test(section));
}

/** The lines of the tag tree that are on one page, each with the tags above it so the place in the tree shows. */
export function tagsOfPage(tree: string, page: number): string[] {
  const lines = tree.split("\n").filter(Boolean);
  const keep = new Set<number>();
  const marker = new RegExp(`\\[p${page}[ \\]]`);
  lines.forEach((line, index) => {
    if (!marker.test(line)) return;
    keep.add(index);
    let depth = line.length - line.trimStart().length;
    for (let above = index - 1; above >= 0 && depth > 0; above--) {
      const indent = lines[above]!.length - lines[above]!.trimStart().length;
      if (indent < depth) {
        keep.add(above);
        depth = indent;
      }
    }
  });
  return [...keep].sort((a, b) => a - b).map((index) => lines[index]!);
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n(+${text.length - max} tekens; zie het bestand)` : text);

/**
 * A closer look at one document of the sample: its facts, or one page of it with the text in
 * reading order, the tags on that page and, for a PDF, a picture. It reads what `documents`
 * stored in the run; nothing is fetched and no page of the session is touched.
 */
export async function documentOutcome(runDir: string, args: string[], options: Options, images: Images): Promise<Outcome> {
  const samplePath = join(runDir, "sample.json");
  const chosen = existsSync(samplePath) ? ((await readJson<{ documents?: SampleDocument[] }>(samplePath)).documents ?? []) : [];
  const all = loadDocuments(runDir, chosen);
  if (all.length === 0) throw new UsageError("deze run heeft geen documenten in de steekproef");
  const document: DocumentData | undefined = all.find((entry) => entry.label === args[0]);
  if (!document) throw new UsageError(`document verwacht het label van een document: ${all.map((entry) => entry.label).join(", ")}`);
  const facts = document.facts;
  if (!facts) throw new Error(`${document.label} is nog niet gemeten; draai eerst: documents --run <run>`);
  const head = { document: document.label, kind: KIND_NAME_NL[facts.kind], url: facts.url, status: facts.status };
  if (facts.status !== "read") return { result: facts, print: { ...head, reason: facts.reasonNl, note: "dit document is niet ingelezen; dat is een open punt, geen goedkeuring" } };

  const text = facts.files.text && existsSync(join(runDir, facts.files.text)) ? await readFile(join(runDir, facts.files.text), "utf8") : "";
  const tree = facts.files.tagTree && existsSync(join(runDir, facts.files.tagTree)) ? await readFile(join(runDir, facts.files.tagTree), "utf8") : null;
  const unit = facts.office?.slides ? "dia" : facts.office?.sheets ? "blad" : "pagina";

  if (options.page !== undefined) {
    const page = Number(options.page);
    if (!Number.isInteger(page) || page < 1 || (facts.pages !== null && page > facts.pages)) throw new UsageError(`--page moet een nummer zijn van 1 tot ${facts.pages ?? "het aantal pagina's"}`);
    const sections = sectionsOf(text, page);
    const tags = tree ? tagsOfPage(tree, page) : [];
    let image: string | null = null;
    let imageNote: string | null = null;
    if (facts.kind === "pdf") {
      const picture = await renderPage(join(runDir, originalPath(document.item)), page, images.image(), LOOK_DPI);
      if (picture) image = images.relative(picture);
      else imageNote = "geen beeld: pdftoppm (poppler) is niet geïnstalleerd of kon de pagina niet tekenen";
    } else imageNote = "geen beeld: van een kantoorbestand wordt geen pagina getekend";
    const pageFacts = {
      headings: facts.headings.filter((entry) => entry.page === page),
      images: facts.images.filter((entry) => entry.page === page),
      tables: facts.tables.filter((entry) => entry.page === page),
      links: facts.links.filter((entry) => entry.page === page),
      fields: facts.fields.filter((entry) => entry.page === page),
      ...(facts.pdf ? { text: facts.pdf.pageText.find((entry) => entry.page === page) ?? null } : {}),
      ...(facts.office?.slides ? { slide: facts.office.slides.find((entry) => entry.slide === page) ?? null } : {}),
      ...(facts.office?.sheets ? { sheet: facts.office.sheets[page - 1] ?? null } : {}),
    };
    return {
      result: { ...head, [unit]: page, facts: pageFacts, text: sections.join("\n"), tags },
      print: {
        ...head,
        [unit]: `${page} van ${facts.pages ?? "?"}`,
        ...(image ? { image } : { imageNote }),
        ...pageFacts,
        text: cut(sections.join("\n").trim(), MAX_TEXT) || "(geen tekst)",
        ...(tree ? { tags: [...tags.slice(0, MAX_TAG_LINES), ...(tags.length > MAX_TAG_LINES ? [`(+${tags.length - MAX_TAG_LINES} regels; zie ${facts.files.tagTree})`] : [])] } : facts.kind === "pdf" ? { tags: "het bestand heeft geen tags" } : {}),
      },
    };
  }

  if (options.tags === true) {
    if (!tree) throw new UsageError(facts.kind === "pdf" ? "dit pdf-bestand heeft geen tags" : "de tagboom bestaat alleen voor een pdf; gebruik document <label> --page n");
    const lines = tree.split("\n").filter(Boolean);
    return { result: { ...head, tags: lines }, print: { ...head, lines: lines.length, tags: [...lines.slice(0, MAX_TAG_LINES), ...(lines.length > MAX_TAG_LINES ? [`(+${lines.length - MAX_TAG_LINES} regels; zie ${facts.files.tagTree}, of vraag een pagina met --page n)`] : [])], note: "per regel: tag [pagina, tekstalternatief, taal, bereik van een kopcel, doel van een link] en de eigen tekst" } };
  }

  const first = <T>(items: T[], max: number): (T | string)[] => [...items.slice(0, max), ...(items.length > max ? [`(+${items.length - max})`] : [])];
  return {
    result: { ...facts, text: cut(text, 40_000) },
    print: {
      ...head,
      title: facts.title,
      language: facts.language,
      [facts.office?.slides ? "slides" : facts.office?.sheets ? "sheets" : "pages"]: facts.pages,
      ...(facts.pdf
        ? {
            tagged: facts.pdf.tagged,
            titleShownInTitleBar: facts.pdf.displayDocTitle,
            pdfUa: facts.pdf.pdfUa.available ? (facts.pdf.pdfUa.compliant ? "voldoet aan PDF/UA-1 volgens veraPDF" : first(facts.pdf.pdfUa.failedRules.map((rule) => `${rule.clause}-${rule.test} (${rule.failedChecks} keer): ${rule.description.slice(0, 140)}`), 12)) : facts.pdf.pdfUa.reasonNl,
            bookmarks: facts.pdf.bookmarks.count,
            scanPages: facts.pdf.scanPages,
            encryption: facts.pdf.encryption,
            order: first(facts.pdf.pageText.filter((page) => page.order !== null && page.order !== "gelijk").map((page) => `pagina ${page.page}: ${page.order}`), 10),
            partsWithOwnLanguage: first(facts.pdf.languageParts, 8),
          }
        : {}),
      headings: first(facts.headings.map((heading) => `${heading.level > 0 ? `H${heading.level}` : "H"}${heading.page !== null ? ` p${heading.page}` : ""}: ${heading.text.slice(0, 80)}`), 40),
      images: { total: facts.images.length, withoutAlternative: first(facts.images.filter((image) => !image.alt && !image.decorative).map((image) => `${image.page !== null ? `${unit} ${image.page}: ` : ""}${image.context}`), 15), alternatives: first(facts.images.filter((image) => image.alt).map((image) => image.alt!.slice(0, 100)), 15) },
      tables: first(facts.tables.map((table) => `${table.page !== null ? `${unit} ${table.page}: ` : ""}${table.rows ?? "?"} rijen, ${table.hasHeader ? `${table.headerCells} kopcellen` : "geen kopcellen"}; eerste rij: ${table.firstRow.join(" | ").slice(0, 100)}`), 15),
      links: first(facts.links.map((link) => `${link.text || "(geen tekst)"}${link.href ? ` -> ${link.href.slice(0, 80)}` : ""}`), 25),
      ...(facts.fields.length > 0 ? { fields: first(facts.fields.map((field) => `${field.type} ${field.id}: ${field.name ?? "(geen naam)"}`), 25) } : {}),
      ...(facts.office ? { paragraphsThatLookLikeAHeading: first(facts.office.fakeHeadings.map((entry) => entry.text), 15), lists: facts.office.lists, ...(facts.office.slides ? { slideTitles: first(facts.office.slides.map((slide) => `${slide.slide}: ${slide.title ?? "(geen titel)"}`), 40) } : {}), ...(facts.office.sheets ? { sheetList: facts.office.sheets.map((sheet) => `${sheet.name}: ${sheet.headerRowDefined ? "kopregel vastgelegd" : "geen kopregel vastgelegd"}; eerste rij: ${sheet.firstRow.join(" | ").slice(0, 100)}`) } : {}), partsWithOwnLanguage: first(facts.office.languageParts, 8) } : {}),
      ...(facts.notMeasuredNl.length > 0 ? { notMeasured: facts.notMeasuredNl } : {}),
      files: facts.files,
      note: `gelezen uit het bestand, zonder schermlezer; met --page n zie je één ${unit}${facts.kind === "pdf" ? " met beeld, tekst en tags; met --tags de tagboom" : " met tekst"}`,
    },
  };
}
