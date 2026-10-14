import { readFile } from "node:fs/promises";
import type { DocumentFacts, DocumentHeading, DocumentImage, DocumentLink, DocumentTable, PlainTextFacts } from "../../lib/documents.ts";

/**
 * Plain text offered as a file: Markdown, txt and csv. The file has no properties: no title, no
 * language, no tags. What it has is its text, the character set the server names for it, and
 * in Markdown the structure its syntax writes out (headings, links, pictures, tables).
 */

export interface TextMeasurement {
  facts: Pick<DocumentFacts, "title" | "language" | "pages" | "headings" | "images" | "tables" | "links" | "fields" | "notMeasuredNl"> & { plain: PlainTextFacts };
  /** The text as decoded, under one page marker so `document <label> --page 1` finds it. */
  text: string;
}

const MAX_ITEMS = 400;
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

/** The character set a `Content-Type` header names, lower case; null when it names none. */
export function charsetOf(contentType: string | null): string | null {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  return match ? match[1]!.toLowerCase() : null;
}

function formatOf(url: string, contentType: string | null): PlainTextFacts["format"] {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "text/markdown" || type === "text/x-markdown") return "markdown";
  if (type === "text/csv") return "csv";
  const extension = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "csv") return "csv";
  return "plain";
}

function decode(bytes: Buffer, charset: string | null): { text: string; validUtf8: boolean; decodedAs: string } {
  let validUtf8 = true;
  let utf8 = "";
  try {
    utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    validUtf8 = false;
  }
  if (charset) {
    try {
      return { text: new TextDecoder(charset).decode(bytes), validUtf8, decodedAs: charset };
    } catch {
      // A name the decoder does not know: decoded as below.
    }
  }
  if (validUtf8) return { text: utf8, validUtf8, decodedAs: "utf-8" };
  return { text: new TextDecoder("windows-1252").decode(bytes), validUtf8, decodedAs: "windows-1252" };
}

/** Headings, pictures, links and tables as Markdown writes them out, outside fenced code. */
export function readMarkdown(text: string): { headings: DocumentHeading[]; images: DocumentImage[]; links: DocumentLink[]; tables: DocumentTable[] } {
  const headings: DocumentHeading[] = [];
  const images: DocumentImage[] = [];
  const links: DocumentLink[] = [];
  const tables: DocumentTable[] = [];
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  const cells = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(clean);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (opening) {
      if (fence === null) fence = opening[0]!;
      else if (opening[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const atx = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) headings.push({ level: atx[1]!.length, text: clean(atx[2]!), page: 1 });
    const underline = lines[index + 1];
    if (!atx && clean(line) && underline !== undefined && /^\s{0,3}(=+|-+)\s*$/.test(underline) && !/^\s{0,3}[-*+]\s/.test(line)) {
      headings.push({ level: underline.trim().startsWith("=") ? 1 : 2, text: clean(line), page: 1 });
      index++;
      continue;
    }
    for (const match of line.matchAll(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g)) {
      if (match[1]) images.push({ page: 1, alt: clean(match[2]!) || null, context: match[3]! });
      else links.push({ page: 1, text: clean(match[2]!.replace(/!\[[^\]]*\]\([^)]*\)/g, "")), href: match[3]! || null });
    }
    for (const match of line.matchAll(/<(https?:\/\/[^>\s]+)>/g)) links.push({ page: 1, text: match[1]!, href: match[1]! });
    // A table: a row of cells over a row of dashes. In Markdown the first row is always the header.
    if (line.includes("|") && underline !== undefined && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(underline)) {
      const firstRow = cells(line);
      let rows = 1;
      while (index + 1 + rows < lines.length && lines[index + 1 + rows]!.includes("|") && clean(lines[index + 1 + rows]!)) rows++;
      tables.push({ page: 1, rows, headerCells: firstRow.length, hasHeader: true, firstRow });
      index += rows;
    }
  }
  return { headings, images, links, tables };
}

/** Read one plain text file. `contentType` is what the server said when it was fetched. */
export async function measureText(file: string, url: string, contentType: string | null): Promise<TextMeasurement> {
  const bytes = await readFile(file);
  const charset = charsetOf(contentType);
  const { text, validUtf8, decodedAs } = decode(bytes, charset);
  const format = formatOf(url, contentType);
  const nonAscii = bytes.some((byte) => byte > 0x7f);
  const markdown = format === "markdown" ? readMarkdown(text) : { headings: [], images: [], links: [], tables: [] };
  const cap = <T>(items: T[]): T[] => items.slice(0, MAX_ITEMS);
  const notMeasuredNl = ["Gelezen is wat in het bestand staat: de tekst en, in Markdown, de koppen, links, afbeeldingen en tabellen zoals de opmaaktekens ze schrijven. Hoe een teksteditor of browser het bestand toont, is niet gemeten."];
  return {
    facts: {
      title: null,
      language: null,
      pages: 1,
      headings: cap(markdown.headings),
      images: cap(markdown.images),
      tables: cap(markdown.tables),
      links: cap(markdown.links),
      fields: [],
      notMeasuredNl,
      plain: { format, contentType, charset, validUtf8, nonAscii, decodedAs, lines: text.split(/\r?\n/).length },
    },
    text: `=== pagina 1 ===\n${text}${text.endsWith("\n") ? "" : "\n"}`,
  };
}
