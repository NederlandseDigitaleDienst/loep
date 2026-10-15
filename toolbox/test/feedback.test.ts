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
