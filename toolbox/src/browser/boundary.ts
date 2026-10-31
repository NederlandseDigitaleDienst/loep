import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, createServer as createTcpServer, Server as NetServer, type AddressInfo, type Socket } from "node:net";
import { format } from "node:util";
import type { CompletedRequest, Mockttp } from "mockttp";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import { renewSessionSecrets } from "../lib/login.ts";
import { endContextSecrets, isBinaryBody, noteSecretEvent, shieldForRun, type Shield } from "../lib/secrets.ts";
import { browserAddress, browserHost, browserHosts, realHosts } from "../lib/origins.ts";
import { isLocalHost, writesForRun } from "../lib/writes.ts";

/*
 * The boundary of `lib/secrets.ts`. A route of Playwright does not see what the browser asks by
 * itself after a redirect, so a boundary made of routes has holes that no list of cases closes. Here
 * the boundary is a proxy on this machine, mockttp: every browser context of a run with secrets has
 * it as its proxy, and every request leaves through it, in Chromium, Firefox and WebKit alike, also the
 * one after a redirect, after a form that is repeated (307, 308), and the upgrade of a socket. A
 * redirect is never followed here: it goes back to the browser, and the next request passes again.
 *
 * Towards an address a value may go to, the proxy fills in the real values, in the address, the
 * headers, the body and the frames of a socket. In the answer it puts the aliases back before the
 * browser gets a byte of it. Any other origin gets what the browser has, which is aliases.
 *
 * All https of the browser ends here, so the only certificate the browser ever sees is the one of
 * this proxy, and `ignoreHTTPSErrors` means no more than that. The proxy itself checks the site
 * against the normal chain, as a browser would, and only lets a site on this machine go.
 *
 * mockttp 4.6.5 leaves three things open, each with its smallest possible answer here:
 * - It listens on every interface and has no host option: `onLoopback`.
 * - It has no proxy authentication and answers every CONNECT with 200. So the browser talks to a
 *   small gate that asks for a password and then only passes bytes (`admit`). A connection that does
 *   not come through the gate gets nothing from any rule (`throughGate`).
 * - It cannot change the frames of a socket. So `swapSocket` takes the place of `handle` on its step, and
 *   wraps the two sockets when they are made. This leans on its inside and on the version pinned
 *   in package.json: the tests in `test/mailbox-boundary.test.ts` and `test/secrets.test.ts` hold it.
 *
 * What the browser does not send through a proxy is what this has to guard against, so a browser
 * is first shown to use it (`boundaryForContext`), and is refused when it does not. WebKit on macOS
 * skips a proxy for a new connection to this machine, so WebKit has such a site under a name only
 * this proxy knows (`lib/origins.ts`): a request comes in with that name and goes out with the real
 * host, and the answer goes back with the name in it, in the address of a redirect, a cookie and a page.
 */

/** The shield for a request of a run, or null: no secrets, or an address no value may go to. */
export function shieldOf(runDir: string | null | undefined, url: string): Shield | null {
  if (!runDir) return null;
  const shield = shieldForRun(runDir);
  return shield?.covers(url) ? shield : null;
}

/** Headers that say something about one connection. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
/** Headers that say something about the body as it came from the server. */
const STALE_HEADERS = new Set(["content-encoding", "content-length", "etag", "digest", "content-md5"]);
/** The body that goes out is swapped whole; a request larger than this is no form and is refused. */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_HEAD_BYTES = 256 * 1024;
/** With this set to 1 the boundary refuses every address that is not on this machine: for a trial that may not reach anything else. */
export const LOCAL_ONLY_ENV = "LOEP_BOUNDARY_LOCAL_ONLY";

/**
 * How the boundary says that it refused something: no status a site uses, so it cannot be taken for
 * an answer of the site. The header says why, and the guard makes a blocked entry of it.
 */
export const REFUSED_STATUS = 599;
export const REFUSED_HEADER = "x-loep-grens";

/** For a test: a made-up host name, on a server on this machine with a certificate of its own. */
export interface BoundaryNetwork {
  lookup?: { servers: string[] };
  trustedCa?: string[];
}

let network: BoundaryNetwork = {};

/** For a test: where the boundary finds the hosts. */
export function setBoundaryNetwork(next: BoundaryNetwork): void {
  network = next;
}

const withoutHopByHop = (headers: IncomingHttpHeaders): Record<string, string | string[]> => Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined && !HOP_BY_HOP.has(entry[0])).map(([name, value]) => [name, Array.isArray(value) ? value.map(realHosts) : realHosts(value)]));

/** The headers of a request as the site gets them. An address in a header is spelled the way the site spelled it. */
function outwardHeaders(shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const swap = (name: string, value: string): string => (name === "referer" ? shield.outwardUrl(value) : shield.outward(value));
  return Object.fromEntries(Object.entries(withoutHopByHop(headers)).map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => swap(name, part)) : swap(name, value)]));
}

const JSON_BODY = /^application\/(?:[\w.+-]*\+)?json\b/i;

/** Headers that are a number or a date by definition: they hold no value of a run, and a short value that happens to match would break them. */
const FIXED_HEADERS = new Set(["accept-ranges", "age", "content-length", "content-range", "date", "expires", "last-modified", "retry-after"]);

const headerInward = (shield: Shield, name: string, value: string): string => (FIXED_HEADERS.has(name) ? value : shield.inward(value));

const headersInward = (shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => headerInward(shield, name, part)) : headerInward(shield, name, value)]),
  );

/** Headers as WebKit may get them. In a cookie the domain is an address of its own, without slashes. */
const withWebKitNames = (headers: IncomingHttpHeaders): Record<string, string | string[]> => {
  const rename = (name: string, value: string): string => (name === "set-cookie" ? value.replace(/(;\s*domain=)\.?(localhost|127\.0\.0\.1)\b/i, (_match, start: string, host: string) => `${start}${browserHost(host)}`) : browserHosts(value));
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => rename(name, part)) : rename(name, value)]));
};

/** Why a value of a guarded address is not filled in: without the permission to send, such an address may not be opened, and the guard of a page does not see every request. */
const GUARDED_REFUSED_NL = "deze run mag niet versturen, en een persoonlijke link openen telt als versturen: de echte waarde is niet ingevuld";

/** Why an address is refused in a trial that stays on this machine. */
const LOCAL_ONLY_NL = "dit adres ligt buiten deze machine, en deze run blijft hier";

const refusalAnswer = (reasonNl: string) => ({ statusCode: REFUSED_STATUS, statusMessage: "Geweigerd door de grens van loep", headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", [REFUSED_HEADER]: encodeURIComponent(reasonNl) }, body: `loep: ${reasonNl}\n` });

let loopbackTurn: Promise<unknown> = Promise.resolve();

/** Listen on this machine only: mockttp asks for every interface, and offers no way to say otherwise. One at a time: the second would keep the replacement of the first for good. */
function onLoopback(start: () => Promise<void>): Promise<void> {
  const turn = loopbackTurn.then(async () => {
    const listen = NetServer.prototype.listen;
    NetServer.prototype.listen = function (this: NetServer, ...args: unknown[]): NetServer {
      return (listen as (...parts: unknown[]) => NetServer).apply(this, args.length === 1 && typeof args[0] === "number" ? [args[0], "127.0.0.1"] : args);
    } as typeof listen;
    try {
      await start();
    } finally {
      NetServer.prototype.listen = listen;
    }
  });
  loopbackTurn = turn.catch(() => undefined);
  return turn;
}

// ---- What mockttp says on the console -----------------------------------------------------------------------------------

let consoleMasked = false;

/** mockttp prints an address now and then, and on this side of it that address holds the real value. */
function maskConsole(): void {
  if (consoleMasked) return;
  consoleMasked = true;
  for (const method of ["log", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => original([...boundaries.keys()].reduce((text, runDir) => shieldForRun(runDir)?.inward(text) ?? text, format(...args)));
  }
}

// ---- The proxy ---------------------------------------------------------------------------------------------------------

/** A name that exists nowhere: only the proxy can answer it. */
const CHECK_HOST = "loep-grens.invalid";
const CHECK_START = "/start";
const CHECK_END = "/einde";
const CHECK_MARK = "loep-grens";
const CHECK_TIMEOUT_MS = 15_000;
const PROXY_USER_PREFIX = "loep-";
/** How a context of WebKit starts its name at the proxy: only that browser has names for this machine. */
const WEBKIT_CONTEXT = "webkit-";

/** The step of mockttp for a socket from the inside: `swapSocket` calls the real one. */
interface SocketStep {
  ignoreHostHttpsErrors: boolean | string[];
  handle(request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void>;
}

interface SocketRequest {
  url: string;
  /** Where mockttp connects to: read from here, not from the address. */
  destination: { hostname: string; port: number };
  remotePort?: number;
  headers: IncomingHttpHeaders;
  rawHeaders: [string, string][];
}

/** A socket of the `ws` package as mockttp hands it over. */
interface FrameSocket {
  upstreamWebSocket: FrameSocket;
  send(data: Buffer, options: { binary?: boolean } | undefined, done?: (error?: Error) => void): void;
}

class Boundary {
  readonly runDir: string;
  private mock!: Mockttp;
  private readonly gate = createTcpServer((socket) => this.admit(socket));
  /** Stands for a site on this machine. The proxy answers for it, so a browser that comes here went around the proxy. */
  private readonly decoy: Server;
  private readonly password = randomBytes(24).toString("hex");
  /** The ports of the connections the gate opened, with the browser context each belongs to: only those are served. */
  private readonly admitted = new Map<number, string>();
  /** Requests under way to a site, by their id in mockttp, with the address as the browser knows it. */
  private readonly underWay = new Map<string, string>();
  /** The context each request under way belongs to: an answer comes without the port of its connection. */
  private readonly contexts = new Map<string, string>();
  /** A cookie with an alias in it, per origin, with the way the site spelled it: it goes back the same, as a site compares it to the letter. */
  private readonly cookies = new Map<string, string>();
  private decoyHost = "";
  private readonly localOnly = process.env[LOCAL_ONLY_ENV] === "1";
  /** How many requests reached the decoy past the proxy. */
  bypassed = 0;
  port = 0;
  /** The browsers that have a context behind this boundary. */
  readonly users = new Set<Browser>();

  constructor(runDir: string) {
    this.runDir = runDir;
    this.decoy = createServer((_request, response) => {
      this.bypassed++;
      response.writeHead(200, { "content-type": "text/plain" }).end("buiten de grens om");
    });
    for (const server of [this.gate, this.decoy]) {
      server.on("connection", (socket) => socket.unref());
      server.unref();
    }
  }

  async start(): Promise<void> {
    // Loaded here: a run without secrets does not load a line of it.
    const { generateCACertificate, getLocal, webSocketSteps, matchers } = await import("mockttp");
    const ca = await generateCACertificate({ subject: { commonName: "loep", organizationName: "loep, alleen voor deze run" } });
    this.mock = getLocal({ https: { ...ca, tlsServerOptions: { minVersion: "TLSv1.2" } }, http2: false, recordTraffic: false, suggestChanges: false, cors: false });
    await onLoopback(() => this.mock.start());
    maskConsole();
    const trust = {
      ...(network.trustedCa ? { additionalTrustedCAs: network.trustedCa.map((cert) => ({ cert })) } : {}),
      ...(network.lookup ? { lookupOptions: network.lookup } : {}),
      simulateConnectionErrors: true,
    };
    const local = (request: CompletedRequest): boolean => isLocalHost(new URL(request.url).hostname);
    const covered = (request: CompletedRequest): boolean => shieldForRun(this.runDir)?.covers(request.url) ?? false;
    const check = (request: CompletedRequest): boolean => new URL(request.url).hostname === CHECK_HOST || new URL(realHosts(request.url)).host === this.decoyHost;
    // Every rule says `always`: without it mockttp serves a rule once and then moves on to the next one that matches.
    await this.mock.forAnyRequest().matching((request) => !this.throughGate(request)).always().thenCloseConnection();
    // For a trial on this machine: nothing goes further than this machine, whatever a page asks for.
    await this.mock
      .forAnyRequest()
      .matching((request) => this.localOnly && !check(request) && !local(request))
      .always()
      .thenCallback((request) => this.refuse(request.url, LOCAL_ONLY_NL));
    await this.mock
      .forAnyRequest()
      .matching(check)
      .always()
      .thenCallback((request) => (new URL(request.url).pathname === CHECK_START ? { statusCode: 302, headers: { location: CHECK_END, "cache-control": "no-store" } } : { statusCode: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" }, body: CHECK_MARK }));
    for (const [nearby, ignoreHostHttpsErrors] of [[false, false], [true, true]] as const) {
      await this.mock
        .forAnyRequest()
        .matching((request) => this.throughGate(request) && !check(request) && local(request) === nearby && covered(request))
        .always()
        .thenPassThrough({ ...trust, ignoreHostHttpsErrors, beforeRequest: (request) => this.swapRequest(request), beforeResponse: (response, request) => this.swapResponse(response, request) });
      await this.mock
        .forAnyRequest()
        .matching((request) => this.throughGate(request) && !check(request) && local(request) === nearby && !covered(request))
        .always()
        .thenPassThrough({
          ...trust,
          ignoreHostHttpsErrors,
          beforeRequest: (request) => {
            this.contexts.set(request.id, this.admitted.get(request.remotePort!) ?? "");
            return { url: realHosts(request.url), headers: { ...withoutHopByHop(request.headers), host: new URL(realHosts(request.url)).host } };
          },
          beforeResponse: (response, request) => this.renamed(this.contextDone(request.id), response),
        });
    }
    const step = new webSocketSteps.PassThroughWebSocketStep({ ...trust });
    const boundary = this;
    const handle = function (this: SocketStep, request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void> {
      return boundary.swapSocket(Object.getPrototypeOf(this) as SocketStep, this, request, socket, head, options);
    };
    await this.mock.addWebSocketRule({ matchers: [new matchers.WildcardMatcher()], steps: [Object.assign(step, { handle })] });
    await this.mock.on("rule-event", (event) => {
      if (event.eventType !== "passthrough-abort") return;
      this.contexts.delete(event.requestId);
      const where = this.underWay.get(event.requestId);
      if (!where) return;
      this.underWay.delete(event.requestId);
      const { error } = event.eventData as { error?: { code?: string } };
      noteSecretEvent(this.runDir, { kind: "unreachable", where, noteNl: `de site is niet bereikt: ${error?.code ?? "onbekende fout"}` });
    });
    const listen = (server: NetServer): Promise<number> => new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
    this.port = await listen(this.gate);
    this.decoyHost = `127.0.0.1:${await listen(this.decoy)}`;
  }

  async stop(): Promise<void> {
    await this.mock.stop().catch(() => undefined);
    this.gate.close();
    this.decoy.close();
  }

  /** The proxy for one browser context. The user name tells the contexts apart: the password is one, and what a site renews belongs to the context it said it to. */
  proxyFor(context: string): NonNullable<BrowserContextOptions["proxy"]> {
    return { server: `http://127.0.0.1:${this.port}`, username: `${PROXY_USER_PREFIX}${context}`, password: this.password };
  }

  /** The port of mockttp itself, for a test that goes around the gate. */
  get innerPort(): number {
    return this.mock.port;
  }

  private throughGate(request: { remotePort?: number }): boolean {
    return request.remotePort !== undefined && this.admitted.has(request.remotePort);
  }

  /** The context a connection says it is for, when it knows the password. */
  private contextOf(head: string): string | null {
    const given = /^proxy-authorization:\s*basic\s+(\S+)\s*$/im.exec(head)?.[1];
    if (!given) return null;
    const [user = "", ...rest] = Buffer.from(given, "base64").toString().split(":");
    const [offered, expected] = [Buffer.from(rest.join(":")), Buffer.from(this.password)];
    return user.startsWith(PROXY_USER_PREFIX) && offered.length === expected.length && timingSafeEqual(offered, expected) ? user.slice(PROXY_USER_PREFIX.length) : null;
  }

  /** Read the first request of a connection, and let it through to mockttp when it knows the password. After that only bytes pass here. */
  private admit(client: Socket): void {
    client.on("error", () => client.destroy());
    let head: Buffer = Buffer.alloc(0);
    const read = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) {
        if (head.length > MAX_HEAD_BYTES) client.destroy();
        return;
      }
      client.off("data", read);
      client.pause();
      const context = this.contextOf(head.subarray(0, end).toString("latin1"));
      if (context === null) {
        client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nproxy-authenticate: Basic realm="loep"\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
        // It was paused above: without reading on, the end of the other side never comes, and the socket stays.
        client.resume();
        return;
      }
      const inner = connect(this.mock.port, "127.0.0.1");
      inner.unref();
      let port = 0;
      inner.on("error", () => client.destroy());
      inner.once("connect", () => {
        port = inner.localPort!;
        this.admitted.set(port, context);
        // WebKit asks for an open socket as `GET ws://`, and mockttp only reads an address with http in that place.
        inner.write(head.subarray(0, 8).toString("latin1") === "GET ws:/" ? Buffer.concat([Buffer.from("GET http:/"), head.subarray(8)]) : head);
        client.pipe(inner).pipe(client);
      });
      inner.once("close", () => {
        this.admitted.delete(port);
        client.destroy();
      });
      client.once("close", () => inner.destroy());
    };
    client.on("data", read);
  }

  private noteRefused(where: string, reasonNl: string): void {
    noteSecretEvent(this.runDir, { kind: "refused", where, noteNl: reasonNl });
  }

  private refuse(where: string, reasonNl: string): ReturnType<typeof refusalAnswer> {
    this.noteRefused(where, reasonNl);
    return refusalAnswer(reasonNl);
  }

  private keepCookies(origin: string, shield: Shield, headers: IncomingHttpHeaders): void {
    for (const cookie of [headers["set-cookie"] ?? []].flat()) {
      const pair = cookie.split(";")[0]!;
      const alias = shield.inward(pair);
      if (alias !== pair) this.cookies.set(`${origin}\n${alias}`, pair);
    }
  }

  /** What the browser sends, with the cookies the site gave back as the site spelled them. */
  private withSiteCookies(origin: string, headers: IncomingHttpHeaders): IncomingHttpHeaders {
    if (!headers.cookie) return headers;
    return { ...headers, cookie: headers.cookie.split("; ").map((pair) => this.cookies.get(`${origin}\n${pair}`) ?? pair).join("; ") };
  }

  /** Whether this address may not get its real values, because this run may not send. */
  private guardedRefused(shield: Shield, url: string): boolean {
    return shield.touchesGuarded(url) && !writesForRun(this.runDir);
  }

  private contextDone(id: string): string {
    const context = this.contexts.get(id) ?? "";
    this.contexts.delete(id);
    return context;
  }

  /**
   * An answer as WebKit may get it: every address of this machine with the name that keeps it inside
   * the proxy. A redirect or a link with the real host would be one connection past the proxy.
   */
  private async renamed(context: string, answer: { headers: IncomingHttpHeaders; body: { getDecodedBuffer(): Promise<Buffer | undefined> } }) {
    if (!context.startsWith(WEBKIT_CONTEXT)) return undefined;
    const data = await answer.body.getDecodedBuffer();
    if (data === undefined) return this.refuse("(antwoord voor WebKit)", "dit antwoord is niet te lezen, dus een adres op deze machine erin kan WebKit buiten de grens leiden");
    const contentType = [answer.headers["content-type"] ?? ""].flat()[0] || undefined;
    const before = data.toString("latin1");
    const body = isBinaryBody(contentType, data) ? before : browserHosts(before);
    const headers = withWebKitNames(answer.headers);
    return body === before ? { headers } : { headers: Object.fromEntries(Object.entries(headers).filter(([name]) => !STALE_HEADERS.has(name))), rawBody: Buffer.from(body, "latin1") };
  }

  private async swapRequest(arriving: CompletedRequest) {
    // The real host from here on, whatever name the browser had for it.
    const url = realHosts(arriving.url);
    const request = { id: arriving.id, url, headers: arriving.headers, body: arriving.body };
    const shield = shieldForRun(this.runDir)!;
    if (this.guardedRefused(shield, request.url)) return { response: this.refuse(request.url, GUARDED_REFUSED_NL) };
    const reaching = shield.reaching(request.url);
    const sent = request.body.buffer;
    if (sent.length > MAX_REQUEST_BYTES) return { response: this.refuse(request.url, "dit verzoek is te groot om af te schermen, en is niet verstuurd") };
    const contentType = [request.headers["content-type"] ?? ""].flat()[0]!;
    const named = sent.includes("site.loep.test") ? Buffer.from(realHosts(sent.toString("latin1")), "latin1") : sent;
    const body = contentType.startsWith("application/x-www-form-urlencoded") ? reaching.outwardForm(named) : JSON_BODY.test(contentType) ? reaching.outwardJson(named) : reaching.outwardBytes(named);
    const target = new URL(reaching.outwardUrl(request.url));
    this.underWay.set(request.id, request.url);
    this.contexts.set(request.id, this.admitted.get(arriving.remotePort!) ?? "");
    const headers = {
      ...outwardHeaders(reaching, this.withSiteCookies(new URL(request.url).origin, request.headers)),
      host: target.host,
      // Asked plainly, so the answer can be read; a server that compresses all the same is unpacked below.
      "accept-encoding": "identity",
      ...(body.length > 0 || request.headers["content-length"] ? { "content-length": String(body.length) } : {}),
    };
    return { url: target.href, headers, ...(body.length > 0 ? { rawBody: body } : {}) };
  }

  private async swapResponse(answer: { id: string; statusCode: number; headers: IncomingHttpHeaders; body: { buffer: Buffer; getDecodedBuffer(): Promise<Buffer | undefined> } }, arriving: { id: string; url: string }) {
    const request = { id: arriving.id, url: realHosts(arriving.url) };
    const url = new URL(request.url);
    const context = this.contextDone(request.id);
    this.underWay.delete(request.id);
    renewSessionSecrets(this.runDir, answer.headers, url, context);
    const shield = shieldForRun(this.runDir)!;
    const where = shield.inward(request.url);
    const location = typeof answer.headers.location === "string" ? answer.headers.location : null;
    if (location && answer.statusCode >= 300 && answer.statusCode < 400) {
      const shown = shield.inward(location);
      const next = new URL(shown, where).href;
      if (shown !== location && shield.outOfReach(next)) return this.refuse(where, `de site stuurde door naar ${new URL(next).origin}, met een vervanging in het adres: die doorverwijzing is tegengehouden`);
    }
    // An empty body has nothing to unpack, also when its header says it is packed: that fails, on a HEAD or a 304.
    const decoded = answer.body.buffer.length === 0 ? answer.body.buffer : await answer.body.getDecodedBuffer();
    if (decoded === undefined) return this.refuse(where, `de site stuurde een antwoord met ${String(answer.headers["content-encoding"])}, en dat is niet af te schermen`);
    this.keepCookies(url.origin, shield, answer.headers);
    const contentType = [answer.headers["content-type"] ?? ""].flat()[0] || undefined;
    const { data, shortFound } = shield.inwardBody(decoded, contentType);
    noteShortFound(this.runDir, where, shortFound);
    const swappedHeaders = headersInward(shield, answer.headers);
    const webkit = context.startsWith(WEBKIT_CONTEXT);
    const headers = webkit ? withWebKitNames(swappedHeaders) : swappedHeaders;
    const body = webkit && !isBinaryBody(contentType, data) ? Buffer.from(browserHosts(data.toString("latin1")), "latin1") : data;
    const changedBody = body !== decoded && !body.equals(decoded);
    if (!changedBody && JSON.stringify(headers) === JSON.stringify(answer.headers)) return undefined;
    if (!changedBody) return { headers };
    return { headers: Object.fromEntries(Object.entries(headers).filter(([name]) => !STALE_HEADERS.has(name))), rawBody: body };
  }

  /**
   * In place of the step of mockttp for a socket: the address and the headers are swapped first, and
   * when the two sockets stand, whatever each is told to send goes through the swap. A message
   * arrives here whole and unpacked, so a value cut in two over frames is one value.
   */
  private async swapSocket(real: SocketStep, step: SocketStep, request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void> {
    if (!this.throughGate(request)) return void socket.destroy();
    request.url = realHosts(request.url);
    request.destination.hostname = realHosts(request.destination.hostname);
    request.rawHeaders = request.rawHeaders.map(([name, value]) => [name, realHosts(value)]);
    const url = new URL(request.url);
    if (this.localOnly && !isLocalHost(url.hostname)) {
      this.noteRefused(request.url, LOCAL_ONLY_NL);
      return void socket.destroy();
    }
    const shield = shieldForRun(this.runDir);
    const covered = shield?.covers(request.url) ? shield : null;
    if (covered && this.guardedRefused(covered, request.url)) {
      this.noteRefused(request.url, GUARDED_REFUSED_NL);
      return void socket.destroy();
    }
    if (covered) {
      const reaching = covered.reaching(request.url);
      const httpOrigin = url.origin.replace(/^ws/, "http");
      const headers = outwardHeaders(reaching, this.withSiteCookies(httpOrigin, request.headers));
      request.url = reaching.outwardUrl(request.url);
      request.rawHeaders = request.rawHeaders.flatMap(([name, value]): [string, string][] => {
        const lower = name.toLowerCase();
        if (lower === "connection" || lower === "upgrade") return [[name, value]];
        if (!(lower in headers)) return [];
        const swapped = headers[lower]!;
        return [[name, Array.isArray(swapped) ? swapped[0]! : swapped]];
      });
      socket.once("ws-upgrade", (browserSide: FrameSocket) => {
        const swapping = (target: FrameSocket, swap: (shieldNow: Shield, data: Buffer, binary: boolean) => Buffer): void => {
          const send = target.send.bind(target);
          // Read per message, so a secret that came in between counts from the next frame on.
          target.send = (data, sendOptions, done) => {
            const shieldNow = shieldForRun(this.runDir);
            send(shieldNow ? swap(shieldNow, data, sendOptions?.binary === true) : data, sendOptions, done);
          };
        };
        swapping(browserSide.upstreamWebSocket, (now, data) => now.reaching(request.url).outwardBytes(data));
        // By its shape, as a body without a type: a number in a frame of JSON is a number there too.
        swapping(browserSide, (now, data, binary) => {
          const swapped = now.inwardBody(data, binary ? "application/octet-stream" : undefined);
          noteShortFound(this.runDir, now.inward(request.url), swapped.shortFound);
          return swapped.data;
        });
      });
    } else request.rawHeaders = request.rawHeaders.filter(([name]) => !name.toLowerCase().startsWith("proxy-"));
    return real.handle.call(Object.create(step, { ignoreHostHttpsErrors: { value: isLocalHost(url.hostname) } }) as SocketStep, request, socket, head, options);
  }

  /** Why this browser does not stay inside the boundary, in Dutch, or null when it does. */
  async refusalNl(browser: Browser, local: boolean): Promise<string | null> {
    const name = browser.browserType().name();
    const context = await browser.newContext({ proxy: this.proxyFor("check"), ignoreHTTPSErrors: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const reaches = async (start: string): Promise<boolean> => {
        const before = this.bypassed;
        const answer = await page.goto(start, { timeout: CHECK_TIMEOUT_MS }).catch(() => null);
        return answer !== null && (await answer.text().catch(() => "")) === CHECK_MARK && this.bypassed === before;
      };
      if (!(await reaches(`http://${CHECK_HOST}${CHECK_START}`))) return `${name} gebruikt de grens van deze run niet, ook niet op een adres dat alleen de grens kent`;
      if (!(await reaches(`https://${CHECK_HOST}${CHECK_START}`))) return `${name} krijgt over https geen verbinding via de grens van deze run`;
      const decoy = `http://${this.decoyHost}${CHECK_START}`;
      if (local && !(await reaches(name === "webkit" ? browserAddress(decoy) : decoy))) return `${name} gaat op deze machine buiten de grens van deze run om`;
      return null;
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

const boundaries = new Map<string, Promise<Boundary>>();

function noteShortFound(runDir: string, where: string, sources: readonly string[]): void {
  for (const source of sources) noteSecretEvent(runDir, { kind: "short-in-binary", where, source, noteNl: "een korte code staat in een binair antwoord en is niet vervangen, omdat ze er ook toevallig kan staan" });
}

function boundaryOf(runDir: string): Promise<Boundary> {
  let boundary = boundaries.get(runDir);
  if (!boundary) {
    const fresh = new Boundary(runDir);
    boundary = fresh.start().then(() => fresh);
    boundaries.set(runDir, boundary);
    // A start that failed is no reason for the next one to fail.
    boundary.catch(() => boundaries.delete(runDir));
  }
  return boundary;
}

/** For a test: the proxy of a run as a stranger on this machine finds it. */
export async function boundaryPortsForTest(runDir: string): Promise<{ gate: number; inner: number; proxy: NonNullable<BrowserContextOptions["proxy"]> }> {
  const boundary = await boundaryOf(runDir);
  return { gate: boundary.port, inner: boundary.innerPort, proxy: boundary.proxyFor("test") };
}

const inside = new WeakSet<BrowserContext>();

/**
 * Note that a context was made with the boundary around it, and let it give the password of the proxy
 * once. From then on Chromium sends it by itself. Before that a protocol session that pauses answers,
 * as `guardRedirects` does, would get the 407 of the gate for an answer of the site.
 */
export async function markInsideBoundary(context: BrowserContext, runDir: string, proxy: NonNullable<BrowserContextOptions["proxy"]>): Promise<void> {
  inside.add(context);
  context.once("close", () => endContextSecrets(runDir, proxy.username!.slice(PROXY_USER_PREFIX.length)));
  if (context.browser()?.browserType().name() !== "chromium") return;
  try {
    const page = await context.newPage();
    try {
      await page.goto(`http://${CHECK_HOST}${CHECK_END}`, { timeout: CHECK_TIMEOUT_MS });
    } finally {
      await page.close();
    }
  } catch (error) {
    // The caller never gets this context, so nobody else can close it.
    await context.close().catch(() => undefined);
    throw error;
  }
}

/** Throw for a context of a run with secrets that has no boundary around it: without one the swap does not happen, and nothing else would say so. */
export function requireBoundary(context: BrowserContext, runDir: string | undefined): void {
  if (runDir !== undefined && shieldForRun(runDir) && !inside.has(context)) throw new BoundaryRefused("geweigerd in een run met geheimen: deze browsercontext loopt niet door de grens van de run. Dit is een fout in loep: meld hem");
}

/** A browser that does not stay inside the boundary. Thrown before it asked the site anything. */
export class BoundaryRefused extends Error {
  override name = "BoundaryRefused";
}

/** Per browser and per run: whether it stays inside the boundary. A browser shown to do so once is not asked again. */
const checked = new WeakMap<Browser, Map<string, Promise<string | null>>>();

/**
 * What a browser context of a run with secrets needs to stay inside the boundary; nothing for any
 * other run. A browser is shown to go through the proxy first, also after a redirect: one that does not
 * is refused here, before it asked the site anything, so a measurement in it is missing and says why.
 */
export async function boundaryForContext(browser: Browser, runDir: string | undefined): Promise<Pick<BrowserContextOptions, "proxy" | "ignoreHTTPSErrors">> {
  const shield = runDir === undefined ? null : shieldForRun(runDir);
  if (!shield) return {};
  const boundary = await boundaryOf(runDir!);
  if (!boundary.users.has(browser)) {
    boundary.users.add(browser);
    browser.once("disconnected", () => {
      boundary.users.delete(browser);
      if (boundary.users.size > 0) return;
      boundaries.delete(runDir!);
      void boundary.stop();
    });
  }
  const known = checked.get(browser) ?? new Map<string, Promise<string | null>>();
  checked.set(browser, known);
  const local = shield.secrets.some((secret) => secret.origins.some((origin) => isLocalHost(new URL(origin).hostname)) || (secret.domains ?? []).some(isLocalHost));
  if (!known.has(runDir!)) {
    const asked = boundary.refusalNl(browser, local);
    known.set(runDir!, asked);
    asked.catch(() => known.delete(runDir!));
  }
  const refusalNl = await known.get(runDir!)!;
  if (refusalNl) throw new BoundaryRefused(`geweigerd in een run met geheimen: ${refusalNl}. Zonder grens kan een geheim in de browser en in de run terechtkomen, dus deze browser doet in deze run niet mee`);
  return { proxy: boundary.proxyFor(`${browser.browserType().name()}-${randomBytes(6).toString("hex")}`), ignoreHTTPSErrors: true };
}

export interface FetchLimits {
  /** Stop reading somewhat past this: the caller cuts it off, and a value across that point has been swapped by then. */
  maxBytes?: number;
  /** Where to note a short value in a binary answer. */
  runDir?: string | undefined;
}

/** How much is read past `maxBytes`: more than the longest spelling of a value, each character escaped. */
const READ_PAST_BYTES = 64 * 1024;

/** The body of an answer, up to a limit. When the signal of the request ends it, what arrived is kept: the caller knows the time was up and says so. */
async function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal | null | undefined): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of (body ?? []) as AsyncIterable<Uint8Array>) {
      parts.push(chunk);
      size += chunk.length;
      if (size >= limit) break;
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
  return Buffer.concat(parts);
}

/**
 * A request outside the browser, in a run with secrets: the same swap as at the boundary, so what
 * comes back has aliases in it, and a binary answer stays whole. It is read here, so the limits of the
 * caller have to hold here. Any other run, and any other origin, gets a plain `fetch`.
 */
export async function shieldedFetch(shield: Shield | null, address: string, init: RequestInit, limits: FetchLimits = {}): Promise<Response> {
  // An address from a page in WebKit: this request does not go through the proxy that knows that name.
  const url = realHosts(address);
  if (process.env[LOCAL_ONLY_ENV] === "1" && !isLocalHost(new URL(url).hostname)) {
    if (limits.runDir !== undefined) noteSecretEvent(limits.runDir, { kind: "refused", where: url, noteNl: LOCAL_ONLY_NL });
    return new Response(null, { status: REFUSED_STATUS, headers: { [REFUSED_HEADER]: encodeURIComponent(LOCAL_ONLY_NL) } });
  }
  if (!shield) return fetch(url, init);
  const reaching = shield.reaching(url);
  // A caller may pass on what the browser has: its cookies are aliases, and the site only knows the real values.
  const answer = await fetch(reaching.outwardUrl(url), { ...init, headers: { ...outwardHeaders(reaching, (init.headers ?? {}) as IncomingHttpHeaders), "accept-encoding": "identity" } });
  const headers = new Headers();
  answer.headers.forEach((value, name) => {
    if (!STALE_HEADERS.has(name)) headers.append(name, headerInward(shield, name, value));
  });
  // Set-Cookie is not kept here: a file is asked for with a session, not to change it.
  const answered = { status: answer.status, statusText: answer.statusText, headers };
  if ([101, 204, 205, 304].includes(answer.status)) return new Response(null, answered);
  const read = await boundedBody(answer.body, limits.maxBytes === undefined ? Number.POSITIVE_INFINITY : limits.maxBytes + READ_PAST_BYTES, init.signal);
  const { data, shortFound } = shield.inwardBody(read, answer.headers.get("content-type") ?? undefined);
  if (limits.runDir !== undefined) noteShortFound(limits.runDir, shield.inward(url), shortFound);
  return new Response(new Uint8Array(data), answered);
}
