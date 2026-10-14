import { join } from "node:path";
import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import type { States } from "../lib/rundata.ts";
import type { Described } from "./activate.ts";
import { COLOURED_ON_HOVER, elementContrast } from "./contrast.ts";

export interface HoverProbeOptions {
  /** Label of the page in dossiers and reports. */
  label: string;
  /** Directory that the screenshot paths in the result are relative to. */
  outDir: string;
  /** Relative path of the screenshot for content that appeared on hover or on focus. */
  screenshot: (trigger: "hover" | "focus") => string;
  /** When given: the contrast of the text of a link or button while it is pointed at and while it has focus is added here (WCAG 1.4.3). */
  contrast?: NonNullable<States["hoverContrast"]>;
}

/** Point at one control and give it focus, and record content that appears and whether Escape dismisses it (WCAG 1.4.13). */
export async function probeHoverTarget(page: Page, target: Described, options: HoverProbeOptions): Promise<States["hover"]> {
  const hover: States["hover"] = [];
  for (const trigger of ["hover", "focus"] as const) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = new Set(await call<string[]>(page, "textChunks"));
    const dialogsBefore = (await call<unknown[]>(page, "visibleDialogs")).length;
    const element = await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), target.path);
    const handle = element.asElement();
    if (!handle) break;
    if (trigger === "hover") await handle.hover({ timeout: 1500 }).catch(() => undefined);
    else await handle.focus().catch(() => undefined);
    await page.waitForTimeout(700);
    const appeared = (await call<string[]>(page, "textChunks")).filter((chunk) => !before.has(chunk));
    const dialogsAfter = (await call<unknown[]>(page, "visibleDialogs")).length;
    if (options.contrast && COLOURED_ON_HOVER(target)) {
      // Measured on the window as it is, with the pointer or focus still on the control, and after the new content was read: measuring may scroll.
      const measured = await elementContrast(page, target.path).catch(() => null);
      if (measured && measured.text.length > 0) options.contrast.push({ page: options.label, control: `${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`, where: target.path.join(" >>> "), trigger, texts: measured.text.map((entry) => ({ text: entry.text.slice(0, 60), foreground: entry.foreground, background: entry.background, ratio: entry.ratio, required: entry.required, outcome: entry.outcome, reason: entry.reason })) });
    }
    if (appeared.length === 0 && dialogsAfter === dialogsBefore) continue;
    const shot = options.screenshot(trigger);
    await page.screenshot({ path: join(options.outDir, shot), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const afterEscape = new Set(await call<string[]>(page, "textChunks"));
    hover.push({
      page: options.label,
      control: `${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`,
      newContent: appeared.join(" | ").slice(0, 300),
      trigger,
      dismissedByEscape: appeared.length > 0 ? appeared.every((chunk) => !afterEscape.has(chunk)) : null,
      // Moving the pointer onto content that sits elsewhere on the page needs its position, which is not recorded yet.
      staysWhenPointerMovesOntoIt: null,
      screenshot: shot,
    });
  }
  return hover;
}
