import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkReading, checkSummary, summarize, summaryLineNl } from "../src/commands/summarize.ts";
import { canonicalJson, sha256, sha256File } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import { readingSentences, SUMMARY_WORDS_MAX, validateReading, validateSummary, type SummaryProposal } from "../src/lib/executive-summary.ts";
import { renderHtml } from "../src/lib/report-html.ts";
import { readTemplate } from "../src/lib/templates.ts";
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
    { textNl: "De site van Voorbeeldgemeente voldoet niet aan WCAG 2.2 niveau A en AA, de norm voor toegankelijkheid. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en door die 4 open criteria is het status C.", sources: ["status"] },
    { textNl: "Mensen die niet zien kunnen geen vergunning aanvragen, omdat de knop om te versturen voor hen geen naam heeft. Mensen die slecht zien stranden op grijze hulptekst en een zoekveld zonder naam.", sources: ["vastlopen", "VRB-G-e7cb", "VRB-G-9fc8"] },
    { textNl: "Herstel eerst het formulier voor de vergunning. Over 4 criteria is niets vastgesteld; ook daar kan een groep vastlopen.", sources: ["wat-nu", "open"] },
  ],
});

/** A reading that carries every sentence: for each the line of the report that shares most with it, no line more than twice. */
const carried = (sentences: string[], report: string): { n: number; sentence: string; verdict: string; quotes: string[] }[] => {
  const stems = (text: string): Set<string> => new Set([...(text.match(/\d+(?:[.,]\d+)*/g) ?? []), ...(text.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []).map((word) => word.slice(0, 5))]);
  const lines = report.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => (line.match(/[\p{L}]{2,}/gu) ?? []).length >= 3 && line.length <= 300);
  const used = new Map<string, number>();
  return sentences.map((sentence, index) => {
    const wanted = stems(sentence);
    const best = lines.filter((line) => (used.get(line) ?? 0) < 2).map((line) => [line, [...stems(line)].filter((stem) => wanted.has(stem)).length] as const).sort((a, b) => b[1] - a[1])[0]!;
    used.set(best[0], (used.get(best[0]) ?? 0) + 1);
    return { n: index + 1, sentence, verdict: "gedragen", quotes: [best[0]] };
  });
};

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
  refused("status without its cause", first("De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald en 4 open. Daaruit volgt status C."), /zegt niet waardoor de status C is/);
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
  refused("a list", first("- De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en door die 4 open criteria is het status C."), /lopende tekst/);
  refused("emphasis", add("Dat is **het zwaarste** gebrek."), /lopende tekst/);
  refused("an address", add("Zie https://voorbeeld.example/contact."), /noem geen adres/);
  refused("no source", (proposal) => void (proposal.paragraphs[1]!.sources = []), /sources is leeg/);
  refused("a source that is not in the report", (proposal) => void proposal.paragraphs[1]!.sources.push("VRB-G-0000"), /"VRB-G-0000" in sources is geen gebrek of criterium/);
  // The norm by its name: "the norm for accessibility" alone does not say against what the site was held.
  refused("the norm not named", first("De site van Voorbeeldgemeente voldoet niet aan de norm voor toegankelijkheid. Van de 55 criteria zijn er 5 niet gehaald en 4 open, en door die 4 open criteria is het status C."), /noemt de norm niet; zeg één keer in een zin "WCAG 2\.2 niveau A en AA"/);
  // A defect without who it hinders.
  refused("a defect without a group", (proposal) => void (proposal.paragraphs[1]!.textNl = "De knop om de aanvraag te versturen heeft geen naam. Grijze hulptekst is slecht te lezen."), /noemt bij de gebreken VRB-G-e7cb, VRB-G-9fc8 niet voor wie het geldt/);
  // The two counts are the ones of the evaluation, not any two numbers the report has somewhere.
  refused("other counts", first("De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 4 niet gehaald en 5 open, en door die open criteria is het status C."), /zegt dat 4 criteria niet zijn gehaald; het rapport heeft er 5, 4 open en 55 in totaal/);
  refused("a count in words at the end of a clause", add("Het zijn er acht."), /"acht" is een aantal in letters/);
  refused("what the owner does, as a fact", add("De eigenaar herstelt de gebreken, het formulier eerst."), /"De eigenaar herstelt" zegt wat de eigenaar doet, alsof dat is toegezegd/);
  refused("what the municipality does, as a fact", add("De gemeente laat binnen zes maanden aanvullend onderzoek doen."), /"De gemeente laat" zegt wat de eigenaar doet/);
  refused("an abbreviation", add("Dat geldt bijv. voor het zoekveld."), /schrijf "bijv\." voluit/);
  refused("a count in words that the report has in a title only", add("Het gaat om vier."), /"vier" is een aantal in letters/);
  refused("meets, with what was established", add("Op alles wat is vastgesteld voldoet de site verder."), /zegt dat de site voldoet/);
  refused("a count in words", first("De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er vijf niet gehaald en 4 open, en door die 4 open criteria is het status C."), /"vijf niet" is een aantal in letters/);
  refused("meets with another adverb", add("Aan de overige eisen voldoet de site ruimschoots."), /zegt dat de site voldoet|ruimschoots/);
  refused("meets, turned around", add("Aan de meeste eisen voldoet de site wel."), /zegt dat de site voldoet/);
  refused("another status with a capital", add("Status A is daarmee bereikt."), /noemt status A; het rapport komt uit op status C/);
  refused("softer words", add("De meeste bezoekers merken hier nauwelijks iets van."), /"nauwelijks" maakt kleiner/);
  // A group is stopped at a core task: a paragraph rests on a defect that stops it.
  refused("silent about who is stopped", (proposal) => void (proposal.paragraphs[1]!.sources = ["groepen"]), /een groep bezoekers loopt vast bij een kerntaak/);
  // Open criteria stay open: a paragraph says what was not established.
  refused("silent about what is open", (proposal) => void (proposal.paragraphs[2]!.sources = ["wat-nu"]), /het rapport heeft open criteria/);
});

test("sentences a writer would write pass: the count before the total, a colon, what is open, a second mention", () => {
  const first = (text: string) => (proposal: SummaryProposal) => void (proposal.paragraphs[0]!.textNl = text);
  for (const text of [
    "De site voldoet niet aan WCAG 2.2 niveau A en AA. 5 van de 55 criteria zijn niet gehaald en 4 zijn open, en door die open criteria is het status C.",
    "De site voldoet niet aan WCAG 2.2 niveau A en AA: 5 criteria van WCAG 2.2 niveau A en AA zijn niet gehaald. Het is status C: 4 criteria zijn niet vastgesteld.",
    "De site voldoet niet aan WCAG 2.2 niveau A en AA. Van de 55 criteria zijn er 5 niet gehaald. Of de site aan 4 andere voldoet, is open, en daardoor is het status C. Wat niet gehaald is, staat hieronder.",
  ]) assert.deepEqual(problemsOf(first(text)), [], text);
  // A later sentence with the same words and another number does not take the place of the count.
  assert.deepEqual(problemsOf((proposal) => void (proposal.paragraphs[2]!.textNl += " Bij 1 kerntaak is het doel niet gehaald.")), []);
  assert.deepEqual(problemsOf((proposal) => void (proposal.paragraphs[2]!.textNl += " De gemeente moet de regels in acht nemen.")), []);
  // What the owner can do or must do is advice, no commitment.
  assert.deepEqual(problemsOf((proposal) => void (proposal.paragraphs[2]!.textNl += " De eigenaar kan versturen op een testomgeving toestaan.")), []);
  // Words of a site, not of the evaluation.
  assert.deepEqual(problemsOf((proposal) => void (proposal.paragraphs[2]!.textNl += " De sessie verloopt zonder waarschuwing.")), []);
});

test("who a defect hinders is said once: the paragraph that says what to repair first need not say it again", () => {
  assert.deepEqual(problemsOf((proposal) => void proposal.paragraphs[2]!.sources.push("VRB-G-e7cb")), []);
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
  for (const left of ["## Bijlage A", "## Bijlage B", "Versie van de evaluatie", "Gemaakt met", "## Gereedschap", "- Toolbox:", "- Runtime:", "Datum van het onderzoek"]) assert.ok(!text.includes(left), left);
  // The same text with a summary in the evaluation, and after the evaluation was made again on another day.
  const later: Evaluation = { ...evaluation, evaluatedAt: "2026-10-12T09:30:00.000Z", executiveSummary: { status: "applied", paragraphs: ["Een tekst."], sources: [["status"]], templateSha256: "a", proposalSha256: "b", readingSha256: "c" } };
  assert.equal(summarySourceText(later), text);
  // And with another version of loep, of Node or of a package: the report says the same.
  const upgraded = structuredClone(evaluation);
  upgraded.toolchain.toolbox.version = "99.0.0";
  assert.equal(summarySourceText(upgraded), text);
});

test("summarize writes the task and the report, and puts in only a summary that was checked for this report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-summary-"));
  try {
    const path = join(dir, "evaluation.json");
    writeFileSync(path, canonicalJson(example()));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ steps: [] }));
    const read = (): Evaluation => ({ ...(JSON.parse(readFileSync(path, "utf8")) as Evaluation), signature: null });
    // The second reader, for the summary that stands now: every sentence carried by a line of the report that is about it, unless `change` says otherwise.
    const readBy = async (change: (sentences: Record<string, unknown>[]) => void = () => undefined, extra: object = {}): Promise<void> => {
      const proposal = JSON.parse(readFileSync(join(dir, "verdicts", "samenvatting.json"), "utf8")) as SummaryProposal;
      const sentences: Record<string, unknown>[] = carried(readingSentences(proposal), summarySourceText(read()));
      change(sentences);
      writeFileSync(join(dir, "verdicts", "samenvatting-lezing.json"), JSON.stringify({ reportSha256: sha256(summarySourceText(read())), proposalSha256: await sha256File(join(dir, "verdicts", "samenvatting.json")), taskSha256: sha256(readTemplate("samenvat-lees")), model: "lezer-model-5", sentences, ...extra }));
    };
    const written = (proposal: object = good()): string => JSON.stringify({ reportSha256: sha256(summarySourceText(read())), taskSha256: sha256(readTemplate("samenvat")), ...proposal });

    // No summary yet: the task and the report as text are there, the evaluation has none.
    const first = await summarize(dir);
    assert.equal(first.summary, "not-run");
    assert.match(summaryLineNl(first), /niet geschreven: het rapport opent met de zin van loep/);
    const task = readFileSync(join(dir, "tasks", "samenvatting", "taak.md"), "utf8");
    assert.match(task, new RegExp(`hooguit ${SUMMARY_WORDS_MAX} woorden`, "i"));
    assert.doesNotMatch(task, /\{\{/);
    assert.ok(task.includes(`"reportSha256": "${sha256(summarySourceText(read()))}"`), "the task gives the hash of the report to copy");
    assert.doesNotMatch(task, /\b[Hh]ij\b/);
    assert.equal(readFileSync(join(dir, "tasks", "samenvatting", "rapport.md"), "utf8"), summarySourceText(read()));
    assert.equal(read().executiveSummary, undefined);

    // Written and not checked: not in the report.
    mkdirSync(join(dir, "verdicts"), { recursive: true });
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), written());
    assert.deepEqual([(await summarize(dir)).summary, read().executiveSummary], ["stale", { status: "stale", reason: "unchecked" }]);

    // Checked, and not read by a second reader yet: not in the report, and the task of the reader is there.
    assert.deepEqual(await checkSummary(dir), []);
    const unread = await summarize(dir);
    assert.deepEqual([unread.summary, unread.reason, read().executiveSummary], ["stale", "unread", { status: "stale", reason: "unread" }]);
    assert.match(summaryLineNl(unread), /Nu legt een tweede lezer haar naast het rapport; een geldig oordeel over deze tekst is er nog niet\. Ze staat niet in het rapport\. De opdracht voor die lezer is nu geschreven\. Start een nieuwe agent, niet de schrijver/);
    const readTask = readFileSync(join(dir, "tasks", "samenvatting", "lees.md"), "utf8");
    assert.doesNotMatch(readTask, /\{\{/);
    assert.match(readTask, /^1\. De site van Voorbeeldgemeente voldoet niet aan WCAG 2\.2 niveau A en AA, de norm voor toegankelijkheid\.$/m);
    assert.deepEqual((await checkReading(dir)).problems, ["verdicts/samenvatting-lezing.json ontbreekt"]);

    // The reader found a sentence the report does not carry: the summary stays out, and the line says how many.
    await readBy((sentences) => void Object.assign(sentences[2]!, { verdict: "niet-gedragen", quotes: undefined, noteNl: "Het rapport noemt hier mensen die niet zien, niet mensen die slecht horen." }));
    const refuted = await summarize(dir);
    assert.deepEqual([refuted.summary, refuted.reason, refuted.refuted], ["stale", "refuted", 1]);
    assert.match(summaryLineNl(refuted), /iets wat het rapport niet draagt\. Ze staat niet in het rapport\. Het gaat om 1 zin/);
    assert.deepEqual([(await checkReading(dir)).problems, (await checkReading(dir)).refuted.map((entry) => entry.n)], [[], [3]]);

    // A reading with a quote that is not in the report, or without a verdict for a sentence, is no reading.
    await readBy((sentences) => void (sentences[0]!.quotes = ["Dit staat nergens in het rapport."]));
    assert.match((await checkReading(dir)).problems.join(" | "), /zin 1: "Dit staat nergens in het rapport\." staat niet letterlijk in het rapport/);
    const faulty = await summarize(dir);
    assert.equal(faulty.reason, "unread");
    assert.match(summaryLineNl(faulty), /Het oordeel dat er ligt heeft \d+ problem(?:en)?; check-reading noemt ze\. Laat de tweede lezer het herstellen/);
    await readBy((sentences) => void sentences.pop());
    assert.match((await checkReading(dir)).problems.join(" | "), /zin \d+ heeft geen oordeel/);
    assert.equal((await summarize(dir)).reason, "unread");

    // A reading made under another version of the reader's task does not count.
    await readBy(() => undefined, { taskSha256: "van-een-eerdere-opdracht" });
    assert.match((await checkReading(dir)).problems.join(" | "), /gemaakt met een andere versie van de opdracht/);
    assert.equal((await summarize(dir)).reason, "unread");

    // Read, every sentence carried: in the evaluation, and the report opens with it in every form.
    await readBy();
    assert.deepEqual(await checkReading(dir), { problems: [], refuted: [] });
    assert.equal((await summarize(dir)).summary, "applied");
    const applied = read();
    assert.equal(applied.executiveSummary!.status, "applied");
    const markdown = renderMarkdown(applied);
    const opening = markdown.slice(markdown.indexOf("## Samenvatting"), markdown.indexOf("### Wie loopt vast"));
    assert.match(opening, /De site van Voorbeeldgemeente voldoet niet aan WCAG 2\.2 niveau A en AA, de norm voor toegankelijkheid\./);
    // Who wrote it is said with the tools, next to the models of the agents, not under the text.
    assert.doesNotMatch(opening, /taalmodel/);
    const tools = markdown.slice(markdown.indexOf("## Gereedschap"), markdown.indexOf("## Betrouwbaarheid"));
    assert.match(tools, /- Samenvatting bovenaan het rapport: Geschreven door een taalmodel \(voorbeeld-model-5\), uit de tekst van dit rapport zonder de bijlagen\..* kan het script niet zien\. Daarom heeft een tweede taalmodel \(lezer-model-5\) elke zin naast het rapport gelegd en aangewezen waar die staat\. Ook dat model kan zich vergissen; wie het rapport tekent, leest de samenvatting mee\./);
    // It takes the place of the sentence loep writes itself; the status loep computed stays next to it.
    assert.ok(!opening.includes(deriveReport(applied).statusSentenceNl));
    assert.match(opening, /\*\*Voorlopige status: C/);
    assert.match(renderHtml(applied), /Mensen die niet zien kunnen geen vergunning aanvragen/);
    // Checking again changes nothing: the summary in the evaluation is not part of what the writer read.
    const stampBefore = readFileSync(join(dir, "verdicts", "samenvatting.stamp.json"), "utf8");
    assert.deepEqual(await checkSummary(dir), []);
    assert.equal(readFileSync(join(dir, "verdicts", "samenvatting.stamp.json"), "utf8"), stampBefore, "a second check leaves the stamp as it is: it is under the seal");

    // Changed after the check: not in the report until it is checked again.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), written({ ...good(), model: "ander-model" }));
    assert.deepEqual([(await summarize(dir)).summary, read().executiveSummary], ["stale", { status: "stale", reason: "unchecked" }]);
    assert.deepEqual(await checkSummary(dir), []);
    // The reading was of the earlier text: the new one waits for a reader.
    assert.equal((await summarize(dir)).reason, "unread");
    await readBy();
    assert.equal((await summarize(dir)).summary, "applied");

    // The report changed: the summary was written for another report.
    const changed = read();
    changed.site.name = "Andere gemeente";
    writeFileSync(path, canonicalJson({ ...changed, signature: undefined }));
    const stale = await summarize(dir);
    assert.deepEqual([stale.summary, stale.reason], ["stale", "report"]);
    assert.match(summaryLineNl(stale), /geschreven voor een rapport dat sindsdien is veranderd\. Ze staat niet in het rapport\. Laat haar opnieuw schrijven/);
    assert.ok(!renderMarkdown(read()).includes("De site van Voorbeeldgemeente voldoet niet aan WCAG 2.2 niveau A en AA, de norm"));
    // Checking the old text again does not bring it back: it was written from another report, whatever its numbers.
    const again = await checkSummary(dir);
    assert.equal(again.length, 1);
    assert.match(again[0]!, /geschreven voor een ander rapport dan dat van nu/);
    assert.deepEqual([(await summarize(dir)).summary, read().executiveSummary?.status], ["stale", "stale"]);

    // A stamp that cannot be read stops no command: the summary is then not checked.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), written());
    assert.deepEqual(await checkSummary(dir), []);
    writeFileSync(join(dir, "verdicts", "samenvatting.stamp.json"), "{ half");
    assert.equal((await summarize(dir)).reason, "unchecked");
    // Written under another version of the task: checking it again does not make it a text of this task.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), written({ ...good(), taskSha256: "van-een-eerdere-opdracht" }));
    assert.match((await checkSummary(dir)).join(" | "), /geschreven met een andere versie van de opdracht/);
    assert.equal((await summarize(dir)).summary, "stale");

    // A summary that breaks a rule is not stamped.
    writeFileSync(join(dir, "verdicts", "samenvatting.json"), written({ paragraphs: [{ textNl: "Over het algemeen goed.", sources: ["status"] }] }));
    assert.ok((await checkSummary(dir)).length > 0);
    assert.equal((await summarize(dir)).summary, "stale");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reading is held to the summary: a number that is no sentence, a verdict that is none, a quote too short", () => {
  const evaluation = example();
  const sentences = readingSentences(good());
  const { problems } = validateReading({ sentences: [{ n: 99, verdict: "gedragen", quotes: ["x"] }, { n: 1, sentence: sentences[0], verdict: "misschien" }, { n: 2, sentence: sentences[1], verdict: "gedragen", quotes: ["Voorbeeld"] }, { n: 3, sentence: sentences[2], verdict: "niet-gedragen" }] }, sentences, summarySourceText(evaluation));
  for (const expected of [/zin 99 bestaat niet/, /zin 1: verdict is "gedragen" of "niet-gedragen"/, /zin 2: "Voorbeeld" is te kort/, /zin 3: niet-gedragen, maar noteNl zegt niet/, /hebben geen oordeel/]) assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(" | ")}`);
  assert.deepEqual(validateReading({}, sentences, ""), { problems: ['het antwoord heeft geen lijst "sentences"'], refuted: [] });
});

test("a reading without reading in it is no reading: one line for every sentence, a line about something else, a verdict on another sentence", () => {
  const evaluation = example();
  const report = summarySourceText(evaluation);
  const sentences = readingSentences(good());
  assert.deepEqual(validateReading({ sentences: carried(sentences, report) }, sentences, report), { problems: [], refuted: [] });
  const stems = (text: string): string[] => (text.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []).map((word) => word.slice(0, 5));
  // A line of the report that is about something else than sentence 2.
  const line = report.split("\n").map((entry) => entry.replace(/\s+/g, " ").trim()).find((entry) => (entry.match(/[\p{L}]{2,}/gu) ?? []).length >= 4 && entry.length <= 300 && !/\d/.test(entry) && !stems(entry).some((stem) => stems(sentences[1]!).includes(stem)))!;
  const lazy = validateReading({ sentences: sentences.map((sentence, index) => ({ n: index + 1, sentence, verdict: "gedragen", quotes: [line] })) }, sentences, report).problems.join(" | ");
  assert.match(lazy, /de zinnen 1, 2, 3[\d, ]* rusten op dezelfde plek in het rapport .*; een plek draagt hooguit 2 zinnen/);
  assert.match(lazy, /zin 2: het stuk in quotes deelt geen woord of getal met de zin; zeg in noteNl in één zin waarom/);
  // The same place cut out a character shorter each time is still one place, and the whole report is no place.
  assert.match(validateReading({ sentences: sentences.map((sentence, index) => ({ n: index + 1, sentence, verdict: "gedragen", noteNl: "Volgt eruit.", quotes: [line.slice(0, line.length - index)] })) }, sentences, report).problems.join(" | "), /rusten op dezelfde plek/);
  assert.match(validateReading({ sentences: sentences.map((sentence, index) => ({ n: index + 1, sentence, verdict: "gedragen", quotes: [report.slice(0, report.length - index)] })) }, sentences, report).problems.join(" | "), /wijst geen plek aan; geef de zin of de paar zinnen waar het staat, hooguit 300 tekens/);
  // A sentence in other words than the report stands with a line that says why it follows.
  const other = carried(sentences, report).map((entry) => (entry.quotes[0] === line ? { ...entry, quotes: [report.split("\n").map((candidate) => candidate.replace(/\s+/g, " ").trim()).find((candidate) => candidate !== line && candidate.length <= 300 && stems(candidate).some((stem) => stems(entry.sentence).includes(stem)))!] } : entry));
  const paraphrase = { ...other[1]!, quotes: [line] };
  assert.match(validateReading({ sentences: [other[0], paraphrase, ...other.slice(2)] }, sentences, report).problems.join(" | "), /zin 2: het stuk in quotes deelt geen woord of getal/);
  assert.deepEqual(validateReading({ sentences: [other[0], { ...paraphrase, noteNl: "Het rapport zegt dit hier in andere woorden." }, ...other.slice(2)] }, sentences, report).problems, []);
  assert.match(validateReading({ sentences: sentences.map((sentence, index) => ({ n: index + 1, sentence, verdict: "gedragen", quotes: ["| --- | ---: | ---: |"] })) }, sentences, report).problems.join(" | "), /is te kort om een plek in het rapport aan te wijzen/);
  // The same verdicts, for a text in which one sentence was rewritten since.
  const rewritten = [...sentences];
  rewritten[1] = "Mensen die niet horen kunnen geen contact opnemen met de gemeente.";
  assert.match(validateReading({ sentences: carried(sentences, report) }, rewritten, report).problems.join(" | "), /zin 2: "sentence" is niet de zin die er nu staat/);
});
