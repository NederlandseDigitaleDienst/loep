import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import { confirmByTyping, processTerminal, recordedNl, recordStatement, type RecordedVia, type Recording, type RecordingFlags, type Terminal } from "./recorded.ts";

/**
 * Where a run may send, with a budget of its own: one origin, or origins a person declared together.
 * A run on this machine that also has a declared chat has two: the site with the local rules, and the
 * chat with a declaration, the normal budget and the pause (see `WritePermission.alsoGrants`).
 */
export interface WriteGrant {
  /** The first origin that may be written to, e.g. "https://test.example.nl". */
  origin: string;
  /** Further origins a person declared, such as the site next to the chat embedded in it. They share the budget of the grant. */
  alsoOrigins?: string[];
  /** True for an address that cannot be a live site: this machine, or a name ending in .localhost or .test. */
  local: boolean;
  /** Who stated that this is a test environment where submitting has no consequences; null for a local address. */
  declaredBy: { name: string; role: string } | null;
  declaredAt: string;
  /** How the declaration came about: confirmed by a person at a terminal (`confirmDeclaration`), never by an agent. `declaredAt` is the moment of that confirmation. */
  recordedVia?: RecordedVia;
  /** Most writes the whole run may send to the origins of the grant, over every session and the sweep together. Absent in a manifest from before the budget: `DEFAULT_MAX_WRITES`. */
  maxWrites?: number;
  /** Shortest time between two writes that pass, in seconds. Absent: `DEFAULT_WRITE_SPACING_SECONDS`. Not a flag: a test sets it in the manifest. */
  spacingSeconds?: number;
  /** Set at inventory for a run with a mailbox: on a local address too, the last part of the budget is kept (see `reservedWrites`). */
  keepShare?: boolean;
}

/** A raise of the budget of one grant. `origin` names the grant in a run with more than one; absent, the first. */
export type WriteRaise = { from: number; to: number; at: string; origin?: string } & Recording;

/**
 * Permission to send requests that can change something (anything but GET and HEAD, and
 * messages over a socket) to the origins named here. Without it every such request is held back, on every
 * site. It exists only for a test environment: a machine of one's own, or an environment
 * that a named person declared to be one. The permission is its first grant; `alsoGrants` holds
 * the others, so a manifest from before there could be more than one reads as it did.
 */
export interface WritePermission extends WriteGrant {
  /** Grants next to the first, each with its own budget, pause and declaration: a chat a person declared next to a site on this machine. */
  alsoGrants?: WriteGrant[];
  /** Each time a person raised `maxWrites` of a grant after inventory (see `raiseWrites`), oldest first. */
  raised?: WriteRaise[];
}

/**
 * The budget for sending when `inventory` is not told otherwise. Forty agents that each used a
 * chat sent 54 messages in an hour and a half, and the service blocked the address of the machine.
 * The budget is for the run, not per agent: no agent knows what the others sent.
 */
export const DEFAULT_MAX_WRITES = 5;
/** A service that counts messages per minute sees at most one from the run in two minutes. */
export const DEFAULT_WRITE_SPACING_SECONDS = 120;
/**
 * On this machine nobody receives a stream of messages, so there is no pause and a larger budget.
 * The limit stays, so an agent in a loop does not send without end.
 */
export const LOCAL_MAX_WRITES = 50;
export const LOCAL_WRITE_SPACING_SECONDS = 0;
/** What a registration of its own takes from the budget: the form, the link that confirms it, and the press that ends it. */
export const REGISTRATION_WRITES = 3;

/** The grants of a permission, the first one first. */
export const grantsOf = (permission: WritePermission): WriteGrant[] => {
  const { alsoGrants, raised: _raised, ...first } = permission;
  return [first, ...(alsoGrants ?? [])];
};

/** The origins of one grant, the first one first. */
export const grantOriginsOf = (grant: Pick<WriteGrant, "origin" | "alsoOrigins">): string[] => [grant.origin, ...(grant.alsoOrigins ?? [])];

/** Every origin of a permission, over all its grants, the first one first. */
export const writeOriginsOf = (permission: Pick<WritePermission, "origin" | "alsoOrigins" | "alsoGrants">): string[] => [...grantOriginsOf(permission), ...(permission.alsoGrants ?? []).flatMap(grantOriginsOf)];

/** The origins of a permission for in a sentence. */
export const writeOriginsNl = (permission: Pick<WritePermission, "origin" | "alsoOrigins" | "alsoGrants">): string => writeOriginsOf(permission).join(" en ");

/** The origin of an address as a write to it is counted: a socket by its http(s) twin. Null for what is no address. */
function writeOriginOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    return parsed.origin;
  } catch {
    return null;
  }
}

/** The grant an address falls under; the first grant for an address of none of them. */
export function grantFor(permission: WritePermission, url: string): WriteGrant {
  const origin = writeOriginOf(url);
  const grants = grantsOf(permission);
  return grants.find((grant) => origin !== null && grantOriginsOf(grant).includes(origin)) ?? grants[0]!;
}

/** Whether a line of the log of writes counts for this grant. A line without an origin is from a run with one grant, and counts for the first. */
const inGrant = (permission: WritePermission, grant: WriteGrant, entry: { origin?: string }): boolean => (entry.origin === undefined ? permission.origin : grantFor(permission, entry.origin).origin) === grant.origin;

/** The part of a sentence about the pause between two writes, starting with a comma. */
export const spacingNl = (seconds: number): string => (seconds > 0 ? `, met minstens ${seconds} s ertussen` : ", zonder wachttijd ertussen");

export interface WriteFlags {
  allowWrites?: boolean | undefined;
  /** `--test-environment`, which may be given more than once. */
  testEnvironment?: string | string[] | undefined;
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
export const writesAllowedNl = (permission: WritePermission): string => `onderzocht op een testomgeving waar versturen is toegestaan: ${grantsOf(permission).map(grantNl).join("; ")}${raisedNl(permission)}`;

const grantNl = (grant: WriteGrant): string =>
  `${grantOriginsOf(grant).join(" en ")}${grant.declaredBy ? `, verklaard door iemand met de functie ${grant.declaredBy.role}${grant.recordedVia ? `, ${recordedNl(grant, grant.declaredAt)}` : ""} (de naam staat in het dossier van het onderzoek, niet in dit rapport)` : " (lokaal adres)"}`;

/**
 * The permission as it stood after the first `count` raises. A person raises the budget to finish
 * what ran out: a raise is no reason to measure again, so a task keeps the raises it was written with
 * for as long as its verdict holds, and a dossier names none (see `instrumentTasks`).
 */
export const writesAfterRaises = (permission: WritePermission, count: number): WritePermission => {
  const later = (permission.raised ?? []).slice(count);
  if (later.length === 0) return permission;
  const { raised, alsoGrants, ...first } = permission;
  // Each grant gets the budget from before the first raise of it that is left out.
  const before = <T extends WriteGrant>(grant: T): T => {
    const next = later.find((raise) => (raise.origin ?? permission.origin) === grant.origin);
    return next ? { ...grant, maxWrites: next.from } : grant;
  };
  return { ...before(first), ...(alsoGrants ? { alsoGrants: alsoGrants.map(before) } : {}), ...(count > 0 ? { raised: raised!.slice(0, count) } : {}) };
};

const raisedNl = (permission: WritePermission): string => (permission.raised ?? []).map((raise) => `; budget voor versturen${raise.origin ? ` naar ${raise.origin}` : ""} verhoogd van ${raise.from} naar ${raise.to}, ${recordedNl(raise, raise.at)}`).join("");

/** Hosts that cannot be a live site: the machine itself and the names reserved for testing. */
/**
 * This machine itself. `isLocalHost` also takes a name that ends in `.test`, which can be any machine:
 * good enough for a site, not for where a password or a session goes, or for taking any certificate.
 */
export const isThisMachine = (host: string): boolean => /^(?:localhost|.+\.localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(host);

/**
 * A request of the toolbox itself, outside a browser. With `LOEP_BOUNDARY_LOCAL_ONLY=1` nothing leaves
 * this machine, also not this way.
 */
export function trialFetch(url: string, init?: RequestInit): Promise<Response> {
  if (process.env.LOEP_BOUNDARY_LOCAL_ONLY === "1" && !isLocalHost(new URL(url).hostname)) return Promise.resolve(new Response(null, { status: 599 }));
  return fetch(url, init);
}

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
  const declared = [...new Set([flags.testEnvironment ?? []].flat().map((address) => originOf(address, "--test-environment")))];
  const site = originOf(baseUrl, "het adres van de site");
  const isLocal = (address: string): boolean => isLocalHost(new URL(address).hostname);
  const localRefusedNl = "een lokaal adres verklaar je niet naast een ander adres: een lokaal adres krijgt --allow-writes";
  if (declared.length > 1 && declared.some(isLocal)) throw new Error(localRefusedNl);
  // A site on this machine with a chat of another party on an address of its own: the site keeps the local rules, the chat gets a declaration.
  if (flags.allowWrites && isLocal(site) && declared.length > 0 && declared.some((address) => address !== site)) {
    if (declared.some(isLocal)) throw new Error(localRefusedNl);
    const grant = declaredGrant(declared, flags, now);
    return { origin: site, local: true, declaredBy: null, declaredAt: now.toISOString(), maxWrites: LOCAL_MAX_WRITES, spacingSeconds: LOCAL_WRITE_SPACING_SECONDS, alsoGrants: [grant] };
  }
  const origin = declared[0] ?? site;
  if (isLocal(origin)) {
    if (!flags.allowWrites) throw new Error(`versturen naar ${origin} is alleen toegestaan met --allow-writes erbij`);
    return { origin, local: true, declaredBy: null, declaredAt: now.toISOString(), maxWrites: maxWritesOf(flags.maxWrites, LOCAL_MAX_WRITES), spacingSeconds: LOCAL_WRITE_SPACING_SECONDS };
  }
  return declaredGrant(declared.length > 0 ? declared : [origin], flags, now);
}

/** The grant for origins a person declares to be a test environment, with the normal budget and pause. */
function declaredGrant(declared: string[], flags: WriteFlags, now: Date): WriteGrant {
  const origin = declared[0]!;
  const budget = { maxWrites: maxWritesOf(flags.maxWrites, DEFAULT_MAX_WRITES), spacingSeconds: DEFAULT_WRITE_SPACING_SECONDS };
  if (flags.testEnvironment === undefined || flags.declaredBy === undefined) {
    throw new Error(
      `versturen is niet toegestaan naar ${origin}: dat is geen lokaal adres. Op een live site blijft elk verzoek dat iets kan wijzigen tegengehouden. ` +
        `Is dit een testomgeving waar versturen geen gevolgen heeft, geef dan beide op: --test-environment <origin> en --declared-by "<naam>, <functie>"`,
    );
  }
  const [name, ...rest] = flags.declaredBy.split(",");
  const role = rest.join(",").trim();
  if (!name?.trim() || !role) throw new Error('--declared-by verwacht een naam en een functie, gescheiden door een komma: --declared-by "<naam>, <functie>"');
  return { origin, ...(declared.length > 1 ? { alsoOrigins: declared.slice(1) } : {}), local: false, declaredBy: { name: name.trim(), role }, declaredAt: now.toISOString(), ...budget };
}

/**
 * A declared test environment lets the run send on a site that is not local: only a person
 * declares that, never an agent. At an interactive terminal the person sees the origins, name and
 * role and types each origin back; without one the declaration is refused before anything starts.
 */
export async function confirmDeclaration(permission: WritePermission, terminal: Terminal = processTerminal()): Promise<WritePermission> {
  const confirm = async <T extends WriteGrant>(grant: T): Promise<T> => {
    if (!grant.declaredBy) return grant;
    const origins = grantOriginsOf(grant);
    const local = grantsOf(permission).find((other) => other.local);
    const shownNl = [
      `Verklaring dat ${origins.join(" en ")} ${origins.length > 1 ? "testomgevingen zijn" : "een testomgeving is"} waar versturen geen gevolgen heeft.`,
      ...origins.map((origin) => `Origin: ${origin}`),
      `Naam: ${grant.declaredBy.name}`,
      `Functie: ${grant.declaredBy.role}`,
      `De run mag daarheen ${origins.length > 1 ? "samen " : ""}ten hoogste ${grant.maxWrites ?? DEFAULT_MAX_WRITES} keer iets versturen. De naam komt in manifest.json van de run; het rapport en de verklaring noemen alleen de functie.`,
      ...(local ? [`Naar ${local.origin} op deze machine verstuurt de run apart, met een eigen budget, zonder verklaring.`] : []),
    ].join("\n");
    let recording: { recordedVia: "terminal" } | undefined;
    for (const [position, origin] of origins.entries()) {
      const whatNl = origins.length > 1 ? `origin ${position + 1} van ${origins.length}, met http:// of https://` : "de origin, met http:// of https://";
      recording = await confirmByTyping("inventory --declared-by", position === 0 ? shownNl : "Nog een origin.", origin, whatNl, terminal);
    }
    return { ...grant, declaredAt: new Date().toISOString(), ...recording };
  };
  const first = await confirm(permission);
  if (!permission.alsoGrants) return first;
  // One after the other: each asks at the terminal.
  const alsoGrants: WriteGrant[] = [];
  for (const grant of permission.alsoGrants) alsoGrants.push(await confirm(grant));
  return { ...first, alsoGrants };
}

function maxWritesOf(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < 1) throw new Error(`--max-writes verwacht een geheel getal van 1 of meer, niet "${text}"`);
  return value;
}

/**
 * Raise the budget of a run. The person who may decide that says so: at an interactive terminal, or
 * in the conversation, like an answer or a decision (`recordStatement`). Where may be sent stays with
 * the declaration at inventory. What runs picks up the new budget at the next write.
 */
export async function raiseWrites(runDir: string, text: string, flags: RecordingFlags = {}, terminal: Terminal = processTerminal(), origin?: string): Promise<WritePermission> {
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen: dat ligt vast bij inventory, en een budget verhogen verandert dat niet");
  const grants = grantsOf(permission);
  // In a run with more than one budget a person says which one goes up.
  if (grants.length > 1 && origin === undefined) throw new Error(`deze run heeft een eigen budget per origin: zeg welk omhoog gaat met --origin ${grants.map((grant) => grant.origin).join(" of --origin ")}`);
  const grant = origin === undefined ? grants[0]! : grants.find((candidate) => grantOriginsOf(candidate).includes(originOf(origin, "--origin")));
  if (!grant) throw new Error(`${origin} is geen origin waar deze run naartoe mag versturen (${writeOriginsNl(permission)})`);
  const from = grant.maxWrites ?? DEFAULT_MAX_WRITES;
  const to = maxWritesOf(text, from);
  if (to <= from) throw new Error(`--max-writes moet hoger zijn dan het huidige budget (${from})`);
  const shownNl = [`Verhoging van het budget voor versturen van ${from} naar ${to} verzendingen voor de hele run.`, `Origins: ${grantOriginsOf(grant).join(" en ")}`, "Elke verzending komt echt aan bij wie het bericht ontvangt."].join("\n");
  const recording = await recordStatement("writes --max-writes", flags, shownNl, terminal);
  const raise: WriteRaise = { from, to, at: new Date().toISOString(), ...(grants.length > 1 ? { origin: grant.origin } : {}), ...recording };
  const first = grant.origin === permission.origin;
  const raised: WritePermission = {
    ...permission,
    ...(first ? { maxWrites: to } : { alsoGrants: permission.alsoGrants!.map((other) => (other.origin === grant.origin ? { ...other, maxWrites: to } : other)) }),
    raised: [...(permission.raised ?? []), raise],
  };
  await recordWrites(runDir, raised);
  return raised;
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
  /** Where it went, in a run that may send to more than one origin. */
  origin?: string;
  /** A write the browser repeated after a redirect that keeps the method (307, 308): logged, not counted again. */
  repeat?: true;
  /** A frame over a socket that counted against the budget: every frame, except one shown to be a heartbeat or a message of the protocol (see `SocketFrames`). */
  message?: true;
  /** The id of a personal link from a mail that was opened: the first time counts as a write, like a form. */
  link?: string;
  /** Sent by `mail cleanup`: it removes what the run left behind, and that does not depend on what is left of the budget. */
  cleanup?: true;
  /** No write: the moment a sender took the registration of its own with this id (see `claimRegistration`). */
  registration?: string;
}

export const WRITES_LOG = "writes.jsonl";

/**
 * Who waits for a turn to send, first come first: one ticket per sender and grant, in the order they
 * came. Kept next to the log of writes and changed under the same lock, so every session and every
 * command of the sweep sees the same queue.
 */
export const WRITES_QUEUE = "writes-queue.json";

/** A place in the queue for sending (see `WRITES_QUEUE`). */
interface Ticket {
  sender: string;
  /** The grant it waits for, by its first origin. */
  origin: string;
}

/**
 * How long a turn stays kept for a sender that does not come to take it: a session that could not wait
 * within its command hears when its turn is, and has this long after that to do the action again.
 * After it, the ones behind it go on.
 */
export const TURN_KEPT_MS = 60_000;

/** The sender of `mail cleanup`. Only that command sets it. */
export const CLEANUP_SENDER = "mail cleanup";

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
  /** The origins of the run, for in a sentence. */
  origin: string;
  max: number;
  /** Writes that counted: every request that passed to the origin and every socket frame that counted (see `SocketFrames`), without the repeats after a redirect. */
  sent: number;
  /** What may still be sent: by anyone, or by the sender the budget was asked for, which may have used its share (see `reservedWrites`). */
  left: number;
  /** The last writes of the budget, kept for senders that have sent nothing yet. */
  reserved: number;
  spacingSeconds: number;
  /** Seconds until the next write may pass; 0 when it may pass now. With a sender: until its turn, after whoever waited before it. */
  waitSeconds: number;
  /** How many senders wait for their turn before this one; absent when none. */
  ahead?: number;
}

/**
 * Whether a write counts against the budget. A frame over a socket counts unless it was shown to be
 * a heartbeat or a message of the protocol (see `SocketFrames`): a chat on a socket also sends a
 * heartbeat every half minute by itself, and counting those would use up the budget without anybody
 * sending anything. The repeat of a request after a redirect is the same request.
 */
const counts = (entry: PassedWrite): boolean => !entry.repeat && !entry.cleanup && !entry.registration && (entry.method !== "SEND" || entry.message === true);

/**
 * Whether a frame a page sends over a socket has a test value in it, as a whole word. An agent
 * can only type the fixed test values, so such a frame is what an agent typed and sent.
 */
export function isOurMessage(message: string | Buffer, values: readonly string[]): boolean {
  const text = typeof message === "string" ? message : message.toString("utf8");
  return values.some((value) => new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text));
}

/** Text frames of known protocols that carry nothing: a ping, a pong, a handshake, a close. */
const PROTOCOL_FRAMES: readonly RegExp[] = [
  // Nothing, or the newline that is a heartbeat in STOMP.
  /^\s*$/,
  /^(?:ping|pong|heartbeat|keep-?alive)$/i,
  // Engine.IO: open, close, ping, pong, an empty message, upgrade and noop, also during the probe of an upgrade.
  /^[0-6](?:probe)?$/,
  // Socket.IO: connecting to or leaving a namespace, without data.
  /^4[01](?:\/[\w.-]*,?)?$/,
  // SignalR: the handshake, and the ping and close messages.
  /^\{"protocol":"\w+","version":\d+\}\x1e$/,
  /^\{"type":[67]\}\x1e$/,
];
/** Values of the field that names the kind of a short JSON frame, for the kinds that carry nothing (also graphql-ws and its predecessor). */
const PROTOCOL_KINDS = new Set(["ping", "pong", "heartbeat", "keepalive", "keep-alive", "ka", "connection_init", "connection_ack"]);
const KIND_FIELDS = ["type", "event", "op", "action", "kind"];
/** A JSON frame longer than this is not judged by its kind: it has room for more than a heartbeat. */
const MAX_PROTOCOL_JSON = 200;

/** Whether a frame is a short message of a known protocol that carries nothing. A frame that is not text cannot be judged and is no such message. */
export function isProtocolFrame(message: string | Buffer): boolean {
  if (typeof message !== "string") return false;
  if (PROTOCOL_FRAMES.some((pattern) => pattern.test(message))) return true;
  if (message.length > MAX_PROTOCOL_JSON || !/^[[{]/.test(message)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return false;
  }
  // Phoenix: [join_ref, ref, "phoenix", "heartbeat", {}].
  if (Array.isArray(parsed)) return parsed[2] === "phoenix" && parsed[3] === "heartbeat";
  if (parsed === null || typeof parsed !== "object") return false;
  return KIND_FIELDS.some((field) => {
    const kind = (parsed as Record<string, unknown>)[field];
    return typeof kind === "string" && PROTOCOL_KINDS.has(kind.toLowerCase());
  });
}

/** How many frames a socket remembers as sent by the page by itself, and how long such a frame may be. */
const MAX_REMEMBERED = 200;
const MAX_REMEMBERED_LENGTH = 4096;

/**
 * Which frames a page sends over one socket count against the budget for sending. Every frame
 * counts, except one that is shown to be a heartbeat or a message of the protocol: the same frame
 * as one the page sent earlier while no agent acted, or a short frame of a known protocol (see
 * `isProtocolFrame`). A frame with a test value in it always counts, and so does a frame that
 * cannot be judged, such as a binary or compressed one: what cannot be shown to be nothing, may be a message.
 */
export class SocketFrames {
  private readonly values: readonly string[];
  /** Frames the page sent while no agent acted on it. */
  private readonly byItself = new Set<string>();

  constructor(values: readonly string[]) {
    this.values = values;
  }

  /** Whether this frame counts. `idle`: no agent acts on the page now, so what it sends, it sends by itself; unknown is not idle. */
  counts(message: string | Buffer, idle = false): boolean {
    if (isOurMessage(message, this.values)) return true;
    const key = typeof message === "string" ? `t${message}` : `b${message.toString("base64")}`;
    if (this.byItself.has(key)) return false;
    if (idle && key.length <= MAX_REMEMBERED_LENGTH && this.byItself.size < MAX_REMEMBERED) this.byItself.add(key);
    return !isProtocolFrame(message);
  }
}

/**
 * Who shares in the budget as one: the judge, the verifier and the finisher of one criterion
 * (sessions b-331, v-331 and a-331, also with a number after them, as `tasks` names them) are one
 * sender, because the later ones can cite what the first one saw. Any other session, and every
 * command of the sweep, is a sender of its own.
 */
export function senderOf(source: string): string {
  const criterion = /^[bva]-(\d+)(?:-\d+)?$/.exec(source);
  return criterion ? criterionSender(criterion[1]!) : source;
}

/** The sender of the sessions of a criterion, such as 3.3.1. */
export const criterionSender = (criterion: string): string => `criterium ${criterion.replaceAll(".", "")}`;

/**
 * The writes at the end of the budget that only a sender that has sent nothing yet may take: half
 * of it, rounded down. Without it the sweep and the first agents used up everything, and the
 * criteria whose turn came later could send nothing at all. Nothing is kept on a local site: there
 * is no recipient, and the budget there is for an agent in a loop. Unless the run has a mailbox: then
 * a form starts a route that agents go on with, and without it the walks used up all 50.
 */
export const reservedWrites = (grant: WriteGrant): number => (grant.local && !grant.keepShare ? 0 : Math.floor((grant.maxWrites ?? DEFAULT_MAX_WRITES) / 2));

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

function readQueue(runDir: string): Ticket[] {
  const path = join(runDir, WRITES_QUEUE);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((ticket): ticket is Ticket => typeof ticket?.sender === "string" && typeof ticket?.origin === "string") : [];
  } catch {
    // Cut off by a process that stopped halfway: nobody waits any more.
    return [];
  }
}

/** Where a sender is in the queue of one grant, and when its turn is. */
interface Turn {
  /** The moment the sender may send, in ms; at or before `now` it may send now. */
  at: number;
  /** Whether the sender holds a ticket. */
  holds: boolean;
  /** How many wait before it. */
  ahead: number;
  /** The tickets that still count, in order: a ticket whose turn passed more than `TURN_KEPT_MS` ago is gone. */
  kept: Ticket[];
}

/**
 * When a sender may send: after the spacing from the last write, and after every sender that waited
 * before it, each the spacing after the one before. Without a ticket a sender comes after the whole queue.
 */
function turnOf(queue: readonly Ticket[], origin: string, sender: string | undefined, last: number, spacingMs: number, now: number): Turn {
  const kept: Ticket[] = [];
  let at = Number.isFinite(last) ? last + spacingMs : now;
  let ahead = 0;
  let own: number | null = null;
  for (const ticket of queue) {
    if (ticket.origin !== origin) {
      kept.push(ticket);
      continue;
    }
    if (own === null && now > at + TURN_KEPT_MS) continue;
    kept.push(ticket);
    if (own !== null) continue;
    if (sender !== undefined && ticket.sender === sender) {
      own = at;
      continue;
    }
    // Who is before it has not sent yet: it sends at its turn at the earliest, or now when that turn has passed.
    at = Math.max(at, now) + spacingMs;
    ahead++;
  }
  return { at: own ?? at, holds: own !== null, ahead, kept };
}

/**
 * The budget for sending of a run, from its permission and its log of writes. The log is in the run,
 * so a new process goes on with what was sent. With a sender, `left` is what that sender may still
 * send: a sender that has sent before does not get the reserved writes. In a run with more than one
 * grant each has a budget of its own: `origin` says which, absent the first.
 */
export function writeBudget(runDir: string, permission: WritePermission, now = Date.now(), sender?: string, origin?: string): WriteBudget {
  return budgetAndQueue(runDir, permission, now, sender, origin).budget;
}

/** The budget, with the tickets of the queue that still count. */
function budgetAndQueue(runDir: string, permission: WritePermission, now: number, sender?: string, origin?: string): { budget: WriteBudget; turn: Turn; grant: string } {
  const grant = origin === undefined ? grantsOf(permission)[0]! : grantFor(permission, origin);
  // A person can raise the budget while sessions run: what the manifest says now counts.
  const stored = writesForRun(runDir);
  const storedGrant = stored ? grantsOf(stored).find((candidate) => candidate.origin === grant.origin) : undefined;
  const max = (stored?.raised ? storedGrant?.maxWrites : undefined) ?? grant.maxWrites ?? DEFAULT_MAX_WRITES;
  const spacingSeconds = grant.spacingSeconds ?? DEFAULT_WRITE_SPACING_SECONDS;
  const log = readLog(runDir).filter((entry) => inGrant(permission, grant, entry));
  const counted = log.filter(counts);
  // What cleanup sends costs nothing, but the service on the other side still sees it.
  const spaced = log.filter((entry) => counts(entry) || entry.cleanup);
  const last = spaced.length > 0 ? Date.parse(spaced.at(-1)!.at) : Number.NEGATIVE_INFINITY;
  // Who waited before this sender goes first (see `WRITES_QUEUE`).
  const turn = turnOf(readQueue(runDir), grant.origin, sender, last, spacingSeconds * 1000, now);
  const waitSeconds = Math.max(0, Math.ceil((turn.at - now) / 1000));
  const reserved = reservedWrites(grant);
  const isSender = (entry: PassedWrite): boolean => sender !== undefined && senderOf(entry.source) === senderOf(sender);
  const sentBefore = counted.some(isSender);
  // A registration of its own has a route that takes several writes, so its sender may go on into what is kept, as far as that route goes.
  const paidFor = log.filter((entry) => entry.registration && isSender(entry)).length * REGISTRATION_WRITES;
  const budget: WriteBudget = { origin: grantOriginsOf(grant).join(" en "), max, sent: counted.length, left: Math.max(0, max - counted.length - (sentBefore ? Math.max(0, reserved - paidFor) : 0)), reserved, spacingSeconds, waitSeconds };
  if (turn.ahead > 0) budget.ahead = turn.ahead;
  return { budget, turn, grant: grant.origin };
}

function writeQueue(runDir: string, queue: readonly Ticket[]): void {
  const path = join(runDir, WRITES_QUEUE);
  if (queue.length === 0) rmSync(path, { force: true });
  else writeFileSync(path, `${JSON.stringify(queue)}\n`);
}

/** The budget of each grant of a run, the first one first. */
export const writeBudgets = (runDir: string, permission: WritePermission, now = Date.now(), sender?: string): WriteBudget[] => grantsOf(permission).map((grant) => writeBudget(runDir, permission, now, sender, grant.origin));

/** The budgets of a run for in one line: each with its own origins. */
export const writeBudgetsNl = (budgets: readonly WriteBudget[]): string => budgets.map(writeBudgetNl).join("; ");

/**
 * Take a registration of its own for a sender, or say why not, in Dutch. Nothing is sent yet: the route
 * has to fit in what is left, or it stops halfway and leaves a registration nobody can finish.
 */
export function claimRegistration(runDir: string, permission: WritePermission, id: string, sender: string, now = Date.now()): string | null {
  return withLock(runDir, () => {
    const { max, sent } = writeBudget(runDir, permission, now);
    if (max - sent < REGISTRATION_WRITES) return `een eigen aanmelding kost ${REGISTRATION_WRITES} verzendingen (het formulier, de bevestiging en het afmelden of verwijderen), en van het budget zijn er nog ${Math.max(0, max - sent)} van ${max} over. Laat iemand beslissen of het omhoog gaat (writes --run <run> --max-writes <aantal>)`;
    // A registration is on the site, the first grant; it says so in a run with more than one.
    const entry: PassedWrite = { at: new Date(now).toISOString(), source: sender, method: "REGISTER", path: "", ...(permission.alsoGrants ? { origin: permission.origin } : {}), registration: id };
    appendFileSync(join(runDir, WRITES_LOG), `${JSON.stringify(entry)}\n`);
    return null;
  });
}

/** Whether the sender of a registration of its own sent anything after it took that registration. */
export function registrationUsed(runDir: string, id: string): boolean {
  const log = readLog(runDir);
  const taken = log.findIndex((entry) => entry.registration === id);
  return taken !== -1 && log.slice(taken + 1).some((entry) => counts(entry) && senderOf(entry.source) === senderOf(log[taken]!.source));
}

/** The path on which a sender sent something itself, among these paths: what a run can say about a registration that its own session ended. */
export function sentOn(runDir: string, sender: string, paths: readonly string[]): string | null {
  return readLog(runDir).find((entry) => entry.method !== "GET" && senderOf(entry.source) === sender && paths.includes(entry.path))?.path ?? null;
}

/** Whether the budget is about to run out: a person may want to raise it before the next agents start. */
export const writesLow = (budget: WriteBudget): boolean => budget.left <= Math.max(1, Math.floor(budget.max / 4));

/** What `pending` and `estimate` say when nothing is left: a person decides before the next phase starts, or its agents leave open what they could not send. */
export const budgetEmptyNl = (budget: Pick<WriteBudget, "sent" | "max">): string => `LET OP: het budget voor versturen is op (${budget.sent} van ${budget.max} verstuurd), dus de volgende agents kunnen niets versturen. Laat iemand beslissen of het omhoog gaat (writes --run <run> --max-writes <aantal>) voordat de volgende fase start`;

/** One line for `session list` and `estimate`: what is left of the budget for sending. */
export const writeBudgetNl = (budget: WriteBudget): string =>
  `nog ${budget.left} van ${budget.max} verzendingen naar ${budget.origin} over voor de hele run (${budget.sent} verstuurd)${spacingNl(budget.spacingSeconds)}${budget.reserved > 0 ? `; ${reservedNl(budget.reserved)}` : ""}${budget.left > 0 && budget.waitSeconds > 0 ? `; de volgende kan over ${budget.waitSeconds} s` : ""}`;

/** What the reserved writes are for, in the words of a task file and of an answer. */
export const reservedNl = (reserved: number): string => `de laatste ${reserved === 1 ? "verzending is" : `${reserved} verzendingen zijn`} voor een criterium of een opdracht van de veegronde die nog niets verstuurde`;

/** The open point an agent writes when what it had to send could not go because the budget, or the share of its criterion, is used up. */
export const budgetOutPointNl = (budget: Pick<WriteBudget, "sent" | "max">): string =>
  budget.sent < budget.max
    ? `versturen niet toegestaan: het budget voor versturen van deze run is op voor dit criterium (${budget.sent} van ${budget.max} verstuurd; de rest is voor criteria die nog niets verstuurden)`
    : `versturen niet toegestaan: het budget voor versturen van deze run is op (${budget.sent} van ${budget.max} verstuurd)`;

export type WriteClaim = { ok: true; entry: PassedWrite } | { ok: false; budget: "out" | "share" | "spacing"; reasonNl: string; turnAt?: number; waitMs?: number };

/**
 * What a browser context needs to let writes through: the origin, and where to note each one.
 * Every write that passes is one line in `writes.jsonl` in the run: method, path and time, never the body.
 */
export interface WriteAccess {
  origin: string;
  /** Every origin that may be written to, `origin` first. */
  origins: string[];
  /** The run and the command or session the access was made for: where the recordings of what a chat answered are kept (see `socketRecordings`). */
  runDir: string;
  source: string;
  /**
   * Take one write from the budget of the run and note it, or refuse it: when the budget is used
   * up, or when the previous write is less than the spacing ago, or another sender waits for its turn
   * before this one. A refused write is not sent, and not waited for here: `claimInTurn` waits. A sender
   * that has sent before is refused the reserved writes. `sender`: the session that sends, when one
   * access serves several; absent, the one the access was made for. `queue`: a sender that is refused
   * only for the spacing takes a place in the queue, so nobody who comes later sends before it.
   */
  claim: (method: string, url: string, options?: { message?: boolean; sender?: string | undefined; link?: string; queue?: boolean }) => WriteClaim;
  /** Note a write that does not count against the budget: a frame over a socket without a test value in it, or the repeat of a request after a redirect. */
  record: (method: string, url: string, options?: { repeat?: boolean; sender?: string | undefined }) => PassedWrite;
}

/**
 * Open a personal link from a mail: the first time in the run it counts as a write, because a link can
 * confirm something by being opened. Every later time is the same request, and is only noted. Null
 * when the link may be opened; the reason when the budget says no.
 */
export function claimLink(access: WriteAccess, url: string, link: string, sender: string | undefined): Extract<WriteClaim, { ok: false }> | null {
  if (linkOpenedBefore(access, url, link, sender)) return null;
  const claim = access.claim("GET", url, { sender, link });
  return claim.ok ? null : claim;
}

/** The same as `claimLink`, but a link held back only for the spacing waits for its turn until `until` (see `claimInTurn`). */
export async function claimLinkInTurn(access: WriteAccess, url: string, link: string, sender: string | undefined, until: number | null): Promise<Extract<WriteClaim, { ok: false }> | null> {
  if (linkOpenedBefore(access, url, link, sender)) return null;
  const claim = await claimInTurn(access, "GET", url, { sender, link }, until);
  return claim.ok ? null : claim;
}

/** A personal link opened before in the run is the same request again: only noted. */
function linkOpenedBefore(access: WriteAccess, url: string, link: string, sender: string | undefined): boolean {
  if (!readLog(access.runDir).some((entry) => entry.link === link)) return false;
  access.record("GET", url, { repeat: true, sender });
  return true;
}

/** How long before its turn a waiting sender asks again: the clocks of two processes are the same clock, but a timer may fire early. */
const TURN_MARGIN_MS = 50;

/** A clock time for in a sentence, such as 14:03:20. */
const clockNl = (at: number): string => new Date(at).toTimeString().slice(0, 8);

/**
 * Take one write, and when only the spacing holds it back, wait for the turn of this sender instead of
 * losing the write. Senders that wait go in the order they came (see `WRITES_QUEUE`): with several
 * sessions that send, retrying later lets another one take every free moment, and waiting in a queue does
 * not. The budget itself is as strict as in `claim`: "out" and "share" are refused at once. Without
 * `until` nothing waits, as in `claim`. A turn that does not come before `until` is refused, but stays kept
 * for `TURN_KEPT_MS` after it, and the reason says when to do the action again.
 */
export async function claimInTurn(access: WriteAccess, method: string, url: string, options: { message?: boolean; sender?: string | undefined; link?: string }, until: number | null): Promise<WriteClaim> {
  if (until === null) return access.claim(method, url, options);
  for (;;) {
    const claim = access.claim(method, url, { ...options, queue: true });
    if (claim.ok || claim.budget !== "spacing" || claim.waitMs === undefined) return claim;
    const wake = Date.now() + claim.waitMs + TURN_MARGIN_MS;
    if (wake > until) {
      const seconds = Math.max(1, Math.ceil(claim.waitMs / 1000));
      return { ...claim, reasonNl: `${claim.reasonNl}. Binnen de tijd van dit commando kwam deze verzending niet aan de beurt. De beurt is vastgehouden: over ${seconds} s (om ${clockNl(Date.now() + claim.waitMs)}) kan het, en tot ${TURN_KEPT_MS / 1000} s daarna gaat niemand anders voor` };
    }
    await new Promise((resolve) => setTimeout(resolve, wake - Date.now()));
  }
}

/**
 * Until when a sender may wait for its turn to send, by the command it runs: set by the session process
 * at the start of a command, so a wait stays inside the time limit of that command. Absent: it does not wait.
 */
const sendDeadlines = new Map<string, number>();

export function setSendDeadline(sender: string, until: number | null): void {
  if (until === null) sendDeadlines.delete(sender);
  else sendDeadlines.set(sender, until);
}

/** A navigation also has the time limit of the browser to load the page in (45 s): it waits for its turn this long at most, so the page still has time to come. */
export const NAVIGATION_TURN_WAIT_MS = 25_000;

/** Until when a write of this sender may wait for its turn, or null when it does not wait. */
export function sendDeadlineOf(sender: string | undefined, navigation = false): number | null {
  const until = sender === undefined ? undefined : sendDeadlines.get(sender);
  if (until === undefined) return null;
  return navigation ? Math.min(until, Date.now() + NAVIGATION_TURN_WAIT_MS) : until;
}

/** The guarded addresses this run opened, by their id. With `besides`, what that sender opened does not count. */
export const usedLinks = (runDir: string, besides?: string): Set<string> => new Set(readLog(runDir).flatMap((entry) => (entry.link && entry.source !== besides ? [entry.link] : [])));

const LOCK = "writes.lock";
/** A lock older than this was left behind by a process that stopped while it held it. */
const STALE_LOCK_MS = 10_000;
/** The same for work that waits for a server: it holds the lock longer, and others wait without stopping their process. */
const STALE_ASYNC_LOCK_MS = 120_000;
const ASYNC_LOCK_POLL_MS = 25;

/** Try once to take a lock. One that is older than `staleMs`, or that `force` says to stop waiting for, is taken away first; the next try gets it. */
function takeLock(path: string, staleMs: number, force = false): boolean {
  try {
    mkdirSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let age = 0;
  try {
    age = Date.now() - statSync(path).mtimeMs;
  } catch {
    // Gone in between: try again at once.
  }
  if (age > staleMs || force) rmSync(path, { recursive: true, force: true });
  return false;
}

/** A lock like `withLock` around work that awaits something. While the work runs, the lock stays young. */
export async function withAsyncLock<T>(runDir: string, name: string, work: () => Promise<T>): Promise<T> {
  const path = join(runDir, name);
  while (!takeLock(path, STALE_ASYNC_LOCK_MS)) await new Promise((resolve) => setTimeout(resolve, ASYNC_LOCK_POLL_MS));
  const keepYoung = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      // Taken away after all: the work goes on, and the next write says what happened.
    }
  }, STALE_ASYNC_LOCK_MS / 4);
  keepYoung.unref();
  try {
    return await work();
  } finally {
    clearInterval(keepYoung);
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * Hold the lock on the log of writes of a run while `work` runs. The sessions of a run share one
 * process, but the sweep runs in processes of its own: two of them must not both take the last write.
 * The work is a read and an append of one line, so the wait is short and done in place.
 */
export function withLock<T>(runDir: string, work: () => T, name: string = LOCK): T {
  const path = join(runDir, name);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 0; !takeLock(path, STALE_LOCK_MS, tries > 400); tries++) Atomics.wait(pause, 0, 0, 5);
  try {
    return work();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

export function writeAccess(runDir: string, permission: WritePermission, source: string, now: () => number = Date.now): WriteAccess {
  const append = (method: string, url: string, repeat: boolean, message = false, sender = source, link?: string): PassedWrite => {
    const entry: PassedWrite = { at: new Date(now()).toISOString(), source: sender, method, path: new URL(url).pathname, ...(permission.alsoOrigins || permission.alsoGrants ? { origin: new URL(url).origin } : {}), ...(repeat ? { repeat: true as const } : {}), ...(message ? { message: true as const } : {}), ...(link ? { link } : {}), ...(sender === CLEANUP_SENDER && !repeat ? { cleanup: true as const } : {}) };
    mkdirSync(runDir, { recursive: true });
    // Appended at once and synchronously: the line is there even when the run is cut off right after.
    appendFileSync(join(runDir, WRITES_LOG), `${JSON.stringify(entry)}\n`);
    return entry;
  };
  return {
    origin: permission.origin,
    origins: writeOriginsOf(permission),
    runDir,
    source,
    record: (method, url, options) => append(method, url, options?.repeat === true, false, options?.sender),
    claim: (method, url, options) => {
      mkdirSync(runDir, { recursive: true });
      const sender = options?.sender ?? source;
      return withLock(runDir, (): WriteClaim => {
        // Each grant has a budget and a pause of its own: a form on this machine does not wait for the chat that was declared next to it.
        const { budget, turn, grant } = budgetAndQueue(runDir, permission, now(), sender, grantFor(permission, url).origin);
        const free = sender === CLEANUP_SENDER;
        const ticket = (entry: Ticket): boolean => entry.sender === sender && entry.origin === grant;
        // A sender the budget refuses has nothing to wait for any more: whoever waits behind it goes on.
        if (!free && budget.left === 0 && turn.holds) writeQueue(runDir, turn.kept.filter((entry) => !ticket(entry)));
        if (!free && budget.left === 0 && budget.sent < budget.max) return { ok: false, budget: "share", reasonNl: `${senderOf(sender) === sender ? sender : "dit criterium"} heeft al verstuurd, en er zijn nog ${budget.max - budget.sent} van ${budget.max} verzendingen naar ${budget.origin} over: ${reservedNl(budget.reserved)}` };
        if (!free && budget.left === 0) return { ok: false, budget: "out", reasonNl: `het budget voor versturen van deze run is op: ${budget.sent} van ${budget.max} verzendingen naar ${budget.origin} zijn gedaan, door alle sessies en de veegronde samen` };
        if (budget.waitSeconds > 0) {
          if (options?.queue && !turn.holds) writeQueue(runDir, [...turn.kept, { sender, origin: grant }]);
          const waitMs = Math.max(0, turn.at - now());
          const after = budget.ahead ? `, na ${budget.ahead === 1 ? "een verzending die" : `${budget.ahead} verzendingen die`} al eerder ${budget.ahead === 1 ? "wachtte" : "wachtten"}` : "";
          return { ok: false, budget: "spacing", reasonNl: `te kort na de vorige verzending: tussen twee verzendingen zit minstens ${budget.spacingSeconds} s; versturen kan weer over ${budget.waitSeconds} s${after} (nog ${budget.left} van ${budget.max} over)`, turnAt: turn.at, waitMs };
        }
        if (existsSync(join(runDir, WRITES_QUEUE))) writeQueue(runDir, turn.kept.filter((entry) => !ticket(entry)));
        return { ok: true, entry: append(method, url, false, options?.message === true, sender, options?.link) };
      });
    },
  };
}

/** Whether a request or socket goes to an origin that may be written to. A socket counts by the origin of its http(s) twin. */
export function isWriteOrigin(access: WriteAccess | null | undefined, url: string): boolean {
  const origin = access ? writeOriginOf(url) : null;
  return origin !== null && access!.origins.includes(origin);
}
