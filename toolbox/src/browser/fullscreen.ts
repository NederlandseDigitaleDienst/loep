import type { Frame, Page } from "playwright";

/**
 * What the documents of a tab asked of full screen since they loaded, as the library in each
 * page recorded it (see `fullscreenState` in inpage.js), added up over the tab.
 */
export interface FullscreenReading {
  requests: number;
  /** Requests the browser refused, and why the last one was refused. */
  refused: number;
  lastRefusal: string | null;
  /** How often a page asked whether its document may go to full screen (`document.fullscreenEnabled`). */
  asked: number;
  /** Questions and requests in a document that may not go to full screen. */
  askedNotAllowed: number;
  active: boolean;
}

type Library = { __loep?: { fullscreenState?: () => FullscreenReading } };
const read = (frame: Frame): Promise<FullscreenReading | null> => frame.evaluate(() => (window as unknown as Library).__loep?.fullscreenState?.() ?? null).catch(() => null);

export async function fullscreenReading(page: Page): Promise<FullscreenReading> {
  const total: FullscreenReading = { requests: 0, refused: 0, lastRefusal: null, asked: 0, askedNotAllowed: 0, active: false };
  for (const reading of await Promise.all(page.frames().map(read))) {
    if (!reading) continue;
    total.requests += reading.requests;
    total.refused += reading.refused;
    total.asked += reading.asked;
    total.askedNotAllowed += reading.askedNotAllowed;
    if (reading.lastRefusal) total.lastRefusal = reading.lastRefusal;
    total.active ||= reading.active;
  }
  return total;
}

/** Said when the document itself may not go to full screen: no browser lets it. */
export const FULLSCREEN_NOT_ALLOWED_NL = 'dit document mag geen volledig scherm (document.fullscreenEnabled is onwaar): de site staat het zelf niet toe, bijvoorbeeld in een ingesloten venster zonder allow="fullscreen", en dat weigert elke browser';

/** Whether the page asked for full screen or left it between two readings, and what the browser answered; null when neither. */
export function fullscreenChange(before: FullscreenReading | undefined, after: FullscreenReading | undefined): string | null {
  if (!before || !after) return null;
  const notAllowed = after.askedNotAllowed > before.askedNotAllowed ? `; ${FULLSCREEN_NOT_ALLOWED_NL}` : "";
  if (after.requests > before.requests) {
    if (after.active) return "volledig scherm aangevraagd en aan";
    if (after.refused > before.refused) return `volledig scherm aangevraagd en geweigerd door de browser (${after.lastRefusal ?? "geen reden"})${notAllowed}`;
    return `volledig scherm aangevraagd${notAllowed}`;
  }
  if (before.active !== after.active) return after.active ? "volledig scherm aan" : "volledig scherm uit";
  // A player that asks first and finds it may not, often shows its own message and asks for nothing.
  if (notAllowed) return `de pagina vroeg of volledig scherm mag en kreeg nee${notAllowed}`;
  return null;
}
