import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Frame, Page } from "playwright";
import { readJson } from "../lib/canonical.ts";
import { frameAddress, type Postcondition } from "../lib/sitemodel.ts";
import { runSteps, type LastStepSpeech, type Recipe } from "./daemon.ts";
import { Images, type StartState, type Step } from "./observations.ts";
import { DEFAULT_DAEMON_LIMITS, Politeness, scopeForRun, type DaemonLimits } from "./safety.ts";
import { openSurface, SESSION_INPAGE_PATH, topSurface, type Env, type Surface } from "./surface.ts";

/**
 * Recipes outside a session: the same steps an agent saved, replayed by a script. The
 * sweep uses this to close what covers a page and to open a component before measuring;
 * `check-site` uses it to find out whether a recipe does what the site model says.
 */

/** A window covered for less than this share counts as not covered. */
export const NOT_COVERING_SHARE = 0.05;
/** More steps than this is not a way to open one thing, but a walk through the site. */
export const MAX_RECIPE_STEPS = 15;

export async function loadRecipes(runDir: string): Promise<Record<string, Recipe>> {
  const dir = join(runDir, "recipes");
  const recipes: Record<string, Recipe> = {};
  if (!existsSync(dir)) return recipes;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) recipes[file.slice(0, -5)] = await readJson<Recipe>(join(dir, file));
  return recipes;
}

/** Everything a replay shares with a session: the scope of the run and the spacing between navigations. */
export async function replayEnv(browser: Browser, runDir: string, limits: Partial<DaemonLimits> = {}): Promise<Env> {
  const all = { ...DEFAULT_DAEMON_LIMITS, ...limits };
  return { browser, runDir, scope: await scopeForRun(runDir, {}), limits: all, politeness: new Politeness(all.navigationDelayMs) };
}

/** A browser context of the sweep needs the session's part of the in-page library before a recipe can run in it. */
export async function installReplay(context: BrowserContext): Promise<void> {
  await context.addInitScript({ path: SESSION_INPAGE_PATH });
}

/** Treat a page the sweep loaded as the page of a session, so recorded steps can run on it. */
export function adoptPage(context: BrowserContext, page: Page, scheme: StartState["scheme"] = "light"): Surface {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const surface = topSurface({ context, page, guard: { blocked: [], outsideScopeLoaded: {} }, start: { url: page.url(), width: viewport.width, height: viewport.height, scheme }, steps: [], refBase: 0, refs: new Map(), popups: [], alerts: [], navigations: 0, framesNavigated: new Set() });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) surface.navigations++;
    else surface.framesNavigated.add(frame);
  });
  return surface;
}

export interface Held {
  holds: boolean;
  /** What was found, in Dutch: it is shown to the explorer when a recipe is refused. */
  detail: string;
}

/** How long a postcondition may take to come true after the last step: a class that is set with a delay, a list that is filtered after typing. */
export const POSTCONDITION_WAIT_MS = 2500;

/**
 * Whether a postcondition of the site model holds on the page. With `waitMs` the page gets
 * that long to get there; without it the page is judged as it is now.
 */
export async function holds(page: Page, post: Postcondition, waitMs = 0): Promise<Held> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const held = await holdsNow(page, post);
    if (held.holds || Date.now() >= deadline) return held;
    await page.waitForTimeout(250);
  }
}

/** The embedded frame on a page that shows the document at an address of the site model. */
export function frameAt(page: Page, address: string): Frame | undefined {
  return page.frames().find((frame) => {
    try {
      return frame !== page.mainFrame() && frameAddress(frame.url()) === address;
    } catch {
      return false;
    }
  });
}

async function holdsNow(page: Page, post: Postcondition): Promise<Held> {
  // A condition about an embedded frame is checked in the document of that frame.
  const where = post.frame ? frameAt(page, post.frame) : page;
  if (!where) return { holds: false, detail: `het venster ${post.frame} staat niet op de pagina` };
  try {
    return await where.evaluate(
      ([condition, share]) => {
        const loep = (window as unknown as { __loep: { deepQueryAll: (selector: string) => HTMLElement[]; isVisible: (element: Element) => boolean; textChunks: () => string[] } }).__loep;
        const squash = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
        const matches = condition.selector ? loep.deepQueryAll(condition.selector) : [];
        const visible = matches.filter((element) => loep.isVisible(element));
        const count = `${matches.length} element(en) voor "${condition.selector}", waarvan ${visible.length} zichtbaar`;
        switch (condition.kind) {
          case "gone":
            return { holds: visible.length === 0, detail: count };
          case "visible":
            return { holds: visible.length > 0, detail: count };
          case "not-covering": {
            const area = innerWidth * innerHeight;
            let largest = 0;
            for (const element of visible) {
              const rect = element.getBoundingClientRect();
              const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
              const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
              largest = Math.max(largest, (width * height) / area);
            }
            return { holds: largest < share, detail: `${count}; het grootste bedekt ${Math.round(largest * 100)}% van het venster` };
          }
          case "expanded": {
            const open = matches.filter((element) => element.getAttribute("aria-expanded") === "true" || (element.localName === "details" && (element as HTMLDetailsElement).open));
            return { holds: open.length > 0, detail: `${count}; ${open.length} met aria-expanded="true" of een open details` };
          }
          case "dialog-open": {
            const dialogs = loep.deepQueryAll("dialog,[role=dialog],[role=alertdialog],[popover]").filter((element) => loep.isVisible(element));
            const wanted = condition.selector ? dialogs.filter((element) => element.matches(condition.selector!)) : dialogs;
            return { holds: wanted.length > 0, detail: `${dialogs.length} zichtbare dialoog/dialogen${condition.selector ? `, waarvan ${wanted.length} voor "${condition.selector}"` : ""}` };
          }
          case "text-visible": {
            const found = squash(loep.textChunks().join(" ")).includes(squash(condition.text ?? ""));
            return { holds: found, detail: `de tekst "${condition.text}" is ${found ? "" : "niet "}zichtbaar` };
          }
          case "value": {
            const values = matches.map((element) => String((element as HTMLInputElement).value ?? ""));
            const wanted = condition.text;
            const found = values.some((value) => (wanted === undefined ? value !== "" : value === wanted));
            return { holds: found, detail: `${count}; waarde ${values.length > 0 ? `"${values[0]!.slice(0, 40)}"` : "(geen veld)"}${wanted === undefined ? "" : `, verwacht "${wanted}"`}` };
          }
          case "url-contains":
            return { holds: location.href.includes(condition.text ?? ""), detail: `het adres is ${location.href}` };
          default:
            return { holds: false, detail: `onbekende soort "${String(condition.kind)}"` };
        }
      },
      [post, NOT_COVERING_SHARE] as const,
    );
  } catch (error) {
    const message = (error as Error).message.split("\n")[0]!;
    return { holds: false, detail: /selector/i.test(message) ? `ongeldige selector "${post.selector}"` : `niet te controleren: ${message}` };
  }
}

export interface Replayed {
  ok: boolean;
  /** Why not, in Dutch; null when the steps ran and the postcondition holds. */
  reasonNl: string | null;
  after: Held | null;
}

/** Run recorded steps on a page that is already loaded, and check what they were meant to achieve. */
export async function replaySteps(env: Env, surface: Surface, steps: Step[], post: Postcondition | null, speech?: LastStepSpeech): Promise<Replayed> {
  const scratch = await mkdtemp(join(tmpdir(), "loep-sweep-"));
  try {
    const failed = await runSteps(env, surface, steps, new Images(scratch, "step"), undefined, speech);
    if (failed) return { ok: false, reasonNl: `stap ${failed.index + 1} (${failed.command}) ${failed.reason}`, after: null };
    if (!post) return { ok: true, reasonNl: null, after: null };
    const after = await holds(surface.page, post, POSTCONDITION_WAIT_MS);
    return { ok: after.holds, reasonNl: after.holds ? null : `na de stappen geldt de postconditie niet: ${after.detail}`, after };
  } catch (error) {
    return { ok: false, reasonNl: (error as Error).message.split("\n")[0]!, after: null };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface CleanReplay extends Replayed {
  before: Held | null;
  surface: Surface | null;
}

/**
 * Replay a recipe from a clean page, with every limit of a session in place. The
 * postcondition must not hold before the steps and must hold after them: a condition
 * that is true on a fresh page proves nothing. The caller closes the surface's context.
 */
export async function replayFromClean(env: Env, recipe: Recipe, post: Postcondition | null, start: Partial<StartState> = {}, onContext?: (context: BrowserContext) => void, speech?: LastStepSpeech): Promise<CleanReplay> {
  if (!recipe.start) return { ok: false, reasonNl: "de toestand heeft geen beginpagina", before: null, after: null, surface: null };
  let surface: Surface;
  try {
    ({ surface } = await openSurface(env, { ...recipe.start, ...start }, onContext));
  } catch (error) {
    return { ok: false, reasonNl: `de beginpagina laadt niet: ${(error as Error).message.split("\n")[0]}`, before: null, after: null, surface: null };
  }
  const before = post ? await holds(surface.page, post) : null;
  if (before?.holds) return { ok: false, reasonNl: `de postconditie geldt al op de verse pagina, voor de eerste stap (${before.detail}); ze bewijst dus niets`, before, after: null, surface };
  const replayed = await replaySteps(env, surface, recipe.steps, post, speech);
  return { ...replayed, before, surface };
}

/** What of the page lies under an element that stays in place: lines of text and controls, counted in the window. */
export interface Covered {
  /** Lines of text of the page under the element, and the lines in the window that are not the element's own. */
  text: number;
  ofText: number;
  /** The same for links, buttons and fields. */
  controls: number;
  ofControls: number;
  /** The first thing found under it, to name in a message. */
  example: string | null;
}

export interface Overlay {
  tag: string;
  path: string[];
  text: string;
  position: string;
  /** Share of the window it covers, with the page scrolled to the top. */
  share: number;
  /**
   * What lies under it: with the page at the top, and after scrolling (the most that was found at a place further down;
   * null when the page does not scroll). A column next to the content covers nothing, however much of the window it takes.
   * Absent in a run from before this was measured.
   */
  covers?: { top: Covered; scrolled: Covered | null };
}

/** Whether an element that stays in place lies over text or controls of the page. A run that did not measure it says yes: that is what the share alone used to mean. */
export function coversContent(overlay: Overlay): boolean {
  if (!overlay.covers) return true;
  return [overlay.covers.top, overlay.covers.scrolled].some((covered) => covered !== null && covered.text + covered.controls > 0);
}

/**
 * Elements that stay in place while the page scrolls, how much of the window each covers, and what
 * of the page lies under it. The page is scrolled and put back within one script, before the browser
 * paints or tells the page about it, so the page that is measured afterwards is the page as it loaded.
 */
export async function overlays(page: Page): Promise<Overlay[]> {
  return page.evaluate(() => {
    const loep = (window as unknown as { __loep: { deepElements: (root?: Node) => Iterable<HTMLElement>; isVisible: (element: Element) => boolean; describe: (element: Element) => { tag: string; path: string[]; text: string } } }).__loep;
    type Count = { text: number; ofText: number; controls: number; ofControls: number; example: string | null };
    const CONTROLS = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=switch]";
    /** Smaller than this is text that is hidden for the eye, not text somebody misses. */
    const MIN_SIZE = 4;
    const MAX_ITEMS = 1500;
    const area = innerWidth * innerHeight;
    const candidates: { element: HTMLElement; position: string; share: number }[] = [];
    for (const element of loep.deepElements(document.body)) {
      const position = getComputedStyle(element).position;
      if ((position !== "fixed" && position !== "sticky") || !loep.isVisible(element)) continue;
      if (getComputedStyle(element).pointerEvents === "none") continue;
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
      const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
      const share = Math.round(((width * height) / area) * 1000) / 1000;
      if (share === 0) continue;
      candidates.push({ element, position, share });
    }
    candidates.sort((a, b) => b.share - a.share);
    const kept = candidates.slice(0, 10);
    if (kept.length === 0) return [];

    const parentOf = (node: Node): Node | null => (node as HTMLElement).assignedSlot ?? node.parentNode ?? (node as ShadowRoot).host ?? null;
    const within = (ancestor: Element, node: Node | null): boolean => {
      for (let current = node; current; current = parentOf(current)) if (current === ancestor) return true;
      return false;
    };
    /** What is painted on top at a point, also inside a shadow tree. */
    const topAt = (x: number, y: number): Element | null => {
      let top = document.elementFromPoint(x, y);
      for (let inner = top?.shadowRoot?.elementFromPoint(x, y); top && inner && inner !== top; inner = top.shadowRoot?.elementFromPoint(x, y)) top = inner;
      return top;
    };
    // The lines of text and the controls of the page, each with the element it belongs to.
    const items: { owner: Element; kind: "text" | "controls"; rects: () => DOMRect[]; label: string }[] = [];
    for (const element of loep.deepElements(document.body)) {
      if (items.length >= MAX_ITEMS) break;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName)) continue;
      if (element.matches(CONTROLS)) items.push({ owner: element, kind: "controls", rects: () => [element.getBoundingClientRect()], label: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || element.localName });
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !(node.nodeValue ?? "").trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        items.push({ owner: element, kind: "text", rects: () => [...range.getClientRects()], label: (node.nodeValue ?? "").replace(/\s+/g, " ").trim().slice(0, 60) });
      }
    }
    const measure = (): Count[] => {
      const counts: Count[] = kept.map(() => ({ text: 0, ofText: 0, controls: 0, ofControls: 0, example: null }));
      const boxes = kept.map((entry) => entry.element.getBoundingClientRect());
      for (const item of items) {
        for (const rect of item.rects()) {
          if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          let top: Element | null | undefined;
          kept.forEach((entry, index) => {
            if (within(entry.element, item.owner)) return;
            const count = counts[index]!;
            if (item.kind === "text") count.ofText++;
            else count.ofControls++;
            const box = boxes[index]!;
            if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
            if (top === undefined) top = topAt(x, y);
            if (!top || !within(entry.element, top)) return;
            count[item.kind]++;
            count.example ??= item.label;
          });
        }
      }
      return counts;
    };
    const top = measure();
    // Further down: half a window, a whole window and the end of the page, each as far as the page goes.
    const left = window.scrollX;
    const was = window.scrollY;
    const most = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const places = [...new Set([innerHeight / 2, innerHeight, most].map((place) => Math.round(Math.min(place, most))))].filter((place) => place > was);
    let scrolled: Count[] | null = null;
    for (const place of places) {
      window.scrollTo({ left, top: place, behavior: "instant" });
      if (Math.abs(window.scrollY - place) > 2) continue;
      const here = measure();
      scrolled = scrolled === null ? here : scrolled.map((best, index) => (here[index]!.text + here[index]!.controls > best.text + best.controls ? here[index]! : best));
    }
    window.scrollTo({ left, top: was, behavior: "instant" });
    return kept.map((entry, index) => {
      const described = loep.describe(entry.element);
      return { tag: described.tag, path: described.path, text: described.text.slice(0, 80), position: entry.position, share: entry.share, covers: { top: top[index]!, scrolled: scrolled ? scrolled[index]! : null } };
    });
  });
}
