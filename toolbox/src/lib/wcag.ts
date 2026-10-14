import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Level = "A" | "AA" | "AAA";
export type WcagVersion = "2.1" | "2.2";

export interface Criterion {
  id: string;
  slug: string;
  titleNl: string;
  level: Level;
  versions: WcagVersion[];
}

interface WcagData {
  source: string;
  principles: Record<string, string>;
  guidelines: Record<string, string>;
  criteria: Criterion[];
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/wcag22-nl.json", import.meta.url)), "utf8"),
) as WcagData;

export const PRINCIPLES = data.principles;
export const GUIDELINES = data.guidelines;

/** The criteria a Dutch government site is evaluated against: levels A and AA. */
export const CRITERIA: Criterion[] = data.criteria.filter((criterion) => criterion.level !== "AAA");

const byId = new Map(data.criteria.map((criterion) => [criterion.id, criterion]));

export function criterionById(id: string): Criterion | undefined {
  return byId.get(id);
}

export function criteriaFor(version: WcagVersion): Criterion[] {
  return CRITERIA.filter((criterion) => criterion.versions.includes(version));
}

export function compareCriterionIds(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** EN 301 549 chapter 9 mirrors WCAG: criterion 1.4.10 is clause 9.1.4.10. */
export function en301549Clause(criterionId: string): string {
  return `9.${criterionId}`;
}

export function understandingUrl(criterion: Criterion): string {
  const base = criterion.versions.includes("2.2") ? "WCAG22" : "WCAG21";
  return `https://www.w3.org/WAI/${base}/Understanding/${criterion.slug}.html`;
}

/** Map an axe-core tag such as "wcag1410" to "1.4.10"; undefined for other tags. */
export function criterionIdFromAxeTag(tag: string): string | undefined {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}
