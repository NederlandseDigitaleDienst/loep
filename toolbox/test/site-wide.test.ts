import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { buildSheets, QUESTIONS, reviewedAs, sheetText, type Sheet } from "../src/commands/gate.ts";
import type { CapturedState } from "../src/commands/modelsweep.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { ALL_PAGE_TYPES, expandSiteWide, pageTypesToCheck, readSiteModel, validateSiteModel, type ModelContext, type SiteModel } from "../src/lib/sitemodel.ts";

/**
 * A component on every page, such as a menu button on a narrow screen or a fixed chat button, is
 * written once with `"pageTypes": "all"`. Tried on the site model of the test site, whose menu
 * and chat stand on every page.
 */
const ORIGIN = "http://127.0.0.1:4799";
const fixtureModel = (): SiteModel => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "sweep", "site.json"), "utf8").replaceAll("{origin}", ORIGIN).replaceAll("{thirdParty}", "http://127.0.0.1:4798")) as SiteModel;
const SITE_WIDE = ["menu-smal", "chat"];
/** The model as the explorer writes it: the menu and the chat once, on every page. */
const written = (): SiteModel => {
  const model = fixtureModel();
  for (const component of model.components) if (SITE_WIDE.includes(component.id)) (component as unknown as { pageTypes: string }).pageTypes = ALL_PAGE_TYPES;
  return model;
};

const contextOf = (model: SiteModel): ModelContext => {
  const recipes: ModelContext["recipes"] = {};
  for (const entry of [...model.blockers, ...model.components, ...model.processes]) if (entry.recipe) recipes[entry.recipe] = { width: 360, steps: 1, url: model.baseUrl };
  return { pages: model.pageTypes.flatMap((type) => type.pages), frames: [], recipes };
};

test("the validator takes \"all\" for the page types of a component, and points a list with that word to it", () => {
  const model = written();
  // Only what concerns the page types of the components: the rest of the fixture model has its own test.
  const aboutPageTypes = (problems: string[]): string[] => problems.filter((problem) => /^components\[\d+\]: (pageTypes|paginatype)/.test(problem));
  assert.deepEqual(aboutPageTypes(validateSiteModel(model, contextOf(model))), []);
  const asList = written();
  (asList.components.find((component) => component.id === "chat")! as unknown as { pageTypes: string[] }).pageTypes = [ALL_PAGE_TYPES];
  const problems = aboutPageTypes(validateSiteModel(asList, contextOf(asList)));
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /paginatype "all" bestaat niet; staat het onderdeel op elke pagina, schrijf dan "pageTypes": "all" zonder lijst/);
  const otherWord = written();
  (otherWord.components.find((component) => component.id === "chat")! as unknown as { pageTypes: string }).pageTypes = "alle";
  assert.match(aboutPageTypes(validateSiteModel(otherWord, contextOf(otherWord)))[0]!, /pageTypes ontbreekt of is leeg \(of "all" voor een onderdeel dat op elke pagina staat\)/);
});

test("reading the model gives a component on every page the list of every page type, and leaves a model with lists as it was", async () => {
  const model = written();
  const expanded = expandSiteWide(model);
  const all = model.pageTypes.map((type) => type.id);
  for (const id of SITE_WIDE) {
    const component = expanded.components.find((entry) => entry.id === id)!;
    assert.deepEqual(component.pageTypes, all);
    assert.equal(component.siteWide, true);
  }
  assert.deepEqual(
    expanded.components.filter((entry) => !SITE_WIDE.includes(entry.id)),
    model.components.filter((entry) => !SITE_WIDE.includes(entry.id)),
    "the other components keep their lists",
  );
  // A model that lists every page type by hand stays as it is: nothing in it is site wide.
  const byHand = fixtureModel();
  for (const component of byHand.components) if (SITE_WIDE.includes(component.id)) component.pageTypes = [...all];
  assert.equal(expandSiteWide(byHand), byHand);
  assert.ok(expandSiteWide(byHand).components.every((component) => component.siteWide === undefined));
  // What the commands read goes through the same step.
  const dir = mkdtempSync(join(tmpdir(), "loep-site-wide-"));
  try {
    writeFileSync(join(dir, "site.json"), JSON.stringify(model));
    assert.deepEqual((await readSiteModel(dir))!.components.find((entry) => entry.id === "chat")!.pageTypes, all);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-site opens a component on every page on a few page types, spread over the list; one with a list on all of them", () => {
  const expanded = expandSiteWide(written());
  const menu = expanded.components.find((entry) => entry.id === "menu-smal")!;
  assert.equal(menu.pageTypes.length, 13);
  assert.deepEqual(pageTypesToCheck(menu), ["start", "nieuwsbericht-media", "zoeken"]);
  assert.deepEqual(pageTypesToCheck({ pageTypes: ["start", "afval"], siteWide: true }), ["start", "afval"], "with few page types, all of them");
  const forms = expanded.components.find((entry) => entry.id === "formulieren")!;
  assert.deepEqual(pageTypesToCheck(forms), forms.pageTypes, "a component with a list is tried on each page type it names");
});

test("the sheet of the gate names the components on every page apart, so the review does not take them for missing", async () => {
  const model = expandSiteWide(written());
  const dir = mkdtempSync(join(tmpdir(), "loep-site-wide-sheets-"));
  try {
    const png = new PNG({ width: 20, height: 20 });
    png.data.fill(200);
    const picture = (path: string): string => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), PNG.sync.write(png));
      return path;
    };
    const types = ["start", "afval"];
    const pages = types.map((id, index) => {
      const type = model.pageTypes.find((entry) => entry.id === id)!;
      picture(`pages/P0${index + 1}/screenshot-light.png`);
      return { label: `P0${index + 1}`, item: { url: type.representative, kind: "page" }, dir: `pages/P0${index + 1}`, facts: { iframes: [] } };
    });
    const state = (modelId: string, on = 0): CapturedState => {
      const component = model.components.find((entry) => entry.id === modelId)!;
      return { id: component.recipe ?? modelId, kind: "component", modelId, pageTypes: component.pageTypes, url: pages[on]!.item.url, viewport: { width: 360, height: 640 }, reached: true, reasonNl: null, stillReachedAfterMeasuring: true, dir: null, files: { screenshot: picture(`site-states/${modelId}/screenshot.png`) }, engineSummary: null, contrast: null, largestOverlayShare: null };
    };
    const run = { pages, siteModel: model, siteStates: { states: [state("menu-smal"), state("chat"), state("afval-tabs", 1)] }, states: null } as unknown as RunData;
    const sheets = await buildSheets(run, dir, dir);
    const start = sheets.find((sheet) => sheet.pageType === "start")!;
    const afval = sheets.find((sheet) => sheet.pageType === "afval")!;
    // On the page it was captured on the state has its tile; the list says it is on every page.
    assert.deepEqual(start.everywhereNl!.map((entry) => entry.split(":")[0]), SITE_WIDE);
    assert.deepEqual(start.componentsNl, []);
    assert.equal(start.tiles.length, 1 + SITE_WIDE.length, "the page and a tile per state captured there");
    // On another page type it is named as on every page, not as a component of that type.
    assert.deepEqual(afval.everywhereNl, ["menu-smal (het vak staat op het blad van paginatype start)", "chat (het vak staat op het blad van paginatype start)"]);
    assert.deepEqual(afval.componentsNl.map((entry) => entry.split(":")[0]), ["afval-tabs"]);
    assert.equal(afval.tiles.length, 2, "the page and the tabs; the menu and the chat have their tile on the sheet of start");
    const text = sheetText(afval, dir);
    assert.match(text, /Onderdelen van dit paginatype volgens het sitemodel: afval-tabs/);
    assert.match(text, /Op elke pagina, ook deze, volgens het sitemodel: menu-smal \(het vak staat op het blad van paginatype start\); chat \(/);
    // The question about what is missing stays the same; the task tells the reviewer the line belongs to the components.
    assert.match(QUESTIONS.find((question) => question.id === "missing")!.questionNl, /niet in de lijst met onderdelen/);
    assert.match(readFileSync(join(import.meta.dirname, "..", "..", "templates", "poort.md"), "utf8"), /"Op elke pagina"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sheet without components on every page keeps the review it had", () => {
  const sheet: Sheet = { pageType: "start", page: "P01", url: `${ORIGIN}/`, file: "gate/sheet-start.png", sha256: "abc", tiles: [], componentsNl: ["menu: Menu achter een knop"] };
  assert.equal(reviewedAs({ ...sheet, everywhereNl: [] }), reviewedAs(sheet));
  assert.notEqual(reviewedAs({ ...sheet, everywhereNl: ["chat (het vak staat op het blad van paginatype start)"] }), reviewedAs(sheet));
  assert.doesNotMatch(sheetText(sheet, "/run"), /Op elke pagina/);
});
