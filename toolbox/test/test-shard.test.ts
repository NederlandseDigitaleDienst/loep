import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { shard } from "../scripts/test-shard.ts";

const TOOLBOX = join(import.meta.dirname, "..");

test("the parts of the tests hold every test file exactly once, also one without a measured duration", () => {
  const files = globSync("test/**/*.test.ts", { cwd: TOOLBOX }).sort();
  const durations = JSON.parse(readFileSync(join(TOOLBOX, "test", "durations.json"), "utf8")) as Record<string, number>;
  for (const total of [1, 3, 4, 5]) {
    const parts = shard([...files, "test/new.test.ts"], durations, total);
    assert.equal(parts.length, total);
    assert.deepEqual(parts.flat().sort(), [...files, "test/new.test.ts"].sort());
  }
});

test("the parts are shared out on duration: the longest file first, each next one to the part with the least time", () => {
  const durations = { "a.test.ts": 9, "b.test.ts": 5, "c.test.ts": 3, "d.test.ts": 1 };
  assert.deepEqual(shard(Object.keys(durations).reverse(), durations, 2), [["a.test.ts"], ["b.test.ts", "c.test.ts", "d.test.ts"]]);
  // Without durations every file counts the same, and the parts differ by at most one file.
  assert.deepEqual(shard(["x.test.ts", "y.test.ts", "z.test.ts"], {}, 2).map((part) => part.length).sort(), [1, 2]);
});
