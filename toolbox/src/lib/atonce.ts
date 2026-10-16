import { spaceNavigations } from "../browser/session.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness } from "../session/safety.ts";
import { sessionLimits } from "./timing.ts";

/**
 * Measuring pages of the sweep at the same time. The site gets no more than the agents may give
 * it: no more pages at once than the session process of the run allows sessions, and the same
 * time between two navigations to one host. What is measured, and the order in which it is
 * written, does not depend on how many run at once.
 */

export interface SweepAtOnce {
  /** Pages, passes or groups of probes measured at the same time. */
  atOnce: number;
  /** The most the run allows: the sessions of its session process, or the default of that process. */
  limit: number;
  limitSource: "session" | "default";
  /** Time between two navigations to the same host while more than one runs. */
  navigationDelayMs: number;
  /** Said to whoever runs the command when the number asked for was lowered. */
  noteNl: string | null;
}

/**
 * How many at once the sweep of this run may measure. Never more than the session process of the
 * run allows sessions (`session start --max-sessions`), or than it allows by default when no
 * session was started yet. The time between navigations is the one that process uses.
 */
export function sweepAtOnce(runDir: string, asked = 1): SweepAtOnce {
  if (!Number.isInteger(asked) || asked < 1) throw new Error("--at-once is een geheel aantal pagina's, 1 of meer");
  const limits = sessionLimits(runDir);
  const limit = limits?.maxSessions ?? DEFAULT_DAEMON_LIMITS.maxSessions;
  const atOnce = Math.min(asked, limit);
  const noteNl =
    asked > limit
      ? `--at-once ${asked} is meer dan de ${limit} sessies die ${limits ? "het sessieproces van deze run" : "het sessieproces zonder --max-sessions"} toelaat: de veegronde meet er ${limit} tegelijk. Meer kan alleen als de eigenaar van de site het toestaat; start het sessieproces dan met session start --max-sessions <aantal>`
      : null;
  return { atOnce, limit, limitSource: limits ? "session" : "default", navigationDelayMs: limits?.navigationDelayMs ?? DEFAULT_DAEMON_LIMITS.navigationDelayMs, noteNl };
}

/**
 * Run `work` with the navigations spaced as the sessions space them, when more than one runs at
 * once. With one at a time nothing changes: the pages follow each other as they always did.
 */
export async function withSpacing<T>(settings: Pick<SweepAtOnce, "atOnce" | "navigationDelayMs">, work: () => Promise<T>): Promise<T> {
  if (settings.atOnce <= 1) return work();
  spaceNavigations(new Politeness(settings.navigationDelayMs));
  try {
    return await work();
  } finally {
    spaceNavigations(null);
  }
}

/**
 * Do `work` for every index from 0 to `count`, at most `atOnce` at the same time, and hand each
 * result to `commit` in the order of the indexes: the result of 3 is committed after that of 2,
 * whichever was ready first. With one at a time this is a plain loop, the commit included.
 *
 * When a piece of work fails, no new piece is started; the ones running are finished, the results
 * before the first failure are committed and that failure is thrown, as a loop would have stopped there.
 */
export async function inOrder<T>(count: number, atOnce: number, work: (index: number) => Promise<T>, commit: (index: number, value: T) => Promise<void> | void = () => undefined): Promise<T[]> {
  const settled: ({ ok: true; value: T } | { ok: false; error: unknown } | undefined)[] = new Array(count).fill(undefined);
  let next = 0;
  let committed = 0;
  let stopped = false;
  let failure: { error: unknown } | null = null;
  let committing = Promise.resolve();
  const flush = async (): Promise<void> => {
    while (committed < count && !failure) {
      const done = settled[committed];
      if (!done) return;
      if (!done.ok) {
        failure = { error: done.error };
        return;
      }
      const index = committed++;
      try {
        await commit(index, done.value);
      } catch (error) {
        failure = { error };
        stopped = true;
      }
    }
  };
  const lane = async (): Promise<void> => {
    while (!stopped && next < count) {
      const index = next++;
      try {
        settled[index] = { ok: true, value: await work(index) };
      } catch (error) {
        settled[index] = { ok: false, error };
        stopped = true;
      }
      committing = committing.then(flush);
      // The next piece starts after what is ready has been committed: with one at a time, exactly the loop.
      await committing;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, count)) }, lane));
  await committing;
  if (failure) throw (failure as { error: unknown }).error;
  return settled.map((entry) => (entry as { value: T }).value);
}
