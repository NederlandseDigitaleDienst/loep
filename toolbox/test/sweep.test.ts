import assert from "node:assert/strict";
import { test } from "node:test";
import { sweep, SWEEP_STEPS, type SweepOptions, type SweepStep } from "../src/commands/sweep.ts";

test("sweep runs the four commands of the sweep in their order, with the same options, and says what each said", async () => {
  const ran: [SweepStep, SweepOptions][] = [];
  const said: string[] = [];
  await sweep({ run: "een-run", fresh: true, atOnce: 3 }, (line) => said.push(line), async (step, options) => {
    ran.push([step, options]);
    return step === "documents" ? ["geen documenten in de steekproef"] : [];
  });
  assert.deepEqual(ran.map(([step]) => step), ["collect", "contrast", "states", "documents"]);
  assert.deepEqual(SWEEP_STEPS, ["collect", "contrast", "states", "documents"]);
  assert.ok(ran.every(([, options]) => options.run === "een-run" && options.fresh === true && options.atOnce === 3));
  assert.deepEqual(said, [
    "veegronde, stap 1 van 4: collect",
    "veegronde, stap 2 van 4: contrast",
    "veegronde, stap 3 van 4: states",
    "veegronde, stap 4 van 4: documents",
    "geen documenten in de steekproef",
    "veegronde klaar: collect, contrast, states en documents hebben gedraaid. Draai nu gate",
  ]);
});

test("a command that fails stops the sweep: the error names it, and the commands after it do not run", async () => {
  const ran: SweepStep[] = [];
  const said: string[] = [];
  const failing = sweep({ run: "een-run" }, (line) => said.push(line), async (step) => {
    ran.push(step);
    if (step === "contrast") throw new Error("de browser sloot");
    return [];
  });
  await assert.rejects(failing, /de veegronde stopte bij contrast \(stap 2 van 4\): de browser sloot\. Wat de stappen ervoor maten, blijft staan\. Draai sweep opnieuw/);
  assert.deepEqual(ran, ["collect", "contrast"]);
  // Not said to be done: whoever reads only the last line must not go on to the gate.
  assert.ok(!said.some((line) => line.startsWith("veegronde klaar")));
});

test("sweep is for the whole sample: one page is for collect alone", async () => {
  const ran: SweepStep[] = [];
  await assert.rejects(sweep({ run: "een-run", only: "/contact" }, () => undefined, async (step) => (ran.push(step), [])), /sweep meet de hele steekproef\. Voor één pagina: collect --run <run> --only/);
  assert.deepEqual(ran, []);
});
