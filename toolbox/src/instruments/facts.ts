import type { Page } from "playwright";
import { axInfo, call } from "../browser/call.ts";
import { mediaReport } from "./media.ts";

export interface Described {
  ref: number;
  [key: string]: unknown;
}

export interface FrameListeners {
  /** Address of the frame. */
  address: string;
  /** Title of the iframe element, as a person would name the frame. */
  title: string | null;
  /** How deep the frame is nested: 1 is a frame of the page itself. */
  depth: number;
  listeners: Record<string, Record<string, number>>;
}

export interface FrameNotInspected {
  address: string;
  title: string | null;
  reasonNl: string;
}

/**
 * Event listeners per frame. The count of the page itself says nothing about what an
 * embedded window listens for, so each frame is read on the spot, also one of another
 * party: nothing is opened or operated for it. A frame that cannot be read is named.
 */
export async function frameListeners(page: Page): Promise<{ frames: FrameListeners[]; notInspected: FrameNotInspected[] }> {
  const frames: FrameListeners[] = [];
  const notInspected: FrameNotInspected[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    const address = frame.url();
    const title = await frame
      .frameElement()
      .then((element) => element.evaluate((node) => (node as Element).getAttribute("title") || (node as Element).getAttribute("aria-label") || (node as Element).getAttribute("name")))
      .catch(() => null);
    let depth = 0;
    for (let current = frame.parentFrame(); current; current = current.parentFrame()) depth++;
    try {
      const listeners = await frame.evaluate(() => (window as unknown as { __loep?: { ownListeners: () => Record<string, Record<string, number>> } }).__loep?.ownListeners() ?? null);
      if (listeners) frames.push({ address, title, depth, listeners });
      else notInspected.push({ address, title, reasonNl: "in dit venster is het telscript niet geladen (het venster was er al voor de meting begon, of staat geen scripts toe)" });
    } catch (error) {
      notInspected.push({ address, title, reasonNl: `het venster was niet uit te lezen: ${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 120)}` });
    }
  }
  return { frames, notInspected };
}

/** Everything the in-page library can read from the page as it is now, with what assistive technology gets for each element. */
export async function collectFacts(page: Page): Promise<Record<string, unknown>> {
  const facts = await call<Record<string, unknown>>(page, "collectFacts");
  const cdp = await page.context().newCDPSession(page);
  for (const group of ["headings", "landmarks", "images", "links", "controls", "clickables", "iframes", "tables"]) {
    for (const item of facts[group] as Described[]) {
      (item as Record<string, unknown>).ax = await axInfo(cdp, item.ref);
    }
  }
  await cdp.detach();
  const inFrames = await frameListeners(page);
  facts.frameListeners = inFrames.frames;
  facts.framesNotInspected = inFrames.notInspected;
  // Audio and video as they are in this state of the page; read only, nothing is pressed.
  facts.media = await mediaReport(page);
  return facts;
}

/**
 * The links and controls of the page as it is now, with the name assistive technology gets
 * for each: what the comparison of visible text and name needs at another window size.
 */
export async function collectNamed(page: Page): Promise<{ links: Described[]; controls: Described[] }> {
  const facts = await call<{ links: Described[]; controls: Described[] }>(page, "collectFacts");
  const cdp = await page.context().newCDPSession(page);
  for (const item of [...facts.links, ...facts.controls]) item.ax = await axInfo(cdp, item.ref);
  await cdp.detach();
  return { links: facts.links, controls: facts.controls };
}

/** Clickable elements that are not a control, as they are at the current window size, with what assistive technology gets for them. */
export async function collectClickables(page: Page): Promise<Described[]> {
  const clickables = await call<Described[]>(page, "clickables");
  const cdp = await page.context().newCDPSession(page);
  for (const item of clickables) item.ax = await axInfo(cdp, item.ref);
  await cdp.detach();
  return clickables;
}
