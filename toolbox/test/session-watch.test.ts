import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { login } from "../src/commands/login.ts";
import { readSessionWatch, SESSION_WATCH_STOP, startSessionWatch, stopSessionWatch, watchSession } from "../src/commands/watch-session.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE, setRunLogin } from "../src/lib/login.ts";
import { logInOn, ROLE, typeAccount } from "./fixtures/account-login.ts";

/**
 * The watch on the session (2.2.1), on the part of the test site behind the login with a session
 * of a few seconds. A "minute" of the watch lasts one second here, so the growing gaps take seconds.
 */

let fixture: FixtureServer;
let origin: string;
let scratch: string;
const SESSION_SECONDS = 8;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-watch-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log"), sessionSeconds: SESSION_SECONDS });
  origin = fixture.origins.clean;
});

after(async () => {
  setRunLogin(null);
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** A run with the login of the measurement and the second login of the watch. */
async function runWithTwoLogins(name: string, idle = true): Promise<string> {
  const run = join(scratch, name);
  await logInOn(origin, { run });
  if (idle) await login({ run, url: `${origin}/inloggen.html`, role: ROLE, headless: true, say: () => undefined, act: typeAccount, idle: true });
  return run;
}

test("a second login for the watch goes into its own file, readable for its owner only, and leaves the manifest alone", async () => {
  const run = await runWithTwoLogins("files");
  assert.ok(existsSync(join(run, LOGIN_SESSION_FILE)));
  assert.ok(existsSync(join(run, IDLE_SESSION_FILE)));
  assert.equal(statSync(join(run, IDLE_SESSION_FILE)).mode & 0o777, 0o600);
});

test("without a second login the watch does not run, and says why", async () => {
  const run = await runWithTwoLogins("without", false);
  const watch = startSessionWatch(run);
  assert.equal(watch?.status, "notRunning");
  assert.match(watch!.reasonNl!, /login --run <run> --idle/);
  assert.equal(startSessionWatch(join(scratch, "no-login")), null, "a run without a login has no watch");
});

test("a session that is left alone is seen to run out, with the quiet spell before it", { timeout: 120_000 }, async () => {
  const run = await runWithTwoLogins("expires");
  setRunLogin(run);
  const watch = await watchSession(run, { gapsMinutes: [2, 6], maxHours: 1, minuteMs: 1000, lookSeconds: 30 });
  assert.equal(watch.status, "expired", JSON.stringify(watch));
  assert.ok(watch.checks.length >= 2 && watch.checks.at(-1)!.alive === false);
  assert.ok(watch.longestQuietAliveMinutes !== null && watch.longestQuietAliveMinutes >= 2);
  assert.match(watch.expired!.reasonNl, /inlogpagina|wachtwoordveld/);
  assert.ok(watch.expired!.minutesAfterLogin! >= SESSION_SECONDS);
  assert.equal(watch.warning, null, "the test site warns nobody");
  assert.ok(watch.beforeExpiry && existsSync(join(run, watch.beforeExpiry)), "the tab as it was before the session ran out");
  // The session of the measurement was made earlier and ran out as well: the watch says so.
  assert.ok(watch.mainSessionExpiredAt, "the main session ran out too");
  assert.deepEqual(readSessionWatch(run)?.status, "expired");
  setRunLogin(null);
});

test("a watch that is stopped before the session runs out says how long it was left alone, and a second start does not start it again", { timeout: 120_000 }, async () => {
  const run = await runWithTwoLogins("stopped");
  setRunLogin(run);
  const watch = await watchSession(run, { gapsMinutes: [1], maxHours: 2.5 / 60, minuteMs: 1000, lookSeconds: 30 });
  assert.equal(watch.status, "stopped", JSON.stringify(watch));
  assert.match(watch.reasonNl!, /grens/);
  assert.ok(watch.checks.length >= 1 && watch.checks.every((check) => check.alive));
  assert.ok(watch.longestQuietAliveMinutes! >= 1);
  assert.equal(startSessionWatch(run)?.status, "stopped", "an outcome is kept: no second clock");
  assert.equal(stopSessionWatch(run)?.status, "stopped");
  assert.ok(existsSync(join(run, SESSION_WATCH_STOP)));
  setRunLogin(null);
});
