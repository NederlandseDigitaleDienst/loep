import type { Ran } from "../instruments/methods/registry.ts";
import type { Outcome } from "./commands.ts";

/** A command that returned before all its methods had answered, and how to finish it once they have. */
interface Waiting {
  /** Id of the observation the command wrote. */
  origin: string;
  command: string;
  keys: string[];
  complete: (answers: Ran<unknown>[]) => Outcome;
}

interface Running {
  id: string;
  promise: Promise<void>;
}

/**
 * The slow methods of one session: a second browser, Java, text recognition. Each runs as a
 * background job, so a command returns with what the fast methods found. An answer is kept
 * under a key that holds the state of the page and the version of the tool, so asking again costs nothing.
 */
export class Jobs {
  private readonly finished = new Map<string, Ran<unknown>>();
  private readonly running = new Map<string, Running>();
  private waiting: Waiting[] = [];

  get(key: string): Ran<unknown> | undefined {
    return this.finished.get(key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  /** Start a job unless it has run or is running. The work must not throw; it reports failure in what it returns. */
  start(key: string, id: string, work: () => Promise<Ran<unknown>>): void {
    if (this.finished.has(key) || this.running.has(key)) return;
    const promise = work()
      .then(
        (ran) => void this.finished.set(key, ran),
        // A job that throws anyway is not kept, so the next call tries again.
        () => undefined,
      )
      .finally(() => this.running.delete(key));
    this.running.set(key, { id, promise });
  }

  /** Wait until the given jobs are done, or until the time is up. Returns whether all of them are done. */
  async settle(keys: string[], limitMs: number): Promise<boolean> {
    const promises = keys.map((key) => this.running.get(key)?.promise).filter((promise): promise is Promise<void> => promise !== undefined);
    if (promises.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([Promise.all(promises), new Promise((resolve) => (timer = setTimeout(resolve, limitMs)))]);
      clearTimeout(timer);
    }
    return keys.every((key) => !this.running.has(key));
  }

  /** Remember a command whose background methods are still running, so `wait` can finish it. */
  defer(waiting: Waiting): void {
    this.waiting.push(waiting);
  }

  get pending(): { running: string[]; commands: string[] } {
    return { running: [...this.running.values()].map((job) => job.id), commands: this.waiting.map((entry) => entry.origin) };
  }

  /**
   * Wait for everything that runs, at most this long, and finish every command whose methods
   * have all answered. A job that never produced an answer counts as answered: its command is
   * finished without it, and the next call starts the job again.
   */
  async drain(limitMs: number): Promise<{ completed: { origin: string; command: string; outcome: Outcome }[]; stillRunning: string[] }> {
    await this.settle([...this.running.keys()], limitMs);
    const completed: { origin: string; command: string; outcome: Outcome }[] = [];
    const left: Waiting[] = [];
    for (const entry of this.waiting) {
      if (entry.keys.some((key) => this.running.has(key))) {
        left.push(entry);
        continue;
      }
      const answers = entry.keys.map((key) => this.finished.get(key)).filter((ran): ran is Ran<unknown> => ran !== undefined);
      completed.push({ origin: entry.origin, command: entry.command, outcome: entry.complete(answers) });
    }
    this.waiting = left;
    return { completed, stillRunning: [...this.running.values()].map((job) => job.id) };
  }

  /** Let what is running finish; used when a session stops. */
  async idle(limitMs: number): Promise<void> {
    await this.settle([...this.running.keys()], limitMs);
  }
}
