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
  for (const evaluation of [exampleEvaluation(), grouped()]) {
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

test("every id is unique, every link inside the report lands, and every finding can be reached", () => {
  for (const evaluation of [exampleEvaluation(), grouped()]) {
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
  const evaluation = grouped();
  writeFileSync(file, renderHtml(evaluation, undefined, pictures(evaluation), { embed: false, pageShots: shots(evaluation) }));
  const result = await run(process.execPath, [LINT, "lint", "--pure", "--format", "json", file], { cwd: dir }).catch((error: { stdout: string }) => error);
  const findings = (JSON.parse(result.stdout) as { findings: { rule: string; severity: string; message: string }[] }).findings;
  assert.deepEqual(findings.filter((finding) => finding.severity !== "hint").map((finding) => `${finding.rule}: ${finding.message}`), []);
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
  const marked = [...svg.matchAll(/<a href="#([^"]+)" tabindex="-1">/g)].map((match) => match[1]!);
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
