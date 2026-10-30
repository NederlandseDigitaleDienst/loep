import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import { isFor, parseMail, type ParsedMail } from "./mailparse.ts";
import { imapMailbox } from "./mailbox-imap.ts";
import { mailpitMailbox } from "./mailbox-mailpit.ts";
import { confirmByTyping, processTerminal, type Terminal } from "./recorded.ts";
import type { MailServer } from "./shield.ts";
import { isLocalHost, writeOriginsNl, type WritePermission } from "./writes.ts";

/**
 * A mailbox lets a run finish a flow that goes through an e-mail: wait for a message to the address
 * of the run, take the text and the links from it, delete it. Two kinds behind one interface: IMAP
 * for any real mailbox, and the REST API of Mailpit for a site that runs on this machine. A mail is
 * untrusted input: code handles it, a language model never gets it (see `commands/mail.ts`).
 * The mailbox is fixed at `inventory`, with the permission to send, which it needs: following a link
 * from a mail counts as sending.
 */

export type MailboxKind = MailServer["kind"];

/** One message as the server has it. */
export interface RawMail {
  /** What the server knows the message by; only for deleting it. */
  id: string;
  receivedAt: number;
  raw: Buffer;
}

export interface Mailbox {
  kind: MailboxKind;
  /** The messages since a moment that may be for an address. A server may find too much: `waitForMail` looks again. */
  fetch: (address: string, since: Date) => Promise<RawMail[]>;
  /** Delete messages. Says how many. */
  remove: (ids: string[]) => Promise<number>;
  /** Messages for an address that are deleted in name only: a server may keep them until somebody empties the box. Absent where deleting is deleting. */
  marked?: (address: string, since: Date) => Promise<RawMail[]>;
}

export interface MailCredentials {
  user: string;
  password: string;
}

/** What a run says about its mailbox in its manifest. No address, no host and no login: those are no part of what is shared. */
export interface MailboxMark {
  kind: MailboxKind;
  /** The run sends to a site on this machine. */
  local: boolean;
  declaredAt: string;
  /** A mailbox that is not on this machine was confirmed by a person, at a terminal. */
  recordedVia?: "terminal";
}

export const MAILBOX_ENV = { user: "LOEP_IMAP_USER", password: "LOEP_IMAP_PASSWORD", address: "LOEP_IMAP_ADDRESS" } as const;
/** The name under which the keychain of macOS holds the login of a host. */
export const keychainService = (host: string): string => `loep-imap-${host}`;

const FORM_NL = "--mailbox verwacht imap://<host>:993 of mailpit://localhost:8025";

/**
 * Decide from `--mailbox` where the mailbox of this run is. Throws, in Dutch. The value itself never
 * comes back in a message: somebody may have typed a password in it.
 */
export function decideMailbox(text: string, permission: WritePermission | null, now = new Date()): { server: MailServer; mark: MailboxMark } {
  if (!permission) throw new Error("--mailbox hoort bij een run die mag versturen: een link uit een e-mail openen telt als versturen. Geef het samen met --allow-writes, of met --test-environment en --declared-by");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(FORM_NL);
  }
  if (url.username || url.password) throw new Error(`zet geen gebruikersnaam of wachtwoord in --mailbox: een opdrachtregel blijft staan in de geschiedenis van de shell. Ze komen uit de omgeving (${MAILBOX_ENV.user}, ${MAILBOX_ENV.password}) of uit de sleutelhanger`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const mark = { local: permission.local, declaredAt: now.toISOString() };
  if (url.protocol === "mailpit:") {
    if (!isLocalHost(host)) throw new Error("mailpit:// is alleen voor deze machine: de REST-API van Mailpit heeft hier geen inlog. Gebruik imap:// voor een andere mailbox");
    if (!permission.local) throw new Error("Mailpit vangt alleen mail van een site op deze machine; deze run verstuurt naar een site die niet lokaal is. Gebruik imap://");
    return { server: { kind: "mailpit", host, port: Number(url.port || 8025), tls: false }, mark: { kind: "mailpit", ...mark } };
  }
  if (url.protocol !== "imap:") throw new Error(FORM_NL);
  const port = Number(url.port || 993);
  const local = isLocalHost(host);
  if (!local && port !== 993) throw new Error("imap:// naar een andere machine kan alleen op poort 993, met TLS: anders gaan de inloggegevens onversleuteld over het netwerk");
  return { server: { kind: "imap", host, port, tls: port === 993 }, mark: { kind: "imap", ...mark } };
}

/**
 * A mailbox that is not on this machine holds real mail, so only a person connects it: at an
 * interactive terminal, by typing the host, like the declaration for sending. Without one it is
 * refused before anything starts.
 */
export async function confirmMailbox(decided: { server: MailServer; mark: MailboxMark }, permission: WritePermission, terminal: Terminal = processTerminal()): Promise<MailboxMark> {
  if (isLocalHost(decided.server.host)) return decided.mark;
  const shownNl = [`Verklaring dat deze run de mailbox op ${decided.server.host} mag lezen, en daarin alleen mail aan het adres van de run.`, `Links uit die mail worden alleen gevolgd naar ${writeOriginsNl(permission)}. Elke link telt als verzending.`, "Het rapport noemt de soort mailbox, niet het adres of de inloggegevens."].join("\n");
  return { ...decided.mark, declaredAt: new Date().toISOString(), ...(await confirmByTyping("inventory --mailbox", shownNl, decided.server.host, "de host van de mailbox", terminal)) };
}

function keychainLogin(host: string): MailCredentials | null {
  if (process.platform !== "darwin") return null;
  try {
    const service = keychainService(host);
    const quiet = { encoding: "utf8" as const, stdio: ["ignore" as const, "pipe" as const, "ignore" as const] };
    const password = execFileSync("security", ["find-generic-password", "-s", service, "-w"], quiet).trim();
    const user = /"acct"<blob>="([^"]*)"/.exec(execFileSync("security", ["find-generic-password", "-s", service], quiet))?.[1];
    return user && password ? { user, password } : null;
  } catch {
    return null;
  }
}

/** The login of an IMAP mailbox: from the environment or the keychain, for each command again. It is never written anywhere. */
export function mailCredentials(server: MailServer, env: NodeJS.ProcessEnv = process.env, keychain: (host: string) => MailCredentials | null = keychainLogin): MailCredentials {
  const user = env[MAILBOX_ENV.user];
  const password = env[MAILBOX_ENV.password];
  if (user && password) return { user, password };
  const stored = keychain(server.host);
  if (stored) return stored;
  throw new Error(`geen inloggegevens voor de mailbox: zet ${MAILBOX_ENV.user} en ${MAILBOX_ENV.password} in de omgeving, of bewaar ze in de sleutelhanger met: security add-generic-password -s ${keychainService(server.host)} -a <gebruiker> -w`);
}

export function openMailbox(server: MailServer, env: NodeJS.ProcessEnv = process.env): Mailbox {
  return server.kind === "mailpit" ? mailpitMailbox(server) : imapMailbox(server, mailCredentials(server, env));
}

/**
 * The address of a run. A run reads only its own mail, so it has its own address: at Mailpit a made-up
 * one on a domain that receives nothing, at a real mailbox the one in the environment, or else the
 * login with a tag per run (`naam+loep-1a2b3c4d@example.nl`), which most providers deliver to the same box.
 */
export function runAddress(server: MailServer, env: NodeJS.ProcessEnv = process.env): string {
  const tag = `loep-${randomBytes(4).toString("hex")}`;
  if (server.kind === "mailpit") return `${tag}@example.com`;
  if (env[MAILBOX_ENV.address]) return env[MAILBOX_ENV.address]!;
  const { user } = mailCredentials(server, env);
  const at = user.lastIndexOf("@");
  if (at <= 0) throw new Error(`de gebruikersnaam van de mailbox is geen e-mailadres: zet het adres van de run in ${MAILBOX_ENV.address}`);
  return `${user.slice(0, at)}+${tag}${user.slice(at)}`;
}

export interface WaitOptions {
  address: string;
  since: Date;
  timeoutMs: number;
  pollMs?: number;
  /** Stop after one round, also without a message. */
  once?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReceivedMail {
  id: string;
  receivedAt: number;
  mail: ParsedMail;
}

/** The messages of a list that are for this address, since this moment. `parseMail` never throws, so one broken mail leaves the others alone. */
const oursOf = (found: RawMail[], address: string, since: Date): ReceivedMail[] =>
  found
    .filter((raw) => raw.receivedAt >= since.getTime())
    .map((raw) => ({ id: raw.id, receivedAt: raw.receivedAt, mail: parseMail(raw.raw) }))
    .filter((message) => isFor(message.mail, address));

/** Wait for messages to one address since one moment. What is for another address is not used, and stays where it is. */
export async function waitForMail(mailbox: Mailbox, options: WaitOptions): Promise<ReceivedMail[]> {
  const { address, since, timeoutMs, pollMs = 3000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ours = oursOf(await mailbox.fetch(address, since), address, since);
    if (ours.length > 0 || options.once || Date.now() >= deadline) return ours;
    await sleep(pollMs);
  }
}

/** How many messages for this address are deleted in name only, and so still on the server. */
export const markedMail = async (mailbox: Mailbox, address: string, since: Date): Promise<number> => (mailbox.marked ? oursOf(await mailbox.marked(address, since), address, since).length : 0);

// ---- The run ---------------------------------------------------------------------------------------------------------

/** What is known of a run's mail: no token, no address. In the run, under the seal. */
export const MAILBOX_STATE = "mailbox.json";

export type LinkKind = "bevestigen" | "voorkeuren" | "afmelden" | "overig";

export interface MailboxLink {
  id: string;
  /** With aliases in it: this is what a session opens. */
  url: string;
  kind: LinkKind;
  /** It came from the header for unsubscribing. */
  unsubscribe?: true;
  /** That header allows a POST in one click (RFC 8058). */
  oneClick?: true;
}

export interface CleanupStep {
  /** What was done, in Dutch. */
  whatNl: string;
  /** The path it was done on: the alias is no secret. */
  path?: string;
}

export type SiteCleanup = "verwijderd" | "niet aangetoond" | "mislukt" | "geen link";

export interface MailboxCleanup {
  at: string;
  site: { outcome: SiteCleanup; noteNl: string; steps: CleanupStep[] };
  /** `left`: what the last look found. `marked`: what the server only marked as deleted. `checkedAt`: the moment of that look; mail after it is not seen. */
  mail: { removed: number; left: number | null; marked?: number; checkedAt?: string; noteNl: string | null };
  scan: { files: number; bytes: number; hits: { file: string; secret: number }[]; compressed: number };
  /** The test registration is shown to be gone, the mail is gone, also from the server, and no secret stands in the run. */
  complete: boolean;
}

export interface MailboxState {
  kind: MailboxKind;
  local: boolean;
  /** Mail from before this moment is not for this run. */
  since: string;
  /** Per message that was read: when it came in, the ids of its links, and where its text was kept. */
  messages: { at: string; links: string[]; text: string }[];
  links: MailboxLink[];
  /** Origins of links in a mail that are no part of the permission: never followed. */
  refusedOrigins: string[];
  cleanup?: MailboxCleanup;
}

/** The kind of a link by the words in its path: the mail itself is not asked. */
export function linkKind(path: string): LinkKind {
  if (/afmeld|uitschrij|opzeg|unsubscribe|opt-?out/i.test(path)) return "afmelden";
  if (/voorkeur|preference|instelling|beheer|manage|profiel|profile/i.test(path)) return "voorkeuren";
  if (/bevestig|confirm|verif|activ/i.test(path)) return "bevestigen";
  return "overig";
}

export function mailboxForRun(runDir: string): MailboxMark | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, "utf8")) as { mailbox?: MailboxMark }).mailbox ?? null;
}

export async function recordMailbox(runDir: string, mark: MailboxMark): Promise<void> {
  const path = join(runDir, "manifest.json");
  await writeJson(path, { ...(existsSync(path) ? await readJson<Record<string, unknown>>(path) : {}), mailbox: mark });
}

export function readMailboxState(runDir: string): MailboxState | null {
  const path = join(runDir, MAILBOX_STATE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as MailboxState) : null;
}

export const writeMailboxState = async (runDir: string, state: MailboxState): Promise<void> => {
  await writeJson(join(runDir, MAILBOX_STATE), state);
};

const LABEL_NL: Record<MailboxKind, string> = { imap: "een echte mailbox (IMAP)", mailpit: "Mailpit, dat mail op deze machine opvangt" };

/** For the limitations of the report: which kind of mailbox, never its address, and what stayed behind. Empty for a run without a mailbox. */
export function mailboxLimitationsNl(runDir: string): string[] {
  const mark = mailboxForRun(runDir);
  if (!mark) return [];
  const state = readMailboxState(runDir);
  const used = (state?.links.length ?? 0) > 0;
  const kindNl = `Mailbox: ${used ? "pagina's achter een persoonlijke link uit een e-mail zijn bekeken met" : "er was aangesloten:"} ${LABEL_NL[mark.kind]}${used ? "" : ", maar er is geen persoonlijke link uit een e-mail gebruikt"}. Het adres en de inloggegevens staan niet in dit rapport.${mark.local ? " De meting is lokaal gedaan, op een site op deze machine, en niet op productie: wat de echte mailroute doet, is niet gemeten." : ""}`;
  return [kindNl, cleanupNl(state)];
}

function cleanupNl(state: MailboxState | null): string {
  const cleanup = state?.cleanup;
  if (!cleanup) return "Opruimen: niet gedaan. Er kan een testaanmelding op de site en e-mail in de mailbox zijn achtergebleven.";
  const checked = cleanup.mail.checkedAt ? ` Dat is voor het laatst nagegaan op ${cleanup.mail.checkedAt}: wat de site daarna nog stuurde, staat er misschien nog.` : "";
  if (cleanup.complete) return `Opruimen: de testaanmelding is via de site zelf verwijderd, en dat is nagegaan; de e-mail is gewist, en de mailbox bevatte niets meer voor dit onderzoek.${checked} Het bewijs staat in ${MAILBOX_STATE}.`;
  const mailGone = cleanup.mail.left === 0 && (cleanup.mail.marked ?? 0) === 0;
  const behind = [cleanup.site.outcome === "verwijderd" ? null : `op de site: ${cleanup.site.noteNl}`, mailGone ? null : `in de mailbox: ${cleanup.mail.noteNl ?? "er staat nog e-mail"}`, cleanup.scan.hits.length > 0 ? `in de run: een persoonlijke link staat in ${[...new Set(cleanup.scan.hits.map((hit) => hit.file))].join(", ")}` : null].filter(Boolean);
  return `Er bleef iets achter na het opruimen, ${behind.join("; ")}.${checked} Wie over de site of de mailbox gaat, moet dat nog weghalen.`;
}

/**
 * What an agent has to know in a run with personal links, for its task file. Empty for a run
 * without: a task of such a run is then byte for byte what it was. It holds the addresses with
 * aliases and nothing of the text of a mail.
 */
export function agentMailboxNl(runDir: string): string {
  const state = readMailboxState(runDir);
  if (!mailboxForRun(runDir) || !state || state.links.length === 0) return "";
  const list = state.links.map((link) => `\n- ${link.kind}: \`${link.url}\``).join("");
  return `\n\n**Deze run heeft pagina's achter een persoonlijke link uit een e-mail.** Open ze met \`open\` op deze adressen:${list}\nDe code in zo'n adres is een vervanging: de echte code krijg je niet te zien en heb je niet nodig. Een waarneming noemt dit adres, en dat is goed zo. De eerste keer dat de run een link opent, telt als verzending. Een link kan na gebruik vervallen, en de knop om af te melden of te verwijderen haalt de testaanmelding weg: druk daar niet op, tenzij de procedure dat vraagt. Lees de e-mail zelf niet: \`mailbox/\` in de run is voor wie het onderzoek leidt.`;
}
