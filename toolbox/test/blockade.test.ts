import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { Blockade, BLOCKADES_FILE, blockadesNl, MAX_FAILED_NAVIGATIONS, OriginBlocked, readBlockades, retryAfterSeconds, setRunBlockade, type BlockadeEntry } from "../src/session/blockade.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
const runs: string[] = [];

before(async () => {
  site = await startServer();
});

after(async () => {
  await site.close();
  for (const dir of runs) rmSync(dir, { recursive: true, force: true });
});

function newRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "loep-blockade-"));
  runs.push(dir);
  return dir;
}

/** A session process for a site on two origins: the fixture site, and the same server under another name. */
async function daemonFor(run: string): Promise<{ daemon: Daemon; loep: (command: string, ...args: string[]) => Promise<{ ok: boolean; print: Record<string, unknown> }> }> {
  const daemon = await Daemon.create(run, { hosts: ["127.0.0.1", "localhost"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  await daemon.handle({ op: "start", session: "main" });
  return { daemon, loep: (command, ...args) => daemon.handle({ op: "command", session: "main", command, args, options: {} }) };
}

const observation = (run: string, id: string): Observation => JSON.parse(readFileSync(join(run, "observations", "main", `${id.slice(-4)}.json`), "utf8")) as Observation;
const reached = (path: string): number => site.requests.filter((request) => request.path === path).length;

test("after a 429 the session process asks that origin nothing more for the rest of the run, says so, and a new process keeps to it", async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  try {
    const answered = await loep("open", "/too-many");
    assert.equal(answered.print.status, 429);
    assert.match(answered.print.blockade as string, new RegExp(`^${site.origin.replace(/[.]/g, "\\.")} antwoordde om \\d\\d:\\d\\d met 429 \\(te veel verzoeken\\); het sessieproces vraagt daar de rest van de run niets meer \\(blockades\\.json in de run\\)\\. Schrijf .*"niet bereikbaar: <adres>, `));
    assert.deepEqual(observation(run, answered.print.id as string).blockades!.map((entry) => [entry.origin, entry.reason, entry.until]), [[site.origin, "429", null]]);
    // The next page of that origin is not asked for at all.
    const before = site.requests.length;
    const refused = await loep("open", "/form.html");
    assert.equal(refused.ok, false);
    assert.match(refused.print.error as string, /\/form\.html is niet opgevraagd: .*met 429/);
    assert.match(refused.print.blockade as string, /met 429/);
    assert.deepEqual(observation(run, refused.print.id as string).blocked.map((entry) => entry.kind), ["blockade"]);
    // Nor what a page of another origin asks of it.
    assert.equal((await loep("open", `${site.otherOrigin}/`)).ok, true);
    assert.equal(site.requests.length - before, site.requests.slice(before).filter((request) => request.host === "localhost").length, "nothing more reached 127.0.0.1");
    assert.deepEqual(readBlockades(run).map((entry) => entry.reason), ["429"]);
  } finally {
    await daemon.close();
  }
  // A new session process reads the run and goes on refusing.
  const again = await daemonFor(run);
  try {
    const count = reached("/");
    const refused = await again.loep("open", "/");
    assert.equal(refused.ok, false);
    assert.equal(reached("/"), count);
  } finally {
    await again.daemon.close();
  }
  // Evaluate names it among the limitations, and with it the report.
  assert.match(blockadesNl(run)[0]!, new RegExp(`^${site.origin.replace(/[.]/g, "\\.")} heeft verzoeken van het onderzoek geweigerd: de site antwoordde met 429 \\(te veel verzoeken\\), op \\d{4}-\\d\\d-\\d\\d om \\d\\d:\\d\\d\\. Daarna is daar niets meer gevraagd`));
});

test("a short Retry-After is waited out: the origin is refused until then and asked again after", async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  try {
    const answered = await loep("open", "/too-many?retry=1");
    assert.match(answered.print.blockade as string, /het sessieproces vraagt daar niets tot \d\d:\d\d:\d\d, zoals de site vroeg\. Doe het daarna opnieuw$/);
    assert.equal((await loep("open", "/")).ok, false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal((await loep("open", "/")).ok, true);
    assert.deepEqual(blockadesNl(run), [`${site.origin} vroeg één keer om even te wachten (429 met Retry-After); het onderzoek heeft dat aangehouden.`]);
  } finally {
    await daemon.close();
  }
});

test(`after ${MAX_FAILED_NAVIGATIONS} failed navigations to one origin while another loads, that origin is left alone; without another that loads it is not`, async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  try {
    // Only one origin was tried: it may be the network of this machine, not the site.
    for (let attempt = 0; attempt < MAX_FAILED_NAVIGATIONS; attempt++) assert.equal((await loep("open", "/drop")).ok, false);
    assert.deepEqual(readBlockades(run), []);
    // Another origin loads; one more failure of the first is enough now, as the count went on.
    assert.equal((await loep("open", `${site.otherOrigin}/`)).ok, true);
    const failed = await loep("open", "/drop");
    assert.match(failed.print.blockade as string, new RegExp(`^${MAX_FAILED_NAVIGATIONS} navigaties naar ${site.origin.replace(/[.]/g, "\\.")} op rij mislukten`));
    assert.deepEqual(readBlockades(run).map((entry) => entry.reason), ["failures"]);
    const count = reached("/");
    assert.equal((await loep("open", "/")).ok, false);
    assert.equal(reached("/"), count);
  } finally {
    await daemon.close();
  }
});

test("a navigation that loads resets the count, and Retry-After is read as seconds or as a date", () => {
  const run = newRun();
  let clock = Date.parse("2026-10-20T10:00:00Z");
  const blockade = new Blockade(run, () => clock);
  blockade.loaded("https://other.example.nl/");
  blockade.failed("https://www.example.nl/a");
  blockade.failed("https://www.example.nl/b");
  blockade.loaded("https://www.example.nl/c");
  blockade.failed("https://www.example.nl/d");
  blockade.failed("https://www.example.nl/e");
  assert.equal(blockade.refuses("https://www.example.nl/"), null);
  blockade.failed("wss://www.example.nl/socket");
  // A socket counts with its https twin.
  assert.equal(blockade.refuses("https://www.example.nl/f")?.reason, "failures");
  assert.equal(blockade.refuses("wss://www.example.nl/other")?.reason, "failures");
  assert.equal(blockade.refuses("https://other.example.nl/"), null);
  assert.equal(retryAfterSeconds("30", clock), 30);
  assert.equal(retryAfterSeconds(new Date(clock + 45_000).toUTCString(), clock), 45);
  assert.equal(retryAfterSeconds("morgen", clock), null);
  assert.equal(retryAfterSeconds(undefined, clock), null);
  // A long Retry-After is not waited out: the rest of the run.
  blockade.tooMany("https://api.example.nl/x", "3600");
  assert.equal(blockade.refuses("https://api.example.nl/y")?.until, null);
  blockade.tooMany("https://cdn.example.nl/x", "10");
  assert.equal(blockade.refuses("https://cdn.example.nl/y")?.until, new Date(clock + 10_000).toISOString());
  clock += 11_000;
  assert.equal(blockade.refuses("https://cdn.example.nl/y"), null);
  const stored = JSON.parse(readFileSync(join(run, BLOCKADES_FILE), "utf8")) as { origins: BlockadeEntry[] };
  assert.deepEqual(stored.origins.map((entry) => `${entry.origin} ${entry.reason}`), ["https://www.example.nl failures", "https://api.example.nl 429", "https://cdn.example.nl 429"]);
  // A file that cannot be read blocks nothing.
  writeFileSync(join(run, BLOCKADES_FILE), "{");
  assert.deepEqual(readBlockades(run), []);
  assert.equal(existsSync(join(newRun(), BLOCKADES_FILE)), false);
});

test("the sweep asks a blocked origin nothing, notes a 429 it gets itself, and sees what another process noted", async () => {
  const run = newRun();
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${site.origin}/`, origin: site.origin, pages: [] }));
  setRunBlockade(run);
  const browser = await launchBrowser();
  try {
    const page = await (await newContext(browser, { writes: null })).newPage();
    // The session process, another process, blocks an origin while the sweep runs: that holds for the sweep at once.
    new Blockade(run).tooMany(`${site.otherOrigin}/x`, undefined);
    await assert.rejects(loadPage(page, `${site.otherOrigin}/`), OriginBlocked);
    // A 429 without Retry-After for a page of the site: noted for the rest of the run next to what the other process noted, and the page is not measured.
    await assert.rejects(loadPage(page, `${site.origin}/too-many`), (error: Error) => error instanceof OriginBlocked && /\/too-many is niet opgevraagd: .*met 429 \(te veel verzoeken\); loep vraagt daar de rest van de run niets meer/.test(error.message));
    assert.deepEqual(readBlockades(run).map((entry) => [entry.origin, entry.reason, entry.until]), [[site.otherOrigin, "429", null], [site.origin, "429", null]]);
    // The next page of that origin is not asked for, nor what a page asks of it.
    const count = site.requests.length;
    await assert.rejects(loadPage(page, `${site.origin}/`), OriginBlocked);
    await page.evaluate((url) => fetch(url).catch(() => null), `${site.origin}/form.html`);
    assert.equal(site.requests.length, count, "nothing more reached the site");
  } finally {
    setRunBlockade(null);
    await browser.close();
  }
});
