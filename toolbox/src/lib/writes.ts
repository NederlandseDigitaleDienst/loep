import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import type { RecordedVia } from "./recorded.ts";

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
  /** Set when the agent recorded the declaration in the conversation; `declaredAt` is then the moment the person confirmed it. */
  recordedVia?: RecordedVia;
}

export interface WriteFlags {
  allowWrites?: boolean | undefined;
  testEnvironment?: string | undefined;
  declaredBy?: string | undefined;
  recordedVia?: RecordedVia | undefined;
}

/** What is left out of an evaluation when nothing may be sent; for a report that has no permission to mention. */
export const WRITES_BLOCKED_NL = "verzoeken die iets kunnen wijzigen zijn tegengehouden; wat pas na versturen verschijnt is niet onderzocht";

/**
 * The sentence for the report, the dossier and the limitations. It names the role of whoever
 * declared the test environment, not the name: a report is shared and published, and the name
 * of the person stays in the manifest of the run, where the declaration can be traced.
 */
export const writesAllowedNl = (permission: WritePermission): string =>
  `onderzocht op een testomgeving waar versturen is toegestaan: ${permission.origin}${permission.declaredBy ? `, verklaard door iemand met de functie ${permission.declaredBy.role}${permission.recordedVia ? ", vastgelegd in een gesprek" : ""} (de naam staat in het dossier van het onderzoek, niet in dit rapport)` : " (lokaal adres)"}`;

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
  if (!flags.allowWrites && flags.testEnvironment === undefined && flags.declaredBy === undefined) return null;
  const origin = flags.testEnvironment !== undefined ? originOf(flags.testEnvironment, "--test-environment") : originOf(baseUrl, "het adres van de site");
  const local = isLocalHost(new URL(origin).hostname);
  if (local) {
    if (!flags.allowWrites) throw new Error(`versturen naar ${origin} is alleen toegestaan met --allow-writes erbij`);
    return { origin, local: true, declaredBy: null, declaredAt: now.toISOString() };
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
  return { origin, local: false, declaredBy: { name: name.trim(), role }, declaredAt: now.toISOString(), ...(flags.recordedVia ? { recordedVia: flags.recordedVia } : {}) };
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

/**
 * What a browser context needs to let writes through: the origin, and where to note each one.
 * Every write that passes is one line in `writes.jsonl` in the run: method, path and time, never the body.
 */
export interface WriteAccess {
  origin: string;
  record: (method: string, url: string) => PassedWrite;
}

export function writeAccess(runDir: string, permission: WritePermission, source: string): WriteAccess {
  return {
    origin: permission.origin,
    record: (method, url) => {
      const entry: PassedWrite = { at: new Date().toISOString(), source, method, path: new URL(url).pathname };
      mkdirSync(runDir, { recursive: true });
      // Appended at once and synchronously: the line is there even when the run is cut off right after.
      appendFileSync(join(runDir, WRITES_LOG), `${JSON.stringify(entry)}\n`);
      return entry;
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
