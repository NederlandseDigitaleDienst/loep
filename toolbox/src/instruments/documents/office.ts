import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import type { DocumentFacts, DocumentHeading, DocumentImage, DocumentKind, DocumentLink, DocumentTable, OfficeFacts } from "../../lib/documents.ts";
import { allText, child, childrenNamed, descendants, elements, first, openZip, parseXml, type XmlNode, type Zip } from "./zipxml.ts";

/**
 * What can be read from the XML of an office file: OOXML (docx, pptx, xlsx) and ODF (odt,
 * odp, ods). It reads what the author put in the file. How a program shows the file to
 * assistive technology is not measured: no office suite is started.
 */

export interface OfficeMeasurement {
  facts: Pick<DocumentFacts, "title" | "language" | "pages" | "headings" | "images" | "tables" | "links" | "fields" | "notMeasuredNl"> & { office: OfficeFacts };
  text: string;
}

const MAX_ITEMS = 400;
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
/** A paragraph that starts like a list item somebody typed by hand. */
const TYPED_ITEM = /^(?:[-\u2013\u2014•*·▪■○●]|\d{1,2}[.)]|[a-z][.)])\s+\S/;
/** A paragraph that is short, wholly bold and no sentence: it looks like a heading. */
const looksLikeHeading = (text: string): boolean => text.length >= 2 && text.length <= 100 && !/[.,;]$/.test(text);
const on = (node: XmlNode | undefined, attribute = "w:val"): boolean => node !== undefined && !["0", "false", "off"].includes(node.attrs[attribute] ?? "1");

function relations(zip: Zip, part: string): Map<string, string> {
  const rels = zip.text(posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`));
  const map = new Map<string, string>();
  if (!rels) return map;
  for (const relation of descendants(parseXml(rels), ["Relationship"])) {
    const target = relation.attrs.Target ?? "";
    map.set(relation.attrs.Id ?? "", relation.attrs.TargetMode === "External" ? target : target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(part), target));
  }
  return map;
}

function coreProperties(zip: Zip): { title: string | null; language: string | null } {
  const core = zip.text("docProps/core.xml");
  if (!core) return { title: null, language: null };
  const root = parseXml(core);
  return { title: clean(allText(first(root, "dc:title") ?? "")) || null, language: clean(allText(first(root, "dc:language") ?? "")) || null };
}

const decorative = (node: XmlNode): boolean => [...descendants(node, ["adec:decorative"])].some((entry) => entry.attrs.val === "1");
/** The text alternative of a picture in OOXML: the description, as every program writes and reads it. */
const ooxmlAlt = (properties: XmlNode | undefined): string | null => clean(properties?.attrs.descr ?? "") || null;

interface Collected {
  headings: DocumentHeading[];
  images: DocumentImage[];
  tables: DocumentTable[];
  links: DocumentLink[];
  office: OfficeFacts;
  text: string[];
  notMeasured: string[];
}

const collected = (): Collected => ({ headings: [], images: [], tables: [], links: [], office: { fakeHeadings: [], lists: { real: 0, typed: 0 }, languageParts: [] }, text: [], notMeasured: [] });

// ------------------------------------------------------------------------------- docx

function measureDocx(zip: Zip): { out: Collected; language: string | null; pages: number | null } {
  const out = collected();
  const source = zip.text("word/document.xml");
  if (!source) throw new Error("het bestand heeft geen word/document.xml en is geen Word-document");
  const body = first(parseXml(source), "w:body");
  if (!body) throw new Error("het Word-document heeft geen inhoud");
  const rels = relations(zip, "word/document.xml");
  const styles = new Map<string, { name: string; outline: number | null; basedOn: string | null; bold: boolean }>();
  let language: string | null = null;
  const stylesXml = zip.text("word/styles.xml");
  if (stylesXml) {
    const root = parseXml(stylesXml);
    language = first(first(root, "w:docDefaults"), "w:lang")?.attrs["w:val"] ?? null;
    for (const style of descendants(root, ["w:style"])) {
      const level = first(style, "w:outlineLvl")?.attrs["w:val"];
      styles.set(style.attrs["w:styleId"] ?? "", { name: child(style, "w:name")?.attrs["w:val"] ?? "", outline: level !== undefined ? Number(level) : null, basedOn: child(style, "w:basedOn")?.attrs["w:val"] ?? null, bold: on(child(child(style, "w:rPr"), "w:b")) });
    }
  }
  const styleLevel = (id: string | undefined): number | null => {
    for (let hop = 0, current = id; hop < 10 && current; hop++) {
      const style = styles.get(current);
      if (!style) {
        const named = /^(?:heading|kop)\s*(\d)$/i.exec(current);
        return named ? Number(named[1]) : null;
      }
      if (style.outline !== null && style.outline < 9) return style.outline + 1;
      const named = /^(?:heading|kop)\s*(\d)$/i.exec(style.name);
      if (named) return Number(named[1]);
      current = style.basedOn ?? undefined;
    }
    return null;
  };
  const styleBold = (id: string | undefined): boolean => {
    for (let hop = 0, current = id; hop < 10 && current; hop++) {
      const style = styles.get(current);
      if (!style) return false;
      if (style.bold) return true;
      current = style.basedOn ?? undefined;
    }
    return false;
  };
  const runText = (node: XmlNode): string => [...descendants(node, ["w:t", "w:tab", "w:br"])].map((entry) => (entry.name === "w:t" ? allText(entry) : " ")).join("");
  const otherLanguage = new Map<string, string[]>();
  let lastText = "";

  const paragraph = (node: XmlNode, inTable: boolean): void => {
    const properties = child(node, "w:pPr");
    const styleId = child(properties, "w:pStyle")?.attrs["w:val"];
    const text = clean(runText(node));
    const own = child(properties, "w:outlineLvl")?.attrs["w:val"];
    const level = own !== undefined && Number(own) < 9 ? Number(own) + 1 : styleLevel(styleId);
    const numbering = child(properties, "w:numPr");
    const listed = numbering !== undefined && child(numbering, "w:numId")?.attrs["w:val"] !== "0";
    for (const drawing of descendants(node, ["w:drawing"])) {
      const properties = first(drawing, "wp:docPr");
      out.images.push({ page: null, alt: ooxmlAlt(properties), ...(decorative(drawing) ? { decorative: true } : {}), context: clean(`${properties?.attrs.name ?? "afbeelding"}${text || lastText ? `, bij: ${(text || lastText).slice(0, 80)}` : ""}`) });
    }
    for (const shape of descendants(node, ["v:shape"])) if (first(shape, "v:imagedata")) out.images.push({ page: null, alt: clean(shape.attrs.alt ?? "") || null, context: `afbeelding (oude vorm)${text || lastText ? `, bij: ${(text || lastText).slice(0, 80)}` : ""}` });
    for (const link of descendants(node, ["w:hyperlink"])) out.links.push({ page: null, text: clean(runText(link)), href: link.attrs["r:id"] ? (rels.get(link.attrs["r:id"]) ?? null) : link.attrs["w:anchor"] ? `#${link.attrs["w:anchor"]}` : null });
    for (const run of descendants(node, ["w:r"])) {
      const lang = child(child(run, "w:rPr"), "w:lang")?.attrs["w:val"];
      const said = clean(runText(run));
      if (lang && said && language && lang.split("-")[0] !== language.split("-")[0]) otherLanguage.set(lang, [...(otherLanguage.get(lang) ?? []), said]);
    }
    if (!text) return;
    lastText = text;
    if (level !== null) {
      out.headings.push({ level, text, page: null });
      out.text.push(`${"#".repeat(level)} ${text}`);
      return;
    }
    out.text.push(listed ? `- ${text}` : text);
    if (listed) out.office.lists.real++;
    else if (TYPED_ITEM.test(text)) out.office.lists.typed++;
    if (inTable || listed || !looksLikeHeading(text)) return;
    const runs = [...descendants(node, ["w:r"])].filter((run) => clean(runText(run)) !== "");
    if (runs.length > 0 && (styleBold(styleId) || runs.every((run) => on(child(child(run, "w:rPr"), "w:b")) || styleBold(child(child(run, "w:rPr"), "w:rStyle")?.attrs["w:val"])))) out.office.fakeHeadings.push({ text, page: null });
  };
  const table = (node: XmlNode): void => {
    const rows = childrenNamed(node, "w:tr");
    const cells = (row: XmlNode | undefined): string[] => childrenNamed(row, "w:tc").map((cell) => clean(runText(cell)).slice(0, 60));
    const header = rows.filter((row) => on(child(child(row, "w:trPr"), "w:tblHeader")));
    out.tables.push({ page: null, rows: rows.length, headerCells: header.reduce((sum, row) => sum + childrenNamed(row, "w:tc").length, 0), hasHeader: header.length > 0, firstRow: cells(rows[0]) });
    for (const row of rows) for (const cell of childrenNamed(row, "w:tc")) blocks(cell, true);
  };
  const blocks = (node: XmlNode, inTable: boolean): void => {
    for (const entry of elements(node)) {
      if (entry.name === "w:p") paragraph(entry, inTable);
      else if (entry.name === "w:tbl") table(entry);
      else if (entry.name === "w:sdt" || entry.name === "w:sdtContent" || entry.name === "w:ins" || entry.name === "w:customXml") blocks(entry, inTable);
    }
  };
  blocks(body, false);
  for (const [lang, parts] of otherLanguage) out.office.languageParts.push({ lang, text: clean(parts.join(" ")).slice(0, 160) });
  const app = zip.text("docProps/app.xml");
  const pages = app ? Number(allText(first(parseXml(app), "Pages") ?? "")) || null : null;
  if ([...descendants(body, ["w:instrText"])].some((code) => /HYPERLINK/.test(allText(code)))) out.notMeasured.push("Het document heeft links die als veldcode zijn opgeslagen; die staan niet in de lijst met links.");
  return { out, language, pages };
}

// ------------------------------------------------------------------------------- pptx

function measurePptx(zip: Zip): { out: Collected; language: string | null; pages: number | null } {
  const out = collected();
  const source = zip.text("ppt/presentation.xml");
  if (!source) throw new Error("het bestand heeft geen ppt/presentation.xml en is geen PowerPoint-presentatie");
  const rels = relations(zip, "ppt/presentation.xml");
  const slideParts = [...descendants(parseXml(source), ["p:sldId"])].map((entry) => rels.get(entry.attrs["r:id"] ?? "")).filter((part): part is string => !!part);
  const languages = new Map<string, number>();
  out.office.slides = [];
  const paragraphs = (node: XmlNode): string[] => [...descendants(node, ["a:p"])].map((entry) => clean([...descendants(entry, ["a:t", "a:br"])].map((part) => (part.name === "a:t" ? allText(part) : " ")).join(""))).filter(Boolean);
  slideParts.forEach((part, index) => {
    const slide = index + 1;
    const xml = zip.text(part);
    if (!xml) return;
    const root = parseXml(xml);
    const slideRels = relations(zip, part);
    let title: string | null = null;
    const order: string[] = [];
    const shapes = (tree: XmlNode | undefined): void => {
      for (const shape of tree ? elements(tree) : []) {
        if (shape.name === "p:grpSp") shapes(shape);
        else if (shape.name === "p:sp") {
          const text = paragraphs(shape).join(" / ");
          const placeholder = first(child(shape, "p:nvSpPr"), "p:ph")?.attrs.type;
          if ((placeholder === "title" || placeholder === "ctrTitle") && title === null) title = text || "";
          if (text) order.push(text.slice(0, 200));
          for (const entry of paragraphs(shape)) if (TYPED_ITEM.test(entry)) out.office.lists.typed++;
          out.office.lists.real += [...descendants(shape, ["a:buChar", "a:buAutoNum"])].length;
        } else if (shape.name === "p:pic") {
          const properties = first(child(shape, "p:nvPicPr"), "p:cNvPr");
          out.images.push({ page: slide, alt: ooxmlAlt(properties), ...(decorative(shape) ? { decorative: true } : {}), context: properties?.attrs.name ?? "afbeelding" });
          order.push(`[afbeelding: ${ooxmlAlt(properties) ?? "geen tekstalternatief"}]`);
        } else if (shape.name === "p:graphicFrame") {
          for (const grid of descendants(shape, ["a:tbl"])) {
            const rows = childrenNamed(grid, "a:tr");
            const header = child(grid, "a:tblPr")?.attrs.firstRow === "1";
            const firstRow = childrenNamed(rows[0], "a:tc").map((cell) => paragraphs(cell).join(" ").slice(0, 60));
            out.tables.push({ page: slide, rows: rows.length, headerCells: header ? firstRow.length : 0, hasHeader: header, firstRow });
            order.push(`[tabel: ${firstRow.join(" | ")}]`);
          }
        }
      }
    };
    shapes(first(root, "p:spTree"));
    for (const run of descendants(root, ["a:r"])) {
      const properties = child(run, "a:rPr");
      if (properties?.attrs.lang) languages.set(properties.attrs.lang, (languages.get(properties.attrs.lang) ?? 0) + allText(run).length);
      const link = child(properties, "a:hlinkClick");
      if (link) out.links.push({ page: slide, text: clean(allText(child(run, "a:t") ?? "")), href: slideRels.get(link.attrs["r:id"] ?? "") ?? null });
    }
    const slideTitle = title as string | null;
    out.office.slides!.push({ slide, title: slideTitle ? slideTitle : null, readingOrder: order });
    out.text.push(`=== dia ${slide} ===`, ...order, "");
  });
  const ranked = [...languages.entries()].sort((a, b) => b[1] - a[1]);
  for (const [lang] of ranked.slice(1)) out.office.languageParts.push({ lang, text: "tekst op een of meer dia's" });
  return { out, language: ranked[0]?.[0] ?? null, pages: slideParts.length };
}

// ------------------------------------------------------------------------------- xlsx

function measureXlsx(zip: Zip): { out: Collected; language: string | null; pages: number | null } {
  const out = collected();
  const source = zip.text("xl/workbook.xml");
  if (!source) throw new Error("het bestand heeft geen xl/workbook.xml en is geen Excel-werkmap");
  const rels = relations(zip, "xl/workbook.xml");
  const sharedXml = zip.text("xl/sharedStrings.xml");
  const shared = sharedXml ? [...descendants(parseXml(sharedXml), ["si"])].map((item) => clean([...descendants(item, ["t"], ["rPh"])].map(allText).join(""))) : [];
  out.office.sheets = [];
  [...descendants(parseXml(source), ["sheet"])].forEach((sheet, index) => {
    const part = rels.get(sheet.attrs["r:id"] ?? "");
    const xml = part ? zip.text(part) : null;
    // A sheet can be very large; only its first filled row and its links are read.
    const row = xml ? /<row\b[^>]*>(?:(?!<\/row>)[\s\S])*?<c\b[\s\S]*?<\/row>/.exec(xml)?.[0] : undefined;
    const firstRow = row
      ? [...descendants(parseXml(row), ["c"])].map((cell) => {
          const value = allText(child(cell, "v") ?? "");
          return clean(cell.attrs.t === "s" ? (shared[Number(value)] ?? "") : cell.attrs.t === "inlineStr" ? allText(child(cell, "is") ?? "") : value).slice(0, 60);
        })
      : [];
    const sheetRels = part ? relations(zip, part) : new Map<string, string>();
    let headerRowDefined = false;
    for (const target of sheetRels.values()) {
      if (/\/tables\//.test(target)) {
        const definition = first(parseXml(zip.text(target) ?? ""), "table");
        if (!definition) continue;
        const hasHeader = definition.attrs.headerRowCount !== "0";
        headerRowDefined ||= hasHeader;
        const columns = [...descendants(definition, ["tableColumn"])].map((column) => column.attrs.name ?? "");
        const span = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(definition.attrs.ref ?? "");
        out.tables.push({ page: index + 1, rows: span ? Number(span[2]) - Number(span[1]) + 1 : null, headerCells: hasHeader ? columns.length : 0, hasHeader, firstRow: columns.map((column) => column.slice(0, 60)) });
      } else if (/\/drawings\//.test(target)) {
        for (const picture of descendants(parseXml(zip.text(target) ?? ""), ["xdr:pic"])) {
          const properties = first(picture, "xdr:cNvPr");
          out.images.push({ page: index + 1, alt: ooxmlAlt(properties), ...(decorative(picture) ? { decorative: true } : {}), context: `${properties?.attrs.name ?? "afbeelding"} op blad ${sheet.attrs.name ?? index + 1}` });
        }
      }
    }
    const links = xml ? /<hyperlinks>[\s\S]*?<\/hyperlinks>/.exec(xml)?.[0] : undefined;
    for (const link of links ? descendants(parseXml(links), ["hyperlink"]) : []) out.links.push({ page: index + 1, text: clean(link.attrs.display ?? link.attrs.ref ?? ""), href: link.attrs["r:id"] ? (sheetRels.get(link.attrs["r:id"]) ?? null) : link.attrs.location ? `#${link.attrs.location}` : null });
    out.office.sheets!.push({ name: sheet.attrs.name ?? "", firstRow, headerRowDefined });
    out.text.push(`=== blad ${index + 1}: ${sheet.attrs.name ?? ""} ===`, firstRow.join(" | "), "");
  });
  out.notMeasured.push("Van een rekenblad zijn de namen van de bladen, de eerste gevulde rij, de gedefinieerde tabellen, de afbeeldingen en de links gelezen. De cellen zelf, samengevoegde cellen en grafieken zijn niet gelezen. Een xlsx-bestand legt geen taal vast.");
  return { out, language: null, pages: out.office.sheets.length };
}

// -------------------------------------------------------------------------------- odf

function measureOdf(zip: Zip, kind: "odt" | "odp" | "ods"): { out: Collected; language: string | null; pages: number | null; title: string | null } {
  const out = collected();
  const source = zip.text("content.xml");
  if (!source) throw new Error("het bestand heeft geen content.xml en is geen OpenDocument-bestand");
  const root = parseXml(source);
  const body = child(first(root, "office:body"), kind === "odt" ? "office:text" : kind === "odp" ? "office:presentation" : "office:spreadsheet");
  if (!body) throw new Error("het OpenDocument-bestand heeft geen inhoud van de soort die de naam belooft");
  const stylesRoot = parseXml(zip.text("styles.xml") ?? "");
  const metaRoot = parseXml(zip.text("meta.xml") ?? "");
  const bold = new Set<string>();
  const languageOf = new Map<string, string>();
  for (const style of [...descendants(root, ["style:style"]), ...descendants(stylesRoot, ["style:style"])]) {
    const properties = child(style, "style:text-properties");
    if (/^(bold|[6-9]00)$/.test(properties?.attrs["fo:font-weight"] ?? "")) bold.add(style.attrs["style:name"] ?? "");
    if (properties?.attrs["fo:language"] && properties.attrs["fo:language"] !== "zxx") languageOf.set(style.attrs["style:name"] ?? "", properties.attrs["fo:language"]);
  }
  const defaults = [...descendants(stylesRoot, ["style:default-style"])].find((style) => style.attrs["style:family"] === "paragraph");
  const defaultLanguage = child(defaults, "style:text-properties")?.attrs["fo:language"];
  const language = clean(allText(first(metaRoot, "dc:language") ?? "")) || (defaultLanguage && defaultLanguage !== "zxx" ? `${defaultLanguage}${child(defaults, "style:text-properties")?.attrs["fo:country"] ? `-${child(defaults, "style:text-properties")!.attrs["fo:country"]}` : ""}` : null);
  const title = clean(allText(first(metaRoot, "dc:title") ?? "")) || null;
  const inline = (node: XmlNode | string): string => (typeof node === "string" ? node : node.name === "text:s" || node.name === "text:tab" || node.name === "text:line-break" ? " " : node.name === "draw:frame" || node.name === "text:note" ? "" : node.children.map(inline).join(""));
  const otherLanguage = new Map<string, string[]>();
  let page: number | null = null;
  let lastText = "";

  const image = (frame: XmlNode, text: string): void => {
    if (!child(frame, "draw:image")) return;
    const alt = clean(allText(child(frame, "svg:desc") ?? "")) || clean(allText(child(frame, "svg:title") ?? "")) || null;
    out.images.push({ page, alt, ...(frame.attrs["loext:decorative"] === "true" ? { decorative: true } : {}), context: clean(`${frame.attrs["draw:name"] ?? "afbeelding"}${text ? `, bij: ${text.slice(0, 80)}` : ""}`) });
  };
  const paragraph = (node: XmlNode, inTable: boolean, inList: boolean): string => {
    const text = clean(inline(node));
    for (const frame of descendants(node, ["draw:frame"])) image(frame, text || lastText);
    for (const link of descendants(node, ["text:a"])) out.links.push({ page, text: clean(inline(link)), href: link.attrs["xlink:href"] ?? null });
    for (const span of descendants(node, ["text:span"])) {
      const lang = languageOf.get(span.attrs["text:style-name"] ?? "");
      if (lang && language && lang !== language.split("-")[0] && clean(inline(span))) otherLanguage.set(lang, [...(otherLanguage.get(lang) ?? []), clean(inline(span))]);
    }
    if (!text) return "";
    lastText = text;
    if (node.name === "text:h") {
      const level = Number(node.attrs["text:outline-level"] ?? "1") || 1;
      out.headings.push({ level, text, page });
      out.text.push(`${"#".repeat(Math.min(level, 6))} ${text}`);
      return text;
    }
    out.text.push(inList ? `- ${text}` : text);
    if (!inList && TYPED_ITEM.test(text)) out.office.lists.typed++;
    if (kind !== "odt" || inTable || inList || !looksLikeHeading(text)) return text;
    const parts = node.children.filter((part) => clean(inline(part)) !== "");
    if (bold.has(node.attrs["text:style-name"] ?? "") || (parts.length > 0 && parts.every((part) => typeof part !== "string" && part.name === "text:span" && bold.has(part.attrs["text:style-name"] ?? "")))) out.office.fakeHeadings.push({ text, page });
    return text;
  };
  const table = (node: XmlNode): void => {
    const rows = [...descendants(node, ["table:table-row"], ["table:table"])];
    const header = [...descendants(child(node, "table:table-header-rows") ?? { name: "", attrs: {}, children: [] }, ["table:table-cell"], ["table:table"])];
    const cells = (row: XmlNode | undefined): string[] => childrenNamed(row, "table:table-cell").map((cell) => clean(inline(cell)).slice(0, 60));
    out.tables.push({ page, rows: rows.length, headerCells: header.length, hasHeader: header.length > 0, firstRow: cells(rows[0]) });
    for (const row of rows) for (const cell of childrenNamed(row, "table:table-cell")) blocks(cell, true, false);
  };
  const blocks = (node: XmlNode, inTable: boolean, inList: boolean): string[] => {
    const texts: string[] = [];
    for (const entry of elements(node)) {
      if (entry.name === "text:p" || entry.name === "text:h") texts.push(paragraph(entry, inTable, inList));
      else if (entry.name === "table:table") table(entry);
      else if (entry.name === "text:list") {
        if (!inList) out.office.lists.real++;
        texts.push(...blocks(entry, inTable, true));
      } else if (entry.name === "draw:frame") {
        image(entry, lastText);
        texts.push(...blocks(entry, inTable, inList));
      } else if (["text:list-item", "text:list-header", "text:section", "draw:text-box", "draw:g", "draw:custom-shape", "text:table-of-content", "text:index-body"].includes(entry.name)) texts.push(...blocks(entry, inTable, inList));
    }
    return texts.filter(Boolean);
  };

  if (kind === "odt") blocks(body, false, false);
  else if (kind === "odp") {
    out.office.slides = [];
    childrenNamed(body, "draw:page").forEach((slide, index) => {
      page = index + 1;
      out.text.push(`=== dia ${page} ===`);
      let title: string | null = null;
      const order: string[] = [];
      for (const shape of elements(slide)) {
        if (shape.name === "presentation:notes") continue;
        const before = out.images.length;
        const texts = shape.name === "draw:frame" ? (image(shape, lastText), blocks(shape, false, false)) : blocks(shape, false, false);
        if (shape.attrs["presentation:class"] === "title" && title === null) title = texts.join(" ");
        if (texts.length > 0) order.push(texts.join(" / ").slice(0, 200));
        for (const picture of out.images.slice(before)) order.push(`[afbeelding: ${picture.alt ?? "geen tekstalternatief"}]`);
      }
      const slideTitle = title as string | null;
      out.office.slides!.push({ slide: page, title: slideTitle ? slideTitle : null, readingOrder: order });
      out.text.push("");
    });
  } else {
    out.office.sheets = [];
    const ranges = [...descendants(root, ["table:database-range"])].filter((range) => range.attrs["table:contains-header"] !== "false").map((range) => range.attrs["table:target-range-address"] ?? "");
    childrenNamed(body, "table:table").forEach((sheet, index) => {
      page = index + 1;
      const name = sheet.attrs["table:name"] ?? "";
      const rows = [...descendants(sheet, ["table:table-row"], ["table:table"])];
      const filled = rows.find((row) => childrenNamed(row, "table:table-cell").some((cell) => clean(inline(cell)) !== ""));
      const firstRow = childrenNamed(filled, "table:table-cell").map((cell) => clean(inline(cell)).slice(0, 60));
      while (firstRow.length > 0 && firstRow.at(-1) === "") firstRow.pop();
      for (const frame of descendants(sheet, ["draw:frame"])) image(frame, `blad ${name}`);
      for (const link of descendants(sheet, ["text:a"])) out.links.push({ page, text: clean(inline(link)), href: link.attrs["xlink:href"] ?? null });
      out.office.sheets!.push({ name, firstRow, headerRowDefined: child(sheet, "table:table-header-rows") !== undefined || ranges.some((range) => range.replace(/^\$?'?/, "").startsWith(name)) });
      out.text.push(`=== blad ${page}: ${name} ===`, firstRow.join(" | "), "");
    });
    out.notMeasured.push("Van een rekenblad zijn de namen van de bladen, de eerste gevulde rij, de afbeeldingen en de links gelezen. De cellen zelf, samengevoegde cellen en grafieken zijn niet gelezen.");
  }
  for (const [lang, parts] of otherLanguage) out.office.languageParts.push({ lang, text: clean(parts.join(" ")).slice(0, 160) });
  const statistic = first(metaRoot, "meta:document-statistic");
  const pages = kind === "odt" ? Number(statistic?.attrs["meta:page-count"]) || null : kind === "odp" ? (out.office.slides?.length ?? null) : (out.office.sheets?.length ?? null);
  return { out, language, pages, title };
}

/** Measure one office file. Throws when the file cannot be opened; the message is Dutch and goes into the facts. */
export async function measureOffice(file: string, kind: DocumentKind): Promise<OfficeMeasurement> {
  const zip = openZip(await readFile(file));
  const core = coreProperties(zip);
  const measured = kind === "docx" ? measureDocx(zip) : kind === "pptx" ? measurePptx(zip) : kind === "xlsx" ? measureXlsx(zip) : kind === "odt" || kind === "odp" || kind === "ods" ? measureOdf(zip, kind) : null;
  if (!measured) throw new Error(`de soort ${kind} wordt niet ingelezen`);
  const { out } = measured;
  const cap = <T>(items: T[]): T[] => items.slice(0, MAX_ITEMS);
  const alternatives = out.images.filter((image) => image.alt).map((image) => image.alt!);
  out.notMeasured.push("Gelezen is wat in het bestand staat. Hoe een kantoorpakket het aan hulpsoftware geeft, en hoe het eruitziet, is niet gemeten: er is geen kantoorpakket gebruikt en er is geen beeld van het document.");
  return {
    facts: {
      title: ((measured as { title?: string | null }).title ?? null) ?? core.title,
      language: measured.language ?? core.language,
      pages: measured.pages,
      headings: cap(out.headings),
      images: cap(out.images),
      tables: cap(out.tables),
      links: cap(out.links),
      fields: [],
      notMeasuredNl: out.notMeasured,
      office: { ...out.office, fakeHeadings: cap(out.office.fakeHeadings) },
    },
    text: `${out.text.join("\n")}\n${alternatives.length > 0 ? `\n=== tekstalternatieven ===\n${alternatives.join("\n")}\n` : ""}`,
  };
}
