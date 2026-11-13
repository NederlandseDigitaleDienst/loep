import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Defect } from "./defects.ts";
import type { CriterionResult, Evaluation, ReportFinding } from "./evaluation.ts";
import type { DecisionLayer } from "./decisions.ts";
import type { WcagVersion } from "./wcag.ts";
import type { PagePart, PageShot } from "./page-shots.ts";
import {
  allFindings,
  alsoOnNl,
  deriveReport,
  findingsByComponent,
  groupCriteria,
  OUTCOME_SYMBOL,
  REPORT_TEXT,
  STATUS_LABEL,
  versionNote,
  VERSIONS,
  withCurrentSignature,
  type CriterionBrief,
  type CutoutPictures,
  type OpenGroup,
  type ReportDerived,
  type ShownOutcome,
} from "./report-markdown.ts";

/**
 * The report as one HTML file in the NLDD design system: the same content as the Markdown and
 * the PDF, drawn from the same derived data and the same fixed sentences. Everything it needs is
 * inside the file (the stylesheets, the components, the fonts and the cutouts), so it opens
 * offline and can sit in an archive for years. The same evaluation gives the same bytes.
 *
 * The layout is made of `nldd-*` components and their attributes only. Two small things are the
 * report's own: a stylesheet the design system's content page pattern asks for (the button that
 * opens the table of contents on a narrow screen), and a script that switches between the report
 * and its appendices, and opens everything for printing.
 */

/** The version of the design system this rendering is written against; package.json pins the same. */
export const DESIGN_SYSTEM_VERSION = "0.21.1";

const require = createRequire(import.meta.url);

/** The files of the design system that go into the page, read once. */
interface Assets {
  /** Per entry stylesheet, such as global.css, the stylesheet with all it imports and every font as a data URI. */
  css: (entry: string) => string;
  script: string;
  dist: string;
}

let assets: Assets | null = null;

/** The stylesheets with everything they import, with every font as a data URI, and the bundle of all components. */
function loadAssets(): Assets {
  if (assets) return assets;
  // The package exports no package.json; the bundle sits in dist, with the package root above it.
  const dist = dirname(require.resolve("@nldd/design-system/bundle"));
  const version = (JSON.parse(readFileSync(join(dist, "..", "package.json"), "utf8")) as { version: string }).version;
  if (version !== DESIGN_SYSTEM_VERSION) throw new Error(`@nldd/design-system ${version} is installed, the HTML report is written against ${DESIGN_SYSTEM_VERSION}`);
  const cssDir = join(dist, "css");
  const inline = (file: string, seen: Set<string>): string => {
    if (seen.has(file)) return "";
    seen.add(file);
    const text = readFileSync(join(cssDir, file), "utf8");
    return text
      .replace(/@import\s+"\.\/([\w.-]+\.css)";/g, (_match, name: string) => inline(name, seen))
      .replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_match, name: string) => `url(data:font/woff2;base64,${readFileSync(join(dist, "fonts", name)).toString("base64")})`);
  };
  const sheets = new Map<string, string>();
  const css = (entry: string): string => {
    if (!sheets.has(entry)) {
      const sheet = inline(entry, new Set());
      if (/url\(['"]?\.\.?\//.test(sheet)) throw new Error("a stylesheet of the design system points at a file that is not embedded");
      sheets.set(entry, sheet);
    }
    return sheets.get(entry)!;
  };
  // A closing tag inside the script would end the element early.
  const script = bundle(dist).replace(/<\/(script)/gi, "<\\/$1");
  assets = { css, script, dist };
  return assets;
}

/**
 * Every component the report can show. The bundle holds these and what they use themselves (an
 * nldd-sidebar-section brings its sheet), so not the whole design system: the full bundle,
 * nldd.min.js, is two and a half times as large. A test checks that the report uses no other.
 */
export const REPORT_COMPONENTS = [
  "nldd-shell", "nldd-page", "nldd-skip-link", "nldd-top-navigation-bar", "nldd-hero", "nldd-page-footer", "nldd-page-footer-legal-bar", "nldd-page-footer-legal-bar-item",
  "nldd-breadcrumbs", "nldd-breadcrumbs-item", "nldd-simple-section", "nldd-one-half-one-half-section", "nldd-one-third-two-thirds-section", "nldd-sidebar-section",
  "nldd-container", "nldd-spacer", "nldd-card", "nldd-title", "nldd-text", "nldd-rich-text", "nldd-tag", "nldd-banner", "nldd-image", "nldd-link", "nldd-button",
  "nldd-visually-hidden", "nldd-list", "nldd-list-item", "nldd-text-cell", "nldd-icon-cell", "nldd-table", "nldd-table-row", "nldd-tab-bar", "nldd-tab-bar-item", "nldd-sheet", "nldd-top-title-bar",
] as const;

/**
 * One classic script with the modules of the report's components, made with esbuild from the
 * package itself. The same package and the same esbuild give the same bytes. The licenses of what
 * is bundled stay, at the end of the script.
 */
function bundle(dist: string): string {
  const manifest = JSON.parse(readFileSync(join(dist, "..", "custom-elements.json"), "utf8")) as { modules: { path: string; declarations?: { tagName?: string }[] }[] };
  const moduleOf = new Map(manifest.modules.flatMap((module) => (module.declarations ?? []).filter((declaration) => declaration.tagName).map((declaration) => [declaration.tagName!, module.path] as const)));
  const files = [...new Set(REPORT_COMPONENTS.map((tag) => {
    const source = moduleOf.get(tag);
    if (!source) throw new Error(`@nldd/design-system ${DESIGN_SYSTEM_VERSION} has no component ${tag}`);
    return `./${source.replace(/^src\//, "").replace(/\.ts$/, ".js")}`;
  }))];
  const result = buildSync({
    stdin: { contents: files.map((file) => `import ${JSON.stringify(file)};`).join("\n"), resolveDir: dist, loader: "js" },
    absWorkingDir: dist,
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2022",
    legalComments: "eof",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

// ---------------------------------------------------------------- text

/** Text for an attribute, which `el` escapes: backticks of code are dropped, the words stay. */
function plain(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/`([^`]*)`/g, "$1");
}

function attr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text for a place that styles inline HTML (nldd-rich-text, nldd-text): code between backticks becomes code. */
function inline(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.split("`");
  if (parts.length < 3 || parts.length % 2 === 0) return attr(clean);
  return parts.map((part, index) => (index % 2 === 0 ? attr(part) : part === "" ? "" : `<code>${attr(part)}</code>`)).join("");
}

const upperFirst = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Paragraphs of a text that may hold blank lines. */
const paragraphs = (text: string): string => text.split(/\n\s*\n/).map((part) => `<p>${inline(part)}</p>`).join("");

const link = (href: string, text: string): string => `<a href="${attr(href)}">${text}</a>`;
/** A link in a table cell, where a plain anchor gets no style of the system. */
const cellLink = (href: string, label: string): string => el({ tag: "nldd-link", attrs: { href, text: plain(label) } });

/** An id in this document: what the Markdown uses as anchor, so a link into one works in the other. */
const ID = {
  criterion: (id: string): string => `sc-${id}`,
  appendix: (id: string): string => `bijlage-${id}`,
  open: (id: string): string => `open-${id}`,
};

// ---------------------------------------------------------------- building blocks

interface Element {
  tag: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  children?: string;
}

/** One element; attributes in the order given, a boolean as a bare attribute. */
function el({ tag, attrs = {}, children = "" }: Element): string {
  const list = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${typeof value === "number" ? value : attr(String(value))}"`))
    .join("");
  return `<${tag}${list}>${children}</${tag}>`;
}

const title = (text: string, level: number, size: number, extra: Element["attrs"] = {}): string => el({ tag: "nldd-title", attrs: { size, "heading-level": level, text: plain(text), ...extra } });
const rich = (html: string, attrs: Element["attrs"] = {}): string => (html ? el({ tag: "nldd-rich-text", attrs, children: html }) : "");
const text = (html: string, attrs: Element["attrs"] = {}): string => el({ tag: "nldd-text", attrs, children: html });
const spacer = (size: number, attrs: Element["attrs"] = {}): string => el({ tag: "nldd-spacer", attrs: { size, ...attrs } });
const stack = (children: string, attrs: Element["attrs"] = {}): string => el({ tag: "nldd-container", attrs, children });
const tag = (label: string, color = "neutral", attrs: Element["attrs"] = {}): string => el({ tag: "nldd-tag", attrs: { color, size: "sm", text: label, ...attrs } });
/** A row of tags; two or more are a list, so a screen reader hears where the group starts and how many there are (WCAG 1.3.1). */
const tags = (items: string[]): string => {
  if (items.length === 0) return "";
  if (items.length === 1) return stack(items[0]!, { layout: "wrap", gap: 8 });
  return stack(items.map((item) => item.replace(/^<nldd-tag /, '<nldd-tag role="listitem" ')).join(""), { layout: "wrap", gap: 8, role: "list" });
};
const list = (items: string[], ordered = false): string => (items.length > 0 ? `<${ordered ? "ol" : "ul"}>${items.map((item) => `<li>${item}</li>`).join("")}</${ordered ? "ol" : "ul"}>` : "");
const facts = (rows: [string, string][]): string => (rows.length > 0 ? `<dl>${rows.map(([name, value]) => `<dt>${attr(name)}</dt><dd>${value}</dd>`).join("")}</dl>` : "");
/**
 * A label above a block of text that is a heading for a screen reader, and looks like the bold label it was (WCAG 1.3.1).
 * `level` is its place under the heading above it; aria-level allows more than 6, so it is capped there.
 */
const subhead = (label: string, level: number): string => `<p role="heading" aria-level="${Math.min(level, 6)}" data-level="${Math.min(level, 6)}"><strong>${attr(label)}</strong></p>`;
/** A hash as code that may break every 8 characters, so it fits a narrow screen (WCAG 1.4.10); `<wbr>` adds no character, so a copy stays the same hash. */
const longCode = (value: string): string => `<code>${(attr(value).match(/.{1,8}/g) ?? []).join("<wbr>")}</code>`;

/**
 * A table of the design system: a header row and body rows of text cells. A cell is plain text, or HTML in its default slot.
 * No column is hidden on a narrow screen: what a column says stands nowhere else, so the table scrolls in its own box instead (WCAG 1.4.10).
 */
interface Column {
  label: string;
  /** A CSS grid track; its minimum keeps the column readable, and a table wider than the screen scrolls by itself. */
  track: string;
  numeric?: boolean;
}
type Cell = string | { html: string } | { text: string; supporting?: string };

function table(label: string, columns: Column[], rows: { cells: Cell[]; id?: string }[], header = true): string {
  const cell = (value: Cell, column: Column, index: number): string => {
    const common = { "row-header": index === 0 ? true : undefined, "horizontal-alignment": column.numeric ? "right" : undefined, "vertical-alignment": "top" };
    if (typeof value === "string") return el({ tag: "nldd-text-cell", attrs: { ...common, text: plain(value) } });
    // Inline markup reaches its style only inside a component that styles it, such as nldd-text.
    if ("html" in value) return el({ tag: "nldd-text-cell", attrs: common, children: value.html.startsWith("<nldd-") ? value.html : text(value.html) });
    return el({ tag: "nldd-text-cell", attrs: { ...common, text: plain(value.text), "supporting-text": value.supporting ? plain(value.supporting) : undefined } });
  };
  const head = header
    ? el({
        tag: "nldd-table-row",
        attrs: { slot: "header" },
        children: columns.map((column) => el({ tag: "nldd-text-cell", attrs: { text: column.label, "horizontal-alignment": column.numeric ? "right" : undefined } })).join(""),
      })
    : "";
  return el({
    tag: "nldd-table",
    attrs: { "accessible-label": label, columns: columns.map((column) => column.track).join(" ") },
    children: head + rows.map((row) => el({ tag: "nldd-table-row", attrs: { id: row.id }, children: row.cells.map((value, index) => cell(value, columns[index]!, index)).join("") })).join(""),
  });
}

// ---------------------------------------------------------------- outcomes

const OUTCOME_COLOR: Record<ShownOutcome, string> = { passed: "success", failed: "critical", inapplicable: "neutral", nothingFound: "warning", cantTell: "warning", untested: "neutral" };
const TEXT_COLOR: Record<ShownOutcome, string> = { passed: "success", failed: "critical", inapplicable: "secondary", nothingFound: "warning", cantTell: "warning", untested: "secondary" };
const SEVERITY_COLOR: Record<string, string> = { blokkerend: "critical", hoog: "critical", midden: "warning", laag: "neutral" };

const outcomeLabel = (outcome: ShownOutcome, derived: ReportDerived): string => `${OUTCOME_SYMBOL[outcome]} ${derived.outcomeLabel[outcome]}`;
const outcomeTag = (outcome: ShownOutcome, derived: ReportDerived): string => tag(outcomeLabel(outcome, derived), OUTCOME_COLOR[outcome]);
const severityTag = (severity: string): string => tag(`Ernst: ${severity}`, SEVERITY_COLOR[severity] ?? "neutral");

// ---------------------------------------------------------------- the render

interface Context {
  evaluation: Evaluation;
  derived: ReportDerived;
  pictures: CutoutPictures;
  labels: string[];
  titles: Map<string, string>;
  findings: Map<string, ReportFinding>;
  defects: Map<string, Defect>;
  criteria: Map<string, CriterionResult>;
  quiet: Set<string>;
  shots: Record<string, PageShot>;
  frame: HtmlFrame;
}

/** The chapters of the report and of the appendices: the table of contents is made from this list. */
interface Chapter {
  id: string;
  titleNl: string;
  body: string;
}

/**
 * The frame around the report. The content is the same in both.
 * - standalone: a page of its own, such as one per evaluated site, with a cover. Anyone may run
 *   loep, so it uses the open typeface and neither the logo nor the ribbon of the Rijksoverheid.
 * - embedded: no page, only the report, to go into a page of a site that has its own bar and footer:
 *   the title as an ordinary heading, then the summary and the chapters. The site loads the design
 *   system itself, so the fragment holds none of it; it brings only its own few rules and script.
 */
export type HtmlFrame = "standalone" | "embedded";

export interface HtmlOptions {
  /** Standalone (the default), or a fragment for a page of another site. */
  frame?: HtmlFrame;
  /** Per page label the picture of the page with the places of its findings, from `pageShots`. Without it the pages are a table. */
  pageShots?: Record<string, PageShot>;
  /**
   * True (the default) puts the stylesheets, fonts and components inside the file. False links to
   * them in the installed package instead: for `nldd lint --pure`, which cannot tell the system's
   * own stylesheet from one of the report once it is inside the page.
   */
  embed?: boolean;
}

export function renderHtml(input: Evaluation, decisions: DecisionLayer = { decisions: [], sha256: null }, pictures: CutoutPictures = {}, options: HtmlOptions = {}): string {
  const derived = deriveReport(input, decisions);
  const { evaluation } = withCurrentSignature(input);
  const labels = derived.pageLabels;
  const context: Context = {
    evaluation,
    derived,
    pictures,
    labels,
    titles: new Map([...evaluation.sample.items.map((item, index): [string, string] => [labels[index]!, item.title]), ...(derived.documents?.rows ?? []).map((row): [string, string] => [row.label, row.title])]),
    findings: new Map(allFindings(evaluation).map((finding) => [finding.id, finding])),
    defects: new Map((evaluation.defects ?? []).map((defect) => [defect.id, defect])),
    criteria: new Map(evaluation.criteria.map((criterion) => [criterion.id, criterion])),
    quiet: new Set(derived.quiet),
    shots: options.pageShots ?? {},
    frame: options.frame ?? "standalone",
  };
  const report: Chapter[] = [
    ...(evaluation.site.descriptionNl ? [{ id: "over-deze-website", titleNl: "Over deze website", body: rich(paragraphs(evaluation.site.descriptionNl)) }] : []),
    // The reader sees the own site first, with the defects on it.
    { id: "per-pagina", titleNl: context.defects.size > 0 || evaluation.defects ? "Gebreken per pagina" : "Bevindingen per pagina", body: byPage(context) },
    { id: "wat-nu", titleNl: "Wat nu", body: whatNext(context) },
    ...(derived.measures ? [{ id: "maatregelen", titleNl: REPORT_TEXT.measures.title, body: measures(context) }] : []),
    // The criteria follow the work list directly: what is wrong, then how each criterion came out.
    { id: "resultaten", titleNl: "Resultaten per criterium", body: results(context) },
    { id: "per-onderdeel", titleNl: "Bevindingen per onderdeel", body: byComponent(context) },
    { id: "onderzoeksgegevens", titleNl: "Onderzoeksgegevens", body: evaluationFacts(context) },
    { id: "scope", titleNl: "Scope", body: scope(context) },
    { id: "basisniveau", titleNl: "Basisniveau van ondersteuning", body: baseline(context) },
    { id: "steekproef", titleNl: "Steekproef", body: sample(context) },
    { id: "gereedschap", titleNl: "Gereedschap", body: tools(context) },
    { id: "betrouwbaarheid", titleNl: "Betrouwbaarheid en beperkingen", body: reliability(context) },
  ];
  const appendices: Chapter[] = [
    { id: "bijlage-a", titleNl: "Bijlage A: onderbouwing per criterium", body: appendixA(context) },
    { id: "bijlage-b", titleNl: "Bijlage B: herleidbaarheid", body: appendixB(context) },
    ...(derived.rechecks ? [{ id: "bijlage-c", titleNl: REPORT_TEXT.rechecks.title, body: appendixC(context) }] : []),
  ];
  const documentTitle = `${evaluation.site.name} · ${REPORT_TEXT.title}`;
  const frame = options.frame ?? "standalone";
  if (frame === "embedded") {
    return [
      `<!-- ${attr(documentTitle)}, versie van de evaluatie ${attr(derived.hashShort)}. ${attr(derived.madeWithShortNl)}. Zet dit fragment in een nldd-page van een pagina die @nldd/design-system ${DESIGN_SYSTEM_VERSION} laadt. Het script aan het eind schakelt de tabbladen en de knoppen Meer: zet een framework het fragment als tekst in de pagina, voer dat script dan zelf uit. -->`,
      `<style>${OWN_CSS}</style>`,
      pageTitle(context),
      summary(context),
      body(context, report, appendices),
      detailSheet(),
      `<script>${OWN_SCRIPT}</script>`,
      "",
    ].join("\n");
  }
  const embed = options.embed ?? true;
  const { css, script, dist } = loadAssets();
  const sheet = "global-open-font.css";
  return [
    "<!doctype html>",
    '<html lang="nl">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${attr(documentTitle)}</title>`,
    `<meta name="generator" content="${attr(derived.madeWithShortNl)}">`,
    // Machine-readable, as in the metadata of the PDF: the verdicts were drafted by a language model.
    `<meta name="keywords" content="${attr(derived.aiKeywords.join(", "))}">`,
    embed ? `<style>${css(sheet)}</style>` : `<link rel="stylesheet" href="${attr(pathToFileURL(join(dist, "css", sheet)).href)}">`,
    `<style>${OWN_CSS}</style>`,
    "</head>",
    "<body>",
    "<nldd-shell>",
    "<nldd-page>",
    // Without the logo bar the top bar has no room above its title on md and lg (6 px on sm only): a spacer gives it that room.
    el({ tag: "nldd-spacer", attrs: { slot: "header", size: 24, "sm-size": "12" } }),
    el({ tag: "nldd-skip-link", attrs: { slot: "header", text: "Direct naar de inhoud", href: "#samenvatting" }, children: el({ tag: "nldd-top-navigation-bar", attrs: { "no-logo": true, "website-title": REPORT_TEXT.title } }) }),
    cover(context),
    // The content: the same in either frame.
    summary(context),
    body(context, report, appendices),
    footer(context),
    "</nldd-page>",
    "</nldd-shell>",
    detailSheet(),
    embed ? `<script>${script}</script>` : `<script src="${attr(pathToFileURL(join(dist, "nldd.min.js")).href)}"></script>`,
    `<script>${OWN_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- cover and summary

function cover(context: Context): string {
  const { evaluation, derived } = context;
  // The same make as the hero of the site of loep (site/index.html), and as quiet: the name, where and
  // when, and whether it is signed. The outcome is the first thing in the summary under it.
  const facts = [link(evaluation.site.baseUrl, attr(evaluation.site.baseUrl)), ...alsoOnNl(evaluation).map((line) => inline(line.replace(/[<>]/g, ""))), `onderzocht op ${attr(derived.dateNl)}`].join(" · ");
  return el({
    tag: "nldd-hero",
    attrs: { "main-background": "accent", "padding-bottom": 0 },
    children: [
      title(evaluation.site.name, 1, 1, { color: "inherit" }),
      spacer(16),
      rich(`<p>${facts}</p>`, { color: "inherit" }),
      spacer(24),
      signedState(context, "inherit"),
      ...(derived.signatureStale ? [spacer(8), text(attr(REPORT_TEXT.staleSignature), { color: "inherit" })] : []),
    ].join(""),
  });
}

/** The status as one letter when both versions share it, or null. */
function statusLetter(derived: ReportDerived): "A" | "B" | "C" | null {
  const [legal, latest] = [derived.statusLine.status["2.1"], derived.statusLine.status["2.2"]];
  return legal === latest && legal !== "geen" ? legal : null;
}

/** In a page of another site the title is an ordinary heading at the top of the fragment. */
function pageTitle(context: Context): string {
  const { evaluation, derived } = context;
  return el({
    tag: "nldd-simple-section",
    attrs: { "padding-bottom": 0 },
    children: [
      title(`${REPORT_TEXT.title} ${evaluation.site.name}`, 1, 1, { slot: "header" }),
      rich(`<p>${link(evaluation.site.baseUrl, attr(evaluation.site.baseUrl))} · Onderzocht op ${attr(derived.dateNl)}</p>`),
      spacer(12),
      signedState(context),
      // In a fragment the tiles stand under the title; on a page of its own, in the summary.
      spacer(24),
      fingerprintImage(context),
    ].join(""),
  });
}

/**
 * Whether the report is signed: a short tag, and who signed it and when as text after it. A tag
 * does not wrap, so the whole sentence in one tag ran past the screen at 320 pixels.
 */
function signedState({ evaluation, derived }: Context, color?: string): string {
  const signature = evaluation.signature;
  if (!signature) return tag(REPORT_TEXT.concept, "neutral", { size: "md" });
  return stack([tag("Afgetekend", "success", { size: "md" }), text(`door ${attr(signature.role)} (${attr(signature.organisation)}) op ${attr(derived.signedDateNl ?? "")}`, color ? { color } : {})].join(""), { layout: "wrap", gap: 8, "vertical-alignment": "center" });
}

/** The letter of the status, or the whole heading when the two versions differ or there is none. */
function statusCard({ derived }: Context): string {
  const line = derived.statusLine;
  const letter = statusLetter(derived);
  const head = line.provisional ? "Voorlopige status" : "Status";
  const main = letter
    ? [text(attr(head), { size: "sm", weight: "medium" }), text(letter, { size: "display-1", "sm-custom-size": "72px", "md-custom-size": "88px", "lg-custom-size": "104px" }), text(attr(STATUS_LABEL[letter].replace(/^status \w \(|\)$/g, "")), { size: "lg", weight: "medium" })].join("")
    : [text(attr(head), { size: "sm", weight: "medium" }), spacer(8), title(line.headingNl.replace(/^[^:]+: /, ""), 3, 4)].join("");
  return el({
    tag: "nldd-card",
    attrs: { background: "accent-tinted" },
    children: stack([main, spacer(16), text(attr(line.noteNl ?? ""), { size: "sm" }), spacer(8), text(`${line.unfinished ? "<strong>Het onderzoek is onvolledig.</strong> " : ""}${inline(line.openNl)}`, { size: "sm" })].join(""), { padding: 24, "sm-padding": 16 }),
  });
}

/** The four numbers a reader asks for first, each with the shape of its outcome. */
function numberCards({ derived }: Context): string {
  const tally = derived.tally["2.2"];
  const open = tally.cantTell + tally.untested + tally.nothingFound;
  const cards: [string, number, ShownOutcome][] = [
    [derived.outcomeLabel.failed, tally.failed, "failed"],
    [derived.outcomeLabel.passed, tally.passed, "passed"],
    [derived.outcomeLabel.inapplicable, tally.inapplicable, "inapplicable"],
    ["Open", open, "cantTell"],
  ];
  return stack(
    cards
      .map(([label, count, outcome]) =>
        el({
          tag: "nldd-card",
          attrs: { role: "listitem" },
          children: stack([text(String(count), { size: "display-1", "lg-custom-size": "64px", color: count === 0 ? "secondary" : TEXT_COLOR[outcome] }), spacer(4), text(`${OUTCOME_SYMBOL[outcome]} ${attr(label)}`, { size: "md", weight: "medium" })].join(""), { padding: 20 }),
        }),
      )
      .join(""),
    { layout: "grid", "column-count": 2, gap: 16, role: "list" },
  );
}

/** One shape per criterion, a row per principle: the evaluation at a glance. The counts beside it say the same in words. */
/** The shown outcomes that are still open: they share one colour and one count on the cover. */
const OPEN_OUTCOMES: ShownOutcome[] = ["cantTell", "untested", "nothingFound"];
const TILE_FILL: Record<ShownOutcome, string> = { passed: "#2b7a3d", failed: "#c22a1f", inapplicable: "#8a94a1", nothingFound: "#b07800", cantTell: "#b07800", untested: "#b07800" };

/**
 * One tile per criterion of WCAG 2.2, a row per principle, coloured and marked with the shape of
 * its outcome: the evaluation at a glance. An image with the counts as its text alternative.
 */
function fingerprintImage({ evaluation, derived }: Context, attrs: Element["attrs"] = {}): string {
  const relevant = evaluation.criteria.filter((criterion) => criterion.versions.includes("2.2"));
  const principles = groupCriteria(relevant, 1);
  const [tile, gap, labelWidth, rowGap, margin] = [24, 5, 150, 12, 20];
  const most = Math.max(...principles.map((principle) => principle.criteria.length));
  const width = margin * 2 + labelWidth + most * (tile + gap) - gap;
  const height = margin * 2 + principles.length * tile + (principles.length - 1) * rowGap;
  const svgText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = principles.map((principle, row) => {
    const y = margin + row * (tile + rowGap);
    const tiles = principle.criteria.map((criterion, index) => {
      const outcome = derived.shown[criterion.id]!;
      const x = margin + labelWidth + index * (tile + gap);
      return `<rect x="${x}" y="${y}" width="${tile}" height="${tile}" rx="4" fill="${TILE_FILL[outcome]}" /><text x="${x + tile / 2}" y="${y + tile / 2 + 1}" class="mark">${svgText(OUTCOME_SYMBOL[outcome])}</text>`;
    });
    return `<text x="${margin}" y="${y + tile / 2 + 1}" class="label">${svgText(`${principle.key} ${principle.name}`)}</text>${tiles.join("")}`;
  });
  // Inside the picture, so it follows light and dark like the page around it.
  const style = ".bg{fill:#eef1f5}.label{fill:#1f2933}@media (prefers-color-scheme:dark){.bg{fill:#1c222b}.label{fill:#e4e8ee}}";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<style>.label{font:600 14px system-ui,sans-serif;dominant-baseline:middle}.mark{fill:#fff;font:700 14px system-ui,sans-serif;text-anchor:middle;dominant-baseline:middle}${style}</style>`,
    `<rect class="bg" width="${width}" height="${height}" rx="8"/>`,
    ...rows,
    "</svg>",
  ].join("");
  const tally = derived.tally["2.2"];
  const open = OPEN_OUTCOMES.reduce((sum, outcome) => sum + tally[outcome], 0);
  const alt = `Uitkomst per criterium van WCAG 2.2 niveau A en AA, één vak per criterium: ${tally.failed} ${derived.outcomeLabel.failed.toLowerCase()}, ${tally.passed} ${derived.outcomeLabel.passed.toLowerCase()}, ${tally.inapplicable} ${derived.outcomeLabel.inapplicable.toLowerCase()}, ${open} open.`;
  return el({ tag: "nldd-image", attrs: { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, alt, width, "aspect-ratio": `${width}/${height}`, "object-fit": "contain", loading: "eager", ...attrs } });
}

function topList(context: Context): string {
  const { derived, defects } = context;
  if (derived.defects) {
    const top = derived.defects.topIds.map((id) => defects.get(id)!);
    if (top.length === 0) return rich("<p>Er zijn geen gebreken.</p>");
    return [
      el({
        tag: "nldd-list",
        attrs: { "accessible-label": "Zwaarste gebreken", appearance: "box-base" },
        children: top
          .map((defect) =>
            el({
              tag: "nldd-list-item",
              attrs: { href: `#${defect.id}` },
              children: [
                el({ tag: "nldd-text-cell", attrs: { text: plain(defect.titleNl), "supporting-text": plain(`Ernst ${defect.severity} · ${[defect.mainCriterion, ...defect.alsoCriteria].join(", ")} · ${derived.defects!.pagesNl[defect.id]}`) } }),
                el({ tag: "nldd-icon-cell", attrs: { icon: "chevron-right", size: 20, color: "secondary" } }),
              ].join(""),
            }),
          )
          .join(""),
      }),
      spacer(8),
      text(inline(derived.defects.topNoteNl), { size: "sm", color: "secondary" }),
    ].join("");
  }
  const top = derived.topFindingIds.map((id) => context.findings.get(id)!);
  if (top.length === 0) return rich("<p>Er zijn geen bevindingen.</p>");
  return [
    el({
      tag: "nldd-list",
      attrs: { "accessible-label": "Zwaarste bevindingen", appearance: "box-base" },
      children: top
        .map((finding) =>
          el({
            tag: "nldd-list-item",
            attrs: { href: `#${finding.id}` },
            children: [el({ tag: "nldd-text-cell", attrs: { text: plain(finding.titleNl), "supporting-text": plain(`Ernst ${finding.severity} · ${finding.criterion} · ${finding.pagesAffected}`) } }), el({ tag: "nldd-icon-cell", attrs: { icon: "chevron-right", size: 20, color: "secondary" } })].join(""),
          }),
        )
        .join(""),
    }),
    spacer(8),
    text(inline(derived.topFindingsNoteNl), { size: "sm", color: "secondary" }),
  ].join("");
}

function scoreTable({ evaluation, derived }: Context, version: WcagVersion): string {
  const relevant = evaluation.criteria.filter((criterion) => criterion.versions.includes(version));
  const order = derived.outcomeOrder;
  const tally = derived.tally[version];
  const columns: Column[] = [{ label: "Principe", track: "minmax(8.5rem, 3fr)" }, ...order.map((outcome) => ({ label: outcomeLabel(outcome, derived), track: "minmax(5.5rem, 1fr)", numeric: true })), { label: "Totaal", track: "minmax(3rem, 1fr)", numeric: true }];
  const rows = groupCriteria(relevant, 1).map((group) => ({ cells: [`${group.key} ${group.name}`, ...order.map((outcome) => String(group.criteria.filter((criterion) => derived.shown[criterion.id] === outcome).length)), String(group.criteria.length)] as Cell[] }));
  rows.push({ cells: ["**Totaal**", ...order.map((outcome): Cell => `**${tally[outcome]}**`), `**${tally.total}**`] });
  return table(`WCAG ${version} niveau A en AA, uitkomst per principe`, columns, rows);
}

function summary(context: Context): string {
  const { derived, evaluation } = context;
  const forB = derived.forB
    ? el({
        tag: "nldd-card",
        attrs: { background: "tinted" },
        children: stack(
          [title("Wat er nog ontbreekt voor status B", 3, 5), spacer(8), rich(`<p>Waarop de uitkomsten rusten: ${inline(derived.forB.basisNl)}</p>${derived.forB.doneNl ? `<p>${inline(derived.forB.doneNl)}</p>` : list(derived.forB.openNl.map((row) => `${link(`#${ID.criterion(row.criterion)}`, attr(row.criterion))}: ${inline(row.closesNl)}`))}`)].join(""),
          { padding: 20 },
        ),
      })
    : "";
  return [
    el({
      tag: "nldd-one-third-two-thirds-section",
      attrs: { id: "samenvatting" },
      children: [
        stack([title("Samenvatting", 2, 2), spacer(12), text(inline(derived.statusSentenceNl), { size: "lg" })].join(""), { slot: "header" }),
        stack(statusCard(context), { slot: "left" }),
        stack([numberCards(context), ...(derived.defects ? [spacer(12), text(`Het onderzoek vond ${inline(derived.defects.countsNl)}.`, { color: "secondary" })] : []), ...(context.frame === "standalone" ? [spacer(24), fingerprintImage(context)] : [])].join(""), { slot: "right" }),
      ].join(""),
    }),
    el({
      tag: "nldd-one-half-one-half-section",
      attrs: { "padding-top": 0 },
      children: [
        stack([title(derived.defects ? "Zwaarste gebreken" : "Zwaarste bevindingen", 3, 4), spacer(12), topList(context)].join(""), { slot: "left" }),
        stack([title("Wat betekent dit", 3, 4), spacer(8), rich(derived.meaningNl.map((paragraph) => `<p>${inline(paragraph)}</p>`).join(""))].join(""), { slot: "right" }),
      ].join(""),
    }),
    el({
      tag: "nldd-simple-section",
      attrs: { "padding-top": 0 },
      children: [
        ...(forB ? [forB, spacer(24)] : []),
        ...VERSIONS.flatMap((version) => [title(`WCAG ${version} niveau A en AA (${evaluation.summary[version].total} criteria)`, 3, 5), spacer(8), scoreTable(context, version), spacer(24)]),
        text(inline(derived.scoreNoteNl), { size: "sm", color: "secondary" }),
      ].join(""),
    }),
  ].join("\n");
}

// ---------------------------------------------------------------- the body: table of contents, tabs and chapters

function body(context: Context, report: Chapter[], appendices: Chapter[]): string {
  // No row is marked as the current one: the design system marks it with a grey block alone, which fails
  // WCAG 1.4.1 and 1.4.11, and the heading on the screen already says where the reader is.
  const row = (chapter: Chapter): string =>
    el({ tag: "nldd-list-item", attrs: { href: `#${chapter.id}`, "current-type": "location" }, children: el({ tag: "nldd-text-cell", attrs: { text: plain(chapter.titleNl) } }) });
  const toc = stack(
    [
      title("In dit rapport", 2, 5, { id: "inhoud-kop" }),
      spacer(8),
      el({ tag: "nldd-list", attrs: { type: "navigation", appearance: "simple", dividers: "never", "accessible-label": "In dit rapport" }, children: [row({ id: "samenvatting", titleNl: "Samenvatting", body: "" }), ...report.map((chapter) => row(chapter)), ...appendices.map((chapter) => row(chapter))].join("") }),
    ].join(""),
    { slot: "sidebar", padding: 16, "padding-bottom": 8 },
  );
  const chapter = (item: Chapter): string => [title(item.titleNl, 2, 2, { id: item.id }), spacer(24), item.body, spacer(64)].join("");
  const panel = (id: string, tab: string, chapters: Chapter[], hidden: boolean): string => el({ tag: "nldd-container", attrs: { id, role: "tabpanel", "aria-labelledby": tab, hidden }, children: chapters.map(chapter).join("") });
  return el({
    tag: "nldd-sidebar-section",
    attrs: { "sidebar-label": "In dit rapport", grow: true },
    children: [
      el({ tag: "nldd-button", attrs: { slot: "header", id: "inhoud-openen", appearance: "secondary", "start-icon": "bullet-list", text: "In dit rapport", "popup-type": "dialog" } }),
      toc,
      el({
        tag: "nldd-tab-bar",
        attrs: { "accessible-label": "Rapport en bijlagen", id: "delen" },
        children: [el({ tag: "nldd-tab-bar-item", attrs: { id: "tab-rapport", text: "Rapport", controls: "deel-rapport", current: true } }), el({ tag: "nldd-tab-bar-item", attrs: { id: "tab-bijlagen", text: "Bijlagen", controls: "deel-bijlagen" } })].join(""),
      }),
      spacer(40),
      panel("deel-rapport", "tab-rapport", report, false),
      panel("deel-bijlagen", "tab-bijlagen", appendices, true),
    ].join("\n"),
  });
}

function footer({ derived }: Context): string {
  return el({
    tag: "nldd-page-footer",
    attrs: { slot: "footer", "no-ribbon": true },
    children: el({
      tag: "nldd-page-footer-legal-bar",
      attrs: { slot: "legal-bar", "accessible-label": "Over dit rapport" },
      children: [el({ tag: "nldd-page-footer-legal-bar-item", attrs: { slot: "start", text: plain(derived.madeWithShortNl) } }), el({ tag: "nldd-page-footer-legal-bar-item", attrs: { slot: "end", text: `Versie van de evaluatie ${derived.hashShort}` } })].join(""),
    }),
  });
}

// ---------------------------------------------------------------- what next

const capitalised = (owner: string): string => upperFirst(owner);

/** Where a finding is, in words of the page first: a heading and a text can be searched for in any source, a selector only in the HTML. */
function whereItems(finding: ReportFinding, titles: Map<string, string>): string[] {
  return finding.locations.map((location) => {
    const words = [location.heading ? `onder de kop “${inline(location.heading)}”` : "", location.text ? `bij “${inline(location.text)}”` : "", `<code>${attr(location.where.replace(/`/g, "").replace(/\s+/g, " ").trim())}</code>`].filter((part) => part !== "");
    return `<strong>${attr(location.page)}</strong>${titles.has(location.page) ? ` ${attr(titles.get(location.page)!)}` : ""}: ${words.join(", ")}`;
  });
}

function picture(finding: ReportFinding, pictures: CutoutPictures): string {
  const found = pictures[finding.id];
  if (!found) return "";
  return el({ tag: "nldd-image", attrs: { src: found.file, alt: plain(found.altNl), width: found.width, "aspect-ratio": found.width && found.height ? `${found.width}/${found.height}` : undefined, "object-fit": "contain", loading: "eager", shape: "rounded" } });
}

/** Words that end with a full stop without ending the sentence. */
const ABBREVIATIONS = /(?:^|\s)(?:bijv|bv|bijvoorbeeld|o\.a|e\.d|enz|nl|ca|zgn|resp|d\.w\.z|i\.p\.v|m\.b\.v|m\.n|t\.o\.v|incl|excl|max|min|vgl|z\.o\.z)\.$/i;

/** The first sentence of a text, for a card that shows little; a sentence stops at a full stop outside code. */
export function firstSentence(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  let inCode = false;
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index]!;
    if (character === "`") inCode = !inCode;
    if (inCode || !".!?".includes(character) || (index + 1 < clean.length && clean[index + 1] !== " ")) continue;
    const head = clean.slice(0, index + 1);
    if (ABBREVIATIONS.test(head) || /\d\.$/.test(head)) continue;
    return head;
  }
  return clean;
}

/**
 * The short form of a finding on a card: the start of the fix, and a button to the rest. The rest
 * stands right under it, hidden: the button shows it in a sheet, and printing shows it in place.
 */
function findingBrief(finding: ReportFinding, titleNl: string, titles: Map<string, string>, level: number): string {
  const start = firstSentence(finding.fixNl);
  return [
    rich(`<p><strong>Oplossing:</strong> ${inline(start)}${start.length < finding.fixNl.replace(/\s+/g, " ").trim().length ? " \u2026" : ""}</p>`, { spacing: "tight" }),
    spacer(12),
    el({ tag: "nldd-button", attrs: { id: `meer-${finding.id}`, appearance: "secondary", size: "sm", text: "Meer", "accessible-label": `Meer over ${plain(titleNl)}`, "popup-type": "dialog", "end-icon": "chevron-right" } }),
    el({ tag: "nldd-container", attrs: { id: `details-${finding.id}`, hidden: true, "padding-top": 16 }, children: findingText(finding, titles, level + 1) }),
  ].join("");
}

/** What is wrong, who suffers, the fix and where: the four parts every finding has, under labels. */
function findingText(finding: ReportFinding, titles: Map<string, string>, level: number): string {
  return rich(
    [
      `${subhead("Wat is er mis", level)}<p>${inline(finding.observedNl)}</p>`,
      `${subhead("Wie heeft er last van", level)}<p>${inline(finding.impactNl)}</p>`,
      `${subhead("Oplossing", level)}<p>${inline(finding.fixNl)}</p>`,
      `${subhead("Waar", level)}${list(whereItems(finding, titles))}`,
    ].join(""),
    { spacing: "tight" },
  );
}

function findingFacts(finding: ReportFinding, derived: ReportDerived): string[] {
  return [
    severityTag(finding.severity),
    tag(`Eigenaar: ${finding.owner}`),
    ...(finding.vendorTags ?? []).map((name) => tag(`Leverancier: ${name}`, "accent")),
    ...(finding.verification ? [tag(VERIFICATION_TAG[finding.verification.status])] : []),
  ];
}

/**
 * The verification of a finding in a few words: a tag does not wrap (nldd-tag, design-system#428),
 * so a longer label is cut off on a narrow screen. The full sentence stays in the Markdown report,
 * and the section on the method says what the rounds are.
 */
const VERIFICATION_TAG: Record<"reproduced" | "unverified" | "repeated", string> = {
  reproduced: "Bevestigd",
  unverified: "Eén keer gezien",
  repeated: "Twee keer gezien",
};

/** A defect in the work list: its main finding in full, with the cutout, and links to the other findings. */
function defectCard(defect: Defect, context: Context, level: number): string {
  const { derived, findings, titles, pictures } = context;
  const main = findings.get(defect.mainFindingId)!;
  const others = defect.findingIds.filter((id) => id !== defect.mainFindingId);
  const toCriterion = (id: string): string => link(`#${ID.criterion(id)}`, attr(id));
  const criteriaNl = `${attr(REPORT_TEXT.defect.main)} ${toCriterion(defect.mainCriterion)}${defect.alsoCriteria.length > 0 ? `, ${attr(REPORT_TEXT.defect.also.toLowerCase())} ${defect.alsoCriteria.map(toCriterion).join(", ")}` : ""}`;
  const meta = rich(
    `<p>${criteriaNl}.${main.component ? ` Onderdeel: ${inline(main.component)}.` : ""} Pagina's: ${attr(derived.defects!.pagesNl[defect.id]!.replace(/\.$/, ""))}. ${others.length > 0 ? `Ook ${others.length === 1 ? "bevinding" : "bevindingen"} ${others.map((id) => link(`#${id}`, attr(id))).join(", ")}.` : ""}</p>`,
    { spacing: "tight" },
  );
  return el({
    tag: "nldd-card",
    attrs: { id: defect.id },
    children: stack(
      [
        title(defect.titleNl, level, 4, { "supporting-text": `${defect.id} · bevinding ${defect.mainFindingId}`, id: main.id }),
        spacer(12),
        tags(findingFacts(main, derived)),
        spacer(12),
        meta,
        ...(pictures[main.id] ? [spacer(16), picture(main, pictures)] : []),
        spacer(16),
        findingBrief(main, defect.titleNl, titles, level),
      ].join(""),
      { padding: 24, "sm-padding": 16 },
    ),
  });
}

function openGroups(context: Context, groups: [string, string[], OpenGroup[]][]): string {
  const { criteria } = context;
  return groups
    .filter(([, , items]) => items.length > 0)
    .map(([heading, intro, items]) =>
      [
        title(heading, 4, 5),
        spacer(8),
        rich(intro.map((paragraph) => `<p>${paragraph}</p>`).join("")),
        spacer(12),
        rich(
          list(
            items.map((item) => {
              const criterion = criteria.get(item.criterion)!;
              const head = `${link(`#${ID.criterion(criterion.id)}`, `${attr(criterion.id)} ${attr(criterion.titleNl)}`)} (${attr(item.outcomeNl)})`;
              return `${item.anchor ? `<span id="${ID.open(criterion.id)}"></span>` : ""}${head}${list(item.pointsNl.map(inline))}`;
            }),
          ),
        ),
        spacer(24),
      ].join(""),
    )
    .join("");
}

function whatNext(context: Context): string {
  const { derived, defects, findings, criteria } = context;
  const parts: string[] = [rich(`<p>${attr(REPORT_TEXT.todoIntro)}</p>`), spacer(32), title("Oplossen", 3, 3), spacer(12)];
  if (derived.todo.person.length > 0) {
    parts.push(title(REPORT_TEXT.personFailed, 4, 5), spacer(8), rich(`<p>${attr(REPORT_TEXT.personFailedIntro)}</p>${list(derived.todo.person.map((item) => `${link(`#${ID.criterion(item.criterion)}`, `${attr(item.criterion)} ${attr(criteria.get(item.criterion)!.titleNl)}`)}: ${inline(item.textNl)}`))}`), spacer(24));
  }
  if (derived.todo.fix.length === 0) parts.push(rich("<p>Er zijn geen bevindingen om op te lossen.</p>"));
  else if (derived.defects) {
    parts.push(rich(`<p>${attr(REPORT_TEXT.defectIntro)}</p>`), spacer(24));
    // The whole list first, as the PDF has it, so the cards below can be long without losing the overview.
    parts.push(
      table(
        "Werklijst",
        [
          { label: "Gebrek", track: "minmax(10rem, 3fr)" },
          { label: "Eigenaar", track: "minmax(6rem, 0.8fr)" },
          { label: "Ernst", track: "minmax(5.5rem, 0.7fr)" },
          { label: "Criterium", track: "minmax(5rem, 0.8fr)" },
          { label: "Pagina's", track: "minmax(6rem, 1fr)" },
        ],
        derived.defects.fix.flatMap((group) =>
          group.defectIds.map((id) => {
            const defect = defects.get(id)!;
            return { cells: [{ html: cellLink(`#${defect.id}`, defect.titleNl) }, capitalised(group.owner), defect.severity, [defect.mainCriterion, ...defect.alsoCriteria].join(", "), derived.defects!.pagesNl[defect.id]!] as Cell[] };
          }),
        ),
      ),
      spacer(24),
      rich(`<p>${attr(REPORT_TEXT.adviceNote)}</p>`),
      spacer(40),
    );
    for (const group of derived.defects.fix) {
      parts.push(title(`${capitalised(group.owner)} (${group.defectIds.length})`, 4, 4), spacer(16));
      parts.push(stack(group.defectIds.map((id) => defectCard(defects.get(id)!, context, 5)).join(""), { gap: 24 }), spacer(40));
    }
  } else {
    parts.push(rich(`<p>${attr(REPORT_TEXT.fixIntro)}</p><p>${attr(REPORT_TEXT.adviceNote)}</p>`), spacer(24));
    for (const group of derived.todo.fix) {
      parts.push(title(capitalised(group.owner), 4, 4), spacer(12));
      parts.push(
        el({
          tag: "nldd-list",
          attrs: { "accessible-label": `Bevindingen voor ${group.owner}`, appearance: "box-base" },
          children: group.findingIds
            .map((id) => findings.get(id)!)
            .map((finding) => el({ tag: "nldd-list-item", attrs: { href: `#${finding.id}` }, children: [el({ tag: "nldd-text-cell", attrs: { text: plain(finding.titleNl), "supporting-text": plain(`Ernst ${finding.severity} · ${finding.criterion} · ${finding.id}`) } }), el({ tag: "nldd-icon-cell", attrs: { icon: "chevron-right", size: 20, color: "secondary" } })].join("") }))
            .join(""),
        }),
        spacer(32),
      );
    }
  }
  if (derived.todo.vendor && derived.todo.vendor.elements.length > 0) {
    parts.push(
      title(`Raakt een component van ${derived.todo.vendor.nameNl}`, 3, 3),
      spacer(12),
      rich(`<p>${attr(REPORT_TEXT.vendorIntro)}</p>`),
      spacer(16),
      table(
        `Bevindingen per element van ${derived.todo.vendor.nameNl}`,
        [
          { label: "Element", track: "minmax(8rem, 1fr)" },
          { label: "Bevindingen", track: "minmax(10rem, 2fr)" },
        ],
        derived.todo.vendor.elements.map((element) => ({ cells: [{ html: `<code>${attr(element.tag)}</code>` }, { html: stack(element.findingIds.map((id) => cellLink(`#${id}`, id)).join(""), { layout: "wrap", gap: 8 }) }] })),
      ),
      spacer(40),
    );
  }
  parts.push(title("Nog uitzoeken", 3, 3), spacer(12));
  const open = derived.todo.investigate;
  if (open.owner.length + (open.notSent?.items.length ?? 0) + open.unreachable.length + open.unsorted.length + open.toolbox.length === 0) parts.push(rich("<p>Er zijn geen open punten.</p>"));
  else {
    parts.push(rich(`<p>${attr(REPORT_TEXT.investigateIntro)}</p>`), spacer(24));
    parts.push(
      openGroups(context, [
        [REPORT_TEXT.investigate.owner, [attr(REPORT_TEXT.investigate.ownerIntro)], open.owner],
        ...(open.notSent ? [[REPORT_TEXT.investigate.notSent, [attr(REPORT_TEXT.investigate.notSentIntro), `${attr(open.notSent.declarationNl)} <code>${attr(open.notSent.flags)}</code>`, inline(open.notSent.originNl)], open.notSent.items] as [string, string[], OpenGroup[]]] : []),
        [REPORT_TEXT.investigate.unreachable, [attr(REPORT_TEXT.investigate.unreachableIntro)], open.unreachable],
        [REPORT_TEXT.investigate.unsorted, [attr(REPORT_TEXT.investigate.unsortedIntro)], open.unsorted],
      ]),
    );
    if (open.toolbox.length > 0) {
      parts.push(
        title(REPORT_TEXT.investigate.toolbox, 4, 5),
        spacer(8),
        rich(
          `<p>${attr(REPORT_TEXT.investigate.toolboxIntro)}</p>${list(
            open.toolbox.map((item) => {
              const criterion = criteria.get(item.criterion)!;
              return `${item.anchor ? `<span id="${ID.open(criterion.id)}"></span>` : ""}${link(`#${ID.criterion(criterion.id)}`, `${attr(criterion.id)} ${attr(criterion.titleNl)}`)} (${attr(item.outcomeNl)}): ${attr(item.countNl)} (${attr(item.kindsNl)}), zie ${link(`#${ID.appendix(criterion.id)}`, "bijlage A")}${item.coverageNl ? `. ${attr(REPORT_TEXT.measured)}: ${inline(item.coverageNl)}` : ""}`;
            }),
          )}`,
        ),
      );
    }
  }
  if (derived.recommendations.length > 0) {
    parts.push(spacer(40), title(REPORT_TEXT.recommendations, 3, 3), spacer(12), rich(`<p>${attr(REPORT_TEXT.recommendationsIntro)}</p>`), spacer(16));
    parts.push(
      stack(
        derived.recommendations
          .map((item) => {
            const criterion = criteria.get(item.criterion)!;
            return el({
              tag: "nldd-card",
              attrs: { id: item.id, background: "tinted" },
              children: stack(
                [
                  title(item.titleNl, 4, 5, { "supporting-text": `${item.id} · bij ${criterion.id} ${criterion.titleNl}, aanbeveling ${item.rule} van de procedure` }),
                  spacer(12),
                  rich(`${subhead("Gezien", 5)}<p>${inline(item.observedNl)}</p>${subhead("Aanbeveling", 5)}<p>${inline(item.recommendationNl)}</p>${subhead("Waar", 5)}${list(item.placesNl.map(inline))}`, { spacing: "tight" }),
                ].join(""),
                { padding: 20 },
              ),
            });
          })
          .join(""),
        { gap: 16 },
      ),
    );
  }
  return parts.join("");
}

function measures({ derived }: Context): string {
  const data = derived.measures!;
  return [
    rich(`<p>${attr(REPORT_TEXT.measures.intro)}</p><p><strong>${attr(data.countsNl)}</strong></p>`),
    spacer(16),
    rich(
      list(
        data.rows.map(
          (row) =>
            `<strong>${inline(row.titleNl)}</strong> (${link(`#${row.defectId}`, attr(row.defectId))}), ${attr(row.severity)}, ${attr(row.criteriaNl)}: <strong>${attr(row.decisionNl)}</strong>${list([
              ...(row.remeasured.length > 0 ? [`${attr(REPORT_TEXT.measures.remeasured.lead)}: ${row.remeasured.map((entry) => link(`#${entry.anchor}`, attr(entry.findingId))).join(", ")}. ${attr(REPORT_TEXT.measures.remeasured.clause)}`] : []),
              ...row.linesNl.map(inline),
            ])}`,
        ),
      ) + `<p>${inline(data.layerNl)}</p>`,
    ),
  ].join("");
}

// ---------------------------------------------------------------- facts about the evaluation

function evaluationFacts({ evaluation, derived }: Context): string {
  const signature = evaluation.signature;
  const staleNote = derived.signatureStale ? ` ${REPORT_TEXT.staleSignature}` : "";
  const rows: [string, string][] = [
    ["Site", attr(evaluation.site.name)],
    ["URL", link(evaluation.site.baseUrl, attr(evaluation.site.baseUrl))],
    ...alsoOnNl(evaluation).map((line): [string, string] => ["Ook onderdeel van de site", attr(line.replace(/^[^:]+: /, "").replace(/[<>]/g, ""))]),
    ["Organisatie", attr(evaluation.site.organisation || "niet opgegeven")],
    ["Datum", attr(derived.dateNl)],
    ["Norm", [...evaluation.standards.wcag, evaluation.standards.en301549].map(inline).join("; ")],
    ["Methode", link(evaluation.method.url, `${attr(evaluation.method.name)} ${attr(evaluation.method.version)}`)],
    ["Type onderzoek", inline(evaluation.method.typeNl)],
    [REPORT_TEXT.madeWith, inline(derived.instrumentNl)],
    ["Uitgevoerd door", attr(REPORT_TEXT.performedBy.toLowerCase())],
    ...(derived.followsUpNl ? [[REPORT_TEXT.followsUp, inline(derived.followsUpNl)] as [string, string]] : []),
    ...(derived.chain.writesNl ? [["Versturen van formulieren", inline(derived.chain.writesNl)] as [string, string]] : []),
    ...(derived.chain.readsNl ? [["Leesverzoeken", inline(derived.chain.readsNl)] as [string, string]] : []),
    [
      "Afgetekend door",
      signature ? `${attr(signature.role)}, ${attr(signature.organisation)}, op ${attr(derived.signedDateNl!)}${derived.signatureRecordedNl ? `, ${inline(derived.signatureRecordedNl)}` : ""}` : `${attr(REPORT_TEXT.notSigned.toLowerCase())}${staleNote ? `.${attr(staleNote)}` : ""}`,
    ],
  ];
  return rich(
    [
      facts(rows),
      ...(signature ? [`<p>Verklaring bij de ondertekening: ${inline(signature.statementNl)}</p><p>Getekend voor evaluatie <code>${attr(signature.evaluationSha256.slice(0, 12))}</code>, verzegeld als <code>${attr(signature.sealSha256.slice(0, 12))}</code>.</p>`] : []),
      ...(evaluation.method.deviationsNl.length > 0 ? [`<p>Afwijkingen van de methode:</p>${list(evaluation.method.deviationsNl.map(inline))}`] : []),
    ].join(""),
  );
}

function scope({ evaluation, derived }: Context): string {
  return rich(
    [
      `<h3 id="binnen-de-scope">Binnen de scope</h3>${list(evaluation.scope.includedNl.map(inline))}`,
      `<h3 id="buiten-de-scope">Buiten de scope</h3>${evaluation.scope.excludedNl.length > 0 ? list(evaluation.scope.excludedNl.map(inline)) : "<p>Niets uitgesloten.</p>"}`,
      ...(derived.scopeFramesNl.length > 0 ? [`<h3 id="ingesloten-vensters">${attr(REPORT_TEXT.scopeFrames)}</h3>${list(derived.scopeFramesNl.map(inline))}`] : []),
    ].join(""),
  );
}

function baseline({ evaluation }: Context): string {
  const note = evaluation.baseline.noteNl || (evaluation.baseline.assistiveTechnology.length === 0 ? REPORT_TEXT.noAssistiveTechnology : "");
  return rich(
    [
      `<h3 id="browsers">Browsers</h3>${list(evaluation.baseline.browsers.map((browser) => `${attr(browser.name)} ${browser.version ? attr(browser.version) : "(versie onbekend)"}, motor ${attr(browser.engine)}`))}`,
      evaluation.baseline.assistiveTechnology.length === 0 ? "<p>Hulpsoftware: geen.</p>" : `<h3 id="hulpsoftware">Hulpsoftware</h3>${list(evaluation.baseline.assistiveTechnology.map((tool) => `${attr(tool.name)} ${attr(tool.version)}`))}`,
      note ? `<p>${inline(note)}</p>` : "",
      `<p>Technologieën waarop de site steunt: ${evaluation.technologies.map(inline).join(", ")}.</p>`,
    ].join(""),
  );
}

function sample(context: Context): string {
  const { evaluation, derived, labels } = context;
  const parts = [
    rich(
      `<p>${inline(evaluation.sample.note)}</p>${facts([
        ["Werkwijze", attr(REPORT_TEXT.sampleMethod[evaluation.sample.method])],
        ["Unieke pagina's in de inventaris", String(evaluation.sample.populationSize)],
        ["Onderzochte pagina's", String(evaluation.sample.items.length)],
        ["Seed voor de willekeurige keuze", `<code>${attr(evaluation.sample.seed)}</code>`],
      ])}`,
    ),
    spacer(16),
    table(
      "Pagina's in de steekproef",
      [
        { label: "Pagina", track: "minmax(10rem, 2fr)" },
        { label: "Soort", track: "minmax(6rem, 1fr)" },
        { label: "Reden", track: "minmax(10rem, 3fr)" },
      ],
      evaluation.sample.items.map((item, index) => {
        const states = evaluation.measuredStates?.[labels[index]!] ?? [];
        const extra = [...(item.aliases.length > 0 ? [`Dezelfde inhoud staat ook op: ${item.aliases.join(", ")}`] : []), ...(states.length > 0 ? [`${REPORT_TEXT.measuredStates}: ${states.join(", ")}`] : [])];
        return {
          cells: [
            { text: `${labels[index]!} ${item.title || "(geen titel)"}`, supporting: item.url },
            REPORT_TEXT.sampleKind[item.kind],
            { text: item.reason, supporting: extra.length > 0 ? extra.join(". ") : undefined },
          ],
        };
      }),
    ),
  ];
  if (evaluation.sample.pageTypes) {
    parts.push(
      spacer(32),
      title("Paginatypen", 3, 4),
      spacer(8),
      rich(`<p>${attr(REPORT_TEXT.samplePageTypes)}</p>${list(evaluation.sample.pageTypes.map((type) => `<strong>${attr(type.id)}</strong>${type.descriptionNl ? ` (${inline(type.descriptionNl)})` : ""}: ${type.pages} ${type.pages === 1 ? "pagina" : "pagina's"}, ${type.examined} bekeken: ${inline(type.reasonNl)}.`))}`),
    );
  }
  if (derived.documents) {
    parts.push(
      spacer(32),
      title("Documenten", 3, 4),
      spacer(8),
      rich(facts(derived.documents.factsNl.map(([name, value]): [string, string] => [name, inline(value)])) + list(derived.documents.rows.map((row) => `<strong>${attr(row.label)}</strong> ${inline(row.title)}, ${link(row.url, attr(row.url))}. Soort: ${attr(row.kindNl)}. ${inline(row.statusNl)}. Reden: ${inline(row.reasonNl)}.`))),
    );
  }
  return parts.join("");
}

function tools({ evaluation, derived }: Context): string {
  const { toolchain } = evaluation;
  const agentModels = derived.agentModels;
  const short = (hash: string | null | undefined): string => (hash ? `<code>${attr(hash.slice(0, 8))}</code>` : "geen");
  const rows: [string, string][] = [
    ["Toolbox", `loep, versie ${attr(toolchain.toolbox.version)}, commit ${derived.toolboxCommit ? `<code>${attr(derived.toolboxCommit.slice(0, 12))}</code>` : attr(REPORT_TEXT.commitUnknown)}`],
    ...(derived.sweepNl ? [["Toolbox van de veegronde", inline(derived.sweepNl)] as [string, string]] : []),
    ["Lockfile", short(toolchain.toolbox.lockfileSha256)],
    ["Runtime", `Node ${attr(toolchain.runtime.node)} op ${attr(toolchain.runtime.platform)} ${attr(toolchain.runtime.osRelease)} (${attr(toolchain.runtime.arch)})`],
    ["Pakketten", Object.keys(toolchain.packages).sort().map((name) => `<code>${attr(name)}</code> ${attr(toolchain.packages[name]!)}`).join(", ")],
    [derived.browsersNl.length > 1 ? "Browsers" : "Browser", derived.browsersNl.map(inline).join("; ")],
    ["Weergave", `venster ${toolchain.rendering.viewport.width} × ${toolchain.rendering.viewport.height}, schaalfactor ${toolchain.rendering.deviceScaleFactor}, taal ${attr(toolchain.rendering.locale)}, tijdzone ${attr(toolchain.rendering.timezoneId)}, voorkeur voor minder beweging: ${toolchain.rendering.reducedMotion === "reduce" ? "aan" : "uit"}`],
    ["Wachttijden", `${toolchain.rendering.navigationTimeoutMs / 1000} seconden voor het laden van een pagina, ${toolchain.rendering.settleTimeoutMs / 1000} seconden voor het tot rust komen`],
    [REPORT_TEXT.model, `${inline(evaluation.judgment.model)} (${attr(agentModels ? REPORT_TEXT.modelNoteOperator : REPORT_TEXT.modelNote)})`],
    ...(agentModels ? [[REPORT_TEXT.agentModels, `${agentModels.perRoleNl.map(inline).join("; ")}. ${attr(REPORT_TEXT.agentModelsNote)}${agentModels.differsNl ? ` ${inline(agentModels.differsNl)}` : ""}`] as [string, string]] : []),
    ["Rondes", evaluation.judgment.rounds.map(inline).join(", ")],
    ...(derived.extensionsNl ? [[REPORT_TEXT.extensions, `${inline(derived.extensionsNl)}. ${attr(REPORT_TEXT.extensionsNote)}`] as [string, string]] : []),
    ["Opdrachtsjablonen", Object.keys(evaluation.judgment.promptTemplates).sort().map((name) => `${attr(name)} ${short(evaluation.judgment.promptTemplates[name])}`).join(", ")],
  ];
  const parts = [rich(facts(rows))];
  if (evaluation.instruments?.length) {
    parts.push(
      spacer(32),
      title("Meetmethoden van de agents", 3, 4),
      spacer(8),
      rich(`<p>${attr(REPORT_TEXT.instrumentsIntro)}</p>`),
      spacer(16),
      table(
        "Meetmethoden van de agents",
        [
          { label: "Hulpmiddel", track: "minmax(8rem, 1.2fr)" },
          { label: "Versie", track: "minmax(6rem, 1fr)" },
          { label: "Gebruikt voor", track: "minmax(10rem, 2fr)" },
          { label: "Metingen", track: "minmax(4rem, 0.6fr)", numeric: true },
        ],
        evaluation.instruments.map((tool, index) => ({ cells: [{ html: `<code>${attr(tool.implementation)}</code>` }, derived.instrumentVersions[index]!, tool.usedForNl.join(", "), String(tool.measurements)] })),
      ),
    );
  }
  if (derived.toolboxChanged) parts.push(spacer(16), el({ tag: "nldd-banner", attrs: { variant: "warning", text: REPORT_TEXT.dirty } }));
  parts.push(spacer(16), rich(`<p>${inline(derived.chain.enginesNl)}</p>`));
  return parts.join("");
}

// ---------------------------------------------------------------- results per criterion

const criterionLink = (criterion: CriterionResult, target = ID.criterion(criterion.id)): string => cellLink(`#${target}`, `${criterion.id} ${criterion.titleNl}`);

function criterionFacts(criterion: CriterionResult, brief: CriterionBrief, appendix: boolean): string {
  const items = [
    `Niveau ${attr(criterion.level)}`,
    `EN 301 549: ${attr(criterion.en301549)}`,
    ...(versionNote(criterion) ? [attr(versionNote(criterion)!)] : []),
    link(criterion.understandingUrl, "Uitleg van dit criterium bij W3C"),
    ...(appendix ? [`${link(`#${ID.appendix(criterion.id)}`, "Onderbouwing in bijlage A")}${brief.observationsNl ? ` (${attr(brief.observationsNl)})` : ""}`] : []),
  ];
  return text(items.join(" · "), { size: "sm", color: "secondary" });
}

/** A finding under its criterion: in full when its text stands nowhere else, as one row to its defect when the work list has it. */
/** A finding that is described at its defect in the work list: under its criterion it is one line with a link. */
function listedUnderDefect(finding: ReportFinding, context: Context): boolean {
  const place = context.derived.defects?.ofFinding[finding.id];
  return Boolean(place && place.role !== "other" && context.defects.get(place.defectId));
}

function findingUnderCriterion(finding: ReportFinding, context: Context): string {
  const { derived, defects, titles, pictures } = context;
  const place = derived.defects?.ofFinding[finding.id];
  const defect = place ? defects.get(place.defectId) : undefined;
  if (defect && place && listedUnderDefect(finding, context)) {
    return el({
      tag: "nldd-list",
      attrs: { "accessible-label": `Bevinding ${finding.id}`, appearance: "box-base" },
      children: el({
        tag: "nldd-list-item",
        attrs: { href: `#${defect.id}` },
        children: [el({ tag: "nldd-text-cell", attrs: { text: plain(finding.titleNl), "supporting-text": plain(`${finding.id} · ernst ${finding.severity} · beschreven bij ${REPORT_TEXT.defect.label.toLowerCase()} ${defect.id} in de werklijst`) } }), el({ tag: "nldd-icon-cell", attrs: { icon: "chevron-right", size: 20, color: "secondary" } })].join(""),
      }),
    });
  }
  const defectNl = defect ? `${REPORT_TEXT.defect.label}: ${link(`#${defect.id}`, attr(defect.id))}. ${REPORT_TEXT.defect.main}: ${attr(defect.mainCriterion)}, zie ${link(`#${defect.mainFindingId}`, attr(defect.mainFindingId))}.` : "";
  return el({
    tag: "nldd-card",
    attrs: { id: finding.id },
    children: stack(
      [
        title(finding.titleNl, 6, 5, { "supporting-text": finding.id }),
        spacer(12),
        tags(findingFacts(finding, derived)),
        spacer(12),
        rich(`<p>${finding.component ? `Onderdeel: ${inline(finding.component)}. ` : ""}Pagina's: ${inline(finding.pagesAffected)}${defectNl ? ` ${defectNl}` : ""}</p>`, { spacing: "tight" }),
        ...(pictures[finding.id] ? [spacer(16), picture(finding, pictures)] : []),
        spacer(16),
        findingBrief(finding, finding.titleNl, titles, 6),
      ].join(""),
      { padding: 20, "sm-padding": 16 },
    ),
  });
}

function criterionBlock(criterion: CriterionResult, context: Context): string {
  const { derived } = context;
  const brief = derived.briefs[criterion.id]!;
  const outcome = derived.shown[criterion.id]!;
  const extra = [
    `<p>Zekerheid: ${inline(brief.certaintyNl)}</p>`,
    ...(brief.coverageNl ? [`<p>${attr(REPORT_TEXT.measured)}: ${inline(brief.coverageNl)}</p>`] : []),
    ...(brief.openNl ? [`<p>Open: ${attr(brief.openNl)}, zie ${link(`#${ID.open(criterion.id)}`, attr(REPORT_TEXT.openLink))}.</p>`] : []),
  ];
  return [
    title(`${criterion.id} ${criterion.titleNl}`, 5, 4, { id: ID.criterion(criterion.id) }),
    spacer(8),
    tags([outcomeTag(outcome, derived)]),
    spacer(8),
    criterionFacts(criterion, brief, true),
    spacer(12),
    rich(`<p>${inline(criterion.summaryNl)}</p>${extra.join("")}`),
    // A card under a criterion has a title at level 6, the deepest there is: over a card the label
    // is no heading, or the card would sit beside it instead of under it (WCAG 1.3.1).
    ...(criterion.findings.length > 0 ? [spacer(16), rich(criterion.findings.every((finding) => listedUnderDefect(finding, context)) ? subhead(`Bevindingen (${criterion.findings.length})`, 6) : `<p><strong>Bevindingen (${criterion.findings.length})</strong></p>`), spacer(8), stack(criterion.findings.map((finding) => findingUnderCriterion(finding, context)).join(""), { gap: 12 })] : []),
    spacer(40),
  ].join("");
}

function results(context: Context): string {
  const { evaluation, derived, quiet } = context;
  const parts = [
    rich(`<p>${attr(REPORT_TEXT.overviewIntro)}</p>`),
    spacer(16),
    table(
      "Uitkomst per criterium",
      [
        { label: "Criterium", track: "minmax(10rem, 3fr)" },
        { label: "Niveau", track: "minmax(3rem, 0.5fr)" },
        { label: "Uitkomst", track: "minmax(8rem, 1.5fr)" },
        { label: REPORT_TEXT.establishedBy, track: "minmax(7rem, 1fr)" },
        { label: "Bevindingen", track: "minmax(8rem, 0.8fr)", numeric: true },
      ],
      evaluation.criteria.map((criterion) => ({
        cells: [
          { html: criterionLink(criterion) },
          criterion.level,
          { html: text(`${OUTCOME_SYMBOL[derived.shown[criterion.id]!]} ${attr(derived.outcomeLabel[derived.shown[criterion.id]!])}`, { size: "sm", weight: "medium", color: TEXT_COLOR[derived.shown[criterion.id]!] === "secondary" ? undefined : TEXT_COLOR[derived.shown[criterion.id]!] }) },
          derived.briefs[criterion.id]!.establishedNl,
          String(criterion.findings.length),
        ],
      })),
    ),
    spacer(40),
  ];
  const quietCriteria = evaluation.criteria.filter((criterion) => quiet.has(criterion.id));
  if (quietCriteria.length > 0) {
    parts.push(
      title(REPORT_TEXT.quietTitle, 3, 3),
      spacer(8),
      rich(`<p>${attr(REPORT_TEXT.quietIntro)}</p>`),
      spacer(16),
      table(
        REPORT_TEXT.quietTitle,
        [
          { label: "Criterium", track: "minmax(9rem, 2fr)" },
          { label: "Niveau", track: "minmax(3rem, 0.5fr)" },
          { label: "Uitkomst", track: "minmax(7rem, 1fr)" },
          { label: "Toelichting", track: "minmax(12rem, 4fr)" },
        ],
        quietCriteria.map((criterion) => ({ id: ID.criterion(criterion.id), cells: [{ html: criterionLink(criterion, ID.appendix(criterion.id)) }, criterion.level, outcomeLabel(criterion.outcome, derived), criterion.summaryNl] })),
      ),
      spacer(48),
    );
  }
  for (const principle of groupCriteria(evaluation.criteria.filter((criterion) => !quiet.has(criterion.id)), 1)) {
    parts.push(title(`${principle.key} ${principle.name}`, 3, 3), spacer(24));
    for (const guideline of groupCriteria(principle.criteria, 2)) {
      parts.push(title(`Richtlijn ${guideline.key} ${guideline.name}`, 4, 5, { color: undefined }), spacer(16));
      for (const criterion of guideline.criteria) parts.push(criterionBlock(criterion, context));
    }
  }
  return parts.join("");
}

function byComponent(context: Context): string {
  const { evaluation } = context;
  if (context.findings.size === 0) return rich("<p>Er zijn geen bevindingen.</p>");
  return [
    rich(`<p>${attr(REPORT_TEXT.componentIntro)}</p>`),
    spacer(16),
    table(
      "Bevindingen per onderdeel",
      [
        { label: "Onderdeel", track: "minmax(9rem, 1fr)" },
        { label: "Bevindingen", track: "minmax(10rem, 2fr)" },
      ],
      findingsByComponent(evaluation).map((group) => ({ cells: [group.component ?? "Zonder onderdeel", { html: stack(group.findings.map((finding) => cellLink(`#${finding.id}`, finding.id)).join(""), { layout: "wrap", gap: 8 }) }] })),
    ),
  ].join("");
}

/** A picture of (a part of) the page with a numbered mark at the place of each defect; the links are in the list under it. */
function annotatedPage(label: string, pageTitle: string, picture: PagePart, numbered: { id: string; n: number; box: { x: number; y: number; width: number; height: number } }[], which: string): string {
  const marks = numbered.map(({ id, n, box }) => {
    const cx = Math.max(16, Math.min(picture.width - 16, box.x));
    const cy = Math.max(16, Math.min(picture.height - 16, box.y));
    // Out of the tab order and out of the accessibility tree: the list under the image has the same
    // links with the name of each defect, and a link named only "1" says nothing (WCAG 2.4.4).
    return `<a href="#${attr(id)}" tabindex="-1" aria-hidden="true"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#c22a1f" stroke-width="3" rx="2"/><circle cx="${cx}" cy="${cy}" r="15" fill="#c22a1f" stroke="#ffffff" stroke-width="2.5"/><text x="${cx}" y="${cy + 1}" fill="#ffffff" font-family="system-ui, sans-serif" font-size="15" font-weight="700" text-anchor="middle" dominant-baseline="middle">${n}</text></a>`;
  });
  const numbers = numbered.map(({ n }) => n);
  const range = numbers.length === 1 ? `markering ${numbers[0]}` : `de markeringen ${numbers[0]} tot en met ${numbers[numbers.length - 1]}`;
  const alt = `${which} van ${label} ${pageTitle}, met ${range} op de plek van een gebrek. De lijst onder de afbeeldingen noemt ze met dezelfde nummers.`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${attr(alt)}" viewBox="0 0 ${picture.width} ${picture.height}"><image href="${picture.src}" width="${picture.width}" height="${picture.height}"/>${marks.join("")}</svg>`;
  // The design system has no image with links in it, such as an image map; a mark is an <a> in the drawing.
  return el({ tag: "nldd-image", attrs: { shape: "rounded", caption: which === "Schermafbeelding" ? undefined : which }, children: `\n<!-- nldd-lint-disable-next-line html-no-control -- een markering op de afbeelding is een link in de tekening; het systeem heeft geen afbeelding met links -->\n${svg}\n` });
}

function byPage(context: Context): string {
  const { evaluation, derived, labels, defects, findings, shots } = context;
  if (findings.size === 0) return rich("<p>Er zijn geen bevindingen.</p>");
  const grouped = derived.defects !== null;
  const parts: string[] = [rich(`<p>${attr(grouped ? REPORT_TEXT.defectPageIntro : REPORT_TEXT.pageIntro)}</p>`), spacer(32)];
  const quietPages: string[] = [];
  evaluation.sample.items.forEach((item, index) => {
    const label = labels[index]!;
    const pageTitle = item.title || "(geen titel)";
    // Defects in the order of the work list, or findings in an evaluation without defects.
    const here: { id: string; titleNl: string; severity: string; findingIds: string[] }[] = grouped
      ? derived.defects!.byPage[label]!.map((id) => defects.get(id)!).map((defect) => ({ id: defect.id, titleNl: defect.titleNl, severity: defect.severity, findingIds: defect.findingIds }))
      : [...findings.values()].filter((finding) => finding.locations.some((location) => location.page === label)).map((finding) => ({ id: finding.id, titleNl: finding.titleNl, severity: finding.severity, findingIds: [finding.id] }));
    if (here.length === 0) {
      quietPages.push(`${label} ${pageTitle}`);
      return;
    }
    const shot = shots[label];
    // A defect gets the mark of the first of its findings with a place; numbered from the top of the page down.
    const placed = here
      .flatMap((entry) => {
        for (const [partIndex, picture] of (shot?.parts ?? []).entries()) {
          const box = entry.findingIds.map((id) => picture.marks[id]).find((found) => found !== undefined);
          if (box) return [{ ...entry, partIndex, box }];
        }
        return [];
      })
      .sort((a, b) => a.partIndex - b.partIndex || a.box.y - b.box.y || a.box.x - b.box.x || a.id.localeCompare(b.id))
      .map((entry, order) => ({ ...entry, n: order + 1 }));
    const unplaced = here.filter((entry) => !placed.some((other) => other.id === entry.id));
    const row = (entry: { id: string; titleNl: string; severity: string }): string => `${link(`#${entry.id}`, inline(entry.titleNl))} <small>(ernst ${attr(entry.severity)})</small>`;
    parts.push(title(`${label} ${pageTitle}`, 3, 4, { id: `pagina-${label}`, "supporting-text": item.url }), spacer(16));
    if (shot && placed.length > 0) {
      const pictures = shot.parts.map((picture, partIndex) => ({ picture, marks: placed.filter((entry) => entry.partIndex === partIndex) })).filter((entry) => entry.marks.length > 0);
      pictures.forEach(({ picture, marks }, at) => {
        const which = pictures.length === 1 && picture.fromY === 0 ? "Schermafbeelding" : `Uitsnede ${at + 1} van ${pictures.length}`;
        parts.push(annotatedPage(label, pageTitle, picture, marks, which), spacer(16));
      });
    }
    parts.push(
      rich(
        [
          placed.length > 0 ? list(placed.map(row), true) : "",
          unplaced.length > 0 ? `${placed.length > 0 ? "<p>Ook op deze pagina, zonder plek op de afbeelding:</p>" : ""}${list(unplaced.map(row))}` : "",
        ].join(""),
      ),
      spacer(48),
    );
  });
  const documentRows = (derived.documents?.rows ?? []).map((row) => ({ cells: [`${row.label} ${row.title}`, row.here.length > 0 ? { html: stack(row.here.map((entry) => cellLink(`#${entry.id}`, entry.titleNl)).join(""), { gap: 4 }) } : row.statusNl.startsWith("Ingelezen") ? (grouped ? "Geen gebrek met een plek in dit document." : "Geen bevinding met een plek in dit document.") : row.statusNl] as Cell[] }));
  if (quietPages.length > 0) parts.push(rich(`<p>${grouped ? "Geen gebrek met een plek op deze pagina's:" : "Geen bevinding met een plek op deze pagina's:"}</p>${list(quietPages.map(attr))}`), spacer(24));
  if (documentRows.length > 0) parts.push(table("Documenten", [{ label: "Document", track: "minmax(9rem, 1fr)" }, { label: grouped ? "Gebreken" : "Bevindingen", track: "minmax(12rem, 2fr)" }], documentRows));
  return parts.join("");
}

function reliability({ evaluation, derived }: Context): string {
  const gate = evaluation.chain?.gate;
  return rich(
    [
      `<p>${inline(derived.chain.honestNl)}</p>`,
      `<h3 id="nauwkeurigheid">${attr(REPORT_TEXT.versionAccuracy)}</h3><p>${inline(derived.versionAccuracyNl)}</p>`,
      derived.chain.stepsNl.length > 0 ? `<h3 id="werkwijze">Werkwijze</h3>${list(derived.chain.stepsNl.map((step) => `<strong>${attr(step.nameNl)}.</strong> ${inline(step.textNl)}`), true)}` : "",
      `<p>${inline(derived.disagreementNl)}</p>`,
      gate && gate.acceptedNl.length + gate.limitationsNl.length > 0 ? `<p>Wat de bewijspoort heeft vastgesteld:</p>${list([...gate.acceptedNl, ...gate.limitationsNl].map(inline))}` : "",
      derived.defects ? `<p>${inline(derived.defects.mergeNl)}</p>` : "",
      derived.generalLimitationsNl.length > 0 ? `<p>Beperkingen van dit onderzoek:</p>${list(derived.generalLimitationsNl.map(inline))}` : "",
      derived.procedureLimitations > 0 ? `<p>Bij ${derived.procedureLimitations === 1 ? "1 criterium" : `${derived.procedureLimitations} criteria`} heeft de procedure een eigen beperking. ${attr(REPORT_TEXT.procedureLimits)}</p>` : "",
    ].join(""),
  );
}

// ---------------------------------------------------------------- appendices

function appendixEntry(criterion: CriterionResult, context: Context): string {
  const { derived, quiet } = context;
  const brief = derived.briefs[criterion.id]!;
  const chain = derived.chain;
  const observations = criterion.observations.map((observation, index) => {
    const place = brief.placesNl[index];
    const outcome = place ? `<strong>${attr(REPORT_TEXT.ruling.outcome)}: ${attr(place.labelNl)}</strong>${place.findingId ? `, ${attr(REPORT_TEXT.ruling.seeFinding)} ${link(`#${place.findingId}`, attr(place.findingId))}` : ""}` : "";
    return `${outcome}${list([`Onderzocht: ${inline(observation.checkedNl)}`, `Hoe: ${inline(observation.howNl)}`, `Waargenomen: ${inline(observation.observedNl)}`, `Bewijs: ${observation.evidence.map((item) => `<code>${attr(item)}</code>`).join(", ")}`])}`;
  });
  const block = (label: string, items: string[]): string => (items.length > 0 ? `<p>${attr(label)}:</p>${list(items.map(inline))}` : "");
  const basis = [criterion.rule ? `Beslisregel ${attr(criterion.rule)}` : null, criterion.procedure ? `procedure versie ${attr(String(criterion.procedure.version))} (${inline(criterion.procedure.class)})` : "geen procedure vastgelegd"].filter(Boolean);
  const html = [
    observations.length > 0 ? `${subhead("Hoe is dit vastgesteld", 4)}${list(observations, true)}` : "",
    `${subhead("Hoe zeker is dit oordeel", 4)}<p>${inline(brief.roundsNl)}</p>`,
    block(REPORT_TEXT.answers, brief.answersNl),
    block(REPORT_TEXT.before, brief.beforeNl),
    criterion.challengeNl ? `<p>${attr(chain.challengeLabel)}: ${inline(criterion.challengeNl)}</p>` : "",
    block(chain.droppedLabel, criterion.droppedNl),
    block(REPORT_TEXT.loops, brief.loopsNl),
    `<p>Grondslag: ${basis.join(", ")}.</p>`,
    criterion.procedure?.limitsNl ? `<p>Beperking van de procedure: ${inline(criterion.procedure.limitsNl)}</p>` : "",
    block(REPORT_TEXT.investigate.appendix, brief.toolboxPointsNl),
    block(REPORT_TEXT.investigate.limits, brief.limitsNl),
    brief.openNl ? `<p>Open: ${attr(brief.openNl)}, zie ${link(`#${ID.open(criterion.id)}`, attr(REPORT_TEXT.openLink))}.</p>` : "",
  ].join("");
  return [
    title(`${criterion.id} ${criterion.titleNl}`, 3, 4, { id: ID.appendix(criterion.id) }),
    spacer(8),
    tags([outcomeTag(derived.shown[criterion.id]!, derived)]),
    spacer(8),
    quiet.has(criterion.id) ? criterionFacts(criterion, brief, false) : "",
    text(link(`#${ID.criterion(criterion.id)}`, "Terug naar het resultaat"), { size: "sm" }),
    spacer(12),
    rich(html, { spacing: "tight" }),
    spacer(40),
  ].join("");
}

function appendixA(context: Context): string {
  return [rich(`<p>${attr(REPORT_TEXT.appendixIntro)}</p>`), spacer(32), ...context.evaluation.criteria.map((criterion) => appendixEntry(criterion, context))].join("");
}

function appendixB({ evaluation, derived }: Context): string {
  const short = (hash: string | null | undefined): Cell => (hash ? { html: `<code>${attr(hash.slice(0, 8))}</code>` } : "geen");
  const withFinish = evaluation.criteria.some((criterion) => criterion.rounds.finish !== undefined);
  return [
    rich(
      `<p>${attr(REPORT_TEXT.traceIntro)}</p>${facts([
        ["Hash van de evaluatie", longCode(derived.hash)],
        ["Commit van de toolbox", derived.toolboxCommit ? `${longCode(derived.toolboxCommit)}${derived.toolboxChanged ? " (met niet vastgelegde wijzigingen)" : ""}` : attr(REPORT_TEXT.commitUnknown)],
        ["Hash van de lockfile", longCode(evaluation.toolchain.toolbox.lockfileSha256)],
        ...derived.speechModels.map((model): [string, string] => [`Hash van het spraakmodel ${model.name}`, `<code>${attr(model.sha256)}</code>`]),
      ])}`,
    ),
    spacer(16),
    table(
      "Herleidbaarheid per criterium",
      [
        { label: "Criterium", track: "minmax(4rem, 0.8fr)" },
        { label: "Procedure", track: "minmax(7rem, 1.2fr)" },
        { label: "Dossier", track: "minmax(6rem, 1fr)" },
        { label: REPORT_TEXT.trace.judge, track: "minmax(6rem, 1fr)" },
        { label: REPORT_TEXT.trace.final, track: "minmax(6rem, 1fr)" },
        ...(withFinish ? [{ label: REPORT_TEXT.trace.finish, track: "minmax(6rem, 1fr)" }] : []),
      ],
      evaluation.criteria.map((criterion) => ({
        cells: [
          criterion.id,
          criterion.procedure ? { html: `v${attr(String(criterion.procedure.version))} <code>${attr(criterion.procedure.sha256.slice(0, 8))}</code>` } : "geen",
          short(criterion.provenance.dossierSha256),
          short(criterion.provenance.verdictSha256.a),
          short(criterion.provenance.verdictSha256.final),
          ...(withFinish ? [criterion.rounds.finish !== undefined ? short(criterion.provenance.verdictSha256.finish) : ""] : []),
        ],
      })),
    ),
  ].join("");
}

function appendixC({ derived }: Context): string {
  const data = derived.rechecks!;
  return rich(
    `<p>${attr(REPORT_TEXT.rechecks.intro)}</p>${list(data.entries.map((entry) => `<span id="${attr(entry.anchor)}"></span><strong>${inline(entry.titleNl)}</strong> (${link(`#${entry.findingId}`, attr(entry.findingId))}), ${attr(entry.criterion)}: <strong>${attr(entry.outcome)}</strong>${list(entry.linesNl.map(inline))}`))}${data.notesNl.map((note) => `<p>${inline(note)}</p>`).join("")}`,
  );
}

/** One sheet for the rest of every card: the script moves the hidden part of a card into it and back. */
function detailSheet(): string {
  return el({
    tag: "nldd-sheet",
    attrs: { id: "detail", placement: "right", width: "560px" },
    children: el({
      tag: "nldd-page",
      children: [
        // The bar cuts its title off on one line; the full title is a heading at the top of the
        // content that wraps (WCAG 1.4.12), and the bar takes it over once it scrolls away.
        el({ tag: "nldd-top-title-bar", attrs: { slot: "header", id: "detail-titel", text: "Meer over dit gebrek", "dismiss-text": "Sluit", "heading-level": 2, "collapse-anchor": "detail-kop" } }),
        el({ tag: "nldd-simple-section", attrs: { id: "detail-inhoud" }, children: title("Meer over dit gebrek", 2, 4, { slot: "header", id: "detail-kop" }) }),
      ].join(""),
    }),
  });
}

// ---------------------------------------------------------------- the report's own

/**
 * The content page pattern of the design system: the button that opens the table of contents
 * shows only while the section is a sheet, and the heading in the column hides while the sheet
 * has its own title bar. The section cannot do this itself yet; the pattern says so.
 */
const OWN_CSS = [
  "/* nldd-lint-disable-next-line stylesheet-no-own -- nldd-sidebar-section kan een knop nog niet alleen in de ingeklapte stand tonen */",
  "nldd-sidebar-section:not([collapsed]) #inhoud-openen { display: none; }",
  "/* nldd-lint-disable-next-line stylesheet-no-own -- nldd-sidebar-section kan een knop nog niet alleen in de ingeklapte stand tonen */",
  "nldd-sidebar-section[collapsed] #inhoud-kop { display: none; }",
].join("\n");

/**
 * Switches between the report and its appendices, follows a link into the part that is hidden,
 * and shows every part while printing.
 */
const OWN_SCRIPT = `(() => {
  const bar = document.getElementById("delen");
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const tabs = [...bar.querySelectorAll("nldd-tab-bar-item")];
  const show = (panelId) => {
    for (const panel of panels) panel.hidden = panel.id !== panelId;
    for (const tab of tabs) tab.current = tab.getAttribute("controls") === panelId;
  };
  bar.addEventListener("tabchange", (event) => show(event.detail.item.getAttribute("controls")));
  const panelOf = (element) => panels.find((panel) => panel.contains(element)) || null;
  const reveal = (id) => {
    const target = id && document.getElementById(id);
    if (!target) return false;
    const panel = panelOf(target);
    if (panel && panel.hidden) show(panel.id);
    return true;
  };
  document.addEventListener("click", (event) => {
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement && node.hash && node.pathname === location.pathname);
    if (!anchor) return;
    const id = decodeURIComponent(anchor.hash.slice(1));
    const target = document.getElementById(id);
    const panel = target && panelOf(target);
    if (!panel || !panel.hidden) return;
    show(panel.id);
    // The browser scrolls before the part it just showed has its height; place the target once it has.
    setTimeout(() => {
      const top = target.getBoundingClientRect().top;
      if (top < -1 || top > window.innerHeight / 2) target.scrollIntoView();
    }, 50);
  }, true);
  if (location.hash) reveal(decodeURIComponent(location.hash.slice(1)));
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    const hidden = target && panelOf(target) && panelOf(target).hidden;
    if (reveal(id) && hidden) setTimeout(() => target.scrollIntoView(), 50);
  });
  const openButton = document.getElementById("inhoud-openen");
  const section = openButton.closest("nldd-sidebar-section");
  openButton.addEventListener("click", () => section.show());
  section.addEventListener("open", () => { openButton.expanded = true; });
  section.addEventListener("close", () => { openButton.expanded = false; });
  // "Meer" on a card: the hidden rest of the card goes into the sheet, and back when the sheet closes.
  const sheet = document.getElementById("detail");
  const sheetBar = document.getElementById("detail-titel");
  const sheetBody = document.getElementById("detail-inhoud");
  const sheetHeading = document.getElementById("detail-kop");
  let shown = null;
  const putBack = () => {
    if (!shown) return;
    shown.details.hidden = true;
    for (const heading of shown.details.querySelectorAll("[data-level]")) heading.setAttribute("aria-level", heading.dataset.level);
    shown.placeholder.replaceWith(shown.details);
    shown.button.expanded = false;
    shown = null;
  };
  document.addEventListener("click", (event) => {
    const button = event.composedPath().find((node) => node instanceof Element && node.id && node.id.startsWith("meer-"));
    const details = button && document.getElementById("details-" + button.id.slice(5));
    if (!details) return;
    putBack();
    const placeholder = document.createComment("");
    details.before(placeholder);
    sheetBody.append(details);
    // In the sheet the labels sit under its title, an h2.
    for (const heading of details.querySelectorAll("[data-level]")) heading.setAttribute("aria-level", "3");
    details.hidden = false;
    const heading = button.closest("nldd-card")?.querySelector("nldd-title");
    if (heading) sheetBar.text = sheetHeading.text = heading.getAttribute("text");
    shown = { details, placeholder, button };
    button.expanded = true;
    sheet.show();
  });
  sheet.addEventListener("close", () => {
    const button = shown && shown.button;
    putBack();
    if (button) button.focus();
  });
  const allDetails = () => [...document.querySelectorAll('[id^="details-"]')];
  let before = null;
  window.addEventListener("beforeprint", () => {
    if (shown) { putBack(); sheet.hide(); }
    before = panels.map((panel) => panel.hidden);
    for (const panel of panels) panel.hidden = false;
    for (const details of allDetails()) details.hidden = false;
  });
  window.addEventListener("afterprint", () => {
    if (before) panels.forEach((panel, index) => { panel.hidden = before[index]; });
    for (const details of allDetails()) details.hidden = true;
    before = null;
  });
})();`;
