import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fixedReadFor, fixedReadProblems, fixedReads, fixedReadsUsed, loadFixedReads, readsAllowedNl } from "../src/lib/reads.ts";

type Case = { rule: string; method: string; url: string; headers?: Record<string, string>; passes: boolean };
const corpus = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/fixed-reads-corpus.json", import.meta.url)), "utf8")) as { cases: Case[] }).cases;

test("every case of the corpus gets the decision it states, from the rules as loep ships them", () => {
  for (const entry of corpus) {
    const rule = fixedReadFor(entry.method, entry.url, entry.headers ?? {});
    assert.equal(rule?.id ?? null, entry.passes ? entry.rule : null, `${entry.method} ${entry.url}`);
  }
});

test("every fixed rule has a case that passes and one that does not", () => {
  for (const rule of fixedReads()) {
    assert.ok(corpus.some((entry) => entry.rule === rule.id && entry.passes), `${rule.id} has no case that passes`);
    assert.ok(corpus.some((entry) => entry.rule === rule.id && !entry.passes), `${rule.id} has no case that does not pass`);
  }
  for (const entry of corpus) assert.ok(fixedReads().some((rule) => rule.id === entry.rule), `the corpus names a rule that does not exist: ${entry.rule}`);
});

test("a fixed rule names one exact https origin and one exact path, without a word that points at writing", () => {
  const rule = { id: "speler", method: "POST", origin: "https://speler.example.nl", path: "/api/player", reasonNl: "De speler vraagt hiermee op wat hij gaat afspelen." };
  assert.deepEqual(fixedReadProblems(rule, "regel"), []);
  assert.match(fixedReadProblems({ ...rule, path: "/api/*/player" }, "regel").join(" "), /zonder jokerteken/);
  assert.match(fixedReadProblems({ ...rule, path: "/api/log_event" }, "regel").join(" "), /"log"/);
  assert.match(fixedReadProblems({ ...rule, origin: "http://speler.example.nl" }, "regel").join(" "), /https/);
  assert.match(fixedReadProblems({ ...rule, origin: "https://speler.example.nl/api" }, "regel").join(" "), /origin is precies/);
  assert.match(fixedReadProblems({ ...rule, method: "PUT" }, "regel").join(" "), /POST/);
  assert.match(fixedReadProblems({ ...rule, service: "algolia" }, "regel").join(" "), /geen veld "service"/);
  assert.match(fixedReadProblems({ ...rule, reasonNl: "leest" }, "regel").join(" "), /te kort/);
  assert.deepEqual(fixedReadProblems({ ...rule, query: { cat: "Summary" } }, "regel"), []);
  for (const query of [{}, { cat: "" }, { cat: 1 }, "cat=Summary"]) assert.match(fixedReadProblems({ ...rule, query }, "regel").join(" "), /query noemt/, JSON.stringify(query));
  // A file with a rule that does not pass its checks stops loep: it never lets a request through.
  const dir = mkdtempSync(join(tmpdir(), "loep-fixed-reads-"));
  try {
    const path = join(dir, "fixed-reads.json");
    writeFileSync(path, JSON.stringify({ rules: [{ ...rule, path: "/api/update" }] }));
    assert.throws(() => loadFixedReads(path), /"update"/);
    writeFileSync(path, JSON.stringify({ rules: [rule, rule] }));
    assert.throws(() => loadFixedReads(path), /hetzelfde id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the report names the fixed rules that let a request through, apart from the rules of the site model", () => {
  const used = fixedReadsUsed([{ reads: [{ rule: "youtube-nocookie-player", fixed: true }] }, { reads: [{ rule: "zoek" }] }, {}]);
  assert.deepEqual(used.map((rule) => rule.id), ["youtube-nocookie-player"]);
  const said = readsAllowedNl([{ method: "POST", origin: "https://zoek.example.nl", path: "/multi_search", service: "typesense", reasonNl: "Een zoekvraag aan de zoekdienst van de site." }, ...used.map((rule) => ({ ...rule, fixed: true as const }))])!;
  assert.match(said, /^één adres is toegelaten voor leesverzoeken: POST https:\/\/zoek\.example\.nl\/multi_search, zoekvraag aan Typesense/);
  assert.match(said, /\. Eén vaste leesregel van loep liet verzoeken door van een ingesloten speler of venster: POST https:\/\/www\.youtube-nocookie\.com\/youtubei\/v1\/player \(De ingesloten YouTube-speler zonder cookies/);
  assert.equal(readsAllowedNl([]), null);
  const summary = fixedReads().find((rule) => rule.id === "readspeaker-simple-text")!;
  assert.match(readsAllowedNl([{ ...summary, fixed: true }])!, /POST https:\/\/wrapi-eu\.readspeaker\.com\/v1\/\?cat=Summary \(/, "a rule with a query names it");
});
