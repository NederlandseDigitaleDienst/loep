import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Where lus keeps its things. The repository lus lives in is the one that matters: the skill, the
 * toolbox and the workflow of a run all come from this checkout, never from a global install. That is
 * why the paths below are derived from the location of this file and not from the working directory.
 *
 * LUS_HOME moves the backlog, the runs and the state of lus: the tests need that, and a second backlog
 * (a test site, a customer that keeps its own list) is a folder and not a flag.
 */

/** The checkout that holds the toolbox, the skill and lus. */
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const toolboxCli = join(repoRoot, "toolbox", "src", "cli.ts");
export const workflowFile = join(repoRoot, "skills", "nldd-a11y-audit", "onderzoek.workflow.js");
export const pluginFile = join(repoRoot, ".claude-plugin", "plugin.json");

/** The folder with the backlog, the runs per site and the state of lus. */
export function homeDir(): string {
  return join(process.env["LUS_HOME"] ?? join(homedir(), "onderzoeken"));
}

export const backlogPath = (): string => join(homeDir(), "backlog.yaml");
export const stateDir = (): string => join(homeDir(), ".lus");
export const reportsDir = (): string => join(homeDir(), "rapporten");
export const siteDir = (slug: string): string => join(stateDir(), slug);

/** A date as the run folders and the report names use it: 2026-11-23, in the time zone of the person. */
export function dateStamp(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Where the run of a site lives: one folder per site, one per day, nothing else. */
export const runDirFor = (slug: string, date: string = dateStamp()): string => join(homeDir(), slug, date);
