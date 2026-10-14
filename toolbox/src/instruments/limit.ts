export type Limited<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Run one step with a time limit. A page that never settles must not stall whoever
 * asked; the step is reported as not done instead. The work itself is not interrupted:
 * the caller has to discard the page it was running on.
 */
export async function withinTime<T>(limitMs: number, work: () => Promise<T>): Promise<Limited<T>> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), limitMs);
  });
  try {
    const outcome = await Promise.race([work().then((value) => ({ value }), (error: Error) => ({ failed: (error.message ?? String(error)).split("\n")[0]! })), limit]);
    if (outcome === "timeout") return { ok: false, reason: `geen antwoord binnen ${limitMs / 1000} seconden` };
    if ("failed" in outcome) return { ok: false, reason: outcome.failed };
    return { ok: true, value: outcome.value };
  } finally {
    clearTimeout(timer);
  }
}

/** A step that is silent for longer than this says that it still runs. */
export const STILL_RUNNING_MS = 30_000;

/** One line of progress on stderr: which command, which probe, how many of how many, and what it is about. */
export function progressLine(command: string, probe: string | null, index: number, total: number, what: string): string {
  return `${command}${probe ? ` ${probe}` : ""} ${index + 1}/${total} ${what}\n`;
}

/**
 * Run a step and say every half minute that it still runs, so that a long step does not look
 * like a command that hangs. A step that is done sooner writes nothing here.
 */
export async function sayingItRuns<T>(what: string, work: () => Promise<T>, everyMs = STILL_RUNNING_MS, write: (line: string) => void = (line) => void process.stderr.write(line)): Promise<T> {
  const started = Date.now();
  const timer = setInterval(() => write(`${what} loopt nog (${Math.round((Date.now() - started) / 1000)}s)\n`), everyMs);
  timer.unref();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
