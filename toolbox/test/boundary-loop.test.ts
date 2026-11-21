import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { isSocketLoop, PROXY_FAILED_STATUS, type SocketEnds } from "../src/browser/boundary.ts";
import { newContext } from "../src/browser/session.ts";
import { registerSecret } from "../src/lib/secrets.ts";
import { scopeForRun, watchNotLoaded, type NotLoaded } from "../src/session/safety.ts";

/*
 * mockttp takes a request for a loop when the port it came from is the port of a connection mockttp opened itself. On Linux two
 * connections to different addresses can have the same port: the connection of the gate to mockttp and one from mockttp to the
 * site. With many pages at once that happens now and then, and mockttp answered 500 for a stylesheet or a whole page, which was
 * then measured without saying so. Here that state is made on purpose: an open connection to the site with the port the request
 * comes from.
 */

const SECRET = "Zk3v/Q9x+T7bLp2nWd5sGh8JmR4cYf6AeU1oKi0tXa";

let browser: Browser | null = null;
after(async () => {
  await browser?.close();
});

/** A page whose checkbox is hidden by its stylesheet: without the stylesheet the checkbox is drawn. */
async function site(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.url === "/stijl.css") return void response.writeHead(200, { "content-type": "text/css" }).end("input { display: none; }");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<!doctype html><html lang="nl"><title>Site</title><link rel="stylesheet" href="/stijl.css"><body><label><input type="checkbox"> Kopie</label></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

type Handle = (this: { outgoingSockets: Set<SocketEnds> }, request: { url: string; socket: SocketEnds }, ...rest: unknown[]) => Promise<unknown>;

/** The step of mockttp that passes a request on, as the boundary uses it. */
function passThroughStep(): { prototype: { handle: Handle } } {
  const require = createRequire(import.meta.url);
  return (require(join(dirname(require.resolve("mockttp")), "rules", "requests", "request-step-impls.js")) as { PassThroughStepImpl: { prototype: { handle: Handle } } }).PassThroughStepImpl;
}

/**
 * Load the page through the boundary while mockttp has an open connection that `sharing` makes for the request of the stylesheet.
 * Says whether the checkbox was hidden, the status of the stylesheet, and what the watch of collect noted as not loaded.
 */
async function loadWith(sharing: (incoming: SocketEnds, siteOrigin: string) => SocketEnds): Promise<{ hidden: boolean; status: number | null; missed: NotLoaded[] }> {
  const { origin, server } = await site();
  const run = mkdtempSync(join(tmpdir(), "loep-lus-"));
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  registerSecret(run, SECRET, { source: "test" });
  browser ??= await chromium.launch();
  const context = await newContext(browser, { runDir: run });
  const step = passThroughStep();
  const handle = step.prototype.handle;
  step.prototype.handle = async function (request, ...rest) {
    if (!request.url.endsWith("/stijl.css")) return handle.call(this, request, ...rest);
    const shared = sharing(request.socket, origin);
    this.outgoingSockets.add(shared);
    try {
      return await handle.call(this, request, ...rest);
    } finally {
      this.outgoingSockets.delete(shared);
    }
  };
  try {
    const missed: NotLoaded[] = [];
    watchNotLoaded(context, await scopeForRun(run, {}), (entry) => missed.push(entry));
    const page = await context.newPage();
    const sheet = page.waitForResponse((response) => response.url().endsWith("/stijl.css"));
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const status = (await sheet).status();
    const hidden = await page.locator("input").evaluate((input) => !input.checkVisibility());
    return { hidden, status, missed };
  } finally {
    step.prototype.handle = handle;
    await context.close();
    server.close();
    rmSync(run, { recursive: true, force: true });
  }
}

test("a connection to the site with the same port as the request is no loop: the stylesheet arrives", async () => {
  // The other connection goes from the same port to the site, not to mockttp.
  const outcome = await loadWith((incoming, origin) => ({ localAddress: incoming.remoteAddress, localPort: incoming.remotePort, remoteAddress: "127.0.0.1", remotePort: Number(new URL(origin).port) }));
  assert.equal(outcome.status, 200);
  assert.equal(outcome.hidden, true, "the checkbox is hidden by the stylesheet");
  assert.deepEqual(outcome.missed, []);
});

test("a real loop is refused with a status that the measurement notes as not loaded", async () => {
  // The other connection is the very one the request came in on, seen from the other end.
  const outcome = await loadWith((incoming) => ({ localAddress: incoming.remoteAddress, localPort: incoming.remotePort, remoteAddress: incoming.localAddress, remotePort: incoming.localPort }));
  assert.equal(outcome.status, PROXY_FAILED_STATUS);
  assert.equal(outcome.missed.length, 1);
  assert.equal(outcome.missed[0]!.resourceType, "stylesheet");
});

test("only both ends of a connection together make a loop", () => {
  const out = { localAddress: "127.0.0.1", localPort: 50000, remoteAddress: "127.0.0.1", remotePort: 8080 };
  assert.equal(isSocketLoop([out], { remoteAddress: "127.0.0.1", remotePort: 50000, localAddress: "127.0.0.1", localPort: 9090 }), false);
  assert.equal(isSocketLoop([out], { remoteAddress: "::ffff:127.0.0.1", remotePort: 50000, localAddress: "::ffff:127.0.0.1", localPort: 8080 }), true);
  assert.equal(isSocketLoop([{ localPort: 50000 }], { remoteAddress: "127.0.0.1", remotePort: 50000, localAddress: "127.0.0.1", localPort: 8080 }), false, "a closed socket has no ends");
});
