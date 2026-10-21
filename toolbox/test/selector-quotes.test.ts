import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Daemon, type Response } from "../src/session/daemon.ts";
import { selectorProblemNl } from "../src/session/surface.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

/**
 * An agent that types `loep find css:main > div` without quotes gets no answer: the shell writes it
 * to a file `div`. What reaches the session can be empty or end on a combinator; the session says
 * so, and the task tells the agent to quote a selector.
 */
let site: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-selector-quotes-"));
  daemon = await Daemon.create(run, { hosts: [new URL(site.origin).host], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

const raw = (command: string, args: string[] = [], options: Record<string, string | boolean> = {}): Promise<Response> => daemon.handle({ op: "command", session: "main", command, args, options });

test("a selector that is empty or ends on a combinator is what the shell left over, and the message says to quote it", () => {
  for (const whole of ["main > div", "main", "nav a, footer a", "a[href$=\".mp3\"]", "li + li", "h2 ~ p"]) assert.equal(selectorProblemNl(whole), null, whole);
  assert.match(selectorProblemNl("")!, /^de selector is leeg\. Zet een selector altijd tussen enkele aanhalingstekens, zoals 'css:main > div': zonder aanhalingstekens leest de shell > als een omleiding/);
  assert.match(selectorProblemNl("   ")!, /^de selector is leeg/);
  for (const [cut, end] of [["main >", ">"], ["main>", ">"], ["li +", "+"], ["h2 ~", "~"], ["nav,", ","]] as const) assert.match(selectorProblemNl(cut)!, new RegExp(`^de selector "${cut.replace(/[+]/g, "\\+")}" eindigt op "\\${end}"\\. Zet een selector`), cut);
});

test("find, a command on an element and a second element give that message as a command given wrongly", { timeout: 120_000 }, async () => {
  assert.equal((await raw("open", ["/"])).ok, true);
  for (const args of [["css:main", ">"], ["css:main >"], ["css:"]]) {
    const response = await raw("find", args);
    assert.equal(response.ok, false, args.join(" "));
    assert.match(String(response.print.error), /^ongeldige selector: de selector (is leeg|"main >" eindigt op ">")\. Zet een selector altijd tussen enkele aanhalingstekens/, JSON.stringify(response.print));
  }
  const click = await raw("click", ["css:main >"]);
  assert.equal(click.ok, false);
  assert.match(String(click.print.error), /^ongeldige selector: de selector "main >" eindigt op ">"/);
  const against = await raw("distinct", ["css:main"], { against: "css:main >" });
  assert.equal(against.ok, false);
  assert.match(String(against.print.error), /^--against: de selector "main >" eindigt op ">"/);
  // A selector that is whole still finds, and an empty role or tag is said as such instead of searched as text.
  const found = await raw("find", ["css:main"]);
  assert.equal(found.ok, true, JSON.stringify(found.print));
  assert.equal(found.print.total, 1);
  const role = await raw("find", ["role:"]);
  assert.equal(role.ok, false);
  assert.match(String(role.print.error), /^find role: verwacht een rol/);
});

test("the tables of commands in the tasks put a selector in single quotes and say why", () => {
  const templates = join(import.meta.dirname, "..", "..", "templates");
  for (const file of ["gereedschap.md", "verken.md"]) {
    const text = readFileSync(join(templates, file), "utf8");
    assert.match(text, /`find 'css:<selector>'`/, file);
    assert.match(text, /Zet een selector altijd tussen enkele aanhalingstekens: `find 'css:main > div'`\. Zonder aanhalingstekens leest de shell `>` als een omleiding/, file);
  }
});
