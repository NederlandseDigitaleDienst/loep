import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Frame, Page, Request } from "playwright";
import { answeredByCloudflare, bodyOf, passOn, passWrite } from "../browser/session.ts";
import { readJson } from "../lib/canonical.ts";
import { isChallenge } from "../lib/challenge.ts";
import { siteOrigins } from "../lib/origins.ts";
import { loginCookieHeader, logsOut } from "../lib/login.ts";
import { readDecision, readRuleFor, type ReadRequest } from "../lib/reads.ts";
import { searchServicesOf, type SearchServiceId } from "../lib/searchbody.ts";
import { isOurMessage, isWriteOrigin, runWrites, writeAccess, writesForRun, type PassedWrite, type WriteAccess } from "../lib/writes.ts";

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
  /**
   * When false, stylesheets, scripts, images, fonts and media may still be fetched from other
   * hosts, as in the sweep: without them the page is not the page a visitor sees. When true, nothing leaves the scope.
   */
  strict: boolean;
  /**
   * The one origin of a test environment that may be written to, when the run was given
   * that at inventory. Absent or null: every write is refused, as on any live site.
   */
  writes?: WriteAccess | null;
}

/**
 * The hosts in scope for a run: the site itself and every host that the inventory recorded
 * as a page, which includes the frames it found embedded.
 */
export async function scopeForRun(runDir: string, extra: { scopeUrl?: string | undefined; allowHosts?: string[]; strict?: boolean }): Promise<Scope> {
  const hosts = new Set<string>(extra.allowHosts ?? []);
  let baseUrl: string | null = null;
  const inventoryPath = join(runDir, "inventory.json");
  if (existsSync(inventoryPath)) {
    const inventory = await readJson<{ baseUrl: string; origin: string; origins?: string[]; pages: { url: string }[] }>(inventoryPath);
    baseUrl = inventory.baseUrl;
    // Every origin of the site, also one where no page was found.
    for (const origin of siteOrigins(inventory)) hosts.add(new URL(origin).hostname);
    for (const page of inventory.pages) hosts.add(new URL(page.url).hostname);
  }
  if (extra.scopeUrl) {
    baseUrl ??= extra.scopeUrl;
    hosts.add(new URL(extra.scopeUrl).hostname);
  }
  if (hosts.size === 0) throw new Error("geen inventory.json in de run en geen --scope <url> opgegeven: onbekend welke site in scope is");
  const permission = writesForRun(runDir);
  // Inside a command of the sweep the log names that command; a session names itself.
  const ambient = runWrites();
  const writes = permission ? (ambient?.origin === permission.origin ? ambient : writeAccess(runDir, permission, "session")) : null;
  return { hosts: [...hosts].sort(), baseUrl, strict: extra.strict ?? false, ...(writes ? { writes } : {}) };
}

export interface Blocked {
  at: string;
  kind: "method" | "scope" | "socket" | "left-scope" | "logout";
  method: string;
  url: string;
  resourceType: string;
  /** For a request with a body: the search services whose question the body has the form of. Absent when none. */
  search?: SearchServiceId[];
  /** Why a request that a read request covered, or a write to the test environment, was held back. */
  reasonNl?: string;
  /** A write to the test environment that the budget for sending held back: because it was used up, or because the previous write was too recent. */
  writeBudget?: "out" | "spacing";
}

/** Resource types a page needs to look the way it does. Fetched with GET only, also from hosts outside the scope unless the scope is strict. */
const RENDERING_TYPES = new Set(["stylesheet", "script", "image", "font", "media"]);
/**
 * Requests a script makes to read data. From an embedded window in the scope, such as a video
 * player, they may go to a host outside the scope with GET, unless the scope is strict: a player
 * fetches its stream from its own servers, the way it does for any visitor.
 */
const READ_TYPES = new Set(["fetch", "xhr"]);
const MAX_URL = 300;

/** Whether a request comes from an embedded window whose address is in the scope. A request of a worker has no frame and does not count. */
function fromEmbeddedInScope(scope: Scope, request: Request): boolean {
  try {
    const frame = request.frame();
    return frame.parentFrame() !== null && inScope(scope, frame.url());
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
  /** Read requests of the site model that were let through, without their body; absent until the first one. */
  reads?: PassedRead[];
  /** Requests of Cloudflare's check whether the browser is a robot that were let through and would otherwise have been refused; absent until the first one. */
  challenges?: PassedChallenge[];
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

const inScope = (scope: Scope, url: string): boolean => {
  try {
    const parsed = new URL(url);
    return !["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) || scope.hosts.includes(parsed.hostname);
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
 * recorded too. The other is a read request of a checked site model: exactly that method,
 * origin and path, also on a host outside the scope, recorded as a read. Cloudflare's check
 * whether the browser is a robot passes as well, because Cloudflare answers it and the site never
 * gets it (see `isChallenge`); what would otherwise have been refused is recorded. Registered
 * after the context's own routes, so it decides first.
 */
export async function guardContext(context: BrowserContext, scope: Scope, guard: Guard, reads: readonly ReadRequest[] = []): Promise<void> {
  const note = (kind: Blocked["kind"], method: string, url: string, resourceType: string): void => {
    guard.blocked.push({ at: new Date().toISOString(), kind, method, url: url.slice(0, MAX_URL), resourceType });
  };
  await context.route("**/*", (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    const type = request.resourceType();
    // An aborted navigation replaces the page with an error page. "No content" leaves the page as it was.
    const refuse = (): Promise<void> => (request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient"));
    // In a run with a login nothing logs out: the session has to last for everything that comes after.
    if (logsOut(url)) {
      note("logout", method, url, type);
      return refuse();
    }
    // Cloudflare's own host lies outside every scope: a strict scope keeps it out.
    if (isChallenge(url, (host) => answeredByCloudflare(context, host)) && (inScope(scope, url) || !scope.strict)) {
      if ((method !== "GET" && method !== "HEAD") || !inScope(scope, url)) (guard.challenges ??= []).push({ at: new Date().toISOString(), method, url: url.slice(0, MAX_URL) });
      return route.continue();
    }
    if (method !== "GET" && method !== "HEAD") {
      const body = bodyOf(request);
      const read = readDecision(reads, method, url, request.headers(), body);
      if (read?.pass) {
        (guard.reads ??= []).push({ at: new Date().toISOString(), method, url: url.slice(0, MAX_URL), rule: read.rule.id, service: read.rule.service });
        // Repeated only to an address a rule of the same service covers; otherwise followed only inside the scope or on the origin of the rule.
        return passOn(route, (target) => readRuleFor(reads, method, target)?.service === read.rule.service, (target) => inScope(scope, target) || target.startsWith(`${read.rule.origin}/`)).then(() => undefined);
      }
      if (read) {
        guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, reasonNl: read.reasonNl });
        return refuse();
      }
      if (isWriteOrigin(scope.writes, url)) {
        // Every write takes one from the budget of the whole run; when it is used up, or the previous one was too recent, the write is held back as without permission.
        const claim = scope.writes!.claim(method, url);
        if (!claim.ok) {
          guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, reasonNl: claim.reasonNl, writeBudget: claim.budget });
          return refuse();
        }
        (guard.passed ??= []).push(claim.entry);
        // Where the server sends the browser next is not asked here again: it has to be inside the scope.
        return passWrite(route, scope.writes!, (target) => inScope(scope, target)).then((repeated) => void (repeated && (guard.passed ??= []).push(scope.writes!.record(method, repeated, { repeat: true }))));
      }
      // Whether the body has the form of a search: what the explorer needs to record a read request, never the body itself.
      const search = method === "POST" ? searchServicesOf(body) : [];
      guard.blocked.push({ at: new Date().toISOString(), kind: "method", method, url: url.slice(0, MAX_URL), resourceType: type, ...(search.length > 0 ? { search } : {}) });
      return refuse();
    }
    if (inScope(scope, url)) return route.continue();
    if (!scope.strict && !request.isNavigationRequest() && (RENDERING_TYPES.has(type) || (READ_TYPES.has(type) && fromEmbeddedInScope(scope, request)))) {
      const host = new URL(url).hostname;
      guard.outsideScopeLoaded[host] = (guard.outsideScopeLoaded[host] ?? 0) + 1;
      return route.continue();
    }
    note("scope", method, url, type);
    return refuse();
  });
  await context.routeWebSocket(/.*/, (socket) => {
    const url = socket.url();
    // The socket opens, so the page keeps working, and what the server says still arrives. Nothing the page says is passed on.
    const server = inScope(scope, url) ? socket.connectToServer() : null;
    if (!server) note("scope", "GET", url, "websocket");
    // Only a socket of the test environment may carry what the page says.
    const free = server !== null && isWriteOrigin(scope.writes, url);
    socket.onMessage((message) => {
      if (!free) return note("socket", "SEND", url, "websocket");
      // A frame with a test value in it is a message an agent sent, and takes one from the budget; a heartbeat passes and is only noted.
      const claim = isOurMessage(message, MESSAGE_VALUES) ? scope.writes!.claim("SEND", url, { message: true }) : { ok: true as const, entry: scope.writes!.record("SEND", url) };
      if (!claim.ok) {
        guard.blocked.push({ at: new Date().toISOString(), kind: "socket", method: "SEND", url: url.slice(0, MAX_URL), resourceType: "websocket", reasonNl: claim.reasonNl, writeBudget: claim.budget });
        return;
      }
      (guard.passed ??= []).push(claim.entry);
      server!.send(message);
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
 * the rest. Stops at `maxBytes` or when the time is up and says so.
 */
export async function guardedDownload(scope: Scope, guard: Guard, address: string, to: string, options: { resourceType: string; maxBytes: number; timeoutMs: number; headers?: (url: string) => Promise<Record<string, string>> }): Promise<Download> {
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
      if (!inScope(scope, url)) {
        if (scope.strict || !RENDERING_TYPES.has(options.resourceType)) {
          guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: url.slice(0, MAX_URL), resourceType: options.resourceType });
          return { ok: false, reason: `${parsed.hostname} ligt buiten de scope van de run` };
        }
        guard.outsideScopeLoaded[parsed.hostname] = (guard.outsideScopeLoaded[parsed.hostname] ?? 0) + 1;
      }
      // A file behind a login is asked for with the session of the run, and only inside the scope.
      const cookie = inScope(scope, url) ? loginCookieHeader(url) : null;
      const response = await fetch(url, { method: "GET", redirect: "manual", signal: abort.signal, headers: { ...(cookie ? { cookie } : {}), ...((await options.headers?.(url)) ?? {}) } });
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
      if (bytes === 0) return { ok: false, reason: timedOut ? "geen antwoord binnen de tijd" : "de server stuurt een leeg bestand" };
      return { ok: true, url, bytes, contentType: response.headers.get("content-type"), truncated };
    }
    return { ok: false, reason: "te veel doorverwijzingen" };
  } catch (error) {
    return { ok: false, reason: timedOut ? "geen antwoord binnen de tijd" : `ophalen mislukt: ${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
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
        if (leaves) guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: `${target.slice(0, MAX_URL)} (doorverwijzing vanaf ${event.request.url.slice(0, 120)})`, resourceType: "document" });
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
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers()["location"];
      if (response.status() >= 300 && response.status() < 400 && location) {
        const target = new URL(location, request.url()).href;
        if (!inScope(scope, target)) {
          guard.blocked.push({ at: new Date().toISOString(), kind: "scope", method: "GET", url: `${target.slice(0, MAX_URL)} (doorverwijzing vanaf ${request.url().slice(0, 120)})`, resourceType: "document" });
          return await route.fulfill({ status: 204, body: "" });
        }
      }
      return await route.fulfill({ response });
    } catch {
      // The page went away while the answer was on its way; there is nobody left to answer.
      return route.abort("failed").catch(() => undefined);
    }
  });
}

/** Test values a session may enter in a field. There is no free text: nothing an agent makes up reaches a page. */
export const TEST_VALUES: Record<string, string> = {
  text: "Test",
  name: "Test Persoon",
  email: "test@example.com",
  "invalid-email": "geen-emailadres",
  number: "12",
  phone: "0612345678",
  postcode: "1234 AB",
  date: "2000-01-31",
  url: "https://example.com/",
  search: "test",
  long: "Dit is een lange testwaarde om te zien wat er gebeurt als een veld meer tekst krijgt dan het breed is, zonder dat de tekst iets betekent.",
  empty: "",
};

/**
 * The test values that mark a frame over a socket as a message an agent sent (see `isOurMessage`).
 * Left out: the empty value, the search term and anything shorter than four characters, which
 * also occur in frames that nobody typed.
 */
export const MESSAGE_VALUES: readonly string[] = Object.entries(TEST_VALUES)
  .filter(([kind, value]) => kind !== "search" && value.trim().length >= 4)
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
