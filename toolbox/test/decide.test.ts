import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadAnswers } from "../src/commands/answer.ts";
import { decide } from "../src/commands/decide.ts";
import { render } from "../src/commands/render.ts";
import { sign, writeEvaluation } from "../src/commands/sign.ts";
import { checkSeal, seal, SIGNATURE_FILE, verify } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { checkDecisions, DECISIONS_INDEX, decisionFile, loadDecisions, type Decision, type DecisionFile } from "../src/lib/decisions.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { evaluationHash, summarise, type Evaluation } from "../src/lib/evaluation.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { parseRecordedVia, recordStatement } from "../src/lib/recorded.ts";
import { renderMarkdown } from "../src/lib/report-markdown.ts";
import { renderAnswerSheet, renderStatement } from "../src/lib/statement.ts";
import { confirmDeclaration, decideWrites, writesAllowedNl } from "../src/lib/writes.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { noTerminal, playedTerminal, saysYes, typesSeal } from "./fixtures/terminal.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const cli = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> =>
  promisify(execFile)(process.execPath, [CLI, ...args]).then((output) => ({ ...output, code: 0 }), (error: { stdout: string; stderr: string; code: number }) => error);

const SIGNER = { name: "Een ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", checkedNl: null };
const WHO = { name: "Een productowner", role: "Productowner" };
/** What the agent passes when it records a decision in the conversation. */
const IN_CONVERSATION = { recordedVia: "gesprek", confirmation: "Ja, zo klopt het.", summary: "Het team past het component aan, klaar op 1 december 2026." };

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
  const signature = await sign({ run, ...SIGNER, terminal: typesSeal() });
  assert.equal(signature.recordedVia, "terminal", "a signature says it was confirmed at a terminal");

  // Without a defect: every defect, heaviest first, none decided yet. Listing needs no terminal.
  const listing = await decide({ run, terminal: noTerminal });
  const evaluation = withDefects();
  assert.equal(listing.defects.length, evaluation.defects!.length);
  assert.equal(listing.left, evaluation.defects!.length);
  const ranks = listing.defects.map((view) => ["blokkerend", "hoog", "midden", "laag"].indexOf(view.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  // One defect: what it is and what the report proposes.
  const [first, second] = listing.defects;
  const shown = await decide({ run, defect: first!.id, terminal: noTerminal });
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
  const planned = await decide({ run, defect: first!.id, decision: "gepland", what: "Het team past het component aan.", date: "2026-12-01", ...WHO, ...IN_CONVERSATION });
  assert.equal(planned.written, decisionFile(first!.id));
  assert.equal(planned.left, evaluation.defects!.length - 1);
  const person = saysYes();
  await decide({ run, defect: second!.id, decision: "zienswijze", what: "De organisatie vindt de tekst duidelijk genoeg.", ...WHO, terminal: person });
  assert.match(person.asked[0]!, new RegExp(`^Besluit over gebrek ${second!.id}: .*\\nAndere zienswijze\\nDe organisatie vindt de tekst duidelijk genoeg\\.\\nDoor: Een productowner, Productowner\\nKlopt dit\\? Typ ja`), "the person sees what is recorded before saying yes");
  assert.equal((JSON.parse(readFileSync(join(run, decisionFile(second!.id)), "utf8")) as DecisionFile).recordedVia, "terminal");

  // Recording a decision changes nothing that was sealed or signed.
  const after = (await checkSeal(run))!;
  assert.deepEqual(after.problems, []);
  assert.ok(after.outside.includes(decisionFile(first!.id)) && after.outside.includes(DECISIONS_INDEX), after.outside.join(", "));
  assert.deepEqual(before.problems, []);
  assert.equal(await verify(run), true);

  // A changed decision keeps the earlier one, with how each was recorded.
  await decide({ run, defect: first!.id, decision: "opgelost", what: "Het component is aangepast en staat live.", ...WHO, ...IN_CONVERSATION, confirmation: "Ja, het staat live sinds vorige week." });
  const stored = JSON.parse(readFileSync(join(run, decisionFile(first!.id)), "utf8")) as DecisionFile;
  assert.equal(stored.decision, "opgelost");
  assert.deepEqual([stored.recordedVia, stored.confirmationNl, stored.summaryNl], ["gesprek", "Ja, het staat live sinds vorige week.", IN_CONVERSATION.summary], "the literal confirmation and the summary are kept with the decision");
  assert.equal(stored.name, WHO.name);
  assert.deepEqual(stored.previous.map((earlier) => [earlier.decision, earlier.date, earlier.confirmationNl]), [["gepland", "2026-12-01", IN_CONVERSATION.confirmation]]);
  assert.equal(stored.sealSha256, signature.sealSha256);

  // The signed report has the chapter, with the role and not the name, and how each record came about; the concept that was read has none.
  const signedReport = await render(run);
  // The PDF has the chapter too, and passes the same checks as the rest of the report.
  if (signedReport.pdf !== null) assert.deepEqual(signedReport.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  const report = readFileSync(signedReport.markdown, "utf8");
  const chapter = report.split("## Maatregelen en beslissingen")[1]!.split("\n## ")[0]!;
  assert.ok(chapter.includes(`([${first!.id}](#${first!.id}))`) && chapter.includes("**Opgelost volgens de organisatie, nog niet nagemeten"));
  assert.ok(chapter.includes("  - Besloten door: functie Productowner, vastgelegd in een gesprek, bevestigd op "));
  assert.ok(chapter.includes("  - Eerder besloten: herstel gepland (1 december 2026), functie Productowner, vastgelegd in een gesprek, bevestigd op "));
  assert.ok(chapter.includes("**Andere zienswijze**") && chapter.includes("  - Reden: De organisatie vindt de tekst duidelijk genoeg."));
  assert.ok(/ {2}- Reden: De organisatie vindt de tekst duidelijk genoeg\.\n {2}- Besloten door: functie Productowner, bevestigd in een terminal op /.test(chapter), chapter);
  assert.ok(chapter.includes(`2 van de ${evaluation.defects!.length} gebreken hebben een besluit`));
  assert.ok(chapter.includes(`met een eigen kenmerk: ${(await loadDecisions(run, evaluation.defects)).sha256!.slice(0, 12)}`));
  assert.ok(!report.includes(WHO.name), "the name stays in the file of the decision");
  assert.ok(!report.includes(IN_CONVERSATION.summary), "the summary stays in the file of the decision");
  assert.match(report, /^- Afgetekend door: Een ondertekenaar, Directeur, Gemeente Voorbeeld, op [^,]+, bevestigd in een terminal op /m);
  assert.ok(!readFileSync(join(run, "report", "rapport.md"), "utf8").includes("Maatregelen en beslissingen"));
  assert.deepEqual((await checkSeal(run))!.problems, [], "rendering after a decision leaves the seal whole");
});

test("verify sees a decision that was changed, added or removed outside decide, one about a defect that is gone, and one that does not say how it came about", async () => {
  const run = await sealedRun(false);
  await sign({ run, ...SIGNER, terminal: typesSeal() });
  const [first, second] = (await decide({ run })).defects;
  await decide({ run, defect: first!.id, decision: "onbesloten", ...WHO, terminal: saysYes() });
  await decide({ run, defect: second!.id, decision: "gepland", what: "Het team past het component aan.", date: "2027-01-15", ...WHO, ...IN_CONVERSATION });
  const defects = withDefects().defects;
  const clean = (await checkDecisions(run, defects))!;
  assert.deepEqual([clean.problems, clean.viaTerminal, clean.viaConversation], [[], 1, 1]);

  const path = join(run, decisionFile(first!.id));
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("onbesloten", "opgelost"));
  writeFileSync(join(run, "besluiten", "XYZ-G-0000.json"), canonicalJson({ ...JSON.parse(original), defect: { id: "XYZ-G-0000", titleNl: "Weg", mainCriterion: "1.1.1" } }));
  const problems = (await checkDecisions(run, defects))!.problems;
  assert.deepEqual([...problems].sort(), [`gewijzigd: ${decisionFile(first!.id)}`, "niet in de laag met besluiten: besluiten/XYZ-G-0000.json", "besluiten/XYZ-G-0000.json: het gebrek XYZ-G-0000 staat niet in deze evaluatie"].sort());
  // A decision that does not say how it came about, or one from the conversation without the confirmation, is seen.
  const { recordedVia: _way, ...without } = JSON.parse(original) as DecisionFile;
  writeFileSync(path, canonicalJson(without));
  assert.ok((await checkDecisions(run, defects))!.problems.includes(`${decisionFile(first!.id)}: zegt niet hoe het besluit is vastgelegd (in een terminal, of in een gesprek met de letterlijke bevestiging en de samenvatting)`));
  writeFileSync(path, canonicalJson({ ...without, recordedVia: "gesprek" }));
  assert.ok((await checkDecisions(run, defects))!.problems.some((problem) => problem.startsWith(`${decisionFile(first!.id)}: zegt niet hoe`)));
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
  return { ...evaluation, signature: { name: "N", role: "R", organisation: "O", signedAt: "2026-10-10T08:00:00.000Z", statementNl: "S", evaluationSha256: evaluationHash(evaluation), sealSha256: "5".repeat(64), recordedVia: "terminal" } };
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
  recordedVia: "terminal",
  sealSha256: "5".repeat(64),
  ...fields,
});

test("the statement takes its measures from the decisions, says how each was recorded, and status B says which deviation has no measure with a date", () => {
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
  assert.ok(all.markdown.includes(`Succescriterium ${one!.id} – ${one!.titleNl}: ${defect!.titleNl.replace(/\.$/, "")}: herstel gepland, klaar uiterlijk 1 december 2026: Het team past het component aan (bevestigd in een terminal op 20 oktober 2026 om 12:00)`), all.markdown);
  assert.ok(all.markdown.includes("N (R) heeft voor het onderzoek getekend, bevestigd in een terminal op 10 oktober 2026 om 10:00."), "the statement says how the signature came about");
  assert.ok(renderAnswerSheet(evaluation, input, planned).includes(`- Maatregel bij ${one!.id}: ${defect!.titleNl.replace(/\.$/, "")}: herstel gepland`));

  // A decision from the conversation says so; one that is done also says it was not measured again.
  const talked = planned.map((entry) => (entry.defect.id === defect!.id ? decision(defect!, { decision: "opgelost", recordedVia: "gesprek", confirmationNl: "Ja.", summaryNl: "Het component is aangepast." }) : entry));
  assert.ok(renderStatement(evaluation, input, { concept: false, decisions: talked }).markdown.includes("hersteld op 1 december 2026: Het team past het component aan (nog niet nagemeten; vastgelegd in een gesprek, bevestigd op 20 oktober 2026 om 12:00)"));

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

test("an answer or a decision says how it came about: in the conversation with the literal confirmation and the summary, or at a terminal, and never neither", async () => {
  assert.equal(parseRecordedVia(undefined), undefined);
  assert.equal(parseRecordedVia("gesprek"), "gesprek");
  assert.equal(parseRecordedVia("terminal"), "terminal");
  assert.throws(() => parseRecordedVia("chat"), /--recorded-via is "terminal" .* of "gesprek"/);

  // In the conversation: both the confirmation and the summary, or nothing is recorded.
  await assert.rejects(recordStatement("decide", { recordedVia: "gesprek", summary: "Een samenvatting van het besluit." }, "x", noTerminal), /--confirmation "<letterlijke tekst>".*--summary "<samenvatting>"/);
  await assert.rejects(recordStatement("decide", { recordedVia: "gesprek", confirmation: "Ja." }, "x", noTerminal), /zonder die twee wordt niets vastgelegd/);
  assert.deepEqual(await recordStatement("decide", { recordedVia: "gesprek", confirmation: "  Ja,\n klopt. ", summary: "Een samenvatting van het besluit." }, "x", noTerminal), { recordedVia: "gesprek", confirmationNl: "Ja, klopt.", summaryNl: "Een samenvatting van het besluit." });
  await assert.rejects(recordStatement("decide", { confirmation: "Ja." }, "x", saysYes()), /--confirmation en --summary horen bij --recorded-via gesprek/);
  // Otherwise at an interactive terminal; without one it is refused, with what to do instead.
  await assert.rejects(recordStatement("answer", {}, "x", noTerminal), /Er is hier geen interactieve terminal\. Een mens moet dit zelf draaien.*`! <commando>` in Claude Code; of de assistent legt het vast met --recorded-via gesprek/);
  await assert.rejects(recordStatement("answer", { recordedVia: "terminal" }, "x", noTerminal), /geen interactieve terminal/);
  await assert.rejects(recordStatement("answer", {}, "x", playedTerminal(() => "nee")), /niet bevestigd: er is niets vastgelegd/);
  assert.deepEqual(await recordStatement("answer", {}, "x", saysYes()), { recordedVia: "terminal" });

  // decide refuses before it writes anything.
  const run = await sealedRun(false);
  await sign({ run, ...SIGNER, terminal: typesSeal() });
  const [first] = (await decide({ run })).defects;
  const asked = { run, defect: first!.id, decision: "onbesloten", ...WHO };
  await assert.rejects(decide({ ...asked, terminal: noTerminal }), /geen interactieve terminal/);
  await assert.rejects(decide({ ...asked, recordedVia: "gesprek", confirmation: "Ja." }), /--summary/);
  assert.equal(existsSync(join(run, decisionFile(first!.id))), false, "nothing was written");
  // From the command line, with no terminal: the same refusal.
  const refused = await cli("decide", "--run", run, "--defect", first!.id, "--decision", "onbesloten", "--name", WHO.name, "--role", WHO.role);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /geen interactieve terminal/);
  const recorded = await cli("decide", "--run", run, "--defect", first!.id, "--decision", "onbesloten", "--name", WHO.name, "--role", WHO.role, "--recorded-via", "gesprek", "--confirmation", "Ja, dat klopt.", "--summary", "Er is nog geen besluit over dit gebrek.");
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal((JSON.parse(readFileSync(join(run, decisionFile(first!.id)), "utf8")) as DecisionFile).confirmationNl, "Ja, dat klopt.");
  assert.match((await cli("render", "--run", run, "--confirmation", "Ja.")).stderr, /--recorded-via, --confirmation en --summary horen bij answer en decide/);

  // An answer keeps how it was recorded into the evaluation; the confirmation stays in the file of the run.
  const answers = mkdtempSync(join(tmpdir(), "recorded-"));
  mkdirSync(join(answers, "antwoorden"));
  const answer = { pointNl: "mens nodig: luister met een schermlezer.", didNl: "Geluisterd met NVDA op de startpagina.", outcome: "passed", role: "Tester", name: "T", answeredAt: "2026-10-20T10:00:00.000Z", recordedVia: "gesprek", confirmationNl: "Ja.", summaryNl: "NVDA leest de melding voor.", verdict: { round: "final", sha256: "ab" } };
  writeFileSync(join(answers, "antwoorden", "1.1.1.json"), canonicalJson({ criterion: "1.1.1", answers: [answer] }));
  const loaded = await loadAnswers(answers, "1.1.1", { round: "final", sha256: "ab", verdict: {} as never });
  assert.equal(loaded.answers[0]!.recordedVia, "gesprek");
  assert.ok(!("name" in loaded.answers[0]!) && !("confirmationNl" in loaded.answers[0]!));
  const evaluation = exampleEvaluation();
  const criterion = evaluation.criteria.find((entry) => entry.id === "1.1.1")!;
  criterion.answers = loaded.answers;
  assert.ok(renderMarkdown(evaluation).includes("(functie: Tester, vastgelegd in een gesprek, bevestigd op 20 oktober 2026 om 12:00)"));
  criterion.answers = [{ ...loaded.answers[0]!, recordedVia: "terminal" }];
  assert.ok(renderMarkdown(evaluation).includes("(functie: Tester, bevestigd in een terminal op 20 oktober 2026 om 12:00)"));
});

test("only a person at an interactive terminal signs: the seal is typed back, and a conversation or a missing terminal is refused", async () => {
  const run = await sealedRun(false);
  await assert.rejects(sign({ run, ...SIGNER, terminal: noTerminal }), /sign legt de assistent nooit vast: het vraagt een bevestiging van een mens in een interactieve terminal.*`! <commando>` in Claude Code/);
  await assert.rejects(sign({ run, ...SIGNER, terminal: playedTerminal(() => "12345678") }), /niet bevestigd: dat is niet de eerste 8 tekens van het zegel/);
  assert.equal(existsSync(join(run, SIGNATURE_FILE)), false, "nothing was signed");

  const signer = typesSeal();
  const signature = await sign({ run, ...SIGNER, terminal: signer });
  assert.equal(signature.recordedVia, "terminal");
  assert.ok(signer.asked[0]!.includes(`Zegel: ${signature.sealSha256}\nNaam: Een ondertekenaar\nFunctie: Directeur\n`), "the signer sees the seal, name and role");
  assert.ok(signer.asked[0]!.endsWith("Typ ter bevestiging de eerste 8 tekens van het zegel: "));

  // From the command line: no terminal, or the conversation, is refused, and nothing is signed again.
  const fresh = await sealedRun(false);
  const args = ["sign", "--run", fresh, "--name", SIGNER.name, "--role", SIGNER.role, "--organisation", SIGNER.organisation];
  const noTty = await cli(...args);
  assert.equal(noTty.code, 1);
  assert.match(noTty.stderr, /sign legt de assistent nooit vast.*interactieve terminal/);
  assert.match((await cli(...args, "--recorded-via", "gesprek")).stderr, /tekenen legt de assistent nooit vast, ook niet na een bevestiging in het gesprek/);
  assert.match((await cli(...args, "--recorded-via", "terminal")).stderr, /--recorded-via, --confirmation en --summary horen bij answer en decide/);
  assert.equal(existsSync(join(fresh, SIGNATURE_FILE)), false);
});

test("only a person at an interactive terminal declares a test environment: the origin is typed back, and a conversation or a missing terminal is refused", async () => {
  const permission = decideWrites("https://test.example.nl", { testEnvironment: "https://test.example.nl", declaredBy: "Een beheerder, Beheerder" })!;
  assert.equal(permission.recordedVia, undefined, "nothing is declared before the person confirmed");
  await assert.rejects(confirmDeclaration(permission, noTerminal), /inventory --declared-by legt de assistent nooit vast.*interactieve terminal/);
  await assert.rejects(confirmDeclaration(permission, playedTerminal(() => "https://www.example.nl")), /niet bevestigd: dat is niet de origin/);
  const person = playedTerminal(() => " https://test.example.nl ");
  const confirmed = await confirmDeclaration(permission, person);
  assert.equal(confirmed.recordedVia, "terminal");
  assert.ok(person.asked[0]!.includes("Origin: https://test.example.nl\nNaam: Een beheerder\nFunctie: Beheerder\n"));
  assert.match(writesAllowedNl(confirmed), /verklaard door iemand met de functie Beheerder, bevestigd in een terminal op .+ \(de naam staat/);
  // A local address needs no declaration and asks nothing.
  const local = decideWrites("http://127.0.0.1:4710/", { allowWrites: true })!;
  assert.deepEqual(await confirmDeclaration(local, noTerminal), local);

  // From the command line: refused before anything is fetched, and no manifest is written.
  const dir = mkdtempSync(join(tmpdir(), "declare-"));
  const args = ["inventory", "https://www.example.invalid/", "--out", dir, "--test-environment", "https://www.example.invalid", "--declared-by", "Een beheerder, Beheerder"];
  const noTty = await cli(...args);
  assert.equal(noTty.code, 1);
  assert.match(noTty.stderr, /inventory --declared-by legt de assistent nooit vast.*interactieve terminal/);
  assert.match((await cli(...args, "--recorded-via", "gesprek")).stderr, /de verklaring dat er verstuurd mag worden legt de assistent nooit vast/);
  assert.equal(existsSync(join(dir, "manifest.json")), false);
});
