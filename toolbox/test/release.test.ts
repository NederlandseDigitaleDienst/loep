import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { closeChangelog, isNewer, ROOT, sectionOf, UNRELEASED, versionsIn } from "../scripts/release.ts";

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

test("a release is a later version, and closing the changelog keeps an empty section for what comes next", () => {
  assert.ok(isNewer("0.1.0", "0.0.1"));
  assert.ok(isNewer("0.10.0", "0.9.3"));
  assert.ok(!isNewer("0.1.0", "0.1.0"));
  assert.ok(!isNewer("0.0.9", "0.1.0"));
  assert.ok(!isNewer("1.0", "0.1.0"), "three numbers");
  const before = `# Wijzigingen\n\n${UNRELEASED}\n\n- iets nieuws\n\n## 0.1.0 (2026-10-14)\n\n- eerste\n`;
  const after = closeChangelog(before, "0.2.0", "2026-11-01");
  assert.equal(sectionOf(after, UNRELEASED), "");
  assert.equal(sectionOf(after, "## 0.2.0"), "- iets nieuws");
  assert.equal(sectionOf(after, "## 0.1.0"), "- eerste");
  assert.throws(() => closeChangelog(after, "0.3.0", "2026-12-01"), /staat niets/);
});
