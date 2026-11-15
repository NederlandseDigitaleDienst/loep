import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Page } from "playwright";
import { launchBrowser, loadPage, newContext, settlePage } from "../src/browser/session.ts";
import { Daemon } from "../src/session/daemon.ts";
import { scopeForRun, setRunScope } from "../src/session/safety.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

// A feedback window of another party: its script fetches its settings from a host outside the run, and only then shows the window.
// Neither a session nor the sweep may show it, or the sweep measures a window that no agent can open and the scope leaves out.
let site: FixtureServer;
let run: string;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-outside-reads-"));
  // The inventory of a run on the fixture site alone: the other name of the server was not given with --also-origin.
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${site.origin}/`, origin: site.origin, origins: [site.origin], notFoundProbe: `${site.origin}/nope`, pages: [{ url: `${site.origin}/survey-elsewhere.html` }] }));
});

after(async () => {
  setRunScope(null);
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

const PAGE = "/survey-elsewhere.html";
const outsideReads = (): number => site.requests.filter((request) => request.host === "localhost" && request.path === "/survey-config").length;

async function shown(page: Page): Promise<{ dialog: boolean; own: string }> {
  await loadPage(page, `${site.origin}${PAGE}`);
  await settlePage(page);
  return page.evaluate(() => ({ dialog: document.getElementById("enquete") !== null, own: document.getElementById("eigen")!.textContent ?? "" }));
}

test("the sweep refuses a read of data from a host outside the run, as a session does; a read of the site arrives", async () => {
  const browser = await launchBrowser();
  try {
    setRunScope(run);
    const before = outsideReads();
    const sweep = await shown(await (await newContext(browser, { writes: null })).newPage());
    assert.equal(sweep.dialog, false, "the window of the other party does not appear in the sweep");
    assert.equal(sweep.own, "Wat vindt u van deze pagina?", "the same read from the site itself arrives");
    assert.equal(outsideReads(), before, "the host outside the run was asked nothing");
    // Without the scope of a run, as in the inventory, the read passes: that is how the inventory sees which pages read elsewhere.
    setRunScope(null);
    const inventory = await shown(await (await newContext(browser, { writes: null })).newPage());
    assert.equal(inventory.dialog, true, "without a scope the window appears");
  } finally {
    setRunScope(null);
    await browser.close();
  }
});

test("a session on the same run refuses the same read and shows no window either", async () => {
  const daemon = await Daemon.create(run, await scopeForRun(run, {}), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await daemon.handle({ op: "start", session: "main" });
    const loep = (command: string, ...args: string[]) => daemon.handle({ op: "command", session: "main", command, args, options: {} });
    const opened = await loep("open", PAGE);
    assert.equal(opened.ok, true, JSON.stringify(opened.print));
    assert.ok((opened.print.blocked as string[]).includes(`scope: GET ${site.otherOrigin}/survey-config`), JSON.stringify(opened.print.blocked));
    const found = await loep("find", "Feedbackformulier sluiten");
    assert.deepEqual((found.print as { found?: string[] }).found ?? [], [], "the window of the other party is not on the page");
  } finally {
    await daemon.close();
  }
});
