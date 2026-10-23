import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { briefPending, checkInstrumentVerdict, instrumentPending, instrumentTasks, loadInstrumentIndex, longestFirst, skip } from "../src/commands/instrument-tasks.ts";
import { BLOCKADES_FILE } from "../src/session/blockade.ts";
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
  assert.equal(pending.siteOutage, undefined);
  assert.equal(briefPending(pending).siteOutage, undefined);

  // The session process noted an outage of the site: pending says so, also to the workflow, and no agent should start.
  const at = new Date(Date.now() - 60_000).toISOString();
  writeFileSync(join(dir, BLOCKADES_FILE), JSON.stringify({ origins: [{ origin: "https://www.example.nl", reason: "outage", at, until: new Date(Date.now() + 240_000).toISOString(), url: home }] }));
  const down = await instrumentPending(dir);
  assert.match(down.siteOutage!, /^storing van de site: https:\/\/www\.example\.nl antwoordt sinds \d{4}-\d\d-\d\d \d\d:\d\d niet \(geen antwoord of geen verbinding\)\. loep vraagt de site niets tot \d\d:\d\d:\d\d en kijkt dan met één verzoek of ze terug is\. Start geen agents en draai pending na die tijd opnieuw$/);
  assert.ok(down.noteNl.startsWith(`${down.siteOutage}. `));
  assert.equal(briefPending(down).siteOutage, down.siteOutage);
  assert.equal(down.phase, "judges", "the work that is open stays open");
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
