/**
 * Release loep in two halves, because main only takes changes through a pull request.
 *
 *   node scripts/release.ts prepare <version>   on a branch: set the version everywhere and close the changelog section
 *   node scripts/release.ts tag                 on main, after the merge: tag, push the tag, publish the release on GitHub
 *
 * One version holds for the toolbox and for the plugin, because the plugin is the whole repository.
 * What a minor or a patch release means is in CONTRIBUTING.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every file that carries the version, relative to the root of the repository. */
export const VERSION_FILES = ["toolbox/package.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".plugin/plugin.json"];
const LOCKFILE = "toolbox/package-lock.json";
const CHANGELOG = "CHANGELOG.md";
export const UNRELEASED = "## Nog niet uitgebracht";

const readJson = (root: string, file: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;

/** The version in each file that carries one. */
export function versionsIn(root: string): Record<string, string> {
  return Object.fromEntries(VERSION_FILES.map((file) => [file, String(readJson(root, file).version)]));
}

const parse = (version: string): number[] | null => (/^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : null);

/** Whether `next` is a version after `current`. */
export function isNewer(next: string, current: string): boolean {
  const [a, b] = [parse(next), parse(current)];
  if (!a || !b) return false;
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]!;
  return false;
}

/** The text under a heading of the changelog, without the heading; null when the heading is not there. */
export function sectionOf(changelog: string, heading: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} (`));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

/** The changelog with the unreleased section closed as `version` and a new, empty unreleased section above it. */
export function closeChangelog(changelog: string, version: string, date: string): string {
  const unreleased = sectionOf(changelog, UNRELEASED);
  if (unreleased === null) throw new Error(`${CHANGELOG} heeft geen kop "${UNRELEASED}"`);
  if (unreleased === "") throw new Error(`onder "${UNRELEASED}" in ${CHANGELOG} staat niets: schrijf eerst wat er in deze versie verandert`);
  return changelog.replace(`${UNRELEASED}\n`, `${UNRELEASED}\n\n## ${version} (${date})\n`);
}

const git = (...args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function prepare(version: string): void {
  const current = versionsIn(ROOT)["toolbox/package.json"]!;
  if (!isNewer(version, current)) throw new Error(`${version} is geen versie na ${current}; schrijf drie getallen, zoals 0.2.0`);
  if (git("status", "--porcelain") !== "") throw new Error("er staan wijzigingen die niet zijn vastgelegd; leg die eerst vast of zet ze opzij");
  const changelog = readFileSync(join(ROOT, CHANGELOG), "utf8");
  writeFileSync(join(ROOT, CHANGELOG), closeChangelog(changelog, version, new Date().toISOString().slice(0, 10)));
  for (const file of VERSION_FILES) {
    const text = readFileSync(join(ROOT, file), "utf8");
    writeFileSync(join(ROOT, file), text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
  }
  // The lockfile names the version of the package itself twice: at the top and under the empty path.
  const lock = readJson(ROOT, LOCKFILE) as { version: string; packages: Record<string, { version?: string }> };
  lock.version = version;
  lock.packages[""]!.version = version;
  writeFileSync(join(ROOT, LOCKFILE), `${JSON.stringify(lock, null, 2)}\n`);
  git("add", CHANGELOG, LOCKFILE, ...VERSION_FILES);
  git("commit", "-m", `release: ${version}`);
  console.log(`Versie ${version} staat in ${VERSION_FILES.length} bestanden en in ${CHANGELOG}, vastgelegd als commit. Open een voorstel naar main; na de merge: just release-tag`);
}

function tag(): void {
  const versions = versionsIn(ROOT);
  const version = versions["toolbox/package.json"]!;
  const differing = Object.entries(versions).filter(([, value]) => value !== version);
  if (differing.length > 0) throw new Error(`de versies verschillen: ${Object.entries(versions).map(([file, value]) => `${file} ${value}`).join(", ")}`);
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("een release komt van main; ga naar main en haal de laatste stand op");
  if (git("status", "--porcelain") !== "") throw new Error("er staan wijzigingen die niet zijn vastgelegd");
  git("fetch", "--quiet", "origin", "main", "--tags");
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) throw new Error("main hier is niet gelijk aan main op GitHub; haal eerst de laatste stand op");
  const name = `v${version}`;
  if (git("tag", "--list", name) !== "") throw new Error(`${name} bestaat al; is de versie wel opgehoogd met just release-prepare?`);
  const notes = sectionOf(readFileSync(join(ROOT, CHANGELOG), "utf8"), `## ${version}`);
  if (!notes) throw new Error(`${CHANGELOG} heeft geen deel voor ${version}`);
  git("tag", "--annotate", name, "--message", `loep ${version}`);
  git("push", "origin", name);
  execFileSync("gh", ["release", "create", name, "--title", `loep ${version}`, "--notes", notes, "--verify-tag"], { cwd: ROOT, stdio: "inherit" });
  console.log(`${name} staat op GitHub. Zet in de marketplace (NederlandseDigitaleDienst/ai-plugins) bij nldd-a11y "ref": "${name}"; zie docs/plugin.md.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, version] = process.argv.slice(2);
  try {
    if (action === "prepare" && version) prepare(version);
    else if (action === "tag") tag();
    else throw new Error("gebruik: release.ts prepare <versie> | release.ts tag");
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
