import assert from "node:assert/strict";
import { test } from "node:test";
import { REFUSED_MIN_PAGES, refusedPagesNl, type InventoryPage } from "../src/commands/inventory.ts";

const origin = "https://example.test";
const probe = `${origin}/loep-404-probe`;
const page = (path: string, status: number | null) => ({ url: `${origin}${path}`, status }) as InventoryPage;
const site = (statuses: (number | null)[]) => ({ origin, notFoundProbe: probe, pages: [{ url: probe, status: 404 } as InventoryPage, ...statuses.map((status, index) => page(`/p${index}`, status))] });

test("a site that refuses every page stops the inventory", () => {
  const said = refusedPagesNl(site(Array(200).fill(403)));
  assert.match(said!, /200 van de 200 bezochte pagina's/);
  assert.match(said!, /200 keer 403/);
  assert.match(said!, /inventory\.json/);
});

test("nine refusals in ten, mixed statuses, also stop it", () => {
  const said = refusedPagesNl(site([403, 403, 403, 429, 401, 403, 403, 403, 403, 200]));
  assert.match(said!, /9 van de 10/);
  assert.match(said!, /1 keer 401, 7 keer 403, 1 keer 429/);
});

test("a site with some protected pages goes on", () => {
  assert.equal(refusedPagesNl(site([200, 200, 403, 401, 200, 200, 429, 200, 200, 200])), null);
  assert.equal(refusedPagesNl(site([403, 403, 403, 403, 403, 403, 403, 403, 200, 200])), null, "80% is below the threshold");
});

test("too few pages, the 404 probe and pages that did not load do not decide", () => {
  assert.equal(refusedPagesNl(site(Array(REFUSED_MIN_PAGES - 1).fill(403))), null);
  assert.equal(refusedPagesNl(site([...Array(REFUSED_MIN_PAGES - 1).fill(403), null, null])), null);
  assert.notEqual(refusedPagesNl(site(Array(REFUSED_MIN_PAGES).fill(403))), null);
});
