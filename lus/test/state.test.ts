import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireLock, isGone, readLock, readState, releaseLock, siteState, updateSite } from "../src/state.ts";

const stateFile = (): string => join(mkdtempSync(join(tmpdir(), "lus-state-")), "state.json");
const lockFile = (): string => join(mkdtempSync(join(tmpdir(), "lus-lock-")), "run.lock");

test("een site die nog niets deed staat op nieuw", () => {
  const state = readState(stateFile());
  const site = siteState(state, "voorbeeld.nl");
  assert.equal(site.phase, "nieuw");
  assert.equal(site.run, null);
  assert.equal(site.question, null);
});

test("updateSite houdt wat er al stond en zet de tijd", () => {
  const path = stateFile();
  updateSite(path, "voorbeeld.nl", { phase: "loopt", step: "gate" });
  const later = updateSite(path, "voorbeeld.nl", { step: "Workflow stap 6" });
  assert.equal(later.phase, "loopt");
  assert.equal(later.step, "Workflow stap 6");
  assert.notEqual(later.updatedAt, "");
  assert.equal(readState(path).sites["voorbeeld.nl"]?.phase, "loopt");
});

test("een vraag aan een mens staat in de state, met het commando erbij", () => {
  const path = stateFile();
  updateSite(path, "voorbeeld.nl", { phase: "vraagt", question: { textNl: "hoort docs.example.org erbij?", command: "lus answer voorbeeld.nl" } });
  assert.equal(readState(path).sites["voorbeeld.nl"]?.question?.command, "lus answer voorbeeld.nl");
});

test("een state die niet leest kost een regel, geen run", () => {
  const path = stateFile();
  updateSite(path, "voorbeeld.nl", { phase: "loopt" });
  writeFileSync(path, "{niet json");
  assert.deepEqual(readState(path).sites, {});
});

test("een run waarvan het proces weg is leest niet als lopend", () => {
  const gone = siteState(readState(stateFile()), "voorbeeld.nl");
  assert.equal(isGone(gone), false, "een site die nog niet begon is niet weg");
  assert.equal(isGone({ ...gone, phase: "loopt", pid: 999_999 }), true);
  assert.equal(isGone({ ...gone, phase: "loopt", pid: process.pid }), false);
  assert.equal(isGone({ ...gone, phase: "loopt", pid: null }), true);
  assert.equal(isGone({ ...gone, phase: "vraagt", pid: 999_999 }), false);
});

test("de loper pakt het slot en laat het weer los", () => {
  const path = lockFile();
  const taken = acquireLock(path, "voorbeeld.nl");
  assert.equal(taken.ok, true);
  assert.equal(readLock(path)?.slug, "voorbeeld.nl");
  assert.equal(readLock(path)?.pid, process.pid);
  releaseLock(path);
  assert.equal(readLock(path), null);
});

test("een slot van een levend proces op deze machine houdt de loper tegen", () => {
  const path = lockFile();
  writeFileSync(path, JSON.stringify({ pid: process.ppid, host: hostname(), since: new Date().toISOString(), slug: "voorbeeld.nl" }));
  const result = acquireLock(path, "voorbeeld.nl");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.lock.slug, "voorbeeld.nl");
});

test("een slot van een proces dat weg is wordt overgenomen", () => {
  const path = lockFile();
  writeFileSync(path, JSON.stringify({ pid: 999_999, host: hostname(), since: new Date().toISOString(), slug: "voorbeeld.nl" }));
  const result = acquireLock(path, "voorbeeld.nl");
  assert.equal(result.ok, true);
  assert.equal(readLock(path)?.pid, process.pid);
});
