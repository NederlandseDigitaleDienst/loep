import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { collect } from "../src/commands/collect.ts";
import { evaluate } from "../src/commands/evaluate.ts";
import { explore, exploreContext } from "../src/commands/explore.ts";
import { instrumentTasks } from "../src/commands/instrument-tasks.ts";
import { inventory } from "../src/commands/inventory.ts";
import { render } from "../src/commands/render.ts";
import { sample } from "../src/commands/sample.ts";
import { seal, verify } from "../src/commands/verify.ts";
import { canonicalJson, readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import { LOGIN_SESSION_FILE, LoginExpired, loginForRun, loginNl, NOT_LOGGED_IN_NL, runLoginState, setRunLogin } from "../src/lib/login.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import { pageStampPath } from "../src/lib/sweepstamp.ts";
import { Daemon, type Response } from "../src/session/daemon.ts";
import { scopeForRun } from "../src/session/safety.ts";
import { ACCOUNT } from "../fixtures/account.ts";
import { filesHolding, logInOn, ROLE, tokenOf, walk } from "./fixtures/account-login.ts";

let fixture: FixtureServer;
let origin: string;
let scratch: string;
/** The run that goes through the chain logged in. */
let run: string;

const logIn = (target: { run?: string; out?: string }) => logInOn(origin, target);

const ACCOUNT_PAGES = ["/mijn/", "/mijn/aanvragen.html", "/mijn/gegevens.html"];

/** The smallest site model the sweep accepts: the page types the inventory proposes, and nothing to open. */
async function modelFor(dir: string): Promise<void> {
  const context = exploreContext(await readJson(join(dir, "inventory.json")));
  const model = { version: 1, baseUrl: context.baseUrl, descriptionNl: "Het deel van een gemeentesite waar een inwoner zijn aanvragen en berichten ziet.", pageTypes: context.proposedPageTypes.map((type, index) => ({ ...type, descriptionNl: `Paginatype ${index + 1}` })), blockers: [], components: [], processes: [], frames: context.frames.map((frame) => ({ address: frame.address, class: "no-content", descriptionNl: "Leeg venster", reasonNl: "Toont de bezoeker niets." })), notesNl: [] };
  writeFileSync(join(dir, "site.json"), JSON.stringify(model, null, 2));
  await writeJson(join(dir, "site-check.json"), { ok: true, siteSha256: await sha256File(join(dir, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
}

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-login-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  origin = fixture.origins.clean;
  run = join(scratch, "run");
  await logIn({ run });
});

after(async () => {
  setRunLogin(null);
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

test("the inventory finds the pages behind the login by following links, and follows no link that logs out", { timeout: 300_000 }, async () => {
  const dir = join(scratch, "crawl");
  await logIn({ run: dir });
  setRunLogin(dir);
  const found = await inventory({ baseUrl: `${origin}/`, out: dir, maxPages: 60 });
  const paths = found.pages.map((entry) => new URL(entry.url).pathname);
  for (const path of ["/mijn/", "/mijn/aanvragen.html", "/mijn/berichten.html", "/mijn/gegevens.html"]) assert.ok(paths.includes(path), `${path} was found`);
  assert.equal(found.sitemapUrls, 0, "no sitemap is asked for behind a login");
  assert.match(readFileSync(join(dir, "pages", found.pages.find((entry) => entry.url.endsWith("/mijn/gegevens.html"))!.slug, "page.html"), "utf8"), /Ingelogd als inwoner/);
  // One link says in its address that it logs out, the other only in its name.
  assert.deepEqual(found.logoutLinks, [`${origin}/mijn/sessie-sluiten`, `${origin}/uitloggen`]);
  assert.deepEqual(found.skipped.filter((entry) => entry.reason === "logs out: not followed").map((entry) => entry.url), found.logoutLinks);
  assert.equal(fixture.logouts(), 0, "nobody was logged out");
  assert.deepEqual(filesHolding(dir, tokenOf(join(dir, LOGIN_SESSION_FILE))), []);
});

test("a session of an agent starts logged in, refuses to log out and stops when the session ran out", { timeout: 180_000 }, async () => {
  const dir = join(scratch, "crawl");
  setRunLogin(dir);
  const daemon = await Daemon.create(dir, await scopeForRun(dir, {}), { navigationDelayMs: 20, secondBrowsers: false });
  const command = (name: string, args: string[] = []): Promise<Response> => daemon.handle({ op: "command", session: "a", command: name, args, options: {} });
  const errorOf = (response: Response): string => String((response.print as { error?: string }).error ?? "");
  try {
    assert.equal((await daemon.handle({ op: "start", session: "a" })).ok, true);
    const opened = await command("open", [`${origin}/mijn/gegevens.html`]);
    assert.equal(opened.ok, true, JSON.stringify(opened.print));
    for (const name of ["Uitloggen", "Afmelden"]) {
      const found = await command("find", [name]);
      const ref = (found.print as unknown as { found: string[] }).found[0]!.split(" ")[0]!;
      const clicked = await command("click", [ref]);
      assert.equal(clicked.ok, false, name);
      assert.match(errorOf(clicked), /dit logt uit, en de run is ingelogd: het is niet gedaan/);
    }
    // Asked for by address: the request never leaves, for the address that says so and for the one the inventory found by its name.
    for (const path of ["/uitloggen", "/mijn/sessie-sluiten"]) {
      const refused = await command("open", [`${origin}${path}`]);
      assert.equal(refused.ok, false, path);
      assert.match(errorOf(refused), /dit logt uit, en de run is ingelogd: het is niet gedaan/, path);
    }
    assert.equal(fixture.logouts(), 0);
    assert.equal((await command("open", [`${origin}/mijn/`])).ok, true, "and the session still holds");

    fixture.expireSessions();
    const late = await command("open", [`${origin}/mijn/aanvragen.html`]);
    assert.equal(late.ok, false);
    assert.match(errorOf(late), /de inlogsessie is verlopen: .*\/mijn\/aanvragen\.html viel terug op het inlogscherm \(de site leidde om naar de inlogpagina\).*loep login --run/);
    // A new login is picked up by the process that is running: no restart.
    await logIn({ run: dir });
    assert.equal((await command("open", [`${origin}/mijn/aanvragen.html`])).ok, true);
    await logIn({ run });
  } finally {
    await daemon.close();
  }
});

test("the sweep measures the pages behind the login, stops when the session runs out and goes on after a new login", { timeout: 600_000 }, async () => {
  setRunLogin(run);
  await inventory({ baseUrl: `${origin}/mijn/`, out: run, maxPages: 10, fixedUrls: ACCOUNT_PAGES.map((path) => `${origin}${path}`) });
  // The model first: it says that the empty window of another party on every page is no page of the sample.
  await modelFor(run);
  const chosen = await sample(run, "seed");
  assert.equal(chosen.items.length, ACCOUNT_PAGES.length);
  const pages = chosen.items.filter((item) => ACCOUNT_PAGES.includes(new URL(item.url).pathname));
  assert.equal(pages.length, ACCOUNT_PAGES.length);
  const [first, second] = [pages[0]!, pages[1]!];

  // The session ends the moment the first page is measured: the second page is the login screen.
  const watch = setInterval(() => {
    if (!existsSync(pageStampPath(run, first.slug))) return;
    clearInterval(watch);
    fixture.expireSessions();
  }, 25);
  try {
    await assert.rejects(collect({ run }), (error: Error) => {
      assert.ok(error instanceof LoginExpired);
      assert.match(error.message, /de inlogsessie is verlopen: .* viel terug op het inlogscherm .*Wat al gemeten is, blijft staan\. Laat een mens opnieuw inloggen met loep login --run .* en geef dit commando daarna opnieuw/);
      return true;
    });
  } finally {
    clearInterval(watch);
  }
  assert.ok(existsSync(pageStampPath(run, first.slug)), "what was measured stays");
  assert.ok(!existsSync(pageStampPath(run, second.slug)), "the login screen was not measured as the page");
  assert.ok(!existsSync(join(run, "collect.json")));
  // Still expired: the next try stops before it measures anything.
  await assert.rejects(collect({ run }), LoginExpired);

  await logIn({ run });
  await collect({ run });
  const step = (await readJson<Manifest>(join(run, "manifest.json"))).steps.findLast((entry) => entry.command === "collect")!;
  assert.equal(step.reusedPages, 1, "the page that was measured before the session ran out is kept");
  for (const item of pages) {
    const facts = await readJson<{ title: string }>(join(run, "pages", item.slug, "facts.json"));
    assert.ok(!/^Inloggen/.test(facts.title), `${item.url} was measured as itself: ${facts.title}`);
  }
  assert.equal(fixture.logouts(), 0);
});

test("the session is in no seal, no report, no dossier and no task; they name the role and that a person logged in", { timeout: 300_000 }, async () => {
  setRunLogin(run);
  const token = tokenOf(join(run, LOGIN_SESSION_FILE));
  // The tasks of the agents and the dossier of a criterion.
  const prompt = readFileSync((await explore(run)).task, "utf8");
  assert.match(prompt, /\*\*Deze site wordt onderzocht achter een inlog\.\*\* Elke `open` begint ingelogd met een testaccount \(rol: aanvrager met lopende zaken\)\..*Log nooit uit/s);
  await instrumentTasks(run, { only: ["2.4.2"] });
  const dossier = await readJson<{ login?: { role: string; noteNl: string } }>(join(run, "tasks", "2.4.2", "dossier.json"));
  assert.equal(dossier.login?.role, ROLE);
  assert.match(readFileSync(walk(join(run, "rondgang")).find((path) => path.endsWith(".md"))!, "utf8"), /Deze site wordt onderzocht achter een inlog/);

  // The evaluation and the report say what was done.
  const evaluation = await evaluate({ run, name: "Mijn Berkenveen", organisation: null, model: "geen" });
  const sentence = evaluation.limitationsNl.find((entry) => entry.startsWith("Er is ingelogd"));
  assert.equal(sentence, `${loginNl(loginForRun(run)!)}.`);
  assert.match(sentence!, /^Er is ingelogd met een testaccount \(rol: aanvrager met lopende zaken\)\. Het inloggen zelf is door een mens gedaan/);
  assert.ok(!evaluation.limitationsNl.includes(NOT_LOGGED_IN_NL));
  writeFileSync(join(run, "evaluation.json"), canonicalJson(evaluation));
  const report = await render(run);
  assert.match(readFileSync(report.markdown, "utf8"), /Er is ingelogd met een testaccount \(rol: aanvrager met lopende zaken\)/);

  // The seal: the session file is not in it, and a run that still holds the file verifies.
  await seal(run);
  const index = await readJson<{ files: Record<string, string> }>(join(run, "evidence-index.json"));
  assert.ok(!(LOGIN_SESSION_FILE in index.files));
  assert.ok("manifest.json" in index.files);
  assert.equal(await verify(run), true);
  rmSync(join(run, LOGIN_SESSION_FILE));
  assert.equal(await verify(run), true, "throwing the session away afterwards does not break the seal");

  // Nothing anywhere in the run holds the cookie, the user name or the password.
  for (const secret of [token, ACCOUNT.password, `"${ACCOUNT.username}"`, `=${ACCOUNT.username}`]) assert.deepEqual(filesHolding(run, secret), [], secret);
  // A run that was made with a login does not go on quietly without one.
  assert.throws(() => runLoginState(), /het sessiebestand login-session\.json ontbreekt.*loep login --run/s);
  setRunLogin(null);
});
