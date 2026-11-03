import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";

/**
 * The time between two navigations to the same host that a run was given at `inventory`
 * (`--navigation-delay <seconds>`), for a site that refuses connections after a number of page
 * loads in a short time. It holds for the inventory itself, check-site, the sweep and the sessions
 * of the agents. A run without it keeps the default pace.
 */

/** Parse `--navigation-delay`: seconds, a number of 0 or more, given back as milliseconds. */
export function parseNavigationDelay(value: string): number {
  const seconds = Number(value);
  if (value.trim() === "" || !Number.isFinite(seconds) || seconds < 0 || seconds > 600) throw new Error(`--navigation-delay is een aantal seconden tussen 0 en 600, zoals 3 of 2.5; "${value}" is dat niet`);
  return Math.round(seconds * 1000);
}

/** The delay this run was given at `inventory`, in milliseconds; null when it has none. */
export function runNavigationDelayMs(runDir: string): number | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    const delay = (JSON.parse(readFileSync(path, "utf8")) as { navigationDelayMs?: unknown }).navigationDelayMs;
    return typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : null;
  } catch {
    return null;
  }
}

/** Store the delay with the run, or take it away: an inventory without the flag is a run at the default pace. */
export async function recordNavigationDelay(runDir: string, delayMs: number | null): Promise<void> {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path) && delayMs === null) return;
  const { navigationDelayMs: _previous, ...manifest } = existsSync(path) ? await readJson<Record<string, unknown>>(path) : ({} as Record<string, unknown>);
  await writeJson(path, delayMs === null ? manifest : { ...manifest, navigationDelayMs: delayMs });
}

/** The run's delay as a partial set of limits, to lay over the defaults and under what was asked for explicitly. */
export function runPace(runDir: string): { navigationDelayMs?: number } {
  const delay = runNavigationDelayMs(runDir);
  return delay === null ? {} : { navigationDelayMs: delay };
}
