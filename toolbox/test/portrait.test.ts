import assert from "node:assert/strict";
import { test } from "node:test";
import { PORTRAIT, portraitFor } from "../src/commands/modelsweep.ts";

test("the portrait window is wide enough for a component that only stands from a given width", () => {
  assert.deepEqual(portraitFor(null), PORTRAIT);
  assert.deepEqual(portraitFor({ maxWidth: 996 }), PORTRAIT);
  assert.deepEqual(portraitFor({ minWidth: 640 }), PORTRAIT, "a component from 640 up stands in 800");
  const wide = portraitFor({ minWidth: 997 });
  assert.equal(wide.width, 997);
  assert.ok(wide.height > wide.width, "the window stays portrait");
});
