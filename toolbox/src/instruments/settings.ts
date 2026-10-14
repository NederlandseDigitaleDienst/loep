import type { Page } from "playwright";
import { axInfo, call } from "../browser/call.ts";
import type { States } from "../lib/rundata.ts";
import { contextState, SETTLE_MS, type Described } from "./activate.ts";

const MAX_SETTINGS = 60;

export interface SettingsProbeOptions {
  label: string;
  openedVia: string | null;
  /** Kinds of control that were changed before; shared by the caller, so each kind is changed once in a run. */
  seen: Set<string>;
}

/**
 * Change every kind of checkbox, switch, radio button and select list that is visible now,
 * and record what assistive technology is told and whether the context changes (WCAG 4.1.2 and 3.2.2).
 */
export async function probeSettings(page: Page, options: SettingsProbeOptions): Promise<NonNullable<States["settings"]>> {
  const { label, openedVia, seen } = options;
  const results: NonNullable<States["settings"]> = [];
  const controls = await call<(Described & { type: string | null; options: number | null })[]>(page, "settingControls");
  for (const control of controls) {
    const key = `${control.tag}|${control.type}|${control.region}|${openedVia}|${control.text.slice(0, 30)}|${String(control.ariaLabel).slice(0, 30)}`;
    if (seen.has(key) || seen.size >= MAX_SETTINGS) continue;
    seen.add(key);
    const cdp = await page.context().newCDPSession(page);
    const read = async (): Promise<string> => {
      // Element references shift with every in-page call; look the control up again by its path.
      const ref = await page.evaluate((chain) => {
        const library = (window as unknown as { __loep: { resolve: (chain: string[]) => Element | null; registry: Element[] } }).__loep;
        const element = library.resolve(chain);
        if (!element) return -1;
        library.registry.push(element);
        return library.registry.length - 1;
      }, control.path);
      const info = ref >= 0 ? await axInfo(cdp, ref) : null;
      if (!info) return "onbekend";
      const state = ["checked", "selected", "pressed", "expanded"].filter((name) => name in info.properties).map((name) => `${name}=${String(info.properties[name])}`);
      const value = await page.evaluate((chain) => {
        const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLSelectElement | null } }).__loep.resolve(chain);
        return element && element.localName === "select" ? (element.selectedOptions[0]?.textContent?.trim() ?? "") : null;
      }, control.path);
      return [`rol ${info.role}`, ...state, ...(value !== null ? [`gekozen "${value}"`] : [])].join(", ");
    };
    try {
      const contextBefore = await contextState(page);
      const stateBefore = await read();
      const handle = (await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), control.path)).asElement();
      if (!handle) continue;
      if (control.tag === "select") {
        const index = await handle.evaluate((element) => ((element as HTMLSelectElement).selectedIndex + 1) % Math.max(1, (element as HTMLSelectElement).options.length));
        await handle.selectOption({ index }).catch(() => undefined);
      } else {
        await handle.focus().catch(() => undefined);
        await page.keyboard.press("Space");
      }
      await page.waitForTimeout(SETTLE_MS);
      const stateAfter = await read().catch(() => "onbekend");
      const contextAfter = await contextState(page).catch(() => `adres ${page.url()}`);
      results.push({
        page: label,
        openedVia,
        control: `${control.tag}${control.type ? `[${control.type}]` : ""} "${(control.text || String(control.ariaLabel ?? "")).slice(0, 50)}" [${control.region ?? "-"}]`,
        kind: control.tag === "select" ? "keuzelijst: andere optie gekozen" : "spatiebalk ingedrukt",
        stateBefore,
        stateAfter,
        stateChanged: stateBefore !== stateAfter,
        contextChange: contextBefore === contextAfter ? null : contextAfter,
      });
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }
  return results;
}
