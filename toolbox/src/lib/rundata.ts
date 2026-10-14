import type { FrameListeners, FrameNotInspected } from "../instruments/facts.ts";
import type { MediaReport } from "../instruments/media.ts";
import type { ContentInventory, SpacingControls } from "../instruments/overflow.ts";
import type { CoverWalk } from "../instruments/keyboard.ts";
import type { LanguagesFound } from "../instruments/languages.ts";
import type { OrderReport } from "../instruments/order.ts";
import type { PictureReport } from "../instruments/pictures.ts";
import type { BetweenWidths } from "../instruments/widths.ts";
import type { SpokenByItself } from "../instruments/methods/speech.ts";
import type { Change } from "../instruments/change.ts";
import type { AfterSubmit, TimeLimitProbe, WatchState } from "./timelimits.ts";
import type { ClipboardWrite } from "../browser/clipboard.ts";
import type { Placement } from "../browser/session.ts";
import { loginForRun, type LoginMark } from "./login.ts";
import { writesForRun, type WritePermission } from "./writes.ts";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mergeWidths, type OperableGroup, type RecipeSteps } from "./operables.ts";
import type { Inventory } from "../commands/inventory.ts";
import type { Sample, SampleItem } from "../commands/sample.ts";
import { pageLabels, readJson } from "./canonical.ts";
import { loadDocuments, type DocumentData } from "./documents.ts";
import type { PageContrast } from "../commands/contrast.ts";

/** What was measured in one captured state of the site model. */
/** One element a skip link can point at, and whether it can take focus at all. */
export type SkipLinkElement = { tag: string; id: string | null; path: string[]; rendered: boolean; tabindex: string | null };
/** Where a skip link points: the element its href names (or that the id is missing), and the element after it in the code. */
export interface SkipLinkAim {
  href: string | null;
  target: SkipLinkElement | { missing: string } | null;
  following: SkipLinkElement | null;
}

export interface StateEvidence {
  /** Audio and video as they were in this state. Absent in older runs. */
  media?: MediaReport;
  engines: EngineRun;
  contrast: Pick<PageContrast, "measurements" | "controls" | "graphics">;
  /** The same on the dark scheme, for which the state was opened again. Absent for a blocker and in older runs. */
  contrastDark?: Pick<PageContrast, "measurements" | "controls" | "graphics">;
  /** Size of every control in this state. Absent in older runs. */
  targets?: PageData["targets"];
  /** The wider text spacing, in force before the state was opened. Absent in older runs, where it was applied afterwards. */
  textSpacing?: Partial<PageData["textspacing"]> & { appliedBeforeOpening?: boolean; reachedWithSpacing?: boolean; reasonNl?: string | null; stateStillReachedAfterwards?: boolean | null };
  /** Links and controls as they were in this state, for the comparison of visible text and name. */
  links?: Facts["links"];
  controls?: Facts["controls"];
  /** Timers counted from the load of the page until the state was open and measured: what a step of the recipe started is among them. Absent in older runs. */
  timers?: Facts["timers"];
  /** Every timer with what it did, the meta refreshes, cookies and stored values in this state (2.2.1). Absent in older runs. */
  timeLimits?: TimeLimitProbe;
  /** For a state whose recipe fills in a form and does not send it: the form sent, and the timers that started then (2.2.1). Absent otherwise and in older runs. */
  timeLimitsAfterSubmit?: AfterSubmit;
  /** Images and background images as they were in this state. */
  images?: Facts["images"];
  backgroundImages?: Facts["backgroundImages"];
  /** The order of the code against the order on screen in this state. */
  order?: OrderReport;
  /** Every picture in this state with what text recognition read in it. Absent in older runs. */
  pictures?: PictureReport;
  /** The language of the text alternatives, names and visible text in this state. Absent in older runs. */
  languages?: LanguagesFound;
  /** The Tab walk forward from where focus was after opening. */
  tabwalk?: { outcome: string; stopCount: number; stops: TabStop[] };
  /** Walks back with Shift+Tab and along with the arrow keys, with what lay over each stop. Absent in older runs. */
  focusCovered?: { walks: CoverWalk[]; stateStillReachedAfterwards?: boolean | null };
}
import type { SiteStates } from "../commands/modelsweep.ts";
import type { Overlay } from "../session/recipe.ts";
import type { EngineRun } from "./engines.ts";
import { readSiteModel, type SiteModel } from "./sitemodel.ts";

export interface AxInfo {
  role: string | null;
  name: string | null;
  description: string | null;
  ignored: boolean;
  properties: Record<string, unknown>;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element as recorded by the in-page library, plus what the accessibility tree says about it. */
export interface Element {
  tag: string;
  path: string[];
  box: Box;
  visible: boolean;
  text: string;
  region: string | null;
  roleAttr: string | null;
  ariaLabel: string | null;
  ariaHidden: boolean;
  lang: string | null;
  ax?: AxInfo | null;
  [key: string]: unknown;
}

/** A visible element that responds to a click but is not a control (a div with a click handler, an anchor without href). */
export interface Clickable extends Element {
  /** Why it counts as clickable: "click-listener", "onclick", a data attribute, "cursor: pointer", "a-without-href". */
  signals: string[];
  html: string;
  tabindex: string | null;
  focusable: boolean;
}

/** A heading as the structure candidates refer to it. */
export interface HeadingRef {
  tag: string;
  path: string[];
  text: string;
  level: number | null;
  region: string | null;
}

/** Places where the markup may say something else than the page shows; candidates, not findings. */
export interface StructureCandidates {
  beforeHeading: (HeadingRef & { before: string[]; block: string[] })[];
  headingsWithoutContent: (HeadingRef & { nextHeading: string | null; controlsAfter: string[]; before: string[] })[];
  cardTitlesAtSectionLevel: (HeadingRef & { sectionHeading: string; card: string[] })[];
  boldLeads: { tag: string; path: string[]; region: string | null; text: string; kind: "lead-and-break" | "whole-paragraph"; followedBy: string }[];
  dashLines: { tag: string; path: string[]; region: string | null; text: string; lines: string[]; lineCount: number }[];
}

/** How a hidden input's visible stand-in is drawn: a pseudo-element of its label. Colours are [r, g, b, alpha]. */
export interface DrawnBox {
  pseudo: string;
  width: string;
  height: string;
  borderStyle: string;
  borderWidth: string;
  borderColour: [number, number, number, number];
  background: [number, number, number, number];
}

export interface Facts {
  url: string;
  title: string;
  lang: string | null;
  viewportMeta: string | null;
  mainText: string;
  headings: (Element & { level: number | null })[];
  landmarks: (Element & { inMain?: boolean })[];
  images: (Element & { alt: string | null; src: string | null; svgTitle: string | null; inInteractive: string | null; interactiveText: string; context: string })[];
  backgroundImages: Element[];
  /**
   * `sentence` is the text of the enclosing sentence-level element named in `sentenceFrom`, or null when there is none.
   * Runs from before that restriction have no `sentenceFrom`; their `sentence` is the text of the parent, whatever it is.
   */
  links: (Element & { href: string | null; target: string | null; context: string; contextFrom?: "block" | "preceding" | null; sentence: string | null; sentenceFrom?: string | null; parentTag?: string | null; coveredText?: string | null })[];
  controls: (Element & {
    type: string | null;
    autocomplete: string | null;
    required: boolean;
    placeholder: string | null;
    disabled: boolean;
    labelText: string | null;
    inForm: boolean;
    tabindex: string | null;
    /** How an input is kept from rendering ("display: none", "visibility: hidden"); null when it is rendered. Absent in older runs. */
    hiddenBy?: string | null;
    labelVisible?: boolean;
    drawnBox?: DrawnBox[];
    /** The colour the label is painted on, for the contrast of the drawn box. */
    labelBackground?: [number, number, number, number];
  })[];
  /** Absent in runs collected before these were recorded. */
  clickables?: Clickable[];
  structure?: StructureCandidates;
  langParts: (Element & { langValue: string })[];
  iframes: (Element & { title: string | null; src: string | null })[];
  tables: (Element & { caption: string; headerCells: number; rows: number })[];
  counts: Record<string, number | string[]>;
  listeners: Record<string, Record<string, number>>;
  /** The same count for every frame on the page, read on the spot. Absent in older runs. */
  frameListeners?: FrameListeners[];
  /** Frames whose listeners could not be counted, by address. Absent in older runs. */
  framesNotInspected?: FrameNotInspected[];
  /** Audio and video in this state of the page. Absent in older runs. */
  media?: MediaReport;
  timers: { intervals: number[]; longTimeouts: number[] };
}

export interface TabStop extends Element {
  index: number;
  inViewport: boolean;
  focusPixelShare: number | null;
  indicatorColour?: string | null;
  indicatorOver?: string | null;
  indicatorRatio?: number | null;
  focusScreenshot?: string;
  coveredBy: string[] | null;
  outline: string;
  href: string | null;
  /** When the stop is an embedded frame: the places inside it that focus went to before it left the frame again. */
  frameStops?: { tag: string; text: string; path: string[]; frameUrl: string }[];
  /** False when the element was not painted at the place of the screenshot clip; then nothing was measured. Absent in older runs. */
  clipVerified?: boolean;
  focusNotMeasured?: string;
}

export interface OverflowProbe {
  horizontalScroll: boolean;
  scrollWidth: number;
  viewportWidth: number;
  /** `overflowContainer` is the nearest ancestor that clips or scrolls sideways; null when none does, absent in older runs. */
  offenders: (Element & { right: number; overflowContainer?: { tag: string; path: string[]; overflowX: string; scrollWidth: number; clientWidth: number } | null })[];
  clipped: (Element & { textOverflow: string })[];
  visibleControls: string[];
  /** Clickable elements that are not a control, as visible at this window size. Absent in older runs. */
  clickables?: Clickable[];
  viewport?: { width: number; height: number };
  /** Headings, images and blocks of text as visible at this size. Absent in older runs. */
  content?: ContentInventory;
}

export interface PageData {
  /** Short label used in dossiers and reports, e.g. "P07". */
  label: string;
  item: SampleItem;
  dir: string;
  /** For an embedded window: whether the sweep measured it on the page it stands on, or on its own and why. Absent for a page, and in runs from before windows were measured in place. */
  placement?: Placement;
  facts: Facts;
  /** Audio and video on the page, with the candidate controls tried on a page that was then thrown away. Absent in older runs. */
  media?: MediaReport;
  engines: Record<"light" | "dark", EngineRun>;
  tabwalk: { outcome: string; stopCount: number; stops: TabStop[]; initialFocus?: TabStop | null; /** Elements that threw focus away when they got it; the walk went on behind them. */ focusThrownAwayBy?: { where: string; tag: string; text: string; afterStop: number }[]; arrowReach?: { from: string; key: string; reached: { tag: string; text: string; where: string; region: string | null }[] }[] };
  /** The same walk on the dark colour scheme, for the focus indicator; absent in older runs. */
  tabwalkDark: { outcome: string; stopCount: number; stops: TabStop[] } | null;
  /** The same walk in a window of 360 pixels wide; only in a run with a site model. */
  tabwalkNarrow?: { outcome: string; stopCount: number; stops: TabStop[] } | null;
  reflow: OverflowProbe;
  zoom200: OverflowProbe;
  portrait: OverflowProbe;
  textspacing: { shadowRootsStyled: number; clippedBefore: number; newlyClipped: Element[]; horizontalScrollAfter: boolean; textWithoutSpacing?: Element[]; textWithoutSpacingCount?: number; /** Controls that came and went with the wider spacing, and what a button that came showed. Absent in older runs. */ controls?: SpacingControls };
  /** Headings, images and blocks of text in the default window. Absent in older runs. */
  content?: ContentInventory;
  targets: (Element & { width: number; height: number; inlineInText: boolean })[];
  skiplink: { isSkipLink: boolean; firstTabStop: TabStop | null; before?: { scrollY: number; hash: string }; after?: { scrollY: number; hash: string }; focusAfterActivation?: TabStop | null; nextTabStop?: TabStop | null; /** Absent in a run from before this was kept. */ aim?: SkipLinkAim | null };
  motion: { runningAnimations: number; longOrInfinite: { name: string; iterations: string; durationMs: number; target: Element | null }[]; gifImages: number; autoplayMedia: number; marqueeBlink: number; intervals: number[]; longTimeouts: number[] };
  scrollRegions: (Element & { selfFocusable: boolean; focusableInside: boolean; scrollsX: boolean; scrollsY: boolean })[];
  /** Only in a run with a site model: what stays in place while the page scrolls, and how much of the window it covers. */
  overlays?: Overlay[] | null;
  /** The page at 320 pixels wide: target sizes, links and controls with their names, and the wider text spacing. Absent in older runs. */
  smallest?: { viewport: { width: number; height: number }; targets: PageData["targets"]; links: Facts["links"]; controls: Facts["controls"]; textspacing: PageData["textspacing"] };
  /** Links and controls as they are in the narrow window of 360 pixels wide, where the narrow Tab walk was done. Absent in older runs. */
  narrow?: { links: Facts["links"]; controls: Facts["controls"] };
  /** The forms and loose controls of the page, in the default window and what the narrow one adds. Absent in older runs. */
  operables?: OperableGroup[];
  /** The order of the code against the order on screen, in the default window and at 320 pixels wide. Absent in older runs. */
  order?: OrderReport;
  order320?: OrderReport;
  /** Text laid out with spaces or hard line breaks instead of markup. Absent in older runs. */
  spacedText?: { candidates: { kind: string; tag: string; region: string | null; path: string[]; inCode: boolean; lines: string[] }[] };
  /** The language of the text alternatives and names of the page. Absent in older runs. */
  languages?: LanguagesFound;
  /** Every timer with what it did, the meta refreshes, cookies and stored values (2.2.1). Absent in older runs. */
  timeLimits?: TimeLimitProbe;
  /** Every picture on the page with what text recognition read in it. Absent in older runs. */
  pictures?: PictureReport;
  /** Controls that show at none of the measured widths, and the page at a width where they do. Absent in older runs. */
  widths?: BetweenWidths & { failedNl?: string };
}

/** One dialog, sheet or expander that the states probe opened by activating a trigger. */
export interface DialogState {
  page: string;
  /** Window size at which the trigger was visible and activated. */
  viewport: string;
  trigger: string;
  triggerWhere: string;
  opened: boolean;
  /** How the trigger responded: to Enter, to Space, only to a mouse click, or not at all. */
  activatedBy: "Enter" | "Space" | "click" | null;
  kind: string | null;
  dialogName: string | null;
  focusMovedInto: boolean | null;
  focusAfterOpen: string | null;
  /** Distinct controls inside that the keyboard reached, counting the one focus stood on after opening. */
  tabStopsInside: number | null;
  stopsInside?: string[];
  focusStaysInside: boolean | null;
  /** Where focus went when Tab left the dialog; absent when it stayed inside. */
  focusLeftTo?: string;
  escapeCloses: boolean | null;
  focusReturnsToTrigger: boolean | null;
  controlsInside: { role: string | null; name: string | null }[];
  engineFailures: { engine: string; rule: string; outcome: string; criteria: string[]; nodes: number; message: string }[];
  screenshot: string | null;
  /**
   * Only for a trigger whose name says it copies: what the page wrote to the clipboard while the
   * trigger was activated (with Enter, Space and a click, so the same write can be there more
   * than once). `written` false with `refusedByBrowser` false means the button wrote nothing. Absent in older runs.
   */
  clipboard?: { written: boolean; refusedByBrowser: boolean; writes: ClipboardWrite[]; nl: string };
}

/** The attempt on a form that a visitor makes: only what the form asks for, the rest left empty. */
export const REGULAR_PATH = "verplichte velden gevuld, optionele leeg";

export interface FormErrorState {
  page: string;
  form: string;
  openedVia: string | null;
  fields: { role: string | null; name: string | null; required: boolean; type: string | null; invalidBeforeInput: boolean }[];
  submitControl: string | null;
  /** Whether filling in a field and leaving it changed the address or opened a window. */
  changeOnInput?: string;
  attempts: {
    input: string;
    submitted: boolean;
    requestBlocked: boolean;
    /** Only on a test environment where the run may write: what the server answered to the submission. */
    sent?: { method: string; path: string; status: number }[];
    /** Whether the submission replaced the page, and if so with which one; the messages below are then read from that page. Absent in older runs. */
    navigated?: boolean;
    urlAfterSubmit?: string;
    titleAfterSubmit?: string;
    /** Set when the attempt could not be completed; nothing else in it was examined. */
    failed?: string;
    invalidFields: { name: string | null; describedBy: string | null; browserValidation: string | null }[];
    newVisibleMessages: string[];
    liveRegionMessages: string[];
    /** What a simulated screen reader said by itself after the submission. Absent in older runs and when the submission replaced the page. */
    spokenByItself?: SpokenByItself;
    focusAfterSubmit: string | null;
    screenshot: string | null;
    /**
     * Whether the submission led to anything a visitor can notice. `request` is "tegengehouden" when
     * the guard held back what the form sent: the form did submit. `nothing` is the signal. Absent in older runs.
     */
    outcome?: {
      request: "verstuurd" | "tegengehouden" | "geen";
      /** Method and path of what the submission set in motion, to tell the form from a counter of visits. */
      requests: string[];
      message: boolean;
      pageChanged: boolean;
      nothing: boolean;
      /** Required fields the probe had no value for. */
      unfilled?: string[];
      nl: string;
    };
  }[];
}

export interface States {
  dialogs: DialogState[];
  formErrors: FormErrorState[];
  singleKeys: {
    pagesExamined: number;
    keysPressed: string[];
    reactions: { page: string; key: string; change: string; details?: Change }[];
    /** Only in a run with a site model: the same keys in each state of the model, opened by its recipe. Absent in older runs. */
    states?: { state: string; examined: boolean; reasonNl: string | null; /** Where focus was after opening; in a text field it was taken out first. */ focusAfterOpening: string | null; focusTakenOutOfTextField: boolean; keysPressed: number; reactions: { key: string; change: string }[]; /** Keys left when the probe stopped after many reactions. */ keysNotPressed?: string[] }[];
  };
  /** `state` is set for what was found in a state of the site model, `viewport` for what was found in the narrow window. */
  hover: { page: string; control: string; newContent: string; trigger: "hover" | "focus"; dismissedByEscape: boolean | null; staysWhenPointerMovesOntoIt: boolean | null; screenshot: string | null; state?: string; viewport?: "smal" }[];
  examined: { triggers: number; forms: number; hoverTargets: number; downEventTargets?: number };
  /**
   * What the hover probe pointed at and what it left out: nothing is cut off silently. Absent in older runs.
   * Since the probe goes by kinds of control (`kinds` is there), `found` counts the distinct controls of the pages,
   * `examined` the controls that were pointed at, `notExamined` the kinds of which none was, and `sameKindNotExamined`
   * the controls that were not pointed at because others of their kind were. In an older run `notExamined` counts controls.
   */
  hoverCoverage?: {
    limit: number;
    found: number;
    examined: number;
    notExamined: number;
    notExaminedExamples: { page: string; control: string }[];
    /** How many controls of one kind are pointed at. */
    perKind?: number;
    kinds?: number;
    sameKindNotExamined?: number;
    /** How many of the examined ones are no control: an abbreviation, a term or an icon with a title or a description. They are in `found` and `kinds` too. */
    nonControlsExamined?: number;
    /** Every control with only a pictogram, or with a title or a description, and every element that is no control but has one, and on which trigger content appeared: an empty list says nothing appeared. */
    iconOnly?: { page: string; control: string; state?: string; viewport?: "smal"; nonControl?: boolean; iconOnly: boolean; title: string | null; describedBy: string | null; contentAppeared: ("hover" | "focus")[] }[];
    /** The pages, one of each page type, where the probe was repeated in the narrow window. */
    narrowPages?: string[];
    /** Per state of the site model: the controls that were not on a page, and how many of them were pointed at. */
    states?: { state: string; viewport: string | null; examined: boolean; reasonNl: string | null; controls: number; kinds: number; pointedAt: number }[];
  };
  /** Contrast of the text of links and buttons while pointed at and while they have focus, one measurement per distinct control (WCAG 1.4.3). Light scheme only. */
  hoverContrast?: { page: string; control: string; where: string; trigger: "hover" | "focus"; state?: string; viewport?: "smal"; texts: { text: string; foreground: string; background: string | null; ratio: number | null; required: number; outcome: string; reason: string | null }[] }[];
  /** What the press probe examined and what it left out. Absent in older runs, which stopped at 40 kinds without saying so. */
  downEventCoverage?: {
    limit: number;
    /** Kinds of control a down-event can reach a listener through, over all pages. */
    kindsFound: number;
    examined: number;
    /** Kinds that were on the page when it was listed and gone when the probe came to press. */
    goneBeforePress: { page: string; control: string }[];
    notExamined: number;
    notExaminedExamples: { page: string; control: string }[];
    pagesWithOwnListener: string[];
    /** Pages where only the document or window listens: there one control of each kind per region was pressed. */
    pagesWithOnlyDelegatedListener: string[];
    pagesWithoutListener: number;
    /** The pages, one of each page type, where the probe was repeated in the narrow window. Absent in older runs. */
    narrowPages?: string[];
    /** Per state of the site model: the kinds of control that were not on a page, and how many were pressed. Absent in older runs. */
    states?: { state: string; viewport: string | null; examined: boolean; reasonNl: string | null; kindsFound: number; pressed: number }[];
  };
  /** What happens when a checkbox, switch, radio button or select list is changed: does the state reach assistive technology, and does the context stay put. */
  settings?: { page: string; openedVia: string | null; control: string; kind: string; stateBefore: string; stateAfter: string; stateChanged: boolean; contextChange: string | null }[];
  /** Probe steps that did not finish; what they would have examined is unexamined. */
  skipped?: { page: string; step: string }[];
  /**
   * Where the probes reached each embedded window of the sample: on the page it stands on (`inPlaceOn`), or opened on
   * its own with the reason (`apartNl`). `failedNl` names each probe that did not work inside the window. Absent in a
   * run from before the probes went into a window, where every window was opened on its own.
   */
  embedded?: { page: string; url: string; inPlaceOn: string | null; apartNl: string | null; failedNl: string[] }[];
  /** Whether moving focus with the arrow keys inside a list or menu changed the address or opened a window (WCAG 3.2.1). */
  arrowFocus?: { page: string; fromTabStop: string; key: string; steps: number; contextChange: string | null }[];
  /** Only in a run with a site model: blockers that came up during the probe although they were closed before, and whether they were closed again. */
  blockers?: { closedOnPage: number; notClosed: { url: string; blocker: string; reasonNl: string | null }[] };
  /** Listeners the test browser registers on an empty page; these are not the site's. */
  browserListeners?: Record<string, Record<string, number>>;
  /** What happens when the pointer goes down on a control and is released somewhere else (WCAG 2.5.2). */
  downEvents?: {
    page: string;
    control: string;
    /** The tag with its type or role; with `via` it says what one probe stands for. Absent in older runs. */
    kind?: string;
    via?: "own" | "delegated";
    /** The sorts of effect the press had: "adres", "venster", "toestand" (ticked, pressed, expanded), "tekst", "statusmelding", "scroll". */
    effectOnDown?: string[];
    listenerOn: string;
    /** What the control did while the pointer was held down, before release. Null: nothing but its own look and focus. */
    changeOnDown: string | null;
    /** What happened after the pointer was moved away and released there. */
    changeAfterReleaseElsewhere: string | null;
    /** Only when the press did something: whether that was gone again after releasing elsewhere. False means the user cannot back out. Absent in older runs. */
    undoneByReleasingElsewhere?: boolean;
    /** Set for a press in a state of the site model, and for one in the narrow window. */
    state?: string;
    viewport?: "smal";
    details?: { onDown: Change; afterRelease: Change | null };
  }[];
}

export interface RunData {
  /** Present once the states probe has run; without it, behaviour after interaction is unexamined. */
  states: States | null;
  /** Present once the contrast measurement has run. */
  contrast: PageContrast[] | null;
  dir: string;
  inventory: Inventory;
  sample: Sample;
  pages: PageData[];
  /**
   * Set when the run may send requests that change something, to one origin of a test
   * environment. Null: every such request was held back, so nothing that only appears after submitting was examined.
   */
  writes?: WritePermission | null;
  /** Set when a person logged in for this run: the role and the pages that tell logged in from logged out. Never the session. */
  login?: LoginMark | null;
  /** What the exploring agent recorded about the site; null in a run without it. Absent in data built by hand. */
  siteModel?: SiteModel | null;
  /** The states of the site model as the sweep captured them, and which blockers it had to close. */
  siteStates?: SiteStates | null;
  /** Engine results and contrast per captured state, by state id. */
  stateEvidence?: Record<string, StateEvidence>;
  /** The documents of the sample with what was measured in them. Empty when the site has none; absent in data built by hand. */
  documents?: DocumentData[];
  /** The watch on the session of a run with a login (`session-watch.json`); null when there is none. Absent in data built by hand. */
  sessionWatch?: WatchState | null;
  /** The saved states of the run by name, as far as the gate needs them: where each starts and which elements its steps operate. */
  recipes?: Record<string, RecipeSteps>;
}

export async function loadRun(dir: string): Promise<RunData> {
  const inventory = await readJson<Inventory>(join(dir, "inventory.json"));
  const sample = await readJson<Sample>(join(dir, "sample.json"));
  const labels = pageLabels(sample.items.length);
  const pages: PageData[] = [];
  for (const [index, item] of sample.items.entries()) {
    const pageDir = join(dir, "pages", item.slug);
    if (!existsSync(join(pageDir, "probes", "textspacing.json"))) {
      throw new Error(`no collected evidence for ${item.url}; run "collect" first`);
    }
    const probe = <T>(name: string): Promise<T> => readJson<T>(join(pageDir, "probes", `${name}.json`));
    pages.push({
      label: labels[index]!,
      item,
      dir: join("pages", item.slug),
      facts: await readJson<Facts>(join(pageDir, "facts.json")),
      engines: {
        light: await readJson<EngineRun>(join(pageDir, "engines-light.json")),
        dark: await readJson<EngineRun>(join(pageDir, "engines-dark.json")),
      },
      tabwalk: await probe("tabwalk"),
      tabwalkDark: existsSync(join(pageDir, "probes", "tabwalk-dark.json")) ? await probe("tabwalk-dark") : null,
      reflow: await probe("reflow"),
      zoom200: await probe("zoom200"),
      portrait: await probe("portrait"),
      textspacing: await probe("textspacing"),
      targets: await probe("targetsize"),
      skiplink: await probe("skiplink"),
      motion: await probe("motion"),
      scrollRegions: await probe("scrollregions"),
      ...(existsSync(join(pageDir, "probes", "placement.json")) ? { placement: await probe<Placement>("placement") } : {}),
      ...(existsSync(join(pageDir, "probes", "named-narrow.json")) ? { narrow: await probe<NonNullable<PageData["narrow"]>>("named-narrow") } : {}),
      ...(existsSync(join(pageDir, "probes", "content.json")) ? { content: await probe<ContentInventory>("content") } : {}),
      ...(existsSync(join(pageDir, "probes", "media.json")) ? { media: await probe<MediaReport>("media") } : {}),
      ...(existsSync(join(pageDir, "probes", "overlays.json")) ? { overlays: await probe<Overlay[]>("overlays") } : {}),
      ...(existsSync(join(pageDir, "probes", "tabwalk-narrow.json")) ? { tabwalkNarrow: await probe("tabwalk-narrow") } : {}),
      ...(existsSync(join(pageDir, "probes", "smallest.json")) ? { smallest: await probe<NonNullable<PageData["smallest"]>>("smallest") } : {}),
      ...(existsSync(join(pageDir, "probes", "order.json")) ? { order: await probe<OrderReport>("order") } : {}),
      ...(existsSync(join(pageDir, "probes", "order-320.json")) ? { order320: await probe<OrderReport>("order-320") } : {}),
      ...(existsSync(join(pageDir, "probes", "spacedtext.json")) ? { spacedText: await probe<NonNullable<PageData["spacedText"]>>("spacedtext") } : {}),
      ...(existsSync(join(pageDir, "probes", "languages.json")) ? { languages: await probe<LanguagesFound>("languages") } : {}),
      ...(existsSync(join(pageDir, "probes", "timelimits.json")) ? { timeLimits: await probe<TimeLimitProbe>("timelimits") } : {}),
      ...(existsSync(join(pageDir, "probes", "pictures.json")) ? { pictures: await probe<PictureReport>("pictures") } : {}),
      ...(existsSync(join(pageDir, "probes", "widths.json")) ? { widths: await probe<NonNullable<PageData["widths"]>>("widths") } : {}),
      ...(existsSync(join(pageDir, "probes", "operables.json")) ? { operables: mergeWidths(await probe<OperableGroup[]>("operables"), existsSync(join(pageDir, "probes", "operables-narrow.json")) ? await probe<OperableGroup[]>("operables-narrow") : []) } : {}),
    });
  }
  const statesPath = join(dir, "states.json");
  const states = existsSync(statesPath) ? await readJson<States>(statesPath) : null;
  const contrastPath = join(dir, "contrast.json");
  const contrast = existsSync(contrastPath) ? await readJson<PageContrast[]>(contrastPath) : null;
  const siteStatesPath = join(dir, "site-states.json");
  const siteStates = existsSync(siteStatesPath) ? await readJson<SiteStates>(siteStatesPath) : null;
  const stateEvidence: Record<string, StateEvidence> = {};
  for (const state of siteStates?.states ?? []) {
    if (state.reached && state.files.engines && state.files.contrast) {
      const facts = state.files.facts ? await readJson<Facts>(join(dir, state.files.facts)) : undefined;
      const optional = async (key: string, name: string): Promise<Record<string, unknown>> => (state.files[name] && existsSync(join(dir, state.files[name])) ? { [key]: await readJson(join(dir, state.files[name])) } : {});
      stateEvidence[state.id] = {
        engines: await readJson(join(dir, state.files.engines)),
        contrast: await readJson(join(dir, state.files.contrast)),
        ...(facts?.media ? { media: facts.media } : {}),
        ...(facts ? { links: facts.links, controls: facts.controls, timers: facts.timers, images: facts.images, backgroundImages: facts.backgroundImages } : {}),
        ...(await optional("contrastDark", "contrastDark")),
        ...(await optional("targets", "targets")),
        ...(await optional("textSpacing", "textSpacing")),
        ...(await optional("order", "order")),
        ...(await optional("pictures", "pictures")),
        ...(await optional("languages", "languages")),
        ...(await optional("tabwalk", "tabwalk")),
        ...(await optional("focusCovered", "focusCovered")),
        ...(await optional("timeLimits", "timeLimits")),
        ...(await optional("timeLimitsAfterSubmit", "timeLimitsAfterSubmit")),
      };
    }
  }
  const recipes: Record<string, RecipeSteps> = {};
  if (existsSync(join(dir, "recipes"))) for (const file of (await readdir(join(dir, "recipes"))).filter((name) => name.endsWith(".json")).sort()) recipes[file.slice(0, -5)] = await readJson<RecipeSteps>(join(dir, "recipes", file));
  const watchPath = join(dir, "session-watch.json");
  const sessionWatch = existsSync(watchPath) ? await readJson<WatchState>(watchPath).catch(() => null) : null;
  return { states, contrast, dir, inventory, sample, pages, sessionWatch, writes: writesForRun(dir), login: loginForRun(dir), siteModel: await readSiteModel(dir), siteStates, stateEvidence, documents: loadDocuments(dir, sample.documents), recipes };
}
