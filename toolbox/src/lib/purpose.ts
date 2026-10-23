import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";

/**
 * What the investigation is for, chosen at `inventory` (#318). To improve: a team wants to know
 * what to fix, and what loep cannot settle is set aside as a limit where the outcome does not
 * hang on it. To account for: a report that backs the status of an accessibility statement, where
 * every such limit stays in sight of whoever signs and of whoever reads the statement.
 */
export const PURPOSES = ["verbeteren", "verantwoorden"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const DEFAULT_PURPOSE: Purpose = "verbeteren";

export const PURPOSE_NL: Record<Purpose, string> = {
  verbeteren: "verbeteren: het team van de site wil weten wat er beter moet",
  verantwoorden: "verantwoorden: het rapport onderbouwt de status van een toegankelijkheidsverklaring",
};

export function parsePurpose(text: string | undefined): Purpose | null {
  if (text === undefined) return null;
  const value = text.trim().toLowerCase();
  if (!(PURPOSES as readonly string[]).includes(value)) throw new Error(`--purpose is ${PURPOSES.join(" of ")}, niet "${text}"`);
  return value as Purpose;
}

/** The purpose of a run, from its manifest; a run from before purposes were recorded is one to improve. */
export function purposeForRun(runDir: string): Purpose {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return DEFAULT_PURPOSE;
  const purpose = (JSON.parse(readFileSync(path, "utf8")) as { purpose?: string }).purpose;
  return (PURPOSES as readonly string[]).includes(purpose ?? "") ? (purpose as Purpose) : DEFAULT_PURPOSE;
}

/** Store the purpose with the run. An inventory without `--purpose` keeps the one the run had. */
export async function recordPurpose(runDir: string, purpose: Purpose | null): Promise<void> {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path) || purpose === null) return;
  await writeJson(path, { ...(await readJson<Record<string, unknown>>(path)), purpose });
}
