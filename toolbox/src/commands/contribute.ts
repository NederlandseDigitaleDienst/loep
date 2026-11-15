/**
 * `contribute`: make the sheet of a finished run (`meetblad.json`): what the run says about loep,
 * without what it says about the site. Rule ids, criteria, outcomes and counts. It reads the run
 * and writes nothing in it, so a sealed run stays sealed, and it works on a run of any version.
 *
 * It sends nothing. Where a sheet goes is for whoever runs it to decide: the skill
 * nldd-a11y-contribute asks, and pushes with that person's own access.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildSheet, sheetLeaks, type RunSheet, type SheetSource } from "../lib/run-sheet.ts";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Where the key stands that turns the address of a site into its key on a sheet. It never leaves this machine. */
export const defaultKeyFile = (): string => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "loep", "bijdrage.sleutel");

/** The key of this contributor, made on first use. With it the same site gets the same key on every sheet from this machine, and nobody else can try addresses against a sheet. */
export function contributorKey(file = defaultKeyFile()): string {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

/** `result.grouped.elements` of every `rules` observation of every session of a run. */
export function sessionElements(runDir: string): SheetSource["sessionElements"] {
  const elements: SheetSource["sessionElements"] = [];
  const sessions = join(runDir, "observations");
  if (!existsSync(sessions)) return elements;
  for (const session of readdirSync(sessions, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const file of readdirSync(join(sessions, session.name)).filter((name) => /^\d+\.json$/.test(name))) {
      // An observation that was cut off while it was written is no reason to stop: the sheet counts what is there.
      try {
        const observation = readJson<{ command?: string; result?: { grouped?: { elements?: SheetSource["sessionElements"] } } }>(join(sessions, session.name, file));
        if (observation.command === "rules" || observation.command === "engines") elements.push(...(observation.result?.grouped?.elements ?? []));
      } catch {
        continue;
      }
    }
  }
  return elements;
}

/** What of a run a sheet is built from. Null when the run has no evaluation: an unfinished run has nothing to contribute yet. */
export function sheetSource(runDir: string): SheetSource | null {
  const evaluationFile = join(runDir, "evaluation.json");
  if (!existsSync(evaluationFile)) return null;
  const evaluationText = readFileSync(evaluationFile, "utf8");
  const sweepPages: SheetSource["sweepPages"] = [];
  const pages = join(runDir, "pages");
  for (const page of existsSync(pages) ? readdirSync(pages, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : []) {
    for (const scheme of ["light", "dark"]) {
      const file = join(pages, page.name, `engines-${scheme}.json`);
      if (!existsSync(file)) continue;
      try {
        sweepPages.push({ page: page.name, results: readJson<{ results?: SheetSource["sweepPages"][number]["results"] }>(file).results ?? [] });
      } catch {
        continue;
      }
    }
  }
  const manifest = existsSync(join(runDir, "manifest.json")) ? readJson<{ steps?: SheetSource["steps"] }>(join(runDir, "manifest.json")) : {};
  return { evaluationText, evaluation: JSON.parse(evaluationText) as SheetSource["evaluation"], sessionElements: sessionElements(runDir), sweepPages, steps: manifest.steps ?? [] };
}

export interface Contribution {
  sheet: RunSheet;
  /** Words of the site found in the sheet. Not empty: the sheet is not written. */
  leaks: string[];
  /** Where the sheet was written, when asked. */
  file: string | null;
}

/** Make the sheet of a run and, with `outDir`, write it there under its id. A sheet with a word of the site in it is refused. */
export function contribute(runDir: string, options: { outDir?: string | undefined; key: string }): Contribution {
  const source = sheetSource(runDir);
  if (!source) throw new Error(`${runDir} heeft geen evaluation.json: alleen een afgerond onderzoek heeft een meetblad`);
  const sheet = buildSheet(source, options.key);
  const site = (source.evaluation as { site?: { baseUrl?: string; name?: string; organisation?: string } }).site ?? {};
  const leaks = sheetLeaks(sheet, { baseUrl: site.baseUrl, names: [site.name, site.organisation] });
  if (leaks.length > 0 || !options.outDir) return { sheet, leaks, file: null };
  mkdirSync(options.outDir, { recursive: true });
  const file = join(options.outDir, `${sheet.id}.json`);
  writeFileSync(file, `${JSON.stringify(sheet, null, 2)}\n`);
  return { sheet, leaks, file };
}

/** Folders under `root` that hold a finished evaluation: every run someone kept there, however deep. A copy of the evaluation in the report or the signed folder of a run is not a run. */
export function runsUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (existsSync(join(dir, "evaluation.json"))) {
      found.push(dir);
      return;
    }
    if (depth >= 6) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(join(dir, entry.name), depth + 1);
  };
  walk(root, 0);
  return found.sort();
}

export interface ManyContributions {
  runs: number;
  /** Sheets, one per run with its own evaluation: a copy of a run gives the same sheet once. */
  sheets: RunSheet[];
  written: number;
  /** Runs whose sheet held a word of their site: not written. Named by the id of the sheet, not by the folder. */
  refused: { id: string; leaks: string[] }[];
  /** Runs that could not be read. */
  failed: number;
}

/** The sheets of every finished run under a folder: how someone contributes the runs made before there was a collection. */
export function contributeAll(root: string, options: { outDir?: string | undefined; key: string }): ManyContributions {
  const result: ManyContributions = { runs: 0, sheets: [], written: 0, refused: [], failed: 0 };
  const seen = new Set<string>();
  for (const run of runsUnder(root)) {
    result.runs += 1;
    try {
      const one = contribute(run, options);
      if (one.leaks.length > 0) result.refused.push({ id: one.sheet.id, leaks: one.leaks });
      else if (!seen.has(one.sheet.id)) {
        seen.add(one.sheet.id);
        result.sheets.push(one.sheet);
        if (one.file) result.written += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export function manyContributionsNl(result: ManyContributions, outDir: string | undefined): string {
  const sites = new Set(result.sheets.map((sheet) => sheet.siteKey)).size;
  const versions = [...new Set(result.sheets.map((sheet) => sheet.toolbox.version ?? "onbekend"))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return [
    `${result.runs} afgeronde onderzoeken gevonden, ${result.sheets.length} meetbladen van ${sites} ${sites === 1 ? "site" : "sites"}${result.runs - result.sheets.length - result.refused.length - result.failed > 0 ? ` (${result.runs - result.sheets.length - result.refused.length - result.failed} keer dezelfde run in een andere map)` : ""}.`,
    ...(result.sheets.length > 0 ? [`Versies van loep: ${versions.join(", ")}.`] : []),
    "Op een meetblad: de uitkomst per criterium, wat beoordelaars over een regel zeiden, welke regels afkeurden, gebreken geteld naar ernst en eigenaar, en de duur per stap.",
    "Niet erop: het adres en de naam van de site, pagina's, selectors, de tekst van een oordeel of bevinding, schermafbeeldingen, en wie tekende.",
    ...(result.refused.length > 0 ? [`GEWEIGERD: ${result.refused.length} ${result.refused.length === 1 ? "meetblad bevat" : "meetbladen bevatten"} iets van de site en ${result.refused.length === 1 ? "is" : "zijn"} niet geschreven (${result.refused.map((entry) => entry.id).join(", ")}). Meld dit bij de makers van loep.`] : []),
    ...(result.failed > 0 ? [`${result.failed} ${result.failed === 1 ? "map was" : "mappen waren"} niet te lezen.`] : []),
    outDir ? `Geschreven: ${result.written} in ${outDir}. Er is niets verstuurd.` : "Niets geschreven. Met --out <map> komen de meetbladen in die map. Er wordt niets verstuurd.",
    "",
  ].join("\n");
}

/** What a person reads before a sheet goes anywhere: what is on it, and what is not. */
export function contributionNl(result: Contribution): string {
  const { sheet } = result;
  const failed = sheet.criteria.filter((criterion) => criterion.outcome === "failed").length;
  return [
    `Meetblad ${sheet.id}: loep ${sheet.toolbox.version ?? "onbekend"}, ${sheet.month}, ${sheet.size.pages} pagina's, ${sheet.criteria.length} criteria waarvan ${failed} afgekeurd.`,
    `Erop: de uitkomst per criterium, ${sheet.rulings.length} uitspraken van een beoordelaar over een regel, ${sheet.sessions.length} regels die in een sessie afkeurden, ${sheet.sweep.length} regels uit de veegronde, ${sheet.defects.total} gebreken geteld naar ernst en eigenaar, en de duur per stap.`,
    "Niet erop: het adres en de naam van de site, pagina's, selectors, de tekst van een oordeel of bevinding, schermafbeeldingen, en wie tekende.",
    `De site staat erop als ${sheet.siteKey}: een sleutel die alleen op deze machine uit het adres te maken is.`,
    ...(result.leaks.length > 0 ? [`GEWEIGERD: op het meetblad staat iets van de site: ${result.leaks.join(", ")}. Het is niet geschreven. Meld dit bij de makers van loep.`] : []),
    ...(result.file ? [`Geschreven: ${result.file}`] : result.leaks.length === 0 ? ["Niets geschreven. Met --out <map> komt het meetblad in die map. Er wordt niets verstuurd."] : []),
    "",
  ].join("\n");
}
