import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { axInfo, type AxInfo } from "../browser/call.ts";
import { clipboardMark, clipboardReport, clipboardSince } from "../browser/clipboard.ts";
import { clipboardNote, hasClipboardPermission, settlePage } from "../browser/session.ts";
import { regionScreenshot } from "../browser/screenshot.ts";
import { elementContrast, type ContrastMeasurement } from "../instruments/contrast.ts";
import { focusIndicatorOf } from "../instruments/focus.ts";
import { distinctByColour, type Side, type Vision, type VisionRatios } from "../instruments/distinct.ts";
import { colourModeView, type Fate } from "../instruments/forced.ts";
import { tabWalk } from "../instruments/keyboard.ts";
import { agreementLine, measuredBy, TOOLBOX_VERSION } from "../instruments/methods.ts";
import { visualOrder } from "../instruments/order.ts";
import { overflowAtSize, textSpacing } from "../instruments/overflow.ts";
import { targetSize } from "../instruments/target.ts";
import { timeLimits } from "../instruments/timelimits.ts";
import { timerNl } from "../lib/timelimits.ts";
import { isLogout, LOGOUT_REFUSED_NL, runLoginMark } from "../lib/login.ts";
import { drawMarks, MARK_COLOURS, type Mark } from "./marks.ts";
import { paste, press } from "./inputs.ts";
import type { Images } from "./observations.ts";
import { media } from "./media-command.ts";
import { actWith, axWith, contrastWith, focusWith, lang, layoutWith, motion, name, ocrCommand, rules, source, targetWith, taborderWith, type Services } from "./opinions.ts";
import { KEY_PATTERN, TEST_VALUES } from "./safety.ts";
import { speakActs, speakWith } from "./speak.ts";
import { changeState, enter, find as findOnPage, handleForRef, homeOf, locate, pageFacts, remember, resolveRef, sayFrame, settleAfter, syncRefs, tgs, type Env, type Surface, type TargetInfo } from "./surface.ts";

export type Options = Record<string, string | boolean>;

export interface Context {
  env: Env;
  surface: Surface;
  images: Images;
  /** The element the command is about, when it takes one. */
  target: TargetInfo | null;
  /**
   * What the session offers a measuring command besides the page: background jobs and second
   * browsers. Absent when a recorded step is played again; a measuring command then does what
   * it did before there were second opinions, so a recipe leaves the page exactly as it always did.
   */
  services?: Services;
}

/** A command that was given wrongly: a ref that does not exist, an option out of range. It costs nothing of the budget. */
export class UsageError extends Error {}

export interface Outcome {
  /** The full result, for the record. */
  result: unknown;
  /** What the agent gets to read: a summary, as small as it can be. */
  print: Record<string, unknown>;
}

export type Handler = (context: Context, args: string[], options: Options) => Promise<Outcome>;

export interface Spec {
  /** Where the reference number of the element is given, if the command takes one. "focus": it takes none and goes to whatever has focus. */
  target: "first-argument" | "optional-first-argument" | "option-from" | "none" | "focus";
  /** Whether the command leaves the page in another state: such a command is a step of the recipe. A function when that depends on how the command is given. */
  changes: boolean | ((options: Options) => boolean);
  run: Handler;
}

const SETTLE_MS = 450;
const ACTION_TIMEOUT_MS = 3000;
const brief = (element: { ref: number | null; role?: string | null; tag: string; text: string }): string => `${element.ref ?? "?"} ${element.role ?? element.tag}: ${element.text.slice(0, 40)}`;
const numberOption = (options: Options, name: string, fallback: number, max: number): number => {
  const value = Number(options[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new UsageError(`--${name} moet een getal zijn`);
  return Math.min(max, Math.round(value));
};
const needTarget = (context: Context): TargetInfo => context.target!;
/** The words that say an element sits in an embedded frame, and in which one. */
const inFrame = (element: { frame?: TargetInfo["frame"] }): string => (element.frame ? ` [in venster: ${sayFrame(element.frame)}]` : "");

const MAX_APPEARED = 8;

/** Perform one action and report what it changed, so an agent does not have to look again after every step. */
export async function act(context: Context, pauseMs: number, action: () => Promise<void>): Promise<{ result: Record<string, unknown>; print: Record<string, unknown> }> {
  const { surface, env } = context;
  // What an action changes is read on the whole tab, whichever document the action was in.
  const { page } = surface.top;
  const wait = Math.max(env.politeness.remaining(page.url()), env.politeness.remaining(surface.page.url()));
  if (wait > 0) await page.waitForTimeout(wait);
  const before = await changeState(surface);
  const navigations = surface.navigations;
  const clipboardBefore = await clipboardMark(page);
  await action();
  await settleAfter(surface, navigations, pauseMs);
  // An action can start a navigation that arrives while the page is being read: a form that is sent to a slow server.
  // Reading then finds a document without a body, or reads the page that is on its way out. In both cases the new page is waited for and read again.
  let doc: string | null = null;
  let after = before;
  for (let attempt = 0; attempt < 3; attempt++) {
    const seen = surface.navigations;
    try {
      doc = await syncRefs(surface.top);
      after = await changeState(surface);
      if (surface.navigations === seen) break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForFunction(() => document.body !== null, null, { timeout: 20_000 }).catch(() => undefined);
    await settlePage(page);
  }
  const facts = await pageFacts(surface);
  const navigated = doc !== null && after.doc !== before.doc;
  const had = new Set(before.chunks);
  const has = new Set(after.chunks);
  const appeared = navigated ? [] : after.chunks.filter((chunk) => !had.has(chunk));
  const disappeared = navigated ? [] : before.chunks.filter((chunk) => !has.has(chunk));
  const liveBefore = new Set(before.live);
  const live = navigated ? [] : after.live.filter((text) => !liveBefore.has(text));
  // What the action put on the clipboard, as the page asked for it. A page that says copying failed may be saying
  // something about the test browser, not about itself: whether the browser refused the write settles that.
  const clipboardWrites = await clipboardSince(page, clipboardBefore);
  const clipboard = clipboardReport(clipboardWrites, [...appeared, ...live]);
  const note = clipboardNote([...appeared, ...live], hasClipboardPermission(env.browser), clipboardWrites);
  const result = {
    navigated,
    url: after.url,
    urlChanged: after.url !== before.url,
    title: facts?.title ?? null,
    dialogsBefore: before.dialogs,
    dialogsAfter: after.dialogs,
    expandedBefore: before.expanded,
    expandedAfter: after.expanded,
    appeared,
    disappeared,
    liveRegionMessages: live,
    scrolled: after.scroll.join() !== before.scroll.join(),
    ...(clipboard !== null ? { clipboard: clipboardWrites, clipboardNl: clipboard } : {}),
    ...(note ? { note } : {}),
    focus: facts?.focus ? { ref: facts.focus.ref, tag: facts.focus.tag, role: facts.focus.role, text: facts.focus.text, path: facts.focus.path, ...(facts.focus.frame ? { frame: facts.focus.frame } : {}) } : null,
  };
  const print: Record<string, unknown> = {};
  if (result.urlChanged || navigated) Object.assign(print, { navigated, url: after.url, title: result.title });
  if (after.dialogs !== before.dialogs) print.dialogs = `${before.dialogs} -> ${after.dialogs}`;
  if (after.expanded !== before.expanded) print.expanded = `${before.expanded} -> ${after.expanded}`;
  if (appeared.length > 0) print.appeared = [...appeared.slice(0, MAX_APPEARED).map((chunk) => chunk.slice(0, 100)), ...(appeared.length > MAX_APPEARED ? [`(+${appeared.length - MAX_APPEARED})`] : [])];
  if (disappeared.length > 0) print.disappeared = disappeared.length;
  if (live.length > 0) print.live = live.slice(0, 3).map((text) => text.slice(0, 100));
  if (clipboard !== null) print.clipboard = clipboard;
  if (note) print.note = note;
  if (Object.keys(print).length === 0) print.changed = false;
  if (result.focus) print.focus = brief(result.focus);
  return { result, print };
}

async function handleOrThrow(context: Context): Promise<NonNullable<Awaited<ReturnType<typeof handleForRef>>>> {
  const handle = await handleForRef(context.surface.page, needTarget(context).ref);
  if (!handle) throw new Error("het element is van de pagina verdwenen");
  return handle;
}

/** Turn a Playwright action error into a line that says what a user would run into. The original stays as the cause: a replay tells a time-out by it. */
function actionError(verb: string, error: Error): Error {
  const message = error.message;
  const cause = { cause: error };
  const intercepts = /(<[^\n]{0,160}?)\s+(?:from <[^\n]*? subtree )?intercepts pointer events/.exec(message)?.[1];
  if (intercepts) return new Error(`${verb} lukt niet: een ander element ligt eroverheen (${intercepts.slice(0, 120)})`, cause);
  if (/not visible|not attached|outside of the viewport/.test(message)) return new Error(`${verb} lukt niet: het element is niet zichtbaar`, cause);
  if (/not enabled/.test(message)) return new Error(`${verb} lukt niet: het element is uitgeschakeld`, cause);
  if (/not an <input>|not editable|cannot be filled|Element is not/.test(message)) return new Error(`${verb} lukt niet: dit is geen invoerveld`, cause);
  return new Error(`${verb} lukt niet: ${message.split("\n")[0]}`, cause);
}

const click: Handler = async (context) => {
  // In a run with a login a control that logs out is never clicked: it would end the session for everybody after this.
  if (runLoginMark() && context.target && isLogout({ text: context.target.text })) throw new UsageError(LOGOUT_REFUSED_NL);
  const handle = await handleOrThrow(context);
  return act(context, SETTLE_MS, () => handle.click({ timeout: ACTION_TIMEOUT_MS }).catch((error: Error) => Promise.reject(actionError("klikken", error))));
};

const key: Handler = async (context, args) => {
  const name = args[0] ?? "";
  if (!KEY_PATTERN.test(name)) throw new UsageError(`toets "${name}" is niet toegestaan; wel: Enter, Space, Escape, Tab, pijltoetsen (ArrowDown), Home, End, PageUp, PageDown, Backspace, Delete, F1-F12, een letter, cijfer of leesteken, met Shift+ Control+ Alt+ Meta+ ervoor`);
  return act(context, SETTLE_MS, () => context.surface.page.keyboard.press(name));
};

const MAX_TABS = 50;

const tab: Handler = async (context, args, options) => {
  const count = Math.max(1, Math.min(MAX_TABS, Number(args[0] ?? 1) || 1));
  const { surface } = context;
  const stops: Record<string, unknown>[] = [];
  const acted = await act(context, 150, async () => {
    for (let index = 0; index < count; index++) {
      await surface.page.keyboard.press(options.shift ? "Shift+Tab" : "Tab");
      const facts = await pageFacts(surface);
      if (!facts?.focus) {
        stops.push({ ref: null, outside: true });
        continue;
      }
      // The document that holds the focused element says how it shows.
      const home = (await locate(surface.top, facts.focus.path))?.surface ?? surface;
      const state = await home.page.evaluate(() => (window as unknown as { __loep: { focusState: () => { focusVisible: boolean; inViewport: boolean; coveredBy: string[] | null } | null } }).__loep.focusState());
      stops.push({ ref: facts.focus.ref, tag: facts.focus.tag, role: facts.focus.role, text: facts.focus.text, path: facts.focus.path, ...(facts.focus.frame ? { frame: facts.focus.frame } : {}), focusVisible: state?.focusVisible ?? null, inViewport: state?.inViewport ?? null, coveredBy: state?.coveredBy ?? null });
    }
  });
  const line = (stop: Record<string, unknown>): string =>
    stop.outside ? "(focus verlaat de pagina: browserbalk of begin van het document)" : `${brief(stop as never)}${inFrame(stop as never)}${stop.inViewport === false ? " [buiten venster]" : ""}${stop.coveredBy ? " [bedekt]" : ""}${stop.focusVisible === false ? " [geen :focus-visible]" : ""}`;
  const { focus: _focus, ...print } = acted.print;
  return { result: { ...acted.result, stops }, print: { ...print, stops: stops.map(line) } };
};

const type: Handler = async (context, args) => {
  const kind = args[0] ?? "";
  if (!(kind in TEST_VALUES)) throw new UsageError(`"${kind}" is geen vaste testwaarde; kies uit: ${Object.keys(TEST_VALUES).join(", ")}`);
  const handle = await handleOrThrow(context);
  const acted = await act(context, SETTLE_MS, () => handle.fill(TEST_VALUES[kind]!, { timeout: ACTION_TIMEOUT_MS }).catch((error: Error) => Promise.reject(actionError("invullen", error))));
  const field = await handle
    .evaluate((element) => {
      const input = element as HTMLInputElement;
      return { value: input.value ?? null, ariaInvalid: input.getAttribute("aria-invalid"), nativeInvalid: typeof input.checkValidity === "function" ? !input.checkValidity() : false, validationMessage: input.validationMessage || null };
    })
    .catch(() => null);
  return { result: { ...acted.result, kind, entered: TEST_VALUES[kind], field }, print: { entered: TEST_VALUES[kind]!.slice(0, 40), ...(field?.ariaInvalid === "true" || field?.nativeInvalid ? { invalid: field.validationMessage ?? "aria-invalid" } : {}), ...acted.print } };
};

/**
 * Choose an option of a native select, by the text a user sees or by its place in the list.
 * The options are those the page offers; nothing an agent makes up reaches the page.
 */
const select: Handler = async (context, args) => {
  const wanted = args.join(" ").trim();
  if (!wanted) throw new UsageError("select verwacht een ref en een optie: de zichtbare tekst, of #n voor de n-de optie");
  const handle = await handleOrThrow(context);
  const options = await handle.evaluate((element) => (element.localName === "select" ? [...(element as unknown as HTMLSelectElement).options].map((option) => ({ label: (option.label || option.textContent || "").replace(/\s+/g, " ").trim(), disabled: option.disabled })) : null));
  if (!options) {
    const target = needTarget(context);
    throw new UsageError(`dit is geen <select> maar een <${target.tag}>${target.role ? ` met rol ${target.role}` : ""}: een eigen keuzelijst bedien je met click en key (ArrowDown, ArrowUp, Enter, Escape)`);
  }
  const numbered = /^#(\d+)$/.exec(wanted);
  const index = numbered ? Number(numbered[1]) - 1 : options.findIndex((option) => option.label === wanted);
  const listed = options.map((option, at) => `#${at + 1} ${option.label}`).slice(0, 20).join(", ");
  if (index < 0 || index >= options.length) throw new UsageError(`geen optie "${wanted}"; de opties zijn: ${listed}`);
  if (options[index]!.disabled) throw new UsageError(`optie "${options[index]!.label}" is uitgeschakeld`);
  const acted = await act(context, SETTLE_MS, () => handle.selectOption({ index }, { timeout: ACTION_TIMEOUT_MS }).then(() => undefined).catch((error: Error) => Promise.reject(actionError("kiezen", error))));
  return { result: { ...acted.result, chosen: options[index]!.label, index: index + 1, options: options.map((option) => option.label) }, print: { chosen: options[index]!.label, ...acted.print } };
};

const hover: Handler = async (context) => {
  const handle = await handleOrThrow(context);
  return act(context, 700, () => handle.hover({ timeout: ACTION_TIMEOUT_MS }).catch((error: Error) => Promise.reject(actionError("aanwijzen", error))));
};

const scroll: Handler = async (context, args) => {
  const { page } = context.surface;
  const where = args[0] ?? "";
  if (context.target) {
    const handle = await handleOrThrow(context);
    await handle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  } else if (where === "top" || where === "bottom") {
    await page.evaluate((to) => window.scrollTo({ top: to === "top" ? 0 : document.documentElement.scrollHeight, behavior: "instant" }), where);
  } else if (where === "down" || where === "up" || /^[+-]\d+$/.test(where)) {
    await page.evaluate((by) => window.scrollBy({ top: by === "down" ? innerHeight - 100 : by === "up" ? 100 - innerHeight : Number(by), behavior: "instant" }), where);
  } else throw new UsageError("scroll verwacht een ref, css:<selector>, top, bottom, down, up of een afstand met teken (+400 of -400)");
  await page.waitForTimeout(150);
  const facts = await pageFacts(context.surface);
  const result = { scroll: facts?.scroll ?? null, pageHeight: facts?.pageHeight ?? null, viewport: facts?.viewport ?? null };
  return { result, print: { window: facts ? `${facts.scroll[1]}-${facts.scroll[1] + facts.viewport.height} van ${facts.pageHeight}` : null } };
};

const back: Handler = async (context) => {
  const { page } = context.surface;
  // The empty page a browser starts on is in the history too; going back to it would only lose the page.
  const possible = await page.evaluate(() => ((window as unknown as { navigation?: { currentEntry: { index: number } | null } }).navigation?.currentEntry?.index ?? 0) > 0);
  if (!possible) throw new Error("er is geen vorige pagina");
  return act(context, SETTLE_MS, async () => void (await page.goBack({ waitUntil: "load" })));
};

/** Internal step of a recipe: go on to another page in the same browser context, so cookies and storage stay. Not a command of its own. */
const goto: Handler = async (context, args) => {
  const { surface, env } = context;
  await env.politeness.before(args[0]!);
  const response = await surface.page.goto(args[0]!, { waitUntil: "load" });
  await settlePage(surface.page);
  const facts = await pageFacts(surface);
  const result = { status: response?.status() ?? null, url: facts?.url ?? null, title: facts?.title ?? null };
  return { result, print: result };
};

const STATE_PROPERTIES = ["expanded", "checked", "selected", "pressed", "disabled", "required", "invalid", "modal", "haspopup"];

function axStates(info: AxInfo | null): string[] {
  if (!info) return [];
  return STATE_PROPERTIES.filter((name) => name in info.properties && !(["invalid", "haspopup"].includes(name) && String(info.properties[name]) === "false") && !(["disabled", "required", "modal"].includes(name) && info.properties[name] === false)).map((name) => `${name}=${String(info.properties[name])}`);
}

interface OutlineItem {
  ref: number;
  /** Number of the frame element this element sits in, when it sits in an embedded frame. */
  frame?: number;
  /** For a frame element: how far its document starts inside its box, and what could be read of it. */
  inset?: [number, number];
  address?: string;
  unread?: boolean;
  reg?: number;
  kind: string;
  tag: string;
  role: string | null;
  text: string;
  path: string[];
  region: string | null;
  box: { x: number; y: number; width: number; height: number };
  level?: number | null;
  alt?: string | null;
  type?: string;
  value?: string;
  coveredBy?: string;
  ax?: AxInfo | null;
}

interface Outline {
  items: OutlineItem[];
  notShown: number;
  outsideWindow: number;
  behindDialog: number;
  modal: number | null;
  focus: number | null;
}

function outlineLine(item: OutlineItem): string {
  const role = item.ax?.role && !["generic", "none", "presentation"].includes(item.ax.role) ? item.ax.role : (item.role ?? item.tag);
  const name = item.ax?.name?.trim() ?? "";
  const notes = [...axStates(item.ax ?? null)];
  if (item.kind === "clickable") notes.push("klikbaar, geen bedieningselement");
  if (item.kind === "image") notes.push(item.alt === null ? "geen alt" : `alt="${(item.alt ?? "").slice(0, 30)}"`);
  if (item.ax?.ignored) notes.push("verborgen voor hulptechnologie");
  if (item.value) notes.push(`waarde="${item.value}"`);
  if (item.coveredBy) notes.push(`bedekt door ${item.coveredBy}`);
  if (item.frame !== undefined) notes.push(`in venster ${item.frame}`);
  if (item.address) notes.push(`venster van ${item.address.slice(0, 60)}`);
  if (item.unread) notes.push("inhoud van het venster niet te lezen");
  const label = name ? name.slice(0, 60) : item.text ? `(geen naam; tekst: ${item.text.slice(0, 40)})` : "(geen naam)";
  return `${item.ref} ${role}${item.kind === "heading" && item.level ? item.level : ""}: ${label}${notes.length > 0 ? ` [${notes.join(", ")}]` : ""}`;
}

const DEFAULT_MARKS = 80;
/** The ways of seeing that Chromium can emulate. */
const VISION_TYPES = ["achromatopsia", "deuteranopia", "protanopia", "tritanopia", "blurredVision", "reducedContrast"];
const MAX_MARKS = 200;

/**
 * The outline of one document with, right after each embedded frame, what that frame shows in
 * its own window, placed where the frame stands. Inside a frame the numbers are for what its
 * window shows; the rest of its document is reached with find and scroll.
 */
async function outlineOf(surface: Surface, options: { full: boolean; max: number }): Promise<Outline> {
  const doc = await syncRefs(surface);
  const outline = await tgs<Outline>(surface, "outline", options);
  const cdp = await surface.page.context().newCDPSession(surface.page);
  for (const item of outline.items) {
    item.ax = await axInfo(cdp, item.reg!);
    delete item.reg;
  }
  await cdp.detach();
  if (doc) remember(surface, doc, outline.items);
  const items: OutlineItem[] = [];
  for (const item of outline.items) {
    const [left, top] = item.inset ?? [0, 0];
    delete item.inset;
    items.push(item);
    if (item.kind !== "frame") continue;
    const inner = await enter(surface, item.path).catch(() => null);
    if (!inner) {
      item.unread = true;
      continue;
    }
    item.address = inner.frame!.url;
    const nested = await outlineOf(inner, { ...options, full: false });
    for (const child of nested.items) items.push({ ...child, frame: child.frame ?? item.ref, box: { ...child.box, x: item.box.x + left + child.box.x, y: item.box.y + top + child.box.y } });
    outline.notShown += nested.notShown;
    outline.outsideWindow += nested.outsideWindow;
    outline.behindDialog += nested.behindDialog;
  }
  return { ...outline, items };
}

const look: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const { page } = surface;
  const full = options.full === true;
  const max = numberOption(options, "max", DEFAULT_MARKS, MAX_MARKS);
  const outline = await outlineOf(surface, { full, max });
  if (!full) {
    // What a frame shows in its own window can still lie outside the window of the tab.
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const shown = outline.items.filter((item) => item.frame === undefined || (item.box.x + item.box.width > 0 && item.box.y + item.box.height > 0 && item.box.x < viewport.width && item.box.y < viewport.height));
    outline.outsideWindow += outline.items.length - shown.length;
    outline.items = shown;
  }
  outline.notShown += Math.max(0, outline.items.length - max);
  outline.items = outline.items.slice(0, max);
  // Chromium can paint a page the way someone with a colour vision deficiency sees it; the page itself is not touched.
  const vision = typeof options.vision === "string" ? options.vision : null;
  if (vision && !VISION_TYPES.includes(vision)) throw new UsageError(`--vision is een van: ${VISION_TYPES.join(", ")}`);
  const emulation = vision ? await page.context().newCDPSession(page) : null;
  if (emulation) await emulation.send("Emulation.setEmulatedVisionDeficiency", { type: vision as "deuteranopia" });
  let picture: PNG;
  try {
    picture = PNG.sync.read(await page.screenshot({ fullPage: full, animations: "disabled" }));
  } finally {
    if (emulation) {
      await emulation.send("Emulation.setEmulatedVisionDeficiency", { type: "none" }).catch(() => undefined);
      await emulation.detach().catch(() => undefined);
    }
  }
  const marks: Mark[] = outline.items.map((item) => ({ label: String(item.ref), box: item.box, colour: MARK_COLOURS[item.kind] ?? MARK_COLOURS.control!, frame: item.kind === "control" || item.kind === "clickable" ? 2 : 1 }));
  // Without marks the picture shows the page as it is, for when a number would sit on what has to be read.
  if (options.plain !== true) drawMarks(picture, marks);
  const path = images.image();
  await writeFile(path, PNG.sync.write(picture));
  const facts = await pageFacts(surface);
  outline.focus = facts?.focus?.ref ?? null;
  const { focus: focusRef, modal: modalRef, ...listed } = outline;
  const result = { full, ...(vision ? { vision } : {}), ...(options.plain === true ? { plain: true } : {}), ...listed, focusRef, modalRef, window: facts ? { scroll: facts.scroll, viewport: facts.viewport, pageHeight: facts.pageHeight } : null };
  const more = [
    outline.notShown > 0 ? `${outline.notShown} meer in beeld dan genummerd (--max)` : null,
    outline.outsideWindow > 0 ? `${outline.outsideWindow} buiten het venster (scroll of --full)` : null,
    outline.behindDialog > 0 ? `${outline.behindDialog} achter het open venster` : null,
  ].filter(Boolean);
  return {
    result,
    print: {
      url: facts?.url,
      title: facts?.title,
      window: facts ? `${facts.scroll[1]}-${facts.scroll[1] + facts.viewport.height} van ${facts.pageHeight}` : null,
      image: images.relative(path),
      ...(vision ? { vision } : {}),
      ...(outline.focus ? { focus: outline.focus } : {}),
      outline: outline.items.map(outlineLine),
      ...(more.length > 0 ? { more } : {}),
    },
  };
};

const crop: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const { page } = surface;
  const target = needTarget(context);
  const margin = numberOption(options, "margin", 16, 200);
  const viewport = page.viewportSize()!;
  const path = images.image();
  const fits = target.box.width + 2 * margin <= viewport.width && target.box.height + 2 * margin <= viewport.height;
  if (!fits) {
    // Larger than the window: cut it out of a picture of the whole page.
    const clip = { x: Math.max(0, target.box.x - margin), y: Math.max(0, target.box.y - margin), width: target.box.width + 2 * margin, height: target.box.height + 2 * margin };
    await regionScreenshot(page, clip, { path });
    return { result: { box: target.box, margin, fullPage: true }, print: { image: images.relative(path), size: `${target.box.width}x${target.box.height}` } };
  }
  const placed = await page.evaluate((ref) => {
    const element = (window as unknown as { __loeps: { get: (ref: number) => HTMLElement | null } }).__loeps.get(ref)!;
    const original = [window.scrollX, window.scrollY] as [number, number];
    const rect = element.getBoundingClientRect();
    if (rect.bottom > innerHeight || rect.top < 0 || rect.right > innerWidth || rect.left < 0) element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const now = element.getBoundingClientRect();
    return { original, box: { x: now.x, y: now.y, width: now.width, height: now.height } };
  }, target.ref);
  const x = Math.max(0, Math.floor(placed.box.x - margin));
  const y = Math.max(0, Math.floor(placed.box.y - margin));
  const clip = { x, y, width: Math.max(1, Math.min(viewport.width, Math.ceil(placed.box.x + placed.box.width + margin)) - x), height: Math.max(1, Math.min(viewport.height, Math.ceil(placed.box.y + placed.box.height + margin)) - y) };
  await page.screenshot({ path, clip, animations: "disabled" });
  await page.evaluate(([left, top]) => window.scrollTo({ left: left!, top: top!, behavior: "instant" }), placed.original);
  return { result: { box: target.box, margin, fullPage: false }, print: { image: images.relative(path), size: `${target.box.width}x${target.box.height}` } };
};

const ax: Handler = async (context) => {
  const { page } = context.surface;
  const reg = await tgs<number>(context.surface, "toRegistry", needTarget(context).ref);
  const cdp = await page.context().newCDPSession(page);
  const info = await axInfo(cdp, reg);
  await cdp.detach();
  if (!info) throw new Error("de browser gaf geen toegankelijkheidsinformatie voor dit element");
  return { result: info, print: { role: info.role, name: info.name, ...(info.description ? { description: info.description } : {}), ...(info.ignored ? { ignored: true } : {}), states: info.properties } };
};

/** Values that say nothing: left out of the printed summary when the agent did not ask for a property by name. */
const PLAIN_VALUES = new Set(["none", "normal", "auto", "0px", "visible", "static", "start", "rgba(0, 0, 0, 0)", "0", "1", "row", "clip", ""]);

const style: Handler = async (context, args) => {
  // Properties may be given with commas or as separate words: "color,background-color" or "color background-color".
  const properties = args.flatMap((argument) => argument.split(",")).map((name) => name.trim()).filter(Boolean);
  const found = await tgs<{ values: Record<string, string>; generated: Record<string, string>; matchesFocusVisible: boolean; matchesHover: boolean }>(context.surface, "style", needTarget(context).ref, properties);
  const shown = properties.length > 0 ? found.values : Object.fromEntries(Object.entries(found.values).filter(([, value]) => !PLAIN_VALUES.has(value)));
  return { result: found, print: { style: shown, ...(Object.keys(found.generated).length > 0 ? { generated: found.generated } : {}), ...(found.matchesFocusVisible ? { focusVisible: true } : {}), ...(found.matchesHover ? { hover: true } : {}) } };
};

const html: Handler = async (context, _args, options) => {
  const found = await tgs<{ length: number; html: string; truncated: boolean; shadowRoot: string | null }>(context.surface, "html", needTarget(context).ref, numberOption(options, "max", 1200, 6000));
  return { result: found, print: { html: found.html, ...(found.truncated ? { truncated: `${found.length} tekens in totaal (--max)` } : {}), ...(found.shadowRoot ? { shadowRoot: found.shadowRoot } : {}) } };
};

/**
 * Every timer of a second or more on the page as the session has it now, also the ones a step
 * just started (after sending a form), with what each did: the waiting ones are set off, the
 * shortest first, and the rule of the dossier says which can be a time limit (2.2.1). That changes
 * the page, so it is a step: open the state again before going on with something else.
 */
const timers: Handler = async (context) => {
  const probe = await timeLimits(context.surface.page);
  const seconds = (ms: number): number => Math.round(ms / 100) / 10;
  const rows = probe.timers.map((timer) => ({ ...timerNl(timer), startedAfterSeconds: seconds(timer.startedAtMs) }));
  const limits = rows.filter((row) => row.limit === "kan een tijdslimiet zijn").length;
  return {
    result: { measuredAfterSeconds: seconds(probe.elapsedMs), timers: rows, metaRefresh: probe.metaRefresh, shortTimeouts: probe.shortTimeouts, fieldsFilledBeforeFiring: probe.fieldsFilledBeforeFiring },
    print: {
      timers:
        rows.length === 0
          ? "geen timer van een seconde of langer sinds het laden"
          : rows.map((row) => `${row.kind} van ${seconds(row.delayMs)} s, gestart ${row.startedAfterSeconds} s na het laden: ${row.wentOff.replace("aan het eind van de meting", "nu")}; ${row.whatHappenedNl.join(", ")}. ${row.limit}: ${row.whyNl}`),
      ...(probe.metaRefresh.length > 0 ? { metaRefresh: probe.metaRefresh.map((entry) => `${entry.content}${entry.seconds !== null ? ` (${entry.seconds} s)` : ""}`) } : {}),
      conclusion: limits === 0 ? "geen timer die een tijdslimiet kan zijn" : `${limits} ${limits === 1 ? "timer die een tijdslimiet kan zijn" : "timers die een tijdslimiet kunnen zijn"}`,
      note: `gemeten ${seconds(probe.elapsedMs)} s na het laden; wat nog niet was afgegaan, is nu afgegaan en de pagina is daardoor veranderd: open de toestand opnieuw voor een volgende meting`,
    },
  };
};

const find: Handler = async (context, args, options) => {
  const query = args.join(" ").trim();
  if (!query) throw new UsageError("find verwacht een tekst, of role:<rol>, tag:<naam> of css:<selector>");
  const prefixed = /^(role|tag|css):(.+)$/s.exec(query);
  const found = await findOnPage(context.surface, prefixed ? prefixed[1]! : "text", prefixed ? prefixed[2]!.trim() : query, numberOption(options, "max", 20, 60)).catch((error: Error) => {
    throw new UsageError(prefixed?.[1] === "css" ? `ongeldige selector: ${error.message.split("\n")[0]}` : error.message.split("\n")[0]);
  });
  return {
    result: found,
    print: { total: found.total, ...(found.hidden > 0 ? { hidden: found.hidden } : {}), found: found.items.map((item) => `${brief(item)}${item.visible ? "" : " [verborgen]"}${inFrame(item)}`), ...(found.total > found.items.length ? { more: `${found.total - found.items.length} niet getoond (--max)` } : {}) },
  };
};

/**
 * Give the result of a measuring command the shape that can hold several methods side by
 * side. Today each has one, made by this toolbox in this browser.
 */
function oneMethod(method: string, run: Handler): Handler {
  return async (context, args, options) => {
    const outcome = await run(context, args, options);
    const measured = measuredBy([{ method, implementation: "loep", version: `${TOOLBOX_VERSION} chromium ${context.env.browser.version()}`, result: outcome.result }]);
    return { result: measured, print: { ...outcome.print, methods: agreementLine(measured) } };
  };
}

const MAX_TEXT_PRINTED = 8;

const contrast: Handler = async (context) => {
  const measured = await elementContrast(context.surface.page, needTarget(context).path);
  if (!measured) throw new Error("het element is van de pagina verdwenen");
  // Pieces of text with the same colours and size are one line in the summary; the lowest ratio comes first.
  const groups = new Map<string, { entry: ContrastMeasurement; count: number }>();
  for (const entry of measured.text) {
    const key = [entry.foreground, entry.background, entry.ratio, entry.required, entry.outcome, entry.reason].join("|");
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { entry, count: 1 });
  }
  const text = [...groups.values()]
    .sort((a, b) => (a.entry.ratio ?? 99) - (b.entry.ratio ?? 99))
    .slice(0, MAX_TEXT_PRINTED)
    .map(({ entry, count }) => ({ text: entry.text.slice(0, 30), fg: entry.foreground, bg: entry.background, ratio: entry.ratio, required: entry.required, outcome: entry.outcome, ...(entry.reason ? { reason: entry.reason } : {}), ...(count > 1 ? { pieces: count } : {}) }));
  const control = measured.control ? { outside: measured.control.outside, edge: measured.control.edge, fill: measured.control.fill, edgeRatio: measured.control.edgeRatio, fillRatio: measured.control.fillRatio, outcome: measured.control.outcome } : null;
  const graphic = measured.graphic ? { fg: measured.graphic.foreground, bg: measured.graphic.background, ratio: measured.graphic.ratio, outcome: measured.graphic.outcome } : null;
  return { result: measured, print: { text, ...(groups.size > MAX_TEXT_PRINTED ? { moreText: groups.size - MAX_TEXT_PRINTED } : {}), ...(control ? { control } : {}), ...(graphic ? { graphic } : {}) } };
};

const focus: Handler = async (context) => {
  const { surface, images } = context;
  const focused = images.image();
  const measured = await focusIndicatorOf(surface.page, needTarget(context).path, { focused, unfocused: images.image("-unfocused") });
  if (!measured) throw new Error("het element is van de pagina verdwenen");
  return {
    result: measured,
    print: {
      focusable: measured.focusable,
      ...(measured.focusable
        ? {
            focusVisible: measured.focusVisible,
            outline: measured.outline,
            ...(measured.boxShadow !== "none" ? { boxShadow: measured.boxShadow } : {}),
            styleChanges: measured.styleChanges,
            pixelShare: measured.focusPixelShare === null ? null : Math.round(measured.focusPixelShare * 10000) / 10000,
            indicator: measured.indicatorColour ? `${measured.indicatorColour} over ${measured.indicatorOver}` : null,
            indicatorRatio: measured.indicatorRatio,
            ...(measured.coveredBy ? { coveredBy: measured.coveredBy.join(" >>> ") } : {}),
            ...(measured.clipVerified ? { image: images.relative(focused) } : {}),
          }
        : {}),
      ...(measured.focusNotMeasured ? { notMeasured: measured.focusNotMeasured } : {}),
    },
  };
};

const target: Handler = async (context) => {
  const element = needTarget(context);
  const measured = await targetSize(context.surface.page, element.path);
  if (!measured) {
    const result = { control: false, box: element.box };
    return { result, print: { control: false, size: `${element.box.width}x${element.box.height}`, note: "geen zichtbaar, ingeschakeld bedieningselement: de eis voor doelgrootte geldt hier niet" } };
  }
  return { result: measured, print: { size: `${measured.width}x${measured.height}`, largeEnough: measured.largeEnough, ...(measured.inlineInText ? { inlineInText: true } : {}), ...(measured.tooCloseTo ? { tooCloseTo: `${measured.tooCloseTo.tag}: ${measured.tooCloseTo.text} (${measured.tooCloseTo.distance}px)` } : {}), nearest: measured.nearest ? `${measured.nearest.tag}: ${measured.nearest.text} (${measured.nearest.gap}px)` : null } };
};

const MAX_LISTED = 5;
const where = (element: { tag: string; text: string }): string => `${element.tag}: ${element.text.slice(0, 40)}`;

async function overflow(context: Context, viewport: { width: number; height: number }, note: string): Promise<Outcome> {
  const { surface, images } = context;
  const path = images.image();
  const measured = await overflowAtSize(surface.page, viewport, path);
  const report = measured.report as { horizontalScroll: boolean; scrollWidth: number; viewportWidth: number; offenders: { tag: string; text: string; right: number; overflowContainer: { tag: string; overflowX: string } | null }[]; clipped: { tag: string; text: string }[] };
  return {
    result: { note, viewport, ...measured.report, visibleControls: measured.visibleControls, clickables: measured.clickables },
    print: {
      viewport: `${viewport.width}x${viewport.height}`,
      horizontalScroll: report.horizontalScroll,
      scrollWidth: report.scrollWidth,
      offenders: report.offenders.length,
      ...(report.offenders.length > 0 ? { first: report.offenders.slice(0, MAX_LISTED).map((offender) => `${where(offender)} (tot ${offender.right}px${offender.overflowContainer ? `, in ${offender.overflowContainer.tag} met overflow-x ${offender.overflowContainer.overflowX}` : ""})`) } : {}),
      clipped: report.clipped.length,
      ...(report.clipped.length > 0 ? { firstClipped: report.clipped.slice(0, MAX_LISTED).map(where) } : {}),
      image: images.relative(path),
    },
  };
}

const reflow: Handler = (context) => overflow(context, { width: 320, height: 256 }, "WCAG 1.4.10: het venster teruggebracht tot 320 bij 256 CSS-pixels en daarna hersteld");

const zoom: Handler = (context) => {
  const viewport = context.surface.page.viewportSize()!;
  return overflow(context, { width: Math.round(viewport.width / 2), height: Math.round(viewport.height / 2) }, "WCAG 1.4.4: het venster gehalveerd, wat de indeling geeft van 200% zoom, en daarna hersteld");
};

/** With `--keep` the page keeps the wider spacing after the measurement: what only exists with it can then be opened and looked at. */
const spacing: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const path = images.image();
  const measured = await textSpacing(surface.page, path, options.keep !== true);
  const clipped = measured.newlyClipped as unknown as { tag: string; text: string }[];
  return {
    result: measured,
    print: {
      newlyClipped: clipped.length,
      ...(clipped.length > 0 ? { first: clipped.slice(0, MAX_LISTED).map(where) } : {}),
      textWithoutSpacing: measured.textWithoutSpacingCount,
      horizontalScrollAfter: measured.horizontalScrollAfter,
      ...(options.keep === true ? { kept: "de ruimere tekstafstand blijft aan tot de volgende open" } : {}),
      image: images.relative(path),
    },
  };
};

const MODE_FOCUS = 10;
const MAX_MODE_FOCUS = 40;

/** What the answer of `forced` says about its own standing: the mode is no requirement, what disappears is a lead. */
export const FORCED_NOTE = "geforceerde kleuren en de wens om meer contrast zijn geen eis van WCAG. Wat hier verdwijnt is een aanwijzing voor 1.4.11 (grens, pictogram), 2.4.7 (focusaanduiding) en 1.4.1 (kleur als enig onderscheid) en een open punt, geen bevinding op zich: meet het criterium in de gewone stand";

/** The page, or one element, seen again with forced colours or with the wish for more contrast: what the mode takes away. */
const forced: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const mode = options["more-contrast"] === true ? "more-contrast" : "forced-colors";
  const only = context.target?.path ?? null;
  const image = images.image();
  const focusImage = only ? images.image("-focus") : null;
  const measured = await colourModeView(surface.page, mode, { only, maxFocus: only ? 1 : numberOption(options, "max", MODE_FOCUS, MAX_MODE_FOCUS), image, ...(focusImage ? { focusImage } : {}) });
  if (!measured.applied) throw new Error("de browser nam de stand niet aan: de pagina zag geen geforceerde kleuren of wens om meer contrast");
  const name = (item: { tag: string; text?: string; inControl?: string | null }): string => `${item.tag}: ${(item.text ?? item.inControl ?? "").slice(0, 40)}`;
  const count = (fates: Fate[], fate: Fate): number => fates.filter((entry) => entry === fate).length;
  const listed = (lines: string[]): string[] => [...lines.slice(0, MAX_LISTED), ...(lines.length > MAX_LISTED ? [`(+${lines.length - MAX_LISTED})`] : [])];
  const boundaries = measured.controls.map((control) => control.boundary.fate);
  const focused = measured.controls.filter((control) => control.focus);
  const share = (value: number | null | undefined): string => (value === null || value === undefined ? "?" : String(Math.round(value * 10000) / 10000));
  const boundaryGone = measured.controls.filter((control) => control.boundary.fate === "disappears").map((control) => `${name(control)} (${control.boundary.before.ratio} -> ${control.boundary.after?.ratio ?? "?"})`);
  const focusGone = focused.filter((control) => control.focus!.fate === "disappears").map((control) => `${name(control)} (aandeel ${share(control.focus!.before.pixelShare)} -> ${share(control.focus!.after?.pixelShare)})`);
  const drawingsGone = measured.graphics.filter((graphic) => graphic.drawing.fate === "disappears").map((graphic) => `${graphic.where.split(" >>> ").at(-1)!.slice(0, 50)}${graphic.controlHasText === false ? " (bedieningselement zonder tekst)" : ""} (${graphic.drawing.before.ratio} -> ${graphic.drawing.after?.ratio ?? "leeg"})`);
  return {
    result: measured,
    print: {
      mode: mode === "forced-colors" ? "geforceerde kleuren" : "meer contrast",
      controls: measured.controls.length,
      boundary: { blijft: count(boundaries, "stays"), verdwijnt: count(boundaries, "disappears"), komtErbij: count(boundaries, "appears"), wasErNiet: count(boundaries, "absent"), nietGemeten: count(boundaries, "unknown") },
      ...(boundaryGone.length > 0 ? { boundaryDisappears: listed(boundaryGone) } : {}),
      focus: { gemeten: focused.length, blijft: count(focused.map((control) => control.focus!.fate), "stays"), verdwijnt: focusGone.length, ...(measured.focusNotMeasured > 0 ? { nietGevraagd: measured.focusNotMeasured } : {}) },
      ...(focusGone.length > 0 ? { focusDisappears: listed(focusGone) } : {}),
      drawings: measured.graphics.length,
      ...(drawingsGone.length > 0 ? { drawingsDisappear: listed(drawingsGone) } : {}),
      image: images.relative(image),
      ...(focusImage && focused.some((control) => control.focus!.after?.pixelShare !== null && control.focus!.after !== null) ? { focusImage: images.relative(focusImage) } : {}),
      note: FORCED_NOTE,
    },
  };
};

const VISION_NL: Record<Vision, string> = { normal: "gewoon", protanopia: "protanopie", deuteranopia: "deuteranopie", tritanopia: "tritanopie", achromatopsia: "achromatopsie" };

/** What the answer of `distinct` says about its own standing: where the limit of 3 to 1 comes from, and what it does not see. */
export const DISTINCT_NOTE = "verhouding volgens de contrastformule van WCAG tussen de kleuren van de twee, afgelezen van de pixels: gewoon en zoals Chromium protanopie, deuteranopie, tritanopie en achromatopsie nabootst. Een verhouding onder 3 op 1 zonder ander kenmerk is een aanwijzing voor 1.4.1: dat is techniek G183 van W3C voor links, een techniek en geen normtekst. other noemt wat in de opmaak naast kleur verschilt; een pictogram, vorm of tekst die het verschil ook toont, stel je zelf vast (crop)";

/** The second element of a comparison: a number or a selector, in the same document as the first. */
async function againstElement(context: Context, value: string | boolean): Promise<TargetInfo> {
  if (typeof value !== "string" || !(/^\d+$/.test(value) || value.startsWith("css:"))) throw new UsageError("--against verwacht het nummer van een element (uit look of find) of css:<selector>");
  let info: TargetInfo;
  try {
    if (value.startsWith("css:")) {
      const found = await findOnPage(context.surface, "css", value.slice(4).trim(), 1);
      if (found.total !== 1) throw new Error(found.total === 0 ? `geen element voor ${value}` : `${found.total} elementen voor ${value}; maak de selector preciezer of kies een nummer uit find`);
      info = found.items[0]!;
    } else info = await resolveRef(context.surface, Number(value));
  } catch (error) {
    throw new UsageError(`--against: ${(error as Error).message.split("\n")[0]}`);
  }
  const home = await homeOf(context.surface, info);
  if (home.surface.page !== context.surface.page) throw new UsageError("--against: de twee elementen staan niet in hetzelfde venster");
  return home.target;
}

/** Which of the three colours sets the two furthest apart in one kind of vision. */
const decides = (entry: VisionRatios): string | null => (entry.ratio === null ? null : entry.ratio === entry.ink ? "tekst" : entry.ratio === entry.background ? "achtergrond" : "rand");

/** How far a link is from the text around it in colour, or one element from another, as everybody sees it and with each kind of colour vision deficiency. */
const distinct: Handler = async (context, _args, options) => {
  const against = options.against !== undefined ? await againstElement(context, options.against) : null;
  const measured = await distinctByColour(context.surface.page, needTarget(context).path, against?.path ?? null);
  if ("error" in measured) throw new UsageError(measured.error);
  const side = (item: Side): string => `${item.tag}: ${item.text.slice(0, 40)}`;
  const normal = measured.visions[0]!;
  const by = decides(normal);
  const colour = (colours: VisionRatios["first"]): string | null => (by === "tekst" ? colours.ink : by === "achtergrond" ? colours.background : colours.edge);
  return {
    result: measured,
    print: {
      pair: measured.pair === "link-in-text" ? "element tegenover de tekst eromheen" : "twee elementen",
      first: side(measured.first),
      second: side(measured.second),
      ...(by ? { colours: `${by} ${colour(normal.first)} tegenover ${colour(normal.second)}` } : {}),
      ratios: Object.fromEntries(measured.visions.map((entry) => [VISION_NL[entry.vision], entry.ratio])),
      ...(measured.lowest ? { lowest: `${VISION_NL[measured.lowest.vision]} ${measured.lowest.ratio}` } : {}),
      other: measured.other.length > 0 ? measured.other : "geen gevonden in de opmaak",
      lead: measured.lead,
      note: DISTINCT_NOTE,
    },
  };
};

const MAX_JUMPS = 12;

const order: Handler = async (context) => {
  const { surface, images } = context;
  const { page } = surface;
  const report = await visualOrder(page);
  const doc = await syncRefs(surface);
  const refs = await tgs<(number | null)[]>(surface, "refsForPaths", report.sequence.map((item) => item.path));
  const sequence = report.sequence.map((item, index) => ({ ...item, ref: refs[index] ?? null }));
  if (doc) remember(surface, doc, sequence);
  const picture = PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
  drawMarks(picture, sequence.map((item) => ({ label: String(item.ref ?? item.index), box: item.box, colour: MARK_COLOURS[item.kind]!, frame: 1 })));
  const path = images.image();
  await writeFile(path, PNG.sync.write(picture));
  const byIndex = new Map(sequence.map((item) => [item.index, item]));
  const listed = (items: { tag: string; text: string }[], extra: (item: never) => string): string[] => items.slice(0, MAX_LISTED).map((item) => `${where(item)} (${extra(item as never)})`);
  return {
    result: { ...report, sequence },
    print: {
      items: sequence.length,
      sequence: sequence.map((item) => item.ref).join(" "),
      jumps: report.jumps.slice(0, MAX_JUMPS).map((jump) => `${jump.direction}: ${brief(byIndex.get(jump.from)!)} -> ${brief(byIndex.get(jump.to)!)}`),
      ...(report.jumps.length > MAX_JUMPS ? { moreJumps: report.jumps.length - MAX_JUMPS } : {}),
      ...(report.cssOrder.length > 0 ? { cssOrder: listed(report.cssOrder, (item: { order: string }) => `order ${item.order}`) } : {}),
      ...(report.reversed.length > 0 ? { reversed: listed(report.reversed, (item: { flexDirection: string }) => item.flexDirection) } : {}),
      ...(report.positioned.length > 0 ? { positioned: listed(report.positioned, (item: { position: string }) => item.position) } : {}),
      ...(report.positiveTabindex.length > 0 ? { positiveTabindex: listed(report.positiveTabindex, (item: { tabindex: string }) => `tabindex ${item.tabindex}`) } : {}),
      image: images.relative(path),
      note: "sequence: de refs in de volgorde van de code; jumps: waar die volgorde op het scherm terugspringt",
    },
  };
};

const DEFAULT_TAB_STOPS = 25;
const MAX_TAB_STOPS = 120;

const tabwalk: Handler = async (context, _args, options) => {
  const { surface, images } = context;
  const dir = images.dir("focus");
  if (!context.target) {
    // Start at the top of the document. A browser continues from where focus last was, also after
    // a blur, so focus is put on the body for a moment.
    await surface.page.evaluate(() => {
      const previous = document.body.getAttribute("tabindex");
      document.body.setAttribute("tabindex", "-1");
      document.body.focus({ preventScroll: true });
      if (previous === null) document.body.removeAttribute("tabindex");
      else document.body.setAttribute("tabindex", previous);
    });
  }
  const walk = (await tabWalk(surface.page, { focusDir: dir.absolute, focusPath: dir.relative, maxStops: numberOption(options, "max", DEFAULT_TAB_STOPS, MAX_TAB_STOPS), ...(context.target ? { from: context.target.path } : {}) })) as {
    outcome: string;
    stopCount: number;
    stops: { path: string[]; tag: string; text: string; inViewport: boolean; coveredBy: string[] | null; focusPixelShare: number | null; indicatorRatio: number | null; focusNotMeasured?: string }[];
  };
  const doc = await syncRefs(surface);
  const refs = await tgs<(number | null)[]>(surface, "refsForPaths", walk.stops.map((stop) => stop.path)).catch(() => [] as (number | null)[]);
  const stops = walk.stops.map((stop, index) => ({ ...stop, ref: refs[index] ?? null }));
  if (doc) remember(surface, doc, stops);
  const share = (stop: (typeof stops)[number]): string => (stop.focusPixelShare === null ? "niet gemeten" : `${Math.round(stop.focusPixelShare * 10000) / 10000}${stop.indicatorRatio !== null ? ` ${stop.indicatorRatio}:1` : ""}`);
  return {
    result: { ...walk, stops },
    print: {
      outcome: walk.outcome,
      stops: stops.map((stop) => `${brief(stop)} | ${share(stop)}${stop.coveredBy ? " [bedekt]" : ""}${stop.inViewport ? "" : " [buiten venster]"}`),
      images: dir.relative,
      note: "per stop: ref, element, aandeel pixels dat met focus verandert en contrast van de focusindicator",
    },
  };
};

/** The closed list of commands that act on, look at or measure a page. */
export const COMMANDS: Record<string, Spec> = {
  // Each act command also reports what changed without any text changing; see actWith.
  click: { target: "first-argument", changes: true, run: actWith(click) },
  key: { target: "focus", changes: true, run: actWith(key) },
  tab: { target: "none", changes: true, run: actWith(tab) },
  type: { target: "first-argument", changes: true, run: actWith(type) },
  select: { target: "first-argument", changes: true, run: actWith(select) },
  // Paste and press in parts live in inputs.ts.
  paste: { target: "first-argument", changes: true, run: actWith(paste) },
  press: { target: "first-argument", changes: true, run: press },
  hover: { target: "first-argument", changes: true, run: actWith(hover) },
  scroll: { target: "optional-first-argument", changes: true, run: scroll },
  back: { target: "none", changes: true, run: actWith(back) },
  goto: { target: "none", changes: true, run: goto },
  look: { target: "none", changes: false, run: look },
  crop: { target: "first-argument", changes: false, run: crop },
  ax: { target: "first-argument", changes: false, run: axWith(ax) },
  name: { target: "first-argument", changes: false, run: name },
  style: { target: "first-argument", changes: false, run: style },
  html: { target: "first-argument", changes: false, run: html },
  find: { target: "none", changes: false, run: find },
  // Each of the measuring commands below answers one question with every method that can; see opinions.ts.
  contrast: { target: "first-argument", changes: false, run: contrastWith(contrast, oneMethod("pixel-screenshot", contrast)) },
  // The instruments below move focus, resize the window or restyle the text, and put back
  // what they can. What they may have set off stays, so they count as steps of the recipe.
  focus: { target: "first-argument", changes: true, run: focusWith(focus, oneMethod("pixel-diff", focus)) },
  target: { target: "first-argument", changes: false, run: targetWith(target, oneMethod("layout-box", target)) },
  reflow: { target: "none", changes: true, run: layoutWith(reflow, oneMethod("overflow-geometry", reflow), "reflow") },
  spacing: { target: "none", changes: true, run: layoutWith(spacing, oneMethod("forced-text-spacing", spacing), "spacing") },
  zoom: { target: "none", changes: true, run: layoutWith(zoom, oneMethod("overflow-geometry", zoom), "zoom") },
  order: { target: "none", changes: false, run: oneMethod("box-order", order) },
  // Moves focus over the controls and puts the colours back: what focus set off stays, so it is a step of the recipe.
  forced: { target: "optional-first-argument", changes: true, run: oneMethod("colour-mode-emulation", forced) },
  distinct: { target: "first-argument", changes: false, run: oneMethod("vision-emulation-pixels", distinct) },
  rules: { target: "optional-first-argument", changes: false, run: rules },
  // The earlier name of `rules`.
  engines: { target: "optional-first-argument", changes: false, run: rules },
  taborder: { target: "option-from", changes: true, run: taborderWith(tabwalk, oneMethod("keyboard-walk", tabwalk), "taborder") },
  // The earlier name of `taborder`.
  tabwalk: { target: "option-from", changes: true, run: taborderWith(tabwalk, oneMethod("keyboard-walk", tabwalk), "tabwalk") },
  lang: { target: "optional-first-argument", changes: false, run: lang },
  source: { target: "none", changes: false, run: source },
  ocr: { target: "first-argument", changes: false, run: ocrCommand },
  motion: { target: "none", changes: false, run: motion },
  // Sets off the timers that are waiting, which changes the page.
  timers: { target: "none", changes: true, run: timers },
  media: { target: "optional-first-argument", changes: false, run: media },
  // What a simulated screen reader says; with --click or --type it acts first, like the act commands above, and is then a step of the recipe.
  speak: { target: "optional-first-argument", changes: speakActs, run: speakWith({ click: actWith(click), type: actWith(type), key: actWith(key) }) },
};

/** Commands an agent may give; `goto` exists only as a step inside a recipe. */
export const PUBLIC_COMMANDS = Object.keys(COMMANDS).filter((name) => name !== "goto");
