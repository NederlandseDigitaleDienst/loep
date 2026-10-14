import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { timeLimits, timeLimitsAfterSubmit } from "../src/instruments/timelimits.ts";
import { filledFields } from "../src/commands/modelsweep.ts";
import { timing } from "../src/lib/extractors.ts";
import { judgeTimer, sessionWatchAnswers, SESSION_POINT_MARK, type TimeLimitProbe, type WatchState } from "../src/lib/timelimits.ts";
import { applyAnswers } from "../src/lib/evaluation.ts";
import type { PageData, RunData } from "../src/lib/rundata.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/** What can be a time limit (2.2.1): measured on pages of the test site, and what the dossier makes of it. */

let site: FixtureServer;
let browser: Browser;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  await site.close();
});

async function open(path: string): Promise<Page> {
  const context = await newContext(browser);
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

async function measure(path: string, waitMs = 0): Promise<TimeLimitProbe> {
  const page = await open(path);
  try {
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    return await timeLimits(page);
  } finally {
    await page.context().close();
  }
}

const page = (label: string, probe: TimeLimitProbe): PageData => ({ label, item: { url: `${site.origin}/${label}` }, timeLimits: probe, facts: { timers: { intervals: [], longTimeouts: [] } } }) as unknown as PageData;
const pageData = page;
const runOf =(pages: PageData[], extra: Record<string, unknown> = {}): RunData => ({ pages, states: null, contrast: null, dir: "", inventory: { totals: {} }, sample: { items: [] }, ...extra }) as unknown as RunData;
type Limits = { examined: boolean; found: boolean; conclusionNl: string; basisNl: string[]; metaRefresh: { seconds: number; limit: string }[]; timers: { limit: string; whatHappenedNl: string[]; wentOff: string; where: string[] }[] };
const limitsOf = (run: RunData): Limits => (timing(run, "2.2.1") as { limits: Limits }).limits;

test("2.2.1: a page without timers, cookies or stored values has no time limit, and the dossier says what that rests on", async () => {
  const probe = await measure("/limit-none.html");
  assert.deepEqual(probe.timers, []);
  assert.deepEqual(probe.metaRefresh, []);
  assert.deepEqual(probe.cookies, []);
  assert.deepEqual([probe.storage.now.localStorage, probe.storage.now.sessionStorage], [[], []]);
  const limits = limitsOf(runOf([page("P01", probe)]));
  assert.equal(limits.found, false);
  assert.equal(limits.conclusionNl, "Geen tijdslimiet gevonden.");
  assert.ok(limits.basisNl.includes("De site zet geen eigen cookies."), limits.basisNl.join(" | "));
  assert.ok(limits.basisNl.includes("Er is niet ingelogd."));
});

test("2.2.1: a meta refresh is read with its wait and counts as a time limit", async () => {
  const probe = await measure("/limit-refresh.html");
  assert.equal(probe.metaRefresh.length, 1);
  assert.equal(probe.metaRefresh[0]!.seconds, 600);
  assert.equal(probe.metaRefresh[0]!.url, `${site.origin}/limit-none.html`);
  const limits = limitsOf(runOf([page("P01", probe)]));
  assert.equal(limits.found, true);
  assert.match(limits.metaRefresh[0]!.limit, /^tijdslimiet/);
  assert.match(limits.conclusionNl, /meta refresh/);
});

test("2.2.1: a timer of fifteen minutes that empties a form is set off at the end of the measurement and found", async () => {
  const started = Date.now();
  const probe = await measure("/limit-clear.html");
  assert.ok(Date.now() - started < 15_000, "nobody waits fifteen minutes");
  const timer = probe.timers.find((entry) => entry.delayMs === 900_000);
  assert.ok(timer, JSON.stringify(probe.timers));
  assert.equal(timer.forced, true);
  assert.equal(probe.fieldsFilledBeforeFiring, 2, "the empty fields got a value first, so emptying them shows");
  assert.deepEqual(timer.effects.map((entry) => entry.effect), ["clearsForm"]);
  assert.equal(judgeTimer(timer).limit, true);
  const limits = limitsOf(runOf([page("P01", probe)]));
  assert.equal(limits.found, true);
  assert.equal(limits.timers[0]!.limit, "kan een tijdslimiet zijn");
  assert.deepEqual(limits.timers[0]!.whatHappenedNl, ["maakt een formulier leeg"]);
  assert.equal(limits.timers[0]!.wentOff, "door loep laten afgaan aan het eind van de meting");
});

test("2.2.1: a loading animation that shows a result after three seconds is no time limit", async () => {
  const probe = await measure("/limit-loading.html", 3500);
  const result = probe.timers.find((entry) => entry.kind === "timeout");
  const dots = probe.timers.find((entry) => entry.kind === "interval");
  assert.ok(result && dots, JSON.stringify(probe.timers));
  assert.equal(result.fired, 1);
  assert.equal(result.forced, false);
  assert.deepEqual(result.effects.map((entry) => entry.effect), ["replaces"]);
  assert.ok(result.shownText?.some((line) => line.includes("120 euro")));
  assert.equal(judgeTimer(result).limit, false);
  assert.equal(dots.cleared, true);
  assert.ok(dots.fired > 3);
  assert.equal(judgeTimer(dots).limit, false, judgeTimer(dots).whyNl);
  const limits = limitsOf(runOf([page("P01", probe)]));
  assert.equal(limits.found, false, JSON.stringify(limits.timers));
  assert.equal(limits.conclusionNl, "Geen tijdslimiet gevonden.");
});

test("2.2.1: the rule for a timer: what it did decides, not that it exists", () => {
  const timer = (extra: Record<string, unknown>) => ({ kind: "timeout", delayMs: 5000, startedAtMs: 0, fired: 1, firstFiredAtMs: 5000, cleared: false, forced: false, effects: [], ...extra }) as Parameters<typeof judgeTimer>[0];
  assert.equal(judgeTimer(timer({ effects: [{ effect: "navigates", to: "https://site.nl/uitgelogd" }] })).limit, true);
  assert.equal(judgeTimer(timer({ effects: [{ effect: "removes" }] })).limit, true, "a message that goes away is for the judge to read");
  assert.equal(judgeTimer(timer({ effects: [{ effect: "shows" }] })).limit, false);
  assert.equal(judgeTimer(timer({ delayMs: 25 * 60_000, forced: true, fired: 0, effects: [{ effect: "opensWindow", how: "dialog" }] })).limit, true);
  assert.equal(judgeTimer(timer({ delayMs: 25 * 60_000, forced: true, fired: 0, effects: [{ effect: "shows" }] })).limit, true, "what shows after twenty seconds can be the warning");
  assert.equal(judgeTimer(timer({ kind: "interval", delayMs: 5000, effects: [{ effect: "replaces" }] })).limit, false, "a carousel is for 2.2.2");
  assert.equal(judgeTimer(timer({ fired: 0, cleared: true })).limit, false);
  assert.equal(judgeTimer(timer({ fired: 0 })).limit, null);
});

test("2.2.1: in a run with a login the dossier says what the watch on the session saw, and evaluate closes the point about it", () => {
  const base: WatchState = { status: "stopped", reasonNl: "gestopt bij evaluate", longestQuietAliveMinutes: 80, checks: [5, 10, 20, 40, 80].map((quiet) => ({ quietMinutes: quiet, alive: true })), expired: null, warning: null, beforeExpiry: null, mainSessionExpiredAt: null, startedAt: "2026-10-14T08:00:00Z", stoppedAt: "2026-10-14T11:00:00Z", maxHours: 8 };
  const login = { origin: "https://site.nl", loginUrl: "https://site.nl/inloggen", landingUrl: "https://site.nl/mijn", role: "aanvrager", loggedInAt: "2026-10-14T07:59:00Z" };
  const session = (watch: WatchState | null) => (timing(runOf([], { login, sessionWatch: watch }), "2.2.1") as { session: { status: string; conclusionNl: string } }).session;
  assert.equal(session(base).conclusionNl, "Binnen een stilte van 80 minuten is de sessie niet verlopen.");
  assert.match(session({ ...base, status: "expired", longestQuietAliveMinutes: 10, expired: { at: "x", quietMinutes: 20, minutesAfterLogin: 36, reasonNl: "de site leidde om naar de inlogpagina" } }).conclusionNl, /^De sessie verliep na een stilte van hooguit 20 minuten, 36 minuten na het inloggen, zonder dat er vooraf een waarschuwing/);
  assert.equal(session({ ...base, status: "running" }).status, "running");
  assert.match(session(null).conclusionNl, /niet gedraaid/);
  // The open point about the duration is closed by a watch that saw no expiry, and only by that.
  const points = [`keuze nodig: ${SESSION_POINT_MARK}: hoe lang de sessie stil mag liggen.`];
  const answers = sessionWatchAnswers(base, points);
  assert.equal(answers.length, 1);
  assert.equal(answers[0]!.instrument, true);
  assert.equal(applyAnswers(points, answers).outcome, "passed");
  assert.deepEqual(sessionWatchAnswers({ ...base, status: "expired" }, points), []);
  assert.deepEqual(sessionWatchAnswers({ ...base, status: "running" }, points), []);
  assert.deepEqual(sessionWatchAnswers(base, ["keuze nodig: iets anders"]), []);
});

test("2.2.1: a page that was measured before this probe existed says so", () => {
  const older = runOf([{ label: "P01", item: { url: "x" }, facts: { timers: { intervals: [], longTimeouts: [] } } } as unknown as PageData]);
  assert.equal(limitsOf(older).examined, false);
});

test("2.2.1: a form a recipe filled in is sent, and a timer that sending starts is found apart from the timers of the page", async () => {
  const tab = await open("/limit-submit.html");
  try {
    await tab.fill("#naam", "Test Persoon");
    await tab.selectOption("#soort", "Klacht");
    const after = await timeLimitsAfterSubmit(tab, [["#naam"], ["#soort"]], () => false);
    assert.equal(after.submitted, true, after.notSubmittedNl ?? "");
    assert.equal(after.method, "get");
    assert.equal(after.submitControl, 'button "Aanvraag versturen"');
    assert.equal(after.navigated, false);
    assert.equal(after.writesRefused, 0);
    assert.deepEqual(after.startedAfterSubmit.map((timer) => timer.delayMs), [600_000], "the timer the page started on load is not one of them");
    const timer = after.startedAfterSubmit[0]!;
    assert.equal(timer.forced, true);
    assert.equal(judgeTimer(timer).limit, true, judgeTimer(timer).whyNl);
    assert.ok(after.probe!.timers.some((entry) => entry.delayMs === 10_000), "the whole measurement is kept");
    // In the dossier: the state with its form sent, and the timer among the possible limits.
    const run = runOf([pageData("P01", { ...after.probe!, timers: [] })], { siteStates: { states: [{ id: "process-aanvraag", kind: "process", reached: true, url: `${site.origin}/limit-submit.html` }] }, stateEvidence: { "process-aanvraag": { timeLimitsAfterSubmit: after } } });
    const limits = limitsOf(run) as Limits & { afterSubmit: { state: string; sent: boolean; navigated: string; timersStarted: { delayMs: number; limit: string }[] }[] };
    assert.equal(limits.found, true);
    assert.deepEqual(limits.afterSubmit.map((row) => [row.state, row.sent, row.navigated]), [["process-aanvraag", true, "nee, op dezelfde pagina gebleven"]]);
    assert.deepEqual(limits.afterSubmit[0]!.timersStarted.map((row) => [row.delayMs, row.limit]), [[600_000, "kan een tijdslimiet zijn"]]);
    assert.deepEqual(limits.timers.filter((row) => row.limit === "kan een tijdslimiet zijn").map((row) => row.where), [["process-aanvraag na versturen"]]);
  } finally {
    await tab.context().close();
  }
});

test("2.2.1: the sweep sends only the form of a recipe that ends with filling it in", () => {
  const step = (command: string, target: string[] | null) => ({ command, args: [], options: {}, target });
  assert.deepEqual(filledFields({ steps: [step("click", ["#open"]), step("type", ["#naam", "input"]), step("select", ["#soort"])] }), [["#naam", "input"], ["#soort"]]);
  assert.deepEqual(filledFields({ steps: [step("type", ["#q"]), step("press", ["#q"])] }), [], "a recipe that sends the form itself is measured after sending already");
  assert.deepEqual(filledFields({ steps: [step("click", ["#menu"])] }), []);
  assert.deepEqual(filledFields(undefined), []);
});

test("2.2.1: a form that posts to another page is not sent where the run may not write", async () => {
  const tab = await open("/limit-submit.html");
  try {
    await tab.fill("#bericht", "Hallo");
    const before = site.requests.length;
    const after = await timeLimitsAfterSubmit(tab, [["#bericht"]], () => false);
    assert.equal(after.submitted, false);
    assert.equal(after.method, "post");
    assert.match(after.notSubmittedNl ?? "", /POST naar \/opslaan.*niet verstuurd/);
    assert.equal(after.probe, null);
    await tab.waitForTimeout(300);
    assert.deepEqual(site.requests.slice(before).filter((request) => request.method !== "GET"), [], "nothing was sent to the server");
  } finally {
    await tab.context().close();
  }
});
