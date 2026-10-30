import { Agent as HttpAgent, createServer, request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect, isIP, type AddressInfo, type Socket } from "node:net";
import { pipeline, Transform } from "node:stream";
import { createSecureContext, TLSSocket, type ConnectionOptions } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import { localCertificate } from "../lib/localcert.ts";
import { shieldForRun, type Shield } from "../lib/shield.ts";
import { isLocalHost, type WriteAccess } from "../lib/writes.ts";

/*
 * The boundary of `lib/shield.ts`. A route of Playwright does not see what the browser asks by itself
 * after a redirect, so a boundary made of routes has holes that no list of cases closes. Here the
 * boundary is a proxy on this machine: every browser context of a run with a mailbox has it as its
 * proxy, and every request leaves through it, in Chromium, Firefox and WebKit alike, also the one after
 * a redirect, after a form that is repeated (307, 308), and the upgrade of a socket.
 *
 * On a request to an origin the run may send to, the proxy fills in the real values, in the address,
 * the headers, the body and the frames of a socket. In the answer it puts the aliases back before the
 * browser gets a byte of it: headers, cookies, a redirect, the body of any type, frames. Any other
 * origin gets what the browser has, which is aliases, through a tunnel that is not read.
 *
 * What the browser does not send through a proxy is what this has to guard against, so a browser
 * is first shown to use it (`boundaryForContext`), and is refused when it does not.
 */

/** The shield for a request of a run, or null: no mailbox, or an origin the run may not send to. */
export function shieldOf(writes: WriteAccess | null | undefined, url: string): Shield | null {
  if (!writes) return null;
  const shield = shieldForRun(writes.runDir);
  return shield?.covers(url) ? shield : null;
}

/** Headers that say something about one connection. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
/** Headers that say something about the body as it came from the server. */
const STALE_HEADERS = new Set(["content-encoding", "content-length", "etag", "digest", "content-md5"]);
/** The body that goes out is swapped whole; a request larger than this is no form and is refused. */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const DECODERS: Record<string, () => Transform> = { gzip: createGunzip, "x-gzip": createGunzip, deflate: createInflate, br: createBrotliDecompress };

/** Where a host really is: a test puts a made-up host name on a server on this machine, with a certificate of its own. */
export interface BoundaryNetwork {
  place?: (host: string, port: number) => { host: string; port: number };
  tls?: Pick<ConnectionOptions, "ca" | "checkServerIdentity">;
}

let network: BoundaryNetwork = {};

/** For a test: where the boundary finds the hosts. */
export function setBoundaryNetwork(next: BoundaryNetwork): void {
  network = next;
}

const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

const defaultPort = (url: URL): number => Number(url.port || (url.protocol === "https:" ? 443 : 80));

/** Ask the server for something. An error about its certificate ends here: the browser itself no longer checks it. */
function ask(url: URL, method: string, headers: Record<string, string | string[]>, keepAlive: boolean): ClientRequest {
  const secure = url.protocol === "https:";
  const place = network.place?.(url.hostname, defaultPort(url)) ?? { host: url.hostname.replace(/^\[|\]$/g, ""), port: defaultPort(url) };
  const options = { host: place.host, port: place.port, method, path: `${url.pathname}${url.search}`, headers };
  if (!secure) return httpRequest({ ...options, agent: keepAlive ? httpAgent : false });
  return httpsRequest({ ...options, agent: keepAlive ? httpsAgent : false, ...(isIP(url.hostname) ? {} : { servername: url.hostname }), ...network.tls });
}

const withoutHopByHop = (headers: IncomingHttpHeaders): Record<string, string | string[]> => Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined && !HOP_BY_HOP.has(entry[0])));

/** The headers of a request as the site gets them. An address in a header is spelled the way the site spelled it. */
function outwardHeaders(shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const swap = (name: string, value: string): string => (name === "referer" ? shield.outwardUrl(value) : shield.outward(value));
  return Object.fromEntries(Object.entries(withoutHopByHop(headers)).map(([name, value]) => [name, Array.isArray(value) ? value.map((part) => swap(name, part)) : swap(name, value)]));
}

const inwardHeaders = (shield: Shield, headers: IncomingHttpHeaders): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(withoutHopByHop(headers))
      .filter(([name]) => !STALE_HEADERS.has(name))
      .map(([name, value]) => [name, Array.isArray(value) ? value.map(shield.inward) : shield.inward(value)]),
  );

/** A body on its way back, of any type and any size, swapped as it passes: a value cut in two by the network stays one value. */
function inwardStream(shield: Shield): Transform {
  let held: Buffer = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, done): void {
      const data = Buffer.concat([held, chunk]);
      const keep = shield.unfinishedTail(data);
      held = data.subarray(data.length - keep);
      done(null, shield.inwardBytes(data.subarray(0, data.length - keep)));
    },
    flush(done): void {
      done(null, shield.inwardBytes(held));
    },
  });
}

const fail = (response: ServerResponse, status: number, textNl: string): void => {
  if (response.headersSent) return void response.destroy();
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(`loep: ${textNl}\n`);
};

const firstLine = (error: Error): string => error.message.split("\n")[0]!;

// ---- A frame over a socket ---------------------------------------------------------------------------------------------

interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  /** The bytes it took. */
  size: number;
}

/** The frame at the start of the bytes (RFC 6455), or null when it has not all arrived. */
function readFrame(data: Buffer): Frame | null {
  if (data.length < 2) return null;
  const masked = (data[1]! & 0x80) !== 0;
  let length = data[1]! & 0x7f;
  let at = 2;
  if (length === 126) {
    if (data.length < 4) return null;
    length = data.readUInt16BE(2);
    at = 4;
  } else if (length === 127) {
    if (data.length < 10) return null;
    length = Number(data.readBigUInt64BE(2));
    at = 10;
  }
  const end = at + (masked ? 4 : 0) + length;
  if (data.length < end) return null;
  const payload = Buffer.from(data.subarray(end - length, end));
  if (masked) {
    const mask = data.subarray(at, at + 4);
    for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
  }
  return { fin: (data[0]! & 0x80) !== 0, opcode: data[0]! & 0x0f, payload, size: end };
}

function writeFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  const length = payload.length;
  const head = length < 126 ? Buffer.from([0x80 | opcode, length]) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (length >= 126) {
    head[0] = 0x80 | opcode;
    head[1] = length < 65536 ? 126 : 127;
    if (length < 65536) head.writeUInt16BE(length, 2);
    else head.writeBigUInt64BE(BigInt(length), 2);
  }
  if (!masked) return Buffer.concat([head, payload]);
  head[1]! |= 0x80;
  const mask = Buffer.from([Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256]);
  return Buffer.concat([head, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]!))]);
}

/** Frames with what is in them swapped. A message in parts is put together first: a value can be cut in two there too. A client masks its frames, a server does not. */
function frameStream(swap: (payload: Buffer) => Buffer, masked: boolean): Transform {
  let buffer: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let opcode = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done): void {
      buffer = Buffer.concat([buffer, chunk]);
      for (let frame = readFrame(buffer); frame; frame = readFrame(buffer)) {
        buffer = buffer.subarray(frame.size);
        if (frame.opcode >= 8) {
          this.push(writeFrame(frame.opcode, frame.payload, masked));
          continue;
        }
        if (frame.opcode !== 0) opcode = frame.opcode;
        parts.push(frame.payload);
        if (!frame.fin) continue;
        this.push(writeFrame(opcode, swap(Buffer.concat(parts)), masked));
        parts = [];
      }
      done();
    },
  });
}

// ---- The proxy ---------------------------------------------------------------------------------------------------------

/** A name that exists nowhere: only the proxy can answer it. */
const CHECK_HOST = "loep-grens.invalid";
const CHECK_START = "/start";
const CHECK_END = "/einde";
const CHECK_MARK = "loep-grens";
const CHECK_TIMEOUT_MS = 15_000;

class Boundary {
  readonly runDir: string;
  private readonly front: Server;
  /** Gets what comes out of a tunnel to an origin of the run. */
  private readonly inner: Server;
  /** Stands for a site on this machine. The proxy answers for it, so a browser that comes here went around the proxy. */
  private readonly decoy: Server;
  private readonly origins = new WeakMap<Socket, string>();
  private readonly secure = createSecureContext(localCertificate());
  /** A cookie with an alias in it, per origin, with the way the site spelled it: it goes back the same, as a site compares it to the letter. */
  private readonly cookies = new Map<string, string>();
  private decoyHost = "";
  /** How many requests reached the decoy past the proxy. */
  bypassed = 0;
  port = 0;

  constructor(runDir: string) {
    this.runDir = runDir;
    this.decoy = createServer((_request, response) => {
      this.bypassed++;
      response.writeHead(200, { "content-type": "text/plain" }).end("buiten de grens om");
    });
    this.front = createServer((request, response) => {
      // A request that is not in the form a proxy gets, did not come from a browser that uses it as one.
      if (!/^https?:/i.test(request.url ?? "")) return fail(response, 400, "dit is de grens van een run met een mailbox, geen website");
      this.handle(new URL(request.url!), request, response);
    });
    this.inner = createServer((request, response) => this.handle(new URL(request.url!, this.originOf(request)), request, response));
    this.front.on("connect", (request, socket, head) => this.tunnel(request, socket as Socket, head));
    this.front.on("upgrade", (request, socket, head) => this.upgrade(new URL(request.url!.replace(/^ws/i, "http")), request, socket as Socket, head));
    this.inner.on("upgrade", (request, socket, head) => this.upgrade(new URL(request.url!, this.originOf(request)), request, socket as Socket, head));
    for (const server of [this.front, this.decoy]) {
      server.on("connection", (socket) => socket.unref());
      server.unref();
    }
  }

  async start(): Promise<void> {
    const listen = (server: Server): Promise<number> => new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
    this.port = await listen(this.front);
    this.decoyHost = `127.0.0.1:${await listen(this.decoy)}`;
  }

  get proxy(): NonNullable<BrowserContextOptions["proxy"]> {
    return { server: `http://127.0.0.1:${this.port}` };
  }

  private originOf(request: IncomingMessage): string {
    return this.origins.get(request.socket)!;
  }

  private handle(url: URL, request: IncomingMessage, response: ServerResponse): void {
    if (url.hostname === CHECK_HOST || url.host === this.decoyHost) {
      if (url.pathname === CHECK_START) return void response.writeHead(302, { location: CHECK_END, "cache-control": "no-store" }).end();
      return void response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }).end(CHECK_MARK);
    }
    const shield = shieldForRun(this.runDir);
    if (shield?.covers(url.href)) this.swapped(url, shield, request, response);
    else this.passed(url, request, response);
  }

  /** Another origin gets what the browser has, and what it answers is left alone. */
  private passed(url: URL, request: IncomingMessage, response: ServerResponse): void {
    const out = ask(url, request.method!, withoutHopByHop(request.headers), true);
    out.on("response", (answer) => {
      response.writeHead(answer.statusCode!, answer.statusMessage, withoutHopByHop(answer.headers));
      answer.pipe(response);
    });
    out.on("error", (error) => fail(response, 502, `${url.host} is niet te bereiken: ${firstLine(error)}`));
    request.pipe(out);
  }

  private keepCookies(origin: string, shield: Shield, headers: IncomingHttpHeaders): void {
    for (const cookie of headers["set-cookie"] ?? []) {
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

  private swapped(url: URL, shield: Shield, request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_REQUEST_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_REQUEST_BYTES) return fail(response, 413, "dit verzoek is te groot om af te schermen, en is niet verstuurd");
      const sent = Buffer.concat(chunks);
      const body = (request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded") ? shield.outwardForm(sent) : shield.outwardBytes(sent);
      const target = new URL(shield.outwardUrl(url.href));
      // Asked plainly, so the answer can be read; a server that compresses all the same is unpacked below.
      const headers = { ...outwardHeaders(shield, this.withSiteCookies(url.origin, request.headers)), host: target.host, "accept-encoding": "identity", ...(body.length > 0 || request.headers["content-length"] ? { "content-length": String(body.length) } : {}) };
      const out = ask(target, request.method!, headers, true);
      out.on("response", (answer) => {
        const encoding = (answer.headers["content-encoding"] ?? "identity").toLowerCase();
        const decoder = DECODERS[encoding];
        if (encoding !== "identity" && !decoder) {
          answer.resume();
          return fail(response, 502, `de site stuurt een antwoord met ${encoding}, en dat is niet af te schermen`);
        }
        this.keepCookies(url.origin, shield, answer.headers);
        response.writeHead(answer.statusCode!, answer.statusMessage, inwardHeaders(shield, answer.headers));
        pipeline([answer, ...(decoder ? [decoder()] : []), inwardStream(shield), response], () => undefined);
      });
      // Says nothing of the address or the body: those hold the real values.
      out.on("error", (error) => fail(response, 502, `${url.host} is niet te bereiken: ${firstLine(error)}`));
      out.end(body);
    });
  }

  /** A CONNECT: to an origin of the run the tunnel ends here, any other tunnel is left closed to reading. */
  private tunnel(request: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.unref();
    socket.on("error", () => socket.destroy());
    const authority = request.url!;
    const shield = shieldForRun(this.runDir);
    const https = `https://${authority}`;
    const http = `http://${authority}`;
    const origin = shield?.covers(https) || authority.startsWith(`${CHECK_HOST}:`) ? https : shield?.covers(http) ? http : null;
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) socket.unshift(head);
    if (origin === null) return this.blindTunnel(authority, socket);
    if (origin === http) {
      this.origins.set(socket, origin);
      this.inner.emit("connection", socket);
      return;
    }
    const secure = new TLSSocket(socket, { isServer: true, secureContext: this.secure, ALPNProtocols: ["http/1.1"] });
    secure.on("error", () => secure.destroy());
    this.origins.set(secure, origin);
    secure.once("secure", () => this.inner.emit("connection", secure));
  }

  private blindTunnel(authority: string, socket: Socket): void {
    const url = new URL(`http://${authority}`);
    const place = network.place?.(url.hostname, defaultPort(url)) ?? { host: url.hostname.replace(/^\[|\]$/g, ""), port: defaultPort(url) };
    const remote = connect(place.port, place.host);
    remote.unref();
    remote.on("error", () => socket.destroy());
    socket.on("close", () => remote.destroy());
    remote.on("close", () => socket.destroy());
    socket.pipe(remote).pipe(socket);
  }

  private upgrade(url: URL, request: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.unref();
    socket.on("error", () => socket.destroy());
    const shield = shieldForRun(this.runDir);
    const covered = shield?.covers(url.href) ? shield : null;
    const target = new URL(covered ? covered.outwardUrl(url.href) : url.href);
    // A frame that is compressed cannot be read, so the server is not offered that.
    const { "sec-websocket-extensions": _compression, ...offered } = request.headers;
    const swappedHeaders = covered ? outwardHeaders(covered, this.withSiteCookies(url.origin, offered)) : withoutHopByHop(offered);
    const out = ask(target, "GET", { ...swappedHeaders, host: target.host, connection: "Upgrade", upgrade: "websocket" }, false);
    out.on("upgrade", (answer, remote: Socket, remoteHead) => {
      remote.unref();
      const headers = covered ? inwardHeaders(covered, answer.headers) : withoutHopByHop(answer.headers);
      const lines = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((part) => `${name}: ${part}`));
      socket.write(`HTTP/1.1 101 ${answer.statusMessage ?? "Switching Protocols"}\r\nconnection: Upgrade\r\nupgrade: websocket\r\n${lines.join("\r\n")}\r\n\r\n`);
      remote.on("error", () => socket.destroy());
      socket.on("close", () => remote.destroy());
      remote.on("close", () => socket.destroy());
      // Read per message, so a secret that came in between counts from the next frame on.
      const inward = (payload: Buffer): Buffer => shieldForRun(this.runDir)?.inwardBytes(payload) ?? payload;
      const outward = (payload: Buffer): Buffer => shieldForRun(this.runDir)?.outwardBytes(payload) ?? payload;
      if (remoteHead.length > 0) remote.unshift(remoteHead);
      if (head.length > 0) socket.unshift(head);
      if (covered) {
        pipeline(socket, frameStream(outward, true), remote, () => undefined);
        pipeline(remote, frameStream(inward, false), socket, () => undefined);
      } else socket.pipe(remote).pipe(socket);
    });
    out.on("response", (answer) => {
      socket.end(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage ?? ""}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
      answer.resume();
    });
    out.on("error", () => socket.destroy());
    out.end();
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

const inside = new WeakSet<BrowserContext>();
/** Note that a context was made with the boundary around it. */
export const markInsideBoundary = (context: BrowserContext): void => void inside.add(context);

/** Throw for a context of a run with a mailbox that has no boundary around it: without one the swap does not happen, and nothing else would say so. */
export function requireBoundary(context: BrowserContext, runDir: string | undefined): void {
  if (runDir !== undefined && shieldForRun(runDir) && !inside.has(context)) throw new BoundaryRefused("geweigerd in een run met een mailbox: deze browsercontext loopt niet door de grens van de run. Dit is een fout in loep: meld hem");
}

/** A browser that does not stay inside the boundary. Thrown before it asked the site anything. */
export class BoundaryRefused extends Error {
  override name = "BoundaryRefused";
}

/** Per browser and per run: whether it stays inside the boundary. A browser shown to do so once is not asked again. */
const checked = new WeakMap<Browser, Map<string, Promise<string | null>>>();

/**
 * What a browser context of a run with a mailbox needs to stay inside the boundary; nothing for any
 * other run. A browser is shown to go through the proxy first, also after a redirect: one that does not
 * is refused here, before it asked the site anything, so a measurement in it is missing and says why.
 */
export async function boundaryForContext(browser: Browser, runDir: string | undefined): Promise<Pick<BrowserContextOptions, "proxy" | "ignoreHTTPSErrors">> {
  const shield = runDir === undefined ? null : shieldForRun(runDir);
  if (!shield) return {};
  const boundary = await boundaryOf(runDir!);
  const known = checked.get(browser) ?? new Map<string, Promise<string | null>>();
  checked.set(browser, known);
  const local = shield.origins.some((origin) => isLocalHost(new URL(origin).hostname));
  if (!known.has(runDir!)) known.set(runDir!, boundary.refusalNl(browser, local));
  const refusalNl = await known.get(runDir!)!;
  if (refusalNl) throw new BoundaryRefused(`geweigerd in een run met een mailbox: ${refusalNl}. Zonder grens kan het token in de browser en in de run terechtkomen, dus deze browser doet in deze run niet mee`);
  return { proxy: boundary.proxy, ignoreHTTPSErrors: true };
}

/**
 * A request outside the browser, in a run with a mailbox: the same swap as at the boundary, so what
 * comes back has aliases in it. Any other run, and any other origin, gets a plain `fetch`.
 */
export async function shieldedFetch(shield: Shield | null, url: string, init: RequestInit): Promise<Response> {
  if (!shield) return fetch(url, init);
  const answer = await fetch(shield.outwardUrl(url), { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "accept-encoding": "identity" } });
  const headers = new Headers();
  answer.headers.forEach((value, name) => {
    if (!STALE_HEADERS.has(name)) headers.append(name, shield.inward(value));
  });
  // Set-Cookie is not read here: the callers ask without a session.
  const empty = [101, 204, 205, 304].includes(answer.status);
  return new Response(empty ? null : new Uint8Array(shield.inwardBytes(Buffer.from(await answer.arrayBuffer()))), { status: answer.status, statusText: answer.statusText, headers });
}
