import type { Page } from "playwright";
import { runEngines } from "../lib/engines.ts";
import type { States } from "../lib/rundata.ts";
import { contextState } from "./activate.ts";
import { changeNl, compareChange, hasChange, onlyDigitsChanged, patternsOf, readChangeState, volatileText, type Change } from "./change.ts";

export const KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789", "/", "?", ".", ",", "-", "="];

export interface KeyReaction {
  key: string;
  /** What the key did, in one line. */
  change: string;
  index: number;
  details: Change;
}

const AFTER_KEY_MS = 80;
const IDLE_MS = 400;

/**
 * Press the keys one by one, with focus on the page itself, until the page reacts
 * (WCAG 2.1.4). A reaction is anything a user would notice: text that appears or goes, a
 * state that flips (a panel that expands, a player that pauses, a switch), a dialog, focus,
 * scrolling or another address. Text that changes by itself, such as a clock, is not one.
 * After a reaction the page is no longer in its starting state: the caller continues on a
 * fresh page with the keys after `index`. Null when no key did anything.
 */
export async function firstKeyReaction(page: Page, keys: string[]): Promise<KeyReaction | null> {
  let before = await readChangeState(page);
  await page.waitForTimeout(IDLE_MS);
  let rest = await readChangeState(page);
  const volatile = volatileText(before, rest);
  before = rest;
  for (const [index, key] of keys.entries()) {
    await page.keyboard.press(key);
    await page.waitForTimeout(AFTER_KEY_MS);
    const after = await readChangeState(page);
    const details = compareChange(before, after, volatile);
    if (!hasChange(details)) continue;
    // Only text changed: make sure it was the key. A page that also changes while nothing is pressed gets that text set aside.
    if (!hasChange(details, ["url", "dialogs", "states", "scroll", "focus"])) {
      // A countdown that ticked while the key was pressed.
      if (onlyDigitsChanged(details)) {
        for (const entry of patternsOf(details)) volatile.add(entry);
        before = after;
        continue;
      }
      await page.waitForTimeout(IDLE_MS);
      rest = await readChangeState(page);
      // Text that was already known to change by itself does not count here either.
      if (hasChange(compareChange(after, rest, volatile), ["text"])) {
        for (const entry of [...volatileText(after, rest), ...volatileText(before, after)]) volatile.add(entry);
        before = rest;
        continue;
      }
    }
    return { key, index, change: changeNl(details)!, details };
  }
  return null;
}

/**
 * Take focus out of a field that takes text: a letter typed there is input, not a shortcut.
 * An opened dialog often puts focus in its first field. Says where focus was and whether it was taken away.
 */
export function leaveTextEntry(page: Page): Promise<{ focusWas: string | null; moved: boolean }> {
  return page.evaluate(() => {
    const loep = (window as unknown as { __loep: { deepActiveElement: () => HTMLElement | null; describe: (element: Element) => { tag: string; text: string; path: string[] } } }).__loep;
    const active = loep.deepActiveElement();
    if (!active || active === document.body || active === document.documentElement) return { focusWas: null, moved: false };
    const described = loep.describe(active);
    const typing = active.matches("input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=image]):not([type=file]):not([type=range]):not([type=color]),textarea,select,[contenteditable=''],[contenteditable=true],[role=textbox],[role=searchbox],[role=combobox],[role=listbox]");
    if (typing) active.blur();
    return { focusWas: `${described.tag} "${described.text.slice(0, 40)}" ${described.path.join(" >>> ")}`, moved: typing };
  });
}

type ArrowWalk = { from: string; key: string; reached: unknown[] };

/** Repeat one arrow-key walk from the keyboard probe and watch whether focus alone changes the context. Null when the starting element is gone. */
export async function probeArrowFocus(page: Page, walk: ArrowWalk, label: string): Promise<NonNullable<States["arrowFocus"]>[number] | null> {
  const focused = await page.evaluate((chain) => {
    const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
    element?.focus();
    return element !== null;
  }, walk.from.split(" >>> "));
  if (!focused) return null;
  const before = await contextState(page);
  let change: string | null = null;
  for (let step = 0; step < walk.reached.length; step++) {
    await page.keyboard.press(walk.key);
    await page.waitForTimeout(120);
    const now = await contextState(page).catch(() => `adres ${page.url()}`);
    if (now !== before) {
      change = `na ${step + 1} keer ${walk.key}: ${now}`;
      break;
    }
  }
  return { page: label, fromTabStop: walk.from, key: walk.key, steps: walk.reached.length, contextChange: change };
}

/**
 * What the test browser itself registers on a page once it takes screenshots, runs the
 * engines and operates the mouse: measured on an empty page, so it can be told apart
 * from what a site registers. The page must be new; it is navigated to an empty document.
 */
export async function browserListeners(page: Page): Promise<Record<string, Record<string, number>>> {
  await page.goto("data:text/html,<title>leeg</title><button>knop</button>");
  await page.screenshot();
  await runEngines(page);
  await page.mouse.move(5, 5);
  await page.locator("button").hover();
  await page.locator("body").ariaSnapshot();
  return await page.evaluate(() => {
    const library = (window as unknown as { __loep: { collectFacts: () => unknown; listenerCounts: () => Record<string, Record<string, number>> } }).__loep;
    return library.listenerCounts();
  });
}
