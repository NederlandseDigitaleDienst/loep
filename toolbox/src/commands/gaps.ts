import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { OPEN_POINT_KINDS, openPoint } from "../lib/verdict.ts";
import { criterionById } from "../lib/wcag.ts";

/*
 * Every open point of one or more runs, per kind and per criterion: the work list of whoever
 * improves the toolbox. A point "veegronde mist" is an agent saying which measurement the sweep
 * should have delivered; "budget op" says where a budget did not fit; "proef werkte niet" names
 * an instrument that gave no answer. The kinds for the owner of the site are listed too, so the
 * list is complete; "versturen niet toegestaan" stands apart from them, because one declaration
 * of a test environment at inventory would have closed every such point. "niet bereikbaar" is a
 * part of the site that did not load while the rest did: no fault of loep, and a new finishing
 * round measures it once it loads. "buiten de afbakening" is content from an origin the run does
 * not cover: a choice of the scope, no fault of loep. Reads the verdicts and the evaluation of each run and writes
 * nothing.
 */

/** The kinds in the order of the list: what the toolbox can do something about first. */
const KIND_ORDER = ["veegronde mist", "budget op", "geen geldig resultaat", "proef werkte niet", "niet bereikbaar", "versturen niet toegestaan", "buiten de afbakening", "mens nodig", "keuze nodig"] as const;
/** A point from before the kinds existed that starts with none of them. */
const NO_KIND = "zonder soort";

const WHAT_NL: Record<string, string> = {
  "veegronde mist": "Elk punt is een agent die zegt welke meting de veegronde had moeten leveren.",
  "budget op": "Elk punt is iets wat niet is bekeken omdat het budget van een agent op was.",
  "geen geldig resultaat": "Elk punt is een agent die na twee pogingen geen geldig oordeel gaf, zodat de afmaakronde het criterium kreeg.",
  "proef werkte niet": "Elk punt is een instrument dat geen bruikbaar antwoord gaf, of een onderdeel dat niet openging.",
  "niet bereikbaar": "Elk punt is een deel van de site, een pagina of een ingesloten venster, dat bij herhaalde pogingen niet laadde terwijl de rest wel laadde. Geen fout in loep: laadt het weer, dan meet een nieuwe afmaakronde het (tasks --again).",
  "versturen niet toegestaan": "Elk punt is iets wat pas na versturen te zien is, in een run die niet mocht versturen. Geen persoon nodig: een testomgeving, verklaard bij inventory met --test-environment, laat een instrument het meten. Dat kan de origin van alleen het ingesloten venster zijn.",
  "buiten de afbakening": "Elk punt is inhoud die een pagina ophaalt van een adres buiten de run. Geen fout in loep: wie de afbakening koos, kan dat adres erbij nemen in een nieuwe run (inventory --also-origin).",
  "mens nodig": "Elk punt vraagt iets wat geen instrument kan vaststellen.",
  "keuze nodig": "Elk punt vraagt een besluit van de eigenaar van de site.",
  [NO_KIND]: "Punten uit een oordeel van voor de soorten bestonden.",
};

const ROUNDS = [
  { file: "oordeel.json", roundNl: "beoordelaar" },
  { file: "final.json", roundNl: "verifieerder" },
  { file: "afmaak.json", roundNl: "afmaakronde" },
] as const;

export interface GapPoint {
  textNl: string;
  /** How often the point was written: once per verdict it stands in, over all runs. */
  count: number;
  /** Where it was written: the run and the round, as "run: ronde". */
  where: string[];
  /** Whether it still stands in the verdict that counts of at least one run. */
  standing: boolean;
}

export interface GapKind {
  kind: string;
  labelNl: string;
  /** Whose work the point is: the toolbox, the owner of the site, the site itself (a part that did not load), or unknown for a point without a kind. */
  reader: "toolbox" | "owner" | "site" | "unknown";
  whatNl: string;
  /** Points as written, and after equal points were taken together. */
  points: number;
  distinct: number;
  standing: number;
  criteria: { criterion: string; titleNl: string; points: GapPoint[] }[];
}

export interface Gaps {
  runs: string[];
  points: number;
  distinct: number;
  standing: number;
  criteria: number;
  kinds: GapKind[];
}

interface Written {
  run: string;
  criterion: string;
  roundNl: string;
  point: string;
  standing: boolean;
}

/** The kind of a point and its text. A point from before the fixed form ("Budget op (80 van 80 commando's). ...") is recognised by its first words. */
function kindOf(point: string): { kind: string; textNl: string } {
  const parsed = openPoint(point);
  if (parsed.kind) return { kind: parsed.kind.prefix, textNl: parsed.textNl };
  const loose = OPEN_POINT_KINDS.find((entry) => new RegExp(`^${entry.prefix}(?![a-z])`, "i").test(parsed.textNl));
  return { kind: loose?.prefix ?? NO_KIND, textNl: parsed.textNl };
}

const readJsonIfThere = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : []);

/**
 * Every open point one run wrote. From the verdicts when the run has them: each round's own
 * points, so a point a later round settled is still on the list. What still stands is what the
 * evaluation says, or without one what the last verdict of the criterion says. A run that only
 * has an evaluation gives the points that stand in it.
 */
function pointsOfRun(runDir: string): Written[] {
  const run = basename(resolve(runDir));
  const evaluation = readJsonIfThere<{ criteria?: { id?: string; missingNl?: unknown; limitsNl?: unknown }[] }>(join(runDir, "evaluation.json"));
  const standingByCriterion = evaluation?.criteria ? new Map(evaluation.criteria.map((criterion) => [String(criterion.id), new Set([...textsOf(criterion.missingNl), ...textsOf(criterion.limitsNl)].map(same))])) : null;
  const root = join(runDir, "verdicts");
  if (!existsSync(root)) {
    if (!evaluation?.criteria) throw new Error(`${runDir} heeft geen oordelen (verdicts/) en geen evaluatie (evaluation.json): er is niets om open punten uit te lezen`);
    return evaluation.criteria.flatMap((criterion) => [...textsOf(criterion.missingNl), ...textsOf(criterion.limitsNl)].map((point) => ({ run, criterion: String(criterion.id), roundNl: "evaluatie", point, standing: true })));
  }
  const written: Written[] = [];
  for (const criterion of readdirSync(root).sort()) {
    const perRound = ROUNDS.map((round) => ({ roundNl: round.roundNl, points: readJsonIfThere<{ missingNl?: unknown }>(join(root, criterion, round.file)) })).filter((entry) => entry.points !== null);
    const last = perRound.at(-1);
    const standing = standingByCriterion?.get(criterion) ?? new Set(textsOf(last?.points?.missingNl).map(same));
    for (const round of perRound) for (const point of textsOf(round.points!.missingNl)) written.push({ run, criterion, roundNl: round.roundNl, point, standing: standing.has(same(point)) });
  }
  return written;
}

/** Two points are the same when they say the same apart from capitals, spaces and the last full stop. */
function same(point: string): string {
  return kindOf(point).textNl.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

const byNumber = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

export function gaps(runDirs: string[]): Gaps {
  if (runDirs.length === 0) throw new Error("gaps needs --run <run> [<run> ...]");
  const written = runDirs.flatMap(pointsOfRun);
  const kinds: GapKind[] = [];
  for (const kind of [...KIND_ORDER, NO_KIND]) {
    const mine = written.filter((entry) => kindOf(entry.point).kind === kind);
    if (mine.length === 0) continue;
    const criteria = [...new Set(mine.map((entry) => entry.criterion))].sort(byNumber).map((criterion) => {
      const merged = new Map<string, GapPoint>();
      for (const entry of mine.filter((item) => item.criterion === criterion)) {
        const point = merged.get(same(entry.point)) ?? { textNl: kindOf(entry.point).textNl, count: 0, where: [], standing: false };
        point.count++;
        point.standing ||= entry.standing;
        const where = `${entry.run}: ${entry.roundNl}`;
        if (!point.where.includes(where)) point.where.push(where);
        merged.set(same(entry.point), point);
      }
      return { criterion, titleNl: criterionById(criterion)?.titleNl ?? "", points: [...merged.values()].sort((a, b) => b.count - a.count || a.textNl.localeCompare(b.textNl)) };
    });
    const known = OPEN_POINT_KINDS.find((entry) => entry.prefix === kind);
    const distinct = criteria.flatMap((entry) => entry.points);
    kinds.push({ kind, labelNl: known?.labelNl ?? "uit een oordeel van voor de soorten", reader: known?.reader ?? "unknown", whatNl: WHAT_NL[kind]!, points: mine.length, distinct: distinct.length, standing: distinct.filter((point) => point.standing).length, criteria });
  }
  const sum = (pick: (kind: GapKind) => number): number => kinds.reduce((total, kind) => total + pick(kind), 0);
  return {
    runs: runDirs.map((dir) => basename(resolve(dir))),
    points: sum((kind) => kind.points),
    distinct: sum((kind) => kind.distinct),
    standing: sum((kind) => kind.standing),
    criteria: new Set(kinds.flatMap((kind) => kind.criteria.map((entry) => entry.criterion))).size,
    kinds,
  };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The list as a text to read: a table of the kinds, then per kind and per criterion every point once. */
export function gapsTextNl(result: Gaps): string {
  const lines: string[] = [];
  lines.push(`Open punten uit ${plural(result.runs.length, "run", "runs")} (${result.runs.join(", ")}): ${plural(result.points, "punt", "punten")} geschreven, ${result.distinct} verschillend, bij ${plural(result.criteria, "criterium", "criteria")}. Nog open in het oordeel dat telt: ${result.standing}.`);
  if (result.kinds.length === 0) return `${lines[0]}\n`;
  lines.push("");
  const rows = [["Soort", "Punten", "Verschillend", "Criteria", "Nog open"], ...result.kinds.map((kind) => [kind.kind, String(kind.points), String(kind.distinct), String(kind.criteria.length), String(kind.standing)])];
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  for (const row of rows) lines.push(row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join("  "));
  for (const kind of result.kinds) {
    lines.push("", `## ${kind.kind}: ${kind.labelNl} (${plural(kind.points, "punt", "punten")}, ${kind.distinct} verschillend, ${plural(kind.criteria.length, "criterium", "criteria")})`, kind.whatNl);
    for (const criterion of kind.criteria) {
      lines.push("", `${criterion.criterion} ${criterion.titleNl}`.trim());
      for (const point of criterion.points) lines.push(`- [${point.count}x${point.standing ? ", nog open" : ""}; ${point.where.join("; ")}] ${point.textNl}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function gapsOutput(runDirs: string[], options: { json?: boolean | undefined } = {}): string {
  const result = gaps(runDirs);
  return options.json ? `${JSON.stringify(result, null, 2)}\n` : gapsTextNl(result);
}
