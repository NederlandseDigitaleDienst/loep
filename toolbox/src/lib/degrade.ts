import { DEFAULT_PURPOSE, type Purpose } from "./purpose.ts";
import { OUTSIDE_SCOPE, openPoint } from "./verdict.ts";

/**
 * The places where loep scales down instead of stopping or leaving a criterion open (#318). Each
 * goes through `degrade`, so what scales down for which purpose is decided in one place.
 *
 * - `gate-after-retries`: a gap in the evidence that is still there after every return to the explorer.
 *   It becomes a limit on that page or state, which the judges look at themselves in the session.
 * - `point-in-decided`: an open point about this investigation (a limit of loep, or content outside
 *   the scope) in a criterion that failed anyway: the outcome does not hang on it.
 */
export type DegradeKind = "point-in-decided" | "gate-after-retries";

/** What a place becomes: a limit next to the outcome, or what it was. */
export type Degraded = "limit" | "open";

export function degrade(kind: DegradeKind, _purpose: Purpose = DEFAULT_PURPOSE): Degraded {
  switch (kind) {
    // A failed criterion stays failed whatever the point would show: for either purpose it is a limit, which a report to account for shows as prominently as an open point.
    case "point-in-decided":
      return "limit";
    // What the sweep could not show, a judge can still look at in the session; the report keeps it in sight either way.
    case "gate-after-retries":
      return "limit";
  }
}

/** Whether an open point is about this investigation and not something the owner of the site can do: a limit of loep, an unreachable part, or content outside the scope. */
export function aboutThisInvestigation(point: string): boolean {
  const kind = openPoint(point).kind;
  return kind !== null && (kind.reader !== "owner" || kind.prefix === OUTSIDE_SCOPE);
}

/**
 * The open points of a criterion, split into what stays open and what is a limit: in a failed
 * criterion every point about this investigation is a limit, because the outcome stands without it.
 */
export function splitPoints(points: string[], outcome: string, purpose: Purpose = DEFAULT_PURPOSE): { openNl: string[]; limitsNl: string[] } {
  if (outcome !== "failed" || degrade("point-in-decided", purpose) !== "limit") return { openNl: points, limitsNl: [] };
  return { openNl: points.filter((point) => !aboutThisInvestigation(point)), limitsNl: points.filter(aboutThisInvestigation) };
}
