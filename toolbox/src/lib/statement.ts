import { complianceStatus, evaluationHash, madeWith, type ComplianceStatus, type Evaluation } from "./evaluation.ts";
import { siteOrigins } from "./origins.ts";
import type { WcagVersion } from "./wcag.ts";

/**
 * The accessibility statement follows the model that is legally binding since
 * 1 October 2026 (Besluit modeltoegankelijkheidsverklaring digitale toegankelijkheid
 * overheid, Stcrt. 2026, 515). Section headings and fixed sentences are taken from
 * that model; what only the organisation knows is asked for, never invented.
 */
export interface StatementInput {
  organisation: string;
  /** Number of the organisation on dashboard.digitoegankelijk.nl. */
  dashboardOrganisationNumber?: string;
  subdomains?: string[];
  reportUrl?: string;
  contactUrl?: string;
  complaintsUrl?: string;
  ombudsmanUrl?: string;
  additionalInformationNl?: string;
  /** ISO date by which the site will comply in full (status B and C). */
  targetDate?: string;
  /** ISO date of the planned further evaluation (status C). */
  plannedEvaluationDate?: string;
  alternativesNl?: string;
  /** Measure per failed criterion, keyed by criterion id; a general text under "*". */
  measuresNl?: Record<string, string>;
  approval?: { date: string; functionTitle: string; lastReviewed: string };
}

/** WCAG 2.1 is what EN 301 549 v3.2.1 requires today; 2.2 is reported next to it. */
export const LEGAL_VERSION: WcagVersion = "2.1";

/**
 * The status as the model statement names it; the label joins letter and name. "geen" is not
 * a status of the model: it is what the toolbox writes when the evaluation cannot carry one
 * (not signed, or a criterion not judged). Status D of the register ("voldoet niet") is never
 * computed here.
 */
const STATUS_NAME: Record<ComplianceStatus, string> = {
  A: "voldoet volledig",
  B: "voldoet gedeeltelijk",
  C: "eerste maatregelen genomen",
  geen: "nog niet vast te stellen",
};

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  A: `A – ${STATUS_NAME.A}`,
  B: `B – ${STATUS_NAME.B}`,
  C: `C – ${STATUS_NAME.C}`,
  geen: STATUS_NAME.geen,
};

const ask = (what: string): string => `[nog invullen: ${what}]`;

function nlDate(iso: string | undefined, what: string): string {
  if (!iso) return ask(what);
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

/**
 * The statement as a document: an ordered list of blocks. The Markdown and the PDF are
 * both rendered from this, so they always say the same thing.
 */
export type StatementSpan = { text: string } | { link: string } | { open: string };

export type StatementBlock =
  | { type: "heading"; level: 1 | 2 | 3; spans: StatementSpan[] }
  | { type: "paragraph"; spans: StatementSpan[] }
  | { type: "list"; items: { spans: StatementSpan[]; items: StatementSpan[][] }[] }
  /** A warning that stands apart from the statement itself, such as the concept notice. */
  | { type: "note"; title: string; spans: StatementSpan[] };

export interface StatementModel {
  status: ComplianceStatus;
  blocks: StatementBlock[];
}

const SPAN = /<([a-z][a-z0-9+.-]*:[^>\s]+)>|\[nog invullen: ([^\]]+)\]/g;

/** Split a sentence into plain text, links and the places the organisation still has to fill in. */
export function statementSpans(text: string): StatementSpan[] {
  const spans: StatementSpan[] = [];
  let position = 0;
  for (const match of text.matchAll(SPAN)) {
    if (match.index > position) spans.push({ text: text.slice(position, match.index) });
    spans.push(match[1] !== undefined ? { link: match[1] } : { open: match[2]! });
    position = match.index + match[0].length;
  }
  if (position < text.length) spans.push({ text: text.slice(position) });
  return spans;
}

const spanMarkdown = (span: StatementSpan): string => ("text" in span ? span.text : "link" in span ? `<${span.link}>` : ask(span.open));
const spansMarkdown = (spans: StatementSpan[]): string => spans.map(spanMarkdown).join("");

/** A list item is a sentence, or a sentence with a nested list under it. */
type ListItem = string | [string, string[]];

/** One sentence for the concept notice: the status the outcomes lead to once somebody signs. The statement itself carries no status until then. */
function provisionalStatusNl(evaluation: Evaluation): string {
  const { status } = complianceStatus({ ...evaluation, signature: { name: "", role: "", organisation: "", signedAt: evaluation.evaluatedAt, statementNl: "", evaluationSha256: "", sealSha256: "" } }, LEGAL_VERSION);
  return status === "geen" ? "Het onderzoek dekt nog niet alle eisen, dus er is ook geen voorlopige status." : `De voorlopige status volgens het onderzoek is ${status} (${STATUS_NAME[status]}); die telt pas na aftekening.`;
}

/**
 * The subdomains and other domains that belong to the website: the further origins the
 * evaluation covered (`inventory --also-origin`), then what the input names, each once.
 */
export function otherDomains(evaluation: Pick<Evaluation, "site">, input: Pick<StatementInput, "subdomains">): string[] {
  return [...new Set([...siteOrigins(evaluation.site).slice(1), ...(input.subdomains ?? [])])];
}

export function buildStatement(evaluation: Evaluation, input: StatementInput, options: { concept: boolean }): StatementModel {
  const { status, reasonNl } = complianceStatus(evaluation, LEGAL_VERSION);
  const site = evaluation.site.name;
  const organisation = input.organisation;
  const failed = evaluation.criteria.filter((criterion) => criterion.versions.includes(LEGAL_VERSION) && criterion.outcome === "failed");
  const open = evaluation.criteria.filter((criterion) => criterion.versions.includes(LEGAL_VERSION) && criterion.outcome === "cantTell");
  const failedOnly22 = evaluation.criteria.filter((criterion) => !criterion.versions.includes(LEGAL_VERSION) && criterion.outcome === "failed");
  const blocks: StatementBlock[] = [];
  const heading = (level: 1 | 2 | 3, text: string): void => void blocks.push({ type: "heading", level, spans: statementSpans(text) });
  const paragraph = (...texts: string[]): void => void blocks.push(...texts.map((text): StatementBlock => ({ type: "paragraph", spans: statementSpans(text) })));
  const list = (...items: ListItem[]): void =>
    void blocks.push({
      type: "list",
      items: items.map((item) => (typeof item === "string" ? { spans: statementSpans(item), items: [] } : { spans: statementSpans(item[0]), items: item[1].map(statementSpans) })),
    });

  heading(1, `Toegankelijkheidsverklaring ${site}`);
  if (options.concept) {
    blocks.push({
      type: "note",
      title: "Concept, niet publiceren.",
      spans: statementSpans(
        (evaluation.signature ? "" : `Het onderzoek waarop deze verklaring steunt is nog niet afgetekend. ${provisionalStatusNl(evaluation)} `) +
          "Controleer alle teksten tussen vierkante haken. De verklaring wordt pas geldig na ondertekening door een tekenbevoegd functionaris en publicatie via de invulassistent op toegankelijkheidsverklaring.nl.",
      ),
    });
  }
  paragraph(`${organisation} streeft ernaar om de eigen online informatie en dienstverlening toegankelijk te maken, overeenkomstig het Tijdelijk besluit digitale toegankelijkheid overheid.`);
  paragraph(`Deze toegankelijkheidsverklaring is van toepassing op de website ${site}:`);
  list(
    `hoofddomein: <${evaluation.site.baseUrl}>`,
    `subdomeinen en andere domeinen die behoren tot de website: ${otherDomains(evaluation, input).length ? otherDomains(evaluation, input).map((domain) => `<${domain}>`).join(", ") : "(niet van toepassing)"}`,
  );
  paragraph(
    `Een overzicht van alle websites, mobiele applicaties en bijbehorende verklaringen van ${organisation} is beschikbaar via ${
      input.dashboardOrganisationNumber ? `<https://dashboard.digitoegankelijk.nl/organisaties/${input.dashboardOrganisationNumber}>` : ask("link naar het overzicht van de organisatie op dashboard.digitoegankelijk.nl")
    }.`,
  );

  heading(2, `Nalevingsstatus: ${STATUS_LABEL[status]}`);
  if (status === "A") {
    paragraph(
      `Uit de door ${organisation} gepubliceerde informatie blijkt dat de website ${site} volledig voldoet aan het Tijdelijk besluit digitale toegankelijkheid overheid. Uit onderzoek is gebleken dat aan alle eisen is voldaan.`,
      "De informatie onder de kop Onderbouwing van de verklaring bevat (links naar) gedetailleerde informatie met onderbouwing van de toegankelijkheidsclaim.",
    );
  } else if (status === "B") {
    paragraph(
      `Uit de door ${organisation} gepubliceerde informatie blijkt dat de website ${site} gedeeltelijk voldoet aan het Tijdelijk besluit digitale toegankelijkheid overheid. Uit onderzoek is gebleken dat nog niet aan alle eisen wordt voldaan. Voor de afwijkingen van de eisen zijn maatregelen genomen om de afwijking te kunnen opheffen en wordt een concrete datum genoemd waarop de maatregelen zullen zijn uitgevoerd.`,
      `In de toelichting, onder de kop Onderbouwing van de verklaring, wordt aangegeven hoe ver ${organisation} is gevorderd met de toegankelijkheid van ${site} en welke noodzakelijke maatregelen worden genomen om de website toegankelijker te maken.`,
    );
  } else if (status === "C") {
    paragraph(
      `${organisation} verklaart dat de eerste maatregelen zijn genomen om de website ${site} te laten voldoen aan het Tijdelijk besluit digitale toegankelijkheid overheid.`,
      "Er is een onderzoek gepland, dat binnen zes maanden na de publicatie van deze verklaring zal worden uitgevoerd.",
      "In de toelichting, onder de kop Onderbouwing van de verklaring, wordt aangegeven welke noodzakelijke maatregelen zijn genomen.",
    );
  } else {
    paragraph(`De status is nog niet vast te stellen. ${reasonNl}`);
  }

  heading(2, "Akkoordverklaring");
  paragraph(
    `Deze verklaring is op ${nlDate(input.approval?.date, "datum gezien en akkoord")} getekend voor 'gezien en akkoord' door een tekenbevoegd functionaris van ${organisation}.`,
    `Functie: ${input.approval?.functionTitle ?? ask("onderscheidende functienaam")}.`,
    `De actualiteit, volledigheid en juistheid van deze verklaring zijn voor het laatst gecontroleerd op ${nlDate(input.approval?.lastReviewed, "datum laatste herziening van de verklaring")}.`,
  );

  heading(2, "Feedback en contactgegevens");
  paragraph("Loopt u tegen een toegankelijkheidsprobleem aan? Of heeft u een vraag of opmerking over toegankelijkheid?");
  list(`Neem dan contact op via ${input.contactUrl ? `<${input.contactUrl}>` : ask("link naar contactgegevens")}.`);

  heading(2, "Wat kunt u van ons verwachten?");
  list("Binnen vijf werkdagen krijgt u een ontvangstbevestiging.", "We informeren u over de voortgang en de uitkomst.", "Binnen drie weken is uw verzoek afgehandeld.");

  heading(2, "Handhavingsprocedure");
  paragraph(
    `Bent u niet tevreden met onze reactie? Dan kunt u daarover een klacht indienen via ${input.complaintsUrl ? `<${input.complaintsUrl}>` : ask("link naar de klachtenprocedure van de organisatie")}.`,
    `Bent u niet tevreden met de manier waarop uw klacht is behandeld? Of reageren wij niet op tijd? Dan kunt u contact opnemen met ${input.ombudsmanUrl ? `<${input.ombudsmanUrl}>` : ask("link naar de ombudsman of de instantie die klachten in tweede lijn behandelt")}.`,
  );

  heading(2, `Aanvullende informatie van ${organisation}`);
  if (input.additionalInformationNl) paragraph(input.additionalInformationNl);
  paragraph(
    `Het onderzoek is automatisch uitgevoerd met ${madeWith(evaluation)}, een open-source instrument dat meet en bewijs vastlegt: scripts hebben het bewijs verzameld en een taalmodel heeft elk criterium beoordeeld volgens een vaste procedure, met meetinstrumenten, waarna een tweede beoordeling elke bevinding opnieuw heeft gemaakt vanaf een verse pagina. ${
      evaluation.signature ? `${evaluation.signature.name} (${evaluation.signature.role}) heeft voor het onderzoek getekend.` : "Er heeft nog niemand voor het onderzoek getekend."
    } Het rapport beschrijft de werkwijze en de beperkingen.`,
  );
  if (open.length > 0) {
    paragraph(
      `Bij de volgende ${open.length} succescriteria kon met dit onderzoek niet worden vastgesteld of eraan is voldaan. Ze worden aanvullend onderzocht op ${nlDate(input.plannedEvaluationDate, "datum van het aanvullende onderzoek, binnen zes maanden")}:`,
    );
    list(...open.map((criterion) => `Succescriterium ${criterion.id} – ${criterion.titleNl}`));
  }
  if (failedOnly22.length > 0) {
    paragraph("Het onderzoek heeft ook getoetst op WCAG 2.2, de opvolger van de norm die nu wettelijk geldt. Aan deze nieuwe succescriteria wordt nog niet voldaan:");
    list(...failedOnly22.map((criterion) => `Succescriterium ${criterion.id} – ${criterion.titleNl}`));
  }
  if (status === "B" || status === "C") paragraph(`De streefdatum waarop de website ${site} volledig zal voldoen: ${nlDate(input.targetDate, "streefdatum voor volledig voldoen")}.`);

  heading(2, "Onderbouwing van de verklaring");
  if (status === "A" || status === "B") {
    heading(3, "Onderzoeksresultaten");
    paragraph(`De website ${site} is onderzocht op toegankelijkheid en uit de rapportage blijkt volgens ${organisation} dat de onderzoeksresultaten aan alle onderstaande kenmerken voldoen:`);
    list(
      `De onderzoeksresultaten waarop de claim is gebaseerd zijn beschikbaar via: ${input.reportUrl ? `<${input.reportUrl}>` : ask("rechtstreekse link naar het rapport op een openbare website")}`,
      [
        "Kenmerken die in de rapportage zijn vastgelegd:",
        [
          `Datum: ${nlDate(evaluation.evaluatedAt, "datum van het onderzoek")}`,
          "Type onderzoek: automatisch onderzoek",
          "Onderzoek uitgevoerd door: in eigen beheer",
          "Gebruikte standaard: EN 301 549",
          "Actualiteit: voldoet aan de voorwaarde. Uit de rapportage blijkt dat de meet- en onderzoeksgegevens waarop het onderzoek is gebaseerd jonger zijn dan 36 maanden.",
          `Onderzoeksmethode: ${evaluation.method.name} ${evaluation.method.version}, met de afwijkingen die het rapport noemt. Of een automatisch onderzoek als gelijkwaardige methode geldt, is niet door de toezichthouder bevestigd.`,
          "Vastlegging: voldoet aan de voorwaarde. Uit de rapportage blijkt dat de onderzoeksresultaten zijn vastgelegd in een voor mensen leesbaar formaat en in een machineleesbaar formaat.",
          `Scope van het onderzoek: ${evaluation.scope.includedNl.join("; ")}`,
        ],
      ],
      ["De onderzoeksresultaten:", [`Zijn representatief voor alle content op het hoofddomein. ${evaluation.sample.note}`, "Omvatten alle eisen uit hoofdstuk 9 van de standaard EN 301 549."]],
    );
    if (status === "A") {
      paragraph("Tijdens het onderzoek zijn geen afwijkingen gevonden op standaard EN 301 549.", `Op basis van de onderzoeksresultaten verklaart ${organisation} dat de website volledig voldoet aan standaard EN 301 549.`);
    } else {
      paragraph(
        "Tijdens het onderzoek zijn afwijkingen gevonden op standaard EN 301 549, die niet konden worden hersteld voordat het onderzoek werd afgerond.",
        `Op basis van de onderzoeksresultaten verklaart ${organisation} dat de website gedeeltelijk voldoet aan standaard EN 301 549.`,
      );
    }
  } else if (status === "C") {
    paragraph(
      `De website ${site} is automatisch onderzocht op ${nlDate(evaluation.evaluatedAt, "datum van het onderzoek")}. Dat onderzoek dekt nog niet alle eisen. Aanvullend onderzoek is binnen 6 maanden ingepland op ${nlDate(input.plannedEvaluationDate, "datum ingepland onderzoek")}.`,
      `De uitkomsten tot nu toe staan in het rapport: ${input.reportUrl ? `<${input.reportUrl}>` : ask("rechtstreekse link naar het rapport op een openbare website")}.`,
    );
  }

  if (failed.length > 0) {
    heading(3, "Afwijkingen van standaard EN 301 549");
    paragraph(`De website ${site} voldoet niet aan de volgende succescriteria:`);
    list(...failed.map((criterion) => `Succescriterium ${criterion.id} – ${criterion.titleNl}`));
    heading(3, "Alternatieven");
    paragraph(`In de tussentijd biedt ${organisation} de volgende alternatieven aan bezoekers die last hebben van de afwijkingen die nog niet zijn opgelost: ${input.alternativesNl ?? ask("alternatieven, bijvoorbeeld hulp via telefoon of e-mail")}`);
    heading(3, "Maatregelen");
    paragraph(`${organisation} neemt de volgende maatregelen om de afwijkingen op te lossen:`);
    list(
      ...failed.map((criterion) => {
        const measure = input.measuresNl?.[criterion.id] ?? input.measuresNl?.["*"];
        const proposals = [...new Set(criterion.findings.map((finding) => finding.fixNl))];
        return `Succescriterium ${criterion.id} – ${criterion.titleNl}: ${measure ?? `${ask("maatregel")} Voorstel uit het rapport: ${proposals.join(" ")}`}`;
      }),
    );
    paragraph(`Op ${nlDate(input.targetDate, "datum waarop de afwijkingen zijn opgelost")} zal de website ${site} volledig voldoen aan standaard EN 301 549.`);
  } else if (status === "C" || status === "geen") {
    paragraph("Het is onbekend of er afwijkingen zijn bij de criteria die nog niet zijn vastgesteld.");
  }

  return { status, blocks };
}

function blockMarkdown(block: StatementBlock): string {
  if (block.type === "heading") return `${"#".repeat(block.level)} ${spansMarkdown(block.spans)}`;
  if (block.type === "note") return `> **${block.title}** ${spansMarkdown(block.spans)}`;
  if (block.type === "paragraph") return spansMarkdown(block.spans);
  return block.items.flatMap((item) => [`- ${spansMarkdown(item.spans)}`, ...item.items.map((nested) => `  - ${spansMarkdown(nested)}`)]).join("\n");
}

export function statementMarkdown(blocks: StatementBlock[]): string {
  return `${blocks.map(blockMarkdown).join("\n\n").trimEnd()}\n`;
}

/** Every place in the statement that the organisation still has to fill in, each named once. */
export function statementOpenItems(blocks: StatementBlock[]): string[] {
  const all = (spans: StatementSpan[]): string[] => spans.flatMap((span) => ("open" in span ? [span.open] : []));
  return [...new Set(blocks.flatMap((block) => (block.type === "list" ? block.items.flatMap((item) => [...all(item.spans), ...item.items.flatMap(all)]) : all(block.spans))))];
}

export interface StatementResult {
  status: ComplianceStatus;
  markdown: string;
  /** What the organisation still has to supply before the statement can be published. */
  openItems: string[];
}

export function renderStatement(evaluation: Evaluation, input: StatementInput, options: { concept: boolean }): StatementResult {
  const { status, blocks } = buildStatement(evaluation, input, options);
  return { status, markdown: statementMarkdown(blocks), openItems: statementOpenItems(blocks) };
}

/** Everything the PDF template needs: the blocks, and what the title block shows. */
export interface StatementDocument {
  title: string;
  /** The kind of document, shown above the site name. */
  kindLabel: string;
  site: { name: string; baseUrl: string };
  organisation: StatementSpan[];
  concept: boolean;
  /** Absent on the answer sheet, which is a working document without a status of its own. */
  status: { code: ComplianceStatus; name: string } | null;
  standard: string;
  evaluatedNl: string;
  evaluationShort: string;
  /** Where the document came from, for the foot of every page: "Gemaakt met loep 0.0.1". */
  madeWithNl: string;
  openItems: string[];
  blocks: StatementBlock[];
}

function documentFor(evaluation: Evaluation, input: StatementInput, kindLabel: string, blocks: StatementBlock[]): Omit<StatementDocument, "concept" | "status"> {
  return {
    title: `${kindLabel} ${evaluation.site.name}`,
    kindLabel,
    site: { name: evaluation.site.name, baseUrl: evaluation.site.baseUrl },
    organisation: statementSpans(input.organisation),
    standard: `WCAG ${LEGAL_VERSION} niveau A en AA`,
    evaluatedNl: nlDate(evaluation.evaluatedAt, "datum van het onderzoek"),
    evaluationShort: evaluationHash(evaluation).slice(0, 12),
    madeWithNl: `Gemaakt met ${madeWith(evaluation)}`,
    openItems: statementOpenItems(blocks),
    blocks,
  };
}

export function statementDocument(evaluation: Evaluation, input: StatementInput, options: { concept: boolean }): StatementDocument {
  const { status, blocks } = buildStatement(evaluation, input, options);
  return { ...documentFor(evaluation, input, "Toegankelijkheidsverklaring", blocks), concept: options.concept, status: { code: status, name: STATUS_NAME[status] } };
}

/**
 * Blocks from the plain Markdown the answer sheet is written in: headings, paragraphs
 * and one-level lists. Not a Markdown parser; it reads back only what this module writes.
 */
export function blocksFromMarkdown(markdown: string): StatementBlock[] {
  const blocks: StatementBlock[] = [];
  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const last = blocks.at(-1);
    if (heading) blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, spans: statementSpans(heading[2]!) });
    else if (line.startsWith("- ") && last?.type === "list") last.items.push({ spans: statementSpans(line.slice(2)), items: [] });
    else if (line.startsWith("- ")) blocks.push({ type: "list", items: [{ spans: statementSpans(line.slice(2)), items: [] }] });
    else if (line.trim() !== "") blocks.push({ type: "paragraph", spans: statementSpans(line) });
  }
  return blocks;
}

export function answerSheetDocument(evaluation: Evaluation, input: StatementInput): StatementDocument {
  return { ...documentFor(evaluation, input, "Invulblad voor de invulassistent", blocksFromMarkdown(renderAnswerSheet(evaluation, input))), concept: false, status: null };
}

/** Copy-and-paste values for the nine steps of the invulassistent on toegankelijkheidsverklaring.nl. */
export function renderAnswerSheet(evaluation: Evaluation, input: StatementInput): string {
  const statement = renderStatement(evaluation, input, { concept: true });
  const failed = evaluation.criteria.filter((criterion) => criterion.versions.includes(LEGAL_VERSION) && criterion.outcome === "failed");
  const lines = [
    `# Invulblad voor de invulassistent: ${evaluation.site.name}`,
    "",
    "Het register van toegankelijkheidsverklaringen heeft geen koppeling. Neem de waarden hieronder over in de invulassistent op <https://www.toegankelijkheidsverklaring.nl>. De veldnamen van de invulassistent kunnen afwijken; de volgorde volgt de negen stappen.",
    "",
    "## 1. Kanaal",
    "",
    "- Soort: website",
    `- Naam: ${evaluation.site.name}`,
    "",
    "## 2. Locatie",
    "",
    `- Hoofddomein: ${evaluation.site.baseUrl}`,
    `- Subdomeinen en andere domeinen: ${otherDomains(evaluation, input).join(", ") || "geen"}`,
    "",
    "## 3. Status bepalen",
    "",
    `- Nalevingsstatus: ${STATUS_LABEL[statement.status]}`,
    `- Onderbouwing: ${complianceStatus(evaluation, LEGAL_VERSION).reasonNl}`,
    "",
    "## 4. Onderzoek",
    "",
    `- Link naar het rapport: ${input.reportUrl ?? ask("rechtstreekse openbare link")}`,
    `- Datum van het onderzoek: ${nlDate(evaluation.evaluatedAt, "datum")}`,
    "- Type onderzoek: automatisch onderzoek",
    "- Uitgevoerd door: in eigen beheer",
    `- Standaard: ${evaluation.standards.en301549}; getoetst op ${evaluation.standards.wcag.join(" en ")}`,
    `- Methode: ${evaluation.method.name} ${evaluation.method.version}`,
    `- Scope: ${evaluation.scope.includedNl.join("; ")}`,
    `- Steekproef: ${evaluation.sample.items.length} pagina's. ${evaluation.sample.note}`,
    "",
    "## 5. Gevonden problemen",
    "",
    ...(failed.length > 0 ? failed.map((criterion) => `- ${criterion.id} ${criterion.titleNl} (${criterion.findings.length} bevindingen)`) : ["- Geen afwijkingen vastgesteld."]),
    "",
    "## 6. Planning en voortgang",
    "",
    `- Streefdatum volledig voldoen: ${nlDate(input.targetDate, "streefdatum")}`,
    `- Aanvullend onderzoek gepland op: ${nlDate(input.plannedEvaluationDate, "datum, alleen bij status C")}`,
    ...failed.map((criterion) => `- Maatregel bij ${criterion.id}: ${input.measuresNl?.[criterion.id] ?? input.measuresNl?.["*"] ?? ask("maatregel")}`),
    "",
    "## 7. Extra teksten",
    "",
    `- Alternatieven: ${input.alternativesNl ?? ask("alternatieven voor bezoekers")}`,
    `- Contact: ${input.contactUrl ?? ask("link naar contactgegevens")}`,
    `- Klachten: ${input.complaintsUrl ?? ask("link naar de klachtenprocedure")}`,
    `- Tweede lijn: ${input.ombudsmanUrl ?? ask("link naar de ombudsman")}`,
    "",
    "## 8. Akkoordverklaring",
    "",
    `- Datum: ${nlDate(input.approval?.date, "datum gezien en akkoord")}`,
    `- Functie van de tekenbevoegde: ${input.approval?.functionTitle ?? ask("onderscheidende functienaam")}`,
    "",
    "## 9. Publiceren",
    "",
    "- Publiceer de verklaring in het register en zet de link naar de verklaring op elke pagina van de site, gebruikelijk in de voettekst.",
    "- Zet het rapport op het adres dat bij stap 4 is ingevuld. Het adres moet rechtstreeks en openbaar zijn.",
    "",
  ];
  return `${lines.join("\n")}`;
}
