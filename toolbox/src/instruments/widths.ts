import { join } from "node:path";
import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import { wholePageScreenshot } from "../browser/screenshot.ts";
import { collectNamed, type Described } from "./facts.ts";

/** The widths every page is measured at: the default window, the narrow window and the smallest width of WCAG. */
export const MEASURED_WIDTHS = [1280, 360, 320];
/** Between the measured widths the page is laid out at least this often, on top of the widths its stylesheets name. */
const WIDTH_STEP = 80;
/** Time for a layout that a script makes after the window changed size. */
const SETTLE_MS = 60;
/** At most this many widths are measured for the controls that only show between the measured ones: enough to show each of them. */
const MAX_WIDTHS = 2;
/** At most this many of those controls are opened per width. */
const MAX_OPENED = 4;
const HEIGHT = 800;

interface Shown {
  tag: string;
  text: string;
  ariaLabel: string | null;
  region: string | null;
  path: string[];
}

export interface BetweenWidths {
  /** The widths the page was laid out at, widest first. */
  widthsTried: number[];
  /** The widths the stylesheets name in a media or container query. */
  breakpoints: number[];
  /** Controls on screen at none of the measured widths and at one or more widths between them. */
  controls: { control: string; where: string; shownAt: number[]; role: string | null; name: string | null; iconOnly: boolean; screenshot: string | null }[];
  /** Each width chosen to show those controls, with a picture of the page there and what each control opened. */
  measuredAt: { width: number; screenshot: string; opened: { control: string; where: string; controls: string[]; text: string[]; tree: string; screenshot: string | null; failedNl?: string }[] }[];
}

const keyOf = (control: Shown): string => `${control.tag}|${control.text || control.ariaLabel || ""}|${control.path.join(" >>> ")}`;
const nameOf = (control: Shown): string => `${control.tag} "${(control.text || control.ariaLabel || "").slice(0, 40)}" [${control.region ?? "-"}]`;

/** The widths to lay a page out at: a regular step between the measured widths, and both sides of every width the stylesheets name. */
export function widthsToTry(breakpoints: number[]): number[] {
  const widths = new Set<number>(MEASURED_WIDTHS);
  const [widest, narrowest] = [Math.max(...MEASURED_WIDTHS), Math.min(...MEASURED_WIDTHS)];
  for (let width = narrowest + WIDTH_STEP; width < widest; width += WIDTH_STEP) widths.add(width);
  for (const breakpoint of breakpoints) for (const width of [breakpoint - 1, breakpoint + 1]) if (width > narrowest && width < widest) widths.add(width);
  return [...widths].sort((a, b) => b - a);
}

/** The lines of the second tree that the first does not have: what an action added to the accessibility tree. */
export function addedLines(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const line of before.split("\n")) left.set(line.trim(), (left.get(line.trim()) ?? 0) + 1);
  return after.split("\n").filter((line) => {
    const count = left.get(line.trim()) ?? 0;
    if (count > 0) left.set(line.trim(), count - 1);
    return count === 0 && line.trim() !== "";
  });
}

/**
 * Lay the page out at every width of `widthsToTry` and note at which of them each control is
 * on screen. `between` are the controls on screen at none of the measured widths. The window
 * is left at the narrowest width.
 */
async function scanWidths(page: Page): Promise<{ breakpoints: number[]; widths: number[]; between: { control: Shown; widths: number[] }[] }> {
  const breakpoints = await call<number[]>(page, "layoutBreakpoints").catch(() => []);
  const widths = widthsToTry(breakpoints);
  const shownAt = new Map<string, { control: Shown; widths: number[] }>();
  for (const width of widths) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS);
    for (const control of await call<Shown[]>(page, "shownControls")) {
      const entry = shownAt.get(keyOf(control)) ?? { control, widths: [] };
      entry.widths.push(width);
      shownAt.set(keyOf(control), entry);
    }
  }
  return { breakpoints, widths, between: [...shownAt.values()].filter((entry) => !entry.widths.some((width) => MEASURED_WIDTHS.includes(width))) };
}

/** What an explorer needs to find a control that only exists at some widths: the widths the stylesheets name, and each such control with where it is on screen. */
export interface WidthsForExplorer {
  breakpoints: number[];
  controls: { control: string; where: string; shownAt: number[] }[];
}

/** The same scan as the sweep makes, without opening anything: for `check-site`, on the page as it is. */
export async function controlsBetweenWidths(page: Page): Promise<WidthsForExplorer> {
  const { breakpoints, between } = await scanWidths(page);
  return { breakpoints, controls: between.map((entry) => ({ control: nameOf(entry.control), where: entry.control.path.join(" >>> "), shownAt: entry.widths.sort((a, b) => a - b) })) };
}

/** A width to try a control at: inside the range where it showed, as a whole number. */
export const widthToTry = (shownAt: number[]): number => shownAt[Math.floor((shownAt.length - 1) / 2)]!;

/**
 * Controls that a page has and that are on screen at none of the widths the sweep measures, such
 * as a button "Meer opties" that a header only shows at a width in between. The page is laid out
 * at a regular step and at both sides of every width its stylesheets name. When such controls are
 * found, the page is measured at the width that shows most of them: a picture, the name and role
 * of each, and what each one opens, with the part of the accessibility tree it added.
 */
export async function betweenWidths(page: Page, dir: string, relative: string): Promise<BetweenWidths> {
  const { breakpoints, widths, between } = await scanWidths(page);
  const result: BetweenWidths = { widthsTried: widths, breakpoints, controls: [], measuredAt: [] };
  // The widths that show the most of them, until each is shown once.
  const left = new Set(between.map((entry) => keyOf(entry.control)));
  const chosen: number[] = [];
  while (left.size > 0 && chosen.length < MAX_WIDTHS) {
    const best = widths.map((width) => ({ width, count: between.filter((entry) => left.has(keyOf(entry.control)) && entry.widths.includes(width)).length })).sort((a, b) => b.count - a.count || b.width - a.width)[0]!;
    if (best.count === 0) break;
    chosen.push(best.width);
    for (const entry of between) if (entry.widths.includes(best.width)) left.delete(keyOf(entry.control));
  }
  const named = new Map<string, Described>();
  for (const [index, width] of chosen.entries()) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(() => window.scrollTo(0, 0));
    const shot = `between-${width}.png`;
    await wholePageScreenshot(page, { path: join(dir, shot) });
    const facts = await collectNamed(page).catch(() => ({ links: [], controls: [] }));
    for (const item of [...facts.links, ...facts.controls]) named.set((item.path as string[]).join(" >>> "), item);
    const here = between.filter((entry) => entry.widths.includes(width));
    const triggers = new Set((await call<Shown[]>(page, "triggers").catch(() => [] as Shown[])).map((trigger) => trigger.path.join(" >>> ")));
    const opened: BetweenWidths["measuredAt"][number]["opened"] = [];
    for (const entry of here) {
      const where = entry.control.path.join(" >>> ");
      if (opened.length >= MAX_OPENED || !(triggers.has(where) || entry.control.tag === "button" || entry.control.tag === "summary")) continue;
      const number = `${index + 1}-${opened.length + 1}`;
      try {
        const keysBefore = new Set((await call<Shown[]>(page, "shownControls")).map(keyOf));
        const textBefore = new Set(await call<string[]>(page, "textChunks"));
        const treeBefore = await page.locator("body").ariaSnapshot();
        const handle = (await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), entry.control.path)).asElement();
        if (!handle) throw new Error("het element was er niet meer");
        await handle.click({ timeout: 3000 });
        await page.waitForTimeout(400);
        const shown = (await call<Shown[]>(page, "shownControls")).filter((control) => !keysBefore.has(keyOf(control)));
        const text = (await call<string[]>(page, "textChunks")).filter((chunk) => !textBefore.has(chunk));
        const tree = addedLines(treeBefore, await page.locator("body").ariaSnapshot()).join("\n").slice(0, 4000);
        const picture = `between-${width}-opened-${number}.png`;
        await page.screenshot({ path: join(dir, picture), animations: "disabled" });
        opened.push({ control: nameOf(entry.control), where, controls: shown.map(nameOf), text: text.slice(0, 20).map((chunk) => chunk.slice(0, 80)), tree, screenshot: `${relative}/${picture}` });
        // Close it again for the next one: Escape, and a second click when Escape did not.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        if (shown.length > 0 && (await call<Shown[]>(page, "shownControls")).some((control) => keyOf(control) === keyOf(shown[0]!))) await handle.click({ timeout: 3000 }).catch(() => undefined);
      } catch (error) {
        opened.push({ control: nameOf(entry.control), where, controls: [], text: [], tree: "", screenshot: null, failedNl: (error as Error).message.split("\n")[0]! });
      }
    }
    result.measuredAt.push({ width, screenshot: `${relative}/${shot}`, opened });
  }
  for (const [index, entry] of between.entries()) {
    const where = entry.control.path.join(" >>> ");
    const width = chosen.find((candidate) => entry.widths.includes(candidate));
    let screenshot: string | null = null;
    if (width !== undefined && index < 20) {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.waitForTimeout(SETTLE_MS);
      const handle = (await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), entry.control.path)).asElement();
      const picture = `between-control-${index + 1}.png`;
      if (handle && (await handle.screenshot({ path: join(dir, picture), animations: "disabled", timeout: 3000 }).then(() => true).catch(() => false))) screenshot = `${relative}/${picture}`;
    }
    const ax = named.get(where)?.ax as { role?: string | null; name?: string | null } | null | undefined;
    result.controls.push({ control: nameOf(entry.control), where, shownAt: entry.widths.sort((a, b) => a - b), role: ax?.role ?? null, name: ax?.name ?? null, iconOnly: !entry.control.text, screenshot });
  }
  return result;
}
