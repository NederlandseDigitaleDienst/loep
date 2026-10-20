import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CDPSession, Frame, Page } from "playwright";

/**
 * loep's own world in a frame (#155): an isolated world of the browser that shares the DOM of the
 * page and nothing else. A script of the page cannot see what runs there, nor replace the built-in
 * functions it uses (getComputedStyle, createTreeWalker, Array.prototype): each world has its own.
 * The read-only library (inpage.js) and the helpers of the methods (inpage-methods.js) are installed
 * there on first use in each document. What the page itself must see stays in the page: the counts of
 * listeners and timers, the clipboard, the registry of elements. The library in loep's world asks the
 * library in the page for those (see "bridge" in inpage.js).
 *
 * Playwright has no public way to run a script in a world of its own; it is done through the protocol
 * of the browser (CDP), per frame, also for a frame of another origin.
 */

const WORLD_NAME = "loep";
const LIBRARY = ["./inpage.js", "../instruments/methods/inpage-methods.js"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n;\n");
/** What a call gives back when the library is not (yet) in the world it ran in: a new document, or a context that is not loep's. */
const MISSING = "__loep:missing";

/**
 * A value as it crosses between Node and a world, in the form Playwright uses for page.evaluate: undefined,
 * NaN, Infinity, -0, dates, errors and shared references survive; a DOM node becomes a short note. Plain
 * JavaScript without anything from outside itself: it runs in the world too, from its source.
 */
function encode(value: unknown): unknown {
  const seen = new Map<object, number>();
  let last = 0;
  const walk = (item: unknown): unknown => {
    if (item === undefined || typeof item === "symbol" || typeof item === "function") return { v: "undefined" };
    if (item === null) return { v: "null" };
    if (typeof item === "number") return Number.isNaN(item) ? { v: "NaN" } : item === Infinity ? { v: "Infinity" } : item === -Infinity ? { v: "-Infinity" } : Object.is(item, -0) ? { v: "-0" } : item;
    if (typeof item === "bigint") return { bi: String(item) };
    if (typeof item !== "object") return item;
    const scope = globalThis as unknown as { Window?: new () => object; Document?: new () => object; Node?: new () => object };
    if (typeof scope.Window === "function" && item instanceof scope.Window) return "ref: <Window>";
    if (typeof scope.Document === "function" && item instanceof scope.Document) return "ref: <Document>";
    if (typeof scope.Node === "function" && item instanceof scope.Node) return "ref: <Node>";
    if (item instanceof Error) return { e: { n: item.name, m: item.message, s: item.stack } };
    if (item instanceof Date) return { d: item.toJSON() };
    const known = seen.get(item);
    if (known) return { ref: known };
    const id = ++last;
    seen.set(item, id);
    if (Array.isArray(item)) {
      const a: unknown[] = [];
      for (let index = 0; index < item.length; index++) a.push(walk(item[index]));
      return { a, id };
    }
    const o: [string, unknown][] = [];
    for (const key of Object.keys(item)) {
      let entry: unknown;
      try {
        entry = (item as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      o.push([key, walk(entry)]);
    }
    const json = (item as { toJSON?: unknown }).toJSON;
    if (o.length === 0 && typeof json === "function") {
      try {
        return walk(json.call(item));
      } catch {
        // Nothing better than an empty object.
      }
    }
    return { o, id };
  };
  return walk(value);
}

/** The value `encode` was made from. Plain JavaScript without anything from outside itself, like `encode`. */
function decode(value: unknown): unknown {
  const refs = new Map<number, unknown>();
  const walk = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") return item;
    const tagged = item as Record<string, unknown>;
    if ("v" in tagged) return ({ null: null, NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 } as Record<string, unknown>)[tagged.v as string];
    if ("ref" in tagged) return refs.get(tagged.ref as number);
    if ("bi" in tagged) return BigInt(tagged.bi as string);
    if ("d" in tagged) return new Date(tagged.d as string);
    if ("e" in tagged) {
      const { n, m, s } = tagged.e as { n: string; m: string; s?: string };
      const error = new Error(m);
      error.name = n;
      error.stack = s;
      return error;
    }
    if ("a" in tagged) {
      const out: unknown[] = [];
      refs.set(tagged.id as number, out);
      for (const entry of tagged.a as unknown[]) out.push(walk(entry));
      return out;
    }
    if ("o" in tagged) {
      const out: Record<string, unknown> = {};
      refs.set(tagged.id as number, out);
      for (const [key, entry] of tagged.o as [string, unknown][]) if (key !== "__proto__") out[key] = walk(entry);
      return out;
    }
    return item;
  };
  return walk(value);
}

interface Place {
  session: CDPSession;
  frameId: string;
  /** The execution context of the world in the current document of the frame, once known. */
  context: number | null;
  /** Set in the world when the library is installed: a context without it is not loep's, or has no library yet. */
  token: string;
}

const places = new WeakMap<Frame, Promise<Place>>();
const sessions = new WeakMap<Page | Frame, Promise<CDPSession | null>>();

/** The protocol session of a page, or of a frame in a process of its own; null for a frame that shares the session of the frame above it. */
function sessionOf(owner: Page | Frame, page: Page): Promise<CDPSession | null> {
  let session = sessions.get(owner);
  if (!session) {
    session = page.context().newCDPSession(owner).catch((error: unknown) => {
      if (owner === page) throw error;
      return null;
    });
    sessions.set(owner, session);
  }
  return session;
}

/** Where the world of a frame lives: the protocol session that reaches the frame and the id it has there. */
async function locate(frame: Frame): Promise<Place> {
  const page = frame.page();
  const token = randomUUID();
  const own = frame.parentFrame() ? await sessionOf(frame, page) : await sessionOf(page, page);
  if (own) {
    const { frameTree } = await own.send("Page.getFrameTree");
    return { session: own, frameId: frameTree.frame.id, context: null, token };
  }
  // A frame in the process of the frame above it: its id is found by a mark that only this frame's page context has.
  let session: CDPSession | null = null;
  for (let holder = frame.parentFrame(); holder && !session; holder = holder.parentFrame()) session = await sessionOf(holder.parentFrame() ? holder : page, page);
  if (!session) throw new Error("het ingesloten venster is niet te bereiken");
  const mark = randomUUID();
  await frame.evaluate((value) => void ((window as unknown as { __loepFrame?: string }).__loepFrame = value), mark);
  const contexts: { id: number; frameId: string }[] = [];
  const created = (event: { context: { id: number; auxData?: { isDefault?: boolean; frameId?: string } } }): void => {
    if (event.context.auxData?.isDefault && event.context.auxData.frameId) contexts.push({ id: event.context.id, frameId: event.context.auxData.frameId });
  };
  session.on("Runtime.executionContextCreated", created);
  try {
    await session.send("Runtime.enable");
    const found: string[] = [];
    for (const context of contexts) {
      const answer = await session.send("Runtime.evaluate", { expression: "window.__loepFrame", contextId: context.id, returnByValue: true }).catch(() => null);
      if (answer?.result.value === mark) found.push(context.frameId);
    }
    if (found.length !== 1) throw new Error("het ingesloten venster is niet eenduidig te bereiken");
    return { session, frameId: found[0]!, context: null, token };
  } finally {
    session.off("Runtime.executionContextCreated", created);
    await session.send("Runtime.disable").catch(() => undefined);
    await frame.evaluate(() => void delete (window as unknown as { __loepFrame?: string }).__loepFrame).catch(() => undefined);
  }
}

function placeOf(frame: Frame): Promise<Place> {
  let place = places.get(frame);
  if (!place) {
    place = locate(frame);
    places.set(frame, place);
    place.catch(() => places.delete(frame));
  }
  return place;
}

/** The context of the world in the current document of the frame, made when there is none yet. */
async function contextOf(place: Place): Promise<number> {
  if (place.context === null) place.context = (await place.session.send("Page.createIsolatedWorld", { frameId: place.frameId, worldName: WORLD_NAME })).executionContextId;
  return place.context;
}

/** Put the libraries in the world of the current document; a second time leaves the first in place. */
async function install(place: Place): Promise<void> {
  place.context = null;
  const contextId = await contextOf(place);
  const source = `globalThis.__loepOwnWorld = true;\n${LIBRARY}\n;globalThis.__loepWire = { encode: ${encode.toString()}, decode: ${decode.toString()} };\nglobalThis.__loepWorld = ${JSON.stringify(place.token)};`;
  const { exceptionDetails } = await place.session.send("Runtime.evaluate", { expression: source, contextId });
  if (exceptionDetails) throw new Error(`loep kon zijn eigen omgeving in de pagina niet inrichten: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
}

/** The context of an earlier document is gone; one that goes away during the call is an error, as it is for page.evaluate. */
const gone = (error: unknown): boolean => /Cannot find context with specified id/.test((error as Error)?.message ?? "");

export interface World {
  /** As `page.evaluate`, in loep's own world: a function with one argument, or the source of an expression. */
  evaluate<R = unknown, A = unknown>(script: string | ((argument: A) => R | Promise<R>), argument?: A): Promise<R>;
}

/** Whether the browser of a frame has the protocol for worlds of its own: Chromium. */
export const hasOwnWorld = (target: Page | Frame): boolean => {
  const name = ("mainFrame" in target ? target.mainFrame() : target).page().context().browser()?.browserType().name();
  return name !== "webkit" && name !== "firefox";
};

/**
 * loep's own world in the frame a page or frame stands for; for an embedded frame measured as a page, in that frame.
 * A browser without that protocol (WebKit, Firefox: the second browsers of a few probes) runs the script in the page, as before.
 */
export function ownWorld(target: Page | Frame): World {
  const frame = "mainFrame" in target ? target.mainFrame() : target;
  if (!hasOwnWorld(frame)) return { evaluate: <R, A>(script: string | ((argument: A) => R | Promise<R>), argument?: A) => frame.evaluate(script as never, argument) as Promise<R> };
  return {
    async evaluate<R, A>(script: string | ((argument: A) => R | Promise<R>), argument?: A): Promise<R> {
      const body = typeof script === "function" ? `(${script.toString()})(__loepWire.decode(argument))` : `(\n${script}\n)`;
      for (let attempt = 0; ; attempt++) {
        const place = await placeOf(frame);
        const functionDeclaration = `async function (argument) { if (globalThis.__loepWorld !== ${JSON.stringify(place.token)}) return ${JSON.stringify(MISSING)}; return __loepWire.encode(await ${body}); }`;
        let answer;
        try {
          answer = await place.session.send("Runtime.callFunctionOn", { functionDeclaration, executionContextId: await contextOf(place), arguments: [{ value: encode(argument) }], returnByValue: true, awaitPromise: true });
        } catch (error) {
          if (attempt >= 2) throw error;
          if (gone(error)) place.context = null;
          // The frame moved to another process, and so to another session.
          else if (/No frame for given id found/.test((error as Error)?.message ?? "")) places.delete(frame);
          else throw error;
          continue;
        }
        if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
        if (answer.result.value !== MISSING) return decode(answer.result.value) as R;
        if (attempt >= 2) throw new Error("loep kon zijn eigen omgeving in de pagina niet inrichten");
        await install(place);
      }
    },
  };
}
