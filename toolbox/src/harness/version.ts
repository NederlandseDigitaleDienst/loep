import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  // A checkout with changes that are not committed has no commit that says what it is: the changes
  // themselves do, so their hash goes along. Two different sets of changes on one commit are two versions.
  const diff = git(repo, ["diff", "HEAD"]);
  return {
    plugin,
    describe: git(repo, ["describe", "--tags", "--always", "--dirty"]) ?? "onbekend",
    sha: git(repo, ["rev-parse", "HEAD"]) ?? "onbekend",
    changes: diff === null || diff === "" ? "" : createHash("sha256").update(diff).digest("hex").slice(0, 12),
  };
}

/**
 * Whether two versions are the same checkout. The commit and the changes on top of it decide; the
 * describe does not, because a tag set later on the same commit changes it without changing a line.
 */
export function sameVersion(a: Version, b: Version): boolean {
  // A version recorded before loep kept the changes has only the -dirty of describe to go on.
  const changes = (version: Version): string => version.changes ?? (version.describe.endsWith("-dirty") ? "onbekend" : "");
  return a.sha === b.sha && a.plugin === b.plugin && changes(a) === changes(b) && changes(a) !== "onbekend";
}

export function versionNl(version: Version): string {
  return `${version.plugin} (${version.describe}${version.changes ? `, wijzigingen ${version.changes}` : ""})`;
}
