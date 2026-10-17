import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { firefox, webkit, type Browser, type Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { probeForms } from "../src/instruments/forms.ts";
import { formErrors } from "../src/lib/extractors.ts";
import { REGULAR_PATH, type RunData } from "../src/lib/rundata.ts";
import { budgetOutPointNl, decideWrites, DEFAULT_MAX_WRITES, DEFAULT_WRITE_SPACING_SECONDS, recordWrites, WRITES_BLOCKED_NL, writeAccess, writeBudget, writeBudgetNl, writesAllowedNl, writesForRun, type PassedWrite, type WritePermission } from "../src/lib/writes.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness, scopeForRun } from "../src/session/safety.ts";
import { openSurface } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
let site: FixtureServer;
let browser: Browser;
let run: string;
let permission: WritePermission;

before(async () => {
  site = await startServer();
  browser = await launchBrowser();
  run = mkdtempSync(join(tmpdir(), "loep-writes-"));
  // Room enough for the tests that are not about the budget for sending; those set their own.
  permission = { ...decideWrites(`${site.origin}/`, { allowWrites: true })!, maxWrites: 100, spacingSeconds: 0 };
});

after(async () => {
  await browser.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

const logged = (dir: string): PassedWrite[] => (existsSync(join(dir, "writes.jsonl")) ? readFileSync(join(dir, "writes.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as PassedWrite) : []);
const writesReceived = (): string[] => site.requests.filter((request) => request.method !== "GET" && request.path !== "/chat").map((request) => `${request.method} ${request.host}${request.path}`);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));

function reset(): void {
  site.requests.length = 0;
  site.socketMessages.length = 0;
  rmSync(join(run, "writes.jsonl"), { force: true });
}

async function pageWith(writes: boolean, path: string): Promise<Page> {
  // The guard that silences sockets is on, as it is while a probe of the sweep acts on a page.
  const context = await newContext(browser, { writes: writes ? writeAccess(run, permission, "test") : null }, { active: true, blocked: 0 });
  await context.addInitScript({ path: INPAGE_PATH });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}${path}`);
  return page;
}

test("writing needs an explicit flag on a local address and a declaration by a person anywhere else", () => {
  const now = new Date("2026-01-02T03:04:05Z");
  assert.equal(decideWrites("https://www.example.nl/", {}), null);
  assert.deepEqual(decideWrites("http://127.0.0.1:4710/", { allowWrites: true }, now), { origin: "http://127.0.0.1:4710", local: true, declaredBy: null, declaredAt: "2026-01-02T03:04:05.000Z", maxWrites: 5, spacingSeconds: 120 });
  assert.equal(decideWrites("http://127.0.0.1:4710/", { allowWrites: true, maxWrites: "12" })?.maxWrites, 12);
  for (const wrong of ["0", "-1", "2.5", "veel", ""]) assert.throws(() => decideWrites("http://127.0.0.1:4710/", { allowWrites: true, maxWrites: wrong }), /--max-writes verwacht een geheel getal van 1 of meer/, wrong);
  assert.throws(() => decideWrites("https://www.example.nl/", { maxWrites: "3" }), /--max-writes hoort bij een run die mag versturen/);
  for (const local of ["http://localhost:3000/", "http://[::1]:8080/x", "https://gemeente.test/", "http://app.localhost/"]) assert.equal(decideWrites(local, { allowWrites: true })?.local, true, local);
  assert.throws(() => decideWrites("https://www.example.nl/", { allowWrites: true }), /geen lokaal adres.*--test-environment <origin> en --declared-by/s);
  assert.throws(() => decideWrites("https://nottest.example/", { allowWrites: true }), /geen lokaal adres/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "https://test.example.nl" }), /geef dan beide op/);
  assert.throws(() => decideWrites("https://www.example.nl/", { declaredBy: "Een Beheerder, functioneel beheerder" }), /geef dan beide op/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "https://test.example.nl", declaredBy: "Een Beheerder" }), /een naam en een functie/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "test.example.nl", declaredBy: "Een Beheerder, beheer" }), /http:\/\/ of https:\/\//);
  assert.throws(() => decideWrites("http://127.0.0.1:4710/", { testEnvironment: "http://127.0.0.1:4710" }), /alleen toegestaan met --allow-writes/);
  const declared = decideWrites("https://test.example.nl/start", { testEnvironment: "https://test.example.nl/pad", declaredBy: " Een Beheerder , functioneel beheerder, team web " }, now)!;
  assert.deepEqual(declared, { origin: "https://test.example.nl", local: false, declaredBy: { name: "Een Beheerder", role: "functioneel beheerder, team web" }, declaredAt: "2026-01-02T03:04:05.000Z", maxWrites: 5, spacingSeconds: 120 });
  assert.equal(writesAllowedNl(declared), "onderzocht op een testomgeving waar versturen is toegestaan: https://test.example.nl, verklaard door iemand met de functie functioneel beheerder, team web (de naam staat in het dossier van het onderzoek, niet in dit rapport)");
  assert.ok(!writesAllowedNl(declared).includes("Een Beheerder"), "the name of the person stays out of what is published");
  assert.match(WRITES_BLOCKED_NL, /^verzoeken die iets kunnen wijzigen zijn tegengehouden/);
});

test("without the setting no POST and no socket message arrives", async () => {
  reset();
  const page = await pageWith(false, "/widgets.html");
  await page.click("#chat-send");
  await settle();
  assert.deepEqual(writesReceived(), []);
  assert.deepEqual(site.socketMessages, []);
  assert.deepEqual(logged(run), []);
  await page.context().close();
});

test("with the setting a POST and a socket message arrive and each is logged in the run, without its body", async () => {
  reset();
  const page = await pageWith(true, "/widgets.html");
  await page.click("#chat-send");
  await settle();
  assert.deepEqual(writesReceived(), ["POST 127.0.0.1/api/chat"]);
  assert.deepEqual(site.socketMessages, ["hallo via socket"]);
  const lines = logged(run);
  assert.deepEqual(lines.map((line) => `${line.source} ${line.method} ${line.path}`).sort(), ["test POST /api/chat", "test SEND /chat"]);
  assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.at)) && Object.keys(line).sort().join() === "at,method,path,source"));
  await page.context().close();
});

test("writes to a second origin stay blocked, also when the test environment passes one on", async () => {
  reset();
  const page = await pageWith(true, "/callback.html");
  await page.click("#abroad-send");
  await settle();
  assert.deepEqual(writesReceived(), [], "a form that posts to another origin sends nothing");
  await loadPage(page, `${site.origin}/callback.html`);
  await page.click("#detour-send");
  await settle();
  assert.deepEqual(writesReceived(), ["POST 127.0.0.1/submit-redirect"], "the redirect that keeps the method is not followed to the other origin");
  // A redirect to a page to read, the usual answer to a form, is followed.
  await loadPage(page, `${site.origin}/callback.html`);
  await page.evaluate(() => {
    const form = document.getElementById("detour") as HTMLFormElement;
    form.action = "/submit-see-other";
    form.submit();
  });
  await page.waitForURL(`${site.origin}/elsewhere.html`, { timeout: 5000 });
  site.requests.length = 0;
  rmSync(join(run, "writes.jsonl"), { force: true });
  site.requests.push({ method: "POST", host: "127.0.0.1", path: "/submit-redirect", at: Date.now(), userAgent: "", referer: "" });
  // The same for a request a script makes, and for a socket of another origin.
  await loadPage(page, `${site.origin}/callback.html`);
  const outcome = await page.evaluate(async (other) => {
    const post = await fetch(`${other}/submit`, { method: "POST", body: "x" }).then(() => "sent", () => "refused");
    const socket = new WebSocket(`${other.replace("http", "ws")}/chat`);
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    socket.send("naar elders");
    return post;
  }, site.otherOrigin);
  await settle();
  assert.equal(outcome, "refused");
  assert.deepEqual(writesReceived(), ["POST 127.0.0.1/submit-redirect"]);
  assert.deepEqual(site.socketMessages, []);
  assert.deepEqual(logged(run), []);
  await page.context().close();
});

test("the form probe really submits on a test environment and records what the server answered", async () => {
  reset();
  const page = await pageWith(true, "/callback.html");
  const [form] = await probeForms(page, { label: "P1", url: `${site.origin}/callback.html`, outDir: run, openedVia: null, socketMessagesBlocked: () => 0, writes: true });
  assert.deepEqual(form!.attempts.map((attempt) => attempt.input), ["leeg verstuurd", "ongeldige invoer", "geldige testwaarden"]);
  const [empty, invalid, valid] = form!.attempts;
  assert.deepEqual(empty!.sent, [{ method: "POST", path: "/callback", status: 422 }]);
  assert.equal(empty!.requestBlocked, false);
  assert.equal(empty!.navigated, true);
  assert.equal(empty!.urlAfterSubmit, `${site.origin}/callback`);
  assert.ok(empty!.newVisibleMessages.includes("Vul een telefoonnummer in."), empty!.newVisibleMessages.join(" | "));
  assert.deepEqual(empty!.liveRegionMessages, ["Vul een telefoonnummer in."]);
  // The submission replaced the page: the reader went with the page it listened to, and nothing is claimed.
  assert.equal(empty!.spokenByItself, undefined);
  assert.ok(invalid!.newVisibleMessages.includes("Het telefoonnummer is niet geldig."));
  assert.equal(invalid!.sent![0]!.status, 422);
  assert.deepEqual(valid!.sent, [{ method: "POST", path: "/callback", status: 200 }]);
  assert.deepEqual(valid!.liveRegionMessages, ["Bedankt, wij bellen u terug."]);
  assert.ok(existsSync(join(run, valid!.screenshot!)));
  assert.equal(writesReceived().filter((line) => line === "POST 127.0.0.1/callback").length, 3);
  await page.context().close();
});

test("without the setting a refused submission leaves the page, so invalid input is tried too", async () => {
  reset();
  const page = await pageWith(false, "/callback.html");
  const [form] = await probeForms(page, { label: "P1", url: `${site.origin}/callback.html`, outDir: run, openedVia: null, socketMessagesBlocked: () => 0 });
  assert.deepEqual(form!.attempts.map((attempt) => attempt.input), ["leeg verstuurd", "ongeldige invoer"]);
  assert.ok(form!.attempts.every((attempt) => attempt.submitted && attempt.requestBlocked && attempt.navigated === false && !("sent" in attempt) && !("urlAfterSubmit" in attempt)), JSON.stringify(form!.attempts));
  assert.equal(page.url(), `${site.origin}/callback.html`, "no error page of the browser, the form is still there");
  assert.deepEqual(writesReceived(), []);
  await page.context().close();
});

test("the form probe survives a submission that navigates, records where it went and goes back for the rest", async () => {
  reset();
  const page = await pageWith(false, "/form.html");
  const restored: string[] = [];
  const forms = await probeForms(page, {
    label: "P1",
    url: `${site.origin}/form.html`,
    outDir: run,
    openedVia: null,
    socketMessagesBlocked: () => 0,
    restore: async (left) => {
      restored.push(left.url());
      await loadPage(left, `${site.origin}/form.html`);
    },
  });
  assert.deepEqual(forms.map((form) => form.form), ["#contact", "#search"]);
  const [contact, search] = forms;
  // The contact form checks itself in the page and stays there.
  assert.deepEqual(contact!.attempts.map((attempt) => attempt.navigated), [false, false, false]);
  // Its one required field makes a third attempt: what the form asks for, and nothing else.
  const regular = contact!.attempts[2]!;
  assert.equal(regular.input, REGULAR_PATH);
  assert.deepEqual([regular.outcome!.request, regular.outcome!.requests, regular.outcome!.nothing], ["tegengehouden", ["POST /submit"], false]);
  assert.match(regular.outcome!.nl, /^het formulier wilde versturen \(POST \/submit\); de bewaking hield het verzoek tegen/);
  assert.deepEqual(writesReceived(), []);
  // Submitted empty, the form answers with a message and sends nothing.
  assert.deepEqual([contact!.attempts[0]!.outcome!.request, contact!.attempts[0]!.outcome!.message, contact!.attempts[0]!.outcome!.nothing], ["geen", true, false]);
  // The search form asks for a new page with GET, which is allowed everywhere.
  assert.deepEqual(search!.attempts.map((attempt) => [attempt.input, attempt.navigated, attempt.urlAfterSubmit, attempt.titleAfterSubmit]), [
    ["leeg verstuurd", true, `${site.origin}/form.html?q=`, "Formulier - Testsite sessie"],
    ["ongeldige invoer", true, `${site.origin}/form.html?q=x`, "Formulier - Testsite sessie"],
  ]);
  assert.ok(search!.attempts.every((attempt) => attempt.submitted && !attempt.requestBlocked && attempt.failed === undefined));
  assert.deepEqual(restored, [`${site.origin}/form.html?q=`, `${site.origin}/form.html?q=x`]);
  assert.equal(page.url(), `${site.origin}/form.html`, "the probe leaves the page under test behind");
  // A server that never answers ends the attempt with a reason, not the probe.
  await loadPage(page, `${site.origin}/callback.html`);
  await page.evaluate(() => ((document.getElementById("callback") as HTMLFormElement).method = "get"));
  await page.evaluate(() => ((document.getElementById("callback") as HTMLFormElement).action = "/slow"));
  const [stuck] = await probeForms(page, { label: "P1", url: `${site.origin}/callback.html`, outDir: run, openedVia: null, socketMessagesBlocked: () => 0 });
  assert.deepEqual(stuck!.attempts.map((attempt) => [attempt.input, attempt.submitted, attempt.navigated, attempt.failed]), [
    ["leeg verstuurd", true, false, "de server gaf binnen 10 seconden geen antwoord op het versturen"],
    ["ongeldige invoer", true, false, "de server gaf binnen 10 seconden geen antwoord op het versturen"],
  ]);
  await page.context().close();
});

test("the form probe tries what a visitor does and says so when nothing at all follows", async () => {
  for (const writes of [false, true]) {
    reset();
    const page = await pageWith(writes, "/feedback.html");
    const forms = await probeForms(page, { label: "P1", url: `${site.origin}/feedback.html`, outDir: run, openedVia: null, socketMessagesBlocked: () => 0, writes });
    assert.deepEqual(forms.map((form) => form.form), ["#silent", "#sound"]);
    const [silent, sound] = forms.map((form) => form.attempts.find((attempt) => attempt.input === REGULAR_PATH)!);
    // The required field is filled in and the optional one is empty, also after the attempt that filled in everything.
    assert.deepEqual(await page.evaluate(() => ["silent-message", "silent-link", "sound-message", "sound-link"].map((id) => (document.getElementById(id) as HTMLInputElement).value)), writes ? ["Test", "Test", "Test", "Test"] : ["Test", "", "Test", ""]);
    // The first form refuses an empty optional field and says nothing: no request, no message, the page as it was.
    assert.deepEqual(silent!.outcome, { request: "geen", requests: [], message: false, pageChanged: false, nothing: true, nl: "er gebeurde niets: geen verzoek, geen melding en geen verandering van de pagina" });
    assert.equal(silent!.submitted, true);
    // The second one sends. Held back, the request itself is the evidence; let through, the answer of the server is there too.
    assert.deepEqual([sound!.outcome!.request, sound!.outcome!.requests, sound!.outcome!.nothing], [writes ? "verstuurd" : "tegengehouden", ["POST /submit"], false]);
    assert.deepEqual(sound!.liveRegionMessages, [writes ? "Bedankt voor uw bericht." : "Versturen is niet gelukt."]);
    // A simulated screen reader listened to each submission: what it said by itself is in the attempt, with the reader named as simulated.
    assert.match(sound!.spokenByItself!.reader, /^virtual-screen-reader \d+\.\d+\.\d+ \(nagebootst\)$/);
    assert.deepEqual([sound!.spokenByItself!.spoken, sound!.spokenByItself!.revealed, sound!.spokenByItself!.notSpoken], [[writes ? "polite: Bedankt voor uw bericht." : "polite: Versturen is niet gelukt."], [], []]);
    assert.deepEqual(silent!.spokenByItself!.spoken, []);
    assert.deepEqual(forms[0]!.attempts.find((attempt) => attempt.input === "leeg verstuurd")!.spokenByItself!.spoken, ["assertive: Vul een bericht in."]);
    assert.deepEqual(sound!.sent, writes ? [{ method: "POST", path: "/submit", status: 200 }] : undefined);
    // Only the form that works reached the server, and only as a visitor fills it in: "Test" is no address for the link.
    assert.deepEqual(writesReceived(), writes ? ["POST 127.0.0.1/submit"] : []);
    assert.ok(existsSync(join(run, silent!.screenshot!)) && silent!.screenshot!.endsWith("-form1-gewoon.png"));
    const dossier = formErrors({ states: { formErrors: forms, examined: { forms: forms.length } } } as unknown as RunData, "3.3.1") as { regularPath: { silentForms: number; forms: { form: string; attempt: string; nothing: boolean; request: string }[] } };
    assert.equal(dossier.regularPath.silentForms, 1);
    assert.deepEqual(dossier.regularPath.forms.map((row) => [row.form, row.attempt, row.nothing, row.request]), [["#silent", REGULAR_PATH, true, "geen"], ["#sound", REGULAR_PATH, false, writes ? "verstuurd" : "tegengehouden"]]);
    await page.context().close();
  }
});

test("a form without a required field has no path of its own: its empty submission is the one a visitor makes", () => {
  const attempt = { input: "leeg verstuurd", submitted: true, requestBlocked: false, invalidFields: [], newVisibleMessages: [], liveRegionMessages: [], focusAfterSubmit: null, screenshot: null, outcome: { request: "geen" as const, requests: [], message: false, pageChanged: false, nothing: true, nl: "er gebeurde niets" } };
  const optional = { page: "P1", form: "#a", openedVia: null, fields: [{ role: "textbox", name: "Naam", required: false, type: null, invalidBeforeInput: false }], submitControl: null, attempts: [attempt] };
  // A run from before this probe has a required field and no attempt for it.
  const older = { ...optional, form: "#b", fields: [{ ...optional.fields[0]!, required: true }], attempts: [{ ...attempt, outcome: undefined }] };
  const dossier = formErrors({ states: { formErrors: [optional, older], examined: { forms: 2 } } } as unknown as RunData, "3.3.1") as { regularPath: { silentForms: number; forms: { attempt: string | null; nothing: boolean | null }[] } };
  assert.equal(dossier.regularPath.silentForms, 1);
  assert.deepEqual(dossier.regularPath.forms.map((row) => [row.attempt, row.nothing]), [["leeg verstuurd", true], [null, null]]);
});

test("a session writes to the test environment of its run only, and says so in the record", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-session-"));
  await recordWrites(dir, permission);
  assert.deepEqual(writesForRun(dir), permission);
  const scope = await scopeForRun(dir, { scopeUrl: `${site.origin}/` });
  assert.equal(scope.writes?.origin, site.origin);
  const daemon = await Daemon.create(dir, scope, { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session: "main", command, args, options: {} })).print;
  const ref = async (query: string): Promise<string> => ((await loep("find", query)).found as string[])[0]!.split(" ")[0]!;
  try {
    await daemon.handle({ op: "start", session: "main" });
    await loep("open", "/widgets.html");
    const clicked = await loep("click", await ref("css:#chat-send"));
    assert.deepEqual((clicked.written as string[]).sort(), ["POST /api/chat", "SEND /chat"]);
    assert.equal(clicked.blocked, undefined);
    const record = JSON.parse(readFileSync(join(dir, "observations", "main", `${(clicked.id as string).slice(-4)}.json`), "utf8")) as Observation;
    assert.deepEqual(record.writes!.map((entry) => `${entry.source} ${entry.method} ${entry.path}`).sort(), ["session POST /api/chat", "session SEND /chat"]);
    await settle();
    assert.deepEqual(writesReceived(), ["POST 127.0.0.1/api/chat"]);
    assert.deepEqual(site.socketMessages, ["hallo via socket"]);
    await loep("open", "/callback.html");
    const abroad = await loep("click", await ref("css:#abroad-send"));
    assert.deepEqual(abroad.blocked, [`method: POST ${site.otherOrigin}/submit`]);
    assert.equal(abroad.written, undefined);
    // After submitting, what the server answered is there to look at.
    await loep("type", await ref("css:#phone"), "phone");
    const sent = await loep("click", await ref("css:#call"));
    assert.deepEqual(sent.written, ["POST /callback"]);
    assert.equal(sent.navigated, true);
    assert.equal(((await loep("find", "css:#server-ok")).found as string[]).length, 1);
    assert.deepEqual(logged(dir).map((line) => `${line.method} ${line.path}`).sort(), ["POST /api/chat", "POST /callback", "SEND /chat"]);
    assert.deepEqual(writesReceived().filter((line) => line.includes("localhost")), []);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the budget for sending counts for the whole run, keeps the time between two writes and refuses past the maximum", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-budget-"));
  try {
    const limited: WritePermission = { ...permission, maxWrites: 3, spacingSeconds: 60 };
    let clock = Date.parse("2026-01-02T10:00:00Z");
    const now = (): number => clock;
    // A session and a command of the sweep, each with its own access, share one budget through the log in the run.
    const session = writeAccess(dir, limited, "session", now);
    const sweep = writeAccess(dir, limited, "states", now);
    assert.equal(session.claim("POST", `${site.origin}/callback`).ok, true);
    clock += 10_000;
    const early = sweep.claim("POST", `${site.origin}/submit`);
    assert.deepEqual(early.ok ? null : [early.budget, early.reasonNl], ["spacing", "te kort na de vorige verzending: tussen twee verzendingen zit minstens 60 s; versturen kan weer over 50 s (nog 2 van 3 over)"]);
    // A message over a socket and the repeat after a redirect are noted, and they do not count.
    session.record("SEND", `${site.origin.replace("http", "ws")}/chat`);
    session.record("POST", `${site.origin}/callback`, { repeat: true });
    assert.deepEqual(writeBudget(dir, limited, clock), { origin: site.origin, max: 3, sent: 1, left: 2, spacingSeconds: 60, waitSeconds: 50 });
    clock += 50_000;
    assert.equal(sweep.claim("POST", `${site.origin}/submit`).ok, true);
    clock += 60_000;
    // A new process, as after a restart of the session process, goes on with what was sent.
    assert.equal(writeAccess(dir, limited, "session", now).claim("POST", `${site.origin}/callback`).ok, true);
    clock += 600_000;
    const out = session.claim("POST", `${site.origin}/callback`);
    assert.deepEqual(out.ok ? null : out.budget, "out");
    assert.match(out.ok ? "" : out.reasonNl, /^het budget voor versturen van deze run is op: 3 van 3 verzendingen naar http:\/\/127\.0\.0\.1:\d+ zijn gedaan, door alle sessies en de veegronde samen$/);
    assert.deepEqual(logged(dir).map((line) => `${line.source} ${line.method}${line.repeat ? " repeat" : ""}`), ["session POST", "session SEND", "session POST repeat", "states POST", "session POST"]);
    assert.equal(writeBudgetNl(writeBudget(dir, limited, clock)), `nog 0 van 3 verzendingen naar ${site.origin} over voor de hele run (3 verstuurd), met minstens 60 s ertussen`);
    assert.equal(existsSync(join(dir, "writes.lock")), false, "the lock is gone after each claim");
    // A manifest from before the budget has none: the run gets the default.
    const older: WritePermission = { origin: site.origin, local: true, declaredBy: null, declaredAt: "2026-01-01T00:00:00.000Z" };
    assert.deepEqual([writeBudget(dir, older, clock).max, writeBudget(dir, older, clock).spacingSeconds], [DEFAULT_MAX_WRITES, DEFAULT_WRITE_SPACING_SECONDS]);
    assert.deepEqual([DEFAULT_MAX_WRITES, DEFAULT_WRITE_SPACING_SECONDS], [5, 120]);
    assert.equal(budgetOutPointNl({ sent: 5, max: 5 }), "versturen niet toegestaan: het budget voor versturen van deze run is op (5 van 5 verstuurd)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session past the budget for sending is held back as without permission, says so, and session list shows what is left", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-budget-session-"));
  await recordWrites(dir, { ...permission, maxWrites: 1, spacingSeconds: 0 });
  const daemon = await Daemon.create(dir, await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (session: string, command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session, command, args, options: {} })).print;
  const ref = async (session: string, query: string): Promise<string> => ((await loep(session, "find", query)).found as string[])[0]!.split(" ")[0]!;
  try {
    assert.equal((await daemon.handle({ op: "list" })).print.writes, `nog 1 van 1 verzendingen naar ${site.origin} over voor de hele run (0 verstuurd), met minstens 0 s ertussen`);
    for (const session of ["a", "b"]) {
      await daemon.handle({ op: "start", session });
      await loep(session, "open", "/callback.html");
    }
    const first = await loep("a", "click", await ref("a", "css:#call"));
    assert.deepEqual(first.written, ["POST /callback"]);
    // The other session has nothing left: the budget is the run's, not the session's.
    const second = await loep("b", "click", await ref("b", "css:#call"));
    assert.equal(second.written, undefined);
    assert.match((second.blocked as string[])[0]!, /^method: POST .*\/callback \(het budget voor versturen van deze run is op: 1 van 1 verzendingen/);
    assert.match(second.sending as string, /^het budget voor versturen van deze run is op: 1 van 1 verstuurd, door alle sessies en de veegronde samen\. .*"versturen niet toegestaan: het budget voor versturen van deze run is op \(1 van 1 verstuurd\): <wat er pas na versturen te zien was>"$/);
    const record = JSON.parse(readFileSync(join(dir, "observations", "b", `${(second.id as string).slice(-4)}.json`), "utf8")) as Observation;
    assert.deepEqual(record.blocked.map((entry) => entry.writeBudget), ["out"]);
    await settle();
    assert.equal(writesReceived().filter((line) => line.endsWith("/callback")).length, 1);
    assert.match((await daemon.handle({ op: "list" })).print.writes as string, /^nog 0 van 1 verzendingen/);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, type] of [["webkit", webkit], ["firefox", firefox]] as const) {
  test(`the setting holds in ${name}: writes reach the test environment and no other origin`, { skip: !existsSync(type.executablePath()) && `${name} is not installed` }, async () => {
    reset();
    const dir = mkdtempSync(join(tmpdir(), "loep-writes-second-"));
    await recordWrites(dir, permission);
    const other = await type.launch();
    try {
      const env = { browser: other, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
      const { surface } = await openSurface(env, { url: `${site.origin}/widgets.html`, width: 1280, height: 800, scheme: "light" });
      await surface.page.click("#chat-send");
      const abroad = await surface.page.evaluate((url) => fetch(url, { method: "POST", body: "x" }).then(() => "sent", () => "refused"), `${site.otherOrigin}/submit`);
      await settle();
      assert.equal(abroad, "refused");
      assert.deepEqual(writesReceived(), ["POST 127.0.0.1/api/chat"]);
      assert.deepEqual(site.socketMessages, ["hallo via socket"]);
      assert.deepEqual(surface.guard.passed!.map((entry) => `${entry.method} ${entry.path}`).sort(), ["POST /api/chat", "SEND /chat"]);
      assert.equal(surface.guard.blocked.filter((entry) => entry.kind === "method").length, 1);
      // And without the setting the same browser sends nothing.
      reset();
      const closed = await openSurface({ ...env, scope: { ...env.scope, writes: null } }, { url: `${site.origin}/widgets.html`, width: 1280, height: 800, scheme: "light" });
      await closed.surface.page.click("#chat-send");
      await settle();
      assert.deepEqual(writesReceived(), []);
      assert.deepEqual(site.socketMessages, []);
    } finally {
      await other.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("inventory refuses to start for a site that is not local without a declaration, and stores the setting in the manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-cli-"));
  const cli = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> =>
    promisify(execFile)(process.execPath, [CLI, ...args]).then((output) => ({ ...output, code: 0 }), (error: { stdout: string; stderr: string; code: number }) => error);
  try {
    // Refused before anything is fetched: the name does not resolve, and it never has to.
    const refused = await cli("inventory", "https://www.example.invalid/", "--out", dir, "--allow-writes");
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /versturen is niet toegestaan naar https:\/\/www\.example\.invalid: dat is geen lokaal adres/);
    assert.equal(existsSync(join(dir, "manifest.json")), false);
    const half = await cli("inventory", "https://www.example.invalid/", "--out", dir, "--test-environment", "https://www.example.invalid");
    assert.match(half.stderr, /--declared-by "<naam>, <functie>"/);
    writeFileSync(join(dir, "urls.txt"), `${site.origin}/callback.html\n`);
    site.requests.length = 0;
    const allowed = await cli("inventory", `${site.origin}/`, "--out", dir, "--urls", join(dir, "urls.txt"), "--allow-writes");
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.match(allowed.stdout, new RegExp(`versturen toegestaan naar ${site.origin.replaceAll(".", "\\.")}\n`));
    const stored = writesForRun(dir)!;
    assert.deepEqual({ ...stored, declaredAt: "" }, { origin: site.origin, local: true, declaredBy: null, declaredAt: "", maxWrites: 5, spacingSeconds: 120 });
    assert.match(allowed.stdout, /budget voor versturen: ten hoogste 5 verzendingen naar die origin voor de hele run/);
    // The budget for sending is set next to the declaration, and only there.
    assert.equal((await cli("inventory", `${site.origin}/`, "--out", dir, "--urls", join(dir, "urls.txt"), "--allow-writes", "--max-writes", "3")).code, 0);
    assert.equal(writesForRun(dir)?.maxWrites, 3);
    assert.match((await cli("inventory", `${site.origin}/`, "--out", dir, "--urls", join(dir, "urls.txt"), "--max-writes", "3")).stderr, /--max-writes hoort bij een run die mag versturen/);
    assert.match((await cli("sample", "--run", dir, "--max-writes", "9")).stderr, /horen bij inventory/);
    assert.equal(writesForRun(dir)?.maxWrites, 3);
    // The next step of the run keeps it; flags for it belong to inventory alone.
    assert.equal((await cli("sample", "--run", dir)).code, 0);
    assert.equal(writesForRun(dir)?.origin, site.origin);
    assert.match((await cli("sample", "--run", dir, "--allow-writes")).stderr, /horen bij inventory/);
    // An inventory without the flag is a run without the permission.
    assert.equal((await cli("inventory", `${site.origin}/`, "--out", dir, "--urls", join(dir, "urls.txt"))).code, 0);
    assert.equal(writesForRun(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
