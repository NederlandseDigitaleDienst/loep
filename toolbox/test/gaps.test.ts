import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gaps, gapsTextNl, type Gaps } from "../src/commands/gaps.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "loep-gaps-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const write = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

const SWEEP = "veegronde mist: het geopende menu is niet op 320 pixels gemeten op de contactpagina.";
const BUDGET = "budget op: de zoekresultaten zijn niet in het donkere schema gemeten.";
const PROBE = "proef werkte niet: de meting met ruimere tekstafstand gaf op de startpagina geen antwoord.";
const PERSON = "mens nodig: of de melding na het versturen wordt voorgelezen, is met een schermlezer na te gaan.";
const CHOICE = "keuze nodig: of de afbeelding in de kop een logo is, bepaalt de eigenaar van de site.";

// A run with verdicts of three rounds and every kind of open point, and no evaluation yet.
const withVerdicts = join(scratch, "site-a");
write(join(withVerdicts, "verdicts", "1.4.3", "oordeel.json"), { criterion: "1.4.3", outcome: "cantTell", missingNl: [SWEEP, BUDGET, PROBE] });
// The verifier takes the point about the sweep over in its own spelling, and adds what asks a person.
write(join(withVerdicts, "verdicts", "1.4.3", "final.json"), { criterion: "1.4.3", outcome: "cantTell", missingNl: ["Veegronde mist:  het geopende menu is niet op 320 pixels gemeten op de contactpagina", PERSON, CHOICE] });
write(join(withVerdicts, "verdicts", "1.4.3", "afmaak.json"), { criterion: "1.4.3", outcome: "cantTell", missingNl: [PERSON] });
write(join(withVerdicts, "verdicts", "2.1.1", "oordeel.json"), { criterion: "2.1.1", outcome: "passed", findings: [] });
write(join(withVerdicts, "verdicts", "2.4.7", "oordeel.json"), { criterion: "2.4.7", outcome: "cantTell", missingNl: [SWEEP] });
// A file an agent left half written is no verdict.
mkdirSync(join(withVerdicts, "verdicts", "3.3.1"), { recursive: true });
writeFileSync(join(withVerdicts, "verdicts", "3.3.1", "oordeel.json"), "{ half");

// A run of which only the evaluation is there, with points from before the kinds existed.
const onlyEvaluation = join(scratch, "site-b");
write(join(onlyEvaluation, "evaluation.json"), {
  criteria: [
    { id: "1.4.3", missingNl: [SWEEP] },
    { id: "2.1.1", missingNl: ["Budget op (80 van 80 commando's). Niet bekeken: het zijmenu op het smalle scherm.", "Het kader van de videodienst is niet bediend."] },
    { id: "2.4.7", missingNl: [] },
  ],
});

test("gaps lists every open point per kind and per criterion, takes equal points together and counts them", () => {
  const result = gaps([withVerdicts]);
  assert.deepEqual(result.runs, ["site-a"]);
  assert.deepEqual(result.kinds.map((kind) => [kind.kind, kind.reader, kind.points, kind.distinct, kind.standing]), [
    // The judge of 2.4.7 was the last to speak about it: its point still stands.
    ["veegronde mist", "toolbox", 3, 2, 1],
    ["budget op", "toolbox", 1, 1, 0],
    ["proef werkte niet", "toolbox", 1, 1, 0],
    ["mens nodig", "owner", 2, 1, 1],
    ["keuze nodig", "owner", 1, 1, 0],
  ]);
  assert.deepEqual([result.points, result.distinct, result.standing, result.criteria], [8, 6, 2, 2]);
  const sweep = result.kinds[0]!;
  assert.deepEqual(sweep.criteria.map((entry) => [entry.criterion, entry.titleNl]), [["1.4.3", "Contrast (minimum)"], ["2.4.7", "Focus zichtbaar"]]);
  // The same point in the words of the judge and of the verifier is one point, written twice.
  assert.deepEqual(sweep.criteria[0]!.points, [{ textNl: "Het geopende menu is niet op 320 pixels gemeten op de contactpagina.", count: 2, where: ["site-a: beoordelaar", "site-a: verifieerder"], standing: false }]);
  // Without an evaluation the last verdict of a criterion says what still stands: for 1.4.3 only what asks a person.
  assert.deepEqual(result.kinds[3]!.criteria[0]!.points, [{ textNl: PERSON.slice(12, 13).toUpperCase() + PERSON.slice(13), count: 2, where: ["site-a: verifieerder", "site-a: afmaakronde"], standing: true }]);
});

test("gaps takes several runs together, also one that only has an evaluation, and reads a point from before the kinds by its first words", () => {
  const result = gaps([withVerdicts, onlyEvaluation]);
  assert.deepEqual(result.runs, ["site-a", "site-b"]);
  assert.deepEqual(result.kinds.map((kind) => [kind.kind, kind.points, kind.distinct, kind.criteria.length, kind.standing]), [
    ["veegronde mist", 4, 2, 2, 2],
    ["budget op", 2, 2, 2, 1],
    ["proef werkte niet", 1, 1, 1, 0],
    ["mens nodig", 2, 1, 1, 1],
    ["keuze nodig", 1, 1, 1, 0],
    ["zonder soort", 1, 1, 1, 1],
  ]);
  // The point about the sweep stands in both runs: three times written, and open in the evaluation of the second.
  assert.deepEqual(result.kinds[0]!.criteria[0]!.points[0], { textNl: "Het geopende menu is niet op 320 pixels gemeten op de contactpagina.", count: 3, where: ["site-a: beoordelaar", "site-a: verifieerder", "site-b: evaluatie"], standing: true });
  assert.equal(result.kinds[1]!.criteria.find((entry) => entry.criterion === "2.1.1")!.points[0]!.textNl, "Budget op (80 van 80 commando's). Niet bekeken: het zijmenu op het smalle scherm.");
  assert.equal(result.kinds.at(-1)!.reader, "unknown");

  const text = gapsTextNl(result);
  assert.match(text, /^Open punten uit 2 runs \(site-a, site-b\): 11 punten geschreven, 8 verschillend, bij 3 criteria\. Nog open in het oordeel dat telt: 5\.$/m);
  assert.match(text, /^Soort +Punten +Verschillend +Criteria +Nog open$/m);
  assert.match(text, /^veegronde mist +4 +2 +2 +2$/m);
  assert.match(text, /^## veegronde mist: dekking ontbrak \(4 punten, 2 verschillend, 2 criteria\)\nElk punt is een agent die zegt welke meting de veegronde had moeten leveren\.$/m);
  assert.match(text, /^1\.4\.3 Contrast \(minimum\)\n- \[3x, nog open; site-a: beoordelaar; site-a: verifieerder; site-b: evaluatie\] Het geopende menu is niet op 320 pixels gemeten op de contactpagina\.$/m);
  assert.match(text, /^## budget op: budget was op \(2 punten, 2 verschillend, 2 criteria\)$/m);
});

test("gaps on the command line: readable text, --json for who reckons on, and it writes nothing in the runs", async () => {
  const before = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true }).map((name) => [name, statSync(join(dir, String(name))).mtimeMs]));
  const untouched = [before(withVerdicts), before(onlyEvaluation)];
  const run = (...args: string[]): Promise<{ stdout: string }> => promisify(execFile)(process.execPath, [CLI, "gaps", ...args]);
  const text = (await run("--run", withVerdicts, onlyEvaluation)).stdout;
  assert.equal(text, gapsTextNl(gaps([withVerdicts, onlyEvaluation])));
  const json = JSON.parse((await run("--run", withVerdicts, onlyEvaluation, "--json")).stdout) as Gaps;
  assert.deepEqual(json, gaps([withVerdicts, onlyEvaluation]));
  assert.deepEqual([before(withVerdicts), before(onlyEvaluation)], untouched);

  // A run without open points says so in one line; a directory that is no run says what is missing.
  const clean = join(scratch, "site-c");
  write(join(clean, "evaluation.json"), { criteria: [{ id: "1.1.1", missingNl: [] }] });
  assert.equal(gapsTextNl(gaps([clean])), "Open punten uit 1 run (site-c): 0 punten geschreven, 0 verschillend, bij 0 criteria. Nog open in het oordeel dat telt: 0.\n");
  mkdirSync(join(scratch, "leeg"));
  assert.throws(() => gaps([join(scratch, "leeg")]), /heeft geen oordelen \(verdicts\/\) en geen evaluatie \(evaluation\.json\)/);
  await assert.rejects(run(), /gaps needs --run <run> \[<run> \.\.\.\]/);
});

test("gaps counts what stayed open only because the run may not send apart, between the limits of the evaluation and the work for a person", () => {
  const NOT_SENT = "versturen niet toegestaan: wat de chat in het ingesloten venster antwoordt na een verstuurd bericht.";
  const chat = join(scratch, "site-chat");
  write(join(chat, "evaluation.json"), {
    criteria: [
      { id: "3.3.1", missingNl: [NOT_SENT] },
      { id: "4.1.3", missingNl: [NOT_SENT, "mens nodig: wat NVDA voorleest bij een nieuw bericht in de chat."] },
      { id: "2.2.1", missingNl: [NOT_SENT, SWEEP] },
    ],
  });
  const result = gaps([chat]);
  assert.deepEqual(result.kinds.map((kind) => [kind.kind, kind.reader, kind.points, kind.distinct, kind.criteria.length, kind.standing]), [
    ["veegronde mist", "toolbox", 1, 1, 1, 1],
    ["versturen niet toegestaan", "owner", 3, 3, 3, 3],
    ["mens nodig", "owner", 1, 1, 1, 1],
  ]);
  const text = gapsTextNl(result);
  assert.match(text, /^versturen niet toegestaan +3 +3 +3 +3$/m);
  assert.match(text, /^## versturen niet toegestaan: pas te meten als het onderzoek mag versturen \(3 punten, 3 verschillend, 3 criteria\)\nElk punt is iets wat pas na versturen te zien is, in een run die niet mocht versturen\. Geen persoon nodig: .*--test-environment.*ingesloten venster zijn\.$/m);
});
