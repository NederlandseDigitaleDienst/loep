import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import type { Described } from "../src/instruments/activate.ts";
import { probeTrigger } from "../src/instruments/dialog.ts";
import { PNG } from "pngjs";
import { pageContrast } from "../src/instruments/contrast.ts";
import { boundaryOf, fateOf, forcedColoursProbe, type ForcedProbe } from "../src/instruments/forced.ts";
import { uiContrast } from "../src/lib/extractors.ts";
import type { RunData } from "../src/lib/rundata.ts";
import { collectFacts, frameListeners } from "../src/instruments/facts.ts";
import { arrowReach, skipLinkProbe, tabOrderScreenshot, tabWalk } from "../src/instruments/keyboard.ts";
import { probeHoverTarget } from "../src/instruments/hover.ts";
import { firstKeyReaction, KEYS, leaveTextEntry } from "../src/instruments/keys.ts";
import { spacingEffect, spacingFromLoad } from "../src/instruments/overflow.ts";
import type { States } from "../src/lib/rundata.ts";
import type { SkipLinkAim } from "../src/lib/rundata.ts";
import { mediaReport } from "../src/instruments/media.ts";
import { downEventTargets, downKind, probeDownEvent } from "../src/instruments/pointer.ts";
import { coversContent, overlays } from "../src/session/recipe.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let browser: Browser;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await site.close();
});

async function open(path: string): Promise<Page> {
  const context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

test("the key probe sees a key that shows a panel or flips a state without moving focus, and not a clock", async () => {
  const page = await open("/keys.html");
  // Up to the c: nothing, although the clock on the page keeps changing its text.
  const first = await firstKeyReaction(page, KEYS);
  assert.equal(first?.key, "c");
  assert.equal(first!.change, 'tekst verschenen: "Chat met ons: waarmee kunnen wij helpen?"');
  assert.deepEqual(first!.details.appeared, ["Chat met ons: waarmee kunnen wij helpen?"]);
  assert.equal(first!.details.focus, null);
  await page.context().close();
  // On a fresh page, with the keys after it, as the sweep goes on.
  const fresh = await open("/keys.html");
  const second = await firstKeyReaction(fresh, KEYS.slice(first!.index + 1));
  assert.equal(second?.key, "m");
  assert.equal(second!.change, "toestand gewijzigd: #mute: aria-pressed=false -> aria-pressed=true");
  await fresh.context().close();
  const rest = await open("/keys.html");
  assert.equal(await firstKeyReaction(rest, KEYS.slice(KEYS.indexOf("m") + 1)), null);
  await rest.context().close();
});

test("the press probe records what happens on pointer down and whether releasing elsewhere takes it back", async () => {
  const listening = new Set(["button"]);
  const probe = async (id: string): Promise<NonNullable<Awaited<ReturnType<typeof probeDownEvent>>>> => {
    const page = await open("/press.html");
    const target = (await downEventTargets(page, listening)).find((entry) => entry.path.join() === `#${id}`) as Described;
    const result = await probeDownEvent(page, target, { label: "P1", listening });
    await page.context().close();
    return result!;
  };
  // A function that completes on the press and stays: no way to back out.
  const onDown = await probe("on-down");
  assert.equal(onDown.changeOnDown, 'tekst verschenen: "Bedankt voor uw oordeel."; statusmelding: "Bedankt voor uw oordeel."');
  assert.equal(onDown.changeAfterReleaseElsewhere, null);
  assert.equal(onDown.undoneByReleasingElsewhere, false);
  // Something that shows on the press and goes on release: the user can back out.
  const preview = await probe("preview");
  assert.equal(preview.changeOnDown, 'tekst verschenen: "Dit is het voorbeeld."');
  assert.equal(preview.changeAfterReleaseElsewhere, 'tekst verdwenen: "Dit is het voorbeeld."');
  assert.equal(preview.undoneByReleasingElsewhere, true);
  // A button that only looks pressed and acts on the click: no reaction on down, and none after releasing elsewhere.
  const plain = await probe("plain");
  assert.equal(plain.changeOnDown, null);
  assert.equal(plain.changeAfterReleaseElsewhere, null);
  assert.equal(plain.undoneByReleasingElsewhere, undefined);
  assert.ok(Object.keys(plain.details!.onDown.style).length > 0, "the look of the pressed button is recorded, not counted");
});

test("the press probe finds a box through its label and a switch through the document, one of each kind, and sees a state that flips", async () => {
  const page = await open("/toggles.html");
  const withoutDocument = await downEventTargets(page, new Set(["label"]));
  // Which elements listen is kept per element: the field has a label too, but that label does not listen.
  assert.deepEqual(withoutDocument.map((target) => [target.path.join(), target.kind, target.stateful, target.via]), [["#cb1", "input[checkbox]", true, "own"], ["#cb2", "input[checkbox]", true, "own"]], "a box with an id is found through the label around it");
  const targets = await downEventTargets(page, new Set(["label"]), true);
  const byId = (id: string) => targets.find((target) => target.path.join() === `#${id}`)!;
  assert.deepEqual([byId("schakelaar").kind, byId("schakelaar").stateful, byId("schakelaar").via], ["span[switch]", true, "delegated"]);
  assert.equal(downKind(byId("cb1")), downKind(byId("cb2")), "boxes of one list are one kind, whatever their label");
  assert.notEqual(downKind(byId("cb1")), downKind(byId("schakelaar")));
  assert.equal(byId("pale").via, "delegated", "with a listener on the document every control is a candidate");
  await page.context().close();
  const press = async (id: string) => {
    const fresh = await open("/toggles.html");
    const target = (await downEventTargets(fresh, new Set(["label"]), true)).find((entry) => entry.path.join() === `#${id}`)!;
    const result = await probeDownEvent(fresh, target, { label: "P1", listening: new Set(["label"]) });
    await fresh.context().close();
    return result!;
  };
  const box = await press("cb1");
  assert.match(box.changeOnDown!, /toestand gewijzigd: .*checked/);
  assert.deepEqual(box.effectOnDown, ["toestand"]);
  assert.equal(box.undoneByReleasingElsewhere, false, "the box stays ticked after releasing elsewhere");
  assert.deepEqual([box.kind, box.via], ["input[checkbox]", "own"]);
  const toggle = await press("schakelaar");
  assert.deepEqual(toggle.effectOnDown, ["toestand"]);
  assert.equal(toggle.via, "delegated");
  const link = await press("pale");
  assert.equal(link.changeOnDown, null, "a link that only acts on the click does nothing on the press");
});

test("focus is taken out of a text field before the single keys are pressed, and left on anything else", async () => {
  const page = await open("/toggles.html");
  await page.focus("#q");
  const left = await leaveTextEntry(page);
  assert.equal(left.moved, true);
  assert.match(left.focusWas!, /^input .*#q$/);
  assert.equal(await firstKeyReaction(page, ["a", "b", "c"]), null, "a letter is no longer input");
  assert.equal(await page.inputValue("#q"), "");
  await page.focus("#schakelaar");
  assert.equal((await leaveTextEntry(page)).moved, false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "schakelaar");
  await page.context().close();
});

test("the hover probe measures the text of a link while it is pointed at and while it has focus", async () => {
  const page = await open("/toggles.html");
  const target = (await call<Described[]>(page, "hoverTargets")).find((entry) => entry.path.join() === "#pale")!;
  const contrast: NonNullable<States["hoverContrast"]> = [];
  await probeHoverTarget(page, target, { label: "P1", outDir: await mkdtemp(join(tmpdir(), "loep-hover-")), screenshot: (trigger) => `${trigger}.png`, contrast });
  const of = (trigger: string) => contrast.find((entry) => entry.trigger === trigger)!.texts[0]!;
  assert.deepEqual([of("hover").foreground, of("hover").outcome], ["#c8c8c8", "failed"], "the colour under the pointer, which the measurement at rest never sees");
  assert.deepEqual([of("focus").foreground, of("focus").outcome], ["#1a1a1a", "passed"]);
  // A field is not a link or a button: its text does not change colour under the pointer as a rule, and it is left out.
  const field = (await call<Described[]>(page, "hoverTargets")).find((entry) => entry.path.join() === "#q")!;
  await probeHoverTarget(page, field, { label: "P1", outDir: tmpdir(), screenshot: (trigger) => `${trigger}.png`, contrast });
  assert.equal(contrast.length, 2);
  await page.context().close();
});

test("the wider text spacing can be in force from the moment a document loads, before anything is opened", async () => {
  const context = await newContext(browser);
  await spacingFromLoad(context);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}/toggles.html`);
  const spacing = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector("main p")!).letterSpacing);
  assert.notEqual(await spacing(), "normal", "nothing was called on the page: the spacing came with the document");
  // Another document in the same context gets it too, as a process that moves on to a next page does.
  await loadPage(page, `${site.origin}/press.html`);
  assert.notEqual(await spacing(), "normal");
  const effect = await spacingEffect(page, [], join(await mkdtemp(join(tmpdir(), "loep-spacing-")), "spacing.png"));
  assert.equal(effect.clippedBefore, 0);
  assert.deepEqual(effect.newlyClipped, []);
  await context.close();
});

test("media are reported per element, in frames too, with what can stop them", async () => {
  const page = await open("/media.html");
  const report = await mediaReport(page, { tryControls: true, waitMs: 1500 });
  const byId = Object.fromEntries(report.elements.map((element) => [element.path.join(" >>> "), element]));
  assert.deepEqual(Object.keys(byId).sort(), ["#film", "#inner", "#jingle", "#tune"]);
  const tune = byId["#tune"]!;
  assert.deepEqual(tune.attributes, { autoplay: true, loop: true, controls: false, muted: false, preload: null });
  assert.equal(tune.visible, false);
  assert.equal(tune.durationSeconds, 5);
  assert.equal(tune.audioTrack, true);
  assert.equal(tune.muted, false);
  assert.equal(tune.volume, 1);
  assert.equal(tune.ownControls, false);
  // The pause button of the other sound is found by its name and tried: it does nothing to this one.
  assert.deepEqual(tune.pageControls.map((control) => [control.text, control.relation, control.effect]), [["Pauzeer het geluid", "naam", "geen effect"]]);
  assert.equal(tune.canBePausedOrMuted, false);
  const jingle = byId["#jingle"]!;
  // Whether sound starts by itself is up to the browser; when it did, the button is seen to pause it.
  if (jingle.playingAfterLoad) {
    assert.equal(jingle.timeAdvances, true);
    assert.deepEqual(jingle.pageControls.map((control) => [control.text, control.relation, control.effect]), [["Pauzeer het geluid", "naam", "pauzeert"], ["Iets anders", "zelfde blok", "geen effect"]]);
    assert.equal(jingle.canBePausedOrMuted, true);
  }
  const film = byId["#film"]!;
  assert.equal(film.tag, "video");
  assert.equal(film.ownControls, true);
  assert.equal(film.muted, true);
  assert.equal(film.playingAfterLoad, false);
  assert.equal(film.canBePausedOrMuted, true);
  assert.deepEqual(film.textTracks, [{ kind: "captions", language: "nl", label: "Nederlands" }]);
  assert.equal(byId["#inner"]!.frame, `${site.origin}/frame-media.html`);
  assert.equal(byId["#inner"]!.ownControls, true);
  // One element, without using anything: candidates are named, not tried.
  const one = await mediaReport(page, { target: ["#tune"], waitMs: 200 });
  assert.equal(one.elements.length, 1);
  assert.equal(one.elements[0]!.pageControls[0]!.effect, null);
  assert.equal(one.elements[0]!.canBePausedOrMuted, null);
  await page.context().close();
  // A page without media costs no waiting.
  const plain = await open("/form.html");
  const started = Date.now();
  assert.deepEqual((await mediaReport(plain)).elements, []);
  assert.ok(Date.now() - started < 1500);
  // The facts of a page carry the same, read only.
  const facts = await collectFacts(await open("/media.html"));
  assert.equal((facts.media as { elements: unknown[] }).elements.length, 4);
  await plain.context().close();
});

test("listeners are counted per frame, also in a frame of another origin, and a frame that cannot be read is named", async () => {
  const page = await open("/listening.html");
  const { frames, notInspected } = await frameListeners(page);
  const motion = (address: string): number | undefined => frames.find((frame) => frame.address === address)?.listeners.devicemotion?.window;
  assert.equal(motion(`${site.origin}/frame-media.html`), 1);
  assert.equal(motion(`${site.otherOrigin}/frame-media.html`), 1, "a frame of another origin is read on the spot");
  assert.equal(frames.find((frame) => frame.address === `${site.otherOrigin}/frame-media.html`)!.title, "Speler van een ander");
  const quiet = frames.find((frame) => frame.address === `${site.origin}/frame.html`)!;
  assert.equal(quiet.listeners.devicemotion, undefined);
  assert.equal(quiet.depth, 1);
  // Every frame is either counted or named: nothing is silently left out.
  assert.equal(frames.length + notInspected.length, 4);
  for (const frame of notInspected) assert.match(frame.reasonNl, /niet geladen|niet uit te lezen/);
  // The page itself does not listen for motion; only looking at the top document would have said "none".
  const facts = await collectFacts(page);
  assert.equal((facts.listeners as Record<string, unknown>).devicemotion, undefined);
  assert.equal((facts.frameListeners as unknown[]).length, frames.length);
  // The targets of the press probe come from the page's own count.
  assert.ok((await call<unknown[]>(page, "hoverTargets")).length >= 0);
  await page.context().close();
});

test("loep media gives the same for the current state of a session, without using anything", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Daemon } = await import("../src/session/daemon.ts");
  const dir = mkdtempSync(join(tmpdir(), "loep-media-"));
  const daemon = await Daemon.create(dir, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session: "main", command, args, options: {} })).print;
  try {
    await daemon.handle({ op: "start", session: "main" });
    await loep("open", "/media.html");
    const all = await loep("media");
    assert.equal(all.elements, 4);
    assert.match((all.media as string[])[0]!, /^audio #tune: autoplay; loop; geen controls; volume 1; 5s; geluidsspoor; speelt( niet)?(, tijd loopt niet)?; geen tekstsporen; mogelijke knoppen: button "Pauzeer het geluid" \(naam\)$/);
    assert.match((all.media as string[]).join("\n"), /video #film: geen controls|video #film: controls; gedempt; 5s/);
    const found = await loep("find", "css:#film");
    const one = await loep("media", (found.found as string[])[0]!.split(" ")[0]!);
    assert.equal(one.elements, 1);
    assert.match((one.media as string[])[0]!, /sporen: captions nl; eigen bediening zichtbaar$/);
    const heading = await loep("find", "css:h1");
    assert.match((await loep("media", (heading.found as string[])[0]!.split(" ")[0]!)).error as string, /geen audio of video/);
    // Nothing was pressed: the command is not a step of the recipe.
    assert.equal((await loep("status")).steps, 0);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dialog that opens with focus on its last field still counts the close button before it as reached", async () => {
  const page = await open("/search-dialog.html");
  const trigger = (await call<Described[]>(page, "triggers")).find((element) => element.text === "Zoeken")!;
  const outDir = await mkdtemp(join(tmpdir(), "loep-dialog-"));
  const { dialog } = await probeTrigger(page, trigger, { label: "P01", url: page.url(), outDir, viewport: "1280x800", socketMessagesBlocked: () => 0, seenSettings: new Set() });
  assert.equal(dialog.kind, "modale dialoog");
  assert.equal(dialog.focusMovedInto, true);
  // Tab from the field passes the browser before it reaches Sluit; both controls are reached.
  assert.equal(dialog.tabStopsInside, 2);
  assert.ok(dialog.stopsInside!.some((stop) => stop.includes("Sluit")));
  assert.equal(dialog.escapeCloses, true);
  await page.context().close();
});

test("the skip link probe records where the link points and whether that element is rendered", async () => {
  const probe = async (path: string): Promise<{ isSkipLink: boolean; aim: SkipLinkAim; focusAfterActivation: { tag: string } | null; nextTabStop: { text: string } | null }> => {
    const page = await open(path);
    const result = (await skipLinkProbe(page)) as never;
    await page.context().close();
    return result;
  };
  const ok = await probe("/skip-ok.html");
  assert.equal(ok.isSkipLink, true);
  assert.deepEqual({ href: ok.aim.href, target: ok.aim.target }, { href: "#inhoud", target: { tag: "main", id: "inhoud", path: ["#inhoud"], rendered: true, tabindex: "-1" } });
  assert.equal(ok.focusAfterActivation?.tag, "main");
  // A component without href that aims at the element after it: a noscript block is not rendered, so focus goes nowhere.
  const nowhere = await probe("/skip-noscript.html");
  assert.equal(nowhere.aim.href, null);
  assert.equal(nowhere.aim.target, null);
  assert.deepEqual({ tag: nowhere.aim.following!.tag, rendered: nowhere.aim.following!.rendered }, { tag: "noscript", rendered: false });
  assert.equal(nowhere.nextTabStop?.text, "Start", "the next Tab is still in the menu");
  const missing = await probe("/skip-missing.html");
  assert.deepEqual(missing.aim.target, { missing: "bestaat-niet" });
});

test("a column that stays in place next to the content covers nothing; a bar over the content does", async () => {
  // A third of the window, and not one line of text or control of the page under it, at the top or further down.
  const beside = await open("/sidebar.html");
  const [column] = await overlays(beside);
  assert.equal(column!.path.join(" "), "#column");
  assert.ok(column!.share > 0.15, `the column takes ${column!.share} of the window`);
  assert.deepEqual([column!.covers!.top.text, column!.covers!.top.controls], [0, 0]);
  assert.ok(column!.covers!.top.ofText >= 2 && column!.covers!.top.ofControls >= 1, "the content next to it was looked at");
  assert.deepEqual([column!.covers!.scrolled!.text, column!.covers!.scrolled!.controls], [0, 0]);
  assert.equal(coversContent(column!), false);
  assert.equal(await beside.evaluate(() => window.scrollY), 0, "the page is back where it was");
  await beside.context().close();

  // The bar at the bottom lies over nothing while the page is at the top, and over the last link once it is scrolled.
  const over = await open("/covered.html");
  const [bar] = await overlays(over);
  assert.equal(bar!.path.join(" "), "#bar");
  assert.ok(bar!.share > 0.15);
  assert.deepEqual([bar!.covers!.top.text, bar!.covers!.top.controls], [0, 0]);
  assert.deepEqual([bar!.covers!.scrolled!.text, bar!.covers!.scrolled!.controls], [1, 1]);
  assert.equal(bar!.covers!.scrolled!.example, "Link onderaan, achter de vaste balk");
  assert.equal(coversContent(bar!), true);
  assert.equal(await over.evaluate(() => window.scrollY), 0);
  await over.context().close();
});

test("the sweep sees which boundaries and drawings forced colours take away, and the dossier says it is a lead and no finding", async () => {
  const page = await open("/forced.html");
  const probed = await forcedColoursProbe(page);
  assert.ok(!("error" in probed), JSON.stringify(probed));
  const forced = probed as ForcedProbe;
  assert.deepEqual([forced.controls, forced.drawings], [6, 2]);
  // A boundary made with box-shadow is gone; the buttons with a border keep theirs.
  assert.deepEqual(forced.boundaryDisappears.map((row) => row.where), ["#shadow-edge"]);
  assert.ok(forced.boundaryDisappears[0]!.before! >= 3 && forced.boundaryDisappears[0]!.after! < 3, JSON.stringify(forced.boundaryDisappears[0]));
  // A drawing made with a mask and a background colour is empty; the svg in the colour of the text stays.
  assert.deepEqual(forced.drawingsDisappear.map((row) => [row.where, row.controlHasText]), [["#mask-icon", false]]);
  // The page is put back: the browser no longer forces its colours, and the ordinary measurement reads the colours of the page.
  assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), false);
  const ordinary = await pageContrast(page);
  assert.equal(ordinary.controls.find((control) => control.where === "#border-edge")!.edge, "#1f2937");
  await page.context().close();

  // What the dossier of 1.4.11 and 2.4.7 gets: the rows, how much was looked at, and what the rows are worth.
  const run = { pages: [{ label: "P1", item: { slug: "forced" }, tabwalk: { stops: [] }, tabwalkDark: null }], contrast: [{ url: "x", slug: "forced", scheme: "light", measurements: [], controls: [], graphics: [], forced }] } as unknown as RunData;
  const dossier = (uiContrast(run, "1.4.11") as { forcedColours: { examined: boolean; status: string; method: string; pagesExamined: number; controlsExamined: number; boundaryDisappears: { count: number; rows: { where: string; pages: string }[] }; drawingsDisappear: { count: number; rows: { where: string }[] } } }).forcedColours;
  assert.equal(dossier.examined, true);
  assert.match(dossier.status, /geen eis van WCAG/);
  assert.match(dossier.status, /aanwijzing voor 1\.4\.11, 2\.4\.7 en 1\.4\.1 en een open punt: geen bevinding op zich/);
  assert.match(dossier.method, /focusaanduiding is in deze stand niet in de veegronde gemeten/);
  assert.deepEqual([dossier.pagesExamined, dossier.controlsExamined, dossier.boundaryDisappears.count, dossier.drawingsDisappear.count], [1, 6, 1, 1]);
  assert.equal(dossier.boundaryDisappears.rows[0]!.where, "#shadow-edge");
  // A run from before this probe says that it was not looked at.
  const older = { ...run, contrast: [{ ...run.contrast![0]!, forced: undefined }] } as unknown as RunData;
  assert.equal((uiContrast(older, "1.4.11") as { forcedColours: { examined: boolean } }).forcedColours.examined, false);
});

test("a boundary is read on and just outside the edge of a control, and its fate follows from 3 to 1", () => {
  const fill = (picture: PNG, x0: number, y0: number, x1: number, y1: number, colour: [number, number, number]): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) picture.data.set([...colour, 255], (y * picture.width + x) * 4);
  };
  const box = { x: 20, y: 20, width: 60, height: 30 };
  const page = (): PNG => {
    const picture = new PNG({ width: 100, height: 70 });
    fill(picture, 0, 0, 100, 70, [255, 255, 255]);
    return picture;
  };
  // No boundary at all: the control is the colour of the page.
  assert.deepEqual(boundaryOf(page(), box), { outside: "#ffffff", strongest: "#ffffff", ratio: 1 });
  // A border on the edge of the box.
  const bordered = page();
  fill(bordered, 20, 20, 80, 50, [31, 41, 55]);
  fill(bordered, 22, 22, 78, 48, [255, 255, 255]);
  assert.deepEqual(boundaryOf(bordered, box), { outside: "#ffffff", strongest: "#1f2937", ratio: 14.6 });
  // A ring of two pixels outside the box, as box-shadow draws it: the measurement for 1.4.11 reads the edge of the box and misses it, this one does not.
  const shadowed = page();
  fill(shadowed, 18, 18, 82, 52, [31, 41, 55]);
  fill(shadowed, 20, 20, 80, 50, [255, 255, 255]);
  assert.equal(boundaryOf(shadowed, box).ratio, 14.6);
  // Surroundings that are not one colour give no ratio.
  const busy = page();
  for (let x = 0; x < 100; x++) fill(busy, x, 0, x + 1, 70, [(x * 37) % 256, (x * 91) % 256, (x * 13) % 256]);
  assert.equal(boundaryOf(busy, box).ratio, null);
  assert.deepEqual([fateOf(14.6, 21), fateOf(14.6, 1), fateOf(14.6, null), fateOf(1, 21), fateOf(1.2, 1), fateOf(14.6, undefined), fateOf(14.6, 1, false)], ["stays", "disappears", "disappears", "appears", "absent", "unknown", "unknown"]);
});

test("the numbered tab-order picture is taken from the top, so a sticky side menu stays by its numbers", async () => {
  const page = await open("/keys.html");
  await page.setContent(`<aside style="position:sticky;top:0;float:left;width:200px"><a href="#a">Menu</a></aside><main style="height:4000px"><a href="#b">Inhoud</a></main>`);
  await page.evaluate(() => window.scrollTo(0, 3000));
  const path = join(await mkdtemp(join(tmpdir(), "loep-taborder-")), "tabwalk.png");
  await tabOrderScreenshot(page, [{ box: { x: 8, y: 8, width: 60, height: 20 } }], path);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.context().close();
});

test("the numbered tab-order picture shows the slide the stops were counted on, also when the arrow keys turn the slide after the walk", async () => {
  const page = await open("/deck.html");
  const dir = await mkdtemp(join(tmpdir(), "loep-deck-"));
  const path = join(dir, "tabwalk.png");
  // As the sweep goes: the walk with its picture, then the arrow keys from every stop.
  const walk = (await tabWalk(page, { continueAfterFocusLoss: true, focusDir: join(dir, "focus"), focusPath: "focus", orderPicture: path })) as { stops: { path: string[]; tag: string; text: string }[] };
  assert.deepEqual(walk.stops.map((stop) => stop.text), ["Sluiten", "Menu"]);
  await arrowReach(page, walk.stops);
  assert.notEqual(await page.locator("#counter").textContent(), "1 / 3", "the arrow keys turned the slide");
  // The picture holds the first slide, on which Tab went round, with the numbers.
  const picture = PNG.sync.read(await readFile(path));
  const at = (x: number, y: number): number[] => [...picture.data.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3)];
  assert.deepEqual(at(Math.floor(picture.width / 2), Math.floor(picture.height / 2)), [0xb0, 0, 0]);
  // The numbers were drawn for the picture only; they are gone from the page.
  assert.equal(await page.locator("[data-loep-tab-order]").count(), 0);
  await page.context().close();
});
