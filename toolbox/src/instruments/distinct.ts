import type { Page } from "playwright";
import { PNG } from "pngjs";
import { colourShares, contrastRatio, floorRatio, ringColour, type Region, type Rgb } from "../lib/contrast.ts";

/** The page as everybody sees it, and the four kinds of colour vision deficiency Chromium can imitate. */
export const VISIONS = ["normal", "protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const;
export type Vision = (typeof VISIONS)[number];

/**
 * A difference in colour below this ratio is not enough to tell two things apart by colour alone.
 * The number comes from technique G183 of W3C, written for links in text. A technique is one way
 * to meet WCAG 1.4.1, not the text of the criterion: a lower ratio is a lead, not a failure.
 */
export const DISTINCT_RATIO = 3;

export interface Side {
  tag: string;
  text: string;
  where: string;
}

export interface SideColours {
  /** What stands out most from the background within the element: its letters, or its drawing when it has no text. */
  ink: string | null;
  background: string | null;
  /** The colour on the edge of the element: a border, or the background when there is none. */
  edge: string | null;
}

export interface VisionRatios {
  vision: Vision;
  first: SideColours;
  second: SideColours;
  /** Contrast ratio as WCAG defines it between the two inks, the two backgrounds and the two edges, rounded down. */
  ink: number | null;
  background: number | null;
  edge: number | null;
  /** The largest of the three: how far apart the two are in colour at best. */
  ratio: number | null;
}

export interface DistinctAnswer {
  /** A link against the text around it, or two elements somebody pointed at: two states of the same kind of element. */
  pair: "link-in-text" | "two-elements";
  first: Side;
  second: Side;
  visions: VisionRatios[];
  /** The kind of vision in which the two are closest in colour. */
  lowest: { vision: Vision; ratio: number } | null;
  /** What differs between the two besides colour, read from the styles and the code: an underline, a weight, a border, an image. */
  other: string[];
  /** Below 3 to 1 in at least one kind of vision and nothing else found that sets the two apart. */
  lead: boolean;
}

interface Features {
  underline: boolean;
  weight: number;
  italic: boolean;
  sizePx: number;
  family: string;
  border: string;
  outline: boolean;
  shadow: boolean;
  backgroundImage: boolean;
  image: boolean;
  generated: boolean;
}

interface Found extends Side {
  /** Where the colours are read, in pixels of the window: the first piece of text, or the element when it has no text. */
  inkBox: Region;
  box: Region;
  features: Features;
}

/** The differences besides colour between two sets of features, as the answer names them. */
export function otherFeatures(first: Features, second: Features): string[] {
  const found: string[] = [];
  if (first.underline !== second.underline) found.push("onderstreping");
  if (first.weight >= 600 !== second.weight >= 600) found.push("vet");
  if (first.italic !== second.italic) found.push("cursief");
  if (Math.abs(first.sizePx - second.sizePx) >= 1) found.push("lettergrootte");
  if (first.family !== second.family) found.push("lettertype");
  if (first.border !== second.border) found.push("rand");
  if (first.outline !== second.outline) found.push("outline");
  if (first.shadow !== second.shadow) found.push("box-shadow");
  if (first.backgroundImage !== second.backgroundImage) found.push("achtergrondafbeelding");
  if (first.image !== second.image) found.push("pictogram of afbeelding");
  if (first.generated !== second.generated) found.push("teken uit CSS (::before of ::after)");
  return found;
}

const hex = (colour: Rgb): string => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
const rgb = (colour: string): Rgb => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)) as Rgb;
const apart = (first: Rgb, second: Rgb): number => Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) + Math.abs(first[2] - second[2]);

/** A colour has to cover at least this share of the box to be the ink: less is the edge of a letter. */
const INK_SHARE = 0.01;

/** The colours of one element as they are painted in a picture of the window. */
export function sideColours(image: PNG, inkBox: Region, box: Region): SideColours {
  const shares = colourShares(image, inkBox);
  const background = shares[0];
  if (!background) return { ink: null, background: null, edge: null };
  // The ink is the colour of real size that is furthest from the background: the middle of the letters, not their mixed edge.
  const ink = shares.slice(1).filter((entry) => entry.share >= INK_SHARE).sort((a, b) => apart(b.colour, background.colour) - apart(a.colour, background.colour))[0];
  const edge = ringColour(image, box, 0);
  return { ink: ink ? hex(ink.colour) : null, background: hex(background.colour), edge: edge ? hex(edge.colour) : null };
}

/** The ratios between two elements in one kind of vision. */
export function ratiosOf(vision: Vision, first: SideColours, second: SideColours): VisionRatios {
  const between = (a: string | null, b: string | null): number | null => (a === null || b === null ? null : floorRatio(contrastRatio(rgb(a), rgb(b))));
  const ink = between(first.ink, second.ink);
  const background = between(first.background, second.background);
  const edge = between(first.edge, second.edge);
  const known = [ink, background, edge].filter((value): value is number => value !== null);
  return { vision, first, second, ink, background, edge, ratio: known.length > 0 ? Math.max(...known) : null };
}

/** Whether the difference in colour is a lead for WCAG 1.4.1: too small in some kind of vision, and nothing else sets the two apart. */
export function isLead(visions: VisionRatios[], other: string[]): boolean {
  return other.length === 0 && visions.some((entry) => entry.ratio !== null && entry.ratio < DISTINCT_RATIO);
}

/**
 * How far two things are apart in colour, as everybody sees them and as somebody with a colour
 * vision deficiency does: a link against the text around it, or two elements in different states.
 * Chromium paints the page in each kind of vision and the colours are read from the pixels; the
 * page itself is not touched and is scrolled back. `against` is the second element; without it
 * the first has to stand in running text, and the text around it is the second.
 */
export async function distinctByColour(page: Page, target: string[], against: string[] | null): Promise<DistinctAnswer | { error: string }> {
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY] as [number, number]);
  const found = await page.evaluate(
    ([chain, other]) => {
      const library = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; describe: (element: Element) => { path: string[]; tag: string; text: string }; textRuns: () => { path: string[]; box: { x: number; y: number; width: number; height: number } }[]; isVisible: (element: Element) => boolean } }).__loep;
      const element = library.resolve(chain!);
      if (!element) return { error: "het element is van de pagina verdwenen" };
      const ownText = (candidate: Element): boolean => [...candidate.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 1);
      let second: HTMLElement | null = other ? library.resolve(other) : null;
      if (other && !second) return { error: "het tweede element is niet gevonden" };
      if (!second) {
        // The text around a link is the nearest element above it that has text of its own.
        for (let current = element.parentElement; current && current !== document.documentElement; current = current.parentElement) {
          if (!ownText(current)) continue;
          second = current;
          break;
        }
        if (!second) return { error: "het element staat niet in lopende tekst: wijs met --against het element aan waarmee je het vergelijkt" };
      }
      const rect = element.getBoundingClientRect();
      if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const runs = library.textRuns();
      // An underline is drawn through everything inside the element that has it. For the text around a link only its own counts: the link inside it is the other side.
      const underlined = (candidate: Element, stop: Element | null, within: boolean): boolean => {
        for (let current: Element | null = candidate; current && current !== stop; current = current.parentElement) if (getComputedStyle(current).textDecorationLine.includes("underline")) return true;
        return within && [...candidate.querySelectorAll("*")].some((inner) => getComputedStyle(inner).textDecorationLine.includes("underline"));
      };
      const generated = (candidate: Element): boolean => ["::before", "::after"].some((pseudo) => !["none", "normal", '""', "''"].includes(getComputedStyle(candidate, pseudo).content));
      const side = (candidate: HTMLElement, own: boolean, stop: Element | null) => {
        const described = library.describe(candidate);
        const style = getComputedStyle(candidate);
        const now = candidate.getBoundingClientRect();
        const key = described.path.join(" >>> ");
        // The text of the element itself; for the text around a link only what is its own, not the link again.
        const run = runs.find((entry) => (own ? entry.path.join(" >>> ") === key : (() => {
          const inner = library.resolve(entry.path);
          return inner !== null && candidate.contains(inner);
        })()));
        const box = { x: Math.round(now.x), y: Math.round(now.y), width: Math.round(now.width), height: Math.round(now.height) };
        const borders = ["Top", "Right", "Bottom", "Left"].map((edge) => (style.getPropertyValue(`border-${edge.toLowerCase()}-style`) !== "none" && Number.parseFloat(style.getPropertyValue(`border-${edge.toLowerCase()}-width`)) > 0 ? edge[0] : "")).join("");
        return {
          tag: described.tag,
          text: described.text.slice(0, 60),
          where: key,
          box,
          inkBox: run ? { x: run.box.x - window.scrollX, y: run.box.y - window.scrollY, width: run.box.width, height: run.box.height } : box,
          features: {
            underline: underlined(candidate, stop, !own),
            weight: Number(style.fontWeight) || 400,
            italic: style.fontStyle !== "normal",
            sizePx: Number.parseFloat(style.fontSize),
            family: style.fontFamily,
            border: borders,
            outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
            shadow: style.boxShadow !== "none",
            backgroundImage: style.backgroundImage !== "none",
            image: [...candidate.querySelectorAll("svg,img,[role=img]")].some((inner) => library.isVisible(inner)),
            generated: generated(candidate),
          },
        };
      };
      const inText = !other;
      const first = side(element, false, inText ? second : null);
      const last = side(second, inText, null);
      // An image of the link is not one of the text around it, though the text around it contains the link.
      if (inText) last.features.image = [...second.querySelectorAll("svg,img,[role=img]")].some((inner) => library.isVisible(inner) && !element.contains(inner));
      const inside = (box: { x: number; y: number; width: number; height: number }): boolean => box.x >= 0 && box.y >= 0 && box.x + box.width <= innerWidth && box.y + box.height <= innerHeight;
      if (!inside(first.inkBox) || !inside(last.inkBox)) return { error: "de twee staan niet samen in het venster: vergelijk twee elementen die tegelijk in beeld zijn" };
      return { first, second: last };
    },
    [target, against] as const,
  );
  if ("error" in found) {
    await page.evaluate(([x, y]) => window.scrollTo({ left: x!, top: y!, behavior: "instant" }), scroll).catch(() => undefined);
    return { error: found.error! };
  }
  const { first, second } = found as { first: Found; second: Found };
  const emulation = await page.context().newCDPSession(page);
  const visions: VisionRatios[] = [];
  try {
    for (const vision of VISIONS) {
      await emulation.send("Emulation.setEmulatedVisionDeficiency", { type: vision === "normal" ? "none" : vision });
      const image = PNG.sync.read(await page.screenshot({ animations: "disabled" }));
      visions.push(ratiosOf(vision, sideColours(image, first.inkBox, first.box), sideColours(image, second.inkBox, second.box)));
    }
  } finally {
    await emulation.send("Emulation.setEmulatedVisionDeficiency", { type: "none" }).catch(() => undefined);
    await emulation.detach().catch(() => undefined);
    await page.evaluate(([x, y]) => window.scrollTo({ left: x!, top: y!, behavior: "instant" }), scroll).catch(() => undefined);
  }
  const other = otherFeatures(first.features, second.features);
  const measured = visions.filter((entry): entry is VisionRatios & { ratio: number } => entry.ratio !== null);
  const lowest = measured.length > 0 ? measured.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low)) : null;
  const say = (side: Found): Side => ({ tag: side.tag, text: side.text, where: side.where });
  return { pair: against ? "two-elements" : "link-in-text", first: say(first), second: say(second), visions, lowest: lowest ? { vision: lowest.vision, ratio: lowest.ratio } : null, other, lead: isLead(visions, other) };
}
