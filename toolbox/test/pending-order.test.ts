import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, briefPending, longestFirst, recordAttempts, skip } from "../src/commands/instrument-tasks.ts";
import type { RunData } from "../src/lib/rundata.ts";
import type { Verdict } from "../src/lib/verdict.ts";

test("longestFirst puts the heaviest first and keeps the given order for equal weights", () => {
  assert.deepEqual(longestFirst(["a", "bbb", "cc", "ddd", "e"], (item) => item.length), ["bbb", "ddd", "cc", "a", "e"]);
  assert.deepEqual(longestFirst(["x", "y", "z"], () => 0), ["x", "y", "z"]);
  assert.deepEqual(longestFirst([], () => 1), []);
});

test("pending lists the judges by the size of their candidates file, a missing file weighing nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-order-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const home = "https://www.example.nl/";
  const run = {
    dir,
    inventory: { baseUrl: home },
    writes: null,
    pages: [{ label: "P1", item: { url: home } }],
    siteModel: { version: 1, baseUrl: home, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: home, pages: [home] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
  } as unknown as RunData;
  const options = { run, only: ["1.4.11", "2.4.3", "1.4.5", "3.3.1"], buildDossier: () => ({ legend: { P1: {} }, evidence: { contrast: {} } }) };
  await instrumentTasks(dir, options);
  await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(dir, options);
  const index = await loadInstrumentIndex(dir);
  const sizes: Record<string, number> = { "1.4.11": 50, "2.4.3": 900, "1.4.5": 50, "3.3.1": 0 };
  for (const task of index.tasks) {
    if (sizes[task.criterion] === 0) rmSync(join(dir, task.judge.candidates), { force: true });
    else writeFileSync(join(dir, task.judge.candidates), "x".repeat(sizes[task.criterion]!));
  }
  assert.ok(!existsSync(join(dir, index.tasks.find((task) => task.criterion === "3.3.1")!.judge.candidates)), "the candidates file of 3.3.1 is not there");
  const pending = await instrumentPending(dir);
  assert.equal(pending.phase, "judges");
  const order = pending.judges.map((entry) => entry.criterion);
  assert.equal(order[0], "2.4.3");
  assert.equal(order.at(-1), "3.3.1");
  // 1.4.11 and 1.4.5 weigh the same: they keep the order of the index.
  const inIndex = index.tasks.map((task) => task.criterion);
  assert.deepEqual(order, longestFirst(inIndex, (id) => sizes[id]!));
  assert.equal(order.indexOf("1.4.11") < order.indexOf("1.4.5"), inIndex.indexOf("1.4.11") < inIndex.indexOf("1.4.5"));
});

test("pending lists the verifiers and the finishers by the size of their candidates file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-order-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const home = "https://www.example.nl/";
  const point = "niet bereikbaar: het chatvenster op P1 (https://chat.example.nl/widget) laadde niet, ook los geopend, tussen 14:05 en 14:40; de andere pagina's laadden wel.";
  const run = {
    dir,
    inventory: { baseUrl: home },
    writes: null,
    pages: [{ label: "P1", item: { url: home } }],
    siteModel: { version: 1, baseUrl: home, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: home, pages: [home] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
  } as unknown as RunData;
  const ids = ["1.4.5", "1.4.11", "2.4.3"];
  const options = { run, only: ids, buildDossier: () => ({ legend: { P1: {} }, evidence: { contrast: {} } }) };
  const write = (path: string, value: unknown): void => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(value));
  };
  let made = 0;
  const observe = (session: string): string => {
    const id = `${session}-${String(++made).padStart(4, "0")}`;
    write(join("observations", session, `${String(made).padStart(4, "0")}.json`), { id, command: "look", error: null, state: { id: "s1", start: { url: home }, steps: [] }, target: null, page: { url: home }, result: {} });
    return id;
  };
  const open = (id: string, session: string): Verdict => ({
    criterion: id,
    outcome: "cantTell",
    rule: "R9",
    summaryNl: "Wat de beoordeling vaststelde op de bekeken pagina's.",
    observations: [{ checkedNl: "De pagina's van de steekproef", howNl: "Bekeken en gemeten in de sessie", observedNl: "Wat er op de pagina staat, zoals gemeten", evidence: [observe(session)], ruling: "open" }],
    findings: [],
    missingNl: [point],
    // A part that did not load stays open only after a real attempt, in every round (#318).
    attempts: [{ missing: 1, triedNl: "Het deel twee keer opnieuw geopend, met tijd ertussen, en het venster bekeken.", evidence: [observe(session), observe(session)] }],
  });
  // Descending size is not the order of the index.
  const sizes: Record<string, number> = { "1.4.5": 10, "1.4.11": 900, "2.4.3": 500 };
  const expected = ["1.4.11", "2.4.3", "1.4.5"];
  const resize = async (part: "verify" | "finish"): Promise<void> => {
    for (const task of (await loadInstrumentIndex(dir)).tasks) writeFileSync(join(dir, task[part]!.candidates), `[${" ".repeat(sizes[task.criterion]!)}]`);
  };

  await instrumentTasks(dir, options);
  await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(dir, options);
  for (const id of ids) {
    write(join("verdicts", id, "oordeel.json"), open(id, `b-${id.replaceAll(".", "")}`));
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "judge"), [], `judge ${id}`);
  }
  assert.equal((await instrumentTasks(dir, options)).verifiers, 3);
  const inIndex = (await loadInstrumentIndex(dir)).tasks.map((task) => task.criterion);
  assert.notDeepEqual(inIndex, expected, "the sizes must reorder the index for this test to prove anything");
  await resize("verify");
  const verifiers = await instrumentPending(dir);
  assert.equal(verifiers.phase, "verifiers");
  assert.deepEqual(verifiers.verifiers.map((entry) => entry.criterion), expected);

  // The tasks write their candidates files anew, which the verdicts below are stamped with.
  await instrumentTasks(dir, options);
  for (const id of ids) {
    const session = `v-${id.replaceAll(".", "")}`;
    const evidence = [observe(session)];
    write(join("verdicts", id, "final.json"), { ...open(id, session), observations: [{ ...open(id, session).observations[0]!, evidence }], verification: { judgeOutcome: "cantTell", findings: [], attackNl: "Geprobeerd het oordeel onderuit te halen met een tweede blik op de pagina.", attackEvidence: evidence } } satisfies Verdict);
    assert.deepEqual(await checkInstrumentVerdict(dir, id, "final"), [], `final ${id}`);
  }
  assert.equal((await instrumentTasks(dir, options)).finishers, 3);
  await resize("finish");
  const finishers = await instrumentPending(dir);
  assert.equal(finishers.phase, "finishers");
  assert.deepEqual(finishers.finishers.map((entry) => entry.criterion), expected);
});

test("after a pause of the workflow a task whose session has no time left gets a fresh one, without an attempt, and pending says so (#359)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-pause-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const home = "https://www.example.nl/";
  const run = {
    dir,
    inventory: { baseUrl: home },
    writes: null,
    pages: [{ label: "P1", item: { url: home } }],
    siteModel: { version: 1, baseUrl: home, pageTypes: [{ id: "start", descriptionNl: "De startpagina.", representative: home, pages: [home] }], blockers: [], components: [], processes: [], frames: [], notesNl: [] },
  } as unknown as RunData;
  const options = { run, only: ["1.4.11", "2.4.3", "1.4.5"], buildDossier: () => ({ legend: { P1: {} }, evidence: { contrast: {} } }) };
  /** A session as the session process leaves it: its file, with the limit its extensions raised, and the one observation it made. */
  const started = (session: string, minutesAgo: number, maxMinutes: number, extensions: unknown[] = []): void => {
    mkdirSync(join(dir, "observations", session), { recursive: true });
    writeFileSync(join(dir, "observations", session, "session.json"), JSON.stringify({ session, startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), commands: 9, limits: { maxCommands: 120, maxMinutes }, ...(extensions.length > 0 ? { extensions } : {}) }));
    writeFileSync(join(dir, "observations", session, "0001.json"), JSON.stringify({ id: `${session}-0001`, command: "look", error: null, state: { id: "s1", start: { url: home }, steps: [] }, target: null, page: { url: home }, result: {} }));
  };
  await instrumentTasks(dir, options);
  await skip(dir, { pageType: "start" }, "Voor deze test is geen rondgang nodig.");
  await instrumentTasks(dir, options);

  // Three judges began; the weekly limit stopped all three, and the workflow paused for four days.
  // 1.4.11 ran out of time over the pause, extensions included; 2.4.3 still has time; 1.4.5 ran out during a real attempt.
  started("b-1411", 4 * 24 * 60, 130, [{ commands: 30, minutes: 25 }, { commands: 30, minutes: 25 }]);
  started("b-243", 10, 80);
  started("b-145", 200, 80);
  // The workflow counted the agent of 1.4.5, which came back, as an attempt; the others stopped with an error of the model.
  await recordAttempts(dir, ["judges:1.4.5"]);
  // The new start of the workflow runs tasks first.
  await instrumentTasks(dir, options);

  const pending = await instrumentPending(dir);
  const judge = (id: string): (typeof pending.judges)[number] => pending.judges.find((entry) => entry.criterion === id)!;
  // A session that gave no result is never handed out again: each task gets a fresh one with a clock of its own.
  assert.deepEqual([judge("1.4.11").session, judge("1.4.11").attempts], ["b-1411-2", 0]);
  assert.deepEqual([judge("2.4.3").session, judge("2.4.3").attempts], ["b-243-2", 0]);
  assert.deepEqual([judge("1.4.5").session, judge("1.4.5").attempts], ["b-145-2", 1], "a real attempt still counts");
  assert.match(readFileSync(join(dir, (await loadInstrumentIndex(dir)).tasks.find((task) => task.criterion === "1.4.11")!.judge.prompt), "utf8"), /--session b-1411-2 /);
  // The old session stays where it was, readable.
  assert.ok(existsSync(join(dir, "observations", "b-1411", "0001.json")));
  // pending says it for the session that has no time left, with its own maximum and the extensions in it.
  assert.match(judge("1.4.11").sessionNl ?? "", /^de sessie b-1411 gaf geen resultaat dat telt en heeft geen tijd meer: 5760 van 130 minuten .* verse sessie, b-1411-2, .* observations\/b-1411\. .* telt niet als poging$/);
  assert.equal(judge("2.4.3").sessionNl, undefined, "a session with time left is not worth a word");
  assert.match(judge("1.4.5").sessionNl ?? "", /^de sessie b-145 /);
  // The workflow reads only id and attempts.
  assert.ok(!JSON.stringify(briefPending(pending)).includes("sessionNl"));
});
