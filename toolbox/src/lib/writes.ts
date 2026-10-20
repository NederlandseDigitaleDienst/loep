import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import { confirmByTyping, processTerminal, recordedNl, type RecordedVia, type Terminal } from "./recorded.ts";

/**
 * Permission to send requests that can change something (anything but GET and HEAD, and
 * messages over a socket) to one origin. Without it every such request is held back, on every
 * site. It exists only for a test environment: a machine of one's own, or an environment
 * that a named person declared to be one.
 */
export interface WritePermission {
  /** The one origin that may be written to, e.g. "https://test.example.nl". */
  origin: string;
  /** True for an address that cannot be a live site: this machine, or a name ending in .localhost or .test. */
  local: boolean;
  /** Who stated that this is a test environment where submitting has no consequences; null for a local address. */
  declaredBy: { name: string; role: string } | null;
  declaredAt: string;
  /** How the declaration came about: confirmed by a person at a terminal (`confirmDeclaration`), never by an agent. `declaredAt` is the moment of that confirmation. */
  recordedVia?: RecordedVia;
  /** Most writes the whole run may send to the origin, over every session and the sweep together. Absent in a manifest from before the budget: `DEFAULT_MAX_WRITES`. */
  maxWrites?: number;
  /** Shortest time between two writes that pass, in seconds. Absent: `DEFAULT_WRITE_SPACING_SECONDS`. Not a flag: a test sets it in the manifest. */
  spacingSeconds?: number;
}

/**
 * The budget for sending when `inventory` is not told otherwise. Forty agents that each used a
 * chat sent 54 messages in an hour and a half, and the service blocked the address of the machine.
 * The budget is for the run, not per agent: no agent knows what the others sent.
 */
export const DEFAULT_MAX_WRITES = 5;
/** A service that counts messages per minute sees at most one from the run in two minutes. */
export const DEFAULT_WRITE_SPACING_SECONDS = 120;

export interface WriteFlags {
  allowWrites?: boolean | undefined;
  testEnvironment?: string | undefined;
  declaredBy?: string | undefined;
  /** `--max-writes`: the budget for sending of the whole run. */
  maxWrites?: string | undefined;
}

/** What is left out of an evaluation when nothing may be sent; for a report that has no permission to mention. */
export const WRITES_BLOCKED_NL = "verzoeken die iets kunnen wijzigen zijn tegengehouden; wat pas na versturen verschijnt is niet onderzocht";

/**
 * The sentence for the report, the dossier and the limitations. It names the role of whoever
 * declared the test environment, not the name: a report is shared and published, and the name
 * of the person stays in the manifest of the run, where the declaration can be traced.
 */
export const writesAllowedNl = (permission: WritePermission): string =>
  `onderzocht op een testomgeving waar versturen is toegestaan: ${permission.origin}${permission.declaredBy ? `, verklaard door iemand met de functie ${permission.declaredBy.role}${permission.recordedVia ? `, ${recordedNl(permission, permission.declaredAt)}` : ""} (de naam staat in het dossier van het onderzoek, niet in dit rapport)` : " (lokaal adres)"}`;

/** Hosts that cannot be a live site: the machine itself and the names reserved for testing. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".test");
}

function originOf(address: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error(`${flag} verwacht een adres met http:// of https://, niet "${address}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${flag} verwacht een adres met http:// of https://, niet "${address}"`);
  return url.origin;
}

/**
 * Decide from the flags of `inventory` whether this run may write, and where. Null when no
 * flag asks for it. Throws, in Dutch, when the flags ask for it without what is needed: a
 * live site is never written to because a flag was typed.
 */
export function decideWrites(baseUrl: string, flags: WriteFlags, now = new Date()): WritePermission | null {
  if (!flags.allowWrites && flags.testEnvironment === undefined && flags.declaredBy === undefined) {
    if (flags.maxWrites !== undefined) throw new Error("--max-writes hoort bij een run die mag versturen: geef het samen met --allow-writes, of met --test-environment en --declared-by");
    return null;
  }
  const budget = { maxWrites: maxWritesOf(flags.maxWrites), spacingSeconds: DEFAULT_WRITE_SPACING_SECONDS };
  const origin = flags.testEnvironment !== undefined ? originOf(flags.testEnvironment, "--test-environment") : originOf(baseUrl, "het adres van de site");
  const local = isLocalHost(new URL(origin).hostname);
  if (local) {
    if (!flags.allowWrites) throw new Error(`versturen naar ${origin} is alleen toegestaan met --allow-writes erbij`);
    return { origin, local: true, declaredBy: null, declaredAt: now.toISOString(), ...budget };
  }
  if (flags.testEnvironment === undefined || flags.declaredBy === undefined) {
    throw new Error(
      `versturen is niet toegestaan naar ${origin}: dat is geen lokaal adres. Op een live site blijft elk verzoek dat iets kan wijzigen tegengehouden. ` +
        `Is dit een testomgeving waar versturen geen gevolgen heeft, geef dan beide op: --test-environment <origin> en --declared-by "<naam>, <functie>"`,
    );
  }
  const [name, ...rest] = flags.declaredBy.split(",");
  const role = rest.join(",").trim();
  if (!name?.trim() || !role) throw new Error('--declared-by verwacht een naam en een functie, gescheiden door een komma: --declared-by "<naam>, <functie>"');
  return { origin, local: false, declaredBy: { name: name.trim(), role }, declaredAt: now.toISOString(), ...budget };
}

/**
 * A declared test environment lets the run send on a site that is not local: only a person
 * declares that, never an agent. At an interactive terminal the person sees the origin, name and
 * role and types the origin back; without one the declaration is refused before anything starts.
 */
export async function confirmDeclaration(permission: WritePermission, terminal: Terminal = processTerminal()): Promise<WritePermission> {
  if (!permission.declaredBy) return permission;
  const shownNl = [
    `Verklaring dat ${permission.origin} een testomgeving is waar versturen geen gevolgen heeft.`,
    `Origin: ${permission.origin}`,
    `Naam: ${permission.declaredBy.name}`,
    `Functie: ${permission.declaredBy.role}`,
    `De run mag daarheen ten hoogste ${permission.maxWrites ?? DEFAULT_MAX_WRITES} keer iets versturen. De naam komt in manifest.json van de run; het rapport en de verklaring noemen alleen de functie.`,
  ].join("\n");
  const recording = await confirmByTyping("inventory --declared-by", shownNl, permission.origin, "de origin, met http:// of https://", terminal);
  return { ...permission, declaredAt: new Date().toISOString(), ...recording };
}

function maxWritesOf(text: string | undefined): number {
  if (text === undefined) return DEFAULT_MAX_WRITES;
  const value = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < 1) throw new Error(`--max-writes verwacht een geheel getal van 1 of meer, niet "${text}"`);
  return value;
}

/** The permission a run was given at `inventory`, from its manifest. Null when it has none. */
export function writesForRun(runDir: string): WritePermission | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, "utf8")) as { writes?: WritePermission }).writes ?? null;
}

/** Store the permission with the run, or take it away: an inventory without the flags is a run without permission. */
export async function recordWrites(runDir: string, permission: WritePermission | null): Promise<void> {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path) && !permission) return;
  const { writes: _previous, ...manifest } = existsSync(path) ? await readJson<Record<string, unknown>>(path) : ({} as Record<string, unknown>);
  await writeJson(path, permission ? { ...manifest, writes: permission } : manifest);
}

export interface PassedWrite {
  at: string;
  /** The command or session that was running. */
  source: string;
  /** The request method, or "SEND" for a message over a socket. */
  method: string;
  path: string;
  /** A write the browser repeated after a redirect that keeps the method (307, 308): logged, not counted again. */
  repeat?: true;
  /** A frame over a socket that carried a fixed test value: a message an agent typed, counted like a request. */
  message?: true;
}

export const WRITES_LOG = "writes.jsonl";

let current: WriteAccess | null = null;

/**
 * Give every browser context that this process opens from here on the permission of the
 * run. Set once, by the command line, before a command starts; null takes it away.
 */
export function setRunWrites(access: WriteAccess | null): void {
  current = access;
}

export const runWrites = (): WriteAccess | null => current;

/** What is left of the budget for sending of a run. */
export interface WriteBudget {
  origin: string;
  max: number;
  /** Writes that counted: every request that passed to the origin and every socket frame with a test value in it, without the repeats after a redirect. */
  sent: number;
  left: number;
  spacingSeconds: number;
  /** Seconds until the next write may pass; 0 when it may pass now. */
  waitSeconds: number;
}

/**
 * Whether a write counts against the budget. A frame over a socket counts only when it carried a
 * fixed test value (see `isOurMessage`): a chat on a socket also sends a heartbeat every half
 * minute by itself, and counting those would use up the budget without anybody sending anything.
 * The repeat of a request after a redirect is the same request.
 */
const counts = (entry: PassedWrite): boolean => !entry.repeat && (entry.method !== "SEND" || entry.message === true);

/**
 * Whether a frame a page sends over a socket is a message of ours. An agent can only type the
 * fixed test values, so a frame that has one of them in it, as a whole word, is what an agent
 * typed and sent. Anything else (a heartbeat, a handshake, a receipt) is what the page sends by itself.
 */
export function isOurMessage(message: string | Buffer, values: readonly string[]): boolean {
  const text = typeof message === "string" ? message : message.toString("utf8");
  return values.some((value) => new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text));
}

function readLog(runDir: string): PassedWrite[] {
  const path = join(runDir, WRITES_LOG);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PassedWrite];
      } catch {
        // A line cut off by a process that stopped halfway.
        return [];
      }
    });
}

/** The budget for sending of a run, from its permission and its log of writes. The log is in the run, so a new process goes on with what was sent. */
export function writeBudget(runDir: string, permission: WritePermission, now = Date.now()): WriteBudget {
  const max = permission.maxWrites ?? DEFAULT_MAX_WRITES;
  const spacingSeconds = permission.spacingSeconds ?? DEFAULT_WRITE_SPACING_SECONDS;
  const counted = readLog(runDir).filter(counts);
  const last = counted.length > 0 ? Date.parse(counted.at(-1)!.at) : Number.NEGATIVE_INFINITY;
  const waitSeconds = Math.max(0, Math.ceil((last + spacingSeconds * 1000 - now) / 1000));
  return { origin: permission.origin, max, sent: counted.length, left: Math.max(0, max - counted.length), spacingSeconds, waitSeconds };
}

/** One line for `session list` and `estimate`: what is left of the budget for sending. */
export const writeBudgetNl = (budget: WriteBudget): string =>
  `nog ${budget.left} van ${budget.max} verzendingen naar ${budget.origin} over voor de hele run (${budget.sent} verstuurd), met minstens ${budget.spacingSeconds} s ertussen${budget.left > 0 && budget.waitSeconds > 0 ? `; de volgende kan over ${budget.waitSeconds} s` : ""}`;

/** The open point an agent writes when what it had to send could not go because the budget is used up. */
export const budgetOutPointNl = (budget: Pick<WriteBudget, "sent" | "max">): string => `versturen niet toegestaan: het budget voor versturen van deze run is op (${budget.sent} van ${budget.max} verstuurd)`;

export type WriteClaim = { ok: true; entry: PassedWrite } | { ok: false; budget: "out" | "spacing"; reasonNl: string };

/**
 * What a browser context needs to let writes through: the origin, and where to note each one.
 * Every write that passes is one line in `writes.jsonl` in the run: method, path and time, never the body.
 */
export interface WriteAccess {
  origin: string;
  /**
   * Take one write from the budget of the run and note it, or refuse it: when the budget is used
   * up, or when the previous write is less than the spacing ago. A refused write is not sent, and
   * not waited for either: an agent that waits inside a command runs into its time limit.
   */
  claim: (method: string, url: string, options?: { message?: boolean }) => WriteClaim;
  /** Note a write that does not count against the budget: a frame over a socket without a test value in it, or the repeat of a request after a redirect. */
  record: (method: string, url: string, options?: { repeat?: boolean }) => PassedWrite;
}

const LOCK = "writes.lock";
/** A lock older than this was left behind by a process that stopped while it held it. */
const STALE_LOCK_MS = 10_000;

/**
 * Hold the lock on the log of writes of a run while `work` runs. The sessions of a run share one
 * process, but the sweep runs in processes of its own: two of them must not both take the last write.
 * The work is a read and an append of one line, so the wait is short and done in place.
 */
function withLock<T>(runDir: string, work: () => T): T {
  const path = join(runDir, LOCK);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 0; ; tries++) {
    try {
      mkdirSync(path);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - statSync(path).mtimeMs;
      } catch {
        // Gone in between: try again at once.
      }
      if (age > STALE_LOCK_MS || tries > 400) rmSync(path, { recursive: true, force: true });
      else Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    return work();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

export function writeAccess(runDir: string, permission: WritePermission, source: string, now: () => number = Date.now): WriteAccess {
  const append = (method: string, url: string, repeat: boolean, message = false): PassedWrite => {
    const entry: PassedWrite = { at: new Date(now()).toISOString(), source, method, path: new URL(url).pathname, ...(repeat ? { repeat: true as const } : {}), ...(message ? { message: true as const } : {}) };
    mkdirSync(runDir, { recursive: true });
    // Appended at once and synchronously: the line is there even when the run is cut off right after.
    appendFileSync(join(runDir, WRITES_LOG), `${JSON.stringify(entry)}\n`);
    return entry;
  };
  return {
    origin: permission.origin,
    record: (method, url, options) => append(method, url, options?.repeat === true),
    claim: (method, url, options) => {
      mkdirSync(runDir, { recursive: true });
      return withLock(runDir, (): WriteClaim => {
        const budget = writeBudget(runDir, permission, now());
        if (budget.left === 0) return { ok: false, budget: "out", reasonNl: `het budget voor versturen van deze run is op: ${budget.sent} van ${budget.max} verzendingen naar ${budget.origin} zijn gedaan, door alle sessies en de veegronde samen` };
        if (budget.waitSeconds > 0) return { ok: false, budget: "spacing", reasonNl: `te kort na de vorige verzending: tussen twee verzendingen zit minstens ${budget.spacingSeconds} s; versturen kan weer over ${budget.waitSeconds} s (nog ${budget.left} van ${budget.max} over)` };
        return { ok: true, entry: append(method, url, false, options?.message === true) };
      });
    },
  };
}

/** Whether a request or socket goes to the origin that may be written to. A socket counts by the origin of its http(s) twin. */
export function isWriteOrigin(access: WriteAccess | null | undefined, url: string): boolean {
  if (!access) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    return parsed.origin === access.origin;
  } catch {
    return false;
  }
}
