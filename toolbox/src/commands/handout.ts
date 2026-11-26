/**
 * `handout`: copy the report of a run to a folder outside it, under a name that says which site
 * and which day. In the run the files are called `rapport.pdf`, the same for every site, so a
 * folder of downloads fills with "rapport 7.pdf" and "rapport 8.pdf". The names in the run stay:
 * the seal, a publication and the links in a report rest on them.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Evaluation } from "../lib/evaluation.ts";
import { SIGNED_DIR } from "../lib/seal.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";

/** The files of a report someone passes on, as they are called in the run. */
export const HANDOUT_FILES = ["rapport.pdf", "rapport-kort.pdf", "rapport.html"] as const;

/** The site as someone would say it: the host without www, and the path when the site is under one. */
export function handoutSite(baseUrl: string): string {
  const url = new URL(baseUrl);
  const decoded = (segment: string): string => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  return [url.host.replace(/^www\./, ""), ...url.pathname.split("/").filter(Boolean).map(decoded)].join("-").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * The name of a report file outside its run: what it is, the site, the day of the evaluation, and
 * "concept" as long as nobody signed it. `rapport-kort.pdf` of www.example.nl becomes
 * `rapport-kort-example.nl-2026-11-15-concept.pdf`. A name that is given says it instead of the host:
 * a test site on an IP address, or a site the caller knows by the name it uses itself.
 */
export function handoutName(file: string, evaluation: Pick<Evaluation, "site" | "evaluatedAt">, signed: boolean, name?: string): string {
  const dot = file.lastIndexOf(".");
  const site = name ?? handoutSite(evaluation.site.baseUrl);
  return `${file.slice(0, dot)}-${site}-${evaluation.evaluatedAt.slice(0, 10)}${signed ? "" : "-concept"}${file.slice(dot)}`;
}

export interface Handout {
  signed: boolean;
  /** The copies, as full paths. */
  written: string[];
  /** Files of the report that are not in the run, by their name there. */
  missing: string[];
}

/** Copy the report of a run to `outDir`: the signed one after signing, the concept before. Nothing in the run changes. */
export async function handout(runDir: string, outDir: string, name?: string): Promise<Handout> {
  const evaluation = await readEvaluation(join(runDir, "evaluation.json"));
  const signed = signatureIsCurrent(evaluation);
  const source = join(runDir, signed ? SIGNED_DIR : "report");
  const out = resolve(outDir);
  if (out === resolve(runDir) || out.startsWith(`${resolve(runDir)}/`)) throw new Error("handout schrijft buiten de run: kies met --out een map die niet in de run ligt");
  const present = HANDOUT_FILES.filter((file) => existsSync(join(source, file)));
  if (present.length === 0) throw new Error(`er staat geen rapport in ${source}: draai eerst render`);
  await mkdir(out, { recursive: true });
  const written: string[] = [];
  for (const file of present) {
    const target = join(out, handoutName(file, evaluation, signed, name));
    await copyFile(join(source, file), target);
    written.push(target);
  }
  return { signed, written, missing: HANDOUT_FILES.filter((file) => !present.includes(file)) };
}
