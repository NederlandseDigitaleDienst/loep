import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFECTS } from "../fixtures/defects.ts";
import { EVIDENCE, isAgentOnly } from "../fixtures/evidence.ts";
import { baselineOf, compareWithBaseline, evaluate, SWEEP_PAGES, sweepPlan } from "../scripts/sweep-check.ts";

// Apart from sweep-check.test.ts: evaluate opens a browser, and that file runs in the quick tests without one.
test("with fewer pages measured the key is checked on those pages only, and a defect on none of them is not measured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-sweep-check-"));
  try {
    // Two empty runs: every defect on a measured page is missing, every other one is not measured.
    const only = sweepPlan("only-disruptions");
    const rows = await evaluate({ defect: join(dir, "defect"), clean: join(dir, "clean") }, only.pages);
    const byId = new Map(EVIDENCE.map((entry) => [entry.defect, entry]));
    const onMeasured = (id: string): boolean => {
      const defect = DEFECTS.find((each) => each.id === id)!;
      const entry = byId.get(id)!;
      // As in the full run: the pages of the key, not the pages of the cases.
      const pages = (!isAgentOnly(entry) && entry.pages) || (defect.pages[0] === "*" ? ["/"] : defect.pages.filter((page) => SWEEP_PAGES.includes(page)));
      return pages.some((page) => only.pages.includes(page));
    };
    for (const each of rows.filter((entry) => entry.kind === "script")) {
      if (onMeasured(each.defect)) assert.deepEqual([each.found, each.twin], [false, false], each.defect);
      else assert.deepEqual([each.found, each.twin], [null, null], each.defect);
    }
    assert.equal(rows.find((entry) => entry.defect === "4.1.2-vragenlijst")?.found, false, "the questionnaire is looked for");
    // A defect that is not measured never counts as a regression, one on a measured page does.
    const baseline = baselineOf(rows.map((entry) => ({ ...entry, found: entry.kind === "script" ? true : null })));
    const regressions = compareWithBaseline(rows, baseline).regressions;
    assert.deepEqual(regressions.map((line) => line.split(":")[0]).sort(), rows.filter((entry) => entry.found === false).map((entry) => entry.defect).sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
