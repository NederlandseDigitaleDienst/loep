import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.ts";
import type { Version } from "./state.ts";

/*
 * Which checkout a run was started from. The skill, the toolbox and the workflow all come from one
 * folder, so a run that continues in a different checkout would mix two versions without anyone
 * noticing. The version is recorded at the start and compared at every resume.
 */

function git(repo: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function checkoutVersion(repo: string = repoRoot): Version {
  let plugin = "onbekend";
  try {
    const parsed = JSON.parse(readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string") plugin = parsed.version;
  } catch {
    // Without a plugin.json there is no plugin; doctor says so, and the run says "onbekend".
  }
  return { plugin, describe: git(repo, ["describe", "--tags", "--always", "--dirty"]) ?? "onbekend", sha: git(repo, ["rev-parse", "HEAD"]) ?? "onbekend" };
}

/** Whether two versions are the same checkout, in the words a person can check. */
export function sameVersion(a: Version, b: Version): boolean {
  return a.sha === b.sha && a.describe === b.describe && a.plugin === b.plugin;
}

export function versionNl(version: Version): string {
  return `${version.plugin} (${version.describe})`;
}
