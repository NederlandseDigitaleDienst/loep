import { EXTENSION, type Budget } from "./budget.ts";
import type { ManifestStep } from "./manifest.ts";

/*
 * The time of the exploration as a whole. Every round of the explorer has a session of its own,
 * with its own budget and two extensions it can ask for itself, and the gate sends the run back to
 * the explorer at most twice. On a site with many kinds of pages that came to three full sessions
 * and half of a run (#730), while the report was about the same sample. So the rounds share one
 * total: a round gets what is left of it, and once too little is left the gate goes on with
 * limitations, as it does after the last return.
 */

/** Budget of one session of the exploring agent, the first round at least. */
export const EXPLORE_MAX_COMMANDS = 200;
export const EXPLORE_MAX_MINUTES = 40;

/** Minutes for every round of the explorer together, unless `explore --explore-minutes` says otherwise: a first round with both extensions, and a follow-up round of half that. */
export const EXPLORE_TOTAL_MINUTES = 120;

/** A round shorter than this is no round: the explorer reads the model and the gaps before it measures anything. */
export const EXPLORE_MIN_ROUND_MINUTES = 10;

/** What a session can grow to with every extension, as a multiple of what it starts with. */
const WITH_EXTENSIONS = 1 + EXTENSION.share * EXTENSION.max;

type Step = Pick<ManifestStep, "command"> & { at?: string; totalMinutes?: unknown; maxMinutes?: unknown };

/**
 * The total of this run: what the last `explore` recorded. Null for a run whose explorer had no
 * total, made before it existed: that run keeps the rounds it had, and notices nothing.
 */
export function exploreTotalMinutes(steps: Step[]): number | null {
  const recorded = steps.findLast((step) => step.command === "explore" && typeof step.totalMinutes === "number");
  return recorded ? (recorded.totalMinutes as number) : null;
}

/**
 * Minutes the explorer worked so far: per round, from its task (`explore`) to the last
 * `check-site` before the next round. The same reading as the estimate. A round without a
 * `check-site` yet counts nothing. A round counts at most what its session could grow to with
 * both extensions: a run that waited overnight, or a clock that jumped, does not use up the time
 * of the rounds after it.
 */
export function exploreMinutesUsed(steps: Step[]): number {
  let used = 0;
  let begin: number | null = null;
  let end: number | null = null;
  let most = EXPLORE_MAX_MINUTES * WITH_EXTENSIONS;
  const close = (): void => {
    if (begin !== null && end !== null) used += Math.min(most, Math.max(0, end - begin) / 60_000);
  };
  for (const step of steps) {
    const at = step.at ? Date.parse(step.at) : NaN;
    if (step.command === "explore") {
      close();
      begin = Number.isFinite(at) ? at : null;
      end = null;
      most = (typeof step.maxMinutes === "number" ? step.maxMinutes : EXPLORE_MAX_MINUTES) * WITH_EXTENSIONS;
    } else if (step.command === "check-site" && begin !== null && Number.isFinite(at)) end = at;
  }
  close();
  return Math.round(used * 10) / 10;
}

/**
 * The session of the next round: the usual budget, or less when what is left of the total is
 * smaller, so that the round fits with both its extensions. Null when not even a short round fits.
 * Without a total (a run from before it), always the usual budget.
 */
export function exploreRoundBudget(total: number | null, used: number): Budget | null {
  if (total === null) return { commands: EXPLORE_MAX_COMMANDS, minutes: EXPLORE_MAX_MINUTES };
  const minutes = Math.min(EXPLORE_MAX_MINUTES, Math.floor((total - used) / WITH_EXTENSIONS));
  if (minutes < EXPLORE_MIN_ROUND_MINUTES) return null;
  return { commands: Math.round((EXPLORE_MAX_COMMANDS * minutes) / EXPLORE_MAX_MINUTES), minutes };
}

/** What the gate and `explore` say when the time for the exploration is used up. */
export function exploreTimeSpentNl(total: number, used: number): string {
  return `de tijd voor de verkenning is op: ${Math.round(used)} van ${total} minuten voor alle rondes samen`;
}

/** Read `--explore-minutes`: a whole number of minutes, enough for at least one short round. */
export function parseExploreMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  const least = Math.ceil(EXPLORE_MIN_ROUND_MINUTES * WITH_EXTENSIONS);
  if (!Number.isInteger(minutes) || minutes < least) throw new Error(`--explore-minutes verwacht een heel aantal minuten van minstens ${least}, niet "${value}"`);
  return minutes;
}
