import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkWalk, instrumentPending, instrumentTasks, skip } from "../src/commands/instrument-tasks.ts";
import { comparisonMarkdown, compareVariants, MARGIN, pairedBootstrap, REPORT_MARGIN, SEED, variant, VARIANT_FILE, type VariantRecord } from "../src/commands/variants.ts";
import type { RunData } from "../src/lib/rundata.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const USAGE_FIXTURE = fileURLToPath(new URL("./fixtures/verbruik.json", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "loep-variants-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
};
const readJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const HOME = "https://site.test/";
const CONTACT = "https://site.test/contact/";
const siteModel = {
  version: 1,
  baseUrl: HOME,
  pageTypes: [
    { id: "start", descriptionNl: "De startpagina.", representative: HOME, pages: [HOME] },
    { id: "contact", descriptionNl: "De contactpagina.", representative: CONTACT, pages: [CONTACT] },
  ],
  blockers: [],
  components: [{ id: "menu", type: "menu", descriptionNl: "Hoofdmenu achter een knop.", pageTypes: ["start"], recipe: "component-menu", postcondition: null }],
  processes: [],
  frames: [],
  notesNl: [],
};
const runData = (dir: string): RunData => ({ dir, inventory: { baseUrl: HOME }, writes: null, pages: [{ label: "P1", item: { url: HOME } }, { label: "P2", item: { url: CONTACT } }], siteModel }) as unknown as RunData;
const taskOptions = (dir: string) => ({ run: runData(dir), only: ["1.4.3"], buildDossier: () => ({ legend: { P1: {}, P2: {} }, evidence: { contrast: {} } }) });

/** A run whose sweep is done and whose agents have walked the start page: the walk is checked and the other one given up on. */
async function finishedRun(dir: string): Promise<void> {
  write(join(dir, "site.json"), siteModel);
  write(join(dir, "gate.json"), { sufficient: true });
  write(join(dir, "sample.json"), { items: [{ url: HOME }, { url: CONTACT }] });
  write(join(dir, "inventory.json"), { baseUrl: HOME, pages: [] });
  write(join(dir, "manifest.json"), { toolbox: { commit: "aaaaaaa1111111", dirty: false, lockfileSha256: "x", version: "0.10.0" }, steps: [{ command: "gate", at: "2026-10-18T10:00:00.000Z" }] });
  write(join(dir, "pages", "home", "facts.json"), { url: HOME });
  write(join(dir, "recipes", "component-menu.json"), { name: "component-menu", savedBy: "verken", steps: [] });
  write(join(dir, "recipes", "unused", "oud.json"), { name: "oud", savedBy: "verken" });
  write(join(dir, "observations", "verken", "session.json"), { session: "verken", startedAt: "2026-10-18T09:00:00.000Z", stoppedAt: "2026-10-18T09:10:00.000Z", commands: 30 });
  write(join(dir, "observations", "regie", "session.json"), { session: "regie", startedAt: "2026-10-18T09:00:00.000Z" });
  write(join(dir, "werk", "verken", "hulp.py"), "print(1)");
  write(join(dir, "gate", "answers.json"), { model: "claude-opus-5-5" });

  assert.deepEqual(await instrumentTasks(dir, taskOptions(dir)), { walks: 2, judges: 1, verifiers: 0, finishers: 0 });
  write(join(dir, "observations", "r-start", "0001.json"), { id: "r-start-0001", command: "look", error: null, state: { id: "s1", start: { url: HOME }, steps: [] }, target: null, page: { url: HOME }, result: {} });
  write(join(dir, "observations", "r-start", "session.json"), { session: "r-start", startedAt: "2026-10-18T11:00:00.000Z", stoppedAt: "2026-10-18T11:20:00.000Z", commands: 12 });
  write(join(dir, "werk", "r-start", "meet.py"), "print(2)");
  write(join(dir, "rondgang", "start.json"), { pageType: "start", page: "P1", states: [{ nameNl: "Breed", evidence: ["r-start-0001"] }], candidates: [], notWalkedNl: [] });
  assert.deepEqual(await checkWalk(dir, "start"), []);
  await skip(dir, { pageType: "contact" }, "De agent leverde twee keer geen geldige lijst.");
  await instrumentTasks(dir, taskOptions(dir));
  assert.equal((await instrumentPending(dir)).phase, "judges", "the source run is past its walks");

  // A judge saved a state of its own, and the run went on to an evaluation, a report, a seal and a comparison.
  write(join(dir, "recipes", "eigen-toestand.json"), { name: "eigen-toestand", savedBy: "b-143", steps: [] });
  write(join(dir, "observations", "b-143", "session.json"), { session: "b-143", startedAt: "2026-10-18T12:00:00.000Z" });
  write(join(dir, "werk", "samenvoeg", "taak.txt"), "x");
  write(join(dir, "verdicts", "1.4.3", "oordeel.json"), { outcome: "failed" });
  for (const file of ["evaluation.json", "evidence-index.json", "verklaring-invoer.json", "session-daemon.json", join("report", "rapport.md"), join("compare", "a.json"), join("antwoorden", "1.4.3.json"), join("signed", "signature.json")]) write(join(dir, file), {});
}

const source = join(scratch, "bron");
const copy = join(scratch, "kopie");

test("a variant copy keeps the sweep and leaves out what the agent phases wrote", async () => {
  await finishedRun(source);
  const before = readdirSync(source).sort();
  const sweepCode = readJsonFile<{ toolbox: unknown }>(join(source, "manifest.json")).toolbox;
  const { record } = await variant({ run: source, out: copy, name: "dossier-commando", noteNl: " het dossier opvragen met een commando " });

  for (const kept of ["site.json", "gate.json", "sample.json", "inventory.json", join("pages", "home", "facts.json"), join("recipes", "component-menu.json"), join("recipes", "unused", "oud.json"), join("observations", "verken", "session.json"), join("observations", "regie", "session.json"), join("werk", "verken", "hulp.py"), join("gate", "answers.json")]) {
    assert.equal(readFileSync(join(copy, kept), "utf8"), readFileSync(join(source, kept), "utf8"), `${kept} is copied as it was`);
  }
  for (const gone of ["tasks", "rondgang", "verdicts", "evaluation.json", "evidence-index.json", "verklaring-invoer.json", "session-daemon.json", "report", "compare", "antwoorden", "signed", join("observations", "r-start"), join("observations", "b-143"), join("werk", "r-start"), join("werk", "b-143"), join("werk", "samenvoeg"), join("recipes", "eigen-toestand.json")]) {
    assert.ok(!existsSync(join(copy, gone)), `${gone} is left out`);
  }
  assert.deepEqual(readdirSync(source).sort(), before, "the source run is untouched");

  const saved = readJsonFile<VariantRecord>(join(copy, VARIANT_FILE));
  assert.deepEqual(saved, record);
  assert.equal(saved.name, "dossier-commando");
  assert.equal(saved.noteNl, "het dossier opvragen met een commando");
  assert.deepEqual(saved.from, { run: "bron", toolbox: sweepCode, variant: null }, "the code that last wrote the manifest of the source");
  assert.equal(typeof saved.toolbox.version, "string");
  assert.deepEqual(saved.leftOut.sessions, ["b-143", "r-contact", "r-start", "samenvoeg"], "also the work folders tasks made for sessions that never started");
  assert.deepEqual(saved.leftOut.recipes, ["eigen-toestand"]);
  assert.ok(saved.leftOut.paths.includes("session-daemon.json") && saved.leftOut.paths.includes("tasks"));
  const steps = readJsonFile<{ steps: { command: string; from?: string }[] }>(join(copy, "manifest.json")).steps;
  assert.deepEqual(steps.map((step) => step.command), ["gate", "tasks", "tasks", "variant"], "the steps of the source stay, as its history");
  assert.equal(steps.at(-1)!.from, "bron");
});

test("on the copy, tasks and pending start the agent phases again, with the first session names and the copy's own paths", async () => {
  assert.deepEqual(await instrumentTasks(copy, taskOptions(copy)), { walks: 2, judges: 1, verifiers: 0, finishers: 0 });
  const pending = await instrumentPending(copy);
  assert.equal(pending.phase, "walks");
  // pending puts the largest task first, so the order says nothing here; the names do.
  assert.deepEqual(pending.walks.map((walk) => walk.session).sort(), ["r-contact", "r-start"]);
  assert.deepEqual(pending.skipped, []);
  const prompt = readFileSync(join(copy, "rondgang", "start.md"), "utf8");
  assert.ok(prompt.includes(copy) && !prompt.includes(source), "the walk is told to work in the copy");
  assert.equal((await instrumentPending(source)).phase, "judges", "the source run is still where it was");
});

test("a copy of a copy names the variant it came from; a copy is refused where it cannot be made", async () => {
  const again = join(scratch, "kopie-2");
  const { record } = await variant({ run: copy, out: again, name: "sonnet-verifieerders" });
  assert.equal(record.from.variant, "dossier-commando");
  assert.equal(record.noteNl, null);
  await assert.rejects(variant({ run: source, out: copy, name: "x" }), /bestaat al/);
  await assert.rejects(variant({ run: source, out: join(scratch, "y"), name: "met spatie" }), /--name/);
  await assert.rejects(variant({ run: source, out: join(source, "binnen"), name: "x" }), /in de run zelf/);
  const unswept = join(scratch, "zonder-poort");
  write(join(unswept, "site.json"), siteModel);
  await assert.rejects(variant({ run: unswept, out: join(scratch, "z"), name: "x" }), /geen afgeronde veegronde/);
  // A recipe of the site model that a judge saved over: the sweep is no longer what it was.
  const overwritten = join(scratch, "overschreven");
  write(join(overwritten, "site.json"), siteModel);
  write(join(overwritten, "gate.json"), {});
  write(join(overwritten, "recipes", "component-menu.json"), { savedBy: "b-143" });
  await assert.rejects(variant({ run: overwritten, out: join(scratch, "o"), name: "x" }), /recept component-menu hoort bij het sitemodel/);
  assert.ok(!existsSync(join(scratch, "o")), "nothing is copied when the copy is refused");
});

test("the command line makes a copy and says what to run next", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [CLI, "variant", "--run", source, "--out", join(scratch, "via-cli"), "--name", "nulmeting"]);
  assert.match(stdout, /^kopie .*via-cli \(variant nulmeting, code .*\): de veegronde van bron, zonder \d+ bestanden en mappen, 4 sessies en 1 recept van agents\n/);
  assert.match(stdout, /verder met: tasks --run .*via-cli --only <criteria>/);
});

/* ------------------------------------------------------------------------------------------ */

const reference = join(scratch, "sleutel.json");
write(reference, {
  kind: "answer-key",
  wcagVersion: "2.2",
  sampleNote: "",
  outcomeNote: "",
  failed: ["1.1.1", "1.4.3"],
  findings: [
    { id: "1.1.1-logo", criterion: "1.1.1", page: "alle", descriptionNl: "Het logo heeft als alternatief het woord logo." },
    { id: "1.4.3-kop", criterion: "1.4.3", page: "/", descriptionNl: "De kop op de foto is te licht." },
    { id: "2.4.3-menu", criterion: "2.4.3", page: "/", descriptionNl: "Buiten de criteria van deze runs." },
  ],
});

const BUDGET = "budget op: de zoekresultaten zijn niet in het donkere schema gemeten.";
const PERSON = "mens nodig: of de melding wordt voorgelezen, is met een schermlezer na te gaan.";

/** A finished run of three criteria with the outcomes, findings and open points given. */
function measuredRun(name: string, outcomes: Record<string, string>, options: { findings?: Record<string, number>; points?: Record<string, string[]>; variantName?: string; commit?: string } = {}): string {
  const dir = join(scratch, name);
  write(join(dir, "tasks", "index.json"), { tasks: Object.keys(outcomes).map((criterion) => ({ criterion })) });
  write(join(dir, "evaluation.json"), { criteria: Object.entries(outcomes).map(([id, outcome]) => ({ id, outcome, findings: Array.from({ length: options.findings?.[id] ?? 0 }, () => ({})), missingNl: options.points?.[id] ?? [] })) });
  for (const [criterion, points] of Object.entries(options.points ?? {})) write(join(dir, "verdicts", criterion, "final.json"), { outcome: "cantTell", missingNl: points });
  write(join(dir, "manifest.json"), { toolbox: { commit: options.commit ?? "bbbbbbb2222222" }, steps: [] });
  if (options.variantName) write(join(dir, VARIANT_FILE), { name: options.variantName });
  write(join(dir, "observations", "b-143", "session.json"), { startedAt: "2026-10-18T12:00:00.000Z", stoppedAt: "2026-10-18T12:30:00.000Z", commands: 40 });
  write(join(dir, "observations", "v-143", "session.json"), { startedAt: "2026-10-18T13:00:00.000Z", stoppedAt: "2026-10-18T13:10:00.000Z", commands: 25 });
  write(join(dir, "observations", "verken", "session.json"), { startedAt: "2026-10-18T09:00:00.000Z", stoppedAt: "2026-10-18T09:10:00.000Z", commands: 99 });
  return dir;
}

const baseline = [
  measuredRun("nulmeting-1", { "1.1.1": "failed", "1.4.3": "failed", "2.1.1": "passed" }, { findings: { "1.1.1": 1, "1.4.3": 2 }, points: { "2.1.1": [PERSON] } }),
  measuredRun("nulmeting-2", { "1.1.1": "failed", "1.4.3": "cantTell", "2.1.1": "passed" }, { findings: { "1.1.1": 1 }, points: { "1.4.3": [BUDGET] } }),
];
const variants = [
  measuredRun("variant-1", { "1.1.1": "failed", "1.4.3": "inapplicable", "2.1.1": "failed" }, { findings: { "1.1.1": 1, "2.1.1": 1 }, points: { "1.4.3": [BUDGET], "2.1.1": [PERSON] }, variantName: "dossier-commando", commit: "ccccccc3333333" }),
];

/** The first baseline run, measured on a criterion more: a fourth with a defect found, an unjustified report and an open point of its own. */
const wider = measuredRun("nulmeting-breed", { "1.1.1": "failed", "1.4.3": "failed", "2.1.1": "passed", "2.4.3": "failed" }, { findings: { "1.1.1": 1, "1.4.3": 2, "2.4.3": 2 }, points: { "2.1.1": [PERSON], "2.4.3": [BUDGET] } });

/** What the two classifications of compare --findings agreed on, per run. */
const CLASSES: Record<string, Record<string, string | null>> = {
  "nulmeting-breed": { "1.1.1-logo": "gevonden", "1.4.3-kop": "gevonden", "2.4.3-menu": "gevonden" },
  "nulmeting-1": { "1.1.1-logo": "gevonden", "1.4.3-kop": "gevonden" },
  "nulmeting-2": { "1.1.1-logo": "gevonden", "1.4.3-kop": "gemist-bewijs-beoordeling" },
  "variant-1": { "1.1.1-logo": "gevonden", "1.4.3-kop": null },
};
/** Per run the findings of its own, by criterion, with what both classifications agreed on: "tegenhanger" belongs to a defect of the key. */
const OWN: Record<string, [string, string | null][]> = {
  "nulmeting-breed": [["1.1.1", "tegenhanger"], ["1.4.3", "tegenhanger"], ["1.4.3", null], ["2.4.3", "tegenhanger"], ["2.4.3", "onterecht"]],
  "nulmeting-1": [["1.1.1", "tegenhanger"], ["1.4.3", "tegenhanger"], ["1.4.3", null]],
  "nulmeting-2": [["1.1.1", "tegenhanger"]],
  "variant-1": [["1.1.1", "tegenhanger"], ["2.1.1", "onterecht"]],
};
const classified = async (runDir: string) => {
  const name = runDir.split("/").at(-1)!;
  return {
    findings: Object.entries(CLASSES[name]!).map(([id, agreed]) => ({ id, agreed })),
    ownFindings: (OWN[name] ?? []).map(([criterion, agreed]) => ({ criterion, agreed })),
  } as unknown as Awaited<ReturnType<NonNullable<Parameters<typeof compareVariants>[0]["findings"]>>>;
};

test("the comparison lays the runs side by side per criterion, per defect and per kind of open point", async () => {
  const result = await compareVariants({ baseline, variant: variants, reference, usage: [USAGE_FIXTURE], findings: classified });
  assert.deepEqual(result.criteria, ["1.1.1", "1.4.3", "2.1.1"]);
  assert.equal(result.scopeNl, null);
  assert.deepEqual(result.runs.map((run) => [run.run, run.side, run.variant, run.commit]), [["nulmeting-1", "baseline", null, "bbbbbbb2222222"], ["nulmeting-2", "baseline", null, "bbbbbbb2222222"], ["variant-1", "variant", "dossier-commando", "ccccccc3333333"]]);

  const row = (id: string) => result.rows.find((entry) => entry.criterion === id)!;
  assert.deepEqual(row("1.4.3"), { criterion: "1.4.3", titleNl: row("1.4.3").titleNl, keyFails: true, baseline: ["failed", "cantTell"], variant: ["inapplicable"], spreadBaseline: 1, spreadVariant: null, spreadBetween: 1 });
  assert.deepEqual([row("1.1.1").spreadBaseline, row("1.1.1").spreadBetween], [0, 0]);
  assert.deepEqual([row("2.1.1").spreadBaseline, row("2.1.1").spreadBetween], [0, 1], "the same in the baseline, different in the variant");

  assert.deepEqual(result.defects.map((defect) => [defect.id, defect.variant, defect.foundBaseline, defect.foundVariant]), [["1.1.1-logo", ["gevonden"], [2, 2], [1, 1]], ["1.4.3-kop", ["oneens"], [1, 2], [0, 1]]], "a defect outside the criteria of the runs is left out, and one the two classifications disagree on is not found");
  assert.deepEqual(result.runs.map((run) => run.openPoints), [{ "mens nodig": 1 }, { "budget op": 1 }, { "budget op": 1, "mens nodig": 1 }]);
  assert.deepEqual(result.runs.map((run) => run.falseReports), [{ "1.1.1": 0, "1.4.3": 1, "2.1.1": 0 }, { "1.1.1": 0, "1.4.3": 0, "2.1.1": 0 }, { "1.1.1": 0, "1.4.3": 0, "2.1.1": 1 }], "a finding the classifications do not both put under a defect is unjustified");
  assert.deepEqual(result.runs[2]!.findings, { "1.1.1": 1, "1.4.3": 0, "2.1.1": 1 });

  assert.deepEqual(result.agreement.baseline, { runs: 2, unanimous: [2, 3], kappa: result.agreement.baseline.kappa });
  assert.ok(Math.abs(result.agreement.baseline.kappa! - 5 / 11) < 1e-12, "Fleiss' kappa over three criteria, two runs and three classes");
  assert.deepEqual(result.agreement.variant, { runs: 1, unanimous: [3, 3], kappa: null });

  const verdict = result.verdict!;
  assert.deepEqual([verdict.found!.units, verdict.found!.baseline.value, verdict.found!.variant.value, verdict.found!.difference.value, verdict.found!.ok], [2, 0.75, 0.5, -0.25, false]);
  assert.deepEqual([verdict.falseReports!.baseline.value, verdict.falseReports!.variant.value, verdict.falseReports!.difference.value, verdict.falseReports!.ok], [0.5, 1, 0.5, false]);
  assert.deepEqual([verdict.openPoints.baseline.value, verdict.openPoints.variant.value], [1, 2]);
  assert.equal(verdict.notWorse, false);
});

test("with --criteria, those criteria of a run with more are a fair baseline: everything else is left out", async () => {
  const narrow = await compareVariants({ baseline, variant: variants, reference, findings: classified });
  const chosen = await compareVariants({ baseline: [wider, baseline[1]!], variant: variants, reference, findings: classified, criteria: ["2.1.1", "1.1.1", "1.4.3"] });
  assert.deepEqual(chosen.criteria, ["1.1.1", "1.4.3", "2.1.1"]);
  assert.match(chosen.scopeNl!, /alleen de 3 criteria van --criteria tellen mee; nulmeting-breed heeft er 4/);
  assert.deepEqual(chosen.runs[0]!.criteria, ["1.1.1", "1.4.3", "2.1.1", "2.4.3"], "the run keeps its own criteria");
  // The run with 2.4.3 gives what the run without it gives: its defect, report, finding and open point under 2.4.3 do not count.
  for (const key of ["rows", "defects", "agreement", "verdict"] as const) assert.deepEqual(chosen[key], narrow[key], key);
  assert.deepEqual([chosen.runs[0]!.outcomes, chosen.runs[0]!.findings, chosen.runs[0]!.openPoints, chosen.runs[0]!.falseReports, chosen.runs[0]!.defects], [narrow.runs[0]!.outcomes, narrow.runs[0]!.findings, narrow.runs[0]!.openPoints, narrow.runs[0]!.falseReports, narrow.runs[0]!.defects]);
  assert.match(comparisonMarkdown(chosen), /Let op: alleen de 3 criteria van --criteria tellen mee/);

  const fewer = await compareVariants({ baseline: [wider, baseline[1]!], variant: variants, reference, findings: classified, criteria: ["1.1.1"] });
  assert.deepEqual([fewer.criteria, fewer.defects.map((defect) => defect.id), fewer.runs.map((run) => run.falseReports)], [["1.1.1"], ["1.1.1-logo"], [{ "1.1.1": 0 }, { "1.1.1": 0 }, { "1.1.1": 0 }]]);
  assert.match(fewer.scopeNl!, /nulmeting-breed heeft er 4, nulmeting-2 heeft er 3, variant-1 heeft er 3/);
});

test("runs with different criteria: without --criteria the comparison stops and names the shared ones", async () => {
  await assert.rejects(compareVariants({ baseline: [wider, baseline[1]!], variant: variants, reference, findings: classified }), /de runs hebben niet dezelfde criteria \(nulmeting-breed 4, nulmeting-2 3, variant-1 3\): kies met --criteria welke meetellen, bijvoorbeeld .*: --criteria 1\.1\.1,1\.4\.3,2\.1\.1$/);
  const apart = measuredRun("ander-criterium", { "3.3.1": "passed" });
  await assert.rejects(compareVariants({ baseline: [baseline[0]!], variant: [apart], reference, findings: classified }), /geen criterium gemeen/);
  await assert.rejects(compareVariants({ baseline, variant: variants, reference, findings: classified, criteria: ["1.1.1", "9.9.9", "logo"] }), /--criteria: "9\.9\.9", "logo" zijn geen succescriteria/);
  await assert.rejects(compareVariants({ baseline: [wider], variant: variants, reference, findings: classified, criteria: ["1.1.1", "2.4.3"] }), /variant-1 mist 2\.4\.3/);
  await assert.rejects(compareVariants({ baseline, reference, findings: classified, criteria: [] }), /noemt geen criterium/);
});

test("per role: sessions, commands and time from the run, and tokens, turns and cost from the usage file", async () => {
  const result = await compareVariants({ baseline, variant: variants, reference, usage: [USAGE_FIXTURE], findings: classified });
  const roles = Object.fromEntries(result.runs[2]!.roles.map((use) => [use.role, use]));
  assert.deepEqual(Object.keys(roles), ["walk", "judge", "verifier", "stand"], "the explorer is no agent phase; the stand agent has only a row in the usage file");
  assert.deepEqual([roles.judge!.agents, roles.judge!.commands, roles.judge!.sessionSeconds, roles.judge!.turns], [1, 40, 1800, 40]);
  assert.deepEqual(roles.judge!.tokens, { input: 100, cacheWrite: 200000, cacheRead: 4000000, output: 5000 });
  assert.ok(Math.abs(roles.judge!.costUsd! - 1.9004) < 1e-9, "Opus prices from validatie/verbruik/README.md");
  assert.ok(Math.abs(roles.verifier!.costUsd! - 0.34005) < 1e-9, "the price the usage file gives for its own model");
  assert.equal(roles.walk!.costUsd, null, "a model without a price has no cost");
  assert.deepEqual([roles.walk!.commands, roles.walk!.sessionSeconds], [null, null], "no walk session in this run");
  assert.ok(Math.abs(roles.stand!.costUsd! - 0.248016) < 1e-9);
  assert.deepEqual(result.runs[0]!.roles.map((use) => [use.role, use.tokens]), [["judge", null], ["verifier", null]], "a run without a usage file has no tokens");

  const markdown = comparisonMarkdown(result);
  assert.match(markdown, /\*\*Niet slechter: nee\.\*\*/);
  assert.match(markdown, /\| Gevonden gebreken uit de sleutel, per run \(2 gebreken\) \| 75,0% \(.*\) \| 50,0% \(.*\) \| -25,0 \(.* tot .*\) procentpunt \| ondergrens boven -5,0 \| nee \|/);
  assert.match(markdown, /\| Onterechte meldingen per run \(3 criteria\) \| 0,5 \(.*\) \| 1,0 \(.*\) \| \+0,5 \(.*\) \| bovengrens onder \+1,0 \| nee \|/);
  assert.match(markdown, /\| nulmeting \| 2 \| 2 van 3 \| 0,45 \|/);
  assert.match(markdown, /\| 1\.4\.3 .* \| voldoet niet \| voldoet niet \| kan niet bepalen \| n\.v\.t\. \| 100% \| - \| 100% \|/);
  assert.match(markdown, /\| V1 \| beoordelaar \| 1 \| 40 \| 30 min \| 100 \| 0,20 M \| 4,00 M \| 5\.000 \| 40 \| 1,90 dollar \|/);
  assert.match(markdown, /\| V1 \| rondgang \| 1 \| - \| - \| 10 \| .* \| geen prijs \|/);
  assert.doesNotMatch(markdown, /\u2013|\u2014/, "no dashes of the long kind");
});

test("only the baseline: the spread of its runs, without the checks", async () => {
  const result = await compareVariants({ baseline, reference, findings: classified });
  assert.equal(result.verdict, null);
  assert.equal(result.agreement.variant, null);
  assert.deepEqual(result.defects.map((defect) => [defect.id, defect.foundBaseline]), [["1.1.1-logo", [2, 2]], ["1.4.3-kop", [1, 2]]]);
  const markdown = comparisonMarkdown(result);
  assert.doesNotMatch(markdown, /## Niet slechter/);
  assert.match(markdown, /## Overeenstemming tussen runs/);
});

/* The decision rule, on simulated runs of a key with ten defects under two criteria. */

const bigReference = join(scratch, "sleutel-groot.json");
const DEFECTS = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, criterion: i < 5 ? "1.1.1" : "1.4.3", page: "/", descriptionNl: `Gebrek ${i}.` }));
write(bigReference, { kind: "answer-key", wcagVersion: "2.2", sampleNote: "", outcomeNote: "", failed: ["1.1.1", "1.4.3"], findings: DEFECTS });

/** Runs that each found the defects given, with unjustified reports under 1.4.3 as given. */
function simulated(prefix: string, found: number[][], reports: number[]): { dirs: string[]; findings: NonNullable<Parameters<typeof compareVariants>[0]["findings"]> } {
  const names = found.map((_, i) => `${prefix}-${i + 1}`);
  const dirs = names.map((name, i) => measuredRun(name, { "1.1.1": "failed", "1.4.3": i === 1 ? "cantTell" : "failed", "2.1.1": "passed" }));
  const byName = new Map(names.map((name, i) => [name, i]));
  const findings = async (runDir: string) => {
    const i = byName.get(runDir.split("/").at(-1)!)!;
    return {
      findings: DEFECTS.map((defect, d) => ({ id: defect.id, agreed: found[i]!.includes(d) ? "gevonden" : "gemist-bewijs-beoordeling" })),
      ownFindings: Array.from({ length: reports[i]! }, () => ({ criterion: "1.4.3", agreed: "onterecht" })),
    } as unknown as Awaited<ReturnType<NonNullable<Parameters<typeof compareVariants>[0]["findings"]>>>;
  };
  return { dirs, findings };
}
const both = (...sides: ReturnType<typeof simulated>["findings"][]) => async (runDir: string) => {
  for (const side of sides) {
    try {
      return await side(runDir);
    } catch {
      // Not a run of this side.
    }
  }
  throw new Error(`geen indeling voor ${runDir}`);
};

// Three runs that differ from each other: one misses two defects, one makes a report too many.
const SAME = [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 5, 6, 7, 9]];
const SAME_REPORTS = [0, 1, 0];

test("the same simulated runs twice are not worse: the difference is zero with an interval of zero", async () => {
  const before = simulated("zelfde-n", SAME, SAME_REPORTS);
  const after = simulated("zelfde-v", SAME, SAME_REPORTS);
  const result = await compareVariants({ baseline: before.dirs, variant: after.dirs, reference: bigReference, findings: both(before.findings, after.findings) });
  const verdict = result.verdict!;
  assert.deepEqual(verdict.found!.difference, { value: 0, low: 0, high: 0 });
  assert.deepEqual([verdict.found!.units, verdict.found!.baseline.value], [10, 26 / 30]);
  assert.deepEqual(verdict.falseReports!.difference, { value: 0, low: 0, high: 0 });
  assert.equal(verdict.notWorse, true, "the runs of each side differ, but the sides do not");
  assert.deepEqual([verdict.margin, verdict.reportMargin], [MARGIN, REPORT_MARGIN]);
  assert.deepEqual(result.agreement.baseline, result.agreement.variant!);
  const contrast = result.rows.find((row) => row.criterion === "1.4.3")!;
  assert.deepEqual([contrast.spreadBaseline, contrast.spreadVariant, contrast.spreadBetween], [2 / 3, 2 / 3, 4 / 9], "1.4.3 differs between the sides no more than within one side");
  assert.match(comparisonMarkdown(result), /\*\*Niet slechter: ja\.\*\*/);
});

test("a variant that clearly finds less is worse: the interval lies below the margin", async () => {
  const before = simulated("minder-n", SAME, SAME_REPORTS);
  const after = simulated("minder-v", [[0, 1, 2, 5, 6], [0, 1, 5, 6, 7], [0, 2, 5, 6]], SAME_REPORTS);
  const result = await compareVariants({ baseline: before.dirs, variant: after.dirs, reference: bigReference, findings: both(before.findings, after.findings) });
  const found = result.verdict!.found!;
  assert.ok(Math.abs(found.difference.value - (14 / 30 - 26 / 30)) < 1e-12);
  assert.ok(found.difference.high < -MARGIN, "the whole interval lies below the margin");
  assert.equal(found.ok, false);
  assert.equal(result.verdict!.falseReports!.ok, true, "no more reports");
  assert.equal(result.verdict!.notWorse, false);

  // A wider margin, chosen beforehand, lets the same variant through.
  const wide = await compareVariants({ baseline: before.dirs, variant: after.dirs, reference: bigReference, findings: both(before.findings, after.findings), margin: 0.9 });
  assert.equal(wide.verdict!.notWorse, true);
});

test("the bootstrap gives the same interval for the same seed", async () => {
  // Values that differ from each other, so another draw gives other bounds.
  const units = Array.from({ length: 20 }, (_, i): [number, number] => [((i * 37) % 101) / 101, ((i * 53) % 97) / 97]);
  const first = pairedBootstrap(units, "mean", { seed: 7, resamples: 2000 });
  assert.deepEqual(pairedBootstrap(units, "mean", { seed: 7, resamples: 2000 }), first);
  assert.notDeepEqual(pairedBootstrap(units, "mean", { seed: 8, resamples: 2000 }).difference, first.difference, "another seed draws otherwise");
  assert.ok(first.difference.low <= first.difference.value && first.difference.value <= first.difference.high);

  const before = simulated("seed-n", SAME, SAME_REPORTS);
  const after = simulated("seed-v", [[0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], [1, 0, 2]);
  const options = { baseline: before.dirs, variant: after.dirs, reference: bigReference, findings: both(before.findings, after.findings) };
  const [one, two] = [await compareVariants(options), await compareVariants(options)];
  assert.deepEqual(one.verdict, two.verdict);
  assert.equal(one.verdict!.seed, SEED);
  assert.equal((await compareVariants({ ...options, seed: 1 })).verdict!.seed, 1);
});

test("the comparison refuses what does not fit together", async () => {
  await assert.rejects(compareVariants({ baseline: [], reference }), /--baseline/);
  await assert.rejects(compareVariants({ baseline: [baseline[0]!, baseline[0]!], reference, findings: classified }), /twee keer/);
  await assert.rejects(compareVariants({ baseline: [baseline[0]!], reference, usage: [USAGE_FIXTURE], findings: classified }), /niet wordt vergeleken: variant-1/);
  await assert.rejects(compareVariants({ baseline: [join(scratch, "bestaat-niet")], reference }), /tasks\/index\.json/);
  const bad = join(scratch, "verbruik-fout.json");
  write(bad, { schema: "loep/verbruik/1", run: "nulmeting-1", agents: [{ session: "b-143", input: -1, cacheWrite: 0, cacheRead: 0, output: 0 }] });
  await assert.rejects(compareVariants({ baseline: [baseline[0]!], reference, usage: [bad], findings: classified }), /agents\[0\]\.input/);
});

test("on the command line, a run without a classification per finding says so and keeps its outcomes", async () => {
  const out = join(scratch, "vergelijking");
  const { stdout } = await promisify(execFile)(process.execPath, [CLI, "compare-variants", "--baseline", baseline[0]!, "--baseline", baseline[1]!, "--variant", variants[0]!, "--reference", reference, "--usage", USAGE_FIXTURE, "--out", out]);
  assert.match(stdout, /^3 runs, 3 criteria, 2 gebreken uit de sleutel; .*varianten\.md\nniet slechter: niet te bepalen \(gevonden niet te bepalen; onterechte meldingen niet te bepalen\)\n$/);
  const saved = readJsonFile<{ runs: { defects: Record<string, unknown>; defectsNl: string | null }[] }>(join(out, "varianten.json"));
  assert.deepEqual(saved.runs[0]!.defects, { "1.1.1-logo": null, "1.4.3-kop": null });
  assert.match(saved.runs[0]!.defectsNl!, /geen geldige indeling per bevinding/);
  assert.match(readFileSync(join(out, "varianten.md"), "utf8"), /N1: geen geldige indeling per bevinding/);

  const chosen = await promisify(execFile)(process.execPath, [CLI, "compare-variants", "--baseline", wider, "--variant", variants[0]!, "--reference", reference, "--criteria", "1.1.1, 2.1.1", "--json"]);
  assert.deepEqual((JSON.parse(chosen.stdout) as { criteria: string[] }).criteria, ["1.1.1", "2.1.1"], "a list with commas, as tasks --only takes it");
});
