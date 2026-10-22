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

/**
 * A fixed number of browsers that pieces of work share: `run` waits until one is free and gives it
 * back when the work is done, whether it succeeded or not. Whoever asked first gets the next one, so
 * that a piece of work never waits on a later piece that took its place.
 */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(count: number) {
    if (!Number.isInteger(count) || count < 1) throw new Error(`slots: ${count} is no number of browsers`);
    this.free = count;
  }

  /** Asks for a slot at once, before anything is awaited: the order of the calls is the order in which slots are given. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

/**
 * Work that runs together, and work that runs alone. `alone` waits until the work that runs together
 * has ended, and while it waits or runs no new work starts together. A page that failed under the
 * load of the others, by not answering in time or by a crashed renderer, gets its second try with
 * the machine to itself. Work that runs alone must not ask for `together` or `alone` inside it.
 */
export class Crowd {
  private running = 0;
  private aloneRuns = false;
  private readonly waitingAlone: (() => void)[] = [];
  private readonly waitingTogether: (() => void)[] = [];

  async together<T>(work: () => Promise<T>): Promise<T> {
    // A place is counted when it is given, so that nothing can run alone between the grant and the start.
    if (this.aloneRuns || this.waitingAlone.length > 0) await new Promise<void>((resolve) => this.waitingTogether.push(resolve));
    else this.running++;
    try {
      return await work();
    } finally {
      this.running--;
      this.wake();
    }
  }

  async alone<T>(work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.waitingAlone.push(resolve);
      this.wake();
    });
    try {
      return await work();
    } finally {
      this.aloneRuns = false;
      this.wake();
    }
  }

  private wake(): void {
    if (this.aloneRuns) return;
    if (this.waitingAlone.length > 0) {
      if (this.running > 0) return;
      this.aloneRuns = true;
      this.waitingAlone.shift()!();
      return;
    }
    for (const start of this.waitingTogether.splice(0)) {
      this.running++;
      start();
    }
  }
}

/**
 * Turns in the order of the indexes, for work that runs at the same time but must decide something
 * in order. `turn(i)` resolves once every index before `i` said `done`; `done(i)` may come early,
 * for a piece of work that failed before its turn, and may come more than once.
 */
export class Turns {
  private readonly gates: Promise<void>[] = [];
  private readonly releases: (() => void)[] = [];

  constructor(count: number) {
    let before = Promise.resolve();
    for (let index = 0; index < count; index++) {
      this.gates.push(before);
      const own = new Promise<void>((resolve) => this.releases.push(resolve));
      const previous = before;
      before = previous.then(() => own);
    }
  }

  turn(index: number): Promise<void> {
    return this.gates[index]!;
  }

  done(index: number): void {
    this.releases[index]!();
  }
}
