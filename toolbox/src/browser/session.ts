import { fileURLToPath } from "node:url";
import { chromium, type APIResponse, type Browser, type BrowserContext, type Page, type Request, type Response, type Route } from "playwright";
import type { Crowd } from "../lib/atonce.ts";
import { CLOUDFLARE_HEADER, isChallenge } from "../lib/challenge.ts";
import { confirmLoginOn, LoginExpired, logsOut, runLoginMark, runLoginState, throwIfLoginExpired, watchLogin } from "../lib/login.ts";
import { addressOf, noteRefusedRead, readDecision, readRuleFor, runReads, type ReadRequest } from "../lib/reads.ts";
import { claimLink, isWriteOrigin, runWrites, SocketFrames, type PassedWrite, type WriteAccess } from "../lib/writes.ts";
import { LONGEST_FAILURE_PAUSE_SECONDS, OriginBlocked, runBlockade } from "../session/blockade.ts";
import { MESSAGE_VALUES } from "../session/safety.ts";
import { answerRefusalNl, httpRecordings, httpReplayNl, httpSendOf, keptHeaders, playRecording, socketRecordings, type HttpRecordings, type PassedReplay, type Recorder } from "../lib/recordings.ts";
import type { Shield } from "../lib/shield.ts";
import { readableFrame } from "./call.ts";
import { refusedByBrowser, type ClipboardWrite } from "./clipboard.ts";
import { frameAsPage } from "./frame.ts";
import { boundaryForContext, markInsideBoundary, shieldedFetch, shieldOf } from "./shielded.ts";

/** The read-only helper library that is injected into every page under test. */
export const INPAGE_PATH = fileURLToPath(new URL("./inpage.js", import.meta.url));

export type ColorScheme = "light" | "dark";

/**
 * Fixed rendering conditions. Anything that can change what a page looks like or
 * how a script behaves is pinned here and recorded in the manifest, so two runs
 * on the same commit see the same page.
 */
export const RENDERING = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: "nl-NL",
  timezoneId: "Europe/Amsterdam",
  reducedMotion: "reduce",
  navigationTimeoutMs: 45_000,
  settleTimeoutMs: 10_000,
} as const;

export interface ContextOptions {
  colorScheme?: ColorScheme;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  reducedMotion?: "reduce" | "no-preference";
  /**
   * The one origin that may be written to, on a declared test environment. Left out, the
   * permission of the run applies (see `setRunWrites`); null refuses every write whatever the run says.
   */
  writes?: WriteAccess | null;
  /** The read requests that may pass although they are a POST (see `ReadRequest`). Left out, those of the run apply (see `setRunReads`). */
  reads?: readonly ReadRequest[];
  /** Start with these cookies and stored values instead of the session of the run: the watch on the session keeps the copy it began with. */
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
  /** The run this context belongs to, when the process does not know it from `setRunWrites`: a session process. A run with a mailbox has its boundary around every context. */
  runDir?: string;
}

/**
 * Let a request through that may pass although it is not a GET: a write to the test environment,
 * or a read request of the site model. A redirect that would repeat it (307, 308) is only followed
 * to an address `mayRepeat` allows; any other redirect only where `mayFollow` allows. Returns the
 * address of a request the browser will repeat.
 */
export async function passOn(route: Route, mayRepeat: (url: string) => boolean, mayFollow: (url: string) => boolean = () => true): Promise<string | null> {
  return (await forward(route, mayRepeat, mayFollow)).repeated;
}

/** `passOn`, with the answer the browser was given: null when it was refused or nobody was left to answer. */
async function forward(route: Route, mayRepeat: (url: string) => boolean, mayFollow: (url: string) => boolean = () => true): Promise<{ repeated: string | null; response: APIResponse | null }> {
  const request = route.request();
  const refuse = (): Promise<void> => (request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient"));
  try {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()["location"];
    let repeated: string | null = null;
    if (response.status() >= 300 && response.status() < 400 && location) {
      const target = new URL(location, request.url()).href;
      const keepsMethod = response.status() === 307 || response.status() === 308;
      if (keepsMethod ? !mayRepeat(target) : !mayFollow(target)) {
        await refuse();
        return { repeated: null, response: null };
      }
      if (keepsMethod) repeated = target;
    }
    await route.fulfill({ response });
    return { repeated, response };
  } catch {
    // The page went away while the answer was on its way; there is nobody left to answer.
    await route.abort("failed").catch(() => undefined);
    return { repeated: null, response: null };
  }
}

/** WebKit refuses an answer with a redirect from a route. In a run with a mailbox the boundary does what the route is needed for there, so such a request is simply passed on. */
export const canFulfilRedirect = (context: BrowserContext): boolean => context.browser()?.browserType().name() !== "webkit";

export type WriteOutcome =
  | { kind: "sent"; entry: PassedWrite; repeated: PassedWrite | null }
  | { kind: "replayed"; replay: PassedReplay; noteNl: string }
  | { kind: "refused"; budget: "out" | "share" | "spacing"; reasonNl: string };

/**
 * A write to the test environment: answered from a recording when the same request was sent before
 * (see `httpRecordings`), and otherwise taken from the budget and sent, or refused when the budget says
 * no. The answer to a request with a test value in its body is recorded. Where the server sends the
 * browser next has to be allowed by `mayFollow`; a redirect that repeats the request (307, 308) only goes
 * to the test environment, and that repeat is noted, not counted again. `sender`: the session whose page it is.
 */
export async function sendOrReplay(context: BrowserContext, route: Route, writes: WriteAccess, options: { sender?: string | undefined; mayFollow?: (url: string) => boolean } = {}): Promise<WriteOutcome> {
  const request = route.request();
  const method = request.method();
  const url = request.url();
  const recordings = httpRecordings(writes.runDir, writes.source);
  const shield = shieldOf(writes, url);
  const body = bodyBufferOf(request);
  // A form with the address of the run in it makes the site send a mail: that has to happen for real.
  const send = shield?.mentionsAddress(body) ? null : httpSendOf(body, request.headers()["content-type"], MESSAGE_VALUES);
  const recording = send ? recordings.find(method, url, send) : null;
  if (recording) {
    // Answered here: nothing goes to the server, and no cookie of the recording is set.
    await route.fulfill({ status: recording.answer.status, headers: recording.answer.headers, body: Buffer.from(recording.answer.base64, "base64") }).catch(() => undefined);
    const replay = recordings.replayed(url, recording, options.sender);
    return { kind: "replayed", replay, noteNl: httpReplayNl(recording, replay.matchedOn) };
  }
  const claim = writes.claim(method, url, { sender: options.sender });
  if (!claim.ok) {
    await (request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient")).catch(() => undefined);
    return { kind: "refused", budget: claim.budget, reasonNl: claim.reasonNl };
  }
  if (shield && !canFulfilRedirect(context)) {
    await route.continue().catch(() => undefined);
    return { kind: "sent", entry: claim.entry, repeated: null };
  }
  // What the browser asks for after a redirect does not pass the route: where it lands is watched from before it gets the answer.
  const landing = send ? watchLanding(context, request) : null;
  const at = Date.now();
  const { repeated, response } = await forward(route, (target) => isWriteOrigin(writes, target), options.mayFollow);
  const repeatedEntry = repeated ? writes.record(method, repeated, { repeat: true, sender: options.sender }) : null;
  if (send && response && landing) void recordAnswer(recordings, { method, url, send, response, landing, origin: new URL(url).origin, sender: options.sender, at, shield }).catch(() => landing.cancel());
  else landing?.cancel();
  return { kind: "sent", entry: claim.entry, repeated: repeatedEntry };
}

/** A GET or HEAD of the sweep in a run with a mailbox: a personal link takes from the budget like any write. */
async function openShielded(route: Route, shield: Shield, writes: WriteAccess, spaced: NavigationSpacing | null): Promise<void> {
  const link = route.request().isNavigationRequest() ? shield.linkId(route.request().url()) : null;
  if (link && claimLink(writes, route.request().url(), link, undefined)) return void (await route.fulfill({ status: 204, body: "" }).catch(() => undefined));
  if (spaced && loadsTab(route)) await spaced.before(route.request().url());
  await route.continue().catch(() => undefined);
}

/** The body of a request as bytes, or null when it has none. */
function bodyBufferOf(request: Request): Buffer | null {
  try {
    return request.postDataBuffer();
  } catch {
    return null;
  }
}

/** How long the browser may take after a redirect to land on a page, for the answer to be recorded. */
const LANDING_MS = 15_000;

interface Landing {
  /** The requests the browser made after the answer, the last one for the page it landed on. */
  hops: Request[];
  response: Response;
  /** Its body, asked for as soon as it arrived: a page that is closed right after cannot be read any more. */
  body: Promise<Buffer | null>;
}

type LandingWatch = { landed: Promise<Landing | null>; cancel: () => void };

/** Wait for the page the browser lands on after the answer to `sent`: the first answer that is no redirect in the chain that began with it. Null when it does not land in time, or the context closes. */
function watchLanding(context: BrowserContext, sent: Request): LandingWatch {
  let resolve: (landing: Landing | null) => void = () => undefined;
  const landed = new Promise<Landing | null>((done) => (resolve = done));
  const onResponse = (response: Response): void => {
    const hops: Request[] = [];
    let at: Request | null = response.request();
    while (at && at !== sent) {
      hops.unshift(at);
      at = at.redirectedFrom();
    }
    if (at !== sent || hops.length === 0 || (response.status() >= 300 && response.status() < 400)) return;
    finish({ hops, response, body: response.body().catch(() => null) });
  };
  const onClose = (): void => finish(null);
  const timer = setTimeout(() => finish(null), LANDING_MS);
  timer.unref?.();
  function finish(landing: Landing | null): void {
    clearTimeout(timer);
    context.off("response", onResponse);
    context.off("close", onClose);
    resolve(landing);
  }
  context.on("response", onResponse);
  context.on("close", onClose);
  return { landed, cancel: () => finish(null) };
}

/**
 * Keep the answer to a request that was sent for real, with why it may not be played when that is so. After
 * a redirect the page the browser landed on is asked for once more, without any cookie: a page that then
 * looks different depends on the session (a message kept for the next page, a token per visit), and a replay,
 * which sets no cookie, would show another page. Such a recording is never played. A browser that did not
 * land in time leaves no recording: the next send is real.
 */
async function recordAnswer(recordings: HttpRecordings, sent: { method: string; url: string; send: { key: string; bodySha256: string }; response: APIResponse; landing: LandingWatch; origin: string; sender: string | undefined; at: number; shield: Shield | null }): Promise<void> {
  const { response, landing } = sent;
  const headers = response.headers();
  const body = await response.body();
  let refusedNl = answerRefusalNl({ status: response.status(), headers, body }, sent.url, sent.origin);
  let chain: { url: string; status: number }[] | undefined;
  if (response.status() >= 300 && response.status() < 400 && !refusedNl) {
    const landed = await landing.landed;
    if (!landed) return;
    chain = await Promise.all(landed.hops.map(async (hop) => ({ url: hop.url(), status: hop === landed.response.request() ? landed.response.status() : ((await hop.response().catch(() => null))?.status() ?? 0) })));
    refusedNl = await landingRefusalNl(landed, chain, sent.origin, sent.shield);
  } else landing.cancel();
  recordings.record({ method: sent.method, url: sent.url, send: sent.send, answer: { status: response.status(), headers: keptHeaders(headers), base64: body.toString("base64") }, ...(chain ? { chain } : {}), refusedNl, sender: sent.sender, at: sent.at });
}

/** Why the page after a redirect makes the recording unplayable, in Dutch, or null when it does not. */
async function landingRefusalNl(landed: Landing, chain: { url: string; status: number }[], origin: string, shield: Shield | null): Promise<string | null> {
  if (chain.some((hop) => new URL(hop.url).origin !== origin)) return "de doorverwijzing leidde buiten de testomgeving";
  const final = chain.at(-1)!;
  if (final.status < 200 || final.status >= 300) return `de pagina na de doorverwijzing antwoordde met ${final.status}`;
  const seen = await landed.body;
  if (!seen) return "de pagina na de doorverwijzing was niet te lezen";
  try {
    // Once more, without any cookie: the page a replay leads to has to be the same without the session.
    const fresh = await shieldedFetch(shield, final.url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const freshBody = Buffer.from(await fresh.arrayBuffer());
    if (fresh.status !== final.status || !freshBody.equals(seen)) return "de pagina na de doorverwijzing ziet er zonder de cookies van de browser anders uit: ze hangt af van de sessie, of van een kenmerk dat per keer verandert";
  } catch {
    return "niet na te gaan of de pagina na de doorverwijzing een sessie nodig heeft";
  }
  return null;
}

/** The body of a request as text, or null when it has none or it cannot be read as text. */
export function bodyOf(request: { postData(): string | null }): string | null {
  try {
    return request.postData();
  } catch {
    return null;
  }
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text"] });
}

/**
 * Stops the page from sending anything over a WebSocket while it is active. Requests
 * other than GET are always refused; a socket has to stay open for the page to work,
 * so it is only silenced around actions that could submit something.
 */
export interface WriteGuard {
  active: boolean;
  blocked: number;
}

/** Whether the contexts of this browser are given permission to fill the clipboard. */
export const hasClipboardPermission = (browser: Browser): boolean => browser.browserType().name() === "chromium";

/**
 * The sentence that a failure to copy may come from the test browser, or null when there is
 * no reason to say so. What the page wrote to the clipboard decides: a write the browser took
 * shows that the test browser was not in the way, and a write the browser refused always gets
 * the sentence. Without any write the words of the page are all there is: a message that
 * copying or the clipboard failed. Reading the clipboard is refused in every test browser,
 * filling it is allowed only where the browser has a permission for it, and a page without
 * https has no clipboard at all.
 */
export function clipboardNote(texts: string[], canWrite: boolean, writes: ClipboardWrite[] = []): string | null {
  if (writes.some((write) => write.ok === true)) return null;
  const about = /klembord|clipboard|kopi[eë]|\bcop(?:y|ied)\b|plak|\bpaste/i;
  const failed = /mislukt|niet gelukt|ging mis|niet mogelijk|kon niet|kan niet|geweigerd|fout|failed|unable|could not|cannot|denied|error/i;
  if (!writes.some(refusedByBrowser) && !texts.some((text) => about.test(text) && failed.test(text))) return null;
  return `de melding over kopiëren of het klembord kan aan de testbrowser liggen: ${canWrite ? "die mag het klembord vullen maar niet lezen, en op een pagina zonder https bestaat het klembord niet" : "deze browser kent geen toestemming voor het klembord"}. Schrijf dit er letterlijk bij en meld de mislukking niet als gebrek van de site`;
}

/** Something that spaces navigations to the same host: `Politeness` of the session process. */
export interface NavigationSpacing {
  before(url: string): Promise<void>;
}

let spacing: NavigationSpacing | null = null;

/**
 * Space every navigation of a top frame in every browser context of this process from here on, or
 * stop doing so with null. The sweep sets this while it measures pages at the same time: the site then
 * gets no more navigations per second than the sessions of the agents may give it.
 */
export function spaceNavigations(next: NavigationSpacing | null): void {
  spacing = next;
}

/** Whether a request loads the document of a tab, not of a frame inside it. */
const loadsTab = (route: Route): boolean => {
  try {
    return route.request().isNavigationRequest() && route.request().frame().parentFrame() === null;
  } catch {
    // A request without a frame, such as one of a worker: no navigation.
    return false;
  }
};

/** Per browser context: the hosts that answered through Cloudflare, so that only there a path of Cloudflare's own check passes. */
const cloudflareHosts = new WeakMap<BrowserContext, Set<string>>();

/** Whether a host answered through Cloudflare in this context. */
export const answeredByCloudflare = (context: BrowserContext, host: string): boolean => cloudflareHosts.get(context)?.has(host) ?? false;

export async function newContext(browser: Browser, options: ContextOptions = {}, guard?: WriteGuard): Promise<BrowserContext> {
  // A run with a login starts every context with the session a person left behind; any other run starts clean, as it did.
  const login = options.storageState ?? runLoginState();
  // Also a context that may not send has a boundary: what it gets from the site can hold the real values all the same.
  const boundary = await boundaryForContext(browser, options.runDir ?? (options.writes ?? runWrites())?.runDir);
  const context = await browser.newContext({
    ...boundary,
    ...(login ? { storageState: login } : {}),
    // The sites under test send a strict CSP; without this the engines cannot be injected.
    bypassCSP: true,
    viewport: options.viewport ?? RENDERING.viewport,
    deviceScaleFactor: options.deviceScaleFactor ?? RENDERING.deviceScaleFactor,
    locale: RENDERING.locale,
    timezoneId: RENDERING.timezoneId,
    reducedMotion: options.reducedMotion ?? RENDERING.reducedMotion,
    colorScheme: options.colorScheme ?? "light",
    serviceWorkers: "block",
  });
  if (boundary.proxy) markInsideBoundary(context);
  context.setDefaultNavigationTimeout(RENDERING.navigationTimeoutMs);
  const viaCloudflare = new Set<string>();
  cloudflareHosts.set(context, viaCloudflare);
  // The blockade of the run, in a command of the sweep: a site that refused the evaluation is asked nothing, and a 429 it gives ends the asking.
  const blockade = runBlockade();
  context.on("response", (response) => {
    if (blockade && response.status() === 429 && blockade.ofSite(response.url())) blockade.blockade.tooMany(response.url(), response.headers()["retry-after"]);
    try {
      if (response.headers()[CLOUDFLARE_HEADER]) viaCloudflare.add(new URL(response.url()).hostname);
    } catch {
      // A response without an address with a host, such as one for data: or blob:.
    }
  });
  // A copy button writes to the clipboard. A browser that was not given permission refuses, and the page then reports a
  // failure no visitor gets. Only Chromium knows this permission (in WebKit and Firefox asking for it is an error), and
  // only writing is allowed: what is on a clipboard is no business of a page under test.
  if (hasClipboardPermission(browser)) await context.grantPermissions(["clipboard-write"]);
  const writes = options.writes === undefined ? runWrites() : options.writes;
  const reads = options.reads ?? runReads();
  // An evaluation must never change the site under test: only safe requests pass. The
  // exceptions are the origin of a test environment that the run was given at inventory, and
  // the read requests of a checked site model: a question to a search service, by method, origin and path.
  await context.route("**/*", (route) => {
    const method = route.request().method();
    // Logging out ends the session for everything that comes after: such a request never leaves, whatever its method. Nor does one to an origin that refused the evaluation.
    if (logsOut(route.request().url()) || blockade?.blockade.refuses(route.request().url())) return route.request().isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient");
    if (method === "GET" || method === "HEAD") {
      const spaced = spacing;
      const shield = shieldOf(writes, route.request().url());
      if (shield) return openShielded(route, shield, writes!, spaced);
      if (spaced && loadsTab(route)) return spaced.before(route.request().url()).then(() => route.continue().catch(() => undefined));
      return route.continue();
    }
    // Cloudflare's check whether the browser is a robot is answered by Cloudflare and never reaches the site.
    if (isChallenge(route.request().url(), (host) => viaCloudflare.has(host))) return route.continue().catch(() => undefined);
    // A read request passes only when a rule covers it and its body is a question to the service of that rule; a covered request with another body is noted.
    const read = readDecision(reads, method, route.request().url(), route.request().headers(), bodyOf(route.request()));
    if (read?.pass) return passOn(route, (target) => readRuleFor(reads, method, target)?.service === read.rule.service).then(() => undefined);
    if (read) noteRefusedRead({ method, address: addressOf(route.request().url()), rule: read.rule.id, reasonNl: read.reasonNl });
    // An aborted navigation replaces the page with an error page. "No content" leaves the page as it was.
    if (!isWriteOrigin(writes, route.request().url())) return route.request().isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient");
    // The sweep shares the budget for sending with the sessions: a write past it, or too soon after the previous one, is held back. The same request as one sent before is answered from its recording.
    return sendOrReplay(context, route, writes!).then(() => undefined);
  });
  if (guard || writes) {
    await context.routeWebSocket(/.*/, (socket) => {
      const server = socket.connectToServer();
      const free = isWriteOrigin(writes, socket.url());
      const frames = new SocketFrames(MESSAGE_VALUES);
      // The answer to a real message is recorded, and a message that was sent before is played from its recording, as in a session.
      const recordings = free ? socketRecordings(writes!.runDir, writes!.source, MESSAGE_VALUES) : null;
      let recorder: Recorder | null = null;
      // A page that is closed hears nothing more: what the server says after that is no part of the answer the page got.
      context.once("close", () => recorder?.end());
      if (free) {
        server.onMessage((reply) => {
          socket.send(reply);
          recorder?.frame(reply);
        });
        // A handler for closing takes over passing it on: the server is closed as the page closed its side.
        socket.onClose((code, reason) => {
          recorder?.end();
          void server.close({ code, reason }).catch(() => undefined);
        });
      }
      socket.onMessage((message) => {
        if (free) {
          // A frame takes one from the budget of the run, and past it, or too soon, it is held back; only a heartbeat or a message of the protocol is just noted.
          // The sweep acts on the page all the time, so no frame counts as sent by the page by itself.
          if (frames.counts(message)) {
            const recording = recordings!.find(socket.url(), message);
            if (recording) {
              recordings!.replayed(socket.url(), recording);
              return playRecording(recording, (reply) => socket.send(reply));
            }
            if (!writes!.claim("SEND", socket.url(), { message: true }).ok) return void (guard?.active && guard.blocked++);
            server.send(message);
            // Only a message with a test value starts a recording, and ends the one before it.
            const next = recordings!.start(socket.url(), message);
            if (next) {
              recorder?.end();
              recorder = next;
            }
            return;
          }
          writes!.record("SEND", socket.url());
          server.send(message);
        } else if (guard?.active) guard.blocked++;
        else server.send(message);
      });
    });
  }
  return context;
}

export interface LoadResult {
  status: number | null;
  finalUrl: string;
  contentType: string | null;
}

/**
 * Navigate and wait until the page has stopped changing: network idle, fonts and custom elements ready.
 * `referer` is the page that embeds the address, when an embedded window is opened on its own: a
 * visitor's browser names that page when it loads the window, and a player that may only play on
 * the site refuses without it.
 */
export async function loadPage(page: Page, url: string, referer?: string): Promise<LoadResult> {
  // A session that ran out is not tried again page after page.
  throwIfLoginExpired();
  const options = { waitUntil: "load" as const, ...(referer ? { referer } : {}) };
  // A site that asked for a pause gets it, also one after failures: the sweep has no agent waiting on it. One that refused the evaluation is not asked, and the page is not measured.
  const blockade = runBlockade()?.blockade;
  const refused = await blockade?.pause(url, LONGEST_FAILURE_PAUSE_SECONDS);
  if (refused) throw new OriginBlocked(url, refused);
  let response = await page.goto(url, options);
  if (blockade && response?.status() === 429) {
    const again = await blockade.pause(url);
    if (again) throw new OriginBlocked(url, again);
    response = await page.goto(url, options);
  }
  await settlePage(page);
  // In a run with a login: a page that looks like the login screen is checked, and the page is loaded again when the session still holds.
  if (await watchLogin(page, url)) {
    response = await page.goto(url, options);
    await settlePage(page);
  }
  return {
    status: response?.status() ?? null,
    finalUrl: page.url(),
    contentType: response?.headers()["content-type"] ?? null,
  };
}

/**
 * Run the work on one page, and once more when it fails: a page that loads too slowly once, or a
 * renderer that crashed, must not cost the whole run. A session that ran out is not tried again.
 * With a `crowd` the first try runs together with the other pages and the second try alone.
 * A second failure is thrown: the command decides whether it notes the page as not measured and goes on.
 */
export async function retryOnce<T>(what: string, work: () => Promise<T>, crowd?: Crowd): Promise<T> {
  try {
    return await (crowd ? crowd.together(work) : work());
  } catch (error) {
    // Trying again does not help when the site refused the evaluation.
    if (error instanceof LoginExpired || error instanceof OriginBlocked) throw error;
    process.stderr.write(`retry ${what}: ${firstLineOf(error)}\n`);
    return crowd ? crowd.alone(work) : work();
  }
}

/** The first line of an error: Playwright appends its call log below it. */
export const firstLineOf = (error: unknown): string => ((error as Error)?.message ?? String(error)).split("\n")[0]!;

/**
 * In a run with a login: open the page that only shows with a session and stop with a
 * `LoginExpired` when it is the login screen. A command of the sweep asks this before and
 * after its work, so that a session that ran out on pages anybody may see is noticed too.
 */
export async function confirmLogin(browser: Browser): Promise<void> {
  const mark = runLoginMark();
  if (!mark) return;
  throwIfLoginExpired();
  const context = await newContext(browser, { writes: null });
  try {
    await confirmLoginOn(await context.newPage(), mark);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** How an embedded window of the sample was measured: where it stands, or on its own with the reason. */
export interface Placement {
  /** The page it stands on, when it was measured there. */
  inPlaceOn: string | null;
  /** Why it was opened on its own instead; null when it was measured in place. */
  apartNl: string | null;
}

const sameDocument = (first: string, second: string): boolean => {
  try {
    const [a, b] = [new URL(first), new URL(second)];
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
};

/**
 * Load a page of the sample for measuring. `settle` runs when the page in the tab is there:
 * it closes what covers the page. An embedded window is measured where it stands: the page
 * that embeds it is loaded, and what comes back is the frame as a page, so every instrument
 * measures in it what it measures on a page. When the frame is not there (it did not load, or
 * the page no longer embeds it) the window is opened on its own, and the reason comes back.
 */
export async function loadSampled(tab: Page, item: { url: string; embeddedOn?: string[] }, settle: (tab: Page) => Promise<void> = async () => undefined): Promise<{ page: Page; placement: Placement | null }> {
  const on = item.embeddedOn?.[0];
  if (!on) {
    await loadPage(tab, item.url);
    await settle(tab);
    return { page: tab, placement: null };
  }
  await loadPage(tab, on);
  await settle(tab);
  const frame = tab.frames().find((entry) => entry !== tab.mainFrame() && entry.url() === item.url) ?? tab.frames().find((entry) => entry !== tab.mainFrame() && sameDocument(entry.url(), item.url));
  const readable = frame ? await frame.evaluate(readableFrame).catch(() => false) : false;
  if (frame && readable) return { page: await frameAsPage(tab, frame), placement: { inPlaceOn: on, apartNl: null } };
  await loadPage(tab, item.url, on);
  await settle(tab);
  return { page: tab, placement: { inPlaceOn: null, apartNl: frame ? `het venster op ${on} was niet te lezen` : `op ${on} stond bij het meten geen venster met dit adres, of het laadde daar niet` } };
}

/**
 * How long a page may take to answer after it loaded, counted by Node. The wait inside the page runs on
 * the timers of the page, and a script that keeps the browser busy stops those timers and every answer.
 */
export const SETTLE_ANSWER_MS = RENDERING.settleTimeoutMs + 10_000;

/** A page that gave no answer in time: a script of the page may keep the browser busy. The page cannot be used any more. */
export class PageBusy extends Error {
  override name = "PageBusy";
}

/** Begins as the time limit of a command of the session does, which then closes the page. */
const busyNl = (limitMs: number, when: string): string => `geen antwoord binnen ${limitMs / 1000} seconden${when}: een script van de pagina houdt de browser misschien bezig`;

/** Wait at most `limitMs` for a promise, counted by Node; a promise that is still open then throws a `PageBusy`. */
async function answerWithin<T>(limitMs: number, answer: Promise<T>, reasonNl: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PageBusy(reasonNl)), limitMs);
  });
  try {
    return await Promise.race([answer, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the work on one page with a time limit counted by Node. When the time is up, `discard` closes
 * what the work runs on (its tab or its browser contexts), the work gets a moment to end, and a
 * `PageBusy` is thrown: the command notes the page as not measured and goes on.
 */
export async function withinPageTime<T>(limitMs: number, work: () => Promise<T>, discard: () => Promise<unknown>): Promise<T> {
  const running = work();
  try {
    return await answerWithin(limitMs, running, busyNl(limitMs, ""));
  } catch (error) {
    if (error instanceof PageBusy) {
      await discard().catch(() => undefined);
      // Closed, every call to the page fails at once; the work ends before the next try begins.
      await answerWithin(10_000, running, "").catch(() => undefined);
    }
    throw error;
  }
}

/** The browser contexts of one try of work on a page: all closed when the time is up, and no new one after that. */
export class PageContexts {
  private readonly open = new Set<BrowserContext>();
  private closed = false;

  add(context: BrowserContext): BrowserContext {
    if (this.closed) {
      void context.close().catch(() => undefined);
      throw new PageBusy("de tijd voor deze pagina is op");
    }
    this.open.add(context);
    return context;
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.open].map((context) => context.close().catch(() => undefined)));
  }
}

/**
 * Wait until a page that has just loaded has stopped changing, then record the listeners it registered itself.
 * A page that does not answer within `SETTLE_ANSWER_MS` throws a `PageBusy`; the caller closes it.
 */
export async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: RENDERING.settleTimeoutMs }).catch(() => undefined);
  const settled = page
    .evaluate(async (timeout) => {
      const names = new Set<string>();
      const visit = (root: Document | ShadowRoot): void => {
        for (const element of root.querySelectorAll("*")) {
          if (element.localName.includes("-")) names.add(element.localName);
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(document);
      const defined = Promise.all([...names].map((name) => customElements.whenDefined(name)));
      await Promise.race([
        Promise.all([defined, document.fonts.ready]),
        // The timer of the page itself, untouched: a wait of the toolbox is not a timer of the site (2.2.1).
        (window as unknown as { __loep?: { wait?: (ms: number) => Promise<void> } }).__loep?.wait?.(timeout) ?? new Promise((resolve) => setTimeout(resolve, timeout)),
      ]);
    }, RENDERING.settleTimeoutMs)
    .catch(() => undefined);
  await answerWithin(SETTLE_ANSWER_MS, settled, busyNl(SETTLE_ANSWER_MS, " na het laden"));
  // From here on the test browser may register listeners of its own; the page's own are recorded now.
  // Every frame keeps its own count; a frame that cannot run a script, or does not answer, is reported as such when the counts are read.
  for (const frame of page.frames()) {
    const frozen = frame.evaluate(() => (window as unknown as { __loep?: { freezeListeners: () => void } }).__loep?.freezeListeners()).catch(() => undefined);
    await answerWithin(SETTLE_ANSWER_MS, frozen, busyNl(SETTLE_ANSWER_MS, " na het laden")).catch((error: unknown) => {
      // A busy frame of another origin runs apart; a busy page itself cannot be measured.
      if (frame === page.mainFrame()) throw error;
    });
  }
}
