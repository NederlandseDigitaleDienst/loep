import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import type { States } from "../lib/rundata.ts";
import type { Described } from "./activate.ts";
import { changeNl, compareChange, hasChange, readChangeState, type Change, type ChangeAspect, type ChangeState } from "./change.ts";

export const DOWN_EVENTS = ["mousedown", "pointerdown", "touchstart"];

/** Listeners here hear a press on anything in the page: which control they are for cannot be read from where they sit. */
export const DELEGATING = ["window", "document", "html", "body"];

export interface DownTarget extends Described {
  /** The kind of control: the tag with its type or role, e.g. "input[checkbox]" or "div[switch]". */
  kind: string;
  /** A control that holds a state of its own: a checkbox, a radio button, a switch, a button that stays pressed. Its effect is that state. */
  stateful: boolean;
  /** "own": the control, an element around it or its label listens for a down-event. "delegated": only a listener on the document or window does. */
  via: "own" | "delegated";
  /** How the control looks and where it stands, as the hover probe groups it into kinds. */
  look: string;
  /** What is known before the press about what it does: the code of the listeners for a press on it, around it and on its label. */
  pressedBy: string;
}

/**
 * The controls a down-event can reach a listener through: the control itself, an element
 * around it or its label listens. Which elements listen is kept by the in-page library from
 * the moment the page loads, so one link with a listener does not make every link a candidate.
 * `listening` is the fallback for a page where that was not kept: the tags that listen.
 * With `delegated`, when the document or window listens, every other control is a candidate too.
 */
export async function downEventTargets(page: Page, listening: Set<string>, delegated = false): Promise<DownTarget[]> {
  const targets = await call<(Described & { look?: string })[]>(page, "hoverTargets");
  const read = await page.evaluate(
    ([paths, tags]) => {
      const loep = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null; hearsDown?: (element: Element) => boolean; downSignature?: (element: Element) => string } }).__loep;
      const HANDLERS = ["onmousedown", "onpointerdown", "ontouchstart"] as const;
      // Up through shadow roots as well: a listener on a component hears a press on what is inside it.
      const up = (node: Element): Element | null => node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
      const byHandler = (start: Element | null): boolean => {
        for (let node: Element | null = start; node; node = up(node)) if (HANDLERS.some((name) => typeof (node as unknown as Record<string, unknown>)[name] === "function")) return true;
        return false;
      };
      const byTag = (start: Element | null): boolean => {
        for (let node: Element | null = start; node; node = up(node)) if (tags!.includes(node.localName)) return true;
        return false;
      };
      const hears = (element: Element): boolean => (loep.hearsDown ? loep.hearsDown(element) : byTag(element)) || byHandler(element);
      return (paths as string[][]).map((chain) => {
        const element = loep.resolve(chain);
        if (!element) return null;
        const role = element.getAttribute("role");
        const type = element.localName === "input" ? (element as HTMLInputElement).type : null;
        const stateful = type === "checkbox" || type === "radio" || ["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"].includes(role ?? "") || element.hasAttribute("aria-pressed") || element.hasAttribute("aria-checked");
        const own = hears(element) || [...((element as HTMLInputElement).labels ?? [])].some((label) => byHandler(label));
        return { kind: `${element.localName}${type || role ? `[${type ?? role}]` : ""}`, stateful, own, pressedBy: loep.downSignature?.(element) ?? "" };
      });
    },
    [targets.map((target) => target.path), [...listening]] as const,
  );
  return targets.flatMap((target, index) => {
    const found = read[index];
    if (!found || (!found.own && !delegated)) return [];
    return [{ ...target, kind: found.kind, look: target.look ?? `${target.tag}|${target.text.slice(0, 40)}|${target.region}`, pressedBy: found.pressedBy, stateful: found.stateful, via: found.own ? ("own" as const) : ("delegated" as const) }];
  });
}

/**
 * What counts as one kind of control for the press probe: controls that look and behave alike
 * (WCAG-EM 2.0, 4.1). The same role, look and place as for the hover probe, whether the control
 * holds a state, and the same listeners for a press, by their code: seventy checkboxes of one list
 * are one kind, whatever their label, and so are the links of one list that run the same code on a
 * press. A control with another listener, or with a listener only on the document, is another kind.
 */
export const downKind = (target: DownTarget): string => [target.via, target.kind, target.stateful ? "stateful" : "", target.look, target.pressedBy].join("|");

/** The sorts of effect a press had, so a state that flips is told apart from a page that moves on or a window that opens. */
const effects = (change: Change): string[] => [
  ...(change.navigated || change.url !== null ? ["adres"] : []),
  ...(change.dialogs !== null ? ["venster"] : []),
  ...(change.states.length > 0 ? ["toestand"] : []),
  ...(change.appeared.length > 0 || change.disappeared.length > 0 ? ["tekst"] : []),
  ...(change.live.length > 0 ? ["statusmelding"] : []),
  ...(change.scrolled !== null ? ["scroll"] : []),
];

/** What counts as the control doing something. Its own style and focus do not: a button may look pressed and takes focus on the press. */
const ACTED: ChangeAspect[] = ["url", "dialogs", "text", "states", "scroll", "fullscreen"];
const PAUSE_MS = 350;

/**
 * Press the pointer down on a control that listens for a down-event, look, then move away
 * and release, and look again. A control that already acts on the press, in a way that is
 * still there after the pointer was released elsewhere, gives the user no way to back out
 * (WCAG 2.5.2). What changes is compared as broadly as for any action: text, states,
 * dialogs, scrolling and the address. Null when the control is gone.
 */
export async function probeDownEvent(page: Page, target: Described & Partial<Pick<DownTarget, "kind" | "via">>, options: { label: string; listening: Set<string> }): Promise<NonNullable<States["downEvents"]>[number] | null> {
  const box = await page.evaluate((chain) => {
    const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain);
    if (!element) return null;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, target.path);
  if (!box) return null;
  const place = target.path.join(" >>> ");
  const read = (): Promise<ChangeState | null> => readChangeState(page, place).catch(() => null);
  const away = await read();
  // Pointing at a control can show something by itself (a tooltip); that is not the press.
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(PAUSE_MS);
  const pointing = await read();
  await page.mouse.down();
  await page.waitForTimeout(PAUSE_MS);
  const down = await read();
  await page.mouse.move(Math.max(1, box.x - 300), Math.max(1, box.y - 200), { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(PAUSE_MS);
  const released = await read();
  const base = { page: options.label, control: `${target.tag} "${target.text.slice(0, 40)}" [${target.region ?? "-"}]`, ...(target.kind ? { kind: target.kind } : {}), ...(target.via ? { via: target.via } : {}), listenerOn: [...options.listening].sort().join(", ") };
  // A page that could not be read any more went somewhere else: that is a reaction too.
  if (!away || !pointing || !down) return { ...base, changeOnDown: down ? null : `de pagina was na het indrukken niet meer te lezen (adres ${page.url()})`, changeAfterReleaseElsewhere: null };
  const onDown = compareChange(pointing, down);
  const hover = compareChange(away, pointing);
  // What pointing brought goes again when the pointer leaves; taking that back is not the control acting.
  const fromPointing = new Set([...hover.appeared, ...hover.disappeared, ...hover.live].map((chunk) => chunk.replace(/\d+/g, "#")));
  const afterRelease = released ? compareChange(down, released, fromPointing) : null;
  const acted = hasChange(onDown, ACTED);
  // Is what the press did still there once the pointer was released somewhere else?
  const undone = acted && released !== null && !hasChange(compareChange(pointing, released, fromPointing), ACTED);
  return {
    ...base,
    changeOnDown: changeNl(onDown, ACTED),
    changeAfterReleaseElsewhere: released === null ? `de pagina was na het loslaten niet meer te lezen (adres ${page.url()})` : changeNl(afterRelease!, ACTED),
    ...(acted ? { undoneByReleasingElsewhere: undone, effectOnDown: effects(onDown) } : {}),
    details: { onDown, afterRelease },
  };
}
