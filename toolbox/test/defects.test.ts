import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkMerge, merge } from "../src/commands/merge.ts";
import { readEvaluation, sign, signatureIsCurrent } from "../src/commands/sign.ts";
import { seal } from "../src/commands/verify.ts";
import { canonicalJson, readJson } from "../src/lib/canonical.ts";
import { applyProposal, carryDefectIds, mainCriterion, mergeFindings, pageIndex, pagesOf, parseTargets, validateProposal, type MergeProposal } from "../src/lib/defects.ts";
import { evaluationHash, summarise, type Evaluation, type ReportFinding } from "../src/lib/evaluation.ts";
import { renderMarkdown } from "../src/lib/report-markdown.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { typesSeal } from "./fixtures/terminal.ts";

type Draft = Partial<ReportFinding> & { where: string | string[]; page?: string };

/** The example evaluation with exactly these findings, by criterion. A finding is "T-<criterion>-<n>". */
function evaluationWith(byCriterion: Record<string, Draft[]>): Evaluation {
  // Only a report to account for is signed (#318).
  const evaluation = { ...exampleEvaluation(), purpose: "verantwoorden" as const };
  for (const criterion of evaluation.criteria) {
    const drafts = byCriterion[criterion.id] ?? [];
    criterion.outcome = drafts.length > 0 ? "failed" : criterion.outcome === "failed" ? "passed" : criterion.outcome;
    criterion.findings = drafts.map(({ where, page, ...rest }, index) => ({
      titleNl: `Probleem onder ${criterion.id}`,
      observedNl: "Wat er mis is.",
      impactNl: "Wie er last van heeft.",
      fixNl: "Wat er moet gebeuren.",
      severity: "midden",
      owner: "techniek",
      component: null,
      locations: (Array.isArray(where) ? where : [where]).map((entry) => ({ page: page ?? "P01", where: entry })),
      pagesAffected: page ?? "P01",
      evidence: ["engine"],
      id: `T-${criterion.id}-${index + 1}`,
      criterion: criterion.id,
      ...rest,
    }));
  }
  evaluation.summary = summarise(evaluation.criteria);
  return evaluation;
}

const groups = (evaluation: Evaluation): string[][] => mergeFindings(evaluation).map((defect) => [...defect.findingIds].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));

test("selectors are read from a description of a place, and what only says where to look is left out", () => {
  // A selector in brackets after another is the same element written a second way.
  assert.deepEqual(parseTargets("div.search-icon in de kop (#page > header > div:nth-of-type(3) > div)"), [["div.search-icon", "#page > header > div:nth-of-type(3) > div"]]);
  // A list is several elements; a range of ids names everything in between.
  assert.deepEqual(parseTargets("#input_2_3, #input_2_5 en input#input_2_8"), [["#input_2_3"], ["#input_2_5"], ["#input_2_8"]]);
  assert.deepEqual(parseTargets("#choice_6_5_1 tot en met #choice_6_5_3, het getekende vakje"), [["#choice_6_5_1"], ["#choice_6_5_2"], ["#choice_6_5_3"]]);
  assert.deepEqual(parseTargets("#menu > li:nth-of-type(1), li:nth-of-type(2) en li:nth-of-type(5)"), [["#menu > li:nth-of-type(1)"], ["#menu > li:nth-of-type(2)"], ["#menu > li:nth-of-type(5)"]]);
  // Custom elements and shadow roots are part of a chain; a word with a hyphen on its own is not a selector.
  assert.deepEqual(parseTargets("#content > nldd-box > nldd-card:nth-of-type(3) >>> a, het e-mailveld"), [["#content > nldd-box > nldd-card:nth-of-type(3) > a"]]);
  assert.deepEqual(parseTargets("img Afvalvrij_R-Ladder_V4.2-1536x1316.png, onder de kop"), [["file:afvalvrij_r-ladder_v4.2-1536x1316.png"]]);
  assert.deepEqual(parseTargets("de zoekresultaten onder het zoekveld #search"), []);
  assert.deepEqual(parseTargets("#input_1_1 in formulier #gform_1, groene balk onderaan"), [["#input_1_1"]]);
  assert.deepEqual(parseTargets("blok met foto en groene tegels boven de voet"), []);
});

test("the pages a finding names include ranges and leave out what it excludes", () => {
  const evaluation = evaluationWith({ "1.1.1": [{ where: "#a", pagesAffected: "P02 tot en met P04" }, { where: "#b", pagesAffected: "7 van 8 (alle behalve P08)" }, { where: "#c", pagesAffected: "alle 8" }] });
  const [range, except, all] = evaluation.criteria.find((criterion) => criterion.id === "1.1.1")!.findings.map((finding) => pagesOf(finding, pageIndex(evaluation)));
  assert.deepEqual(range, ["P01", "P02", "P03", "P04"]);
  assert.deepEqual(except, ["P01", "P02", "P03", "P04", "P05", "P06", "P07"]);
  assert.equal(all!.length, 8);
});

test("the same contrast failure in the light and the dark scheme is one defect", () => {
  const where = ["#post-1437 > div:nth-of-type(2) section h1 ('Hulp nodig?')", "oranje blok onder het nieuwsbericht"];
  const evaluation = evaluationWith({
    "1.4.3": [
      { titleNl: "Witte koppen op oranje zijn slecht leesbaar (donker kleurenschema)", where },
      { titleNl: "Witte tekst op oranje is slecht leesbaar (donker kleurenschema)", where: "#post-1437 > div:nth-of-type(2) section p:nth-of-type(1) > span" },
      { titleNl: "Witte koppen op oranje zijn slecht leesbaar (licht kleurenschema)", where },
    ],
  });
  const defects = mergeFindings(evaluation);
  assert.deepEqual(groups(evaluation), [["T-1.4.3-1", "T-1.4.3-3"], ["T-1.4.3-2"]]);
  const joined = defects.find((defect) => defect.findingIds.length === 2)!;
  assert.deepEqual(joined.mergedBy, ["duplicate"]);
  assert.deepEqual(joined.alsoCriteria, []);
});

test("one element reported under five criteria is one defect, filed under the criterion about the cause", () => {
  const each = ["#choice_6_5_1", "#choice_6_5_2", "#choice_6_5_3"];
  const evaluation = evaluationWith({
    "1.3.1": [{ where: "#choice_6_5_1 tot en met #choice_6_5_3", severity: "hoog", owner: "content" }],
    "1.3.5": [{ where: "#choice_6_5_1 tot en met #choice_6_5_3, het getekende vakje voor elk label", owner: "design" }],
    "2.1.1": [{ where: each }],
    "2.5.3": [{ where: each, severity: "laag" }],
    "4.1.2": [{ where: "input#choice_6_5_1 tot en met #choice_6_5_3", titleNl: "Aankruisvakjes bestaan niet voor hulpsoftware", component: "aanmeldformulier" }, { where: "#search", titleNl: "Zoekveld heeft geen naam" }],
  });
  const defects = mergeFindings(evaluation);
  assert.equal(defects.length, 2);
  const defect = defects.find((entry) => entry.findingIds.length === 5)!;
  assert.equal(defect.mainCriterion, "4.1.2");
  assert.equal(defect.mainFindingId, "T-4.1.2-1");
  assert.equal(defect.titleNl, "Aankruisvakjes bestaan niet voor hulpsoftware");
  assert.deepEqual(defect.alsoCriteria, ["1.3.1", "1.3.5", "2.1.1", "2.5.3"]);
  assert.deepEqual(defect.findingIds, ["T-4.1.2-1", "T-1.3.1-1", "T-1.3.5-1", "T-2.1.1-1", "T-2.5.3-1"]);
  assert.equal(defect.severity, "hoog", "the highest severity among its findings");
  assert.equal(defect.owner, "techniek", "the owner of the main finding");
  assert.equal(defect.component, "aanmeldformulier");
  assert.equal(defect.element, "#choice_6_5_1");
  assert.deepEqual(defect.pages, ["P01"]);
  assert.deepEqual(defect.mergedBy, ["element"]);
  // Nothing was taken from the findings themselves.
  assert.equal(evaluation.criteria.flatMap((criterion) => criterion.findings).length, 6);
});

test("the main criterion follows a fixed order of precedence", () => {
  assert.equal(mainCriterion(["2.4.7", "2.4.11"]), "2.4.11");
  assert.equal(mainCriterion(["1.4.4", "1.4.10"]), "1.4.10");
  assert.equal(mainCriterion(["1.3.1", "2.4.6"]), "1.3.1");
  assert.equal(mainCriterion(["4.1.2", "2.5.3", "2.4.4"]), "2.4.4");
  assert.equal(mainCriterion(["1.4.10", "1.4.5", "1.1.1"]), "1.4.5");
  // Without a rule for either: the order of WCAG.
  assert.equal(mainCriterion(["3.2.4", "1.4.3"]), "1.4.3");
});

test("findings at different places stay different defects", () => {
  // The same selector on pages the findings do not share.
  assert.equal(mergeFindings(evaluationWith({ "1.3.1": [{ where: "#main > section:nth-of-type(1) h1", page: "P02" }], "2.4.6": [{ where: "#main > section:nth-of-type(1) h1", page: "P03" }] })).length, 2);
  // The same component, but other elements in it.
  const sameComponent = evaluationWith({
    "1.3.1": [{ component: "zoekresultaten", where: "#content > div:nth-of-type(1) > h2" }],
    "1.4.10": [{ component: "zoekresultaten", where: "#content > div:nth-of-type(2) > div:nth-of-type(1)" }],
    "3.1.2": [{ component: "Zoekresultaten", where: "laatste resultaat onder de kop 'Webpagina's'" }],
  });
  assert.equal(mergeFindings(sameComponent).length, 3);
  // A selector that only says where to look.
  assert.equal(mergeFindings(evaluationWith({ "1.3.1": [{ where: "de zoekresultaten onder het zoekveld #search" }], "4.1.2": [{ where: "#search" }] })).length, 2);
  // A finding about one button does not dissolve into a finding about four.
  const header = evaluationWith({ "2.4.7": [{ where: "#header > a:nth-of-type(1)" }], "4.1.2": [{ where: ["#header > a:nth-of-type(1)", "#header > a:nth-of-type(2)", "#header > a:nth-of-type(3)", "#header > a:nth-of-type(4)"] }] });
  assert.equal(mergeFindings(header).length, 2);
  // The block around an element is not the element.
  assert.equal(mergeFindings(evaluationWith({ "1.1.1": [{ where: "#post-25, img.wp-image-2198 onder 'Meld je aan'" }], "2.4.4": [{ where: "#post-25, rij met logo's: a.partner > img" }] })).length, 2);
});

test("contrast on an element is its own defect, apart from what else is wrong with the element", () => {
  const evaluation = evaluationWith({
    "3.3.2": [{ where: "#input_1_1 in formulier #gform_1", titleNl: "Veld heeft alleen een voorbeeldtekst" }],
    "1.3.5": [{ where: "#input_1_1" }],
    "1.4.3": [{ where: "#input_1_1", titleNl: "Voorbeeldtekst is te licht" }],
    "1.4.11": [{ where: "#input_1_1, in de groene balk", titleNl: "Veld valt weg tegen de balk" }],
  });
  assert.deepEqual(groups(evaluation), [["T-1.3.5-1", "T-3.3.2-1"], ["T-1.4.11-1", "T-1.4.3-1"]]);
});

test("a frame is not an element two findings can meet in, and a defect's pages are those its findings point at", () => {
  const evaluation = evaluationWith({
    "4.1.2": [{ titleNl: "Videovenster zonder naam", where: "iframe#player (player.vimeo.com/video/1)", page: "P03" }],
    "2.1.4": [{ titleNl: "Video heeft sneltoetsen van één teken", where: "ingesloten venster (iframe#player) met adres https://player.vimeo.com/video/1", page: "P03" }],
    "2.4.3": [{ where: "#menu > a", page: "P01", pagesAffected: "7 van 8 (P01 tot en met P07; P08 is een niet geladen ingesloten video)" }],
    "2.4.7": [{ where: "#menu > a", page: "P02", pagesAffected: "7 van 8 (P01 tot en met P07)" }],
  });
  const defects = mergeFindings(evaluation);
  assert.deepEqual(groups(evaluation), [["T-2.1.4-1"], ["T-2.4.3-1", "T-2.4.7-1"], ["T-4.1.2-1"]]);
  const menu = defects.find((defect) => defect.findingIds.length === 2)!;
  assert.deepEqual(menu.pages, ["P01", "P02"], "not the pages the free text mentions");
  assert.equal(menu.morePages, true);
  assert.equal(defects.find((defect) => defect.mainCriterion === "4.1.2")!.morePages, false);
  // A proposal may still join the two findings about the frame, with a reason.
  assert.deepEqual(validateProposal(proposalFor(evaluation, [["T-4.1.2-1", "T-2.1.4-1"]]), evaluation, defects), []);
});

test("the same named component on the same pages is one defect when the findings share an element", () => {
  const evaluation = evaluationWith({
    "1.1.1": [{ component: "Videoblok", where: ["div.icon-play.video-play-btn (#page > section:nth-of-type(2) > div:nth-of-type(3) > div)", "div.icon-play.youtube-play-btn, tweede video", "het pictogram ernaast"] }],
    "2.1.1": [{ component: "videoblok", where: ["#page > section:nth-of-type(2) > div:nth-of-type(3) > div (div.video-play-btn)", "#page > section:nth-of-type(2) > div:nth-of-type(5) > div", "de sluitknop", "de volumeknop"] }],
  });
  const [defect, ...rest] = mergeFindings(evaluation);
  assert.equal(rest.length, 0);
  assert.deepEqual(defect!.mergedBy, ["component"]);
});

test("a finding per element belongs to the finding that names all of them", () => {
  const evaluation = evaluationWith({
    "2.1.1": [{ where: "#page > header > div:nth-of-type(3) > div (div.search-icon)" }, { where: ["#page > div:nth-of-type(5) > div:nth-of-type(1) (div.accessibility-contrast)", "#page > div:nth-of-type(5) > div:nth-of-type(2) (div.accessibility-font)"] }],
    "4.1.2": [{ where: ["#page > header > div:nth-of-type(3) > div (div.search-icon)", "#page > div:nth-of-type(5) > div:nth-of-type(1) en div:nth-of-type(2)", "span.search-btn-icon naast het zoekveld"] }],
    "1.4.11": [{ where: "#page > footer > a" }],
  });
  assert.deepEqual(groups(evaluation), [["T-1.4.11-1"], ["T-2.1.1-1", "T-2.1.1-2", "T-4.1.2-1"]]);
  // Without the broad finding the two are about different buttons.
  for (const criterion of evaluation.criteria) if (criterion.id === "4.1.2") criterion.findings = [];
  assert.equal(mergeFindings(evaluation).length, 3);
});

test("with observations of the session the element decides, not the wording", () => {
  const path = ["#aanmelden", "input[name=keuze]"];
  const evaluation = evaluationWith({
    "1.3.1": [{ where: "de vakjes onder 'Waar ben je in geinteresseerd'", targets: [{ page: "P01", path, state: "s-1" }] }],
    "4.1.2": [{ where: "aankruisvakjes in het formulier", targets: [{ page: "P01", path, state: "s-2-dark" }] }],
    "2.1.1": [{ where: "aankruisvakjes in het formulier", targets: [{ page: "P01", path: ["#contact", "input[name=keuze]"], state: "s-1" }] }],
  });
  assert.deepEqual(groups(evaluation), [["T-1.3.1-1", "T-4.1.2-1"], ["T-2.1.1-1"]]);
  assert.equal(mergeFindings(evaluation).find((defect) => defect.findingIds.length === 2)!.element, "#aanmelden >>> input[name=keuze]");
});

test("the same colour measured on the same element is one defect, whatever each judge called the part", () => {
  const item = (nth: number): string[] => [`#menu > app-list > app-list-item:nth-of-type(${nth})`, "div > a"];
  const draft = (extra: Partial<Draft>): Draft => ({ where: "item van de huidige pagina in het zijmenu", ...extra });
  const narrow = draft({ component: "zijmenu (app-list-item, current)", observedNl: "Het vlak is #D9DEE5 op #f5f7f9: 1,2 op 1. In donker #3c4450 op #1a1e24.", page: "P03", pagesAffected: "P03 en P07", targets: [{ page: "P03", path: item(1), state: null }, { page: "P03", path: [item(1)[0]!], state: null }, { page: "P07", path: item(2), state: null }, { page: "P07", path: ["#footer > app-crumb:nth-of-type(3)"], state: null }] });
  // The other judge measured the same item on another page, and the items that are current elsewhere.
  const wide = draft({ component: "zijmenu en menuvenster (app-list-item)", observedNl: "Alleen een grijs vlak (rgb(217, 222, 229)) dat 1,2 op 1 afsteekt.", page: "P03", pagesAffected: "P02, P03, P05 en P06", targets: [{ page: "P02", path: item(1), state: null }, { page: "P05", path: item(9), state: null }, { page: "P06", path: item(10), state: "s-1" }, { page: "P03", path: ["html > body > app-sheet > app-list > app-list-item:nth-of-type(3)", "div > a"], state: "s-2" }] });
  const evaluation = evaluationWith({ "1.4.1": [wide], "1.4.11": [narrow] });
  const [defect, ...rest] = mergeFindings(evaluation);
  assert.deepEqual(rest, []);
  assert.deepEqual([defect!.findingIds, defect!.mergedBy, defect!.mainCriterion, defect!.alsoCriteria], [["T-1.4.1-1", "T-1.4.11-1"], ["measurement"], "1.4.1", ["1.4.11"]]);
  // Another colour on the same element is not shown to be the same thing: the other rules decide, and they see mostly different places.
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": [wide], "1.4.11": [{ ...narrow, observedNl: "De rand is #cccccc op #ffffff." }] })).length, 2);
  // The same colour on another element is another defect: a site uses one grey in many places.
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": [wide], "1.4.11": [{ ...narrow, targets: [{ page: "P03", path: ["#search", "input"], state: null }] }] })).length, 2);
  // Only for colour: what is wrong with the name of the item is repaired somewhere else than its colour.
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": [wide], "4.1.2": [narrow] })).length, 2);
  // And only with elements an observation recorded: a selector in prose and a colour in common prove too little.
  const { targets: _narrow, ...narrowProse } = narrow;
  const { targets: _wide, ...wideProse } = wide;
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": [{ ...wideProse, where: "#menu app-list-item, item van de huidige pagina", page: "P02", pagesAffected: "P02" }], "1.4.11": [{ ...narrowProse, where: "#crumbs app-crumb, huidige pagina" }] })).length, 2);
});

test("three findings with the same measured pair of colours at one element are one line in the work list, with the criteria", () => {
  const item = (nth: number): string[] => [`#menu > app-list > app-list-item:nth-of-type(${nth})`, "div > a"];
  // Each judge cites the item that is current on the page it looked at: another item of the same menu on every page.
  const draft = (page: string, nth: number, extra: Partial<Draft> = {}): Draft => ({ where: "item van de huidige pagina in het zijmenu", page, pagesAffected: `${page} en P02`, observedNl: "Het vlak is #D9DEE5 op #f5f7f9 (1,2:1).", targets: [{ page, path: item(nth), state: null }], ...extra });
  const three = { "1.4.1": [draft("P02", 2, { component: "zijmenu" })], "1.4.3": [draft("P04", 4, { observedNl: "De tekst staat op een vlak van rgb(245, 247, 249) op #d9dee5." })], "1.4.11": [draft("P05", 5, { component: "menu-item, geselecteerd" })] };
  const evaluation = evaluationWith(three);
  const defects = mergeFindings(evaluation);
  assert.equal(defects.length, 1);
  assert.deepEqual([defects[0]!.findingIds, defects[0]!.mergedBy, defects[0]!.mainCriterion, defects[0]!.alsoCriteria], [["T-1.4.1-1", "T-1.4.3-1", "T-1.4.11-1"], ["cause"], "1.4.1", ["1.4.3", "1.4.11"]]);
  // The outcome per criterion and the findings stay as they were; the work list has one line.
  assert.deepEqual(evaluation.criteria.filter((criterion) => criterion.findings.length > 0).map((criterion) => [criterion.id, criterion.outcome, criterion.findings.length]), [["1.4.1", "failed", 1], ["1.4.3", "failed", 1], ["1.4.11", "failed", 1]]);
  evaluation.defects = defects;
  const worklist = renderMarkdown(evaluation).split("## Wat nu")[1]!.split("\n## ")[0]!;
  assert.equal(worklist.split(`<a id="${defects[0]!.id}"></a>`).length - 1, 1);
  assert.ok(worklist.includes("Hoofdcriterium 1.4.1, raakt ook 1.4.3, 1.4.11."));

  // The same component in the same words, without observations, is the same element too.
  const named = (page: string, criterion: string): Draft => ({ where: "het zoekveld", page, component: "Zoekveld", observedNl: `Rand ${criterion}: #949494 op #ffffff.` });
  assert.equal(mergeFindings(evaluationWith({ "1.4.3": [named("P01", "a")], "1.4.11": [named("P01", "b")] })).length, 1);

  // Strict: one colour in common, a ratio without colours, another element, or a criterion not about colour stays apart.
  const apart = (extra: Record<string, Draft[]>): number => mergeFindings(evaluationWith({ ...three, ...extra })).length;
  assert.equal(apart({ "1.4.3": [draft("P04", 4, { observedNl: "De tekst is #d9dee5 op #ffffff." })] }), 2, "one colour of the pair is not the pair");
  assert.equal(apart({ "1.4.3": [draft("P04", 4, { observedNl: "Het vlak steekt 1,2 op 1 af." })] }), 2, "a ratio alone is not a measured pair");
  assert.equal(apart({ "1.4.3": [draft("P04", 4, { targets: [{ page: "P04", path: ["#footer > app-crumb:nth-of-type(2)"], state: null }] })] }), 2, "the same pair elsewhere is another place to repair");
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": three["1.4.1"], "1.3.1": [draft("P02", 2)] })).length, 2, "what is wrong in the code is repaired somewhere else than the colour");
  const { targets: _targets, ...prose } = draft("P02", 2);
  assert.equal(mergeFindings(evaluationWith({ "1.4.1": [{ ...prose, where: "#menu app-list-item, huidige pagina" }], "1.4.11": [{ ...prose, where: "#crumbs app-crumb, huidige pagina" }] })).length, 2, "a selector read from prose is not enough");
});

test("the same input gives the same defects, and a defect keeps its identifier across evaluations", () => {
  const build = (extra: Draft[] = []): Evaluation => evaluationWith({ "1.3.1": [{ where: "#search" }], "3.3.2": [{ where: "#search" }, ...extra], "4.1.2": [{ where: "#search" }, { where: "#menu > button" }], "2.4.7": [{ where: "#footer > a" }] });
  const first = mergeFindings(build());
  assert.equal(canonicalJson(mergeFindings(build())), canonicalJson(first));
  assert.equal(new Set(first.map((defect) => defect.id)).size, first.length);
  for (const defect of first) assert.match(defect.id, /^T-G-[0-9a-f]{4}$/);

  // A defect that gains a finding is still the same defect.
  const grown = mergeFindings(build([{ where: "#search", titleNl: "Niet te zien dat het veld verplicht is" }]));
  const search = (defects: typeof first) => defects.find((defect) => defect.findingIds.includes("T-4.1.2-1"))!;
  assert.equal(search(grown).findingIds.length, 4);
  assert.equal(search(grown).id, search(first).id);

  // After a re-evaluation the identifier is carried by the findings the defect holds, like finding identifiers are.
  const later = mergeFindings(build());
  for (const defect of later) defect.id = `T-G-new${later.indexOf(defect)}`;
  assert.deepEqual(carryDefectIds(later, first), { carried: 3, fresh: 0 });
  assert.deepEqual(later.map((defect) => defect.id), first.map((defect) => defect.id));
  // A defect that did not exist before gets no identifier of another.
  const other = mergeFindings(evaluationWith({ "1.1.1": [{ where: "#logo" }], "2.4.7": [{ where: "#footer > a" }] }));
  assert.deepEqual(carryDefectIds(other, first), { carried: 1, fresh: 1 });
  assert.equal(new Set([...other.map((defect) => defect.id)]).size, 2);
});

const proposalFor = (evaluation: Evaluation, join: string[][] = [], main: Record<string, string> = {}): MergeProposal => {
  const defects = mergeFindings(evaluation).map((defect) => ({ findings: [...defect.findingIds], mainCriterion: defect.mainCriterion }) as MergeProposal["defects"][number]);
  for (const ids of join) {
    const parts = defects.filter((defect) => defect.findings.some((id) => ids.includes(id)));
    const merged = { findings: parts.flatMap((part) => part.findings), mainCriterion: main[ids[0]!] ?? mainCriterion(parts.map((part) => part.mainCriterion)), reasonNl: "Beide gaan over hetzelfde element; één aanpassing lost ze samen op." };
    defects.splice(0, defects.length, ...defects.filter((defect) => !parts.includes(defect)), merged);
  }
  return { defects };
};

function proposalCase(): Evaluation {
  return evaluationWith({
    "1.1.1": [{ where: "voettekst rechtsonder, het logo van de gemeente", pagesAffected: "alle 8" }],
    "2.4.4": [{ where: "#page > footer > div:nth-of-type(3) > a", pagesAffected: "alle 8" }],
    "3.3.2": [{ where: "#search", page: "P03" }],
    "4.1.2": [{ where: "#search", page: "P03" }, { where: "#menu > button", page: "P02" }],
    "2.1.1": [{ where: "#contact > form > input:nth-of-type(2)", page: "P03" }],
  });
}

test("a proposal may join findings at the same place and name the main criterion", () => {
  const evaluation = proposalCase();
  const byRules = mergeFindings(evaluation);
  assert.equal(byRules.length, 5);
  // Unchanged is always valid.
  assert.deepEqual(validateProposal(proposalFor(evaluation), evaluation, byRules), []);
  const proposal = proposalFor(evaluation, [["T-1.1.1-1", "T-2.4.4-1"]], { "T-1.1.1-1": "1.1.1" });
  assert.deepEqual(validateProposal(proposal, evaluation, byRules), []);
  const applied = applyProposal(evaluation, byRules, proposal);
  assert.equal(applied.defects.length, 4);
  assert.deepEqual({ joined: applied.joined, mainOverridden: applied.mainOverridden }, { joined: 1, mainOverridden: 1 });
  const logo = applied.defects.find((defect) => defect.findingIds.includes("T-1.1.1-1"))!;
  assert.equal(logo.mainCriterion, "1.1.1", "the proposal overrides the precedence, which would say 2.4.4");
  assert.match(logo.mainReasonNl!, /hetzelfde element/);
  assert.deepEqual(logo.mergedBy, ["proposal"]);
  assert.deepEqual(applied.defects.find((defect) => defect.findingIds.includes("T-3.3.2-1"))!.mergedBy, ["element"]);
  assert.equal(new Set(applied.defects.flatMap((defect) => defect.findingIds)).size, 6);
});

test("a proposal that does more than that is refused", () => {
  const evaluation = proposalCase();
  const byRules = mergeFindings(evaluation);
  const problems = (change: (proposal: MergeProposal) => void, join: string[][] = []): string => {
    const proposal = proposalFor(evaluation, join);
    change(proposal);
    return validateProposal(proposal, evaluation, byRules).join("\n");
  };
  assert.match(validateProposal({ gebreken: [] }, evaluation, byRules).join(), /must be a JSON object with a list "defects"/);
  // A finding left out, named twice, or made up.
  assert.match(problems((proposal) => void proposal.defects.pop()), /is in no defect; every finding must be named exactly once/);
  assert.match(problems((proposal) => void proposal.defects.push({ findings: ["T-2.1.1-1"], mainCriterion: "2.1.1" })), /T-2\.1\.1-1 is already in defects\[\d\]/);
  assert.match(problems((proposal) => void proposal.defects.push({ findings: ["T-9.9.9-1"], mainCriterion: "9.9.9" })), /"T-9\.9\.9-1" is not a finding of this evaluation/);
  // What the rules joined is taken apart.
  assert.match(
    problems((proposal) => {
      const search = proposal.defects.find((defect) => defect.findings.includes("T-3.3.2-1"))!;
      search.findings = ["T-3.3.2-1"];
      proposal.defects.push({ findings: ["T-4.1.2-1"], mainCriterion: "4.1.2" });
    }),
    /T-3\.3\.2-1, T-4\.1\.2-1 were joined by the fixed rules and must stay in one defect/,
  );
  // Findings that share no page.
  assert.match(problems(() => undefined, [["T-4.1.2-2", "T-2.1.1-1"]]), /T-2\.1\.1-1 and T-4\.1\.2-2 share no page; findings at different places are different defects/);
  // Findings on the same page at demonstrably different places.
  assert.match(problems(() => undefined, [["T-3.3.2-1", "T-2.1.1-1"]]), /point at different places/);
  // A main criterion none of the findings has, and a merge without a reason.
  assert.match(problems((proposal) => void (proposal.defects[0]!.mainCriterion = "1.2.1")), /mainCriterion "1\.2\.1" is not the criterion of any of its findings/);
  assert.match(problems((proposal) => void delete proposal.defects.at(-1)!.reasonNl, [["T-1.1.1-1", "T-2.4.4-1"]]), /reasonNl must say why these findings are the same defect at the same place/);
  assert.match(
    problems((proposal) => {
      const search = proposal.defects.find((defect) => defect.findings.includes("T-3.3.2-1"))!;
      search.mainCriterion = "4.1.2";
    }),
    /reasonNl must say why this criterion names the cause/,
  );
});

test("the merge step runs without the proposal, applies a validated one, and drops it when the findings change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "merge-"));
  const path = join(dir, "evaluation.json");
  const evaluation = proposalCase();
  writeFileSync(path, canonicalJson(evaluation));

  const first = await merge(dir);
  assert.deepEqual({ findings: first.findings, criteria: first.criteria, byRules: first.byRules, defects: first.defects, proposal: first.proposal }, { findings: 6, criteria: 5, byRules: 5, defects: 5, proposal: "not-run" });
  const written = await readJson<Evaluation>(path);
  assert.deepEqual(written.merge, { rulesVersion: 3, proposal: { status: "not-run" } });
  assert.equal(canonicalJson(written.criteria), canonicalJson(JSON.parse(canonicalJson(evaluation)).criteria), "the findings are untouched");
  const task = await readJson<{ defects: unknown[] }>(join(dir, "tasks", "samenvoeg", "invoer.json"));
  assert.equal(task.defects.length, 5);

  // A proposal that breaks the rules is not stamped and therefore not applied.
  writeFileSync(join(dir, "verdicts", "samenvoeg.json"), JSON.stringify(proposalFor(evaluation, [["T-4.1.2-2", "T-2.1.1-1"]])));
  assert.equal((await checkMerge(dir)).length, 1);
  assert.equal((await merge(dir)).proposal, "not-run");

  writeFileSync(join(dir, "verdicts", "samenvoeg.json"), JSON.stringify(proposalFor(evaluation, [["T-1.1.1-1", "T-2.4.4-1"]])));
  assert.deepEqual(await checkMerge(dir), []);
  const second = await merge(dir);
  assert.deepEqual({ byRules: second.byRules, defects: second.defects, proposal: second.proposal }, { byRules: 5, defects: 4, proposal: "applied" });
  const applied = await readJson<Evaluation>(path);
  assert.equal(applied.merge!.proposal.status, "applied");
  // The defects that were not touched keep their identifier.
  const before = new Map(written.defects!.map((defect) => [defect.findingIds.join(), defect.id]));
  for (const defect of applied.defects!) if (before.has(defect.findingIds.join())) assert.equal(defect.id, before.get(defect.findingIds.join()));

  // Defects are part of what is signed.
  assert.notEqual(evaluationHash(applied), evaluationHash(written));
  await seal(dir);
  await sign({ run: dir, name: "Een ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", checkedNl: null, terminal: typesSeal() });
  assert.ok(signatureIsCurrent(await readEvaluation(path)));
  await assert.rejects(merge(dir), /the evaluation is signed/);

  // Other findings: the proposal was made for something else and no longer counts. The signature is for the earlier evaluation and stops nothing.
  const changed = proposalCase();
  changed.criteria.find((criterion) => criterion.id === "2.1.1")!.findings[0]!.locations[0]!.where = "#contact > form > textarea";
  writeFileSync(path, canonicalJson(changed));
  assert.equal((await merge(dir)).proposal, "not-run");
});

test("the check on a proposal and the fixed rules use one definition of the same place", () => {
  const evaluation = evaluationWith({
    // One finding names the three controls of the menu; the others are about one or two of them.
    "4.1.2": [{ titleNl: "Uitklapmenu's en menuknop zijn geen knoppen", component: "Hoofdnavigatie", where: ["#menu > li:nth-of-type(1), li:nth-of-type(2) en li:nth-of-type(5)", "smal scherm: div.hamburger-menu (2 stuks) en div.mobile-dropdown-item (3 stuks)"], pagesAffected: "alle 8" }],
    "2.1.1": [
      { titleNl: "Uitklapmenu's openen niet met het toetsenbord", where: ["#menu > li:nth-of-type(1)", "#menu > li:nth-of-type(2)", "#menu > li:nth-of-type(5)"], pagesAffected: "alle 8" },
      { titleNl: "Menuknop werkt niet met het toetsenbord", where: "#page > header > div:nth-of-type(2) (div.hamburger-menu)", pagesAffected: "alle 8" },
      { titleNl: "Menugroepen in het mobiele menu klappen niet uit", where: ["#page > div:nth-of-type(4) > div:nth-of-type(1) (AAN DE SLAG)", "#page > div:nth-of-type(4) > div:nth-of-type(2) (OVER)"], pagesAffected: "alle 8" },
    ],
    "1.3.1": [{ titleNl: "De hele pagina is als hoofdinhoud gemarkeerd", where: "het element main direct onder body", pagesAffected: "alle 8" }],
    "1.4.3": [{ titleNl: "Grijze tekst onderaan is te licht", where: "#page > footer > span", pagesAffected: "alle 8" }],
    "2.4.7": [{ titleNl: "Focus staat op links buiten beeld", where: ["#menu > li:nth-of-type(1)", "#top > a", "#side > a:nth-of-type(1)", "#side > a:nth-of-type(2)", "#side > a:nth-of-type(3)"], pagesAffected: "alle 8" }],
  });
  const byRules = mergeFindings(evaluation);
  // The rules join what is written in the same selectors; the two narrow findings are about different controls.
  assert.deepEqual(groups(evaluation), [["T-1.3.1-1"], ["T-1.4.3-1"], ["T-2.1.1-1", "T-2.1.1-2", "T-4.1.2-1"], ["T-2.1.1-3"], ["T-2.4.7-1"]]);
  const check = (join: string[]): string => validateProposal(proposalFor(evaluation, [join]), evaluation, byRules).join("\n");
  // What the rules joined is never refused, and the broad finding also holds the one written as a chain where it has a class.
  assert.equal(check(["T-4.1.2-1", "T-2.1.1-3"]), "");
  // Without the broad finding the narrow ones are about different controls. One message, against the finding that comes closest to holding the defect.
  const narrow = evaluationWith({ "2.1.1": [{ where: ["#menu > li:nth-of-type(1)", "#menu > li:nth-of-type(2)"] }, { where: "#page > div:nth-of-type(4) > div:nth-of-type(1)" }, { where: "#page > header > div:nth-of-type(2)" }] });
  const refused = validateProposal({ defects: [{ findings: ["T-2.1.1-1", "T-2.1.1-2", "T-2.1.1-3"], mainCriterion: "2.1.1", reasonNl: "Alle drie gaan over het menu van de site." }] }, narrow, mergeFindings(narrow));
  assert.equal(refused.length, 1);
  assert.match(refused[0]!, /^defects\[0\]: no finding holds this defect together; closest is T-2\.1\.1-1: T-2\.1\.1-1 and T-2\.1\.1-2 point at different places; T-2\.1\.1-1 and T-2\.1\.1-3 point at different places/);
  // A finding about the whole page does not take in whatever else is on that page.
  assert.match(check(["T-1.3.1-1", "T-1.4.3-1"]), /are not shown to be at the same place: they name it in no common word/);
  assert.match(check(["T-1.3.1-1", "T-4.1.2-1"]), /are not shown to be at the same place/);
  // Touching the holder in one element out of five is not being at its place.
  assert.match(check(["T-4.1.2-1", "T-2.4.7-1"]), /are mostly at different places/);
});
