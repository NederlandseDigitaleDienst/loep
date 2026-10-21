import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { pageLooksOperable, pageOperables } from "../src/instruments/operables.ts";

let fixture: FixtureServer;
let scratch: string;
let browser: Browser;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-looks-operable-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await fixture?.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function onProducts(site: "defect" | "clean") {
  const context = await newContext(browser);
  // The copy of the library in the page: it hears which listeners the page adds.
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${fixture.origins[site]}/producten.html`);
  return page;
}

test("a slider built from divs, without a role and a Tab stop, is listed as looking operable", async () => {
  const page = await onProducts("defect");
  try {
    const counted = await pageOperables(page);
    assert.ok(!counted.some((group) => group.kind === "slider"), "nothing presents the slider as a control, so it is not counted");
    const looks = await pageLooksOperable(page);
    const thumb = looks.find((entry) => entry.html.includes("schuif-knop"));
    assert.ok(thumb, JSON.stringify(looks));
    assert.ok(thumb.signals.includes("press-listener"), "the thumb listens for a press of the pointer, not for a click");
    // The list of clickables that the measurement uses stays as it was.
    const clickables = await call<{ html: string }[]>(page, "clickables");
    assert.ok(!clickables.some((entry) => entry.html.includes("schuif-knop")));
  } finally {
    await page.context().close();
  }
});

test("the clean twin's slider is a real input, counted as a control and not listed as looking operable", async () => {
  const page = await onProducts("clean");
  try {
    assert.ok((await pageOperables(page)).some((group) => group.members.some((member) => member.kind === "slider")));
    assert.ok(!(await pageLooksOperable(page)).some((entry) => /schuif|maxprijs/.test(entry.html)));
  } finally {
    await page.context().close();
  }
});
