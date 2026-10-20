import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { BUDGETS, coverageOf } from "../src/commands/instrument-tasks.ts";
import { CEILINGS, EXTENSION, extensionOf, extensionUse, extensionsNl, extensionsOf, finishBudget, judgeBudget, MEASURED_USE, REFERENCE_SITE_SIZE, sizeFactor, useFactor, verifyBudget, walkBudget, type Extension } from "../src/lib/budget.ts";
import { deriveReport, renderMarkdown } from "../src/lib/report-markdown.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { loadAllProcedures } from "../src/lib/procedures.ts";
import { Daemon, type Response } from "../src/session/daemon.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

// A site of the size the factors were measured on, and one twice as large.
const USUAL = { pageTypes: 15, states: 15 };
const LARGE = { pageTypes: 40, states: 28 };

test("the fixed budget of a role is the floor: a light criterion on a usual site gets exactly that", () => {
  // 2.5.4: no judge came above 20 percent of its budget in the measured runs.
  assert.equal(useFactor("judge", "2.5.4"), 1);
  assert.deepEqual(judgeBudget(BUDGETS.judge, "2.5.4", USUAL, 0), BUDGETS.judge);
  // A small site does not get less than the floor, and neither does a criterion nothing was measured for.
  assert.deepEqual(judgeBudget(BUDGETS.judge, "2.5.4", { pageTypes: 1, states: 0 }, 0), BUDGETS.judge);
  assert.equal(useFactor("judge", "9.9.9"), 1);
  assert.deepEqual(judgeBudget(BUDGETS.judge, "9.9.9", USUAL, 0), BUDGETS.judge);
  assert.deepEqual(walkBudget(BUDGETS.walk, 0), BUDGETS.walk);
  assert.deepEqual(walkBudget(BUDGETS.walk, 4), BUDGETS.walk);
  assert.deepEqual(verifyBudget({ commands: 30, minutes: 30 }, "2.5.4", USUAL), { commands: 30, minutes: 30 });
  assert.deepEqual(finishBudget(BUDGETS.finish, BUDGETS.judge, BUDGETS.judge), BUDGETS.finish);
});

test("a heavy criterion gets more: twice the floor where half of the measured sessions ended at their limit", () => {
  // 1.4.3: every judge and every verifier of the four runs was at the limit.
  assert.deepEqual(MEASURED_USE["1.4.3"], { judge: [4, 4, 100], verify: [4, 4, 100] });
  assert.equal(useFactor("judge", "1.4.3"), 2);
  assert.deepEqual(judgeBudget(BUDGETS.judge, "1.4.3", USUAL, 0), { commands: BUDGETS.judge.commands * 2, minutes: BUDGETS.judge.minutes * 2 });
  // One session at the limit: one and a half. None, but one at 80 percent or more: a quarter more.
  assert.deepEqual([MEASURED_USE["1.3.1"]!.judge, useFactor("judge", "1.3.1")], [[4, 1, 99], 1.5]);
  assert.deepEqual([MEASURED_USE["4.1.1"]!.judge, useFactor("judge", "4.1.1")], [[4, 0, 81], 1.25]);
  // The verifier has numbers of its own: 3.2.2 was light for the judge and heavy to verify.
  assert.deepEqual([useFactor("judge", "3.2.2"), useFactor("verify", "3.2.2")], [1, 2]);
  assert.deepEqual(verifyBudget({ commands: 30, minutes: 30 }, "3.2.2", USUAL), { commands: 60, minutes: 60 });
  // Every candidate of the walk-through is one more command, and a page type with many states is a longer walk.
  assert.equal(judgeBudget(BUDGETS.judge, "2.5.4", USUAL, 25).commands, BUDGETS.judge.commands + 25);
  assert.equal(walkBudget(BUDGETS.walk, 8).commands, BUDGETS.walk.commands + 40);
  // The finishing round follows the judge of its criterion.
  assert.equal(finishBudget(BUDGETS.finish, { commands: BUDGETS.judge.commands * 1.25, minutes: 0 }, BUDGETS.judge).commands, BUDGETS.finish.commands * 1.25);
  // The table covers every criterion that has a procedure.
  assert.deepEqual(loadAllProcedures().procedures.map((procedure) => procedure.id).filter((id) => !(id in MEASURED_USE)), []);
});

test("a site larger than the measured ones gets more in proportion, and every role has a ceiling", () => {
  assert.equal(sizeFactor(USUAL), 1);
  assert.equal(sizeFactor({ pageTypes: REFERENCE_SITE_SIZE, states: REFERENCE_SITE_SIZE }), 2);
  assert.equal(judgeBudget(BUDGETS.judge, "2.5.4", LARGE, 0).commands, BUDGETS.judge.commands * 2);
  // Heavy criterion, large site, many candidates: the ceiling holds, in commands and in minutes.
  assert.deepEqual(judgeBudget(BUDGETS.judge, "1.4.3", LARGE, 300), CEILINGS.judge);
  assert.deepEqual(verifyBudget({ commands: 191, minutes: 30 }, "1.4.3", LARGE), { commands: CEILINGS.verify.commands, minutes: Math.ceil((30 * CEILINGS.verify.commands) / 191) });
  assert.deepEqual(walkBudget(BUDGETS.walk, 40), CEILINGS.walk);
  assert.deepEqual(finishBudget(BUDGETS.finish, CEILINGS.judge, BUDGETS.judge), CEILINGS.finish);
  for (const role of ["walk", "judge", "finish"] as const) assert.ok(CEILINGS[role].commands > BUDGETS[role].commands && CEILINGS[role].minutes > BUDGETS[role].minutes, role);
  // A verifier whose floor is already above the ceiling keeps its floor: nobody gets less than before.
  assert.equal(verifyBudget({ commands: 300, minutes: 30 }, "2.5.4", USUAL).commands, 300);
});

test("what a criterion has to cover is read from the site model and the inventory", () => {
  const page = (url: string, forms: number) => ({ url, counts: { forms } });
  const run = {
    inventory: { pages: [page("https://site.test/", 0), page("https://site.test/contact/", 2), page("https://site.test/nieuws/", 0)] },
    siteModel: {
      pageTypes: [{ id: "start", pages: ["https://site.test/"] }, { id: "contact", pages: ["https://site.test/contact/"] }, { id: "nieuws", pages: ["https://site.test/nieuws/"] }],
      components: [{ pageTypes: ["start", "contact", "nieuws"] }, { pageTypes: ["contact"] }, { pageTypes: ["nieuws"] }],
      processes: [{}],
      blockers: [{}],
    },
  } as unknown as RunData;
  assert.deepEqual(coverageOf(run, { inapplicableIfZero: [] }), { pageTypes: 3, states: 5 });
  // A criterion about forms applies where the inventory counted a form.
  assert.deepEqual(coverageOf(run, { inapplicableIfZero: ["forms"] }), { pageTypes: 1, states: 4 });
  assert.deepEqual(coverageOf(run, { inapplicableIfZero: ["video"] }), { pageTypes: 0, states: 0 });
});

let site: FixtureServer;
let run: string;
let daemon: Daemon;
const SESSION = "b-143";
const REASON = "De foutmeldingen van het formulier zijn nog niet op 320 pixels gemeten.";

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-budget-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 20, maxSessions: 3, secondBrowsers: false });
});
after(async () => {
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

const command = (name: string, args: string[] = []): Promise<Response> => daemon.handle({ op: "command", session: SESSION, command: name, args, options: {} });
const extend = (reason?: string): Promise<Response> => daemon.handle({ op: "extend", session: SESSION, ...(reason === undefined ? {} : { reason }) });
const sessionFile = (): { commands: number; limits: { maxCommands: number; maxMinutes: number; maxSessions: number; navigationDelayMs: number }; extensions?: Extension[] } => JSON.parse(readFileSync(join(run, "observations", SESSION, "session.json"), "utf8"));

test("from 80 percent of the budget every answer says in one line what is left and how to extend", async () => {
  assert.equal((await daemon.handle({ op: "start", session: SESSION, limits: { maxCommands: 5, maxMinutes: 20 } })).ok, true);
  for (let turn = 0; turn < 3; turn++) assert.equal("budget" in (await command("open", ["/"])).print, false, "three of five commands: nothing to say yet");
  assert.equal("budget" in (await command("status")).print, false);
  // Before most of the budget is used there is nothing to extend.
  assert.match((await extend(REASON)).print.error as string, /^verlengen kan vanaf 80 procent van het budget; deze sessie heeft 3 van 5 commando's/);
  const fourth = await command("look");
  assert.match(fourth.print.budget as string, /^nog 1 van 5 commando's en [\d.]+ van 20 minuten: rond nu af en kom tot een oordeel\. Moet er nog iets gemeten worden: session extend --session b-143 --reason "<wat er nog gemeten moet worden>" \(kan nog 2 keer\)$/);
  assert.doesNotMatch(fourth.print.budget as string, /\n/, "one line");
  // Repeated with every answer from then on, also one that costs nothing and one that fails.
  assert.match((await command("status")).print.budget as string, /^nog 1 van 5 commando's/);
  assert.match((await command("html", ["999"])).print.budget as string, /^nog 1 van 5 commando's/);
  // The minutes count the same way: a session that used few commands but most of its time is warned too.
  assert.equal((await daemon.handle({ op: "start", session: "klok", limits: { maxCommands: 50, maxMinutes: 0.0001 } })).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match((await daemon.handle({ op: "command", session: "klok", command: "status", args: [], options: {} })).print.budget as string, /^nog 50 van 50 commando's en 0 van 0\.0001 minuten: rond nu af/);
  await daemon.handle({ op: "stop", session: "klok" });
});

test("a session extends its own budget twice, each time with a reason, and the third time is refused", async () => {
  // The reason is required and has to say something.
  assert.match((await extend()).print.error as string, /^session extend verwacht --reason "<tekst>": zeg wat er nog gemeten moet worden/);
  assert.match((await extend("meer nodig")).print.error as string, /^session extend verwacht --reason/);
  assert.equal(sessionFile().extensions, undefined);

  // Half of what the session started with, in commands and in minutes.
  assert.deepEqual(extensionOf({ commands: 5, minutes: 20 }), { commands: 3, minutes: 10 });
  const first = await extend(REASON);
  assert.equal(first.ok, true, JSON.stringify(first.print));
  assert.equal(first.print.commands, "4 van 8");
  assert.match(first.print.minutes as string, / van 30$/);
  assert.equal(first.print.extended, "1 van 2 keer");
  assert.match(first.print.note as string, /Verlengen kan nog 1 keer\./);
  const kept = sessionFile();
  assert.deepEqual([kept.limits.maxCommands, kept.limits.maxMinutes], [8, 30]);
  assert.equal(kept.extensions!.length, 1);
  assert.deepEqual({ ...kept.extensions![0]!, at: "", usedMinutes: 0 }, { at: "", reasonNl: REASON, commands: 3, minutes: 10, usedCommands: 4, usedMinutes: 0 });
  // The limits of the process itself are what they were: an extension gives a session more turns, not the site more load.
  assert.deepEqual([kept.limits.maxSessions, kept.limits.navigationDelayMs], [3, 20]);
  assert.equal("budget" in (await command("look")).print, false, "five of eight: the warning is gone");

  // The second one adds half of the original again, not half of what the session has now.
  await command("look");
  await command("look");
  const second = await extend("Het zoekvenster is nog niet in het donkere schema gemeten.");
  assert.equal(second.print.commands, "7 van 11");
  assert.match(second.print.note as string, /Dit was de laatste verlenging/);
  assert.deepEqual(sessionFile().extensions!.map((entry) => [entry.commands, entry.minutes, entry.usedCommands]), [[3, 10, 4], [3, 10, 7]]);

  const third = await extend("Er is nog een derde ding dat gemeten moet worden.");
  assert.equal(third.ok, false);
  assert.match(third.print.error as string, /^geweigerd: deze sessie is al 2 keer verlengd en meer kan niet\. Kom tot een oordeel met wat er ligt/);
  assert.equal(sessionFile().extensions!.length, EXTENSION.max);

  // At the wall the answer says that nothing more can be added.
  for (let turn = 0; turn < 4; turn++) await command("look");
  assert.match((await command("look")).print.error as string, /^budget op: deze sessie heeft 11 van 11 commando's gebruikt; rond af met wat er ligt, of verlengen kan niet meer \(al 2 keer gedaan\)$/);
  assert.match((await command("status")).print.budget as string, /^nog 0 van 11 commando's .* Moet er nog iets gemeten worden: verlengen kan niet meer \(al 2 keer gedaan\)$/);

  // A session that is started again keeps what it added: the start names the budget of the task, not what came on top.
  await daemon.handle({ op: "stop", session: SESSION });
  const again = await daemon.handle({ op: "start", session: SESSION, limits: { maxCommands: 5, maxMinutes: 20 } });
  assert.equal(again.print.commands, "11 van 11");
  assert.equal(again.print.extended, "2 van 2 keer");
  assert.equal(extensionsOf(run, SESSION).length, 2);
  assert.deepEqual(extensionsOf(run, "bestaat-niet"), []);
});

test("the extensions of a run are counted per role, and the report names them in one line", async () => {
  // A second judge that did not extend, and a session that belongs to no role.
  for (const name of ["b-111", "main"]) {
    await daemon.handle({ op: "start", session: name });
    await daemon.handle({ op: "stop", session: name });
  }
  const use = extensionUse(run);
  assert.deepEqual(use, [{ role: "judge", roleNl: "beoordelaar", sessions: 2, extended: 1, extensions: 2 }]);
  assert.equal(extensionsNl(use), "beoordelaar: 1 van de 2 sessies (2 keer)");
  assert.equal(extensionsNl([{ role: "judge", roleNl: "beoordelaar", sessions: 2, extended: 0, extensions: 0 }]), null);
  assert.equal(extensionsNl(undefined), null);

  const evaluation = exampleEvaluation();
  assert.equal(deriveReport(evaluation).extensionsNl, null);
  assert.doesNotMatch(renderMarkdown(evaluation), /Verlengd budget/, "a run in which nobody extended says nothing about it");
  evaluation.judgment.extensions = use;
  assert.equal(deriveReport(evaluation).extensionsNl, "beoordelaar: 1 van de 2 sessies (2 keer)");
  assert.match(renderMarkdown(evaluation), /^- Verlengd budget: beoordelaar: 1 van de 2 sessies \(2 keer\)\. Een agent kan het budget van zijn sessie hooguit twee keer zelf verlengen/m);
});
