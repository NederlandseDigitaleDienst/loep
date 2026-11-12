import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { publishToToon, siteAddress, type ToonRunner } from "../src/commands/publish-toon.ts";
import { publish, ROUNDS_FILE, type Rounds } from "../src/commands/publish.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const HOST = "https://beheer.toon.example.nl";
const LIVE = "https://toon.example.nl/team/rapporten/";

/** A directory of a site with one round, as publish leaves it. */
async function siteDir(): Promise<{ dir: string; site: { name: string; baseUrl: string } }> {
  const evaluation = exampleEvaluation();
  const run = mkdtempSync(join(tmpdir(), "toon-run-"));
  writeFileSync(join(run, "evaluation.json"), canonicalJson(evaluation));
  const result = await publish(run, mkdtempSync(join(tmpdir(), "toon-out-")));
  return { dir: dirname(result.index), site: evaluation.site };
}

/** The Toon CLI, as far as publishing goes: it says who is logged in and remembers what it was asked to publish. */
function toon(): { runner: ToonRunner; published: string[][] } {
  const published: string[][] = [];
  const runner: ToonRunner = async (args) => {
    if (args[0] === "--version") return { stdout: "toon-cli 2026.11.4\n", stderr: "" };
    if (args[0] === "whoami") return { stdout: `Logged in as someone on ${HOST} (expires soon).\n`, stderr: "" };
    published.push(args);
    return { stdout: "version-1\n", stderr: "" };
  };
  return { runner, published };
}

/** A site that answers with these files, and 404 on everything else. */
const online = (files: Record<string, string>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const body = files[String(input)];
    return body === undefined ? new Response("niet gevonden", { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof fetch;

test("where a site is served follows from its admin address, for any instance", () => {
  assert.equal(siteAddress("https://beheer.toon.rijks.app", "nldd/rapporten"), "https://toon.rijks.app/nldd/rapporten/");
  assert.equal(siteAddress("http://beheer.toon.localhost:8080", "a/b", "p-1"), "http://toon.localhost:8080/a/b/_preview/p-1/");
  assert.throws(() => siteAddress("https://toon.elders.nl", "a/b"), /--toon-url/);
});

test("without --live it is a preview, and nothing on the live site changes", async () => {
  const { dir, site } = await siteDir();
  const { runner, published } = toon();
  const result = await publishToToon(dir, site, { site: "team/rapporten" }, runner, online({}));
  const round = (JSON.parse(readFileSync(join(dir, ROUNDS_FILE), "utf8")) as Rounds).rounds[0]!.dir;
  assert.deepEqual(published, [["publish", dir, "--host", HOST, "--site", "team/rapporten", "--preview", `loep-${round}`]]);
  assert.equal(result.url, `${LIVE}_preview/loep-${round}/`);
  assert.equal(result.live, false);
});

test("live never replaces a site with content loep did not publish", async () => {
  const { dir, site } = await siteDir();
  const { runner, published } = toon();
  await assert.rejects(publishToToon(dir, site, { site: "team/rapporten", live: true }, runner, online({ [LIVE]: "<h1>Een landingspagina</h1>" })), /niet met loep publish/);
  assert.deepEqual(published, []);
});

test("live on a site loep cannot see only when the user says what is there may go", async () => {
  const { dir, site } = await siteDir();
  const { runner, published } = toon();
  await assert.rejects(publishToToon(dir, site, { site: "team/rapporten", live: true }, runner, online({})), /--replace-unseen/);
  assert.deepEqual(published, []);
  const result = await publishToToon(dir, site, { site: "team/rapporten", live: true, replaceUnseen: true }, runner, online({}));
  assert.deepEqual(published, [["publish", dir, "--host", HOST, "--site", "team/rapporten"]]);
  assert.equal(result.url, LIVE);
});

test("rounds that are online and not here are fetched first, so the new version keeps them", async () => {
  const { dir, site } = await siteDir();
  const other = await siteDir();
  const earlier = (JSON.parse(readFileSync(join(other.dir, ROUNDS_FILE), "utf8")) as Rounds).rounds[0]!;
  const old = { ...earlier, dir: "2025-01-01" };
  const files = {
    [`${LIVE}${ROUNDS_FILE}`]: JSON.stringify({ schema: "loep/rounds/1", rounds: [old] }),
    [`${LIVE}2025-01-01/publicatie.json`]: readFileSync(join(other.dir, earlier.dir, "publicatie.json"), "utf8").replace(/"evaluatedAt": "[^"]+"/, '"evaluatedAt": "2025-01-01T10:00:00.000Z"'),
    [`${LIVE}2025-01-01/index.html`]: "<h1>Het rapport van toen</h1>",
  };
  const { runner, published } = toon();
  const result = await publishToToon(dir, site, { site: "team/rapporten", live: true }, runner, online(files));
  assert.deepEqual(result.fetched, ["2025-01-01"]);
  assert.equal(readFileSync(join(dir, "2025-01-01", "index.html"), "utf8"), "<h1>Het rapport van toen</h1>");
  const index = readFileSync(join(dir, "index.html"), "utf8");
  assert.equal(index.match(/<tr><th scope="row">/g)?.length, 2);
  assert.equal((JSON.parse(readFileSync(join(dir, ROUNDS_FILE), "utf8")) as Rounds).rounds.length, 2);
  assert.equal(published.length, 1);
});

test("a round online that is another evaluation than the round here with its name stops the publication", async () => {
  const { dir, site } = await siteDir();
  const mine = (JSON.parse(readFileSync(join(dir, ROUNDS_FILE), "utf8")) as Rounds).rounds[0]!;
  const files = { [`${LIVE}${ROUNDS_FILE}`]: JSON.stringify({ schema: "loep/rounds/1", rounds: [{ ...mine, evaluationSha256: "0".repeat(64) }] }) };
  const { runner, published } = toon();
  await assert.rejects(publishToToon(dir, site, { site: "team/rapporten", live: true }, runner, online(files)), /een ander onderzoek/);
  assert.deepEqual(published, []);
});
