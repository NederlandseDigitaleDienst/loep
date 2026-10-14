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

export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
}

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

const NON_PAGE = /\.(pdf|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|zip|woff2?|ttf|mp4|mp3|docx?|xlsx?|pptx?|odt|csv)$/i;

/** Every link on the page with its text, through shadow roots. Which of them lead to a document is decided outside the page. */
function linksWithText(page: Page): Promise<{ href: string; text: string }[]> {
  return page.evaluate(() => {
    const found: { href: string; text: string }[] = [];
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
          found.push({ href: url.href, text: text.replace(/\s+/g, " ").trim().slice(0, 200) });
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

async function inspect(page: Page, url: string): Promise<Omit<InventoryPage, "foundVia" | "slug"> & { links: string[]; frames: string[]; snapshot: string; html: string; linksWithText: { href: string; text: string }[] }> {
  const loaded = await loadPage(page, url);
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
  // Documents: found by a link or in the sitemap, never loaded here.
  const documents = new Map<string, { kind: DocumentKind; linkedFrom: InventoryDocument["linkedFrom"] }>();
  const elsewhere = new Map<string, DocumentKind>();
  const noteDocument = (url: string, kind: DocumentKind): { kind: DocumentKind; linkedFrom: InventoryDocument["linkedFrom"] } => {
    if (!documents.has(url)) documents.set(url, { kind, linkedFrom: [] });
    return documents.get(url)!;
  };
  /** Addresses without a telling extension that turned out to be a document when the browser could not show them. */
  const probedAsDocument = new Map<string, Awaited<ReturnType<typeof probeDocument>>>();
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
      if (NON_PAGE.test(new URL(next).pathname)) {
        skipped.push({ url: next, reason: "not an HTML page" });
        continue;
      }
      if (pages.length >= options.maxPages) {
        skipped.push({ url: next, reason: `page limit of ${options.maxPages} reached` });
        continue;
      }
      try {
        const result = await inspect(page, next);
        const slug = slugForUrl(next);
        await writeFileAtomic(join(options.out, "pages", slug, "snapshot.txt"), result.snapshot);
        await writeFileAtomic(join(options.out, "pages", slug, "page.html"), result.html);
        const { links, frames, snapshot: _snapshot, html: _html, linksWithText: anchors, ...record } = result;
        for (const anchor of login ? anchors.filter(isLogout) : []) {
          logoutLinks.add(normaliseUrl(anchor.href));
          noteLogoutUrl(anchor.href);
        }
        for (const anchor of anchors) {
          const linked = documentKind(anchor.href);
          if (!linked) continue;
          if (new URL(anchor.href).origin !== origin) elsewhere.set(anchor.href, linked);
          else {
            const entry = noteDocument(normaliseUrl(anchor.href), linked);
            if (!entry.linkedFrom.some((link) => link.page === next && link.text === anchor.text)) entry.linkedFrom.push({ page: next, text: anchor.text });
          }
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
        if (probe && probedKind) {
          noteDocument(next, probedKind);
          probedAsDocument.set(next, probe);
        } else skipped.push({ url: next, reason: `failed to load: ${(error as Error).message.split("\n")[0]}` });
      }
    }
    await confirmLogin(browser);
  } finally {
    await browser.close();
  }

  const totals: Record<string, number> = {};
  for (const entry of pages) {
    for (const [key, value] of Object.entries(entry.counts)) {
      if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
    }
  }

  const found: InventoryDocument[] = [];
  let probes = 0;
  for (const [url, entry] of [...documents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const probe = probedAsDocument.get(url) ?? (probes++ < MAX_DOCUMENT_PROBES ? await probeDocument(url, origin) : { bytes: null, lastModified: null, contentType: null, status: null, notAsked: `meer dan ${MAX_DOCUMENT_PROBES} documenten: grootte en datum zijn alleen van de eerste ${MAX_DOCUMENT_PROBES} gevraagd` });
    found.push({ url, kind: entry.kind, slug: slugForUrl(url), linkedFrom: entry.linkedFrom.sort((a, b) => a.page.localeCompare(b.page) || a.text.localeCompare(b.text)), ...probe });
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
