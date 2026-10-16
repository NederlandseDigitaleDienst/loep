import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { collect } from "../src/commands/collect.ts";
import { contrast } from "../src/commands/contrast.ts";
import { exploreContext } from "../src/commands/explore.ts";
import { inventory } from "../src/commands/inventory.ts";
import { sample } from "../src/commands/sample.ts";
import { states } from "../src/commands/states.ts";
import { readJson, sha256File, writeJson } from "../src/lib/canonical.ts";
import type { Manifest } from "../src/lib/manifest.ts";
import { Daemon } from "../src/session/daemon.ts";

/**
 * The sweep on the test site, once with one page at a time and once with four. Both runs start
 * from the same explored run; afterwards every file they wrote is compared, apart from the times.
 *
 * The pages are chosen so that two runs with one at a time agree with each other: the start page
 * turns its highlighted items every four seconds and the contact page counts down every second,
 * so what a probe sees there depends on the moment, also without anything at the same time.
 */
describe("the sweep with four at once writes what it writes with one at a time", { timeout: 1_800_000 }, () => {
  let fixture: FixtureServer;
  let scratch: string;
  let origin: string;
  const seconds: Record<string, Record<string, number>> = {};

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "loep-atonce-sweep-"));
    fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
    origin = fixture.origins.defect;
  });

  after(async () => {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  /** An explored run: four pages, a cookie notice as blocker and the chat as component, both recorded through a real session. */
  async function explored(): Promise<string> {
    const run = join(scratch, "explored");
    const paths = ["/afval.html", "/openingstijden.html", "/nieuws/zomerfeest.html", "/vergunning.html"];
    await inventory({ baseUrl: `${origin}/`, out: run, maxPages: paths.length, fixedUrls: paths.map((path) => `${origin}${path}`) });
    const daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${origin}/`, strict: false }, { navigationDelayMs: 20 });
    const loep = async (command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Record<string, unknown>> => {
      const response = await daemon.handle({ op: "command", session: "verken", command, args, options });
      assert.equal(response.ok, true, `${command}: ${JSON.stringify(response.print)}`);
      return response.print;
    };
    const ref = async (query: string): Promise<string> => ((await loep("find", [query])).found as string[])[0]!.split(" ")[0]!;
    try {
      await daemon.handle({ op: "start", session: "verken" });
      await loep("open", ["/afval.html"]);
      await loep("click", [await ref("css:[data-keuze=weigeren]")]);
      await loep("state", ["save", "blocker-cookies"]);
      await loep("open", ["/afval.html"], { state: "blocker-cookies" });
      await loep("click", [await ref("css:.chat-knop")]);
      await loep("state", ["save", "component-chat"]);
    } finally {
      await daemon.close();
    }
    const context = exploreContext(await readJson(join(run, "inventory.json")));
    const pageTypes = context.proposedPageTypes.map((type, index) => ({ ...type, id: `type-${index + 1}`, descriptionNl: `Paginatype ${index + 1}` }));
    const model = {
      version: 1,
      baseUrl: `${origin}/`,
      descriptionNl: "Dit is de website van een kleine gemeente. Inwoners lezen er nieuws, zoeken op wanneer het afval wordt opgehaald en wanneer het gemeentehuis open is, en kunnen via een chatvenster een vraag stellen. Voor het onderzoek valt op dat er bij het eerste bezoek een cookiemelding over de pagina ligt, die eerst gesloten moet worden voordat de pagina zelf te gebruiken is.",
      pageTypes,
      blockers: [{ id: "cookies", kind: "cookie-banner", descriptionNl: "Cookiemelding", recipe: "blocker-cookies", postcondition: { kind: "gone", selector: "#cookiemelding" } }],
      components: [{ id: "chat", type: "dialog", descriptionNl: "Chatvenster", pageTypes: [pageTypes.find((type) => type.pages.includes(`${origin}/afval.html`))!.id], viewport: null, recipe: "component-chat", postcondition: { kind: "expanded", selector: ".chat-knop" } }],
      processes: [],
      frames: context.frames.map((frame) => ({ address: frame.address, class: "no-content", descriptionNl: "Leeg venster", reasonNl: "Toont de bezoeker niets." })),
      notesNl: [],
    };
    writeFileSync(join(run, "site.json"), JSON.stringify(model, null, 2));
    // What check-site leaves behind when the model holds; the recipes were just recorded.
    await writeJson(join(run, "site-check.json"), { ok: true, siteSha256: await sha256File(join(run, "site.json")), checkedAt: new Date().toISOString(), problems: [], replays: [], unusedRecipes: [] });
    await sample(run, "seed");
    return run;
  }

  /**
   * What records a moment or a duration, which two runs with one at a time do not share either: when a
   * timer started and fired, how long a measurement of the timers took and so how often a timer fired
   * in it, when a cookie the page set runs out, and how long the probe of forced colours took.
   */
  const TIMES = new Set(["elapsedMs", "startedAtMs", "firstFiredAtMs", "fired", "expires", "ms"]);
  /** How much of a focus picture changed: the edges of a focus ring differ by a few pixels between two runs with one at a time. Two decimals are kept. */
  const PIXEL_SHARES = /PixelShare$/;
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !TIMES.has(key))
        .map(([key, entry]) => [key, PIXEL_SHARES.test(key) && typeof entry === "number" ? Math.round(entry * 100) / 100 : normalise(entry)]),
    );
  };

  /**
   * Every file of a run, the address of the run replaced: a JSON file without what records a time, any
   * other text as it is, and a picture by its name only (its pixels differ between any two runs).
   */
  function contents(run: string): Map<string, string> {
    const files = new Map<string, string>();
    const visit = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (name.endsWith(".png")) files.set(relative(run, path), "");
        else {
          const text = readFileSync(path, "utf8").replaceAll(run, "<run>");
          files.set(relative(run, path), name.endsWith(".json") ? JSON.stringify(normalise(JSON.parse(text))) : text);
        }
      }
    };
    visit(run);
    // The manifest holds when each step ran and how long it took; it is compared below on what it says about the sweep.
    files.delete("manifest.json");
    return files;
  }

  /** Where two JSON texts first differ, for the message of a failure. */
  const firstDifference = (one: string, other: string): string => {
    let at = 0;
    while (at < one.length && one[at] === other[at]) at++;
    return `${one.slice(Math.max(0, at - 80), at + 80)} | ${other.slice(Math.max(0, at - 80), at + 80)}`;
  };

  test("collect, contrast and states", async () => {
    const base = await explored();
    for (const atOnce of [1, 4]) {
      const run = join(scratch, `at-once-${atOnce}`);
      cpSync(base, run, { recursive: true });
      seconds[atOnce] = {};
      for (const [name, step] of [
        ["collect", () => collect({ run, atOnce })],
        ["contrast", () => contrast(run, { atOnce })],
        ["states", () => states(run, { atOnce })],
      ] as const) {
        const started = Date.now();
        await step();
        seconds[atOnce]![name] = Math.round((Date.now() - started) / 1000);
      }
    }
    process.stderr.write(`seconden per stap, één tegelijk ${JSON.stringify(seconds[1])}, vier tegelijk ${JSON.stringify(seconds[4])}\n`);

    const one = contents(join(scratch, "at-once-1"));
    const four = contents(join(scratch, "at-once-4"));
    assert.deepEqual([...four.keys()], [...one.keys()], "the same files");
    const differ = [...one.keys()].filter((path) => one.get(path) !== four.get(path)).map((path) => `${path}: ${firstDifference(one.get(path)!, four.get(path)!)}`);
    assert.deepEqual(differ, [], "every file the same");
    // What the sweep measured is all there: the blocker was seeded and the chat captured.
    const siteStates = JSON.parse(one.get("site-states.json")!) as { seeded: { blockers: string[] }; states: { id: string; reached: boolean }[] };
    assert.deepEqual(siteStates.seeded.blockers, ["cookies"]);
    assert.ok(siteStates.states.find((state) => state.id === "component-chat")?.reached, "the chat was captured");

    // The manifest says the same about each step, apart from the times (also those of each lane) and how many ran at once.
    const steps = async (atOnce: number): Promise<Record<string, unknown>[]> =>
      (await readJson<Manifest>(join(scratch, `at-once-${atOnce}`, "manifest.json"))).steps
        .filter((step) => ["collect", "contrast", "states"].includes(step.command))
        .map(({ at: _at, startedAt: _startedAt, seconds: _seconds, atOnce: _atOnce, laneSeconds: _laneSeconds, ...rest }) => rest);
    assert.deepEqual(await steps(4), await steps(1));
    const sweptAtOnce = (await readJson<Manifest>(join(scratch, "at-once-4", "manifest.json"))).steps.filter((step) => step.atOnce !== undefined).map((step) => [step.command, step.atOnce]);
    assert.deepEqual(sweptAtOnce, [["collect", 4], ["contrast", 4], ["states", 4]]);
  });
});
