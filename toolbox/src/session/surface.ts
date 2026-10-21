import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, ElementHandle, Frame, Page, Response } from "playwright";
import { frameAsPage, frameRecord } from "../browser/frame.ts";
import { INPAGE_PATH, loadPage, newContext, settlePage, type LoadResult } from "../browser/session.ts";
import { LOGOUT_REFUSED_NL, logsOut } from "../lib/login.ts";
import { setRunReads, type ReadRequest } from "../lib/reads.ts";
import { approvedReads } from "../lib/sitemodel.ts";
import { canonicalJson, sha256 } from "../lib/canonical.ts";
import type { FrameTarget, Locators, PageRecord, StartState, StateRecord, Step, TargetRecord } from "./observations.ts";
import { guardContext, guardRedirects, guardRedirectsByRoute, urlInScope, type Blocked, type DaemonLimits, type Guard, type Politeness, type Scope } from "./safety.ts";
import { refusalNl, type Blockade } from "./blockade.ts";

/** The part of the in-page library that only a session uses: reference numbers that last. */
export const SESSION_INPAGE_PATH = fileURLToPath(new URL("./inpage-session.js", import.meta.url));

// Read once, when the process starts: a page opened an hour later gets the library the process started with, whatever happened to the files since.
const INPAGE_SOURCE = readFileSync(INPAGE_PATH, "utf8");
const SESSION_INPAGE_SOURCE = readFileSync(SESSION_INPAGE_PATH, "utf8");

/** What every session in the process shares. */
export interface Env {
  browser: Browser;
  runDir: string;
  scope: Scope;
  politeness: Politeness;
  limits: DaemonLimits;
  /** The read requests a page may send; left out, those of a site model that passed `check-site` (see `approvedReads`). */
  reads?: ReadRequest[];
  /** The origins of the site that blocked the run and are asked nothing more; left out, none are watched. */
  blockade?: Blockade;
}

export interface TargetInfo extends TargetRecord {
  doc: string;
  region: string | null;
  box: { x: number; y: number; width: number; height: number };
  viewportBox: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

/**
 * One page being driven: the page of a session, or a throwaway page on which an earlier
 * observation is repeated. It knows how it got into its current state.
 *
 * An embedded frame is a surface too: the same session, steps and numbers, with the document
 * of the frame as its page (see `enter`). A command about an element in a frame is given that
 * surface, and so does in the frame what it does on a page.
 */
export interface Surface {
  context: BrowserContext;
  /** The document a command works in: the page in the tab, or an embedded frame seen as a page. */
  page: Page;
  /** The surface of the tab itself; for the page in the tab that is this surface. */
  top: Surface;
  /** Set on the surface of an embedded frame: which frame, and the selector chain from the tab down to the frame element. */
  frame?: FrameTarget;
  guard: Guard;
  start: StartState;
  steps: Step[];
  /** Highest reference number handed out so far; numbering continues across pages. */
  refBase: number;
  /** Where each reference that was shown to the agent pointed, with the chain from the tab down, to find the element again when a page redraws itself. */
  refs: Map<number, { doc: string; path: string[]; tag?: string; text?: string }>;
  popups: string[];
  alerts: { type: string; message: string }[];
  /** Counts navigations of the main frame, to tell whether an action caused one. */
  navigations: number;
  /** Embedded frames that went to another document since the last action settled. */
  framesNavigated: Set<Frame>;
  /** The answer of the server to the last document the main frame loaded: the source as it was received. */
  received?: Response;
}

export function stateOf(surface: Surface | null): StateRecord {
  const start = surface?.start ?? null;
  const steps = surface ? surface.steps.map((step) => ({ ...step })) : [];
  // The extra locators of a step are help for finding its element again, not part of what the state is.
  return { id: sha256(canonicalJson({ start, steps: steps.map(({ locators: _locators, ...step }) => step) })).slice(0, 12), start, steps };
}

/**
 * Call a function of the session's in-page library, in the document of the surface. Every
 * document numbers its own elements; the call says where the numbering of the session stands
 * and takes back where it got to, so a number never points at two elements.
 */
export async function tgs<T>(surface: Surface, name: string, ...args: unknown[]): Promise<T> {
  const answer = await surface.page.evaluate(
    ([base, fn, parameters]) => (window as unknown as { __loeps: { numbered: (base: number, name: string, parameters: unknown[]) => { value: unknown; next: number } } }).__loeps.numbered(base as number, fn as string, parameters as unknown[]),
    [surface.refBase, name, args] as const,
  );
  surface.refBase = Math.max(surface.refBase, answer.next - 1);
  return answer.value as T;
}

export async function handleForRef(page: Page, ref: number): Promise<ElementHandle<HTMLElement> | null> {
  const handle = await page.evaluateHandle((number) => (window as unknown as { __loeps: { get: (ref: number) => Element | null } }).__loeps.get(number), ref);
  return handle.asElement() as ElementHandle<HTMLElement> | null;
}

/** An error that carries the requests that were refused on the way to it. */
export class Refused extends Error {
  readonly blocked: Blocked[];

  constructor(message: string, blocked: Blocked[]) {
    super(message);
    this.blocked = blocked;
  }
}

/** The surface of a tab: its own top. */
export function topSurface(fields: Omit<Surface, "top" | "frame">): Surface {
  const surface = fields as Surface;
  surface.top = surface;
  return surface;
}

/**
 * The page that embeds an address, when the inventory found the address only as an embedded
 * window. A visitor's browser names that page when it loads the window; a player that may only
 * play on the site refuses an address opened on its own without it.
 */
export function embeddingPage(runDir: string, url: string): string | undefined {
  const path = join(runDir, "inventory.json");
  if (!existsSync(path)) return undefined;
  const inventory = JSON.parse(readFileSync(path, "utf8")) as { pages: { url: string; foundVia: string[] }[] };
  const via = inventory.pages.find((page) => page.url === url)?.foundVia ?? [];
  if (via.length === 0 || !via.every((entry) => entry.startsWith("iframe:"))) return undefined;
  return via[0]!.slice("iframe:".length);
}

/** Open a fresh browser context on the start URL, with every safety limit of a session in place. `sender`: the session it is for, which sends from its own share of the budget for sending. */
export async function openSurface(env: Env, start: StartState, onContext?: (context: BrowserContext) => void, sender?: string): Promise<{ surface: Surface; load: LoadResult }> {
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, ...(sender ? { sender } : {}) };
  // A page is opened over http or https only: never a file on this machine, a data: or blob: address, or a socket.
  const web = /^https?:/i.test(start.url);
  if (!web || !urlInScope(env.scope, start.url)) {
    const refusal: Blocked = { at: new Date().toISOString(), kind: "scope", method: "GET", url: start.url.slice(0, 300), resourceType: "document" };
    throw new Refused(web ? `${start.url} ligt buiten de scope van deze run (${env.scope.hosts.join(", ")}); er is niets opgevraagd` : `${start.url.slice(0, 120)} is geen adres met http:// of https://; een sessie opent alleen pagina's van de site. Er is niets opgevraagd`, [refusal]);
  }
  const blockedBy = env.blockade?.refuses(start.url);
  if (blockedBy) throw new Refused(`${start.url} is niet opgevraagd: ${refusalNl(blockedBy)}`, [{ at: new Date().toISOString(), kind: "blockade", method: "GET", url: start.url.slice(0, 300), resourceType: "document", reasonNl: refusalNl(blockedBy) }]);
  // In a run with a login an address that logs out is not opened: say so in words, before a browser is asked.
  if (logsOut(start.url)) throw new Refused(`${start.url}: ${LOGOUT_REFUSED_NL}`, [{ at: new Date().toISOString(), kind: "logout", method: "GET", url: start.url.slice(0, 300), resourceType: "document" }]);
  const reads = env.reads ?? approvedReads(env.runDir);
  // The instruments in this process read the same rules: a search that went through is no submission that was held back.
  setRunReads(reads);
  const context = await newContext(env.browser, { viewport: { width: start.width, height: start.height }, colorScheme: start.scheme, reads });
  onContext?.(context);
  try {
    await guardContext(context, env.scope, guard, reads, env.blockade);
    await context.addInitScript({ content: INPAGE_SOURCE });
    await context.addInitScript({ content: SESSION_INPAGE_SOURCE });
    const page = await context.newPage();
    // Pausing a response needs Chromium's protocol; another browser gets the same watch through its routes.
    if (env.browser.browserType().name() === "chromium") await guardRedirects(page, env.scope, guard);
    else await guardRedirectsByRoute(context, env.scope, guard);
    const surface = topSurface({ context, page, guard, start, steps: [], refBase: 0, refs: new Map(), popups: [], alerts: [], navigations: 0, framesNavigated: new Set() });
    // A session has one window. Whatever else a page opens is noted and closed.
    context.on("page", (other) => {
      if (other === page) return;
      void other
        .waitForLoadState("domcontentloaded", { timeout: 2000 })
        .catch(() => undefined)
        .then(() => {
          surface.popups.push(other.url());
          return other.close();
        })
        .catch(() => undefined);
    });
    page.on("dialog", (dialog) => {
      surface.alerts.push({ type: dialog.type(), message: dialog.message().slice(0, 300) });
      dialog.dismiss().catch(() => undefined);
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return void surface.framesNavigated.add(frame);
      surface.navigations++;
      env.politeness.seen(frame.url());
    });
    // Only the reference is kept; the body is asked for when a command wants the source.
    page.on("response", (response) => {
      try {
        if (response.frame() === page.mainFrame() && response.request().isNavigationRequest() && !(response.status() >= 300 && response.status() < 400)) surface.received = response;
      } catch {
        // A response without a frame, such as one for a worker: not the document.
      }
    });
    await env.politeness.before(start.url);
    const load = await loadPage(page, start.url, embeddingPage(env.runDir, start.url));
    await leftScope(env, surface);
    return { surface, load };
  } catch (error) {
    // A page that gives no answer in time did not load; a connection that failed was told to the blockade by the guard.
    if ((error as Error).name === "TimeoutError") env.blockade?.failed(start.url);
    await context.close().catch(() => undefined);
    const refused = guard.blocked.at(-1);
    const message = (error as Error).message.split("\n")[0]!;
    throw new Refused(refused ? `${message} (geweigerd: ${refused.method} ${refused.url})` : message, guard.blocked);
  }
}

/** A page that ended up on a host outside the scope is left at once; nothing more is done there. */
export async function leftScope(env: Env, surface: Surface): Promise<void> {
  const { page } = surface.top;
  const url = page.url();
  // A page that did not load stays empty or shows the browser's own error page: it went nowhere.
  if (urlInScope(env.scope, url) || /^(about|chrome-error):/.test(url)) return;
  surface.guard.blocked.push({ at: new Date().toISOString(), kind: "left-scope", method: "GET", url: url.slice(0, 300), resourceType: "document" });
  await page.goto("about:blank").catch(() => undefined);
  const where = /^(https?|wss?):/.test(url) ? new URL(url).hostname : `een adres dat begint met ${url.split(":")[0]}:`;
  throw new Error(`de pagina kwam uit op ${where}, buiten de scope van deze run; de pagina is verlaten, begin opnieuw met open`);
}

/** Wait for whatever an action set in motion: a short pause, and the full settling of a page when it navigated. */
export async function settleAfter(surface: Surface, navigationsBefore: number, pauseMs: number): Promise<void> {
  const { page } = surface.top;
  await page.waitForTimeout(pauseMs);
  // An embedded frame that the action sent somewhere else is waited for as well.
  for (const frame of surface.framesNavigated) await frame.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
  surface.framesNavigated.clear();
  if (surface.navigations === navigationsBefore) return;
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
  await settlePage(page);
}

/** Start on a document: which document it is, and a clean registry in the read-only library. The numbering itself is kept by `tgs`. */
export async function syncRefs(surface: Surface): Promise<string | null> {
  const synced = await tgs<{ doc: string }>(surface, "sync", surface.refBase).catch(() => null);
  return synced?.doc ?? null;
}

const fromTab = (surface: Surface, path: string[]): string[] => (surface.frame ? [...surface.frame.path, ...path] : path);

/** Note where the numbers in a result of this surface point. */
export function remember(surface: Surface, doc: string, items: { ref: number | null; path: string[]; tag?: string; text?: string }[]): void {
  for (const item of items) {
    if (item.ref === null) continue;
    surface.refs.set(item.ref, { doc, path: fromTab(surface, item.path), ...(typeof item.tag === "string" ? { tag: item.tag } : {}), ...(typeof item.text === "string" ? { text: item.text.slice(0, 80) } : {}) });
  }
}

/** An element as the tab knows it: the chain from the tab down, and the frame it sits in. Inside its own document its chain starts at that document. */
function outward<T extends TargetInfo>(surface: Surface, info: T): T {
  const known = { ...info, path: fromTab(surface, info.path), ...(surface.frame ? { frame: surface.frame } : {}) };
  surface.refs.set(known.ref, { doc: known.doc, path: known.path, tag: known.tag, text: known.text });
  return known;
}

const MAX_FRAME_DEPTH = 5;
const frameSurfaces = new WeakMap<object, { surface: Surface; held: { page: Page; frame: FrameTarget; depth: number } }>();
const depthOf = (surface: Surface): number => (surface.frame ? (frameSurfaces.get(surface)?.held.depth ?? 1) : 0);

/**
 * The surface of an embedded frame, given the selector chain of the frame element in the
 * document of `surface`. Null when there is nothing to work in: the frame is empty, did not
 * load, or does not run scripts.
 */
export async function enter(surface: Surface, element: string[]): Promise<Surface | null> {
  const depth = depthOf(surface) + 1;
  if (depth > MAX_FRAME_DEPTH) return null;
  const handle = await surface.page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => Element | null } }).__loep.resolve(chain), element);
  const frame = (await handle.asElement()?.contentFrame().catch(() => null)) ?? null;
  await handle.dispose().catch(() => undefined);
  if (!frame) return null;
  const ready = await frame.evaluate(() => typeof (window as unknown as { __loeps?: unknown }).__loeps === "object" && document.body !== null && document.body.childNodes.length > 0).catch(() => false);
  if (!ready) return null;
  const held = { page: await frameAsPage(surface.top.page, frame), frame: { ...(await frameRecord(frame)), path: fromTab(surface, element) }, depth };
  const known = frameSurfaces.get(frame);
  if (known) {
    known.held = held;
    return known.surface;
  }
  // The same surface for as long as the frame lives: what was measured in it is kept under it.
  const entry = { held, surface: null as unknown as Surface };
  entry.surface = new Proxy(surface.top, { get: (target, key) => (key === "page" ? entry.held.page : key === "frame" ? entry.held.frame : Reflect.get(target, key)), has: (target, key) => key === "frame" || Reflect.has(target, key) });
  frameSurfaces.set(frame, entry);
  frameSurfaces.set(entry.surface, entry);
  return entry.surface;
}

/** The document a selector chain ends in, and the part of the chain inside that document. Null when a frame on the way cannot be entered. */
export async function locate(surface: Surface, path: string[]): Promise<{ surface: Surface; path: string[] } | null> {
  let current = surface;
  let rest = path;
  for (;;) {
    const hop = await tgs<number>(current, "frameHop", rest).catch(() => 0);
    if (hop === 0) return { surface: current, path: rest };
    const inner = await enter(current, rest.slice(0, hop));
    if (!inner) return null;
    current = inner;
    rest = rest.slice(hop);
  }
}

/** The surface itself and every embedded frame in it that a visitor sees and that can be read, in the order of the document. */
export async function documents(surface: Surface): Promise<Surface[]> {
  const found = [surface];
  const frames = await tgs<{ path: string[] }[]>(surface, "frames").catch(() => []);
  for (const element of frames) {
    const inner = await enter(surface, element.path).catch(() => null);
    if (inner) found.push(...(await documents(inner)));
  }
  return found;
}

/** A frame in the words of a visitor: its title when it has one, and where its document comes from. */
export const sayFrame = (frame: FrameTarget): string => `${frame.title ? `"${frame.title.slice(0, 60)}" ` : ""}${frame.origin || frame.url.slice(0, 80)}`;

/** The same document on another tab, such as the page of a second browser: the frame at the end of the same chain. */
export async function counterpart(other: Surface, surface: Surface): Promise<Surface> {
  if (!surface.frame) return other.top;
  const home = await locate(other.top, [...surface.frame.path, "html"]);
  if (!home?.surface.frame) throw new Error(NO_FRAME);
  return home.surface;
}

const NO_FRAME = "het ingesloten venster waar dit element in zat is er niet meer, of is niet te lezen";

/** The element behind a reference number, as it is now. Throws a message an agent can act on when the number no longer points anywhere. */
export async function resolveRef(surface: Surface, ref: number): Promise<TargetInfo> {
  const known = surface.refs.get(ref);
  const home = known ? await locate(surface.top, known.path) : { surface: surface.top, path: [] };
  if (!home) throw new Error(`ref ${ref}: ${NO_FRAME}; vraag nieuwe nummers op met look of find`);
  const doc = await syncRefs(home.surface);
  let info = await tgs<TargetInfo | null>(home.surface, "info", ref);
  // A number stays with its element. When the page replaced the element, the number goes to what is at the same place only when that is the same thing.
  if (!info && known && known.doc === doc && (await tgs<boolean>(home.surface, "rebind", ref, home.path, known.tag ?? null, known.text ?? null))) info = await tgs<TargetInfo | null>(home.surface, "info", ref);
  if (!info) {
    throw new Error(known && known.doc !== doc ? `ref ${ref} hoort bij een eerdere pagina; vraag nieuwe nummers op met look of find` : `ref ${ref} wijst niet (meer) naar een element op deze pagina: het is weg of de pagina heeft het vervangen; vraag nieuwe nummers op met look of find`);
  }
  return outward(home.surface, info);
}

/** The element behind a selector chain, with a reference number: how a recorded step finds its element on a fresh page. */
export async function resolvePath(surface: Surface, path: string[]): Promise<TargetInfo | null> {
  const home = await locate(surface.top, path);
  if (!home) return null;
  await syncRefs(home.surface);
  const info = await tgs<TargetInfo | null>(home.surface, "refForPath", home.path);
  return info ? outward(home.surface, info) : null;
}

/** The element of a recorded step, found by its selector chain or, when that fails, by what else was recorded about it. */
export async function resolveStep(surface: Surface, step: { target: string[]; locators?: Locators | null }): Promise<(TargetInfo & { matchedBy: string }) | null> {
  const home = await locate(surface.top, step.target);
  if (!home) return null;
  await syncRefs(home.surface);
  const info = await tgs<(TargetInfo & { matchedBy: string }) | null>(home.surface, "resolveStep", home.path, step.locators ?? null);
  return info ? outward(home.surface, info) : null;
}

/**
 * The surface a command about this element works in, and the element as that document knows
 * it. This is the one place where an embedded frame is taken along: whatever runs with what
 * comes back does in a frame what it does on a page.
 */
export async function homeOf(surface: Surface, target: TargetInfo): Promise<{ surface: Surface; target: TargetInfo }> {
  if (!target.frame) return { surface: surface.top, target };
  const home = await locate(surface.top, target.path);
  if (!home) throw new Error(NO_FRAME);
  return { surface: home.surface, target: { ...target, path: home.path } };
}

export interface Found {
  total: number;
  hidden: number;
  items: TargetInfo[];
}

/** Elements that match a query, on the page and in every embedded frame. */
export async function find(surface: Surface, kind: string, wanted: string, max: number): Promise<Found> {
  const all: Found = { total: 0, hidden: 0, items: [] };
  for (const [index, document] of (await documents(surface.top)).entries()) {
    await syncRefs(document);
    // A query that is wrong is wrong on the page itself; a frame that cannot answer is left out.
    const found = await tgs<Found>(document, "find", kind, wanted, max).catch((error: Error) => {
      if (index === 0) throw error;
      return null;
    });
    if (!found) continue;
    all.total += found.total;
    all.hidden += found.hidden;
    all.items.push(...found.items.map((item) => outward(document, item)));
  }
  all.items = all.items.slice(0, max);
  return all;
}

interface InPageState {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: [number, number];
  pageHeight: number;
  focus: TargetInfo | null;
  dialogs: number;
  snapshot: string;
}

export interface PageFacts extends PageRecord {
  pageHeight: number;
  /** What has focus, followed into an embedded frame. */
  focus: TargetInfo | null;
  dialogs: number;
}

/** Where the session is: the tab, with what its embedded frames hold and what has focus in them. */
export async function pageFacts(surface: Surface): Promise<PageFacts | null> {
  const top = surface.top;
  const state = await tgs<InPageState>(top, "pageState").catch(() => null);
  if (!state) return null;
  const { snapshot, ...rest } = state;
  const snapshots = [snapshot];
  let focus = state.focus ? outward(top, state.focus) : null;
  for (const document of (await documents(top).catch(() => [top])).slice(1)) {
    const inner = await tgs<{ snapshot: string; focus: TargetInfo | null }>(document, "pageState").catch(() => null);
    if (!inner) continue;
    const frame = document.frame!.path.join(" >>> ");
    snapshots.push(`#frame ${frame}\n${inner.snapshot}`);
    // The document around a frame names the frame element as what has focus; the frame knows which element it is.
    if (inner.focus && focus && focus.path.join(" >>> ") === frame) focus = outward(document, inner.focus);
  }
  return { ...rest, focus, scheme: surface.start.scheme, domSha256: sha256(snapshots.join("\n")) };
}

export interface ChangeState {
  url: string;
  doc: string;
  dialogs: number;
  expanded: number;
  chunks: string[];
  live: string[];
  scroll: [number, number];
}

/** What an action can change, on the page and in every embedded frame: an action in a frame can show itself around it, and the other way round. */
export async function changeState(surface: Surface): Promise<ChangeState> {
  const top = surface.top;
  const state = await tgs<ChangeState>(top, "changeState");
  for (const document of (await documents(top).catch(() => [top])).slice(1)) {
    const inner = await tgs<ChangeState>(document, "changeState").catch(() => null);
    if (!inner) continue;
    state.dialogs += inner.dialogs;
    state.expanded += inner.expanded;
    state.chunks.push(...inner.chunks);
    state.live.push(...inner.live);
  }
  return state;
}

export const toRecord = (facts: PageFacts | null): PageRecord | null =>
  facts ? { url: facts.url, title: facts.title, viewport: facts.viewport, scheme: facts.scheme, scroll: facts.scroll, domSha256: facts.domSha256 } : null;
