import type { Page } from "playwright";
import { call } from "../browser/call.ts";

/** WCAG 2.5.8: a target is at least 24 by 24 CSS pixels, or has that much room around it. */
export const MINIMUM_TARGET = 24;

interface Target {
  tag: string;
  text: string;
  path: string[];
  box: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  inlineInText: boolean;
}

export interface TargetMeasurement {
  width: number;
  height: number;
  /** A link in a sentence is excepted from the minimum size. */
  inlineInText: boolean;
  largeEnough: boolean;
  /**
   * Only for a target below the minimum: the nearest target that a circle of 24 pixels around
   * its centre touches, or whose own circle it touches. Null when there is room enough.
   */
  tooCloseTo: { tag: string; text: string; where: string; distance: number } | null;
  /** Distance in CSS pixels from this target's box to the nearest other target's box. */
  nearest: { tag: string; text: string; where: string; gap: number } | null;
}

const where = (target: { path: string[] }): string => target.path.join(" >>> ");

type Box = Target["box"];
const contains = (outer: Box, inner: Box): boolean => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
/** A focusable region around a control, or a control inside this one, is not a neighbour to keep distance from. */
const nested = (first: Target, second: Target): boolean => contains(first.box, second.box) || contains(second.box, first.box);

/** The spacing rule of WCAG 2.5.8 for one small target among all targets on the page. */
export function tooClose(target: Target, all: Target[]): TargetMeasurement["tooCloseTo"] {
  const centre = { x: target.box.x + target.box.width / 2, y: target.box.y + target.box.height / 2 };
  const radius = MINIMUM_TARGET / 2;
  for (const other of all) {
    if (other === target || where(other) === where(target) || nested(other, target)) continue;
    const otherSmall = other.width < MINIMUM_TARGET || other.height < MINIMUM_TARGET;
    const nearestX = Math.max(other.box.x, Math.min(centre.x, other.box.x + other.box.width));
    const nearestY = Math.max(other.box.y, Math.min(centre.y, other.box.y + other.box.height));
    const toBox = Math.hypot(centre.x - nearestX, centre.y - nearestY);
    const toCentre = Math.hypot(centre.x - (other.box.x + other.box.width / 2), centre.y - (other.box.y + other.box.height / 2));
    if (toBox < radius || (otherSmall && toCentre < 2 * radius)) return { tag: other.tag, text: other.text.slice(0, 40), where: where(other), distance: Math.round(Math.min(toBox, toCentre) * 10) / 10 };
  }
  return null;
}

/** Size of one target and the room around it. Null when the element is not a visible, enabled control. */
export async function targetSize(page: Page, target: string[]): Promise<TargetMeasurement | null> {
  const all = await call<Target[]>(page, "targetSizes");
  const own = all.find((entry) => where(entry) === target.join(" >>> "));
  if (!own) return null;
  let nearest: TargetMeasurement["nearest"] = null;
  for (const other of all) {
    if (other === own || nested(other, own)) continue;
    const dx = Math.max(0, other.box.x - (own.box.x + own.box.width), own.box.x - (other.box.x + other.box.width));
    const dy = Math.max(0, other.box.y - (own.box.y + own.box.height), own.box.y - (other.box.y + other.box.height));
    const gap = Math.round(Math.hypot(dx, dy) * 10) / 10;
    if (!nearest || gap < nearest.gap) nearest = { tag: other.tag, text: other.text.slice(0, 40), where: where(other), gap };
  }
  const largeEnough = own.width >= MINIMUM_TARGET && own.height >= MINIMUM_TARGET;
  return { width: own.width, height: own.height, inlineInText: own.inlineInText, largeEnough, tooCloseTo: largeEnough ? null : tooClose(own, all), nearest };
}
