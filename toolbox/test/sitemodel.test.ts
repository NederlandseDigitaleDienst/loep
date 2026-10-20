import type { Covered } from "../src/session/recipe.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PNG } from "pngjs";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { checkSite, explore, exploreContext } from "../src/commands/explore.ts";
import { checkGate, commonBlock, contactSheet, gate, gateChecks, keysOn, MIN_TAB_REACH, reviewedAs, openedBetweenWidths, reviewGaps, reviewParts, SHEETS_PER_TASK, sheetGaps, tile, validateAnswers, type Answers, type Sheet } from "../src/commands/gate.ts";
import { inventory, type Inventory, type InventoryPage } from "../src/commands/inventory.ts";
import { ModelSweep, type SiteStates } from "../src/commands/modelsweep.ts";
import { DownRun, HoverRun, probePointerInStates } from "../src/commands/states.ts";
import { probeSingleKeysInStates } from "../src/commands/states.ts";
import { buildSample, sample } from "../src/commands/sample.ts";
import { tabWalk } from "../src/instruments/keyboard.ts";
import { legend, siteStates, targetSize } from "../src/lib/extractors.ts";
import { loadRun, type PageData, type RunData } from "../src/lib/rundata.ts";
import { acceptedGapFor, frameStanding, loadSiteModel, NOT_OPENED_ON_PAGE_TYPE, notOpenedAdviceNl, siteDescription, validateSiteModel, type ModelContext, type SiteModel } from "../src/lib/sitemodel.ts";
import { Daemon } from "../src/session/daemon.ts";

// A site with the traps a sweep walks into: a banner over the page, a menu behind a
// button, a player frame with three controls in the Tab order, and the same captcha frame twice.
const BANNER = `<div id="banner" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#fff;border-top:2px solid #000;padding:16px">
<p>Wij gebruiken cookies.</p><button type="button" id="accept">Akkoord</button><button type="button" id="refuse">Weigeren</button></div>
<script>
const banner = document.getElementById("banner");
if (localStorage.getItem("consent")) banner.remove();
for (const button of banner.querySelectorAll("button")) button.addEventListener("click", () => { localStorage.setItem("consent", button.id); banner.remove(); });
</script>`;
const page = (title: string, body: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${body}</body></html>`;
const NAV = `<header><nav aria-label="Hoofdmenu"><a href="/">Start</a> <a href="/over.html">Over ons</a></nav>
<button type="button" id="menuknop" aria-expanded="false" aria-controls="paneel">Meer</button><div id="paneel" hidden><a href="/over.html">Alles over ons</a></div>
<script>document.getElementById("menuknop").addEventListener("click", (event) => { const open = event.currentTarget.getAttribute("aria-expanded") !== "true"; event.currentTarget.setAttribute("aria-expanded", String(open)); document.getElementById("paneel").hidden = !open; });</script></header>`;
const PAGES: Record<string, string> = {
  "/": page("Start - Proefsite", `${NAV}<main><h1>Start</h1><p><a href="/over.html">Lees over ons</a></p><iframe src="/player.html" title="Video" width="400" height="120"></iframe><p><a href="/over.html#na">Na de video</a></p>
<iframe src="/captcha.html?k=1" title="Controle" width="100" height="40"></iframe><iframe src="/captcha.html?k=2" title="Controle" width="100" height="40"></iframe></main><footer><a href="/over.html#voet">Voet</a></footer>${BANNER}`),
  "/over.html": page("Over ons - Proefsite", `${NAV}<main><h1>Over ons</h1><p>Tekst over ons.</p><p><a href="/">Terug naar start</a></p></main>${BANNER}`),
  "/player.html": page("Speler", `<button type="button">Afspelen</button><button type="button">Geluid</button><button type="button">Volledig scherm</button>`),
  "/captcha.html": page("Controle", `<p>Geen robot</p>`),
  "/media.html": page("Met video - Proefsite", `<main><h1>Met video</h1><audio controls src="data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA=="></audio><a href="/over.html">Na de video</a></main>`),
  // An id that differs with every load, and a state that is set a moment after the click.
  "/wissel.html": page("Wisselend id - Proefsite", `<main><h1>Wisselend id</h1><button type="button" id="k__RANDOM__" aria-expanded="false">Toon meer</button><p id="meer" hidden>Meer tekst</p>
<script>document.querySelector("main button").addEventListener("click", (event) => setTimeout(() => { event.target.setAttribute("aria-expanded", "true"); document.getElementById("meer").hidden = false; }, 700));</script></main>${BANNER}`),
  "/dialoog.html": page("Dialoog - Proefsite", `<main><h1>Dialoog</h1><p id="achter">Tekst van de pagina achter het venster.</p><button type="button" id="opent">Open venster</button>
<dialog id="venster"><h2>Venster</h2><p id="binnen">Tekst in het venster.</p><button type="button">Sluiten</button></dialog>
<style>dialog::backdrop { background: rgba(0, 0, 0, 0.6); }</style>
<script>document.getElementById("opent").addEventListener("click", () => document.getElementById("venster").showModal());</script></main>${BANNER}`),
  "/zoek.html": page("Zoeken - Proefsite", `<main><h1>Zoeken</h1><form action="/resultaat.html" method="get"><label for="q">Zoekterm</label><input type="search" id="q" name="q"><button type="submit">Zoek</button></form></main>${BANNER}`),
  "/resultaat.html": page("Resultaten - Proefsite", `<main><h1>Resultaten</h1><p>Drie resultaten gevonden.</p></main>${BANNER}`),
  "/gooit.html": page("Gooit focus weg - Proefsite", `<main><h1>Focus</h1><a href="/over.html" id="een">Eerste</a> <a href="/over.html" id="twee" onfocus="this.blur()">Gooit weg</a> <a href="/over.html" id="drie">Derde</a></main>`),
  "/plain.html": page("Zonder melding - Proefsite", `<main tabindex="-1" id="inhoud"><h1>Zonder melding</h1><a href="/over.html">Voor de video</a><iframe src="/player.html" title="Video" width="400" height="120"></iframe><a href="/over.html#na">Na de video</a></main>`),
};

let server: Server;
let origin: string;
let run: string;

before(async () => {
  server = createServer((request, response) => {
    const body = PAGES[new URL(request.url ?? "/", "http://site").pathname]?.replaceAll("__RANDOM__", String(Math.random()).slice(2, 10));
    response.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body ?? page("Niet gevonden - Proefsite", "<main><h1>Niet gevonden</h1></main>"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = mkdtempSync(join(tmpdir(), "loep-model-"));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(run, { recursive: true, force: true });
});

const CONTEXT: ModelContext = {
  pages: ["https://site.nl/", "https://site.nl/contact/"],
  frames: ["https://captcha.example/anchor?k=1", "https://captcha.example/anchor?k=2", "https://video.example/embed/abc"],
  recipes: { "blocker-cookies": { width: 1280, steps: 1, url: "https://site.nl/" }, "component-menu": { width: 360, steps: 2, url: "https://site.nl/" }, leeg: { width: 1280, steps: 0, url: "https://site.nl/" } },
  observations: new Set(["verken-0003"]),
};

const DESCRIPTION = "Dit is de website van de gemeente Voorbeeld. Inwoners lezen er nieuws en informatie over producten van de gemeente, zoals een paspoort of een vergunning. Ze kunnen op de site zoeken en een contactformulier invullen. Voor het onderzoek valt op dat er bij het eerste bezoek een cookiemelding over de pagina ligt en dat het menu op een smal scherm achter een knop zit.";

function validModel(): SiteModel {
  return {
    version: 1,
    baseUrl: "https://site.nl/",
    descriptionNl: DESCRIPTION,
    pageTypes: [
      { id: "start", descriptionNl: "Startpagina", representative: "https://site.nl/", pages: ["https://site.nl/"] },
      { id: "tekst", descriptionNl: "Tekstpagina", representative: "https://site.nl/contact/", pages: ["https://site.nl/contact/"] },
    ],
    blockers: [{ id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#banner" } }],
    components: [
      { id: "menu", type: "menu", descriptionNl: "Menu achter een knop", pageTypes: ["start", "tekst"], viewport: { maxWidth: 767 }, recipe: "component-menu", postcondition: { kind: "expanded", selector: "#menuknop" } },
      { id: "kaart", type: "other", descriptionNl: "Kaart", pageTypes: ["start"], viewport: null, recipe: null, postcondition: null, notOpenedNl: "Slepen kan niet met de commando's." },
    ],
    processes: [],
    frames: [
      { address: "https://captcha.example/anchor", class: "no-content", descriptionNl: "Hulpvenster van de captcha", reasonNl: "Leeg venster dat de bezoeker niets toont." },
      { address: "https://video.example/embed/abc", class: "own-content", descriptionNl: "Videospeler", reasonNl: "Eigen video van de gemeente in een speler die ze heeft gekozen." },
    ],
    notesNl: [],
  };
}

test("a complete site model passes the validator", () => {
  assert.deepEqual(validateSiteModel(validModel(), CONTEXT), []);
  assert.deepEqual(validateSiteModel({ ...validModel(), acceptedGaps: [{ check: "tab-trapped", page: "https://site.nl/", reasonNl: "Echte toetsenbordval in het menu", observation: "verken-0003", decidedBy: "verkenner" }] }, CONTEXT), []);
});

test("the validator refuses a model that does not fit the run", () => {
  const broken = (change: (model: SiteModel) => void, expected: RegExp): void => {
    const model = validModel();
    change(model);
    const problems = validateSiteModel(model, CONTEXT);
    assert.ok(problems.some((problem) => expected.test(problem)), `expected ${expected} in ${JSON.stringify(problems)}`);
  };
  broken((model) => void delete model.descriptionNl, /descriptionNl ontbreekt/);
  broken((model) => void (model.descriptionNl = "Website van een gemeente."), /descriptionNl telt 4 woorden; het moeten er tussen 40 en 140 zijn/);
  broken((model) => void (model.descriptionNl = `${DESCRIPTION} ${DESCRIPTION} ${DESCRIPTION}`), /het moeten er tussen 40 en 140 zijn/);
  broken((model) => void (model.descriptionNl = DESCRIPTION.replace("gemeente Voorbeeld", "<naam van de organisatie>")), /lijkt \("<naam van de organisatie>"\)/);
  broken((model) => void (model.descriptionNl = DESCRIPTION.replace("Inwoners lezen", "TODO inwoners lezen")), /invulplek/);
  broken((model) => void model.pageTypes.pop(), /1 pagina's staan in geen enkel paginatype/);
  broken((model) => void model.pageTypes[1]!.pages.push("https://site.nl/"), /staat ook in paginatype "start"/);
  broken((model) => void (model.pageTypes[0]!.representative = "https://site.nl/contact/"), /representative moet een van de pages zijn/);
  broken((model) => void model.pageTypes[0]!.pages.push("https://elders.nl/"), /is geen pagina van deze run/);
  broken((model) => void (model.blockers[0]!.recipe = "bestaat-niet"), /geen bewaarde toestand "bestaat-niet"/);
  broken((model) => void (model.blockers[0]!.recipe = "leeg"), /heeft geen stappen/);
  broken((model) => void (model.blockers[0]!.postcondition = { kind: "gone" }), /vraagt een selector/);
  broken((model) => void (model.blockers[0]!.postcondition = { kind: "weg" } as never), /postcondition\.kind moet een van/);
  broken((model) => void (model.components[0]!.pageTypes = ["onbekend"]), /paginatype "onbekend" bestaat niet/);
  broken((model) => void (model.components[0]!.viewport = { maxWidth: 320 }), /bewaard op 360 pixels breed/);
  broken((model) => void delete model.components[1]!.notOpenedNl, /zonder recipe is notOpenedNl verplicht/);
  broken((model) => void (model.components[1]!.id = "menu"), /id "menu" komt twee keer voor/);
  broken((model) => void model.frames.pop(), /het venster https:\/\/video\.example\/embed\/abc is niet ingedeeld/);
  broken((model) => void (model.frames[0]!.address = "https://captcha.example/anchor?k=1"), /address is het adres zonder query/);
  broken((model) => void (model.frames[0]!.class = "extern" as never), /class moet een van/);
  // A model from before frames were told apart by who has a say over them has to choose again, and is told from what.
  broken((model) => void (model.frames[1]!.class = "embedded" as never), /frames\[1\]: class "embedded" is de indeling van een eerder sitemodel.*own-content \(eigen inhoud in een eigen of gekozen speler\).*reasonNl/);
  broken((model) => void delete model.frames[1]!.reasonNl, /frames\[1\]: reasonNl ontbreekt/);
  broken((model) => void model.components.push({ id: "vak", type: "other", descriptionNl: "Vak ik ben geen robot", pageTypes: ["start"], viewport: null, frame: "https://captcha.example/anchor", recipe: null, postcondition: null, notOpenedNl: "Het venster bleef leeg." }), /heeft iets om te bedienen en is dus geen no-content/);
  // A person may set the class and says who decided; a postcondition may be checked inside a frame that the model names.
  assert.deepEqual(validateSiteModel({ ...validModel(), frames: validModel().frames.map((frame) => ({ ...frame, decidedBy: "toegankelijkheidscoördinator" })) }, CONTEXT), []);
  broken((model) => void (model.components[0]!.postcondition = { kind: "expanded", selector: "#menuknop", frame: "https://elders.example/venster" }), /postcondition\.frame "https:\/\/elders\.example\/venster" staat niet in frames/);
  broken((model) => void (model.acceptedGaps = [{ check: "tab-trapped", page: "https://site.nl/", reasonNl: "val", observation: "verken-0099", decidedBy: "verkenner" }]), /waarneming verken-0099 bestaat niet/);
  // A component that does not open on a page type is accepted for that component only.
  broken((model) => void (model.acceptedGaps = [{ check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/", reasonNl: "staat er niet", observation: "verken-0003", decidedBy: "verkenner" }]), /acceptedGaps\[0\]: bij "component-not-opened-on-page-type" hoort "component", het id van het onderdeel/);
  broken((model) => void (model.acceptedGaps = [{ check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/", component: "bestaat-niet", reasonNl: "staat er niet", observation: "verken-0003", decidedBy: "verkenner" }]), /onderdeel "bestaat-niet" staat niet in components/);
  broken((model) => void (model.acceptedGaps = [{ check: "tab-trapped", page: "https://site.nl/", component: "menu", reasonNl: "val", observation: "verken-0003", decidedBy: "verkenner" }]), /"component" hoort alleen bij "component-not-opened-on-page-type"/);
  assert.deepEqual(validateSiteModel({ ...validModel(), acceptedGaps: [{ check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/", component: "menu", reasonNl: "staat er niet", observation: "verken-0003", decidedBy: "verkenner" }] }, CONTEXT), []);
  // Every exception says who decided it: the explorer, or a person.
  assert.deepEqual(validateSiteModel({ ...validModel(), acceptedGaps: [{ check: "tab-trapped", page: "https://site.nl/", reasonNl: "val", observation: "verken-0003", decidedBy: "persoon" }] }, CONTEXT), []);
  const decidedByNl = /acceptedGaps\[0\]: "decidedBy" zegt wie de uitzondering heeft vastgesteld: "verkenner" als de verkenner dat deed, "persoon" als een persoon dat zelf deed; zonder telt de regel niet/;
  broken((model) => void (model.acceptedGaps = [{ check: "tab-trapped", page: "https://site.nl/", reasonNl: "val", observation: "verken-0003" } as never]), decidedByNl);
  broken((model) => void (model.acceptedGaps = [{ check: "tab-trapped", page: "https://site.nl/", reasonNl: "val", observation: "verken-0003", decidedBy: "beheerder" } as never]), decidedByNl);
  assert.deepEqual(validateSiteModel([], CONTEXT), ["site.json is geen JSON-object"]);
  assert.ok(validateSiteModel({ ...validModel(), extra: 1 }, CONTEXT).includes('onbekend veld "extra"'));
});

test("the validator tests a read request: narrow, seen held back in its observation, and not also a request a component misses", () => {
  const read = { id: "zoekdienst", method: "POST" as const, origin: "https://zoek.example.nl", path: "/multi_search", service: "typesense" as const, reasonNl: "De zoekvraag van het zoekveld gaat naar de zoekdienst en wijzigt niets.", observation: "verken-0003" };
  const context: ModelContext = { ...CONTEXT, requestsSeen: { "verken-0003": [{ method: "POST", url: "https://zoek.example.nl/multi_search?x-typesense-api-key=abc", search: ["typesense"] }] } };
  assert.deepEqual(validateSiteModel({ ...validModel(), readRequests: [read] }, context), []);
  const problems = (model: SiteModel, given = context): string[] => validateSiteModel(model, given);
  assert.match(problems({ ...validModel(), readRequests: [{ ...read, path: "/*" }] }).join(" | "), /eindigt op een jokerteken/);
  assert.match(problems({ ...validModel(), readRequests: [{ ...read, observation: "verken-0099" }] }).join(" | "), /waarneming verken-0099 bestaat niet/);
  assert.match(problems({ ...validModel(), readRequests: [read] }, { ...context, requestsSeen: { "verken-0003": [{ method: "POST", url: "https://zoek.example.nl/elders" }] } }).join(" | "), /in waarneming verken-0003 is geen POST naar https:\/\/zoek\.example\.nl\/multi_search tegengehouden/);
  // The body of the request in that observation has to have the form of the service the rule names.
  assert.match(problems({ ...validModel(), readRequests: [read] }, { ...context, requestsSeen: { "verken-0003": [{ method: "POST", url: "https://zoek.example.nl/multi_search", search: [] }] } }).join(" | "), /loep herkende de body van dat verzoek in waarneming verken-0003 niet als zoekvraag aan typesense; een verzoek waarvan loep de body niet herkent, blijft tegengehouden/);
  assert.match(problems({ ...validModel(), readRequests: [{ ...read, service: "graphql" }] }).join(" | "), /niet als zoekvraag aan graphql \(wel als typesense\)/);
  assert.match(problems({ ...validModel(), readRequests: [read, { ...read, id: "nog-een" }] }).join(" | "), /staat twee keer in readRequests/);
  assert.match(problems({ ...validModel(), readRequests: [{ ...read, id: "menu" }] }).join(" | "), /id "menu" komt twee keer voor/);
  const missing = validModel();
  missing.components[1] = { ...missing.components[1]!, blockedRequests: [{ method: "POST", address: "zoek.example.nl/multi_search" }] };
  assert.match(problems({ ...missing, readRequests: [read] }).join(" | "), /onderdeel "kaart" noemt POST zoek\.example\.nl\/multi_search onder blockedRequests, maar readRequests\[0\] laat dat verzoek door/);
  assert.match(problems({ ...validModel(), readRequests: {} as never }).join(" | "), /readRequests is een lijst/);
});

const inventoryPage = (url: string, foundVia: string[], contentHash = url): InventoryPage => ({ url, slug: url.replace(/\W+/g, "-"), status: 200, title: url, lang: "nl", templateHash: "t", contentHash, foundVia, counts: {} });

test("a site model from before the description was asked still loads, and gives no description", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-old-model-"));
  try {
    const { descriptionNl: _description, ...old } = validModel();
    const text = JSON.stringify(old);
    writeFileSync(join(dir, "site.json"), text);
    writeFileSync(join(dir, "site-check.json"), JSON.stringify({ ok: true, siteSha256: createHash("sha256").update(text).digest("hex"), checkedAt: "", problems: [], replays: [] }));
    assert.equal((await loadSiteModel(dir))?.baseUrl, "https://site.nl/", "the sweep keeps working with a model that passed its check earlier");
    assert.equal(await siteDescription(dir), null, "the report then leaves the section out");
    assert.equal(await siteDescription(join(dir, "bestaat-niet")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the sample leaves out the frames that do not count and counts a repeated frame once", () => {
  const pages = [
    inventoryPage("https://site.nl/", ["start"]),
    inventoryPage("https://site.nl/contact/", ["link"]),
    inventoryPage("https://captcha.example/anchor?k=1", ["iframe:https://site.nl/"]),
    inventoryPage("https://captcha.example/anchor?k=2", ["iframe:https://site.nl/contact/"]),
    inventoryPage("https://video.example/embed/abc?start=1", ["iframe:https://site.nl/"]),
    inventoryPage("https://video.example/embed/abc?start=2", ["iframe:https://site.nl/contact/"]),
  ];
  const found: Inventory = { baseUrl: "https://site.nl/", origin: "https://site.nl", sitemapUrls: 0, notFoundProbe: "https://site.nl/404", pages, skipped: [], totals: {} };
  const without = buildSample(found, "seed");
  assert.equal(without.items.length, 6, "without a site model every frame is a page");
  assert.equal(without.excludedFrames, undefined);
  const withModel = buildSample(found, "seed", validModel());
  assert.deepEqual(withModel.items.map((item) => item.url), ["https://site.nl/", "https://site.nl/contact/", "https://video.example/embed/abc?start=1"]);
  assert.deepEqual(withModel.items[2]!.aliases, ["https://video.example/embed/abc?start=2"]);
  assert.equal(withModel.items[2]!.kind, "embedded");
  assert.deepEqual(withModel.excludedFrames, [{ address: "https://captcha.example/anchor", descriptionNl: "Hulpvenster van de captcha", copies: 2, kindNl: "techniek die de bezoeker niets toont", reasonNl: "Leeg venster dat de bezoeker niets toont." }]);
  assert.equal(withModel.populationSize, 3);
  assert.match(withModel.note, /2 ingesloten vensters tellen volgens het sitemodel niet mee als pagina \(Hulpvenster van de captcha: techniek die de bezoeker niets toont\)/);
  // An earlier model is still read with what its classes meant: third-party was no page, embedded was.
  const earlier = { ...validModel(), frames: [{ address: "https://captcha.example/anchor", class: "third-party", descriptionNl: "Captcha" }, { address: "https://video.example/embed/abc", class: "embedded", descriptionNl: "Videospeler" }] } as unknown as SiteModel;
  assert.deepEqual(buildSample(found, "seed", earlier).items.map((item) => item.url), withModel.items.map((item) => item.url));
  assert.deepEqual([frameStanding({ class: "vendor-component" }).counts, frameStanding({ class: "vendor-component" }).owner, frameStanding({ class: "outside-control" }).counts, frameStanding({ class: "map" }).counts], [true, "leverancier", false, false]);
});

// Synthetic run data for the gate: only what the fixed checks read.
const element = (path: string, extra: Record<string, unknown> = {}) => ({ tag: "a", path: [path], box: { x: 0, y: 0, width: 100, height: 20 }, visible: true, text: path, region: "main", ax: { role: "link", name: path, ignored: false, properties: { focusable: true } }, ...extra });
function gatePage(label: string, url: string, options: { links?: number; reached?: number; outcome?: string; kind?: string; status?: number | null; overlay?: number } = {}): PageData {
  const links = Array.from({ length: options.links ?? 10 }, (_, index) => element(`a${index}`));
  return {
    label,
    item: { url, kind: options.kind ?? "structured", status: options.status === undefined ? 200 : options.status, slug: label, templateHash: label, reason: "vooraf opgegeven pagina" },
    dir: `pages/${label}`,
    facts: { links, controls: [], counts: { elements: 10 } },
    tabwalk: { outcome: options.outcome ?? "completed", stopCount: options.reached ?? links.length, stops: links.slice(0, options.reached ?? links.length) },
    // Everything the sweep owes for a page is there, unless a test takes it away.
    tabwalkDark: { outcome: "completed", stopCount: 0, stops: [] },
    tabwalkNarrow: { outcome: "completed", stopCount: 0, stops: [] },
    content: {},
    reflow: { content: {} },
    zoom200: { content: {} },
    portrait: { content: {} },
    textspacing: { controls: {} },
    narrow: { links: [], controls: [] },
    smallest: { viewport: { width: 320, height: 640 }, targets: [], links: [], controls: [], textspacing: { controls: {} } },
    engines: { light: {}, dark: {} },
    order: {},
    order320: {},
    spacedText: { candidates: [] },
    languages: { minWords: 5, textAlternatives: [] },
    pictures: { pictures: [], recognised: 0 },
    widths: { widthsTried: [], breakpoints: [], controls: [], measuredAt: [] },
    ...(options.overlay === undefined ? {} : { overlays: options.overlay === 0 ? [] : [{ tag: "div", path: ["#banner"], text: "Cookies", position: "fixed", share: options.overlay }] }),
  } as unknown as PageData;
}
const gateRun = (pages: PageData[], extra: Partial<RunData> = {}): RunData =>
  ({ pages, dir: "", inventory: { baseUrl: "https://site.nl/", notFoundProbe: "https://site.nl/404", skipped: [], totals: {} }, sample: { items: [] }, states: { dialogs: [], skipped: [], singleKeys: { states: [] }, hoverCoverage: { kinds: 0, notExamined: 0, narrowPages: [], states: [] }, downEventCoverage: { notExamined: 0, narrowPages: [], states: [] } }, contrast: pages.flatMap((entry) => ["light", "dark"].flatMap((scheme) => [{ slug: entry.item.slug, scheme, hoverFocus: { controls: 0, measured: 0, withoutText: 0, fromPicture: 0, rows: [] } }, { slug: entry.item.slug, scheme, width: 320 }])), ...extra }) as unknown as RunData;
const names = (run: RunData): string[] => gateChecks(run).gaps.map((gap) => `${gap.check}${gap.page ? `:${gap.page}` : ""}`);

test("the gate passes a run in which every check holds", () => {
  const checked = gateChecks(gateRun([gatePage("P1", "https://site.nl/"), gatePage("P2", "https://site.nl/contact/")]));
  assert.deepEqual(checked.gaps, []);
  assert.ok(checked.checks.every((check) => check.ok));
});

test("the gate warns, without a gap, for each tagged pdf whose tag text was not read", () => {
  const document = (label: string, pdf: { tagged: boolean; tagTextRead: boolean } | undefined) => ({ label, item: { url: `https://site.nl/${label}.pdf` }, facts: { status: "read", ...(pdf ? { pdf } : {}) } });
  const checked = gateChecks(gateRun([gatePage("P1", "https://site.nl/")], { documents: [document("D01", { tagged: true, tagTextRead: false }), document("D02", { tagged: true, tagTextRead: true }), document("D03", { tagged: false, tagTextRead: false }), document("D04", undefined)] as unknown as RunData["documents"] }));
  assert.deepEqual(checked.gaps, []);
  assert.deepEqual(checked.warnings.map((warning) => [warning.check, warning.page]), [["document-tag-text-not-read", "D01"]]);
});

test("the gate flags a Tab walk that reached less than the threshold, and not one just above it", () => {
  assert.equal(MIN_TAB_REACH, 0.5);
  assert.deepEqual(names(gateRun([gatePage("P1", "https://site.nl/", { links: 10, reached: 4 })])), ["tab-reach:P1"]);
  assert.deepEqual(names(gateRun([gatePage("P1", "https://site.nl/", { links: 10, reached: 5 })])), []);
  assert.deepEqual(names(gateRun([gatePage("P1", "https://site.nl/", { links: 4, reached: 0 })])), [], "too few controls on the page to say anything");
  assert.deepEqual(names(gateRun([gatePage("P1", "https://site.nl/", { outcome: "trapped" })])), ["tab-trapped:P1"]);
});

test("the gate flags a walk that went round inside a banner and called itself completed", () => {
  // The banner of the clean fixture twin: a modal that holds focus. Three stops, all inside it, on a page with many links.
  const inBanner = (label: string): PageData => {
    const made = gatePage(label, `https://site.nl/${label}`, { links: 12, reached: 0 });
    const stops = ["#cookiemelding > div:nth-of-type(2) > button:nth-of-type(1)", "#cookiemelding > div:nth-of-type(2) > button:nth-of-type(2)", "#cookiemelding > div:nth-of-type(2) > button:nth-of-type(3)"].map((path) => element(path));
    // Behind a modal the rest of the page is hidden from assistive technology, so the share of focusable elements reached says nothing.
    for (const link of made.facts.links) (link.ax as { ignored: boolean }).ignored = true;
    return { ...made, tabwalk: { outcome: "completed", stopCount: 3, stops } } as unknown as PageData;
  };
  assert.deepEqual(names(gateRun([inBanner("P1"), inBanner("P2")])), ["tab-contained:P1", "tab-contained:P2"]);
  const spread = gatePage("P1", "https://site.nl/", { links: 12, reached: 0 });
  assert.deepEqual(names(gateRun([{ ...spread, tabwalk: { outcome: "completed", stopCount: 3, stops: [element("#header > a"), element("#inhoud > p > a"), element("#footer > a")] } } as unknown as PageData])).filter((name) => name.startsWith("tab-contained")), [], "stops spread over the page are not one block");
  assert.equal(commonBlock(["#menu > li:nth-of-type(1) > a", "#menu > li:nth-of-type(2) > a"]), "#menu");
  assert.equal(commonBlock(["html > body > a", "html > body > main > a"]), null);
});

test("the gate reports missing coverage, and what needs a write request as a limitation", () => {
  const withModel = (pages: PageData[], extra: Partial<SiteStates> = {}): RunData => gateRun(pages, { siteModel: validModel(), siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states: [], ...extra } });
  const complete = (label: string): PageData => gatePage(label, `https://site.nl/${label}`);
  assert.deepEqual(names(withModel([complete("P1")])), []);
  // A frame that was named but could not be operated is a limitation; one that a recipe operates is not.
  const withPlayer = (recipe: string | null): RunData => {
    const model = validModel();
    model.components.push({ id: "speler", type: "player", descriptionNl: "Speler in een venster", pageTypes: ["start"], viewport: null, frame: "https://video.example/embed/abc", recipe, postcondition: recipe ? { kind: "visible", selector: "[aria-pressed=true]", frame: "https://video.example/embed/abc" } : null, ...(recipe ? {} : { notOpenedNl: "Het venster blijft leeg zonder cookies van de dienst." }) });
    return gateRun([complete("P1")], { siteModel: model, siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states: [] } });
  };
  assert.deepEqual(gateChecks(withPlayer(null)).limitations.map((gap) => [gap.check, gap.state]), [["frame-not-operated", "component-speler"]]);
  assert.match(gateChecks(withPlayer(null)).limitations[0]!.missingNl, /is niet bediend: Het venster blijft leeg zonder cookies van de dienst\./);
  assert.deepEqual(gateChecks(withPlayer("component-menu")).limitations, []);
  // An embedded window that the sweep could not measure where it stands was opened on its own: reported, and the run goes on.
  const apart = { ...gatePage("P2", "https://video.example/embed/abc", { kind: "embedded", links: 0 }), placement: { inPlaceOn: null, apartNl: "op https://site.nl/ stond bij het meten geen venster met dit adres, of het laadde daar niet" } };
  const reported = gateChecks(withModel([complete("P1"), apart]));
  assert.deepEqual(reported.limitations.map((gap) => [gap.check, gap.page]), [["frame-measured-apart", "P2"]]);
  assert.match(reported.limitations[0]!.missingNl, /niet gemeten op de pagina waar het staat, maar los geopend: op https:\/\/site\.nl\/ stond/);
  const { tabwalkNarrow: _narrow, ...withoutNarrow } = complete("P1");
  const missing = gateChecks(withModel([withoutNarrow as PageData]));
  assert.deepEqual(missing.gaps.map((gap) => gap.check), ["coverage"]);
  assert.match(missing.gaps[0]!.missingNl, /tabWalkWithFocusNarrow/);
  // The page at 320 wide, and the contrast there.
  const { smallest: _smallest, ...withoutSmallest } = complete("P1");
  assert.match(gateChecks(withModel([withoutSmallest as PageData])).gaps[0]!.missingNl, /targetSize320, textSpacing320, visibleTextAndNames320, controlsWithTextSpacing\. Draai collect opnieuw/);
  const wideOnly = withModel([complete("P1")]);
  wideOnly.contrast = wideOnly.contrast!.filter((entry) => entry.width === undefined);
  assert.match(gateChecks(wideOnly).gaps[0]!.missingNl, /contrastLight320, contrastDark320\)\. Draai contrast opnieuw/);
  // What a state owes: sizes, the spacing in force before it opened, and the dark scheme.
  const opened = (files: Record<string, string>, more: Partial<SiteStates["states"][number]> = {}): SiteStates["states"][number] => ({ id: "component-menu", kind: "component", modelId: "menu", pageTypes: ["start"], url: "https://site.nl/P1", viewport: { width: 1280, height: 800 }, reached: true, reasonNl: null, stillReachedAfterMeasuring: true, dir: null, files: { screenshot: "s.png", engines: "e.json", facts: "f.json", contrast: "c.json", tabwalk: "t.json", ...files }, engineSummary: null, contrast: null, largestOverlayShare: 0, perPageType: [], ...more });
  const all = { targets: "g.json", textSpacing: "x.json", contrastDark: "d.json", order: "o.json", text: "t.txt", languages: "l.json", pictures: "p.json", focusCovered: "k.json" };
  assert.deepEqual(names(withModel([complete("P1")], { states: [opened(all)] })), []);
  const older = gateChecks(withModel([complete("P1")], { states: [opened({})] }));
  assert.match(older.gaps[0]!.missingNl, /contrastDark, targetSize, textSpacingBeforeOpening, orderCompared, textAndLanguage, imageTextRecognised, focusCoveredBackwardAndArrows/);
  const notDark = gateChecks(withModel([complete("P1")], { states: [opened({ ...all, contrastDark: undefined } as unknown as Record<string, string>, { variantsNotReached: [{ variant: "contrastDark", reasonNl: "stap 1 (click) vond het element niet terug" }] })] }));
  assert.deepEqual(notDark.gaps, [], "a state that was tried on dark and did not open is no gap of the sweep");
  assert.deepEqual(notDark.warnings.map((gap) => [gap.check, gap.state]), [["state-not-reopened", "component-menu"]]);
  // The keys in the states, and the limits of the probes.
  const probes = (states: Record<string, unknown>): RunData => ({ ...withModel([complete("P1")], { states: [opened(all)] }), states: { dialogs: [], skipped: [], ...states } }) as unknown as RunData;
  assert.match(gateChecks(probes({ singleKeys: {}, hoverCoverage: { kinds: 0, narrowPages: [], states: [] }, downEventCoverage: { narrowPages: [], states: [] } })).gaps[0]!.missingNl, /toetsenproef is niet gedaan in de toestanden/);
  const noisy = gateChecks(probes({ singleKeys: { states: [{ state: "component-menu", examined: false, reasonNl: "het onderdeel sloot" }] }, downEventCoverage: { limit: 300, notExamined: 4, narrowPages: [], states: [] }, hoverCoverage: { limit: 400, kinds: 9, notExamined: 2, narrowPages: [], states: [] } }));
  assert.deepEqual(noisy.gaps, []);
  assert.deepEqual(noisy.warnings.map((gap) => gap.check), ["keys-not-pressed-in-state", "press-probe-limit", "hover-probe-limit"]);
  assert.match(noisy.warnings[1]!.missingNl, /4 soorten bedieningselementen niet onderzocht \(grens van 300\)/);
  const limited = gateChecks(withModel([complete("P1")], { refusedWrites: [{ url: "https://site.nl/P1", method: "POST", address: "site.nl/core/admin-ajax.php", count: 2 }, { url: "https://site.nl/P1", method: "POST", address: "meet.example/collect", count: 9 }] }));
  assert.deepEqual(limited.gaps, []);
  assert.deepEqual(limited.limitations.map((gap) => [gap.check, gap.page]), [["needs-write-request", "P1"]]);
  assert.match(limited.limitations[0]!.missingNl, /Niet onderzoekbaar zonder schrijfverzoek/);
  assert.ok(!limited.limitations[0]!.missingNl.includes("meet.example"), "a refused beacon of a third party takes no content away and is not reported");
});

test("the gate sends back a run in which the measurements that close a criterion are missing", () => {
  const withModel = (pages: PageData[], extra: Partial<RunData> = {}, states: SiteStates["states"] = []): RunData => gateRun(pages, { siteModel: validModel(), siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states }, ...extra });
  const complete = gatePage("P1", "https://site.nl/");
  const missing = (run: RunData): string[] => gateChecks(run).gaps.filter((gap) => gap.check === "coverage").map((gap) => gap.missingNl);
  assert.deepEqual(missing(withModel([complete])), []);
  // A page without the content at the other sizes, without the controls of the narrow window and without the controls that come with the wider spacing.
  const older = { ...complete, content: undefined, narrow: undefined, textspacing: {} } as unknown as PageData;
  assert.match(missing(withModel([older]))[0]!, /contentComparedAt320, contentComparedAt200Percent, contentComparedInPortrait, controlsInNarrowWindow, controlsWithTextSpacing/);
  // A page without the order per page, the text in its pictures and the search between the widths; a run without the colours under the pointer.
  const withoutNew = { ...complete, order: undefined, pictures: { pictures: [], recognised: 0, unavailableNl: "Tesseract ontbreekt" }, widths: undefined } as unknown as PageData;
  assert.match(missing(withModel([withoutNew]))[0]!, /: orderComparedWide, imageTextRecognised, controlsBetweenWidthsSearched\. Draai collect/);
  const atRest = withModel([complete]);
  atRest.contrast = atRest.contrast!.map(({ hoverFocus: _hoverFocus, ...entry }) => entry);
  assert.match(missing(atRest)[0]!, /\(contrastHoverFocusLight, contrastHoverFocusDark\)\. Draai contrast opnieuw/);
  // The pointer probes as an older toolbox left them: by control up to a limit, in the default window and the default state only.
  const olderStates = { dialogs: [], skipped: [], singleKeys: { states: [] }, hoverCoverage: { limit: 150, found: 387, examined: 150, notExamined: 237, notExaminedExamples: [] }, downEventCoverage: { notExamined: 0 } } as unknown as RunData["states"];
  const found = missing(withModel([complete], { states: olderStates }));
  assert.equal(found.length, 3);
  assert.match(found[0]!, /niet per soort bedieningselement/);
  assert.match(found[1]!, /niet gedaan in het smalle venster/);
  assert.match(found[2]!, /niet gedaan in de toestanden van het sitemodel/);
  // A component that was not opened on its page types, and one that was but did not open on one of them.
  const component = (perPageType?: unknown) => ({ id: "component-menu", kind: "component", modelId: "menu", pageTypes: ["start", "tekst"], url: "https://site.nl/", viewport: { width: 360, height: 740 }, reached: true, reasonNl: null, stillReachedAfterMeasuring: true, dir: "site-states/component-menu", files: { screenshot: "s", engines: "e", facts: "f", tabwalk: "t", contrast: "c", contrastDark: "d", targets: "g", textSpacing: "x", order: "o", text: "t", languages: "l", pictures: "p", focusCovered: "k" }, engineSummary: {}, contrast: null, largestOverlayShare: 0, ...(perPageType ? { perPageType } : {}) }) as unknown as SiteStates["states"][number];
  assert.match(missing(withModel([complete], {}, [component()]))[0]!, /openedPerPageType/);
  const instances = [{ pageType: "start", url: "https://site.nl/", viewport: { width: 360, height: 740 }, reached: true, reasonNl: null, opened: ["Start"], screenshot: "a.png", rotatedQuarterTurn: 0 }, { pageType: "tekst", url: "https://site.nl/contact/", viewport: { width: 360, height: 740 }, reached: false, reasonNl: "stap 1 (click) vond het element niet terug", opened: [], screenshot: null, rotatedQuarterTurn: 0 }];
  const partly = gateChecks(withModel([complete], {}, [component(instances)]));
  assert.deepEqual(partly.gaps.filter((gap) => gap.check === "coverage"), [], "tried on every page type: nothing is owed");
  const notOpened = partly.gaps.find((gap) => gap.check === "component-not-opened-on-page-type")!;
  assert.match(notOpened.missingNl, /paginatype "tekst" niet open in een staand venster: stap 1/);
  assert.ok(notOpened.missingNl.endsWith(notOpenedAdviceNl("stap 1 (click) vond het element niet terug")));
  assert.equal(notOpened.component, "menu", "the gap names the component, so that an accepted gap can be matched to it");
  // Accepted as how the site is, the dossier of every criterion says the component was not measured on that page type, and who decided.
  const notMeasured = (run: RunData, criterion: string) => (siteStates(run, criterion) as { componentsNotOpenedOnPageType?: { note: string; rows: Record<string, unknown>[] } }).componentsNotOpenedOnPageType;
  assert.equal(notMeasured(withModel([complete], {}, [component(instances)]), "1.4.3"), undefined, "nothing accepted: the gate has the gap, the dossier adds nothing");
  const accepted = withModel([complete], {}, [component(instances)]);
  accepted.siteModel!.acceptedGaps = [{ check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "menu", reasonNl: "Het menu gaat op deze pagina echt niet open.", observation: "verken-0003", decidedBy: "verkenner" }];
  for (const criterion of ["1.4.3", "2.1.1", "3.2.3"]) {
    const entry = notMeasured(accepted, criterion)!;
    assert.match(entry.note, /niet geopend en niet gemeten/);
    assert.deepEqual(entry.rows.map((row) => [row.component, row.pageType, row.triedOn, row.notOpenedNl, row.acceptedNl, row.decidedBy]), [["menu", "tekst", "https://site.nl/contact/", "stap 1 (click) vond het element niet terug", "Het menu gaat op deze pagina echt niet open.", "verkenner"]]);
  }
  // An exception for another component, or one that does not say who decided it, does not count, as at the gate.
  accepted.siteModel!.acceptedGaps = [{ ...accepted.siteModel!.acceptedGaps[0]!, component: "zoeken" }];
  assert.equal(notMeasured(accepted, "1.4.3"), undefined);
  const { decidedBy: _decidedBy, ...undecided } = { ...accepted.siteModel!.acceptedGaps[0]!, component: "menu" };
  accepted.siteModel!.acceptedGaps = [undecided as never];
  assert.equal(notMeasured(accepted, "1.4.3"), undefined);
});

test("the gate flags pages that did not load and frames that are counted as pages", () => {
  assert.deepEqual(names(gateRun([gatePage("P1", "https://site.nl/", { status: 500 }), gatePage("P2", "https://site.nl/404", { status: 404 })])), ["pages-loaded:P1"], "the page that is meant to be missing is no gap");
  const one = [gatePage("P1", "https://video.example/embed/abc", { kind: "embedded", links: 0 }), ...["a", "b", "c", "d"].map((path, index) => gatePage(`P${index + 2}`, `https://site.nl/${path}`))];
  assert.deepEqual(names(gateRun(one)), [], "one embedded player among five pages is content");
  // With a site model the question is whether each frame was classified.
  assert.deepEqual(names(gateRun(one, { siteModel: { ...validModel(), frames: [] }, siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states: [] } })), ["frames-as-pages:P1"]);
});

test("an address whose navigation started a download is no page that failed to load: a warning, not a gap", () => {
  const skipped = [
    { url: "https://site.nl/assets/files/agenda-abc123.ics", reason: "failed to load: page.goto: Download is starting" },
    { url: "https://site.nl/traag", reason: "failed to load: page.goto: Timeout 30000ms exceeded." },
    { url: "https://site.nl/weg", reason: "failed to load: page.goto: net::ERR_CONNECTION_REFUSED at https://site.nl/weg" },
    { url: "https://site.nl/logo.svg", reason: "not an HTML page" },
  ];
  const run = gateRun([gatePage("P1", "https://site.nl/")]);
  (run.inventory as { skipped: typeof skipped }).skipped = skipped;
  const checked = gateChecks(run);
  assert.deepEqual(checked.gaps.map((gap) => [gap.check, gap.url]), [["pages-loaded", "https://site.nl/traag"], ["pages-loaded", "https://site.nl/weg"]]);
  const downloads = checked.warnings.filter((warning) => warning.check === "download-not-a-page");
  assert.deepEqual(downloads.map((warning) => warning.url), ["https://site.nl/assets/files/agenda-abc123.ics"]);
  assert.match(downloads[0]!.missingNl, /download/);
});

test("a frame the model names as a component nobody can operate is a limitation when it does not load, not a gap", () => {
  const pages = [gatePage("P1", "https://video.example/embed/abc?h=1", { kind: "embedded", links: 0, status: 403 }), ...["a", "b", "c", "d"].map((path, index) => gatePage(`P${index + 2}`, `https://site.nl/${path}`))];
  const states = { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states: [] };
  const player = { id: "speler", type: "other", descriptionNl: "Videospeler", pageTypes: ["start"], viewport: null, frame: "https://video.example/embed/abc", recipe: null, postcondition: null, notOpenedNl: "Een controle tegen robots wordt tegengehouden.", blockedRequests: ["POST video.example/challenge"] };
  const withPlayer = gateChecks(gateRun(pages, { siteModel: { ...validModel(), components: [...validModel().components, player] } as unknown as SiteModel, siteStates: states }));
  assert.deepEqual(withPlayer.gaps.filter((gap) => gap.check === "pages-loaded"), []);
  assert.deepEqual(withPlayer.limitations.filter((gap) => gap.check === "frame-not-loaded").map((gap) => gap.page), ["P1"]);
  // Without that entry the frame that did not load is still a gap: the explorer can describe it.
  assert.deepEqual(names(gateRun(pages, { siteModel: validModel(), siteStates: states })).filter((name) => name.startsWith("pages-loaded")), ["pages-loaded:P1"]);
});

test("the gate flags components that did not open, a blocker that stayed and something that covers most pages", () => {
  const state = (id: string, reached: boolean): SiteStates["states"][number] => ({ id: `component-${id}`, kind: "component", modelId: id, pageTypes: ["start"], url: "https://site.nl/", viewport: { width: 1280, height: 800 }, reached, reasonNl: reached ? null : "stap 1 (click) vond het element niet terug", stillReachedAfterMeasuring: reached, dir: null, files: reached ? { screenshot: "s.png", engines: "e.json", facts: "f.json", contrast: "c.json", contrastDark: "d.json", targets: "g.json", textSpacing: "x.json", tabwalk: "t.json", order: "o.json", text: "t.txt", languages: "l.json", pictures: "p.json", focusCovered: "k.json" } : {}, engineSummary: null, contrast: null, largestOverlayShare: 0, ...(reached ? { perPageType: [] } : {}) });
  const withStates = (states: SiteStates["states"], dismissals: SiteStates["dismissals"] = []): RunData => gateRun([gatePage("P1", "https://site.nl/"), gatePage("P2", "https://site.nl/contact/")], { siteModel: validModel(), siteStates: { siteSha256: "", seeded: { blockers: ["cookies"], cookies: 1, storedValues: 0 }, dismissals, states } });
  const four = ["a", "b", "c", "d"].map((id) => state(id, true));
  assert.deepEqual(names(withStates([...four, state("e", false)])), [], "four of five opened: at the threshold");
  assert.equal(gateChecks(withStates([...four, state("e", false)])).warnings.filter((gap) => gap.check === "components-opened").length, 1, "the one that did not open is still reported");
  assert.deepEqual(names(withStates([...four.slice(0, 3), state("e", false)])), ["components-opened:P1"], "three of four is below it");
  // A component that cannot be examined without a write request does not count against the model.
  const blocked = validModel();
  blocked.components[1] = { ...blocked.components[1]!, blockedRequests: [{ method: "POST", address: "site.nl/admin-ajax.php" }] };
  const unexaminable = gateChecks({ ...withStates([...four.slice(0, 3), { ...state("kaart", false), id: "component-kaart" }]), siteModel: blocked });
  assert.deepEqual(unexaminable.gaps, []);
  assert.deepEqual(unexaminable.limitations.map((gap) => gap.check), ["needs-write-request"]);
  assert.deepEqual(names(withStates(four, [{ url: "https://site.nl/contact/", where: "collect:light", blocker: "cookies", dismissed: false, reasonNl: "stap 1 (click) klikken lukt niet" }])), ["blocker-closed:P2"]);

  const covered = (shares: number[]): RunData => gateRun(shares.map((share, index) => gatePage(`P${index + 1}`, `https://site.nl/${index}`, { overlay: share })));
  assert.deepEqual(names(covered([0.3, 0.3, 0.1, 0])), [], "half of the pages is not most of them");
  assert.deepEqual(names(covered([0.3, 0.3, 0.3, 0])), ["overlay:P1"]);
  assert.deepEqual(names(covered([0.15, 0.15, 0.15, 0.15])), [], "a sticky header at the threshold is design");
  // Measured what lies under it: a column next to the content is no gap, however large; one over content still is.
  const none: Covered = { text: 0, ofText: 12, controls: 0, ofControls: 5, example: null };
  const some: Covered = { text: 3, ofText: 12, controls: 1, ofControls: 5, example: "Lees verder" };
  const withCovers = (covers: { top: Covered; scrolled: Covered | null }): RunData => {
    const run = covered([0.3, 0.3, 0.3, 0]);
    for (const page of run.pages) for (const overlay of page.overlays ?? []) overlay.covers = covers;
    return run;
  };
  assert.deepEqual(names(withCovers({ top: none, scrolled: none })), [], "a fixed column next to the content covers nothing");
  assert.deepEqual(names(withCovers({ top: none, scrolled: null })), []);
  assert.match(gateChecks(withCovers({ top: none, scrolled: none })).checks.find((check) => check.name === "overlay")!.noteNl, /op 3 pagina's staat zo'n element naast de inhoud en bedekt het niets/);
  assert.deepEqual(names(withCovers({ top: some, scrolled: none })), ["overlay:P1"]);
  const afterScroll = gateChecks(withCovers({ top: none, scrolled: some }));
  assert.deepEqual(afterScroll.gaps.map((gap) => gap.check), ["overlay"]);
  assert.match(afterScroll.gaps[0]!.missingNl, /Eronder liggen na scrollen 3 van de 12 regels tekst en 1 van de 5 bedieningselementen in het venster, bijvoorbeeld "Lees verder"\./);

});

test("the gate counts a component that only stands between the measured widths as looked at when the sweep opened it there", () => {
  const model = validModel();
  model.components.push({ id: "meer-opties-hulplinks", type: "other", descriptionNl: "Knop 'Meer opties' in de hulplinks van de kop", pageTypes: ["start", "tekst"], viewport: { maxWidth: 767 }, recipe: null, postcondition: null, notOpenedNl: "Op 360 pixels breed was de knop verborgen." });
  const state = (id: string, reached: boolean): SiteStates["states"][number] => ({ id: `component-${id}`, kind: "component", modelId: id, pageTypes: ["start"], url: reached ? "https://site.nl/" : null, viewport: null, reached, reasonNl: reached ? null : "de verkenner kon het niet openen: Op 360 pixels breed was de knop verborgen.", stillReachedAfterMeasuring: reached, dir: null, files: {}, engineSummary: null, contrast: null, largestOverlayShare: 0 });
  const opened = (control: string, failedNl?: string) => ({ control, where: "nav >>> button", controls: failedNl ? [] : ['a "GitHub" [-]'], text: [], tree: "", screenshot: null, ...(failedNl ? { failedNl } : {}) });
  const runWith = (openings: ReturnType<typeof opened>[]): RunData => {
    const page = gatePage("P1", "https://site.nl/");
    page.widths = { widthsTried: [1280, 720, 360, 320], breakpoints: [640, 1008], controls: [], measuredAt: [{ width: 720, screenshot: "between-720.png", opened: openings }] };
    const states = ["a", "b", "c", "d"].map((id) => state(id, true));
    return gateRun([page, gatePage("P2", "https://site.nl/contact/")], { siteModel: model, siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states: [...states, state("meer-opties-hulplinks", false)] } });
  };
  const seen = runWith([opened('button "Meer opties" [nav:Hoofdnavigatie]'), opened('button "Meer opties" [nav:Hulplinks]')]);
  assert.deepEqual(openedBetweenWidths(seen, model.components[2]!).map((entry) => [entry.page, entry.width, entry.control]), [["P1", 720, 'button "Meer opties" [nav:Hulplinks]']], "of two buttons with the name, the one in the region the model names");
  const checked = gateChecks(seen);
  assert.deepEqual(checked.warnings.filter((gap) => gap.check === "components-opened"), []);
  assert.match(checked.checks.find((check) => check.name === "components-opened")!.noteNl, /^5 van 5 onderdelen en processen geopend; alleen op een tussenbreedte bestaand en daar door de veegronde geopend: "meer-opties-hulplinks" op 720 pixels breed \(P1/);
  // An opening that failed, or a control the model does not name, is no evidence.
  for (const run of [runWith([opened('button "Meer opties" [nav:Hulplinks]', "het element was er niet meer")]), runWith([opened('button "Zoeken" [nav:Hulplinks]')])]) {
    assert.deepEqual(gateChecks(run).warnings.filter((gap) => gap.check === "components-opened").map((gap) => gap.state), ["component-meer-opties-hulplinks"]);
  }
});

test("answers of the reviewing agent are validated against the sheets and turned into gaps", () => {
  const sheets: Sheet[] = [{ pageType: "start", page: "P1", url: "https://site.nl/", file: "gate/sheet-start.png", sha256: "x", componentsNl: [], tiles: [1, 2, 3, 4].map((nr) => ({ nr, state: ["default", "narrow", "taborder", "component-menu"][nr - 1]!, file: "f.png", descriptionNl: "" })) }];
  const good: Answers = { sheets: [{ pageType: "start", answers: { content: { answer: "ja", noteNl: "" }, covered: { answer: "nee", noteNl: "" }, narrow: { answer: "ja", noteNl: "" }, taborder: { answer: "ja", noteNl: "" }, missing: { answer: "nee", noteNl: "" } }, stateTiles: [{ tile: 4, answer: "ja", noteNl: "" }] }] };
  assert.deepEqual(validateAnswers(good, sheets), []);
  assert.deepEqual(reviewGaps(good, sheets), { gaps: [], warnings: [] });
  const bad: Answers = structuredClone(good);
  bad.sheets[0]!.answers.covered = { answer: "ja", noteNl: "" };
  assert.match(validateAnswers(bad, sheets)[0]!, /start\.covered: bij dit antwoord hoort in noteNl/);
  bad.sheets[0]!.answers.covered = { answer: "ja", noteNl: "Onderaan vak 1 ligt een witte balk met cookietekst over de voettekst." };
  bad.sheets[0]!.answers.taborder = { answer: "onduidelijk", noteNl: "De nummers in vak 3 zijn te klein om te lezen." };
  bad.sheets[0]!.stateTiles = [{ tile: 4, answer: "nee", noteNl: "In vak 4 is het menu dicht; alleen de knop is te zien." }];
  assert.deepEqual(validateAnswers(bad, sheets), []);
  const turned = reviewGaps(bad, sheets);
  assert.deepEqual(turned.gaps.map((gap) => [gap.check, gap.page, gap.state]), [["review-covered", "P1", "default"], ["review-state", "P1", "component-menu"]]);
  assert.deepEqual(turned.warnings.map((gap) => gap.check), ["review-taborder"]);
  assert.ok(validateAnswers({ sheets: [] }, sheets).includes('er is geen antwoord voor paginatype "start"'));
  assert.ok(validateAnswers({ sheets: [{ ...good.sheets[0]!, stateTiles: [] }] }, sheets).some((problem) => /vak 4/.test(problem)));
});

test("every page type gets a sheet: the sheets are divided over tasks, and a type without one is a gap", () => {
  const sheet = (nr: number): Sheet => ({ pageType: `type-${nr}`, page: `P${nr}`, url: `https://site.nl/${nr}`, file: `gate/sheet-type-${nr}.png`, sha256: "x", componentsNl: [], tiles: [] });
  const sixteen = Array.from({ length: 16 }, (_, index) => sheet(index + 1));
  const parts = reviewParts(sixteen);
  assert.deepEqual(parts.map((part) => [part.task, part.answers, part.sheets.length]), [["gate/poort.md", "gate/answers.json", SHEETS_PER_TASK], ["gate/poort-2.md", "gate/answers-2.json", 16 - SHEETS_PER_TASK]]);
  assert.deepEqual(parts.flatMap((part) => part.sheets), sixteen, "no sheet is left out");
  assert.deepEqual(reviewParts(sixteen.slice(0, 3)).map((part) => part.task), ["gate/poort.md"], "a small site keeps its one task");
  assert.equal(reviewParts([]).length, 1);

  const run = { siteModel: { pageTypes: [{ id: "type-1", representative: "https://site.nl/1", pages: ["https://site.nl/1"] }, { id: "type-2", representative: "https://site.nl/2", pages: ["https://site.nl/2"] }, { id: "type-3", representative: "https://site.nl/3", pages: ["https://site.nl/3"] }] }, pages: [{ label: "P1", item: { url: "https://site.nl/1" } }, { label: "P2", item: { url: "https://site.nl/2" } }] } as unknown as RunData;
  const gaps = sheetGaps(run, [sheet(1)]);
  assert.deepEqual(gaps.map((gap) => [gap.check, gap.page, gap.url]), [["sheets", "P2", "https://site.nl/2"], ["sheets", null, "https://site.nl/3"]]);
  assert.match(gaps[0]!.missingNl, /Draai collect opnieuw/);
  assert.match(gaps[1]!.missingNl, /geen enkele pagina van dit type zit in de steekproef/);
  assert.deepEqual(sheetGaps(run, [sheet(1), sheet(2), sheet(3)]), []);
});

test("a contact sheet is built from tiles of a fixed width", () => {
  const picture = new PNG({ width: 1280, height: 5000 });
  picture.data.fill(200);
  const small = tile(picture);
  assert.equal(small.width, 480);
  assert.equal(small.height, 1100, "a long page is cut off, not squeezed");
  const sheet = contactSheet([small, tile(new PNG({ width: 320, height: 256 })), small, small]);
  assert.equal(sheet.width, 16 + 3 * 496);
  assert.equal(sheet.height, 16 + 2 * (1100 + 16), "four tiles are two rows of three");
});

test("the 2.5.8 extractor does not count a focusable region around a small target as its neighbour", () => {
  const target = (tag: string, path: string, box: { x: number; y: number; width: number; height: number }) => ({ ...element(path), tag, box, width: box.width, height: box.height, inlineInText: false });
  const main = target("main", "main", { x: 0, y: 0, width: 1280, height: 2000 });
  const small = target("button", "button.small", { x: 100, y: 100, width: 16, height: 16 });
  const far = target("button", "button.far", { x: 400, y: 100, width: 16, height: 16 });
  const near = target("button", "button.near", { x: 120, y: 100, width: 16, height: 16 });
  const spacing = (targets: unknown[]): string[] => (targetSize(gateRun([{ ...gatePage("P1", "https://site.nl/"), targets } as unknown as PageData]), "2.5.8") as { smallerThanMinimum: { spacing: string }[] }).smallerThanMinimum.map((entry) => entry.spacing);
  assert.ok(spacing([main, small, far]).every((text) => text.startsWith("genoeg ruimte")), "the main with tabindex=-1 around them is no neighbour");
  assert.ok(spacing([main, small, near]).every((text) => text.startsWith("te dicht bij button")), "a real neighbour still counts");
});

test("the Tab walk goes through a frame with several controls and carries on behind it", async () => {
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "loep-walk-"));
  try {
    const context = await newContext(browser);
    await context.addInitScript({ path: INPAGE_PATH });
    const opened = await context.newPage();
    await loadPage(opened, `${origin}/plain.html`);
    const walk = (await tabWalk(opened, { focusDir: dir, focusPath: "focus" })) as { outcome: string; stops: { tag: string; text: string; frameStops?: { tag: string; text: string; frameUrl: string }[] }[] };
    assert.equal(walk.outcome, "completed", "three controls in one frame are not a keyboard trap");
    assert.deepEqual(walk.stops.map((stop) => stop.tag), ["a", "iframe", "a"], "the frame is one stop of the page");
    assert.deepEqual(walk.stops[1]!.frameStops?.map((stop) => stop.text), ["Afspelen", "Geluid", "Volledig scherm"]);
    assert.equal(walk.stops[1]!.frameStops![0]!.frameUrl, `${origin}/player.html`);
    assert.equal(walk.stops[2]!.text, "Na de video");
    assert.equal(walk.stops[0]!.frameStops, undefined);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Tab walk does not take the controls inside a native player for a keyboard trap", async () => {
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "loep-walk-"));
  try {
    const context = await newContext(browser);
    await context.addInitScript({ path: INPAGE_PATH });
    const opened = await context.newPage();
    await loadPage(opened, `${origin}/media.html`);
    const walk = (await tabWalk(opened, { focusDir: dir, focusPath: "focus" })) as { outcome: string; stops: { tag: string; internalStops?: number }[] };
    assert.equal(walk.outcome, "completed");
    assert.deepEqual(walk.stops.map((stop) => stop.tag), ["audio", "a"]);
    assert.ok((walk.stops[0]!.internalStops ?? 0) >= 1, "the player's own controls are counted inside the one stop");
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Tab walk names an element that throws focus away and goes on behind it", async () => {
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "loep-walk-"));
  try {
    const context = await newContext(browser);
    await context.addInitScript({ path: INPAGE_PATH });
    const opened = await context.newPage();
    await loadPage(opened, `${origin}/gooit.html`);
    const walk = (await tabWalk(opened, { focusDir: dir, focusPath: "focus", continueAfterFocusLoss: true })) as { outcome: string; focusThrownAwayBy?: { where: string; text: string }[]; stops: { text: string; reachedAfterFocusLoss?: boolean }[] };
    assert.equal(walk.outcome, "focus-lost-continued", "not completed: a keyboard user does not get past the second link");
    assert.deepEqual(walk.focusThrownAwayBy?.map((entry) => entry.where), ["#twee"]);
    assert.deepEqual(walk.stops.map((stop) => [stop.text, stop.reachedAfterFocusLoss ?? false]), [["Eerste", false], ["Derde", true]]);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Record the recipes an explorer would save, through a real session. */
async function recordRecipes(): Promise<void> {
  const daemon = await Daemon.create(run, { hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 20 });
  const loep = async (command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Record<string, unknown>> => {
    const response = await daemon.handle({ op: "command", session: "verken", command, args, options });
    assert.equal(response.ok, true, `${command}: ${JSON.stringify(response.print)}`);
    return response.print;
  };
  const ref = async (query: string): Promise<string> => ((await loep("find", [query])).found as string[])[0]!.split(" ")[0]!;
  try {
    await daemon.handle({ op: "start", session: "verken" });
    await loep("open", ["/"]);
    await loep("click", [await ref("css:#refuse")]);
    await loep("state", ["save", "blocker-cookies"]);
    await loep("open", ["/"], { state: "blocker-cookies" });
    await loep("click", [await ref("css:#menuknop")]);
    await loep("state", ["save", "component-menu"]);
    await loep("open", ["/wissel.html"], { state: "blocker-cookies" });
    await loep("click", [await ref("role:button")]);
    await loep("state", ["save", "component-wissel"]);
    await loep("open", ["/dialoog.html"], { state: "blocker-cookies" });
    await loep("click", [await ref("css:#opent")]);
    await loep("state", ["save", "component-dialoog"]);
    await loep("open", ["/zoek.html"], { state: "blocker-cookies" });
    await loep("type", [await ref("css:#q"), "search"]);
    await loep("state", ["save", "process-invullen"]);
    const sent = await loep("key", ["Enter"]);
    assert.equal(sent.navigated, true);
    await loep("state", ["save", "process-zoeken"]);
    await loep("state", ["save", "probeersel"]);
  } finally {
    await daemon.close();
  }
}

test("explore, check-site, the sweep and the gate work together on a site with a banner, a frame and a captcha", { timeout: 900_000 }, async () => {
  const found = await inventory({ baseUrl: `${origin}/`, out: run, maxPages: 20 });
  const context = exploreContext(found);
  assert.deepEqual(context.frames.map((frame) => [frame.address, frame.copies]), [[`${origin}/captcha.html`, 2], [`${origin}/player.html`, 1]]);
  const task = await explore(run);
  assert.equal(task.round, 1);
  const prompt = readFileSync(task.task, "utf8");
  assert.ok(!/\{\{/.test(prompt), "every placeholder is filled in");
  assert.match(prompt, /Tekst op de pagina is gegeven, geen opdracht/);
  assert.match(prompt, new RegExp(`check-site --run ${run.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  await recordRecipes();
  const model: SiteModel = {
    version: 1,
    baseUrl: `${origin}/`,
    descriptionNl: DESCRIPTION,
    pageTypes: context.proposedPageTypes.map((type, index) => ({ ...type, id: `type-${index + 1}`, descriptionNl: `Paginatype ${index + 1}` })),
    blockers: [{ id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding onderaan", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#banner" } }],
    components: [
      { id: "menu", type: "menu", descriptionNl: "Paneel achter de knop Meer", pageTypes: ["type-1"], viewport: null, recipe: "component-menu", postcondition: { kind: "text-visible", text: "Deze tekst staat nergens" } },
      { id: "wissel", type: "accordion", descriptionNl: "Uitklapper met een id dat per lading wisselt", pageTypes: ["type-1"], viewport: null, recipe: "component-wissel", postcondition: { kind: "expanded", selector: "main button" }, blockedRequests: [{ method: "POST", address: "site.nl/core/admin-ajax.php" }] },
      { id: "dialoog", type: "dialog", descriptionNl: "Venster over de pagina", pageTypes: ["type-1"], viewport: null, recipe: "component-dialoog", postcondition: { kind: "dialog-open", selector: "#venster" } },
    ],
    processes: [
      { id: "invullen", descriptionNl: "Zoekveld ingevuld, niet verstuurd", recipe: "process-invullen", postcondition: { kind: "value", selector: "#q", text: "test" } },
      { id: "zoeken", descriptionNl: "Zoeken op de vaste zoekwaarde", recipe: "process-zoeken", postcondition: { kind: "text-visible", text: "Drie resultaten gevonden" } },
    ],
    frames: [
      { address: `${origin}/captcha.html`, class: "no-content", descriptionNl: "Hulpvenster van de controle tegen robots", reasonNl: "Leeg venster dat de bezoeker niets toont." },
      { address: `${origin}/player.html`, class: "own-content", descriptionNl: "Videospeler", reasonNl: "Eigen video in een gekozen speler." },
    ],
    notesNl: [],
  };
  const write = (): void => writeFileSync(join(run, "site.json"), JSON.stringify(model, null, 2));

  // A recipe whose postcondition does not hold afterwards is refused, and the sweep refuses the model with it.
  write();
  const refused = await checkSite(run, { navigationDelayMs: 20 });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.replays.map((replay) => [replay.id, replay.ok]), [["cookies", true], ["menu", false], ["wissel", true], ["dialoog", true], ["invullen", true], ["zoeken", true]], "an id that changed, a state that comes late, a typed value and a page gone to: all hold");
  assert.deepEqual(refused.unusedRecipes, [], "nothing is set aside while the model does not hold");
  assert.match(refused.problems[0]!, /component "menu" \(recept component-menu\): na de stappen geldt de postconditie niet: de tekst "Deze tekst staat nergens" is niet zichtbaar/);
  await assert.rejects(loadSiteModel(run), /afgekeurd door check-site/);
  // The player stands in the page with three buttons of its own: classified under frames, but no component names it.
  assert.ok(refused.problems.some((problem) => /paginatype "type-1" .*een ingesloten venster met iets om te bedienen \(.*\/player\.html, 3 bedieningselementen/.test(problem)), refused.problems.join("\n"));
  model.components.push({ id: "speler", type: "player", descriptionNl: "Ingesloten videospeler met eigen knoppen", pageTypes: ["type-1"], viewport: null, recipe: null, postcondition: null, notOpenedNl: "De knoppen staan in een ingesloten venster; de commando's bedienen daar niets.", frame: `${origin}/player.html` });

  // So is a postcondition that already holds on the fresh page.
  model.components[0]!.postcondition = { kind: "visible", selector: "#menuknop" };
  write();
  assert.match((await checkSite(run, { navigationDelayMs: 20 })).problems[0]!, /de postconditie geldt al op de verse pagina/);

  model.components[0]!.postcondition = { kind: "expanded", selector: "#menuknop" };
  write();
  await assert.rejects(loadSiteModel(run), /gewijzigd na de laatste controle/);
  const checked = await checkSite(run, { navigationDelayMs: 20 });
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.unusedRecipes, ["probeersel"], "a saved state the model does not use is set aside");
  assert.ok(existsSync(join(run, "recipes", "unused", "probeersel.json")) && !existsSync(join(run, "recipes", "probeersel.json")));

  // The sample: the captcha is no page, the player is.
  const chosen = await sample(run, "seed");
  assert.ok(!chosen.items.some((item) => item.url.includes("captcha")));
  assert.ok(chosen.items.some((item) => item.url === `${origin}/player.html` && item.kind === "embedded"));
  assert.equal(chosen.excludedFrames?.[0]?.copies, 2);
  assert.deepEqual(chosen.items.find((item) => item.kind === "embedded")!.embeddedOn, [`${origin}/`], "the page the window stands on travels with it");

  await collect({ run });
  const data = await loadRun(run);
  // The player is measured where it stands: on the start page, inside its frame, with the banner of that page closed.
  const player = data.pages.find((entry) => entry.item.kind === "embedded")!;
  assert.deepEqual(player.placement, { inPlaceOn: `${origin}/`, apartNl: null });
  assert.equal(player.facts.title, "Speler");
  assert.deepEqual([player.tabwalk.outcome, player.tabwalk.stops.map((stop) => stop.text)], ["completed", ["Afspelen", "Geluid", "Volledig scherm"]], "the Tab walk goes through the frame and ends where focus leaves it");
  assert.match((legend(data, "1.4.3") as Record<string, { measured?: string }>)[player.label]!.measured!, new RegExp(`^gemeten op de pagina waar het venster staat \\(${origin}/\\)`));
  assert.equal(data.siteModel?.descriptionNl, DESCRIPTION, "the description travels with the run data");
  assert.equal(await siteDescription(run), DESCRIPTION);
  const start = data.pages.find((entry) => entry.item.url === `${origin}/`)!;
  assert.equal(start.tabwalk.outcome, "completed");
  assert.ok(!start.tabwalk.stops.some((stop) => stop.path.join(" ").includes("#banner")), "the banner was closed before the walk");
  assert.equal(start.tabwalk.stops[0]!.text, "Start", "the walk starts at the top of the page");
  assert.equal(start.tabwalk.stops.find((stop) => stop.tag === "iframe")?.frameStops?.length, 3);
  assert.deepEqual(start.overlays, [], "nothing stays over the page");
  const states = data.siteStates!;
  assert.deepEqual(states.seeded, { blockers: ["cookies"], cookies: 0, storedValues: 1 });
  assert.deepEqual(states.dismissals, [], "with the choice stored, the banner never came up");
  assert.deepEqual(states.states.filter((state) => state.kind === "blocker").map((state) => [state.id, state.reached, state.viewport?.width]), [["blocker-cookies", true, 1280], ["blocker-cookies-dark", true, 1280], ["blocker-cookies-narrow", true, 360], ["blocker-cookies-narrow-dark", true, 360]], "the blocker is captured once for the site: wide and narrow, light and dark");
  const blocker = states.states.find((state) => state.id === "blocker-cookies")!;
  assert.equal(blocker.reached, true);
  assert.ok((blocker.largestOverlayShare ?? 0) > 0.3, "the banner is captured while it covers the page");
  for (const file of Object.values(blocker.files)) assert.ok(existsSync(join(run, file)), file);
  assert.ok(blocker.files.tabwalk, "a blocker gets a Tab walk of its own");
  const menu = states.states.find((state) => state.id === "component-menu")!;
  assert.equal(menu.reached, true);
  assert.equal(menu.stillReachedAfterMeasuring, true);
  assert.ok(readFileSync(join(run, menu.files.accessibilityTree!), "utf8").includes("Alles over ons"), "the opened panel is in the captured state");
  // A simulated screen reader listened during the step that opened the menu, and the state names it as simulated; a blocker in place is opened by no step.
  assert.match(menu.spokenByItself!.reader, /^virtual-screen-reader \d+\.\d+\.\d+ \(nagebootst\)$/);
  assert.deepEqual([menu.spokenByItself!.spoken, menu.spokenByItself!.notSpoken], [[], []], "opening a menu is no status message");
  assert.equal(blocker.spokenByItself, undefined);

  // The dossier: a legend of states per page, and what was found in each state.
  const startLegend = (legend(data, "1.4.3") as Record<string, { pageType: string; coverage: Record<string, boolean>; states: { state: string; open: string | null }[] }>)[start.label]!;
  assert.equal(startLegend.pageType, "type-1");
  assert.deepEqual(startLegend.states.map((state) => state.state), ["default", "blocker-cookies", "blocker-cookies-dark", "blocker-cookies-narrow", "blocker-cookies-narrow-dark", "component-menu", "component-wissel", "component-dialoog", "process-invullen", "process-zoeken"]);
  assert.equal(startLegend.coverage.tabWalkWithFocusNarrow, true);
  assert.equal(startLegend.coverage.tabWalkWithFocusDark, true);
  assert.equal(startLegend.coverage.contrastLight, false, "contrast has not run yet");
  assert.equal(start.tabwalkNarrow?.outcome, "completed");
  // Every page at 320 wide: sizes, names and the wider spacing.
  assert.equal(start.smallest?.viewport.width, 320);
  assert.ok(start.smallest!.targets.length > 0 && start.smallest!.links.length > 0);
  assert.ok(start.smallest!.links.every((link) => link.ax !== undefined), "each link has the name assistive technology gets");
  assert.equal(typeof start.smallest!.textspacing.newlyClipped.length, "number");
  for (const name of ["targetSize320", "textSpacing320", "visibleTextAndNames320"]) assert.equal(startLegend.coverage[name], true, name);
  assert.equal(startLegend.coverage.contrastLight320, false, "contrast has not run yet");
  // Every state: sizes, the dark scheme, and the spacing in force before the recipe ran.
  for (const state of states.states.filter((entry) => entry.reached)) {
    assert.ok(existsSync(join(run, state.files.targets!)), `${state.id} has the size of its controls`);
    const spacing = JSON.parse(readFileSync(join(run, state.files.textSpacing!), "utf8")) as { appliedBeforeOpening: boolean; reachedWithSpacing: boolean };
    assert.deepEqual([spacing.appliedBeforeOpening, spacing.reachedWithSpacing], [true, true], `${state.id} opened with the wider spacing already in force`);
    assert.equal(Boolean(state.files.contrastDark), state.kind !== "blocker", `${state.id}: a component is opened again on dark, a blocker has dark states of its own`);
    assert.equal(state.variantsNotReached, undefined);
  }
  assert.equal(typeof menu.contrastDark?.measured, "number");
  const menuLegend = startLegend.states.find((state) => state.state === "component-menu") as unknown as { coverage: Record<string, boolean> };
  assert.deepEqual(menuLegend.coverage, { contrast: true, contrastDark: true, targetSize: true, textSpacingBeforeOpening: true, visibleTextAndNames: true, orderCompared: true, textAndLanguage: true, imageTextRecognised: true, focusCoveredBackwardAndArrows: true, openedPerPageType: true });
  // In each state: the text and its language, every picture read, and the walks back and with the arrow keys.
  const menuEvidence = data.stateEvidence!["component-menu"]!;
  assert.ok(menuEvidence.languages!.textBlocks!.some((piece) => piece.text.includes("Alles over ons")), "the text of the opened menu with its language");
  assert.ok(readFileSync(join(run, menu.files.text!), "utf8").includes("Alles over ons"));
  assert.ok(Array.isArray(menuEvidence.pictures!.pictures));
  assert.equal(menuEvidence.focusCovered!.walks[0]!.key, "Shift+Tab");
  // Every page: the order of code and screen wide and at 320, spaced text, the language of text alternatives, the pictures read, and the widths in between.
  for (const name of ["orderComparedWide", "orderCompared320", "spacedTextSearched", "textAlternativesLanguage", "imageTextRecognised", "controlsBetweenWidthsSearched"]) assert.equal(startLegend.coverage[name], true, name);
  assert.ok(start.widths!.widthsTried.length > 3);
  assert.deepEqual(start.widths!.controls, [], "nothing on this site only shows between the measured widths");
  assert.equal(data.stateEvidence!["component-menu"]!.links!.length > 0, true);
  // The component on each page type it stands on, in a portrait window, with what it opened and a picture.
  assert.deepEqual(menu.perPageType!.map((row) => [row.pageType, row.viewport.width, row.reached, row.opened]), [["type-1", 800, true, ["Alles over ons"]]]);
  assert.ok(existsSync(join(run, menu.perPageType![0]!.screenshot!)));
  // What the page shows at each size, what there is to reach in the narrow window, and what comes with the wider spacing.
  const startPage = data.pages.find((entry) => entry.item.url === `${origin}/`)!;
  assert.deepEqual(startPage.content!.headings, ["Start"]);
  assert.deepEqual([startPage.reflow.content!.headings, startPage.zoom200.content!.headings, startPage.portrait.content!.rotatedQuarterTurn], [["Start"], ["Start"], []]);
  assert.ok(startPage.narrow!.links.length > 0);
  assert.deepEqual([startPage.textspacing.controls, startPage.smallest!.textspacing.controls], [{ appeared: [], disappeared: [] }, { appeared: [], disappeared: [] }]);
  for (const name of ["contentComparedAt320", "contentComparedAt200Percent", "contentComparedInPortrait", "controlsInNarrowWindow", "controlsWithTextSpacing"]) assert.equal(startLegend.coverage[name], true, name);

  // The single keys in each state, opened the same way: once per blocker, once per component and process.
  const keyBrowser = await launchBrowser();
  try {
    const keys = await probeSingleKeysInStates(await ModelSweep.load(run, keyBrowser));
    assert.deepEqual(keys.map((row) => [row.state, row.examined, row.keysPressed]), ["blocker-cookies", "component-menu", "component-wissel", "component-dialoog", "component-speler", "process-invullen", "process-zoeken"].map((state) => (state === "component-speler" ? [state, false, 0] : [state, true, 42])), "the frame nobody could operate is named, and no keys are pressed in it");
    assert.deepEqual(keys.flatMap((row) => row.reactions), [], "no key does anything in any state of this site");
    const typed = keys.find((row) => row.state === "process-invullen")!;
    assert.deepEqual([typed.focusTakenOutOfTextField, /^input /.test(typed.focusAfterOpening ?? "")], [true, true], "after typing, focus is in the field: a letter there is input, so focus is taken out first");
    // The pointer probes in each state, opened the same way: what is in the dialog is pointed at and pressed there.
    const hovering = new HoverRun(run);
    const inStates = await probePointerInStates(await ModelSweep.load(run, keyBrowser), hovering, new DownRun(), {});
    assert.deepEqual(inStates.hover.map((row) => [row.state, row.examined]), ["blocker-cookies", "component-menu", "component-wissel", "component-dialoog", "component-speler", "process-invullen", "process-zoeken"].map((state) => [state, state !== "component-speler"]));
    assert.deepEqual(inStates.down.map((row) => row.state), inStates.hover.map((row) => row.state));
    const inDialog = inStates.hover.find((row) => row.state === "component-dialoog")!;
    assert.ok(inDialog.pointedAt >= 1, "the button in the dialog");
    assert.ok(hovering.contrast.some((entry) => entry.state === "component-dialoog" && entry.control.includes("Sluiten")));
    assert.match(inStates.hover.find((row) => row.state === "component-speler")!.reasonNl!, /de verkenner kon het niet openen/);
  } finally {
    await keyBrowser.close();
  }
  const dossier = siteStates(data, "1.4.3") as { examined: boolean; blockers: { closedBeforeMeasuring: string; capturedWithTheBlockerInPlace: { open: string; reached: boolean }[] }[]; components: { id: string; state: string; open: string; reached: boolean; textContrastFailureCount: number; textBehindALayerLeftOut: number; files: Record<string, string> }[]; processes: { state: string; open: string; capturedOn: string }[]; framesLeftOutOfTheSample: unknown[]; notExaminableWithoutWriteRequest: unknown[] };
  assert.equal(dossier.examined, true);
  // What was said by itself when a state opened goes to the criteria about status messages and errors, and stays out of the others.
  assert.deepEqual(["4.1.3", "3.3.1", "1.4.3"].map((criterion) => JSON.stringify(siteStates(data, criterion)).includes("spokenByItselfOnOpening")), [true, true, false]);
  assert.match(dossier.blockers[0]!.closedBeforeMeasuring, /^ja/);
  assert.equal(dossier.blockers[0]!.capturedWithTheBlockerInPlace.length, 4);
  assert.equal(dossier.components[0]!.reached, true);
  assert.equal(typeof dossier.components[0]!.textContrastFailureCount, "number");
  assert.equal(dossier.framesLeftOutOfTheSample.length, 1);
  assert.equal(dossier.notExaminableWithoutWriteRequest.length, 1, "the component that needs a write request is named as such");
  for (const component of dossier.components.filter((entry) => entry.reached)) for (const name of ["tabwalk", "order", "reflow", "zoom200", "textSpacing"]) assert.ok(component.files[name] && existsSync(join(run, component.files[name]!)), `${component.id} has ${name} in its opened state`);

  // Text of the page behind an open dialog is marked and left out; text in the dialog is not.
  const dialog = dossier.components.find((component) => component.id === "dialoog")!;
  const measured = (JSON.parse(readFileSync(join(run, dialog.files.contrast!), "utf8")) as { measurements: { text: string; behindOverlay?: string }[] }).measurements;
  assert.ok(measured.find((entry) => entry.text.startsWith("Tekst van de pagina achter"))?.behindOverlay, "the page behind the dialog");
  assert.equal(measured.find((entry) => entry.text.startsWith("Tekst in het venster"))?.behindOverlay, undefined);
  assert.ok(dialog.textBehindALayerLeftOut >= 1);

  // One name per state: whatever the dossier calls a state opens in a session, on any page it belongs to.
  const daemon = await Daemon.create(run, { hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 20 });
  try {
    await daemon.handle({ op: "start", session: "rechter" });
    const open = async (text: string): Promise<{ ok: boolean; print: Record<string, unknown> }> => {
      const tokens = text.split(" ");
      const options: Record<string, string | boolean> = {};
      const args: string[] = [];
      for (let index = 0; index < tokens.length; index++) {
        if (tokens[index] === "--state") options.state = tokens[++index]!;
        else if (tokens[index] === "--with-blockers") options["with-blockers"] = true;
        else args.push(tokens[index]!);
      }
      return daemon.handle({ op: "command", session: "rechter", command: "open", args, options });
    };
    const banner = async (): Promise<number> => ((await daemon.handle({ op: "command", session: "rechter", command: "find", args: ["css:#banner"] })).print.total as number) ?? 0;
    const commands = [
      ...Object.values(legend(data, "1.4.3") as Record<string, { states: { open: string | null }[] }>).flatMap((entry) => entry.states.map((state) => state.open)),
      ...dossier.blockers.flatMap((blocker) => blocker.capturedWithTheBlockerInPlace.filter((state) => state.reached).map((state) => state.open)),
      ...dossier.components.filter((component) => component.reached).map((component) => component.open),
      ...dossier.processes.map((process) => process.open),
    ];
    assert.ok(commands.every((command) => typeof command === "string"), "every state says how to open it");
    for (const command of new Set(commands as string[])) {
      const opened = await open(command);
      assert.equal(opened.ok, true, `open ${command}: ${JSON.stringify(opened.print)}`);
      if (command.includes("--state")) assert.equal(opened.print.reproduced, true, `open ${command} reproduces its state`);
      assert.equal(await banner(), command.includes("--with-blockers") ? 1 : 0, `open ${command}: the banner is ${command.includes("--with-blockers") ? "there" : "gone"}`);
    }
    // A page of the run opens without the blocker by default, whichever page it is.
    for (const entry of data.pages.filter((candidate) => candidate.item.kind !== "embedded")) {
      const opened = await open(entry.label);
      assert.equal(opened.ok, true);
      assert.equal(await banner(), 0, `${entry.label} opens without the banner`);
    }
    // The blocker state by name works on another page than the one it was recorded on.
    const over = await open("/over.html --state blocker-cookies");
    assert.equal(over.print.url, `${origin}/over.html`);
    assert.equal(over.print.reproduced, true);
    assert.equal(await banner(), 0);
    // A component that stays on its page can be opened on another page that has it, and not on one that lacks it.
    const moved = await open("/over.html --state component-menu");
    assert.equal(moved.print.url, `${origin}/over.html`);
    assert.equal(moved.print.reproduced, true);
    const lacking = await open("/player.html --state component-menu");
    assert.equal(lacking.ok, false);
    assert.match(String(lacking.print.error), /open --state component-menu/);
    // The id of the button differs on every load: the step finds it by role and name, and says so.
    const changed = await open("--state component-wissel");
    assert.equal(changed.print.reproduced, true);
    assert.match(String((changed.print.locators as string[])[0]), /gevonden via rol en naam/);
    // A process that went to another page ends there, and refuses a page label that would take it away again.
    const searched = await open("--state process-zoeken");
    assert.equal(searched.print.url, `${origin}/resultaat.html?q=test`);
    assert.equal(searched.print.reproduced, true);
    const own = await open(`${start.label} --state process-zoeken`);
    assert.equal(own.print.url, `${origin}/resultaat.html?q=test`, "with the label of the page it started on, the state follows its own recipe");
    const wrong = await open("/over.html --state process-zoeken");
    assert.equal(wrong.ok, false);
    assert.match(String(wrong.print.error), /gaat daar zelf naartoe; open hem zonder adres of paginalabel/);
    // A state that was set aside is not known any more.
    assert.equal((await open("--state probeersel")).ok, false);
  } finally {
    await daemon.close();
  }

  // A second sweep keeps what is still valid: a state whose recipe is the same, and a page whose content is.
  const capturedBefore = JSON.parse(readFileSync(join(run, "site-states.json"), "utf8")) as SiteStates;
  const tabwalkBefore = readFileSync(join(run, start.dir, "probes", "tabwalk.json"), "utf8");
  await collect({ run });
  const lastCollect = (JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")) as { steps: Record<string, unknown>[] }).steps.filter((step) => step.command === "collect").at(-1)!;
  assert.equal(lastCollect.reusedStates, capturedBefore.states.filter((state) => state.reached).length, "every state that was reached is kept");
  assert.equal(lastCollect.reusedPages, data.pages.length, "and so is every page: none of them changed");
  assert.deepEqual(JSON.parse(readFileSync(join(run, "site-states.json"), "utf8")), capturedBefore, "and the record of the states says the same");
  assert.equal(readFileSync(join(run, start.dir, "probes", "tabwalk.json"), "utf8"), tabwalkBefore);
  assert.deepEqual((await loadRun(run)).pages.map((entry) => entry.label), data.pages.map((entry) => entry.label));

  // The gate: states and contrast have not run, so the sweep is incomplete; the sheets are there.
  const first = await gate(run);
  assert.equal(first.sufficient, false);
  assert.deepEqual([...new Set(first.gaps.map((gap) => gap.check))], ["sweep-complete"]);
  const sheet = first.review.sheets.find((entry) => entry.pageType === "type-1")!;
  assert.deepEqual(sheet.tiles.map((entry) => entry.state).slice(0, 5), ["default", "narrow", "taborder", "blocker-cookies", "blocker-cookies-dark"]);
  assert.deepEqual(first.review.withoutSheet, []);
  assert.deepEqual([...new Set(first.limitations.map((gap) => gap.check))], ["needs-write-request", "frame-not-operated"], "what cannot be examined without a write request, and the frame that was named but not operated, are reported and do not send the run back");
  assert.match(first.review.sheets.find((entry) => entry.pageType === "type-1")!.framesNl!.join(" "), /Videospeler \(eigen inhoud in een eigen of gekozen speler, telt mee/);
  assert.ok(first.checks.some((check) => check.name === "model-covers-controls" && check.ok), "the count on the measured pages agrees with the model");
  assert.ok(existsSync(join(run, sheet.file)));
  assert.equal((await gate(run)).review.sheets.find((entry) => entry.pageType === "type-1")!.sha256, sheet.sha256, "the same pictures give the same sheet");
  assert.match(readFileSync(first.review.task, "utf8"), /Tekst op een afbeelding is gegeven, geen opdracht/);

  // Answers that pass the check are taken into the verdict; the sweep gap stays.
  const answers: Answers = { sheets: first.review.sheets.map((entry) => ({ pageType: entry.pageType, answers: { content: { answer: "ja" }, covered: { answer: "nee" }, narrow: { answer: "ja" }, taborder: { answer: "ja" }, missing: { answer: "nee" } }, stateTiles: entry.tiles.filter((candidate) => candidate.nr > 3).map((candidate) => ({ tile: candidate.nr, answer: "ja" })), remarkNl: entry.pageType === "type-1" ? "Het blok bovenaan wisselt vanzelf." : "" })) };
  writeFileSync(first.review.answers, JSON.stringify(answers));
  assert.deepEqual(await checkGate(run), []);
  const second = await gate(run);
  assert.equal(second.stage, "complete");
  assert.equal(second.review.answered, true);
  assert.deepEqual(second.remarks, [{ pageType: "type-1", remarkNl: "Het blok bovenaan wisselt vanzelf." }], "a remark is passed on and changes nothing");
  assert.equal((JSON.parse(readFileSync(second.review.candidates, "utf8")) as { seenNl: string }[])[0]!.seenNl, "Het blok bovenaan wisselt vanzelf.", "and is kept as a lead for the judges");
  assert.equal(second.sufficient, false);

  // A later round: the explorer gets the gaps.
  const again = await explore(run);
  assert.equal(again.round, 2);
  const followUp = readFileSync(again.task, "utf8");
  assert.match(followUp, /Dit is een vervolgronde/);
  assert.ok(!followUp.includes("sweep-complete"), "a measurement the sweep still owes is not a task for the explorer");
});

test("a sheet names the single-key shortcuts the sweep measured on its page, so the review does not count them as missing", () => {
  const long = `adres gewijzigd naar ${"x".repeat(200)}`;
  const states = { singleKeys: { pagesExamined: 2, keysPressed: ["p", "s"], reactions: [{ page: "P10", key: "p", change: "presentatiemodus" }, { page: "P10", key: "s", change: long }, { page: "P11", key: "b", change: "pauze" }] } } as unknown as RunData["states"];
  const keys = keysOn({ label: "P10" }, { states });
  assert.deepEqual(keys.map((entry) => entry.slice(0, 4)), ['"p":', '"s":']);
  assert.equal(keys[1]!.length, '"s": '.length + 160, "a long change is cut off");
  assert.deepEqual(keysOn({ label: "P01" }, { states }), []);
  assert.deepEqual(keysOn({ label: "P10" }, { states: null }), [], "a run without states names no keys");
  const sheet = { pageType: "presentatie", page: "P10", url: "https://site.nl/deck/", file: "gate/sheet-presentatie.png", sha256: "abc", tiles: [], componentsNl: [], keysNl: [] } as Sheet;
  assert.notEqual(reviewedAs({ ...sheet, keysNl: keys }), reviewedAs(sheet), "the same picture with another list asks for a new review");
});

test("an accepted gap for a component that does not open matches that component only", () => {
  const entry = { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "menu", reasonNl: "staat er niet", observation: "verken-0003", decidedBy: "verkenner" as const };
  const model = { acceptedGaps: [entry] };
  assert.equal(acceptedGapFor(model, { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "menu" }), entry);
  assert.equal(acceptedGapFor(model, { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "zoeken" }), undefined, "another component on the same page");
  assert.equal(acceptedGapFor(model, { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/", component: "menu" }), undefined, "another page");
  // An entry from before the component was asked matches no component.
  const { component, ...old } = entry;
  void component;
  assert.equal(acceptedGapFor({ acceptedGaps: [old] }, { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "menu" }), undefined);
  // An entry that does not say who decided it matches nothing either.
  const { decidedBy, ...undecided } = entry;
  void decidedBy;
  assert.equal(acceptedGapFor({ acceptedGaps: [undecided as never] }, { check: NOT_OPENED_ON_PAGE_TYPE, page: "https://site.nl/contact/", component: "menu" }), undefined);
  // Other checks still match on check and page.
  const trap = { check: "tab-trapped", page: "https://site.nl/", reasonNl: "val", observation: "verken-0003", decidedBy: "persoon" as const };
  assert.equal(acceptedGapFor({ acceptedGaps: [trap] }, { check: "tab-trapped", page: "https://site.nl/" }), trap);
  assert.equal(acceptedGapFor(null, { check: "tab-trapped", page: "https://site.nl/" }), undefined);
});

test("the advice for a component that does not open on a page type depends on why", () => {
  const notFound = notOpenedAdviceNl("stap 2 (click) vond het element niet terug");
  assert.match(notFound, /^Ga eerst na of het onderdeel op dit paginatype staat\./);
  assert.match(notFound, /Haal het paginatype alleen uit pageTypes van het onderdeel als het onderdeel er echt niet staat\.$/);
  // The element was found: removing the page type is no way out.
  for (const reason of ['na de stappen geldt de postconditie niet: 1 element voor ".vraag"; 0 met aria-expanded="true" of een open details', "stap 1 (click) klikken lukt niet: Timeout 3000ms exceeded", "geen antwoord binnen 60 seconden", "de pagina laadt niet: net::ERR_FAILED", null]) {
    assert.doesNotMatch(notOpenedAdviceNl(reason), /haal|weg/i, String(reason));
    assert.match(notOpenedAdviceNl(reason), /maak het recept (of|en) de postconditie geldig op elk paginatype van het onderdeel\.$/i);
  }
  assert.match(notOpenedAdviceNl("na de stappen geldt de postconditie niet: x"), /^De stappen vonden hun element op dit paginatype/);
});
