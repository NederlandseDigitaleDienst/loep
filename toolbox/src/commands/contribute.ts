/**
 * `contribute`: make the sheet of a finished run (`meetblad.json`): what the run says about loep,
 * without what it says about the site. Rule ids, criteria, outcomes and counts. It reads the run
 * and writes nothing in it, so a sealed run stays sealed, and it works on a run of any version.
 *
 * It sends nothing. Where a sheet goes is for whoever runs it to decide: the skill
 * nldd-a11y-contribute asks, and pushes with that person's own access.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildSheet, sheetLeaks, type RunSheet, type SheetSource } from "../lib/run-sheet.ts";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Where the key stands that turns the address of a site into its key on a sheet. It never leaves this machine. */
export const defaultKeyFile = (): string => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "loep", "bijdrage.sleutel");

/**
 * The key of this contributor. With it the same site gets the same key on every sheet from this
 * machine, and nobody else can try addresses against a sheet. Made on first use, and only when
 * `create` is set: a look at what a sheet holds writes nothing, and gets a key for that one look.
 */
export function contributorKey(file = defaultKeyFile(), create = true): string {
  if (existsSync(file)) {
    const key = readFileSync(file, "utf8").trim();
    // An empty or short key makes the key of a site guessable: refused, not used.
    if (key.length < 32) throw new Error(`${file} bevat geen sleutel van 32 tekens of meer. Verwijder het bestand; loep maakt dan een nieuwe. Meetbladen die je eerder instuurde, houden hun oude sleutel.`);
    return key;
  }
  const key = randomBytes(32).toString("hex");
  if (!create) return key;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

const ENGINE_OF_METHOD: Record<string, string> = { "accessibility-checker-engine": "ibm" };

interface RulesObservation {
  command?: string;
  page?: { url?: string };
  result?: {
    grouped?: { elements?: { criterion: string; where?: string; verdicts?: Record<string, string>; rules?: Record<string, string[]> }[] };
    methods?: { implementation?: string; result?: { findings?: { rule?: string; where?: string; outcome?: string }[] } }[];
  };
}

/**
 * The elements of every `rules` observation of every session of a run, each with the page it was
 * measured on. Under an element stand the rules that failed it and the rules that only doubted
 * it; a sheet counts the first. What each rule said of each element is in the findings of the
 * engines, and from those the rules that failed are taken.
 */
export function sessionElements(runDir: string): SheetSource["sessionElements"] {
  const elements: SheetSource["sessionElements"] = [];
  const sessions = join(runDir, "observations");
  if (!existsSync(sessions)) return elements;
  for (const session of readdirSync(sessions, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const file of readdirSync(join(sessions, session.name)).filter((name) => /^\d+\.json$/.test(name))) {
      let observation: RulesObservation;
      // An observation that was cut off while it was written is no reason to stop: the sheet counts what is there.
      try {
        observation = readJson<RulesObservation>(join(sessions, session.name, file));
      } catch {
        continue;
      }
      if (observation.command !== "rules" && observation.command !== "engines") continue;
      const failed = new Set<string>();
      const methods = observation.result?.methods;
      for (const method of methods ?? []) {
        const engine = ENGINE_OF_METHOD[method.implementation ?? ""] ?? method.implementation ?? "";
        for (const finding of method.result?.findings ?? []) if (finding.outcome === "failed") failed.add(`${engine}\n${finding.rule}\n${finding.where ?? ""}`);
      }
      for (const element of observation.result?.grouped?.elements ?? []) {
        // Without the findings of the engines, as in a run of an old version, the rules under the element stand as they are.
        const rules = methods ? Object.fromEntries(Object.entries(element.rules ?? {}).map(([engine, names]) => [engine, names.filter((rule) => failed.has(`${engine}\n${rule}\n${element.where ?? ""}`))])) : element.rules;
        elements.push({ criterion: element.criterion, ...(observation.page?.url ? { page: observation.page.url } : {}), ...(element.where !== undefined ? { where: element.where } : {}), ...(element.verdicts ? { verdicts: element.verdicts } : {}), ...(rules ? { rules } : {}) });
      }
    }
  }
  return elements;
}

const jsonOr = <T>(path: string, fallback: T): T => {
  if (!existsSync(path)) return fallback;
  try {
    return readJson<T>(path);
  } catch {
    return fallback;
  }
};

/** Whether a folder holds something a sheet can be made of: a finished evaluation, or a quick measurement. */
export const hasSheet = (runDir: string): boolean => existsSync(join(runDir, "evaluation.json")) || existsSync(join(runDir, "quick", "summary.json"));

/** What of a run a sheet is built from. Null when the run has neither an evaluation nor a quick measurement: an unfinished run has nothing to contribute yet. */
export function sheetSource(runDir: string): SheetSource | null {
  const evaluationFile = join(runDir, "evaluation.json");
  const quickFile = join(runDir, "quick", "summary.json");
  if (!existsSync(evaluationFile) && !existsSync(quickFile)) return null;
  const evaluated = existsSync(evaluationFile);
  const evaluationText = readFileSync(evaluated ? evaluationFile : quickFile, "utf8");
  const sweepPages: SheetSource["sweepPages"] = [];
  const pages = join(runDir, "pages");
  for (const page of existsSync(pages) ? readdirSync(pages, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : []) {
    for (const scheme of ["light", "dark"]) {
      const results = jsonOr<{ results?: SheetSource["sweepPages"][number]["results"] }>(join(pages, page.name, `engines-${scheme}.json`), {}).results;
      if (results) sweepPages.push({ page: page.name, results });
    }
  }
  const manifest = jsonOr<{ steps?: SheetSource["steps"]; toolbox?: { version?: string }; seed?: string }>(join(runDir, "manifest.json"), {});
  const inventoryFile = join(runDir, "inventory.json");
  // The seed is made once, at the inventory. A run from before it had one is told by its inventory.
  const runMark = manifest.seed ?? (existsSync(inventoryFile) ? createHash("sha256").update(readFileSync(inventoryFile)).digest("hex") : undefined);
  const decisionsDir = join(runDir, "besluiten");
  // One file per defect, next to an index: the kind of decision is all the sheet takes.
  const decisions = existsSync(decisionsDir)
    ? readdirSync(decisionsDir)
        .filter((name) => name.endsWith(".json") && name !== "index.json")
        .map((name) => jsonOr<{ decision?: string }>(join(decisionsDir, name), {}).decision)
        .filter((decision): decision is string => typeof decision === "string")
    : undefined;
  const rechecksDir = join(runDir, "rechecks");
  const quick = existsSync(quickFile) ? { summary: jsonOr<NonNullable<SheetSource["quick"]>["summary"]>(quickFile, {} as never), comparison: jsonOr<NonNullable<SheetSource["quick"]>["comparison"]>(join(runDir, "quick", "verschil.json"), null) } : undefined;
  return {
    evaluationText,
    evaluation: evaluated ? (JSON.parse(evaluationText) as SheetSource["evaluation"]) : { criteria: [] },
    sessionElements: evaluated ? sessionElements(runDir) : [],
    sweepPages,
    steps: manifest.steps ?? [],
    runMark,
    // The signature stands in a file of its own; `sign` never writes it into the evaluation.
    signed: existsSync(join(runDir, "signed", "signature.json")),
    toolboxVersion: manifest.toolbox?.version,
    collectPages: existsSync(join(runDir, "collect.json")) ? (jsonOr<{ pages?: SheetSource["collectPages"] }>(join(runDir, "collect.json"), {}).pages ?? []) : undefined,
    gate: existsSync(join(runDir, "gate.json")) ? jsonOr<NonNullable<SheetSource["gate"]>>(join(runDir, "gate.json"), {}) : undefined,
    decisions,
    rechecks: existsSync(rechecksDir) ? readdirSync(rechecksDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length : undefined,
    statementStatus: jsonOr<{ status?: string }>(join(runDir, "verklaring", "verklaring.json"), {}).status,
    quick,
  };
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
  if (!source) throw new Error(`${runDir} heeft geen evaluation.json en geen quick/summary.json: alleen een afgerond onderzoek of een snelle meting heeft een meetblad`);
  const sheet = buildSheet(source, options.key);
  const site = (source.evaluation as { site?: { baseUrl?: string; name?: string; organisation?: string } }).site ?? {};
  const leaks = sheetLeaks(sheet, { baseUrl: site.baseUrl ?? source.quick?.summary.site, names: [site.name, site.organisation] });
  if (leaks.length > 0 || !options.outDir) return { sheet, leaks, file: null };
  mkdirSync(options.outDir, { recursive: true });
  const file = join(options.outDir, `${sheet.id}.json`);
  writeFileSync(file, `${JSON.stringify(sheet, null, 2)}\n`);
  return { sheet, leaks, file };
}

/**
 * Folders under `root` that hold a finished evaluation or a quick measurement: every run someone
 * kept there, however deep. A copy of the evaluation in the report or the signed folder of a run
 * is not a run. A folder that may not be read is passed by and counted.
 */
export function runsUnder(root: string): { runs: string[]; unreadable: number } {
  const runs: string[] = [];
  let unreadable = 0;
  const walk = (dir: string, depth: number): void => {
    if (hasSheet(dir)) {
      runs.push(dir);
      return;
    }
    if (depth >= 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable += 1;
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(join(dir, entry.name), depth + 1);
  };
  walk(root, 0);
  return { runs: runs.sort(), unreadable };
}

export interface ManyContributions {
  runs: number;
  /** Sheets, one per run: the same run in two folders gives one sheet, of the folder that was evaluated last. */
  sheets: RunSheet[];
  written: number;
  /** Runs whose sheet held something of their site: not written. Named by the id of the sheet, not by the folder. */
  refused: { id: string; leaks: string[] }[];
  /** Runs and folders that could not be read. */
  failed: number;
  /** Folders that hold a run another folder holds too. */
  duplicates: number;
}

/**
 * The sheets of every finished run under a folder: how someone contributes the runs made before
 * there was a collection. A run that cannot be read is counted and passed by; a folder that cannot
 * be written in stops the command, because nothing would be contributed and that should be said.
 */
export function contributeAll(root: string, options: { outDir?: string | undefined; key: string }): ManyContributions {
  const found = runsUnder(root);
  const result: ManyContributions = { runs: found.runs.length, sheets: [], written: 0, refused: [], failed: found.unreadable, duplicates: 0 };
  const newest = new Map<string, { sheet: RunSheet; at: string }>();
  for (const run of found.runs) {
    let one: Contribution;
    let at: string;
    try {
      one = contribute(run, { key: options.key });
      at = sheetSource(run)?.evaluation.evaluatedAt ?? "";
    } catch {
      result.failed += 1;
      continue;
    }
    if (one.leaks.length > 0) result.refused.push({ id: one.sheet.id, leaks: one.leaks });
    else {
      if (newest.has(one.sheet.id)) result.duplicates += 1;
      if (!newest.has(one.sheet.id) || newest.get(one.sheet.id)!.at < at) newest.set(one.sheet.id, { sheet: one.sheet, at });
    }
  }
  result.sheets = [...newest.values()].map((entry) => entry.sheet);
  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    for (const sheet of result.sheets) {
      writeFileSync(join(options.outDir, `${sheet.id}.json`), `${JSON.stringify(sheet, null, 2)}\n`);
      result.written += 1;
    }
  }
  return result;
}

export function manyContributionsNl(result: ManyContributions, outDir: string | undefined): string {
  const sites = new Set(result.sheets.map((sheet) => sheet.siteKey)).size;
  const versions = [...new Set(result.sheets.map((sheet) => sheet.toolbox.version ?? "onbekend"))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return [
    `${result.runs} afgeronde onderzoeken en snelle metingen gevonden, ${result.sheets.length} meetbladen van ${sites} ${sites === 1 ? "site" : "sites"}${result.duplicates > 0 ? ` (${result.duplicates} keer dezelfde run in een andere map)` : ""}.`,
    ...(result.sheets.length > 0 ? [`Versies van loep: ${versions.join(", ")}.`] : []),
    "Op een meetblad: de uitkomst per criterium, het taalmodel per rol, wat beoordelaars over een regel zeiden, welke regels afkeurden en of de regelsets het eens waren, gebreken geteld naar ernst en eigenaar, wat mensen besloten (alleen aantallen), en de duur per stap.",
    "Niet erop: het adres en de naam van de site, pagina's, selectors, de tekst van een oordeel of bevinding, schermafbeeldingen, en wie tekende of besloot.",
    ...(result.refused.length > 0 ? [`GEWEIGERD: ${result.refused.length} ${result.refused.length === 1 ? "meetblad bevat" : "meetbladen bevatten"} iets van de site en ${result.refused.length === 1 ? "is" : "zijn"} niet geschreven (${result.refused.map((entry) => entry.id).join(", ")}). Meld dit bij de makers van loep.`] : []),
    ...(result.failed > 0 ? [`${result.failed} ${result.failed === 1 ? "map was" : "mappen waren"} niet te lezen.`] : []),
    "Let op: is het rapport van een onderzoek openbaar, dan kan iemand met toegang tot de verzameling het meetblad eraan koppelen, door de uitkomsten per criterium naast elkaar te leggen.",
    outDir ? `Geschreven: ${result.written} in ${outDir}. Er is niets verstuurd.` : "Niets geschreven. Met --out <map> komen de meetbladen in die map. Er wordt niets verstuurd.",
    "",
  ].join("\n");
}

/** What a person reads before a sheet goes anywhere: what is on it, and what is not. */
export function contributionNl(result: Contribution): string {
  const { sheet } = result;
  const failed = sheet.criteria.filter((criterion) => criterion.outcome === "failed").length;
  const models = sheet.models.length > 0 ? `, model ${sheet.models.join(" en ")}` : "";
  return [
    sheet.quick && sheet.criteria.length === 0
      ? `Meetblad ${sheet.id} van een snelle meting: loep ${sheet.toolbox.version ?? "onbekend"}, ${sheet.month}, ${sheet.quick.pages} pagina's.`
      : `Meetblad ${sheet.id}: loep ${sheet.toolbox.version ?? "onbekend"}, ${sheet.month}${models}, ${sheet.size.pages} pagina's, ${sheet.criteria.length} criteria waarvan ${failed} afgekeurd.`,
    sheet.quick && sheet.criteria.length === 0
      ? `Erop: ${sheet.quick.rules.length} regels en proeven met het aantal plekken op een sterke en op een zwakke grond${sheet.quick.comparison ? ", en hoe de vergelijking met de basislijn afliep" : ""}.`
      : `Erop: de uitkomst per criterium, het taalmodel per rol, ${sheet.rulings.length} uitspraken van een beoordelaar over een regel, ${sheet.sessions.length} regels die in een sessie afkeurden en of de andere regelsets het daarmee eens waren, ${sheet.sweep.length} regels uit de veegronde, ${sheet.defects.total} gebreken geteld naar ernst en eigenaar, wat mensen besloten en lieten nameten (alleen aantallen), en de duur per stap.`,
    "Niet erop: het adres en de naam van de site, pagina's, selectors, de tekst van een oordeel of bevinding, schermafbeeldingen, en wie tekende of besloot.",
    "De site staat erop als een sleutel die alleen op deze machine uit het adres te maken is.",
    "Let op: is het rapport van dit onderzoek openbaar, dan kan iemand met toegang tot de verzameling het meetblad eraan koppelen, door de uitkomsten per criterium naast elkaar te leggen.",
    ...(result.leaks.length > 0 ? [`GEWEIGERD: op het meetblad staat iets van de site: ${result.leaks.join(", ")}. Het is niet geschreven. Meld dit bij de makers van loep.`] : []),
    ...(result.file ? [`Geschreven: ${result.file}`] : result.leaks.length === 0 ? ["Niets geschreven. Met --out <map> komt het meetblad in die map. Er wordt niets verstuurd."] : []),
    "",
  ].join("\n");
}
