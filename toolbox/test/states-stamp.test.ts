import assert from "node:assert/strict";
import { test } from "node:test";
import { formsSent, stampWrites, statesStampStands } from "../src/commands/states.ts";
import { decideWrites } from "../src/lib/writes.ts";

type StatesStamp = NonNullable<Parameters<typeof statesStampStands>[0]>;

test("what states found is measured again when the run may send to other origins than before", () => {
  const permission = decideWrites("http://127.0.0.1:8080/", { allowWrites: true })!;
  const withWrites = stampWrites(permission);
  assert.deepEqual(withWrites, ["http://127.0.0.1:8080"]);
  assert.deepEqual(stampWrites(null), []);
  const without: StatesStamp = { pages: "p", states: {}, writes: [] };
  // The same pages and the same permission: what was found stands.
  assert.equal(statesStampStands(without, "p", [], false), true);
  assert.equal(statesStampStands({ ...without, writes: withWrites }, "p", withWrites, true), true);
  // The run got permission to send after the form probe held its requests back: the probe runs again.
  assert.equal(statesStampStands(without, "p", withWrites, false), false);
  // And the other way round: what was really sent is no evidence for a run that may no longer send.
  assert.equal(statesStampStands({ ...without, writes: withWrites }, "p", [], true), false);
  // A stamp from before the origins were kept: what its form probe did says whether it was made with permission.
  const { writes: _left, ...older } = without;
  assert.equal(statesStampStands(older, "p", [], false), true);
  assert.equal(statesStampStands(older, "p", withWrites, false), false);
  // It really sent: a run that still may send keeps what was found, a run that may no longer send measures again.
  assert.equal(statesStampStands(older, "p", withWrites, true), true);
  assert.equal(statesStampStands(older, "p", [], true), false);
  // A changed page still makes everything stale.
  assert.equal(statesStampStands(without, "q", [], false), false);
  assert.equal(statesStampStands(null, "p", [], false), false);
});

test("an earlier form probe counts as having sent only when it tried a form with valid test values", () => {
  const attempt = (input: string) => ({ input, submitted: true, requestBlocked: false, navigated: false, invalidFields: [], newVisibleMessages: [], liveRegionMessages: [], focusAfterSubmit: null, screenshot: null });
  const form = (...inputs: string[]) => ({ page: "P1", form: "#f", openedVia: null, fields: [], submitControl: null, attempts: inputs.map(attempt) });
  assert.equal(formsSent(undefined), false);
  assert.equal(formsSent({ formErrors: [] }), false);
  assert.equal(formsSent({ formErrors: [form("leeg verstuurd", "ongeldige invoer")] }), false);
  assert.equal(formsSent({ formErrors: [form("leeg verstuurd"), form("leeg verstuurd", "geldige testwaarden")] }), true);
});
