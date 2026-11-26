import assert from "node:assert/strict";
import { test } from "node:test";
import { sameVersion } from "../src/version.ts";

const base = { plugin: "0.38.0", describe: "v0.38.0-4-gabc1234", sha: "abc1234", changes: "" };

test("een tag op dezelfde commit is dezelfde versie, andere wijzigingen op die commit niet", () => {
  assert.equal(sameVersion(base, { ...base, describe: "v0.39.0" }), true);
  assert.equal(sameVersion(base, { ...base, sha: "def5678" }), false);
  const dirty = { ...base, describe: "v0.38.0-4-gabc1234-dirty", changes: "111111111111" };
  assert.equal(sameVersion(dirty, { ...dirty, changes: "222222222222" }), false);
  assert.equal(sameVersion(dirty, { ...dirty }), true);
  // Een stand van een oudere lus kende de wijzigingen niet: een -dirty van toen is niet na te gaan.
  const { changes: _, ...older } = dirty;
  assert.equal(sameVersion(older, dirty), false);
  const { changes: __, ...olderClean } = base;
  assert.equal(sameVersion(olderClean, base), true);
});
