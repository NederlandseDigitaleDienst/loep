import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium as chromiumType, firefox, webkit, type Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../src/browser/call.ts";
import { clipboardLine, clipboardMark, clipboardSince, type ClipboardWrite } from "../src/browser/clipboard.ts";
import { clipboardNote, hasClipboardPermission, INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import type { Described } from "../src/instruments/activate.ts";
import { probeTrigger } from "../src/instruments/dialog.ts";
import { canonicalJson, sha256 } from "../src/lib/canonical.ts";
import { Daemon, ownedSessionNl, tooManySessionsNl, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { scopeForRun } from "../src/session/safety.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
let site: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-test-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 50, maxSessions: 3, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

/** One command in a session; fails the test when the command was refused. */
async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}, session = "main"): Promise<Print> {
  const response = await raw(command, args, options, session);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

function raw(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}, session = "main"): Promise<Response> {
  return daemon.handle({ op: "command", session, command, args: args.map(String), options });
}

/** Read the record behind a printed id and check that it is a complete, canonical observation. */
function observation(id: string): Observation {
  const [session, nr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  const text = readFileSync(join(run, "observations", session, `${nr}.json`), "utf8");
  const record = JSON.parse(text) as Observation;
  assert.equal(text, canonicalJson(record), "the record is canonical JSON");
  assert.equal(record.id, id);
  assert.equal(record.session, session);
  assert.ok(!Number.isNaN(Date.parse(record.time)));
  assert.match(record.state.id, /^[0-9a-f]{12}$/);
  if (record.page) assert.match(record.page.domSha256, /^[0-9a-f]{64}$/);
  for (const image of record.images) assert.equal(sha256(readFileSync(join(run, image.path))), image.sha256, `hash of ${image.path}`);
  return record;
}

/** The reference number of the one element that `find` gives for a query. */
async function ref(query: string): Promise<number> {
  const found = await loep("find", [query]);
  const first = (found.found as string[])[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

test("open writes an observation with the state, the viewport and a hash of the DOM", async () => {
  const opened = await loep("open", ["/"]);
  assert.equal(opened.status, 200);
  assert.equal(opened.title, "Start - Testsite sessie");
  const record = observation(opened.id);
  assert.equal(record.command, "open");
  assert.deepEqual(record.state.start, { url: `${site.origin}/`, width: 1280, height: 800, scheme: "light" });
  assert.deepEqual(record.state.steps, []);
  assert.deepEqual(record.page?.viewport, { width: 1280, height: 800 });
  assert.equal(record.page?.scheme, "light");
});

test("open takes a page label of the sample and a relative address", async () => {
  writeFileSync(join(run, "sample.json"), JSON.stringify({ items: [{ url: `${site.origin}/` }, { url: `${site.origin}/form.html` }] }));
  try {
    assert.equal((await loep("open", ["P2"])).url, `${site.origin}/form.html`);
    assert.match((await raw("open", ["P7"])).print.error as string, /geen pagina P7/);
    const dark = await loep("open", ["/widgets.html"], { scheme: "dark", width: "360" });
    assert.equal(dark.viewport, "360x800");
    assert.equal(observation(dark.id).page?.scheme, "dark");
    const full = await loep("look", [], { full: true, max: "5" });
    assert.equal((full.outline as string[]).length, 5);
    assert.match((full.more as string[])[0]!, /meer in beeld dan genummerd/);
  } finally {
    rmSync(join(run, "sample.json"));
  }
});

test("look gives a numbered picture and an outline with the same numbers, bounded in size", async () => {
  await loep("open", ["/"]);
  const seen = await loep("look");
  const outline = seen.outline as string[];
  assert.ok(outline.some((line) => /^\d+ button: Open het venster$/.test(line)), outline.join("\n"));
  assert.ok(outline.some((line) => /^\d+ heading1: Testsite voor de sessie$/.test(line)));
  assert.ok(JSON.stringify(seen).length < 4000, `look printed ${JSON.stringify(seen).length} characters`);
  const record = observation(seen.id);
  assert.equal(record.images.length, 1);
  assert.equal(seen.image, record.images[0]!.path);
  const picture = PNG.sync.read(readFileSync(join(run, record.images[0]!.path)));
  assert.deepEqual([picture.width, picture.height], [1280, 800]);
  // Every numbered element is in the record with its durable selector chain.
  const items = (record.result as { items: { ref: number; path: string[] }[] }).items;
  assert.equal(items.length, outline.length);
  assert.ok(items.every((item) => Array.isArray(item.path) && item.path.length > 0));
  // The numbers stay the same on a second look.
  assert.deepEqual((await loep("look")).outline, outline);
});

test("find, ax, style, html and crop describe one element", async () => {
  await loep("open", ["/"]);
  const button = await ref("Open het venster");
  const ax = await loep("ax", [button]);
  assert.equal(ax.role, "button");
  assert.equal(ax.name, "Open het venster");
  assert.deepEqual(observation(ax.id).target?.path, ["#open-dialog"]);
  const style = await loep("style", [await ref("css:#pale"), "color,font-size"]);
  assert.deepEqual(style.style, { color: "rgb(153, 153, 153)", "font-size": "16px" });
  const html = await loep("html", [button]);
  assert.equal(html.html, '<button id="open-dialog" type="button">Open het venster</button>');
  const crop = await loep("crop", [button]);
  const picture = PNG.sync.read(readFileSync(join(run, crop.image as string)));
  assert.ok(picture.width > 100 && picture.width < 300 && picture.height < 80);
  assert.deepEqual((await loep("find", ["role:heading"])).total, 6);
  observation(crop.id);
});

test("contrast measures text and the boundary of a control in the current state", async () => {
  await loep("open", ["/"]);
  const pale = await loep("contrast", [await ref("css:#pale")]);
  assert.deepEqual(pale.text, [{ text: "Deze grijze tekst heeft te wei", fg: "#999999", bg: "#ffffff", ratio: 2.8, required: 4.5, outcome: "failed" }]);
  const button = await loep("contrast", [await ref("Open het venster")]);
  assert.equal((button.text as { outcome: string }[])[0]!.outcome, "passed");
  assert.equal((button.control as { outcome: string }).outcome, "duidelijk");
  const record = observation(button.id);
  // A measurement holds every method that answered, side by side; the pixels of the screenshot come first.
  assert.equal(button.methods, "7 agree");
  const measured = record.result as { methods: { method: string; implementation: string; version: string; result: { control: { where: string } } }[]; agreement: string; differences: string[]; failed: unknown[]; pending: unknown[] };
  assert.equal(measured.agreement, "agree");
  assert.deepEqual(measured.differences, []);
  assert.deepEqual(measured.methods.map((method) => method.implementation), ["loep", "loep", "chromium", "axe-core", "alfa", "accessibility-checker-engine", "qualweb"]);
  assert.deepEqual([measured.failed, measured.pending], [[], []]);
  assert.equal(measured.methods[0]!.method, "pixel-screenshot");
  assert.match(measured.methods[0]!.version, /^\d+\.\d+\.\d+ chromium \d+/);
  assert.equal(measured.methods[0]!.result.control.where, "#open-dialog");
});

test("focus measures the focus indicator of one element", async () => {
  await loep("open", ["/"]);
  const good = await loep("focus", [await ref("css:#good-link")]);
  assert.equal(good.focusable, true);
  assert.equal(good.focusVisible, true);
  assert.ok((good.pixelShare as number) > 0.01);
  assert.ok((good.indicatorRatio as number) >= 3);
  assert.equal(observation(good.id).images.length, 2);
  const bad = await loep("focus", [await ref("css:#no-focus-link")]);
  assert.equal(bad.focusable, true);
  assert.equal(bad.pixelShare, 0);
  assert.equal(bad.indicatorRatio, null);
  const text = await loep("focus", [await ref("css:#pale")]);
  assert.equal(text.focusable, false);
  // Measuring focus moves focus: it is a step of the recipe.
  assert.deepEqual(observation(text.id).state.steps.map((step) => step.command), ["focus", "focus"]);
});

test("target gives size and spacing", async () => {
  await loep("open", ["/"]);
  const small = await loep("target", [await ref('css:button[aria-label="Vorige"]')]);
  assert.equal(small.size, "16x16");
  assert.equal(small.largeEnough, false);
  assert.match(small.tooCloseTo as string, /^button: > /);
  const large = await loep("target", [await ref("Open het venster")]);
  assert.equal(large.largeEnough, true);
  assert.equal(large.tooCloseTo, undefined);
  assert.equal((await loep("target", [await ref("css:h1")])).control, false);
  observation(small.id);
});

test("reflow, zoom and spacing measure and put the page back", async () => {
  await loep("open", ["/"]);
  const reflow = await loep("reflow");
  assert.equal(reflow.horizontalScroll, true);
  assert.ok((reflow.first as string[]).some((line) => line.startsWith("div: Dit blok is zeshonderd")));
  const record = observation(reflow.id);
  assert.deepEqual((record.result as { methods: { result: { viewport: unknown } }[] }).methods[0]!.result.viewport, { width: 320, height: 256 });
  assert.deepEqual(record.page?.viewport, { width: 1280, height: 800 }, "the window is back at its size");
  assert.equal(PNG.sync.read(readFileSync(join(run, reflow.image as string))).width, 640);
  const zoom = await loep("zoom");
  assert.equal(zoom.viewport, "640x400");
  assert.equal(zoom.horizontalScroll, false);
  const spacing = await loep("spacing");
  assert.equal(spacing.textWithoutSpacing, 0);
  assert.equal(typeof spacing.newlyClipped, "number");
  const after = await loep("style", [await ref("css:h1"), "letter-spacing"]);
  assert.deepEqual(after.style, { "letter-spacing": "normal" }, "the forced spacing is gone again");
});

test("contrast measures the lines and areas of an svg drawing, grouped by colour (#324)", async () => {
  await loep("open", ["/diagram.html"]);
  const measured = await loep("contrast", [await ref("css:#diagram")]);
  const shapes = measured.shapes as { part: string; fg: string | null; bg: string | null; ratio: number | null; outcome: string; dashed?: boolean; reason?: string; shapes: number }[];
  const of = (part: string, fg: string) => shapes.find((shape) => shape.part === part && shape.fg === fg);
  assert.deepEqual(of("lijn", "#aaaaaa") && { ratio: of("lijn", "#aaaaaa")!.ratio, bg: of("lijn", "#aaaaaa")!.bg, outcome: of("lijn", "#aaaaaa")!.outcome }, { ratio: 2.3, bg: "#ffffff", outcome: "kandidaat" });
  assert.deepEqual(of("lijn", "#767676") && { ratio: of("lijn", "#767676")!.ratio, dashed: of("lijn", "#767676")!.dashed, outcome: of("lijn", "#767676")!.outcome }, { ratio: 4.5, dashed: true, outcome: "duidelijk" });
  assert.equal(of("vlak", "#ffcc00")?.outcome, "kandidaat");
  assert.ok(shapes.some((shape) => shape.part === "lijn" && shape.reason === "een verloop of patroon"));
  assert.equal(shapes.length, 4, "the white area behind the drawing and the default black fill of a line are not parts of it");
  // A shape inside the drawing measures that shape.
  const inside = await loep("contrast", [await ref("css:#verbinding")]);
  assert.ok((inside.shapes as { fg: string }[]).some((shape) => shape.fg === "#aaaaaa"));
});

test("order sets the order of the code against the order on screen", async () => {
  await loep("open", ["/widgets.html"]);
  const order = await loep("order");
  assert.deepEqual(order.cssOrder, ["li: Ingesloten (order -1)"]);
  assert.deepEqual(order.reversed, ["div: Eerste in de code Tweede in de code Derd (row-reverse)"]);
  const jumps = order.jumps as string[];
  assert.ok(jumps.some((jump) => /^naar links: \d+ a: Eerste in de code -> \d+ a: Tweede in de code$/.test(jump)), jumps.join("\n"));
  assert.ok(jumps.some((jump) => /-> \d+ a: Ingesloten$/.test(jump)));
  observation(order.id);
});

test("engines run on the current state, also inside an opened dialog", async () => {
  await loep("open", ["/"]);
  const closed = await loep("engines");
  assert.ok(!(closed.elements as string[]).some((line) => line.includes("image-alt")), "the image in the closed dialog is not rendered");
  const clicked = await loep("click", [await ref("Open het venster")]);
  assert.equal(clicked.dialogs, "0 -> 1");
  assert.ok((clicked.appeared as string[]).includes("Een venster"));
  const open = await loep("engines");
  assert.ok((open.elements as string[]).some((line) => /^1\.1\.1 #dialog > img \[eens\] failed axe-core image-alt, alfa sia-r2, /.test(line)), (open.elements as string[]).join("\n"));
  const record = observation(open.id);
  // Every engine is a method of its own; `engines` is the earlier name of `rules`.
  const all = record.result as { methods: { implementation: string; version: string; result: { findings: { rule: string }[]; passed: Record<string, string[]> } }[]; agreement: string };
  assert.deepEqual(all.methods.map((method) => method.implementation), ["axe-core", "alfa", "accessibility-checker-engine", "qualweb"]);
  assert.ok(all.methods.every((method) => method.result.findings.length > 0 && Object.keys(method.result.passed).length > 0 && /^\d+\.\d+\.\d+$/.test(method.version)));
  assert.match(open.methods as string, /^4 (agree|disagree)$/);
  assert.equal(all.agreement, (open.methods as string).slice(2));
  assert.deepEqual(record.state.steps.map(({ locators: _locators, ...step }) => step), [{ command: "click", args: [], options: {}, target: ["#open-dialog"] }]);
  assert.equal(record.state.steps[0]!.locators?.role, "button", "a step also records how to find its element when the selector fails");
  // With a modal dialog open, only what is in it gets a number.
  const seen = await loep("look");
  assert.ok((seen.outline as string[]).some((line) => /^\d+ button: Sluiten$/.test(line)));
  assert.ok(!(seen.outline as string[]).some((line) => line.includes("Naar het formulier")));
  const escaped = await loep("key", ["Escape"]);
  assert.equal(escaped.dialogs, "1 -> 0");
  assert.equal((await raw("key", ["F13"])).ok, false, "keys outside the list are refused");
});

test("tab and tabwalk follow the keyboard", async () => {
  await loep("open", ["/"]);
  const tabbed = await loep("tab", [2]);
  assert.deepEqual((tabbed.stops as string[]).map((stop) => stop.replace(/^\d+ /, "")), ["link: Direct naar de inhoud", "link: Start"]);
  const back = await loep("tab", [1], { shift: true });
  assert.match((back.stops as string[])[0]!, /link: Direct naar de inhoud$/);
  const walk = await loep("tabwalk", [], { max: "4" });
  assert.equal(walk.outcome, "limit-reached");
  assert.equal((walk.stops as string[]).length, 4);
  assert.match((walk.stops as string[])[0]!, /^(?:\[\d+\] )?\d+ a: Direct naar de inhoud \| /);
  const record = observation(walk.id);
  assert.equal(record.images.length, 4);
  const from = await loep("tabwalk", [], { max: "2", from: String(await ref("css:#good-link")) });
  // The walk starts on the given element; the next stop is the link without a focus style.
  assert.match((from.stops as string[])[0]!, /^\[001\] \d+ a: Naar het formulier \| /);
  assert.match((from.stops as string[])[1]!, /^\[002\] \d+ a: naar de onderdelen \| 0($| )/);
  assert.deepEqual(observation(from.id).target?.path, ["#good-link"]);
});

test("hover and scroll act on the page", async () => {
  await loep("open", ["/widgets.html"]);
  const hovered = await loep("hover", [await ref("css:#tip-button")]);
  assert.deepEqual(hovered.appeared, ["Dit is de uitleg."]);
  // The element is measured as it is while the pointer is on it.
  assert.equal((await loep("style", [await ref("css:#tip-button")])).hover, true);
  await loep("scroll", ["bottom"]);
  const up = await loep("scroll", ["-100"]);
  assert.match(up.window as string, /^\d+-\d+ van \d+$/);
  assert.equal((await raw("scroll", ["100"])).ok, false, "a number without a sign is a reference, and reference 100 does not exist");
});

test("an element inside a shadow root can be pointed at and measured", async () => {
  await loep("open", ["/widgets.html"]);
  const inner = await ref("Knop in de kaart");
  const contrast = await loep("contrast", [inner]);
  assert.deepEqual(observation(contrast.id).target?.path, ["#inhoud > loep-card", "#inner"]);
  assert.equal((contrast.text as { fg: string; outcome: string }[])[0]!.fg, "#8a8a8a");
  assert.equal((contrast.text as { outcome: string }[])[0]!.outcome, "failed");
  const clicked = await loep("click", [inner]);
  assert.deepEqual(clicked.appeared, ["aangeklikt"]);
});

test("type enters only fixed test values, and a POST never leaves the browser", async () => {
  site.requests.length = 0;
  await loep("open", ["/form.html"]);
  const email = await ref("css:#email");
  const refused = await raw("type", [email, "vrije tekst"]);
  assert.equal(refused.ok, false);
  assert.match(refused.print.error as string, /geen vaste testwaarde/);
  await loep("type", [email, "invalid-email"]);
  const send = await ref("css:#send");
  const invalid = await loep("click", [send]);
  assert.deepEqual(invalid.appeared, ["Vul een geldig e-mailadres in."]);
  const typed = await loep("type", [email, "email"]);
  assert.equal(typed.entered, "loep-test@example.com");
  const sent = await loep("click", [send]);
  assert.deepEqual(sent.blocked, [`method: POST ${site.origin}/submit`]);
  const record = observation(sent.id);
  assert.equal(record.blocked.length, 1);
  assert.equal(record.blocked[0]!.kind, "method");
  assert.deepEqual(site.requests.filter((request) => request.method !== "GET"), [], "the server received nothing but GET");
  // A form that submits with GET inside the scope works.
  await loep("open", ["/form.html"]);
  await loep("type", [await ref("css:#q"), "search"]);
  const searched = await loep("key", ["Enter"]);
  assert.equal(searched.url, `${site.origin}/form.html?q=test`);
});

test("a WebSocket message and a POST from a chat widget are refused and logged", async () => {
  site.requests.length = 0;
  site.socketMessages.length = 0;
  await loep("open", ["/widgets.html"]);
  const clicked = await loep("click", [await ref("css:#chat-send")]);
  assert.deepEqual(clicked.appeared, ["Bericht aangeboden."]);
  const kinds = observation(clicked.id).blocked.map((entry) => `${entry.kind} ${entry.method} ${entry.url}`).sort();
  assert.deepEqual(kinds, [`method POST ${site.origin}/api/chat`, `socket SEND ws://${new URL(site.origin).host}/chat`]);
  // Give a message that slipped through time to arrive.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(site.socketMessages, []);
  assert.deepEqual(site.requests.filter((request) => request.method !== "GET"), []);
});

test("navigation outside the scope is refused and logged, also through a redirect", async () => {
  site.requests.length = 0;
  await loep("open", ["/"]);
  const clicked = await loep("click", [await ref("css:#elsewhere")]);
  assert.deepEqual(clicked.blocked, [`scope: GET ${site.otherOrigin}/elsewhere.html`]);
  assert.equal(clicked.changed, false, "the page stays where it was");
  assert.equal(observation(clicked.id).page?.url, `${site.origin}/`);
  const direct = await raw("open", [`${site.otherOrigin}/elsewhere.html`]);
  assert.equal(direct.ok, false);
  assert.match(direct.print.error as string, /buiten de scope/);
  assert.equal(observation(direct.print.id as string).blocked[0]!.kind, "scope");
  const redirected = await raw("open", ["/redirect-out"]);
  assert.equal(redirected.ok, false);
  assert.ok(observation(redirected.print.id as string).blocked.some((entry) => entry.kind === "scope" && entry.url.startsWith(`${site.otherOrigin}/elsewhere.html`)));
  assert.deepEqual(site.requests.filter((request) => request.host === "localhost"), [], "nothing reached the other host");
  assert.equal((await raw("look")).ok, false, "after a refused open there is no page");
});

test("a session opens only http and https on the host and port of the run", async () => {
  site.requests.length = 0;
  for (const address of ["file:///etc/hosts", "data:text/html,<h1>x</h1>", "javascript:alert(1)", "blob:http://127.0.0.1/abc"]) {
    const refused = await raw("open", [address]);
    assert.equal(refused.ok, false, address);
    assert.match(refused.print.error as string, /geen adres met http:\/\/ of https:\/\//, address);
  }
  // The same host on another port is another server, and outside the scope.
  const port = Number(new URL(site.origin).port);
  const other = await raw("open", [`http://127.0.0.1:${port === 65535 ? port - 1 : port + 1}/`]);
  assert.equal(other.ok, false);
  assert.match(other.print.error as string, /buiten de scope/);
  assert.deepEqual(site.requests, [], "nothing was asked for");
});

test("state save and open --state reproduce a state", async () => {
  await loep("open", ["/changing.html"]);
  const toggle = await ref("css:#toggle");
  await loep("click", [toggle]);
  const before = await loep("ax", [toggle]);
  assert.equal((before.states as { expanded: boolean }).expanded, true);
  const saved = await loep("state", ["save", "more-open"]);
  assert.equal(saved.steps, 1);
  assert.deepEqual((await loep("state", ["list"])).states, ["more-open"]);
  const opened = await loep("open", [], { state: "more-open" }, "main");
  assert.equal(opened.reproduced, null, "no site model gives this state a postcondition, so nothing was checked");
  assert.match(String(opened.note), /geen postconditie/);
  const record = observation(opened.id);
  assert.equal(record.state.id, saved.state, "the replayed state has the id of the saved one");
  assert.equal(record.page?.domSha256, observation(before.id).page?.domSha256);
  const after = await loep("ax", [await ref("css:#toggle")]);
  assert.equal((after.states as { expanded: boolean }).expanded, true);
  // The same state, then on to another page in the same browser context.
  const moved = await loep("open", ["/"], { state: "more-open" });
  assert.equal(moved.url, `${site.origin}/`);
  assert.deepEqual(observation(moved.id).state.steps.map((step) => step.command), ["click", "goto"]);
  assert.equal((await raw("open", [], { state: "bestaat-niet" })).ok, false);
});

test("replay reports same for an unchanged page and different after the page changes", async () => {
  site.setVariant(0);
  await loep("open", ["/changing.html"]);
  await loep("click", [await ref("css:#toggle")]);
  const measured = await loep("contrast", [await ref("css:#text")]);
  assert.equal((measured.text as { ratio: number }[])[0]!.ratio, 17.4);
  const same = await loep("replay", [measured.id]);
  assert.equal(same.verdict, "same");
  assert.equal(same.domSame, true);
  // Replaying does not disturb the page the session is on.
  assert.equal(observation(same.id).page?.domSha256, observation(measured.id).page?.domSha256);
  const look = await loep("look");
  assert.equal((await loep("replay", [look.id])).verdict, "same");
  site.setVariant(1);
  const different = await loep("replay", [measured.id]);
  assert.equal(different.verdict, "different");
  assert.equal(different.domSame, false);
  assert.ok((different.differences as string[]).some((line) => line.startsWith("methods.0.result.text.0.ratio: 17.4 -> ")), (different.differences as string[]).join("\n"));
  assert.equal((observation(different.id).result as { replayed: string }).replayed, measured.id);
  site.setVariant(0);
  assert.equal((await raw("replay", ["main-9999"])).ok, false);
});

test("a session that has used its budget is refused, without a record", async () => {
  assert.equal((await daemon.handle({ op: "start", session: "tiny", limits: { maxCommands: 2 } })).ok, true);
  await loep("open", ["/"], {}, "tiny");
  // Asking where things stand costs nothing, and neither does a command that was given wrongly.
  await loep("status", [], {}, "tiny");
  await loep("find", ["css:h1"], {}, "tiny");
  assert.equal((await raw("html", ["999"], {}, "tiny")).ok, false);
  assert.equal((await raw("key", ["F13"], {}, "tiny")).ok, false);
  assert.equal((await loep("status", [], {}, "tiny")).commands, "1 van 2");
  await loep("look", [], {}, "tiny");
  const refused = await raw("look", [], {}, "tiny");
  assert.equal(refused.ok, false);
  assert.match(refused.print.error as string, /^budget op: deze sessie heeft 2 van 2 commando's gebruikt/);
  assert.equal(existsSync(join(run, "observations", "tiny", "0008.json")), false);
  // What costs nothing is still answered when the budget is used up.
  assert.equal((await loep("status", [], {}, "tiny")).commands, "2 van 2");
  assert.equal((await daemon.handle({ op: "start", session: "klok", limits: { maxMinutes: 0 } })).ok, true);
  assert.match((await raw("open", ["/"], {}, "klok")).print.error as string, /^budget op: deze sessie loopt 0 van 0 minuten/);
  // Three sessions is the maximum of this process.
  const fourth = await daemon.handle({ op: "start", session: "vierde" });
  assert.equal(fourth.ok, false);
  assert.equal(fourth.print.error, tooManySessionsNl(3, 3));
  assert.equal((await daemon.handle({ op: "stop", session: "tiny" })).ok, true);
  assert.equal((await daemon.handle({ op: "stop", session: "klok" })).ok, true);
  assert.equal((await raw("look", [], {}, "tiny")).ok, false, "a stopped session takes no commands");
});

test("sessions have their own page, and navigations to one host are spaced", async () => {
  assert.equal((await daemon.handle({ op: "start", session: "tweede" })).ok, true);
  await loep("open", ["/"]);
  const started = Date.now();
  await loep("open", ["/form.html"], {}, "tweede");
  await loep("open", ["/widgets.html"], {}, "tweede");
  assert.ok(Date.now() - started >= 50, "two navigations to the same host are at least the delay apart");
  assert.equal((await loep("status")).url, `${site.origin}/`);
  assert.equal((await loep("status", [], {}, "tweede")).url, `${site.origin}/widgets.html`);
  await daemon.handle({ op: "stop", session: "tweede" });
});

test("a session too many is refused with what to do, and a start that counted on another limit is told the real one", async () => {
  const small = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { maxSessions: 2, navigationDelayMs: 0, secondBrowsers: false });
  try {
    const first = await small.handle({ op: "start", session: "regie", maxSessions: 2 });
    assert.deepEqual([first.ok, first.print.warning, (first.print.limits as { maxSessions: number }).maxSessions], [true, undefined, 2]);
    assert.equal((await small.handle({ op: "start", session: "b-111" })).ok, true);
    const refused = await small.handle({ op: "start", session: "b-112" });
    assert.equal(refused.ok, false);
    assert.equal(refused.print.error, tooManySessionsNl(2, 2));
    assert.match(refused.print.error as string, /^er lopen al 2 sessies en dit sessieproces laat er hooguit 2 tegelijk toe\. Wacht .*session list.*session stop --session <naam>.*hooguit 1 agent tegelijk.*--max-sessions <aantal>$/);
    // The limit belongs to the process: asking for another one later changes nothing, and says so.
    const again = await small.handle({ op: "start", session: "regie", maxSessions: 11, key: first.print.key as string });
    assert.equal(again.ok, true);
    assert.match(again.print.warning as string, /^het sessieproces liep al en laat 2 sessies tegelijk toe, niet 11\./);
    assert.equal((again.print.limits as { maxSessions: number }).maxSessions, 2);
    await small.handle({ op: "stop", session: "b-111" });
    assert.equal((await small.handle({ op: "start", session: "b-112" })).ok, true, "a place came free");
  } finally {
    await small.close();
  }
});

test("a running session has one owner: a second start is refused, and only its key starts it again", async () => {
  const owned = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  try {
    const first = await owned.handle({ op: "start", session: "b-311", model: "model-een" });
    const key = first.print.key as string;
    await owned.handle({ op: "command", session: "b-311", command: "open", args: ["/"], options: {} });
    // A second agent with the same session name, as when the same task was started twice.
    const twin = await owned.handle({ op: "start", session: "b-311", model: "model-twee" });
    assert.deepEqual([twin.ok, twin.print.error], [false, ownedSessionNl("b-311", false)]);
    assert.match(twin.print.error as string, /^geweigerd: sessie "b-311" loopt al en heeft een eigenaar\. .*--key <sleutel>.*meet niet verder/);
    const guessed = await owned.handle({ op: "start", session: "b-311", key: "00000000" });
    assert.deepEqual([guessed.ok, guessed.print.error], [false, ownedSessionNl("b-311", true)]);
    // The refused starts changed nothing: no model was added, and the page of the owner is still open.
    assert.deepEqual((JSON.parse(readFileSync(join(run, "observations", "b-311", "session.json"), "utf8")) as { models: string[] }).models, ["model-een"]);
    assert.equal((await owned.handle({ op: "command", session: "b-311", command: "status", args: [], options: {} })).print.url, `${site.origin}/`);
    // The owner, after a restart of its own, goes on with its key.
    const resumed = await owned.handle({ op: "start", session: "b-311", key });
    assert.deepEqual([resumed.ok, resumed.print.key, resumed.print.commands], [true, key, "1 van 300"]);
    // A session that was stopped has no owner any more: whoever starts it next gets a new key.
    await owned.handle({ op: "stop", session: "b-311" });
    const next = await owned.handle({ op: "start", session: "b-311" });
    assert.equal(next.ok, true);
    assert.notEqual(next.print.key, key);
  } finally {
    await owned.close();
  }
});

test("a command that takes too long is cut off and the page is closed", async () => {
  const impatient = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { commandTimeoutMs: 1500, navigationDelayMs: 0, secondBrowsers: false });
  try {
    await impatient.handle({ op: "start", session: "ongeduldig" });
    const hung = await impatient.handle({ op: "command", session: "ongeduldig", command: "open", args: ["/slow"], options: {} });
    assert.equal(hung.ok, false);
    assert.match(hung.print.error as string, /^geen antwoord binnen 1.5 seconden; de pagina is gesloten/);
    assert.equal(observation(hung.print.id as string).error, hung.print.error);
    const next = await impatient.handle({ op: "command", session: "ongeduldig", command: "look", args: [], options: {} });
    assert.match(next.print.error as string, /nog geen pagina geopend/);
  } finally {
    await impatient.close();
  }
});

test("the scope of a run is its own host plus the hosts of embedded frames", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-scope-"));
  try {
    await assert.rejects(scopeForRun(dir, {}), /onbekend welke site in scope is/);
    writeFileSync(join(dir, "inventory.json"), JSON.stringify({ baseUrl: "https://www.example.nl/", origin: "https://www.example.nl", pages: [{ url: "https://www.example.nl/contact" }, { url: "https://video.example.org/embed/1" }] }));
    assert.deepEqual(await scopeForRun(dir, { allowHosts: ["cdn.example.net"] }), { hosts: ["cdn.example.net", "video.example.org", "www.example.nl"], baseUrl: "https://www.example.nl/", strict: false });
    // A host keeps its port unless it is 80 or 443; a frame on this machine or a local network is left out of a site on the internet, also from an older inventory that still lists it.
    writeFileSync(join(dir, "inventory.json"), JSON.stringify({ baseUrl: "https://www.example.nl/", origin: "https://www.example.nl", origins: ["https://www.example.nl", "https://www.example.nl:8443"], pages: [{ url: "http://www.example.nl:80/a" }, { url: "https://video.example.org:8080/embed/1" }, { url: "http://127.0.0.1:4712/speler.html" }, { url: "http://10.1.2.3/beheer" }, { url: "http://printer.local/" }, { url: "http://[fe80::1]/" }] }));
    assert.deepEqual((await scopeForRun(dir, { allowHosts: ["cdn.example.net:8080", "https://fonts.example.net/"] })).hosts, ["cdn.example.net:8080", "fonts.example.net", "video.example.org:8080", "www.example.nl", "www.example.nl:8443"]);
    // On a site that runs locally, such as the test site, a frame on another local port is part of it.
    writeFileSync(join(dir, "inventory.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:4710/", origin: "http://127.0.0.1:4710", pages: [{ url: "http://127.0.0.1:4710/" }, { url: "http://127.0.0.1:4712/speler.html" }] }));
    assert.deepEqual((await scopeForRun(dir, {})).hosts, ["127.0.0.1:4710", "127.0.0.1:4712"]);
    await assert.rejects(scopeForRun(dir, { scopeUrl: "file:///etc/hosts" }), /geen adres met http/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command line starts a session in the background, sends commands and stops it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-cli-"));
  // A refused command prints its reason as JSON too, and exits with a non-zero code.
  const cli = async (...args: string[]): Promise<Record<string, unknown>> => {
    const output = await promisify(execFile)(process.execPath, [CLI, ...args, "--run", dir]).catch((error: { stdout: string; code: number }) => ({ stdout: error.stdout, code: error.code }));
    return { ...(JSON.parse(output.stdout) as Record<string, unknown>), exit: "code" in output ? output.code : 0 };
  };
  try {
    const started = await cli("session", "start", "--scope", `${site.origin}/`, "--session", "cli", "--max-commands", "5", "--model", "voorbeeld-model-4.5[1m]");
    assert.equal(started.commands, "0 van 5");
    // The model the agent gives at the start is kept in the session file, as given.
    assert.equal(started.model, "voorbeeld-model-4.5[1m]");
    const sessionFile = (): { models?: string[] } => JSON.parse(readFileSync(join(dir, "observations", "cli", "session.json"), "utf8")) as { models?: string[] };
    assert.deepEqual(sessionFile().models, ["voorbeeld-model-4.5[1m]"]);
    // A second start of the running session needs the key the first start gave; without it, it is refused.
    assert.match(started.key as string, /^[0-9a-f]{8}$/);
    const second = await cli("session", "start", "--session", "cli", "--model", "ander-model-2");
    assert.deepEqual([second.exit, second.error], [1, ownedSessionNl("cli", false)]);
    // With the key, a start on another model adds it; the same name again and a placeholder that was copied from the task add nothing.
    const key = started.key as string;
    assert.equal((await cli("session", "start", "--session", "cli", "--model", "ander-model-2", "--key", key)).key, key);
    await cli("session", "start", "--session", "cli", "--model", "voorbeeld-model-4.5[1m]", "--key", key);
    await cli("session", "start", "--session", "cli", "--model", "<naam en versie van je model>", "--key", key);
    assert.deepEqual(sessionFile().models, ["voorbeeld-model-4.5[1m]", "ander-model-2"]);
    // A session that names no model works as before and says how to give one.
    const silent = await cli("session", "start", "--session", "zonder");
    assert.match(silent.model as string, /^niet opgegeven/);
    assert.equal("models" in JSON.parse(readFileSync(join(dir, "observations", "zonder", "session.json"), "utf8")), false);
    await cli("session", "stop", "--session", "zonder");
    assert.deepEqual(started.scope, [new URL(site.origin).host]);
    const opened = await cli("session", "open", "/form.html", "--session", "cli", "--width", "360");
    assert.equal(opened.title, "Formulier - Testsite sessie");
    assert.equal(opened.viewport, "360x800");
    const scrolled = await cli("session", "scroll", "-50", "--session", "cli");
    assert.equal(typeof scrolled.window, "string");
    assert.equal(existsSync(join(dir, "observations", "cli", "0002.json")), true);
    const unknown = await cli("session", "klik", "1", "--session", "cli");
    assert.match(unknown.error as string, /^onbekend commando "klik"/);
    assert.equal(unknown.exit, 1);
    // Extending goes over the same command line, with its reason; before most of the budget is used it is refused.
    const early = await cli("session", "extend", "--session", "cli", "--reason", "De velden van het formulier op een smal scherm.");
    assert.match(early.error as string, /^verlengen kan vanaf 80 procent van het budget; deze sessie heeft 2 van 5 commando's/);
    assert.deepEqual((await cli("session", "stop")).stopped, ["cli"]);
    assert.match((await cli("session", "look", "--session", "cli")).error as string, /^er loopt geen sessie/);
    assert.equal(existsSync(join(dir, "session-daemon.json")), false, "the process cleans up after itself");
  } finally {
    // When an assertion failed halfway, the background process is still there.
    if (existsSync(join(dir, "session-daemon.json"))) await cli("session", "stop").catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command on an element says where a reader finds it: the heading above and the sentence around it", async () => {
  await loep("open", ["/"]);
  const shown = await loep("ax", [await ref("css:#good-link")]);
  assert.deepEqual(shown.place, { heading: "Testsite voor de sessie", text: "Naar het formulier of naar de onderdelen." });
  const target = observation(shown.id).target!;
  assert.equal(target.heading, "Testsite voor de sessie");
  assert.equal(target.around, "Naar het formulier of naar de onderdelen.");
});

test("an action says what it put on the clipboard: what, how, and whether the browser took it", async () => {
  await loep("open", ["/copy.html"]);
  // The context may fill the clipboard, as a visitor's browser may after a click. What was written is in the answer and in the record.
  const copied = await loep("click", [await ref("css:#copy")]);
  assert.deepEqual([copied.appeared, copied.live, copied.clipboard, copied.note], [["Gekopieerd"], ["Gekopieerd"], 'gekopieerd, 21 tekens, tekst "npm install voorbeeld"', undefined]);
  assert.deepEqual((observation(copied.id).result as { clipboard: ClipboardWrite[] }).clipboard, [{ kind: "writeText", text: "npm install voorbeeld", length: 21, ok: true, error: null }]);
  // The same through the keyboard, with the old copy command and with a write of items of more than one kind of data.
  assert.equal((await loep("key", ["Enter"])).clipboard, copied.clipboard);
  const old = await loep("click", [await ref("css:#copy-old")]);
  assert.equal(old.clipboard, 'gekopieerd (met het oude kopieercommando), 21 tekens, tekst "npm install voorbeeld"');
  const items = await loep("click", [await ref("css:#copy-items")]);
  assert.equal(items.clipboard, 'gekopieerd, 21 tekens, tekst "npm install voorbeeld"');
  assert.deepEqual((observation(items.id).result as { clipboard: ClipboardWrite[] }).clipboard[0]!.types, ["text/plain", "text/html"]);
  // A button that says it copied and wrote nothing: the defect that only the record shows.
  const fake = await loep("click", [await ref("css:#copy-fake")]);
  assert.deepEqual([fake.appeared, fake.clipboard, fake.note], [["Adres gekopieerd"], "niets naar het klembord geschreven", undefined]);
  // Reading stays refused. The page says so in its own words, nothing was written, and the answer says where the failure may come from.
  const read = await loep("click", [await ref("css:#read")]);
  assert.deepEqual([read.appeared, read.clipboard], [["Het klembord lezen is mislukt"], "niets naar het klembord geschreven"]);
  assert.match(read.note as string, /^de melding over kopiëren of het klembord kan aan de testbrowser liggen: die mag het klembord vullen maar niet lezen/);
  assert.equal((observation(read.id).result as { note?: string }).note, read.note);
  // An action that has nothing to do with the clipboard says nothing about it.
  assert.equal((await loep("key", ["Tab"])).clipboard, undefined);
});

test("what a page writes to the clipboard is recorded in every browser, with the error where the browser refuses", async () => {
  const refused: ClipboardWrite = { kind: "writeText", text: "x", length: 1, ok: false, error: "NotAllowedError" };
  const taken: ClipboardWrite = { ...refused, ok: true, error: null };
  // A refusal by the browser always comes with the sentence about the test browser; a write that was taken never does.
  assert.match(clipboardNote([], false, [refused])!, /deze browser kent geen toestemming voor het klembord/);
  assert.equal(clipboardNote(["Kopiëren mislukt"], true, [taken]), null);
  assert.match(clipboardNote(["Kopiëren mislukt"], false)!, /kan aan de testbrowser liggen/);
  assert.equal(clipboardNote(["Gekopieerd", "Versturen mislukt"], false), null);
  assert.equal(clipboardLine({ ...taken, text: "a".repeat(500), length: 2120 }), `gekopieerd, 2120 tekens, begint met "${"a".repeat(60)}"`);
  assert.equal(clipboardLine({ ...refused, error: "TypeError" }), "mislukt (TypeError)");

  const wrote = async (page: Page, id: string): Promise<[string | null, string[]]> => {
    const mark = await clipboardMark(page);
    await page.click(`#${id}`);
    await page.waitForFunction(() => document.getElementById("copy-status")!.textContent !== "");
    await page.waitForTimeout(100);
    const writes = await clipboardSince(page, mark);
    const said = await page.textContent("#copy-status");
    await page.evaluate(() => (document.getElementById("copy-status")!.textContent = ""));
    return [said, writes.map(clipboardLine)];
  };
  const everyButton = async (page: Page): Promise<Record<string, [string | null, string[]]>> => {
    const seen: Record<string, [string | null, string[]]> = {};
    for (const id of ["copy", "copy-old", "copy-items", "copy-fake"]) seen[id] = await wrote(page, id);
    return seen;
  };
  const text = 'gekopieerd, 21 tekens, tekst "npm install voorbeeld"';
  const old = 'gekopieerd (met het oude kopieercommando), 21 tekens, tekst "npm install voorbeeld"';
  const works = { copy: ["Gekopieerd", [text]], "copy-old": ["Gekopieerd op de oude manier", [old]], "copy-items": ["Gekopieerd met opmaak", [text]], "copy-fake": ["Adres gekopieerd", []] };
  for (const type of [chromiumType, firefox, webkit]) {
    if (!existsSync(type.executablePath())) continue;
    const browser = type === chromiumType ? await launchBrowser() : await type.launch();
    try {
      // The context of the sweep and the sessions. In WebKit and Firefox no permission is asked for (asking is an error there) and the write is taken after a click all the same.
      assert.equal(hasClipboardPermission(browser), type === chromiumType);
      const context = await newContext(browser, { writes: null });
      await context.addInitScript({ path: INPAGE_PATH });
      const page = await context.newPage();
      await page.goto(`${site.origin}/copy.html`);
      assert.deepEqual(await everyButton(page), works, type.name());
      // In a frame of the same origin the record is that of the frame, and it is read with the page.
      await page.setContent(`<iframe src="${site.origin}/copy.html" title="Kopiëren"></iframe>`);
      const frame = page.frames()[1]!;
      await frame.waitForLoadState("load");
      const mark = await clipboardMark(page);
      await frame.click("#copy");
      await frame.waitForFunction(() => document.getElementById("copy-status")!.textContent !== "");
      assert.equal((await clipboardSince(page, mark)).length, 1, `${type.name()}: frame`);
      await context.close();
      if (type !== chromiumType) continue;
      // Chromium without the permission, as the test browser was before: the attempt and the error are the answer.
      const bare = await browser.newContext();
      await bare.addInitScript({ path: INPAGE_PATH });
      const denied = await bare.newPage();
      await denied.goto(`${site.origin}/copy.html`);
      assert.deepEqual(await everyButton(denied), { ...works, copy: ["Kopiëren mislukt", ["geweigerd door de browser (NotAllowedError)"]], "copy-items": ["Kopiëren mislukt", ["geweigerd door de browser (NotAllowedError)"]] });
      await bare.close();
    } finally {
      await browser.close();
    }
  }
});

test("the sweep records what a button that says it copies wrote to the clipboard", async () => {
  const browser = await launchBrowser();
  const outDir = mkdtempSync(join(tmpdir(), "loep-copy-"));
  try {
    const context = await newContext(browser, { writes: null });
    await context.addInitScript({ path: INPAGE_PATH });
    const seen: Record<string, unknown> = {};
    for (const id of ["copy", "copy-fake", "read"]) {
      const page = await context.newPage();
      await loadPage(page, `${site.origin}/copy.html`);
      const trigger = (await call<(Described & { path: string[] })[]>(page, "triggers")).find((entry) => entry.path.at(-1)!.endsWith(`#${id}`))!;
      const { dialog } = await probeTrigger(page, trigger, { label: "P01", url: page.url(), outDir, viewport: "1280x800", socketMessagesBlocked: () => 0, seenSettings: new Set() });
      seen[id] = dialog.clipboard ? [dialog.clipboard.written, dialog.clipboard.refusedByBrowser, dialog.clipboard.nl] : null;
      await page.close();
    }
    assert.deepEqual(seen, {
      copy: [true, false, 'gekopieerd, 21 tekens, tekst "npm install voorbeeld"'],
      // Found by its title: the name of the button does not say that it copies.
      "copy-fake": [false, false, "niets naar het klembord geschreven"],
      // A button that reads the clipboard copies nothing, and is not asked whether it did.
      read: null,
    });
  } finally {
    await browser.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("timers names every timer in the state the session is in, also one that sending a form started, and judges it by the rule of 2.2.1", async () => {
  await loep("open", [`${site.origin}/limit-submit.html`]);
  await loep("type", [await ref("Naam"), "name"]);
  await loep("click", [await ref("Aanvraag versturen")]);
  const found = await loep("timers");
  const lines = found.timers as string[];
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines.find((line) => line.includes("600 s"))!, /^eenmalig \(setTimeout\) van 600 s, gestart [\d.]+ s na het laden: door loep laten afgaan nu; .*neemt tekst weg.*\. kan een tijdslimiet zijn: /);
  assert.match(lines.find((line) => line.includes("van 10 s"))!, /geen tijdslimiet/);
  assert.equal(found.conclusion, "1 timer die een tijdslimiet kan zijn");
  assert.match(String(found.note), /open de toestand opnieuw/);
  assert.equal(observation(found.id).command, "timers");
});
