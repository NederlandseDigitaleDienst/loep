import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../browser/call.ts";
import { contrastRatio, floorRatio, ringColour, type Region, type Rgb } from "../lib/contrast.ts";
import { FLAT_BACKGROUND_SHARE, measureGraphic, NON_TEXT_RATIO, type Graphic, type Positioned } from "./contrast.ts";
import { focusIndicatorOf } from "./focus.ts";

/**
 * The two ways a user can ask the browser for other colours that Playwright can imitate:
 * forced colours (the high contrast mode of Windows) and the wish for more contrast.
 */
export type ColourMode = "forced-colors" | "more-contrast";

/** What became of something between the page as it is and the page in the mode. */
export type Fate =
  /** Visible in both. */
  | "stays"
  /** Visible on the page as it is, not in the mode. */
  | "disappears"
  /** Not visible on the page as it is, visible in the mode: the mode adds it. */
  | "appears"
  /** Visible in neither: nothing that the mode took away. */
  | "absent"
  /** Not measured in one of the two: the surroundings are not one colour, or the element was not there. */
  | "unknown";

export interface Boundary {
  /** The colour around the element, a few pixels outside what a border, outline or shadow draws. */
  outside: string | null;
  /** The colour at or around the edge that stands out most from it. */
  strongest: string | null;
  /** Contrast between the two, rounded down; null when the surroundings are not one colour. */
  ratio: number | null;
}

export interface Drawing {
  background: string | null;
  foreground: string | null;
  ratio: number | null;
}

export interface FocusSeen {
  focusable: boolean;
  /** Share of the pixels around the element that look different with focus; null when not measured. */
  pixelShare: number | null;
  ratio: number | null;
  outline: string | null;
  boxShadow: string | null;
}

export interface ModeControl {
  tag: string;
  text: string;
  where: string;
  box: Region;
  boundary: { before: Boundary; after: Boundary | null; fate: Fate };
  /** Only for a control that was asked to take focus. */
  focus?: { before: FocusSeen; after: FocusSeen | null; fate: Fate };
}

export interface ModeGraphic {
  tag: string;
  where: string;
  box: Region;
  /** The control the drawing is in, and whether that control has text besides it. */
  inControl: string | null;
  controlHasText: boolean | null;
  drawing: { before: Drawing; after: Drawing | null; fate: Fate };
}

export interface ModeAnswer {
  mode: ColourMode;
  /** Whether the page saw the mode: its own media query says so. */
  applied: boolean;
  controls: ModeControl[];
  graphics: ModeGraphic[];
  /** Controls that were not asked to take focus because the limit was reached. */
  focusNotMeasured: number;
  /** A picture of the whole page in the mode; null when none was kept. */
  image: string | null;
  ms: number;
}

/** A share of changed pixels below this is no visible focus indicator; the same limit the Tab walk of the sweep is read with. */
export const FOCUS_VISIBLE_SHARE = 0.005;
/** How far outside the box the surroundings are read: past a ring that a box-shadow or an outline with an offset draws. */
const OUTSIDE = 6;
/** Where a boundary can be drawn: just outside the box (shadow, outline), on its edge (border) and just inside it. */
const EDGES = [4, 3, 2, 1, 0, -1, -2];

/** How far inside a control without text its drawing is read. */
const BORDER = 4;

const hex = (colour: Rgb): string => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/**
 * How clearly the boundary of a control stands out from what is around it, as the measurement for
 * WCAG 1.4.11 does: colours read from the pixels on rings around the box. Unlike that measurement
 * it also looks just outside the box, where a boundary made with box-shadow or outline is drawn.
 */
export function boundaryOf(image: PNG, box: Region): Boundary {
  const outside = ringColour(image, box, OUTSIDE);
  if (!outside || outside.share < FLAT_BACKGROUND_SHARE) return { outside: null, strongest: null, ratio: null };
  const fill = -Math.min(4, Math.floor(Math.min(box.width, box.height) / 4));
  let best: { colour: Rgb; ratio: number } | null = null;
  for (const offset of [...EDGES, fill]) {
    const ring = ringColour(image, box, offset);
    if (!ring) continue;
    const ratio = contrastRatio(ring.colour, outside.colour);
    if (!best || ratio > best.ratio) best = { colour: ring.colour, ratio };
  }
  return best ? { outside: hex(outside.colour), strongest: hex(best.colour), ratio: floorRatio(best.ratio) } : { outside: hex(outside.colour), strongest: null, ratio: null };
}

/** What became of something that is visible when its ratio reaches 3 to 1. */
export function fateOf(before: number | null, after: number | null | undefined, known = true): Fate {
  if (!known || after === undefined) return "unknown";
  const was = before !== null && before >= NON_TEXT_RATIO;
  const is = after !== null && after >= NON_TEXT_RATIO;
  return was ? (is ? "stays" : "disappears") : is ? "appears" : "absent";
}

interface Seen {
  controls: Map<string, { item: Positioned; boundary: Boundary; focus?: FocusSeen }>;
  graphics: Map<string, { item: Graphic; drawing: Drawing }>;
  picture: Buffer;
  focusNotMeasured: number;
}

const within = (inner: Region, outer: Region): boolean => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

/** Everything measured on the page as it is painted now: the boundary of each control, each small drawing, and the focus indicator of the first controls. */
async function see(page: Page, options: { only: string[] | null; maxFocus: number; scratch: string }): Promise<Seen> {
  const same = (item: { path: string[] }): boolean => options.only === null || item.path.join(" >>> ") === options.only.join(" >>> ");
  const allControls = await call<Positioned[]>(page, "hoverTargets");
  const allGraphics = await call<Graphic[]>(page, "graphicBoxes");
  const picture = await page.screenshot({ fullPage: true, animations: "disabled" });
  const image = PNG.sync.read(picture);
  const controls = allControls.filter(same);
  // With one element asked for, its drawings are the ones that lie within it, and the element itself when it is one.
  const graphics = options.only === null ? allGraphics : allGraphics.filter((graphic) => same(graphic) || controls.some((control) => within(graphic.box, control.box)));
  // A control without text and without an image in it shows a drawing made in CSS, as a background or a mask: it is measured as a drawing itself.
  // Read a few pixels in, past the border of the control: the border is its boundary, not its drawing.
  const inner = (box: Region): Region => (Math.min(box.width, box.height) >= 4 * BORDER ? { x: box.x + BORDER, y: box.y + BORDER, width: box.width - 2 * BORDER, height: box.height - 2 * BORDER } : box);
  const drawn: Graphic[] = controls.filter((control) => control.text === "" && !allGraphics.some((graphic) => within(graphic.box, control.box))).map((control) => ({ ...control, box: inner(control.box), inControl: `${control.tag}: ""`, controlHasText: false }));
  const seen: Seen = { controls: new Map(), graphics: new Map(), picture, focusNotMeasured: Math.max(0, controls.length - options.maxFocus) };
  for (const item of controls) seen.controls.set(item.path.join(" >>> "), { item, boundary: boundaryOf(image, item.box) });
  for (const item of [...graphics, ...drawn]) {
    const measured = measureGraphic(item, image);
    seen.graphics.set(item.path.join(" >>> "), { item, drawing: { background: measured.background, foreground: measured.foreground, ratio: measured.ratio } });
  }
  for (const item of controls.slice(0, options.maxFocus)) {
    const focused = await focusIndicatorOf(page, item.path, { focused: join(options.scratch, "focused.png"), unfocused: join(options.scratch, "unfocused.png") }).catch(() => null);
    if (!focused) continue;
    // A picture that could not be compared says nothing about the indicator.
    const measured = focused.focusable && focused.clipVerified;
    seen.controls.get(item.path.join(" >>> "))!.focus = { focusable: focused.focusable, pixelShare: measured ? focused.focusPixelShare : null, ratio: measured ? focused.indicatorRatio : null, outline: focused.outline, boxShadow: focused.boxShadow };
  }
  return seen;
}

/** What became of a focus indicator: visible is a share of changed pixels at or above the limit. */
function focusFate(before: FocusSeen, after: FocusSeen | undefined): Fate {
  if (!after || !before.focusable || before.pixelShare === null || after.pixelShare === null) return "unknown";
  const was = before.pixelShare >= FOCUS_VISIBLE_SHARE;
  const is = after.pixelShare >= FOCUS_VISIBLE_SHARE;
  return was ? (is ? "stays" : "disappears") : is ? "appears" : "absent";
}

/**
 * Look at the page as it is, then again with forced colours or with the wish for more contrast,
 * and say what the mode took away: the boundary of a control, a focus indicator, a drawing.
 * A browser in forced colours drops box-shadow and paints its own colours over backgrounds, so
 * whatever was made only with those is gone. The page is put back as it was; the element that
 * was asked to take focus last may keep what focus set off.
 *
 * Forced colours are no requirement of WCAG: what disappears is a lead, not a failure.
 */
export async function colourModeView(page: Page, mode: ColourMode, options: { only?: string[] | null; maxFocus: number; image: string | null; focusImage?: string }): Promise<ModeAnswer> {
  const started = Date.now();
  // The pictures with and without focus are compared and thrown away; only the one of a single element in the mode is kept.
  const scratch = await mkdtemp(join(tmpdir(), "loep-mode-"));
  const settings = { only: options.only ?? null, maxFocus: options.maxFocus, scratch };
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY] as [number, number]);
  const blur = (): Promise<void> => page.evaluate(() => (window as unknown as { __loep: { deepActiveElement: () => HTMLElement | null } }).__loep.deepActiveElement()?.blur());
  let before: Seen;
  let after: Seen;
  let applied: boolean;
  try {
    // Without focus anywhere: a focus ring that happens to be on the page is not a boundary.
    await blur();
    before = await see(page, settings);
    await blur();
    await page.emulateMedia(mode === "forced-colors" ? { forcedColors: "active" } : { contrast: "more" });
    applied = await page.evaluate((query) => matchMedia(query).matches, mode === "forced-colors" ? "(forced-colors: active)" : "(prefers-contrast: more)");
    after = await see(page, settings);
    if (options.focusImage && [...after.controls.values()].some((control) => control.focus?.pixelShare !== null && control.focus?.pixelShare !== undefined)) await copyFile(join(scratch, "focused.png"), options.focusImage);
    await blur();
  } finally {
    await page.emulateMedia({ forcedColors: null, contrast: null }).catch(() => undefined);
    await page.evaluate(([x, y]) => window.scrollTo({ left: x!, top: y!, behavior: "instant" }), scroll).catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
  if (options.image) await writeFile(options.image, after.picture);
  const controls: ModeControl[] = [...before.controls.entries()].map(([where, { item, boundary, focus }]) => {
    const later = after.controls.get(where);
    return {
      tag: item.tag,
      text: item.text.slice(0, 60),
      where,
      box: item.box,
      boundary: { before: boundary, after: later?.boundary ?? null, fate: fateOf(boundary.ratio, later?.boundary.ratio, boundary.outside !== null && later !== undefined && later.boundary.outside !== null) },
      ...(focus ? { focus: { before: focus, after: later?.focus ?? null, fate: focusFate(focus, later?.focus) } } : {}),
    };
  });
  const graphics: ModeGraphic[] = [...before.graphics.entries()].map(([where, { item, drawing }]) => {
    const later = after.graphics.get(where);
    return { tag: item.tag, where, box: item.box, inControl: item.inControl, controlHasText: item.controlHasText, drawing: { before: drawing, after: later?.drawing ?? null, fate: fateOf(drawing.ratio, later?.drawing.ratio, later !== undefined && later.drawing.background !== null) } };
  });
  return { mode, applied, controls, graphics, focusNotMeasured: before.focusNotMeasured, image: options.image, ms: Date.now() - started };
}

/** What the sweep keeps of a page seen with forced colours: only what disappeared, and how much was looked at. */
export interface ForcedProbe {
  controls: number;
  drawings: number;
  boundaryDisappears: { tag: string; text: string; where: string; box: Region; before: number | null; after: number | null }[];
  drawingsDisappear: { tag: string; where: string; box: Region; inControl: string | null; controlHasText: boolean | null; before: number | null }[];
  ms: number;
}

/**
 * The fixed probe of the sweep: the boundaries of controls and the small drawings of a page, as it is
 * and with forced colours. The focus indicators are left out: giving every control focus twice takes
 * about a third of a second per control, where this takes a few tenths of a second per page.
 */
export async function forcedColoursProbe(page: Page): Promise<ForcedProbe | { error: string }> {
  try {
    const seen = await colourModeView(page, "forced-colors", { maxFocus: 0, image: null });
    if (!seen.applied) return { error: "de browser nam de geforceerde kleuren niet aan" };
    return {
      controls: seen.controls.length,
      drawings: seen.graphics.length,
      boundaryDisappears: seen.controls.filter((control) => control.boundary.fate === "disappears").map((control) => ({ tag: control.tag, text: control.text, where: control.where, box: control.box, before: control.boundary.before.ratio, after: control.boundary.after?.ratio ?? null })),
      drawingsDisappear: seen.graphics.filter((graphic) => graphic.drawing.fate === "disappears").map((graphic) => ({ tag: graphic.tag, where: graphic.where, box: graphic.box, inControl: graphic.inControl, controlHasText: graphic.controlHasText, before: graphic.drawing.before.ratio })),
      ms: seen.ms,
    };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0]! };
  }
}
