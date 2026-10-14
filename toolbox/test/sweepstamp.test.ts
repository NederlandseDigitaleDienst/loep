import assert from "node:assert/strict";
import { test } from "node:test";
import type { Blocker } from "../src/lib/sitemodel.ts";
import { blockersKey, pageKey, stateKey } from "../src/lib/sweepstamp.ts";

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
