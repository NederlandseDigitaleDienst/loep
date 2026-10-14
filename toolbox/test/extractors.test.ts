import assert from "node:assert/strict";
import { test } from "node:test";
import { ariaLabelReplacesText, contrast, controls, frameNotLoaded, headingsAsBypass, HIDDEN_INPUT, keyboard, knownPlayer, labelInName, links, pointer, scrollContainer, singleKeys, textSpacing } from "../src/lib/extractors.ts";
import type { PageData, RunData } from "../src/lib/rundata.ts";

const box = { x: 0, y: 0, width: 100, height: 20 };
const element = (tag: string, path: string, extra: Record<string, unknown> = {}) => ({ tag, path: [path], box, visible: true, text: "", region: "main", roleAttr: null, ariaLabel: null, ariaHidden: false, lang: null, ax: { role: tag, name: "", description: null, ignored: false, properties: {} }, ...extra });
const probe = { horizontalScroll: false, scrollWidth: 320, viewportWidth: 320, offenders: [], clipped: [], visibleControls: [] };

/** A page with just enough of a run around it for the extractors under test. */
function page(label: string, url: string, facts: Record<string, unknown>, extra: Record<string, unknown> = {}): PageData {
  return {
    label,
    item: { url, kind: "structured", status: 200, slug: label, templateHash: label, reason: "" },
    dir: `pages/${label}`,
    facts: { headings: [], landmarks: [], links: [], controls: [], iframes: [], ...facts },
    tabwalk: { outcome: "completed", stopCount: 0, stops: [] },
    reflow: probe,
    zoom200: probe,
    portrait: probe,
    ...extra,
  } as unknown as PageData;
}
const runOf = (...pages: PageData[]): RunData => ({ pages, states: null, contrast: null, dir: "", inventory: { totals: {} }, sample: { items: [] } }) as unknown as RunData;

test("an aria-label that says something else than the visible text is recognised", () => {
  assert.equal(ariaLabelReplacesText("Aan de slag", "Aan de slag", "Minder kopen"), true);
  assert.equal(ariaLabelReplacesText("Verhaal", "Verhaal", "Verhalen"), true);
  assert.equal(ariaLabelReplacesText("Lees meer over repareren", "Lees meer over repareren", "Lees meer"), false, "the visible text is part of the name");
  assert.equal(ariaLabelReplacesText("Agenda", "Agenda", "13 november Agenda Afvalvrijdag"), false, "the name is part of the visible text");
  assert.equal(ariaLabelReplacesText("Download de app", "Download de app", ""), false, "nothing visible to replace");
  assert.equal(ariaLabelReplacesText("Minder kopen", null, "Minder kopen"), false);
});

test("a link stretched over a card is flagged when its label replaces the card's text", () => {
  const link = (extra: Record<string, unknown>) => element("a", "a", { href: "https://example.nl/minder-kopen/", target: null, context: "Minder kopen", contextFrom: "block", sentence: null, sentenceFrom: null, parentTag: "div", ...extra });
  const cover = link({ ariaLabel: "Aan de slag", coveredText: "MINDER KOPEN", ax: { role: "link", name: "Aan de slag", description: null, ignored: false, properties: {} } });
  const result = links(runOf(page("P1", "https://example.nl/", { links: [cover] })), "2.4.4") as { sentenceIsSentence: boolean; flagged: { flags: string[]; sentence: string | null; parent: string; contextFrom: string; visibleText: string }[] };
  assert.equal(result.sentenceIsSentence, true);
  assert.deepEqual(result.flagged[0]!.flags, ["aria-label vervangt de zichtbare tekst door iets anders"]);
  assert.equal(result.flagged[0]!.sentence, null);
  assert.equal(result.flagged[0]!.parent, "div");
  assert.match(result.flagged[0]!.contextFrom, /vóór die kop/);
  // A run from before the restriction says that its sentence is not a sentence.
  const old = links(runOf(page("P1", "https://example.nl/", { links: [link({ sentenceFrom: undefined, sentence: "hele kaart" })] })), "2.4.4") as { sentenceIsSentence: boolean };
  assert.equal(old.sentenceIsSentence, false);
});

test("known embedded players are read from the address of the frame", () => {
  assert.equal(knownPlayer("https://player.vimeo.com/video/1117468100?autoplay=0")?.singleKeyShortcuts, "aan");
  assert.equal(knownPlayer("https://player.vimeo.com/video/1?keyboard=0")?.singleKeyShortcuts, "uitgezet");
  assert.equal(knownPlayer("https://player.vimeo.com/video/1?keyboard=false")?.singleKeyShortcuts, "uitgezet");
  assert.equal(knownPlayer("https://www.youtube-nocookie.com/embed/abc")?.singleKeyShortcuts, "aan");
  assert.equal(knownPlayer("https://www.youtube.com/embed/abc?disablekb=1")?.singleKeyShortcuts, "uitgezet");
  assert.equal(knownPlayer("https://example.nl/kaart"), null);
  assert.equal(knownPlayer("about:blank"), null);
  assert.equal(knownPlayer(null), null);
});

test("a scrolling container makes content reachable, a clipping one does not", () => {
  const container = { tag: "div", path: ["#tiles"], overflowX: "auto", scrollWidth: 1360, clientWidth: 320 };
  assert.match(String(scrollContainer(container).reachableByScrolling), /^ja/);
  assert.match(String(scrollContainer({ ...container, overflowX: "hidden" }).reachableByScrolling), /^nee/);
  assert.match(String(scrollContainer(null).reachableByScrolling), /pagina zelf/);
  assert.deepEqual(scrollContainer(undefined), {}, "an older run says nothing");
});

test("a third-party frame that failed to load is marked as not examined", () => {
  const own = page("P1", "https://example.nl/", {});
  const frame = page("P2", "https://player.vimeo.com/video/1", {});
  frame.item = { ...frame.item, kind: "embedded", status: 401 };
  const loaded = page("P3", "https://player.vimeo.com/video/2", {});
  loaded.item = { ...loaded.item, kind: "embedded", status: 200 };
  const run = runOf(own, frame, loaded);
  assert.match(frameNotLoaded(frame, run)!, /andere aanbieder \(player\.vimeo\.com\).*foutstatus 401/);
  assert.equal(frameNotLoaded(loaded, run), null);
  assert.equal(frameNotLoaded(own, run), null);
});

test("headings only bypass blocks when main excludes them and no menu headings precede the h1", () => {
  const heading = (level: number, text: string) => element(`h${level}`, `h${level}-${text}`, { level, text });
  const main = element("main", "main", { box: { x: 0, y: 0, width: 1280, height: 5000 }, ax: { role: "main", name: "", description: null, ignored: false, properties: {} } });
  const nav = (y: number) => element("nav", "nav", { box: { x: 0, y, width: 1280, height: 40 }, ax: { role: "navigation", name: "Menu", description: null, ignored: false, properties: {} } });
  const wrapped = page("P1", "https://example.nl/", { landmarks: [main, nav(10)], headings: [heading(4, "Aan de slag"), heading(1, "Home")] });
  const other = page("P2", "https://example.nl/over", { landmarks: [main, nav(10)], headings: [heading(4, "Aan de slag"), heading(1, "Over")] });
  const result = headingsAsBypass(wrapped, runOf(wrapped, other));
  assert.equal(result.mainContainsRepeatedBlocks, true);
  assert.equal(result.headingsBeforeFirstH1, 1);
  assert.equal(result.repeatedHeadingsBeforeFirstH1, 1);
  // Navigation above main, and the h1 as the first heading.
  const clean = page("P3", "https://example.nl/", { landmarks: [{ ...main, box: { x: 0, y: 100, width: 1280, height: 4000 } }, nav(10)], headings: [heading(1, "Home")] });
  const cleanResult = headingsAsBypass(clean, runOf(clean, other));
  assert.equal(cleanResult.mainContainsRepeatedBlocks, false);
  assert.equal(cleanResult.headingsBeforeFirstH1, 0);
  // The position in the code, when recorded, goes before the position on screen.
  const recorded = page("P4", "https://example.nl/", { landmarks: [{ ...main, box: { x: 0, y: 100, width: 1280, height: 4000 } }, { ...nav(10), inMain: true }], headings: [] });
  assert.equal(headingsAsBypass(recorded, runOf(recorded)).mainContainsRepeatedBlocks, true);
});

test("a hidden input with a visible label is flagged, with the contrast of the drawn box", () => {
  const input = (extra: Record<string, unknown>) => element("input", "#choice", { type: "checkbox", autocomplete: null, required: false, placeholder: null, disabled: false, labelText: "Communicatie", inForm: true, tabindex: null, visible: false, ax: { role: "none", name: null, description: null, ignored: true, properties: {} }, ...extra });
  const drawnBox = [{ pseudo: "::after", width: "24px", height: "24px", borderStyle: "solid", borderWidth: "2px", borderColour: [132, 188, 92, 1], background: [0, 0, 0, 0] }];
  const rebuilt = input({ hiddenBy: "display: none", labelVisible: true, drawnBox, labelBackground: [255, 255, 255, 1] });
  // A honeypot: hidden as well, but with nothing on screen for it.
  const honeypot = input({ path: ["#trap"], hiddenBy: "display: none", labelVisible: false });
  const result = controls(runOf(page("P1", "https://example.nl/", { controls: [rebuilt, honeypot], clickables: [] })), "4.1.2") as { controlsExamined: number; hiddenInputsExamined: boolean; flagged: { flags: string[]; hiddenInput: { drawnBox: { borderRatio: number; fill: string }[] } }[] };
  assert.equal(result.controlsExamined, 1);
  assert.equal(result.hiddenInputsExamined, true);
  assert.ok(result.flagged[0]!.flags.includes(HIDDEN_INPUT));
  assert.equal(result.flagged[0]!.hiddenInput.drawnBox[0]!.borderRatio, 2.2);
  assert.equal(result.flagged[0]!.hiddenInput.drawnBox[0]!.fill, "doorzichtig");
});

test("clickable elements that are not controls are listed per window size, and missing data is said to be missing", () => {
  const clickable = (path: string, text: string, html: string) => element("div", path, { text, html, signals: ["click-listener", "data-toggle"], tabindex: null, focusable: false, ax: { role: "generic", name: "", description: null, ignored: false, properties: {} } });
  const search = clickable("#search", "", '<div class="search-icon" data-toggle="modal"></div>');
  const menu = clickable("#menu", "Menu", '<div class="hamburger-menu"></div>');
  const collected = page("P1", "https://example.nl/", { clickables: [search] }, { reflow: { ...probe, clickables: [search, menu] } });
  const result = (controls(runOf(collected), "2.1.1") as { clickableNotFocusable: { examined: boolean; rows: { html: string; seenAt: string[]; tabStop: boolean; clickableBecause: string[]; role: string }[] } }).clickableNotFocusable;
  assert.equal(result.examined, true);
  const row = (name: string) => result.rows.find((entry) => entry.html.includes(name))!;
  assert.equal(result.rows.length, 2);
  assert.deepEqual(row("hamburger").seenAt, ["320x256"], "the menu button only exists on a narrow screen");
  assert.deepEqual(row("search").seenAt, ["1280x800", "320x256"]);
  assert.deepEqual(row("search").clickableBecause, ["klik-listener", "attribuut data-toggle"]);
  assert.equal(row("search").tabStop, false);
  const old = (controls(runOf(page("P1", "https://example.nl/", {})), "2.1.1") as { clickableNotFocusable: { examined: boolean; rows: unknown[] }; hiddenInputsExamined: boolean }).clickableNotFocusable;
  assert.equal(old.examined, false);
  assert.deepEqual(old.rows, []);
});

test("no visible focus change is only reported for an element that was painted in the clip", () => {
  const stop = (path: string, extra: Record<string, unknown>) => element("a", path, { index: 0, inViewport: true, focusPixelShare: 0, coveredBy: null, outline: "auto 5px", href: "/", text: path, ...extra });
  const walked = page("P1", "https://example.nl/", {}, { scrollRegions: [], tabwalk: { outcome: "completed", stopCount: 3, stops: [stop("plain", { clipVerified: true }), stop("hidden-logo", { visible: false }), stop("moved", { clipVerified: false, focusPixelShare: null, focusNotMeasured: "verschoven" })] } });
  const result = keyboard(runOf(walked), "2.4.7") as { noVisibleFocusChange: { where: string }[]; focusOnElementThatIsNotVisible: { where: string }[]; focusNotMeasured: { where: string; reason: string }[] };
  assert.deepEqual(result.noVisibleFocusChange.map((row) => row.where), ["plain"]);
  assert.deepEqual(result.focusOnElementThatIsNotVisible.map((row) => row.where), ["hidden-logo"]);
  assert.deepEqual(result.focusNotMeasured.map((row) => [row.where, row.reason]), [["moved", "verschoven"]]);
});

const capturedState = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "component", modelId: id, pageTypes: ["start"], url: "https://site.nl/", viewport: { width: 1280, height: 800 }, reached: true, reasonNl: null, stillReachedAfterMeasuring: true, dir: `site-states/${id}`, files: { textSpacingScreenshot: `site-states/${id}/textspacing.png` }, engineSummary: null, contrast: { measured: 1, failed: 0, cantTell: 0 }, largestOverlayShare: 0, ...extra });
const withStates = (run: RunData, states: unknown[], stateEvidence: Record<string, unknown>): RunData => ({ ...run, siteModel: { blockers: [], pageTypes: [], components: [], processes: [], frames: [], notesNl: [] }, siteStates: { siteSha256: "", seeded: { blockers: [], cookies: 0, storedValues: 0 }, dismissals: [], states }, stateEvidence }) as unknown as RunData;

test("visible text and name are set side by side for every link and control, per window and per state", () => {
  const named = (tag: string, path: string, text: string, name: string, extra: Record<string, unknown> = {}) => element(tag, path, { text, ax: { role: tag === "a" ? "link" : "button", name, ignored: false, properties: {} }, ...extra });
  const wide = [named("a", "#home", "Home", "Home"), named("a", "#more", "Lees meer", "Lees meer over afval"), named("a", "#x", "Contact", "Stuur een bericht")];
  const first = page("P1", "https://site.nl/", { links: wide, controls: [named("button", "#zoek", "", "Zoeken"), element("input", "#q", { type: "text", text: "getypt", labelText: "Zoekterm", ax: { role: "textbox", name: "Zoekterm", ignored: false, properties: {} } })] }, { smallest: { viewport: { width: 320, height: 640 }, targets: [], links: [named("a", "#home", "Home", "Home")], controls: [named("button", "#menuknop", "Menu", "Open navigatie")], textspacing: {} } });
  const run = withStates(runOf(first), [capturedState("component-menu")], { "component-menu": { links: [named("a", "#sub", "Afval", "Afval"), named("a", "#verborgen", "Achter het venster", "Achter het venster", { ax: { role: "link", name: "x", ignored: true, properties: {} } })], controls: [named("button", "#sluit", "Sluiten", "Menu sluiten")] } });
  const found = labelInName(run, "2.5.3") as { examined: { standardWindow: { elements: number }; width320: { elements: number }; states: { state: string; elements: number }[] }; totals: Record<string, number>; notContained: { visibleText: string; accessibleName: string; views: string[] }[]; noVisibleText: { accessibleName: string }[]; contained: { visibleText: string; views: string[] }[]; equal: string[] };
  assert.deepEqual([found.examined.standardWindow.elements, found.examined.width320.elements, found.examined.states], [5, 2, [{ state: "component-menu", capturedOn: "P1", elements: 2 }]], "what is hidden from assistive technology behind a dialog is not counted");
  assert.deepEqual(found.notContained.map((row) => [row.visibleText, row.accessibleName, row.views]), [["Menu", "Open navigatie", ["320 breed"]], ["Contact", "Stuur een bericht", ["standaard"]]], "the menu button that only exists at 320 wide is compared there");
  assert.deepEqual(found.contained.map((row) => [row.visibleText, row.views]), [["Lees meer", ["standaard"]], ["Sluiten", ["component-menu"]]]);
  assert.deepEqual(found.noVisibleText.map((row) => row.accessibleName), ["Zoeken"]);
  assert.deepEqual(found.equal, ["Afval [link, alleen component-menu]", "Home [link]", "Zoekterm [control]"], "a field is compared by its label, not by what was typed in it");
});

test("contrast rows say in which window they were seen, and the text under the pointer and in each state is there", () => {
  const measured = (foreground: string, ratio: number, outcome: string) => ({ text: "Tekst", tag: "p", region: "main", where: `#t${foreground}`, box, fontSizePx: 16, bold: false, foreground, background: "#ffffff", ratio, required: 4.5, outcome, reason: null });
  const first = page("P1", "https://site.nl/", {});
  const entry = (scheme: string, width: number | undefined, measurements: unknown[]) => ({ url: first.item.url, slug: first.item.slug, scheme, ...(width ? { width } : {}), measurements, controls: [], graphics: [] });
  const run = withStates({ ...runOf(first), contrast: [entry("light", undefined, [measured("#111111", 18, "passed")]), entry("dark", undefined, []), entry("light", 320, [measured("#111111", 18, "passed"), measured("#999999", 2.8, "failed")]), entry("dark", 320, [])], states: { examined: {}, hoverCoverage: { limit: 150, found: 3, examined: 2, notExamined: 1, notExaminedExamples: [{ page: "P1", control: 'a "Rest" [main]' }] }, hoverContrast: [{ page: "P1", control: 'a "Meer" [main]', where: "#meer", trigger: "hover", texts: [{ text: "Meer", foreground: "#c8c8c8", background: "#ffffff", ratio: 1.6, required: 4.5, outcome: "failed", reason: null }] }, { page: "P1", control: 'a "Meer" [main]', where: "#meer", trigger: "focus", texts: [{ text: "Meer", foreground: "#111111", background: "#ffffff", ratio: 18, required: 4.5, outcome: "passed", reason: null }] }] } } as unknown as RunData, [capturedState("component-menu", { contrastDark: { measured: 2, failed: 1, cantTell: 0 } }), capturedState("component-zoek", { variantsNotReached: [{ variant: "contrastDark", reasonNl: "stap 1 vond het element niet" }] })], { "component-menu": { contrast: { measurements: [] }, contrastDark: { measurements: [measured("#444444", 2.1, "failed"), { ...measured("#555555", 2, "failed"), behindOverlay: "#laag" }] } } });
  const found = contrast(run, "1.4.3") as { pagesMeasured: Record<string, Record<string, number>>; failed: { foreground: string; windows: string[] }[]; lowestPassing: { windows: string[] }[]; states: { state: string; dark: unknown; failedDark: { foreground: string }[]; darkNotMeasuredNl?: string }[]; hoverAndFocus: { controlsMeasured: number; controlsNotExamined: number; totals: Record<string, number>; failed: { trigger: string; foreground: string; examples: { control: string }[] }[] } };
  assert.deepEqual(found.pagesMeasured, { standardWindow: { light: 1, dark: 1 }, width320: { light: 1, dark: 1 } });
  assert.deepEqual(found.failed.map((row) => [row.foreground, row.windows]), [["#999999", ["320 breed"]]], "a colour that only shows at 320 wide");
  assert.deepEqual(found.lowestPassing[0]!.windows, ["standaard", "320 breed"], "the same colours at both widths are one row");
  assert.deepEqual(found.states.map((row) => [row.state, row.dark, row.failedDark.map((entry) => entry.foreground), row.darkNotMeasuredNl]), [["component-menu", { measured: 2, failed: 1, cantTell: 0 }, ["#444444"], undefined], ["component-zoek", null, [], "stap 1 vond het element niet"]], "text behind a layer is left out, and a state that did not open on dark says why");
  assert.deepEqual([found.hoverAndFocus.controlsMeasured, found.hoverAndFocus.controlsNotExamined, found.hoverAndFocus.totals.failed, found.hoverAndFocus.totals.passed], [1, 1, 1, 1]);
  assert.deepEqual(found.hoverAndFocus.failed.map((row) => [row.trigger, row.foreground, row.examples[0]!.control]), [["hover", "#c8c8c8", 'a "Meer" [main]']]);
  assert.equal((contrast({ ...runOf(first), contrast: [] } as unknown as RunData, "1.4.3") as { hoverAndFocus: { examined: boolean } }).hoverAndFocus.examined, false);
});

test("text spacing is reported at 320 wide and per state, and a state that no longer opens with it is named", () => {
  const cut = element("button", "#knop", { text: "Afspraak maken", textOverflow: "clip" });
  const spacing = { shadowRootsStyled: 0, clippedBefore: 0, newlyClipped: [], horizontalScrollAfter: false, textWithoutSpacingCount: 0 };
  const first = page("P1", "https://site.nl/", {}, { textspacing: spacing, smallest: { viewport: { width: 320, height: 640 }, targets: [], links: [], controls: [], textspacing: { ...spacing, newlyClipped: [cut] } } });
  const run = withStates(runOf(first), [capturedState("component-menu"), capturedState("component-hulp"), capturedState("component-oud")], { "component-menu": { textSpacing: { ...spacing, newlyClipped: [cut], appliedBeforeOpening: true, reachedWithSpacing: true, stateStillReachedAfterwards: true } }, "component-hulp": { textSpacing: { appliedBeforeOpening: true, reachedWithSpacing: false, reasonNl: "na de stappen geldt de postconditie niet" } }, "component-oud": { textSpacing: { ...spacing, stateStillReachedAfterwards: false } } });
  const found = textSpacing(run, "1.4.12") as { newlyClippedText: unknown[]; at320: { examined: boolean; pagesExamined: number; newlyClippedText: { text: string; pages: string }[] }; states: { state: string; appliedBeforeOpening?: boolean; openedWithSpacing?: boolean | null; notOpenedNl?: string; newlyClippedText?: { text: string }[]; screenshot?: string }[] };
  assert.deepEqual(found.newlyClippedText, []);
  assert.deepEqual([found.at320.examined, found.at320.pagesExamined, found.at320.newlyClippedText.map((row) => [row.text, row.pages])], [true, 1, [["Afspraak maken", "P1"]]]);
  assert.deepEqual(found.states.map((row) => [row.state, row.appliedBeforeOpening, row.openedWithSpacing, row.newlyClippedText?.length ?? null]), [["component-menu", true, true, 1], ["component-hulp", true, false, null], ["component-oud", false, null, 0]], "an older run forced the spacing after opening, and says so");
  assert.equal(found.states[1]!.notOpenedNl, "na de stappen geldt de postconditie niet");
  assert.equal(found.states[0]!.screenshot, "site-states/component-menu/textspacing.png");
  assert.equal((textSpacing(runOf(page("P1", "https://site.nl/", {}, { textspacing: spacing })), "1.4.12") as { at320: { examined: boolean } }).at320.examined, false);
});

test("the dossier says what the press probe and the key probe examined and what they left out", () => {
  const first = page("P1", "https://site.nl/", { listeners: {} });
  const coverage = { limit: 300, kindsFound: 3, examined: 2, goneBeforePress: [], notExamined: 1, notExaminedExamples: [{ page: "P1", control: 'button "Rest" [main]' }], pagesWithOwnListener: ["P1"], pagesWithOnlyDelegatedListener: [], pagesWithoutListener: 0 };
  const states = { examined: { downEventTargets: 2 }, downEventCoverage: coverage, downEvents: [{ page: "P1", control: 'input "" [main]', kind: "input[checkbox]", via: "own", listenerOn: "label", changeOnDown: "toestand gewijzigd: #cb1: checked=false -> checked=true", changeAfterReleaseElsewhere: null, undoneByReleasingElsewhere: false, effectOnDown: ["toestand"] }], singleKeys: { pagesExamined: 1, keysPressed: ["a"], reactions: [], states: [{ state: "component-zoek", examined: true, reasonNl: null, focusAfterOpening: "input #q", focusTakenOutOfTextField: true, keysPressed: 42, reactions: [{ key: "k", change: "toestand gewijzigd" }] }] } };
  const run = withStates({ ...runOf(first), states } as unknown as RunData, [capturedState("component-zoek")], {});
  const probe = (pointer(run, "2.5.2") as { downEventProbe: { targetsExamined: number; coverage: typeof coverage; actedOnDown: { effectOnDown: string[] }[] } }).downEventProbe;
  assert.deepEqual([probe.targetsExamined, probe.coverage.kindsFound, probe.coverage.notExamined, probe.coverage.notExaminedExamples.length], [2, 3, 1, 1]);
  assert.deepEqual(probe.actedOnDown[0]!.effectOnDown, ["toestand"]);
  const older = (pointer({ ...run, states: { ...states, downEventCoverage: undefined } } as unknown as RunData, "2.5.2") as { downEventProbe: { coverage: { note: string } } }).downEventProbe;
  assert.match(older.coverage.note, /stopte na 40 soorten/);
  const keys = singleKeys(run, "2.1.4") as { states: { state: string; reactions: { key: string }[] }[] };
  assert.deepEqual(keys.states.map((row) => [row.state, row.reactions.map((reaction) => reaction.key)]), [["component-zoek", ["k"]]]);
  assert.equal((singleKeys({ ...run, states: { ...states, singleKeys: { ...states.singleKeys, states: undefined } } } as unknown as RunData, "2.1.4") as { states: { examined: boolean } }).states.examined, false);
});
