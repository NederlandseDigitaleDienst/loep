import { EXTENSION, type Budget } from "./budget.ts";
import type { ManifestStep } from "./manifest.ts";

/*
 * The time of the exploration as a whole. Every round of the explorer is followed by a full sweep
 * and the gate, and the gate sends the run back to the explorer at most twice. On a site with many
 * kinds of pages that came to three rounds of 191, 60 and 63 minutes from the task of the explorer
 * to the verdict of the gate, half of a run, for a report about the same sample (#730). The explorer
 * itself worked 93 of those minutes: the time is in the sweep and the gate after each round. So the
 * budget is on the wall time of the rounds together, and before a new round starts the gate and
 * `explore` check that a sweep still fits in what is left.
 */

/** Budget of one session of the exploring agent, the first round at least. */
export const EXPLORE_MAX_COMMANDS = 200;
export const EXPLORE_MAX_MINUTES = 40;

/** Wall minutes of every round of the exploration together, from `explore` to the verdict of the gate, unless `explore --explore-minutes` says otherwise. */
export const EXPLORE_TOTAL_MINUTES = 240;

/** A round shorter than this is no round: the explorer reads the model and the gaps before it measures anything. */
export const EXPLORE_MIN_ROUND_MINUTES = 10;

/** A sweep when the run has none with its own time recorded: what one over a sample of 16 pages and 20 documents took (#730). */
export const SWEEP_MINUTES = 45;

/** The commands of one sweep, each with its own step in the manifest. */
const SWEEP_COMMANDS = ["collect", "contrast", "states", "documents"];

/** What a session can grow to with every extension, as a multiple of what it starts with. */
const WITH_EXTENSIONS = 1 + EXTENSION.share * EXTENSION.max;

/**
 * The most one command, or the time between two, counts: the longest a usual session of the explorer can grow to, 80 minutes.
 * The same in every round: a later round with a shorter session still has a sweep of full length, and a look at the pictures.
 */
const MOST_PER_STRETCH = EXPLORE_MAX_MINUTES * WITH_EXTENSIONS * 60_000;

type Step = Pick<ManifestStep, "command"> & { at?: string; startedAt?: string; seconds?: unknown; only?: unknown; totalMinutes?: unknown };

/**
 * The total of this run: what the last `explore` recorded. Null for a run whose explorer had no
 * total, made before it existed: that run keeps the rounds it had, and notices nothing.
 */
export function exploreTotalMinutes(steps: Step[]): number | null {
  const recorded = steps.findLast((step) => step.command === "explore" && typeof step.totalMinutes === "number");
  return recorded ? (recorded.totalMinutes as number) : null;
}

const time = (value: string | undefined): number => (value ? Date.parse(value) : NaN);

/**
 * Wall minutes of the exploration so far: per round, from its `explore` to the last `gate` before
 * the next round, or to `now` for the round the gate is judging. Only time in which the run works
 * counts. A command counts from its own start to its end, as the manifest records it, and two
 * commands that ran at the same time count once. The time between two commands is an agent at work,
 * the explorer or the one that looks at the pictures, or else a pause: a question to a person, a
 * limit that stopped the run until the next morning. The manifest cannot tell them apart, so such a
 * stretch counts at most `MOST_PER_STRETCH`; so does a command, in case the machine slept while it
 * ran or the clock jumped. A clock that went back counts nothing. Without pauses this is the wall
 * time; the time between the verdict of the gate and the next `explore` is never counted.
 */
export function exploreMinutesUsed(steps: Step[], now?: string): number {
  const starts = steps.flatMap((step, index) => (step.command === "explore" ? [index] : []));
  const stretch = (from: number, to: number): number => (Number.isFinite(from) && Number.isFinite(to) ? Math.min(MOST_PER_STRETCH, Math.max(0, to - from)) : 0);
  let used = 0;
  starts.forEach((start, n) => {
    const round = steps.slice(start, starts[n + 1] ?? steps.length);
    if (n === starts.length - 1 && now) round.push({ command: "gate", startedAt: now, at: now });
    const verdict = round.findLastIndex((step) => step.command === "gate");
    const counted = round.slice(0, verdict >= 0 ? verdict + 1 : round.length);
    let cursor = time(counted[0]!.startedAt ?? counted[0]!.at);
    for (const step of counted) {
      const end = time(step.at);
      const begin = Number.isFinite(time(step.startedAt)) ? time(step.startedAt) : end;
      // A step that began before the one before it ended ran beside it: only what comes after counts. One that also ended before it is a clock that went back.
      used += stretch(cursor, begin) + stretch(end >= cursor ? Math.max(cursor, begin) : begin, end);
      if (Number.isFinite(end)) cursor = end;
    }
  });
  return Math.round(used / 6_000) / 10;
}

/**
 * Minutes of one sweep in this run: the last `collect` of the whole sample with the `contrast`,
 * `states` and `documents` after it, before the next such `collect`, by their own time. A sweep that
 * is still running or stopped halfway does not count; then the one before it. Without one, `SWEEP_MINUTES`.
 */
export function sweepMinutes(steps: Step[]): number {
  const whole = steps.flatMap((step, index) => (step.command === "collect" && !step.only && typeof step.seconds === "number" ? [index] : []));
  for (let n = whole.length - 1; n >= 0; n--) {
    const sweep = steps.slice(whole[n], whole[n + 1] ?? steps.length);
    const seconds = SWEEP_COMMANDS.map((command) => sweep.find((each) => each.command === command && typeof each.seconds === "number")?.seconds as number | undefined);
    if (seconds.every((each) => each !== undefined)) return Math.round(seconds.reduce((sum, each) => sum + each, 0) / 6) / 10;
  }
  return SWEEP_MINUTES;
}

/**
 * The session of the next round: the usual budget, or less when what is left of the total after a
 * sweep is smaller, so that the round with its sweep ends close to the total. Null when not even the
 * sweep fits: then there is no round, so that none stops halfway. A round that does start gets at
 * least a short session, and may go past the total by that much. Without a total (a run from before
 * it), always the usual budget.
 */
export function exploreRoundBudget(total: number | null, used: number, sweep: number): Budget | null {
  if (total === null) return { commands: EXPLORE_MAX_COMMANDS, minutes: EXPLORE_MAX_MINUTES };
  const left = total - used;
  if (left < sweep) return null;
  const minutes = Math.min(EXPLORE_MAX_MINUTES, Math.max(EXPLORE_MIN_ROUND_MINUTES, Math.floor((left - sweep) / WITH_EXTENSIONS)));
  return { commands: Math.round((EXPLORE_MAX_COMMANDS * minutes) / EXPLORE_MAX_MINUTES), minutes };
}

/** What the gate and `explore` say when the time for the exploration is used up. */
export function exploreTimeSpentNl(total: number, used: number, sweep: number): string {
  return `de tijd voor de verkenning is op: ${Math.round(used)} van ${total} minuten voor alle rondes samen, van explore tot de uitspraak van de poort, en een nieuwe ronde met een veegronde van ongeveer ${Math.round(sweep)} minuten past er niet meer in`;
}

/** Read `--explore-minutes`: a whole number of minutes, enough for at least one short round. */
export function parseExploreMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  const least = Math.ceil(EXPLORE_MIN_ROUND_MINUTES * WITH_EXTENSIONS);
  if (!Number.isInteger(minutes) || minutes < least) throw new Error(`--explore-minutes verwacht een heel aantal minuten van minstens ${least}, niet "${value}"`);
  return minutes;
}
