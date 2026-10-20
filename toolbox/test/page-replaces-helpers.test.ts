import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, newContext } from "../src/browser/session.ts";
import { pageContrast } from "../src/instruments/contrast.ts";
import { ensureHelpers } from "../src/instruments/methods/capsule.ts";
import { runRuleEngines } from "../src/instruments/methods/rules.ts";
import { enginesWithoutResult, runEngines } from "../src/lib/engines.ts";
import { engine } from "../src/lib/extractors.ts";
import type { RunData } from "../src/lib/rundata.ts";

// A page that tries to make loep measure less (#143): each script runs before the content, as a script of the site would.
const EMPTY = "{ testEngine: { version: '4.14.0' }, violations: [], incomplete: [], passes: [], inapplicable: [] }";
const SCRIPTS: Record<string, string> = {
  plain: "",
  // Swap the function that finds text for one that finds nothing, in every way a script can try.
  loep: `
    try { window.__loep.textRuns = () => []; } catch {}
    try { window.__loep = { textRuns: () => [] }; } catch {}
    try { Object.defineProperty(window, "__loep", { value: { textRuns: () => [] } }); } catch {}
    try { delete window.__loep; } catch {}`,
  // A library of its own under loep's name, as in a frame where the toolbox could not install its own.
  "own-loep": `window.__loep = { textRuns: () => [] };`,
  // An axe of its own that cannot be replaced, and that finds nothing.
  "axe-fixed": `Object.defineProperty(window, "axe", { value: { run: async () => (${EMPTY}), getRules: () => [] }, writable: false, configurable: false });`,
  // A setter that takes hold of loep's axe and makes it find nothing.
  "axe-setter": `let kept; Object.defineProperty(window, "axe", { configurable: true, get: () => kept, set(value) { value.run = async () => (${EMPTY}); kept = value; } });`,
  // An axe of its own that loep can replace: loep runs its own.
  "axe-plain": `window.axe = { run: async () => (${EMPTY}), getRules: () => [] };`,
  // A loader of modules that takes hold of the library when it announces itself.
  define: `window.define = (name, deps, factory) => { factory().run = async () => (${EMPTY}); }; window.define.amd = true;`,
  // Helpers of its own under the name loep uses for the second-opinion methods.
  loepm: `window.__loepm = { byAxeTarget: () => ({ where: null }) };`,
};
const page = (script: string): string =>
  `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Proef</title><script>${script}</script></head><body style="margin:0;background:#fff"><main><h1 style="color:#000">Proef</h1><p style="color:#aaa;font-size:16px">Lichtgrijze tekst op wit</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20"></main></body></html>`;

let server: Server;
let origin: string;
let browser: Browser;

before(async () => {
  server = createServer((request, response) => {
    const name = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
    if (!(name in SCRIPTS)) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(SCRIPTS[name]!));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function open(name: string): Promise<Page> {
  const context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const tab = await context.newPage();
  await tab.goto(`${origin}/${name}`);
  return tab;
}

const lowContrast = async (name: string): Promise<{ outcome: string; ratio: number | null }[]> => {
  const tab = await open(name);
  try {
    return (await pageContrast(tab)).measurements.filter((entry) => entry.text.includes("Lichtgrijze")).map((entry) => ({ outcome: entry.outcome, ratio: entry.ratio }));
  } finally {
    await tab.context().close();
  }
};

const axeFailures = async (name: string): Promise<{ status: { ok: boolean; error?: string }; failed: string[] }> => {
  const tab = await open(name);
  try {
    const run = await runEngines(tab);
    return { status: run.status["axe-core"], failed: run.results.filter((result) => result.engine === "axe-core" && result.outcome === "failed").map((result) => result.rule) };
  } finally {
    await tab.context().close();
  }
};

test("a page that swaps the text finder of the in-page library gets the same contrast measurement as one that does not", { timeout: 120_000 }, async () => {
  const plain = await lowContrast("plain");
  assert.deepEqual(plain, [{ outcome: "failed", ratio: 2.3 }]);
  assert.deepEqual(await lowContrast("loep"), plain);
});

test("a library that is not the one loep fixed to the window is refused, not called", { timeout: 60_000 }, async () => {
  // Without the init script the page's own library stands there, as in a frame where the toolbox could not install its own.
  const context = await newContext(browser);
  try {
    const bare = await context.newPage();
    await bare.goto(`${origin}/own-loep`);
    assert.equal(await bare.evaluate(() => (window as unknown as { __loep?: { textRuns: () => unknown[] } }).__loep?.textRuns().length), 0, "the page's own library would answer");
    await assert.rejects(call(bare, "textRuns"), /niet de bibliotheek die loep in de pagina zette/);
  } finally {
    await context.close();
  }
  const tab = await open("loep");
  try {
    assert.ok((await call<unknown[]>(tab, "textRuns")).length > 0);
  } finally {
    await tab.context().close();
  }
});

test("axe-core finds the same failures on a page with an axe of its own that loep can replace, or with a loader of modules", { timeout: 120_000 }, async () => {
  const plain = await axeFailures("plain");
  assert.equal(plain.status.ok, true);
  assert.ok(plain.failed.includes("image-alt"), plain.failed.join(", "));
  assert.deepEqual(await axeFailures("axe-plain"), plain);
  assert.deepEqual(await axeFailures("define"), plain);
});

test("a page that fixed window.axe gets no clean result from axe-core but a result that cannot be established", { timeout: 120_000 }, async () => {
  for (const name of ["axe-fixed", "axe-setter"]) {
    const tampered = await axeFailures(name);
    assert.equal(tampered.status.ok, false, name);
    assert.match(tampered.status.error ?? "", /window\.axe zelf vastgezet/, name);
    assert.deepEqual(tampered.failed, [], name);
  }
  // The extractor of the engines says it with every criterion.
  const status = { "axe-core": { ok: false, version: "unknown", error: "de pagina heeft window.axe zelf vastgezet" }, alfa: { ok: true, version: "1" } };
  assert.deepEqual(enginesWithoutResult({ status }), [{ engine: "axe-core", error: "de pagina heeft window.axe zelf vastgezet" }]);
  const run = { pages: [{ label: "P1", engines: { light: { status, results: [] }, dark: { status: { ...status, "axe-core": { ok: true, version: "4" } }, results: [] } } }] } as unknown as RunData;
  const told = engine(run, "1.1.1") as { enginesWithoutResult?: { page: string; engine: string }[] };
  assert.deepEqual(told.enginesWithoutResult?.map((entry) => [entry.page, entry.engine]), [["P1/light", "axe-core"]]);
});

test("the second-opinion engines refuse a fixed window.axe and helpers the page put there itself", { timeout: 180_000 }, async () => {
  const fixed = await open("axe-fixed");
  try {
    const run = await runRuleEngines(fixed, {});
    const axe = run.failed.find((failure) => failure.implementation === "axe-core");
    assert.match(axe?.reason ?? "", /window\.axe zelf vastgezet/);
    assert.equal(run.methods.some((method) => method.implementation === "axe-core"), false);
  } finally {
    await fixed.context().close();
  }
  const planted = await open("loepm");
  try {
    await assert.rejects(ensureHelpers(planted), /zelf een window\.__loepm gezet/);
  } finally {
    await planted.context().close();
  }
});
