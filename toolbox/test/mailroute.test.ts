import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import * as playwright from "playwright";
import type { Browser, Page } from "playwright";
import { MAIL_ROUTE_PATHS } from "../fixtures/mailroute.ts";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { REFUSED_STATUS } from "../src/browser/boundary.ts";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { cleanupLinesNl, mailCleanup, mailLinks, mailRegister, mailWait, startMailbox } from "../src/commands/mail.ts";
import { agentMailboxNl, decideMailbox, linkKind, MAIL_ADDRESS_SOURCE, mailboxForRun, mailboxLimitationsNl, readMailboxState, recordMailbox } from "../src/lib/mailbox.ts";
import { linksOf, parseMail } from "../src/lib/mailparse.ts";
import { readSecretEvents, readSecretsFile, scanRun } from "../src/lib/secrets.ts";
import { decideWrites, DEFAULT_MAX_WRITES, recordWrites, reservedWrites, writeAccess, writeBudget, writesForRun } from "../src/lib/writes.ts";
import { Daemon } from "../src/session/daemon.ts";
import { guardContext, guardRedirects, guardRedirectsByRoute, scopeForRun, TEST_VALUES, testValuesForRun, type Guard } from "../src/session/safety.ts";

/*
 * The hard mail route of the fixture (see `fixtures/mailroute.ts`): what the route does on a site
 * without the properties of the first site it was measured on.
 */

const ADDRESS = "loep-5e6f7a8b@example.com";

let browser: Browser;
let fixture: FixtureServer;
let origin: string;
let logDir: string;

before(async () => {
  browser = await launchBrowser();
  logDir = mkdtempSync(join(tmpdir(), "loep-mailroute-log-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(logDir, "fixture.log") });
  origin = fixture.origins.clean;
});

after(async () => {
  await browser.close();
  await fixture.close();
  rmSync(logDir, { recursive: true, force: true });
});

beforeEach(() => {
  const { mailRoute } = fixture;
  mailRoute.options.viaService = true;
  mailRoute.options.linkText = true;
  mailRoute.options.serviceTarget = null;
  mailRoute.outbox.length = 0;
  mailRoute.registrations.length = 0;
});

/** A run with a mailbox on the fixture, as `inventory` leaves it. */
async function mailRun(linkOrigins: string[] = []): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "loep-mailroute-"));
  const granted = { ...decideWrites(`${origin}/`, { allowWrites: true })!, maxWrites: 50, spacingSeconds: 0 };
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  await recordWrites(run, granted);
  const mark = { kind: "mailpit" as const, local: true, declaredAt: new Date(Date.now() - 1000).toISOString(), ...(linkOrigins.length > 0 ? { linkOrigins } : {}) };
  await recordMailbox(run, mark);
  await startMailbox(run, { kind: "mailpit", host: "localhost", port: 1, tls: false }, ADDRESS, mark, granted);
  return run;
}

async function sessionOn(run: string, sender: string): Promise<{ page: Page; guard: Guard; close: () => Promise<void> }> {
  const scope = await scopeForRun(run, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender };
  const context = await newContext(browser, { writes: scope.writes ?? null });
  await guardContext(context, scope, guard);
  const page = await context.newPage();
  await guardRedirects(page, scope, guard);
  return { page, guard, close: () => context.close() };
}

/** What an agent does on the form: the test values, and the button. */
async function signUp(page: Page, email = TEST_VALUES.email!): Promise<void> {
  await loadPage(page, `${origin}${MAIL_ROUTE_PATHS.form}`);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Naam").fill(TEST_VALUES.name!);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await page.waitForURL(`**${MAIL_ROUTE_PATHS.sent}`);
}

const openLink = async (page: Page, url: string): Promise<number | null> => (await page.goto(url))?.status() ?? null;

test("the form has a hidden field that changes with every page load, and is refused without one that is new", async () => {
  const load = async (): Promise<string> => /name="_csrf" value="([0-9a-f]+)"/.exec(await (await fetch(`${origin}${MAIL_ROUTE_PATHS.form}`)).text())![1]!;
  const value = await load();
  assert.notEqual(value, await load());
  const post = (csrf: string): Promise<Response> => fetch(`${origin}${MAIL_ROUTE_PATHS.form}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: csrf, email: "iemand@example.com" }) });
  assert.equal((await post(value)).status, 303);
  assert.equal((await post(value)).status, 403, "a value works once");
  assert.equal((await post("verzonnen")).status, 403);
  const [mail] = fixture.mailRoute.outbox;
  const raw = mail!.raw.toString();
  assert.match(raw, /<a href="http:\/\/127\.0\.0\.1:\d+\/k\/[0-9a-f]+">Afmelden<\/a>/);
  assert.ok(!/list-unsubscribe/i.test(raw));
});

test("the same form with the address of the run goes out for real each time: a hidden field makes every send another request", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const session = await sessionOn(run, "r-start");
  try {
    const posts = fixture.mailRoute.posts();
    await signUp(session.page);
    await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    await signUp(session.page);
    assert.equal(fixture.mailRoute.posts() - posts, 2, "the second send reached the site, also after the mail came");
    assert.equal(writeBudget(run, writesForRun(run)!).sent, 2, "and each send took from the budget");
    assert.ok(fixture.mailRoute.registrations.every((registration) => registration.address === ADDRESS), "the site got the real address");
    assert.ok(!(await session.page.content()).includes(ADDRESS));
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a link through a mailing service that nobody declared stays refused", async () => {
  const run = await mailRun();
  const session = await sessionOn(run, "r-start");
  try {
    await signUp(session.page);
    const answer = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    assert.deepEqual(answer.links, []);
    assert.deepEqual(answer.refusedOrigins, [fixture.origins.thirdParty]);
    assert.equal(fixture.mailRoute.registrations[0]!.confirmed, false, "nobody can confirm the registration");
    assert.equal(fixture.mailRoute.clicks(), 0);
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a link for unsubscribing with a path that says nothing is told by its text in the mail, and does not go to the agents on the shared registration", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const session = await sessionOn(run, "r-start");
  try {
    await signUp(session.page);
    const answer = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    assert.deepEqual(answer.links.map((link) => link.kind), ["confirm", "preferences", "unsubscribe"], "whoever leads the evaluation sees all of them");
    assert.deepEqual(mailLinks(run).links.map((link) => link.kind), ["confirm", "preferences"]);
    assert.ok(!mailLinks(run, "b-335").links.some((link) => link.kind === "unsubscribe"));
    assert.ok(!readFileSync(join(run, "mailbox.json"), "utf8").includes(ADDRESS));
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a link whose kind stays unknown goes only to a session with a registration of its own", async () => {
  fixture.mailRoute.options.viaService = false;
  fixture.mailRoute.options.linkText = false;
  const run = await mailRun();
  const lead = await sessionOn(run, "r-start");
  const agent = await sessionOn(run, "b-334");
  const box = fixture.mailRoute.mailbox();
  try {
    await signUp(lead.page);
    const answer = await mailWait(run, { mailbox: box, timeoutSeconds: 1 });
    assert.deepEqual(answer.links.map((link) => link.kind), ["other", "other", "other"]);
    assert.deepEqual(mailLinks(run), { links: [], used: [] }, "none of them goes to an agent on the shared registration");
    const own = await mailRegister(run, "b-334");
    await signUp(agent.page, own.email);
    const { links } = await mailWait(run, { session: "b-334", mailbox: box, timeoutSeconds: 1 });
    assert.deepEqual(links.map((link) => [link.kind, link.own]), [["other", true], ["other", true], ["other", true]]);
    assert.equal(await openLink(agent.page, links[2]!.url), 200);
    assert.deepEqual(fixture.mailRoute.registrations.map((registration) => registration.address), [ADDRESS], "the agent ended its own, and the shared one stays");
    assert.deepEqual(mailLinks(run, "b-335"), { links: [], used: [] });
  } finally {
    await lead.close();
    await agent.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("through a party the text of a link is all there is, and it counts", async () => {
  const run = await mailRun([fixture.origins.thirdParty]);
  const lead = await sessionOn(run, "r-start");
  try {
    await signUp(lead.page);
    await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    assert.deepEqual(mailLinks(run).links.map((link) => link.kind), ["confirm", "preferences"]);
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("the text of a link: a word for leaving in path or text wins, and a mail cannot hide it with a tag", () => {
  const text = (html: string): string | undefined => linksOf(parseMail(Buffer.from(`To: x@example.com\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`)))[0]?.text;
  assert.equal(text(`<a class="knop" href="https://site.example.nl/p/1?t=abc123def"><span>Bevestig</span> <b>nu</b></a>`), "Bevestig nu");
  assert.equal(text(`<a href='https://site.example.nl/p/1?t=a&amp;u=2'>Af&shy;melden &amp; weg</a>`)?.includes("&"), true);
  assert.equal(text(`<a href="https://site.example.nl/p/1"></a>`), undefined);
  assert.equal(linkKind("/p/x7k2", "Bevestig je aanmelding"), "confirm");
  assert.equal(linkKind("/p/x7k2", "Wijzig je voorkeuren"), "preferences");
  assert.equal(linkKind("/p/x7k2", "Afmelden"), "unsubscribe");
  assert.equal(linkKind("/p/x7k2", "Verwijder mijn gegevens"), "unsubscribe");
  assert.equal(linkKind("/voorkeuren/", "Afmelden"), "unsubscribe", "the most careful reading counts");
  assert.equal(linkKind("/afmelden/", "Bevestig"), "unsubscribe");
  assert.equal(linkKind("/p/x7k2", "Klik hier"), "other");
  assert.equal(linkKind("/p/x7k2"), "other");
});

test("a session with a registration of its own has its own address and its own links, and may end that registration", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const lead = await sessionOn(run, "r-start");
  const agent = await sessionOn(run, "b-334");
  const box = fixture.mailRoute.mailbox();
  try {
    await signUp(lead.page);
    await mailWait(run, { mailbox: box, timeoutSeconds: 1 });
    const shared = mailLinks(run).links;
    assert.equal(shared.length, 2);

    const own = await mailRegister(run, "b-334");
    assert.equal(own.fresh, true);
    assert.equal(testValuesForRun(run, "b-334").email, own.email);
    assert.notEqual(own.email, TEST_VALUES.email);
    assert.equal(testValuesForRun(run, "b-335").email, TEST_VALUES.email, "another session keeps the shared address");
    assert.equal((await mailRegister(run, "v-334")).registration, own.registration, "the verifier of a criterion is the same sender");
    await signUp(agent.page, testValuesForRun(run, "b-334").email);
    const addresses = fixture.mailRoute.registrations.map((registration) => registration.address);
    assert.equal(new Set(addresses).size, 2, "the site got two addresses");
    assert.ok(!(await agent.page.content()).includes(addresses[1]!));

    const answer = await mailWait(run, { session: "b-334", mailbox: box, timeoutSeconds: 1 });
    const mine = answer.links.filter((link) => link.own);
    assert.equal(mine.length, 3);
    assert.deepEqual(mailLinks(run).links.map((link) => link.id), shared.map((link) => link.id), "the agents on the shared registration do not get them");
    assert.deepEqual(mailLinks(run, "b-335").links.map((link) => link.id), shared.map((link) => link.id), "nor does another session");

    assert.equal(await openLink(agent.page, mine[0]!.url), 200);
    assert.equal(await openLink(agent.page, mine[1]!.url), 200);
    await agent.page.getByRole("button", { name: "Verwijder alles" }).click();
    await agent.page.waitForURL(`**${MAIL_ROUTE_PATHS.removed}`);
    assert.deepEqual(fixture.mailRoute.registrations.map((registration) => registration.address), [addresses[0]], "the agent ended its own, and the shared one stays");
    assert.equal(await openLink(lead.page, shared[1]!.url), 200, "the next agent still has the shared registration");

    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 200, pollMs: 50 });
    assert.deepEqual(cleanup.sites.map((site) => [site.registration, site.outcome]), [["A0", "removed"], [own.registration, "by session"]]);
    assert.match(cleanup.sites[1]!.noteNl, new RegExp(`verstuurde zelf iets op ${MAIL_ROUTE_PATHS.preferences}`));
    assert.equal(cleanup.mail.left, 0, "the mail of both addresses is gone");
    assert.equal(cleanup.complete, true, "an agent that ended its own registration leaves nothing to clean");
    assert.deepEqual(fixture.mailRoute.registrations, []);
    assert.deepEqual(scanRun(run).hits, []);
    assert.ok(cleanupLinesNl(cleanup).some((line) => line.startsWith("site, aanmelding A1: door de sessie zelf beëindigd")));
    assert.equal(readSecretsFile(run)!.secrets.filter((secret) => secret.source === MAIL_ADDRESS_SOURCE).length, 2, "each address stands in the register");
    for (const name of ["mailbox.json", "writes.jsonl", "manifest.json"]) for (const address of addresses) assert.ok(!readFileSync(join(run, name), "utf8").includes(address), name);
  } finally {
    await lead.close();
    await agent.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("mail cleanup removes a registration of its own that a session left behind, and says so per registration", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const lead = await sessionOn(run, "r-start");
  const agent = await sessionOn(run, "b-334");
  const box = fixture.mailRoute.mailbox();
  try {
    await signUp(lead.page);
    await mailWait(run, { mailbox: box, timeoutSeconds: 1 });
    const own = await mailRegister(run, "b-334");
    await signUp(agent.page, own.email);
    const { links } = await mailWait(run, { session: "b-334", mailbox: box, timeoutSeconds: 1 });
    const mine = links.filter((link) => link.own);
    await openLink(agent.page, mine[0]!.url);
    await openLink(agent.page, mine[1]!.url);
    await openLink(lead.page, mailLinks(run).links[0]!.url);
    await openLink(lead.page, mailLinks(run).links[0]!.url);
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 200, pollMs: 50 });
    assert.deepEqual(cleanup.sites.map((site) => site.outcome), ["removed", "removed"]);
    assert.equal(cleanup.complete, true);
    assert.deepEqual(fixture.mailRoute.registrations, []);
    assert.match(mailboxLimitationsNl(run).at(-1)!, /de 2 testaanmeldingen zijn via de site zelf verwijderd/);
  } finally {
    await lead.close();
    await agent.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a registration that was taken and never used costs nothing and leaves nothing to clean", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  try {
    await mailRegister(run, "b-334");
    assert.equal(writeBudget(run, writesForRun(run)!).sent, 0, "taking one sends nothing");
    const cleanup = await mailCleanup(run, { mailbox: fixture.mailRoute.mailbox(), browser, settleMs: 0, pollMs: 10 });
    assert.deepEqual(cleanup.sites.map((site) => site.outcome), ["no link", "unused"]);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a fresh registration is a new address; the session goes on with the latest", async () => {
  const run = await mailRun();
  try {
    const first = await mailRegister(run, "b-334");
    const second = await mailRegister(run, "a-334", { fresh: true });
    assert.notEqual(first.email, second.email);
    assert.equal(testValuesForRun(run, "b-334").email, second.email);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("on a real test environment one registration of its own takes what is left of the default budget, and a second is refused", async () => {
  const run = await mailRun();
  try {
    await recordWrites(run, { ...writesForRun(run)!, local: false, declaredBy: { name: "Iemand", role: "beheerder" }, maxWrites: DEFAULT_MAX_WRITES, spacingSeconds: 0 });
    const permission = writesForRun(run)!;
    assert.equal(reservedWrites(permission), 2);
    const lead = writeAccess(run, permission, "r-start");
    for (const step of ["het formulier", "de bevestiging"]) assert.ok(lead.claim("POST", `${origin}/`).ok, step);
    await mailRegister(run, "b-334");
    const agent = writeAccess(run, permission, "b-334");
    for (const step of ["het formulier", "de bevestiging", "het verwijderen"]) assert.ok(agent.claim("POST", `${origin}/`).ok, step);
    assert.equal(writeBudget(run, permission).sent, 5);
    assert.equal(agent.claim("POST", `${origin}/`).ok, false, "the total stays the limit");
    await assert.rejects(mailRegister(run, "b-335"), /kost 3 verzendingen.*nog 0 van 5 over/);
    assert.equal(testValuesForRun(run, "b-335").email, TEST_VALUES.email, "a refusal leaves nothing behind");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("the share of a sender without a registration of its own stays what it was", async () => {
  const run = await mailRun();
  try {
    await recordWrites(run, { ...writesForRun(run)!, local: false, declaredBy: { name: "Iemand", role: "beheerder" }, maxWrites: DEFAULT_MAX_WRITES, spacingSeconds: 0 });
    const lead = writeAccess(run, writesForRun(run)!, "r-start");
    for (let sent = 0; sent < 3; sent++) assert.ok(lead.claim("POST", `${origin}/`).ok);
    assert.equal(lead.claim("POST", `${origin}/`).ok, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a state from before there could be more registrations reads as one registration, with its cleanup", async () => {
  const run = await mailRun();
  try {
    const { registrations: _none, ...old } = readMailboxState(run)!;
    writeFileSync(join(run, "mailbox.json"), JSON.stringify({ ...old, askedLinks: 2, cleanup: { at: "2026-10-30T10:00:00.000Z", site: { outcome: "removed", noteNl: "weg", steps: [] }, mail: { removed: 1, left: 0, noteNl: null }, scan: { files: 1, bytes: 1, hits: [], compressed: 0 }, complete: true } }));
    const state = readMailboxState(run)!;
    assert.deepEqual(state.registrations, [{ id: "A0", askedLinks: 2 }]);
    assert.equal(state.cleanup!.sites[0]!.outcome, "removed");
    assert.match(mailboxLimitationsNl(run).at(-1)!, /de testaanmelding is via de site zelf verwijderd/);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("a task of a run with a mailbox does not change with a mail or a registration: a verdict stands on its hash", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const session = await sessionOn(run, "r-start");
  try {
    const before = agentMailboxNl(run, "loep mail", "RUN");
    await signUp(session.page);
    await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    await mailRegister(run, "b-334");
    assert.equal(agentMailboxNl(run, "loep mail", "RUN"), before);
    assert.match(before, /loep mail register --run RUN --session <je sessie>/);
    assert.ok(!/loep-test/.test(before));
  } finally {
    await session.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("through the commands of a session: after a registration of its own the test value email is the address of that session", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const daemon = await Daemon.create(run, await scopeForRun(run, {}), { navigationDelayMs: 0, secondBrowsers: false });
  const loep = async (session: string, command: string, ...args: string[]): Promise<Record<string, unknown>> => (await daemon.handle({ op: "command", session, command, args, options: {} })).print;
  const ref = async (session: string, query: string): Promise<string> => ((await loep(session, "find", query)).found as string[])[0]!.split(" ")[0]!;
  const fill = async (session: string): Promise<void> => {
    await loep(session, "open", MAIL_ROUTE_PATHS.form);
    await loep(session, "type", await ref(session, "css:input[type=email]"), "email");
    await loep(session, "type", await ref(session, "css:input[name=naam]"), "name");
    await loep(session, "click", await ref(session, "css:form button"));
  };
  try {
    await daemon.handle({ op: "start", session: "b-334" });
    await daemon.handle({ op: "start", session: "b-335" });
    await fill("b-335");
    await mailRegister(run, "b-334");
    await fill("b-334");
    const addresses = fixture.mailRoute.registrations.map((registration) => registration.address);
    assert.equal(addresses.length, 2);
    assert.equal(addresses[0], ADDRESS, "the other session stays on the shared address");
    assert.notEqual(addresses[1], ADDRESS);
    await mailWait(run, { session: "b-334", mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    assert.equal(mailLinks(run, "b-334").links.filter((link) => link.own).length, 3);
  } finally {
    await daemon.close();
    rmSync(run, { recursive: true, force: true });
  }
});

const click = (url: string): string => new URL(url).pathname.slice("/k/".length);

test("a link through a declared party is opened: the party is asked for its redirect, and the browser goes on to the site with aliases", async () => {
  const party = fixture.origins.thirdParty;
  const run = await mailRun([party]);
  const lead = await sessionOn(run, "r-start");
  try {
    await signUp(lead.page);
    const realClicks = fixture.mailRoute.outbox[0]!.raw.toString().match(/\/k\/([0-9a-f]+)/g)!.map((path) => path.slice(3));
    const { links, refusedOrigins } = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    assert.deepEqual(refusedOrigins, []);
    assert.equal(links.length, 3);
    assert.ok(links.every((link) => link.url.startsWith(`${party}/k/`) && !realClicks.includes(click(link.url))), "the agent gets an alias on the address of the party");
    const clicks = fixture.mailRoute.clicks();
    const sent = writeBudget(run, writesForRun(run)!).sent;
    assert.equal(await openLink(lead.page, links[0]!.url), 200);
    assert.equal(fixture.mailRoute.clicks(), clicks + 1);
    assert.equal(fixture.mailRoute.registrations[0]!.confirmed, true, "the site got its real token");
    assert.equal(writeBudget(run, writesForRun(run)!).sent, sent + 1, "the link and where it leads are one opening");
    const landed = new URL(lead.page.url());
    assert.equal(landed.origin, origin);
    assert.equal(landed.pathname, MAIL_ROUTE_PATHS.confirm);
    assert.notEqual(landed.searchParams.get("t"), fixture.mailRoute.registrations[0]!.token, "the browser has an alias");
    assert.equal(await openLink(lead.page, links[0]!.url), 200);
    assert.equal(writeBudget(run, writesForRun(run)!).sent, sent + 1, "a second opening costs nothing");
    assert.equal(readSecretsFile(run)!.secrets.find((secret) => realClicks.includes(secret.real))!.origins.join(), party, "the token of the party goes to the party alone");
    assert.deepEqual(scanRun(run).hits, []);
    assert.ok(!(await lead.page.content()).includes(fixture.mailRoute.registrations[0]!.token));
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a declared party that leads elsewhere, or does not lead on, is refused, and nothing reaches the page", async () => {
  const party = fixture.origins.thirdParty;
  const run = await mailRun([party]);
  const lead = await sessionOn(run, "r-start");
  try {
    await signUp(lead.page);
    const { links } = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    fixture.mailRoute.options.serviceTarget = `${fixture.origins.defect}/`;
    assert.equal(await openLink(lead.page, links[0]!.url), REFUSED_STATUS, "an origin that is no part of the run");
    assert.match(lead.guard.blocked.at(-1)?.reasonNl ?? "", /hoort niet bij de run/);
    fixture.mailRoute.options.serviceTarget = null;
    assert.equal(fixture.mailRoute.registrations[0]!.confirmed, false);
        const hits = fixture.mailRoute.clicks();
    const other = await lead.page.evaluate((target) => fetch(target, { method: "POST", body: "x" }).then((answer) => answer.status, () => 0), `${party}/k/iets`);
    assert.equal(other, 0, "nothing is sent to the party");
    await lead.page.goto(`${party}/`).catch(() => undefined);
    assert.equal(fixture.mailRoute.clicks(), hits, "and no other page of it is opened");
    assert.ok(lead.guard.blocked.some((entry) => entry.kind === "scope" && entry.url === `${party}/`));
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a party that shows a page of its own is refused", async () => {
  const party = fixture.origins.thirdParty;
  const run = await mailRun([party]);
  const lead = await sessionOn(run, "r-start");
  try {
    await signUp(lead.page);
    const { links } = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    fixture.mailRoute.forgetClicks();
    assert.equal(await openLink(lead.page, links[0]!.url), REFUSED_STATUS);
    assert.match(lead.guard.blocked.at(-1)?.reasonNl ?? "", /stuurde niet door naar de site/);
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a picture that a page of the site gets from a declared party stays a picture", async () => {
  const party = fixture.origins.thirdParty;
  const run = await mailRun([party]);
  const lead = await sessionOn(run, "r-start");
  try {
    await signUp(lead.page);
    await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    const status = await lead.page.evaluate((target) => new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = image.onerror = () => resolve(true);
      image.src = target;
    }), `${party}/plaatje.png`);
    assert.equal(status, true);
    assert.ok(!lead.guard.blocked.some((entry) => entry.url.includes("plaatje.png")));
    assert.ok(!readSecretEvents(run).some((event) => event.where.includes("plaatje.png")), "the boundary lets it pass");
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

test("a party is declared at inventory, over https unless it is on this machine, and is no origin of the run", () => {
  const local = decideWrites(`${origin}/`, { allowWrites: true })!;
  assert.deepEqual(decideMailbox("mailpit://localhost:8025", local, undefined, ["https://klik.example.nl/pad", "https://klik.example.nl"]).mark.linkOrigins, ["https://klik.example.nl"]);
  assert.throws(() => decideMailbox("mailpit://localhost:8025", local, undefined, ["http://klik.example.nl"]), /verwacht een adres met https/);
  assert.throws(() => decideMailbox("mailpit://localhost:8025", local, undefined, ["geen adres"]), /verwacht een adres met https/);
  assert.throws(() => decideMailbox("mailpit://localhost:8025", local, undefined, [origin]), /al een origin van de run/);
  assert.equal(decideMailbox("mailpit://localhost:8025", local).mark.linkOrigins, undefined);
});

test("the report names a declared party, and the manifest keeps it", async () => {
  const party = fixture.origins.thirdParty;
  const run = await mailRun([party]);
  try {
    assert.deepEqual(mailboxForRun(run)!.linkOrigins, [party]);
    assert.ok(mailboxLimitationsNl(run)[0]!.includes(`via ${party}: daar is alleen de doorverwijzing naar de site gelezen`));
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});

test("mail cleanup goes through the party too", async () => {
  const run = await mailRun([fixture.origins.thirdParty]);
  const lead = await sessionOn(run, "r-start");
  const box = fixture.mailRoute.mailbox();
  try {
    await signUp(lead.page);
    const { links } = await mailWait(run, { mailbox: box, timeoutSeconds: 1 });
    await openLink(lead.page, links[1]!.url);
    const cleanup = await mailCleanup(run, { mailbox: box, browser, settleMs: 200, pollMs: 50 });
    assert.equal(cleanup.sites[0]!.outcome, "removed", cleanup.sites[0]!.noteNl);
    assert.deepEqual(fixture.mailRoute.registrations, []);
    assert.deepEqual(scanRun(run).hits, []);
  } finally {
    await lead.close();
    rmSync(run, { recursive: true, force: true });
  }
});

for (const name of ["firefox", "webkit"] as const) {
  test(`a link through a declared party also works in ${name}`, async () => {
    const run = await mailRun([fixture.origins.thirdParty]);
    const lead = await sessionOn(run, "r-start");
    const other = await playwright[name].launch();
    try {
      await signUp(lead.page);
      const { links } = await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
      const scope = await scopeForRun(run, {});
      const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: "b-331" };
      const context = await newContext(other, { writes: scope.writes ?? null });
      await guardContext(context, scope, guard);
      await guardRedirectsByRoute(context, scope, guard);
      const page = await context.newPage();
      await page.goto(links[0]!.url);
      await page.waitForURL(`**${MAIL_ROUTE_PATHS.confirm}**`);
      assert.equal(await page.locator("h1").textContent(), "Bevestigd");
      assert.equal(fixture.mailRoute.registrations[0]!.confirmed, true);
      assert.deepEqual(scanRun(run).hits, []);
    } finally {
      await other.close();
      await lead.close();
      rmSync(run, { recursive: true, force: true });
    }
  });
}
