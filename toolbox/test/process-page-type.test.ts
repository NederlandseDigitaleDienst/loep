import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { processPageType } from "../src/commands/modelsweep.ts";
import { QUESTIONS, reviewedAs, type Sheet } from "../src/commands/gate.ts";
import type { SiteModel } from "../src/lib/sitemodel.ts";
import type { Step } from "../src/session/observations.ts";

const ORIGIN = "http://127.0.0.1:4799";
// The site model of the test site, as the regression check of the sweep uses it.
const model = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "sweep", "site.json"), "utf8").replaceAll("{origin}", ORIGIN)) as SiteModel;
const closeBanner: Step = { command: "click", args: [], options: {}, target: ["#cookiemelding > div:nth-of-type(2) > button:nth-of-type(3)"] };
const goto = (url: string): Step => ({ command: "goto", args: [url], options: {}, target: null });
const fromHome = (...steps: Step[]) => ({ start: { url: `${ORIGIN}/` }, steps });

test("a process that ends on an address with a query belongs to the page type of that page, not to the home page its recipe starts on", () => {
  const search = fromHome(closeBanner, goto(`${ORIGIN}/zoeken.html?q=gemeente`));
  assert.equal(processPageType(model, search, `${ORIGIN}/zoeken.html?q=gemeente`), "zoeken");
  assert.equal(processPageType(model, search, `${ORIGIN}/zoeken.html?q=gemeente#resultaten`), "zoeken", "an anchor does not count either");
  assert.equal(processPageType(model, fromHome(closeBanner, goto(`${ORIGIN}/afval.html`)), `${ORIGIN}/afval.html?wijk=noord`), "afval");
});

test("a process whose end is no page of a page type belongs to the page its recipe first goes to, and only then to where it started", () => {
  const search = fromHome(closeBanner, goto("/zoeken.html?q=gemeente"));
  assert.equal(processPageType(model, search, `${ORIGIN}/resultaten/onbekend`), "zoeken", "a relative address counts from the start of the recipe");
  assert.equal(processPageType(model, search, null), "zoeken", "a state that was not reached has no end");
  assert.equal(processPageType(model, fromHome(closeBanner), `${ORIGIN}/resultaten/onbekend`), "start");
  assert.equal(processPageType(model, undefined, null), null);
});

test("the sheet and the question about what is missing name the processes of the page type", () => {
  assert.match(QUESTIONS.find((question) => question.id === "missing")!.questionNl, /niet in de lijst met processen/);
  const sheet: Sheet = { pageType: "zoeken", page: "P3", url: `${ORIGIN}/zoeken.html`, file: "gate/sheet-zoeken.png", sha256: "abc", tiles: [], componentsNl: [] };
  assert.equal(reviewedAs({ ...sheet, processesNl: [] }), reviewedAs(sheet), "a sheet without processes keeps the review it had");
  assert.notEqual(reviewedAs({ ...sheet, processesNl: ["zoeken-zoekpagina: Zoeken op de zoekpagina"] }), reviewedAs(sheet), "a list of processes asks for a new review");
});
