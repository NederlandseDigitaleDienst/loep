import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sha256 } from "../src/lib/canonical.ts";
import { chunksOf, compactLines, dossierReads, readProgress, readsOfSession, requiredParts, resolvePart, unreadPartsProblems } from "../src/lib/dossier-view.ts";
import { dossierAnswer, recordDossierRead } from "../src/session/dossier-command.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-dossier-view-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const rows = Array.from({ length: 600 }, (_, position) => ({ accessibleName: `Knop ${position}`, pages: position % 2 ? "P01,P02" : "alle 2", flags: position % 7 ? [] : ["geen naam"], box: { x: position, y: 2 * position }, note: null }));
const dossier = {
  criterion: { id: "1.1.1", titleNl: "Niet-tekstuele content", level: "A" },
  site: { baseUrl: "https://example.nl/", pagesInSample: 2 },
  legend: { P01: { files: "pages/home", states: [{ state: "default", open: "P01" }] }, ...Object.fromEntries(Array.from({ length: 40 }, (_, position) => [`P${String(position + 2).padStart(2, "0")}`, { files: `pages/pagina-${position}`, states: [] }])) },
  siteStates: { method: "Een verkenner heeft vooraf vastgelegd wat over de pagina ligt.", components: [{ id: "menu", descriptionNl: "Hoofdmenu", appliesToPages: "alle 2" }] },
  evidence: {
    controls: { pagesExamined: 2, note: "Elke knop op elke pagina.", rows },
    "keyboard.walk": { examined: true },
    engine: { results: [{ rule: "image-alt", "1.1.1": "failed" }] },
  },
};

test("the compact form keeps every value: a table names its columns once and each row is a JSON list", () => {
  const lines = compactLines(rows).map((line) => line.text);
  assert.match(lines[0]!, /^600 rijen, kolommen \["accessibleName","pages","flags","box","note"\]$/);
  const back = lines.slice(1).map((line) => JSON.parse(line) as unknown[]);
  assert.deepEqual(back.map(([name, pages, flags, box, note]) => ({ accessibleName: name, pages, flags, box, note })), rows, "nothing is lost");
  const text = compactLines(dossier.evidence.controls).map((line) => line.text).join("\n");
  assert.match(text, /^note: Elke knop op elke pagina\.$/m, "an explanation stays, as plain text");
  assert.match(text, /^rows: 600 rijen/m);
  assert.ok(text.length < JSON.stringify(dossier.evidence.controls, null, 2).length * 0.7, "much smaller than the JSON as it is written");
  // A string that could be read as something else keeps its quotes.
  assert.deepEqual(compactLines({ a: "12", b: "true", c: "", d: "gewoon" }).map((line) => line.text), ['a: "12"', 'b: "true"', 'c: ""', "d: gewoon"]);
});

test("a long part comes in chunks that say where they go on, and no line is lost", () => {
  const chunks = chunksOf(dossier.evidence.controls, 2000);
  assert.ok(chunks.length > 5);
  for (const chunk of chunks) assert.ok(chunk.length <= 2000 + 1000, "a chunk stays within its size, apart from the line that says where it goes on");
  assert.match(chunks[1]!, /^\(vervolg van: rows: 600 rijen, kolommen /, "a later chunk repeats the columns of its table");
  const whole = compactLines(dossier.evidence.controls).map((line) => line.text);
  const joined = chunks.flatMap((chunk, position) => chunk.split("\n").slice(position > 0 ? 1 : 0));
  assert.deepEqual(joined, whole);
  const long = chunksOf({ text: "x".repeat(5000) }, 2000);
  assert.equal(long.length, 3);
  assert.match(long[1]!, /^\(vervolg van de laatste regel van het vorige deel\)\n/);
});

test("a part is named as the procedure writes it, and a page or a row by a dot", () => {
  assert.deepEqual(resolvePart(dossier, "controls"), ["evidence", "controls"]);
  assert.deepEqual(resolvePart(dossier, "keyboard.walk"), ["evidence", "keyboard.walk"], "a key with a dot in it");
  assert.deepEqual(resolvePart(dossier, "evidence.controls.rows.4"), ["evidence", "controls", "rows", "4"]);
  assert.deepEqual(resolvePart(dossier, "legend.P02"), ["legend", "P02"]);
  assert.deepEqual(resolvePart(dossier, "engine.results.0.1.1.1"), ["evidence", "engine", "results", "0", "1.1.1"]);
  assert.equal(resolvePart(dossier, "controls.rows.600"), null);
  assert.equal(resolvePart(dossier, "nergens"), null);
  assert.deepEqual(requiredParts(dossier), [["evidence", "controls"], ["evidence", "keyboard.walk"], ["evidence", "engine"], ["siteStates"]]);
});

test("a part counts as read when every chunk of it, or every part inside it, was shown", () => {
  const path = ["evidence", "controls"];
  const of = chunksOf(dossier.evidence.controls).length;
  assert.ok(of > 1);
  assert.deepEqual(readProgress(dossier, path, []), { read: 0, of, complete: false });
  const all = Array.from({ length: of }, (_, position) => ({ path, chunk: position + 1, chunks: of }));
  assert.deepEqual(readProgress(dossier, path, all.slice(0, -1)), { read: of - 1, of, complete: false });
  assert.equal(readProgress(dossier, path, all).complete, true);
  const inside = ["pagesExamined", "note", "rows"].flatMap((key) => {
    const at = [...path, key];
    const count = chunksOf(dossier.evidence.controls[key as "rows"]).length;
    return Array.from({ length: count }, (_, position) => ({ path: at, chunk: position + 1, chunks: count }));
  });
  assert.equal(readProgress(dossier, path, inside).complete, true, "read part by part");
  assert.equal(readProgress(dossier, path, inside.filter((read) => read.path.at(-1) !== "note")).complete, false);
});

test("dossier reads the dossier of the session's own task, keeps what it showed, and check-verdict counts only this version", async () => {
  mkdirSync(join(dir, "tasks", "1.1.1"), { recursive: true });
  const text = JSON.stringify(dossier);
  writeFileSync(join(dir, "tasks", "1.1.1", "dossier.json"), text);
  writeFileSync(join(dir, "tasks", "index.json"), JSON.stringify({ tasks: [{ criterion: "1.1.1", dossier: "tasks/1.1.1/dossier.json", judge: { session: "b-111" }, verify: { session: "v-111" } }] }));
  const overview = await dossierAnswer(dir, "b-111", [], undefined);
  assert.equal(overview.print.criterion, "1.1.1");
  assert.match(overview.text, /Telt voor dit criterium[^\n]*\n {2}controls: [\d.]+ tekens in \d+ del(en|)?, gelezen 0 van \d+\. Bevat: pagesExamined, note, rows \(600\)/);
  assert.match(overview.text, /Zoek op waar je het nodig hebt[^\n]*\n {2}legend: /);
  assert.match(overview.text, /Klein, hier voluit:\n[^]*\ncriterion:\n {2}id: 1\.1\.1/, "small parts are shown in full");
  // keyboard.walk, engine and siteStates are small: the overview shows them, and that counts as read.
  assert.deepEqual(overview.result.read.map((read) => read.path.join("/")).sort(), ["criterion", "evidence/engine", "evidence/keyboard.walk", "site", "siteStates"].sort());
  recordDossierRead(dir, "b-111", overview.result);
  const unread = unreadPartsProblems(dossier, dossierReads(readsOfSession(dir, "b-111"), "tasks/1.1.1/dossier.json", sha256(text)), "b-111");
  assert.equal(unread.length, 1);
  assert.match(unread[0]!, /not read in full: controls \(0 of 2 chunks read\)\. Read them with: loep dossier controls/);

  const part = await dossierAnswer(dir, "b-111", ["controls"], undefined);
  assert.equal(part.print.part, "deel 1 van 2");
  assert.equal(part.print.next, "loep dossier controls 2");
  recordDossierRead(dir, "b-111", part.result);
  assert.match(unreadPartsProblems(dossier, dossierReads(readsOfSession(dir, "b-111"), "tasks/1.1.1/dossier.json", sha256(text)), "b-111").join(), /controls \(1 of 2 chunks read\)/);
  recordDossierRead(dir, "b-111", (await dossierAnswer(dir, "b-111", ["controls", "2"], undefined)).result);
  assert.deepEqual(unreadPartsProblems(dossier, dossierReads(readsOfSession(dir, "b-111"), "tasks/1.1.1/dossier.json", sha256(text)), "b-111"), []);
  assert.equal(dossierReads(readsOfSession(dir, "b-111"), "tasks/1.1.1/dossier.json", sha256(`${text} `)).length, 0, "a read of another version does not count");
  assert.equal(readsOfSession(dir, "v-111").length, 0, "what one session read is not another's");

  await assert.rejects(dossierAnswer(dir, "b-111", ["controls", "3"], undefined), /controls heeft 2 delen; geef een deel van 1 tot en met 2/);
  await assert.rejects(dossierAnswer(dir, "b-111", ["nergens"], undefined), /geen onderdeel "nergens"; kies uit: controls, keyboard\.walk, engine, criterion/);
  await assert.rejects(dossierAnswer(dir, "r-start", [], undefined), /hoort bij geen opdracht met een dossier; geef het criterium op met --criterion/);
  assert.equal((await dossierAnswer(dir, "r-start", [], "1.1.1")).print.criterion, "1.1.1", "another session names the criterion");
});

test("loep dossier prints a line of JSON with the text under it, without a running session", async () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  const output = execFileSync(process.execPath, [cli, "session", "dossier", "legend.P01", "--run", dir, "--session", "v-111"], { encoding: "utf8" });
  const [first, ...rest] = output.split("\n");
  assert.deepEqual(JSON.parse(first!), { dossier: "legend.P01", part: "deel 1 van 1", note: "een rij in een tabel is een JSON-lijst met de waarden in de volgorde van de kolommen" });
  assert.match(rest.join("\n"), /^files: pages\/home\nstates: 1 rij, kolommen \["state","open"\]\n {2}\["default","P01"\]/);
  const log = readFileSync(join(dir, "observations", "v-111", "dossier-reads.jsonl"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0]!).read, [{ path: ["legend", "P01"], chunk: 1, chunks: 1 }]);
});
