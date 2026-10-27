import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";

/**
 * What the investigation is for (#318). To improve: a team wants to know what to fix; the report
 * is not signed. To account for: the report backs the status of an accessibility statement; it is
 * signed, and says at the top what is still missing for status B. Chosen or changed at the end of a
 * run, with `purpose`, so a run to improve that turns out complete can be signed without a new run.
 */
export const PURPOSES = ["verbeteren", "verantwoorden"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const DEFAULT_PURPOSE: Purpose = "verbeteren";

export const PURPOSE_NL: Record<Purpose, string> = {
  verbeteren: "verbeteren: het team van de site wil weten wat er beter moet; het rapport wordt niet getekend",
  verantwoorden: "verantwoorden: het rapport onderbouwt de status van een toegankelijkheidsverklaring en wordt getekend",
};

export function parsePurpose(text: string | undefined): Purpose {
  const value = (text ?? "").trim().toLowerCase();
  if (!(PURPOSES as readonly string[]).includes(value)) throw new Error(`het doel is ${PURPOSES.join(" of ")}, niet "${text ?? ""}"`);
  return value as Purpose;
}

/** The purpose of a run, from its manifest; a run without one is one to improve. */
export function purposeForRun(runDir: string): Purpose {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return DEFAULT_PURPOSE;
  const purpose = (JSON.parse(readFileSync(path, "utf8")) as { purpose?: string }).purpose;
  return (PURPOSES as readonly string[]).includes(purpose ?? "") ? (purpose as Purpose) : DEFAULT_PURPOSE;
}

/** Store the purpose with the run. The report says it only after evaluate and render run again. */
export async function recordPurpose(runDir: string, purpose: Purpose): Promise<void> {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) throw new Error(`${runDir} heeft geen manifest.json: dit is geen run`);
  await writeJson(path, { ...(await readJson<Record<string, unknown>>(path)), purpose });
}
