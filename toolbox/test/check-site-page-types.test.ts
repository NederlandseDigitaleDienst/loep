import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { checkSite, exploreContext } from "../src/commands/explore.ts";
import { inventory } from "../src/commands/inventory.ts";
import { readJson } from "../src/lib/canonical.ts";
import { NOT_OPENED_ON_PAGE_TYPE, notOpenedAdviceNl, type SiteModel } from "../src/lib/sitemodel.ts";
import { Daemon } from "../src/session/daemon.ts";

/**
 * `check-site` tries every component on the representative page of each page type it says it
 * stands on, in the window the sweep uses there: what the gate would refuse after a whole sweep
 * is refused before it.
 */
let fixture: FixtureServer;
let scratch: string;
let origin: string;
let run: string;
let model: SiteModel;
let typeWithQuestions: string;
let typeWithoutQuestions: string;
let representativeWithout: string;

const VRAGEN = "/veelgestelde-vragen.html";
const OPENINGSTIJDEN = "/openingstijden.html";
const NOT_OPENED = "De knop staat op dit paginatype niet; het is daar niet geprobeerd.";

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-check-site-page-types-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  origin = fixture.origins.clean;
  run = join(scratch, "run");
  await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 3, fixedUrls: [`${origin}${VRAGEN}`, `${origin}${OPENINGSTIJDEN}`] });
  // The cookie notice as blocker and the first question of the list as component, both recorded through a real session.
  const daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 20 });
  const loep = async (command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Record<string, unknown>> => {
    const response = await daemon.handle({ op: "command", session: "verken", command, args, options });
    assert.equal(response.ok, true, `${command}: ${JSON.stringify(response.print)}`);
    return response.print;
  };
  const ref = async (query: string): Promise<string> => ((await loep("find", [query])).found as string[])[0]!.split(" ")[0]!;
  try {
    await daemon.handle({ op: "start", session: "verken" });
    await loep("open", [VRAGEN]);
    await loep("click", [await ref("css:[data-keuze=weigeren]")]);
    await loep("state", ["save", "blocker-cookies"]);
    await loep("open", [VRAGEN], { state: "blocker-cookies" });
    await loep("click", [await ref("css:.vraag")]);
    await loep("state", ["save", "component-vraag"]);
  } finally {
    await daemon.close();
  }
  const context = exploreContext(await readJson(join(run, "inventory.json")));
  const pageTypes = context.proposedPageTypes.map((type, index) => ({ ...type, id: `type-${index + 1}`, descriptionNl: `Paginatype ${index + 1}` }));
  const typeOf = (path: string): string => pageTypes.find((type) => type.pages.includes(`${origin}${path}`))!.id;
  typeWithQuestions = typeOf(VRAGEN);
  typeWithoutQuestions = typeOf(OPENINGSTIJDEN);
  assert.notEqual(typeWithQuestions, typeWithoutQuestions, "the two pages are of different types");
  representativeWithout = pageTypes.find((type) => type.id === typeWithoutQuestions)!.representative;
  const all = pageTypes.map((type) => type.id);
  model = {
    version: 1,
    baseUrl: `${origin}/`,
    descriptionNl: "Dit is de website van een kleine gemeente. Inwoners lezen er nieuws, zoeken op wanneer het afval wordt opgehaald en wanneer het gemeentehuis open is, en kunnen via een chatvenster een vraag stellen. Voor het onderzoek valt op dat er bij het eerste bezoek een cookiemelding over de pagina ligt, die eerst gesloten moet worden voordat de pagina zelf te gebruiken is.",
    pageTypes,
    blockers: [{ id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#cookiemelding" } }],
    components: [
      // The questions stand on one page type; the model says two.
      { id: "vraag", type: "accordion", descriptionNl: "Uitklapper met een vraag en haar antwoord", pageTypes: [typeWithQuestions, typeWithoutQuestions], viewport: null, recipe: "component-vraag", postcondition: { kind: "expanded", selector: ".vraag" } },
      // What else there is to operate on the two pages, so that the count of check-site is satisfied.
      { id: "zoeken", type: "search", descriptionNl: "Zoekveld in de kop", pageTypes: all, viewport: null, recipe: null, postcondition: null, notOpenedNl: NOT_OPENED },
      { id: "menuknop", type: "menu", descriptionNl: "Menuknop op een smal scherm", pageTypes: all, viewport: { maxWidth: 720 }, recipe: null, postcondition: null, notOpenedNl: NOT_OPENED },
      { id: "chat", type: "chat", descriptionNl: "Chatvenster", pageTypes: all, viewport: null, recipe: null, postcondition: null, notOpenedNl: NOT_OPENED },
      { id: "overig", type: "other", descriptionNl: "Losse knoppen op de pagina", pageTypes: all, viewport: null, recipe: null, postcondition: null, notOpenedNl: NOT_OPENED },
    ],
    processes: [],
    frames: context.frames.map((frame) => ({ address: frame.address, class: "no-content", descriptionNl: "Leeg venster", reasonNl: "Toont de bezoeker niets." })),
    notesNl: [],
  };
});

after(async () => {
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

const write = (): void => writeFileSync(join(run, "site.json"), JSON.stringify(model, null, 2));

test("a component that does not open on the representative page of one of its page types is refused, with the page type and the reason", { timeout: 300_000 }, async () => {
  write();
  const started = Date.now();
  const check = await checkSite(run, { navigationDelayMs: 20 });
  process.stderr.write(`check-site met ${model.components.filter((component) => component.recipe).length} recept en 2 paginatypen: ${Math.round((Date.now() - started) / 100) / 10} s\n`);
  assert.equal(check.ok, false);
  const expected = new RegExp(`^component "vraag" \\(recept component-vraag\\): gaat op paginatype "${typeWithoutQuestions}" \\(${representativeWithout.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) niet open in een staand venster van 800 bij 1280: stap \\d+ \\(click\\) vond het element niet terug\\. ${notOpenedAdviceNl("stap 1 (click) vond het element niet terug").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  assert.deepEqual(check.problems.filter((problem) => !expected.test(problem)), [], `only that problem: ${check.problems.join("\n")}`);
  assert.equal(check.problems.length, 1);
  // The record says where it was tried and how, in the window of the sweep.
  const vraag = check.replays.find((replay) => replay.id === "vraag")!;
  assert.equal(vraag.ok, true, "the recipe holds on the page it was recorded on");
  assert.deepEqual(vraag.onPageTypes!.map((row) => [row.pageType, row.viewport.width, row.viewport.height, row.reached, row.accepted]), [[typeWithQuestions, 800, 1280, true, false], [typeWithoutQuestions, 800, 1280, false, false]]);
  assert.equal(check.replays.find((replay) => replay.id === "cookies")!.onPageTypes, undefined, "a blocker is not tried per page type");
});

test("the same model passes when it accepts that gap, as the gate does", { timeout: 300_000 }, async () => {
  const observation = `verken-${readdirSync(join(run, "observations", "verken")).map((file) => /^(\d+)\.json$/.exec(file)?.[1]).filter((nr): nr is string => nr !== undefined).sort()[0]}`;
  model.acceptedGaps = [{ check: NOT_OPENED_ON_PAGE_TYPE, page: representativeWithout, component: "vraag", reasonNl: "De vragen staan op dit paginatype niet; het onderdeel hoort er wel bij voor de bezoeker die er via de voet komt.", observation }];
  write();
  const check = await checkSite(run, { navigationDelayMs: 20 });
  assert.deepEqual(check.problems, []);
  assert.equal(check.ok, true);
  assert.deepEqual(check.replays.find((replay) => replay.id === "vraag")!.onPageTypes!.map((row) => [row.pageType, row.reached, row.accepted]), [[typeWithQuestions, true, false], [typeWithoutQuestions, false, true]]);
  // Another page accepted is not this one.
  model.acceptedGaps = [{ ...model.acceptedGaps[0]!, page: `${origin}${VRAGEN}` }];
  write();
  assert.equal((await checkSite(run, { navigationDelayMs: 20 })).ok, false);
});

test("an accepted gap covers one component: another component that fails on the same page is still refused", { timeout: 300_000 }, async () => {
  const accepted = model.acceptedGaps![0]!;
  const vraag = model.components.find((component) => component.id === "vraag")!;
  model.components = [...model.components, { ...vraag, id: "vraag2", descriptionNl: "Een tweede uitklapper met een vraag" }];
  try {
    model.acceptedGaps = [{ ...accepted, page: representativeWithout }];
    write();
    const check = await checkSite(run, { navigationDelayMs: 20 });
    assert.equal(check.ok, false);
    assert.deepEqual(check.problems.map((problem) => /^component "([^"]+)"/.exec(problem)?.[1]), ["vraag2"], check.problems.join("\n"));
    assert.deepEqual(check.replays.filter((replay) => replay.kind === "component").map((replay) => [replay.id, replay.onPageTypes!.find((row) => row.pageType === typeWithoutQuestions)!.accepted]), [["vraag", true], ["vraag2", false]]);
    // An entry from before `component` was asked matches no component, and check-site says what to add.
    const { component, ...withoutComponent } = { ...accepted, page: representativeWithout };
    void component;
    model.acceptedGaps = [withoutComponent];
    write();
    const old = await checkSite(run, { navigationDelayMs: 20 });
    assert.equal(old.ok, false);
    assert.deepEqual(old.problems, [`acceptedGaps[0]: bij "${NOT_OPENED_ON_PAGE_TYPE}" hoort "component", het id van het onderdeel dat daar niet opengaat; zonder telt de regel voor geen enkel onderdeel`]);
  } finally {
    model.components = model.components.filter((component) => component.id !== "vraag2");
    model.acceptedGaps = [{ ...accepted, page: representativeWithout }];
  }
});
