import type { CDPSession, ElementHandle, Page } from "playwright";

/** Call a function of the in-page library. Nothing from the toolbox itself exists inside the page. */
export function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([fn, parameters]) => (window as unknown as { __loep: Record<string, (...values: unknown[]) => unknown> }).__loep[fn as string]!(...(parameters as unknown[])),
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
