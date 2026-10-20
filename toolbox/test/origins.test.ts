import assert from "node:assert/strict";
import { test } from "node:test";
import { documentOutOfReach } from "../src/commands/compare-findings.ts";
import { redactor } from "../src/commands/feedback.ts";
import { formPagesNl, pageLimitNl, pageLimitReason, type Inventory, type InventoryPage } from "../src/commands/inventory.ts";
import { buildSample } from "../src/commands/sample.ts";
import { documentScopeNl } from "../src/lib/documents.ts";
import { isPrivateHost, notFoundProbes, originsNl, originsOfRun, pagesInScopeNl, parseOrigin, privateFromPublicSite, scopeHost, scopeHostOf, siteHosts, siteLabel, siteOrigins } from "../src/lib/origins.ts";
import { otherDomains } from "../src/lib/statement.ts";
import { urlInScope } from "../src/session/safety.ts";

test("the scope takes http, https, ws and wss only, on the host with its port", () => {
  const scope = { hosts: ["example.nl", "example.nl:8443", "127.0.0.1:4710"], baseUrl: null, strict: false };
  for (const url of ["https://example.nl/a", "http://example.nl/", "http://example.nl:80/", "https://example.nl:443/", "wss://example.nl/chat", "https://example.nl:8443/", "http://127.0.0.1:4710/x"]) assert.ok(urlInScope(scope, url), url);
  // Every other scheme is never in the scope, whatever the host.
  for (const url of ["file:///etc/hosts", "file://example.nl/etc/hosts", "data:text/html,<p>x</p>", "blob:https://example.nl/0d3c", "javascript:alert(1)", "ftp://example.nl/", "about:blank", "chrome://settings"]) assert.ok(!urlInScope(scope, url), url);
  // Another port is another server.
  for (const url of ["http://example.nl:8080/", "https://example.nl:8444/", "http://127.0.0.1:4711/", "http://127.0.0.1/", "geen adres"]) assert.ok(!urlInScope(scope, url), url);
  assert.equal(scopeHost(new URL("https://Example.nl:443/a")), "example.nl");
  assert.equal(scopeHost(new URL("http://[::1]:4710/")), "[::1]:4710");
  assert.deepEqual(["cdn.example.nl", "cdn.example.nl:8080", "https://cdn.example.nl/x", "http://cdn.example.nl:80"].map(scopeHostOf), ["cdn.example.nl", "cdn.example.nl:8080", "cdn.example.nl", "cdn.example.nl"]);
});

test("an address on this machine or a local network is private, and only a local site may embed one", () => {
  const hostOf = (url: string): string => new URL(url).hostname;
  for (const url of ["http://127.0.0.1/", "http://127.8.9.1/", "http://0.0.0.0/", "http://localhost:3000/", "http://app.localhost/", "http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/", "http://printer.local/", "http://[::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[fe80::1]/", "http://[febf::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:10.0.0.1]/", "http://2130706433/", "http://0x7f.1/"]) assert.ok(isPrivateHost(hostOf(url)), url);
  for (const url of ["https://example.nl/", "http://172.15.0.1/", "http://172.32.0.1/", "http://192.169.1.1/", "http://11.0.0.1/", "http://169.255.0.1/", "http://[2001:db8::1]/", "http://[fec0::1]/", "http://[::ffff:8.8.8.8]/", "https://local.example.nl/", "https://example.localhost.nl/"]) assert.ok(!isPrivateHost(hostOf(url)), url);
  assert.equal(privateFromPublicSite("http://10.0.0.1/beheer", ["https://example.nl"]), true);
  assert.equal(privateFromPublicSite("https://video.example.org/embed", ["https://example.nl"]), false);
  // The test site runs on this machine: its player on another port is part of it.
  assert.equal(privateFromPublicSite("http://127.0.0.1:4712/speler.html", ["http://127.0.0.1:4710"]), false);
  assert.equal(privateFromPublicSite("http://192.168.1.10/", ["https://example.nl", "http://intranet.local"]), false, "one origin of the site is local");
});

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
