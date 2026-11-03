import assert from "node:assert/strict";
import { test } from "node:test";
import { fittingNumber, fittingTestValue, satisfiesText, type FieldConstraints } from "../src/lib/fitting-value.ts";
import { TEST_VALUES } from "../src/session/safety.ts";

const field = (constraints: Partial<FieldConstraints>): FieldConstraints => ({ type: "text", min: null, max: null, step: null, minLength: null, maxLength: null, pattern: null, ...constraints });

test("a number that fits stays the fixed value", () => {
  assert.equal(fittingNumber(12, field({ type: "number" })), 12);
  assert.equal(fittingNumber(12, field({ type: "number", min: "1", max: "99" })), 12);
  assert.equal(fittingNumber(12, field({ type: "range" })), 12);
  assert.equal(fittingNumber(12, field({ type: "number", step: "any", min: "0.5" })), 12);
});

test("below the minimum, the smallest value on the step grid at or above min", () => {
  // The amount that went wrong: 100 to 1,000,000.
  assert.equal(fittingNumber(12, field({ type: "number", min: "100", max: "1000000" })), 100);
  assert.equal(fittingNumber(12, field({ type: "number", min: "100", max: "1000000", step: "50" })), 100);
  // The grid starts at min.
  assert.equal(fittingNumber(12, field({ type: "number", min: "13", step: "5" })), 13);
  assert.equal(fittingNumber(12, field({ type: "number", min: "0", step: "5" })), 15);
  assert.equal(fittingNumber(12, field({ type: "number", min: "0", step: "0.25", max: "11.9" })), 11.75);
  assert.equal(fittingNumber(12, field({ type: "number", min: "0.1", step: "0.2" })), 12.1);
  assert.equal(fittingNumber(12, field({ type: "range", min: "20", max: "40", step: "7" })), 20);
});

test("above the maximum, the largest value on the grid at or below max", () => {
  assert.equal(fittingNumber(12, field({ type: "number", max: "10" })), 10);
  assert.equal(fittingNumber(12, field({ type: "number", min: "1", max: "10", step: "4" })), 9);
  assert.equal(fittingNumber(12, field({ type: "range", min: "-10", max: "-2", step: "3" })), -4);
});

test("no number fits: null, and the fixed value stays", () => {
  assert.equal(fittingNumber(12, field({ type: "number", min: "10", max: "5" })), null);
  // With min at or below max there is always one: min itself is on the grid.
  assert.equal(fittingNumber(12, field({ type: "number", min: "1", max: "2", step: "5" })), 1);
  assert.equal(fittingTestValue("number", TEST_VALUES, field({ type: "number", min: "10", max: "5" })), "12");
});

test("the fitted value is the same every time", () => {
  const bounded = field({ type: "number", min: "100", max: "1000000", step: "50" });
  assert.deepEqual([1, 2, 3].map(() => fittingTestValue("number", TEST_VALUES, bounded)), ["100", "100", "100"]);
});

test("a text field that asks for a number follows its min, max and step too", () => {
  assert.equal(fittingTestValue("number", TEST_VALUES, field({ min: "100" })), "100");
  // A pattern the fitted number does not satisfy: the fixed value stays.
  assert.equal(fittingTestValue("number", TEST_VALUES, field({ min: "100", pattern: "[0-9]{2}" })), "12");
});

test("a date out of range becomes the nearest bound", () => {
  assert.equal(fittingTestValue("date", TEST_VALUES, field({ type: "date", min: "2020-01-01" })), "2020-01-01");
  assert.equal(fittingTestValue("date", TEST_VALUES, field({ type: "date", max: "1999-12-31" })), "1999-12-31");
  assert.equal(fittingTestValue("date", TEST_VALUES, field({ type: "date", min: "1990-01-01", max: "2010-01-01" })), TEST_VALUES.date);
});

test("a text that does not fit is replaced by the first fixed value that does", () => {
  assert.equal(fittingTestValue("text", TEST_VALUES, field({})), TEST_VALUES.text);
  assert.equal(fittingTestValue("text", TEST_VALUES, field({ maxLength: 20 })), TEST_VALUES.name);
  assert.equal(fittingTestValue("text", TEST_VALUES, field({ pattern: "[0-9]{4} ?[A-Za-z]{2}" })), TEST_VALUES.postcode);
  assert.equal(fittingTestValue("name", TEST_VALUES, field({ pattern: "[0-9]+" })), TEST_VALUES.number);
  // Nothing fixed fits: the value stays, and the field shows what it does with it.
  assert.equal(fittingTestValue("text", TEST_VALUES, field({ pattern: "[A-Z]{3}" })), TEST_VALUES.text);
  // A pattern that does not compile is ignored, as the browser does.
  assert.equal(fittingTestValue("text", TEST_VALUES, field({ pattern: "(" })), TEST_VALUES.text);
});

test("kinds that are meant to be wrong go in as they are", () => {
  assert.equal(fittingTestValue("invalid-email", TEST_VALUES, field({ type: "email", pattern: ".+@.+" })), TEST_VALUES["invalid-email"]);
  assert.equal(fittingTestValue("long", TEST_VALUES, field({ maxLength: 10 })), TEST_VALUES.long);
  assert.equal(fittingTestValue("empty", TEST_VALUES, field({ minLength: 3 })), "");
  assert.equal(fittingTestValue("search", TEST_VALUES, field({ maxLength: 1 })), TEST_VALUES.search);
});

test("length counts characters, and an empty text is left to required", () => {
  assert.equal(satisfiesText("één", field({ maxLength: 3 })), true);
  assert.equal(satisfiesText("ab", field({ minLength: 3 })), false);
  assert.equal(satisfiesText("", field({ minLength: 3, pattern: "x" })), true);
});
