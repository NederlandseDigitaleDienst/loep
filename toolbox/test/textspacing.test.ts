import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { spacingFromLoad, textSpacing } from "../src/instruments/overflow.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/** Text spacing (1.4.12) on parts that a page makes after the spacing was put in force. */

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

async function open(path: string, fromLoad = false): Promise<Page> {
  const context = await newContext(browser);
  if (fromLoad) await spacingFromLoad(context);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

/** Letter spacing of the label of every menu item, in pixels, from inside the shadow roots. */
const itemSpacing = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...document.querySelector("x-menu")!.shadowRoot!.querySelectorAll("x-item")].map((item) => Number.parseFloat(getComputedStyle(item.shadowRoot!.querySelector("span")!).letterSpacing) || 0));

const openMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Meer opties" }).click();
  await page.waitForTimeout(50);
};

test("1.4.12: a menu that makes its items anew on every opening gets the wider spacing in each new shadow root", async () => {
  const page = await open("/spacing-menu.html");
  try {
    const applied = await call<{ shadowRootsStyled: number }>(page, "applyTextSpacing");
    assert.equal(applied.shadowRootsStyled, 1, "only the menu has a root before it opens");
    await openMenu(page);
    // 16 px text: 0.12em is 1.92 px. The item assigns its own sheets right after creating its root; the spacing stays.
    assert.deepEqual((await itemSpacing(page)).map((value) => value.toFixed(2)), ["1.92", "1.92", "1.92"]);
    // Closed and opened again: the items are new, and so are their roots.
    await openMenu(page);
    await openMenu(page);
    assert.deepEqual((await itemSpacing(page)).map((value) => value.toFixed(2)), ["1.92", "1.92", "1.92"]);
    // Measuring again with the menu open counts the new roots and finds no text without the spacing.
    const again = await call<{ shadowRootsStyled: number; resistantCount: number }>(page, "applyTextSpacing");
    assert.equal(again.shadowRootsStyled, 4);
    assert.equal(again.resistantCount, 0);
    // Taken away again, it stays away, also for items made after that.
    await call(page, "removeTextSpacing");
    await openMenu(page);
    await openMenu(page);
    assert.deepEqual(await itemSpacing(page), [0, 0, 0]);
  } finally {
    await page.context().close();
  }
});

test("1.4.12: with the spacing in force from the load, as a state is opened, the menu opens with the wider spacing", async () => {
  const page = await open("/spacing-menu.html", true);
  try {
    await openMenu(page);
    assert.deepEqual((await itemSpacing(page)).map((value) => value.toFixed(2)), ["1.92", "1.92", "1.92"]);
  } finally {
    await page.context().close();
  }
});

test("1.4.12: textSpacing with restore leaves the page as it was, also for parts made afterwards", async () => {
  const page = await open("/spacing-menu.html");
  try {
    await openMenu(page);
    const result = await textSpacing(page, `${process.env.TMPDIR ?? "/tmp"}/loep-spacing-menu.png`, true);
    assert.equal(result.textWithoutSpacingCount, 0, JSON.stringify(result.textWithoutSpacing));
    await openMenu(page);
    await openMenu(page);
    assert.deepEqual(await itemSpacing(page), [0, 0, 0]);
  } finally {
    await page.context().close();
  }
});

test("1.4.12: a tile with a fixed height that hides its overflow cuts off text held in spans; a tile that grows does not", async () => {
  const page = await open("/spacing-tiles.html");
  try {
    const result = await textSpacing(page, `${process.env.TMPDIR ?? "/tmp"}/loep-spacing-tiles.png`, true);
    assert.equal(result.clippedBefore, 0, "a block that only cuts off a decoration does not count");
    // overflow:hidden and overflow:clip both cut off the second line; the tile with min-height grows along.
    assert.deepEqual(result.newlyClipped.map((item) => (item as { text?: string }).text), ["Paspoort of rijbewijs", "Afval en grofvuil"]);
  } finally {
    await page.context().close();
  }
});
