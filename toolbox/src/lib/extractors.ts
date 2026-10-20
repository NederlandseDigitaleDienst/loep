import type { MediaElement, MediaReport } from "../instruments/media.ts";
import type { ContentInventory } from "../instruments/overflow.ts";
import { contrastRatio, floorRatio, type Rgb } from "./contrast.ts";
import { acceptedGapFor, frameStanding, NOT_OPENED_ON_PAGE_TYPE } from "./sitemodel.ts";
import type { EngineOutcome } from "./engines.ts";
import { REGULAR_PATH, type Clickable, type Element, type Facts, type FormErrorState, type PageData, type RunData, type SkipLinkAim } from "./rundata.ts";
import { documents } from "./document-evidence.ts";
import { judgeTimer, TIMER_RULE_NL, timerNl, watchNl, type TimeLimitProbe } from "./timelimits.ts";
import { canonicalJson } from "./canonical.ts";
import { whyCandidateNl } from "./statusmessages.ts";

/**
 * Extractors turn the raw evidence of a run into compact, deduplicated tables for
 * one question each. They measure and count; they never judge. Every table says
 * how many things were examined, so a "passed" can state its coverage.
 */
export type Extractor = (run: RunData, criterion: string) => unknown;

const EXAMPLES = 4;

interface Group<T> {
  example: T;
  count: number;
  pages: string[];
}

/** Collapse identical items across pages: site chrome is reported once, with the pages it is on. */
function group<T>(run: RunData, select: (page: PageData) => T[], key: (item: T) => string): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  for (const page of run.pages) {
    for (const item of select(page)) {
      const id = key(item);
      const existing = groups.get(id);
      if (existing) {
        existing.count++;
        if (!existing.pages.includes(page.label)) existing.pages.push(page.label);
      } else {
        groups.set(id, { example: item, count: 1, pages: [page.label] });
      }
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

function pagesText(pages: string[], total: number): string {
  if (pages.length === total && total > 3) return `alle ${total}`;
  return pages.length > 8 ? `${pages.slice(0, 8).join(",")} +${pages.length - 8}` : pages.join(",");
}

const where = (element: { path: string[] }): string => element.path.join(" >>> ");
const norm = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const axName = (element: Element): string => element.ax?.name ?? "";

/**
 * An embedded frame that answered with an error status was not loaded: what was recorded for
 * it is an error page, not the frame's content. Null for a page of the site and for a frame that loaded.
 */
export function frameNotLoaded(page: PageData, run: RunData): string | null {
  if (page.item.kind !== "embedded" || (page.item.status !== null && page.item.status < 400)) return null;
  const own = new Set(run.pages.filter((other) => other.item.kind !== "embedded").map((other) => new URL(other.item.url).hostname));
  const host = new URL(page.item.url).hostname;
  const whose = own.has(host) ? "van de site zelf" : `van een andere aanbieder (${host})`;
  return `Dit ingesloten venster ${whose} gaf bij het laden ${page.item.status === null ? "geen antwoord" : `foutstatus ${page.item.status}`} en is niet geladen. Wat onder dit label is vastgelegd, is een foutpagina en niet de inhoud van het venster. Het venster is daarom niet onderzocht. Noem dat als beperking. Laat dit label buiten beschouwing bij criteria die over de eigen pagina's van de site gaan (zoals taal, titel, koppen en structuur): het is daar geen reden voor 'kan niet bepalen'. Gaat een criterium over de inhoud van het venster zelf (zoals video en geluid), dan blijft die inhoud een open punt.`;
}

/**
 * The states a page was captured in, in a run with a site model: the page as the sweep
 * measured it, and every state of the model that belongs to its page type. Nothing in a run without a model.
 */
function statesOfPage(page: PageData, run: RunData): Record<string, unknown> {
  const model = run.siteModel;
  const captured = run.siteStates;
  if (!model || !captured) return {};
  const type = model.pageTypes.find((entry) => entry.pages.includes(page.item.url));
  const closed = model.blockers.map((blocker) => blocker.id);
  const labelOf = (url: string | null): string | null => run.pages.find((other) => other.item.url === url)?.label ?? null;
  return {
    pageType: type?.id ?? null,
    states: [
      { state: "default", open: page.label, descriptionNl: closed.length > 0 ? `de pagina zoals alle metingen haar zagen: zonder ${closed.join(", ")}, die vooraf ${closed.length === 1 ? "is" : "zijn"} gesloten` : "de pagina zoals alle metingen haar zagen; het sitemodel noemt geen blokkades", files: page.dir },
      ...captured.states
        .filter((state) => state.reached && type !== undefined && state.pageTypes.includes(type.id))
        .map((state) => ({ state: state.id, kind: state.kind, open: openCommand(state, run), capturedOn: labelOf(state.url) ?? state.url, ...(state.frame ? { frame: state.frame.measuredInFrame ? `gemeten in het ingesloten venster ${state.frame.address}, op de pagina waar het staat` : `${state.frame.address}: ${state.frame.reasonNl}` } : {}), viewport: state.viewport ? `${state.viewport.width}x${state.viewport.height}` : null, files: state.dir, coverage: stateCoverage(state, run) })),
    ],
    coverage: pageCoverage(page, run),
    ...(refusedWrites(page, run).length > 0 ? { refusedWriteRequests: { note: "Deze pagina vroeg zelf om schrijfverzoeken. Die zijn tegengehouden, zoals elk verzoek dat geen GET is. Inhoud die zo laadt, ontbreekt in het bewijs; een laadscherm kan zijn blijven staan.", requests: refusedWrites(page, run) } } : {}),
  };
}

/** The arguments of `loep open` that bring a session into a captured state: the one name a state has everywhere. */
function openCommand(state: NonNullable<RunData["siteStates"]>["states"][number], run: RunData): string | null {
  if (state.kind === "blocker") {
    // As the sweep opened it, with the label of the page where the run has one.
    const label = run.pages.find((page) => page.item.url === state.url)?.label;
    const recorded = state.openWith ?? `${state.url} --with-blockers`;
    return label && state.url ? recorded.replace(state.url, label) : recorded;
  }
  return state.recipe ? `--state ${state.recipe}` : null;
}

const refusedWrites = (page: PageData, run: RunData): { method: string; address: string; count: number }[] => (run.siteStates?.refusedWrites ?? []).filter((entry) => entry.url === page.item.url).map(({ method, address, count }) => ({ method, address, count }));

/**
 * Which measurements of the sweep there are for a page. A judge builds on what is here and
 * says "veegronde mist" for what is not; the gate reports every false as a gap.
 */
export function pageCoverage(page: PageData, run: RunData): Record<string, boolean> {
  const contrastIn = (scheme: string, width: number | null = null): boolean => (run.contrast ?? []).some((entry) => entry.slug === page.item.slug && entry.scheme === scheme && (entry.width ?? null) === width);
  const walked = (walk: { outcome: string } | null | undefined): boolean => walk !== null && walk !== undefined;
  const hoverFocusIn = (scheme: string): boolean => (run.contrast ?? []).some((entry) => entry.slug === page.item.slug && entry.scheme === scheme && entry.width === undefined && entry.hoverFocus !== undefined);
  return {
    tabWalkWithFocusLight: walked(page.tabwalk),
    tabWalkWithFocusDark: walked(page.tabwalkDark),
    tabWalkWithFocusNarrow: walked(page.tabwalkNarrow),
    contrastLight: contrastIn("light"),
    contrastDark: contrastIn("dark"),
    contrastLight320: contrastIn("light", SMALLEST_WIDTH),
    contrastDark320: contrastIn("dark", SMALLEST_WIDTH),
    targetSize320: page.smallest?.targets !== undefined,
    textSpacing320: page.smallest?.textspacing !== undefined,
    visibleTextAndNames320: page.smallest?.links !== undefined && page.smallest?.controls !== undefined,
    reflow320: page.reflow !== undefined,
    zoom200: page.zoom200 !== undefined,
    portrait: page.portrait !== undefined,
    contentComparedAt320: page.content !== undefined && page.reflow?.content !== undefined,
    contentComparedAt200Percent: page.content !== undefined && page.zoom200?.content !== undefined,
    contentComparedInPortrait: page.content !== undefined && page.portrait?.content !== undefined,
    controlsInNarrowWindow: page.narrow !== undefined,
    textSpacing: page.textspacing !== undefined,
    controlsWithTextSpacing: page.textspacing?.controls !== undefined && page.smallest?.textspacing?.controls !== undefined,
    enginesLight: page.engines?.light !== undefined,
    enginesDark: page.engines?.dark !== undefined,
    orderComparedWide: page.order !== undefined,
    orderCompared320: page.order320 !== undefined,
    spacedTextSearched: page.spacedText !== undefined,
    textAlternativesLanguage: page.languages !== undefined,
    imageTextRecognised: page.pictures !== undefined && page.pictures.unavailableNl === undefined,
    // An embedded window measured in its place cannot be laid out at another width on its own.
    controlsBetweenWidthsSearched: page.widths !== undefined && (page.widths.failedNl === undefined || page.item.kind === "embedded"),
    contrastHoverFocusLight: hoverFocusIn("light"),
    contrastHoverFocusDark: hoverFocusIn("dark"),
    interactionProbe: run.states !== null && run.states !== undefined,
    blockersClosed: !(run.siteStates?.dismissals ?? []).some((entry) => entry.url === page.item.url && !entry.dismissed),
  };
}

/** The width of the second window every page is measured in. */
export const SMALLEST_WIDTH = 320;

type Captured = NonNullable<RunData["siteStates"]>["states"][number];

/**
 * Which measurements there are for a captured state of the model, as `pageCoverage` says it
 * for a page. `singleKeys` is there once the interaction probe has run, for the states it presses keys in.
 */
export function stateCoverage(state: Captured, run: RunData): Record<string, boolean> {
  const evidence = run.stateEvidence?.[state.id];
  const keys = run.states?.singleKeys?.states?.find((row) => row.state === state.id);
  return {
    contrast: Boolean(state.files.contrast),
    // Each variant of a blocker has a scheme of its own.
    ...(state.kind === "blocker" ? {} : { contrastDark: Boolean(state.files.contrastDark) }),
    targetSize: Boolean(state.files.targets),
    // An older run forced the spacing after the state was open; that says less and does not count.
    textSpacingBeforeOpening: evidence ? evidence.textSpacing?.appliedBeforeOpening === true : Boolean(state.files.textSpacing),
    visibleTextAndNames: Boolean(state.files.facts),
    orderCompared: Boolean(state.files.order),
    textAndLanguage: Boolean(state.files.text && state.files.languages),
    imageTextRecognised: evidence ? evidence.pictures !== undefined && evidence.pictures.unavailableNl === undefined : Boolean(state.files.pictures),
    focusCoveredBackwardAndArrows: Boolean(state.files.focusCovered),
    // A component is opened on every page type it stands on.
    ...(state.kind === "component" ? { openedPerPageType: state.perPageType !== undefined } : {}),
    ...(keys ? { singleKeys: keys.examined } : {}),
  };
}

const reachedStates = (run: RunData): Captured[] => (run.siteStates?.states ?? []).filter((state) => state.reached);

type ProbedWindow = NonNullable<NonNullable<RunData["states"]>["embedded"]>[number];

/** Where the sweep measured an embedded window, for whoever reads what stands under its label. */
export const measuredWhereNl = (placement: NonNullable<PageData["placement"]>, probes?: ProbedWindow): string =>
  placement.inPlaceOn
    ? `gemeten op de pagina waar het venster staat (${placement.inPlaceOn}): wat hulpsoftware krijgt, contrast, aanwijsgebied, de Tab-proef, vergroten, tekstafstand en media. Een schermafbeelding toont wat het venster toont; tekst die daarbuiten valt, is zonder beeld gemeten. ${probedWhereNl(probes)}`
    : `niet gemeten op de pagina waar het venster staat, maar los geopend: ${placement.apartNl}. Toont het venster los een foutscherm, dan is dat niet de inhoud van het venster`;

/** Where the probes with forms, buttons, keys and the pointer reached an embedded window. Without a record they opened it on its own, as they did before. */
const probedWhereNl = (probes: ProbedWindow | undefined): string => {
  const names = "De proeven met formulieren, knoppen, losse toetsen, aanwijzen en indrukken";
  if (!probes) return `${names} openden het venster los`;
  const failed = probes.failedNl.length > 0 ? `. Niet gelukt binnen het venster en daar niet onderzocht: ${probes.failedNl.join("; ")}` : "";
  return probes.inPlaceOn ? `${names} zijn ook daar gedaan, binnen het venster${failed}` : `${names} openden het venster los: ${probes.apartNl}${failed}`;
};

export const legend: Extractor = (run) =>
  Object.fromEntries([
    ...run.pages.map((page) => {
      const notLoaded = frameNotLoaded(page, run);
      return [page.label, { url: page.item.url, title: page.facts.title, status: page.item.status, ...(page.item.kind === "embedded" ? { embedded: page.item.reason } : {}), ...(page.placement ? { measured: measuredWhereNl(page.placement, run.states?.embedded?.find((entry) => entry.page === page.label)) } : {}), ...(notLoaded ? { notLoaded } : {}), files: page.dir, ...statesOfPage(page, run) }];
    }),
    // Documents of the sample stand next to the pages, under their own labels.
    ...(run.documents ?? []).map((document) => [document.label, { url: document.item.url, title: document.facts?.title ?? null, document: document.item.kind, measured: document.facts?.status ?? "notMeasured", ...(document.facts?.reasonNl ? { reasonNl: document.facts.reasonNl } : {}), files: document.dir }]),
  ]);

const STATE_ISSUES = 15;

/**
 * What the site model added to the evidence: which blockers were closed before measuring,
 * each blocker as it stands on a page, each component and process as its recipe opens it,
 * with what the rule engines and the contrast measurement found there for this criterion.
 */
/** The criteria whose dossier says what a simulated screen reader said by itself when a state opened. */
const SPOKEN_CRITERIA = new Set(["4.1.3", "3.3.1"]);

export const siteStates: Extractor = (run, criterion) => {
  const model = run.siteModel;
  const captured = run.siteStates;
  if (!model || !captured) return { examined: false, note: "Deze run heeft geen sitemodel. De pagina's zijn gemeten zoals ze laadden: een cookiemelding is niet gesloten en onderdelen zijn niet volgens een recept geopend." };
  const labelOf = (url: string | null): string | null => run.pages.find((page) => page.item.url === url)?.label ?? null;
  const labelsOf = (typeIds: string[]): string => {
    const labels = model.pageTypes.filter((type) => typeIds.includes(type.id)).flatMap((type) => type.pages.map(labelOf).filter((label): label is string => label !== null));
    return pagesText(labels, run.pages.length);
  };
  const evidence = (id: string): Record<string, unknown> => {
    const found = run.stateEvidence?.[id];
    if (!found) return {};
    const issues = found.engines.results.filter((result) => (result.outcome === "failed" || result.outcome === "cantTell") && result.criteria.includes(criterion));
    // Text behind a layer, such as the page under an open dialog, is not what a visitor reads there: left out.
    const inFront = found.contrast.measurements.filter((entry) => !(entry as { behindOverlay?: string }).behindOverlay);
    const textFailures = inFront.filter((entry) => entry.outcome === "failed");
    const nonTextFailures = [...found.contrast.controls, ...found.contrast.graphics].filter((entry) => entry.outcome !== "duidelijk");
    return {
      engineIssuesForThisCriterion: issues.slice(0, STATE_ISSUES).map((result) => ({ engine: result.engine, rule: result.rule, outcome: result.outcome, nodes: result.nodeCount, message: result.nodes[0]?.message ?? result.description, target: result.nodes[0]?.target ?? null })),
      ...(criterion === "1.4.3" ? { textBehindALayerLeftOut: found.contrast.measurements.length - inFront.length, textContrastFailures: textFailures.slice(0, STATE_ISSUES).map((entry) => ({ text: entry.text, foreground: entry.foreground, background: entry.background, ratio: entry.ratio, required: entry.required, where: entry.where })), textContrastFailureCount: textFailures.length } : {}),
      ...(criterion === "1.4.11" ? { nonTextContrastCandidates: nonTextFailures.length } : {}),
    };
  };
  const stateRow = (state: (typeof captured.states)[number]): Record<string, unknown> => ({
    state: state.id,
    open: openCommand(state, run),
    reached: state.reached,
    ...(state.reached ? {} : { notReachedNl: state.reasonNl }),
    capturedOn: labelOf(state.url) ?? state.url,
    viewport: state.viewport ? `${state.viewport.width}x${state.viewport.height}` : null,
    appliesToPages: labelsOf(state.pageTypes),
    files: state.files,
    stillInThisStateAfterMeasuring: state.stillReachedAfterMeasuring,
    engineSummary: state.engineSummary,
    contrast: state.contrast,
    ...(state.kind === "blocker" ? {} : { contrastDark: state.contrastDark ?? null }),
    ...((state.variantsNotReached ?? []).length > 0 ? { notMeasuredBecauseTheStateDidNotOpenAgain: state.variantsNotReached } : {}),
    coverage: state.reached ? stateCoverage(state, run) : null,
    largestFixedElementShareOfWindow: state.largestOverlayShare,
    // What is said by itself when the state opens matters for a status message and for an error; elsewhere it would only make the dossier longer.
    ...(state.spokenByItself && SPOKEN_CRITERIA.has(criterion) ? { spokenByItselfOnOpening: state.spokenByItself } : {}),
    ...((state.refused ?? []).length > 0 ? { refusedRequests: { note: "Verzoeken die zijn tegengehouden terwijl deze toestand werd bereikt en gemeten: een schrijfverzoek, of een adres buiten de run. Wat daarvan afhangt, werkte niet en is niet onderzocht.", requests: state.refused } } : {}),
    ...evidence(state.id),
  });
  const statesFor = (kind: string, id: string) => captured.states.filter((state) => state.kind === kind && state.modelId === id).map(stateRow);
  // What the gate let through as how the site is, by the same rule: a component the sweep could not open on one of its page types.
  const notOpenedAccepted = reachedStates(run)
    .filter((state) => state.kind === "component")
    .flatMap((state) =>
      (state.perPageType ?? [])
        .filter((row) => !row.reached)
        .flatMap((row) => {
          const accepted = acceptedGapFor(model, { check: NOT_OPENED_ON_PAGE_TYPE, page: row.url, component: state.modelId });
          return accepted ? [{ component: state.modelId, pageType: row.pageType, triedOn: labelOf(row.url) ?? row.url, pagesOfThisType: labelsOf([row.pageType]), notOpenedNl: row.reasonNl, acceptedNl: accepted.reasonNl, decidedBy: accepted.decidedBy }] : [];
        }),
    );
  return {
    examined: true,
    method:
      "Een verkenner heeft vooraf vastgelegd wat over de pagina ligt en welke onderdelen pas na een handeling iets tonen, elk met een recept dat is nagespeeld en gecontroleerd. Alle metingen per pagina zijn gedaan met de blokkades gesloten (toestand 'default'). Daarnaast is elke blokkade per paginatype één keer vastgelegd terwijl ze er staat, en is elk onderdeel en proces één keer geopend volgens het recept. In elke toestand zijn een schermafbeelding, de feiten (met van elke link en elk bedieningselement de zichtbare tekst en de naam), de toegankelijkheidsboom, beide regelengines, het contrast, de afmeting van elk bedieningselement en een Tab-proef met focusmeting vastgelegd (files). Voor de ruimere tekstafstand en voor het contrast in het donkere schema is elke toestand opnieuw geopend: de tekstafstand staat dan al aan voordat de eerste stap van het recept wordt gezet. Een blokkade heeft eigen donkere toestanden. `coverage` zegt per toestand wat er is. De Tab-proef begint waar de focus na het openen staat. Tekst die achter een geopend venster of een andere laag ligt, is uit de contrasttellingen gelaten. Elke toestand heeft één naam; `open` geeft wat je achter `loep open` zet om er in een sessie te komen. Een toestand is vastgelegd op één pagina en geldt voor de paginatypen die erbij staan.",
    pageTypes: model.pageTypes.map((type) => ({ id: type.id, descriptionNl: type.descriptionNl, representative: labelOf(type.representative) ?? type.representative, pages: pagesText(type.pages.map(labelOf).filter((label): label is string => label !== null), run.pages.length) })),
    blockers: model.blockers.map((blocker) => ({
      id: blocker.id,
      kind: blocker.kind,
      descriptionNl: blocker.descriptionNl,
      closedBeforeMeasuring: captured.seeded.blockers.includes(blocker.id) ? "ja: elke meting begon met de keuze al gemaakt, zodat de blokkade niet verscheen" : "nee: het recept sloot de blokkade niet meer bij het begin van de meting",
      cameUpAnywayAndClosedOnThePage: captured.dismissals.filter((entry) => entry.blocker === blocker.id && entry.dismissed).length,
      notClosed: captured.dismissals.filter((entry) => entry.blocker === blocker.id && !entry.dismissed).map((entry) => ({ page: labelOf(entry.url) ?? entry.url, during: entry.where, reasonNl: entry.reasonNl })),
      capturedWithTheBlockerInPlace: statesFor("blocker", blocker.id),
    })),
    components: model.components.map((component) => ({ id: component.id, type: component.type, descriptionNl: component.descriptionNl, onlyAtViewport: component.viewport, ...(component.blockedRequests ? { notExaminableWithoutTheseRequests: component.blockedRequests } : {}), ...statesFor("component", component.id)[0] })),
    contentWithoutAction: model.content ?? [],
    notExaminableWithoutWriteRequest: [
      ...model.components.filter((component) => (component.blockedRequests ?? []).length > 0).map((component) => ({ component: component.id, requests: component.blockedRequests })),
      ...run.pages.filter((page) => refusedWrites(page, run).length > 0).map((page) => ({ page: page.label, requests: refusedWrites(page, run) })),
    ],
    ...(notOpenedAccepted.length > 0
      ? {
          componentsNotOpenedOnPageType: {
            note: "Onderdelen die op een paginatype niet opengingen, terwijl ze er volgens het sitemodel wel staan. De verkenner of een persoon (`decidedBy`) heeft dat aanvaard als eigenschap van de site, en de bewijspoort telt het daarom niet als gat. Op dat paginatype is het onderdeel niet geopend en niet gemeten: wat het daar toont en hoe het daar werkt, staat niet in dit dossier. Of de metingen van het onderdeel onder `components` ook voor dat paginatype gelden, is niet vastgesteld. Hangt dit criterium af van dat onderdeel, dan rust een goedkeuring of \"niet van toepassing\" nooit op metingen van het onderdeel op een ander paginatype. Open het zelf op de pagina die erbij staat (`triedOn`) of op een andere pagina van dat paginatype, en meet het daar. Lukt openen na een echte poging niet, dan is dat een open punt `proef werkte niet:`, met het onderdeel, het paginatype en wat je probeerde. Zie je waarom het niet opengaat en valt dat onder dit criterium, dan is het een bevinding.",
            rows: notOpenedAccepted,
          },
        }
      : {}),
    processes: model.processes.map((process) => ({ id: process.id, descriptionNl: process.descriptionNl, ...statesFor("process", process.id)[0] })),
    frames: model.frames.map((frame) => ({ address: frame.address, class: frame.class, kindNl: frameStanding(frame).labelNl, counts: frameStanding(frame).counts, ...(frameStanding(frame).owner ? { ownerOfFindings: frameStanding(frame).owner } : {}), descriptionNl: frame.descriptionNl, ...(frame.reasonNl ? { reasonNl: frame.reasonNl } : {}), evaluatedAsPage: run.pages.filter((page) => page.item.kind === "embedded" && page.item.url.startsWith(frame.address)).map((page) => page.label) })),
    framesLeftOutOfTheSample: run.sample.excludedFrames ?? [],
    notOpenedOrNotExaminedNl: model.notesNl,
  };
};

/** Everything the two rule engines concluded for this criterion, in both colour schemes. */
export const engine: Extractor = (run, criterion) => {
  const rows = new Map<string, { engine: string; rule: string; ruleUrl: string; outcome: EngineOutcome; description: string; nodes: number; pages: Set<string>; schemes: Set<string>; examples: { page: string; target: string; message?: string; html?: string }[] }>();
  for (const page of run.pages) {
    for (const scheme of ["light", "dark"] as const) {
      for (const result of page.engines[scheme].results) {
        if (!result.criteria.includes(criterion)) continue;
        const key = `${result.engine}:${result.rule}:${result.outcome}`;
        const row = rows.get(key) ?? { engine: result.engine, rule: result.rule, ruleUrl: result.ruleUrl, outcome: result.outcome, description: result.description, nodes: 0, pages: new Set(), schemes: new Set(), examples: [] };
        rows.set(key, row);
        // Light and dark see the same elements; count each node once per page.
        if (!row.pages.has(page.label)) row.nodes += result.nodeCount;
        row.pages.add(page.label);
        row.schemes.add(scheme);
        if ((result.outcome === "failed" || result.outcome === "cantTell") && row.examples.length < EXAMPLES * 2) {
          for (const node of result.nodes) {
            if (row.examples.length >= EXAMPLES * 2) break;
            if (row.examples.some((example) => example.target === node.target && example.message === node.message)) continue;
            row.examples.push({ page: `${page.label}/${scheme}`, target: node.target, ...(node.message ? { message: node.message } : {}), ...(node.html ? { html: node.html } : {}) });
          }
        }
      }
    }
  }
  const order: EngineOutcome[] = ["failed", "cantTell", "passed", "inapplicable"];
  const results = [...rows.values()]
    .sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome) || a.engine.localeCompare(b.engine) || a.rule.localeCompare(b.rule))
    .map((row) => ({ ...row, pages: pagesText([...row.pages], run.pages.length), schemes: [...row.schemes].join("+") }));
  return {
    note: "Geen bevinding van een engine is geen bewijs dat aan het criterium is voldaan. 'cantTell' betekent dat de engine het niet kon vaststellen.",
    rulesForThisCriterion: results.length,
    results,
  };
};

/** Site-wide counts of content types, on every page: the proof under a "not applicable". */
/** What a total of the inventory counts: said with every total, so a number is never read as a number of different things. */
export const COUNT_UNIT_NL =
  "Elk getal is het aantal keren dat zo'n element is aangetroffen, opgeteld over de pagina's. Een onderdeel dat op elke pagina staat (een zoekformulier in de kop) telt op elke pagina opnieuw mee. Het is dus geen aantal verschillende onderdelen. Schrijf een telling altijd met die eenheid op: \"64 keer een formulier aangetroffen op 30 pagina's\", niet \"64 formulieren\"; hoeveel verschillende het er zijn, zeg je alleen als je ze zelf hebt onderscheiden.";

export const inventoryCounts: Extractor = (run) => {
  const perPage: Record<string, Record<string, number>> = {};
  for (const page of run.pages) {
    const present = Object.fromEntries(Object.entries(page.facts.counts).filter(([, value]) => typeof value === "number" && value > 0)) as Record<string, number>;
    perPage[page.label] = present;
  }
  const iframes = group(run, (page) => page.facts.iframes, (frame) => `${frame.src}`).map((entry) => ({ src: entry.example.src, title: entry.example.title, axName: axName(entry.example), pages: pagesText(entry.pages, run.pages.length) }));
  return { pagesExamined: run.pages.length, unitNl: COUNT_UNIT_NL, totals: run.inventory.totals, iframes, customElements: [...new Set(run.pages.flatMap((page) => page.facts.counts.customElements as string[]))].sort() };
};

export const titles: Extractor = (run) => {
  const rows = run.pages.map((page) => ({ page: page.label, path: new URL(page.item.url).pathname, title: page.facts.title, h1: page.facts.headings.find((heading) => heading.level === 1 && heading.visible)?.text ?? null }));
  const seen = new Map<string, string[]>();
  for (const row of rows) seen.set(row.title, [...(seen.get(row.title) ?? []), row.page]);
  return {
    pagesExamined: rows.length,
    emptyTitles: rows.filter((row) => !row.title.trim()).map((row) => row.page),
    duplicateTitles: [...seen.entries()].filter(([, pages]) => pages.length > 1).map(([title, pages]) => ({ title, pages })),
    rows,
  };
};

export const language: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  pageLanguages: group(run, (page) => [page.facts.lang ?? "(geen lang-attribuut)"], (lang) => lang).map((entry) => ({ lang: entry.example, pages: pagesText(entry.pages, run.pages.length) })),
  elementsWithOwnLanguage: group(run, (page) => page.facts.langParts, (part) => `${part.langValue}|${part.text.slice(0, 60)}`).map((entry) => ({ lang: entry.example.langValue, text: entry.example.text.slice(0, 120), pages: pagesText(entry.pages, run.pages.length) })),
  textExcerpts: run.pages.map((page) => ({ page: page.label, text: page.facts.mainText.slice(0, 1200), fullTextFile: `${page.dir}/text.txt` })),
  note: "De uittreksels zijn de eerste 1200 tekens van de hoofdinhoud. De volledige zichtbare tekst van elke pagina staat in het genoemde bestand; lees die als het criterium over alle tekst gaat.",
  textAlternativesAndNames: alternativesLanguage(run),
  states: statesLanguage(run),
});

type LanguagePiece = NonNullable<PageData["languages"]>["textAlternatives"][number];
const pieceRow = (piece: LanguagePiece) => ({ kind: piece.kind, text: piece.text, words: piece.words, declaredLang: piece.declared, detected: piece.detected, verdict: piece.verdict, ...(piece.reason ? { reason: piece.reason } : {}) });
/** Pieces where the language may be wrong come first: a mismatch, then what has no lang at all. */
const VERDICT_ORDER = ["mismatch", "undeclared", "cantTell", "match"];

/** The language of text alternatives and names on the pages (WCAG 3.1.2), one row per text. */
function alternativesLanguage(run: RunData): Record<string, unknown> {
  const measured = run.pages.filter((page) => page.languages);
  if (measured.length === 0) return { examined: false, note: "De tekstalternatieven en namen zijn in deze run niet als eigen onderdeel vastgelegd." };
  const rows = group({ ...run, pages: measured }, (page) => page.languages!.textAlternatives, (piece) => `${piece.kind}|${piece.text}|${piece.declared}`)
    .map((entry) => ({ ...pieceRow(entry.example), pages: pagesText(entry.pages, measured.length), where: entry.example.path.join(" >>> ") }))
    .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict as string) - VERDICT_ORDER.indexOf(b.verdict as string));
  return {
    examined: true,
    method: `Op elke pagina zijn de woorden vastgelegd die hulpsoftware voorleest en die een ziende gebruiker niet als tekst ziet: de alt-tekst van een afbeelding, aria-label, title, aria-description, de titel van een tekening (svg), de waarde van een invoerknop en de voorbeeldtekst van een veld. Bij elk staat de taal die er in de code voor geldt (\`declaredLang\`: een eigen lang-attribuut of dat van het dichtstbijzijnde element eromheen) en wat twee taalherkenners erin vinden (\`detected\`). \`verdict\` volgt de regels van \`loep lang\`: 'mismatch' als beide herkenners zeker zijn van dezelfde andere taal, 'cantTell' als het stuk korter is dan ${measured[0]!.languages!.minWords} woorden of de herkenners het oneens of onzeker zijn; lees die zelf. Verborgen elementen tellen niet mee. Rijen die op een andere taal wijzen, staan bovenaan.`,
    pagesExamined: measured.length,
    piecesExamined: rows.length,
    totals: Object.fromEntries(VERDICT_ORDER.map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length])),
    rows,
  };
}

/** The text of every opened state of the site model and its language: what a menu, a dialog or a banner shows (WCAG 3.1.2). */
function statesLanguage(run: RunData): Record<string, unknown> {
  if (!run.siteModel) return { examined: false, note: "Deze run heeft geen sitemodel; er zijn geen geopende toestanden." };
  const states = reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.languages);
  if (states.length === 0) return { examined: false, note: "De tekst van de toestanden uit het sitemodel is in deze run niet als eigen onderdeel vastgelegd." };
  // What the pages already show is read there: per state only what is new.
  const onPages = new Set(run.pages.flatMap((page) => [...(page.languages?.textAlternatives ?? []).map((piece) => piece.text), ...page.facts.mainText.split(/\n+/).map((line) => line.trim())]));
  const pageText = run.pages.map((page) => page.facts.mainText).join("\n");
  const seen = new Set<string>();
  return {
    examined: true,
    method: "Elke toestand uit het sitemodel (de cookiemelding, elk geopend menu, venster en paneel, elk doorlopen proces) is geopend en gelezen: de volledige zichtbare tekst staat in `textFile`. Per toestand staan de tekstblokken en de tekstalternatieven en namen die nergens anders voorkwamen (niet op een pagina en niet in een eerdere toestand), met de taal die er in de code voor geldt en wat de twee taalherkenners erin vinden, zoals onder `textAlternativesAndNames`. Wat ook op de pagina's staat, is daar al gelezen.",
    statesExamined: states.length,
    rows: states.map((state) => {
      const found = run.stateEvidence![state.id]!.languages!;
      const fresh = [...(found.textBlocks ?? []), ...found.textAlternatives].filter((piece) => {
        const key = `${piece.kind === "tekst" ? "tekst" : "naam"}|${piece.text}`;
        if (seen.has(key) || onPages.has(piece.text) || (piece.kind === "tekst" && pageText.includes(piece.text))) return false;
        seen.add(key);
        return true;
      });
      return { state: state.id, textFile: state.files.text ?? null, newPieces: fresh.length, pieces: fresh.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict)).slice(0, 80).map(pieceRow) };
    }),
  };
}

export const headings: Extractor = (run) => {
  const pages = run.pages.map((page) => {
    const visible = page.facts.headings.filter((heading) => heading.visible && !heading.ax?.ignored);
    const levels = visible.map((heading) => heading.level ?? 0);
    const skipped: string[] = [];
    levels.forEach((level, index) => {
      const previous = levels[index - 1];
      if (previous !== undefined && level > previous + 1) skipped.push(`h${previous} -> h${level} bij "${visible[index]!.text.slice(0, 50)}"`);
    });
    return {
      page: page.label,
      h1Count: levels.filter((level) => level === 1).length,
      emptyHeadings: visible.filter((heading) => !norm(axName(heading) || heading.text)).length,
      skippedLevels: skipped,
      outline: visible.map((heading) => `${"  ".repeat(Math.max(0, (heading.level ?? 1) - 1))}h${heading.level} ${heading.text.slice(0, 70)}`),
    };
  });
  const structured = run.pages.every((page) => page.facts.structure !== undefined);
  const missing = { examined: false, note: "Deze kandidaten zijn in deze run niet verzameld (de run is ouder dan de meting). Zonder dit onderdeel is niet vastgesteld dat het patroon ontbreekt." };
  const total = run.pages.length;
  const shown = (heading: { level: number | null; text: string }): string => `h${heading.level} ${heading.text.slice(0, 70)}`;
  const candidates = <T extends { path: string[]; text: string }>(pick: (page: PageData) => T[], show: (item: T) => Record<string, unknown>) =>
    group(run, pick, (item) => `${where(item)}|${item.text}`).map((entry) => ({ ...show(entry.example), pages: pagesText(entry.pages, total), where: where(entry.example) }));
  return {
    pagesExamined: pages.length,
    headingsExamined: pages.reduce((sum, page) => sum + page.outline.length, 0),
    pages,
    contentBeforeHeading: structured
      ? {
          examined: true,
          method: "Per zichtbare kop is het blok bepaald waar hij de titel van is: het grootste omringende element waarin geen andere kop staat. Vastgelegd is welke zichtbare tekst binnen dat blok in de code vóór de kop staat, als dat samen niet meer dan 160 tekens is. Een schermlezer die van kop naar kop springt, slaat die tekst over.",
          rows: candidates((page) => page.facts.structure!.beforeHeading, (item) => ({ heading: shown(item), before: item.before, block: item.block.join(" >>> "), region: item.region })),
        }
      : { ...missing, rows: [] },
    candidates: structured
      ? {
          examined: true,
          note: "Kandidaten uit de code van elke pagina, geen bevindingen: een script ziet niet of een vette regel een tussenkop is. Beoordeel elke rij.",
          // One row per section: twenty cards under one heading are one observation.
          cardTitlesAtSectionLevel: group(
            run,
            (page) => {
              const sections = new Map<string, { level: number | null; sectionHeading: string; titles: string[]; path: string[] }>();
              for (const item of page.facts.structure!.cardTitlesAtSectionLevel) {
                const section = sections.get(`${item.level}|${item.sectionHeading}`) ?? { level: item.level, sectionHeading: item.sectionHeading, titles: [], path: item.path };
                sections.set(`${item.level}|${item.sectionHeading}`, section);
                section.titles.push(item.text);
              }
              return [...sections.values()];
            },
            (section) => `${section.level}|${section.sectionHeading}|${section.titles.join("|")}`,
          ).map((entry) => ({ sectionHeading: `h${entry.example.level} ${entry.example.sectionHeading.slice(0, 70)}`, cardTitlesAtThatLevel: entry.example.titles.length, examples: entry.example.titles.slice(0, 4).map((title) => `h${entry.example.level} ${title.slice(0, 60)}`), pages: pagesText(entry.pages, total), firstCardWhere: where(entry.example) })),
          headingsWithoutContent: candidates((page) => page.facts.structure!.headingsWithoutContent, (item) => ({ heading: shown(item), nextHeading: item.nextHeading, linksOrButtonsAfter: item.controlsAfter, textBeforeInSameBlock: item.before, region: item.region })),
          boldLeads: candidates((page) => page.facts.structure!.boldLeads, (item) => ({ tag: item.tag, boldText: item.text, kind: item.kind === "whole-paragraph" ? "hele alinea is vet" : "vette tekst, dan een regeleinde, dan gewone tekst", followedBy: item.followedBy, region: item.region })),
          dashLines: candidates((page) => page.facts.structure!.dashLines, (item) => ({ tag: item.tag, firstLine: item.text, linesStartingWithDash: item.lineCount, lines: item.lines, region: item.region })),
        }
      : missing,
  };
};

export const landmarks: Extractor = (run) => {
  const signature = (page: PageData): string => page.facts.landmarks.map((landmark) => `${landmark.ax?.role ?? landmark.tag}${axName(landmark) ? ` "${axName(landmark)}"` : ""}`).join(" | ");
  return {
    pagesExamined: run.pages.length,
    variants: group(run, (page) => [signature(page)], (value) => value).map((entry) => ({ landmarks: entry.example.split(" | "), pages: pagesText(entry.pages, run.pages.length) })),
    pagesWithoutMain: run.pages.filter((page) => !page.facts.landmarks.some((landmark) => landmark.ax?.role === "main")).map((page) => page.label),
  };
};

type ImageFact = Facts["images"][number];
const imageKey = (image: ImageFact): string => [image.tag, image.ax?.ignored, image.ax?.role, axName(image), image.alt, image.src?.split("/").pop(), image.inInteractive, image.interactiveText, `${image.box.width}x${image.box.height}`].join("|");

/** One image as a reviewer reads it: what assistive technology gets, and which of the situations of 1.1.1 it is in. */
function imageRow(image: ImageFact): Record<string, unknown> {
  const ignored = image.ax?.ignored ?? image.ariaHidden;
  return {
    tag: image.tag,
    size: `${image.box.width}x${image.box.height}`,
    src: image.src?.split("/").pop() ?? null,
    alt: image.alt,
    accessibleName: axName(image) || null,
    hiddenFromAssistiveTech: ignored,
    insideControl: image.inInteractive ? `${image.inInteractive}: "${image.interactiveText}"` : null,
    context: image.context,
    // The three situations a reviewer has to tell apart.
    situation: ignored ? (image.inInteractive && image.interactiveText ? "verborgen, in bedieningselement met eigen tekst" : image.inInteractive ? "verborgen, in bedieningselement ZONDER tekst" : "verborgen, losstaand") : axName(image) ? "heeft toegankelijke naam" : "zichtbaar voor hulpsoftware ZONDER naam",
  };
}

/**
 * The images of every opened state of the site model that are not among the images of the pages:
 * what a menu, a dialog or a panel shows when it is open. Each with the states it was seen in.
 */
function imagesInStates(run: RunData, onPages: Set<string>): Record<string, unknown> {
  if (!run.siteModel) return { examined: false, note: "Deze run heeft geen sitemodel; er zijn geen geopende toestanden." };
  const states = reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.images !== undefined);
  if (states.length === 0) return { examined: false, note: "De afbeeldingen in de toestanden van het sitemodel zijn in deze run niet vastgelegd." };
  const rows = new Map<string, { image: ImageFact; states: string[]; count: number }>();
  const background = new Map<string, { item: Element; states: string[] }>();
  for (const state of states) {
    const evidence = run.stateEvidence![state.id]!;
    for (const image of (evidence.images ?? []).filter((entry) => entry.visible)) {
      if (onPages.has(imageKey(image))) continue;
      const row = rows.get(imageKey(image)) ?? { image, states: [], count: 0 };
      rows.set(imageKey(image), row);
      row.count++;
      if (!row.states.includes(state.id)) row.states.push(state.id);
    }
    for (const item of evidence.backgroundImages ?? []) {
      const key = `${item.backgroundImage}`;
      const row = background.get(key) ?? { item, states: [] };
      background.set(key, row);
      if (!row.states.includes(state.id)) row.states.push(state.id);
    }
  }
  return {
    examined: true,
    method: "In elke toestand uit het sitemodel (elke blokkade, elk geopend onderdeel en elk proces) zijn dezelfde feiten over afbeeldingen vastgelegd als op de pagina's: img, svg, role=img, canvas, object en embed, met wat hulpsoftware ervoor krijgt. Hieronder staan alleen de afbeeldingen die op geen pagina in de begintoestand voorkwamen; `states` zegt waar ze te zien waren. De schermafbeelding en de bestanden van een toestand staan bij die toestand in `siteStates`.",
    statesExamined: states.map((state) => state.id),
    imagesOnlyInStates: [...rows.values()].map((row) => ({ ...imageRow(row.image), occurrences: row.count, states: row.states, where: where(row.image), box: row.image.box })),
    cssBackgroundImages: [...background.values()].map((row) => ({ image: String(row.item.backgroundImage).slice(0, 120), text: row.item.text.slice(0, 60), states: row.states })),
  };
}

type Picture = NonNullable<PageData["pictures"]>["pictures"][number];
const SMALLEST_PICTURE = 16;

/**
 * What text recognition read in each picture of the pages and of the states, one row per picture
 * as it was drawn: the same logo on thirty pages is one row with the pages it is on.
 */
export function textInPictures(run: RunData): Record<string, unknown> {
  const sources: { label: string; report: NonNullable<PageData["pictures"]>; dir: string }[] = [
    ...run.pages.filter((page) => page.pictures).map((page) => ({ label: page.label, report: page.pictures!, dir: page.dir })),
    ...reachedStates(run)
      .filter((state) => run.stateEvidence?.[state.id]?.pictures)
      .map((state) => ({ label: state.id, report: run.stateEvidence![state.id]!.pictures!, dir: "" })),
  ];
  if (sources.length === 0) return { examined: false, note: "De afbeeldingen zijn in deze run niet met tekstherkenning gelezen." };
  const unavailable = sources.find((source) => source.report.unavailableNl)?.report.unavailableNl;
  const rows = new Map<string, { picture: Picture; crop: string | null; seen: Set<string> }>();
  const notRead: { picture: Picture; on: string }[] = [];
  for (const source of sources) {
    for (const picture of source.report.pictures) {
      if (!picture.sha256) {
        if (picture.box.width >= SMALLEST_PICTURE && picture.box.height >= SMALLEST_PICTURE) notRead.push({ picture, on: source.label });
        continue;
      }
      const row = rows.get(picture.sha256) ?? { picture, crop: picture.crop ? (source.dir ? `${source.dir}/${picture.crop}` : picture.crop) : null, seen: new Set<string>() };
      rows.set(picture.sha256, row);
      row.seen.add(source.label);
    }
  }
  const show = (row: { picture: Picture; crop: string | null; seen: Set<string> }): Record<string, unknown> => {
    const read = row.picture.ocr;
    return {
      kind: row.picture.kind,
      src: row.picture.src?.split("/").pop()?.slice(0, 120) ?? null,
      alt: row.picture.alt,
      size: `${row.picture.box.width}x${row.picture.box.height}`,
      ...("notReadNl" in read ? { notReadNl: read.notReadNl } : { hasText: read.hasText, recognisedText: read.text, words: read.words, confidence: read.confidence, ...(read.sparseWords ? { wordsOnlyAsScatteredText: read.sparseWords } : {}) }),
      ...(row.picture.ownText ? { ownTextOfTheElement: row.picture.ownText.slice(0, 120) } : {}),
      crop: row.crop,
      seenOn: [...row.seen].slice(0, 8).join(",") + (row.seen.size > 8 ? ` +${row.seen.size - 8}` : ""),
      where: row.picture.where,
    };
  };
  const all = [...rows.values()];
  const withText = all.filter((row) => !("notReadNl" in row.picture.ocr) && row.picture.ocr.hasText);
  return {
    examined: unavailable === undefined,
    ...(unavailable ? { note: unavailable } : {}),
    method: `Op elke pagina en in elke toestand uit het sitemodel is elke afbeelding van minstens ${SMALLEST_PICTURE} bij ${SMALLEST_PICTURE} pixels uitgesneden zoals ze getekend is: img, svg, role=img, canvas, object, embed en elk element met een achtergrondafbeelding. Elke uitsnede is gelezen met tekstherkenning (Tesseract), twee keer: als regels onder elkaar en als verspreide tekst, zoals \`loep ocr\` doet. Dezelfde afbeelding (dezelfde pixels) is één keer gelezen; \`seenOn\` noemt de pagina's en toestanden waar ze stond. \`hasText\` is waar bij minstens twee woorden die met vertrouwen zijn herkend. Bij een achtergrondafbeelding leest de herkenning ook de echte tekst van het element mee; die staat onder \`ownTextOfTheElement\`. Herkende tekst is een aanwijzing: of het een afbeelding van tekst is, beslist wie de uitsnede (\`crop\`) bekijkt.`,
    picturesRead: all.length,
    picturesWithText: withText.length,
    withText: withText.map(show),
    withoutText: all.filter((row) => !withText.includes(row)).map(show),
    notRead: notRead.slice(0, 20).map(({ picture, on }) => ({ kind: picture.kind, src: picture.src?.split("/").pop()?.slice(0, 120) ?? null, on, reasonNl: "notReadNl" in picture.ocr ? picture.ocr.notReadNl : null })),
    notReadCount: notRead.length,
  };
}

/** Every piece of non-text content and what assistive technology gets for it. */
export const images: Extractor = (run) => {
  const visible = (page: PageData) => page.facts.images.filter((image) => image.visible);
  const grouped = group(run, visible, imageKey);
  const rows = grouped.map((entry) => ({ ...imageRow(entry.example), occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example), firstPage: entry.pages[0], box: entry.example.box }));
  return {
    pagesExamined: run.pages.length,
    imagesExamined: run.pages.reduce((sum, page) => sum + visible(page).length, 0),
    uniqueImages: rows.length,
    cssBackgroundImages: group(run, (page) => page.facts.backgroundImages, (item) => `${item.backgroundImage}`).map((entry) => ({ image: String(entry.example.backgroundImage).slice(0, 120), text: entry.example.text.slice(0, 60), pages: pagesText(entry.pages, run.pages.length) })),
    rows,
    inStates: imagesInStates(run, new Set(grouped.map((entry) => imageKey(entry.example)))),
    textInPictures: textInPictures(run),
  };
};

const GENERIC_LINK = /^(lees meer|meer|klik hier|hier|verder|meer informatie|link|bekijk|download|details|more|read more|click here)$/i;

export const ARIA_LABEL_REPLACES = "aria-label vervangt de zichtbare tekst door iets anders";

/** An aria-label that says something else than the text a sighted user reads in the clickable area. */
export function ariaLabelReplacesText(name: string, ariaLabel: string | null, visibleText: string): boolean {
  const [heard, labelled, seen] = [norm(name), norm(ariaLabel), norm(visibleText)];
  if (!labelled || !seen || heard !== labelled) return false;
  return !heard.includes(seen.slice(0, 60)) && !seen.includes(heard);
}

export const links: Extractor = (run) => {
  const visible = (page: PageData) => page.facts.links.filter((link) => link.visible && !link.ax?.ignored);
  const grouped = group(run, visible, (link) => `${norm(axName(link))}|${link.href}`);
  const byName = new Map<string, Set<string>>();
  for (const entry of grouped) byName.set(norm(axName(entry.example)), new Set([...(byName.get(norm(axName(entry.example))) ?? []), entry.example.href ?? ""]));
  // Older runs recorded the text of the parent element as `sentence`, whatever that parent was.
  const scoped = run.pages.every((page) => page.facts.links.every((link) => link.sentenceFrom !== undefined));
  const rows = grouped.map((entry) => {
    const link = entry.example;
    const name = axName(link);
    // What a sighted user reads in the clickable area: the link's own text, or the card it is stretched over.
    const visibleText = link.text || link.coveredText || "";
    const flags = [
      !norm(name) ? "geen toegankelijke naam" : null,
      GENERIC_LINK.test(name.trim()) ? "algemene linktekst" : null,
      (byName.get(norm(name))?.size ?? 0) > 1 ? "zelfde naam, verschillende bestemming" : null,
      ariaLabelReplacesText(name, link.ariaLabel, visibleText) ? ARIA_LABEL_REPLACES : null,
      link.target === "_blank" ? "opent nieuw venster" : null,
    ].filter(Boolean);
    // A sentence that only repeats the link says nothing more than the link does.
    const sentence = link.sentence && norm(link.sentence) !== norm(link.text) && norm(link.sentence) !== norm(name) ? link.sentence : null;
    const detail = flags.length
      ? {
          sentence,
          sentenceFrom: scoped ? (link.sentenceFrom ?? null) : "ouderelement (niet beperkt tot zin of lijstregel)",
          parent: link.parentTag ?? undefined,
          contextFrom: link.contextFrom === "block" ? "kop van hetzelfde blok; de link staat in de code vóór die kop" : link.contextFrom === "preceding" ? "voorafgaande kop" : undefined,
          visibleText: visibleText.slice(0, 120) || null,
        }
      : {};
    return { name, href: link.href, region: link.region, context: link.context, ...detail, flags, occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), where: flags.length ? where(link) : undefined };
  });
  return {
    sentenceScope: scoped
      ? "`sentence` is de tekst van het dichtstbijzijnde element p, li, td, th, dd of figcaption om de link (zie `sentenceFrom`), en is leeg als de link niet in zo'n element staat of als dat element niets anders bevat dan de link zelf. `parent` is dan het soort ouderelement."
      : "Oudere run: `sentence` is de tekst van het ouderelement van de link, wat dat ook is (een hele kaart of kolom kan). Het telt niet als zin, alinea, lijstregel of tabelcel.",
    sentenceIsSentence: scoped,
    pagesExamined: run.pages.length,
    linksExamined: run.pages.reduce((sum, page) => sum + visible(page).length, 0),
    uniqueLinks: rows.length,
    flagged: rows.filter((row) => row.flags.length > 0),
    unflagged: rows.filter((row) => row.flags.length === 0).map((row) => `${row.name} -> ${row.href}`),
  };
};

const PERSONAL = /(naam|name|e-?mail|telefoon|phone|tel\b|adres|address|postcode|woonplaats|geboorte|birth|straat|huisnummer|voornaam|achternaam|organisatie|bedrijf)/i;

/** Buttons, form fields and other controls: role, name, label and state as assistive technology gets them. */
export const HIDDEN_INPUT = "invoer verborgen, label zichtbaar";

const hexColour = (colour: number[]): string => `#${colour.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`;

const SIGNALS_NL: Record<string, string> = { "click-listener": "klik-listener", onclick: "onclick-attribuut", "cursor: pointer": "cursor: pointer", "a-without-href": "a zonder href" };

const VIEWPORT_PROBES = [
  ["reflow", "320x256"],
  ["zoom200", "640x400"],
  ["portrait", "800x1280"],
] as const;

/** Paths of everything that got keyboard focus on a page: by itself on load, with Tab, or with the arrow keys. */
export function reachedByKeyboard(page: PageData): Set<string> {
  return new Set([...(page.tabwalk.initialFocus ? [where(page.tabwalk.initialFocus)] : []), ...page.tabwalk.stops.map((stop) => where(stop)), ...(page.tabwalk.arrowReach ?? []).flatMap((entry) => entry.reached.map((item) => item.where))]);
}

/** Elements that respond to a click without being a control, at the standard width and at the narrower ones. */
function clickableNotFocusable(run: RunData): Record<string, unknown> {
  if (!run.pages.every((page) => page.facts.clickables !== undefined)) {
    return { examined: false, note: "Klikbare elementen die geen standaardelement zijn (een div met een klik-handler, een a zonder href), zijn in deze run niet verzameld. Dat de lijst leeg is, zegt dus niets.", rows: [] };
  }
  const perPage = (page: PageData) => {
    const reached = reachedByKeyboard(page);
    const seen = new Map<string, Clickable & { seenAt: string[]; tabStop: boolean }>();
    const add = (items: Clickable[] | undefined, viewport: string): void => {
      for (const item of items ?? []) {
        const existing = seen.get(where(item));
        if (existing) existing.seenAt.push(viewport);
        else seen.set(where(item), { ...item, seenAt: [viewport], tabStop: reached.has(where(item)) });
      }
    };
    add(page.facts.clickables, "1280x800");
    for (const [probe, viewport] of VIEWPORT_PROBES) add(page[probe].clickables, viewport);
    return [...seen.values()];
  };
  const rows = group(run, perPage, (item) => [item.tag, item.text.slice(0, 40), item.html, item.region, item.seenAt.join(","), item.tabStop].join("|")).map((entry) => {
    const item = entry.example;
    return {
      tag: item.tag,
      html: item.html,
      visibleText: item.text.slice(0, 80) || null,
      role: item.ax?.role ?? null,
      accessibleName: axName(item) || null,
      hiddenFromAssistiveTech: item.ax?.ignored ?? null,
      tabindex: item.tabindex,
      focusable: item.ax?.properties.focusable === true || item.focusable,
      tabStop: item.tabStop,
      clickableBecause: item.signals.map((signal) => SIGNALS_NL[signal] ?? `attribuut ${signal}`),
      seenAt: item.seenAt,
      region: item.region,
      occurrences: entry.count,
      pages: pagesText(entry.pages, run.pages.length),
      where: where(item),
      firstPage: entry.pages[0],
      box: item.box,
    };
  });
  return {
    examined: true,
    method: "Op elke pagina is elk zichtbaar element verzameld dat op een klik reageert zonder een bedieningselement te zijn: het heeft een klik-listener, een onclick-attribuut, een attribuut als data-toggle of een handje als muisaanwijzer, of het is een a zonder href. Niet meegenomen zijn echte bedieningselementen (a met href, button, invoervelden, elementen met een bedieningsrol of tabindex), wat daarbinnen staat, en omhulsels om een echt bedieningselement. `role` en `accessibleName` komen uit de toegankelijkheidsboom. `tabStop` zegt of de Tab-proef of de pijltjestoetsen het element bereikten (gemeten op 1280 pixels breed). `seenAt` noemt de vensterafmetingen waarop het element zichtbaar was; op de smallere afmetingen is niet met Tab gelopen, daar zegt `focusable` of het element focus kan krijgen. Een handler die op een omringend element of op het document is gezet, is alleen via het attribuut of de muisaanwijzer herkend.",
    elementsExamined: run.pages.reduce((sum, page) => sum + perPage(page).length, 0),
    uniqueElements: rows.length,
    rows,
  };
}

/**
 * Controls that are on screen at none of the widths every page is measured at (1280, 360, 320)
 * and at a width between them, with the page measured at such a width and what each opened.
 */
export function betweenWidthsTable(run: RunData): Record<string, unknown> {
  const measured = run.pages.filter((page) => page.widths !== undefined);
  if (measured.length === 0) return { examined: false, note: "In deze run is niet gezocht naar bedieningselementen die alleen op een breedte tussen de gemeten breedtes verschijnen." };
  type Between = NonNullable<PageData["widths"]>;
  const rows = group({ ...run, pages: measured }, (page) => page.widths!.controls.map((control) => ({ ...control, page })), (control) => `${control.control}|${control.where}`).map((entry) => {
    const control = entry.example as Between["controls"][number] & { page: PageData };
    const at = control.page.widths!.measuredAt.find((width) => control.shownAt.includes(width.width));
    const opened = at?.opened.find((row) => row.where === control.where);
    return {
      control: control.control,
      role: control.role,
      accessibleName: control.name,
      onlyPictogram: control.iconOnly,
      shownAtWidths: control.shownAt,
      measuredAtWidth: at?.width ?? null,
      pageScreenshot: at ? `${control.page.dir}/${at.screenshot}` : null,
      controlScreenshot: control.screenshot ? `${control.page.dir}/${control.screenshot}` : null,
      ...(opened ? { opened: { controls: opened.controls, text: opened.text, addedToAccessibilityTree: opened.tree, screenshot: opened.screenshot ? `${control.page.dir}/${opened.screenshot}` : null, ...(opened.failedNl ? { failedNl: opened.failedNl } : {}) } } : { opened: "niet geopend: geen knop of uitklapper, of de grens van vier per breedte was bereikt" }),
      pages: pagesText(entry.pages, measured.length),
      where: control.where,
    };
  });
  return {
    examined: true,
    method: "Elke pagina is na het laden opnieuw opgemaakt op een reeks breedtes tussen 1280 en 320 pixels: elke 80 pixels, en aan beide kanten van elke breedte die de stijlregels van de pagina noemen (media- en containerquery's, ook in shadow roots). Per breedte zijn de bedieningselementen vastgelegd die in beeld waren. Hieronder staan de elementen die op geen van de gemeten breedtes (1280, 360 en 320) in beeld waren en op een breedte daartussen wel, zoals een knop 'Meer opties' die een kop alleen op een middelgrote breedte toont. Op de breedte die er de meeste toont, is de pagina vastgelegd (`pageScreenshot`), staat van elk element de rol en de naam voor hulpsoftware en een uitsnede, en is elke knop of uitklapper geopend: `opened` noemt de links en knoppen die verschenen, de nieuwe tekst en het deel van de toegankelijkheidsboom dat erbij kwam (`addedToAccessibilityTree`). Is de lijst leeg, dan toont geen breedte daartussen iets wat de gemeten breedtes niet tonen.",
    pagesExamined: measured.length,
    pagesNotLaidOut: measured.filter((page) => page.widths!.failedNl).map((page) => ({ page: page.label, reasonNl: page.widths!.failedNl })),
    widthsTried: [...new Set(measured.flatMap((page) => page.widths!.widthsTried))].sort((a, b) => b - a).length,
    controls: rows,
  };
}

export const controls: Extractor = (run) => {
  // An input that is not rendered, with a label that is, is a rebuilt control: on screen, but not operable.
  const rebuilt = (control: PageData["facts"]["controls"][number]): boolean => Boolean(control.hiddenBy) && control.labelVisible === true;
  const visible = (page: PageData) => page.facts.controls.filter((control) => control.visible || rebuilt(control));
  const rows = group(run, visible, (control) => [control.tag, control.type, control.ax?.role, axName(control), control.text.slice(0, 60), control.region, control.autocomplete, rebuilt(control) ? control.labelText : ""].join("|")).map((entry) => {
    const control = entry.example;
    const name = axName(control);
    const visibleText = control.text || control.placeholder || "";
    const isField = ["input", "select", "textarea"].includes(control.tag) || ["textbox", "combobox", "listbox", "searchbox", "spinbutton"].includes(control.ax?.role ?? "");
    const personal = isField && PERSONAL.test(`${name} ${control.labelText ?? ""} ${control.name ?? ""} ${control.type ?? ""}`);
    const flags = [
      control.ax?.ignored ? "zichtbaar maar verborgen voor hulpsoftware" : null,
      !control.ax?.ignored && !norm(name) ? "geen toegankelijke naam" : null,
      !control.ax?.ignored && ["none", "generic", "presentation", null].includes(control.ax?.role ?? null) ? "geen rol" : null,
      norm(name) && norm(visibleText) && !norm(name).includes(norm(visibleText).slice(0, 40)) && control.tag !== "input" ? "zichtbare tekst zit niet in toegankelijke naam" : null,
      personal && !control.autocomplete ? "persoonsgegeven zonder autocomplete" : null,
      rebuilt(control) ? HIDDEN_INPUT : null,
    ].filter(Boolean);
    const behind = (control.labelBackground ?? [255, 255, 255, 1]).slice(0, 3) as Rgb;
    const hiddenInput = rebuilt(control)
      ? {
          hiddenBy: control.hiddenBy,
          consequence: "Een invoerveld dat niet wordt weergegeven, kan geen focus krijgen en staat niet in de toegankelijkheidsboom. Het zichtbare vakje is opmaak van het label.",
          // The box a user sees, with the contrast of its border against what the label is painted on.
          drawnBox: (control.drawnBox ?? []).map((drawn) => ({
            pseudo: drawn.pseudo,
            size: `${drawn.width} x ${drawn.height}`,
            border: Number.parseFloat(drawn.borderWidth) > 0 && drawn.borderStyle !== "none" ? `${drawn.borderStyle} ${drawn.borderWidth} ${hexColour(drawn.borderColour)}` : "geen",
            fill: drawn.background[3] > 0 ? hexColour(drawn.background) : "doorzichtig",
            against: hexColour(behind),
            borderRatio: Number.parseFloat(drawn.borderWidth) > 0 && drawn.borderStyle !== "none" && drawn.borderColour[3] > 0 ? floorRatio(contrastRatio(drawn.borderColour.slice(0, 3) as Rgb, behind)) : null,
            fillRatio: drawn.background[3] > 0 ? floorRatio(contrastRatio(drawn.background.slice(0, 3) as Rgb, behind)) : null,
          })),
        }
      : undefined;
    return { hiddenInput, tag: control.tag, type: control.type, role: control.ax?.role ?? null, accessibleName: name || null, visibleText: visibleText.slice(0, 80) || null, label: control.labelText || null, description: control.ax?.description || null, required: control.required || undefined, autocomplete: control.autocomplete, states: control.ax?.properties, region: control.region, inForm: control.inForm || undefined, isField, flags, occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), where: where(control) };
  });
  return {
    pagesExamined: run.pages.length,
    controlsExamined: run.pages.reduce((sum, page) => sum + visible(page).length, 0),
    uniqueControls: rows.length,
    formFields: rows.filter((row) => row.isField),
    flagged: rows.filter((row) => row.flags.length > 0),
    hiddenInputsExamined: run.pages.every((page) => page.facts.controls.every((control) => !["input", "select", "textarea"].includes(control.tag) || control.hiddenBy !== undefined)),
    clickableNotFocusable: clickableNotFocusable(run),
    onlyBetweenMeasuredWidths: betweenWidthsTable(run),
    rows: rows.map(({ where: _where, states: _states, hiddenInput: _hiddenInput, ...row }) => row),
  };
};

/** Links and controls that a keyboard user should be able to reach with Tab or the arrow keys. */
export function expectedFocusable(page: PageData): (PageData["facts"]["links"][number] | PageData["facts"]["controls"][number])[] {
  return [...page.facts.links, ...page.facts.controls].filter((element) => element.visible && !element.ax?.ignored && element.ax?.properties.focusable === true && !(element as { disabled?: boolean }).disabled && (element as { tabindex?: string | null }).tabindex !== "-1");
}

/** Share of pixels that must change before focus counts as visibly indicated. */
export const FOCUS_VISIBLE_THRESHOLD = 0.005;

/** The Tab walk in the narrow window, laid next to the links and controls that are there. */
function narrowWalk(run: RunData): Record<string, unknown> {
  const walked = run.pages.filter((page) => page.tabwalkNarrow);
  if (walked.length === 0) return { examined: false, note: "In deze run is niet met Tab gelopen in het smalle venster." };
  const compared = walked.filter((page) => page.narrow !== undefined);
  const unreached = (page: PageData) => {
    const stops = new Set(page.tabwalkNarrow!.stops.map((stop) => where(stop)));
    // The arrow keys were pressed in the default window only: what they reached there counts as reachable here.
    const byArrows = new Set((page.tabwalk.arrowReach ?? []).flatMap((entry) => entry.reached.map((item) => item.where)));
    return expectedFocusable({ facts: page.narrow } as unknown as PageData).filter((element) => !stops.has(where(element)) && !byArrows.has(where(element)));
  };
  return {
    examined: true,
    method: "Elke pagina is ook in een venster van 360 pixels breed van begin tot eind met de Tab-toets doorlopen, tot de focus het document verliet. De stops zijn gelegd naast de links en bedieningselementen die in dat venster zichtbaar zijn en volgens de toegankelijkheidsboom focus kunnen krijgen (`focusableElements`); `notReachedByTab` telt wat de loop niet bereikte. De pijltjestoetsen zijn alleen in het standaardvenster ingedrukt; wat daar met de pijltjes is bereikt, telt hier als bereikbaar. Wat achter een knop zit, zoals een menu, is hier dicht; geopend staat het bij de toestanden uit het sitemodel.",
    pagesWalked: walked.length,
    pagesCompared: compared.length,
    pages: walked.map((page) => ({ page: page.label, walk: page.tabwalkNarrow!.outcome, stops: page.tabwalkNarrow!.stopCount, ...(page.narrow ? { focusableElements: expectedFocusable({ facts: page.narrow } as unknown as PageData).length, notReachedByTab: unreached(page).length } : { compared: false }), orderScreenshot: `${page.dir}/probes/tabwalk-narrow.png` })),
    trapped: walked.filter((page) => page.tabwalkNarrow!.outcome === "trapped").map((page) => ({ page: page.label, at: where(page.tabwalkNarrow!.stops.at(-1)!) })),
    notReachedByTab: group({ ...run, pages: compared }, unreached, (element) => `${element.tag}|${axName(element)}|${element.region}`).map((entry) => ({ tag: entry.example.tag, role: entry.example.ax?.role, name: axName(entry.example), region: entry.example.region, occurrences: entry.count, pages: pagesText(entry.pages, compared.length), where: where(entry.example) })),
  };
}

/**
 * Focus in every opened state of the site model (a dialog, a side menu, a menu): forward with Tab,
 * back with Shift+Tab and along with the arrow keys, with what lay over the middle of each stop (WCAG 2.4.11).
 */
function focusInStates(run: RunData): Record<string, unknown> {
  if (!run.siteModel) return { examined: false, note: "Deze run heeft geen sitemodel; er zijn geen geopende toestanden." };
  const states = reachedStates(run);
  const withWalks = states.filter((state) => run.stateEvidence?.[state.id]?.focusCovered !== undefined);
  const rows = states.map((state) => {
    const evidence = run.stateEvidence?.[state.id];
    const forward = evidence?.tabwalk;
    const walks = evidence?.focusCovered?.walks;
    const covered = [
      ...(forward?.stops ?? []).filter((stop) => stop.coveredBy).map((stop) => ({ key: "Tab", tag: stop.tag, text: stop.text.slice(0, 60), coveredBy: stop.coveredBy!.join(" >>> "), screenshot: stop.focusScreenshot ?? null, where: where(stop) })),
      ...(walks ?? []).flatMap((walk) => walk.stops.filter((stop) => stop.coveredBy).map((stop) => ({ key: walk.key, tag: stop.tag, text: stop.text, coveredBy: stop.coveredBy!, screenshot: stop.screenshot ?? null, where: stop.where }))),
    ];
    return {
      state: state.id,
      viewport: state.viewport ? `${state.viewport.width}x${state.viewport.height}` : null,
      forward: forward ? { outcome: forward.outcome, stops: forward.stopCount } : "niet gemeten",
      backAndArrows: walks ? walks.map((walk) => ({ key: walk.key, from: walk.from, outcome: walk.outcome, stops: walk.stops.length })) : "niet gemeten",
      stillOpenAfterwards: evidence?.focusCovered?.stateStillReachedAfterwards ?? null,
      stopsWithSomethingOverTheMiddle: covered,
    };
  });
  return {
    examined: withWalks.length > 0,
    method: "Elke toestand uit het sitemodel is geopend zoals het recept dat doet. Vanaf de plek waar de focus daarna stond, is met Tab vooruit gelopen (`forward`, met uitsneden), en in een tweede opening met Shift+Tab terug en met de pijltjestoetsen omlaag en omhoog; met de pijltjes ook vanaf de eerste items van een menu, lijst of rij tabbladen die de terugloop tegenkwam (`backAndArrows`). Bij elke stop is gemeten welk element er op het middelpunt van het element met focus ligt, zoals op de pagina's. `stopsWithSomethingOverTheMiddle` noemt elke stop waar dat een ander element was, met de toets, het bedekkende element en een uitsnede. Een lege lijst betekent: bij geen enkele stop lag iets anders over het midden. Chromium schuift een element bij focus naar het midden van het venster.",
    statesExamined: withWalks.length,
    statesNotWalkedBackward: states.filter((state) => !withWalks.includes(state)).map((state) => ({ state: state.id, reasonNl: state.variantsNotReached?.find((entry) => entry.variant === "focusCovered")?.reasonNl ?? "in deze run niet gemeten" })),
    rows,
  };
}

/**
 * The other addresses of the pages of the sample that lead to an anchor, such as `/vragen` to
 * `/verklaring#vragen`, with what the inventory found where they land (WCAG 2.4.11). Only a target
 * that took focus can fail 2.4.11; a missing anchor or a target under a fixed header without focus
 * is no requirement of WCAG.
 */
function anchorRedirects(run: RunData): Record<string, unknown> {
  const inventoried = new Map((run.inventory.pages ?? []).map((page) => [page.url, page]));
  const rows = run.pages.flatMap((page) =>
    (page.item.aliases ?? []).flatMap((address) => {
      const landed = inventoried.get(address);
      return landed?.anchor ? [{ page: page.label, address, landsOn: landed.finalUrl, anchorFound: landed.anchor.found, focused: landed.anchor.focused, inViewport: landed.anchor.inViewport, coveredBy: landed.anchor.coveredBy }] : [];
    }),
  );
  // An inventory from before this measurement has the landing address without what was found there.
  const examined = (run.inventory.pages ?? []).every((page) => page.anchor !== undefined || page.finalUrl === undefined || !page.finalUrl.includes("#"));
  return {
    examined,
    method: "Elk adres dat de inventaris bezocht en waar de browser uitkwam op een anker, is geladen op 1280 bij 800, zonder blokkades weg te klikken. Vastgelegd is of het anker bestaat, of het doel daarna de focus heeft (Chromium geeft een doel focus als het focus kan krijgen: een link, een veld, een element met tabindex), en zo ja of het in beeld staat en wat er over het midden ligt.",
    rows,
  };
}

export const keyboard: Extractor = (run, criterion) => {
  const perPage = run.pages.map((page) => {
    const reached = reachedByKeyboard(page);
    const expected = expectedFocusable(page);
    const unreached = expected.filter((element) => !reached.has(where(element)));
    let backwardJumps = 0;
    page.tabwalk.stops.forEach((stop, index) => {
      const previous = page.tabwalk.stops[index - 1];
      if (previous && stop.box.y + stop.box.height < previous.box.y - 150) backwardJumps++;
    });
    return { page, expected: expected.length, unreached, backwardJumps };
  });
  const stops = (page: PageData) => page.tabwalk.stops;
  const describeStop = (entry: Group<PageData["tabwalk"]["stops"][number]>) => ({ tag: entry.example.tag, name: axName(entry.example) || entry.example.text.slice(0, 60), region: entry.example.region, pixelShare: entry.example.focusPixelShare, outline: entry.example.outline, indicatorColour: entry.example.indicatorColour ?? null, indicatorOver: entry.example.indicatorOver ?? null, indicatorRatio: entry.example.indicatorRatio ?? null, screenshot: entry.example.focusScreenshot ? `${run.pages.find((page) => page.label === entry.pages[0])!.dir}/${entry.example.focusScreenshot}` : null, occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) });
  const key = (stop: PageData["tabwalk"]["stops"][number]): string => `${stop.tag}|${stop.text.slice(0, 40)}|${stop.region}`;
  return {
    pagesExamined: run.pages.length,
    tabStopsExamined: run.pages.reduce((sum, page) => sum + page.tabwalk.stopCount, 0),
    method: "Elke pagina is met de Tab-toets doorlopen tot de focus het document verliet. Per stop is een schermafbeelding met en zonder focus vergeleken. Vanaf elke Tab-stop zijn daarna de pijltjestoetsen ingedrukt; elementen die zo focus kregen tellen als bereikt.",
    focusVisibleThreshold: FOCUS_VISIBLE_THRESHOLD,
    pages: perPage.map(({ page, expected, unreached, backwardJumps }) => ({ page: page.label, walk: page.tabwalk.outcome, stops: page.tabwalk.stopCount, focusableElements: expected, notReachedByTab: unreached.length, backwardJumps, orderScreenshot: `${page.dir}/probes/tabwalk.png` })),
    reachedWithArrowKeys: group(run, (page) => (page.tabwalk.arrowReach ?? []).map((entry) => ({ ...entry, count: entry.reached.length })), (entry) => `${entry.from}|${entry.key}|${entry.count}`).map((entry) => ({ fromTabStop: entry.example.from, key: entry.example.key, elementsReached: entry.example.count, examples: entry.example.reached.slice(0, 3).map((item) => `${item.tag} "${item.text}"`), pages: pagesText(entry.pages, run.pages.length) })),
    arrowKeysExamined: run.pages.every((page) => page.tabwalk.arrowReach !== undefined),
    trapped: perPage.filter(({ page }) => page.tabwalk.outcome === "trapped").map(({ page }) => ({ page: page.label, at: where(page.tabwalk.stops.at(-1)!) })),
    notReachedByTab: group(run, (page) => perPage.find((entry) => entry.page === page)!.unreached, (element) => `${element.tag}|${axName(element)}|${element.region}`).map((entry) => ({ tag: entry.example.tag, role: entry.example.ax?.role, name: axName(entry.example), region: entry.example.region, occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) })),
    // Only where the clip showed the element itself: an element that is not painted has nothing to compare.
    noVisibleFocusChange: group(run, (page) => stops(page).filter((stop) => stop.focusPixelShare !== null && stop.focusPixelShare < FOCUS_VISIBLE_THRESHOLD && stop.visible && stop.clipVerified !== false), key).map(describeStop),
    focusOnElementThatIsNotVisible: group(run, (page) => stops(page).filter((stop) => !stop.visible && stop.inViewport), key).map(describeStop),
    focusNotMeasured: group(run, (page) => stops(page).filter((stop) => stop.visible && stop.clipVerified === false), key).map((entry) => ({ ...describeStop(entry), reason: entry.example.focusNotMeasured ?? null })),
    clipVerificationExamined: run.pages.every((page) => page.tabwalk.stops.every((stop) => stop.focusPixelShare === null || stop.clipVerified !== undefined)),
    focusOutsideViewport: group(run, (page) => stops(page).filter((stop) => !stop.inViewport), key).map(describeStop),
    focusCoveredByOtherContent: group(run, (page) => stops(page).filter((stop) => stop.coveredBy !== null), key).map((entry) => ({ ...describeStop(entry), coveredBy: entry.example.coveredBy?.join(" >>> ") })),
    focusIndicatorSamples: group(run, (page) => stops(page).filter((stop) => stop.focusPixelShare !== null), (stop) => `${stop.tag}|${stop.region}|${stop.outline}`).slice(0, 24).map(describeStop),
    scrollRegionsWithoutKeyboardAccess: group(run, (page) => page.scrollRegions.filter((region) => !region.selfFocusable && !region.focusableInside), (region) => where(region)).map((entry) => ({ where: where(entry.example), text: entry.example.text.slice(0, 80), pages: pagesText(entry.pages, run.pages.length) })),
    // Only when a walk went through an embedded frame: the frame is one Tab stop of the page, these are the places inside it.
    ...(run.pages.some((page) => stops(page).some((stop) => stop.frameStops))
      ? { stopsInsideFrames: run.pages.flatMap((page) => stops(page).filter((stop) => stop.frameStops).map((stop) => ({ page: page.label, frame: where(stop), frameAddress: stop.frameStops![0]!.frameUrl.split("?")[0], stopsInside: stop.frameStops!.length, examples: stop.frameStops!.slice(0, 5).map((inner) => `${inner.tag} "${inner.text.slice(0, 40)}"`) }))) }
      : {}),
    // Only when it happened: an element that throws focus away when it gets it. A keyboard user is stuck there; the walk went on behind it to see the rest.
    ...(run.pages.some((page) => (page.tabwalk.focusThrownAwayBy ?? []).length > 0)
      ? { focusThrownAwayBy: group(run, (page) => page.tabwalk.focusThrownAwayBy ?? [], (entry) => `${entry.tag}|${entry.text}`).map((entry) => ({ tag: entry.example.tag, text: entry.example.text, where: entry.example.where, pages: pagesText(entry.pages, run.pages.length), note: "De stops daarna (reachedAfterFocusLoss) zijn bereikt doordat de proef de focus zelf verder zette; met de Tab-toets komt een gebruiker daar niet." })) }
      : {}),
    narrow: narrowWalk(run),
    states: focusInStates(run),
    ...(criterion === "2.4.11" ? { anchorRedirects: anchorRedirects(run) } : {}),
    firstStops: run.pages.slice(0, 3).map((page) => ({ page: page.label, order: page.tabwalk.stops.slice(0, 40).map((stop) => `${stop.index + 1}. ${stop.ax?.role ?? stop.tag} "${(axName(stop) || stop.text).slice(0, 40)}" [${stop.region ?? "-"}]`) })),
  };
};

/**
 * What holds an element that sticks out of the window, and whether a user can get to it
 * by scrolling that container. Nothing when the run did not record it.
 */
export function scrollContainer(container: PageData["reflow"]["offenders"][number]["overflowContainer"]): Record<string, unknown> {
  if (container === undefined) return {};
  if (container === null) return { scrollContainer: null, reachableByScrolling: "geen omringend element kapt af of schuift: de pagina zelf schuift opzij" };
  const scrolls = container.overflowX === "auto" || container.overflowX === "scroll";
  return {
    scrollContainer: { tag: container.tag, overflowX: container.overflowX, contentWidth: container.scrollWidth, visibleWidth: container.clientWidth, where: container.path.join(" >>> ") },
    reachableByScrolling: scrolls
      ? `ja: het omringende element schuift zelf opzij (overflow-x: ${container.overflowX}), de inhoud is ${container.scrollWidth} pixels breed in een vak van ${container.clientWidth}`
      : `nee: het omringende element kapt af (overflow-x: ${container.overflowX}); de inhoud is alleen te bereiken als de pagina er knoppen of een sleepbeweging voor biedt`,
  };
}

/** What is in `wide` and not in `sized`, counted: a heading that stands twice and is left once is lost once. */
function lostFrom(wide: string[], sized: string[], same: (item: string) => string = (item) => item): string[] {
  const left = new Map<string, number>();
  for (const item of sized) left.set(same(item), (left.get(same(item)) ?? 0) + 1);
  return wide.filter((item) => {
    const count = left.get(same(item)) ?? 0;
    if (count > 0) left.set(same(item), count - 1);
    return count === 0;
  });
}

/** Digits do not count when content is compared: a clock or a countdown reads differently on every load and is still the same text. */
const WITHOUT_DIGITS = (item: string): string => item.replace(/\d+/g, "#");

/** Headings, images and blocks of text of the default window that are not visible at another size, per page. */
function contentCompared(run: RunData, name: "reflow" | "zoom200" | "portrait"): Record<string, unknown> {
  const compared = run.pages.filter((page) => page.content && page[name].content);
  if (compared.length === 0) return { examined: false, note: "De inhoud bij deze afmeting is in deze run niet vergeleken met de inhoud in het standaardvenster." };
  const lost = (kind: "headings" | "images" | "textBlocks") => (page: PageData) => lostFrom(page.content![kind], page[name].content![kind], WITHOUT_DIGITS);
  const rows = (kind: "headings" | "images" | "textBlocks") => group({ ...run, pages: compared }, lost(kind), (item) => item).map((entry) => ({ [kind === "images" ? "image" : "text"]: entry.example, pages: pagesText(entry.pages, compared.length) }));
  const withLoss = compared.filter((page) => (["headings", "images", "textBlocks"] as const).some((kind) => lost(kind)(page).length > 0));
  return {
    examined: true,
    method: "Op elke pagina zijn de zichtbare koppen, afbeeldingen en tekstblokken (alinea's, lijstpunten, cellen, labels) in het standaardvenster van 1280 bij 800 vastgelegd met hun eigen woorden, en opnieuw bij deze afmeting op een vers geladen pagina. Hieronder staat wat in het standaardvenster zichtbaar was en bij deze afmeting niet. Een afbeelding staat er met haar tekstalternatief of bestandsnaam. Cijfers tellen bij het vergelijken niet mee, zodat een klok of een aftelling niet als verschil telt. Tekst die bij deze afmeting in een andere vorm terugkomt, zoals een tabel die een lijst wordt, en inhoud die bij elke lading wisselt, zoals een carrousel, staat hier als verdwenen: bekijk de schermafbeelding. Wat achter een knop is gezet, zoals een menu, is hier ook niet zichtbaar.",
    pagesCompared: compared.length,
    pagesWithoutDifference: compared.length - withLoss.length,
    pagesWithDifference: withLoss.map((page) => page.label),
    counted: { headings: compared.reduce((sum, page) => sum + page.content!.headings.length, 0), images: compared.reduce((sum, page) => sum + page.content!.images.length, 0), textBlocks: compared.reduce((sum, page) => sum + page.content!.textBlocks.length, 0) },
    headingsNotVisibleAtThisSize: rows("headings"),
    imagesNotVisibleAtThisSize: rows("images"),
    textBlocksNotVisibleAtThisSize: rows("textBlocks"),
  };
}

/** Content that is drawn a quarter turn, in the landscape window and in the portrait one, and stylesheets with rules for one orientation. */
function rotation(run: RunData): Record<string, unknown> {
  const measured = run.pages.filter((page) => page.content && page.portrait.content);
  if (measured.length === 0) return { examined: false, note: "Of inhoud een kwartslag gedraaid wordt getoond, is in deze run niet gemeten." };
  const turned = (select: (page: PageData) => ContentInventory) => group({ ...run, pages: measured }, (page) => select(page).rotatedQuarterTurn as unknown as (Element & { angle: number })[], (element) => where(element)).map((entry) => ({ tag: String(entry.example.tag), text: String(entry.example.text ?? "").slice(0, 60), angle: entry.example.angle, pages: pagesText(entry.pages, measured.length), where: where(entry.example) }));
  return {
    examined: true,
    method: "Op elke pagina is in het liggende standaardvenster (1280 bij 800) en in het staande venster (800 bij 1280) gezocht naar zichtbare elementen die met opmaak een kwartslag zijn gedraaid en minstens een tiende van het venster beslaan. Daarnaast zijn de stijlregels geteld die alleen in één stand gelden (`pagesWithOrientationRules`); zo'n regel is op zichzelf geen fout, maar is de plek waar een site een stand kan afdwingen.",
    pagesExamined: measured.length,
    rotatedInLandscape: turned((page) => page.content!),
    rotatedInPortrait: turned((page) => page.portrait.content!),
    pagesWithOrientationRules: measured.filter((page) => page.content!.orientationRules > 0 || page.portrait.content!.orientationRules > 0).map((page) => page.label),
  };
}

type Instance = NonNullable<Captured["perPageType"]>[number];

/** Each component of the model opened on one page of every page type it stands on, in a portrait window. */
function componentsPerPageType(run: RunData): Record<string, unknown> {
  const components = reachedStates(run).filter((state) => state.kind === "component");
  if (!run.siteModel || components.length === 0) return { examined: false, note: "Deze run heeft geen onderdelen uit een sitemodel om per paginatype te openen." };
  if (components.every((state) => state.perPageType === undefined)) return { examined: false, note: "In deze run zijn de onderdelen niet per paginatype geopend." };
  const labelOf = (url: string): string | null => run.pages.find((page) => page.item.url === url)?.label ?? null;
  return {
    examined: true,
    method: "Elk onderdeel uit het sitemodel is met zijn recept geopend op één pagina van elk paginatype waarop het staat, in een staand venster: een onderdeel van de smalle weergave in zijn eigen smalle venster, een ander onderdeel in een venster van 800 bij 1280. Per paginatype staat of het openging (`reached`), welke links en knoppen het opende in de volgorde van de code (`opened`), een schermafbeelding, en hoeveel inhoud een kwartslag gedraaid stond. Ging het op een paginatype niet open, dan staat de reden erbij; dat kan ook betekenen dat het recept van een andere pagina hier het element niet terugvond.",
    components: components.map((state) => {
      const rows: Instance[] = state.perPageType ?? [];
      return {
        state: state.id,
        viewport: rows[0] ? `${rows[0].viewport.width}x${rows[0].viewport.height}` : null,
        pageTypes: rows.length,
        openedOn: rows.filter((row) => row.reached).length,
        notOpenedOn: rows.filter((row) => !row.reached).map((row) => ({ pageType: row.pageType, page: labelOf(row.url), reasonNl: row.reasonNl })),
        rotatedQuarterTurnOn: rows.filter((row) => row.rotatedQuarterTurn > 0).map((row) => row.pageType),
        rows: rows.filter((row) => row.reached).map((row) => ({ pageType: row.pageType, page: labelOf(row.url), controlsOpened: row.opened.length, screenshot: row.screenshot })),
      };
    }),
  };
}

/** Whether the items two lists share stand in the same order in both. */
function sameRelativeOrder(first: string[], second: string[]): boolean {
  const shared = new Set(first.filter((item) => second.includes(item)));
  const only = (list: string[]): string => [...new Set(list.filter((item) => shared.has(item)))].join(" | ");
  return only(first) === only(second);
}

/** What each component shows when it is opened, compared between the page types it stands on (WCAG 3.2.3). */
function openedComponents(run: RunData): Record<string, unknown> {
  const components = reachedStates(run).filter((state) => state.kind === "component" && (state.perPageType ?? []).filter((row) => row.reached).length > 0);
  if (components.length === 0) return { examined: false, note: "In deze run zijn de onderdelen niet per paginatype geopend; de volgorde in een geopend menu is niet tussen paginatypen vergeleken." };
  return {
    examined: true,
    method: "Elk onderdeel uit het sitemodel, ook het hoofdmenu en het zijmenu van de smalle weergave, is geopend op één pagina van elk paginatype waarop het staat. De links en knoppen die het opende zijn in de volgorde van de code vastgelegd en tussen de paginatypen vergeleken. `sameOrderOnAllPageTypes` is waar als de onderdelen die op meer paginatypen voorkomen overal dezelfde onderlinge volgorde hebben; er mogen er dus bij komen of wegvallen. Is het onwaar, dan staan de varianten onder `variants` naast elkaar.",
    components: components.map((state) => {
      const rows = (state.perPageType ?? []).filter((row) => row.reached);
      const variants = new Map<string, string[]>();
      for (const row of rows) variants.set(row.opened.join(" | "), [...(variants.get(row.opened.join(" | ")) ?? []), row.pageType]);
      const lists = [...variants.keys()].map((signature) => (signature === "" ? [] : signature.split(" | ")));
      return {
        state: state.id,
        viewport: rows[0] ? `${rows[0].viewport.width}x${rows[0].viewport.height}` : null,
        pageTypesCompared: rows.length,
        pageTypesNotOpened: (state.perPageType ?? []).filter((row) => !row.reached).map((row) => row.pageType),
        identicalOnAllPageTypes: variants.size === 1,
        sameOrderOnAllPageTypes: lists.every((list) => sameRelativeOrder(lists[0]!, list)),
        variants: [...variants.entries()].map(([items, pageTypes]) => ({ items: items === "" ? [] : items.split(" | "), pageTypes })),
      };
    }),
  };
}

function overflow(name: "reflow" | "zoom200" | "portrait", method: string): Extractor {
  return (run) => {
    const lost = (page: PageData): string[] => {
      const present = new Set(page[name].visibleControls);
      const wide = page.targets.map((target) => `${target.tag}:${target.text}`);
      return [...new Set(wide.filter((control) => !present.has(control)))].sort();
    };
    return {
      pagesExamined: run.pages.length,
      method,
      pagesWithHorizontalScroll: run.pages.filter((page) => page[name].horizontalScroll).map((page) => ({ page: page.label, scrollWidth: page[name].scrollWidth, viewportWidth: page[name].viewportWidth })),
      elementsWiderThanViewport: group(run, (page) => page[name].offenders, (element) => where(element)).map((entry) => ({ tag: entry.example.tag, text: entry.example.text.slice(0, 60), right: entry.example.right, ...scrollContainer(entry.example.overflowContainer), pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) })),
      scrollContainersExamined: run.pages.every((page) => page[name].offenders.every((element) => element.overflowContainer !== undefined)),
      clippedText: group(run, (page) => page[name].clipped, (element) => where(element)).map((entry) => ({ tag: entry.example.tag, text: entry.example.text.slice(0, 80), textOverflow: entry.example.textOverflow, region: entry.example.region, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) })),
      controlsNotVisibleAtThisSize: group(run, lost, (control) => control).map((entry) => ({ control: entry.example, pages: pagesText(entry.pages, run.pages.length) })),
      note: "Bedieningselementen die bij deze afmeting niet zichtbaar zijn, kunnen in een uitklapmenu zitten. Dat is toegestaan als ze daar bereikbaar blijven; controleer dat op de schermafbeelding.",
      content: contentCompared(run, name),
      ...(name === "portrait" ? { rotation: rotation(run), componentsPerPageType: componentsPerPageType(run) } : {}),
      screenshots: representativePages(run).map((page) => ({ page: page.label, file: `${page.dir}/probes/${name}.png` })),
    };
  };
}

/** One page per template: enough to look at, without sending thirty near-identical screenshots. */
export function representativePages(run: RunData, limit = 12): PageData[] {
  const seen = new Set<string>();
  const chosen: PageData[] = [];
  for (const page of run.pages) {
    if (seen.has(page.item.templateHash)) continue;
    seen.add(page.item.templateHash);
    chosen.push(page);
  }
  // Prefer the richest pages when there are more templates than we can show.
  return chosen.sort((a, b) => (b.facts.counts.elements as number) - (a.facts.counts.elements as number)).slice(0, limit).sort((a, b) => a.label.localeCompare(b.label));
}

export const reflow = overflow("reflow", "Venster van 320 bij 256 CSS-pixels, gelijk aan 1280 bij 1024 op 400% zoom.");
export const zoom = overflow("zoom200", "Venster van 640 bij 400 CSS-pixels met schaalfactor 2, gelijk aan 1280 bij 800 op 200% zoom.");
export const orientation = overflow("portrait", "Venster van 800 bij 1280 CSS-pixels (staand); de liggende weergave is de standaardrun.");

/** Controls that come and go with the wider text spacing, and what a button that came showed when it was opened with the spacing in force. */
function spacingControls(run: RunData): Record<string, unknown> {
  const windows = [
    ["1280 breed", (page: PageData) => page.textspacing.controls, ""],
    ["320 breed", (page: PageData) => page.smallest?.textspacing.controls, "smallest-"],
  ] as const;
  if (!run.pages.some((page) => windows.some(([, select]) => select(page) !== undefined))) return { examined: false, note: "Welke bedieningselementen met de ruimere tekstafstand verschijnen of verdwijnen, is in deze run niet gemeten." };
  return {
    examined: true,
    method: "Op elke pagina zijn de zichtbare bedieningselementen vóór en na het afdwingen van de ruimere tekstafstand naast elkaar gelegd, in het standaardvenster en op 320 pixels breed. `appeared` is wat er alleen mét de ruimere afstand is, zoals een knop die opneemt wat niet meer in de kop past; `disappeared` is wat er alleen zonder is. Elke knop of uitklapper die verscheen, is met de ruimere afstand nog aan geactiveerd: `opened` zegt welke links en knoppen hij toonde, welke tekst daarbinnen is afgekapt en waar de schermafbeelding staat. `foundBehind` bij een verdwenen element noemt de knop waarachter het is teruggevonden; staat daar niets, dan is het element met de ruimere afstand nergens teruggevonden.",
    windows: windows.map(([window, select, prefix]) => {
      const measured = run.pages.filter((page) => select(page) !== undefined);
      const of = { ...run, pages: measured };
      return {
        window,
        pagesExamined: measured.length,
        appeared: group(of, (page) => select(page)!.appeared, (entry) => `${entry.control}|${(entry.opened?.controls ?? []).join(",")}|${entry.opened?.failedNl ?? ""}`).map((entry) => ({ control: entry.example.control, ...(entry.example.opened ? { opened: { ...entry.example.opened, screenshot: entry.example.opened.screenshot ? `${measured.find((page) => page.label === entry.pages[0])!.dir}/${entry.example.opened.screenshot}` : null } } : { opened: "geen knop of uitklapper, niet geactiveerd" }), pages: pagesText(entry.pages, measured.length), where: entry.example.where })),
        disappeared: group(of, (page) => select(page)!.disappeared, (entry) => `${entry.control}|${entry.foundBehind}`).map((entry) => ({ control: entry.example.control, foundBehind: entry.example.foundBehind, pages: pagesText(entry.pages, measured.length) })),
        disappearedAndNotFound: group(of, (page) => select(page)!.disappeared.filter((entry) => entry.foundBehind === null), (entry) => entry.control).length,
        screenshotsOpened: `probes/${prefix}textspacing-opened-<n>.png in de map van de pagina`,
      };
    }),
  };
}

export const textSpacing: Extractor = (run) => {
  type Spacing = PageData["textspacing"];
  const clipped = (select: (page: PageData) => Spacing | undefined) => group(run, (page) => select(page)?.newlyClipped ?? [], (element) => where(element)).map((entry) => ({ tag: entry.example.tag, text: entry.example.text.slice(0, 80), textOverflow: entry.example.textOverflow, region: entry.example.region, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) }));
  const resistant = (select: (page: PageData) => Spacing | undefined) => group(run, (page) => select(page)?.textWithoutSpacing ?? [], (element) => where(element)).map((entry) => ({ tag: entry.example.tag, text: entry.example.text.slice(0, 60), region: entry.example.region, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) }));
  const atSmallest = (page: PageData): Spacing | undefined => page.smallest?.textspacing;
  const measuredSmallest = run.pages.filter((page) => atSmallest(page) !== undefined);
  return {
    pagesExamined: run.pages.length,
    method: "Regelhoogte 1,5, alinea-afstand 2em, letterafstand 0,12em en woordafstand 0,16em, afgedwongen met een eigen stylesheet in het document en in elke shadow root, ook op content die een webcomponent in een slot toont. Het stylesheet blijft aan: een shadow root die later ontstaat (een menu dat zijn items bij elk openen opnieuw maakt) krijgt het meteen, ook als het onderdeel zijn eigen stylesheets toewijst. Daarna is gemeten welke tekst wordt afgekapt, en welke tekst de afstand ondanks alles niet kreeg. Gemeten in het standaardvenster en op 320 pixels breed (`at320`), en in elke toestand uit het sitemodel (`states`). In een toestand staat de ruimere afstand al aan vanaf het laden van de pagina, dus voordat het recept het menu, het venster of het paneel opent; vergeleken is met dezelfde toestand zonder die afstand.",
    shadowRootsStyled: run.pages.reduce((sum, page) => sum + page.textspacing.shadowRootsStyled, 0),
    newlyClippedText: clipped((page) => page.textspacing),
    textThatDidNotTakeTheSpacing: resistant((page) => page.textspacing),
    textThatDidNotTakeTheSpacingCount: run.pages.reduce((sum, page) => sum + (page.textspacing.textWithoutSpacingCount ?? 0), 0),
    pagesWithHorizontalScrollAfter: run.pages.filter((page) => page.textspacing.horizontalScrollAfter).map((page) => page.label),
    controlsOnlyWithSpacing: spacingControls(run),
    screenshots: representativePages(run).map((page) => ({ page: page.label, file: `${page.dir}/probes/textspacing.png` })),
    at320:
      measuredSmallest.length === 0
        ? { examined: false, note: "Op 320 pixels breed is de tekstafstand in deze run niet gemeten." }
        : {
            examined: true,
            pagesExamined: measuredSmallest.length,
            newlyClippedText: clipped(atSmallest),
            textThatDidNotTakeTheSpacing: resistant(atSmallest),
            textThatDidNotTakeTheSpacingCount: measuredSmallest.reduce((sum, page) => sum + (atSmallest(page)!.textWithoutSpacingCount ?? 0), 0),
            // At this width a page may scroll sideways before the spacing too: compare with reflow.
            pagesWithHorizontalScrollAfter: measuredSmallest.filter((page) => atSmallest(page)!.horizontalScrollAfter).map((page) => page.label),
            screenshots: representativePages(run).filter((page) => page.smallest).map((page) => ({ page: page.label, file: `${page.dir}/probes/smallest-textspacing.png` })),
          },
    states: reachedStates(run).map((state) => {
      const measured = run.stateEvidence?.[state.id]?.textSpacing;
      if (!measured) return { state: state.id, examined: false };
      if (measured.reachedWithSpacing === false) return { state: state.id, examined: true, appliedBeforeOpening: true, openedWithSpacing: false, notOpenedNl: measured.reasonNl ?? null, note: "Met de ruimere tekstafstand aan liet het recept deze toestand niet meer openen. Ga na of het onderdeel met die afstand nog te openen is." };
      return {
        state: state.id,
        examined: true,
        appliedBeforeOpening: measured.appliedBeforeOpening === true,
        openedWithSpacing: measured.appliedBeforeOpening === true ? true : null,
        newlyClippedText: (measured.newlyClipped ?? []).map((element) => ({ tag: element.tag, text: element.text.slice(0, 80), textOverflow: element.textOverflow, region: element.region, where: where(element) })),
        textThatDidNotTakeTheSpacingCount: measured.textWithoutSpacingCount ?? 0,
        horizontalScrollAfter: measured.horizontalScrollAfter ?? null,
        stillInThisStateAfterwards: measured.stateStillReachedAfterwards ?? null,
        screenshot: state.files.textSpacingScreenshot ?? null,
      };
    }),
  };
};

export const MINIMUM_TARGET = 24;

type TargetBox = PageData["targets"][number]["box"];
const boxContains = (outer: TargetBox, inner: TargetBox): boolean => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

export const targetSize: Extractor = (run) => {
  type Target = PageData["targets"][number];
  // The spacing exception: a circle of 24 pixels centred on a small target may not touch another target,
  // nor the circle of another small target.
  const tooClose = (all: Target[], target: Target): string | null => {
    const centre = { x: target.box.x + target.box.width / 2, y: target.box.y + target.box.height / 2 };
    const radius = MINIMUM_TARGET / 2;
    for (const other of all) {
      if (other === target || where(other) === where(target)) continue;
      // A focusable region around the target (a main with tabindex), or a control inside it, is not a neighbour to keep distance from.
      if (boxContains(other.box, target.box) || boxContains(target.box, other.box)) continue;
      const otherSmall = other.width < MINIMUM_TARGET || other.height < MINIMUM_TARGET;
      const nearestX = Math.max(other.box.x, Math.min(centre.x, other.box.x + other.box.width));
      const nearestY = Math.max(other.box.y, Math.min(centre.y, other.box.y + other.box.height));
      const toBox = Math.hypot(centre.x - nearestX, centre.y - nearestY);
      const toCentre = Math.hypot(centre.x - (other.box.x + other.box.width / 2), centre.y - (other.box.y + other.box.height / 2));
      if (toBox < radius || (otherSmall && toCentre < 2 * radius)) return `${other.tag} "${(axName(other) || other.text).slice(0, 30)}"`;
    }
    return null;
  };
  const small = (all: Target[]) => all.filter((target) => !target.inlineInText && (target.width < MINIMUM_TARGET || target.height < MINIMUM_TARGET)).map((target) => ({ ...target, tooCloseTo: tooClose(all, target) }));
  const show = (target: ReturnType<typeof small>[number]) => ({ tag: target.tag, name: axName(target) || target.text.slice(0, 60), size: `${target.width}x${target.height}`, spacing: target.tooCloseTo ? `te dicht bij ${target.tooCloseTo}` : "genoeg ruimte: de cirkel van 24 pixels raakt geen ander doel", region: target.region, where: where(target), box: target.box });
  const rows = (select: (page: PageData) => Target[]) =>
    group(run, (page) => small(select(page)), (target) => `${target.tag}|${target.text.slice(0, 40)}|${target.width}x${target.height}|${target.region}|${target.tooCloseTo !== null}`).map((entry) => ({ ...show(entry.example), occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), firstPage: entry.pages[0] }));
  const measuredSmallest = run.pages.filter((page) => page.smallest?.targets !== undefined);
  return {
    pagesExamined: run.pages.length,
    targetsExamined: run.pages.reduce((sum, page) => sum + page.targets.length, 0),
    method: `Afmeting van elk zichtbaar bedieningselement. Links in lopende tekst vallen onder de uitzondering en zijn niet meegeteld. Voor elk doel kleiner dan ${MINIMUM_TARGET} bij ${MINIMUM_TARGET} CSS-pixels is de uitzondering voor tussenruimte nagerekend: een cirkel van ${MINIMUM_TARGET} pixels om het midden mag geen ander doel raken en ook niet de cirkel van een ander klein doel (zie spacing). Gemeten in het standaardvenster, op 320 pixels breed (\`at320\`) en in elke toestand uit het sitemodel (\`states\`), elk met de bedieningselementen die daar zichtbaar zijn.`,
    smallerThanMinimum: rows((page) => page.targets),
    at320: measuredSmallest.length === 0 ? { examined: false, note: "Op 320 pixels breed zijn de afmetingen in deze run niet gemeten." } : { examined: true, pagesExamined: measuredSmallest.length, targetsExamined: measuredSmallest.reduce((sum, page) => sum + page.smallest!.targets.length, 0), smallerThanMinimum: rows((page) => page.smallest?.targets ?? []) },
    states: reachedStates(run).map((state) => {
      const targets = run.stateEvidence?.[state.id]?.targets;
      return targets ? { state: state.id, examined: true, viewport: state.viewport ? `${state.viewport.width}x${state.viewport.height}` : null, targetsExamined: targets.length, smallerThanMinimum: small(targets).map(show) } : { state: state.id, examined: false };
    }),
  };
};

/** Navigation and other repeated blocks, compared across pages. */
export const consistency: Extractor = (run) => {
  const regions = new Map<string, Map<string, string[]>>();
  for (const page of run.pages) {
    const byRegion = new Map<string, string[]>();
    for (const element of [...page.facts.links, ...page.facts.controls]) {
      if (!element.visible || !element.region || !/^(nav|navigation|header|banner|footer|contentinfo)/.test(element.region)) continue;
      byRegion.set(element.region, [...(byRegion.get(element.region) ?? []), axName(element) || element.text.slice(0, 40)]);
    }
    for (const [region, names] of byRegion) {
      const variants = regions.get(region) ?? new Map<string, string[]>();
      const signature = names.join(" | ");
      variants.set(signature, [...(variants.get(signature) ?? []), page.label]);
      regions.set(region, variants);
    }
  }
  const HELP = /contact|hulp|help|vraag|chat|veelgestelde|faq|bel ons|telefoon|klantenservice|mailto:|tel:/i;
  const helpLinks = group(
    run,
    (page) => [...page.facts.links, ...page.facts.controls].filter((element) => element.visible && HELP.test(`${axName(element)} ${element.text} ${(element as { href?: string | null }).href ?? ""}`)),
    (element) => `${axName(element) || element.text.slice(0, 40)}|${(element as { href?: string | null }).href ?? ""}|${element.region}`,
  ).map((entry) => ({ name: axName(entry.example) || entry.example.text.slice(0, 60), href: (entry.example as { href?: string | null }).href ?? null, region: entry.example.region, underHeading: (entry.example as { context?: string }).context ?? null, pages: pagesText(entry.pages, run.pages.length) }));
  return {
    pagesExamined: run.pages.length,
    helpMechanisms: { note: "Links en knoppen die naar contact, chat, hulp of veelgestelde vragen wijzen, met het paginagebied en de kop waaronder ze staan.", rows: helpLinks },
    method: "Per pagina is de volgorde van links en knoppen in elk navigatie-, kop- en voetgebied vastgelegd en tussen pagina's vergeleken, in het standaardvenster in de begintoestand. Onder `opened` staat dezelfde vergelijking voor wat een onderdeel toont als het open is, per paginatype.",
    opened: openedComponents(run),
    regions: [...regions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([region, variants]) => ({
      region,
      identicalOnAllPages: variants.size === 1 && [...variants.values()][0]!.length === run.pages.length,
      variants: [...variants.entries()].map(([items, pages]) => ({ items: items.split(" | "), pages: pagesText(pages, run.pages.length) })),
    })),
  };
};

export const forms: Extractor = (run) => {
  const fields = (page: PageData) => page.facts.controls.filter((control) => control.inForm || ["input", "select", "textarea"].includes(control.tag));
  return {
    pagesExamined: run.pages.length,
    formsInInventory: run.inventory.totals.forms ?? 0,
    note: "Velden in gesloten dialogen en zijpanelen zijn hier meegeteld als ze in de DOM staan, ook als ze niet zichtbaar zijn.",
    fields: group(run, fields, (control) => [control.tag, control.type, axName(control), control.labelText, control.region].join("|")).map((entry) => ({ tag: entry.example.tag, type: entry.example.type, role: entry.example.ax?.role, accessibleName: axName(entry.example) || null, label: entry.example.labelText || null, placeholder: entry.example.placeholder, required: entry.example.required, autocomplete: entry.example.autocomplete, visible: entry.example.visible, region: entry.example.region, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) })),
  };
};

export const tables: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  tablesExamined: run.pages.reduce((sum, page) => sum + page.facts.tables.length, 0),
  tables: group(run, (page) => page.facts.tables, (table) => where(table)).map((entry) => ({ caption: entry.example.caption, headerCells: entry.example.headerCells, rows: entry.example.rows, pages: pagesText(entry.pages, run.pages.length), where: where(entry.example) })),
  lists: run.inventory.totals.lists ?? 0,
});

/** Files a reviewer can open to look at the page itself, one page per template. */
export const screenshots: Extractor = (run) => {
  const perType = pagePerType(run);
  return {
    note: perType
      ? "Volledige pagina op 1280 pixels breed, licht en donker, en op 360 pixels breed. Eén pagina per paginatype uit het sitemodel, elk paginatype zonder grens; `pageType` zegt welk. Van elke andere pagina staan dezelfde bestanden in haar map (`files` in de legenda)."
      : "Volledige pagina op 1280 pixels breed, licht en donker. Eén pagina per sjabloon, hooguit twaalf; van elke andere pagina staan dezelfde bestanden in haar map (`files` in de legenda).",
    ...(run.pages.some((page) => page.facts.screenshotClippedAt) ? { clippedNote: "Een pagina met `screenshotClippedAt` is hoger dan een schermafbeelding mag zijn: haar afbeeldingen stoppen bij `limit` pixels, de pagina is `pageHeight` pixels hoog. Wat daaronder staat, zie je op geen afbeelding." } : {}),
    pages: (perType ?? representativePages(run).map((page) => ({ page, type: null }))).map(({ page, type }) => ({ page: page.label, ...(type ? { pageType: type } : {}), url: page.item.url, light: `${page.dir}/screenshot-light.png`, dark: `${page.dir}/screenshot-dark.png`, ...(type ? { narrow: `${page.dir}/screenshot-narrow.png` } : {}), accessibilityTree: `${page.dir}/aria.yaml`, ...(page.facts.screenshotClippedAt ? { screenshotClippedAt: page.facts.screenshotClippedAt } : {}) })),
  };
};

/** One page of each page type of the site model, the representative where it is in the sample. Null in a run without a model. */
export function pagePerType(run: RunData): { page: PageData; type: string }[] | null {
  if (!run.siteModel || run.siteModel.pageTypes.length === 0) return null;
  const chosen: { page: PageData; type: string }[] = [];
  for (const type of run.siteModel.pageTypes) {
    const page = run.pages.find((entry) => entry.item.url === type.representative) ?? run.pages.find((entry) => type.pages.includes(entry.item.url));
    if (page && !chosen.some((entry) => entry.page === page)) chosen.push({ page, type: type.id });
  }
  return chosen;
}

export const viewport: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  viewportMeta: group(run, (page) => [page.facts.viewportMeta ?? "(geen)"], (value) => value).map((entry) => ({ content: entry.example, pages: pagesText(entry.pages, run.pages.length) })),
});

const REPEATED_BLOCK = new Set(["banner", "navigation", "contentinfo"]);
const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

/**
 * Whether headings and the main landmark really let a user skip the repeated blocks: the main
 * landmark must not hold those blocks itself, and no headings of the menu may come before the first h1.
 */
export function headingsAsBypass(page: PageData, run: RunData): Record<string, unknown> {
  const main = page.facts.landmarks.find((landmark) => landmark.ax?.role === "main") ?? null;
  // A header or footer inside main loses its landmark role in the tree, so the element name counts too.
  const repeated = page.facts.landmarks.filter((landmark) => landmark !== main && (REPEATED_BLOCK.has(landmark.ax?.role ?? "") || ["header", "footer", "nav"].includes(landmark.tag)));
  const within = main ? repeated.filter((landmark) => landmark.inMain ?? inside(landmark.box, main.box)) : [];
  const outline = page.facts.headings.filter((heading) => heading.visible && !heading.ax?.ignored);
  const firstH1 = outline.findIndex((heading) => heading.level === 1);
  const before = firstH1 < 0 ? outline : outline.slice(0, firstH1);
  // A heading that comes before the h1 on other pages too belongs to a repeated block, such as the menu.
  const elsewhere = new Set(
    run.pages
      .filter((other) => other !== page && other.item.kind !== "embedded")
      .flatMap((other) => {
        const visible = other.facts.headings.filter((heading) => heading.visible && !heading.ax?.ignored);
        const index = visible.findIndex((heading) => heading.level === 1);
        return (index < 0 ? visible : visible.slice(0, index)).map((heading) => norm(heading.text));
      }),
  );
  const repeatedBefore = before.filter((heading) => elsewhere.has(norm(heading.text)));
  return {
    mainContainsRepeatedBlocks: main ? within.length > 0 : null,
    repeatedBlocksInsideMain: within.map((landmark) => `${landmark.tag}${axName(landmark) ? ` "${axName(landmark)}"` : ""}`),
    headingsBeforeFirstH1: firstH1 < 0 ? null : before.length,
    repeatedHeadingsBeforeFirstH1: firstH1 < 0 ? null : repeatedBefore.length,
    examplesOfHeadingsBeforeFirstH1: before.slice(0, 4).map((heading) => `h${heading.level} ${heading.text.slice(0, 40)}`),
  };
}

/** Where a skip link points, in one line: the element and whether it is rendered, so whether it can take focus. */
function skipElement(element: SkipLinkAim["target"], href: string | null): string | null {
  if (element === null) return href === null ? null : `href "${href}" noemt geen plek op deze pagina`;
  if ("missing" in element) return `geen element met id "${element.missing}"`;
  return `${element.tag}${element.id ? `#${element.id}` : ""}, ${element.rendered ? "weergegeven" : "niet weergegeven: kan geen focus krijgen"}${element.tabindex !== null ? `, tabindex ${element.tabindex}` : ""}`;
}

/** Does the skip link exist, and does activating it move focus past the repeated blocks? */
export const bypass: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  method: "Eerste Tab-stop bepaald, het doel van de skiplink gelezen (het element dat de href noemt en het element dat in de code op de skiplink volgt, elk met of het wordt weergegeven), met Enter geactiveerd, daarna opnieuw op Tab gedrukt en vastgelegd waar de focus landt.",
  pages: run.pages.map((page) => {
    const probe = page.skiplink;
    return {
      page: page.label,
      firstTabStop: probe.firstTabStop ? `${probe.firstTabStop.tag} "${probe.firstTabStop.text.slice(0, 40)}"` : null,
      isSkipLink: probe.isSkipLink,
      scrolledBy: probe.after && probe.before ? probe.after.scrollY - probe.before.scrollY : null,
      hashAfter: probe.after?.hash ?? null,
      ...(probe.aim ? { target: skipElement(probe.aim.target, probe.aim.href), followingElement: skipElement(probe.aim.following, null) } : {}),
      focusAfterActivation: probe.focusAfterActivation ? `${probe.focusAfterActivation.tag} [${probe.focusAfterActivation.region ?? "-"}]` : null,
      nextTabStopRegion: probe.nextTabStop?.region ?? null,
      nextTabStop: probe.nextTabStop ? `${probe.nextTabStop.tag} "${probe.nextTabStop.text.slice(0, 40)}"` : null,
      hasMainLandmark: page.facts.landmarks.some((landmark) => landmark.ax?.role === "main"),
      h1Count: page.facts.headings.filter((heading) => heading.level === 1 && heading.visible).length,
      ...headingsAsBypass(page, run),
    };
  }),
});

export const motion: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  method: "Elke pagina is geladen met bewegingsvoorkeur 'geen voorkeur', 1,5 seconde gewacht, daarna zijn lopende animaties, bewegende afbeeldingen, automatisch afspelende media en timers geteld.",
  pagesWithMotion: run.pages.filter((page) => page.motion.runningAnimations + page.motion.gifImages + page.motion.autoplayMedia + page.motion.marqueeBlink > 0).map((page) => ({ page: page.label, ...page.motion, longOrInfinite: page.motion.longOrInfinite.map((animation) => ({ name: animation.name, iterations: animation.iterations, durationMs: animation.durationMs, where: animation.target ? where(animation.target) : null })) })),
  totals: {
    runningAnimations: run.pages.reduce((sum, page) => sum + page.motion.runningAnimations, 0),
    gifImages: run.pages.reduce((sum, page) => sum + page.motion.gifImages, 0),
    autoplayMedia: run.pages.reduce((sum, page) => sum + page.motion.autoplayMedia, 0),
    marqueeBlink: run.pages.reduce((sum, page) => sum + page.motion.marqueeBlink, 0),
  },
  media: mediaTable(run),
});

/** One audio or video element as a judge needs it: what the code says, what the file is, whether it played, and what stops it. */
function mediaRow(element: MediaElement): Record<string, unknown> {
  return {
    element: `${element.tag}${element.frame ? ` in venster ${element.frame}` : ""}`,
    where: where(element),
    src: element.src,
    visible: element.visible,
    autoplay: element.attributes.autoplay,
    loop: element.loop,
    controlsAttribute: element.attributes.controls,
    muted: element.muted,
    volume: element.volume,
    durationSeconds: element.durationSeconds,
    audioTrack: element.audioTrack,
    playingAfterLoad: element.playingAfterLoad,
    playingAfterSeconds: element.playingAfterSeconds,
    timeAdvances: element.timeAdvances,
    secondsBetweenReadings: element.secondsBetweenReadings,
    textTracks: element.textTracks,
    ownControlsShown: element.ownControls,
    pageControls: element.pageControls.map((control) => ({ control: `${control.tag} "${control.text}"`, why: control.relation, effect: control.effect ?? "niet geprobeerd", where: where(control) })),
    canBePausedOrMuted: element.canBePausedOrMuted,
    ...(element.error ? { error: element.error } : {}),
  };
}

function mediaTable(run: RunData): Record<string, unknown> {
  const of = (page: PageData): MediaReport | undefined => page.media ?? page.facts.media;
  if (!run.pages.some((page) => of(page) !== undefined)) return { examined: false, note: "In deze run zijn audio en video niet per element gemeten." };
  const states = Object.entries(run.stateEvidence ?? {}).filter(([, evidence]) => (evidence.media?.elements.length ?? 0) > 0);
  return {
    examined: true,
    method: "Elk audio- en video-element op elke pagina, ook in ingesloten vensters: gelezen na het laden en nog eens na drie seconden. Vastgelegd: wat de code zegt (autoplay, loop, controls, muted), wat het bestand is (duur, geluidsspoor, ondertitel- en andere tekstsporen) en of het in de testbrowser speelde. Knoppen op de pagina die het geluid kunnen stoppen (op naam, via aria-controls, of in hetzelfde blok) zijn op een aparte pagina aangeklikt; effect zegt wat dat met het element deed. Een browser kan vanzelf afspelen tegenhouden: een oordeel over vanzelf starten steunt op de code en het bestand, niet alleen op playingAfterLoad. Of een geluidsspoor stil is, is niet gemeten.",
    elementsFound: run.pages.reduce((sum, page) => sum + (of(page)?.elements.length ?? 0), 0),
    perPage: run.pages.filter((page) => (of(page)?.elements.length ?? 0) > 0).map((page) => ({ page: page.label, controlsTried: page.media !== undefined, elements: of(page)!.elements.map(mediaRow) })),
    perState: states.map(([state, evidence]) => ({ state, controlsTried: false, elements: evidence.media!.elements.map(mediaRow) })),
    framesNotInspected: run.pages.flatMap((page) => (of(page)?.framesNotInspected ?? []).map((frame) => ({ page: page.label, ...frame }))),
  };
}

/** Timers in each state of the model: what the steps of its recipe started on top of what the page starts when it loads. */
function timersAfterAction(run: RunData): Record<string, unknown> {
  const states = reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.timers !== undefined);
  if (states.length === 0) return { examined: false, note: "Timers die pas na een handeling starten, zijn in deze run niet geteld: er zijn geen toestanden uit een sitemodel vastgelegd, of de run is van voor deze telling." };
  const more = (inState: number[], atLoad: number[]): number[] => lostFrom(inState.map(String), atLoad.map(String)).map(Number);
  const rows = states.map((state) => {
    const timers = run.stateEvidence![state.id]!.timers!;
    const page = run.pages.find((entry) => entry.item.url === state.url) ?? run.pages.find((entry) => entry.item.url === run.recipes?.[state.recipe ?? ""]?.start?.url);
    const atLoad = page?.facts.timers ?? { intervals: [], longTimeouts: [] };
    return { state: state.id, kind: state.kind, comparedWithPage: page?.label ?? null, intervalsStartedAfterAction: more(timers.intervals, atLoad.intervals), longTimeoutsStartedAfterAction: more(timers.longTimeouts, atLoad.longTimeouts) };
  });
  return {
    examined: true,
    method: "In elke toestand uit het sitemodel (elk onderdeel zoals het recept het opent, elk proces zoals het recept het doorloopt, ook na een nagebootste inlog of het invullen van een formulier) zijn de aanroepen van setInterval en van setTimeout met 20 seconden of meer geteld vanaf het laden van de pagina tot na de laatste stap van het recept. Daarvan is afgetrokken wat dezelfde pagina bij het laden al start (`comparedWithPage`; staat daar niets, dan is er geen pagina om mee te vergelijken en staat alles er). Wat overblijft is door een handeling gestart. Een timer onder de 20 seconden die zichzelf niet herhaalt, is niet geteld. De timers die pas na het versturen van een ingevuld formulier starten, staan in `limits.afterSubmit`.",
    statesExamined: rows.length,
    statesWithTimersAfterAction: rows.filter((row) => row.intervalsStartedAfterAction.length + row.longTimeoutsStartedAfterAction.length > 0),
    statesWithoutTimersAfterAction: rows.filter((row) => row.intervalsStartedAfterAction.length + row.longTimeoutsStartedAfterAction.length === 0).map((row) => row.state),
  };
}

/**
 * Everything that can be a time limit, per page and per state, with a conclusion: what was found, or
 * that nothing was and what that rests on. The rule for a timer is `TIMER_RULE_NL`.
 */
function timeLimitsFound(run: RunData): Record<string, unknown> {
  const places: { where: string; probe: TimeLimitProbe }[] = [
    ...run.pages.filter((page) => page.timeLimits).map((page) => ({ where: page.label, probe: page.timeLimits! })),
    ...reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.timeLimits).map((state) => ({ where: state.id, probe: run.stateEvidence![state.id]!.timeLimits! })),
  ];
  const statesMeasured = places.length - run.pages.filter((page) => page.timeLimits).length;
  // After sending a form only what sending started is new: the timers of the page itself are already counted with the state.
  const sent = reachedStates(run).flatMap((state) => {
    const after = run.stateEvidence?.[state.id]?.timeLimitsAfterSubmit;
    return after?.submitted && after.probe ? [{ where: `${state.id} na versturen`, probe: { ...after.probe, timers: after.startedAfterSubmit } }] : [];
  });
  places.push(...sent);
  const pagesMeasured = run.pages.filter((page) => page.timeLimits).length;
  if (pagesMeasured === 0) return { examined: false, note: "In deze run zijn de timers niet gevolgd en niet nagebootst, en zijn cookies en opslag niet vastgelegd: de run is van voor deze meting." };
  // Timers that look alike on more pages are one row, with every page or state they ran on.
  const rows = new Map<string, Record<string, unknown> & { where: string[]; limit: string }>();
  for (const { where, probe } of places) {
    for (const timer of probe.timers) {
      const judged = judgeTimer(timer);
      const key = canonicalJson([timer.kind, timer.delayMs, judged.effectsNl, judged.limit, timer.forced, timer.fired > 0, timer.cleared]);
      const row: Record<string, unknown> & { where: string[]; limit: string } = rows.get(key) ?? { where: [], ...timerNl(timer) };
      if (!row.where.includes(where)) row.where.push(where);
      rows.set(key, row);
    }
  }
  const timers = [...rows.values()];
  const metaRefresh = places.flatMap(({ where, probe }) =>
    probe.metaRefresh.map((entry) => ({ where, content: entry.content, seconds: entry.seconds, url: entry.url, limit: entry.seconds !== null && entry.seconds > 0 && entry.seconds <= 72_000 ? "tijdslimiet: ververst of stuurt door na een wachttijd" : "geen tijdslimiet: doorsturen zonder wachttijd of na meer dan 20 uur" })),
  );
  const setByNl = { login: "de inlog van de run", notice: "het sluiten van een melding vóór het meten", page: "de pagina zelf" } as const;
  const cookies = new Map<string, { name: string; domain: string; expires: string; firstParty: boolean; sessionLike: boolean; setBy: string }>();
  for (const { probe } of places) for (const cookie of probe.cookies) cookies.set(`${cookie.domain} ${cookie.name}`, { name: cookie.name, domain: cookie.domain, expires: cookie.expires ?? "einde van de browsersessie", firstParty: cookie.firstParty, sessionLike: cookie.sessionLike, setBy: setByNl[cookie.setBy] });
  const ownCookies = [...cookies.values()].filter((cookie) => cookie.firstParty);
  const storage = places
    .map(({ where, probe }) => ({ where, sessionStorage: probe.storage.now.sessionStorage ?? [], localStorage: probe.storage.now.localStorage ?? [], writesByPage: probe.storage.writes }))
    .filter((entry) => entry.sessionStorage.length + entry.localStorage.length + entry.writesByPage > 0);
  const sessionCookies = ownCookies.filter((cookie) => cookie.sessionLike && cookie.setBy !== setByNl.login);
  const storedSession = storage.filter((entry) => [...entry.sessionStorage, ...entry.localStorage].some((name) => /token|session|sessie|auth|jwt|login/i.test(name)));
  const serverSession = [
    ...(run.login ? ["de run is ingelogd: de server houdt een sessie bij"] : []),
    ...sessionCookies.map((cookie) => `de site zet het cookie ${cookie.name}, dat een sessie kan dragen`),
    ...storedSession.map((entry) => `${entry.where} bewaart in de browser iets wat op een sessie lijkt (${[...entry.sessionStorage, ...entry.localStorage].join(", ")})`),
  ];
  const limitTimers = timers.filter((row) => row.limit !== "geen tijdslimiet");
  const limitRefresh = metaRefresh.filter((row) => row.limit.startsWith("tijdslimiet"));
  const found = limitTimers.length + limitRefresh.length + serverSession.length > 0;
  const shortTimeouts = places.reduce((sum, place) => sum + place.probe.shortTimeouts, 0);
  return {
    examined: true,
    complete: pagesMeasured === run.pages.length,
    method: `Op elke pagina en in elke toestand uit het sitemodel is elke timer van een seconde of langer gevolgd vanaf het laden: wanneer hij afging en wat er daarna veranderde. Timers die aan het eind van de meting nog niet waren afgegaan, heeft loep zelf laten afgaan, de kortste eerst, met lege tekstvelden eerst ingevuld zodat leegmaken te zien is; een navigatie daarbij is tegengehouden en vastgelegd. Ook vastgelegd: elke meta refresh met zijn wachttijd, de cookies van de browser zonder hun waarde, met vervaltijd en herkomst, en wat de pagina in sessionStorage en localStorage bewaart. ${TIMER_RULE_NL} Een formulier dat een recept invulde zonder het te versturen, is daarna verstuurd zoals een bezoeker dat doet, en de timers die dat startte zijn op dezelfde manier gevolgd (\`afterSubmit\`); in \`where\` staat zo'n meting als "<toestand> na versturen". Verstuurd is alleen wat op de pagina blijft of met GET vraagt; een formulier dat met POST naar een andere pagina gaat alleen op een testomgeving waar de run mag versturen. Elk ander verzoek dat iets kan wijzigen, is tegengehouden en geteld. Niet gezien: een sessie die de server bijhoudt zonder cookie (in het adres of in een verborgen veld), en wat de server pas doet als een tegengehouden verzoek hem wel had bereikt.`,
    pagesExamined: pagesMeasured,
    statesExamined: statesMeasured,
    afterSubmit: afterSubmitRows(run),
    found,
    conclusionNl: found
      ? `Mogelijke tijdslimieten: ${[limitRefresh.length > 0 ? `${limitRefresh.length} meta refresh met wachttijd` : null, limitTimers.length > 0 ? `${limitTimers.length} ${limitTimers.length === 1 ? "timer" : "timers"} die iets afbreekt, wegneemt of na lange tijd toont, of waarvan niet bekend is wat hij doet` : null, serverSession.length > 0 ? "een sessie die de server kan laten verlopen" : null].filter(Boolean).join(", ")}.`
      : "Geen tijdslimiet gevonden.",
    basisNl: found
      ? []
      : [
          `${pagesMeasured} van de ${run.pages.length} pagina's en ${statesMeasured} toestanden gemeten${sent.length > 0 ? `, en ${sent.length} ${sent.length === 1 ? "formulier" : "formulieren"} na het versturen` : ""}.`,
          `${timers.length === 0 ? "Geen timer van een seconde of langer." : `${timers.length} ${timers.length === 1 ? "soort timer" : "soorten timers"}, geen daarvan een tijdslimiet volgens de regel.`} Kortere eenmalige timers: ${shortTimeouts}; die laten de gebruiker geen tijd om iets te doen.`,
          metaRefresh.length === 0 ? "Geen meta refresh." : "Elke meta refresh stuurt door zonder wachttijd of wacht meer dan 20 uur.",
          ownCookies.length === 0 ? "De site zet geen eigen cookies." : `De eigen cookies (${ownCookies.map((cookie) => cookie.name).join(", ")}) dragen geen sessie.`,
          storage.length === 0 ? "De pagina's bewaren niets in sessionStorage of localStorage." : "Wat de pagina's in de browser bewaren, lijkt niet op een sessie.",
          "Er is niet ingelogd.",
        ],
    metaRefresh,
    timers,
    cookies: { ownSite: ownCookies, otherSites: cookies.size - ownCookies.length },
    storage,
    serverSession,
  };
}

/** Per state whose recipe fills in a form: whether it was sent, what that did, and the timers sending started. */
function afterSubmitRows(run: RunData): Record<string, unknown>[] {
  return reachedStates(run).flatMap((state): Record<string, unknown>[] => {
    const after = run.stateEvidence?.[state.id]?.timeLimitsAfterSubmit;
    if (!after) return [];
    if (!after.submitted) return [{ state: state.id, form: after.form, method: after.method, sent: false, notSentNl: after.notSubmittedNl }];
    return [
      {
        state: state.id,
        form: after.form,
        submitControl: after.submitControl,
        method: after.method,
        sent: true,
        navigated: after.navigated ? `naar ${after.urlAfter}` : "nee, op dezelfde pagina gebleven",
        writes: after.writesRefused > 0 ? `${after.writesRefused} verzoek(en) die iets kunnen wijzigen tegengehouden: wat daarna komt, heeft de server niet gezien` : after.writesSent > 0 ? `${after.writesSent} verzoek(en) verstuurd naar de testomgeving` : "geen verzoek dat iets kan wijzigen",
        timersStarted: after.startedAfterSubmit.map((timer) => {
          const { kind, delayMs, whatHappenedNl, limit, whyNl } = timerNl(timer);
          return { kind, delayMs, whatHappenedNl, limit, whyNl };
        }),
      },
    ];
  });
}

/** The watch on the session, in a run with a login. */
function sessionWatchFound(run: RunData): Record<string, unknown> {
  const watch = run.sessionWatch ?? null;
  const final = watch !== null && (watch.status === "expired" || watch.status === "stopped");
  return {
    ...watchNl(watch),
    ...(final ? { checks: watch.checks.length, longestQuietAliveMinutes: watch.longestQuietAliveMinutes, expired: watch.expired, warning: watch.warning, screenshotBeforeExpiry: watch.beforeExpiry } : {}),
    ...(watch?.mainSessionExpiredAt ? { mainSessionExpiredAt: watch.mainSessionExpiredAt, mainSessionNl: "Ook de sessie van de meting zelf verliep tijdens de proef: een stap die toen mislukte, mislukte daardoor." } : {}),
  };
}

export const timing: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  limits: timeLimitsFound(run),
  ...(run.login ? { session: sessionWatchFound(run) } : {}),
  method: "Alle aanroepen van setInterval en van setTimeout met 20 seconden of meer zijn geteld vanaf het laden van de pagina, plus meta refresh en inlogvelden.",
  intervals: group(run, (page) => page.facts.timers.intervals.map(String), (delay) => delay).map((entry) => ({ delayMs: Number(entry.example), pages: pagesText(entry.pages, run.pages.length) })),
  longTimeouts: group(run, (page) => page.facts.timers.longTimeouts.map(String), (delay) => delay).map((entry) => ({ delayMs: Number(entry.example), pages: pagesText(entry.pages, run.pages.length) })),
  metaRefresh: run.inventory.totals.metaRefresh ?? 0,
  passwordFields: run.inventory.totals.passwordFields ?? 0,
  afterAction: timersAfterAction(run),
});

const GESTURE_EVENTS = ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "mousedown", "mouseup", "dragstart", "drag", "dragover", "drop", "wheel", "devicemotion", "deviceorientation", "gesturestart"];
const KEY_EVENTS = ["keydown", "keyup", "keypress"];

/**
 * The test browser registers listeners of its own on window and document; those are measured
 * on an empty page and left out. Without that measurement, known browser listeners on window are skipped.
 */
function browserOwn(run: RunData): (event: string, target: string, count: number) => boolean {
  const own = run.states?.browserListeners;
  return (event, target, count) => (own ? (own[event]?.[target] ?? 0) >= count : target === "window" && ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "mousemove", "touchstart", "touchend"].includes(event));
}

const MOTION_EVENTS = ["devicemotion", "deviceorientation"];

/**
 * The same listeners inside the frames of each page, counted on the spot. A criterion about
 * gestures or motion can only be "not applicable" when every frame was counted too; a frame
 * that could not be read is named, so it is known what stays open.
 */
function frameListenerTable(run: RunData): Record<string, unknown> {
  const fromBrowser = browserOwn(run);
  const counted = run.pages.some((page) => page.facts.frameListeners !== undefined);
  if (!counted) return { examined: false, note: "In deze run zijn de luisteraars in ingesloten vensters niet geteld." };
  const events = (frame: NonNullable<PageData["facts"]["frameListeners"]>[number], names: string[]): string[] =>
    names.flatMap((event) => Object.entries(frame.listeners[event] ?? {}).filter(([target, count]) => !fromBrowser(event, target, count)).map(([target]) => `${event} op ${target}`));
  const frames = run.pages.flatMap((page) => (page.facts.frameListeners ?? []).map((frame) => ({ page: page.label, frame })));
  const notInspected = run.pages.flatMap((page) => (page.facts.framesNotInspected ?? []).map((frame) => ({ page: page.label, address: frame.address, title: frame.title, reason: frame.reasonNl })));
  return {
    examined: true,
    method: "Op elke pagina zijn de luisteraars ook geteld in elk ingesloten venster dat erop staat, ook in vensters van een andere partij. Er is alleen meegelezen: geen venster is los geopend of bediend. Een venster dat niet uit te lezen was, staat met zijn adres onder notInspected.",
    framesCounted: frames.length,
    framesWithMotionListeners: frames.map(({ page, frame }) => ({ page, address: frame.address, title: frame.title, listeners: events(frame, MOTION_EVENTS) })).filter((entry) => entry.listeners.length > 0),
    framesWithGestureListeners: frames.map(({ page, frame }) => ({ page, address: frame.address, title: frame.title, listeners: events(frame, GESTURE_EVENTS.filter((event) => !MOTION_EVENTS.includes(event))) })).filter((entry) => entry.listeners.length > 0),
    framesWithoutListeners: group(run, (page) => (page.facts.frameListeners ?? []).filter((frame) => events(frame, GESTURE_EVENTS).length === 0).map((frame) => frame.address), (address) => address).map((entry) => ({ address: entry.example, pages: pagesText(entry.pages, run.pages.length) })),
    notInspected,
    everyFrameCounted: notInspected.length === 0,
  };
}

function listenerTable(run: RunData, events: string[]): { event: string; target: string; pages: string }[] {
  const fromBrowser = browserOwn(run);
  const rows = group(
    run,
    (page) => events.flatMap((event) => Object.entries(page.facts.listeners[event] ?? {}).filter(([target, count]) => !fromBrowser(event, target, count)).map(([target]) => `${event}|${target}`)),
    (value) => value,
  );
  return rows.map((entry) => ({ event: entry.example.split("|")[0]!, target: entry.example.split("|")[1]!, pages: pagesText(entry.pages, run.pages.length) }));
}

/** Which pointer, drag and motion events the page listens for: where gesture criteria can apply at all. */
export const pointer: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  method: "Elke registratie van een event listener is geteld vanaf het laden van de pagina, per soort event en per soort element.",
  gestureListeners: listenerTable(run, GESTURE_EVENTS),
  browserListenersSubtracted: run.states?.browserListeners !== undefined,
  moveListeners: listenerTable(run, ["touchmove", "pointermove", "mousemove", "drag", "dragstart", "dragover", "gesturestart", "gesturechange"]),
  motionListeners: listenerTable(run, MOTION_EVENTS),
  frames: frameListenerTable(run),
  draggableElements: run.inventory.totals.draggable ?? 0,
  downEventProbe: run.states?.downEvents
    ? {
        examined: true,
        method: "Op elk soort bedieningselement dat een listener voor het indrukken van de aanwijzer kan bereiken, is de muis ingedrukt, weggeschoven en elders losgelaten. Een element telt mee als het zelf, een element eromheen of zijn label luistert (`via: own`); welke elementen luisteren, is per element bijgehouden vanaf het laden van de pagina, dus één link met een listener maakt niet elke link een kandidaat. Luistert alleen het document of het venster, dan telt elk bedieningselement mee (`via: delegated`). De proef is gedaan op elke pagina in het standaardvenster, op één pagina per paginatype in een venster van 360 pixels breed (`coverage.narrowPages`) en in elke toestand uit het sitemodel (`coverage.states`), daar telkens voor de soorten die nieuw waren; `state` en `viewport` bij een uitkomst zeggen waar. Eén proef per soort. Elementen zijn één soort als ze er gelijk uitzien en zich vooraf gezien gelijk gedragen: dezelfde rol, of ze een toestand hebben, hetzelfde paginagebied en onderdeel, dezelfde grootte binnen een marge, hetzelfde uiterlijk in rust en bij aanwijzen en focus, en dezelfde code van de listeners voor het indrukken op het element, eromheen en op zijn label. Tekst, klassen en attributen tellen niet mee: zeventig aankruisvakjes van één lijst zijn één soort, wat het bijschrift ook is, en zo ook de links van één lijst met dezelfde code. `effectOnDown` zegt wat voor effect het indrukken had; `toestand` is een aangevinkte, ingedrukte of uitgeklapte toestand die wisselde. `coverage` zegt hoeveel soorten er zijn gevonden, hoeveel zijn onderzocht en welke niet. Na het indrukken (voor het loslaten) en na het loslaten elders is vergeleken wat er veranderde: tekst die verscheen of verdween, statusmeldingen, toestanden (aangevinkt, uitgeklapt, ingedrukt, waarde), dialogen, scrollpositie en adres. De eigen stijl en focus van het element tellen niet als reactie. undoneByReleasingElsewhere zegt of wat bij het indrukken gebeurde na het loslaten elders weer weg was.",
        targetsExamined: run.states.examined.downEventTargets ?? 0,
        coverage: run.states.downEventCoverage ?? { note: "Oudere run: de proef stopte na 40 soorten zonder te melden wat was overgeslagen, en sloeg pagina's over waar alleen het document luistert." },
        actedOnDown: run.states.downEvents.filter((entry) => entry.changeOnDown !== null),
        actedAfterReleaseElsewhere: run.states.downEvents.filter((entry) => entry.changeAfterReleaseElsewhere !== null),
        noReaction: run.states.downEvents.filter((entry) => entry.changeOnDown === null && entry.changeAfterReleaseElsewhere === null).length,
      }
    : { examined: false },
});

/**
 * Embedded players whose single-key shortcuts are documented: the address of the frame says
 * whether the site switched them off. That can be read without the player loading.
 */
const KNOWN_PLAYERS: { name: string; host: RegExp; off: (query: URLSearchParams) => boolean; parameter: string; keys: string }[] = [
  { name: "Vimeo", host: /(^|\.)player\.vimeo\.com$/, off: (query) => ["0", "false"].includes(query.get("keyboard") ?? ""), parameter: "keyboard=0", keys: "onder meer F (volledig scherm), M (geluid uit) en C (ondertiteling)" },
  { name: "YouTube", host: /(^|\.)youtube(-nocookie)?\.com$/, off: (query) => query.get("disablekb") === "1", parameter: "disablekb=1", keys: "onder meer K (afspelen en pauzeren), M (geluid uit), F (volledig scherm), J en L (terug en vooruit), C (ondertiteling) en de cijfers" },
];

export function knownPlayer(src: string | null): { player: string; singleKeyShortcuts: "aan" | "uitgezet"; parameterToSwitchOff: string; keys: string } | null {
  if (!src) return null;
  let url: URL;
  try {
    url = new URL(src, "https://example.invalid/");
  } catch {
    return null;
  }
  const player = KNOWN_PLAYERS.find((entry) => entry.host.test(url.hostname) && (entry.name !== "YouTube" || url.pathname.startsWith("/embed/")));
  return player ? { player: player.name, singleKeyShortcuts: player.off(url.searchParams) ? "uitgezet" : "aan", parameterToSwitchOff: player.parameter, keys: player.keys } : null;
}

export const keyShortcuts: Extractor = (run) => ({
  embeddedPlayers: {
    method: "Van elk ingesloten venster is het adres vergeleken met een lijst van bekende videospelers (Vimeo, YouTube). Die spelers hebben sneltoetsen van één teken die werken zodra de focus ergens in de speler staat, tenzij de site ze met een parameter in het adres uitzet. Dit is afgelezen van het adres; de speler hoeft er niet voor te laden. Andere spelers en vensters zijn niet herkend.",
    framesExamined: run.pages.reduce((sum, page) => sum + page.facts.iframes.length, 0),
    rows: group(run, (page) => page.facts.iframes.filter((frame) => knownPlayer(frame.src) !== null), (frame) => `${frame.src}`).map((entry) => ({ src: entry.example.src, ...knownPlayer(entry.example.src)!, pages: pagesText(entry.pages, run.pages.length) })),
    unrecognisedFrames: group(run, (page) => page.facts.iframes.filter((frame) => knownPlayer(frame.src) === null), (frame) => `${frame.src}`).map((entry) => ({ src: entry.example.src, title: entry.example.title, pages: pagesText(entry.pages, run.pages.length) })),
  },
  pagesExamined: run.pages.length,
  method: "Toetsenbord-listeners en accesskey-attributen geteld. Een listener op document of window kan een sneltoets zijn; welke toets, is hieruit niet af te leiden.",
  keyListeners: listenerTable(run, KEY_EVENTS),
  accesskeys: run.inventory.totals.accesskeys ?? 0,
});

const NOT_EXAMINED = { examined: false, note: "Het gedrag na interactie is in deze run niet onderzocht. Zonder dit onderdeel kan een criterium dat ervan afhangt geen 'passed' krijgen." };

/** Dialogs, side sheets and expanders: what happens to focus when they open and close. */
export const dialogs: Extractor = (run) =>
  run.states
    ? { examined: true, method: "Elke unieke knop die geen formulier verstuurt is één keer geactiveerd, eerst met Enter, dan met de spatiebalk, en pas daarna met een muisklik (zie activatedBy). Dat is gedaan op een breed scherm en, voor knoppen die alleen op een smal scherm bestaan, op 360 pixels breed (zie viewport). Opende er een dialoog, zijpaneel of uitklapper, dan is vastgelegd waar de focus heen ging, of Tab binnen bleef, of Escape sluit en of de focus terugkeert. Van elke geopende dialoog, uitklapper en elk geopend tabblad is een schermafbeelding gemaakt (screenshot); bij een uitklapper of tabblad staat de knop bovenaan en de geopende inhoud eronder. In runs van vóór deze toevoeging is screenshot bij uitklappers leeg. Bij een knop met kopiëren in naam of titel staat in clipboard wat de pagina tijdens het activeren naar het klembord schreef en of de browser het aannam; het klembord zelf is niet gelezen.", triggersExamined: run.states.examined.triggers, stepsNotExamined: run.states.skipped ?? [], dialogs: run.states.dialogs }
    : NOT_EXAMINED;

/**
 * The attempt a visitor makes, per form: what the form asks for filled in, the rest left empty.
 * A form without a field marked as required has no such attempt; its empty submission is that path.
 */
function regularPath(forms: FormErrorState[]): { note: string; silentForms: number; forms: Record<string, unknown>[] } {
  const rows = forms.map((form) => {
    const attempt = form.attempts.find((entry) => entry.input === REGULAR_PATH) ?? (form.fields.some((field) => field.required) ? undefined : form.attempts.find((entry) => entry.input === "leeg verstuurd"));
    const outcome = attempt?.outcome;
    return {
      page: form.page,
      form: form.form,
      openedVia: form.openedVia,
      attempt: attempt?.input ?? null,
      ...(outcome ? { request: outcome.request, requests: outcome.requests, message: outcome.message, pageChanged: outcome.pageChanged, nothing: outcome.nothing, outcome: outcome.nl } : { nothing: null, outcome: attempt?.failed ?? "niet vastgelegd: de poging ontbreekt of de run is van voor deze proef" }),
    };
  });
  return {
    note: "Per formulier de poging van een bezoeker: de verplichte velden gevuld met de vaste testwaarden, de optionele leeg, en dan versturen. Heeft een formulier geen veld dat als verplicht is gemarkeerd, dan is dat de poging 'leeg verstuurd'. `nothing: true` betekent dat er geen verzoek wegging, geen melding kwam en de pagina niet veranderde: de bezoeker kan niet zien of het formulier is verstuurd. Een tegengehouden verzoek (`request: tegengehouden`) bewijst dat het formulier verstuurt; wat de server antwoordt is dan niet gezien.",
    silentForms: rows.filter((row) => row.nothing === true).length,
    forms: rows,
  };
}

/** What a form does when it is submitted empty, with invalid input and the way a visitor fills it in; without permission the request itself is blocked. */
export const formErrors: Extractor = (run) =>
  run.states
    ? { examined: true, method: "Elk formulier is leeg en met ongeldige invoer verstuurd, en daarna zoals een bezoeker het doet: de verplichte velden gevuld met de vaste testwaarden en de optionele leeg (zie `regularPath`). Het verzoek naar de server is tegengehouden, behalve op een testomgeving waar versturen mag. Vastgelegd is welke velden als ongeldig zijn gemarkeerd, welke tekst erbij kwam, wat er in live-regio's werd gemeld, waar de focus heen ging en of het versturen een uitkomst had (`outcome`).", formsExamined: run.states.examined.forms, stepsNotExamined: run.states.skipped ?? [], regularPath: regularPath(run.states.formErrors), afterFilledSubmit: afterFilledSubmit(run), forms: run.states.formErrors }
    : NOT_EXAMINED;

/** Per state whose recipe fills in a form: the messages that appeared when the sweep sent it, with their region and the focus (4.1.3). */
function afterFilledSubmit(run: RunData): Record<string, unknown> {
  const states = reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.timeLimitsAfterSubmit);
  if (states.length === 0) return { examined: false, note: "Geen toestand uit het sitemodel vult een formulier in zonder het te versturen, of de run is van voor deze meting." };
  const labelOf = (url: string | null): string | null => run.pages.find((page) => page.item.url === url)?.label ?? null;
  return {
    examined: true,
    method:
      "Een toestand waarvan het recept een formulier invult zonder het te versturen, is opnieuw geopend en het formulier is verstuurd zoals een bezoeker dat doet (dezelfde verzending als voor de timers van 2.2.1). Vlak voor het versturen is elk gebied met `aria-live` of rol `status`, `alert` of `log` vastgelegd, ook een verborgen gebied; anderhalve seconde na het versturen staat per gebied met nieuwe tekst wat er staat, de rol en `aria-live`, en hoe het gebied ervoor was (`before`): `verborgen` (met `hiddenBefore`: hidden, display:none, visibility:hidden of aria-hidden, op het gebied of een omringend element), `leeg` (leeg in de pagina, het patroon dat schermlezers voorlezen), `andere tekst`, `niet in de pagina` (kwam samen met de melding), of `nieuw document` (het versturen laadde een andere pagina). `textBefore` is wat een verborgen gebied al in de code had. `focusInside` zegt of de focus op het gebied staat. Tekst die buiten zo'n gebied verscheen, staat in `textOutsideRegions`. Een melding met `candidateNl` is een kandidaat voor dit criterium (nummer `S-K..`): de rol alleen bewijst niet dat ze wordt voorgelezen.",
    states: states.map((state) => {
      const after = run.stateEvidence![state.id]!.timeLimitsAfterSubmit!;
      if (!after.submitted) return { state: state.id, page: labelOf(state.url), form: after.form, sent: false, notSentNl: after.notSubmittedNl };
      if (!after.messages) return { state: state.id, page: labelOf(state.url), form: after.form, sent: true, messagesRecorded: false, note: "Bij dit versturen zijn de meldingen niet vastgelegd: de run is van voor deze meting of het vastleggen mislukte." };
      return {
        state: state.id,
        page: labelOf(state.url),
        form: after.form,
        submitControl: after.submitControl,
        sent: true,
        navigated: after.navigated ? `naar ${after.urlAfter}` : "nee, op dezelfde pagina gebleven",
        writes: after.writesRefused > 0 ? `${after.writesRefused} verzoek(en) die iets kunnen wijzigen tegengehouden: dit is wat de pagina toont als het verzoek mislukt` : after.writesSent > 0 ? `${after.writesSent} verzoek(en) verstuurd naar de testomgeving` : "geen verzoek dat iets kan wijzigen",
        messages: after.messages.messages.map((message) => {
          const why = whyCandidateNl(message);
          return { ...message, ...(why ? { candidateNl: why } : {}) };
        }),
        textOutsideRegions: after.messages.textOutsideRegions,
        focusAfter: after.messages.focusAfter,
      };
    }),
  };
}

/** Reactions to single printable keys pressed with focus on the page body. */
export const singleKeys: Extractor = (run) => (run.states ? { examined: true, method: "Op elke pagina zijn, met de focus op de pagina zelf, alle letters, cijfers en gangbare leestekens één voor één ingedrukt. Elke reactie is vastgelegd: tekst die verschijnt of verdwijnt, een statusmelding, een toestand die wisselt (uitgeklapt, ingedrukt, aangevinkt, waarde), een dialoog, focus, scrollpositie of adres. Tekst die vanzelf verandert, zoals een klok, telt niet. Na elke reactie is verder gegaan op een verse pagina. In een run met een sitemodel zijn dezelfde toetsen ook ingedrukt in elke toestand uit dat model (`states`): elk onderdeel en proces zoals het recept het opent, en elke blokkade één keer. De focus blijft waar ze na het openen staat; staat ze in een invoerveld, dan is ze er eerst uit gehaald, omdat een letter daar invoer is en geen sneltoets. Na een reactie is de toestand opnieuw geopend voor de overige toetsen.", pagesExamined: run.states.singleKeys.pagesExamined, keysPressed: run.states.singleKeys.keysPressed, reactions: run.states.singleKeys.reactions.map(({ details: _details, ...reaction }) => reaction), states: run.siteModel ? (run.states.singleKeys.states ?? { examined: false, note: "In de toestanden van het sitemodel zijn in deze run geen toetsen ingedrukt." }) : { examined: false, note: "Deze run heeft geen sitemodel; er zijn geen toestanden om toetsen in te drukken." } } : NOT_EXAMINED);

const HOVER_METHOD_ALL = "Elk uniek bedieningselement op alle pagina's is met de muis aangewezen en met het toetsenbord gefocust. Verscheen er nieuwe content, dan is vastgelegd of Escape die sluit en of die blijft staan als de muis erop komt.";
const HOVER_METHOD_KINDS =
  "De bedieningselementen van alle pagina's zijn ingedeeld in soorten naar uiterlijk en gedrag (WCAG-EM 2.0, §4.1): dezelfde rol, in hetzelfde paginagebied en hetzelfde onderdeel, met dezelfde grootte binnen een marge, dezelfde kleuren, letter en rand in rust, dezelfde stijlregels bij aanwijzen, focus en indrukken, en dezelfde code van de listeners voor aanwijzen en focus. Klassen, id's en attributen tellen niet mee. Elementen van één soort delen dus de stijlregels en de code die bij aanwijzen of focus iets laten verschijnen. Van elke soort zijn er hooguit `perKind` met de muis aangewezen en met het toetsenbord gefocust; `sameKindNotPointedAt` telt de elementen die niet zelf zijn aangewezen omdat andere van hun soort dat wel zijn, en dat is geen gat in de meting. `kindsNotExamined` hoort 0 te zijn: alleen dan is elke soort onderzocht. Een knop met alleen een pictogram en elk element met een title, een beschrijving of een uitklapper (aria-describedby, aria-haspopup) is een soort op zich en dus altijd zelf aangewezen; `iconOnlyAndDescribed` noemt ze allemaal met wat er verscheen, ook als dat niets was. Ook aangewezen zijn onderdelen zonder bediening die meer content aankondigen: een afkorting, een term of een pictogram met een title of een beschrijving (`nonControlsPointedAt`; in de lijst met `nonControl`). Een title waarbij niets in de pagina verscheen, is de tooltip die de browser zelf tekent. De proef is herhaald op één pagina per paginatype in een venster van 360 pixels breed (`narrowPages`) en in elke toestand uit het sitemodel (`states`), telkens voor de elementen die daar nieuw waren. Verscheen er nieuwe content, dan staat ze onder `appearances`, met of Escape haar sluit; `state` en `viewport` zeggen waar.";

/** Content that appears on hover or focus, such as tooltips. */
export const hover: Extractor = (run) => {
  if (!run.states) return NOT_EXAMINED;
  const coverage = run.states.hoverCoverage;
  if (!coverage) return { examined: true, method: HOVER_METHOD_ALL, targetsExamined: run.states.examined.hoverTargets, appearances: run.states.hover };
  if (coverage.kinds === undefined) return { examined: true, method: HOVER_METHOD_ALL, targetsExamined: run.states.examined.hoverTargets, targetsFound: coverage.found, targetsNotExamined: coverage.notExamined, notExaminedExamples: coverage.notExaminedExamples, limit: coverage.limit, appearances: run.states.hover };
  return {
    examined: true,
    method: HOVER_METHOD_KINDS,
    controlsFound: coverage.found,
    kinds: coverage.kinds,
    perKind: coverage.perKind,
    targetsExamined: coverage.examined,
    kindsNotExamined: coverage.notExamined,
    sameKindNotPointedAt: coverage.sameKindNotExamined ?? 0,
    nonControlsPointedAt: coverage.nonControlsExamined ?? 0,
    ...(coverage.notExamined > 0 ? { notExaminedExamples: coverage.notExaminedExamples, limit: coverage.limit } : {}),
    iconOnlyAndDescribed: (coverage.iconOnly ?? []).map((entry) => ({ ...entry, contentAppeared: entry.contentAppeared.length > 0 ? entry.contentAppeared : "niets, bij aanwijzen noch bij focus" })),
    narrowPages: coverage.narrowPages ?? { examined: false, note: "In deze run is de proef niet herhaald in het smalle venster." },
    states: coverage.states ?? { examined: false, note: "In deze run is de proef niet gedaan in de toestanden van het sitemodel." },
    appearances: run.states.hover,
  };
};

const UNEVEN_BACKGROUND = {
  failed: "de achtergrond is niet egaal (foto of verloop); ook tegen de gunstigste achtergrondkleur onder de tekst haalt deze tekstkleur de eis niet (ratio is hier het beste geval)",
  passed: "de achtergrond is niet egaal (foto of verloop); ook tegen de ongunstigste achtergrondkleur onder de tekst haalt deze tekstkleur de eis (ratio is hier het slechtste geval)",
  cantTell: "de achtergrond is niet egaal (foto of verloop); het contrast ligt tussen het slechtste en het beste geval (worstRatio en bestRatio), en de eis wordt niet in beide gehaald, of een deel van de achtergrond heeft de kleur van de tekst",
};

type PageContrastRow = NonNullable<RunData["contrast"]>[number]["measurements"][number];

/** Text of links and buttons while pointed at and while focused, per combination of colours (WCAG 1.4.3). */
function hoverAndFocus(run: RunData): Record<string, unknown> {
  const label = new Map(run.pages.map((page) => [page.item.slug, page.label]));
  // Every link and button of the pages, in both schemes, measured by the contrast sweep; the hover probe adds the narrow window and the states.
  const swept = (run.contrast ?? []).filter((entry) => entry.width === undefined && entry.hoverFocus !== undefined);
  const fromSweep = swept.flatMap((entry) => entry.hoverFocus!.rows.map((row) => ({ ...row, page: label.get(entry.slug) ?? entry.slug, scheme: entry.scheme as string, state: undefined as string | undefined, viewport: undefined as string | undefined })));
  const fromProbe = (run.states?.hoverContrast ?? []).filter((entry) => swept.length === 0 || entry.state !== undefined || entry.viewport !== undefined).map((entry) => ({ ...entry, scheme: "light" }));
  const measured = [...fromSweep, ...fromProbe];
  if (swept.length === 0 && !run.states?.hoverContrast) return { examined: false, note: "De tekst van links en knoppen bij aanwijzen en bij focus is in deze run niet gemeten." };
  const combos = new Map<string, { scheme: string; trigger: string; foreground: string; background: string | null; ratio: number | null; required: number; outcome: string; reason: string | null; texts: number; examples: { page: string; control: string; text: string; where: string }[] }>();
  for (const entry of measured) {
    for (const text of entry.texts) {
      const key = [entry.scheme, entry.trigger, text.outcome, text.foreground, text.background, text.required, text.reason?.replace(/\d+%/, "")].join("|");
      const combo = combos.get(key) ?? { scheme: entry.scheme, trigger: entry.trigger, foreground: text.foreground, background: text.background, ratio: text.ratio, required: text.required, outcome: text.outcome, reason: text.reason, texts: 0, examples: [] };
      combos.set(key, combo);
      combo.texts++;
      if (combo.examples.length < (text.outcome === "passed" ? 1 : EXAMPLES)) combo.examples.push({ page: entry.state ?? entry.page, control: entry.control, text: text.text, where: entry.where });
    }
  }
  const of = (outcome: string) => [...combos.values()].filter((row) => row.outcome === outcome).sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0) || a.scheme.localeCompare(b.scheme) || a.trigger.localeCompare(b.trigger));
  const total = (outcome: string): number => of(outcome).reduce((sum, row) => sum + row.texts, 0);
  const coverage = run.states?.hoverCoverage;
  const perScheme = (scheme: string) => {
    const reports = swept.filter((entry) => entry.scheme === scheme).map((entry) => entry.hoverFocus!);
    return { pages: reports.length, linksAndButtonsMeasured: reports.reduce((sum, report) => sum + report.measured, 0), withoutTextOfTheirOwn: reports.reduce((sum, report) => sum + report.withoutText, 0) };
  };
  const probe = coverage?.kinds !== undefined ? { measuredInNarrowWindow: (coverage.narrowPages ?? []).length > 0, measuredInStates: (coverage.states ?? []).filter((state) => state.examined).map((state) => state.state) } : {};
  return {
    examined: true,
    method:
      swept.length > 0
        ? "Op elke pagina is elke link en knop met de muis aangewezen en, los daarvan, met het toetsenbord gefocust, in het lichte en in het donkere kleurenschema, in het standaardvenster. Een link of knop die op meer pagina's op dezelfde plek staat (in de kop, de voet of het menu), is op de eerste pagina gemeten; elke andere is op haar eigen pagina gemeten. Terwijl de aanwijzer of de focus erop stond, is van de tekst erin de kleur gelezen en de achtergrond afgelezen van een schermafbeelding van het venster, zoals bij de meting in rust. `linksAndButtons` telt per schema hoeveel er zijn gemeten en hoeveel geen eigen tekst hebben (een knop met alleen een pictogram: daar valt geen tekst te meten). Daarnaast zijn de links en knoppen die alleen in het smalle venster van 360 pixels of in een toestand uit het sitemodel staan, gemeten bij de proef met aanwijzen, in het lichte schema; die rijen hebben `scheme` licht en noemen de toestand."
        : coverage?.kinds === undefined
          ? "Elke unieke link en knop van de site is één keer met de muis aangewezen en één keer met het toetsenbord gefocust. Terwijl de aanwijzer of de focus erop stond, is van de tekst erin de kleur gelezen en de achtergrond afgelezen van een schermafbeelding van het venster, zoals bij de meting in rust. Een link of knop die op meer pagina's staat, is op de eerste pagina gemeten. Alleen in het lichte kleurenschema en in het standaardvenster."
          : "De links en knoppen van de site zijn ingedeeld in soorten naar uiterlijk en gedrag: dezelfde rol, in hetzelfde paginagebied en hetzelfde onderdeel, met dezelfde grootte binnen een marge, dezelfde kleuren in rust en dezelfde stijlregels bij aanwijzen en focus. Van elke soort zijn er hooguit `perKind` met de muis aangewezen en met het toetsenbord gefocust (`kinds`, `kindsNotExamined`; dat laatste hoort 0 te zijn). Terwijl de aanwijzer of de focus erop stond, is van de tekst erin de kleur gelezen en de achtergrond afgelezen van een schermafbeelding van het venster, zoals bij de meting in rust. Gemeten in het standaardvenster, op één pagina per paginatype in een venster van 360 pixels breed en in elke toestand uit het sitemodel. Alleen in het lichte kleurenschema.",
    schemes: swept.length > 0 ? ["light", "dark"].filter((scheme) => swept.some((entry) => entry.scheme === scheme)) : ["light"],
    ...(swept.length > 0 ? { linksAndButtons: { light: perScheme("light"), dark: perScheme("dark") } } : {}),
    controlsMeasured: new Set(measured.map((entry) => `${entry.scheme}|${entry.state ?? ""}|${entry.viewport ?? ""}|${entry.where}`)).size,
    ...(swept.length === 0 && coverage?.kinds === undefined
      ? coverage
        ? { controlsNotExamined: coverage.notExamined, limit: coverage.limit, notExaminedExamples: coverage.notExaminedExamples }
        : {}
      : coverage?.kinds !== undefined
        ? { kinds: coverage.kinds, perKind: coverage.perKind, kindsNotExamined: coverage.notExamined, ...(coverage.notExamined > 0 ? { limit: coverage.limit, notExaminedExamples: coverage.notExaminedExamples } : {}), ...probe }
        : {}),
    totals: { passed: total("passed"), failed: total("failed"), cantTell: total("cantTell"), exempt: total("exempt") },
    failed: of("failed"),
    cantTell: of("cantTell"),
    lowestPassing: of("passed").slice(0, 8),
  };
}


/** Measured contrast of all visible text, per combination of text colour and painted background. */
export const contrast: Extractor = (run) => {
  if (!run.contrast) return { examined: false, note: "Het contrast is in deze run niet gemeten." };
  const label = new Map(run.pages.map((page) => [page.item.slug, page.label]));
  const combos = new Map<string, { scheme: string; windows: Set<string>; foreground: string; background: string | null; ratio: number | null; required: number; outcome: string; reason: string | null; unevenBackground?: boolean; worstRatio?: number; bestRatio?: number; texts: number; pages: Set<string>; examples: { page: string; text: string; where: string; fontSizePx: number; bold: boolean; worstRatio?: number; bestRatio?: number; lightestBackground?: string; darkestBackground?: string; reason?: string | null }[] }>();
  for (const page of run.contrast) {
    for (const entry of page.measurements) {
      // Text on a photo has a background and ratios of its own: such texts form one row per text colour, with their range.
      const uneven = entry.range !== undefined;
      const reason = uneven ? UNEVEN_BACKGROUND[entry.outcome as "passed" | "failed" | "cantTell"] : entry.reason;
      const key = [page.scheme, entry.outcome, entry.foreground, uneven ? "uneven" : entry.background, entry.required, reason?.replace(/\d+%/, "")].join("|");
      const combo = combos.get(key) ?? { scheme: page.scheme, windows: new Set<string>(), foreground: entry.foreground, background: uneven ? null : entry.background, ratio: entry.ratio, required: entry.required, outcome: entry.outcome, reason, ...(uneven ? { unevenBackground: true } : {}), texts: 0, pages: new Set(), examples: [] };
      // The row shows the text that came closest to the other outcome: the best failure, the narrowest pass.
      if (uneven && entry.ratio !== null && combo.ratio !== null) combo.ratio = entry.outcome === "failed" ? Math.max(combo.ratio, entry.ratio) : Math.min(combo.ratio, entry.ratio);
      combos.set(key, combo);
      combo.texts++;
      // The same colours in the default window and at 320 wide are one row; `windows` says where they were seen.
      combo.windows.add(page.width === undefined ? "standaard" : `${page.width} breed`);
      combo.pages.add(label.get(page.slug) ?? page.slug);
      if (entry.range) {
        // Across the texts of one row: the lowest worst case and the highest best case.
        combo.worstRatio = Math.min(combo.worstRatio ?? Infinity, entry.range.worstRatio);
        combo.bestRatio = Math.max(combo.bestRatio ?? 0, entry.range.bestRatio);
      }
      // Text on a photo differs from place to place, so such a row shows more of its texts.
      if (combo.examples.length < (entry.outcome === "passed" ? 1 : uneven ? EXAMPLES * 3 : EXAMPLES) && !combo.examples.some((example) => example.text === entry.text)) {
        combo.examples.push({ page: label.get(page.slug) ?? page.slug, text: entry.text, where: entry.where, fontSizePx: entry.fontSizePx, bold: entry.bold, ...(entry.range ? { worstRatio: entry.range.worstRatio, bestRatio: entry.range.bestRatio, lightestBackground: entry.range.lightest, darkestBackground: entry.range.darkest, reason: entry.reason } : {}) });
      }
    }
  }
  const cantTellPages = new Set([...combos.values()].filter((combo) => combo.outcome === "cantTell").flatMap((combo) => [...combo.pages]));
  const rows = [...combos.values()].map((combo) => ({ ...combo, windows: [...combo.windows].sort().reverse(), pages: pagesText([...combo.pages].sort(), run.pages.length) }));
  const measuredIn = (scheme: string, width: number | null): number => run.contrast!.filter((page) => page.scheme === scheme && (page.width ?? null) === width).length;
  const failuresIn = (measured: { measurements: PageContrastRow[] } | undefined) =>
    (measured?.measurements ?? [])
      .filter((entry) => entry.outcome === "failed" && !(entry as { behindOverlay?: string }).behindOverlay)
      .slice(0, STATE_ISSUES)
      .map((entry) => ({ text: entry.text, foreground: entry.foreground, background: entry.background, ratio: entry.ratio, required: entry.required, where: entry.where }));
  const of = (outcome: string) => rows.filter((row) => row.outcome === outcome).sort((a, b) => (a.ratio ?? a.worstRatio ?? 0) - (b.ratio ?? b.worstRatio ?? 0) || a.scheme.localeCompare(b.scheme) || a.foreground.localeCompare(b.foreground));
  const total = (outcome: string): number => of(outcome).reduce((sum, row) => sum + row.texts, 0);
  return {
    examined: true,
    method: "Van elk zichtbaar stuk tekst is de tekstkleur uit de browser gelezen en de achtergrond afgelezen van de schermafbeelding: de meest voorkomende kleur binnen het vak van de tekst, de pixels van de letters zelf niet meegeteld. Daaruit is de contrastverhouding berekend, naar beneden afgerond op één decimaal. Grote tekst (24 pixels, of 18,66 pixels vet) moet 3:1 halen, andere tekst 4,5:1. Is de tekstkleur niet terug te vinden, dan is er niet gemeten. Is de achtergrond niet egaal (een foto of verloop), dan is er geen ene verhouding maar een slechtste en een beste geval: het contrast tegen de lichtste en tegen de donkerste achtergrondkleur onder de tekst die een wezenlijk deel van het vak beslaat (`worstRatio`, `bestRatio`). Haalt ook het beste geval de eis niet, dan is de uitkomst 'failed'; haalt ook het slechtste geval de eis, dan 'passed'; anders 'cantTell' met beide verhoudingen in `reason`. Gemeten in licht en donker kleurenschema, in de begintoestand van elke pagina, in het standaardvenster en op 320 pixels breed (`windows` per rij, `pagesMeasured`). Kleuren die op beide breedtes voorkomen, staan in één rij. Per toestand uit het sitemodel staat onder `states` wat daar in licht en in donker is gemeten; voor donker is de toestand opnieuw geopend. Onder `hoverAndFocus` staat de tekst van links en knoppen terwijl ze worden aangewezen en terwijl ze focus hebben.",
    pagesMeasured: { standardWindow: { light: measuredIn("light", null), dark: measuredIn("dark", null) }, width320: { light: measuredIn("light", SMALLEST_WIDTH), dark: measuredIn("dark", SMALLEST_WIDTH) } },
    states: reachedStates(run).map((state) => ({
      state: state.id,
      viewport: state.viewport ? `${state.viewport.width}x${state.viewport.height}` : null,
      light: state.contrast,
      failedLight: failuresIn(run.stateEvidence?.[state.id]?.contrast),
      ...(state.kind === "blocker"
        ? { dark: "een blokkade heeft eigen donkere toestanden (-dark)" }
        : { dark: state.contrastDark ?? null, failedDark: failuresIn(run.stateEvidence?.[state.id]?.contrastDark), ...(state.contrastDark ? {} : { darkNotMeasuredNl: state.variantsNotReached?.find((entry) => entry.variant.includes("contrastDark"))?.reasonNl ?? "in deze run niet gemeten" }) }),
    })),
    hoverAndFocus: hoverAndFocus(run),
    unevenBackgroundsMeasured: run.contrast.some((page) => page.measurements.some((entry) => entry.range !== undefined)),
    pagesExamined: run.pages.length,
    textsExamined: rows.reduce((sum, row) => sum + row.texts, 0),
    totals: { passed: total("passed"), failed: total("failed"), cantTell: total("cantTell"), exempt: total("exempt") },
    failed: of("failed"),
    cantTell: of("cantTell"),
    exempt: of("exempt"),
    lowestPassing: of("passed").slice(0, 8),
    passedCombinations: of("passed").length,
    // The pages the rows under cantTell are about, not one page per page type: those are the pictures a judge needs for them.
    screenshotsForCantTell: run.pages.filter((page) => cantTellPages.has(page.label)).slice(0, 12).map((page) => ({ page: page.label, light: `${page.dir}/screenshot-light.png`, dark: `${page.dir}/screenshot-dark.png` })),
  };
};

const MAX_FORCED_ROWS = 12;

/**
 * What disappeared from the pages when the browser forced its own colours: boundaries of controls and small drawings.
 * Forced colours are no requirement of WCAG, so these rows are leads for somebody to look at, never findings.
 */
function forcedColours(run: RunData, label: Map<string, string>): Record<string, unknown> {
  const probed = (run.contrast ?? []).flatMap((page) => (page.forced && !("error" in page.forced) ? [{ page: label.get(page.slug) ?? page.slug, forced: page.forced }] : []));
  if (probed.length === 0) return { examined: false, note: "De pagina's zijn in deze run niet met geforceerde kleuren bekeken." };
  const rows = <T extends { tag: string; where: string }>(pick: (forced: (typeof probed)[number]["forced"]) => T[], show: (item: T) => Record<string, unknown>) => {
    const groups = new Map<string, { item: T; pages: Set<string>; count: number }>();
    for (const { page, forced } of probed) {
      for (const item of pick(forced)) {
        const group = groups.get(`${item.tag}|${item.where}`) ?? { item, pages: new Set<string>(), count: 0 };
        groups.set(`${item.tag}|${item.where}`, group);
        group.pages.add(page);
        group.count++;
      }
    }
    const all = [...groups.values()].map((group) => ({ ...show(group.item), occurrences: group.count, pages: pagesText([...group.pages].sort(), run.pages.length), firstPage: [...group.pages].sort()[0] }));
    return { count: all.length, rows: all.slice(0, MAX_FORCED_ROWS) };
  };
  return {
    examined: true,
    status: "Geforceerde kleuren zijn geen eis van WCAG. Wat in die stand verdwijnt, is gemaakt met box-shadow, een achtergrond of een masker, en is een aanwijzing voor 1.4.11, 2.4.7 en 1.4.1 en een open punt: geen bevinding op zich.",
    method: "Elke pagina is in het lichte schema en het standaardvenster opnieuw bekeken met geforceerde kleuren, nagebootst door Chromium. Van elk bedieningselement is de grens voor en na vergeleken (3:1 tegen de omgeving, afgelezen op en net buiten de rand), en van elke kleine tekening of ze nog een tweede kleur heeft. De focusaanduiding is in deze stand niet in de veegronde gemeten: dat doet `loep forced`.",
    pagesExamined: probed.length,
    controlsExamined: probed.reduce((sum, { forced }) => sum + forced.controls, 0),
    drawingsExamined: probed.reduce((sum, { forced }) => sum + forced.drawings, 0),
    boundaryDisappears: rows((forced) => forced.boundaryDisappears, (item) => ({ tag: item.tag, text: item.text, where: item.where, ratioBefore: item.before, ratioForced: item.after, box: item.box })),
    drawingsDisappear: rows((forced) => forced.drawingsDisappear, (item) => ({ tag: item.tag, where: item.where, inControl: item.inControl, controlHasText: item.controlHasText, ratioBefore: item.before, box: item.box })),
  };
}

/** Contrast of control boundaries, small graphics and focus indicators (WCAG 1.4.11). */
export const uiContrast: Extractor = (run) => {
  if (!run.contrast) return { examined: false, note: "Het contrast van bedieningselementen en pictogrammen is in deze run niet gemeten." };
  const label = new Map(run.pages.map((page) => [page.item.slug, page.label]));
  const collect = <T extends { outcome: string }>(pick: (page: NonNullable<RunData["contrast"]>[number]) => T[], key: (item: T) => string, show: (item: T) => Record<string, unknown>) => {
    const groups = new Map<string, { item: T; scheme: string; count: number; pages: Set<string> }>();
    // The default window only: rows here carry no window size.
    for (const page of run.contrast!.filter((entry) => entry.width === undefined)) {
      for (const item of pick(page) ?? []) {
        const id = `${page.scheme}|${key(item)}`;
        const group = groups.get(id) ?? { item, scheme: page.scheme, count: 0, pages: new Set<string>() };
        groups.set(id, group);
        group.count++;
        group.pages.add(label.get(page.slug) ?? page.slug);
      }
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => ({ ...show(group.item), outcome: group.item.outcome, scheme: group.scheme, occurrences: group.count, pages: pagesText([...group.pages].sort(), run.pages.length), firstPage: [...group.pages].sort()[0] }));
  };
  const controls = collect((page) => page.controls, (control) => [control.tag, control.text.slice(0, 30), control.region, control.outside, control.edge, control.fill].join("|"), (control) => ({ tag: control.tag, text: control.text, region: control.region, outside: control.outside, edge: control.edge, fill: control.fill, edgeRatio: control.edgeRatio, fillRatio: control.fillRatio, box: control.box, where: control.where }));
  const graphics = collect((page) => page.graphics, (graphic) => [graphic.tag, graphic.inControl, graphic.region, graphic.background, graphic.foreground, `${graphic.box.width}x${graphic.box.height}`].join("|"), (graphic) => ({ tag: graphic.tag, size: `${graphic.box.width}x${graphic.box.height}`, region: graphic.region, inControl: graphic.inControl, controlHasText: graphic.controlHasText, background: graphic.background, foreground: graphic.foreground, ratio: graphic.ratio, box: graphic.box, where: graphic.where }));
  const withScheme = (page: PageData) => [...page.tabwalk.stops.map((stop) => ({ ...stop, scheme: "light" })), ...(page.tabwalkDark?.stops ?? []).map((stop) => ({ ...stop, scheme: "dark" }))];
  const stops = group(run, (page) => withScheme(page).filter((stop) => stop.indicatorRatio !== undefined && stop.indicatorRatio !== null), (stop) => `${stop.scheme}|${stop.tag}|${stop.region}|${stop.indicatorColour}|${stop.indicatorOver}`).map((entry) => ({ scheme: entry.example.scheme, tag: entry.example.tag, name: axName(entry.example) || entry.example.text.slice(0, 50), region: entry.example.region, indicatorColour: entry.example.indicatorColour, drawnOver: entry.example.indicatorOver, ratio: entry.example.indicatorRatio, pixelShare: entry.example.focusPixelShare, occurrences: entry.count, pages: pagesText(entry.pages, run.pages.length), screenshot: entry.example.focusScreenshot ? `${run.pages.find((page) => page.label === entry.pages[0])!.dir}/${entry.example.focusScreenshot}` : null }));
  const tally = (rows: { outcome: string; occurrences: number }[]) => Object.fromEntries(["duidelijk", "kandidaat", "tekstlink", "cantTell"].map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).reduce((sum, row) => sum + row.occurrences, 0)]));
  return {
    examined: true,
    method: "Van elk zichtbaar bedieningselement is op de schermafbeelding de kleur van de rand, van de vulling en van de omgeving afgelezen. Haalt de rand of de vulling 3:1 tegen de omgeving, dan is de begrenzing 'duidelijk'; anders is het een 'kandidaat' die bekeken moet worden. Een link zonder eigen rand of vlak telt als 'tekstlink': die herken je aan de tekst. Een begrenzing is niet verplicht: het criterium vraagt 3:1 alleen voor wat nodig is om het element te herkennen. Van kleine afbeeldingen en pictogrammen is de kleur die het meest afsteekt vergeleken met de achtergrond. Van de focusaanduiding is de kleur van wat er bij focus bij kwam vergeleken met wat eronder zat. Alle verhoudingen zijn naar beneden afgerond. Gemeten in licht en donker.",
    pagesExamined: run.pages.length,
    controls: { totals: tally(controls), candidates: controls.filter((row) => row.outcome === "kandidaat" || row.outcome === "cantTell"), clearExamples: controls.filter((row) => row.outcome === "duidelijk").slice(0, 6) },
    graphics: { totals: tally(graphics), candidates: graphics.filter((row) => row.outcome !== "duidelijk"), clearExamples: graphics.filter((row) => row.outcome === "duidelijk").slice(0, 6) },
    focusIndicators: { examined: stops.length > 0, darkSchemeExamined: run.pages.every((page) => page.tabwalkDark !== null), below3to1: stops.filter((stop) => (stop.ratio ?? 0) < 3), lowestPassing: stops.filter((stop) => (stop.ratio ?? 0) >= 3).sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0)).slice(0, 8), combinations: stops.length },
    forcedColours: forcedColours(run, label),
  };
};

/** Does focus alone ever change the context: by Tab, or by arrow keys inside a list or menu (WCAG 3.2.1). */
export const focusChanges: Extractor = (run) => ({
  pagesExamined: run.pages.length,
  tabWalk: {
    method: "Na elke Tab-stop is gecontroleerd of het adres van de pagina gelijk bleef. De wandeling stopt met 'navigated-on-focus' als dat niet zo is.",
    stopsExamined: run.pages.reduce((sum, page) => sum + page.tabwalk.stopCount, 0),
    pagesWhereFocusNavigated: run.pages.filter((page) => page.tabwalk.outcome === "navigated-on-focus").map((page) => ({ page: page.label, at: where(page.tabwalk.stops.at(-1)!) })),
  },
  arrowKeys: run.states?.arrowFocus
    ? {
        examined: true,
        method: "Elke reeks elementen die met de pijltjestoetsen focus krijgt, is opnieuw doorlopen. Na elke toetsaanslag is gecontroleerd of het adres en het aantal open vensters gelijk bleven.",
        listsExamined: run.states.arrowFocus.length,
        elementsFocused: run.states.arrowFocus.reduce((sum, entry) => sum + entry.steps, 0),
        contextChanges: run.states.arrowFocus.filter((entry) => entry.contextChange !== null),
      }
    : { examined: false, note: "Niet gemeten of focus via de pijltjestoetsen de context verandert." },
});

/** Checkboxes, switches, radio buttons and select lists after their value was changed. */
export const settings: Extractor = (run) =>
  run.states?.settings
    ? {
        examined: true,
        method: "Elk soort selectievakje, schakelaar, keuzerondje en keuzelijst is één keer gewijzigd: met de spatiebalk, of door een andere optie te kiezen. Vastgelegd is wat de toegankelijkheidsboom vóór en na meldt, en of het adres of het aantal open vensters veranderde. Dat is gedaan op de pagina zelf en in elke dialoog die de proef kon openen (openedVia).",
        controlsExamined: run.states.settings.length,
        stateNotReported: run.states.settings.filter((entry) => !entry.stateChanged),
        contextChanged: run.states.settings.filter((entry) => entry.contextChange !== null),
        examples: run.states.settings.filter((entry) => entry.stateChanged && entry.contextChange === null).slice(0, 12),
      }
    : { examined: false, note: "Niet gemeten wat er gebeurt als de waarde van een selectievakje, schakelaar of keuzelijst verandert." };

type Named = { tag: string; path: string[]; text: string; visible: boolean; region: string | null; ax?: { name: string | null; role: string | null; ignored: boolean } | null; coveredText?: string | null; labelText?: string | null; type?: string | null };

/**
 * The visible text of every link and control next to its accessible name (WCAG 2.5.3), in
 * the default window, at 320 wide and in each state of the model. Nothing is judged: the
 * rows say whether the one is found in the other as written.
 */
export const labelInName: Extractor = (run) => {
  const field = (element: Named): boolean => ["select", "textarea"].includes(element.tag) || (element.tag === "input" && !["submit", "button", "reset", "image"].includes(element.type ?? ""));
  // What a sighted user reads as the label: the element's own text, the card a link is stretched over, or the label of a field.
  const shown = (element: Named): string => (field(element) ? (element.labelText ?? "") : element.text || element.coveredText || "").replace(/\s+/g, " ").trim();
  const relation = (element: Named): string => {
    const [text, name] = [norm(shown(element)), norm(axName(element as never))];
    if (!name) return "noName";
    if (!text) return "noVisibleText";
    return text === name ? "equal" : name.includes(text) ? "contained" : "notContained";
  };
  const rows = new Map<string, { kind: string; tag: string; role: string | null; visibleText: string; accessibleName: string; relation: string; region: string | null; views: Set<string>; pages: Set<string>; occurrences: number; where: string }>();
  const examined: { view: string; page: string | null; elements: number }[] = [];
  const take = (view: string, page: string | null, links: Named[] | undefined, controls: Named[] | undefined): void => {
    const elements = [...(links ?? []).map((link) => ({ kind: "link", element: link })), ...(controls ?? []).map((control) => ({ kind: "control", element: control }))].filter(({ element }) => element.visible && !element.ax?.ignored);
    examined.push({ view, page, elements: elements.length });
    for (const { kind, element } of elements) {
      const key = [kind, element.tag, norm(axName(element as never)), norm(shown(element)), element.region].join("|");
      const row = rows.get(key) ?? { kind, tag: element.tag, role: element.ax?.role ?? null, visibleText: shown(element).slice(0, 120), accessibleName: axName(element as never).slice(0, 160), relation: relation(element), region: element.region, views: new Set<string>(), pages: new Set<string>(), occurrences: 0, where: where(element) };
      rows.set(key, row);
      row.views.add(view);
      if (page) row.pages.add(page);
      row.occurrences++;
    }
  };
  const labelOf = (url: string | null): string | null => run.pages.find((page) => page.item.url === url)?.label ?? null;
  for (const page of run.pages) take("standaard", page.label, page.facts.links, page.facts.controls);
  for (const page of run.pages) if (page.smallest) take("320 breed", page.label, page.smallest.links, page.smallest.controls);
  for (const state of reachedStates(run)) {
    const evidence = run.stateEvidence?.[state.id];
    if (evidence?.links || evidence?.controls) take(state.id, labelOf(state.url), evidence.links, evidence.controls);
  }
  const listed = [...rows.values()].map((row) => ({ ...row, views: [...row.views], pages: pagesText([...row.pages].sort(), run.pages.length) }));
  const of = (kind: string) => listed.filter((row) => row.relation === kind).sort((a, b) => a.accessibleName.localeCompare(b.accessibleName));
  const count = (view: string): { pages: number; elements: number } => ({ pages: examined.filter((entry) => entry.view === view).length, elements: examined.filter((entry) => entry.view === view).reduce((sum, entry) => sum + entry.elements, 0) });
  return {
    method: "Van elke zichtbare link en elk zichtbaar bedieningselement is de zichtbare tekst naast de toegankelijke naam gezet: de eigen tekst van het element, bij een link die over een kaart is gespannen de tekst van die kaart, bij een invoerveld de tekst van het label. Vergeleken is zonder hoofdletters en met witruimte samengevoegd: `equal` (gelijk), `contained` (de zichtbare tekst staat letterlijk in de naam), `notContained` (staat er niet letterlijk in), `noVisibleText` (geen tekst gevonden: een pictogram of afbeelding, kijk zelf) en `noName`. Tekst in een afbeelding is niet gelezen. Gedaan in het standaardvenster, op 320 pixels breed en in elke toestand uit het sitemodel; `views` zegt per rij waar het element zo voorkwam. Een verschil in leestekens of een afgebroken woord geeft `notContained`: beoordeel die rijen zelf.",
    examined: { standardWindow: count("standaard"), width320: run.pages.some((page) => page.smallest) ? count("320 breed") : { examined: false, note: "Op 320 pixels breed is in deze run niet vergeleken." }, states: examined.filter((entry) => entry.view !== "standaard" && entry.view !== "320 breed").map((entry) => ({ state: entry.view, capturedOn: entry.page, elements: entry.elements })) },
    uniqueElements: listed.length,
    totals: Object.fromEntries(["equal", "contained", "notContained", "noVisibleText", "noName"].map((kind) => [kind, of(kind).length])),
    notContained: of("notContained"),
    noVisibleText: of("noVisibleText").map(({ visibleText: _text, relation: _relation, ...row }) => row),
    noName: of("noName").map(({ accessibleName: _name, relation: _relation, ...row }) => row),
    contained: of("contained").map(({ kind, tag, visibleText, accessibleName, views, pages }) => ({ kind, tag, visibleText, accessibleName, views, pages })),
    // Visible text and name are the same: the text once, with where it was seen when that is not everywhere.
    equal: of("equal").map((row) => (row.views.length === 1 && row.views[0] !== "standaard" ? `${row.visibleText} [${row.kind}, alleen ${row.views[0]}]` : `${row.visibleText} [${row.kind}]`)),
  };
};

type Order = NonNullable<PageData["order"]>;
const ORDER_ROWS = 30;

/** The places where the code and the screen disagree on one order measurement, grouped over the pages or states it was made on. */
function orderTable(sources: { label: string; order: Order }[], total: number): Record<string, unknown> {
  const of = { pages: sources.map((source) => ({ label: source.label })) } as unknown as RunData;
  const pick = <T>(select: (order: Order) => T[]) => (page: PageData) => select(sources.find((source) => source.label === page.label)!.order);
  const moved = (select: (order: Order) => (Order["cssOrder"][number] | Order["reversed"][number] | Order["positioned"][number])[], detail: (item: never) => Record<string, unknown>) =>
    group(of, pick(select), (item) => `${item.path.join(" >>> ")}|${item.text}`).slice(0, ORDER_ROWS).map((entry) => ({ tag: entry.example.tag, text: entry.example.text, region: entry.example.region, ...detail(entry.example as never), on: pagesText(entry.pages, total), where: entry.example.path.join(" >>> ") }));
  const jumps = group(of, (page) => {
    const order = sources.find((source) => source.label === page.label)!.order;
    return order.jumps.map((jump) => ({ jump, from: order.sequence[jump.from - 1], to: order.sequence[jump.to - 1] }));
  }, (row) => `${row.from?.path.join(" >>> ")}|${row.to?.path.join(" >>> ")}|${row.jump.direction}`)
    .slice(0, ORDER_ROWS)
    .map((entry) => ({ direction: entry.example.jump.direction, from: entry.example.from ? `${entry.example.from.kind} ${entry.example.from.tag} "${entry.example.from.text}"` : null, to: entry.example.to ? `${entry.example.to.kind} ${entry.example.to.tag} "${entry.example.to.text}"` : null, on: pagesText(entry.pages, total), where: entry.example.to?.path.join(" >>> ") ?? null }));
  return {
    measured: sources.length,
    perPlace: sources.map((source) => ({ on: source.label, controlsAndHeadings: source.order.sequence.length, jumps: source.order.jumps.length, cssOrder: source.order.cssOrder.length, reversed: source.order.reversed.length, positioned: source.order.positioned.length, positiveTabindex: source.order.positiveTabindex.length })),
    jumps,
    cssOrder: moved((order) => order.cssOrder, (item: Order["cssOrder"][number]) => ({ order: item.order })),
    reversed: moved((order) => order.reversed, (item: Order["reversed"][number]) => ({ flexDirection: item.flexDirection, flexWrap: item.flexWrap })),
    positioned: moved((order) => order.positioned, (item: Order["positioned"][number]) => ({ position: item.position })),
  };
}

/**
 * The order of the code against the order on screen (WCAG 1.3.2), on every page in the default
 * window and at 320 pixels wide and in every state of the site model, and text laid out with
 * spaces or hard line breaks. Candidates for a reviewer, not findings.
 */
export const readingOrder: Extractor = (run) => {
  const wide = run.pages.filter((page) => page.order).map((page) => ({ label: page.label, order: page.order! }));
  const narrow = run.pages.filter((page) => page.order320).map((page) => ({ label: page.label, order: page.order320! }));
  const states = reachedStates(run).filter((state) => run.stateEvidence?.[state.id]?.order).map((state) => ({ label: state.id, order: run.stateEvidence![state.id]!.order! }));
  const spaced = run.pages.filter((page) => page.spacedText);
  return {
    method: "Op elke pagina is de volgorde van de code naast de plek op het scherm gelegd, in het standaardvenster van 1280 pixels en op 320 pixels breed, en in elke toestand uit het sitemodel, zoals `loep order` dat doet. `jumps` is een plek waar het volgende bedieningselement of de volgende kop in de code op het scherm hoger of links van de vorige staat; `cssOrder`, `reversed` en `positioned` zijn elementen die CSS van hun plek in de code haalt (de eigenschap order, een omgedraaide flex-richting, absolute of vaste plaatsing). Elke rij is een kandidaat: een sprong bij kolommen of een vastgezette knop hoort er vaak bij. `on` zegt op welke pagina's of in welke toestanden de rij voorkwam; `perPlace` geeft de tellingen per pagina of toestand. Onder `spacedText` staat tekst die met spaties of harde regeleinden is opgemaakt in plaats van met opmaak: een woord met losse letters, en regels met kolommen van meer spaties, tabs of harde spaties, of tussen regeleinden. Tekst in code (`inCode`) is daar meestal bedoeld.",
    wide: wide.length > 0 ? { examined: true, ...orderTable(wide, run.pages.length) } : { examined: false, note: "De volgorde is in deze run niet per pagina gemeten." },
    at320: narrow.length > 0 ? { examined: true, ...orderTable(narrow, run.pages.length) } : { examined: false, note: "De volgorde is in deze run niet op 320 pixels breed gemeten." },
    states: states.length > 0 ? { examined: true, ...orderTable(states, states.length) } : { examined: false, note: run.siteModel ? "De volgorde is in deze run niet in de toestanden van het sitemodel gemeten." : "Deze run heeft geen sitemodel." },
    spacedText:
      spaced.length > 0
        ? {
            examined: true,
            pagesSearched: spaced.length,
            candidates: group({ ...run, pages: spaced }, (page) => page.spacedText!.candidates, (item) => `${item.path.join(" >>> ")}|${item.lines.join("|")}`).map((entry) => ({ kind: entry.example.kind, tag: entry.example.tag, inCode: entry.example.inCode, lines: entry.example.lines, region: entry.example.region, pages: pagesText(entry.pages, spaced.length), where: entry.example.path.join(" >>> ") })),
          }
        : { examined: false, note: "In deze run is niet gezocht naar tekst die met spaties of harde regeleinden is uitgelijnd." },
  };
};

export const EXTRACTORS: Record<string, Extractor> = {
  readingOrder,
  documents,
  labelInName,
  siteStates,
  settings,
  focusChanges,
  uiContrast,
  contrast,
  dialogs,
  formErrors,
  singleKeys,
  hover,
  bypass,
  motion,
  timing,
  pointer,
  keyShortcuts,
  legend,
  engine,
  inventoryCounts,
  titles,
  language,
  headings,
  landmarks,
  images,
  links,
  controls,
  keyboard,
  reflow,
  zoom,
  orientation,
  textSpacing,
  targetSize,
  consistency,
  forms,
  tables,
  screenshots,
  viewport,
};
