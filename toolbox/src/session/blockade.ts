import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lib/canonical.ts";

/** An origin the session process stopped asking anything, because the site said so or kept failing. */
export interface BlockadeEntry {
  origin: string;
  /** `429`: the site answered "too many requests". `failures`: navigations to it failed again and again while other origins loaded. */
  reason: "429" | "failures";
  at: string;
  /** Until when requests are refused, for a 429 with a short Retry-After; null for the rest of the run. */
  until: string | null;
  /** The address that gave the answer or failed last. */
  url: string;
}

/** In the run, so that a new session process keeps refusing, and evaluate and the report can say it. */
export const BLOCKADES_FILE = "blockades.json";
/** Navigations to one origin that may fail in a row, while another origin loads, before the origin is left alone. */
export const MAX_FAILED_NAVIGATIONS = 3;
/** A Retry-After up to this many seconds is waited out; a longer one, or none, ends the asking for the rest of the run. */
export const SHORT_RETRY_AFTER_SECONDS = 60;

/** The origin of an address, with a socket counted as its http(s) twin; null for an address without one. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Seconds a Retry-After asks for: a number of seconds or a date. Null when there is none or it cannot be read. */
export function retryAfterSeconds(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

const timeOfDay = (iso: string): string => new Date(iso).toTimeString().slice(0, 5);

/** Why a request to a blocked origin is refused, and what the agent writes about what it could not measure. */
export function refusalNl(entry: BlockadeEntry): string {
  const why = entry.reason === "429" ? `${entry.origin} antwoordde om ${timeOfDay(entry.at)} met 429 (te veel verzoeken)` : `${MAX_FAILED_NAVIGATIONS} navigaties naar ${entry.origin} op rij mislukten (de laatste om ${timeOfDay(entry.at)}) terwijl andere adressen wel laadden`;
  if (entry.until) return `${why}; het sessieproces vraagt daar niets tot ${new Date(entry.until).toTimeString().slice(0, 8)}, zoals de site vroeg. Doe het daarna opnieuw`;
  return `${why}; het sessieproces vraagt daar de rest van de run niets meer (${BLOCKADES_FILE} in de run). Schrijf wat daardoor niet te meten is als open punt: "niet bereikbaar: <adres>, ${entry.origin} weigerde vanaf ${timeOfDay(entry.at)}"`;
}

/** What the session process noted about blocked origins, read from the run. Empty when nothing was blocked. */
export function readBlockades(runDir: string): BlockadeEntry[] {
  const path = join(runDir, BLOCKADES_FILE);
  if (!existsSync(path)) return [];
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { origins?: BlockadeEntry[] }).origins ?? [];
  } catch {
    return [];
  }
}

/** One line per origin for the limitations of the evaluation: that the site stopped answering, and from when. */
export function blockadesNl(runDir: string): string[] {
  const lasting = new Map<string, BlockadeEntry>();
  const paused = new Map<string, number>();
  for (const entry of readBlockades(runDir)) {
    if (entry.until === null) lasting.set(entry.origin, lasting.get(entry.origin) ?? entry);
    else paused.set(entry.origin, (paused.get(entry.origin) ?? 0) + 1);
  }
  return [
    ...[...lasting.values()].map(
      (entry) =>
        `${entry.origin} heeft verzoeken van het onderzoek geweigerd: ${entry.reason === "429" ? "de site antwoordde met 429 (te veel verzoeken)" : `${MAX_FAILED_NAVIGATIONS} navigaties op rij mislukten terwijl andere adressen wel laadden`}, op ${entry.at.slice(0, 10)} om ${timeOfDay(entry.at)}. Daarna is daar in de sessies niets meer gevraagd; wat daarna nog gemeten moest worden, is niet gemeten.`,
    ),
    ...[...paused.entries()].filter(([origin]) => !lasting.has(origin)).map(([origin, times]) => `${origin} vroeg ${times === 1 ? "één keer" : `${times} keer`} om even te wachten (429 met Retry-After); de sessies hebben dat aangehouden.`),
  ];
}

/**
 * The origins of the site that the session process stops asking anything: after a 429 (for the
 * rest of the run, or until a short Retry-After has passed), and after navigations to one origin
 * failed again and again while another origin loaded. Shared by every session of the process, and
 * kept in the run, so a new process goes on refusing.
 */
export class Blockade {
  private readonly runDir: string;
  private readonly now: () => number;
  private readonly entries: BlockadeEntry[];
  private readonly failures = new Map<string, number>();
  private readonly loadedOrigins = new Set<string>();

  constructor(runDir: string, now: () => number = Date.now) {
    this.runDir = runDir;
    this.now = now;
    this.entries = readBlockades(runDir);
  }

  /** The entry that refuses a request to this address now, or null. */
  refuses(url: string): BlockadeEntry | null {
    const origin = originOf(url);
    if (!origin) return null;
    return this.entries.find((entry) => entry.origin === origin && (entry.until === null || Date.parse(entry.until) > this.now())) ?? null;
  }

  /** Entries noted since this time: what a command tells its agent. */
  since(time: number): BlockadeEntry[] {
    return this.entries.filter((entry) => Date.parse(entry.at) >= time);
  }

  /** The site answered 429. */
  tooMany(url: string, retryAfter: string | undefined): void {
    const origin = originOf(url);
    if (!origin || this.refuses(url)) return;
    const seconds = retryAfterSeconds(retryAfter, this.now());
    const until = seconds !== null && seconds <= SHORT_RETRY_AFTER_SECONDS ? new Date(this.now() + seconds * 1000).toISOString() : null;
    this.note({ origin, reason: "429", at: new Date(this.now()).toISOString(), until, url: url.slice(0, 300) });
  }

  /** A navigation to this address loaded. */
  loaded(url: string): void {
    const origin = originOf(url);
    if (!origin) return;
    this.loadedOrigins.add(origin);
    this.failures.delete(origin);
  }

  /** A navigation to this address did not load: the connection failed or no answer came. */
  failed(url: string): void {
    const origin = originOf(url);
    if (!origin || this.refuses(url)) return;
    const count = (this.failures.get(origin) ?? 0) + 1;
    this.failures.set(origin, count);
    // Only when something else loads is it the site, and not the network of this machine.
    if (count < MAX_FAILED_NAVIGATIONS || ![...this.loadedOrigins].some((other) => other !== origin)) return;
    this.failures.delete(origin);
    this.note({ origin, reason: "failures", at: new Date(this.now()).toISOString(), until: null, url: url.slice(0, 300) });
  }

  private note(entry: BlockadeEntry): void {
    this.entries.push(entry);
    writeFileSync(join(this.runDir, BLOCKADES_FILE), canonicalJson({ origins: this.entries }));
  }
}
