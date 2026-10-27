import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { Blockade, BLOCKADES_FILE, blockadesNl, endOf, FAILURE_PAUSE_SECONDS, isLasting, LONGEST_FAILURE_PAUSE_SECONDS, MAX_FAILED_NAVIGATIONS, OriginBlocked, readBlockades, retryAfterSeconds, setRunBlockade, type BlockadeEntry } from "../src/session/blockade.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { VOICEOVER_FOR_TESTS } from "../src/session/voiceover-command.ts";
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
  const daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host, new URL(site.otherOrigin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
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

test("media and voiceover fetch nothing from a blocked origin outside the browser either, and say why", async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  VOICEOVER_FOR_TESTS.guest = { state: async () => "running", boot: async () => undefined, halt: async () => undefined, exec: async () => "" };
  try {
    assert.equal((await loep("open", "/media.html")).ok, true);
    const film = String((((await loep("find", "css:#film")).print.found as string[]) ?? [])[0]).split(" ")[0]!;
    // Another process notes a 429 of the site while the page is open: the file, the subtitles and the page are not asked for.
    new Blockade(run).tooMany(`${site.origin}/x`, undefined);
    const count = site.requests.length;
    const listened = await daemon.handle({ op: "command", session: "main", command: "media", args: [film], options: { listen: true, wait: true } });
    assert.match(listened.print.blockade as string, /met 429/);
    assert.deepEqual(
      observation(run, listened.print.id as string).blocked.map((entry) => [entry.kind, entry.resourceType]),
      [["blockade", "texttrack"], ["blockade", "media"]],
    );
    const read = await loep("voiceover");
    assert.equal(read.ok, false);
    assert.match(read.print.error as string, /^de pagina kon niet worden opgehaald: .*\/media\.html is niet opgevraagd: .*met 429/);
    assert.equal(site.requests.length, count, "nothing more reached the site");
  } finally {
    VOICEOVER_FOR_TESTS.guest = null;
    await daemon.close();
  }
});

test(`after ${MAX_FAILED_NAVIGATIONS} failed navigations to one origin while another loads meanwhile, that origin is left alone for a pause`, async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  try {
    assert.equal((await loep("open", "/drop")).ok, false);
    // Another origin loads while the first one fails: it is that origin, not the whole site.
    assert.equal((await loep("open", `${site.otherOrigin}/`)).ok, true);
    assert.equal((await loep("open", "/drop")).ok, false);
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

test(`after ${MAX_FAILED_NAVIGATIONS} failed navigations while nothing else of the site loads, the session process notes an outage, tells the agent to stop, and asks the site nothing during the pause`, async () => {
  const run = newRun();
  const { daemon, loep } = await daemonFor(run);
  try {
    for (let attempt = 1; attempt < MAX_FAILED_NAVIGATIONS; attempt++) assert.equal((await loep("open", "/drop")).print.blockade, undefined);
    const failed = await loep("open", "/drop");
    assert.match(failed.print.blockade as string, new RegExp(`^storing van de site: ${site.origin.replace(/[.]/g, "\\.")} antwoordt niet, ${MAX_FAILED_NAVIGATIONS} navigaties op rij kregen geen antwoord of geen verbinding \\(de laatste om \\d\\d:\\d\\d\\) en in die tijd laadde niets anders van de site\\. Het sessieproces vraagt de site niets tot \\d\\d:\\d\\d:\\d\\d en kijkt dan met één verzoek of ze terug is\\. Dit is geen "niet bereikbaar"`));
    assert.match(failed.print.blockade as string, /stop je sessie en antwoord alleen met "storing van de site"/);
    const [entry] = readBlockades(run);
    assert.deepEqual([entry!.reason, Date.parse(entry!.until!) - Date.parse(entry!.at)], ["outage", FAILURE_PAUSE_SECONDS * 1000]);
    // The next page is not asked for: the agent hears why, and not a failed navigation it has to explain.
    const count = site.requests.length;
    const refused = await loep("open", "/form.html");
    assert.equal(refused.ok, false);
    assert.match(refused.print.error as string, /\/form\.html is niet opgevraagd: storing van de site: /);
    assert.match(refused.print.blockade as string, /^storing van de site: /);
    assert.equal(site.requests.length, count, "nothing reached the site");
  } finally {
    await daemon.close();
  }
  assert.match(blockadesNl(run)[0]!, new RegExp(`^${site.origin.replace(/[.]/g, "\\.")} had een storing: de site antwoordde niet vanaf \\d{4}-\\d\\d-\\d\\d om \\d\\d:\\d\\d, en het onderzoek wachtte één keer een pauze af\\. In die tijd is daar niets gevraagd\\.$`));
});

test("after the pause of an outage one request asks whether the site is back: no answer pauses longer, an answer lets the sessions in again", async () => {
  // An outage an earlier process noted, whose pause is over.
  const over = (path: string): BlockadeEntry => ({ origin: site.origin, reason: "outage", at: new Date(Date.now() - 400_000).toISOString(), until: new Date(Date.now() - 100_000).toISOString(), url: `${site.origin}${path}` });
  const settled = async (run: string, done: (entries: BlockadeEntry[]) => boolean): Promise<BlockadeEntry[]> => {
    for (let tries = 0; tries < 100 && !done(readBlockades(run)); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
    return readBlockades(run);
  };
  const down = newRun();
  writeFileSync(join(down, BLOCKADES_FILE), JSON.stringify({ origins: [over("/drop")] }));
  const first = await daemonFor(down);
  try {
    const drops = reached("/drop");
    const index = reached("/");
    const asked = await first.loep("open", "/");
    assert.match(asked.print.error as string, /De pauze is om: het sessieproces kijkt nu met één verzoek of de site terug is\. Wacht een halve minuut en doe dit dan opnieuw$/);
    const entries = await settled(down, (now) => now.length === 2);
    // No answer: the next pause is twice as long, and the agent that asks again hears it.
    assert.deepEqual([entries[1]!.reason, Date.parse(entries[1]!.until!) - Date.parse(entries[1]!.at)], ["outage", 2 * FAILURE_PAUSE_SECONDS * 1000]);
    assert.match((await first.loep("open", "/")).print.error as string, /vraagt de site niets tot \d\d:\d\d:\d\d en kijkt dan met één verzoek/);
    assert.equal(reached("/drop") - drops, 1, "one request asked whether the site is back");
    assert.equal(reached("/"), index, "no session asked the site");
  } finally {
    await first.daemon.close();
  }
  const up = newRun();
  writeFileSync(join(up, BLOCKADES_FILE), JSON.stringify({ origins: [over("/")] }));
  const second = await daemonFor(up);
  try {
    assert.equal((await second.loep("open", "/form.html")).ok, false);
    const [entry] = await settled(up, (now) => Boolean(now[0]?.back));
    assert.ok(entry!.back, "the site answered, and the run says when");
    assert.equal((await second.loep("open", "/form.html")).ok, true);
  } finally {
    await second.daemon.close();
  }
  assert.match(blockadesNl(up)[0]!, /; de site antwoordde weer om \d\d:\d\d\. In die tijd is daar niets gevraagd\.$/);
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

test("failed navigations pause an origin and do not give it up: the pause ends, doubles when it fails again, and an entry of an older run ends too", () => {
  const run = newRun();
  let clock = Date.parse("2026-10-21T09:23:00Z");
  const blockade = new Blockade(run, () => clock);
  blockade.loaded("https://other.example.nl/");
  // Another origin of the site loads meanwhile: it is this origin that fails, not the site.
  const failThrice = (): void => {
    for (let attempt = 0; attempt < MAX_FAILED_NAVIGATIONS; attempt++) {
      blockade.failed(`https://www.example.nl/${attempt}`);
      blockade.loaded("https://other.example.nl/");
    }
  };
  failThrice();
  const first = blockade.refuses("https://www.example.nl/")!;
  assert.equal(isLasting(first), false);
  assert.equal(first.until, new Date(clock + FAILURE_PAUSE_SECONDS * 1000).toISOString());
  assert.match(new OriginBlocked("https://www.example.nl/", first).message, /probeert het daarna opnieuw/);
  clock += FAILURE_PAUSE_SECONDS * 1000 + 1;
  assert.equal(blockade.refuses("https://www.example.nl/"), null);
  failThrice();
  assert.equal(blockade.refuses("https://www.example.nl/")!.until, new Date(clock + 2 * FAILURE_PAUSE_SECONDS * 1000).toISOString());
  for (let round = 0; round < 6; round++) {
    clock = endOf(blockade.refuses("https://www.example.nl/")!)! + 1;
    failThrice();
  }
  assert.equal(blockade.refuses("https://www.example.nl/")!.until, new Date(clock + LONGEST_FAILURE_PAUSE_SECONDS * 1000).toISOString());
  assert.match(blockadesNl(run)[0]!, /^https:\/\/www\.example\.nl antwoordde 8 keer niet op \d navigaties op rij; het onderzoek vroeg daar dan een tijd niets en ging daarna verder/);
  // An older run noted failures for the rest of the run: that entry ends one pause after it was noted.
  const old: BlockadeEntry = { origin: "https://www.example.nl", reason: "failures", at: "2026-10-21T09:23:28.286Z", until: null, url: "https://www.example.nl/contact" };
  assert.equal(endOf(old), Date.parse(old.at) + FAILURE_PAUSE_SECONDS * 1000);
  const older = newRun();
  writeFileSync(join(older, BLOCKADES_FILE), JSON.stringify({ origins: [old] }));
  const later = new Blockade(older, () => Date.parse(old.at) + FAILURE_PAUSE_SECONDS * 1000 + 1);
  assert.equal(later.refuses("https://www.example.nl/"), null);
  // A 429 without a short Retry-After still ends the asking for the rest of the run.
  blockade.tooMany("https://api.example.nl/x", undefined);
  assert.equal(isLasting(blockade.refuses("https://api.example.nl/")!), true);
});

test("an outage pauses longer each time the one request after a pause gets no answer, ends with an answer or a page that loads, and starts short again", async () => {
  const run = newRun();
  let clock = Date.parse("2026-10-23T07:41:00Z");
  let answers = false;
  const probes: string[] = [];
  const blockade = new Blockade(run, () => clock, async (url) => {
    probes.push(url);
    return answers;
  });
  const failThrice = (): void => {
    for (let attempt = 0; attempt < MAX_FAILED_NAVIGATIONS; attempt++) blockade.failed(`https://www.example.nl/${attempt}`);
  };
  // A page of another origin loaded before the site went down: that says nothing about now.
  blockade.loaded("https://other.example.nl/");
  clock += 1000;
  failThrice();
  assert.equal(blockade.refuses("https://www.example.nl/")?.reason, "outage");
  assert.equal(blockade.refuses("https://other.example.nl/"), null, "an outage holds for its own origin");
  assert.deepEqual(probes, [], "no request during the pause");
  const pauses: number[] = [];
  for (let round = 0; round < 5; round++) {
    const outage = blockade.refuses("https://www.example.nl/")!;
    pauses.push((endOf(outage)! - Date.parse(outage.at)) / 1000);
    clock = endOf(outage)! + 1;
    // After the pause everything stays refused until the one request is answered, and asking again starts no second one.
    assert.equal(blockade.refuses("https://www.example.nl/a"), outage);
    assert.equal(blockade.refuses("https://www.example.nl/b"), outage);
    await blockade.pause("https://www.example.nl/c", 0);
  }
  assert.deepEqual(pauses, [FAILURE_PAUSE_SECONDS, 2 * FAILURE_PAUSE_SECONDS, 4 * FAILURE_PAUSE_SECONDS, LONGEST_FAILURE_PAUSE_SECONDS, LONGEST_FAILURE_PAUSE_SECONDS]);
  assert.equal(probes.length, 5, "one request per pause");
  assert.deepEqual(new Set(probes), new Set(["https://www.example.nl/2"]), "it asks the address that failed last");
  // What pending sees: the outage, and since when.
  const pending = new Blockade(run, () => clock, async () => false);
  assert.deepEqual((await pending.outages()).map((entry) => entry.origin), ["https://www.example.nl"]);
  assert.equal(pending.outageSince("https://www.example.nl"), "2026-10-23T07:41:01.000Z");
  // The site answers: the sweep that waits gets in, and so does pending in another process.
  answers = true;
  clock = endOf(blockade.refuses("https://www.example.nl/")!)! + 1;
  assert.equal(await blockade.pause("https://www.example.nl/", LONGEST_FAILURE_PAUSE_SECONDS), null);
  assert.equal(blockade.refuses("https://www.example.nl/"), null);
  assert.ok(readBlockades(run).at(-1)!.back);
  assert.deepEqual(await new Blockade(run, () => clock, async () => false).outages(), []);
  // A new outage is a new one: its first pause is short again. A page of the origin that loads ends it too.
  failThrice();
  assert.equal(endOf(blockade.refuses("https://www.example.nl/")!)! - clock, FAILURE_PAUSE_SECONDS * 1000);
  blockade.loaded("https://www.example.nl/");
  assert.equal(blockade.refuses("https://www.example.nl/"), null);
  assert.match(blockadesNl(run)[0]!, /^https:\/\/www\.example\.nl had een storing: de site antwoordde niet vanaf 2026-10-23 om \d\d:\d\d, en het onderzoek wachtte 7 keer een pauze af; de site antwoordde weer om \d\d:\d\d\./);
  // A sweep that may wait no longer than the pause hears why, as an agent does.
  failThrice();
  assert.match(new OriginBlocked("https://www.example.nl/", blockade.refuses("https://www.example.nl/")!).message, /^https:\/\/www\.example\.nl\/ is niet opgevraagd: storing van de site: /);
  assert.equal(isLasting(blockade.refuses("https://www.example.nl/")!), false);
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
