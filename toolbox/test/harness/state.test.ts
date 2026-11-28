import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireLock, isGone, readLock, readState, regieRuns, releaseLock, siteState, standNl, updateSite } from "../../src/harness/state.ts";

const stateFile = (): string => join(mkdtempSync(join(tmpdir(), "backlog-state-")), "state.json");
const lockFile = (): string => join(mkdtempSync(join(tmpdir(), "backlog-lock-")), "run.lock");

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
  updateSite(path, "voorbeeld.nl", { phase: "vraagt", question: { textNl: "hoort docs.example.org erbij?", command: "loep audit answer voorbeeld.nl" } });
  assert.equal(readState(path).sites["voorbeeld.nl"]?.question?.command, "loep audit answer voorbeeld.nl");
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

test("een regie die loep overleeft telt als lopend werk", () => {
  // Een kill -9 op loep laat de regie doorlopen; de state mag dat niet als stilstand lezen.
  const gone = siteState(readState(stateFile()), "voorbeeld.nl");
  const now = new Date().toISOString();
  const zonderLoep = { ...gone, phase: "loopt" as const, pid: 999_999 };
  assert.equal(regieRuns({ ...zonderLoep, regiePid: null, regieSince: null }), false);
  assert.equal(regieRuns({ ...zonderLoep, regiePid: 999_999, regieSince: now }), false, "een proces dat weg is, is de regie niet");
  assert.equal(regieRuns({ ...zonderLoep, regiePid: process.pid, regieSince: now }), true);
  // Een pid die intussen bij een ander proces hoort, begon later dan de regie: dat is de regie niet.
  assert.equal(regieRuns({ ...zonderLoep, regiePid: process.pid, regieSince: "2000-01-01T00:00:00Z" }), false);
  assert.equal(standNl({ ...zonderLoep, regiePid: process.pid, regieSince: now }), "loopt zonder loep");
  assert.equal(standNl({ ...zonderLoep, regiePid: null, regieSince: null }), "proces weg");
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

test("een slot met een pid die intussen bij een ander proces hoort, wordt overgenomen", () => {
  // Na een herstart komt het nummer terug voor een ander proces; dat proces begon na het slot.
  const path = lockFile();
  writeFileSync(path, JSON.stringify({ pid: process.ppid, host: hostname(), since: "2000-01-01T00:00:00.000Z", slug: "voorbeeld.nl" }));
  const result = acquireLock(path, "voorbeeld.nl");
  assert.equal(result.ok, true);
  assert.equal(readLock(path)?.pid, process.pid);
  assert.equal(isGone({ ...siteState(readState(stateFile()), "x"), phase: "loopt", pid: process.ppid, updatedAt: "2000-01-01T00:00:00.000Z" }), true);
});

test("een slot van een levend proces houdt de loper tegen, ook als de hostnaam intussen anders is", () => {
  // macOS verandert de hostnaam met het netwerk; dezelfde run loopt dan nog steeds.
  const path = lockFile();
  writeFileSync(path, JSON.stringify({ pid: process.ppid, host: "andere-naam.local", since: new Date().toISOString(), slug: null }));
  assert.equal(acquireLock(path, null).ok, false);
});

test("een slot dat niet leest, is van een proces dat halverwege het schrijven stopte en wordt overgenomen", () => {
  const path = lockFile();
  writeFileSync(path, "");
  assert.equal(acquireLock(path, null).ok, true);
  assert.equal(readLock(path)?.pid, process.pid);
});
