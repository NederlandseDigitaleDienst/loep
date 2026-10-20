import { join } from "node:path";
import type { BrowserContext, Page, Response } from "playwright";
import { confirmLogin, INPAGE_PATH, launchBrowser, loadPage, newContext, withinPageTime } from "../browser/session.ts";
import { sha256, slugForUrl, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { countByKind, documentKind, kindOfContentType, REDIRECTS_ELSEWHERE_NL, startedDownload, type DocumentKind, type DocumentTotals, type InventoryDocument } from "../lib/documents.ts";
import type { Vendor } from "../lib/evaluation.ts";
import { ignoreSecrets, isLogout, loginCookieHeader, LoginExpired, noteLogoutUrl, runLoginMark } from "../lib/login.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { notFoundProbes, originsOfRun, privateFromPublicSite, siteOrigins } from "../lib/origins.ts";

export interface InventoryPage {
  url: string;
  /** Where the browser was once the page had loaded, when that is not `url`: the server redirected, or a script changed the address. Absent when it stayed on `url`, and in older runs. */
  finalUrl?: string;
  /** Only when `finalUrl` has an anchor: what a visitor finds there. Absent otherwise, and in older runs. */
  anchor?: AnchorLanding;
  slug: string;
  status: number | null;
  title: string;
  lang: string | null;
  /** Hash of the component vocabulary: pages with the same value share a template. */
  templateHash: string;
  /** Hash of the normalised DOM including shadow roots: the fingerprint of what was evaluated. */
  contentHash: string;
  foundVia: string[];
  counts: Record<string, unknown>;
  /** Words of visible text in the main region (or the body without one): the length of the page, for choosing on variation. Absent in older runs. */
  words?: number;
  /** The widths the stylesheets name in a media or container query, for the explorer. Absent in older runs. */
  breakpoints?: number[];
  /** Milliseconds from asking for the page until it was loaded and quiet, as every step of the sweep waits for it. Absent in older runs. */
  loadMs?: number;
  /** What there is to operate: links, and the other controls. The sweep takes longer the more there is. Absent in older runs. */
  operable?: { links: number; controls: number };
}

/**
 * Where an address that leads to an anchor lands. Chromium gives focus to the target of the anchor
 * when it can take focus (a link, a field, an element with tabindex); only then does WCAG 2.4.11
 * apply. `coveredBy`: the element painted over the middle of the focused target, as in the Tab walk.
 */
export interface AnchorLanding {
  /** The anchor as the address names it, without `#`. */
  id: string;
  /** Whether the page has an element with that id, or a link with that name. */
  found: boolean;
  /** Whether the target, or an element in it, has focus after the jump. */
  focused: boolean;
  /** Only when focused: whether the target is in the window. */
  inViewport: boolean | null;
  coveredBy: string | null;
}

export interface Inventory {
  baseUrl: string;
  /** The origin of the start address. */
  origin: string;
  /** Every origin of the site, `origin` first, then each one given with `--also-origin`. Absent in older runs, which have only `origin`; read it with `siteOrigins`. */
  origins?: string[];
  sitemapUrls: number;
  /** The address asked for to see the page for a missing address, on `origin`. */
  notFoundProbe: string;
  /** The same address on every origin of the site, `notFoundProbe` first. Absent in older runs; read it with `notFoundProbes`. */
  notFoundProbes?: string[];
  pages: InventoryPage[];
  skipped: { url: string; reason: string }[];
  /** Site-wide totals of the features whose absence makes a criterion "not applicable". */
  totals: Record<string, number>;
  /** Whose components the site is built with, when the one who started the run said so. */
  vendor?: Vendor;
  /** Documents on the origins of the run that a page links to or the sitemap names. Absent in older runs. */
  documents?: InventoryDocument[];
  /** How many documents there are, here and on other origins. Absent in older runs. */
  documentTotals?: DocumentTotals;
  /** Only in a run with a login: the addresses of links that log out. None was followed, and no browser of the run asks for them. */
  logoutLinks?: string[];
  /**
   * Origins outside the run that a page of the site read content from with GET (fetch or XHR), with the
   * pages that did and how many such answers came. A session refuses those requests, so what they load
   * stays empty in every measurement unless the origin is given with `--also-origin`. Absent in older runs.
   */
  readsOutsideRun?: ReadOutsideRun[];
}

export interface ReadOutsideRun {
  origin: string;
  pages: string[];
  requests: number;
}

export interface InventoryOptions {
  baseUrl: string;
  out: string;
  maxPages: number;
  /** Further origins of the same site, such as its documentation on a subdomain (`--also-origin`). */
  alsoOrigins?: string[] | undefined;
  /** Evaluate exactly these URLs and follow no links: used to repeat the sample of an existing audit. */
  fixedUrls?: string[] | undefined;
  vendor?: Vendor | undefined;
}

const NOT_FOUND_PATH = "/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek";

export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [`${origin}/sitemap.xml`];
  const urls = new Set<string>();
  while (queue.length > 0) {
    const sitemap = queue.shift()!;
    if (seen.has(sitemap)) continue;
    seen.add(sitemap);
    const response = await fetch(sitemap).catch(() => null);
    if (!response?.ok) continue;
    for (const location of parseSitemap(await response.text())) {
      if (location.endsWith(".xml") || location.endsWith(".xml.gz")) queue.push(location);
      else if (new URL(location).origin === origin) urls.add(normaliseUrl(location));
    }
  }
  return [...urls].sort();
}

/**
 * In a run without a login: the pages that show a password field, said right after the inventory.
 * A part behind a login is otherwise found only by the explorer or the gate, after hours of work
 * that has to be done again once a person has logged in. Null when there is nothing to say.
 */
export function passwordPagesNl(pages: Pick<InventoryPage, "url" | "counts">[], loggedIn: boolean): string | null {
  if (loggedIn) return null;
  const found = pages.filter((entry) => typeof entry.counts.passwordFields === "number" && entry.counts.passwordFields > 0).map((entry) => entry.url);
  if (found.length === 0) return null;
  const named = found.length === 1 ? found[0] : `${found[0]} en ${found.length - 1} meer`;
  return `let op: ${found.length === 1 ? "één pagina toont" : `${found.length} pagina's tonen`} een wachtwoordveld (${named}), en er is niet ingelogd. Staat een deel van de site achter een inlog, dan wordt dat deel niet onderzocht. Hoort het erbij, laat dan een mens inloggen met loep login en begin opnieuw met inventory, in een nieuwe map`;
}

/**
 * In a run that may not send: the pages with a form, and the embedded frames on another origin
 * with one, said right after the inventory. What only shows after sending then stays open as
 * "versturen niet toegestaan", and only a new inventory can declare a test environment. A form
 * that every page has, such as a search in the header, is left out: it is mostly a search that
 * asks with GET, which is always allowed. Null when there is nothing to say. A chat without a
 * form element is not counted.
 */
export function formPagesNl(pages: Pick<InventoryPage, "url" | "counts" | "foundVia">[], origins: string | readonly string[], writesAllowed: boolean): string | null {
  if (writesAllowed) return null;
  const ownOrigins = typeof origins === "string" ? [origins] : origins;
  const forms = (entry: (typeof pages)[number]): number => (typeof entry.counts.forms === "number" ? entry.counts.forms : 0);
  const isFrame = (entry: (typeof pages)[number]): boolean => entry.foundVia.length > 0 && entry.foundVia.every((via) => via.startsWith("iframe:"));
  const own = pages.filter((entry) => !isFrame(entry));
  const everywhere = own.length > 0 ? Math.min(...own.map(forms)) : 0;
  const withForm = own.filter((entry) => forms(entry) > everywhere).map((entry) => entry.url);
  const frames = pages.filter((entry) => isFrame(entry) && !ownOrigins.includes(new URL(entry.url).origin) && forms(entry) > 0).map((entry) => entry.url);
  if (withForm.length === 0 && frames.length === 0) return null;
  const named = (urls: string[]): string => (urls.length === 1 ? urls[0]! : `${urls[0]} en ${urls.length - 1} meer`);
  const parts = [
    withForm.length > 0 ? `${withForm.length === 1 ? "één pagina heeft" : `${withForm.length} pagina's hebben`} een formulier dat niet op elke pagina staat (${named(withForm)})` : null,
    frames.length > 0 ? `${frames.length === 1 ? "één ingesloten venster op een ander adres heeft" : `${frames.length} ingesloten vensters op een ander adres hebben`} een formulier (${named(frames)})` : null,
  ].filter(Boolean);
  const frameOrigins = [...new Set(frames.map((url) => new URL(url).origin))];
  const declare = `--test-environment ${withForm.length === 0 && frameOrigins.length === 1 ? frameOrigins[0] : "<origin>"} --declared-by "<naam>, <functie>"`;
  return (
    `let op: dit onderzoek mag niet versturen, en ${parts.join(", en ")}. Wat pas na versturen verschijnt (een melding van de server, een bevestiging, het antwoord van een chat), blijft open als "versturen niet toegestaan". ` +
    `Is er een testomgeving, begin dan opnieuw met inventory, in een nieuwe map, met ${declare}${frames.length > 0 ? "; voor een venster op een ander adres kan dat de origin van alleen dat venster zijn" : ""}`
  );
}

/**
 * The pages that read content from an origin outside the run, said right after the inventory. A
 * session refuses such a request, so a block filled by it stays empty in every measurement; which
 * origins belong to the run is decided here and cannot change later. Null when there is nothing to say.
 */
export function readsOutsideRunNl(reads: readonly ReadOutsideRun[] | undefined): string | null {
  if (!reads || reads.length === 0) return null;
  const pages = new Set(reads.flatMap((entry) => entry.pages)).size;
  const shown = reads.slice(0, 5).map((entry) => `${entry.origin} (${entry.pages.length === 1 ? entry.pages[0] : `${entry.pages[0]} en ${entry.pages.length - 1} meer`})`);
  const listed = reads.length > shown.length ? [...shown, `en ${reads.length - shown.length} meer`] : shown;
  const flags = reads.length <= 3 ? reads.map((entry) => `--also-origin ${entry.origin}`).join(" ") : "--also-origin <origin> voor elk adres dat erbij hoort";
  return (
    `let op: ${pages === 1 ? "één pagina haalt" : `${pages} pagina's halen`} met GET inhoud op van een adres buiten de run: ${listed.join(", ")}. ` +
    `Een sessie houdt die verzoeken tegen, dus wat zo in de pagina komt, blijft in elke meting leeg. ` +
    `Hoort die inhoud bij het onderzoek, begin dan opnieuw met inventory, in een nieuwe map, met ${flags}. Zo niet, dan valt ze buiten de afbakening`
  );
}

/** Answers that put content in a page: data or markup, not an image, a script or an empty answer such as a measuring beacon gets. */
const CONTENT_TYPE = /^\s*(application\/([\w.-]+\+)?(json|xml)|application\/xhtml\+xml|text\/(html|plain|xml|csv))\s*(;|$)/i;

/**
 * The origin outside the site that a page itself read content from: a GET by fetch or XHR from the
 * page, not from a frame in it, answered with data or markup. Null for any other answer. A frame
 * may read elsewhere in a session, the way it does for every visitor; the page may not.
 */
export function contentReadOutside(response: Pick<Response, "status" | "headers" | "url" | "frame" | "request">, origins: readonly string[]): string | null {
  try {
    const request = response.request();
    if (request.method() !== "GET" || !["fetch", "xhr"].includes(request.resourceType())) return null;
    if (response.frame().parentFrame() !== null) return null;
    if (response.status() < 200 || response.status() >= 300 || response.status() === 204) return null;
    if (!CONTENT_TYPE.test(response.headers()["content-type"] ?? "")) return null;
    const { origin, protocol } = new URL(response.url());
    if (protocol !== "http:" && protocol !== "https:") return null;
    return origins.includes(origin) ? null : origin;
  } catch {
    // An answer of a worker has no frame: no read of the page.
    return null;
  }
}

/**
 * Where an address sits in the site: each segment of its path, then its query as one level
 * deeper. A page with a query (`?page=2`) is thus one level below the page without.
 */
export function addressLevels(url: string): string[] {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return parsed.search ? [...segments, parsed.search] : segments;
}

const levelKey = (levels: string[], depth: number): string => levels.slice(0, depth).join("\n");

/**
 * The levels by which the order takes turns. On a site with more than one origin the origin is
 * the first level, so each origin of the site gets its share before the parts within it do. An
 * address on another origin (an embedded frame) counts as one of the first origin, as it always
 * did, so a site with one origin is visited in the same order as before.
 */
function visitLevels(url: string, origins: readonly string[]): string[] {
  if (origins.length <= 1) return addressLevels(url);
  const origin = new URL(url).origin;
  return [origins.includes(origin) ? origin : origins[0]!, ...addressLevels(url)];
}

/** Record that an address was visited: every part of the site it sits in has one more page. */
export function noteVisited(visited: Map<string, number>, url: string, origins: readonly string[] = []): void {
  const levels = visitLevels(url, origins);
  for (let depth = 1; depth <= levels.length; depth++) {
    const key = levelKey(levels, depth);
    visited.set(key, (visited.get(key) ?? 0) + 1);
  }
}

/**
 * The next address to visit, so that a limit on the number of pages covers the site in its
 * breadth. Of the candidates, the one in the part of the site (first path segment) with the
 * fewest visited pages goes first; within that part, the one in the sub-part with the fewest,
 * and so on down the path. A shallower address goes before a deeper one with the same counts,
 * and the address itself decides a tie, so the order never depends on timing. A part full of
 * tag pages or pages of a list (`/blog/tag/x/page/2`) thus gets its turn like any other part,
 * instead of filling the limit because its addresses come first in the alphabet. With more than
 * one origin, the origin comes before the first path segment (see visitLevels).
 */
export function nextAddress(candidates: Iterable<string>, visited: Map<string, number>, origins: readonly string[] = []): string | undefined {
  let best: { url: string; counts: number[] } | undefined;
  for (const url of candidates) {
    const levels = visitLevels(url, origins);
    const counts = levels.map((_, index) => visited.get(levelKey(levels, index + 1)) ?? 0);
    const order = best === undefined ? -1 : compareCounts(counts, best.counts) || (url < best.url ? -1 : 1);
    if (order < 0) best = { url, counts };
  }
  return best?.url;
}

function compareCounts(a: number[], b: number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}

/** The reason recorded for an address left out because the limit on pages was reached. */
export const pageLimitReason = (maxPages: number): string => `page limit of ${maxPages} reached`;

/** The reason recorded for an embedded window on this machine or a local network, on a site that is not there itself. */
export const PRIVATE_FRAME_REASON = "embedded frame on a local or private address, on a site that is not local: not visited and not in the scope";

/**
 * The part of the site an address belongs to, as `pageLimitNl` names it: the first path segment,
 * or the origin of another site. On a site with more than one origin, the origin and the first
 * path segment ("https://docs.example.nl/handleiding").
 */
function sectionOf(url: string, origins: readonly string[]): string {
  const parsed = new URL(url);
  if (!origins.includes(parsed.origin)) return parsed.origin;
  const first = parsed.pathname.split("/").filter(Boolean)[0];
  const path = first === undefined ? "/" : `/${first}`;
  return origins.length > 1 ? `${parsed.origin}${path}` : path;
}

/** At most this many parts of the site are named one by one in the warning about the limit. */
const SECTIONS_NAMED = 12;

/**
 * Said right after the inventory when the limit on pages was reached: per part of the site how
 * many pages were visited and how many were left out. What is left out never reaches the sample,
 * and the line with the totals does not say which part is missing. Null when the limit was not reached.
 */
export function pageLimitNl(found: Pick<Inventory, "origin" | "notFoundProbe" | "pages" | "skipped"> & Partial<Pick<Inventory, "origins" | "notFoundProbes">>, maxPages: number): string | null {
  const omitted = found.skipped.filter((entry) => entry.reason === pageLimitReason(maxPages));
  if (omitted.length === 0) return null;
  const origins = siteOrigins(found);
  const probes = notFoundProbes(found);
  const sections = new Map<string, { visited: number; omitted: number }>();
  const count = (url: string, field: "visited" | "omitted"): void => {
    const section = sectionOf(url, origins);
    const entry = sections.get(section) ?? { visited: 0, omitted: 0 };
    entry[field]++;
    sections.set(section, entry);
  };
  for (const entry of found.pages) if (!probes.includes(entry.url)) count(entry.url, "visited");
  for (const entry of omitted) count(entry.url, "omitted");
  const ranked = [...sections.entries()].sort(([a, x], [b, y]) => y.visited + y.omitted - (x.visited + x.omitted) || a.localeCompare(b));
  const named = ranked.slice(0, SECTIONS_NAMED);
  const width = Math.max(...named.map(([section]) => section.length));
  const lines = named.map(([section, entry]) => `  ${section.padEnd(width)}  ${String(entry.visited).padStart(4)} bezocht, ${String(entry.omitted).padStart(4)} weggelaten`);
  const rest = ranked.slice(SECTIONS_NAMED);
  if (rest.length > 0) {
    const sum = (field: "visited" | "omitted"): number => rest.reduce((total, [, entry]) => total + entry[field], 0);
    lines.push(`  en ${rest.length} ${rest.length === 1 ? "ander gedeelte" : "andere gedeelten"}: samen ${sum("visited")} bezocht, ${sum("omitted")} weggelaten`);
  }
  return [
    `LET OP: de grens van ${maxPages} pagina's (--max-pages) is bereikt. ${omitted.length === 1 ? "Eén gevonden pagina is" : `${omitted.length} gevonden pagina's zijn`} niet bezocht, en wat alleen via die pagina's te vinden is, ontbreekt ook in deze telling. De bezochte pagina's zijn over de gedeelten van de site verdeeld. Per gedeelte (${origins.length > 1 ? "de origin en het eerste deel van het pad" : "het eerste deel van het pad"}):`,
    ...lines,
    "Wat niet is bezocht, komt niet in de steekproef. Ontbreekt een gedeelte dat erbij hoort, of is het aandeel van een gedeelte veel kleiner dan op de site, begin dan opnieuw met inventory in een nieuwe map, met een hogere --max-pages of met --urls.",
  ].join("\n");
}

export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
}

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/**
 * Where the browser landed, as the inventory records it: with its query only when the address asked
 * for has that same query. After a login a redirect can put a secret there, such as the `code` and
 * `state` of an OAuth or OpenID Connect redirect (RFC 6749, section 4.1.2), and the inventory goes
 * into tasks for agents. The anchor stays: `sample` needs to know whether one was added.
 */
export function landingAddress(requested: string, landed: string): string {
  const parsed = new URL(landed);
  if (parsed.search !== new URL(requested).search) parsed.search = "";
  return parsed.href;
}

const NON_PAGE = /\.(pdf|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|zip|woff2?|ttf|mp4|mp3|docx?|xlsx?|pptx?|odt|csv)$/i;

/** A link on a page: where it leads, its text, and the file name of its `download` attribute (null without one, "" when it names none). */
interface Anchor {
  href: string;
  text: string;
  download: string | null;
}

/** Every link on the page with its text, through shadow roots. Which of them lead to a document is decided outside the page. */
function linksWithText(page: Page): Promise<Anchor[]> {
  return page.evaluate(() => {
    const found: { href: string; text: string; download: string | null }[] = [];
    const visit = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element.localName !== "a" && element.localName !== "area") continue;
        const raw = element.getAttribute("href");
        if (!raw) continue;
        try {
          const url = new URL(raw, document.baseURI);
          if (url.protocol !== "http:" && url.protocol !== "https:") continue;
          url.hash = "";
          const text = element.getAttribute("aria-label") || element.textContent?.trim() || element.querySelector("img")?.getAttribute("alt") || element.getAttribute("alt") || "";
          found.push({ href: url.href, text: text.replace(/\s+/g, " ").trim().slice(0, 200), download: element.getAttribute("download") });
        } catch {
          // Not a URL; nothing to follow.
        }
      }
    };
    visit(document);
    return found;
    // Chromium accepts some hosts that Node's URL rejects, such as one with a space in it.
  }).then((found) => found.filter((anchor) => URL.canParse(anchor.href)));
}

/** Documents asked for their size and date; beyond this they are recorded without. */
export const MAX_DOCUMENT_PROBES = 300;
const PROBE_TIMEOUT_MS = 8000;
/** Loading and reading one page, counted by Node: twice the wait for a navigation and for settling, with a login, and room to read. */
const PAGE_LIMIT_MS = 4 * 60_000;

/** What one HEAD request says about a document. `redirectsTo` is the address outside the site its address redirects to: then it is no document of the site. */
export type DocumentProbe = Pick<InventoryDocument, "bytes" | "lastModified" | "contentType" | "status" | "notAsked"> & { redirectsTo?: string };

/** One HEAD request: size, date and type as the server gives them. Redirects are followed only inside the origins of the site. */
export async function probeDocument(url: string, origins: string | readonly string[]): Promise<DocumentProbe> {
  const own = typeof origins === "string" ? [origins] : origins;
  const nothing = { bytes: null, lastModified: null, contentType: null, status: null };
  let address = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (!own.includes(new URL(address).origin)) return { ...nothing, notAsked: REDIRECTS_ELSEWHERE_NL, redirectsTo: address };
      // A document behind a login is asked about with the session of the run.
      const cookie = loginCookieHeader(address);
      const response = await fetch(address, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), ...(cookie ? { headers: { cookie } } : {}) });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        address = new URL(location, address).href;
        continue;
      }
      const length = Number(response.headers.get("content-length"));
      const modified = Date.parse(response.headers.get("last-modified") ?? "");
      return {
        bytes: response.ok && Number.isFinite(length) && length > 0 ? length : null,
        lastModified: response.ok && Number.isFinite(modified) ? new Date(modified).toISOString() : null,
        contentType: response.headers.get("content-type"),
        status: response.status,
      };
    }
    return { ...nothing, notAsked: "te veel doorverwijzingen" };
  } catch (error) {
    return { ...nothing, notAsked: `de server gaf geen antwoord op de vraag naar grootte en datum: ${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 100)}` };
  }
}

/** Whether a `Content-Type` says HTML: only such an answer is a page. */
export const isHtml = (contentType: string | null): boolean => /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType ?? "");

/** What a visitor finds at the anchor the browser landed on; undefined when the address has no anchor. */
async function anchorLanding(page: Page, finalUrl: string): Promise<AnchorLanding | undefined> {
  const hash = new URL(finalUrl).hash.slice(1);
  if (!hash) return undefined;
  let id = hash;
  try {
    id = decodeURIComponent(hash);
  } catch {
    // An anchor that is no valid percent-encoding is looked up as it stands, as the browser does.
  }
  return page.evaluate((id) => {
    const loep = (window as unknown as { __loep: Record<string, (...args: unknown[]) => unknown> }).__loep;
    // As the browser looks for the target of an anchor: an element with that id, else a link with that name.
    const target = document.getElementById(id) ?? document.querySelector(`a[name="${CSS.escape(id)}"]`);
    const active = loep.deepActiveElement!() as Element | null;
    const focused = target !== null && active !== null && active !== document.body && (active === target || target.contains(active));
    const state = focused ? (loep.focusState!() as { inViewport: boolean; coveredBy: string[] | null } | null) : null;
    return { id, found: target !== null, focused, inViewport: state ? state.inViewport : null, coveredBy: state?.coveredBy ? state.coveredBy.join(" >>> ") : null };
  }, id);
}

type Inspected = Omit<InventoryPage, "foundVia" | "slug"> & { links: string[]; frames: string[]; snapshot: string; html: string; linksWithText: Anchor[]; contentType: string | null };

/**
 * A page as the browser shows it, or the kind of document the server sent instead of HTML.
 * `offered`: a link offers the address as a download; then anything but HTML is a document.
 */
async function inspect(page: Page, url: string, mayBeDocument: boolean, offered: boolean, origins: readonly string[]): Promise<Inspected | { document: DocumentKind }> {
  const began = performance.now();
  const loaded = await loadPage(page, url);
  const loadMs = Math.round(performance.now() - began);
  // A browser shows plain text as a page of its own, a bare `<pre>` without language or title. It is a document, not a page.
  const sent = mayBeDocument ? kindOfContentType(loaded.contentType) : null;
  if (sent) return { document: sent };
  if (mayBeDocument && offered && loaded.contentType !== null && !isHtml(loaded.contentType)) return { document: "other" };
  const anchor = loaded.finalUrl !== url ? await anchorLanding(page, loaded.finalUrl) : undefined;
  const html = await page.content();
  const result = await page.evaluate((own) => {
    const loep = (window as unknown as { __loep: Record<string, (...args: unknown[]) => unknown> }).__loep;
    const facts = loep.collectFacts!() as { title: string; lang: string | null; counts: Record<string, unknown>; links: unknown[]; controls: unknown[] };
    return {
      title: facts.title,
      lang: facts.lang,
      counts: facts.counts,
      operable: { links: facts.links.length, controls: facts.controls.length },
      template: loep.templateSignature!() as string,
      snapshot: loep.contentSnapshot!() as string,
      links: loep.sameOriginLinks!(own) as string[],
      frames: loep.frameSources!() as string[],
      breakpoints: loep.layoutBreakpoints!() as number[],
      words: (loep.flatText as unknown as (node: Node) => string[])((loep.deepQueryAll as unknown as (selector: string) => Element[])("main,[role=main]")[0] ?? document.body)
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length,
    };
  }, [...origins]);
  const landing = landingAddress(url, loaded.finalUrl);
  return {
    url,
    // A redirect that only added a query lands where the address itself does once the query is left out: nothing to record.
    ...(landing !== url ? { finalUrl: landing } : {}),
    ...(anchor ? { anchor } : {}),
    status: loaded.status,
    title: result.title,
    lang: result.lang,
    templateHash: sha256(result.template).slice(0, 12),
    contentHash: sha256(result.snapshot),
    counts: result.counts,
    words: result.words,
    breakpoints: result.breakpoints,
    loadMs,
    operable: result.operable,
    links: result.links,
    frames: result.frames,
    snapshot: result.snapshot,
    html,
    linksWithText: await linksWithText(page),
    contentType: loaded.contentType,
  };
}

export async function inventory(options: InventoryOptions): Promise<Inventory> {
  const startedAt = stepStart();
  // The origins of the site: the one of the start address first, then each further one given (--also-origin).
  const origins = originsOfRun(options.baseUrl, options.alsoOrigins);
  const origin = origins[0]!;
  const ownOrigin = (url: string): boolean => origins.includes(new URL(url).origin);
  const start = normaliseUrl(options.baseUrl);
  const fixed = options.fixedUrls?.map(normaliseUrl);
  // A run with a login: the session a person left behind, and the page that person pointed at.
  const login = runLoginMark();
  if (login && login.origin !== origin) throw new Error(`de inlogsessie van deze run is voor ${login.origin}, niet voor ${origin}`);
  // The run is where a session of a login lives: whoever keeps the run in a repository does not commit it by accident.
  ignoreSecrets(options.out);
  // Behind a login there is no sitemap to go by: the pages are found by following links with the session.
  const sitemap: string[] = [];
  if (!fixed && !login) for (const each of origins) sitemap.push(...(await fetchSitemapUrls(each)));
  // The page for a missing address, asked for on every origin: each can have its own.
  const missingPages = origins.map((each) => `${each}${NOT_FOUND_PATH}`);
  const notFoundProbe = missingPages[0]!;

  const foundVia = new Map<string, Set<string>>();
  const note = (url: string, via: string): void => {
    if (!foundVia.has(url)) foundVia.set(url, new Set());
    foundVia.get(url)!.add(via);
  };
  if (fixed) for (const url of fixed) note(url, "fixed-list");
  else {
    note(start, "start");
    if (login) note(normaliseUrl(login.landingUrl), "start");
    // Every further origin starts at its own start page.
    for (const each of origins.slice(1)) note(normaliseUrl(`${each}/`), "start");
    for (const url of sitemap) note(url, "sitemap");
    for (const probe of missingPages) note(probe, "404-probe");
  }

  const browser = await launchBrowser();
  const browserVersion = browser.version();
  const context: BrowserContext = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  // Reads of content from an origin outside the site by the page being inspected, per origin; null between pages.
  let readsOfPage: Map<string, number> | null = null;
  // A tab that counts those reads. A page that failed gets a fresh tab, which counts them too.
  const newTab = async (): Promise<Page> => {
    const tab = await context.newPage();
    tab.on("response", (response) => {
      if (readsOfPage === null) return;
      const elsewhere = contentReadOutside(response, origins);
      if (elsewhere !== null) readsOfPage.set(elsewhere, (readsOfPage.get(elsewhere) ?? 0) + 1);
    });
    return tab;
  };
  let page = await newTab();
  const readsOutside = new Map<string, { pages: Set<string>; requests: number }>();

  const pages: InventoryPage[] = [];
  const skipped: Inventory["skipped"] = [];
  const done = new Set<string>();
  // A site on the internet that embeds a window on this machine or a local network points into the network of whoever runs loep: that window is not visited and not in the scope.
  const privateFrames = new Set<string>();
  const noteFrame = (url: string, on: string): void => {
    if (!privateFromPublicSite(url, origins)) return note(url, `iframe:${on}`);
    if (privateFrames.has(url)) return;
    privateFrames.add(url);
    skipped.push({ url, reason: PRIVATE_FRAME_REASON });
    process.stderr.write(`inventory: ingesloten venster op een lokaal of privé-adres niet opgenomen en buiten de scope: ${url} (op ${on})\n`);
  };
  // Documents: found by a link or in the sitemap, never loaded here. A kind of null is decided by what the server says it sends.
  const documents = new Map<string, DocumentKind | null>();
  const elsewhere = new Map<string, DocumentKind>();
  const noteDocument = (url: string, kind: DocumentKind | null): void => {
    if (!documents.get(url)) documents.set(url, kind);
  };
  // Every link to an origin of the site with the pages it stands on: a document's `linkedFrom` is taken from it once all pages are known.
  const linksTo = new Map<string, InventoryDocument["linkedFrom"]>();
  // Addresses a link offers as a download (the `download` attribute): documents of any kind but HTML, which stays a page.
  const downloads = new Set<string>();
  // What the server said each page was, to tell a page from a download once every link is known.
  const pageTypes = new Map<string, string | null>();
  /** Addresses without a telling extension that turned out to be a document when the browser could not show them. */
  const probedAsDocument = new Map<string, DocumentProbe>();
  // HEAD requests during the crawl: for an address the browser could not show, or one a link offers as a download.
  let failedLoadsProbed = 0;
  const logoutLinks = new Set<string>();
  try {
    await confirmLogin(browser);
    // Pages visited per part of the site: the next address comes from the part with the fewest (see nextAddress).
    const visited = new Map<string, number>();
    let limitReached = false;
    for (;;) {
      let open = [...foundVia.keys()].filter((url) => !done.has(url));
      // With a fixed list the listed addresses go first; a frame found on them must not take their place under the limit.
      if (fixed && open.some((url) => fixed.includes(url))) open = open.filter((url) => fixed.includes(url));
      // Once the limit is reached, what is left is only sorted out (documents, skipped), and the order no longer matters.
      const next = pages.length >= options.maxPages ? open.sort()[0] : nextAddress(open, visited, origins);
      if (next === undefined) break;
      done.add(next);
      // A link that logs out is never followed: it would end the session for every page after it.
      if (login && (logoutLinks.has(next) || isLogout({ href: next }))) {
        logoutLinks.add(next);
        skipped.push({ url: next, reason: "logs out: not followed" });
        continue;
      }
      const kind = documentKind(next);
      if (kind) {
        noteDocument(next, kind);
        continue;
      }
      // Offered as a download: a document unless the server sends HTML. A type that stays unknown because nothing answered is a document too.
      if (downloads.has(next) && failedLoadsProbed++ < MAX_DOCUMENT_PROBES) {
        const probe = await probeDocument(next, origins);
        if (!isHtml(probe.contentType)) {
          noteDocument(next, kindOfContentType(probe.contentType));
          probedAsDocument.set(next, probe);
          continue;
        }
      }
      if (NON_PAGE.test(new URL(next).pathname)) {
        skipped.push({ url: next, reason: "not an HTML page" });
        continue;
      }
      if (pages.length >= options.maxPages) {
        if (!limitReached) process.stderr.write(`inventory: grens van ${options.maxPages} pagina's bereikt; de andere gevonden pagina's worden niet bezocht\n`);
        limitReached = true;
        skipped.push({ url: next, reason: pageLimitReason(options.maxPages) });
        continue;
      }
      noteVisited(visited, next, origins);
      const reads = new Map<string, number>();
      try {
        const tab = page;
        readsOfPage = reads;
        const result = await withinPageTime(PAGE_LIMIT_MS, () => inspect(tab, next, !missingPages.includes(next), downloads.has(next), origins), () => tab.close()).finally(() => {
          readsOfPage = null;
        });
        if ("document" in result) {
          noteDocument(next, result.document);
          continue;
        }
        const slug = slugForUrl(next);
        await writeFileAtomic(join(options.out, "pages", slug, "snapshot.txt"), result.snapshot);
        await writeFileAtomic(join(options.out, "pages", slug, "page.html"), result.html);
        const { links, frames, snapshot: _snapshot, html: _html, linksWithText: anchors, contentType, ...record } = result;
        pageTypes.set(next, contentType);
        for (const anchor of login ? anchors.filter(isLogout) : []) {
          logoutLinks.add(normaliseUrl(anchor.href));
          noteLogoutUrl(anchor.href);
        }
        for (const anchor of anchors) {
          const linked = documentKind(anchor.href);
          if (!ownOrigin(anchor.href)) {
            if (linked) elsewhere.set(anchor.href, linked);
            continue;
          }
          const target = normaliseUrl(anchor.href);
          if (linked) noteDocument(target, linked);
          // A browser honours `download` only on its own origin; there it makes the target a file to save, not a page.
          if (anchor.download !== null) downloads.add(target);
          const from = linksTo.get(target) ?? [];
          if (!from.some((link) => link.page === next && link.text === anchor.text)) from.push({ page: next, text: anchor.text, ...(anchor.download !== null ? { download: anchor.download } : {}) });
          linksTo.set(target, from);
        }
        const via = [...foundVia.get(next)!].sort();
        pages.push({ ...record, slug, foundVia: via });
        // An embedded frame is evaluated as a page of its own, but its own links are not followed.
        const embedded = via.every((entry) => entry.startsWith("iframe:"));
        // A frame opened on its own is no page of the site: what it reads elsewhere it may read in a session too.
        if (!embedded) {
          for (const [elsewhere, count] of reads) {
            const known = readsOutside.get(elsewhere) ?? { pages: new Set<string>(), requests: 0 };
            known.pages.add(next);
            known.requests += count;
            readsOutside.set(elsewhere, known);
          }
        }
        if (!embedded) for (const frame of frames) noteFrame(normaliseUrl(frame), next);
        if (!fixed && !embedded && !missingPages.includes(next)) for (const link of links) note(normaliseUrl(link), "link");
        process.stderr.write(`inventory ${pages.length} ${next}\n`);
      } catch (error) {
        if (error instanceof LoginExpired) throw error;
        // A page that failed may still keep its tab busy: the next page gets a fresh one.
        await page.close().catch(() => undefined);
        page = await newTab();
        // A download behind an address without an extension: the browser cannot show it, the server says what it is.
        const probe = ownOrigin(next) && failedLoadsProbed++ < MAX_DOCUMENT_PROBES ? await probeDocument(next, origins) : null;
        const probedKind = kindOfContentType(probe?.contentType ?? null);
        if (probe && (probedKind || (downloads.has(next) && !isHtml(probe.contentType)))) {
          noteDocument(next, probedKind);
          probedAsDocument.set(next, probe);
        } else if (ownOrigin(next) && startedDownload((error as Error).message)) {
          // The browser saved it as a file: a document whatever type the server names, also without a link that offers it for download.
          noteDocument(next, probedKind);
          if (probe) probedAsDocument.set(next, probe);
        } else skipped.push({ url: next, reason: `failed to load: ${(error as Error).message.split("\n")[0]}` });
      }
    }
    await confirmLogin(browser);
  } finally {
    await browser.close();
  }

  // A download that was visited as a page before the link that offers it was seen (from the sitemap, say) is a document all the same, unless it is HTML.
  const sentOtherThanHtml = (url: string): boolean => {
    const type = pageTypes.get(url) ?? null;
    return type !== null && !isHtml(type);
  };
  for (const entry of pages.filter((candidate) => downloads.has(candidate.url) && sentOtherThanHtml(candidate.url))) {
    noteDocument(entry.url, documentKind(entry.url));
    pages.splice(pages.indexOf(entry), 1);
  }

  const totals: Record<string, number> = {};
  for (const entry of pages) {
    for (const [key, value] of Object.entries(entry.counts)) {
      if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
    }
  }

  const found: InventoryDocument[] = [];
  let probes = 0;
  for (const [url, kind] of [...documents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { redirectsTo, ...probe }: DocumentProbe = probedAsDocument.get(url) ?? (probes++ < MAX_DOCUMENT_PROBES ? await probeDocument(url, origins) : { bytes: null, lastModified: null, contentType: null, status: null, notAsked: `meer dan ${MAX_DOCUMENT_PROBES} documenten: grootte en datum zijn alleen van de eerste ${MAX_DOCUMENT_PROBES} gevraagd` });
    // An address that redirects to a host outside the site, such as a security.txt kept elsewhere, is a document on another origin: counted, never fetched.
    if (redirectsTo !== undefined) {
      elsewhere.set(url, kind ?? documentKind(redirectsTo) ?? "other");
      continue;
    }
    const linkedFrom = [...(linksTo.get(url) ?? [])].sort((a, b) => a.page.localeCompare(b.page) || a.text.localeCompare(b.text));
    // A download whose address and answer name no kind the toolbox knows is counted all the same.
    found.push({ url, kind: kind ?? kindOfContentType(probe.contentType) ?? "other", slug: slugForUrl(url), linkedFrom, ...probe });
  }
  const documentTotals: DocumentTotals = { onSite: found.length, byKind: countByKind(found), elsewhere: elsewhere.size, elsewhereByKind: countByKind([...elsewhere.values()].map((kind) => ({ kind }))) };

  // A session lets through every host of the site and of a page in the inventory, whatever the port: only what lies outside that is refused.
  const runHosts = new Set([...origins, ...pages.map((entry) => entry.url)].map((url) => new URL(url).hostname));
  const readsOutsideRun: ReadOutsideRun[] = [...readsOutside]
    .filter(([elsewhere]) => !runHosts.has(new URL(elsewhere).hostname))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([elsewhere, known]) => ({ origin: elsewhere, pages: [...known.pages].sort(), requests: known.requests }));

  const result: Inventory = {
    baseUrl: start,
    origin,
    origins,
    sitemapUrls: sitemap.length,
    notFoundProbe,
    notFoundProbes: missingPages,
    pages: pages.sort((a, b) => a.url.localeCompare(b.url)),
    skipped: skipped.sort((a, b) => a.url.localeCompare(b.url)),
    totals,
    ...(options.vendor ? { vendor: options.vendor } : {}),
    documents: found,
    documentTotals,
    ...(login ? { logoutLinks: [...logoutLinks].sort() } : {}),
    readsOutsideRun,
  };
  await writeJson(join(options.out, "inventory.json"), result);
  await writeManifest(options.out, { command: "inventory", startedAt, baseUrl: start, maxPages: options.maxPages, fixedUrls: fixed?.length ?? null, ...(origins.length > 1 ? { alsoOrigins: origins.slice(1) } : {}), ...(login ? { loggedIn: true } : {}) }, browserVersion);
  return result;
}
