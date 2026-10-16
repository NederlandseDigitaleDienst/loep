import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addressLevels, inventory, nextAddress, noteVisited, pageLimitNl, pageLimitReason, type Inventory } from "../src/commands/inventory.ts";

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
