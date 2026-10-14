import { buildSample } from "../../src/commands/sample.ts";
import { allCriteriaSorted, resolveCriterion, summarise, type Evaluation } from "../../src/lib/evaluation.ts";
import type { Finding, Outcome, Verdict } from "../../src/lib/verdict.ts";

/**
 * A made-up but realistic evaluation, for developing and testing the report without a real run.
 * It has the form `evaluate` writes: a judge and a verifier who writes the final verdict.
 */

const FAILED: Record<string, Finding[]> = {
  "1.1.1": [
    {
      titleNl: "Statuspictogram zonder tekstalternatief",
      observedNl: "Op de statuspagina staat bij elke dienst een gekleurd bolletje. Het bolletje is verborgen voor hulpsoftware en de status staat nergens in tekst.",
      impactNl: "Wie een schermlezer gebruikt, hoort niet of een dienst werkt of gestoord is.",
      fixNl: "Zet de status als tekst naast het pictogram, of geef het pictogram role=\"img\" met een aria-label zoals \"Storing\".",
      severity: "hoog",
      owner: "techniek",
      component: "statusindicator",
      locations: [{ page: "P04", where: "main >>> ul.diensten > li > span.status" }],
      pagesAffected: "P04",
      evidence: ["images"],
    },
  ],
  "1.4.3": [
    {
      titleNl: "Grijze hulptekst heeft te weinig contrast",
      observedNl: "De hulptekst onder invoervelden is #8a8a8a op wit. De contrastverhouding is 3,5:1, waar 4,5:1 nodig is.",
      impactNl: "Slechtzienden en mensen die een scherm in fel licht gebruiken, kunnen de hulptekst niet lezen.",
      fixNl: "Gebruik voor hulptekst een kleur van minstens #767676 op wit, of de tekstkleur uit het designsysteem.",
      severity: "midden",
      owner: "design",
      component: "formulierveld",
      locations: [{ page: "P02", where: "form >>> p.hulptekst" }, { page: "P06", where: "form >>> p.hulptekst" }],
      pagesAffected: "P02, P06",
      evidence: ["engine"],
    },
  ],
  "2.4.7": [
    {
      titleNl: "Focus is niet zichtbaar op de kaarten van de startpagina",
      observedNl: "Als een kaart op de startpagina de focus krijgt, verandert er niets zichtbaars. Gemeten verschil met en zonder focus: 0,0% van de pixels.",
      impactNl: "Wie met het toetsenbord werkt, ziet niet waar hij is en kan de kaarten niet gericht openen.",
      fixNl: "Geef de link in de kaart een zichtbare focusstijl, bijvoorbeeld de outline uit het designsysteem via :focus-visible.",
      severity: "hoog",
      owner: "techniek",
      component: "kaart",
      locations: [{ page: "P01", where: "main >>> a.kaart" }],
      pagesAffected: "P01",
      evidence: ["keyboard"],
    },
  ],
  "2.4.4": [
    {
      titleNl: "Vier links heten \"Lees meer\"",
      observedNl: "Op de nieuwspagina staan vier links met de naam \"Lees meer\" die naar vier verschillende berichten gaan.",
      impactNl: "In een lijst met links, zoals een schermlezer die toont, is niet te zien welk bericht bij welke link hoort.",
      fixNl: "Maak de titel van het bericht de link, of vul de linktekst aan met de titel in een visueel verborgen span.",
      severity: "midden",
      owner: "content",
      component: null,
      locations: [{ page: "P05", where: "main >>> article > a.meer" }],
      pagesAffected: "P05",
      evidence: ["links"],
    },
  ],
  "4.1.2": [
    {
      titleNl: "Menuknop meldt niet of het menu open is",
      observedNl: "De knop \"Menu\" heeft geen aria-expanded. Na openen verandert er in de toegankelijkheidsboom niets aan de knop.",
      impactNl: "Schermlezergebruikers weten niet of het menu open of dicht is.",
      fixNl: "Zet aria-expanded=\"false\" op de knop en wissel naar \"true\" bij openen.",
      severity: "midden",
      owner: "techniek",
      component: "hoofdnavigatie",
      locations: [{ page: "P01", where: "header >>> button.menu" }],
      pagesAffected: "alle 8",
      evidence: ["controls", "dialogs"],
    },
    {
      titleNl: "Zoekveld heeft geen naam",
      observedNl: "Het zoekveld in de kop heeft alleen een placeholder en geen label of aria-label. De toegankelijke naam is leeg.",
      impactNl: "Een schermlezer leest alleen \"invoerveld\" voor; de gebruiker weet niet waar het voor dient.",
      fixNl: "Koppel een label aan het veld of zet er aria-label=\"Zoeken\" op.",
      severity: "hoog",
      owner: "techniek",
      component: "zoekveld",
      locations: [{ page: "P01", where: "header >>> input[type=search]" }],
      pagesAffected: "alle 8",
      evidence: ["controls"],
    },
  ],
};

const CANT_TELL = ["1.4.11", "1.4.13", "2.1.1", "3.3.3"];
const INAPPLICABLE = ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.4.2", "2.2.1", "2.2.2", "2.3.1", "2.5.1", "2.5.4", "2.5.7", "3.3.4", "3.3.7", "3.3.8"];

function verdict(id: string, outcome: Outcome): Verdict {
  const observation = {
    passed: { checkedNl: "Alle onderdelen die onder dit criterium vallen", howNl: "Meting door script, beoordeeld op het dossier", observedNl: "Op 8 van 8 pagina's is geen afwijking gevonden; 112 elementen onderzocht." },
    failed: { checkedNl: "Alle onderdelen die onder dit criterium vallen", howNl: "Meting door script, beoordeeld op het dossier", observedNl: "Op een deel van de pagina's wijkt de site af; zie de bevindingen." },
    inapplicable: { checkedNl: "Of de content waar dit criterium over gaat voorkomt", howNl: "Telling over alle 8 pagina's van de site", observedNl: "Deze content komt op geen enkele pagina voor (telling: 0)." },
    cantTell: { checkedNl: "Het beschikbare bewijs", howNl: "Dossier voor dit criterium", observedNl: "Het bewijs is niet volledig genoeg om te oordelen." },
  }[outcome];
  return {
    criterion: id,
    outcome,
    rule: outcome === "failed" ? "R1" : outcome === "passed" ? "R3" : "R4",
    summaryNl: observation.observedNl,
    observations: [{ ...observation, evidence: ["engine"] }],
    findings: outcome === "failed" ? FAILED[id]! : [],
    ...(outcome === "cantTell" ? { missingNl: ["Een meting van dit gedrag in de toestand na interactie."] } : {}),
  };
}

export function exampleEvaluation(): Evaluation {
  const pages = ["", "contact", "over-ons", "status", "nieuws", "aanvragen", "toegankelijkheid", "deze-pagina-bestaat-niet"].map((path, index) => ({
    url: `https://voorbeeld.overheid.example/${path}`,
    slug: path || "home",
    status: path === "deze-pagina-bestaat-niet" ? 404 : 200,
    title: ["Startpagina", "Contact", "Over ons", "Status van onze diensten", "Nieuws", "Vergunning aanvragen", "Toegankelijkheid", "Pagina niet gevonden"][index]!,
    lang: "nl",
    templateHash: `t${index % 4}`,
    contentHash: `c${index}`.padEnd(64, "0"),
    foundVia: ["sitemap"],
    counts: {},
  }));
  const sample = buildSample({ baseUrl: pages[0]!.url, origin: "https://voorbeeld.overheid.example", sitemapUrls: 7, notFoundProbe: pages[7]!.url, pages, skipped: [], totals: {} }, "voorbeeld");
  const criteria = allCriteriaSorted().map((criterion) => {
    const outcome: Outcome = criterion.id in FAILED ? "failed" : CANT_TELL.includes(criterion.id) ? "cantTell" : INAPPLICABLE.includes(criterion.id) ? "inapplicable" : "passed";
    const final = verdict(criterion.id, outcome);
    const resolved = resolveCriterion(
      {
        criterion,
        verdicts: { a: final, final },
        procedure: { version: 1, sha256: "0".repeat(64), class: "probe+oordeel", limitsNl: criterion.id === "1.4.11" ? "De toolbox meet de contrastverhouding van randen en pictogrammen niet." : null },
        provenance: { dossierSha256: "1".repeat(64), verdictSha256: { a: "2".repeat(64), b: "3".repeat(64), final: "4".repeat(64) } },
      },
      "VRB",
    );
    // What the verifier wrote about its attempt to overturn the verdict.
    return { ...resolved, challengeNl: "Het dossier is nagelopen op tegenbewijs; dat is niet gevonden." };
  });
  return {
    schema: "loep/evaluation/1",
    site: { name: "Voorbeeldgemeente", baseUrl: pages[0]!.url, organisation: "Gemeente Voorbeeld" },
    evaluatedAt: "2026-10-10T08:00:00.000Z",
    method: {
      name: "WCAG-EM",
      version: "2.0",
      url: "https://www.w3.org/TR/WCAG-EM-2/",
      typeNl: "Automatisch onderzoek: regel-engines, scripts die het gedrag in de browser meten, een verkenning en een rondgang per paginatype door een taalmodel, beoordeling per criterium door een taalmodel met meetinstrumenten, en een tweede ronde waarin een andere agent elke bevinding moet bevestigen.",
      deviationsNl: ["Stap 4 (beoordelen) is niet door een mens uitgevoerd maar door een taalmodel, volgens een vaste procedure per criterium.", "Er is geen steekproef getrokken: alle pagina's van de site zijn onderzocht."],
    },
    standards: { wcag: ["WCAG 2.2 niveau A en AA", "WCAG 2.1 niveau A en AA"], en301549: "EN 301 549 v3.2.1, hoofdstuk 9" },
    scope: { includedNl: ["Alle pagina's op https://voorbeeld.overheid.example"], excludedNl: ["Websites van derden waarnaar wordt gelinkt"] },
    sample,
    baseline: { browsers: [{ name: "Chromium (Chrome for Testing)", version: "153.0.8010.12", engine: "Blink" }], assistiveTechnology: [], noteNl: "Er is geen hulpsoftware gebruikt. Een schermlezer is niet getest." },
    technologies: ["CSS", "HTML", "JavaScript", "SVG", "WAI-ARIA"],
    toolchain: {
      toolbox: { commit: "0000000000000000000000000000000000000000", dirty: false, lockfileSha256: "5".repeat(64), version: "0.0.1" },
      runtime: { node: "v22.18.0", platform: "linux", osRelease: "6.8", arch: "x64" },
      packages: { "axe-core": "4.13.0", "@siteimprove/alfa-rules": "0.119.0", playwright: "1.63.0" },
      browser: { name: "chromium", version: "153.0.8010.12" },
      rendering: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "nl-NL", timezoneId: "Europe/Amsterdam", reducedMotion: "reduce", navigationTimeoutMs: 45000, settleTimeoutMs: 10000 },
    },
    judgment: { model: "voorbeeldmodel", rounds: ["rondgang per paginatype", "beoordeling met instrumenten", "verificatie en eindoordeel"], promptTemplates: { rondgang: "6".repeat(64), beoordeel: "7".repeat(64), verifieer: "8".repeat(64) } },
    chain: { kind: "instruments", gate: null, writes: { allowed: false, noteNl: "verzoeken die iets kunnen wijzigen zijn tegengehouden" } },
    criteria,
    summary: summarise(criteria),
    limitationsNl: [
      "Het onderzoek is uitgevoerd met één browser (Chromium). Er is niet getest met andere browsers en niet met hulpsoftware zoals een schermlezer.",
      "De beoordeling per criterium is gedaan door een taalmodel op basis van bewijs dat scripts hebben verzameld.",
      "1.4.11 Contrast van niet-tekstuele content: De toolbox meet de contrastverhouding van randen en pictogrammen niet.",
    ],
    signature: null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(exampleEvaluation(), null, 2)}\n`);
}
