import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFixture } from "../fixtures/serve.ts";
import { sweepVariant, sweepWrites, VARIANTS, type SweepPlan } from "../scripts/sweep-check.ts";
import { grantsOf, writesForRun } from "../src/lib/writes.ts";

// Apart from sweep-check.test.ts: inventory opens a browser, and that file runs in the quick tests without one.
test("with --allow-writes the inventory of each variant holds the permission for its site and for Kijkpunt, each with a budget of its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-sweep-check-writes-"));
  const fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(dir, "server.log") });
  try {
    const plan: SweepPlan = { pages: ["/"], steps: ["inventory"], disruptions: false, partial: false };
    for (const variant of VARIANTS) {
      const origins = { site: fixture.origins[variant], thirdParty: fixture.origins.thirdParty };
      const run = join(dir, variant);
      await sweepVariant(run, variant, origins, 1, plan, undefined, sweepWrites(origins, "80"));
      const permission = writesForRun(run);
      assert.ok(permission, `${variant}: the manifest holds the permission`);
      assert.deepEqual(
        grantsOf(permission).map((grant) => [grant.origin, grant.local, grant.maxWrites, grant.declaredBy]),
        [
          [origins.site, true, 80, null],
          [origins.thirdParty, true, 80, null],
        ],
      );
    }
    // Without the option the run may not send, as in the CI.
    const plain = join(dir, "plain");
    await sweepVariant(plain, "defect", { site: fixture.origins.defect, thirdParty: fixture.origins.thirdParty }, 1, plan);
    assert.equal(writesForRun(plain), null);
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
