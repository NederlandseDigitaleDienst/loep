import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkMerge, merge } from "../src/commands/merge.ts";
import { checkWeigh, weigh } from "../src/commands/weigh.ts";
import { canonicalJson, readJson } from "../src/lib/canonical.ts";
import { mergeFindings } from "../src/lib/defects.ts";
import { summarise, type Evaluation, type ReportFinding } from "../src/lib/evaluation.ts";
import { EVERYONE, GROUP_IDS, GROUPS, groupLabelNl, groupsFor } from "../src/lib/groups.ts";
import { applyWeighing, clearWeighing, criterionGroups, severityOf, validateWeighing, weighingInput, type Affected, type WeighingProposal } from "../src/lib/weighing.ts";
import { CRITERIA } from "../src/lib/wcag.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

type Draft = Partial<ReportFinding> & { where: string };

/** The example evaluation with exactly these findings, grouped into defects by the fixed rules. A finding is "T-<criterion>-<n>". */
function evaluationWith(byCriterion: Record<string, Draft[]>): Evaluation {
  const evaluation = exampleEvaluation();
  for (const criterion of evaluation.criteria) {
    const drafts = byCriterion[criterion.id] ?? [];
    criterion.outcome = drafts.length > 0 ? "failed" : criterion.outcome === "failed" ? "passed" : criterion.outcome;
    criterion.findings = drafts.map(({ where, ...rest }, index) => ({
      titleNl: `Probleem onder ${criterion.id}`,
      observedNl: "Wat er mis is.",
      impactNl: "Wie er last van heeft.",
      fixNl: "Wat er moet gebeuren.",
      severity: "midden",
      owner: "techniek",
      component: null,
      locations: [{ page: "P01", where }],
      pagesAffected: "P01",
      evidence: ["engine"],
      id: `T-${criterion.id}-${index + 1}`,
      criterion: criterion.id,
      ...rest,
    }));
  }
  evaluation.summary = summarise(evaluation.criteria);
  evaluation.defects = mergeFindings(evaluation);
  return evaluation;
}

/** A search window without a heading (1.3.1) and without a name (4.1.2) at one place, a pale link, and a link whose hidden name misses a letter. */
const weighCase = (): Evaluation =>
  evaluationWith({
    "1.3.1": [{ where: "#modalSearch > header > div", severity: "laag" }],
    "4.1.2": [{ where: "#modalSearch > header > div", severity: "midden" }],
    "1.4.3": [{ where: "#page > footer > a", severity: "midden" }],
    "2.5.3": [{ where: "#page > header > a.logo", severity: "laag" }],
  });

const TEXT = "Ze springen met de schermlezer van kop naar kop. Het venster heeft geen kop en geen naam.";
const affected = (group: Affected["group"], consequence: Affected["consequence"], rest: Partial<Affected> = {}): Affected => ({ group, consequence, textNl: TEXT, ...rest });

/** A weighing of the case that passes: the window needed to search, the link beside every task, the logo without a consequence. */
function weighingFor(): WeighingProposal {
  return {
    tasks: [
      { id: "zoeken", nameNl: "Iets opzoeken" },
      { id: "afspraak", nameNl: "Een afspraak maken" },
    ],
    findings: [
      { finding: "T-1.3.1-1", task: "zoeken", affected: [affected("no-vision", "effort"), affected("cognitive", "effort")] },
      { finding: "T-4.1.2-1", task: "zoeken", blocksNl: "Zonder naam weet de bezoeker niet dat dit het zoekvenster is, en zoeken is de enige weg naar het antwoord.", affected: [affected("no-vision", "cannot")] },
      { finding: "T-1.4.3-1", task: null, affected: [affected("low-vision", "effort")] },
      {
        finding: "T-2.5.3-1",
        task: null,
        affected: [],
        unaffected: [
          { group: "limited-manipulation", sameNl: "Zegt de tekst die op de link staat, en de link gaat open." },
          { group: "limited-reach", sameNl: "Tikt op de link zoals elke andere bezoeker dat doet." },
        ],
      },
    ],
  };
}

/** The entries of a weighing by what they are about, so a test names the finding and not its place in the list. */
const WINDOW_HEADING = 0;
const WINDOW_NAME = 1;
const LINK = 2;
const LOGO = 3;

const refused = (evaluation: Evaluation, change: (proposal: WeighingProposal) => void): string => {
  const proposal = weighingFor();
  change(proposal);
  return validateWeighing(proposal, evaluation).join("\n");
};

test("every criterion loep evaluates names the groups it is essential for, and says where that comes from", () => {
  assert.deepEqual(GROUPS.map((group) => group.id), [...GROUP_IDS]);
  for (const group of GROUPS) assert.ok(/^4\.2\.\d+$/.test(group.clause) && group.labelNl.startsWith("mensen ") && group.howNl.length > 60, group.id);
  for (const criterion of CRITERIA) {
    const groups = groupsFor(criterion.id);
    assert.ok(groups && groups.primary.length > 0 && groups.source.length > 0, `${criterion.id} has no group`);
    for (const id of [...groups.primary, ...groups.secondary]) assert.ok((GROUP_IDS as readonly string[]).includes(id), `${criterion.id}: ${id}`);
    assert.equal(new Set([...groups.primary, ...groups.secondary]).size, groups.primary.length + groups.secondary.length, `${criterion.id} names a group twice`);
  }
  // Rows of table B.2 of EN 301 549, read from the standard.
  assert.deepEqual(groupsFor("1.3.1"), { primary: ["no-vision"], secondary: ["low-vision", "cognitive"], source: "EN 301 549 V3.2.1, tabel B.2" });
  assert.deepEqual(groupsFor("2.4.6")!.secondary, ["no-hearing", "no-speech"]);
  assert.deepEqual(groupsFor("2.5.4"), { primary: ["limited-manipulation", "limited-reach"], secondary: ["no-vision", "low-vision", "cognitive"], source: "EN 301 549 V3.2.1, tabel B.2" });
  assert.deepEqual(groupsFor("4.1.3")!.primary.length, 9);
  // The table names only limited vision for 1.3.5; the Understanding document names memory and motor too.
  assert.deepEqual(groupsFor("1.3.5")!.primary, ["low-vision", "limited-manipulation", "cognitive"]);
  // Not in the table: the criteria of WCAG 2.2 alone.
  for (const id of ["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]) assert.equal(groupsFor(id)!.source, "Understanding WCAG 2.2, Benefits", id);
  assert.deepEqual(criterionGroups("4.1.2"), ["no-vision", "low-vision", "limited-manipulation"]);
  assert.equal(groupLabelNl("no-vision"), "mensen die niet zien");
  assert.equal(groupLabelNl(EVERYONE), "alle bezoekers");
});

test("the severity follows from the heaviest consequence, and a core task makes what a group can not do blocking", () => {
  const of = (consequence: Affected["consequence"], task: string | null) => severityOf({ task, affected: [affected("cognitive", "effort"), affected("no-vision", consequence)] });
  assert.deepEqual([of("cannot", "t"), of("cannot", "all"), of("cannot", null)], ["blokkerend", "blokkerend", "hoog"]);
  // A detour and more effort weigh the same at a core task and beside it: the task then only orders the work list.
  assert.deepEqual([of("detour", "t"), of("detour", null), of("effort", "t"), of("effort", null)], ["midden", "midden", "laag", "laag"]);
  // The group that is hit hardest counts, wherever it stands in the list.
  assert.equal(severityOf({ task: null, affected: [affected("low-vision", "effort"), affected("no-vision", "cannot")] }), "hoog");
  // A finding without a consequence stays a finding, on the lowest step, also at a core task.
  assert.equal(severityOf({ task: "t", affected: [] }), "laag");
});

test("a weighing names every finding once, with groups that exist and what happens to them", () => {
  const evaluation = weighCase();
  assert.equal(evaluation.defects!.length, 3, "the window is one defect under two criteria");
  assert.deepEqual(validateWeighing(weighingFor(), evaluation), []);
  assert.deepEqual(validateWeighing({ findings: [] }, evaluation), ['the weighing must be a JSON object with a list "tasks" and a list "findings"']);

  assert.match(refused(evaluation, (proposal) => proposal.findings.pop()), /finding T-2\.5\.3-1 is not weighed; every finding must be named exactly once/);
  assert.match(refused(evaluation, (proposal) => proposal.findings.push(proposal.findings[0]!)), /is already in findings\[0\]; a finding is weighed once/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.finding = "T-9.9.9-1")), /"T-9\.9\.9-1" is not a finding of this evaluation/);
  assert.match(refused(evaluation, (proposal) => (proposal.tasks = [])), /tasks must name 1 to 8 core tasks/);
  assert.match(refused(evaluation, (proposal) => (proposal.tasks[1]!.id = "zoeken")), /id "zoeken" is used twice/);
  assert.match(refused(evaluation, (proposal) => (proposal.tasks[0]!.id = "Iets Zoeken")), /tasks\[0\]: id must be a short name/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.task = "betalen")), /task must be the id of one of the tasks, "all" for every core task, or null/);
  assert.equal(refused(evaluation, (proposal) => (proposal.findings[0]!.task = "all")), "", "a part on every page belongs to every core task");
  assert.match(refused(evaluation, (proposal) => (proposal.tasks[1]!.id = "all")), /id "all" is the name for every core task together/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.group = "blind" as never)), /group must be one of no-vision, .* or everyone/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.consequence = "none" as never)), /consequence must be one of cannot, detour, effort/);
  assert.match(refused(evaluation, (proposal) => proposal.findings[0]!.affected.push(affected("no-vision", "detour"))), /group "no-vision" is named twice/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.textNl = "Ze lezen.")), /textNl is missing or shorter than 4 words/);
  // The account per group is a few sentences; the other sentences are one or two.
  assert.equal(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.textNl = Array(60).fill("woord").join(" "))), "");
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.textNl = Array(61).fill("woord").join(" "))), /textNl is longer than 60 words/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.unsureNl = Array(41).fill("woord").join(" "))), /unsureNl is longer than 40 words/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.unsureNl = "Kort.")), /unsureNl is missing or shorter than 4 words/);
});

test("a group the criterion of a finding does not name needs a reason, and everyone needs none", () => {
  const evaluation = weighCase();
  assert.match(refused(evaluation, (proposal) => proposal.findings[LINK]!.affected.push(affected("no-hearing", "effort"))), /whyGroupNl \(1\.4\.3 does not name "no-hearing"; say why it is hindered\) is missing/);
  assert.equal(refused(evaluation, (proposal) => proposal.findings[LINK]!.affected.push(affected("no-hearing", "effort", { whyGroupNl: "De link opent een video zonder ondertiteling." }))), "");
  assert.equal(refused(evaluation, (proposal) => proposal.findings[LINK]!.affected.push(affected(EVERYONE, "detour"))), "");
  assert.match(refused(evaluation, (proposal) => (proposal.findings[LINK]!.affected[0]!.whyGroupNl = "De norm noemt deze groep bij het criterium.")), /whyGroupNl is only for a group the criterion of the finding does not name/);
  // The groups are those of the finding's own criterion, not of the other findings at the same place.
  assert.match(refused(evaluation, (proposal) => proposal.findings[WINDOW_HEADING]!.affected.push(affected("limited-manipulation", "effort"))), /1\.3\.1 does not name "limited-manipulation"/);
  assert.equal(refused(evaluation, (proposal) => proposal.findings[WINDOW_NAME]!.affected.push(affected("limited-manipulation", "effort"))), "");
});

test("a sentence that weighs a group away is refused", () => {
  const evaluation = weighCase();
  for (const [sentence, word] of [
    ["De venstertitel is gewoon te lezen, dit hindert vrijwel niemand.", "niemand"],
    ["Wie de schaaltekst uitspreekt is een randgeval voor deze site.", "randgeval"],
    ["Het gekozen aantal per pagina horen is bijzaak.", "bijzaak"],
    ["Het contrast is lager, maar dat valt wel mee.", "valt mee"],
    ["Een telefoonnummer van meer dan twintig tekens is zeldzaam.", "zeldzaam"],
    ["Dit raakt maar een kleine groep van de bezoekers.", "kleine groep"],
    ["Weinig mensen gebruiken deze knop op de pagina.", "weinig mensen"],
    ["De meeste bezoekers merken hier helemaal niets van.", "de meeste mensen"],
  ] as const) {
    assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.affected[0]!.textNl = sentence)), new RegExp(`textNl says "${word}": write what happens to this group`), sentence);
  }
  assert.match(refused(evaluation, (proposal) => (proposal.findings[LOGO]!.unaffected![0]!.sameNl = "Dit is een randgeval dat bijna nooit voorkomt.")), /sameNl says "randgeval"/);
});

test("that a group can not finish a core task is said in so many words, and only then", () => {
  const evaluation = weighCase();
  // The highest step is a claim about the task: without the sentence it is refused.
  assert.match(refused(evaluation, (proposal) => delete proposal.findings[WINDOW_NAME]!.blocksNl), /blocksNl \(a group can not do this and task names a core task: say why that task can not be finished without this part, or set task to null when it can\) is missing/);
  // Beside the tasks the group still can not use the part, and nothing is said about a task.
  assert.equal(
    refused(evaluation, (proposal) => {
      proposal.findings[WINDOW_NAME]!.task = null;
      delete proposal.findings[WINDOW_NAME]!.blocksNl;
    }),
    "",
  );
  assert.match(refused(evaluation, (proposal) => (proposal.findings[WINDOW_NAME]!.task = null)), /blocksNl is only for a finding where a group can not do something \(cannot\) and task names a core task/);
  // A detour at a core task stops nobody.
  assert.match(refused(evaluation, (proposal) => (proposal.findings[WINDOW_HEADING]!.blocksNl = "Zonder kop is het venster niet te vinden voor deze bezoeker.")), /blocksNl is only for a finding where a group can not do something/);
  // The sentence is held to the same rules as the others.
  assert.match(refused(evaluation, (proposal) => (proposal.findings[WINDOW_NAME]!.blocksNl = "Dit hindert vrijwel niemand bij het zoeken.")), /blocksNl .*says "niemand"/);
  applyWeighing(evaluation, weighingFor());
  const window = evaluation.defects!.find((defect) => defect.findingIds.includes("T-4.1.2-1"))!;
  assert.equal(window.weighing!.blocksNl, "Zonder naam weet de bezoeker niet dat dit het zoekvenster is, en zoeken is de enige weg naar het antwoord.");
});

test("a quotation in a sentence has to stand in the finding: the step sees no page", () => {
  const evaluation = weighCase();
  const window = evaluation.criteria.find((criterion) => criterion.id === "4.1.2")!.findings[0]!;
  window.observedNl = 'Het venster heeft geen naam. De titel "Zoeken" is een `div`.';
  assert.equal(refused(evaluation, (proposal) => (proposal.findings[WINDOW_NAME]!.affected[0]!.textNl = 'Boven het venster staat "Zoeken", maar dat is geen naam.')), "");
  assert.match(
    refused(evaluation, (proposal) => (proposal.findings[WINDOW_NAME]!.affected[0]!.textNl = 'De schermlezer zegt alleen "dialoogvenster" en verder niets.')),
    /textNl: the quoted text "dialoogvenster" is not found literally in the finding; quote only what the finding says/,
  );
  // An apostrophe inside a word is no quotation.
  assert.equal(refused(evaluation, (proposal) => (proposal.findings[WINDOW_NAME]!.affected[0]!.textNl = "Zo'n venster zonder naam is op alle pagina's hetzelfde.")), "");
});

test("that no group is hindered is said per group the criterion is essential for, and never at a measured limit", () => {
  const evaluation = weighCase();
  assert.match(refused(evaluation, (proposal) => delete proposal.findings[LOGO]!.unaffected), /affected is empty; name a group and what happens to it, or say under unaffected for each of limited-manipulation, limited-reach how that group gets the same/);
  assert.match(refused(evaluation, (proposal) => proposal.findings[LOGO]!.unaffected!.pop()), /unaffected does not say how "limited-reach" gets the same, and 2.5.3 is essential for that group/);
  assert.match(refused(evaluation, (proposal) => (proposal.findings[0]!.unaffected = [{ group: "no-vision", sameNl: "Hoort de titel van het venster gewoon voorlezen." }])), /unaffected is only for a finding without affected groups/);
  // Contrast below the limit hinders by the standard's own measure.
  assert.match(
    refused(evaluation, (proposal) => {
      proposal.findings[LINK]!.affected = [];
      proposal.findings[LINK]!.unaffected = [
        { group: "low-vision", sameNl: "De link is nog net te lezen op deze achtergrond." },
        { group: "no-color", sameNl: "De link is nog net te lezen op deze achtergrond." },
      ];
    }),
    /affected is empty, but 1.4.3 sets a measured limit; name the group and what happens to it/,
  );
});

test("a weighing sets the severity of each finding, a defect takes the heaviest, and it can be taken back", () => {
  const evaluation = weighCase();
  const before = canonicalJson(evaluation);
  const input = canonicalJson(weighingInput(evaluation));
  assert.ok(!input.includes('"severity"'), "the step does not read the severity the judges gave");
  assert.deepEqual(applyWeighing(evaluation, weighingFor()), { raised: 1, lowered: 1, same: 2, noEffect: 1, unsure: 0 });

  const finding = (id: string): ReportFinding => evaluation.criteria.flatMap((criterion) => criterion.findings).find((entry) => entry.id === id)!;
  // Each finding is weighed on what it describes: the missing heading costs effort, the missing name stops a group at a core task.
  assert.deepEqual([finding("T-1.3.1-1").severity, finding("T-1.3.1-1").judgedSeverity, finding("T-4.1.2-1").severity, finding("T-4.1.2-1").judgedSeverity], ["laag", "laag", "blokkerend", "midden"]);
  assert.deepEqual([finding("T-1.4.3-1").severity, finding("T-1.4.3-1").judgedSeverity], ["laag", "midden"]);
  assert.deepEqual([finding("T-2.5.3-1").severity, finding("T-2.5.3-1").weighing!.affected, finding("T-2.5.3-1").weighing!.unaffected!.length], ["laag", [], 2]);

  // The defect: the highest severity among its findings, the task of the finding that gives it, and per group the worst that happens.
  const window = evaluation.defects!.find((defect) => defect.findingIds.includes("T-1.3.1-1"))!;
  assert.deepEqual([window.severity, window.judgedSeverity, window.weighing!.task], ["blokkerend", "midden", "zoeken"]);
  assert.deepEqual(window.weighing!.affected.map((entry) => [entry.group, entry.consequence]), [["no-vision", "cannot"], ["cognitive", "effort"]]);
  const logo = evaluation.defects!.find((defect) => defect.findingIds.includes("T-2.5.3-1"))!;
  assert.deepEqual([logo.severity, logo.weighing], ["laag", { task: null, affected: [] }]);

  // The input is the same after weighing, so the stamp of a weighing keeps counting.
  assert.equal(canonicalJson(weighingInput(evaluation)), input);
  // Weighing twice starts from the judges again, not from the first weighing.
  applyWeighing(evaluation, weighingFor());
  assert.deepEqual([finding("T-4.1.2-1").severity, finding("T-4.1.2-1").judgedSeverity, window.judgedSeverity], ["blokkerend", "midden", "midden"]);

  clearWeighing(evaluation);
  assert.deepEqual(evaluation.weighing, { status: "not-run" });
  delete evaluation.weighing;
  assert.equal(canonicalJson(evaluation), before, "taken back, the evaluation is what it was");
});

test("the step writes its task, applies a weighing that was checked, and drops it when the findings change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "weigh-"));
  const path = join(dir, "evaluation.json");
  const evaluation = weighCase();
  writeFileSync(path, canonicalJson(evaluation));

  const first = await weigh(dir);
  assert.deepEqual({ findings: first.findings, weighing: first.weighing }, { findings: 4, weighing: "not-run" });
  const written = await readJson<Evaluation>(path);
  assert.deepEqual(written.weighing, { status: "not-run" });
  assert.equal(canonicalJson(written.criteria), canonicalJson(JSON.parse(canonicalJson(evaluation)).criteria), "the findings are untouched");
  // Findings about one place stand together in the input.
  const task = await readJson<{ places: { findings: { finding: string }[] }[] }>(join(dir, "tasks", "weeg", "invoer.json"));
  // The main finding of the defect first: 4.1.2 comes before 1.3.1 in the fixed order of causes.
  assert.deepEqual(task.places.map((place) => place.findings.map((entry) => entry.finding)).sort(), [["T-1.4.3-1"], ["T-2.5.3-1"], ["T-4.1.2-1", "T-1.3.1-1"]]);

  // A weighing that breaks the rules is not stamped and therefore not applied.
  mkdirSync(join(dir, "verdicts"), { recursive: true });
  const wrong = weighingFor();
  wrong.findings[0]!.affected[0]!.textNl = "Dit hindert vrijwel niemand op deze site.";
  writeFileSync(join(dir, "verdicts", "weging.json"), JSON.stringify(wrong));
  assert.equal((await checkWeigh(dir)).length, 1);
  assert.equal((await weigh(dir)).weighing, "not-run");

  writeFileSync(join(dir, "verdicts", "weging.json"), JSON.stringify(weighingFor()));
  assert.deepEqual(await checkWeigh(dir), []);
  const second = await weigh(dir);
  assert.deepEqual({ weighing: second.weighing, raised: second.raised, lowered: second.lowered, same: second.same, noEffect: second.noEffect }, { weighing: "applied", raised: 1, lowered: 1, same: 2, noEffect: 1 });
  const applied = await readJson<Evaluation>(path);
  assert.equal(applied.weighing!.status, "applied");
  assert.deepEqual(applied.weighing!.tasks, [
    { id: "zoeken", nameNl: "Iets opzoeken" },
    { id: "afspraak", nameNl: "Een afspraak maken" },
  ]);
  // The outcome per criterion and the findings are what they were, apart from the severity and what the step recorded.
  const bare = (value: Evaluation): string => canonicalJson(value.criteria.map((criterion) => ({ ...criterion, findings: criterion.findings.map(({ severity: _severity, judgedSeverity: _judged, weighing: _weighing, ...rest }) => rest) })));
  assert.equal(bare(applied), bare(written));

  // Checked and applied again on the weighed evaluation: the same answer.
  assert.deepEqual(await checkWeigh(dir), []);
  assert.equal((await weigh(dir)).weighing, "applied");
  // Grouping again starts from what the judges gave, finds the same defects, and the weighing still counts.
  await merge(dir);
  assert.deepEqual(await checkMerge(dir).catch((error: Error) => [error.message]), ["cannot read verdicts/samenvoeg.json: ENOENT: no such file or directory, open '" + join(dir, "verdicts", "samenvoeg.json") + "'"]);
  const regrouped = await readJson<Evaluation>(path);
  assert.equal(regrouped.weighing!.status, "applied");
  assert.equal(canonicalJson(regrouped.defects), canonicalJson(applied.defects));

  // Other findings: the weighing was made for something else and no longer counts.
  const changed = weighCase();
  changed.criteria.find((criterion) => criterion.id === "1.4.3")!.findings[0]!.observedNl = "De link in de voet is lichter dan gemeten.";
  writeFileSync(path, canonicalJson(changed));
  const third = await weigh(dir);
  assert.equal(third.weighing, "not-run");
  const dropped = await readJson<Evaluation>(path);
  assert.ok(dropped.defects!.every((defect) => defect.weighing === undefined && defect.judgedSeverity === undefined));
  assert.ok(dropped.criteria.every((criterion) => criterion.findings.every((entry) => entry.weighing === undefined && entry.judgedSeverity === undefined)));
});
