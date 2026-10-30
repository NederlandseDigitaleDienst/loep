import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { webkit, type Browser, type Route } from "playwright";
import { passOn } from "../src/browser/session.ts";
import { guardRedirectsByRoute, type Guard, type Scope } from "../src/session/safety.ts";
import { SecondBrowsers } from "../src/session/second.ts";

/*
 * WebKit takes no redirect from a route. These go through the two places where loep hands on an
 * answer it fetched itself; before `fulfillAnswer` each of them hung or failed in WebKit.
 */

const heard: string[] = [];
const server = createServer((request, response) => {
  heard.push(`${request.method} ${request.url}`);
  if (request.url === "/start") return void response.writeHead(302, { location: "/tussen" }).end();
  if (request.url === "/tussen") return void response.writeHead(303, { location: "/doel" }).end();
  if (request.url === "/weg") return void response.writeHead(302, { location: "http://elders.example/" }).end();
  if (request.url === "/formulier") return void response.writeHead(303, { location: "/doel" }).end();
  if (request.url === "/bewaar") return void response.writeHead(307, { location: "/doel" }).end();
  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Doel</title><h1>${request.method}</h1><form method="post" action="/formulier"><button>Verstuur</button></form>`);
});
let origin = "";
let browser: Browser;
const skip = !SecondBrowsers.installed("webkit");

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (!skip) browser = await webkit.launch();
});

after(async () => {
  if (!skip) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const scope = (): Scope => ({ hosts: [new URL(origin).host], baseUrl: `${origin}/`, strict: false });

test("a navigation with redirects reaches its end in WebKit, in the watch on redirects", { skip }, async () => {
  const context = await browser.newContext();
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  await guardRedirectsByRoute(context, scope(), guard);
  const page = await context.newPage();
  await page.goto(`${origin}/start`);
  await page.waitForURL(`${origin}/doel`);
  assert.equal(await page.locator("h1").textContent(), "GET");
  await context.close();
});

test("a redirect out of the scope stays held back in WebKit", { skip }, async () => {
  const context = await browser.newContext();
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
  await guardRedirectsByRoute(context, scope(), guard);
  const page = await context.newPage();
  await page.goto(`${origin}/weg`).catch(() => undefined);
  assert.equal(guard.blocked[0]?.kind, "scope");
  assert.match(guard.blocked[0]?.url ?? "", /elders\.example/);
  await context.close();
});

test("a form that redirects goes on in WebKit, and is sent once", { skip }, async () => {
  const context = await browser.newContext();
  await context.route("**/*", (route: Route) => (route.request().method() === "POST" ? passOn(route, () => true).then(() => undefined) : route.continue()));
  const page = await context.newPage();
  await page.goto(`${origin}/doel`);
  heard.length = 0;
  await page.getByRole("button", { name: "Verstuur" }).click();
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "GET" && !document.title.includes("Doorverwijzing"));
  assert.deepEqual(heard.filter((line) => line.startsWith("POST")), ["POST /formulier"]);
  await context.close();
});

test("a script gets the end of a redirect in WebKit, also one that keeps its method", { skip }, async () => {
  const context = await browser.newContext();
  await context.route("**/*", (route: Route) => (route.request().resourceType() === "fetch" ? passOn(route, () => true).then(() => undefined) : route.continue()));
  const page = await context.newPage();
  await page.goto(`${origin}/doel`);
  assert.match(await page.evaluate(() => fetch("/start").then((answer) => answer.text())), /<h1>GET<\/h1>/);
  assert.match(await page.evaluate(() => fetch("/bewaar", { method: "POST", body: "x" }).then((answer) => answer.text())), /<h1>POST<\/h1>/);
  await context.close();
});
