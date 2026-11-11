import assert from "node:assert/strict";
import { test } from "node:test";
import { siteDocuments } from "../src/lib/documents.ts";
import { outsideSitePath } from "../src/session/safety.ts";

const site = "https://host.example/team/site/";

test("a session does not open another site on the host the site shares", () => {
  const scope = { sitePath: site, notFoundProbes: ["https://host.example/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek"] };
  assert.ok(!outsideSitePath(scope, `${site}rapport/`));
  assert.ok(!outsideSitePath(scope, "https://host.example/team/site"), "the path without its slash");
  assert.ok(outsideSitePath(scope, "https://host.example/team/other/"));
  assert.ok(outsideSitePath(scope, "https://host.example/"));
  assert.ok(!outsideSitePath(scope, "https://host.example/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek"), "an older run asked for the missing page on the root");
  assert.ok(!outsideSitePath(scope, "https://elsewhere.example/"), "another host is the business of the host scope");
  assert.ok(!outsideSitePath({}, "https://host.example/team/other/"), "a site on the root has no path to keep to");
});

test("a document of another site on the same host is a document elsewhere", () => {
  const document = (url: string) => ({ url, kind: "pdf", slug: url, linkedFrom: [], bytes: null, lastModified: null, contentType: null, status: 200 });
  const inventory = { baseUrl: site, origin: "https://host.example", documents: [document(`${site}a.pdf`), document("https://host.example/team/other/b.pdf")], documentTotals: { onSite: 2, byKind: { pdf: 2 }, elsewhere: 0, elsewhereByKind: {} } };
  const { onSite, elsewhere } = siteDocuments(inventory as Parameters<typeof siteDocuments>[0]);
  assert.deepEqual(onSite.map((each) => each.url), [`${site}a.pdf`]);
  assert.equal(elsewhere, 1);
});
