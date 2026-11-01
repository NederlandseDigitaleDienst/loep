import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { createServer as createTcpServer, connect } from "node:net";
import { createSocket } from "node:dgram";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test, type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import { generateCACertificate } from "mockttp";
import * as playwright from "playwright";
import type { Browser, BrowserContext, Page, Request } from "playwright";
import { loadPage, newContext } from "../src/browser/session.ts";
import * as shielded from "../src/browser/boundary.ts";
import { absorbAll, cleanupLinesNl, mailCleanup, mailWait, startMailbox } from "../src/commands/mail.ts";
import { RUN_SECRETS_FILE } from "../src/lib/login.ts";
import { imapMailbox } from "../src/lib/mailbox-imap.ts";
import { MAIL_ADDRESS_SOURCE, MAIL_LINK_SOURCE, mailboxLimitationsNl, readMailboxState, recordMailbox, type Mailbox, type RawMail } from "../src/lib/mailbox.ts";
import { parseMail } from "../src/lib/mailparse.ts";
import { aliasFor, readSecretEvents, readSecretsFile, scanRun, Shield } from "../src/lib/secrets.ts";
import { decideWrites, recordWrites, runWrites, type WritePermission, isThisMachine } from "../src/lib/writes.ts";
import { DEFAULT_DAEMON_LIMITS, guardContext, guardRedirects, guardRedirectsByRoute, Politeness, scopeForRun, TEST_VALUES, type Guard } from "../src/session/safety.ts";
import { SecondBrowsers } from "../src/session/second.ts";
import { openSurface, type Env } from "../src/session/surface.ts";

/*
 * The boundary of a run with a mailbox, seen from the side of the browser: whatever a site does with
 * a token, nothing a browser or a run keeps may hold it, and the site still gets it. Each test
 * here was shown to fail on the code before the boundary was a proxy.
 */

/** A token with what an address spells differently, as the mail spells it: lower-case percent-encoding. */
const TOKEN = "Zk3v/Q9x+T7bLp2nWd5sGh8JmR4cYf6AeU1oKi0tXa";
const SPELLED = TOKEN.replace("/", "%2f").replace("+", "%2b");
const ADDRESS = "loep-1a2b3c4d@example.com";
const BROWSERS = ["chromium", "firefox", "webkit"] as const;
type Name = (typeof BROWSERS)[number];

const hasBoundaryNetwork = "setBoundaryNetwork" in shielded;
/** The aliases of the values a mail brought, in the order they came. */
const linkAliases = (run: string): string[] => readSecretsFile(run)!.secrets.filter((secret) => secret.source === MAIL_LINK_SOURCE).map((secret) => secret.alias);
const browsers = new Map<Name, Promise<Browser>>();
const launched = (name: Name): Promise<Browser> => {
  if (!browsers.has(name)) browsers.set(name, playwright[name].launch());
  return browsers.get(name)!;
};
after(async () => {
  for (const browser of browsers.values()) await (await browser).close();
});

interface Heard {
  method: string;
  url: string;
  body: string;
  cookie: string | undefined;
}

/** A server that takes a frame from a client and says what it heard, with a token cut in two over two frames. */
function answerSocket(request: IncomingMessage, socket: Socket, heard: string[]): void {
  const key = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${key}\r\n\r\n`);
  const frame = (fin: boolean, opcode: number, text: string): Buffer => Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, Buffer.byteLength(text)]), Buffer.from(text)]);
  let buffer: Buffer = Buffer.alloc(0);
  socket.on("data", (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 6) {
      const length = buffer[1]! & 0x7f;
      if (buffer.length < 6 + length) return;
      if ((buffer[0]! & 0x0f) === 8) return void socket.end();
      const payload = Buffer.from(buffer.subarray(6, 6 + length)).map((byte, index) => byte ^ buffer[2 + (index % 4)]!);
      buffer = buffer.subarray(6 + length);
      heard.push(Buffer.from(payload).toString());
      const half = Math.floor(TOKEN.length / 2);
      socket.write(Buffer.concat([frame(false, 1, `{"token":"${TOKEN.slice(0, half)}`), frame(true, 0, `${TOKEN.slice(half)}","adres":"${ADDRESS}"}`)]));
    }
  });
  socket.on("error", () => undefined);
}

/** One site with every way a token comes back, on http or https. */
class Fixture {
  heard: Heard[] = [];
  frames: string[] = [];
  socketUrl = "";
  /** A page may show the registration; removing it ends that. */
  registered = true;
  origin = "";
  server!: Server;

  handler = (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const url = new URL(request.url!, this.origin);
      const body = Buffer.concat(chunks).toString();
      this.heard.push({ method: request.method!, url: request.url!, body, cookie: request.headers.cookie });
      const send = (status: number, headers: Record<string, string | string[]>, content: string | Buffer = ""): void => void response.writeHead(status, headers).end(content);
      const html = (content: string, headers: Record<string, string | string[]> = {}): void => send(200, { "content-type": "text/html; charset=utf-8", ...headers }, `<!doctype html><html lang="nl"><title>Site</title><body>${content}</body></html>`);
      const next = (status: number, location: string, headers: Record<string, string | string[]> = {}): void => send(status, { location, ...headers });
      switch (url.pathname) {
        case "/":
          return html("<h1>Start</h1>");
        case "/volgende":
          return next(303, "/echo");
        case "/echo":
          return html(`<h1>Echo</h1><p id="adres">${ADDRESS}</p><a href="/link?token=${encodeURIComponent(TOKEN)}">Link</a><p>${TOKEN.replace("+", "&#43;")}</p>`);
        case "/post":
          return next(307, "/post-daarna");
        case "/post-daarna":
          return html("<h1>Ontvangen</h1>");
        case "/link":
          return html(`<h1>Link</h1><link rel="stylesheet" href="/stijl.css?token=${encodeURIComponent(TOKEN)}"><script src="/code.js?token=${encodeURIComponent(TOKEN)}"></script><img alt="" src="/plaatje.png?token=${encodeURIComponent(TOKEN)}">`);
        case "/stijl.css":
          return send(200, { "content-type": "text/css" }, `/* ${TOKEN} */ h1 { color: rgb(1, 2, 3); }`);
        case "/code.js":
          return send(200, { "content-type": "text/javascript" }, `window.code = ${JSON.stringify(TOKEN)}; window.adres = ${JSON.stringify(ADDRESS)};`);
        case "/ingepakt":
          return send(200, { "content-type": "text/plain", "content-encoding": "gzip" }, gzipSync(`inhoud ${TOKEN}`));
        case "/stroom":
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
          response.write(`data: ${TOKEN.slice(0, 9)}`);
          setTimeout(() => response.end(`${TOKEN.slice(9)}\n\n`), 50);
          return;
        case "/cookie":
          return next(302, `/voorkeuren?token=${encodeURIComponent(TOKEN)}`, { "set-cookie": `abonnee=${encodeURIComponent(TOKEN)}; Path=/` });
        case "/voorkeuren":
          if (!this.registered) return next(303, "/verlopen");
          if (request.method === "POST") {
            this.registered = false;
            return next(303, "/klaar");
          }
          return html(`<h1>Voorkeuren</h1><form method="post" action="/voorkeuren?token=${encodeURIComponent(TOKEN)}"><button>Verwijder alles</button></form>`);
        case "/naar-elders":
          return next(302, `${this.other}/ontvangen?token=${encodeURIComponent(TOKEN)}`);
        case "/stap-een":
          return next(302, `/dieper/stap-twee?token=${encodeURIComponent(TOKEN)}`);
        case "/dieper/stap-twee":
          return next(302, "stap-drie");
        case "/dieper/stap-drie":
          return send(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }, `einde ${url.search === "" ? "juist" : "fout"}`);
        case "/script-post":
          return next(307, "/script-post-daarna");
        case "/script-post-daarna":
          return send(200, { "content-type": "text/plain" }, "ontvangen");
        case "/klaar":
        case "/verlopen":
          return html(`<h1>${url.pathname}</h1>`);
        default:
          return send(404, { "content-type": "text/plain" }, "niet gevonden");
      }
    });
  };

  other: string;

  constructor(other: string) {
    this.other = other;
  }

  async start(tls: { key: string; cert: string } | null, hostName: string | null): Promise<void> {
    this.server = tls ? createHttpsServer(tls, this.handler) : createServer(this.handler);
    this.server.on("upgrade", (request, socket) => {
      this.socketUrl = request.url!;
      answerSocket(request, socket as Socket, this.frames);
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `${tls ? "https" : "http"}://${hostName ?? "127.0.0.1"}:${(this.server.address() as AddressInfo).port}`;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const permissionFor = (origin: string, extra: Partial<WritePermission> = {}): WritePermission => {
  const local = origin.includes("127.0.0.1");
  return { ...decideWrites(`${origin}/`, local ? { allowWrites: true } : { testEnvironment: [origin], declaredBy: "Iemand, beheerder" })!, maxWrites: 100, spacingSeconds: 0, ...extra };
};

async function mailboxRun(origin: string, extra: Partial<WritePermission> = {}): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "loep-grens-"));
  const granted = permissionFor(origin, extra);
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  await recordWrites(run, granted);
  const mark = { kind: "mailpit" as const, local: true, declaredAt: "2026-10-30T09:00:00.000Z" };
  await recordMailbox(run, mark);
  await startMailbox(run, { kind: "mailpit", host: "localhost", port: 1, tls: false }, ADDRESS, mark, granted);
  return run;
}

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

const mailOf = (body: string, id = `m${Math.random()}`, extra = ""): RawMail => ({ id, receivedAt: Date.parse("2026-10-30T10:00:00Z"), raw: Buffer.from(`From: site@example.com\r\nTo: ${ADDRESS}\r\nSubject: Test\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`) });

interface Session {
  page: Page;
  context: BrowserContext;
  guard: Guard;
}

async function sessionOn(run: string, browser: Browser): Promise<Session> {
  const scope = await scopeForRun(run, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  const context = await newContext(browser, { writes: scope.writes ?? null });
  await guardContext(context, scope, guard);
  const page = await context.newPage();
  // As `openSurface` does it.
  if (browser.browserType().name() === "chromium") await guardRedirects(page, scope, guard);
  else await guardRedirectsByRoute(context, scope, guard);
  return { page, context, guard };
}

const inFiles = (dir: string, needle: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return inFiles(path, needle);
    return entry.name !== RUN_SECRETS_FILE && readFileSync(path).includes(needle) ? [path] : [];
  });

/** Where this file looks for what may not be there, in every form a page can hold it. */
const FORMS = [TOKEN, encodeURIComponent(TOKEN), SPELLED, TOKEN.replace("+", "&#43;"), ADDRESS];
const holdsSecret = (text: string): boolean => FORMS.some((form) => text.includes(form));

/** Everything a browser and its listeners can tell about a page. */
async function visible(session: Session): Promise<string> {
  const { page, context } = session;
  const cookies = await context.cookies();
  const state = await page.evaluate(() => JSON.stringify({ code: (window as unknown as { code?: string }).code, adres: (window as unknown as { adres?: string }).adres, cookie: document.cookie, href: location.href })).catch(() => "");
  return [page.url(), await page.content(), JSON.stringify(cookies), state].join("\n");
}

let other: Server;
let otherOrigin = "";
let otherHeard: { url: string; cookie: string | undefined }[] = [];

before(async () => {
  other = createServer((request, response) => {
    otherHeard.push({ url: request.url!, cookie: request.headers.cookie });
    response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" }).end("ontvangen");
  });
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
});

after(async () => {
  other.closeAllConnections();
  await new Promise((resolve) => other.close(resolve));
});

beforeEach(() => {
  otherHeard = [];
});

const HOST_NAME = "site.loep-test.example";

/** A certificate for one host name, signed by itself: whoever trusts it, trusts only that. */
async function certificateFor(host: string): Promise<{ key: string; cert: string }> {
  return generateCACertificate({ subject: { commonName: host } });
}

/**
 * A name server that says that every name is this machine: the boundary then finds a made-up host the
 * way it finds a real one, and checks its certificate the way it checks a real one.
 */
async function nameServer(): Promise<{ address: string; close: () => void }> {
  const server = createSocket("udp4");
  server.on("message", (query, peer) => {
    const end = query.indexOf(0, 12) + 5;
    const isA = query.readUInt16BE(end - 4) === 1;
    const head = Buffer.from(query.subarray(0, 12));
    head.writeUInt16BE(0x8180, 2);
    head.writeUInt16BE(isA ? 1 : 0, 6);
    head.writeUInt32BE(0, 8);
    const answer = Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1]);
    server.send(Buffer.concat([head, query.subarray(12, end), ...(isA ? [answer] : [])]), peer.port, peer.address);
  });
  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
  return { address: `127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** Run a test on a site as a browser sees it: on this machine, or on a host name, over http or https. */
function eachPlace(name: Name, places: readonly ("local" | "http" | "https")[], work: (site: Fixture, browser: Browser, t: TestContext) => Promise<void>): void {
  for (const place of places) {
    test(`${name}, ${place === "local" ? "on this machine" : place}`, { skip: !SecondBrowsers.installed(name) || (place !== "local" && !hasBoundaryNetwork) }, async (t) => {
      const site = new Fixture(otherOrigin);
      const tls = place === "https" ? await certificateFor(HOST_NAME) : null;
      await site.start(tls, place === "local" ? null : HOST_NAME);
      const names = place === "local" ? null : await nameServer();
      if (names) shielded.setBoundaryNetwork({ lookup: { servers: [names.address] }, ...(tls ? { trustedCa: [tls.cert] } : {}) });
      try {
        await work(site, await launched(name), t);
      } finally {
        shielded.setBoundaryNetwork({});
        names?.close();
        await site.stop();
      }
    });
  }
}

const PLACES: Record<Name, readonly ("local" | "http" | "https")[]> = { chromium: ["local", "http", "https"], firefox: ["local", "http", "https"], webkit: ["local", "http", "https"] };

for (const name of BROWSERS) {
  describe(`the whole route in ${name}`, () => {
    eachPlace(name, PLACES[name], async (site, browser, t) => {
      const run = await mailboxRun(site.origin);
      const session = await sessionOn(run, browser);
      const seenByListeners: string[] = [];
      const note = (request: Request): void => void seenByListeners.push(`${request.url()} ${JSON.stringify(request.headers())}`);
      session.context.on("request", note);
      session.context.on("requestfinished", note);
      session.context.on("requestfailed", note);
      session.context.on("response", (response) => seenByListeners.push(`${response.url()} ${JSON.stringify(response.headers())}`));
      try {
        const answer = await mailWait(run, { mailbox: memoryBox([mailOf(`Je link: ${site.origin}/link?token=${SPELLED}\nen ${site.origin}/voorkeuren?token=${SPELLED}\n`)]) });
        const [link, preferences] = answer.links;
        assert.ok(link && preferences);
        const alias = linkAliases(run)[0]!;

        await t.test("1: a redirect without a secret in its address, to a page that shows them", async () => {
          await loadPage(session.page, `${site.origin}/volgende`);
          assert.ok(session.page.url().endsWith("/echo"));
          assert.equal(await session.page.locator("#adres").textContent(), TEST_VALUES.email);
          assert.ok(!holdsSecret(await visible(session)), "the page after a redirect");
        });

        await t.test("2: what a page loads besides itself, whatever its type", async () => {
          await loadPage(session.page, link.url);
          assert.ok(site.heard.some((request) => request.url === `/link?token=${SPELLED}`), "the site gets the address as the mail spelled it");
          assert.ok(site.heard.some((request) => request.url === `/code.js?token=${SPELLED}`), "the site gets the real token with a script");
          assert.ok(site.heard.some((request) => request.url === `/plaatje.png?token=${SPELLED}`), "and with an image");
          assert.equal(await session.page.evaluate(() => (window as unknown as { code: string }).code), alias);
          assert.ok(!holdsSecret(await visible(session)));
          assert.ok(!seenByListeners.some(holdsSecret), "what a listener sees");
          assert.equal(await session.page.evaluate(() => fetch("/stijl.css").then((answer) => answer.text())), `/* ${alias} */ h1 { color: rgb(1, 2, 3); }`);
          assert.equal(await session.page.evaluate(() => fetch("/ingepakt").then((answer) => answer.text())), `inhoud ${alias}`);
          assert.equal(await session.page.evaluate(() => fetch("/stroom").then((answer) => answer.text())), `data: ${alias}\n\n`);
        });

        await t.test("4: a cookie that comes with a redirect", async () => {
          await loadPage(session.page, `${site.origin}/cookie`);
          await session.page.waitForURL(/voorkeuren/);
          assert.ok(!holdsSecret(await visible(session)));
          await session.page.evaluate(() => fetch("/klaar").then((answer) => answer.text()));
          const cookie = site.heard.at(-1)!.cookie ?? "";
          assert.ok(cookie.includes(`abonnee=${encodeURIComponent(TOKEN)}`), "the site gets its cookie back to the letter");
        });

        await t.test("5: a script that is sent elsewhere takes aliases along, and no cookie", async () => {
          const elsewhere = await session.page.evaluate(() => fetch("/naar-elders").then((answer) => answer.status, () => 0));
          assert.equal(elsewhere, shielded.REFUSED_STATUS, "a redirect that would take an alias elsewhere is held back");
          for (const request of otherHeard) assert.ok(!holdsSecret(JSON.stringify(request)), "the other server does not get the token");
          assert.equal(await session.page.evaluate(() => fetch("/stap-een").then((answer) => answer.text())), "einde juist");
          assert.ok(site.heard.some((request) => request.url === "/dieper/stap-drie"), "a next step resolves against the one before, not the first");
          const redirected = await session.page.evaluate(({ email, code }) => fetch("/script-post", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `email=${encodeURIComponent(email)}&code=${code}` }).then((answer) => answer.text()), { email: TEST_VALUES.email!, code: alias });
          assert.equal(redirected, "ontvangen");
          const body = site.heard.filter((request) => request.url === "/script-post-daarna").at(-1)?.body ?? "";
          assert.equal(new URLSearchParams(body).get("email"), ADDRESS, "the repeat carries the real address");
          assert.equal(new URLSearchParams(body).get("code"), TOKEN, "and the real token, with its plus");
        });

        await t.test("6: a form with the address that the server sends on with its method", async () => {
          await loadPage(session.page, `${site.origin}/`);
          await session.page.evaluate((email) => {
            const form = document.createElement("form");
            form.method = "post";
            form.action = "/post";
            const field = form.appendChild(document.createElement("input"));
            field.name = "email";
            field.value = email;
            document.body.append(form);
            form.submit();
          }, TEST_VALUES.email!);
          // WebKit takes no redirect from a route: the page of the target stands on the old address.
          if (name !== "webkit") await session.page.waitForURL(/post-daarna/);
          else await session.page.waitForFunction(() => document.querySelector("form") === null);
          const repeated = site.heard.filter((request) => request.url === "/post-daarna" && request.method === "POST");
          assert.equal(repeated.length, 1);
          assert.equal(new URLSearchParams(repeated[0]!.body).get("email"), ADDRESS, "the repeat carries the real address");
        });

        // On this machine WebKit keeps a socket closed; that has a test of its own. On Linux WebKit does not take the certificate of the proxy for a socket.
        await t.test("a socket: the real values go out, and a token cut in two over two frames comes back as an alias", { skip: name === "webkit" && (isThisMachine(new URL(site.origin).hostname) || (process.platform === "linux" && site.origin.startsWith("https"))) }, async () => {
          const reply = await session.page.evaluate(
            ({ scheme, email, code }) =>
              new Promise<string>((resolve, reject) => {
                const socket = new WebSocket(`${scheme}://${location.host}/stroom?token=${code}`);
                socket.onopen = () => socket.send(JSON.stringify({ van: email, code }));
                socket.onmessage = (event) => resolve(String(event.data));
                socket.onerror = () => reject(new Error("geen verbinding"));
              }),
            { scheme: site.origin.startsWith("https") ? "wss" : "ws", email: TEST_VALUES.email!, code: alias },
          );
          assert.equal(reply, JSON.stringify({ token: alias, adres: TEST_VALUES.email }));
          assert.deepEqual(site.frames, [JSON.stringify({ van: ADDRESS, code: TOKEN })]);
          assert.equal(site.socketUrl, `/stroom?token=${SPELLED}`, "the address of the socket is the real one");
        });

        await t.test("nothing of it stands anywhere in the browser or the run", async () => {
          assert.ok(!seenByListeners.some(holdsSecret), "what a listener sees");
          assert.ok(!holdsSecret(await visible(session)));
          assert.deepEqual(FORMS.flatMap((form) => inFiles(run, form)), []);
          assert.deepEqual(scanRun(run).hits, []);
          assert.deepEqual(session.guard.blocked.filter((entry) => entry.writeBudget), []);
        });
      } finally {
        await session.context.close();
        rmSync(run, { recursive: true, force: true });
      }
    });
  });
}

test("a session opens its pages inside the boundary, also in a process that does not know the run otherwise", async () => {
  const site = new Fixture(otherOrigin);
  await site.start(null, null);
  const run = await mailboxRun(site.origin);
  const browser = await launched("chromium");
  try {
    const env: Env = { browser, runDir: run, scope: await scopeForRun(run, {}), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    assert.equal(runWrites(), null);
    const { surface } = await openSurface(env, { url: `${site.origin}/volgende`, width: 1280, height: 800, scheme: "light" });
    assert.equal(await surface.page.locator("#adres").textContent(), TEST_VALUES.email);
    await surface.context.close();
    const bare = await browser.newContext();
    await assert.rejects(guardContext(bare, env.scope, { blocked: [], outsideScopeLoaded: {}, sender: "test" }), /loopt niet door de grens/);
    await bare.close();
  } finally {
    await site.stop();
    rmSync(run, { recursive: true, force: true });
  }
});

// ---- Single findings, each on one browser ------------------------------------------------------------------------------

/** A site that does what its test says, for the proof of a removal and the mail around it. */
function scriptedSite(handle: (url: URL, method: string, send: (status: number, content: string, headers?: Record<string, string>) => void) => void): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => handle(new URL(request.url!, "http://site"), request.method!, (status, content, headers = {}) => void response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }).end(`<!doctype html><html lang="nl"><title>Site</title><body>${content}</body></html>`)));
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => {
          server.closeAllConnections();
          return new Promise((done) => server.close(() => done()));
        },
      }),
    );
  });
}

const BUTTON = (token: string): string => `<h1>Voorkeuren</h1><form method="post" action="/voorkeuren?token=${token}"><button>Verwijder alles</button></form>`;

async function cleaned(handle: Parameters<typeof scriptedSite>[0], extra: Partial<WritePermission> = {}, path = "/voorkeuren", settleMs = 0): Promise<{ cleanup: Awaited<ReturnType<typeof mailCleanup>>; run: string }> {
  const site = await scriptedSite(handle);
  const run = await mailboxRun(site.origin, extra);
  const box = memoryBox([mailOf(`Je link: ${site.origin}${path}?token=${SPELLED}\n`)]);
  try {
    await mailWait(run, { mailbox: box });
    return { cleanup: await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs }), run };
  } finally {
    await site.close();
  }
}

test("7: a link that works once is no proof that the registration is gone", async () => {
  let opened = 0;
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") return send(303, "", { location: "/klaar" });
    if (url.pathname === "/klaar" || url.pathname === "/verlopen") return send(200, "<h1>Klaar</h1>");
    // The first opening shows the button; from then on the link is used, and nothing is removed by that.
    return opened++ === 0 ? send(200, BUTTON(SPELLED)) : send(303, "", { location: "/verlopen" });
  });
  assert.equal(cleanup.sites[0]!.outcome, "not shown", cleanup.sites[0]!.noteNl);
  assert.match(cleanup.sites[0]!.noteNl, /twee keer hetzelfde/);
  rmSync(run, { recursive: true, force: true });
});

test("7: a registration that answers 404 on the same address afterwards is gone", async () => {
  let gone = false;
  for (const status of [404, 410]) {
    gone = false;
    const { cleanup, run } = await cleaned((url, method, send) => {
      if (method === "POST") {
        gone = true;
        return send(303, "", { location: "/klaar" });
      }
      if (url.pathname === "/klaar") return send(200, "<h1>Klaar</h1>");
      return gone ? send(status, "<h1>Weg</h1>") : send(200, BUTTON(SPELLED));
    });
    assert.equal(cleanup.sites[0]!.outcome, "removed", String(status));
    assert.match(cleanup.sites[0]!.noteNl, new RegExp(String(status)));
    rmSync(run, { recursive: true, force: true });
  }
});

test("7: a redirect that was held back says nothing about the site", async () => {
  let gone = false;
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") {
      gone = true;
      return send(303, "", { location: "/klaar" });
    }
    if (url.pathname === "/klaar") return send(200, "<h1>Klaar</h1>");
    // The server wants the browser out of the scope: the guard holds that back, and the page stays where it was.
    return gone ? send(302, "", { location: `${otherOrigin}/buiten` }) : send(200, BUTTON(SPELLED));
  });
  assert.equal(cleanup.sites[0]!.outcome, "not shown", cleanup.sites[0]!.noteNl);
  assert.match(cleanup.sites[0]!.noteNl, /tegengehouden/);
  assert.equal(otherHeard.length, 0);
  rmSync(run, { recursive: true, force: true });
});

/** A page of a site with a login: a form to leave in the chrome of the site, and one for what the test says. */
const withLogout = (own: string, logout = `<header><form method="post" action="/sessie/einde"><button>Afmelden</button></form></header>`): string => `${logout}<main><h1>Voorkeuren</h1>${own}</main>`;

test("4: a button that logs out is left alone, also at an address that says nothing, and the real one behind it is pressed", async () => {
  const posted: string[] = [];
  let gone = false;
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") {
      posted.push(url.pathname);
      gone = url.pathname === "/voorkeuren";
      return send(303, "", { location: "/klaar" });
    }
    if (url.pathname === "/klaar" || url.pathname === "/verlopen") return send(200, "<h1>Klaar</h1>");
    if (gone) return send(303, "", { location: "/verlopen" });
    send(200, withLogout(`<form method="post" action="/voorkeuren?token=${url.searchParams.get("token")}"><button>Afmelden</button></form>`));
  });
  rmSync(run, { recursive: true, force: true });
  assert.deepEqual(posted, ["/voorkeuren"]);
  assert.equal(cleanup.sites[0]!.outcome, "removed", cleanup.sites[0]!.noteNl);
});

for (const [name, chrome] of [
  ["without a landmark, by the code it carries", `<div><form method="post" action="/sessie/einde"><button>Afmelden</button></form></div>`],
  ["by a word that only means logging out", `<div><form method="post" action="/voorkeuren-x"><button>Afmelden (uitloggen)</button></form></div>`],
  ["by its address", `<div><form method="post" action="/account/logout"><button>Verwijder sessie</button></form></div>`],
] as const) {
  test(`4: the real button comes first when a logout stands before it: ${name}`, async () => {
    const posted: string[] = [];
    let gone = false;
    const { cleanup, run } = await cleaned((url, method, send) => {
      if (method === "POST") {
        posted.push(url.pathname);
        gone = url.pathname === "/voorkeuren";
        return send(303, "", { location: "/klaar" });
      }
      if (url.pathname === "/klaar" || url.pathname === "/verlopen") return send(200, "<h1>Klaar</h1>");
      if (gone) return send(303, "", { location: "/verlopen" });
      send(200, withLogout(`<form method="post" action="/voorkeuren"><input type="hidden" name="t" value="${url.searchParams.get("token")}"><button>Afmelden</button></form>`, chrome));
    });
    rmSync(run, { recursive: true, force: true });
    assert.deepEqual(posted, ["/voorkeuren"]);
    assert.equal(cleanup.sites[0]!.outcome, "removed", cleanup.sites[0]!.noteNl);
  });
}

for (const [name, only] of [
  ["a word that only means logging out", `<form method="post" action="/x"><button>Afmelden (uitloggen)</button></form>`],
  ["an address that only means logging out", `<form method="post" action="/account/logout"><button>Verwijder sessie</button></form>`],
] as const) {
  test(`4: a button with ${name} is never pressed, also in the page itself`, async () => {
    const posted: string[] = [];
    const { cleanup, run } = await cleaned((url, method, send) => {
      if (method === "POST") posted.push(url.pathname);
      send(200, `<main><h1>Voorkeuren</h1>${only}</main>`);
    });
    rmSync(run, { recursive: true, force: true });
    assert.deepEqual(posted, []);
    assert.match(cleanup.sites[0]!.noteNl, /geen knop gevonden/);
  });
}

test("4: a page with only a logout is no place to press anything", async () => {
  const posted: string[] = [];
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") posted.push(url.pathname);
    send(200, withLogout("<p>Je voorkeuren</p>"));
  });
  rmSync(run, { recursive: true, force: true });
  assert.deepEqual(posted, []);
  assert.equal(cleanup.sites[0]!.outcome, "failed");
  assert.match(cleanup.sites[0]!.noteNl, /geen knop gevonden/);
});

for (const [name, login, content] of [
  ["a page with a login in its address", "/account/login", "<h1>Welkom terug</h1>"],
  ["a page that shows a password field", "/start", `<h1>Welkom</h1><label>Wachtwoord <input type="password"></label>`],
] as const) {
  test(`4: being sent to ${name} is no proof that the registration is gone`, async () => {
    let out = false;
    const { cleanup, run } = await cleaned((url, method, send) => {
      if (method === "POST") {
        out = true;
        return send(303, "", { location: login });
      }
      if (url.pathname === login) return send(200, content);
      if (out) return send(302, "", { location: login });
      send(200, `<main><h1>Voorkeuren</h1><form method="post" action="/sessie/einde"><button>Afmelden</button></form></main>`);
    });
    rmSync(run, { recursive: true, force: true });
    assert.equal(cleanup.sites[0]!.outcome, "not shown", cleanup.sites[0]!.noteNl);
    assert.equal(cleanup.complete, false);
  });
}

test("9: a browser that does not start leaves an outcome, and the mail, the search and mailbox.json go on", async () => {
  const site = await scriptedSite((_url, _method, send) => send(200, "<h1>Pagina</h1>"));
  const run = await mailboxRun(site.origin);
  const box = memoryBox([mailOf(`Je link: ${site.origin}/voorkeuren?token=${SPELLED}\n`)]);
  try {
    const cleanup = await mailCleanup(run, { mailbox: box, launch: () => Promise.reject(new Error("browser start niet\nmet meer regels")), settleMs: 0 });
    assert.equal(cleanup.sites[0]!.outcome, "failed");
    assert.match(cleanup.sites[0]!.noteNl, /browser start niet$/);
    assert.equal(cleanup.mail.left, 0);
    assert.equal(cleanup.mail.removed, 1);
    assert.equal(typeof cleanup.scan.files, "number");
    assert.equal(cleanup.complete, false);
    assert.deepEqual(readMailboxState(run)!.cleanup, cleanup);
    assert.equal((await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs: 0 })).sites[0]!.outcome, "failed", "and it can run again");
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

/** A browser whose contexts do what a test says, for what cannot be brought about on a real one. */
function browserWith(real: Browser, change: (context: BrowserContext) => BrowserContext): Browser {
  return new Proxy(real, {
    get(target, name) {
      if (name === "newContext") return async (...args: Parameters<Browser["newContext"]>) => change(await target.newContext(...args));
      const value = Reflect.get(target, name) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("9: a boundary that refuses leaves an outcome, and the rest goes on", async () => {
  const site = await scriptedSite((_url, _method, send) => send(200, "<h1>Pagina</h1>"));
  const run = await mailboxRun(site.origin);
  const box = memoryBox([mailOf(`Je link: ${site.origin}/voorkeuren?token=${SPELLED}\n`)]);
  const refusing = new Proxy(await launched("chromium"), { get: (target, name) => (name === "newContext" ? () => Promise.reject(new Error("de grens weigert deze browser")) : (Reflect.get(target, name) as (...args: unknown[]) => unknown).bind(target)) });
  try {
    const cleanup = await mailCleanup(run, { mailbox: box, browser: refusing, settleMs: 0 });
    assert.equal(cleanup.sites[0]!.outcome, "failed");
    assert.match(cleanup.sites[0]!.noteNl, /grens weigert/);
    assert.equal(cleanup.mail.left, 0);
    assert.deepEqual(readMailboxState(run)!.cleanup, cleanup);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("9: a guard that cannot be set closes its context, gives an outcome, and the rest goes on", async () => {
  const site = await scriptedSite((_url, _method, send) => send(200, "<h1>Pagina</h1>"));
  const run = await mailboxRun(site.origin);
  const box = memoryBox([mailOf(`Je link: ${site.origin}/voorkeuren?token=${SPELLED}\n`)]);
  const opened: BrowserContext[] = [];
  const failing = browserWith(await launched("chromium"), (context) => {
    let routes = 0;
    // The first route is the one of `newContext`; the guard is the next one.
    const changed = new Proxy(context, {
      get(target, name) {
        if (name === "route") return (...args: Parameters<BrowserContext["route"]>) => (++routes > 1 ? Promise.reject(new Error("de bewaking kon niet worden gezet")) : target.route(...args));
        const value = Reflect.get(target, name) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    opened.push(context);
    return changed;
  });
  try {
    const cleanup = await mailCleanup(run, { mailbox: box, browser: failing, settleMs: 0 });
    assert.equal(cleanup.sites[0]!.outcome, "failed");
    assert.match(cleanup.sites[0]!.noteNl, /bewaking kon niet worden gezet/);
    assert.equal(cleanup.mail.left, 0);
    assert.deepEqual(readMailboxState(run)!.cleanup, cleanup);
    assert.equal(opened.at(-1)!.pages().length, 0);
    await assert.rejects(opened.at(-1)!.newPage(), /closed/, "the context is closed");
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("7: a page that looks the same afterwards shows nothing, and that is what the report says", async () => {
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") return send(303, "", { location: "/voorkeuren" });
    send(200, BUTTON(SPELLED));
  });
  assert.equal(cleanup.sites[0]!.outcome, "not shown");
  assert.equal(cleanup.complete, false);
  assert.match(mailboxLimitationsNl(run).join(" "), /Er bleef iets achter/);
  rmSync(run, { recursive: true, force: true });
});

test("7: a redirect elsewhere after the removal, by the site itself, is proof", async () => {
  let gone = false;
  const { cleanup, run } = await cleaned((url, method, send) => {
    if (method === "POST") {
      gone = true;
      return send(303, "", { location: "/klaar" });
    }
    if (url.pathname === "/klaar" || url.pathname === "/verlopen") return send(200, "<h1>Klaar</h1>");
    return gone ? send(303, "", { location: "/verlopen" }) : send(200, BUTTON(SPELLED));
  });
  assert.equal(cleanup.sites[0]!.outcome, "removed");
  rmSync(run, { recursive: true, force: true });
});

test("8: a link held back for the time between two writes is tried again after that time", async () => {
  let gone = false;
  const site = await scriptedSite((url, method, send) => {
    if (method === "POST") {
      gone = true;
      return send(303, "", { location: "/klaar" });
    }
    if (url.pathname === "/klaar") return send(200, "<h1>Klaar</h1>");
    if (url.pathname === "/voorkeuren/een") return send(200, "<h1>Niets te doen</h1>");
    return gone ? send(404, "<h1>Weg</h1>") : send(200, BUTTON("x"));
  });
  const run = await mailboxRun(site.origin, { spacingSeconds: 2 });
  const box = memoryBox([mailOf(`Link: ${site.origin}/voorkeuren/een?token=${TOKEN.slice(0, 20)}abc\nLink: ${site.origin}/voorkeuren/twee?token=${TOKEN.slice(0, 20)}def\n`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs: 0 });
    assert.notEqual(cleanup.sites[0]!.outcome, "failed", cleanup.sites[0]!.noteNl);
    assert.equal(gone, true);
    assert.equal(cleanup.sites[0]!.outcome, "removed");
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("8: a link the time between two writes refuses says that, and is no failure of the browser", async () => {
  const site = await scriptedSite((_url, _method, send) => send(200, "<h1>Pagina</h1>"));
  const run = await mailboxRun(site.origin, { spacingSeconds: 3600 });
  writeFileSync(join(run, "writes.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), source: "r-start", method: "POST", path: "/aanmelden/" })}\n`);
  const box = memoryBox([mailOf(`Link: ${site.origin}/voorkeuren/een?token=${TOKEN.slice(0, 20)}abc\nLink: ${site.origin}/voorkeuren/twee?token=${TOKEN.slice(0, 20)}def\n`)]);
  try {
    await mailWait(run, { mailbox: box });
    const cleanup = await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs: 0 });
    assert.equal(cleanup.sites[0]!.outcome, "failed");
    assert.match(cleanup.sites[0]!.noteNl, /kon niet worden geopend/);
    assert.match(cleanup.sites[0]!.noteNl, /te kort na de vorige verzending/);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("3: a token with a plus or a lower-case escape does not stay in what the run keeps", async () => {
  for (const spelled of ["abc+def123GHIjklMNO", "abc%2fdef123GHI%2bjklMNO", "abc%2Fdef123GHI%2BjklMNO", "ab%2fcd%2Bef123456"]) {
    const run = await mailboxRun("http://127.0.0.1:1");
    try {
      const answer = await mailWait(run, { mailbox: memoryBox([mailOf(`Link: http://127.0.0.1:1/u?token=${spelled}\nOf: http://127.0.0.1:1/pad/${spelled}/x\n`)]) });
      assert.ok(!JSON.stringify(answer).includes(spelled), spelled);
      assert.deepEqual(inFiles(run, spelled), []);
      // And the search finds it when it does stand somewhere.
      writeFileSync(join(run, "gelekt.txt"), `x${spelled}x`);
      assert.deepEqual([...new Set(scanRun(run).hits.map((hit) => hit.file))], ["gelekt.txt"]);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  }
});

test("3: a page may spell a token otherwise than the mail did, and it is an alias all the same", () => {
  const alias = aliasFor("abc+def123GHI");
  const shield = new Shield({ secrets: [{ real: "abc def123GHI", spelled: ["abc+def123GHI"], alias, source: MAIL_LINK_SOURCE, origins: ["http://localhost:1"], at: "" }] });
  for (const form of ["abc+def123GHI", "abc%2Bdef123GHI", "abc%2bdef123GHI", "abc%20def123GHI", "abc def123GHI", "abc&#43;def123GHI"]) assert.equal(shield.inward(`x${form}y`), `x${alias}y`, form);
  assert.equal(shield.outwardUrl(`http://localhost:1/?t=${alias}`), "http://localhost:1/?t=abc+def123GHI", "an address goes back as the mail spelled it");
  assert.equal(shield.outwardForm(Buffer.from(`t=${alias}`)).toString(), "t=abc+def123GHI", "a form with a space sends a plus");
});

test("9: a number the mail made up breaks nothing", () => {
  for (const entity of ["&#9999999;", "&#xFFFFFFF;", `&#${"9".repeat(400)};`]) {
    const mail = parseMail(Buffer.from(`To: ${ADDRESS}\r\nContent-Type: text/html\r\n\r\n<p>${entity}</p><a href="https://site.example.nl/${entity}">x</a>`));
    assert.match(mail.text, new RegExp(entity.slice(0, 4)));
  }
});

test("9: one broken mail stops neither waiting nor cleaning up, and the others are read", async () => {
  const site = await scriptedSite((_url, _method, send) => send(200, "<h1>Pagina</h1>"));
  const run = await mailboxRun(site.origin);
  const broken: RawMail = { id: "kapot", receivedAt: Date.parse("2026-10-30T10:00:00Z"), raw: Buffer.from(`To: ${ADDRESS}\r\nContent-Type: text/html\r\n\r\n<p>&#9999999;</p>`) };
  const box = memoryBox([broken, mailOf(`Link: ${site.origin}/voorkeuren?token=${SPELLED}\n`, "goed")]);
  try {
    const answer = await mailWait(run, { mailbox: box });
    assert.equal(answer.links.length, 1);
    await mailCleanup(run, { mailbox: memoryBox([broken]), browser: await launched("chromium"), settleMs: 0 });
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("10: a token in a fragment stays there as an alias, and two links do not become one", async () => {
  const run = await mailboxRun("http://127.0.0.1:1");
  const second = "Yx8wV2mN5qR7tP3kL9sD4fG6hJ1bC0aE";
  try {
    const answer = await mailWait(run, { mailbox: memoryBox([mailOf(`Link: http://127.0.0.1:1/app#token=${SPELLED}\nEn: http://127.0.0.1:1/app#token=${second}\n`)]) });
    assert.equal(answer.links.length, 2);
    const [first, other] = answer.links;
    const aliases = linkAliases(run);
    assert.ok(first!.url.endsWith(`#token=${aliases[0]}`));
    assert.ok(other!.url.endsWith(`#token=${aliases[1]}`));
    assert.notEqual(first!.url, other!.url);
    assert.deepEqual(inFiles(run, second), []);
    assert.deepEqual(readMailboxState(run)!.links.map((link) => link.id), ["L1", "L2"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("11: a run without a mailbox is not read again for a seal", () => {
  const run = mkdtempSync(join(tmpdir(), "loep-grens-"));
  try {
    writeFileSync(join(run, "groot.bin"), Buffer.alloc(1000));
    assert.deepEqual(scanRun(run), { files: 0, bytes: 0, hits: [], compressed: 0, unread: [] });
    assert.equal(existsSync(join(run, RUN_SECRETS_FILE)), false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

/** A server without UIDPLUS: what is marked stays, and a search for what is marked finds it. */
async function imapWithoutUidplus(raw: Buffer): Promise<{ port: number; close: () => Promise<void> }> {
  const deleted = new Set<number>();
  const server = createTcpServer((socket) => {
    socket.write("* OK klaar\r\n");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("latin1");
      for (let end = buffer.indexOf("\r\n"); end !== -1; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, ...rest] = line.split(" ");
        const command = rest.join(" ");
        if (command === "CAPABILITY") socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK\r\n`);
        else if (/^UID SEARCH /.test(command)) {
          const wanted = /^UID SEARCH DELETED /.test(command) ? deleted.has(7) : !deleted.has(7);
          socket.write(`* SEARCH${wanted ? " 7" : ""}\r\n${tag} OK\r\n`);
        } else if (/^UID FETCH /.test(command)) {
          socket.write(`* 1 FETCH (UID 7 INTERNALDATE "30-Oct-2026 10:00:00 +0000" BODY[]<0> {${raw.length}}\r\n`);
          socket.write(raw);
          socket.write(`)\r\n${tag} OK\r\n`);
        } else if (/^UID STORE /.test(command)) {
          deleted.add(7);
          socket.write(`${tag} OK\r\n`);
        } else if (command === "LOGOUT") socket.write(`* BYE\r\n${tag} OK\r\n`);
        else socket.write(`${tag} OK\r\n`);
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      server.getConnections(() => undefined);
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

test("12: a mail a server only marked as deleted is not called gone", async () => {
  const site = await scriptedSite((url, method, send) => {
    if (method === "POST") return send(303, "", { location: "/klaar" });
    if (url.pathname === "/klaar") return send(200, "<h1>Klaar</h1>");
    send(200, BUTTON(SPELLED));
  });
  const run = await mailboxRun(site.origin);
  const fake = await imapWithoutUidplus(mailOf(`Link: ${site.origin}/voorkeuren?token=${SPELLED}\n`).raw);
  try {
    const box = imapMailbox({ kind: "imap", host: "127.0.0.1", port: fake.port, tls: false }, { user: "toets", password: "x" });
    const cleanup = await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs: 0 });
    assert.equal(cleanup.mail.left, 0);
    assert.equal(cleanup.complete, false);
    assert.match(cleanupLinesNl(cleanup).join("\n"), /alleen gemarkeerd/);
    assert.match(mailboxLimitationsNl(run).join(" "), /in de mailbox: .*alleen gemarkeerd als verwijderd/);
    assert.doesNotMatch(mailboxLimitationsNl(run).join(" "), /bevatte niets meer/);
  } finally {
    await fake.close();
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("13: the mail that confirms a removal is wiped too, and the report says until when it looked", async () => {
  let gone = false;
  const site = await scriptedSite((url, method, send) => {
    if (method === "POST") {
      gone = true;
      return send(303, "", { location: "/klaar" });
    }
    if (url.pathname === "/klaar") return send(200, "<h1>Klaar</h1>");
    return gone ? send(404, "<h1>Weg</h1>") : send(200, BUTTON(SPELLED));
  });
  const run = await mailboxRun(site.origin);
  const box = memoryBox([mailOf(`Link: ${site.origin}/voorkeuren?token=${SPELLED}\n`)]);
  try {
    await mailWait(run, { mailbox: box });
    // A fetch that finds a late mail once the registration is gone, a moment after that.
    let lateIn: number | null = null;
    const fetchFirst = box.fetch;
    box.fetch = async (address, since) => {
      if (gone && lateIn === null) lateIn = Date.now() + 300;
      if (lateIn !== null && Date.now() >= lateIn && !box.mails.some((mail) => mail.id === "laat")) box.mails.push(mailOf("Je bent afgemeld.", "laat"));
      return fetchFirst(address, since);
    };
    const cleanup = await mailCleanup(run, { mailbox: box, browser: await launched("chromium"), settleMs: 1000, pollMs: 100 });
    assert.ok(box.removed.includes("laat"), "the late mail was wiped");
    assert.equal(cleanup.mail.left, 0);
    assert.equal(cleanup.complete, true);
    assert.ok(cleanup.mail.checkedAt);
    assert.match(mailboxLimitationsNl(run).join(" "), /voor het laatst nagegaan/);
  } finally {
    await site.close();
    rmSync(run, { recursive: true, force: true });
  }
});
