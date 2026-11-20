import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DISRUPTED_PAGES, DISRUPTIONS, RETRY_AFTER_SECONDS } from "../fixtures/disruptions.ts";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { isChallenge } from "../src/lib/challenge.ts";
import { SHORT_RETRY_AFTER_SECONDS } from "../src/session/blockade.ts";

let scratch: string;
let plain: FixtureServer;
let disrupted: FixtureServer;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "loep-disruptions-"));
  plain = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "plain.log") });
  disrupted = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "disrupted.log"), disruptions: { armed: false } });
});

after(async () => {
  await plain.close();
  await disrupted.close();
  rmSync(scratch, { recursive: true, force: true });
});

const page = (id: string): string => DISRUPTIONS.find((entry) => entry.id === id)!.page;
const status = async (url: string, init?: RequestInit): Promise<number> => (await fetch(url, { redirect: "manual", ...init })).status;
/** The stylesheet as the browser asks for it from a page: with that page as referer. */
const stylesheetFor = async (origin: string, path: string): Promise<number> => (await fetch(`${origin}/stijl.css`, { headers: { referer: `${origin}${path}` } })).status;

test("without disruptions every page of a case is served as before", async () => {
  assert.equal(plain.disruptions, null);
  for (const site of ["defect", "clean"] as const) {
    assert.equal(await status(`${plain.origins[site]}${page("unavailable")}`), 404, "the page of the 503 exists only with disruptions");
    for (const path of DISRUPTED_PAGES.filter((path) => path !== page("unavailable"))) assert.equal(await status(`${plain.origins[site]}${path}`), 200, path);
    for (let round = 0; round < 2; round++) assert.equal(await stylesheetFor(plain.origins[site], page("stylesheet-always")), 200);
  }
  const frame = await fetch(`${plain.origins.thirdParty}${page("robot-check")}`);
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get("cf-ray"), null);
});

test("with disruptions each case answers as fixtures/disruptions.ts says, deterministically, on both variants", async () => {
  // Disarmed, the once-only cases do nothing; the others are always there.
  for (const site of ["defect", "clean"] as const) {
    const origin = disrupted.origins[site];
    assert.equal(await status(`${origin}${page("too-many-requests")}`), 200);
    assert.equal(await stylesheetFor(origin, page("stylesheet-once")), 200);
    const unavailable = await fetch(`${origin}${page("unavailable")}`);
    assert.equal(unavailable.status, 503);
    assert.match(await unavailable.text(), /<h1>Tijdelijk niet beschikbaar<\/h1>/);
    for (let round = 0; round < 3; round++) assert.equal(await stylesheetFor(origin, page("stylesheet-always")), 503);
    // The stylesheet of any other page arrives.
    assert.equal(await stylesheetFor(origin, "/nieuws/"), 200);
  }

  disrupted.disruptions!.arm();
  for (const site of ["defect", "clean"] as const) {
    const origin = disrupted.origins[site];
    const tooMany = await fetch(`${origin}${page("too-many-requests")}`);
    assert.equal(tooMany.status, 429);
    assert.equal(tooMany.headers.get("retry-after"), String(RETRY_AFTER_SECONDS));
    assert.ok(RETRY_AFTER_SECONDS <= SHORT_RETRY_AFTER_SECONDS, "short enough for the sweep to wait it out");
    assert.equal(await status(`${origin}${page("too-many-requests")}`), 200, "once");
    assert.equal(await stylesheetFor(origin, page("stylesheet-once")), 502);
    assert.equal(await stylesheetFor(origin, page("stylesheet-once")), 200, "once");
  }
  // Armed again, they happen once more; armed for one variant, the other answers as usual.
  disrupted.disruptions!.arm("defect");
  assert.equal(await status(`${disrupted.origins.clean}${page("too-many-requests")}`), 200, "arming one variant leaves the other alone");
  assert.equal(await stylesheetFor(disrupted.origins.clean, page("stylesheet-once")), 200);
  assert.equal(await status(`${disrupted.origins.defect}${page("too-many-requests")}`), 429);
  assert.equal(await stylesheetFor(disrupted.origins.defect, page("stylesheet-once")), 502);
});

test("with disruptions Kijkpunt answers as a site behind Cloudflare, and the window with the check box comes after a robot check", async () => {
  const origin = disrupted.origins.thirdParty;
  const first = await fetch(`${origin}${page("robot-check")}`);
  assert.equal(first.status, 403);
  assert.equal(first.headers.get("cf-mitigated"), "challenge");
  assert.ok(first.headers.get("cf-ray"));
  const html = await first.text();
  const script = /<script src="([^"]+)"/.exec(html)![1]!;
  assert.ok(isChallenge(`${origin}${script}`, () => true), "the script is on the path of Cloudflare's check");
  const code = await (await fetch(`${origin}${script}`)).text();
  const flow = /fetch\("([^"]+)"/.exec(code)![1]!;
  assert.ok(isChallenge(`${origin}${flow}x`, () => true));
  const before = disrupted.writes().length;
  const cleared = await fetch(`${origin}${flow}1`, { method: "POST", body: "r=1" });
  assert.equal(cleared.status, 200);
  const cookie = cleared.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal(disrupted.writes().length, before, "a POST of the check is not something sent to the site");
  const after = await fetch(`${origin}${page("robot-check")}`, { headers: { cookie } });
  assert.equal(after.status, 200);
  assert.match(await after.text(), /Ik ben geen robot/);
  // The other windows of Kijkpunt are there without a check.
  assert.equal(await status(`${origin}/speler.html`), 200);
});
