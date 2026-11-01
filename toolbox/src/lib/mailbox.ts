import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import { isFor, parseMail, type ParsedMail } from "./mailparse.ts";
import { imapMailbox } from "./mailbox-imap.ts";
import { mailpitMailbox } from "./mailbox-mailpit.ts";
import { confirmByTyping, processTerminal, type Terminal } from "./recorded.ts";
import { CLEANUP_SENDER, isThisMachine, senderOf, usedLinks, writeOriginsNl, writeOriginsOf, type WritePermission } from "./writes.ts";

/**
 * A mailbox lets a run finish a flow that goes through an e-mail: wait for a message to the address
 * of the run, take the text and the links from it, delete it. Two kinds behind one interface: IMAP
 * for any real mailbox, and the REST API of Mailpit for a site that runs on this machine. A mail is
 * untrusted input: code handles it, a language model never gets it (see `commands/mail.ts`).
 * The mailbox is fixed at `inventory`, with the permission to send, which it needs: following a link
 * from a mail counts as sending.
 */

/** Where the mailbox is. The user name and password are never here: they come from the environment or the keychain, for each command again. */
export interface MailServer {
  kind: "imap" | "mailpit";
  host: string;
  port: number;
  tls: boolean;
}

export type MailboxKind = MailServer["kind"];

/** The kinds of secret a mail brings. */
export const MAIL_ADDRESS_SOURCE = "mail-adres";
export const MAIL_LINK_SOURCE = "mail-link";
export const MAIL_CODE_SOURCE = "mail-code";
/** The registration all agents share, the first of a run. */
export const SHARED_REGISTRATION = "A0";
/** Under this name the mailbox keeps where it is, in the register: that is told nowhere. */
export const MAIL_PRIVATE = "mailbox";

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
  /** Origins of another party that a link in a mail may lead through, such as a mailing service. Declared at inventory: only a redirect to the site is read there. */
  linkOrigins?: string[];
}

export const MAILBOX_ENV = { user: "LOEP_IMAP_USER", password: "LOEP_IMAP_PASSWORD", address: "LOEP_IMAP_ADDRESS" } as const;
/** The name under which the keychain of macOS holds the login of a host. */
export const keychainService = (host: string): string => `loep-imap-${host}`;

const FORM_NL = "--mailbox verwacht imap://<host>:993 of mailpit://localhost:8025";

/**
 * Decide from `--mailbox` where the mailbox of this run is. Throws, in Dutch. The value itself never
 * comes back in a message: somebody may have typed a password in it.
 */
export function decideMailbox(text: string, permission: WritePermission | null, now = new Date(), linkOrigins: readonly string[] = []): { server: MailServer; mark: MailboxMark } {
  if (!permission) throw new Error("--mailbox hoort bij een run die mag versturen: een link uit een e-mail openen telt als versturen. Geef het samen met --allow-writes, of met --test-environment en --declared-by");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(FORM_NL);
  }
  if (url.username || url.password) throw new Error(`zet geen gebruikersnaam of wachtwoord in --mailbox: een opdrachtregel blijft staan in de geschiedenis van de shell. Ze komen uit de omgeving (${MAILBOX_ENV.user}, ${MAILBOX_ENV.password}) of uit de sleutelhanger`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const through = linkOrigins.map((origin) => linkOriginOf(origin, permission));
  const mark = { local: permission.local, declaredAt: now.toISOString(), ...(through.length > 0 ? { linkOrigins: [...new Set(through)] } : {}) };
  if (url.protocol === "mailpit:") {
    if (!isThisMachine(host)) throw new Error("mailpit:// is alleen voor deze machine: de REST-API van Mailpit heeft hier geen inlog. Gebruik imap:// voor een andere mailbox");
    if (!permission.local) throw new Error("Mailpit vangt alleen mail van een site op deze machine; deze run verstuurt naar een site die niet lokaal is. Gebruik imap://");
    return { server: { kind: "mailpit", host, port: Number(url.port || 8025), tls: false }, mark: { kind: "mailpit", ...mark } };
  }
  if (url.protocol !== "imap:") throw new Error(FORM_NL);
  const port = Number(url.port || 993);
  if (!isThisMachine(host) && port !== 993) throw new Error("imap:// naar een andere machine kan alleen op poort 993, met TLS: anders gaan de inloggegevens onversleuteld over het netwerk");
  return { server: { kind: "imap", host, port, tls: port === 993 }, mark: { kind: "imap", ...mark } };
}

/** The origin of `--mail-link-origin`. A token goes there, so not over plain http, except on this machine. */
function linkOriginOf(text: string, permission: WritePermission): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`--mail-link-origin verwacht een adres met https://, niet "${text}"`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isThisMachine(url.hostname))) throw new Error(`--mail-link-origin verwacht een adres met https://, niet "${text}"`);
  if (writeOriginsOf(permission).includes(url.origin)) throw new Error(`${url.origin} is al een origin van de run: daarvoor is --mail-link-origin niet nodig`);
  return url.origin;
}

/**
 * A mailbox that is not on this machine holds real mail, so only a person connects it: at an
 * interactive terminal, by typing the host, like the declaration for sending. Without one it is
 * refused before anything starts.
 */
export async function confirmMailbox(decided: { server: MailServer; mark: MailboxMark }, permission: WritePermission, terminal: Terminal = processTerminal()): Promise<MailboxMark> {
  if (isThisMachine(decided.server.host)) return decided.mark;
  const shownNl = [`Verklaring dat deze run de mailbox op ${decided.server.host} mag lezen, en daarin alleen mail aan het adres van de run.`, `Links uit die mail worden alleen gevolgd naar ${writeOriginsNl(permission)}${decided.mark.linkOrigins ? `, ook via ${decided.mark.linkOrigins.join(" en ")} als de doorverwijzing daar eindigt` : ""}. Elke link telt als verzending.`, "Het rapport noemt de soort mailbox, niet het adres of de inloggegevens."].join("\n");
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
  return tagged(server, env[MAILBOX_ENV.address], () => mailCredentials(server, env).user);
}

/** An address for a registration of its own, next to the address of the run: at a real mailbox the same box, with a label of its own. No login is needed for it. */
export const ownAddress = (server: MailServer, shared: string): string => tagged(server, undefined, () => shared.replace(/\+[^@]*@/, "@"));

function tagged(server: MailServer, fixed: string | undefined, base: () => string): string {
  const tag = `loep-${randomBytes(4).toString("hex")}`;
  if (server.kind === "mailpit") return `${tag}@example.com`;
  if (fixed) return fixed;
  const user = base();
  const at = user.lastIndexOf("@");
  if (at <= 0) throw new Error(`de gebruikersnaam van de mailbox is geen e-mailadres: zet het adres van de run in ${MAILBOX_ENV.address}`);
  // In small letters: a site writes an address like that, and the swap goes by the letter.
  return `${user.slice(0, at)}+${tag}${user.slice(at)}`.toLowerCase();
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

export type LinkKind = "confirm" | "preferences" | "unsubscribe" | "other";

export interface MailboxLink {
  id: string;
  /** With aliases in it: this is what a session opens. */
  url: string;
  kind: LinkKind;
  /** The registration whose mail it came from. Absent: the shared one. */
  registration?: string;
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

/** `unused`: a registration of its own that never went to the site, so there is nothing to remove. */
export type SiteCleanup = "removed" | "not shown" | "failed" | "no link" | "unused";

export interface SiteOutcome {
  outcome: SiteCleanup;
  noteNl: string;
  steps: CleanupStep[];
}

/** What a cleanup did at the site for one registration. */
export interface RegistrationCleanup extends SiteOutcome {
  registration: string;
}

export interface MailboxCleanup {
  at: string;
  /** Per registration, the shared one first. */
  sites: RegistrationCleanup[];
  /** `left`: what the last look found. `marked`: what the server only marked as deleted. `checkedAt`: the moment of that look; mail after it is not seen. */
  mail: { removed: number; left: number | null; marked?: number; checkedAt?: string; noteNl: string | null };
  /** `noteNl`: why the run could not be searched. */
  scan: { files: number; bytes: number; hits: { file: string; secret: number; source?: string }[]; compressed: number; noteNl?: string };
  /** Every test registration is shown to be gone, the mail is gone, also from the server, and no secret stands in the run. */
  complete: boolean;
}

/**
 * One test registration at the site, with an address of its own. The first is shared by all agents, and
 * stays for looking. A session that has to change or remove a registration asks for one of its own.
 */
export interface Registration {
  id: string;
  /** The sender it belongs to (see `senderOf`). Absent: shared by all. */
  owner?: string;
  /** What the browser has for its address; an own registration only: the shared one has the test value. */
  alias?: string;
  /**
   * How many of its links there were when the site was asked to remove it. Noted before it is asked, so
   * also a run that broke off right then keeps to it: what came in later is read, and never opened,
   * because a site says goodbye with a mail that can hold a link that registers anew.
   */
  askedLinks?: number;
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
  /** The shared registration first, then those of sessions. */
  registrations: Registration[];
  cleanup?: MailboxCleanup;
}

/** The links of one registration. */
export const linksOfRegistration = (state: Pick<MailboxState, "links">, id: string): MailboxLink[] => state.links.filter((link) => (link.registration ?? SHARED_REGISTRATION) === id);

/** The registration of its own a sender has, the latest when it has more. */
export const ownRegistration = (state: Pick<MailboxState, "registrations">, session: string | undefined): Registration | null => (session === undefined ? null : (state.registrations.filter((registration) => registration.owner === senderOf(session)).at(-1) ?? null));

/**
 * The kind of a link by the words in its path and in its text in the mail, with fixed code: no language
 * model reads a mail. A mail is untrusted input, so the most careful reading counts: a word for leaving
 * in either of the two makes it a link that unsubscribes, whatever the other says. A confirmation goes
 * before preferences: it does something by being opened, also under a path for managing things.
 */
export function linkKind(path: string, text = ""): LinkKind {
  const words = `${path}\n${text}`;
  if (/afmeld|uitschrij|opzeg|unsubscribe|opt-?out|verwijder|delete|remove/i.test(words)) return "unsubscribe";
  if (/bevestig|confirm|verif|activ/i.test(words)) return "confirm";
  if (/voorkeur|preference|instelling|beheer|manage|profiel|profile/i.test(words)) return "preferences";
  return "other";
}

/** A kind of link that says it does not end a registration: only those go to agents on the shared one. */
export const keepsRegistration = (kind: LinkKind): boolean => kind === "confirm" || kind === "preferences";

export function mailboxForRun(runDir: string): MailboxMark | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, "utf8")) as { mailbox?: MailboxMark }).mailbox ?? null;
}

export async function recordMailbox(runDir: string, mark: MailboxMark): Promise<void> {
  const path = join(runDir, "manifest.json");
  await writeJson(path, { ...(existsSync(path) ? await readJson<Record<string, unknown>>(path) : {}), mailbox: mark });
}

/** The state of a run from before a run could have more than one registration. */
type OldState = Omit<MailboxState, "registrations" | "cleanup"> & { registrations?: Registration[]; askedLinks?: number; cleanup?: Omit<MailboxCleanup, "sites"> & { sites?: RegistrationCleanup[]; site?: SiteOutcome } };

export function readMailboxState(runDir: string): MailboxState | null {
  const path = join(runDir, MAILBOX_STATE);
  if (!existsSync(path)) return null;
  const { askedLinks, cleanup, ...rest } = JSON.parse(readFileSync(path, "utf8")) as OldState;
  const { site, ...kept } = cleanup ?? {};
  const shared = { id: SHARED_REGISTRATION, ...(askedLinks === undefined ? {} : { askedLinks }) };
  return { ...rest, registrations: rest.registrations ?? [shared], ...(cleanup ? { cleanup: { ...kept, sites: cleanup.sites ?? (site ? [{ registration: SHARED_REGISTRATION, ...site }] : []) } as MailboxCleanup } : {}) };
}

export const writeMailboxState = async (runDir: string, state: MailboxState): Promise<void> => {
  await writeJson(join(runDir, MAILBOX_STATE), state);
};

const LABEL_NL: Record<MailboxKind, string> = { imap: "een echte mailbox (IMAP)", mailpit: "Mailpit, dat mail op deze machine opvangt" };

/** A reader of the report could take the mail to be part of the evaluation: it is not. */
export const MAIL_NOT_JUDGED_NL = "De e-mail zelf is niet beoordeeld. Code haalde de links uit de mail en wiste de mail daarna. Geen agent heeft de mail gezien, en geen van de criteria gaat over de mail. Dit rapport zegt dus niets over de toegankelijkheid van de e-mail die de site stuurt.";

/** For the limitations of the report: which kind of mailbox, never its address, and what stayed behind. Empty for a run without a mailbox. */
export function mailboxLimitationsNl(runDir: string): string[] {
  const mark = mailboxForRun(runDir);
  if (!mark) return [];
  const state = readMailboxState(runDir);
  // Opening a link to clean up is no looking at the page: that says what a run measured.
  const used = usedLinks(runDir, CLEANUP_SENDER).size > 0;
  const kindNl = `Mailbox: ${used ? "pagina's achter een persoonlijke link uit een e-mail zijn bekeken met" : "er was aangesloten:"} ${LABEL_NL[mark.kind]}${used ? "" : ", maar er is geen persoonlijke link uit een e-mail gebruikt"}. Het adres en de inloggegevens staan niet in dit rapport.${mark.linkOrigins ? ` Links in de mail liepen via ${mark.linkOrigins.join(" en ")}: daar is alleen de doorverwijzing naar de site gelezen.` : ""}${mark.local ? " De meting is lokaal gedaan, op een site op deze machine, en niet op productie: wat de echte mailroute doet, is niet gemeten." : ""}`;
  return [kindNl, MAIL_NOT_JUDGED_NL, cleanupNl(state)];
}

/** Nothing of this registration stands at the site, as far as can be shown. */
export const siteDone = (site: Pick<SiteOutcome, "outcome">): boolean => site.outcome === "removed" || site.outcome === "unused";

function cleanupNl(state: MailboxState | null): string {
  const cleanup = state?.cleanup;
  if (!cleanup) return "Opruimen: niet gedaan. Er kan een testaanmelding op de site en e-mail in de mailbox zijn achtergebleven.";
  const checked = cleanup.mail.checkedAt ? ` Dat is voor het laatst nagegaan op ${cleanup.mail.checkedAt}: wat de site daarna nog stuurde, staat er misschien nog.` : "";
  const removed = cleanup.sites.filter((site) => site.outcome === "removed").length;
  if (cleanup.complete) return `Opruimen: ${removed === 1 ? "de testaanmelding is" : `de ${removed} testaanmeldingen zijn`} via de site zelf verwijderd, en dat is nagegaan; de e-mail is gewist, en de mailbox bevatte niets meer voor dit onderzoek.${checked} Het bewijs staat in ${MAILBOX_STATE}.`;
  const mailGone = cleanup.mail.left === 0 && (cleanup.mail.marked ?? 0) === 0;
  const several = cleanup.sites.length > 1;
  const behind = [...cleanup.sites.filter((site) => !siteDone(site)).map((site) => `op de site${several ? ` (aanmelding ${site.registration})` : ""}: ${site.noteNl}`), mailGone ? null : `in de mailbox: ${cleanup.mail.noteNl ?? "er staat nog e-mail"}`, cleanup.scan.hits.length > 0 ? `in de run: een geheim staat in ${[...new Set(cleanup.scan.hits.map((hit) => (hit.source ? `${hit.file} (${hit.source})` : hit.file)))].join(", ")}` : null, cleanup.scan.noteNl ? `in de run: ${cleanup.scan.noteNl}` : null].filter(Boolean);
  return `Er bleef iets achter na het opruimen, ${behind.join("; ")}.${checked} Wie over de site of de mailbox gaat, moet dat nog weghalen.`;
}

/**
 * What an agent has to know in a run with a mailbox, for its task file. Empty for a run without: a
 * task of such a run is then byte for byte what it was. It holds no address: a task is hashed, and a
 * verdict stands on that hash, so a mail that comes in later may not change it. An agent asks for the
 * links as they are with `askLinks`, the command for this run.
 */
export function agentMailboxNl(runDir: string, mail: string, run: string): string {
  if (!mailboxForRun(runDir) || !readMailboxState(runDir)) return "";
  const asked = `\`${mail} links --run ${run} --session <je sessie>\``;
  return `\n\n**Deze run heeft pagina's achter een persoonlijke link uit een e-mail.** De adressen staan niet in deze opdracht, want er kan mail bijkomen. Vraag ze op met ${asked}: onder \`links\` staan de adressen die de run nog niet opende. Een link van de gedeelde aanmelding krijg je alleen als uit de mail blijkt dat hij haar niet beëindigt. Open die met \`open\`, ook een bevestiging als de procedure dat vraagt. Onder \`used\` staan adressen die de run al opende: open die ook, dat kost niets. Zo'n link kan na gebruik vervallen zijn, en dan is dat wat je vastlegt. Standaard delen alle agents één testaanmelding, dus wat een eerdere agent zag, kan voor jou verlopen zijn. Dat weerlegt niets: laat een bevinding of kandidaat niet vervallen omdat een persoonlijke link niet meer werkt, maar zet wat je niet kon herhalen als \`proef werkte niet:\` onder \`missingNl\`. Zijn beide lijsten leeg, dan is er geen pagina achter een link om te bekijken. De code in zo'n adres is een vervanging: de echte code krijg je niet te zien en heb je niet nodig. Een waarneming noemt dit adres, en dat is goed zo. De eerste keer dat de run een link opent, telt als verzending. Afmelden, opzeggen en verwijderen van de gedeelde aanmelding doet alleen de opruimstap aan het eind van de run (\`mail cleanup\`), want daarna heeft geen agent haar nog. Druk zulke knoppen op een pagina van de gedeelde aanmelding dus niet in en bevestig ze niet, ook niet als de procedure dat vraagt. Vraagt de procedure dat wel, of moet je iets wijzigen of zien wat pas daarna komt, vraag dan een eigen aanmelding met \`${mail} register --run ${run} --session <je sessie>\`. Dat verstuurt nog niets, maar de route kost budget: het formulier, de bevestiging en het afmelden of verwijderen tellen elk als verzending, met de wachttijd ertussen die de sessie noemt. Doe het dus alleen als het niet anders kan. In je sessie gaat de testwaarde \`email\` daarna naar je eigen adres: vul het formulier van de site in en verstuur het, en haal je links met \`${mail} wait --run ${run} --session <je sessie>\`. Een link met \`own: true\` hoort bij jouw aanmelding: daar mag je alles, ook afmelden en verwijderen, en de opruimstap ruimt op wat overblijft. Weigert \`register\` omdat het budget te krap is, bekijk en meet de knop dan zonder hem in te drukken, en zet wat pas daarna te zien is als \`proef werkte niet:\` onder \`missingNl\`. Lees de e-mail zelf niet: \`mailbox/\` in de run is voor wie het onderzoek leidt.`;
}
