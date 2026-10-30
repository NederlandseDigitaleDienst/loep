import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type AddressInfo, type Socket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { generateCACertificate } from "mockttp";
import * as playwright from "playwright";
import type { Browser, Page } from "playwright";
import { boundaryForContext, boundaryPortsForTest, LOCAL_ONLY_ENV, MAX_REQUEST_BYTES, REFUSED_HEADER, REFUSED_STATUS, setBoundaryNetwork } from "../src/browser/boundary.ts";
import { loadPage, newContext } from "../src/browser/session.ts";
import { absorbAll } from "../src/commands/mail.ts";
import { seal } from "../src/commands/verify.ts";
import { appendRunLine, writeFileAtomic, writeJson } from "../src/lib/canonical.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE, RUN_SECRETS_FILE, registerSessionSecrets, sessionWithAliases, setRunLogin, writeLoginFile, type LoginSession } from "../src/lib/login.ts";
import { MIN_BINARY_VALUE, maskBytes, maskText, readPrivate, readSecretEvents, readSecretsFile, registerSecret, scanRun, secretLimitationsNl, secretsLinesNl, Shield, shieldForRun, type RunSecret } from "../src/lib/secrets.ts";
import type { ReceivedMail } from "../src/lib/mailbox.ts";
import { notHashed } from "../src/lib/seal.ts";
import { decideWrites, recordWrites } from "../src/lib/writes.ts";
import { guardContext, guardRedirects, scopeForRun, type Guard } from "../src/session/safety.ts";
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
  await guardRedirects(opened, scope, guard);
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

test("a browser that goes around the proxy on this machine does not take part in a run with a login either", { skip: process.platform !== "darwin" || !SecondBrowsers.installed("webkit") }, async () => {
  const site = await siteWith((_request, response) => html(response, "<h1>Site</h1>"));
  const run = runOn(site.origin);
  writeLoginFile(join(run, LOGIN_SESSION_FILE), loginSession(site.origin));
  registerSessionSecrets(run);
  try {
    await assert.rejects(newContext(await launched("webkit"), { runDir: run }), /doet in deze run niet mee/);
    assert.equal(site.heard.length, 0);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- I: one mail that cannot be read -----------------------------------------------------------------------------------

test("I: a mail that cannot be taken in is skipped, named without its content, and stays in the mailbox; the others are read", async () => {
  const run = runOn("http://localhost:1");
  const state = { kind: "mailpit" as const, local: true, since: "2026-10-30T10:00:00Z", messages: [], links: [], refusedOrigins: [] };
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
    assert.deepEqual(scanRun(run), { files: 0, bytes: 0, hits: [], compressed: 0 });
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
