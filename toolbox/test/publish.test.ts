import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publish, siteSlug, type Publication } from "../src/commands/publish.ts";
import { readEvaluation } from "../src/commands/sign.ts";
import { SIGNATURE_FILE } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import { evaluationHash, type Evaluation } from "../src/lib/evaluation.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

const run = (evaluation: Evaluation): string => {
  const dir = mkdtempSync(join(tmpdir(), "publish-run-"));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson(evaluation));
  return dir;
};

test("the name of a site is its host and path", () => {
  assert.equal(siteSlug("https://toon.rijks.app/nldd/loep/"), "toon-rijks-app-nldd-loep");
  assert.equal(siteSlug("https://www.gemeente.nl/"), "www-gemeente-nl");
});

test("publish puts a round in a fixed place, with an index of the site, and nothing from the run but the report", async () => {
  const evaluation = exampleEvaluation();
  const dir = run(evaluation);
  // What a run holds and a publication never shows: the name of whoever declared or answered.
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ declaredBy: "Een Naam, functie" }));
  mkdirSync(join(dir, "report"));
  writeFileSync(join(dir, "report", "rapport.pdf"), "%PDF-1.7 concept");
  const out = mkdtempSync(join(tmpdir(), "publish-out-"));
  const result = await publish(dir, out);
  const site = siteSlug(evaluation.site.baseUrl);
  const date = evaluation.evaluatedAt.slice(0, 10);
  assert.equal(result.round, join(out, site, date));
  assert.deepEqual(readdirSync(result.round).sort(), ["index.html", "publicatie.json", "rapport.pdf"]);
  const publication = JSON.parse(readFileSync(join(result.round, "publicatie.json"), "utf8")) as Publication;
  assert.equal(publication.evaluationSha256, evaluationHash(await readEvaluation(join(dir, "evaluation.json"))));
  assert.equal(publication.signed, false);
  assert.ok(result.notesNl.some((note) => note.includes("concept")));
  assert.ok(!readFileSync(join(result.round, "index.html"), "utf8").includes("Een Naam"));
  const index = readFileSync(result.index, "utf8");
  assert.ok(index.includes(`href="${date}/"`) && index.includes(`href="${date}/rapport.pdf"`));
  assert.ok(index.includes("Concept, niet afgetekend"));
  assert.ok(!existsSync(join(dir, "publicatie.json")), "the run is not touched");
});

test("a signed round names the function and not the name; another evaluation on the same day gets a place of its own", async () => {
  // The hash of the evaluation as the run holds it, read back as publish reads it.
  const evaluation = await readEvaluation(join(run(exampleEvaluation()), "evaluation.json"));
  const signature = { name: "Een Ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", signedAt: "2026-10-12T09:00:00.000Z", statementNl: "Gelezen.", evaluationSha256: evaluationHash(evaluation), sealSha256: "5ea1".repeat(16) };
  const signedRun = (): string => {
    const dir = run(evaluation);
    mkdirSync(join(dir, "signed"));
    writeFileSync(join(dir, SIGNATURE_FILE), JSON.stringify(signature));
    return dir;
  };
  const out = mkdtempSync(join(tmpdir(), "publish-out-"));
  const first = await publish(signedRun(), out);
  assert.equal(first.publication.signedBy, "Directeur (Gemeente Voorbeeld)");
  assert.equal(first.publication.sealSha256, "5ea1".repeat(16));
  for (const file of ["index.html", "publicatie.json"]) assert.ok(!readFileSync(join(first.round, file), "utf8").includes("Een Ondertekenaar"), file);
  assert.equal((await publish(signedRun(), out)).round, first.round, "the same evaluation goes back to its place");
  const other = exampleEvaluation();
  other.site.descriptionNl = "Een andere beschrijving.";
  const second = await publish(run(other), out);
  assert.equal(second.round, `${first.round}-2`);
  const index = readFileSync(second.index, "utf8");
  assert.equal(index.match(/<tr><th scope="row">/g)?.length, 2);
  assert.ok(index.includes("Afgetekend door Directeur (Gemeente Voorbeeld)"));
});
