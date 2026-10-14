import type { Page } from "playwright";
import type { MethodResult } from "../methods.ts";
import { ensureHelpers, inCapsule, packageSource } from "./capsule.ts";
import { idOf } from "./registry.ts";

export interface TabStop {
  /** Where focus is: through shadow roots and into frames of the same origin. */
  where: string;
  tag: string;
  text: string;
}

/** How many presses in a row may stay on one element before the walk is called stuck. A media player has about eight controls. */
const MAX_INSIDE = 14;

export interface TabOrder {
  outcome: "completed" | "limit-reached" | "trapped" | "predicted";
  /** The key that moved focus. */
  key: string;
  stops: TabStop[];
}

interface Helpers {
  focusedWhere: () => TabStop | null;
  resolveWhere: (where: string) => HTMLElement | null;
}


/** The place that has focus inside a frame, written through the frame; null when nothing in it has focus. */
async function insideFrame(page: Page, frameStop: TabStop): Promise<TabStop | null> {
  try {
    const handle = await page.evaluateHandle((where) => (window as unknown as { __loepm: Helpers }).__loepm.resolveWhere(where), frameStop.where);
    const frame = await handle.asElement()?.contentFrame();
    if (!frame) return null;
    const inner = await frame.evaluate(() => {
      const state = (window as unknown as { __loep?: { focusState: () => { path: string[]; tag: string; text: string } | null } }).__loep?.focusState() ?? null;
      return state ? { where: state.path.join(" >>> "), tag: state.tag, text: state.text.slice(0, 60) } : null;
    });
    return inner ? { where: `${frameStop.where} | ${inner.where}`, tag: inner.tag, text: inner.text } : null;
  } catch {
    return null;
  }
}

/**
 * Walk a page with real key presses and note where focus goes: no pictures, only the order.
 * This is what runs in the second browsers, where the question is whether the same elements
 * are reached in the same order.
 */
export async function lightWalk(page: Page, options: { key: string; max: number; from?: string | undefined }): Promise<TabOrder> {
  await ensureHelpers(page);
  let startOn: TabStop | null = null;
  if (options.from) {
    // The walk starts on the element itself: focus goes one stop back, so that the first press lands on it.
    const taken = await page.evaluate((where) => {
      const element = (window as unknown as { __loepm: Helpers }).__loepm.resolveWhere(where);
      element?.focus();
      return element !== null && document.activeElement === element;
    }, options.from);
    if (taken) {
      await page.keyboard.press(options.key.replace(/Tab$/, "Shift+Tab"));
      // The stop before it may throw focus away, or there may be none; then the walk starts on the element by giving it focus again.
      const before = await page.evaluate(() => (window as unknown as { __loepm: Helpers }).__loepm.focusedWhere());
      if (before === null || before.where === options.from) {
        startOn = await page.evaluate((where) => {
          const library = (window as unknown as { __loepm: Helpers }).__loepm;
          library.resolveWhere(where)?.focus();
          return library.focusedWhere();
        }, options.from);
      }
    }
  } else {
    // Start at the top of the document: a browser continues from where focus last was.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const previous = document.body.getAttribute("tabindex");
      document.body.setAttribute("tabindex", "-1");
      document.body.focus({ preventScroll: true });
      if (previous === null) document.body.removeAttribute("tabindex");
      else document.body.setAttribute("tabindex", previous);
    });
  }
  const stops: TabStop[] = [];
  const seen = new Map<string, number>();
  let first: string | null = null;
  let inside = 0;
  let outcome: TabOrder["outcome"] = "limit-reached";
  if (startOn) {
    stops.push(startOn);
    seen.set(startOn.where, 1);
    first = startOn.where;
  }
  for (let index = stops.length; index < options.max; index++) {
    await page.keyboard.press(options.key);
    let stop = await page.evaluate(() => (window as unknown as { __loepm: Helpers }).__loepm.focusedWhere());
    // Focus inside a frame of another origin cannot be read from the page itself; the frame is asked.
    if (stop && (stop.tag === "iframe" || stop.tag === "frame") && !stop.where.includes(" | ")) stop = (await insideFrame(page, stop)) ?? stop;
    if (stop === null) {
      // Focus left the document for the browser's own controls.
      if (stops.length > 0) {
        outcome = "completed";
        break;
      }
      continue;
    }
    // A video or audio player with controls, or a frame of another origin, holds several stops of its own that all read as
    // the same element from outside. Staying there for a number of presses is walking through those, not being stuck.
    if (stops.at(-1)?.where === stop.where && stops.length > 0) {
      inside++;
      if (inside > MAX_INSIDE) {
        outcome = "trapped";
        break;
      }
      continue;
    }
    inside = 0;
    const visits = (seen.get(stop.where) ?? 0) + 1;
    seen.set(stop.where, visits);
    first ??= stop.where;
    if (visits === 2 && stop.where === first) {
      outcome = "completed";
      break;
    }
    if (visits >= 3) {
      outcome = "trapped";
      break;
    }
    if (visits === 1) stops.push(stop);
  }
  return { outcome, key: options.key, stops };
}

const TABBABLE_BODY = `() => tabbable.tabbable(document.documentElement, { getShadowRoot: true, displayCheck: "full" }).map((element) => ({
  where: __loepm.where(element),
  tag: element.localName,
  text: (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 60),
}))`;

/** The tab order that the DOM predicts, without a key being pressed. It does not look inside frames. */
export async function predictedOrder(page: Page): Promise<TabOrder> {
  const stops = await inCapsule<TabStop[]>(page, [packageSource("tabbable/dist/index.umd.js")], TABBABLE_BODY);
  return { outcome: "predicted", key: "(geen)", stops };
}

/** The order of the existing Chromium walk in the same form: one entry per place, places inside a frame under the frame. */
export function orderFromWalk(walk: { outcome: string; initialFocus?: { path: string[]; tag: string; text: string } | null; stops: { path: string[]; tag: string; text: string; frameStops?: { path: string[]; tag: string; text: string }[] }[] }): TabOrder {
  const stops: TabStop[] = [];
  // An element that had focus before the first Tab and that the walk did not come back to is reachable all the same: focus was on it.
  const initial = walk.initialFocus;
  if (initial && initial.path.length > 0 && !walk.stops.some((stop) => stop.path.join(" >>> ") === initial.path.join(" >>> "))) stops.push({ where: initial.path.join(" >>> "), tag: initial.tag, text: initial.text.slice(0, 60) });
  for (const stop of walk.stops) {
    const own = stop.path.join(" >>> ");
    const inner = (stop.frameStops ?? []).filter((frameStop) => frameStop.path.length > 0);
    if (inner.length === 0) stops.push({ where: own, tag: stop.tag, text: stop.text.slice(0, 60) });
    for (const frameStop of inner) stops.push({ where: `${own} | ${frameStop.path.join(" >>> ")}`, tag: frameStop.tag, text: frameStop.text.slice(0, 60) });
  }
  return { outcome: walk.outcome as TabOrder["outcome"], key: "Tab", stops };
}

/** The stops as the page itself has them: a place inside a frame counts as the frame, once. */
function topLevel(order: TabOrder): string[] {
  const out: string[] = [];
  for (const stop of order.stops) {
    const top = stop.where.split(" | ")[0]!;
    if (out.at(-1) !== top) out.push(top);
  }
  return out;
}

export interface OrderComparison {
  /** Methods that give the same order, grouped; one group means they agree. */
  groups: { by: string[]; stops: number }[];
  differences: string[];
  /** Differences that are known to exist between browsers and between a prediction and a browser; they are named and are no contradiction. */
  known: string[];
}

const MAX_NAMED = 8;
const named = (places: string[]): string => `${places.slice(0, MAX_NAMED).join(", ")}${places.length > MAX_NAMED ? ` (+${places.length - MAX_NAMED})` : ""}`;
const KIND_NL: Record<string, string> = {
  changed: "de pagina heeft dit element zelf vervangen terwijl er gemeten werd (een blok dat wisselt)", frame: "een frame: de ene browser stopt op het frame zelf, de andere niet, en een voorspelling kijkt er niet in", "scroll-region": "een scrollbaar vlak zonder tabindex: een stop in Chromium en Firefox, niet in WebKit en niet in een voorspelling" };

/**
 * Set the orders next to each other at the level of the page. The first method is the one
 * the others are described against; that makes it the reference for the wording, not the truth.
 * A walk that stopped at its limit is compared over the stops it made. A stop of a kind in
 * `kinds` is left out of the comparison and reported as a known difference.
 */
export function compareOrders(methods: MethodResult<TabOrder>[], kinds: Map<string, string> = new Map()): OrderComparison {
  const raw = methods.map((method) => ({ id: idOf(method), outcome: method.result.outcome, all: topLevel(method.result) }));
  const known: string[] = [];
  const first = raw[0];
  if (first) {
    for (const order of raw.slice(1)) {
      for (const kind of new Set(kinds.values())) {
        const ofKind = (stops: string[]): string[] => stops.filter((stop) => kinds.get(stop) === kind);
        const missing = ofKind(first.all).filter((stop) => !order.all.includes(stop));
        const extra = ofKind(order.all).filter((stop) => !first.all.includes(stop));
        if (missing.length + extra.length === 0) continue;
        known.push(`${order.id} tegenover ${first.id}: ${[missing.length > 0 ? `zonder ${named(missing)}` : null, extra.length > 0 ? `met ${named(extra)}` : null].filter(Boolean).join(" en ")}; bekend verschil, ${KIND_NL[kind] ?? kind}`);
      }
    }
  }
  const orders = raw.map((order) => ({ ...order, all: order.all.filter((stop) => !kinds.has(stop)) }));
  const limit = Math.min(...orders.filter((order) => order.outcome === "limit-reached").map((order) => order.all.length), Number.POSITIVE_INFINITY);
  const cut = orders.map((order) => ({ ...order, stops: Number.isFinite(limit) ? order.all.slice(0, limit) : order.all }));
  const groups: { by: string[]; stops: number; key: string }[] = [];
  for (const order of cut) {
    const key = order.stops.join("\n");
    const group = groups.find((entry) => entry.key === key);
    if (group) group.by.push(order.id);
    else groups.push({ by: [order.id], stops: order.stops.length, key });
  }
  const differences: string[] = [];
  const reference = cut[0];
  if (reference && groups.length > 1) {
    for (const order of cut.slice(1)) {
      if (order.stops.join("\n") === reference.stops.join("\n")) continue;
      // A stop is missing when the other method never reaches it, also not after the point where the comparison was cut off.
      const everInOrder = new Set(order.all);
      const missing = reference.stops.filter((stop) => !everInOrder.has(stop));
      // What the other method has more only counts when the reference walked to the end: past its limit nobody knows what it would have reached.
      const everInReference = new Set(reference.all);
      const extra = reference.outcome === "limit-reached" ? [] : order.stops.filter((stop) => !everInReference.has(stop));
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`andere stops, zonder ${named(missing)}`);
      if (extra.length > 0) parts.push(`${missing.length > 0 ? "en " : "andere stops, "}met ${named(extra)}`);
      if (parts.length === 0) {
        const common = new Set(order.stops.filter((stop) => reference.stops.includes(stop)));
        const [ours, theirs] = [reference.stops.filter((stop) => common.has(stop)), order.stops.filter((stop) => common.has(stop))];
        const at = theirs.findIndex((stop, index) => stop !== ours[index]);
        if (at < 0) continue;
        parts.push(`dezelfde stops in een andere volgorde, vanaf stop ${at + 1}: ${theirs[at]} in plaats van ${ours[at]}`);
      }
      differences.push(`${order.id} tegenover ${reference.id}: ${parts.join(" ")}`);
    }
  }
  // Methods whose orders differ only past the point where a walk was cut off do not contradict each other.
  const merged = differences.length === 0 ? [{ by: groups.flatMap((group) => group.by), stops: reference?.stops.length ?? 0 }] : groups.map(({ by, stops }) => ({ by, stops }));
  return { groups: merged, differences, known };
}
