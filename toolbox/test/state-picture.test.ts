import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { PNG } from "pngjs";
import { frameAsPage } from "../src/browser/frame.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { showPostcondition } from "../src/commands/modelsweep.ts";
import type { Postcondition } from "../src/lib/sitemodel.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/** What the picture of a state shows: the state itself, clear of the bar at the top of the site. */

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

async function opened(path: string, work: (page: Page) => Promise<void>): Promise<void> {
  const context = await newContext(browser, { viewport: { width: 1280, height: 800 } });
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  try {
    await loadPage(page, `${site.origin}${path}`);
    await work(page);
  } finally {
    await context.close();
  }
}

test("a frame further down a page with a sticky bar at the top is pictured below that bar", async () => {
  await opened("/sticky-zoomed.html", async (page) => {
    const frame = page.frames().find((entry) => entry.url() === `${site.origin}/zoomed-content.html`)!;
    const view = await frameAsPage(page, frame);
    // The frame does not fit in the window as the page loads: the tab is scrolled to show it.
    const picture = PNG.sync.read(await view.screenshot());
    const colour = (x: number, y: number): number[] => [...picture.data.subarray((picture.width * y + x) << 2, ((picture.width * y + x) << 2) + 3)];
    assert.deepEqual(colour(20, 20), [255, 255, 255], "the top of the frame, not the bar of the page over it");
    assert.deepEqual(colour(700, 350), [0, 102, 204]);
    assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), [0, 0], "the tab is scrolled back");
    // A visitor who scrolled the frame up under the bar sees the bar over it: that picture is not changed.
    await page.evaluate(() => window.scrollTo({ top: document.querySelector("iframe")!.getBoundingClientRect().top - 30, behavior: "instant" }));
    const under = PNG.sync.read(await view.screenshot());
    assert.deepEqual([...under.data.subarray((under.width * 20 + 20) << 2, ((under.width * 20 + 20) << 2) + 3)], [128, 0, 128]);
  });
});

test("an opened control at the bottom of the window is shown with what it opened, below the sticky bar", async () => {
  const inWindow = (page: Page, selector: string): Promise<boolean> =>
    page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bar = document.querySelector("header")!.getBoundingClientRect().bottom;
      return rect.top >= bar && rect.bottom <= innerHeight;
    });
  const cases: { click: string; post: Postcondition; trigger: string; content: string }[] = [
    // A details element: the postcondition names every details on the page, the first of which stays closed.
    { click: "#status summary", post: { kind: "expanded", selector: "main details" }, trigger: "#status summary", content: "#status > div" },
    { click: "#toon-code", post: { kind: "expanded", selector: "#toon-code" }, trigger: "#toon-code", content: "#code" },
    // A category in a sidebar that scrolls by itself, without aria-controls: its list follows it.
    { click: "#categorie", post: { kind: "expanded", selector: "aside button[aria-label*=\"'Tekstopmaak'\"]" }, trigger: "#categorie", content: "#sub" },
  ];
  for (const entry of cases) {
    await opened("/opened-below.html", async (page) => {
      await page.click(entry.click);
      assert.equal(await inWindow(page, entry.content), false, `${entry.content} opens below the window`);
      await showPostcondition(page, entry.post);
      assert.equal(await inWindow(page, entry.trigger), true, `${entry.trigger} stays in view`);
      assert.equal(await inWindow(page, entry.content), true, `${entry.content} is in view`);
    });
  }
  // What already stands in the window, also partly under the bar, stays where it is.
  await opened("/opened-below.html", async (page) => {
    await page.click("#status summary");
    await page.evaluate(() => window.scrollTo({ top: document.querySelector("#status")!.getBoundingClientRect().top - 30, behavior: "instant" }));
    const before = await page.evaluate(() => window.scrollY);
    await showPostcondition(page, { kind: "expanded", selector: "main details" });
    assert.equal(await page.evaluate(() => window.scrollY), before);
  });
});
