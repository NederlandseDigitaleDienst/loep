import assert from "node:assert/strict";
import { test } from "node:test";
import { documentOutOfReach } from "../src/commands/compare-findings.ts";
import { redactor } from "../src/commands/feedback.ts";
import { formPagesNl, pageLimitNl, pageLimitReason, type Inventory, type InventoryPage } from "../src/commands/inventory.ts";
import { buildSample } from "../src/commands/sample.ts";
import { documentScopeNl } from "../src/lib/documents.ts";
import { notFoundProbes, originsNl, originsOfRun, pagesInScopeNl, parseOrigin, siteHosts, siteLabel, siteOrigins } from "../src/lib/origins.ts";
import { otherDomains } from "../src/lib/statement.ts";

const main = "https://example.nl";
const docs = "https://docs.example.nl";

test("the origins of a site come from origins, and an older run without them has its one origin", () => {
  assert.deepEqual(siteOrigins({ origin: main, origins: [main, docs] }), [main, docs]);
  assert.deepEqual(siteOrigins({ origin: main }), [main], "an inventory from before --also-origin");
  assert.deepEqual(siteOrigins({ baseUrl: `${main}/start` }), [main], "the site of an evaluation on one origin");
  assert.deepEqual(siteOrigins({ baseUrl: `${main}/`, origins: [main, docs] }), [main, docs], "the site of an evaluation on two");
  assert.deepEqual(siteOrigins({ origin: main, origins: [] }), [main], "an empty list is no list");
  assert.deepEqual(siteOrigins({ baseUrl: "geen adres" }), []);
  assert.deepEqual(siteHosts({ origins: ["http://127.0.0.1:4710", "http://127.0.0.1:4711"] }), ["127.0.0.1:4710", "127.0.0.1:4711"], "a host keeps its port");
  assert.equal(siteLabel({ origins: [main, docs] }), "example.nl en docs.example.nl");
  assert.equal(siteLabel({ baseUrl: `${main}/` }), "example.nl");
  assert.equal(originsNl([main, docs, "https://help.example.nl"]), "https://example.nl, https://docs.example.nl en https://help.example.nl");
  assert.deepEqual(notFoundProbes({ notFoundProbe: `${main}/x` }), [`${main}/x`]);
  assert.deepEqual(notFoundProbes({ notFoundProbe: `${main}/x`, notFoundProbes: [`${main}/x`, `${docs}/x`] }), [`${main}/x`, `${docs}/x`]);
});

test("the origins given at inventory are scheme, host and port, each once, the start address first", () => {
  assert.equal(parseOrigin("https://docs.example.nl/handleiding/"), docs, "a path is dropped");
  assert.equal(parseOrigin("http://127.0.0.1:4711"), "http://127.0.0.1:4711");
  assert.throws(() => parseOrigin("docs.example.nl"), /--also-origin "docs\.example\.nl" is geen adres/);
  assert.throws(() => parseOrigin("ftp://docs.example.nl"), /geen adres met http:\/\/ of https:\/\//);
  assert.deepEqual(originsOfRun(`${main}/start`, [docs, `${docs}/x`, main]), [main, docs]);
  assert.deepEqual(originsOfRun(`${main}/`), [main]);
});

test("the scope names every origin of the site, documents too", () => {
  assert.equal(pagesInScopeNl([main]), "Alle pagina's op https://example.nl", "one origin reads as it always did");
  assert.equal(pagesInScopeNl([main, docs]), "Alle pagina's op https://example.nl en https://docs.example.nl");
  const documents = { onSite: 2, byKind: { pdf: 2 }, elsewhere: 0, notChosen: 0, notChosenByKind: {}, criteria: ["1.1.1"], items: [] };
  assert.match(documentScopeNl(documents, [main, docs], 0).includedNl[0]!, /^Documenten op https:\/\/example\.nl en https:\/\/docs\.example\.nl \(pdf/);
  assert.match(documentScopeNl(documents, main, 0).includedNl[0]!, /^Documenten op https:\/\/example\.nl \(pdf/);
});

test("the statement names the further origins as domains of the website, before what the input adds", () => {
  const site = { name: "Voorbeeld", baseUrl: `${main}/`, organisation: null };
  assert.deepEqual(otherDomains({ site }, {}), []);
  assert.deepEqual(otherDomains({ site: { ...site, origins: [main, docs] } }, { subdomains: ["https://help.example.nl", docs] }), [docs, "https://help.example.nl"]);
});

test("a document on a further origin of the site is within reach; one on another subdomain is not", () => {
  const finding = (page: string) => ({ id: "R", criterion: "1.1.1", page, descriptionNl: "Een gebrek in een document", medium: "document" as const });
  assert.match(documentOutOfReach(finding(`${docs}/handleiding.pdf`), `${main}/`, ["1.1.1"])!, /ander domein/, "a run on one origin");
  assert.equal(documentOutOfReach(finding(`${docs}/handleiding.pdf`), `${main}/`, ["1.1.1"], [main, docs]), null);
  assert.match(documentOutOfReach(finding("https://blog.example.nl/a.pdf"), `${main}/`, ["1.1.1"], [main, docs])!, /ander domein/);
});

test("a form in a frame on a further origin is a form of the site, not of another address", () => {
  const page = (url: string, forms: number, via = "link"): Pick<InventoryPage, "url" | "counts" | "foundVia"> => ({ url, counts: { forms }, foundVia: [via] });
  const pages = [page(`${main}/`, 0), page(`${main}/b`, 0), page(`${docs}/zoek`, 1, `iframe:${main}/b`)];
  assert.match(formPagesNl(pages, main, false)!, /ingesloten venster op een ander adres/);
  assert.equal(formPagesNl(pages, [main, docs], false), null);
});

test("the warning about the limit names the parts per origin on a site with more than one", () => {
  const page = (url: string): InventoryPage => ({ url, slug: url, status: 200, title: "", lang: "nl", templateHash: "", contentHash: url, foundVia: ["link"], counts: {} });
  const found = {
    origin: main,
    origins: [main, docs],
    notFoundProbe: `${main}/bestaat-niet`,
    notFoundProbes: [`${main}/bestaat-niet`, `${docs}/bestaat-niet`],
    pages: [page(`${main}/`), page(`${main}/bestaat-niet`), page(`${docs}/bestaat-niet`), page(`${main}/nieuws/a`), page(`${docs}/`), page(`${docs}/api/b`)],
    skipped: [`${main}/nieuws/b`, `${docs}/api/c`, `${docs}/api/d`].map((url) => ({ url, reason: pageLimitReason(6) })),
  };
  const said = pageLimitNl(found, 6)!;
  assert.match(said, /Per gedeelte \(de origin en het eerste deel van het pad\):/);
  assert.match(said, /\n  https:\/\/docs\.example\.nl\/api +1 bezocht, +2 weggelaten\n/);
  assert.match(said, /\n  https:\/\/example\.nl\/nieuws +1 bezocht, +1 weggelaten\n/);
  assert.ok(!said.includes("bestaat-niet"), "no probe for a missing page is a part of the site");
});

test("each origin keeps its own start page in the sample, and each its own page for a missing address", () => {
  const page = (url: string, foundVia = "link"): InventoryPage => ({ url, slug: url.replace(/\W+/g, "-"), status: 200, title: url, lang: "nl", templateHash: `t-${url}`, contentHash: `c-${url}`, foundVia: [foundVia], counts: {} });
  const pages = [
    page(`${main}/`, "start"),
    page(`${docs}/`, "start"),
    page(`${main}/contact`),
    page(`${docs}/contact`),
    page(`${main}/bestaat-niet`, "404-probe"),
    page(`${docs}/bestaat-niet`, "404-probe"),
    ...Array.from({ length: 70 }, (_, index) => page(`${index % 2 ? main : docs}/artikel-${index}`)),
  ];
  const inventory: Inventory = { baseUrl: `${main}/`, origin: main, origins: [main, docs], sitemapUrls: 0, notFoundProbe: `${main}/bestaat-niet`, notFoundProbes: [`${main}/bestaat-niet`, `${docs}/bestaat-niet`], pages, skipped: [], totals: {} };
  const sample = buildSample(inventory, "seed");
  assert.equal(sample.method, "structured-plus-random");
  const reason = (url: string): string | undefined => sample.items.find((item) => item.url === url)?.reason;
  assert.equal(reason(`${main}/`), "startpagina");
  assert.equal(reason(`${docs}/`), "startpagina van docs.example.nl");
  assert.equal(reason(`${main}/contact`), "contactpagina");
  assert.equal(reason(`${docs}/contact`), "contactpagina van docs.example.nl");
  assert.equal(reason(`${main}/bestaat-niet`), "foutpagina (404)");
  assert.equal(reason(`${docs}/bestaat-niet`), "foutpagina (404)");

  // The same site in an older run, on one origin: one start page, as before.
  const older = buildSample({ ...inventory, origins: undefined, notFoundProbes: undefined } as Inventory, "seed");
  assert.equal(older.items.find((item) => item.url === `${main}/`)?.reason, "startpagina");
  assert.notEqual(older.items.find((item) => item.url === `${docs}/`)?.reason, "startpagina van docs.example.nl");
});

test("what goes to the repository of loep names no host of the site, on any of its origins", () => {
  const redact = redactor({ name: "Voorbeeld", baseUrl: `${main}/`, origins: [main, docs], organisation: null });
  assert.equal(redact("Op docs.example.nl en op example.nl"), "Op <site> en op <site>");
});
