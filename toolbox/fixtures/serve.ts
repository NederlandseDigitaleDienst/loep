#!/usr/bin/env node
/**
 * Serves the fixture: two variants of a small municipal site and a third origin that plays
 * the role of an external video and form service. Node built-ins only.
 *
 *   node fixtures/serve.ts [--defect 4710] [--clean 4711] [--third 4712] [--log <file>] [--session-seconds 1800]
 *
 * Everything binds to 127.0.0.1. Every request that is not a GET or HEAD and every WebSocket
 * message is appended to the log as one JSON object per line, so a test can prove that an
 * evaluation run sent nothing to the site. The log is never truncated: compare line counts
 * before and after a run, or pass a fresh file.
 *
 * The two sites have a part behind a login (/mijn/). The account is in account.ts; a session
 * is a cookie that lasts --session-seconds from the moment of logging in.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, sep } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ACCOUNT, ACCOUNT_HOME, DEFAULT_SESSION_SECONDS, LOGIN_PAGE, LOGOUT_PATHS, SESSION_COOKIE } from "./account.ts";
import { createMailRoute, type MailRoute } from "./mailroute.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** The ports the generated files were written for; the server rewrites them when it listens elsewhere. */
export const DEFAULT_PORTS = { defect: 4710, clean: 4711, thirdParty: 4712 } as const;
const DIRECTORIES = { defect: "lindewaard", clean: "berkenveen", thirdParty: "kijkpunt" } as const;
export type SiteKey = keyof typeof DEFAULT_PORTS;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
};
const TEXT = new Set([".html", ".css", ".js", ".xml", ".txt"]);

export interface LogEntry {
  time: string;
  site: SiteKey;
  kind: "request" | "ws-open" | "ws-message";
  method?: string;
  path: string;
  body?: string;
}

export interface FixtureServer {
  origins: Record<SiteKey, string>;
  logFile: string;
  /** Entries that mean something was sent to a site: non-GET requests and socket messages. */
  writes(): LogEntry[];
  /** How often a visitor with a session asked for an address that ends it. */
  logouts(): number;
  /** End every session now, as if its time had passed. */
  expireSessions(): void;
  /** The hard mail route on the sites, with the mailing service on the third party. */
  mailRoute: MailRoute;
  close(): Promise<void>;
}

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

/** Minimal frame reader: unfragmented text frames from a browser, which are always masked. */
function readFrames(buffer: Buffer, onText: (text: string) => void, onClose: () => void): Buffer {
  let rest = buffer;
  for (;;) {
    if (rest.length < 2) return rest;
    const opcode = rest[0]! & 0x0f;
    const masked = (rest[1]! & 0x80) !== 0;
    let length = rest[1]! & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (rest.length < 4) return rest;
      length = rest.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (rest.length < 10) return rest;
      length = Number(rest.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (rest.length < offset + maskLength + length) return rest;
    const payload = Buffer.from(rest.subarray(offset + maskLength, offset + maskLength + length));
    if (masked) {
      const mask = rest.subarray(offset, offset + 4);
      for (let index = 0; index < payload.length; index++) payload[index] = payload[index]! ^ mask[index % 4]!;
    }
    rest = rest.subarray(offset + maskLength + length);
    if (opcode === 0x8) onClose();
    else if (opcode === 0x1) onText(payload.toString("utf8"));
  }
}

export async function startFixture(options: { ports?: Partial<Record<SiteKey, number>>; logFile?: string; sessionSeconds?: number } = {}): Promise<FixtureServer> {
  const logFile = options.logFile ?? join(ROOT, "..", "runs", "fixture-server.log");
  mkdirSync(dirname(logFile), { recursive: true });
  // Append only: a second server that fails to bind must not wipe the log of the one that is running.
  appendFileSync(logFile, "");
  const log = (entry: Omit<LogEntry, "time">): void => appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);

  const servers = {} as Record<SiteKey, Server>;
  const origins = {} as Record<SiteKey, string>;
  const keys = Object.keys(DEFAULT_PORTS) as SiteKey[];

  /** The files name the default ports; replace them with the ports in use. */
  const rewrite = (text: string): string => keys.reduce((result, key) => result.replaceAll(`http://127.0.0.1:${DEFAULT_PORTS[key]}`, origins[key]), text);

  const sendFile = (response: ServerResponse, path: string, status: number, head: boolean): void => {
    const extension = extname(path);
    const body = TEXT.has(extension) ? Buffer.from(rewrite(readFileSync(path, "utf8"))) : readFileSync(path);
    response.writeHead(status, { "content-type": TYPES[extension] ?? "application/octet-stream", "content-length": body.length, "cache-control": "no-store" });
    response.end(head ? undefined : body);
  };

  /** Sessions of the part behind the login: per token the site it is for and the moment it ends. */
  const sessions = new Map<string, { site: SiteKey; until: number }>();
  const sessionMs = (options.sessionSeconds ?? DEFAULT_SESSION_SECONDS) * 1000;
  let logouts = 0;
  const tokenOf = (request: IncomingMessage): string | null => new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`).exec(request.headers.cookie ?? "")?.[1] ?? null;
  const loggedIn = (site: SiteKey, request: IncomingMessage): boolean => {
    const session = sessions.get(tokenOf(request) ?? "");
    return session !== undefined && session.site === site && session.until > Date.now();
  };
  const redirect = (response: ServerResponse, status: number, location: string, cookie?: string): void => void response.writeHead(status, { location, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) }).end();

  const mailRoute = createMailRoute((path, body) => log({ site: "clean", kind: "request", method: "POST", path, body: body.slice(0, 2000) }));

  const handler = (site: SiteKey) => (request: IncomingMessage, response: ServerResponse): void => {
    if (site === "thirdParty" ? mailRoute.service(request, response) : site === "clean" && mailRoute.site(request, response, origins.clean, origins.thirdParty)) return;
    const root = join(ROOT, "sites", DIRECTORIES[site]);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    // An address that ends the session does so whatever the method, as a link on a real site would.
    if (LOGOUT_PATHS.includes(url.pathname)) {
      if (loggedIn(site, request)) logouts++;
      sessions.delete(tokenOf(request) ?? "");
      return redirect(response, 302, LOGIN_PAGE, `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    }
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        log({ site, kind: "request", method, path: url.pathname + url.search, body: body.slice(0, 2000) });
        // The right name and password open a session. Anything else is answered the way every form here is answered.
        const sent = new URLSearchParams(body);
        if (method === "POST" && url.pathname === "/inloggen" && sent.get("gebruikersnaam") === ACCOUNT.username && sent.get("wachtwoord") === ACCOUNT.password) {
          const token = randomBytes(16).toString("hex");
          sessions.set(token, { site, until: Date.now() + sessionMs });
          return redirect(response, 303, ACCOUNT_HOME, `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
        }
        // A form is answered as most sites answer one: go and fetch the page that says it arrived (303 See Other), so that reloading it sends nothing again.
        if (method === "POST" && existsSync(join(root, "bedankt.html"))) redirect(response, 303, "/bedankt.html");
        else response.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Niet toegestaan\n");
      });
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = "/400";
    }
    // The part behind the login is there only for a visitor with a session; anybody else is sent to the login page.
    if ((pathname === "/mijn" || pathname.startsWith("/mijn/")) && !loggedIn(site, request)) return redirect(response, 302, LOGIN_PAGE);
    if (pathname.endsWith("/")) pathname += "index.html";
    const path = normalize(join(root, pathname));
    const inside = path.startsWith(root + sep);
    if (inside && existsSync(path) && statSync(path).isFile() && pathname !== "/404.html") {
      sendFile(response, path, 200, method === "HEAD");
      return;
    }
    const notFound = join(root, "404.html");
    if (existsSync(notFound)) sendFile(response, notFound, 404, method === "HEAD");
    else response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Niet gevonden\n");
  };

  const upgrade = (site: SiteKey) => (request: IncomingMessage, socket: Duplex): void => {
    const key = request.headers["sec-websocket-key"];
    // The chat opens its socket on an address with a token of its own per connection: /ws/chat/<sixteen letters>.
    const path = request.url ?? "";
    if (!/^\/ws\/chat\/[A-Za-z]{16}$/.test(path) || typeof key !== "string") {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    log({ site, kind: "ws-open", path });
    socket.write(textFrame("Welkom bij de chat van de gemeente. Waarmee kunnen wij u helpen?"));
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = readFrames(
        Buffer.concat([pending, chunk]),
        (text) => {
          log({ site, kind: "ws-message", path, body: text.slice(0, 2000) });
          socket.write(textFrame("Bedankt voor uw bericht. Een medewerker reageert zo snel mogelijk."));
        },
        () => socket.end(),
      );
    });
    socket.on("error", () => socket.destroy());
  };

  for (const key of keys) {
    const server = createServer(handler(key));
    if (key !== "thirdParty") server.on("upgrade", upgrade(key));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.ports?.[key] ?? DEFAULT_PORTS[key], "127.0.0.1", resolve);
    });
    servers[key] = server;
    origins[key] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  return {
    origins,
    logFile,
    writes: () =>
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEntry)
        .filter((entry) => entry.kind !== "ws-open"),
    logouts: () => logouts,
    expireSessions: () => sessions.clear(),
    mailRoute,
    close: async () => {
      for (const server of Object.values(servers)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { defect: { type: "string" }, clean: { type: "string" }, third: { type: "string" }, log: { type: "string" }, "session-seconds": { type: "string" } } });
  const port = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value));
  const ports: Partial<Record<SiteKey, number>> = {};
  if (port(values.defect) !== undefined) ports.defect = port(values.defect)!;
  if (port(values.clean) !== undefined) ports.clean = port(values.clean)!;
  if (port(values.third) !== undefined) ports.thirdParty = port(values.third)!;
  const fixture = await startFixture({ ports, ...(values.log ? { logFile: values.log } : {}), ...(values["session-seconds"] ? { sessionSeconds: Number(values["session-seconds"]) } : {}) });
  process.stdout.write(`Lindewaard  ${fixture.origins.defect}\nBerkenveen  ${fixture.origins.clean}\nKijkpunt    ${fixture.origins.thirdParty}\nlog         ${fixture.logFile}\n`);
  process.on("SIGINT", () => void fixture.close().then(() => process.exit(0)));
}
