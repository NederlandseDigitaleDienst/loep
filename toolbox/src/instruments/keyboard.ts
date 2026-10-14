import { join } from "node:path";
import type { Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../browser/call.ts";
import { RENDERING } from "../browser/session.ts";
import { writeFileAtomic } from "../lib/canonical.ts";
import { focusIndicator } from "../lib/contrast.ts";
import { ensureHelpers } from "./methods/capsule.ts";
import { predictedOrder } from "./methods/taborder.ts";

export const MAX_TAB_STOPS = 250;
export const FOCUS_MARGIN = 8;

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Painted {
  visible: boolean;
  viewportBox: Clip;
}

export const sameBox = (first: Clip, second: Clip): boolean => (["x", "y", "width", "height"] as const).every((side) => Math.abs(first[side] - second[side]) <= 1);

export const NOT_PAINTED = "het element met de focus is zelf niet zichtbaar (verborgen of doorzichtig); de uitsnede toont wat er op die plek staat";
export const MOVED = "het element stond tijdens de opname niet op de plek van de uitsnede (de pagina verschoof); de uitsnede is niet te vergelijken";

/** The part of the window around an element in which its focus indicator is drawn. */
export function focusClip(box: Clip, viewport: { width: number; height: number } = RENDERING.viewport): Clip | null {
  const x = Math.max(0, box.x - FOCUS_MARGIN);
  const y = Math.max(0, box.y - FOCUS_MARGIN);
  const right = Math.min(viewport.width, box.x + box.width + FOCUS_MARGIN);
  const bottom = Math.min(viewport.height, box.y + box.height + FOCUS_MARGIN);
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
}

export interface TabWalkOptions {
  /** Directory the focus clips are written to. */
  focusDir: string;
  /** How that directory is named in the result. */
  focusPath: string;
  maxStops?: number;
  /** Selector chain of the element to start after; without it the walk starts at the top of the page. */
  from?: string[];
  /**
   * What to do when the walk ends with focus on nothing while the DOM predicts more stops:
   * find the element that threw focus away, name it and walk on behind it. The sweep asks
   * for this; `loep taborder` makes that comparison itself.
   */
  continueAfterFocusLoss?: boolean;
}

const MAX_FRAME_DEPTH = 5;

/** Where focus is inside an embedded frame, as far down as frames are nested. */
export interface FrameStop {
  tag: string;
  text: string;
  path: string[];
  frameUrl: string;
}

/**
 * While focus is inside a frame, the document around it keeps reporting the frame element
 * as the active element. Ask the frame itself where focus is, so a walk can tell the
 * second control of a player from a keyboard trap. Null when the focused element is not a frame.
 */
async function focusInsideFrame(page: Page): Promise<{ key: string; stop: FrameStop } | null> {
  let frame = page.mainFrame();
  const keys: string[] = [];
  let stop: FrameStop | null = null;
  for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
    const handle = await frame.evaluateHandle(() => (window as unknown as { __loep?: { deepActiveElement: () => Element | null } }).__loep?.deepActiveElement() ?? document.activeElement);
    const child = (await handle.asElement()?.contentFrame().catch(() => null)) ?? null;
    await handle.dispose().catch(() => undefined);
    if (!child) break;
    const inner = await child
      .evaluate(() => {
        const state = (window as unknown as { __loep?: { focusState: () => { tag: string; text: string; path: string[] } | null } }).__loep?.focusState() ?? null;
        return state ? { tag: state.tag, text: state.text, path: state.path } : null;
      })
      .catch(() => null);
    frame = child;
    stop = { tag: inner?.tag ?? "body", text: (inner?.text ?? "").slice(0, 80), path: inner?.path ?? [], frameUrl: child.url() };
    keys.push(inner ? inner.path.join(" >>> ") : "(body)");
    if (!inner || (inner.tag !== "iframe" && inner.tag !== "frame")) break;
  }
  return stop ? { key: keys.join(" >>> (frame) "), stop } : null;
}

/** Controls a browser draws inside one element, each a Tab stop of its own while the page only sees the element. */
const MEDIA_INTERNAL_STOPS = 12;
const DATE_INTERNAL_STOPS = 6;

/**
 * How many more Tab presses may stay on the focused element before that counts as a trap.
 * A media element with controls and a date field hold several stops the page cannot see into.
 */
function internalStops(page: Page): Promise<number> {
  return page.evaluate(
    ([media, date]) => {
      const element = (window as unknown as { __loep: { deepActiveElement: () => Element | null } }).__loep.deepActiveElement();
      if (!element) return 0;
      if ((element.localName === "video" || element.localName === "audio") && (element as HTMLMediaElement).controls) return media!;
      if (element.localName === "input" && ["date", "time", "datetime-local", "month", "week"].includes((element as HTMLInputElement).type)) return date!;
      return 0;
    },
    [MEDIA_INTERNAL_STOPS, DATE_INTERNAL_STOPS],
  );
}

const MAX_FOCUS_LOSSES = 10;
const MAX_KEEP_CHECKS = 15;

/**
 * When a walk ends with focus on nothing: is there an element next in the order the DOM
 * predicts that does not keep focus when it gets it? That element throws focus away, and a
 * keyboard user never gets past it. Returns it with the next element that does keep focus.
 * Null when focus simply left the page. The prediction and the test are those of `loep taborder`.
 */
async function focusThrownAway(page: Page, stops: { path: string[] }[]): Promise<{ thrower: { where: string; tag: string; text: string }; next: string | null } | null> {
  try {
    const predicted = (await predictedOrder(page)).stops;
    const visited = new Set(stops.map((stop) => stop.path.join(" >>> ")));
    const lastAt = Math.max(-1, ...predicted.map((stop, index) => (visited.has(stop.where) ? index : -1)));
    const remaining = predicted.slice(lastAt + 1).filter((stop) => !visited.has(stop.where));
    if (remaining.length === 0) return null;
    await ensureHelpers(page);
    const keeps = (place: string): Promise<boolean | null> => page.evaluate((where) => (window as unknown as { __loepm: { keepsFocus: (place: string) => boolean | null } }).__loepm.keepsFocus(where), place);
    if ((await keeps(remaining[0]!.where)) !== false) return null;
    for (const candidate of remaining.slice(1, 1 + MAX_KEEP_CHECKS)) if ((await keeps(candidate.where)) === true) return { thrower: remaining[0]!, next: candidate.where };
    return { thrower: remaining[0]!, next: null };
  } catch {
    return null;
  }
}

/** Walk the page with Tab and record where focus goes, what it looks like and whether anything hides it. */
export async function tabWalk(page: Page, options: TabWalkOptions): Promise<Record<string, unknown>> {
  const { focusDir, focusPath, maxStops = MAX_TAB_STOPS } = options;
  const viewport = page.viewportSize() ?? RENDERING.viewport;
  // A page can put focus somewhere itself on load; that element is reachable although Tab never lands on it first.
  const initialFocus = await call<Record<string, unknown> | null>(page, "focusState");
  if (options.from) {
    await page.evaluate((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain)?.focus(), options.from);
  } else await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" }));
  const startUrl = page.url();
  const stops: Record<string, unknown>[] = [];
  const focused: (Buffer | null)[] = [];
  const capture = async (state: Record<string, unknown>): Promise<Buffer | null> => {
    const clip = state.inViewport ? focusClip(state.viewportBox as Clip, viewport) : null;
    if (!clip) return null;
    const shot = await page.screenshot({ clip, animations: "disabled" });
    // A clip says something about focus only when the element was painted there while the picture was taken.
    const painted = await call<Painted | null>(page, "paintedBox", state.ref);
    state.clipVerified = painted !== null && painted.visible && sameBox(painted.viewportBox, state.viewportBox as Clip);
    if (!state.clipVerified) state.focusNotMeasured = painted?.visible === false ? NOT_PAINTED : MOVED;
    return shot;
  };
  const seen = new Map<string, number>();
  let firstKey: string | null = null;
  const thrownAway: { where: string; tag: string; text: string; afterStop: number }[] = [];
  let outcome = "limit-reached";
  for (let index = 0; index < maxStops; index++) {
    await page.keyboard.press("Tab");
    let state = await call<(Record<string, unknown> & { path: string[] }) | null>(page, "focusState");
    let afterFocusLoss = false;
    if (state === null) {
      // Nothing has focus. Either it left the document for the browser, and the walk is complete,
      // or the next element threw focus away when it got it: then there is more page behind it.
      const lost = options.continueAfterFocusLoss && thrownAway.length < MAX_FOCUS_LOSSES ? await focusThrownAway(page, stops as { path: string[] }[]) : null;
      if (!lost) {
        outcome = thrownAway.length > 0 ? "focus-lost-continued" : "completed";
        break;
      }
      thrownAway.push({ ...lost.thrower, afterStop: stops.length });
      // A keyboard user is stuck here; the walk goes on from the next element that keeps focus, to see the rest.
      state = lost.next ? await page.evaluate((place) => (window as unknown as { __loepm: { resolveWhere: (place: string) => HTMLElement | null } }).__loepm.resolveWhere(place)?.focus(), lost.next).then(() => call<(Record<string, unknown> & { path: string[] }) | null>(page, "focusState")) : null;
      if (state === null) {
        outcome = "focus-lost";
        break;
      }
      afterFocusLoss = true;
    }
    // Focus alone must not move the user somewhere else (WCAG 3.2.1).
    if (page.url() !== startUrl) {
      outcome = "navigated-on-focus";
      stops.push({ ...state, index, navigatedTo: page.url() });
      focused.push(null);
      break;
    }
    const own = state.path.join(" >>> ");
    // Focus inside a frame: the place is the frame plus the element inside it, so the next control in the same frame is a new place.
    const inFrame = state.tag === "iframe" || state.tag === "frame" ? await focusInsideFrame(page) : null;
    const key = inFrame ? `${own} >>> (frame) ${inFrame.key}` : own;
    const last = stops.at(-1);
    if (!inFrame && last && (last.path as string[]).join(" >>> ") === own) {
      // Still on the same element: the browser's own controls inside a player or a date field, up to what such an element can hold.
      const inside = ((last.internalStops as number | undefined) ?? 0) + 1;
      if (inside <= (await internalStops(page))) {
        last.internalStops = inside;
        continue;
      }
    }
    const visits = (seen.get(key) ?? 0) + 1;
    seen.set(key, visits);
    firstKey ??= key;
    if (visits === 2 && stops.length > 0 && key === firstKey) {
      outcome = "completed";
      break;
    }
    if (visits >= 3) {
      outcome = "trapped";
      stops.push({ ...state, index });
      focused.push(null);
      break;
    }
    const previous = stops.at(-1);
    if (inFrame && previous && (previous.path as string[]).join(" >>> ") === own && Array.isArray(previous.frameStops)) {
      // Still in the same frame: one Tab stop of the page, with the places inside it listed.
      (previous.frameStops as FrameStop[]).push(inFrame.stop);
      continue;
    }
    const stop: Record<string, unknown> = { ...state, index, ...(inFrame ? { frameStops: [inFrame.stop] } : {}), ...(afterFocusLoss ? { reachedAfterFocusLoss: true } : {}) };
    stops.push(stop);
    focused.push(await capture(stop));
  }

  // The same properties without focus, to tell whether focus changes anything visible.
  const unfocused = (await page.evaluate((refs) => {
    const library = (window as unknown as { __loep: { registry: Element[]; deepActiveElement: () => HTMLElement | null } }).__loep;
    library.deepActiveElement()?.blur();
    const registry = library.registry;
    return refs.map((ref) => {
      const element = registry[ref];
      if (!element) return null;
      const style = getComputedStyle(element);
      return { outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, boxShadow: style.boxShadow };
    });
  }, stops.map((stop) => stop.ref as number))) as ({ outline: string; boxShadow: string } | null)[];
  for (const [index, stop] of stops.entries()) {
    const rest = unfocused[index];
    stop.unfocusedOutline = rest?.outline ?? null;
    stop.unfocusedBoxShadow = rest?.boxShadow ?? null;
    stop.styleChanges = rest ? rest.outline !== stop.outline || rest.boxShadow !== stop.boxShadow : null;
    // The measurement that counts: does the region look different with focus than without?
    const withFocus = focused[index] ?? null;
    stop.focusPixelShare = null;
    if (withFocus) {
      const [x, y] = stop.scroll as [number, number];
      await page.evaluate(([left, top]) => window.scrollTo({ left: left!, top: top!, behavior: "instant" }), [x, y]);
      const without = await page.screenshot({ clip: focusClip(stop.viewportBox as Clip, viewport)!, animations: "disabled" });
      const painted = await call<Painted | null>(page, "paintedBox", stop.ref);
      if (stop.clipVerified && !(painted !== null && sameBox(painted.viewportBox, stop.viewportBox as Clip))) {
        stop.clipVerified = false;
        stop.focusNotMeasured = MOVED;
      }
      // No number without a verified clip: "nothing changed" would then describe some other part of the page.
      const measured = stop.clipVerified ? focusIndicator(PNG.sync.read(withFocus), PNG.sync.read(without)) : null;
      stop.focusPixelShare = measured?.changedShare ?? null;
      stop.indicatorColour = measured?.indicator ? `#${measured.indicator.map((value) => value.toString(16).padStart(2, "0")).join("")}` : null;
      stop.indicatorOver = measured?.replaced ? `#${measured.replaced.map((value) => value.toString(16).padStart(2, "0")).join("")}` : null;
      stop.indicatorRatio = measured?.ratio ?? null;
      const name = `${String(index + 1).padStart(3, "0")}.png`;
      await writeFileAtomic(join(focusDir, name), withFocus);
      stop.focusScreenshot = `${focusPath}/${name}`;
    }
  }
  return { outcome, stopCount: stops.length, initialFocus, stops, ...(thrownAway.length > 0 ? { focusThrownAwayBy: thrownAway } : {}) };
}

const MAX_ARROW_STEPS = 40;
const ARROW_SKIP = new Set(["input", "textarea", "select"]);

/**
 * Lists, menus and tab sets are one Tab stop; their items are reached with the arrow
 * keys. From every Tab stop, press the arrow keys and record where focus goes, so an
 * element that Tab skips is only reported as unreachable when the arrows skip it too.
 */
export async function arrowReach(page: Page, stops: { path: string[]; tag: string }[]): Promise<Record<string, unknown>[]> {
  const reach: Record<string, unknown>[] = [];
  const seen = new Set(stops.map((stop) => stop.path.join(" >>> ")));
  for (const stop of stops) {
    if (ARROW_SKIP.has(stop.tag)) continue;
    for (const key of ["ArrowDown", "ArrowRight"] as const) {
      const focused = await page.evaluate((chain) => {
        const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
        element?.focus();
        return element !== null;
      }, stop.path);
      if (!focused) break;
      const reached: { tag: string; text: string; where: string; region: string | null }[] = [];
      let previous = stop.path.join(" >>> ");
      for (let step = 0; step < MAX_ARROW_STEPS; step++) {
        await page.keyboard.press(key);
        const state = await call<{ path: string[]; tag: string; text: string; region: string | null } | null>(page, "focusState");
        const here = state?.path.join(" >>> ");
        if (!state || !here || here === previous || seen.has(here)) break;
        seen.add(here);
        reached.push({ tag: state.tag, text: state.text.slice(0, 60), where: here, region: state.region });
        previous = here;
      }
      if (reached.length > 0) {
        reach.push({ from: stop.path.join(" >>> "), key, reached });
        break;
      }
    }
  }
  return reach;
}

/** A tab stop as the numbered picture needs it: where it was measured, at which scroll position, and the element itself. */
interface DrawnStop {
  box: Clip;
  scroll?: [number, number];
  ref?: number;
}

/**
 * Number every tab stop on a screenshot, so the order can be judged at a glance.
 *
 * The full-page picture shows the page as it lies at scroll position 0. Each box was measured
 * during the walk, with the page scrolled to wherever focus was. For most elements that makes
 * no difference, but a sticky or fixed element moves with the scroll position: measured halfway
 * down, its box lies halfway down, while the picture shows it at the top. So every box is moved
 * by as much as its element moves between the scroll position it was measured at and the top.
 * An element that moved for another reason, such as a skip link that only shows with focus,
 * keeps the box it had with focus.
 */
export async function tabOrderScreenshot(page: Page, stops: Record<string, unknown>[], path: string): Promise<void> {
  await page.evaluate((drawn) => {
    // Instant: a page with scroll-behavior:smooth would otherwise still be on its way up when the picture is taken.
    const scrollTo = (left: number, top: number): void => window.scrollTo({ left, top, behavior: "instant" });
    const registry = (window as unknown as { __loep?: { registry: Element[] } }).__loep?.registry ?? [];
    const at = (element: Element, left: number, top: number): { x: number; y: number } => {
      scrollTo(left, top);
      const rect = element.getBoundingClientRect();
      return { x: rect.x + window.scrollX, y: rect.y + window.scrollY };
    };
    const boxes = drawn.map(({ box, scroll, ref }) => {
      const element = ref === undefined ? undefined : registry[ref];
      if (!element?.isConnected || !scroll) return box;
      const then = at(element, scroll[0], scroll[1]);
      const top = at(element, 0, 0);
      return { ...box, x: box.x + Math.round(top.x - then.x), y: box.y + Math.round(top.y - then.y) };
    });
    scrollTo(0, 0);
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    document.body.append(layer);
    // A positioned body with a margin moves the layer away from the top left corner of the page.
    const origin = layer.getBoundingClientRect();
    boxes.forEach((box, index) => {
      const frame = document.createElement("div");
      frame.style.cssText = `position:absolute;left:${box.x - origin.x}px;top:${box.y - origin.y}px;width:${box.width}px;height:${box.height}px;outline:2px solid #c4008f;`;
      const label = document.createElement("span");
      label.textContent = String(index + 1);
      label.style.cssText = "position:absolute;left:-2px;top:-2px;background:#c4008f;color:#fff;font:bold 12px/1.3 sans-serif;padding:0 4px;";
      frame.append(label);
      layer.append(frame);
    });
  }, stops.map((stop) => ({ box: stop.box, scroll: stop.scroll, ref: stop.ref }) as DrawnStop));
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
}

const SKIP_LINK = /sla over|direct naar|naar (de )?(hoofd)?inhoud|skip|ga naar/i;

/** Activate the first tab stop if it is a skip link and record where that takes the user (WCAG 2.4.1). */
export async function skipLinkProbe(page: Page): Promise<Record<string, unknown>> {
  await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" }));
  await page.keyboard.press("Tab");
  const first = await call<(Record<string, unknown> & { text: string }) | null>(page, "focusState");
  if (!first || !SKIP_LINK.test(first.text)) return { firstTabStop: first, isSkipLink: false };
  const before = await page.evaluate(() => ({ scrollY: window.scrollY, hash: location.hash }));
  // Read where the link points while it still has focus: after Enter the focus is somewhere else, or nowhere.
  const aim = await call<Record<string, unknown> | null>(page, "skipLinkTarget");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const afterActivation = await call<Record<string, unknown> | null>(page, "focusState");
  const after = await page.evaluate(() => ({ scrollY: window.scrollY, hash: location.hash }));
  await page.keyboard.press("Tab");
  const nextStop = await call<Record<string, unknown> | null>(page, "focusState");
  return { firstTabStop: first, isSkipLink: true, before, after, aim, focusAfterActivation: afterActivation, nextTabStop: nextStop };
}

/** One place focus went to in a walk with one key, and what lay over its middle. */
export interface CoverStop {
  index: number;
  tag: string;
  text: string;
  where: string;
  region: string | null;
  roleAttr: string | null;
  inViewport: boolean;
  /** The element painted over the middle of the focused one; null when the middle is free. */
  coveredBy: string | null;
  /** A picture of the focused element with its margin, only when something lay over it. */
  screenshot?: string;
}

export interface CoverWalk {
  key: "Shift+Tab" | "ArrowDown" | "ArrowUp";
  /** Where focus was when the walk began. */
  from: string | null;
  /** "completed": focus came back to where it was or left the document; "stuck": the key did not move it; "limit-reached". */
  outcome: "completed" | "stuck" | "limit-reached";
  stops: CoverStop[];
}

/** Roles of items that are reached with the arrow keys inside one Tab stop. */
const ARROW_ITEM = new Set(["menuitem", "menuitemradio", "menuitemcheckbox", "option", "tab", "treeitem", "radio", "gridcell", "row"]);
const COVER_STOPS = 60;
const ARROW_STOPS = 30;
const ARROW_STARTS = 3;

type FocusNow = { path: string[]; tag: string; text: string; region: string | null; roleAttr: string | null; inViewport: boolean; viewportBox: Clip; coveredBy: string[] | null };

/**
 * Walk with one key from where focus is now and note at each stop what lies over the middle
 * of the focused element (WCAG 2.4.11). Covered stops get a picture. Focus is not put anywhere first.
 */
export async function coverWalk(page: Page, key: CoverWalk["key"], options: { max: number; dir: string; relative: string; prefix: string }): Promise<CoverWalk> {
  const viewport = page.viewportSize() ?? RENDERING.viewport;
  const start = await call<FocusNow | null>(page, "focusState");
  const stops: CoverStop[] = [];
  const visited = new Set<string>();
  let previous = start?.path.join(" >>> ") ?? null;
  let outcome: CoverWalk["outcome"] = "limit-reached";
  for (let index = 0; index < options.max; index++) {
    await page.keyboard.press(key);
    const state = await call<FocusNow | null>(page, "focusState");
    if (!state) {
      outcome = "completed";
      break;
    }
    const where = state.path.join(" >>> ");
    if (where === previous) {
      outcome = key === "Shift+Tab" ? "completed" : "stuck";
      break;
    }
    if (visited.has(where) || where === start?.path.join(" >>> ")) {
      outcome = "completed";
      break;
    }
    visited.add(where);
    previous = where;
    const stop: CoverStop = { index, tag: state.tag, text: String(state.text ?? "").slice(0, 60), where, region: state.region, roleAttr: state.roleAttr ?? null, inViewport: state.inViewport, coveredBy: state.coveredBy ? state.coveredBy.join(" >>> ") : null };
    if (stop.coveredBy) {
      const clip = state.inViewport ? focusClip(state.viewportBox, viewport) : null;
      if (clip) {
        const name = `${options.prefix}-${String(index + 1).padStart(3, "0")}.png`;
        await writeFileAtomic(join(options.dir, name), await page.screenshot({ clip, animations: "disabled" }));
        stop.screenshot = `${options.relative}/${name}`;
      }
    }
    stops.push(stop);
  }
  return { key, from: start?.path.join(" >>> ") ?? null, outcome, stops };
}

/**
 * In an opened state: walk back with Shift+Tab from where focus is after opening, and with the
 * arrow keys down and up from there and from the first items of a menu, list or tab set that the
 * walk met. At each stop: what lies over the middle of the focused element (WCAG 2.4.11).
 */
export async function focusCoveredInState(page: Page, dir: string, relative: string): Promise<{ walks: CoverWalk[] }> {
  const start = await call<FocusNow | null>(page, "focusState");
  const refocus = (path: string[] | null): Promise<boolean> =>
    path === null
      ? page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), true))
      : page.evaluate((chain) => {
          const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
          element?.focus();
          return element !== null;
        }, path);
  const walks: CoverWalk[] = [await coverWalk(page, "Shift+Tab", { max: COVER_STOPS, dir, relative, prefix: "terug" })];
  const starts: (string[] | null)[] = [start?.path ?? null];
  for (const stop of walks[0]!.stops) if (stop.roleAttr && ARROW_ITEM.has(stop.roleAttr) && starts.length <= ARROW_STARTS) starts.push(stop.where.split(" >>> "));
  for (const [number, from] of starts.entries()) {
    for (const key of ["ArrowDown", "ArrowUp"] as const) {
      if (!(await refocus(from))) continue;
      const walk = await coverWalk(page, key, { max: ARROW_STOPS, dir, relative, prefix: `${key === "ArrowDown" ? "omlaag" : "omhoog"}-${number + 1}` });
      if (walk.stops.length > 0) walks.push(walk);
    }
  }
  return { walks };
}
