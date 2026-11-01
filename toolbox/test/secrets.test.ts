import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs, { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { connect, type AddressInfo, type Socket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { generateCACertificate } from "mockttp";
import * as playwright from "playwright";
import type { Browser, Page } from "playwright";
import { boundaryForContext, boundaryPortsForTest, LOCAL_ONLY_ENV, MAX_REQUEST_BYTES, REFUSED_HEADER, REFUSED_STATUS, setBoundaryNetwork, shieldedFetch } from "../src/browser/boundary.ts";
import { loadPage, newContext, settlePage } from "../src/browser/session.ts";
import { absorbAll } from "../src/commands/mail.ts";
import { seal } from "../src/commands/verify.ts";
import { appendRunLine, writeFileAtomic, writeJson } from "../src/lib/canonical.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE, RUN_SECRETS_FILE, registerSessionSecrets, renewSessionSecrets, SESSION_COOKIE_SOURCE, sessionWithAliases, setRunLogin, writeLoginFile, type LoginSession } from "../src/lib/login.ts";
import { endContextSecrets, MAX_PREVIOUS, MAX_SLOTS, MIN_BINARY_VALUE, maskBytes, maskText, readPrivate, readSecretEvents, readSecretsFile, registerSecret, scanRun, secretLimitationsNl, secretsLinesNl, Shield, shieldForRun, type RunSecret } from "../src/lib/secrets.ts";
import type { ReceivedMail } from "../src/lib/mailbox.ts";
import { notHashed } from "../src/lib/seal.ts";
import { cookieFitsHost } from "../src/lib/timelimits.ts";
import { decideWrites, isThisMachine, recordWrites, trialFetch } from "../src/lib/writes.ts";
import { guardContext, guardedDownload, guardRedirects, guardRedirectsByRoute, scopeForRun, type Guard } from "../src/session/safety.ts";
import { SecondBrowsers } from "../src/session/second.ts";

/*
 * What the boundary promises whatever the source of a secret. The route of a mail stands in
 * `mailbox-boundary.test.ts`; here is what holds for every value in the register.
 */

const TOKEN = "Zk3v/Q9x+T7bLp2nWd5sGh8JmR4cYf6AeU1oKi0tXa";
const COOKIE = "sess-7Hq2Lm9xVt4ZbN1cR8sWy3KdP6gJfA0e";
const STORED = "stored.7Hq2Lm9xVt4ZbN1cR8sWy3KdP6gJfA0e";

const browsers = new Map<string, Promise<Browser>>();
const launched = (name: "chromium" | "firefox" | "webkit"): Promise<Browser> => {
  if (!browsers.has(name)) browsers.set(name, playwright[name].launch());
  return browsers.get(name)!;
};
after(async () => {
  for (const browser of browsers.values()) await (await browser).close();
});

interface Site {
  origin: string;
  server: Server;
  heard: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[];
  close: () => Promise<void>;
}

type Handler = (request: IncomingMessage, response: ServerResponse, body: Buffer) => void;

async function siteWith(handler: Handler, tls?: { key: string; cert: string }, hostName = "127.0.0.1"): Promise<Site> {
  const heard: Site["heard"] = [];
  const listener = (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      heard.push({ method: request.method!, url: request.url!, headers: request.headers, body: body.length > 4096 ? "" : body.toString() });
      handler(request, response, body);
    });
  };
  const server = tls ? createHttpsServer(tls, listener) : createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `${tls ? "https" : "http"}://${hostName}:${(server.address() as AddressInfo).port}`,
    server,
    heard,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const page = (content: string): string => `<!doctype html><html lang="nl"><title>Site</title><body>${content}</body></html>`;
const html = (response: ServerResponse, content: string, headers: Record<string, string | string[]> = {}): void => void response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers }).end(page(content));

function runOn(origin: string): string {
  const run = mkdtempSync(join(tmpdir(), "loep-geheimen-"));
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  return run;
}

interface Session {
  page: Page;
  guard: Guard;
  close: () => Promise<void>;
}

async function sessionOn(run: string, browser: Browser): Promise<Session> {
  const scope = await scopeForRun(run, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  const context = await newContext(browser, { runDir: run });
  await guardContext(context, scope, guard);
  const opened = await context.newPage();
  if (browser.browserType().name() === "chromium") await guardRedirects(opened, scope, guard);
  else await guardRedirectsByRoute(context, scope, guard);
  return { page: opened, guard, close: () => context.close() };
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const filesHolding = (run: string, needle: string): string[] => walk(run).filter((path) => ![RUN_SECRETS_FILE, LOGIN_SESSION_FILE, IDLE_SESSION_FILE].some((name) => path.endsWith(name)) && readFileSync(path).includes(needle));

const secretFor = (real: string, source = "test", origins = ["http://localhost:1"]): RunSecret => ({ real, alias: `alias${"x".repeat(Math.max(real.length, 16) - 5)}`, source, origins, at: "" });

// ---- One call for a new kind of secret ---------------------------------------------------------------------------------

test("a new kind of secret is one call: it goes out real, comes back as its alias, and nothing here knows what it is", async () => {
  const key = "api-9f8e7d6c5b4a39281706f5e4d3c2b1a0";
  const site = await siteWith((request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sleutel: key, gehoord: request.headers["x-api-key"] })));
  const run = runOn(site.origin);
  registerSecret(run, key, { source: "api-sleutel" });
  const alias = readSecretsFile(run)!.secrets[0]!.alias;
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    const text = await session.page.evaluate((header) => fetch("/x", { headers: { "x-api-key": header } }).then((answer) => answer.text()), alias);
    assert.deepEqual(JSON.parse(text), { sleutel: alias, gehoord: alias });
    assert.equal(site.heard.at(-1)!.headers["x-api-key"], key, "the site gets the real value");
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("the register has the same protection as a session file, and keeps what a source wants to keep", () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, TOKEN, { source: "test" });
    assert.equal(statSync(join(run, RUN_SECRETS_FILE)).mode & 0o777, 0o600);
    assert.equal(notHashed(RUN_SECRETS_FILE), true);
    assert.match(readFileSync(join(run, ".gitignore"), "utf8"), /secrets\.json/);
    assert.equal(readPrivate(run, "niets"), null);
    assert.equal(readSecretsFile(run)!.secrets[0]!.origins[0], "http://localhost:1", "without a reach, the site of the run");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a value only goes to where it belongs", () => {
  const shield = new Shield({ secrets: [{ ...secretFor(COOKIE), origins: ["https://a.example"], domains: [".site.example"] }, { ...secretFor(TOKEN), alias: "other-alias-other-alias-other-alias-other-a", origins: ["https://b.example"] }] });
  const alias = shield.secrets[0]!.alias;
  const other = shield.secrets[1]!.alias;
  assert.equal(shield.covers("https://www.site.example/x"), true);
  assert.equal(shield.covers("https://site.example/x"), true);
  assert.equal(shield.covers("https://nosite.example/x"), false);
  assert.equal(shield.reaching("https://a.example/").outward(`${alias} ${other}`), `${COOKIE} ${other}`);
  assert.equal(shield.reaching("https://b.example/").outward(`${alias} ${other}`), `${alias} ${TOKEN}`);
  assert.equal(shield.outOfReach(`https://c.example/?t=${alias}`), true);
  assert.equal(shield.outOfReach(`https://www.site.example/?t=${alias}`), false);
  assert.equal(shield.outOfReach("https://c.example/?t=gewoon"), false);
});

// ---- A: only the own browser -------------------------------------------------------------------------------------------

/** A raw request to a port on this machine: what came back, or null when the connection closed without a word. */
const raw = (port: number, text: string): Promise<string | null> =>
  new Promise((resolve) => {
    const socket: Socket = connect(port, "127.0.0.1");
    let answer = "";
    socket.on("data", (data) => (answer += data.toString("latin1")));
    socket.on("error", () => resolve(answer || null));
    socket.on("close", () => resolve(answer || null));
    socket.write(text);
    setTimeout(() => socket.destroy(), 2000);
  });

test("A: only the own browser can use the proxy: without the password it gets nothing, and around the gate neither", async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const browser = await launched("chromium");
  const session = await sessionOn(run, browser);
  try {
    const before = site.heard.length;
    const { gate, inner, proxy } = await boundaryPortsForTest(run);
    const host = new URL(site.origin).host;
    const plain = `GET ${site.origin}/geheim HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
    const tunnel = `CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
    assert.match((await raw(gate, plain))!, /^HTTP\/1\.1 407/);
    assert.match((await raw(gate, tunnel))!, /^HTTP\/1\.1 407/);
    const wrong = Buffer.from(`${proxy.username}:fout`).toString("base64");
    assert.match((await raw(gate, plain.replace("Connection:", `Proxy-Authorization: Basic ${wrong}\r\nConnection:`)))!, /^HTTP\/1\.1 407/);
    // The port of mockttp itself: it answers a CONNECT with 200 by itself, so what counts is that nothing goes through.
    assert.ok(!((await raw(inner, plain)) ?? "").includes("<h1>Site</h1>"), "a request straight to mockttp");
    assert.ok(!((await raw(inner, `${tunnel}GET /geheim HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)) ?? "").includes("<h1>Site</h1>"), "a tunnel straight to mockttp");
    assert.equal(site.heard.length, before, "the site heard nothing of it");
    const right = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
    assert.match((await raw(gate, plain.replace("Connection:", `Proxy-Authorization: Basic ${right}\r\nConnection:`)))!, /<h1>Site<\/h1>/, "the same request with the password does pass, so the refusals above are about the password");
    assert.equal(site.heard.at(-1)!.headers["proxy-authorization"], undefined, "the password stops at the proxy");
    const outside = Object.values(networkInterfaces()).flat().find((address) => address && !address.internal && address.family === "IPv4");
    if (outside) {
      const reached = await new Promise<boolean>((resolve) => {
        const probe = connect(inner, outside.address);
        probe.once("connect", () => (probe.destroy(), resolve(true)));
        probe.once("error", () => resolve(false));
      });
      assert.equal(reached, false, "mockttp listens on this machine only");
    }
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- B: certificates ---------------------------------------------------------------------------------------------------

const HOST_NAME = "site.loep-test.example";

/** A name server that says that every name is this machine. */
async function nameServer(): Promise<{ address: string; close: () => void }> {
  const { createSocket } = await import("node:dgram");
  const server = createSocket("udp4");
  server.on("message", (query, peer) => {
    const end = query.indexOf(0, 12) + 5;
    const isA = query.readUInt16BE(end - 4) === 1;
    const head = Buffer.from(query.subarray(0, 12));
    head.writeUInt16BE(0x8180, 2);
    head.writeUInt16BE(isA ? 1 : 0, 6);
    head.writeUInt32BE(0, 8);
    server.send(Buffer.concat([head, query.subarray(12, end), ...(isA ? [Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1])] : [])]), peer.port, peer.address);
  });
  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
  return { address: `127.0.0.1:${server.address().port}`, close: () => server.close() };
}

for (const [name, trust] of [["a certificate nobody vouches for", false], ["a certificate for another name", true]] as const) {
  test(`B: a site with ${name} is not reached, and the browser, which ignores errors towards the proxy, cannot pass that on`, async () => {
    const cert = await generateCACertificate({ subject: { commonName: trust ? "iemand-anders.example" : HOST_NAME } });
    const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"), cert, HOST_NAME);
    const names = await nameServer();
    setBoundaryNetwork({ lookup: { servers: [names.address] }, ...(trust ? { trustedCa: [cert.cert] } : {}) });
    const run = runOn(site.origin);
    registerSecret(run, TOKEN, { source: "test" });
    const session = await sessionOn(run, await launched("chromium"));
    try {
      await assert.rejects(session.page.goto(`${site.origin}/`), /ERR_/);
      assert.equal(site.heard.length, 0, "the site was asked nothing");
      const events = readSecretEvents(run).filter((event) => event.kind === "unreachable");
      assert.equal(events.length >= 1, true, "and that stands in the log of the run");
      assert.match(events[0]!.noteNl, /niet bereikt/);
    } finally {
      await session.close();
      setBoundaryNetwork({});
      names.close();
      await site.close();
      rmSync(run, { recursive: true, force: true });
    }
  });
}

test("B: a self-signed site on this machine keeps working", async () => {
  const cert = await generateCACertificate({ subject: { commonName: "localhost" } });
  const site = await siteWith((_request, response) => html(response, `<h1>Lokaal</h1><p>${TOKEN}</p>`), cert);
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("chromium"));
  try {
    assert.equal((await loadPage(session.page, `${site.origin}/`)).status, 200);
    assert.equal(await session.page.locator("h1").textContent(), "Lokaal");
    assert.ok(!(await session.page.content()).includes(TOKEN));
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- C and H: what the boundary refuses --------------------------------------------------------------------------------

test("C: a redirect to another origin with an alias in it is held back and noted, in the browser and in the run", async () => {
  const other = await siteWith((_request, response) => html(response, "<h1>Elders</h1>"));
  const site = await siteWith((request, response) => {
    if (request.url === "/weg") return void response.writeHead(302, { location: `${other.origin}/ontvangen?token=${encodeURIComponent(TOKEN)}` }).end();
    if (request.url === "/gewoon-weg") return void response.writeHead(302, { location: `${other.origin}/zonder` }).end();
    html(response, "<h1>Site</h1>");
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    const status = await session.page.evaluate(() => fetch("/weg").then((answer) => answer.status));
    assert.equal(status, REFUSED_STATUS);
    assert.equal(other.heard.length, 0, "the other origin heard nothing");
    const refused = session.guard.blocked.find((entry) => entry.kind === "boundary");
    assert.match(refused?.reasonNl ?? "", /doorverwijzing is tegengehouden/);
    const events = readSecretEvents(run).filter((event) => event.kind === "refused");
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes(encodeURIComponent(TOKEN)));
    assert.deepEqual(filesHolding(run, encodeURIComponent(TOKEN)), []);
  } finally {
    await session.close();
    await site.close();
    await other.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("H: a request the boundary refuses for its size says so, in what the session reports, and is no answer of the site", async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  const run = runOn(site.origin);
  await recordWrites(run, { ...decideWrites(`${site.origin}/`, { allowWrites: true })!, maxWrites: 10, spacingSeconds: 0 });
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    const before = site.heard.length;
    const answer = await session.page.evaluate(
      ({ size, header }) => fetch("/upload", { method: "POST", body: new Uint8Array(size) }).then(async (result) => ({ status: result.status, text: await result.text(), marked: result.headers.has(header) })),
      { size: MAX_REQUEST_BYTES + 1, header: REFUSED_HEADER },
    );
    assert.equal(answer.status, REFUSED_STATUS, "a status no site uses");
    assert.match(answer.text, /^loep: /);
    assert.equal(answer.marked, true);
    assert.equal(site.heard.length, before, "the site got nothing");
    const seen = session.guard.blocked.find((entry) => entry.kind === "boundary");
    assert.match(seen?.reasonNl ?? "", /te groot/, "it stands in what a session reports");
    assert.equal(seen?.method, "POST");
    assert.match(readSecretEvents(run).find((event) => event.kind === "refused")?.noteNl ?? "", /te groot/);
    assert.match(secretLimitationsNl(run).join(" "), /weigerde de grens/);
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("with the setting for a trial on this machine the boundary refuses every other address, and notes it", async () => {
  const site = await siteWith((_request, response) => html(response, `<h1>Site</h1><img alt="" src="http://elders.example/beeld.png">`));
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  process.env[LOCAL_ONLY_ENV] = "1";
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.locator("h1").textContent(), "Site");
    assert.match(readSecretEvents(run).find((event) => event.kind === "refused")?.where ?? "", /elders\.example/);
    assert.equal(session.guard.blocked.find((entry) => entry.kind === "boundary")?.resourceType, "image");
  } finally {
    delete process.env[LOCAL_ONLY_ENV];
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- D: a value in part escaped ----------------------------------------------------------------------------------------

test("D: a token that a template escaped in part is one value, whatever the mix", () => {
  const alias = "a".repeat(TOKEN.length);
  const shield = new Shield({ secrets: [{ ...secretFor(TOKEN), alias }] });
  const plus = TOKEN.indexOf("+");
  const slash = TOKEN.indexOf("/");
  const forms = [
    TOKEN.replace("+", "&#43;"),
    TOKEN.replace("+", "&#x2B;"),
    TOKEN.replace("+", "&#x2b;").replace("/", "\\/"),
    TOKEN.replace("+", "%2B").replace("/", "/"),
    TOKEN.replace("+", "%2b").replace("/", "%2F"),
    TOKEN.replace("+", "\\u002B").replace("/", "&sol;"),
    TOKEN.replace("+", "+").replace("/", "&#47;"),
    TOKEN.replace("+", "&plus;"),
    TOKEN.replace("+", "\\x2b"),
    `${TOKEN.slice(0, slash)}&#47${TOKEN.slice(slash + 1)}`,
    // Every letter as a number, as a page does to keep an address from a harvester.
    [...TOKEN].map((character) => `&#${character.charCodeAt(0)};`).join(""),
    [...TOKEN].map((character, index) => (index % 2 === 0 ? `&#x${character.charCodeAt(0).toString(16)};` : character)).join(""),
  ];
  assert.ok(plus > 0);
  for (const form of forms) assert.equal(shield.inward(`<p>${form}</p>`), `<p>${alias}</p>`, form);
});

test("D: what stays: a value escaped twice, in capitals of its own, or cut in two by a tag; the search still finds what is base64", () => {
  const alias = "a".repeat(TOKEN.length);
  const shield = new Shield({ secrets: [{ ...secretFor(TOKEN), alias }] });
  for (const form of [TOKEN.replace("+", "%252B"), TOKEN.toUpperCase(), `${TOKEN.slice(0, 9)}<b>${TOKEN.slice(9)}</b>`]) assert.equal(shield.inward(form), form, form);
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, TOKEN, { source: "test" });
    writeFileSync(join(run, "kopie.txt"), Buffer.from(`a${TOKEN}`).toString("base64"));
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["kopie.txt"]);
    rmSync(join(run, "kopie.txt"));
    writeFileSync(join(run, "half.html"), TOKEN.replace("+", "&#43;"));
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["half.html"], "the mixed forms are searched for too");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- E: binary answers -------------------------------------------------------------------------------------------------

test("E: a binary answer loses what is long enough, keeps a short code and says so; the same code in text is swapped", async () => {
  const code = "483920";
  const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from(TOKEN), Buffer.from([0, 1]), Buffer.from(code), Buffer.from([2])]);
  const site = await siteWith((request, response) => {
    if (request.url === "/plaatje.png") return void response.writeHead(200, { "content-type": "image/png" }).end(binary);
    if (request.url === "/ingepakt.bin") return void response.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": "gzip" }).end(gzipSync(binary));
    html(response, `<p id="code">${code}</p><p id="token">${TOKEN}</p>`);
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "lang" });
  registerSecret(run, code, { source: "kort" });
  assert.ok(code.length < MIN_BINARY_VALUE && TOKEN.length >= MIN_BINARY_VALUE);
  const [long, short] = readSecretsFile(run)!.secrets;
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.locator("#code").textContent(), short!.alias);
    for (const path of ["/plaatje.png", "/ingepakt.bin"]) {
      const bytes = await session.page.evaluate((address) => fetch(address).then((answer) => answer.arrayBuffer()).then((buffer) => [...new Uint8Array(buffer)]), path);
      const text = Buffer.from(bytes).toString("latin1");
      assert.ok(!text.includes(TOKEN), path);
      assert.ok(text.includes(long!.alias), path);
      assert.ok(text.includes(code), `${path}: the short code stays, it could stand there by chance`);
    }
    const noted = readSecretEvents(run).filter((event) => event.kind === "short-in-binary");
    assert.equal(noted.length, 2);
    assert.equal(noted[0]!.source, "kort");
    assert.match(secretLimitationsNl(run).join(" "), /korte code in een binair antwoord/);
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("E: the search takes a short value in a picture for what it is, and in any other file for a leak", () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, "483920", { source: "kort" });
    writeFileSync(join(run, "plaatje.png"), Buffer.from("xx483920xx"));
    assert.deepEqual(scanRun(run).hits, []);
    writeFileSync(join(run, "waarneming.json"), `{"code":"483920"}`);
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["waarneming.json"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- F: what came in before it was known -------------------------------------------------------------------------------

test("F: a value that came in before it was known is found, stays where it is, and whoever leads the evaluation sees it", async () => {
  const run = runOn("http://localhost:1");
  const late = "laat-7Hq2Lm9xVt4ZbN1cR8sWy3KdP6gJfA0e";
  try {
    registerSecret(run, TOKEN, { source: "test" });
    assert.deepEqual(readSecretEvents(run), []);
    writeFileSync(join(run, "eerder.json"), JSON.stringify({ page: `https://site.example/?t=${late}` }));
    registerSecret(run, late, { source: "later-bekend" });
    const [event] = readSecretEvents(run);
    assert.equal(event?.kind, "found-in-run");
    assert.equal(event?.where, "eerder.json");
    assert.equal(event?.source, "later-bekend");
    assert.ok(readFileSync(join(run, "eerder.json"), "utf8").includes(late), "not blanked behind anybody's back");
    assert.ok(!JSON.stringify(readSecretEvents(run)).includes(late));
    assert.match(secretLimitationsNl(run).join(" "), /stond een waarde al in de run/);
    assert.match(secretsLinesNl(run).join("\n"), /eerder\.json \(later-bekend\)/);
    assert.ok(!secretsLinesNl(run).join("\n").includes(late));
    await assert.rejects(seal(run), /eerder\.json/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- The second layer --------------------------------------------------------------------------------------------------

test("what passes a place that writes loses a known value there, and that is noted; outside a run with secrets nothing changes", async () => {
  const run = runOn("http://localhost:1");
  const clean = mkdtempSync(join(tmpdir(), "loep-geen-geheimen-"));
  try {
    registerSecret(run, TOKEN, { source: "test" });
    const alias = readSecretsFile(run)!.secrets[0]!.alias;
    await writeJson(join(run, "pages", "p1", "facts.json"), { title: `pagina ${TOKEN}` });
    await writeFileAtomic(join(run, "pages", "p1", "page.html"), `<p>${TOKEN.replace("+", "&#43;")}</p>`);
    await writeFileAtomic(join(run, "pages", "p1", "bytes.txt"), Buffer.from(`x${TOKEN}x`));
    appendRunLine(join(run, "log.jsonl"), `${JSON.stringify({ url: `https://s.example/?t=${encodeURIComponent(TOKEN)}` })}\n`);
    assert.deepEqual(filesHolding(run, TOKEN), []);
    assert.deepEqual(filesHolding(run, encodeURIComponent(TOKEN)), []);
    assert.ok(readFileSync(join(run, "pages", "p1", "facts.json"), "utf8").includes(alias));
    assert.deepEqual(readSecretEvents(run).map((event) => [event.kind, event.where]), [
      ["masked", "pages/p1/facts.json"],
      ["masked", "pages/p1/page.html"],
      ["masked", "pages/p1/bytes.txt"],
      ["masked", "log.jsonl"],
    ]);
    assert.deepEqual(scanRun(run).hits, []);
    const text = `titel ${TOKEN}`;
    assert.equal(maskText(join(clean, "a.json"), text), text);
    const bytes = Buffer.from(text);
    assert.equal(maskBytes(join(clean, "a.bin"), bytes), bytes, "the same object: not a byte was touched");
  } finally {
    rmSync(run, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});

// ---- What the library prints -------------------------------------------------------------------------------------------

test("what mockttp prints about a socket that was turned down holds no real value", async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  site.server.on("upgrade", (_request, socket) => (socket as Socket).end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"));
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const alias = readSecretsFile(run)!.secrets[0]!.alias;
  const session = await sessionOn(run, await launched("chromium"));
  const printed: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const errors = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string) => (printed.push(String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => (printed.push(String(chunk)), true)) as typeof process.stderr.write;
  try {
    await loadPage(session.page, `${site.origin}/`);
    await session.page.evaluate(
      (code) =>
        new Promise<void>((resolve) => {
          const socket = new WebSocket(`ws://${location.host}/stroom?token=${code}`);
          socket.onerror = () => resolve();
          socket.onclose = () => resolve();
        }),
      alias,
    );
  } finally {
    process.stdout.write = write;
    process.stderr.write = errors;
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
  assert.ok(printed.some((line) => line.includes("Unexpected websocket response")), "mockttp did print");
  assert.ok(!printed.join("").includes(encodeURIComponent(TOKEN)));
  assert.ok(!printed.join("").includes(TOKEN));
});

// ---- A session is a source like any other ----------------------------------------------------------------------------

function loginSession(origin: string): LoginSession {
  const { hostname } = new URL(origin);
  return {
    schema: "loep/login-session/1",
    origin,
    loginUrl: `${origin}/inloggen`,
    landingUrl: `${origin}/mijn`,
    role: "aanvrager",
    loggedInAt: "2026-10-30T10:00:00.000Z",
    storageState: {
      cookies: [
        { name: "sessie", value: COOKIE, domain: hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
        { name: "taal", value: "nl", domain: hostname, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [{ origin, localStorage: [{ name: "token", value: STORED }, { name: "profiel", value: JSON.stringify({ thema: "donker", jwt: `${STORED}x` }) }] }],
    },
  };
}

test("the values of a session are in the register, the browser starts with aliases, and a small value stays what it is", () => {
  const run = runOn("http://localhost:1");
  try {
    const session = loginSession("http://localhost:1");
    writeLoginFile(join(run, LOGIN_SESSION_FILE), session);
    writeLoginFile(join(run, IDLE_SESSION_FILE), { ...session, storageState: { ...session.storageState, cookies: [{ ...session.storageState.cookies[0]!, value: `${COOKIE}-rust` }], origins: [] } });
    registerSessionSecrets(run);
    const file = readSecretsFile(run)!;
    assert.deepEqual(file.secrets.map((secret) => secret.real).sort(), [COOKIE, `${COOKIE}-rust`, STORED, `${STORED}x`].sort());
    assert.deepEqual([...new Set(file.secrets.map((secret) => secret.source))].sort(), ["sessie-cookie", "sessie-opslag"]);
    const aliased = sessionWithAliases(run, session.storageState);
    assert.ok(!JSON.stringify(aliased).includes(COOKIE) && !JSON.stringify(aliased).includes(STORED));
    assert.equal(aliased.cookies[1]!.value, "nl");
    assert.deepEqual(Object.keys(JSON.parse(aliased.origins[0]!.localStorage[1]!.value) as object), ["thema", "jwt"], "a stored object keeps its shape");
    registerSessionSecrets(run);
    assert.equal(readSecretsFile(run)!.secrets.length, 4, "done again it adds nothing");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a session cookie is nowhere in the run after a run with a login, the site gets it, and one the site renews is a secret at once", async () => {
  const renewed = "vernieuwd-Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz";
  const site = await siteWith((request, response) => {
    const cookie = request.headers.cookie ?? "";
    if (request.url === "/vernieuw") return html(response, "<h1>Vernieuwd</h1>", { "set-cookie": `sessie=${renewed}; Path=/; HttpOnly` });
    if (!cookie.includes(`sessie=${COOKIE}`) && !cookie.includes(`sessie=${renewed}`)) return void response.writeHead(303, { location: "/inloggen" }).end();
    // A page behind the login that says what it got: a site that echoes a session is what this is for.
    html(response, `<h1>Mijn pagina</h1><p id="echo">${cookie}</p><script>window.gezien = localStorage.getItem("token");</script>`);
  });
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), loginSession(site.origin));
  setRunLogin(run);
  const browser = await launched("chromium");
  const session = await sessionOn(run, browser);
  try {
    await loadPage(session.page, `${site.origin}/mijn`);
    assert.equal(await session.page.locator("h1").textContent(), "Mijn pagina", "logged in");
    assert.ok(site.heard.at(-1)!.headers.cookie?.includes(`sessie=${COOKIE}`), "the site got the real cookie");
    const echoed = await session.page.locator("#echo").textContent();
    assert.ok(!echoed!.includes(COOKIE));
    assert.ok(!(await session.page.context().cookies()).some((cookie) => cookie.value.includes(COOKIE)));
    const stored = await session.page.evaluate(() => (window as unknown as { gezien: string }).gezien);
    assert.notEqual(stored, STORED);
    // What a run keeps of it: the page, and what a session writes.
    await writeFileAtomic(join(run, "pages", "p1", "page.html"), await session.page.content());
    await writeJson(join(run, "observations", "o1.json"), { cookies: await session.page.context().cookies(), url: session.page.url(), storage: stored });

    await loadPage(session.page, `${site.origin}/vernieuw`);
    assert.ok(readSecretsFile(run)!.secrets.some((secret) => secret.real === renewed), "a new session value is a secret from now on");
    assert.ok(!(await session.page.context().cookies()).some((cookie) => cookie.value === renewed), "and the browser got its alias");
    await loadPage(session.page, `${site.origin}/mijn`);
    assert.equal(await session.page.locator("h1").textContent(), "Mijn pagina", "and with that alias it stays logged in");
    assert.ok(site.heard.at(-1)!.headers.cookie?.includes(`sessie=${renewed}`));

    for (const value of [COOKIE, STORED, renewed]) assert.deepEqual(filesHolding(run, value), [], value);
    assert.deepEqual(scanRun(run).hits, []);
    assert.deepEqual(readSecretEvents(run).filter((event) => event.kind === "masked"), [], "the boundary held it: the second layer had nothing to do");
    await seal(run);
  } finally {
    setRunLogin(null);
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

const WEBKIT_HERE = { skip: !SecondBrowsers.installed("webkit") };

test("WebKit on a site on this machine: nothing leaves the browser by itself, whatever a page asks for, and it keeps its real address", WEBKIT_HERE, async () => {
  const renewed = "vernieuwd-Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz";
  const css = "@import '/geimporteerd.css'; @font-face { font-family: Eigen; src: url('/letter.woff2'); } body { font-family: Eigen; background: url('/achtergrond.gif'); }";
  const site = await siteWith((request, response) => {
    const cookie = request.headers.cookie ?? "";
    const loggedIn = cookie.includes(`sessie=${COOKIE}`) || cookie.includes(`sessie=${renewed}`);
    const path = request.url!.replace(/^http:\/\/[^/]+/, "");
    if (path === "/start") return void response.writeHead(302, { location: `http://${request.headers.host}/tussen` }).end();
    if (path === "/tussen") return void response.writeHead(302, { location: "/mijn", "set-cookie": `sessie=${renewed}; Path=/` }).end();
    if (path === "/verstuur") return void response.writeHead(303, { location: "/mijn" }).end();
    if (path === "/json") return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ingelogd: loggedIn }));
    if (path === "/stijl.css") return void response.writeHead(200, { "content-type": "text/css" }).end(css);
    if (path === "/kader") return html(response, `<h1>Kader</h1><img alt="" src="/in-kader.gif">`);
    if (path === "/mijn") {
      if (!loggedIn) return void response.writeHead(303, { location: "/inloggen" }).end();
      return html(response, `<h1>Mijn pagina</h1><p id="echo">${cookie}</p><link rel="stylesheet" href="/stijl.css"><link rel="prefetch" href="/vooruit"><link rel="preload" as="image" href="/vooraf.gif"><link rel="icon" href="/icoon.png">${[1, 2, 3, 4, 5, 6].map((index) => `<img alt="" src="/plaatje${index}.gif">`).join("")}<img alt="" srcset="/srcset.gif 1x"><video src="/film.mp4" preload="auto"></video><audio src="/geluid.mp3" preload="auto"></audio><iframe title="Kader" src="/kader"></iframe><script>navigator.sendBeacon("/baken", "x"); new EventSource("/stroom"); new Worker(URL.createObjectURL(new Blob(['fetch(self.location.origin + "/uit-worker")'])));</script><form method="post" action="/verstuur"><button>Stuur</button></form>`);
    }
    void response.writeHead(200, { "content-type": "text/plain" }).end("x");
  });
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), loginSession(site.origin));
  await recordWrites(run, { ...decideWrites(`${site.origin}/`, { allowWrites: true })!, maxWrites: 100, spacingSeconds: 0 });
  setRunLogin(run);
  const session = await sessionOn(run, await launched("webkit"));
  try {
    const answer = await loadPage(session.page, `${site.origin}/start`);
    assert.equal(answer.finalUrl, `${site.origin}/mijn`, "loadPage ends where the redirect ends");
    assert.equal(answer.status, 200);
    assert.equal(await session.page.locator("h1").first().textContent(), "Mijn pagina");
    assert.equal(await session.page.evaluate(() => location.href), `${site.origin}/mijn`, "the page keeps its real address");
    assert.equal(await session.page.evaluate(() => isSecureContext), true, "and with it a secure context");
    assert.ok(!(await session.page.locator("#echo").textContent())!.includes(renewed), "the page got the alias");
    assert.ok(site.heard.some((request) => request.url === "/plaatje6.gif"));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const data = await session.page.evaluate(() => fetch("/json").then((reply) => reply.json() as Promise<{ ingelogd: boolean }>));
    assert.equal(data.ingelogd, true, "a script has the session");
    await session.page.locator("button").click();
    await session.page.waitForURL(/\/mijn$/);
    await settlePage(session.page);
    assert.equal(await session.page.locator("h1").first().textContent(), "Mijn pagina", "a form that redirects ends on its page");

    const past = site.heard.filter((request) => request.url.startsWith("http") || (!request.headers.cookie?.includes("sessie=") && request.url !== "/start"));
    assert.deepEqual(past.map((request) => request.url), [], "what reached the site without the real session went past the proxy");
    await writeFileAtomic(join(run, "pages", "p1", "page.html"), await session.page.content());
    for (const value of [COOKIE, renewed]) assert.deepEqual(filesHolding(run, value), [], value);
    assert.deepEqual(scanRun(run).hits, []);
  } finally {
    setRunLogin(null);
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("WebKit on a site on this machine: a socket stays closed and says so, and the page measures as without a boundary", WEBKIT_HERE, async () => {
  const content = `<h1>Pagina</h1><nav aria-label="Hoofd"><a href="/een">Een</a></nav><main><form><label>Naam <input></label><button>Zoek</button></form></main>`;
  const site = await siteWith((_request, response) => html(response, content));
  const measure = async (run: string): Promise<unknown> => {
    const session = await sessionOn(run, await launched("webkit"));
    try {
      await loadPage(session.page, `${site.origin}/`);
      return { tree: await session.page.locator("html").ariaSnapshot(), tabs: await session.page.evaluate(() => [...document.querySelectorAll("a, input, button")].map((element) => (element as HTMLElement).tabIndex)), box: await session.page.locator("button").boundingBox(), secure: await session.page.evaluate(() => isSecureContext) };
    } finally {
      await session.close();
    }
  };
  const plain = runOn(site.origin);
  const shielded = runOn(site.origin);
  registerSecret(shielded, TOKEN, { source: "test" });
  try {
    assert.deepEqual(await measure(shielded), await measure(plain), "the same page gives the same measurements");
    const session = await sessionOn(shielded, await launched("webkit"));
    try {
      await loadPage(session.page, `${site.origin}/`);
      await session.page.evaluate((origin) => void new WebSocket(`${origin.replace("http", "ws")}/stroom`), site.origin);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(session.guard.blocked.some((entry) => entry.kind === "boundary" && entry.resourceType === "websocket"));
    } finally {
      await session.close();
    }
  } finally {
    await site.close();
    rmSync(plain, { recursive: true, force: true });
    rmSync(shielded, { recursive: true, force: true });
  }
});

test("a window that a page opens stays possible, whatever the browser, also without secrets", async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  const run = runOn(site.origin);
  const context = await newContext(await launched("chromium"), { runDir: run, writes: null });
  try {
    const page = await context.newPage();
    await loadPage(page, `${site.origin}/`);
    const [popup] = await Promise.all([context.waitForEvent("page"), page.evaluate((url) => void window.open(url), `${site.origin}/venster`)]);
    await popup.waitForLoadState("load");
    assert.equal(await popup.locator("h1").textContent(), "Site");
  } finally {
    await context.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a browser that does not show it stays inside the boundary is refused, before it asks a site anything", async () => {
  const run = runOn("http://localhost:1");
  registerSecret(run, TOKEN, { source: "test" });
  let closed = (): void => undefined;
  const outside = { browserType: () => ({ name: () => "buiten" }), once: (_event: string, done: () => void) => void (closed = done), newContext: async () => ({ newPage: async () => ({ goto: async () => null }), close: async () => undefined }) } as unknown as Browser;
  try {
    await assert.rejects(boundaryForContext(outside, run), /doet in deze run niet mee/);
  } finally {
    closed();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a request leaves through one place: nothing else in the source sends one on by itself", () => {
  const places = ["src/browser/session.ts", "src/session/safety.ts"].flatMap((file) => readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), file), "utf8").split("\n").filter((line) => line.includes("route.continue(")));
  assert.equal(places.length, 2, places.join("\n"));
  assert.ok(places.some((line) => /return route\.continue\(\);$/.test(line) && line.includes("withoutConnections")));
  assert.ok(places.some((line) => line.includes("data|blob")));
});

test("WebKit on a site on this machine: a redirect that does not stop, or asks for something a route cannot give, ends in an answer", WEBKIT_HERE, async () => {
  let looped = 0;
  const site = await siteWith((request, response) => {
    if (request.url === "/lus1" || request.url === "/lus2") {
      looped++;
      return void response.writeHead(302, { location: request.url === "/lus1" ? "/lus2" : "/lus1" }).end();
    }
    if (request.url === "/deel") return void response.writeHead(308, { location: "/deel/" }).end();
    if (request.url === "/kaal") return void response.writeHead(300).end();
    if (request.url === "/naar-leeg") return void response.writeHead(302, { location: "/leeg" }).end();
    if (request.url === "/leeg") return void response.writeHead(204).end();
    if (request.url === "/naar-buiten") return void response.writeHead(302, { location: "http://elders.invalid/" }).end();
    html(response, `<h1>${request.url}</h1>`);
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("webkit"));
  try {
    assert.equal((await loadPage(session.page, `${site.origin}/deel`)).finalUrl, `${site.origin}/deel/`, "a plain page after a 308 stands on its own address");
    assert.equal((await loadPage(session.page, `${site.origin}/lus1`)).status, 502);
    assert.ok(looped <= 25, `${looped} requests for a redirect that does not stop`);
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.evaluate(() => fetch("/kaal").then((answer) => answer.status)), 502, "a status without an address gets an answer");
    assert.equal(await session.page.evaluate(() => fetch("/naar-buiten").then((answer) => answer.status, () => 0)), 0, "a script stays inside the scope");
    const started = performance.now();
    await loadPage(session.page, `${site.origin}/naar-leeg`);
    assert.ok(performance.now() - started < 30_000, "an empty answer after a redirect does not wait for a time limit");
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- A short value is no substring -------------------------------------------------------------------------------------

const CODE = "483920";

test("1: a short code only counts as a word of its own: never inside a number, a hash, a time or an address", () => {
  const alias = "alias-van-de-code";
  const shield = new Shield({ secrets: [{ ...secretFor(CODE), alias }] });
  for (const kept of ["1483920", "4839201", "a483920", "483920b", "order-483920", "483920_x", "3.483920", "483920.5", "1,483920", "10:483920", "9f483920ab", "2026-10-30T10:48:39.483920Z", "http://localhost:483920/start"]) assert.equal(shield.inward(`<p>${kept}</p>`), `<p>${kept}</p>`, kept);
  for (const [form, swapped] of [["Je code is 483920.", `Je code is ${alias}.`], ["<td>483920</td>", `<td>${alias}</td>`], ["?code=483920&x=1", `?code=${alias}&x=1`], ["%3D483920%26", `%3D${alias}%26`], ["/mail/483920/voorkeuren", `/mail/${alias}/voorkeuren`], ["code:483920", `code:${alias}`], ["&#52;83920", alias]] as const) assert.equal(shield.inward(form), swapped, form);
});

test("1: in data a short code only counts between quotes, so a number stays a number and the JSON stays JSON", () => {
  const alias = "alias-van-de-code";
  const shield = new Shield({ secrets: [{ ...secretFor(CODE), alias }] });
  const json = JSON.stringify({ bytes: 483920, list: [483920, 1483920], at: "2026-10-30T10:48:39.483920Z", sha256: "ab483920cd", code: "483920", tekst: "je code is 483920" });
  const expected = { bytes: 483920, list: [483920, 1483920], at: "2026-10-30T10:48:39.483920Z", sha256: "ab483920cd", code: alias, tekst: `je code is ${alias}` };
  assert.deepEqual(JSON.parse(shield.inwardBody(Buffer.from(json), "application/json").data.toString()), expected);
  assert.deepEqual(JSON.parse(shield.inwardBody(Buffer.from(json), "text/plain").data.toString()), expected, "by its shape, also under another type");
  assert.deepEqual(JSON.parse(shield.inward(json)), expected);
  assert.equal(shield.inwardBody(Buffer.from("var n = 483920; var c = '483920';"), "text/javascript").data.toString(), `var n = 483920; var c = '${alias}';`);
  assert.equal(shield.inwardBody(Buffer.from("a { width: 483920px; margin: 483920 }"), "text/css").data.toString(), "a { width: 483920px; margin: 483920 }");
  const large = Buffer.from(JSON.stringify({ base64: "a".repeat(64 * 1024 * 1024), n: 483920 }));
  assert.equal(shield.inwardBody(large, "application/json").data, large, "a string of many megabytes is no problem for the pattern");
});

test("1: what a site sends goes through whole in a run with a short code: a number in JSON, the length of the body and a year", async () => {
  const json = JSON.stringify({ bytes: 483920, jaar: 2026, duur: "12026", code: CODE });
  const site = await siteWith((request, response) => {
    if (request.url === "/data") return void response.writeHead(200, { "content-type": "application/json" }).end(json);
    if (request.url === "/lang") return void response.writeHead(200, { "content-type": "text/plain", "x-rij": "1483920", age: "483920", "retry-after": "483920" }).end(`${" ".repeat(483919)}\n`);
    html(response, `<h1>Site</h1><p id="jaar">2026</p><p id="code">Je code is ${CODE}</p><p id="getal">1483920</p>`);
  });
  const run = runOn(site.origin);
  const mail: ReceivedMail = { id: "m", receivedAt: Date.now(), mail: { text: `Je code: ${CODE}. Deze code is geldig tot 2026.`, html: "", headers: new Map() } };
  absorbAll(run, [site.origin], { kind: "mailpit", local: true, since: "2026-10-30T10:00:00Z", messages: [], links: [], refusedOrigins: [], registrations: [] }, [mail]);
  const secrets = readSecretsFile(run)!.secrets;
  assert.deepEqual(secrets.map((secret) => secret.real), [CODE], "the year is no code");
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.locator("#jaar").textContent(), "2026");
    assert.equal(await session.page.locator("#getal").textContent(), "1483920");
    assert.equal(await session.page.locator("#code").textContent(), `Je code is ${secrets[0]!.alias}`);
    const data = await session.page.evaluate(() => fetch("/data").then((answer) => answer.json()));
    assert.deepEqual(data, { bytes: 483920, jaar: 2026, duur: "12026", code: secrets[0]!.alias });
    const long = await session.page.evaluate(() => fetch("/lang").then(async (answer) => ({ length: (await answer.text()).length, age: answer.headers.get("age"), retry: answer.headers.get("retry-after"), row: answer.headers.get("x-rij") })));
    assert.deepEqual(long, { length: 483920, age: "483920", retry: "483920", row: "1483920" });
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("1: the search follows the same rule, so a seal does not refuse a number, and the seal index is never touched", async () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, CODE, { source: "kort" });
    writeFileSync(join(run, "data.json"), JSON.stringify({ bytes: 483920, at: "2026-10-30T10:48:39.483920Z", id: "x483920" }));
    writeFileSync(join(run, "lijst.jsonl"), `${JSON.stringify({ n: 483920 })}\n${JSON.stringify({ n: 1 })}\n`);
    writeFileSync(join(run, "tekst.html"), "<p>1483920 en a483920</p>");
    writeFileSync(join(run, "beeld.bin"), Buffer.concat([Buffer.from([0, 1]), Buffer.from(` ${CODE} `), Buffer.from([2])]));
    writeFileSync(join(run, "kopie.b64"), Buffer.from(CODE).toString("base64"));
    writeFileSync(join(run, "hex.txt"), Buffer.from(CODE).toString("hex"));
    writeFileSync(join(run, "pagina-483920.html"), "<p>leeg</p>");
    assert.deepEqual(scanRun(run).hits, []);
    await writeJson(join(run, "gemeten.json"), { bytes: 483920 });
    assert.deepEqual(JSON.parse(readFileSync(join(run, "gemeten.json"), "utf8")), { bytes: 483920 });
    assert.deepEqual(readSecretEvents(run), [], "a number is nothing to note");
    const { sha256: first } = await seal(run);
    assert.match(first, /^[0-9a-f]{64}$/);
    for (const [name, content] of [["los.txt", `Je code is ${CODE}`], ["waarde.json", JSON.stringify({ code: CODE })]] as const) {
      writeFileSync(join(run, name), content);
      assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), [name], "where it would be replaced, it is a leak");
      rmSync(join(run, name));
    }
    const hash = "9f".repeat(32);
    registerSecret(run, hash, { source: "lang" });
    const index = JSON.stringify({ files: { "a.json": hash } });
    assert.equal(maskText(join(run, "evidence-index.json"), index), index, "not even a long value changes the index: seal refused a leak before it got here");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("8: a real value is put back as it is, with the signs a replacement would read as a pattern", () => {
  const real = "a$&b$$c$'d$`e$1f-0123456789";
  const alias = "x".repeat(real.length);
  const spelled = real.replace("$`", "%24%60");
  const shield = new Shield({ secrets: [{ ...secretFor(real), alias, spelled: [spelled] }] });
  assert.equal(shield.outward(`voor ${alias} na`), `voor ${real} na`);
  assert.equal(shield.outward(`voor ${encodeURIComponent(alias)} na`), `voor ${real} na`);
  assert.equal(shield.outwardUrl(`https://a.example/?t=${alias}&x=1`), `https://a.example/?t=${spelled}&x=1`);
  assert.equal(shield.outwardBytes(Buffer.from(`voor ${alias} na`)).toString(), `voor ${real} na`);
  assert.equal(shield.outwardForm(Buffer.from(`t=${alias}`)).toString(), `t=${new URLSearchParams({ a: real }).toString().slice(2)}`);
  const plain = new Shield({ secrets: [{ ...secretFor(real), alias: "$&-alias-$$-alias" }] });
  assert.equal(plain.inward(`voor ${real} na`), "voor $&-alias-$$-alias na", "and so is an alias");
});

// ---- A site that renews its cookies with every answer ----------------------------------------------------------------

test("6: a site that renews a cookie with every answer does not stop the proxy, keeps the register small, and an old value stays out of the run", async () => {
  let issued = 0;
  const values: string[] = [];
  const fresh = (): string => {
    const value = `verse-${String(++issued).padStart(6, "0")}-Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz`;
    values.push(value);
    return value;
  };
  const site = await siteWith((request, response) => {
    if (request.url === "/oud") return html(response, `<p id="oud">${values.at(-2)}</p>`, { "set-cookie": `sessie=${fresh()}; Path=/` });
    if (request.url === "/stil") return html(response, "<p>Stil</p>");
    html(response, "<h1>Site</h1>", { "set-cookie": [`sessie=${fresh()}; Path=/`, "taal=nl; Path=/"] });
  });
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), loginSession(site.origin));
  // A run of some size: looking through it for each new value is what stopped the proxy.
  writeFileSync(join(run, "groot.txt"), "x".repeat(64 * 1024 * 1024));
  // That it does not look at all: a value the site has yet to hand out already stands here, and nobody notes it.
  writeFileSync(join(run, "voorspeld.txt"), `verse-000030-Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz`);
  setRunLogin(run);
  const session = await sessionOn(run, await launched("chromium"));
  let longestPause = 0;
  let last = performance.now();
  const beat = setInterval(() => {
    const now = performance.now();
    longestPause = Math.max(longestPause, now - last);
    last = now;
  }, 5);
  try {
    await loadPage(session.page, `${site.origin}/`);
    const started = performance.now();
    longestPause = 0;
    last = started;
    const statuses = await session.page.evaluate(() => Promise.all(Array.from({ length: 60 }, (_, index) => fetch(`/tik/${index}`).then((answer) => answer.status))));
    const took = performance.now() - started;
    assert.ok(statuses.every((status) => status === 200));
    assert.ok(took < 5000, `60 requests at once took ${Math.round(took)} ms`);
    assert.ok(longestPause < 1000, `the proxy stood still for ${Math.round(longestPause)} ms`);

    const places = readSecretsFile(run)!.secrets.filter((secret) => secret.slot !== undefined);
    assert.equal(places.length, 1, "one place for one cookie, whatever the number of answers");
    assert.equal(places[0]!.real, values.at(-1));
    assert.equal(places[0]!.previous!.length, MAX_PREVIOUS);
    assert.ok(statSync(join(run, RUN_SECRETS_FILE)).size < 16 * 1024, "and the register has a limit");

    // The browser keeps one alias, and the site gets the latest value for it.
    const held = (await session.page.context().cookies()).find((cookie) => cookie.name === "sessie")!;
    assert.equal(held.value, places[0]!.alias);
    await session.page.evaluate(() => fetch("/stil").then((answer) => answer.text()));
    assert.ok(site.heard.at(-1)!.headers.cookie?.includes(`sessie=${values.at(-1)}`), "the latest value goes out");

    // An answer that was under way, with the value of a moment ago.
    await loadPage(session.page, `${site.origin}/oud`);
    const shown = await session.page.locator("#oud").textContent();
    assert.ok(!values.includes(shown!), "the old value does not reach the browser");
    await writeFileAtomic(join(run, "pages", "p1", "page.html"), await session.page.content());
    await writeJson(join(run, "observations", "o1.json"), { cookies: await session.page.context().cookies() });
    for (const value of values.slice(-3)) assert.deepEqual(filesHolding(run, value), [], value);
    assert.deepEqual(readSecretEvents(run).filter((event) => event.kind === "found-in-run"), []);
    rmSync(join(run, "voorspeld.txt"));
    writeFileSync(join(run, "te-laat.txt"), values.at(-2)!);
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["te-laat.txt"], "and the search still knows it");
  } finally {
    clearInterval(beat);
    setRunLogin(null);
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("6: a site with a new cookie name for each answer cannot make the register grow either", () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, COOKIE, { source: SESSION_COOKIE_SOURCE });
    for (let index = 0; index < MAX_SLOTS * 3; index++) renewSessionSecrets(run, { "set-cookie": `naam${index}=waarde-${index}-Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz; Path=/` }, new URL("http://localhost:1/"), "context");
    const places = readSecretsFile(run)!.secrets.filter((secret) => secret.slot !== undefined);
    assert.equal(places.length, MAX_SLOTS);
    assert.ok(places.at(-1)!.real.startsWith(`waarde-${MAX_SLOTS * 3 - 1}-`), "the oldest goes first");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Where a run ends --------------------------------------------------------------------------------------------------

test("7: a file named secrets.json above a run is not a register, whatever is in it", async () => {
  const outer = mkdtempSync(join(tmpdir(), "loep-boven-"));
  const run = join(outer, "onderzoek", "run");
  mkdirSync(join(run, "pages"), { recursive: true });
  writeFileSync(join(run, "manifest.json"), "{}");
  const text = `titel ${TOKEN}`;
  const foreign = ["{ kapot", "null", "[]", JSON.stringify({ schema: "iets-anders/1", secrets: [] }), JSON.stringify({ wachtwoord: TOKEN })];
  try {
    for (const content of foreign) {
      for (const place of [outer, join(outer, "onderzoek")]) {
        writeFileSync(join(place, RUN_SECRETS_FILE), content);
        assert.equal(maskText(join(run, "pages", "a.json"), text), text, content);
        await writeJson(join(run, "pages", "b.json"), { titel: text });
        await writeFileAtomic(join(run, "pages", "c.txt"), text);
        assert.deepEqual(readSecretEvents(run), []);
        rmSync(join(place, RUN_SECRETS_FILE));
      }
    }
    // Where nothing stops the climb, and in the root of a run itself: only the schema says it is no register.
    for (const content of foreign) {
      writeFileSync(join(outer, RUN_SECRETS_FILE), content);
      assert.equal(maskText(join(outer, "los", "a.txt"), text), text, content);
      rmSync(join(outer, RUN_SECRETS_FILE));
      writeFileSync(join(run, RUN_SECRETS_FILE), content);
      assert.equal(maskText(join(run, "pages", "a.json"), text), text, content);
      rmSync(join(run, RUN_SECRETS_FILE));
    }
    mkdirSync(join(outer, RUN_SECRETS_FILE));
    assert.equal(maskText(join(run, "pages", "a.json"), text), text, "a folder of that name");
    assert.equal(maskText(join(outer, "los", "a.txt"), text), text, "a folder of that name, with nothing to stop the climb");
    rmSync(join(outer, RUN_SECRETS_FILE), { recursive: true });
    // Also a real register of another run stops at the root of this one.
    const other = mkdtempSync(join(tmpdir(), "loep-buiten-"));
    registerSecret(other, TOKEN, { source: "test", origins: ["http://localhost:1"] });
    cpSync(join(other, RUN_SECRETS_FILE), join(outer, RUN_SECRETS_FILE));
    rmSync(other, { recursive: true, force: true });
    assert.equal(maskText(join(run, "pages", "a.json"), text), text);
    assert.equal(maskText(join(outer, "los.txt"), text).includes(TOKEN), false, "outside a run the nearest register still counts");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("7: inside a run a nested folder of a recheck has its own root, and its register by a link still counts", async () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, TOKEN, { source: "test" });
    const nested = join(run, "nalopen", "1.1.1");
    mkdirSync(join(nested, "uit"), { recursive: true });
    writeFileSync(join(nested, "manifest.json"), "{}");
    symlinkSync(join(run, RUN_SECRETS_FILE), join(nested, RUN_SECRETS_FILE));
    assert.ok(!maskText(join(nested, "uit", "a.json"), `x ${TOKEN}`).includes(TOKEN));
    assert.ok(!maskText(join(run, "pages", "a.json"), `x ${TOKEN}`).includes(TOKEN), "and in the run itself");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- A download in a run with secrets ----------------------------------------------------------------------------------

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]);

async function downloadOn(run: string, url: string, name: string, limits: { maxBytes: number; timeoutMs: number }): Promise<Awaited<ReturnType<typeof guardedDownload>>> {
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  return guardedDownload(await scopeForRun(run, {}), guard, url, join(run, name), { resourceType: "document", blockade: undefined, ...limits });
}

test("5: a binary file stays whole in a download: only a long value is swapped, and a short one is noted", async () => {
  const binary = Buffer.concat([PNG_HEAD, Buffer.from(TOKEN), Buffer.from([0, 0xff, 0x20]), Buffer.from(CODE), Buffer.from([0x20, 0xfe, 0x80])]);
  const noNull = Buffer.concat([Buffer.from([0x89, 0x50, 0x20]), Buffer.from(CODE), Buffer.from([0x20, 0xff])]);
  const site = await siteWith((request, response) => void response.writeHead(200, { "content-type": request.url === "/geen-nul.bin" ? "application/octet-stream" : "image/png" }).end(request.url === "/geen-nul.bin" ? noNull : binary));
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "lang" });
  registerSecret(run, CODE, { source: "kort" });
  const alias = readSecretsFile(run)!.secrets.find((secret) => secret.real === TOKEN)!.alias;
  try {
    const fetched = await downloadOn(run, `${site.origin}/plaatje.png`, "plaatje.png", { maxBytes: 1024 * 1024, timeoutMs: 5000 });
    assert.deepEqual({ ...fetched, url: "" }, { ok: true, url: "", bytes: binary.length, contentType: "image/png", truncated: null });
    assert.deepEqual(readFileSync(join(run, "plaatje.png")), Buffer.from(binary.toString("latin1").replace(TOKEN, () => alias), "latin1"));
    const noted = readSecretEvents(run).filter((event) => event.kind === "short-in-binary");
    assert.deepEqual(noted.map((event) => event.source), ["kort"]);
    assert.ok(noted[0]!.where.endsWith("/plaatje.png"));
    assert.equal((await downloadOn(run, `${site.origin}/geen-nul.bin`, "geen-nul.bin", { maxBytes: 1024, timeoutMs: 5000 })).ok, true);
    assert.deepEqual(readFileSync(join(run, "geen-nul.bin")), noNull, "by its type, also without a zero byte, and also when the run writes it");
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("5: a download stops at its limit while it comes in, and a value across that limit is not cut in half", async () => {
  const chunk = Buffer.alloc(64 * 1024, 0x20);
  let sent = 0;
  const site = await siteWith((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    const more = (): void => {
      if (response.destroyed || sent >= 1024 * 1024 * 1024) return void response.end();
      sent += chunk.length;
      response.write(chunk, () => setImmediate(more));
    };
    more();
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "lang" });
  try {
    const fetched = await downloadOn(run, `${site.origin}/groot.txt`, "groot.txt", { maxBytes: 256 * 1024, timeoutMs: 20_000 });
    assert.equal(fetched.ok && fetched.truncated, "size");
    assert.equal(fetched.ok && fetched.bytes, 256 * 1024);
    assert.ok(sent < 64 * 1024 * 1024, `the site sent ${sent} bytes for a limit of 256 kB`);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
  // The site stops halfway through the value, right at the limit.
  const edge = await siteWith((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write(`${" ".repeat(1000 - 10)}${TOKEN.slice(0, 10)}`);
    setTimeout(() => response.end(`${TOKEN.slice(10)} en verder`), 100);
  });
  const second = runOn(edge.origin);
  registerSecret(second, TOKEN, { source: "lang" });
  try {
    const fetched = await downloadOn(second, `${edge.origin}/rand.txt`, "rand.txt", { maxBytes: 1000, timeoutMs: 5000 });
    assert.equal(fetched.ok && fetched.truncated, "size");
    assert.ok(!readFileSync(join(second, "rand.txt"), "utf8").includes(TOKEN.slice(0, 10)), "not even its first half");
  } finally {
    await edge.close();
    rmSync(second, { recursive: true, force: true });
  }
});

test("5: when the time is up the part that arrived is kept and says so, with its values swapped", async () => {
  const site = await siteWith((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write(`begin ${TOKEN} `);
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "lang" });
  const alias = readSecretsFile(run)!.secrets[0]!.alias;
  try {
    const fetched = await downloadOn(run, `${site.origin}/traag.txt`, "traag.txt", { maxBytes: 1024 * 1024, timeoutMs: 500 });
    assert.equal(fetched.ok && fetched.truncated, "time");
    assert.equal(readFileSync(join(run, "traag.txt"), "utf8"), `begin ${alias} `);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- I: one mail that cannot be read -----------------------------------------------------------------------------------

test("I: a mail that cannot be taken in is skipped, named without its content, and stays in the mailbox; the others are read", async () => {
  const run = runOn("http://localhost:1");
  const state = { kind: "mailpit" as const, local: true, since: "2026-10-30T10:00:00Z", messages: [], links: [], refusedOrigins: [], registrations: [] };
  const good: ReceivedMail = { id: "goed", receivedAt: Date.parse("2026-10-30T10:00:00Z"), mail: { to: [], subject: "", text: `Link: http://localhost:1/x?token=${TOKEN.replace("+", "%2B").replace("/", "%2F")}`, html: "", headers: new Map() } } as unknown as ReceivedMail;
  const broken = { id: "kapot", receivedAt: Date.now(), mail: null } as unknown as ReceivedMail;
  const lines: string[] = [];
  const errors = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
  try {
    const taken = absorbAll(run, ["http://localhost:1"], state, [broken, good]);
    assert.deepEqual(taken.map((message) => message.id), ["goed"]);
    assert.equal(state.messages.length, 1);
    assert.ok(lines.some((line) => /een e-mail is overgeslagen: TypeError/.test(line)));
    assert.ok(readSecretsFile(run)!.secrets.some((secret) => secret.real === TOKEN));
  } finally {
    process.stderr.write = errors;
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Without secrets ---------------------------------------------------------------------------------------------------

// ---- What a third review found -----------------------------------------------------------------------------------------

const randomValue = (length: number): string => randomBytes(length).toString("base64url").slice(0, length);

test("a value of some kilobytes is one value like any other, also spelled in a mix right across its length", () => {
  const long = randomValue(6000);
  const shield = new Shield({ secrets: [secretFor(long)] });
  const alias = shield.secrets[0]!.alias;
  assert.equal(shield.inward(`voor ${long} na`), `voor ${alias} na`);
  for (const at of [0, 511, 512, 513, 2048, 5999]) {
    const mixed = `${long.slice(0, at)}%${long.charCodeAt(at).toString(16)}${long.slice(at + 1)}`;
    assert.equal(shield.inward(`voor ${mixed} na`), `voor ${alias} na`, `escaped at ${at}`);
  }
  const almost = `${long.slice(0, 5000)}!${long.slice(5001)}`;
  assert.equal(shield.inward(almost), almost, "the same up to one character is another value");
});

test("a run with a session token of some kilobytes works: the browser starts, the site gets it, and it is nowhere in the run", async () => {
  const long = randomValue(3000);
  const site = await siteWith((request, response) => {
    if (!request.headers.cookie?.includes(`sessie=${long}`)) return void response.writeHead(303, { location: "/inloggen" }).end();
    html(response, "<h1>Mijn pagina</h1>");
  });
  const run = runOn(site.origin);
  const login = loginSession(site.origin);
  login.storageState.cookies[0]!.value = long;
  writeLoginFile(join(run, LOGIN_SESSION_FILE), login);
  setRunLogin(run);
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/mijn`);
    assert.equal(await session.page.locator("h1").textContent(), "Mijn pagina");
    await writeJson(join(run, "observations", "o1.json"), { cookies: await session.page.context().cookies() });
    assert.deepEqual(filesHolding(run, long), []);
    assert.deepEqual(scanRun(run).hits, []);
    writeFileSync(join(run, "gelekt.txt"), long);
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["gelekt.txt"]);
  } finally {
    setRunLogin(null);
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("two contexts that each get their own renewed cookie keep it: one never sends the value of the other", async () => {
  const [first, second] = [randomValue(40), randomValue(40)];
  const site = await siteWith((request, response) => {
    if (request.url === "/een") return html(response, "<h1>Een</h1>", { "set-cookie": `sessie=${first}; Path=/` });
    if (request.url === "/twee") return html(response, "<h1>Twee</h1>", { "set-cookie": `sessie=${second}; Path=/` });
    html(response, "<h1>Wie</h1>");
  });
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), loginSession(site.origin));
  setRunLogin(run);
  const browser = await launched("chromium");
  const [one, other] = [await sessionOn(run, browser), await sessionOn(run, browser)];
  try {
    await loadPage(one.page, `${site.origin}/een`);
    await loadPage(other.page, `${site.origin}/twee`);
    await loadPage(one.page, `${site.origin}/wie`);
    assert.ok(site.heard.at(-1)!.headers.cookie?.includes(`sessie=${first}`), "the first context keeps its own value");
    await loadPage(other.page, `${site.origin}/wie`);
    assert.ok(site.heard.at(-1)!.headers.cookie?.includes(`sessie=${second}`), "and the second its own");
    assert.equal(readSecretsFile(run)!.secrets.filter((secret) => secret.slot !== undefined).length, 2);
  } finally {
    setRunLogin(null);
    await one.close();
    await other.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a stored token goes to every origin of the run, as a script sends it to its own service on another address", async () => {
  const api = await siteWith((request, response) => {
    response.writeHead(request.method === "OPTIONS" || request.headers.authorization === `Bearer ${STORED}` ? 200 : 401, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization", "content-type": "text/plain" }).end("api");
  });
  const site = await siteWith((_request, response) => html(response, "<h1>App</h1>"));
  const run = runOn(site.origin);
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${site.origin}/`, origin: site.origin, origins: [site.origin, api.origin], pages: [] }));
  writeLoginFile(join(run, LOGIN_SESSION_FILE), { ...loginSession(site.origin), storageState: { cookies: [], origins: [{ origin: site.origin, localStorage: [{ name: "token", value: STORED }] }] } });
  setRunLogin(run);
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.evaluate((url) => fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } }).then((answer) => answer.status), `${api.origin}/ik`), 200);
    assert.deepEqual(filesHolding(run, STORED), []);
  } finally {
    setRunLogin(null);
    await session.close();
    await api.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a stored token stays off an address that is no part of the run: the scope holds the request back and says so, with or without secrets", async () => {
  const api = await siteWith((_request, response) => void response.writeHead(200, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization" }).end("api"));
  const site = await siteWith((_request, response) => html(response, "<h1>App</h1>"));
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), { ...loginSession(site.origin), storageState: { cookies: [], origins: [{ origin: site.origin, localStorage: [{ name: "token", value: STORED }] }] } });
  setRunLogin(run);
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    await session.page.evaluate((url) => fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } }).catch(() => undefined), `${api.origin}/ik`);
    assert.deepEqual(api.heard, []);
    assert.ok(session.guard.blocked.some((entry) => entry.kind === "scope" && entry.url.startsWith(api.origin)));
  } finally {
    setRunLogin(null);
    await session.close();
    await api.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a cookie of the browser in a request outside the browser goes out real, so a file behind a login stays reachable", async () => {
  const site = await siteWith((request, response) => void response.writeHead(request.headers.cookie === `sessie=${COOKIE}` ? 200 : 401, { "content-type": "text/plain" }).end("ondertitels"));
  const run = runOn(site.origin);
  registerSecret(run, COOKIE, { source: SESSION_COOKIE_SOURCE, origins: [site.origin] });
  try {
    const shield = shieldForRun(run)!;
    const answer = await shieldedFetch(shield, `${site.origin}/track.vtt`, { headers: { cookie: `sessie=${shield.secrets[0]!.alias}` } });
    assert.equal(answer.status, 200);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a short code that stood in the run by chance before it was known does not stop a seal, and one more of it does", async () => {
  const run = runOn("http://localhost:1");
  try {
    writeFileSync(join(run, "notitie.txt"), "Postcode 2517 KJ, en nog eens 2517.");
    registerSecret(run, "2517", { source: "test" });
    assert.deepEqual(scanRun(run).hits, []);
    assert.equal(readSecretEvents(run).filter((event) => event.kind === "found-in-run").length, 1, "it is noted");
    await seal(run);
    rmSync(join(run, "evidence-index.json"));
    writeFileSync(join(run, "notitie.txt"), "Postcode 2517 KJ, en nog eens 2517, en de code: 2517.");
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["notitie.txt"], "what came after it was known is no chance");
    writeFileSync(join(run, "ander.txt"), "2517");
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file).sort(), ["ander.txt", "notitie.txt"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a file that disappears during the search is no failure, and the search still happens", () => {
  const run = runOn("http://localhost:1");
  writeFileSync(join(run, "weg.txt"), "tijdelijk");
  writeFileSync(join(run, "gelekt.txt"), TOKEN);
  const read = fs.readFileSync;
  mock.method(fs, "readFileSync", (path: string, ...rest: unknown[]) => {
    if (String(path).endsWith("weg.txt")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return (read as (...parts: unknown[]) => unknown)(path, ...rest);
  });
  syncBuiltinESMExports();
  try {
    registerSecret(run, TOKEN, { source: "test" });
    assert.deepEqual(readSecretEvents(run).map((event) => event.where), ["gelekt.txt"], "the value is looked for, in what is there");
    assert.deepEqual(scanRun(run).unread, []);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a file that cannot be read is named, and a seal does not pass over it", async () => {
  const run = runOn("http://localhost:1");
  registerSecret(run, TOKEN, { source: "test" });
  writeFileSync(join(run, "dicht.txt"), TOKEN);
  chmodSync(join(run, "dicht.txt"), 0o000);
  try {
    assert.deepEqual(scanRun(run).unread, ["dicht.txt"]);
    await assert.rejects(seal(run), /dicht\.txt/);
  } finally {
    chmodSync(join(run, "dicht.txt"), 0o600);
    rmSync(run, { recursive: true, force: true });
  }
});

test("a file larger than a read can hold is searched too, also where a value lies across two pieces", () => {
  const run = runOn("http://localhost:1");
  registerSecret(run, TOKEN, { source: "test" });
  const path = join(run, "groot.mp4");
  const descriptor = fs.openSync(path, "w");
  try {
    fs.ftruncateSync(descriptor, 2 ** 31 + 1024);
    fs.writeSync(descriptor, TOKEN, 2 ** 31 - TOKEN.length / 2, "latin1");
    fs.closeSync(descriptor);
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["groot.mp4"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a cookie reaches what a browser sends it to: its own host, or under its domain, and over https when it is secure", () => {
  const value = randomValue(40);
  const covers = (details: Partial<RunSecret>, url: string): boolean => new Shield({ secrets: [{ ...secretFor(value), origins: [], ...details }] }).covers(url);
  assert.equal(covers({ domains: ["app.example.nl"] }, "https://app.example.nl/"), true);
  assert.equal(covers({ domains: ["app.example.nl"] }, "https://sub.app.example.nl/"), false, "a cookie of one host stays there");
  assert.equal(covers({ domains: [".example.nl"] }, "https://sub.example.nl/"), true, "a cookie of a domain goes under it");
  assert.equal(covers({ domains: [".example.nl"] }, "https://nietexample.nl/"), false);
  assert.equal(covers({ domains: [".example.nl"], secure: true }, "http://sub.example.nl/"), false, "a secure cookie stays off http");
  assert.equal(covers({ domains: [".example.nl"], secure: true }, "wss://sub.example.nl/"), true);
  assert.equal(covers({ domains: ["localhost"], secure: true }, "http://localhost:8081/"), true, "as a browser does on this machine");
});

test("what a session says about a cookie is what its reach is: also for a cookie of another site and for one the site renews", () => {
  const run = runOn("https://app.example.nl");
  const login = loginSession("https://app.example.nl");
  login.storageState.cookies = [
    { ...login.storageState.cookies[0]!, secure: true },
    { ...login.storageState.cookies[0]!, name: "idp", value: `idp-${COOKIE}`, domain: "login.example.org" },
  ];
  writeLoginFile(join(run, LOGIN_SESSION_FILE), login);
  try {
    registerSessionSecrets(run);
    const covering = (url: string): string[] => shieldForRun(run)!.reaching(url).secrets.map((secret) => secret.real);
    assert.deepEqual(covering("https://app.example.nl/").filter((real) => real.includes(COOKIE)), [COOKIE], "not the cookie of the other site");
    assert.deepEqual(covering("http://app.example.nl/").filter((real) => real.includes(COOKIE)), [], "not over http");
    assert.deepEqual(covering("https://sub.app.example.nl/").filter((real) => real.includes(COOKIE)), [], "not under the host");
    const renewed = randomValue(40);
    renewSessionSecrets(run, { "set-cookie": `sessie=${renewed}; Path=/; Secure; Domain=example.nl` }, new URL("https://app.example.nl/"), "context");
    assert.ok(covering("https://sub.example.nl/").includes(renewed));
    assert.ok(!covering("http://sub.example.nl/").includes(renewed));
    const hostOnly = randomValue(40);
    renewSessionSecrets(run, { "set-cookie": `ander=${hostOnly}; Path=/` }, new URL("https://app.example.nl/"), "context");
    assert.ok(covering("http://app.example.nl/").includes(hostOnly), "without Secure also over http");
    assert.ok(!covering("https://sub.app.example.nl/").includes(hostOnly));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a short code in an address without a path counts, and the port of an address still does not", () => {
  const shield = new Shield({ secrets: [secretFor("483920")] });
  const alias = shield.secrets[0]!.alias;
  assert.equal(shield.inward("https://site.nl?code=483920"), `https://site.nl?code=${alias}`);
  assert.equal(shield.inward("https://site.nl#483920"), `https://site.nl#${alias}`);
  assert.equal(shield.inward("http://localhost:483920/"), "http://localhost:483920/");
});

test("fourth review: a place of a context that is open stays, however many contexts there are; one of a closed context makes room", () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, COOKIE, { source: SESSION_COOKIE_SOURCE });
    const renew = (context: string): void => renewSessionSecrets(run, { "set-cookie": `sessie=${randomValue(40)}; Path=/` }, new URL("http://localhost:1/"), context);
    for (let index = 0; index < MAX_SLOTS + 8; index++) renew(`context${index}`);
    const count = (): number => readSecretsFile(run)!.secrets.filter((secret) => secret.slot !== undefined).length;
    assert.equal(count(), MAX_SLOTS + 8);
    endContextSecrets(run, "context0");
    renew("nieuw");
    assert.equal(count(), MAX_SLOTS + 8);
    assert.ok(!readSecretsFile(run)!.secrets.some((secret) => secret.context === "context0"));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: a short code in a template string of a script counts as text", () => {
  const shield = new Shield({ secrets: [secretFor("483920")] });
  assert.equal(shield.inward("const a=`code 483920`;", "text/javascript"), `const a=\`code ${shield.secrets[0]!.alias}\`;`);
});

test("fourth review: a readable value that also stands on the site does not stop a seal", async () => {
  const run = runOn("http://localhost:1");
  try {
    writeFileSync(join(run, "inventaris.txt"), "https://site.nl/update-q4/");
    registerSecret(run, "update-q4", { source: "test" });
    assert.deepEqual(scanRun(run).hits, []);
    writeFileSync(join(run, "later.txt"), "update-q4");
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["later.txt"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: an answer without a body is no answer that cannot be read, whatever it says about its encoding", async () => {
  const site = await siteWith((request, response) => {
    if (request.method === "HEAD") return void response.writeHead(200, { "content-encoding": "gzip", "content-type": "text/html" }).end();
    html(response, "<h1>Site</h1>");
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    assert.equal(await session.page.evaluate(() => fetch("/x", { method: "HEAD" }).then((answer) => answer.status)), 200);
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("fourth review: with the setting for a trial on this machine a request outside the browser stays here too", async () => {
  process.env[LOCAL_ONLY_ENV] = "1";
  try {
    assert.equal((await shieldedFetch(null, "http://www.andere-site.example/x", {})).status, REFUSED_STATUS);
  } finally {
    delete process.env[LOCAL_ONLY_ENV];
  }
});

test("fourth review: an answer of a site that looks like a refusal of the boundary means nothing, and cannot stop a session", async () => {
  const site = await siteWith((request, response) => {
    if (request.url === "/nep") return void response.writeHead(REFUSED_STATUS, { [REFUSED_HEADER]: "%E0%A4%A" }).end("nep");
    html(response, "<h1>Site</h1>");
  });
  for (const withSecret of [false, true]) {
    const run = runOn(site.origin);
    if (withSecret) registerSecret(run, TOKEN, { source: "test" });
    const session = await sessionOn(run, await launched("chromium"));
    try {
      await loadPage(session.page, `${site.origin}/`);
      await session.page.evaluate(() => fetch("/nep").then((answer) => answer.text()));
      assert.deepEqual(session.guard.blocked.filter((entry) => entry.kind === "boundary"), []);
    } finally {
      await session.close();
      rmSync(run, { recursive: true, force: true });
    }
  }
  await site.close();
});

test("fourth review: a real value goes into a JSON body in the way JSON writes it", () => {
  const shield = new Shield({ secrets: [secretFor('{"keuze":true}')] });
  const alias = shield.secrets[0]!.alias;
  assert.equal(JSON.parse(shield.outwardJson(Buffer.from(JSON.stringify({ prefs: alias }))).toString()).prefs, '{"keuze":true}');
});

test("fourth review: a recheck and its run take the same lock on their one register", () => {
  const run = runOn("http://localhost:1");
  const workspace = mkdtempSync(join(tmpdir(), "loep-naloop-"));
  registerSecret(run, TOKEN, { source: "test" });
  symlinkSync(join(run, RUN_SECRETS_FILE), join(workspace, RUN_SECRETS_FILE));
  try {
    mkdirSync(join(run, "secrets.lock"));
    setTimeout(() => undefined, 0);
    const started = performance.now();
    registerSecret(workspace, COOKIE, { source: "test" });
    assert.ok(performance.now() - started > 500, "it waited for the lock of the run");
    assert.ok(readSecretsFile(run)!.secrets.some((secret) => secret.real === COOKIE));
  } finally {
    rmSync(run, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("fifth review: the shape of a text only counts when its type says nothing", () => {
  const shield = new Shield({ secrets: [secretFor("483920")] });
  const alias = shield.secrets[0]!.alias;
  assert.equal(shield.inward("[Logo]\nUw code is 483920.\n[Voet]", "text/plain"), `[Logo]\nUw code is ${alias}.\n[Voet]`);
  assert.equal(shield.inward("[483920]"), "[483920]", "without a type the shape still says data");
});

test("fifth review: a long token of only letters or digits is searched in every spelling", () => {
  const run = runOn("http://localhost:1");
  try {
    registerSecret(run, "qwertyuiopasdfghjklzxcvbnm", { source: "test" });
    writeFileSync(join(run, "opname.txt"), Buffer.from("xqwertyuiopasdfghjklzxcvbnmx").toString("base64"));
    assert.deepEqual(scanRun(run).hits.map((hit) => hit.file), ["opname.txt"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a redirect to an address that is none does not stop the proxy", async () => {
  const site = await siteWith((request, response) => {
    if (request.url === "/kapot") return void response.writeHead(302, { location: "http://[bad" }).end();
    html(response, "<h1>Site</h1>");
  });
  const run = runOn(site.origin);
  registerSecret(run, TOKEN, { source: "test" });
  const session = await sessionOn(run, await launched("chromium"));
  try {
    await loadPage(session.page, `${site.origin}/`);
    const answer = await session.page.evaluate(() => fetch("/kapot", { redirect: "manual" }).then((reply) => reply.type, (error: Error) => error.message));
    assert.equal(readSecretEvents(run).filter((event) => event.kind === "unreachable").length, 0, answer);
    assert.equal(await session.page.evaluate(() => fetch("/").then((reply) => reply.status)), 200, "and it goes on");
  } finally {
    await session.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: two cookies with one name on two paths each keep their value, and a cookie on an IPv6 address stays in reach", () => {
  const run = runOn("http://[::1]:3000");
  try {
    registerSecret(run, COOKIE, { source: SESSION_COOKIE_SOURCE });
    renewSessionSecrets(run, { "set-cookie": [`s=${randomValue(40)}; Path=/a`, `s=${randomValue(40)}; Path=/b`] }, new URL("http://[::1]:3000/"), "context");
    assert.equal(readSecretsFile(run)!.secrets.filter((secret) => secret.slot !== undefined).length, 2);
    assert.ok(shieldForRun(run)!.covers("http://[::1]:3000/a"));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("fifth review: a name that ends in .test is no reason to take any certificate, or to send a secure cookie over http", () => {
  assert.equal(isThisMachine("staging.corp.test"), false);
  assert.equal(isThisMachine("localhost"), true);
  assert.equal(isThisMachine("127.0.0.1"), true);
  assert.equal(isThisMachine("::1"), true);
  const shield = new Shield({ secrets: [{ ...secretFor(randomValue(40)), origins: [], domains: ["staging.corp.test"], secure: true }] });
  assert.equal(shield.covers("http://staging.corp.test/"), false);
});

test("fifth review: a cookie of one host is first-party there alone, as everywhere else", () => {
  assert.equal(cookieFitsHost("site.nl", "www.site.nl"), false);
  assert.equal(cookieFitsHost(".site.nl", "www.site.nl"), true);
});

test("fifth review: with the setting for a trial nothing outside this machine is asked, by any fetch of the toolbox", async () => {
  process.env[LOCAL_ONLY_ENV] = "1";
  try {
    assert.equal((await trialFetch("http://www.andere-site.example/sitemap.xml")).status, REFUSED_STATUS);
  } finally {
    delete process.env[LOCAL_ONLY_ENV];
  }
});

test("a run without secrets has no boundary: no proxy, no register, no file more, and the library is not loaded", async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  const run = runOn(site.origin);
  const browser = await launched("chromium");
  try {
    assert.deepEqual(await boundaryForContext(browser, run), {});
    registerSessionSecrets(run);
    assert.equal(shieldForRun(run), null);
    const before = readdirSync(run).sort();
    const context = await newContext(browser, { runDir: run });
    const opened = await context.newPage();
    const answer = await opened.goto(`${site.origin}/`);
    assert.equal(answer?.status(), 200);
    await context.close();
    await writeJson(join(run, "x.json"), { a: 1 });
    assert.deepEqual(readdirSync(run).sort(), [...before, "x.json"].sort());
    assert.equal(existsSync(join(run, RUN_SECRETS_FILE)), false);
    assert.equal(existsSync(join(run, ".gitignore")), false);
    assert.deepEqual(secretLimitationsNl(run), []);
    assert.deepEqual(scanRun(run), { files: 0, bytes: 0, hits: [], compressed: 0, unread: [] });
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
  const session = fileURLToPath(new URL("../src/browser/session.ts", import.meta.url));
  const script = `import { createRequire } from "node:module"; await import(${JSON.stringify(session)}); const cache = Object.keys(createRequire(import.meta.url).cache); process.stdout.write(String(cache.some((path) => path.includes("/mockttp/"))));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(child.stderr, "");
  assert.equal(child.stdout, "false", "a run without secrets does not load a line of mockttp");
});
