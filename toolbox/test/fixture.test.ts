import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { ACCOUNT, SESSION_COOKIE } from "../fixtures/account.ts";
import { ACCOUNT_PAGES, PAGES, SITES, staleOutput } from "../fixtures/build.ts";
import { CRITERIA_EXPECTED, DEFECTS, TRAPS } from "../fixtures/defects.ts";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import type { ReferenceAudit } from "../src/commands/compare.ts";
import { DECLARED_ORIGIN, RECORD_QUIET_MS } from "../src/lib/recordings.ts";
import { CRITERIA } from "../src/lib/wcag.ts";
import { decideWrites, recordWrites, writeBudget, type WritePermission } from "../src/lib/writes.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness, scopeForRun, TEST_VALUES } from "../src/session/safety.ts";
import { openSurface } from "../src/session/surface.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const SERVED = join(FIXTURES, "sites");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const TEXT_FILES = new Set([".html", ".css", ".js", ".xml", ".txt", ".svg", ".vtt"]);

/** Words and patterns that would tell an evaluator where to look or which variant it is on. */
const HINTS: [string, RegExp][] = [
  ["fout", /fout/i],
  ["bug", /bug/i],
  ["defect", /defect/i],
  ["gebrek", /gebrek/i],
  ["wcag", /wcag/i],
  ["a11y", /a11y/i],
  ["kapot", /kapot/i],
  ["broken", /broken/i],
  ["wrong", /wrong/i],
  ["slecht", /\bslecht/i],
  ["fixme or todo", /\b(fixme|todo)\b/i],
  ["valkuil", /valkuil/i],
  ["fixture", /fixture/i],
  ["test", /\btest(?!\()/i],
  ["variant", /(?<!font-)variant/i],
  ["criterion", /criteri(um|on|a)/i],
  ["violation", /violation|overtreding/i],
  ["answer", /antwoordsleutel|answer.?key/i],
  ["build marker", /@(bad|good|end)\b/],
  ["criterion number", /(?<![\d.])[1-4]\.[1-5]\.\d{1,2}(?![\d.])/],
  ["home directory", /\/Users\/|\/home\//],
];

describe("fixture site", () => {
  test("the generated sites match the sources", () => {
    assert.deepEqual(staleOutput(), []);
  });

  test("nothing that is served gives the answer away", () => {
    const hits: string[] = [];
    for (const path of walk(SERVED)) {
      const name = relative(SERVED, path);
      const subjects = [name, ...(TEXT_FILES.has(extname(path)) ? [readFileSync(path, "utf8")] : [])];
      for (const subject of subjects) {
        for (const [label, pattern] of HINTS) {
          const match = pattern.exec(subject);
          if (match) hits.push(`${name}: ${label} ("${subject.slice(Math.max(0, match.index - 30), match.index + 30).replace(/\s+/g, " ")}")`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  test("both variants have the same pages and nothing tells them apart by name", () => {
    const pages = (dir: string): string[] => walk(join(SERVED, dir)).map((path) => relative(join(SERVED, dir), path)).filter((path) => /\.(html|css|js|xml|svg)$/.test(path)).sort();
    assert.deepEqual(pages(SITES.defect.dir), pages(SITES.clean.dir));
    for (const page of PAGES) assert.ok(existsSync(join(SERVED, SITES.clean.dir, page.file)), page.file);
    // A page that carries a defect must differ from its twin.
    for (const defect of DEFECTS) {
      for (const path of defect.pages) {
        const page = PAGES.find((entry) => entry.path === path.split("?")[0]);
        if (!page) continue;
        const read = (dir: string): string => readFileSync(join(SERVED, dir, page.file), "utf8").replaceAll(SITES.defect.name, "X").replaceAll(SITES.clean.name, "X");
        const sameHtml = read(SITES.defect.dir) === read(SITES.clean.dir);
        if (sameHtml) assert.ok(defect.selectorInClean, `${defect.id}: ${page.file} is identical in both variants, so the selector must match in the clean twin as well`);
      }
    }
  });

  test("the key covers every criterion and is consistent", () => {
    const ids = CRITERIA.map((criterion) => criterion.id).sort();
    assert.deepEqual(CRITERIA_EXPECTED.map((entry) => entry.id).sort(), ids);
    assert.equal(new Set(DEFECTS.map((defect) => defect.id)).size, DEFECTS.length);
    for (const defect of DEFECTS) {
      assert.ok(ids.includes(defect.criterion), defect.id);
      assert.ok(defect.id.startsWith(`${defect.criterion}-`), defect.id);
      for (const other of defect.alsoCriteria ?? []) assert.ok(ids.includes(other), `${defect.id}: ${other}`);
      assert.ok(defect.pages.length > 0 && defect.selector && defect.whereNl && defect.wrongNl && defect.stateNl, defect.id);
      for (const path of defect.pages) assert.ok(path === "*" || path.startsWith("/"), `${defect.id}: ${path}`);
    }
    for (const trap of TRAPS) assert.ok(trap.variants.length > 0 && trap.descriptionNl && trap.testsNl, trap.id);
    const key = JSON.parse(readFileSync(join(FIXTURES, "key.json"), "utf8")) as { defects: unknown[]; totals: Record<string, number> };
    assert.equal(key.defects.length, DEFECTS.length);
    assert.equal(key.totals.measurable! + key.totals.interaction! + key.totals.looking!, DEFECTS.length);
  });

  test("the reference files follow the format of the compare command", () => {
    const defect = JSON.parse(readFileSync(join(FIXTURES, `reference-${SITES.defect.dir}.json`), "utf8")) as ReferenceAudit;
    const clean = JSON.parse(readFileSync(join(FIXTURES, `reference-${SITES.clean.dir}.json`), "utf8")) as ReferenceAudit;
    assert.equal(defect.kind, "answer-key");
    assert.deepEqual(defect.failed, CRITERIA_EXPECTED.filter((entry) => entry.defect === "failed").map((entry) => entry.id));
    assert.equal(defect.findings?.length, DEFECTS.length);
    for (const finding of defect.findings ?? []) assert.ok(finding.id && finding.criterion && finding.page && finding.descriptionNl, finding.id);
    assert.deepEqual(clean.failed, []);
    assert.deepEqual(clean.findings, []);
  });
});

describe("fixture server", () => {
  let fixture: FixtureServer;
  let browser: Browser | null = null;

  before(async () => {
    fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(mkdtempSync(join(tmpdir(), "fixture-")), "server.log") });
    browser = await chromium.launch().catch(() => null);
  });
  after(async () => {
    await browser?.close();
    await fixture.close();
  });

  test("serves both variants, the unknown-address page and the rewritten origins", async () => {
    for (const key of ["defect", "clean"] as const) {
      const home = await fetch(`${fixture.origins[key]}/`);
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.ok(html.includes(`${fixture.origins.thirdParty}/leeg.html`));
      assert.ok(!html.includes(`:${SITES.thirdParty.port}/`) || fixture.origins.thirdParty.endsWith(`:${SITES.thirdParty.port}`));
      const missing = await fetch(`${fixture.origins[key]}/deze-pagina-is-er-niet`);
      assert.equal(missing.status, 404);
      assert.ok((await missing.text()).includes("Deze pagina bestaat niet"));
      const sitemap = await (await fetch(`${fixture.origins[key]}/sitemap.xml`)).text();
      assert.ok(sitemap.includes(`<loc>${fixture.origins[key]}/contact.html</loc>`));
      assert.equal((await fetch(`${fixture.origins[key]}/../../key.json`)).status, 404);
      assert.equal((await fetch(`${fixture.origins[key]}/%2e%2e/%2e%2e/key.json`)).status, 404);
    }
    assert.equal((await fetch(`${fixture.origins.thirdParty}/speler.html?film=raad`)).status, 200);
    assert.deepEqual(fixture.writes(), []);
  });

  test("every selector in the key resolves in the defect variant, and in the clean twin only where the key says so", async (context) => {
    if (!browser) return context.skip("no browser available");
    const allPaths = PAGES.map((page) => page.path);
    const byPath = new Map<string, typeof DEFECTS>();
    for (const defect of DEFECTS) {
      for (const path of defect.pages[0] === "*" ? allPaths : defect.pages) byPath.set(path, [...(byPath.get(path) ?? []), defect]);
    }
    const problems: string[] = [];
    for (const key of ["defect", "clean"] as const) {
      const page = await browser.newPage();
      for (const [path, defects] of byPath) {
        await page.goto(`${fixture.origins[key]}${path}`, { waitUntil: "load" });
        const counts = await page.evaluate((selectors) => selectors.map((selector) => document.querySelectorAll(selector).length), defects.map((defect) => defect.selector));
        defects.forEach((defect, index) => {
          const found = counts[index]! > 0;
          const expected = key === "defect" || defect.selectorInClean;
          if (found !== expected) problems.push(`${key} ${path} ${defect.id}: "${defect.selector}" ${found ? "matches" : "does not match"}`);
        });
      }
      await page.close();
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(fixture.writes(), [], "loading pages must not send anything");
  });

  test("the part behind the login is there only with a session, which a link ends and time ends", async () => {
    const own = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(mkdtempSync(join(tmpdir(), "fixture-")), "server.log"), sessionSeconds: 1 });
    try {
      const origin = own.origins.clean;
      const logIn = async (password: string): Promise<Response> => fetch(`${origin}/inloggen`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ gebruikersnaam: ACCOUNT.username, wachtwoord: password }).toString() });
      const get = (path: string, cookie = ""): Promise<Response> => fetch(`${origin}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
      for (const page of ACCOUNT_PAGES) {
        const refused = await get(page.path);
        assert.deepEqual([refused.status, refused.headers.get("location")], [302, "/inloggen.html"], page.path);
      }
      // No sitemap names a page behind the login.
      assert.ok(!(await (await get("/sitemap.xml")).text()).includes("/mijn/"));
      // A wrong password is answered as every form is; it opens nothing.
      const wrong = await logIn("iets-anders");
      assert.deepEqual([wrong.status, wrong.headers.get("set-cookie")], [200, null]);
      const entered = await logIn(ACCOUNT.password);
      assert.deepEqual([entered.status, entered.headers.get("location")], [303, "/mijn/"]);
      const cookie = entered.headers.get("set-cookie")!.split(";")[0]!;
      assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`));
      for (const page of ACCOUNT_PAGES) assert.equal((await get(page.path, cookie)).status, 200, page.path);
      // A session is for the site it was opened on.
      assert.equal((await fetch(`${own.origins.defect}/mijn/`, { redirect: "manual", headers: { cookie } })).status, 302);
      // Both addresses end the session: the one that says so and the one that does not.
      assert.equal(own.logouts(), 0);
      assert.equal((await get("/mijn/sessie-sluiten", cookie)).status, 302);
      assert.equal(own.logouts(), 1);
      assert.equal((await get("/mijn/", cookie)).status, 302);
      const again = (await logIn(ACCOUNT.password)).headers.get("set-cookie")!.split(";")[0]!;
      assert.equal((await get("/uitloggen", again)).status, 302);
      assert.equal(own.logouts(), 2);
      // And time ends it.
      const short = (await logIn(ACCOUNT.password)).headers.get("set-cookie")!.split(";")[0]!;
      assert.equal((await get("/mijn/", short)).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal((await get("/mijn/", short)).status, 302);
      const forced = (await logIn(ACCOUNT.password)).headers.get("set-cookie")!.split(";")[0]!;
      own.expireSessions();
      assert.equal((await get("/mijn/", forced)).status, 302);
    } finally {
      await own.close();
    }
  });

  test("logs every request that is not a GET and every chat message", async (context) => {
    const posted = await fetch(`${fixture.origins.defect}/contact/verzenden`, { method: "POST", body: "naam=x" });
    assert.equal(posted.status, 200);
    let expected = 1;
    if (browser) {
      const page = await browser.newPage();
      await page.goto(`${fixture.origins.clean}/afval.html`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Weigeren" }).click();
      await page.getByRole("button", { name: "Chat met ons" }).click();
      await page.getByText("Welkom bij de chat").waitFor();
      assert.equal(fixture.writes().length, 1, "opening the chat sends nothing");
      await page.getByLabel("Uw bericht").fill("Hallo");
      await page.getByRole("button", { name: "Verstuur" }).click();
      await page.getByText("Bedankt voor uw bericht").waitFor();
      await page.close();
      expected = 2;
    } else context.diagnostic("no browser available: the chat is not exercised");
    const writes = fixture.writes();
    assert.equal(writes.length, expected);
    assert.deepEqual({ site: writes[0]!.site, kind: writes[0]!.kind, method: writes[0]!.method, path: writes[0]!.path, body: writes[0]!.body }, { site: "defect", kind: "request", method: "POST", path: "/contact/verzenden", body: "naam=x" });
    if (browser) assert.deepEqual({ site: writes[1]!.site, kind: writes[1]!.kind, body: writes[1]!.body }, { site: "clean", kind: "ws-message", body: '{"bericht":"Hallo"}' });
  });

  test("the chat opens its socket with a token of letters per connection, and a message sent before is played on the next connection", async (context) => {
    if (!browser) return context.skip("no browser available");
    const dir = mkdtempSync(join(tmpdir(), "fixture-chat-replay-"));
    const origin = fixture.origins.clean;
    const permission: WritePermission = { ...decideWrites(`${origin}/`, { allowWrites: true })!, maxWrites: 5, spacingSeconds: 0 };
    await recordWrites(dir, permission);
    const before = fixture.writes().length;
    try {
      const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
      const sockets: string[] = [];
      const replayed: string[] = [];
      for (let round = 0; round < 2; round++) {
        const { surface } = await openSurface(env, { url: `${origin}/afval.html`, width: 1280, height: 800, scheme: "light" });
        await surface.page.getByRole("button", { name: "Weigeren" }).click();
        await surface.page.getByRole("button", { name: "Chat met ons" }).click();
        await surface.page.getByText("Welkom bij de chat").waitFor();
        await surface.page.getByLabel("Uw bericht").fill(TEST_VALUES.text!);
        await surface.page.getByRole("button", { name: "Verstuur" }).click();
        await surface.page.getByText("Bedankt voor uw bericht").waitFor();
        // Quiet long enough after the answer for the recording to count as whole when the page closes.
        if (round === 0) await surface.page.waitForTimeout(RECORD_QUIET_MS + 500);
        sockets.push(...(surface.guard.sockets ?? []));
        replayed.push(...(surface.guard.replays ?? []).map((entry) => entry.matchedOn));
        await surface.context.close();
      }
      assert.equal(sockets.length, 2);
      for (const socket of sockets) assert.match(socket, /\/ws\/chat\/[A-Za-z]{16}$/);
      assert.notEqual(sockets[0], sockets[1], "each connection has a token of its own");
      // The second connection, with another token, got the recording: the server heard the message once, and the budget counts one.
      assert.deepEqual(replayed, [DECLARED_ORIGIN]);
      assert.equal(fixture.writes().slice(before).filter((entry) => entry.kind === "ws-message").length, 1);
      assert.equal(writeBudget(dir, permission).sent, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
