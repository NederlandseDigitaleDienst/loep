/**
 * Lay two calibrations (`just calibrate`) next to each other: per instrument the totals before
 * and after, and every test case on which an instrument now says something else.
 *
 *   node scripts/calibrate-compare.ts <previous dir> <current dir>   writes Markdown to stdout
 *
 * Each directory holds the uitkomst.json and gevallen.json that `calibrate` writes. The output is
 * information for whoever reviews a change to the measurements; it never fails on a difference.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Case {
  rule: string;
  id: string;
  expected: string;
  said: Record<string, string>;
}

interface Report {
  date: string;
  toolbox: { commit: string | null; version: string };
  instruments: { id: string; version: string }[];
  totals: Record<string, { judged: number; found: number; missed: number; falseAlarm: number }>;
}

const MAX_ROWS = 60;

export function compareCalibrations(previous: { report: Report; cases: Case[] }, current: { report: Report; cases: Case[] }): string {
  const lines = [`## IJkmeting naast de vorige`, "", `Vorige: ${previous.report.date} (loep ${previous.report.toolbox.version}). Nu: ${current.report.date} (loep ${current.report.toolbox.version}).`, ""];
  const versions = current.report.instruments
    .map((instrument) => [instrument, previous.report.instruments.find((other) => other.id === instrument.id)] as const)
    .filter(([now, before]) => before !== undefined && before.version !== now.version)
    .map(([now, before]) => `${now.id} ${before!.version} naar ${now.version}`);
  if (versions.length > 0) lines.push(`Andere versies sinds de vorige meting: ${versions.join(", ")}. Een verschil kan daar ook vandaan komen.`, "");
  lines.push("| Instrument | Beoordeeld | Terecht gevonden | Gemist | Onterecht gemeld |", "|---|---|---|---|---|");
  const ids = [...new Set([...Object.keys(previous.report.totals), ...Object.keys(current.report.totals)])];
  const pair = (before: number | undefined, now: number | undefined): string => (before === now ? String(now ?? "-") : `${before ?? "-"} → ${now ?? "-"}`);
  for (const id of ids) {
    const [before, now] = [previous.report.totals[id], current.report.totals[id]];
    if ((before?.judged ?? 0) === 0 && (now?.judged ?? 0) === 0) continue;
    lines.push(`| ${id} | ${pair(before?.judged, now?.judged)} | ${pair(before?.found, now?.found)} | ${pair(before?.missed, now?.missed)} | ${pair(before?.falseAlarm, now?.falseAlarm)} |`);
  }
  // One page can be a test case of several rules, and of one rule more than once: the key counts them.
  const keyed = (cases: Case[]): Map<string, Case> => {
    const seen = new Map<string, number>();
    return new Map(
      cases.map((entry) => {
        const key = `${entry.rule}|${entry.id}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return [`${key}|${seen.get(key)}`, entry];
      }),
    );
  };
  const earlier = keyed(previous.cases);
  const changed: string[] = [];
  for (const [key, entry] of keyed(current.cases)) {
    const before = earlier.get(key);
    if (!before) continue;
    for (const instrument of Object.keys({ ...before.said, ...entry.said }).sort()) {
      if (before.said[instrument] === entry.said[instrument]) continue;
      changed.push(`| ${entry.rule} | ${entry.id.slice(0, 12)} | ${entry.expected} | ${instrument} | ${before.said[instrument] ?? "-"} → ${entry.said[instrument] ?? "-"} |`);
    }
  }
  lines.push("", changed.length === 0 ? "Geen enkel instrument zegt op een testgeval iets anders dan in de vorige meting." : `${changed.length} keer zegt een instrument op een testgeval iets anders${changed.length > MAX_ROWS ? `; de eerste ${MAX_ROWS}` : ""}:`);
  if (changed.length > 0) lines.push("", "| ACT-regel | Geval | Verwacht | Instrument | Vorige → nu |", "|---|---|---|---|---|", ...changed.slice(0, MAX_ROWS));
  return `${lines.join("\n")}\n`;
}

function read(dir: string): { report: Report; cases: Case[] } {
  return { report: JSON.parse(readFileSync(join(dir, "uitkomst.json"), "utf8")) as Report, cases: JSON.parse(readFileSync(join(dir, "gevallen.json"), "utf8")) as Case[] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [previous, current] = process.argv.slice(2);
  if (!previous || !current) throw new Error("gebruik: node scripts/calibrate-compare.ts <vorige map> <nieuwe map>");
  process.stdout.write(compareCalibrations(read(previous), read(current)));
}
