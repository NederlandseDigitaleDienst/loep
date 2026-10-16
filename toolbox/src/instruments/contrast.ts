import type { Page } from "playwright";
import { PNG } from "pngjs";
import { call } from "../browser/call.ts";
import type { ColorScheme } from "../browser/session.ts";
import type { ForcedProbe } from "./forced.ts";
import { backgroundBehind, backgroundRange, blend, colourShares, containsColour, contrastRatio, floorRatio, requiredRatio, ringColour, type Rgb } from "../lib/contrast.ts";

export interface TextRun {
  text: string;
  colour: [number, number, number, number];
  opacity: number;
  fontSizePx: number;
  bold: boolean;
  box: { x: number; y: number; width: number; height: number };
  disabled: boolean;
  ariaHidden: boolean;
  tag: string;
  region: string | null;
  path: string[];
}

export interface ContrastMeasurement {
  text: string;
  tag: string;
  region: string | null;
  where: string;
  box: TextRun["box"];
  fontSizePx: number;
  bold: boolean;
  foreground: string;
  background: string | null;
  /** Rounded down to one decimal, so a ratio is never reported as better than it is. */
  ratio: number | null;
  required: number;
  outcome: "passed" | "failed" | "cantTell" | "exempt";
  reason: string | null;
  /**
   * Only for text on a background that is not flat: the contrast against the lightest and
   * the darkest substantial background colour. `ratio` then holds the case that decided.
   */
  range?: { lightest: string; darkest: string; worstRatio: number; bestRatio: number };
}

export interface Positioned {
  tag: string;
  text: string;
  region: string | null;
  path: string[];
  box: { x: number; y: number; width: number; height: number };
}

/** How clearly a control stands out from what surrounds it (WCAG 1.4.11). */
export interface ControlContrast {
  tag: string;
  text: string;
  region: string | null;
  where: string;
  box: Positioned["box"];
  outside: string | null;
  edge: string | null;
  fill: string | null;
  edgeRatio: number | null;
  fillRatio: number | null;
  /**
   * "duidelijk": border or fill reaches 3:1. "kandidaat": neither does, so someone has to look.
   * "tekstlink": a link without a boundary of its own; it is recognised by its text, not by a border.
   */
  outcome: "duidelijk" | "kandidaat" | "tekstlink" | "cantTell";
}

export interface GraphicContrast {
  tag: string;
  region: string | null;
  where: string;
  box: Positioned["box"];
  inControl: string | null;
  controlHasText: boolean | null;
  background: string | null;
  foreground: string | null;
  ratio: number | null;
  outcome: "duidelijk" | "kandidaat" | "cantTell";
}

export interface PageContrast {
  url: string;
  slug: string;
  scheme: ColorScheme;
  /** Width of the window when it was not the default one: 320 for the smallest width. Absent for the default window and in older runs. */
  width?: number;
  measurements: ContrastMeasurement[];
  controls: ControlContrast[];
  graphics: GraphicContrast[];
  /** The same page with forced colours: which boundaries and drawings disappeared. Light scheme and default window only; absent in older runs. */
  forced?: ForcedProbe | { error: string };
  /** The text of every link and button while pointed at and while it has focus, on the first page it stands on. Default window only, light and dark; absent in older runs. */
  hoverFocus?: HoverFocusReport;
}

/** WCAG 1.4.11 asks 3:1 for the parts of a control or graphic that are needed to recognise it. */
export const NON_TEXT_RATIO = 3;

export function measureControl(control: Positioned, image: PNG): ControlContrast {
  const base = { tag: control.tag, text: control.text.slice(0, 60), region: control.region, where: control.path.join(" >>> "), box: control.box };
  const outside = ringColour(image, control.box, 3);
  const edge = ringColour(image, control.box, 0);
  // The fill is read a few pixels in, past the border and before the label.
  const fill = ringColour(image, control.box, -Math.min(4, Math.floor(Math.min(control.box.width, control.box.height) / 4)));
  if (!outside || !edge || !fill || outside.share < FLAT_BACKGROUND_SHARE) return { ...base, outside: null, edge: null, fill: null, edgeRatio: null, fillRatio: null, outcome: "cantTell" };
  const edgeRatio = floorRatio(contrastRatio(edge.colour, outside.colour));
  const fillRatio = floorRatio(contrastRatio(fill.colour, outside.colour));
  const clear = edgeRatio >= NON_TEXT_RATIO || fillRatio >= NON_TEXT_RATIO;
  return { ...base, outside: hex(outside.colour), edge: hex(edge.colour), fill: hex(fill.colour), edgeRatio, fillRatio, outcome: clear ? "duidelijk" : control.tag === "a" ? "tekstlink" : "kandidaat" };
}

export function measureGraphic(graphic: Positioned & { inControl: string | null; controlHasText: boolean | null }, image: PNG): GraphicContrast {
  const base = { tag: graphic.tag, region: graphic.region, where: graphic.path.join(" >>> "), box: graphic.box, inControl: graphic.inControl, controlHasText: graphic.controlHasText };
  const shares = colourShares(image, graphic.box);
  const background = shares[0];
  if (!background) return { ...base, background: null, foreground: null, ratio: null, outcome: "cantTell" };
  // The drawing is whatever stands out most from the background among colours that cover a real part of the box.
  const candidates = shares.slice(1).filter((entry) => entry.share >= 0.02);
  if (candidates.length === 0 || background.share < 0.3) return { ...base, background: hex(background.colour), foreground: null, ratio: null, outcome: "cantTell" };
  const best = candidates.map((entry) => ({ entry, ratio: contrastRatio(entry.colour, background.colour) })).sort((a, b) => b.ratio - a.ratio)[0]!;
  const ratio = floorRatio(best.ratio);
  return { ...base, background: hex(background.colour), foreground: hex(best.entry.colour), ratio, outcome: ratio >= NON_TEXT_RATIO ? "duidelijk" : "kandidaat" };
}

/** A background counts as flat when one colour makes up at least this share of the pixels behind the text. */
export const FLAT_BACKGROUND_SHARE = 0.4;

const hex = (colour: Rgb): string => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

export function measure(run: TextRun, image: PNG): ContrastMeasurement {
  const base = {
    text: run.text,
    tag: run.tag,
    region: run.region,
    where: run.path.join(" >>> "),
    box: run.box,
    fontSizePx: run.fontSizePx,
    bold: run.bold,
    foreground: hex(run.colour.slice(0, 3) as Rgb),
    required: requiredRatio(run.fontSizePx, run.bold),
  };
  const undecided = (reason: string): ContrastMeasurement => ({ ...base, background: null, ratio: null, outcome: "cantTell", reason });
  if (run.disabled) return { ...base, background: null, ratio: null, outcome: "exempt", reason: "tekst in een uitgeschakeld bedieningselement" };
  if (run.box.x + run.box.width <= 0 || run.box.y + run.box.height <= 0 || run.box.x >= image.width || run.box.y >= image.height) return undecided("de tekst valt buiten de schermafbeelding");
  const alpha = run.colour[3] * run.opacity;
  const solid = run.colour.slice(0, 3) as Rgb;
  // The text colour as painted depends on the background when it is partly transparent; the background is
  // found first with the unblended colour, which is close enough to tell text pixels from the rest.
  const background = backgroundBehind(image, run.box, solid);
  if (!background) return undecided("op deze plek is geen andere kleur dan de tekstkleur te zien (tekst niet zichtbaar, of tekst en achtergrond zijn gelijk)");
  if (background.share < FLAT_BACKGROUND_SHARE) {
    // On a photo or gradient there is no single ratio, but there is a worst and a best case.
    const uneven = `de achtergrond is niet egaal (grootste kleurvlak achter de tekst ${Math.round(background.share * 100)}%)`;
    const spread = backgroundRange(image, run.box, solid);
    if (!spread) return undecided(uneven);
    if (spread.textShare === 0 && alpha >= 0.99) return undecided("de tekstkleur is op deze plek niet teruggevonden in de schermafbeelding (bedekt, of getekend als afbeelding)");
    const against = (colour: Rgb): number => floorRatio(contrastRatio(blend(solid, alpha, colour), colour));
    const cases = [
      { colour: spread.lightest, ratio: against(spread.lightest) },
      { colour: spread.darkest, ratio: against(spread.darkest) },
    ].sort((a, b) => a.ratio - b.ratio) as [{ colour: Rgb; ratio: number }, { colour: Rgb; ratio: number }];
    const [worst, best] = cases;
    const range = { lightest: hex(spread.lightest), darkest: hex(spread.darkest), worstRatio: worst.ratio, bestRatio: best.ratio };
    const nl = (ratio: number): string => `${String(ratio).replace(".", ",")}:1`;
    const both = `tegen de ongunstigste achtergrondkleur ${hex(worst.colour)} is het contrast ${nl(worst.ratio)}, tegen de gunstigste ${hex(best.colour)} is het ${nl(best.ratio)}`;
    if (best.ratio < base.required) return { ...base, background: hex(best.colour), ratio: best.ratio, outcome: "failed", reason: `${uneven}; ook in het gunstigste geval te weinig: ${both}`, range };
    // Background that looks like the text is counted as text above, so the worst case may be worse than measured.
    const hidden = spread.textShare > 0.5 || spread.textColourAround;
    if (worst.ratio >= base.required && !hidden) return { ...base, background: hex(worst.colour), ratio: worst.ratio, outcome: "passed", reason: `${uneven}; ook in het ongunstigste geval genoeg: ${both}`, range };
    return { ...base, background: null, ratio: null, outcome: "cantTell", reason: `${uneven}; ${both}${hidden ? "; een deel van de achtergrond heeft de kleur van de tekst, dus het ongunstigste geval kan lager liggen" : ""}`, range };
  }
  const foreground = blend(solid, alpha, background.colour);
  if (!containsColour(image, run.box, foreground)) return undecided("de tekstkleur is op deze plek niet teruggevonden in de schermafbeelding (bedekt, of getekend als afbeelding)");
  const ratio = Math.floor(contrastRatio(foreground, background.colour) * 10) / 10;
  return { ...base, foreground: hex(foreground), background: hex(background.colour), ratio, outcome: ratio >= base.required ? "passed" : "failed", reason: null };
}

export type Graphic = Positioned & { inControl: string | null; controlHasText: boolean | null };

/** Measure the contrast of every piece of visible text, control and small graphic on the page as it is now. */
export async function pageContrast(page: Page): Promise<Pick<PageContrast, "measurements" | "controls" | "graphics">> {
  // Text and screenshot are taken from the same page state, so positions match pixel for pixel.
  const runs = await call<TextRun[]>(page, "textRuns");
  const image = PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
  const controls = await call<Positioned[]>(page, "hoverTargets");
  const graphics = await call<Graphic[]>(page, "graphicBoxes");
  const measurements = runs.map((run) => measure(run, image));
  // Text that only shows when it has focus, such as a skip link, is measured in that state.
  await page.keyboard.press("Tab");
  // That covers text that was not there before, and text that could not be measured without focus (off screen).
  const undecided = (run: TextRun): boolean => measurements.find((entry) => entry.where === run.path.join(" >>> "))?.outcome !== "passed" && measurements.find((entry) => entry.where === run.path.join(" >>> "))?.outcome !== "failed";
  const revealed = (await call<TextRun[]>(page, "focusedTextRuns")).filter(undecided);
  if (revealed.length > 0) {
    const focusedImage = PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
    for (const run of revealed) {
      const measured = { ...measure(run, focusedImage), text: `(zichtbaar bij focus) ${run.text}`.slice(0, 70) };
      const earlier = measurements.findIndex((entry) => entry.where === measured.where);
      if (earlier >= 0) measurements.splice(earlier, 1, measured);
      else measurements.push(measured);
    }
  }
  return {
    measurements,
    controls: controls.map((control) => measureControl(control, image)),
    graphics: graphics.map((graphic) => measureGraphic(graphic, image)),
  };
}

export interface ElementContrast {
  /** Every piece of text inside the element, measured as it is painted now. */
  text: ContrastMeasurement[];
  /** The boundary of the element itself, when it is a control. */
  control: ControlContrast | null;
  /** The element as a drawing, when it is a small image or icon. */
  graphic: GraphicContrast | null;
}

/**
 * Contrast of one element in the state the page is in now, so also while it is hovered or
 * has focus. Measured on a picture of the window as it is: taking a picture of the whole
 * page would resize the window and can end a hover state.
 */
export async function elementContrast(page: Page, target: string[], options: { textOnly?: boolean } = {}): Promise<ElementContrast | null> {
  const found = await page.evaluate(([chain, textOnly]) => {
    const library = (window as unknown as { __loep: Record<string, (...values: never[]) => unknown> & { registry: Element[] } }).__loep;
    const element = (library.resolve as (chain: string[]) => HTMLElement | null)(chain as string[]);
    if (!element) return null;
    const original = [window.scrollX, window.scrollY] as [number, number];
    const rect = element.getBoundingClientRect();
    if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    // Only the text inside the element: reading every piece of text on the page for each element is what makes a page with many controls slow.
    const runs = (library.textRuns as (root: Element) => { path: string[] }[])(element);
    const same = (item: { path: string[] }): boolean => item.path.join(" >>> ") === chain.join(" >>> ");
    return {
      runs,
      control: textOnly ? null : ((library.hoverTargets as (options: { kinds: boolean }) => { path: string[] }[])({ kinds: false }).find(same) ?? null),
      graphic: textOnly ? null : ((library.graphicBoxes as () => { path: string[] }[])().find(same) ?? null),
      scroll: [window.scrollX, window.scrollY] as [number, number],
      original,
    };
  }, [target, options.textOnly === true] as const);
  if (!found) return null;
  const image = PNG.sync.read(await page.screenshot({ animations: "disabled" }));
  const [left, top] = found.scroll;
  if (left !== found.original[0] || top !== found.original[1]) await page.evaluate(([x, y]) => window.scrollTo({ left: x!, top: y!, behavior: "instant" }), found.original);
  // Positions are relative to the page; the picture shows the window.
  const inWindow = <T extends { box: Positioned["box"] }>(item: T): T => ({ ...item, box: { ...item.box, x: item.box.x - left, y: item.box.y - top } });
  const onPage = <T extends { box: Positioned["box"] }>(item: T): T => ({ ...item, box: { ...item.box, x: item.box.x + left, y: item.box.y + top } });
  return {
    text: (found.runs as unknown as TextRun[]).map((run) => onPage(measure(inWindow(run), image))),
    control: found.control ? onPage(measureControl(inWindow(found.control as unknown as Positioned), image)) : null,
    graphic: found.graphic ? onPage(measureGraphic(inWindow(found.graphic as unknown as Graphic), image)) : null,
  };
}

/** Room around an element in the picture its text is measured on: the background just outside the letters is in it. */
const CLIP_MARGIN = 8;

/**
 * The text inside one element as it is painted now, measured on a picture of only that element
 * and a margin: much faster than a picture of the window when every link of a site is measured.
 * The element is brought into the window first when it is not in it.
 */
async function textContrastNow(page: Page, target: string[]): Promise<{ text: ContrastMeasurement[] } | null> {
  const found = await page.evaluate((chain) => {
    const library = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; textRuns: (root: Element) => TextRun[] } }).__loep;
    const element = library.resolve(chain);
    if (!element) return null;
    let rect = element.getBoundingClientRect();
    if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      rect = element.getBoundingClientRect();
    }
    return { runs: library.textRuns(element), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scroll: [window.scrollX, window.scrollY] as [number, number], window: [innerWidth, innerHeight] as [number, number] };
  }, target);
  if (!found || found.runs.length === 0) return found ? { text: [] } : null;
  const [left, top] = found.scroll;
  // The runs are in coordinates of the page; the clip around them in those of the window.
  const boxes = found.runs.map((run) => ({ x: run.box.x - left, y: run.box.y - top, right: run.box.x - left + run.box.width, bottom: run.box.y - top + run.box.height }));
  const x = Math.max(0, Math.floor(Math.min(found.rect.x, ...boxes.map((box) => box.x)) - CLIP_MARGIN));
  const y = Math.max(0, Math.floor(Math.min(found.rect.y, ...boxes.map((box) => box.y)) - CLIP_MARGIN));
  const right = Math.min(found.window[0], Math.ceil(Math.max(found.rect.x + found.rect.width, ...boxes.map((box) => box.right)) + CLIP_MARGIN));
  const bottom = Math.min(found.window[1], Math.ceil(Math.max(found.rect.y + found.rect.height, ...boxes.map((box) => box.bottom)) + CLIP_MARGIN));
  if (right - x < 1 || bottom - y < 1) return { text: [] };
  const image = PNG.sync.read(await page.screenshot({ clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled" }));
  return { text: found.runs.map((run) => ({ ...measure({ ...run, box: { ...run.box, x: run.box.x - left - x, y: run.box.y - top - y } }, image), box: run.box })) };
}

/** The controls whose text usually changes colour under the pointer or with focus. */
export const COLOURED_ON_HOVER = (target: { tag: string; roleAttr?: unknown }): boolean => ["a", "button", "summary"].includes(target.tag) || ["button", "link", "tab", "menuitem"].includes(String(target.roleAttr ?? ""));

/** The text of one link or button measured while it is pointed at, or while it has focus. */
export interface HoverFocusText {
  control: string;
  where: string;
  trigger: "hover" | "focus";
  texts: { text: string; foreground: string; background: string | null; ratio: number | null; required: number; outcome: string; reason: string | null }[];
}

/** One link or button wherever it stands: a control in the header is measured once for the whole site. */
export const hoverFocusKey = (row: { control: string; where: string }): string => `${row.where}|${row.control}`;

export interface HoverFocusReport {
  /** Links and buttons on the page. */
  controls: number;
  /** Those measured here: the others were measured on an earlier page, where they stood first. */
  measured: number;
  /** Measured ones without text of their own, such as a button with only a pictogram: there is no text to measure. */
  withoutText: number;
  /** Measurements made on a picture of the element, because the text was not on one plain colour; the others come from the colours the browser paints. */
  fromPicture: number;
  rows: HoverFocusText[];
}

/**
 * The text of every link and button on the page while it is pointed at and while it has focus
 * (WCAG 1.4.3), each on the first page it stands on: `seen` holds what earlier pages measured.
 * Measured on a picture of the window as it is, as the measurement at rest is.
 */
export async function hoverFocusContrast(page: Page, seen: Set<string>): Promise<HoverFocusReport> {
  type Target = { tag: string; text: string; region: string | null; path: string[]; roleAttr: string | null };
  type Plain = TextRun & { background: Rgb | null; complexNl: string | null };
  const targets = (await call<Target[]>(page, "hoverTargets")).filter(COLOURED_ON_HOVER);
  const report: HoverFocusReport = { controls: targets.length, measured: 0, withoutText: 0, fromPicture: 0, rows: [] };
  const hex = (colour: number[]): string => `#${colour.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  for (const target of targets) {
    const where = target.path.join(" >>> ");
    const control = `${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`;
    const key = hoverFocusKey({ control, where });
    if (seen.has(key)) continue;
    seen.add(key);
    report.measured++;
    let texts = 0;
    for (const trigger of ["hover", "focus"] as const) {
      // Into the window, nothing focused, and the point to put the pointer on.
      const point = await page
        .evaluate((chain) => {
          const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
          (document.activeElement as HTMLElement | null)?.blur();
          if (!element) return null;
          let rect = element.getBoundingClientRect();
          if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) {
            element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            rect = element.getBoundingClientRect();
          }
          return rect.width > 0 && rect.height > 0 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        }, target.path)
        .catch(() => null);
      if (!point) break;
      if (trigger === "hover") await page.mouse.move(point.x, point.y);
      else {
        await page.mouse.move(0, 0);
        await page.evaluate((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain)?.focus(), target.path);
      }
      // The colours as the browser paints them; text on anything but one plain colour is measured on a picture of the element.
      const plain = await call<Plain[] | null>(page, "plainTextColours", target.path).catch(() => null);
      if (!plain || plain.length === 0) continue;
      let measured: { text: string; foreground: string; background: string | null; ratio: number | null; required: number; outcome: string; reason: string | null }[];
      if (plain.every((run) => run.complexNl === null && run.background !== null)) {
        measured = plain.map((run) => {
          const required = requiredRatio(run.fontSizePx, run.bold);
          if (run.disabled) return { text: run.text, foreground: hex(run.colour), background: hex(run.background!), ratio: null, required, outcome: "exempt", reason: "tekst in een uitgeschakeld bedieningselement" };
          const foreground = blend(run.colour.slice(0, 3) as Rgb, run.colour[3], run.background!);
          const ratio = floorRatio(contrastRatio(foreground, run.background!));
          return { text: run.text, foreground: hex(foreground), background: hex(run.background!), ratio, required, outcome: ratio >= required ? "passed" : "failed", reason: null };
        });
      } else {
        const pictured = await textContrastNow(page, target.path).catch(() => null);
        if (!pictured || pictured.text.length === 0) continue;
        report.fromPicture++;
        measured = pictured.text.map((entry) => ({ text: entry.text, foreground: entry.foreground, background: entry.background, ratio: entry.ratio, required: entry.required, outcome: entry.outcome, reason: entry.reason }));
      }
      texts++;
      report.rows.push({ control, where, trigger, texts: measured.map((entry) => ({ ...entry, text: entry.text.slice(0, 60) })) });
    }
    if (texts === 0) report.withoutText++;
  }
  await page.mouse.move(0, 0).catch(() => undefined);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()).catch(() => undefined);
  return report;
}
