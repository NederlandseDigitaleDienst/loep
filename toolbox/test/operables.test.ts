import assert from "node:assert/strict";
import { test } from "node:test";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, newContext } from "../src/browser/session.ts";
import { mergeWidths, modelTouches, uncoveredOperables, type CountedPage, type OperableGroup, type RecipeSteps } from "../src/lib/operables.ts";
import type { SiteModel } from "../src/lib/sitemodel.ts";

const group = (kind: OperableGroup["kind"], path: string, text: string, members: string[], more: Partial<OperableGroup> = {}): OperableGroup => ({ key: `${kind} ${path}`, kind, path, region: "main", inMain: true, text, members: members.map((member) => ({ path: member, structural: `html > body > main > ${member.replace("#", "x-")}`, kind: "field" })), ...more });
const step = (target: string, command = "click"): RecipeSteps["steps"][number] => ({ command, args: [], options: {}, target: [target] });

function model(): SiteModel {
  return {
    version: 1,
    baseUrl: "https://site.nl/",
    pageTypes: [
      { id: "start", descriptionNl: "Start", representative: "https://site.nl/", pages: ["https://site.nl/"] },
      { id: "contact", descriptionNl: "Contact", representative: "https://site.nl/contact", pages: ["https://site.nl/contact", "https://site.nl/contact?bedankt=1"] },
    ],
    blockers: [],
    components: [{ id: "tabs", type: "tabs", descriptionNl: "Tabbladen", pageTypes: ["start"], viewport: null, recipe: "component-tabs", postcondition: { kind: "visible", selector: "#paneel" } }],
    processes: [{ id: "contact", descriptionNl: "Contactformulier ingevuld", recipe: "process-contact", postcondition: { kind: "value", selector: "#naam" } }],
    frames: [],
    notesNl: [],
  };
}

const RECIPES: Record<string, RecipeSteps> = {
  "component-tabs": { start: { url: "https://site.nl/" }, steps: [step("#tab-2")] },
  // Starts on the home page and goes on to the contact page: the field is touched there.
  "process-contact": { start: { url: "https://site.nl/" }, steps: [step("#weigeren"), { command: "goto", args: ["/contact"], options: {}, target: null }, step("#naam", "type")] },
};

const HEADER_SEARCH = group("search", "header > form", "Zoek op de site, Zoeken", ["#zoek", "#zoekknop"], { inMain: false, region: "header" });

test("a recipe is read as the elements it operates, each on the page the recipe was on", () => {
  assert.deepEqual(modelTouches(model(), RECIPES).map((touch) => [touch.url, touch.path, touch.declaredTypes]), [
    ["https://site.nl/", "#tab-2", ["start"]],
    ["https://site.nl/", "#weigeren", []],
    ["https://site.nl/contact", "#naam", []],
  ]);
});

test("a form no recipe touches is reported with its place, kind and text; one that is touched is not", () => {
  const counted: CountedPage[] = [
    { pageType: "start", url: "https://site.nl/", groups: [HEADER_SEARCH, group("tabs", "#tabs", "Een, Twee", ["#tab-1", "#tab-2"]), group("form", "#nieuwsbrief", "E-mailadres, Aanmelden", ["#email", "#aanmelden"])] },
    { pageType: "contact", url: "https://site.nl/contact", groups: [HEADER_SEARCH, group("form", "#contactformulier", "Naam, Vraag, Versturen", ["#naam", "#vraag", "#verstuur"])] },
  ];
  const { counted: total, uncovered } = uncoveredOperables(model(), RECIPES, counted);
  assert.equal(total, 4, "the search form in the header is on both pages and counts once");
  assert.deepEqual(uncovered.map((entry) => [entry.pageType, entry.group.path]), [["start", "#nieuwsbrief"], [null, "header > form"]]);
  assert.match(uncovered[0]!.problemNl, /^paginatype "start" \(https:\/\/site\.nl\/\): een formulier \(2 bedieningselementen\) met de tekst "E-mailadres, Aanmelden" op #nieuwsbrief, in main staat niet in het sitemodel/);
  assert.match(uncovered[1]!.problemNl, /^buiten de inhoud, op elke pagina waar dit blok staat \(geteld op https:\/\/site\.nl\/\): een zoekformulier/);

  // A recipe on any page accounts for a block that returns on every page.
  const withSearch = { ...RECIPES, "process-zoeken": { start: { url: "https://site.nl/contact" }, steps: [step("#zoek", "type")] } };
  const searching = { ...model(), processes: [...model().processes, { id: "zoeken", descriptionNl: "Zoeken", recipe: "process-zoeken", postcondition: { kind: "url-contains" as const, text: "q=" } }] };
  assert.deepEqual(uncoveredOperables(searching, withSearch, counted).uncovered.map((entry) => entry.group.path), ["#nieuwsbrief"]);
});

test("touching an element on another page type does not account for a form here, unless the component names this type", () => {
  const counted: CountedPage[] = [{ pageType: "contact", url: "https://site.nl/contact", groups: [group("tabs", "#tabs", "Een, Twee", ["#tab-1", "#tab-2"])] }];
  assert.equal(uncoveredOperables(model(), RECIPES, counted).uncovered.length, 1, "the tabs were opened on the home page only");
  const both = model();
  both.components[0]!.pageTypes = ["start", "contact"];
  assert.equal(uncoveredOperables(both, RECIPES, counted).uncovered.length, 0);
});

test("a component that could not be opened accounts for controls of its kind, and a player of the browser is covered by content", () => {
  const slider = group("slider", "#prijs", "Hoogste prijs", ["#prijs"]);
  const player = { ...group("player", "#video", "", ["#video"]), members: [{ path: "#video", structural: "html > body > main > video", kind: "player" }] };
  const counted: CountedPage[] = [{ pageType: "start", url: "https://site.nl/", groups: [slider, player] }];
  assert.deepEqual(uncoveredOperables(model(), RECIPES, counted).uncovered.map((entry) => entry.group.kind), ["slider", "player"]);
  const described = model();
  described.components.push({ id: "prijs", type: "other", descriptionNl: "Schuifregelaar", pageTypes: ["start"], viewport: null, recipe: null, postcondition: null, notOpenedNl: "Slepen kan niet." });
  described.content = [{ id: "video", kind: "video", descriptionNl: "Video", pageTypes: ["start"] }];
  assert.deepEqual(uncoveredOperables(described, RECIPES, counted).uncovered, []);
  // A component of another kind does not: an accordion says nothing about a slider.
  described.components.at(-1)!.type = "accordion";
  assert.deepEqual(uncoveredOperables(described, RECIPES, counted).uncovered.map((entry) => entry.group.kind), ["slider"]);
});

test("an embedded window with controls is a part of the page: classified under frames is not enough, a component that names it is", () => {
  const frame: OperableGroup = { key: "frame https://derde.example/controle", kind: "frame", path: "#contactformulier > iframe", region: "form", inMain: true, text: "Controle: Ik ben geen robot", members: [{ path: "#contactformulier > iframe", structural: "html > body > main > form > iframe", kind: "frame" }], frame: "https://derde.example/controle", controls: 1 };
  const counted: CountedPage[] = [{ pageType: "contact", url: "https://site.nl/contact", groups: [frame] }];
  const classified = { ...model(), frames: [{ address: "https://derde.example/controle", class: "vendor-component" as const, descriptionNl: "Controle tegen robots", reasonNl: "De gemeente koos deze controle en de bezoeker moet haar doorlopen." }] };
  const { uncovered } = uncoveredOperables(classified, RECIPES, counted);
  assert.match(uncovered[0]!.problemNl, /^paginatype "contact" .*een ingesloten venster met iets om te bedienen \(https:\/\/derde\.example\/controle, 1 bedieningselement, "Controle: Ik ben geen robot"\) op #contactformulier > iframe, in form staat niet als onderdeel in het sitemodel/);
  // A component without a recipe of a fitting type says nothing about this window; one that names its address does, on its own page types.
  const named = { ...classified, components: [...classified.components, { id: "controle", type: "other" as const, descriptionNl: "Vak ik ben geen robot", pageTypes: ["start"], viewport: null, recipe: null, postcondition: null, notOpenedNl: "Niet te bedienen in een venster." }] };
  assert.equal(uncoveredOperables(named, RECIPES, counted).uncovered.length, 1);
  named.components.at(-1)!.frame = "https://derde.example/controle";
  assert.equal(uncoveredOperables(named, RECIPES, counted).uncovered.length, 1, "named on another page type only");
  named.components.at(-1)!.pageTypes = ["start", "contact"];
  assert.deepEqual(uncoveredOperables(named, RECIPES, counted).uncovered, []);
});

test("what only the narrow window shows is added and said to be there only", () => {
  const wide = [group("form", "#f", "Naam", ["#naam"])];
  const narrow = [group("form", "#f", "Naam", ["#naam", "#extra"]), group("disclosure", "header > button", "Menu", ["#menuknop"], { inMain: false, region: "header" })];
  const merged = mergeWidths(wide, narrow);
  assert.deepEqual(merged.map((entry) => [entry.kind, entry.members.length, entry.onlyNarrow ?? false]), [["form", 2, false], ["disclosure", 1, true]]);
  const { uncovered } = uncoveredOperables(model(), RECIPES, [{ pageType: "start", url: "https://site.nl/", groups: merged.filter((entry) => entry.kind === "disclosure") }]);
  assert.match(uncovered[0]!.problemNl, /een uitklapper met de tekst "Menu" op header > button, in header \(alleen op een smal scherm\) staat niet/);
});

test("the page is counted in groups: a form with its fields, tabs, a player, alike buttons, and no plain links", async () => {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser);
    await context.addInitScript({ path: INPAGE_PATH });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html lang="nl"><body>
<header><form role="search"><input type="search" aria-label="Zoek op de site"><button>Zoeken</button></form><button aria-expanded="false">Menu</button><a href="/x">Link</a></header>
<main>
<form id="contact"><label for="naam">Naam</label><input id="naam"><label for="soort">Soort</label><select id="soort"><option>A</option></select><button type="submit">Versturen</button></form>
<div role="tablist"><button role="tab" aria-selected="true">Een</button><button role="tab">Twee</button></div>
<ul><li><h2><button>Paspoort</button></h2></li><li><h2><button>Rijbewijs</button></h2></li></ul>
<label for="prijs">Hoogste prijs</label><input type="range" id="prijs">
<div class="speler"><video controls width="200" height="100"></video><button>Afspelen</button></div>
<details><summary>Meer uitleg</summary><p>Tekst</p></details>
<button disabled>Uit</button><button hidden>Weg</button><a href="/y">Nog een link</a>
</main></body></html>`);
    const groups = await call<OperableGroup[]>(page, "operables");
    assert.deepEqual(
      groups.map((entry) => [entry.kind, entry.inMain, entry.members.length, entry.text]),
      [
        ["search", false, 2, "Zoek op de site, Zoeken"],
        ["disclosure", false, 1, "Menu"],
        ["form", true, 3, "Naam, Soort, Versturen"],
        ["tabs", true, 2, "Een, Twee"],
        ["button", true, 2, "Paspoort, Rijbewijs"],
        ["slider", true, 1, "Hoogste prijs"],
        ["player", true, 2, "Afspelen"],
        ["disclosure", true, 1, "Meer uitleg"],
      ],
    );
    assert.equal(groups[2]!.path, "#contact");
    assert.deepEqual(groups[2]!.members.map((member) => member.path), ["#naam", "#soort", "#contact > button"]);
    assert.equal(groups[4]!.members[1]!.structural, "html > body > main > ul > li:nth-of-type(2) > h2 > button");
  } finally {
    await browser.close();
  }
});
