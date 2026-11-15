import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { firefox, webkit, type Browser } from "playwright";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { LONG_REQUEST_MS } from "../src/browser/settle.ts";
import { inventory } from "../src/commands/inventory.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { SecondBrowsers } from "../src/session/second.ts";

/*
 * A page whose script keeps one request open (a long-poll, like a survey script or an analytics
 * beacon that hangs) used to hold every load until the cap of 10 seconds. A page that makes a few
 * requests in a row after it loaded must still be waited for.
 */

let server: Server;
let origin: string;
let scratch: string;
let browser: Browser;
const hanging = new Set<ServerResponse>();

const PAGE = (title: string, script: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>Tekst op de pagina.</p></main><script>${script}</script></body></html>`;
// The long-poll starts after load, as a script of another party does; the query must not reach the note.
const LONG_POLL = `addEventListener("load", () => { fetch("/poll?session=geheim").catch(() => undefined); });`;
// Three requests one after the other, with a pause of 200 ms in between: shorter than the quiet that is waited for.
const BURST = `const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
addEventListener("load", async () => {
  for (let step = 0; step < 3; step++) {
    await pause(200);
    await fetch("/slow?step=" + step).catch(() => undefined);
  }
  fetch("/blocked").catch(() => undefined);
  await pause(100);
  document.body.dataset.done = "ja";
});`;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-settle-"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const html = (text: string): void => void response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(text);
    if (path === "/" || path === "/long-poll") return html(PAGE("Lang wachten", LONG_POLL));
    if (path === "/burst") return html(PAGE("Na elkaar", BURST));
    // Never answered until the test ends.
    if (path === "/poll") return void hanging.add(response);
    if (path === "/slow") return void setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end("{}"), 300);
    response.writeHead(404, { "content-type": "text/plain" }).end("niet gevonden");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  for (const response of hanging) response.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

async function loadOn(on: Browser, path: string) {
  const context = await newContext(on, { writes: null });
  try {
    const page = await context.newPage();
    const began = performance.now();
    const loaded = await loadPage(page, `${origin}${path}`);
    return { loaded, ms: performance.now() - began, done: await page.evaluate(() => document.body.dataset.done ?? null) };
  } finally {
    await context.close();
  }
}

const assertLongPollNoted = (settle: unknown): void => {
  const note = settle as { quietAfterMs: number | null; slowRequests: { method: string; resourceType: string; url: string; ms: number }[] };
  assert.ok(note, "a note on the slow request");
  assert.ok(note.quietAfterMs !== null && note.quietAfterMs >= LONG_REQUEST_MS && note.quietAfterMs < 5000, JSON.stringify(note));
  assert.equal(note.slowRequests.length, 1, JSON.stringify(note));
  const [slow] = note.slowRequests;
  assert.deepEqual({ method: slow!.method, resourceType: slow!.resourceType, url: slow!.url }, { method: "GET", resourceType: "fetch", url: `${origin}/poll` });
  assert.ok(slow!.ms >= LONG_REQUEST_MS, JSON.stringify(slow));
};

test("a request that stays open does not hold the page until the cap, and is named with the load", async () => {
  const { loaded, ms } = await loadOn(browser, "/long-poll");
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
  assertLongPollNoted(loaded.settle);
});

test("requests that follow each other after the load are waited for, and leave no note", async () => {
  const blocked: string[] = [];
  const own = await newContext(browser, { writes: null });
  try {
    // A request that loep aborts in a route ends the count as well.
    await own.route("**/blocked", (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });
    const page = await own.newPage();
    const began = performance.now();
    const loaded = await loadPage(page, `${origin}/burst`);
    const ms = performance.now() - began;
    assert.equal(await page.evaluate(() => document.body.dataset.done ?? null), "ja", "settled before the last request of the burst");
    assert.equal(blocked.length, 1);
    assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
    assert.equal(loaded.settle, undefined, JSON.stringify(loaded.settle));
  } finally {
    await own.close();
  }
});

test("in Firefox and WebKit a request that stays open does not hold the page either", async (context) => {
  for (const [name, type] of [["firefox", firefox], ["webkit", webkit]] as const) {
    if (!SecondBrowsers.installed(name)) {
      context.diagnostic(`${name} is niet geïnstalleerd`);
      continue;
    }
    const other = await type.launch();
    try {
      const { loaded, ms } = await loadOn(other, "/long-poll");
      assert.ok(ms < 5000, `${name} took ${Math.round(ms)} ms`);
      assertLongPollNoted(loaded.settle);
      const burst = await loadOn(other, "/burst");
      assert.equal(burst.done, "ja", `${name} settled before the last request of the burst`);
    } finally {
      await other.close();
    }
  }
});

test("inventory.json notes the slow request per page, and leaves the note out where nothing was slow", async () => {
  const out = join(scratch, "inventory");
  await inventory({ baseUrl: `${origin}/`, out, maxPages: 2, fixedUrls: [`${origin}/long-poll`, `${origin}/burst`] });
  const pages = (JSON.parse(readFileSync(join(out, "inventory.json"), "utf8")) as { pages: { url: string; loadMs: number; settle?: unknown }[] }).pages;
  const long = pages.find((page) => page.url === `${origin}/long-poll`);
  const burst = pages.find((page) => page.url === `${origin}/burst`);
  assert.ok(long && burst, JSON.stringify(pages.map((page) => page.url)));
  assert.ok(long.loadMs < 5000, `loadMs ${long.loadMs}`);
  assertLongPollNoted(long.settle);
  assert.equal(burst.settle, undefined);
});

test("open in a session notes the slow request in its observation", async () => {
  const run = join(scratch, "session");
  const daemon = await Daemon.create(run, { hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 20, maxSessions: 1, secondBrowsers: false });
  try {
    assert.equal((await daemon.handle({ op: "start", session: "stil" })).ok, true);
    const began = performance.now();
    const opened = await daemon.handle({ op: "command", session: "stil", command: "open", args: ["/long-poll"], options: {} });
    assert.equal(opened.ok, true, JSON.stringify(opened.print));
    assert.ok(performance.now() - began < 8000, `took ${Math.round(performance.now() - began)} ms`);
    const observation = JSON.parse(readFileSync(join(run, "observations", "stil", "0001.json"), "utf8")) as Observation;
    assert.equal(observation.command, "open");
    assertLongPollNoted((observation.result as { settle?: unknown }).settle);
  } finally {
    await daemon.close();
  }
});
