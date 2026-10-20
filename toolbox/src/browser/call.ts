import type { CDPSession, ElementHandle, Page } from "playwright";
import { ownWorld } from "./world.ts";

/**
 * Whether a library of the toolbox stands on the window as the toolbox leaves it: fixed and frozen (#143).
 * Evaluated in the page, so it names nothing from outside itself.
 */
export const fixedOnWindow = (name: string): boolean => {
  const own = Object.getOwnPropertyDescriptor(window, name);
  return own !== undefined && "value" in own && !own.writable && !own.configurable && typeof own.value === "object" && own.value !== null && Object.isFrozen(own.value);
};

/** Whether a frame has the in-page library as the toolbox installed it, and a body to measure. */
export const readableFrame = (): boolean => {
  const own = Object.getOwnPropertyDescriptor(window, "__loep");
  return own !== undefined && "value" in own && !own.writable && !own.configurable && Object.isFrozen(own.value) && document.body !== null;
};

/** What only the library in the page itself knows or does: what the page registered, its timers and clipboard, and the wider text spacing it is given. */
const IN_PAGE = new Set(["freezeListeners", "listenerCounts", "ownListeners", "timerReport", "clipboardWrites", "applyTextSpacing", "removeTextSpacing"]);

/**
 * Call a function of the in-page library. Nothing from the toolbox itself exists inside the page.
 * It reads in loep's own world, with built-in functions a script of the page cannot replace (#155);
 * what only the page knows, it asks the library in the page. Where that library is not the one the
 * toolbox fixed to the window, the call is refused (#143).
 */
export function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  if (!IN_PAGE.has(name)) {
    return ownWorld(page).evaluate(
      ([fn, parameters]) => {
        const library = (window as unknown as { __loep: Record<string, (...values: unknown[]) => unknown> & { watched: () => boolean } }).__loep;
        if (!library.watched()) throw new Error("window.__loep is niet de bibliotheek die loep in de pagina zette; wat ermee zou worden gemeten, kan niet worden vastgesteld");
        return library[fn as string]!(...(parameters as unknown[]));
      },
      [name, args] as const,
    ) as Promise<T>;
  }
  return page.evaluate(
    ([fn, parameters]) => {
      const own = Object.getOwnPropertyDescriptor(window, "__loep");
      if (own === undefined || !("value" in own) || own.writable || own.configurable || !Object.isFrozen(own.value)) throw new Error("window.__loep is niet de bibliotheek die loep in de pagina zette; wat ermee zou worden gemeten, kan niet worden vastgesteld");
      return (own.value as Record<string, (...values: unknown[]) => unknown>)[fn as string]!(...(parameters as unknown[]));
    },
    [name, args],
  ) as Promise<T>;
}

/** Handle to an element that the in-page library registered under a reference number. */
export async function handleFor(page: Page, ref: number): Promise<ElementHandle<HTMLElement> | null> {
  const handle = await page.evaluateHandle((index) => (window as unknown as { __loep: { registry: Element[] } }).__loep.registry[index] ?? null, ref);
  return handle.asElement() as ElementHandle<HTMLElement> | null;
}

export interface AxInfo {
  role: string | null;
  name: string | null;
  description: string | null;
  ignored: boolean;
  properties: Record<string, unknown>;
}

/** What assistive technology gets for an element, straight from the browser's accessibility tree. */
export async function axInfo(cdp: CDPSession, ref: number): Promise<AxInfo | null> {
  const { result } = await cdp.send("Runtime.evaluate", { expression: `window.__loep.registry[${ref}]` });
  if (!result.objectId) return null;
  try {
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const node = nodes[0];
    if (!node) return null;
    return {
      role: (node.role?.value as string | undefined) ?? null,
      name: (node.name?.value as string | undefined) ?? null,
      description: (node.description?.value as string | undefined) ?? null,
      ignored: node.ignored,
      properties: Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value.value])),
    };
  } catch {
    return null;
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => undefined);
  }
}
