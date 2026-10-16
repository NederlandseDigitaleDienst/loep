import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { call } from "../src/browser/call.ts";
import { INPAGE_PATH, launchBrowser, newContext } from "../src/browser/session.ts";
import { contentOf } from "../src/commands/collect.ts";

const ORIGIN = "https://site.test";
let browser: Browser;
let context: BrowserContext;
let served = "";

before(async () => {
  browser = await launchBrowser();
  context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: served }));
});

after(async () => {
  await context.close();
  await browser.close();
});

async function open(html: string): Promise<Page> {
  served = `<!doctype html>${html}`;
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/diensten`);
  return page;
}

async function snapshotOf(html: string, how = "visitorSnapshot"): Promise<string> {
  const page = await open(html);
  try {
    return await call<string>(page, how);
  } finally {
    await page.close();
  }
}

/** One page of a site, with what a new build, a new session or another hour puts in it. */
const page = (load: { build: string; id: string; when: string; ago: string; slide: 0 | 1; token: string; extra?: string; change?: (html: string) => string }): string => {
  const html = `<html lang="nl"><head>
  <title>Diensten</title>
  <meta name="csrf-token" content="${load.token}">
  <link rel="stylesheet" href="/assets/main.${load.build}.css">
  <script nonce="${load.token}" src="/assets/app.${load.build}.js"></script>
</head><body class="page page--${load.build}" data-build="${load.build}">
  <a href="#main" class="skip">Naar de inhoud</a>
  <header class="header_${load.build}"><img src="/assets/logo.${load.build}.svg?v=${load.build}" srcset="/assets/logo.${load.build}.svg 1x" alt="Gemeente" style="width:120px"></header>
  <main id="main">
    <h1 id="h-${load.id}">Diensten</h1>
    <p>Bijgewerkt op ${load.when}, ${load.ago}.</p>
    <p>Aanvragen kan <strong>online</strong>.</p>
    <section aria-labelledby="h-${load.id}"><h2>Aanvragen</h2>
      <a href="${ORIGIN}/diensten/paspoort?session=${load.token}#${load.id}" data-track="${load.id}">Paspoort aanvragen</a>
      <a href="/contact">Contact</a>
    </section>
    <div class="slider" aria-roledescription="carrousel">
      <div aria-hidden="${load.slide === 0 ? "false" : "true"}" class="${load.slide === 0 ? "active" : ""}"><a href="/nieuws/1" tabindex="${load.slide === 0 ? 0 : -1}">Nieuws een</a></div>
      <div aria-hidden="${load.slide === 1 ? "false" : "true"}" class="${load.slide === 1 ? "active" : ""}"><a href="/nieuws/2" tabindex="${load.slide === 1 ? 0 : -1}">Nieuws twee</a></div>
    </div>
    <p>Het volgende evenement is op <time datetime="2026-10-20">20 oktober</time>.</p>
    <form action="/zoeken" method="get">
      <input type="hidden" name="authenticity_token" value="${load.token}">
      <label for="q-${load.id}">Zoeken</label><input id="q-${load.id}" name="q" type="search" autocomplete="off">
      <input type="submit" value="Zoek">
    </form>
    ${load.extra ?? ""}
  </main>
</body></html>`;
  return load.change ? load.change(html) : html;
};

const MORNING = { build: "3f2a9c1b", id: "r1a8f0e2c", when: "vrijdag 16 oktober 2026 om 09:12", ago: "2 uur geleden", slide: 0, token: "Zx9ab7Qk2LmN4pR8" } as const;
const EVENING = { build: "b71e04d9", id: "r9c3d5b71", when: "zaterdag 17 oktober 2026 om 19:40", ago: "5 minuten geleden", slide: 1, token: "aa13f9e7c0d24b6e" } as const;

test("what a visitor sees as the same page has the same content snapshot, after a new build, in another session, hours later", async () => {
  // Every attribute and the head counted before: the same page differed on every load.
  assert.notEqual(await snapshotOf(page(EVENING), "contentSnapshot"), await snapshotOf(page(MORNING), "contentSnapshot"));
  const morning = await snapshotOf(page(MORNING));
  assert.equal(await snapshotOf(page(EVENING)), morning);
  // Text that a script puts down in two pieces is the same text.
  assert.equal(await snapshotOf(page({ ...MORNING, change: (html) => html.replace("<p>Aanvragen kan <strong>", "<p>Aanvragen <!-- x -->kan <strong>") })), morning);
  for (const kept of ["Paspoort aanvragen", "Nieuws twee", 'autocomplete="off"', 'value="Zoek"', 'alt="Gemeente"', 'href="/contact"']) assert.ok(morning.includes(kept), kept);
  for (const gone of [MORNING.build, MORNING.id, MORNING.token, "09:12", "2026", "class=", "style="]) assert.ok(!morning.includes(gone), gone);
});

test("a change in text, structure or controls is a change of the page", async () => {
  const morning = await snapshotOf(page(MORNING));
  const changes: Record<string, (html: string) => string> = {
    text: (html) => html.replace("Aanvragen kan", "Aanvragen kon"),
    "heading level": (html) => html.replace("<h2>Aanvragen</h2>", "<h3>Aanvragen</h3>"),
    "link target": (html) => html.replace('href="/contact"', 'href="/contact-formulier"'),
    "text alternative": (html) => html.replace('alt="Gemeente"', 'alt=""'),
    "label of a field": (html) => html.replace(">Zoeken</label>", ">Zoek op de site</label>"),
    "purpose of a field": (html) => html.replace('autocomplete="off"', 'autocomplete="email"'),
    "label of a button": (html) => html.replace('value="Zoek"', 'value="Zoeken"'),
    "name of a region": (html) => html.replace('aria-roledescription="carrousel"', 'aria-roledescription="diashow"'),
    "positive tab order": (html) => html.replace('href="/contact"', 'href="/contact" tabindex="3"'),
    "another picture": (html) => html.replace("/assets/logo.", "/assets/wapen."),
  };
  for (const [what, change] of Object.entries(changes)) assert.notEqual(await snapshotOf(page({ ...MORNING, change })), morning, what);
  assert.notEqual(await snapshotOf(page({ ...MORNING, extra: "<button>Meer laden</button>" })), morning, "a new button");
  assert.notEqual(await snapshotOf(page({ ...MORNING, extra: "<p>Het loket is dicht.</p>" })), morning, "a new paragraph");
});

test("the content of a page is read once a block that loads from another address has come in", async () => {
  // A list of events that the page fetches from another address after it loaded, and that answers a moment later.
  await context.route("https://events.test/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(["Inloopspreekuur", "Open dag"]) });
  });
  const late = page({
    ...MORNING,
    extra: `<ul id="events"></ul><script>fetch("https://events.test/list").then((answer) => answer.json()).then((names) => { document.getElementById("events").innerHTML = names.map((name) => "<li>" + name + "</li>").join(""); });</script>`,
  });
  const ready = page({ ...MORNING, extra: `<ul id="events"><li>Inloopspreekuur</li><li>Open dag</li></ul>` });
  const tab = await open(late);
  try {
    const content = await contentOf(tab);
    assert.equal(content.snapshot, await snapshotOf(ready));
  } finally {
    await tab.close();
  }
});
