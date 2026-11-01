import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Browser, Page } from "playwright";
import { MAIL_ROUTE_PATHS } from "../fixtures/mailroute.ts";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { launchBrowser, loadPage, newContext } from "../src/browser/session.ts";
import { mailLinks, mailWait, startMailbox } from "../src/commands/mail.ts";
import { recordMailbox, readMailboxState } from "../src/lib/mailbox.ts";
import { decideWrites, recordWrites, writeBudget, writesForRun } from "../src/lib/writes.ts";
import { guardContext, guardRedirects, scopeForRun, TEST_VALUES, type Guard } from "../src/session/safety.ts";

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
  mailRoute.outbox.length = 0;
  mailRoute.registrations.length = 0;
});

/** A run with a mailbox on the fixture, as `inventory` leaves it. */
async function mailRun(): Promise<string> {
  const run = mkdtempSync(join(tmpdir(), "loep-mailroute-"));
  const granted = { ...decideWrites(`${origin}/`, { allowWrites: true })!, maxWrites: 50, spacingSeconds: 0 };
  writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: `${origin}/`, origin, pages: [] }));
  await recordWrites(run, granted);
  const mark = { kind: "mailpit" as const, local: true, declaredAt: new Date(Date.now() - 1000).toISOString() };
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

test("what goes wrong now: a link through a mailing service is refused, so the route stops there", async () => {
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

test("what goes wrong now: a link for unsubscribing with a path that says nothing goes to the agents, and one of them removes the shared registration", async () => {
  fixture.mailRoute.options.viaService = false;
  const run = await mailRun();
  const session = await sessionOn(run, "r-start");
  const agent = await sessionOn(run, "b-334");
  try {
    await signUp(session.page);
    await mailWait(run, { mailbox: fixture.mailRoute.mailbox(), timeoutSeconds: 1 });
    const { links } = mailLinks(run);
    assert.deepEqual(links.map((link) => link.kind), ["other", "other", "other"], "the paths say nothing");
    assert.equal(links.length, 3, "the link for unsubscribing is among them");
    const [confirm, preferences, unsubscribe] = links;
    assert.equal(await openLink(agent.page, confirm!.url), 200);
    assert.equal(fixture.mailRoute.registrations[0]!.confirmed, true);
    assert.equal(await openLink(agent.page, unsubscribe!.url), 200);
    assert.equal(fixture.mailRoute.registrations.length, 0, "one agent took the registration away from all of them");
    assert.equal(await openLink(session.page, preferences!.url), 404, "the next agent finds nothing");
    assert.equal(readMailboxState(run)!.links.length, 3);
    assert.ok(!readFileSync(join(run, "mailbox.json"), "utf8").includes(ADDRESS));
  } finally {
    await session.close();
    await agent.close();
    rmSync(run, { recursive: true, force: true });
  }
});
