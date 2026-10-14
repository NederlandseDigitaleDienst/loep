import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { INPAGE_PATH } from "../src/browser/session.ts";
import { capsule, ensureHelpers, packageSource } from "../src/instruments/methods/capsule.ts";
import { compareOrders } from "../src/instruments/methods/taborder.ts";
import { parseSnapshotLine } from "../src/instruments/methods/names.ts";
import { binary, INJECTED_FAULTS, KNOWN_ERRORS, METHODS } from "../src/instruments/methods/registry.ts";
import { runRuleEngines } from "../src/instruments/methods/rules.ts";
import { changedBetween, changedPlaces } from "../src/instruments/methods/motion.ts";
import { estimatedFontSize, measureLine } from "../src/instruments/methods/imagetext.ts";
import { isLead, otherFeatures, ratiosOf, sideColours } from "../src/instruments/distinct.ts";
import { enlarge, levelled, lineOf, mergeReadings, overlap, sparsePieces } from "../src/instruments/methods/ocr.ts";
import { contrastRatio, floorRatio, type Rgb } from "../src/lib/contrast.ts";
import { PNG } from "pngjs";
import { Daemon, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { layoutDifferences, layoutLine, stateForSecondBrowser } from "../src/session/opinions.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-opinions-"));
  // The methods of this file all run in Chromium or in this process; the second browsers have a file of their own.
  daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  INJECTED_FAULTS.clear();
  delete process.env.LOEP_JAVA;
  delete process.env.LOEP_TESSERACT;
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

function raw(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Response> {
  return daemon.handle({ op: "command", session: "main", command, args: args.map(String), options });
}

async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await raw(command, args, options);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

interface Method {
  method: string;
  implementation: string;
  version: string;
  principle?: string;
  ms?: number;
  knownUnreliable?: string;
  result: Record<string, unknown>;
}

interface Measured {
  methods: Method[];
  agreement: string;
  differences: string[];
  failed: { implementation: string; kind: string; reason: string }[];
  pending: string[];
}

function observation(id: string): Observation & { result: Measured & Record<string, unknown> } {
  const [session, nr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  return JSON.parse(readFileSync(join(run, "observations", session, `${nr}.json`), "utf8")) as Observation & { result: Measured & Record<string, unknown> };
}

async function ref(query: string): Promise<number> {
  const found = await loep("find", [query]);
  const first = (found.found as string[])[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

const size = (print: Print): number => JSON.stringify(print).length;

test("name sets five computations of the accessible name next to each other", async () => {
  await loep("open", ["/opinions.html"]);
  const image = await loep("name", [await ref("css:#imgbtn")]);
  // An image button without alt: the browser and two libraries say "Submit", two others "Submit Query".
  assert.deepEqual(image.answers, ['button "Submit" <- chromium, axe-name, playwright', 'button "Submit Query" <- alfa-aria, dom-accessibility-api']);
  assert.equal(image.methods, "5 disagree");
  assert.ok(size(image) < 400, `name printed ${size(image)} characters`);
  const record = observation(image.id).result;
  assert.equal(record.agreement, "disagree");
  assert.equal(record.differences.length, 2);
  assert.deepEqual(record.methods.map((method) => method.implementation), ["chromium", "@siteimprove/alfa-aria", "axe-core", "playwright ariaSnapshot", "dom-accessibility-api"]);
  // Every answer carries the version read at runtime, the principle it works on and how long it took.
  for (const method of record.methods) {
    assert.match(method.version, /^\d+\.\d+/, method.implementation);
    assert.ok(method.principle && method.principle.length > 10);
    assert.equal(typeof method.ms, "number");
    assert.equal(typeof method.result.name, "string");
  }
  const plain = await loep("name", [await ref("css:#plain-button")]);
  assert.deepEqual(plain.answers, ['button "Gewone knop" <- chromium, alfa-aria, axe-name, playwright, dom-accessibility-api']);
  assert.equal(plain.methods, "5 agree");
  // An element inside a shadow root.
  const shadow = await loep("name", [await ref("css:#shadow-noname")]);
  assert.deepEqual(shadow.answers, ['button "" <- chromium, alfa-aria, axe-name, playwright, dom-accessibility-api']);
});

test("a name that a method is known to get wrong is marked and is not a contradiction", async () => {
  await loep("open", ["/opinions.html"]);
  const field = await loep("name", [await ref("css:#placeholder-only")]);
  assert.equal(field.methods, "5 agree");
  assert.deepEqual(field.answers, ['textbox "Uw vraag" <- chromium, alfa-aria, axe-name, playwright', 'textbox "" <- dom-accessibility-api [bekend onbetrouwbaar hier: dom-accessibility-api telt placeholder niet mee als naam]']);
  const record = observation(field.id).result;
  // The answer is kept; it is marked.
  assert.equal(record.methods.length, 5);
  assert.match(record.methods[4]!.knownUnreliable ?? "", /placeholder/);
  const paragraph = await loep("name", [await ref("css:#dutch")]);
  assert.match((paragraph.answers as string[])[1]!, /<- axe-name \[bekend onbetrouwbaar hier: axe geeft voor een element zonder rol/);
  assert.equal(paragraph.methods, "5 agree");
});

test("ax keeps what it printed and adds whether the name computations agree", async () => {
  await loep("open", ["/opinions.html"]);
  const plain = await loep("ax", [await ref("css:#plain-button")]);
  assert.equal(plain.role, "button");
  assert.equal(plain.name, "Gewone knop");
  assert.equal((plain.states as { focusable: boolean }).focusable, true);
  assert.equal(plain.names, "5 agree");
  assert.equal(plain.answers, undefined);
  const image = await loep("ax", [await ref("css:#imgbtn")]);
  assert.equal(image.names, "5 disagree");
  assert.equal((image.answers as string[]).length, 2);
});

test("rules runs four engines, ties their outcomes to elements and shows where they differ", async () => {
  const opened = await loep("open", ["/opinions.html"]);
  const rules = await loep("rules");
  assert.deepEqual(Object.keys(rules.engines as object), ["axe-core", "alfa", "ibm", "qualweb"]);
  assert.equal(rules.methods, "4 disagree");
  const elements = rules.elements as string[];
  // IBM passes the image button that the three others fail for its name.
  assert.ok(elements.includes("4.1.2 #imgbtn [oneens] failed axe-core input-image-alt, alfa sia-r28, qualweb QW-ACT-R6; passed ibm"), elements.join("\n"));
  // Defects inside a frame and inside a shadow root are found by all four and written in the toolbox's own notation.
  assert.ok(elements.some((line) => line.startsWith("1.1.1 #defect-frame | #frame-noalt [eens] failed axe-core image-alt, alfa sia-r2, ibm img_alt_valid, qualweb QW-ACT-R17")), elements.join("\n"));
  assert.ok(elements.some((line) => line.startsWith("1.1.1 #inhoud > loep-defects >>> #shadow-noalt [eens] failed axe-core image-alt, alfa sia-r2, ")));
  assert.ok((rules.disagree as string[]).some((line) => line.startsWith("2.2.2: failed axe-core (1), ibm (1); passed qualweb")));
  assert.ok((rules.agree as string[]).some((line) => line.startsWith("1.1.1: failed axe-core (3), alfa (3), ibm (3), qualweb (3)")));
  assert.ok(size(rules) < 3600, `rules printed ${size(rules)} characters`);
  const record = observation(rules.id);
  const result = record.result as unknown as Measured & { matching: { total: { withElement: number; exact: number; unmatched: number } }; domUnchanged: boolean; methods: (Method & { result: { findings: { where: string | null; match: string; rule: string; outcome: string }[]; passed: Record<string, (string | null)[]>; rules: Record<string, { criteria: string[]; act: string[] }> } })[] };
  // Nearly every outcome about an element is tied to an element; what is not, is counted and not hidden.
  assert.ok(result.matching.total.exact / result.matching.total.withElement > 0.98, JSON.stringify(result.matching.total));
  assert.equal(result.matching.total.exact + result.matching.total.unmatched, result.matching.total.withElement);
  assert.match(rules.matched as string, /^\d+ van \d+ uitkomsten aan een element gekoppeld/);
  // The engines left the page as they found it, although QualWeb writes attributes while it runs.
  assert.equal(result.domUnchanged, true);
  assert.equal(record.page?.domSha256, observation(opened.id).page?.domSha256);
  // Passes are in the record, not in the print; ACT ids come along where an engine gives them.
  const axe = result.methods[0]!.result;
  assert.ok(Object.values(axe.passed).flat().length > 50);
  assert.ok(axe.passed["button-name"]!.includes("#plain-button"));
  assert.ok(axe.findings.every((finding) => finding.outcome !== "passed"));
  assert.deepEqual(axe.rules["image-alt"], { criteria: ["1.1.1"], act: ["23a2a8"] });
  assert.ok(axe.findings.some((finding) => finding.where === "#defect-frame | #frame-noname" && finding.rule === "button-name"), "axe looked inside the frame");
  // A second question about the same page costs nothing: the engines ran once.
  const narrowed = await loep("rules", [], { criterion: "2.5.8" });
  assert.equal((observation(narrowed.id).result as unknown as { cached: boolean }).cached, true);
  assert.deepEqual(narrowed.agree, ["2.5.8: failed axe-core (4), alfa (2), ibm (2)"]);
  assert.ok((narrowed.elements as string[]).every((line) => line.startsWith("2.5.8 ")));
  const one = await loep("rules", [await ref("css:#imgbtn")]);
  assert.ok((one.elements as string[]).every((line) => line.includes("#imgbtn")), (one.elements as string[]).join("\n"));
  assert.equal((await raw("rules", [], { criterion: "9.9.9" })).ok, false);
});

test("a method that throws lands in failed while the others answer", async () => {
  INJECTED_FAULTS.add("ibm");
  INJECTED_FAULTS.add("alfa-aria");
  try {
    await loep("open", ["/opinions.html"]);
    const rules = await loep("rules");
    assert.deepEqual(Object.keys(rules.engines as object), ["axe-core", "alfa", "qualweb"]);
    assert.match(rules.methods as string, /^3 (agree|disagree), 1 zonder antwoord$/);
    assert.deepEqual(rules.noAnswer, ["ibm: opzettelijke fout in een test"]);
    const record = observation(rules.id).result;
    assert.deepEqual(record.failed.map((failure) => [failure.implementation, failure.kind]), [["accessibility-checker-engine", "failed"]]);
    const named = await loep("name", [await ref("css:#plain-button")]);
    assert.deepEqual(named.answers, ['button "Gewone knop" <- chromium, axe-name, playwright, dom-accessibility-api']);
    assert.equal(named.methods, "4 agree, 1 zonder antwoord");
    assert.deepEqual(named.noAnswer, ["alfa-aria: opzettelijke fout in een test"]);
    // The engine that failed is missing from the comparison for one element too, and is named there.
    const contrast = await loep("contrast", [await ref("css:#plain-low")]);
    assert.equal(contrast.methods, "6 agree, 1 zonder antwoord");
  } finally {
    INJECTED_FAULTS.clear();
  }
});

test("contrast compares pixels, computed style and the engines, and marks a known wrong answer", async () => {
  await loep("open", ["/opinions.html"], { scheme: "dark" });
  // A colour with light-dark(): Alfa reads it as black and passes it. That is known, and said.
  const dark = await loep("contrast", [await ref("css:#ld")]);
  assert.equal((dark.text as { ratio: number; outcome: string }[])[0]!.outcome, "failed");
  assert.equal(dark.methods, "7 agree");
  assert.equal(dark.byMethod, "pixels failed 1.9 | computed-style failed 1.92 | chromium-backgrounds failed 1.92 | axe-core failed 1.92 | alfa passed 21 | ibm failed 1.92 | qualweb failed");
  assert.deepEqual(dark.knownUnreliable, ["alfa: bekend onbetrouwbaar hier, Alfa leest een kleur met light-dark() als zwart en kan contrast daarmee ten onrechte goedkeuren"]);
  const record = observation(dark.id).result;
  assert.equal(record.methods.length, 7, "Alfa's answer is kept");
  assert.equal(record.methods[0]!.method, "pixel-screenshot");
  assert.deepEqual(record.methods.map((method) => method.method), ["pixel-screenshot", "computed-style", "background-sampling", "rule-engine", "rule-engine", "rule-engine", "rule-engine"]);
  // A heading in a shadow root that QualWeb fails and five others pass: a contradiction nobody explained yet.
  const heading = await loep("contrast", [await ref("Kaart met gebreken")]);
  assert.equal(heading.methods, "7 disagree");
  assert.match((heading.disagree as string[])[0]!, /^failed: qualweb; passed: pixels, computed-style, chromium-backgrounds, axe-core, ibm$/);
  assert.equal(observation(heading.id).result.agreement, "disagree");
  assert.ok(size(heading) < 900, `contrast printed ${size(heading)} characters`);
  // Where everybody agrees the print is what it was, plus one line. Alfa agrees here, so it carries no flag.
  await loep("open", ["/opinions.html"]);
  const plain = await loep("contrast", [await ref("css:#plain-low")]);
  // "place" is what every command on an element adds: the heading above and the sentence around it.
  assert.deepEqual(Object.keys(plain).filter((key) => key !== "place"), ["id", "text", "methods"]);
  assert.equal(plain.methods, "7 agree");
  assert.ok(observation(plain.id).result.methods.every((method) => method.knownUnreliable === undefined));
});

test("focus sets the pixels against the change in computed style", async () => {
  await loep("open", ["/opinions.html"]);
  // An outline of one pixel in almost white on white: the style changes, no pixel does.
  const faint = await loep("focus", [await ref("css:#faint-focus")]);
  assert.equal(faint.pixelShare, 0);
  assert.equal(faint.methods, "2 disagree");
  assert.deepEqual(faint.disagree, ["pixel-diff ziet geen verandering; style-change vindt gewijzigde stijl: outline-style, outline-width, outline-color, outline-offset"]);
  const record = observation(faint.id).result;
  assert.deepEqual(record.methods.map((method) => method.method), ["pixel-diff", "computed-style-change"]);
  assert.equal((record.methods[1]!.result as { visibleChange: boolean }).visibleChange, true);
  // The element itself does not change, its surroundings do: both methods see it.
  const around = await loep("focus", [await ref("css:#parent-focus")]);
  assert.ok((around.pixelShare as number) > 0.1);
  assert.equal(around.methods, "2 agree");
  assert.deepEqual((observation(around.id).result.methods[1]!.result as { ancestors: { changed: string[] }[] }).ancestors[0]!.changed, ["background-color"]);
  const none = await loep("focus", [await ref("css:#no-focus")]);
  assert.equal(none.pixelShare, 0);
  assert.equal(none.methods, "2 agree");
  const text = await loep("focus", [await ref("css:#dutch")]);
  assert.equal(text.focusable, false);
  assert.equal(text.methods, "1 single");
});

test("target sets the layout box against what the engines say about the same element", async () => {
  await loep("open", ["/opinions.html"]);
  const tiny = await loep("target", [await ref("css:#tiny1")]);
  assert.equal(tiny.size, "14x14");
  assert.equal(tiny.methods, "4 agree");
  // Two native checkboxes side by side: too small by the box and for axe, excepted for Alfa and IBM.
  const box = await loep("target", [await ref("css:#check-one")]);
  assert.equal(box.largeEnough, false);
  assert.equal(box.methods, "4 disagree");
  assert.equal(box.byMethod, "layout-box failed | axe-core failed | alfa passed | ibm passed");
  assert.deepEqual(box.disagree, ["failed: layout-box, axe-core; passed: alfa, ibm"]);
  const record = observation(box.id).result;
  assert.deepEqual(record.methods.map((method) => method.implementation), ["loep", "axe-core", "alfa", "accessibility-checker-engine"]);
  assert.equal((await loep("target", [await ref("css:h1")])).control, false);
});

test("taborder sets the walk with Tab against the order the DOM predicts", async () => {
  await loep("open", ["/opinions.html"]);
  // Without --max the whole page is walked.
  const order = await loep("taborder");
  assert.equal(order.outcome, "completed");
  assert.equal((order.stops as string[]).length, 16);
  // A scrollable region without tabindex and a frame are stops in Chromium that a prediction leaves out. That is known, named, and no dissent.
  assert.equal(order.methods, "2 agree");
  assert.equal(order.disagree, undefined);
  assert.deepEqual((order.knownDifferences as string[]).map((line) => line.split(";")[0]), ["tabbable tegenover chromium-tab: zonder #scroller", "tabbable tegenover chromium-tab: zonder #defect-frame"]);
  assert.match((order.knownDifferences as string[])[0]!, /bekend verschil, een scrollbaar vlak zonder tabindex/);
  // A stop without text is named by its place.
  assert.match((order.stops as string[])[0]!, /^\[001\] \d+ input: \(#zoek\) \| /);
  const record = observation(order.id).result;
  assert.deepEqual(record.methods.map((method) => [method.method, method.implementation]), [["keyboard-walk", "chromium"], ["static-tab-order", "tabbable"]]);
  assert.match(record.methods[1]!.version, /^\d+\.\d+\.\d+$/);
  // A walk that is cut off says so, and is compared over the stops it made.
  const short = await loep("tabwalk", [], { max: "5" });
  assert.equal(short.outcome, "limit-reached");
  assert.match(short.truncated as string, /^afgekapt na 5 stops \(--max, hoogstens 120\)/);
  assert.equal(short.methods, "2 agree");
  // A real difference: the DOM predicts the second radio button of a group as a stop, Tab skips it. The print says what the walk did there.
  await loep("open", ["/radios.html"]);
  const radios = await loep("taborder");
  assert.equal(radios.methods, "2 disagree");
  assert.deepEqual(radios.disagree, ["tabbable tegenover chromium-tab: andere stops, met #by-phone"]);
  assert.deepEqual(radios.notReached, ["overgeslagen door Tab, hoewel de DOM het als stop voorspelt: #by-phone"]);
});

test("taborder starts on the element given with --from, or where focus is", async () => {
  await loep("open", ["/radios.html"]);
  const from = await loep("taborder", [], { from: "css:#by-mail", max: "2" });
  assert.deepEqual((from.stops as string[]).map((line) => line.split(" | ")[0]!.replace(/^(?:\[\d+\] )?\d+ /, "")), ["input: (#by-mail)", "input: (#hidden-box)"]);
  assert.deepEqual(observation(from.id).target?.path, ["#by-mail"]);
  await loep("tab", [1]);
  const focused = await loep("taborder", [], { from: "focus", max: "1" });
  // Focus was left on the stop after the two that were walked.
  assert.match((focused.stops as string[])[0]!, /^\[001\] \d+ a: Link erna \| /);
  await loep("open", ["/radios.html"]);
  assert.match((await raw("taborder", [], { from: "focus" })).print.error as string, /^--from focus: er heeft nu geen element focus/);
});

test("taborder does not say completed when focus got lost on the way", async () => {
  await loep("open", ["/thrown.html"]);
  const order = await loep("taborder");
  assert.equal(order.outcome, "focus-lost");
  assert.match(order.stopped as string, /^focus verdween na #first: de volgende stop volgens de DOM is ref \d+ a "Link die focus weggooit", en die gooit focus weg zodra hij die krijgt; daarna zijn nog 2 stops niet bereikt/);
  assert.deepEqual(order.notReached, ['krijgt focus en gooit die meteen weg: a "Link die focus weggooit"', 'na het punt waar focus verdween; niet bereikt, niet overgeslagen: a "Eerste link in de voet", a "Tweede link in de voet"']);
  assert.equal((observation(order.id).result as unknown as { focusLost: { throwsAway: boolean } }).focusLost.throwsAway, true);
  // The rest of the page can be walked from the stop after it.
  const rest = await loep("taborder", [], { from: "css:#footer-one" });
  assert.deepEqual((rest.stops as string[]).map((line) => line.split(" | ")[0]!.replace(/^(?:\[\d+\] )?\d+ /, "")).slice(0, 2), ["a: Eerste link in de voet", "a: Tweede link in de voet"]);
});

test("an act command reports a state, a scroll position or a style that changed without any text changing", async () => {
  await loep("open", ["/radios.html"]);
  // A click on a label ticks a checkbox that cannot be seen.
  const ticked = await loep("click", ["css:#box-label"]);
  assert.deepEqual(ticked.states, ["#hidden-box: checked=false -> checked=true"]);
  assert.equal(ticked.changed, undefined);
  await loep("scroll", ["bottom"]);
  // A link inside the page moves the window to the top.
  const up = await loep("click", ["css:#to-top"]);
  assert.match(up.scrolled as string, /^\d+ -> 0$/);
  assert.equal(up.changed, undefined);
  await loep("open", ["/form.html"]);
  const typed = await loep("type", ["css:#name", "name"]);
  assert.deepEqual(typed.states, ['#name: value="" -> value="Test Persoon"']);
  await loep("open", ["/changing.html"]);
  const opened = await loep("click", ["css:#toggle"]);
  assert.deepEqual(opened.states, ["#toggle: aria-expanded=false -> aria-expanded=true"]);
  const record = observation(opened.id).result as unknown as { stateChanges: string[]; scrollBefore: number[] };
  assert.equal(record.stateChanges.length, 1);
  // Nothing at all: then it says what it looked at.
  await loep("open", ["/opinions.html"]);
  const nothing = await loep("click", ["css:#plain-low"]);
  assert.equal(nothing.changed, false);
  assert.match(nothing.note as string, /ook geen andere toestand \(aangevinkt, waarde, uitgeklapt, ingedrukt\), scrollpositie of stijl/);
});

test("focus measures an element that only shows when it has focus", async () => {
  await loep("open", ["/"]);
  const skip = await loep("focus", ["css:.skip"]);
  assert.equal(skip.focusable, true);
  assert.equal(skip.appearsOnFocus, true);
  assert.ok((skip.pixelShare as number) > 0.1);
  assert.equal(skip.notMeasured, undefined);
  assert.equal(skip.methods, "2 agree");
});

test("sheet lays the pictures of a walk out on one image with the numbers of the stops", async () => {
  await loep("open", ["/"]);
  const order = await loep("taborder", [], { max: "6" });
  const sheet = await loep("sheet", [order.id]);
  assert.equal((sheet.pictures as string[]).length, 6);
  assert.match((sheet.pictures as string[])[1]!, /^2: ref \d+ a Start$/);
  const image = PNG.sync.read(readFileSync(join(run, sheet.image as string)));
  assert.equal(image.width, 1280);
  assert.ok(image.height > 40 && image.height < 400);
  assert.equal(observation(sheet.id).images[0]!.path, sheet.image);
  // Several observations: their pictures in a row.
  const focus = await loep("focus", ["css:#good-link"]);
  const both = await loep("sheet", [focus.id, order.id]);
  assert.equal((both.pictures as string[]).length, 8);
  assert.match((await raw("sheet", ["main-9999"])).print.error as string, /bestaat niet/);
  assert.match((await raw("sheet", [])).print.error as string, /^sheet verwacht/);
});

test("a session keeps its clock and count when its process went away, and a loep command does not load the commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-resume-"));
  const scope = { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false };
  const first = await Daemon.create(dir, scope, { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await first.handle({ op: "start", session: "main" });
    await first.handle({ op: "command", session: "main", command: "open", args: ["/"], options: {} });
    const file = join(dir, "observations", "main", "session.json");
    const before = JSON.parse(readFileSync(file, "utf8")) as { startedAt: string };
    // A second process for the same run, as after a crash: the first one never said the session stopped.
    const second = await Daemon.create(dir, scope, { navigationDelayMs: 0, secondBrowsers: false });
    try {
      const resumed = await second.handle({ op: "start", session: "main" });
      assert.equal(resumed.print.commands, "1 van 300");
      await second.handle({ op: "command", session: "main", command: "status", args: [], options: {} });
      assert.equal((JSON.parse(readFileSync(file, "utf8")) as { startedAt: string }).startedAt, before.startedAt);
    } finally {
      await second.close();
    }
    // Stopping a session and starting it again under the same name goes on with what was used, with the limits of the first start.
    const third = await Daemon.create(dir, scope, { navigationDelayMs: 0, secondBrowsers: false });
    try {
      await third.handle({ op: "start", session: "klein", limits: { maxCommands: 3 } });
      await third.handle({ op: "command", session: "klein", command: "open", args: ["/"], options: {} });
      await third.handle({ op: "command", session: "klein", command: "look", args: [], options: {} });
      const started = (JSON.parse(readFileSync(join(dir, "observations", "klein", "session.json"), "utf8")) as { startedAt: string }).startedAt;
      await third.handle({ op: "stop", session: "klein" });
      // A higher limit at the restart is not taken; a lower one is.
      const again = await third.handle({ op: "start", session: "klein", limits: { maxCommands: 25 } });
      assert.equal(again.print.commands, "2 van 3");
      assert.match(again.print.note as string, /^sessie bestond al: 2 van 3 gebruikt, /);
      const opened = await third.handle({ op: "command", session: "klein", command: "open", args: ["/"], options: {} });
      // The numbers of the observations go on after the highest one that is there.
      assert.equal(opened.print.id, "klein-0003");
      assert.match((await third.handle({ op: "command", session: "klein", command: "look", args: [], options: {} })).print.error as string, /^budget op: deze sessie heeft 3 van 3 commando's gebruikt/);
      await third.handle({ op: "stop", session: "klein" });
      assert.equal((await third.handle({ op: "start", session: "klein", limits: { maxCommands: 2 } })).print.commands, "3 van 2");
      assert.equal((JSON.parse(readFileSync(join(dir, "observations", "klein", "session.json"), "utf8")) as { startedAt: string }).startedAt, started);
    } finally {
      await third.close();
    }
  } finally {
    await first.close();
    rmSync(dir, { recursive: true, force: true });
  }
  // The small process behind every `loep` command imports only types from the code of the commands.
  const client = readFileSync(new URL("../src/session/client.ts", import.meta.url), "utf8");
  assert.deepEqual(client.match(/^import (?!type )[^\n]* from "\.\/(?:daemon|commands|opinions)\.ts";$/gm), null);
});

test("lang sets the declared language against two detectors", async () => {
  await loep("open", ["/opinions.html"]);
  const page = await loep("lang");
  assert.equal(page.declared, "nl");
  assert.equal(page.detected, "nl");
  assert.equal(page.verdict, "match");
  // One paragraph of the page is English and does not say so.
  assert.equal((page.mismatches as string[]).length, 1);
  assert.match((page.mismatches as string[])[0]!, /^ref \d+ #english: en \(opgegeven nl\): This paragraph is written/);
  const paragraph = Number((page.mismatches as string[])[0]!.split(" ")[1]);
  const english = await loep("lang", [paragraph]);
  assert.deepEqual({ declared: english.declared, detected: english.detected, verdict: english.verdict, methods: english.methods }, { declared: "nl", detected: "en", verdict: "mismatch", methods: "2 agree" });
  assert.deepEqual(observation(english.id).target?.path, ["#english"]);
  const record = observation(english.id).result;
  assert.deepEqual(record.methods.map((method) => method.implementation), ["eld", "cld3-asm"]);
  // One word is no basis for a language: no guess.
  const word = await loep("lang", [await ref("css:#short")]);
  assert.deepEqual({ verdict: word.verdict, detected: word.detected, reason: word.reason }, { verdict: "cantTell", detected: "?", reason: "te kort: 1 woord" });
  assert.equal((observation(word.id).result.methods[0]!.result as { detected: { language: string | null; guess: string | null }[] }).detected[0]!.guess, null);
  const german = await loep("lang", [await ref("css:#german")]);
  assert.equal(german.verdict, "match");
  // A page whose declared language is not the language of its text.
  await loep("open", ["/english.html"]);
  const wrong = await loep("lang");
  assert.deepEqual({ declared: wrong.declared, detected: wrong.detected, verdict: wrong.verdict }, { declared: "nl", detected: "en", verdict: "mismatch" });
  assert.ok(size(wrong) < 700);
});

test("source validates what the server sent with two parsers", async (context) => {
  const java = await binary("java");
  if (!java.available) return context.skip("geen Java op deze machine");
  await loep("open", ["/opinions.html"]);
  const source = await loep("source", [], { wait: true });
  assert.equal(source.methods, "2 disagree");
  const lines = source.lines as string[];
  // The second id "dup" and the div in the ul are gone from the DOM after parsing; in the source both parsers see them.
  assert.ok(lines.some((line) => /^r\d+ \[beide\] vnu duplicate-id\+nesting \| html-validate no-dup-id\+close-order: /.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^r\d+ \[beide\] vnu content-model \| html-validate element-permitted-content: /.test(line)));
  // The role that does not exist is only reported by vnu.
  assert.ok(lines.some((line) => /^r\d+ \[alleen vnu\] vnu aria-role: Bad value “buton”/.test(line)));
  const record = observation(source.id);
  const result = record.result as unknown as Measured & { bytes: number; located: { located: number; total: number } };
  assert.deepEqual(result.methods.map((method) => method.implementation), ["vnu-jar", "html-validate"]);
  assert.match(result.methods[0]!.version, /^\d+\.\d+\.\d+ java \d+/);
  assert.equal(result.differences.length, 1);
  assert.ok(result.located.located > 0 && result.located.located <= result.located.total);
  // The source is kept as it was received, with its hash.
  const kept = record.images.find((image) => image.path.endsWith("-source.html"));
  assert.ok(kept);
  assert.equal(readFileSync(join(run, kept.path)).length, result.bytes);
  assert.match(readFileSync(join(run, kept.path), "utf8"), /<span id="dup">a<\/span> <span id="dup">b<\/span><\/span>/);
  assert.ok(size(source) < 1300, `source printed ${size(source)} characters`);
});

test("a binary that is not on the machine makes its method unavailable and nothing else", async () => {
  process.env.LOEP_JAVA = join(run, "geen-java");
  process.env.LOEP_TESSERACT = join(run, "geen-tesseract");
  try {
    await loep("open", ["/opinions.html"]);
    const source = await loep("source", [], { wait: true });
    assert.equal(source.methods, "1 single, 1 zonder antwoord");
    assert.deepEqual(source.noAnswer, ["vnu: niet beschikbaar, installeer een Java-runtime van versie 11 of hoger, bijvoorbeeld: brew install temurin"]);
    assert.ok((source.lines as string[]).some((line) => line.includes("[alleen html-validate] html-validate no-dup-id")));
    assert.deepEqual(observation(source.id).result.failed.map((failure) => failure.kind), ["unavailable"]);
    const read = await loep("ocr", [await ref("css:#textimg")], { wait: true });
    assert.equal(read.alt, "");
    assert.equal(read.read, undefined);
    assert.equal(read.methods, "1 single, 1 zonder antwoord");
    assert.match((read.noAnswer as string[])[0]!, /^tesseract: niet beschikbaar, installeer Tesseract/);
    const tools = await loep("tools");
    // Speech recognition and ffmpeg have a test of their own; whether they are on this machine does not matter here.
    assert.deepEqual((tools.unavailable as string[]).filter((line) => !/^(whisper|ffmpeg): /.test(line)), ["image-text: installeer Tesseract met de Nederlandse taaldata, bijvoorbeeld: brew install tesseract tesseract-lang", "vnu: installeer een Java-runtime van versie 11 of hoger, bijvoorbeeld: brew install temurin", "tesseract: installeer Tesseract met de Nederlandse taaldata, bijvoorbeeld: brew install tesseract tesseract-lang"]);
    assert.match((tools.tools as Record<string, string>).source!, /^vnu \(ontbreekt\) not installed, html-validate \d/);
  } finally {
    delete process.env.LOEP_JAVA;
    delete process.env.LOEP_TESSERACT;
  }
});

test("ocr reads the text in a picture and sets it next to the text alternative", async (context) => {
  const tesseract = await binary("tesseract");
  if (!tesseract.available) return context.skip("geen Tesseract op deze machine");
  await loep("open", ["/opinions.html"]);
  const bare = await loep("ocr", [await ref("css:#textimg")], { wait: true });
  assert.equal(bare.alt, "");
  assert.equal(bare.hasText, true);
  assert.match(bare.read as string, /Aanvraag indienen voor/);
  assert.equal(bare.methods, "2 disagree");
  assert.deepEqual(bare.disagree, ["tesseract leest tekst in de afbeelding; hulpsoftware krijgt er geen tekst voor"]);
  const record = observation(bare.id);
  assert.deepEqual(record.result.methods.map((method) => method.implementation), ["tesseract", "chromium"]);
  assert.match(record.result.methods[0]!.version, /^\d+\.\d+/);
  assert.equal(record.images[0]!.path, bare.image);
  const described = await loep("ocr", [await ref("css:#textimg-alt")], { wait: true });
  assert.equal(described.methods, "2 agree");
  assert.ok((described.overlap as number) >= 0.8);
  const chart = await loep("ocr", [await ref("css:#chart")], { wait: true });
  assert.equal(chart.hasText, false);
  assert.equal(chart.methods, "2 agree");
  assert.ok(size(bare) < 500);
});

test("motion sets the animation API against pictures taken over time", async () => {
  await loep("open", ["/opinions.html"]);
  const motion = await loep("motion");
  // A marquee moves without the animation API knowing of an animation.
  assert.equal(motion.methods, "2 disagree");
  assert.deepEqual(motion.disagree, ["screenshot-diff ziet beweging; animation-api kent geen lopende animatie of spelende video"]);
  assert.match(motion.api as string, /^0 lopende animaties, 0 spelende video's; autoplay \(ook geluid\) 0, marquee of blink 1/);
  assert.match(motion.region as string, /^ref \d+ marquee: Lopende tekst/);
  const record = observation(motion.id).result;
  assert.deepEqual(record.methods.map((method) => method.method), ["animation-api", "screenshot-diff"]);
  assert.equal((record.methods[1]!.result as { moves: boolean }).moves, true);
  // The region it names can be pointed at.
  const marquee = Number((motion.region as string).split(" ")[1]);
  assert.deepEqual(observation((await loep("html", [marquee])).id).target?.path, ["#marquee"]);
  await loep("open", ["/form.html"]);
  const still = await loep("motion");
  assert.equal(still.moves, false);
  assert.equal(still.methods, "2 agree");
  assert.ok(size(motion) < 600);
});

test("spacing --keep leaves the wider spacing in force, so a button that only exists with it can be opened and looked at", async () => {
  await loep("open", ["/sizes.html"]);
  // Without --keep the page is put back after the measurement: the button that came with the spacing is gone again.
  await loep("spacing");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await loep("find", ["Meer opties"])).hidden, 1);
  const kept = await loep("spacing", [], { keep: true });
  assert.match(String(kept.kept), /blijft aan/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const more = await ref("Meer opties");
  await loep("click", [more]);
  assert.deepEqual([(await loep("find", ["Meer opties"])).hidden ?? 0, (await loep("find", ["css:#meer-menu a"])).hidden ?? 0], [0, 0], "the menu behind the button is open, with the spacing still in force");
  // A second browser is brought to the same state: the spacing that was kept is a step of it, a spacing that was only measured is not.
  const steps = (keep: boolean) => stateForSecondBrowser({ id: "s", start: { url: "https://site.nl/", width: 1280, height: 800, scheme: "light" }, steps: [{ command: "spacing", args: [], options: keep ? { keep: true } : {}, target: null }] }).steps.length;
  assert.deepEqual([steps(true), steps(false)], [1, 0]);
  await loep("open", ["/sizes.html"]);
  assert.equal((await loep("find", ["Meer opties"])).hidden, 1, "a fresh page has no spacing");
});

test("two browsers that measured the layout are compared on what scrolls, sticks out and is cut off; the width alone is no difference", () => {
  const place = (tag: string, text: string) => ({ path: [`#${tag}`], tag, text });
  const chromium = { id: "chromium", answer: { horizontalScroll: false, scrollWidth: 320, offenders: [place("div", "Kaart")], clipped: [place("p", "Regel")] } };
  // The same elements and a content that is three pixels wider: no difference.
  assert.deepEqual(layoutDifferences(chromium, { id: "webkit", answer: { ...chromium.answer, scrollWidth: 323 } }), []);
  const webkit = { id: "webkit", answer: { horizontalScroll: true, scrollWidth: 412, offenders: [place("div", "Kaart"), place("nav", "Menu  met\nveel links")], clipped: [] } };
  assert.deepEqual(layoutDifferences(chromium, webkit), ["opzij schuiven: chromium nee (inhoud 320 px breed), webkit ja (inhoud 412 px breed)", "steekt uit alleen in webkit: nav: Menu met veel links", "afgekapt alleen in chromium: p: Regel"]);
  assert.equal(layoutLine(webkit.answer), "schuift opzij (inhoud 412 px breed), 2 steekt uit, 0 afgekapt");
  // The text spacing lists no elements that stick out, and counts the text that did not take the spacing.
  const spaced = { horizontalScroll: false, scrollWidth: null, clipped: [], textWithoutSpacing: 0 };
  assert.deepEqual(layoutDifferences({ id: "chromium", answer: spaced }, { id: "webkit", answer: { ...spaced, clipped: [place("button", "Verstuur")], textWithoutSpacing: 2 } }), ["afgekapt alleen in webkit: button: Verstuur", "tekst die de afstand niet kreeg: chromium 0, webkit 2"]);
  assert.equal(layoutLine(spaced), "schuift niet opzij, 0 afgekapt, 0 zonder de afstand");
  // A list that reached the limit of the measurement is compared by its length only.
  const many = Array.from({ length: 50 }, (_unused, index) => place(`a${index}`, "x"));
  assert.deepEqual(layoutDifferences({ id: "chromium", answer: { ...chromium.answer, offenders: many } }, { id: "webkit", answer: chromium.answer }), ["steekt uit: chromium 50, webkit 1; de lijst is afgekapt op 50 en niet per element vergeleken"]);
});

test("tools lists every method with its version and writes them into the manifest", async () => {
  const tools = await loep("tools");
  const perQuestion = tools.tools as Record<string, string>;
  assert.deepEqual(Object.keys(perQuestion), ["name", "rules", "contrast", "target", "focus", "taborder", "lang", "source", "ocr", "motion", "media", "reflow", "spacing", "forced", "distinct", "speech"]);
  assert.match(perQuestion.rules!, /^axe-core \d+\.\d+\.\d+, alfa \d+\.\d+\.\d+, ibm \d+\.\d+\.\d+, qualweb \d+\.\d+\.\d+$/);
  assert.match(perQuestion.media!, /^whisper(?: \(ontbreekt\))? \S.*, text-tracks \d+\.\d+\.\d+.*, ffmpeg(?: \(ontbreekt\))? \S/);
  // A second browser is named with the number of Playwright's build when it is installed: the version alone does not say which WebKit it is.
  assert.match(perQuestion.taborder!, /webkit-tab(?: \(ontbreekt\))? \d+\.\d+(?: build \d+)?, firefox-tab(?: \(ontbreekt\))? \d+\.\d+(?: build \d+)?$/);
  const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")) as { tools: { id: string; version: string; principle: string; available: boolean; licence: string }[]; steps: unknown[] };
  assert.deepEqual(manifest.tools.map((tool) => tool.id), METHODS.map((method) => method.id));
  assert.ok(manifest.tools.every((tool) => tool.version && tool.principle && tool.licence && typeof tool.available === "boolean"));
  // The lines per question stay short: about a hundred characters each, and they grow only when a method is added.
  // VoiceOver as a second method for speech took them from under 1500 to under 1550.
  // What is missing on this machine comes on top, one line with a hint per method, so it is not part of the budget.
  const perQuestionSize = JSON.stringify({ tools: tools.tools }).length;
  assert.ok(perQuestionSize < 1550, `tools printed ${perQuestionSize} characters per question`);
  // The known systematic errors are data: every one names a method that exists.
  for (const known of KNOWN_ERRORS) assert.ok(METHODS.some((method) => method.id === known.method), known.method);
  assert.equal((await loep("wait")).note, "er liep niets op de achtergrond");
});

test("replay repeats a measurement with several methods and compares it method by method", async () => {
  await loep("open", ["/opinions.html"]);
  const measured = await loep("contrast", [await ref("css:#plain-low")]);
  const same = await loep("replay", [measured.id]);
  assert.equal(same.verdict, "same", JSON.stringify(same));
  const named = await loep("name", [await ref("css:#imgbtn")]);
  assert.equal((await loep("replay", [named.id])).verdict, "same");
});

test("the state for a second browser leaves out the steps that only measured", () => {
  const start = { url: "http://127.0.0.1/", width: 1280, height: 800, scheme: "light" as const };
  const click = { command: "click", args: [], options: {}, target: ["#open"] };
  const walk = { command: "taborder", args: [], options: {}, target: null };
  const state = stateForSecondBrowser({ id: "aaaaaaaaaaaa", start, steps: [click, walk, { ...walk, command: "reflow" }] });
  assert.deepEqual(state.steps, [click]);
  assert.equal(state.id, stateForSecondBrowser({ id: "bbbbbbbbbbbb", start, steps: [click, walk] }).id, "the same page however often it was measured");
  const untouched = { id: "cccccccccccc", start, steps: [click] };
  assert.equal(stateForSecondBrowser(untouched), untouched);
});

test("libraries injected for a method leave no global behind, and the engines leave the DOM as it was", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ bypassCSP: true });
    await context.addInitScript({ path: INPAGE_PATH });
    const page = await context.newPage();
    await page.goto(`${site.origin}/opinions.html`);
    // A page that has a global of its own with the name of an engine keeps it.
    await page.evaluate(() => void ((window as unknown as { axe: string }).axe = "van de pagina"));
    const names = (): Promise<string[]> => page.evaluate(() => Object.getOwnPropertyNames(window).sort());
    const html = (): Promise<string> => page.evaluate(() => document.documentElement.outerHTML);
    await ensureHelpers(page);
    const [before, markup] = [await names(), await html()];
    const version = await page.evaluate(capsule([packageSource("axe-core/axe.min.js")], "() => axe.version"));
    assert.match(version as string, /^\d+\.\d+\.\d+$/);
    assert.equal(await page.evaluate(() => (window as unknown as { axe: string }).axe), "van de pagina");
    const run = await runRuleEngines(page, {});
    assert.deepEqual(run.failed, []);
    assert.equal(run.methods.length, 4);
    assert.deepEqual(await names(), before);
    assert.equal(await html(), markup, "no attribute of QualWeb is left in the page");
    assert.equal(run.domUnchanged, true);
    assert.equal(run.usesLightDark, true);
    // The frame got axe for the run and lost it again.
    assert.equal(await page.frames()[1]!.evaluate(() => "axe" in window), false);
    // The copy of the selector-chain function gives what the read-only library gives, for every element.
    const unequal = await page.evaluate(() => {
      const scope = window as unknown as { __loep: { deepElements: (root: Element) => Iterable<Element>; describe: (element: Element) => { path: string[] } }; __loepm: { path: (element: Element) => string[] } };
      return [...scope.__loep.deepElements(document.body)].filter((element) => JSON.stringify(scope.__loep.describe(element).path) !== JSON.stringify(scope.__loepm.path(element))).length;
    });
    assert.equal(unequal, 0);
  } finally {
    await browser.close();
  }
});

test("small parts: snapshot lines, orders, pictures and word overlap", () => {
  assert.deepEqual(parseSnapshotLine('- button "Zeg \\"hallo\\"" [pressed]:'), { role: "button", name: 'Zeg "hallo"' });
  assert.deepEqual(parseSnapshotLine("- text: los"), { role: null, name: "" });
  assert.deepEqual(parseSnapshotLine("- paragraph"), { role: "paragraph", name: "" });
  const order = (implementation: string, method: string, stops: string[], outcome = "completed"): never => ({ method, implementation, version: "1", result: { outcome, key: "Tab", stops: stops.map((where) => ({ where, tag: "a", text: "" })) } }) as never;
  const compared = compareOrders([order("chromium", "keyboard-walk", ["#a", "#f | #x", "#f | #y", "#b"]), order("firefox", "keyboard-walk", ["#a", "#f", "#b"]), order("webkit", "keyboard-walk", ["#b", "#a", "#f"])]);
  // Places inside a frame count as the frame, once.
  assert.deepEqual(compared.groups, [{ by: ["chromium-tab", "firefox-tab"], stops: 3 }, { by: ["webkit-tab"], stops: 3 }]);
  assert.deepEqual(compared.differences, ["webkit-tab tegenover chromium-tab: dezelfde stops in een andere volgorde, vanaf stop 1: #b in plaats van #a"]);
  const white = new PNG({ width: 4, height: 4 });
  white.data.fill(255);
  const dotted = new PNG({ width: 4, height: 4 });
  dotted.data.fill(255);
  dotted.data.set([0, 0, 0, 255], (2 * 4 + 1) * 4);
  assert.deepEqual(changedBetween(white, dotted), { changed: 1, box: { left: 1, top: 2, right: 1, bottom: 2 } });
  // A few pixels far from what moves are a place of their own: they can be left out and do not stretch the box of the movement.
  const still = new PNG({ width: 200, height: 100 });
  still.data.fill(255);
  const moved = new PNG({ width: 200, height: 100 });
  moved.data.fill(255);
  for (const [x, y] of [[3, 3], [4, 3]] as const) moved.data.set([0, 0, 0, 255], (y * 200 + x) * 4);
  for (let y = 50; y < 56; y++) for (let x = 150; x < 171; x++) moved.data.set([0, 0, 0, 255], (y * 200 + x) * 4);
  assert.deepEqual(changedPlaces(still, moved), [{ changed: 2, box: { left: 3, top: 3, right: 4, bottom: 3 } }, { changed: 126, box: { left: 150, top: 50, right: 170, bottom: 55 } }]);
  assert.deepEqual(changedBetween(still, moved), { changed: 128, box: { left: 3, top: 3, right: 170, bottom: 55 } });
  assert.deepEqual([enlarge(dotted, 2).width, enlarge(dotted, 2).height], [8, 8]);
  assert.equal(overlap("Aanvraag indienen voor 1 maart", "aanvraag indienen vóór 1 maart"), 0.8);
  assert.equal(overlap("", "iets"), null);
});

test("hover is a state that measurements see, keep, and say when they cannot see it", async () => {
  await loep("open", ["/opinions.html"]);
  // Measured without the pointer on it first, so an answer from before the hover exists.
  const rest = await loep("contrast", ["css:#hover-low"]);
  assert.equal(rest.methods, "7 agree");
  assert.equal((rest.text as { outcome: string }[])[0]!.outcome, "passed");
  const hovered = await loep("hover", ["css:#hover-low"]);
  // Nothing appears in the page; the colours of the link itself change, and that is reported.
  assert.deepEqual(hovered.style, { color: "rgb(11, 79, 158) -> rgb(176, 176, 176)", "background-color": "rgba(0, 0, 0, 0) -> rgb(255, 255, 255)" });
  assert.equal(hovered.changed, undefined);
  for (const round of [1, 2]) {
    const contrast = await loep("contrast", ["css:#hover-low"]);
    assert.equal(contrast.state, "hover", `round ${round}`);
    assert.equal((contrast.text as { ratio: number; outcome: string }[])[0]!.outcome, "failed");
    // The engines that read live styles see the hover colours; Alfa works on a copy and is listed as having no opinion.
    assert.equal(contrast.methods, "6 agree, 1 geen uitspraak");
    assert.deepEqual(contrast.noOpinion, ["alfa: Alfa rekent op een kopie van de DOM en ziet niet dat de aanwijzer op het element staat of dat het focus heeft"]);
    const record = observation(contrast.id).result as unknown as Measured & { noOpinion: string[] };
    assert.equal(record.agreement, "agree");
    assert.equal(record.noOpinion.length, 1);
    for (const engine of ["axe-core", "accessibility-checker-engine"]) {
      const opinion = record.methods.find((method) => method.implementation === engine)!.result as { verdict: string; findings: { data?: { ratio?: number } }[] };
      assert.equal(opinion.verdict, "failed", engine);
      assert.ok((opinion.findings[0]!.data!.ratio as number) < 3, engine);
    }
    // The measurement left the pointer where it was: the style that is read next is that of the hover state, every property asked for.
    const style = await loep("style", ["css:#hover-low", "color", "background-color"]);
    assert.deepEqual(style.style, { color: "rgb(176, 176, 176)", "background-color": "rgb(255, 255, 255)" });
    assert.equal(style.hover, true);
  }
  const still = await loep("hover", ["css:#plain-low"]);
  assert.equal(still.changed, false);
  assert.match(still.note as string, /stijl van het element zelf/);
});

test("contrast says what it cannot measure: text on a picture, a picture without text recognition, an element outside the window", async () => {
  await loep("open", ["/opinions.html"]);
  // Text on a background picture: only the pixels apply, and their range is the answer. Nothing is flagged.
  const photo = await loep("contrast", ["css:#over-photo"]);
  assert.equal(photo.methods, "1 single, 6 geen uitspraak");
  assert.deepEqual(photo.noOpinion, ["computed-style, chromium-backgrounds, axe-core, alfa, ibm, qualweb: ziet de achtergrondafbeelding niet"]);
  assert.equal(photo.knownUnreliable, undefined);
  assert.equal(photo.disagree, undefined);
  assert.match((photo.text as { reason: string }[])[0]!.reason, /ongunstigste achtergrondkleur/);
  const record = observation(photo.id).result as unknown as Measured & { noOpinion: string[] };
  assert.equal(record.agreement, "single");
  assert.equal(record.methods.length, 7, "what the others computed is kept in the record");
  // An image that holds text, on a machine without text recognition: not measured, and said so the way ocr does.
  process.env.LOEP_TESSERACT = join(run, "geen-tesseract");
  try {
    const image = await loep("contrast", ["css:#textimg"], { wait: true });
    assert.equal(image.methods, "0 met een uitspraak, 1 zonder antwoord");
    assert.match((image.noAnswer as string[])[0]!, /^image-text: niet beschikbaar, installeer Tesseract/);
    assert.match(image.note as string, /^dit is een afbeelding: de tekst in het beeld is niet gemeten/);
    assert.equal(image.imageText, undefined);
    assert.equal((observation(image.id).result as unknown as Measured).agreement, "none");
  } finally {
    delete process.env.LOEP_TESSERACT;
  }
  // An element below the window is brought into view for the measurement, and the page is put back.
  const low = await loep("contrast", ["css:#shadow-low"]);
  assert.equal((low.text as { ratio: number; outcome: string }[])[0]!.outcome, "failed");
  assert.equal(low.methods, "7 agree");
  assert.deepEqual(observation(low.id).page?.scroll, [0, 0]);
});

interface ImageLine {
  text: string;
  box: string;
  sizeEstimate: number;
  fg?: string;
  bg?: string;
  ratio?: number;
  best?: number;
  required: number | string;
  outcome: string;
  confidence: number;
  reading?: string;
  reason?: string;
  uncertain?: string;
}

test("contrast measures the text inside a picture: lines from text recognition, colours from the pixels in each box", async (context) => {
  const tesseract = await binary("tesseract");
  if (!tesseract.available) return context.skip("geen Tesseract op deze machine");
  await loep("open", ["/imagetext.html"]);
  // labels.svg: bold text of 20 pixels in three flat bands.
  const expected = [
    { text: /Besluit volgt later/, fg: [255, 255, 255], bg: [0xf5, 0x9e, 0x0b] },
    { text: /Aanvraag goedgekeurd/, fg: [255, 255, 255], bg: [0x14, 0x53, 0x2d] },
    { text: /Geen aanvraag gevonden/, fg: [0x1f, 0x29, 0x37], bg: [255, 255, 255] },
  ] as const;
  const computed = expected.map((line) => contrastRatio([...line.fg], [...line.bg]));
  assert.deepEqual(computed.map((ratio) => Math.round(ratio * 100) / 100), [2.15, 9.11, 14.68]);
  for (const target of ["css:#labels", "css:#labels-bg"]) {
    const measured = await loep("contrast", [target], { wait: true });
    const lines = measured.imageText as ImageLine[];
    // The lowest ratio comes first.
    assert.equal(lines.length, 3, JSON.stringify(lines));
    lines.forEach((line, index) => {
      assert.match(line.text, expected[index]!.text);
      assert.ok(Math.abs(line.ratio! - computed[index]!) <= Math.max(0.2, 0.05 * computed[index]!), `${target} ${line.text}: measured ${line.ratio}, computed ${computed[index]}`);
      assert.ok(line.confidence >= 60);
      // The size is an estimate from the height of the box; the text is set at 20 pixels.
      assert.ok(Math.abs(line.sizeEstimate - 20) <= 4, `${line.text}: size ${line.sizeEstimate}`);
      assert.match(line.box, /^\d+,\d+ \d+x\d+$/);
      assert.equal(line.reason, undefined);
      // Lines under each other are found by the reading for a block; the reading for scattered text adds nothing here.
      assert.equal(line.reading, "regels");
    });
    assert.deepEqual(lines.map((line) => line.bg), ["#f59e0b", "#14532d", "#ffffff"]);
    assert.deepEqual(lines.map((line) => line.fg), ["#ffffff", "#ffffff", "#1f2937"]);
    // Below 3 fails whatever the size; above 4.5 passes whatever the size.
    assert.deepEqual(lines.map((line) => line.outcome), ["failed", "passed", "passed"]);
    assert.equal(measured.methods, "1 single, 6 geen uitspraak");
    assert.equal(measured.knownUnreliable, undefined);
    assert.match(measured.note as string, /^tekst in het beeld, per regel gemeten .* geschat .* logo of merknaam/);
    const record = observation(measured.id);
    assert.equal(record.result.agreement, "single");
    const method = record.result.methods.find((entry) => entry.method === "ocr-pixels")!;
    assert.equal(method.implementation, "tesseract");
    assert.equal(method.knownUnreliable, undefined);
    assert.equal(record.images[0]!.path, measured.image);
    assert.ok(size(measured) < 1900, `contrast printed ${size(measured)} characters`);
  }
});

test("a second reading finds single letters on coloured tiles next to running text, and each is measured on its own tile", async (context) => {
  const tesseract = await binary("tesseract");
  if (!tesseract.available) return context.skip("geen Tesseract op deze machine");
  await loep("open", ["/imagetext.html"]);
  // scale.svg: two lines of running text, and under them five tiles of 60 pixels with one white letter each.
  const tiles = [
    { letter: "A", x: 16, bg: "#14532d" },
    { letter: "B", x: 96, bg: "#2e7d32" },
    { letter: "C", x: 176, bg: "#f59e0b" },
    { letter: "D", x: 256, bg: "#c2410c" },
    { letter: "E", x: 336, bg: "#b91c1c" },
  ];
  const rgb = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
  const measured = await loep("contrast", ["css:#scale"], { wait: true });
  const lines = [...(measured.imageText as ImageLine[])];
  const record = observation(measured.id);
  const all = (record.result.methods.find((entry) => entry.method === "ocr-pixels")!.result as unknown as { lines: { text: string; reading: string; box: { x: number; y: number; width: number; height: number }; ratio: number | null }[] }).lines;
  assert.equal(all.length, lines.length + ((measured.moreImageText as number | undefined) ?? 0));
  // The running text is still found by the reading for a block, once.
  const running = all.filter((line) => line.box.y < 80);
  assert.deepEqual(running.map((line) => line.reading), ["block", "block"]);
  assert.match(running.map((line) => line.text).join(" "), /Energielabel.*verbruik/);
  // Every letter on a tile comes from the reading for scattered text: the reading for a block does not find one.
  const onTiles = all.filter((line) => line.box.y >= 96);
  assert.ok(onTiles.length >= 4, `letters found: ${JSON.stringify(onTiles.map((line) => line.text))}`);
  assert.ok(onTiles.every((line) => line.reading === "sparse"));
  let right = 0;
  for (const found of lines.filter((line) => line.reading === "verspreid")) {
    const [x, y, width] = found.box.split(/[, x]/).map(Number) as [number, number, number];
    const tile = tiles.find((candidate) => x >= candidate.x && x + width <= candidate.x + 60);
    assert.ok(tile && y >= 96, `a line of scattered text lies within one tile: ${JSON.stringify(found)}`);
    // Measured on its own tile: white letters on the colour of that tile, and the ratio that follows from the two.
    const computed = contrastRatio([255, 255, 255], rgb(tile.bg));
    assert.deepEqual([found.fg, found.bg, found.reason], ["#ffffff", tile.bg, undefined]);
    assert.ok(Math.abs(found.ratio! - computed) <= Math.max(0.2, 0.05 * computed), `${tile.letter}: measured ${found.ratio}, computed ${computed}`);
    assert.equal(found.outcome, computed < 3 ? "failed" : "passed");
    if (found.text.toUpperCase().includes(tile.letter)) right++;
  }
  assert.ok(right >= 4, `letters read: ${JSON.stringify(lines.map((line) => line.text))}`);
  assert.match(measured.note as string, /reading zegt welke lezing de regel vond/);
  // The command for text in a picture reads the letters too, and says how many words only the second reading found.
  const read = await loep("ocr", ["css:#scale"], { wait: true });
  assert.match(read.read as string, /Energielabel van de woning/);
  assert.ok((read.sparseWords as number) >= 4, `sparse words: ${read.sparseWords}`);
});

test("levelling makes a letter dark on white whatever the colours, and the second reading adds only what is new and sure", () => {
  const fill = (picture: PNG, x0: number, y0: number, x1: number, y1: number, colour: Rgb): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) picture.data.set([...colour, 255], (y * picture.width + x) * 4);
  };
  // A white page, a dark tile on it, and on the tile a white ring of three pixels: a letter with an inside.
  const picture = new PNG({ width: 80, height: 60 });
  fill(picture, 0, 0, 80, 60, [255, 255, 255]);
  fill(picture, 10, 10, 70, 50, [20, 83, 45]);
  fill(picture, 32, 20, 48, 40, [255, 255, 255]);
  fill(picture, 35, 23, 45, 37, [20, 83, 45]);
  const flat = levelled(picture);
  const grey = (x: number, y: number): number => flat.data[(y * 80 + x) * 4]!;
  // Page and tile are both white now, also at the edge between them; the ring is black and its inside is the tile again.
  assert.deepEqual([grey(2, 2), grey(12, 12), grey(10, 30), grey(9, 30), grey(69, 49)], [255, 255, 255, 255, 255]);
  assert.deepEqual([grey(33, 30), grey(40, 21), grey(46, 38)], [0, 0, 0]);
  assert.equal(grey(40, 30), 255);
  // A dark ring on a light tile gives the same picture: the colours no longer matter.
  const other = new PNG({ width: 80, height: 60 });
  fill(other, 0, 0, 80, 60, [30, 30, 30]);
  fill(other, 10, 10, 70, 50, [245, 158, 11]);
  fill(other, 32, 20, 48, 40, [31, 41, 55]);
  fill(other, 35, 23, 45, 37, [245, 158, 11]);
  assert.deepEqual([...levelled(other).data], [...flat.data]);

  const word = (text: string, confidence: number, x: number, y: number, width: number, height: number, line = "1.1.1") => ({ text, confidence, line, box: { x, y, width, height } });
  // Letters on tiles next to each other come back as one line: it is cut where the room between them is wide.
  const letters = [word("A", 96, 34, 114, 24, 24), word("B", 92, 116, 114, 20, 24), word("op", 90, 140, 114, 30, 24)];
  assert.deepEqual(sparsePieces(letters).map((piece) => piece.map((part) => part.text).join(" ")), ["A", "B op"]);
  const block = [[word("Energielabel", 96, 17, 19, 130, 19), word("woning", 96, 200, 19, 78, 19)]];
  const merged = mergeReadings(block, [
    // Found by both readings: kept once, as the line of the first.
    word("Energielabel", 95, 17, 19, 130, 19, "2.1.1"),
    ...letters.map((letter) => ({ ...letter, line: "3.1.1" })),
    // Something the second reading is not sure of is noise, not text.
    word("Q", 41, 300, 114, 20, 24, "4.1.1"),
    // No letter or digit in it.
    word("|", 90, 380, 114, 4, 24, "5.1.1"),
  ]);
  assert.deepEqual(merged.map((line) => [line.text, line.reading]), [["Energielabel woning", "block"], ["A", "sparse"], ["B op", "sparse"]]);
  // In the reading for a block one letter alone is no word, as before.
  assert.deepEqual(mergeReadings([letters], []), [lineOf([letters[2]!])]);
});

test("contrast measures a box the agent points at in a picture, and says the agent chose it", async () => {
  await loep("open", ["/imagetext.html"]);
  type Pointed = { box: string; sizeEstimate: number; fg?: string; bg?: string; ratio?: number; best?: number; required: number | string; outcome: string; reason?: string; uncertain?: string; text?: string; confidence?: number };
  const white = contrastRatio([255, 255, 255], [0xf5, 0x9e, 0x0b]);
  for (const target of ["css:#labels", "css:#labels-bg"]) {
    // The label on the orange band of labels.svg, without text recognition: white letters of 20 pixels, bold.
    const label = await loep("contrast", [target], { at: "10,56,230,38" });
    const pointed = label.pointed as Pointed;
    assert.deepEqual([pointed.fg, pointed.bg, pointed.outcome], ["#ffffff", "#f59e0b", "failed"]);
    assert.ok(Math.abs(pointed.ratio! - white) <= 0.2, `${target}: measured ${pointed.ratio}, computed ${white}`);
    // The box that comes back is the rows the letters are in; the size is an estimate from their height, with a tail of a g in it.
    assert.match(pointed.box, /^10,6\d 230x(1\d|2[0-2])$/);
    assert.ok(pointed.sizeEstimate >= 18 && pointed.sizeEstimate <= 30, `size ${pointed.sizeEstimate}`);
    assert.equal(pointed.required, "3 of 4.5", "without the words the size, and so the requirement, is not certain");
    assert.equal(pointed.text, undefined, "no text was recognised, so none is printed");
    assert.equal(pointed.confidence, undefined);
    assert.match(pointed.uncertain!, /de lettergrootte is geschat .* de tekst zelf is niet herkend/);
    assert.equal(label.at, "10,56 230x38");
    assert.equal(label.methods, "1 single");
    assert.match(label.note as string, /^het kader is door de agent aangewezen met --at, niet door tekstherkenning gevonden/);
    const record = observation(label.id);
    assert.equal((record.result as unknown as { pointedBy: string }).pointedBy, "agent");
    const method = record.result.methods.find((entry) => entry.method === "pointed-pixels")!;
    assert.equal(method.implementation, "loep");
    assert.equal(record.images[0]!.path, label.image);
    const picture = PNG.sync.read(readFileSync(join(run, label.image as string)));
    assert.deepEqual([picture.width, picture.height], [400, 150], "the box is in the pixels of this picture");
  }
  // One short word: "Geen" on the white band, with the edge of the box in the space after it.
  const word = (await loep("contrast", ["css:#labels"], { at: "12,108,55,32" })).pointed as Pointed;
  assert.deepEqual([word.fg, word.bg, word.outcome], ["#1f2937", "#ffffff", "passed"]);
  assert.ok(Math.abs(word.ratio! - contrastRatio([0x1f, 0x29, 0x37], [255, 255, 255])) <= 0.8, `measured ${word.ratio}`);
  // A box over two bands does not lie on one background: a reason, no number.
  const across = (await loep("contrast", ["css:#labels"], { at: "10,30,230,40" })).pointed as Pointed;
  assert.equal(across.ratio, undefined);
  assert.equal(across.outcome, "cantTell");
  assert.match(across.reason!, /^de rand van het aangewezen kader ligt niet op één achtergrond/);
  // A box with nothing in it is not two colours.
  const empty = (await loep("contrast", ["css:#labels"], { at: "300,105,80,40" })).pointed as Pointed;
  assert.equal(empty.ratio, undefined);
  assert.match(empty.reason!, /^binnen het aangewezen kader zijn geen twee duidelijke kleurgroepen/);
  // A box that is given wrongly is refused and costs nothing.
  const used = (await loep("status")).commands;
  for (const [at, message] of [["10,56,230", /--at verwacht x,y,breedte,hoogte/], ["10,56,2,2", /minstens 4 bij 4/], ["300,100,200,40", /valt buiten het element, dat 400 bij 150 pixels is/]] as const) {
    const refused = await raw("contrast", ["css:#labels"], { at });
    assert.equal(refused.ok, false);
    assert.match(String(refused.print.error), message);
  }
  assert.equal((await loep("status")).commands, used);
  // The observation plays again with the same box.
  const again = await loep("contrast", ["css:#labels"], { at: "10,56,230,38" });
  assert.equal((await loep("replay", [again.id])).verdict, "same");
});

test("a line of text in a picture gets no ratio when the recognition is unsure or the colours are not two groups", () => {
  const flat = (width: number, height: number, colour: Rgb): PNG => {
    const picture = new PNG({ width, height });
    for (let offset = 0; offset < picture.data.length; offset += 4) picture.data.set([...colour, 255], offset);
    return picture;
  };
  const fill = (picture: PNG, x0: number, y0: number, x1: number, y1: number, colour: Rgb): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) picture.data.set([...colour, 255], (y * picture.width + x) * 4);
  };
  const line = (confidence: number) => ({ text: "Hoog", confidence, box: { x: 10, y: 10, width: 80, height: 20 } });
  // Bars of three pixels as letters: their middle is the colour of the letter alone.
  const bars = flat(100, 40, [0, 90, 160]);
  for (let x = 12; x < 88; x += 8) fill(bars, x, 10, x + 3, 30, [255, 255, 255]);
  const sure = measureLine(bars, line(92), 1);
  assert.equal(sure.ratio, floorRatio(contrastRatio([255, 255, 255], [0, 90, 160])));
  assert.equal(sure.bestRatio, sure.ratio);
  assert.deepEqual([sure.foreground, sure.background, sure.reason, sure.uncertain.length], ["#ffffff", "#005aa0", null, 0]);
  // The same picture twice as large in pixels as on the page: the box and the size are in CSS pixels.
  assert.deepEqual(measureLine(bars, line(92), 2).box, { x: 5, y: 5, width: 40, height: 10 });
  const unsure = measureLine(bars, line(41), 1);
  assert.equal(unsure.ratio, null);
  assert.equal(unsure.outcome, "cantTell");
  assert.match(unsure.reason!, /^de tekstherkenning is hier onzeker \(41 van 100\)/);
  // One colour only: there are no letters to set against a background.
  const empty = measureLine(flat(100, 40, [200, 200, 200]), line(92), 1);
  assert.equal(empty.ratio, null);
  assert.match(empty.reason!, /geen twee duidelijke kleurgroepen/);
  // A background that runs from dark to light: the worst and the best case differ, and the line says why.
  const gradient = flat(100, 40, [0, 0, 0]);
  for (let x = 0; x < 100; x++) fill(gradient, x, 0, x + 1, 40, [x, x, x]);
  for (let x = 12; x < 88; x += 8) fill(gradient, x, 10, x + 3, 30, [255, 255, 255]);
  const uneven = measureLine(gradient, line(92), 1);
  assert.ok(uneven.ratio! < uneven.bestRatio!, `${uneven.ratio} ${uneven.bestRatio}`);
  assert.match(uneven.uncertain.join(" "), /de achtergrond is niet egaal/);
  // Letters of one pixel wide with mixed pixels beside them, as anti-aliasing leaves them: the line says the letters are not flat.
  const thin = flat(100, 40, [255, 255, 255]);
  for (let x = 12; x < 88; x += 8) {
    fill(thin, x, 10, x + 1, 30, [40, 40, 40]);
    fill(thin, x + 1, 10, x + 2, 30, [60, 60, 60]);
    fill(thin, x + 2, 10, x + 3, 30, [80, 80, 80]);
  }
  const mixed = measureLine(thin, line(92), 1);
  assert.ok(mixed.ratio! < mixed.bestRatio!);
  assert.match(mixed.uncertain.join(" "), /de letters zijn niet egaal van kleur .* dunne letters/);
  assert.equal(estimatedFontSize("Hoog", 20), 20 / (0.72 + 0.21));
  assert.equal(Math.round(estimatedFontSize("naam", 10.4)), 20);
});

test("a box from text recognition that does not fit the line gives the right ratio or none, never a wrong one", () => {
  const WHITE: Rgb = [255, 255, 255];
  const ORANGE: Rgb = [0xf5, 0x9e, 0x0b];
  const fill = (picture: PNG, x0: number, y0: number, x1: number, y1: number, colour: Rgb): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) picture.data.set([...colour, 255], (y * picture.width + x) * 4);
  };
  /** Bands from top to bottom, and white bars as letters in rows 67 to 85, as the low line of labels.svg. */
  const banded = (bands: [number, number, Rgb][]): PNG => {
    const picture = new PNG({ width: 400, height: 150 });
    for (const [from, to, colour] of bands) fill(picture, 0, from, 400, to, colour);
    for (let x = 18; x < 184; x += 8) fill(picture, x, 67, x + 3, 86, WHITE);
    return picture;
  };
  const labels = banded([[0, 50, [0x14, 0x53, 0x2d]], [50, 100, ORANGE], [100, 150, WHITE]]);
  const computed = floorRatio(contrastRatio(WHITE, ORANGE));
  assert.equal(computed, 2.1);
  // What Tesseract 5.3 reports for this line with a threshold per part: one word only with a box that reaches into the band below, two words twice.
  const word = (text: string, confidence: number, x: number, y: number, width: number, height: number) => ({ text, confidence, line: "1.1.2", box: { x, y, width, height } });
  const reported = [word("Besluit", 94.9, 16.5, 55.5, 66, 46), word("volgt", 96.3, 90, 55.5, 46, 46), word("later", 94.3, 139.5, 55.5, 46.5, 46), word("volgt", 96.8, 87.5, 66.5, 48.5, 19.5), word("late", 96.8, 142.5, 66.5, 33, 15.5)];
  // The box around all of it crosses two bands. White letters are then the colour of the outline, and the edge of the letters would be measured as the letters: 1.2.
  const across = measureLine(labels, { text: "Besluit volgt late", confidence: 96, box: { x: 16.5, y: 55.5, width: 159, height: 46 } }, 1);
  assert.deepEqual([across.ratio, across.outcome], [null, "cantTell"]);
  assert.match(across.reason!, /^de rand van het kader ligt niet op één achtergrond/);
  // The line takes its height from the lower words, and of a word reported twice the lower box with the longer text.
  const line = lineOf(reported);
  assert.deepEqual(line, { text: "Besluit volgt later", confidence: 95, box: { x: 16.5, y: 66.5, width: 169.5, height: 19.5 }, reading: "block" });
  const fitted = measureLine(labels, line, 1);
  assert.deepEqual([fitted.ratio, fitted.foreground, fitted.background, fitted.reason, fitted.uncertain.length], [computed, "#ffffff", "#f59e0b", null, 0]);
  // What Tesseract 5.5 reports: the first word has the box of the word itself and the last word is whole in its lower box. The same line comes out, a pixel narrower.
  assert.deepEqual(lineOf([word("Besluit", 96.4, 16.5, 66.5, 66, 16), ...reported.slice(1, 4), word("later", 96.6, 141.5, 66.5, 43.5, 16.5)]), { text: "Besluit volgt later", confidence: 97, box: { x: 16.5, y: 66.5, width: 168.5, height: 19.5 }, reading: "block" });
  // Too high a box within one surface: the colours are right, and the size is taken from the rows the letters are in, not from the box.
  const wide = banded([[0, 150, ORANGE]]);
  const high = measureLine(wide, { ...line, box: { ...line.box, y: 45, height: 62 } }, 1);
  assert.deepEqual([high.ratio, high.box, high.fontSizePx], [computed, { x: 17, y: 67, width: 170, height: 19 }, Math.round(estimatedFontSize(line.text, 19))]);
  assert.match(high.uncertain.join(" "), /het kader van de tekstherkenning was hoger dan de letters/);
  // A band hardly higher than the letters, between surfaces of the colour of the letters: the outline is laid closer to the box, on the band.
  const narrow = measureLine(banded([[0, 150, WHITE], [65, 89, ORANGE]]), line, 1);
  assert.deepEqual([narrow.ratio, narrow.foreground, narrow.background], [computed, "#ffffff", "#f59e0b"]);
  // No room at all between the letters and the other surface: no outline lies on the band, so no ratio.
  assert.equal(measureLine(banded([[0, 150, WHITE], [67, 86, ORANGE]]), line, 1).ratio, null);
});

test("forced looks at the page again with forced colours: a focus ring made with box-shadow is gone, one made with outline stays", async () => {
  await loep("open", ["/forced.html"]);
  const seen = await loep("forced");
  assert.equal(seen.mode, "geforceerde kleuren");
  assert.equal(seen.controls, 6);
  // The answer names what disappeared, with the measurement before and in the mode.
  assert.equal((seen.focusDisappears as string[]).length, 1);
  assert.match((seen.focusDisappears as string[])[0]!, /^button: Focus met schaduw \(aandeel 0\.\d+ -> 0\)$/);
  assert.deepEqual(seen.focus, { gemeten: 6, blijft: 5, verdwijnt: 1 });
  assert.equal((seen.boundaryDisappears as string[]).length, 1);
  assert.match((seen.boundaryDisappears as string[])[0]!, /^button: Grens met schaduw \(\d+(\.\d)? -> 1\)$/);
  assert.deepEqual(seen.boundary, { blijft: 5, verdwijnt: 1, komtErbij: 0, wasErNiet: 0, nietGemeten: 0 });
  assert.equal((seen.drawingsDisappear as string[]).length, 1);
  assert.match((seen.drawingsDisappear as string[])[0]!, /^#mask-icon \(bedieningselement zonder tekst\) \(\d+(\.\d)? -> leeg\)$/);
  // What the answer is worth: no requirement, a lead for three criteria, an open point.
  assert.match(seen.note as string, /geen eis van WCAG/);
  assert.match(seen.note as string, /aanwijzing voor 1\.4\.11 .*, 2\.4\.7 .* en 1\.4\.1 .* en een open punt, geen bevinding op zich/);
  assert.equal(seen.methods, "1 single");
  const record = observation(seen.id);
  assert.deepEqual([record.result.methods[0]!.method, record.result.methods[0]!.implementation], ["colour-mode-emulation", "loep"]);
  type Fated = { where: string; boundary: { fate: string }; focus?: { fate: string; before: { pixelShare: number; boxShadow: string; outline: string }; after: { pixelShare: number; boxShadow: string; outline: string } } };
  const result = record.result.methods[0]!.result as unknown as { applied: boolean; controls: Fated[]; graphics: { where: string; drawing: { fate: string } }[] };
  const control = (where: string): Fated => result.controls.find((entry) => entry.where === where)!;
  // The principle: the browser drops the shadow and keeps the outline, and the pixels say the same.
  assert.equal(control("#shadow-ring").focus!.fate, "disappears");
  assert.notEqual(control("#shadow-ring").focus!.before.boxShadow, "none");
  assert.equal(control("#shadow-ring").focus!.after.boxShadow, "none");
  assert.ok(control("#shadow-ring").focus!.before.pixelShare > 0.005 && control("#shadow-ring").focus!.after.pixelShare < 0.005);
  assert.equal(control("#outline-ring").focus!.fate, "stays");
  assert.match(control("#outline-ring").focus!.after.outline, /^solid 4px/);
  assert.ok(control("#outline-ring").focus!.after.pixelShare > 0.005);
  assert.deepEqual(result.controls.map((entry) => entry.boundary.fate), ["stays", "stays", "disappears", "stays", "stays", "stays"]);
  assert.deepEqual(result.graphics.map((entry) => entry.drawing.fate).sort(), ["disappears", "stays"]);
  assert.equal(record.images[0]!.path, seen.image);
  assert.ok(size(seen) < 900, `forced printed ${size(seen)} characters`);
  // One element: its own boundary and focus, with a picture of it with focus in the mode.
  const one = await loep("forced", ["css:#outline-ring"]);
  assert.deepEqual([one.controls, one.focus, one.focusDisappears], [1, { gemeten: 1, blijft: 1, verdwijnt: 0 }, undefined]);
  assert.match(one.focusImage as string, /-focus\.png$/);
  // The wish for more contrast is another mode; this page has no styles for it, so nothing changes.
  const more = await loep("forced", [], { "more-contrast": true, max: "2" });
  assert.equal(more.mode, "meer contrast");
  assert.deepEqual(more.focus, { gemeten: 2, blijft: 2, verdwijnt: 0, nietGevraagd: 4 });
  assert.equal(more.boundaryDisappears, undefined);
  // The colours are put back: the ordinary measurement reads the colours of the page again.
  const after = await loep("contrast", ["css:#border-edge"]);
  assert.equal((after.control as { edge: string }).edge, "#1f2937");
});

test("distinct measures how far a link is from the text around it in colour, as everybody sees it and with each kind of colour blindness", async () => {
  await loep("open", ["/distinct.html"]);
  type Ratios = Record<"gewoon" | "protanopie" | "deuteranopie" | "tritanopie" | "achromatopsie", number>;
  const kinds = ["gewoon", "protanopie", "deuteranopie", "tritanopie", "achromatopsie"] as const;
  // A red link in black text, no underline: far enough apart for somebody who sees red, and not for somebody who does not.
  const computed = floorRatio(contrastRatio([0xe0, 0, 0], [0, 0, 0]));
  assert.equal(computed, 4.1);
  const plain = await loep("distinct", ["css:#colour-only"]);
  const ratios = plain.ratios as Ratios;
  assert.deepEqual(Object.keys(ratios), [...kinds]);
  assert.ok(Math.abs(ratios.gewoon - computed) <= 0.2, `measured ${ratios.gewoon}, computed ${computed}`);
  assert.equal(plain.colours, "tekst #e00000 tegenover #000000");
  // Without the red cone, red is nearly as dark as black: the difference is gone. The exact number is the browser's; that it falls under 3 is the point.
  assert.ok(ratios.protanopie < 3 && ratios.protanopie < ratios.gewoon, JSON.stringify(ratios));
  assert.ok(kinds.every((kind) => ratios[kind] >= 1 && ratios[kind] <= 21));
  const lowest = kinds.reduce((low, kind) => (ratios[kind] < ratios[low] ? kind : low));
  assert.equal(plain.lowest, `${lowest} ${ratios[lowest]}`);
  assert.equal(plain.other, "geen gevonden in de opmaak");
  assert.equal(plain.lead, true);
  assert.equal(plain.pair, "element tegenover de tekst eromheen");
  assert.match(plain.second as string, /^p: Lees de voorwaarden/);
  // What the number is worth: a technique of W3C, not the text of the criterion.
  assert.match(plain.note as string, /onder 3 op 1 zonder ander kenmerk is een aanwijzing voor 1\.4\.1: dat is techniek G183 van W3C voor links, een techniek en geen normtekst/);
  assert.equal(plain.methods, "1 single");
  const record = observation(plain.id);
  assert.deepEqual([record.result.methods[0]!.method, record.result.methods[0]!.implementation], ["vision-emulation-pixels", "loep"]);
  const stored = record.result.methods[0]!.result as unknown as { pair: string; lead: boolean; other: string[]; visions: { vision: string; ratio: number; ink: number; background: number; first: { ink: string; background: string }; second: { ink: string } }[] };
  assert.deepEqual(stored.visions.map((entry) => entry.vision), ["normal", "protanopia", "deuteranopia", "tritanopia", "achromatopsia"]);
  // The colours are read from the pixels of each picture: the page as it is has the colours of the style sheet, the imitation has others.
  assert.deepEqual([stored.visions[0]!.first.ink, stored.visions[0]!.second.ink, stored.visions[0]!.first.background], ["#e00000", "#000000", "#ffffff"]);
  assert.notEqual(stored.visions[1]!.first.ink, "#e00000");
  // Without colour only lightness is left: the ratio there is the one between two greys.
  const grey = stored.visions[4]!.first.ink;
  assert.ok(grey.slice(1, 3) === grey.slice(3, 5) && grey.slice(3, 5) === grey.slice(5, 7), `achromatopsia gives a grey, not ${grey}`);
  assert.equal(stored.visions[0]!.background, 1, "the two stand on the same background");
  // The same colours with an underline: the same ratios, and something besides colour, so no lead.
  const underlined = await loep("distinct", ["css:#underlined"]);
  assert.deepEqual(underlined.ratios, ratios);
  assert.deepEqual([underlined.other, underlined.lead], [["onderstreping"], false]);
  // Two states of the same kind of element: the chosen item of a menu against one that is not chosen.
  const state = await loep("distinct", ["css:#chosen"], { against: "css:#other" });
  const between = floorRatio(contrastRatio([0x1d, 0x4e, 0xd8], [0x1f, 0x29, 0x37]));
  assert.ok(between < 3);
  assert.equal(state.pair, "twee elementen");
  assert.ok(Math.abs((state.ratios as Ratios).gewoon - between) <= 0.2, `measured ${(state.ratios as Ratios).gewoon}, computed ${between}`);
  assert.deepEqual([state.other, state.lead], ["geen gevonden in de opmaak", true]);
  const marked = await loep("distinct", ["css:#chosen-marked"], { against: "css:#other" });
  assert.deepEqual([marked.other, marked.lead], [["rand"], false]);
  assert.ok(size(plain) < 1100, `distinct printed ${size(plain)} characters`);
  // The page is as it was: the imitation is off again.
  assert.equal((await loep("contrast", ["css:#colour-only"])).text instanceof Array, true);
  assert.equal(((await loep("contrast", ["css:#colour-only"])).text as { fg: string }[])[0]!.fg, "#e00000");
  // Something that does not stand in text needs a second element, and a wrong one costs nothing.
  const used = (await loep("status")).commands;
  const alone = await raw("distinct", ["css:h1"]);
  assert.equal(alone.ok, false);
  assert.match(String(alone.print.error), /staat niet in lopende tekst: wijs met --against/);
  assert.match(String((await raw("distinct", ["css:#chosen"], { against: "css:#bestaat-niet" })).print.error), /^--against: geen element voor css:#bestaat-niet/);
  assert.equal((await loep("status")).commands, used);
  // The observation plays again with the same answer.
  assert.equal((await loep("replay", [state.id])).verdict, "same");
});

test("the lead for colour as the only difference needs a ratio under 3 in some kind of vision and nothing else that differs", () => {
  const colours = (ink: string) => ({ ink, background: "#ffffff", edge: "#ffffff" });
  const far = ratiosOf("normal", colours("#e00000"), colours("#000000"));
  assert.deepEqual([far.ink, far.background, far.edge, far.ratio], [4.1, 1, 1, 4.1]);
  const near = ratiosOf("protanopia", colours("#2a2a00"), colours("#000000"));
  assert.ok(near.ratio! < 3);
  assert.equal(isLead([far], []), false);
  assert.equal(isLead([far, near], []), true);
  assert.equal(isLead([far, near], ["onderstreping"]), false);
  // A difference in background or edge counts as a difference in colour too: the largest of the three is the ratio.
  assert.equal(ratiosOf("normal", { ink: "#ffffff", background: "#1d4ed8", edge: "#1d4ed8" }, { ink: "#1f2937", background: "#ffffff", edge: "#ffffff" }).ratio, 14.6);
  // Nothing measured is no lead.
  assert.equal(isLead([ratiosOf("normal", { ink: null, background: null, edge: null }, colours("#000000"))], []), false);
  const features = { underline: false, weight: 400, italic: false, sizePx: 20, family: "Arial", border: "", outline: false, shadow: false, backgroundImage: false, image: false, generated: false };
  assert.deepEqual(otherFeatures(features, features), []);
  assert.deepEqual(otherFeatures({ ...features, underline: true, weight: 700, image: true, border: "B" }, features), ["onderstreping", "vet", "rand", "pictogram of afbeelding"]);
  // A picture with letters of three pixels: the ink is the colour of their middle, not of a mixed edge that covers less.
  const picture = new PNG({ width: 60, height: 20 });
  for (let offset = 0; offset < picture.data.length; offset += 4) picture.data.set([255, 255, 255, 255], offset);
  for (let x = 6; x < 54; x += 8) for (let y = 4; y < 16; y++) for (let dx = 0; dx < 3; dx++) picture.data.set([0xe0, 0, 0, 255], (y * 60 + x + dx) * 4);
  picture.data.set([0xf0, 0x80, 0x80, 255], (4 * 60 + 5) * 4);
  assert.deepEqual(sideColours(picture, { x: 2, y: 2, width: 56, height: 16 }, { x: 0, y: 0, width: 60, height: 20 }), { ink: "#e00000", background: "#ffffff", edge: "#ffffff" });
});

test("an engine that cannot tell is listed as having no opinion and is no dissent", async () => {
  await loep("open", ["/opinions.html"]);
  // Two native checkboxes: QualWeb has no rule for target size; that is not shown as an opinion at all.
  const box = await loep("target", ["css:#check-one"]);
  assert.equal(box.methods, "4 disagree");
  const heading = await loep("target", ["css:#plain-button"]);
  assert.equal(heading.methods, "4 agree");
  assert.equal(heading.noOpinion, undefined);
});

test("a selector can stand where a ref goes, and a wrong command costs nothing", async () => {
  await loep("open", ["/opinions.html"]);
  const before = (await loep("status")).commands;
  assert.equal((await loep("html", ["css:#plain-button"])).html, '<button id="plain-button" type="button">Gewone knop</button>');
  assert.equal((await loep("ax", ["css:#plain-button"])).name, "Gewone knop");
  const many = await raw("style", ["css:#inhoud p"]);
  assert.equal(many.ok, false);
  assert.match(many.print.error as string, /^\d+ elementen voor css:#inhoud p; maak de selector preciezer/);
  assert.match((await raw("html", ["css:#bestaat-niet"])).print.error as string, /^geen element voor css:#bestaat-niet/);
  assert.match((await raw("contrast", ["knop"])).print.error as string, /verwacht het nummer van een element \(uit look of find\) of css:<selector>/);
  assert.equal((await raw("rules", [], { criterion: "9.9.9" })).ok, false);
  // Two commands did something; the four that were given wrongly are not counted, and neither is status.
  const [was, is] = [Number(String(before).split(" ")[0]), Number(String((await loep("status")).commands).split(" ")[0])];
  assert.equal(is - was, 2);
  assert.match((await loep("status")).note as string, /kloktijd sinds de sessie met deze naam voor het eerst is gestart in deze run/);
});

test("rules with a filter prints only what the filter matches", async () => {
  await loep("open", ["/opinions.html"]);
  const all = await loep("rules");
  const narrowed = await loep("rules", [], { criterion: "2.5.8" });
  assert.equal(narrowed.filter, "criterium 2.5.8");
  // Each line starts with the version of its engine; the counts are what the filter decides, so an update of an engine keeps this test.
  const engines = narrowed.engines as Record<string, string>;
  assert.ok(Object.values(engines).every((line) => /^\d+\.\d+\.\d+: /.test(line)), JSON.stringify(engines));
  assert.deepEqual(Object.fromEntries(Object.entries(engines).map(([engine, line]) => [engine, line.replace(/^\S+: /, "")])), { "axe-core": "4 failed, 0 cantTell, 8 passed", alfa: "2 failed, 0 cantTell, 8 passed", ibm: "2 failed, 0 cantTell, 14 passed", qualweb: "0 failed, 0 cantTell, 0 passed" });
  assert.notDeepEqual(narrowed.engines, all.engines);
  assert.equal(narrowed.passed, undefined);
  assert.equal(narrowed.matched, undefined);
  assert.equal((await loep("rules", ["css:#imgbtn"])).filter, "element #imgbtn en wat erin zit");
});

test("a ref stays with its element, also when the page replaces what is at that place", async () => {
  await loep("open", ["/rotating.html"]);
  const first = await ref("Eerste bericht");
  const steady = await ref("Vaste link");
  assert.deepEqual((await loep("style", [first, "text-decoration-line"])).style, { "text-decoration-line": "underline" });
  await loep("click", ["css:#rotate"]);
  // Another link stands where the first one was. The number does not move to it.
  const gone = await raw("style", [first, "text-decoration-line"]);
  assert.equal(gone.ok, false);
  assert.match(gone.print.error as string, /^ref \d+ wijst niet \(meer\) naar een element op deze pagina: het is weg of de pagina heeft het vervangen/);
  assert.deepEqual((await loep("style", [await ref("Tweede bericht"), "text-decoration-line"])).style, { "text-decoration-line": "none" });
  // The same link drawn again as a new element keeps its number.
  await loep("click", ["css:#redraw"]);
  assert.equal((await loep("html", [steady])).html, '<a href="/widgets.html">Vaste link</a>');
});

test("look can leave the marks out and can show the page as with a colour vision deficiency", async () => {
  await loep("open", ["/opinions.html"]);
  const picture = async (options: Record<string, string | boolean>): Promise<PNG> => PNG.sync.read(readFileSync(join(run, (await loep("look", [], options)).image as string)));
  const chip = (image: PNG): number => {
    let count = 0;
    for (let at = 0; at < image.data.length; at += 4) if (image.data[at] === 196 && image.data[at + 1] === 0 && image.data[at + 2] === 143) count++;
    return count;
  };
  const coloured = (image: PNG): number => {
    let count = 0;
    for (let at = 0; at < image.data.length; at += 4) if (Math.abs(image.data[at]! - image.data[at + 2]!) > 30) count++;
    return count;
  };
  const marked = await picture({});
  const plain = await picture({ plain: true });
  assert.ok(chip(marked) > 500, "the marks are drawn in their own colour");
  assert.equal(chip(plain), 0);
  assert.ok(coloured(plain) > 1000, "the page has colour");
  // Without any colour vision the same page has none.
  assert.ok(coloured(await picture({ plain: true, vision: "achromatopsia" })) < coloured(plain) / 20);
  assert.match((await raw("look", [], { vision: "blauw" })).print.error as string, /^--vision is een van: achromatopsia, deuteranopia/);
});

test("taborder measures a stop that only shows on focus, marks a covered stop and leaves blocked predictions out", async () => {
  await loep("open", ["/"]);
  const order = await loep("taborder");
  // The skip link is off screen until it has focus; it is measured as what appears.
  assert.match((order.stops as string[])[0]!, /^\[001\] \d+ a: Direct naar de inhoud \| 0\.\d+ \(verschijnt bij focus\)$/);
  assert.equal(order.methods, "2 agree");
  // With a modal dialog open, the DOM still predicts every link of the page; those are behind the dialog and are no dissent.
  await loep("click", ["css:#open-dialog"]);
  const inDialog = await loep("taborder");
  assert.equal(inDialog.methods, "2 agree");
  assert.deepEqual(inDialog.notes, ["focus stond al op #close-dialog voordat Tab werd ingedrukt en kwam er niet op terug; het telt mee als stop", "tabbable: 12 voorspelde stops niet meegeteld, want achter #dialog"]);
  // A link that a fixed bar lies over when it has focus: the mark names the bar, and "0" is not given as a measurement.
  await loep("open", ["/covered.html"]);
  const covered = await loep("taborder");
  const low = (covered.stops as string[]).find((line) => line.includes("Link onderaan"))!;
  assert.match(low, /\| .*\[bedekt door #bar\]/);
  assert.match(covered.covered as string, /^1 stops liggen onder een ander element/);
  const tabbed = await loep("tab", [3]);
  assert.ok((tabbed.stops as string[]).includes("(focus verlaat de pagina: browserbalk of begin van het document)"));
});

test("an act that navigates waits for the new page, also when the server is slow, and is a step that replays", async () => {
  await loep("open", ["/choose.html"]);
  await loep("type", ["css:#term", "search"]);
  // The answer takes longer than the pause after a key; the command must not read the page halfway.
  const sent = await loep("key", ["Enter"]);
  assert.equal(sent.navigated, true);
  assert.equal(sent.url, `${site.origin}/slow-result?q=test`);
  assert.equal(sent.title, "Zoekresultaten - Testsite sessie");
  assert.deepEqual(observation(sent.id).state.steps.map((step) => step.command), ["type"]);
  const saved = await loep("state", ["save", "gezocht"]);
  assert.equal(saved.steps, 2);
  const again = await loep("open", [], { state: "gezocht" });
  assert.equal(again.reproduced, null, "reproduced is about a postcondition from site.json; this run has none");
  assert.equal(again.url, `${site.origin}/slow-result?q=test`);
});

test("select chooses an option of a native select and says what a custom list needs instead", async () => {
  await loep("open", ["/choose.html"]);
  const chosen = await loep("select", ["css:#topic", "Parkeren"]);
  assert.equal(chosen.chosen, "Parkeren");
  // The same change report as the other acts: the value of the field and what appeared.
  assert.deepEqual(chosen.states, ['#topic: value="" -> value="parkeren"']);
  assert.deepEqual(chosen.appeared, ["Gekozen: Parkeren"]);
  assert.equal((await loep("select", ["css:#topic", "#2"])).chosen, "Afval");
  assert.deepEqual(observation((await loep("status")).id).state.steps.map((step) => [step.command, step.args]), [["select", ["Parkeren"]], ["select", ["#2"]]]);
  assert.match((await raw("select", ["css:#topic", "Fietsen"])).print.error as string, /^geen optie "Fietsen"; de opties zijn: #1 Maak een keuze, #2 Afval, #3 Parkeren, #4 Niet meer beschikbaar$/);
  assert.match((await raw("select", ["css:#topic", "#4"])).print.error as string, /is uitgeschakeld$/);
  assert.match((await raw("select", ["css:#custom", "Een"])).print.error as string, /^dit is geen <select> maar een <div> met rol listbox: een eigen keuzelijst bedien je met click en key/);
  // The choice is a step of the state: a saved state brings it back.
  await loep("state", ["save", "gekozen"]);
  await loep("open", [], { state: "gekozen" });
  assert.deepEqual((await loep("style", ["css:#chosen", "display"])).style, { display: "block" });
  assert.equal((await loep("find", ["Gekozen: Afval"])).total, 1);
});

test("paste puts a fixed value in a field the way a user does and says when the page refuses it", async () => {
  await loep("open", ["/inputs.html"]);
  const open = await loep("paste", ["css:#open-field", "email"]);
  assert.equal(open.arrived, true);
  assert.equal(open.length, "0 -> 16");
  assert.equal(open.prevented, undefined);
  // The same change report as the other acts; a password is given by its length.
  assert.deepEqual(open.states, ["#open-field: value=(0 tekens) -> value=(16 tekens)"]);
  // A paste handler that returns false: nothing arrives, and the print says who stopped it.
  const refused = await loep("paste", ["css:#no-paste", "email"]);
  assert.equal(refused.arrived, false);
  assert.equal(refused.length, "0 -> 0");
  assert.equal(refused.prevented, "paste-handler");
  assert.equal(refused.reason, "een paste-handler van de pagina hield het plakken tegen");
  assert.deepEqual(refused.appeared, ["Plakken is hier niet toegestaan."]);
  const record = observation(refused.id).result as unknown as { arrived: boolean; prevented: string; pasteEvent: { fired: boolean; prevented: boolean }; lengthBefore: number; lengthAfter: number; fieldType: string };
  assert.deepEqual({ arrived: record.arrived, prevented: record.prevented, pasteEvent: record.pasteEvent, lengthBefore: record.lengthBefore, lengthAfter: record.lengthAfter, fieldType: record.fieldType }, { arrived: false, prevented: "paste", pasteEvent: { fired: true, prevented: true }, lengthBefore: 0, lengthAfter: 0, fieldType: "password" });
  const input = await loep("paste", ["css:#no-input", "text"]);
  assert.deepEqual({ arrived: input.arrived, prevented: input.prevented }, { arrived: false, prevented: "beforeinput-handler" });
  const fixed = await loep("paste", ["css:#read-only", "text"]);
  assert.deepEqual({ arrived: fixed.arrived, reason: fixed.reason }, { arrived: false, reason: "het veld is alleen-lezen" });
  // Only the fixed values, and it is a step of the state.
  assert.match((await raw("paste", ["css:#open-field", "eigen tekst"])).print.error as string, /geen vaste testwaarde om te plakken/);
  assert.deepEqual(observation((await loep("status")).id).state.steps.map((step) => step.command), ["paste", "paste", "paste", "paste"]);
  // The page is as it was: the watch on the paste is gone.
  assert.equal((await loep("find", ["css:textarea"])).total, 0);
});

test("press shows on which part of a press a function goes off, and whether it can be aborted", async () => {
  await loep("open", ["/inputs.html"]);
  // A function on the down event: it has gone off before the pointer is released.
  const down = await loep("press", ["css:#on-down"]);
  assert.deepEqual(down.down, { appeared: ["Besteld bij indrukken."], live: ["Besteld bij indrukken."] });
  assert.equal(down.up, "geen verandering");
  assert.equal(down.completesOnDown, true);
  await loep("open", ["/inputs.html"]);
  const held = await loep("press", ["css:#on-down"], { hold: true });
  assert.equal(held.completesOnDown, true);
  assert.equal(held.released, "daarna naast het element losgelaten");
  await loep("open", ["/inputs.html"]);
  const stuck = await loep("press", ["css:#on-down"], { abort: true });
  assert.deepEqual({ completesOnDown: stuck.completesOnDown, wentThrough: stuck.wentThrough }, { completesOnDown: true, wentThrough: true });
  assert.match(stuck.note as string, /afbreken kan niet$/);
  // A function on the click: nothing on down, it goes off on up, and letting go beside the button aborts it.
  await loep("open", ["/inputs.html"]);
  const click = await loep("press", ["css:#on-click"]);
  assert.equal(click.down, "geen verandering");
  assert.deepEqual(click.up, { appeared: ["Besteld bij loslaten."], live: ["Besteld bij loslaten."] });
  assert.equal(click.completesOnDown, false);
  await loep("open", ["/inputs.html"]);
  const aborted = await loep("press", ["css:#on-click"], { abort: true });
  assert.deepEqual({ down: aborted.down, afterAbort: aborted.afterAbort, completesOnDown: aborted.completesOnDown, wentThrough: aborted.wentThrough }, { down: "geen verandering", afterAbort: "geen verandering", completesOnDown: false, wentThrough: false });
  const record = observation(aborted.id);
  assert.deepEqual(record.state.steps, []);
  assert.deepEqual(observation((await loep("status")).id).state.steps.map((step) => ({ command: step.command, options: step.options, target: step.target })), [{ command: "press", options: { abort: true }, target: ["#on-click"] }]);
  assert.equal((record.result as unknown as { mode: string }).mode, "abort");
});
