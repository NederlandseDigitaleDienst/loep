import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext, CDPSession, Frame, Keyboard, Mouse, Page } from "playwright";
import { PNG } from "pngjs";

type Box = { x: number; y: number; width: number; height: number };
type ScreenshotOptions = NonNullable<Parameters<Page["screenshot"]>[0]>;

/**
 * Where an embedded frame shows its document: the inside of the frame element, in pixels of the
 * window of the tab, and how many of those one pixel of the frame takes across and down.
 */
async function contentBox(frame: Frame): Promise<(Box & { scale: { x: number; y: number } }) | null> {
  const element = await frame.frameElement();
  try {
    const box = await element.boundingBox();
    if (!box) return null;
    const own = await element.evaluate((node) => {
      const style = getComputedStyle(node as Element);
      const edge = (side: "Left" | "Top" | "Right" | "Bottom"): number => (parseFloat(style[`border${side}Width`]) || 0) + (parseFloat(style[`padding${side}`]) || 0);
      return { left: edge("Left"), top: edge("Top"), right: edge("Right"), bottom: edge("Bottom"), width: (node as HTMLElement).offsetWidth, height: (node as HTMLElement).offsetHeight };
    });
    // A CSS zoom or scale around the frame element shows it, and its document with it, at another size than its own pixels; its border and padding are in those pixels too.
    const scale = { x: own.width > 0 ? box.width / own.width : 1, y: own.height > 0 ? box.height / own.height : 1 };
    const inset = { left: own.left * scale.x, top: own.top * scale.y, right: own.right * scale.x, bottom: own.bottom * scale.y };
    return { x: box.x + inset.left, y: box.y + inset.top, width: Math.max(0, box.width - inset.left - inset.right), height: Math.max(0, box.height - inset.top - inset.bottom), scale };
  } finally {
    await element.dispose().catch(() => undefined);
  }
}

/** A picture of a frame shown at another size, brought to the pixels of the frame: each pixel takes the pixel the tab shows there. */
function toFramePixels(shown: PNG, scale: { x: number; y: number }): Buffer {
  const picture = new PNG({ width: Math.max(1, Math.round(shown.width / scale.x)), height: Math.max(1, Math.round(shown.height / scale.y)) });
  for (let y = 0; y < picture.height; y++) {
    const from = Math.min(shown.height - 1, Math.floor((y * shown.height) / picture.height));
    for (let x = 0; x < picture.width; x++) {
      const source = (from * shown.width + Math.min(shown.width - 1, Math.floor((x * shown.width) / picture.width))) << 2;
      shown.data.copy(picture.data, (y * picture.width + x) << 2, source, source + 4);
    }
  }
  return PNG.sync.write(picture);
}

/**
 * A protocol session in which `window` is the window of the frame. A frame in a process of its
 * own has its own session. Any other frame shares the session of the frame above it; there
 * the script context of the frame is looked up and every script is run in it.
 */
async function frameSession(context: BrowserContext, page: Page, frame: Frame): Promise<CDPSession> {
  const own = await context.newCDPSession(frame).catch(() => null);
  if (own) return own;
  let holder: Frame | null = frame.parentFrame();
  let session: CDPSession | null = null;
  for (; holder && !session; holder = holder.parentFrame()) session = holder.parentFrame() ? await context.newCDPSession(holder).catch(() => null) : await context.newCDPSession(page);
  if (!session) throw new Error("het ingesloten venster is niet te bereiken");
  const token = `${Date.now()}-${Math.random()}`;
  await frame.evaluate((value) => void ((window as unknown as { __loepFrame?: string }).__loepFrame = value), token);
  try {
    const candidates: number[] = [];
    session.on("Runtime.executionContextCreated", (event) => {
      if ((event.context.auxData as { isDefault?: boolean } | undefined)?.isDefault) candidates.push(event.context.id);
    });
    await session.send("Runtime.enable");
    let contextId: number | null = null;
    for (const id of candidates) {
      const found = await session.send("Runtime.evaluate", { expression: "window.__loepFrame", contextId: id, returnByValue: true }).catch(() => null);
      if (found?.result.value === token) contextId = id;
    }
    if (contextId === null) throw new Error("het ingesloten venster is niet te bereiken");
    const inside = session;
    return new Proxy(session, {
      get(target, key) {
        if (key === "send") return (method: string, parameters?: Record<string, unknown>) => (inside.send as (method: string, parameters?: unknown) => Promise<unknown>)(method, method === "Runtime.evaluate" ? { ...parameters, contextId } : parameters);
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } finally {
    await frame.evaluate(() => void delete (window as unknown as { __loepFrame?: string }).__loepFrame).catch(() => undefined);
  }
}

/**
 * An embedded frame as a page of its own, so that everything that measures or operates a page
 * does the same inside a frame without knowing about frames. Scripts run in the document of the
 * frame, also when it comes from another origin. Positions are those of the frame: its own
 * window and its own document. A picture and the pointer are moved to where the frame stands
 * in the tab. A key goes to whatever has focus in the frame; while focus is elsewhere in the
 * tab it is first put at the start of the document of the frame, where a visitor arrives who
 * walks into it with Tab.
 *
 * A picture shows what the frame shows: a part of its document that lies outside its own
 * window is scrolled into it first, and what does not fit in that window is not in the picture.
 */
export async function frameAsPage(page: Page, frame: Frame): Promise<Page> {
  const size = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const top = page.mainFrame();
  const scrollOf = (target: Frame): Promise<[number, number]> => target.evaluate(() => [window.scrollX, window.scrollY] as [number, number]);
  const scrollTo = (target: Frame, to: [number, number]): Promise<void> => target.evaluate(([left, topEdge]) => window.scrollTo({ left: left!, top: topEdge!, behavior: "instant" }), to);

  const screenshot = async (options: ScreenshotOptions = {}): Promise<Buffer> => {
    const { fullPage, clip, ...rest } = options;
    const frameWas = await scrollOf(frame);
    const topWas = await scrollOf(top);
    try {
      let wanted: Box = clip ?? { x: 0, y: 0, width: size.width, height: size.height };
      if (fullPage) {
        // Positions in the document of the frame: the part that is asked for is brought into the window of the frame.
        const visible = wanted.x >= frameWas[0] && wanted.y >= frameWas[1] && wanted.x + wanted.width <= frameWas[0] + size.width && wanted.y + wanted.height <= frameWas[1] + size.height;
        if (!visible) await scrollTo(frame, [wanted.x, wanted.y]);
        const now = await scrollOf(frame);
        wanted = { ...wanted, x: wanted.x - now[0], y: wanted.y - now[1] };
      }
      const left = Math.max(0, wanted.x);
      const topEdge = Math.max(0, wanted.y);
      const inFrame = { x: left, y: topEdge, width: Math.min(size.width, wanted.x + wanted.width) - left, height: Math.min(size.height, wanted.y + wanted.height) - topEdge };
      if (inFrame.width <= 0 || inFrame.height <= 0) throw new Error("dit deel valt buiten wat het ingesloten venster toont");
      let origin = await contentBox(frame);
      if (!origin) throw new Error("het ingesloten venster is niet zichtbaar op de pagina");
      const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
      const shown = { width: inFrame.width * origin.scale.x, height: inFrame.height * origin.scale.y };
      // The frame itself may stand outside the window of the tab, or only partly in it.
      const x = origin.x + inFrame.x * origin.scale.x;
      const y = origin.y + inFrame.y * origin.scale.y;
      const byX = x < 0 || x + shown.width > viewport.width ? x : 0;
      const byY = y < 0 || y + shown.height > viewport.height ? y : 0;
      if (byX !== 0 || byY !== 0) {
        await top.evaluate(([left, topEdge]) => window.scrollBy({ left: left!, top: topEdge!, behavior: "instant" }), [byX, byY] as const);
        origin = (await contentBox(frame)) ?? origin;
      }
      const area = { x: origin.x + inFrame.x * origin.scale.x, y: origin.y + inFrame.y * origin.scale.y, ...shown };
      if (Math.abs(origin.scale.x - 1) < 0.001 && Math.abs(origin.scale.y - 1) < 0.001) return await page.screenshot({ ...rest, clip: area });
      // Whoever reads the picture finds an element in it by its position in the frame: the picture is brought to the pixels of the frame.
      const { path, ...unsaved } = rest;
      const image = toFramePixels(PNG.sync.read(await page.screenshot({ ...unsaved, clip: area })), origin.scale);
      if (path) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, image);
      }
      return image;
    } finally {
      await scrollTo(top, topWas).catch(() => undefined);
      await scrollTo(frame, frameWas).catch(() => undefined);
    }
  };

  const moved = async (x: number, y: number): Promise<[number, number]> => {
    const origin = await contentBox(frame);
    if (!origin) throw new Error("het ingesloten venster is niet zichtbaar op de pagina");
    return [origin.x + x * origin.scale.x, origin.y + y * origin.scale.y];
  };
  const mouse = new Proxy(page.mouse, {
    get(target, key) {
      if (key === "move" || key === "click" || key === "dblclick") return async (x: number, y: number, options?: unknown) => (target[key] as (x: number, y: number, options?: unknown) => Promise<void>)(...(await moved(x, y)), options);
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Mouse;

  const intoFrame = async (): Promise<void> => {
    if (await frame.evaluate(() => document.hasFocus()).catch(() => true)) return;
    const element = await frame.frameElement();
    await element.focus().catch(() => undefined);
    await element.dispose().catch(() => undefined);
    // A browser goes on from where focus last was in the frame, also after it left; the body takes it for a moment.
    await frame
      .evaluate(() => {
        const previous = document.body.getAttribute("tabindex");
        document.body.setAttribute("tabindex", "-1");
        document.body.focus({ preventScroll: true });
        if (previous === null) document.body.removeAttribute("tabindex");
        else document.body.setAttribute("tabindex", previous);
      })
      .catch(() => undefined);
  };
  const keyboard = new Proxy(page.keyboard, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        await intoFrame();
        return (value as (...values: unknown[]) => Promise<void>).apply(target, args);
      };
    },
  }) as Keyboard;

  const context = new Proxy(page.context(), {
    get(target, key) {
      if (key === "newCDPSession") return () => frameSession(target, page, frame);
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const own: Record<string | symbol, unknown> = {
    evaluate: frame.evaluate.bind(frame),
    evaluateHandle: frame.evaluateHandle.bind(frame),
    waitForFunction: frame.waitForFunction.bind(frame),
    waitForLoadState: frame.waitForLoadState.bind(frame),
    locator: frame.locator.bind(frame),
    $: frame.$.bind(frame),
    $$: frame.$$.bind(frame),
    url: () => frame.url(),
    title: () => frame.title(),
    content: () => frame.content(),
    mainFrame: () => frame,
    frames: () => {
      const all: Frame[] = [];
      const visit = (current: Frame): void => {
        all.push(current);
        for (const child of current.childFrames()) visit(child);
      };
      visit(frame);
      return all;
    },
    viewportSize: () => size,
    screenshot,
    keyboard,
    mouse,
    context: () => context,
  };
  return new Proxy(page, {
    get(target, key) {
      if (key in own) return own[key];
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** What a record says about the frame an element sits in. */
export interface FrameRecord {
  /** Address of the document in the frame. */
  url: string;
  origin: string;
  /** Title of the frame element, as a visitor with a screen reader hears it. */
  title: string | null;
}

export async function frameRecord(frame: Frame): Promise<FrameRecord> {
  const url = frame.url();
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    // An address without an origin, such as about:srcdoc.
  }
  const title = await frame
    .frameElement()
    .then((element) => element.evaluate((node) => (node as Element).getAttribute("title") ?? (node as Element).getAttribute("aria-label")))
    .catch(() => null);
  return { url, origin, title };
}
