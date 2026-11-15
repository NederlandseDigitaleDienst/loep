/**
 * The summary of a quick measurement: what the rule engines and two layout probes say about a
 * small sample, without a language model. It predicts a part of what a full evaluation fails;
 * it is not an evaluation. Pure functions: `commands/quick.ts` measures and calls these.
 */
import { compareCriterionIds, CRITERIA, criterionById } from "./wcag.ts";

/** Levels A and AA: what a Dutch government site is held to. An engine also reports on AAA. */
const EVALUATED = new Set(CRITERIA.map((criterion) => criterion.id));

export const QUICK_SCHEMA = 1;
/** The file in a run that says it is a quick measurement. `explore` refuses a run that has it. */
export const QUICK_MARK_FILE = "quick.json";
export const QUICK_DEFAULT_PAGES = 15;
export const QUICK_SCHEMES = ["light", "dark"] as const;
export type QuickScheme = (typeof QUICK_SCHEMES)[number];

export const QUICK_NOTICE_NL =
  "Dit is een snelle meting zonder taalmodel. Ze wijst criteria aan waar meetprogramma's een fout zien op een kleine steekproef. Dat is geen oordeel over toegankelijkheid en geen uitspraak over WCAG. Een criterium dat hier niet staat, is niet onderzocht.";

/**
 * How well these signals predicted the outcome of finished evaluations, measured once on runs of
 * real sites (validatie/snelle-meting/README.md). Shown with every summary, so a reader knows what
 * an empty list is worth.
 */
export const QUICK_BACKTEST = {
  measuredOn: "2026-11-15",
  sites: 12,
  precision: 0.83,
  recall: 0.24,
  textNl:
    "Op 12 sites met een volledig onderzoek wees deze soort meting een kwart van de afgekeurde criteria aan. Van wat ze aanwees, keurde het onderzoek ruim acht op de tien af. Driekwart van de afkeuringen vindt alleen een volledig onderzoek.",
} as const;

export const QUICK_EXPLORE_REFUSAL_NL =
  "deze run is een snelle meting (quick.json): de inventaris is klein gehouden en er is geen sitemodel. Begin een onderzoek in een nieuwe map met inventory.";

/** Why a full evaluation should not grow out of this run. */
export const QUICK_NOT_MEASURED_NL = [
  "Formulieren, documenten, beweging en wat pas na een handeling verschijnt, zoals een menu of een foutmelding, zijn niet gemeten.",
  "Van het toetsenbord is alleen gemeten wat Tab bereikt, tot 60 stops per pagina. Of een onderdeel daarna met het toetsenbord te bedienen is, is niet gemeten.",
  "Contrast komt uit de regels van de meetprogramma's, niet uit schermafbeeldingen.",
  "Een melding die over de pagina ligt, zoals een cookiemelding, is niet gesloten. De proeven zijn dan met die melding gemeten.",
  "Niemand heeft beoordeeld of een tekstalternatief, kop of linktekst klopt.",
];

export type Agreement = "agreed" | "alone" | "contradicted";
export const AGREEMENTS: readonly Agreement[] = ["agreed", "alone", "contradicted"];

/** One element under one criterion, as `session rules` groups the engines (`result.grouped.elements`). */
export interface GroupedElement {
  criterion: string;
  where?: string;
  message?: string;
  rules?: Record<string, string[]>;
  verdicts?: Record<string, string>;
}

export interface RulesResult {
  methods?: { implementation: string; version: string; result?: { findings?: { where?: string; html?: string }[] } }[];
  grouped?: { elements?: GroupedElement[] };
  failed?: unknown[];
  pending?: unknown[];
}

/** What `session reflow` and `session zoom` answer. */
export interface LayoutAnswer {
  horizontalScroll?: boolean;
  offenders?: number;
  first?: string[];
  image?: string;
}

/** The probes of loep itself next to the rule engines, each with the criterion it says something about. */
export const QUICK_PROBES = {
  order: { criterion: "1.3.2", nl: (places: number) => `De volgorde op het scherm wijkt op ${plural(places, "plek", "plekken")} af van de volgorde in de code.` },
  tabindex: { criterion: "2.4.3", nl: (places: number) => `${plural(places, "element heeft", "elementen hebben")} een eigen plek in de tabvolgorde gekregen, met een tabindex groter dan 0.` },
  spacing: { criterion: "1.4.12", nl: (places: number) => `Met ruimere tekstafstand verdwijnt tekst op ${plural(places, "plek", "plekken")}.` },
  autoplay: { criterion: "1.4.2", nl: () => "Geluid begint vanzelf en er is geen knop gevonden die het stopt." },
  "focus-invisible": { criterion: "2.4.7", nl: (places: number) => `Bij ${plural(places, "element", "elementen")} verandert er niets zichtbaars als het de focus krijgt.` },
  "focus-covered": { criterion: "2.4.11", nl: (places: number) => `${plural(places, "element", "elementen")} met de focus ${places === 1 ? "ligt" : "liggen"} onder iets anders.` },
  "focus-thrown": { criterion: "3.2.1", nl: (places: number) => `${plural(places, "element gooit", "elementen gooien")} de focus weg zodra ${places === 1 ? "het" : "ze"} die ${places === 1 ? "krijgt" : "krijgen"}.` },
  title: { criterion: "2.4.2", nl: (places: number) => `${plural(places, "pagina heeft", "pagina's hebben")} dezelfde titel als een andere pagina.` },
} as const;
export type QuickProbe = keyof typeof QUICK_PROBES;

/** One thing a probe saw on a page. */
export interface QuickProbeFinding {
  probe: QuickProbe;
  /** What it is about, in words that stay the same when it moves: the comparison counts per text. */
  element: string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
/** "a: Paspoort of rijbewijs (tekst verdwijnt: 1 regel(s) ...)" without the detail at its end, which holds measures that differ between two runs. */
function beforeDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith(")")) return trimmed;
  let depth = 0;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] === ")") depth += 1;
    if (trimmed[index] === "(" && --depth === 0) return trimmed.slice(0, index).trim();
  }
  return trimmed;
}

/** What `session order` says: content that CSS put somewhere else than the code has it, and a tabindex above zero. */
export function orderProbe(answer: Record<string, unknown>): QuickProbeFinding[] {
  return [
    ...[...strings(answer.reversed), ...strings(answer.cssOrder)].map((text) => ({ probe: "order" as const, element: beforeDetail(text) })),
    ...strings(answer.positiveTabindex).map((text) => ({ probe: "tabindex" as const, element: beforeDetail(text) })),
  ];
}

/** What `session spacing` says: text that is lost with the text spacing of 1.4.12. */
export function spacingProbe(answer: Record<string, unknown>): QuickProbeFinding[] {
  if (typeof answer.textLost !== "number" || answer.textLost === 0) return [];
  const named = strings(answer.first).map(beforeDetail);
  // `first` names the first few; the rest counts under one text.
  return Array.from({ length: answer.textLost }, (_, index) => ({ probe: "spacing" as const, element: named[index] ?? "meer tekst" }));
}

/** What `session media` says: sound that starts by itself with nothing found that stops it. */
export function mediaProbe(answer: Record<string, unknown>): QuickProbeFinding[] {
  return strings(answer.media)
    .filter((text) => /\bautoplay\b/.test(text) && /(?<!geen )geluidsspoor/.test(text) && /geen knop gevonden die het stopt/.test(text))
    .map((text) => ({ probe: "autoplay" as const, element: text.split(":")[0]!.replace(/:nth-(?:of-type|child)\(\d+\)/g, "") }));
}

/** A stop of the Tab walk, as the keyboard method records it. */
export interface TabStop {
  path?: string[];
  href?: string | null;
  /** The share of the pixels around the element that change when it gets the focus. */
  focusPixelShare?: number | null;
  coveredBy?: string | string[] | null;
  focusNotMeasured?: string | null;
}

/** What `session taborder` says: a stop without a visible focus, a stop under something else, an element that throws the focus away. */
export function tabProbe(answer: Record<string, unknown>, stops: readonly TabStop[]): QuickProbeFinding[] {
  const mark = (stop: TabStop): string => `${elementMark(stop.path?.at(-1) ?? null, null)}${stop.href ? ` naar ${stop.href}` : ""}`;
  const covered = (stop: TabStop): boolean => (Array.isArray(stop.coveredBy) ? stop.coveredBy.length > 0 : Boolean(stop.coveredBy));
  return [
    // Not a pixel changed with the focus, on an element that was in view and measured: nothing shows where the focus is.
    ...stops.filter((stop) => stop.focusPixelShare === 0 && !covered(stop) && !stop.focusNotMeasured).map((stop) => ({ probe: "focus-invisible" as const, element: mark(stop) })),
    ...stops.filter(covered).map((stop) => ({ probe: "focus-covered" as const, element: mark(stop) })),
    ...strings(answer.notReached)
      .filter((text) => text.startsWith("krijgt focus en gooit die meteen weg:"))
      .flatMap((text) => text.slice(text.indexOf(":") + 1).split(/,\s*(?=\w+ ")/))
      .map((text) => ({ probe: "focus-thrown" as const, element: text.trim() })),
  ];
}

export interface QuickMeasurement {
  scheme: QuickScheme;
  /** Null when the page could not be measured in this scheme. */
  observation: string | null;
  reasonNl: string | null;
  rules: RulesResult | null;
}

export interface QuickPage {
  url: string;
  title: string | null;
  httpStatus: number | null;
  screenshot: string | null;
  measurements: QuickMeasurement[];
  reflow: LayoutAnswer | null;
  zoom: LayoutAnswer | null;
  /** What the other probes saw. Absent in a summary from before they were there. */
  probes?: QuickProbeFinding[];
}

export interface QuickFinding {
  criterion: string;
  page: string;
  where: string | null;
  /** What the element is, apart from where it stands: see `elementMark`. */
  element: string;
  message: string | null;
  engines: string[];
  rules: string[];
  agreement: Agreement;
  schemes: QuickScheme[];
}

export interface QuickSignal {
  criterion: string;
  titleNl: string | null;
  level: string | null;
  /** The strongest ground: engines that agree, a layout probe, one engine alone, or engines that contradict each other. */
  ground: "engines-agree" | "layout-probe" | "engine-alone" | "engines-contradict";
  agreed: number;
  alone: number;
  contradicted: number;
  /** Pages on which a probe of loep saw something. */
  probePages: number;
  /** What the probes saw, in a sentence each. */
  probesNl: string[];
  pages: number;
  sentenceNl: string;
}

/** How many places one rule fails on one page under one criterion: what a later measurement is held against. */
export interface QuickCount {
  /** Path and query of the page, without the origin: a preview and the live site compare by it. */
  path: string;
  criterion: string;
  /** Engine and rule, as `axe-core:color-contrast`. */
  rule: string;
  /** What the element is (`elementMark`), so one defect gone and another new do not cancel out. */
  element: string;
  places: number;
}

export interface QuickSummary {
  schema: number;
  kind: "quick";
  site: string;
  startedAt: string;
  finishedAt: string;
  partial: boolean;
  noticeNl: string;
  backtest: typeof QUICK_BACKTEST;
  notMeasuredNl: string[];
  coverage: { maxPages: number; pagesFound: number | null; pageLimitReached: boolean; planned: number; measured: number; failed: number; schemes: readonly QuickScheme[] };
  engines: { id: string; version: string }[];
  signals: QuickSignal[];
  findings: QuickFinding[];
  findingsTotal: number;
  /** Every count, not cut off: the baseline of a comparison. */
  counts: QuickCount[];
  pages: { url: string; title: string | null; httpStatus: number | null; screenshot: string | null; measured: boolean; reasonsNl: string[]; reflow: LayoutAnswer | null; zoom: LayoutAnswer | null; probes: QuickProbeFinding[] }[];
}

const TOP_FINDINGS = 50;
const GROUND_ORDER: QuickSignal["ground"][] = ["engines-agree", "layout-probe", "engine-alone", "engines-contradict"];

const engineName = (implementation: string): string => (implementation === "accessibility-checker-engine" ? "ibm" : implementation);

const lossSeen = (answer: LayoutAnswer | null): boolean => Boolean(answer && (answer.horizontalScroll || (answer.offenders ?? 0) > 0));

const plural = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;

/** Attributes that say what an element is. A class or a style says how it looks, and changes with a redesign. */
const MARK_ATTRIBUTES = ["id", "href", "src", "name", "type", "role", "for", "alt", "aria-label", "title", "lang"];
const LANDMARK = /^(header|nav|main|footer|aside|form|dialog)\b/;

/**
 * A mark for an element that stays the same when the element moves and differs between two
 * elements that are not the same thing: its tag, the attributes that say what it is, and the part
 * of the page it is in. Built from the selector and, when an engine gave it, the opening tag. A
 * comparison counts places per mark: a paragraph among paragraphs has no mark of its own, a link
 * to another address does.
 */
export function elementMark(where: string | null, html: string | null): string {
  const bare = (segment: string): string => segment.replace(/:nth-(?:of-type|child)\(\d+\)/g, "");
  const path = (where ?? "").split(">").map((segment) => bare(segment.trim())).filter(Boolean);
  const region = path.slice(0, -1).reverse().find((segment) => segment.startsWith("#") || LANDMARK.test(segment)) ?? "";
  const opening = html ? /^<([a-z][\w-]*)([^>]*)>/i.exec(html.trim()) : null;
  const attributes: string[] = [];
  for (const [, name, value] of (opening?.[2] ?? "").matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    if (!MARK_ATTRIBUTES.includes(name!.toLowerCase())) continue;
    // An id a framework numbers anew on every load says nothing.
    if (name === "id" && /\d{3,}|^:/.test(value!)) continue;
    // Without the origin, so a preview and the live site give the same mark.
    const local = /^https?:\/\//.test(value!) && URL.canParse(value!) ? `${new URL(value!).pathname}${new URL(value!).search}${new URL(value!).hash}` : value!;
    attributes.push(`[${name!.toLowerCase()}="${local}"]`);
  }
  const tag = opening?.[1]?.toLowerCase() ?? path.at(-1) ?? "";
  return `${tag}${attributes.sort().join("")}${region ? ` in ${region}` : ""}`;
}

/**
 * The findings of a quick measurement: a place is an element of a page under one criterion, light
 * and dark together. Failing in one scheme is failing; a pass in the other does not undo it.
 */
export function quickFindings(pages: readonly QuickPage[]): QuickFinding[] {
  interface Place extends Omit<QuickFinding, "engines" | "rules" | "agreement" | "element"> {
    failed: Set<string>;
    passed: Set<string>;
    ruleIds: Set<string>;
  }
  const places = new Map<string, Place>();
  // The opening tag of an element, from whichever engine gave it: Alfa gives none, and the selectors are the same over the engines.
  const tags = new Map<string, string>();
  for (const page of pages) {
    for (const measurement of page.measurements) {
      for (const method of measurement.rules?.methods ?? []) for (const finding of method.result?.findings ?? []) if (finding.where && finding.html && !tags.has(`${page.url}\n${finding.where}`)) tags.set(`${page.url}\n${finding.where}`, finding.html);
    }
  }
  for (const page of pages) {
    for (const measurement of page.measurements) {
      for (const element of measurement.rules?.grouped?.elements ?? []) {
        const key = `${page.url}\n${element.criterion}\n${element.where ?? element.message ?? ""}`;
        const place = places.get(key) ?? { criterion: element.criterion, page: page.url, where: element.where ?? null, message: null, schemes: [], failed: new Set(), passed: new Set(), ruleIds: new Set() };
        let failedHere = false;
        for (const [engine, verdict] of Object.entries(element.verdicts ?? {})) {
          if (verdict === "failed") {
            place.failed.add(engine);
            failedHere = true;
            for (const rule of element.rules?.[engine] ?? []) place.ruleIds.add(`${engine}:${rule}`);
          }
          if (verdict === "passed") place.passed.add(engine);
        }
        if (failedHere) {
          place.message ??= element.message ?? null;
          if (!place.schemes.includes(measurement.scheme)) place.schemes.push(measurement.scheme);
        }
        places.set(key, place);
      }
    }
  }
  const findings: QuickFinding[] = [];
  for (const place of places.values()) {
    if (place.failed.size === 0) continue;
    const passedOnly = [...place.passed].filter((engine) => !place.failed.has(engine));
    const agreement: Agreement = place.failed.size > 1 ? "agreed" : passedOnly.length > 0 ? "contradicted" : "alone";
    findings.push({ criterion: place.criterion, page: place.page, where: place.where, element: elementMark(place.where, tags.get(`${place.page}\n${place.where}`) ?? null), message: place.message, engines: [...place.failed].sort(), rules: [...place.ruleIds].sort(), agreement, schemes: place.schemes });
  }
  return findings.sort((a, b) => AGREEMENTS.indexOf(a.agreement) - AGREEMENTS.indexOf(b.agreement) || compareCriterionIds(a.criterion, b.criterion) || a.page.localeCompare(b.page) || (a.where ?? "").localeCompare(b.where ?? ""));
}

function signalSentence(signal: Omit<QuickSignal, "sentenceNl">): string {
  const onPages = `op ${plural(signal.pages, "pagina", "pagina's")}`;
  switch (signal.ground) {
    case "engines-agree":
      return `Twee of meer meetprogramma's keuren ${plural(signal.agreed, "plek", "plekken")} af, ${onPages}. Een volledig onderzoek keurt dit criterium waarschijnlijk af.`;
    case "layout-probe":
      if (signal.probesNl.length > 0) return `${signal.probesNl.join(" ")} Dat is gezien op ${plural(signal.probePages, "pagina", "pagina's")}.`;
      return signal.criterion === "1.4.10"
        ? `Bij 320 pixels breed valt er inhoud buiten beeld op ${plural(signal.probePages, "pagina", "pagina's")}. Een volledig onderzoek keurt dit criterium waarschijnlijk af.`
        : `Bij 200 procent zoom valt er inhoud buiten beeld op ${plural(signal.probePages, "pagina", "pagina's")}. Een volledig onderzoek keurt dit criterium vaak af.`;
    case "engine-alone":
      return `Eén meetprogramma keurt ${plural(signal.alone, "plek", "plekken")} af, ${onPages}, en de andere zeggen er niets over. Dat vraagt een tweede blik.`;
    case "engines-contradict":
      return `Eén meetprogramma keurt ${plural(signal.contradicted, "plek", "plekken")} af, ${onPages}, terwijl een ander dezelfde plek goedkeurt. Dat beoordeelt een mens.`;
  }
}

/** Per criterion what the measurement points at, strongest ground first. */
export function quickSignals(pages: readonly QuickPage[], findings: readonly QuickFinding[]): QuickSignal[] {
  const perCriterion = new Map<string, { counts: Record<Agreement, number>; pages: Set<string>; probePages: Set<string>; probes: Map<QuickProbe, number> }>();
  const entry = (criterion: string) => {
    if (!perCriterion.has(criterion)) perCriterion.set(criterion, { counts: { agreed: 0, alone: 0, contradicted: 0 }, pages: new Set(), probePages: new Set(), probes: new Map() });
    return perCriterion.get(criterion)!;
  };
  for (const finding of findings) {
    const found = entry(finding.criterion);
    found.counts[finding.agreement] += 1;
    found.pages.add(finding.page);
  }
  for (const page of pages) {
    for (const [criterion, answer] of [["1.4.10", page.reflow], ["1.4.4", page.zoom]] as const) {
      if (!lossSeen(answer)) continue;
      const found = entry(criterion);
      found.probePages.add(page.url);
      found.pages.add(page.url);
    }
    for (const seen of page.probes ?? []) {
      const found = entry(QUICK_PROBES[seen.probe].criterion);
      found.probes.set(seen.probe, (found.probes.get(seen.probe) ?? 0) + 1);
      found.probePages.add(page.url);
      found.pages.add(page.url);
    }
  }
  const signals: QuickSignal[] = [];
  for (const [criterion, found] of perCriterion) {
    const ground: QuickSignal["ground"] = found.counts.agreed > 0 ? "engines-agree" : found.probePages.size > 0 ? "layout-probe" : found.counts.alone > 0 ? "engine-alone" : "engines-contradict";
    const known = criterionById(criterion);
    const signal = { criterion, titleNl: known?.titleNl ?? null, level: known?.level ?? null, ground, ...found.counts, probePages: found.probePages.size, probesNl: [...found.probes].map(([probe, places]) => QUICK_PROBES[probe].nl(places)), pages: found.pages.size };
    signals.push({ ...signal, sentenceNl: signalSentence(signal) });
  }
  return signals.sort((a, b) => GROUND_ORDER.indexOf(a.ground) - GROUND_ORDER.indexOf(b.ground) || compareCriterionIds(a.criterion, b.criterion));
}

/** The address of a page without its origin. */
export const pagePath = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/** Pages that carry the same title as another measured page: nothing in the title tells them apart. */
export function sameTitles(pages: readonly QuickPage[]): Map<string, QuickProbeFinding> {
  const byTitle = new Map<string, string[]>();
  for (const page of pages) if (page.title) byTitle.set(page.title, [...(byTitle.get(page.title) ?? []), page.url]);
  const found = new Map<string, QuickProbeFinding>();
  for (const [title, urls] of byTitle) if (new Set(urls.map(pagePath)).size > 1) for (const url of urls) found.set(url, { probe: "title", element: title });
  return found;
}

export function quickCounts(findings: readonly QuickFinding[], pages: readonly QuickPage[] = []): QuickCount[] {
  const counts = new Map<string, QuickCount>();
  for (const page of pages) {
    for (const seen of page.probes ?? []) {
      const path = pagePath(page.url);
      const criterion = QUICK_PROBES[seen.probe].criterion;
      const key = `${path}\n${criterion}\nloep:${seen.probe}\n${seen.element}`;
      const count = counts.get(key) ?? { path, criterion, rule: `loep:${seen.probe}`, element: seen.element, places: 0 };
      count.places += 1;
      counts.set(key, count);
    }
  }
  for (const finding of findings) {
    for (const rule of finding.rules) {
      const path = pagePath(finding.page);
      const key = `${path}\n${finding.criterion}\n${rule}\n${finding.element}`;
      const count = counts.get(key) ?? { path, criterion: finding.criterion, rule, element: finding.element, places: 0 };
      count.places += 1;
      counts.set(key, count);
    }
  }
  return [...counts.values()].sort((a, b) => a.path.localeCompare(b.path) || compareCriterionIds(a.criterion, b.criterion) || a.rule.localeCompare(b.rule) || a.element.localeCompare(b.element));
}

export interface SummaryInput {
  site: string;
  startedAt: string;
  finishedAt: string;
  maxPages: number;
  pagesFound: number | null;
  pageLimitReached: boolean;
  planned: number;
  pages: readonly QuickPage[];
}

export function buildQuickSummary(given: SummaryInput): QuickSummary {
  // A title two pages share is only seen over the pages together.
  const titles = sameTitles(given.pages);
  const input = { ...given, pages: given.pages.map((page) => (titles.has(page.url) && page.measurements.some((measurement) => measurement.observation !== null) ? { ...page, probes: [...(page.probes ?? []), titles.get(page.url)!] } : page)) };
  const findings = quickFindings(input.pages).filter((finding) => EVALUATED.has(finding.criterion));
  const versions = new Map<string, string>();
  for (const page of input.pages) for (const measurement of page.measurements) for (const method of measurement.rules?.methods ?? []) versions.set(engineName(method.implementation), method.version);
  const measured = (page: QuickPage): boolean => page.measurements.some((measurement) => measurement.observation !== null);
  const measuredPages = input.pages.filter(measured).length;
  const incomplete = input.pages.some((page) => page.measurements.some((measurement) => measurement.observation === null || (measurement.rules?.failed?.length ?? 0) > 0 || (measurement.rules?.pending?.length ?? 0) > 0));
  return {
    schema: QUICK_SCHEMA,
    kind: "quick",
    site: input.site,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    partial: incomplete || input.pages.length < input.planned,
    noticeNl: QUICK_NOTICE_NL,
    backtest: QUICK_BACKTEST,
    notMeasuredNl: QUICK_NOT_MEASURED_NL,
    coverage: { maxPages: input.maxPages, pagesFound: input.pagesFound, pageLimitReached: input.pageLimitReached, planned: input.planned, measured: measuredPages, failed: input.pages.length - measuredPages, schemes: QUICK_SCHEMES },
    engines: [...versions].map(([id, version]) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id)),
    signals: quickSignals(input.pages, findings),
    findings: findings.slice(0, TOP_FINDINGS),
    findingsTotal: findings.length,
    counts: quickCounts(findings, input.pages),
    pages: input.pages.map((page) => ({
      url: page.url,
      title: page.title,
      httpStatus: page.httpStatus,
      screenshot: page.screenshot,
      measured: measured(page),
      reasonsNl: page.measurements.flatMap((measurement) => (measurement.reasonNl ? [`${measurement.scheme === "light" ? "licht" : "donker"}: ${measurement.reasonNl}`] : [])),
      reflow: page.reflow,
      zoom: page.zoom,
      probes: page.probes ?? [],
    })),
  };
}

const GROUND_HEADING_NL: Record<QuickSignal["ground"], string> = {
  "engines-agree": "Meetprogramma's zijn het eens",
  "layout-probe": "Een proef van loep ziet het",
  "engine-alone": "Eén meetprogramma",
  "engines-contradict": "Meetprogramma's spreken elkaar tegen",
};

/** The summary for a person: what a full evaluation will probably fail, and what this measurement cannot say. */
export function quickSummaryMarkdown(summary: QuickSummary): string {
  const lines: string[] = [`# Snelle meting van ${summary.site}`, "", summary.noticeNl, "", summary.backtest.textNl, ""];
  const { coverage } = summary;
  lines.push(
    `Gemeten: ${plural(coverage.measured, "pagina", "pagina's")} van de ${coverage.planned} in de steekproef, in licht en donker.${coverage.failed > 0 ? ` ${plural(coverage.failed, "pagina is", "pagina's zijn")} niet gemeten.` : ""}${coverage.pageLimitReached ? ` De site heeft meer pagina's dan de ${coverage.maxPages} die zijn bezocht.` : ""}`,
    "",
  );
  if (summary.signals.length === 0) lines.push("De meetprogramma's vonden op deze pagina's niets. Dat zegt weinig: de meeste afkeuringen van een volledig onderzoek ziet deze meting niet.", "");
  for (const ground of GROUND_ORDER) {
    const signals = summary.signals.filter((signal) => signal.ground === ground);
    if (signals.length === 0) continue;
    lines.push(`## ${GROUND_HEADING_NL[ground]}`, "");
    for (const signal of signals) lines.push(`- ${signal.criterion} ${signal.titleNl ?? ""}`.trimEnd() + `. ${signal.sentenceNl}`);
    lines.push("");
  }
  lines.push("## Niet gemeten", "");
  for (const line of summary.notMeasuredNl) lines.push(`- ${line}`);
  lines.push("", "De plekken per criterium staan in summary.json.", "");
  return lines.join("\n");
}

export interface QuickChange {
  path: string;
  criterion: string;
  /** A rule of an engine, or `reflow` or `zoom` for a layout probe. */
  rule: string;
  /** The mark of the element; empty for a layout probe, which counts per page. */
  element: string;
  before: number;
  now: number;
  sentenceNl: string;
}

export interface QuickComparison {
  schema: number;
  kind: "quick-comparison";
  /** False when something got worse or a page of the baseline was not measured: a pipeline stops on it. */
  ok: boolean;
  baseline: { site: string; finishedAt: string };
  current: { site: string; finishedAt: string };
  worse: QuickChange[];
  better: QuickChange[];
  /** Pages the baseline measured and this measurement did not. */
  notMeasured: string[];
  /** Pages the baseline does not have: listed, not compared. */
  newPages: string[];
}

const layoutLoss = (answer: LayoutAnswer | null): number => (answer ? (answer.offenders ?? 0) + (answer.horizontalScroll ? 1 : 0) : 0);

/**
 * Hold a measurement against an earlier one of the same pages. A place more under a rule on a page
 * is worse, a place fewer is better. Places are counted per element mark, so a defect that is gone
 * and another that is new show as one better and one worse, and an element that only moved is no
 * change. Something both measurements report the same way never stops a pipeline, also when it is
 * a false alarm of an engine.
 */
export function compareQuick(baseline: QuickSummary, current: QuickSummary): QuickComparison {
  const measuredPaths = (summary: QuickSummary): Set<string> => new Set(summary.pages.filter((page) => page.measured).map((page) => pagePath(page.url)));
  const before = measuredPaths(baseline);
  const now = measuredPaths(current);
  const table = (summary: QuickSummary): Map<string, QuickCount> => {
    const rows = new Map<string, QuickCount>();
    for (const count of summary.counts) rows.set(`${count.path}\n${count.criterion}\n${count.rule}\n${count.element}`, count);
    for (const page of summary.pages) {
      if (!page.measured) continue;
      const path = pagePath(page.url);
      for (const [criterion, rule, answer] of [["1.4.10", "reflow", page.reflow], ["1.4.4", "zoom", page.zoom]] as const) {
        if (layoutLoss(answer) > 0) rows.set(`${path}\n${criterion}\n${rule}\n`, { path, criterion, rule, element: "", places: layoutLoss(answer) });
      }
    }
    return rows;
  };
  const was = table(baseline);
  const is = table(current);
  const worse: QuickChange[] = [];
  const better: QuickChange[] = [];
  for (const key of new Set([...was.keys(), ...is.keys()])) {
    const row = (is.get(key) ?? was.get(key))!;
    // Only pages both measured: a page that is new or gone says nothing about a change.
    if (!before.has(row.path) || !now.has(row.path)) continue;
    const a = was.get(key)?.places ?? 0;
    const b = is.get(key)?.places ?? 0;
    if (a === b) continue;
    const title = criterionById(row.criterion)?.titleNl;
    const what = row.rule === "reflow" ? "bij 320 pixels breed" : row.rule === "zoom" ? "bij 200 procent zoom" : row.rule.startsWith("loep:") ? `proef ${row.rule.slice(5)}` : `regel ${row.rule}`;
    const sentenceNl = `${row.path}: ${row.criterion}${title ? ` ${title}` : ""}, ${what}${row.element ? `, ${row.element}` : ""}, van ${plural(a, "plek", "plekken")} naar ${b}.`;
    (b > a ? worse : better).push({ path: row.path, criterion: row.criterion, rule: row.rule, element: row.element, before: a, now: b, sentenceNl });
  }
  const order = (a: QuickChange, b: QuickChange): number => a.path.localeCompare(b.path) || compareCriterionIds(a.criterion, b.criterion) || a.rule.localeCompare(b.rule) || a.element.localeCompare(b.element);
  const notMeasured = [...before].filter((path) => !now.has(path)).sort();
  return {
    schema: QUICK_SCHEMA,
    kind: "quick-comparison",
    ok: worse.length === 0 && notMeasured.length === 0,
    baseline: { site: baseline.site, finishedAt: baseline.finishedAt },
    current: { site: current.site, finishedAt: current.finishedAt },
    worse: worse.sort(order),
    better: better.sort(order),
    notMeasured,
    newPages: [...now].filter((path) => !before.has(path)).sort(),
  };
}

/**
 * The changes as a person reads them: one line per page and criterion. Four engines that see the
 * same new defect are one line, not four.
 */
export function groupedChangesNl(changes: readonly QuickChange[]): string[] {
  const groups = new Map<string, QuickChange[]>();
  for (const change of changes) {
    const key = `${change.path}\n${change.criterion}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const title = criterionById(first.criterion)?.titleNl;
    const direction = first.now > first.before ? "erbij" : "minder";
    const layout = group.find((change) => change.rule === "reflow" || change.rule === "zoom");
    // Four engines that see the same three places are three places: the engine that sees most says how many.
    const perEngine = new Map<string, number>();
    const probes = new Set(group.filter((change) => change.rule.startsWith("loep:")).map((change) => change.rule));
    for (const change of group) if (change !== layout && !probes.has(change.rule)) perEngine.set(change.rule.split(":")[0]!, (perEngine.get(change.rule.split(":")[0]!) ?? 0) + Math.abs(change.now - change.before));
    const perProbe = [...probes].map((rule) => group.filter((change) => change.rule === rule).reduce((sum, change) => sum + Math.abs(change.now - change.before), 0));
    const places = Math.max(layout ? Math.abs(layout.now - layout.before) : 0, ...perEngine.values(), ...perProbe);
    const by = [...(perEngine.size > 0 ? [plural(perEngine.size, "meetprogramma", "meetprogramma's")] : []), ...(probes.size > 0 ? ["een proef van loep"] : []), ...(layout ? [layout.rule === "reflow" ? "de proef op 320 pixels breed" : "de proef op 200 procent zoom"] : [])].join(" en ");
    const elements = [...new Set(group.map((change) => change.element).filter(Boolean))];
    const which = elements.length === 0 ? "" : ` Het gaat om ${elements.slice(0, 3).map((element) => `\`${element}\``).join(", ")}${elements.length > 3 ? ` en ${elements.length - 3} meer` : ""}.`;
    return `${first.path}: ${first.criterion}${title ? ` ${title}` : ""}, ${plural(places, "plek", "plekken")} ${direction} volgens ${by}.${which}`;
  });
}

export function quickComparisonMarkdown(comparison: QuickComparison): string {
  const lines: string[] = [`# Snelle meting vergeleken met ${comparison.baseline.finishedAt.slice(0, 10)}`, ""];
  if (comparison.ok && comparison.better.length === 0) lines.push("Niets is veranderd op de pagina's die beide metingen hebben.", "");
  else if (comparison.ok) lines.push("Niets is slechter geworden.", "");
  if (comparison.worse.length > 0) {
    lines.push("## Slechter", "");
    for (const line of groupedChangesNl(comparison.worse)) lines.push(`- ${line}`);
    lines.push("");
  }
  if (comparison.notMeasured.length > 0) {
    lines.push("## Niet meer gemeten", "", "Deze pagina's had de vorige meting wel. Zonder meting is niet te zeggen of ze slechter zijn.", "");
    for (const path of comparison.notMeasured) lines.push(`- ${path}`);
    lines.push("");
  }
  if (comparison.better.length > 0) {
    lines.push("## Beter", "");
    for (const line of groupedChangesNl(comparison.better)) lines.push(`- ${line}`);
    lines.push("");
  }
  if (comparison.newPages.length > 0) {
    lines.push("## Nieuwe pagina's", "", "Niet vergeleken. Ze tellen mee zodra deze meting de basislijn is.", "");
    for (const path of comparison.newPages) lines.push(`- ${path}`);
    lines.push("");
  }
  return lines.join("\n");
}
