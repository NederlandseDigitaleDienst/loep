import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { collect } from "../src/commands/collect.ts";
import { evaluate } from "../src/commands/evaluate.ts";
import { exploreContext } from "../src/commands/explore.ts";
import { gaps } from "../src/commands/gaps.ts";
import { checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, skip, type InstrumentTask } from "../src/commands/instrument-tasks.ts";
import { inventory } from "../src/commands/inventory.ts";
import { render } from "../src/commands/render.ts";
import { sample } from "../src/commands/sample.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import type { Verdict } from "../src/lib/verdict.ts";

// The whole command `evaluate` on a run that went through all four phases: the sweep on the
// local test site, and then the verdicts of a judge, a verifier and a finishing round as agents
// would have written them. Four criteria, each ending another way.
const CRITERIA = { finishedPass: "1.3.4", finishedFail: "1.4.4", person: "1.4.5", verified: "1.4.11" };
const SWEEP = "veegronde mist: het geopende menu is vooraf niet op het smalle scherm gemeten op de tweede pagina.";
const BUDGET = "budget op: de vergrote weergave is op een van de twee pagina's bekeken; de tweede pagina is niet bekeken.";
const PERSON = "mens nodig: of de tekst in het logo ook als tekst wordt voorgelezen, is met een schermlezer na te gaan op de eerste pagina.";

let fixture: FixtureServer;
let scratch: string;
let run: string;
let home: string;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-evaluate-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  run = join(scratch, "run");
});

after(async () => {
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

const write = (path: string, value: unknown): void => {
  mkdirSync(join(run, path, ".."), { recursive: true });
  writeFileSync(join(run, path), JSON.stringify(value));
};
let made = 0;
/** A recorded observation, as a session writes it. */
const observe = (session: string, command: string): string => {
  const id = `${session}-${String(++made).padStart(4, "0")}`;
  write(join("observations", session, `${String(made).padStart(4, "0")}.json`), { id, command, error: null, state: { id: "s1", start: { url: home }, steps: [] }, target: null, page: { url: home }, result: {} });
  return id;
};
/** The session file of an agent; `extensions` is how often it added to its own budget. */
const sessionFile = (session: string, extensions = 0): void =>
  write(join("observations", session, "session.json"), {
    session,
    startedAt: "2026-01-01T10:00:00.000Z",
    stoppedAt: "2026-01-01T10:20:00.000Z",
    commands: 40,
    limits: { maxCommands: 80 + 40 * extensions, maxMinutes: 30 + 15 * extensions, maxSessions: 4 },
    ...(extensions > 0 ? { extensions: Array.from({ length: extensions }, () => ({ at: "2026-01-01T10:10:00.000Z", reasonNl: "De tweede pagina is nog niet vergroot bekeken.", commands: 40, minutes: 15, usedCommands: 70, usedMinutes: 9 })) } : {}),
  });
const digits = (id: string): string => id.replaceAll(".", "");
const task = async (id: string): Promise<InstrumentTask> => (await loadInstrumentIndex(run)).tasks.find((entry) => entry.criterion === id)!;
const seen = (evidence: string[], ruling: "noIssue" | "open" | "finding" = "noIssue", finding?: string): Verdict["observations"][number] => ({ checkedNl: "De pagina's van de steekproef", howNl: "Bekeken en gemeten in de sessie", observedNl: "Wat er op de pagina staat, zoals gemeten", evidence, ruling, ...(finding ? { finding } : {}) });
const passEvidence = async (id: string, session: string): Promise<string[]> => [observe(session, "look"), ...(await task(id)).passCommands.map((command) => observe(session, command))];
const valid = async (id: string, round: "judge" | "final" | "finish"): Promise<void> => assert.deepEqual(await checkInstrumentVerdict(run, id, round), [], `${id} ${round}`);

test("evaluate on a run with a finishing round: its verdict is the outcome, what asks a person stays open, and the extensions are counted", { timeout: 600_000 }, async () => {
  // The sweep, on two pages of the local test site.
  const origin = fixture.origins.clean;
  home = `${origin}/sitemap.html`;
  await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 5, fixedUrls: [home, `${origin}/openingstijden.html`] });
  const context = exploreContext(await readJson(join(run, "inventory.json")));
  writeFileSync(join(run, "site.json"), JSON.stringify({ version: 1, baseUrl: context.baseUrl, descriptionNl: "Twee pagina's van een gemeentesite.", pageTypes: context.proposedPageTypes.map((type, index) => ({ ...type, descriptionNl: `Paginatype ${index + 1}` })), blockers: [], components: [], processes: [], frames: context.frames.map((frame) => ({ address: frame.address, class: "no-content", descriptionNl: "Leeg venster", reasonNl: "Toont de bezoeker niets." })), notesNl: [] }, null, 2));
  await writeJson(join(run, "site-check.json"), { ok: true, siteSha256: await sha256File(join(run, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
  await sample(run, "seed");
  await collect({ run });

  // Walks: given up on. Judges and verifiers: three criteria stay open, one passes.
  const only = Object.values(CRITERIA);
  const written = await instrumentTasks(run, { only });
  for (const walk of (await loadInstrumentIndex(run)).walks) await skip(run, { pageType: walk.pageType }, "Voor deze test is geen rondgang nodig.");
  assert.equal(written.judges, 4);
  // The budget in the index is the computed one: 1.4.4 and 1.4.5 each had a judge at its limit in an earlier run and get half more than the floor.
  assert.deepEqual([(await task(CRITERIA.finishedFail)).judge.maxCommands, (await task(CRITERIA.person)).judge.maxCommands], [120, 120]);
  assert.equal((await task(CRITERIA.finishedPass)).judge.maxCommands, 80);

  const open: Record<string, string[]> = { [CRITERIA.finishedPass]: [SWEEP], [CRITERIA.finishedFail]: [BUDGET], [CRITERIA.person]: [PERSON] };
  for (const [id, points] of Object.entries(open)) {
    const session = `b-${digits(id)}`;
    // A point about the budget is accepted from a session that extended twice.
    sessionFile(session, points.includes(BUDGET) ? 2 : 0);
    write(join("verdicts", id, "oordeel.json"), { criterion: id, outcome: "cantTell", rule: "R9", summaryNl: "Er is geen afwijking gezien, maar niet alles is vastgesteld.", observations: [seen([observe(session, "look")], "open")], findings: [], missingNl: points } satisfies Verdict);
    await valid(id, "judge");
  }
  sessionFile(`b-${digits(CRITERIA.verified)}`);
  write(join("verdicts", CRITERIA.verified, "oordeel.json"), { criterion: CRITERIA.verified, outcome: "passed", rule: "R6", summaryNl: "Randen en pictogrammen steken genoeg af op de bekeken pagina's.", observations: [seen(await passEvidence(CRITERIA.verified, `b-${digits(CRITERIA.verified)}`))], findings: [] } satisfies Verdict);
  await valid(CRITERIA.verified, "judge");

  assert.equal((await instrumentTasks(run, { only })).verifiers, 4);
  for (const [id, points] of Object.entries(open)) {
    const session = `v-${digits(id)}`;
    sessionFile(session, points.includes(BUDGET) ? 2 : 0);
    const look = observe(session, "look");
    write(join("verdicts", id, "final.json"), { criterion: id, outcome: "cantTell", rule: "R9", summaryNl: "Ook bij de controle is niet alles vastgesteld.", observations: [seen([look], "open")], findings: [], missingNl: points, verification: { judgeOutcome: "cantTell", findings: [], attackNl: "Geprobeerd het open punt te beslechten met een tweede blik op de eerste pagina.", attackEvidence: [look] } } satisfies Verdict);
    await valid(id, "final");
  }
  sessionFile(`v-${digits(CRITERIA.verified)}`);
  const attack = await passEvidence(CRITERIA.verified, `v-${digits(CRITERIA.verified)}`);
  write(join("verdicts", CRITERIA.verified, "final.json"), { criterion: CRITERIA.verified, outcome: "passed", rule: "R6", summaryNl: "Ook bij de controle steken randen en pictogrammen genoeg af.", observations: [seen(attack)], findings: [], verification: { judgeOutcome: "passed", findings: [], attackNl: "Gezocht naar een rand die te licht is op de tweede pagina; geen gevonden.", attackEvidence: attack } } satisfies Verdict);
  await valid(CRITERIA.verified, "final");

  // The finishing round: for the two criteria the evaluation itself left open, not for the one that asks a person.
  assert.equal((await instrumentTasks(run, { only })).finishers, 2);
  assert.deepEqual((await instrumentPending(run)).finishers.map((entry) => entry.criterion), [CRITERIA.finishedPass, CRITERIA.finishedFail]);
  // The round of 1.4.4 follows its judge: half more than the floor of 280 commands and 105 minutes.
  assert.deepEqual([(await task(CRITERIA.finishedPass)).finish!.maxCommands, (await task(CRITERIA.finishedFail)).finish!.maxCommands, (await task(CRITERIA.finishedFail)).finish!.maxMinutes], [280, 420, 158]);

  const passSession = `a-${digits(CRITERIA.finishedPass)}`;
  sessionFile(passSession, 1);
  const evidence = await passEvidence(CRITERIA.finishedPass, passSession);
  write(join("verdicts", CRITERIA.finishedPass, "afmaak.json"), { criterion: CRITERIA.finishedPass, outcome: "passed", rule: "R5", summaryNl: "Het geopende menu werkt staand en liggend op beide pagina's.", observations: [seen(evidence)], findings: [], finish: { points: [{ point: 1, settled: true, howNl: "Het menu is op beide pagina's geopend op 320 pixels en bekeken.", evidence }], coverageNl: "Gemeten op 2 van de 2 pagina's, breed en op 320 pixels, met het menu open.", findings: [] } } satisfies Verdict);
  await valid(CRITERIA.finishedPass, "finish");

  const failSession = `a-${digits(CRITERIA.finishedFail)}`;
  // The label of the second page, as the legend of the dossier has it.
  const second = Object.keys((await readJson<{ legend: Record<string, unknown> }>(join(run, (await task(CRITERIA.finishedFail)).dossier))).legend)[1]!;
  sessionFile(failSession);
  const first = observe(failSession, "zoom");
  observe(failSession, "open");
  const again = observe(failSession, "zoom");
  write(join("verdicts", CRITERIA.finishedFail, "afmaak.json"), {
    criterion: CRITERIA.finishedFail,
    outcome: "failed",
    rule: "R1",
    summaryNl: "Op de tweede pagina valt tekst weg bij 200% vergroting.",
    observations: [seen([first], "finding", "F1")],
    findings: [{ key: "F1", titleNl: "Tekst valt weg bij vergroten", observedNl: "Bij 200% vergroting valt de laatste regel van de inleiding buiten beeld.", impactNl: "Slechtzienden missen een deel van de tekst.", fixNl: "Laat de tekst meegroeien met het venster en meet opnieuw op 320 pixels en op een tussenbreedte.", severity: "hoog", owner: "techniek", component: null, locations: [{ page: second, where: "inleiding", wholePage: true }], pagesAffected: `gemeten op ${second}`, evidence: [first, again] }],
    finish: { points: [{ point: 1, settled: true, howNl: "De tweede pagina is op 200% bekeken en gemeten.", evidence: [first] }], coverageNl: "Gemeten op 2 van de 2 pagina's op 200% vergroting.", findings: [{ key: "F1", first: [first], repeated: [again] }] },
  } satisfies Verdict);
  await valid(CRITERIA.finishedFail, "finish");
  assert.equal((await instrumentPending(run)).phase, "done");

  // The whole command.
  const evaluation = await evaluate({ run, name: "Berkenveen", organisation: "Gemeente Berkenveen", model: "voorbeeld-model-1" });
  const of = (id: string): Evaluation["criteria"][number] => evaluation.criteria.find((criterion) => criterion.id === id)!;
  assert.deepEqual(Object.values(CRITERIA).map((id) => [id, of(id).outcome, of(id).established?.by]), [
    [CRITERIA.finishedPass, "passed", "finishing"],
    [CRITERIA.finishedFail, "failed", "finishing"],
    [CRITERIA.person, "cantTell", "verification"],
    [CRITERIA.verified, "passed", "verification"],
  ]);
  // The earlier rounds are kept next to the one that counts.
  assert.deepEqual(of(CRITERIA.finishedPass).rounds, { a: "cantTell", b: null, final: "cantTell", finish: "passed" });
  assert.deepEqual(of(CRITERIA.finishedPass).established?.before, { roundNl: "controle", outcome: "cantTell", summaryNl: "Ook bij de controle is niet alles vastgesteld.", missingNl: [SWEEP] });
  assert.deepEqual(of(CRITERIA.finishedPass).missingNl, []);
  // A finding of the finishing round was seen twice by the same agent; nobody verified it.
  const finding = of(CRITERIA.finishedFail).findings[0]!;
  assert.match(finding.id, /^BERK-/);
  assert.deepEqual(finding.verification, { status: "repeated", evidence: [again] });
  assert.deepEqual(of(CRITERIA.person).missingNl, [PERSON]);
  // Every criterion outside the four has no task and so no verdict.
  assert.equal(evaluation.criteria.filter((criterion) => criterion.outcome === "untested").length, evaluation.criteria.length - 4);
  assert.ok(evaluation.judgment.rounds.includes("afmaakronde voor wat het onderzoek zelf open liet"));
  assert.match(evaluation.limitationsNl.join("\n"), /Bij 2 criteria \(1\.3\.4, 1\.4\.4\) is het oordeel vastgesteld in een aanvullende meting, nadat het eerst open bleef door een beperking van het onderzoek\./);
  assert.equal(evaluation.judgment.model, "voorbeeld-model-1");

  // The extensions, per role: one judge of four, one verifier of four, one finisher of two.
  assert.deepEqual(evaluation.judgment.extensions, [
    { role: "judge", roleNl: "beoordelaar", sessions: 4, extended: 1, extensions: 2 },
    { role: "verifier", roleNl: "verifieerder", sessions: 4, extended: 1, extensions: 2 },
    { role: "finisher", roleNl: "afmaakronde", sessions: 2, extended: 1, extensions: 1 },
  ]);
  const step = (await readJson<Manifest>(join(run, "manifest.json"))).steps.findLast((entry) => entry.command === "evaluate")!;
  assert.deepEqual(step.establishedBy, { verification: 2, finishing: 2, person: 0 });
  assert.deepEqual(step.open, { owner: [CRITERIA.person], evaluation: evaluation.criteria.filter((criterion) => criterion.outcome === "untested").map((criterion) => criterion.id) });
  assert.deepEqual(step.extensions, evaluation.judgment.extensions);
  assert.deepEqual((step.agentPhases as { phase: string; agents: number }[]).map((phase) => [phase.phase, phase.agents]), [["judges", 4], ["verifiers", 4], ["finishers", 2]]);

  // What evaluate wrote is what it returned, and the report is made from it.
  const stored = await readJson<Evaluation>(join(run, "evaluation.json"));
  assert.deepEqual(stored.criteria.find((criterion) => criterion.id === CRITERIA.finishedFail)!.established, of(CRITERIA.finishedFail).established);
  const report = readFileSync((await render(run)).markdown, "utf8");
  assert.match(report, /Afmaken/);
  assert.match(report, /^- Verlengd budget: beoordelaar: 1 van de 4 sessies \(2 keer\); verifieerder: 1 van de 4 sessies \(2 keer\); afmaakronde: 1 van de 2 sessies \(1 keer\)\. /m);
  assert.match(report, /Uit de aanvullende meting, twee keer gezien door één beoordelaar/);

  // The open points of the run, for whoever improves the sweep: what the rounds wrote, and what still stands.
  const list = gaps([run]);
  assert.deepEqual(list.kinds.map((kind) => [kind.kind, kind.points, kind.distinct, kind.standing]), [["veegronde mist", 2, 1, 0], ["budget op", 2, 1, 0], ["mens nodig", 2, 1, 1]]);
});
