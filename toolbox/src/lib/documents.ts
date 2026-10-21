import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isOwnAddress, originsNl, siteOrigins, type OriginSource } from "./origins.ts";

/**
 * Documents a site publishes next to its pages: PDF, word processor, presentation and
 * spreadsheet files, and plain text (Markdown, txt, csv) offered as a file. EN 301 549
 * chapter 10 applies the WCAG criteria to them. This file holds what every step of the chain
 * shares: the kinds, how a link is recognised as one, and the shape of what is found, chosen
 * and measured.
 */

/**
 * "text" is plain text: Markdown, txt, csv, and agenda items and business cards (ics, vcf). "other" is a file a link offers for download
 * (the `download` attribute) whose kind is none of these: counted as a document, not read.
 */
export const DOCUMENT_KINDS = ["pdf", "docx", "odt", "rtf", "pptx", "odp", "xlsx", "ods", "text", "epub", "doc", "xls", "ppt", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The kinds the toolbox opens and measures. The others are recorded as not read. */
export const READ_KINDS: readonly DocumentKind[] = ["pdf", "docx", "odt", "pptx", "odp", "xlsx", "ods", "text"];

/** Why a kind is not read, in Dutch: it goes into the facts and the report. */
export const NOT_READ_REASON_NL: Partial<Record<DocumentKind, string>> = {
  doc: "het oude binaire formaat van Word wordt niet ingelezen; daar is een kantoorpakket voor nodig",
  xls: "het oude binaire formaat van Excel wordt niet ingelezen; daar is een kantoorpakket voor nodig",
  ppt: "het oude binaire formaat van PowerPoint wordt niet ingelezen; daar is een kantoorpakket voor nodig",
  rtf: "rtf wordt niet ingelezen; het formaat kent geen koppen, tekstalternatieven of tabelkoppen die betrouwbaar uit het bestand te lezen zijn",
  epub: "epub wordt niet ingelezen; een epub is een pakket webpagina's dat een eigen onderzoek vraagt",
  other: "het bestand wordt als download aangeboden en is van een soort die de toolbox niet kent; het wordt niet ingelezen",
};

export const KIND_NAME_NL: Record<DocumentKind, string> = {
  pdf: "pdf",
  docx: "Word (docx)",
  odt: "OpenDocument-tekst (odt)",
  rtf: "rtf",
  pptx: "PowerPoint (pptx)",
  odp: "OpenDocument-presentatie (odp)",
  xlsx: "Excel (xlsx)",
  ods: "OpenDocument-rekenblad (ods)",
  text: "platte tekst (md, txt, csv, ics)",
  epub: "epub",
  doc: "Word (doc)",
  xls: "Excel (xls)",
  ppt: "PowerPoint (ppt)",
  other: "ander bestand",
};

/** Extensions that name a kind other than themselves. */
// An agenda item (ics) and a business card (vcf) are plain text too, and servers often send them as application/octet-stream.
const BY_EXTENSION: Record<string, DocumentKind> = { md: "text", markdown: "text", txt: "text", csv: "text", ics: "text", ical: "text", ifb: "text", vcs: "text", vcf: "text" };

const BY_CONTENT_TYPE: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/epub+zip": "epub",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "text/plain": "text",
  "text/markdown": "text",
  "text/x-markdown": "text",
  "text/csv": "text",
  "text/calendar": "text",
  "text/vcard": "text",
  "text/x-vcard": "text",
};

/** The kind of document an address points at, by its extension; null when it is none. */
export function documentKind(url: string): DocumentKind | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  if (extension in BY_EXTENSION) return BY_EXTENSION[extension]!;
  return extension !== "text" && extension !== "other" && (DOCUMENT_KINDS as readonly string[]).includes(extension) ? (extension as DocumentKind) : null;
}

/** The kind of document a server says it sends; null when it is none. */
export function kindOfContentType(contentType: string | null): DocumentKind | null {
  return BY_CONTENT_TYPE[(contentType ?? "").split(";")[0]!.trim().toLowerCase()] ?? null;
}

/** Whether a navigation error is Playwright's "Download is starting": the browser saves the address as a file, so it is no page that failed to load. */
export const startedDownload = (message: string): boolean => /\bDownload is starting\b/.test(message);

/** One document on the origin of the run, as the inventory found it. */
export interface InventoryDocument {
  url: string;
  kind: DocumentKind;
  slug: string;
  /** The pages that link to it, each with the text of the link and, for a link with a `download` attribute, the file name it offers ("" when it names none). Empty for a document that is only in the sitemap. */
  linkedFrom: { page: string; text: string; download?: string }[];
  /** What the server said to one HEAD request; null when it was not asked or did not answer. */
  bytes: number | null;
  /** `Last-Modified` as an ISO date. Office files from before 23 September 2018 can be exempt; this only records the date. */
  lastModified: string | null;
  contentType: string | null;
  status: number | null;
  /** Why size and date are missing, when they are. */
  notAsked?: string;
}

export interface DocumentTotals {
  /** Documents on the origin of the run. */
  onSite: number;
  byKind: Partial<Record<DocumentKind, number>>;
  /** Links to documents on another origin: counted, never fetched. */
  elsewhere: number;
  elsewhereByKind: Partial<Record<DocumentKind, number>>;
}

/**
 * Why size and date are missing for a document whose address redirects to a host outside the
 * site. An inventory from before such documents were counted as elsewhere still lists them
 * among the documents of the site with this reason; it is how they are recognised there.
 */
export const REDIRECTS_ELSEWHERE_NL = "het adres verwijst door naar een ander domein";

/** Whether a document of an inventory lies on the site: on one of its origins, and not redirecting to a host outside it. */
export function isSiteDocument(document: InventoryDocument, origins: readonly string[]): boolean {
  return isOwnAddress(document.url, origins) && document.notAsked !== REDIRECTS_ELSEWHERE_NL;
}

/**
 * The documents of the site and the count of those elsewhere. A new inventory already counts a
 * document that redirects to another host as elsewhere; an older one listed it on the site, and
 * here it moves to the count elsewhere, so an old run gives the same sample a new one would.
 */
export function siteDocuments(inventory: OriginSource & { documents?: InventoryDocument[] | undefined; documentTotals?: DocumentTotals | undefined }): { onSite: InventoryDocument[]; elsewhere: number } {
  const origins = siteOrigins(inventory);
  const all = inventory.documents ?? [];
  const onSite = all.filter((document) => isSiteDocument(document, origins));
  return { onSite, elsewhere: (inventory.documentTotals?.elsewhere ?? 0) + all.length - onSite.length };
}

export type SampleDocumentReason = "all" | "structured" | "random";

/** One document of the sample. Its label ("D03") is what a finding points at. */
export interface SampleDocument {
  label: string;
  url: string;
  kind: DocumentKind;
  slug: string;
  /** Why this document is in the sample, in Dutch: it is printed in the report. */
  reason: string;
  linkedFrom: InventoryDocument["linkedFrom"];
  bytes: number | null;
  lastModified: string | null;
}

/** Labels of documents: "D01", "D02", ... next to the "P01" of pages. */
export function documentLabels(count: number): string[] {
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_item, index) => `D${String(index + 1).padStart(width, "0")}`);
}

export const isDocumentLabel = (label: string): boolean => /^D\d{2,}$/.test(label);

/** "3 pdf, 1 Word (docx)" */
export function kindsNl(byKind: Partial<Record<DocumentKind, number>>): string {
  return DOCUMENT_KINDS.filter((kind) => (byKind[kind] ?? 0) > 0)
    .map((kind) => `${byKind[kind]} ${KIND_NAME_NL[kind]}`)
    .join(", ");
}

export const countByKind = (items: { kind: DocumentKind }[]): Partial<Record<DocumentKind, number>> => {
  const counts: Partial<Record<DocumentKind, number>> = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
};

// ------------------------------------------------------------------ what is measured

export interface DocumentHeading {
  level: number;
  text: string;
  /** Page of a PDF or slide of a presentation, counted from 1; null when the file does not say. */
  page: number | null;
}

export interface DocumentImage {
  page: number | null;
  /** The text alternative; null when there is none. */
  alt: string | null;
  /** Marked as decoration by the author (an artifact in PDF, "decorative" in an office file). */
  decorative?: boolean;
  /** What the file calls it, or the text around it, to find it back. */
  context: string;
}

export interface DocumentTable {
  page: number | null;
  rows: number | null;
  /** Header cells (TH in PDF) or a row marked as header. */
  headerCells: number;
  hasHeader: boolean;
  /** The text of the first row, to find the table back. */
  firstRow: string[];
}

export interface DocumentLink {
  page: number | null;
  text: string;
  /** Where it leads; null when the file does not say. */
  href: string | null;
}

export interface DocumentField {
  page: number | null;
  type: string;
  /** The name assistive technology reads (TU in PDF); null when there is none. */
  name: string | null;
  /** The internal name of the field. */
  id: string;
}

/** A paragraph that looks like a heading (short, all bold) but has no heading style. */
export interface FakeHeading {
  text: string;
  page: number | null;
}

export interface PdfFacts {
  tagged: boolean;
  /** Whether the viewer shows the title in its title bar (ViewerPreferences/DisplayDocTitle). */
  displayDocTitle: boolean;
  pdfVersion: string | null;
  producer: string | null;
  /** veraPDF PDF/UA-1 per failed rule; `available` false when veraPDF is not installed or gave no result. */
  pdfUa: { available: boolean; compliant: boolean | null; reasonNl: string | null; failedRules: { clause: string; test: number; description: string; failedChecks: number }[] };
  bookmarks: { count: number; titles: string[] };
  /** Counts of structure elements by their standard type. */
  tags: Record<string, number>;
  /** Whether the text of each tag could be read; without it headings and links have no text. */
  tagTextRead: boolean;
  encryption: { encrypted: boolean; /** False when the file forbids assistive technology to read the text. */ accessibilityAllowed: boolean };
  /** Per page: how many characters of text it has, and whether it is a picture of text only. */
  pageText: { page: number; characters: number; /** Words that text recognition found in the picture of the page; null when not tried. */ recognisedWords: number | null; scanOnly: boolean | null; /** How the order of the tags compares with the order in the content: "gelijk", "andere volgorde", "andere inhoud", or null when it cannot be told. */ order: string | null }[];
  scanPages: number[];
  /** Why text recognition was not tried on pages without text, when it was not. */
  scanNotCheckedNl: string | null;
  /** Elements with a language of their own. */
  languageParts: { lang: string; text: string; page: number | null }[];
  lists: number;
  /** Pictures in the content of the pages, tagged or not. More of them than figures in the tags can mean pictures without a tag, or decoration. */
  imageObjects: number;
  /** Link annotations on the pages, tagged or not. */
  linkAnnotations: number;
  /** Link tags without text inside a link tag with the same href; they are counted as part of the outer link and not listed in `links`. */
  nestedLinks: number;
  /** How many there are of each, before the lists were cut off at their limit. */
  counts: { headings: number; images: number; tables: number; links: number; fields: number };
}

export interface PlainTextFacts {
  /** By the type the server names, or else by the extension. */
  format: "markdown" | "csv" | "plain";
  /** The `Content-Type` header of the download; null when the server sent none. */
  contentType: string | null;
  /** The character set that header names; null when it names none. A browser that shows the file then guesses, and can show "Ã©" for "é". */
  charset: string | null;
  /** Whether the bytes are valid UTF-8. */
  validUtf8: boolean;
  /** Whether there is any byte beyond ASCII: only then does a missing character set change what a reader sees. */
  nonAscii: boolean;
  /** How the text was decoded for the facts: the named character set, UTF-8 when the bytes are valid UTF-8, or windows-1252. */
  decodedAs: string;
  lines: number;
}

/** What the character set of a plain text file means for a reader, in Dutch; null when nothing is amiss. */
export function charsetNoteNl(plain: PlainTextFacts): string | null {
  if (plain.charset && /^utf-?8$/.test(plain.charset) && !plain.validUtf8) return `De server noemt de tekenset ${plain.charset}, maar de bytes zijn geen geldige UTF-8: letters met accenten komen verkeerd over.`;
  if (plain.charset || !plain.nonAscii) return null;
  return `De server noemt geen tekenset (Content-Type: ${plain.contentType ?? "geen"}) en het bestand bevat tekens buiten ASCII. Een browser die het bestand opent, moet de tekenset raden en kan letters met accenten verkeerd tonen ("Ã©" voor "é"). De bytes zijn ${plain.validUtf8 ? "geldige" : "geen geldige"} UTF-8${plain.validUtf8 ? ": een teksteditor die UTF-8 aanneemt, toont ze goed" : ""}.`;
}

/**
 * Plain text has no property for a title or a language. WCAG2ICT replaces 2.4.2 for documents
 * by one that applies only to formats with a title property; for 3.1.1 it makes no such
 * exception for documents, but the format offers no way to meet it. Both are given to the
 * judge as not applicable to the file, not as a gap, with the reason in the facts.
 */
export const PLAIN_TITLE_NOT_APPLICABLE_NL = "Platte tekst heeft geen titeleigenschap. WCAG2ICT vervangt 2.4.2 voor documenten door '2.4.2 Non-web Document Titled', dat alleen geldt voor formaten met een titeleigenschap die in de gangbare programma's te bewerken is. Voor dit bestand is 2.4.2 daarom niet van toepassing; de bestandsnaam en de eerste kop zijn een waarneming.";
export const PLAIN_LANGUAGE_NOT_APPLICABLE_NL = "Platte tekst kan geen taal opgeven: het formaat heeft daar geen eigenschap of opmaak voor. WCAG2ICT maakt daarvoor bij documenten geen uitzondering; bij software merkt het op dat techniek waarin hulpsoftware de taal niet kan bepalen, het criterium niet kan halen. De toolbox telt 3.1.1 en 3.1.2 voor dit bestand als niet van toepassing, niet als fout en niet als open punt. Een andere onderzoeker kan dat anders wegen.";

export interface OfficeFacts {
  /** Paragraphs that are short and wholly bold but have no heading style. */
  fakeHeadings: FakeHeading[];
  lists: { real: number; /** Paragraphs that start with a dash, a bullet or a number but are no list. */ typed: number };
  /** Presentations: one entry per slide. */
  slides?: { slide: number; title: string | null; /** The texts of the slide in the order assistive technology reads them. */ readingOrder: string[] }[];
  /** Spreadsheets: one entry per sheet. */
  sheets?: { name: string; firstRow: string[]; /** Whether a table with a header row is defined over the data. */ headerRowDefined: boolean }[];
  languageParts: { lang: string; text: string }[];
}

/** Everything measured in one document. Nothing here judges anything. */
export interface DocumentFacts {
  label: string;
  url: string;
  kind: DocumentKind;
  /** "read": measured. "notRead": the kind is not read. "failed": it could not be fetched or opened. */
  status: "read" | "notRead" | "failed";
  /** With "notRead" and "failed": why. */
  reasonNl: string | null;
  bytes: number | null;
  sha256: string | null;
  measuredAt: string;
  title: string | null;
  language: string | null;
  /** Pages of a PDF or text document, slides of a presentation, sheets of a spreadsheet; null when unknown. */
  pages: number | null;
  headings: DocumentHeading[];
  images: DocumentImage[];
  tables: DocumentTable[];
  links: DocumentLink[];
  fields: DocumentField[];
  pdf?: PdfFacts;
  office?: OfficeFacts;
  plain?: PlainTextFacts;
  /** Files next to facts.json, relative to the run: the text and the pictures of the first pages. */
  files: { text: string | null; tagTree: string | null; pageImages: string[] };
  /** Programs that were missing, and what was therefore not measured. */
  notMeasuredNl: string[];
}

export const emptyFacts = (label: string, url: string, kind: DocumentKind, status: DocumentFacts["status"], reasonNl: string | null): DocumentFacts => ({
  label,
  url,
  kind,
  status,
  reasonNl,
  bytes: null,
  sha256: null,
  measuredAt: new Date().toISOString(),
  title: null,
  language: null,
  pages: null,
  headings: [],
  images: [],
  tables: [],
  links: [],
  fields: [],
  files: { text: null, tagTree: null, pageImages: [] },
  notMeasuredNl: [],
});

/** Where everything about one document of the sample lives, relative to the run. */
export const documentDir = (document: { slug: string }): string => join("documents", document.slug);
/** Where the fetched file itself is kept, relative to the run. */
export const originalPath = (document: { slug: string; kind: DocumentKind }): string => join(documentDir(document), `original.${document.kind}`);

/** One document of the sample with what was measured in it; `facts` is null until `documents` has run. */
export interface DocumentData {
  label: string;
  item: SampleDocument;
  dir: string;
  facts: DocumentFacts | null;
}

/** The documents of a sample with their facts, in sample order. */
export function loadDocuments(runDir: string, chosen: SampleDocument[] | undefined): DocumentData[] {
  return (chosen ?? []).map((item) => {
    const path = join(runDir, documentDir(item), "facts.json");
    return { label: item.label, item, dir: documentDir(item), facts: existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DocumentFacts) : null };
  });
}

// ------------------------------------------------------------------ in the evaluation

/** The documents as the report shows them: what was found, what was examined and what was not. */
export interface EvaluationDocuments {
  onSite: number;
  byKind: Partial<Record<DocumentKind, number>>;
  /** Links to documents on other origins: counted, not examined. */
  elsewhere: number;
  notChosen: number;
  notChosenByKind: Partial<Record<DocumentKind, number>>;
  /** The criteria whose procedure takes the documents into account. */
  criteria: string[];
  items: { label: string; url: string; kind: DocumentKind; title: string | null; pages: number | null; status: DocumentFacts["status"] | "notMeasured"; reasonNl: string | null; reason: string; lastModified: string | null; /** A tagged pdf whose tag text could not be read; absent otherwise. */ tagTextNotRead?: true }[];
}

/** The date before which an office file can fall under the exemption of the law, when it is not needed for a running process. */
export const EXEMPTION_DATE = "2018-09-23";

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const listNl = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} en ${items.at(-1)}`);

export function evaluationDocuments(documents: DocumentData[], population: { onSite: number; byKind: Partial<Record<DocumentKind, number>>; elsewhere: number; notChosen: number; notChosenByKind: Partial<Record<DocumentKind, number>> }, criteria: string[]): EvaluationDocuments {
  return {
    onSite: population.onSite,
    byKind: population.byKind,
    elsewhere: population.elsewhere,
    notChosen: population.notChosen,
    notChosenByKind: population.notChosenByKind,
    criteria,
    items: documents.map((document) => ({ label: document.label, url: document.item.url, kind: document.item.kind, title: document.facts?.title ?? null, pages: document.facts?.pages ?? null, status: document.facts?.status ?? "notMeasured", reasonNl: document.facts ? document.facts.reasonNl : "het document is niet gemeten: het commando documents is niet gedraaid", reason: document.item.reason, lastModified: document.item.lastModified, ...(document.facts?.pdf?.tagged && !document.facts.pdf.tagTextRead ? { tagTextNotRead: true as const } : {}) })),
  };
}

/** What holds for documents in this evaluation, as sentences for the scope and the limitations. */
export function documentScopeNl(documents: EvaluationDocuments | null, origins: string | readonly string[], elsewhere: number): { includedNl: string[]; excludedNl: string[]; limitationsNl: string[] } {
  const origin = originsNl(typeof origins === "string" ? [origins] : origins);
  const readKinds = listNl(READ_KINDS.map((kind) => (kind === "text" ? "platte tekst" : kind)));
  const otherOrigins = elsewhere > 0 ? `Documenten op andere domeinen waarnaar de site linkt (${elsewhere} geteld)` : "Documenten op andere domeinen waarnaar de site linkt";
  if (!documents) {
    return {
      includedNl: [],
      excludedNl: [otherOrigins],
      limitationsNl: [`Documenten: op de site zijn geen documenten gevonden (pdf, kantoorbestanden, platte tekst of epub). Gezocht is naar links op de pagina's en in de sitemap. Een document dat alleen via een script of na het versturen van een formulier te bereiken is, is niet gevonden.${elsewhere > 0 ? ` ${plural(elsewhere, "document staat", "documenten staan")} op een ander domein en ${elsewhere === 1 ? "is" : "zijn"} niet onderzocht.` : ""}`],
    };
  }
  const read = documents.items.filter((item) => item.status === "read");
  const notRead = documents.items.filter((item) => item.status === "notRead");
  const failed = documents.items.filter((item) => item.status === "failed" || item.status === "notMeasured");
  const tagText = documents.items.filter((item) => item.tagTextNotRead);
  const old = documents.items.filter((item) => item.lastModified !== null && item.lastModified.slice(0, 10) < EXEMPTION_DATE);
  const limitations = [
    `Documenten: op de site staan ${plural(documents.onSite, "document", "documenten")} (${kindsNl(documents.byKind)}). De toolbox leest de soorten ${readKinds} in. ${plural(read.length, "document is", "documenten zijn")} ingelezen en beoordeeld${read.length > 0 ? ` (${read.map((item) => item.label).join(", ")})` : ""}. Gelezen is wat in het bestand staat: tags, titel, taal, koppen, tekstalternatieven, tabellen, lijsten, links en formuliervelden, en bij een pdf de uitkomst van veraPDF (PDF/UA-1). Er is geen kantoorpakket en geen schermlezer gebruikt, en van een kantoorbestand is er geen beeld.`,
    `Documenten zijn beoordeeld op de criteria ${listNl(documents.criteria)}. Op de andere criteria zijn ze niet beoordeeld, bijvoorbeeld contrast, bediening met het toetsenbord en foutmeldingen in formulieren.`,
    ...(tagText.length > 0 ? [`Van ${plural(tagText.length, "pdf-document", "pdf-documenten")} kon de toolbox de tekst bij de tags niet lezen (${tagText.map((item) => item.label).join(", ")}). Van de tags is dan alleen bekend welke er zijn, niet welke tekst erbij hoort. De koppen, links en tabellen in ${tagText.length === 1 ? "dit document zijn" : "deze documenten zijn"} daardoor minder zeker beoordeeld. Dat geldt voor de criteria 1.3.1, 1.3.2, 2.4.2, 2.4.4, 2.4.6 en 3.1.2. Een document zonder bevinding is hier dus geen goedkeuring.`] : []),
    ...(notRead.length > 0 ? [`${plural(notRead.length, "document is", "documenten zijn")} van een soort die niet wordt ingelezen (${kindsNl(countByKind(notRead))}: ${notRead.map((item) => item.label).join(", ")}) en ${notRead.length === 1 ? "is" : "zijn"} niet onderzocht. Dat is een open punt, geen goedkeuring.`] : []),
    ...(failed.length > 0 ? [`${plural(failed.length, "document was", "documenten waren")} niet op te halen of niet te openen en ${failed.length === 1 ? "is" : "zijn"} niet onderzocht: ${failed.map((item) => `${item.label} (${item.reasonNl ?? "reden onbekend"})`).join("; ")}.`] : []),
    ...(documents.notChosen > 0 ? [`${plural(documents.notChosen, "document is", "documenten zijn")} niet voor de steekproef gekozen (${kindsNl(documents.notChosenByKind)}) en ${documents.notChosen === 1 ? "is" : "zijn"} niet onderzocht.`] : []),
    ...(documents.elsewhere > 0 ? [`${plural(documents.elsewhere, "document staat", "documenten staan")} op een ander domein en ${documents.elsewhere === 1 ? "is" : "zijn"} niet onderzocht.`] : []),
    ...(old.length > 0 ? [`Van ${plural(old.length, "document", "documenten")} in de steekproef is de datum volgens de server van voor 23 september 2018 (${old.map((item) => item.label).join(", ")}). Kantoorbestanden van voor die datum kunnen onder een wettelijke uitzondering vallen als ze niet nodig zijn voor een lopend proces. Dat is hier niet beoordeeld: ze zijn onderzocht als de andere.`] : []),
    "Gezocht is naar documenten via links op de pagina's en in de sitemap. Een document dat alleen via een script of na het versturen van een formulier te bereiken is, is niet gevonden.",
  ];
  return {
    includedNl: [`Documenten op ${origin} (pdf, kantoorbestanden en platte tekst): ${documents.items.length} van ${documents.onSite} in de steekproef, ${read.length} ingelezen`],
    excludedNl: [otherOrigins, ...(notRead.length > 0 ? [`Documenten van een soort die niet wordt ingelezen (${kindsNl(countByKind(notRead))})`] : [])],
    limitationsNl: limitations,
  };
}
