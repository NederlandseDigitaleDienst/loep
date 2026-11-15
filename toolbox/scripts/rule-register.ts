#!/usr/bin/env node
/**
 * Build the rule register: what is known about each rule of each rule engine.
 *
 *   node scripts/rule-register.ts [--calibration <dir>] [--sheets <dir>] [--runs <file>] [--out <dir>]
 *
 * --calibration  a folder of `just calibrate` with uitkomst.json and regels.json; default the newest in validatie/ijkset
 * --sheets       a folder with sheets of runs (`contribute --out`), such as a clone of the collection
 * --runs         a file with the folders of finished evaluations, one per line: each is read as its sheet
 *                would be. Without --sheets and --runs the register holds the calibration only. Nothing
 *                that tells a site is written: sites are counted, not named.
 * --out          default validatie/regelregister/<date>
 *
 * A measurement, not a step of an evaluation: nothing reads the register yet.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { sheetSource } from "../src/commands/contribute.ts";
import { buildSheet, fieldRunOfSheet, type RunSheet } from "../src/lib/run-sheet.ts";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CalibrationReport } from "../src/lib/calibration.ts";
import { buildRegister, registerMarkdown, type FieldRun, type RuleCatalogue } from "../src/lib/rule-register.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * A finished evaluation in a folder, read the way a contributed sheet is: the register sees of a run
 * what a sheet holds and nothing more, so a register from folders and one from sheets are the same.
 */
function fieldRun(dir: string): FieldRun | null {
  const source = sheetSource(dir);
  // The key only has to tell the sites of this one build apart; nothing made with it is written.
  return source && source.evaluation.criteria.length > 0 ? fieldRunOfSheet(buildSheet(source, "rule-register")) : null;
}

const { values } = parseArgs({ options: { calibration: { type: "string" }, sheets: { type: "string" }, runs: { type: "string" }, out: { type: "string" } } });
const calibrations = join(ROOT, "validatie", "ijkset");
// A calibration of part of the rules (`--only`) has a catalogue of part of the rules: never the base of a register.
const whole = (dir: string): boolean => existsSync(join(dir, "regels.json")) && existsSync(join(dir, "uitkomst.json")) && read<CalibrationReport>(join(dir, "uitkomst.json")).run.only === null;
const newest = readdirSync(calibrations).filter((name) => whole(join(calibrations, name))).sort().at(-1);
const calibrationDir = values.calibration ?? (newest ? join(calibrations, newest) : null);
if (!calibrationDir || !existsSync(join(calibrationDir, "regels.json"))) throw new Error("geen volledige ijkmeting met regels.json gevonden; draai eerst: just calibrate");
const calibration = read<CalibrationReport>(join(calibrationDir, "uitkomst.json"));
if (calibration.run.only !== null) throw new Error(`${calibrationDir} is een ijkmeting van een deel van de regels (--only): een register daaruit zou de meeste regels missen. Draai just calibrate zonder --only`);
const catalogue = read<RuleCatalogue>(join(calibrationDir, "regels.json"));
const folders = values.runs ? readFileSync(values.runs, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")) : [];
// One or the other: a folder is read with a key of this build and a sheet carries the key of its contributor, so one site given both ways would count as two.
if (values.sheets && values.runs) throw new Error("geef --sheets of --runs, niet allebei: dezelfde site zou dan twee keer tellen");
// Only the sheet of an evaluation: a quick measurement has no verdicts to hold a rule against. Each run once.
const sheets = new Map<string, RunSheet>();
for (const name of values.sheets ? readdirSync(values.sheets).filter((entry) => entry.endsWith(".json")) : []) {
  const sheet = read<RunSheet>(join(values.sheets!, name));
  if (sheet.kind === "run-sheet" && sheet.criteria.length > 0) sheets.set(sheet.id, sheet);
}
const fromFolders = folders.map(fieldRun).filter((run): run is FieldRun => run !== null);
if (fromFolders.length < folders.length) process.stderr.write(`${folders.length - fromFolders.length} van de ${folders.length} mappen hebben geen afgerond onderzoek en tellen niet mee\n`);
const runs = [...fromFolders, ...[...sheets.values()].map(fieldRunOfSheet)];

const date = new Date().toISOString().slice(0, 10);
const register = buildRegister({ date, catalogue, calibration, runs });
const out = values.out ?? join(ROOT, "validatie", "regelregister", date);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "register.json"), `${JSON.stringify(register, null, 2)}\n`);
writeFileSync(join(out, "register.md"), registerMarkdown(register));
process.stdout.write(`${register.rules.length} regels, ${register.field.runs} onderzoeken van ${register.field.sites} sites; uitkomst in ${relative(ROOT, out)}\n`);
