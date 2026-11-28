import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Where loep keeps its things. The repository loep lives in is the one that matters: the skill, the
 * toolbox and the workflow of a run all come from this checkout, never from a global install. That is
 * why the paths below are derived from the location of this file and not from the working directory.
 *
 * LOEP_HOME moves the backlog, the runs and the state: the tests need that, and a second backlog (a test
 * site, a customer that keeps its own list) is a folder and not a flag.
 */

/** The checkout that holds the toolbox, the skill and loep, without a slash at the end. */
export const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
export const toolboxCli = join(repoRoot, "toolbox", "src", "cli.ts");

/*
 * A command of the toolbox as loep calls it: `cliArgs` for a process loep starts, `cliCall` for a line a
 * person copies. The layers (audit, dev) come from the toolbox, so a command loep names cannot drift
 * from the one the toolbox has.
 */
export { cliArgs, cliCall } from "../lib/commands.ts";
export const workflowFile = join(repoRoot, "skills", "nldd-a11y-audit", "onderzoek.workflow.js");
export const pluginFile = join(repoRoot, ".claude-plugin", "plugin.json");

/** The folder with the backlog, the runs per site and the state of loep. */
export function homeDir(): string {
  return join(process.env["LOEP_HOME"] ?? join(homedir(), "onderzoeken"));
}

export const backlogPath = (): string => join(homeDir(), "backlog.yaml");
export const stateDir = (): string => join(homeDir(), ".loep");
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
