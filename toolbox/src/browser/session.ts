import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { CLOUDFLARE_HEADER, isChallenge } from "../lib/challenge.ts";
import { confirmLoginOn, LoginExpired, logsOut, runLoginMark, runLoginState, throwIfLoginExpired, watchLogin } from "../lib/login.ts";
import { addressOf, noteRefusedRead, readDecision, readRuleFor, runReads, type ReadRequest } from "../lib/reads.ts";
import { isOurMessage, isWriteOrigin, runWrites, type WriteAccess } from "../lib/writes.ts";
import { MESSAGE_VALUES } from "../session/safety.ts";
import { refusedByBrowser, type ClipboardWrite } from "./clipboard.ts";
import { frameAsPage } from "./frame.ts";

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
}

/**
 * Let a write through to the test environment. What a browser asks for after a redirect does
 * not pass the route again, so the answer is looked at here first: a redirect that would
 * repeat the write somewhere else than the test environment (307, 308) is refused, and so is
 * one that `mayFollow` rejects. Returns the address of a write the browser will repeat, for the log.
 */
export async function passWrite(route: Route, writes: WriteAccess, mayFollow: (url: string) => boolean = () => true): Promise<string | null> {
  return passOn(route, (target) => isWriteOrigin(writes, target), mayFollow);
}

/**
 * Let a request through that may pass although it is not a GET: a write to the test environment,
 * or a read request of the site model. A redirect that would repeat it (307, 308) is only followed
 * to an address `mayRepeat` allows; any other redirect only where `mayFollow` allows. Returns the
 * address of a request the browser will repeat.
 */
export async function passOn(route: Route, mayRepeat: (url: string) => boolean, mayFollow: (url: string) => boolean = () => true): Promise<string | null> {
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
        return null;
      }
      if (keepsMethod) repeated = target;
    }
    await route.fulfill({ response });
    return repeated;
  } catch {
    // The page went away while the answer was on its way; there is nobody left to answer.
    await route.abort("failed").catch(() => undefined);
    return null;
  }
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
  const context = await browser.newContext({
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
  context.setDefaultNavigationTimeout(RENDERING.navigationTimeoutMs);
  const viaCloudflare = new Set<string>();
  cloudflareHosts.set(context, viaCloudflare);
  context.on("response", (response) => {
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
    // Logging out ends the session for everything that comes after: such a request never leaves, whatever its method.
    if (logsOut(route.request().url())) return route.request().isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient");
    if (method === "GET" || method === "HEAD") {
      const spaced = spacing;
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
    // The sweep shares the budget for sending with the sessions: a write past it, or too soon after the previous one, is held back.
    if (!writes!.claim(method, route.request().url()).ok) return route.request().isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient");
    return passWrite(route, writes!).then((repeated) => void (repeated && writes!.record(method, repeated, { repeat: true })));
  });
  if (guard || writes) {
    await context.routeWebSocket(/.*/, (socket) => {
      const server = socket.connectToServer();
      const free = isWriteOrigin(writes, socket.url());
      socket.onMessage((message) => {
        if (free) {
          // A frame with a test value in it takes one from the budget of the run, and past it, or too soon, it is held back; a heartbeat is only noted.
          if (isOurMessage(message, MESSAGE_VALUES)) {
            if (!writes!.claim("SEND", socket.url(), { message: true }).ok) return void (guard?.active && guard.blocked++);
          } else writes!.record("SEND", socket.url());
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
  let response = await page.goto(url, options);
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
 * A second failure is thrown: the command decides whether it notes the page as not measured and goes on.
 */
export async function retryOnce<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LoginExpired) throw error;
    process.stderr.write(`retry ${what}: ${firstLineOf(error)}\n`);
    return work();
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
  const readable = frame ? await frame.evaluate(() => typeof (window as unknown as { __loep?: unknown }).__loep === "object" && document.body !== null).catch(() => false) : false;
  if (frame && readable) return { page: await frameAsPage(tab, frame), placement: { inPlaceOn: on, apartNl: null } };
  await loadPage(tab, item.url, on);
  await settle(tab);
  return { page: tab, placement: { inPlaceOn: null, apartNl: frame ? `het venster op ${on} was niet te lezen` : `op ${on} stond bij het meten geen venster met dit adres, of het laadde daar niet` } };
}

/** Wait until a page that has just loaded has stopped changing, then record the listeners it registered itself. */
export async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: RENDERING.settleTimeoutMs }).catch(() => undefined);
  await page
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
  // From here on the test browser may register listeners of its own; the page's own are recorded now.
  // Every frame keeps its own count; a frame that cannot run a script is reported as such when the counts are read.
  for (const frame of page.frames()) await frame.evaluate(() => (window as unknown as { __loep?: { freezeListeners: () => void } }).__loep?.freezeListeners()).catch(() => undefined);
}
