import type { Page } from "playwright";

export interface OrderItem {
  tag: string;
  text: string;
  path: string[];
  region: string | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface OrderReport {
  note: string;
  /** Controls and headings in the order of the code, which is the order a keyboard and a screen reader follow. */
  sequence: (OrderItem & { index: number; kind: "control" | "heading" })[];
  /** Places where the next item in the code is drawn above or to the left of the previous one. Candidates, not findings. */
  jumps: { from: number; to: number; direction: "omhoog" | "naar links" }[];
  /** Elements that CSS moves away from their place in the code. */
  cssOrder: (OrderItem & { order: string })[];
  reversed: (OrderItem & { flexDirection: string; flexWrap: string })[];
  positioned: (OrderItem & { position: string })[];
  positiveTabindex: (OrderItem & { tabindex: string })[];
}

const MAX_SEQUENCE = 200;
const MAX_LISTED = 40;

/**
 * Order of the code against the order on screen (WCAG 1.3.2 and 2.4.3): where the sequence
 * of controls and headings jumps back on the page, and every element that CSS reorders
 * with `order`, a reversed flex direction or absolute placement.
 */
export async function visualOrder(page: Page): Promise<OrderReport> {
  const found = await page.evaluate(
    ([maxSequence, maxListed]) => {
      type Library = {
        deepElements: (root?: Node) => Iterable<HTMLElement>;
        deepQueryAll: (selector: string) => HTMLElement[];
        isVisible: (element: Element) => boolean;
        hoverTargets: () => { ref: number }[];
        describe: (element: Element) => { tag: string; text: string; path: string[]; region: string | null; box: { x: number; y: number; width: number; height: number } };
        registry: HTMLElement[];
      };
      const library = (window as unknown as { __loep: Library }).__loep;
      const brief = (element: Element) => {
        const { tag, text, path, region, box } = library.describe(element);
        return { tag, text: text.slice(0, 60), path, region, box };
      };
      const kinds = new Map<Element, "control" | "heading">();
      for (const described of library.hoverTargets()) kinds.set(library.registry[described.ref]!, "control");
      for (const heading of library.deepQueryAll("h1,h2,h3,h4,h5,h6,[role=heading]")) if (library.isVisible(heading) && !kinds.has(heading)) kinds.set(heading, "heading");

      const sequence = [];
      const cssOrder = [];
      const reversed = [];
      const positioned = [];
      const positiveTabindex = [];
      for (const element of library.deepElements(document.body)) {
        if (!library.isVisible(element)) continue;
        const kind = kinds.get(element);
        if (kind) {
          const item = brief(element);
          // Parked far off screen, such as a skip link before it has focus: it has no place in the picture.
          if (item.box.x + item.box.width > 0 && item.box.y + item.box.height > 0) sequence.push({ ...item, kind });
        }
        const style = getComputedStyle(element);
        if (style.order !== "0") cssOrder.push({ ...brief(element), order: style.order });
        if (style.display.includes("flex") && (style.flexDirection.endsWith("reverse") || style.flexWrap === "wrap-reverse")) reversed.push({ ...brief(element), flexDirection: style.flexDirection, flexWrap: style.flexWrap });
        const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim());
        if ((style.position === "absolute" || style.position === "fixed") && (ownText || kind === "control")) positioned.push({ ...brief(element), position: style.position });
        if (Number(element.getAttribute("tabindex")) > 0) positiveTabindex.push({ ...brief(element), tabindex: element.getAttribute("tabindex")! });
      }
      return {
        sequence: sequence.slice(0, maxSequence!).map((item, index) => ({ ...item, index: index + 1 })),
        cssOrder: cssOrder.slice(0, maxListed!),
        reversed: reversed.slice(0, maxListed!),
        positioned: positioned.slice(0, maxListed!),
        positiveTabindex: positiveTabindex.slice(0, maxListed!),
      };
    },
    [MAX_SEQUENCE, MAX_LISTED],
  );
  const jumps: OrderReport["jumps"] = [];
  for (const [position, item] of found.sequence.entries()) {
    const previous = found.sequence[position - 1];
    if (!previous) continue;
    const sameRow = item.box.y < previous.box.y + previous.box.height && previous.box.y < item.box.y + item.box.height;
    if (item.box.y + item.box.height <= previous.box.y) jumps.push({ from: previous.index, to: item.index, direction: "omhoog" });
    else if (sameRow && item.box.x + item.box.width <= previous.box.x) jumps.push({ from: previous.index, to: item.index, direction: "naar links" });
  }
  return {
    note: "Volgorde van de code tegenover de plek op het scherm. Een sprong omhoog of naar links is een kandidaat: bij kolommen hoort hij erbij, bij een rij die CSS omdraait niet.",
    ...found,
    jumps,
  };
}
