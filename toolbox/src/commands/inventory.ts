import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { confirmLogin, INPAGE_PATH, launchBrowser, loadPage, newContext } from "../browser/session.ts";
import { sha256, slugForUrl, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { countByKind, documentKind, kindOfContentType, type DocumentKind, type DocumentTotals, type InventoryDocument } from "../lib/documents.ts";
import type { Vendor } from "../lib/evaluation.ts";
import { isLogout, loginCookieHeader, LoginExpired, noteLogoutUrl, runLoginMark } from "../lib/login.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";

export interface InventoryPage {
  url: string;
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
  /** The widths the stylesheets name in a media or container query, for the explorer. Absent in older runs. */
  breakpoints?: number[];
}

export interface Inventory {
  baseUrl: string;
  origin: string;
  sitemapUrls: number;
  notFoundProbe: string;
  pages: InventoryPage[];
  skipped: { url: string; reason: string }[];
  /** Site-wide totals of the features whose absence makes a criterion "not applicable". */
  totals: Record<string, number>;
  /** Whose components the site is built with, when the one who started the run said so. */
  vendor?: Vendor;
  /** Documents on the origin of the run that a page links to or the sitemap names. Absent in older runs. */
  documents?: InventoryDocument[];
  /** How many documents there are, here and on other origins. Absent in older runs. */
  documentTotals?: DocumentTotals;
  /** Only in a run with a login: the addresses of links that log out. None was followed, and no browser of the run asks for them. */
  logoutLinks?: string[];
}

export interface InventoryOptions {
  baseUrl: string;
  out: string;
  maxPages: number;
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
export function formPagesNl(pages: Pick<InventoryPage, "url" | "counts" | "foundVia">[], origin: string, writesAllowed: boolean): string | null {
  if (writesAllowed) return null;
  const forms = (entry: (typeof pages)[number]): number => (typeof entry.counts.forms === "number" ? entry.counts.forms : 0);
  const isFrame = (entry: (typeof pages)[number]): boolean => entry.foundVia.length > 0 && entry.foundVia.every((via) => via.startsWith("iframe:"));
  const own = pages.filter((entry) => !isFrame(entry));
  const everywhere = own.length > 0 ? Math.min(...own.map(forms)) : 0;
  const withForm = own.filter((entry) => forms(entry) > everywhere).map((entry) => entry.url);
  const frames = pages.filter((entry) => isFrame(entry) && new URL(entry.url).origin !== origin && forms(entry) > 0).map((entry) => entry.url);
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

export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
}

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
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
  });
}

/** Documents asked for their size and date; beyond this they are recorded without. */
export const MAX_DOCUMENT_PROBES = 300;
const PROBE_TIMEOUT_MS = 8000;

/** One HEAD request: size, date and type as the server gives them. Redirects are followed only inside the origin. */
export async function probeDocument(url: string, origin: string): Promise<Pick<InventoryDocument, "bytes" | "lastModified" | "contentType" | "status" | "notAsked">> {
  const nothing = { bytes: null, lastModified: null, contentType: null, status: null };
  let address = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (new URL(address).origin !== origin) return { ...nothing, notAsked: "het adres verwijst door naar een ander domein" };
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

type Inspected = Omit<InventoryPage, "foundVia" | "slug"> & { links: string[]; frames: string[]; snapshot: string; html: string; linksWithText: Anchor[]; contentType: string | null };

/**
 * A page as the browser shows it, or the kind of document the server sent instead of HTML.
 * `offered`: a link offers the address as a download; then anything but HTML is a document.
 */
async function inspect(page: Page, url: string, mayBeDocument: boolean, offered: boolean): Promise<Inspected | { document: DocumentKind }> {
  const loaded = await loadPage(page, url);
  // A browser shows plain text as a page of its own, a bare `<pre>` without language or title. It is a document, not a page.
  const sent = mayBeDocument ? kindOfContentType(loaded.contentType) : null;
  if (sent) return { document: sent };
  if (mayBeDocument && offered && loaded.contentType !== null && !isHtml(loaded.contentType)) return { document: "other" };
  const html = await page.content();
  const result = await page.evaluate(() => {
    const loep = (window as unknown as { __loep: Record<string, () => unknown> }).__loep;
    const facts = loep.collectFacts!() as { title: string; lang: string | null; counts: Record<string, unknown> };
    return {
      title: facts.title,
      lang: facts.lang,
      counts: facts.counts,
      template: loep.templateSignature!() as string,
      snapshot: loep.contentSnapshot!() as string,
      links: loep.sameOriginLinks!() as string[],
      frames: loep.frameSources!() as string[],
      breakpoints: loep.layoutBreakpoints!() as number[],
    };
  });
  return {
    url,
    status: loaded.status,
    title: result.title,
    lang: result.lang,
    templateHash: sha256(result.template).slice(0, 12),
    contentHash: sha256(result.snapshot),
    counts: result.counts,
    breakpoints: result.breakpoints,
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
  const origin = new URL(options.baseUrl).origin;
  const start = normaliseUrl(options.baseUrl);
  const fixed = options.fixedUrls?.map(normaliseUrl);
  // A run with a login: the session a person left behind, and the page that person pointed at.
  const login = runLoginMark();
  if (login && login.origin !== origin) throw new Error(`de inlogsessie van deze run is voor ${login.origin}, niet voor ${origin}`);
  // Behind a login there is no sitemap to go by: the pages are found by following links with the session.
  const sitemap = fixed || login ? [] : await fetchSitemapUrls(origin);
  const notFoundProbe = `${origin}${NOT_FOUND_PATH}`;

  const foundVia = new Map<string, Set<string>>();
  const note = (url: string, via: string): void => {
    if (!foundVia.has(url)) foundVia.set(url, new Set());
    foundVia.get(url)!.add(via);
  };
  if (fixed) for (const url of fixed) note(url, "fixed-list");
  else {
    note(start, "start");
    if (login) note(normaliseUrl(login.landingUrl), "start");
    for (const url of sitemap) note(url, "sitemap");
    note(notFoundProbe, "404-probe");
  }

  const browser = await launchBrowser();
  const browserVersion = browser.version();
  const context: BrowserContext = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();

  const pages: InventoryPage[] = [];
  const skipped: Inventory["skipped"] = [];
  const done = new Set<string>();
  // Documents: found by a link or in the sitemap, never loaded here. A kind of null is decided by what the server says it sends.
  const documents = new Map<string, DocumentKind | null>();
  const elsewhere = new Map<string, DocumentKind>();
  const noteDocument = (url: string, kind: DocumentKind | null): void => {
    if (!documents.get(url)) documents.set(url, kind);
  };
  // Every link to the origin with the pages it stands on: a document's `linkedFrom` is taken from it once all pages are known.
  const linksTo = new Map<string, InventoryDocument["linkedFrom"]>();
  // Addresses a link offers as a download (the `download` attribute): documents of any kind but HTML, which stays a page.
  const downloads = new Set<string>();
  // What the server said each page was, to tell a page from a download once every link is known.
  const pageTypes = new Map<string, string | null>();
  /** Addresses without a telling extension that turned out to be a document when the browser could not show them. */
  const probedAsDocument = new Map<string, Awaited<ReturnType<typeof probeDocument>>>();
  // HEAD requests during the crawl: for an address the browser could not show, or one a link offers as a download.
  let failedLoadsProbed = 0;
  const logoutLinks = new Set<string>();
  try {
    await confirmLogin(browser);
    // Sorted breadth-first: the visiting order never depends on timing.
    for (;;) {
      const next = [...foundVia.keys()].filter((url) => !done.has(url)).sort()[0];
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
        const probe = await probeDocument(next, origin);
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
        skipped.push({ url: next, reason: `page limit of ${options.maxPages} reached` });
        continue;
      }
      try {
        const result = await inspect(page, next, next !== notFoundProbe, downloads.has(next));
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
          if (new URL(anchor.href).origin !== origin) {
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
        if (!embedded) for (const frame of frames) note(normaliseUrl(frame), `iframe:${next}`);
        if (!fixed && !embedded && next !== notFoundProbe) for (const link of links) note(normaliseUrl(link), "link");
        process.stderr.write(`inventory ${pages.length} ${next}\n`);
      } catch (error) {
        if (error instanceof LoginExpired) throw error;
        // A download behind an address without an extension: the browser cannot show it, the server says what it is.
        const probe = new URL(next).origin === origin && failedLoadsProbed++ < MAX_DOCUMENT_PROBES ? await probeDocument(next, origin) : null;
        const probedKind = kindOfContentType(probe?.contentType ?? null);
        if (probe && (probedKind || (downloads.has(next) && !isHtml(probe.contentType)))) {
          noteDocument(next, probedKind);
          probedAsDocument.set(next, probe);
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
    const probe = probedAsDocument.get(url) ?? (probes++ < MAX_DOCUMENT_PROBES ? await probeDocument(url, origin) : { bytes: null, lastModified: null, contentType: null, status: null, notAsked: `meer dan ${MAX_DOCUMENT_PROBES} documenten: grootte en datum zijn alleen van de eerste ${MAX_DOCUMENT_PROBES} gevraagd` });
    const linkedFrom = [...(linksTo.get(url) ?? [])].sort((a, b) => a.page.localeCompare(b.page) || a.text.localeCompare(b.text));
    // A download whose address and answer name no kind the toolbox knows is counted all the same.
    found.push({ url, kind: kind ?? kindOfContentType(probe.contentType) ?? "other", slug: slugForUrl(url), linkedFrom, ...probe });
  }
  const documentTotals: DocumentTotals = { onSite: found.length, byKind: countByKind(found), elsewhere: elsewhere.size, elsewhereByKind: countByKind([...elsewhere.values()].map((kind) => ({ kind }))) };

  const result: Inventory = {
    baseUrl: start,
    origin,
    sitemapUrls: sitemap.length,
    notFoundProbe,
    pages: pages.sort((a, b) => a.url.localeCompare(b.url)),
    skipped: skipped.sort((a, b) => a.url.localeCompare(b.url)),
    totals,
    ...(options.vendor ? { vendor: options.vendor } : {}),
    documents: found,
    documentTotals,
    ...(login ? { logoutLinks: [...logoutLinks].sort() } : {}),
  };
  await writeJson(join(options.out, "inventory.json"), result);
  await writeManifest(options.out, { command: "inventory", startedAt, baseUrl: start, maxPages: options.maxPages, fixedUrls: fixed?.length ?? null, ...(login ? { loggedIn: true } : {}) }, browserVersion);
  return result;
}
