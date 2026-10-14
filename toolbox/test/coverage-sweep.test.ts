import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { hoverFocusContrast } from "../src/instruments/contrast.ts";
import { focusCoveredInState } from "../src/instruments/keyboard.ts";
import { languagesOf } from "../src/instruments/languages.ts";
import { binary } from "../src/instruments/methods/registry.ts";
import { visualOrder } from "../src/instruments/order.ts";
import { picturesWithText, type PictureCache } from "../src/instruments/pictures.ts";
import { betweenWidths, controlsBetweenWidths, widthsToTry } from "../src/instruments/widths.ts";
import { breakpointsNl, widthHints } from "../src/commands/explore.ts";
import type { SiteModel } from "../src/lib/sitemodel.ts";
import type { Recipe } from "../src/session/daemon.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/**
 * The measurements of the sweep that close what the judges of a full audit still had to measure
 * themselves: a control that only shows between the measured widths, the order and spaced text per
 * page, the colours of every link and button under the pointer and with focus in both schemes, text
 * in pictures, focus under a fixed bar when walking back or with the arrow keys, and the language
 * of text alternatives.
 */

let site: FixtureServer;
let browser: Browser;
let out: string;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
  out = await mkdtemp(join(tmpdir(), "loep-sweep-"));
});

after(async () => {
  await browser.close();
  await site.close();
});

async function open(path: string, options: { viewport?: { width: number; height: number }; colorScheme?: "light" | "dark" } = {}): Promise<Page> {
  const context = await newContext(browser, { ...(options.viewport ? { viewport: options.viewport } : {}), ...(options.colorScheme ? { colorScheme: options.colorScheme } : {}) });
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

test("a button that only shows between the measured widths is found, measured at a width where it shows, and opened there", async () => {
  // Both sides of every width the stylesheets name are tried, next to a regular step.
  assert.deepEqual(widthsToTry([600, 1000]).filter((width) => [599, 601, 999, 1001].includes(width)), [1001, 999, 601, 599]);
  const page = await open("/between.html");
  const breakpoints = await call<number[]>(page, "layoutBreakpoints");
  assert.deepEqual(breakpoints, [600, 1000], "the widths of the media query are read from the stylesheet");
  const found = await betweenWidths(page, out, "probes");
  assert.equal(found.controls.length, 1, JSON.stringify(found.controls));
  const button = found.controls[0]!;
  assert.equal(button.control, 'button "Meer opties" [header]');
  assert.equal(button.name, "Meer opties", "the name assistive technology gets");
  assert.equal(button.role, "button");
  assert.equal(button.iconOnly, true);
  assert.ok(button.shownAt.every((width) => width >= 600 && width <= 1000) && button.shownAt.length > 0);
  assert.ok(button.screenshot && existsSync(join(out, button.screenshot.replace(/^probes\//, ""))));
  assert.equal(found.measuredAt.length, 1);
  const [at] = found.measuredAt;
  assert.ok(existsSync(join(out, at!.screenshot.replace(/^probes\//, ""))));
  const opened = at!.opened[0]!;
  assert.equal(opened.failedNl, undefined);
  assert.deepEqual(opened.controls, ['a "Over ons" [header]', 'a "Contact" [header]'], "what the button opened");
  assert.match(opened.tree, /listitem/, "the part of the accessibility tree it added shows the list");
  assert.match(opened.tree, /link "Over ons"/);
  await page.context().close();
});

test("the explorer is told the widths from the stylesheets and the width to try a control at that only shows in between", async () => {
  const page = await open("/between.html");
  const scanned = await controlsBetweenWidths(page);
  await page.context().close();
  assert.deepEqual(scanned.breakpoints, [600, 1000]);
  assert.deepEqual(scanned.controls.map((control) => control.control), ['button "Meer opties" [header]']);
  const shownAt = scanned.controls[0]!.shownAt;
  assert.ok(shownAt.every((width) => width >= 600 && width <= 1000));
  const model = { components: [], processes: [] } as unknown as SiteModel;
  const [hint] = widthHints(model, {}, [{ pageType: "start", ...scanned }]);
  assert.match(hint!, /^button "Meer opties" \[header\] staat alleen tussen 60\d en (99\d|1000) pixels breed in beeld, op geen van 1280, 360, 320 \(paginatype start\)\. Open de pagina met --width \d+ /);
  const width = Number(/--width (\d+)/.exec(hint!)![1]);
  assert.ok(shownAt.includes(width), "the width to try is one where the control was on screen");
  // A component recorded at such a width covers it: no hint.
  const covered = { components: [{ id: "meer", recipe: "component-meer", pageTypes: ["start"] }], processes: [] } as unknown as SiteModel;
  assert.deepEqual(widthHints(covered, { "component-meer": { start: { width } } } as unknown as Record<string, Recipe>, [{ pageType: "start", ...scanned }]), []);
  // Before exploring: the widths of the stylesheets per page type, in the task.
  assert.match(breakpointsNl({ baseUrl: "", proposedPageTypes: [], frames: [], breakpoints: [{ pageType: "type-1", widths: [600, 1000] }, { pageType: "type-2", widths: [600, 1000] }] }), /^De stylesheets noemen deze breedtes tussen 320 en 1280 pixels; daar verandert de opmaak:\n\n- Alle paginatypen: 600, 1000\n/);
  assert.match(breakpointsNl({ baseUrl: "", proposedPageTypes: [], frames: [] }), /geen breedtes tussen 320 en 1280/);
});

test("the order of code and screen is measured per page and at 320 wide, and text laid out with spaces is found", async () => {
  const page = await open("/between.html");
  const spaced = await call<{ kind: string; lines: string[]; inCode: boolean }[]>(page, "spacedText");
  assert.deepEqual(
    spaced.map((entry) => entry.kind),
    ["losse letters", "uitgelijnd met spaties"],
  );
  assert.deepEqual(spaced[0]!.lines, ["W e l k o m"]);
  assert.equal(spaced[1]!.inCode, false);
  assert.equal(spaced[1]!.lines.length, 3, "the three lines of the table made with spaces");
  const order = await visualOrder(page);
  assert.ok(order.positioned.some((item) => item.tag === "a" && item.text === "Start") === false, "a link in a fixed header is in normal flow inside it");
  assert.ok(order.sequence.length > 0);
  await page.context().close();
});

test("the language of a text alternative is recorded with the lang that holds for it and what the detectors find", async () => {
  const page = await open("/between.html");
  const found = await languagesOf(page, { blocks: true });
  const alt = found.textAlternatives.find((piece) => piece.kind === "alt")!;
  assert.equal(alt.text, "The town hall seen from the market square at night");
  assert.equal(alt.declared, "nl", "the lang of the page holds for the image");
  assert.equal(alt.verdict, "mismatch", JSON.stringify(alt));
  const label = found.textAlternatives.find((piece) => piece.kind === "aria-label" && piece.text === "Meer opties");
  assert.equal(label, undefined, "a control that is not on screen has no name a user meets now");
  assert.ok(found.textBlocks!.some((piece) => piece.text.startsWith("W e l k o m")), "in a state the visible text is read too");
  await page.context().close();
});

test("every link and button is measured under the pointer and with focus, in the dark scheme too, and once for the whole site", async () => {
  const page = await open("/between.html", { colorScheme: "dark" });
  const seen = new Set<string>();
  const report = await hoverFocusContrast(page, seen);
  assert.equal(report.measured, report.controls, "every link and button on the first page");
  const hovered = report.rows.find((row) => row.control.includes("Eerste onderwerp") && row.trigger === "hover")!;
  assert.equal(hovered.texts[0]!.outcome, "failed", "under the pointer the link is almost as dark as the page");
  const focused = report.rows.find((row) => row.control.includes("Eerste onderwerp") && row.trigger === "focus")!;
  assert.equal(focused.texts[0]!.outcome, "passed");
  const again = await hoverFocusContrast(page, seen);
  assert.deepEqual([again.controls, again.measured, again.rows.length], [report.controls, 0, 0], "on a second page the same links are not measured again");
  await page.context().close();
});

test("walking back with Shift+Tab and with the arrow keys notes a stop that slides under a fixed header", async () => {
  const page = await open("/between.html");
  await page.click("#lijstknop");
  // Focus on the fifth item with the third under the header: the browser does not scroll for an element that is in the window already.
  await page.evaluate(() => {
    const third = document.querySelector<HTMLElement>('#alle a[href="#a3"]')!;
    window.scrollTo(0, third.getBoundingClientRect().top + window.scrollY - 62);
    document.querySelector<HTMLElement>('#alle a[href="#a5"]')!.focus({ preventScroll: true });
  });
  const walked = await focusCoveredInState(page, out, "focus-covered");
  const back = walked.walks.find((walk) => walk.key === "Shift+Tab")!;
  assert.ok(back.stops.length >= 4, JSON.stringify(back.stops.map((stop) => stop.text)));
  const covered = back.stops.find((stop) => stop.text === "Onderwerp 3")!;
  assert.match(covered.coveredBy ?? "", /header/, "the third item went under the fixed header");
  assert.ok(covered.screenshot && existsSync(join(out, covered.screenshot.replace(/^focus-covered\//, ""))));
  assert.equal(back.stops.find((stop) => stop.text === "Onderwerp 4")!.coveredBy, null);
  assert.ok(walked.walks.some((walk) => walk.key === "ArrowDown" || walk.key === "ArrowUp") || walked.walks.length === 1, "the arrow keys are tried; in a plain list they do not move focus");
  await page.context().close();
});

test("every picture is cut out and read once, also when it stands on a second page", { skip: !(await binary("tesseract")).available && "Tesseract ontbreekt" }, async () => {
  const cache: PictureCache = new Map();
  const page = await open("/imagetext.html");
  const first = await picturesWithText(page, join(out, "pictures"), "probes/pictures", cache);
  const labels = first.pictures.find((picture) => picture.where.includes("#labels") && picture.kind === "img")!;
  assert.ok(!("notReadNl" in labels.ocr) && labels.ocr.hasText, JSON.stringify(labels));
  assert.match(!("notReadNl" in labels.ocr) ? labels.ocr.text : "", /goedgekeurd/i);
  assert.ok(labels.crop && existsSync(join(out, "pictures", labels.crop.split("/").pop()!)));
  const background = first.pictures.find((picture) => picture.where.includes("labels-bg"))!;
  assert.ok(background && !("notReadNl" in background.ocr) && background.ocr.hasText, "an element with a background image is a picture too");
  assert.ok(first.recognised >= 2);
  const second = await picturesWithText(page, join(out, "pictures"), "probes/pictures", cache);
  assert.equal(second.recognised, 0, "what was read is not read again");
  assert.deepEqual(second.pictures.map((picture) => picture.ocr), first.pictures.map((picture) => picture.ocr));
  await page.context().close();
});
