import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { checkRecheck, loadRechecks, recheck, renderRechecks } from "../src/commands/recheck.ts";
import { writeEvaluation } from "../src/commands/sign.ts";
import { checkSeal, seal, verify } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { otherToolboxNl, writeManifest, writeManifestTools } from "../src/lib/manifest.ts";
import { underSeal } from "../src/lib/seal.ts";
import { Daemon } from "../src/session/daemon.ts";
import { scopeForRun } from "../src/session/safety.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

// A finding of the test site, measured again after the evaluation. Lindewaard still has the
// defect; its clean twin Berkenveen stands for the site after the repair. The logo under "Wij
// werken samen met" has a file name as its text alternative in Lindewaard, and the name of the
// water board in Berkenveen.
const FINDING = "VRB-1.1.1-0a1b";
const LOGO = "css:.partners img";

let fixture: FixtureServer;

before(async () => {
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(mkdtempSync(join(tmpdir(), "recheck-fixture-")), "server.log") });
});

after(async () => {
  await fixture.close();
});

/** A finished, sealed run on one origin, whose one finding under 1.1.1 rests on an observation of the verifier at the start page. */
async function sealedRun(origin: string, sealIt = true): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "recheck-"));
  const start = `${origin}/`;
  writeFileSync(join(run, "inventory.json"), canonicalJson({ baseUrl: start, origin, pages: [{ url: start }, { url: `${origin}/contact.html` }] }));
  writeFileSync(join(run, "sample.json"), canonicalJson({ items: [{ url: start }, { url: `${origin}/contact.html` }] }));
  mkdirSync(join(run, "observations", "v-111"), { recursive: true });
  const window = { url: start, width: 1280, height: 800, scheme: "light" };
  writeFileSync(join(run, "observations", "v-111", "0001.json"), canonicalJson({ id: "v-111-0001", session: "v-111", command: "name", args: ["4"], error: null, time: "2026-10-01T10:00:00.000Z", state: { id: "0".repeat(12), start: window, steps: [] }, page: { url: start, title: "Start", viewport: { width: 1280, height: 800 }, scheme: "light", scroll: [0, 0], domSha256: "0".repeat(64) }, result: { name: "IMG_2041.jpg" }, images: [] }));
  const evaluation = exampleEvaluation();
  const criterion = evaluation.criteria.find((entry) => entry.id === "1.1.1")!;
  criterion.findings = [{ ...criterion.findings[0]!, id: FINDING, titleNl: "Logo met een bestandsnaam als tekstalternatief", observedNl: 'Het eerste logo onder "Wij werken samen met" heeft als tekstalternatief "IMG_2041.jpg".', locations: [{ page: "P1", where: 'Het eerste logo onder "Wij werken samen met"' }], pagesAffected: "P1", evidence: ["v-111-0001"] }];
  await writeEvaluation(join(run, "evaluation.json"), evaluation);
  await writeManifest(run, { command: "evaluate" });
  if (!sealIt) return run;
  await seal(run);
  assert.equal(await verify(run), true);
  return run;
}

/** The agent of the recheck: a session in the folder of the recheck, as the task tells it to start one. */
async function measure(workspace: string, session: string, page = "/", element = LOGO): Promise<{ opened: string; named: string; daemon: Daemon }> {
  const daemon = await Daemon.create(workspace, await scopeForRun(workspace, {}), { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session })).ok, true);
  const call = async (command: string, args: string[]): Promise<Record<string, unknown>> => {
    const response = await daemon.handle({ op: "command", session, command, args, options: {} });
    assert.equal(response.ok, true, JSON.stringify(response.print));
    return response.print;
  };
  const opened = (await call("open", [page])).id as string;
  const found = (await call("find", [element])).found as string[];
  const named = (await call("name", [found[0]!.split(" ")[0]!])).id as string;
  return { opened, named, daemon };
}

/** What a measurement of the recheck recorded, as text. */
const recorded = (workspace: string, id: string): string => readFileSync(join(workspace, "observations", id.slice(0, id.lastIndexOf("-")), `${id.slice(id.lastIndexOf("-") + 1)}.json`), "utf8");

const outcome = (workspace: string, session: string, entry: Record<string, unknown>): void =>
  writeFileSync(join(workspace, "uitkomst.json"), JSON.stringify({ session, findings: [{ finding: FINDING, whereNl: 'Startpagina, het eerste logo onder "Wij werken samen met".', ...entry }] }));

test("a finding that is still there: the recheck measures in its own folder, the seal of the sealed run stays valid", async () => {
  const run = await sealedRun(fixture.origins.defect);
  const written = await recheck(run, { finding: FINDING });
  const workspace = join(run, written.dir);
  assert.match(written.dir, new RegExp(`^rechecks/${FINDING.replaceAll(".", "\\.")}/\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z$`));
  const task = readFileSync(join(run, written.task), "utf8");
  assert.ok(task.includes(join(run, "observations", "v-111", "0001.json")), "the task points at the observation of the evaluation");
  assert.ok(task.includes(`check-recheck --run ${run} --finding ${FINDING}`));
  assert.ok(!task.includes("{{"), "every placeholder is filled");
  assert.ok(!JSON.parse(readFileSync(join(workspace, "manifest.json"), "utf8")).writes, "a recheck sends nothing");

  const { opened, named, daemon } = await measure(workspace, written.session);
  try {
    assert.match(recorded(workspace, named), /IMG_2041\.jpg/, "Lindewaard still has the file name as the name of the logo");
    assert.ok(existsSync(join(workspace, "observations", written.session, "0001.json")), "the observations land in the folder of the recheck");
    assert.ok(!existsSync(join(run, "observations", written.session)), "and not among those of the evaluation");

    // Without an observation, or with only the one of the evaluation, nothing passes.
    outcome(workspace, written.session, { outcome: "nog aanwezig", observedNl: "Het alt is nog steeds IMG_2041.jpg.", evidence: [] });
    assert.match((await checkRecheck(run, FINDING)).problems.join("\n"), /at least one observation of your own session/);
    outcome(workspace, written.session, { outcome: "nog aanwezig", observedNl: "Het alt is nog steeds IMG_2041.jpg.", evidence: ["v-111-0001"] });
    assert.match((await checkRecheck(run, FINDING)).problems.join("\n"), /not an observation of session n-111/);
    outcome(workspace, written.session, { outcome: "nog aanwezig", observedNl: "Het alt is nog steeds IMG_2041.jpg.", evidence: [opened] });
    assert.match((await checkRecheck(run, FINDING)).problems.join("\n"), /look or measure command/);

    outcome(workspace, written.session, { outcome: "nog aanwezig", observedNl: "De naam van het logo is nog steeds IMG_2041.jpg.", evidence: [named] });
    assert.deepEqual((await checkRecheck(run, FINDING)).problems, []);
  } finally {
    await daemon.close();
  }

  // The run verifies as before: the recheck stands outside the seal.
  assert.deepEqual((await checkSeal(run))!.problems, []);
  assert.equal(await verify(run), true);
  const appendix = await renderRechecks(run);
  assert.deepEqual([appendix.checked, appendix.unchecked], [1, 0]);
  const text = readFileSync(appendix.path, "utf8");
  assert.match(text, new RegExp(`\\(${FINDING.replaceAll(".", "\\.")}\\), 1\\.1\\.1: \\*\\*nog aanwezig\\*\\*`));
  assert.match(text, /Gemeten in: http[^\n]+, 1280 pixels breed/);
  assert.match(text, /buiten het zegel en buiten de handtekening/);
  assert.match(text, /zegt niet dat het criterium nu voldoet/);
  assert.equal(await verify(run), true, "the appendix leaves the seal whole too");
  rmSync(run, { recursive: true, force: true });
});

test("a finding that is solved on the clean twin: opgelost needs a measurement at the same place, and the seal stays valid", async () => {
  const run = await sealedRun(fixture.origins.clean);
  const written = await recheck(run, { criterion: "1.1.1" });
  const workspace = join(run, written.dir);
  assert.deepEqual(written.findings, [FINDING]);

  // A measurement on another page is not where the defect was.
  const elsewhere = await measure(workspace, written.session, "/contact.html", "css:h1");
  try {
    outcome(workspace, written.session, { outcome: "opgelost", observedNl: "Het logo heeft een goede naam.", evidence: [elsewhere.named] });
    assert.match((await checkRecheck(run, "1.1.1")).problems.join("\n"), /same place/);
  } finally {
    await elsewhere.daemon.close();
  }

  const { named, daemon } = await measure(workspace, written.session);
  try {
    assert.doesNotMatch(recorded(workspace, named), /IMG_2041/, "on the clean twin the logo has a name of its own");
    outcome(workspace, written.session, { outcome: "opgelost", observedNl: "De naam van het logo is nu de naam van het waterschap.", evidence: [] });
    assert.match((await checkRecheck(run, "1.1.1")).problems.join("\n"), /at least one observation of your own session/, "opgelost without an observation is refused");
    outcome(workspace, written.session, { outcome: "opgelost", observedNl: "De naam van het logo is nu de naam van het waterschap.", evidence: [named] });
    assert.deepEqual((await checkRecheck(run, "1.1.1")).problems, []);
  } finally {
    await daemon.close();
  }
  assert.equal(await verify(run), true, "the seal stays valid");
  const loaded = loadRechecks(run);
  assert.deepEqual(loaded.checked.map((entry) => [entry.finding, entry.outcome]), [[FINDING, "opgelost"]]);

  // A changed outcome after the check is not shown.
  writeFileSync(join(workspace, "uitkomst.json"), readFileSync(join(workspace, "uitkomst.json"), "utf8").replace("opgelost", "nog aanwezig"));
  assert.deepEqual([loadRechecks(run).checked.length, loadRechecks(run).unchecked], [0, 1]);
  rmSync(run, { recursive: true, force: true });
});

test("niet na te gaan needs a reason, and a recheck asks for a finding the evaluation has", async () => {
  const run = await sealedRun(fixture.origins.defect);
  await assert.rejects(recheck(run, { finding: "VRB-9.9.9-0000" }), /geen bevinding/);
  await assert.rejects(recheck(run, { criterion: "2.5.8" }), /geen bevindingen/);
  const written = await recheck(run, { finding: FINDING });
  const workspace = join(run, written.dir);
  const daemon = await Daemon.create(workspace, await scopeForRun(workspace, {}), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await daemon.handle({ op: "start", session: written.session });
    const opened = (await daemon.handle({ op: "command", session: written.session, command: "open", args: ["/"], options: {} })).print.id as string;
    outcome(workspace, written.session, { outcome: "niet na te gaan", observedNl: "De pagina laadt.", evidence: [opened] });
    assert.match((await checkRecheck(run, FINDING)).problems.join("\n"), /reasonNl must say why/);
    outcome(workspace, written.session, { outcome: "niet na te gaan", observedNl: "De pagina laadt.", reasonNl: "Het logo is alleen te zien na versturen van een formulier.", evidence: [opened] });
    assert.deepEqual((await checkRecheck(run, FINDING)).problems, []);
  } finally {
    await daemon.close();
  }
  rmSync(run, { recursive: true, force: true });
});

test("recheck passes the version check: it measures the site as it is now, not the sweep of the run", () => {
  const run = mkdtempSync(join(tmpdir(), "recheck-version-"));
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ toolbox: { version: "0.0.1" }, steps: [] }));
  assert.equal(otherToolboxNl(run, "recheck", false), null);
  assert.equal(otherToolboxNl(run, "check-recheck", false), null);
  assert.notEqual(otherToolboxNl(run, "tasks", false), null, "a command that writes tasks for the evaluation still refuses");
  rmSync(run, { recursive: true, force: true });
});

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("a session on a sealed run is refused before it writes, and a recheck in its own folder may start one (#375)", async () => {
  const run = await sealedRun(fixture.origins.defect);
  const manifest = readFileSync(join(run, "manifest.json"), "utf8");
  // What was given in the issue: the session of whoever leads the audit, again on the sealed run, with a higher maximum for the rechecks.
  const output = await promisify(execFile)(process.execPath, [CLI, "session", "start", "--run", run, "--session", "regie", "--max-sessions", "7"]).then(
    (done) => ({ stdout: done.stdout, code: 0 }),
    (error: { stdout: string; code: number }) => ({ stdout: error.stdout, code: error.code }),
  );
  assert.equal(output.code, 1);
  const refused = (JSON.parse(output.stdout) as { error: string }).error;
  assert.match(refused, /^geweigerd: deze run is verzegeld, en observations\/regie\/session\.json valt onder het zegel/);
  assert.match(refused, /rechecks\/<id>\/<moment>\//, "the refusal says where a recheck measures");
  assert.ok(!existsSync(join(run, "session-daemon.json")), "no session process was started for the run");
  assert.ok(!existsSync(join(run, "observations", "regie")));

  // A process for the run started some other way refuses the session too, and writes no tools into the manifest.
  const daemon = await Daemon.create(run, await scopeForRun(run, {}), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    const started = await daemon.handle({ op: "start", session: "regie", maxSessions: 7 });
    assert.equal(started.ok, false);
    assert.match(started.print.error as string, /^geweigerd: deze run is verzegeld/);
  } finally {
    await daemon.close();
  }
  assert.equal(await writeManifestTools(run, [{ id: "voiceover", available: false }]), false);
  assert.equal(readFileSync(join(run, "manifest.json"), "utf8"), manifest, "the manifest stays as it was sealed");
  assert.deepEqual((await checkSeal(run))!.problems, []);

  // The folder of a recheck lies in the sealed run, but outside the seal: its session is not refused.
  const written = await recheck(run, { finding: FINDING });
  const workspace = join(run, written.dir);
  assert.equal(underSeal(join(workspace, "observations", written.session, "session.json")), null);
  assert.equal(underSeal(join(workspace, "manifest.json")), null);
  assert.deepEqual(underSeal(join(run, "manifest.json")), { run, name: "manifest.json" });
  const { named, daemon: own } = await measure(workspace, written.session);
  try {
    assert.match(recorded(workspace, named), /IMG_2041\.jpg/);
    assert.equal((await own.handle({ op: "stop", session: written.session })).ok, true);
  } finally {
    await own.close();
  }
  assert.ok(JSON.parse(readFileSync(join(workspace, "observations", written.session, "session.json"), "utf8")).stoppedAt, "the recheck keeps its own session file");
  assert.ok(JSON.parse(readFileSync(join(workspace, "manifest.json"), "utf8")).tools, "and records its tools in its own manifest");
  assert.equal(await verify(run), true);
  rmSync(run, { recursive: true, force: true });
});

test("a session that still ran when the run was sealed measures no further, and its stop leaves the seal whole (#375)", async () => {
  const run = await sealedRun(fixture.origins.defect, false);
  const daemon = await Daemon.create(run, await scopeForRun(run, {}), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    assert.equal((await daemon.handle({ op: "start", session: "regie" })).ok, true);
    assert.equal((await daemon.handle({ op: "command", session: "regie", command: "open", args: ["/"], options: {} })).ok, true);
    await seal(run);
    const after = await daemon.handle({ op: "command", session: "regie", command: "look", args: [], options: {} });
    assert.equal(after.ok, false);
    assert.match(after.print.error as string, /^geweigerd: deze run is verzegeld, en observations\/regie valt onder het zegel/);
    const extended = await daemon.handle({ op: "extend", session: "regie", reason: "Nog een meting op de startpagina, na het verzegelen." });
    assert.match(extended.print.error as string, /^geweigerd: deze run is verzegeld/);
    assert.equal((await daemon.handle({ op: "stop", session: "regie" })).ok, true, "the session still stops");
  } finally {
    await daemon.close();
  }
  assert.deepEqual((await checkSeal(run))!.problems, []);
  assert.equal(await verify(run), true);
  rmSync(run, { recursive: true, force: true });
});
