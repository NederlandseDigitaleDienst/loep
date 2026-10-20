import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { feedback, feedbackTextNl, redactor, TITLE_PREFIX, type Feedback } from "../src/commands/feedback.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "loep-feedback-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const SITE = { name: "Gemeente Voorbeeldstad", baseUrl: "https://www.voorbeeldstad.nl/", organisation: "Voorbeeldstad" };
const criterion = (id: string, outcome: string, missingNl: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  titleNl: `Titel van ${id}`,
  level: "A",
  versions: ["2.1", "2.2"],
  outcome,
  missingNl,
  rounds: { a: outcome, b: null, final: outcome },
  procedure: { version: 9, sha256: "x", class: "y", limitsNl: null },
  ...extra,
});

function run(name: string, criteria: Record<string, unknown>[]): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "evaluation.json"), JSON.stringify({ site: SITE, toolchain: { toolbox: { version: "0.1.1", commit: "0123456789abcdef", dirty: false } }, criteria }));
  return dir;
}

const study = run("site-a", [
  criterion("1.1.1", "passed", []),
  // A pass with a budget point is no open criterion: nothing to report.
  criterion("1.4.3", "passed", ["budget op: het donkere schema van de zoekpagina is niet bekeken."]),
  // Open for the owner only: that is the outcome of the evaluation, not a fault of loep.
  criterion("1.3.1", "cantTell", ["mens nodig: of de tabel op de contactpagina wordt voorgelezen, is met een schermlezer na te gaan."]),
  // Open by loep, two kinds, and a point that names the site in three ways.
  criterion("2.4.4", "cantTell", [
    "veegronde mist: de link naar https://www.voorbeeldstad.nl/afval?x=1 op de startpagina van Gemeente Voorbeeldstad is niet gemeten.",
    "proef werkte niet: de pdf van voorbeeldstad.nl gaf geen tags.",
    "mens nodig: of het linkdoel duidelijk is voor de inwoners van Voorbeeldstad.",
  ], { rounds: { a: "cantTell", b: null, final: "cantTell", finish: "cantTell" } }),
  criterion("2.1.1", "untested", []),
]);

test("feedback drafts one issue per criterion and kind that stayed open by loep, and nothing for the owner's points", () => {
  const result = feedback(study);
  assert.deepEqual(result.drafts.map((draft) => draft.title), [`${TITLE_PREFIX} 2.4.4 veegronde mist`, `${TITLE_PREFIX} 2.4.4 proef werkte niet`, `${TITLE_PREFIX} 2.1.1 niet beoordeeld`]);
  const [sweep, probe, untested] = result.drafts;
  assert.match(sweep!.bodyMd, /- Criterium: 2\.4\.4 Titel van 2\.4\.4, niveau A, WCAG 2\.1 en 2\.2/);
  assert.match(sweep!.bodyMd, /- Afmaakronde: gehad/);
  assert.match(sweep!.bodyMd, /- Procedure: versie 9/);
  assert.match(sweep!.bodyMd, /- loep 0\.1\.1, commit 0123456789ab/);
  assert.ok(!sweep!.bodyMd.includes("inwoners"), "a point for the owner stays out");
  assert.match(untested!.bodyMd, /- Afmaakronde: niet gehad/);
  assert.ok(!untested!.bodyMd.includes("## Wat open bleef"), "no points, no heading");
  // Nothing in any draft says which site it is.
  for (const draft of result.drafts) assert.ok(!/voorbeeldstad/i.test(draft.bodyMd), draft.bodyMd);
  assert.match(sweep!.bodyMd, /De link naar <adres> op de startpagina van <site> is niet gemeten/);
  assert.match(probe!.bodyMd, /De pdf van <site> gaf geen tags/);
});

test("a point \"proef werkte niet\" that stands in a criterion with an outcome gets the same draft, and no other kind does", () => {
  const result = feedback(
    run("site-outcome", [
      criterion("1.3.2", "failed", ["proef werkte niet: de leesvolgorde op de startpagina van Gemeente Voorbeeldstad kon niet worden vergeleken."]),
      criterion("4.1.2", "passed", ["proef werkte niet: de naam van het menu op https://www.voorbeeldstad.nl/ is niet uitgelezen.", "budget op: de tweede pagina is niet bekeken."]),
      criterion("1.4.3", "passed", ["budget op: het donkere schema is niet bekeken."]),
      criterion("2.4.6", "failed", ["versturen niet toegestaan: wat het formulier antwoordt.", "niet bereikbaar: pagina P03 laadde niet tussen 14:05 en 14:40."]),
    ]),
  );
  assert.deepEqual(result.drafts.map((draft) => draft.title), [`${TITLE_PREFIX} 1.3.2 proef werkte niet`, `${TITLE_PREFIX} 4.1.2 proef werkte niet`]);
  const [failed, passed] = result.drafts;
  assert.match(failed!.bodyMd, /gaf dit criterium een uitkomst, maar een proef werkte niet/);
  assert.match(failed!.bodyMd, /- Uitkomst: Voldoet niet/);
  assert.match(passed!.bodyMd, /- Uitkomst: Voldoet\n/);
  assert.ok(!passed!.bodyMd.includes("tweede pagina"), "only the point of this kind goes in");
  for (const draft of result.drafts) assert.ok(!/voorbeeldstad/i.test(draft.bodyMd), draft.bodyMd);
  assert.match(failed!.bodyMd, /De leesvolgorde op de startpagina van <site>/);
  assert.match(passed!.bodyMd, /op <adres> is niet uitgelezen/);
  assert.deepEqual(result.notSent, []);
  assert.deepEqual(result.unreachable, []);
});

test("the redactor takes out addresses, the host with and without www, the organisation and the name", () => {
  const redact = redactor(SITE);
  assert.equal(redact("Zie http://voorbeeldstad.nl/a en WWW.VOORBEELDSTAD.NL."), "Zie <adres> en <site>.");
  assert.equal(redact("Het college van voorbeeldstad"), "Het college van <organisatie>");
  // A name too short to be a name is left alone, and a broken address does not stop it.
  assert.equal(redactor({ name: "A", baseUrl: "geen adres", organisation: null })("Een A en een B"), "Een A en een B");
});

test("feedback on the command line: --out writes one body per draft, --json gives the drafts, and a run without own open criteria says so", async () => {
  const cli = (...args: string[]): Promise<{ stdout: string }> => promisify(execFile)(process.execPath, [CLI, "feedback", ...args]);
  const out = join(scratch, "uit");
  const text = (await cli("--run", study, "--out", out)).stdout;
  assert.deepEqual(readdirSync(out).sort(), ["2.1.1-niet-beoordeeld.md", "2.4.4-proef-werkte-niet.md", "2.4.4-veegronde-mist.md"]);
  assert.equal(readFileSync(join(out, "2.4.4-veegronde-mist.md"), "utf8"), feedback(study).drafts[0]!.bodyMd);
  assert.match(text, /3 meldingen bij 2 criteria/);
  assert.match(text, /Een issue is openbaar/);
  const json = JSON.parse((await cli("--run", study, "--json")).stdout) as Feedback;
  assert.deepEqual(json, feedback(study));
  assert.ok(readdirSync(study).length === 1, "it writes nothing in the run");

  const clean = run("site-b", [criterion("1.1.1", "passed", []), criterion("1.3.1", "cantTell", ["keuze nodig: of het beeld een logo is, bepaalt de eigenaar."])]);
  assert.equal(feedbackTextNl(feedback(clean)), "Niets terug te melden uit site-b: geen criterium is open door loep zelf.\n");
  mkdirSync(join(scratch, "leeg"));
  assert.throws(() => feedback(join(scratch, "leeg")), /heeft geen evaluation\.json/);
  await assert.rejects(cli(), /feedback needs --run <run>/);
});

test("a criterion open because the run may not send is the owner's choice: no draft, but named apart", () => {
  const NOT_SENT = "versturen niet toegestaan: wat de chat in het venster van https://chat.voorbeeldstad.nl antwoordt na een bericht.";
  const chat = run("site-chat", [
    criterion("3.3.1", "cantTell", [NOT_SENT]),
    criterion("4.1.3", "cantTell", [NOT_SENT, "mens nodig: wat NVDA voorleest bij een nieuw bericht."]),
    // Open by loep as well: only the sweep point becomes a draft.
    criterion("2.2.1", "cantTell", [NOT_SENT, "veegronde mist: de timers van de chat zijn niet gemeten."]),
    criterion("1.1.1", "passed", []),
  ]);
  const result = feedback(chat);
  assert.deepEqual(result.drafts.map((draft) => draft.title), [`${TITLE_PREFIX} 2.2.1 veegronde mist`]);
  assert.ok(!result.drafts[0]!.bodyMd.includes("chat in het venster"), "the point about sending stays out of the draft");
  assert.deepEqual(result.notSent, ["2.2.1", "3.3.1", "4.1.3"]);
  const text = feedbackTextNl(result);
  assert.match(text, /^Niet terug te melden: criteria 2\.2\.1, 3\.3\.1, 4\.1\.3 bleven ook open omdat het onderzoek niet mocht versturen\. Dat is een keuze van de eigenaar van de site, geen fout in loep\./m);
  // With nothing else to report, the line still says why those criteria are open.
  const only = feedback(run("site-chat-only", [criterion("3.3.1", "cantTell", [NOT_SENT])]));
  assert.deepEqual(only.drafts, []);
  assert.match(feedbackTextNl(only), /^Niets terug te melden uit site-chat-only: geen criterium is open door loep zelf\.\n\nNiet terug te melden: criterium 3\.3\.1 bleef ook open omdat/);
});

test("a criterion open because a part of the site did not load is no fault of loep: no draft, but named apart with the way to measure it again", () => {
  const UNREACHABLE = "niet bereikbaar: het chatvenster op P03 (https://chat.example.nl/widget) laadde niet, ook los geopend, tussen 14:05 en 14:40.";
  const result = feedback(
    run("site-unreachable", [
      criterion("3.3.1", "cantTell", [UNREACHABLE]),
      criterion("4.1.3", "cantTell", [UNREACHABLE, "mens nodig: wat NVDA voorleest bij een nieuw bericht."]),
      // Open by loep as well: only the probe point becomes a draft.
      criterion("2.4.3", "cantTell", [UNREACHABLE, "proef werkte niet: de Tab-proef op P02 gaf geen antwoord."]),
      criterion("1.1.1", "passed", []),
    ]),
  );
  assert.deepEqual(result.drafts.map((draft) => draft.title), [`${TITLE_PREFIX} 2.4.3 proef werkte niet`]);
  assert.ok(!result.drafts[0]!.bodyMd.includes("chatvenster"), "the point about the part that did not load stays out of the draft");
  assert.deepEqual(result.unreachable, ["2.4.3", "3.3.1", "4.1.3"]);
  assert.deepEqual(result.notSent, []);
  assert.match(feedbackTextNl(result), /^Niet terug te melden: criteria 2\.4\.3, 3\.3\.1, 4\.1\.3 bleven ook open omdat een deel van de site tijdens het onderzoek niet bereikbaar was\. Dat is geen fout in loep\. .*--again 2\.4\.3,3\.3\.1,4\.1\.3/m);
  // Only that point: nothing to report, and still said why the criterion is open.
  const only = feedback(run("site-unreachable-only", [criterion("3.3.1", "cantTell", [UNREACHABLE])]));
  assert.deepEqual(only.drafts, []);
  assert.match(feedbackTextNl(only), /^Niets terug te melden uit site-unreachable-only: geen criterium is open door loep zelf\.\n\nNiet terug te melden: criterium 3\.3\.1 bleef ook open omdat een deel van de site/);
});

test("a criterion without a verdict because the model was not there is no fault of loep: no draft, but named apart with the way to do it again", () => {
  const result = feedback(run("site-outage", [criterion("2.1.1", "untested", [], { outage: true }), criterion("2.1.2", "untested", [])]));
  assert.deepEqual(result.drafts.map((draft) => draft.title), [`${TITLE_PREFIX} 2.1.2 niet beoordeeld`], "only the criterion whose agent gave no valid result");
  assert.deepEqual(result.outage, ["2.1.1"]);
  assert.match(feedbackTextNl(result), /Niet terug te melden: criterium 2\.1\.1 is niet beoordeeld door een storing van het model .*LOEP unskip --run <run> --criterion <id>/);
  assert.ok(!feedbackTextNl(result).includes("budget op"));
});
