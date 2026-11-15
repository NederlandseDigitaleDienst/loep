import type { Page, Request } from "playwright";

/**
 * When the network of a page is quiet. Playwright's `networkidle` waits for 500 ms without any
 * request, and a single request that never ends (a long-poll, a beacon that hangs, a request a
 * script retries) holds it until the cap. Here a request that has been in flight for longer than
 * `LONG_REQUEST_MS` stops counting, and the requests that did so, or that held the page until the
 * cap, are noted so the load that reports the time also says what took it.
 */

/** How long the network must be quiet. */
export const QUIET_MS = 500;
/** A request in flight longer than this no longer holds the page: a long-poll or a beacon that hangs. */
export const LONG_REQUEST_MS = 2000;
/** How often the count is looked at; every request also marks when it started or ended, so a short one in between is not missed. */
const POLL_MS = 25;
/** At most this many requests are noted per settle. */
const MAX_NOTED = 10;

/** A request that was dropped from the count for taking too long, or that was still going when the cap was hit. */
export interface SlowRequest {
  method: string;
  resourceType: string;
  /** The address without query and fragment. */
  url: string;
  /** How long it had been in flight when settling ended, or how long it took when it ended before. */
  ms: number;
}

/** What settling noted about the network; only there when a request was slow or the cap was hit. */
export interface SettleNote {
  /** Milliseconds until the network was quiet, counted from the start of settling; null when the cap was hit first. */
  quietAfterMs: number | null;
  slowRequests: SlowRequest[];
}

interface Flight {
  request: Request;
  started: number;
  ended: number | null;
}

class RequestTracker {
  private readonly flights = new Map<Request, Flight>();
  /** Requests that ended a short while ago: when the cap is hit by requests that keep coming, these say which. */
  private recent: Flight[] = [];
  /** Long requests already noted by an earlier settle of this page. */
  private readonly noted = new WeakSet<Request>();
  /** When a request last started or ended, or when tracking began. */
  lastChange = performance.now();

  constructor(page: Page) {
    page.on("request", (request) => {
      this.flights.set(request, { request, started: performance.now(), ended: null });
      this.lastChange = performance.now();
    });
    // A request that loep aborts in a route fails; one it fulfills finishes. Both end it here.
    const end = (request: Request): void => {
      const flight = this.flights.get(request);
      if (!flight) return;
      this.flights.delete(request);
      flight.ended = performance.now();
      this.lastChange = flight.ended;
      this.recent.push(flight);
      this.recent = this.recent.filter((entry) => entry.ended! > flight.ended! - QUIET_MS * 2);
    };
    page.on("requestfinished", end);
    page.on("requestfailed", end);
    page.on("close", () => this.flights.clear());
  }

  /** The requests in flight now, and from when the network counts as quiet if none of the short ones is. */
  state(now: number): { counted: Flight[]; long: Flight[]; quietFrom: number } {
    const counted: Flight[] = [];
    const long: Flight[] = [];
    let quietFrom = this.lastChange;
    for (const flight of this.flights.values()) {
      if (now - flight.started < LONG_REQUEST_MS) counted.push(flight);
      else {
        long.push(flight);
        // The moment it stopped counting is when its share in the quiet begins.
        quietFrom = Math.max(quietFrom, flight.started + LONG_REQUEST_MS);
      }
    }
    return { counted, long, quietFrom };
  }

  recentSince(from: number): Flight[] {
    return this.recent.filter((flight) => flight.ended! >= from);
  }

  isNoted(request: Request): boolean {
    return this.noted.has(request);
  }

  note(request: Request): void {
    this.noted.add(request);
  }
}

const trackers = new WeakMap<Page, RequestTracker>();

/** Count the requests of a page from now on. Called when a page is made, and before a load, so the requests before settling count too. */
export function trackRequests(page: Page): void {
  // A frame shown as a page has no events of its own; its requests are those of its tab.
  if (trackers.has(page) || typeof (page as Partial<Page>).on !== "function") return;
  trackers.set(page, new RequestTracker(page));
}

const withoutQuery = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin === "null" ? `${parsed.protocol}` : parsed.origin}${parsed.pathname}`.slice(0, 300);
  } catch {
    return url.split(/[?#]/)[0]!.slice(0, 300);
  }
};

const slowOf = (flight: Flight, now: number): SlowRequest => ({ method: flight.request.method(), resourceType: flight.request.resourceType(), url: withoutQuery(flight.request.url()), ms: Math.round((flight.ended ?? now) - flight.started) });

/** Requests once per method and address, the longest first. */
function noteList(flights: Flight[], now: number): SlowRequest[] {
  const byAddress = new Map<string, SlowRequest>();
  for (const flight of flights) {
    const slow = slowOf(flight, now);
    const key = `${slow.method} ${slow.url}`;
    if ((byAddress.get(key)?.ms ?? -1) < slow.ms) byAddress.set(key, slow);
  }
  return [...byAddress.values()].sort((a, b) => b.ms - a.ms).slice(0, MAX_NOTED);
}

/**
 * Wait until no request that counts has been in flight for `QUIET_MS`, at most `capMs`. Returns a
 * note when a request was dropped from the count for taking too long, or when the cap was hit;
 * otherwise null.
 */
export async function waitForQuietNetwork(page: Page, capMs: number): Promise<SettleNote | null> {
  trackRequests(page);
  const tracker = trackers.get(page);
  if (!tracker) return null;
  const began = performance.now();
  const dropped: Flight[] = [];
  const seen = new Set<Request>();
  for (;;) {
    const now = performance.now();
    const { counted, long, quietFrom } = tracker.state(now);
    for (const flight of long) {
      if (seen.has(flight.request) || tracker.isNoted(flight.request)) continue;
      seen.add(flight.request);
      dropped.push(flight);
    }
    if (counted.length === 0 && now - quietFrom >= QUIET_MS) {
      for (const flight of dropped) tracker.note(flight.request);
      return dropped.length > 0 ? { quietAfterMs: Math.round(Math.max(0, quietFrom + QUIET_MS - began)), slowRequests: noteList(dropped, now) } : null;
    }
    if (now - began >= capMs || page.isClosed()) {
      if (page.isClosed()) return null;
      for (const flight of dropped) tracker.note(flight.request);
      // What held the page: the long ones, what is still going, and what came and went just before the cap.
      return { quietAfterMs: null, slowRequests: noteList([...dropped, ...counted, ...tracker.recentSince(now - QUIET_MS)], now) };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
