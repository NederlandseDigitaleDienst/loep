import { stateChanges as statesDiff } from "../instruments/change.ts";
import { ensureHelpers } from "../instruments/methods/capsule.ts";
import { act, UsageError, type Context, type Handler } from "./commands.ts";
import { TEST_VALUES, testValuesForRun } from "./safety.ts";
import { handleForRef } from "./surface.ts";

const SETTLE_MS = 450;
const short = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

async function handleOf(context: Context): Promise<NonNullable<Awaited<ReturnType<typeof handleForRef>>>> {
  const handle = await handleForRef(context.surface.page, context.target!.ref);
  if (!handle) throw new Error("het element is van de pagina verdwenen");
  return handle;
}

interface Watched {
  paste: { fired: boolean; prevented: boolean };
  beforeinput: { fired: boolean; prevented: boolean };
}

interface FieldState {
  length: number;
  holds: boolean;
  focused: boolean;
  readOnly: boolean;
  disabled: boolean;
  type: string;
}

/**
 * Paste a fixed test value into a field the way a user does: the value goes on the clipboard
 * and the paste shortcut is pressed, so whatever the page does on a paste happens. Reports
 * whether the value arrived, and when it did not, whether a handler of the page stopped it
 * (WCAG 3.3.8: a password or code field must accept a paste).
 */
export const paste: Handler = async (context, args) => {
  const kind = args[0] ?? "";
  if (!(kind in TEST_VALUES) || TEST_VALUES[kind] === "") throw new UsageError(`"${kind}" is geen vaste testwaarde om te plakken; kies uit: ${Object.keys(TEST_VALUES).filter((name) => TEST_VALUES[name] !== "").join(", ")}`);
  const value = testValuesForRun(context.env.runDir)[kind]!;
  const { page } = context.surface;
  const handle = await handleOf(context);
  // The clipboard of the browser, through the page: its own API where the page may use it, the old copy command where it may not (a page without https).
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin }).catch(() => undefined);
  await page.bringToFront().catch(() => undefined);
  const wrote = await page.evaluate(async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return "clipboard-api";
      }
    } catch {
      // Not allowed here; the copy command below does not need permission.
    }
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
    document.body.append(holder);
    holder.select();
    const copied = document.execCommand("copy");
    holder.remove();
    return copied ? "copy-command" : null;
  }, value);
  if (!wrote) throw new Error("het klembord kon in deze pagina niet gevuld worden; plakken is niet geprobeerd");
  const read = (text: string): Promise<FieldState> =>
    handle.evaluate((element, wanted) => {
      const field = element as HTMLInputElement;
      const held = typeof field.value === "string" ? field.value : (element.textContent ?? "");
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return { length: held.length, holds: held.includes(wanted), focused: active === element, readOnly: field.readOnly === true, disabled: field.disabled === true, type: field.type ?? element.localName };
    }, text);
  // Focus goes to the field, and the paste is watched from the window: after the page's own handlers ran, whether one of them refused it.
  await handle.evaluate((element) => {
    (element as HTMLElement).focus();
    const watched = { paste: { fired: false, prevented: false }, beforeinput: { fired: false, prevented: false } };
    const note = (event: Event): void => {
      if (event.type === "beforeinput" && (event as InputEvent).inputType !== "insertFromPaste") return;
      const record = watched[event.type as "paste" | "beforeinput"];
      record.fired = true;
      setTimeout(() => void (record.prevented = event.defaultPrevented), 0);
    };
    window.addEventListener("paste", note, true);
    window.addEventListener("beforeinput", note, true);
    (window as unknown as { __loepPaste?: { watched: typeof watched; stop: () => void } }).__loepPaste = {
      watched,
      stop: () => {
        window.removeEventListener("paste", note, true);
        window.removeEventListener("beforeinput", note, true);
      },
    };
  });
  const before = await read(value);
  let watched: Watched | null = null;
  const acted = await act(context, SETTLE_MS, async () => {
    await page.keyboard.press("ControlOrMeta+V");
    // Read right after the key, while this is still the same page: a paste may also submit a form.
    await page.waitForTimeout(50);
    watched = await page
      .evaluate(() => {
        const scope = window as unknown as { __loepPaste?: { watched: Watched; stop: () => void } };
        const found = scope.__loepPaste ?? null;
        found?.stop();
        delete scope.__loepPaste;
        return found?.watched ?? null;
      })
      .catch(() => null);
  });
  const after = acted.result.navigated ? null : await read(value).catch(() => null);
  const seen = watched as Watched | null;
  const arrived = after !== null && after.holds && after.length > before.length;
  const prevented = seen?.paste.prevented ? "paste" : seen?.beforeinput.prevented ? "beforeinput" : null;
  const why = arrived
    ? null
    : prevented
      ? `een ${prevented}-handler van de pagina hield het plakken tegen`
      : before.disabled
        ? "het veld is uitgeschakeld"
        : before.readOnly
          ? "het veld is alleen-lezen"
          : !before.focused
            ? "het veld kreeg geen focus"
            : seen && !seen.paste.fired
              ? "de pagina kreeg geen plakgebeurtenis"
              : after === null
                ? "de pagina navigeerde bij het plakken"
                : "de waarde staat er niet, zonder dat een handler het plakken tegenhield (mogelijk daarna weggehaald door script)";
  const result = { ...acted.result, kind, pasted: value, clipboard: wrote, arrived, lengthBefore: before.length, lengthAfter: after?.length ?? null, pasteEvent: seen?.paste ?? null, beforeinputEvent: seen?.beforeinput ?? null, prevented, fieldType: before.type, reason: why };
  const { changed: _changed, ...print } = acted.print as { changed?: boolean };
  return { result, print: { pasted: short(value, 40), arrived, length: `${before.length} -> ${after?.length ?? "?"}`, ...(prevented ? { prevented: `${prevented}-handler` } : {}), ...(why ? { reason: why } : {}), ...print } };
};

type States = Record<string, string>;

async function states(context: Context): Promise<States | null> {
  const { page } = context.surface;
  return ensureHelpers(page)
    .then(() => page.evaluate(() => (window as unknown as { __loepm: { controlStates: () => States } }).__loepm.controlStates()))
    .catch(() => null);
}

interface Phase {
  /** Whether the function of the control went off: text, state, address or a dialog changed. A colour that changes while the pointer is down does not count. */
  changed: boolean;
  print: Record<string, unknown> | string;
  result: Record<string, unknown>;
}

const MAX_STATES = 6;

/** One part of a press: do it, and say what it changed in the page. */
async function phase(context: Context, pauseMs: number, action: () => Promise<void>): Promise<Phase> {
  const before = await states(context);
  const acted = await act(context, pauseMs, action);
  const after = acted.result.navigated ? null : await states(context);
  const stateChanges = before && after ? statesDiff(before, after, (place) => short(place, 60)) : [];
  const { changed: _nothing, focus: _focus, ...shown } = acted.print as { changed?: boolean; focus?: string };
  const print = { ...shown, ...(stateChanges.length > 0 ? { states: stateChanges.slice(0, MAX_STATES) } : {}) };
  const changed = Object.keys(print).length > 0;
  return { changed, print: changed ? print : "geen verandering", result: { ...acted.result, stateChanges } };
}

/**
 * Press on an element in parts, to see on which part its function goes off (WCAG 2.5.2).
 * Without options: pointer down, what changed, pointer up, what changed. With --hold only the
 * down part is measured. With --abort the pointer is moved off the element before it is
 * released: a function that still went through cannot be aborted.
 */
export const press: Handler = async (context, _args, options) => {
  const { page } = context.surface;
  const handle = await handleOf(context);
  await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  // In the window of the document the element is in: that is where the pointer of that document is moved.
  const box = await handle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (box.width < 1 || box.height < 1) throw new Error("drukken lukt niet: het element is niet zichtbaar");
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A spot off the element to let go on: beside it when there is room, else above or below.
  const away = box.x + box.width + 60 < viewport.width ? { x: box.x + box.width + 50, y: centre.y } : box.x > 60 ? { x: box.x - 50, y: centre.y } : { x: centre.x, y: box.y > 60 ? box.y - 50 : Math.min(viewport.height - 2, box.y + box.height + 50) };
  const mode = options.abort === true ? "abort" : options.hold === true ? "hold" : "full";
  await page.mouse.move(centre.x, centre.y);
  const down = await phase(context, 350, () => page.mouse.down());
  if (mode === "full") {
    const up = await phase(context, SETTLE_MS, () => page.mouse.up());
    return {
      result: { mode, completesOnDown: down.changed, completesOnUp: up.changed, down: down.result, up: up.result },
      print: { down: down.print, up: up.print, completesOnDown: down.changed, ...(down.changed ? { note: "de functie gaat af bij het indrukken; probeer press --abort om te zien of dat nog af te breken is" } : {}) },
    };
  }
  // The pointer is let go off the element: on the element that would be an ordinary click.
  const released = await phase(context, SETTLE_MS, async () => {
    await page.mouse.move(away.x, away.y, { steps: 4 });
    await page.mouse.up();
  });
  if (mode === "hold") {
    return {
      result: { mode, completesOnDown: down.changed, down: down.result, afterRelease: released.result },
      print: { down: down.print, completesOnDown: down.changed, released: "daarna naast het element losgelaten", ...(released.changed ? { afterRelease: released.print } : {}) },
    };
  }
  const wentThrough = down.changed || released.changed;
  return {
    result: { mode, completesOnDown: down.changed, wentThrough, down: down.result, afterAbort: released.result },
    print: { down: down.print, afterAbort: released.print, completesOnDown: down.changed, wentThrough, note: wentThrough ? "de functie ging door hoewel de aanwijzer naast het element is losgelaten: afbreken kan niet" : "naast het element loslaten breekt de handeling af" },
  };
};
