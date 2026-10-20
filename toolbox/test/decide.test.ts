import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadAnswers } from "../src/commands/answer.ts";
import { decide } from "../src/commands/decide.ts";
import { render } from "../src/commands/render.ts";
import { sign, writeEvaluation } from "../src/commands/sign.ts";
import { checkSeal, seal, verify } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { checkDecisions, DECISIONS_INDEX, decisionFile, loadDecisions, type Decision, type DecisionFile } from "../src/lib/decisions.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { evaluationHash, summarise, type Evaluation } from "../src/lib/evaluation.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { parseRecordedVia } from "../src/lib/recorded.ts";
import { renderMarkdown } from "../src/lib/report-markdown.ts";
import { renderAnswerSheet, renderStatement } from "../src/lib/statement.ts";
import { decideWrites, writesAllowedNl } from "../src/lib/writes.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const SIGNER = { name: "Een ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", checkedNl: null };
const WHO = { name: "Een productowner", role: "Productowner" };

function withDefects(): Evaluation {
  const evaluation = exampleEvaluation();
  evaluation.defects = mergeFindings(evaluation);
  evaluation.merge = { rulesVersion: 1, proposal: { status: "not-run" } };
  return evaluation;
}

/** A run as it stands after evaluate, (render) and seal: what the signer reads. */
async function sealedRun(withReport: boolean): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "decide-"));
  mkdirSync(join(run, "pages", "start"), { recursive: true });
  writeFileSync(join(run, "pages", "start", "facts.json"), canonicalJson({ title: "Start" }));
  await writeEvaluation(join(run, "evaluation.json"), withDefects());
  await writeManifest(run, { command: "evaluate" });
  if (withReport) await render(run);
  await seal(run);
  return run;
}

test("decisions come after signing, stand outside the seal as a layer of their own, and keep the earlier one", async () => {
  const run = await sealedRun(true);
  await assert.rejects(decide({ run }), /besluiten komen na het tekenen/);
  const signature = await sign({ run, ...SIGNER, recordedVia: "gesprek" });
  assert.equal(signature.recordedVia, "gesprek", "a signature the agent recorded says so");

  // Without a defect: every defect, heaviest first, none decided yet.
  const listing = await decide({ run });
  const evaluation = withDefects();
  assert.equal(listing.defects.length, evaluation.defects!.length);
  assert.equal(listing.left, evaluation.defects!.length);
  const ranks = listing.defects.map((view) => ["blokkerend", "hoog", "midden", "laag"].indexOf(view.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  // One defect: what it is and what the report proposes.
  const [first, second] = listing.defects;
  const shown = await decide({ run, defect: first!.id });
  assert.equal(shown.written, null);
  assert.ok(shown.defects[0]!.proposalsNl.length > 0);

  // What is missing is asked, never filled in.
  await assert.rejects(decide({ run, defect: first!.id, decision: "gepland", what: "Het team past het component aan.", ...WHO }), /bij gepland hoort een datum/);
  await assert.rejects(decide({ run, defect: first!.id, decision: "gepland", what: "Het team past het component aan.", date: "2026-13-01", ...WHO }), /jjjj-mm-dd/);
  await assert.rejects(decide({ run, defect: first!.id, decision: "gepland", what: "Het team past het component aan.", date: "2026-12-01", role: "Productowner" }), /--name en --role/);
  await assert.rejects(decide({ run, defect: first!.id, decision: "onevenredig", what: "De kosten zijn te hoog voor dit jaar.", ...WHO }), /alternatief/);
  await assert.rejects(decide({ run, defect: first!.id, decision: "zienswijze", what: "Dit is geen fout.", date: "2026-12-01", ...WHO }), /--date hoort bij gepland/);
  await assert.rejects(decide({ run, defect: "XYZ-G-0000", decision: "onbesloten", ...WHO }), /staat niet in dit onderzoek/);

  const before = (await checkSeal(run))!;
  const planned = await decide({ run, defect: first!.id, decision: "gepland", what: "Het team past het component aan.", date: "2026-12-01", ...WHO, recordedVia: "gesprek" });
  assert.equal(planned.written, decisionFile(first!.id));
  assert.equal(planned.left, evaluation.defects!.length - 1);
  await decide({ run, defect: second!.id, decision: "zienswijze", what: "De organisatie vindt de tekst duidelijk genoeg.", ...WHO });

  // Recording a decision changes nothing that was sealed or signed.
  const after = (await checkSeal(run))!;
  assert.deepEqual(after.problems, []);
  assert.ok(after.outside.includes(decisionFile(first!.id)) && after.outside.includes(DECISIONS_INDEX), after.outside.join(", "));
  assert.deepEqual(before.problems, []);
  assert.equal(await verify(run), true);

  // A changed decision keeps the earlier one.
  await decide({ run, defect: first!.id, decision: "opgelost", what: "Het component is aangepast en staat live.", ...WHO, recordedVia: "gesprek" });
  const stored = JSON.parse(readFileSync(join(run, decisionFile(first!.id)), "utf8")) as DecisionFile;
  assert.equal(stored.decision, "opgelost");
  assert.equal(stored.recordedVia, "gesprek");
  assert.equal(stored.name, WHO.name);
  assert.deepEqual(stored.previous.map((earlier) => [earlier.decision, earlier.date]), [["gepland", "2026-12-01"]]);
  assert.equal(stored.sealSha256, signature.sealSha256);

  // The signed report has the chapter, with the role and not the name; the concept that was read has none.
  const signedReport = await render(run);
  // The PDF has the chapter too, and passes the same checks as the rest of the report.
  if (signedReport.pdf !== null) assert.deepEqual(signedReport.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  const report = readFileSync(signedReport.markdown, "utf8");
  const chapter = report.split("## Maatregelen en beslissingen")[1]!.split("\n## ")[0]!;
  assert.ok(chapter.includes(`([${first!.id}](#${first!.id}))`) && chapter.includes("**Opgelost volgens de organisatie, nog niet nagemeten"));
  assert.ok(chapter.includes("  - Besloten door: functie Productowner, vastgelegd in een gesprek, bevestigd op "));
  assert.ok(chapter.includes("  - Eerder besloten: herstel gepland (1 december 2026), functie Productowner"));
  assert.ok(chapter.includes("**Andere zienswijze**") && chapter.includes("  - Reden: De organisatie vindt de tekst duidelijk genoeg."));
  assert.ok(chapter.includes(`2 van de ${evaluation.defects!.length} gebreken hebben een besluit`));
  assert.ok(chapter.includes(`met een eigen kenmerk: ${(await loadDecisions(run, evaluation.defects)).sha256!.slice(0, 12)}`));
  assert.ok(!report.includes(WHO.name), "the name stays in the file of the decision");
  assert.match(report, /^- Afgetekend door: Een ondertekenaar, Directeur, Gemeente Voorbeeld, op [^,]+, vastgelegd in een gesprek, bevestigd op /m);
  assert.ok(!readFileSync(join(run, "report", "rapport.md"), "utf8").includes("Maatregelen en beslissingen"));
  assert.deepEqual((await checkSeal(run))!.problems, [], "rendering after a decision leaves the seal whole");
});

test("verify sees a decision that was changed, added or removed outside decide, and one about a defect that is gone", async () => {
  const run = await sealedRun(false);
  await sign({ run, ...SIGNER });
  const [first, second] = (await decide({ run })).defects;
  await decide({ run, defect: first!.id, decision: "onbesloten", ...WHO });
  await decide({ run, defect: second!.id, decision: "gepland", what: "Het team past het component aan.", date: "2027-01-15", ...WHO });
  const defects = withDefects().defects;
  assert.deepEqual((await checkDecisions(run, defects))!.problems, []);

  const path = join(run, decisionFile(first!.id));
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("onbesloten", "opgelost"));
  writeFileSync(join(run, "besluiten", "XYZ-G-0000.json"), canonicalJson({ ...JSON.parse(original), defect: { id: "XYZ-G-0000", titleNl: "Weg", mainCriterion: "1.1.1" } }));
  const problems = (await checkDecisions(run, defects))!.problems;
  assert.deepEqual([...problems].sort(), [`gewijzigd: ${decisionFile(first!.id)}`, "niet in de laag met besluiten: besluiten/XYZ-G-0000.json", "besluiten/XYZ-G-0000.json: het gebrek XYZ-G-0000 staat niet in deze evaluatie"].sort());
  writeFileSync(path, original);
  rmSync(join(run, decisionFile(second!.id)));
  assert.ok((await checkDecisions(run, defects))!.problems.includes(`ontbreekt: ${decisionFile(second!.id)}`), "a decision that disappeared is seen");
  assert.equal(await verify(run), false);
  // A decision about a defect that is not in the evaluation does not count in the report.
  assert.ok(!(await loadDecisions(run, defects)).decisions.some((decision) => decision.defect.id === "XYZ-G-0000"));
});

/** The example with nothing open: status B once signed. */
function statusB(): Evaluation {
  const evaluation = withDefects();
  for (const criterion of evaluation.criteria) if (criterion.outcome === "cantTell") criterion.outcome = "passed";
  evaluation.summary = summarise(evaluation.criteria);
  return { ...evaluation, signature: { name: "N", role: "R", organisation: "O", signedAt: "2026-10-10T08:00:00.000Z", statementNl: "S", evaluationSha256: evaluationHash(evaluation), sealSha256: "5".repeat(64) } };
}

const decision = (defect: NonNullable<Evaluation["defects"]>[number], fields: Partial<Decision>): Decision => ({
  defect: { id: defect.id, titleNl: defect.titleNl, mainCriterion: defect.mainCriterion },
  decision: "gepland",
  whatNl: "Het team past het component aan.",
  date: "2026-12-01",
  alternativeNl: null,
  name: "N",
  role: "Productowner",
  decidedAt: "2026-10-20T10:00:00.000Z",
  sealSha256: "5".repeat(64),
  ...fields,
});

test("the statement takes its measures from the decisions, and status B says which deviation has no measure with a date", () => {
  const evaluation = statusB();
  const input = { organisation: "Gemeente Voorbeeld" };
  const failed = evaluation.criteria.filter((criterion) => criterion.versions.includes("2.1") && criterion.outcome === "failed");
  const defectsOf = (id: string) => evaluation.defects!.filter((defect) => defect.findingIds.some((findingId) => evaluation.criteria.find((criterion) => criterion.id === id)!.findings.some((finding) => finding.id === findingId)));

  // Every defect planned with a date: nothing missing.
  const planned = evaluation.defects!.map((defect) => decision(defect, {}));
  const all = renderStatement(evaluation, input, { concept: false, decisions: planned });
  assert.equal(all.status, "B");
  assert.equal(all.missingMeasuresNl, null);
  const [one] = failed;
  const [defect] = defectsOf(one!.id);
  assert.ok(all.markdown.includes(`Succescriterium ${one!.id} – ${one!.titleNl}: ${defect!.titleNl.replace(/\.$/, "")}: herstel gepland, klaar uiterlijk 1 december 2026: Het team past het component aan.`), all.markdown);
  assert.ok(renderAnswerSheet(evaluation, input, planned).includes(`- Maatregel bij ${one!.id}: ${defect!.titleNl.replace(/\.$/, "")}: herstel gepland`));

  // Another view is no measure with a date: said in the statement and in one message.
  const other = planned.map((entry) => (entry.defect.id === defect!.id ? decision(defect!, { decision: "zienswijze", date: null, whatNl: "De organisatie ziet het anders." }) : entry));
  const missing = renderStatement(evaluation, input, { concept: false, decisions: other });
  assert.match(missing.missingMeasuresNl!, new RegExp(`^status B vraagt bij elke afwijking een maatregel met een datum\\. Die ontbreekt bij [^.]*${one!.id.replace(/\./g, "\\.")}`));
  assert.ok(missing.openItems.includes("maatregel met een datum"));
  assert.ok(missing.markdown.includes("de organisatie ziet dit anders: De organisatie ziet het anders"));

  // A run without decisions still reads measuresNl, and has no message of its own for it.
  const free = renderStatement(evaluation, { ...input, measuresNl: { "*": "Het team lost alles op." } }, { concept: false });
  assert.equal(free.missingMeasuresNl, null);
  assert.ok(free.markdown.includes(`Succescriterium ${one!.id} – ${one!.titleNl}: Het team lost alles op.`));
  const none = renderStatement(evaluation, input, { concept: false });
  assert.match(none.missingMeasuresNl!, /Die ontbreekt bij /);
  // Any other status asks nothing of the kind.
  assert.equal(renderStatement(withDefects(), input, { concept: true }).missingMeasuresNl, null);
});

test("what the agent recorded in the conversation says so: an answer, a signature in the report, and a declaration for sending", async () => {
  assert.equal(parseRecordedVia(undefined), undefined);
  assert.equal(parseRecordedVia("gesprek"), "gesprek");
  assert.throws(() => parseRecordedVia("terminal"), /--recorded-via kent één waarde/);

  // An answer keeps how it was recorded into the evaluation.
  const run = mkdtempSync(join(tmpdir(), "recorded-"));
  mkdirSync(join(run, "antwoorden"));
  const answer = { pointNl: "mens nodig: luister met een schermlezer.", didNl: "Geluisterd met NVDA op de startpagina.", outcome: "passed", role: "Tester", name: "T", answeredAt: "2026-10-20T10:00:00.000Z", recordedVia: "gesprek", verdict: { round: "final", sha256: "ab" } };
  writeFileSync(join(run, "antwoorden", "1.1.1.json"), canonicalJson({ criterion: "1.1.1", answers: [answer] }));
  const loaded = await loadAnswers(run, "1.1.1", { round: "final", sha256: "ab", verdict: {} as never });
  assert.equal(loaded.answers[0]!.recordedVia, "gesprek");
  assert.ok(!("name" in loaded.answers[0]!));
  const evaluation = exampleEvaluation();
  const criterion = evaluation.criteria.find((entry) => entry.id === "1.1.1")!;
  criterion.answers = loaded.answers;
  assert.ok(renderMarkdown(evaluation).includes("(functie: Tester, vastgelegd in een gesprek, bevestigd op 20 oktober 2026 om 12:00)"));

  // The declaration that a site is a test environment.
  const permission = decideWrites("https://test.example.nl", { testEnvironment: "https://test.example.nl", declaredBy: "Een beheerder, Beheerder", recordedVia: "gesprek" })!;
  assert.equal(permission.recordedVia, "gesprek");
  assert.match(writesAllowedNl(permission), /verklaard door iemand met de functie Beheerder, vastgelegd in een gesprek \(/);
  assert.ok(!writesAllowedNl({ ...permission, recordedVia: undefined } as never).includes("gesprek"));
});
