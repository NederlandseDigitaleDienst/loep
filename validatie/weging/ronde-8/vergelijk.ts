/**
 * Recompute the comparison of the two investigations of the test site (L1 and L2) in round 8.
 * Per defect of the key: the heaviest severity among the findings matched to it, in each run.
 * Run from the root of the repository: node validatie/weging/ronde-8/vergelijk.ts
 */
import { readFileSync } from "node:fs";

type Severity = "blokkerend" | "hoog" | "midden" | "laag";
interface Entry {
  finding: string;
  task: string | null;
  affected: { consequence: "cannot" | "detour" | "effort" }[];
}
interface Run {
  /** Per defect of the key, the findings of this run matched to it. */
  sleutel: Record<string, string[]>;
  /** The severity the judges gave each finding. */
  beoordelaars: Record<string, Severity>;
  weging: { findings: Entry[] };
}

const RANK: Severity[] = ["blokkerend", "hoog", "midden", "laag"];
const read = (name: string): Run => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
/** The table of toolbox/src/lib/weighing.ts. */
const weighed = (entry: Entry): Severity => {
  const has = (consequence: string): boolean => entry.affected.some((group) => group.consequence === consequence);
  return has("cannot") ? (entry.task !== null ? "blokkerend" : "hoog") : has("detour") ? "midden" : "laag";
};
const heaviest = (severities: Severity[]): Severity => [...severities].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]!;

const [l1, l2] = [read("l1"), read("l2")];
const keys = Object.keys(l1.sleutel).filter((key) => l1.sleutel[key]!.length > 0 && (l2.sleutel[key] ?? []).length > 0);
const perKey = (run: Run, of: Record<string, Severity>): Record<string, Severity> => Object.fromEntries(keys.map((key) => [key, heaviest(run.sleutel[key]!.map((id) => of[id]!))]));
const bySteps = (run: Run): Record<string, Severity> => Object.fromEntries(run.weging.findings.map((entry) => [entry.finding, weighed(entry)]));

function compare(name: string, a: Record<string, Severity>, b: Record<string, Severity>): void {
  const apart = keys.map((key) => Math.abs(RANK.indexOf(a[key]!) - RANK.indexOf(b[key]!)));
  const same = apart.filter((steps) => steps === 0).length;
  const count = (of: Record<string, Severity>, severity: Severity): number => keys.filter((key) => of[key] === severity).length;
  const chance = RANK.reduce((sum, severity) => sum + count(a, severity) * count(b, severity), 0) / keys.length ** 2;
  const blocking = (of: Record<string, Severity>): string[] => keys.filter((key) => of[key] === "blokkerend");
  console.log(`${name}: gelijk ${same}, een trede ${apart.filter((steps) => steps === 1).length}, twee of meer ${apart.filter((steps) => steps >= 2).length}, van ${keys.length}; kappa ${((same / keys.length - chance) / (1 - chance)).toFixed(2)}`);
  console.log(`  blokkerend in L1 ${blocking(a).length}, in L2 ${blocking(b).length}, in beide ${blocking(a).filter((key) => blocking(b).includes(key)).length}`);
}

compare("beoordelaars", perKey(l1, l1.beoordelaars), perKey(l2, l2.beoordelaars));
compare("weging ronde 8", perKey(l1, bySteps(l1)), perKey(l2, bySteps(l2)));
