/**
 * `quick` with a real browser on the testsite: the variant with defects against the clean twin.
 * The other tests of `quick` use a loep that only answers. This one fails when a session command
 * changes what it records and a probe of `quick` no longer reads it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { quick } from "../src/commands/quick.ts";
import { pagePath, type QuickProbe, type QuickSummary } from "../src/lib/quick.ts";

const dir = mkdtempSync(join(tmpdir(), "loep-quick-site-"));
const PATHS = ["/", "/contact.html", "/nieuws/"];
let fixture: FixtureServer;

before(async () => {
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(dir, "server.log") });
});

after(async () => {
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

const measure = (site: "defect" | "clean", baseline?: string) => {
  const urls = join(dir, `${site}.txt`);
  writeFileSync(urls, PATHS.map((path) => `${fixture.origins[site]}${path}\n`).join(""));
  return quick({ url: `${fixture.origins[site]}/`, run: join(dir, site), maxPages: PATHS.length, urlsFile: urls, baseline, say: () => undefined });
};

/** The paths on which a probe saw something. */
const seenOn = (summary: QuickSummary, probe: QuickProbe): string[] => summary.pages.filter((page) => page.probes.some((seen) => seen.probe === probe)).map((page) => pagePath(page.url));

test("quick on the testsite: the probes are silent on the clean twin and the comparison catches the variant with defects", { timeout: 600_000 }, async () => {
  const clean = await measure("clean");
  assert.deepEqual(clean.summary.pages.map((page) => [pagePath(page.url), page.measured]), PATHS.map((path) => [path, true]));
  assert.equal(clean.summary.partial, false);
  assert.deepEqual(clean.summary.engines.map((engine) => engine.id), ["alfa", "axe-core", "ibm", "qualweb"]);
  // A probe that reports on a page where nothing is wrong would stop every release.
  for (const probe of ["autoplay", "tabindex", "spacing", "focus-invisible", "focus-thrown", "order"] as const) assert.deepEqual(seenOn(clean.summary, probe), [], `${probe} op de schone tweeling`);
  assert.deepEqual(clean.summary.signals.filter((signal) => signal.ground === "engines-agree"), []);

  const defect = await measure("defect", join(dir, "clean", "quick", "summary.json"));
  // Each probe finds the defect built in for it: a session command that records it otherwise shows here.
  assert.deepEqual(seenOn(defect.summary, "autoplay"), ["/"]);
  assert.deepEqual(seenOn(defect.summary, "spacing"), ["/"]);
  assert.deepEqual(seenOn(defect.summary, "tabindex"), ["/contact.html"]);
  assert.deepEqual(seenOn(defect.summary, "order"), ["/nieuws/"]);
  assert.deepEqual(seenOn(defect.summary, "focus-invisible"), PATHS);
  assert.deepEqual(seenOn(defect.summary, "focus-thrown"), PATHS);
  assert.deepEqual(defect.summary.covering.layers, ["#cookiemelding"]);
  const agreed = defect.summary.signals.filter((signal) => signal.ground === "engines-agree").map((signal) => signal.criterion);
  for (const criterion of ["1.4.3", "2.4.4", "4.1.2"]) assert.ok(agreed.includes(criterion), `${criterion} bij de regelsets die het eens zijn: ${agreed.join(", ")}`);

  assert.equal(defect.comparison!.ok, false);
  const worse = new Set(defect.comparison!.worse.map((change) => `${change.path} ${change.criterion}`));
  for (const expected of ["/ 1.4.2", "/ 1.4.3", "/ 1.4.10", "/ 1.4.12", "/ 2.4.4", "/ 2.4.7", "/ 3.2.1", "/contact.html 2.4.3", "/nieuws/ 1.3.2"]) assert.ok(worse.has(expected), `${expected} hoort slechter te zijn`);
  assert.deepEqual([defect.comparison!.notMeasured, defect.comparison!.newPages], [[], []]);

  // Nothing was sent to either site.
  assert.deepEqual(fixture.writes(), []);
});
