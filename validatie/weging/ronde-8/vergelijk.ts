/**
 * Recompute the comparison of the two investigations of the test site (L1 and L2) in round 8.
 * Per defect of the key: the heaviest severity among the findings matched to it, in each run.
 * Run from the root of the repository: node validatie/weging/ronde-8/vergelijk.ts
 */
import { readFileSync } from "node:fs";
import { SEVERITIES, type Severity } from "../../../toolbox/src/lib/verdict.ts";
import { severityOf, type Weighing } from "../../../toolbox/src/lib/weighing.ts";

interface Run {
  /** Per defect of the key, the findings of this run matched to it. */
  key: Record<string, string[]>;
  /** The severity the judges gave each finding. */
  judged: Record<string, Severity>;
  weighing: { findings: ({ finding: string } & Weighing)[] };
}

const read = (name: string): Run => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
const rank = (severity: Severity): number => SEVERITIES.indexOf(severity);
const heaviest = (severities: Severity[]): Severity => [...severities].sort((a, b) => rank(a) - rank(b))[0]!;

const [l1, l2] = [read("l1"), read("l2")];
const defects = Object.keys(l1.key).filter((defect) => l1.key[defect]!.length > 0 && (l2.key[defect] ?? []).length > 0);
const perDefect = (run: Run, of: Record<string, Severity>): Record<string, Severity> => Object.fromEntries(defects.map((defect) => [defect, heaviest(run.key[defect]!.map((id) => of[id]!))]));
/** The severity of each finding by the table of the toolbox. */
const weighed = (run: Run): Record<string, Severity> => Object.fromEntries(run.weighing.findings.map((entry) => [entry.finding, severityOf(entry)]));

function compare(name: string, a: Record<string, Severity>, b: Record<string, Severity>): void {
  const apart = defects.map((defect) => Math.abs(rank(a[defect]!) - rank(b[defect]!)));
  const same = apart.filter((steps) => steps === 0).length;
  const count = (of: Record<string, Severity>, severity: Severity): number => defects.filter((defect) => of[defect] === severity).length;
  const chance = SEVERITIES.reduce((sum, severity) => sum + count(a, severity) * count(b, severity), 0) / defects.length ** 2;
  const blocking = (of: Record<string, Severity>): string[] => defects.filter((defect) => of[defect] === "blokkerend");
  console.log(`${name}: gelijk ${same}, een trede ${apart.filter((steps) => steps === 1).length}, twee of meer ${apart.filter((steps) => steps >= 2).length}, van ${defects.length}; kappa ${((same / defects.length - chance) / (1 - chance)).toFixed(2)}`);
  console.log(`  blokkerend in L1 ${blocking(a).length}, in L2 ${blocking(b).length}, in beide ${blocking(a).filter((defect) => blocking(b).includes(defect)).length}`);
}

compare("beoordelaars", perDefect(l1, l1.judged), perDefect(l2, l2.judged));
compare("weging ronde 8", perDefect(l1, weighed(l1)), perDefect(l2, weighed(l2)));
