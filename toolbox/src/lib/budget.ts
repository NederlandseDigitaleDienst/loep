import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROLE_NL, roleOfSession, type AgentRole } from "./models.ts";

/*
 * The budget of one task: how many commands and minutes the session of its agent gets. It is
 * computed from what the task has to cover and from what earlier runs used for the same
 * criterion, instead of one fixed number per role. The fixed number per role is the floor, so no
 * task gets less than it did; a ceiling per role keeps one task from taking the day.
 *
 * In short, for a judge:
 *
 *   commands = floor × use factor of the criterion × size of the site + 1 per candidate
 *   minutes  = the minutes of the floor, scaled with the commands
 *
 * both held between the floor and the ceiling of the role. An agent that still runs out can
 * extend its own session twice, each time by half of what it started with (`EXTENSION`).
 */

export interface Budget {
  commands: number;
  minutes: number;
}

/** The roles whose task gets a computed budget. */
export type BudgetRole = "walk" | "judge" | "verify" | "finish";

/** The most a task of each role gets, whatever the formula says. An extension comes on top of it. */
export const CEILINGS: Record<BudgetRole, Budget> = {
  walk: { commands: 220, minutes: 80 },
  judge: { commands: 240, minutes: 90 },
  verify: { commands: 240, minutes: 90 },
  finish: { commands: 420, minutes: 158 },
};

/**
 * What a session may add to its own budget: half of what it started with, in commands and in
 * minutes, at most twice, and only once most of what it has is used. `warnAt` is the share of
 * the budget from which every answer says what is left and how to extend.
 */
export const EXTENSION = { share: 0.5, max: 2, warnAt: 0.8 } as const;

/** The least a reason for an extension has to say: what is still to be measured does not fit in a word. */
export const MIN_EXTENSION_REASON = 20;

/** A session counts as "at its limit" from this share of its commands or minutes. */
export const AT_LIMIT = 0.9;

/**
 * What the sessions of earlier runs used, per criterion: `[sessions, at the limit, peak]` for
 * the judge and for the verifier. A session is at the limit when it used 90 percent or more of
 * its commands or minutes, or when its verdict left a point "budget op". Peak is the highest
 * share of the budget any of them used, in percent.
 *
 * Source: the session files (`observations/<session>/session.json`) and the verdicts of four
 * complete runs on two sites (`meting-v2`, `nerds-v2`, `nerds-v3`, `nerds-v4`), read in
 * October 2026: 226 sessions of judges on a budget of 80 commands and 30 minutes, 224 of
 * verifiers on 20 to 191 commands. 45 judges and 65 verifiers were at the limit. Always on the
 * commands: no session came above 37 percent of its minutes.
 *
 * Measure again after a run with the computed budgets: a session that was extended, or that
 * stayed far below its budget, says which way a number here has to move.
 */
export const MEASURED_USE: Record<string, { judge: [number, number, number]; verify: [number, number, number] }> = {
  "1.1.1": { judge: [5, 1, 95], verify: [4, 2, 96] },
  "1.2.1": { judge: [5, 0, 28], verify: [4, 0, 54] },
  "1.2.2": { judge: [4, 0, 50], verify: [4, 0, 65] },
  "1.2.3": { judge: [4, 0, 34], verify: [4, 0, 78] },
  "1.2.4": { judge: [4, 0, 53], verify: [4, 1, 91] },
  "1.2.5": { judge: [4, 0, 33], verify: [4, 0, 75] },
  "1.3.1": { judge: [4, 1, 99], verify: [4, 0, 77] },
  "1.3.2": { judge: [4, 0, 81], verify: [4, 0, 83] },
  "1.3.3": { judge: [4, 0, 85], verify: [4, 1, 97] },
  "1.3.4": { judge: [4, 0, 78], verify: [4, 0, 82] },
  "1.3.5": { judge: [4, 0, 61], verify: [4, 0, 76] },
  "1.4.1": { judge: [4, 1, 94], verify: [4, 3, 100] },
  "1.4.2": { judge: [4, 0, 33], verify: [4, 0, 55] },
  "1.4.3": { judge: [4, 4, 100], verify: [4, 4, 100] },
  "1.4.4": { judge: [4, 1, 100], verify: [4, 0, 74] },
  "1.4.5": { judge: [4, 1, 93], verify: [4, 0, 49] },
  "1.4.10": { judge: [4, 3, 99], verify: [4, 3, 97] },
  "1.4.11": { judge: [4, 3, 100], verify: [4, 3, 100] },
  "1.4.12": { judge: [4, 0, 74], verify: [4, 1, 100] },
  "1.4.13": { judge: [4, 3, 95], verify: [4, 2, 99] },
  "2.1.1": { judge: [4, 4, 100], verify: [4, 4, 99] },
  "2.1.2": { judge: [4, 4, 100], verify: [4, 4, 100] },
  "2.1.4": { judge: [4, 0, 85], verify: [4, 1, 97] },
  "2.2.1": { judge: [4, 0, 60], verify: [4, 0, 78] },
  "2.2.2": { judge: [4, 2, 99], verify: [4, 1, 98] },
  "2.3.1": { judge: [4, 1, 100], verify: [4, 1, 100] },
  "2.4.1": { judge: [4, 0, 55], verify: [4, 1, 100] },
  "2.4.2": { judge: [4, 0, 44], verify: [4, 0, 63] },
  "2.4.3": { judge: [4, 1, 91], verify: [4, 3, 100] },
  "2.4.4": { judge: [4, 0, 85], verify: [4, 2, 98] },
  "2.4.5": { judge: [4, 0, 21], verify: [4, 0, 60] },
  "2.4.6": { judge: [4, 0, 78], verify: [4, 1, 97] },
  "2.4.7": { judge: [4, 1, 99], verify: [4, 2, 91] },
  "2.4.11": { judge: [4, 1, 100], verify: [4, 3, 100] },
  "2.5.1": { judge: [4, 0, 26], verify: [4, 0, 68] },
  "2.5.2": { judge: [4, 0, 85], verify: [4, 3, 94] },
  "2.5.3": { judge: [4, 2, 95], verify: [4, 3, 100] },
  "2.5.4": { judge: [4, 0, 20], verify: [4, 0, 35] },
  "2.5.7": { judge: [4, 0, 50], verify: [4, 0, 62] },
  "2.5.8": { judge: [4, 4, 100], verify: [4, 3, 100] },
  "3.1.1": { judge: [4, 0, 33], verify: [4, 0, 55] },
  "3.1.2": { judge: [4, 0, 86], verify: [4, 1, 98] },
  "3.2.1": { judge: [4, 0, 61], verify: [4, 0, 80] },
  "3.2.2": { judge: [4, 0, 61], verify: [4, 3, 100] },
  "3.2.3": { judge: [4, 2, 100], verify: [4, 1, 100] },
  "3.2.4": { judge: [4, 0, 84], verify: [4, 2, 95] },
  "3.2.6": { judge: [4, 0, 76], verify: [4, 0, 80] },
  "3.3.1": { judge: [4, 0, 88], verify: [4, 1, 99] },
  "3.3.2": { judge: [4, 0, 45], verify: [4, 0, 58] },
  "3.3.3": { judge: [4, 0, 76], verify: [4, 2, 94] },
  "3.3.4": { judge: [4, 0, 35], verify: [4, 0, 80] },
  "3.3.7": { judge: [4, 0, 59], verify: [4, 1, 97] },
  "3.3.8": { judge: [4, 0, 31], verify: [4, 0, 57] },
  "4.1.1": { judge: [4, 0, 81], verify: [4, 0, 51] },
  "4.1.2": { judge: [4, 4, 100], verify: [4, 1, 95] },
  "4.1.3": { judge: [4, 1, 96], verify: [4, 1, 92] },
};

/**
 * The same four runs for the walk-through, which has no criterion: 62 sessions on 110 commands,
 * 12 at the limit, peak 97 percent, and 11 of them wrote that the budget kept them from a state.
 * The page types they walked had three to eight states to open; the ones with seven or eight
 * were the ones near the limit. So a walk gets its floor for up to `included` states and
 * `perState` commands for each one more.
 */
export const WALK_STATES = { included: 4, perState: 10 } as const;

/** One command for each candidate of the walk-through: the judge rules on every one of them. */
export const COMMANDS_PER_CANDIDATE = 1;

/**
 * Page types plus states of the largest site in the measured runs (15 page types and 19 states).
 * A site up to this size gets what the measured sessions needed; a larger one gets more in
 * proportion. A smaller one does not get less: the floor is the fixed budget.
 */
export const REFERENCE_SITE_SIZE = 34;

/**
 * How much more than the floor a criterion gets, from what earlier sessions used:
 * 2 when half or more of them were at the limit, 1.5 when at least one was, 1.25 when none was
 * but one came to 80 percent (where the warning starts), and 1 otherwise or when nothing was measured.
 */
export function useFactor(role: "judge" | "verify", criterion: string): number {
  const measured = MEASURED_USE[criterion]?.[role];
  if (!measured || measured[0] === 0) return 1;
  const [sessions, atLimit, peak] = measured;
  if (atLimit / sessions >= 0.5) return 2;
  if (atLimit > 0) return 1.5;
  return peak >= EXTENSION.warnAt * 100 ? 1.25 : 1;
}

/** What a criterion has to cover on this site: the page types it applies to and the states that can be opened on them. */
export interface Coverage {
  pageTypes: number;
  states: number;
}

/** 1 for a site up to the size the factors were measured on, more in proportion above it. */
export function sizeFactor(coverage: Coverage): number {
  return Math.max(1, (coverage.pageTypes + coverage.states) / REFERENCE_SITE_SIZE);
}

/** Hold the commands between floor and ceiling, and give the minutes that go with them: those of the floor, scaled, rounded up. */
function within(commands: number, floor: Budget, ceiling: Budget): Budget {
  const held = Math.min(Math.max(Math.round(commands), floor.commands), Math.max(ceiling.commands, floor.commands));
  const minutes = Math.ceil((floor.minutes * held) / floor.commands);
  return { commands: held, minutes: Math.min(Math.max(minutes, floor.minutes), Math.max(ceiling.minutes, floor.minutes)) };
}

/** A walk-through: the floor, and more for a page type with many states to open. */
export function walkBudget(floor: Budget, states: number): Budget {
  return within(floor.commands + WALK_STATES.perState * Math.max(0, states - WALK_STATES.included), floor, CEILINGS.walk);
}

/** A judge: the floor times what the criterion used before and the size of the site, plus one command per candidate. */
export function judgeBudget(floor: Budget, criterion: string, coverage: Coverage, candidates: number): Budget {
  return within(floor.commands * useFactor("judge", criterion) * sizeFactor(coverage) + COMMANDS_PER_CANDIDATE * candidates, floor, CEILINGS.judge);
}

/** A verifier: what it gets for the findings and candidates it has to reproduce (the floor), times what the criterion used before and the size of the site. */
export function verifyBudget(floor: Budget, criterion: string, coverage: Coverage): Budget {
  return within(floor.commands * useFactor("verify", criterion) * sizeFactor(coverage), floor, CEILINGS.verify);
}

/** The finishing round: its floor, raised by as much as the judge of the same criterion got above its own floor. */
export function finishBudget(floor: Budget, judge: Budget, judgeFloor: Budget): Budget {
  return within((floor.commands * judge.commands) / judgeFloor.commands, floor, CEILINGS.finish);
}

/** One extension as the session file keeps it. */
export interface Extension {
  at: string;
  /** What is still to be measured, in the words of the agent. */
  reasonNl: string;
  /** What was added. */
  commands: number;
  minutes: number;
  /** What the session had used when it asked. */
  usedCommands: number;
  usedMinutes: number;
}

/** What one extension adds to a session that started with this budget. */
export function extensionOf(original: Budget): Budget {
  return { commands: Math.ceil(original.commands * EXTENSION.share), minutes: Math.ceil(original.minutes * EXTENSION.share) };
}

/** The extensions a session file holds; none for a file from before they existed or one that cannot be read. */
export function extensionsOf(runDir: string, session: string): Extension[] {
  const path = join(runDir, "observations", session, "session.json");
  if (!existsSync(path)) return [];
  try {
    const extensions = (JSON.parse(readFileSync(path, "utf8")) as { extensions?: unknown }).extensions;
    return Array.isArray(extensions) ? (extensions as Extension[]) : [];
  } catch {
    return [];
  }
}

/** Per role: how many sessions there were, how many extended their budget, and how often in all. */
export interface RoleExtensions {
  role: AgentRole;
  roleNl: string;
  sessions: number;
  /** Sessions that extended at least once. */
  extended: number;
  /** Extensions over all sessions of the role. */
  extensions: number;
}

const ROLE_ORDER: AgentRole[] = ["explorer", "walk", "judge", "verifier", "finisher"];

/** Count the extensions of a run per role, from its session files. Roles without a session are left out. */
export function extensionUse(runDir: string): RoleExtensions[] {
  const root = join(runDir, "observations");
  const counts = new Map<AgentRole, number[]>();
  for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
    const role = roleOfSession(name);
    if (!role || !existsSync(join(root, name, "session.json"))) continue;
    counts.set(role, [...(counts.get(role) ?? []), extensionsOf(runDir, name).length]);
  }
  return ROLE_ORDER.filter((role) => counts.has(role)).map((role) => {
    const each = counts.get(role)!;
    return { role, roleNl: ROLE_NL[role], sessions: each.length, extended: each.filter((count) => count > 0).length, extensions: each.reduce((sum, count) => sum + count, 0) };
  });
}

/** One line for the report about the extensions of a run, or null when no session extended. */
export function extensionsNl(roles: RoleExtensions[] | undefined): string | null {
  const extended = (roles ?? []).filter((entry) => entry.extended > 0);
  if (extended.length === 0) return null;
  return extended.map((entry) => `${entry.roleNl}: ${entry.extended} van de ${entry.sessions} ${entry.sessions === 1 ? "sessie" : "sessies"} (${entry.extensions} keer)`).join("; ");
}
