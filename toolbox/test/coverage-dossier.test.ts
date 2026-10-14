import assert from "node:assert/strict";
import { test } from "node:test";
import { consistency, contrast, controls, hover, images, keyboard, language, orientation, pageCoverage, pointer, readingOrder, reflow, screenshots, stateCoverage, textSpacing, timing, zoom } from "../src/lib/extractors.ts";
import type { PageData, RunData } from "../src/lib/rundata.ts";

/** What the dossier shows of the measurements that close what a full audit left open, on run data built by hand. */

const box = { x: 0, y: 0, width: 100, height: 20 };
const element = (tag: string, path: string, name: string, extra: Record<string, unknown> = {}) => ({ tag, path: [path], box, visible: true, text: name, region: "main", roleAttr: null, ariaLabel: null, ariaHidden: false, lang: null, ax: { role: tag === "a" ? "link" : "button", name, description: null, ignored: false, properties: { focusable: true } }, ...extra });
const content = (headings: string[], images: string[], textBlocks: string[], extra: Record<string, unknown> = {}) => ({ viewport: { width: 1280, height: 800 }, headings, images, textBlocks, rotatedQuarterTurn: [], orientationRules: 0, ...extra });
const probe = (inventory?: unknown) => ({ horizontalScroll: false, scrollWidth: 320, viewportWidth: 320, offenders: [], clipped: [], visibleControls: [], ...(inventory ? { content: inventory } : {}) });
const spacing = { shadowRootsStyled: 0, clippedBefore: 0, newlyClipped: [], horizontalScrollAfter: false, textWithoutSpacingCount: 0 };

function page(label: string, extra: Record<string, unknown> = {}): PageData {
  return {
    label,
    item: { url: `https://site.nl/${label}`, kind: "structured", status: 200, slug: label, templateHash: label, reason: "" },
    dir: `pages/${label}`,
    facts: { headings: [], landmarks: [], links: [], controls: [], iframes: [], listeners: {}, timers: { intervals: [], longTimeouts: [] }, counts: { elements: 1 } },
    tabwalk: { outcome: "completed", stopCount: 0, stops: [] },
    reflow: probe(),
    zoom200: probe(),
    portrait: probe(),
    textspacing: spacing,
    targets: [],
    scrollRegions: [],
    ...extra,
  } as unknown as PageData;
}
const runOf = (pages: PageData[], extra: Record<string, unknown> = {}): RunData => ({ pages, states: null, contrast: null, dir: "", inventory: { totals: {} }, sample: { items: [] }, ...extra }) as unknown as RunData;
const state = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "component", modelId: id, pageTypes: ["start", "tekst"], recipe: id, url: "https://site.nl/P1", viewport: { width: 360, height: 740 }, reached: true, reasonNl: null, stillReachedAfterMeasuring: true, dir: `site-states/${id}`, files: {}, engineSummary: null, contrast: null, largestOverlayShare: 0, ...extra });
const withStates = (run: RunData, states: unknown[], stateEvidence: Record<string, unknown> = {}): RunData => ({ ...run, siteModel: { blockers: [], pageTypes: [], components: [], processes: [], frames: [], notesNl: [] }, siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states }, stateEvidence }) as unknown as RunData;

test("1.4.4, 1.4.10 and 1.3.4: headings, images and text of the default window are laid next to each other size, per page", () => {
  // A countdown reads differently on every load: digits do not make it other text.
  const wide = content(["Titel", "Tarieven"], ["img:Grafiek"], ["Eerste alinea.", "Tweede alinea.", "Tweede alinea.", "Nog 9:59 minuten."]);
  const first = page("P1", { content: wide, zoom200: probe(wide), reflow: probe(content(["Titel"], [], ["Eerste alinea.", "Tweede alinea.", "Nog 9:58 minuten."])), portrait: probe(content(["Titel", "Tarieven"], ["img:Grafiek"], wide.textBlocks, { rotatedQuarterTurn: [{ tag: "div", path: ["#kaart"], text: "Kaart", angle: 90 }], orientationRules: 2 })) });
  const second = page("P2", { content: wide, zoom200: probe(wide), reflow: probe(wide), portrait: probe(wide) });
  const run = runOf([first, second]);
  type Compared = { content: { examined: boolean; pagesCompared: number; pagesWithoutDifference: number; pagesWithDifference: string[]; counted: Record<string, number>; headingsNotVisibleAtThisSize: { text: string; pages: string }[]; imagesNotVisibleAtThisSize: { image: string }[]; textBlocksNotVisibleAtThisSize: { text: string }[] } };
  const at200 = (zoom(run, "1.4.4") as Compared).content;
  assert.deepEqual([at200.examined, at200.pagesCompared, at200.pagesWithoutDifference, at200.counted], [true, 2, 2, { headings: 4, images: 2, textBlocks: 8 }], "every page compared, nothing lost at 200%");
  const at320 = (reflow(run, "1.4.10") as Compared).content;
  assert.deepEqual(at320.pagesWithDifference, ["P1"]);
  assert.deepEqual(at320.headingsNotVisibleAtThisSize.map((row) => row.text), ["Tarieven"]);
  assert.deepEqual(at320.imagesNotVisibleAtThisSize.map((row) => row.image), ["img:Grafiek"]);
  assert.deepEqual(at320.textBlocksNotVisibleAtThisSize.map((row) => row.text), ["Tweede alinea."], "a block that stood twice and is left once is lost once");
  const standing = orientation(run, "1.3.4") as Compared & { rotation: { examined: boolean; pagesExamined: number; rotatedInLandscape: unknown[]; rotatedInPortrait: { where: string; angle: number; pages: string }[]; pagesWithOrientationRules: string[] } };
  assert.deepEqual([standing.rotation.pagesExamined, standing.rotation.rotatedInLandscape.length], [2, 0]);
  assert.deepEqual(standing.rotation.rotatedInPortrait.map((row) => [row.where, row.angle]), [["#kaart", 90]]);
  assert.deepEqual(standing.rotation.pagesWithOrientationRules, ["P1"]);
  // A run from before this was measured says so, and the gate asks for it.
  const older = runOf([page("P1")]);
  assert.equal((zoom(older, "1.4.4") as Compared).content.examined, false);
  const coverage = pageCoverage(older.pages[0]!, older);
  assert.deepEqual([coverage.contentComparedAt320, coverage.contentComparedAt200Percent, coverage.contentComparedInPortrait, coverage.controlsInNarrowWindow, coverage.controlsWithTextSpacing], [false, false, false, false, false]);
  assert.equal(pageCoverage(first, run).contentComparedAt200Percent, true);
});

test("2.1.1: the Tab walk in the narrow window is laid next to what there is to reach there", () => {
  const links = [element("a", "#a", "Start"), element("a", "#b", "Contact"), element("button", "#menu", "Menu"), element("input", "#r2", "Tweede keuze", { ax: { role: "radio", name: "Tweede keuze", ignored: false, properties: { focusable: true } } })];
  const walked = page("P1", {
    narrow: { links: links.slice(0, 2), controls: links.slice(2) },
    tabwalkNarrow: { outcome: "completed", stopCount: 2, stops: [links[0], links[2]] },
    tabwalk: { outcome: "completed", stopCount: 0, stops: [], arrowReach: [{ from: "#r1", key: "ArrowDown", reached: [{ tag: "input", text: "Tweede keuze", where: "#r2", region: "main" }] }] },
  });
  const narrow = (keyboard(runOf([walked]), "2.1.1") as { narrow: { examined: boolean; pagesWalked: number; pagesCompared: number; pages: { page: string; stops: number; focusableElements: number; notReachedByTab: number }[]; notReachedByTab: { name: string }[] } }).narrow;
  assert.deepEqual([narrow.examined, narrow.pagesWalked, narrow.pagesCompared], [true, 1, 1]);
  assert.deepEqual(narrow.pages.map((row) => [row.page, row.stops, row.focusableElements, row.notReachedByTab]), [["P1", 2, 4, 1]]);
  assert.deepEqual(narrow.notReachedByTab.map((row) => row.name), ["Contact"], "the radio button that the arrow keys reach is not counted as unreachable");
  assert.equal((keyboard(runOf([page("P1")]), "2.1.1") as { narrow: { examined: boolean } }).narrow.examined, false);
  assert.equal(pageCoverage(walked, runOf([walked])).controlsInNarrowWindow, true);
});

test("2.2.1: timers that a step of a recipe started are told apart from the ones the page starts when it loads", () => {
  const first = page("P1", { facts: { headings: [], landmarks: [], links: [], controls: [], iframes: [], listeners: {}, timers: { intervals: [1000], longTimeouts: [] }, counts: { elements: 1 } } });
  const run = withStates(runOf([first], { inventory: { totals: { metaRefresh: 0, passwordFields: 0 } } }), [state("process-inlog", { kind: "process" }), state("component-menu"), state("component-oud")], {
    "process-inlog": { timers: { intervals: [1000, 5000], longTimeouts: [1800000] } },
    "component-menu": { timers: { intervals: [1000], longTimeouts: [] } },
  });
  const after = (timing(run, "2.2.1") as { afterAction: { examined: boolean; statesExamined: number; statesWithTimersAfterAction: { state: string; comparedWithPage: string; intervalsStartedAfterAction: number[]; longTimeoutsStartedAfterAction: number[] }[]; statesWithoutTimersAfterAction: string[] } }).afterAction;
  assert.deepEqual([after.examined, after.statesExamined], [true, 2], "a state without the count is not said to have none");
  assert.deepEqual(after.statesWithTimersAfterAction.map((row) => [row.state, row.comparedWithPage, row.intervalsStartedAfterAction, row.longTimeoutsStartedAfterAction]), [["process-inlog", "P1", [5000], [1800000]]]);
  assert.deepEqual(after.statesWithoutTimersAfterAction, ["component-menu"]);
  assert.equal((timing(runOf([first], { inventory: { totals: {} } }), "2.2.1") as { afterAction: { examined: boolean } }).afterAction.examined, false);
});

test("3.2.3 and 1.3.4: an opened component is compared between the page types it stands on", () => {
  const instance = (pageType: string, opened: string[] | null, reasonNl: string | null = null) => ({ pageType, url: `https://site.nl/${pageType}`, viewport: { width: 360, height: 740 }, reached: opened !== null, reasonNl, opened: opened ?? [], screenshot: opened ? `site-states/component-menu/types/${pageType}.png` : null, rotatedQuarterTurn: 0 });
  const menu = state("component-menu", { perPageType: [instance("start", ["Start", "Nieuws", "Contact"]), instance("tekst", ["Start", "Nieuws", "Contact"]), instance("nieuws", ["Start", "Nieuws", "Archief", "Contact"]), instance("zoek", null, "stap 2 (click) vond het element niet terug")] });
  const side = state("component-zijmenu", { perPageType: [instance("start", ["Afval", "Belasting"]), instance("tekst", ["Belasting", "Afval"])] });
  const run = withStates(runOf([page("P1")]), [menu, side, state("component-oud")]);
  type Opened = { opened: { examined: boolean; components: { state: string; pageTypesCompared: number; pageTypesNotOpened: string[]; identicalOnAllPageTypes: boolean; sameOrderOnAllPageTypes: boolean; variants: { items: string[]; pageTypes: string[] }[] }[] } };
  const opened = (consistency(run, "3.2.3") as Opened).opened;
  assert.equal(opened.examined, true);
  assert.deepEqual(opened.components.map((row) => [row.state, row.pageTypesCompared, row.identicalOnAllPageTypes, row.sameOrderOnAllPageTypes]), [["component-menu", 3, false, true], ["component-zijmenu", 2, false, false]], "an item more on one page type is no other order; two items the other way round is");
  assert.deepEqual(opened.components[0]!.pageTypesNotOpened, ["zoek"]);
  assert.deepEqual(opened.components[0]!.variants.map((variant) => variant.pageTypes), [["start", "tekst"], ["nieuws"]]);
  const standing = (orientation(run, "1.3.4") as { componentsPerPageType: { examined: boolean; components: { state: string; pageTypes: number; openedOn: number; notOpenedOn: { pageType: string; reasonNl: string }[]; rows: { screenshot: string }[] }[] } }).componentsPerPageType;
  assert.deepEqual(standing.components.map((row) => [row.state, row.pageTypes, row.openedOn]), [["component-menu", 4, 3], ["component-zijmenu", 2, 2], ["component-oud", 0, 0]]);
  assert.match(standing.components[0]!.notOpenedOn[0]!.reasonNl, /vond het element niet terug/);
  assert.equal(standing.components[0]!.rows[0]!.screenshot, "site-states/component-menu/types/start.png");
  // The gate asks for it per component, and not for a process.
  assert.equal(stateCoverage(menu as never, run).openedPerPageType, true);
  assert.equal(stateCoverage(state("component-oud") as never, run).openedPerPageType, false);
  assert.equal("openedPerPageType" in stateCoverage(state("process-zoek", { kind: "process" }) as never, run), false);
  assert.equal((consistency(withStates(runOf([page("P1")]), [state("component-oud")]), "3.2.3") as Opened).opened.examined, false);
});

test("1.4.12: a button that only exists with the wider spacing is in the dossier with what it showed", () => {
  const controls = {
    appeared: [{ control: 'button "..." [header]', where: "#meer", opened: { controls: ['a "Feedback" [header]'], text: ["Feedback"], clipped: [], screenshot: "probes/textspacing-opened-1.png" } }],
    disappeared: [{ control: 'a "Feedback" [header]', foundBehind: 'button "..." [header]' }, { control: 'a "GitHub" [header]', foundBehind: null }],
  };
  const first = page("P1", { textspacing: { ...spacing, controls }, smallest: { viewport: { width: 320, height: 640 }, targets: [], links: [], controls: [], textspacing: { ...spacing, controls: { appeared: [], disappeared: [] } } } });
  const second = page("P2", { textspacing: { ...spacing, controls }, smallest: { viewport: { width: 320, height: 640 }, targets: [], links: [], controls: [], textspacing: { ...spacing, controls: { appeared: [], disappeared: [] } } } });
  const run = runOf([first, second]);
  const found = (textSpacing(run, "1.4.12") as { controlsOnlyWithSpacing: { examined: boolean; windows: { window: string; pagesExamined: number; appeared: { control: string; pages: string; opened: { controls: string[]; screenshot: string } }[]; disappeared: { control: string; foundBehind: string | null }[]; disappearedAndNotFound: number }[] } }).controlsOnlyWithSpacing;
  assert.equal(found.examined, true);
  const [wide, narrow] = found.windows;
  assert.deepEqual([wide!.window, wide!.pagesExamined, wide!.appeared.length, wide!.disappearedAndNotFound], ["1280 breed", 2, 1, 1]);
  assert.deepEqual(wide!.appeared[0]!.opened.controls, ['a "Feedback" [header]']);
  assert.equal(wide!.appeared[0]!.opened.screenshot, "pages/P1/probes/textspacing-opened-1.png");
  assert.deepEqual(wide!.disappeared.map((row) => [row.control, row.foundBehind]), [['a "Feedback" [header]', 'button "..." [header]'], ['a "GitHub" [header]', null]]);
  assert.deepEqual([narrow!.window, narrow!.appeared.length], ["320 breed", 0]);
  assert.equal(pageCoverage(first, run).controlsWithTextSpacing, true);
  assert.equal((textSpacing(runOf([page("P1")]), "1.4.12") as { controlsOnlyWithSpacing: { examined: boolean } }).controlsOnlyWithSpacing.examined, false);
});

test("1.4.13, 1.4.3 and 2.5.2: the dossier says how many kinds there are, that each was examined, and where", () => {
  const hoverCoverage = { limit: 400, perKind: 2, found: 387, kinds: 41, examined: 63, notExamined: 0, sameKindNotExamined: 324, notExaminedExamples: [], narrowPages: ["P1"], iconOnly: [{ page: "P1", control: 'button "" [search]', iconOnly: true, title: null, describedBy: null, contentAppeared: [] }, { page: "P1", control: 'button "" [header]', iconOnly: true, title: null, describedBy: "tip", contentAppeared: ["hover", "focus"] }], states: [{ state: "component-zoek", viewport: "1280x800", examined: true, reasonNl: null, controls: 4, kinds: 3, pointedAt: 4 }] };
  const downEventCoverage = { limit: 300, kindsFound: 12, examined: 12, goneBeforePress: [], notExamined: 0, notExaminedExamples: [], pagesWithOwnListener: ["P1"], pagesWithOnlyDelegatedListener: [], pagesWithoutListener: 0, narrowPages: ["P1"], states: [{ state: "component-zoek", viewport: "1280x800", examined: true, reasonNl: null, kindsFound: 2, pressed: 2 }] };
  const measured = { page: "component-zoek", state: "component-zoek", control: 'button "Wis" [search]', where: "#wis", trigger: "hover", texts: [{ text: "Wis", foreground: "#111111", background: "#ffffff", ratio: 18.8, required: 4.5, outcome: "passed", reason: null }] };
  const states = { examined: { hoverTargets: 63, downEventTargets: 12, triggers: 0, forms: 0 }, hover: [{ page: "component-zoek", state: "component-zoek", control: 'button "" [search]', newContent: "Wis het zoekveld", trigger: "hover", dismissedByEscape: true, staysWhenPointerMovesOntoIt: null, screenshot: "states/x.png" }], hoverCoverage, hoverContrast: [measured], downEventCoverage, downEvents: [], dialogs: [], formErrors: [], singleKeys: { pagesExamined: 1, keysPressed: [], reactions: [] } };
  const run = { ...runOf([page("P1")]), states, contrast: [] } as unknown as RunData;
  const pointed = hover(run, "1.4.13") as { controlsFound: number; kinds: number; kindsNotExamined: number; sameKindNotPointedAt: number; iconOnlyAndDescribed: { control: string; contentAppeared: unknown }[]; narrowPages: string[]; states: { state: string }[]; appearances: { state: string }[]; method: string };
  assert.deepEqual([pointed.controlsFound, pointed.kinds, pointed.kindsNotExamined, pointed.sameKindNotPointedAt], [387, 41, 0, 324]);
  assert.match(pointed.method, /dat is geen gat in de meting/);
  assert.deepEqual(pointed.iconOnlyAndDescribed.map((row) => row.contentAppeared), ["niets, bij aanwijzen noch bij focus", ["hover", "focus"]], "a button with only a pictogram that showed nothing is said to have shown nothing");
  assert.deepEqual([pointed.narrowPages, pointed.states.map((row) => row.state), pointed.appearances[0]!.state], [["P1"], ["component-zoek"], "component-zoek"]);
  const colours = (contrast(run, "1.4.3") as { hoverAndFocus: { kinds: number; kindsNotExamined: number; controlsNotExamined?: number; measuredInNarrowWindow: boolean; measuredInStates: string[] } }).hoverAndFocus;
  assert.deepEqual([colours.kinds, colours.kindsNotExamined, colours.controlsNotExamined, colours.measuredInNarrowWindow, colours.measuredInStates], [41, 0, undefined, true, ["component-zoek"]]);
  const pressed = (pointer(run, "2.5.2") as { downEventProbe: { coverage: typeof downEventCoverage; method: string } }).downEventProbe;
  assert.deepEqual([pressed.coverage.notExamined, pressed.coverage.narrowPages, pressed.coverage.states[0]!.pressed], [0, ["P1"], 2]);
  assert.match(pressed.method, /per element bijgehouden/);
  // A run of an older toolbox keeps its own wording: there the count was of controls, up to a limit.
  const older = hover({ ...run, states: { ...states, hoverCoverage: { limit: 150, found: 387, examined: 150, notExamined: 237, notExaminedExamples: [] } } } as unknown as RunData, "1.4.13") as { targetsNotExamined: number; kinds?: number };
  assert.deepEqual([older.targetsNotExamined, older.kinds], [237, undefined]);
});

const order = (extra: Record<string, unknown> = {}) => ({ note: "", sequence: [{ index: 1, kind: "heading", tag: "h1", text: "Titel", path: ["h1"], region: "main", box }, { index: 2, kind: "control", tag: "a", text: "Terug", path: ["#terug"], region: "main", box }], jumps: [{ from: 1, to: 2, direction: "omhoog" }], cssOrder: [], reversed: [], positioned: [], positiveTabindex: [], ...extra });

test("1.3.2: the order of code and screen per page, wide and at 320, in every state, and text laid out with spaces", () => {
  const spaced = { candidates: [{ kind: "losse letters", tag: "p", region: "main", path: ["#welkom"], inCode: false, lines: ["W e l k o m"] }] };
  const first = page("P1", { order: order(), order320: order({ jumps: [], reversed: [{ tag: "div", text: "Kolommen", path: ["#rij"], region: "main", box, flexDirection: "row-reverse", flexWrap: "nowrap" }] }), spacedText: spaced });
  const second = page("P2", { order: order(), order320: order({ jumps: [] }), spacedText: { candidates: [] } });
  const run = withStates(runOf([first, second]), [state("component-menu")], { "component-menu": { order: order({ jumps: [] }) } });
  type Table = { examined: boolean; measured: number; perPlace: { on: string; jumps: number }[]; jumps: { direction: string; from: string; to: string; on: string }[]; reversed: { flexDirection: string; on: string }[] };
  const found = readingOrder(run, "1.3.2") as { wide: Table; at320: Table; states: Table; spacedText: { examined: boolean; pagesSearched: number; candidates: { kind: string; lines: string[]; pages: string }[] } };
  assert.deepEqual([found.wide.examined, found.wide.measured], [true, 2]);
  assert.deepEqual(found.wide.jumps.map((row) => [row.direction, row.from, row.to, row.on]), [["omhoog", 'heading h1 "Titel"', 'control a "Terug"', "P1,P2"]], "the same jump on two pages is one row");
  assert.deepEqual(found.at320.reversed.map((row) => [row.flexDirection, row.on]), [["row-reverse", "P1"]]);
  assert.deepEqual([found.states.examined, found.states.perPlace[0]!.on], [true, "component-menu"]);
  assert.deepEqual(found.spacedText.candidates.map((row) => [row.kind, row.lines, row.pages]), [["losse letters", ["W e l k o m"], "P1"]]);
  const coverage = pageCoverage(first, run);
  assert.deepEqual([coverage.orderComparedWide, coverage.orderCompared320, coverage.spacedTextSearched], [true, true, true]);
  const older = readingOrder(runOf([page("P1")]), "1.3.2") as { wide: { examined: boolean }; spacedText: { examined: boolean } };
  assert.deepEqual([older.wide.examined, older.spacedText.examined], [false, false]);
  assert.equal(pageCoverage(page("P1"), runOf([page("P1")])).orderComparedWide, false);
});

const image = (tag: string, path: string, alt: string | null, extra: Record<string, unknown> = {}) => ({ ...element(tag, path, alt ?? ""), alt, src: `/${path.slice(1)}.png`, svgTitle: null, inInteractive: null, interactiveText: "", context: "Titel", ax: { role: "image", name: alt ?? "", description: null, ignored: false, properties: {} }, ...extra });
const facts = (extra: Record<string, unknown> = {}) => ({ headings: [], landmarks: [], links: [], controls: [], images: [], backgroundImages: [], langParts: [], iframes: [], listeners: {}, timers: { intervals: [], longTimeouts: [] }, counts: { elements: 1 }, lang: "nl", mainText: "Welkom op de site.", ...extra });

test("1.1.1 and 1.4.5: the images of every opened state, and the text recognised in each picture, read once", () => {
  const logo = image("img", "#logo", "Gemeente");
  const read = { hasText: true, text: "Gemeente Berkenveen", words: 2, confidence: 91 };
  const picture = (sha: string, ocr: unknown, extra: Record<string, unknown> = {}) => ({ kind: "img", tag: "img", where: "#logo", region: "header", src: "/logo.png", alt: "Gemeente", ownText: "", box: { x: 0, y: 0, width: 120, height: 40 }, sha256: sha, crop: `probes/pictures/${sha}.png`, ocr, ...extra });
  const first = page("P1", { facts: facts({ images: [logo] }), pictures: { pictures: [picture("aaa", read), picture("", { notReadNl: "kleiner dan 16 pixels" }, { sha256: null, crop: null, box: { x: 0, y: 0, width: 10, height: 10 } })], recognised: 1 } });
  const second = page("P2", { facts: facts({ images: [logo] }), pictures: { pictures: [picture("aaa", read)], recognised: 0 } });
  const banner = image("img", "#banner", "Welkom in het menu");
  const run = withStates(runOf([first, second]), [state("component-menu")], { "component-menu": { images: [logo, banner], backgroundImages: [], pictures: { pictures: [picture("bbb", { hasText: false, text: "", words: 0, confidence: null }, { where: "#banner" })], recognised: 1 } } });
  const found = images(run, "1.4.5") as { rows: unknown[]; inStates: { examined: boolean; imagesOnlyInStates: { alt: string; states: string[] }[] }; textInPictures: { examined: boolean; picturesRead: number; picturesWithText: number; withText: { recognisedText: string; seenOn: string; crop: string }[]; withoutText: { seenOn: string }[]; notRead: unknown[] } };
  assert.equal(found.rows.length, 1);
  assert.deepEqual(found.inStates.imagesOnlyInStates.map((row) => [row.alt, row.states]), [["Welkom in het menu", ["component-menu"]]], "the logo is on the pages already; the image in the menu is new");
  const text = found.textInPictures;
  assert.deepEqual([text.examined, text.picturesRead, text.picturesWithText], [true, 2, 1]);
  assert.deepEqual([text.withText[0]!.recognisedText, text.withText[0]!.seenOn, text.withText[0]!.crop], ["Gemeente Berkenveen", "P1,P2", "pages/P1/probes/pictures/aaa.png"], "the same picture on two pages is read and shown once");
  assert.equal(text.withoutText[0]!.seenOn, "component-menu");
  assert.deepEqual(text.notRead, [], "a picture too small for text is not counted as not read");
  assert.equal(pageCoverage(first, run).imageTextRecognised, true);
  const missingTool = page("P3", { facts: facts(), pictures: { pictures: [], recognised: 0, unavailableNl: "tekstherkenning is op deze machine niet beschikbaar" } });
  assert.equal(pageCoverage(missingTool, runOf([missingTool])).imageTextRecognised, false, "without the tool the gate asks for it again");
  assert.equal(stateCoverage(state("component-menu", { files: { pictures: "p.json" } }) as never, run).imageTextRecognised, true);
});

test("1.1.1 and 1.3.1: a control that only shows between the measured widths is in the dossier with what it opened", () => {
  const widths = {
    widthsTried: [1280, 1001, 999, 360, 320],
    breakpoints: [1000],
    controls: [{ control: 'button "" [header]', where: "#meer", shownAt: [601, 999], role: "button", name: "Meer opties", iconOnly: true, screenshot: "probes/between-control-1.png" }],
    measuredAt: [{ width: 999, screenshot: "probes/between-999.png", opened: [{ control: 'button "" [header]', where: "#meer", controls: ['a "Over ons" [header]'], text: ["Over ons"], tree: '- list:\n  - listitem:\n    - link "Over ons"', screenshot: "probes/between-999-opened-1-1.png" }] }],
  };
  const first = page("P1", { facts: facts(), widths });
  const second = page("P2", { facts: facts(), widths });
  const run = runOf([first, second]);
  const between = (controls(run, "1.3.1") as { onlyBetweenMeasuredWidths: { examined: boolean; controls: { accessibleName: string; onlyPictogram: boolean; measuredAtWidth: number; pageScreenshot: string; opened: { controls: string[]; addedToAccessibilityTree: string }; pages: string }[] } }).onlyBetweenMeasuredWidths;
  assert.equal(between.examined, true);
  const row = between.controls[0]!;
  assert.deepEqual([row.accessibleName, row.onlyPictogram, row.measuredAtWidth, row.pages], ["Meer opties", true, 999, "P1,P2"]);
  assert.equal(row.pageScreenshot, "pages/P1/probes/between-999.png");
  assert.deepEqual(row.opened.controls, ['a "Over ons" [header]']);
  assert.match(row.opened.addedToAccessibilityTree, /listitem/);
  assert.equal(pageCoverage(first, run).controlsBetweenWidthsSearched, true);
  assert.equal((controls(runOf([page("P1", { facts: facts() })]), "1.3.1") as { onlyBetweenMeasuredWidths: { examined: boolean } }).onlyBetweenMeasuredWidths.examined, false);
});

test("3.1.2: the language of text alternatives and names, and the text of every opened state", () => {
  const piece = (kind: string, text: string, verdict: string, declared = "nl") => ({ kind, text, words: text.split(" ").length, declared, tag: "img", region: "main", path: ["#x"], verdict, detected: { eld: verdict === "mismatch" ? "en" : null, cld3: verdict === "mismatch" ? "en" : null } });
  const languages = { minWords: 5, textAlternatives: [piece("aria-label", "Zoeken", "cantTell"), piece("alt", "The town hall seen from the square at night", "mismatch")] };
  const first = page("P1", { facts: facts(), languages });
  const run = withStates(runOf([first]), [state("component-menu", { files: { text: "site-states/component-menu/text.txt", languages: "l.json" } })], {
    "component-menu": { languages: { minWords: 5, textAlternatives: [piece("aria-label", "Zoeken", "cantTell")], textBlocks: [piece("tekst", "Welkom op de site.", "match"), piece("tekst", "Read this page in English please", "mismatch")] } },
  });
  const found = language(run, "3.1.2") as { textAlternativesAndNames: { examined: boolean; piecesExamined: number; totals: Record<string, number>; rows: { text: string; verdict: string; pages: string }[] }; states: { examined: boolean; rows: { state: string; textFile: string; newPieces: number; pieces: { text: string; verdict: string }[] }[] } };
  assert.deepEqual([found.textAlternativesAndNames.examined, found.textAlternativesAndNames.piecesExamined, found.textAlternativesAndNames.totals.mismatch], [true, 2, 1]);
  assert.equal(found.textAlternativesAndNames.rows[0]!.verdict, "mismatch", "what points at another language comes first");
  const menu = found.states.rows[0]!;
  assert.deepEqual([menu.state, menu.textFile, menu.newPieces], ["component-menu", "site-states/component-menu/text.txt", 1], "what the pages already have is read there");
  assert.deepEqual(menu.pieces.map((row) => [row.text, row.verdict]), [["Read this page in English please", "mismatch"]]);
  assert.equal(pageCoverage(first, run).textAlternativesLanguage, true);
  assert.equal(stateCoverage(state("component-menu", { files: { text: "t.txt", languages: "l.json" } }) as never, run).textAndLanguage, true);
  assert.equal((language(runOf([page("P1", { facts: facts() })]), "3.1.2") as { textAlternativesAndNames: { examined: boolean } }).textAlternativesAndNames.examined, false);
});

test("2.4.11: focus in every opened state, forward, back and with the arrow keys, with what lay over each stop", () => {
  const stop = (text: string, coveredBy: string | null) => ({ index: 0, tag: "a", text, where: `#${text}`, region: "nav", roleAttr: null, inViewport: true, coveredBy, ...(coveredBy ? { screenshot: `site-states/component-zijmenu/focus-covered/terug-001.png` } : {}) });
  const forward = { outcome: "completed", stopCount: 2, stops: [element("a", "#een", "Een", { coveredBy: null }), element("a", "#twee", "Twee", { coveredBy: null })] };
  const run = withStates(runOf([page("P1")]), [state("component-zijmenu", { files: { focusCovered: "k.json" } }), state("component-oud")], {
    "component-zijmenu": { tabwalk: forward, focusCovered: { walks: [{ key: "Shift+Tab", from: "#twee", outcome: "completed", stops: [stop("Een", "html > body > header")] }, { key: "ArrowDown", from: "#twee", outcome: "stuck", stops: [stop("Drie", null)] }], stateStillReachedAfterwards: true } },
  });
  const states = (keyboard(run, "2.4.11") as { states: { examined: boolean; statesExamined: number; statesNotWalkedBackward: { state: string }[]; rows: { state: string; forward: { stops: number }; backAndArrows: { key: string; stops: number }[]; stopsWithSomethingOverTheMiddle: { key: string; coveredBy: string; screenshot: string }[] }[] } }).states;
  assert.deepEqual([states.examined, states.statesExamined, states.statesNotWalkedBackward.map((row) => row.state)], [true, 1, ["component-oud"]]);
  const side = states.rows[0]!;
  assert.deepEqual(side.backAndArrows.map((walk) => [walk.key, walk.stops]), [["Shift+Tab", 1], ["ArrowDown", 1]]);
  assert.deepEqual(side.stopsWithSomethingOverTheMiddle.map((row) => [row.key, row.coveredBy]), [["Shift+Tab", "html > body > header"]]);
  assert.equal(stateCoverage(state("component-zijmenu", { files: { focusCovered: "k.json" } }) as never, run).focusCoveredBackwardAndArrows, true);
  assert.equal(stateCoverage(state("component-oud") as never, run).focusCoveredBackwardAndArrows, false);
});

test("1.4.3: every link and button under the pointer and with focus, in both schemes, from the contrast sweep", () => {
  const row = (trigger: string, foreground: string, outcome: string, ratio: number) => ({ control: 'a "Eerste onderwerp" [main]', where: "#een", trigger, texts: [{ text: "Eerste onderwerp", foreground, background: "#121212", ratio, required: 4.5, outcome, reason: null }] });
  const report = (rows: unknown[]) => ({ controls: 3, measured: 3, withoutText: 1, fromPicture: 0, rows });
  const swept = [
    { url: "https://site.nl/P1", slug: "P1", scheme: "light", measurements: [], controls: [], graphics: [], hoverFocus: report([row("hover", "#00264d", "passed", 14.2)]) },
    { url: "https://site.nl/P1", slug: "P1", scheme: "dark", measurements: [], controls: [], graphics: [], hoverFocus: report([row("hover", "#2a2a2a", "failed", 1.3), row("focus", "#8ab4f8", "passed", 8.9)]) },
    { url: "https://site.nl/P1", slug: "P1", scheme: "light", width: 320, measurements: [], controls: [], graphics: [] },
  ];
  const run = { ...runOf([page("P1")]), contrast: swept } as unknown as RunData;
  const found = (contrast(run, "1.4.3") as { hoverAndFocus: { examined: boolean; schemes: string[]; linksAndButtons: Record<string, { linksAndButtonsMeasured: number; withoutTextOfTheirOwn: number }>; failed: { scheme: string; trigger: string; foreground: string }[]; method: string } }).hoverAndFocus;
  assert.deepEqual([found.examined, found.schemes], [true, ["light", "dark"]]);
  assert.deepEqual([found.linksAndButtons.dark!.linksAndButtonsMeasured, found.linksAndButtons.dark!.withoutTextOfTheirOwn], [3, 1]);
  assert.deepEqual(found.failed.map((entry) => [entry.scheme, entry.trigger, entry.foreground]), [["dark", "hover", "#2a2a2a"]]);
  assert.match(found.method, /lichte en in het donkere kleurenschema/);
  const coverage = pageCoverage(page("P1"), run);
  assert.deepEqual([coverage.contrastHoverFocusLight, coverage.contrastHoverFocusDark], [true, true]);
});

test("1.4.5 and 1.3.2: with a site model there is a full screenshot of one page of every page type, without a limit", () => {
  const pages = Array.from({ length: 14 }, (_, index) => page(`P${index + 1}`));
  const pageTypes = pages.map((entry, index) => ({ id: `type-${index + 1}`, descriptionNl: "", representative: entry.item.url, pages: [entry.item.url] }));
  const run = withStates(runOf(pages), []);
  (run.siteModel as unknown as { pageTypes: unknown[] }).pageTypes = pageTypes;
  const shots = screenshots(run, "1.4.5") as { pages: { page: string; pageType: string; light: string; narrow: string }[] };
  assert.equal(shots.pages.length, 14, "more than twelve page types: each has its screenshot");
  assert.deepEqual([shots.pages[13]!.page, shots.pages[13]!.pageType, shots.pages[13]!.narrow], ["P14", "type-14", "pages/P14/screenshot-narrow.png"]);
  assert.equal((screenshots(runOf(pages), "1.4.5") as { pages: unknown[] }).pages.length, 12, "without a model: one per template, up to twelve");
});
