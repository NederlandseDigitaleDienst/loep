import type { Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../browser/call.ts";
import { RENDERING } from "../browser/session.ts";
import { writeFileAtomic } from "../lib/canonical.ts";
import { focusIndicator } from "../lib/contrast.ts";
import { focusClip, MOVED, NOT_PAINTED, sameBox, type Clip, type Painted } from "./keyboard.ts";

export interface FocusMeasurement {
  /** False when the element did not take focus: it is not focusable. */
  focusable: boolean;
  focusVisible: boolean | null;
  outline: string | null;
  outlineOffset: string | null;
  boxShadow: string | null;
  unfocusedOutline: string;
  unfocusedBoxShadow: string;
  styleChanges: boolean | null;
  /** Selector chain of what is painted over the centre of the focused element, if anything (WCAG 2.4.11). */
  coveredBy: string[] | null;
  clipVerified: boolean;
  focusNotMeasured: string | null;
  /** Share of the pixels around the element that look different with focus. */
  focusPixelShare: number | null;
  indicatorColour: string | null;
  indicatorOver: string | null;
  indicatorRatio: number | null;
}

const hex = (colour: number[]): string => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/**
 * Give one element keyboard focus and measure its focus indicator the way the Tab walk
 * does: a picture of the region without and with focus, the share of pixels that changed
 * and the contrast of the indicator against what it replaced. The element keeps focus
 * afterwards. Null when the element is not on the page.
 */
export async function focusIndicatorOf(page: Page, target: string[], images: { focused: string; unfocused: string }): Promise<FocusMeasurement | null> {
  const viewport = page.viewportSize() ?? RENDERING.viewport;
  const rest = await page.evaluate((chain) => {
    const library = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; deepActiveElement: () => HTMLElement | null; registry: Element[] } }).__loep;
    const element = library.resolve(chain);
    if (!element) return null;
    library.deepActiveElement()?.blur();
    const rect = element.getBoundingClientRect();
    if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const style = getComputedStyle(element);
    const now = element.getBoundingClientRect();
    return {
      ref: library.registry.push(element) - 1,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      boxShadow: style.boxShadow,
      viewportBox: { x: Math.round(now.x), y: Math.round(now.y), width: Math.round(now.width), height: Math.round(now.height) },
    };
  }, target);
  if (!rest) return null;
  const clip = focusClip(rest.viewportBox, viewport);
  const without = clip ? await page.screenshot({ clip, animations: "disabled" }) : null;

  // A browser shows the keyboard focus style after script focus only when the last input was a
  // key. Shift alone does nothing on a page and puts the browser in that mode.
  await page.keyboard.press("Shift");
  await page.evaluate((ref) => ((window as unknown as { __loep: { registry: HTMLElement[] } }).__loep.registry[ref] as HTMLElement).focus({ preventScroll: true }), rest.ref);
  const state = await call<(Record<string, unknown> & { path: string[]; viewportBox: Clip }) | null>(page, "focusState");
  const base = { unfocusedOutline: rest.outline, unfocusedBoxShadow: rest.boxShadow };
  if (!state || state.path.join(" >>> ") !== target.join(" >>> ")) {
    return { ...base, focusable: false, focusVisible: null, outline: null, outlineOffset: null, boxShadow: null, styleChanges: null, coveredBy: null, clipVerified: false, focusNotMeasured: "het element kreeg de focus niet: het is niet focusbaar", focusPixelShare: null, indicatorColour: null, indicatorOver: null, indicatorRatio: null };
  }
  const result: FocusMeasurement = {
    ...base,
    focusable: true,
    focusVisible: state.focusVisible as boolean,
    outline: state.outline as string,
    outlineOffset: state.outlineOffset as string,
    boxShadow: state.boxShadow as string,
    styleChanges: rest.outline !== state.outline || rest.boxShadow !== state.boxShadow,
    coveredBy: (state.coveredBy as string[] | null) ?? null,
    clipVerified: false,
    focusNotMeasured: null,
    focusPixelShare: null,
    indicatorColour: null,
    indicatorOver: null,
    indicatorRatio: null,
  };
  if (!clip || !without) {
    result.focusNotMeasured = "het element valt buiten het venster";
    return result;
  }
  const withFocus = await page.screenshot({ clip, animations: "disabled" });
  // A clip says something about focus only when the element was painted there in both pictures.
  const painted = await call<Painted | null>(page, "paintedBox", state.ref);
  result.clipVerified = painted !== null && painted.visible && sameBox(painted.viewportBox, rest.viewportBox) && sameBox(state.viewportBox, rest.viewportBox);
  await writeFileAtomic(images.focused, withFocus);
  await writeFileAtomic(images.unfocused, without);
  if (!result.clipVerified) {
    result.focusNotMeasured = painted?.visible === false ? NOT_PAINTED : MOVED;
    return result;
  }
  const measured = focusIndicator(PNG.sync.read(withFocus), PNG.sync.read(without));
  result.focusPixelShare = measured?.changedShare ?? null;
  result.indicatorColour = measured?.indicator ? hex(measured.indicator) : null;
  result.indicatorOver = measured?.replaced ? hex(measured.replaced) : null;
  result.indicatorRatio = measured?.ratio ?? null;
  return result;
}
