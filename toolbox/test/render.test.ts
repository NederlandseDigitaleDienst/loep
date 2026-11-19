import assert from "node:assert/strict";
import { groupsFor } from "../src/lib/groups.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { browserUse, gateLineNl, implementationUse, readVersionAccuracy, repeatedInBrowsersNl, screenReaderUse, secondBrowserUse, voiceOverSessions } from "../src/commands/evaluate.ts";
import { render } from "../src/commands/render.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { aiGeneratedMark, closeCutQuote, evaluationHash, idsAcrossVersionsNl, madeWith, markVendor, quoteStart, summarise, vendorTagsOf, VERSION_NOT_MEASURED_NL, type Evaluation, type ReportFinding } from "../src/lib/evaluation.ts";
import { reportedModels } from "../src/lib/models.ts";
import { deriveReport, renderMarkdown } from "../src/lib/report-markdown.ts";
import { renderHtml } from "../src/lib/report-html.ts";
import { makePdf, TEMPLATES, tool, unshownCheck, unshownPattern, unshownTexts, unshownWarning } from "../src/lib/typst.ts";
import { SEVERITIES } from "../src/lib/verdict.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { weighed } from "./fixtures/weighed.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const signed = (evaluation: Evaluation): Evaluation => ({
  ...evaluation,
  signature: {
    name: "Een ondertekenaar",
    role: "Directeur",
    organisation: "Gemeente Voorbeeld",
    signedAt: "2026-10-12T09:00:00.000Z",
    statementNl: "Ik heb kennisgenomen van dit rapport.",
    evaluationSha256: evaluationHash(evaluation),
    sealSha256: "5ea1".repeat(16),
  },
});

test("the same evaluation gives the same Markdown, byte for byte", () => {
  assert.equal(renderMarkdown(exampleEvaluation()), renderMarkdown(exampleEvaluation()));
  // A round trip through JSON, as render does when it reads evaluation.json, changes nothing.
  const reread = JSON.parse(JSON.stringify(exampleEvaluation())) as Evaluation;
  assert.equal(renderMarkdown(reread), renderMarkdown(exampleEvaluation()));
});

const SCOPE_FRAMES: NonNullable<Evaluation["scope"]["frames"]> = [
  { address: "https://video.example/embed/abc", descriptionNl: "Videospeler met de raadsvergadering", kindNl: "eigen inhoud in een eigen of gekozen speler", standingNl: "Telt mee in het onderzoek", counts: true, reasonNl: "Eigen video van de gemeente in een speler die ze heeft gekozen.", decidedBy: null },
  { address: "https://kaart.example/embed", descriptionNl: "Kaart met het bezoekadres", kindNl: "kaart waarvan het wezenlijke ook als tekst op de pagina staat", standingNl: "Uitgezonderd: benoemd en buiten het oordeel gehouden", counts: false, reasonNl: "Het adres staat onder de kaart als tekst", decidedBy: "toegankelijkheidscoördinator" },
];

test("the scope names every embedded frame: what it is, whether it counts, why, and who decided", () => {
  const evaluation = exampleEvaluation();
  assert.ok(!renderMarkdown(evaluation).includes("Ingesloten vensters"), "an evaluation without frames says nothing about them");
  evaluation.scope.frames = SCOPE_FRAMES;
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("Ingesloten vensters, per venster wat het is en of het meetelt:"));
  assert.ok(markdown.includes("- Videospeler met de raadsvergadering (https://video.example/embed/abc): eigen inhoud in een eigen of gekozen speler. Telt mee in het onderzoek. Reden: Eigen video van de gemeente in een speler die ze heeft gekozen."));
  assert.ok(markdown.includes("- Kaart met het bezoekadres (https://kaart.example/embed): kaart waarvan het wezenlijke ook als tekst op de pagina staat. Uitgezonderd: benoemd en buiten het oordeel gehouden. Reden: Het adres staat onder de kaart als tekst. Bepaald door: toegankelijkheidscoördinator."));
  assert.equal(deriveReport(evaluation).scopeFramesNl.length, 2, "the PDF prints the same sentences");
});

test("all 55 criteria of WCAG 2.2 are present, plus 4.1.1 for the WCAG 2.1 view", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  const sections = [...markdown.matchAll(/^<a id="sc-([\d.]+)"><\/a>$/gm)].map((match) => match[1]!);
  const rows = [...markdown.matchAll(/^\| <a id="sc-([\d.]+)"><\/a>/gm)].map((match) => match[1]!);
  const { quiet } = deriveReport(evaluation);
  const in22 = evaluation.criteria.filter((criterion) => criterion.versions.includes("2.2"));
  const in21 = evaluation.criteria.filter((criterion) => criterion.versions.includes("2.1"));
  assert.equal(in22.length, 55);
  assert.equal(in21.length, 50);
  // A criterion has a block of its own, or a row in the table of criteria with nothing to act on; never both.
  assert.deepEqual(sections, evaluation.criteria.map((criterion) => criterion.id).filter((id) => !quiet.includes(id)));
  assert.deepEqual(rows, quiet);
  assert.equal(sections.length + rows.length, 56);
  assert.ok(quiet.includes("4.1.1"));
  // Such a criterion has its level, clause and version in the appendix.
  assert.match(markdown, /^### 4\.1\.1 .+\n\n\*\*Uitkomst:\*\* .*Niveau A · EN 301 549: .*Alleen in WCAG 2\.1/m);
  for (const criterion of evaluation.criteria) {
    // Once in the overview table, linking to its section.
    assert.ok(markdown.includes(`](#sc-${criterion.id}) |`), `criterion ${criterion.id} is missing from the overview`);
  }
});

test("the score tables count each outcome on its own", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("| **Totaal** | **31** | **5** | **15** | **4** | **0** | **55** |"));
  assert.ok(markdown.includes("| **Totaal** | **29** | **5** | **12** | **4** | **0** | **50** |"));
});

test("every finding id appears exactly once as an anchor", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  const ids = evaluation.criteria.flatMap((criterion) => criterion.findings.map((finding) => finding.id));
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.equal(markdown.split(`<a id="${id}"></a>`).length - 1, 1, `anchor for ${id}`);
    assert.ok(markdown.includes(`](#${id})`), `no link to ${id}`);
  }
  const anchors = [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]!);
  assert.equal(new Set(anchors).size, anchors.length);
});

test("an unsigned evaluation is labelled as concept, a signed one names the function of who signed and not the name", () => {
  const unsigned = renderMarkdown(exampleEvaluation());
  assert.match(unsigned, /^> \*\*Concept, niet afgetekend\*\*$/m);
  assert.ok(unsigned.includes("Afgetekend door: nog niet afgetekend"));
  assert.equal(deriveReport(exampleEvaluation()).status["2.2"].status, "geen");

  const withSignature = renderMarkdown(signed(exampleEvaluation()));
  assert.ok(!withSignature.includes("Concept, niet afgetekend"));
  assert.match(withSignature, /^> \*\*Afgetekend\*\* door Directeur \(Gemeente Voorbeeld\) op 12 oktober 2026\.$/m);
  assert.ok(withSignature.includes("Afgetekend door: Directeur, Gemeente Voorbeeld, op 12 oktober 2026"));
  // The name stays in signed/signature.json: the report that gets published does not carry it.
  assert.ok(!withSignature.includes("Een ondertekenaar"));
  // Four criteria could not be determined, so the strict status is C, never A or B.
  assert.ok(withSignature.includes("status C (eerste maatregelen genomen)"));
  assert.ok(!withSignature.includes("status A (voldoet volledig)"));
});

test("a signature for an earlier version turns the report back into a concept", () => {
  const stale = signed(exampleEvaluation());
  stale.signature!.evaluationSha256 = "0".repeat(64);
  const markdown = renderMarkdown(stale);
  assert.match(markdown, /^> \*\*Concept, niet afgetekend\*\* De handtekening hoort bij een eerdere versie van dit onderzoek\.$/m);
  assert.ok(!markdown.includes("Een ondertekenaar"));
  const derived = deriveReport(stale);
  assert.equal(derived.signed, false);
  assert.equal(derived.status["2.2"].status, "geen");
});

test("the main part is compact and the full reasoning is in appendix A", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  const [main, appendix] = markdown.split("## Bijlage A: onderbouwing per criterium");
  assert.ok(main && appendix);
  assert.ok(appendix.includes("## Bijlage B: herleidbaarheid"));
  for (const criterion of evaluation.criteria) {
    assert.equal(markdown.split(`<a id="bijlage-${criterion.id}"></a>`).length - 1, 1, `appendix entry for ${criterion.id}`);
    assert.ok(main.includes(`(#bijlage-${criterion.id})`), `no link to the appendix for ${criterion.id}`);
    assert.ok(appendix.includes(`[Terug naar het resultaat](#sc-${criterion.id})`), `no link back for ${criterion.id}`);
  }
  // How something was measured and what the verifier tried are reference material.
  assert.ok(!main.includes("- Hoe: "));
  assert.ok(!main.includes("Poging om het oordeel onderuit te halen: ") && appendix.includes("Poging om het oordeel onderuit te halen: "));
  assert.ok(appendix.includes("- Hoe: "));
  assert.ok(main.includes("Zekerheid: De eerste beoordeling en de controle komen op dezelfde uitkomst."));
  // Finding cards stay in the main part.
  assert.ok(main.includes("**Oplossing**") && !appendix.includes("**Oplossing**"));
});

test("a criterion with nothing to act on gets a row, and the lists per component and per page only point", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  const { quiet } = deriveReport(evaluation);
  const quietOutcomes = new Set(quiet.map((id) => evaluation.criteria.find((criterion) => criterion.id === id)!.outcome));
  assert.deepEqual([...quietOutcomes].sort(), ["inapplicable", "passed"]);
  for (const criterion of evaluation.criteria) {
    const open = criterion.missingNl.length > 0 || criterion.findings.length > 0;
    if (open) assert.ok(!quiet.includes(criterion.id), `${criterion.id} has something to read and keeps its block`);
  }
  const row = markdown.split("\n").find((line) => line.startsWith(`| <a id="sc-${quiet[0]}"></a>`))!;
  const first = evaluation.criteria.find((criterion) => criterion.id === quiet[0])!;
  assert.ok(row.includes(`](#bijlage-${first.id}) | ${first.level} | `) && row.includes(first.summaryNl.slice(0, 40)));
  // The row is all the main part says about it.
  assert.ok(!markdown.includes(`##### ${first.id} `));

  const finding = evaluation.criteria.flatMap((criterion) => criterion.findings).find((entry) => entry.component)!;
  const component = markdown.split("## Bevindingen per onderdeel")[1]!.split("\n## ")[0]!;
  assert.ok(component.includes(`[${finding.id}](#${finding.id})`) && !component.includes(finding.titleNl));
  const perPage = markdown.split("## Bevindingen per pagina")[1]!.split("\n## ")[0]!;
  assert.ok(perPage.includes(`](#${finding.id})`) && !perPage.includes("http"));
});

test("the work list names every finding to fix and every open criterion", () => {
  const evaluation = exampleEvaluation();
  const { todo } = deriveReport(evaluation);
  const ids = evaluation.criteria.flatMap((criterion) => criterion.findings.map((finding) => finding.id));
  assert.deepEqual(todo.fix.flatMap((group) => group.findingIds).sort(), [...ids].sort());
  assert.deepEqual(todo.fix.map((group) => group.owner), ["techniek", "content", "design"]);
  // The open points of the example have no kind, as in an evaluation from before the kinds existed.
  assert.deepEqual(todo.investigate.unsorted.map((item) => item.criterion), ["1.4.11", "1.4.13", "2.1.1", "3.3.3"]);
  assert.deepEqual([todo.investigate.owner, todo.investigate.toolbox], [[], []]);
  const section = renderMarkdown(evaluation).split("## Wat nu")[1]!.split("\n## ")[0]!;
  assert.ok(section.includes("### Oplossen") && section.includes("### Nog uitzoeken"));
  for (const id of ids) assert.ok(section.includes(`](#${id})`), `${id} is missing from the work list`);
});

test("the status is explained once when both WCAG versions share it", () => {
  const same = deriveReport(signed(exampleEvaluation()));
  assert.equal(same.meaningNl.length, 1);
  assert.ok(same.meaningNl[0]!.includes("Bij 4 criteria"));

  // One more open criterion that only exists in WCAG 2.2: same sentence, both counts.
  const evaluation = exampleEvaluation();
  evaluation.criteria.find((criterion) => criterion.id === "2.5.8")!.outcome = "cantTell";
  evaluation.summary["2.2"].passed--;
  evaluation.summary["2.2"].cantTell++;
  const differing = deriveReport(signed(evaluation));
  assert.equal(differing.meaningNl.length, 1);
  assert.ok(differing.meaningNl[0]!.includes("Bij 4 (WCAG 2.1) of 5 (WCAG 2.2) criteria"));
});

test("an open point is never shortened and never left out", () => {
  const evaluation = exampleEvaluation();
  const criterion = evaluation.criteria.find((entry) => entry.outcome === "cantTell")!;
  const long = `${"Een meting van dit gedrag na interactie. ".repeat(12)}Einde van de tekst.`;
  criterion.missingNl = [long, "Twee.", "Drie.", "Vier."];
  const [main, appendix] = renderMarkdown(evaluation).split("## Bijlage A: onderbouwing per criterium");
  const worklist = main!.split("### Nog uitzoeken")[1]!.split("\n## ")[0]!;
  assert.ok(worklist.includes("Einde van de tekst.") && worklist.includes("  - Vier."));
  // It stands once, in the work list; the criterion and the appendix point there.
  const elsewhere = [main!.split("### Nog uitzoeken")[1]!.split("\n## ").slice(1).join(""), appendix!];
  for (const part of elsewhere) {
    assert.ok(!part.includes("Einde van de tekst.") && !part.includes("Vier."));
    assert.ok(part.includes(`Open: 4 punten, zie [Nog uitzoeken](#open-${criterion.id}).`));
  }
  assert.ok(worklist.includes(`- <a id="open-${criterion.id}"></a>[${criterion.id} `));
  // A point next to a verdict that did come is in the work list too, with the outcome behind the criterion.
  const passed = evaluation.criteria.find((entry) => entry.outcome === "passed")!;
  passed.missingNl = ["De tekst Work in Progress op P03 is niet nagekeken."];
  const again = renderMarkdown(evaluation).split("### Nog uitzoeken")[1]!.split("\n## ")[0]!;
  assert.ok(again.includes(`](#sc-${passed.id}) (voldoet)\n  - De tekst Work in Progress op P03 is niet nagekeken.`));
  // The criteria without a verdict come first.
  assert.equal(deriveReport(evaluation).todo.investigate.unsorted.at(-1)!.criterion, passed.id);
});

test("open points are split into work for the owner of the site and limits of the evaluation", () => {
  const evaluation = exampleEvaluation();
  const [first, second] = evaluation.criteria.filter((entry) => entry.outcome === "cantTell");
  const passed = evaluation.criteria.find((entry) => entry.outcome === "passed")!;
  first!.missingNl = ["mens nodig: wat een schermlezer voorleest na het versturen van het formulier op P03.", "keuze nodig: is het label op P02 een logo?", "veegronde mist: het contrast op 320 pixels breed is op geen pagina gemeten.", "budget op: het menu op P04 is niet geopend."];
  second!.missingNl = ["veegronde mist: de toetsenproef in de geopende vensters.", "veegronde mist: de toetsenproef op het smalle scherm."];
  passed.missingNl = ["proef werkte niet: de kaart op P02 laadde niet."];
  const { todo, briefs } = deriveReport(evaluation);
  assert.deepEqual(todo.investigate.owner, [{ criterion: first!.id, outcomeNl: "kan niet bepalen", pointsNl: ["Wat een schermlezer voorleest na het versturen van het formulier op P03.", "Keuze: Is het label op P02 een logo?"], anchor: true }]);
  assert.deepEqual(todo.investigate.toolbox.map((item) => [item.criterion, item.countNl, item.kindsNl, item.anchor]), [
    [first!.id, "2 punten", "1 keer dekking ontbrak, 1 keer de tijd voor het meten was op", false],
    [second!.id, "2 punten", "2 keer dekking ontbrak", true],
    [passed.id, "1 punt", "1 keer een proef werkte niet", true],
  ]);
  assert.equal(briefs[first!.id]!.openNl, "4 punten");

  const [main, appendix] = renderMarkdown(evaluation).split("## Bijlage A: onderbouwing per criterium");
  const worklist = main!.split("### Nog uitzoeken")[1]!.split("\n## ")[0]!;
  // The owner's part comes first and in full; the words of the toolbox are not in it.
  assert.ok(worklist.indexOf("**Dit moet een mens nagaan**") < worklist.indexOf("**Dit meet de toolbox een volgende keer**"));
  const ownerPart = worklist.split("**Dit meet de toolbox een volgende keer**")[0]!;
  assert.ok(ownerPart.includes("  - Wat een schermlezer voorleest na het versturen van het formulier op P03.") && ownerPart.includes("  - Keuze: Is het label op P02 een logo?"));
  assert.ok(!/veegronde|mens nodig|budget/i.test(ownerPart));
  // The other part is one line per criterion, with the count and where the points are.
  assert.ok(worklist.includes(`](#sc-${second!.id}) (kan niet bepalen): 2 punten (2 keer dekking ontbrak), zie [bijlage A](#bijlage-${second!.id})`));
  assert.ok(!main!.includes("de toetsenproef in de geopende vensters"));
  // Every point stands in full somewhere: those about the evaluation in the appendix.
  assert.ok(appendix!.includes("Open, voor een volgende meting:\n\n- Dekking ontbrak: De toetsenproef in de geopende vensters.\n- Dekking ontbrak: De toetsenproef op het smalle scherm."));
  assert.ok(appendix!.includes("- Een proef werkte niet: De kaart op P02 laadde niet."));
  assert.ok(appendix!.includes("- De tijd voor het meten was op: Het menu op P04 is niet geopend."));
  // Every anchor exists once, so no link to open points is dead.
  for (const id of [first!.id, second!.id, passed.id]) assert.equal(main!.split(`<a id="open-${id}"></a>`).length - 1, 1);

  // A limit of a failed criterion is no open point: it stands with the criterion in the appendix, not in the work list (#318).
  const failed = evaluation.criteria.find((entry) => entry.outcome === "failed")!;
  failed.limitsNl = ["proef werkte niet: de lijnen in het diagram op P05 gaven geen verhouding."];
  const withLimit = deriveReport(evaluation);
  assert.equal(withLimit.briefs[failed.id]!.limitsCountNl, "1 beperking");
  assert.ok(!withLimit.todo.investigate.toolbox.some((item) => item.criterion === failed.id));
  assert.ok(renderMarkdown(evaluation).includes("Beperking van dit onderzoek, de uitkomst hangt er niet van af:\n\n- Een proef werkte niet: De lijnen in het diagram op P05 gaven geen verhouding."));
});

test("a criterion open by content of an address outside the scope is the owner's, counted apart in the summary, and not unfinished work of the evaluation", () => {
  const evaluation = exampleEvaluation();
  const open = evaluation.criteria.filter((entry) => entry.outcome === "cantTell" || entry.outcome === "untested");
  for (const criterion of open.slice(1)) {
    criterion.outcome = "passed";
    criterion.missingNl = [];
  }
  open[0]!.outcome = "cantTell";
  open[0]!.missingNl = ["buiten de afbakening: het blok met openingstijden op P02 haalt zijn inhoud van https://data.voorbeeld.nl en bleef leeg."];
  const { todo, statusLine } = deriveReport(evaluation);
  assert.equal(statusLine.unfinished, false);
  assert.ok(statusLine.openNl.includes(`Van de criteria voor de eigenaar bleef er 1 open door inhoud van een adres buiten de afbakening (${open[0]!.id}); een nieuw onderzoek met dat adres erbij meet ze`), statusLine.openNl);
  assert.deepEqual(todo.investigate.owner.map((item) => item.pointsNl), [["Buiten de afbakening: Het blok met openingstijden op P02 haalt zijn inhoud van https://data.voorbeeld.nl en bleef leeg."]]);
});

/** An evaluation with a chat in an embedded frame that answers only after a message: one criterion waits for sending alone, one also for a person. */
function withNotSent(): { evaluation: Evaluation; only: string; mixed: string } {
  const evaluation = exampleEvaluation();
  const [first, second] = evaluation.criteria.filter((entry) => entry.outcome === "cantTell");
  first!.missingNl = ["versturen niet toegestaan: wat de chat in het venster van https://chat.voorbeeld.nl/widget op P02 antwoordt na een verstuurd bericht."];
  second!.missingNl = ["versturen niet toegestaan: of de chat op P02 een nieuw bericht laat voorlezen.", "mens nodig: wat NVDA voorleest bij het menu op P01."];
  // Every other criterion has an outcome: the evaluation itself is done.
  for (const criterion of evaluation.criteria) {
    if (criterion === first || criterion === second || (criterion.outcome !== "cantTell" && criterion.outcome !== "untested")) continue;
    criterion.outcome = "passed";
    criterion.missingNl = [];
  }
  return { evaluation, only: first!.id, mixed: second!.id };
}

test("what stays open only because the run may not send stands apart, with the declaration that would have closed it", () => {
  const { evaluation, only, mixed } = withNotSent();
  const { todo, statusLine } = deriveReport(evaluation);
  // The owner's part keeps what a person has to do; the points about sending are not in it.
  assert.deepEqual(todo.investigate.owner.map((item) => [item.criterion, item.pointsNl]), [[mixed, ["Wat NVDA voorleest bij het menu op P01."]]]);
  const notSent = todo.investigate.notSent!;
  assert.deepEqual(notSent.items.map((item) => [item.criterion, item.pointsNl.length]), [[only, 1], [mixed, 1]]);
  assert.deepEqual(notSent.onlyCriteria, [only]);
  // The one origin the points name goes into the flags; the frame alone may be declared.
  assert.equal(notSent.flags, '--test-environment https://chat.voorbeeld.nl --declared-by "<naam>, <functie>"');
  assert.match(notSent.originNl, /^In de open punten staat als adres https:\/\/chat\.voorbeeld\.nl\. Dat mag de origin van alleen een ingesloten venster zijn/);
  // The count at the top says which criteria wait for sending alone, and sends nobody to a person for them.
  assert.ok(statusLine.openNl.includes(`Van de criteria voor de eigenaar wacht er 1 alleen op toestemming om te versturen (${only}).`), statusLine.openNl);
  assert.ok(statusLine.openNl.endsWith("Bij de andere kan geen instrument verder: een persoon legt het antwoord vast, en daarna telt het mee in de uitkomst."), statusLine.openNl);

  const worklist = renderMarkdown(evaluation).split("### Nog uitzoeken")[1]!.split("\n## ")[0]!;
  assert.ok(worklist.indexOf("**Dit moet een mens nagaan**") < worklist.indexOf("**Pas te meten als het onderzoek mag versturen**"));
  assert.ok(worklist.includes('Een nieuw onderzoek meet deze punten als bij inventory een testomgeving wordt verklaard, door iemand met naam en functie: `--test-environment https://chat.voorbeeld.nl --declared-by "<naam>, <functie>"`'));
  const part = worklist.split("**Pas te meten als het onderzoek mag versturen**")[1]!;
  assert.ok(part.includes("  - Of de chat op P02 een nieuw bericht laat voorlezen."));
  assert.ok(!/mens nodig|versturen niet toegestaan:/.test(worklist));

  // Without an address in the points the flags keep the place to fill in; with two they say one can be declared.
  for (const criterion of evaluation.criteria) criterion.missingNl = criterion.missingNl.map((point) => point.replace(/ in het venster van https:\/\/\S+/, ""));
  assert.equal(deriveReport(evaluation).todo.investigate.notSent!.flags, '--test-environment <origin> --declared-by "<naam>, <functie>"');
  evaluation.criteria.find((entry) => entry.id === mixed)!.missingNl = ["versturen niet toegestaan: het formulier naar https://formulier.voorbeeld.nl/aanvraag."];
  evaluation.criteria.find((entry) => entry.id === only)!.missingNl = ["versturen niet toegestaan: de chat van https://chat.voorbeeld.nl."];
  const two = deriveReport(evaluation);
  assert.match(two.todo.investigate.notSent!.originNl, /^In de open punten staan 2 adressen: https:\/\/chat\.voorbeeld\.nl, https:\/\/formulier\.voorbeeld\.nl\. /);
  // When every open criterion of the owner waits for sending alone, no person is named at all.
  assert.ok(two.statusLine.openNl.endsWith("Daar is geen persoon voor nodig: een instrument meet het in een nieuw onderzoek dat mag versturen, zie \"Nog uitzoeken\"."), two.statusLine.openNl);
  // An evaluation without such points has no part for them.
  assert.equal(deriveReport(exampleEvaluation()).todo.investigate.notSent, null);
});

test("a run that might send and ran out of its budget waits for more sends, not for permission", () => {
  const { evaluation, only, mixed } = withNotSent();
  evaluation.chain = { ...evaluation.chain!, writes: { allowed: true, noteNl: "Versturen mocht naar https://chat.voorbeeld.nl." } };
  const spent = "versturen niet toegestaan: het budget voor versturen van deze run is op (5 van 5 verstuurd). Wat de chat van https://chat.voorbeeld.nl antwoordt, is niet bekeken.";
  evaluation.criteria.find((entry) => entry.id === only)!.missingNl = [spent];
  evaluation.criteria.find((entry) => entry.id === mixed)!.missingNl = [spent];
  const { todo, statusLine } = deriveReport(evaluation);
  assert.ok(statusLine.openNl.includes("alleen op meer verzendingen, want het budget voor versturen van dit onderzoek was op"), statusLine.openNl);
  assert.ok(!statusLine.openNl.includes("toestemming om te versturen"), statusLine.openNl);
  assert.ok(statusLine.openNl.endsWith("Een instrument meet het in een nieuw onderzoek met een groter budget, zie \"Nog uitzoeken\"."), statusLine.openNl);
  assert.equal(todo.investigate.notSent!.flags, '--test-environment https://chat.voorbeeld.nl --declared-by "<naam>, <functie>" --max-writes <aantal>');
  assert.match(todo.investigate.notSent!.declarationNl, /^Dit onderzoek mocht versturen, maar het budget voor versturen was op/);
});

/** The example evaluation with one recommendation under a criterion that passed. */
function withRecommendation() {
  const evaluation = exampleEvaluation();
  const host = evaluation.criteria.find((criterion) => criterion.outcome === "passed")!;
  host.recommendations = [{ id: `X-${host.id}-A1b2c`, criterion: host.id, rule: "A1", titleNl: "Datum na de titel van een kaart", observedNl: "Bij elk nieuwsbericht staat de datum in de code vóór de titel.", recommendationNl: "Zet de datum in de code na de titel, of neem haar op in de kop.", component: null, locations: [{ page: "P01", where: ".kaart time", heading: "Nieuws" }], evidence: ["images"] }];
  return { evaluation, host };
}

test("a recommendation stands apart, after what is wrong and open, and changes nothing in the outcome", () => {
  const { evaluation, host } = withRecommendation();
  const before = deriveReport(exampleEvaluation());
  const derived = deriveReport(evaluation);
  assert.deepEqual(derived.recommendations.map((item) => [item.id, item.criterion, item.rule, item.placesNl]), [[`X-${host.id}-A1b2c`, host.id, "A1", ["P01: onder de kop “Nieuws”"]]]);
  assert.deepEqual(derived.status, before.status, "the status does not change");
  assert.equal(derived.statusSentenceNl, before.statusSentenceNl);
  const markdown = renderMarkdown(evaluation);
  const work = markdown.split("## Wat nu")[1]!.split("\n## ")[0]!;
  assert.ok(work.indexOf("### Nog uitzoeken") < work.indexOf("### Aanbevelingen"), "after what is open");
  assert.ok(work.includes("is geen eis van WCAG en telt niet mee voor de uitkomst of de status"));
  assert.ok(work.includes(`aanbeveling A1 van de procedure`));
  assert.ok(work.includes("  - Aanbeveling: Zet de datum in de code na de titel, of neem haar op in de kop."));
  assert.ok(!renderMarkdown(exampleEvaluation()).includes("### Aanbevelingen"), "no part without a recommendation");
});

test("a report to account for says what is still missing for status B, per open criterion (#318)", async (context) => {
  const evaluation = exampleEvaluation();
  assert.equal(deriveReport(evaluation).forB, null, "a report to improve has no such part");
  evaluation.purpose = "verantwoorden";
  const open = evaluation.criteria.find((entry) => entry.outcome === "cantTell")!;
  open.missingNl = ["proef werkte niet: de lijnen in het diagram op P05 gaven geen verhouding.", "mens nodig: wat een schermlezer voorleest bij de kaart op P02."];
  for (const criterion of evaluation.criteria) criterion.basis = criterion.outcome === "cantTell" || criterion.outcome === "untested" ? "open" : "measured";
  const forB = deriveReport(evaluation).forB!;
  assert.match(forB.basisNl, / criteria gemeten met een instrument, 0 vastgesteld door een agent op eigen waarnemingen, 0 vastgesteld door een persoon, \d+ open\./);
  assert.deepEqual(forB.openNl.find((row) => row.criterion === open.id), { criterion: open.id, closesNl: "een proef van loep die werkt: een nieuwe afmaakronde (tasks --again) na een herstel in loep; een persoon die het vaststelt en het vastlegt met answer" });
  assert.ok(renderMarkdown(evaluation).includes("**Wat er nog ontbreekt voor status B**"));
  const dir = mkdtempSync(join(tmpdir(), "render-for-b-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  assert.match((await tool("pdftotext", [result.pdf, "-"])).stdout.replace(/\s+/g, " "), /Wat er nog ontbreekt voor status B Waarop de uitkomsten rusten:/);
});

test("the PDF shows a limit with its criterion and in the appendix (#318)", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-limit-"));
  const evaluation = exampleEvaluation();
  const failed = evaluation.criteria.find((entry) => entry.outcome === "failed")!;
  failed.limitsNl = ["proef werkte niet: de lijnen in het diagram op P05 gaven geen verhouding."];
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = (await tool("pdftotext", [result.pdf, "-"])).stdout.replace(/\s+/g, " ");
  assert.match(text, /1 beperking van dit onderzoek, de uitkomst hangt er niet van af; zie bijlage A/);
  assert.match(text, /Beperking van dit onderzoek, de uitkomst hangt er niet van af: Een proef werkte niet: De lijnen in het diagram op P05 gaven geen verhouding\./);
});

test("the PDF shows the recommendations in their own part", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-recommendation-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(withRecommendation().evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  assert.deepEqual(result.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Aanbevelingen"));
  assert.ok(flat.includes("Datum na de titel van een kaart"));
  assert.ok(flat.includes("aanbeveling A1 van de procedure"));
});

/** A copy made with `variant`: the sweep was measured with older code than the agent phases. */
function withSweepFromOlderCode(browser: Evaluation["toolchain"]["browser"] | null) {
  const evaluation = exampleEvaluation();
  const current = evaluation.toolchain.toolbox;
  evaluation.sweepToolchain = { run: "bron-d", toolbox: { ...current, version: "0.10.0+unreleased", commit: "886b74a15776cc0652c6172d9329a1f80fe7dcb8", dirty: false }, browser };
  return evaluation;
}

test("a variant copy names the code of the sweep next to that of the agent phases, in the Markdown", () => {
  const plain = renderMarkdown(exampleEvaluation());
  assert.ok(!plain.includes("veegronde is gemaakt met"), "a run that is no copy says nothing about a sweep");
  assert.ok(!plain.includes("Toolbox van de veegronde"));

  const evaluation = withSweepFromOlderCode({ name: "chromium", version: "152.0.1" });
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes(`Gemaakt met ${madeWith(evaluation, true)} voor de fasen van de agents; de veegronde is gemaakt met loep 0.10.0+unreleased, commit 886b74a15776`));
  assert.ok(markdown.includes("Toolbox van de veegronde: loep 0.10.0+unreleased, commit 886b74a15776, browser chromium 152.0.1; de pakketten hieronder zijn die van de fasen van de agents"));
  assert.ok(markdown.includes(`Toolbox: loep, versie ${evaluation.toolchain.toolbox.version}`), "the line of the agent phases stays");
  assert.ok(renderMarkdown(withSweepFromOlderCode(null)).includes("browser onbekend (niet vastgelegd in variant.json)"));
});

test("the PDF of a variant copy names the code of the sweep; one that is no copy does not", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-sweep-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(withSweepFromOlderCode({ name: "chromium", version: "152.0.1" })));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("de veegronde is gemaakt met loep 0.10.0+unreleased"));
  assert.ok(flat.includes("Toolbox van de veegronde"));
  assert.ok(flat.includes("browser chromium 152.0.1"));

  const plainDir = mkdtempSync(join(tmpdir(), "render-nosweep-"));
  writeFileSync(join(plainDir, "evaluation.json"), canonicalJson(exampleEvaluation()));
  const plain = await render(plainDir);
  const plainText = await tool("pdftotext", [plain.pdf!, "-"]);
  assert.ok(!plainText.stdout.includes("Toolbox van de veegronde"));
});

/** A failed criterion whose places say what they came to: a defect, one in order, one open and one passed on. The rest stays as before rulings existed. */
function withRulings() {
  const evaluation = exampleEvaluation();
  const host = evaluation.criteria.find((criterion) => criterion.outcome === "failed" && criterion.findings.length > 0)!;
  const finding = host.findings[0]!;
  finding.key = "F1";
  const place = { checkedNl: "Het vinkje onder een eigen bericht", howNl: "Bekeken op de pagina", observedNl: "Het vinkje heeft geen tekstalternatief.", evidence: ["images"] };
  host.observations = [
    { ...place, ruling: "finding", finding: "F1" },
    { ...place, checkedNl: "Een foto met een spandoek", ruling: "noIssue" },
    { ...place, checkedNl: "Een vlak onder de voet", ruling: "open" },
    { ...place, checkedNl: "De rand van een veld", ruling: "otherCriterion" },
  ];
  return { evaluation, host, finding };
}

test("appendix A says per examined place what it came to, with the finding of a defect; an old place says nothing", () => {
  const { evaluation, host, finding } = withRulings();
  const markdown = renderMarkdown(evaluation);
  const entry = markdown.slice(markdown.indexOf(`<a id="bijlage-${host.id}"></a>`)).split("**Hoe zeker is dit oordeel**")[0]!;
  assert.ok(entry.includes(`1. Uitkomst: gebrek, zie bevinding [${finding.id}](#${finding.id})\n   - Onderzocht: Het vinkje onder een eigen bericht`), entry);
  assert.ok(entry.includes("2. Uitkomst: in orde\n   - Onderzocht: Een foto met een spandoek"));
  assert.ok(entry.includes("3. Uitkomst: open, nog niet vastgesteld\n   - Onderzocht: Een vlak onder de voet"));
  assert.ok(entry.includes("4. Uitkomst: doorgegeven aan een ander criterium\n   - Onderzocht: De rand van een veld"));
  // A place from before observations had a ruling keeps the old form, without an outcome.
  const old = renderMarkdown(exampleEvaluation());
  const other = exampleEvaluation().criteria.find((criterion) => criterion.observations.length > 0)!;
  const oldEntry = old.slice(old.indexOf(`<a id="bijlage-${other.id}"></a>`)).split("**Hoe zeker is dit oordeel**")[0]!;
  assert.ok(oldEntry.includes("1. Onderzocht: "));
  assert.ok(!old.includes("1. Uitkomst: "), "no outcome for a place without a ruling");
});

test("the PDF says per examined place what it came to, and still renders a verdict from before rulings", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-rulings-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(withRulings().evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  assert.deepEqual(result.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  const { finding } = withRulings();
  assert.ok(flat.includes(`1. Uitkomst: gebrek, zie bevinding ${finding.id}`), "the defect points at its finding");
  assert.ok(flat.includes("2. Uitkomst: in orde"));
  assert.ok(flat.includes("3. Uitkomst: open, nog niet vastgesteld"));
  assert.ok(flat.includes("4. Uitkomst: doorgegeven aan een ander criterium"));
  const oldDir = mkdtempSync(join(tmpdir(), "render-rulings-old-"));
  writeFileSync(join(oldDir, "evaluation.json"), canonicalJson(exampleEvaluation()));
  const old = await render(oldDir);
  assert.ok(old.pdf !== null);
  const oldText = (await tool("pdftotext", [old.pdf, "-"])).stdout;
  assert.ok(!oldText.includes("Uitkomst: gebrek") && !oldText.includes("Uitkomst: in orde"));
});

const PAGE_TYPES = [
  { id: "artikel", descriptionNl: "Artikel in de kennisbank", pages: 197, examined: 6, reasonNl: "de voorbeeldpagina van de verkenner, 4 gekozen op variatie in inhoud en 1 willekeurig gekozen" },
  { id: "contact", descriptionNl: "", pages: 1, examined: 1, reasonNl: "de voorbeeldpagina van de verkenner" },
];

test("the report says per page type how many pages it has, how many were examined and why those", async (context) => {
  assert.ok(!renderMarkdown(exampleEvaluation()).includes("### Paginatypen"), "a sample without page types says nothing about them");
  const evaluation = exampleEvaluation();
  evaluation.sample.pageTypes = PAGE_TYPES;
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("### Paginatypen"));
  assert.ok(markdown.includes("- **artikel** (Artikel in de kennisbank): 197 pagina's, 6 bekeken: de voorbeeldpagina van de verkenner, 4 gekozen op variatie in inhoud en 1 willekeurig gekozen."));
  assert.ok(markdown.includes("- **contact**: 1 pagina, 1 bekeken: de voorbeeldpagina van de verkenner."));
  const dir = mkdtempSync(join(tmpdir(), "render-pagetypes-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Paginatypen"));
  assert.ok(flat.includes("Artikel in de kennisbank"));
  assert.ok(flat.includes("4 gekozen op variatie in inhoud"));
});

test("the PDF names the read requests that were let through among the facts of the evaluation", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-reads-"));
  const evaluation = exampleEvaluation();
  evaluation.chain!.reads = [{ method: "POST", origin: "https://zoek.example.nl", path: "/multi_search", service: "typesense", reasonNl: "Het zoekveld stuurt de zoekvraag naar de zoekdienst." }];
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Leesverzoeken"));
  assert.ok(flat.includes("zoekvraag aan Typesense"), flat.slice(flat.indexOf("Leesverzoeken"), flat.indexOf("Leesverzoeken") + 400));
});

test("a site on two origins names the second under the address, in the Markdown and in the PDF; a site on one says nothing more", async (context) => {
  const one = exampleEvaluation();
  assert.ok(!renderMarkdown(one).includes("Ook onderdeel van de site"));
  const two = exampleEvaluation();
  const main = new URL(two.site.baseUrl).origin;
  two.site.origins = [main, "https://docs.example.nl"];
  assert.match(renderMarkdown(two), /\n- URL: <[^>]+>\n- Ook onderdeel van de site: <https:\/\/docs\.example\.nl>\n/);
  const dir = mkdtempSync(join(tmpdir(), "render-origins-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(two));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Ook onderdeel van de site"), "the facts of the evaluation name the second origin");
  assert.ok(flat.includes("https://docs.example.nl"));
});

test("Typst's report of text it cannot show becomes the texts and a pattern that matches them", () => {
  const output = 'error: PDF/UA-1 error: the text `"中"` could not be displayed with font `"Atkinson Hyperlegible Next"`\n'
    + 'error: PDF/UA-1 error: the text `"a\\u{301}\\"\\\\"` could not be displayed with font `"Atkinson Hyperlegible Next"`\n'
    + 'error: PDF/UA-1 error: the text `"中"` could not be displayed with font `"Atkinson Hyperlegible Next"`\n';
  assert.deepEqual(unshownTexts(output), ["中", 'a\u0301"\\']);
  assert.deepEqual(unshownTexts("error: file not found"), []);
  assert.equal(unshownPattern(["中", 'a\u0301"\\']), "(?:\\x{61}\\x{301}\\x{22}\\x{5c}|\\x{4e2d})+");
  assert.match(unshownCheck(["中", "𝒜b"]), /als codepunten.*"中" \[U\+4E2D\], "𝒜b" \[U\+1D49C U\+0062\]/);
});

test("a quote from the site with emoji or a script no bundled font has still gives a PDF/UA-1 report", async (context) => {
  const evaluation = exampleEvaluation();
  const finding = evaluation.criteria.flatMap((criterion) => criterion.findings)[0]!;
  finding.locations = [
    { page: finding.locations[0]!.page, where: finding.locations[0]!.where, heading: "Tips 💡", text: "een vinkje ✅ en een raket 🚀" },
    { page: finding.locations[0]!.page, where: finding.locations[0]!.where, text: "简体中文" },
  ];
  const dir = mkdtempSync(join(tmpdir(), "render-emoji-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  // Through the command, for its exit code: text of the site must not stop the report.
  const run = await tool(process.execPath, [CLI, "render", "--run", dir]);
  if (run.output.includes("Typst is niet geïnstalleerd")) return context.skip("Typst is not installed");
  const pdf = join(dir, "report", "rapport.pdf");
  assert.ok(existsSync(pdf) && existsSync(join(dir, "report", "rapport-kort.pdf")), run.output);
  const missingAllowed = (problem: string): boolean => problem.includes("is niet geïnstalleerd") && !(process.env.CI === "true" && problem.includes("veraPDF"));
  const checks = run.stdout.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  assert.deepEqual(checks.filter((problem) => !missingAllowed(problem)), [], run.output);
  // The code points are named once, as a warning, so they are seen before signing.
  assert.equal(run.stdout.split("\n").filter((line) => line.startsWith("LET OP: ")).join("\n"), `LET OP: ${unshownWarning(["简", "体", "中", "文"])}`);
  assert.match(unshownWarning(["简", "体", "中", "文"]), /^4 tekens zonder glyph zijn als codepunt weergegeven: "简" \[U\+7B80\]/);
  if (checks.length === 0) assert.ok(run.ok, "render ends with exit code 0");
  const text = await tool("pdftotext", [pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("onder de kop “Tips 💡”, bij “een vinkje ✅ en een raket 🚀”"), "emoji are set in the bundled emoji font");
  assert.ok(flat.includes("bij “[U+7B80 U+4F53 U+4E2D U+6587]”"), "a character no bundled font has is set as its code point");
  assert.ok(renderMarkdown(evaluation).includes("简体中文"), "the Markdown keeps the text as it is");
});

test("a character without a glyph in a template stays a problem, the same character from the data a warning", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-glyph-"));
  const template = join(dir, "proef.typ");
  // The rule that sets text as code points, as the report has it.
  const report = readFileSync(join(TEMPLATES, "rapport.typ"), "utf8");
  const rule = report.slice(report.indexOf("#show: body => {\n  let unshown"), report.indexOf("\n}\n", report.indexOf("let unshown")) + 3);
  writeFileSync(template, `${rule}#set document(title: "Proef")\n#set text(lang: "nl", font: "Atkinson Hyperlegible Next")\n= Proef\n#sys.inputs.at("text", default: "")\n`);
  const request = { template, inputs: { text: "Kop" }, title: "Proef", date: "2026-10-12T09:00:00.000Z" };
  // The same character in the template's own text: a fault in loep, even when the data has it too.
  writeFileSync(join(dir, "eigen.typ"), readFileSync(template, "utf8").replace("= Proef", "= Proef 中"));
  const own = await makePdf({ ...request, template: join(dir, "eigen.typ"), inputs: { text: "中" }, output: join(dir, "eigen.pdf") });
  if (own.pdfChecks.some((problem) => problem.includes("Typst is niet geïnstalleerd"))) return context.skip("Typst is not installed");
  assert.ok(own.pdf !== null, own.pdfChecks.join("\n"));
  assert.ok(own.pdfChecks.includes(unshownCheck(["中"])), own.pdfChecks.join("\n"));
  assert.deepEqual(own.pdfWarnings, []);
  const site = await makePdf({ ...request, inputs: { text: "中" }, output: join(dir, "site.pdf") });
  assert.ok(site.pdf !== null, site.pdfChecks.join("\n"));
  assert.ok(!site.pdfChecks.some((problem) => problem.includes("codepunt")), site.pdfChecks.join("\n"));
  assert.deepEqual(site.pdfWarnings, [unshownWarning(["中"])]);
  assert.match(unshownWarning(["中"]), /^1 teken zonder glyph is als codepunt weergegeven/);
});

test("the PDF shows the part for what waits for sending, with the flags of inventory", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-not-sent-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(withNotSent().evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  assert.deepEqual(result.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Pas te meten als het onderzoek mag versturen"));
  assert.ok(flat.includes("--test-environment https://chat.voorbeeld.nl"), "the flags stand in the PDF");
});

test("the report says it was made with loep, and that the judgment is of who signs it", () => {
  const evaluation = exampleEvaluation();
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("- Gemaakt met loep 0.0.1, commit 000000000000\n"));
  assert.ok(markdown.includes("- Gemaakt met: loep 0.0.1, een instrument dat meet en bewijs vastlegt; het oordeel is van wie het rapport aftekent.\n"));
  assert.equal(deriveReport(evaluation).madeWithShortNl, "Gemaakt met loep 0.0.1");
  // A tree with changes that are in no commit: the commit does not describe the code, and the cover says so.
  evaluation.toolchain.toolbox.dirty = true;
  assert.equal(deriveReport(evaluation).madeWithNl, "Gemaakt met loep 0.0.1, commit 000000000000 met niet vastgelegde wijzigingen");
});

test("a toolbox without a commit gives the version only, and says nothing about uncommitted changes", () => {
  // null is what a run outside a git repository writes; "no commit yet" is what one wrote before 0.1.3, here with the dirty flag it could get.
  for (const commit of [null, "no commit yet"]) {
    const evaluation = exampleEvaluation();
    evaluation.toolchain.toolbox.commit = commit;
    evaluation.toolchain.toolbox.dirty = true;
    const derived = deriveReport(evaluation);
    assert.equal(derived.madeWithNl, "Gemaakt met loep 0.0.1", String(commit));
    assert.equal(derived.toolboxCommit, null);
    assert.equal(derived.toolboxChanged, false);
    const markdown = renderMarkdown(evaluation);
    assert.ok(markdown.includes("- Gemaakt met loep 0.0.1\n"), String(commit));
    assert.ok(markdown.includes("- Toolbox: loep, versie 0.0.1, commit onbekend (niet gemaakt vanuit een git-repository)\n"), String(commit));
    assert.ok(markdown.includes("- Commit van de toolbox: onbekend (niet gemaakt vanuit een git-repository)\n"), String(commit));
    assert.ok(!markdown.includes("no commit"), String(commit));
    assert.ok(!markdown.includes("niet vastgelegde wijzigingen"), String(commit));
    assert.ok(!markdown.includes("niet in deze commit staan"), String(commit));
  }
});

test("the PDF of a toolbox without a commit gives the version only, and says nothing about uncommitted changes", async (context) => {
  for (const commit of [null, "no commit yet"]) {
    const evaluation = exampleEvaluation();
    evaluation.toolchain.toolbox.commit = commit;
    evaluation.toolchain.toolbox.dirty = true;
    const dir = mkdtempSync(join(tmpdir(), "render-nocommit-"));
    writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
    const result = await render(dir);
    if (result.pdf === null) return context.skip("Typst is not installed");
    const text = await tool("pdftotext", ["-layout", result.pdf, "-"]);
    if (!text.found) return context.skip("pdftotext is not installed");
    // A line may break after the hyphen of "git-repository".
    const flat = text.stdout.replace(/-\n\s*/g, "-").replace(/\s+/g, " ");
    assert.ok(flat.includes("Gemaakt met loep 0.0.1"), String(commit));
    assert.ok(!flat.includes("Gemaakt met loep 0.0.1, commit"), String(commit));
    assert.ok(flat.includes("commit onbekend (niet gemaakt vanuit een git-repository)"), String(commit));
    assert.ok(flat.includes("Commit van de toolbox onbekend (niet gemaakt vanuit een git-repository)"), String(commit));
    assert.ok(!flat.includes("no commit"), String(commit));
    assert.ok(!flat.includes("niet vastgelegde wijzigingen"), String(commit));
    assert.ok(!flat.includes("niet in deze commit staan"), String(commit));
  }
});

test("the version shown is the first 12 characters of the evaluation hash", () => {
  const evaluation = exampleEvaluation();
  assert.ok(renderMarkdown(evaluation).includes(`Versie van de evaluatie: \`${evaluationHash(evaluation).slice(0, 12)}\``));
});

test("text from the evaluation cannot break the Markdown structure", () => {
  const evaluation = exampleEvaluation();
  const finding = evaluation.criteria.find((criterion) => criterion.findings.length > 0)!.findings[0]!;
  finding.titleNl = "Een | pijp, een <script> en een\nregeleinde";
  finding.locations[0]!.where = "a[href=`x`] | b";
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("Een \\| pijp, een \\<script\\> en een regeleinde"));
  assert.ok(markdown.includes("`` a[href=`x`] \\| b ``"));
});

test("code between backticks in a text from the evaluation stays code, and a lone backtick is escaped", () => {
  const evaluation = exampleEvaluation();
  const finding = evaluation.criteria.find((criterion) => criterion.findings.length > 0)!.findings[0]!;
  finding.titleNl = "Geef de knop `aria-label=\"Zoek\"` en de lijst `role=\"list\"`";
  finding.observedNl = "Een losse ` blijft gewoon een teken";
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("Geef de knop `aria-label=\"Zoek\"` en de lijst `role=\"list\"`"), "no escaped backticks around code");
  assert.ok(markdown.includes("Een losse \\` blijft gewoon een teken"));
});

test("the Markdown report has no stray punctuation, empty brackets or placeholders", () => {
  const stray = [/\. \./, /[^.]\.\.(?!\.)/, /: \./, /, \./, /\(\s*\)/, /\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\b0 (vraagt|vragen|is|zijn) (een mens|door dit onderzoek)/];
  const described = withInstruments();
  described.browsers = browserUse("153.0.8010.12", secondBrowserUse(new Map()));
  for (const [name, evaluation] of [["plain", exampleEvaluation()], ["defects", withDefects()], ["weighed", weighed(withDefects())], ["instruments", described]] as const) {
    const markdown = renderMarkdown(evaluation);
    for (const pattern of stray) assert.doesNotMatch(markdown, pattern, `${name}: ${pattern}`);
  }
});

test("a measurement repeated in a second browser names each browser once, with what it repeated", () => {
  const text = repeatedInBrowsersNl([
    { browser: "webkit", version: "26.6", commands: new Set(["spacing", "name", "reflow", "zoom"]), count: 300 },
    { browser: "firefox", version: "155.0", commands: new Set(["taborder"]), count: 76 },
    { browser: "webkit", version: "26.6", commands: new Set(["taborder"]), count: 4 },
  ]);
  assert.equal((text.match(/WebKit/g) ?? []).length, 1, text);
  assert.equal((text.match(/Firefox/g) ?? []).length, 1, text);
  assert.ok(text.includes("in Firefox de Tab-volgorde; in WebKit (de motor van Safari) de Tab-volgorde, de tekstafstand, de toegankelijke naam en rol, reflow op 320 pixels en vergroten tot 200%."), text);
  assert.match(repeatedInBrowsersNl([]), /Geen meting is in een andere browser herhaald\.$/);
});

test("a quote in a limitation ends at a whole word, also in an evaluation made before that was so", () => {
  const long = `${"woorden ".repeat(40)}einde`;
  const quote = quoteStart(long);
  assert.ok(quote.endsWith("woorden…") && quote.length <= 221, quote);
  assert.equal(quoteStart("kort"), "kort");
  const old = `Bij 1.3.3 hoort iets bij 1.1.1. Dit moet worden nagekeken: "${long.slice(0, 220)}"`;
  assert.ok(long.slice(0, 220).endsWith(" woor"), "the old quote stops in the middle of a word");
  assert.ok(closeCutQuote(old).endsWith(' woorden…"'), closeCutQuote(old));
  const short = 'Dit moet worden nagekeken: "kort en af"';
  assert.equal(closeCutQuote(short), short);
});

test("the report has no em-dashes of its own", () => {
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  assert.ok(!dashes.test(renderMarkdown(exampleEvaluation())));
  assert.ok(!dashes.test(renderMarkdown(weighed(withDefects()))));
});

test("a weighed report says per core task which groups are stopped, and counts the defects per task and per group", () => {
  const evaluation = weighed(withDefects());
  const markdown = renderMarkdown(evaluation);
  const summary = markdown.slice(markdown.indexOf("### Wie loopt vast"), markdown.indexOf("### Wat betekent dit"));
  const stopped = evaluation.defects!.filter((defect) => defect.severity === "blokkerend");
  assert.ok(stopped.length >= 2, "the example has defects that stop a group");
  // Who is stopped comes before the scores: it is what a reader with ten minutes needs.
  assert.ok(markdown.indexOf("### Wie loopt vast") < markdown.indexOf("**WCAG 2.2 niveau A en AA"));
  // The section gives the answer first, at how many of the core tasks a group is stopped, then what a core task is.
  assert.ok(summary.startsWith("### Wie loopt vast\n\nBij beide kerntaken loopt een groep bezoekers vast.\n\nEen kerntaak is iets waarvoor bezoekers naar de site komen. Het onderzoek heeft de kerntaken uit de site afgeleid. Vastlopen betekent dat een groep iets niet kan wat voor de taak nodig is.\n"), summary);
  // Under the task: who is stopped there and why the task can not be finished, then the defects, heaviest first.
  assert.ok(summary.includes(`**Een vergunning aanvragen**\n\nMensen die niet zien lopen hier vast. Zonder dit onderdeel is de aanvraag niet te versturen. Dat komt door deze gebreken:\n\n${stopped.map((defect) => `- [${defect.titleNl}](#${defect.id})`).join("\n")}\n`), summary);
  // Findings that stop a group only together stand with their task, and say that none of them does alone.
  const together = evaluation.weighing!.together!;
  assert.equal(together.length, 1);
  assert.match(summary, /\*\*Bij elke kerntaak\*\*\n\nMensen die slecht zien lopen hier vast door gebreken die samenkomen\. Na de eerste omweg stuiten ze op het tweede onderdeel, en daarna is er geen weg meer naar het formulier\. Geen van deze gebreken houdt hen alleen tegen:\n\n- \[[^\]]+\]\(#VRB-G-\w+\)\n- \[[^\]]+\]\(#VRB-G-\w+\)\n/);
  // It changes no severity: what stops a group together is not blokkerend.
  for (const id of together[0]!.findings) assert.notEqual(evaluation.criteria.flatMap((criterion) => criterion.findings).find((finding) => finding.id === id)!.severity, "blokkerend");
  // Something stops a group at every task, so no task is called free of it.
  assert.ok(!summary.includes("geen gebrek waardoor een groep vastloopt"));
  // What the section can not show is said with it: findings are weighed one by one, and criteria without a verdict can hide more.
  assert.ok(summary.includes("Deze lijst komt uit één weging door een taalmodel. Bij een tweede weging kan er een enkel gebrek bij komen of af vallen. Elke bevinding is apart gewogen. Dat meer gebreken op dezelfde weg een groep samen tegenhouden, staat hier alleen als het uit de bevindingen bleek. Over 4 criteria heeft het onderzoek nog geen oordeel; ook daar kan een groep vastlopen."));
  // What stops a group at a core task alone is what the table calls blokkerend: the two lists are the same defects.
  const derived = deriveReport(evaluation);
  const alone = derived.weighing!.stopped.flatMap((task) => task.causes.filter((cause) => !cause.together));
  assert.deepEqual([...new Set(alone.flatMap((cause) => cause.defects.map((defect) => defect.id)))].sort(), stopped.map((defect) => defect.id).sort());
  for (const cause of derived.weighing!.stopped.flatMap((task) => task.causes)) assert.ok((cause.whyNl.length > 0 || cause.defects.every((defect) => defect.whyNl.length > 0)) && /lopen hier vast( door gebreken die samenkomen)?\.$/.test(cause.whoNl), cause.whoNl);

  // Per core task the defects of each severity; what belongs to every task and to none has a row of its own.
  assert.ok(summary.includes("| Kerntaak | Blokkerend | Midden | Laag |\n| --- | ---: | ---: | ---: |\n| Een vergunning aanvragen | 2 | 0 | 0 |\n| Contact opnemen | 0 | 0 | 0 |\n| Elke kerntaak | 0 | 2 | 0 |\n| Geen kerntaak | 0 | 0 | 2 |\n"), summary);
  // "Hoog" has no column: such a defect belongs to no core task, and the sentence above the table says where those are.
  assert.equal(derived.weighing!.tasks.reduce((total, row) => total + row.counts.reduce((sum, value) => sum + value, 0), 0), evaluation.defects!.filter((defect) => defect.severity !== "hoog").length, "every other defect stands in one row");
  assert.ok(evaluation.defects!.every((defect) => defect.severity !== "hoog" || defect.weighing!.task === null));
  // Per group, a defect counts once, with the worst that happens to that group. Every group of the standard has a row,
  // also one no defect names, with the criteria that are essential for it and still open.
  // What each consequence means stands as a list under the first sentence, not as labels in a paragraph.
  assert.ok(summary.includes("De tabel telt per groep bezoekers hoeveel gebreken haar hinderen, en met welk gevolg.\n\n- Kan het niet: langs de eigen manier van werken is er geen weg.\n- Alleen met een omweg: de bezoeker moet een andere weg zoeken, zoals een andere pagina.\n- Met extra moeite: de eigen weg werkt, maar kost meer tijd of zoeken.\n\nDe laatste kolom telt de criteria"), summary);
  assert.ok(summary.includes("| Groep | Kan het niet | Alleen met een omweg | Met extra moeite | Criteria nog open |\n| --- | ---: | ---: | ---: | ---: |\n| Alle bezoekers | 0 | 0 | 1 |  |\n| Mensen die niet zien | 2 | 1 | 1 | "), summary);
  assert.equal(derived.weighing!.groups.length, 11);
  assert.match(summary, /\| Mensen die gevoelig zijn voor flitsen \| 0 \| 0 \| 0 \| \d+ \|/);
  for (const row of derived.weighing!.groups) assert.ok(row.cannot + row.detour + row.effort <= evaluation.defects!.length, row.groupNl);
  const openFor = (group: string): number => evaluation.criteria.filter((criterion) => criterion.outcome === "cantTell" && groupsFor(criterion.id)!.primary.includes(group as never)).length;
  assert.equal(derived.weighing!.groups.find((row) => row.groupNl === "Mensen die slecht zien")!.open, openFor("low-vision"));
  assert.ok(openFor("low-vision") > 0, "the example has an open criterion that is essential for a group");

  // The work list says in a line who is hit hardest and how many other groups, and names the core task as a fact.
  assert.match(markdown, /- <a id="VRB-G-\w+"><\/a>blokkerend: \*\*Statuspictogram zonder tekstalternatief\*\* \(VRB-G-\w+\)\n  - Hoofdcriterium 1\.1\.1\. Pagina's: P04\.\n  - Mensen die niet zien kunnen dit niet gebruiken\. Ook één andere groep heeft er last van\.\n  - Kerntaak: Een vergunning aanvragen\n/);
  const who = (id: string): string => derived.weighing!.ofDefect[evaluation.defects!.find((defect) => defect.findingIds.includes(id))!.id]!.whoNl;
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  assert.ok(findings.some((finding) => /^Mensen die [^.]+ kunnen dit alleen met een omweg gebruiken\. Ook één andere groep heeft er last van\.$/.test(who(finding.id))), findings.map((finding) => who(finding.id)).join("\n"));
  assert.ok(findings.some((finding) => /^Mensen die [^.]+ en mensen die [^.]+ kunnen dit gebruiken, maar het kost extra moeite\.$/.test(who(finding.id))));
  assert.ok(findings.some((finding) => who(finding.id) === "Uit de bevindingen blijkt geen gevolg voor een groep bezoekers."));
  // How the severity came about is said with the other notes on reliability, per finding as the step records it.
  assert.ok(markdown.includes("De ernst van een bevinding volgt uit wat per bevinding is vastgelegd"));
  assert.ok(markdown.includes("is afgeleid uit de bevinding en niet met hulpsoftware of met bezoekers waargenomen"));
  assert.ok(!markdown.includes("Zwaarste gebreken"), "with a weighing the summary says who is stopped instead of listing the heaviest defects");
});

test("without a weighing the report says why: not run, made for other findings, or from before the step existed", () => {
  const notRun = withDefects();
  notRun.weighing = { status: "not-run" };
  assert.ok(renderMarkdown(notRun).includes("De ernst van een gebrek is de hoogste ernst die de beoordelaars aan zijn bevindingen gaven. De stap die per bevinding vastlegt welke groepen bezoekers ze hindert, is niet uitgevoerd."));
  const stale = withDefects();
  stale.weighing = { status: "stale", reason: "findings" };
  assert.ok(renderMarkdown(stale).includes("Er is een weging van de bevindingen per groep bezoekers, maar die is niet toegepast: ze is gemaakt voor andere bevindingen dan deze."));
  stale.weighing = { status: "stale", reason: "unchecked" };
  assert.ok(renderMarkdown(stale).includes("maar die is niet toegepast: ze is niet gecontroleerd, of na de controle gewijzigd."));
  // An evaluation from before the step says nothing about a step that did not exist.
  const old = renderMarkdown(withDefects());
  assert.ok(old.includes("De ernst van een gebrek is de hoogste ernst die de beoordelaars aan zijn bevindingen gaven.") && !/De stap die per bevinding vastlegt/.test(old));
  for (const evaluation of [notRun, stale, withDefects()]) {
    const markdown = renderMarkdown(evaluation);
    assert.ok(!markdown.includes("Wie loopt vast") && markdown.includes("### Zwaarste gebreken"), "without a weighing the summary lists the heaviest defects");
  }
});

test("what stops a group at every core task leaves no task free, and a task alone is named when it is", () => {
  const evaluation = weighed(withDefects());
  // Nothing stops a group together any more: the one task without a stopping defect is named.
  evaluation.weighing!.together = [];
  const one = renderMarkdown(evaluation);
  assert.ok(one.includes("Bij 1 van de 2 kerntaken loopt een groep bezoekers vast.\n"));
  assert.ok(one.includes("Bij de andere kerntaak, “Contact opnemen”, loopt op de onderzochte pagina's geen groep vast. Wat daar een omweg of extra moeite geeft, staat in de werklijst."));
  // Without any defect that stops a group, the report says so of every task.
  const calm = weighed(withDefects());
  calm.weighing!.together = [];
  for (const finding of calm.criteria.flatMap((criterion) => criterion.findings)) if (finding.weighing!.task !== null && finding.weighing!.affected.some((entry) => entry.consequence === "cannot")) Object.assign(finding.weighing!, { task: null, blocksNl: undefined });
  // The headline counts the tasks and the table per core task names them, so the sentence does not name them again.
  const quiet = renderMarkdown(calm);
  assert.ok(quiet.includes("### Wie loopt vast\n\nBij geen van de 2 kerntaken loopt een groep bezoekers vast.\n"));
  assert.ok(quiet.includes("Het onderzoek vond op de onderzochte pagina's geen gebrek waardoor een groep vastloopt. Wat een omweg of extra moeite geeft, staat in de werklijst."));
  assert.ok(quiet.includes("\n| Een vergunning aanvragen | ") && quiet.includes("\n| Contact opnemen | "));
  // A defect that stops a group at every task: no task is free, so the sentence about the other tasks is left out.
  const everywhere = weighed(withDefects());
  everywhere.weighing!.together = [];
  const first = everywhere.criteria.flatMap((criterion) => criterion.findings)[0]!;
  first.weighing!.task = "all";
  const markdown = renderMarkdown(everywhere);
  assert.ok(markdown.includes("Bij beide kerntaken loopt een groep bezoekers vast.\n"));
  assert.ok(markdown.includes("**Bij elke kerntaak**\n\nMensen die niet zien lopen hier vast. Zonder dit onderdeel is de aanvraag niet te versturen. Dat komt door het gebrek ["));
  assert.ok(!markdown.includes("geen gebrek waardoor een groep vastloopt"));
});

test("a reason for a stopped task is never put with a group it was not written for", () => {
  const evaluation = weighed(withDefects());
  evaluation.weighing!.together = [];
  // Two defects at one task that stop different groups, each with its own reason.
  const stopping = evaluation.criteria.flatMap((criterion) => criterion.findings).filter((finding) => finding.weighing!.task === "aanvragen");
  assert.equal(stopping.length, 2);
  stopping[1]!.weighing!.affected = [{ group: "limited-manipulation", consequence: "cannot", textNl: "Ze bedienen de pagina met het toetsenbord. Het filter werkt alleen door te slepen." }];
  stopping[1]!.weighing!.blocksNl = "Het filter van de aanvraag werkt alleen door te slepen.";
  const markdown = renderMarkdown(evaluation);
  const summary = markdown.slice(markdown.indexOf("### Wie loopt vast"), markdown.indexOf("Het onderzoek vond"));
  assert.match(summary, /Mensen die niet zien lopen hier vast\. Zonder dit onderdeel is de aanvraag niet te versturen\. Dat komt door het gebrek \[[^\]]+\]\(#VRB-G-\w+\)\.\n\nMensen die hun handen moeilijk gebruiken lopen hier vast\. Het filter van de aanvraag werkt alleen door te slepen\. Dat komt door het gebrek \[/);
});

test("two defects that stop the same group each keep their own reason, under the finding that stops the group", () => {
  const evaluation = weighed(withDefects());
  evaluation.weighing!.together = [];
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const [one, main] = findings.filter((finding) => finding.weighing!.task === "aanvragen");
  const first = evaluation.defects!.find((defect) => defect.findingIds.includes(one!.id))!;
  const second = evaluation.defects!.find((defect) => defect.findingIds.includes(main!.id))!;
  assert.deepEqual([second.mainFindingId, second.findingIds.length], [main!.id, 2]);
  // In the second defect the finding it is named after costs a group effort; its other finding stops the group, for a reason of its own.
  const other = findings.find((finding) => second.findingIds.includes(finding.id) && finding.id !== main!.id)!;
  main!.weighing = { task: null, affected: [{ group: "no-hearing", consequence: "cannot", textNl: "Ze lezen de pagina. Het geluid bij het veld heeft geen tekst." }], withoutNl: "Zonder het geluid is de aanvraag nog te versturen." };
  main!.severity = "hoog";
  other.weighing = { task: "aanvragen", blocksNl: "Zonder naam weet de bezoeker niet wat het veld vraagt.", affected: [{ group: "no-vision", consequence: "cannot", textNl: "Ze horen een veld zonder naam." }, { group: "low-vision", consequence: "effort", textNl: "Ze zoeken het veld op de vergrote pagina." }] };
  other.severity = "blokkerend";
  second.weighing = { task: "aanvragen", blocksNl: other.weighing.blocksNl!, affected: [other.weighing.affected[0]!, main!.weighing.affected[0]!, other.weighing.affected[1]!] };
  const markdown = renderMarkdown(evaluation);
  const summary = markdown.slice(markdown.indexOf("### Wie loopt vast"), markdown.indexOf("Het onderzoek vond"));
  // The same group, another reason: the paragraph names the group once and each defect says why, under the finding that stops the group.
  assert.notEqual(other.titleNl, second.titleNl);
  assert.ok(
    summary.includes(
      `**Een vergunning aanvragen**\n\nMensen die niet zien lopen hier vast. Dat komt door deze gebreken:\n\n- [${first.titleNl}](#${first.id}). Zonder dit onderdeel is de aanvraag niet te versturen.\n- [${other.titleNl}](#${second.id}). Zonder naam weet de bezoeker niet wat het veld vraagt.\n`,
    ),
    summary,
  );
  // A group that can not use a part of the defect no task needs is not said to be stopped: not in the summary, and not in the work list.
  assert.ok(!summary.includes("niet horen"));
  assert.equal(deriveReport(evaluation).weighing!.ofDefect[second.id]!.whoNl, "Mensen die niet zien kunnen dit niet gebruiken. Ook 2 andere groepen hebben er last van.");
});

test("a group that can not use a part no core task needs stands beside the tasks, with how the tasks still work", () => {
  const evaluation = weighed(withDefects());
  // The fixture's finding of this kind shares a defect with one that stops a group; here it stands alone.
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const beside = findings.find((finding) => finding.weighing!.withoutNl !== undefined)!;
  assert.equal(beside.severity, "hoog");
  const defect = evaluation.defects!.find((entry) => entry.findingIds.includes(beside.id))!;
  for (const id of defect.findingIds.filter((id) => id !== beside.id)) Object.assign(findings.find((finding) => finding.id === id)!, { severity: "laag", weighing: { task: null, affected: [{ group: "no-vision", consequence: "effort", textNl: "Ze horen het veld zonder naam." }] } });
  Object.assign(defect, { severity: "hoog", weighing: { task: null, affected: beside.weighing!.affected, withoutNl: beside.weighing!.withoutNl } });
  const markdown = renderMarkdown(evaluation);
  const summary = markdown.slice(markdown.indexOf("### Wat een groep niet kan, buiten de kerntaken"), markdown.indexOf("### Gebreken per kerntaak"));
  assert.ok(summary.includes(`| [${defect.titleNl}](#${defect.id}) | `), summary);
  assert.ok(summary.includes("Dit gebrek heeft ernst hoog: een groep kan het deel niet gebruiken, maar de kerntaken lukken zonder. De gebreken met een lichtere ernst ("));
  assert.ok(markdown.includes("Bij dezelfde ernst staat in de werklijst eerst wat bij een kerntaak hoort. Het ene gebrek met ernst hoog hoort bij geen kerntaak en staat onder “Wat een groep niet kan, buiten de kerntaken”."));
  const card = markdown.slice(markdown.indexOf(`###### ${beside.id} `), markdown.indexOf("<a id=", markdown.indexOf(`###### ${beside.id} `)));
  // The finding stands under another criterion than its defect, so its card is set close: the same facts in running text.
  assert.ok(card.includes(" Kerntaak: geen."));
  assert.ok(card.includes(" Zonder dit onderdeel is de aanvraag nog te versturen en is contact nog op te nemen. Daarom is de ernst hoog en niet blokkerend.\n"), card);
  // A weighing from before the sentence existed says it in general words.
  delete beside.weighing!.withoutNl;
  assert.ok(renderMarkdown(evaluation).includes(" De kerntaken van de site lukken ook zonder dit deel. Daarom is de ernst hoog en niet blokkerend.\n"));
});

test("a weighed finding says per group what happens and why that gives its severity; without a weighing it says what the judge wrote", () => {
  const evaluation = weighed(withDefects());
  const markdown = renderMarkdown(evaluation);
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const card = (id: string): string => markdown.slice(markdown.indexOf(`###### ${id} `), markdown.indexOf("<a id=", markdown.indexOf(`###### ${id} `)));
  const first = findings[0]!;
  assert.ok(
    card(first.id).includes(
      "**Wie heeft er last van**\n\nMensen die niet zien kunnen dit niet gebruiken. Ze gaan met de schermlezer van kop naar kop door de pagina. Het onderdeel heeft geen naam, dus ze weten niet wat het is.\n\nAlle bezoekers kunnen dit gebruiken, maar het kost extra moeite. Ze klikken op het onderdeel om verder te gaan. Er gebeurt pas bij de tweede klik iets.\n",
    ),
    card(first.id),
  );
  // The highest step: the core task as a fact, and in the reason why the task can not be finished.
  assert.ok(card(first.id).includes("- Kerntaak: Een vergunning aanvragen\n"));
  assert.ok(card(first.id).includes("\nDit deel is nodig voor de kerntaak “Een vergunning aanvragen”. Zonder dit onderdeel is de aanvraag niet te versturen. Daarom is de ernst blokkerend.\n"));
  assert.ok(!card(first.id).includes(first.impactNl), "the weighing stands in the place of what the judge wrote");
  // A detour: the reason names the group that has to take another way, and says that no group is stopped.
  const detour = card(findings.find((finding) => finding.severity === "midden")!.id);
  assert.ok(detour.includes("- Kerntaak: elke kerntaak\n"));
  assert.match(detour, /kunnen dit alleen met een omweg gebruiken\. Ze gaan met de schermlezer van kop naar kop door de pagina\./);
  assert.match(detour, /\nGeen groep loopt hier vast, maar mensen die [^.]+ moeten een andere weg nemen\. Daarom is de ernst midden\.\n/);
  // More effort, with a fact that is missing: the report says what that means for the severity. An account without a full stop gets one.
  const effort = card(findings.find((finding) => finding.weighing!.unsureNl !== undefined)!.id);
  assert.ok(effort.includes("kost tijd om te vinden.\n\nElke groep komt er langs de eigen weg, maar het kost meer moeite. Daarom is de ernst laag.\n\nDe ernst kan anders uitvallen. Of dezelfde tekst ook elders op de pagina staat, is niet bekend.\n"), effort);
  assert.ok(effort.includes("- Kerntaak: geen\n"));
  // No group hindered: a sentence per group the criterion is essential for, and why the finding stays.
  const none = card(findings.find((finding) => finding.weighing!.affected.length === 0)!.id);
  assert.match(none, /Uit de bevinding blijkt geen gevolg voor een groep bezoekers\.\n\nMensen die [^.]+ krijgen hier hetzelfde als andere bezoekers\. Ze krijgen langs de eigen weg dezelfde tekst te horen of te zien\.\n/);
  assert.ok(none.includes("\nHet blijft een afwijking van de norm, dus de ernst is laag.\n"));
  // One group: the reason goes on about "ze".
  const single = weighed(withDefects());
  const lone = single.criteria.flatMap((criterion) => criterion.findings).find((finding) => finding.severity === "midden")!;
  lone.weighing!.affected = lone.weighing!.affected.slice(0, 1);
  assert.ok(renderMarkdown(single).includes("\nZe lopen hier niet vast, maar moeten een andere weg nemen. Daarom is de ernst midden.\n"));
  // The severity on a card is the one the report sorts on, for every finding.
  for (const finding of findings) assert.ok(card(finding.id).includes(`Ernst: ${finding.severity}`) && new RegExp(`(Daarom is de ernst|dus de ernst is) ${finding.severity}( en niet blokkerend)?\\.`).test(card(finding.id)), finding.id);
  // No label with a value in the account, and nothing that reads as a form.
  for (const finding of findings) assert.ok(!/Niet vastgesteld:|Dit hoort bij|van de drie gevolgen/.test(card(finding.id)), finding.id);
  // Without a weighing: the judge's own words.
  const plain = withDefects();
  assert.ok(renderMarkdown(plain).includes(`**Wie heeft er last van**\n\n${plain.criteria.flatMap((criterion) => criterion.findings)[0]!.impactNl}`));
});

test("within one severity the work list puts what visitors need for a core task first", () => {
  const evaluation = weighed(withDefects());
  const derived = deriveReport(evaluation);
  const order = derived.defects!.fix.flatMap((group) => group.defectIds).map((id) => evaluation.defects!.find((defect) => defect.id === id)!);
  for (const owner of new Set(order.map((defect) => defect.owner))) {
    const own = order.filter((defect) => defect.owner === owner);
    for (const [index, defect] of own.entries()) {
      const next = own[index + 1];
      if (!next) continue;
      const rank = (severity: string): number => (SEVERITIES as readonly string[]).indexOf(severity);
      assert.ok(rank(defect.severity) <= rank(next.severity), "heaviest first");
      if (defect.severity === next.severity) assert.ok(Number(defect.weighing!.task !== null) >= Number(next.weighing!.task !== null), `${defect.id} before ${next.id}: a core task first`);
    }
  }
  // Two defects of one severity: the one at a core task leads, also with fewer pages.
  const [beside, core] = [evaluation.defects![0]!, evaluation.defects![1]!];
  Object.assign(beside, { severity: "midden", pages: ["P01", "P02", "P03"], weighing: { task: null, affected: [] } });
  Object.assign(core, { severity: "midden", pages: ["P01"], weighing: { task: "aanvragen", affected: [] } });
  Object.assign(core, { owner: beside.owner });
  const sorted = deriveReport(evaluation).defects!.fix.flatMap((group) => group.defectIds);
  assert.ok(sorted.indexOf(core.id) < sorted.indexOf(beside.id));
});

/**
 * The example with its findings grouped. The search field without a name is also reported
 * as a field without a label, so one defect holds two findings.
 */
function withDefects(): Evaluation {
  const evaluation = exampleEvaluation();
  const search = evaluation.criteria.find((criterion) => criterion.id === "4.1.2")!.findings.find((finding) => finding.component === "zoekveld")!;
  const labels = evaluation.criteria.find((criterion) => criterion.id === "3.3.2")!;
  labels.outcome = "failed";
  labels.findings = [{ ...search, id: "VRB-3.3.2-zoek", criterion: "3.3.2", titleNl: "Zoekveld heeft alleen een voorbeeldtekst", severity: "midden" }];
  evaluation.defects = mergeFindings(evaluation);
  evaluation.merge = { rulesVersion: 1, proposal: { status: "not-run" } };
  return evaluation;
}

test("an evaluation without defects has its findings in the worklist and no list of defects", () => {
  const markdown = renderMarkdown(exampleEvaluation());
  assert.equal(deriveReport(exampleEvaluation()).defects, null);
  assert.ok(markdown.includes("### Zwaarste bevindingen") && markdown.includes("## Bevindingen per pagina"));
  assert.ok(!markdown.includes("## Gebreken per pagina") && !markdown.includes("- Gebrek: ") && !markdown.includes("Samenvoegen"));
  assert.ok(!markdown.includes("Controle:") && !markdown.includes("Gemeten toestanden"));
});

test("with defects the report counts defects and findings apart and the worklist lists defects", () => {
  const evaluation = withDefects();
  const markdown = renderMarkdown(evaluation);
  const derived = deriveReport(evaluation).defects!;
  assert.equal(derived.countsNl, "6 gebreken, 7 bevindingen onder 6 criteria");
  assert.ok(markdown.includes("Het onderzoek vond 6 gebreken, 7 bevindingen onder 6 criteria."));
  assert.ok(markdown.includes("### Zwaarste gebreken") && !markdown.includes("### Zwaarste bevindingen"));

  const joined = evaluation.defects!.find((defect) => defect.findingIds.length === 2)!;
  assert.equal(joined.mainCriterion, "3.3.2");
  const worklist = markdown.split("## Wat nu")[1]!.split("\n## ")[0]!;
  // Every defect once, most severe first within its owner, with its criteria, pages and findings.
  for (const defect of evaluation.defects!) assert.equal(worklist.split(`<a id="${defect.id}"></a>`).length - 1, 1, `defect ${defect.id}`);
  assert.deepEqual(derived.fix.map((group) => group.owner), ["techniek", "content", "design"]);
  const severities = derived.fix[0]!.defectIds.map((id) => evaluation.defects!.find((defect) => defect.id === id)!.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b)));
  assert.ok(worklist.includes(`- <a id="${joined.id}"></a>hoog: **Zoekveld heeft alleen een voorbeeldtekst** (${joined.id})`));
  assert.ok(worklist.includes("  - Hoofdcriterium 3.3.2, raakt ook 4.1.2. Pagina's: P01 e.a."));
  assert.ok(worklist.includes(`  - Bevindingen: [VRB-3.3.2-zoek](#VRB-3.3.2-zoek), [${joined.findingIds[1]}](#${joined.findingIds[1]})`));
  for (const finding of evaluation.criteria.flatMap((criterion) => criterion.findings)) assert.ok(worklist.includes(`](#${finding.id})`), `${finding.id} is missing from the work list`);

  // Under its criterion every finding says which defect it belongs to, and where the defect is filed.
  assert.ok(markdown.includes(`- Gebrek: [${joined.id}](#${joined.id}). Hoofdcriterium: dit criterium. Raakt ook: 4.1.2`));
  assert.ok(markdown.includes(`- Gebrek: [${joined.id}](#${joined.id}). Hoofdcriterium: 3.3.2, zie [VRB-3.3.2-zoek](#VRB-3.3.2-zoek)`));
  assert.equal((markdown.match(/^- Gebrek: /gm) ?? []).length, 7);
  // The finding under the other criterion has a closer card with the same facts; the appendix does not repeat it.
  const other = joined.findingIds[1]!;
  const [main, appendix] = markdown.split("## Bijlage A: onderbouwing per criterium");
  const card = main!.split(`<a id="${other}"></a>`)[1]!.split("<a id=")[0]!;
  assert.ok(card.includes("- Wat is er mis: Het zoekveld in de kop heeft alleen een placeholder") && card.includes("- Oplossing: Koppel een label aan het veld") && card.includes("- Waar: P01"));
  assert.ok(!card.includes("**Oplossing**") && !card.includes("**Waar**"));
  assert.equal((main!.match(/\*\*Oplossing\*\*/g) ?? []).length, 6, "every other finding keeps its full card");
  assert.ok(!appendix!.includes("Oplossing: ") && !appendix!.includes("Koppel een label aan het veld"));
  assert.ok(markdown.includes("## Gebreken per pagina"));
  assert.ok(markdown.includes("De tweede stap, waarin een taalmodel voorstelt wat verder bij elkaar hoort, is niet uitgevoerd."));
  const anchors = [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]!);
  assert.equal(new Set(anchors).size, anchors.length);
});

test("verification and measured states are shown only when the evaluation has them", () => {
  const evaluation = withDefects();
  const [first, second] = evaluation.criteria.flatMap((criterion) => criterion.findings);
  first!.verification = { status: "reproduced", evidence: ["v-0003"] };
  second!.verification = { status: "unverified", evidence: [] };
  evaluation.measuredStates = { P01: ["menu-open", "zoekvenster"], P02: [] };
  const markdown = renderMarkdown(evaluation);
  assert.equal((markdown.match(/^- Controle: Bij de controle bevestigd$/gm) ?? []).length, 1);
  assert.equal((markdown.match(/^- Controle: Toegevoegd bij de controle, één keer gezien$/gm) ?? []).length, 1);
  assert.equal((markdown.match(/Gemeten toestanden: /g) ?? []).length, 1);
  assert.ok(markdown.includes("  - Gemeten toestanden: menu-open, zoekvenster"));
});

test("the PDF is made for an evaluation with and without defects, passes its checks and is the same twice", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "render-"));
  const made: Record<string, Buffer> = {};
  const described = withInstruments();
  described.site.descriptionNl = "Dit is de website van een gemeente.\n\nInwoners vragen er een vergunning aan.";
  described.scope.frames = SCOPE_FRAMES;
  described.browsers = browserUse("153.0.8010.12", [{ browser: "webkit", version: "26.0 build 2359", commands: new Set(["name", "taborder"]), count: 7 }]);
  described.judgment.models = AGENT_MODELS;
  for (const [name, evaluation] of [["plain", exampleEvaluation()], ["defects", withDefects()], ["weighed", weighed(withDefects())], ["instruments", described]] as const) {
    if (name === "defects") {
      evaluation.criteria.flatMap((criterion) => criterion.findings)[0]!.verification = { status: "reproduced", evidence: [] };
      evaluation.measuredStates = { P01: ["menu-open"] };
    }
    writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
    const result = await render(dir);
    if (result.pdf === null) return context.skip("Typst is not installed");
    // Without poppler or veraPDF the check itself is what is missing; that is not a fault of the report.
    // On GitHub veraPDF is installed, so there a missing veraPDF is a failure and not a reason to skip the check.
    const missingAllowed = (problem: string): boolean => problem.includes("is niet geïnstalleerd") && !(process.env.CI === "true" && problem.includes("veraPDF"));
    assert.deepEqual(result.pdfChecks.filter((problem) => !missingAllowed(problem)), [], name);
    made[name] = readFileSync(result.pdf);
    // Where the report came from stands on the cover with the commit, and at the foot of every other page.
    const text = await tool("pdftotext", ["-layout", result.pdf, "-"]);
    if (text.found) {
      const pages = text.stdout.split("\f").filter((page) => page.trim() !== "");
      // Only a weighed evaluation says who is stopped at which core task, and why a finding has its severity.
      const flat = text.stdout.replace(/\s+/g, " ");
      assert.equal(flat.includes("Wie loopt vast"), name === "weighed", `${name}: the part on who is stopped`);
      assert.equal(flat.includes("Gebreken per groep"), name === "weighed", name);
      if (name === "weighed") for (const expected of ["Een vergunning aanvragen", "Mensen die niet zien kunnen dit niet gebruiken.", "Dit deel is nodig voor de kerntaak", "Zonder dit onderdeel is de aanvraag niet te versturen.", "lopen hier vast door gebreken die samenkomen", "Elke bevinding is apart gewogen.", "Gebreken per kerntaak", "Bij beide kerntaken loopt een groep bezoekers vast.", "Met extra moeite: de eigen weg werkt", "De ernst kan anders uitvallen. Of dezelfde tekst ook elders", "krijgen hier hetzelfde als andere bezoekers", "Kerntaak"]) assert.ok(flat.includes(expected), `weighed: the PDF says "${expected}"`);
      assert.ok(pages[0]!.includes("Gemaakt met loep 0.0.1, commit 000000000000"), `${name}: the cover says what made the report`);
      assert.deepEqual(pages.slice(1).filter((page) => !page.includes("Gemaakt met loep 0.0.1")).length, 0, `${name}: every page says what made the report`);
    }
    // The short report is the same report without appendix A. It compiles only when no link in it
    // points at the appendix: Typst refuses a link to a label that does not exist.
    assert.ok(result.shortPdf !== null && result.shortPdf.endsWith("rapport-kort.pdf"), name);
    assert.ok(readFileSync(result.shortPdf).length < made[name]!.length, `${name}: the short report is smaller`);
    await render(dir);
    assert.ok(made[name]!.equals(readFileSync(result.pdf)), `${name}: the same evaluation gives the same PDF`);
  }
  assert.ok(!made.plain!.equals(made.defects!));
});

test("the cover holds its longest texts: nothing runs over the rule or off the page", async (context) => {
  // The longest a cover gets: a long name and organisation, a grouping line, and an unfinished
  // evaluation with many open criteria.
  const evaluation = withDefects();
  evaluation.site.name = "Gemeentelijke Belastingdienst Noordoost Nederland en omstreken";
  evaluation.site.organisation = "Samenwerkingsverband Gemeentelijke Belastingen en Waardebepaling Noordoost Nederland";
  for (const criterion of evaluation.criteria.slice(0, 20)) {
    if (criterion.findings.length > 0) continue;
    criterion.outcome = "cantTell";
    criterion.missingNl = ["Een meting van dit gedrag in de toestand na interactie."];
  }
  const derived = deriveReport(evaluation);
  assert.ok(derived.statusLine.unfinished && derived.defects !== null, "the evaluation has every long text the cover can show");

  const dir = mkdtempSync(join(tmpdir(), "render-cover-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  for (const pdf of [result.pdf, result.shortPdf!]) {
    const boxes = await tool("pdftotext", ["-bbox", "-f", "1", "-l", "1", pdf, "-"]);
    if (!boxes.found) return context.skip("pdftotext is not installed");
    const height = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(boxes.stdout)![1]);
    const words = [...boxes.stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((match) => ({ x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]), text: match[5]! }));
    // The status note ends the upper part of the white block; the facts under the rule start with "Organisatie".
    const lastOfNote = words.filter((word) => word.text === "afgetekend.").at(-1)!;
    const facts = words.find((word) => word.text === "Organisatie")!;
    assert.ok(lastOfNote && facts && lastOfNote.y1 < facts.y0 - 10, `${pdf}: the status note stands above the rule and the facts`);
    assert.ok(words.every((word) => word.y1 <= height), `${pdf}: no text below the edge of the page`);
    // In the white block no two words overlap.
    const lower = words.filter((word) => word.y0 > height * 0.4);
    for (const [index, a] of lower.entries())
      for (const b of lower.slice(index + 1))
        assert.ok(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 1.5 || Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= 2.5, `${pdf}: "${a.text}" runs into "${b.text}"`);
  }
});

test("an unsigned report shows the status the outcomes lead to, marked as provisional", () => {
  const unsigned = deriveReport(exampleEvaluation());
  // How many criteria are open stands next to the status; test/finish.test.ts reads that line.
  const { openNl, unfinished, ...status } = unsigned.statusLine;
  assert.deepEqual(status, {
    headingNl: "Voorlopige status: C (eerste maatregelen genomen)",
    provisional: true,
    status: { "2.1": "C", "2.2": "C" },
    noteNl: "Deze status volgt uit de uitkomsten in dit rapport. Ze telt pas als een persoon met naam het rapport heeft afgetekend.",
  });
  assert.match(openNl, /^Open criteria: \d+[.,] /);
  assert.doesNotMatch(openNl, /\b0 (vraagt|vragen|is|zijn)\b/, "a reason that holds for no criterion is left out");
  assert.equal(typeof unfinished, "boolean");
  // The status that counts is still none, and the concept marks stay.
  assert.equal(unsigned.status["2.2"].status, "geen");
  const markdown = renderMarkdown(exampleEvaluation());
  assert.match(markdown, /^> \*\*Concept, niet afgetekend\*\*$/m);
  assert.match(markdown, /^> \*\*Voorlopige status: C \(eerste maatregelen genomen\)\*\*\. Deze status volgt uit de uitkomsten in dit rapport\./m);
  assert.ok(markdown.split("## Samenvatting")[1]!.split("\n## ")[0]!.includes("**Voorlopige status: C (eerste maatregelen genomen)**"));

  const withSignature = signed(exampleEvaluation());
  assert.deepEqual(deriveReport(withSignature).statusLine, { headingNl: "Status: C (eerste maatregelen genomen)", provisional: false, status: { "2.1": "C", "2.2": "C" }, noteNl: null, openNl, unfinished });
  assert.ok(!renderMarkdown(withSignature).includes("Voorlopige status"));

  const stale = signed(exampleEvaluation());
  stale.signature!.evaluationSha256 = "0".repeat(64);
  const line = deriveReport(stale).statusLine;
  assert.equal(line.headingNl, "Voorlopige status: C (eerste maatregelen genomen)");
  assert.ok(line.noteNl!.endsWith("De handtekening hoort bij een eerdere versie van dit onderzoek."));

  // The two versions of the norm each get their status when they differ.
  const differing = exampleEvaluation();
  differing.summary["2.1"].cantTell = 0;
  assert.equal(deriveReport(differing).statusLine.headingNl, "Voorlopige status: B (voldoet gedeeltelijk) voor WCAG 2.1, C (eerste maatregelen genomen) voor WCAG 2.2");
  const untested = exampleEvaluation();
  untested.summary["2.2"].untested = 1;
  untested.summary["2.1"].untested = 1;
  assert.equal(deriveReport(untested).statusLine.headingNl, "Voorlopige status: geen, het onderzoek dekt niet alle eisen");
});

test("the description of the website is a section of its own, and is left out when there is none", () => {
  assert.ok(!renderMarkdown(exampleEvaluation()).includes("Over deze website"));
  const evaluation = exampleEvaluation();
  evaluation.site.descriptionNl = "Dit is de website van een gemeente. Inwoners vragen er een vergunning aan.";
  const markdown = renderMarkdown(evaluation);
  const [before, after] = markdown.split("## Over deze website");
  // It opens the account of the evaluation: after what is wrong and how each criterion came out, before the facts of the evaluation.
  assert.ok(before!.includes("## Resultaten per criterium") && !before!.includes("## Onderzoeksgegevens"));
  assert.ok(after!.startsWith("\n\nDit is de website van een gemeente. Inwoners vragen er een vergunning aan.\n\n## Onderzoeksgegevens"));
});

test("the report goes from what is wrong and what to do, to how each criterion came out, to how the evaluation was made", () => {
  const evaluation = exampleEvaluation();
  evaluation.site.descriptionNl = "Dit is de website van een gemeente.";
  const chapters = [...renderMarkdown(evaluation).matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
  const order = ["Samenvatting", "Overzicht van de gebreken", "Wat nu", "Bevindingen per onderdeel", "Resultaten per criterium", "Over deze website", "Onderzoeksgegevens", "Scope", "Basisniveau van ondersteuning", "Steekproef", "Gereedschap", "Betrouwbaarheid en beperkingen", "Bijlage A: onderbouwing per criterium", "Bijlage B: herleidbaarheid"];
  assert.deepEqual(chapters.filter((chapter) => order.includes(chapter)), order);
  // What points at another chapter points the right way: the overview says the work list comes after it.
  const withDefects = renderMarkdown(weighed({ ...evaluation, defects: mergeFindings(evaluation) }));
  for (const match of withDefects.matchAll(/werklijst hierna/g)) assert.ok(match.index! < withDefects.indexOf("## Wat nu"), "\"de werklijst hierna\" staat voor de werklijst");
  // The scores per principle open the results; they are no longer in the summary.
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.indexOf("**WCAG 2.2 niveau A en AA") > markdown.indexOf("## Resultaten per criterium"));
  assert.ok(markdown.indexOf("**WCAG 2.2 niveau A en AA") < markdown.indexOf("### 1 Waarneembaar"));
});

const AGENT_MODELS: NonNullable<Evaluation["judgment"]["models"]> = [
  { role: "explorer", roleNl: "verkenner", agents: 1, models: [{ model: "voorbeeld-model-4.5[1m]", agents: 1 }], notGiven: 0 },
  { role: "judge", roleNl: "beoordelaar", agents: 4, models: [{ model: "voorbeeld-model-4.5[1m]", agents: 2 }, { model: "onbekend", agents: 1 }], notGiven: 1 },
  { role: "verifier", roleNl: "verifieerder", agents: 2, models: [{ model: "ander-model-2", agents: 2 }], notGiven: 0 },
];

test("the models the agents gave are counted per role from the session files and the answers of the gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "models-"));
  const session = (name: string, content: Record<string, unknown>): void => {
    mkdirSync(join(dir, "observations", name), { recursive: true });
    writeFileSync(join(dir, "observations", name, "session.json"), JSON.stringify({ session: name, ...content }));
  };
  session("verken", { models: ["voorbeeld-model-4.5[1m]"] });
  session("r-start", { models: ["voorbeeld-model-4.5[1m]"] });
  session("r-artikel", {});
  session("b-143", { models: ["voorbeeld-model-4.5[1m]"] });
  session("b-143-2", { models: ["Onbekend"] });
  // Started twice, the second time on another model: both count.
  session("v-143", { models: ["voorbeeld-model-4.5[1m]", "ander-model-2"] });
  // A session somebody started by hand has no role.
  session("main", { models: ["met-de-hand"] });
  mkdirSync(join(dir, "gate"));
  writeFileSync(join(dir, "gate", "answers.json"), JSON.stringify({ model: "ander-model-2", sheets: [] }));
  writeFileSync(join(dir, "gate", "answers-2.json"), JSON.stringify({ sheets: [] }));
  writeFileSync(join(dir, "gate", "answers.stamp.json"), JSON.stringify({ model: "telt niet" }));
  assert.deepEqual(await reportedModels(dir), [
    { role: "explorer", roleNl: "verkenner", agents: 1, models: [{ model: "voorbeeld-model-4.5[1m]", agents: 1 }], notGiven: 0 },
    { role: "gate", roleNl: "poort", agents: 2, models: [{ model: "ander-model-2", agents: 1 }], notGiven: 1 },
    { role: "walk", roleNl: "rondgang", agents: 2, models: [{ model: "voorbeeld-model-4.5[1m]", agents: 1 }], notGiven: 1 },
    { role: "judge", roleNl: "beoordelaar", agents: 2, models: [{ model: "onbekend", agents: 1 }, { model: "voorbeeld-model-4.5[1m]", agents: 1 }], notGiven: 0 },
    { role: "verifier", roleNl: "verifieerder", agents: 2, models: [{ model: "ander-model-2", agents: 1 }, { model: "voorbeeld-model-4.5[1m]", agents: 1 }], notGiven: 0 },
  ]);
  // A run without sessions has nothing to count.
  assert.deepEqual(await reportedModels(mkdtempSync(join(tmpdir(), "models-empty-"))), []);
});

test("the report shows per role which model each agent gave, and says so when the operator named another", () => {
  // Without what the agents gave, the report says what it always said.
  const without = renderMarkdown(withInstruments());
  assert.ok(without.includes("de toolbox legt niet zelf vast welk model draaide") && !without.includes("Model per rol"));

  const evaluation = withInstruments();
  evaluation.judgment.model = "voorbeeld-model-4.5[1m]";
  evaluation.judgment.models = AGENT_MODELS;
  const markdown = renderMarkdown(evaluation);
  const line = markdown.split("\n").find((candidate) => candidate.includes("Model per rol"))!;
  assert.ok(line.includes("Verkenner: voorbeeld-model-4.5") && line.includes("(1 keer)"));
  assert.ok(line.includes("onbekend (1 keer), niet opgegeven (1 keer)"));
  assert.ok(line.includes("Verifieerder: ander-model-2 (2 keer)"));
  assert.ok(line.includes("De toolbox legt dat vast en kan het niet controleren."));
  assert.ok(!markdown.includes("de toolbox legt niet zelf vast welk model draaide"));
  // Two of the five that named a model named another than the operator did; "onbekend" is no other model.
  assert.equal(deriveReport(evaluation).agentModels!.differsNl, "De uitvoerder gaf voorbeeld-model-4.5[1m] op. Dat verschilt van wat de agents opgaven: ander-model-2 (2 keer van de 5 opgaven met een naam).");
  assert.ok(line.includes("Dat verschilt van wat de agents opgaven"));

  // The same name in other capitals is the same model, and an operator who named nothing differs from nobody.
  evaluation.judgment.models = [AGENT_MODELS[0]!];
  evaluation.judgment.model = "Voorbeeld-Model-4.5[1m]";
  assert.equal(deriveReport(evaluation).agentModels!.differsNl, null);
  evaluation.judgment.models = AGENT_MODELS;
  evaluation.judgment.model = "niet opgegeven";
  assert.equal(deriveReport(evaluation).agentModels!.differsNl, null);

  // One model written in many ways is one model: the report says it once.
  const spelled = (role: "walk" | "judge", roleNl: string, models: string[]) => ({ role, roleNl, agents: models.length, models: models.map((model) => ({ model, agents: 1 })), notGiven: 0 });
  evaluation.judgment.model = "voorbeeld-model-4-5[1m]";
  evaluation.judgment.models = [
    spelled("walk", "rondgang", ["Voorbeeld Model 4.5 (1M context), voorbeeld-model-4-5[1m]", "voorbeeld-model-4-5[1m]"]),
    spelled("judge", "beoordelaar", ["Voorbeeld Model 4.5 (voorbeeld-model-4-5[1m])", "voorbeeld-model-4-5[1m] (Model 4.5, 1M context)"]),
  ];
  assert.deepEqual(deriveReport(evaluation).agentModels, { perRoleNl: ["Alle rollen: voorbeeld-model-4-5[1m] (4 keer)"], differsNl: null });
});

/** The example with what a whole run adds: a gate, measured states, a verifier who confirmed, added and dropped findings, and one verdict it changed. */
function withInstruments(): Evaluation {
  const evaluation = withDefects();
  evaluation.chain = { kind: "instruments", gate: { sufficient: true, checks: 9, checksPassed: 9, exploreRounds: 1, acceptedNl: ["P03: het menu opent niet met het toetsenbord. Dat is een eigenschap van de site."], limitationsNl: [] }, writes: { allowed: false, noteNl: "verzoeken die iets kunnen wijzigen zijn tegengehouden" } };
  evaluation.measuredStates = { P01: ["menu-open", "zoekvenster"], P02: ["menu-open"] };
  for (const criterion of evaluation.criteria) {
    criterion.challengeNl = "Met de Tab-toets is gezocht naar een element zonder focus; dat is niet gevonden.";
    for (const finding of criterion.findings) finding.verification = { status: "reproduced", evidence: ["v-0001"] };
  }
  const menu = evaluation.criteria.find((criterion) => criterion.id === "4.1.2")!;
  menu.findings[0]!.verification = { status: "unverified", evidence: [] };
  menu.droppedNl = ["Knop zonder naam (P02): niet opnieuw gezien. De knop heeft een aria-label."];
  const keyboard = evaluation.criteria.find((criterion) => criterion.id === "2.1.1")!;
  keyboard.rounds = { a: "passed", b: null, final: "cantTell" };
  return evaluation;
}

test("an evaluation is described as it was made: a judge and a verifier, both with instruments", () => {
  const evaluation = withInstruments();
  const derived = deriveReport(evaluation);
  const markdown = renderMarkdown(evaluation);
  // The report does not speak of two blind rounds: there are none.
  for (const phrase of ["Beoordeling A", "Beoordeling B", "A en B eens", "A en B oneens", "Niet beide beoordelingen", "twee keer los van elkaar", "Toetsing:", "na de toetsing"]) assert.ok(!markdown.includes(phrase), phrase);
  assert.deepEqual(derived.chain.stepsNl.map((step) => step.nameNl), ["Verkennen", "Meten", "Bewijspoort", "Rondgang", "Beoordelen", "Verifiëren", "Samenvoegen"]);
  assert.ok(markdown.includes("2. **Meten.** Scripts meten elke pagina van de steekproef, zoals ze laadt, ook op 320 pixels breed en in het donkere kleurenschema, en in de toestanden die de verkenner heeft vastgelegd (2 toestanden; bij de steekproef staat per pagina welke)."));
  // The second round is not called independent: it knows the first verdict and runs on the same model.
  assert.ok(!markdown.includes("tweede, onafhankelijke") && markdown.includes("Die ronde begint met een schone context en kent de eerste beoordeling: ze is een controle, geen tweede blinde beoordeling."));
  // The name of the model is what somebody typed in; the report says so.
  assert.ok(markdown.includes("- Beoordelend model, zoals opgegeven: ") && markdown.includes("de toolbox legt niet zelf vast welk model draaide)"));
  // One judge and a verifier: the trace has no column for a second judge.
  assert.ok(markdown.includes("| Criterium | Procedure | Dossier | Oordeel beoordelaar | Eindoordeel (verificatie) |") && !markdown.includes("Oordeel B"));
  // The pictures the gate had looked at are named only when somebody looked.
  assert.ok(!markdown.includes("overzichtsbladen"));
  const reviewed = withInstruments();
  reviewed.chain!.gate!.review = { sheets: 12, pageTypesWithoutSheet: 4 };
  assert.ok(renderMarkdown(reviewed).includes("Daarna heeft het model 12 overzichtsbladen met beelden van de paginatypen bekeken; van 4 paginatypen zijn de beelden niet bekeken. 9 van de 9 controles"));
  assert.ok(markdown.includes("9 van de 9 controles waren in orde en het bewijs is voldoende bevonden; 1 gat is aanvaard als eigenschap van de site."));
  assert.ok(markdown.includes("Wat de bewijspoort heeft vastgesteld:\n\n- P03: het menu opent niet met het toetsenbord."));
  // An accepted gap says who accepted it; a limitation, and a gate from before that was asked, do not.
  const gap = { page: "P03", missingNl: "Het menu ging op dit paginatype niet open.", reasonNl: "Het menu reageert hier op geen enkele klik" };
  assert.equal(gateLineNl({ ...gap, decidedBy: "verkenner" }), "P03: Het menu ging op dit paginatype niet open. Het menu reageert hier op geen enkele klik. Aanvaard door de verkenner, niet door een persoon.");
  assert.equal(gateLineNl({ ...gap, reasonNl: "Het menu reageert hier op geen enkele klik.", decidedBy: "persoon" }), "P03: Het menu ging op dit paginatype niet open. Het menu reageert hier op geen enkele klik. Aanvaard door een persoon, volgens het sitemodel; loep gaat dat niet na.");
  assert.equal(gateLineNl(gap), "P03: Het menu ging op dit paginatype niet open. Het menu reageert hier op geen enkele klik");
  assert.ok(markdown.includes("- Versturen van formulieren: Niet toegestaan: verzoeken die iets kunnen wijzigen zijn tegengehouden."));
  // Read requests are named only when there were any, with the address and the reason.
  assert.ok(!markdown.includes("Leesverzoeken:"));
  const searched = withInstruments();
  searched.chain!.reads = [{ method: "POST", origin: "https://zoek.example.nl", path: "/multi_search", service: "typesense", reasonNl: "Het zoekveld stuurt de zoekvraag naar de zoekdienst." }];
  assert.ok(renderMarkdown(searched).includes("- Leesverzoeken: één adres is toegelaten voor leesverzoeken: POST https://zoek.example.nl/multi\\_search, zoekvraag aan Typesense (Het zoekveld stuurt de zoekvraag naar de zoekdienst). Een verzoek daarheen ging alleen door als loep de body herkende als zoekvraag aan die dienst; elk ander verzoek dat iets kan wijzigen is tegengehouden."), renderMarkdown(searched).split("\n").find((line) => line.includes("Leesverzoeken")));
  // The rule engines are the tools, by name and version; the rest gathers evidence.
  assert.ok(markdown.includes("Hulpmiddelen in de zin van de methode zijn de regel-engines axe-core 4.13.0 en Alfa 0.119.0: zij draaien op elke pagina van de steekproef."));
  assert.ok(markdown.includes("Bij 1 criterium kwam de controle op een andere uitkomst dan de eerste beoordeling"));
  assert.ok(markdown.includes("Van de 7 bevindingen in dit rapport zijn er 6 bij de controle bevestigd (een tweede beoordelaar zag het gebrek zelf opnieuw, vanaf een verse pagina) en 1 bij de controle toegevoegd"));
  assert.ok(markdown.includes("1 bevinding uit de eerste beoordeling is vervallen; de reden staat per criterium in bijlage A."));
  // Per criterion and per finding.
  assert.equal(derived.briefs["2.1.1"]!.certaintyNl, "De eerste beoordeling kwam op voldoet, de controle op kan niet bepalen.");
  assert.equal(derived.briefs["4.1.2"]!.certaintyNl, "De eerste beoordeling en de controle komen op dezelfde uitkomst. 1 bevinding bij de controle bevestigd, 1 bevinding toegevoegd bij de controle, 1 bevinding uit de eerste beoordeling vervallen, zie bijlage A.");
  assert.ok(markdown.includes("- Controle: Bij de controle bevestigd") && markdown.includes("- Controle: Toegevoegd bij de controle, één keer gezien"));
  const appendix = markdown.split("## Bijlage A: onderbouwing per criterium")[1]!;
  assert.ok(appendix.includes("Eerste beoordeling: Voldoet. Controle, tevens eindoordeel: Kan niet bepalen."));
  assert.ok(appendix.includes("Poging om het oordeel onderuit te halen: Met de Tab-toets is gezocht"));
  assert.ok(appendix.includes("Vervallen bij de controle:\n\n- Knop zonder naam (P02): niet opnieuw gezien."));
});

test("a weighing that counts is named as a step of the method, in the type of evaluation and in what the model did", () => {
  const STEP = "Per bevinding legt een taalmodel vast welke groepen bezoekers ze hindert en wat er voor elke groep gebeurt. Daarbij staat ook of bezoekers dit deel nodig hebben voor een kerntaak van de site. Het model werkt vanuit de bevindingen en bezoekt de site niet; de ernst in het rapport volgt met een vaste tabel uit wat het vastlegde.";
  const SENTENCE = "Daarna heeft een taalmodel per bevinding gewogen wie ze hindert; daaruit volgt de ernst.";
  const evaluation = weighed(withDefects());
  const steps = deriveReport(evaluation).chain.stepsNl;
  assert.deepEqual(steps.at(-1), { nameNl: "Wegen", textNl: STEP });
  assert.equal(steps.at(-2)!.nameNl, "Samenvoegen");
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes(`**Wegen.** ${STEP}`));
  assert.ok(markdown.includes(`en in een tweede ronde elk oordeel gecontroleerd. ${SENTENCE} "Voldoet" betekent`));
  assert.ok(markdown.includes(`- Type onderzoek: ${evaluation.method.typeNl} ${SENTENCE}`));
  // The stored type stays as evaluate wrote it: the weighing comes after.
  assert.ok(!evaluation.method.typeNl.includes(SENTENCE));
  const html = renderHtml(evaluation);
  assert.ok(html.includes("<strong>Wegen.</strong>") && html.includes("daaruit volgt de ernst"));
  assert.equal(html.split(SENTENCE.replace(/;.*/, "")).length - 1, 2, "the HTML report names the weighing in the type and in what the model did");
  // A weighing that is not applied did not set the severity, and an evaluation without one says nothing of it.
  const stale = withDefects();
  stale.weighing = { status: "stale", reason: "findings" };
  for (const other of [stale, withDefects()]) {
    assert.ok(!deriveReport(other).chain.stepsNl.some((step) => step.nameNl === "Wegen"));
    assert.ok(!renderMarkdown(other).includes(SENTENCE) && !renderHtml(other).includes("<strong>Wegen.</strong>"));
  }
});

test("a line of the gate about a place outside the sample names its address in the sentence", () => {
  const url = "https://voorbeeld.nl/zoeken?pagina=2";
  assert.equal(gateLineNl({ page: null, url, missingNl: "Deze pagina laadde niet tijdens de inventaris en is niet onderzocht (failed to load: page.goto: Timeout 45000ms exceeded.)." }), `De pagina ${url} laadde niet tijdens de inventaris en is niet onderzocht (failed to load: page.goto: Timeout 45000ms exceeded.).`);
  assert.equal(gateLineNl({ page: null, url, missingNl: "Dit ingesloten venster is niet los gemeten (timeout)." }), `Het ingesloten venster ${url} is niet los gemeten (timeout).`);
  assert.equal(gateLineNl({ page: null, url, missingNl: "Dit adres is geen pagina: de browser bood het aan als download." }), `Het adres ${url} is geen pagina: de browser bood het aan als download.`);
  // A text that does not point at its place gets the address as a sentence of its own, before the reason of an accepted gap.
  assert.equal(gateLineNl({ page: null, url, missingNl: "In deze toestand zijn geen losse toetsen ingedrukt", reasonNl: "De site reageert niet op toetsen.", decidedBy: "verkenner" }), `In deze toestand zijn geen losse toetsen ingedrukt. Dit gaat over ${url}. De site reageert niet op toetsen. Aanvaard door de verkenner, niet door een persoon.`);
  // A page of the sample keeps its label, and a line without an address stays as it was.
  assert.equal(gateLineNl({ page: "P03", url, missingNl: "Deze pagina is 20000 pixels hoog." }), "P03: Deze pagina is 20000 pixels hoog.");
  assert.equal(gateLineNl({ page: null, url: null, missingNl: "De contrastmeting (contrast) heeft niet gedraaid." }), "De contrastmeting (contrast) heeft niet gedraaid.");
});

test("a finding that touches an element of the vendor keeps its owner and is listed per element", () => {
  const vendor = { tagPrefixes: ["nldd-"], nameNl: "designsysteem" };
  // The innermost element of the vendor around the target, not every wrapper the page sits in.
  assert.deepEqual(vendorTagsOf({ locations: [{ where: "kop 'Doel', nldd-title zonder kopniveau" }], targets: [{ path: ["html > body > nldd-page > nldd-list > nldd-list-item[current]", "div > a"] }] }, vendor), ["nldd-list-item", "nldd-title"]);
  assert.deepEqual(vendorTagsOf({ locations: [{ where: "#content > p:nth-of-type(8) > a.my-nldd-link, aria-label" }] }, vendor), []);
  const evaluation = exampleEvaluation();
  evaluation.vendor = vendor;
  const finding = evaluation.criteria.flatMap((criterion) => criterion.findings)[0]!;
  const owner = finding.owner;
  finding.vendorTags = ["nldd-title"];
  const { todo } = deriveReport(evaluation);
  assert.deepEqual(todo.vendor, { nameNl: "designsysteem", elements: [{ tag: "nldd-title", findingIds: [finding.id] }] });
  assert.ok(todo.fix.find((group) => group.owner === owner)!.findingIds.includes(finding.id), "the owner the judge named stays");
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("### Raakt een component van designsysteem") && markdown.includes("Raakt een element van de leverancier: `nldd-title`"));
  assert.equal(deriveReport(exampleEvaluation()).todo.vendor, null);
});

test("the owner follows the code: an advice about the inside of a component of the vendor is for the vendor", () => {
  const vendor = { tagPrefixes: ["nldd-"], nameNl: "designsysteem" };
  const base = exampleEvaluation().criteria.flatMap((criterion) => criterion.findings)[0]!;
  const marked = (extra: Partial<ReportFinding>): ReportFinding => {
    const finding: ReportFinding = { ...structuredClone(base), owner: "techniek", locations: [{ page: "P01", where: "titel van het venster" }], ...extra };
    delete finding.vendorTags;
    markVendor(finding, vendor);
    return finding;
  };
  const inTitleBar = [{ page: "P01", path: ["#venster > nldd-page > nldd-top-title-bar", "div > h2"], state: null }];
  // The advice names the component and the observation lies in its shadow tree.
  const title = marked({ fixNl: "Laat de titel in `nldd-top-title-bar` afbreken: geen `white-space: nowrap` op de kop.", targets: inTitleBar });
  assert.deepEqual([title.owner, title.judgedOwner, title.ownerReasonNl, title.vendorTags], ["leverancier", "techniek", "de oplossing noemt nldd-top-title-bar en de waarneming ligt in de schaduwboom van dat element", ["nldd-top-title-bar"]]);
  // The advice names a class that exists only inside the component the finding touches.
  const announcer = marked({ owner: "design", fixNl: "Vul de bestaande `div.list__polite-announcer` na elke zoekactie.", locations: [{ page: "P01", where: "zoekvenster, nldd-list#resultaten" }] });
  assert.deepEqual([announcer.owner, announcer.judgedOwner, announcer.ownerReasonNl], ["leverancier", "design", "de oplossing noemt .list__polite-announcer, een deel in de schaduwboom van nldd-list"]);
  assert.equal(marked({ fixNl: "Zet de tekst in `nldd-list >>> div.announcer`." }).owner, "leverancier");
  // Clicking a button of the vendor is how the site's own form was tried, not where its defect is.
  const form = marked({ fixNl: "Pas de controle met `match` alleen toe als het veld is ingevuld.", targets: [{ page: "P01", path: ["#verstuur > nldd-button", "button"], state: null }] });
  assert.deepEqual([form.owner, form.judgedOwner, form.ownerReasonNl, form.vendorTags], ["techniek", undefined, undefined, ["nldd-button"]]);
  // A component named as the thing to use is within reach of the site, and so is a class of the site itself.
  assert.equal(marked({ fixNl: "Toon de fout met `nldd-validation-list`, zoals in het andere formulier.", targets: [{ page: "P01", path: ["#naam > nldd-text-field", "input"], state: null }] }).owner, "techniek");
  assert.equal(marked({ fixNl: "Geef `ul.list` in de voettekst een naam.", locations: [{ page: "P01", where: "nldd-list in de voettekst" }] }).owner, "techniek");
  // An advice that also says what the site can do itself leaves the owner to the judge.
  assert.equal(marked({ fixNl: "Laat `nldd-top-title-bar` de titel afbreken. Binnen eigen bereik: geef het venster een kortere titel.", targets: inTitleBar }).owner, "techniek");
  // What the judge already gave to the vendor stays as it is, without a second owner.
  assert.deepEqual([marked({ owner: "leverancier", fixNl: title.fixNl, targets: inTitleBar }).judgedOwner], [undefined]);
});

test("no deviation found but not fully measured is shown as an outcome of its own and still counts as open", () => {
  const plain = exampleEvaluation();
  const evaluation = exampleEvaluation();
  const criterion = evaluation.criteria.find((entry) => entry.outcome === "cantTell" && entry.versions.includes("2.1"))!;
  criterion.missingNl = ["veegronde mist: de meting op 320 pixels breed.", "budget op: het menu op P04 is niet geopend."];
  criterion.nothingFound = { coverageNl: "gemeten op 9 van 29 pagina's en in 4 van 12 toestanden; geen verschil gevonden" };
  const derived = deriveReport(evaluation);
  // The data keep "cantTell"; the report shows it apart and counts it apart.
  assert.equal(criterion.outcome, "cantTell");
  assert.equal(derived.shown[criterion.id], "nothingFound");
  assert.deepEqual(derived.outcomeOrder, ["passed", "failed", "inapplicable", "nothingFound", "cantTell", "untested"]);
  assert.equal(derived.tally["2.2"].nothingFound, 1);
  assert.equal(derived.tally["2.2"].cantTell, evaluation.summary["2.2"].cantTell - 1);
  assert.equal(derived.status["2.2"].status, deriveReport(plain).status["2.2"].status);
  assert.ok(derived.statusSentenceNl.includes("(bij 1 daarvan is geen afwijking gevonden, maar is niet alles gemeten)"));

  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("| Principe | ● Voldoet | ✕ Voldoet niet | − Niet van toepassing | ◐ Geen afwijking gevonden, niet volledig gemeten | ? Kan niet bepalen | ○ Niet beoordeeld | Totaal |"));
  assert.ok(markdown.includes("| **Totaal** | **31** | **5** | **15** | **1** | **3** | **0** | **55** |"));
  assert.ok(markdown.includes(`](#sc-${criterion.id}) | ${criterion.level} | ◐ Geen afwijking gevonden, niet volledig gemeten |`));
  assert.ok(markdown.includes("**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten"));
  assert.ok(markdown.includes("Dekking: gemeten op 9 van 29 pagina's en in 4 van 12 toestanden; geen verschil gevonden"));
  assert.ok(markdown.includes("is ook open en telt niet mee als \"Voldoet\""));
  // In the work list it stands with what the toolbox measures next time, with what was measured.
  const worklist = markdown.split("### Nog uitzoeken")[1]!.split("\n## ")[0]!;
  const toolboxPart = worklist.split("**Dit meet de toolbox een volgende keer**")[1]!;
  assert.ok(toolboxPart.includes(`](#sc-${criterion.id}) (geen afwijking gevonden, niet volledig gemeten): 2 punten (1 keer dekking ontbrak, 1 keer de tijd voor het meten was op), zie [bijlage A](#bijlage-${criterion.id}). Dekking: gemeten op 9 van 29`));
  // An evaluation without the field reads as before.
  const before = renderMarkdown(plain);
  assert.ok(!before.includes("niet volledig gemeten") && !before.includes("◐"));
  assert.deepEqual(deriveReport(plain).outcomeOrder, ["passed", "failed", "inapplicable", "cantTell", "untested"]);
});

test("a function that works for nobody gets the highest severity and stands first", () => {
  const evaluation = exampleEvaluation();
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  // An evaluation with the three older steps renders as it is.
  assert.ok(findings.every((finding) => ["hoog", "midden", "laag"].includes(finding.severity)));
  const blocking = findings.filter((finding) => finding.severity !== "hoog").at(-1)!;
  blocking.severity = "blokkerend";
  const derived = deriveReport(evaluation);
  assert.equal(derived.topFindingIds[0], blocking.id);
  assert.equal(derived.todo.fix.find((group) => group.owner === blocking.owner)!.findingIds[0], blocking.id);
  assert.ok(renderMarkdown(evaluation).includes(`- blokkerend: [${blocking.id}](#${blocking.id})`));
  // In a defect the highest severity among its findings counts.
  const grouped = exampleEvaluation();
  grouped.criteria.flatMap((criterion) => criterion.findings).at(-1)!.severity = "blokkerend";
  const merged = mergeFindings(grouped);
  assert.equal(merged.filter((defect) => defect.severity === "blokkerend").length, 1);
});

test("the summary shows a whole step of severity or none of it, and says what it leaves out", () => {
  const evaluation = exampleEvaluation();
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  // Few findings: the two highest steps that occur, all of them.
  const few = deriveReport(evaluation);
  const steps = [...new Set(few.topFindingIds.map((id) => findings.find((finding) => finding.id === id)!.severity))];
  assert.deepEqual(steps, ["hoog", "midden"]);
  assert.equal(few.topFindingIds.length, findings.filter((finding) => finding.severity !== "laag").length);
  // Six of one step are six in the summary, not five: no silent limit.
  const defects = withDefects();
  const base = defects.defects![0]!;
  defects.defects = [...Array.from({ length: 6 }, (_unused, index) => ({ ...base, id: `VRB-G-m${index}`, severity: "midden" as const })), ...Array.from({ length: 11 }, (_unused, index) => ({ ...base, id: `VRB-G-l${index}`, severity: "laag" as const }))];
  const many = deriveReport(defects).defects!;
  assert.deepEqual(many.topIds, defects.defects.slice(0, 6).map((defect) => defect.id));
  assert.ok(many.topNoteNl.startsWith("Hier staan de 6 gebreken met ernst midden; een hogere ernst komt niet voor. De andere 11 gebreken (11 met ernst laag) staan in de werklijst hierna."));
  assert.ok(renderMarkdown(defects).split("### Zwaarste gebreken")[1]!.split("### ")[0]!.includes(many.topNoteNl));
  // Everything shown: the note says so.
  defects.defects = defects.defects.slice(0, 6);
  assert.ok(deriveReport(defects).defects!.topNoteNl.startsWith("Hier staan alle 6 gebreken."));
});

test("the report names the speech model with its sha256: short in the table, in full under traceability", () => {
  const evaluation = exampleEvaluation();
  const hash = "1be3a9b2".padEnd(64, "c");
  evaluation.instruments = [
    { implementation: "ffmpeg", version: "8.0.1", licence: "LGPL-2.1-or-later", usedForNl: ["video en geluid"], measurements: 2 },
    { implementation: "whisper.cpp", version: `1.9.5 ggml-small.bin sha256:${hash}`, licence: "MIT", usedForNl: ["video en geluid"], measurements: 2 },
  ];
  const derived = deriveReport(evaluation);
  assert.deepEqual(derived.instrumentVersions, ["8.0.1", "1.9.5 ggml-small.bin sha256 1be3a9b2"]);
  assert.deepEqual(derived.speechModels, [{ name: "ggml-small.bin", sha256: hash }]);
  const markdown = renderMarkdown(evaluation);
  assert.ok(markdown.includes("| `whisper.cpp` | 1.9.5 ggml-small.bin sha256 1be3a9b2 | video en geluid | 2 |"));
  assert.ok(markdown.includes(`Hash van het spraakmodel ggml-small.bin: \`${hash}\``));
  // A run from before the hash was kept shows the name of the model as it did, and no hash.
  evaluation.instruments[1]!.version = "1.7.6 ggml-small.bin";
  const older = renderMarkdown(evaluation);
  assert.ok(older.includes("| `whisper.cpp` | 1.7.6 ggml-small.bin | video en geluid | 2 |"));
  assert.ok(!older.includes("Hash van het spraakmodel"));
  assert.deepEqual(deriveReport(exampleEvaluation()).speechModels, []);
});

test("the list of tools names every browser with the version that ran and what it was used for, and invents none", () => {
  const method = (implementation: string, version: string, extra: Record<string, unknown> = {}) => ({ method: implementation === "webkit" || implementation === "firefox" ? "keyboard-walk" : "rule-engine", implementation, version, result: {}, ...extra });
  const records = new Map<string, { command: string; result: unknown }>([
    ["a-0001", { command: "taborder", result: { methods: [method("chromium", "153.0.8010.12"), method("webkit", "26.0 build 2359")], pending: ["firefox-tab"] } }],
    ["a-0002", { command: "name", result: { methods: [method("axe-core", "4.13.0")], pending: ["webkit"] } }],
    // The answer of WebKit came in after `name` had returned: it is in the record of `wait` and counts for `name`, once.
    ["a-0003", { command: "wait", result: { completed: [{ completes: "a-0002", command: "name", result: { methods: [method("axe-core", "4.13.0"), { ...method("webkit", "26.0 build 2359"), method: "browser-accessibility-tree" }] } }] } }],
    // A browser that did not answer was not used.
    ["a-0004", { command: "taborder", result: { methods: [method("chromium", "153.0.8010.12")], failed: [{ ...method("firefox", "155.0 build 1543"), kind: "unavailable" }] } }],
  ]);
  const second = secondBrowserUse(records);
  assert.deepEqual(second.map((entry) => [entry.browser, entry.version, [...entry.commands].sort(), entry.count]), [["webkit", "26.0 build 2359", ["name", "taborder"], 2]]);
  const evaluation = exampleEvaluation();
  evaluation.browsers = browserUse(evaluation.toolchain.browser.version, second);
  assert.deepEqual(deriveReport(evaluation).browsersNl, [
    "Chromium (Chrome for Testing) 153.0.8010.12 (motor Blink): alle metingen",
    "WebKit 26.0 build 2359 (motor WebKit): tweede mening voor de toegankelijke naam en rol en de Tab-volgorde (2 metingen)",
    "Firefox (motor Gecko): niet gebruikt in dit onderzoek",
  ]);
  const line = renderMarkdown(evaluation).split("\n").find((entry) => entry.startsWith("- Browsers: "))!;
  assert.ok(line.includes("WebKit 26.0 build 2359") && line.endsWith("Firefox (motor Gecko): niet gebruikt in dit onderzoek"), line);
  assert.ok(!/Firefox \d/.test(line), "no version is shown for a browser that did not run");
  // An evaluation from before the browsers were kept names the one browser of its manifest, with a capital as a name has.
  assert.ok(renderMarkdown(exampleEvaluation()).includes("\n- Browser: Chromium 153.0.8010.12\n"));
});

test("the open count across both WCAG versions names the criteria in one version only, so it adds up with the summary sentence", () => {
  const evaluation = exampleEvaluation();
  const OPEN = ["2.5.2", "3.3.8", "4.1.1"];
  const criteria = evaluation.criteria.map((criterion) => ({ ...criterion, outcome: OPEN.includes(criterion.id) ? ("untested" as const) : ("passed" as const), missingNl: [] }));
  assert.deepEqual(
    OPEN.map((id) => criteria.find((criterion) => criterion.id === id)?.versions),
    [["2.1", "2.2"], ["2.2"], ["2.1"]],
  );
  const derived = deriveReport({ ...evaluation, criteria, summary: summarise(criteria) });
  // Three open across both versions; the summary sentence speaks of WCAG 2.2 alone, where 4.1.1 does not exist.
  assert.match(derived.statusLine.openNl, /^Open criteria: 3, door dit onderzoek niet vastgesteld \(2\.5\.2, 3\.3\.8 alleen in WCAG 2\.2, 4\.1\.1 alleen in WCAG 2\.1\)\. /);
  assert.match(derived.statusSentenceNl, /van WCAG 2\.2 niveau A en AA, maar van de \d+ criteria zijn er 2 nog open\./);
  assert.equal(idsAcrossVersionsNl(["1.1.1"], criteria), "1.1.1", "a criterion in both versions stays as it is");
});

test("the evaluation and the metadata of the PDF say, readable by a machine, that a language model drafted the verdicts", async (context) => {
  const mark = aiGeneratedMark({ model: "voorbeeldmodel", models: AGENT_MODELS }, [{ id: "1.4.5", established: { by: "person", noteNl: "Vastgesteld door een persoon." } }, { id: "1.4.3", established: { by: "verification", noteNl: "Vastgesteld bij de controle." } }]);
  // Each model once; "onbekend" names none.
  assert.deepEqual(mark, { models: ["ander-model-2", "voorbeeld-model-4.5[1m]", "voorbeeldmodel"], humanReview: { signature: "signed/signature.json", criteriaByPerson: ["1.4.5"] } });
  const evaluation = { ...exampleEvaluation(), aiGenerated: mark };
  assert.deepEqual(deriveReport(evaluation).aiKeywords, ["AI-generated", "AI-model: ander-model-2", "AI-model: voorbeeld-model-4.5[1m]", "AI-model: voorbeeldmodel"]);
  // An evaluation from before the mark was kept was made by a language model as well.
  assert.deepEqual(deriveReport(exampleEvaluation()).aiKeywords, ["AI-generated", `AI-model: ${exampleEvaluation().judgment.model}`]);

  const dir = mkdtempSync(join(tmpdir(), "render-ai-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  for (const pdf of [result.pdf, result.shortPdf!]) {
    const info = await tool("pdfinfo", [pdf]);
    if (!info.found) return context.skip("pdfinfo is not installed");
    assert.match(info.stdout, /^Keywords:\s+.*AI-generated, AI-model: ander-model-2, AI-model: voorbeeld-model-4\.5\[1m\], AI-model: voorbeeldmodel$/m);
  }
});

test("the report always says how accurate this version of loep is: measured as a whole, or not", async (context) => {
  // Without a measurement of this version, the fixed sentence; an evaluation from before the field was kept says the same.
  for (const evaluation of [exampleEvaluation(), { ...exampleEvaluation(), versionAccuracy: null }]) {
    const markdown = renderMarkdown(evaluation);
    const block = markdown.split("## Betrouwbaarheid en beperkingen")[1]!.split("\n## ")[0]!;
    assert.ok(block.includes(`### Nauwkeurigheid van deze versie\n\n${VERSION_NOT_MEASURED_NL}\n`), "the block stands under Betrouwbaarheid en beperkingen");
  }
  const measured = { ...exampleEvaluation(), versionAccuracy: { version: "0.0.1", measuredAt: "2026-10-18", againstNl: "het oordeel van een menselijke deskundige op drie sites", resultNl: "Bij 41 van de 50 criteria kwam loep op dezelfde uitkomst; 3 afkeuringen van de deskundige vond loep niet." } };
  assert.ok(renderMarkdown(measured).includes("### Nauwkeurigheid van deze versie\n\nDeze versie van loep (0.0.1) is het laatst als geheel gemeten op 18 oktober 2026, tegen het oordeel van een menselijke deskundige op drie sites. Uitkomst: Bij 41 van de 50 criteria"));

  // evaluate reads the file of its own version; without one there is no measurement, and a wrong file stops it.
  const versions = mkdtempSync(join(tmpdir(), "versies-"));
  assert.equal(readVersionAccuracy("0.0.1", versions), null);
  writeFileSync(join(versions, "0.0.1.json"), JSON.stringify(measured.versionAccuracy));
  assert.deepEqual(readVersionAccuracy("0.0.1", versions), measured.versionAccuracy);
  writeFileSync(join(versions, "0.0.2.json"), JSON.stringify({ ...measured.versionAccuracy, measuredAt: "oktober" }));
  assert.throws(() => readVersionAccuracy("0.0.2", versions), /version must be "0\.0\.2".*measuredAt must be a date/);

  // The PDF has the block too.
  const dir = mkdtempSync(join(tmpdir(), "render-accuracy-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(exampleEvaluation()));
  const result = await render(dir);
  if (result.pdf === null) return context.skip("Typst is not installed");
  const text = await tool("pdftotext", [result.pdf, "-"]);
  if (!text.found) return context.skip("pdftotext is not installed");
  const flat = text.stdout.replace(/\s+/g, " ");
  assert.ok(flat.includes("Nauwkeurigheid van deze versie"));
  assert.ok(flat.includes(VERSION_NOT_MEASURED_NL));
});

test("a session counts as one in which a real screen reader read aloud only when VoiceOver answered without an error", () => {
  const record = (id: string, methods: unknown[]) => [id, { id, command: "voiceover", result: { methods } }] as const;
  const records = new Map([
    record("b-131-0001", [{ method: "voiceover", implementation: "voiceover", version: "macOS 15" }]),
    record("v-131-0001", [{ method: "voiceover", implementation: "voiceover", error: "geen virtuele Mac" }]),
    record("b-143-0001", [{ method: "contrast", implementation: "loep" }]),
  ]);
  assert.deepEqual([...voiceOverSessions(records)], ["b-131"]);
});

test("a reading by VoiceOver of a test page whose scripts did not load is no use of a screen reader", () => {
  const voiceover = { method: "screen-reader", implementation: "voiceover", version: "macOS 26.4 (25E246), Safari 26.4, node v24.21.0" };
  const reading = (id: string, scripts: { url: string; module: boolean; held?: boolean }[]) =>
    [id, { id, command: "voiceover", result: { methods: [voiceover], testPage: { loaded: { custom: 3, undefined: scripts.length > 0 ? 3 : 0, names: [], scripts } } } }] as const;
  const records = new Map([
    reading("b-131-0001", [{ url: "https://site.example/app.js", module: true }]),
    reading("b-143-0001", [{ url: "https://elders.example/lib.js", module: true, held: true }]),
  ]);
  assert.deepEqual([...voiceOverSessions(records)], []);
  const without = implementationUse(records);
  assert.deepEqual(without, []);
  assert.deepEqual(screenReaderUse(without).assistiveTechnology, []);

  // With the scripts in, the same reading counts: in its session, in the instruments and as assistive technology.
  records.set(...reading("b-150-0001", []));
  assert.deepEqual([...voiceOverSessions(records)], ["b-150"]);
  const used = implementationUse(records);
  assert.deepEqual(used.map((entry) => [entry.implementation, entry.measurements]), [["voiceover", 1]]);
  assert.equal(screenReaderUse(used).assistiveTechnology.length, 1);
});
