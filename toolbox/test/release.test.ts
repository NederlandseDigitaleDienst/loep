import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FRAGMENTS, fragmentsIn, isNewer, KINDS, measurementGate, MEASUREMENTS, releaseChangelog, ROOT, sectionOf, START, takeUnreleased, TOWNCRIER, UNRELEASED, versionsIn } from "../scripts/release.ts";

// The report says which version of loep made it, and the marketplace hands out the plugin by its version.
// Both only mean something when every file says the same and the changelog says what that version is.
test("the toolbox and the three plugin manifests carry one version, and the changelog has a section for it", () => {
  const versions = versionsIn(ROOT);
  const version = versions["toolbox/package.json"]!;
  assert.deepEqual(new Set(Object.values(versions)), new Set([version]), `de versies verschillen: ${JSON.stringify(versions)}`);
  const lock = JSON.parse(readFileSync(join(ROOT, "toolbox/package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(lock.version, version);
  assert.equal(lock.packages[""]!.version, version);
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  assert.notEqual(sectionOf(changelog, UNRELEASED), null, `CHANGELOG.md heeft geen kop "${UNRELEASED}"`);
  assert.ok(sectionOf(changelog, `## ${version}`), `CHANGELOG.md heeft geen deel voor ${version}`);
});

test("a release is a later version", () => {
  assert.ok(isNewer("0.1.0", "0.0.1"));
  assert.ok(isNewer("0.10.0", "0.9.3"));
  assert.ok(!isNewer("0.1.0", "0.1.0"));
  assert.ok(!isNewer("0.0.9", "0.1.0"));
  assert.ok(!isNewer("1.0", "0.1.0"), "three numbers");
});

// Pull requests write what they change in changelog.d/, so that they do not all edit the same lines of
// CHANGELOG.md. towncrier puts the fragments in the new section at a release. Lines that pull requests
// from before still wrote under the unreleased heading have to come along under the same headings.

const VERSION = "## 0.1.0 (2026-10-14)\n\n- eerste\n";
const unreleased = (body: string): string => `# Wijzigingen\n\n${UNRELEASED}\n\n${START}\n\n${body}\n\n${VERSION}`;

test("the lines under the unreleased heading are taken out as entries under their heading, and only the start line stays", () => {
  const taken = takeUnreleased(unreleased(["Uitgebracht zonder meting.", "", "### Wat een uitkomst kan veranderen", "", "- uitkomst een", "  met een tweede regel", "- uitkomst twee", "", "### Verder", "", "- verder"].join("\n")));
  assert.equal(taken.preamble, "Uitgebracht zonder meting.");
  assert.deepEqual(taken.entries, [
    { kind: "uitkomst", text: "uitkomst een\nmet een tweede regel" },
    { kind: "uitkomst", text: "uitkomst twee" },
    { kind: "verder", text: "verder" },
  ]);
  assert.equal(taken.changelog, `# Wijzigingen\n\n${UNRELEASED}\n\n${START}\n\n${VERSION}`);
  assert.throws(() => takeUnreleased(unreleased("### Nieuw\n\n- iets")), /onbekende kop "Nieuw"/);
  assert.throws(() => takeUnreleased(`# Wijzigingen\n\n${UNRELEASED}\n\n- iets\n\n${VERSION}`), /niet de regel <!-- towncrier/);
});

/** A repository in a temporary directory with the towncrier.toml of loep, a changelog and fragments, all committed. */
function repository(changelog: string, fragments: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "loep-release-"));
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=loep", "-c", "user.email=loep@example.nl", ...args], { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  writeFileSync(join(root, "towncrier.toml"), readFileSync(join(ROOT, "towncrier.toml"), "utf8"));
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  mkdirSync(join(root, FRAGMENTS));
  writeFileSync(join(root, FRAGMENTS, "README.md"), "# Fragmenten\n");
  for (const [name, text] of Object.entries(fragments)) writeFileSync(join(root, FRAGMENTS, name), text);
  git("add", "--all");
  git("commit", "--quiet", "--message", "begin");
  return root;
}

test("a release puts the fragments and the lines under the unreleased heading under the right headings, and removes the fragments", () => {
  const lines = ["Uitgebracht zonder meting.", "", "### Wat een uitkomst kan veranderen", "", "- zo stond de eerste in de changelog", "- als tweede stond deze er", "  met een tweede regel", "", "### Verder", "", "- al in de changelog, verder"];
  const root = repository(unreleased(lines.join("\n")), {
    "12.verder.md": "Fragment verder.\n",
    "11.uitkomst.md": "Fragment uitkomst.\n",
    "+los.verder.md": "Fragment zonder issue.\n",
  });
  try {
    releaseChangelog(root, "0.2.0", "2026-11-01");
    const after = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const link = (issue: number): string => `([#${issue}](https://github.com/NederlandseDigitaleDienst/loep/issues/${issue}))`;
    // towncrier puts entries with an issue first, then those without. The lines from the changelog keep the order they stood in.
    const expected = [
      `# Wijzigingen`,
      ``,
      UNRELEASED,
      ``,
      START,
      ``,
      `## 0.2.0 (2026-11-01)`,
      ``,
      `Uitgebracht zonder meting.`,
      ``,
      `### ${KINDS.uitkomst}`,
      ``,
      `- Fragment uitkomst. ${link(11)}`,
      `- zo stond de eerste in de changelog`,
      `- als tweede stond deze er`,
      `  met een tweede regel`,
      ``,
      `### ${KINDS.verder}`,
      ``,
      `- Fragment verder. ${link(12)}`,
      `- al in de changelog, verder`,
      `- Fragment zonder issue.`,
      ``,
      VERSION,
    ].join("\n");
    assert.equal(after, expected);
    assert.deepEqual(fragmentsIn(root), [], "the fragments are gone");
    const staged = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    assert.match(staged, /^D {2}changelog\.d\/11\.uitkomst\.md$/m, "the removal of the fragments is staged for the release commit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Every minor version can change an outcome, so none goes out unmeasured without saying so.
test("a release needs a measurement of the version that evaluate accepts, or a reason why there is none", () => {
  const root = mkdtempSync(join(tmpdir(), "loep-release-gate-"));
  const file = join(root, MEASUREMENTS, "0.2.0.json");
  try {
    assert.throws(() => measurementGate(root, "0.2.0", undefined), /validatie\/versies\/0\.2\.0\.json ontbreekt\. Meet de versie eerst .* --unmeasured "<reden>"/);
    assert.equal(measurementGate(root, "0.2.0", "alleen een herstel in de documentatie"), "Deze versie is uitgebracht zonder meting: alleen een herstel in de documentatie.");
    assert.equal(measurementGate(root, "0.2.0", " geen testsite beschikbaar! "), "Deze versie is uitgebracht zonder meting: geen testsite beschikbaar!");
    assert.throws(() => measurementGate(root, "0.2.0", "  "), /--unmeasured vraagt een reden/);
    // A file that evaluate would refuse is no measurement either.
    mkdirSync(join(root, MEASUREMENTS), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: "0.1.0", measuredAt: "2026-10-25", againstNl: "de sleutel van de testsite", resultNl: "Alle gebreken gevonden, geen onterechte meldingen." }));
    assert.throws(() => measurementGate(root, "0.2.0", undefined), /0\.2\.0\.json: version must be "0\.2\.0"/);
    writeFileSync(file, "{");
    assert.throws(() => measurementGate(root, "0.2.0", undefined), /0\.2\.0\.json is geen JSON/);
    // A measurement lets the release through, and a reason for none next to it is a contradiction.
    writeFileSync(file, JSON.stringify({ version: "0.2.0", measuredAt: "2026-10-25", againstNl: "de sleutel van de testsite", resultNl: "Alle gebreken gevonden, geen onterechte meldingen." }));
    assert.equal(measurementGate(root, "0.2.0", undefined), null);
    assert.throws(() => measurementGate(root, "0.2.0", "toch niet"), /laat --unmeasured weg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a release without a measurement says so first in its section, before the text that stood above the headings", () => {
  const root = repository(unreleased("Een regel boven de koppen.\n\n### Verder\n\n- iets"), {});
  try {
    releaseChangelog(root, "0.2.0", "2026-11-01", "Deze versie is uitgebracht zonder meting: alleen een herstel.");
    assert.equal(sectionOf(readFileSync(join(root, "CHANGELOG.md"), "utf8"), "## 0.2.0"), `Deze versie is uitgebracht zonder meting: alleen een herstel.\n\nEen regel boven de koppen.\n\n### ${KINDS.verder}\n\n- iets`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fragment of an unknown kind stops the release, and nothing changes", () => {
  const before = unreleased("### Verder\n\n- al in de changelog");
  const root = repository(before, { "12.verder.md": "Goed.\n", "13.nieuw.md": "Onbekende soort.\n" });
  try {
    assert.throws(() => releaseChangelog(root, "0.2.0", "2026-11-01"), /towncrier kon de versie niet maken: [^]*13\.nieuw\.md/);
    assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
    assert.deepEqual(readdirSync(join(root, FRAGMENTS)).sort(), ["12.verder.md", "13.nieuw.md", "README.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a release with nothing under the unreleased heading and no fragments stops", () => {
  const root = repository(unreleased(""), {});
  try {
    assert.throws(() => releaseChangelog(root, "0.2.0", "2026-11-01"), /staat niets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A wrong fragment would otherwise only show at the release; this shows it in the pull request that adds it.
test("towncrier.toml, the code and the descriptions agree, and every fragment in changelog.d has a known kind", () => {
  const config = readFileSync(join(ROOT, "towncrier.toml"), "utf8");
  const types = [...config.matchAll(/directory = "([a-z]+)"\nname = "([^"]+)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(types, Object.entries(KINDS), "towncrier.toml noemt andere soorten dan KINDS in release.ts");
  assert.ok(config.includes(`start_string = "${START}\\n"`), "towncrier.toml heeft een andere start_string dan START in release.ts");
  for (const file of ["CONTRIBUTING.md", `${FRAGMENTS}/README.md`]) assert.ok(readFileSync(join(ROOT, file), "utf8").includes(`uvx ${TOWNCRIER} create`), `${file} noemt niet "uvx ${TOWNCRIER} create"`);
  for (const name of fragmentsIn(ROOT)) assert.match(name, new RegExp(`^(\\d+|\\+[\\w-]+)\\.(${Object.keys(KINDS).join("|")})\\.md$`), `${FRAGMENTS}/${name} heet niet <issue>.<soort>.md`);
});
