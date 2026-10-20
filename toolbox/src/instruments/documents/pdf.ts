import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentFacts, DocumentHeading, DocumentImage, DocumentLink, DocumentTable, PdfFacts } from "../../lib/documents.ts";
import { pdfUa, tool } from "../../lib/typst.ts";
import { ocr } from "../methods/ocr.ts";

/**
 * What can be read from a PDF without opening it in a viewer. The structure comes from
 * qpdf (every object as JSON), the text of each tag from poppler (`pdfinfo -struct-text`),
 * the text of each page in the order of the content from `pdftotext -raw`, and PDF/UA-1
 * from veraPDF. A program that is missing leaves its part unmeasured, and says so.
 */

const TOOL_MS = 60_000;
const VERAPDF_MS = 180_000;
/** Pages without text that are rendered and given to text recognition. */
export const MAX_SCAN_PAGES = 8;
/** A page with fewer characters than this has no text layer to speak of. */
const NO_TEXT_BELOW = 20;
/** The first pages that are rendered as a picture for whoever judges the document. */
export const PREVIEW_PAGES = 3;
const PREVIEW_DPI = 80;
const MAX_ITEMS = 400;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Dict = { [key: string]: Json };

const isDict = (value: Json | undefined): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);
const isRef = (value: Json | undefined): value is string => typeof value === "string" && /^\d+ \d+ R$/.test(value);
/** A PDF string in qpdf's JSON: "u:" and text, or "b:" and bytes in hex. */
const text = (value: Json | undefined): string | null => {
  if (typeof value !== "string") return null;
  if (value.startsWith("u:")) return value.slice(2);
  if (value.startsWith("b:")) return Buffer.from(value.slice(2), "hex").toString("latin1");
  return null;
};
const name = (value: Json | undefined): string | null => (typeof value === "string" && value.startsWith("/") ? value.slice(1) : null);

/** One tag of the document with what assistive technology gets of it. */
export interface TagNode {
  /** The standard type, after the role map of the file. */
  type: string;
  page: number | null;
  alt: string | null;
  actualText: string | null;
  lang: string | null;
  scope: string | null;
  /** Where a link leads, from the annotation it holds. */
  href: string | null;
  /** Text and child tags in reading order. */
  children: (string | TagNode)[];
}

export const tagText = (node: TagNode | string): string => (typeof node === "string" ? node : node.children.map(tagText).join(""));
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

function* walk(node: TagNode): Generator<TagNode> {
  yield node;
  for (const child of node.children) if (typeof child !== "string") yield* walk(child);
}

/** The links of the tags. A Link without text of its own inside a Link with the same href is part of the outer link: it is counted in `nested` and not listed. */
export function linksOf(roots: TagNode[]): { links: DocumentLink[]; nested: number } {
  const links: DocumentLink[] = [];
  let nested = 0;
  const visit = (node: TagNode, outer: Set<string>): void => {
    let inner = outer;
    if (node.type === "Link") {
      const linkText = clean(tagText(node)) || clean(node.alt ?? "");
      if (node.href !== null && outer.has(node.href) && !linkText) nested++;
      else links.push({ page: node.page, text: linkText, href: node.href });
      if (node.href !== null) inner = new Set([...outer, node.href]);
    }
    for (const child of node.children) if (typeof child !== "string") visit(child, inner);
  };
  for (const root of roots) visit(root, new Set());
  return { links, nested };
}

/**
 * The tree of `pdfinfo -struct-text`: a line per tag, indented two spaces per level, with
 * its text in quotes below it. Only the shape and the text are taken from it.
 */
export function parseStructText(output: string): { type: string; children: (string | { type: string; children: unknown[] })[] }[] {
  type Node = { type: string; children: (string | Node)[] };
  const roots: Node[] = [];
  const stack: { indent: number; node: Node }[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim() || /^Syntax (Error|Warning)/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const quoted = /^"(.*)"$/s.exec(body);
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    if (quoted) {
      stack.at(-1)?.node.children.push(quoted[1]!);
      continue;
    }
    // An attribute ("/Scope /Column") or the object of an annotation: not a tag.
    if (body.startsWith("/") || /^Object \d+ \d+$/.test(body)) continue;
    // Only the name is read. After it poppler prints a title, <id>, (block) or ["alt"], without escaping
    // quotes in the texts; the line comes from an untrusted PDF, so no pattern that could backtrack over it.
    const tag = /^([A-Za-z][\w-]*)(?::?$| ["<(\[])/.exec(body);
    if (!tag) continue;
    const node: Node = { type: tag[1]!, children: [] };
    if (stack.length > 0) stack.at(-1)!.node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return roots;
}

interface Structure {
  roots: TagNode[];
  /** Whether the text of the tags could be laid next to the structure. */
  textRead: boolean;
}

/** Build the tag tree from the objects of the file, and hang the text of poppler in it when both trees have the same shape. */
export function buildStructure(objects: Dict, catalog: Dict, pageOf: Map<string, number>, structText: string | null): Structure {
  const get = (value: Json | undefined): Json | undefined => {
    if (!isRef(value)) return value;
    const entry = objects[`obj:${value}`];
    return isDict(entry) ? ((entry.value as Json | undefined) ?? (isDict(entry.stream) ? entry.stream.dict : undefined)) : undefined;
  };
  const root = get(catalog["/StructTreeRoot"]);
  if (!isDict(root)) return { roots: [], textRead: false };
  const roleMap = get(root["/RoleMap"]);
  const standard = (type: string): string => {
    let current = type;
    for (let hop = 0; hop < 8 && isDict(roleMap) && name(roleMap[`/${current}`]); hop++) current = name(roleMap[`/${current}`])!;
    return current;
  };
  const seen = new Set<string>();
  const attribute = (element: Dict, key: string): string | null => {
    const attributes = get(element["/A"]);
    for (const entry of Array.isArray(attributes) ? attributes : [attributes]) {
      const dict = get(entry);
      if (isDict(dict) && name(dict[key])) return name(dict[key]);
    }
    return null;
  };
  const build = (reference: Json | undefined, inheritedPage: number | null, depth: number): TagNode | null => {
    if (isRef(reference)) {
      if (seen.has(reference)) return null;
      seen.add(reference);
    }
    const element = get(reference);
    if (!isDict(element) || !name(element["/S"]) || depth > 200) return null;
    const page = (isRef(element["/Pg"]) ? pageOf.get(element["/Pg"]) : undefined) ?? inheritedPage;
    const node: TagNode = { type: standard(name(element["/S"])!), page, alt: text(element["/Alt"]), actualText: text(element["/ActualText"]), lang: text(element["/Lang"]), scope: attribute(element, "/Scope"), href: null, children: [] };
    const kids = get(element["/K"]);
    for (const kid of Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]) {
      const value = get(kid);
      if (!isDict(value)) continue;
      if (name(value["/Type"]) === "OBJR") {
        const action = get((get(value["/Obj"]) as Dict | undefined)?.["/A"]);
        if (isDict(action) && text(action["/URI"])) node.href = text(action["/URI"]);
        continue;
      }
      if (name(value["/Type"]) === "MCR") continue;
      const child = build(kid, page, depth + 1);
      if (child) node.children.push(child);
    }
    return node;
  };
  const top = get(root["/K"]);
  const roots = (Array.isArray(top) ? top : top === undefined ? [] : [top]).map((kid) => build(kid, null, 0)).filter((node): node is TagNode => node !== null);
  // A tag that groups others (a table, a list) names no page itself: it is on the page where its first part is.
  const settle = (node: TagNode): number | null => {
    let firstPage: number | null = null;
    for (const kid of node.children) {
      if (typeof kid === "string") continue;
      const page = settle(kid);
      firstPage ??= page;
    }
    node.page ??= firstPage;
    return node.page;
  };
  roots.forEach(settle);

  // The text: both trees list the same tags (same types) in the same order, or the text is left out.
  const ours = roots.flatMap((node) => [...walk(node)]);
  type Parsed = { type: string; children: (string | Parsed)[] };
  const theirs: Parsed[] = [];
  const flatten = (node: Parsed): void => {
    theirs.push(node);
    for (const child of node.children) if (typeof child !== "string") flatten(child);
  };
  if (structText !== null) for (const node of parseStructText(structText) as Parsed[]) flatten(node);
  if (ours.length === 0 || ours.length !== theirs.length || theirs.some((node, index) => node.type !== ours[index]!.type)) return { roots, textRead: false };
  const byParsed = new Map<Parsed, TagNode>(theirs.map((node, index) => [node, ours[index]!]));
  for (const [parsed, node] of byParsed) node.children = parsed.children.map((child) => (typeof child === "string" ? child : byParsed.get(child)!));
  return { roots, textRead: true };
}

/** The tag tree as indented text, one line per tag, for an agent to read a part of. */
export function tagTreeText(roots: TagNode[]): string {
  const lines: string[] = [];
  const print = (node: TagNode, depth: number): void => {
    const own = clean(node.children.filter((child): child is string => typeof child === "string").join(" "));
    const facts = [node.page !== null ? `p${node.page}` : null, node.alt !== null ? `alt="${clean(node.alt)}"` : null, node.actualText !== null ? `actualtext="${clean(node.actualText)}"` : null, node.lang ? `lang=${node.lang}` : null, node.scope ? `scope=${node.scope}` : null, node.href ? `href=${node.href}` : null].filter(Boolean);
    lines.push(`${"  ".repeat(depth)}${node.type}${facts.length > 0 ? ` [${facts.join(" ")}]` : ""}${own ? ` "${own.slice(0, 300)}"` : ""}`);
    for (const child of node.children) if (typeof child !== "string") print(child, depth + 1);
  };
  for (const root of roots) print(root, 0);
  return `${lines.join("\n")}\n`;
}

const words = (value: string): string[] => value.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * How the order of the tags compares with the order of the content of one page. An
 * approximation on words: it tells apart "the same", "the same words in another order" and "other words".
 */
export function compareOrder(byTags: string, byContent: string): string | null {
  const tags = words(byTags);
  const content = words(byContent);
  if (tags.length === 0 || content.length === 0) return null;
  const squeeze = (list: string[]): string => list.join("");
  if (squeeze(tags) === squeeze(content)) return "gelijk";
  let at = 0;
  for (const word of content) if (at < tags.length && word === tags[at]) at++;
  if (at === tags.length) return "gelijk; de inhoud heeft tekst die niet in de tags zit";
  if ([...tags].sort().join(" ") === [...content].sort().join(" ")) return "andere volgorde";
  return "verschilt";
}

export interface PdfMeasurement {
  facts: Pick<DocumentFacts, "title" | "language" | "pages" | "headings" | "images" | "tables" | "links" | "fields" | "notMeasuredNl"> & { pdf: PdfFacts };
  /** Text per page in the order of the content, then the text in the order of the tags. */
  text: string;
  tagTree: string | null;
}

const field = (output: string, label: string): string => new RegExp(`^${label}:\\s*(.*)$`, "m").exec(output)?.[1]?.trim() ?? "";

/** Render one page of a PDF as a PNG; null when poppler is missing or the page does not render. */
export async function renderPage(pdf: string, page: number, to: string, dpi = PREVIEW_DPI): Promise<string | null> {
  const prefix = to.replace(/\.png$/, "");
  const rendered = await tool("pdftoppm", ["-png", "-r", String(dpi), "-f", String(page), "-l", String(page), "-singlefile", pdf, prefix], TOOL_MS);
  return rendered.ok ? `${prefix}.png` : null;
}

/** Measure one PDF. Throws only when the file cannot be opened at all; the message is Dutch and goes into the facts. */
export async function measurePdf(pdf: string, scratch: string): Promise<PdfMeasurement> {
  const notMeasured: string[] = [];
  const info = await tool("pdfinfo", [pdf], TOOL_MS);
  if (info.found && !info.ok && /Incorrect password/i.test(info.output)) throw new Error("het bestand vraagt een wachtwoord om te openen");

  const jsonPath = join(scratch, "objects.json");
  const dumped = await tool("qpdf", ["--json", "--json-stream-data=none", pdf, jsonPath], TOOL_MS);
  if (!dumped.found && !info.found) throw new Error("qpdf en pdfinfo (poppler) zijn niet geïnstalleerd: het bestand is niet ingelezen");
  let parsed: Dict | null = null;
  // qpdf exits with 3 on a warning and still writes its answer.
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8")) as Dict;
  } catch {
    parsed = null;
  }
  await rm(jsonPath, { force: true });
  if (!dumped.found) notMeasured.push("qpdf is niet geïnstalleerd: tags, tekstalternatieven, formuliervelden, bladwijzers en versleuteling zijn niet gelezen.");
  else if (!parsed) {
    if (/password/i.test(dumped.output)) throw new Error("het bestand vraagt een wachtwoord om te openen");
    if (!info.ok) throw new Error(`het bestand is niet als pdf te lezen: ${dumped.output.trim().split("\n")[0]!.slice(0, 160)}`);
    notMeasured.push(`qpdf kon het bestand niet lezen: ${dumped.output.trim().split("\n")[0]!.slice(0, 160)}`);
  }
  if (!info.found) notMeasured.push("pdfinfo (poppler) is niet geïnstalleerd: de titel uit de metadata en de tekst per tag zijn niet gelezen.");

  const objects = (Array.isArray(parsed?.qpdf) && isDict(parsed.qpdf[1]) ? parsed.qpdf[1] : {}) as Dict;
  const deref = (value: Json | undefined): Json | undefined => (isRef(value) ? ((objects[`obj:${value}`] as Dict | undefined)?.value as Json | undefined) : value);
  const trailer = isDict(objects.trailer) ? (objects.trailer.value as Dict) : {};
  const catalog = (deref(trailer["/Root"]) as Dict | undefined) ?? {};
  const pagesJson = Array.isArray(parsed?.pages) ? (parsed.pages as Dict[]) : [];
  const pageOf = new Map<string, number>(pagesJson.map((page) => [String(page.object), Number(page.pageposfrom1)]));
  const pageCount = pagesJson.length || Number(field(info.output, "Pages")) || null;

  const structText = info.found ? await tool("pdfinfo", ["-struct-text", pdf], TOOL_MS) : null;
  const structure = buildStructure(objects, catalog, pageOf, structText?.ok ? structText.stdout : null);
  const all = structure.roots.flatMap((node) => [...walk(node)]);
  const markInfo = deref(catalog["/MarkInfo"]);
  const tagged = parsed ? isDict(markInfo) && markInfo["/Marked"] === true && all.length > 0 : field(info.output, "Tagged") === "yes";
  if (tagged && !structure.textRead) notMeasured.push("De tekst per tag is niet gelezen: de tagboom van poppler en die van qpdf hebben een andere vorm. Koppen, links en tabellen staan er zonder hun tekst.");

  const tags: Record<string, number> = {};
  for (const node of all) tags[node.type] = (tags[node.type] ?? 0) + 1;
  const infoDict = (deref(trailer["/Info"]) as Dict | undefined) ?? {};
  const title = field(info.output, "Title") || text(infoDict["/Title"]) || null;
  const language = text(catalog["/Lang"]);
  const viewer = deref(catalog["/ViewerPreferences"]);

  const headings: DocumentHeading[] = all.filter((node) => /^H[1-6]?$/.test(node.type)).map((node) => ({ level: node.type === "H" ? 0 : Number(node.type[1]), text: clean(tagText(node)), page: node.page }));
  const images: DocumentImage[] = all.filter((node) => node.type === "Figure" || node.type === "Formula").map((node) => ({ page: node.page, alt: node.alt ?? node.actualText, context: `${node.type}${clean(tagText(node)) ? `: ${clean(tagText(node)).slice(0, 80)}` : ""}` }));
  const imageObjects = pagesJson.reduce((sum, page) => sum + (Array.isArray(page.images) ? page.images.length : 0), 0);
  if (!tagged) for (const page of pagesJson) for (const _image of Array.isArray(page.images) ? page.images : []) images.push({ page: Number(page.pageposfrom1), alt: null, context: "afbeelding in de inhoud; het bestand heeft geen tags" });
  const tables: DocumentTable[] = all.filter((node) => node.type === "Table").map((node) => {
    const inside = [...walk(node)];
    const rows = inside.filter((entry) => entry.type === "TR");
    const headers = inside.filter((entry) => entry.type === "TH");
    return { page: node.page, rows: rows.length, headerCells: headers.length, hasHeader: headers.length > 0, firstRow: (rows[0]?.children ?? []).filter((cell): cell is TagNode => typeof cell !== "string").map((cell) => clean(tagText(cell)).slice(0, 60)) };
  });
  const { links, nested: nestedLinks } = linksOf(structure.roots);
  let linkAnnotations = 0;
  for (const page of pagesJson) {
    const annotations = deref((deref(String(page.object)) as Dict | undefined)?.["/Annots"]);
    for (const annotation of Array.isArray(annotations) ? annotations : []) if (name((deref(annotation) as Dict | undefined)?.["/Subtype"]) === "Link") linkAnnotations++;
  }
  const acroform = isDict(parsed?.acroform) && Array.isArray(parsed.acroform.fields) ? (parsed.acroform.fields as Dict[]) : [];
  const fields = acroform
    .filter((entry) => name(entry.fieldtype) !== null && !Array.isArray(entry.kids))
    .map((entry) => ({ page: typeof entry.pageposfrom1 === "number" ? entry.pageposfrom1 : null, type: name(entry.fieldtype) ?? "?", name: text((deref(String(entry.object)) as Dict | undefined)?.["/TU"]) ?? text((deref(String(entry.parent)) as Dict | undefined)?.["/TU"]), id: String(entry.fullname ?? entry.partialname ?? "") }));
  const outlineTitles: string[] = [];
  const outline = (items: Json | undefined): void => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!isDict(item)) continue;
      outlineTitles.push(String(item.title ?? ""));
      outline(item.kids);
    }
  };
  outline(parsed?.outlines);
  const encrypt = isDict(parsed?.encrypt) ? parsed.encrypt : null;
  const capabilities = encrypt && isDict(encrypt.capabilities) ? encrypt.capabilities : null;

  // Text per page in the order of the content, and whether a page is only a picture of text.
  const raw = await tool("pdftotext", ["-raw", pdf, "-"], TOOL_MS);
  if (!raw.found) notMeasured.push("pdftotext (poppler) is niet geïnstalleerd: de tekst per pagina is niet gelezen, dus ook niet of een pagina alleen een scan is.");
  const contentPages = raw.ok ? raw.stdout.split("\f").slice(0, pageCount ?? undefined) : [];
  const tagPages = new Map<number, string[]>();
  const collect = (node: TagNode): void => {
    for (const child of node.children) {
      if (typeof child !== "string") collect(child);
      else if (node.page !== null) tagPages.set(node.page, [...(tagPages.get(node.page) ?? []), child]);
    }
  };
  if (structure.textRead) structure.roots.forEach(collect);
  const pageText: PdfFacts["pageText"] = contentPages.map((content, index) => ({ page: index + 1, characters: content.replace(/\s+/g, "").length, recognisedWords: null, scanOnly: null, order: structure.textRead ? compareOrder((tagPages.get(index + 1) ?? []).join(" "), content) : null }));
  let scanNotChecked: string | null = null;
  const empty = pageText.filter((page) => page.characters < NO_TEXT_BELOW);
  for (const page of empty.slice(0, MAX_SCAN_PAGES)) {
    if (scanNotChecked) break;
    const picture = await renderPage(pdf, page.page, join(scratch, `scan-${page.page}.png`), 150);
    if (!picture) {
      scanNotChecked = "pdftoppm (poppler) kon de pagina niet als beeld maken; of pagina's zonder tekst een scan zijn, is niet nagegaan";
      break;
    }
    try {
      const recognised = await ocr(picture);
      page.recognisedWords = recognised.words;
      page.scanOnly = recognised.hasText;
    } catch (error) {
      scanNotChecked = `tekstherkenning is niet beschikbaar (${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 140)}); of pagina's zonder tekst een scan zijn, is niet nagegaan`;
    }
    await rm(picture, { force: true });
  }
  if (!scanNotChecked && empty.length > MAX_SCAN_PAGES) scanNotChecked = `${empty.length} pagina's hebben geen tekst; op de eerste ${MAX_SCAN_PAGES} is tekstherkenning gedaan, op de rest niet`;
  if (scanNotChecked) notMeasured.push(scanNotChecked);

  const ua = await pdfUa(pdf, VERAPDF_MS);
  if (!ua.available) notMeasured.push(ua.reasonNl!);

  const textParts = contentPages.map((content, index) => `=== pagina ${index + 1}, volgorde van de inhoud ===\n${content.trim()}\n`);
  if (structure.textRead) for (const page of [...tagPages.keys()].sort((a, b) => a - b)) textParts.push(`=== pagina ${page}, volgorde van de tags ===\n${tagPages.get(page)!.map(clean).filter(Boolean).join("\n")}\n`);
  const alternatives = images.filter((image) => image.alt).map((image) => image.alt!);
  if (alternatives.length > 0) textParts.push(`=== tekstalternatieven ===\n${alternatives.join("\n")}\n`);

  const cap = <T>(items: T[]): T[] => items.slice(0, MAX_ITEMS);
  return {
    facts: {
      title,
      language,
      pages: pageCount,
      headings: cap(headings),
      images: cap(images),
      tables: cap(tables),
      links: cap(links),
      fields: cap(fields),
      notMeasuredNl: notMeasured,
      pdf: {
        tagged,
        displayDocTitle: isDict(viewer) && viewer["/DisplayDocTitle"] === true,
        pdfVersion: field(info.output, "PDF version") || null,
        producer: field(info.output, "Producer") || field(info.output, "Creator") || null,
        pdfUa: ua,
        bookmarks: { count: outlineTitles.length, titles: outlineTitles.slice(0, 40) },
        tags,
        tagTextRead: structure.textRead,
        encryption: { encrypted: encrypt ? encrypt.encrypted === true : /^yes/.test(field(info.output, "Encrypted")), accessibilityAllowed: capabilities ? capabilities.accessibility !== false : true },
        pageText,
        scanPages: pageText.filter((page) => page.scanOnly === true).map((page) => page.page),
        scanNotCheckedNl: scanNotChecked,
        languageParts: cap(all.filter((node) => node.lang && node.lang !== language).map((node) => ({ lang: node.lang!, text: clean(tagText(node)).slice(0, 160), page: node.page }))),
        lists: tags.L ?? 0,
        imageObjects,
        linkAnnotations,
        nestedLinks,
        counts: { headings: headings.length, images: images.length, tables: tables.length, links: links.length, fields: fields.length },
      },
    },
    text: textParts.join("\n"),
    tagTree: structure.roots.length > 0 ? tagTreeText(structure.roots) : null,
  };
}
