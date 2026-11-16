import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSummary, summarize, summaryLineNl } from "../src/commands/summarize.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import { SUMMARY_WORDS_MAX, validateSummary, type SummaryProposal } from "../src/lib/executive-summary.ts";
import { renderHtml } from "../src/lib/report-html.ts";
import { deriveReport, renderMarkdown, summarySourceText } from "../src/lib/report-markdown.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { weighed } from "./fixtures/weighed.ts";

/** The example with its defects and a weighing: two groups are stopped, five criteria failed, four are open, status C. */
const example = (): Evaluation => {
  const evaluation = exampleEvaluation();
  evaluation.defects = mergeFindings(evaluation);
  return weighed(evaluation);
};
const STOPPING = ["VRB-G-9fc8", "VRB-G-0518", "VRB-G-e7cb", "VRB-G-69e6"];

const good = (): SummaryProposal => ({
  model: "voorbeeld-model-5",
  paragraphs: [
    { textNl: "De site van Voorbeeldgemeente voldoet niet aan WCAG 2.2 niveau A en AA, de norm voor toegankelijkheid. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en daaruit volgt status C.", sources: ["status"] },
    { textNl: "Mensen die niet zien kunnen geen vergunning aanvragen, omdat de knop om te versturen voor hen geen naam heeft. Mensen die slecht zien stranden op grijze hulptekst en een zoekveld zonder naam.", sources: ["vastlopen", "VRB-G-e7cb", "VRB-G-9fc8"] },
    { textNl: "Herstel eerst het formulier voor de vergunning. Over 4 criteria is niets vastgesteld; ook daar kan een groep vastlopen.", sources: ["wat-nu", "open"] },
  ],
});

const problemsOf = (change: (proposal: SummaryProposal) => void, evaluation = example()): string[] => {
  const proposal = good();
  change(proposal);
  return validateSummary(proposal, evaluation, summarySourceText(evaluation), STOPPING);
};

test("a summary that keeps to the report passes", () => {
  assert.deepEqual(problemsOf(() => undefined), []);
});

test("the check holds a summary to the report: length, form, numbers, status and what it rests on", () => {
  const refused = (name: string, change: (proposal: SummaryProposal) => void, reason: RegExp): void => {
    const problems = problemsOf(change);
    assert.ok(problems.some((problem) => reason.test(problem)), `${name}: ${problems.join(" | ") || "geen probleem gemeld"}`);
  };
  const first = (text: string) => (proposal: SummaryProposal) => void (proposal.paragraphs[0]!.textNl = text);
  const add = (text: string) => (proposal: SummaryProposal) => void (proposal.paragraphs[2]!.textNl += ` ${text}`);

  refused("too long", add("woord ".repeat(SUMMARY_WORDS_MAX).trim()), new RegExp(`hooguit ${SUMMARY_WORDS_MAX}`));
  refused("one paragraph", (proposal) => void proposal.paragraphs.splice(1), /het zijn er 2 tot 4/);
  refused("a number that is not in the report", add("Dat raakt 37 pagina's."), /het getal 37 staat niet in het rapport/);
  refused("another status", first("De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald, en daaruit volgt status B."), /noemt status B; het rapport komt uit op status C/);
  refused("no status", first("De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald en 4 open."), /noemt status C niet/);
  refused("says the site conforms", first("De site voldoet aan WCAG 2.2 niveau A en AA, op 5 van de 55 criteria na. Daaruit volgt status C."), /voldoet niet|zegt dat de site voldoet/);
  refused("softens", add("Over het algemeen is de site goed te gebruiken."), /"over het algemeen" maakt kleiner/);
  refused("speaks for every visitor", add("Niemand merkt daar iets van."), /"niemand"/);
  refused("a failure called formal", add("Dat is een formele afwijking."), /"formele"/);
  refused("a criterion by its number", add("Dat is criterium 1.4.3."), /niet met het nummer 1\.4\.3/);
  refused("words of the evaluation itself", add("De beoordelaar zag dat in de veegronde."), /"beoordelaar" is een woord van het onderzoek zelf/);
  // The summary stands in the signed report as it was written: it says nothing about signing.
  refused("about signing", add("De status is voorlopig."), /"voorlopig" gaat over het tekenen/);
  refused("a dash", add("Het formulier — het belangrijkste deel — werkt niet."), /gedachtestreepje/);
  refused("brackets", add("Het formulier (voor de vergunning) werkt niet."), /zonder haakjes/);
  refused("a list", first("- De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en daaruit volgt status C."), /lopende tekst/);
  refused("emphasis", add("Dat is **het zwaarste** gebrek."), /lopende tekst/);
  refused("an address", add("Zie https://voorbeeld.example/contact."), /noem geen adres/);
  refused("no source", (proposal) => void (proposal.paragraphs[1]!.sources = []), /sources is leeg/);
  refused("a source that is not in the report", (proposal) => void proposal.paragraphs[1]!.sources.push("VRB-G-0000"), /"VRB-G-0000" in sources is geen gebrek of criterium/);
  // The norm by its name: "the norm for accessibility" alone does not say against what the site was held.
  refused("the norm not named", first("De site van Voorbeeldgemeente voldoet niet aan de norm voor toegankelijkheid. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en daaruit volgt status C."), /noemt de norm niet; zeg één keer in een zin "WCAG 2\.2 niveau A en AA"/);
  // A defect without who it hinders.
  refused("a defect without a group", (proposal) => void (proposal.paragraphs[1]!.textNl = "De knop om de aanvraag te versturen heeft geen naam. Grijze hulptekst is slecht te lezen."), /noemt niet voor wie het geldt/);
  // A group is stopped at a core task: a paragraph rests on a defect that stops it.
  refused("silent about who is stopped", (proposal) => void (proposal.paragraphs[1]!.sources = ["groepen"]), /een groep bezoekers loopt vast bij een kerntaak/);
  // Open criteria stay open: a paragraph says what was not established.
  refused("silent about what is open", (proposal) => void (proposal.paragraphs[2]!.sources = ["wat-nu"]), /het rapport heeft open criteria/);
});

test("without paragraphs there is one problem, and it says what is missing", () => {
  const evaluation = example();
  assert.deepEqual(validateSummary({}, evaluation, summarySourceText(evaluation)), ['het antwoord heeft geen lijst "paragraphs"']);
});

test("a criterion of the report may be a source, and a number written with a dot is the same number", () => {
  assert.deepEqual(problemsOf((proposal) => void proposal.paragraphs[1]!.sources.push("1.4.3")), []);
  const evaluation = example();
  const proposal = good();
  proposal.paragraphs[2]!.textNl += " Het nummer 1400 staat in een plaatje.";
  assert.deepEqual(validateSummary(proposal, evaluation, `${summarySourceText(evaluation)}\nBel 1.400 voor vragen.`, STOPPING), []);
});

test("what the writer reads is the report without its appendices and without what changes with every evaluation", () => {
  const evaluation = example();
  const text = summarySourceText(evaluation);
  assert.match(text, /^# Toegankelijkheidsonderzoek Voorbeeldgemeente/);
  for (const chapter of ["## Samenvatting", "## Wat nu", "## Resultaten per criterium", "## Betrouwbaarheid en beperkingen"]) assert.ok(text.includes(chapter), chapter);
  for (const left of ["## Bijlage A", "## Bijlage B", "Versie van de evaluatie", "Gemaakt met loep", "Datum van het onderzoek"]) assert.ok(!text.includes(left), left);
  // The same text with a summary in the evaluation, and after the evaluation was made again on another day.
  const later: Evaluation = { ...evaluation, evaluatedAt: "2026-10-12T09:30:00.000Z", executiveSummary: { status: "applied", paragraphs: ["Een tekst."], sources: [["status"]], templateSha256: "a", proposalSha256: "b" } };
  assert.equal(summarySourceText(later), text);
});

test("summarize writes the task and the report, and puts in only a summary that was checked for this report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-summary-"));
  try {
    const path = join(dir, "evaluation.json");
    writeFileSync(path, canonicalJson(example()));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ steps: [] }));
    const read = (): Evaluation => ({ ...(JSON.parse(readFileSync(path, "utf8")) as Evaluation), signature: null });

    // No summary yet: the task and the report as text are there, the evaluation has none.
    const first = await summarize(dir);
    assert.equal(first.summary, "not-run");
    assert.match(summaryLineNl(first), /niet geschreven: het rapport opent met de zin van loep/);
    const task = readFileSync(join(dir, "tasks", "samenvatting", "taak.md"), "utf8");
    assert.match(task, /hooguit 180 woorden/i);
    assert.doesNotMatch(task, /\{\{/);
    assert.doesNotMatch(task, /\b[Hh]ij\b/);
    assert.equal(readFileSync(join(dir, "tasks", "samenvatting", "rapport.md"), "utf8"), summarySourceText(read()));
    assert.equal(read().executiveSummary, undefined);

    // Written and not checked: not in the report.
    mkdirSync(join(dir, "verdicts"), { recursive: true });
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), JSON.stringify(good()));
    assert.deepEqual([(await summarize(dir)).summary, read().executiveSummary], ["stale", { status: "stale", reason: "unchecked" }]);

    // Checked: in the evaluation, and the report opens with it in every form.
    assert.deepEqual(await checkSummary(dir), []);
    assert.equal((await summarize(dir)).summary, "applied");
    const applied = read();
    assert.equal(applied.executiveSummary!.status, "applied");
    const markdown = renderMarkdown(applied);
    const opening = markdown.slice(markdown.indexOf("## Samenvatting"), markdown.indexOf("### Wie loopt vast"));
    assert.match(opening, /De site van Voorbeeldgemeente voldoet niet aan WCAG 2\.2 niveau A en AA, de norm voor toegankelijkheid\./);
    // Who wrote it is said with the tools, next to the models of the agents, not under the text.
    assert.doesNotMatch(opening, /taalmodel/);
    const tools = markdown.slice(markdown.indexOf("## Gereedschap"), markdown.indexOf("## Betrouwbaarheid"));
    assert.match(tools, /- Samenvatting bovenaan het rapport: Geschreven door een taalmodel \(voorbeeld-model-5\), uit de tekst van dit rapport zonder de bijlagen\./);
    // It takes the place of the sentence loep writes itself; the status loep computed stays next to it.
    assert.ok(!opening.includes(deriveReport(applied).statusSentenceNl));
    assert.match(opening, /\*\*Voorlopige status: C/);
    assert.match(renderHtml(applied), /Mensen die niet zien kunnen geen vergunning aanvragen/);
    // Checking again changes nothing: the summary in the evaluation is not part of what the writer read.
    assert.deepEqual(await checkSummary(dir), []);

    // Changed after the check: not in the report until it is checked again.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), JSON.stringify({ ...good(), model: "ander-model" }));
    assert.deepEqual([(await summarize(dir)).summary, read().executiveSummary], ["stale", { status: "stale", reason: "unchecked" }]);
    assert.deepEqual(await checkSummary(dir), []);
    assert.equal((await summarize(dir)).summary, "applied");

    // The report changed: the summary was written for another report.
    const changed = read();
    changed.site.name = "Andere gemeente";
    writeFileSync(path, canonicalJson({ ...changed, signature: undefined }));
    const stale = await summarize(dir);
    assert.deepEqual([stale.summary, stale.reason], ["stale", "report"]);
    assert.match(summaryLineNl(stale), /geschreven voor een rapport dat sindsdien is veranderd\. Ze staat niet in het rapport\. Laat haar opnieuw schrijven/);
    assert.ok(!renderMarkdown(read()).includes("De site van Voorbeeldgemeente voldoet niet aan WCAG 2.2 niveau A en AA, de norm"));

    // A summary that breaks a rule is not stamped.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), JSON.stringify({ paragraphs: [{ textNl: "Over het algemeen goed.", sources: ["status"] }] }));
    assert.ok((await checkSummary(dir)).length > 0);
    assert.equal((await summarize(dir)).summary, "stale");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
