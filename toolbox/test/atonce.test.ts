import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { recountRecognised, type PictureReport } from "../src/instruments/pictures.ts";
import { inOrder, sweepAtOnce } from "../src/lib/atonce.ts";
import { DEFAULT_DAEMON_LIMITS } from "../src/session/safety.ts";

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("pieces of work at the same time, committed in order", () => {
  test("results and commits come in the order of the indexes, whichever is ready first", async () => {
    const started: number[] = [];
    const committed: number[] = [];
    let running = 0;
    let most = 0;
    const results = await inOrder(
      8,
      3,
      async (index) => {
        started.push(index);
        running++;
        most = Math.max(most, running);
        // The later ones are ready first.
        await pause((8 - index) * 5);
        running--;
        return index * 10;
      },
      (index, value) => {
        assert.equal(value, index * 10);
        committed.push(index);
      },
    );
    assert.deepEqual(results, [0, 10, 20, 30, 40, 50, 60, 70]);
    assert.deepEqual(committed, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(most, 3, "never more than three at the same time");
  });

  test("one at a time is a plain loop: each commit comes before the next piece starts", async () => {
    const events: string[] = [];
    await inOrder(
      3,
      1,
      async (index) => {
        events.push(`work ${index}`);
        await pause(1);
        return index;
      },
      async (index) => {
        await pause(1);
        events.push(`commit ${index}`);
      },
    );
    assert.deepEqual(events, ["work 0", "commit 0", "work 1", "commit 1", "work 2", "commit 2"]);
  });

  test("after a failure nothing new starts, what came before is committed and the first failure is thrown", async () => {
    const started: number[] = [];
    const committed: number[] = [];
    await assert.rejects(
      inOrder(
        10,
        2,
        async (index) => {
          started.push(index);
          await pause(index === 2 ? 20 : 2);
          if (index === 3) throw new Error("drie");
          if (index === 2) throw new Error("twee");
          return index;
        },
        (index) => void committed.push(index),
      ),
      /twee/,
    );
    assert.deepEqual(committed, [0, 1], "nothing after the first failure in order is committed");
    assert.ok(Math.max(...started) < 6, `no new work after the failure (${started.join(", ")})`);
  });
});

describe("how many at once a run allows", () => {
  const runWith = (limits: Record<string, number> | null): string => {
    const run = mkdtempSync(join(tmpdir(), "loep-atonce-"));
    if (limits) {
      mkdirSync(join(run, "observations", "verken"), { recursive: true });
      writeFileSync(join(run, "observations", "verken", "session.json"), JSON.stringify({ session: "verken", startedAt: "2026-10-16T10:00:00.000Z", limits }));
    }
    return run;
  };

  test("without a session the default of the session process holds, and more is lowered with a reason", () => {
    const run = runWith(null);
    assert.deepEqual(sweepAtOnce(run), { atOnce: 1, limit: DEFAULT_DAEMON_LIMITS.maxSessions, limitSource: "default", navigationDelayMs: DEFAULT_DAEMON_LIMITS.navigationDelayMs, noteNl: null });
    const lowered = sweepAtOnce(run, 9);
    assert.equal(lowered.atOnce, DEFAULT_DAEMON_LIMITS.maxSessions);
    assert.match(lowered.noteNl!, /--at-once 9 is meer dan de 4 sessies .* --max-sessions/);
    assert.throws(() => sweepAtOnce(run, 0), /geheel aantal/);
  });

  test("with a session the limit and the time between navigations are those of its session process", () => {
    const run = runWith({ maxSessions: 8, navigationDelayMs: 1500 });
    assert.deepEqual(sweepAtOnce(run, 6), { atOnce: 6, limit: 8, limitSource: "session", navigationDelayMs: 1500, noteNl: null });
    assert.equal(sweepAtOnce(run, 12).atOnce, 8);
  });
});

test("a picture counts as read on the first page that has it, also when a later page read it first", () => {
  const read = (sha256: string): PictureReport["pictures"][number] => ({ kind: "img", tag: "img", where: "img", region: null, src: null, alt: null, ownText: "", box: { x: 0, y: 0, width: 50, height: 50 }, sha256, crop: null, ocr: { hasText: false, text: "", words: 0, confidence: 0 } });
  // Measured at the same time: the second page read "b" before the first page got to it.
  const first: PictureReport = { pictures: [read("a"), read("b")], recognised: 1 };
  const second: PictureReport = { pictures: [read("b"), read("c"), { ...read("d"), ocr: { notReadNl: "tekstherkenning gaf geen antwoord" } }], recognised: 2 };
  const seen = new Set<string>(["c"]);
  assert.deepEqual(recountRecognised([first, second], seen), [0, 1]);
  assert.deepEqual([first.recognised, second.recognised], [2, 0], "c was read on a page before; d could not be read");
  assert.deepEqual([...seen].sort(), ["a", "b", "c", "d"]);
  // In the order of one page after the other the counts were right already: nothing changes.
  assert.deepEqual(recountRecognised([{ pictures: [read("e")], recognised: 1 }], seen), []);
});
