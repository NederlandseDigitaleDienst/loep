import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Browser } from "playwright";
import { REFUSED_STATUS } from "../src/browser/boundary.ts";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { cleanupLinesNl, mailCleanup, mailLinks, mailWait, startMailbox } from "../src/commands/mail.ts";
import { seal } from "../src/commands/verify.ts";
import { RUN_SECRETS_FILE } from "../src/lib/login.ts";
import { imapMailbox } from "../src/lib/mailbox-imap.ts";
import { mailpitMailbox } from "../src/lib/mailbox-mailpit.ts";
import { agentMailboxNl, MAIL_NOT_JUDGED_NL, confirmMailbox, decideMailbox, linkKind, mailboxForRun, mailboxLimitationsNl, mailCredentials, readMailboxState, recordMailbox, runAddress, waitForMail, type Mailbox, type RawMail } from "../src/lib/mailbox.ts";
import { isFor, linksOf, looksSecret, parseMail, secretsInText, secretsInUrl } from "../src/lib/mailparse.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { notHashed } from "../src/lib/seal.ts";
import { aliasFor, leakRefusalNl, readSecretEvents as eventsOf, registerSecret, scanRun, searchedSpellings, Shield, shieldForRun } from "../src/lib/secrets.ts";
import { decideWrites, recordWrites, writeAccess, writesForRun, type WritePermission } from "../src/lib/writes.ts";
import { guardContext, guardedDownload, guardRedirects, scopeForRun, TEST_VALUES, type Guard } from "../src/session/safety.ts";

const TOKEN = "Zk3vQ9xT7bLp2nWd5sGh8JmR4cYf6AeU1oKi0tXa_-q";
const ADDRESS = "loep-1a2b3c4d@example.com";
const noTerminal = { interactive: false, ask: async (): Promise<string> => "" };

const permission = (origin: string, extra: Partial<WritePermission> = {}): WritePermission => ({ ...decideWrites(`${origin}/`, { allowWrites: true })!, maxWrites: 100, spacingSeconds: 0, ...extra });

const mailOf = (to: string, body: string, extra = ""): Buffer => Buffer.from(`From: site@example.com\r\nTo: ${to}\r\nSubject: Test\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);

// ---- Fixed at inventory ------------------------------------------------------------------------------------------------

test("--mailbox needs a run that may send", () => {
  assert.throws(() => decideMailbox("mailpit://localhost:8025", null), /hoort bij een run die mag versturen/);
});

test("a login never goes in --mailbox, and the value never comes back in the message", () => {
  const local = permission("http://localhost:8081");
  for (const value of ["imap://gebruiker@localhost:993", "imap://gebruiker:geheim@localhost:993"]) {
    assert.throws(() => decideMailbox(value, local), (error: Error) => /geen gebruikersnaam of wachtwoord/.test(error.message) && !error.message.includes("geheim@") && !error.message.includes(value));
  }
  assert.throws(() => decideMailbox("geen-adres:geheim@", local), (error: Error) => !error.message.includes("geheim"));
});

test("Mailpit is only for a site on this machine", () => {
  const local = permission("http://localhost:8081");
  assert.deepEqual(decideMailbox("mailpit://localhost:8025", local).server, { kind: "mailpit", host: "localhost", port: 8025, tls: false });
  assert.throws(() => decideMailbox("mailpit://mail.example.nl:8025", local), /alleen voor deze machine/);
  const live: WritePermission = { origin: "https://test.example.nl", local: false, declaredBy: { name: "Iemand", role: "beheerder" }, declaredAt: "2026-10-30T10:00:00.000Z" };
  assert.throws(() => decideMailbox("mailpit://localhost:8025", live), /niet lokaal/);
});

test("IMAP to another machine is TLS on 993; only this machine goes without", () => {
  const local = permission("http://localhost:8081");
  assert.deepEqual(decideMailbox("imap://mail.example.nl:993", local).server, { kind: "imap", host: "mail.example.nl", port: 993, tls: true });
  assert.equal(decideMailbox("imap://mail.example.nl", local).server.port, 993);
  assert.throws(() => decideMailbox("imap://mail.example.nl:143", local), /poort 993/);
  assert.equal(decideMailbox("imap://localhost:1143", local).server.tls, false);
  assert.throws(() => decideMailbox("https://mail.example.nl", local), /verwacht imap/);
});

test("a mailbox on another machine is confirmed by a person who types its host; without a terminal it is refused", async () => {
  const local = permission("http://localhost:8081");
  const real = decideMailbox("imap://mail.example.nl:993", local);
  await assert.rejects(confirmMailbox(real, local, noTerminal), /interactieve terminal/);
  await assert.rejects(confirmMailbox(real, local, { interactive: true, ask: async () => "iets anders" }), /niet bevestigd/);
  const mark = await confirmMailbox(real, local, { interactive: true, ask: async () => "mail.example.nl" });
  assert.equal(mark.recordedVia, "terminal");
  const onThisMachine = decideMailbox("imap://localhost:1143", local);
  assert.equal((await confirmMailbox(onThisMachine, local, noTerminal)).recordedVia, undefined);
});

test("the login comes from the environment or the keychain, and the message for a missing one holds no value", () => {
  const server = { kind: "imap" as const, host: "mail.example.nl", port: 993, tls: true };
  assert.deepEqual(mailCredentials(server, { LOEP_IMAP_USER: "a", LOEP_IMAP_PASSWORD: "b" }, () => null), { user: "a", password: "b" });
  assert.deepEqual(mailCredentials(server, {}, () => ({ user: "c", password: "d" })), { user: "c", password: "d" });
  assert.throws(() => mailCredentials(server, { LOEP_IMAP_USER: "a" }, () => null), /LOEP_IMAP_PASSWORD/);
});

test("a run gets an address of its own", () => {
  const imap = { kind: "imap" as const, host: "mail.example.nl", port: 993, tls: true };
  assert.match(runAddress({ kind: "mailpit", host: "localhost", port: 8025, tls: false }, {}), /^loep-[0-9a-f]{8}@example\.com$/);
  assert.match(runAddress(imap, { LOEP_IMAP_USER: "toets@example.nl", LOEP_IMAP_PASSWORD: "x" }), /^toets\+loep-[0-9a-f]{8}@example\.nl$/);
  assert.equal(runAddress(imap, { LOEP_IMAP_ADDRESS: "vast@example.nl" }), "vast@example.nl");
  assert.throws(() => runAddress(imap, { LOEP_IMAP_USER: "toets", LOEP_IMAP_PASSWORD: "x" }), /LOEP_IMAP_ADDRESS/);
});

// ---- Reading a mail ----------------------------------------------------------------------------------------------------

test("a mail is read through quoted-printable, base64 and multipart", () => {
  const url = `https://site.example.nl/bevestigen/?token=${TOKEN}`;
  const boundary = "grens";
  const raw = Buffer.from(
    [
      `To: ${ADDRESS}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      `Bevestig via=20deze link: https://site.example.nl/bevestigen/?token=3D${TOKEN.slice(0, 20)}=`,
      `${TOKEN.slice(20)}.`,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(`<a href="${url}&amp;x=1">Bevestig</a>`).toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
  const mail = parseMail(raw);
  assert.match(mail.text, /Bevestig via deze link/);
  assert.deepEqual(linksOf(mail).map((link) => link.url).sort(), [url, `${url}&x=1`].sort());
});

test("the header for unsubscribing is a link, with its one click", () => {
  const url = `https://site.example.nl/afmelden/?token=${TOKEN}`;
  const links = linksOf(parseMail(mailOf(ADDRESS, "tekst", `List-Unsubscribe: <${url}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n`)));
  assert.deepEqual(links, [{ url, unsubscribe: true, oneClick: true }]);
});

test("only an http(s) address is a link", () => {
  const links = linksOf(parseMail(Buffer.from(`To: x@example.com\r\nContent-Type: text/html\r\n\r\n<a href="javascript:alert(1)">a</a><a href="mailto:x@example.com">b</a><a href="data:text/html,x">c</a>`)));
  assert.deepEqual(links, []);
});

test("a mail is for an address only when it says so exactly", () => {
  const mail = parseMail(mailOf(`"Iemand" <anders+${ADDRESS}>`, "tekst"));
  assert.equal(isFor(mail, ADDRESS), false);
  assert.equal(isFor(parseMail(mailOf(`Naam <${ADDRESS.toUpperCase()}>`, "tekst")), ADDRESS), true);
  assert.equal(isFor(parseMail(mailOf("ander@example.com", "tekst", `Delivered-To: ${ADDRESS}\r\n`)), ADDRESS), true);
});

test("what may be a token is told from what names a page", () => {
  for (const value of [TOKEN, "abc123def", "550e8400-e29b-41d4-a716-446655440000", "123456", "AbCdEfGhIjKlMn0"]) assert.equal(looksSecret(value), true, value);
  for (const value of ["preferences", "e-mailupdates", "index.html", "12345", "2026-10-30", "Bevestigen", "product-owner-2026", "nl"]) assert.equal(looksSecret(value), false, value);
  assert.deepEqual(secretsInUrl(`https://site.example.nl/mail/${TOKEN}/voorkeuren/?lang=nl#code=abc123def`), [TOKEN, "abc123def"]);
  assert.deepEqual(secretsInText(`Je code: 482913. Of gebruik ${TOKEN}. Bel 0612345678.`), [TOKEN, "482913"]);
});

test("1: a one-time code is told from a year, a date and any other number near the word for it", () => {
  for (const text of ["Uw code is 482913", "code 4829", "De code is: 9931", "Verificatiecode: 5533", "Code voor bevestiging: 482913", "token = 8842", "Code **482913**", "Uw code 7788 is 15 minuten geldig."]) assert.equal(secretsInText(text).length, 1, text);
  for (const text of ["Deze code is geldig tot 2026", "Deze code is geldig tot 31 december 2026", "code 2026", "code: 1999", "code: 20261030", "De code is 30102026.", "code 2026-10-30", "code 1030 uur", "code is 12.345", "code 1500 euro", "postcode 3511 AB", "postcode: 3511", "foutcode 5001"]) assert.deepEqual(secretsInText(text), [], text);
});

test("a link is named by the words in its path", () => {
  assert.equal(linkKind("/e-mailupdates/bevestigen/"), "confirm");
  assert.equal(linkKind("/account/confirm"), "confirm");
  assert.equal(linkKind("/e-mailupdates/voorkeuren/"), "preferences");
  assert.equal(linkKind("/e-mailupdates/afmelden/"), "unsubscribe");
  assert.equal(linkKind("/x"), "other");
});

// ---- The interface -----------------------------------------------------------------------------------------------------

const memoryBox = (mails: RawMail[]): Mailbox & { removed: string[]; mails: RawMail[] } => {
  const removed: string[] = [];
  return {
    kind: "mailpit",
    removed,
    mails,
    fetch: async () => mails.filter((mail) => !removed.includes(mail.id)),
    remove: async (ids) => {
      removed.push(...ids);
      return ids.length;
    },
  };
};

test("fourth review: a code with letters after the word for it is a code, and so is what stands in a link without a scheme", () => {
  const found = secretsInText("Je code: A1B2C3 of sleutel XK29-LM84. Ga naar site.nl/x?t=abc123DEF456");
  for (const value of ["A1B2C3", "XK29-LM84", "abc123DEF456"]) assert.ok(found.includes(value), value);
  assert.deepEqual(secretsInText("Deze code is verlopen. De code: Nederland. Lees site.nl/vacatures/product-owner"), []);
});

test("waiting gives only what is for the address, since the moment", async () => {
  const since = new Date("2026-10-30T10:00:00Z");
  const box = memoryBox([
    { id: "oud", receivedAt: since.getTime() - 1000, raw: mailOf(ADDRESS, "te oud") },
    { id: "ander", receivedAt: since.getTime() + 1000, raw: mailOf("ander@example.com", "van een ander") },
    { id: "goed", receivedAt: since.getTime() + 1000, raw: mailOf(ADDRESS, "voor deze run") },
  ]);
  const found = await waitForMail(box, { address: ADDRESS, since, timeoutMs: 0 });
  assert.deepEqual(found.map((message) => message.id), ["goed"]);
});

test("waiting goes on until a mail comes, and gives up when the time is up", async () => {
  const since = new Date("2026-10-30T10:00:00Z");
  const mails: RawMail[] = [];
  let rounds = 0;
  const box = memoryBox(mails);
  const sleep = async (): Promise<void> => {
    if (++rounds === 2) mails.push({ id: "laat", receivedAt: since.getTime() + 1, raw: mailOf(ADDRESS, "laat") });
  };
  assert.equal((await waitForMail(box, { address: ADDRESS, since, timeoutMs: 10_000, pollMs: 1, sleep })).length, 1);
  assert.equal(rounds, 2);
  assert.deepEqual(await waitForMail(memoryBox([]), { address: ADDRESS, since, timeoutMs: 0 }), []);
});

/** A small IMAP server: enough of RFC 9051 for what the client asks, and it writes down what it was asked. */
async function fakeImap(options: { uidplus?: boolean } = {}): Promise<{ port: number; boxes: { uid: number; raw: Buffer; to: string }[]; commands: string[]; close: () => Promise<void> }> {
  const boxes = [
    { uid: 7, raw: mailOf(ADDRESS, `Klik https://site.example.nl/x/?token=${TOKEN}`), to: ADDRESS },
    { uid: 8, raw: mailOf(`meer-${ADDRESS}`, "een ander, want TO zoekt op een deel van het adres"), to: `meer-${ADDRESS}` },
    { uid: 9, raw: mailOf("niemand@example.com", "hoort er niet bij"), to: "niemand@example.com" },
  ];
  const commands: string[] = [];
  const deleted = new Set<number>();
  const server = createTcpServer((socket: Socket) => {
    socket.write("* OK klaar\r\n");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("latin1");
      for (let end = buffer.indexOf("\r\n"); end !== -1; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands.push(line);
        const [tag, ...rest] = line.split(" ");
        const command = rest.join(" ");
        if (/^LOGIN /.test(command)) socket.write(command === 'LOGIN "toets" "ge\\"heim"' ? `${tag} OK ingelogd\r\n` : `${tag} NO fout\r\n`);
        else if (command === "CAPABILITY") socket.write(`* CAPABILITY IMAP4rev1${options.uidplus === false ? "" : " UIDPLUS"}\r\n${tag} OK\r\n`);
        else if (command === "SELECT INBOX") socket.write(`* 3 EXISTS\r\n${tag} OK\r\n`);
        else if (/^UID SEARCH /.test(command)) {
          const address = /TO "([^"]*)"/.exec(command)![1]!;
          const uids = boxes.filter((box) => box.to.includes(address) && !deleted.has(box.uid)).map((box) => box.uid);
          socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK\r\n`);
        } else if (/^UID FETCH /.test(command)) {
          const wanted = command.split(" ")[2]!.split(",").map(Number);
          for (const box of boxes.filter((entry) => wanted.includes(entry.uid))) {
            socket.write(`* ${box.uid} FETCH (UID ${box.uid} INTERNALDATE "30-Oct-2026 10:00:00 +0000" BODY[]<0> {${box.raw.length}}\r\n`);
            socket.write(box.raw);
            socket.write(")\r\n");
          }
          socket.write(`${tag} OK\r\n`);
        } else if (/^UID STORE /.test(command)) {
          for (const uid of command.split(" ")[2]!.split(",")) deleted.add(Number(uid));
          socket.write(`${tag} OK\r\n`);
        } else if (/^UID EXPUNGE /.test(command)) socket.write(`${tag} OK\r\n`);
        else if (command === "LOGOUT") socket.write(`* BYE\r\n${tag} OK\r\n`);
        else socket.write(`${tag} BAD\r\n`);
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, boxes, commands, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("IMAP: read without marking as read, only the mail of the run, and delete only that", async () => {
  const fake = await fakeImap();
  try {
    const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets", password: 'ge"heim' });
    const found = await waitForMail(box, { address: ADDRESS, since: new Date("2026-10-30T09:00:00Z"), timeoutMs: 0 });
    assert.deepEqual(found.map((message) => message.id), ["7"]);
    assert.ok(fake.commands.some((command) => /BODY\.PEEK\[\]/.test(command)));
    assert.equal(await box.remove(found.map((message) => message.id)), 1);
    assert.ok(fake.commands.some((command) => /UID STORE 7 \+FLAGS\.SILENT \(\\Deleted\)/.test(command)));
    assert.ok(fake.commands.some((command) => command.endsWith("UID EXPUNGE 7")));
    assert.equal(fake.commands.some((command) => / EXPUNGE$/.test(command)), false);
    assert.deepEqual(await waitForMail(box, { address: ADDRESS, since: new Date("2026-10-30T09:00:00Z"), timeoutMs: 0 }), []);
  } finally {
    await fake.close();
  }
});

test("IMAP without UIDPLUS: nothing is expunged, because that would also take what somebody else marked", async () => {
  const fake = await fakeImap({ uidplus: false });
  try {
    const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets", password: 'ge"heim' });
    assert.equal(await box.remove(["7"]), 1);
    assert.equal(fake.commands.some((command) => /EXPUNGE/.test(command)), false);
  } finally {
    await fake.close();
  }
});

test("IMAP: a refused login says so, without the password", async () => {
  const fake = await fakeImap();
  try {
    const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets", password: "fout-wachtwoord" });
    await assert.rejects(box.fetch(ADDRESS, new Date()), (error: Error) => /weigerde de inlog/.test(error.message) && !error.message.includes("fout-wachtwoord"));
  } finally {
    await fake.close();
  }
});

test("IMAP: a line break in a value cannot start a new command", async () => {
  const fake = await fakeImap();
  try {
    const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets\r\nL9 LOGOUT", password: "x" });
    await assert.rejects(box.fetch(ADDRESS, new Date()), /regeleinde/);
    assert.equal(fake.commands.some((command) => /L9/.test(command)), false);
  } finally {
    await fake.close();
  }
});

test("Mailpit: the REST API finds by address, gives the raw message and deletes by id", async () => {
  const calls: string[] = [];
  const raw = mailOf(ADDRESS, `Klik https://site.example.nl/x/?token=${TOKEN}`);
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${decodeURIComponent(request.url!)}`);
    if (request.url!.startsWith("/api/v1/search")) return void response.end(JSON.stringify({ messages: [{ ID: "abc", Created: "2026-10-30T10:00:00.000Z" }] }));
    if (request.url === "/api/v1/message/abc/raw") return void response.end(raw);
    if (request.method === "DELETE") return void request.on("data", (body) => calls.push(String(body))).on("end", () => response.end("ok"));
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const box = mailpitMailbox({ kind: "mailpit", host: "127.0.0.1", port: (server.address() as AddressInfo).port, tls: false });
    const found = await waitForMail(box, { address: ADDRESS, since: new Date("2026-10-30T09:00:00Z"), timeoutMs: 0 });
    assert.equal(found.length, 1);
    assert.ok(calls[0]!.includes(`addressed:"${ADDRESS}"`));
    assert.equal(await box.remove(["abc"]), 1);
    assert.ok(calls.includes('{"IDs":["abc"]}'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---- The shield --------------------------------------------------------------------------------------------------------

test("an alias has the length of its value and swaps in every spelling, both ways", () => {
  const real = "a/b+c&d1234567890";
  const alias = aliasFor(real);
  assert.equal(alias.length, real.length);
  const reach = { origins: ["http://localhost:1"], at: "" };
  const shield = new Shield({ secrets: [{ real, alias, source: "test", ...reach }, { real: "n+r@example.nl", alias: TEST_VALUES.email!, source: "test", ...reach }] });
  assert.equal(shield.inward(`x ${real} y`), `x ${alias} y`);
  assert.equal(shield.inward(encodeURIComponent(real)), encodeURIComponent(alias));
  assert.equal(shield.inward(real.replaceAll("&", "&amp;")), alias.replaceAll("&", "&amp;"));
  assert.equal(shield.inward(`{"a":"${real.replaceAll("/", "\\/")}"}`), `{"a":"${alias}"}`);
  assert.equal(shield.outward(`email=${encodeURIComponent(TEST_VALUES.email!)}`), "email=n%2Br%40example.nl");
  assert.equal(shield.outwardBytes(Buffer.from(`x${alias}y`)).toString(), `x${real}y`);
  assert.equal(shield.inwardBytes(Buffer.from(`x${real}y`)).toString(), `x${alias}y`);
  assert.equal(shield.covers("http://localhost:1/a"), true);
  assert.equal(shield.covers("ws://localhost:1/a"), true);
  assert.equal(shield.covers("http://localhost:2/a"), false);
});

/** A run with a mailbox, as `inventory` leaves it. */
async function mailboxRun(origin: string, extra: Partial<WritePermission> = {}): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "loep-mail-"));
  const granted = permission(origin, extra);
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  await recordWrites(run, granted);
  const mark = { kind: "mailpit" as const, local: true, declaredAt: "2026-10-30T09:00:00.000Z" };
  await recordMailbox(run, mark);
  await startMailbox(run, { kind: "mailpit", host: "localhost", port: 1, tls: false }, ADDRESS, mark, granted);
  return run;
}

test("the secrets stand in a file of their own: owner only, outside the seal, ignored by git", async () => {
  const run = await mailboxRun("http://localhost:8081");
  try {
    assert.equal(notHashed(RUN_SECRETS_FILE), true);
    assert.equal(statSync(join(run, RUN_SECRETS_FILE)).mode & 0o777, 0o600);
    assert.match(readFileSync(join(run, ".gitignore"), "utf8"), /secrets\.json/);
    assert.ok(!readFileSync(join(run, "manifest.json"), "utf8").includes(ADDRESS));
    assert.ok(!readFileSync(join(run, "mailbox.json"), "utf8").includes(ADDRESS));
    await writeManifest(run, { command: "collect" });
    assert.equal(mailboxForRun(run)?.kind, "mailpit", "a later command keeps the mailbox in the manifest");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("the search finds a token in every spelling, also inside binary data and in a file name, and seal refuses such a run", async () => {
  const run = await mailboxRun("http://localhost:8081");
  try {
    registerSecret(run, TOKEN, { source: "test" });
    const leaks: [string, string | Buffer][] = [
      ["gewoon.txt", `...${TOKEN}...`],
      ["adres.url", encodeURIComponent(`x${TOKEN}`)],
      ["binair.bin", Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(TOKEN), Buffer.from([0])])],
      ["base64-0.txt", Buffer.from(TOKEN).toString("base64")],
      ["base64-1.txt", Buffer.from(`a${TOKEN}`).toString("base64")],
      ["base64-2.txt", Buffer.from(`ab${TOKEN}c`).toString("base64")],
      ["hex.txt", Buffer.from(TOKEN).toString("hex")],
      ["adres.txt", ADDRESS],
    ];
    for (const [name, data] of leaks) {
      writeFileSync(join(run, name), data);
      assert.ok(scanRun(run).hits.some((hit) => hit.file === name), name);
      rmSync(join(run, name));
    }
    writeFileSync(join(run, `naam-${TOKEN}.txt`), "leeg");
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.source), ["test"]);
    rmSync(join(run, `naam-${TOKEN}.txt`));
    assert.deepEqual(scanRun(run).hits, []);
    assert.equal(leakRefusalNl(scanRun(run)), null);
    writeFileSync(join(run, "gelekt.txt"), TOKEN);
    await assert.rejects(seal(run), (error: Error) => /gelekt\.txt/.test(error.message) && !error.message.includes(TOKEN));
    assert.equal(existsSync(join(run, "evidence-index.json")), false);
    rmSync(join(run, "gelekt.txt"));
    await seal(run);
    assert.equal(existsSync(join(run, "evidence-index.json")), true);
    assert.ok(searchedSpellings(TOKEN).length >= 5);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Through the browser -----------------------------------------------------------------------------------------------

let browser: Browser;
let site: Server;
let origin: string;
/** What the server saw, with the real values. */
let seen: { method: string; url: string; body: string; cookie: string | undefined }[];
let registered: boolean;
let hideButton: boolean;

/**
 * A site with a subscription behind a personal link. The token comes back in everything a page can
 * hold: the address, a form, a script, a header, a cookie, a redirect.
 */
const handler = (request: IncomingMessage, response: ServerResponse): void => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk) => chunks.push(chunk as Buffer));
  request.on("end", () => {
    const url = new URL(request.url!, origin);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: request.method!, url: url.pathname + url.search, body, cookie: request.headers.cookie });
    const html = (content: string, headers: Record<string, string> = {}): void => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
      response.end(`<!doctype html><html lang="nl"><title>Site</title><body>${content}</body></html>`);
    };
    const token = url.searchParams.get("token");
    if (url.pathname === "/") return html("<h1>Start</h1>");
    if (url.pathname === "/verlopen/") return html("<h1>Link verlopen</h1>");
    if (url.pathname === "/klaar/") return html("<h1>Afgemeld</h1>");
    if (url.pathname === "/aanmelden/" && request.method === "POST") {
      registered = new URLSearchParams(body).get("email") === ADDRESS;
      response.writeHead(303, { location: "/controleren/" }).end();
      return;
    }
    if (url.pathname === "/controleren/") return html("<h1>Kijk in je mail</h1>");
    if (url.pathname === "/start-link/") {
      response.writeHead(303, { location: `/voorkeuren/?token=${TOKEN}` }).end();
      return;
    }
    if (token !== TOKEN || !registered) {
      response.writeHead(303, { location: "/verlopen/" }).end();
      return;
    }
    // A confirmation: only a page with a button once it was opened. Whoever opens it turns the registration on.
    if (url.pathname === "/bevestigen/") return html(`<h1>Bevestigd</h1><form method="post" action="/voorkeuren/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    // A press the site takes in without anything to show for it.
    if (url.pathname === "/voorkeuren/blijft/" && request.method === "POST") return html(`<h1>Bedankt</h1><form method="post" action="/voorkeuren/blijft/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    if (url.pathname === "/voorkeuren/blijft/") return html(hideButton ? "<h1>Niets meer</h1>" : `<h1>Blijft</h1><form method="post" action="/voorkeuren/blijft/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    if (url.pathname === "/voorkeuren/kader/") return html(`<h1>Met kader</h1><iframe title="Kaart" src="https://www.andere-site.example/kaart/"></iframe><form method="post" action="/voorkeuren/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    if (url.pathname === "/voorkeuren/met-link/") return html(`<h1>Links</h1><a href="/bevestigen/?token=${TOKEN}">Bevestig</a> <a href="/aanmelden/opnieuw/?token=${TOKEN}">Opnieuw</a>`);
    if (url.pathname === "/voorkeuren/kapot/") {
      response.writeHead(303, { location: "https://www.andere-site.example/weg/" }).end();
      return;
    }
    if (url.pathname === "/voorkeuren/baken/") return html(`<h1>Baken</h1><script>navigator.sendBeacon("/teller", "x")</script><form method="post" action="/voorkeuren/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    if (url.pathname === "/voorkeuren/onderwerp/") return html(`<h1>Onderwerpen</h1><form method="post" action="/voorkeuren/?token=${TOKEN}"><button>Verwijder onderwerp</button></form>`);
    if (url.pathname === "/afmelden/direct/") return html("<h1>U bent afgemeld</h1>");
    if (url.pathname === "/voorkeuren/filter/") return html(`<h1>Filters</h1><form method="post" action="/voorkeuren/filter/"><button>Verwijder filter</button></form>`);
    if (url.pathname === "/voorkeuren/door/" && request.method === "POST") {
      response.writeHead(303, { location: `/eenmalig/?token=${TOKEN}` }).end();
      return;
    }
    if (url.pathname === "/voorkeuren/door/") return html(`<h1>Door</h1><form method="post" action="/voorkeuren/door/?token=${TOKEN}"><button>Verder</button></form>`);
    if (url.pathname === "/eenmalig/") return html("<h1>Eenmalig</h1>");
    // A press that leads out of the scope.
    if (url.pathname === "/voorkeuren/weg/" && request.method === "POST") {
      response.writeHead(303, { location: "https://www.andere-site.example/klaar/" }).end();
      return;
    }
    if (url.pathname === "/voorkeuren/weg/") return html(`<h1>Weg</h1><form method="post" action="/voorkeuren/weg/?token=${TOKEN}"><button>Verwijder alles</button></form>`);
    if (url.pathname === "/voorkeuren/" && request.method === "POST") {
      registered = false;
      response.writeHead(303, { location: "/klaar/" }).end();
      return;
    }
    if (url.pathname === "/voorkeuren/") {
      html(`<h1>Voorkeuren</h1><p>Je adres: <strong>${ADDRESS}</strong></p><form method="post" action="/voorkeuren/?token=${TOKEN}"><input type="hidden" name="token" value="${TOKEN}"><button>Verwijder alles</button></form><a href="/voorkeuren/?token=${encodeURIComponent(TOKEN)}">Hier</a><script>window.code = ${JSON.stringify(TOKEN)}</script>`, { "set-cookie": `abonnee=${TOKEN}; Path=/`, "x-eigen-link": `/voorkeuren/?token=${TOKEN}` });
      return;
    }
    response.writeHead(404).end();
  });
};

before(async () => {
  browser = await launchBrowser();
  site = createServer(handler);
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

after(async () => {
  await browser.close();
  await new Promise((resolve) => site.close(resolve));
});

beforeEach(() => {
  seen = [];
  registered = true;
  hideButton = false;
});

const mailFor = (url: string, extra = ""): RawMail => ({ id: `m${Math.random()}`, receivedAt: Date.parse("2026-10-30T10:00:00Z"), raw: mailOf(ADDRESS, `Hallo,\n\nJe link: ${url}\n\nOok: https://www.andere-site.example/x/?code=Geheim123456\n`, extra) });

async function sessionOn(run: string): Promise<{ page: Awaited<ReturnType<Browser["newPage"]>>; guard: Guard; close: () => Promise<void> }> {
  const scope = await scopeForRun(run, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  const context = await newContext(browser, { writes: scope.writes ?? null });
  await guardContext(context, scope, guard);
  const page = await context.newPage();
  await guardRedirects(page, scope, guard);
  return { page, guard, close: () => context.close() };
}

const inFiles = (dir: string, needle: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return inFiles(path, needle);
    return entry.name !== RUN_SECRETS_FILE && readFileSync(path).includes(needle) ? [path] : [];
  });

test("a run sees aliases only, and the site gets the real values", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  const session = await sessionOn(run);
  try {
    const answer = await mailWait(run, { mailbox: box });
    assert.equal(answer.mails, 1);
    assert.equal(box.removed.length, 1);
    assert.deepEqual(answer.refusedOrigins, ["https://www.andere-site.example"]);
    const link = answer.links[0]!;
    assert.equal(link.kind, "preferences");
    assert.ok(!link.url.includes(TOKEN));

    await loadPage(session.page, link.url);
    assert.equal(seen.at(-1)!.url, `/voorkeuren/?token=${TOKEN}`);
    assert.equal(session.page.url(), link.url);
    const page = await session.page.content();
    assert.ok(!page.includes(TOKEN) && !page.includes(encodeURIComponent(TOKEN)));
    assert.ok(!page.includes(ADDRESS));
    assert.ok(page.includes(TEST_VALUES.email!));
    assert.ok(!(await session.page.context().cookies()).some((cookie) => cookie.value.includes(TOKEN)));

    // The form posts what the browser has, and the server gets the real token again, also in the body and the cookie.
    await session.page.getByRole("button", { name: "Verwijder alles" }).click();
    await session.page.waitForURL(`${origin}/klaar/`);
    const posted = seen.find((request) => request.method === "POST")!;
    assert.equal(posted.url, `/voorkeuren/?token=${TOKEN}`);
    assert.ok(posted.body.includes(TOKEN));
    assert.ok(posted.cookie?.includes(TOKEN));
    assert.deepEqual(inFiles(run, TOKEN), []);
    assert.deepEqual(inFiles(run, ADDRESS), []);
    assert.deepEqual(scanRun(run).hits, []);
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a redirect with a token in it reaches the browser with the alias, and the server with the real value", async () => {
  const run = await mailboxRun(origin);
  const session = await sessionOn(run);
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    await loadPage(session.page, `${origin}/start-link/`);
    await session.page.waitForURL(/voorkeuren/);
    await session.page.waitForLoadState("load");
    assert.equal(seen.at(-1)!.url, `/voorkeuren/?token=${TOKEN}`);
    assert.ok(!session.page.url().includes(TOKEN));
    assert.equal(await session.page.locator("h1").textContent(), "Voorkeuren");
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a personal link is not fetched outside the browser: the site would show another page", async () => {
  const run = await mailboxRun(origin);
  const session = await sessionOn(run);
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    const before = seen.length;
    const fetched = await guardedDownload(await scopeForRun(run, {}), session.guard, readMailboxState(run)!.links[0]!.url, join(run, "weg.bin"), { resourceType: "document", maxBytes: 1000, timeoutMs: 1000, blockade: undefined });
    assert.equal(fetched.ok, false);
    assert.equal(seen.length, before);
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a form with the address of the run goes to the site with the real address, every time, and no answer is kept to play", async () => {
  const run = await mailboxRun(origin);
  const session = await sessionOn(run);
  try {
    await loadPage(session.page, `${origin}/`);
    for (let time = 0; time < 2; time++) {
      await session.page.evaluate((email) => {
        const form = document.createElement("form");
        form.method = "post";
        form.action = "/aanmelden/";
        const field = form.appendChild(document.createElement("input"));
        field.name = "email";
        field.value = email;
        document.body.append(form);
        form.submit();
      }, TEST_VALUES.email!);
      await session.page.waitForURL(/controleren/);
      await session.page.goto(`${origin}/`);
    }
    const sent = seen.filter((request) => request.method === "POST");
    assert.equal(sent.length, 2);
    assert.ok(sent.every((request) => new URLSearchParams(request.body).get("email") === ADDRESS));
    assert.equal(existsSync(join(run, "opnames.jsonl")), false);
    assert.deepEqual(inFiles(run, ADDRESS), []);
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("opening a personal link counts once against the budget; past the budget it is held back", async () => {
  const run = await mailboxRun(origin, { maxWrites: 1 });
  const session = await sessionOn(run);
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`), mailFor(`${origin}/verder/?token=${TOKEN}A`)]) });
    const [first, second] = readMailboxState(run)!.links;
    await loadPage(session.page, first!.url);
    await loadPage(session.page, first!.url);
    const log = readFileSync(join(run, "writes.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { link?: string; repeat?: true });
    assert.equal(log.filter((entry) => entry.link === first!.id).length, 1);
    assert.equal(log.filter((entry) => entry.repeat).length, 1);
    const before = seen.length;
    await session.page.goto(second!.url).catch(() => undefined);
    assert.equal(seen.length, before, "the site is not asked");
    assert.equal(session.guard.blocked.at(-1)?.writeBudget, "out");
    assert.ok(!JSON.stringify(session.guard.blocked).includes(TOKEN));
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a link to an origin outside the permission gets no alias and cannot be opened as one", async () => {
  const run = await mailboxRun(origin);
  try {
    const answer = await mailWait(run, { mailbox: memoryBox([mailFor(`https://aanvaller.example/x/?token=${TOKEN}`)]) });
    assert.deepEqual(answer.links, []);
    assert.deepEqual(answer.refusedOrigins.sort(), ["https://aanvaller.example", "https://www.andere-site.example"]);
    const kept = readFileSync(join(run, "mailbox", "bericht-1.txt"), "utf8");
    assert.ok(!kept.includes(TOKEN) && !kept.includes("aanvaller.example"));
    assert.match(kept, /niet gevolgd/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("2: a session that may not send opens no personal link, and the boundary fills in no real value", async () => {
  const run = await mailboxRun(origin);
  const recheck = join(run, "nalopen");
  mkdirSync(recheck);
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    const url = readMailboxState(run)!.links[0]!.url;
    // What `recheck` makes: the register of the run by a link, its site, and a manifest without a permission.
    symlinkSync(join(run, RUN_SECRETS_FILE), join(recheck, RUN_SECRETS_FILE));
    copyFileSync(join(run, "inventory.json"), join(recheck, "inventory.json"));
    writeFileSync(join(recheck, "manifest.json"), JSON.stringify({ steps: [] }));
    const scope = await scopeForRun(recheck, {});
    assert.equal(scope.writes, undefined);
    const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
    const context = await newContext(browser, { runDir: recheck });
    await guardContext(context, scope, guard);
    const page = await context.newPage();
    await guardRedirects(page, scope, guard);
    try {
      await loadPage(page, `${origin}/`);
      seen = [];
      await loadPage(page, url).catch(() => undefined);
      assert.equal(seen.length, 0, "the site heard nothing");
      assert.equal(guard.blocked.at(-1)?.kind, "method", "held back by the guard of the page, before the boundary");
      assert.match(guard.blocked.at(-1)?.reasonNl ?? "", /mag niet versturen/);
      // A script does not navigate, so only the boundary sees this. The same goes for another address with the same code.
      const alias = new URL(url).searchParams.get("token")!;
      for (const address of [url, `${origin}/afmelden/?token=${alias}`]) assert.equal(await page.evaluate((target) => fetch(target).then((answer) => answer.status), address), REFUSED_STATUS, address);
      assert.equal(seen.length, 0, "and neither of those reached it");
      assert.ok(!seen.some((entry) => entry.url.includes(TOKEN)));
      assert.ok(eventsOf(recheck).some((event) => event.kind === "refused"));
      assert.equal(await page.evaluate(() => fetch("/verlopen/").then((answer) => answer.status)), 200, "the rest of the site stays open");
    } finally {
      await context.close();
    }
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("the report says that the mail itself was not judged, also when no link was used (#398)", async () => {
  const run = await mailboxRun(origin);
  try {
    assert.ok(mailboxLimitationsNl(run).includes(MAIL_NOT_JUDGED_NL));
    assert.match(MAIL_NOT_JUDGED_NL, /^De e-mail zelf is niet beoordeeld\./);
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    assert.ok(mailboxLimitationsNl(run).includes(MAIL_NOT_JUDGED_NL));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("what an agent gets holds the alias and nothing of the mail", async () => {
  const run = await mailboxRun(origin);
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    const task = agentMailboxNl(run, "loep mail links --run RUN");
    assert.ok(task.includes("loep mail links --run RUN"));
    assert.ok(!task.includes(readMailboxState(run)!.links[0]!.url), "the address is not in the task: a task is hashed");
    assert.ok(!task.includes(TOKEN) && !task.includes("Hallo"));
    const { links } = mailLinks(run);
    assert.deepEqual(links.map((link) => link.url), [readMailboxState(run)!.links[0]!.url]);
    assert.ok(!JSON.stringify(links).includes(TOKEN));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("10: a link the run used is not offered any more, by whichever command asks", async () => {
  const run = await mailboxRun(origin);
  const session = await sessionOn(run);
  const first = `${origin}/voorkeuren/?token=${TOKEN}`;
  try {
    await mailWait(run, { mailbox: memoryBox([mailFor(first)]) });
    const url = readMailboxState(run)!.links[0]!.url;
    assert.deepEqual(mailLinks(run).links.map((link) => link.url), [url]);
    assert.deepEqual(mailLinks(run).used, []);
    await loadPage(session.page, url);
    assert.deepEqual(mailLinks(run).links, [], "opened once");
    assert.deepEqual(mailLinks(run).used.map((link) => link.url), [url]);
    const later = await mailWait(run, { mailbox: memoryBox([mailFor(`${origin}/verder/?token=${TOKEN}A`)]) });
    assert.deepEqual(later.links.map((link) => link.id), ["L2"]);
    assert.deepEqual(later.used.map((link) => link.id), ["L1"]);
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("waiting without a mail ends with what to do, and changes nothing", async () => {
  const run = await mailboxRun(origin);
  try {
    await assert.rejects(mailWait(run, { mailbox: memoryBox([]), timeoutSeconds: 0 }), /geen e-mail aan het adres van de run/);
    assert.deepEqual(readMailboxState(run)!.messages, []);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Cleaning up -------------------------------------------------------------------------------------------------------

test("cleaning up removes the registration through the site, shows it is gone, wipes the mail and searches the run", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(registered, false);
    assert.equal(cleanup.mail.left, 0);
    assert.equal(cleanup.complete, true);
    assert.deepEqual(cleanup.scan.hits, []);
    assert.ok(cleanup.site.steps.some((step) => step.path === "/verlopen/"));
    assert.ok(readMailboxState(run)!.cleanup?.complete);
    assert.ok(cleanupLinesNl(cleanup).at(-1) === "opgeruimd");
    const limits = mailboxLimitationsNl(run).join(" ");
    assert.match(limits, /Mailpit/);
    assert.match(limits, /lokaal gedaan/);
    assert.match(limits, /via de site zelf verwijderd/);
    assert.ok(!limits.includes(ADDRESS));
    assert.deepEqual(inFiles(run, TOKEN), []);
    // Run again, what was proved stays proved.
    assert.equal((await mailCleanup(run, { mailbox: box, browser, settleMs: 0 })).complete, true);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("after a run that broke off a new process cleans up, from what is in the run, and reads the mail it never got to", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    // Nothing else happened: no wait, no session. The mail is still in the mailbox.
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.complete, true);
    assert.equal(cleanup.mail.removed, 1);
    assert.equal(registered, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a registration that cannot be removed is said in the report, and the command can be run again", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/geen-knop/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "failed");
    assert.equal(cleanup.complete, false);
    assert.match(cleanupLinesNl(cleanup).at(-1)!, /ER BLEEF IETS ACHTER/);
    assert.match(mailboxLimitationsNl(run).join(" "), /Er bleef iets achter/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a mailbox that does not answer does not stop the rest, and the report says the mail could stay behind", async () => {
  const run = await mailboxRun(origin);
  const good = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: good });
    const broken: Mailbox = { kind: "mailpit", fetch: async () => Promise.reject(new Error("geen verbinding")), remove: async () => 0 };
    const cleanup = await mailCleanup(run, { mailbox: broken, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(cleanup.mail.left, null);
    assert.equal(cleanup.complete, false);
    assert.match(mailboxLimitationsNl(run).join(" "), /in de mailbox: .*geen verbinding/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("3: a mail that only comes in while the cleanup waits is read first, its link is used, and only then is it wiped", async () => {
  const run = await mailboxRun(origin);
  const mail = mailFor(`${origin}/voorkeuren/?token=${TOKEN}`);
  const box = memoryBox([]);
  let looks = 0;
  const late: Mailbox = { ...box, fetch: async (address, since) => (++looks > 1 && !box.removed.includes(mail.id) ? [mail] : box.fetch(address, since)), remove: async (ids) => {
    assert.ok(readMailboxState(run)!.messages.length > 0, "read before it is wiped");
    return box.remove(ids);
  } };
  try {
    const cleanup = await mailCleanup(run, { mailbox: late, browser, settleMs: 200, pollMs: 20 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(registered, false, "the registration is gone through the link that came in late");
    assert.deepEqual(box.removed, [mail.id]);
    assert.equal(readMailboxState(run)!.links.length, 1);
    assert.equal(cleanup.complete, true);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("3: a mailbox that fails for a moment never leads to wiping what was not read", async () => {
  const run = await mailboxRun(origin);
  const mail = mailFor(`${origin}/voorkeuren/?token=${TOKEN}`);
  const box = memoryBox([mail]);
  let looks = 0;
  const flaky: Mailbox = { ...box, fetch: async (address, since) => (++looks === 1 ? Promise.reject(new Error("verbinding verbroken")) : box.fetch(address, since)), remove: async (ids) => {
    assert.ok(readMailboxState(run)!.messages.length > 0, "read before it is wiped");
    return box.remove(ids);
  } };
  try {
    const cleanup = await mailCleanup(run, { mailbox: flaky, browser, settleMs: 0 });
    assert.equal(readMailboxState(run)!.messages.length, 1);
    assert.deepEqual(box.removed, [mail.id]);
    assert.equal(cleanup.mail.left, 0);
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(cleanup.complete, true);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("3: a mail that cannot be read stays where it is, the report says so, and running it again finishes the job", async () => {
  const run = await mailboxRun(origin);
  const mail = mailFor(`${origin}/voorkeuren/?token=${TOKEN}`);
  const box = memoryBox([mail]);
  const errors = process.stderr.write.bind(process.stderr);
  // The folder for the text of a mail cannot be made: nothing of this mail can be taken in.
  writeFileSync(join(run, "mailbox"), "");
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    const first = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(box.removed, [], "it stays in the mailbox");
    assert.equal(first.mail.left, 1);
    assert.match(first.mail.noteNl!, /niet te lezen was en daarom niet is gewist/);
    assert.match(cleanupLinesNl(first).join("\n"), /1 over/);
    assert.equal(first.complete, false);
    assert.match(mailboxLimitationsNl(run).join(" "), /in de mailbox: .*niet te lezen/);
    rmSync(join(run, "mailbox"));
    const second = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(box.removed, [mail.id]);
    assert.equal(second.site.outcome, "removed", second.site.noteNl);
    assert.equal(second.complete, true, "the promise that it can be run again");
  } finally {
    process.stderr.write = errors;
    rmSync(run, { recursive: true, force: true });
  }
});

test("a confirmation link the run never used stays closed: opening it would turn on what the cleanup has to remove", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/bevestigen/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(seen.filter((request) => request.url.startsWith("/bevestigen/")), [], "the site never got the link");
    assert.equal(cleanup.site.outcome, "failed");
    assert.match(cleanup.site.noteNl, /nooit bevestigd/);
    assert.equal(cleanup.complete, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a confirmation link the run did use is opened again, and leads to the button", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/bevestigen/?token=${TOKEN}`)]);
  const session = await sessionOn(run);
  try {
    const { links } = await mailWait(run, { mailbox: box });
    await loadPage(session.page, links[0]!.url);
    await session.close();
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(registered, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("once the site was asked, no later cleanup opens a link that came after that, whatever the outcome said", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/blijft/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const first = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(first.site.outcome, "not shown", first.site.noteNl);
    const asked = seen.filter((request) => request.method === "POST").length;
    assert.equal(asked, 1);
    // The goodbye mail, with a link that signs up again.
    box.mails.push(mailFor(`${origin}/voorkeuren/opnieuw/?token=${TOKEN}`));
    await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(readMailboxState(run)!.links.length, 2, "it is read, as any mail is");
    assert.deepEqual(seen.filter((request) => request.url.includes("opnieuw")), [], "and never opened");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a press that reached the site is no failure to ask it, also when the page after it was held back", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/weg/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(seen.filter((request) => request.method === "POST").length, 1, "the site got it");
    assert.equal(cleanup.site.outcome, "not shown", cleanup.site.noteNl);
    assert.doesNotMatch(cleanup.site.noteNl, /niet gevraagd/);
    assert.equal(readMailboxState(run)!.askedLinks, 1);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a budget that holds the press back leaves the site unasked, so a later link may still try", async () => {
  const run = await mailboxRun(origin, { maxWrites: 1 });
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "failed", cleanup.site.noteNl);
    assert.match(cleanup.site.noteNl, /niet gevraagd/);
    assert.equal(readMailboxState(run)!.askedLinks, undefined);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("two waits at once lose nothing: each link has its own number, and each is guarded", async () => {
  const run = await mailboxRun(origin);
  const [one, other] = [mailFor(`${origin}/voorkeuren/?token=${TOKEN}`), mailFor(`${origin}/voorkeuren/?token=${TOKEN}b`)];
  const box = memoryBox([]);
  let looks = 0;
  // Each wait sees a mail of its own and then finds the other one gone from the list: as two processes do.
  const shared: Mailbox = { ...box, fetch: async () => [++looks % 2 === 0 ? one : other] };
  try {
    await Promise.all([mailWait(run, { mailbox: shared }), mailWait(run, { mailbox: shared })]);
    const state = readMailboxState(run)!;
    assert.deepEqual(state.links.map((link) => link.id).sort(), ["L1", "L2"]);
    const shield = shieldForRun(run)!;
    for (const link of state.links) assert.equal(shield.guardedId(link.url), link.id);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a run with a file that could not be searched is not called clean", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  writeFileSync(join(run, "dicht.txt"), "x");
  chmodSync(join(run, "dicht.txt"), 0o000);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.complete, false);
    assert.match(cleanup.scan.noteNl ?? "", /dicht\.txt/);
  } finally {
    chmodSync(join(run, "dicht.txt"), 0o600);
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a third-party window on a personal page is no held-back redirect, and the button is still pressed", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/kader/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
    assert.equal(registered, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a link on a page leads no further to a confirmation the run never used, or to signing up", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/met-link/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(seen.filter((request) => /bevestigen|aanmelden/.test(request.url)), []);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: the state with the links is on disk before a mail is deleted, also when deleting fails", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  const failing: Mailbox = { ...box, remove: async () => {
    assert.equal(readMailboxState(run)!.links.length, 1, "written before the mail goes");
    throw new Error("wissen mislukt");
  } };
  try {
    await assert.rejects(mailWait(run, { mailbox: failing }), /wissen mislukt/);
    assert.equal(readMailboxState(run)!.links.length, 1);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: the report says pages were viewed only when the run opened a link, not when one came in or when cleaning up did", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    assert.doesNotMatch(mailboxLimitationsNl(run).join(" "), /zijn bekeken/);
    await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.doesNotMatch(mailboxLimitationsNl(run).join(" "), /zijn bekeken/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
  const opened = await mailboxRun(origin);
  const session = await sessionOn(opened);
  try {
    const { links } = await mailWait(opened, { mailbox: memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]) });
    await loadPage(session.page, links[0]!.url);
    assert.match(mailboxLimitationsNl(opened).join(" "), /zijn bekeken/);
  } finally {
    await session.close();
    rmSync(opened, { recursive: true, force: true });
  }
});

test("fourth review: a cleanup that comes after a press does not say there was no button", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/blijft/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    assert.equal((await mailCleanup(run, { mailbox: box, browser, settleMs: 0 })).site.outcome, "not shown");
    hideButton = true;
    const again = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(again.site.outcome, "not shown", again.site.noteNl);
    assert.doesNotMatch(again.site.noteNl, /geen knop gevonden/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a link that does not open leaves the other links to try", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/kapot/?token=${TOKEN}`), mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(cleanup.site.outcome, "removed", cleanup.site.noteNl);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a kind of link says confirmation first, whatever path it stands under", () => {
  for (const path of ["/manage/confirm/abc", "/beheer/activeer/abc", "/nieuwsbrief/voorkeuren-bevestigen/x"]) assert.equal(linkKind(path), "confirm", path);
  assert.equal(linkKind("/afmelden/bevestigen/abc"), "unsubscribe");
  assert.equal(linkKind("/voorkeuren/abc"), "preferences");
});

test("fourth review: a button that only says it removes something, and is not about the registration, stays unpressed", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/filter/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(seen.filter((request) => request.method === "POST"), []);
    assert.equal(cleanup.site.outcome, "failed", cleanup.site.noteNl);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a one-time link at the end of a redirect is not used up by the check of a recording", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/door/?token=${TOKEN}`), mailFor(`${origin}/eenmalig/?token=${TOKEN}`)]);
  const session = await sessionOn(run);
  try {
    const { links } = await mailWait(run, { mailbox: box });
    await loadPage(session.page, links.find((link) => link.url.includes("/voorkeuren/door/"))!.url);
    await Promise.all([session.page.waitForURL(/eenmalig/), session.page.locator("button").click()]);
    await session.page.waitForLoadState("networkidle");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(seen.filter((request) => request.url.startsWith("/eenmalig/")).length, 1, "only the browser asked for it");
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a link named for unsubscribing later becomes that kind", async () => {
  const run = await mailboxRun(origin);
  const url = `${origin}/u/abc123xyz`;
  const box = memoryBox([mailFor(url), mailFor(`${origin}/voorkeuren/?token=${TOKEN}`, `List-Unsubscribe: <${url}>\r\n`)]);
  try {
    await mailWait(run, { mailbox: box });
    assert.equal(readMailboxState(run)!.links.find((link) => link.unsubscribe)!.kind, "unsubscribe");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a second inventory on a run with a mailbox keeps its address and its links", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const mark = { kind: "mailpit" as const, local: true, declaredAt: "2026-10-30T11:00:00.000Z" };
    await startMailbox(run, { kind: "mailpit", host: "localhost", port: 1, tls: false }, "loep-99999999@example.com", mark, permission(origin));
    assert.equal(readMailboxState(run)!.links.length, 1);
    assert.equal(shieldForRun(run)!.secrets.filter((secret) => secret.source === "mail-adres").length, 1);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: only this machine counts as this machine for a mailbox, not a name that ends in .test", () => {
  const local = permission("http://localhost:8081");
  assert.throws(() => decideMailbox("imap://mail.corp.test:143", local), /poort 993/);
  assert.throws(() => decideMailbox("mailpit://mail.test:8025", local), /alleen voor deze machine/);
});

test("fourth review: IMAP finds a mail that has the address of the run in any place the code accepts", async () => {
  const fake = await fakeImap();
  const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets", password: 'ge"heim' });
  try {
    await box.fetch(ADDRESS, new Date("2026-10-30T10:00:00Z"));
    const search = fake.commands.find((command) => command.includes("UID SEARCH"))!;
    for (const part of ["TO", "CC", "BCC", "HEADER Delivered-To", "HEADER X-Original-To"]) assert.ok(search.includes(part), part);
  } finally {
    await fake.close();
  }
});

test("fourth review: a mail server that stalls before TLS is done does not stop a command", async () => {
  const open: Socket[] = [];
  const silent = createTcpServer((socket) => void open.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: (silent.address() as AddressInfo).port, tls: true }, { user: "toets", password: "x" }, 100);
  try {
    await assert.rejects(box.fetch(ADDRESS, new Date()), /geen antwoord/);
  } finally {
    for (const socket of open) socket.destroy();
    silent.close();
  }
});

test("fifth review: an address or a path in a query is no token, and a public page in a mail stays a public page", () => {
  assert.deepEqual(secretsInUrl("https://site.nl/bevestig?token=a1b2c3d4e5f6a7b8&next=https%3A%2F%2Fsite.nl%2F"), ["a1b2c3d4e5f6a7b8"]);
  assert.deepEqual(secretsInUrl("https://site.nl/x?token=a1b2c3d4e5f6a7b8&next=/mijn/profiel"), ["a1b2c3d4e5f6a7b8"]);
  assert.deepEqual(secretsInUrl("https://site.nl/nieuws/update-q4"), []);
  assert.deepEqual(secretsInUrl("https://site.nl/vacatures/12345678"), []);
  assert.deepEqual(secretsInUrl("https://site.nl/l/Zk3vQ9xT7bLp2nWd"), ["Zk3vQ9xT7bLp2nWd"]);
  assert.deepEqual(secretsInUrl("https://site.nl/x?code=12345678"), ["12345678"]);
  assert.ok(looksSecret("Zk3v/Q9x+T7bLp2nWd5sGh8JmR4cYf6AeU1oKi0tXa"), "a token can hold a slash");
});

test("fifth review: a mail with square brackets around it keeps no code, and the code in the HTML part counts too", async () => {
  const run = await mailboxRun(origin);
  const plain = mailOf(ADDRESS, `[Logo]\nUw code is 483920.\n[Voettekst]`);
  const html = Buffer.from(`From: site@example.com\r\nTo: ${ADDRESS}\r\nSubject: Test\r\nContent-Type: multipart/alternative; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nBekijk deze mail in HTML\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>Uw code is <b>772910</b></p>\r\n--x--\r\n`);
  const box = memoryBox([{ id: "a", receivedAt: Date.parse("2026-10-30T10:00:00Z"), raw: plain }, { id: "b", receivedAt: Date.parse("2026-10-30T10:00:01Z"), raw: html }]);
  try {
    await mailWait(run, { mailbox: box });
    assert.deepEqual(inFiles(run, "483920"), []);
    assert.deepEqual(scanRun(run).hits, []);
    assert.ok(shieldForRun(run)!.secrets.some((secret) => secret.real === "772910"));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a personal link that a script asks for counts as sending too, and a value of a guarded link stays home without permission", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/?token=${TOKEN}`)]);
  const session = await sessionOn(run);
  try {
    const { links } = await mailWait(run, { mailbox: box });
    await loadPage(session.page, `${origin}/`);
    await session.page.evaluate((url) => fetch(url).then((answer) => answer.status), links[0]!.url);
    assert.deepEqual(mailLinks(run).links, [], "the link counts as used");
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a link that removes on being opened counts as asking the site", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/afmelden/direct/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.equal(readMailboxState(run)!.askedLinks, 1);
    assert.equal(cleanup.site.outcome, "not shown", cleanup.site.noteNl);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a beacon of a page that the budget holds back is no refusal of that page", async () => {
  const run = await mailboxRun(origin, { maxWrites: 3 });
  const box = memoryBox([mailFor(`${origin}/voorkeuren/baken/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.ok(!cleanup.site.steps.some((step) => /niet geopend/.test(step.whatNl)), JSON.stringify(cleanup.site.steps));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a button with the code that is about one part of the registration stays unpressed", async () => {
  const run = await mailboxRun(origin);
  const box = memoryBox([mailFor(`${origin}/voorkeuren/onderwerp/?token=${TOKEN}`)]);
  try {
    await mailWait(run, { mailbox: box });
    await mailCleanup(run, { mailbox: box, browser, settleMs: 0 });
    assert.deepEqual(seen.filter((request) => request.method === "POST"), []);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: the address of a run is in small letters, as a site writes it", () => {
  assert.match(runAddress({ kind: "imap", host: "x", port: 993, tls: true }, { LOEP_IMAP_USER: "Jan.Tester@Corp.nl", LOEP_IMAP_PASSWORD: "x" }), /^jan\.tester\+loep-[0-9a-f]{8}@corp\.nl$/);
});

test("fifth review: the time limit of a mailbox holds after the connection stands as well", async () => {
  const open: Socket[] = [];
  const silent = createTcpServer((socket) => void open.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: (silent.address() as AddressInfo).port, tls: false }, { user: "toets", password: "x" }, 100);
  try {
    const started = performance.now();
    await assert.rejects(box.fetch(ADDRESS, new Date()), /geen antwoord/);
    assert.ok(performance.now() - started < 5000);
  } finally {
    for (const socket of open) socket.destroy();
    silent.close();
  }
});

test("a cleanup that never ran is said too", async () => {
  const run = await mailboxRun(origin);
  try {
    assert.match(mailboxLimitationsNl(run).join(" "), /Opruimen: niet gedaan/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a sealed run is not cleaned up in place", async () => {
  const run = await mailboxRun(origin);
  try {
    await seal(run);
    await assert.rejects(mailCleanup(run, { mailbox: memoryBox([]), browser, settleMs: 0 }), /verzegeld/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Without a mailbox -------------------------------------------------------------------------------------------------

test("a run without a mailbox has no shield and no sentence, and what opens a mail refuses", async () => {
  const run = mkdtempSync(join(tmpdir(), "loep-nomail-"));
  try {
    mkdirSync(run, { recursive: true });
    await recordWrites(run, permission(origin));
    assert.ok(writesForRun(run));
    assert.equal(shieldForRun(run), null);
    assert.deepEqual(mailboxLimitationsNl(run), []);
    assert.equal(agentMailboxNl(run, "loep mail links"), "");
    assert.deepEqual(scanRun(run).hits, []);
    await assert.rejects(mailWait(run), /geen mailbox/);
    await assert.rejects(mailCleanup(run), /geen mailbox/);
    const access = writeAccess(run, permission(origin), "test");
    assert.equal(access.origins.length, 1);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});
