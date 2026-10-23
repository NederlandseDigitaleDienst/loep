import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { confirmPost, parseMattermost, readSettings, secretStoreCommand, settingsPath, share, shareMessage, versionNl, writeSettings } from "../src/commands/share.ts";
import { sign, writeEvaluation } from "../src/commands/sign.ts";
import { checkSeal, seal } from "../src/commands/verify.ts";
import type { Evaluation } from "../src/lib/evaluation.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { noTerminal, playedTerminal, typesSeal } from "./fixtures/terminal.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "loep-share-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
// The settings of this test, and of the command line it starts, never those of whoever runs it.
process.env.XDG_CONFIG_HOME = join(scratch, "config");

const TOKEN = "geheimetoken0123456789abcd";
const COMMIT = "0000000000000000000000000000000000000000";
const fixed = { newest: "0.17.0", tagCommit: () => COMMIT };

/** The open points of the four open criteria of the example: all for the owner, so the run is finished. */
const OWNER_POINTS: Record<string, string[]> = {
  "1.4.11": ["mens nodig: of het pictogram in de zoekbalk te onderscheiden is, ziet alleen een mens."],
  "1.4.13": ["versturen niet toegestaan: wat de tooltip na versturen toont, is niet gezien."],
  "2.1.1": ["versturen niet toegestaan: het formulier is niet verstuurd.", "mens nodig: of de kaart met het toetsenbord te bedienen is."],
  "3.3.3": ["keuze nodig: welke foutmelding de organisatie wil."],
};

/** A run as evaluate, render and seal leave it: an evaluation, a report in full and in short, and a seal. */
async function makeRun(name: string, options: { points?: Record<string, string[]>; report?: boolean; sealed?: boolean; signed?: boolean } = {}): Promise<string> {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "report"), { recursive: true });
  const evaluation: Evaluation = exampleEvaluation();
  const points = options.points ?? OWNER_POINTS;
  for (const criterion of evaluation.criteria) if (criterion.id in points) criterion.missingNl = points[criterion.id]!;
  evaluation.defects = [];
  await writeEvaluation(join(dir, "evaluation.json"), evaluation);
  if (options.report !== false) {
    writeFileSync(join(dir, "report", "rapport.pdf"), "%PDF-1.7 het volledige rapport");
    writeFileSync(join(dir, "report", "rapport-kort.pdf"), "%PDF-1.7 het korte rapport");
  }
  if (options.sealed !== false) await seal(dir);
  if (options.signed) {
    await sign({ run: dir, name: "Een ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", checkedNl: null, terminal: typesSeal() });
    writeFileSync(join(dir, "signed", "rapport.pdf"), "%PDF-1.7 het afgetekende rapport");
  }
  return dir;
}

const finished = await makeRun("voorbeeld-2026-10-10");
/** What share writes: the message alone on `out` (standard output), everything else on `err` (standard error). */
async function captured(options: Parameters<typeof share>[0]): Promise<{ out: string; err: string }> {
  const written = { out: "", err: "" };
  await share({ ...options, out: (text) => void (written.out += text), say: (text) => void (written.err += text) });
  return written;
}
const unfinished = await makeRun("voorbeeld-niet-af", { points: { ...OWNER_POINTS, "2.1.1": ["proef werkte niet: de kaart reageerde niet op de pijltjestoetsen."] } });

test("share writes a fixed message from the run: version, outcome over WCAG 2.2, status, why criteria are open, seal and a disclaimer", async () => {
  const message = await shareMessage({ run: finished, ...fixed });
  const summary = exampleEvaluation().summary["2.2"];
  const text = message.markdown;
  assert.equal(message.unfinished, false);
  assert.match(text, /^#### Voorbeeldgemeente\n/);
  assert.ok(text.includes(`- **Uitkomst (${summary.total} criteria, WCAG 2.2):** ${summary.failed} voldoen niet, ${summary.passed} voldoen, ${summary.inapplicable} niet van toepassing, 4 open; 0 gebreken`), text);
  assert.match(text, /- \*\*Datum en versie:\*\* 10 oktober 2026, loep 0\.0\.1, de uitgebrachte versie \(commit `000000000000`\)/);
  assert.match(text, /- \*\*Status:\*\* voorlopig C \(eerste maatregelen genomen\); de status telt pas als iemand het rapport tekent/);
  assert.match(text, /- \*\*Waarom open:\*\* 2 "mens nodig", 2 "versturen niet toegestaan", 1 "keuze nodig"/);
  assert.match(text, /- \*\*Zegel en handtekening:\*\* verzegeld, niet getekend/);
  assert.match(text, /loep 0\.0\.1; loep is inmiddels 0\.17\.0/);
  assert.match(text, /Het rapport is een concept: verzegeld, niet getekend/);
  assert.ok(!text.includes("niet af"), "a finished run has no warning");
  assert.ok(!text.includes("Werkstroom"), "without a usage file nothing about agents or cost");
  assert.ok(!/[–—]/.test(text), "no dashes in the text");
  // The same run gives the same message.
  assert.equal((await shareMessage({ run: finished, ...fixed })).markdown, text);
});

test("share refuses a run without a report, and a run that is not finished unless --force, which warns at the top", async () => {
  await assert.rejects(shareMessage({ run: await makeRun("zonder-rapport", { report: false }), ...fixed }), /geen rapport \(report\/rapport\.pdf\)/);
  await assert.rejects(shareMessage({ run: unfinished, ...fixed }), /het onderzoek is niet af: bij 1 criterium .*\(2\.1\.1\).*--force/);
  const forced = await shareMessage({ run: unfinished, force: true, ...fixed });
  assert.equal(forced.unfinished, true);
  const [heading, , warning] = forced.markdown.split("\n");
  assert.equal(heading, "#### Voorbeeldgemeente (niet af)");
  assert.match(warning!, /^> \*\*Let op, dit onderzoek is niet af\.\*\* 4 van de 55 criteria staan open, en bij 1 daarvan heeft dit onderzoek zelf niet vastgesteld/);
  assert.match(forced.markdown, /- \*\*Status:\*\* geen status: het onderzoek is niet af/);
  assert.match(forced.markdown, /"proef werkte niet"/);
});

test("with --usage the message counts agents, duration, tokens and a cost that is a lower bound", async () => {
  const usage = join(scratch, "verbruik.json");
  writeFileSync(
    usage,
    JSON.stringify({
      schema: "loep/verbruik/1",
      run: "voorbeeld-2026-10-10",
      model: "claude-opus-5-5",
      agents: [
        { role: "judge", criterion: "1.1.1", agent: "a1", input: 1000, cacheWrite: 1_000_000, cacheRead: 9_000_000, output: 50_000 },
        { role: "verifier", criterion: "1.1.1", agent: "a2", input: 1000, cacheWrite: 1_000_000, cacheRead: 9_000_000, output: 50_000 },
        { role: "stand", agent: "a3", model: "zonder-prijs", input: 10, cacheWrite: 10, cacheRead: 10, output: 10 },
      ],
    }),
  );
  const text = (await shareMessage({ run: finished, usage, ...fixed })).markdown;
  assert.match(text, /- \*\*Werkstroom:\*\* 3 agents; ongeveer 20 miljoen tokens, 90% uit de cache/);
  // Two rows at Opus prices: 2 x (0.004 + 5 + 1.8 + 1) dollar.
  assert.match(text, /- \*\*Kosten tegen prijzen van de API:\*\* minstens 15 dollar voor de agents in het verbruiksbestand, zonder zonder-prijs \(geen prijs\)/);
  assert.match(text, /De uitvoer is in de transcripts te laag geteld, dus het bedrag is een ondergrens\./);
  writeFileSync(join(scratch, "andere.json"), JSON.stringify({ schema: "loep/verbruik/1", run: "een-andere-run", agents: [] }));
  await assert.rejects(shareMessage({ run: finished, usage: join(scratch, "andere.json"), ...fixed }), /hoort bij run een-andere-run/);
});

test("a signed run says who signed by function, gives the status without 'voorlopig', and attaches the signed report", async () => {
  const run = await makeRun("voorbeeld-getekend", { signed: true });
  const message = await shareMessage({ run, ...fixed });
  assert.match(message.markdown, /- \*\*Zegel en handtekening:\*\* verzegeld, getekend op \d+ \w+ 2\d{3} door Directeur, Gemeente Voorbeeld/);
  assert.match(message.markdown, /- \*\*Status:\*\* C \(eerste maatregelen genomen\)\n/);
  assert.ok(!message.markdown.includes("Een ondertekenaar"), "the name of the signer stays out");
  assert.equal(message.reports.full, join(run, "signed", "rapport.pdf"));
});

/** A copy made with `variant`: the sweep of the evaluation (10 October) is of another run and version, the agent phases are the copy's own. */
async function makeVariant(name: string, options: { from?: unknown; sessions?: [string, string, string][] } = {}): Promise<string> {
  const dir = await makeRun(name);
  const toolbox = { commit: "1".repeat(40), dirty: false, lockfileSha256: "", version: "0.0.1+unreleased" };
  writeFileSync(join(dir, "variant.json"), JSON.stringify({ schema: "loep/variant/1", name: "nieuw", from: options.from === undefined ? { run: "voorbeeld-2026-10-10", toolbox, variant: null } : options.from }));
  for (const [session, startedAt, stoppedAt] of options.sessions ?? [["r-start", "2026-10-12T08:00:00.000Z", "2026-10-12T09:00:00.000Z"], ["b-111", "2026-10-13T08:00:00.000Z", "2026-10-13T09:00:00.000Z"]]) {
    mkdirSync(join(dir, "observations", session), { recursive: true });
    writeFileSync(join(dir, "observations", session, "session.json"), JSON.stringify({ startedAt, stoppedAt }));
  }
  return dir;
}

test("a variant names the sweep and the agent phases apart, each with its own date and version", async () => {
  const text = (await shareMessage({ run: await makeVariant("variant-een"), ...fixed })).markdown;
  assert.match(text, /- \*\*Datum en versie:\*\* veegronde op 10 oktober 2026: loep 0\.0\.1 met wijzigingen die toen nog niet waren uitgebracht \(commit `111111111111`\); rondgangen, oordelen en de afmaakronde op 12 en 13 oktober: loep 0\.0\.1, de uitgebrachte versie \(commit `000000000000`\)\n/);
  assert.match(text, /Dit onderzoek is beoordeeld met loep 0\.0\.1; loep is inmiddels 0\.17\.0\./);
  assert.match(text, /De veegronde is gemaakt met loep 0\.0\.1, met wijzigingen die toen nog niet waren uitgebracht\./);
  assert.ok(!text.includes("Dit onderzoek is gemaakt met"), "the judging did not make the sweep");
  assert.ok(!/[–—]/.test(text));
});

test("a variant whose agent phases ran on one day, or on more than two, or whose sweep version is unknown", async () => {
  const day = (await shareMessage({ run: await makeVariant("variant-dag", { sessions: [["r-start", "2026-10-12T08:00:00.000Z", "2026-10-12T09:00:00.000Z"]] }), ...fixed })).markdown;
  assert.match(day, /afmaakronde op 12 oktober: loep/);
  const long = (await shareMessage({ run: await makeVariant("variant-lang", { sessions: [["r-start", "2026-10-12T08:00:00.000Z", "2026-10-12T09:00:00.000Z"], ["v-111", "2026-11-02T08:00:00.000Z", "2026-11-02T09:00:00.000Z"]] }), ...fixed })).markdown;
  assert.match(long, /afmaakronde van 12 oktober tot 2 november 2026: loep/);
  const unknown = (await shareMessage({ run: await makeVariant("variant-onbekend", { from: { run: "voorbeeld-2026-10-10", toolbox: null, variant: null } }), ...fixed })).markdown;
  assert.match(unknown, /veegronde op 10 oktober 2026: een onbekende versie van loep \(variant\.json heeft die niet\); rondgangen/);
  assert.match(unknown, /De versie van loep van de veegronde is niet bekend\./);
  const none = (await shareMessage({ run: await makeVariant("variant-zonder-sessies", { sessions: [] }), ...fixed })).markdown;
  assert.match(none, /veegronde op 10 oktober 2026: .*; rondgangen, oordelen en de afmaakronde: loep 0\.0\.1, de uitgebrachte versie/);
});

test("a variant of a variant says the version of its sweep may be older than the source named", async () => {
  const from = { run: "voorbeeld-2026-10-10", toolbox: { commit: "1".repeat(40), dirty: false, lockfileSha256: "", version: "0.0.1+unreleased" }, variant: "eerder" };
  const text = (await shareMessage({ run: await makeVariant("variant-twee", { from }), ...fixed })).markdown;
  assert.match(text, /commit `111111111111`\) \(de bron was zelf een kopie, "eerder": de veegronde kan met een oudere versie zijn gemaakt\); rondgangen/);
});

test("a run that is no variant keeps one date and one version", async () => {
  const text = (await shareMessage({ run: finished, ...fixed })).markdown;
  assert.ok(!text.includes("veegronde"));
  assert.match(text, /Dit onderzoek is gemaakt met loep 0\.0\.1; loep is inmiddels/);
});

test("whether a version was released follows from its build mark, its commit and the tag", () => {
  const toolbox = (version: string, commit: string | null, dirty = false) => ({ version, commit, dirty, lockfileSha256: "" });
  assert.equal(versionNl(toolbox("0.10.0+unreleased", "ab438c74e7c95c2336b8227f2ae5d25385e3ca3f"), () => null).textNl, "loep 0.10.0 met wijzigingen die toen nog niet waren uitgebracht (commit `ab438c74e7c9`)");
  assert.equal(versionNl(toolbox("0.10.0", COMMIT), () => COMMIT).textNl, "loep 0.10.0, de uitgebrachte versie (commit `000000000000`)");
  assert.match(versionNl(toolbox("0.10.0", COMMIT), () => "1".repeat(40)).textNl, /met wijzigingen die toen nog niet waren uitgebracht/);
  assert.match(versionNl(toolbox("0.10.0", COMMIT), () => null).textNl, /niet na te gaan \(de tag v0\.10\.0 ontbreekt\)/);
  assert.match(versionNl(toolbox("0.10.0", COMMIT, true), () => COMMIT).textNl, /niet waren vastgelegd: geen uitgebrachte versie/);
  assert.equal(versionNl(toolbox("0.10.0", null), () => null).textNl, "loep 0.10.0, een uitgebrachte versie (zonder commit, zoals de plugin)");
});

test("--mattermost: the last two parts of the path are team and channel, what comes before is the server", () => {
  assert.deepEqual(parseMattermost("https://digilab.overheid.nl/chat/nldd/traject-loep"), { server: "https://digilab.overheid.nl/chat", team: "nldd", channel: "traject-loep" });
  assert.deepEqual(parseMattermost("https://chat.example.nl/team/kanaal/"), { server: "https://chat.example.nl", team: "team", channel: "kanaal" });
  assert.deepEqual(parseMattermost("http://127.0.0.1:8065/a/b"), { server: "http://127.0.0.1:8065", team: "a", channel: "b" });
  assert.throws(() => parseMattermost("http://chat.example.nl/team/kanaal"), /alleen over https/);
  assert.throws(() => parseMattermost("https://chat.example.nl/kanaal"), /het team en het kanaal/);
  assert.throws(() => parseMattermost("https://chat.example.nl/Team/Traject Loep"), /de namen uit het adres/);
  assert.throws(() => parseMattermost("https://iemand:wachtwoord@chat.example.nl/team/kanaal"), /zonder gebruiker, wachtwoord/);
});

test("posting asks a person: no terminal and no confirmation refuses, and the conversation needs the literal words", async () => {
  await assert.rejects(confirmPost({}, "bericht", "kanaal", noTerminal), /geen interactieve terminal/);
  await assert.rejects(confirmPost({ recordedVia: "gesprek" }, "bericht", "kanaal", noTerminal), /letterlijk zei \(--confirmation/);
  await assert.rejects(confirmPost({ confirmation: "ja" }, "bericht", "kanaal", noTerminal), /hoort bij --recorded-via gesprek/);
  assert.equal(await confirmPost({ recordedVia: "gesprek", confirmation: "  ja, plaats  het maar " }, "bericht", "kanaal", noTerminal), 'bevestigd in het gesprek: "ja, plaats het maar"');
  const person = playedTerminal(() => "kanaal");
  assert.equal(await confirmPost({}, "het bericht", "kanaal", person), "bevestigd in een terminal");
  assert.match(person.asked[0]!, /het bericht\nTyp ter bevestiging de naam van het kanaal \(kanaal\): $/);
  await assert.rejects(confirmPost({}, "bericht", "kanaal", playedTerminal(() => "ja")), /niet bevestigd/);
});

/** A Mattermost under /chat on this machine that keeps every request. */
async function fakeMattermost(answer: (request: IncomingMessage) => { status: number; body: unknown } | null = () => null) {
  const requests: { method: string; url: string; authorization: string | undefined; contentType: string | undefined; body: Buffer }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    requests.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization, contentType: request.headers["content-type"], body: Buffer.concat(chunks) });
    const own = answer(request);
    const reply = own ?? (request.url === "/chat/api/v4/teams/name/nldd/channels/name/traject-loep" ? { status: 200, body: { id: "kanaal123" } } : request.url === "/chat/api/v4/files" ? { status: 201, body: { file_infos: [{ id: "bestand456" }], client_ids: [] } } : request.url === "/chat/api/v4/posts" ? { status: 201, body: { id: "bericht789" } } : { status: 404, body: { message: "niet gevonden" } });
    response.writeHead(reply.status, { "Content-Type": "application/json" }).end(JSON.stringify(reply.body));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat/nldd/traject-loep`;
  return { requests, url, close: () => new Promise<void>((done) => server.close(() => done())) };
}

test("share --send posts on a fake Mattermost: the channel, the report as rapport-<run>.pdf, the post with its id, and the token only in the header", async () => {
  const server = await fakeMattermost();
  const services: string[] = [];
  try {
    const { out, err } = await captured({ run: finished, ...fixed, mattermost: server.url, send: true, recordedVia: "gesprek", confirmation: "ja, plaats het", terminal: noTerminal, readSecret: async (service) => (services.push(service), TOKEN) });
    assert.deepEqual(services, ["loep-mattermost"]);
    assert.deepEqual(server.requests.map((request) => `${request.method} ${request.url}`), ["GET /chat/api/v4/teams/name/nldd/channels/name/traject-loep", "POST /chat/api/v4/files", "POST /chat/api/v4/posts"]);
    for (const request of server.requests) assert.equal(request.authorization, `Bearer ${TOKEN}`);
    const upload = server.requests[1]!;
    assert.match(upload.contentType!, /^multipart\/form-data; boundary=/);
    const form = upload.body.toString("utf8");
    assert.match(form, /name="channel_id"\r\n\r\nkanaal123\r\n/);
    assert.match(form, /name="files"; filename="rapport-voorbeeld-2026-10-10\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.7 het volledige rapport\r\n/);
    const post = JSON.parse(server.requests[2]!.body.toString("utf8")) as { channel_id: string; message: string; file_ids: string[] };
    assert.equal(post.channel_id, "kanaal123");
    assert.deepEqual(post.file_ids, ["bestand456"]);
    assert.equal(post.message, (await shareMessage({ run: finished, ...fixed })).markdown);
    assert.equal(out, post.message, "standard output is the message and nothing else");
    assert.match(err, /^Kanaal: nldd\/traject-loep /);
    assert.ok(err.endsWith(`geplaatst in nldd/traject-loep, met rapport-voorbeeld-2026-10-10.pdf; bevestigd in het gesprek: "ja, plaats het"\n${server.url.replace("/traject-loep", "")}/pl/bericht789\n`), err);
    for (const text of [out, err, post.message, form, ...process.argv]) assert.ok(!text.includes(TOKEN), "the token is in no output, no message and no argument");
    // Nothing of the post is written in the run: the seal still holds.
    assert.deepEqual((await checkSeal(finished))!.problems, []);
  } finally {
    await server.close();
  }
});

test("share --send with --attach short or none, and an error of the server shows no token", async () => {
  const server = await fakeMattermost((request) => (request.url === "/chat/api/v4/posts" ? { status: 403, body: { message: `token ${TOKEN} heeft geen rechten` } } : null));
  try {
    const send = (attach: string) => share({ run: finished, ...fixed, mattermost: server.url, send: true, attach, recordedVia: "gesprek", confirmation: "ja", readSecret: async () => TOKEN });
    const error: Error = await send("short").then(() => assert.fail("a refused post is an error"), (caught: Error) => caught);
    assert.match(error.message, /bericht: Mattermost antwoordde 403 \(token <token> heeft geen rechten\); de token mag dit niet/);
    assert.ok(!error.message.includes(TOKEN));
    assert.match(server.requests[1]!.body.toString("utf8"), /filename="rapport-kort-voorbeeld-2026-10-10\.pdf"/);
    server.requests.length = 0;
    await send("none").catch(() => undefined);
    assert.deepEqual(server.requests.map((request) => request.url), ["/chat/api/v4/teams/name/nldd/channels/name/traject-loep", "/chat/api/v4/posts"], "without an attachment nothing is uploaded");
  } finally {
    await server.close();
  }
});

test("share --send refuses before the token is read when nobody confirmed, and says how to add a missing token", async () => {
  const server = await fakeMattermost();
  let read = 0;
  const readSecret = async (): Promise<string | null> => (read++, TOKEN);
  try {
    await assert.rejects(share({ run: finished, ...fixed, mattermost: server.url, send: true, terminal: noTerminal, readSecret }), /geen interactieve terminal/);
    await assert.rejects(share({ run: finished, ...fixed, mattermost: server.url, send: true, recordedVia: "gesprek", terminal: noTerminal, readSecret }), /--confirmation/);
    assert.equal(read, 0, "no confirmation, no token");
    await assert.rejects(share({ run: finished, ...fixed, mattermost: server.url, send: true, recordedVia: "gesprek", confirmation: "ja", readSecret: async () => null }), /onder dienst "loep-mattermost"\. Zet hem erin met: (security add-generic-password -s loep-mattermost -a "\$USER" -w|secret-tool store)/);
    await assert.rejects(share({ run: finished, ...fixed, mattermost: server.url, send: true, recordedVia: "gesprek", confirmation: "ja", readSecret: async () => `${TOKEN}\nX-Extra: 1` }), /tekens die niet in een header passen/);
    assert.deepEqual(server.requests, [], "nothing reached the server");
  } finally {
    await server.close();
  }
});

test("without --send and without a terminal share shows the message, the channel and the attachment, asks nothing, reads no token and posts nothing", async () => {
  const { out, err } = await captured({ run: finished, ...fixed, mattermost: "https://chat.example.nl/chat/nldd/traject-loep", keychainService: "mattermost-loep", terminal: noTerminal, readSecret: () => assert.fail("no token without a confirmation") });
  assert.equal(out, (await shareMessage({ run: finished, ...fixed })).markdown, "standard output is the message and nothing else");
  assert.match(err, /^Kanaal: nldd\/traject-loep op https:\/\/chat\.example\.nl\/chat \(uit --mattermost\)\nBijlage: .*report\/rapport\.pdf, als rapport-voorbeeld-2026-10-10\.pdf\nToken: uit de sleutelhanger, dienst mattermost-loep \(uit --keychain-service\); pas gelezen na een bevestiging\n/);
  assert.match(err, /\nEr is niets geplaatst: plaatsen gaat met --send, of in een interactieve terminal\. Het bericht:\n\n$/);
  await assert.rejects(share({ run: finished, send: true }), /horen bij een bestemming/);
  await assert.rejects(share({ run: finished, recordedVia: "gesprek", confirmation: "ja" }), /horen bij --send/);
});

test("the secret store is asked by the name of the service alone", () => {
  assert.deepEqual(secretStoreCommand("loep-mattermost", "darwin"), { command: "security", args: ["find-generic-password", "-s", "loep-mattermost", "-w"] });
  assert.deepEqual(secretStoreCommand("loep-mattermost", "linux"), { command: "secret-tool", args: ["lookup", "service", "loep-mattermost"] });
  assert.throws(() => secretStoreCommand("loep-mattermost", "win32"), /macOS \(security\) en Linux \(secret-tool\)/);
});

test("from the command line: share prints the message, and --send with piped input refuses before anything is read", async () => {
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [CLI, "share", "--run", finished]);
  assert.match(stdout, /^#### Voorbeeldgemeente\n/);
  await assert.rejects(run(process.execPath, [CLI, "share", "--run", unfinished]), (error: { stderr: string }) => /het onderzoek is niet af/.test(error.stderr));
  for (const extra of [[], ["--recorded-via", "gesprek"]]) {
    await assert.rejects(run(process.execPath, [CLI, "share", "--run", finished, "--mattermost", "http://127.0.0.1:9/nldd/traject-loep", "--send", ...extra]), (error: { stderr: string }) => /geen interactieve terminal|--confirmation/.test(error.stderr) && !error.stderr.includes("sleutelhanger onder dienst"));
  }
  assert.equal(readFileSync(join(finished, "report", "rapport.pdf"), "utf8"), "%PDF-1.7 het volledige rapport");
});

test("the destination can be a setting of the user: read from share.json, overridden by the flags, written with --set-*, and a bad value is refused", async () => {
  const file = join(scratch, "instellingen", "loep", "share.json");
  assert.equal(settingsPath({ XDG_CONFIG_HOME: join(scratch, "instellingen") }), file);
  assert.match(settingsPath({}), /\.config\/loep\/share\.json$/);
  assert.match(settingsPath({ XDG_CONFIG_HOME: "relatief" }), /\.config\/loep\/share\.json$/, "a relative XDG_CONFIG_HOME is ignored, as the spec says");
  assert.match(writeSettings(file, { mattermost: "https://chat.example.nl/chat/nldd/traject-loep/" }), /^opgeslagen in .*share\.json: mattermost https:\/\/chat\.example\.nl\/chat\/nldd\/traject-loep\. De token staat daar niet in/);
  writeSettings(file, { keychainService: "mattermost-loep" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { mattermost: "https://chat.example.nl/chat/nldd/traject-loep", keychainService: "mattermost-loep" });
  assert.throws(() => writeSettings(file, { mattermost: "http://chat.example.nl/nldd/traject-loep" }), /alleen over https/);
  assert.throws(() => writeSettings(file, { keychainService: "-w" }), /--set-keychain-service is een naam/);
  assert.equal(readSettings(file).mattermost, "https://chat.example.nl/chat/nldd/traject-loep", "a refused value changes nothing");

  const message = (await shareMessage({ run: finished, ...fixed })).markdown;
  const dry = await captured({ run: finished, ...fixed, settingsFile: file, terminal: noTerminal });
  assert.equal(dry.out, message, "with a setting standard output is still only the message");
  assert.match(dry.err, /^Kanaal: nldd\/traject-loep op https:\/\/chat\.example\.nl\/chat \(uit .*share\.json\)\n.*\nToken: uit de sleutelhanger, dienst mattermost-loep \(uit .*share\.json\)/);
  const flag = await captured({ run: finished, ...fixed, settingsFile: file, terminal: noTerminal, mattermost: "https://andere.example.nl/team/kanaal", keychainService: "eigen-dienst" });
  assert.equal(flag.out, message);
  assert.match(flag.err, /^Kanaal: team\/kanaal op https:\/\/andere\.example\.nl \(uit --mattermost\)\n.*\nToken: uit de sleutelhanger, dienst eigen-dienst \(uit --keychain-service\)/);

  writeSettings(file, { keychainService: "" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { mattermost: "https://chat.example.nl/chat/nldd/traject-loep" }, "an empty value takes the setting away");
  writeFileSync(file, JSON.stringify({ mattermost: "https://chat.example.nl/a/b", token: "x" }));
  await assert.rejects(share({ run: finished, ...fixed, settingsFile: file, terminal: noTerminal }), /onbekende instellingen \(token\).*Een token hoort daar nooit in/);
  writeFileSync(file, JSON.stringify({ mattermost: "https://chat.example.nl/alleen" }));
  await assert.rejects(share({ run: finished, ...fixed, settingsFile: file, terminal: noTerminal }), /de bestemming in .*share\.json: .*team en het kanaal.*--set-mattermost/);
});

test("from the command line --set-mattermost writes the setting under XDG_CONFIG_HOME and stands on its own", async () => {
  const run = promisify(execFile);
  const config = join(scratch, "cli-config");
  const env = { ...process.env, XDG_CONFIG_HOME: config };
  const set = await run(process.execPath, [CLI, "share", "--set-mattermost", "https://chat.example.nl/chat/nldd/traject-loep", "--set-keychain-service", "mattermost-loep"], { env });
  assert.equal(set.stdout, "");
  assert.match(set.stderr, /^opgeslagen in .*cli-config\/loep\/share\.json/);
  assert.deepEqual(JSON.parse(readFileSync(join(config, "loep", "share.json"), "utf8")), { mattermost: "https://chat.example.nl/chat/nldd/traject-loep", keychainService: "mattermost-loep" });
  await assert.rejects(run(process.execPath, [CLI, "share", "--set-mattermost", "https://chat.example.nl/a/b", "--run", finished], { env }), (error: { stderr: string }) => /zetten alleen de instelling; zonder --run/.test(error.stderr));
  // With the setting and piped input the dry run shows where the destination came from and asks nothing.
  const dry = await run(process.execPath, [CLI, "share", "--run", finished], { env });
  const plain = await run(process.execPath, [CLI, "share", "--run", finished]);
  assert.equal(dry.stdout, plain.stdout, "with and without a setting standard output is the same message");
  assert.match(dry.stdout, /^#### Voorbeeldgemeente\n/);
  assert.equal(plain.stderr, "", "without a destination nothing else is said");
  assert.match(dry.stderr, /^Kanaal: nldd\/traject-loep op https:\/\/chat\.example\.nl\/chat \(uit .*cli-config\/loep\/share\.json\)\n/);
  assert.ok(!dry.stderr.includes("Typ de naam"), "no question without an interactive terminal");
});

test("without --send at an interactive terminal share asks: Enter posts nothing, the name of the channel posts", async () => {
  const server = await fakeMattermost();
  const order: string[] = [];
  const ask = (answer: string) => {
    const terminal = playedTerminal(() => answer);
    return { run: finished, ...fixed, mattermost: server.url, terminal: { ...terminal, ask: (text: string) => (order.push("vraag"), terminal.ask(text)) }, readSecret: async () => TOKEN };
  };
  try {
    const nothing = await captured({ ...ask(""), out: undefined, say: undefined });
    assert.equal(nothing.out, (await shareMessage({ run: finished, ...fixed })).markdown, "standard output is the message, also when asked");
    assert.match(nothing.err, /^Kanaal: nldd\/traject-loep .*\n[\s\S]*Het bericht:\n\nEr is niets geplaatst\.\n$/);
    order.length = 0;
    await share({ ...ask(""), out: () => void order.push("bericht"), say: (text) => void order.push(text.startsWith("Kanaal") ? "kanaal" : "rest") });
    assert.deepEqual(order, ["kanaal", "bericht", "vraag", "rest"], "the channel and the message are shown before the question");
    await assert.rejects(share({ ...ask("ja"), out: () => undefined, say: () => undefined }), /niet bevestigd: dat is niet de naam van het kanaal/);
    assert.equal(server.requests.length, 0, "Enter or another answer posts nothing");
    const person = playedTerminal(() => "traject-loep");
    const { err } = await captured({ ...ask(""), terminal: person });
    assert.match(person.asked[0]!, /Plaatsen in nldd\/traject-loep\? Typ de naam van het kanaal om te plaatsen, of Enter om niets te doen: $/);
    assert.match(err, /\ngeplaatst in nldd\/traject-loep, met rapport-voorbeeld-2026-10-10\.pdf; bevestigd in een terminal\n.*\/chat\/nldd\/pl\/bericht789\n$/);
    assert.deepEqual(server.requests.map((request) => request.url), ["/chat/api/v4/teams/name/nldd/channels/name/traject-loep", "/chat/api/v4/files", "/chat/api/v4/posts"]);
  } finally {
    await server.close();
  }
});
