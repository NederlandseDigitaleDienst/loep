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
import { decideWrites, recordWrites, WRITES_BLOCKED_NL, writeAccess, writesAllowedNl, writesForRun, type PassedWrite, type WritePermission } from "../src/lib/writes.ts";
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
  permission = decideWrites(`${site.origin}/`, { allowWrites: true })!;
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
  assert.deepEqual(decideWrites("http://127.0.0.1:4710/", { allowWrites: true }, now), { origin: "http://127.0.0.1:4710", local: true, declaredBy: null, declaredAt: "2026-01-02T03:04:05.000Z" });
  for (const local of ["http://localhost:3000/", "http://[::1]:8080/x", "https://gemeente.test/", "http://app.localhost/"]) assert.equal(decideWrites(local, { allowWrites: true })?.local, true, local);
  assert.throws(() => decideWrites("https://www.example.nl/", { allowWrites: true }), /geen lokaal adres.*--test-environment <origin> en --declared-by/s);
  assert.throws(() => decideWrites("https://nottest.example/", { allowWrites: true }), /geen lokaal adres/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "https://test.example.nl" }), /geef dan beide op/);
  assert.throws(() => decideWrites("https://www.example.nl/", { declaredBy: "Een Beheerder, functioneel beheerder" }), /geef dan beide op/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "https://test.example.nl", declaredBy: "Een Beheerder" }), /een naam en een functie/);
  assert.throws(() => decideWrites("https://www.example.nl/", { testEnvironment: "test.example.nl", declaredBy: "Een Beheerder, beheer" }), /http:\/\/ of https:\/\//);
  assert.throws(() => decideWrites("http://127.0.0.1:4710/", { testEnvironment: "http://127.0.0.1:4710" }), /alleen toegestaan met --allow-writes/);
  const declared = decideWrites("https://test.example.nl/start", { testEnvironment: "https://test.example.nl/pad", declaredBy: " Een Beheerder , functioneel beheerder, team web " }, now)!;
  assert.deepEqual(declared, { origin: "https://test.example.nl", local: false, declaredBy: { name: "Een Beheerder", role: "functioneel beheerder, team web" }, declaredAt: "2026-01-02T03:04:05.000Z" });
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
    assert.deepEqual({ ...stored, declaredAt: "" }, { origin: site.origin, local: true, declaredBy: null, declaredAt: "" });
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
