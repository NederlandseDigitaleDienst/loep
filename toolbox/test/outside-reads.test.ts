import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Page } from "playwright";
import { launchBrowser, loadPage, newContext, settlePage } from "../src/browser/session.ts";
import { fixedReadsLog, fixedReadsOfSweep, fixedReadsUsed, READS_FIXED_LOG, setFixedReads, setRunReads, type FixedRead, type FixedReadPassed } from "../src/lib/reads.ts";
import { Daemon } from "../src/session/daemon.ts";
import { guardContext, scopeForRun, setRunScope, type Guard } from "../src/session/safety.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

// A feedback window of another party: its script fetches its settings with a GET from a host outside the run, and only then
// shows the window. A session without --strict and the sweep both let that read through, so both measure the window; the
// host does not join the run, so a POST to it stays held back. A player of another party asks its own host with a POST what
// to play: a fixed read rule lets exactly that path through, in a session and in the sweep, and nothing else on that host.
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
  setFixedReads(null);
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

const SURVEY = "/survey-elsewhere.html";
const PLAYER = "/player-elsewhere.html";
const PLAYER_FORM = "/player-form-elsewhere.html";
const outside = (method: string, path: string): number => site.requests.filter((request) => request.host === "localhost" && request.method === method && request.path === path).length;
// A fixed rule for the player on the other name of the fixture server; the real rules name hosts no test may reach.
const playerRule = (): FixedRead => ({ id: "testspeler", method: "POST", origin: site.otherOrigin, path: "/player-data/player", reasonNl: "De speler van de testsite vraagt hiermee op wat hij gaat afspelen." });

async function shown(page: Page, path: string): Promise<Record<string, string | boolean>> {
  await loadPage(page, `${site.origin}${path}`);
  await settlePage(page);
  return page.evaluate(() => ({
    dialog: document.getElementById("enquete") !== null,
    own: document.getElementById("eigen")?.textContent ?? "",
    player: document.getElementById("speler")?.textContent ?? "",
    other: document.getElementById("ander")?.textContent ?? "",
  }));
}

test("the sweep lets a GET of the page to a host outside the run through, and a POST only where a fixed read rule covers it", async () => {
  const browser = await launchBrowser();
  try {
    setRunScope(run);
    setFixedReads([]);
    const asked = outside("GET", "/survey-config");
    const survey = await shown(await (await newContext(browser, { writes: null })).newPage(), SURVEY);
    assert.equal(survey.dialog, true, "the window of the other party appears in the sweep");
    assert.equal(survey.own, "Wat vindt u van deze pagina?", "the same read from the site itself arrives");
    assert.equal(outside("GET", "/survey-config"), asked + 1, "the host outside the run was asked once");

    const without = await shown(await (await newContext(browser, { writes: null })).newPage(), PLAYER);
    assert.deepEqual([without.player, without.other], ["", ""], "without a rule no POST of the player leaves");
    assert.equal(outside("POST", "/player-data/player"), 0);

    assert.ok(!existsSync(join(run, READS_FIXED_LOG)), "nothing passed, so nothing is noted");

    setFixedReads([playerRule()]);
    setRunReads([], undefined, fixedReadsLog(run, "collect"));
    const withRule = await shown(await (await newContext(browser, { writes: null })).newPage(), PLAYER);
    assert.equal(withRule.player, "Antwoord op /player-data/player", "the POST the rule covers passes");
    assert.equal(withRule.other, "", "a POST to another path of the same host stays held back");
    assert.equal(outside("POST", "/player-data/other"), 0);
    // The sweep notes what the fixed rule let through, without the query, so the report names the rule also when no session used it.
    const noted = readFileSync(join(run, READS_FIXED_LOG), "utf8").trim().split("\n").map((line) => JSON.parse(line) as FixedReadPassed);
    assert.deepEqual([...new Set(noted.map((entry) => `${entry.source} ${entry.method} ${entry.address} ${entry.rule}`))], [`collect POST ${site.otherOrigin}/player-data/player testspeler`]);
    assert.deepEqual(fixedReadsUsed([fixedReadsOfSweep(run)], [playerRule()]).map((rule) => rule.id), ["testspeler"]);

    const covered = outside("POST", "/player-data/player");
    await shown(await (await newContext(browser, { writes: null })).newPage(), PLAYER_FORM);
    assert.equal(outside("POST", "/player-data/player"), covered, "a form that posts to the covered address is a navigation, and stays held back");
  } finally {
    setRunScope(null);
    setFixedReads(null);
    setRunReads([], undefined, null);
    rmSync(join(run, READS_FIXED_LOG), { force: true });
    await browser.close();
  }
});

test("a session on the same run shows the window too, passes the covered POST as a read, and holds back any other POST", async () => {
  setFixedReads([playerRule()]);
  const daemon = await Daemon.create(run, await scopeForRun(run, {}), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await daemon.handle({ op: "start", session: "main" });
    const loep = (command: string, ...args: string[]) => daemon.handle({ op: "command", session: "main", command, args, options: {} });
    const opened = await loep("open", SURVEY);
    assert.equal(opened.ok, true, JSON.stringify(opened.print));
    assert.ok(!((opened.print.blocked as string[] | undefined) ?? []).some((line) => line.includes("/survey-config")), JSON.stringify(opened.print.blocked));
    const found = await loep("find", "Feedbackformulier sluiten");
    assert.equal(((found.print as { found?: string[] }).found ?? []).length, 1, "the window of the other party is on the page");

    const player = await loep("open", PLAYER);
    assert.equal(player.ok, true, JSON.stringify(player.print));
    assert.deepEqual(player.print.read, [`POST ${site.otherOrigin}/player-data/player?prettyPrint=false (leesverzoek testspeler)`], "the covered POST is recorded as a read");
    assert.ok((player.print.blocked as string[]).some((line) => line.includes(`POST ${site.otherOrigin}/player-data/other`)), JSON.stringify(player.print.blocked));
    assert.equal(((await loep("find", "Antwoord op /player-data/player")).print as { found?: string[] }).found?.length, 1, "the player got its answer");
    assert.equal(outside("POST", "/player-data/other"), 0, "the other path of that host was sent nothing");

    const covered = outside("POST", "/player-data/player");
    const form = await loep("open", PLAYER_FORM);
    assert.equal(form.print.read, undefined, "a form that posts to the covered address is no read");
    assert.ok((form.print.blocked as string[]).some((line) => line.includes(`POST ${site.otherOrigin}/player-data/player`)), JSON.stringify(form.print.blocked));
    assert.equal(outside("POST", "/player-data/player"), covered, "the form was sent nothing");
  } finally {
    await daemon.close();
    setFixedReads(null);
  }
});

test("a strict session holds back the read of the window and the POST of the player alike", async () => {
  setFixedReads([playerRule()]);
  const daemon = await Daemon.create(run, await scopeForRun(run, { strict: true }), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await daemon.handle({ op: "start", session: "streng" });
    const loep = (command: string, ...args: string[]) => daemon.handle({ op: "command", session: "streng", command, args, options: {} });
    const opened = await loep("open", SURVEY);
    assert.ok((opened.print.blocked as string[]).includes(`scope: GET ${site.otherOrigin}/survey-config`), JSON.stringify(opened.print.blocked));
    assert.deepEqual(((await loep("find", "Feedbackformulier sluiten")).print as { found?: string[] }).found ?? [], []);
    const player = await loep("open", PLAYER);
    assert.equal(player.print.read, undefined, "no read passes in a strict scope");
    assert.ok((player.print.blocked as string[]).some((line) => line.includes(`POST ${site.otherOrigin}/player-data/player`)), JSON.stringify(player.print.blocked));
  } finally {
    await daemon.close();
    setFixedReads(null);
  }
});

test("a request to a host outside the run with an authorization header is held back, also without a login and also where a fixed read rule covers it", async () => {
  setFixedReads([playerRule()]);
  const browser = await launchBrowser();
  const send = (page: Page, url: string, method: string): Promise<void> => page.evaluate(([to, how]) => fetch(to!, { method: how, headers: { authorization: "Bearer los-token-zonder-inlog" } }).then(() => undefined, () => undefined), [url, method]);
  try {
    const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "test" };
    const context = await newContext(browser, { writes: null });
    await guardContext(context, await scopeForRun(run, {}), guard);
    const page = await context.newPage();
    await loadPage(page, `${site.origin}${SURVEY}`);
    const asked = outside("GET", "/survey-config");
    const posted = outside("POST", "/player-data/player");
    await send(page, `${site.otherOrigin}/survey-config`, "GET");
    await send(page, `${site.otherOrigin}/player-data/player`, "POST");
    assert.equal(outside("GET", "/survey-config"), asked, "the GET with the header was not sent");
    assert.equal(outside("POST", "/player-data/player"), posted, "nor the POST the fixed rule covers");
    for (const [method, path] of [["GET", "/survey-config"], ["POST", "/player-data/player"]]) {
      assert.ok(guard.blocked.some((entry) => entry.kind === "scope" && entry.method === method && entry.url === `${site.otherOrigin}${path}` && /authorization/.test(entry.reasonNl ?? "")), JSON.stringify(guard.blocked));
    }
    assert.equal((guard.reads ?? []).length, 0, "no read was recorded for it");
    await context.close();

    // The sweep holds them back the same way.
    setRunScope(run);
    const sweep = await newContext(browser, { writes: null });
    const swept = await sweep.newPage();
    await loadPage(swept, `${site.origin}${SURVEY}`);
    const before = outside("GET", "/survey-config");
    await send(swept, `${site.otherOrigin}/survey-config`, "GET");
    await send(swept, `${site.otherOrigin}/player-data/player`, "POST");
    assert.equal(outside("GET", "/survey-config"), before);
    assert.equal(outside("POST", "/player-data/player"), posted);
    await sweep.close();
  } finally {
    setRunScope(null);
    setFixedReads(null);
    await browser.close();
  }
});
