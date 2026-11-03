import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { sweepAtOnce } from "../src/lib/atonce.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { parseNavigationDelay, recordNavigationDelay, runNavigationDelayMs, runPace } from "../src/lib/pace.ts";
import { DEFAULT_DAEMON_LIMITS } from "../src/session/safety.ts";

const newRun = (): string => mkdtempSync(join(tmpdir(), "loep-pace-"));

describe("a navigation delay for the whole run (#424)", () => {
  test("--navigation-delay is seconds, given back as milliseconds", () => {
    assert.equal(parseNavigationDelay("3"), 3000);
    assert.equal(parseNavigationDelay("2.5"), 2500);
    assert.equal(parseNavigationDelay("0"), 0);
    for (const wrong of ["", "-1", "drie", "601"]) assert.throws(() => parseNavigationDelay(wrong), /--navigation-delay/);
  });

  test("a run without the setting keeps the default pace", () => {
    const run = newRun();
    assert.equal(runNavigationDelayMs(run), null);
    assert.deepEqual(runPace(run), {});
    const settings = sweepAtOnce(run);
    assert.equal(settings.navigationDelayMs, DEFAULT_DAEMON_LIMITS.navigationDelayMs);
    assert.equal(settings.paced, undefined);
  });

  test("the setting is kept in the manifest, survives the next step and is taken away by an inventory without it", async () => {
    const run = newRun();
    await writeManifest(run, { command: "inventory" });
    await recordNavigationDelay(run, 4000);
    await writeManifest(run, { command: "explore" });
    assert.equal(runNavigationDelayMs(run), 4000);
    assert.deepEqual(runPace(run), { navigationDelayMs: 4000 });
    await recordNavigationDelay(run, null);
    assert.equal(runNavigationDelayMs(run), null);
    assert.equal("navigationDelayMs" in JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")), false);
  });

  test("the sweep takes the run's delay, also over a shorter one of a session process, so that even one page at a time is spaced", async () => {
    const run = newRun();
    await recordNavigationDelay(run, 3000);
    assert.deepEqual({ delay: sweepAtOnce(run).navigationDelayMs, paced: sweepAtOnce(run).paced }, { delay: 3000, paced: true });
    mkdirSync(join(run, "observations", "verken"), { recursive: true });
    writeFileSync(join(run, "observations", "verken", "session.json"), JSON.stringify({ session: "verken", startedAt: "2026-10-16T10:00:00.000Z", limits: { maxSessions: 4, navigationDelayMs: 1000 } }));
    assert.equal(sweepAtOnce(run).navigationDelayMs, 3000);
    writeFileSync(join(run, "observations", "verken", "session.json"), JSON.stringify({ session: "verken", startedAt: "2026-10-16T10:00:00.000Z", limits: { maxSessions: 4, navigationDelayMs: 5000 } }));
    assert.equal(sweepAtOnce(run).navigationDelayMs, 5000, "a slower session process stays slower");

  });
});
