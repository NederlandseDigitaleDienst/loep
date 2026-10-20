import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { GuestQueue, type Guest, type GuestAnswer, type Versions } from "../src/lib/voiceover.ts";
import { Daemon, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import { UNAVAILABLE_NL, VOICEOVER_FOR_TESTS } from "../src/session/voiceover-command.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

// The session command `voiceover` from start to end, without a virtual Mac: the guest is played
// by an object that takes the files and commands the real one takes, and plays the test page it
// gets in Chromium, the way Safari plays it in the virtual Mac. What VoiceOver would say is made
// up from the page: these tests are about the test page, the rules and the record, not about VoiceOver.

const VERSIONS: Versions = { macos: "26.4", build: "25E246", safari: "26.4", node: "v24.21.0", language: "en_US" };

let site: FixtureServer;
let run: string;
let pages: string;
let daemon: Daemon;
let browser: Browser;
const guest = { running: true, seen: [] as { dialogOpen: boolean; kind: string; message: string; ownScript: string | null }[] };

/** What the reader in the guest answers for a test page: played in Chromium, with the control pressed by its name. */
async function playInBrowser(files: Map<string, Buffer>, url: string, steps: number, press: string | null): Promise<GuestAnswer> {
  const name = url.split("/pages/")[1]!;
  const file = join(pages, name);
  writeFileSync(file, files.get(`pages/${name}`)!);
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => location.hash.includes("%22done%22%3Atrue"), null, { timeout: 15_000 });
    const start = page.url();
    guest.seen.push(await page.evaluate(() => ({ dialogOpen: (document.getElementById("feedback") as HTMLDialogElement | null)?.open === true, kind: (document.getElementById("kind") as HTMLSelectElement | null)?.value ?? "", message: (document.getElementById("message") as HTMLTextAreaElement | null)?.value ?? "", ownScript: document.documentElement.dataset.ownScript ?? null })));
    const spoken = await page.evaluate(() => [...document.querySelectorAll("dialog[open] h2, dialog[open] button")].map((element) => `${element.textContent!.trim()} ${element.localName === "button" ? "button" : "heading level 2"}`));
    let pressed: GuestAnswer["press"];
    if (press) {
      const index = spoken.findIndex((phrase) => phrase.toLowerCase().includes(press.toLowerCase()));
      if (index === -1) pressed = { asked: press, step: null };
      else {
        await page.getByRole("button", { name: spoken[index]!.replace(/ button$/, ""), exact: true }).click();
        await page.waitForTimeout(400);
        const byItself = await page.evaluate(() => [...document.querySelectorAll("[role=status]:not([hidden]), [role=alert]:not([hidden])")].map((element) => element.textContent!.trim()).filter(Boolean));
        pressed = { asked: press, step: index + 1, control: spoken[index]!, spokenByItself: byItself };
      }
    }
    return { ok: true, url: start, title: await page.title(), spoken: spoken.slice(0, steps), ended: false, preferences: "de voorkeuren waarmee VoiceOver wordt geleverd", ...(pressed ? { press: pressed } : {}), marks: { start, end: page.url() }, versions: VERSIONS };
  } finally {
    await page.close();
  }
}

function fakeGuest(): Guest {
  const files = new Map<string, Buffer>();
  const answers = new Map<string, Promise<GuestAnswer>>();
  return {
    state: async () => (guest.running ? "running" : "stopped"),
    boot: async () => undefined,
    halt: async () => undefined,
    exec: async (command) => {
      if (command.includes("base64 -D")) {
        const [, content, path] = /echo (\S+) \| base64 -D > "\$HOME\/loep-voiceover\/([^"]+)"/.exec(command)!;
        files.set(path!, Buffer.from(content!, "base64"));
        return "copied";
      }
      if (command === 'echo "$HOME"') return "/Users/lume";
      if (command.includes("reader.js") && command.includes("'read'")) {
        const out = /rm -f (\S+\.json)/.exec(command)![1]!;
        const words = [...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map((match) => match[1]!.replace(/'\\''/g, "'"));
        const [, , url, steps, press, played] = words;
        assert.equal(played, "played", "the reader is told to wait for the test page");
        answers.set(out, playInBrowser(files, url!, Number(steps), press || null));
        return "started";
      }
      if (command.startsWith("cat /tmp/loep-voiceover-")) {
        const answer = answers.get(/cat (\S+)/.exec(command)![1]!);
        return answer ? JSON.stringify(await answer) : "";
      }
      return "";
    },
  };
}

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-voiceover-session-"));
  pages = mkdtempSync(join(tmpdir(), "loep-voiceover-pages-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  for (const session of ["main", "second"]) assert.equal((await daemon.handle({ op: "start", session })).ok, true);
  browser = await chromium.launch();
  VOICEOVER_FOR_TESTS.guest = fakeGuest();
  VOICEOVER_FOR_TESTS.queue = new GuestQueue({ file: join(pages, "vm.lock") });
});

after(async () => {
  VOICEOVER_FOR_TESTS.guest = null;
  VOICEOVER_FOR_TESTS.queue = null;
  await browser.close();
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
  rmSync(pages, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string; error?: string };

async function loep(command: string, args: string[] = [], options: Record<string, string | boolean> = {}, session = "main"): Promise<Print> {
  const response: Response = await daemon.handle({ op: "command", session, command, args, options });
  return response.print as Print;
}

const ref = async (selector: string, session = "main"): Promise<string> => String(((await loep("find", [`css:${selector}`], {}, session)).found as string[])[0]).split(" ")[0]!;
const used = async (session = "main"): Promise<number> => Number(String((await loep("status", [], {}, session)).commands).split(" ")[0]);
const record = (id: string): Observation => {
  const split = id.lastIndexOf("-");
  return JSON.parse(readFileSync(join(run, "observations", id.slice(0, split), `${id.slice(split + 1)}.json`), "utf8")) as Observation;
};

/** The feedback dialog open, with a kind chosen and a text filled in: three steps of the session. */
async function openFilled(session = "main"): Promise<void> {
  await loep("open", ["/voiceover.html"], {}, session);
  await loep("click", [await ref("#open-feedback", session)], {}, session);
  await loep("select", [await ref("#kind", session), "Compliment"], {}, session);
  await loep("type", [await ref("#message", session), "text"], {}, session);
}

test("without the virtual Mac the agent hears so, and the command costs nothing", async () => {
  guest.running = false;
  try {
    await loep("open", ["/voiceover.html"]);
    const spent = await used();
    const answer = await loep("voiceover");
    assert.equal(answer.error, UNAVAILABLE_NL);
    assert.equal(await used(), spent);
  } finally {
    guest.running = true;
  }
  // The real virtual Mac cannot reach a site on this machine: refused before it is asked, for free.
  const stand = VOICEOVER_FOR_TESTS.guest;
  VOICEOVER_FOR_TESTS.guest = null;
  try {
    const spent = await used();
    assert.match(String((await loep("voiceover")).error), /draait op deze machine; de virtuele Mac kan haar niet bereiken/);
    assert.equal(await used(), spent);
  } finally {
    VOICEOVER_FOR_TESTS.guest = stand;
  }
});

test("VoiceOver reads the state of the session: the page is fetched once, the steps are played with the site's own script, and the mail program does not open", async () => {
  await openFilled();
  const before = site.requests.length;
  const answer = await loep("voiceover", [], { press: "Via e-mail button", "no-mailto": true });
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  assert.equal(answer.state, "de toestand van je sessie: 3 van 3 stappen in Safari gespeeld");
  assert.equal(answer.notReached, undefined);
  // In the browser of the guest: the dialog open, the choices made, and the page's own script ran from the site.
  assert.deepEqual(guest.seen.at(-1), { dialogOpen: true, kind: "Compliment", message: "Test", ownScript: "ran" });
  assert.deepEqual(answer.spoken, ["Uw e-mailprogramma is geopend."]);
  assert.deepEqual(answer.heldBack, ["e-mailprogramma niet geopend: GET mailto:test@example.com?subject=Feedback"]);
  assert.deepEqual(answer.changed, ["een mailto-adres opent het e-mailprogramma niet"]);
  assert.equal(answer.waited, "niet gewacht op de virtuele Mac");
  assert.match(String(answer.note), /VoiceOver met Safari.*NVDA en JAWS/);
  // The page itself was asked for once, with GET; the site's own script and style came from the site.
  const since = site.requests.slice(before);
  assert.equal(since.filter((request) => request.path === "/voiceover.html").length, 1);
  assert.ok(since.some((request) => request.path === "/voiceover.js"));
  assert.ok(since.every((request) => request.method === "GET"), JSON.stringify(since));

  // The record: a measurement by VoiceOver, with the test page and what it played and held back.
  const observation = record(answer.id);
  const result = observation.result as { methods: { implementation: string; version: string; result: { simulated: boolean } }[]; testPage: { reached: boolean; file: string; sourceSha256: string; heldBack: { kind: string }[]; plan: { how: string }[] }; waited: { seconds: number; ahead: number } };
  assert.equal(result.methods[0]!.implementation, "voiceover");
  assert.equal(result.methods[0]!.result.simulated, false);
  assert.equal(result.testPage.reached, true);
  assert.deepEqual(result.testPage.plan.map((step) => step.how), ["click", "select", "fill"]);
  assert.deepEqual(result.testPage.heldBack.map((entry) => entry.kind), ["mailto"]);
  assert.match(result.testPage.sourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(run, result.testPage.file)));
  assert.ok(observation.images.some((image) => image.path === result.testPage.file), "the test page is evidence with its hash");
  assert.deepEqual(observation.state.steps.map((step) => step.command), ["click", "select", "type"]);
});

test("a form that would send is held back in Safari, and what the site does then is what VoiceOver hears", async () => {
  await openFilled();
  const posted = site.requests.filter((request) => request.method !== "GET").length;
  const answer = await loep("voiceover", [], { press: "Versturen button" });
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  assert.deepEqual(answer.heldBack, [`verzoek tegengehouden: POST ${site.origin}/submit`]);
  assert.deepEqual(answer.spoken, ["Versturen is niet gelukt."]);
  assert.equal(site.requests.filter((request) => request.method !== "GET").length, posted, "nothing reached the server");
});

test("with --no-popup a new window does not open, and the answer says the page was changed", async () => {
  await openFilled();
  const answer = await loep("voiceover", [], { press: "Via een nieuw venster button", "no-popup": true });
  assert.deepEqual(answer.spoken, ["Het nieuwe venster opende niet."]);
  assert.match(String((answer.heldBack as string[])[0]), /^nieuw venster niet geopend: GET .*\/elsewhere\.html$/);
  assert.deepEqual(answer.changed, ["window.open en links met target=_blank zijn vervangen: een nieuw venster opent niet"]);
});

test("a saved state is read by its name, and a state with a step Safari cannot play is refused for free", async () => {
  await openFilled();
  assert.equal((await loep("state", ["save", "feedback-ingevuld"])).saved, "feedback-ingevuld");
  await loep("open", ["/voiceover.html"]);
  const named = await loep("voiceover", [], { state: "feedback-ingevuld" });
  assert.equal(named.state, "toestand feedback-ingevuld: 3 van 3 stappen in Safari gespeeld");

  await openFilled();
  await loep("tab");
  const spent = await used();
  const refused = await loep("voiceover");
  assert.match(String(refused.error), /niet na te spelen: stap 4 \(tab\) Tab verplaatst de focus/);
  assert.equal(await used(), spent);
});

test("two agents that ask at the same time are read one after the other, and the second hears it waited", async () => {
  await openFilled("main");
  await openFilled("second");
  const [first, second] = await Promise.all([loep("voiceover", [], {}, "main"), loep("voiceover", [], {}, "second")]);
  const waits = [first, second].map((answer) => (record(answer.id).result as { waited: { ahead: number } }).waited.ahead).sort();
  assert.deepEqual(waits, [0, 1]);
});
