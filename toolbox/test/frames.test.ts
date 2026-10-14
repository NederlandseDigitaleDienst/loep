import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";
import { call } from "../src/browser/call.ts";
import { frameAsPage } from "../src/browser/frame.ts";
import { INPAGE_PATH, loadSampled } from "../src/browser/session.ts";
import { pageContrast } from "../src/instruments/contrast.ts";
import { collectFacts } from "../src/instruments/facts.ts";
import { tabWalk } from "../src/instruments/keyboard.ts";
import { mediaReport } from "../src/instruments/media.ts";
import { targetSize } from "../src/instruments/target.ts";
import { collect } from "../src/commands/collect.ts";
import { checkSite, exploreContext } from "../src/commands/explore.ts";
import { sourceTexts } from "../src/commands/instrument-tasks.ts";
import { inventory } from "../src/commands/inventory.ts";
import type { SiteStates } from "../src/commands/modelsweep.ts";
import { sample } from "../src/commands/sample.ts";
import { states } from "../src/commands/states.ts";
import { legend, measuredWhereNl } from "../src/lib/extractors.ts";
import { loadRun } from "../src/lib/rundata.ts";
import type { SiteModel } from "../src/lib/sitemodel.ts";
import { indexObservations, validateJudgeVerdict, type Finding, type JudgeContext, type Verdict } from "../src/lib/verdict.ts";
import { Daemon, execute, type Recipe, type Response } from "../src/session/daemon.ts";
import { Images, type Observation } from "../src/session/observations.ts";
import { holds, replayFromClean } from "../src/session/recipe.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness } from "../src/session/safety.ts";
import { find, openSurface, type Env } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;

// The other origin is in scope, as it is in a run whose inventory found the frame: a frame from a host outside the scope does not load at all.
before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-frames-"));
  daemon = await Daemon.create(run, { hosts: ["127.0.0.1", "localhost"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 50, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
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

const observation = (id: string): Observation => JSON.parse(readFileSync(join(run, "observations", id.slice(0, id.lastIndexOf("-")), `${id.slice(id.lastIndexOf("-") + 1)}.json`), "utf8")) as Observation;

const OWN = 0;
const THIRD = 1;
const NESTED = 2;

/** The number of an element that stands in each of the three players, in the one asked for. */
async function ref(selector: string, frame: number): Promise<number> {
  const found = (await loep("find", [`css:${selector}`])).found as string[];
  assert.equal(found.length, 3, `${selector} stands in every player`);
  return Number(found[frame]!.split(" ")[0]);
}

const nonGet = (): string[] => site.requests.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.host}${request.path}`);
const thirdFrame = (): string[] => ["#third"];

test("look and find number the elements inside embedded frames, and say which frame", async () => {
  await loep("open", ["/embedded.html"]);
  const looked = await loep("look");
  const outline = looked.outline as string[];
  const own = outline.find((line) => line.includes("Iframe: Eigen speler"))!;
  const third = outline.find((line) => line.includes("Iframe: Speler van een dienst"))!;
  assert.match(own, new RegExp(`venster van ${site.origin}/player.html`));
  assert.match(third, new RegExp(`venster van ${site.otherOrigin}/player.html`));
  const inFrame = (line: string): string => `in venster ${line.split(" ")[0]}`;
  const buttons = outline.filter((line) => /button: Afspelen/.test(line));
  assert.equal(buttons.length, 2, "the play button of the two players in the window");
  assert.ok(buttons[0]!.includes(inFrame(own)) && buttons[1]!.includes(inFrame(third)));
  assert.match(buttons[1]!, /pressed=false/, "name and state come from the accessibility tree of the frame");
  const numbers = outline.map((line) => Number(line.split(" ")[0]));
  assert.equal(new Set(numbers).size, numbers.length, "a number points at one element, whichever document it is in");

  // The marks stand where the frame shows the element: on the button itself.
  const items = (observation(looked.id).result as { items: { ref: number; frame?: number; box: { x: number; y: number; width: number; height: number } }[] }).items;
  const mark = items.find((item) => item.ref === Number(buttons[1]!.split(" ")[0]))!;
  assert.equal(mark.frame, Number(third.split(" ")[0]));
  const picture = PNG.sync.read(readFileSync(join(run, looked.image as string)));
  const at = (picture.width * Math.round(mark.box.y + mark.box.height / 2) + Math.round(mark.box.x)) << 2;
  assert.deepEqual([...picture.data.subarray(at, at + 3)], [196, 0, 143], "the frame of the mark is drawn on the left edge of the button");

  const found = await loep("find", ["Verstuur"]);
  assert.equal(found.total, 3);
  assert.match((found.found as string[])[1]!, new RegExp(`\\[in venster: "Speler van een dienst" ${site.otherOrigin}\\]`));
  assert.match((found.found as string[])[2]!, /"Speler in het omhulsel"/, "also in a frame inside a frame");
});

test("every command that takes a number works on an element in a frame of another origin", async () => {
  await loep("open", ["/embedded.html"]);
  const play = await ref("#play", THIRD);

  const ax = await loep("ax", [play]);
  assert.equal(ax.role, "button");
  assert.equal(ax.name, "Afspelen");
  assert.equal((ax.states as { pressed: string }).pressed, "false");
  assert.deepEqual(ax.place, { frame: `"Speler van een dienst" ${site.otherOrigin}`, heading: "Speler", text: "Speel afx" });
  const record = observation(ax.id);
  assert.deepEqual(record.target?.path, ["#third", "#play"], "the chain goes from the tab into the frame");
  assert.deepEqual(record.target?.frame, { url: `${site.otherOrigin}/player.html`, origin: site.otherOrigin, title: "Speler van een dienst", path: ["#third"] });

  const clicked = await loep("click", [play]);
  assert.deepEqual(clicked.states, ["#play: aria-pressed=false -> aria-pressed=true"]);
  assert.deepEqual(clicked.appeared, ["De pagina hoort dat er iets speelt."], "what the action changed around the frame is seen too");
  assert.equal((await loep("ax", [play])).name, "Pauzeren");

  // A key goes to what has focus, and is read in the document that has it.
  const key = await loep("key", ["k"]);
  assert.deepEqual(key.states, ["#play: aria-pressed=true -> aria-pressed=false"]);

  const contrast = await loep("contrast", [play]);
  assert.deepEqual(observation(contrast.id).state.steps.at(-1), { command: "key", args: ["k"], options: {}, target: null }, "the key is a step like any other");
  const text = (contrast.text as { fg: string; bg: string; ratio: number; outcome: string }[])[0]!;
  assert.deepEqual([text.fg, text.bg, text.ratio, text.outcome], ["#9a9a9a", "#ffffff", 2.8, "failed"]);
  assert.equal((contrast.control as { outcome: string }).outcome, "duidelijk");

  const target = await loep("target", [await ref("#small", THIRD)]);
  assert.equal(target.size, "16x16");
  assert.equal(target.largeEnough, false);
  assert.match(target.tooCloseTo as string, /Speel af/);

  const focus = await loep("focus", [play]);
  assert.equal(focus.focusable, true);
  assert.equal(focus.focusVisible, true);
  assert.ok((focus.pixelShare as number) > 0, "the focus ring is seen in the picture of the frame");
  assert.ok(existsSync(join(run, focus.image as string)));

  assert.match((await loep("html", [play])).html as string, /^<button id="play"/);
  assert.deepEqual((await loep("style", [play, "color"])).style, { color: "rgb(154, 154, 154)" });
  const crop = await loep("crop", [play]);
  const cut = PNG.sync.read(readFileSync(join(run, crop.image as string)));
  assert.ok(cut.width > 80 && cut.width < 130 && cut.height > 30 && cut.height < 70, `the picture is the button with its margin, not the frame (${cut.width}x${cut.height})`);
  assert.match(((await loep("name", [play])).answers as string[])[0]!, /^button "Afspelen" <- chromium/);
  await loep("hover", [play]);
  const pressed = await loep("press", [play]);
  assert.equal(pressed.completesOnDown, false);
  assert.deepEqual((pressed.up as { states: string[] }).states, ["#play: aria-pressed=false -> aria-pressed=true"]);

  const rules = await loep("rules", [play]);
  assert.match(rules.filter as string, /element #play/);
  assert.match((rules.agree as string[]).join(), /1\.4\.3: failed/, "the rule engines ran in the document of the frame");

  const film = await ref("#film", THIRD);
  const media = await loep("media", [film]);
  assert.equal(media.elements, 1);
  assert.match((media.media as string[])[0]!, /^video #film: .*sporen: captions nl/);
  const listened = await loep("media", [film], { listen: true });
  assert.deepEqual(listened.tracks, ["captions nl: 1 cues"], "the track of the player is fetched from its own origin");
  assert.equal((observation(listened.id).result as { file: { url: string } }).file.url, `${site.otherOrigin}/tone.wav`);

  // The same in a frame inside a frame.
  const nested = await ref("#play", NESTED);
  await loep("click", [nested]);
  const inner = await loep("ax", [nested]);
  assert.equal(inner.name, "Pauzeren");
  assert.deepEqual(observation(inner.id).target?.path, ["#nest", "#inner", "#play"]);
  assert.equal((await loep("ax", [await ref("#play", OWN)])).name, "Afspelen", "the player of the site itself is another document with the same element");

  // Tab is followed into the frames.
  const stops = (await loep("tab", [2])).stops as string[];
  assert.ok(stops.every((stop) => stop.includes("[in venster: ")), stops.join(" | "));
});

test("a state with a step in a frame is recorded with the chain into the frame and plays again", async () => {
  await loep("open", ["/embedded.html"]);
  const play = await ref("#play", THIRD);
  await loep("click", [play]);
  const measured = await loep("ax", [play]);
  assert.equal(measured.name, "Pauzeren");
  const step = observation(measured.id).state.steps[0]!;
  assert.deepEqual(step.target, ["#third", "#play"]);
  assert.equal(step.locators?.name, "Afspelen", "what else finds the element is noted inside its frame");

  const replayed = await loep("replay", [measured.id]);
  assert.equal(replayed.verdict, "same");
  assert.equal(replayed.domSame, true, "the hash of the page covers what its frames hold");

  await loep("state", ["save", "speelt"]);
  const recipe = JSON.parse(readFileSync(join(run, "recipes", "speelt.json"), "utf8")) as Recipe;
  assert.deepEqual(recipe.steps.map((entry) => entry.target), [["#third", "#play"]]);
  await loep("open", [], { state: "speelt" });
  assert.equal((await loep("ax", [await ref("#play", THIRD)])).name, "Pauzeren", "the saved state is reached again from a fresh page");
  assert.equal((await loep("ax", [await ref("#play", OWN)])).name, "Afspelen");

  // A finding about the element passes the checks on a verdict: a measurement in a state that starts with open, and a place a reader finds.
  const records = new Map([measured.id].map((id) => [id, observation(id)]));
  const finding: Finding = { key: "F1", titleNl: "Afspeelknop meldt twee toestanden", observedNl: "De knop heet \"Pauzeren\" en meldt ook ingedrukt.", impactNl: "Wie een schermlezer gebruikt, weet niet of de video speelt.", fixNl: "Wissel de naam of de toestand, niet allebei.", severity: "midden", owner: "leverancier", component: null, locations: [{ page: "P01", where: "#third >>> #play", heading: "Speler", text: "Speel af" }], pagesAffected: "P01", evidence: [measured.id] };
  const verdict: Verdict = { criterion: "4.1.2", outcome: "failed", rule: "R1", summaryNl: "De afspeelknop in de speler meldt naam en toestand dubbel.", observations: [{ checkedNl: "De afspeelknop in de speler", howNl: "Naam en toestand gelezen uit de toegankelijkheidsboom", observedNl: "Pauzeren, ingedrukt", evidence: [measured.id], ruling: "finding", finding: "F1" }], findings: [finding] };
  const context: JudgeContext = { criterion: "4.1.2", evidenceNames: [], pageLabels: ["P01"], observations: indexObservations(records.values()), candidateIds: [], passCommands: [], decisiveCommands: [], sourceText: sourceTexts(run, records, { evidence: {}, legend: {} }) };
  assert.deepEqual(validateJudgeVerdict(verdict, context), []);
});

test("a recipe that operates inside a frame is replayed from a clean page, and its postcondition is checked in the frame", async () => {
  const recipe = JSON.parse(readFileSync(join(run, "recipes", "speelt.json"), "utf8")) as Recipe;
  const browser = await chromium.launch();
  try {
    const env: Env = { browser, runDir: run, scope: { hosts: ["127.0.0.1", "localhost"], baseUrl: `${site.origin}/`, strict: false }, politeness: new Politeness(50), limits: { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 50 } };
    const pressed = { kind: "visible", selector: "#play[aria-pressed=true]" } as const;
    const replay = await replayFromClean(env, recipe, { ...pressed, frame: `${site.otherOrigin}/player.html` });
    try {
      assert.deepEqual([replay.ok, replay.before?.holds, replay.after?.holds], [true, false, true], replay.reasonNl ?? "");
      const { page } = replay.surface!;
      assert.equal((await holds(page, pressed)).holds, false, "on the page around the frame there is no such button");
      assert.equal((await holds(page, { ...pressed, frame: `${site.origin}/player.html` })).holds, false, "nor in the player of the site itself, which was not touched");
      assert.match((await holds(page, { ...pressed, frame: "https://elders.example/venster" })).detail, /het venster https:\/\/elders\.example\/venster staat niet op de pagina/);
    } finally {
      await replay.surface?.context.close();
    }
  } finally {
    await browser.close();
  }
});

test("a form and a button in a frame of another origin write nothing, and the refusal is in the observation", async () => {
  site.requests.length = 0;
  await loep("open", ["/embedded.html"]);
  await loep("type", [await ref("#naam", THIRD), "name"]);
  const sent = await loep("click", [await ref("#stuur", THIRD)]);
  assert.deepEqual(sent.blocked, [`method: POST ${site.otherOrigin}/submit`]);
  const record = observation(sent.id);
  assert.deepEqual(record.blocked.map((entry) => [entry.kind, entry.method, entry.url, entry.resourceType]), [["method", "POST", `${site.otherOrigin}/submit`, "document"]]);
  assert.equal(record.writes, undefined, "nothing was let through");

  const told = await loep("click", [await ref("#meld", THIRD)]);
  assert.deepEqual(told.appeared, ["Melding aangeboden."]);
  assert.deepEqual(observation(told.id).blocked.map((entry) => `${entry.kind} ${entry.method} ${entry.url}`), [`method POST ${site.otherOrigin}/api/meld`]);

  // A link in the frame that the server sends on to a host outside the scope.
  const left = await loep("click", [await ref("#weg", THIRD)]);
  assert.match((left.blocked as string[])[0]!, /^scope: GET http:\/\/\[::1\]:\d+\/elsewhere\.html \(doorverwijzing vanaf/);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(nonGet(), [], "the server received nothing but GET");
  assert.deepEqual(site.requests.filter((request) => request.host === "[" || request.path === "/elsewhere.html"), [], "and nothing went to the host outside the scope");
});

test("a frame from a host outside the scope does not load, and look says its content cannot be read", async () => {
  const strictRun = mkdtempSync(join(tmpdir(), "loep-frames-scope-"));
  const narrow = await Daemon.create(strictRun, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 50, secondBrowsers: false });
  try {
    await narrow.handle({ op: "start", session: "main" });
    const opened = await narrow.handle({ op: "command", session: "main", command: "open", args: ["/embedded.html"] });
    assert.match((opened.print.blocked as string[]).join(), new RegExp(`scope: GET ${site.otherOrigin}/player.html`));
    const looked = await narrow.handle({ op: "command", session: "main", command: "look", args: [] });
    const outline = looked.print.outline as string[];
    assert.match(outline.find((line) => line.includes("Iframe: Speler van een dienst"))!, /inhoud van het venster niet te lezen/);
    assert.equal(outline.filter((line) => /button: Afspelen/.test(line)).length, 1, "only the player of the site itself");
  } finally {
    await narrow.close();
    rmSync(strictRun, { recursive: true, force: true });
  }
});

test("the same holds when the browser runs a frame of another site in a process of its own", async () => {
  const isolatedRun = mkdtempSync(join(tmpdir(), "loep-frames-oopif-"));
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ args: ["--site-per-process"] });
    const limits = { ...DEFAULT_DAEMON_LIMITS, navigationDelayMs: 50 };
    const env: Env = { browser, runDir: isolatedRun, scope: { hosts: ["127.0.0.1", "localhost"], baseUrl: `${site.origin}/`, strict: false }, politeness: new Politeness(50), limits };
    site.requests.length = 0;
    const { surface } = await openSurface(env, { url: `${site.origin}/embedded.html`, width: 1280, height: 800, scheme: "light" });
    try {
      const third = surface.page.frames().find((frame) => frame.url() === `${site.otherOrigin}/player.html` && frame.parentFrame() === surface.page.mainFrame())!;
      assert.ok(await surface.context.newCDPSession(third).then((session) => session.detach().then(() => true), () => false), "the frame has a session of its own: it runs in another process");
      const images = new Images(isolatedRun, "step");
      const element = async (selector: string) => (await find(surface, "css", selector, 5)).items.find((item) => item.frame?.path.join() === thirdFrame().join())!;
      const ax = (await execute({ env, surface, images, target: await element("#play") }, "ax", [], {})).print as { name: string };
      assert.equal(ax.name, "Afspelen");
      await execute({ env, surface, images, target: await element("#stuur") }, "click", [], {});
      await execute({ env, surface, images, target: await element("#meld") }, "click", [], {});
      // With Enter, not with the pointer: in a process of its own Playwright places the pointer without the border and padding of the frame element.
      await third.focus("#weg");
      await execute({ env, surface, images, target: null }, "key", ["Enter"], {});
      await surface.page.waitForTimeout(300);
      assert.deepEqual(surface.guard.blocked.map((entry) => `${entry.kind} ${entry.method} ${entry.url.split(" ")[0]}`), [`method POST ${site.otherOrigin}/submit`, `method POST ${site.otherOrigin}/api/meld`, `scope GET ${site.otherOrigin.replace("localhost", "[::1]")}/elsewhere.html`]);
      assert.deepEqual(nonGet(), []);
      assert.deepEqual(site.requests.filter((request) => request.path === "/elsewhere.html"), []);
    } finally {
      await surface.context.close();
    }
  } finally {
    await browser?.close();
    rmSync(isolatedRun, { recursive: true, force: true });
  }
});

test("the sweep measures an embedded window where it stands, with the instruments it measures a page with", async () => {
  const browser = await chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), "loep-frames-sweep-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ path: INPAGE_PATH });
    const item = { url: `${site.otherOrigin}/player.html`, embeddedOn: [`${site.origin}/embedded.html`] };
    let settled = 0;
    const { page, placement } = await loadSampled(await context.newPage(), item, async () => void settled++);
    assert.deepEqual(placement, { inPlaceOn: `${site.origin}/embedded.html`, apartNl: null });
    assert.equal(settled, 1, "what covers the page is closed on the page around the frame");
    assert.equal(page.url(), item.url);

    // What assistive technology gets, from the accessibility tree of the frame.
    const facts = (await collectFacts(page)) as unknown as { title: string; controls: { ax: { role: string | null; name: string | null } | null }[] };
    assert.equal(facts.title, "Speler");
    assert.deepEqual(facts.controls.slice(0, 2).map((control) => [control.ax?.role, control.ax?.name]), [["button", "Afspelen"], ["button", "Geluid uit"]]);
    // Contrast: measured on the picture of what the frame shows; text outside that picture says so.
    const contrast = await pageContrast(page);
    const text = (wanted: string) => contrast.measurements.find((entry) => entry.text === wanted)!;
    assert.deepEqual([text("Speel af").ratio, text("Speel af").outcome], [2.8, "failed"]);
    assert.deepEqual([text("Knop onderaan").outcome, text("Knop onderaan").reason], ["cantTell", "de tekst valt buiten de schermafbeelding"]);
    // Target size.
    const targets = await call<{ text: string; width: number; height: number }[]>(page, "targetSizes");
    assert.deepEqual(targets.filter((target) => target.text === "x").map((target) => [target.width, target.height]), [[16, 16]]);
    // Media: the tracks of the player.
    const media = await mediaReport(page, { waitMs: 200 });
    assert.deepEqual(media.elements.map((element) => [element.tag, element.textTracks.map((track) => `${track.kind} ${track.language}`).join()]), [["video", "captions nl"]]);

    // The Tab walk, on a fresh page as the sweep does it: it walks into the frame, through it, and ends when focus leaves it.
    const walked = await loadSampled(await context.newPage(), item);
    const walk = (await tabWalk(walked.page, { continueAfterFocusLoss: true, focusDir: join(dir, "focus"), focusPath: "focus" })) as { outcome: string; stops: { text: string; focusPixelShare: number | null }[] };
    assert.equal(walk.outcome, "completed");
    assert.deepEqual(walk.stops.map((stop) => stop.text), ["Speel af", "x", "", "Verstuur", "Meld iets", "Verder bij een ander", "Knop onderaan"]);
    assert.ok(walk.stops.every((stop) => (stop.focusPixelShare ?? 0) > 0), "the focus indicator of each stop is seen in the picture of the frame");

    // A window that is not on the page it was found on is opened on its own, and that is said.
    const apart = await loadSampled(await context.newPage(), { url: item.url, embeddedOn: [`${site.origin}/form.html`] });
    assert.equal(apart.placement?.inPlaceOn, null);
    assert.match(apart.placement!.apartNl!, /stond bij het meten geen venster met dit adres/);
    assert.equal(apart.page.url(), item.url);
    assert.equal((await loadSampled(await context.newPage(), { url: `${site.origin}/form.html` })).placement, null, "a page of the site is a page");
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an instrument that takes a page measures inside a frame when it is given the frame as a page", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ path: new URL("../src/browser/inpage.js", import.meta.url).pathname });
    const page = await context.newPage();
    await page.goto(`${site.origin}/embedded.html`);
    const frame = page.frames().find((entry) => entry.url() === `${site.otherOrigin}/player.html`)!;
    const view = await frameAsPage(page, frame);
    assert.equal(view.url(), `${site.otherOrigin}/player.html`);
    assert.deepEqual(view.viewportSize(), { width: 420, height: 230 });
    assert.equal((await targetSize(view, ["#small"]))?.largeEnough, false);
    // A picture of the frame is what the frame shows, cut out of the tab where the frame stands: border and padding are not part of it.
    const picture = PNG.sync.read(await view.screenshot());
    assert.deepEqual([picture.width, picture.height], [420, 230]);
    assert.deepEqual([...picture.data.subarray(0, 3)], [255, 255, 255]);
    // A part of the document of the frame that its window does not show is scrolled into it, and the page is put back.
    const below = await frame.evaluate(() => {
      const rect = document.getElementById("below")!.getBoundingClientRect();
      return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    });
    const part = PNG.sync.read(await view.screenshot({ fullPage: true, clip: below }));
    assert.deepEqual([part.width, part.height], [Math.round(below.width), Math.round(below.height)]);
    assert.deepEqual(await frame.evaluate(() => [window.scrollX, window.scrollY]), [0, 0]);
    assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), [0, 0]);
  } finally {
    await browser.close();
  }
});

test("the probes and the capture of a state work inside a window that counts, on the page it stands on", { timeout: 600_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-frames-states-"));
  const page = `${site.origin}/embedded.html`;
  const player = `${site.origin}/player.html`;
  try {
    const found = await inventory({ baseUrl: page, out: dir, maxPages: 6 });
    const context = exploreContext(found);
    // The explorer: the play button in the player of the site itself, pressed inside its frame.
    const explorer = await Daemon.create(dir, { hosts: ["127.0.0.1", "localhost"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 20, secondBrowsers: false });
    try {
      const act = async (command: string, args: string[] = []): Promise<Record<string, unknown>> => {
        const response = await explorer.handle({ op: "command", session: "verken", command, args });
        assert.equal(response.ok, true, `${command}: ${JSON.stringify(response.print)}`);
        return response.print;
      };
      await explorer.handle({ op: "start", session: "verken" });
      await act("open", ["/embedded.html"]);
      const plays = (await act("find", ["css:#play"])).found as string[];
      await act("click", [plays[OWN]!.split(" ")[0]!]);
      await act("state", ["save", "component-speler"]);
    } finally {
      await explorer.close();
    }
    const types = context.proposedPageTypes.map((type, index) => ({ ...type, id: `type-${index + 1}`, descriptionNl: `Paginatype ${index + 1}` }));
    const around = types.filter((type) => type.pages.includes(page)).map((type) => type.id);
    const notOperated = { viewport: null, recipe: null, postcondition: null, notOpenedNl: "Voor deze proef niet bediend; de reden staat hier." };
    const model = {
      version: 1,
      baseUrl: `${site.origin}/`,
      descriptionNl: `${Array.from({ length: 45 }, (_, index) => `woord${index}`).join(" ")}.`,
      pageTypes: types,
      blockers: [],
      components: [
        { id: "knop", type: "other", descriptionNl: "Knop op de pagina", pageTypes: around, ...notOperated },
        { id: "speler", type: "player", descriptionNl: "Eigen speler in een venster", pageTypes: around, viewport: null, frame: player, recipe: "component-speler", postcondition: { kind: "visible", selector: "#play[aria-pressed=true]", frame: player } },
        ...context.frames.filter((frame) => frame.address !== player).map((frame, index) => ({ id: `venster-${index + 1}`, type: "player", descriptionNl: "Speler van een dienst", pageTypes: around, frame: frame.address, ...notOperated })),
      ],
      processes: [],
      frames: context.frames.map((frame) => ({ address: frame.address, class: "own-content", descriptionNl: "Speler", reasonNl: "Eigen inhoud in een gekozen speler." })),
      notesNl: [],
    } as unknown as SiteModel;
    writeFileSync(join(dir, "site.json"), JSON.stringify(model, null, 2));
    const checked = await checkSite(dir, { navigationDelayMs: 20 });
    assert.deepEqual(checked.problems, []);
    const chosen = await sample(dir, "seed");
    assert.deepEqual(chosen.items.find((item) => item.url === player)?.embeddedOn, [page]);

    await collect({ run: dir });
    // The state is measured inside the window: the picture is what the window shows, the facts are those of its document.
    const captured = (JSON.parse(readFileSync(join(dir, "site-states.json"), "utf8")) as SiteStates).states.find((state) => state.id === "component-speler")!;
    assert.equal(captured.reached, true, captured.reasonNl ?? "");
    assert.deepEqual(captured.frame, { address: player, measuredInFrame: true, reasonNl: null });
    assert.equal(captured.url, page, "the state is still opened on the page the window stands on");
    assert.equal(captured.stillReachedAfterMeasuring, true);
    const picture = PNG.sync.read(readFileSync(join(dir, captured.files.screenshot!)));
    assert.deepEqual([picture.width, picture.height], [420, 230]);
    const facts = JSON.parse(readFileSync(join(dir, captured.files.facts!), "utf8")) as { title: string; controls: { ax: { name: string | null } | null }[] };
    assert.equal(facts.title, "Speler");
    assert.equal(facts.controls[0]!.ax?.name, "Pauzeren", "the button as it is in this state, read inside the window");
    const contrast = JSON.parse(readFileSync(join(dir, captured.files.contrast!), "utf8")) as { measurements: { text: string; ratio: number | null }[] };
    assert.equal(contrast.measurements.find((entry) => entry.text === "Speel af")?.ratio, 2.8);
    assert.ok(captured.files.contrastDark && captured.files.textSpacing, "opened again for the dark scheme and the wider spacing, in the window as well");

    const result = await states(dir);
    const data = await loadRun(dir);
    const label = data.pages.find((entry) => entry.item.url === player)!.label;
    // Every probe reached the window where it stands; nothing was opened on its own and nothing failed.
    assert.deepEqual(result.embedded!.find((entry) => entry.page === label), { page: label, url: player, inPlaceOn: page, apartNl: null, failedNl: [] });
    assert.ok(result.embedded!.every((entry) => entry.inPlaceOn === page && entry.failedNl.length === 0), JSON.stringify(result.embedded));
    assert.deepEqual(result.skipped, []);
    // The form in the window was submitted there: the picture of the attempt is the window, not a tab of its own.
    const form = result.formErrors.find((entry) => entry.page === label)!;
    assert.equal(form.form, "#reactie");
    assert.deepEqual(form.attempts.map((attempt) => [attempt.submitted, attempt.requestBlocked]), [[true, true], [true, true]]);
    const attempt = PNG.sync.read(readFileSync(join(dir, form.attempts[0]!.screenshot!)));
    assert.deepEqual([attempt.width, attempt.height], [420, 230]);
    // The buttons were tried and the single keys pressed inside the window.
    assert.deepEqual(result.dialogs.filter((entry) => entry.page === label).map((entry) => entry.trigger).sort(), ["Knop onderaan", "Meld iets", "Speel af", "x"]);
    assert.deepEqual(result.singleKeys.reactions.filter((entry) => entry.page === label).map((entry) => [entry.key, entry.change]), [["k", "toestand gewijzigd: #play: aria-pressed=false -> aria-pressed=true"]]);
    assert.ok(result.examined.hoverTargets > 0);
    assert.deepEqual(site.requests.filter((request) => request.method !== "GET").map((request) => request.path), [], "nothing was written");
    // The dossier says where the probes were done.
    const row = (legend(data, "2.1.1") as Record<string, { measured?: string; states?: { state: string; frame?: string }[] }>);
    assert.match(row[label]!.measured!, /De proeven met formulieren, knoppen, losse toetsen, aanwijzen en indrukken zijn ook daar gedaan, binnen het venster$/);
    const onPage = data.pages.find((entry) => entry.item.url === page)!.label;
    assert.equal(row[onPage]!.states!.find((state) => state.state === "component-speler")!.frame, `gemeten in het ingesloten venster ${player}, op de pagina waar het staat`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the dossier says which probe did not work inside a window, and when the window was opened on its own", () => {
  const placed = { inPlaceOn: "https://site.nl/pagina", apartNl: null };
  const names = "De proeven met formulieren, knoppen, losse toetsen, aanwijzen en indrukken";
  // A run from before the probes went into a window.
  assert.ok(measuredWhereNl(placed).endsWith(`${names} openden het venster los`));
  assert.ok(measuredWhereNl(placed, { page: "P3", url: "https://site.nl/venster", ...placed, failedNl: [] }).endsWith(`${names} zijn ook daar gedaan, binnen het venster`));
  assert.ok(measuredWhereNl(placed, { page: "P3", url: "https://site.nl/venster", ...placed, failedNl: ["aanwijzen: het ingesloten venster is niet zichtbaar op de pagina"] }).endsWith("binnen het venster. Niet gelukt binnen het venster en daar niet onderzocht: aanwijzen: het ingesloten venster is niet zichtbaar op de pagina"));
  assert.ok(measuredWhereNl(placed, { page: "P3", url: "https://site.nl/venster", inPlaceOn: null, apartNl: "het venster op https://site.nl/pagina was niet te lezen", failedNl: [] }).endsWith(`${names} openden het venster los: het venster op https://site.nl/pagina was niet te lezen`));
});
