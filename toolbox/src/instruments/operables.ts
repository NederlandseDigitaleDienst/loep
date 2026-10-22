import type { Frame, Page } from "playwright";
import { call } from "../browser/call.ts";
import type { LooksOperable, OperableGroup } from "../lib/operables.ts";

interface FramePlace {
  path: string;
  structural: string;
  region: string | null;
  inMain: boolean;
  visible: boolean;
  title: string;
}

/** Origin and path of a frame, as the site model names it. */
function addressOf(frame: Frame): string | null {
  try {
    const parsed = new URL(frame.url());
    return parsed.protocol.startsWith("http") ? `${parsed.origin}${parsed.pathname}` : null;
  } catch {
    return null;
  }
}

/** The names of what there is to operate in a frame and the frames inside it. Empty when there is nothing, or the frame cannot be read. */
async function namesInFrame(frame: Frame): Promise<string[]> {
  const names: string[] = [];
  const own = await frame.evaluate(() => (window as unknown as { __loep?: { operables: () => { text: string; members: unknown[] }[] } }).__loep?.operables() ?? []).catch(() => []);
  for (const group of own) names.push(...(group.text ? group.text.split(", ") : group.members.map(() => "")));
  for (const child of frame.childFrames()) names.push(...(await namesInFrame(child)));
  return names;
}

/** What looks operable on the page as it is now without a role and without a Tab stop, such as a slider built from a track and a thumb. */
export async function pageLooksOperable(page: Page): Promise<LooksOperable[]> {
  const found = await call<{ path: string[]; text: string; region: string | null; signals: string[]; html: string }[]>(page, "looksOperable");
  return found.map((entry) => ({ path: entry.path.join(" >>> "), text: entry.text, region: entry.region, signals: entry.signals, html: entry.html }));
}

/**
 * Everything a visitor can operate on the page as it is now: the groups the in-page library
 * counts, and one group for every visible embedded window that has controls of its own.
 * Such a window stands in the page and the visitor has to use it, whoever it belongs to.
 */
export async function pageOperables(page: Page): Promise<OperableGroup[]> {
  const groups = await call<OperableGroup[]>(page, "operables");
  for (const frame of page.mainFrame().childFrames()) {
    if (frame.isDetached()) continue;
    const address = addressOf(frame);
    if (!address) continue;
    const names = await namesInFrame(frame);
    if (names.length === 0) continue;
    const place = await frame
      .frameElement()
      .then((element) =>
        element.evaluate((node): FramePlace => {
          const loep = (window as unknown as { __loep: { describe: (element: Element) => { path: string[]; region: string | null; visible: boolean } } }).__loep;
          const described = loep.describe(node as Element);
          const structural: string[] = [];
          for (let current: Element | null = node as Element; current; current = current.parentElement) {
            const siblings: Element[] = current.parentElement ? [...current.parentElement.children].filter((sibling) => sibling.localName === current!.localName) : [];
            structural.unshift(siblings.length > 1 ? `${current.localName}:nth-of-type(${siblings.indexOf(current) + 1})` : current.localName);
          }
          return { path: described.path.join(" >>> "), structural: structural.join(" > "), region: described.region, inMain: (node as Element).closest("main,[role=main]") !== null, visible: described.visible, title: (node as Element).getAttribute("title") ?? (node as Element).getAttribute("aria-label") ?? "" };
        }),
      )
      .catch(() => null);
    if (!place || !place.visible) continue;
    const shown = names.filter(Boolean).slice(0, 4).join(", ");
    groups.push({ key: `frame ${address}`, kind: "frame", path: place.path, region: place.region, inMain: place.inMain, text: `${place.title || "venster zonder titel"}${shown ? `: ${shown}` : ""}`.slice(0, 160), members: [{ path: place.path, structural: place.structural, kind: "frame" }], frame: address, controls: names.length });
  }
  return groups;
}
