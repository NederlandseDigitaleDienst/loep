import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mergeFindings } from "../src/lib/defects.ts";
import { allFindings, type CutoutPictures } from "../src/lib/report-markdown.ts";
import { firstSentence, renderHtml, REPORT_COMPONENTS } from "../src/lib/report-html.ts";
import type { PageShot } from "../src/lib/page-shots.ts";
import { pageLabels } from "../src/lib/report-markdown.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { weighed } from "./fixtures/weighed.ts";

const run = promisify(execFile);
/** A picture of the first page with a mark for every finding that points at a place on it. */
const shots = (evaluation: Evaluation): Record<string, PageShot> => {
  const label = pageLabels(evaluation)[0]!;
  const here = allFindings(evaluation).filter((finding) => finding.locations.some((location) => location.page === label));
  return { [label]: { parts: [{ src: "data:image/jpeg;base64,/9j/", width: 1024, height: 900, fromY: 0, toY: 900, marks: Object.fromEntries(here.map((finding, index) => [finding.id, { x: 40 + index * 30, y: 60 + index * 40, width: 200, height: 30 }])) }] } };
};

const LINT = fileURLToPath(new URL("../node_modules/@nldd/design-system/lint/cli.js", import.meta.url));

const grouped = (): Evaluation => {
  const evaluation = exampleEvaluation();
  evaluation.defects = mergeFindings(evaluation);
  return evaluation;
};

/** A cutout for the first finding, so the picture is part of what is checked. */
const pictures = (evaluation: Evaluation): CutoutPictures => ({ [allFindings(evaluation)[0]!.id]: { file: "data:image/png;base64,iVBORw0KGgo=", altNl: "Uitsnede van P1: het element van de bevinding, rood omlijnd.", width: 120, height: 80 } });

/** The headings in document order: the levels of nldd-title, of the headings inside rich text and of the labels that are headings. */
function headingLevels(html: string): number[] {
  const body = html.slice(Math.max(0, html.indexOf("<body>")), html.indexOf("<script>"));
  return [...body.matchAll(/<nldd-title\b[^>]*\bheading-level="(\d)"|<h([1-6])\b|<p role="heading" aria-level="(\d)"/g)].map((match) => Number(match[1] ?? match[2] ?? match[3]));
}

test("the same evaluation gives the same HTML, byte for byte", () => {
  const evaluation = grouped();
  const first = renderHtml(evaluation, undefined, pictures(evaluation));
  assert.equal(renderHtml(grouped(), undefined, pictures(grouped())), first);
  // A round trip through JSON, as render does when it reads evaluation.json, changes nothing.
  const reread = JSON.parse(JSON.stringify(grouped())) as Evaluation;
  assert.equal(renderHtml(reread, undefined, pictures(reread)), first);
});

test("the HTML has one h1 and never skips a heading level", () => {
  for (const evaluation of [exampleEvaluation(), grouped(), weighed(grouped())]) {
    const levels = headingLevels(renderHtml(evaluation));
    assert.equal(levels.filter((level) => level === 1).length, 1, "one h1");
    assert.equal(levels[0], 1, "the h1 comes first");
    levels.forEach((level, index) => {
      if (index > 0) assert.ok(level <= levels[index - 1]! + 1, `heading ${index} goes from h${levels[index - 1]} to h${level}`);
    });
  }
});

test("no column is hidden on a narrow screen, labels above text are headings, and rows of tags are lists", () => {
  const full = renderHtml(grouped(), undefined, pictures(grouped()));
  const html = full.slice(full.indexOf("<body>"), full.indexOf("<script>"));
  assert.doesNotMatch(html, / (hide-below|hide-above|sm-columns)=/, "a hidden column says what stands nowhere else (WCAG 1.4.10)");
  assert.doesNotMatch(html, /<p><strong>(Wat is er mis|Wie heeft er last van|Oplossing|Waar|Hoe is dit vastgesteld)<\/strong><\/p>/, "a bold label is a heading (WCAG 1.3.1)");
  assert.match(html, /<p role="heading" aria-level="\d" data-level="\d"><strong>Wie heeft er last van<\/strong><\/p>/);
  assert.match(html, /<nldd-container layout="wrap" gap="8" role="list"><nldd-tag role="listitem" /);
});

test("the table of contents marks no row as current: the design system shows that with a grey block alone (WCAG 1.4.1, 1.4.11)", () => {
  const full = renderHtml(grouped());
  const toc = full.slice(full.indexOf('<nldd-list type="navigation"'), full.indexOf("</nldd-list>", full.indexOf('<nldd-list type="navigation"')));
  assert.ok(toc.length > 0, "the table of contents is there");
  assert.doesNotMatch(toc, /\scurrent[\s=>]/);
  assert.doesNotMatch(full, /row\.current\s*=/, "no script marks a row while scrolling");
});

test("every id is unique, every link inside the report lands, and every finding can be reached", () => {
  for (const evaluation of [exampleEvaluation(), grouped(), weighed(grouped())]) {
    const html = renderHtml(evaluation, undefined, pictures(evaluation));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
    assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], "no id twice");
    const targets = new Set(ids);
    const missing = [...new Set([...html.matchAll(/\shref="#([^"]*)"/g)].map((match) => match[1]!))].filter((id) => !targets.has(id));
    assert.deepEqual(missing, [], "every link points at an id in the report");
    for (const finding of allFindings(evaluation)) assert.ok(targets.has(finding.id) || html.includes(`id="${finding.id}"`), `finding ${finding.id} has a place`);
  }
});

test("the HTML is one file: the system, its fonts and the cutouts are inside, and it says it is in Dutch", () => {
  const evaluation = grouped();
  const html = renderHtml(evaluation, undefined, pictures(evaluation));
  assert.match(html, /^<!doctype html>\n<html lang="nl">/);
  assert.ok(!/<link\b|<script\b[^>]*\bsrc=/.test(html), "no stylesheet or script from elsewhere");
  assert.ok(!/url\((?!["']?data:)/.test(html.slice(0, html.indexOf("</head>"))), "every font and image of the stylesheets is a data URI");
  assert.ok(html.includes('src="data:image/png;base64,'), "the cutout is in the file");
  assert.ok(!html.includes("/Users/") && !html.includes("/home/"), "no local paths");
  // The report's own words; the files of the design system have comments of their own.
  assert.ok(!html.slice(html.indexOf("<body>"), html.indexOf("<script>")).includes(String.fromCodePoint(0x2014)), "no em dash in what the report says");
});

test("nldd lint finds nothing, also with the rule that everything comes from the design system", async () => {
  const dir = mkdtempSync(join(tmpdir(), "report-html-"));
  const file = join(dir, "rapport.html");
  // Linked, not embedded: inside the page the linter cannot tell the system's stylesheet from one of the report.
  for (const evaluation of [grouped(), weighed(grouped())]) {
    writeFileSync(file, renderHtml(evaluation, undefined, pictures(evaluation), { embed: false, pageShots: shots(evaluation) }));
    const result = await run(process.execPath, [LINT, "lint", "--pure", "--format", "json", file], { cwd: dir }).catch((error: { stdout: string }) => error);
    const findings = (JSON.parse(result.stdout) as { findings: { rule: string; severity: string; message: string }[] }).findings;
    assert.deepEqual(findings.filter((finding) => finding.severity !== "hint").map((finding) => `${finding.rule}: ${finding.message}`), []);
  }
});

test("a weighed report says in the summary who is stopped at which core task, and at each finding what happens per group", () => {
  const evaluation = weighed(grouped());
  const full = renderHtml(evaluation, undefined, pictures(evaluation));
  const html = full.slice(full.indexOf("<body>"), full.indexOf("<script>"));
  const stopped = evaluation.defects!.filter((defect) => defect.severity === "blokkerend");
  assert.ok(stopped.length > 0);
  // The summary: a heading, the answer in one line, what a core task is, then a card per task with the task as a heading.
  assert.match(html, /<nldd-title size="display-4" heading-level="3" text="Wie loopt vast"><\/nldd-title><nldd-spacer size="8"><\/nldd-spacer><nldd-text size="lg" weight="medium">Bij beide kerntaken loopt een groep bezoekers vast\.<\/nldd-text>/);
  assert.ok(html.includes("<nldd-text>Een kerntaak is iets waarvoor bezoekers naar de site komen. Het onderzoek heeft de kerntaken uit de site afgeleid."));
  // Who is stopped and why are sentences of their own; the defects are a list of rows that lead to the work list, one tab stop each.
  assert.match(html, /<nldd-card><nldd-container padding="24" sm-padding="16"><nldd-title size="display-5" heading-level="4" text="Een vergunning aanvragen"><\/nldd-title><nldd-spacer size="12"><\/nldd-spacer><nldd-text weight="medium">Mensen die niet zien lopen hier vast\.<\/nldd-text><nldd-spacer size="4"><\/nldd-spacer><nldd-text>Zonder dit onderdeel is de aanvraag niet te versturen\.<\/nldd-text><nldd-spacer size="12"><\/nldd-spacer><nldd-list accessible-label="Waardoor ze vastlopen" appearance="box-tinted"><nldd-list-item href="#VRB-G-\w+"><nldd-text-cell text="[^"]+"><\/nldd-text-cell><nldd-icon-cell icon="chevron-right"[^>]*><\/nldd-icon-cell><\/nldd-list-item><nldd-list-item href="#VRB-G-\w+">/);
  for (const defect of stopped) assert.ok(html.includes(`<nldd-list-item href="#${defect.id}">`), defect.id);
  // On a wide screen the cards stand in two columns, on a narrow one in one.
  assert.match(html, /<nldd-container layout="lanes" column-count="2" sm-column-count="1" gap="24"><nldd-card>/);
  // What stops a group only together says so before its rows, and what the section can not show is said in smaller letters.
  assert.match(html, /text="Bij elke kerntaak"><\/nldd-title><nldd-spacer size="12"><\/nldd-spacer><nldd-text weight="medium">Mensen die slecht zien lopen hier vast door gebreken die samenkomen\.<\/nldd-text>(?:(?!<nldd-card>).)*<nldd-text>Geen van deze gebreken houdt hen alleen tegen:<\/nldd-text><nldd-spacer size="12"><\/nldd-spacer><nldd-list /);
  assert.ok(html.includes('<nldd-text size="sm" color="secondary">Deze lijst komt uit één weging door een taalmodel. Bij een tweede weging kan er een enkel gebrek bij komen of af vallen. Elke bevinding is apart gewogen. '));
  // What explains a table stands under it: the consequences as a list of terms, then where the groups come from.
  assert.match(html, /<\/nldd-table><nldd-spacer size="8"><\/nldd-spacer><nldd-text size="sm" color="secondary">De tabel telt per kerntaak de gebreken met elke ernst\./);
  assert.ok(html.includes("<nldd-rich-text><dl><dt>Kan het niet</dt><dd>Langs de eigen manier van werken is er geen weg.</dd><dt>Alleen met een omweg</dt><dd>De bezoeker moet een andere weg zoeken, zoals een andere pagina.</dd><dt>Met extra moeite</dt><dd>De eigen weg werkt, maar kost meer tijd of zoeken.</dd></dl></nldd-rich-text>"));
  assert.ok(html.includes('<nldd-text size="sm" color="secondary">De laatste kolom telt de criteria die voor deze groep nodig zijn'));
  // The tables per core task and per group have a row header and numbers set to the right; every group of the standard has a row.
  assert.match(html, /<nldd-table accessible-label="Gebreken per kerntaak" [^>]*><nldd-table-row slot="header"><nldd-text-cell text="Kerntaak"><\/nldd-text-cell><nldd-text-cell text="Blokkerend" horizontal-alignment="right">/);
  assert.match(html, /<nldd-table accessible-label="Gebreken per groep" [^>]*><nldd-table-row slot="header"><nldd-text-cell text="Groep"><\/nldd-text-cell><nldd-text-cell text="Kan het niet" horizontal-alignment="right">/);
  assert.match(html, /<nldd-text-cell row-header vertical-alignment="top" text="Mensen die niet zien"><\/nldd-text-cell><nldd-text-cell horizontal-alignment="right" vertical-alignment="top" text="\d+">/);
  assert.ok(html.includes('text="Mensen die gevoelig zijn voor flitsen"'));
  assert.ok(!html.includes('text="Zwaarste gebreken"'), "with a weighing the summary says who is stopped instead");
  // A defect in the work list says who is hit hardest in a line, and names the core task; the full account per group stands with the finding.
  assert.ok(html.includes("<p>Mensen die niet zien kunnen dit niet gebruiken. Ook één andere groep heeft er last van. Kerntaak: Een vergunning aanvragen.</p>"));
  assert.match(html, /<strong>Wie heeft er last van<\/strong><\/p><p>Mensen die niet zien kunnen dit niet gebruiken\. Ze gaan met de schermlezer van kop naar kop door de pagina\. Het onderdeel heeft geen naam, dus ze weten niet wat het is\.<\/p><p>/);
  assert.ok(html.includes("<p>Dit deel is nodig voor de kerntaak “Een vergunning aanvragen”. Zonder dit onderdeel is de aanvraag niet te versturen. Daarom is de ernst blokkerend.</p>"));
  assert.ok(html.includes("<p>De ernst kan anders uitvallen. Of dezelfde tekst ook elders op de pagina staat, is niet bekend.</p>"));
  assert.match(html, /<p>Uit de bevinding blijkt geen gevolg voor een groep bezoekers\.<\/p><p>Mensen die [^<]+ krijgen hier hetzelfde als andere bezoekers\. /);
  assert.ok(!/Niet vastgesteld:|Dit hoort bij|van de drie gevolgen/.test(html));
});

test("without a stopped task the account is short and stands beside the table per core task", () => {
  const evaluation = weighed(grouped());
  evaluation.weighing!.together = [];
  for (const finding of evaluation.criteria.flatMap((criterion) => criterion.findings)) if (finding.weighing!.task !== null && finding.weighing!.affected.some((entry) => entry.consequence === "cannot")) Object.assign(finding.weighing!, { task: null, blocksNl: undefined });
  const full = renderHtml(evaluation);
  const html = full.slice(full.indexOf("<body>"), full.indexOf("<script>"));
  assert.match(html, /<nldd-one-half-one-half-section padding-top="0"><nldd-container slot="left"><nldd-title size="display-4" heading-level="3" text="Wie loopt vast"><\/nldd-title><nldd-spacer size="8"><\/nldd-spacer><nldd-text size="lg" weight="medium">Bij geen van de 2 kerntaken loopt een groep bezoekers vast\.<\/nldd-text>(?:(?!<\/nldd-container>).)*<\/nldd-container><nldd-container slot="right"><nldd-title size="display-4" heading-level="3" text="Gebreken per kerntaak">/);
  assert.ok(!html.includes('<nldd-list accessible-label="Waardoor ze vastlopen"'), "no card without a stopped task");
  // The headings stay in order: no level is skipped.
  const levels = headingLevels(full);
  for (const [index, level] of levels.entries()) if (index > 0) assert.ok(level <= levels[index - 1]! + 1, `heading ${index} jumps from ${levels[index - 1]} to ${level}`);
});

test("the report is the same in its own page and as a fragment; only the frame differs", () => {
  const evaluation = grouped();
  // The tiles of the outcomes are the one part whose place follows the frame: in the summary, or under the title.
  const content = (html: string, end: string): string => html.slice(html.indexOf('<nldd-one-third-two-thirds-section id="samenvatting"'), html.indexOf(end)).replace(/<nldd-spacer size="24"><\/nldd-spacer><nldd-image src="data:image\/svg\+xml[^>]*><\/nldd-image>/, "");
  const standalone = renderHtml(evaluation, undefined, pictures(evaluation));
  const fragment = renderHtml(evaluation, undefined, pictures(evaluation), { frame: "embedded" });
  assert.ok(content(standalone, "<nldd-page-footer").length > 1000);
  assert.equal(content(fragment, '<nldd-sheet id="detail"'), content(standalone, "<nldd-page-footer"));
  assert.ok(standalone.includes("<nldd-hero") && !fragment.includes("<nldd-hero"), "a cover only on a page of its own");
  // The site around it has its own page, bar, footer and design system.
  for (const part of ["<html", "<head", "<body", "<nldd-shell", "<nldd-top-navigation-bar", "<nldd-page-footer", "<nldd-skip-link", "@font-face", "customElements"]) assert.ok(!fragment.includes(part), `no ${part} in the fragment`);
  assert.ok(fragment.length < standalone.length / 2, "the fragment holds none of the design system");
  for (const html of [standalone, fragment]) assert.equal(headingLevels(html).filter((level) => level === 1).length, 1);
});

test("the script holds the components the report shows, and the report shows no other", () => {
  const evaluation = grouped();
  for (const frame of ["standalone", "embedded"] as const) {
    const html = renderHtml(evaluation, undefined, pictures(evaluation), { frame });
    const used = new Set([...html.slice(Math.max(0, html.indexOf("<body>")), html.indexOf("<script>")).matchAll(/<(nldd-[a-z-]+)/g)].map((match) => match[1]!));
    assert.deepEqual([...used].filter((tag) => !(REPORT_COMPONENTS as readonly string[]).includes(tag)), [], `${frame}: every component is in the bundle`);
  }
  // Much smaller than the bundle of the whole design system, and with the licenses of what it holds.
  const html = renderHtml(evaluation);
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.ok(script.length < 1_500_000, `the script is ${script.length} bytes`);
  // Split, so that REUSE does not read this line as the license of this file.
  assert.match(script, new RegExp(["SPDX", "License-Identifier: BSD-3-Clause"].join("-")));
});

test("a page of the sample is shown with a numbered mark at each defect, and the same marks as a list of links under it", () => {
  const evaluation = grouped();
  const label = pageLabels(evaluation)[0]!;
  const html = renderHtml(evaluation, undefined, pictures(evaluation), { pageShots: shots(evaluation) });
  const section = html.slice(html.indexOf(`id="pagina-${label}"`));
  const svg = section.slice(section.indexOf("<svg"), section.indexOf("</svg>"));
  assert.match(svg, /role="img" aria-label="Schermafbeelding van [^"]+markering/, "the picture has a text alternative");
  // A mark is out of the tab order and hidden from assistive technology: the list has the same links, with names (WCAG 2.4.4).
  const marked = [...svg.matchAll(/<a href="#([^"]+)" tabindex="-1" aria-hidden="true">/g)].map((match) => match[1]!);
  assert.equal([...svg.matchAll(/<a /g)].length, marked.length, "every mark is hidden");
  assert.ok(marked.length > 0, "at least one mark");
  const listed = [...section.slice(section.indexOf("<ol>"), section.indexOf("</ol>")).matchAll(/<a href="#([^"]+)">/g)].map((match) => match[1]!);
  assert.deepEqual(listed, marked, "the list names the marks in the same order, as links");
  // Without pictures every page still lists its defects.
  assert.ok(renderHtml(evaluation).includes(`id="pagina-${label}"`));
});

test("a card shows the first sentence of the fix; the rest waits behind a button, and printing shows it", () => {
  assert.equal(firstSentence("Geef de link een naam. Doe dat in de kop."), "Geef de link een naam.");
  assert.equal(firstSentence("Zet bijv. een label op het veld. Daarna meer."), "Zet bijv. een label op het veld.");
  assert.equal(firstSentence("Gebruik `a.skip. link` als doel. En meer."), "Gebruik `a.skip. link` als doel.");
  assert.equal(firstSentence("Eén zin zonder punt"), "Eén zin zonder punt");
  const evaluation = grouped();
  const html = renderHtml(evaluation);
  const defect = evaluation.defects![0]!;
  assert.ok(html.includes(`id="meer-${defect.mainFindingId}"`), "a button per card");
  assert.match(html, new RegExp(`<nldd-container id="details-${defect.mainFindingId.replace(/[.]/g, "\\.")}" hidden`), "the rest is in the card, hidden");
  assert.ok(html.includes('window.addEventListener("beforeprint"') && html.includes("details.hidden = false"), "printing shows the rest");
});

test("the findings under a criterion are a list under the heading Bevindingen, and a card there has no heading of its own (WCAG 1.3.1)", () => {
  let cards = 0;
  for (const evaluation of [exampleEvaluation(), grouped()]) {
    const full = renderHtml(evaluation);
    const html = full.slice(full.indexOf("<body>"), full.indexOf("<script>"));
    assert.doesNotMatch(html, /<p><strong>Bevindingen/, "Bevindingen is a heading everywhere");
    for (const match of html.matchAll(/<p role="heading" aria-level="6" data-level="6"><strong>Bevindingen \(\d+\)<\/strong><\/p>/g)) {
      const rest = html.slice(match.index! + match[0].length);
      // The labels in the hidden rest of a card are no part of this: they show in the sheet, at level 3.
      const next = rest.match(/<nldd-title\b[^>]*\bheading-level="(\d)"/);
      assert.ok(!next || Number(next[1]) < 6, "no title at level 6 follows Bevindingen before the next criterion");
      assert.match(rest, /^<\/nldd-rich-text><nldd-spacer[^>]*><\/nldd-spacer>(<nldd-list |<nldd-container [^>]*role="list")/, "a list follows the heading");
    }
    cards += [...html.matchAll(/<nldd-card id="[^"]+" role="listitem">/g)].length;
  }
  assert.ok(cards > 0, "the example has a criterion with a card under it");
});

test("the sheet with the rest of a card has a heading that wraps, and its bar takes the title over from it (WCAG 1.4.12)", () => {
  const html = renderHtml(grouped());
  assert.match(html, /<nldd-top-title-bar [^>]*id="detail-titel"[^>]*collapse-anchor="detail-kop"/);
  assert.match(html, /<nldd-simple-section id="detail-inhoud"><nldd-title [^>]*heading-level="2"[^>]*slot="header"[^>]*id="detail-kop"|<nldd-simple-section id="detail-inhoud"><nldd-title [^>]*id="detail-kop"/);
  assert.ok(html.includes("sheetBar.text = sheetHeading.text ="), "the script sets both to the title of the card");
});

test("the tag with the verification of a finding is a few words, since a tag does not wrap (WCAG 1.4.10)", () => {
  const html = renderHtml(grouped());
  const labels = [...html.matchAll(/<nldd-tag [^>]*text="([^"]+)"/g)].map((match) => match[1]!);
  assert.ok(labels.length > 0);
  for (const label of labels.filter((text) => !text.startsWith("Leverancier: "))) assert.ok(label.length <= 30, `tag "${label}" is ${label.length} characters`);
});

test("a defect card shows the severity of the defect, and says which finding gives it when that is not the one shown", () => {
  // The search field without a name is also reported as a field without a label, so one defect holds two findings.
  const twice = (): Evaluation => {
    const example = exampleEvaluation();
    const search = example.criteria.find((criterion) => criterion.id === "4.1.2")!.findings.find((finding) => finding.component === "zoekveld")!;
    Object.assign(example.criteria.find((criterion) => criterion.id === "3.3.2")!, { outcome: "failed", findings: [{ ...search, id: "VRB-3.3.2-zoek", criterion: "3.3.2", titleNl: "Zoekveld heeft alleen een voorbeeldtekst" }] });
    example.defects = mergeFindings(example);
    return weighed(example);
  };
  const evaluation = twice();
  // The finding the card shows in full weighs lighter than the other finding of the defect.
  const defect = evaluation.defects!.find((entry) => entry.findingIds.length > 1)!;
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const main = findings.find((finding) => finding.id === defect.mainFindingId)!;
  const other = findings.find((finding) => defect.findingIds.includes(finding.id) && finding.id !== main.id)!;
  Object.assign(main, { severity: "laag", weighing: { task: null, affected: [{ group: "no-vision", consequence: "effort", textNl: "Ze horen het veld zonder naam." }] } });
  Object.assign(other, { severity: "blokkerend", weighing: { task: "aanvragen", blocksNl: "Zonder dit veld is de aanvraag niet te versturen.", affected: [{ group: "no-vision", consequence: "cannot", textNl: "Ze horen niet wat het veld vraagt." }] } });
  Object.assign(defect, { severity: "blokkerend", weighing: { task: "aanvragen", blocksNl: other.weighing!.blocksNl, affected: other.weighing!.affected } });
  const full = renderHtml(evaluation, undefined, pictures(evaluation));
  const card = full.slice(full.indexOf(`<nldd-card id="${defect.id}"`), full.indexOf("</nldd-card>", full.indexOf(`<nldd-card id="${defect.id}"`)));
  assert.ok(card.includes('text="Ernst: blokkerend"') && !card.includes('text="Ernst: laag"'), "the tag is the severity of the defect");
  assert.ok(card.includes(`<p>De ernst blokkerend komt van bevinding <a href="#${other.id}">${other.id}</a>.</p>`));
  // The same severity on the main finding: nothing to explain.
  const same = twice();
  for (const finding of same.criteria.flatMap((criterion) => criterion.findings)) if (same.defects!.find((entry) => entry.findingIds.length > 1)!.findingIds.includes(finding.id)) finding.severity = "blokkerend";
  assert.ok(!renderHtml(same, undefined, pictures(same)).includes("komt van bevinding"));
});
