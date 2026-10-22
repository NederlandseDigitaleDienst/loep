/**
 * Where the sweep leaves the evidence of each planted defect: per defect of defects.ts, the part
 * of the dossier a script can read it from, or why only an agent can see it. The regression check
 * of the sweep (scripts/sweep-check.ts) reads this table after `collect`, `contrast` and `states`
 * on both variants of the fixture site. On Lindewaard the evidence has to be there; on Berkenveen
 * the same test, on the same pages, has to find nothing.
 *
 * A test reads what the sweep recorded, never the page itself. `at` says whether an element the
 * dossier names by its selector chain is the element of the defect (the selector in defects.ts)
 * or lies within it, so a test can say "this list names the defect element" without knowing the
 * chain. `failed` does the same for the findings of the rule engines on the criteria given.
 * Nothing in this file is served.
 */

export interface Look {
  /** A file of the dossier of the page, relative to its directory (pages/<slug>/): parsed when it is JSON, else its text; null when it is not there. */
  page(file: string): any;
  /** A file of the run, relative to the run directory, read the same way. */
  run(file: string): any;
  /** The address of the page in this run. */
  url: string;
  /** The label the sample gives the page (P01, P02, ...), with which states.json names it. */
  label: string;
  /** Whether a selector chain the dossier recorded points at the element of the defect or at something within it. */
  at(path: unknown): boolean;
  /** Whether a selector chain the dossier recorded points at an element that holds the element of the defect, such as a list that handles the clicks on its cards. */
  around(path: unknown): boolean;
  /** The rules of the engines (light and dark scheme) that report a failure on one of these criteria at the element of the defect. */
  failed(criteria: string[]): string[];
}

export interface ScriptEvidence {
  defect: string;
  /** The part of the dossier, in the words of the table. */
  whereNl: string;
  /** Paths of the pages to look at; by default the pages of the defect, with the start page for "every page". Every one must hold the evidence. */
  pages?: string[];
  found(look: Look): boolean;
}

export interface AgentOnly {
  defect: string;
  /** Why no script can see it: what has to be looked at, listened to or judged. */
  agentNl: string;
}

export type Evidence = ScriptEvidence | AgentOnly;

export const isAgentOnly = (entry: Evidence): entry is AgentOnly => "agentNl" in entry;

/** The page for an unknown address, as inventory asks for it. */
const NOT_FOUND = "/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek";
const ARTICLE = "/nieuws/nieuwe-fietsenstalling.html";

type Entry = Record<string, any>;
const list = (value: unknown): Entry[] => (Array.isArray(value) ? (value as Entry[]) : []);
const engines = (criteria: string[]) => (look: Look): boolean => look.failed(criteria).length > 0;
const ENGINES_NL = "engines-light.json en engines-dark.json: een regel keurt het element af";
/** A file name used as a text alternative. */
const FILE_NAME = /^[\w-]+\.(?:jpe?g|png|gif|svg|webp)$/i;
const TEXT_FIELD = new Set(["text", "email", "tel", "search", "password", "number", "url"]);
/** A running clock on the page (the time limit of the contact form), which is not a message about the input. */
const CLOCK = /^\d{1,2}:\d{2}$/;
/** The attempts of the form probe on the form of the defect. */
const formAttempt = (look: Look, input: string): Entry[] =>
  list(look.run("states.json")?.formErrors)
    .filter((form) => form.page === look.label && (look.at(form.form) || look.around(form.form) || look.at(form.where)))
    .flatMap((form) => list(form.attempts).filter((attempt) => attempt.input === input));
/** What contrast.json measured on this page, in every window and scheme. */
const contrastOf = (look: Look): Entry[] => list(look.run("contrast.json")).filter((page) => page.url === look.url);
const control = (look: Look): Entry[] => list(look.page("facts.json")?.controls).filter((entry) => look.at(entry.path));

export const EVIDENCE: Evidence[] = [
  // 1.1.1
  { defect: "1.1.1-logo-melding", agentNl: 'Of "logo" een passend tekstalternatief is, is een oordeel over de afbeelding.' },
  { defect: "1.1.1-artikelfoto", whereNl: ENGINES_NL, found: engines(["1.1.1"]) },
  { defect: "1.1.1-bestandsnaam", whereNl: "facts.json, images: het alt van de afbeelding is een bestandsnaam", found: (look) => list(look.page("facts.json")?.images).some((image) => look.at(image.path) && FILE_NAME.test(image.alt ?? "")) },
  {
    defect: "1.1.1-tarieven",
    whereNl: "site-states/component-faq/pictures.json: met de vraag open is in de afbeelding met een leeg alt tekst gelezen",
    found: (look) => list(look.run("site-states/component-faq/pictures.json")?.pictures).some((picture) => look.at(picture.where) && picture.alt === "" && picture.ocr?.hasText === true),
  },
  // 1.2.x
  { defect: "1.2.1-gesprek", agentNl: "Of er een uitgeschreven tekst bij het gesprek staat, vraagt luisteren en lezen." },
  { defect: "1.2.2-ondertitels", agentNl: "Of de video gesproken tekst heeft die ondertitels nodig heeft, vraagt luisteren." },
  { defect: "1.2.3-beschrijving", agentNl: "Wat alleen in beeld staat, vraagt kijken en luisteren." },
  { defect: "1.2.5-audiodescriptie", agentNl: "Wat alleen in beeld staat, vraagt kijken en luisteren." },
  // 1.3.x
  { defect: "1.3.1-vette-tussenkop", agentNl: "Of een vette alinea een kop is, is een oordeel over de tekst." },
  { defect: "1.3.1-lijst-als-alinea", agentNl: "Of regels met streepjes een lijst zijn, is een oordeel over de tekst." },
  { defect: "1.3.1-tussenkop-uitklapper", agentNl: "Of een vette alinea een kop is, is een oordeel over de tekst; hier ook nog in een dichte uitklapper." },
  { defect: "1.3.1-tabelkoppen", whereNl: "facts.json, tables: de tabel heeft geen kopcellen", found: (look) => list(look.page("facts.json")?.tables).some((table) => look.at(table.path) && table.headerCells === 0) },
  { defect: "1.3.1-voetkop", agentNl: "Of een tekst in de voet een kop is, is een oordeel over de tekst." },
  { defect: "1.3.1-keuzegroep", whereNl: "facts.json, controls: de keuzerondjes staan niet in een fieldset", found: (look) => list(look.page("facts.json")?.controls).some((entry) => entry.type === "radio" && !String(entry.path?.[0] ?? "").includes("fieldset")) },
  { defect: "1.3.2-zoekvolgorde", whereNl: "probes/order.json, cssOrder: CSS order verplaatst het element", found: (look) => list(look.page("probes/order.json")?.cssOrder).some((entry) => look.at(entry.path)) },
  { defect: "1.3.2-kaart-omgekeerd", whereNl: "probes/order.json, reversed: CSS draait de volgorde om", found: (look) => list(look.page("probes/order.json")?.reversed).length > 0 },
  { defect: "1.3.3-ronde-knop", agentNl: "Of een instructie alleen op vorm en plek steunt, is een oordeel over de tekst." },
  { defect: "1.3.4-draai", whereNl: "probes/portrait.json: een regel op de stand van het scherm verbergt inhoud", found: (look) => (look.page("probes/portrait.json")?.content?.orientationRules ?? 0) > 0 },
  { defect: "1.3.5-autocomplete", whereNl: "facts.json, controls: het veld voor de naam heeft geen autocomplete", found: (look) => control(look).some((entry) => !entry.autocomplete) },
  // 1.4.x
  { defect: "1.4.1-tekstlink", whereNl: ENGINES_NL, found: engines(["1.4.1"]) },
  { defect: "1.4.1-verplicht", agentNl: "Dat alleen de kleur zegt welke velden verplicht zijn, vraagt kijken naar het formulier." },
  { defect: "1.4.2-melodie", whereNl: "facts.json, media: geluid met autoplay en loop dat niet te pauzeren is", found: (look) => list(look.page("facts.json")?.media?.elements).some((element) => look.at(element.path) && element.attributes?.autoplay === true && element.canBePausedOrMuted === false) },
  { defect: "1.4.3-datum", whereNl: ENGINES_NL, found: engines(["1.4.3"]) },
  { defect: "1.4.3-tekst-op-foto", whereNl: "contrast.json, measurements: de tekst over de foto haalt de drempel niet", found: (look) => contrastOf(look).some((page) => list(page.measurements).some((text) => look.at(text.where) && text.outcome === "failed")) },
  {
    defect: "1.4.3-menu-aanwijzen",
    whereNl: "contrast.json, hoverFocus: een menulink onder de muisaanwijzer haalt de drempel niet",
    found: (look) => contrastOf(look).some((page) => list(page.hoverFocus?.rows).some((row) => row.trigger === "hover" && look.at(row.where) && list(row.texts).some((text) => text.outcome === "failed"))),
  },
  { defect: "1.4.4-zoom-uit", whereNl: ENGINES_NL, found: engines(["1.4.4"]) },
  { defect: "1.4.4-inleiding", whereNl: "probes/zoom200.json, clipped: de alinea valt bij 200% weg", found: (look) => list(look.page("probes/zoom200.json")?.clipped).some((entry) => look.at(entry.path)) },
  { defect: "1.4.5-zomerfeest", agentNl: "Of een afbeelding van tekst nodig is, is een oordeel over de afbeelding." },
  { defect: "1.4.10-weigerknop", whereNl: "site-states/blocker-cookies-narrow/reflow.json, offenders: met de melding open valt de knop op 320 pixels buiten beeld", found: (look) => list(look.run("site-states/blocker-cookies-narrow/reflow.json")?.offenders).some((entry) => look.at(entry.path)) },
  { defect: "1.4.10-rooster", whereNl: "probes/reflow.json, offenders: het rooster is breder dan het venster", found: (look) => list(look.page("probes/reflow.json")?.offenders).some((entry) => look.at(entry.path)) },
  {
    defect: "1.4.11-veldrand",
    whereNl: "contrast.json, controls: de rand van een tekstveld haalt 3 op 1 niet",
    found: (look) => {
      // Text fields only: a native radio button or an input laid over a drawn box has a border of its own kind.
      const fields = new Set(list(look.page("facts.json")?.controls).filter((entry) => entry.tag === "input" && TEXT_FIELD.has(entry.type)).map((entry) => String(entry.path?.[0])));
      return contrastOf(look).some((page) => list(page.controls).some((entry) => fields.has(entry.where) && look.at(entry.where) && typeof entry.edgeRatio === "number" && entry.edgeRatio < 3 && (entry.fillRatio ?? 1) < 3));
    },
  },
  { defect: "1.4.12-tegel", whereNl: "probes/textspacing.json, newlyClipped met textCut.lost: in de tegel verdwijnt tekst met ruimere tekstafstand", found: (look) => list(look.page("probes/textspacing.json")?.newlyClipped).some((entry) => look.at(entry.path) && (entry.textCut as { lost?: boolean } | undefined)?.lost === true) },
  {
    defect: "1.4.13-uitleg",
    whereNl: "states.json, hover: de uitleg sluit niet met Escape of verdwijnt als de muis erheen gaat",
    found: (look) => list(look.run("states.json")?.hover).some((row) => row.page === look.label && /^span /.test(String(row.control)) && (row.dismissedByEscape === false || row.staysWhenPointerMovesOntoIt === false)),
  },
  // 2.1.x
  { defect: "2.1.1-nieuwskaart", whereNl: "facts.json, clickables: de lijst om de kaarten luistert naar een klik", found: (look) => list(look.page("facts.json")?.clickables).some((entry) => look.at(entry.path) || look.around(entry.path)) },
  { defect: "2.1.1-productkaart", whereNl: "facts.json, clickables: het rooster om de kaarten luistert naar een klik", found: (look) => list(look.page("facts.json")?.clickables).some((entry) => look.at(entry.path) || look.around(entry.path)) },
  { defect: "2.1.1-vinkje", whereNl: "facts.json, controls: het selectievakje is verborgen met display:none", found: (look) => control(look).some((entry) => entry.hiddenBy === "display: none") },
  { defect: "2.1.1-naar-boven", whereNl: "facts.json, clickables: een link zonder href die op een klik reageert", found: (look) => list(look.page("facts.json")?.clickables).some((entry) => look.at(entry.path) && (entry.signals ?? []).includes("a-without-href")) },
  { defect: "2.1.1-chat-sluit", whereNl: "site-states/component-chat/facts.json, clickables: het kruisje is een div met een klik", found: (look) => list(look.run("site-states/component-chat/facts.json")?.clickables).some((entry) => /chat-sluit/.test(String(entry.html ?? ""))) },
  {
    defect: "2.1.2-chat",
    whereNl: "site-states/component-chat/tabwalk.json: met de chat open blijft Tab in het invoerveld",
    found: (look) => {
      const stops = list(look.run("site-states/component-chat/tabwalk.json")?.stops);
      return stops.length > 0 && stops.every((stop) => look.at(stop.path));
    },
  },
  { defect: "2.1.4-sneltoets", whereNl: "states.json, singleKeys: een toets van één teken doet iets op de pagina", found: (look) => list(look.run("states.json")?.singleKeys?.reactions).some((reaction) => reaction.page === look.label) },
  // 2.2.x
  { defect: "2.2.1-tijdslimiet", agentNl: "De tijdslimiet loopt na tien minuten af; de veegronde legt de timers vast, maar of de melding een grens is, vraagt lezen." },
  { defect: "2.2.2-uitgelicht", whereNl: "probes/motion.json, intervals: een timer wisselt de inhoud elke vier seconden", found: (look) => list(look.page("probes/motion.json")?.intervals).length > 0 },
  // 2.4.x
  { defect: "2.4.1-skiplink", whereNl: "probes/skiplink.json: het doel van de skiplink bestaat niet", found: (look) => Boolean(look.page("probes/skiplink.json")?.aim?.target?.missing) },
  { defect: "2.4.2-sjabloonrest", agentNl: "Of een titel de pagina beschrijft, is een oordeel over de tekst." },
  {
    defect: "2.4.2-zelfde-titel",
    whereNl: "facts.json, title: twee pagina's hebben dezelfde titel",
    pages: ["/afval.html"],
    found: (look) => {
      const titles = list(look.run("sample.json")?.items).map((item) => item.title);
      const own = look.page("facts.json")?.title;
      return typeof own === "string" && titles.filter((title) => title === own).length > 1;
    },
  },
  { defect: "2.4.3-tabindex", whereNl: "facts.json, controls: een veld heeft een positieve tabindex", found: (look) => control(look).some((entry) => Number(entry.tabindex) > 0) },
  {
    defect: "2.4.3-mobiel-menu",
    whereNl: "site-states/component-menu-smal/tabwalk.json: met het menu open komen de links ervan pas na de voet",
    found: (look) => {
      const stops = list(look.run("site-states/component-menu-smal/tabwalk.json")?.stops);
      const menu = stops.findIndex((stop) => look.at(stop.path));
      return menu > 0 && stops.slice(0, menu).some((stop) => stop.region === "footer");
    },
  },
  { defect: "2.4.4-klik-hier", agentNl: 'Of "Klik hier" in zijn context het doel zegt, is een oordeel over de tekst.' },
  { defect: "2.4.4-sociaal", whereNl: ENGINES_NL, found: engines(["2.4.4", "4.1.2"]) },
  { defect: "2.4.6-informatie", agentNl: "Of een kop beschrijft wat eronder staat, is een oordeel over de tekst." },
  { defect: "2.4.7-menu", whereNl: "probes/tabwalk.json: met focus verandert er niets aan de menulink", found: (look) => list(look.page("probes/tabwalk.json")?.stops).some((stop) => look.at(stop.path) && stop.styleChanges === false && !stop.focusPixelShare) },
  { defect: "2.4.11-melding", whereNl: "site-states/blocker-cookies/tabwalk.json: met de melding open ligt een element met focus eronder", found: (look) => list(look.run("site-states/blocker-cookies/tabwalk.json")?.stops).some((stop) => String(stop.coveredBy ?? "").includes("cookiemelding")) },
  // 2.5.x
  { defect: "2.5.1-galerij", agentNl: "Dat vegen de enige manier is, blijkt pas bij proberen met een aanwijzer." },
  { defect: "2.5.2-feedback", whereNl: "states.json, downEvents: de knop doet al iets bij indrukken en loslaten ernaast maakt het niet ongedaan", found: (look) => list(look.run("states.json")?.downEvents).some((row) => row.page === look.label && row.changeOnDown !== null && row.undoneByReleasingElsewhere === false) },
  { defect: "2.5.3-zoekknop", whereNl: ENGINES_NL, found: engines(["2.5.3"]) },
  { defect: "2.5.7-schuif", agentNl: "Dat alleen slepen werkt, blijkt pas bij proberen met een aanwijzer." },
  { defect: "2.5.8-paginering", whereNl: ENGINES_NL, found: engines(["2.5.8"]) },
  // 3.x
  { defect: "3.1.1-taal", whereNl: ENGINES_NL, pages: [ARTICLE, NOT_FOUND], found: engines(["3.1.1"]) },
  { defect: "3.1.2-engels", agentNl: "Welke taal een zin heeft, vraagt lezen; de herkenning van taal is een hulp, geen bewijs." },
  { defect: "3.2.1-voetlink", whereNl: "probes/tabwalk.json, focusThrownAwayBy: de link gooit de focus weg", found: (look) => list(look.page("probes/tabwalk.json")?.focusThrownAwayBy).length > 0 },
  { defect: "3.2.2-wijk", whereNl: "states.json, settings: een andere keuze in de lijst verandert de context", found: (look) => list(look.run("states.json")?.settings).some((row) => row.page === look.label && /^select /.test(String(row.control)) && Boolean(row.contextChange)) },
  {
    defect: "3.2.3-menuvolgorde",
    whereNl: "facts.json, links: het hoofdmenu begint op deze pagina met een andere link dan op de startpagina",
    found: (look) => list(look.page("facts.json")?.links).find((link) => /^nav/.test(String(link.region ?? "")))?.href?.endsWith("/contact.html") === true,
  },
  { defect: "3.2.4-zoekknop", agentNl: "Of twee namen dezelfde functie hebben, is een oordeel over de pagina's." },
  { defect: "3.2.6-hulp", agentNl: "Of het hulpblok overal op dezelfde plek staat, is een vergelijking van pagina's." },
  {
    defect: "3.3.1-rode-rand",
    whereNl: "states.json, formErrors: na versturen van het lege formulier verschijnt geen melding",
    found: (look) => formAttempt(look, "leeg verstuurd").some((attempt) => list(attempt.newVisibleMessages).every((text) => CLOCK.test(String(text))) && list(attempt.liveRegionMessages).length === 0),
  },
  { defect: "3.3.2-plaatshouder", whereNl: "facts.json, controls: het veld heeft geen label, alleen een plaatshouder", found: (look) => control(look).some((entry) => !entry.labelText && Boolean(entry.placeholder)) },
  {
    defect: "3.3.3-datum",
    whereNl: "states.json, formErrors: na versturen met ongeldige invoer staat er alleen een melding zonder de gewenste vorm",
    found: (look) => formAttempt(look, "ongeldige invoer").some((attempt) => {
      const messages = list(attempt.newVisibleMessages).map(String).filter((text) => !CLOCK.test(text));
      return messages.some((text) => /ongeldig/i.test(text)) && !messages.some((text) => /dd|jjjj|vorm|bijvoorbeeld|\d{1,2}-\d{1,2}-\d{4}/i.test(text));
    }),
  },
  { defect: "3.3.4-controle", agentNl: "Of er een stap is om de aanvraag te controleren, vraagt het formulier doorlopen tot het versturen." },
  { defect: "3.3.7-adres", agentNl: "Of in stap 2 opnieuw om het adres wordt gevraagd, vraagt het formulier in stappen doorlopen en de velden vergelijken." },
  { defect: "3.3.8-wachtwoord", whereNl: "facts.json, controls: het wachtwoordveld zet automatisch invullen uit", found: (look) => control(look).some((entry) => entry.autocomplete === "off") },
  // 4.1.x
  { defect: "4.1.2-tabs", whereNl: "facts.json, clickables: de tabbladen zijn divs met een klik", found: (look) => list(look.page("facts.json")?.clickables).some((entry) => look.at(entry.path) && !entry.roleAttr) },
  { defect: "4.1.2-uitklapper", whereNl: "facts.json, controls: de knop zegt niet of hij open is", found: (look) => control(look).some((entry) => entry.tag === "button" && !("expanded" in (entry.ax?.properties ?? {}))) },
  { defect: "4.1.2-menuknop", whereNl: "probes/named-narrow.json, controls: op een smal scherm heeft de menuknop geen naam en geen toestand", found: (look) => list(look.page("probes/named-narrow.json")?.controls).some((entry) => look.at(entry.path) && !entry.ax?.name && !("expanded" in (entry.ax?.properties ?? {}))) },
  { defect: "4.1.2-rol-logo", whereNl: ENGINES_NL, found: engines(["4.1.2"]) },
  { defect: "4.1.2-kadertitel", whereNl: ENGINES_NL, found: engines(["4.1.2"]) },
  {
    defect: "4.1.2-venster",
    whereNl: "site-states/component-productvenster/aria.yaml: het geopende venster staat in de boom zonder rol dialog",
    found: (look) => {
      const tree = String(look.run("site-states/component-productvenster/aria.yaml") ?? "");
      return tree.includes("Neem een pasfoto") && !/^\s*- dialog\b/m.test(tree);
    },
  },
  { defect: "4.1.3-bedankt", whereNl: "site-states/component-faq-oordeel/aria.yaml: het bedankje is een gewone alinea, geen status", found: (look) => /- (?!status)\w+: Bedankt voor uw reactie/.test(String(look.run("site-states/component-faq-oordeel/aria.yaml") ?? "")) },
  { defect: "4.1.3-aantal", whereNl: "site-states/component-producten-filter/aria.yaml: het aantal is een gewone alinea, geen status", found: (look) => /- (?!status)\w+: \d+ producten gevonden/.test(String(look.run("site-states/component-producten-filter/aria.yaml") ?? "")) },
  {
    defect: "4.1.3-chat",
    whereNl: "site-states/component-chat/aria.yaml: met de chat open staan de berichten niet in een log",
    found: (look) => {
      const tree = String(look.run("site-states/component-chat/aria.yaml") ?? "");
      return tree.includes("Chat met de gemeente") && !/^\s*- log\b/m.test(tree);
    },
  },
];
