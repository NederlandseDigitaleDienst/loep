import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkClassification, classificationIsCurrent, compareTasks, documentOutOfReach, mergeRun, validateClassification, type Classification, type CompareInput } from "../src/commands/compare-findings.ts";
import type { ReferenceAudit } from "../src/commands/compare.ts";
import { readJson } from "../src/lib/canonical.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const REFERENCE: ReferenceAudit = {
  wcagVersion: "2.2",
  sampleNote: "Acht pagina's en één pdf-bestand.",
  outcomeNote: "Het rapport noemt alleen criteria met bevindingen.",
  failed: ["1.1.1", "1.4.3", "2.4.2", "2.4.7"],
  findings: [
    { id: "R1", criterion: "1.1.1", page: "/status", descriptionNl: "Bolletje voor de status heeft geen tekstalternatief" },
    { id: "R2", criterion: "1.4.3", page: "alle", descriptionNl: "Grijze hulptekst onder velden is te licht" },
    { id: "R3", criterion: "2.4.7", page: "/contact", descriptionNl: "Geen focusrand op de verzendknop" },
    { id: "R4", criterion: "2.4.2", page: "/", descriptionNl: "Titel eindigt op losse tekens" },
    { id: "R5", criterion: "1.3.1", page: "/nieuws", descriptionNl: "Vette tekst als tussenkop", alsoCriteria: ["2.4.4"] },
    // An old Word file: a kind the toolbox counts and does not read.
    { id: "R6", criterion: "1.1.1", page: "jaarverslag.doc", descriptionNl: "Logo zonder tekstalternatief", medium: "document" },
  ],
};

interface Run {
  dir: string;
  input: CompareInput;
  ids: Record<string, string>;
}

/** A run directory with an evaluation and one page of evidence: enough for the comparison, no browser involved. */
async function makeRun(reference: ReferenceAudit = REFERENCE, taskCriteria?: string[]): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), "compare-findings-"));
  const evaluation = exampleEvaluation();
  await writeFile(join(dir, "evaluation.json"), JSON.stringify(evaluation));
  const slug = evaluation.sample.items[0]!.slug;
  await mkdir(join(dir, "pages", slug, "probes"), { recursive: true });
  await mkdir(join(dir, "tasks", "2.4.2"), { recursive: true });
  writeFileSync(join(dir, "pages", slug, "page.html"), "<title>Start % % %</title>");
  writeFileSync(join(dir, "pages", slug, "probes", "reflow.json"), "{}");
  writeFileSync(join(dir, "tasks", "2.4.2", "dossier.json"), "{}");
  writeFileSync(join(dir, "reference.json"), JSON.stringify(reference));
  if (taskCriteria) writeFileSync(join(dir, "tasks", "index.json"), JSON.stringify({ tasks: taskCriteria.map((criterion) => ({ criterion })) }));
  await compareTasks(dir, join(dir, "reference.json"));
  const input = await readJson<CompareInput>(join(dir, "compare", "invoer.json"));
  const ids: Record<string, string> = {};
  for (const finding of input.ours) ids[`${finding.criterion}:${finding.titleNl.split(" ")[0]}`] = finding.id;
  return { dir, input, ids };
}

function classification(run: Run, changes: { reference?: Record<string, Partial<Classification["reference"][number]>>; ours?: Record<string, Partial<Classification["ours"][number]>> } = {}): Classification {
  const page = join(run.input.legend.P1!.files, "page.html");
  const base: Classification = {
    schema: "loep/compare-findings/1",
    reference: [
      { id: "R1", class: "gevonden", ours: [run.ids["1.1.1:Statuspictogram"]!], evidence: [], reasonNl: "Zelfde bolletje op de statuspagina." },
      { id: "R2", class: "gevonden", ours: [run.ids["1.4.3:Grijze"]!], evidence: [], reasonNl: "Zelfde hulptekst, zelfde kleur." },
      { id: "R3", class: "deels", ours: [run.ids["2.4.7:Focus"]!], evidence: [], reasonNl: "Wel focus gemeld, maar op de kaarten en niet op de knop." },
      { id: "R4", class: "gemist-bewijs-beoordeling", ours: [], evidence: ["tasks/2.4.2/dossier.json"], reasonNl: "De titel met losse tekens staat in het dossier." },
      { id: "R5", class: "gemist-geen-bewijs", ours: [], evidence: [], reasonNl: "De nieuwspagina is niet gemeten in deze run." },
      { id: "R6", class: "buiten-bereik", ours: [], evidence: [], reasonNl: "Een oud Word-bestand wordt niet ingelezen." },
    ],
    ours: [
      { id: run.ids["2.4.4:Vier"]!, class: "discutabel", evidence: [], reasonNl: "De kop boven elke link noemt het bericht." },
      { id: run.ids["4.1.2:Menuknop"]!, class: "terecht", evidence: [page], reasonNl: "De knop heeft geen aria-expanded in de code." },
      { id: run.ids["4.1.2:Zoekveld"]!, class: "onterecht", evidence: [], reasonNl: "Het veld heeft een label dat visueel verborgen is." },
    ],
  };
  for (const entry of base.reference) Object.assign(entry, changes.reference?.[entry.id]);
  for (const entry of base.ours) Object.assign(entry, changes.ours?.[entry.id]);
  return base;
}

const write = (run: Run, round: "a" | "b", value: unknown): Promise<void> => writeFile(join(run.dir, "compare", `${round}.json`), JSON.stringify(value));

test("compare tasks: input, candidates, fixed document findings and two prompts", async () => {
  const run = await makeRun();
  assert.equal(run.input.reference.length, 6);
  assert.equal(run.input.ours.length, 6);
  assert.deepEqual(run.input.reference.find((finding) => finding.id === "R6")!.fixed?.class, "buiten-bereik");
  assert.match(run.input.reference.find((finding) => finding.id === "R6")!.fixed!.reasonNl, /Word \(doc\).*leest haar niet in/);
  assert.ok(run.input.documents.criteria.includes("1.1.1") && !run.input.documents.criteria.includes("1.4.3"));
  // Candidates come from the criterion and from alsoCriteria, and decide nothing.
  assert.deepEqual(run.input.reference.find((finding) => finding.id === "R5")!.candidates, [run.ids["2.4.4:Vier"]]);
  assert.equal(run.input.reference.find((finding) => finding.id === "R4")!.ourOutcome, "passed");
  assert.ok(run.input.legend.P1!.evidence.some((file) => file.endsWith(join("probes", "reflow.json"))));
  assert.equal(run.input.criteria.find((criterion) => criterion.id === "2.4.2")!.dossier, join("tasks", "2.4.2", "dossier.json"));
  assert.equal(run.input.criteria.find((criterion) => criterion.id === "1.1.1")!.dossier, null);
  assert.ok(!("findings" in run.input.audit));
  const [promptA, promptB] = [await readFile(join(run.dir, "compare", "opdracht-a.md"), "utf8"), await readFile(join(run.dir, "compare", "opdracht-b.md"), "utf8")];
  assert.match(promptA, /--round a/);
  assert.match(promptB, /compare[/\\]b\.json/);
  assert.doesNotMatch(promptA, /\{\{/);
  assert.equal(promptA.replaceAll("--round a", "").replaceAll("a.json", ""), promptB.replaceAll("--round b", "").replaceAll("b.json", ""));
});

test("compare tasks refuse a reference without findings", async () => {
  const { findings: _findings, ...bare } = REFERENCE;
  await assert.rejects(makeRun(bare), /no "findings"/);
});

test("classification: a complete one passes, and each rule is enforced", async () => {
  const run = await makeRun();
  const problems = (value: Classification): string[] => validateClassification(value, run.input, run.dir);
  assert.deepEqual(problems(classification(run)), []);

  const missing = classification(run);
  missing.reference.pop();
  assert.match(problems(missing).join("\n"), /R6 is not classified/);

  const twice = classification(run);
  twice.reference.push({ ...twice.reference[0]! });
  assert.match(problems(twice).join("\n"), /classified more than once/);

  assert.match(problems(classification(run, { reference: { R1: { ours: [] } } })).join("\n"), /"gevonden" must name at least one/);
  assert.match(problems(classification(run, { reference: { R1: { ours: ["VRB-9.9.9-0000"] } } })).join("\n"), /not one of our findings/);
  assert.match(problems(classification(run, { reference: { R4: { evidence: [] } } })).join("\n"), /needs at least one evidence path/);
  assert.match(problems(classification(run, { reference: { R4: { evidence: ["tasks/9.9.9/dossier.json"] } } })).join("\n"), /does not exist in the run/);
  assert.match(problems(classification(run, { reference: { R4: { evidence: ["../reference.json"] } } })).join("\n"), /relative to the run/);
  assert.match(problems(classification(run, { reference: { R4: { class: "niet-meer-aanwezig", evidence: [] } } })).join("\n"), /needs at least one evidence path/);
  assert.match(problems(classification(run, { reference: { R5: { ours: [run.ids["2.4.4:Vier"]!] } } })).join("\n"), /cannot name a finding of ours/);
  assert.match(problems(classification(run, { reference: { R5: { reasonNl: "" } } })).join("\n"), /reasonNl/);
  assert.match(problems(classification(run, { reference: { R6: { class: "gemist-geen-bewijs" } } })).join("\n"), /fixes this finding as "buiten-bereik"/);
  assert.match(problems(classification(run, { reference: { R5: { class: "gemist" as never } } })).join("\n"), /class must be one of/);

  // A finding of ours is a counterpart or is classified itself: not both, not neither.
  const both = classification(run);
  both.ours.push({ id: run.ids["1.1.1:Statuspictogram"]!, class: "terecht", evidence: [], reasonNl: "Staat ook als tegenhanger genoemd." });
  assert.match(problems(both).join("\n"), /cannot be classified here as well/);
  const neither = classification(run);
  neither.ours.pop();
  assert.match(problems(neither).join("\n"), /neither a counterpart nor classified/);
});

test("classification against an answer key: the defect cannot be gone or out of reach", async () => {
  const run = await makeRun({ ...REFERENCE, kind: "answer-key" });
  const page = join(run.input.legend.P1!.files, "page.html");
  const problems = validateClassification(classification(run, { reference: { R4: { class: "niet-meer-aanwezig", evidence: [page] }, R5: { class: "buiten-bereik" } } }), run.input, run.dir).join("\n");
  assert.match(problems, /\(R4\): "niet-meer-aanwezig" is not possible against an answer key/);
  assert.match(problems, /\(R5\): "buiten-bereik" is not possible against an answer key/);
  // The document finding that the input fixed stays allowed.
  assert.doesNotMatch(problems, /\(R6\)/);
});

test("check writes a stamp, and the stamp goes stale when the classification or the input changes", async () => {
  const run = await makeRun();
  await write(run, "a", classification(run, { reference: { R1: { ours: [] } } }));
  assert.ok((await checkClassification(run.dir, "a")).length > 0);
  assert.equal(await classificationIsCurrent(run.dir, "a"), false);

  await write(run, "a", classification(run));
  assert.deepEqual(await checkClassification(run.dir, "a"), []);
  assert.equal(await classificationIsCurrent(run.dir, "a"), true);
  await assert.rejects(mergeRun(run.dir, join(run.dir, "out")), /classification b has no current stamp/);

  await write(run, "a", classification(run, { reference: { R5: { reasonNl: "Achteraf aangepast zonder controle." } } }));
  assert.equal(await classificationIsCurrent(run.dir, "a"), false);
  assert.deepEqual(await checkClassification(run.dir, "a"), []);

  // New tasks from another reference: the old classification no longer belongs to the input.
  writeFileSync(join(run.dir, "reference.json"), JSON.stringify({ ...REFERENCE, findings: REFERENCE.findings!.slice(0, 5) }));
  await compareTasks(run.dir, join(run.dir, "reference.json"));
  assert.equal(await classificationIsCurrent(run.dir, "a"), false);
});

test("merge: two equal classifications agree everywhere", async () => {
  const run = await makeRun();
  for (const round of ["a", "b"] as const) {
    await write(run, round, classification(run));
    assert.deepEqual(await checkClassification(run.dir, round), []);
  }
  const summary = await mergeRun(run.dir, join(run.dir, "out"));
  assert.deepEqual([summary.reference.total, summary.reference.documents, summary.reference.documentsOutOfReach, summary.reference.counted], [6, 1, 1, 5]);
  assert.equal(summary.reference.disagreed, 0);
  assert.equal(summary.reference.agreement, 1);
  assert.deepEqual(summary.reference.classes.gevonden, { a: 2, b: 2, agreed: 2 });
  assert.deepEqual(summary.reference.coarse.gemist, { a: 2, b: 2, agreed: 2 });
  // The finding about a document that is not read is in no count.
  assert.deepEqual(summary.reference.classes["buiten-bereik"], { a: 0, b: 0, agreed: 0 });
  assert.deepEqual(summary.reference.foundShare.agreed, { ofCounted: 0.4, ofStillPresent: 0.4 });
  assert.deepEqual(summary.ours.classes.tegenhanger, { a: 3, b: 3, agreed: 3 });
  assert.equal(summary.ours.shareWithoutCounterpart.onterecht.agreed, 0.333);
  assert.deepEqual(summary.ours.duplicates.a, { referenceFindings: 0, surplus: 0 });
  // The comparison per criterion sits in the same file: 2.4.2 was failed by the reference and passed by us.
  assert.deepEqual(summary.criteria.missed, [{ id: "2.4.2", ours: "passed" }]);
  const markdown = await readFile(join(run.dir, "out", "bevindingen.md"), "utf8");
  assert.match(markdown, /Nergens\./);
  assert.match(markdown, /\| Gevonden \| 2 \(40%\) \| 2 \(40%\) \| 2 \(40%\) \|/);
  assert.match(markdown, /goedkeurden of niet van toepassing noemden: 1 \(2\.4\.2\)/);
  // What gets committed names no absolute path.
  const written = markdown + (await readFile(join(run.dir, "out", "bevindingen.json"), "utf8"));
  assert.ok(!written.includes(run.dir));
  assert.ok(!written.includes(String.fromCharCode(0x2014)));
});

test("a document is out of reach only when the toolbox does not examine it", async () => {
  const base = "https://voorbeeld.overheid.example/";
  const criteria = ["1.1.1", "1.3.1", "2.4.2"];
  const finding = (page: string, criterion = "1.1.1", alsoCriteria?: string[]) => ({ id: "R", criterion, page, descriptionNl: "Een gebrek in een document", medium: "document" as const, ...(alsoCriteria ? { alsoCriteria } : {}) });
  // A pdf or a current office file on the site itself, on a criterion documents are judged on: within reach.
  assert.equal(documentOutOfReach(finding("jaarverslag.pdf"), base, criteria), null);
  assert.equal(documentOutOfReach(finding("/bestanden/nota.docx", "1.3.1"), base, criteria), null);
  assert.equal(documentOutOfReach(finding(`${base}bestanden/tabel.ods`, "2.4.2"), base, criteria), null);
  // Another origin, a kind that is not read, a criterion documents are not judged on: out of reach, each with its reason.
  assert.match(documentOutOfReach(finding("https://elders.example/jaarverslag.pdf"), base, criteria)!, /ander domein/);
  assert.match(documentOutOfReach(finding("/bestanden/nota.rtf"), base, criteria)!, /soort rtf/);
  assert.match(documentOutOfReach(finding("jaarverslag.pdf", "1.4.3"), base, criteria)!, /niet op criterium 1\.4\.3/);
  // The same defect may have been reported under another criterion that documents are judged on.
  assert.equal(documentOutOfReach(finding("jaarverslag.pdf", "1.4.3", ["1.1.1"]), base, criteria), null);
  // A place that is described and not an address: the criterion decides.
  assert.equal(documentOutOfReach(finding("het jaarverslag op de pagina Publicaties"), base, criteria), null);

  // In a run, a finding about a pdf on the site is classified and counted like any other finding.
  const reference = { ...REFERENCE, findings: REFERENCE.findings!.map((entry) => (entry.id === "R6" ? { ...entry, page: "jaarverslag.pdf" } : entry)) };
  const run = await makeRun(reference);
  assert.equal(run.input.reference.find((entry) => entry.id === "R6")!.fixed, undefined);
  const missed = classification(run, { reference: { R6: { class: "gemist-geen-bewijs", reasonNl: "Het document is in deze run niet ingelezen." } } });
  for (const round of ["a", "b"] as const) {
    await write(run, round, missed);
    assert.deepEqual(await checkClassification(run.dir, round), []);
  }
  const summary = await mergeRun(run.dir, join(run.dir, "out"));
  assert.deepEqual([summary.reference.total, summary.reference.documents, summary.reference.documentsOutOfReach, summary.reference.counted], [6, 1, 0, 6]);
  assert.deepEqual(summary.reference.coarse.gemist, { a: 3, b: 3, agreed: 3 });
  assert.match(await readFile(join(run.dir, "out", "bevindingen.md"), "utf8"), /waarvan 1 over een document\. Ze tellen allemaal mee\./);
});

test("merge: disagreement is its own number and is never resolved", async () => {
  const run = await makeRun();
  const page = join(run.input.legend.P1!.files, "page.html");
  await write(run, "a", classification(run));
  const b = classification(run, {
    reference: {
      // Same on the main line, different on the reason it was missed.
      R4: { class: "gemist-bewijs-dossier", evidence: [page] },
      // Different on the main line: B sees a second finding of ours as covering it.
      R5: { class: "deels", ours: [run.ids["2.4.4:Vier"]!] },
      // B puts two of our findings under one reference finding.
      R1: { ours: [run.ids["1.1.1:Statuspictogram"]!, run.ids["4.1.2:Zoekveld"]!] },
      // The page is in the run and the text is gone: only B says so.
      R3: { class: "niet-meer-aanwezig", ours: [], evidence: [page] },
    },
    ours: { [run.ids["4.1.2:Menuknop"]!]: { class: "discutabel" } },
  });
  b.ours = b.ours.filter((entry) => entry.id !== run.ids["2.4.4:Vier"] && entry.id !== run.ids["4.1.2:Zoekveld"]);
  b.ours.push({ id: run.ids["2.4.7:Focus"]!, class: "terecht", evidence: [], reasonNl: "De kaarten hebben geen focusstijl in de meting." });
  await write(run, "b", b);
  for (const round of ["a", "b"] as const) assert.deepEqual(await checkClassification(run.dir, round), []);

  const summary = await mergeRun(run.dir, join(run.dir, "out"));
  assert.equal(summary.reference.disagreed, 3);
  assert.equal(summary.reference.disagreedCoarse, 2);
  assert.equal(summary.reference.agreement, 0.4);
  assert.equal(summary.reference.agreementCoarse, 0.6);
  assert.deepEqual(summary.reference.classes.gevonden, { a: 2, b: 2, agreed: 2 });
  assert.deepEqual(summary.reference.classes.deels, { a: 1, b: 1, agreed: 0 });
  assert.deepEqual(summary.reference.coarse.gemist, { a: 2, b: 1, agreed: 1 });
  assert.deepEqual(summary.reference.stillPresent, { a: 5, b: 4, agreed: 5 });
  assert.deepEqual(summary.reference.foundShare.b, { ofCounted: 0.4, ofStillPresent: 0.5 });
  assert.equal(summary.findings.find((finding) => finding.id === "R4")!.agreed, null);
  assert.equal(summary.findings.find((finding) => finding.id === "R4")!.agreedCoarse, "gemist");

  // Ours: A has 3 counterparts, B has 4 (one moved from "onterecht", one from "discutabel", one lost to "terecht").
  assert.deepEqual(summary.ours.classes.tegenhanger, { a: 3, b: 4, agreed: 2 });
  assert.equal(summary.ours.disagreed, 4);
  assert.deepEqual(summary.ours.duplicates.b, { referenceFindings: 1, surplus: 1 });
  assert.deepEqual(summary.ours.duplicates.agreed, { referenceFindings: 0, surplus: 0 });
  const markdown = await readFile(join(run.dir, "out", "bevindingen.md"), "utf8");
  assert.match(markdown, /oneens over een bevinding van de referentie: 3 van 5 \(60%\)/);
  assert.match(markdown, /\| R4 \| Gemist, bewijs aanwezig, beoordeling ging mis \| Gemist, bewijs aanwezig, niet in het dossier \|/);
  assert.match(markdown, /Oneens: Deels \/ Niet meer aanwezig/);
});

test("a run with tasks for part of the criteria classifies only the findings under those, and says how many it left out", async () => {
  // 2.4.4 is no criterion of R5, but one it also touches; R6 is a document out of reach under 1.1.1.
  const run = await makeRun(REFERENCE, ["1.1.1", "2.4.4", "4.1.2"]);
  assert.deepEqual(run.input.reference.map((finding) => finding.id), ["R1", "R5", "R6"]);
  assert.deepEqual(run.input.scope, { criteria: ["1.1.1", "2.4.4", "4.1.2"], leftOut: ["R2", "R3", "R4"] });
  assert.deepEqual(run.input.audit.failed, ["1.1.1"], "a criterion the run did not judge is not counted as missed");
  assert.match(run.input.noteNl, /de 3 bevindingen van de referentie onder andere criteria staan er niet in/);

  const scoped = classification(run);
  scoped.reference = scoped.reference.filter((entry) => ["R1", "R5", "R6"].includes(entry.id));
  // Findings of the evaluation under criteria without a task do not occur in a real run; here they are classified like the others.
  scoped.ours.push(
    { id: run.ids["1.4.3:Grijze"]!, class: "terecht", evidence: [], reasonNl: "Zelfde hulptekst, zelfde kleur." },
    { id: run.ids["2.4.7:Focus"]!, class: "terecht", evidence: [], reasonNl: "De kaarten hebben geen focusstijl." },
  );
  assert.match(validateClassification(classification(run), run.input, run.dir).join("\n"), /\(R2\): id is not a finding of the reference/);
  for (const round of ["a", "b"] as const) {
    await write(run, round, scoped);
    assert.deepEqual(await checkClassification(run.dir, round), []);
  }
  const summary = await mergeRun(run.dir, join(run.dir, "out"));
  assert.deepEqual([summary.reference.total, summary.reference.leftOut, summary.reference.counted], [3, 3, 2]);
  assert.deepEqual(summary.criteria.missed, [], "2.4.2 was not judged, so it is not missed");
  assert.match(await readFile(join(run.dir, "out", "bevindingen.md"), "utf8"), /3 bevindingen van de referentie vallen onder criteria die deze run niet beoordeelde/);

  // A run with tasks for every criterion of the reference leaves nothing out and has no scope.
  const full = await makeRun(REFERENCE, ["1.1.1", "1.3.1", "1.4.3", "2.4.2", "2.4.7"]);
  assert.equal(full.input.reference.length, 6);
  assert.equal(full.input.scope, undefined);
  assert.deepEqual(full.input.audit.failed, REFERENCE.failed);
});
