import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Frame, Page, Request } from "playwright";
import { answeredByCloudflare, bodyOf, fulfillAnswer, opensNoConnection, passOn, proceed, sendOrReplay } from "../browser/session.ts";
import { LOCAL_ONLY_ENV, REFUSED_HEADER, REFUSED_STATUS, requireBoundary, shieldedFetch, shieldOf } from "../browser/boundary.ts";
import { REFUSED_ANSWER } from "../browser/onward.ts";
import { readJson } from "../lib/canonical.ts";
import { ownRegistration, readMailboxState } from "../lib/mailbox.ts";
import { maskFile, shieldForRun } from "../lib/secrets.ts";
import { isChallenge } from "../lib/challenge.ts";
import { privateFromPublicSite, scopeHost, scopeHostOf, siteOrigins, WEB_SCHEMES } from "../lib/origins.ts";
import { loginCookieHeader, logsOut } from "../lib/login.ts";
import { onReadOrigin, pathOf, readDecision, readRuleFor, type ReadRequest } from "../lib/reads.ts";
import { searchServicesOf, type SearchServiceId } from "../lib/searchbody.ts";
import { SEARCH_FALLBACK, SEARCH_NONE } from "../lib/searchterm.ts";
import { searchTermForRun } from "../lib/sitemodel.ts";
import { OriginBlocked, refusalNl, type Blockade } from "./blockade.ts";
import { playRecording, replayNl, socketRecordings, type PassedReplay, type Recorder } from "../lib/recordings.ts";
import { claimLink, isLocalHost, isThisMachine, isWriteOrigin, runWrites, SocketFrames, writeAccess, writesForRun, type PassedWrite, type WriteAccess } from "../lib/writes.ts";

/** Limits of the process that holds the browser; set once, when it starts. */
export interface DaemonLimits {
  /** Sessions that may be open at the same time. */
  maxSessions: number;
  /** Shortest time between two navigations to the same host, across all sessions. */
  navigationDelayMs: number;
  /** Longest a single command may take before the page is discarded. */
  commandTimeoutMs: number;
  /** The process stops by itself after this long without a command. */
  idleTimeoutMs: number;
  /** Whether methods may start WebKit and Firefox next to Chromium. Each second browser loads the pages of the site once more. */
  secondBrowsers: boolean;
}

/** Budget of one session. */
export interface SessionLimits {
  maxCommands: number;
  maxMinutes: number;
}

// The workflow next to the audit skill starts one agent fewer at a time than `maxSessions`: the last place is the session of whoever leads the audit. A test holds the two together.
export const DEFAULT_DAEMON_LIMITS: DaemonLimits = { maxSessions: 4, navigationDelayMs: 1000, commandTimeoutMs: 90_000, idleTimeoutMs: 30 * 60_000, secondBrowsers: true };
export const DEFAULT_SESSION_LIMITS: SessionLimits = { maxCommands: 300, maxMinutes: 45 };

export interface Scope {
  /** Hosts a session may navigate to and send requests to. */
  hosts: string[];
  /** Start URL of the run; relative page addresses are resolved against it. */
  baseUrl: string | null;
  /** The run, when there is one: a run with secrets has a boundary around every context. */
  runDir?: string;
  /**
   * When false, stylesheets, scripts, images, fonts and media may still be fetched from other
   * hosts, as in the sweep: without them the page is not the page a visitor sees. When true, nothing leaves the scope.
   */
  strict: boolean;
  /**
   * The origins of a test environment that may be written to, when the run was given
   * that at inventory. Absent or null: every write is refused, as on any live site.
   */
  writes?: WriteAccess | null;
}

/**
 * The hosts in scope for a run, each with its port when that is not 80 or 443 (`scopeHost`):
 * the site itself and every host that the inventory recorded as a page, which includes the
 * frames it found embedded. A frame on this machine or a local network counts only when the
 * site runs there too; an older inventory may still list one.
 */
export async function scopeForRun(runDir: string, extra: { scopeUrl?: string | undefined; allowHosts?: string[]; strict?: boolean }): Promise<Scope> {
  const hosts = new Set<string>((extra.allowHosts ?? []).map(scopeHostOf));
  let baseUrl: string | null = null;
  const inventoryPath = join(runDir, "inventory.json");
  if (existsSync(inventoryPath)) {
    const inventory = await readJson<{ baseUrl: string; origin: string; origins?: string[]; pages: { url: string }[] }>(inventoryPath);
    baseUrl = inventory.baseUrl;
    const origins = siteOrigins(inventory);
    // Every origin of the site, also one where no page was found.
    for (const origin of origins) hosts.add(scopeHost(new URL(origin)));
    for (const page of inventory.pages) {
      const url = new URL(page.url);
      if (WEB_SCHEMES.includes(url.protocol) && !privateFromPublicSite(page.url, origins)) hosts.add(scopeHost(url));
    }
  }
  if (extra.scopeUrl) {
    const url = new URL(extra.scopeUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`--scope "${extra.scopeUrl}" is geen adres met http:// of https://`);
    baseUrl ??= extra.scopeUrl;
    hosts.add(scopeHost(url));
  }
  if (hosts.size === 0) throw new Error("geen inventory.json in de run en geen --scope <url> opgegeven: onbekend welke site in scope is");
  const permission = writesForRun(runDir);
  // Inside a command of the sweep the log names that command; a session names itself.
  const ambient = runWrites();
  const writes = permission ? (ambient?.origin === permission.origin ? ambient : writeAccess(runDir, permission, "session")) : null;
  return { hosts: [...hosts].sort(), baseUrl, runDir, strict: extra.strict ?? false, ...(writes ? { writes } : {}) };
}

/**
 * The scope as an agent reads it. With `LOEP_BOUNDARY_LOCAL_ONLY=1` the boundary refuses every request
 * that leaves this machine, so a host elsewhere is in the scope of the run but cannot be reached: it
 * stands apart with the reason, or an agent keeps trying it.
 */
export function printedScope(hosts: readonly string[]): { scope: string[]; outsideThisMachine?: { hosts: string[]; noteNl: string } } {
  const far = process.env[LOCAL_ONLY_ENV] === "1" ? hosts.filter((host) => !isLocalHost(new URL(`http://${host}`).hostname)) : [];
  if (far.length === 0) return { scope: [...hosts] };
  return {
    scope: hosts.filter((host) => !far.includes(host)),
    outsideThisMachine: { hosts: far, noteNl: "deze adressen horen bij de run, maar deze run blijft op deze machine en elk verzoek daarheen wordt geweigerd. Opnieuw proberen helpt niet: leg wat daar staat vast als `proef werkte niet:`" },
  };
}

export interface Blocked {
  at: string;
  kind: "method" | "scope" | "socket" | "left-scope" | "logout" | "blockade" | "boundary";
  method: string;
  url: string;
  resourceType: string;
  /** For a request with a body: the search services whose question the body has the form of. Absent when none. */
  search?: SearchServiceId[];
  /** Why a request that a read request covered, or a write to the test environment, was held back. */
  reasonNl?: string;
  /** A write to the test environment that the budget for sending held back: because it was used up, because the sender had used its share, or because the previous write was too recent. */
  writeBudget?: "out" | "share" | "spacing";
  /** A redirect that was held back: where the page ends then says nothing about the site. A window on a page that is held back is no such thing. */
  redirect?: true;
}

const SOCKET_REFUSED_NL = "WebKit opent een socket op deze machine buiten de grens om: de socket is niet verbonden, en wat erover zou komen, is in WebKit niet gemeten";

/** Resource types a page needs to look the way it does. Fetched with GET only, also from hosts outside the scope unless the scope is strict. */
const RENDERING_TYPES = new Set(["stylesheet", "script", "image", "font", "media"]);
/**
 * Requests a script makes to read data. From an embedded window in the scope, such as a video
 * player, they may go to a host outside the scope with GET, unless the scope is strict: a player
 * fetches its stream from its own servers, the way it does for any visitor.
 */
const READ_TYPES = new Set(["fetch", "xhr"]);
const MAX_URL = 300;
/** How a browser says that a navigation was stopped on purpose (by the page, by the guard, by a new navigation); that is no failure of the site. */
const STOPPED = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|NS_BINDING_ABORTED|NS_ERROR_ABORT|cancelled/i;

/** Whether a request comes from an embedded window whose address is in the scope. A request of a worker has no frame and does not count. */
function fromEmbeddedInScope(scope: Scope, request: Request): boolean {
  try {
    let frame: Frame | null = request.frame();
    if (frame.parentFrame() === null) return false;
    // A frame without an address of its own (about:blank, about:srcdoc) belongs to the page that made it.
    while (frame && frame.url().startsWith("about:")) frame = frame.parentFrame();
    return frame !== null && inScope(scope, frame.url());
  } catch {
    return false;
  }
}

export interface Guard {
  blocked: Blocked[];
  /** Requests for rendering resources, and reads of an embedded window in the scope, that went to a host outside the scope, per host. */
  outsideScopeLoaded: Record<string, number>;
  /** Writes that were let through to the test environment; absent until the first one. */
  passed?: PassedWrite[];
  /** Messages that were not sent but played from a recording of an earlier real send (see `socketRecordings`); absent until the first one. */
  replays?: (PassedReplay & { noteNl: string })[];
  /** Read requests of the site model that were let through, without their body; absent until the first one. */
  reads?: PassedRead[];
  /** Addresses of the sockets the page opened inside the scope: what the explorer compares to find the pattern of `sendsTo`. Absent until the first one. */
  sockets?: string[];
  /** Requests of Cloudflare's check whether the browser is a robot that were let through and would otherwise have been refused; absent until the first one. */
  challenges?: PassedChallenge[];
  /** True between two commands of the agent: what the page sends over a socket then, it sends by itself. Absent: an agent may be acting. */
  idle?: boolean;
  /** The session whose page this is, for its share of the budget for sending. Absent: the source the access to send was made for. */
  sender?: string;
}

export interface PassedChallenge {
  at: string;
  method: string;
  url: string;
}

export interface PassedRead {
  at: string;
  method: string;
  url: string;
  /** Id of the rule in the site model that let it through. */
  rule: string;
  /** The search service the body was recognised as. */
  service: SearchServiceId;
}

/** Whether an address is in the scope: http, https, ws or wss, on a host of the run with the same port. Any other scheme never is. */
export const inScope = (scope: Scope, url: string): boolean => {
  try {
    const parsed = new URL(url);
    return WEB_SCHEMES.includes(parsed.protocol) && scope.hosts.includes(scopeHost(parsed));
  } catch {
    return false;
  }
};

export const urlInScope = inScope;

/**
 * Everything a session page may not do, enforced where requests leave the browser: no
 * method other than GET or HEAD, nothing to a host outside the scope, and no message over
 * a WebSocket. Each refusal is recorded. One exception is the origin of a test environment
 * that the run was given at inventory: writes and socket messages to it pass, and each is
 * recorded too. The other is a read request of a checked site model: the method, origin and
 * path a rule covers (see `readMatches`), also on a host outside the scope, recorded as a read. Cloudflare's check
 * whether the browser is a robot passes as well, because Cloudflare answers it and the site never
 * gets it (see `isChallenge`); what would otherwise have been refused is recorded. An origin of
 * the site that blocked the run (see `Blockade`) is asked nothing at all; what the site answers
 * and which navigations fail is told to the blockade. Registered after the context's own routes,
 * so it decides first.
 */
export async function guardContext(context: BrowserContext, scope: Scope, guard: Guard, reads: readonly ReadRequest[] = [], blockade?: Blockade): Promise<void> {
  const runDir = runOf(scope);
  requireBoundary(context, runDir);
  const note = (kind: Blocked["kind"], method: string, url: string, resourceType: string): void => {
    guard.blocked.push({ at: new Date().toISOString(), kind, method, url: url.slice(0, MAX_URL), resourceType });
  };
  // What the boundary refused is no answer of the site: it stands in what the session reports, as anything the guard holds back.
  // Only with a boundary: elsewhere such a header comes from the site.
  if (runDir !== undefined && shieldForRun(runDir)) {
    context.on("response", (response) => {
      if (response.status() !== REFUSED_STATUS) return;
      const reason = response.headers()[REFUSED_HEADER];
      if (!reason) return;
      const request = response.request();
      let reasonNl: string;
      try {
        reasonNl = decodeURIComponent(reason);
      } catch {
        return;
      }
      guard.blocked.push({ at: new Date().toISOString(), kind: "boundary", method: request.method(), url: request.url().slice(0, MAX_URL), resourceType: request.resourceType(), reasonNl });
    });
  }
  if (blockade) {
    context.on("response", (response) => {
      const url = response.url();
      if (!inScope(scope, url)) return;
      const status = response.status();
      if (status === 429) return blockade.tooMany(url, response.headers()["retry-after"]);
      // A refused navigation is answered here with "no content": that is not the site.
      if (response.request().isNavigationRequest() && response.request().method() === "GET" && status >= 200 && status < 400 && status !== 204) blockade.loaded(url);
    });
    context.on("requestfailed", (request) => {
      if (request.isNavigationRequest() && inScope(scope, request.url()) && !STOPPED.test(request.failure()?.errorText ?? "")) blockade.failed(request.url());
    });
  }
  // A personal link from a mail can say `afmelden`, and then it is about the mail and not about the session.
  const loggingOut = (url: string): boolean => logsOut(url) && !(runDir !== undefined && shieldForRun(runDir)?.touchesGuarded(url));
  await context.route("**/*", (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    const type = request.resourceType();
    // An aborted navigation replaces the page with an error page. "No content" leaves the page as it was.
    const refuse = (): Promise<void> => (request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient"));
    const refusedBy = blockade?.refuses(url);
    if (refusedBy) {
      guard.blocked.push({ at: new Date().toISOString(), kind: "blockade", method, url: url.slice(0, MAX_URL), resourceType: type, reasonNl: refusalNl(refusedBy) });
      return refuse();
    }
    // In a run with a login nothing logs out: the session has to last for everything that comes after.
    if (loggingOut(url)) {
      note("logout", method, url, type);
      return refuse();
    }
    // Cloudflare's own host lies outside every scope: a strict scope keeps it out.
    if (isChallenge(url, (host) => answeredByCloudflare(context, host)) && (inScope(scope, url) || !scope.strict)) {
      if ((method !== "GET" && method !== "HEAD") || !inScope(scope, url)) (guard.challenges ??= []).push({ at: new Date().toISOString(), method, url: url.slice(0, MAX_URL) });
      return proceed(route, context, (target) => inScope(scope, target));
    }
    if (method !== "GET" && method !== "HEAD") {
      const body = bodyOf(request);
      const read = readDecision(reads, method, url, request.headers(), body);
      if (read?.pass) {
        (guard.reads ??= []).push({ at: new Date().toISOString(), method, url: url.slice(0, MAX_URL), rule: read.rule.id, service: read.rule.service });
        // Repeated only to an address a rule of the same service covers; otherwise followed only inside the scope or on an origin the rule covers.
        return passOn(route, context, (target) => readRuleFor(reads, method, target)?.service === read.rule.service, (target) => inScope(scope, target) || onReadOrigin(read.rule, target)).then(() => undefined);
      }
      if (read) {
        guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, reasonNl: read.reasonNl });
        return refuse();
      }
      if (isWriteOrigin(scope.writes, url)) {
        // Every write takes one from the budget of the whole run; when it is used up, or the previous one was too recent, the write is held back as without permission.
        // The same request as one sent before is answered from its recording. Where the server sends the browser next is not asked here again: it has to be inside the scope.
        return sendOrReplay(context, route, scope.writes!, { sender: guard.sender, mayFollow: (target) => inScope(scope, target) }).then((outcome) => {
          if (outcome.kind === "refused") guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, reasonNl: outcome.reasonNl, writeBudget: outcome.budget });
          else if (outcome.kind === "replayed") (guard.replays ??= []).push({ ...outcome.replay, noteNl: outcome.noteNl });
          else (guard.passed ??= []).push(outcome.entry, ...(outcome.repeated ? [outcome.repeated] : []));
        });
      }
      // Whether the body has the form of a search: what the explorer needs to record a read request, never the body itself.
      const search = method === "POST" ? searchServicesOf(body, pathOf(url)) : [];
      guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, ...(search.length > 0 ? { search } : {}) });
      return refuse();
    }
    if (inScope(scope, url)) {
      if (linkRefused(scope, guard, request)) return refuse();
      return proceed(route, context, (target) => inScope(scope, target));
    }
    // What the page already holds (data:, blob:) sends nothing anywhere; as the address of a page it is never in the scope.
    if (!request.isNavigationRequest() && /^(data|blob):/.test(url)) return route.continue();
    if (!scope.strict && !request.isNavigationRequest() && (RENDERING_TYPES.has(type) || (READ_TYPES.has(type) && fromEmbeddedInScope(scope, request)))) {
      const host = new URL(url).hostname;
      guard.outsideScopeLoaded[host] = (guard.outsideScopeLoaded[host] ?? 0) + 1;
      return proceed(route, context, (target) => inScope(scope, target));
    }
    note("scope", method, url, type);
    return refuse();
  });
  await context.routeWebSocket(/.*/, (socket) => {
    const url = socket.url();
    const refusedBy = blockade?.refuses(url);
    // The socket opens, so the page keeps working, and what the server says still arrives. Nothing the page says is passed on.
    // A socket opens a connection of its own, and on this machine WebKit does that past the proxy.
    const allowed = inScope(scope, url) && !refusedBy;
    const pastTheProxy = allowed && opensNoConnection(context) && isThisMachine(new URL(url).hostname);
    const server = allowed && !pastTheProxy ? socket.connectToServer() : null;
    if (pastTheProxy) guard.blocked.push({ at: new Date().toISOString(), kind: "boundary", method: "GET", url: url.slice(0, MAX_URL), resourceType: "websocket", reasonNl: SOCKET_REFUSED_NL });
    else if (refusedBy) guard.blocked.push({ at: new Date().toISOString(), kind: "blockade", method: "GET", url: url.slice(0, MAX_URL), resourceType: "websocket", reasonNl: refusalNl(refusedBy) });
    else if (!server) note("scope", "GET", url, "websocket");
    else (guard.sockets ??= []).push(url.slice(0, MAX_URL));
    // Only a socket of the test environment may carry what the page says.
    const free = server !== null && isWriteOrigin(scope.writes, url);
    const frames = new SocketFrames(MESSAGE_VALUES);
    const opened = Date.now();
    // On the socket of the test environment the answer to a real message is recorded, and a message that was sent before is played from its recording.
    const recordings = free ? socketRecordings(scope.writes!.runDir, scope.writes!.source, MESSAGE_VALUES) : null;
    let recorder: Recorder | null = null;
    // A page that is closed hears nothing more: what the server says after that is no part of the answer the page got.
    context.once("close", () => recorder?.end());
    if (free) {
      server!.onMessage((reply) => {
        socket.send(reply);
        recorder?.frame(reply);
      });
      // A handler for closing takes over passing it on: the server is closed as the page closed its side.
      socket.onClose((code, reason) => {
        recorder?.end();
        void server!.close({ code, reason }).catch(() => undefined);
      });
    }
    socket.onMessage((message) => {
      if (!free) return note("socket", "SEND", url, "websocket");
      const counted = frames.counts(message, guard.idle);
      // What a page sends right after it connects has to arrive; a later frame is something an agent did.
      const anyFrame = Date.now() - opened >= GREETING_MS;
      if (counted) {
        const recording = recordings!.find(url, message, anyFrame);
        if (recording) {
          const replayed = recordings!.replayed(url, recording, guard.sender);
          (guard.replays ??= []).push({ ...replayed, noteNl: replayNl(recording, replayed.matchedOn) });
          return playRecording(recording, (reply) => socket.send(reply));
        }
      }
      // Every frame takes one from the budget, unless it is shown to be a heartbeat or a message of the protocol: that passes and is only noted.
      const claim = counted ? scope.writes!.claim("SEND", url, { message: true, sender: guard.sender }) : { ok: true as const, entry: scope.writes!.record("SEND", url, { sender: guard.sender }) };
      if (!claim.ok) {
        guard.blocked.push({ at: new Date().toISOString(), kind: "socket", method: "SEND", url: url.slice(0, MAX_URL), resourceType: "websocket", reasonNl: claim.reasonNl, writeBudget: claim.budget });
        return;
      }
      (guard.passed ??= []).push(claim.entry);
      server!.send(message);
      // Only a message with a test value starts a recording, and ends the one before it.
      const next = counted ? recordings!.start(url, message, guard.sender, anyFrame) : null;
      if (next) {
        recorder?.end();
        recorder = next;
      }
    });
  });
}

export type Download =
  | { ok: true; url: string; bytes: number; contentType: string | null; /** Why the file is not whole, when it is not. */ truncated: "size" | "time" | null }
  | { ok: false; reason: string };

const MAX_REDIRECTS = 5;

/**
 * Fetch a file for a measurement that is done outside the browser, under the rules a page of
 * the session is held to: only GET, only over http, and only inside the scope. A file of a
 * kind a page needs to look and sound the way it does may come from another host unless the
 * scope is strict, exactly as the browser was allowed to load it; `resourceType` says which
 * kind, in the words of the browser. Every hop of a redirect is asked again. What is refused
 * is recorded with the refusals of the page, what comes from outside the scope is counted with
 * the rest. An origin the blockade of the run refuses is not asked, as the browser of a session
 * does not ask it, and a 429 inside the scope is told to it; every caller says which blockade
 * holds, or that none does. Stops at `maxBytes` or when the time is up and says so.
 */
export async function guardedDownload(scope: Scope, guard: Guard, address: string, to: string, options: { resourceType: string; maxBytes: number; timeoutMs: number; headers?: (url: string) => Promise<Record<string, string>>; blockade: Blockade | undefined }): Promise<Download> {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, options.timeoutMs);
  try {
    let url = address;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, reason: "het adres is geen geldig adres" };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: `het adres begint met ${parsed.protocol} en is niet op te halen` };
      // The real value of an alias is only filled in on the way out of the browser: from here the site would show another page.
      if (shieldOf(runOf(scope), url)?.carriesAlias(url)) return { ok: false, reason: "dit adres heeft een vervanging voor een geheim erin en is alleen in de browser van de sessie te openen" };
      if (!inScope(scope, url)) {
        if (scope.strict || !RENDERING_TYPES.has(options.resourceType)) {
          guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: url.slice(0, MAX_URL), resourceType: options.resourceType });
          return { ok: false, reason: `${parsed.hostname} ligt buiten de scope van de run` };
        }
        guard.outsideScopeLoaded[parsed.hostname] = (guard.outsideScopeLoaded[parsed.hostname] ?? 0) + 1;
      }
      // A blocked origin is not asked; a caller that can wait out a short pause does so before.
      const refusedBy = options.blockade?.refuses(url);
      if (refusedBy) {
        const reasonNl = new OriginBlocked(url, refusedBy).message;
        guard.blocked.push({ at: new Date().toISOString(), kind: "blockade", method: "GET", url: url.slice(0, MAX_URL), resourceType: options.resourceType, reasonNl });
        return { ok: false, reason: reasonNl };
      }
      // A file behind a login is asked for with the session of the run, and only inside the scope.
      const cookie = inScope(scope, url) ? loginCookieHeader(url) : null;
      // In a run with secrets the answer gets the aliases too: this file goes in the run.
      const response = await shieldedFetch(shieldOf(runOf(scope), url), url, { method: "GET", redirect: "manual", signal: abort.signal, headers: { ...(cookie ? { cookie } : {}), ...((await options.headers?.(url)) ?? {}) } }, { maxBytes: options.maxBytes, runDir: runOf(scope) });
      if (response.status === 429 && inScope(scope, url)) options.blockade?.tooMany(url, response.headers.get("retry-after") ?? undefined);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: `de server antwoordt met ${response.status}` };
      }
      const file = createWriteStream(to);
      let bytes = 0;
      let truncated: "size" | "time" | null = null;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          const room = options.maxBytes - bytes;
          const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
          bytes += part.length;
          if (!file.write(part)) await new Promise<void>((resolve) => file.once("drain", () => resolve()));
          if (bytes >= options.maxBytes) {
            truncated = "size";
            abort.abort();
            break;
          }
        }
      } catch (error) {
        // What arrived before the time was up is kept; anything else that breaks off is no answer.
        if (!timedOut && truncated === null) throw error;
        truncated ??= "time";
      } finally {
        await new Promise<void>((resolve) => file.end(resolve));
      }
      // In a run with secrets the answer was read before this point: the time can have run out there, and this is what arrived.
      if (timedOut) truncated ??= "time";
      if (bytes === 0) return { ok: false, reason: timedOut ? "geen antwoord binnen de tijd" : "de server stuurt een leeg bestand" };
      maskFile(to, response.headers.get("content-type") ?? undefined);
      return { ok: true, url, bytes, contentType: response.headers.get("content-type"), truncated };
    }
    return { ok: false, reason: "te veel doorverwijzingen" };
  } catch (error) {
    return { ok: false, reason: timedOut ? "geen antwoord binnen de tijd" : `ophalen mislukt: ${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

const runOf = (scope: Scope): string | undefined => scope.runDir ?? scope.writes?.runDir;

/**
 * A navigation to a guarded address takes from the budget like any write, and a session that may
 * not send may not open one at all: whether it is refused, and noted as refused. Asked once per
 * navigation, by the guard that passes it on.
 */
function linkRefused(scope: Scope, guard: Guard, request: Request): boolean {
  const url = request.url();
  const shield = request.isNavigationRequest() ? shieldOf(runOf(scope), url) : null;
  if (!shield) return false;
  if (!scope.writes) {
    if (!shield.touchesGuarded(url)) return false;
    guard.blocked.push({ at: new Date().toISOString(), kind: "method", method: request.method(), url: url.slice(0, MAX_URL), resourceType: request.resourceType(), reasonNl: "deze sessie mag niet versturen, en een persoonlijke link openen telt als versturen" });
    return true;
  }
  const link = shield.guardedId(url);
  const refused = link ? claimLink(scope.writes, url, link, guard.sender) : null;
  if (refused) guard.blocked.push({ at: new Date().toISOString(), kind: "method", method: request.method(), url: url.slice(0, MAX_URL), resourceType: request.resourceType(), reasonNl: refused.reasonNl, writeBudget: refused.budget });
  return refused !== null;
}

/**
 * A redirect is followed inside the browser without passing the route handler again. Watch
 * the answers to document requests and stop a redirect that leads out of the scope before it is followed.
 */
export async function guardRedirects(page: Page, scope: Scope, guard: Guard): Promise<void> {
  const enable = (cdp: CDPSession): Promise<unknown> => cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
  const watch = async (cdp: CDPSession): Promise<void> => {
    cdp.on("Fetch.requestPaused", (event) => {
      const location = event.responseHeaders?.find((header) => header.name.toLowerCase() === "location")?.value;
      const status = event.responseStatusCode ?? 0;
      let leaves = false;
      if (status >= 300 && status < 400 && location) {
        const target = new URL(location, event.request.url).href;
        leaves = !inScope(scope, target);
        if (leaves) guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: `${target.slice(0, MAX_URL)} (doorverwijzing vanaf ${event.request.url.slice(0, 120)})`, resourceType: "document", redirect: true });
      }
      const done = leaves ? cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }) : cdp.send("Fetch.continueRequest", { requestId: event.requestId });
      done.catch(() => undefined);
    });
    await enable(cdp);
  };
  await watch(await page.context().newCDPSession(page));
  // An embedded frame that the browser runs in a process of its own answers on a session of its own; the session of the page does not see what such a frame asks for.
  const own = new Map<Frame, CDPSession>();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) return;
    void (async () => {
      const known = own.get(frame);
      if (known && (await enable(known).then(() => true, () => false))) return;
      own.delete(frame);
      const cdp = await page.context().newCDPSession(frame).catch(() => null);
      if (!cdp) return;
      own.set(frame, cdp);
      await watch(cdp).catch(() => undefined);
    })();
  });
}

/**
 * The same watch on redirects for a browser that has no protocol session to pause a response
 * in: WebKit and Firefox. A document request is fetched without following redirects; a
 * redirect that leads out of the scope is refused, any other answer is handed to the browser
 * as it came. Registered after `guardContext`, so it sees a request first and leaves
 * everything that is not a plain navigation inside the scope to that guard.
 */
export async function guardRedirectsByRoute(context: BrowserContext, scope: Scope, guard: Guard): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.method() !== "GET" || !/^https?:/.test(request.url()) || !inScope(scope, request.url()) || logsOut(request.url())) return route.fallback();
    if (linkRefused(scope, guard, request)) return route.fulfill(REFUSED_ANSWER);
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers()["location"];
      if (response.status() >= 300 && response.status() < 400 && location) {
        const target = new URL(location, request.url()).href;
        if (!inScope(scope, target)) {
          guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: `${target.slice(0, MAX_URL)} (doorverwijzing vanaf ${request.url().slice(0, 120)})`, resourceType: "document", redirect: true });
          return await route.fulfill(REFUSED_ANSWER);
        }
      }
      return await fulfillAnswer(route, response, context, (target) => inScope(scope, target));
    } catch {
      // The page went away while the answer was on its way; there is nobody left to answer.
      return route.abort("failed").catch(() => undefined);
    }
  });
}

/** What a person who receives a message from a run reads first: that it is a test by loep and needs no answer. */
const RECOGNIZABLE = "Testbericht van loep (toegankelijkheidsonderzoek), niet beantwoorden";

/**
 * Test values a session may enter in a field. There is no free text: nothing an agent makes up reaches a page.
 * Whatever can reach a person says it comes from loep; example.com is reserved and receives no mail.
 * A search term goes to a machine, not to a person, and stays a plain word: `search` is the term
 * of the run (see `testValuesForRun`), `test` only where a run has none; `search-none` finds nothing.
 */
export const TEST_VALUES: Record<string, string> = {
  text: RECOGNIZABLE,
  name: "Loep Testpersoon",
  email: "loep-test@example.com",
  "invalid-email": "geen-emailadres",
  number: "12",
  phone: "0612345678",
  postcode: "1234 AB",
  date: "2000-01-31",
  url: "https://example.com/",
  search: SEARCH_FALLBACK,
  "search-none": SEARCH_NONE,
  long: `${RECOGNIZABLE}. Dit is een lange testwaarde om te zien wat er gebeurt als een veld meer tekst krijgt dan het breed is, zonder dat de tekst iets betekent.`,
  empty: "",
};

/**
 * The test values of a run: `search` is the term the inventory chose, or the one the explorer showed on
 * a page of the site. In a session with a registration of its own, `email` is the address of that registration.
 */
export function testValuesForRun(runDir: string, session?: string): Record<string, string> {
  const own = ownRegistration(readMailboxState(runDir) ?? { registrations: [] }, session)?.alias;
  return { ...TEST_VALUES, search: searchTermForRun(runDir), ...(own ? { email: own } : {}) };
}

/**
 * The test values that mark a frame over a socket as a message an agent sent (see `isOurMessage`), whatever else is in it.
 * Left out: the search terms (`search`, `search-none`), which make a search and no message, and the
 * empty value and anything shorter than four characters, which also occur in frames that nobody typed.
 */
/** A frame this soon after a socket opened is the greeting of the page: it is never played from a recording. */
export const GREETING_MS = 2000;

export const MESSAGE_VALUES: readonly string[] = Object.entries(TEST_VALUES)
  .filter(([kind, value]) => kind !== "search" && kind !== "search-none" && value.trim().length >= 4)
  .map(([, value]) => value);

/** Keys a session may press: navigation and activation keys, and single characters to try key shortcuts. */
export const KEY_PATTERN = /^(?:(?:Shift|Control|Alt|Meta)\+)*(?:Enter|Space|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|F[1-9]|F1[0-2]|[a-z0-9/?.,=-])$/;

/** Spaces navigations to the same host, for every session in the process together. */
export class Politeness {
  private readonly last = new Map<string, number>();
  private readonly delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  /** Wait until the host may be navigated to again, and claim the slot. */
  async before(url: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    const wait = (this.last.get(host) ?? 0) + this.delayMs - Date.now();
    this.last.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  /** A navigation happened that nobody announced, such as a click on a link. */
  seen(url: string): void {
    try {
      const host = new URL(url).hostname;
      this.last.set(host, Math.max(this.last.get(host) ?? 0, Date.now()));
    } catch {
      // Not a URL with a host (about:blank); nothing to space out.
    }
  }

  /** Time still to wait before an action on a page of this host that may navigate. */
  remaining(url: string): number {
    try {
      return Math.max(0, (this.last.get(new URL(url).hostname) ?? 0) + this.delayMs - Date.now());
    } catch {
      return 0;
    }
  }
}
