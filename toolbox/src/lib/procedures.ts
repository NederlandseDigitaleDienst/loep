import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { sha256 } from "./canonical.ts";
import { EXTRACTORS } from "./extractors.ts";
import { COMMAND_ALIASES, LOOK_COMMANDS, MEASURE_COMMANDS } from "./verdict.ts";
import { compareCriterionIds, CRITERIA, criterionById } from "./wcag.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const PROCEDURES_DIR = join(REPO_ROOT, "procedures");
export const TEMPLATES_DIR = join(REPO_ROOT, "templates");

export const PROCEDURE_CLASSES = ["engine", "engine+oordeel", "probe", "probe+oordeel", "oordeel", "inventaris"] as const;
export type ProcedureClass = (typeof PROCEDURE_CLASSES)[number];

const SHOWING_COMMANDS: string[] = [...LOOK_COMMANDS, ...MEASURE_COMMANDS];
const OLD_NAMES = Object.keys(COMMAND_ALIASES);
const REQUIRED_SECTIONS = ["Wat het criterium vraagt", "Werkwijze", "Zelf nagaan", "Beslisregels", "Bewijs bij goedkeuring", "Wat de veegronde moet leveren"];

export interface Procedure {
  id: string;
  version: number;
  class: ProcedureClass;
  /** Names of the extractors whose output goes into the dossier for this criterion. */
  evidence: string[];
  /** Inventory totals that must all be zero before "not applicable" can be considered. */
  inapplicableIfZero: string[];
  /** What stays unknown after the judge has used the instruments; printed in the report under limitations. */
  limitsNl: string | null;
  /** Session commands of which a passed verdict must cite at least one observation each. */
  passCommands: string[];
  /** Commands whose method agreement matters for this criterion: a pass must settle a disagreement in these. Defaults to `passCommands`. */
  decisiveCommands: string[];
  body: string;
  /** Hash of the whole file: recorded with every verdict that was reached with it. */
  sha256: string;
}

export function parseProcedure(text: string, expectedId?: string): Procedure {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("no front matter");
  const front = parse(match[1]!) as Record<string, unknown>;
  const body = match[2]!.trim();
  const id = String(front.id);
  const problems: string[] = [];
  if (expectedId && id !== expectedId) problems.push(`id "${id}" does not match the file name`);
  if (!criterionById(id)) problems.push(`"${id}" is not a WCAG success criterion`);
  if (!Number.isInteger(front.version)) problems.push("version must be an integer");
  if (!PROCEDURE_CLASSES.includes(front.class as ProcedureClass)) problems.push(`class must be one of ${PROCEDURE_CLASSES.join(", ")}`);
  const evidence = (front.evidence ?? []) as string[];
  if (!Array.isArray(evidence) || evidence.length === 0) problems.push("evidence must list at least one extractor");
  for (const name of evidence) if (!(name in EXTRACTORS)) problems.push(`unknown extractor "${name}"`);
  const passCommands = (front.pass_observations ?? []) as string[];
  if (!Array.isArray(passCommands)) problems.push("pass_observations must be a list of session commands");
  else for (const name of passCommands) if (OLD_NAMES.includes(name)) problems.push(`pass_observations: "${name}" is now called "${COMMAND_ALIASES[name]}"`);
    else if (!SHOWING_COMMANDS.includes(name)) problems.push(`pass_observations: "${name}" is not a look or measure command (${SHOWING_COMMANDS.join(", ")})`);
  const decisive = front.decisive === undefined ? null : (front.decisive as string[]);
  if (decisive !== null && !Array.isArray(decisive)) problems.push("decisive must be a list of session commands");
  else for (const name of decisive ?? []) if (!SHOWING_COMMANDS.includes(name)) problems.push(`decisive: "${name}" is not a look or measure command`);
  for (const section of REQUIRED_SECTIONS) if (!body.includes(`## ${section}`)) problems.push(`missing section "## ${section}"`);
  if (!/kan niet bepalen|cantTell/i.test(body.split("## Beslisregels")[1] ?? "")) problems.push('the decision rules must end in "kan niet bepalen"');
  if (problems.length > 0) throw new Error(problems.join("; "));
  return {
    id,
    version: front.version as number,
    class: front.class as ProcedureClass,
    evidence,
    inapplicableIfZero: (front.inapplicable_if_zero ?? []) as string[],
    limitsNl: (front.limits as string | undefined) ?? null,
    passCommands: Array.isArray(passCommands) ? passCommands : [],
    decisiveCommands: Array.isArray(decisive) ? decisive : Array.isArray(passCommands) ? passCommands : [],
    body,
    sha256: sha256(text),
  };
}

export function loadProcedure(id: string): Procedure {
  const path = join(PROCEDURES_DIR, `${id}.md`);
  if (!existsSync(path)) throw new Error(`no procedure for ${id}`);
  try {
    return parseProcedure(readFileSync(path, "utf8"), id);
  } catch (error) {
    throw new Error(`procedures/${id}.md: ${(error as Error).message}`);
  }
}

export function loadAllProcedures(): { procedures: Procedure[]; missing: string[]; invalid: string[] } {
  const procedures: Procedure[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const criterion of CRITERIA) {
    if (!existsSync(join(PROCEDURES_DIR, `${criterion.id}.md`))) missing.push(criterion.id);
    else {
      try {
        procedures.push(loadProcedure(criterion.id));
      } catch (error) {
        invalid.push((error as Error).message);
      }
    }
  }
  for (const file of readdirSync(PROCEDURES_DIR)) {
    if (file.endsWith(".md") && file !== "README.md" && !criterionById(file.slice(0, -3))) invalid.push(`procedures/${file}: not a criterion`);
  }
  return { procedures: procedures.sort((a, b) => compareCriterionIds(a.id, b.id)), missing, invalid };
}
