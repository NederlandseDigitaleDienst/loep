import { join } from "node:path";
import type { Page } from "playwright";
import { axInfo, call } from "../browser/call.ts";
import { clipboardLine, clipboardMark, clipboardSince, COPIES_BY_NAME, NOTHING_WRITTEN_NL, refusedByBrowser } from "../browser/clipboard.ts";
import { slugForUrl } from "../lib/canonical.ts";
import { runEngines } from "../lib/engines.ts";
import type { DialogState, FormErrorState, States } from "../lib/rundata.ts";
import { criterionById } from "../lib/wcag.ts";
import { activate, namesWithin, revealedScreenshot, SETTLE_MS, where, type Described } from "./activate.ts";
import { probeForms } from "./forms.ts";
import { probeSettings } from "./settings.ts";

export const DESKTOP = "1280x800";
const MAX_TABS_IN_DIALOG = 40;

export interface TriggerProbeOptions {
  /** Label of the page in dossiers and reports. */
  label: string;
  url: string;
  /** Directory that the screenshot paths in the result are relative to. */
  outDir: string;
  /** Window size as text, e.g. "1280x800"; part of the screenshot name when it is not the desktop size. */
  viewport: string;
  socketMessagesBlocked: () => number;
  seenSettings: Set<string>;
}

/**
 * Activate a trigger on a freshly loaded page and record what it opens: a dialog with its
 * name, focus handling and engine results, or an expander or tab with a picture of what it revealed.
 */
export async function probeTrigger(browserPage: Page, trigger: Described, options: TriggerProbeOptions): Promise<{ dialog: DialogState; forms: FormErrorState[]; settings: NonNullable<States["settings"]> }> {
  const { label: pageLabel, url, outDir, viewport } = options;
  const label = (trigger.text || String(trigger.ariaLabel ?? "") || trigger.tag).slice(0, 60);
  const dialog: DialogState = {
    page: pageLabel,
    viewport,
    trigger: label,
    triggerWhere: where(trigger),
    opened: false,
    activatedBy: null,
    kind: null,
    dialogName: null,
    focusMovedInto: null,
    focusAfterOpen: null,
    tabStopsInside: null,
    focusStaysInside: null,
    escapeCloses: null,
    focusReturnsToTrigger: null,
    controlsInside: [],
    engineFailures: [],
    screenshot: null,
  };
  const forms: FormErrorState[] = [];
  const settings: NonNullable<States["settings"]> = [];
  const startUrl = browserPage.url();
  const dialogsBefore = (await call<unknown[]>(browserPage, "visibleDialogs")).length;
  // A button that says it copies is the one cheap place to see whether it does: what it writes is recorded in the page.
  const copies = COPIES_BY_NAME.test(`${trigger.text} ${String(trigger.ariaLabel ?? "")} ${String(trigger.title ?? "")}`);
  const clipboardBefore = copies ? await clipboardMark(browserPage) : null;
  const activation = await activate(browserPage, trigger.path);
  if (clipboardBefore && activation.found) {
    // Enter, Space and a click may each have copied: every write counts, and none at all is the signal.
    const writes = await clipboardSince(browserPage, clipboardBefore).catch(() => []);
    dialog.clipboard = { written: writes.some((write) => write.ok === true), refusedByBrowser: writes.some(refusedByBrowser), writes: writes.slice(0, 6), nl: writes.length === 0 ? NOTHING_WRITTEN_NL : [...new Set(writes.map(clipboardLine))].join("; ") };
  }
  dialog.activatedBy = activation.by;
  if (!activation.found || activation.by === null) return { dialog, forms, settings };
  if (browserPage.url() !== startUrl) {
    dialog.kind = "navigatie";
    return { dialog, forms, settings };
  }
  const dialogsAfter = await call<(Described & { modal: boolean })[]>(browserPage, "visibleDialogs");
  dialog.opened = true;
  const slug = `${slugForUrl(url)}-${slugForUrl(`https://x/${label}`)}${viewport === DESKTOP ? "" : `-${viewport}`}`;
  if (dialogsAfter.length <= dialogsBefore) {
    dialog.kind = trigger.roleAttr === "tab" ? "tabblad" : "uitklapper";
    dialog.screenshot = await revealedScreenshot(browserPage, outDir, join("states", `${slug}.png`));
    return { dialog, forms, settings };
  }

  const opened = dialogsAfter.at(-1)!;
  dialog.kind = opened.modal ? "modale dialoog" : "dialoog of zijpaneel";
  const cdp = await browserPage.context().newCDPSession(browserPage);
  dialog.dialogName = (await axInfo(cdp, opened.ref))?.name ?? null;
  await cdp.detach();
  dialog.screenshot = join("states", `${slug}.png`);
  await browserPage.screenshot({ path: join(outDir, dialog.screenshot), animations: "disabled" });
  dialog.controlsInside = await namesWithin(browserPage, opened.ref);

  const focus = await call<Described | null>(browserPage, "focusState");
  dialog.focusAfterOpen = focus ? `${focus.tag} "${focus.text.slice(0, 40)}"` : null;
  // describe() registered more elements; the dialog keeps the reference it was given.
  dialog.focusMovedInto = await call<boolean>(browserPage, "contains", opened.ref);

  const engines = await runEngines(browserPage);
  dialog.engineFailures = engines.results
    .filter((result) => (result.outcome === "failed" || result.outcome === "cantTell") && result.criteria.some((id) => criterionById(id)?.level !== "AAA" && criterionById(id)))
    .map((result) => ({ engine: result.engine, rule: result.rule, outcome: result.outcome, criteria: result.criteria, nodes: result.nodeCount, message: result.nodes[0]?.message ?? result.description }));

  // Count the controls inside that the keyboard reaches. Focus often starts on the last one, and
  // Tab then passes the browser itself before it comes back to the first: leaving for the browser
  // does not end the walk, only the page behind the dialog or a full circle does.
  const reached = new Set<string>();
  const place = (state: Described): string => `${state.tag} "${state.text.slice(0, 40)}" ${where(state)}`;
  if (dialog.focusMovedInto && focus) reached.add(place(focus));
  let left = false;
  let throughBrowser = 0;
  for (let index = 0; index < MAX_TABS_IN_DIALOG; index++) {
    await browserPage.keyboard.press("Tab");
    const state = await call<Described | null>(browserPage, "focusState");
    if (state && (await call<boolean>(browserPage, "contains", opened.ref))) {
      const here = place(state);
      if (reached.has(here)) break;
      reached.add(here);
      continue;
    }
    left = true;
    // Where focus went matters: to the browser itself is fine, to the page behind a modal dialog is not.
    if (state) {
      dialog.focusLeftTo = `${state.tag} "${state.text.slice(0, 40)}" [${state.region ?? "-"}] op de pagina achter het venster`;
      break;
    }
    dialog.focusLeftTo ??= "de browser zelf (buiten de pagina)";
    if (++throughBrowser > 1) break;
  }
  dialog.tabStopsInside = reached.size;
  dialog.stopsInside = [...reached].map((entry) => entry.slice(0, entry.lastIndexOf('" ') + 1));
  dialog.focusStaysInside = !left;

  // A form in the dialog is tried after focus was measured: submitting it can replace the page (a search form does).
  forms.push(...(await probeForms(browserPage, { label: pageLabel, url, outDir, openedVia: label, socketMessagesBlocked: options.socketMessagesBlocked })));
  // The submission replaced the page or closed the dialog: there is nothing left to change or to close with Escape.
  const still = await call<unknown[]>(browserPage, "visibleDialogs").catch(() => []);
  if (still.length < dialogsAfter.length) return { dialog, forms, settings };
  settings.push(...(await probeSettings(browserPage, { label: pageLabel, openedVia: label, seen: options.seenSettings })));
  await browserPage.keyboard.press("Escape");
  await browserPage.waitForTimeout(SETTLE_MS);
  dialog.escapeCloses = (await call<unknown[]>(browserPage, "visibleDialogs")).length < dialogsAfter.length;
  if (dialog.escapeCloses) {
    const after = await call<Described | null>(browserPage, "focusState");
    dialog.focusReturnsToTrigger = after !== null && where(after) === where(trigger);
  }
  return { dialog, forms, settings };
}
