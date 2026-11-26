import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handout, handoutName, handoutSite } from "../src/commands/handout.ts";

const evaluation = (baseUrl: string) => ({ site: { baseUrl, name: "Voorbeeld" }, evaluatedAt: "2026-11-15T10:20:30.000Z" }) as never;

test("the name of a report outside its run says what it is, which site, which day, and that it is a concept", () => {
  assert.equal(handoutName("rapport.pdf", evaluation("https://www.example.nl/"), false), "rapport-example.nl-2026-11-15-concept.pdf");
  assert.equal(handoutName("rapport-kort.pdf", evaluation("https://www.example.nl/"), true), "rapport-kort-example.nl-2026-11-15.pdf");
  assert.equal(handoutName("rapport.html", evaluation("https://apps.example.nl/Mijn Loket/v2/"), true), "rapport-apps.example.nl-mijn-loket-v2-2026-11-15.html");
  // A site on this machine has a port: no colon in a file name.
  assert.equal(handoutSite("http://localhost:4710/"), "localhost-4710");
  // A site that is known by a name of its own says that name instead of the host of its url.
  assert.equal(handoutName("rapport.pdf", evaluation("http://127.0.0.1:4710/"), false, "lindewaard"), "rapport-lindewaard-2026-11-15-concept.pdf");
  assert.equal(handoutSite("https://WWW.Example.NL"), "example.nl");
});

test("handout copies the report that is there to a folder outside the run and leaves the run as it was", async () => {
  const folder = mkdtempSync(join(tmpdir(), "loep-handout-"));
  try {
    const run = join(folder, "run");
    mkdirSync(join(run, "report"), { recursive: true });
    writeFileSync(join(run, "evaluation.json"), JSON.stringify({ site: { baseUrl: "https://www.example.nl/", name: "Voorbeeld" }, evaluatedAt: "2026-11-15T10:20:30.000Z", criteria: [] }));
    writeFileSync(join(run, "report", "rapport.pdf"), "pdf");
    writeFileSync(join(run, "report", "rapport.html"), "<html>");
    const before = readdirSync(run, { recursive: true }).sort();

    const out = join(folder, "uit");
    const result = await handout(run, out);
    assert.equal(result.signed, false);
    assert.deepEqual(readdirSync(out).sort(), ["rapport-example.nl-2026-11-15-concept.html", "rapport-example.nl-2026-11-15-concept.pdf"]);
    assert.deepEqual(result.written.map((file) => file.slice(out.length + 1)).sort(), readdirSync(out).sort());
    assert.equal(readFileSync(join(out, "rapport-example.nl-2026-11-15-concept.pdf"), "utf8"), "pdf");
    assert.deepEqual(result.missing, ["rapport-kort.pdf"]);

    const named = join(folder, "met-naam");
    await handout(run, named, "lindewaard");
    assert.deepEqual(readdirSync(named).sort(), ["rapport-lindewaard-2026-11-15-concept.html", "rapport-lindewaard-2026-11-15-concept.pdf"]);
    assert.deepEqual(readdirSync(run, { recursive: true }).sort(), before);

    // Not into the run: what comes after the seal counts as a deviation there.
    await assert.rejects(handout(run, join(run, "report", "kopie")), /handout schrijft buiten de run/);
    // Without a report there is nothing to hand out.
    rmSync(join(run, "report"), { recursive: true });
    await assert.rejects(handout(run, out), /er staat geen rapport in .*: draai eerst render/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("handout refuses a --name that would put the report outside --out", () => {
  const folder = mkdtempSync(join(tmpdir(), "handout-name-"));
  const cli = join(import.meta.dirname, "..", "src", "cli.ts");
  const result = spawnSync("node", [cli, "handout", "--run", folder, "--out", join(folder, "uit"), "--name", "../elders"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /zonder schuine streep/);
  rmSync(folder, { recursive: true, force: true });
});
