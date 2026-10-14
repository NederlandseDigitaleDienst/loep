import { join } from "node:path";
import type { Page } from "playwright";
import { axInfo, call, handleFor } from "../browser/call.ts";

export interface Described {
  ref: number;
  tag: string;
  text: string;
  path: string[];
  region: string | null;
  box: { x: number; y: number; width: number; height: number };
  [key: string]: unknown;
}

export const where = (element: { path: string[] }): string => element.path.join(" >>> ");
export const SETTLE_MS = 450;

/** Find the element on a fresh page and activate it the way a keyboard user would. */
export async function activate(page: Page, path: string[]): Promise<{ found: boolean; by: "Enter" | "Space" | "click" | null }> {
  const present = await page.evaluate((chain) => {
    const library = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; registry: Element[] } }).__loep;
    const element = library.resolve(chain);
    if (!element) return false;
    library.registry.length = 0;
    library.registry.push(element);
    element.focus();
    return true;
  }, path);
  if (!present) return { found: false, by: null };
  const snapshot = (): Promise<string> =>
    page.evaluate(() => {
      const library = (window as unknown as { __loep: { visibleDialogs: () => unknown[]; registry: Element[] } }).__loep;
      const trigger = library.registry[0];
      const details = trigger?.closest("details");
      return JSON.stringify([library.visibleDialogs().length, trigger?.getAttribute("aria-expanded"), trigger?.getAttribute("aria-selected"), details?.open ?? null, location.href]);
    });
  const before = await snapshot();
  for (const key of ["Enter", "Space"] as const) {
    await page.keyboard.press(key);
    await page.waitForTimeout(SETTLE_MS);
    if ((await snapshot()) !== before) return { found: true, by: key };
  }
  const handle = await handleFor(page, 0);
  await handle?.click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  return { found: true, by: (await snapshot()) !== before ? "click" : null };
}

/**
 * What an expander or a tab reveals is on screen only while it is open, and is in no other
 * screenshot. Scroll the trigger to the top of the window, so the revealed content below it is in the picture.
 */
export async function revealedScreenshot(page: Page, outDir: string, file: string): Promise<string> {
  await page.evaluate(() => {
    const trigger = (window as unknown as { __loep: { registry: Element[] } }).__loep.registry[0];
    if (trigger) window.scrollBy({ top: trigger.getBoundingClientRect().top - 120, behavior: "instant" });
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(outDir, file), animations: "disabled" });
  return file;
}

export async function namesWithin(page: Page, containerRef: number): Promise<{ role: string | null; name: string | null }[]> {
  const elements = await call<Described[]>(page, "interactiveWithin", containerRef);
  const cdp = await page.context().newCDPSession(page);
  const names: { role: string | null; name: string | null }[] = [];
  for (const element of elements.slice(0, 60)) {
    const info = await axInfo(cdp, element.ref);
    names.push({ role: info?.role ?? element.tag, name: info?.name ?? null });
  }
  await cdp.detach();
  return names;
}

/** Where the user is: the address and how many dialogs are open. A change here is a change of context. */
export function contextState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const library = (window as unknown as { __loep: { visibleDialogs: () => unknown[] } }).__loep;
    return `adres ${location.href}, ${library.visibleDialogs().length} vensters open`;
  });
}
