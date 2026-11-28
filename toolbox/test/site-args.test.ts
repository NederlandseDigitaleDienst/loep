import assert from "node:assert/strict";
import { test } from "node:test";
import { positionalsOf } from "../src/lib/site-args.ts";

const VALUE_FLAGS = new Set(["run", "only", "at-once", "out", "dismiss"]);

test("het woord na een optie met een waarde is de waarde, niet een site", () => {
  // `loep audit tasks --only voorbeeld.nl` noemt een criterium en geen site: de site staat ervoor of erna.
  assert.deepEqual(positionalsOf(["tasks", "--only", "voorbeeld.nl"], VALUE_FLAGS), [{ at: 0, word: "tasks" }]);
  assert.deepEqual(positionalsOf(["tasks", "--run", "/tmp/run"], VALUE_FLAGS), [{ at: 0, word: "tasks" }]);
  assert.deepEqual(positionalsOf(["tasks", "--at-once", "3", "voorbeeld.nl"], VALUE_FLAGS), [
    { at: 0, word: "tasks" },
    { at: 3, word: "voorbeeld.nl" },
  ]);
});

test("een optie met een waarde waar een = tussen staat slaat geen woord over", () => {
  assert.deepEqual(positionalsOf(["tasks", "--run=/tmp/run", "voorbeeld.nl"], VALUE_FLAGS), [
    { at: 0, word: "tasks" },
    { at: 2, word: "voorbeeld.nl" },
  ]);
});

test("een korte optie met een waarde slaat de waarde over", () => {
  assert.deepEqual(positionalsOf(["tasks", "-o", "/tmp/run", "voorbeeld.nl"], new Set(["o"])), [
    { at: 0, word: "tasks" },
    { at: 3, word: "voorbeeld.nl" },
  ]);
});

test("na -- is elk woord een woord", () => {
  assert.deepEqual(positionalsOf(["answer", "voorbeeld.nl", "--", "-iets"], VALUE_FLAGS), [
    { at: 0, word: "answer" },
    { at: 1, word: "voorbeeld.nl" },
    { at: 3, word: "-iets" },
  ]);
});

test("een waarde die twee keer mag komen telt per keer", () => {
  assert.deepEqual(positionalsOf(["collect", "--dismiss", "#a", "--dismiss", "#b", "voorbeeld.nl"], VALUE_FLAGS), [
    { at: 0, word: "collect" },
    { at: 5, word: "voorbeeld.nl" },
  ]);
});
