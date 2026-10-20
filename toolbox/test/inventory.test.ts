import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture } from "../fixtures/serve.ts";
import { addressLevels, inventory, nextAddress, noteVisited, pageLimitNl, pageLimitReason, type Inventory } from "../src/commands/inventory.ts";
import { buildSample } from "../src/commands/sample.ts";

/** Visit every candidate in the order `inventory` would, when all are known from the start. */
function visitOrder(urls: string[], limit: number): string[] {
  const visited = new Map<string, number>();
  const open = new Set(urls);
  const order: string[] = [];
  while (order.length < limit) {
    const next = nextAddress(open, visited);
    if (next === undefined) break;
    open.delete(next);
    noteVisited(visited, next);
    order.push(next);
  }
  return order;
}

const site = "https://example.test";

test("a query is one level below the path it belongs to", () => {
  assert.deepEqual(addressLevels(`${site}/`), []);
  assert.deepEqual(addressLevels(`${site}/blog/`), ["blog"]);
  assert.deepEqual(addressLevels(`${site}/blog/tag/a?page=2`), ["blog", "tag", "a", "?page=2"]);
});

test("the order takes turns between the parts of the site, and a part full of tags waits within its part", () => {
  const blog = [`${site}/blog/`, `${site}/blog/eerste`, `${site}/blog/tweede`, ...Array.from({ length: 20 }, (_, index) => `${site}/blog/tag/t${index}`), ...Array.from({ length: 20 }, (_, index) => `${site}/blog/tag/t1/page/${index + 2}`)];
  const knowledge = ["a", "b", "c"].flatMap((theme) => [`${site}/kennisbank/${theme}/`, ...Array.from({ length: 5 }, (_, index) => `${site}/kennisbank/${theme}/artikel-${index}`)]);
  const order = visitOrder([`${site}/`, `${site}/contact`, ...blog, ...knowledge], 13);
  assert.equal(order[0], `${site}/`, "the start, with no path, goes first");
  const inPart = (prefix: string): string[] => order.filter((url) => url.startsWith(`${site}${prefix}`));
  assert.equal(inPart("/contact").length, 1);
  assert.equal(inPart("/blog/").length, 5, "the blog gets its share and no more");
  assert.equal(inPart("/kennisbank/").length, 6, "the knowledge base, later in the alphabet, gets its share too");
  assert.deepEqual(inPart("/blog/").slice(0, 3), [`${site}/blog/`, `${site}/blog/eerste`, `${site}/blog/tweede`], "within the blog, the posts go before the tags");
  assert.ok(!order.some((url) => url.includes("/page/")), "no page of a list while there are other pages to see");
  assert.deepEqual(inPart("/kennisbank/").map((url) => url.split("/")[4]).sort(), ["a", "a", "b", "b", "c", "c"], "each theme of the knowledge base comes in");
  assert.deepEqual(visitOrder([...knowledge].reverse(), 99), visitOrder(knowledge, 99), "the order does not depend on the order in which addresses were found");
});

test("the warning about the limit names per part what was visited and what was left out", () => {
  const page = (path: string): Inventory["pages"][number] => ({ url: `${site}${path}`, slug: path, status: 200, title: "", lang: "nl", templateHash: "", contentHash: "", foundVia: ["link"], counts: {} });
  const found = {
    origin: site,
    notFoundProbe: `${site}/bestaat-niet`,
    pages: [page("/"), page("/bestaat-niet"), page("/blog/"), page("/blog/tag/a"), page("/kennisbank/"), page("/kennisbank/a/")],
    skipped: [
      ...["/blog/tag/b", "/blog/tag/c", "/blog/tag/d", "/kennisbank/a/x"].map((path) => ({ url: `${site}${path}`, reason: pageLimitReason(6) })),
      { url: `${site}/plaatje.png`, reason: "not an HTML page" },
    ],
  };
  const said = pageLimitNl(found, 6)!;
  assert.match(said, /^LET OP: de grens van 6 pagina's \(--max-pages\) is bereikt\. 4 gevonden pagina's zijn niet bezocht/);
  assert.match(said, /\n  \/blog +2 bezocht, +3 weggelaten\n/);
  assert.match(said, /\n  \/kennisbank +2 bezocht, +1 weggelaten\n/);
  assert.match(said, /\n  \/ +1 bezocht, +0 weggelaten\n/);
  assert.ok(!said.includes("bestaat-niet"), "the probe for a missing page is not a part of the site");
  assert.match(said, /hogere --max-pages of met --urls\.$/);
  assert.equal(pageLimitNl({ ...found, skipped: found.skipped.slice(4) }, 6), null, "without the limit there is nothing to say");

  const many = { ...found, skipped: Array.from({ length: 15 }, (_, index) => ({ url: `${site}/deel-${String(index).padStart(2, "0")}/pagina`, reason: pageLimitReason(6) })) };
  assert.match(pageLimitNl(many, 6)!, /\n  en 6 andere gedeelten: samen 0 bezocht, 6 weggelaten\n/, "beyond twelve parts the rest is summed up");
});

// A site like the one that showed the problem: a blog first in the alphabet, full of tag pages and their pages, and a knowledge base after it.
const POSTS = 4;
const TAGS = 10;
const TAG_PAGES = 4;
const THEMES = ["thema-a", "thema-b", "thema-c"];
const ARTICLES = 6;

function html(title: string, links: string[]): string {
  return `<!doctype html><html lang="nl"><head><title>${title}</title></head><body><main><h1>${title}</h1><ul>${links.map((href) => `<li><a href="${href}">${href}</a></li>`).join("")}</ul></main></body></html>`;
}

const tagLinks = Array.from({ length: TAGS }, (_, index) => `/blog/tag/t${index}`);
const PAGES: Record<string, string> = {
  "/": html("Start", ["/blog/", "/kennisbank/", "/contact"]),
  "/contact": html("Contact", ["/"]),
  "/blog/": html("Blog", Array.from({ length: POSTS }, (_, index) => `/blog/bericht-${index}`)),
  "/kennisbank/": html("Kennisbank", THEMES.map((theme) => `/kennisbank/${theme}/`)),
};
for (let index = 0; index < POSTS; index++) PAGES[`/blog/bericht-${index}`] = html(`Bericht ${index}`, tagLinks);
for (const tag of tagLinks) {
  PAGES[tag] = html(tag, [...Array.from({ length: TAG_PAGES }, (_, index) => `${tag}/page/${index + 2}`), "/blog/bericht-0"]);
  for (let index = 0; index < TAG_PAGES; index++) PAGES[`${tag}/page/${index + 2}`] = html(`${tag} pagina ${index + 2}`, [tag]);
}
for (const theme of THEMES) {
  PAGES[`/kennisbank/${theme}/`] = html(theme, Array.from({ length: ARTICLES }, (_, index) => `/kennisbank/${theme}/artikel-${index}`));
  for (let index = 0; index < ARTICLES; index++) PAGES[`/kennisbank/${theme}/artikel-${index}`] = html(`Artikel ${index}`, [`/kennisbank/${theme}/`]);
}

let server: Server;
let origin: string;
let scratch: string;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-inventory-"));
  server = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    if (path === "/sitemap.xml") {
      // The sitemap names the posts and the articles; tags and their pages are found only by links.
      const named = Object.keys(PAGES).filter((key) => !key.includes("/tag/"));
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset>${named.map((key) => `<url><loc>${origin}${key}</loc></url>`).join("")}</urlset>`);
    } else if (PAGES[path]) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGES[path]);
    } else {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(html("Niet gevonden", ["/"]));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => void server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

test("at the limit the inventory covers the site in its breadth and says per part what was left out", async (context) => {
  const maxPages = 24;
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${origin}/`, out: join(scratch, "run"), maxPages });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  assert.equal(found.pages.length, maxPages);
  // What estimate reckons the sweep with: how long each page took to load, and what there is to operate on it.
  assert.ok(found.pages.every((page) => typeof page.loadMs === "number" && page.loadMs > 0 && typeof page.operable?.links === "number" && typeof page.operable.controls === "number"));
  assert.ok(found.pages.some((page) => page.operable!.links > 0), "the pages link to each other");
  const visited = found.pages.map((page) => new URL(page.url).pathname);
  const knowledge = visited.filter((path) => path.startsWith("/kennisbank/"));
  const blog = visited.filter((path) => path.startsWith("/blog/"));
  assert.ok(knowledge.length >= 9, `the knowledge base gets its share: ${knowledge.length} of ${maxPages}`);
  assert.ok(blog.length <= 11, `the blog does not fill the limit: ${blog.length} of ${maxPages}`);
  for (const theme of THEMES) assert.ok(visited.some((path) => path.startsWith(`/kennisbank/${theme}/artikel-`)), `an article of ${theme} is visited`);
  assert.ok(!visited.some((path) => path.includes("/page/")), "no page of a tag while there are other pages to see");
  assert.ok(visited.includes("/contact"));

  const omitted = found.skipped.filter((entry) => entry.reason === pageLimitReason(maxPages));
  assert.ok(omitted.length > 0);
  const said = pageLimitNl(found, maxPages)!;
  assert.match(said, /^LET OP: de grens van 24 pagina's/);
  const line = (section: string): RegExpMatchArray | null => said.match(new RegExp(`\\n  ${section.replace("/", "\\/")} +(\\d+) bezocht, +(\\d+) weggelaten`));
  assert.equal(Number(line("/kennisbank")![1]), knowledge.length);
  assert.equal(Number(line("/blog")![1]), blog.length);
  assert.equal(Number(line("/blog")![2]) + Number(line("/kennisbank")![2]), omitted.length, "every page left out is counted in its part");
});

/** A small site on its own port: a page per path, a sitemap, a 404 page, and a pdf that answers HEAD. */
async function serveSite(pages: (origin: string) => Record<string, string>, sitemap: string[] = []): Promise<{ origin: string; asked: string[]; close: () => Promise<void> }> {
  const asked: string[] = [];
  let origin = "";
  const site = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    asked.push(path);
    const known = pages(origin);
    if (path === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset>${sitemap.map((key) => `<url><loc>${origin}${key}</loc></url>`).join("")}</urlset>`);
    } else if (path.endsWith(".pdf")) {
      response.writeHead(200, { "content-type": "application/pdf", "content-length": "1234" });
      response.end(request.method === "HEAD" ? undefined : "%PDF-1.4");
    } else if (known[path]) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(known[path]);
    } else {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(html(`Niet gevonden op ${origin}`, ["/"]));
    }
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  return { origin, asked, close: () => new Promise<void>((resolve) => void site.close(() => resolve())) };
}

test("a site on two origins is one inventory: both start pages, both sitemaps, links between them, a 404 page and documents on each, and nothing of an origin not given", async (context) => {
  // Three ports are three origins: the site, its documentation, and a blog that is not part of the site.
  const blog = await serveSite(() => ({ "/": html("Blog", []), "/bericht": html("Bericht", []) }));
  let docsOrigin = "";
  const site = await serveSite((origin) => ({
    "/": html("Start", ["/over", `${docsOrigin}/handleiding/`, `${blog.origin}/bericht`, "/jaarverslag.pdf"]),
    "/over": html("Over", [`${origin}/`]),
  }));
  const docs = await serveSite(
    () => ({
      "/": html("Documentatie", ["/handleiding/", `${site.origin}/over`]),
      "/handleiding/": html("Handleiding", ["/handleiding/installeren", "/handleiding/naslag.pdf"]),
      "/handleiding/installeren": html("Installeren", ["/"]),
      "/alleen-in-sitemap": html("Alleen in de sitemap", []),
    }),
    ["/alleen-in-sitemap"],
  );
  docsOrigin = docs.origin;
  context.after(async () => {
    await Promise.all([blog.close(), site.close(), docs.close()]);
  });
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${site.origin}/`, out: join(scratch, "two-origins"), maxPages: 50, alsoOrigins: [`${docs.origin}/handleiding/`] });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  assert.equal(found.origin, site.origin);
  assert.deepEqual(found.origins, [site.origin, docs.origin], "the origins of the site, the start address first; a path given with --also-origin is dropped");
  const urls = found.pages.map((page) => page.url);
  for (const url of [`${site.origin}/`, `${site.origin}/over`, `${docs.origin}/`, `${docs.origin}/handleiding/`, `${docs.origin}/handleiding/installeren`, `${docs.origin}/alleen-in-sitemap`]) assert.ok(urls.includes(url), `${url} is a page of the site`);
  assert.ok(!urls.some((url) => url.startsWith(blog.origin)), "an origin that was not given stays outside");
  assert.deepEqual(blog.asked, [], "nothing is asked of an origin that was not given");
  assert.deepEqual(found.notFoundProbes, [found.notFoundProbe, `${docs.origin}/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek`]);
  assert.ok(found.notFoundProbes!.every((probe) => urls.includes(probe)), "the page for a missing address is visited on each origin");
  assert.ok(found.pages.find((page) => page.url === `${docs.origin}/`)!.foundVia.includes("start"), "each further origin starts at its own start page");
  assert.ok(found.pages.find((page) => page.url === `${docs.origin}/handleiding/installeren`)!.foundVia.includes("link"), "links within a further origin are followed");
  assert.ok(found.pages.find((page) => page.url === `${docs.origin}/alleen-in-sitemap`)!.foundVia.includes("sitemap"), "the sitemap of each origin is read");
  assert.equal(found.sitemapUrls, 1);
  assert.deepEqual(found.documents!.map((document) => document.url).sort(), [`${docs.origin}/handleiding/naslag.pdf`, `${site.origin}/jaarverslag.pdf`].sort(), "documents on either origin are documents of the site");
  assert.ok(found.documents!.every((document) => document.bytes === 1234), "each was asked for its size");
  assert.equal(found.documentTotals!.elsewhere, 0);
});

test("an address that redirects to an anchor on a page of the site is recorded with where it lands, and the sample measures the page itself", async (context) => {
  const statement = html("Verklaring", ["/"]).replace("</main>", '<h2 id="account">Account</h2></main>');
  const site = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    if (path === "/aan-de-slag/hulp") return void response.writeHead(302, { location: "/verklaring#account" }).end();
    const known: Record<string, string> = { "/": html("Start", ["/aan-de-slag/hulp", "/verklaring", "/wetten/verklaring"]), "/verklaring": statement, "/wetten/verklaring": statement };
    response.writeHead(known[path] ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    response.end(known[path] ?? html("Niet gevonden", ["/"]));
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => void site.close(() => resolve())));
  const at = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${at}/`, out: join(scratch, "redirect"), maxPages: 10 });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  const of = (path: string) => found.pages.find((page) => page.url === `${at}${path}`)!;
  assert.equal(of("/aan-de-slag/hulp").finalUrl, `${at}/verklaring#account`, "where the browser landed, anchor and all");
  assert.equal(of("/aan-de-slag/hulp").status, 200);
  assert.equal(of("/verklaring").finalUrl, undefined, "a page the browser stays on records nothing more");
  assert.equal(of("/aan-de-slag/hulp").contentHash, of("/verklaring").contentHash, "the same page under three addresses");
  assert.equal(of("/wetten/verklaring").contentHash, of("/verklaring").contentHash);
  const item = buildSample(found, "seed").items.find((entry) => entry.contentHash === of("/verklaring").contentHash)!;
  assert.equal(item.url, `${at}/verklaring`, "not the address that redirects, though it comes first in the alphabet");
  assert.equal(item.slug, of("/verklaring").slug);
  assert.deepEqual(item.aliases, [`${at}/aan-de-slag/hulp`, `${at}/wetten/verklaring`]);
});

test("a page with a link whose address Chromium accepts and Node does not is still a page, and its other links are followed", async (context) => {
  const statement = html("Verklaring", ["/"]).replace("</main>", '<a href="http://www.example.nl&nbsp; via">site</a><a href="/contact">Contact</a></main>');
  const site = createServer((request, response) => {
    const path = new URL(request.url!, "http://x").pathname;
    const known: Record<string, string> = { "/": html("Start", ["/verklaring"]), "/verklaring": statement, "/contact": html("Contact", ["/"]) };
    response.writeHead(known[path] ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    response.end(known[path] ?? html("Niet gevonden", ["/"]));
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => void site.close(() => resolve())));
  const at = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  let found: Inventory;
  try {
    found = await inventory({ baseUrl: `${at}/`, out: join(scratch, "invalid-link"), maxPages: 10 });
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
    throw error;
  }
  assert.ok(found.pages.some((page) => page.url === `${at}/verklaring`), "the page with the broken link is in the inventory");
  assert.ok(found.pages.some((page) => page.url === `${at}/contact`), "a link after the broken one is followed");
});


test("with a fixed list every listed page goes before a frame found on one, also when the frame's server has the lower port", async (context) => {
  const free: number[] = [];
  for (let count = 0; count < 3; count++) {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    free.push((probe.address() as { port: number }).port);
    await new Promise<void>((resolve) => void probe.close(() => resolve()));
  }
  free.sort((a, b) => a - b);
  const fixture = await startFixture({ ports: { thirdParty: free[0]!, clean: free[1]!, defect: free[2]! }, logFile: join(scratch, "fixture.log") });
  try {
    const clean = fixture.origins.clean;
    const listed = [`${clean}/afval.html`, `${clean}/contact.html`];
    let found: Inventory;
    try {
      found = await inventory({ baseUrl: `${clean}/`, out: join(scratch, "fixed"), maxPages: 2, fixedUrls: listed });
    } catch (error) {
      if (/Executable doesn't exist|browserType.launch/.test((error as Error).message)) return context.skip("no browser available");
      throw error;
    }
    assert.deepEqual(found.pages.map((page) => page.url).sort(), listed);
    assert.ok(found.skipped.some((entry) => entry.url === `${fixture.origins.thirdParty}/leeg.html` && entry.reason === pageLimitReason(2)), "the frame is left out by the limit");
  } finally {
    await fixture.close();
  }
});
