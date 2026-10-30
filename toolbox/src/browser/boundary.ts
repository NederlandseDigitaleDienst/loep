import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, createServer as createTcpServer, Server as NetServer, type AddressInfo, type Socket } from "node:net";
import { format } from "node:util";
import type { CompletedRequest, Mockttp } from "mockttp";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import { renewSessionSecrets } from "../lib/login.ts";
import { noteSecretEvent, shieldForRun, type Shield } from "../lib/secrets.ts";
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
 * is first shown to use it (`boundaryForContext`), and is refused when it does not.
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

const withoutHopByHop = (headers: IncomingHttpHeaders): Record<string, string | string[]> => Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined && !HOP_BY_HOP.has(entry[0])));

/** The headers of a request as the site gets them. An address in a header is spelled the way the site spelled it. */
function outwardHeaders(shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const swap = (name: string, value: string): string => (name === "referer" ? shield.outwardUrl(value) : shield.outward(value));
  return Object.fromEntries(Object.entries(withoutHopByHop(headers)).map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => swap(name, part)) : swap(name, value)]));
}

/** Headers that are a number or a date by definition: they hold no value of a run, and a short value that happens to match would break them. */
const FIXED_HEADERS = new Set(["accept-ranges", "age", "content-length", "content-range", "date", "expires", "last-modified", "retry-after"]);

const headerInward = (shield: Shield, name: string, value: string): string => (FIXED_HEADERS.has(name) ? value : shield.inward(value));

const headersInward = (shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => headerInward(shield, name, part)) : headerInward(shield, name, value)]),
  );

/** Why a value of a guarded address is not filled in: without the permission to send, such an address may not be opened, and the guard of a page does not see every request. */
const GUARDED_REFUSED_NL = "deze run mag niet versturen, en een persoonlijke link openen telt als versturen: de echte waarde is niet ingevuld";

const refusalAnswer = (reasonNl: string) => ({ statusCode: REFUSED_STATUS, statusMessage: "Geweigerd door de grens van loep", headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", [REFUSED_HEADER]: encodeURIComponent(reasonNl) }, body: `loep: ${reasonNl}\n` });

/** Listen on this machine only: mockttp asks for every interface, and offers no way to say otherwise. */
async function onLoopback(start: () => Promise<void>): Promise<void> {
  const listen = NetServer.prototype.listen;
  NetServer.prototype.listen = function (this: NetServer, ...args: unknown[]): NetServer {
    return (listen as (...parts: unknown[]) => NetServer).apply(this, args.length === 1 && typeof args[0] === "number" ? [args[0], "127.0.0.1"] : args);
  } as typeof listen;
  try {
    await start();
  } finally {
    NetServer.prototype.listen = listen;
  }
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
const PROXY_USER = "loep";

/** The step of mockttp for a socket from the inside: `swapSocket` calls the real one. */
interface SocketStep {
  ignoreHostHttpsErrors: boolean | string[];
  handle(request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void>;
}

interface SocketRequest {
  url: string;
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
  /** The ports of the connections the gate opened: only those are served. */
  private readonly admitted = new Set<number>();
  /** Requests under way to a site, by their id in mockttp, with the address as the browser knows it. */
  private readonly underWay = new Map<string, string>();
  /** A cookie with an alias in it, per origin, with the way the site spelled it: it goes back the same, as a site compares it to the letter. */
  private readonly cookies = new Map<string, string>();
  private decoyHost = "";
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
    const check = (request: CompletedRequest): boolean => new URL(request.url).hostname === CHECK_HOST || new URL(request.url).host === this.decoyHost;
    // Every rule says `always`: without it mockttp serves a rule once and then moves on to the next one that matches.
    await this.mock.forAnyRequest().matching((request) => !this.throughGate(request)).always().thenCloseConnection();
    // For a trial on this machine: nothing goes further than this machine, whatever a page asks for.
    const localOnly = process.env[LOCAL_ONLY_ENV] === "1";
    await this.mock
      .forAnyRequest()
      .matching((request) => localOnly && !check(request) && !local(request))
      .always()
      .thenCallback((request) => this.refuse(request.url, "dit adres ligt buiten deze machine, en deze run blijft hier"));
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
        .thenPassThrough({ ...trust, ignoreHostHttpsErrors, beforeRequest: (request) => ({ headers: withoutHopByHop(request.headers) }) });
    }
    const step = new webSocketSteps.PassThroughWebSocketStep({ ...trust });
    const boundary = this;
    const handle = function (this: SocketStep, request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void> {
      return boundary.swapSocket(Object.getPrototypeOf(this) as SocketStep, this, request, socket, head, options);
    };
    await this.mock.addWebSocketRule({ matchers: [new matchers.WildcardMatcher()], steps: [Object.assign(step, { handle })] });
    await this.mock.on("rule-event", (event) => {
      if (event.eventType !== "passthrough-abort") return;
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

  get proxy(): NonNullable<BrowserContextOptions["proxy"]> {
    return { server: `http://127.0.0.1:${this.port}`, username: PROXY_USER, password: this.password };
  }

  /** The port of mockttp itself, for a test that goes around the gate. */
  get innerPort(): number {
    return this.mock.port;
  }

  private throughGate(request: { remotePort?: number }): boolean {
    return request.remotePort !== undefined && this.admitted.has(request.remotePort);
  }

  private authorized(head: string): boolean {
    const given = /^proxy-authorization:\s*basic\s+(\S+)\s*$/im.exec(head)?.[1];
    if (!given) return false;
    const expected = Buffer.from(Buffer.from(`${PROXY_USER}:${this.password}`).toString("base64"));
    const offered = Buffer.from(given);
    return offered.length === expected.length && timingSafeEqual(offered, expected);
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
      if (!this.authorized(head.subarray(0, end).toString("latin1"))) {
        client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nproxy-authenticate: Basic realm="loep"\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
        return;
      }
      const inner = connect(this.mock.port, "127.0.0.1");
      inner.unref();
      let port = 0;
      inner.on("error", () => client.destroy());
      inner.once("connect", () => {
        port = inner.localPort!;
        this.admitted.add(port);
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

  private refuse(where: string, reasonNl: string): ReturnType<typeof refusalAnswer> {
    noteSecretEvent(this.runDir, { kind: "refused", where, noteNl: reasonNl });
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

  private async swapRequest(request: CompletedRequest) {
    const shield = shieldForRun(this.runDir)!;
    if (this.guardedRefused(shield, request.url)) return { response: this.refuse(request.url, GUARDED_REFUSED_NL) };
    const reaching = shield.reaching(request.url);
    const sent = request.body.buffer;
    if (sent.length > MAX_REQUEST_BYTES) return { response: this.refuse(request.url, "dit verzoek is te groot om af te schermen, en is niet verstuurd") };
    const contentType = [request.headers["content-type"] ?? ""].flat()[0]!;
    const body = contentType.startsWith("application/x-www-form-urlencoded") ? reaching.outwardForm(sent) : reaching.outwardBytes(sent);
    const target = new URL(reaching.outwardUrl(request.url));
    this.underWay.set(request.id, request.url);
    const headers = {
      ...outwardHeaders(reaching, this.withSiteCookies(new URL(request.url).origin, request.headers)),
      host: target.host,
      // Asked plainly, so the answer can be read; a server that compresses all the same is unpacked below.
      "accept-encoding": "identity",
      ...(body.length > 0 || request.headers["content-length"] ? { "content-length": String(body.length) } : {}),
    };
    return { url: target.href, headers, ...(body.length > 0 ? { rawBody: body } : {}) };
  }

  private async swapResponse(answer: { id: string; statusCode: number; headers: IncomingHttpHeaders; body: { getDecodedBuffer(): Promise<Buffer | undefined> } }, request: { id: string; url: string }) {
    const url = new URL(request.url);
    this.underWay.delete(request.id);
    renewSessionSecrets(this.runDir, answer.headers, url);
    const shield = shieldForRun(this.runDir)!;
    const where = shield.inward(request.url);
    const location = typeof answer.headers.location === "string" ? answer.headers.location : null;
    if (location && answer.statusCode >= 300 && answer.statusCode < 400) {
      const shown = shield.inward(location);
      const next = new URL(shown, where).href;
      if (shown !== location && shield.outOfReach(next)) return this.refuse(where, `de site stuurde door naar ${new URL(next).origin}, met een vervanging in het adres: die doorverwijzing is tegengehouden`);
    }
    const decoded = await answer.body.getDecodedBuffer();
    if (decoded === undefined) return this.refuse(where, `de site stuurde een antwoord met ${String(answer.headers["content-encoding"])}, en dat is niet af te schermen`);
    this.keepCookies(url.origin, shield, answer.headers);
    const contentType = [answer.headers["content-type"] ?? ""].flat()[0] || undefined;
    const { data, shortFound } = shield.inwardBody(decoded, contentType);
    for (const source of shortFound) noteSecretEvent(this.runDir, { kind: "short-in-binary", where, source, noteNl: "een korte code staat in een binair antwoord en is niet vervangen, omdat ze er ook toevallig kan staan" });
    const headers = headersInward(shield, answer.headers);
    const changedBody = data !== decoded;
    if (!changedBody && JSON.stringify(headers) === JSON.stringify(answer.headers)) return undefined;
    if (!changedBody) return { headers };
    return { headers: Object.fromEntries(Object.entries(headers).filter(([name]) => !STALE_HEADERS.has(name))), rawBody: data };
  }

  /**
   * In place of the step of mockttp for a socket: the address and the headers are swapped first, and
   * when the two sockets stand, whatever each is told to send goes through the swap. A message
   * arrives here whole and unpacked, so a value cut in two over frames is one value.
   */
  private async swapSocket(real: SocketStep, step: SocketStep, request: SocketRequest, socket: Socket, head: Buffer, options: unknown): Promise<void> {
    if (!this.throughGate(request)) return void socket.destroy();
    const url = new URL(request.url);
    if (process.env[LOCAL_ONLY_ENV] === "1" && !isLocalHost(url.hostname)) {
      noteSecretEvent(this.runDir, { kind: "refused", where: request.url, noteNl: "dit adres ligt buiten deze machine, en deze run blijft hier" });
      return void socket.destroy();
    }
    const shield = shieldForRun(this.runDir);
    const covered = shield?.covers(request.url) ? shield : null;
    if (covered && this.guardedRefused(covered, request.url)) {
      noteSecretEvent(this.runDir, { kind: "refused", where: request.url, noteNl: GUARDED_REFUSED_NL });
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
        swapping(browserSide, (now, data, binary) => now.inwardBody(data, binary ? "application/octet-stream" : "text/plain").data);
      });
    } else request.rawHeaders = request.rawHeaders.filter(([name]) => !name.toLowerCase().startsWith("proxy-"));
    return real.handle.call(Object.create(step, { ignoreHostHttpsErrors: { value: isLocalHost(url.hostname) } }) as SocketStep, request, socket, head, options);
  }

  /** Why this browser does not stay inside the boundary, in Dutch, or null when it does. */
  async refusalNl(browser: Browser, local: boolean): Promise<string | null> {
    const name = browser.browserType().name();
    const context = await browser.newContext({ proxy: this.proxy, ignoreHTTPSErrors: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const reaches = async (start: string): Promise<boolean> => {
        const before = this.bypassed;
        const answer = await page.goto(start, { timeout: CHECK_TIMEOUT_MS }).catch(() => null);
        return answer !== null && (await answer.text().catch(() => "")) === CHECK_MARK && this.bypassed === before;
      };
      if (!(await reaches(`http://${CHECK_HOST}${CHECK_START}`))) return `${name} gebruikt de grens van deze run niet, ook niet op een adres dat alleen de grens kent`;
      if (!(await reaches(`https://${CHECK_HOST}${CHECK_START}`))) return `${name} krijgt over https geen verbinding via de grens van deze run`;
      if (local && !(await reaches(`http://${this.decoyHost}${CHECK_START}`))) return `${name} volgt een doorverwijzing op deze machine buiten de grens van deze run om`;
      return null;
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

const boundaries = new Map<string, Promise<Boundary>>();

function boundaryOf(runDir: string): Promise<Boundary> {
  let boundary = boundaries.get(runDir);
  if (!boundary) {
    const fresh = new Boundary(runDir);
    boundary = fresh.start().then(() => fresh);
    boundaries.set(runDir, boundary);
  }
  return boundary;
}

/** For a test: the proxy of a run as a stranger on this machine finds it. */
export async function boundaryPortsForTest(runDir: string): Promise<{ gate: number; inner: number; proxy: NonNullable<BrowserContextOptions["proxy"]> }> {
  const boundary = await boundaryOf(runDir);
  return { gate: boundary.port, inner: boundary.innerPort, proxy: boundary.proxy };
}

const inside = new WeakSet<BrowserContext>();

/**
 * Note that a context was made with the boundary around it, and let it give the password of the proxy
 * once. From then on Chromium sends it by itself. Before that a protocol session that pauses answers,
 * as `guardRedirects` does, would get the 407 of the gate for an answer of the site.
 */
export async function markInsideBoundary(context: BrowserContext): Promise<void> {
  inside.add(context);
  if (context.browser()?.browserType().name() !== "chromium") return;
  const page = await context.newPage();
  try {
    await page.goto(`http://${CHECK_HOST}${CHECK_END}`, { timeout: CHECK_TIMEOUT_MS });
  } finally {
    await page.close();
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
  if (!known.has(runDir!)) known.set(runDir!, boundary.refusalNl(browser, local));
  const refusalNl = await known.get(runDir!)!;
  if (refusalNl) throw new BoundaryRefused(`geweigerd in een run met geheimen: ${refusalNl}. Zonder grens kan een geheim in de browser en in de run terechtkomen, dus deze browser doet in deze run niet mee`);
  return { proxy: boundary.proxy, ignoreHTTPSErrors: true };
}

/**
 * A request outside the browser, in a run with secrets: the same swap as at the boundary, so what
 * comes back has aliases in it. Any other run, and any other origin, gets a plain `fetch`.
 */
export async function shieldedFetch(shield: Shield | null, url: string, init: RequestInit): Promise<Response> {
  if (!shield) return fetch(url, init);
  const answer = await fetch(shield.reaching(url).outwardUrl(url), { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "accept-encoding": "identity" } });
  const headers = new Headers();
  answer.headers.forEach((value, name) => {
    if (!STALE_HEADERS.has(name)) headers.append(name, shield.inward(value));
  });
  // Set-Cookie is not read here: the callers ask without a session.
  const empty = [101, 204, 205, 304].includes(answer.status);
  return new Response(empty ? null : new Uint8Array(shield.inwardBytes(Buffer.from(await answer.arrayBuffer()))), { status: answer.status, statusText: answer.statusText, headers });
}
