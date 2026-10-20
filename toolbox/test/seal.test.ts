import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { render } from "../src/commands/render.ts";
import { readEvaluation, sign, signatureIsCurrent, writeEvaluation } from "../src/commands/sign.ts";
import { statement } from "../src/commands/statement.ts";
import { checkSeal, seal, SIGNATURE_FILE, verify } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";
import type { Signature } from "../src/lib/evaluation.ts";
import { writeManifest } from "../src/lib/manifest.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";
import { typesSeal } from "./fixtures/terminal.ts";

const SIGNER = { name: "Een ondertekenaar", role: "Directeur", organisation: "Gemeente Voorbeeld", checkedNl: null, terminal: typesSeal() };

test("evaluate, render, seal, verify, sign, verify: signing keeps the seal, and one changed byte is seen", async () => {
  const run = mkdtempSync(join(tmpdir(), "seal-"));
  const problems = async (): Promise<string[]> => (await checkSeal(run))!.problems;
  const flip = (name: string): (() => void) => {
    const original = readFileSync(join(run, name));
    const changed = Buffer.from(original);
    changed[changed.length - 2]! ^= 1;
    writeFileSync(join(run, name), changed);
    return () => writeFileSync(join(run, name), original);
  };

  // What `evaluate` leaves in a run: the evaluation without a signature and its step in the manifest.
  // The command itself needs a run that agents judged; the evidence here is one file.
  mkdirSync(join(run, "pages", "start"), { recursive: true });
  writeFileSync(join(run, "pages", "start", "facts.json"), canonicalJson({ title: "Start" }));
  await writeEvaluation(join(run, "evaluation.json"), exampleEvaluation());
  await writeManifest(run, { command: "evaluate" });
  assert.ok(!("signature" in JSON.parse(readFileSync(join(run, "evaluation.json"), "utf8"))), "the evaluation has no place for a signature");

  const concept = await render(run);
  assert.equal(concept.markdown, join(run, "report", "rapport.md"));
  assert.ok(readFileSync(concept.markdown, "utf8").includes("Concept, niet afgetekend"));

  // Nothing is signed that was not sealed.
  assert.equal(await verify(run), false, "a run without a seal does not verify");
  await assert.rejects(sign({ run, ...SIGNER }), /niet verzegeld/);

  const sealed = await seal(run);
  assert.equal(sealed.signatureVoided, false);
  assert.equal(await verify(run), true);
  const sealedFiles = Object.keys(JSON.parse(readFileSync(join(run, "evidence-index.json"), "utf8")).files);
  assert.ok(["evaluation.json", "manifest.json", "pages/start/facts.json", "report/rapport.md"].every((name) => sealedFiles.includes(name)), sealedFiles.join(", "));

  // The signature names the seal and stands outside it: the run verifies as before.
  const before = { evaluation: readFileSync(join(run, "evaluation.json")), manifest: readFileSync(join(run, "manifest.json")) };
  const signature = await sign({ run, ...SIGNER });
  assert.equal(signature.sealSha256, sealed.sha256, "what is signed is the seal");
  assert.ok(before.evaluation.equals(readFileSync(join(run, "evaluation.json"))) && before.manifest.equals(readFileSync(join(run, "manifest.json"))), "signing writes nothing that was sealed");
  assert.equal(await verify(run), true, "the seal holds after signing");
  assert.ok(signatureIsCurrent(await readEvaluation(join(run, "evaluation.json"))));

  // The report that names the signer and the statement are made after signing, next to the sealed concept.
  const signedReport = await render(run);
  assert.equal(signedReport.markdown, join(run, "signed", "rapport.md"));
  const signedText = readFileSync(signedReport.markdown, "utf8");
  assert.match(signedText, /^> \*\*Afgetekend\*\* door Een ondertekenaar \(Directeur, Gemeente Voorbeeld\)/m);
  assert.ok(signedText.includes(`verzegeld als \`${sealed.sha256.slice(0, 12)}\``), "the signed report names the seal");
  assert.ok(readFileSync(concept.markdown, "utf8").includes("Concept, niet afgetekend"), "the concept that was read stays as it was sealed");
  if (signedReport.pdf !== null) assert.deepEqual(signedReport.pdfChecks.filter((problem) => !problem.includes("is niet geïnstalleerd")), []);
  writeFileSync(join(run, "verklaring-invoer.json"), canonicalJson({ organisation: "Gemeente Voorbeeld" }));
  await statement(run, false);
  assert.deepEqual(await problems(), [], "the signed report and the statement leave the seal whole");
  assert.equal((await seal(run)).signatureVoided, false, "sealing an unchanged run again gives the same seal");
  assert.equal(await verify(run), true);

  // One byte of the evidence, of the evaluation or of the concept report: each is seen.
  for (const name of ["pages/start/facts.json", "evaluation.json", "report/rapport.md"]) {
    const restore = flip(name);
    // A changed evaluation is also no longer the evaluation the signature names.
    assert.deepEqual(await problems(), [`gewijzigd: ${name}`, ...(name === "evaluation.json" ? [`${SIGNATURE_FILE}: de handtekening hoort bij een andere evaluatie`] : [])]);
    assert.equal(await verify(run), false, name);
    restore();
  }
  writeFileSync(join(run, "pages", "start", "extra.json"), "{}\n");
  assert.deepEqual(await problems(), ["niet in het zegel: pages/start/extra.json"]);

  // A signature for another seal is seen too.
  const written = JSON.parse(readFileSync(join(run, SIGNATURE_FILE), "utf8")) as Signature;
  writeFileSync(join(run, SIGNATURE_FILE), canonicalJson({ ...written, sealSha256: "0".repeat(64) }));
  assert.deepEqual(await problems(), ["niet in het zegel: pages/start/extra.json", `${SIGNATURE_FILE}: de handtekening hoort bij een ander zegel`]);
  writeFileSync(join(run, SIGNATURE_FILE), canonicalJson(written));

  // Signing a run that changed after the seal is refused; a new seal makes the earlier signature void.
  await assert.rejects(sign({ run, ...SIGNER }), /na het verzegelen iets veranderd \(niet in het zegel: pages\/start\/extra\.json\)/);
  const again = await seal(run);
  assert.notEqual(again.sha256, sealed.sha256);
  assert.equal(again.signatureVoided, true);
  assert.ok(!existsSync(join(run, "signed")), "the signature and the report made with it are gone");
  assert.equal((await readEvaluation(join(run, "evaluation.json"))).signature, null);
  assert.equal((await render(run)).markdown, join(run, "report", "rapport.md"), "the report is a concept again");
  assert.equal((await sign({ run, ...SIGNER })).sealSha256, again.sha256);
  assert.equal(await verify(run), true);
});
