/**
 * Release loep in two halves, because main only takes changes through a pull request.
 *
 *   node scripts/release.ts prepare <version>   on a branch: set the version everywhere and close the changelog section
 *   node scripts/release.ts tag                 on main, after the merge: tag, push the tag, publish the release on GitHub
 *
 * One version holds for the toolbox and for the plugin, because the plugin is the whole repository.
 * What a minor or a patch release means is in CONTRIBUTING.md.
 *
 * A pull request writes what it changes in a fragment under changelog.d/ rather than in CHANGELOG.md,
 * so that open pull requests do not all edit the same lines. `prepare` has towncrier (configured in
 * towncrier.toml) put the fragments in the new section and delete them. Lines that still stand under
 * the unreleased heading of CHANGELOG.md come along: they become fragments just before towncrier runs.
 *
 * Every version is measured before it is released: `prepare` refuses without a measurement in
 * validatie/versies/<version>.json that evaluate accepts, unless `--unmeasured "<reason>"` says why
 * not. That reason then stands at the top of the section of the changelog.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { versionAccuracyProblems } from "../src/lib/evaluation.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every file that carries the version, relative to the root of the repository. */
export const VERSION_FILES = ["toolbox/package.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".plugin/plugin.json"];
const LOCKFILE = "toolbox/package-lock.json";
const CHANGELOG = "CHANGELOG.md";
export const UNRELEASED = "## Nog niet uitgebracht";
/** The directory of the fragments, relative to the root of the repository. */
export const FRAGMENTS = "changelog.d";
/** towncrier, pinned, as uvx runs it. CONTRIBUTING.md and changelog.d/README.md name the same version. */
export const TOWNCRIER = "towncrier@26.9.0";
/** The line in CHANGELOG.md under which towncrier writes a new version; `start_string` in towncrier.toml. */
export const START = "<!-- towncrier: een nieuwe versie komt hieronder -->";
/** The kinds of fragment and the heading each goes under, in the order of towncrier.toml. */
export const KINDS: Record<string, string> = { uitkomst: "Wat een uitkomst kan veranderen", verder: "Verder" };
/** Where the measurement of each version as a whole is kept, relative to the root of the repository; evaluate reads the same file. */
export const MEASUREMENTS = "validatie/versies";

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

/** One line of the changelog that has to become a fragment: its kind and its text without the leading "- ". */
export interface Entry {
  kind: string;
  text: string;
}

/**
 * The lines under the unreleased heading taken out of the changelog: the changelog with only the start line
 * left under that heading, the text above the first `###` heading, and every point under a heading.
 */
export function takeUnreleased(changelog: string): { changelog: string; preamble: string; entries: Entry[] } {
  const lines = changelog.split("\n");
  const start = lines.indexOf(UNRELEASED);
  if (start === -1) throw new Error(`${CHANGELOG} heeft geen kop "${UNRELEASED}"`);
  const found = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const end = found === -1 ? lines.length : found;
  const section = lines.slice(start + 1, end);
  if (!section.includes(START)) throw new Error(`${CHANGELOG} heeft onder "${UNRELEASED}" niet de regel ${START}; towncrier schrijft een nieuwe versie daaronder`);
  const preamble: string[] = [];
  const entries: { kind: string; lines: string[] }[] = [];
  let kind: string | null = null;
  let current: string[] | null = null;
  for (const line of section) {
    if (line === START) continue;
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      kind = Object.keys(KINDS).find((key) => KINDS[key] === heading) ?? null;
      if (kind === null) throw new Error(`onbekende kop "${heading}" onder "${UNRELEASED}" in ${CHANGELOG}; kies uit ${Object.values(KINDS).map((name) => `"${name}"`).join(" en ")}`);
      current = null;
    } else if (kind === null) preamble.push(line);
    else if (line.startsWith("- ")) {
      current = [line.slice(2)];
      entries.push({ kind, lines: current });
    } else if (current) current.push(line.replace(/^ {2}/, ""));
    else if (line.trim() !== "") throw new Error(`onder "### ${KINDS[kind]}" in ${CHANGELOG} staat tekst die geen punt is: "${line.trim()}"`);
  }
  const rest = found === -1 ? [] : lines.slice(end);
  return {
    changelog: [...lines.slice(0, start), UNRELEASED, "", START, "", ...rest].join("\n"),
    preamble: preamble.join("\n").trim(),
    entries: entries.map((entry) => ({ kind: entry.kind, text: entry.lines.join("\n").trim() })),
  };
}

/** The fragments in `root`/changelog.d. The README there explains them and is no fragment; towncrier.toml ignores it too. */
export function fragmentsIn(root: string): string[] {
  return readdirSync(join(root, FRAGMENTS)).filter((name) => name !== "README.md").sort();
}

/**
 * Whether `version` may be released: with a measurement in validatie/versies/<version>.json that
 * evaluate accepts, or without one for a reason that is given. The line the section of the changelog
 * opens with for a release without a measurement; null for one with.
 */
export function measurementGate(root: string, version: string, unmeasured: string | undefined): string | null {
  const file = `${MEASUREMENTS}/${version}.json`;
  let problems: string[];
  if (!existsSync(join(root, file))) problems = [`${file} ontbreekt`];
  else {
    try {
      problems = versionAccuracyProblems(JSON.parse(readFileSync(join(root, file), "utf8")), version).map((problem) => `${file}: ${problem}`);
    } catch (error) {
      problems = [`${file} is geen JSON: ${(error as Error).message}`];
    }
  }
  if (problems.length === 0) {
    if (unmeasured !== undefined) throw new Error(`${file} legt een meting van deze versie vast; laat --unmeasured weg`);
    return null;
  }
  if (unmeasured === undefined) throw new Error(`${problems.join("; ")}. Meet de versie eerst en leg de uitkomst vast in ${file} (zie validatie/README.md), of breng haar uit met --unmeasured "<reden>"; die reden komt in ${CHANGELOG}`);
  const reason = unmeasured.trim();
  if (reason === "") throw new Error('--unmeasured vraagt een reden, zoals --unmeasured "alleen een herstel in de documentatie"');
  return `Deze versie is uitgebracht zonder meting: ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`;
}

const ORDER_MARKER = (number: string): string => `<!-- nog niet uitgebracht ${number} -->`;

/**
 * Close the changelog in `root` as `version`: the fragments and the lines under the unreleased heading go
 * into a new section, the fragments are deleted and their removal staged. Nothing changes when towncrier refuses,
 * for example over a fragment of an unknown kind.
 */
export function releaseChangelog(root: string, version: string, date: string, unmeasuredNl: string | null = null): void {
  const path = join(root, CHANGELOG);
  const original = readFileSync(path, "utf8");
  const { changelog, preamble, entries } = takeUnreleased(original);
  if (entries.length === 0 && fragmentsIn(root).length === 0) throw new Error(`onder "${UNRELEASED}" in ${CHANGELOG} en in ${FRAGMENTS}/ staat niets: schrijf eerst wat er in deze versie verandert`);
  // A name with "+" is a fragment without an issue. towncrier sorts those by their text, so each starts
  // with a numbered marker that keeps the lines in the order they stood; the marker goes after the build.
  const written = entries.map((entry, index) => {
    const number = String(index + 1).padStart(4, "0");
    const name = `+nog-niet-uitgebracht-${number}.${entry.kind}.md`;
    writeFileSync(join(root, FRAGMENTS, name), `${ORDER_MARKER(number)}${entry.text}\n`);
    return name;
  });
  writeFileSync(path, changelog);
  try {
    execFileSync("uvx", [TOWNCRIER, "build", "--yes", "--version", version, "--date", date], { cwd: root, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    writeFileSync(path, original);
    for (const name of written) rmSync(join(root, FRAGMENTS, name), { force: true });
    const output = [(error as { stdout?: string }).stdout, (error as { stderr?: string }).stderr].filter(Boolean).join("\n").trim();
    throw new Error(`towncrier kon de versie niet maken: ${output || (error as Error).message}`);
  }
  const title = `## ${version} (${date})\n`;
  // towncrier leaves two empty lines after a version; the rest of the changelog has one.
  let built = readFileSync(path, "utf8").replace(/\n{3,}(?=## )/g, "\n\n").replace(new RegExp(`^- ${ORDER_MARKER("\\d{4}")}`, "gm"), "- ");
  const opening = [unmeasuredNl, preamble].filter(Boolean).join("\n\n");
  if (opening) built = built.replace(title, `${title}\n${opening}\n`);
  writeFileSync(path, built);
}

const git = (...args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function prepare(version: string, unmeasured: string | undefined): void {
  const current = versionsIn(ROOT)["toolbox/package.json"]!;
  if (!isNewer(version, current)) throw new Error(`${version} is geen versie na ${current}; schrijf drie getallen, zoals 0.2.0`);
  if (git("status", "--porcelain") !== "") throw new Error("er staan wijzigingen die niet zijn vastgelegd; leg die eerst vast of zet ze opzij");
  const unmeasuredNl = measurementGate(ROOT, version, unmeasured);
  const fragments = fragmentsIn(ROOT).length;
  releaseChangelog(ROOT, version, new Date().toISOString().slice(0, 10), unmeasuredNl);
  for (const file of VERSION_FILES) {
    const text = readFileSync(join(ROOT, file), "utf8");
    writeFileSync(join(ROOT, file), text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
  }
  // The lockfile names the version of the package itself twice: at the top and under the empty path.
  const lock = readJson(ROOT, LOCKFILE) as { version: string; packages: Record<string, { version?: string }> };
  lock.version = version;
  lock.packages[""]!.version = version;
  writeFileSync(join(ROOT, LOCKFILE), `${JSON.stringify(lock, null, 2)}\n`);
  // towncrier has staged the removal of the fragments, so they leave in this commit and none is released twice.
  git("add", "--", CHANGELOG, LOCKFILE, ...VERSION_FILES);
  git("commit", "-m", `release: ${version}`);
  console.log(`Versie ${version} staat in ${VERSION_FILES.length} bestanden en in ${CHANGELOG}, met ${fragments} fragment(en) uit ${FRAGMENTS}/, vastgelegd als commit. Open een voorstel naar main; na de merge: just release-tag`);
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
  try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), options: { unmeasured: { type: "string" } }, allowPositionals: true });
    const [action, version] = positionals;
    if (action === "prepare" && version && positionals.length === 2) prepare(version, values.unmeasured);
    else if (action === "tag" && positionals.length === 1 && values.unmeasured === undefined) tag();
    else throw new Error('gebruik: release.ts prepare <versie> [--unmeasured "<reden>"] | release.ts tag');
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
