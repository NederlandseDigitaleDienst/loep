import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, newContext } from "../src/browser/session.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;
let browser: Browser;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-challenge-"));
  // The inventory found /form.html only as a window embedded on /choose.html.
  const pages = [
    { url: `${site.origin}/`, foundVia: [] },
    { url: `${site.origin}/form.html`, foundVia: [`iframe:${site.origin}/choose.html`] },
  ];
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${site.origin}/`, origin: site.origin, pages }));
  daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 50, maxSessions: 4, secondBrowsers: false });
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

async function open(session: string, address: string): Promise<{ print: Record<string, unknown>; record: Observation }> {
  assert.equal((await daemon.handle({ op: "start", session })).ok, true);
  const response = await daemon.handle({ op: "command", session, command: "open", args: [address], options: {} });
  assert.equal(response.ok, true, JSON.stringify(response.print));
  const print = response.print as Record<string, unknown> & { id: string };
  const nr = print.id.slice(print.id.lastIndexOf("-") + 1);
  return { print, record: JSON.parse(readFileSync(join(run, "observations", session, `${nr}.json`), "utf8")) as Observation };
}

const posted = (path: string): number => site.requests.filter((request) => request.method === "POST" && request.path === path).length;
const CHECK = "/cdn-cgi/challenge-platform/h/b/flow/test";

test("Cloudflare's check passes in a session only on a host that answers through Cloudflare, and a form next to it stays held back", async () => {
  site.requests.length = 0;
  const plain = await open("plain", "/challenge.html");
  assert.deepEqual(plain.record.blocked.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`).sort(), [`POST ${CHECK}`, "POST /submit"]);
  assert.equal(plain.record.challenges, undefined);
  assert.equal(posted(CHECK), 0, "a host that does not answer through Cloudflare gets nothing");

  const behind = await open("cloudflare", "/challenge.html?cloudflare");
  assert.deepEqual(behind.record.blocked.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`), ["POST /submit"]);
  assert.deepEqual(behind.record.challenges?.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`), [`POST ${CHECK}`]);
  assert.match(String(behind.print.challenge), /^1 verzoek van de controle van Cloudflare tegen robots doorgelaten \(127\.0\.0\.1\)/);
  assert.equal(posted(CHECK), 1);
  assert.equal(posted("/submit"), 0, "the form of the site is not sent");
});

test("the sweep lets Cloudflare's check through on the same terms", async () => {
  site.requests.length = 0;
  for (const [address, check] of [["/challenge.html", "Controle: tegengehouden."], ["/challenge.html?cloudflare", "Controle: ontvangen."]] as const) {
    const context = await newContext(browser, { writes: null, reads: [] });
    try {
      const page = await context.newPage();
      await page.goto(`${site.origin}${address}`);
      await page.waitForFunction(() => !document.body.textContent!.includes("bezig"));
      assert.equal(await page.textContent("#check"), check, address);
      assert.equal(await page.textContent("#form"), "Formulier: tegengehouden.", address);
    } finally {
      await context.close();
    }
  }
  assert.equal(posted(CHECK), 1);
  assert.equal(posted("/submit"), 0);
});

test("a window that the inventory found only embedded is opened with the page around it as referer", async () => {
  site.requests.length = 0;
  await open("frame", "/form.html");
  await open("page", "/");
  const loads = site.requests.filter((request) => request.method === "GET" && (request.path === "/form.html" || request.path === "/"));
  assert.deepEqual(loads.map((request) => [request.path, request.referer]), [
    ["/form.html", `${site.origin}/choose.html`],
    ["/", ""],
  ]);
});
