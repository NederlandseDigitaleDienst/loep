import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Site } from "../src/backlog.ts";
import { isLocalHost, regieArgs, regieEnv, regiePrompt } from "../src/regie.ts";

const site = (overrides: Partial<Site> = {}): Site => ({
  url: "https://www.voorbeeld.nl/",
  slug: "voorbeeld.nl",
  name: "Voorbeeld",
  organisation: "Ministerie van Voorbeeld",
  purpose: "verbeteren",
  sending: { allow: false, max: 20 },
  alsoOrigins: [],
  neverOpen: [],
  login: null,
  atOnce: 3,
  navigationDelay: null,
  mailbox: null,
  vendorTags: [],
  note: "",
  ...overrides,
});

const prompt = (overrides: Partial<Site> = {}, resumeNl: string | null = null): string => regiePrompt({ site: site(overrides), run: "/runs/voorbeeld", atOnce: overrides.atOnce ?? 3, resumeNl });

test("de prompt noemt de site, de run en de naam van de skill", () => {
  const text = prompt();
  assert.match(text, /nldd-a11y-audit/);
  assert.match(text, /Site: https:\/\/www\.voorbeeld\.nl\//);
  assert.match(text, /Run: \/runs\/voorbeeld/);
});

test("wat de skill vooraf vraagt staat in de prompt, in plaats van een vraag aan niemand", () => {
  const text = prompt({
    purpose: "verantwoorden",
    alsoOrigins: ["https://docs.voorbeeld.nl/"],
    neverOpen: ["archief.voorbeeld.nl"],
    login: { page: "https://www.voorbeeld.nl/inloggen", role: "testgebruiker" },
    mailbox: "imap://mail.voorbeeld.nl:993",
    vendorTags: ["nldd-"],
    note: "de eigenaar wil eerst de homepage",
  });
  assert.match(text, /verantwoorden hoe de site ervoor staat/);
  assert.match(text, /"https:\/\/docs\.voorbeeld\.nl\/"/);
  assert.match(text, /archief\.voorbeeld\.nl/);
  assert.match(text, /login --run \/runs\/voorbeeld --url https:\/\/www\.voorbeeld\.nl\/inloggen --role "testgebruiker"/);
  assert.match(text, /--idle/);
  assert.match(text, /--mailbox imap:\/\/mail\.voorbeeld\.nl:993/);
  assert.match(text, /--vendor-tags nldd-/);
  assert.match(text, /de eigenaar wil eerst de homepage/);
  assert.match(text, /Agents tegelijk: 3/);
});

test("versturen op een site op deze machine gaat met --allow-writes, elders vraagt het een verklaring", () => {
  const local = prompt({ url: "http://127.0.0.1:4710/", sending: { allow: true, max: 50 } });
  assert.match(local, /--allow-writes/);
  assert.match(local, /hooguit 50/);
  const real = prompt({ sending: { allow: true, max: 5 } });
  assert.match(real, /--test-environment/);
  assert.match(real, /--declared-by/);
  assert.match(real, /stop daarvoor/);
  const none = prompt();
  assert.match(none, /niet toegestaan/);
});

test("een hervatting zegt wat de mens deed en begint bij pending", () => {
  const text = prompt({}, "De mens logde in.");
  assert.match(text, /Deze run loopt al\. De mens logde in\./);
  assert.match(text, /pending --run/);
});

test("de spelregels noemen de werkstroom, de tool en de stop bij een mens", () => {
  const text = prompt();
  assert.match(text, /Workflow-tool op .*onderzoek\.workflow\.js/);
  assert.match(text, /atOnce: 3/);
  assert.match(text, /subagent-tool/);
  assert.match(text, /vraag\.md/);
  assert.match(text, /uitvoer\.log/);
  assert.match(text, /curl en wget zijn geweigerd/);
});

test("de commandoregel heeft de plugin, de tools en de weigeringen die een run nodig heeft", () => {
  const args = regieArgs("prompt", "/runs/voorbeeld");
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  assert.equal(args[0], "-p");
  assert.equal(args[1], "prompt");
  assert.equal(value("--plugin-dir"), join(import.meta.dirname, "..", ".."));
  assert.match(value("--tools") ?? "", /Workflow/);
  assert.match(value("--tools") ?? "", /Task/);
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(value("--output-format"), "stream-json");
  assert.equal(value("--add-dir"), "/runs/voorbeeld");
  const denials = args.slice(args.indexOf("--disallowedTools") + 1);
  for (const denied of ["WebFetch", "WebSearch", "Bash(curl:*)", "Bash(wget:*)", "Bash(nc:*)", "Bash(ssh:*)"]) assert.ok(denials.includes(denied), denied);
});

test("een eigen configuratiemap houdt de instellingen van de gebruiker buiten de run", () => {
  const home = mkdtempSync(join(tmpdir(), "lus-regie-"));
  process.env["LUS_HOME"] = home;
  assert.equal(regieEnv()["CLAUDE_CONFIG_DIR"], join(home, ".lus", "claude-home"));
  // Zonder dit stopt claude -p een subagent die nog loopt na tien minuten, en is de run half af.
  assert.equal(regieEnv()["CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS"], "21600000");
});

test("een site op deze machine herkent lus", () => {
  assert.equal(isLocalHost("http://127.0.0.1:4710/"), true);
  assert.equal(isLocalHost("http://localhost:4712/"), true);
  assert.equal(isLocalHost("http://192.168.1.5/"), true);
  assert.equal(isLocalHost("https://www.voorbeeld.nl/"), false);
  assert.equal(isLocalHost("https://notlocalhost.example/"), false);
});
