import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { webkit, type Browser, type Page } from "playwright";
import { ACCOUNT } from "../fixtures/account.ts";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { explore } from "../src/commands/explore.ts";
import { inventory } from "../src/commands/inventory.ts";
import { login, LOGIN_WARNING_NL } from "../src/commands/login.ts";
import { readJson, writeJson } from "../src/lib/canonical.ts";
import { agentLoginNl, IDLE_SESSION_FILE, ignoreSecrets, isLogout, loggedOutReasonNl, LOGIN_SESSION_FILE, loginCookieHeader, loginForRun, loginRefusalNl, loginSessionProblems, runLoginState, setRunLogin, storeLoginSession, type LoginSession } from "../src/lib/login.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import type { WritePermission } from "../src/lib/writes.ts";
import { SecondBrowsers } from "../src/session/second.ts";
import { filesHolding, logInOn, ROLE, tokenOf, typeAccount } from "./fixtures/account-login.ts";

let fixture: FixtureServer;
let origin: string;
let scratch: string;
let run: string;

const quiet = (): void => undefined;
const logIn = (target: { run?: string; out?: string }, act?: (page: Page) => Promise<void>) => logInOn(origin, target, act);

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-login-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  origin = fixture.origins.clean;
  run = join(scratch, "run");
});

after(async () => {
  setRunLogin(null);
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

test("the rule for a control that logs out: by its address or by a short name", () => {
  for (const href of ["/uitloggen", "/logout", "/account/log-out/", "/auth/signout?next=/", "/sso?action=logout", "https://login.example.nl/Sign_Out", "/afmelden", "/users/logoff"]) assert.ok(isLogout({ href }), href);
  for (const text of ["Uitloggen", "Log uit", " Afmelden ", "Logout", "Log out", "Sign out", "Meld je af", "Uitloggen (inwoner 4100-27)"]) assert.ok(isLogout({ text }), text);
  for (const href of ["/mijn/", "/blog/logboek", "/catalogus", "/login", "/inloggen.html", "/mijn/sessie-sluiten", "/uitleg", "/producten?soort=blogout"]) assert.ok(!isLogout({ href }), href);
  for (const text of ["Inloggen", "Uitleg", "Overzicht", "", "Aanmelden", "Veelgestelde vragen: hoe kan ik uitloggen als ik de computer met iemand deel?"]) assert.ok(!isLogout({ text }), text);
  // An address that says nothing is still caught by the name of its link.
  assert.ok(isLogout({ href: "/mijn/sessie-sluiten", text: "Afmelden" }));
});

test("the .gitignore of a run names the session files, adds what is missing and leaves the rest alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-ignore-"));
  try {
    const path = join(dir, ".gitignore");
    writeFileSync(path, "notities.txt\n/login-session.json");
    ignoreSecrets(dir);
    assert.equal(readFileSync(path, "utf8"), `notities.txt\n/login-session.json\n${IDLE_SESSION_FILE}\n`);
    // Nothing missing: the file is not touched, so a sealed run stays as it was.
    const before = statSync(path).mtimeMs;
    ignoreSecrets(dir);
    assert.equal(statSync(path).mtimeMs, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the rule for a page that fell back to the login screen", () => {
  const mark = { loginUrl: "https://site.example/inloggen" };
  assert.equal(loggedOutReasonNl(mark, { asked: "https://site.example/mijn/", final: "https://site.example/inloggen?terug=%2Fmijn%2F", passwordField: true }), "de site leidde om naar de inlogpagina");
  assert.equal(loggedOutReasonNl(mark, { asked: "https://site.example/mijn/", final: "https://site.example/mijn/", passwordField: true }), "de pagina toont een wachtwoordveld");
  assert.equal(loggedOutReasonNl(mark, { asked: "https://site.example/mijn/", final: "https://site.example/mijn/", passwordField: false }), null);
  // The login page itself was asked for: it says nothing about the session.
  assert.equal(loggedOutReasonNl(mark, { asked: "https://site.example/inloggen", final: "https://site.example/inloggen", passwordField: true }), null);
});

test("a session file is refused when it is not one, is empty or is for another site", () => {
  const good: LoginSession = { schema: "loep/login-session/1", origin: "https://acc.example.nl", loginUrl: "https://acc.example.nl/login", landingUrl: "https://acc.example.nl/mijn", role: null, loggedInAt: "2026-01-01T00:00:00.000Z", storageState: { cookies: [{ name: "sid", value: "abc", domain: "acc.example.nl", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] } };
  assert.deepEqual(loginSessionProblems(good, "https://acc.example.nl"), []);
  assert.match(loginSessionProblems({ cookies: [], origins: [] })[0]!, /geen sessiebestand van loep/);
  assert.match(loginSessionProblems({ ...good, storageState: { cookies: [], origins: [] } })[0]!, /het bestand is leeg/);
  assert.match(loginSessionProblems({ ...good, storageState: { cookies: [{ ...good.storageState.cookies[0]!, domain: "elders.example.nl" }], origins: [] } })[0]!, /geen cookie en geen opgeslagen waarde hoort bij https:\/\/acc\.example\.nl/);
  assert.match(loginSessionProblems(good, "https://andere.example.nl")[0]!, /de sessie is voor https:\/\/acc\.example\.nl en deze run onderzoekt https:\/\/andere\.example\.nl/);
  assert.match(loginSessionProblems({ ...good, storageState: "x" })[0]!, /storageState heeft niet de vorm/);
});

test("a run with a login on a site that is not local is refused without a declared test environment", async () => {
  const site = "https://acc.example.nl";
  const declared: WritePermission = { origin: site, local: false, declaredBy: { name: "Een Naam", role: "producteigenaar" }, declaredAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(loginRefusalNl("http://127.0.0.1:4711", null), null);
  assert.equal(loginRefusalNl("http://site.test", null), null);
  assert.equal(loginRefusalNl(site, declared), null);
  assert.match(loginRefusalNl(site, null)!, /geen lokaal adres.*verklaarde testomgeving.*--test-environment https:\/\/acc\.example\.nl --declared-by.*vul haar nooit zelf in/s);
  assert.match(loginRefusalNl(site, { ...declared, origin: "https://test.example.nl" })!, /verklaarde testomgeving/, "a declaration for another origin does not count");

  // The same on a run: no browser starts with the session until the run has the declaration. Nothing is asked of the site.
  const dir = join(scratch, "remote");
  mkdirSync(dir);
  const session: LoginSession = { schema: "loep/login-session/1", origin: site, loginUrl: `${site}/login`, landingUrl: `${site}/mijn`, role: "aanvrager", loggedInAt: "2026-01-01T00:00:00.000Z", storageState: { cookies: [{ name: "sid", value: "abc", domain: "acc.example.nl", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] } };
  await storeLoginSession(dir, session);
  setRunLogin(dir);
  assert.throws(() => runLoginState(), /verklaarde testomgeving/);
  // What `inventory` was started with decides, also before it is in the manifest.
  setRunLogin(dir, { writes: declared });
  assert.equal(runLoginState()!.cookies[0]!.name, "sid");
  setRunLogin(dir, { writes: null });
  assert.throws(() => runLoginState(), /verklaarde testomgeving/);
  await writeJson(join(dir, "manifest.json"), { ...(await readJson<Record<string, unknown>>(join(dir, "manifest.json"))), writes: declared });
  setRunLogin(dir);
  assert.equal(runLoginState()!.cookies[0]!.value, "abc");
  // A run that was started without the declaration refuses the login itself, before a window opens.
  const started = join(scratch, "remote-started");
  mkdirSync(started);
  await writeJson(join(started, "inventory.json"), { baseUrl: `${site}/`, origin: site, pages: [] });
  await assert.rejects(login({ run: started, url: `${site}/login`, headless: true, say: quiet }), /verklaarde testomgeving/);
  await assert.rejects(login({ run: started, url: `${site}/login`, role: "iemand@example.nl", say: quiet }), /geen e-mailadres of gebruikersnaam/);
  setRunLogin(null);
});

test("a run without a login starts every browser as it did: no cookie, and a page behind the login is the login screen", { timeout: 120_000 }, async () => {
  setRunLogin(null);
  assert.equal(runLoginState(), undefined);
  assert.equal(agentLoginNl(null), "");
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    const loaded = await loadPage(page, `${origin}/mijn/`);
    assert.equal(new URL(loaded.finalUrl).pathname, "/inloggen.html");
    assert.deepEqual(await context.cookies(), []);
  } finally {
    await browser.close();
  }
  const plain = join(scratch, "plain");
  const found = await inventory({ baseUrl: `${origin}/`, out: plain, maxPages: 5, fixedUrls: [`${origin}/mijn/`, `${origin}/contact.html`] });
  assert.ok(!("logoutLinks" in found));
  // Every run keeps the files of a login out of git, also one without a login: a session may come later.
  assert.deepEqual(readFileSync(join(plain, ".gitignore"), "utf8").split("\n").filter((line) => line && !line.startsWith("#")), [LOGIN_SESSION_FILE, IDLE_SESSION_FILE]);
  assert.match(found.pages.find((entry) => entry.url.endsWith("/mijn/"))!.title, /^Inloggen/, "without a session the page behind the login is the login page");
  const manifest = await readJson<Manifest>(join(plain, "manifest.json"));
  assert.ok(!("login" in manifest) && !("loggedIn" in manifest.steps[0]!));
  assert.ok(!readFileSync((await explore(plain)).task, "utf8").includes("achter een inlog"));
  assert.equal(fixture.logouts(), 0);
});

test("a person logs in, the session is kept where only its owner reads it, and it can be made elsewhere and taken over", { timeout: 120_000 }, async () => {
  assert.ok(LOGIN_WARNING_NL[0]!.includes("Gebruik een testaccount, nooit een echt account"));
  // Still on the login page: that is no page to tell a session by, and nothing is kept.
  await assert.rejects(logIn({ run }, async () => undefined), /op de aangewezen pagina .* staat een wachtwoordveld.*Er is niets bewaard/s);
  // A page anybody can see is none either.
  await assert.rejects(logIn({ run }, async (page) => void (await page.goto(`${origin}/contact.html`))), /ook zonder inlog te zien/);
  assert.ok(!existsSync(join(run, LOGIN_SESSION_FILE)));

  const said: string[] = [];
  const done = await login({ run, url: `${origin}/inloggen.html`, role: ROLE, headless: true, say: (line) => void said.push(line), act: typeAccount });
  assert.deepEqual(done.mark, { origin, loginUrl: `${origin}/inloggen.html`, landingUrl: `${origin}/mijn/`, role: ROLE, loggedInAt: done.mark.loggedInAt });
  assert.ok(said.slice(0, LOGIN_WARNING_NL.length).every((line, index) => line === LOGIN_WARNING_NL[index]), "the warning comes first");
  const file = join(run, LOGIN_SESSION_FILE);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const token = tokenOf(file);
  assert.match(token, /^[a-f0-9]{32}$/);
  // The manifest tells the role and the two pages, and nothing of the session or the account.
  assert.deepEqual(loginForRun(run), done.mark);
  assert.deepEqual(filesHolding(run, token), []);
  assert.deepEqual(filesHolding(run, ACCOUNT.password), []);

  // On a machine with a screen: written to a path. On the machine that examines: taken over, and checked.
  const carried = join(scratch, "elders.login-session.json");
  await logIn({ out: carried });
  assert.equal(statSync(carried).mode & 0o777, 0o600);
  const other = join(scratch, "other");
  mkdirSync(other);
  const taken = await login({ run: other, from: carried, say: quiet });
  assert.equal(taken.mark.role, ROLE);
  assert.equal(statSync(join(other, LOGIN_SESSION_FILE)).mode & 0o777, 0o600);
  assert.equal(tokenOf(join(other, LOGIN_SESSION_FILE)), tokenOf(carried));
  assert.match(readFileSync(join(other, ".gitignore"), "utf8"), /^login-session\.json$/m, "a session taken over into a run is kept out of git");
  // A file for another site than the run examines, an empty one and one that is no session are refused.
  const elsewhere = join(scratch, "elsewhere");
  mkdirSync(elsewhere);
  await writeJson(join(elsewhere, "inventory.json"), { baseUrl: `${fixture.origins.defect}/`, origin: fixture.origins.defect, pages: [] });
  await assert.rejects(login({ run: elsewhere, from: carried, say: quiet }), /de sessie is voor .* en deze run onderzoekt/);
  const empty = join(scratch, "leeg.json");
  writeFileSync(empty, JSON.stringify({ ...(JSON.parse(readFileSync(carried, "utf8")) as LoginSession), storageState: { cookies: [], origins: [] } }));
  await assert.rejects(login({ run: other, from: empty, say: quiet }), /het bestand is leeg/);
  writeFileSync(empty, "{");
  await assert.rejects(login({ run: other, from: empty, say: quiet }), /niet te lezen als JSON/);
});

test("a second browser starts with the same session", { timeout: 60_000 }, async (context) => {
  if (!SecondBrowsers.installed("webkit")) return context.skip("WebKit is niet geïnstalleerd");
  setRunLogin(run);
  let browser: Browser | null = null;
  try {
    browser = await webkit.launch();
    const page = await (await newContext(browser)).newPage();
    assert.equal(new URL((await loadPage(page, `${origin}/mijn/berichten.html`)).finalUrl).pathname, "/mijn/berichten.html");
    assert.equal(await page.locator("h1").textContent(), "Uw berichten");
    // A request that is made outside the browser, for a document, carries the session too, and only to the site it is for.
    assert.ok(loginCookieHeader(`${origin}/mijn/besluit.pdf`)!.split("; ").includes(`sessie=${tokenOf(join(run, LOGIN_SESSION_FILE))}`));
    assert.equal(loginCookieHeader("https://elders.example.nl/besluit.pdf"), null);
  } finally {
    await browser?.close();
  }
});
