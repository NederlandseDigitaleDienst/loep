#!/usr/bin/env node
/**
 * How many of the built-in defects of the testsite does the comparison of `quick` catch?
 *
 *   node scripts/quick-key.ts <run of the variant with defects, measured with --baseline of the clean twin>
 *
 * A defect counts as caught when the comparison reports its criterion as worse on one of its
 * pages. That is coarser than the defect itself: another defect under the same criterion on the
 * same page also counts. The key names only what was broken on purpose.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pagePath, type QuickComparison, type QuickSummary } from "../src/lib/quick.ts";

interface Defect {
  id: string;
  criterion: string;
  alsoCriteria?: string[];
  pages: string[];
  state: string;
  class: string;
}

const run = process.argv[2];
if (!run) throw new Error("geef de run van de variant met gebreken op, gemeten met --baseline van de schone tweeling");
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const key = read<{ defects: Defect[] }>(fileURLToPath(new URL("../fixtures/key.json", import.meta.url)));
const summary = read<QuickSummary>(join(run, "quick", "summary.json"));
const comparison = read<QuickComparison>(join(run, "quick", "verschil.json"));

const measured = new Set(summary.pages.filter((page) => page.measured).map((page) => pagePath(page.url)));
const byPath = (changes: QuickComparison["worse"]): Map<string, Set<string>> => {
  const found = new Map<string, Set<string>>();
  for (const change of changes) found.set(change.path, (found.get(change.path) ?? new Set()).add(change.criterion));
  return found;
};
const worse = byPath(comparison.worse);
/** With what one engine alone reports too, as `--strict` counts it. */
const strict = byPath([...comparison.worse, ...(comparison.weak ?? [])]);
const pagesOf = (defect: Defect): string[] => (defect.pages.includes("*") ? [...measured] : defect.pages.filter((path) => measured.has(path)));
const reported = (defect: Defect, criteria: string[], changes = worse): boolean => pagesOf(defect).some((path) => criteria.some((criterion) => changes.get(path)?.has(criterion)));

const rows = key.defects.map((defect) => ({ defect, reach: pagesOf(defect).length > 0, caught: reported(defect, [defect.criterion]), other: reported(defect, defect.alsoCriteria ?? []) }));
const tally = (field: "class" | "state"): string => {
  const groups = new Map<string, { all: number; caught: number }>();
  for (const row of rows) {
    const group = groups.get(row.defect[field]) ?? { all: 0, caught: 0 };
    group.all += 1;
    if (row.caught) group.caught += 1;
    groups.set(row.defect[field], group);
  }
  return [...groups].sort((a, b) => b[1].all - a[1].all).map(([name, group]) => `${name} ${group.caught} van ${group.all}`).join(", ");
};
const expected = new Set(key.defects.flatMap((defect) => pagesOf(defect).flatMap((path) => [defect.criterion, ...(defect.alsoCriteria ?? [])].map((criterion) => `${path} ${criterion}`))));
const unexpected = [...worse].flatMap(([path, criteria]) => [...criteria].map((criterion) => `${path} ${criterion}`)).filter((entry) => !expected.has(entry)).sort();

process.stdout.write(
  [
    `${rows.length} gebreken in de sleutel, ${rows.filter((row) => row.reach).length} op een gemeten pagina.`,
    `Gevangen onder het eigen criterium: ${rows.filter((row) => row.caught).length}. Alleen onder een ander criterium van het gebrek: ${rows.filter((row) => !row.caught && row.other).length}.`,
    `Met ook wat één meetprogramma alleen meldt (--strict): ${rows.filter((row) => reported(row.defect, [row.defect.criterion], strict)).length}.`,
    `Per soort: ${tally("class")}.`,
    `Per toestand: ${tally("state")}.`,
    `Slechter gemeld waar de sleutel geen gebrek heeft: ${unexpected.length}${unexpected.length > 0 ? ` (${unexpected.join("; ")})` : ""}.`,
    `Gemist: ${rows.filter((row) => row.reach && !row.caught).map((row) => row.defect.id).join(", ")}.`,
    "",
  ].join("\n"),
);
