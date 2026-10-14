import assert from "node:assert/strict";
import { test } from "node:test";
import { compare } from "../src/commands/compare.ts";
import { evaluationHash, type Evaluation } from "../src/lib/evaluation.ts";
import { renderAnswerSheet, renderStatement } from "../src/lib/statement.ts";
import { answerSheetDocument, blocksFromMarkdown, buildStatement, statementDocument, statementSpans, type StatementBlock, type StatementSpan } from "../src/lib/statement.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

function signed(evaluation: Evaluation): Evaluation {
  return { ...evaluation, signature: { name: "N", role: "R", organisation: "O", signedAt: "2026-10-10T08:00:00.000Z", statementNl: "S", evaluationSha256: evaluationHash(evaluation), sealSha256: "5".repeat(64) } };
}

function withOutcomes(evaluation: Evaluation, change: (outcome: string) => string): Evaluation {
  const criteria = evaluation.criteria.map((criterion) => ({ ...criterion, outcome: change(criterion.outcome) as typeof criterion.outcome }));
  const tally = (version: "2.1" | "2.2") => {
    const relevant = criteria.filter((criterion) => criterion.versions.includes(version));
    const counts = { passed: 0, failed: 0, inapplicable: 0, cantTell: 0, untested: 0, total: relevant.length };
    for (const criterion of relevant) counts[criterion.outcome]++;
    return counts;
  };
  return { ...evaluation, criteria, summary: { "2.1": tally("2.1"), "2.2": tally("2.2") } };
}

test("an unsigned evaluation gives no status and a statement that says so", () => {
  const result = renderStatement(exampleEvaluation(), { organisation: "Gemeente Voorbeeld" }, { concept: true });
  assert.equal(result.status, "geen");
  assert.match(result.markdown, /Concept, niet publiceren/);
  assert.match(result.markdown, /nog niet afgetekend/);
});

test("open criteria give status C and are listed for further evaluation", () => {
  const result = renderStatement(signed(exampleEvaluation()), { organisation: "Gemeente Voorbeeld" }, { concept: false });
  assert.equal(result.status, "C");
  assert.match(result.markdown, /Nalevingsstatus: C – eerste maatregelen genomen/);
  assert.match(result.markdown, /Succescriterium 1\.4\.11 – /);
  assert.ok(!result.markdown.includes("Concept, niet publiceren"));
});

test("with nothing open, failures give status B with every deviation and a measure asked for each", () => {
  const decided = signed(withOutcomes(exampleEvaluation(), (outcome) => (outcome === "cantTell" ? "passed" : outcome)));
  const result = renderStatement(decided, { organisation: "Gemeente Voorbeeld", measuresNl: { "1.1.1": "Status komt als tekst naast het pictogram." } }, { concept: false });
  assert.equal(result.status, "B");
  assert.match(result.markdown, /Type onderzoek: automatisch onderzoek/);
  assert.match(result.markdown, /Het onderzoek is automatisch uitgevoerd met loep 0\.0\.1, een open-source instrument dat meet en bewijs vastlegt/);
  assert.match(result.markdown, /Onderzoek uitgevoerd door: in eigen beheer/);
  assert.match(result.markdown, /1\.1\.1 – Niet-tekstuele content: Status komt als tekst naast het pictogram\./);
  assert.match(result.markdown, /1\.4\.3 – Contrast \(minimum\): \[nog invullen: maatregel\]/);
  assert.ok(result.openItems.includes("maatregel"));
});

test("only a clean evaluation gives status A", () => {
  const clean = signed(withOutcomes(exampleEvaluation(), (outcome) => (outcome === "inapplicable" ? outcome : "passed")));
  assert.equal(renderStatement(clean, { organisation: "O" }, { concept: false }).status, "A");
});

test("the statement never contains an em-dash and the answer sheet has nine steps", () => {
  const evaluation = signed(exampleEvaluation());
  assert.ok(!renderStatement(evaluation, { organisation: "O" }, { concept: true }).markdown.includes("—"));
  assert.equal([...renderAnswerSheet(evaluation, { organisation: "O" }).matchAll(/^## \d\. /gm)].length, 9);
});

test("comparison with an existing audit separates misses from open questions", () => {
  const evaluation = exampleEvaluation();
  const result = compare(evaluation, { wcagVersion: "2.2", sampleNote: "", outcomeNote: "", failed: ["1.1.1", "1.4.3", "1.4.11", "2.4.2", "2.5.8"] });
  assert.deepEqual(result.bothFailed, ["1.1.1", "1.4.3"]);
  assert.deepEqual(result.missed, [{ id: "1.4.11", ours: "cantTell" }, { id: "2.4.2", ours: "passed" }, { id: "2.5.8", ours: "passed" }]);
  assert.deepEqual(result.onlyOurs, ["2.4.4", "2.4.7", "4.1.2"]);
  assert.equal(result.recall, 0.4);
  assert.equal(result.falsePassRate, 0.4);
  assert.equal(result.undecidedRate, 0.2);
});

/** The Markdown written out again from the model, independently of the module's own renderer. */
function markdownFromModel(blocks: StatementBlock[]): string {
  const inline = (spans: StatementSpan[]): string => spans.map((span) => ("text" in span ? span.text : "link" in span ? `<${span.link}>` : `[nog invullen: ${span.open}]`)).join("");
  const parts = blocks.map((block) => {
    if (block.type === "heading") return `${"#".repeat(block.level)} ${inline(block.spans)}`;
    if (block.type === "note") return `> **${block.title}** ${inline(block.spans)}`;
    if (block.type === "paragraph") return inline(block.spans);
    return block.items.flatMap((item) => [`- ${inline(item.spans)}`, ...item.items.map((nested) => `  - ${inline(nested)}`)]).join("\n");
  });
  return `${parts.join("\n\n")}\n`;
}

test("the Markdown statement is exactly what the block model says, for every status", () => {
  const full = {
    organisation: "Gemeente Voorbeeld",
    dashboardOrganisationNumber: "1234",
    subdomains: ["https://a.voorbeeld.example"],
    reportUrl: "https://voorbeeld.example/rapport.pdf",
    contactUrl: "https://voorbeeld.example/contact",
    targetDate: "2027-03-01",
    measuresNl: { "*": "Wordt opgelost in de volgende release." },
    approval: { date: "2026-10-20", functionTitle: "Gemeentesecretaris", lastReviewed: "2026-10-21" },
  };
  const decided = withOutcomes(exampleEvaluation(), (outcome) => (outcome === "cantTell" ? "passed" : outcome));
  const clean = withOutcomes(exampleEvaluation(), (outcome) => (outcome === "inapplicable" ? outcome : "passed"));
  const cases: [Evaluation, boolean, string][] = [
    [exampleEvaluation(), true, "geen"],
    [signed(exampleEvaluation()), false, "C"],
    [signed(decided), false, "B"],
    [signed(clean), false, "A"],
  ];
  for (const [evaluation, concept, status] of cases) {
    for (const input of [{ organisation: "Gemeente Voorbeeld" }, full]) {
      const model = buildStatement(evaluation, input, { concept });
      const result = renderStatement(evaluation, input, { concept });
      assert.equal(model.status, status);
      assert.equal(result.markdown, markdownFromModel(model.blocks));
      // The open items are the placeholders in the text, each named once, in order of appearance.
      assert.deepEqual(result.openItems, [...new Set([...result.markdown.matchAll(/\[nog invullen: ([^\]]+)\]/g)].map((match) => match[1]!))]);
    }
  }
});

test("the model starts with the title and marks a concept with a note", () => {
  const concept = buildStatement(exampleEvaluation(), { organisation: "Gemeente Voorbeeld" }, { concept: true }).blocks;
  assert.deepEqual(concept[0], { type: "heading", level: 1, spans: [{ text: "Toegankelijkheidsverklaring Voorbeeldgemeente" }] });
  assert.equal(concept[1]!.type, "note");
  const final = buildStatement(signed(exampleEvaluation()), { organisation: "Gemeente Voorbeeld" }, { concept: false }).blocks;
  assert.ok(final.every((block) => block.type !== "note"));
  // The nested list of the model statement survives as a nested list.
  const decided = signed(withOutcomes(exampleEvaluation(), (outcome) => (outcome === "cantTell" ? "passed" : outcome)));
  const lists = buildStatement(decided, { organisation: "Gemeente Voorbeeld" }, { concept: false }).blocks.filter((block) => block.type === "list");
  assert.ok(lists.some((block) => block.items.some((item) => item.items.length === 8)));
});

test("links and open places are told apart from plain text", () => {
  assert.deepEqual(statementSpans("Zie <https://voorbeeld.example/a?b=1> of [nog invullen: link naar contactgegevens]."), [
    { text: "Zie " },
    { link: "https://voorbeeld.example/a?b=1" },
    { text: " of " },
    { open: "link naar contactgegevens" },
    { text: "." },
  ]);
  // Markup in a proposed fix is text, not a link.
  assert.deepEqual(statementSpans('Gebruik <button aria-expanded="false">.'), [{ text: 'Gebruik <button aria-expanded="false">.' }]);
});

test("the documents for the PDF carry the status, the open items and the nine steps", () => {
  const evaluation = signed(exampleEvaluation());
  const document = statementDocument(evaluation, { organisation: "Gemeente Voorbeeld" }, { concept: false });
  assert.equal(document.title, "Toegankelijkheidsverklaring Voorbeeldgemeente");
  assert.deepEqual(document.status, { code: "C", name: "eerste maatregelen genomen" });
  assert.equal(document.concept, false);
  assert.equal(document.evaluationShort, evaluationHash(evaluation).slice(0, 12));
  assert.equal(document.madeWithNl, "Gemaakt met loep 0.0.1");
  assert.deepEqual(document.openItems, renderStatement(evaluation, { organisation: "Gemeente Voorbeeld" }, { concept: false }).openItems);

  const sheet = answerSheetDocument(evaluation, { organisation: "Gemeente Voorbeeld" });
  assert.equal(sheet.status, null);
  assert.equal(sheet.blocks.filter((block) => block.type === "heading" && block.level === 2).length, 9);
  assert.ok(sheet.openItems.includes("maatregel"));
  assert.deepEqual(blocksFromMarkdown("# T\n\nTekst.\n\n- een\n- twee\n"), [
    { type: "heading", level: 1, spans: [{ text: "T" }] },
    { type: "paragraph", spans: [{ text: "Tekst." }] },
    { type: "list", items: [{ spans: [{ text: "een" }], items: [] }, { spans: [{ text: "twee" }], items: [] }] },
  ]);
});
