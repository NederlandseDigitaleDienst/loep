import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citedObservations,
  KINDS_AFTER_FINISH,
  NOT_SENT,
  notSentOrigins,
  notSentPointProblems,
  OPEN_POINT_KINDS,
  openPoint,
  OUTSIDE_SCOPE,
  UNREACHABLE,
  waitsOnlyOnSending,
  indexObservations,
  validateCandidates,
  validateJudgeVerdict,
  quotedFragments,
  rowsToExplain,
  searchableText,
  validateVerification,
  type CandidateList,
  type Finding,
  type JudgeContext,
  type ObservationRecordLike,
  type Verdict,
  type VerificationContext,
} from "../src/lib/verdict.ts";

const record = (id: string, command: string, extra: Partial<ObservationRecordLike> = {}): ObservationRecordLike => ({ id, command, error: null, state: { start: { url: "http://127.0.0.1:4710/" } }, result: {}, ...extra });

const observations = indexObservations([
  record("j143-0001", "open"),
  record("j143-0002", "look"),
  record("j143-0003", "contrast", { result: { agreement: "agree", differences: [] } }),
  record("j143-0004", "contrast", { result: { agreement: "disagree", differences: ["pixel-screenshot 3.9, axe-core 4.6"] } }),
  record("j143-0005", "crop"),
  record("j143-0006", "click"),
  record("j143-0007", "contrast", { error: "het element is van de pagina verdwenen" }),
  record("j143-0008", "look", { state: null }),
  record("j143-0009", "engines", { result: { agreement: "disagree", differences: ["1.3.1: axe-core passed, alfa failed"] } }),
  record("j143-0010", "contrast", { result: { agreement: "single", differences: [], methods: [{ method: "pixel-screenshot", knownUnreliable: "op een achtergrondafbeelding geeft de pixelmeting niet het slechtste geval" }] } }),
  record("v143-0001", "open"),
  record("v143-0002", "contrast", { result: { agreement: "agree", differences: [] } }),
  record("v143-0003", "look"),
]);

const context: JudgeContext = { criterion: "1.4.3", evidenceNames: ["contrast"], pageLabels: ["P01", "P02"], observations, candidateIds: [], passCommands: ["contrast"], decisiveCommands: ["contrast"] };
const seen = { checkedNl: "Tekst op de startpagina", howNl: "Contrast gemeten op de knop", observedNl: "9,1 op 1 bij een eis van 4,5", evidence: ["contrast", "j143-0003"], ruling: "noIssue" as const };
const finding: Finding = { key: "F1", titleNl: "Datum te licht", observedNl: "Grijs op wit, 3,9 op 1.", impactNl: "Slechtzienden lezen de datum niet.", fixNl: "Maak de tekst donkerder.", severity: "midden", owner: "design", component: null, locations: [{ page: "P01", where: ".datum", heading: "Nieuws" }], pagesAffected: "P01", evidence: ["j143-0003"] };
const passed: Verdict = { criterion: "1.4.3", outcome: "passed", rule: "R2", summaryNl: "Alle gemeten tekst haalt de eis, ook in het geopende menu.", observations: [seen], findings: [] };
const failed: Verdict = { ...passed, outcome: "failed", rule: "R1", findings: [finding] };

test("the index reads what a verdict may lean on from the observation records", () => {
  assert.deepEqual(observations.get("j143-0004"), { command: "contrast", failed: false, replayable: true, agreement: "disagree", differences: ["pixel-screenshot 3.9, axe-core 4.6"], unreliable: false });
  assert.equal(observations.get("j143-0009")!.command, "rules", "an older command name is read as the current one");
  assert.equal(observations.get("j143-0010")!.unreliable, true);
  assert.equal(observations.get("j143-0007")!.failed, true);
  assert.equal(observations.get("j143-0008")!.replayable, false);
  assert.equal(observations.get("j143-0002")!.agreement, null);
});

test("a judge verdict that points at recorded observations is accepted", () => {
  assert.deepEqual(validateJudgeVerdict(passed, context), []);
  assert.deepEqual(validateJudgeVerdict(failed, context), []);
  // Without a dossier every reference is an observation.
  assert.deepEqual(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0003"] }] }, { ...context, evidenceNames: [] }), []);
});

test("a verdict cannot pass without observations or fail without a finding", () => {
  assert.match(validateJudgeVerdict({ ...passed, observations: [] }, context).join(), /observations: at least one is required/);
  assert.match(validateJudgeVerdict({ ...passed, outcome: "failed" }, context).join(), /needs at least one finding/);
  assert.match(validateJudgeVerdict({ ...passed, findings: [finding] }, context).join(), /cannot carry findings/);
  assert.match(validateJudgeVerdict({ ...passed, outcome: "cantTell" }, context).join(), /must say in missingNl/);
  const elsewhere = { ...finding, locations: [{ ...finding.locations[0]!, page: "P99" }] };
  assert.match(validateJudgeVerdict({ ...failed, findings: [elsewhere] }, context).join(), /page "P99" is not in the legend/);
});

test("evidence is an observation, a part of the dossier or an existing file", () => {
  assert.match(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0099"] }] }, context).join(), /"j143-0099" is not in the observation log/);
  assert.match(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0003", "pages/x.png"] }] }, context).join(), /not an existing file/);
  assert.deepEqual(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0003", "pages/x.png"] }] }, { ...context, fileExists: (ref) => ref === "pages/x.png" }), []);
});

test("a finding needs a look or measure observation that succeeded in a replayable state", () => {
  const withEvidence = (evidence: string[]): Verdict => ({ ...failed, findings: [{ ...finding, evidence }] });
  assert.match(validateJudgeVerdict(withEvidence(["contrast"]), context).join(), /a finding needs at least one observation/);
  assert.match(validateJudgeVerdict(withEvidence(["j143-0006"]), context).join(), /a finding needs at least one observation/, "an action is not a look");
  assert.match(validateJudgeVerdict(withEvidence(["j143-0007"]), context).join(), /a finding needs at least one observation/, "a failed command shows nothing");
  assert.match(validateJudgeVerdict(withEvidence(["j143-0008"]), context).join(), /a finding needs at least one observation/, "no start page, no replay");
  assert.deepEqual(validateJudgeVerdict(withEvidence(["j143-0010"]), context), [], "a flag names one known failure; it does not disqualify the measurement");
  assert.deepEqual(validateJudgeVerdict(withEvidence(["j143-0006", "j143-0005"]), context), []);
  assert.match(validateJudgeVerdict({ ...failed, findings: [{ ...finding, key: undefined }] }, context).join(), /key must be/);
  assert.match(validateJudgeVerdict({ ...failed, findings: [finding, finding] }, context).join(), /used twice/);
});

test("a pass needs observations, and the ones the procedure names", () => {
  assert.match(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["contrast"] }] }, context).join(), /needs at least one observation of a look or measure command/);
  assert.match(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0002"] }] }, context).join(), /must cite an observation of "contrast"/);
  assert.deepEqual(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0002"] }] }, { ...context, passCommands: [] }), []);
});

test("a pass may not lean on a measurement whose methods disagree, unless a closer look settled it", () => {
  const leaning: Verdict = { ...passed, observations: [{ ...seen, evidence: ["j143-0003", "j143-0004"] }] };
  assert.match(validateJudgeVerdict(leaning, context).join(), /methods that disagree/);
  assert.match(validateJudgeVerdict({ ...leaning, resolved: [{ observations: ["j143-0004"], by: ["j143-0004"], howNl: "Nog eens gekeken naar de uitsnede." }] }, context).join(), /methods that disagree/);
  assert.match(validateJudgeVerdict({ ...leaning, resolved: [{ observations: ["j143-0004"], by: ["j143-0006"], howNl: "Nog eens gekeken naar de uitsnede." }] }, context).join(), /methods that disagree/, "an action settles nothing");
  assert.deepEqual(validateJudgeVerdict({ ...leaning, resolved: [{ observations: ["j143-0004"], by: ["j143-0005"], howNl: "Op de uitsnede staat de tekst op een egaal wit vlak." }] }, context), []);
  // The disagreement stays visible in a failure or an open question without further ceremony.
  assert.deepEqual(validateJudgeVerdict({ ...leaning, outcome: "cantTell", missingNl: ["mens nodig: de twee methoden geven 3,9 en 4,6 voor de datum op P01."] }, context), []);
  // Engines that disagree about another criterion do not stand in the way.
  assert.deepEqual(validateJudgeVerdict({ ...passed, observations: [{ ...seen, evidence: ["j143-0003", "j143-0009"] }] }, context), []);
  assert.match(validateJudgeVerdict({ ...passed, criterion: "1.3.1", observations: [{ ...seen, evidence: ["j143-0003", "j143-0009"] }] }, { ...context, criterion: "1.3.1", decisiveCommands: ["rules"] }).join(), /methods that disagree/);
});

test("every candidate of the walk-through gets a ruling", () => {
  const withCandidates = { ...context, candidateIds: ["P01-K01", "P01-K02"] };
  assert.match(validateJudgeVerdict(failed, withCandidates).join(), /candidate "P01-K01" has no ruling/);
  const border = { criterion: "1.4.11", page: "P01", where: "rand van het zoekveld", evidence: ["j143-0005"], noteNl: "De rand van het zoekveld is lichtgrijs op wit." };
  const ruled: Verdict = { ...failed, candidates: [{ id: "P01-K01", ruling: "finding", finding: "F1", reasonNl: "Gemeten: 3,9 op 1." }, { id: "P01-K02", ruling: "otherCriterion", criterion: "1.4.11", reasonNl: "Het gaat om de rand van een veld." }], crossCandidates: [border] };
  assert.deepEqual(validateJudgeVerdict(ruled, withCandidates), []);
  // A ruling alone reaches nobody: the criterion it names is given only what crossCandidates passes on.
  assert.match(validateJudgeVerdict({ ...ruled, crossCandidates: undefined }, withCandidates).join(), /candidates\[1\]: a candidate for criterion 1\.4\.11 reaches that criterion only through an entry for it in crossCandidates/);
  assert.match(validateJudgeVerdict({ ...ruled, crossCandidates: [{ ...border, criterion: "1.3.1" }] }, withCandidates).join(), /for criterion 1\.4\.11 reaches that criterion only/);
  assert.match(validateJudgeVerdict({ ...ruled, candidates: [{ ...ruled.candidates![0]!, finding: "F9" }, ruled.candidates![1]!] }, withCandidates).join(), /names the key of that finding/);
  assert.match(validateJudgeVerdict({ ...ruled, candidates: [ruled.candidates![0]!, { ...ruled.candidates![1]!, criterion: "1.4.3" }] }, withCandidates).join(), /names that criterion/);
  assert.match(validateJudgeVerdict({ ...ruled, candidates: [...ruled.candidates!, { id: "P09-K01", ruling: "noIssue", reasonNl: "Niets aan de hand hier." }] }, withCandidates).join(), /is not a candidate for this criterion/);
  assert.match(validateJudgeVerdict({ ...passed, candidates: [{ id: "P01-K01", ruling: "open", reasonNl: "Niet kunnen openen." }, { id: "P01-K02", ruling: "noIssue", reasonNl: "Gemeten en in orde." }] }, withCandidates).join(), /cannot leave a candidate open/);
});

const verifierContext: VerificationContext = { ...context, session: "v143", judge: failed };
const reproduced: Verdict = {
  ...failed,
  findings: [{ ...finding, evidence: ["j143-0003", "v143-0002"] }],
  observations: [{ ...seen, evidence: ["v143-0002"] }],
  verification: { judgeOutcome: "failed", findings: [{ key: "F1", reproduced: true, evidence: ["v143-0002"] }] },
};

test("the verifier reproduces a finding with its own observations", () => {
  assert.deepEqual(validateVerification(reproduced, verifierContext), []);
  const borrowed = { ...reproduced, findings: [finding], verification: { ...reproduced.verification!, findings: [{ key: "F1", reproduced: true, evidence: ["j143-0003"] }] } };
  const problems = validateVerification(borrowed, verifierContext).join("\n");
  assert.match(problems, /reproduced needs at least one look or measure observation of session "v143"/);
  assert.match(problems, /a finding needs at least one observation of session "v143"/);
  assert.match(validateVerification({ ...reproduced, verification: undefined }, verifierContext).join(), /verification: the final verdict must say/);
  assert.match(validateVerification({ ...reproduced, verification: { ...reproduced.verification!, findings: [] } }, verifierContext).join(), /every finding of the judge needs exactly one entry/);
});

test("a finding that is not reproduced is dropped with a reason, and never becomes a pass", () => {
  const dropped: Verdict = {
    ...passed,
    outcome: "cantTell",
    rule: "R3",
    missingNl: ["proef werkte niet: de datum op P01 gaf bij een nieuwe meting 4,6 op 1; de bevinding is niet gereproduceerd."],
    observations: [{ ...seen, evidence: ["v143-0002"] }],
    verification: { judgeOutcome: "failed", findings: [{ key: "F1", reproduced: false, evidence: [], dropped: "notReproduced", reasonNl: "Op een verse pagina meet de datum 4,6 op 1." }] },
  };
  assert.deepEqual(validateVerification(dropped, verifierContext), []);
  assert.match(validateVerification({ ...dropped, outcome: "passed", missingNl: undefined }, verifierContext).join(), /the final outcome can only be failed, cantTell/);
  assert.match(validateVerification({ ...dropped, verification: { ...dropped.verification!, findings: [{ key: "F1", reproduced: false, evidence: [] }] } }, verifierContext).join(), /dropped must be one of/);
  assert.match(validateVerification({ ...dropped, verification: { ...dropped.verification!, findings: [{ key: "F1", reproduced: false, evidence: [], dropped: "wrongCriterion", reasonNl: "Dit gaat over de rand van het veld." }] } }, verifierContext).join(), /belongsTo/);
  // Dropped because it belongs elsewhere: it is passed on there, with an observation of the verifier's own.
  const elsewhere = { ...dropped.verification!, findings: [{ key: "F1", reproduced: false, evidence: [], dropped: "wrongCriterion" as const, belongsTo: "1.4.11", reasonNl: "Dit gaat over de rand van het veld, niet over tekst." }] };
  assert.match(validateVerification({ ...dropped, verification: elsewhere }, verifierContext).join(), /belongs to criterion 1\.4\.11 reaches that criterion only through an entry for it in crossCandidates/);
  assert.deepEqual(validateVerification({ ...dropped, verification: elsewhere, crossCandidates: [{ criterion: "1.4.11", page: "P01", where: "rand van het zoekveld", evidence: ["v143-0003"], noteNl: "De rand van het zoekveld is lichtgrijs op wit." }] }, verifierContext), []);
  assert.match(validateVerification({ ...reproduced, verification: { ...reproduced.verification!, findings: dropped.verification!.findings } }, verifierContext).join(), /a dropped finding cannot stay/);
  assert.match(validateVerification({ ...dropped, verification: { ...dropped.verification!, findings: [{ key: "F1", reproduced: true, evidence: ["v143-0002"] }] } }, verifierContext).join(), /a reproduced finding makes the outcome "failed"/);
});

test("how to read the norm is the verifier's own judgment, never a choice handed to the owner", () => {
  const choice = "keuze nodig: wie het rapport tekent, beslist of de datum op P01 te licht is.";
  const notSupported = { key: "F1", reproduced: false, evidence: ["v143-0002"], dropped: "notSupported" as const, reasonNl: "De datum is een logo; 1.4.3 zondert tekst in een logo uit." };
  const handedOn: Verdict = {
    ...passed,
    outcome: "cantTell",
    rule: "R3",
    missingNl: [choice],
    observations: [{ ...seen, evidence: ["v143-0002"], ruling: "open" }],
    verification: { judgeOutcome: "failed", findings: [notSupported] },
  };
  // A finding the verifier saw again keeps the criterion failed, whatever point stands next to it.
  assert.match(validateVerification({ ...handedOn, verification: { judgeOutcome: "failed", findings: [{ key: "F1", reproduced: true, evidence: ["v143-0002"] }] } }, verifierContext).join(), /a reproduced finding makes the outcome "failed"/);
  // Dropped as not covered by the norm, and then handed to whoever signs as a choice.
  assert.match(validateVerification(handedOn, verifierContext).join(), /a new "keuze nodig:" point next to it hands that reading to whoever signs/);
  // Every finding dropped with a reason, and what stays open is not a choice: accepted.
  const decided: Verdict = { ...handedOn, missingNl: ["mens nodig: wat een schermlezer voorleest bij de datum op P01."] };
  assert.deepEqual(validateVerification(decided, verifierContext), []);
  // A choice the judge already left to the owner may stay.
  const judgeChose: VerificationContext = { ...verifierContext, judge: { ...failed, missingNl: ["keuze nodig: of de tekst in de kop een logo is, bepaalt de eigenaar."] } };
  assert.deepEqual(validateVerification(handedOn, judgeChose), []);
  // A finding that was not reproduced is not a reading of the norm; the rule does not reach it.
  assert.deepEqual(validateVerification({ ...handedOn, verification: { judgeOutcome: "failed", findings: [{ ...notSupported, dropped: "notReproduced", reasonNl: "Op een verse pagina meet de datum 4,6 op 1." }] } }, verifierContext), []);
});

test("a pass survives only an attack that used instruments, and a counterexample fails it", () => {
  const afterPass: VerificationContext = { ...verifierContext, judge: passed };
  const upheld: Verdict = { ...passed, observations: [{ ...seen, evidence: ["j143-0003", "v143-0002"] }], verification: { judgeOutcome: "passed", findings: [], attackNl: "Het menu geopend en de lichtste tekst daarin gemeten: 7,2 op 1.", attackEvidence: ["v143-0002"] } };
  assert.deepEqual(validateVerification(upheld, afterPass), []);
  assert.match(validateVerification({ ...upheld, verification: { ...upheld.verification!, attackEvidence: ["j143-0003"] } }, afterPass).join(), /attacking "passed" needs at least one look or measure observation of session "v143"/);
  assert.match(validateVerification({ ...upheld, verification: { ...upheld.verification!, attackNl: "Niets." } }, afterPass).join(), /attackNl/);
  const counter: Verdict = { ...upheld, outcome: "failed", rule: "R1", findings: [{ ...finding, key: "V1", evidence: ["v143-0002"] }] };
  assert.deepEqual(validateVerification(counter, afterPass), []);
  assert.match(validateVerification({ ...counter, findings: [{ ...finding, key: "F1", evidence: ["v143-0002"] }] }, afterPass).join(), /is not a finding of the judge/);
  assert.match(validateVerification({ ...upheld, outcome: "inapplicable" }, afterPass).join(), /the final outcome can only be passed, failed, cantTell/);
  // An open question may be settled either way, but only with an attempt of the verifier's own.
  const afterOpen: VerificationContext = { ...afterPass, judge: { ...passed, outcome: "cantTell", missingNl: ["Het menu ging niet open op P01."] } };
  const settled: Verdict = { ...upheld, verification: { ...upheld.verification!, judgeOutcome: "cantTell" } };
  assert.deepEqual(validateVerification(settled, afterOpen), []);
  assert.match(validateVerification({ ...settled, outcome: "inapplicable" }, afterOpen).join(), /the final outcome can only be cantTell, failed, passed/);
  assert.match(validateVerification({ ...settled, verification: { ...settled.verification!, attackNl: "", attackEvidence: [] } }, afterOpen).join(), /settle what the judge left open/);
});

const walk: CandidateList = {
  pageType: "nieuws",
  page: "P02",
  states: [{ nameNl: "Breed, cookiemelding gesloten", evidence: ["j143-0002"] }],
  candidates: [{ id: "P02-K01", criterion: "1.1.1", page: "P02", where: "foto boven het bericht", evidence: ["j143-0005"], noteNl: "De alt-tekst noemt een fiets, op de foto staat een stationsgebouw.", support: "bekeken" }],
  notWalkedNl: [],
};
const walkContext = { pageType: "nieuws", pageLabels: ["P01", "P02"], criteria: ["1.1.1", "1.4.3"], idPrefix: "P02", observations };

test("a candidate names a criterion, a place and an observation that shows it", () => {
  assert.deepEqual(validateCandidates(walk, walkContext), []);
  assert.deepEqual(validateCandidates({ ...walk, candidates: [] }, walkContext), [], "a walk may find nothing");
  const one = walk.candidates[0]!;
  const withCandidate = (candidate: Partial<typeof one>): CandidateList => ({ ...walk, candidates: [{ ...one, ...candidate }] });
  assert.match(validateCandidates(withCandidate({ criterion: "9.9.9" }), walkContext).join(), /not a criterion with a procedure/);
  assert.match(validateCandidates(withCandidate({ evidence: ["j143-0006"] }), walkContext).join(), /needs at least one observation of a look or measure command/);
  assert.match(validateCandidates(withCandidate({ evidence: ["j143-0005", "j143-0100"] }), walkContext).join(), /"j143-0100" is not in the observation log/);
  assert.match(validateCandidates(withCandidate({ id: "K1" }), walkContext).join(), /id must look like "P02-K01"/);
  assert.match(validateCandidates(withCandidate({ support: "zeker" as never }), walkContext).join(), /support must be one of/);
  assert.match(validateCandidates(withCandidate({ noteNl: Array(60).fill("woord").join(" ") }), walkContext).join(), /one sentence of at most 40 words/);
  assert.match(validateCandidates({ ...walk, candidates: [one, one] }, walkContext).join(), /used twice/);
  assert.match(validateCandidates({ ...walk, states: [] }, walkContext).join(), /states: name at least/);
});

test("the stamp of a verdict can bind it to the observations it cites", () => {
  assert.deepEqual(citedObservations(reproduced, observations), ["j143-0003", "v143-0002"]);
});

test("a disagreement only needs settling for the command that decides the criterion", () => {
  const leaning: Verdict = { ...passed, observations: [{ ...seen, evidence: ["j143-0003", "j143-0004"] }] };
  assert.deepEqual(validateJudgeVerdict(leaning, { ...context, decisiveCommands: ["focus"] }), []);
  assert.match(validateJudgeVerdict(leaning, context).join(), /methods that disagree/);
});

test("rows of the dossier that measure a loss are each explained by a look of one's own before a pass", () => {
  const evidence = {
    textSpacing: {
      newlyClippedText: [{ text: "Paspoort of rijbewijs", textLost: true }, { text: "Zoeken", textLost: false }],
      at320: { newlyClippedText: [{ text: "Paspoort  of rijbewijs", textLost: true }] },
      states: [{ state: "menu", newlyClippedText: [{ text: "Afval en grofvuil" }] }, { state: "chat", examined: false }],
    },
  };
  const paths = ["textSpacing.newlyClippedText:textLost", "textSpacing.at320.newlyClippedText:textLost", "textSpacing.states.newlyClippedText:textLost"];
  // A row measured as no loss needs nothing, the same text counts once, and a row of an older run without the field counts.
  assert.deepEqual(rowsToExplain(evidence, paths), [
    { part: "textSpacing.newlyClippedText", text: "Paspoort of rijbewijs" },
    { part: "textSpacing.states.newlyClippedText", text: "Afval en grofvuil" },
  ]);
  const rows = rowsToExplain(evidence, paths);
  const tile = { ...seen, observedNl: "De tegel Paspoort of rijbewijs scrolt: de hele tekst is te bereiken.", evidence: ["j143-0005"] };
  const menu = { ...seen, observedNl: "In het menu klapt Afval en grofvuil open bij focus.", evidence: ["j143-0002"] };
  assert.deepEqual(validateJudgeVerdict({ ...passed, observations: [seen, tile, menu] }, { ...context, explainOnPass: rows }), []);
  const problems = validateJudgeVerdict({ ...passed, observations: [seen, tile] }, { ...context, explainOnPass: rows }).join("\n");
  assert.match(problems, /textSpacing\.states\.newlyClippedText measures a loss at "Afval en grofvuil"/);
  assert.doesNotMatch(problems, /Paspoort/);
  // Naming it in an observation that only points at the dossier is no look at the place.
  assert.match(validateJudgeVerdict({ ...passed, observations: [seen, { ...tile, evidence: ["contrast"] }, menu] }, { ...context, explainOnPass: rows }).join(), /loss at "Paspoort of rijbewijs"/);
  // A failure needs no explanation of what it found.
  assert.deepEqual(validateJudgeVerdict(failed, { ...context, explainOnPass: rows }), []);
});

test("what belongs to another criterion is handed on with an observation", () => {
  const cross = { criterion: "1.4.11", page: "P01", where: "rand van het zoekveld", evidence: ["j143-0005"], noteNl: "De rand van het zoekveld is lichtgrijs op wit." };
  assert.deepEqual(validateJudgeVerdict({ ...passed, crossCandidates: [cross] }, context), []);
  assert.match(validateJudgeVerdict({ ...passed, crossCandidates: [{ ...cross, criterion: "1.4.3" }] }, context).join(), /another criterion than this one/);
  assert.match(validateJudgeVerdict({ ...passed, crossCandidates: [{ ...cross, evidence: ["contrast"] }] }, context).join(), /needs at least one look or measure observation/);
  assert.match(validateVerification({ ...reproduced, crossCandidates: [cross] }, verifierContext).join(), /observation of session "v143"/);
});

test("the verifier dismisses a candidate only with a measurement of its own, and attacks only a pass", () => {
  const withCandidate: VerificationContext = { ...verifierContext, candidateIds: ["P01-K01"] };
  const ruling = { id: "P01-K01", ruling: "noIssue" as const, reasonNl: "Gemeten: 7,2 op 1, ruim voldoende." };
  assert.match(validateVerification({ ...reproduced, candidates: [ruling] }, withCandidate).join(), /dismissing a candidate is a small pass/);
  assert.match(validateVerification({ ...reproduced, candidates: [{ ...ruling, evidence: ["j143-0003"] }] }, withCandidate).join(), /dismissing a candidate is a small pass/);
  assert.deepEqual(validateVerification({ ...reproduced, candidates: [{ ...ruling, evidence: ["v143-0002"] }] }, withCandidate), []);
  assert.deepEqual(validateVerification({ ...reproduced, candidates: [{ ...ruling, ruling: "open" }] }, withCandidate), []);
  assert.deepEqual(validateJudgeVerdict({ ...failed, candidates: [ruling] }, { ...context, candidateIds: ["P01-K01"] }), [], "the judge needs no evidence field");
  assert.match(validateVerification({ ...reproduced, verification: { ...reproduced.verification!, attackNl: "Ook het donkere schema bekeken, zonder nieuwe bevinding." } }, verifierContext).join(), /belong to a verdict the judge passed/);
});

test("quotations are found between quotation marks, not in code or inside a word", () => {
  assert.deepEqual(quotedFragments('De link "Lees meer over afval" en de kop \u201cFoto\'s van de stalling\u201d.'), ["Lees meer over afval", "Foto's van de stalling"]);
  assert.deepEqual(quotedFragments("Alt-tekst 'Keurmerk van NeRDS ... Volg de link' op de foto's."), ["Keurmerk van NeRDS", "Volg de link"]);
  assert.deepEqual(quotedFragments('De lijst heeft role="group" en `aria-label="Menu"` in de code.'), []);
  assert.deepEqual(quotedFragments('Titel "Service Manual \'Making source code open\'" staat erboven.'), ["Service Manual 'Making source code open'"]);
});

test("a quotation in a finding must be literally in a source the finding cites", () => {
  const texts: Record<string, string> = {
    "j143-0003": searchableText({ items: [{ name: "Service Manual 'Making source code open'", html: "<a>Lees&nbsp;<b>meer</b> over afval &amp; grofvuil</a>" }] }),
    P01: searchableText("<h2>Volg ons</h2><h2>Nieuws</h2><p>Geplaatst op 21 juni door de redactie</p>"),
  };
  const quoting = (observedNl: string, where = ".datum"): string[] => validateJudgeVerdict({ ...failed, findings: [{ ...finding, observedNl, locations: [{ page: "P01", where, heading: "Nieuws" }] }] }, { ...context, sourceText: (ref) => texts[ref] ?? null });
  assert.deepEqual(quoting("De titel \"Service Manual 'Making source code open'\" is te licht."), []);
  assert.deepEqual(quoting('De link "Lees meer over afval & grofvuil" is te licht.'), [], "tags and entities are read as the page shows them");
  assert.deepEqual(quoting("Grijs op wit.", 'onder de kop "Volg ons"'), [], "the saved copy of the page a finding names counts");
  assert.match(quoting('De titel "Service Manual "Making source code open"" is te licht.').join(), /is not found literally/, "other quotation marks than the page has");
  assert.match(quoting('De link "Lees meer over Afval" is te licht.').join(), /findings\[0\]\.observedNl: the quoted text "Lees meer over Afval"/);
  assert.match(quoting("Grijs op wit.", 'onder de kop "Volg ons nu"').join(), /locations\[0\]\.where/);
  assert.deepEqual(validateJudgeVerdict({ ...failed, findings: [{ ...finding, observedNl: 'De link "bestaat niet" is te licht.' }] }, context), [], "without a source to look in, quotations are not checked");
});

test("a location carries words of the page a reader can search for", () => {
  const texts: Record<string, string> = { "j143-0003": "", P01: searchableText("<h2>Nieuws</h2><p>Geplaatst op 21 juni door de redactie</p>") };
  const at = (location: object): string[] => validateJudgeVerdict({ ...failed, findings: [{ ...finding, locations: [{ page: "P01", where: "#content > p:nth-of-type(8) > a", ...location }] }] }, { ...context, sourceText: (ref) => texts[ref] ?? null });
  assert.match(at({}).join(), /locations\[0\]: a reader must be able to find the place without the selector/);
  assert.deepEqual(at({ heading: "Nieuws" }), []);
  assert.deepEqual(at({ text: "Geplaatst op ... door de redactie" }), [], "what is left out is marked");
  assert.deepEqual(at({ wholePage: true }), []);
  assert.match(at({ heading: "Laatste nieuws" }).join(), /locations\[0\]\.heading: the quoted text "Laatste nieuws" is not found literally/);
  assert.match(at({ text: "Geplaatst op 21 juni door de Redactie" }).join(), /locations\[0\]\.text/);
});

test("an advice that would do harm when carried out to the letter is refused", () => {
  const advising = (fixNl: string, extra: Partial<JudgeContext> = {}): string[] => validateJudgeVerdict({ ...failed, findings: [{ ...finding, fixNl }] }, { ...context, siteHosts: ["www.voorbeeldgemeente.nl"], ...extra });
  assert.deepEqual(advising("Geef de lijst een naam met aria-labelledby naar de kop."), []);
  assert.match(advising('Maak er <ul role="group"> van.').join(), /puts a role on <ul>/);
  assert.match(advising('Gebruik <h2 class="titel" role="presentation">.').join(), /puts a role on <h2>/);
  assert.deepEqual(advising('Zet om de lijst een <div role="group">.'), []);
  assert.match(advising("Toon als voorbeeld https://nerds.nl/pagina in het veld.").join(), /"nerds.nl" is not an address of this site/);
  assert.deepEqual(advising("Toon https://www.voorbeeldgemeente.nl/pagina; zie https://www.w3.org/WAI/WCAG22/Techniques/html/H90."), []);
  assert.deepEqual(advising("Toon als voorbeeld https://nerds.nl/pagina in het veld.", { siteHosts: undefined }), [], "without a site, addresses are not checked");
  // A site on two origins: an address on either is one of the site, another subdomain is not.
  const twoOrigins = { siteHosts: ["example.nl", "docs.example.nl"] };
  assert.deepEqual(advising("Zie https://docs.example.nl/handleiding en https://example.nl/contact.", twoOrigins), []);
  assert.match(advising("Zie https://blog.example.nl/bericht.", twoOrigins).join(), /"blog.example.nl" is not an address of this site; an example uses the site itself \(example.nl or docs.example.nl\)/);
  // A site on this machine has a port in its host: the address with that port is the site's, another port is not.
  assert.deepEqual(advising("Zie http://127.0.0.1:4710/contact.html.", { siteHosts: ["127.0.0.1:4710", "127.0.0.1:4711"] }), []);
  assert.match(advising("Zie http://127.0.0.1:4712/speler.html.", { siteHosts: ["127.0.0.1:4710", "127.0.0.1:4711"] }).join(), /"127.0.0.1:4712" is not an address of this site/);
  assert.match(advising("Laat het label zichtbaar bij 640 pixels.", { criterion: "1.4.4" }).join(), /measured at 320 pixels/);
});

test("an advice inside the shadow tree of a vendor's element is for the vendor, or also says what the site can do", () => {
  const advising = (fixNl: string, extra: Partial<Finding> = {}, vendorPrefixes: string[] | null = ["nldd-"]): string[] =>
    validateJudgeVerdict({ ...failed, findings: [{ ...finding, owner: "techniek", ...extra, fixNl }] }, { ...context, ...(vendorPrefixes ? { vendorPrefixes } : {}) });
  const announcer = "Vul na elke zoekactie de bestaande `div.list__polite-announcer` van `nldd-list#search-results` met de uitkomst.";
  assert.match(advising(announcer).join(), /findings\[0\]\.fixNl: the advice names "\.list__polite-announcer", which lies inside the shadow tree of nldd-list\..*"Binnen eigen bereik:"/);
  assert.match(advising("Zet `aria-current` op `nldd-list-item >>> a`.").join(), /the advice names "nldd-list-item >>> a"/);
  // For the vendor it is an advice that can be carried out, and so it is with what the site can do next to it.
  assert.deepEqual(advising(announcer, { owner: "leverancier" }), []);
  assert.deepEqual(advising(`${announcer} Binnen eigen bereik: zet een eigen element met \`role="status"\` naast de lijst en schrijf de uitkomst daarin.`), []);
  // The class is the vendor's when the place names the element, also when the advice does not.
  assert.match(advising("Vul `div.list__polite-announcer` met de uitkomst.", { locations: [{ ...finding.locations[0]!, where: "zoekvenster, nldd-list#search-results" }] }).join(), /inside the shadow tree of nldd-list/);
  // Narrow: using a component, setting an attribute on it, a class of the site itself and a shadow root of the site's own element are within reach.
  assert.deepEqual(advising("Toon de fout met `nldd-validation-list` en zet `selected` op het `nldd-list-item` van de huidige pagina."), []);
  assert.deepEqual(advising("Geef `ul.list` en `a.list-item` in de voettekst een naam."), []);
  assert.deepEqual(advising("Zet de tekst in `site-kaart >>> div.titel`."), []);
  assert.deepEqual(advising("Vul `div.list__polite-announcer` met de uitkomst."), [], "no element of the vendor named: not known to be theirs");
  // Without the vendor's elements nothing is known to be someone else's.
  assert.deepEqual(advising(announcer, {}, null), []);
});

test("a finding about input names the value that was typed, to the letter", () => {
  const long = "Testbericht van loep (toegankelijkheidsonderzoek), niet beantwoorden. Dit is een lange testwaarde.";
  const typing = new Map([
    ...observations,
    ...indexObservations([
      record("j143-0020", "type", { result: { kind: "name", entered: "Loep Testpersoon" } }),
      record("j143-0021", "type", { result: { kind: "empty", entered: "" } }),
      record("j143-0022", "type", { result: { kind: "long", entered: long } }),
      record("j143-0023", "type", { error: "het element is van de pagina verdwenen", result: { kind: "email", entered: "loep-test@example.com" } }),
    ]),
  ]);
  assert.deepEqual([typing.get("j143-0020")!.entered, typing.get("j143-0021")!.entered, typing.get("j143-0023")!.entered, typing.get("j143-0003")!.entered], ["Loep Testpersoon", undefined, undefined, undefined]);
  const about = (observedNl: string, evidence: string[], criterion = "3.3.3"): string[] =>
    validateJudgeVerdict({ ...failed, criterion, findings: [{ ...finding, observedNl, evidence: ["j143-0003", ...evidence] }] }, { ...context, criterion, observations: typing });
  assert.match(about("Een tekst met spaties in het linkveld krijgt geen melding.", ["j143-0020"]).join(), /findings\[0\]\.observedNl: observation j143-0020 typed "Loep Testpersoon" into a field, and the finding does not say so/);
  assert.deepEqual(about("Met `Loep Testpersoon` in het linkveld krijgt het formulier geen melding.", ["j143-0020"]), []);
  // An emptied field and a failed command typed nothing that has to be named; of a long value the beginning is enough.
  assert.deepEqual(about("Met een leeg linkveld verstuurt het formulier niet.", ["j143-0021", "j143-0023"]), []);
  assert.match(about("Een lange tekst loopt uit het veld.", ["j143-0022"]).join(), /typed "Testbericht van loep \(toegankelijkheidso"/);
  assert.deepEqual(about("Met \u201cTestbericht van loep (toegankelijkheidso...\u201d loopt de tekst uit het veld.", ["j143-0022"]), []);
  // Each value once, and only under the criteria about input.
  assert.equal(about("Geen melding.", ["j143-0020", "j143-0020"]).length, 1);
  assert.deepEqual(about("Grijs op wit, 3,9 op 1.", ["j143-0020"], "1.4.3"), []);
});

test("every observation says what follows from it, so nothing that is wrong stays a remark", () => {
  const ruled = (observation: object, extra: Partial<Verdict> = {}): string[] => validateJudgeVerdict({ ...failed, ...extra, observations: [{ ...seen, ...observation }] }, context);
  assert.match(ruled({ ruling: undefined }).join(), /observations\[0\]: ruling says what follows/);
  assert.deepEqual(ruled({ ruling: "finding", finding: "F1" }), []);
  assert.match(ruled({ ruling: "finding", finding: "F9" }).join(), /names the key of a finding in this verdict/);
  assert.match(ruled({ ruling: "open" }).join(), /needs the point in missingNl/);
  assert.deepEqual(ruled({ ruling: "open" }, { missingNl: ["budget op: op 11 pagina's is een kopniveau overgeslagen; niet nagekeken welke."] }), []);
  assert.match(ruled({ ruling: "otherCriterion" }).join(), /needs an entry in crossCandidates/);
});

test("an open point names its kind and is written for a reader who does not know the toolbox", () => {
  const open = (missingNl: string[]): string => validateJudgeVerdict({ ...passed, outcome: "cantTell", missingNl }, context).join("\n");
  assert.match(open(["Het contrast op 320 pixels breed is niet gemeten."]), /missingNl\[0\]: an open point starts with its kind and a colon: "mens nodig:"/);
  // A point "niet bereikbaar" also says when: a time of day.
  for (const kind of OPEN_POINT_KINDS) assert.equal(open([`${kind.prefix}: het contrast op 320 pixels breed is niet gemeten op P01${kind.prefix === UNREACHABLE ? ", tussen 14:05 en 14:40" : kind.prefix === OUTSIDE_SCOPE ? ", met inhoud van https://data.example.nl" : ""}.`]), "");
  // A point "buiten de afbakening" names the address outside the run, and is the owner's: a choice of the scope.
  assert.match(open(["buiten de afbakening: het blok met openingstijden op P02 bleef leeg."]), /names the address outside the run/);
  assert.equal(openPoint("buiten de afbakening: https://data.example.nl").kind?.reader, "owner");
  assert.ok((KINDS_AFTER_FINISH as readonly string[]).includes(OUTSIDE_SCOPE));
  assert.match(open(["budget op: kort"]), /say after "budget op:" what is open and where/);
  // The words of the toolbox stay out of the text: the owner of the site reads it.
  const refs = [...context.observations.keys()];
  assert.match(open([`mens nodig: de melding op P01 was niet te zien (${refs[0]}).`]), /leave out the number of an observation/);
  assert.match(open(["proef werkte niet: loep contrast gaf geen verhouding voor de datum op P01."]), /leave out the name of a command/);
  // The name of the toolbox is an ordinary word too: only a command behind it is toolbox language.
  assert.equal(open(["mens nodig: de kleine letters op P01 zijn alleen met een loep te lezen."]), "");
  assert.match(open(["budget op: ik heb het menu op P01 niet geopend."]), /leave out "ik" or "wij"/);
  assert.match(open(["veegronde mist: de dekking die R3 en R4 vragen ontbreekt op P01."]), /leave out the number of a decision rule/);
  // A point from before the kinds existed can still be read: it has no kind.
  assert.deepEqual(openPoint("Het menu ging niet open op P01."), { kind: null, textNl: "Het menu ging niet open op P01." });
  assert.equal(openPoint("Veegronde mist:  contrast op 320 pixels.").kind!.reader, "toolbox");
  assert.equal(openPoint("keuze nodig: is het label een logo?").textNl, "Is het label een logo?");
});

test("a point that stays open only because the run may not send is the owner's choice, not work for a person", () => {
  const point = "versturen niet toegestaan: wat de chat in het venster van https://chat.voorbeeld.nl/widget?id=3 op P02 antwoordt na een bericht.";
  const kind = openPoint(point).kind!;
  assert.equal(kind.prefix, NOT_SENT);
  assert.equal(kind.reader, "owner");
  assert.equal(validateJudgeVerdict({ ...passed, outcome: "cantTell", missingNl: [point] }, context).join("\n"), "");
  // It is never "no deviation found, not fully measured": that is for limits of the evaluation alone.
  const partly: Verdict = { ...passed, outcome: "cantTell", missingNl: [point], nothingFound: { coverageNl: "gemeten op 9 van 29 pagina's en in 4 van 12 toestanden; geen verschil gevonden" } };
  assert.match(validateJudgeVerdict(partly, context).join(), /the outcome is a plain "cantTell"/);
  // The finishing round may leave it: it may not send either.
  assert.ok((KINDS_AFTER_FINISH as readonly string[]).includes(NOT_SENT));

  assert.equal(waitsOnlyOnSending([point]), true);
  assert.equal(waitsOnlyOnSending([point, "mens nodig: wat NVDA voorleest bij het menu op P01."]), false);
  assert.equal(waitsOnlyOnSending([]), false);
  // The report names the origin the points name, once each, and only from points of this kind.
  assert.deepEqual(notSentOrigins([point, `${point} Ook https://chat.voorbeeld.nl/send.`, "mens nodig: zie https://www.voorbeeld.nl/contact.", "versturen niet toegestaan: het formulier naar https://api.voorbeeld.nl:8443/v1, dan het antwoord."]), ["https://chat.voorbeeld.nl", "https://api.voorbeeld.nl:8443"]);
  assert.deepEqual(notSentOrigins(["versturen niet toegestaan: het antwoord van de chat op P02, zonder adres."]), []);

  // A run that may send to an origin has no such point about that origin; elsewhere it may stand, with the address.
  assert.deepEqual(notSentPointProblems([point], null), []);
  assert.deepEqual(notSentPointProblems([point], { origin: "https://www.voorbeeld.nl" }), []);
  assert.match(notSentPointProblems([point], { origin: "https://chat.voorbeeld.nl" }).join(), /missingNl\[0\]: this run may send to https:\/\/chat\.voorbeeld\.nl/);
  assert.match(notSentPointProblems(["versturen niet toegestaan: het antwoord van de chat op P02, zonder adres."], { origin: "https://www.voorbeeld.nl" }).join(), /name in the point the address it goes to/);
  // Once the budget for sending of the run is used up, the point may stand about that origin too, when it says so.
  const budgetOut = "versturen niet toegestaan: het budget voor versturen van deze run is op (5 van 5 verstuurd): wat de chat op P02 antwoordt.";
  assert.deepEqual(notSentPointProblems([budgetOut], { origin: "https://chat.voorbeeld.nl" }, { sent: 5, max: 5, left: 0 }), []);
  assert.match(notSentPointProblems([budgetOut], { origin: "https://chat.voorbeeld.nl" }, { sent: 2, max: 5, left: 3 }).join(), /not used up \(2 of 5 sent\)/);
  assert.match(notSentPointProblems([point], { origin: "https://chat.voorbeeld.nl" }, { sent: 5, max: 5, left: 0 }).join(), /het budget voor versturen van deze run is op \(5 van 5 verstuurd\)/);
  // A criterion that sent before and finds only the writes kept for others has used up its share: the point may stand too, and says so.
  const shareOut = "versturen niet toegestaan: het budget voor versturen van deze run is op voor dit criterium (3 van 5 verstuurd; de rest is voor criteria die nog niets verstuurden): wat de chat op P02 antwoordt.";
  assert.deepEqual(notSentPointProblems([shareOut], { origin: "https://chat.voorbeeld.nl" }, { sent: 3, max: 5, left: 0 }), []);
  assert.match(notSentPointProblems([point], { origin: "https://chat.voorbeeld.nl" }, { sent: 3, max: 5, left: 0 }).join(), /used up for this criterion: then the point says "het budget voor versturen van deze run is op voor dit criterium \(3 van 5 verstuurd; de rest is voor criteria die nog niets verstuurden\)"/);
});

test("a part of the site that did not load is its own kind: not the owner's, not loep's, and it says what and when", () => {
  const point = "niet bereikbaar: het chatvenster op P02 (https://chat.example.nl/widget) laadde niet, ook los geopend, tussen 14:05 en 14:40; de andere pagina's laadden wel.";
  const kind = openPoint(point).kind!;
  assert.equal(kind.prefix, UNREACHABLE);
  assert.equal(kind.reader, "site", "no work for the owner and no fault of loep");
  // check-verdict accepts it, for the judge and for the verifier.
  assert.equal(validateJudgeVerdict({ ...passed, outcome: "cantTell", missingNl: [point] }, context).join("\n"), "");
  const verification = { judgeOutcome: "cantTell" as const, findings: [], attackNl: "Het chatvenster op P02 twee keer opnieuw geopend; het laadde niet.", attackEvidence: ["v143-0002"] };
  const afterOpen: VerificationContext = { ...context, session: "v143", judge: { ...passed, outcome: "cantTell", missingNl: [point] } };
  assert.deepEqual(validateVerification({ ...passed, outcome: "cantTell", missingNl: [point], observations: [{ ...seen, evidence: ["v143-0002"] }], verification }, afterOpen), []);
  // What did not load, and when: both are needed, so the report can say it and a later round knows what to try.
  const open = (text: string): string => validateJudgeVerdict({ ...passed, outcome: "cantTell", missingNl: [text] }, context).join("\n");
  assert.match(open("niet bereikbaar: het chatvenster laadde niet, tussen 14:05 en 14:40."), /names what did not load/);
  assert.match(open("niet bereikbaar: het chatvenster op P02 laadde bij herhaalde pogingen niet."), /says when it did not load/);
  assert.equal(open("niet bereikbaar: https://www.example.nl/contact/ gaf om 09.12 en om 09.50 een time-out."), "");
  // A limit of the evaluation: it may stand next to "no deviation found", and the finishing round may leave it after a real attempt.
  assert.deepEqual(validateJudgeVerdict({ ...passed, outcome: "cantTell", missingNl: [point], nothingFound: { coverageNl: "gemeten op 9 van 29 pagina's en in 4 van 12 toestanden; geen verschil gevonden" } }, context), []);
  assert.ok((KINDS_AFTER_FINISH as readonly string[]).includes(UNREACHABLE));
});

test("no deviation found but not fully measured stays cantTell, and only when every open point is a limit of the evaluation", () => {
  const partly: Verdict = { ...passed, outcome: "cantTell", missingNl: ["veegronde mist: het contrast op 320 pixels breed is op geen pagina gemeten."], nothingFound: { coverageNl: "gemeten op 9 van 29 pagina's en in 4 van 12 toestanden; geen verschil gevonden" } };
  assert.deepEqual(validateJudgeVerdict(partly, context), []);
  // Without the field it is a plain "cantTell", as before.
  assert.deepEqual(validateJudgeVerdict({ ...partly, nothingFound: undefined }, context), []);
  assert.match(validateJudgeVerdict({ ...passed, nothingFound: partly.nothingFound }, context).join(), /nothingFound belongs to a "cantTell" outcome only/);
  assert.match(validateJudgeVerdict({ ...partly, nothingFound: { coverageNl: "weinig" } }, context).join(), /nothingFound\.coverageNl: say what was measured/);
  // One point a person has to look into makes the question really open.
  assert.match(validateJudgeVerdict({ ...partly, missingNl: [...partly.missingNl!, "mens nodig: wat een schermlezer voorleest in het menu op P01."] }, context).join(), /the outcome is a plain "cantTell"/);
  // Nothing was found only where somebody looked: the dossier alone is not enough.
  assert.match(validateJudgeVerdict({ ...partly, observations: [{ ...seen, evidence: ["contrast"] }] }, context).join(), /nothingFound needs at least one observation of a look or measure command/);
  const withCandidate = { ...context, candidateIds: ["P01-K01"] };
  assert.match(validateJudgeVerdict({ ...partly, candidates: [{ id: "P01-K01", ruling: "open", reasonNl: "Het menu ging niet open." }] }, withCandidate).join(), /cannot stand next to a candidate that is left open/);

  // The verifier decides for itself: it may give it where the judge did not, and take it away.
  const afterOpen: VerificationContext = { ...context, session: "v143", judge: { ...partly, nothingFound: undefined } };
  const verification = { judgeOutcome: "cantTell" as const, findings: [], attackNl: "De lichtste tekst in het geopende menu gemeten: 7,2 op 1.", attackEvidence: ["v143-0002"] };
  const given: Verdict = { ...partly, observations: [{ ...seen, evidence: ["v143-0002"] }], verification };
  assert.deepEqual(validateVerification(given, afterOpen), []);
  assert.deepEqual(validateVerification({ ...given, nothingFound: undefined }, { ...afterOpen, judge: partly }), []);
});

test("severity has four steps, the highest for a function that works for nobody", () => {
  for (const severity of ["blokkerend", "hoog", "midden", "laag"] as const) assert.deepEqual(validateJudgeVerdict({ ...failed, findings: [{ ...finding, severity }] }, context), []);
  assert.match(validateJudgeVerdict({ ...failed, findings: [{ ...finding, severity: "kritiek" as "hoog" }] }, context).join(), /severity must be one of blokkerend, hoog, midden, laag/);
});

const recommendation = { rule: "A1", titleNl: "Datum na de titel zetten", observedNl: "Bij elk nieuwsbericht staat de datum in de code vóór de titel.", recommendationNl: "Zet de datum in de code na de titel, of neem haar op in de kop.", component: null, locations: [{ page: "P02", where: ".nieuws .kaart", heading: "Nieuws" }], evidence: ["j143-0002"] };
const recommending: JudgeContext = { ...context, recommendationRules: ["A1"] };

test("a recommendation rests on a rule of the procedure, never changes the outcome and is not given where something is wrong", () => {
  // Next to a pass and next to a failure elsewhere: accepted.
  assert.deepEqual(validateJudgeVerdict({ ...passed, recommendations: [recommendation] }, recommending), []);
  assert.deepEqual(validateJudgeVerdict({ ...failed, recommendations: [recommendation] }, recommending), []);
  // A procedure without a section "Aanbevelingen" gives none, and a rule it does not have gives none.
  assert.match(validateJudgeVerdict({ ...passed, recommendations: [recommendation] }, context).join(), /has no section "Aanbevelingen"/);
  assert.match(validateJudgeVerdict({ ...passed, recommendations: [{ ...recommendation, rule: "A2" }] }, recommending).join(), /must be a recommendation rule of the procedure \(A1\)/);
  // Without an observation that shows it, or without words of the page for the place: refused.
  assert.match(validateJudgeVerdict({ ...passed, recommendations: [{ ...recommendation, evidence: ["contrast"] }] }, recommending).join(), /a recommendation needs at least one observation of a look or measure command/);
  assert.match(validateJudgeVerdict({ ...passed, recommendations: [{ ...recommendation, locations: [{ page: "P02", where: ".kaart" }] }] }, recommending).join(), /give "heading" or "text"/);
  // One place is wrong or open to improvement, not both.
  assert.match(validateJudgeVerdict({ ...failed, recommendations: [{ ...recommendation, locations: finding.locations }] }, recommending).join(), /has a finding at the same place/);
});

test("a finding the verifier drops does not come back as a recommendation at its place", () => {
  const notSeenAgain: Verdict = {
    ...passed,
    outcome: "cantTell",
    rule: "R3",
    missingNl: ["proef werkte niet: de datum op P01 gaf bij een nieuwe meting 4,6 op 1; de bevinding is niet gereproduceerd."],
    observations: [{ ...seen, evidence: ["v143-0002"] }],
    recommendations: [{ ...recommendation, locations: finding.locations, evidence: ["v143-0003"] }],
    verification: { judgeOutcome: "failed", findings: [{ key: "F1", reproduced: false, evidence: [], dropped: "notReproduced", reasonNl: "Op een verse pagina meet de datum 4,6 op 1." }] },
  };
  const recommendingVerifier: VerificationContext = { ...verifierContext, recommendationRules: ["A1"] };
  assert.match(validateVerification(notSeenAgain, recommendingVerifier).join(), /finding F1 of the judge at this place .* was dropped; it does not come back as a recommendation/);
  // Elsewhere on the site, and seen by the verifier itself: accepted.
  assert.deepEqual(validateVerification({ ...notSeenAgain, recommendations: [{ ...recommendation, evidence: ["v143-0003"] }] }, recommendingVerifier), []);
  // The verifier shows a recommendation with its own observation, like a finding.
  assert.match(validateVerification({ ...notSeenAgain, recommendations: [recommendation] }, recommendingVerifier).join(), /a recommendation needs at least one observation of session "v143"/);
});
