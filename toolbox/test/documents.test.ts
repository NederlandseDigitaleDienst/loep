import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { documents as measureDocuments } from "../src/commands/documents.ts";
import { inventory, type Inventory } from "../src/commands/inventory.ts";
import { buildSample, chooseDocuments, DOCUMENT_CENSUS_LIMIT, withDocuments } from "../src/commands/sample.ts";
import { measureOffice } from "../src/instruments/documents/office.ts";
import { compareOrder, measurePdf, parseStructText } from "../src/instruments/documents/pdf.ts";
import { readMarkdown } from "../src/instruments/documents/text.ts";
import { openZip, parseXml } from "../src/instruments/documents/zipxml.ts";
import { readJson, writeJson } from "../src/lib/canonical.ts";
import { documents as documentsExtractor } from "../src/lib/document-evidence.ts";
import { render } from "../src/commands/render.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { documentKind, documentScopeNl, kindOfContentType, loadDocuments, type DocumentFacts, type EvaluationDocuments, type InventoryDocument } from "../src/lib/documents.ts";
import { deriveReport, renderMarkdown } from "../src/lib/report-markdown.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { buildDossier } from "../src/lib/dossier.ts";
import { legend } from "../src/lib/extractors.ts";
import { loadProcedure } from "../src/lib/procedures.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { indexObservations } from "../src/lib/verdict.ts";
import { Daemon } from "../src/session/daemon.ts";
import { documentOutcome, sectionsOf, tagsOfPage } from "../src/session/document-command.ts";
import { Images } from "../src/session/observations.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/documents/", import.meta.url));

const has = (program: string, ...args: string[]): boolean => {
  try {
    execFileSync(program, args, { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
};
const POPPLER = has("pdfinfo", "-v") && has("pdftotext", "-v") && has("pdftoppm", "-v");
const QPDF = has("qpdf", "--version");
const TESSERACT = has("tesseract", "--version");
const NEEDS_PDF_TOOLS = POPPLER && QPDF ? false : "qpdf or poppler is not installed";

/** A zip archive with every part stored as it is: enough for an office file in a test. */
function zip(parts: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = Buffer.from(content, "utf8");
    const file = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(file.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, file, data);
    central.push(entry, file);
    offset += 30 + file.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CORE = (title: string): string => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>${title}</dc:title></cp:coreProperties>`;
const drawing = (name: string, descr: string | null): string => `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="${name}"${descr === null ? "" : ` descr="${descr}"`}/></wp:inline></w:drawing></w:r>`;

/** A Word document with real headings, a described picture, a table with a header row, a real list and a link. */
const GOOD_DOCX = zip({
  "docProps/core.xml": CORE("Beleidsnota parkeren"),
  "word/styles.xml": `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="nl-NL"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/><w:basedOn w:val="Kop1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
  "word/_rels/document.xml.rels": `<Relationships><Relationship Id="rId5" Target="https://voorbeeld.test/regels" TargetMode="External"/></Relationships>`,
  "word/document.xml": `<w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Kop1"/></w:pPr><w:r><w:t>Beleidsnota parkeren</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Lees de </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>regels voor vergunningen</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Kop2"/></w:pPr><w:r><w:t>Tarieven</w:t></w:r></w:p>
    <w:p>${drawing("Afbeelding 1", "Kaart van de parkeerzones in het centrum")}</w:p>
    <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Zone</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tarief</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3 euro</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Eerste punt</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:lang w:val="en-GB"/></w:rPr><w:t>This sentence is in English.</w:t></w:r></w:p>
  </w:body></w:document>`,
});

/** The same content the way it goes wrong: bold instead of headings, no description, no header row, a typed list, no title. */
const BAD_DOCX = zip({
  "word/document.xml": `<w:document ${W}><w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Beleidsnota parkeren</w:t></w:r></w:p>
    <w:p><w:r><w:t>Dit is gewone tekst met een punt.</w:t></w:r></w:p>
    <w:p>${drawing("Afbeelding 1", null)}</w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Zone</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>- Eerste punt</w:t></w:r></w:p>
  </w:body></w:document>`,
});

const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="r"';
const PPTX = zip({
  "docProps/core.xml": CORE("Kwartaalcijfers"),
  "ppt/presentation.xml": `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
  "ppt/slides/slide1.xml": `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Titel"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr lang="nl-NL"/><a:t>Kwartaalcijfers</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Grafiek" descr="Lijn die stijgt van 10 naar 12"/></p:nvPicPr></p:pic></p:spTree></p:cSld></p:sld>`,
  "ppt/slides/slide2.xml": `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Tekst"/><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr lang="nl-NL"/><a:t>Een dia zonder titel</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Foto"/></p:nvPicPr></p:pic></p:spTree></p:cSld></p:sld>`,
});

const XLSX = zip({
  "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Begroting" sheetId="1" r:id="rId1"/><sheet name="Blad2" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>Post</t></si><si><t>Bedrag</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Wegen</t></is></c><c r="B2"><v>100</v></c></row></sheetData></worksheet>`,
  "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../tables/table1.xml"/></Relationships>`,
  "xl/tables/table1.xml": `<table name="Begroting" ref="A1:B2" headerRowCount="1"><tableColumns count="2"><tableColumn id="1" name="Post"/><tableColumn id="2" name="Bedrag"/></tableColumns></table>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1"><v>12</v></c></row></sheetData></worksheet>`,
});

const ODF = 'xmlns:office="o" xmlns:text="t" xmlns:table="tb" xmlns:draw="d" xmlns:svg="s" xmlns:style="st" xmlns:fo="fo" xmlns:xlink="x" xmlns:dc="dc" xmlns:meta="m"';
const ODT = zip({
  "meta.xml": `<office:document-meta ${ODF}><office:meta><dc:title>Verslag wijkraad</dc:title><dc:language>nl-NL</dc:language></office:meta></office:document-meta>`,
  "content.xml": `<office:document-content ${ODF}><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>
    <text:h text:outline-level="1">Verslag wijkraad</text:h>
    <text:p><text:span text:style-name="T1">Besluiten</text:span></text:p>
    <text:p>Zie <text:a xlink:href="https://voorbeeld.test/agenda">de agenda</text:a> van <text:span>vandaag</text:span>.</text:p>
    <text:p><draw:frame draw:name="Foto1"><draw:image xlink:href="Pictures/a.png"/><svg:desc>De zaal met twintig bezoekers</svg:desc></draw:frame></text:p>
    <text:p><draw:frame draw:name="Foto2"><draw:image xlink:href="Pictures/b.png"/></draw:frame></text:p>
    <text:list><text:list-item><text:p>Punt een</text:p></text:list-item></text:list>
    <table:table><table:table-header-rows><table:table-row><table:table-cell><text:p>Naam</text:p></table:table-cell></table:table-row></table:table-header-rows><table:table-row><table:table-cell><text:p>Jansen</text:p></table:table-cell></table:table-row></table:table>
  </office:text></office:body></office:document-content>`,
});

const write = (dir: string, name: string, bytes: Buffer): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

let scratch: string;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "loep-documents-"));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

test("a link is recognised as a document by its extension or by what the server says it sends", () => {
  assert.equal(documentKind("https://a.test/files/Jaarverslag.PDF?v=2"), "pdf");
  assert.equal(documentKind("https://a.test/nota.docx#p3"), "docx");
  assert.equal(documentKind("https://a.test/oud.doc"), "doc");
  assert.equal(documentKind("https://a.test/pagina.html"), null);
  assert.equal(documentKind("https://a.test/foto.png"), null);
  assert.equal(kindOfContentType("application/pdf; charset=binary"), "pdf");
  assert.equal(kindOfContentType("text/html"), null);
  // Plain text is a document too: a browser shows it as a bare page without language or title.
  assert.equal(documentKind("https://a.test/pagina/index.export.md"), "text");
  assert.equal(documentKind("https://a.test/lees.TXT"), "text");
  assert.equal(documentKind("https://a.test/cijfers.csv"), "text");
  assert.equal(documentKind("https://a.test/bestand.text"), null, "a kind's own name is no extension");
  assert.equal(kindOfContentType("text/markdown"), "text");
  assert.equal(kindOfContentType("text/x-markdown; charset=utf-8"), "text");
  assert.equal(kindOfContentType("text/plain"), "text");
});

test("Markdown writes its structure out: headings, links, pictures and tables, not inside fenced code", () => {
  const read = readMarkdown("# Één titel\n\nTekst met [een link](https://a.test/x) en ![Logo](logo.png) en ![](leeg.png).\n\nOnderkop\n--------\n\n```\n# geen kop\n```\n\n| Naam | Waarde |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\n### Slot ###\n");
  assert.deepEqual(read.headings.map((heading) => [heading.level, heading.text]), [[1, "Één titel"], [2, "Onderkop"], [3, "Slot"]]);
  assert.deepEqual(read.links.map((link) => [link.text, link.href]), [["een link", "https://a.test/x"]]);
  assert.deepEqual(read.images.map((image) => [image.alt, image.context]), [["Logo", "logo.png"], [null, "leeg.png"]]);
  assert.deepEqual(read.tables.map((table) => [table.rows, table.hasHeader, table.firstRow]), [[3, true, ["Naam", "Waarde"]]]);
});

const found = (index: number, kind: InventoryDocument["kind"], extra: Partial<InventoryDocument> = {}): InventoryDocument => ({ url: `https://a.test/d${String(index).padStart(3, "0")}.${kind}`, kind, slug: `d${index}`, linkedFrom: [{ page: "https://a.test/", text: `Document ${index}` }], bytes: 1000, lastModified: null, contentType: null, status: 200, ...extra });
const inventoryWith = (documents: InventoryDocument[], elsewhere = 0): Inventory => ({ baseUrl: "https://a.test/", origin: "https://a.test", sitemapUrls: 0, notFoundProbe: "https://a.test/404", pages: [{ url: "https://a.test/", slug: "home", status: 200, title: "Start", lang: "nl", templateHash: "t", contentHash: "c", foundVia: ["start"], counts: {} }], skipped: [], totals: {}, documents, documentTotals: { onSite: documents.length, byKind: {}, elsewhere, elsewhereByKind: {} } });

test("few documents are all in the sample, each with its own label", () => {
  const stock = inventoryWith([found(2, "docx"), found(1, "pdf"), found(3, "doc")], 4);
  const sample = withDocuments(buildSample(stock, "seed"), stock, "seed");
  assert.deepEqual(sample.documents!.map((document) => [document.label, document.kind]), [["D01", "pdf"], ["D02", "docx"], ["D03", "doc"]]);
  assert.match(sample.note, /Op de site staan 3 documenten \(1 pdf, 1 Word \(docx\), 1 Word \(doc\)\)\. Ze zijn allemaal in de steekproef opgenomen\. 4 documenten staan op een ander domein en zijn niet onderzocht\./);
  assert.equal(sample.documentPopulation!.notChosen, 0);
});

test("many documents give a choice per kind plus a seeded random part, and the note says how many were left out", () => {
  const many = [...Array.from({ length: 60 }, (_item, index) => found(index, "pdf")), found(100, "docx"), found(101, "doc"), found(7, "pdf", { url: "https://a.test/veel-gelinkt.pdf", linkedFrom: [{ page: "https://a.test/", text: "a" }, { page: "https://a.test/b", text: "a" }] }), found(8, "pdf", { url: "https://a.test/nieuw.pdf", lastModified: "2026-01-01T00:00:00.000Z" })];
  const first = chooseDocuments(many, "seed");
  assert.equal(first.length, DOCUMENT_CENSUS_LIMIT);
  assert.deepEqual(first, chooseDocuments([...many].reverse(), "seed"), "the same seed chooses the same documents");
  assert.notDeepEqual(first.map((document) => document.url), chooseDocuments(many, "other").map((document) => document.url));
  const reasons = new Map(first.map((document) => [document.url, document.reason]));
  assert.match(reasons.get("https://a.test/veel-gelinkt.pdf")!, /meeste pagina's/);
  assert.match(reasons.get("https://a.test/nieuw.pdf")!, /nieuwste/);
  assert.ok(reasons.has("https://a.test/d100.docx") && reasons.has("https://a.test/d101.doc"), "every kind is represented");
  assert.ok(first.some((document) => /willekeurig gekozen met seed seed/.test(document.reason)));
  const stock = inventoryWith(many);
  const sample = withDocuments(buildSample(stock, "seed"), stock, "seed");
  assert.match(sample.note, new RegExp(`Daarvan zijn er ${DOCUMENT_CENSUS_LIMIT} in de steekproef opgenomen.*${many.length - DOCUMENT_CENSUS_LIMIT} documenten zijn niet gekozen en niet onderzocht`));
});

test("a site without documents keeps the sample it had", () => {
  const stock = inventoryWith([]);
  const plain = buildSample(stock, "seed");
  assert.equal(withDocuments(plain, stock, "seed"), plain);
  const older = { ...stock };
  delete older.documents;
  assert.equal(withDocuments(plain, older, "seed"), plain);
});

test("the zip and XML readers read what an office file is made of", () => {
  const archive = openZip(zip({ "a/b.xml": '<r xmlns:x="y"><x:p a="1 &amp; 2">Tekst <b>vet</b> <i>schuin</i>\n  </x:p><e/></r>' }));
  assert.deepEqual(archive.names, ["a/b.xml"]);
  assert.equal(archive.text("ontbreekt.xml"), null);
  const root = parseXml(archive.text("a/b.xml")!);
  const paragraph = (root.children[0] as { children: { name: string; attrs: Record<string, string>; children: unknown[] }[] }).children[0]!;
  assert.equal(paragraph.name, "x:p");
  assert.equal(paragraph.attrs.a, "1 & 2");
  assert.equal(paragraph.children.length, 4, "the space between two elements is text, the line break at the end is not");
  assert.throws(() => openZip(Buffer.from("geen zip")), /geen zip-archief/);
});

test("a Word document: headings by style, alternatives, header row, list, link and language", async () => {
  const { facts, text } = await measureOffice(write(scratch, "goed.docx", GOOD_DOCX), "docx");
  assert.equal(facts.title, "Beleidsnota parkeren");
  assert.equal(facts.language, "nl-NL");
  assert.deepEqual(facts.headings.map((heading) => [heading.level, heading.text]), [[1, "Beleidsnota parkeren"], [2, "Tarieven"]]);
  assert.deepEqual(facts.images.map((image) => image.alt), ["Kaart van de parkeerzones in het centrum"]);
  assert.deepEqual(facts.tables.map((table) => [table.rows, table.hasHeader, table.firstRow]), [[2, true, ["Zone", "Tarief"]]]);
  assert.deepEqual(facts.links, [{ page: null, text: "regels voor vergunningen", href: "https://voorbeeld.test/regels" }]);
  assert.deepEqual(facts.office.lists, { real: 1, typed: 0 });
  assert.deepEqual(facts.office.fakeHeadings, []);
  assert.deepEqual(facts.office.languageParts, [{ lang: "en-GB", text: "This sentence is in English." }]);
  assert.match(text, /^# Beleidsnota parkeren\nLees de regels voor vergunningen\.\n## Tarieven/);
});

test("a Word document without structure: bold as heading, no alternative, no header row, a typed list, no title", async () => {
  const { facts } = await measureOffice(write(scratch, "slecht.docx", BAD_DOCX), "docx");
  assert.equal(facts.title, null);
  assert.equal(facts.language, null);
  assert.deepEqual(facts.headings, []);
  assert.deepEqual(facts.office.fakeHeadings.map((entry) => entry.text), ["Beleidsnota parkeren"], "bold text in a table cell is no heading, a sentence neither");
  assert.deepEqual(facts.images.map((image) => image.alt), [null]);
  assert.equal(facts.tables[0]!.hasHeader, false);
  assert.deepEqual(facts.office.lists, { real: 0, typed: 1 });
});

test("a presentation: a title per slide, the reading order and the pictures", async () => {
  const { facts } = await measureOffice(write(scratch, "dia.pptx", PPTX), "pptx");
  assert.equal(facts.pages, 2);
  assert.equal(facts.language, "nl-NL");
  assert.deepEqual(facts.office.slides, [
    { slide: 1, title: "Kwartaalcijfers", readingOrder: ["Kwartaalcijfers", "[afbeelding: Lijn die stijgt van 10 naar 12]"] },
    { slide: 2, title: null, readingOrder: ["Een dia zonder titel", "[afbeelding: geen tekstalternatief]"] },
  ]);
  assert.deepEqual(facts.images.map((image) => [image.page, image.alt]), [[1, "Lijn die stijgt van 10 naar 12"], [2, null]]);
});

test("a spreadsheet: the names of the sheets and whether a header row is defined", async () => {
  const { facts } = await measureOffice(write(scratch, "blad.xlsx", XLSX), "xlsx");
  assert.deepEqual(facts.office.sheets, [
    { name: "Begroting", firstRow: ["Post", "Bedrag"], headerRowDefined: true },
    { name: "Blad2", firstRow: ["12"], headerRowDefined: false },
  ]);
  assert.deepEqual(facts.tables, [{ page: 1, rows: 2, headerCells: 2, hasHeader: true, firstRow: ["Post", "Bedrag"] }]);
});

test("an OpenDocument text: the same facts from other XML", async () => {
  const { facts } = await measureOffice(write(scratch, "verslag.odt", ODT), "odt");
  assert.equal(facts.title, "Verslag wijkraad");
  assert.equal(facts.language, "nl-NL");
  assert.deepEqual(facts.headings, [{ level: 1, text: "Verslag wijkraad", page: null }]);
  assert.deepEqual(facts.office.fakeHeadings.map((entry) => entry.text), ["Besluiten"]);
  assert.deepEqual(facts.images.map((image) => image.alt), ["De zaal met twintig bezoekers", null]);
  assert.deepEqual(facts.links, [{ page: null, text: "de agenda", href: "https://voorbeeld.test/agenda" }]);
  assert.deepEqual(facts.tables.map((table) => [table.rows, table.hasHeader]), [[2, true]]);
  assert.equal(facts.office.lists.real, 1);
});

test("a file that is not what its name says gives a reason, no facts", async () => {
  await assert.rejects(measureOffice(write(scratch, "kapot.docx", Buffer.from("dit is geen zip")), "docx"), /geen zip-archief/);
  await assert.rejects(measureOffice(write(scratch, "leeg.docx", zip({ "iets.xml": "<a/>" })), "docx"), /geen Word-document/);
});

test("the tree of poppler is read by its indentation, and the order of tags is compared with that of the content", () => {
  const tree = parseStructText('Syntax Error: iets\nDocument\n  H1 "Titel" (block)\n    "Titel"\n  P (block)\n    "Lees "\n    Link (inline)\n      "hier"\n      Object 40 0\n    "."\n  Table (block):\n     /BorderThickness 1\n    TR\n      TH <a1>:\n         /Scope /Column\n        "Kop"\n');
  assert.equal(tree.length, 1);
  const kinds = (tree[0]!.children as { type?: string }[]).map((child) => child.type);
  assert.deepEqual(kinds, ["H1", "P", "Table"]);
  assert.deepEqual((tree[0]!.children[1] as { children: unknown[] }).children.map((child) => (typeof child === "string" ? child : (child as { type: string }).type)), ["Lees ", "Link", "."]);
  assert.equal(compareOrder("Een twee drie", "Een twee\ndrie"), "gelijk");
  assert.equal(compareOrder("twee drie", "Kop Een twee drie voet"), "gelijk; de inhoud heeft tekst die niet in de tags zit");
  assert.equal(compareOrder("drie twee een", "een twee drie"), "andere volgorde");
  assert.equal(compareOrder("heel iets anders", "een twee drie"), "verschilt");
  assert.equal(compareOrder("", "een"), null);
});

test("a tagged PDF: title, language, headings, figures, table headers, list, link, bookmarks and order", { skip: NEEDS_PDF_TOOLS }, async () => {
  const { facts, text, tagTree } = await measurePdf(join(FIXTURES, "tagged.pdf"), scratch);
  assert.equal(facts.pdf.tagged, true);
  assert.equal(facts.title, "Jaarverslag 2025");
  assert.equal(facts.language, "nl");
  assert.equal(facts.pages, 2);
  assert.equal(facts.pdf.displayDocTitle, false);
  assert.deepEqual(facts.headings, [{ level: 1, text: "Jaarverslag 2025", page: 1 }, { level: 2, text: "Cijfers", page: 1 }, { level: 2, text: "Slot", page: 2 }]);
  assert.deepEqual(facts.images.map((image) => image.alt), ["Staafdiagram van de inkomsten per jaar", null]);
  assert.deepEqual(facts.tables.map((table) => [table.page, table.rows, table.headerCells, table.firstRow]), [[1, 3, 2, ["Jaar", "Bedrag"]]]);
  assert.deepEqual(facts.links, [{ page: 1, text: "klik hier", href: "https://example.org/meer" }]);
  assert.equal(facts.pdf.lists, 1);
  assert.equal(facts.pdf.bookmarks.count, 3);
  assert.deepEqual(facts.pdf.languageParts, [{ lang: "en", text: "This paragraph is in English.", page: 2 }]);
  assert.deepEqual(facts.pdf.pageText.map((page) => page.order), ["gelijk", "gelijk"]);
  assert.deepEqual(facts.pdf.encryption, { encrypted: false, accessibilityAllowed: true });
  assert.deepEqual(facts.pdf.scanPages, []);
  assert.match(text, /=== pagina 2, volgorde van de inhoud ===\nSlot\nThis paragraph is in English\./);
  assert.match(tagTree!, /^ {2}Figure \[p1\]$/m);
  assert.match(tagTree!, /Figure \[p1 alt="Staafdiagram van de inkomsten per jaar"\]/);
  assert.deepEqual(tagsOfPage(tagTree!, 2), ["Document [p1]", '  H2 [p2] "Slot"', '  P [p2 lang=en] "This paragraph is in English."']);
  assert.match(sectionsOf(text, 2).join(""), /^=== pagina 2, volgorde van de inhoud[\s\S]*=== pagina 2, volgorde van de tags/);
  if (facts.pdf.pdfUa.available) {
    assert.equal(facts.pdf.pdfUa.compliant, false);
    assert.ok(facts.pdf.pdfUa.failedRules.some((rule) => rule.clause === "7.3" && rule.failedChecks === 1), "the figure without an alternative fails PDF/UA");
  } else assert.ok(facts.notMeasuredNl.some((line) => /veraPDF/.test(line)));
});

test("a PDF without tags: no structure, and every picture is without alternative", { skip: NEEDS_PDF_TOOLS }, async () => {
  const { facts, tagTree } = await measurePdf(join(FIXTURES, "untagged.pdf"), scratch);
  assert.equal(facts.pdf.tagged, false);
  assert.equal(tagTree, null);
  assert.deepEqual(facts.headings, []);
  assert.deepEqual(facts.tables, []);
  assert.equal(facts.images.length, facts.pdf.imageObjects);
  assert.ok(facts.images.length > 0 && facts.images.every((image) => image.alt === null));
  assert.equal(facts.pdf.linkAnnotations, 1);
  assert.deepEqual(facts.links, []);
  assert.deepEqual(facts.pdf.pageText.map((page) => page.order), [null, null]);
});

test("a PDF that is only a picture of text is recognised as a scan", { skip: NEEDS_PDF_TOOLS || (TESSERACT ? false : "tesseract is not installed") }, async () => {
  const { facts } = await measurePdf(join(FIXTURES, "scan.pdf"), scratch);
  assert.deepEqual(facts.pdf.scanPages, [1]);
  assert.equal(facts.pdf.pageText[0]!.characters, 0);
  assert.ok(facts.pdf.pageText[0]!.recognisedWords! >= 4);
});

test("a file that is no PDF gives a reason", { skip: NEEDS_PDF_TOOLS }, async () => {
  await assert.rejects(measurePdf(write(scratch, "kapot.pdf", Buffer.from("dit is geen pdf")), scratch), /niet als pdf te lezen|wachtwoord/);
});

// ------------------------------------------------------------- the chain on a small site

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html lang="nl"><head><title>Start</title></head><body><h1>Start</h1>
    <p><a href="/files/jaarverslag.pdf">Jaarverslag 2025 (pdf)</a> <a href="/nota.docx">Beleidsnota</a> <a href="/oud.doc">Oude brief</a>
    <a href="/tweede">Tweede pagina</a> <a href="/download?id=7">Download</a> <a href="http://elders.test/extern.pdf">Extern rapport</a></p></body></html>`,
  "/tweede": `<!doctype html><html lang="nl"><head><title>Tweede</title></head><body><h1>Tweede</h1><p><a href="/files/jaarverslag.pdf">Download het verslag</a> <a href="/weg.pdf">Verdwenen</a></p></body></html>`,
};

let server: Server;
let origin: string;
const requests: string[] = [];

before(async () => {
  const files: Record<string, { type: string; body: Buffer }> = {
    "/files/jaarverslag.pdf": { type: "application/pdf", body: readFileSync(join(FIXTURES, "tagged.pdf")) },
    "/download": { type: "application/pdf", body: readFileSync(join(FIXTURES, "untagged.pdf")) },
    "/nota.docx": { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: BAD_DOCX },
    "/oud.doc": { type: "application/msword", body: Buffer.from("oud") },
  };
  server = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    requests.push(`${request.method} ${path}`);
    const file = files[path];
    if (file) {
      response.writeHead(200, { "content-type": file.type, "content-length": file.body.length, "last-modified": "Mon, 03 Sep 2018 10:00:00 GMT", ...(path === "/download" ? { "content-disposition": "attachment" } : {}) });
      response.end(request.method === "HEAD" ? undefined : file.body);
    } else if (PAGES[path]) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGES[path]);
    } else {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=nl><head><title>Niet gevonden</title></head><body><h1>Niet gevonden</h1></body></html>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => new Promise<void>((resolve) => void server.close(() => resolve())));

test("inventory finds the documents, sample labels them, documents measures them and the dossier shows them", async (context) => {
  const run = join(scratch, "run");
  let stock: Inventory;
  try {
    stock = await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 20 });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  const byPath = new Map(stock.documents!.map((document) => [new URL(document.url).pathname + new URL(document.url).search, document]));
  assert.deepEqual([...byPath.keys()].sort(), ["/download?id=7", "/files/jaarverslag.pdf", "/nota.docx", "/oud.doc", "/weg.pdf"]);
  const report = byPath.get("/files/jaarverslag.pdf")!;
  assert.equal(report.kind, "pdf");
  assert.deepEqual(report.linkedFrom, [{ page: `${origin}/`, text: "Jaarverslag 2025 (pdf)" }, { page: `${origin}/tweede`, text: "Download het verslag" }]);
  assert.equal(report.bytes, readFileSync(join(FIXTURES, "tagged.pdf")).length);
  assert.equal(report.lastModified, "2018-09-03T10:00:00.000Z");
  assert.equal(byPath.get("/download?id=7")!.kind, "pdf", "a download without an extension is recognised by what the server says");
  assert.equal(byPath.get("/weg.pdf")!.status, 404);
  assert.equal(byPath.get("/weg.pdf")!.bytes, null);
  assert.deepEqual(stock.documentTotals, { onSite: 5, byKind: { pdf: 3, docx: 1, doc: 1 }, elsewhere: 1, elsewhereByKind: { pdf: 1 } });
  assert.ok(!stock.pages.some((page) => /\.(pdf|docx?)$/.test(page.url)) && !stock.skipped.some((entry) => /\.(pdf|docx?)$/.test(entry.url)), "a document is neither a page nor skipped");
  assert.ok(!requests.some((line) => /extern/.test(line)), "a document on another origin is never asked for");
  assert.ok(!requests.some((line) => line.startsWith("GET /files/") || line === "GET /nota.docx"), "inventory asks for size and date only");

  const sample = withDocuments(buildSample(stock, "seed"), stock, "seed");
  await writeJson(join(run, "sample.json"), sample);
  assert.deepEqual(sample.documents!.map((document) => document.label), ["D01", "D02", "D03", "D04", "D05"]);

  const result = await measureDocuments(run);
  const loaded = loadDocuments(run, sample.documents);
  const facts = new Map(loaded.map((document) => [new URL(document.item.url).pathname, document.facts!]));
  assert.equal(facts.get("/oud.doc")!.status, "notRead");
  assert.match(facts.get("/oud.doc")!.reasonNl!, /binaire formaat van Word/);
  assert.equal(facts.get("/weg.pdf")!.status, "failed");
  assert.match(facts.get("/weg.pdf")!.reasonNl!, /niet op te halen: de server antwoordt met 404/);
  assert.equal(facts.get("/nota.docx")!.status, "read");
  assert.deepEqual(facts.get("/nota.docx")!.office!.fakeHeadings.map((entry) => entry.text), ["Beleidsnota parkeren"]);
  assert.ok(!requests.includes("GET /oud.doc"), "a kind that is not read is not fetched");
  if (NEEDS_PDF_TOOLS) return context.skip(NEEDS_PDF_TOOLS);
  assert.deepEqual(result, { documents: 5, read: 3, notRead: 1, failed: 1 });
  const pdf = facts.get("/files/jaarverslag.pdf")!;
  assert.equal(pdf.status, "read");
  assert.equal(pdf.pdf!.tagged, true);
  assert.equal(pdf.sha256!.length, 64);
  assert.deepEqual(pdf.files.pageImages.map((path) => existsSync(join(run, path))), [true, true]);
  assert.ok(existsSync(join(run, pdf.files.text!)) && existsSync(join(run, pdf.files.tagTree!)));
  assert.equal((await readJson<{ steps: { command: string }[] }>(join(run, "manifest.json"))).steps.at(-1)!.command, "documents");

  // The dossier: documents in the legend, and per criterion the facts that bear on it.
  const data = { dir: run, inventory: stock, sample, pages: [], states: null, contrast: null, documents: loaded } as unknown as RunData;
  const labels = legend(data, "1.1.1") as Record<string, { document?: string; files: string; measured?: string }>;
  const label = loaded.find((document) => document.item.url.endsWith("jaarverslag.pdf"))!.label;
  assert.equal(labels[label]!.document, "pdf");
  assert.ok(existsSync(join(run, labels[label]!.files, "text.txt")), "the text a quotation is checked against lies where the legend points");
  const images = documentsExtractor(data, "1.1.1") as { documentsInSample: number; read: string[]; notRead: { document: string; reasonNl: string }[]; documents: { document: string; images: { total: number; withAlternative: number; withoutAlternative: { total: number } }; pdfUa?: { failedRulesForThisCriterion: { rule: string }[] } }[] };
  assert.equal(images.documentsInSample, 5);
  assert.equal(images.read.length, 3);
  assert.deepEqual(images.notRead.map((entry) => entry.reasonNl.slice(0, 12)).sort(), ["het oude bin", "niet op te h"]);
  const ours = images.documents.find((document) => document.document === label)!;
  assert.deepEqual([ours.images.total, ours.images.withAlternative, ours.images.withoutAlternative.total], [2, 1, 1]);
  if (pdf.pdf!.pdfUa.available) assert.deepEqual(ours.pdfUa!.failedRulesForThisCriterion.map((rule) => rule.rule), ["7.3-1"]);
  const titles = documentsExtractor(data, "2.4.2") as { documents: { document: string; title: string | null; fileName: string; titleShownInTitleBar?: boolean }[] };
  assert.deepEqual(titles.documents.map((document) => [document.fileName, document.title, document.titleShownInTitleBar]).sort(), [["download", "Jaarverslag 2025", false], ["jaarverslag.pdf", "Jaarverslag 2025", false], ["nota.docx", null, undefined]]);
  const structure = documentsExtractor(data, "1.3.1") as { documents: { document: string; tagged?: boolean; paragraphsThatLookLikeAHeading?: { total: number } }[] };
  assert.deepEqual(structure.documents.map((document) => document.tagged).filter((value) => value !== undefined).sort(), [false, true]);
  assert.equal(structure.documents.find((document) => document.paragraphsThatLookLikeAHeading)!.paragraphsThatLookLikeAHeading!.total, 1);

  // A procedure that names the extractor gets it only when there are documents.
  const procedure = loadProcedure("1.1.1");
  assert.ok(procedure.evidence.includes("documents"));
  const empty = { ...data, documents: [], sample: buildSample(stock, "seed") } as unknown as RunData;
  const without = buildDossier(empty, procedure) as { evidence: Record<string, unknown>; legend: Record<string, unknown> };
  assert.ok(!("documents" in without.evidence), "a run without documents has no such part in its dossier");
  assert.deepEqual(Object.keys(without.legend), []);

  // An agent looks at a document: the facts, one page with a picture, and the tags.
  mkdirSync(join(run, "observations", "main"), { recursive: true });
  const overview = await documentOutcome(run, [label], {}, new Images(run, "observations/main/0001"));
  assert.equal(overview.print.tagged, true);
  assert.equal(overview.print.title, "Jaarverslag 2025");
  const page = await documentOutcome(run, [label], { page: "2" }, new Images(run, "observations/main/0002"));
  assert.match(String(page.print.text), /This paragraph is in English\./);
  assert.ok(existsSync(join(run, String(page.print.image))));
  assert.deepEqual(page.print.tags, ["Document [p1]", '  H2 [p2] "Slot"', '  P [p2 lang=en] "This paragraph is in English."']);
  const tags = await documentOutcome(run, [label], { tags: true }, new Images(run, "observations/main/0003"));
  assert.ok((tags.print.tags as string[]).includes('  H1 [p1] "Jaarverslag 2025"'));
  await assert.rejects(documentOutcome(run, ["D99"], {}, new Images(run, "observations/main/0004")), /D01, D02/);
  await assert.rejects(documentOutcome(run, [label], { page: "9" }, new Images(run, "observations/main/0005")), /--page moet een nummer zijn van 1 tot 2/);
  const notRead = await documentOutcome(run, [loaded.find((document) => document.item.kind === "doc")!.label], {}, new Images(run, "observations/main/0006"));
  assert.equal(notRead.print.status, "notRead");

  // In a session the command needs no open page, and its observation can carry a finding.
  const daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 50, maxSessions: 1, secondBrowsers: false });
  try {
    assert.equal((await daemon.handle({ op: "start", session: "judge" })).ok, true);
    const answer = await daemon.handle({ op: "command", session: "judge", command: "document", args: [label], options: { page: "1" } });
    assert.equal(answer.ok, true, JSON.stringify(answer.print));
    const id = String((answer.print as { id: string }).id);
    const record = await readJson<{ command: string; error: string | null; state: { start: unknown }; result: { text: string }; images: { path: string }[] }>(join(run, "observations", "judge", `${id.split("-").pop()}.json`));
    assert.equal(record.command, "document");
    assert.match(record.result.text, /Dit is de inleiding van het verslag/);
    assert.equal(record.images.length, 1);
    assert.equal(indexObservations([{ ...record, id }]).get(id)!.replayable, true);
    const wrong = await daemon.handle({ op: "command", session: "judge", command: "document", args: ["P01"], options: {} });
    assert.equal(wrong.ok, false);
  } finally {
    await daemon.close();
  }
});

// ------------------------------------------------- plain text offered for download

const MARKDOWN = "# Één regeling\n\nDit is één pagina als Markdown, met [een link](https://a.test/meer).\n\n## Wie kan meedoen\n\nIedereen.\n";
const TEXT_SITE: Record<string, { type: string; body: string }> = {
  "/": { type: "text/html; charset=utf-8", body: `<!doctype html><html lang="nl"><head><title>Regeling</title></head><body><h1>Regeling</h1><h2>Download deze pagina</h2>
    <p><a href="/regeling/index.export.md" download="Regeling.md">Markdown</a> <a href="/lees-mij.txt">Lees mij</a> <a href="/export?id=3" download>Export</a>
    <a href="/kaal">Kale tekst</a> <a href="/tweede">Tweede pagina</a></p></body></html>` },
  "/tweede": { type: "text/html; charset=utf-8", body: `<!doctype html><html lang="nl"><head><title>Tweede</title></head><body><h1>Tweede</h1><p><a href="/regeling/index.export.md">Ook als tekst</a></p></body></html>` },
  // No character set in the header: a browser has to guess, and shows "Ã©" for "é".
  "/regeling/index.export.md": { type: "text/markdown", body: MARKDOWN },
  "/lees-mij.txt": { type: "text/plain; charset=utf-8", body: "Lees mij.\n" },
  "/export": { type: "text/markdown", body: "# Export\n" },
  // Plain text behind an address without an extension: only what the server says tells it from a page.
  "/kaal": { type: "text/plain; charset=utf-8", body: "Alleen tekst.\n" },
};

test("plain text offered for download is a document, not a page: inventory counts it, documents reads it", async (context) => {
  const textServer = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    const file = TEXT_SITE[path];
    if (file) {
      const body = Buffer.from(file.body, "utf8");
      response.writeHead(200, { "content-type": file.type, "content-length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } else {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=nl><head><title>Niet gevonden</title></head><body><h1>Niet gevonden</h1></body></html>");
    }
  });
  await new Promise<void>((resolve) => textServer.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${(textServer.address() as { port: number }).port}`;
  try {
    const run = join(scratch, "run-text");
    let stock: Inventory;
    try {
      stock = await inventory({ baseUrl: `${site}/`, out: run, maxPages: 20 });
    } catch (error) {
      if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
      throw error;
    }
    const path = (url: string): string => new URL(url).pathname + new URL(url).search;
    assert.deepEqual(stock.pages.map((page) => path(page.url)).sort(), ["/", "/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek", "/tweede"], "no plain text file is evaluated as a page");
    const byPath = new Map(stock.documents!.map((document) => [path(document.url), document]));
    assert.deepEqual([...byPath.keys()].sort(), ["/export?id=3", "/kaal", "/lees-mij.txt", "/regeling/index.export.md"]);
    assert.deepEqual([...byPath.values()].map((document) => document.kind), ["text", "text", "text", "text"]);
    assert.deepEqual(byPath.get("/regeling/index.export.md")!.linkedFrom, [{ page: `${site}/`, text: "Markdown", download: "Regeling.md" }, { page: `${site}/tweede`, text: "Ook als tekst" }]);
    assert.deepEqual(byPath.get("/export?id=3")!.linkedFrom, [{ page: `${site}/`, text: "Export", download: "" }], "a download without an extension takes its kind from what the server says");
    assert.deepEqual(byPath.get("/kaal")!.linkedFrom, [{ page: `${site}/`, text: "Kale tekst" }], "a document found by what the server sent keeps the links to it");
    assert.deepEqual(stock.documentTotals!.byKind, { text: 4 });

    const sample = withDocuments(buildSample(stock, "seed"), stock, "seed");
    await writeJson(join(run, "sample.json"), sample);
    assert.match(sample.note, /4 platte tekst \(md, txt, csv\)/);
    const result = await measureDocuments(run);
    assert.deepEqual(result, { documents: 4, read: 4, notRead: 0, failed: 0 });
    const loaded = loadDocuments(run, sample.documents);
    const facts = new Map(loaded.map((document) => [new URL(document.item.url).pathname, document.facts!]));
    const markdown = facts.get("/regeling/index.export.md")!;
    assert.equal(markdown.status, "read");
    assert.deepEqual(markdown.plain, { format: "markdown", contentType: "text/markdown", charset: null, validUtf8: true, nonAscii: true, decodedAs: "utf-8", lines: 8 });
    assert.deepEqual(markdown.headings.map((heading) => [heading.level, heading.text]), [[1, "Één regeling"], [2, "Wie kan meedoen"]]);
    assert.deepEqual(markdown.links.map((link) => link.href), ["https://a.test/meer"]);
    assert.equal(markdown.title, null);
    assert.equal(markdown.language, null);
    assert.match(readFileSync(join(run, markdown.files.text!), "utf8"), /^=== pagina 1 ===\n# Één regeling/);
    assert.deepEqual(facts.get("/lees-mij.txt")!.plain!.charset, "utf-8");
    assert.equal(facts.get("/lees-mij.txt")!.plain!.format, "plain");

    // The dossier: no title and no language is not a gap but does not apply, and the missing character set is a fact.
    const data = { dir: run, inventory: stock, sample, pages: [], states: null, contrast: null, documents: loaded } as unknown as RunData;
    const label = loaded.find((document) => document.item.url.endsWith(".md"))!.label;
    const language = documentsExtractor(data, "3.1.1") as { read: string[]; notRead: unknown[]; documents: { document: string; languageProperty?: boolean; notApplicableNl?: string; plainText?: { charset: string | null; charsetNoteNl?: string; downloadNames: string[] } }[] };
    assert.equal(language.read.length, 4);
    assert.deepEqual(language.notRead, []);
    const ours = language.documents.find((document) => document.document === label)!;
    assert.equal(ours.languageProperty, false);
    assert.match(ours.notApplicableNl!, /niet van toepassing/);
    assert.deepEqual(ours.plainText!.downloadNames, ["Regeling.md"]);
    assert.match(ours.plainText!.charsetNoteNl!, /geen tekenset.*geldige UTF-8/);
    const titles = documentsExtractor(data, "2.4.2") as { documents: { document: string; titleProperty?: boolean; notApplicableNl?: string; firstHeading: string | null }[] };
    const titled = titles.documents.find((document) => document.document === label)!;
    assert.equal(titled.titleProperty, false);
    assert.match(titled.notApplicableNl!, /Non-web Document Titled/);
    assert.equal(titled.firstHeading, "Één regeling");
    const look = await documentOutcome(run, [label], { page: "1" }, new Images(run, "observations/main/0101"));
    assert.match(String(look.print.text), /Wie kan meedoen/);
  } finally {
    await new Promise<void>((resolve) => void textServer.close(() => resolve()));
  }
});

test("an observation of a document counts as one that can be made again, without a page being open", () => {
  const index = indexObservations([
    { id: "main-0001", command: "document", error: null, state: { start: null }, result: {} },
    { id: "main-0002", command: "document", error: "mislukt", state: { start: null }, result: null },
    { id: "main-0003", command: "look", error: null, state: { start: null }, result: {} },
  ]);
  assert.equal(index.get("main-0001")!.replayable, true);
  assert.equal(index.get("main-0002")!.replayable, false);
  assert.equal(index.get("main-0003")!.replayable, false);
});

test("the facts of a document that was never measured are absent, not empty", () => {
  const loaded = loadDocuments(scratch, [{ label: "D01", url: "https://a.test/x.pdf", kind: "pdf", slug: "x-00000000", reason: "", linkedFrom: [], bytes: null, lastModified: null }]);
  assert.equal(loaded[0]!.facts, null);
  const data = { dir: scratch, inventory: inventoryWith([]), sample: { documents: [] }, pages: [], documents: loaded } as unknown as RunData;
  const part = documentsExtractor(data, "1.1.1") as { notRead: { reasonNl: string }[]; documents: DocumentFacts[] };
  assert.match(part.notRead[0]!.reasonNl, /nog niet gemeten/);
  assert.deepEqual(part.documents, []);
});

// ------------------------------------------------------------------------- the report

const REPORTED: EvaluationDocuments = {
  onSite: 30,
  byKind: { pdf: 27, docx: 2, doc: 1 },
  elsewhere: 4,
  notChosen: 27,
  notChosenByKind: { pdf: 26, docx: 1 },
  criteria: ["1.1.1", "1.3.1", "2.4.2"],
  items: [
    { label: "D01", url: "https://voorbeeld.overheid.example/files/jaarverslag.pdf", kind: "pdf", title: "Jaarverslag 2025", pages: 12, status: "read", reasonNl: null, reason: "gericht gekozen: het pdf-bestand waar de meeste pagina's naar linken", lastModified: "2026-02-01T00:00:00.000Z" },
    { label: "D02", url: "https://voorbeeld.overheid.example/oud/brief%202017.doc", kind: "doc", title: null, pages: null, status: "notRead", reasonNl: "het oude binaire formaat van Word wordt niet ingelezen; daar is een kantoorpakket voor nodig", reason: "gericht gekozen: het doc-bestand waar de meeste pagina's naar linken", lastModified: "2017-05-01T00:00:00.000Z" },
    { label: "D03", url: "https://voorbeeld.overheid.example/weg.docx", kind: "docx", title: null, pages: null, status: "failed", reasonNl: "niet op te halen: de server antwoordt met 404", reason: "willekeurig gekozen met seed voorbeeld", lastModified: null },
  ],
};

test("the scope and the limitations say which documents were read, which were not, and what was not looked at", () => {
  const scope = documentScopeNl(REPORTED, "https://voorbeeld.overheid.example", 4);
  assert.deepEqual(scope.includedNl, ["Documenten op https://voorbeeld.overheid.example (pdf, kantoorbestanden en platte tekst): 3 van 30 in de steekproef, 1 ingelezen"]);
  assert.deepEqual(scope.excludedNl, ["Documenten op andere domeinen waarnaar de site linkt (4 geteld)", "Documenten van een soort die niet wordt ingelezen (1 Word (doc))"]);
  const text = scope.limitationsNl.join("\n");
  assert.match(text, /op de site staan 30 documenten \(27 pdf, 2 Word \(docx\), 1 Word \(doc\)\)\. De toolbox leest de soorten pdf, docx, odt, pptx, odp, xlsx, ods en platte tekst in\. 1 document is ingelezen en beoordeeld \(D01\)/);
  assert.match(text, /beoordeeld op de criteria 1\.1\.1, 1\.3\.1 en 2\.4\.2/);
  assert.match(text, /1 document is van een soort die niet wordt ingelezen \(1 Word \(doc\): D02\) en is niet onderzocht\. Dat is een open punt, geen goedkeuring\./);
  assert.match(text, /1 document was niet op te halen of niet te openen en is niet onderzocht: D03 \(niet op te halen: de server antwoordt met 404\)\./);
  assert.match(text, /27 documenten zijn niet voor de steekproef gekozen \(26 pdf, 1 Word \(docx\)\) en zijn niet onderzocht\./);
  assert.match(text, /4 documenten staan op een ander domein en zijn niet onderzocht\./);
  assert.match(text, /Van 1 document in de steekproef is de datum volgens de server van voor 23 september 2018 \(D02\)/);
  // A site where documents were looked for and none were found says so, and promises nothing more.
  const none = documentScopeNl(null, "https://voorbeeld.overheid.example", 0);
  assert.deepEqual(none.includedNl, []);
  assert.match(none.limitationsNl[0]!, /op de site zijn geen documenten gevonden/);
});

test("the report lists the documents with their kind and whether they were read, and a finding can point at one", async (context) => {
  const evaluation = exampleEvaluation();
  const plain = renderMarkdown(evaluation);
  assert.ok(!plain.includes("### Documenten"), "an evaluation without documents has no such part");
  assert.equal(deriveReport(evaluation).documents, null);
  evaluation.documents = REPORTED;
  const finding = evaluation.criteria.flatMap((criterion) => criterion.findings)[0]!;
  finding.locations = [{ page: "D01", where: "pagina 4", text: "Figuur 2" }];
  evaluation.defects = mergeFindings(evaluation);
  evaluation.merge = { rulesVersion: 1, proposal: { status: "not-run" } };
  const derived = deriveReport(evaluation);
  assert.deepEqual(derived.documents!.rows.map((row) => [row.label, row.title, row.kindNl, row.statusNl.split(":")[0], row.here.length]), [["D01", "Jaarverslag 2025", "pdf", "Ingelezen", 1], ["D02", "brief 2017.doc", "Word (doc)", "Niet ingelezen", 0], ["D03", "weg.docx", "Word (docx)", "Niet op te halen of te openen", 0]]);
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("- Documenten op de site: 30 (27 pdf, 2 Word (docx), 1 Word (doc))"));
  assert.ok(markdown.includes("- **D02** brief 2017.doc, <https://voorbeeld.overheid.example/oud/brief%202017.doc>. Soort: Word (doc). Niet ingelezen: het oude binaire formaat van Word wordt niet ingelezen; daar is een kantoorpakket voor nodig."));
  assert.ok(markdown.includes("D01 Jaarverslag 2025: "), "the place of the finding names the document by its title");
  assert.match(markdown, /\| D01 Jaarverslag 2025 \| \[/);
  assert.match(markdown, /\| D02 brief 2017\.doc \| Niet ingelezen/);
  const dir = mkdtempSync(join(tmpdir(), "loep-documents-report-"));
  try {
    writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
    const result = await render(dir);
    if (result.pdf === null) return context.skip("Typst is not installed");
    assert.deepEqual(result.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
    if (POPPLER) assert.match(execFileSync("pdftotext", [result.pdf, "-"], { encoding: "utf8" }), /Documenten[\s\S]*D02[\s\S]*Niet ingelezen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
