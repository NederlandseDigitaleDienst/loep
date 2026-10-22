import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { startedDownload } from "../lib/documents.ts";
import { enginesWithoutResult, type EngineRun } from "../lib/engines.ts";
import { expectedFocusable, pageCoverage, reachedByKeyboard, representativePages, stateCoverage } from "../lib/extractors.ts";
import { type Manifest, type ManifestStep, stepStart, writeManifest } from "../lib/manifest.ts";
import { readTemplate } from "../lib/templates.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { notFoundProbes, siteHosts, siteLabel } from "../lib/origins.ts";
import { uncoveredOperables, type CountedPage } from "../lib/operables.ts";
import { loadRun, type PageData, type RunData } from "../lib/rundata.ts";
import { acceptedGapFor, frameAddress, frameEntry, frameStanding, NOT_OPENED_ON_PAGE_TYPE, notOpenedAdviceNl, pageTypeOf, type AcceptedGapDecider, type Component } from "../lib/sitemodel.ts";
import { isLasting, refusedRunNl } from "../session/blockade.ts";
import { drawMarks } from "../session/marks.ts";
import { coversContent, type Overlay } from "../session/recipe.ts";

/**
 * The evidence gate: is what the sweep collected good enough to judge a site on? First
 * fixed checks on the numbers, then an agent that looks at one sheet of pictures per page
 * type and answers a fixed list of questions. A run that does not pass goes back to the
 * explorer with the gaps, or, when a new sweep can close them, to the sweep; it does not go
 * on to the judging.
 */

/** A page counts for the Tab check when it has at least this many links and controls. */
export const MIN_FOCUSABLE_FOR_SHARE = 5;
/** Below this share of links and controls reached with the keyboard, the walk did not get to the page. */
export const MIN_TAB_REACH = 0.5;
/** Below this share of components and processes of the site model that opened, the model does not describe the site. */
export const MIN_COMPONENTS_OPENED = 0.8;
/** A fixed or sticky element that takes more than this share of the window covers the page, when it lies over text or controls of the page. */
export const MAX_OVERLAY_SHARE = 0.15;
/** ...and when that is so on more than this share of the pages, it is not one page's design but something over the site. */
export const OVERLAY_PAGE_SHARE = 0.5;
/** How often an insufficient run may go back to the explorer. */
export const MAX_RETURNS_TO_EXPLORER = 2;
/** How often the sweep may run again after one round of the explorer before what it still could not measure goes to the explorer. */
export const MAX_RESWEEPS = 2;
/** How many sheets one reviewing agent gets. Every page type has a sheet; a site with more page types than this gets more than one task, each with answers of its own. */
export const SHEETS_PER_TASK = 8;
/** A walk whose stops all lie in one block, on a page with at least twice as many visible links and controls, never got out of that block. */
export const CONTAINED_WALK_FACTOR = 2;

export interface Gap {
  /** Name of the check that found it. */
  check: string;
  /** Label of the page in the sample, when the gap is on one page. */
  page: string | null;
  url: string | null;
  /** "default" for the page as the sweep measured it, or the id of a state of the site model. */
  state: string;
  /** Id of the component of the site model, for a gap about one component. */
  component?: string;
  /** What is missing, in Dutch: this is what the explorer reads. */
  missingNl: string;
  measured?: Record<string, unknown>;
  /** Who can close it: "sweep" when running the sweep again can (a measurement failed, timed out or is missing), "explorer" otherwise. Absent in a gate.json from before this was asked. */
  fixedBy?: "sweep" | "explorer";
}

export interface Check {
  name: string;
  ok: boolean;
  noteNl: string;
}

export interface Tile {
  nr: number;
  /** "default", "narrow", "taborder", or the id of a captured state. */
  state: string;
  file: string;
  descriptionNl: string;
}

export interface Sheet {
  pageType: string;
  page: string;
  url: string;
  file: string;
  sha256: string;
  tiles: Tile[];
  componentsNl: string[];
  /** Components the site model has on every page (`"pageTypes": "all"`), named apart so a reviewer does not take them for missing. Absent when there are none. */
  everywhereNl?: string[];
  /** The processes of the site model that belong to this page type. Absent in older runs. */
  processesNl?: string[];
  /** Players and self-moving content the site model names for this page type. */
  contentNl?: string[];
  /** The embedded windows on this page that the site model classifies under `frames`, of whatever class. */
  framesNl?: string[];
  /** The single-character keys the page reacted to in the sweep, with what changed. Absent in older runs. */
  keysNl?: string[];
}

export interface Gate {
  sufficient: boolean;
  /**
   * deterministic: the fixed checks found gaps the review does not wait for, because a new sweep has to close them first or no
   * return to the explorer is left. review-pending: the pictures have not been judged yet; gaps of the fixed checks that only the
   * explorer can close may be open, so that a return hands him every gap at once. complete: both were done.
   */
  stage: "deterministic" | "review-pending" | "complete";
  /** What comes next: on to the tasks, the review of the pictures, the sweep again, back to the explorer, or no evaluation. Absent in a gate.json from before this was asked. */
  next?: "proceed" | "review" | "sweep" | "explore" | "stop";
  /** How many times the explorer has been given a task for this run, and how often the run may still go back. */
  exploreRound: number;
  returnsLeft: number;
  /** How many times collect ran again since the last task for the explorer, and how often a gap the sweep can close may still send the run back to the sweep. */
  resweeps?: number;
  resweepsLeft?: number;
  hasSiteModel: boolean;
  thresholds: Record<string, number>;
  checks: Check[];
  gaps: Gap[];
  /** Gaps the explorer confirmed as a property of the site; they do not make the evidence insufficient. */
  accepted: (Gap & { reasonNl: string; observation: string; decidedBy: AcceptedGapDecider })[];
  warnings: Gap[];
  /** What cannot be examined at all with the limits an evaluation keeps to, such as content that only loads with a write request. It does not send the run back; it has to reach the report. */
  limitations: Gap[];
  /** What the reviewing agent saw and wanted to pass on, without it counting for or against the evidence. */
  remarks: { pageType: string; remarkNl: string }[];
  review: {
    /** The first task and where its answers go; the only one for a site with at most SHEETS_PER_TASK page types. */
    task: string;
    answers: string;
    /** Every task of the review, each for an agent of its own. */
    tasks: { task: string; answers: string; pageTypes: string[] }[];
    answered: boolean;
    sheets: Sheet[];
    /** Page types nobody can look at: there is no picture of any of their pages. Each is a gap of the check "sheets". */
    withoutSheet: string[];
    /** Where the remarks of the review are kept for the walk-through and the judges. */
    candidates: string;
  };
}

const THRESHOLDS = { MIN_FOCUSABLE_FOR_SHARE, MIN_TAB_REACH, MIN_COMPONENTS_OPENED, MAX_OVERLAY_SHARE, OVERLAY_PAGE_SHARE, MAX_RETURNS_TO_EXPLORER, MAX_RESWEEPS };
const percent = (share: number): string => `${Math.round(share * 100)}%`;
const where = (element: { path: string[] }): string => element.path.join(" >>> ");

/** What a reason says when the browser or the machine failed the measurement, not the site model: a crash, a time limit, a page that gave no answer. */
const MEASUREMENT_FAILED = /geen antwoord binnen \d+ seconden|crash|Timeout \d+ ?ms exceeded|has been closed/i;

/** "sweep" when a new sweep can close a gap with this reason. */
export function fixedByReason(reasonNl: string | null | undefined): "sweep" | "explorer" {
  return reasonNl && MEASUREMENT_FAILED.test(reasonNl) ? "sweep" : "explorer";
}

const plain = (text: string): string => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * Where the sweep opened a component that the explorer could not open, because it is only on
 * screen between the widths every page is measured at: the controls the widths probe found
 * there and opened, on a page of a type the component stands on, whose visible name the model
 * uses for the component. When more controls carry that name, the ones whose region the model
 * names as well are taken. Empty when there is no such opening.
 */
export function openedBetweenWidths(run: RunData, component: Pick<Component, "id" | "descriptionNl" | "pageTypes">): { page: string; width: number; control: string; showed: string[] }[] {
  const model = run.siteModel;
  if (!model) return [];
  const said = plain(`${component.id.replace(/-/g, " ")} ${component.descriptionNl}`);
  const urls = new Set(model.pageTypes.filter((type) => component.pageTypes.includes(type.id)).flatMap((type) => type.pages));
  const found: { page: string; width: number; control: string; showed: string[]; regionNamed: boolean }[] = [];
  for (const page of run.pages.filter((entry) => urls.has(entry.item.url) && entry.widths)) {
    for (const at of page.widths!.measuredAt) {
      for (const opened of at.opened) {
        const showed = [...opened.controls, ...opened.text];
        if (opened.failedNl || showed.length === 0) continue;
        const [, name = "", region = ""] = /^\S+ "(.*)" \[(.*)\]$/.exec(opened.control) ?? [];
        if (plain(name).trim() === "" || !said.includes(plain(name))) continue;
        const regionName = region.includes(":") ? region.slice(region.indexOf(":") + 1) : "";
        found.push({ page: page.label, width: at.width, control: opened.control, showed, regionNamed: regionName !== "" && said.includes(plain(regionName)) });
      }
    }
  }
  const named = found.filter((entry) => entry.regionNamed);
  return (named.length > 0 ? named : found).map(({ regionNamed: _regionNamed, ...entry }) => entry);
}

/** The fixed checks. Pure: the same run data always gives the same gaps. */
export function gateChecks(run: RunData): { checks: Check[]; gaps: Gap[]; warnings: Gap[]; limitations: Gap[] } {
  const checks: Check[] = [];
  const gaps: Gap[] = [];
  const warnings: Gap[] = [];
  const limitations: Gap[] = [];
  const model = run.siteModel ?? null;
  const on = (page: PageData): Pick<Gap, "page" | "url"> => ({ page: page.label, url: page.item.url });
  const add = (name: string, found: Gap[], okNote: string): void => {
    gaps.push(...found);
    checks.push({ name, ok: found.length === 0, noteNl: found.length === 0 ? okNote : `${found.length} ${found.length === 1 ? "gat" : "gaten"}` });
  };

  // 1. Pages that did not load: what was recorded for them is an error page.
  const probes = notFoundProbes(run.inventory);
  const notFound = (page: PageData): boolean => probes.includes(page.item.url) || /404/.test(page.item.reason);
  const loadFailed = run.pages.filter((page) => !notFound(page) && (page.item.status === null || page.item.status >= 400));
  // An embedded window that the model names as a component nobody can operate (no recipe, with the reason) does not load for
  // the tools either: that is the same limitation as frame-not-operated below, not a gap the explorer can close.
  const unoperable = (page: PageData): Component | null => {
    if (!model || page.item.kind !== "embedded") return null;
    let address: string;
    try {
      address = frameAddress(page.item.url);
    } catch {
      return null;
    }
    return model.components.find((component) => component.recipe === null && component.frame !== undefined && frameAddress(component.frame) === address) ?? null;
  };
  const failed = loadFailed.filter((page) => !unoperable(page));
  for (const page of loadFailed.filter((entry) => unoperable(entry))) {
    limitations.push({ check: "frame-not-loaded", ...on(page), state: "default", missingNl: `Dit ingesloten venster gaf bij het laden ${page.item.status === null ? "geen antwoord" : `status ${page.item.status}`}. Het sitemodel noemt het als onderdeel "${unoperable(page)!.id}" dat niet te bedienen is; wat in het venster staat, is niet gemeten.`, measured: { status: page.item.status } });
  }
  add(
    "pages-loaded",
    [
      ...failed.map((page) => ({ check: "pages-loaded", ...on(page), state: "default", missingNl: `De pagina gaf bij het laden ${page.item.status === null ? "geen antwoord" : `status ${page.item.status}`}. Wat is vastgelegd, is een foutpagina.`, measured: { status: page.item.status } })),
      ...(run.collectFailed ?? []).map((entry) => ({ check: "pages-loaded", page: entry.label, url: entry.item.url, state: "default", missingNl: `De veegronde kon deze pagina ook bij een tweede poging niet meten (${entry.error.slice(0, 160)}). Er is geen bewijs van deze pagina; draai collect opnieuw voor deze pagina.`, measured: { collectError: entry.error }, fixedBy: "sweep" as const })),
      ...run.inventory.skipped.filter((entry) => entry.reason.startsWith("failed to load") && !startedDownload(entry.reason)).map((entry) => ({ check: "pages-loaded", page: null, url: entry.url, state: "default", missingNl: `De pagina laadde niet tijdens de inventaris en is niet onderzocht (${entry.reason.slice(0, 120)}).` })),
    ],
    `${run.pages.length} pagina's geladen`,
  );
  // An origin that refused the evaluation for the rest of the run: what the sweep had to measure after that is missing.
  add(
    "site-answered",
    (run.blockades ?? []).filter(isLasting).map((entry) => ({ check: "site-answered", page: null, url: entry.url, state: "default", missingNl: refusedRunNl(entry), measured: { origin: entry.origin, reason: entry.reason, at: entry.at } })),
    "geen origin heeft verzoeken van het onderzoek geweigerd",
  );
  // Left under skipped by an inventory from before such downloads were counted as documents, or on an origin outside the run.
  for (const entry of run.inventory.skipped.filter((candidate) => candidate.reason.startsWith("failed to load") && startedDownload(candidate.reason))) {
    warnings.push({ check: "download-not-a-page", page: null, url: entry.url, state: "default", missingNl: "Dit adres is geen pagina: de browser bood het aan als download. De inventaris telde het niet als document, dus het staat niet bij de documenten en is niet onderzocht." });
  }

  // 2. Frames that are counted as pages.
  const embedded = run.pages.filter((page) => page.item.kind === "embedded");
  const frameGaps: Gap[] = [];
  if (model) {
    for (const page of embedded) {
      const entry = frameEntry(model, page.item.url);
      if (!entry) frameGaps.push({ check: "frames-as-pages", ...on(page), state: "default", missingNl: "Dit ingesloten venster is in het sitemodel niet ingedeeld en telt nu als pagina. Deel het in onder frames." });
      else if (!frameStanding(entry).counts) frameGaps.push({ check: "frames-as-pages", ...on(page), state: "default", missingNl: `Dit venster telt volgens het sitemodel niet mee (${frameStanding(entry).labelNl}) en hoort geen pagina te zijn. Maak de steekproef opnieuw nadat het sitemodel is gecontroleerd.` });
    }
  }
  add("frames-as-pages", frameGaps, `${embedded.length} ingesloten ${embedded.length === 1 ? "venster telt" : "vensters tellen"} als pagina${model ? ", alle ingedeeld als venster dat meetelt" : ""}`);

  // 3. How much of each page the Tab walk reached.
  const reachGaps: Gap[] = [];
  let lowest = 1;
  for (const page of run.pages) {
    const expected = expectedFocusable(page);
    if (expected.length < MIN_FOCUSABLE_FOR_SHARE) continue;
    const reached = reachedByKeyboard(page);
    const share = expected.filter((element) => reached.has(where(element))).length / expected.length;
    lowest = Math.min(lowest, share);
    if (share < MIN_TAB_REACH) {
      const stops = page.tabwalk.stops;
      const inside = stops.length > 0 ? ` De ${stops.length} stops begonnen bij ${where(stops[0]!).slice(0, 80)}.` : "";
      reachGaps.push({ check: "tab-reach", ...on(page), state: "default", missingNl: `De Tab-proef bereikte ${percent(share)} van de ${expected.length} links en bedieningselementen (${stops.length} stops, uitkomst ${page.tabwalk.outcome}).${inside} Zoek uit wat de focus vasthoudt of wat over de pagina ligt.`, measured: { share: Math.round(share * 100) / 100, expected: expected.length, stops: stops.length, outcome: page.tabwalk.outcome } });
    }
  }
  add("tab-reach", reachGaps, `laagste aandeel bereikt op een pagina: ${percent(lowest)}`);

  // 3b. A walk that went round inside one block, such as a banner that holds focus, says "completed" and saw nothing of the page.
  const containedGaps: Gap[] = [];
  for (const page of run.pages) {
    const stops = page.tabwalk.stops;
    const visible = [...page.facts.links, ...page.facts.controls].filter((element) => element.visible).length;
    if (stops.length < 1 || visible < MIN_FOCUSABLE_FOR_SHARE || visible < CONTAINED_WALK_FACTOR * stops.length) continue;
    const block = commonBlock(stops.map((stop) => where(stop)));
    if (block) containedGaps.push({ check: "tab-contained", ...on(page), state: "default", missingNl: `Alle ${stops.length} Tab-stops liggen in één blok (${block.slice(0, 100)}), terwijl de pagina ${visible} zichtbare links en bedieningselementen heeft. De Tab-proef is dat blok niet uit gekomen (uitkomst ${page.tabwalk.outcome}); de pagina zelf is met het toetsenbord niet onderzocht. Is dit een blokkade, neem haar dan op in het sitemodel.`, measured: { stops: stops.length, visible } });
  }
  add("tab-contained", containedGaps, "geen Tab-proef bleef binnen één blok");

  // 3c. What the sweep owes for every page.
  const coverageGaps: Gap[] = [];
  for (const page of run.pages) {
    const missing = Object.entries(pageCoverage(page, run))
      .filter(([name, there]) => !there && (model !== null || name !== "tabWalkWithFocusNarrow") && name !== "blockersClosed" && name !== "interactionProbe" && !name.startsWith("contrast"))
      .map(([name]) => name);
    if (missing.length > 0) coverageGaps.push({ check: "coverage", ...on(page), state: "default", missingNl: `Voor deze pagina ontbreken metingen van de veegronde: ${missing.join(", ")}. Draai collect opnieuw.`, measured: { missing }, fixedBy: "sweep" });
    const withoutContrast = Object.entries(pageCoverage(page, run)).filter(([name, there]) => !there && name.startsWith("contrast")).map(([name]) => name);
    if (run.contrast && withoutContrast.length > 0) coverageGaps.push({ check: "coverage", ...on(page), state: "default", missingNl: `Voor deze pagina ontbreekt de contrastmeting in licht of donker, in het standaardvenster of op 320 pixels breed (${withoutContrast.join(", ")}). Draai contrast opnieuw.`, measured: { missing: withoutContrast }, fixedBy: "sweep" });
  }
  for (const state of run.siteStates?.states ?? []) {
    if (!state.reached) continue;
    // A state that did not open a second time, with the wider spacing or on the dark scheme, was tried: that is told, and running the sweep again does not change it.
    const triedInVain = (name: string): boolean => (state.variantsNotReached ?? []).some((entry) => name.startsWith(entry.variant));
    const owed = Object.entries(stateCoverage(state, run)).filter(([name, there]) => !there && name !== "singleKeys" && !triedInVain(name)).map(([name]) => name);
    const missing = [...["screenshot", "engines", "facts", "tabwalk"].filter((name) => !state.files[name]), ...owed.filter((name) => name !== "visibleTextAndNames")];
    if (missing.length > 0) coverageGaps.push({ check: "coverage", page: null, url: state.url, state: state.id, missingNl: `In deze toestand ontbreken metingen: ${missing.join(", ")}. Draai collect opnieuw.`, measured: { missing }, fixedBy: "sweep" });
    // A component that did not open on one of its page types: the recipe or the postcondition does not hold there, or the component is not on
    // that page type. Either way the model is wrong for that page type, so it goes back to the explorer, who can also accept it as how the site is.
    for (const row of (state.perPageType ?? []).filter((entry) => !entry.reached)) coverageGaps.push({ check: NOT_OPENED_ON_PAGE_TYPE, page: run.pages.find((page) => page.item.url === row.url)?.label ?? null, url: row.url, state: state.id, component: state.modelId, missingNl: `Het onderdeel ging op het paginatype "${row.pageType}" niet open in een staand venster: ${row.reasonNl ?? "geen reden vastgelegd"}. Voor dat paginatype is het geopende onderdeel niet vastgelegd. ${notOpenedAdviceNl(row.reasonNl)}`, fixedBy: fixedByReason(row.reasonNl) });
    for (const entry of state.variantsNotReached ?? []) warnings.push({ check: "state-not-reopened", page: null, url: state.url, state: state.id, missingNl: `De toestand ging geen tweede keer open voor ${entry.variant}: ${entry.reasonNl ?? "geen reden vastgelegd"}. Die meting ontbreekt voor deze toestand.` });
  }
  // The Tab walk in the narrow window, next to what there is to reach there. A warning: the walk in the default window decides whether the evidence is enough.
  for (const page of run.pages) {
    if (!page.tabwalkNarrow || !page.narrow) continue;
    const expected = expectedFocusable({ facts: page.narrow } as unknown as PageData);
    if (expected.length < MIN_FOCUSABLE_FOR_SHARE) continue;
    const stops = new Set(page.tabwalkNarrow.stops.map((stop) => where(stop)));
    const share = expected.filter((element) => stops.has(where(element))).length / expected.length;
    if (share < MIN_TAB_REACH) warnings.push({ check: "tab-reach-narrow", ...on(page), state: "default", missingNl: `In het smalle venster bereikte de Tab-proef ${percent(share)} van de ${expected.length} links en bedieningselementen (${stops.size} stops, uitkomst ${page.tabwalkNarrow.outcome}).` });
  }
  // The single keys in the states of the model belong to the interaction probe.
  if (model && run.siteStates && run.states) {
    const inStates = run.states.singleKeys?.states;
    if (inStates === undefined) coverageGaps.push({ check: "coverage", page: null, url: null, state: "default", missingNl: "De toetsenproef is niet gedaan in de toestanden van het sitemodel. Draai states opnieuw.", fixedBy: "sweep" });
    for (const row of inStates ?? []) {
      const state = run.siteStates.states.find((entry) => entry.id === row.state);
      if (!row.examined && state?.reached) warnings.push({ check: "keys-not-pressed-in-state", page: null, url: state.url, state: row.state, missingNl: `In deze toestand zijn geen losse toetsen ingedrukt: ${row.reasonNl ?? "geen reden vastgelegd"}.` });
    }
  }
  // The pointer probes in the narrow window and in the states of the model belong to the interaction probe too.
  if (model && run.siteStates && run.states) {
    const hoverCoverage = run.states.hoverCoverage;
    const pressCoverage = run.states.downEventCoverage;
    if (hoverCoverage?.kinds === undefined) coverageGaps.push({ check: "coverage", page: null, url: null, state: "default", missingNl: "De proef met aanwijzen en focus is niet per soort bedieningselement gedaan, zodat niet vaststaat dat elke soort is onderzocht. Draai states opnieuw.", fixedBy: "sweep" });
    if (hoverCoverage?.narrowPages === undefined || pressCoverage?.narrowPages === undefined) coverageGaps.push({ check: "coverage", page: null, url: null, state: "default", missingNl: "De proeven met aanwijzen en met indrukken zijn niet gedaan in het smalle venster. Draai states opnieuw.", fixedBy: "sweep" });
    if (hoverCoverage?.states === undefined || pressCoverage?.states === undefined) coverageGaps.push({ check: "coverage", page: null, url: null, state: "default", missingNl: "De proeven met aanwijzen en met indrukken zijn niet gedaan in de toestanden van het sitemodel. Draai states opnieuw.", fixedBy: "sweep" });
    for (const [probeNl, rows] of [["aangewezen", hoverCoverage?.states ?? []], ["ingedrukt", pressCoverage?.states ?? []]] as const) {
      for (const row of rows) {
        const state = run.siteStates.states.find((entry) => entry.id === row.state);
        if (!row.examined && state?.reached) warnings.push({ check: "pointer-not-probed-in-state", page: null, url: state.url, state: row.state, missingNl: `In deze toestand is niet elk bedieningselement ${probeNl}: ${row.reasonNl ?? "geen reden vastgelegd"}.` });
      }
    }
  }
  const pressLeftOut = run.states?.downEventCoverage?.notExamined ?? 0;
  if (pressLeftOut > 0) warnings.push({ check: "press-probe-limit", page: null, url: null, state: "default", missingNl: `De indrukproef heeft ${pressLeftOut} soorten bedieningselementen niet onderzocht (grens van ${run.states!.downEventCoverage!.limit}); het dossier noemt voorbeelden.` });
  const hoverLeftOut = run.states?.hoverCoverage?.notExamined ?? 0;
  if (hoverLeftOut > 0) warnings.push({ check: "hover-probe-limit", page: null, url: null, state: "default", missingNl: `De proef met aanwijzen en focus heeft ${hoverLeftOut} ${run.states!.hoverCoverage!.kinds === undefined ? "bedieningselementen" : "soorten bedieningselementen"} niet onderzocht (grens van ${run.states!.hoverCoverage!.limit}); het dossier noemt voorbeelden.` });
  add("coverage", coverageGaps, "elke pagina en elke toestand heeft de metingen die de veegronde moet leveren");

  // 4. Walks that ended in a trap.
  const trapped = run.pages.filter((page) => page.tabwalk.outcome === "trapped");
  add(
    "tab-trapped",
    trapped.map((page) => ({ check: "tab-trapped", ...on(page), state: "default", missingNl: `De Tab-proef kwam drie keer op dezelfde plek uit en stopte: ${where(page.tabwalk.stops.at(-1)!).slice(0, 120)}. Wat daarna in de Tab-volgorde komt, is niet onderzocht. Ga na of dit een echte toetsenbordval is.`, measured: { stops: page.tabwalk.stopCount } })),
    "geen enkele Tab-proef liep vast",
  );
  for (const page of run.pages.filter((entry) => entry.tabwalk.outcome === "limit-reached" || entry.tabwalk.outcome === "navigated-on-focus" || entry.tabwalk.outcome === "focus-lost")) {
    warnings.push({ check: "tab-walk-ended-early", ...on(page), state: "default", missingNl: `De Tab-proef eindigde met "${page.tabwalk.outcome}" na ${page.tabwalk.stopCount} stops.` });
  }
  for (const page of run.pages.filter((entry) => (entry.tabwalk.focusThrownAwayBy ?? []).length > 0)) {
    const thrower = page.tabwalk.focusThrownAwayBy![0]!;
    warnings.push({ check: "focus-thrown-away", ...on(page), state: "default", missingNl: `Het element ${thrower.tag} "${thrower.text.slice(0, 40)}" gooit de focus weg zodra het die krijgt. De Tab-proef is daarachter verder gegaan; een gebruiker met een toetsenbord komt daar niet. Dat is een bevinding voor de beoordeling, geen gat in het bewijs.` });
  }

  // A page taller than a picture may be: what stands below the limit is in no screenshot, and its contrast is not measured.
  for (const page of run.pages.filter((entry) => entry.facts.screenshotClippedAt)) {
    const { pageHeight, limit } = page.facts.screenshotClippedAt!;
    limitations.push({ check: "screenshot-clipped", ...on(page), state: "default", missingNl: `De pagina is ${pageHeight} pixels hoog. De schermafbeeldingen stoppen bij ${limit} pixels; wat daaronder staat, is op geen schermafbeelding te zien en het contrast ervan is niet gemeten.`, measured: { pageHeight, limit } });
  }

  // A rule engine that gave no answer on a page or in a state: what it would have found there cannot be established, and its silence must not read as clean (#143).
  const withoutResult = (runs: [string, EngineRun | undefined][]): string => runs.flatMap(([where, engines]) => enginesWithoutResult(engines).map((entry) => `${entry.engine}${where ? ` ${where}` : ""}: ${entry.error.slice(0, 200)}`)).join("; ");
  for (const page of run.pages) {
    const told = withoutResult([["in licht", page.engines?.light], ["in donker", page.engines?.dark]]);
    if (told) limitations.push({ check: "engine-without-result", ...on(page), state: "default", missingNl: `Een regelset gaf op deze pagina geen uitslag (${told}). Wat die regelset hier zou vinden, kan niet worden vastgesteld; dat er geen bevinding van in het bewijs staat, betekent niet dat de pagina zonder fouten is.` });
  }
  for (const state of run.siteStates?.states ?? []) {
    const told = withoutResult([["", run.stateEvidence?.[state.id]?.engines]]);
    if (told) limitations.push({ check: "engine-without-result", page: null, url: state.url, state: state.id, missingNl: `Een regelset gaf in deze toestand geen uitslag (${told}). Wat die regelset hier zou vinden, kan niet worden vastgesteld; dat er geen bevinding van in het bewijs staat, betekent niet dat de toestand zonder fouten is.` });
  }

  // 5. The sweep itself must be complete.
  const incomplete: Gap[] = [];
  if (!run.states) incomplete.push({ check: "sweep-complete", page: null, url: null, state: "default", missingNl: "De interactieproef (states) heeft niet gedraaid.", fixedBy: "sweep" });
  if (!run.contrast) incomplete.push({ check: "sweep-complete", page: null, url: null, state: "default", missingNl: "De contrastmeting (contrast) heeft niet gedraaid.", fixedBy: "sweep" });
  if (model && !run.siteStates) incomplete.push({ check: "sweep-complete", page: null, url: null, state: "default", missingNl: "Er is een sitemodel, maar de toestanden daaruit zijn niet vastgelegd; draai collect opnieuw.", fixedBy: "sweep" });
  add("sweep-complete", incomplete, "collect, contrast en states hebben gedraaid");
  for (const skipped of run.states?.skipped ?? []) {
    const page = run.pages.find((entry) => entry.label === skipped.page);
    warnings.push({ check: "step-skipped", page: skipped.page, url: page?.item.url ?? null, state: "default", missingNl: `Een stap van de interactieproef is niet afgemaakt: ${skipped.step}.` });
  }

  // 6. Components: did what the model describes open?
  const componentGaps: Gap[] = [];
  let componentNote = "";
  if (model && run.siteStates) {
    const urlOf = (pageTypes: string[]): string | null => model.pageTypes.find((type) => pageTypes.includes(type.id))?.representative ?? null;
    const label = (url: string | null): string | null => run.pages.find((page) => page.item.url === url)?.label ?? null;
    // A component that needs a request an evaluation does not send cannot be opened by anyone: it is a limitation, not a failure of the model.
    // Nor can the tools operate what stands inside an embedded window: named in the model, it is a limitation too.
    const notExaminable = new Set(model.components.filter((component) => component.recipe === null && ((component.blockedRequests ?? []).length > 0 || component.frame !== undefined)).map((component) => component.id));
    const openable = run.siteStates.states.filter((state) => state.kind !== "blocker" && !(state.kind === "component" && notExaminable.has(state.modelId)));
    // A component that only stands between the measured widths and that the sweep opened there has been looked at: that opening is the evidence.
    const seenBetween = new Map<string, ReturnType<typeof openedBetweenWidths>>();
    for (const state of openable.filter((entry) => !entry.reached && entry.kind === "component")) {
      const component = model.components.find((entry) => entry.id === state.modelId);
      const opened = component ? openedBetweenWidths(run, component) : [];
      if (opened.length > 0) seenBetween.set(state.id, opened);
    }
    const unreached = openable.filter((state) => !state.reached && !seenBetween.has(state.id));
    const share = openable.length === 0 ? 1 : 1 - unreached.length / openable.length;
    const entries = unreached.map((state) => ({ check: "components-opened", page: label(state.url ?? urlOf(state.pageTypes)), url: state.url ?? urlOf(state.pageTypes), state: state.id, missingNl: `Het ${state.kind === "process" ? "proces" : "onderdeel"} "${state.modelId}" is niet geopend: ${(state.reasonNl ?? "onbekende reden").replace(/[.\s]+$/, "")}.`, fixedBy: fixedByReason(state.reasonNl) }));
    if (share < MIN_COMPONENTS_OPENED) componentGaps.push(...entries);
    else warnings.push(...entries);
    componentNote = `${openable.length - unreached.length} van ${openable.length} onderdelen en processen geopend`;
    const betweenNl = [...seenBetween].map(([id, opened]) => {
      const widths = [...new Set(opened.map((entry) => entry.width))].sort((a, b) => a - b);
      const pages = [...new Set(opened.map((entry) => entry.page))];
      return `"${openable.find((state) => state.id === id)!.modelId}" op ${widths.join(" en ")} pixels breed (${pages.slice(0, 3).join(", ")}${pages.length > 3 ? ` en ${pages.length - 3} meer` : ""}: ${opened[0]!.control}, toonde ${opened[0]!.showed.slice(0, 3).join(", ")})`;
    });
    if (betweenNl.length > 0) componentNote += `; alleen op een tussenbreedte bestaand en daar door de veegronde geopend: ${betweenNl.join("; ")}`;
    for (const dismissal of run.siteStates.dismissals.filter((entry) => !entry.dismissed)) {
      componentGaps.push({ check: "blocker-closed", page: label(dismissal.url), url: dismissal.url, state: "default", missingNl: `De blokkade "${dismissal.blocker}" stond op de pagina en is niet gesloten (${dismissal.where}): ${dismissal.reasonNl ?? "onbekende reden"}.`, fixedBy: fixedByReason(dismissal.reasonNl) });
    }
    for (const blocker of model.blockers) {
      const captured = run.siteStates.states.filter((state) => state.kind === "blocker" && state.modelId === blocker.id);
      if (captured.length > 0 && captured.every((state) => !state.reached)) componentGaps.push({ check: "blocker-captured", page: null, url: null, state: captured[0]!.id, missingNl: `De blokkade "${blocker.id}" is op geen enkel paginatype met de blokkade erop vastgelegd, dus ze is zelf niet te beoordelen: ${captured[0]!.reasonNl ?? ""}`, fixedBy: fixedByReason(captured[0]!.reasonNl) });
    }
  }
  add("components-opened", componentGaps, componentNote || "niets te openen");

  // 6b. What cannot be examined without a request an evaluation does not send.
  if (model) {
    for (const component of model.components) {
      for (const request of component.blockedRequests ?? []) {
        const where = { page: null, url: model.pageTypes.find((type) => component.pageTypes.includes(type.id))?.representative ?? null, state: component.recipe ?? `component-${component.id}` };
        // A GET is refused only when it goes to a host outside the run: that is a read, and a choice of what the run covers, not a write.
        if (["GET", "HEAD"].includes(String(request.method).toUpperCase())) limitations.push({ check: "needs-host-outside-run", ...where, missingNl: `Niet onderzoekbaar zonder een adres buiten de run: het onderdeel "${component.id}" heeft ${request.method} ${request.address} nodig, en dat adres hoort niet bij de afbakening (inventory --also-origin).` });
        else limitations.push({ check: "needs-write-request", ...where, missingNl: `Niet onderzoekbaar zonder schrijfverzoek: het onderdeel "${component.id}" heeft ${request.method} ${request.address} nodig, en dat verzoek wordt tegengehouden.` });
      }
    }
  }
  if (model) {
    for (const component of model.components.filter((entry) => entry.recipe === null && entry.frame !== undefined)) {
      limitations.push({ check: "frame-not-operated", page: null, url: model.pageTypes.find((type) => component.pageTypes.includes(type.id))?.representative ?? null, state: `component-${component.id}`, missingNl: `Het ingesloten venster ${component.frame} (onderdeel "${component.id}") is niet bediend: ${component.notOpenedNl ?? "geen reden vastgelegd"}. Het staat in de pagina en de bezoeker moet het gebruiken; het is onderzocht zoals het op de pagina staat, niet in een geopende toestand.` });
    }
  }
  // An embedded window that could not be measured where it stands was opened on its own: what it shows there may not be what a visitor gets.
  for (const page of run.pages.filter((entry) => entry.placement?.apartNl)) {
    limitations.push({ check: "frame-measured-apart", ...on(page), state: "default", missingNl: `Dit ingesloten venster is niet gemeten op de pagina waar het staat, maar los geopend: ${page.placement!.apartNl}. Toont het los een foutscherm, dan is de inhoud van het venster niet gemeten.` });
  }
  // Only what the site itself is asked for counts: a measuring beacon of a third party that is refused takes no content away.
  const ownHosts = new Set(run.pages.filter((page) => page.item.kind !== "embedded").map((page) => new URL(page.item.url).host));
  // Every origin of the site counts, also one without a page in the sample.
  try {
    for (const host of siteHosts(run.inventory)) ownHosts.add(host);
  } catch {
    // An inventory without a usable address: only the hosts of the pages count.
  }
  const own = (address: string): boolean => ownHosts.has(address.split("/")[0]!);
  // Hosts outside the run that are refused on a plain page load as well say nothing about a component: those are left out for its state.
  const states = run.siteStates?.states ?? [];
  const baseline = new Set(states.filter((state) => state.kind === "blocker").flatMap((state) => (state.refused ?? []).filter((entry) => entry.kind === "scope").map((entry) => entry.address.split("/")[0]!)));
  for (const state of states.filter((entry) => entry.kind !== "blocker")) {
    const writes = (state.refused ?? []).filter((entry) => entry.kind === "method" && own(entry.address));
    const hosts = [...new Set((state.refused ?? []).filter((entry) => entry.kind === "scope").map((entry) => entry.address.split("/")[0]!))].filter((host) => !baseline.has(host));
    if (writes.length > 0) limitations.push({ check: "needs-write-request", page: null, url: state.url, state: state.id, missingNl: `Niet onderzoekbaar zonder schrijfverzoek: in deze toestand zijn tegengehouden ${writes.map((entry) => `${entry.method} ${entry.address}`).slice(0, 3).join(", ")}. Wat daarmee laadt, staat niet in het bewijs.` });
    if (hosts.length > 0) limitations.push({ check: "needs-host-outside-run", page: null, url: state.url, state: state.id, missingNl: `In deze toestand zijn verzoeken naar adressen buiten de run tegengehouden die bij het gewone laden van de pagina niet voorkomen (${hosts.slice(0, 4).join(", ")}). Een onderdeel dat daarvan afhangt, werkte niet.` });
  }
  const writesByPage = new Map<string, string[]>();
  for (const entry of (run.siteStates?.refusedWrites ?? []).filter((candidate) => own(candidate.address))) writesByPage.set(entry.url, [...(writesByPage.get(entry.url) ?? []), `${entry.method} ${entry.address}`]);
  for (const [url, requests] of writesByPage) {
    const page = run.pages.find((candidate) => candidate.item.url === url);
    limitations.push({ check: "needs-write-request", page: page?.label ?? null, url, state: "default", missingNl: `Niet onderzoekbaar zonder schrijfverzoek: de pagina vroeg zelf om ${[...new Set(requests)].slice(0, 3).join(", ")}. Dat is tegengehouden; inhoud die zo laadt ontbreekt, en een laadscherm kan zijn blijven staan. De schermafbeeldingen tonen dan niet de pagina zoals een bezoeker haar krijgt. Niemand verstuurde hier iets: blijft een criterium daardoor open, dan is dat een proef die niet werkte, niet "versturen niet toegestaan".` });
  }
  // Movement the sweep measured on a page type for which the model names no moving content.
  if (model) {
    for (const type of model.pageTypes) {
      const moving = run.pages.filter((page) => type.pages.includes(page.item.url) && page.motion && page.motion.intervals.length + page.motion.longOrInfinite.length + page.motion.autoplayMedia + page.motion.gifImages > 0);
      const named = (model.content ?? []).some((content) => content.pageTypes.includes(type.id));
      if (moving.length > 0 && !named) warnings.push({ check: "moving-content-not-in-model", ...on(moving[0]!), state: "default", missingNl: `Op dit paginatype is beweging of een timer gemeten (${moving[0]!.motion.intervals.length} timers, ${moving[0]!.motion.longOrInfinite.length} lange animaties, ${moving[0]!.motion.autoplayMedia} media die vanzelf starten), maar het sitemodel noemt hier geen inhoud die vanzelf beweegt of afspeelt.` });
    }
  }

  // 6c. What there is to operate on each page type, next to what the model says about it. The same count `check-site` makes before the sweep, here on the pages as they were measured.
  if (model) {
    const counted: CountedPage[] = [];
    for (const type of model.pageTypes) {
      const page = run.pages.find((entry) => entry.item.url === type.representative) ?? run.pages.find((entry) => type.pages.includes(entry.item.url));
      if (page?.operables) counted.push({ pageType: type.id, url: page.item.url, groups: page.operables });
    }
    if (counted.length === 0) checks.push({ name: "model-covers-controls", ok: true, noteNl: "niet geteld: deze veegronde legde niet vast wat er op een pagina te bedienen is" });
    else {
      const compared = uncoveredOperables(model, run.recipes ?? {}, counted);
      add(
        "model-covers-controls",
        compared.uncovered.map((entry) => ({ check: "model-covers-controls", page: run.pages.find((page) => page.item.url === entry.url)?.label ?? null, url: entry.url, state: "default", missingNl: entry.problemNl, measured: { kind: entry.group.kind, place: entry.group.path, controls: entry.group.members.length } })),
        `${compared.counted} formulieren en groepen bedieningsonderdelen geteld op ${counted.length} paginatypen; het sitemodel dekt ze alle`,
      );
    }
  }

  // 7. Something that lies over the page on most screenshots.
  const measured = run.pages.filter((page) => page.overlays !== undefined && page.overlays !== null);
  if (measured.length === 0) checks.push({ name: "overlay", ok: true, noteNl: "niet gemeten: deze run legde niet vast wat op zijn plaats blijft staan (dat gebeurt alleen met een sitemodel)" });
  else {
    // Large is not enough: a column that stays in place next to the content covers nothing. It has to lie over text or controls of the page.
    const large = (page: PageData): Overlay[] => page.overlays!.filter((overlay) => overlay.share > MAX_OVERLAY_SHARE);
    const covering = (page: PageData): Overlay | undefined => large(page).find(coversContent);
    const covered = measured.filter((page) => covering(page) !== undefined);
    const beside = measured.filter((page) => covering(page) === undefined && large(page).length > 0).length;
    const overlayGaps: Gap[] = [];
    if (covered.length / measured.length > OVERLAY_PAGE_SHARE) {
      const worst = covering(covered[0]!)!;
      const under = [worst.covers?.top, worst.covers?.scrolled].find((entry) => entry && entry.text + entry.controls > 0);
      const underNl = under ? ` Eronder ${under === worst.covers?.top ? "liggen bij het laden" : "liggen na scrollen"} ${under.text} van de ${under.ofText} regels tekst en ${under.controls} van de ${under.ofControls} bedieningselementen in het venster${under.example ? `, bijvoorbeeld "${under.example.slice(0, 40)}"` : ""}.` : "";
      overlayGaps.push({ check: "overlay", ...on(covered[0]!), state: "default", missingNl: `Op ${covered.length} van de ${measured.length} pagina's ligt een vast element dat meer dan ${percent(MAX_OVERLAY_SHARE)} van het venster inneemt over de inhoud, bijvoorbeeld ${worst.tag} "${worst.text.slice(0, 40)}" (${percent(worst.share)}, ${where(worst).slice(0, 80)}).${underNl} Dat is een blokkade die niet in het sitemodel staat.`, measured: { pages: covered.length, of: measured.length, share: worst.share } });
    }
    add("overlay", overlayGaps, `op ${covered.length} van ${measured.length} pagina's ligt een vast element dat meer dan ${percent(MAX_OVERLAY_SHARE)} van het venster inneemt over de inhoud${beside > 0 ? `; op ${beside} ${beside === 1 ? "pagina staat" : "pagina's staat"} zo'n element naast de inhoud en bedekt het niets` : ""}`);
  }
  // Documents: a tagged pdf whose tag text was not read has headings, links and tables without text. A warning: the file itself was measured.
  for (const document of run.documents ?? []) {
    if (document.facts?.pdf?.tagged && !document.facts.pdf.tagTextRead) warnings.push({ check: "document-tag-text-not-read", page: document.label, url: document.item.url, state: "default", missingNl: "De tekst per tag van dit document is niet gelezen, dus de koppen, links en tabellen zijn zonder hun tekst beoordeeld. De uitkomst van documents zegt welk programma niet paste. Herstel dat en draai documents opnieuw." });
  }
  return { checks, gaps, warnings, limitations };
}

/**
 * The block all places lie in, when that is something smaller than the page: the selector
 * they share up to and including an id, or a shared ancestor well below the body. Null
 * when the places are spread over the page.
 */
export function commonBlock(places: string[]): string | null {
  if (places.length === 0) return null;
  const split = places.map((place) => place.split(" >>> ")[0]!.split(" > "));
  const shared: string[] = [];
  for (let index = 0; split.every((parts) => parts.length > index + (places.length > 1 ? 0 : 1) && parts[index] === split[0]![index]); index++) shared.push(split[0]![index]!);
  if (shared.length === 0) return null;
  // Paths start at the nearest id, so a shared id is a shared block; without one the block has to be more than html and body.
  const rooted = shared[0]!.startsWith("#");
  const depth = shared.filter((part) => !["html", "body"].includes(part.replace(/:nth-of-type\(\d+\)/, ""))).length;
  return rooted || depth >= 2 ? shared.join(" > ") : null;
}

const TILE_WIDTH = 480;
const TILE_MAX_HEIGHT = 1100;
const TILE_GAP = 16;
const COLUMNS = 3;
const TILE_COLOUR: [number, number, number] = [196, 0, 143];

/** Shrink a picture to the tile width by averaging, after cutting off what would not fit in the tile anyway. */
export function tile(source: PNG): PNG {
  const scale = Math.max(1, source.width / TILE_WIDTH);
  const width = Math.max(1, Math.round(source.width / scale));
  const height = Math.max(1, Math.min(TILE_MAX_HEIGHT, Math.round(source.height / scale)));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const top = Math.floor(y * scale);
    const bottom = Math.min(source.height, Math.max(top + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const left = Math.floor(x * scale);
      const right = Math.min(source.width, Math.max(left + 1, Math.floor((x + 1) * scale)));
      const sum = [0, 0, 0];
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const offset = (sy * source.width + sx) * 4;
          sum[0]! += source.data[offset]!;
          sum[1]! += source.data[offset + 1]!;
          sum[2]! += source.data[offset + 2]!;
        }
      }
      const count = (bottom - top) * (right - left);
      out.data.set([Math.round(sum[0]! / count), Math.round(sum[1]! / count), Math.round(sum[2]! / count), 255], (y * width + x) * 4);
    }
  }
  return out;
}

/** Put numbered tiles next to each other on one white sheet. */
export function contactSheet(tiles: PNG[]): PNG {
  const rows: PNG[][] = [];
  for (let index = 0; index < tiles.length; index += COLUMNS) rows.push(tiles.slice(index, index + COLUMNS));
  const width = TILE_GAP + COLUMNS * (TILE_WIDTH + TILE_GAP);
  const height = TILE_GAP + rows.reduce((sum, row) => sum + Math.max(...row.map((entry) => entry.height)) + TILE_GAP, 0);
  const sheet = new PNG({ width, height });
  sheet.data.fill(255);
  const marks: Parameters<typeof drawMarks>[1] = [];
  let y = TILE_GAP;
  let nr = 1;
  for (const row of rows) {
    let x = TILE_GAP;
    for (const entry of row) {
      PNG.bitblt(entry, sheet, 0, 0, entry.width, entry.height, x, y);
      marks.push({ label: String(nr++), box: { x: x - 2, y: y - 2, width: entry.width + 4, height: entry.height + 4 }, colour: TILE_COLOUR, frame: 2 });
      x += TILE_WIDTH + TILE_GAP;
    }
    y += Math.max(...row.map((entry) => entry.height)) + TILE_GAP;
  }
  drawMarks(sheet, marks);
  return sheet;
}

/** One sheet per page type: the page as measured, on a narrow screen, with its Tab stops, and every state of the site model that belongs to it. */
export async function buildSheets(run: RunData, runDir: string, outDir: string): Promise<Sheet[]> {
  const model = run.siteModel ?? null;
  const types: { id: string; page: PageData }[] = [];
  if (model) {
    for (const type of model.pageTypes) {
      const page = run.pages.find((entry) => entry.item.url === type.representative) ?? run.pages.find((entry) => type.pages.includes(entry.item.url));
      if (page) types.push({ id: type.id, page });
    }
  } else for (const [index, page] of representativePages(run, Number.MAX_SAFE_INTEGER).filter((entry) => entry.item.kind !== "embedded").entries()) types.push({ id: `sjabloon-${index + 1}`, page });

  const sheets: Sheet[] = [];
  for (const type of types) {
    const candidates: Omit<Tile, "nr">[] = [
      { state: "default", file: `${type.page.dir}/screenshot-light.png`, descriptionNl: "de pagina zoals ze is gemeten, breed scherm (bovenste deel)" },
      { state: "narrow", file: `${type.page.dir}/probes/reflow.png`, descriptionNl: "dezelfde pagina op een smal scherm van 320 pixels (bovenste deel)" },
      { state: "taborder", file: `${type.page.dir}/probes/tabwalk.png`, descriptionNl: "de pagina met de Tab-stops genummerd in de volgorde van de Tab-toets" },
    ];
    const components: string[] = [];
    const everywhere: string[] = [];
    const processes: string[] = [];
    for (const state of run.siteStates?.states ?? []) {
      if (!state.pageTypes.includes(type.id)) continue;
      const siteWide = state.kind === "component" && model?.components.find((component) => component.id === state.modelId)?.siteWide === true;
      // A state is one picture, taken on one page. It is shown on the sheet of that page's type; on the other sheets it is named.
      const capturedType = (model && state.url !== null ? pageTypeOf(model, state.url) : null) ?? state.pageTypes[0];
      if (state.reached && capturedType !== type.id) {
        const label = run.pages.find((page) => page.item.url === state.url)?.label ?? state.url;
        if (siteWide) everywhere.push(`${state.modelId} (het vak staat op het blad van paginatype ${capturedType})`);
        else if (state.kind === "component") components.push(`${state.modelId} (gemeten op ${label}, geldt ook voor dit paginatype; het vak staat op het blad van paginatype ${capturedType})`);
        continue;
      }
      const entry = state.kind === "blocker" ? model?.blockers.find((blocker) => blocker.id === state.modelId) : state.kind === "component" ? model?.components.find((component) => component.id === state.modelId) : model?.processes.find((process) => process.id === state.modelId);
      const kind = state.kind === "blocker" ? "blokkade" : state.kind === "component" ? "onderdeel" : "proces";
      if (state.kind !== "blocker") (siteWide ? everywhere : state.kind === "component" ? components : processes).push(`${state.modelId}: ${entry?.descriptionNl ?? ""}${state.reached ? "" : " (niet geopend)"}`);
      if (state.reached && state.files.screenshot) candidates.push({ state: state.id, file: state.files.screenshot, descriptionNl: `${kind} "${state.modelId}"${state.viewport ? ` op ${state.viewport.width} pixels breed` : ""}: ${entry?.descriptionNl ?? ""}` });
    }
    const present = candidates.filter((candidate) => existsSync(join(runDir, candidate.file)));
    if (present.length === 0) continue;
    const tiles = present.map((candidate, index) => ({ nr: index + 1, ...candidate }));
    const file = join("gate", `sheet-${type.id}.png`);
    const bytes = PNG.sync.write(contactSheet(tiles.map((entry) => tile(PNG.sync.read(readFileSync(join(runDir, entry.file)))))));
    await writeFileAtomic(join(outDir, file), bytes);
    sheets.push({ pageType: type.id, page: type.page.label, url: type.page.item.url, file, sha256: sha256(bytes), tiles, componentsNl: components, ...(everywhere.length > 0 ? { everywhereNl: everywhere } : {}), ...(processes.length > 0 ? { processesNl: processes } : {}), contentNl: (model?.content ?? []).filter((content) => content.pageTypes.includes(type.id)).map((content) => `${content.id} (${content.kind}): ${content.descriptionNl}`), framesNl: framesOn(type.page, model), keysNl: keysOn(type.page, run) });
  }
  return sheets;
}

/** What the reviewing agent reads beside one sheet: the picture, its tiles and the lists of what is known. */
export function sheetText(sheet: Sheet, absoluteOut: string): string {
  return [
    `### Paginatype \`${sheet.pageType}\` (${sheet.page}, ${sheet.url})`,
    "",
    `Blad: \`${join(absoluteOut, sheet.file)}\``,
    "",
    `Kenmerk van dit blad (\`reviewedAs\`): \`${reviewedAs(sheet)}\``,
    "",
    ...sheet.tiles.map((entry) => `- Vak ${entry.nr}: ${entry.descriptionNl}`),
    "",
    sheet.componentsNl.length > 0 ? `Onderdelen van dit paginatype volgens het sitemodel: ${sheet.componentsNl.join("; ")}.` : (sheet.everywhereNl ?? []).length > 0 ? "Het sitemodel noemt voor dit paginatype geen eigen onderdelen." : "Het sitemodel noemt voor dit paginatype geen onderdelen.",
    ...((sheet.everywhereNl ?? []).length > 0 ? ["", `Op elke pagina, ook deze, volgens het sitemodel: ${sheet.everywhereNl!.join("; ")}. Die horen bij de lijst met onderdelen.`] : []),
    "",
    (sheet.processesNl ?? []).length > 0 ? `Processen van dit paginatype volgens het sitemodel (formulieren en stappen die het sitemodel al kent): ${sheet.processesNl!.join("; ")}.` : "Het sitemodel noemt voor dit paginatype geen processen.",
    "",
    (sheet.contentNl ?? []).length > 0 ? `Inhoud zonder handeling (spelers, blokken die vanzelf bewegen) volgens het sitemodel: ${sheet.contentNl!.join("; ")}.` : "Het sitemodel noemt voor dit paginatype geen spelers of inhoud die vanzelf beweegt.",
    "",
    (sheet.framesNl ?? []).length > 0 ? `Ingesloten vensters op deze pagina volgens het sitemodel: ${sheet.framesNl!.join("; ")}.` : "Het sitemodel noemt op deze pagina geen ingesloten vensters.",
    "",
    (sheet.keysNl ?? []).length > 0 ? `Toetsen van één teken waarop deze pagina reageerde in de veegronde: ${sheet.keysNl!.join("; ")}.` : "De veegronde vond op deze pagina geen toets van één teken waarop de pagina reageert.",
  ].join("\n");
}

/** What the single-key probe of the sweep recorded on a page: a shortcut it measured is known, not missing. */
export function keysOn(page: Pick<PageData, "label">, run: Pick<RunData, "states">): string[] {
  const reactions = (run.states?.singleKeys.reactions ?? []).filter((reaction) => reaction.page === page.label);
  return reactions.map((reaction) => `"${reaction.key}": ${reaction.change.length > 160 ? `${reaction.change.slice(0, 157)}...` : reaction.change}`);
}

/** The frames of the site model that stand on a page, by the address of each iframe element. */
export function framesOn(page: PageData, model: RunData["siteModel"]): string[] {
  const addresses = new Set<string>();
  for (const iframe of page.facts.iframes ?? []) {
    try {
      const parsed = new URL(String(iframe.src ?? ""), page.item.url);
      addresses.add(`${parsed.origin}${parsed.pathname}`);
    } catch {
      // An iframe without an address that can be read is no frame of the model.
    }
  }
  return (model?.frames ?? []).filter((frame) => addresses.has(frame.address)).map((frame) => `${frame.descriptionNl} (${frameStanding(frame).labelNl}, ${frameStanding(frame).counts ? "telt mee" : "telt niet mee"}, ${frame.address})`);
}

export const ANSWERS = ["ja", "nee", "onduidelijk"] as const;
type Answer = (typeof ANSWERS)[number];

/** The fixed questions about the first three tiles of a sheet, and which answer means the evidence falls short. */
export const QUESTIONS: { id: string; bad: Answer; tileState: string; questionNl: string }[] = [
  { id: "content", bad: "nee", tileState: "default", questionNl: "Vak 1: zie je de inhoud van de pagina (koppen, tekst, navigatie), en dus geen foutmelding, lege pagina, inlogscherm of laadscherm?" },
  { id: "covered", bad: "ja", tileState: "default", questionNl: "Vak 1: ligt er een melding, venster of balk over de inhoud die de pagina bedekt of tegenhoudt, zoals een cookiemelding? Een vaste knop die een stukje inhoud raakt, telt hier niet: noem die in remarkNl." },
  { id: "narrow", bad: "nee", tileState: "narrow", questionNl: "Vak 2: zie je op het smalle scherm de inhoud van de pagina, zonder dat een melding of venster haar bedekt of tegenhoudt? Een vaste knop die een stukje inhoud raakt, telt hier niet: noem die in remarkNl." },
  { id: "taborder", bad: "nee", tileState: "taborder", questionNl: "Vak 3: staan de genummerde Tab-stops verspreid over de pagina (kop, inhoud en voet), en dus niet alleen in één hoek of één blok?" },
  { id: "missing", bad: "ja", tileState: "default", questionNl: "Vak 1 en 2: zie je een onderdeel dat pas na een handeling iets laat zien (menuknop, uitklapper, tabbladen, carrousel met knoppen, zoekknop, chatknop), of een speler of blok dat vanzelf beweegt, dat niet in de lijst met onderdelen, niet in de lijst met processen, niet in de lijst met inhoud zonder handeling en ook niet in de lijst met ingesloten vensters van dit paginatype staat? Een formulier dat in de lijst met processen staat (een zoekformulier, een contactformulier), of een ingesloten venster dat in die lijst staat (een vak 'Ik ben geen robot', een speler van een andere partij), telt hier niet: het sitemodel kent het." },
];
const STATE_QUESTION_NL = "Elk vak vanaf 4: is te zien wat de omschrijving van het vak zegt? Bij een onderdeel of proces: het is open of uitgevoerd. Bij een blokkade: de blokkade staat in beeld.";

interface GivenAnswer {
  answer?: unknown;
  noteNl?: unknown;
}

export interface Answers {
  sheets: { pageType: string; reviewedAs?: unknown; answers: Record<string, GivenAnswer>; stateTiles: (GivenAnswer & { tile?: unknown })[]; remarkNl?: unknown }[];
}

/** Check the form of the agent's answers against the sheets they are about. Problems are in Dutch: the agent reads them. */
export function validateAnswers(value: unknown, sheets: Sheet[]): string[] {
  const problems: string[] = [];
  const given = (value as Answers | null)?.sheets;
  if (!Array.isArray(given)) return ["het antwoord heeft geen lijst sheets"];
  const checkAnswer = (entry: GivenAnswer | undefined, whereNl: string, bad: Answer | null): void => {
    if (!entry || !ANSWERS.includes(entry.answer as Answer)) return void problems.push(`${whereNl}: answer moet ja, nee of onduidelijk zijn`);
    const needsNote = entry.answer === "onduidelijk" || (bad === null ? entry.answer === "nee" : entry.answer === bad);
    if (needsNote && (typeof entry.noteNl !== "string" || entry.noteNl.trim().length < 10)) problems.push(`${whereNl}: bij dit antwoord hoort in noteNl wat je zag en waar (minstens een korte zin)`);
  };
  for (const sheet of sheets) {
    const entry = given.find((candidate) => candidate?.pageType === sheet.pageType);
    if (!entry) {
      problems.push(`er is geen antwoord voor paginatype "${sheet.pageType}"`);
      continue;
    }
    // An answer counts only for the sheet it was given for; one from an earlier round says nothing about this one.
    if (entry.reviewedAs !== reviewedAs(sheet)) {
      problems.push(typeof entry.reviewedAs === "string" ? `${sheet.pageType}: het blad is veranderd sinds dit antwoord (reviewedAs ${entry.reviewedAs}, het blad heeft nu ${reviewedAs(sheet)}); bekijk het blad opnieuw en beantwoord alle vragen opnieuw` : `${sheet.pageType}: reviewedAs ontbreekt; neem het kenmerk van het blad over uit de opdracht, nadat je het blad hebt bekeken`);
      continue;
    }
    for (const question of QUESTIONS) checkAnswer(entry.answers?.[question.id], `${sheet.pageType}.${question.id}`, question.bad);
    for (const key of Object.keys(entry.answers ?? {})) if (!QUESTIONS.some((question) => question.id === key)) problems.push(`${sheet.pageType}: onbekende vraag "${key}"`);
    const stateTiles = sheet.tiles.filter((candidate) => candidate.nr > 3);
    for (const stateTile of stateTiles) checkAnswer((entry.stateTiles ?? []).find((candidate) => candidate?.tile === stateTile.nr), `${sheet.pageType}, vak ${stateTile.nr}`, null);
    for (const candidate of entry.stateTiles ?? []) if (!stateTiles.some((stateTile) => stateTile.nr === candidate?.tile)) problems.push(`${sheet.pageType}: vak ${String(candidate?.tile)} is geen vak van een toestand op dit blad`);
  }
  for (const entry of given) if (!sheets.some((sheet) => sheet.pageType === entry?.pageType)) problems.push(`"${String(entry?.pageType)}" is geen paginatype met een blad`);
  return problems;
}

/** Turn answers into gaps: an answer that says the evidence falls short is a gap, an unclear one a warning. */
export function reviewGaps(answers: Answers, sheets: Sheet[]): { gaps: Gap[]; warnings: Gap[] } {
  const gaps: Gap[] = [];
  const warnings: Gap[] = [];
  for (const sheet of sheets) {
    const entry = answers.sheets.find((candidate) => candidate.pageType === sheet.pageType)!;
    const note = (answer: GivenAnswer, state: string, check: string, bad: boolean): void => {
      if (answer.answer !== "onduidelijk" && !bad) return;
      (bad ? gaps : warnings).push({ check, page: sheet.page, url: sheet.url, state, missingNl: String(answer.noteNl ?? "") });
    };
    for (const question of QUESTIONS) {
      const answer = entry.answers[question.id]!;
      note(answer, question.tileState === "default" ? "default" : question.tileState, `review-${question.id}`, answer.answer === question.bad);
    }
    for (const stateTile of sheet.tiles.filter((candidate) => candidate.nr > 3)) {
      const answer = entry.stateTiles.find((candidate) => candidate.tile === stateTile.nr)!;
      // A state is one picture that returns on the sheet of every page type it belongs to: one gap, not one per sheet.
      if ([...gaps, ...warnings].some((gap) => gap.check === "review-state" && gap.state === stateTile.state)) continue;
      note(answer, stateTile.state, "review-state", answer.answer === "nee");
    }
  }
  return { gaps, warnings };
}

const STAMP_FILE = join("gate", "answers.stamp.json");

export interface ReviewPart {
  /** The task for one agent, and where that agent writes its answers; both relative to the run. */
  task: string;
  answers: string;
  sheets: Sheet[];
}

/** The sheets divided over tasks. The first keeps the names a review with one task always had. */
export function reviewParts(sheets: Sheet[]): ReviewPart[] {
  const parts: ReviewPart[] = [];
  for (let index = 0; index < Math.max(1, sheets.length); index += SHEETS_PER_TASK) {
    const suffix = index === 0 ? "" : `-${index / SHEETS_PER_TASK + 1}`;
    parts.push({ task: join("gate", `poort${suffix}.md`), answers: join("gate", `answers${suffix}.json`), sheets: sheets.slice(index, index + SHEETS_PER_TASK) });
  }
  return parts;
}

/** One hash over the answers of every part: that of the file itself when there is one part. */
async function answersDigest(runDir: string, parts: ReviewPart[]): Promise<string> {
  const hashes: string[] = [];
  for (const part of parts) hashes.push(await sha256File(join(runDir, part.answers)));
  return hashes.length === 1 ? hashes[0]! : sha256(hashes.join("\n"));
}

/** A page type without a sheet was not looked at by anyone: that is a gap, whatever the reason. */
export function sheetGaps(run: RunData, sheets: Sheet[]): Gap[] {
  const gaps: Gap[] = [];
  for (const type of run.siteModel?.pageTypes ?? []) {
    if (sheets.some((sheet) => sheet.pageType === type.id)) continue;
    const page = run.pages.find((entry) => entry.item.url === type.representative) ?? run.pages.find((entry) => type.pages.includes(entry.item.url));
    const unmeasured = page ? undefined : (run.collectFailed ?? []).find((entry) => entry.item.url === type.representative) ?? (run.collectFailed ?? []).find((entry) => type.pages.includes(entry.item.url));
    gaps.push({
      check: "sheets",
      page: page?.label ?? unmeasured?.label ?? null,
      url: page?.item.url ?? unmeasured?.item.url ?? type.representative,
      state: "default",
      missingNl: page
        ? `Voor paginatype "${type.id}" is geen overzichtsblad gemaakt: van ${page.label} ontbreken de schermafbeeldingen van de veegronde. Draai collect opnieuw.`
        : unmeasured
          ? `Voor paginatype "${type.id}" is geen overzichtsblad gemaakt: ${unmeasured.label} zit wel in de steekproef, maar de veegronde kon die pagina niet meten (zie het gat bij het laden van de pagina). Draai collect opnieuw.`
          : `Voor paginatype "${type.id}" is geen overzichtsblad gemaakt: geen enkele pagina van dit type zit in de steekproef, dus er is niets van gemeten. Draai sample opnieuw na check-site, en daarna de veegronde.`,
      fixedBy: page || unmeasured ? "sweep" : "explorer",
    });
  }
  return gaps;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
}

/** Validate the agent's answers. When they hold, record which sheets they were given for. */
export async function checkGate(runDir: string): Promise<string[]> {
  const gatePath = join(runDir, "gate.json");
  if (!existsSync(gatePath)) return [`er is geen gate.json; draai eerst: gate --run ${runDir}`];
  const { review } = await readJson<Gate>(gatePath);
  const parts = reviewParts(review.sheets);
  const problems: string[] = [];
  for (const part of parts) {
    try {
      const partProblems = validateAnswers(await readJson<unknown>(join(runDir, part.answers)), part.sheets);
      problems.push(...(parts.length === 1 ? partProblems : partProblems.map((problem) => `${part.answers}: ${problem}`)));
    } catch (error) {
      problems.push(`${part.answers} is niet te lezen: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  if (problems.length === 0) await writeJson(join(runDir, STAMP_FILE), { answersSha256: await answersDigest(runDir, parts), sheets: Object.fromEntries(review.sheets.map((sheet) => [sheet.pageType, reviewedAs(sheet)])), stampedAt: new Date().toISOString() });
  return problems;
}

/** What a reviewer was shown of a sheet: the picture and the lists beside it. A change in either asks for a new review. */
export function reviewedAs(sheet: Sheet): string {
  // The list of processes counts only where there is one, so a review of a sheet without processes stays valid.
  return sha256(JSON.stringify([sheet.sha256, sheet.componentsNl, sheet.contentNl ?? [], sheet.framesNl ?? [], sheet.keysNl ?? [], ...(sheet.processesNl?.length ? [sheet.processesNl] : []), ...(sheet.everywhereNl?.length ? [{ everywhere: sheet.everywhereNl }] : [])]));
}

/**
 * Answers of an earlier round no longer belong to the sheets: move them to gate/vorige/, so
 * neither an agent nor check-gate builds on them. A file that cannot be read is left alone:
 * an agent may be writing it.
 */
async function setAsideStaleAnswers(outDir: string, parts: ReviewPart[]): Promise<void> {
  const stale: string[] = [];
  for (const part of parts) {
    const path = join(outDir, part.answers);
    if (!existsSync(path)) continue;
    let given: unknown;
    try {
      given = (await readJson<Answers>(path)).sheets;
    } catch {
      continue;
    }
    if (!Array.isArray(given)) continue;
    if (given.some((entry: Answers["sheets"][number] | null) => { const sheet = part.sheets.find((candidate) => candidate.pageType === entry?.pageType); return !sheet || entry?.reviewedAs !== reviewedAs(sheet); })) stale.push(part.answers);
  }
  // Answers of a task that no longer exists, when the site had more page types.
  for (let nr = parts.length + 1; existsSync(join(outDir, "gate", `answers-${nr}.json`)); nr++) stale.push(join("gate", `answers-${nr}.json`));
  if (stale.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(join(outDir, "gate", "vorige"), { recursive: true });
  for (const file of stale) await rename(join(outDir, file), join(outDir, "gate", "vorige", `${basename(file, ".json")}-${stamp}.json`));
}

async function currentAnswers(runDir: string, sheets: Sheet[]): Promise<Answers | null> {
  const parts = reviewParts(sheets);
  if (!existsSync(join(runDir, STAMP_FILE)) || parts.some((part) => !existsSync(join(runDir, part.answers)))) return null;
  const stamp = await readJson<{ answersSha256: string; sheets: Record<string, string> }>(join(runDir, STAMP_FILE));
  if (stamp.answersSha256 !== (await answersDigest(runDir, parts))) return null;
  // Answers count only for the pictures and the lists they were given for.
  if (sheets.length !== Object.keys(stamp.sheets).length || sheets.some((sheet) => stamp.sheets[sheet.pageType] !== reviewedAs(sheet))) return null;
  const all: Answers = { sheets: [] };
  for (const part of parts) all.sheets.push(...(await readJson<Answers>(join(runDir, part.answers))).sheets);
  return all;
}

/**
 * Where the run goes from the gate. Pure: the gaps of the fixed checks and of the review, whether the review is answered for
 * the current sheets, the steps of the manifest and which gaps the site model accepts. Every gap it returns says who can close it.
 */
export function route(fixedGaps: Gap[], reviewedGaps: Gap[], answered: boolean, steps: Pick<ManifestStep, "command">[], isAccepted: (gap: Gap) => boolean): Pick<Gate, "sufficient" | "stage" | "exploreRound" | "returnsLeft" | "gaps"> & Required<Pick<Gate, "next" | "resweeps" | "resweepsLeft">> & { all: Gap[] } {
  const exploreRound = steps.filter((step) => step.command === "explore").length;
  const returnsLeft = Math.max(0, MAX_RETURNS_TO_EXPLORER - Math.max(0, exploreRound - 1));
  const resweeps = Math.max(0, steps.slice(steps.findLastIndex((step) => step.command === "explore") + 1).filter((step) => step.command === "collect").length - 1);
  const resweepsLeft = Math.max(0, MAX_RESWEEPS - resweeps);
  // A measurement that still fails after every new sweep is no longer the sweep's: the explorer chooses another page or accepts it.
  const owner = (gap: Gap): Gap =>
    gap.fixedBy !== "sweep"
      ? { ...gap, fixedBy: "explorer" }
      : resweepsLeft > 0
        ? gap
        : { ...gap, fixedBy: "explorer", missingNl: `${gap.missingNl} De veegronde is na de laatste verkenning ${resweeps} keer opnieuw gedraaid en mat dit nog steeds niet. Ligt dat aan de pagina, kies dan voor het paginatype een pagina die wel te meten is, of leg in acceptedGaps vast dat het aan de site ligt.` };
  const fixed = fixedGaps.map(owner);
  const all = [...fixed, ...reviewedGaps.map(owner)];
  const gaps = all.filter((gap) => !isAccepted(gap));
  const forSweep = gaps.some((gap) => gap.fixedBy === "sweep");
  const fixedOpen = fixed.some((gap) => !isAccepted(gap));
  // The review waits only for what a new sweep changes, so that a return hands the explorer the gaps of the fixed checks and of the pictures at once.
  const stage: Gate["stage"] = answered ? "complete" : forSweep || (fixedOpen && returnsLeft === 0) ? "deterministic" : "review-pending";
  const sufficient = stage === "complete" && gaps.length === 0;
  const next = sufficient ? "proceed" : forSweep ? "sweep" : stage === "review-pending" ? "review" : returnsLeft > 0 ? "explore" : "stop";
  return { sufficient, stage, next, exploreRound, returnsLeft, resweeps, resweepsLeft, gaps, all };
}

/**
 * Run the gate: the fixed checks, the sheets and the task for the agent, and, when the
 * agent's answers are there and checked, the verdict on the evidence as a whole. With
 * `outDir` everything the gate writes goes there and the run itself is only read: for
 * looking at a run that must stay as it is.
 */
export async function gate(runDir: string, outDir: string = runDir): Promise<Gate> {
  const startedAt = stepStart();
  const run = await loadRun(runDir);
  const absoluteRun = resolve(runDir);
  const absoluteOut = resolve(outDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const fixed = gateChecks(run);
  const sheets = await buildSheets(run, runDir, outDir);

  // A page type nobody can look at is a gap of the fixed checks, like a measurement that is missing.
  const withoutSheet = sheetGaps(run, sheets);
  fixed.gaps.push(...withoutSheet);
  fixed.checks.push({ name: "sheets", ok: withoutSheet.length === 0, noteNl: withoutSheet.length === 0 ? `${sheets.length} ${sheets.length === 1 ? "paginatype heeft" : "paginatypen hebben elk"} een overzichtsblad` : `${withoutSheet.length} ${withoutSheet.length === 1 ? "gat" : "gaten"}` });

  const template = readTemplate("poort");
  // One task per SHEETS_PER_TASK sheets, so the task of one agent stays the same size however many page types a site has.
  const parts = reviewParts(sheets);
  for (const part of parts) {
    const example = {
      model: "<naam en versie van je model, of onbekend>",
      sheets: [
        {
          pageType: part.sheets[0]?.pageType ?? "start",
          reviewedAs: part.sheets[0] ? reviewedAs(part.sheets[0]) : "<kenmerk van het blad>",
          answers: Object.fromEntries(QUESTIONS.map((question) => [question.id, { answer: question.bad === "ja" ? "nee" : "ja", noteNl: "" }])),
          stateTiles: [{ tile: 4, answer: "ja", noteNl: "" }],
          remarkNl: "",
        },
      ],
    };
    await writeFileAtomic(
      join(outDir, part.task),
      fill(template, {
        site: siteLabel(run.inventory),
        run: absoluteRun,
        sheets: part.sheets.map((sheet) => sheetText(sheet, absoluteOut)).join("\n\n") || "Er zijn geen bladen: de run heeft geen schermafbeeldingen.",
        questions: [...QUESTIONS.map((question) => `- \`${question.id}\`: ${question.questionNl}`), `- \`stateTiles\`: ${STATE_QUESTION_NL}`].join("\n"),
        example: JSON.stringify(example, null, 2),
        output: join(absoluteOut, part.answers),
        check: `node ${cli} check-gate --run ${absoluteOut}`,
        workDir: await makeWorkDir(outDir, basename(part.task, ".md")),
        workName: basename(part.task, ".md"),
      }),
    );
  }
  // Tasks of an earlier gate, when the site had more page types, must not be handed out again.
  for (let nr = parts.length + 1; existsSync(join(outDir, "gate", `poort-${nr}.md`)); nr++) await rm(join(outDir, "gate", `poort-${nr}.md`));

  await setAsideStaleAnswers(outDir, parts);
  const answers = await currentAnswers(outDir, sheets);
  const reviewed = answers ? reviewGaps(answers, sheets) : { gaps: [], warnings: [] };
  const remarks = (answers?.sheets ?? []).flatMap((entry) => (typeof entry.remarkNl === "string" && entry.remarkNl.trim() ? [{ pageType: entry.pageType, remarkNl: entry.remarkNl.trim() }] : []));

  // A gap the explorer confirmed as a property of the site does not hold the run back.
  const acceptedBy = (gap: Gap) => acceptedGapFor(run.siteModel, { check: gap.check, page: gap.url, component: gap.component, state: gap.state });
  const manifestPath = join(runDir, "manifest.json");
  const routed = route(fixed.gaps, reviewed.gaps, answers !== null, existsSync(manifestPath) ? (await readJson<Manifest>(manifestPath)).steps : [], (gap) => acceptedBy(gap) !== undefined);
  const accepted = routed.all.filter((gap) => acceptedBy(gap)).map((gap) => ({ ...gap, reasonNl: acceptedBy(gap)!.reasonNl, observation: acceptedBy(gap)!.observation, decidedBy: acceptedBy(gap)!.decidedBy }));
  const { gaps, stage, next } = routed;
  const result: Gate = {
    sufficient: routed.sufficient,
    stage,
    next,
    exploreRound: routed.exploreRound,
    returnsLeft: routed.returnsLeft,
    resweeps: routed.resweeps,
    resweepsLeft: routed.resweepsLeft,
    hasSiteModel: Boolean(run.siteModel),
    thresholds: THRESHOLDS,
    checks: fixed.checks,
    gaps,
    accepted,
    warnings: [...fixed.warnings, ...reviewed.warnings],
    limitations: fixed.limitations,
    remarks,
    review: {
      task: join(absoluteOut, parts[0]!.task),
      answers: join(absoluteOut, parts[0]!.answers),
      tasks: parts.map((part) => ({ task: join(absoluteOut, part.task), answers: join(absoluteOut, part.answers), pageTypes: part.sheets.map((sheet) => sheet.pageType) })),
      answered: answers !== null,
      sheets,
      withoutSheet: (run.siteModel?.pageTypes ?? []).map((type) => type.id).filter((id) => !sheets.some((sheet) => sheet.pageType === id)),
      candidates: join(absoluteOut, "gate", "candidates.json"),
    },
  };
  // What the review saw that looks like a defect of the site itself is no gap in the evidence. It is kept as a lead for the walk-through and the judges.
  await writeJson(join(outDir, "gate", "candidates.json"), remarks.map((remark) => {
    const sheet = sheets.find((entry) => entry.pageType === remark.pageType);
    return { pageType: remark.pageType, page: sheet?.page ?? null, url: sheet?.url ?? null, sheet: sheet?.file ?? null, seenNl: remark.remarkNl };
  }));
  await writeJson(join(outDir, "gate.json"), result);
  if (absoluteOut === absoluteRun) await writeManifest(runDir, { command: "gate", startedAt, stage, next, sufficient: result.sufficient, gaps: gaps.length, warnings: result.warnings.length, templateSha256: sha256(template) });
  return result;
}
