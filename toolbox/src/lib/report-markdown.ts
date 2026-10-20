import { KIND_NAME_NL, kindsNl } from "./documents.ts";
import { pageIndex, type Defect } from "./defects.ts";
import { changedSinceCommit, closeCutQuote, complianceStatus, evaluationHash, idsAcrossVersionsNl, knownCommit, madeWith, openCriteria, OUTAGE_NL, OUTCOME_LABEL, type ComplianceStatus, type CriterionOutcome, type CriterionResult, type Evaluation, type ReportFinding, type Signature } from "./evaluation.ts";
import { modelOf } from "../instruments/methods/registry.ts";
import { signatureIsCurrent } from "../commands/sign.ts";
import { extensionsNl } from "./budget.ts";
import { modelsNl } from "./models.ts";
import { NOT_SENT, notSentOrigins, OPEN_POINT_KINDS, openPoint, UNREACHABLE, waitsOnlyOnSending, type Outcome } from "./verdict.ts";
import { siteOrigins } from "./origins.ts";
import { readsAllowedNl } from "./reads.ts";
import { compareCriterionIds, type WcagVersion } from "./wcag.ts";

/**
 * The report as Markdown, and everything the PDF template needs that it cannot work
 * out from the evaluation on its own. Both renderings draw their fixed sentences from
 * here, so the Markdown and the PDF cannot drift apart.
 */

export const OUTCOME_ORDER: CriterionOutcome[] = ["passed", "failed", "inapplicable", "cantTell", "untested"];

/**
 * What the report shows as the outcome of a criterion. "nothingFound" is "cantTell" in the
 * data: no deviation was found, but not everything was measured. It is shown apart so a
 * reader can tell it from a question that is really open; it never counts as a pass.
 */
export type ShownOutcome = CriterionOutcome | "nothingFound";
export const shownOutcome = (criterion: CriterionResult): ShownOutcome => (criterion.outcome === "cantTell" && criterion.nothingFound ? "nothingFound" : criterion.outcome);
export const SHOWN_LABEL: Record<ShownOutcome, string> = { ...OUTCOME_LABEL, nothingFound: "Geen afwijking gevonden, niet volledig gemeten" };
/** The outcomes in the order of the tables; the extra one only when it occurs, so an evaluation without it reads as before. */
const shownOrder = (evaluation: Evaluation): ShownOutcome[] => (evaluation.criteria.some((criterion) => shownOutcome(criterion) === "nothingFound") ? ["passed", "failed", "inapplicable", "nothingFound", "cantTell", "untested"] : OUTCOME_ORDER);

function shownTally(evaluation: Evaluation, version: WcagVersion): Record<ShownOutcome, number> & { total: number } {
  const relevant = evaluation.criteria.filter((criterion) => criterion.versions.includes(version));
  const tally = { passed: 0, failed: 0, inapplicable: 0, nothingFound: 0, cantTell: 0, untested: 0, total: relevant.length };
  for (const criterion of relevant) tally[shownOutcome(criterion)]++;
  return tally;
}

/** Every outcome is shown as a shape plus its label, never as a colour alone. */
export const OUTCOME_SYMBOL: Record<ShownOutcome, string> = {
  nothingFound: "◐",
  passed: "●",
  failed: "✕",
  inapplicable: "−",
  cantTell: "?",
  untested: "○",
};

const SEVERITY_RANK: Record<ReportFinding["severity"], number> = { blokkerend: 0, hoog: 1, midden: 2, laag: 3 };
const STATUS_LABEL: Record<ComplianceStatus, string> = {
  A: "status A (voldoet volledig)",
  B: "status B (voldoet gedeeltelijk)",
  C: "status C (eerste maatregelen genomen)",
  geen: "geen status",
};
const VERSIONS: WcagVersion[] = ["2.2", "2.1"];
/** The summary also shows the second step of severity that occurs, as long as the list then stays this short. */
const TOP_WITH_SECOND_STEP = 10;
const OWNER_ORDER = ["techniek", "content", "design", "leverancier"];
/** The owners in the order of the work list: the fixed ones first, then any other, such as the components of a vendor, as a list of its own. */
const ownersOf = (items: { owner: string }[]): string[] => [...OWNER_ORDER, ...[...new Set(items.map((item) => item.owner))].filter((owner) => !OWNER_ORDER.includes(owner)).sort()];
/** In the main part a list shows this many items of this length; the appendix has everything. */

/** Fixed sentences that appear in both renderings. */
type ScopeFrame = NonNullable<Evaluation["scope"]["frames"]>[number];

/** One embedded frame under the scope: what it is, whether it counts, why, and who decided when that was a person. */
export const scopeFrameNl = (frame: ScopeFrame): string =>
  `${frame.descriptionNl} (${frame.address}): ${frame.kindNl}. ${frame.standingNl}.${frame.reasonNl ? ` Reden: ${frame.reasonNl.replace(/\.$/, "")}.` : ""}${frame.decidedBy ? ` Bepaald door: ${frame.decidedBy}.` : ""}`;

export const REPORT_TEXT = {
  scopeFrames: "Ingesloten vensters, per venster wat het is en of het meetelt",
  title: "Toegankelijkheidsonderzoek",
  concept: "Concept, niet afgetekend",
  staleSignature: "De handtekening hoort bij een eerdere versie van dit onderzoek.",
  scoreNote: "\"Niet van toepassing\" telt niet mee als \"Voldoet\". \"Kan niet bepalen\" en \"Niet beoordeeld\" zijn open: daar is nog geen oordeel.",
  scoreNoteNothingFound: "\"Geen afwijking gevonden, niet volledig gemeten\" is ook open en telt niet mee als \"Voldoet\": er is niets fout gevonden, maar niet alles is gemeten. Wat er wel is gemeten, staat bij het criterium.",
  measured: "Dekking",
  performedBy: "In eigen beheer",
  // Where the report came from: the toolbox measures, a person judges.
  madeWith: "Gemaakt met",
  instrument: "een instrument dat meet en bewijs vastlegt; het oordeel is van wie het rapport aftekent",
  followsUp: "Heronderzoek",
  notSigned: "Nog niet afgetekend",
  noAssistiveTechnology: "Er is geen hulpsoftware gebruikt.",
  browserNotUsed: "niet gebruikt in dit onderzoek",
  dirty: "Let op: de toolbox bevatte wijzigingen die niet in deze commit staan. De commit beschrijft dus niet precies de code die is gebruikt.",
  // A toolbox installed as a plugin is no git repository: there is no commit to name.
  commitUnknown: "onbekend (niet gemaakt vanuit een git-repository)",
  overviewIntro: "Elke regel verwijst naar het deel waar de uitkomst wordt onderbouwd.",
  componentIntro: "Bevindingen in hetzelfde onderdeel zijn vaak met één aanpassing op te lossen. Daarom staan ze hier bij elkaar, elk met het nummer dat naar de bevinding verwijst.",
  quietTitle: "Zonder bevinding en zonder open punt",
  quietIntro: "Deze criteria zijn niet van toepassing, of er is aan voldaan zonder bevinding en zonder open punt. Ze hebben daarom geen eigen blok. De waarnemingen en de toetsing staan in bijlage A.",
  openLink: "Nog uitzoeken",
  pageIntro: "Een bevinding staat hier bij elke pagina waar een plek is aangewezen. Het probleem kan op meer pagina's spelen; dat staat bij de bevinding zelf.",
  todoIntro: "Dit is de werklijst die uit het onderzoek volgt. Eerst wat aantoonbaar mis is, daarna wat nog niet is vast te stellen.",
  fixIntro: "De bevindingen bij de criteria die niet zijn gehaald, per eigenaar en met de zwaarste eerst.",
  defectIntro:
    "De gebreken, per eigenaar en met de zwaarste eerst. Een gebrek is één plek die hersteld moet worden. Het onderzoek oordeelt per criterium, dus één gebrek kan onder meerdere criteria een bevinding opleveren. Het gebrek staat hier bij het criterium dat over de oorzaak gaat; \"raakt ook\" noemt de andere criteria.",
  adviceNote:
    "Over de oplossingen: een stuk HTML in een oplossing toont de gewenste uitvoer in de browser, niet per se de wijziging in de bron (Markdown, een sjabloon of een component). Meet na een wijziging aan ruimte, breedte of afbreken opnieuw op 320 pixels breed en op een tussenbreedte, zoals 500 en 640 pixels: een oplossing voor één breedte kan op een andere iets breken.",
  defect: { label: "Gebrek", main: "Hoofdcriterium", also: "Raakt ook", check: "Controle" },
  measuredStates: "Gemeten toestanden",
  samplePageTypes:
    "Per paginatype uit het sitemodel: hoeveel unieke pagina's het heeft, hoeveel daarvan in de steekproef staan en waarom die. Een groot paginatype krijgt naast de voorbeeldpagina van de verkenner extra pagina's, gekozen op wat hun inhoud toevoegt aan de pagina's van dat type die er al in staan: afbeeldingen, tabellen, formulieren, video, geluid, ingesloten vensters, koppen, lijsten en lengte. Bij elke pagina hierboven staat wat ze toevoegt.",
  defectPageIntro: "Een gebrek staat hier bij elke pagina waar een van zijn bevindingen een plek aanwijst. Het kan op meer pagina's spelen; dat staat in de werklijst.",
  unfinished: "Zolang er een criterium open is, is status A of B niet mogelijk. Wat dit onderzoek niet heeft vastgesteld, sluit een nieuwe meting of een persoon die het vaststelt.",
  ownerOpen: "Daar kan geen instrument verder mee: een persoon legt het antwoord vast, en daarna telt het mee in de uitkomst.",
  ownerOpenNotSent: "Daar is geen persoon voor nodig: een instrument meet het in een nieuw onderzoek dat mag versturen, zie \"Nog uitzoeken\".",
  ownerOpenMixed: "Die meet een instrument in een nieuw onderzoek dat mag versturen, zie \"Nog uitzoeken\". Bij de andere kan geen instrument verder: een persoon legt het antwoord vast, en daarna telt het mee in de uitkomst.",
  personFailed: "Door een persoon vastgesteld",
  personFailedIntro: "Bij deze criteria heeft een persoon vastgesteld dat de site niet voldoet. Er staat geen bevinding van een instrument achter: wat er mis is, staat in het antwoord van die persoon.",
  answers: "Vastgesteld door een persoon, niet door een instrument",
  before: "Het oordeel dat hiervoor stond",
  establishedBy: "Vastgesteld door",
  recommendations: "Aanbevelingen",
  recommendationsIntro: "Wat hier staat, is geen eis van WCAG en telt niet mee voor de uitkomst of de status. Het zijn patronen die de procedure van een criterium aanraadt, en alleen waar de procedure een regel voor een aanbeveling heeft. Een gebrek staat nooit hier: wat de norm fout noemt, staat onder Oplossen.",
  investigateIntro: "Wat het onderzoek open laat, staat hier in delen. Het eerste deel is werk voor de eigenaar van de site. Het laatste deel gaat over grenzen van dit onderzoek: daar hoeft de eigenaar niets mee te doen.",
  investigate: {
    owner: "Dit moet een mens nagaan",
    ownerIntro: "Wat geen instrument kan vaststellen, of wat een keuze vraagt. Achter elk criterium staat de uitkomst die het nu heeft.",
    notSent: "Pas te meten als het onderzoek mag versturen",
    notSentIntro:
      "Wat pas verschijnt nadat een bericht of formulier is verstuurd, zoals het antwoord van een chat, is hier niet gemeten: dit onderzoek mocht daar niets versturen. Een persoon is er niet voor nodig. Een instrument meet het zodra versturen mag, en dat is een keuze van de eigenaar van de site. Achter elk criterium staat de uitkomst die het nu heeft.",
    unreachable: "Niet bereikbaar tijdens het onderzoek",
    unreachableIntro:
      "Een deel van de site, een pagina of een ingesloten venster, laadde bij herhaalde pogingen niet, terwijl de rest van de site wel laadde. Wat daar staat, is niet gemeten. Bij elk punt staat wat niet bereikbaar was en wanneer. Dat is geen oordeel over de site: of het deel ook voor bezoekers onbereikbaar was, is niet vastgesteld. Een nieuwe meting stelt het vast zodra het weer laadt. Achter elk criterium staat de uitkomst die het nu heeft.",
    unsorted: "Open punten zonder soort",
    unsortedIntro: "Bij deze punten is niet vastgelegd of ze werk zijn voor de eigenaar van de site of over het onderzoek gaan. Ze staan hier volledig.",
    toolbox: "Dit meet de toolbox een volgende keer",
    toolboxIntro: "Wat niet is gemeten, waar de tijd voor op was, of een proef die niet werkte. Per criterium staat hier hoeveel punten er zijn; de punten zelf staan volledig in bijlage A. Staat hier een criterium zonder oordeel, dan is het onderzoek onvolledig: een nieuwe meting of een persoon moet het nog vaststellen.",
    appendix: "Open, voor een volgende meting",
  },
  vendorIntro: "Deze bevindingen raken een element van de leverancier. Dat zegt waar het gebrek zit, niet wie het moet herstellen: de oorzaak kan in het component liggen of in de manier waarop de site het gebruikt. Ga per bevinding na welke van de twee het is.",
  instrumentsIntro: "Elke meting van een agent is door een of meer van deze hulpmiddelen beantwoord. De lijst is geteld uit de vastgelegde waarnemingen: ze noemt wat in dit onderzoek is gebruikt, niet wat op de machine stond. Onder Pakketten hierboven staan alle pakketten waarmee de toolbox draait, ook die alleen de metingen vooraf op elke pagina deden. Alle hulpmiddelen zijn open source; de licentie van elk staat in evaluation.json en in de repository van de toolbox.",
  appendixIntro:
    "Deze bijlage is naslag. Per criterium staat hier wat is onderzocht, hoe, en wat daarbij is waargenomen, met de volledige toetsing van het oordeel. De hoofdtekst vat dit samen.",
  shortVersion: "korte versie",
  appendixApart:
    "Bijlage A staat niet in deze korte versie. Ze staat in het volledige rapport: het bestand rapport.pdf, gemaakt uit dezelfde evaluatie en met hetzelfde kenmerk. Daar staat per criterium wat is onderzocht, hoe, en wat daarbij is waargenomen. Waar deze versie naar bijlage A verwijst, is dat bestand bedoeld.",
  procedureLimits: "De beperking van de procedure staat per criterium in bijlage A.",
  model: "Beoordelend model, zoals opgegeven",
  modelNote: "opgegeven door wie het onderzoek uitvoerde; de toolbox legt niet zelf vast welk model draaide",
  modelNoteOperator: "opgegeven door wie het onderzoek uitvoerde",
  agentModels: "Model per rol, zoals elke agent het zelf opgaf",
  agentModelsNote: "Elke agent heeft bij de start van zijn sessie zelf opgegeven op welk model hij draaide, of dat hij het niet wist (onbekend). De toolbox legt dat vast en kan het niet controleren.",
  extensions: "Verlengd budget",
  extensionsNote: "Een agent kan het budget van zijn sessie hooguit twee keer zelf verlengen, elke keer met de helft van waarmee hij begon. De reden die hij opgaf, staat in het sessiebestand van de run.",
  trace: { judge: "Oordeel beoordelaar", final: "Eindoordeel (verificatie)", finish: "Afmaakronde" },
  traceIntro: "Met deze gegevens is na te gaan welke code, welke procedure en welk bewijs tot elk oordeel hebben geleid. De hashes zijn ingekort tot de eerste acht tekens.",
  sampleMethod: {
    census: "Alle pagina's onderzocht",
    "structured-plus-random": "Gerichte keuze, aangevuld met willekeurige pagina's",
    "fixed-list": "Vaste lijst van pagina's, vooraf opgegeven",
  },
  sampleKind: { structured: "Gericht", random: "Willekeurig", embedded: "Ingesloten venster" },
} as const;

/** The compliance status as the front of the report shows it: provisional until somebody signs. */
export interface StatusLine {
  /** "Voorlopige status: C (eerste maatregelen genomen)", or without "voorlopige" when signed. */
  headingNl: string;
  provisional: boolean;
  /** Under a provisional status: where it comes from and when it counts. */
  noteNl: string | null;
  /** How many criteria are open and why: what asks a person or a choice, and what the evaluation itself did not establish. */
  openNl: string;
  /** True when a criterion is open through the evaluation itself: the evaluation is not finished. */
  unfinished: boolean;
}

/** The texts about how the judgment was reached: a judge and a verifier, both with instruments. */
export interface ChainText {
  honestNl: string;
  /** How often the verifier came to another outcome than the judge, and what happened to the findings. */
  agreementNl: string;
  enginesNl: string;
  /** The steps of the evaluation in order. */
  stepsNl: { nameNl: string; textNl: string }[];
  /** Whether forms could be submitted; null when the evaluation does not say. */
  writesNl: string | null;
  /** Which POST requests that only read were let through, such as a question to a search service; null when there were none. */
  readsNl: string | null;
  challengeLabel: string;
  droppedLabel: string;
  verification: { reproduced: string; unverified: string; repeated: string };
}

export interface CriterionBrief {
  /** Who or what established the outcome, in a word or two for a table. */
  establishedNl: string;
  /** What a person recorded about open points of this criterion, one line per answer. Empty when there is none. */
  answersNl: string[];
  /** The verdict that stood before the one that counts: what it concluded and what it left open. Empty when the verifier's verdict counts. */
  beforeNl: string[];
  /** How many observations appendix A holds, as "5 waarnemingen"; null when there are none. */
  observationsNl: string | null;
  /** How firm the verdict is, in one line. */
  certaintyNl: string;
  /** What each round concluded, for the appendix. */
  roundsNl: string;
  /** How many open points this criterion has, as "3 punten"; null when there are none. */
  openNl: string | null;
  /** For a criterion without a deviation that was not fully measured: what was measured. Null otherwise. */
  coverageNl: string | null;
  /** The open points about the evaluation itself, in full: they stand in the appendix, the work list only counts them. */
  toolboxPointsNl: string[];
}

/** The open points of one criterion that stand in the work list in full. */
export interface OpenGroup {
  criterion: string;
  outcomeNl: string;
  pointsNl: string[];
  /** The first place this criterion stands in the work list: links to its open points land here. */
  anchor: boolean;
}

/** The points that stay open only because the run may not send, and the one declaration at inventory that would have let it. */
export interface NotSent {
  items: OpenGroup[];
  /** The criteria whose every open point is of this kind: one declaration is all they wait for. */
  onlyCriteria: string[];
  /** The sentence before the flags. */
  declarationNl: string;
  /** The flags of inventory, with the origin when the points name exactly one. */
  flags: string;
  /** Which origin to declare, and that it can be the origin of an embedded frame alone. */
  originNl: string;
}

/** One recommendation as the report lists it. */
export interface RecommendationItem {
  id: string;
  criterion: string;
  /** The recommendation rule of the procedure, such as "A1". */
  rule: string;
  titleNl: string;
  observedNl: string;
  recommendationNl: string;
  /** Each place with its page, in words of the page where there are any. */
  placesNl: string[];
}

/** Where a recommendation is, as plain text for both reports: words of the page first, as with a finding, and the spot as described when there are none. */
function recommendationPlaceNl(location: { page: string; where: string; heading?: string; text?: string; wholePage?: boolean }): string {
  if (location.wholePage) return `${location.page}: de hele pagina`;
  const words = [location.heading ? `onder de kop \u201c${location.heading}\u201d` : "", location.text ? `bij \u201c${location.text}\u201d` : ""].filter((part) => part !== "");
  return `${location.page}: ${words.length > 0 ? words.join(", ") : location.where}`;
}

export function recommendationItems(evaluation: Evaluation): RecommendationItem[] {
  return [...evaluation.criteria]
    .sort((a, b) => compareCriterionIds(a.id, b.id))
    .flatMap((criterion) => (criterion.recommendations ?? []).map((entry) => ({ id: entry.id, criterion: criterion.id, rule: entry.rule, titleNl: entry.titleNl, observedNl: entry.observedNl, recommendationNl: entry.recommendationNl, placesNl: entry.locations.map(recommendationPlaceNl) })));
}

export interface ReportDerived {
  hash: string;
  hashShort: string;
  dateNl: string;
  /** Where the report came from: with the commit for the cover, without for the foot of every page. */
  madeWithNl: string;
  madeWithShortNl: string;
  /** The one sentence that says what the toolbox is and whose the judgment is. */
  instrumentNl: string;
  /** The commit of the toolbox; null when it did not run from a git repository, also for the placeholder an older run wrote. */
  toolboxCommit: string | null;
  /** Whether the toolbox had changes outside its commit. Always false without a known commit. */
  toolboxChanged: boolean;
  signedDateNl: string | null;
  /** A signature for an earlier version does not count: the report is then a concept again. */
  signed: boolean;
  /** The signature that counts, for the template: evaluation.json itself carries none. */
  signature: Signature | null;
  signatureStale: boolean;
  status: Record<WcagVersion, { status: ComplianceStatus; reasonNl: string }>;
  statusSentenceNl: string;
  statusLine: StatusLine;
  /** One line when this evaluation follows up a signed one: its date and mark. Null otherwise; a concept is never named. */
  followsUpNl: string | null;
  /** What the agents said about their model, one line per role, and a line when the operator named another. Null when no agent session is known. */
  agentModels: { perRoleNl: string[]; differsNl: string | null } | null;
  /** Per role how many sessions added to their own budget and how often, in one line. Null when none did. */
  extensionsNl: string | null;
  chain: ChainText;
  /** One sentence per embedded frame for under the scope: what it is, whether it counts and why. Empty when the site model names none. */
  scopeFramesNl: string[];
  /** The version of each row of `evaluation.instruments` as the table shows it: a sha256 in it is shortened to eight characters, like the other hashes. */
  instrumentVersions: string[];
  /** The models that recognised speech, with the full sha256 of the file. Empty when nothing listened, and for an evaluation from before the hash was kept. */
  speechModels: { name: string; sha256: string }[];
  /** One line per browser: version, engine and what it was used for. An evaluation from before this was kept names the one browser of its manifest. */
  browsersNl: string[];
  meaningNl: string[];
  /** Page labels in sample order: the same labels the dossiers and verdicts use. */
  pageLabels: string[];
  /** The documents of the sample as the report lists them; null when the site has none. */
  documents: DocumentsDerived | null;
  topFindingIds: string[];
  /** Which findings the summary shows, how many it does not show and where those are. */
  topFindingsNoteNl: string;
  disagreementNl: string;
  /** The short form of each criterion for the main part, by criterion id. */
  briefs: Record<string, CriterionBrief>;
  /** Criteria with nothing to act on and nothing to look into: one row in a table, no block of their own. */
  quiet: string[];
  /** The recommendations of every criterion, in the order of the criteria: never part of an outcome. Empty when there is none. */
  recommendations: RecommendationItem[];
  todo: { /** Criteria a person found failing: there is no finding of an instrument behind them, so they stand here by name. */ person: { criterion: string; textNl: string }[]; fix: { owner: string; findingIds: string[] }[]; /** Findings that touch an element of the vendor, per element; null when no vendor was given. */ vendor: { nameNl: string; elements: { tag: string; findingIds: string[] }[] } | null; /** Every open point of the evaluation by whose work it is. The owner's points and those without a kind stand here in full; those about the evaluation itself are counted here and stand in appendix A. */ investigate: { owner: OpenGroup[]; /** The points that stay open only because the run may not send, with the declaration that would have let it; null when there are none. */ notSent: NotSent | null; /** The points about a part of the site that did not load while the rest did, in full: they say what and when. */ unreachable: OpenGroup[]; unsorted: OpenGroup[]; toolbox: { criterion: string; outcomeNl: string; countNl: string; kindsNl: string; /** What was measured, for a criterion without a deviation that was not fully measured. */ coverageNl: string | null; anchor: boolean }[] } };
  /** The findings grouped into things to repair; null for an evaluation from before that step existed. */
  defects: DefectsDerived | null;
  /** Limitations of the evaluation as a whole; those of a single procedure are in the appendix. */
  generalLimitationsNl: string[];
  procedureLimitations: number;
  outcomeOrder: ShownOutcome[];
  outcomeLabel: Record<ShownOutcome, string>;
  /** Per criterion what the report shows as its outcome. */
  shown: Record<string, ShownOutcome>;
  /** The counts per shown outcome: "cantTell" here is without the criteria that were not fully measured without a deviation. */
  tally: Record<WcagVersion, Record<ShownOutcome, number> & { total: number }>;
  scoreNoteNl: string;
  text: typeof REPORT_TEXT;
}

export interface DocumentsDerived {
  /** "Documenten op de site: 12", ... */
  factsNl: [string, string][];
  rows: { label: string; title: string; url: string; kindNl: string; /** "ingelezen" or why not. */ statusNl: string; reasonNl: string; /** Defects, or findings in an evaluation without defects, with a place in this document. */ here: { id: string; titleNl: string }[] }[];
}

export interface DefectsDerived {
  /** "27 gebreken, 61 bevindingen onder 18 criteria". */
  countsNl: string;
  topIds: string[];
  /** Which defects the summary shows, how many it does not show and where those are. */
  topNoteNl: string;
  fix: { owner: string; defectIds: string[] }[];
  /** Per defect: its pages in a short form. */
  pagesNl: Record<string, string>;
  /** Per page label: the defects with a finding that points at a place on that page. */
  byPage: Record<string, string[]>;
  /** Per finding: the defect it belongs to, and where it stands in it. */
  ofFinding: Record<string, { defectId: string; role: "only" | "main" | "other"; compact: boolean }>;
  /** How the grouping was done, for the section on reliability. */
  mergeNl: string;
}

/** Dutch long date in the timezone the site is evaluated in, independent of the machine's locale. */
export function dateNl(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

const DOCUMENT_STATUS_NL = { read: "Ingelezen", notRead: "Niet ingelezen", failed: "Niet op te halen of te openen", notMeasured: "Niet gemeten" } as const;

/** The documents of the sample with what the report says about each, and the defects or findings that point at them. */
function deriveDocuments(evaluation: Evaluation): DocumentsDerived | null {
  const documents = evaluation.documents;
  if (!documents) return null;
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const at = (label: string): ReportFinding[] => findings.filter((finding) => finding.locations.some((location) => location.page === label));
  const read = documents.items.filter((item) => item.status === "read").length;
  return {
    factsNl: [
      ["Documenten op de site", `${documents.onSite} (${kindsNl(documents.byKind)})`],
      ["In de steekproef", String(documents.items.length)],
      ["Ingelezen en beoordeeld", String(read)],
      ["In de steekproef, niet ingelezen", String(documents.items.length - read)],
      ["Niet gekozen, niet onderzocht", String(documents.notChosen)],
      ["Op een ander domein, niet onderzocht", String(documents.elsewhere)],
    ],
    rows: documents.items.map((item) => {
      const here = at(item.label);
      const defects = (evaluation.defects ?? []).filter((defect) => here.some((finding) => defect.findingIds.includes(finding.id)));
      return {
        label: item.label,
        title: item.title || decodeURIComponent(new URL(item.url).pathname.split("/").pop() || item.url),
        url: item.url,
        kindNl: KIND_NAME_NL[item.kind],
        statusNl: `${DOCUMENT_STATUS_NL[item.status]}${item.status !== "read" && item.reasonNl ? `: ${item.reasonNl}` : ""}`,
        reasonNl: item.reason,
        here: evaluation.defects ? defects.map((defect) => ({ id: defect.id, titleNl: defect.titleNl })) : here.map((finding) => ({ id: finding.id, titleNl: finding.titleNl })),
      };
    }),
  };
}

/** Page labels as the dossiers number them: by position in the sample. */
export const pageLabels = (evaluation: Evaluation): string[] => pageIndex(evaluation).labels;

export function allFindings(evaluation: Evaluation): ReportFinding[] {
  return evaluation.criteria.flatMap((criterion) => criterion.findings);
}

/** How many pages a finding touches, as far as the finding says so itself. */
function pagesTouched(finding: ReportFinding, pageCount: number): number {
  const located = new Set(finding.locations.map((location) => location.page)).size;
  const named = new Set(finding.pagesAffected.match(/\bP\d+\b/g) ?? []).size;
  const all = /\balle\b/i.test(finding.pagesAffected) ? pageCount : 0;
  return Math.max(located, named, all);
}

/**
 * The heaviest of a list sorted by severity: every item of the highest step that occurs, and
 * of the next step too while the list stays short. A step is never cut off halfway, and the
 * note says how many items are not shown and where they are.
 */
function heaviest<T extends { severity: ReportFinding["severity"] }>(sorted: T[], one: string, many: string, whereNl: string): { top: T[]; noteNl: string } {
  const steps = [...new Set(sorted.map((item) => item.severity))];
  const count = (step: T["severity"]): number => sorted.filter((item) => item.severity === step).length;
  const shown = steps.length > 1 && count(steps[0]!) + count(steps[1]!) <= TOP_WITH_SECOND_STEP ? steps.slice(0, 2) : steps.slice(0, 1);
  const top = sorted.filter((item) => shown.includes(item.severity));
  const rest = steps.filter((step) => !shown.includes(step));
  if (rest.length === 0) return { top, noteNl: `Hier ${top.length === 1 ? "staat" : "staan alle"} ${top.length === 1 ? `het enige ${one}` : `${top.length} ${many}`}.` };
  const left = sorted.length - top.length;
  return {
    top,
    noteNl:
      `Hier ${top.length === 1 ? `staat het ene ${one}` : `staan de ${top.length} ${many}`} met ernst ${shown.join(" en ")}; een hogere ernst komt niet voor. ` +
      (left === 1 ? `Het andere ${one} (ernst ${rest[0]}) staat ${whereNl}.` : `De andere ${left} ${many} (${rest.map((step) => `${count(step)} met ernst ${step}`).join(", ")}) staan ${whereNl}.`),
  };
}

function sortedFindings(evaluation: Evaluation): ReportFinding[] {
  const pageCount = evaluation.sample.items.length;
  return allFindings(evaluation).sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      pagesTouched(b, pageCount) - pagesTouched(a, pageCount) ||
      compareCriterionIds(a.criterion, b.criterion) ||
      a.id.localeCompare(b.id),
  );
}

const heaviestFindings = (evaluation: Evaluation): { top: ReportFinding[]; noteNl: string } => heaviest(sortedFindings(evaluation), "bevinding", "bevindingen", "bij de resultaten per criterium");

export function topFindings(evaluation: Evaluation): ReportFinding[] {
  return heaviestFindings(evaluation).top;
}

const criteriaCount = (count: number): string => (count === 1 ? "1 criterium" : `${count} criteria`);
const isAre = (count: number): string => (count === 1 ? "is" : "zijn");

function statusSentence(evaluation: Evaluation): string {
  const tally = evaluation.summary["2.2"];
  const open = tally.cantTell + tally.untested;
  const norm = "WCAG 2.2 niveau A en AA";
  const ofAll = `van de ${tally.total} criteria`;
  const partly = shownTally(evaluation, "2.2").nothingFound;
  const partlyNl = partly > 0 ? ` (bij ${partly} daarvan is geen afwijking gevonden, maar is niet alles gemeten)` : "";
  // The count comes with the criteria it is taken from: "voldoet niet aan de 55 criteria" reads as if all 55 failed.
  if (tally.failed > 0) {
    const openPart = open > 0 ? ` en ${open} nog open${partlyNl}` : "";
    return `${evaluation.site.name} voldoet niet aan ${norm}: ${ofAll} ${isAre(tally.failed)} er ${tally.failed} niet gehaald${openPart}.`;
  }
  if (open > 0) return `Bij ${evaluation.site.name} is geen afwijking gevonden van ${norm}, maar ${ofAll} ${isAre(open)} er ${open} nog open${partlyNl}. Daarom staat niet vast dat de site voldoet.`;
  return `Bij ${evaluation.site.name} is geen afwijking gevonden van de ${tally.total} criteria van ${norm}.`;
}

/**
 * Two sentences that are the same apart from their numbers become one, with both
 * numbers named. Returns null when they differ in more than that.
 */
function mergeCounts(legal: string, latest: string): string | null {
  if (legal === latest) return legal;
  const [left, right] = [legal.split(/(\d+)/), latest.split(/(\d+)/)];
  if (left.length !== right.length) return null;
  const merged: string[] = [];
  for (const [index, part] of left.entries()) {
    const other = right[index]!;
    if (part === other) merged.push(part);
    else if (index % 2 === 1) merged.push(`${part} (WCAG 2.1) of ${other} (WCAG 2.2)`);
    else return null;
  }
  return merged.join("");
}

const roundLabel = (outcome: Outcome | null): string => (outcome ? OUTCOME_LABEL[outcome].toLowerCase() : "geen oordeel");

const findingsCount = (count: number): string => plural(count, "bevinding", "bevindingen");

const ESTABLISHED_SHORT_NL = { verification: "controle", finishing: "aanvullende meting", person: "een persoon", sessionWatch: "meting van de sessieduur" } as const;

/** Who or what established the outcome, for a table. An evaluation from before this was kept had only the verifier. */
function establishedShort(criterion: CriterionResult): string {
  if (criterion.outcome === "untested") return "geen oordeel";
  return ESTABLISHED_SHORT_NL[criterion.established?.by ?? "verification"];
}

function certainty(criterion: CriterionResult): string {
  const { a, final } = criterion.rounds;
  const established = criterion.established;
  // An outcome that did not come from the verifier says so first: that is what a reader has to weigh.
  if (established && established.by !== "verification") {
    const before = established.before ? ` Daarvoor kwam de ${established.before.roundNl} op ${roundLabel(established.before.outcome)}.` : "";
    return `${established.noteNl}${before}`;
  }
  if (final === null) return "Er is geen eindoordeel.";
  const reproduced = criterion.findings.filter((finding) => finding.verification?.status === "reproduced").length;
  const added = criterion.findings.filter((finding) => finding.verification?.status === "unverified").length;
  const dropped = criterion.dropped?.length ?? criterion.droppedNl.length;
  const verdict = a === null ? `Alleen de controle heeft geoordeeld: ${roundLabel(final)}.` : a === final ? "De eerste beoordeling en de controle komen op dezelfde uitkomst." : `De eerste beoordeling kwam op ${roundLabel(a)}, de controle op ${roundLabel(final)}.`;
  const parts = [
    reproduced > 0 ? `${findingsCount(reproduced)} bij de controle bevestigd` : null,
    added > 0 ? `${findingsCount(added)} toegevoegd bij de controle` : null,
    dropped > 0 ? `${findingsCount(dropped)} uit de eerste beoordeling vervallen, zie bijlage A` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${verdict} ${parts.join(", ").replace(/^./, (letter) => letter.toUpperCase())}.` : verdict;
}

const roundName = (outcome: Outcome | null): string => (outcome ? OUTCOME_LABEL[outcome] : "geen oordeel");

function roundsLine(criterion: CriterionResult): string {
  const { a, final, finish } = criterion.rounds;
  const by = criterion.established?.by ?? "verification";
  const last = "tevens eindoordeel";
  const parts = [`Eerste beoordeling: ${roundName(a)}.`, `Controle${by === "verification" ? `, ${last}` : ""}: ${roundName(final)}.`];
  if (finish !== undefined) parts.push(`Aanvullende meting${by === "finishing" ? `, ${last}` : ""}: ${roundName(finish)}.`);
  if (by === "person") parts.push(`Een persoon, niet een instrument, ${last}: ${OUTCOME_LABEL[criterion.outcome]}.`);
  if (by === "sessionWatch") parts.push(`Meting van de sessieduur, ${last}: ${OUTCOME_LABEL[criterion.outcome]}.`);
  return parts.join(" ");
}

const answerLine = (answer: NonNullable<CriterionResult["answers"]>[number]): string =>
  `${openPoint(answer.pointNl).textNl.replace(/[.:]+$/, "")}. ${answer.instrument ? "Antwoord van de meting van de sessieduur" : "Antwoord van een persoon"} (${answer.instrument ? "" : "functie: "}${answer.role}, ${dateNl(answer.answeredAt)}): ${answer.didNl.replace(/\.$/, "")}. Uitkomst op dit punt: ${OUTCOME_LABEL[answer.outcome].toLowerCase()}.`;

/** The status the outcomes lead to, shown also when nobody has signed yet. */
function statusLine(evaluation: Evaluation, stale: boolean): StatusLine {
  const provisional = evaluation.signature === null;
  const signed: Evaluation = provisional ? { ...evaluation, signature: { name: "", role: "", organisation: "", signedAt: evaluation.evaluatedAt, statementNl: "", evaluationSha256: "", sealSha256: "" } } : evaluation;
  const [legal, latest] = [complianceStatus(signed, "2.1").status, complianceStatus(signed, "2.2").status];
  const name = (status: ComplianceStatus): string => (status === "geen" ? "geen, het onderzoek dekt niet alle eisen" : STATUS_LABEL[status].replace(/^status /, ""));
  const value = legal === latest ? name(legal) : `${name(legal)} voor WCAG 2.1, ${name(latest)} voor WCAG 2.2`;
  return {
    headingNl: `${provisional ? "Voorlopige status" : "Status"}: ${value}`,
    provisional,
    noteNl: provisional ? `Deze status volgt uit de uitkomsten in dit rapport. Ze telt pas als een persoon met naam het rapport heeft afgetekend.${stale ? ` ${REPORT_TEXT.staleSignature}` : ""}` : null,
    ...openCount(evaluation),
  };
}

/** How many criteria are open and why, for next to the status: the two reasons are counted apart, because only one of them is work for the owner. */
function openCount(evaluation: Evaluation): { openNl: string; unfinished: boolean } {
  const open = openCriteria(evaluation.criteria);
  const total = open.owner.length + open.evaluation.length;
  if (total === 0) return { openNl: "Open criteria: geen. Elk criterium heeft een oordeel.", unfinished: false };
  // The count is across WCAG 2.1 and 2.2 together, the summary sentence counts WCAG 2.2 alone: an id in one version says so, or the two numbers seem to disagree.
  const list = (ids: string[]): string => ` (${idsAcrossVersionsNl(ids, evaluation.criteria)})`;
  const ownerReason = `een mens of een keuze van de eigenaar${list(open.owner)}`;
  const evaluationReason = `door dit onderzoek niet vastgesteld${list(open.evaluation)}`;
  // With one reason the count is not repeated, and a reason that holds for no criterion is left out: "0 vragen een mens" says nothing.
  const reasonsNl =
    open.evaluation.length === 0
      ? `${total}, ${total === 1 ? "vraagt" : "vragen"} ${ownerReason}.`
      : open.owner.length === 0
        ? `${total}, ${evaluationReason}.`
        : `${total}. ${open.owner.length} ${open.owner.length === 1 ? "vraagt" : "vragen"} ${ownerReason}; ${open.evaluation.length} ${isAre(open.evaluation.length)} ${evaluationReason}.`;
  // A criterion that waits only for permission to send needs no person: it is counted apart, so the reader is not sent to one.
  const notSent = open.owner.filter((id) => waitsOnlyOnSending(evaluation.criteria.find((criterion) => criterion.id === id)?.missingNl ?? []));
  const notSentNl = notSent.length > 0 ? ` Van de criteria voor de eigenaar ${notSent.length === 1 ? "wacht" : "wachten"} er ${notSent.length} alleen op toestemming om te versturen${list(notSent)}.` : "";
  const ownerNl = notSent.length === 0 ? REPORT_TEXT.ownerOpen : notSent.length === open.owner.length ? REPORT_TEXT.ownerOpenNotSent : REPORT_TEXT.ownerOpenMixed;
  // A part of the site that did not load is counted apart too: the evaluation is not finished, and no fault of the site is established.
  const unreachable = open.evaluation.filter((id) => (evaluation.criteria.find((criterion) => criterion.id === id)?.missingNl ?? []).some((point) => openPoint(point).kind?.prefix === UNREACHABLE));
  const unreachableNl = unreachable.length > 0 ? ` Van de criteria die dit onderzoek niet vaststelde, ${unreachable.length === 1 ? "bleef" : "bleven"} er ${unreachable.length} open doordat een deel van de site tijdens het onderzoek niet bereikbaar was${list(unreachable)}, zie "Nog uitzoeken".` : "";
  return {
    openNl:
      `Open criteria: ${reasonsNl}${notSentNl}${unreachableNl}` +
      (open.evaluation.length > 0 ? ` ${REPORT_TEXT.unfinished}` : ` ${ownerNl}`),
    unfinished: open.evaluation.length > 0,
  };
}

function chainText(evaluation: Evaluation): ChainText {
  const findings = allFindings(evaluation);
  const reproduced = findings.filter((finding) => finding.verification?.status === "reproduced").length;
  const added = findings.filter((finding) => finding.verification?.status === "unverified").length;
  const repeated = findings.filter((finding) => finding.verification?.status === "repeated").length;
  const finishedCount = evaluation.criteria.filter((criterion) => criterion.rounds.finish !== undefined).length;
  const personCount = evaluation.criteria.filter((criterion) => criterion.established?.by === "person").length;
  const answeredCount = evaluation.criteria.filter((criterion) => (criterion.answers ?? []).length > 0).length;
  const dropped = evaluation.criteria.reduce((total, criterion) => total + (criterion.dropped?.length ?? criterion.droppedNl.length), 0);
  const changed = evaluation.criteria.filter((criterion) => criterion.rounds.a !== null && criterion.rounds.final !== null && criterion.rounds.a !== criterion.rounds.final).length;
  const states = new Set(Object.values(evaluation.measuredStates ?? {}).flat()).size;
  const gate = evaluation.chain?.gate ?? null;
  const packages = evaluation.toolchain.packages;
  const engines = [packages["axe-core"] ? `axe-core ${packages["axe-core"]}` : null, packages["@siteimprove/alfa-rules"] ? `Alfa ${packages["@siteimprove/alfa-rules"]}` : null].filter(Boolean);
  // Engines that only ran in the sessions of the agents: named apart from the two that ran on every page.
  const ON_EVERY_PAGE = ["axe-core", "alfa"];
  const sessionEngines = (evaluation.instruments ?? []).filter((tool) => tool.usedForNl.includes("toetsregels") && !ON_EVERY_PAGE.includes(tool.implementation)).map((tool) => `${tool.implementation}${tool.version ? ` ${tool.version}` : ""}`);
  return {
    honestNl:
      "Dit is een automatisch onderzoek. Scripts hebben de site gemeten. Een taalmodel heeft daarna elk paginatype bekeken, per criterium geoordeeld met meetinstrumenten, en in een tweede ronde elk oordeel gecontroleerd. \"Voldoet\" betekent dat in het onderzochte bewijs geen afwijking is gevonden, ook niet toen de controle ernaar zocht. Het is geen garantie dat er geen probleem bestaat. \"Kan niet bepalen\" betekent dat de vraag nog open is.",
    agreementNl:
      (finishedCount > 0 ? `Bij ${criteriaCount(finishedCount)} bleef het oordeel na de controle open door een beperking van het onderzoek; daar heeft een aanvullende meting het eindoordeel vastgesteld. Die wordt niet nog eens gecontroleerd: ${repeated === 0 ? "ze leverde geen bevinding op" : `de ${findingsCount(repeated)} uit die meting ${repeated === 1 ? "is" : "zijn"} twee keer door dezelfde beoordelaar vastgelegd, de tweede keer vanaf een verse pagina`}, en een goedkeuring uit die meting is niet door een tweede beoordelaar aangevallen. ` : "") +
      (personCount > 0 ? `Bij ${criteriaCount(personCount)} is de uitkomst vastgesteld door een persoon, niet door een instrument; dat staat bij het criterium, met de functie van die persoon. ` : "") +
      `Elk oordeel is in een tweede ronde gecontroleerd: de controle. Die ronde begint met een schone context en kent de eerste beoordeling: ze is een controle, geen tweede blinde beoordeling. Bij ${criteriaCount(changed)} kwam de controle op een andere uitkomst dan de eerste beoordeling; de uitkomst van de controle telt. ` +
      `Van de ${findingsCount(findings.length)} in dit rapport ${reproduced === 1 ? "is" : "zijn"} er ${reproduced} bij de controle bevestigd (een tweede beoordelaar zag het gebrek zelf opnieuw, vanaf een verse pagina) en ${added} bij de controle toegevoegd; die laatste zijn dus één keer gezien. ` +
      `${dropped === 0 ? "Geen bevinding uit de eerste beoordeling is vervallen." : `${findingsCount(dropped).replace(/^./, (letter) => letter.toUpperCase())} uit de eerste beoordeling ${dropped === 1 ? "is" : "zijn"} vervallen; de reden staat per criterium in bijlage A.`}`,
    enginesNl:
      `Hulpmiddelen in de zin van de methode zijn de regel-engines ${engines.join(" en ") || "axe-core en Alfa"}: zij draaien op elke pagina van de steekproef. ${sessionEngines.length > 0 ? `In de metingen van de agents draaiden daarnaast ${sessionEngines.join(" en ")} mee, als extra mening. ` : ""}Regel-engines voeren toetsregels voor WCAG uit; een deel daarvan zijn ACT-regels, de gepubliceerde toetsregels. ` +
      "De andere instrumenten van de toolbox verzamelen bewijs en zijn zelf geen toetsregel: de Tab-proef, de metingen van contrast, vergroten, tekstafstand en smal scherm, het openen van menu's, vensters en formulieren, tekstherkenning in afbeeldingen, en het beluisteren en bekijken van video en geluid. Het model handelt en meet alleen via die instrumenten; elke aanroep is vastgelegd als waarneming en kan worden nagespeeld.",
    stepsNl: [
      { nameNl: "Verkennen", textNl: "Een verkenner legt vast welke paginatypen de site heeft, welke meldingen een pagina bedekken, welke onderdelen open kunnen en welke processen er zijn, en hoe elk daarvan te bereiken is." },
      { nameNl: "Meten", textNl: `Scripts meten elke pagina van de steekproef, zoals ze laadt, ook op 320 pixels breed en in het donkere kleurenschema, en in de toestanden die de verkenner heeft vastgelegd${states > 0 ? ` (${states} toestanden; bij de steekproef staat per pagina welke)` : ""}.` },
      ...(gate
        ? [
            {
              nameNl: "Bewijspoort",
              textNl:
                `Voordat er wordt geoordeeld, toetsen vaste controles of het bewijs bruikbaar is. ${gate.review ? `Daarna heeft het model ${gate.review.sheets} ${gate.review.sheets === 1 ? "overzichtsblad" : "overzichtsbladen"} met beelden van de paginatypen bekeken${gate.review.pageTypesWithoutSheet > 0 ? `; van ${gate.review.pageTypesWithoutSheet} ${gate.review.pageTypesWithoutSheet === 1 ? "paginatype zijn" : "paginatypen zijn"} de beelden niet bekeken` : ""}. ` : ""}${gate.checksPassed} van de ${gate.checks} controles waren in orde en het bewijs is ${gate.sufficient ? "voldoende" : "onvoldoende"} bevonden` +
                `${gate.acceptedNl.length > 0 ? `; ${gate.acceptedNl.length} ${gate.acceptedNl.length === 1 ? "gat is" : "gaten zijn"} aanvaard als eigenschap van de site` : ""}` +
                `${gate.limitationsNl.length > 0 ? `; ${gate.limitationsNl.length} ${gate.limitationsNl.length === 1 ? "beperking staat" : "beperkingen staan"} hieronder` : ""}.`,
            },
          ]
        : []),
      { nameNl: "Rondgang", textNl: "Het model bekijkt elk paginatype en noteert wat nader onderzoek vraagt. Dat zijn aanwijzingen voor de beoordelaar, nog geen oordeel." },
      { nameNl: "Beoordelen", textNl: "Per criterium oordeelt een beoordelaar volgens een vaste procedure, met het verzamelde bewijs en met eigen metingen. In het rapport heet dit de eerste beoordeling." },
      { nameNl: "Verifiëren", textNl: "Een tweede ronde controleert elke bevinding vanaf een verse pagina en probeert elke goedkeuring onderuit te halen. Een bevinding is bevestigd als de tweede beoordelaar het gebrek zelf opnieuw zag. Wat niet is bevestigd, vervalt. Het oordeel van deze ronde is het eindoordeel. In het rapport heet dit de controle." },
      ...(finishedCount > 0 ? [{ nameNl: "Afmaken", textNl: "Bleef een criterium na de controle open door een beperking van het onderzoek (iets was niet gemeten, een proef stopte bij een grens, de tijd was op), dan meet een aparte beoordelaar met meer tijd wat ontbrak en komt tot een oordeel. Dat oordeel is dan het eindoordeel; het eerdere blijft bewaard. In het rapport heet dit de aanvullende meting." }] : []),
      ...(answeredCount > 0 ? [{ nameNl: "Antwoord van een persoon", textNl: "Wat geen instrument kan vaststellen, of wat een keuze van de eigenaar vraagt, heeft een persoon vastgelegd: wat is gedaan of besloten, en wat dat betekent voor het criterium. Zo'n uitkomst is vastgesteld door een persoon, niet door een instrument." }] : []),
      ...(evaluation.defects ? [{ nameNl: "Samenvoegen", textNl: "Bevindingen over dezelfde plek worden één gebrek. De bevindingen en de uitkomst per criterium blijven zoals ze zijn." }] : []),
    ],
    writesNl: evaluation.chain ? (evaluation.chain.writes.allowed ? `Toegestaan: ${evaluation.chain.writes.noteNl}.` : `Niet toegestaan: ${evaluation.chain.writes.noteNl}.`) : null,
    readsNl: evaluation.chain?.reads && evaluation.chain.reads.length > 0 ? `${readsAllowedNl(evaluation.chain.reads)}.` : null,
    challengeLabel: "Poging om het oordeel onderuit te halen",
    droppedLabel: "Vervallen bij de controle",
    verification: { reproduced: "Bij de controle bevestigd", unverified: "Toegevoegd bij de controle, één keer gezien", repeated: "Uit de aanvullende meting, twee keer gezien door één beoordelaar" },
  };
}

/**
 * A criterion with nothing to act on and nothing to look into. An outcome the two rounds
 * did not share, or a finding that was dropped, is something to read, so that one keeps its block.
 */
function isQuiet(criterion: CriterionResult): boolean {
  const { a, final } = criterion.rounds;
  // An outcome from the finishing round or from a person is something to read too.
  const settled = (a === null || a === final) && criterion.droppedNl.length === 0 && (criterion.established?.by ?? "verification") === "verification" && (criterion.answers ?? []).length === 0;
  return (criterion.outcome === "passed" || criterion.outcome === "inapplicable") && criterion.findings.length === 0 && criterion.missingNl.length === 0 && settled;
}

const upperFirst = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The open points of a criterion, each with its kind. A criterion that is open without saying why still gets one point. */
function openPoints(criterion: CriterionResult): ReturnType<typeof openPoint>[] {
  if (criterion.missingNl.length > 0) return criterion.missingNl.map(openPoint);
  if (criterion.outcome === "untested") return [{ kind: null, textNl: criterion.outage ? OUTAGE_NL : "Dit criterium is nog niet beoordeeld." }];
  return criterion.outcome === "cantTell" ? [{ kind: null, textNl: "Niet opgegeven." }] : [];
}

function brief(criterion: CriterionResult): CriterionBrief {
  const points = openPoints(criterion);
  const before = criterion.established?.before;
  return {
    establishedNl: establishedShort(criterion),
    answersNl: (criterion.answers ?? []).map(answerLine),
    beforeNl: before ? [`De ${before.roundNl} kwam op ${roundLabel(before.outcome)}: ${before.summaryNl}`, ...before.missingNl.map((point) => `Stond open: ${point.replace(/\s+/g, " ").trim()}`)] : [],
    observationsNl: criterion.observations.length > 0 ? plural(criterion.observations.length, "waarneming", "waarnemingen") : null,
    certaintyNl: certainty(criterion),
    roundsNl: roundsLine(criterion),
    // The open points themselves stand in the work list or in the appendix; here only how many there are.
    openNl: points.length > 0 ? plural(points.length, "punt", "punten") : null,
    coverageNl: shownOutcome(criterion) === "nothingFound" ? criterion.nothingFound!.coverageNl : criterion.established?.by === "finishing" ? (criterion.established.coverageNl ?? null) : null,
    toolboxPointsNl: points.filter((point) => point.kind?.reader === "toolbox").map((point) => `${upperFirst(point.kind!.labelNl)}: ${point.textNl}`),
  };
}

/** The work that follows from the evaluation: what to fix, by owner, and what to find out. */
function todo(evaluation: Evaluation): ReportDerived["todo"] {
  const pageCount = evaluation.sample.items.length;
  const findings = allFindings(evaluation).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || pagesTouched(b, pageCount) - pagesTouched(a, pageCount) || compareCriterionIds(a.criterion, b.criterion) || a.id.localeCompare(b.id),
  );
  return {
    person: evaluation.criteria.filter((criterion) => criterion.established?.by === "person" && criterion.outcome === "failed").map((criterion) => ({ criterion: criterion.id, textNl: (criterion.answers ?? []).filter((answer) => answer.outcome === "failed").map((answer) => `${answer.didNl.replace(/\.$/, "")} (functie: ${answer.role})`).join("; ") })),
    fix: ownersOf(findings).map((owner) => ({ owner, findingIds: findings.filter((finding) => finding.owner === owner).map((finding) => finding.id) })).filter((group) => group.findingIds.length > 0),
    vendor: evaluation.vendor
      ? {
          nameNl: evaluation.vendor.nameNl,
          elements: [...new Set(findings.flatMap((finding) => finding.vendorTags ?? []))].sort().map((tag) => ({ tag, findingIds: findings.filter((finding) => finding.vendorTags?.includes(tag)).map((finding) => finding.id) })),
        }
      : null,
    investigate: investigate(evaluation),
  };
}

/**
 * The declaration that would have closed the points "versturen niet toegestaan": a test
 * environment at inventory. `--test-environment` takes one origin, and that may be the origin of
 * an embedded frame alone, so nothing is sent to the rest of the site. When the points name
 * exactly one origin, the flags carry it.
 */
function notSentDeclaration(evaluation: Evaluation, items: OpenGroup[]): NotSent {
  const origins = notSentOrigins(evaluation.criteria.flatMap((criterion) => criterion.missingNl));
  const named =
    origins.length === 1
      ? `In de open punten staat als adres ${origins[0]}. `
      : origins.length > 1
        ? `In de open punten staan ${origins.length} adressen: ${origins.join(", ")}. Per onderzoek kan er één worden verklaard. `
        : "";
  const already = evaluation.chain?.writes.allowed ? "Dit onderzoek mocht alleen versturen naar de testomgeving die bij de onderzoeksgegevens staat; deze punten gaan over een ander adres. " : "";
  return {
    items,
    onlyCriteria: items.map((item) => item.criterion).filter((id) => waitsOnlyOnSending(evaluation.criteria.find((criterion) => criterion.id === id)?.missingNl ?? [])),
    declarationNl: "Een nieuw onderzoek meet deze punten als bij inventory een testomgeving wordt verklaard, door iemand met naam en functie:",
    flags: `--test-environment ${origins.length === 1 ? origins[0] : "<origin>"} --declared-by "<naam>, <functie>"`,
    originNl:
      `${already}${named}Er kan één origin worden verklaard, en dat mag de origin van alleen een ingesloten venster zijn, zoals een chat of een formulier van een andere partij: dan gaat alleen daarheen iets weg en wordt naar de rest van de site niets verstuurd. ` +
      "Neem de origin waar het bericht naartoe gaat; meestal is dat die van het venster zelf. Verklaar het alleen als versturen daar geen gevolgen heeft. Het rapport noemt dan de functie van wie het verklaarde; de naam staat in het dossier van het onderzoek.",
  };
}

/** Every open point of the evaluation, also the ones next to a verdict that did come: by whose work it is. */
function investigate(evaluation: Evaluation): ReportDerived["todo"]["investigate"] {
  const isOpen = (criterion: CriterionResult): boolean => criterion.outcome === "cantTell" || criterion.outcome === "untested";
  // The criteria without a verdict first: those are what the status waits for.
  const criteria = [...evaluation.criteria.filter(isOpen), ...evaluation.criteria.filter((criterion) => !isOpen(criterion))];
  const result: ReportDerived["todo"]["investigate"] = { owner: [], notSent: null, unreachable: [], unsorted: [], toolbox: [] };
  const placed = new Set<string>();
  const anchor = (id: string): boolean => !placed.has(id) && placed.add(id).has(id);
  const full = (wanted: (point: ReturnType<typeof openPoint>) => boolean): OpenGroup[] =>
    criteria.flatMap((criterion) => {
      const points = openPoints(criterion).filter(wanted);
      if (points.length === 0) return [];
      return [{ criterion: criterion.id, outcomeNl: SHOWN_LABEL[shownOutcome(criterion)].toLowerCase(), pointsNl: points.map((point) => (point.kind?.prefix === "keuze nodig" ? `Keuze: ${point.textNl}` : point.textNl)), anchor: anchor(criterion.id) }];
    });
  // What waits only for permission to send stands apart: no person is needed for it, one declaration is.
  result.owner = full((point) => point.kind?.reader === "owner" && point.kind.prefix !== NOT_SENT);
  const notSent = full((point) => point.kind?.prefix === NOT_SENT);
  result.notSent = notSent.length > 0 ? notSentDeclaration(evaluation, notSent) : null;
  result.unreachable = full((point) => point.kind?.prefix === UNREACHABLE);
  result.unsorted = full((point) => point.kind === null);
  result.toolbox = criteria.flatMap((criterion) => {
    const points = openPoints(criterion).filter((point) => point.kind?.reader === "toolbox");
    if (points.length === 0) return [];
    const kinds = OPEN_POINT_KINDS.map((kind) => [kind, points.filter((point) => point.kind === kind).length] as const).filter(([, count]) => count > 0);
    return [{ criterion: criterion.id, outcomeNl: SHOWN_LABEL[shownOutcome(criterion)].toLowerCase(), countNl: plural(points.length, "punt", "punten"), kindsNl: kinds.map(([kind, count]) => `${count} keer ${kind.labelNl}`).join(", "), coverageNl: shownOutcome(criterion) === "nothingFound" ? criterion.nothingFound!.coverageNl : null, anchor: anchor(criterion.id) }];
  });
  return result;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Page labels in a short form: three or more in a row become "P01 t/m P14". */
function pagesShort(pages: string[], labels: string[]): string {
  const parts: string[] = [];
  for (let index = 0; index < pages.length; ) {
    let end = index;
    while (end + 1 < pages.length && labels.indexOf(pages[end + 1]!) === labels.indexOf(pages[end]!) + 1 && labels.includes(pages[end]!)) end++;
    if (end - index >= 2) parts.push(`${pages[index]} t/m ${pages[end]}`);
    else parts.push(...pages.slice(index, end + 1));
    index = end + 1;
  }
  return parts.join(", ");
}

const sortDefects = (defects: Defect[]): Defect[] =>
  [...defects].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.pages.length - a.pages.length || compareCriterionIds(a.mainCriterion, b.mainCriterion) || a.id.localeCompare(b.id));

function deriveDefects(evaluation: Evaluation, labels: string[]): DefectsDerived | null {
  const defects = evaluation.defects;
  if (!defects) return null;
  const findings = allFindings(evaluation);
  const sorted = sortDefects(defects);
  const proposal = evaluation.merge?.proposal;
  const top = heaviest(sorted, "gebrek", "gebreken", "in de werklijst hierna");
  return {
    countsNl: `${plural(defects.length, "gebrek", "gebreken")}, ${plural(findings.length, "bevinding", "bevindingen")} onder ${criteriaCount(new Set(findings.map((finding) => finding.criterion)).size)}`,
    topIds: top.top.map((defect) => defect.id),
    topNoteNl: `${top.noteNl} De bevindingen staan bij de resultaten per criterium.`,
    fix: ownersOf(sorted).map((owner) => ({ owner, defectIds: sorted.filter((defect) => defect.owner === owner).map((defect) => defect.id) })).filter((group) => group.defectIds.length > 0),
    pagesNl: Object.fromEntries(defects.map((defect) => [defect.id, `${pagesShort(defect.pages, labels)}${defect.morePages ? " e.a." : ""}`])),
    byPage: Object.fromEntries(labels.map((label) => [label, sorted.filter((defect) => findings.some((finding) => defect.findingIds.includes(finding.id) && finding.locations.some((location) => location.page === label))).map((defect) => defect.id)])),
    ofFinding: Object.fromEntries(
      defects.flatMap((defect) =>
        defect.findingIds.map((id) => {
          const finding = findings.find((entry) => entry.id === id)!;
          const role = defect.findingIds.length === 1 ? ("only" as const) : id === defect.mainFindingId ? ("main" as const) : ("other" as const);
          // The defect is described under its main criterion; a finding under another criterion gets a card that is set closer.
          return [id, { defectId: defect.id, role, compact: role === "other" && finding.criterion !== defect.mainCriterion }];
        }),
      ),
    ),
    mergeNl:
      "Bevindingen over dezelfde plek zijn met vaste regels samengevoegd tot gebreken. De regels voegen alleen samen wat zeker is: er kunnen dus nog bevindingen over hetzelfde gebrek los van elkaar staan. " +
      (proposal?.status === "applied"
        ? `Daarna heeft een taalmodel voorgesteld wat verder bij elkaar hoort. Die stap geeft niet elke keer dezelfde uitkomst. Dat is aanvaardbaar omdat ze alleen kan samenvoegen: ze kan geen bevinding schrappen of wijzigen en geen oordeel over een criterium veranderen, en een vaste controle weigert elk voorstel waarin de bevindingen niet op dezelfde plek staan. Het aantal gebreken kan daardoor per keer iets verschillen, het aantal bevindingen en de uitkomst per criterium niet. In dit onderzoek voegde de stap ${proposal.joined} keer gebreken samen en koos ze ${proposal.mainOverridden} keer een ander hoofdcriterium.`
        : "De tweede stap, waarin een taalmodel voorstelt wat verder bij elkaar hoort, is niet uitgevoerd."),
  };
}

/**
 * What the outcome means for the accessibility statement. An unsigned report has no
 * status, so it also says which status would follow once somebody signs.
 */
function meaning(evaluation: Evaluation, stale: boolean): string[] {
  const paragraphs: string[] = [];
  const signed: Evaluation = evaluation.signature
    ? evaluation
    : { ...evaluation, signature: { name: "", role: "", organisation: "", signedAt: evaluation.evaluatedAt, statementNl: "", evaluationSha256: "", sealSha256: "" } };
  if (!evaluation.signature) {
    paragraphs.push(
      `Dit rapport is een concept: ${stale ? "de handtekening hoort bij een eerdere versie van dit onderzoek" : "niemand heeft ervoor getekend"}. Het kan daarom nog geen toegankelijkheidsverklaring onderbouwen. De bevindingen zijn wel bruikbaar om de site te verbeteren. Hieronder staat welke status past als het rapport wordt afgetekend.`,
    );
  }
  const legal = complianceStatus(signed, "2.1");
  const latest = complianceStatus(signed, "2.2");
  const sentence = (label: string, result: typeof legal): string => `${label}: ${STATUS_LABEL[result.status]}. ${result.reasonNl}`;
  const shared = legal.status === latest.status ? mergeCounts(legal.reasonNl, latest.reasonNl) : null;
  if (shared !== null) {
    paragraphs.push(`Voor WCAG 2.1, de versie waar EN 301 549 naar verwijst, en voor WCAG 2.2: ${STATUS_LABEL[legal.status]}. ${shared}`);
  } else {
    paragraphs.push(sentence("Voor WCAG 2.1, de versie waar EN 301 549 naar verwijst", legal), sentence("Voor WCAG 2.2", latest));
  }
  return paragraphs;
}

/** The evaluation as the report treats it: a signature for another version is set aside. */
function withCurrentSignature(evaluation: Evaluation): { evaluation: Evaluation; stale: boolean } {
  const stale = evaluation.signature !== null && !signatureIsCurrent(evaluation);
  return { evaluation: stale ? { ...evaluation, signature: null } : evaluation, stale };
}

/** The models that recognised speech in this evaluation: read from the version of the measurements that listened. */
function speechModelsOf(evaluation: Evaluation): { name: string; sha256: string }[] {
  const models = new Map<string, { name: string; sha256: string }>();
  for (const tool of evaluation.instruments ?? []) {
    const model = modelOf(tool.version);
    if (model) models.set(`${model.name} ${model.sha256}`, model);
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name) || a.sha256.localeCompare(b.sha256));
}

/** The browsers of the run for the list of tools: which version, which engine, used for what. No version is shown for a browser that did not run. */
export function browserLinesNl(evaluation: Evaluation): string[] {
  const version = (found: string | null): string => found ?? "(versie onbekend)";
  // An older evaluation names only the browser, by the id Playwright gives it ("chromium"): a name in the report starts with a capital.
  if (!evaluation.browsers) return [`${evaluation.toolchain.browser.name.replace(/^./, (letter) => letter.toUpperCase())} ${version(evaluation.toolchain.browser.version)}`];
  return evaluation.browsers.map((browser) => (browser.used ? `${browser.name} ${version(browser.version)} (motor ${browser.engine}): ${browser.usedForNl}` : `${browser.name} (motor ${browser.engine}): ${REPORT_TEXT.browserNotUsed}`));
}

export function deriveReport(input: Evaluation): ReportDerived {
  const { evaluation, stale } = withCurrentSignature(input);
  const hash = evaluationHash(evaluation);
  // The evaluation repeats each procedure's own limitation in its list; those belong with the criterion.
  const chain = chainText(evaluation);
  const work = todo(evaluation);
  const procedureLimits = new Set(evaluation.criteria.filter((criterion) => criterion.procedure?.limitsNl).map((criterion) => `${criterion.id} ${criterion.titleNl}: ${criterion.procedure!.limitsNl}`));
  return {
    hash,
    hashShort: hash.slice(0, 12),
    dateNl: dateNl(evaluation.evaluatedAt),
    madeWithNl: `${REPORT_TEXT.madeWith} ${madeWith(evaluation, true)}`,
    madeWithShortNl: `${REPORT_TEXT.madeWith} ${madeWith(evaluation)}`,
    instrumentNl: `${madeWith(evaluation)}, ${REPORT_TEXT.instrument}.`,
    toolboxCommit: knownCommit(evaluation.toolchain.toolbox),
    toolboxChanged: changedSinceCommit(evaluation.toolchain.toolbox),
    signedDateNl: evaluation.signature ? dateNl(evaluation.signature.signedAt) : null,
    signed: evaluation.signature !== null,
    signature: evaluation.signature,
    signatureStale: stale,
    status: { "2.1": complianceStatus(evaluation, "2.1"), "2.2": complianceStatus(evaluation, "2.2") },
    statusSentenceNl: statusSentence(evaluation),
    statusLine: statusLine(evaluation, stale),
    followsUpNl: evaluation.followsUp ? `Dit is een heronderzoek. Het vorige onderzoek is van ${dateNl(evaluation.followsUp.evaluatedAt)}, afgetekend op ${dateNl(evaluation.followsUp.signedAt)}, met kenmerk ${evaluation.followsUp.sha256.slice(0, 12)}.` : null,
    chain,
    agentModels: modelsNl(evaluation.judgment.model, evaluation.judgment.models),
    extensionsNl: extensionsNl(evaluation.judgment.extensions),
    scopeFramesNl: (evaluation.scope.frames ?? []).map(scopeFrameNl),
    browsersNl: browserLinesNl(evaluation),
    instrumentVersions: (evaluation.instruments ?? []).map((tool) => (tool.version ? tool.version.replace(/sha256:([0-9a-f]{8})[0-9a-f]{56}/g, "sha256 $1") : "onbekend")),
    speechModels: speechModelsOf(evaluation),
    meaningNl: meaning(evaluation, stale),
    pageLabels: pageLabels(evaluation),
    documents: deriveDocuments(evaluation),
    topFindingIds: topFindings(evaluation).map((finding) => finding.id),
    topFindingsNoteNl: heaviestFindings(evaluation).noteNl,
    disagreementNl: chain.agreementNl,
    briefs: Object.fromEntries(evaluation.criteria.map((criterion) => [criterion.id, brief(criterion)])),
    quiet: evaluation.criteria.filter(isQuiet).map((criterion) => criterion.id),
    recommendations: recommendationItems(evaluation),
    todo: work,
    defects: deriveDefects(evaluation, pageLabels(evaluation)),
    generalLimitationsNl: evaluation.limitationsNl.filter((limitation) => !procedureLimits.has(limitation)).map(closeCutQuote),
    procedureLimitations: evaluation.limitationsNl.filter((limitation) => procedureLimits.has(limitation)).length,
    outcomeOrder: shownOrder(evaluation),
    outcomeLabel: SHOWN_LABEL,
    shown: Object.fromEntries(evaluation.criteria.map((criterion) => [criterion.id, shownOutcome(criterion)])),
    tally: { "2.1": shownTally(evaluation, "2.1"), "2.2": shownTally(evaluation, "2.2") },
    scoreNoteNl: shownOrder(evaluation).includes("nothingFound") ? `${REPORT_TEXT.scoreNote} ${REPORT_TEXT.scoreNoteNothingFound}` : REPORT_TEXT.scoreNote,
    text: REPORT_TEXT,
  };
}

/**
 * Escape text that comes from data, so it cannot turn into Markdown structure. Code between
 * backticks stays code, as the PDF shows it; with an odd number of backticks every backtick is escaped.
 */
export function esc(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const escape = (part: string): string => part.replace(/[\\`*_[\]<>|#]/g, (character) => `\\${character}`);
  const parts = clean.split("`");
  if (parts.length < 3 || parts.length % 2 === 0) return escape(clean);
  return parts.map((part, index) => (index % 2 === 0 ? escape(part) : part === "" ? "" : code(part))).join("");
}

/** Inline code that survives backticks in the content and pipes inside a table. */
function code(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${clean} ${fence}` : `${fence}${clean}${fence}`;
}

const outcomeText = (outcome: ShownOutcome): string => `${OUTCOME_SYMBOL[outcome]} ${SHOWN_LABEL[outcome]}`;
const shortHash = (hash: string | null | undefined): string => (hash ? code(hash.slice(0, 8)) : "geen");
const criterionAnchor = (id: string): string => `sc-${id}`;
const appendixAnchor = (id: string): string => `bijlage-${id}`;
const openAnchor = (id: string): string => `open-${id}`;
const findingLink = (finding: ReportFinding): string => `[${finding.id}](#${finding.id})`;
const bullets = (items: string[]): string[] => items.map((item) => `- ${item}`);

/** The line under the address for a site on more than one origin: the further origins it covers. Nothing for a site on one. */
const alsoOnNl = (evaluation: Evaluation): string[] => {
  const further = siteOrigins(evaluation.site).slice(1);
  return further.length > 0 ? [`Ook onderdeel van de site: ${further.map((origin) => `<${origin}>`).join(", ")}`] : [];
};

function table(header: string[], rows: string[][], numeric: number[] = []): string[] {
  const align = header.map((_cell, index) => (numeric.includes(index) ? "---:" : "---"));
  return [header, align, ...rows].map((row) => `| ${row.join(" | ")} |`);
}

function versionNote(criterion: CriterionResult): string | null {
  if (!criterion.versions.includes("2.2")) return "Alleen in WCAG 2.1";
  if (!criterion.versions.includes("2.1")) return "Nieuw in WCAG 2.2";
  return null;
}

interface Grouping {
  key: string;
  name: string;
  criteria: CriterionResult[];
}

/** Criteria grouped by the leading parts of their number, in WCAG order. */
function groupCriteria(criteria: CriterionResult[], depth: 1 | 2): Grouping[] {
  const groups = new Map<string, Grouping>();
  for (const criterion of criteria) {
    const key = criterion.id.split(".").slice(0, depth).join(".");
    const group = groups.get(key) ?? { key, name: depth === 1 ? criterion.principle : criterion.guideline, criteria: [] };
    group.criteria.push(criterion);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function scoreTable(evaluation: Evaluation, version: WcagVersion): string[] {
  const relevant = evaluation.criteria.filter((criterion) => criterion.versions.includes(version));
  const order = shownOrder(evaluation);
  const rows = groupCriteria(relevant, 1).map((group) => [
    `${group.key} ${esc(group.name)}`,
    ...order.map((outcome) => String(group.criteria.filter((criterion) => shownOutcome(criterion) === outcome).length)),
    String(group.criteria.length),
  ]);
  const tally = shownTally(evaluation, version);
  rows.push(["**Totaal**", ...order.map((outcome) => `**${tally[outcome]}**`), `**${tally.total}**`]);
  return table(["Principe", ...order.map(outcomeText), "Totaal"], rows, order.map((_outcome, index) => index + 1).concat(order.length + 1));
}

/** Where a finding stands in its defect, with links: the defect, and the main finding when it is another one. */
function defectLine(finding: ReportFinding, defects: Map<string, Defect>, derived: DefectsDerived): string | null {
  const place = derived.ofFinding[finding.id];
  const defect = place ? defects.get(place.defectId) : undefined;
  if (!place || !defect) return null;
  const link = `[${defect.id}](#${defect.id})`;
  if (place.role === "only") return `${REPORT_TEXT.defect.label}: ${link}`;
  if (place.role === "main") return `${REPORT_TEXT.defect.label}: ${link}. ${REPORT_TEXT.defect.main}: dit criterium. ${REPORT_TEXT.defect.also}: ${defect.alsoCriteria.join(", ") || "geen ander criterium"}`;
  return `${REPORT_TEXT.defect.label}: ${link}. ${REPORT_TEXT.defect.main}: ${defect.mainCriterion}, zie [${defect.mainFindingId}](#${defect.mainFindingId})`;
}

/** The place in words of the page first: a heading and a text can be searched for in any source, a selector only in the HTML. */
const placeNl = (location: { heading?: string; text?: string; where: string }): string =>
  [location.heading ? `onder de kop \u201c${esc(location.heading)}\u201d` : "", location.text ? `bij \u201c${esc(location.text)}\u201d` : "", code(location.where)].filter((part) => part !== "").join(", ");
const whereLines = (finding: ReportFinding, titles: Map<string, string>): string[] => finding.locations.map((location) => `${esc(location.page)}${titles.has(location.page) ? ` ${esc(titles.get(location.page)!)}` : ""}: ${placeNl(location)}`);

/** A finding whose defect is filed under another criterion: the same facts as a full card, set closer together. */
function compactCard(finding: ReportFinding, defectText: string, titles: Map<string, string>, checkLabels: ChainText["verification"]): string[] {
  const vendor = finding.vendorTags?.length ? ` Raakt een element van de leverancier: ${finding.vendorTags.map(code).join(", ")}.` : "";
  return [
    `<a id="${finding.id}"></a>`,
    "",
    `###### ${finding.id} ${esc(finding.titleNl)}`,
    "",
    ...bullets([
      `Ernst: ${finding.severity}. Eigenaar: ${finding.owner}. Onderdeel: ${finding.component ? esc(finding.component) : "geen"}.${vendor} Pagina's: ${esc(finding.pagesAffected)}`,
      defectText,
      ...(finding.verification ? [`${REPORT_TEXT.defect.check}: ${checkLabels[finding.verification.status]}`] : []),
      `Wat is er mis: ${esc(finding.observedNl)}`,
      `Wie heeft er last van: ${esc(finding.impactNl)}`,
      `Oplossing: ${esc(finding.fixNl)}`,
      ...whereLines(finding, titles).map((line) => `Waar: ${line}`),
    ]),
    "",
  ];
}

function findingCard(finding: ReportFinding, titles: Map<string, string>, grouping: { defects: Map<string, Defect>; derived: DefectsDerived } | null, checkLabels: ChainText["verification"]): string[] {
  const defect = grouping ? defectLine(finding, grouping.defects, grouping.derived) : null;
  const place = grouping?.derived.ofFinding[finding.id];
  if (defect && place?.compact) return compactCard(finding, defect, titles, checkLabels);
  return [
    `<a id="${finding.id}"></a>`,
    "",
    `###### ${finding.id} ${esc(finding.titleNl)}`,
    "",
    ...bullets([
      `Ernst: ${finding.severity}`,
      `Eigenaar: ${finding.owner}`,
      `Onderdeel: ${finding.component ? esc(finding.component) : "geen"}`,
      ...(finding.vendorTags?.length ? [`Raakt een element van de leverancier: ${finding.vendorTags.map(code).join(", ")}`] : []),
      `Pagina's: ${esc(finding.pagesAffected)}`,
      ...(defect ? [defect] : []),
      ...(finding.verification ? [`${REPORT_TEXT.defect.check}: ${checkLabels[finding.verification.status]}`] : []),
    ]),
    "",
    "**Wat is er mis**",
    "",
    esc(finding.observedNl),
    "",
    "**Wie heeft er last van**",
    "",
    esc(finding.impactNl),
    "",
    "**Oplossing**",
    "",
    esc(finding.fixNl),
    "",
    "**Waar**",
    "",
    ...bullets(whereLines(finding, titles)),
    "",
  ];
}

/** Level, clause, version and the explanation of W3C: what is fixed about a criterion. */
const criterionFacts = (criterion: CriterionResult): string[] =>
  [`Niveau ${criterion.level}`, `EN 301 549: ${criterion.en301549}`, versionNote(criterion), `[Uitleg van dit criterium bij W3C](${criterion.understandingUrl})`].filter((fact): fact is string => fact !== null);

/** The open points of a criterion stand once: in the work list, or in the appendix when they are about the evaluation itself. Everywhere else a line points to the work list. */
const openLine = (criterion: CriterionResult, short: CriterionBrief): string[] => (short.openNl ? [`Open: ${short.openNl}, zie [${REPORT_TEXT.openLink}](#${openAnchor(criterion.id)}).`, ""] : []);

/** The criterion in the main part: outcome, summary, how firm the verdict is, where its open points are, and the findings. */
function criterionSection(criterion: CriterionResult, short: CriterionBrief, titles: Map<string, string>, grouping: Parameters<typeof findingCard>[2], checkLabels: ChainText["verification"]): string[] {
  const appendix = `[Onderbouwing in bijlage A](#${appendixAnchor(criterion.id)})${short.observationsNl ? ` (${short.observationsNl})` : ""}`;
  const lines = [
    `<a id="${criterionAnchor(criterion.id)}"></a>`,
    "",
    `##### ${criterion.id} ${esc(criterion.titleNl)}`,
    "",
    [`**Uitkomst:** ${outcomeText(shownOutcome(criterion))}`, ...criterionFacts(criterion), appendix].join(" · "),
    "",
    esc(criterion.summaryNl),
    "",
    `Zekerheid: ${esc(short.certaintyNl)}`,
    "",
    ...(short.coverageNl ? [`${REPORT_TEXT.measured}: ${esc(short.coverageNl)}`, ""] : []),
    ...openLine(criterion, short),
  ];
  if (criterion.findings.length > 0) {
    lines.push(`**Bevindingen (${criterion.findings.length})**`, "");
    for (const finding of criterion.findings) lines.push(...findingCard(finding, titles, grouping, checkLabels));
  }
  return lines;
}

/**
 * The criterion in the appendix: every observation and the full review of the verdict. A
 * criterion without a block in the main part has its fixed facts here.
 */
function appendixEntry(criterion: CriterionResult, short: CriterionBrief, chain: ChainText, quiet: boolean): string[] {
  const lines = [
    `<a id="${appendixAnchor(criterion.id)}"></a>`,
    "",
    `### ${criterion.id} ${esc(criterion.titleNl)}`,
    "",
    [`**Uitkomst:** ${outcomeText(shownOutcome(criterion))}`, ...(quiet ? criterionFacts(criterion) : []), `[Terug naar het resultaat](#${criterionAnchor(criterion.id)})`].join(" · "),
    "",
  ];
  if (criterion.observations.length > 0) {
    lines.push("**Hoe is dit vastgesteld**", "");
    criterion.observations.forEach((observation, index) => {
      lines.push(
        `${index + 1}. Onderzocht: ${esc(observation.checkedNl)}`,
        `   - Hoe: ${esc(observation.howNl)}`,
        `   - Waargenomen: ${esc(observation.observedNl)}`,
        `   - Bewijs: ${observation.evidence.map(code).join(", ")}`,
      );
    });
    lines.push("");
  }
  lines.push("**Hoe zeker is dit oordeel**", "");
  lines.push(short.roundsNl, "");
  if (short.answersNl.length > 0) lines.push(`${REPORT_TEXT.answers}:`, "", ...bullets(short.answersNl.map(esc)), "");
  if (short.beforeNl.length > 0) lines.push(`${REPORT_TEXT.before}:`, "", ...bullets(short.beforeNl.map(esc)), "");
  if (criterion.challengeNl) lines.push(`${chain.challengeLabel}: ${esc(criterion.challengeNl)}`, "");
  if (criterion.droppedNl.length > 0) lines.push(`${chain.droppedLabel}:`, "", ...bullets(criterion.droppedNl.map(esc)), "");
  const basis = [criterion.rule ? `Beslisregel ${criterion.rule}` : null, criterion.procedure ? `procedure versie ${criterion.procedure.version} (${esc(criterion.procedure.class)})` : "geen procedure vastgelegd"];
  lines.push(`Grondslag: ${basis.filter(Boolean).join(", ")}.`, "");
  if (criterion.procedure?.limitsNl) lines.push(`Beperking van de procedure: ${esc(criterion.procedure.limitsNl)}`, "");
  if (short.toolboxPointsNl.length > 0) lines.push(`${REPORT_TEXT.investigate.appendix}:`, "", ...bullets(short.toolboxPointsNl.map(esc)), "");
  lines.push(...openLine(criterion, short));
  return lines;
}

/** Findings that share a component, so one fix can be planned for all of them. */
export function findingsByComponent(evaluation: Evaluation): { component: string | null; findings: ReportFinding[] }[] {
  const groups = new Map<string, { component: string; findings: ReportFinding[] }>();
  const loose: ReportFinding[] = [];
  for (const finding of allFindings(evaluation)) {
    if (!finding.component) {
      loose.push(finding);
      continue;
    }
    const key = finding.component.toLowerCase().replace(/\s+/g, " ").trim();
    const group = groups.get(key) ?? { component: finding.component.trim(), findings: [] };
    group.findings.push(finding);
    groups.set(key, group);
  }
  const named = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, group]) => group);
  return [...named, ...(loose.length > 0 ? [{ component: null, findings: loose }] : [])];
}

export function renderMarkdown(input: Evaluation): string {
  const derived = deriveReport(input);
  const { evaluation } = withCurrentSignature(input);
  const staleNote = derived.signatureStale ? ` ${REPORT_TEXT.staleSignature}` : "";
  const labels = derived.pageLabels;
  const titles = new Map([...evaluation.sample.items.map((item, index): [string, string] => [labels[index]!, item.title]), ...(derived.documents?.rows ?? []).map((row): [string, string] => [row.label, row.title])]);
  const findings = allFindings(evaluation);
  const signature = evaluation.signature;
  const { toolchain } = evaluation;
  const agentModels = derived.agentModels;
  const defects = new Map((evaluation.defects ?? []).map((defect) => [defect.id, defect]));
  const grouping = derived.defects ? { defects, derived: derived.defects } : null;
  const alsoText = (defect: Defect): string => (defect.alsoCriteria.length > 0 ? `, ${REPORT_TEXT.defect.also.toLowerCase()} ${defect.alsoCriteria.join(", ")}` : "");
  const lines: string[] = [];
  const section = (title: string): void => void lines.push(`## ${title}`, "");

  // Title block
  lines.push(`# ${REPORT_TEXT.title} ${esc(evaluation.site.name)}`, "");
  lines.push(
    signature
      ? `> **Afgetekend** door ${esc(signature.name)} (${esc(signature.role)}, ${esc(signature.organisation)}) op ${derived.signedDateNl}.`
      : `> **${REPORT_TEXT.concept}**${staleNote}`,
    "",
    `> **${derived.statusLine.headingNl}**${derived.statusLine.noteNl ? `. ${derived.statusLine.noteNl}` : ""}`,
    "",
    `> ${derived.statusLine.unfinished ? "**Het onderzoek is onvolledig.** " : ""}${derived.statusLine.openNl}`,
    "",
  );
  lines.push(
    ...bullets([
      `Website: ${esc(evaluation.site.name)}`,
      `URL: <${evaluation.site.baseUrl}>`,
      ...alsoOnNl(evaluation),
      `Organisatie: ${evaluation.site.organisation ? esc(evaluation.site.organisation) : "niet opgegeven"}`,
      `Datum van het onderzoek: ${derived.dateNl}`,
      `Versie van de evaluatie: ${code(derived.hashShort)}`,
      esc(derived.madeWithNl),
    ]),
    "",
  );

  section("Samenvatting");
  lines.push(derived.statusSentenceNl, "");
  lines.push(`**${derived.statusLine.headingNl}**`, "");
  if (derived.statusLine.noteNl) lines.push(derived.statusLine.noteNl, "");
  lines.push(derived.statusLine.openNl, "");
  if (grouping) lines.push(`Het onderzoek vond ${grouping.derived.countsNl}.`, "");
  for (const version of VERSIONS) lines.push(`**WCAG ${version} niveau A en AA (${evaluation.summary[version].total} criteria)**`, "", ...scoreTable(evaluation, version), "");
  lines.push(derived.scoreNoteNl, "");
  if (grouping) {
    lines.push("### Zwaarste gebreken", "");
    const top = grouping.derived.topIds.map((id) => defects.get(id)!);
    if (top.length === 0) lines.push("Er zijn geen gebreken.", "");
    else lines.push(...table(["Gebrek", "Criterium", "Ernst", "Pagina's"], top.map((defect) => [`[${esc(defect.titleNl)}](#${defect.id})`, `${defect.mainCriterion}${alsoText(defect)}`, defect.severity, grouping.derived.pagesNl[defect.id]!])), "", grouping.derived.topNoteNl, "");
  } else {
    lines.push("### Zwaarste bevindingen", "");
    const top = topFindings(evaluation);
    if (top.length === 0) lines.push("Er zijn geen bevindingen.", "");
    else lines.push(...table(["Bevinding", "Criterium", "Ernst", "Pagina's"], top.map((finding) => [`${findingLink(finding)} ${esc(finding.titleNl)}`, finding.criterion, finding.severity, esc(finding.pagesAffected)])), "", derived.topFindingsNoteNl, "");
  }
  lines.push("### Wat betekent dit", "", derived.meaningNl.join("\n\n"), "");

  if (evaluation.site.descriptionNl) {
    section("Over deze website");
    lines.push(...evaluation.site.descriptionNl.split(/\n\s*\n/).flatMap((paragraph) => [esc(paragraph), ""]));
  }

  section("Wat nu");
  lines.push(REPORT_TEXT.todoIntro, "");
  lines.push("### Oplossen", "");
  if (derived.todo.person.length > 0) {
    lines.push(`**${REPORT_TEXT.personFailed}**`, "", REPORT_TEXT.personFailedIntro, "");
    lines.push(...bullets(derived.todo.person.map((item) => `[${item.criterion} ${esc(evaluation.criteria.find((entry) => entry.id === item.criterion)!.titleNl)}](#${criterionAnchor(item.criterion)}): ${esc(item.textNl)}`)), "");
  }
  if (derived.todo.fix.length === 0) lines.push("Er zijn geen bevindingen om op te lossen.", "");
  else if (grouping) {
    lines.push(REPORT_TEXT.defectIntro, "", REPORT_TEXT.adviceNote, "");
    for (const group of grouping.derived.fix) {
      lines.push(`**${group.owner.charAt(0).toUpperCase()}${group.owner.slice(1)}**`, "");
      for (const defect of group.defectIds.map((id) => defects.get(id)!)) {
        lines.push(`- <a id="${defect.id}"></a>${defect.severity}: **${esc(defect.titleNl)}** (${defect.id})`);
        lines.push(`  - ${REPORT_TEXT.defect.main} ${defect.mainCriterion}${alsoText(defect)}. Pagina's: ${grouping.derived.pagesNl[defect.id]!.replace(/\.$/, "")}.`);
        lines.push(`  - ${defect.findingIds.length === 1 ? "Bevinding" : "Bevindingen"}: ${defect.findingIds.map((id) => `[${id}](#${id})`).join(", ")}`);
      }
      lines.push("");
    }
  } else {
    lines.push(REPORT_TEXT.fixIntro, "", REPORT_TEXT.adviceNote, "");
    for (const group of derived.todo.fix) {
      lines.push(`**${group.owner.charAt(0).toUpperCase()}${group.owner.slice(1)}**`, "");
      lines.push(...bullets(group.findingIds.map((id) => findings.find((finding) => finding.id === id)!).map((finding) => `${finding.severity}: ${findingLink(finding)} ${esc(finding.titleNl)} (${finding.criterion})`)), "");
    }
  }
  if (derived.todo.vendor && derived.todo.vendor.elements.length > 0) {
    lines.push(`### Raakt een component van ${esc(derived.todo.vendor.nameNl)}`, "", REPORT_TEXT.vendorIntro, "");
    lines.push(...bullets(derived.todo.vendor.elements.map((element) => `${code(element.tag)}: ${element.findingIds.map((id) => `[${id}](#${id})`).join(", ")}`)), "");
  }
  lines.push("### Nog uitzoeken", "");
  const open = derived.todo.investigate;
  if (open.owner.length + (open.notSent?.items.length ?? 0) + open.unreachable.length + open.unsorted.length + open.toolbox.length === 0) lines.push("Er zijn geen open punten.", "");
  else {
    lines.push(REPORT_TEXT.investigateIntro, "");
    const head = (item: { criterion: string; outcomeNl: string; anchor: boolean }): string => {
      const criterion = evaluation.criteria.find((entry) => entry.id === item.criterion)!;
      return `- ${item.anchor ? `<a id="${openAnchor(criterion.id)}"></a>` : ""}[${criterion.id} ${esc(criterion.titleNl)}](#${criterionAnchor(criterion.id)}) (${item.outcomeNl})`;
    };
    const groups: [string, string[], OpenGroup[]][] = [
      [REPORT_TEXT.investigate.owner, [REPORT_TEXT.investigate.ownerIntro], open.owner],
      ...(open.notSent ? [[REPORT_TEXT.investigate.notSent, [REPORT_TEXT.investigate.notSentIntro, `${open.notSent.declarationNl} ${code(open.notSent.flags)}`, esc(open.notSent.originNl)], open.notSent.items] as [string, string[], OpenGroup[]]] : []),
      [REPORT_TEXT.investigate.unreachable, [REPORT_TEXT.investigate.unreachableIntro], open.unreachable],
      [REPORT_TEXT.investigate.unsorted, [REPORT_TEXT.investigate.unsortedIntro], open.unsorted],
    ];
    for (const [title, intro, items] of groups) {
      if (items.length === 0) continue;
      lines.push(`**${title}**`, "", ...intro.flatMap((paragraph) => [paragraph, ""]));
      for (const item of items) lines.push(head(item), ...item.pointsNl.map((text) => `  - ${esc(text)}`));
      lines.push("");
    }
    if (open.toolbox.length > 0) {
      lines.push(`**${REPORT_TEXT.investigate.toolbox}**`, "", REPORT_TEXT.investigate.toolboxIntro, "");
      for (const item of open.toolbox) lines.push(`${head(item)}: ${item.countNl} (${item.kindsNl}), zie [bijlage A](#${appendixAnchor(item.criterion)})${item.coverageNl ? `. ${REPORT_TEXT.measured}: ${esc(item.coverageNl)}` : ""}`);
      lines.push("");
    }
  }

  if (derived.recommendations.length > 0) {
    lines.push(`### ${REPORT_TEXT.recommendations}`, "", REPORT_TEXT.recommendationsIntro, "");
    for (const item of derived.recommendations) {
      const criterion = evaluation.criteria.find((entry) => entry.id === item.criterion)!;
      lines.push(`- <a id="${item.id}"></a>**${esc(item.titleNl)}** (${item.id})`);
      lines.push(`  - Bij [${criterion.id} ${esc(criterion.titleNl)}](#${criterionAnchor(criterion.id)}), aanbeveling ${item.rule} van de procedure.`);
      lines.push(`  - Gezien: ${esc(item.observedNl)}`);
      lines.push(`  - Aanbeveling: ${esc(item.recommendationNl)}`);
      lines.push(`  - Waar: ${item.placesNl.map(esc).join("; ")}`);
    }
    lines.push("");
  }

  section("Onderzoeksgegevens");
  lines.push(
    ...bullets([
      `Site: ${esc(evaluation.site.name)}`,
      `URL: <${evaluation.site.baseUrl}>`,
      ...alsoOnNl(evaluation),
      `Organisatie: ${evaluation.site.organisation ? esc(evaluation.site.organisation) : "niet opgegeven"}`,
      `Datum: ${derived.dateNl}`,
      `Norm: ${[...evaluation.standards.wcag, evaluation.standards.en301549].map(esc).join("; ")}`,
      `Methode: [${esc(evaluation.method.name)} ${esc(evaluation.method.version)}](${evaluation.method.url})`,
      `Type onderzoek: ${esc(evaluation.method.typeNl)}`,
      `${REPORT_TEXT.madeWith}: ${esc(derived.instrumentNl)}`,
      `Uitgevoerd door: ${REPORT_TEXT.performedBy.toLowerCase()}`,
      ...(derived.followsUpNl ? [`${REPORT_TEXT.followsUp}: ${derived.followsUpNl}`] : []),
      ...(derived.chain.writesNl ? [`Versturen van formulieren: ${esc(derived.chain.writesNl)}`] : []),
      ...(derived.chain.readsNl ? [`Leesverzoeken: ${esc(derived.chain.readsNl)}`] : []),
      signature ? `Afgetekend door: ${esc(signature.name)}, ${esc(signature.role)}, ${esc(signature.organisation)}, op ${derived.signedDateNl}` : `Afgetekend door: ${REPORT_TEXT.notSigned.toLowerCase()}${staleNote ? `.${staleNote}` : ""}`,
    ]),
    "",
  );
  if (signature) lines.push(`Verklaring bij de ondertekening: ${esc(signature.statementNl)}`, "", `Getekend voor evaluatie ${code(signature.evaluationSha256.slice(0, 12))}, verzegeld als ${code(signature.sealSha256.slice(0, 12))}.`, "");
  if (evaluation.method.deviationsNl.length > 0) lines.push("Afwijkingen van de methode:", "", ...bullets(evaluation.method.deviationsNl.map(esc)), "");

  section("Scope");
  lines.push("Binnen de scope:", "", ...bullets(evaluation.scope.includedNl.map(esc)), "");
  lines.push("Buiten de scope:", "", ...(evaluation.scope.excludedNl.length > 0 ? bullets(evaluation.scope.excludedNl.map(esc)) : ["Niets uitgesloten."]), "");
  if (derived.scopeFramesNl.length > 0) lines.push(`${REPORT_TEXT.scopeFrames}:`, "", ...bullets(derived.scopeFramesNl.map(esc)), "");

  section("Basisniveau van ondersteuning");
  lines.push("Browsers:", "", ...bullets(evaluation.baseline.browsers.map((browser) => `${esc(browser.name)} ${browser.version ? esc(browser.version) : "(versie onbekend)"}, motor ${esc(browser.engine)}`)), "");
  if (evaluation.baseline.assistiveTechnology.length === 0) lines.push("Hulpsoftware: geen.", "");
  else lines.push("Hulpsoftware:", "", ...bullets(evaluation.baseline.assistiveTechnology.map((tool) => `${esc(tool.name)} ${esc(tool.version)}`)), "");
  const baselineNote = evaluation.baseline.noteNl || (evaluation.baseline.assistiveTechnology.length === 0 ? REPORT_TEXT.noAssistiveTechnology : "");
  if (baselineNote) lines.push(esc(baselineNote), "");
  lines.push(`Technologieën waarop de site steunt: ${evaluation.technologies.map(esc).join(", ")}.`, "");

  section("Steekproef");
  lines.push(esc(evaluation.sample.note), "");
  lines.push(
    ...bullets([
      `Werkwijze: ${REPORT_TEXT.sampleMethod[evaluation.sample.method].toLowerCase()}`,
      `Unieke pagina's in de inventaris: ${evaluation.sample.populationSize}`,
      `Onderzochte pagina's: ${evaluation.sample.items.length}`,
      `Seed voor de willekeurige keuze: ${code(evaluation.sample.seed)}`,
    ]),
    "",
  );
  evaluation.sample.items.forEach((item, index) => {
    lines.push(`- **${labels[index]}** ${esc(item.title || "(geen titel)")}, <${item.url}>. Soort: ${REPORT_TEXT.sampleKind[item.kind].toLowerCase()}. Reden: ${esc(item.reason)}.`);
    if (item.aliases.length > 0) lines.push(`  - Dezelfde inhoud staat ook op: ${item.aliases.map((alias) => `<${alias}>`).join(", ")}`);
    const states = evaluation.measuredStates?.[labels[index]!] ?? [];
    if (states.length > 0) lines.push(`  - ${REPORT_TEXT.measuredStates}: ${states.map(esc).join(", ")}`);
  });
  lines.push("");
  if (evaluation.sample.pageTypes) {
    lines.push("### Paginatypen", "", REPORT_TEXT.samplePageTypes, "");
    for (const type of evaluation.sample.pageTypes) lines.push(`- **${esc(type.id)}**${type.descriptionNl ? ` (${esc(type.descriptionNl)})` : ""}: ${type.pages} ${type.pages === 1 ? "pagina" : "pagina's"}, ${type.examined} bekeken: ${esc(type.reasonNl)}.`);
    lines.push("");
  }
  if (derived.documents) {
    lines.push("### Documenten", "", ...bullets(derived.documents.factsNl.map(([name, value]) => `${name}: ${value}`)), "");
    for (const row of derived.documents.rows) lines.push(`- **${row.label}** ${esc(row.title)}, <${row.url}>. Soort: ${row.kindNl}. ${esc(row.statusNl)}. Reden: ${esc(row.reasonNl)}.`);
    lines.push("");
  }

  section("Gereedschap");
  lines.push(
    ...bullets([
      `Toolbox: loep, versie ${esc(toolchain.toolbox.version)}, commit ${derived.toolboxCommit ? code(derived.toolboxCommit.slice(0, 12)) : REPORT_TEXT.commitUnknown}`,
      `Lockfile: ${shortHash(toolchain.toolbox.lockfileSha256)}`,
      `Runtime: Node ${esc(toolchain.runtime.node)} op ${esc(toolchain.runtime.platform)} ${esc(toolchain.runtime.osRelease)} (${esc(toolchain.runtime.arch)})`,
      `Pakketten: ${Object.keys(toolchain.packages).sort().map((name) => `${code(name)} ${esc(toolchain.packages[name]!)}`).join(", ")}`,
      `${derived.browsersNl.length > 1 ? "Browsers" : "Browser"}: ${derived.browsersNl.map(esc).join("; ")}`,
      `Weergave: venster ${toolchain.rendering.viewport.width} × ${toolchain.rendering.viewport.height}, schaalfactor ${toolchain.rendering.deviceScaleFactor}, taal ${toolchain.rendering.locale}, tijdzone ${toolchain.rendering.timezoneId}, voorkeur voor minder beweging: ${toolchain.rendering.reducedMotion === "reduce" ? "aan" : "uit"}`,
      `Wachttijden: ${toolchain.rendering.navigationTimeoutMs / 1000} seconden voor het laden van een pagina, ${toolchain.rendering.settleTimeoutMs / 1000} seconden voor het tot rust komen`,
      `${REPORT_TEXT.model}: ${esc(evaluation.judgment.model)} (${agentModels ? REPORT_TEXT.modelNoteOperator : REPORT_TEXT.modelNote})`,
      ...(agentModels ? [`${REPORT_TEXT.agentModels}: ${agentModels.perRoleNl.map(esc).join("; ")}. ${REPORT_TEXT.agentModelsNote}${agentModels.differsNl ? ` ${esc(agentModels.differsNl)}` : ""}`] : []),
      `Rondes: ${evaluation.judgment.rounds.map(esc).join(", ")}`,
      ...(derived.extensionsNl ? [`${REPORT_TEXT.extensions}: ${esc(derived.extensionsNl)}. ${REPORT_TEXT.extensionsNote}`] : []),
      `Opdrachtsjablonen: ${Object.keys(evaluation.judgment.promptTemplates).sort().map((name) => `${esc(name)} ${shortHash(evaluation.judgment.promptTemplates[name])}`).join(", ")}`,
    ]),
    "",
    ...(evaluation.instruments?.length
      ? [
          "**Meetmethoden van de agents**",
          "",
          REPORT_TEXT.instrumentsIntro,
          "",
          "| Hulpmiddel | Versie | Gebruikt voor | Metingen |",
          "|---|---|---|---|",
          ...evaluation.instruments.map((tool, index) => `| ${code(tool.implementation)} | ${esc(derived.instrumentVersions[index]!)} | ${esc(tool.usedForNl.join(", "))} | ${tool.measurements} |`),
          "",
        ]
      : []),
  );
  if (derived.toolboxChanged) lines.push(`> ${REPORT_TEXT.dirty}`, "");
  lines.push(derived.chain.enginesNl, "");

  section("Resultaten per criterium");
  lines.push(REPORT_TEXT.overviewIntro, "");
  lines.push(
    ...table(
      ["Criterium", "Niveau", "Uitkomst", REPORT_TEXT.establishedBy, "Bevindingen"],
      evaluation.criteria.map((criterion) => [`[${criterion.id} ${esc(criterion.titleNl)}](#${criterionAnchor(criterion.id)})`, criterion.level, outcomeText(shownOutcome(criterion)), derived.briefs[criterion.id]!.establishedNl, String(criterion.findings.length)]),
      [4],
    ),
    "",
  );
  const quiet = new Set(derived.quiet);
  const quietCriteria = evaluation.criteria.filter((criterion) => quiet.has(criterion.id));
  if (quietCriteria.length > 0) {
    lines.push(`### ${REPORT_TEXT.quietTitle}`, "", REPORT_TEXT.quietIntro, "");
    lines.push(
      ...table(
        ["Criterium", "Niveau", "Uitkomst", "Toelichting"],
        quietCriteria.map((criterion) => [`<a id="${criterionAnchor(criterion.id)}"></a>[${criterion.id} ${esc(criterion.titleNl)}](#${appendixAnchor(criterion.id)})`, criterion.level, outcomeText(criterion.outcome), esc(criterion.summaryNl)]),
      ),
      "",
    );
  }
  for (const principle of groupCriteria(evaluation.criteria.filter((criterion) => !quiet.has(criterion.id)), 1)) {
    lines.push(`### ${principle.key} ${esc(principle.name)}`, "");
    for (const guideline of groupCriteria(principle.criteria, 2)) {
      lines.push(`#### Richtlijn ${guideline.key} ${esc(guideline.name)}`, "");
      for (const criterion of guideline.criteria) lines.push(...criterionSection(criterion, derived.briefs[criterion.id]!, titles, grouping, derived.chain.verification));
    }
  }

  section("Bevindingen per onderdeel");
  if (findings.length === 0) lines.push("Er zijn geen bevindingen.", "");
  else {
    lines.push(REPORT_TEXT.componentIntro, "");
    lines.push(...table(["Onderdeel", "Bevindingen"], findingsByComponent(evaluation).map((group) => [group.component ? esc(group.component) : "Zonder onderdeel", group.findings.map(findingLink).join(", ")])), "");
  }

  section(grouping ? "Gebreken per pagina" : "Bevindingen per pagina");
  if (findings.length === 0) lines.push("Er zijn geen bevindingen.", "");
  else {
    lines.push(grouping ? REPORT_TEXT.defectPageIntro : REPORT_TEXT.pageIntro, "");
    const none = grouping ? "Geen gebrek met een plek op deze pagina." : "Geen bevinding met een plek op deze pagina.";
    const rows = evaluation.sample.items.map((item, index) => {
      const label = labels[index]!;
      const here = grouping
        ? grouping.derived.byPage[label]!.map((id) => defects.get(id)!).map((defect) => `[${esc(defect.titleNl)}](#${defect.id})`)
        : findings.filter((finding) => finding.locations.some((location) => location.page === label)).map((finding) => `[${esc(finding.titleNl)}](#${finding.id})`);
      return [`${label} ${esc(item.title || "(geen titel)")}`, here.length > 0 ? here.join("<br>") : none];
    });
    // A document of the sample is a place a finding can point at, like a page.
    for (const row of derived.documents?.rows ?? []) rows.push([`${row.label} ${esc(row.title)}`, row.here.length > 0 ? row.here.map((entry) => `[${esc(entry.titleNl)}](#${entry.id})`).join("<br>") : row.statusNl.startsWith("Ingelezen") ? (grouping ? "Geen gebrek met een plek in dit document." : "Geen bevinding met een plek in dit document.") : esc(row.statusNl)]);
    lines.push(...table(["Pagina", grouping ? "Gebreken" : "Bevindingen"], rows), "");
  }

  section("Betrouwbaarheid en beperkingen");
  lines.push(derived.chain.honestNl, "");
  if (derived.chain.stepsNl.length > 0) lines.push("### Werkwijze", "", ...derived.chain.stepsNl.map((step, index) => `${index + 1}. **${step.nameNl}.** ${esc(step.textNl)}`), "");
  lines.push(derived.disagreementNl, "");
  const gate = evaluation.chain?.gate;
  if (gate && gate.acceptedNl.length + gate.limitationsNl.length > 0) lines.push("Wat de bewijspoort heeft vastgesteld:", "", ...bullets([...gate.acceptedNl, ...gate.limitationsNl].map(esc)), "");
  if (grouping) lines.push(grouping.derived.mergeNl, "");
  if (derived.generalLimitationsNl.length > 0) lines.push("Beperkingen van dit onderzoek:", "", ...bullets(derived.generalLimitationsNl.map(esc)), "");
  if (derived.procedureLimitations > 0) lines.push(`Bij ${criteriaCount(derived.procedureLimitations)} heeft de procedure een eigen beperking. ${REPORT_TEXT.procedureLimits}`, "");

  section("Bijlage A: onderbouwing per criterium");
  lines.push(REPORT_TEXT.appendixIntro, "");
  for (const criterion of evaluation.criteria) lines.push(...appendixEntry(criterion, derived.briefs[criterion.id]!, derived.chain, quiet.has(criterion.id)));

  section("Bijlage B: herleidbaarheid");
  lines.push(REPORT_TEXT.traceIntro, "");
  // The verdict of a finishing round gets a column only in an evaluation that had such a round.
  const withFinish = evaluation.criteria.some((criterion) => criterion.rounds.finish !== undefined);
  lines.push(...bullets([`Hash van de evaluatie: ${code(derived.hash)}`, `Commit van de toolbox: ${derived.toolboxCommit ? `${code(derived.toolboxCommit)}${derived.toolboxChanged ? " (met niet vastgelegde wijzigingen)" : ""}` : REPORT_TEXT.commitUnknown}`, `Hash van de lockfile: ${code(toolchain.toolbox.lockfileSha256)}`, ...derived.speechModels.map((model) => `Hash van het spraakmodel ${esc(model.name)}: ${code(model.sha256)}`)]), "");
  lines.push(
    ...table(
      // One judge and a verifier: the two verdicts that exist.
      ["Criterium", "Procedure", "Dossier", REPORT_TEXT.trace.judge, REPORT_TEXT.trace.final, ...(withFinish ? [REPORT_TEXT.trace.finish] : [])],
      evaluation.criteria.map((criterion) => [
        criterion.id,
        criterion.procedure ? `v${criterion.procedure.version} ${shortHash(criterion.procedure.sha256)}` : "geen",
        shortHash(criterion.provenance.dossierSha256),
        shortHash(criterion.provenance.verdictSha256.a),
        shortHash(criterion.provenance.verdictSha256.final),
        ...(withFinish ? [criterion.rounds.finish !== undefined ? shortHash(criterion.provenance.verdictSha256.finish) : ""] : []),
      ]),
    ),
    "",
  );

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
