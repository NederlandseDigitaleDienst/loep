import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lib/canonical.ts";
import { siteOrigins, type OriginSource } from "../lib/origins.ts";
import { trialFetch } from "../lib/writes.ts";

/** An origin the session process stopped asking anything, because the site said so or kept failing. */
export interface BlockadeEntry {
  origin: string;
  /**
   * `429`: the site answered "too many requests". `failures`: navigations to it failed again and again while other origins loaded.
   * `outage`: navigations to it failed again and again and nothing else of the site loaded meanwhile: the site, or the connection of this machine, is down.
   */
  reason: "429" | "failures" | "outage";
  at: string;
  /** Until when requests are refused: a 429 with a short Retry-After, or a pause after failures or an outage. Null for the rest of the run (a 429 without a short Retry-After). */
  until: string | null;
  /** The address that gave the answer or failed last. */
  url: string;
  /** An outage only: when the site answered again. Until then an outage refuses after its pause too, while one request asks whether the site is back. */
  back?: string;
}

/** In the run, so that a new session process keeps refusing, and evaluate and the report can say it. */
export const BLOCKADES_FILE = "blockades.json";
/** Navigations to one origin that may fail in a row before it is left alone: for a pause when another origin of the site loads meanwhile, and as an outage when nothing else does. */
export const MAX_FAILED_NAVIGATIONS = 3;
/** A Retry-After up to this many seconds is waited out; a longer one, or none, ends the asking for the rest of the run. */
export const SHORT_RETRY_AFTER_SECONDS = 60;
/**
 * After failed navigations the origin is paused, not given up: a site that is slow for a while under
 * the load of the sessions answers again later. The pause doubles each time the same origin fails again, up to the longest.
 */
export const FAILURE_PAUSE_SECONDS = 300;
export const LONGEST_FAILURE_PAUSE_SECONDS = 2400;
/** How long the one request after the pause of an outage waits for an answer. */
export const PROBE_SECONDS = 30;

/** Whether the site answers at this address: any answer counts, also a 404 or a 503; only no connection or no answer in time does not. */
export type Probe = (url: string) => Promise<boolean>;

const probeSite: Probe = async (url) => {
  try {
    const response = await trialFetch(url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_SECONDS * 1000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
};

/** When an entry stops refusing, in milliseconds; null when it refuses for the rest of the run. A failures entry of an older run without an end ends one pause after it was noted. */
export function endOf(entry: BlockadeEntry): number | null {
  if (entry.until !== null) return Date.parse(entry.until);
  return entry.reason === "failures" ? Date.parse(entry.at) + FAILURE_PAUSE_SECONDS * 1000 : null;
}

/** That an entry refuses for the rest of the run. */
export const isLasting = (entry: BlockadeEntry): boolean => endOf(entry) === null;

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

const whyNl = (entry: BlockadeEntry): string =>
  entry.reason === "429"
    ? `${entry.origin} antwoordde om ${timeOfDay(entry.at)} met 429 (te veel verzoeken)`
    : entry.reason === "outage"
      ? `storing van de site: ${entry.origin} antwoordt niet, ${MAX_FAILED_NAVIGATIONS} navigaties op rij kregen geen antwoord of geen verbinding (de laatste om ${timeOfDay(entry.at)}) en in die tijd laadde niets anders van de site`
      : `${MAX_FAILED_NAVIGATIONS} navigaties naar ${entry.origin} op rij mislukten (de laatste om ${timeOfDay(entry.at)}) terwijl andere adressen wel laadden`;

/** What an agent does during an outage: it is no point "niet bereikbaar", and the task comes back. */
export const OUTAGE_STOP_NL = 'Dit is geen "niet bereikbaar" en geen bevinding: meet niet verder, schrijf geen oordeel, stop je sessie en antwoord alleen met "storing van de site". De opdracht komt terug als de site weer antwoordt';

/** Why a request to a blocked origin is refused, and what the agent writes about what it could not measure. */
export function refusalNl(entry: BlockadeEntry): string {
  const why = whyNl(entry);
  const end = endOf(entry);
  if (entry.reason === "outage" && end !== null && end <= Date.now()) return `${why}. De pauze is om: het sessieproces kijkt nu met één verzoek of de site terug is. Wacht een halve minuut en doe dit dan opnieuw`;
  if (entry.reason === "outage") return `${why}. Het sessieproces vraagt de site niets tot ${new Date(end!).toTimeString().slice(0, 8)} en kijkt dan met één verzoek of ze terug is. ${OUTAGE_STOP_NL}`;
  if (end !== null && entry.reason === "failures") return `${why}; het sessieproces vraagt daar niets tot ${new Date(end).toTimeString().slice(0, 8)} en probeert het daarna opnieuw. Meet intussen wat zonder die site kan, en doe dit daarna opnieuw`;
  if (end !== null) return `${why}; het sessieproces vraagt daar niets tot ${new Date(end).toTimeString().slice(0, 8)}, zoals de site vroeg. Doe het daarna opnieuw`;
  return `${why}; het sessieproces vraagt daar de rest van de run niets meer (${BLOCKADES_FILE} in de run). Schrijf wat daardoor niet te meten is als open punt: "niet bereikbaar: <adres>, ${entry.origin} weigerde vanaf ${timeOfDay(entry.at)}"`;
}

/** A page or document that was not asked for, because the site refused the evaluation for the rest of the run or for a pause. */
export class OriginBlocked extends Error {
  constructor(url: string, entry: BlockadeEntry) {
    super(isLasting(entry) ? `${url} is niet opgevraagd: ${whyNl(entry)}; loep vraagt daar de rest van de run niets meer (${BLOCKADES_FILE} in de run)` : `${url} is niet opgevraagd: ${refusalNl(entry)}`);
    this.name = "OriginBlocked";
  }
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

/** That an origin refused the evaluation for the rest of the run, and from when: for the evidence gate and the limitations of the evaluation. */
export const refusedRunNl = (entry: BlockadeEntry): string =>
  `${entry.origin} heeft verzoeken van het onderzoek geweigerd: ${entry.reason === "429" ? "de site antwoordde met 429 (te veel verzoeken)" : `${MAX_FAILED_NAVIGATIONS} navigaties op rij mislukten terwijl andere adressen wel laadden`}, op ${entry.at.slice(0, 10)} om ${timeOfDay(entry.at)}. Daarna is daar niets meer gevraagd; wat daarna nog gemeten moest worden, is niet gemeten.`;

/** One line per origin for the limitations of the evaluation: that the site stopped answering, and from when. */
export function blockadesNl(runDir: string): string[] {
  const lasting = new Map<string, BlockadeEntry>();
  const paused = new Map<string, number>();
  const failing = new Map<string, number>();
  const down = new Map<string, BlockadeEntry[]>();
  for (const entry of readBlockades(runDir)) {
    if (isLasting(entry)) lasting.set(entry.origin, lasting.get(entry.origin) ?? entry);
    else if (entry.reason === "failures") failing.set(entry.origin, (failing.get(entry.origin) ?? 0) + 1);
    else if (entry.reason === "outage") down.set(entry.origin, [...(down.get(entry.origin) ?? []), entry]);
    else paused.set(entry.origin, (paused.get(entry.origin) ?? 0) + 1);
  }
  const times = (count: number): string => (count === 1 ? "één keer" : `${count} keer`);
  return [
    ...[...lasting.values()].map(refusedRunNl),
    ...[...paused.entries()].filter(([origin]) => !lasting.has(origin)).map(([origin, count]) => `${origin} vroeg ${times(count)} om even te wachten (429 met Retry-After); het onderzoek heeft dat aangehouden.`),
    ...[...failing.entries()].filter(([origin]) => !lasting.has(origin)).map(([origin, count]) => `${origin} antwoordde ${times(count)} niet op ${MAX_FAILED_NAVIGATIONS} navigaties op rij; het onderzoek vroeg daar dan een tijd niets en ging daarna verder. Wat in die tijd niet kon worden gemeten, staat bij het criterium als niet bereikbaar.`),
    ...[...down.entries()].filter(([origin]) => !lasting.has(origin)).map(([origin, entries]) => {
      const back = entries.filter((entry) => entry.back).at(-1)?.back;
      return `${origin} had een storing: de site antwoordde niet vanaf ${entries[0]!.at.slice(0, 10)} om ${timeOfDay(entries[0]!.at)}, en het onderzoek wachtte ${times(entries.length)} een pauze af${back ? `; de site antwoordde weer om ${timeOfDay(back)}` : ""}. In die tijd is daar niets gevraagd.`;
    }),
  ];
}

/**
 * What `pending` says while the site has an outage, after one request for an outage whose pause is
 * over: no agent starts until the site answers. Null when it answers, as far as the run knows.
 */
export async function siteOutageNl(runDir: string, probe?: Probe): Promise<string | null> {
  if (!existsSync(join(runDir, BLOCKADES_FILE))) return null;
  const blockade = new Blockade(runDir, Date.now, probe);
  const down = await blockade.outages();
  if (down.length === 0) return null;
  const since = down.map((entry) => blockade.outageSince(entry.origin)!).sort()[0]!;
  const until = down.map((entry) => entry.until!).sort().at(-1)!;
  return `storing van de site: ${down.map((entry) => entry.origin).join(", ")} antwoordt sinds ${since.slice(0, 10)} ${timeOfDay(since)} niet (geen antwoord of geen verbinding). loep vraagt de site niets tot ${new Date(until).toTimeString().slice(0, 8)} en kijkt dan met één verzoek of ze terug is. Start geen agents en draai pending na die tijd opnieuw`;
}

/**
 * The origins of the site that the session process stops asking anything: after a 429 (for the
 * rest of the run, or until a short Retry-After has passed), for a pause after navigations to
 * one origin failed again and again while another origin loaded, and during an outage: navigations
 * failed again and again and nothing else loaded. An outage pauses longer each time, and after each
 * pause one request asks whether the site is back; until it answers, everything stays refused.
 * Shared by every session of the process, and kept in the run, so a new process goes on refusing.
 */
export class Blockade {
  private readonly runDir: string;
  private readonly now: () => number;
  private readonly probe: Probe;
  private readonly entries: BlockadeEntry[] = [];
  private readonly failures = new Map<string, { count: number; since: number }>();
  /** When each origin last loaded a navigation. */
  private readonly loadedOrigins = new Map<string, number>();
  /** The one request per origin that asks whether the site is back after the pause of an outage. */
  private readonly probing = new Map<string, Promise<void>>();
  /** When the file in the run last changed, as this process read it. */
  private seen = -1;

  constructor(runDir: string, now: () => number = Date.now, probe: Probe = probeSite) {
    this.runDir = runDir;
    this.now = now;
    this.probe = probe;
    this.sync();
  }

  /** Take in what another process noted: the sweep and the session process can run at the same time, and share the file. */
  private sync(): void {
    const changed = statSync(join(this.runDir, BLOCKADES_FILE), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (changed === this.seen) return;
    this.seen = changed;
    for (const entry of readBlockades(this.runDir)) {
      const own = this.entries.find((known) => known.origin === entry.origin && known.at === entry.at);
      if (!own) this.entries.push(entry);
      else if (entry.back && !own.back) own.back = entry.back;
    }
  }

  /** The outage entries of an origin since it last answered again, oldest first. */
  private outageOf(origin: string): BlockadeEntry[] {
    const outages = this.entries.filter((entry) => entry.origin === origin && entry.reason === "outage").sort((a, b) => a.at.localeCompare(b.at));
    return outages.slice(outages.findLastIndex((entry) => entry.back) + 1);
  }

  /** The entry that refuses a request to this address now, or null. After the pause of an outage this starts the one request that asks whether the site is back. */
  refuses(url: string): BlockadeEntry | null {
    const origin = originOf(url);
    if (!origin) return null;
    this.sync();
    const now = this.now();
    const refusing = this.entries.find((entry) => {
      const end = endOf(entry);
      return entry.origin === origin && !entry.back && (end === null || end > now);
    });
    if (refusing) return refusing;
    const outage = this.outageOf(origin).at(-1);
    if (!outage) return null;
    void this.probeOnce(outage);
    return outage;
  }

  /** Ask once whether the site is back after the pause of this outage: an answer ends the outage, none pauses it again, longer. */
  private probeOnce(outage: BlockadeEntry): Promise<void> {
    const running = this.probing.get(outage.origin);
    if (running) return running;
    const asked = this.probe(outage.url)
      .catch(() => false)
      .then((answered) => {
        this.sync();
        // Another process asked meanwhile and noted what it got.
        if (this.outageOf(outage.origin).at(-1) !== outage) return;
        if (answered) this.answered(outage);
        else this.noteOutage(outage.origin, outage.url);
      })
      // A run that is gone has nothing to note.
      .catch(() => undefined)
      .finally(() => this.probing.delete(outage.origin));
    this.probing.set(outage.origin, asked);
    return asked;
  }

  private answered(outage: BlockadeEntry): void {
    outage.back = new Date(this.now()).toISOString();
    this.write();
  }

  private noteOutage(origin: string, url: string): void {
    const seconds = Math.min(FAILURE_PAUSE_SECONDS * 2 ** this.outageOf(origin).length, LONGEST_FAILURE_PAUSE_SECONDS);
    const now = this.now();
    this.note({ origin, reason: "outage", at: new Date(now).toISOString(), until: new Date(now + seconds * 1000).toISOString(), url: url.slice(0, 300) });
  }

  /** The outages of the site now, after one request for each whose pause is over: what `pending` says, so no agent starts while the site is down. */
  async outages(): Promise<BlockadeEntry[]> {
    this.sync();
    const down: BlockadeEntry[] = [];
    for (const origin of new Set(this.entries.filter((entry) => entry.reason === "outage").map((entry) => entry.origin))) {
      let outage = this.outageOf(origin).at(-1);
      if (outage && endOf(outage)! <= this.now()) {
        await this.probeOnce(outage);
        outage = this.outageOf(origin).at(-1);
      }
      if (outage) down.push(outage);
    }
    return down;
  }

  /** When the outage of this origin began: the first of its pauses since it last answered. */
  outageSince(origin: string): string | null {
    return this.outageOf(origin)[0]?.at ?? null;
  }

  /**
   * Wait out a pause of at most `longestSeconds`: by default a short one the site asked for; the sweep, which has no
   * agent waiting on it, also waits out a pause after failures. The entry that refuses this address for longer, or null when it may be asked.
   */
  async pause(url: string, longestSeconds = SHORT_RETRY_AFTER_SECONDS): Promise<BlockadeEntry | null> {
    for (let entry = this.refuses(url); entry; entry = this.refuses(url)) {
      const end = endOf(entry);
      if (end === null || end - this.now() > longestSeconds * 1000) return entry;
      await (this.probing.get(entry.origin) ?? new Promise((resolve) => setTimeout(resolve, Math.max(0, end - this.now()))));
    }
    return null;
  }

  /** Entries noted since this time: what a command tells its agent. */
  since(time: number): BlockadeEntry[] {
    return this.entries.filter((entry) => Date.parse(entry.at) >= time);
  }

  /** The site answered 429. */
  tooMany(url: string, retryAfter: string | undefined): void {
    const origin = originOf(url);
    if (!origin || this.refuses(url)) return;
    const now = this.now();
    const seconds = retryAfterSeconds(retryAfter, now);
    const until = seconds !== null && seconds <= SHORT_RETRY_AFTER_SECONDS ? new Date(now + seconds * 1000).toISOString() : null;
    this.note({ origin, reason: "429", at: new Date(now).toISOString(), until, url: url.slice(0, 300) });
  }

  /** A navigation to this address loaded. */
  loaded(url: string): void {
    const origin = originOf(url);
    if (!origin) return;
    this.loadedOrigins.set(origin, this.now());
    this.failures.delete(origin);
    this.sync();
    const outage = this.outageOf(origin).at(-1);
    if (outage) this.answered(outage);
  }

  /** A navigation to this address did not load: the connection failed or no answer came. */
  failed(url: string): void {
    const origin = originOf(url);
    if (!origin || this.refuses(url)) return;
    const streak = this.failures.get(origin) ?? { count: 0, since: this.now() };
    streak.count++;
    this.failures.set(origin, streak);
    if (streak.count < MAX_FAILED_NAVIGATIONS) return;
    this.failures.delete(origin);
    // Something else of the site loaded meanwhile: this origin fails, not the site. Nothing else did: the site, or the network of this machine, is down.
    if (![...this.loadedOrigins].some(([other, at]) => other !== origin && at >= streak.since)) return this.noteOutage(origin, url);
    const before = this.entries.filter((entry) => entry.origin === origin && entry.reason === "failures").length;
    const seconds = Math.min(FAILURE_PAUSE_SECONDS * 2 ** before, LONGEST_FAILURE_PAUSE_SECONDS);
    const now = this.now();
    this.note({ origin, reason: "failures", at: new Date(now).toISOString(), until: new Date(now + seconds * 1000).toISOString(), url: url.slice(0, 300) });
  }

  private note(entry: BlockadeEntry): void {
    this.sync();
    this.entries.push(entry);
    this.write();
  }

  private write(): void {
    writeFileSync(join(this.runDir, BLOCKADES_FILE), canonicalJson({ origins: this.entries }));
  }
}

let current: { blockade: Blockade; ofSite: (url: string) => boolean } | null = null;

/**
 * Give the commands of the sweep in this process the blockade of the run: they ask a blocked
 * origin nothing, and a 429 of an origin of the site ends the asking for the sessions as well.
 * The site is what a session counts as its scope: every origin of the run and every host the
 * inventory found a page on. Set once, by the command line; null takes it away.
 */
export function setRunBlockade(runDir: string | null): void {
  if (runDir === null) return void (current = null);
  const path = join(runDir, "inventory.json");
  const inventory = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as OriginSource & { pages?: { url: string }[] }) : null;
  const hosts = new Set([...(inventory ? siteOrigins(inventory) : []), ...(inventory?.pages ?? []).map((page) => page.url)].map((url) => new URL(url).hostname));
  current = { blockade: new Blockade(runDir), ofSite: (url) => originOf(url) !== null && hosts.has(new URL(url).hostname) };
}

export const runBlockade = (): typeof current => current;
