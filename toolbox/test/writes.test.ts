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
import { budgetOutPointNl, criterionSender, decideWrites, isOurMessage, isProtocolFrame, reservedWrites, senderOf, SocketFrames, DEFAULT_MAX_WRITES, DEFAULT_WRITE_SPACING_SECONDS, recordWrites, WRITES_BLOCKED_NL, writeAccess, writeBudget, writeBudgetNl, writesAllowedNl, writesForRun, type PassedWrite, type WritePermission } from "../src/lib/writes.ts";
import { RECORD_QUIET_MS, readRecordings, readReplays, recordingKey, replaysNl, socketRecordings } from "../src/lib/recordings.ts";
import { Daemon } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { DEFAULT_DAEMON_LIMITS, MESSAGE_VALUES, Politeness, scopeForRun, TEST_VALUES } from "../src/session/safety.ts";
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
  // On this machine nobody receives a stream of messages: no pause, and a larger budget that still has an end.
  assert.deepEqual(decideWrites("http://127.0.0.1:4710/", { allowWrites: true }, now), { origin: "http://127.0.0.1:4710", local: true, declaredBy: null, declaredAt: "2026-01-02T03:04:05.000Z", maxWrites: 50, spacingSeconds: 0 });
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
  // The frame carries no test value and is no heartbeat either: it counts, as a message.
  assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.at)) && Object.keys(line).sort().join() === (line.method === "SEND" ? "at,message,method,path,source" : "at,method,path,source")));
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
    // What a visitor types is the recognizable test text of a session: whoever receives it sees it comes from loep.
    const text = TEST_VALUES.text!;
    // The required field is filled in and the optional one is empty, also after the attempt that filled in everything.
    assert.deepEqual(await page.evaluate(() => ["silent-message", "silent-link", "sound-message", "sound-link"].map((id) => (document.getElementById(id) as HTMLInputElement).value)), writes ? [text, text, text, text] : [text, "", text, ""]);
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
    // Only the form that works reached the server, and only as a visitor fills it in: the test text is no address for the link.
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
    assert.deepEqual(record.writes!.map((entry) => `${entry.source} ${entry.method} ${entry.path}`).sort(), ["main POST /api/chat", "main SEND /chat"], "the log names the session that sent");
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

test("on a local address writes follow each other without a pause, until the budget is used up", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-local-"));
  try {
    const local = decideWrites(`${site.origin}/`, { allowWrites: true, maxWrites: "3" })!;
    const clock = Date.parse("2026-01-02T10:00:00Z");
    const access = writeAccess(dir, local, "session", () => clock);
    for (let index = 0; index < 3; index++) assert.equal(access.claim("POST", `${site.origin}/callback`).ok, true, `write ${index + 1}`);
    const out = access.claim("POST", `${site.origin}/callback`);
    assert.deepEqual(out.ok ? null : out.budget, "out");
    assert.equal(writeBudgetNl(writeBudget(dir, local, clock)), `nog 0 van 3 verzendingen naar ${site.origin} over voor de hele run (3 verstuurd), zonder wachttijd ertussen`);
  } finally {
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
    assert.deepEqual(writeBudget(dir, limited, clock), { origin: site.origin, max: 3, sent: 1, left: 2, reserved: 0, spacingSeconds: 60, waitSeconds: 50 });
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

// A declared test environment on a real site: the budget is small, and whoever sends first would use it up.
const declared = (maxWrites: number): WritePermission => ({ ...permission, local: false, declaredBy: { name: "Iemand", role: "beheerder" }, maxWrites, spacingSeconds: 0 });

test("on a declared test environment the last half of the budget is kept for senders that sent nothing yet; the sessions of one criterion are one sender", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-share-"));
  try {
    const five = declared(5);
    assert.equal(reservedWrites(five), 2);
    assert.equal(reservedWrites({ ...five, local: true }), 0, "nothing is kept on a local site");
    assert.equal(senderOf("v-1410-2"), criterionSender("1.4.10"));
    assert.equal(senderOf("a-331"), senderOf("b-331"));
    assert.equal(senderOf("r-formulier"), "r-formulier");
    // The sweep sends the three steps of one form: empty, invalid, valid. A fourth would take from what is kept.
    const sweep = writeAccess(dir, five, "states");
    for (let step = 0; step < 3; step++) assert.equal(sweep.claim("POST", `${site.origin}/submit`).ok, true);
    const fourth = sweep.claim("POST", `${site.origin}/submit`);
    assert.deepEqual(fourth.ok ? null : [fourth.budget, fourth.reasonNl], ["share", `states heeft al verstuurd, en er zijn nog 2 van 5 verzendingen naar ${site.origin} over: de laatste 2 verzendingen zijn voor een criterium of een opdracht van de veegronde die nog niets verstuurde`]);
    // One access serves every session of the process; each sends as itself. The verifier and the finisher of 3.3.1 share with its judge.
    const sessions = writeAccess(dir, five, "session");
    assert.equal(sessions.claim("POST", `${site.origin}/callback`, { sender: "b-331" }).ok, true);
    for (const later of ["v-331", "a-331-2"]) {
      const refused = sessions.claim("POST", `${site.origin}/callback`, { sender: later });
      assert.deepEqual(refused.ok ? null : [refused.budget, refused.reasonNl.split(",")[0]], ["share", "dit criterium heeft al verstuurd"], later);
    }
    assert.equal(writeBudget(dir, five, Date.now(), criterionSender("3.3.1")).left, 0);
    assert.equal(writeBudgetNl(writeBudget(dir, five)), `nog 1 van 5 verzendingen naar ${site.origin} over voor de hele run (4 verstuurd), zonder wachttijd ertussen; de laatste 2 verzendingen zijn voor een criterium of een opdracht van de veegronde die nog niets verstuurde`);
    // Another criterion takes the last one; after that the budget is out for everyone.
    assert.equal(sessions.claim("POST", `${site.origin}/callback`, { sender: "b-412" }).ok, true);
    const out = sessions.claim("POST", `${site.origin}/callback`, { sender: "b-131" });
    assert.equal(out.ok ? null : out.budget, "out");
    assert.deepEqual(logged(dir).map((line) => line.source), ["states", "states", "states", "b-331", "b-412"]);
    assert.equal(budgetOutPointNl({ sent: 4, max: 5 }), "versturen niet toegestaan: het budget voor versturen van deze run is op voor dit criterium (4 van 5 verstuurd; de rest is voor criteria die nog niets verstuurden)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in the session process each session sends from the share of its criterion, and hears what to do when that is used", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-share-session-"));
  await recordWrites(dir, declared(2));
  const daemon = await Daemon.create(dir, await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (session: string, command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session, command, args, options: {} })).print;
  const ref = async (session: string, query: string): Promise<string> => ((await loep(session, "find", query)).found as string[])[0]!.split(" ")[0]!;
  try {
    for (const session of ["b-331", "v-331", "b-412"]) {
      await daemon.handle({ op: "start", session });
      await loep(session, "open", "/callback.html");
    }
    assert.deepEqual((await loep("b-331", "click", await ref("b-331", "css:#call"))).written, ["POST /callback"]);
    // The verifier of the same criterion cites what the judge saw; the last write is for another criterion.
    const verifier = await loep("v-331", "click", await ref("v-331", "css:#call"));
    assert.equal(verifier.written, undefined);
    assert.match(verifier.sending as string, /^dit criterium heeft al verstuurd, .*Er is niets verstuurd: haal de waarneming aan .*"versturen niet toegestaan: het budget voor versturen van deze run is op voor dit criterium \(1 van 2 verstuurd; de rest is voor criteria die nog niets verstuurden\): <wat er pas na versturen te zien was>"$/);
    const record = JSON.parse(readFileSync(join(dir, "observations", "v-331", `${(verifier.id as string).slice(-4)}.json`), "utf8")) as Observation;
    assert.deepEqual(record.blocked.map((entry) => entry.writeBudget), ["share"]);
    assert.deepEqual((await loep("b-412", "click", await ref("b-412", "css:#call"))).written, ["POST /callback"]);
    await settle();
    assert.equal(writesReceived().filter((line) => line.endsWith("/callback")).length, 2);
    assert.deepEqual(logged(dir).map((line) => line.source), ["b-331", "b-412"]);
  } finally {
    await daemon.close();
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
    assert.equal((await daemon.handle({ op: "list" })).print.writes, `nog 1 van 1 verzendingen naar ${site.origin} over voor de hele run (0 verstuurd), zonder wachttijd ertussen`);
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

test("a frame over a socket is a message of ours only when it carries a test value; a heartbeat is not", () => {
  assert.ok(!MESSAGE_VALUES.includes(TEST_VALUES.search!) && !MESSAGE_VALUES.includes(TEST_VALUES.number!) && !MESSAGE_VALUES.includes(""));
  for (const value of MESSAGE_VALUES) {
    assert.equal(isOurMessage(`42["message",{"text":${JSON.stringify(value)}}]`, MESSAGE_VALUES), true, value);
    assert.equal(isOurMessage(Buffer.from(`bericht: ${value}`), MESSAGE_VALUES), true, value);
  }
  for (const heartbeat of ["2", "3", "40", '{"type":6}\u001e', '{"protocol":"json","version":1}\u001e', '[null,"3","phoenix","heartbeat",{}]', '{"type":"ping","page":"Testsite sessie"}']) assert.equal(isOurMessage(heartbeat, MESSAGE_VALUES), false, heartbeat);
});

test("every frame over a socket counts, except one shown to be a heartbeat or a message of the protocol", () => {
  for (const frame of ["", "\n", "ping", "PONG", "2", "3", "2probe", "5", "6", "40", "41", "40/chat,", '{"type":6}\u001e', '{"protocol":"json","version":1}\u001e', '[null,"3","phoenix","heartbeat",{}]', '{"topic":"phoenix","event":"heartbeat","payload":{},"ref":"7"}', '{"type":"ping","page":"Testsite sessie"}', '{"type":"connection_init","payload":{}}', '{"op":"KeepAlive"}']) assert.equal(isProtocolFrame(frame), true, JSON.stringify(frame));
  // A message without a test value in it, a frame that is not text, and anything long, cannot be shown to be nothing.
  for (const frame of ["hallo via socket", '42["message",{"text":"x"}]', '{"type":"message","body":"eHl6"}', `{"type":"ping","data":"${"x".repeat(200)}"}`, "7", '["1","2","room:1","new_msg",{}]']) assert.equal(isProtocolFrame(frame), false, frame);
  assert.equal(isProtocolFrame(Buffer.from("ping")), false, "a binary frame is not judged");

  const frames = new SocketFrames(MESSAGE_VALUES);
  assert.equal(frames.counts("2"), false);
  assert.equal(frames.counts(Buffer.from([0x78, 0x9c, 0x01])), true, "a compressed frame counts");
  assert.equal(frames.counts('{"seq":"a1"}'), true, "an unknown frame counts");
  // What the page sends while nobody acts counts the first time, unless it is a known heartbeat, and after that the same frame passes.
  assert.equal(frames.counts('{"hb":1}', true), true);
  assert.equal(frames.counts('{"hb":1}', true), false);
  assert.equal(frames.counts('{"hb":1}'), false, "also while an agent acts");
  assert.equal(frames.counts(Buffer.from([1, 2, 3]), true), true);
  assert.equal(frames.counts(Buffer.from([1, 2, 3])), false);
  // What was sent while an agent may have acted is not remembered.
  assert.equal(frames.counts('{"seq":"a1"}'), true);
  // A frame with a test value in it always counts, also when the page sent the same frame by itself before.
  assert.equal(frames.counts(`{"text":"${TEST_VALUES.email}"}`, true), true);
  assert.equal(frames.counts(`{"text":"${TEST_VALUES.email}"}`), true);
});

test("the answer to a chat message is recorded once, and the same message is played from the recording after that: nothing more goes to the server", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-replay-"));
  const limited: WritePermission = { ...permission, maxWrites: 1, spacingSeconds: 0 };
  await recordWrites(dir, limited);
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    // A socket that stays open until the server has been quiet for a while, unless `wait` says otherwise.
    const chat = async (frames: string[], path = "/chat", wait = RECORD_QUIET_MS + 500): Promise<string[]> => {
      const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
      const replies = await surface.page.evaluate(
        async ([url, list, ms]) => {
          const socket = new WebSocket(url as string);
          const got: string[] = [];
          socket.addEventListener("message", (event) => got.push(String(event.data)));
          await new Promise((resolve) => socket.addEventListener("open", resolve));
          for (const frame of list as string[]) socket.send(frame);
          await new Promise((resolve) => setTimeout(resolve, ms as number));
          socket.close();
          await new Promise((resolve) => setTimeout(resolve, 100));
          return got;
        },
        [`${site.origin.replace("http", "ws")}${path}`, frames, wait] as const,
      );
      const replays = surface.guard.replays ?? [];
      await surface.context.close();
      return [...replies, ...replays.map((entry) => `afgespeeld ${entry.key}`)];
    };
    const message = JSON.stringify({ type: "chat", text: TEST_VALUES.text });
    // The first time it is sent for real, and the answer is recorded when the socket closes.
    assert.deepEqual(await chat([message]), ['{"type":"reply","text":"Ontvangen"}', '{"type":"reply","text":"Waarmee kan ik helpen?"}']);
    assert.deepEqual(site.socketMessages, [message]);
    const [recording] = readRecordings(dir);
    assert.deepEqual(recording!.frames.map((frame) => frame.text), ['{"type":"reply","text":"Ontvangen"}', '{"type":"reply","text":"Waarmee kan ik helpen?"}']);
    assert.ok(recording!.frames[1]!.afterMs > recording!.frames[0]!.afterMs, "the time between the frames is kept");
    // The second time, with the budget used up, it is played: the page gets the same answer and the server nothing.
    assert.deepEqual(await chat([JSON.stringify({ type: "chat", text: TEST_VALUES.text, at: 2 })]), ['{"type":"reply","text":"Ontvangen"}', '{"type":"reply","text":"Waarmee kan ik helpen?"}', `afgespeeld ${TEST_VALUES.text}`]);
    assert.deepEqual(site.socketMessages, [message]);
    assert.equal(writeBudget(dir, limited).sent, 1);
    assert.deepEqual(readReplays(dir).map((entry) => entry.recording), [recording!.id]);
    // The same message on another path of the origin is another chat: it is not played, and is held back past the budget.
    assert.deepEqual(await chat([message], "/andere-dienst", 300), []);
    assert.deepEqual(site.socketMessages, [message]);
    assert.equal(readReplays(dir).length, 1);
    // A frame without a test value has no recording: it is never played, and counts against the budget as before.
    assert.equal(recordingKey('{"type":"open","channel":"support"}', MESSAGE_VALUES), null);
    assert.deepEqual(await chat(['{"type":"open","channel":"support"}'], "/chat", 300), []);
    assert.deepEqual(site.socketMessages, [message]);
    assert.equal(readReplays(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a frame without a test value goes to the server every time and is never recorded", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-replay-open-"));
  const limited: WritePermission = { ...permission, maxWrites: 10, spacingSeconds: 0 };
  await recordWrites(dir, limited);
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    const open = JSON.stringify({ type: "open", channel: "support" });
    for (let round = 0; round < 2; round++) {
      const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
      await sendFrames(surface.page, [open]);
      assert.equal((surface.guard.replays ?? []).length, 0, `round ${round}`);
      await surface.context.close();
    }
    assert.deepEqual(site.socketMessages, [open, open], "the server hears of both connections");
    assert.equal(writeBudget(dir, limited).sent, 2, "and each counts as before");
    assert.deepEqual(readRecordings(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a socket closed before the server answered leaves no recording, and the next send of the message is real", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-replay-early-"));
  const limited: WritePermission = { ...permission, maxWrites: 10, spacingSeconds: 0 };
  await recordWrites(dir, limited);
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    const message = JSON.stringify({ type: "chat", text: TEST_VALUES.text });
    for (const wait of [10, RECORD_QUIET_MS + 500]) {
      const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
      await surface.page.evaluate(
        async ([url, frame, ms]) => {
          const socket = new WebSocket(url as string);
          await new Promise((resolve) => socket.addEventListener("open", resolve));
          socket.send(frame as string);
          await new Promise((resolve) => setTimeout(resolve, ms as number));
          socket.close();
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
        [`${site.origin.replace("http", "ws")}/chat`, message, wait] as const,
      );
      assert.equal((surface.guard.replays ?? []).length, 0, `wait ${wait}`);
      await surface.context.close();
    }
    assert.deepEqual(site.socketMessages, [message, message], "the second send went to the server");
    assert.equal(writeBudget(dir, limited).sent, 2);
    // On a busy machine the close may come after the receipt: then the first is kept as incomplete, never as whole.
    const whole = readRecordings(dir).filter((recording) => !recording.incomplete);
    assert.equal(whole.length, 1, "only the second, whole answer is recorded");
    assert.equal(whole[0]!.frames.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a recording cut off while the server was still answering is kept as incomplete and never played; the path and query count", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-recordings-"));
  try {
    let clock = 0;
    const recordings = socketRecordings(dir, "states", MESSAGE_VALUES, () => clock);
    const message = JSON.stringify({ text: TEST_VALUES.text });
    const url = "wss://test.example.nl/chat?room=1";
    // Nothing came back: no recording at all.
    recordings.start(url, message)!.end();
    assert.deepEqual(readRecordings(dir), []);
    // A receipt, and the socket closed a moment later: the answer may still have been coming.
    const cut = recordings.start(url, message)!;
    clock += 50;
    cut.frame('{"type":"reply","text":"Ontvangen"}');
    clock += 500;
    cut.end();
    assert.equal(readRecordings(dir)[0]!.incomplete, true);
    assert.equal(recordings.find(url, message), null);
    // Quiet long enough before the end: whole, and played on the same path and query only.
    const whole = recordings.start(url, message)!;
    clock += 50;
    whole.frame('{"type":"reply","text":"Ontvangen"}');
    clock += RECORD_QUIET_MS;
    whole.end();
    assert.equal(recordings.find(url, message)?.path, "/chat?room=1");
    assert.equal(recordings.find("wss://test.example.nl/chat?room=2", message), null);
    assert.equal(recordings.find("wss://test.example.nl/andere-dienst", message), null);
    assert.equal(recordings.start(url, '{"type":"open"}'), null);
    assert.match(replaysNl(dir)!, /^Van één bericht in een chat/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the sweep records and plays a chat message the same way, and a session plays what the sweep recorded", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-replay-sweep-"));
  const limited: WritePermission = { ...permission, maxWrites: 1, spacingSeconds: 0 };
  await recordWrites(dir, limited);
  const message = JSON.stringify({ type: "chat", text: TEST_VALUES.text });
  const chatIn = async (page: Page): Promise<string[]> =>
    page.evaluate(
      async ([url, frame, ms]) => {
        const socket = new WebSocket(url as string);
        const got: string[] = [];
        socket.addEventListener("message", (event) => got.push(String(event.data)));
        await new Promise((resolve) => socket.addEventListener("open", resolve));
        socket.send(frame as string);
        await new Promise((resolve) => setTimeout(resolve, ms as number));
        socket.close();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return got;
      },
      [`${site.origin.replace("http", "ws")}/chat`, message, RECORD_QUIET_MS + 500] as const,
    );
  try {
    const answer = ['{"type":"reply","text":"Ontvangen"}', '{"type":"reply","text":"Waarmee kan ik helpen?"}'];
    for (let round = 0; round < 2; round++) {
      const context = await newContext(browser, { writes: writeAccess(dir, limited, "states") });
      const page = await context.newPage();
      await loadPage(page, `${site.origin}/callback.html`);
      assert.deepEqual(await chatIn(page), answer, `round ${round}`);
      await context.close();
    }
    assert.deepEqual(site.socketMessages, [message], "only the first went to the server");
    assert.deepEqual(readReplays(dir).map((entry) => entry.source), ["states"]);
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
    assert.deepEqual(await chatIn(surface.page), answer);
    assert.match(surface.guard.replays![0]!.noteNl, /^niet verstuurd maar afgespeeld: dit bericht is om \d\d:\d\d al eens echt verstuurd \(states\)/);
    await surface.context.close();
    assert.deepEqual(site.socketMessages, [message]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Open a socket to the fixture site from the page and send these frames, one at a time. */
async function sendFrames(page: Page, frames: string[]): Promise<void> {
  await page.evaluate(async ([url, list]) => {
    const socket = new WebSocket(url!);
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    for (const frame of list as string[]) {
      socket.send(frame);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [`${site.origin.replace("http", "ws")}/chat`, frames] as const);
  await settle();
}

test("in a session a binary or unknown frame takes one from the budget; the same frame the page sent between two commands passes", async () => {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-frames-"));
  const limited: WritePermission = { ...permission, maxWrites: 2, spacingSeconds: 0 };
  await recordWrites(dir, limited);
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
    // One socket, as a chat keeps open: what it remembers belongs to that socket.
    await surface.page.evaluate(async (url) => {
      const socket = new WebSocket(url);
      await new Promise((resolve) => socket.addEventListener("open", resolve));
      (window as unknown as { chat: WebSocket }).chat = socket;
    }, `${site.origin.replace("http", "ws")}/chat`);
    const send = async (frames: (string | number[])[]): Promise<void> => {
      await surface.page.evaluate(async (list) => {
        for (const frame of list) {
          (window as unknown as { chat: WebSocket }).chat.send(typeof frame === "string" ? frame : new Uint8Array(frame));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }, frames);
      await settle();
    };
    // Between two commands: the page sends its own frame, which counts once and then passes.
    surface.guard.idle = true;
    await send(['{"hb":1}', '{"hb":1}']);
    // During a command: a binary frame counts, and then the budget is used up; the frame the page sent by itself still passes.
    surface.guard.idle = false;
    await send([[0x78, 0x9c, 0x01], [0x78, 0x9c, 0x02], '{"hb":1}', "2"]);
    assert.deepEqual(site.socketMessages, ['{"hb":1}', '{"hb":1}', "binary:789c01", '{"hb":1}', "2"], "the second binary frame stays in the browser");
    assert.deepEqual(logged(dir).map((line) => `${line.method}${line.message ? " message" : ""}`), ["SEND message", "SEND", "SEND message", "SEND", "SEND"]);
    assert.deepEqual(surface.guard.blocked.filter((entry) => entry.kind === "socket").map((entry) => entry.writeBudget), ["out"]);
    await surface.context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The session process says when nobody acts: after a command, until the next one.
  const other = mkdtempSync(join(tmpdir(), "loep-writes-idle-"));
  await recordWrites(other, permission);
  const daemon = await Daemon.create(other, await scopeForRun(other, { scopeUrl: `${site.origin}/` }), { navigationDelayMs: 0, secondBrowsers: false });
  try {
    await daemon.handle({ op: "start", session: "main" });
    await daemon.handle({ op: "command", session: "main", command: "open", args: ["/callback.html"], options: {} });
    const guard = (daemon as unknown as { sessions: Map<string, { surface: { guard: { idle?: boolean } } }> }).sessions.get("main")!.surface.guard;
    assert.equal(guard.idle, true);
  } finally {
    await daemon.close();
    rmSync(other, { recursive: true, force: true });
  }
});

test("a message over a socket counts against the budget for sending and is held back past it, in a session and in the sweep; a heartbeat passes", async () => {
  const limited: WritePermission = { ...permission, maxWrites: 1, spacingSeconds: 0 };
  const message = (n: number): string => JSON.stringify({ type: "message", n, text: TEST_VALUES.text });
  // A session: the guard of the session process.
  reset();
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-socket-"));
  await recordWrites(dir, limited);
  try {
    const env = { browser, runDir: dir, scope: await scopeForRun(dir, { scopeUrl: `${site.origin}/` }), limits: DEFAULT_DAEMON_LIMITS, politeness: new Politeness(0) };
    const { surface } = await openSurface(env, { url: `${site.origin}/callback.html`, width: 1280, height: 800, scheme: "light" });
    await sendFrames(surface.page, ["40", message(1), "2", message(2), "3"]);
    assert.deepEqual(site.socketMessages, ["40", message(1), "2", "3"], "the second message stays in the browser, the heartbeats go through");
    assert.deepEqual(writeBudget(dir, limited).sent, 1);
    assert.deepEqual(logged(dir).map((line) => `${line.method}${line.message ? " message" : ""}`), ["SEND", "SEND message", "SEND", "SEND"]);
    const held = surface.guard.blocked.filter((entry) => entry.kind === "socket");
    assert.deepEqual(held.map((entry) => entry.writeBudget), ["out"]);
    assert.match(held[0]!.reasonNl!, /^het budget voor versturen van deze run is op: 1 van 1 verzendingen/);
    await surface.context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The sweep: a context of a command, with the same budget, here too soon after the previous message.
  reset();
  const spaced: WritePermission = { ...permission, maxWrites: 5, spacingSeconds: 60 };
  const context = await newContext(browser, { writes: writeAccess(run, spaced, "states") }, { active: true, blocked: 0 });
  const page = await context.newPage();
  await loadPage(page, `${site.origin}/callback.html`);
  await sendFrames(page, [message(1), "2", message(2)]);
  assert.deepEqual(site.socketMessages, [message(1), "2"]);
  assert.deepEqual(writeBudget(run, spaced).sent, 1);
  await context.close();
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
    assert.deepEqual({ ...stored, declaredAt: "" }, { origin: site.origin, local: true, declaredBy: null, declaredAt: "", maxWrites: 50, spacingSeconds: 0 });
    assert.match(allowed.stdout, /budget voor versturen: ten hoogste 50 verzendingen naar die origin voor de hele run, alle agents en de veegronde samen, zonder wachttijd ertussen\./);
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

test("the evaluation says how many messages were recorded and how often a recording was played", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-writes-replays-nl-"));
  try {
    assert.equal(replaysNl(dir), null);
    writeFileSync(join(dir, "opnames.jsonl"), `${JSON.stringify({ id: "a", at: "2026-10-21T09:00:00Z", source: "states", origin: "https://chat.example.nl", path: "/ws", key: "x", frames: [] })}\n`);
    writeFileSync(join(dir, "afgespeeld.jsonl"), `${JSON.stringify({ at: "2026-10-21T09:10:00Z", source: "b-331", recording: "a", path: "/ws", key: "x" })}\n`.repeat(3));
    assert.equal(replaysNl(dir), "Van één bericht in een chat is het antwoord van de server opgenomen toen het echt werd verstuurd. Daarna is 3 keer hetzelfde bericht niet opnieuw verstuurd, maar is de opname afgespeeld: de pagina kreeg het antwoord van toen, met dezelfde tussentijden. Wat de pagina ermee deed, is gemeten; wat de server later uit zichzelf zou doen, niet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
