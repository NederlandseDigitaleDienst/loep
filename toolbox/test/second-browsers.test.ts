import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { webkit } from "playwright";
import { launchBrowser } from "../src/browser/session.ts";
import { Daemon, runSteps, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { webkitInspector, webkitName } from "../src/session/opinions.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness } from "../src/session/safety.ts";
import { SecondBrowsers } from "../src/session/second.ts";
import type { Env, Surface } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

// WebKit and Firefox are slow to start; everything that needs them is in this file.
const NAVIGATION_DELAY_MS = 400;
const installed = SecondBrowsers.installed("webkit") && SecondBrowsers.installed("firefox");
let site: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-second-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: NAVIGATION_DELAY_MS });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

/** Politeness that keeps every address it was asked to wait for. */
class AskedPoliteness extends Politeness {
  readonly asked: string[] = [];

  override async before(url: string): Promise<void> {
    this.asked.push(url);
    await super.before(url);
  }
}

function raw(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Response> {
  return daemon.handle({ op: "command", session: "main", command, args: args.map(String), options });
}

async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await raw(command, args, options);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

function observation(id: string): Observation {
  const [session, nr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  return JSON.parse(readFileSync(join(run, "observations", session, `${nr}.json`), "utf8")) as Observation;
}

async function ref(query: string): Promise<number> {
  const found = await loep("find", [query]);
  const first = (found.found as string[])[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

const browserOf = (userAgent: string): string => (/Firefox\//.test(userAgent) ? "firefox" : /Chrome\//.test(userAgent) ? "chromium" : /AppleWebKit\//.test(userAgent) ? "webkit" : "other");

test("canary: the private way into WebKit's inspector still gives the accessibility properties of a node", async (context) => {
  if (!SecondBrowsers.installed("webkit")) return context.skip("WebKit is niet geïnstalleerd");
  // When this fails after an update of Playwright, the method "webkit" of `name` is gone; nothing else depends on it.
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${site.origin}/opinions.html`);
    assert.ok(webkitInspector(page), "page._connection.toImpl(page).delegate._session exists and can send");
    const surface = { page } as unknown as Surface;
    assert.deepEqual(await webkitName(surface, "#plain-button").then(({ role, name }) => ({ role, name })), { role: "button", name: "Gewone knop" });
    // An image button without alt is called "Submit" by WebKit, as by Chromium.
    assert.equal((await webkitName(surface, "#imgbtn")).name, "Submit");
    // Through a shadow root.
    assert.deepEqual(await webkitName(surface, "#inhoud > loep-defects >>> #shadow-noname").then(({ role, name }) => ({ role, name })), { role: "button", name: "" });
    const field = await webkitName(surface, "#zoek");
    assert.equal(field.name, "Zoekterm");
    await assert.rejects(webkitName(surface, "#bestaat-niet"), /niet teruggevonden/);
  } finally {
    await browser.close();
  }
});

test("name gets WebKit's own answer in the background; wait and the next call pick it up", async (context) => {
  if (!installed) return context.skip("WebKit of Firefox is niet geïnstalleerd");
  await loep("open", ["/opinions.html"]);
  const image = await ref("css:#imgbtn");
  const first = await loep("name", [image]);
  // The fast methods answer at once; WebKit has to start and load the page.
  assert.equal(first.methods, "5 disagree, 1 loopt nog");
  assert.deepEqual(first.pending, ["webkit"]);
  assert.deepEqual(observation(first.id).result && (observation(first.id).result as { pending: string[] }).pending, ["webkit"]);
  const waited = await loep("wait");
  const completed = (waited.completed as Record<string, { command: string; answers: string[]; methods: string }>)[first.id]!;
  assert.equal(completed.command, "name");
  assert.deepEqual(completed.answers, ['button "Submit" <- chromium, axe-name, playwright, webkit', 'button "Submit Query" <- alfa-aria, dom-accessibility-api']);
  assert.equal(completed.methods, "6 disagree");
  const record = observation(waited.id).result as { completed: { completes: string; result: { methods: { implementation: string; version: string; principle: string }[]; pending: string[] } }[] };
  assert.equal(record.completed[0]!.completes, first.id);
  const webkitMethod = record.completed[0]!.result.methods.at(-1)!;
  assert.equal(webkitMethod.implementation, "webkit");
  // The version is what the running browser says of itself, with the number of Playwright's build: also for the first measurement, which started the browser.
  const running = await webkit.launch();
  assert.equal(webkitMethod.version.split(" build ")[0], running.version());
  await running.close();
  assert.match(webkitMethod.version, /^\d+\.\d+ build \d+$/);
  assert.deepEqual(record.completed[0]!.result.pending, []);
  // Asked again, the answer is there without waiting; and `ax` takes it along because it is there.
  const again = await loep("name", [image]);
  assert.equal(again.methods, "6 disagree");
  assert.equal(again.pending, undefined);
  assert.equal((await loep("ax", [image])).names, "6 disagree");
  // `ax` on another element does not start WebKit by itself.
  assert.equal((await loep("ax", [await ref("css:#plain-button")])).names, "5 agree");
  // The page of WebKit stays open: a second element costs no new load.
  const loadsBefore = site.requests.filter((request) => request.path === "/opinions.html").length;
  const plain = await loep("name", [await ref("css:#plain-button")], { wait: true });
  assert.deepEqual(plain.answers, ['button "Gewone knop" <- chromium, alfa-aria, axe-name, playwright, dom-accessibility-api, webkit']);
  assert.equal(site.requests.filter((request) => request.path === "/opinions.html").length, loadsBefore);
});

test("taborder walks the same state in WebKit and Firefox", async (context) => {
  if (!installed) return context.skip("WebKit of Firefox is niet geïnstalleerd");
  await loep("open", ["/opinions.html"]);
  const order = await loep("taborder", [], { max: "40", wait: true });
  // The three browsers and the prediction give the same order, apart from what is known to differ between them.
  assert.equal(order.methods, "4 agree");
  // WebKit does not stop on a scrollable region without tabindex; Chromium and Firefox do. Known, named, no dissent.
  assert.ok((order.knownDifferences as string[]).some((line) => line.startsWith("webkit-tab tegenover chromium-tab: zonder #scroller; bekend verschil")), JSON.stringify(order.knownDifferences));
  assert.ok(!(order.knownDifferences as string[]).some((line) => line.startsWith("firefox-tab")), "Firefox stops where Chromium stops on this page");
  assert.deepEqual(order.notes, ["webkit-tab: WebKit slaat met Tab links en knoppen over; de wandeling gebruikt daarom Option+Tab"]);
  const result = observation(order.id).result as { methods: { implementation: string; version: string; result: { key?: string; stops: { where?: string }[] } }[] };
  assert.deepEqual(result.methods.map((method) => method.implementation), ["chromium", "tabbable", "webkit", "firefox"]);
  assert.equal(result.methods[2]!.result.key, "Alt+Tab");
  // Inside the frame, WebKit and Firefox reach the button too: the place is written through the frame.
  for (const method of result.methods.slice(2)) assert.ok(method.result.stops.some((stop) => stop.where === "#defect-frame | #frame-noname"), method.implementation);
  // The walk was a measurement: the next one finds the answers of the second browsers and does not walk them again.
  const loadsBefore = site.requests.filter((request) => request.path === "/opinions.html").length;
  const again = await loep("taborder", [], { max: "40" });
  assert.equal(again.methods, "4 agree");
  assert.equal(site.requests.filter((request) => request.path === "/opinions.html").length, loadsBefore);
});

test("reflow, zoom and spacing are measured in WebKit too, on one page of WebKit, and say per browser what was measured", async (context) => {
  if (!SecondBrowsers.installed("webkit")) return context.skip("WebKit is niet geïnstalleerd");
  site.requests.length = 0;
  await loep("open", ["/"]);
  const reflow = await loep("reflow", [], { wait: true });
  // The fixture has a block of 600 pixels: both browsers see the page scroll sideways at 320 pixels.
  assert.equal(reflow.methods, "2 agree", JSON.stringify(reflow));
  assert.deepEqual(reflow.browsers, { chromium: "schuift opzij (inhoud 640 px breed), 2 steekt uit, 1 afgekapt", webkit: "schuift opzij (inhoud 640 px breed), 2 steekt uit, 1 afgekapt" });
  assert.equal(reflow.disagree, undefined);
  const record = observation(reflow.id).result as { agreement: string; methods: { method: string; implementation: string; version: string; result: { viewport: unknown; horizontalScroll: boolean; image?: string; imageSha256?: string } }[] };
  assert.deepEqual(record.methods.map((method) => [method.method, method.implementation]), [["overflow-geometry", "loep"], ["overflow-geometry", "webkit"]]);
  assert.match(record.methods[1]!.version, /^\d+\.\d+ build \d+$/);
  assert.deepEqual(record.methods[1]!.result.viewport, { width: 320, height: 256 });
  // The picture of WebKit is kept next to that of Chromium, and its hash is in the answer.
  assert.equal(reflow.webkitImage, record.methods[1]!.result.image);
  const picture = readFileSync(join(run, reflow.webkitImage as string));
  assert.equal(createHash("sha256").update(picture).digest("hex"), record.methods[1]!.result.imageSha256);
  assert.notEqual(reflow.webkitImage, reflow.image);
  const zoom = await loep("zoom", [], { wait: true });
  assert.equal(zoom.methods, "2 agree", JSON.stringify(zoom));
  assert.deepEqual((observation(zoom.id).result as typeof record).methods[1]!.result.viewport, { width: 640, height: 400 });
  const spacing = await loep("spacing", [], { wait: true });
  assert.equal(spacing.methods, "2 agree", JSON.stringify(spacing));
  assert.deepEqual(spacing.browsers, { chromium: "schuift niet opzij, 0 afgekapt, 0 zonder de afstand", webkit: "schuift niet opzij, 0 afgekapt, 0 zonder de afstand" });
  assert.deepEqual((observation(spacing.id).result as typeof record).methods.map((method) => [method.method, method.implementation]), [["forced-text-spacing", "loep"], ["forced-text-spacing", "webkit"]]);
  // Three measurements, one load in WebKit: its page stays open and is put back after each of them.
  const loads = site.requests.filter((request) => request.path === "/").map((request) => browserOf(request.userAgent));
  assert.deepEqual(loads.sort(), ["chromium", "webkit"]);
  // Asked again, the answer of WebKit is there and nothing is measured twice in it.
  const again = await loep("reflow");
  assert.equal(again.methods, "2 agree");
  assert.equal(again.webkitImage, reflow.webkitImage);
  // A page where the browsers lay out differently: what differs is named per browser and is an open point, not a finding.
  await loep("open", ["/opinions.html"]);
  const other = await loep("reflow", [], { wait: true });
  assert.match(other.methods as string, /^2 (agree|disagree)$/);
  if (other.methods === "2 disagree") {
    assert.ok((other.disagree as string[]).every((line) => /^(opzij schuiven|steekt uit|afgekapt)/.test(line)), JSON.stringify(other.disagree));
    assert.match(other.note as string, /open punt en op zichzelf geen bevinding/);
    assert.equal((observation(other.id).result as typeof record).agreement, "disagree");
  }
});

test("without a second browser reflow answers as it did: one method, no word about WebKit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-single-"));
  const single = await Daemon.create(dir, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  try {
    assert.equal((await single.handle({ op: "start", session: "main" })).ok, true);
    await single.handle({ op: "command", session: "main", command: "open", args: ["/"], options: {} });
    const reflow = (await single.handle({ op: "command", session: "main", command: "reflow", args: [], options: {} })).print as Print;
    assert.equal(reflow.methods, "1 single");
    assert.equal(reflow.horizontalScroll, true);
    assert.equal(reflow.browsers, undefined);
    assert.equal(reflow.webkitImage, undefined);
    assert.equal(reflow.pending, undefined);
  } finally {
    await single.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the second browsers send no POST, no socket message and nothing outside the scope", async (context) => {
  if (!installed) return context.skip("WebKit of Firefox is niet geïnstalleerd");
  site.requests.length = 0;
  site.socketMessages.length = 0;
  const opened = await loep("open", ["/offscope.html"]);
  // The page embeds a frame from another host; Chromium refuses that already.
  assert.deepEqual(opened.blocked, [`scope: GET ${site.otherOrigin}/elsewhere.html`]);
  // A click that posts and sends over a socket becomes a step of the state: the second browsers have to repeat it.
  const clicked = await loep("click", [await ref("css:#post")]);
  assert.deepEqual(clicked.appeared, ["Aangeboden."]);
  assert.equal(observation(clicked.id).blocked.length, 2);
  const order = await loep("taborder", [], { wait: true });
  // The three browsers stop at the same places; the prediction leaves the frame out, which is a known difference.
  assert.equal(order.methods, "4 agree");
  assert.equal((order.stops as string[]).length, 3);
  assert.deepEqual((order.knownDifferences as string[]).map((line) => line.split(";")[0]), ["tabbable tegenover chromium-tab: zonder #inhoud > iframe"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  // All three browsers loaded the page, so all three ran the click.
  const loads = site.requests.filter((request) => request.path === "/offscope.html");
  assert.deepEqual(loads.map((request) => browserOf(request.userAgent)).sort(), ["chromium", "firefox", "webkit"]);
  assert.deepEqual(site.requests.filter((request) => request.method !== "GET"), [], "the server received nothing but GET");
  assert.deepEqual(site.socketMessages, [], "no message came in over a socket");
  assert.deepEqual(site.requests.filter((request) => request.host === "localhost"), [], "nothing reached the other host");
  // What the second browsers were refused is in the record of the session, next to what Chromium was refused.
  const next = await loep("status");
  const refused = [...observation(order.id).blocked, ...observation(next.id).blocked].map((entry) => `${entry.kind} ${entry.method}`);
  for (const kind of ["method POST", "socket SEND", "scope GET"]) assert.ok(refused.filter((entry) => entry === kind).length >= 2, `${kind}: ${refused.join(", ")}`);
});

test("a redirect out of the scope is refused in WebKit and Firefox before it is followed", async (context) => {
  if (!installed) return context.skip("WebKit of Firefox is niet geïnstalleerd");
  site.requests.length = 0;
  const chromium = await launchBrowser();
  const politeness = new AskedPoliteness(0);
  const env: Env = { browser: chromium, runDir: run, scope: { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, limits: { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 0 }, politeness };
  const second = new SecondBrowsers(env, runSteps);
  try {
    for (const name of ["webkit", "firefox"] as const) {
      const start = { url: `${site.origin}/redirect-out`, width: 1280, height: 800, scheme: "light" as const };
      await assert.rejects(second.use("s", name, { id: `redirect-${name}`, start, steps: [] }, async (surface) => surface.page.url()), name);
      const refused = second.takeRefused("s");
      assert.ok(refused.some((entry) => entry.kind === "scope" && entry.url.startsWith(`${site.otherOrigin}/elsewhere.html`)), `${name}: ${JSON.stringify(refused)}`);
      // Refused one step further, after a redirect inside the scope: that also fails, and at once.
      const started = performance.now();
      await assert.rejects(second.use("s", name, { id: `redirect-twice-${name}`, start: { ...start, url: `${site.origin}/redirect-twice` }, steps: [] }, async (surface) => surface.page.url()), name);
      assert.ok(performance.now() - started < 20_000, `${name} waited for a time limit`);
      second.takeRefused("s");
      // A page inside the scope opens, and a direct address outside it is not even asked for.
      assert.equal(await second.use("s", name, { id: `ok-${name}`, start: { ...start, url: `${site.origin}/form.html` }, steps: [] }, async (surface) => surface.page.title()), "Formulier - Testsite sessie");
      await assert.rejects(second.use("s", name, { id: `out-${name}`, start: { ...start, url: `${site.otherOrigin}/elsewhere.html` }, steps: [] }, async (surface) => surface.page.url()), /buiten de scope/);
    }
    assert.deepEqual(site.requests.filter((request) => request.host === "localhost"), [], "nothing reached the other host");
    assert.equal(site.requests.filter((request) => request.path === "/redirect-out").length, 4);
    // WebKit and Firefox wait for the same pause between navigations as Chromium: they ask the politeness of the process.
    assert.equal(politeness.asked.filter((url) => url === `${site.origin}/form.html`).length, 2);
  } finally {
    await second.close();
    await chromium.close();
  }
});
