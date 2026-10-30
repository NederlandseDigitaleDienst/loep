import type { APIResponse, Route } from "playwright";
import { shieldForRun, type Shield } from "../lib/shield.ts";
import type { WriteAccess } from "../lib/writes.ts";

/*
 * The boundary of `lib/shield.ts` in the browser: a request that leaves gets the real values, an
 * answer that comes back gets the aliases, before the browser or anything that records sees it.
 * Only a run with a mailbox comes here, and only for an origin it may send to.
 */

/** The shield for a request of a run, or null: no mailbox, or an origin the run may not send to. */
export function shieldOf(writes: WriteAccess | null | undefined, url: string): Shield | null {
  if (!writes) return null;
  const shield = shieldForRun(writes.runDir);
  return shield?.covers(url) ? shield : null;
}

/** The kinds of request whose answer can hold a token. A picture, a font or a stream goes as it is. */
const SWAPPED_TYPES = new Set(["document", "xhr", "fetch", "other", "eventsource"]);
/** Headers that say something about the body as it came from the server. */
const STALE_HEADERS = ["content-encoding", "content-length", "transfer-encoding", "etag", "digest"];
const MAX_HOPS = 5;

/** An answer as the rest of the toolbox may see it: with aliases. */
export interface ShieldedAnswer {
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
}

async function outwardRequest(route: Route, shield: Shield): Promise<{ url: string; headers: Record<string, string>; postData?: Buffer }> {
  const request = route.request();
  const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(":") && name !== "content-length").map(([name, value]) => [name, shield.outward(value)]));
  const body = request.postDataBuffer();
  return { url: shield.outwardUrl(request.url()), headers, ...(body ? { postData: shield.outwardBytes(body) } : {}) };
}

const swapped = async (response: APIResponse, shield: Shield): Promise<ShieldedAnswer> => {
  const body = shield.inwardBytes(await response.body());
  const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !STALE_HEADERS.includes(name)).map(([name, value]) => [name, shield.inward(value)]));
  return { status: () => response.status(), headers: () => headers, body: async () => body };
};

/** A page that sends the browser on: a redirect it follows by itself would not pass the route, and would reach the server with the alias. */
const forwardingPage = (location: string): Buffer => Buffer.from(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${location.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><title>Doorverwijzing</title>`);

/**
 * Send a request with the real values and give the browser the answer with the aliases. A redirect
 * whose address holds a secret needs more, because what the browser asks next does not pass the route:
 * a page gets a page that sends it on, so the next request does pass; a script gets the end of the chain.
 */
export async function fetchShielded(route: Route, shield: Shield): Promise<ShieldedAnswer> {
  const request = route.request();
  let options = await outwardRequest(route, shield);
  for (let hop = 0; ; hop++) {
    const response = await route.fetch({ ...options, maxRedirects: 0 });
    const location = response.headers()["location"];
    const answer = await swapped(response, shield);
    if (!location || response.status() < 300 || response.status() >= 400 || shield.inward(location) === location) return answer;
    const onward = new URL(answer.headers()["location"]!, request.url()).href;
    if (request.isNavigationRequest()) {
      const page = forwardingPage(onward);
      return { status: () => 200, headers: () => ({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }), body: async () => page };
    }
    if (hop >= MAX_HOPS) return answer;
    options = { url: shield.outwardUrl(onward), headers: options.headers };
  }
}

export const fulfilShielded = async (route: Route, answer: ShieldedAnswer): Promise<void> => {
  await route.fulfill({ status: answer.status(), headers: answer.headers(), body: await answer.body() });
};

/**
 * Let a GET or HEAD through. A request that can bring a token back goes through the shield; any other
 * only gets the real value when its own address has an alias in it. A redirect is only followed where
 * `mayFollow` allows.
 */
export async function passShielded(route: Route, shield: Shield, mayFollow: (url: string) => boolean = () => true): Promise<void> {
  const request = route.request();
  const url = shield.outwardUrl(request.url());
  const stream = (request.headers()["accept"] ?? "").includes("text/event-stream");
  if (!SWAPPED_TYPES.has(request.resourceType()) || stream) {
    await (url === request.url() ? route.continue() : route.continue({ url })).catch(() => undefined);
    return;
  }
  try {
    const answer = await fetchShielded(route, shield);
    const location = answer.headers()["location"];
    if (location && answer.status() >= 300 && answer.status() < 400 && !mayFollow(new URL(location, request.url()).href)) {
      await (request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient"));
      return;
    }
    await fulfilShielded(route, answer);
  } catch {
    // The page went away while the answer was on its way; there is nobody left to answer.
    await route.abort("failed").catch(() => undefined);
  }
}
