import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { call } from "../browser/call.ts";
import { INPAGE_PATH, launchBrowser, newContext } from "../browser/session.ts";
import { IDLE_SESSION_FILE, landingFellBack, LOGIN_SESSION_FILE, loggedOutReasonNl, markOf, passwordFieldShows, readLoginFile, siteOriginOfRun, type LoginMark, type LoginSession } from "../lib/login.ts";

/**
 * The watch on the session (WCAG 2.2.1). A run behind a login keeps its own session busy: the
 * sweep, the session process and every agent use the same session, so a session that is extended
 * by every use never goes quiet. The watch therefore has a session of its own: a person logs in a
 * second time with `login --idle`, with the same test account if they like. The watch is a process
 * of its own, started in the background at the start of the sweep, with its state in
 * `session-watch.json` in the run. It opens the page the person pointed at in a tab it then leaves
 * alone, looks at that tab now and then without asking the site anything, and checks at growing
 * intervals, each time from a fresh browser context with the cookies of the second login, whether
 * the session still lives. It stops at `evaluate`, or after `maxHours`.
 *
 * A check is a request with the session, and many sites extend a session at every request. What
 * the watch can say is therefore: the session did not run out within a quiet spell of so many
 * minutes, the longest gap between two checks. The gaps grow (5, 10, 20, 40, 80 minutes, then 80
 * again) so that a session that ends after a fixed time of quiet is seen as well.
 */

export const SESSION_WATCH_FILE = "session-watch.json";
export const SESSION_WATCH_STOP = "session-watch.stop";
export const SESSION_WATCH_DIR = "session-watch";
const LOG_FILE = "session-watch.log";

export const DEFAULT_GAPS_MINUTES = [5, 10, 20, 40, 80];
export const DEFAULT_MAX_HOURS = 8;
/** How often the tab that is left alone is looked at: in the page only, nothing goes to the site. */
const DEFAULT_LOOK_SECONDS = 30;
/** Words a warning that the session runs out uses, Dutch and English. */
const WARNING_WORDS = /sessie|verloop|verloopt|verlopen|verleng|ingelogd blijven|uitgelogd|automatisch afgemeld|session|expire|extend|stay signed in|logged out/i;

export interface SessionCheck {
  at: string;
  /** Minutes since the previous check (or since the watch started): how long the session was left alone. */
  quietMinutes: number;
  alive: boolean;
  reasonNl: string | null;
  /** Whether the session the measurement uses still held at this moment; null when the run has none or it was not checked. */
  mainSessionAlive: boolean | null;
  /** The tab that is left alone, as it looked at this check. */
  screenshot: string | null;
}

export interface SessionWatch {
  status: "running" | "expired" | "stopped" | "notRunning" | "failed";
  reasonNl: string | null;
  pid: number | null;
  startedAt: string | null;
  /** When the second session was made; minutes after it say how long the session lasted. */
  idleLoggedInAt: string | null;
  gapsMinutes: number[];
  maxHours: number;
  checks: SessionCheck[];
  /** The longest quiet spell after which the session still lived. */
  longestQuietAliveMinutes: number | null;
  /** When it ran out: between how many minutes of quiet (the last check that held and this one), and how long after the second login. */
  expired: { at: string; quietMinutes: number; minutesAfterLogin: number | null; reasonNl: string } | null;
  /** What the tab that was left alone showed that looks like a warning: a window, or text with words about a session running out. */
  warning: { at: string; minutesAfterStart: number; textNl: string; screenshot: string | null } | null;
  /** The last look at the tab before the session was found to have run out. */
  beforeExpiry: string | null;
  /** Set when the session of the measurement itself ran out while the watch looked: the cause of a failing step. */
  mainSessionExpiredAt: string | null;
  stoppedAt: string | null;
  updatedAt: string;
}

export interface WatchOptions {
  gapsMinutes?: number[];
  maxHours?: number;
  lookSeconds?: number;
  /** For tests: milliseconds per "minute", so a watch of hours runs in seconds. */
  minuteMs?: number;
}

const watchPath = (runDir: string): string => join(runDir, SESSION_WATCH_FILE);

export function readSessionWatch(runDir: string): SessionWatch | null {
  try {
    return JSON.parse(readFileSync(watchPath(runDir), "utf8")) as SessionWatch;
  } catch {
    return null;
  }
}

function writeWatch(runDir: string, watch: SessionWatch): void {
  const path = watchPath(runDir);
  writeFileSync(`${path}.tmp`, `${JSON.stringify({ ...watch, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

const isAlive = (pid: number | null): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const emptyWatch = (status: SessionWatch["status"], reasonNl: string | null, options: WatchOptions = {}): SessionWatch => ({
  status,
  reasonNl,
  pid: null,
  startedAt: null,
  idleLoggedInAt: null,
  gapsMinutes: options.gapsMinutes ?? DEFAULT_GAPS_MINUTES,
  maxHours: options.maxHours ?? DEFAULT_MAX_HOURS,
  checks: [],
  longestQuietAliveMinutes: null,
  expired: null,
  warning: null,
  beforeExpiry: null,
  mainSessionExpiredAt: null,
  stoppedAt: null,
  updatedAt: new Date().toISOString(),
});

export const NO_IDLE_LOGIN_NL = `er is geen tweede inlog voor de sessieproef (${IDLE_SESSION_FILE}); een mens maakt die met loep login --run <run> --idle, met hetzelfde testaccount mag`;

/**
 * Start the watch in the background for a run with a login, unless it runs already: a second
 * start takes the running one over and starts nothing. Without a second login it writes why it
 * does not run. Returns what the state file says afterwards.
 */
export function startSessionWatch(runDir: string, forwarded: string[] = []): SessionWatch | null {
  if (!existsSync(join(runDir, LOGIN_SESSION_FILE))) return null;
  const known = readSessionWatch(runDir);
  if (known?.status === "running" && isAlive(known.pid)) return known;
  // A watch that has its outcome keeps it: a second sweep on the same run does not start the clock again.
  if (known && (known.status === "expired" || known.status === "stopped")) return known;
  if (!existsSync(join(runDir, IDLE_SESSION_FILE))) {
    const watch = emptyWatch("notRunning", NO_IDLE_LOGIN_NL);
    writeWatch(runDir, watch);
    return watch;
  }
  rmSync(join(runDir, SESSION_WATCH_STOP), { force: true });
  const output = openSync(join(runDir, LOG_FILE), "a");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../cli.ts", import.meta.url)), "watch-session", "--run", runDir, ...forwarded], { detached: true, stdio: ["ignore", output, output] });
  child.unref();
  const watch = { ...emptyWatch("running", null), pid: child.pid ?? null, startedAt: new Date().toISOString() };
  writeWatch(runDir, watch);
  return watch;
}

/** Stop the watch and settle its state: at `evaluate`. What it saw stays; a running watch becomes "stopped". */
export function stopSessionWatch(runDir: string): SessionWatch | null {
  const known = readSessionWatch(runDir);
  if (!known) return null;
  writeFileSync(join(runDir, SESSION_WATCH_STOP), `${new Date().toISOString()}\n`);
  if (known.status !== "running") return known;
  if (isAlive(known.pid) && known.pid !== process.pid) {
    try {
      process.kill(known.pid!, "SIGTERM");
    } catch {
      // Gone in the meantime.
    }
  }
  const stopped: SessionWatch = { ...known, status: "stopped", stoppedAt: new Date().toISOString(), reasonNl: known.checks.length === 0 ? "gestopt voordat de sessie één keer was nagekeken" : "gestopt bij evaluate" };
  writeWatch(runDir, stopped);
  return stopped;
}

/** Whether the session still holds, from a fresh context with the cookies the session file had: why not, or null. */
async function sessionHolds(browser: Browser, state: LoginSession["storageState"], mark: LoginMark): Promise<string | null> {
  const context = await newContext(browser, { storageState: state });
  try {
    return await landingFellBack(await context.newPage(), mark);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** What the tab that is left alone shows now that looks like a warning, or null. */
async function warningIn(page: Page): Promise<string | null> {
  const windows = await call<{ text: string }[]>(page, "visibleDialogs").catch(() => []);
  const shown = windows.map((entry) => entry.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (shown) return shown.slice(0, 300);
  const text = await call<string>(page, "bodyText").catch(() => "");
  const line = text.split("\n").find((entry) => WARNING_WORDS.test(entry) && entry.length < 300);
  return line ? line.trim() : null;
}

/** Run the watch in this process until the session ran out, it is told to stop, or the limit passes. */
export async function watchSession(runDir: string, options: WatchOptions = {}): Promise<SessionWatch> {
  const minuteMs = options.minuteMs ?? 60_000;
  const gaps = options.gapsMinutes ?? DEFAULT_GAPS_MINUTES;
  const maxHours = options.maxHours ?? DEFAULT_MAX_HOURS;
  const lookMs = (options.lookSeconds ?? DEFAULT_LOOK_SECONDS) * (minuteMs / 60);
  const idlePath = join(runDir, IDLE_SESSION_FILE);
  if (!existsSync(idlePath)) {
    const watch = emptyWatch("notRunning", NO_IDLE_LOGIN_NL, options);
    writeWatch(runDir, watch);
    return watch;
  }
  const idle = readLoginFile(idlePath, siteOriginOfRun(runDir));
  const mark = markOf(idle);
  const shots = join(runDir, SESSION_WATCH_DIR);
  mkdirSync(shots, { recursive: true });
  const startedAt = Date.now();
  let watch: SessionWatch = { ...emptyWatch("running", null, options), pid: process.pid, startedAt: new Date(startedAt).toISOString(), idleLoggedInAt: idle.loggedInAt };
  writeWatch(runDir, watch);
  let stopping = false;
  const stop = (): void => void (stopping = true);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const told = (): boolean => stopping || existsSync(join(runDir, SESSION_WATCH_STOP)) || readSessionWatch(runDir)?.status === "stopped";
  const minutes = (ms: number): number => Math.round((ms / minuteMs) * 10) / 10;

  let browser: Browser | null = null;
  let tab: BrowserContext | null = null;
  try {
    browser = await launchBrowser();
    tab = await newContext(browser, { storageState: idle.storageState });
    await tab.addInitScript({ path: INPAGE_PATH });
    const page = await tab.newPage();
    const opened = await landingFellBack(page, mark);
    if (opened) {
      watch = { ...watch, status: "failed", reasonNl: `de tweede sessie was bij de start al niet geldig: ${opened}. Laat een mens opnieuw inloggen met loep login --run <run> --idle` };
      writeWatch(runDir, watch);
      return watch;
    }
    let shot = 0;
    const screenshot = async (name: string): Promise<string | null> => {
      const relative = join(SESSION_WATCH_DIR, name);
      return page.screenshot({ path: join(runDir, relative) }).then(() => relative, () => null);
    };
    let lastLook: string | null = await screenshot(`look-${String(shot++).padStart(3, "0")}.png`);
    let previousCheck = startedAt;
    for (let index = 0; ; index++) {
      const gap = gaps[Math.min(index, gaps.length - 1)]!;
      const due = previousCheck + gap * minuteMs;
      if (due - startedAt > maxHours * 60 * minuteMs) {
        watch = { ...watch, status: "stopped", stoppedAt: new Date().toISOString(), reasonNl: `de grens van ${maxHours} uur is bereikt` };
        break;
      }
      // Until the check: look at the tab now and then, in the page only.
      while (Date.now() < due && !told()) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(lookMs, Math.max(0, due - Date.now()))));
        const warning = watch.warning ? null : await warningIn(page);
        const fellBack = loggedOutReasonNl(mark, { asked: mark.landingUrl, final: page.url(), passwordField: await passwordFieldShows(page) });
        const look = await screenshot(`look-${String(shot++ % 1000).padStart(3, "0")}.png`);
        if (warning && !fellBack) watch = { ...watch, warning: { at: new Date().toISOString(), minutesAfterStart: minutes(Date.now() - startedAt), textNl: warning, screenshot: look } };
        if (!fellBack) lastLook = look ?? lastLook;
        writeWatch(runDir, watch);
      }
      if (told()) {
        watch = { ...watch, status: "stopped", stoppedAt: new Date().toISOString(), reasonNl: "gestopt bij evaluate" };
        break;
      }
      let reason: string | null;
      try {
        reason = await sessionHolds(browser, idle.storageState, mark);
      } catch (error) {
        // The site did not answer: no word on the session. The next check comes after the next gap.
        process.stderr.write(`${new Date().toISOString()} nakijken lukte niet: ${(error as Error).message.split("\n")[0]}\n`);
        continue;
      }
      const quiet = minutes(Date.now() - previousCheck);
      // The session of the measurement, checked with the file as it is now: a person may have logged in again.
      let mainAlive: boolean | null = null;
      if (existsSync(join(runDir, LOGIN_SESSION_FILE))) {
        try {
          const main = readLoginFile(join(runDir, LOGIN_SESSION_FILE), siteOriginOfRun(runDir));
          mainAlive = (await sessionHolds(browser, main.storageState, markOf(main))) === null;
        } catch {
          mainAlive = null;
        }
      }
      const check: SessionCheck = { at: new Date().toISOString(), quietMinutes: quiet, alive: reason === null, reasonNl: reason, mainSessionAlive: mainAlive, screenshot: lastLook };
      watch = {
        ...watch,
        checks: [...watch.checks, check],
        ...(mainAlive === false && !watch.mainSessionExpiredAt ? { mainSessionExpiredAt: check.at } : {}),
        ...(reason === null ? { longestQuietAliveMinutes: Math.max(watch.longestQuietAliveMinutes ?? 0, quiet) } : {}),
      };
      if (mainAlive === false) process.stderr.write(`${check.at} de sessie van de meting is verlopen; een stap die nu mislukt, mislukt daardoor. Laat een mens opnieuw inloggen met loep login --run ${runDir}\n`);
      if (reason !== null) {
        const loggedIn = Date.parse(idle.loggedInAt);
        watch = { ...watch, status: "expired", beforeExpiry: lastLook, expired: { at: check.at, quietMinutes: quiet, minutesAfterLogin: Number.isFinite(loggedIn) ? minutes(Date.now() - loggedIn) : null, reasonNl: reason } };
        break;
      }
      writeWatch(runDir, watch);
      previousCheck = Date.now();
    }
  } catch (error) {
    watch = { ...watch, status: "failed", reasonNl: `de proef liep vast: ${(error as Error).message.split("\n")[0]}` };
  } finally {
    await tab?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
  // Somebody may have settled the state in the meantime (evaluate): what it wrote stands, with what this process saw.
  const settled = readSessionWatch(runDir);
  if (settled?.status === "stopped" && watch.status === "stopped") watch = { ...watch, stoppedAt: settled.stoppedAt, reasonNl: settled.reasonNl };
  writeWatch(runDir, watch);
  return watch;
}
