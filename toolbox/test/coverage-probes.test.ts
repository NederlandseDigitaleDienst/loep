import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { DownRun, HoverRun, inState } from "../src/commands/states.ts";
import type { StateOpener } from "../src/commands/modelsweep.ts";
import { controlsOnlyWithSpacing, overflowProbe, textSpacing, visibleControlKeys, type ContentInventory } from "../src/instruments/overflow.ts";
import { downEventTargets, downKind } from "../src/instruments/pointer.ts";
import { holds } from "../src/session/recipe.ts";
import type { Surface } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/**
 * The measurements that close what a full audit of a real site left open: the pointer probes by
 * kind of control, in the narrow window and in an opened state, the content at another size, and
 * the controls that only exist with the wider text spacing.
 */

let site: FixtureServer;
let browser: Browser;
let out: string;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
  out = await mkdtemp(join(tmpdir(), "loep-coverage-"));
});

after(async () => {
  await browser.close();
  await site.close();
});

async function open(path: string, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await newContext(browser, viewport ? { viewport } : {});
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

/** A state of a site model without the model: the page with its panel opened, and the condition that says it is open. */
function panelState(counter: { opened: number }): StateOpener & { open: NonNullable<StateOpener["open"]> } {
  const post = { kind: "visible" as const, selector: "#paneel" };
  return {
    base: { id: "component-paneel", kind: "component", modelId: "paneel", pageTypes: ["start"], recipe: "component-paneel", openWith: "--state component-paneel" },
    primary: true,
    ownScheme: false,
    startUrl: `${site.origin}/kinds.html`,
    key: "k",
    open: async () => {
      counter.opened++;
      const page = await open("/kinds.html");
      await page.click("#opener");
      return { surface: { page, context: page.context() } as unknown as Surface, reached: (await holds(page, post)).holds, reasonNl: null, post };
    },
  };
}

test("the hover probe points at a few controls of each kind, at every button with only a pictogram, and says what it left alone", async () => {
  const page = await open("/kinds.html");
  const run = new HoverRun(out);
  const found = await run.on({ label: "P1", narrow: false, shot: "kinds" }, async () => page);
  const coverage = run.coverage();
  // Six links of one list are one kind: two of them are pointed at. The other link, the opener, the three buttons and the abbreviation are each pointed at.
  assert.equal(coverage.found, 12);
  assert.equal(coverage.kinds, 7);
  assert.equal(coverage.examined, 8);
  assert.equal(coverage.nonControlsExamined, 1, "an abbreviation with a title is no control, and is pointed at too");
  assert.equal(coverage.sameKindNotExamined, 4, "four links of the list were not pointed at because two of their kind were");
  assert.equal(coverage.notExamined, 0, "no kind was left out");
  assert.deepEqual([found.controls, found.kinds, found.pointedAt, found.complete], [12, 7, 8, true]);
  // The tooltip of a button with only a pictogram is found, and a button without one is recorded as showing nothing.
  const byTitle = run.iconOnly.find((entry) => entry.title !== null)!;
  assert.deepEqual([byTitle.iconOnly, byTitle.title, byTitle.contentAppeared], [false, "Uitleg van de browser zelf", []], "a title draws nothing in the page: that is the browser's own tooltip");
  const withPictogram = run.iconOnly.filter((entry) => entry.iconOnly);
  assert.equal(withPictogram.length, 2, "each button with only a pictogram is its own kind");
  assert.deepEqual(withPictogram.map((entry) => entry.contentAppeared).sort(), [[], ["hover", "focus"]]);
  assert.deepEqual(run.hover.map((row) => [row.newContent, row.trigger]), [["Wis het zoekveld", "hover"], ["Wis het zoekveld", "focus"]]);
  assert.ok(existsSync(join(out, run.hover[0]!.screenshot!)));
  // The colours under the pointer are measured for the controls that were pointed at.
  assert.ok(run.contrast.some((entry) => entry.control.includes("Eerste onderwerp") && entry.trigger === "hover"));
  assert.ok(!run.contrast.some((entry) => entry.control.includes("Zesde onderwerp")));

  // The same page in the narrow window counts apart: a control can look and behave differently there.
  const narrow = await open("/kinds.html", { width: 360, height: 740 });
  const again = await run.on({ label: "P1", narrow: true, shot: "kinds-smal" }, async () => narrow);
  assert.deepEqual([again.kinds, again.pointedAt], [7, 8]);
  assert.ok(run.hover.some((row) => row.viewport === "smal"));
  await narrow.context().close();
  await page.context().close();
});

test("controls that look and behave alike are one kind, whatever their classes and attributes; a control that looks or behaves otherwise stays apart", async () => {
  const page = await open("/same-kinds.html");
  const run = new HoverRun(out);
  await run.on({ label: "P1", narrow: false, shot: "same-kinds" }, async () => page);
  const coverage = run.coverage();
  // Before, every class and attribute counted: seven card links with seven sets of classes were seven kinds.
  const classSets = await page.evaluate(() => new Set([...document.querySelectorAll(".kaart a")].map((link) => link.className)).size);
  assert.equal(classSets, 7);
  // Now: the six card links that change alike under the pointer, the one that turns pale, the two large buttons, the small one, and the four answers.
  assert.equal(coverage.found, 14);
  assert.equal(coverage.kinds, 5);
  assert.equal(coverage.examined, 8);
  const pointedAt = new Set(run.contrast.map((entry) => entry.control));
  assert.ok([...pointedAt].some((control) => control.includes("Uitgelicht")), "the link with its own style under the pointer is a kind of its own, and is pointed at");
  assert.ok(run.contrast.some((entry) => entry.control.includes("Uitgelicht") && entry.trigger === "hover" && entry.texts.some((text) => text.ratio !== null && text.ratio < text.required)), "its pale text under the pointer is measured");
  assert.ok([...pointedAt].some((control) => control.includes("Meer")), "a button of another size is a kind of its own");

  // The press probe: three answers with the same code on the press are one kind, the button with other code another.
  const targets = await downEventTargets(page, new Set());
  const kinds = new Set(targets.map(downKind));
  assert.deepEqual([targets.length, kinds.size], [4, 2]);
  const pressing = new DownRun();
  let current: Page | null = page;
  const source = async (fresh = false): Promise<Page> => {
    if (current && !fresh) return current;
    await current?.context().close();
    current = await open("/same-kinds.html");
    return current;
  };
  const found = await pressing.on({ label: "P1", narrow: false, shot: "same-kinds" }, source, new Set(), false);
  assert.deepEqual([found.kindsFound, found.pressed], [2, 2]);
  const answered = pressing.results.find((entry) => entry.changeOnDown !== null)!;
  assert.equal(answered.undoneByReleasingElsewhere, false, "the answer that counts on the press is still found");
  await current?.context().close();
});

test("in an opened state the probes take what is new there, and open the state again when a step closed it", async () => {
  const counter = { opened: 0 };
  const hovering = new HoverRun(out);
  // The page in its default state first, as the sweep does: what is on it is not pointed at again in the state.
  const page = await open("/kinds.html");
  await hovering.on({ label: "P1", narrow: false, shot: "kinds" }, async () => page);
  const before = hovering.examined;
  const pointed = await inState(panelState(counter), (source, narrow) => hovering.on({ label: "component-paneel", narrow, state: "component-paneel", shot: "state-paneel" }, source));
  assert.equal(pointed.examined, true);
  assert.equal(pointed.viewport, "1280x800");
  // The link and the button in the panel are new. The opener has another state now (expanded) but is the same control.
  assert.equal(pointed.found!.controls, 2);
  assert.equal(hovering.examined - before, 2);
  assert.ok(hovering.contrast.some((entry) => entry.state === "component-paneel" && entry.control.includes("Zevende onderwerp")));
  await page.context().close();

  // A probe that closes the state gets it opened again for the next control.
  counter.opened = 0;
  const closing = await inState(panelState(counter), async (source) => {
    const first = (await source())!;
    await first.keyboard.press("Escape");
    const second = (await source())!;
    assert.notEqual(first, second, "a fresh page, with the panel open again");
    assert.equal(await second.locator("#paneel").isVisible(), true);
    return { complete: true };
  });
  assert.equal(closing.examined, true);
  assert.equal(counter.opened, 2);

  // The press probe finds a control that only started to listen when the panel opened, and presses it there.
  const pressing = new DownRun();
  const closed = await open("/kinds.html");
  assert.deepEqual(await downEventTargets(closed, new Set()), [], "nothing listens for a press on the page as it loads");
  await closed.context().close();
  const pressed = await inState(panelState(counter), (source, narrow) => pressing.on({ label: "component-paneel", narrow, state: "component-paneel", shot: "state-paneel" }, source, new Set(), false));
  assert.deepEqual([pressed.found!.kindsFound, pressed.found!.pressed], [1, 1]);
  assert.equal(pressing.results[0]!.state, "component-paneel");
  assert.match(pressing.results[0]!.changeOnDown!, /Gekozen\./);
});

test("the press probe tries the elements that listen, not every element of a tag that listens, and keeps a page while a press changed nothing", async () => {
  // One button of three acts on the press: the page is replaced after it, and only then.
  const loads = { count: 0, fresh: 0 };
  let page: Page | null = null;
  const source = async (fresh = false): Promise<Page> => {
    if (page && !fresh) return page;
    if (fresh) loads.fresh++;
    await page?.context().close();
    loads.count++;
    page = await open("/press.html");
    return page;
  };
  const run = new DownRun();
  const found = await run.on({ label: "P1", narrow: false, shot: "press" }, source, new Set(["button"]), false);
  assert.deepEqual([found.kindsFound, found.pressed], [3, 3]);
  assert.equal(loads.count, 3, "a fresh page after each of the two presses that did something, none after the one that did nothing");
  assert.equal(run.results.filter((entry) => entry.changeOnDown !== null).length, 2);
  await page!.context().close();
  page = null;

  // The limit on kinds holds for a page and not for a state of the model: what only exists in a state is always pressed.
  const limited = new DownRun(1);
  const onPage = await limited.on({ label: "P1", narrow: false, shot: "press" }, source, new Set(["button"]), false);
  assert.deepEqual([onPage.kindsFound, onPage.pressed, limited.left.size], [3, 1, 2]);
  const unlimited = new DownRun(1);
  const inAState = await unlimited.on({ label: "component-paneel", narrow: false, state: "component-paneel", shot: "press" }, source, new Set(["button"]), false);
  assert.deepEqual([inAState.kindsFound, inAState.pressed, unlimited.left.size], [3, 3, 0]);
  await page!.context().close();

  // On a page where one label listens, a field with another label is no candidate.
  const toggles = await open("/toggles.html");
  assert.deepEqual((await downEventTargets(toggles, new Set(["label"]))).map((target) => target.path.join()), ["#cb1", "#cb2"]);
  await toggles.context().close();
});

test("the content of a page is listed at each size, and what a size takes away is what is missing from the list", async () => {
  const wide = await open("/sizes.html");
  const atWide = await call<ContentInventory>(wide, "contentInventory");
  assert.deepEqual(atWide.headings, ["Inhoud per afmeting", "Alleen op een breed scherm", "Altijd zichtbaar"]);
  assert.deepEqual(atWide.images, ["img:Grafiek van het aantal bezoekers"]);
  assert.ok(atWide.textBlocks.includes("Deze alinea verdwijnt op een smal scherm."));
  assert.deepEqual(atWide.rotatedQuarterTurn, [], "nothing is turned in the landscape window");
  assert.equal(atWide.orientationRules, 1);
  await wide.context().close();

  const narrow = await open("/sizes.html", { width: 320, height: 256 });
  const probed = await overflowProbe(narrow, join(out, "reflow.png"));
  assert.deepEqual(probed.content.headings, ["Inhoud per afmeting", "Altijd zichtbaar"]);
  assert.deepEqual(probed.content.images, []);
  assert.ok(!probed.content.textBlocks.includes("Deze alinea verdwijnt op een smal scherm."));
  assert.ok(probed.content.textBlocks.includes("Deze alinea blijft op elke afmeting staan."));
  await narrow.context().close();

  const portrait = await open("/sizes.html", { width: 800, height: 1280 });
  const turned = (await call<ContentInventory>(portrait, "contentInventory")).rotatedQuarterTurn;
  assert.deepEqual(turned.map((entry) => [(entry.path as string[]).join(), entry.angle]), [["#gedraaid", 90]], "a block that carries content and is drawn a quarter turn in the portrait window");
  await portrait.context().close();
});

test("a button that only exists with the wider text spacing is opened with the spacing in force, and what went is looked for behind it", async () => {
  const page = await open("/sizes.html");
  const before = await visibleControlKeys(page);
  await textSpacing(page, join(out, "spacing.png"));
  // The page arranges its header a moment after the spacing changed.
  await page.waitForTimeout(200);
  const controls = await controlsOnlyWithSpacing(page, before, (index) => ({ path: join(out, `opened-${index}.png`), relative: `opened-${index}.png` }));
  assert.deepEqual(controls.appeared.map((entry) => entry.control), ['button "..." [nav:Hoofdmenu]']);
  const opened = controls.appeared[0]!.opened!;
  assert.equal(opened.failedNl, undefined);
  assert.deepEqual(opened.controls, ['a "Feedback" [header]', 'a "Broncode" [header]'], "the button was activated while the spacing was in force, and showed what moved");
  assert.ok(existsSync(join(out, "opened-1.png")));
  assert.deepEqual(controls.disappeared.map((entry) => entry.control).sort(), ['a "Broncode" [nav:Hoofdmenu]', 'a "Feedback" [nav:Hoofdmenu]']);
  await page.context().close();
});
