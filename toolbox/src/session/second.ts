import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox, webkit, type Browser } from "playwright";
import { TOOLBOX_ROOT, type BrowserVersions } from "../instruments/methods/registry.ts";
import { Images, type StateRecord, type Step } from "./observations.ts";
import type { Blocked } from "./safety.ts";
import { openSurface, type Env, type Refused, type Surface } from "./surface.ts";

export type SecondBrowser = "webkit" | "firefox";
const TYPES = { webkit, firefox };

/** The version of a browser this installation of Playwright expects, for as long as the browser has not started. */
function expectedVersion(name: SecondBrowser): string | null {
  try {
    const list = (JSON.parse(readFileSync(join(TOOLBOX_ROOT, "node_modules", "playwright-core", "browsers.json"), "utf8")) as { browsers: { name: string; browserVersion?: string }[] }).browsers;
    return list.find((browser) => browser.name === name)?.browserVersion ?? null;
  } catch {
    return null;
  }
}

/** The number of Playwright's build of a browser on this machine, read from the directory the browser is started from. */
function buildOf(name: SecondBrowser): string | null {
  try {
    return new RegExp(`[\\\\/]${name}-(\\d+)[\\\\/]`).exec(TYPES[name].executablePath())?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The version a measurement in a second browser is recorded with: what the browser says of
 * itself and the number of Playwright's build. WebKit calls itself after the Safari it follows
 * ("26.0"); only the build number says which WebKit that was.
 */
export const secondBrowserVersion = (version: string, build: string | null): string => (build ? `${version} build ${build}` : version);

type RunSteps = (env: Env, surface: Surface, steps: Step[], images: Images) => Promise<{ index: number; command: string; reason: string } | null>;

interface Warm {
  surface: Surface;
  stateId: string;
  /** Set when a method changed the page, such as a walk with Tab: the page no longer shows the state. */
  dirty: boolean;
}

/**
 * The second browsers of a session process: one WebKit and one Firefox, each started the
 * first time a method asks for it, and for each session at most one page per browser that
 * stays open in the state it was brought to. A page is opened through the same `openSurface`
 * as the page of the session itself, so the same guard decides about every request: only GET,
 * nothing over a socket, nothing outside the scope, and the same pause between navigations.
 */
export class SecondBrowsers {
  private readonly env: Env;
  private readonly runSteps: RunSteps;
  private readonly browsers: Partial<Record<SecondBrowser, Promise<Browser>>> = {};
  private readonly warm = new Map<string, Warm>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /**
   * Versions of the browsers; a method's answer carries the version of the browser it ran in.
   * For a second browser this is what Playwright's installation expects until the browser has
   * started, and what the running browser says from then on.
   */
  readonly versions: BrowserVersions;
  /** What the guard refused in a second browser, per session, until the session reports it. */
  private readonly refused = new Map<string, Blocked[]>();

  constructor(env: Env, runSteps: RunSteps) {
    this.env = env;
    this.runSteps = runSteps;
    this.versions = { chromium: env.browser.version() };
    for (const name of ["webkit", "firefox"] as const) {
      const expected = expectedVersion(name);
      if (expected) this.versions[name] = secondBrowserVersion(expected, buildOf(name));
    }
  }

  /** Whether the build of a browser is on this machine. */
  static installed(name: "chromium" | SecondBrowser): boolean {
    if (name === "chromium") return true;
    try {
      return existsSync(TYPES[name].executablePath());
    } catch {
      return false;
    }
  }

  private launch(name: SecondBrowser): Promise<Browser> {
    this.browsers[name] ??= TYPES[name].launch().then((browser) => {
      this.versions[name] = secondBrowserVersion(browser.version(), buildOf(name));
      return browser;
    });
    // A launch that failed must not be remembered: the next call tries again.
    this.browsers[name]!.catch(() => delete this.browsers[name]);
    return this.browsers[name]!;
  }

  /**
   * Start a second browser when it is not running yet, so that `versions` holds what the
   * browser itself says before a measurement in it is recorded. Never throws: a browser that
   * does not start is reported by the measurement that needed it.
   */
  async started(name: SecondBrowser): Promise<void> {
    if (!SecondBrowsers.installed(name)) return;
    await this.launch(name).catch(() => undefined);
  }

  private note(session: string, blocked: Blocked[]): void {
    if (blocked.length === 0) return;
    this.refused.set(session, [...(this.refused.get(session) ?? []), ...blocked]);
  }

  /** What was refused in the second browsers of a session since this was last asked. */
  takeRefused(session: string): Blocked[] {
    for (const [key, entry] of this.warm) if (key.startsWith(`${session}:`)) this.note(session, entry.surface.guard.blocked.splice(0));
    const taken = this.refused.get(session) ?? [];
    this.refused.delete(session);
    return taken;
  }

  /**
   * Do something on a page of the other browser that is in the given state. The page that is
   * still open is used again when it shows that state; otherwise a fresh one is opened and
   * the steps of the state are played again. Work for the same session and browser runs in turn.
   */
  use<T>(session: string, name: SecondBrowser, state: StateRecord, work: (surface: Surface) => Promise<T>, changes = false): Promise<T> {
    const key = `${session}:${name}`;
    const turn = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      const surface = await this.surfaceFor(key, session, name, state);
      try {
        return await work(surface);
      } finally {
        const entry = this.warm.get(key);
        if (entry && changes) entry.dirty = true;
      }
    });
    this.queues.set(key, turn.catch(() => undefined));
    return turn;
  }

  private async surfaceFor(key: string, session: string, name: SecondBrowser, state: StateRecord): Promise<Surface> {
    const known = this.warm.get(key);
    if (known && known.stateId === state.id && !known.dirty && !known.surface.page.isClosed()) return known.surface;
    if (known) await this.discard(key, session);
    if (!state.start) throw new Error("er is nog geen pagina geopend");
    if (!SecondBrowsers.installed(name)) throw new Error(`niet beschikbaar: installeer de browser: npx playwright install ${name}`);
    const browser = await this.launch(name);
    const env: Env = { ...this.env, browser };
    const { surface } = await openSurface(env, state.start, undefined, session).catch((error: Error) => {
      this.note(session, (error as Refused).blocked ?? []);
      throw error;
    });
    this.warm.set(key, { surface, stateId: state.id, dirty: false });
    if (state.steps.length > 0) {
      const scratch = await mkdtemp(join(tmpdir(), "loep-second-"));
      try {
        const failed = await this.runSteps(env, surface, state.steps, new Images(scratch, "step"));
        if (failed) {
          await this.discard(key, session);
          throw new Error(`de toestand is in ${name} niet te bereiken: stap ${failed.index + 1} (${failed.command}) ${failed.reason}`);
        }
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
    return surface;
  }

  private async discard(key: string, session: string): Promise<void> {
    const entry = this.warm.get(key);
    if (!entry) return;
    this.note(session, entry.surface.guard.blocked.splice(0));
    this.warm.delete(key);
    await entry.surface.context.close().catch(() => undefined);
  }

  /** Close the pages a session has open in the second browsers. */
  async closeSession(session: string): Promise<void> {
    for (const key of [...this.warm.keys()]) if (key.startsWith(`${session}:`)) await this.discard(key, session);
    this.refused.delete(session);
  }

  async close(): Promise<void> {
    for (const entry of this.warm.values()) await entry.surface.context.close().catch(() => undefined);
    this.warm.clear();
    for (const launching of Object.values(this.browsers)) await launching.then((browser) => browser.close(), () => undefined).catch(() => undefined);
  }
}
