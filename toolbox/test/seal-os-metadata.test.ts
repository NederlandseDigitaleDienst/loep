import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeal, seal } from "../src/commands/verify.ts";
import { canonicalJson } from "../src/lib/canonical.ts";

// The first bytes of a .DS_Store from a real run, and of an AppleDouble file that ditto wrote.
const DS_STORE = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.from("Bud1"), Buffer.alloc(24)]);
const APPLE_DOUBLE = Buffer.concat([Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]), Buffer.from("Mac OS X        "), Buffer.alloc(8)]);

function run(): string {
  const dir = mkdtempSync(join(tmpdir(), "seal-os-"));
  mkdirSync(join(dir, "pages", "start"), { recursive: true });
  mkdirSync(join(dir, "antwoorden"), { recursive: true });
  writeFileSync(join(dir, "pages", "start", "facts.json"), canonicalJson({ title: "Start" }));
  writeFileSync(join(dir, "evaluation.json"), canonicalJson({ defects: [] }));
  return dir;
}

test("what Finder writes into a sealed run leaves the seal whole and is named, and a real change is still seen", async () => {
  const dir = run();
  assert.equal((await seal(dir)).files, 2);
  writeFileSync(join(dir, ".DS_Store"), DS_STORE);
  writeFileSync(join(dir, "pages", "start", ".DS_Store"), DS_STORE);
  const check = (await checkSeal(dir))!;
  assert.deepEqual(check.problems, []);
  assert.equal(check.files, 2);
  assert.deepEqual(check.osMetadata, [".DS_Store", "pages/start/.DS_Store"]);
  assert.deepEqual(check.outside, []);

  writeFileSync(join(dir, "pages", "start", "facts.json"), canonicalJson({ title: "Anders" }));
  assert.deepEqual((await checkSeal(dir))!.problems, ["gewijzigd: pages/start/facts.json"]);
});

test("a .DS_Store without Finder's header and any ._ file, AppleDouble or not, are evidence like any other", async () => {
  const dir = run();
  await seal(dir);
  writeFileSync(join(dir, "antwoorden", "._1.3.2.json"), canonicalJson({ answers: [] }));
  writeFileSync(join(dir, "pages", "start", "._facts.json"), APPLE_DOUBLE);
  writeFileSync(join(dir, "pages", ".DS_Store"), "geen Finder");
  writeFileSync(join(dir, "pages", "start", ".DS_Store"), DS_STORE.subarray(0, 6));
  const check = (await checkSeal(dir))!;
  assert.deepEqual(check.problems, ["niet in het zegel: antwoorden/._1.3.2.json", "niet in het zegel: pages/.DS_Store", "niet in het zegel: pages/start/.DS_Store", "niet in het zegel: pages/start/._facts.json"]);
  assert.deepEqual(check.osMetadata, []);

  // Sealed with them, they are in the seal; with Finder's .DS_Store next to them, only that one stays out.
  writeFileSync(join(dir, ".DS_Store"), DS_STORE);
  await seal(dir);
  const sealed = Object.keys((JSON.parse(readFileSync(join(dir, "evidence-index.json"), "utf8")) as { files: Record<string, string> }).files).sort();
  assert.deepEqual(sealed, ["antwoorden/._1.3.2.json", "evaluation.json", "pages/.DS_Store", "pages/start/.DS_Store", "pages/start/._facts.json", "pages/start/facts.json"]);
});

test("a seal that names an OS metadata file keeps checking it", async () => {
  const dir = run();
  writeFileSync(join(dir, ".DS_Store"), DS_STORE);
  await seal(dir);
  const index = JSON.parse(readFileSync(join(dir, "evidence-index.json"), "utf8")) as { files: Record<string, string> };
  // A seal from before OS metadata was left out, which hashed the .DS_Store.
  writeFileSync(join(dir, "evidence-index.json"), canonicalJson({ files: { ...index.files, ".DS_Store": "0".repeat(64) } }));
  const check = (await checkSeal(dir))!;
  assert.deepEqual(check.problems, ["gewijzigd: .DS_Store"]);
  assert.equal(check.files, 3);
  assert.deepEqual(check.osMetadata, []);
});
