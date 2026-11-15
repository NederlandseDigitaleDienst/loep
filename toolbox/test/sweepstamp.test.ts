import assert from "node:assert/strict";
import { test } from "node:test";
import type { Blocker } from "../src/lib/sitemodel.ts";
import { enginesToRetry } from "../src/lib/engines.ts";
import { blockersKey, CONTENT_VERSION, engineRetryReason, firstDifference, pageKey, remeasureReason, stateKey, SWEEP_STAMP_VERSION, type PageStamp } from "../src/lib/sweepstamp.ts";

const BLOCKER: Blocker = { id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#banner" } };
const click = (target: string) => ({ command: "click", args: [], options: {}, target: [target] });
const recipe = (target: string, savedAt = "2026-10-10T10:00:00Z") => ({ name: "blocker-cookies", savedBy: "verken", savedAt, start: { url: "https://site.nl/", width: 1280, height: 800, scheme: "light" }, steps: [click(target)] });

test("a page is measured against the blockers and how they are closed, not against the rest of the model", () => {
  const key = blockersKey([BLOCKER], { "blocker-cookies": recipe("#weigeren") });
  assert.equal(blockersKey([BLOCKER], { "blocker-cookies": recipe("#weigeren", "2026-10-11T08:00:00Z") }), key, "saving the same steps again changes nothing");
  assert.equal(blockersKey([{ ...BLOCKER, descriptionNl: "Andere tekst" }], { "blocker-cookies": recipe("#weigeren") }), key, "nor does a description");
  assert.notEqual(blockersKey([BLOCKER], { "blocker-cookies": recipe("#akkoord") }), key, "another way of closing is another page");
  assert.notEqual(blockersKey([{ ...BLOCKER, postcondition: { kind: "gone", selector: "#melding" } }], { "blocker-cookies": recipe("#weigeren") }), key);
  assert.notEqual(blockersKey([], {}), key);

  const item = { url: "https://site.nl/", slug: "start", kind: "structured" };
  assert.equal(pageKey(key, item), pageKey(key, { ...item }));
  assert.notEqual(pageKey(key, item), pageKey(key, { ...item, kind: "embedded" }), "a page that became an embedded window is measured again");
  assert.notEqual(pageKey(key, item), pageKey(blockersKey([], {}), item));
});

test("a state is measured against its own recipe and postcondition", () => {
  const state = { id: "component-menu", kind: "component", startUrl: "https://site.nl/" };
  const key = stateKey(state, { kind: "expanded", selector: "#menuknop" }, recipe("#menuknop"));
  assert.equal(stateKey(state, { kind: "expanded", selector: "#menuknop" }, recipe("#menuknop", "later")), key);
  assert.notEqual(stateKey(state, { kind: "visible", selector: "#paneel" }, recipe("#menuknop")), key);
  assert.notEqual(stateKey(state, { kind: "expanded", selector: "#menuknop" }, recipe("#anders")), key);
  assert.notEqual(stateKey({ ...state, id: "component-menu-smal" }, { kind: "expanded", selector: "#menuknop" }, recipe("#menuknop")), key);
});

test("collect says in one line why a page is measured again, and keeps it when nothing a visitor sees changed", async () => {
  const blockers = blockersKey([BLOCKER], { "blocker-cookies": recipe("#weigeren") });
  const item = { url: "https://site.nl/", slug: "start", kind: "structured" };
  const key = pageKey(blockers, item);
  const before = '<body>\n  <h1>\n    "Diensten"\n  <p>\n    "Aanvragen kan online."';
  const stamp: PageStamp = { key, version: SWEEP_STAMP_VERSION, contentVersion: CONTENT_VERSION, blockers, contentSha256: "same", summary: {}, dismissals: [], refusedWrites: [] };
  let loaded = 0;
  const now = (sha256: string, snapshot = before) => async () => {
    loaded++;
    return { sha256, snapshot };
  };
  const earlier = async () => before;

  assert.equal(await remeasureReason(stamp, key, blockers, now("same"), earlier), null);
  assert.equal(await remeasureReason(null, key, blockers, now("same"), earlier), "geen stempel van een eerdere meting");
  const { version: _, ...older } = stamp;
  assert.equal(await remeasureReason(older, key, blockers, now("same"), earlier), "stempel van een andere versie van loep", "a stamp of before this change hashed every attribute");
  assert.equal(await remeasureReason({ ...stamp, contentVersion: CONTENT_VERSION - 1 }, key, blockers, now("same"), earlier), "stempel van een andere versie van loep");
  const otherBlockers = blockersKey([BLOCKER], { "blocker-cookies": recipe("#akkoord") });
  assert.equal(await remeasureReason(stamp, pageKey(otherBlockers, item), otherBlockers, now("same"), earlier), "blokkades of hoe ze worden gesloten anders");
  assert.equal(await remeasureReason(stamp, pageKey(blockers, { ...item, kind: "embedded" }), blockers, now("same"), earlier), "pagina anders in de steekproef (soort of ingesloten venster)");
  assert.equal(loaded, 1, "the page is only loaded when the stamp and the key still agree");

  assert.equal(await remeasureReason(stamp, key, blockers, async () => null, earlier), "pagina niet te laden om de inhoud te vergelijken");
  assert.equal(await remeasureReason(stamp, key, blockers, now("other", before.replace("kan", "kon")), earlier), 'inhoud anders, regel 5: "Aanvragen kan online." werd "Aanvragen kon online."');
  assert.equal(await remeasureReason(stamp, key, blockers, now("other"), async () => null), "inhoud anders", "a run of an older loep has no content next to its stamp");
});

test("a page on which a rule engine ran out of time is measured once more, and only once", async () => {
  const blockers = blockersKey([], {});
  const key = pageKey(blockers, { url: "https://site.nl/zoeken", slug: "zoeken", kind: "structured" });
  const stamp: PageStamp = { key, version: SWEEP_STAMP_VERSION, contentVersion: CONTENT_VERSION, blockers, contentSha256: "same", summary: {}, dismissals: [], refusedWrites: [] };
  let loaded = 0;
  const same = async () => {
    loaded++;
    return { sha256: "same", snapshot: "" };
  };
  const run = (alfa: { ok: boolean; error?: string }, axe: { ok: boolean; error?: string } = { ok: true }, retried = false) => ({ status: { "axe-core": { version: "4", ...axe }, alfa: { version: "1", ...alfa } }, ...(retried ? { retriedAfterTimeout: true as const } : {}) });
  const timeout = { ok: false, error: "geen antwoord binnen 90 s" };

  // Light and dark ran out of time the same way: named once.
  const timedOut = enginesToRetry([run(timeout), run(timeout)]);
  assert.deepEqual(timedOut, [{ engine: "alfa", error: "geen antwoord binnen 90 s" }]);
  assert.equal(await remeasureReason(stamp, key, blockers, same, async () => null, timedOut), "regelset gaf eerder geen uitslag (alfa: geen antwoord binnen 90 s)");
  assert.equal(loaded, 0, "the page is not loaded to compare: it is measured again anyway");
  assert.equal(await remeasureReason(null, key, blockers, same, async () => null, timedOut), "geen stempel van een eerdere meting", "a reason that comes first stays the reason");

  // The retry is marked in what it measured: when the engine runs out of time again, the measurement stands and the gate makes it a limitation.
  assert.deepEqual(enginesToRetry([run(timeout, { ok: true }, true), run({ ok: true }, { ok: true }, true)]), []);
  assert.equal(await remeasureReason(stamp, key, blockers, same, async () => null, enginesToRetry([run(timeout, { ok: true }, true), run({ ok: true })])), null);
  // A crash of an engine on the page is not tried again: it would crash every time.
  assert.deepEqual(enginesToRetry([run({ ok: false, error: "Cannot read properties of undefined" }), run({ ok: true }, { ok: false, error: "de pagina heeft window.axe zelf vastgezet" })]), []);
  assert.deepEqual(enginesToRetry([run({ ok: true }, { ok: false, error: "page.evaluate: Timeout 30000ms exceeded." })]), [{ engine: "axe-core", error: "page.evaluate: Timeout 30000ms exceeded." }]);
  assert.deepEqual(enginesToRetry([null, undefined]), [], "an earlier measurement without engine files has nothing to retry");
  assert.equal(engineRetryReason([]), null);
});

test("the first difference of two snapshots names the line, shortened", () => {
  assert.equal(firstDifference("<body>\n  <p>", "<body>\n  <p>\n    \"Nieuw\""), 'regel 3: (niets) werd "Nieuw"');
  assert.equal(firstDifference("<body>\n  <p>\n  <ul>", "<body>\n  <ul>"), 'regel 2: <p> werd <ul>');
  const long = `"${"a".repeat(200)}"`;
  assert.match(firstDifference(long, "x"), /^regel 1: "a{76}\.\.\. werd x$/);
});
