import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loginRefusalNl } from "../src/lib/login.ts";
import { notSentPointProblems } from "../src/lib/verdict.ts";
import {
  confirmDeclaration,
  decideWrites,
  grantsOf,
  isWriteOrigin,
  raiseWrites,
  recordWrites,
  writeAccess,
  writeBudget,
  writeBudgets,
  writeOriginsOf,
  writesAfterRaises,
  writesAllowedNl,
  writesForRun,
  type PassedWrite,
  type WritePermission,
} from "../src/lib/writes.ts";

const SITE = "http://127.0.0.1:4710";
const CHAT = "https://chat.example.nl";
const now = new Date("2026-01-02T03:04:05Z");
const both = (extra: { maxWrites?: string } = {}): WritePermission => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: `${CHAT}/venster`, declaredBy: "Een Beheerder, beheer", ...extra }, now)!;

const withRun = async (work: (dir: string) => Promise<void> | void): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "loep-write-grants-"));
  try {
    await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("a site on this machine and a declared chat go in one run, each with the rules of its own kind", async () => {
  const permission = both({ maxWrites: "3" });
  assert.deepEqual(permission, {
    origin: SITE,
    local: true,
    declaredBy: null,
    declaredAt: "2026-01-02T03:04:05.000Z",
    maxWrites: 50,
    spacingSeconds: 0,
    alsoGrants: [{ origin: CHAT, local: false, declaredBy: { name: "Een Beheerder", role: "beheer" }, declaredAt: "2026-01-02T03:04:05.000Z", maxWrites: 3, spacingSeconds: 120 }],
  });
  assert.deepEqual(writeOriginsOf(permission), [SITE, CHAT]);
  assert.equal(writesAllowedNl(permission), `onderzocht op een testomgeving waar versturen is toegestaan: ${SITE} (lokaal adres); ${CHAT}, verklaard door iemand met de functie beheer (de naam staat in het dossier van het onderzoek, niet in dit rapport)`);
  assert.ok(!writesAllowedNl(permission).includes("Een Beheerder"));

  // Only the declared origin is typed over, and only at a terminal.
  const asked: string[] = [];
  const confirmed = await confirmDeclaration(permission, { interactive: true, ask: async (question) => (asked.push(question), CHAT) });
  assert.equal(asked.length, 1);
  assert.equal(confirmed.recordedVia, undefined, "the local grant is no declaration");
  assert.equal(confirmed.alsoGrants![0]!.recordedVia, "terminal");
  await assert.rejects(confirmDeclaration(permission, { interactive: false, ask: async () => CHAT }), /interactieve terminal/);
});

test("a window on another address on this machine is a second local grant next to the local site, with a budget of its own", () => {
  const WINDOW = "http://localhost:4712";
  const permission = decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: `${WINDOW}/venster` }, now)!;
  assert.deepEqual(permission, {
    origin: SITE,
    local: true,
    declaredBy: null,
    declaredAt: "2026-01-02T03:04:05.000Z",
    maxWrites: 50,
    spacingSeconds: 0,
    alsoGrants: [{ origin: WINDOW, local: true, declaredBy: null, declaredAt: "2026-01-02T03:04:05.000Z", maxWrites: 50, spacingSeconds: 0 }],
  });
  assert.equal(writesAllowedNl(permission), `onderzocht op een testomgeving waar versturen is toegestaan: ${SITE} (lokaal adres); ${WINDOW} (lokaal adres)`);
  // --max-writes is the budget of each of the two; the site itself next to the window changes nothing; a declaration is not asked for.
  const raised = decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: [SITE, WINDOW], declaredBy: "Een Beheerder, beheer", maxWrites: "80" }, now)!;
  assert.deepEqual(grantsOf(raised).map((grant) => [grant.origin, grant.maxWrites, grant.declaredBy]), [[SITE, 80, null], [WINDOW, 80, null]]);
  // Only a window on this machine itself: a name that ends in .test can be any machine.
  assert.throws(() => decideWrites("http://site.test/", { allowWrites: true, testEnvironment: "http://venster.test" }), /alleen een eigen toestemming op deze machine zelf.*http:\/\/venster\.test/);
  assert.throws(() => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: [WINDOW, "http://venster.test"] }), /op deze machine zelf/);
  assert.deepEqual(grantsOf(decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: "http://localhost:4713" }, now)!).map((grant) => grant.origin), [SITE, "http://localhost:4713"]);
  assert.deepEqual(grantsOf(decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: "http://[::1]:4713" }, now)!).map((grant) => grant.origin), [SITE, "http://[::1]:4713"]);
  // Without --allow-writes nothing local is sent to.
  assert.throws(() => decideWrites(`${SITE}/`, { testEnvironment: WINDOW }), /alleen toegestaan met --allow-writes/);
});

test("a local address is never declared next to an address that is not local, and next to a site elsewhere it stays refused", () => {
  assert.throws(() => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: [SITE, CHAT], declaredBy: "Een Beheerder, beheer" }), /lokaal adres verklaar je niet naast een adres dat niet lokaal is/);
  assert.throws(() => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: [CHAT, "http://chat.localhost"], declaredBy: "Een Beheerder, beheer" }), /lokaal adres verklaar je niet naast/);
  // A site on the internet with a local test environment next to it: refused, with and without --allow-writes.
  assert.throws(() => decideWrites("https://www.example.nl/", { allowWrites: true, testEnvironment: ["https://www.example.nl", "http://localhost:4712"], declaredBy: "Een Beheerder, beheer" }), /lokaal adres verklaar je niet naast/);
  assert.throws(() => decideWrites("https://www.example.nl/", { allowWrites: true, testEnvironment: ["http://localhost:4712", "http://127.0.0.1:4711"] }), /lokaal adres verklaar je niet naast/);
  // The local site itself as test environment stays what it was: one local grant.
  assert.equal(decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: SITE })?.alsoGrants, undefined);
});

test("a write to the declared chat needs the declaration", () => {
  assert.throws(() => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: CHAT }), /geef dan beide op/);
  assert.throws(() => decideWrites(`${SITE}/`, { allowWrites: true, testEnvironment: CHAT, declaredBy: "Een Beheerder" }), /een naam en een functie/);
  const localOnly = decideWrites(`${SITE}/`, { allowWrites: true })!;
  assert.equal(isWriteOrigin(writeAccess("/nonexistent", localOnly, "test"), `${CHAT}/api`), false);
  assert.equal(isWriteOrigin(writeAccess("/nonexistent", both(), "test"), "wss://chat.example.nl/ws"), true);
  // A login on the chat is allowed only on the declared grant, never because the site is local.
  assert.match(loginRefusalNl(CHAT, localOnly) ?? "", /verklaarde testomgeving/);
  assert.equal(loginRefusalNl(CHAT, both()), null);
});

test("each grant counts its own budget, pause and share of senders that sent nothing yet", () =>
  withRun(async (dir) => {
    const permission = both({ maxWrites: "4" });
    await recordWrites(dir, permission);
    let clock = Date.parse("2026-01-02T04:00:00Z");
    const access = writeAccess(dir, permission, "test", () => clock);
    // On this machine: no pause, and a form does not wait for the chat.
    for (let i = 0; i < 3; i++) assert.equal(access.claim("POST", `${SITE}/formulier`, { sender: "b-331" }).ok, true);
    assert.equal(access.claim("SEND", "wss://chat.example.nl/ws", { message: true, sender: "b-331" }).ok, true, "the local writes do not count for the chat");
    const early = access.claim("POST", `${CHAT}/api`, { sender: "b-412" });
    assert.equal(early.ok ? null : early.budget, "spacing", "the chat keeps its pause");
    assert.equal(access.claim("POST", `${SITE}/formulier`, { sender: "b-412" }).ok, true, "the local site does not wait for the chat");
    clock += 200_000;
    // The last half of the chat budget (2 of 4) is for whoever sent nothing to the chat yet.
    assert.equal(access.claim("POST", `${CHAT}/api`, { sender: "v-331" }).ok, true, "one more within the first half");
    clock += 200_000;
    const share = access.claim("POST", `${CHAT}/api`, { sender: "b-331" });
    assert.equal(share.ok ? null : share.budget, "share");
    assert.equal(access.claim("POST", `${CHAT}/api`, { sender: "b-412" }).ok, true, "a criterion that only sent locally still gets the share of the chat");
    const [local, chat] = writeBudgets(dir, permission, clock);
    assert.deepEqual([local!.origin, local!.sent, local!.max, local!.reserved, local!.spacingSeconds], [SITE, 4, 50, 0, 0]);
    assert.deepEqual([chat!.origin, chat!.sent, chat!.max, chat!.reserved, chat!.spacingSeconds], [CHAT, 3, 4, 2, 120]);
    assert.equal(writeBudget(dir, permission, clock, undefined, "wss://chat.example.nl/ws").sent, 3, "a socket counts by its http(s) twin");
    const lines = readFileSync(join(dir, "writes.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as PassedWrite);
    assert.ok(lines.every((line) => line.origin), "every line says where it went");

    // A point that names the chat is held against the budget of the chat.
    const point = `versturen niet toegestaan: het budget voor versturen van deze run is op (3 van 4 verstuurd), bericht naar ${CHAT}/api`;
    assert.deepEqual(notSentPointProblems([point], permission, (origins) => writeBudget(dir, permission, clock, "criterium 331", origins[0])), []);
  }));

test("a run with two budgets raises the one a person names", () =>
  withRun(async (dir) => {
    await recordWrites(dir, both());
    const yes = { interactive: true, ask: async () => "ja" };
    await assert.rejects(raiseWrites(dir, "10", {}, yes), /--origin http:\/\/127\.0\.0\.1:4710 of --origin https:\/\/chat\.example\.nl/);
    await assert.rejects(raiseWrites(dir, "10", {}, yes, "https://ander.example.nl"), /geen origin waar deze run naartoe mag versturen/);
    const raised = await raiseWrites(dir, "10", {}, yes, `${CHAT}/pad`);
    assert.deepEqual(grantsOf(raised).map((grant) => grant.maxWrites), [50, 10]);
    assert.equal(raised.raised![0]!.origin, CHAT);
    assert.match(writesAllowedNl(raised), /budget voor versturen naar https:\/\/chat\.example\.nl verhoogd van 5 naar 10/);
    assert.equal(writeBudget(dir, both(), Date.now(), undefined, CHAT).max, 10, "an access from before the raise sees it");
    assert.deepEqual(grantsOf(writesAfterRaises(raised, 0)).map((grant) => grant.maxWrites), [50, 5]);
  }));

test("a manifest from before there could be more than one grant reads and counts as it did", () =>
  withRun((dir) => {
    const old = {
      origin: "https://site.example.nl",
      alsoOrigins: [CHAT],
      local: false,
      declaredBy: { name: "Een Beheerder", role: "beheer" },
      declaredAt: "2026-01-02T03:04:05.000Z",
      recordedVia: "terminal",
      maxWrites: 6,
      spacingSeconds: 0,
      raised: [{ from: 4, to: 6, at: "2026-01-02T05:00:00.000Z", recordedVia: "terminal" }],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ command: "inventory", writes: old }));
    writeFileSync(
      join(dir, "writes.jsonl"),
      [
        { at: "2026-01-02T04:00:00.000Z", source: "b-331", method: "POST", path: "/a", origin: "https://site.example.nl" },
        { at: "2026-01-02T04:01:00.000Z", source: "b-412", method: "SEND", path: "/ws", origin: "wss://chat.example.nl", message: true },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
    const permission = writesForRun(dir)!;
    assert.equal(grantsOf(permission).length, 1);
    assert.deepEqual(writeOriginsOf(permission), ["https://site.example.nl", CHAT]);
    const budget = writeBudget(dir, permission, Date.parse("2026-01-02T06:00:00Z"));
    assert.deepEqual([budget.origin, budget.sent, budget.max, budget.reserved], [`https://site.example.nl en ${CHAT}`, 2, 6, 3]);
    assert.equal(
      writesAllowedNl(permission),
      `onderzocht op een testomgeving waar versturen is toegestaan: https://site.example.nl en ${CHAT}, verklaard door iemand met de functie beheer, bevestigd in een terminal op 2 januari 2026 om 04:04 (de naam staat in het dossier van het onderzoek, niet in dit rapport); budget voor versturen verhoogd van 4 naar 6, bevestigd in een terminal op 2 januari 2026 om 06:00`,
    );
    assert.equal(writesAfterRaises(permission, 0).maxWrites, 4);
  }));
