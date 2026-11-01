import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { launchBrowser, loadPage, newContext, type LoadResult } from "../browser/session.ts";
import { keepsRegistration, linkKind, linksOfRegistration, MAIL_ADDRESS_SOURCE, MAIL_CODE_SOURCE, MAIL_LINK_SOURCE, MAIL_PRIVATE, MAILBOX_STATE, mailboxForRun, markedMail, openMailbox, ownAddress, ownRegistration, readMailboxState, SHARED_REGISTRATION, siteDone, waitForMail, writeMailboxState, type CleanupStep, type MailServer, type Mailbox, type MailboxCleanup, type MailboxLink, type MailboxMark, type MailboxState, type ReceivedMail, type Registration, type SiteCleanup, type SiteOutcome } from "../lib/mailbox.ts";
import { isLoginPath, loginForRun, onlyLogsOut, originOf, passwordFieldShows } from "../lib/login.ts";
import { pathOf } from "../lib/reads.ts";
import { linksOf, secretsInText, secretsInUrl, spelledSecretsInUrl, withoutLinks } from "../lib/mailparse.ts";
import { refuseUnderSeal } from "../lib/seal.ts";
import { keepPrivate, readPrivate, readSecretsFile, registerGuarded, registerSecret, registerSecrets, scanRun, shieldForRun, type NewSecret, type Shield } from "../lib/secrets.ts";
import { claimRegistration, CLEANUP_SENDER, registrationUsed, senderOf, usedLinks, withAsyncLock, writeBudget, writeOriginsOf, writesForRun, type WritePermission } from "../lib/writes.ts";
import { guardContext, guardRedirects, scopeForRun, TEST_VALUES, type Blocked, type Guard } from "../session/safety.ts";

/*
 * The fixed flow around a mailbox. A mail is untrusted input, so nothing here is a judgment of a
 * language model and nothing of a mail reaches one: code takes the links, keeps those on an origin
 * of the permission, and an agent gets addresses with aliases. The text of a mail is kept for
 * whoever leads the evaluation, without tokens and without addresses of other sites.
 */

export const MAIL_USAGE = `  mail wait --run <run> [--session <s>] [--timeout <s>]
                                         Wait for mail to the address of the run, or with --session to the address of that session
                                         when it has one of its own, take the personal links from it and delete it. Prints the
                                         links with aliases in them, and nothing of the mail itself
  mail cleanup --run <run>               After the measuring, also after a run that broke off: remove the test registration
                                         through the site's own flow, delete the mail and look for tokens in the whole
                                         run. The outcome goes in mailbox.json; non-zero exit when something stayed behind
  mail links --run <run> [--session <s>] The personal links as they are now, with aliases in them: those still to open, and those
                                         the run used, of the shared registration and of the one of that session. Does not open
                                         the mailbox
  mail status --run <run>                What mailbox.json says, without opening the mailbox
  mail register --run <run> --session <s> [--fresh]
                                         A test registration of its own for a session, with an address of its own: the test value
                                         email goes there from now on, and with --session mail wait reads its mail and mail links
                                         shows its links. Sends nothing yet, but refuses when the budget has no room for the
                                         route. Without --fresh a session that has one keeps it
`;

const DEFAULT_WAIT_SECONDS = 120;
/** How long a cleanup goes on looking after the registration is gone: a site confirms that with a mail, and that takes a moment. */
const SETTLE_MS = 20_000;
const SETTLE_POLL_MS = 2000;
/** Each look at IMAP is a login: on a real provider that adds up, and logging in too often gets a machine blocked. */
const IMAP_SETTLE_POLL_MS = 6000;
/** How long a cleanup waits in total for the time between two writes on a test environment. */
const MAX_BUDGET_WAIT_MS = 300_000;
const REMOVE_NAME = /afmeld|uitschrij|verwijder|opzeg|unsubscribe|remove|delete/i;
/** A button without the personal code says what it removes, or nothing else than that it removes: `Verwijder filter` on a page of a site is something else altogether. */
const ABOUT_REGISTRATION = /afmeld|uitschrij|opzeg|unsubscribe|aanmelding|abonnement|inschrijving|nieuwsbrief|e-?mail-?update|subscription|mailing|^\W*(?:verwijder(?:en)?|remove|delete)(?:\s+(?:mij|me|alles|mijn (?:gegevens|adres)))?\W*$/i;
/** Never anything of this kind, whatever else it says. */
const NOT_THE_REGISTRATION = /\baccount\b/i;
/** A link on a page of a site that leads to signing up: never what cleaning up is looking for. */
const SIGNS_UP = /aanmeld|inschrijv|(?<!un)subscribe/i;
const REMOVES_BY_PATH = /afmeld|uitschrij|verwijder|opzeg|unsubscribe|remove|delete/i;
/** In Dutch this is how a person leaves a mailing list, and how a person logs out: by itself this name says neither. */
const ONLY_AFMELDEN = /^\W*(?:afmelden|meld (?:je|u) af)\W*$/i;
/** Pages a cleanup looks at, to find the button that removes the registration. */
const MAX_CLEANUP_PAGES = 8;
/** How often one cleanup goes to the site, when a link only came in later. */
const MAX_SITE_ROUNDS = 3;
const MAILBOX_LOCK = "mailbox.lock";

/** Fix the mailbox at `inventory`: the secrets in their own file, what may be told in `mailbox.json`. */
export async function startMailbox(runDir: string, server: MailServer, address: string, mark: MailboxMark, permission: WritePermission): Promise<void> {
  // A second inventory on the same run: its address has mail under way, and its links are in use.
  if (readMailboxState(runDir) && readSecretsFile(runDir)?.secrets.some((secret) => secret.source === MAIL_ADDRESS_SOURCE)) return;
  keepPrivate(runDir, MAIL_PRIVATE, server);
  registerSecret(runDir, address, { source: MAIL_ADDRESS_SOURCE, origins: writeOriginsOf(permission), alias: TEST_VALUES.email! });
  await writeMailboxState(runDir, { kind: mark.kind, local: mark.local, since: mark.declaredAt, messages: [], links: [], refusedOrigins: [], registrations: [{ id: SHARED_REGISTRATION }] });
}

/** What the fixed flow knows of the mailbox of a run. Only here are the addresses taken from the register. */
interface MailContext {
  server: MailServer;
  addressOf: (registration: Registration) => string;
  /** The origins the links of a mail may lead to. */
  origins: string[];
  state: MailboxState;
}

function stateOfMailbox(runDir: string): MailboxState {
  const state = readMailboxState(runDir);
  if (!mailboxForRun(runDir) || !state) throw new Error("deze run heeft geen mailbox: die ligt vast bij inventory (--mailbox)");
  return state;
}

function requireMailbox(runDir: string): MailContext {
  const state = stateOfMailbox(runDir);
  const entries = (readSecretsFile(runDir)?.secrets ?? []).filter((secret) => secret.source === MAIL_ADDRESS_SOURCE);
  const server = readPrivate<MailServer>(runDir, MAIL_PRIVATE);
  if (entries.length === 0 || !server) throw new Error("het register met de geheimen van de mailbox ontbreekt, dus de links zijn niet meer te openen en het adres van de run is onbekend");
  const addressOf = (registration: Registration): string => {
    // The register is read here, each time: a session takes a registration while another command runs.
    const entry = registration.alias === undefined ? entries[0] : readSecretsFile(runDir)?.secrets.find((secret) => secret.alias === registration.alias);
    if (!entry) throw new Error(`het adres van aanmelding ${registration.id} staat niet in het register met de geheimen`);
    return entry.real;
  };
  return { server, addressOf, origins: entries[0]!.origins, state };
}

export interface RegisterResult {
  registration: string;
  /** The test value `email` of this session: the alias of its address. */
  email: string;
  /** False: the session had one, and this is it. */
  fresh: boolean;
  noteNl: string;
}

/**
 * A test registration of its own for a session. Nothing goes to the site here: the session fills in the
 * form, with the test value `email`, and that and what follows takes from the budget like any write.
 * Whoever verifies or finishes a criterion is the same sender as its judge, so it finds the same registration.
 */
export async function mailRegister(runDir: string, session: string, options: { fresh?: boolean } = {}): Promise<RegisterResult> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, addressOf, origins, state } = requireMailbox(runDir);
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen, en een eigen aanmelding bestaat alleen uit verzendingen");
  const answer = (registration: Registration, fresh: boolean): RegisterResult => ({ registration: registration.id, email: registration.alias!, fresh, noteNl: "de testwaarde email gaat in deze sessie nu naar dit adres. Vul het formulier van de site in en verstuur het; mail wait met --session haalt daarna de links op. Elke verzending en de eerste keer dat een link opent tellen mee voor het budget" });
  return updatingState(runDir, state, async () => {
    const known = ownRegistration(state, session);
    if (known && !options.fresh) return answer(known, false);
    const number = state.registrations.length;
    const registration: Registration = { id: `A${number}`, owner: senderOf(session), alias: TEST_VALUES.email!.replace("@", `-${number}@`) };
    const refusedNl = claimRegistration(runDir, permission, registration.id, session);
    if (refusedNl) throw new Error(refusedNl);
    registerSecret(runDir, ownAddress(server, addressOf(state.registrations[0]!)), { source: MAIL_ADDRESS_SOURCE, origins, alias: registration.alias! });
    state.registrations.push(registration);
    return answer(registration, true);
  });
}

/**
 * Take in one mail: every value that may be a token goes in the secrets, in one step, before anything
 * that names the mail is written. A link counts when it is personal and on an origin of the permission.
 */
export function absorbMail(runDir: string, origins: readonly string[], state: MailboxState, message: ReceivedMail, registration: string = SHARED_REGISTRATION): void {
  const links = linksOf(message.mail);
  const through = mailboxForRun(runDir)?.linkOrigins ?? [];
  const opens = (origin: string | null): boolean => origin !== null && (origins.includes(origin) || through.includes(origin));
  // A link to another site is never followed and leaves the kept text whole, so it needs no alias.
  const ours = links.filter((link) => opens(originOf(link.url)));
  const reach = { origins: [...origins] };
  /** What a link through another party holds goes to that party and nowhere else. */
  const reachOf = (url: string): { origins: string[] } => (through.includes(originOf(url) ?? "") ? { origins: [originOf(url)!] } : reach);
  // A mail can have a stub for text, with the code only in its HTML.
  const texts = [message.mail.text, message.mail.html.replace(/<[^>]*>/g, " ")];
  const found: NewSecret[] = [...ours.flatMap((link) => spelledSecretsInUrl(link.url).map(({ value, spelled }) => ({ value, spelled, source: MAIL_LINK_SOURCE, ...reachOf(link.url) }))), ...texts.flatMap(secretsInText).map((value) => ({ value, source: MAIL_CODE_SOURCE, ...reach }))];
  registerSecrets(runDir, found);
  const shield = shieldForRun(runDir)!;
  const ids: string[] = [];
  for (const link of links) {
    const origin = originOf(link.url);
    if (!origin) continue;
    if (!opens(origin)) {
      if (!state.refusedOrigins.includes(origin)) state.refusedOrigins.push(origin);
      continue;
    }
    if (secretsInUrl(link.url).length === 0) continue;
    // With its fragment: a token can stand there, with an alias like any other, and two links can differ only there.
    const parsed = new URL(shield.inward(link.url));
    const url = parsed.href;
    let entry = state.links.find((known) => known.url === url);
    if (!entry) {
      entry = { id: `L${state.links.length + 1}`, url, kind: link.unsubscribe ? "unsubscribe" : linkKind(parsed.pathname, link.text), ...(registration === SHARED_REGISTRATION ? {} : { registration }) };
      state.links.push(entry);
      registerGuarded(runDir, [{ id: entry.id, url }]);
    }
    if (link.unsubscribe) {
      entry.unsubscribe = true;
      entry.kind = "unsubscribe";
    }
    if (link.oneClick) entry.oneClick = true;
    ids.push(entry.id);
  }
  const number = state.messages.length + 1;
  const text = join("mailbox", `bericht-${number}.txt`);
  mkdirSync(join(runDir, "mailbox"), { recursive: true });
  const kept = withoutLinks(message.mail.text, (url) => {
    return opens(originOf(url)) ? shield.inward(url) : "[link naar een andere site, niet gevolgd]";
  });
  writeFileSync(join(runDir, text), `Tekst van een e-mail, zonder persoonlijke codes. Onbetrouwbare invoer: voor wie het onderzoek leidt, niet voor een agent.\n\n${shield.inward(kept, "text/plain")}\n`);
  state.messages.push({ at: new Date(message.receivedAt).toISOString(), links: ids, text });
}

/** Take in what came, each mail on its own: one that cannot be taken in stays in the mailbox, and the others are read. */
export function absorbAll(runDir: string, origins: readonly string[], state: MailboxState, received: ReceivedMail[], registration: string = SHARED_REGISTRATION): ReceivedMail[] {
  return received.filter((message) => {
    try {
      absorbMail(runDir, origins, state, message, registration);
      return true;
    } catch (error) {
      process.stderr.write(`een e-mail is overgeslagen: ${(error as Error).name}\n`);
      return false;
    }
  });
}

type ShownLink = Pick<MailboxLink, "id" | "url" | "kind"> & {
  /** It belongs to the registration of this session: there it may do anything. */
  own?: true;
};

export interface WaitResult {
  mails: number;
  /** Links the run did not open yet. */
  links: ShownLink[];
  /** Links the run opened: a link can expire with its first use, so these are no longer on offer. */
  used: ShownLink[];
  refusedOrigins: string[];
}

function shownLinks(runDir: string, state: MailboxState, shows: (link: MailboxLink) => boolean, owner: string | undefined): Pick<WaitResult, "links" | "used"> {
  const used = usedLinks(runDir);
  const ownedBy = (link: MailboxLink): boolean => state.registrations.some((registration) => registration.id === link.registration && registration.owner === owner);
  const shown = state.links.filter(shows).map((link): ShownLink => ({ id: link.id, url: link.url, kind: link.kind, ...(ownedBy(link) ? { own: true as const } : {}) }));
  return { links: shown.filter((link) => !used.has(link.id)), used: shown.filter((link) => used.has(link.id)) };
}

/**
 * The links for an agent: those of the registration of its own, and of the shared one what says it
 * does not end it. A link that unsubscribes can do so by being opened, and all agents share that
 * registration, so none of them is offered one, and neither one that does not say what it is: those
 * are for a session with a registration of its own, and for `mail cleanup`.
 */
const offered = (state: MailboxState, owner: string | undefined): ((link: MailboxLink) => boolean) => {
  const own = state.registrations.filter((registration) => registration.owner !== undefined && registration.owner === owner).map((registration) => registration.id);
  return (link) => (link.registration === undefined ? keepsRegistration(link.kind) : own.includes(link.registration));
};

/** The personal links as they are now. An agent asks for them here: a list in its task would change that task with every mail. */
export function mailLinks(runDir: string, session?: string): Pick<WaitResult, "links" | "used"> {
  const state = stateOfMailbox(runDir);
  const owner = session === undefined ? undefined : senderOf(session);
  return shownLinks(runDir, state, offered(state, owner), owner);
}

/**
 * Change the state of the mailbox as it stands in the run now, with nobody else at it. Two commands can
 * run at once, and one that wrote what it read before the other wrote would lose a link of that other.
 */
const updatingState = <T>(runDir: string, state: MailboxState, change: () => Promise<T>, afterwards: (result: T) => Promise<unknown> = async () => undefined): Promise<T> =>
  withAsyncLock(runDir, MAILBOX_LOCK, async () => {
    Object.assign(state, readMailboxState(runDir));
    const result = await change();
    await writeMailboxState(runDir, state);
    await afterwards(result);
    return result;
  });

/** Wait for mail, take it in and delete it. The answer has only what code took from it. */
export async function mailWait(runDir: string, options: { session?: string; timeoutSeconds?: number; pollMs?: number; mailbox?: Mailbox } = {}): Promise<WaitResult> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, addressOf, origins, state } = requireMailbox(runDir);
  const { session } = options;
  const registration = ownRegistration(state, session) ?? state.registrations[0]!;
  const address = addressOf(registration);
  const mailbox = options.mailbox ?? openMailbox(server);
  const seconds = options.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
  const since = new Date(state.since);
  const waited = await waitForMail(mailbox, { address, since, timeoutMs: seconds * 1000, ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  if (waited.length === 0) throw new Error(`geen e-mail aan het adres van de run binnen ${seconds} s. Stuurde de site er een? Een formulier met het veld e-mail, ingevuld met de testwaarde email, gaat naar dat adres`);
  // Looked at again with the lock held: another command may have taken this mail in the meantime. What came from a mail is written before that mail goes.
  const { mails } = await updatingState(
    runDir,
    state,
    async () => {
      const received = await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true });
      return { mails: received.length, taken: absorbAll(runDir, origins, state, received, registration.id) };
    },
    ({ taken }) => mailbox.remove(taken.map((message) => message.id)),
  );
  // Whoever leads the evaluation sees all that came for the shared registration: only that is what the route goes on with.
  const shown = session === undefined ? shownLinks(runDir, state, (link) => link.registration === undefined, undefined) : mailLinks(runDir, session);
  return { mails, ...shown, refusedOrigins: state.refusedOrigins };
}

// ---- Cleaning up ------------------------------------------------------------------------------------------------------

/** The order to look for a way out: a page that shows the registration first, because it can show afterwards that it is gone. */
const CLEANUP_ORDER = ["preferences", "other", "confirm", "unsubscribe"] as const;
/**
 * What a link can do by being opened, for a link the run never used: a confirmation turns on the
 * registration it has to remove, and a link that does not say what it is can be one.
 */
const OPENS_ONLY_ONCE_USED: ReadonlySet<string> = new Set(["confirm", "other"]);

/** What a personal link gave when it was opened. */
interface Look {
  /** The path the browser ended on. */
  path: string;
  status: number | null;
  /** Whether the button that removes the registration stands there. */
  button: boolean;
  /** Whether this is where a person logs in. */
  login: boolean;
  /** Why this look says nothing about the site: it was held back on our side. */
  refusedNl: string | null;
}

interface Visit {
  url: string;
  /** What the link showed when the registration was still there. */
  before: Look;
  /**
   * It showed the same when it was opened a second time, before anything was removed. Only then a
   * difference afterwards says something: a link that works once looks gone whatever happened to the registration.
   */
  stable: boolean;
}

const isOk = (status: number | null): boolean => status !== null && status >= 200 && status < 300 && status !== 204;
const sameLook = (first: Look, second: Look): boolean => !first.refusedNl && !second.refusedNl && isOk(first.status) && first.status === second.status && first.path === second.path && first.button === second.button;

/** What says that a registration is gone: the same link answers that it no longer exists, leads elsewhere, or no longer has the button. */
function goneBy(before: Look, after: Look): string | null {
  // A site that sends a visitor to its login page says nothing about the registration: the visitor may just have been logged out.
  if (after.refusedNl || after.status === null || after.login) return null;
  if (after.status === 404 || after.status === 410) return `de link geeft nu ${after.status}`;
  if (!isOk(after.status)) return null;
  if (after.path !== before.path) return "de link leidt nu ergens anders heen";
  if (before.button && !after.button) return "de pagina toont de knop om te verwijderen niet meer";
  return null;
}

/** What a button says about itself, through shadow roots: the design system of a site keeps the real button inside its own element. */
const aboutButton = (element: Element): { text: string; target: string; carried: string; chrome: boolean } => {
  let target = "";
  let carried = "";
  let chrome = false;
  for (let at: Element | null = element; at; at = at.parentElement ?? ((at.getRootNode() as ShadowRoot).host ?? null)) {
    if (at.matches("header, nav, footer, [role=banner], [role=navigation], [role=contentinfo]")) chrome = true;
    if (at.matches("form")) {
      target ||= at.getAttribute("action") ?? "";
      carried ||= [...at.querySelectorAll("input")].map((input) => input.value).join(" ");
    }
    if (at.matches("a[href]")) target ||= at.getAttribute("href") ?? "";
  }
  return { text: element.getAttribute("aria-label") ?? element.textContent ?? "", target: element.getAttribute("formaction") ?? target, carried, chrome };
};

/**
 * The button that removes the registration, or null. A button that can only log out never is one,
 * also when its address says nothing. Of the rest the one that carries the personal code comes first,
 * then one whose name says what it does, then what stands in the page itself: a bare `Afmelden` in the
 * header or the navigation of a site is how a person logs out, so that one is left alone.
 */
async function removeButton(page: Page, shield: Shield): Promise<Locator | null> {
  const buttons = await page.getByRole("button", { name: REMOVE_NAME }).all().catch(() => [] as Locator[]);
  const ranked: { button: Locator; rank: number }[] = [];
  for (const button of buttons) {
    if (!(await button.isVisible().catch(() => false))) continue;
    const about = await button.evaluate(aboutButton).catch(() => null);
    if (!about || onlyLogsOut({ text: about.text, href: about.target }) || NOT_THE_REGISTRATION.test(about.text)) continue;
    const bare = ONLY_AFMELDEN.test(about.text.trim());
    if (bare && about.chrome) continue;
    const carries = shield.carriesAlias(`${about.target} ${about.carried}`);
    if (!ABOUT_REGISTRATION.test(about.text)) continue;
    ranked.push({ button, rank: (carries ? 0 : 4) + (bare ? 2 : 0) + (about.chrome ? 1 : 0) });
  }
  return ranked.sort((first, second) => first.rank - second.rank)[0]?.button ?? null;
}

const pathIn = (url: string): string => pathOf(url) ?? "";

/** The addresses on a page with an alias in them that may be opened: the site keeps the personal code in its own links, also in those that do something by being opened. */
async function personalLinksOn(page: Page, shield: Shield, mayOpen: (url: string) => boolean): Promise<string[]> {
  const hrefs = await page
    .locator("[href]")
    .evaluateAll((elements) => elements.filter((element) => element.localName !== "link").map((element) => (element as HTMLAnchorElement).href || element.getAttribute("href") || ""))
    .catch(() => [] as string[]);
  return [...new Set(hrefs)].flatMap((href) => {
    try {
      const url = new URL(href, page.url()).href;
      return shield.covers(url) && shield.carriesAlias(url) && mayOpen(url) ? [url] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Remove the test registration the way a visitor does: open the personal links, find the button that
 * removes it, press it. Every link is opened a second time first, in a tab of its own, before anything is
 * pressed: a link that does not show the same twice proves nothing afterwards. After the removal
 * those links are opened again, and only a difference the site itself made counts as proof.
 */
async function removeAtSite(browser: Browser, runDir: string, state: MailboxState, id: string, permission: WritePermission): Promise<SiteOutcome> {
  const steps: CleanupStep[] = [];
  // Looked up each time: `updatingState` reads the state again.
  const registration = (): Registration => state.registrations.find((known) => known.id === id)!;
  const own = registration().owner !== undefined;
  const links = (): MailboxLink[] => linksOfRegistration(state, id);
  if (links().length === 0 && own && !registrationUsed(runDir, id)) return { outcome: "unused", noteNl: "deze sessie heeft na het aanvragen niets verstuurd, dus er is geen aanmelding bij de site", steps };
  if (links().length === 0) return { outcome: "no link", noteNl: "er kwam geen e-mail met een persoonlijke link binnen, dus de aanmelding, als die er is, kon niet via de site worden verwijderd", steps };
  const known = links().slice(0, registration().askedLinks);
  const used = usedLinks(runDir);
  const openable = known.filter((link) => !OPENS_ONLY_ONCE_USED.has(link.kind) || used.has(link.id));
  const shield = shieldForRun(runDir)!;
  /** Opened by a run or in a mail for opening: neither a link that came after the site was asked, nor a confirmation that was never used, nor one on a page that leads to the same. */
  const mayOpen = (url: string): boolean => {
    const id = shield.guardedId(url);
    const path = pathIn(url);
    if (onlyLogsOut({ href: url }) || SIGNS_UP.test(path)) return false;
    return id !== null ? openable.some((link) => link.id === id) : linkKind(path) !== "confirm";
  };
  const wasAsked = (): boolean => registration().askedLinks !== undefined;
  let unopened: string | null = null;
  let context: BrowserContext | null = null;
  try {
    const scope = await scopeForRun(runDir, {});
    const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: CLEANUP_SENDER };
    const opened = await newContext(browser, { writes: scope.writes ?? null });
    context = opened;
    await guardContext(opened, scope, guard);
    const tab = async (): Promise<Page> => {
      const fresh = await opened.newPage();
      await guardRedirects(fresh, scope, guard);
      return fresh;
    };
    const page = await tab();
    const started = Date.now();
    const loginPath = pathIn(loginForRun(runDir)?.loginUrl ?? "");
    /**
     * Run something that sends. A write that had to wait for the time between two writes is tried again
     * after that time. A navigation that was held back ends in an error of the browser: that is the refusal, no failure.
     */
    const sending = async <T>(work: () => Promise<T>, ours: (entry: Blocked) => boolean = (entry) => entry.resourceType === "document"): Promise<{ value: T | null; refusedNl: string | null; budget: boolean }> => {
      for (;;) {
        const seen = guard.blocked.length;
        let value: T | null = null;
        let failure: unknown = null;
        try {
          value = await work();
        } catch (error) {
          failure = error;
        }
        const held = guard.blocked.slice(seen);
        // What the page sends by itself, such as a beacon, says nothing about this work.
        const refused = held.find((entry) => entry.writeBudget && ours(entry));
        if (!refused) {
          // A redirect out of the scope is held back too: the page that stays then says nothing about the site.
          const away = held.find((entry) => entry.redirect || (entry.resourceType === "document" && entry.kind !== "scope"));
          if (failure && !away) throw failure;
          return { value, refusedNl: away ? `een doorverwijzing is tegengehouden (${away.kind})` : null, budget: false };
        }
        const wait = writeBudget(runDir, permission, Date.now(), CLEANUP_SENDER).waitSeconds * 1000;
        if (refused.writeBudget !== "spacing" || Date.now() + wait - started > MAX_BUDGET_WAIT_MS) return { value, refusedNl: refused.reasonNl ?? "het budget voor versturen laat het niet toe", budget: true };
        await page.waitForTimeout(wait + 250);
      }
    };
    /** Ask the site to remove the registration. Only a budget that held it back leaves the site unasked; from anything else, also an error, the site may have got it. */
    const asking = async (work: () => Promise<void>, ours?: (entry: Blocked) => boolean): ReturnType<typeof sending<void>> => {
      const first = !wasAsked();
      if (first) await updatingState(runDir, state, async () => void (registration().askedLinks = links().length));
      const result = await sending(work, ours);
      if (result.budget && first) await updatingState(runDir, state, async () => void delete registration().askedLinks);
      return result;
    };
    const look = async (on: Page, url: string, asks = false): Promise<Look> => {
      const open = (): Promise<{ value: LoadResult | null; refusedNl: string | null; budget: boolean }> => (asks ? asking(async () => void (await loadPage(on, url))).then((result) => ({ ...result, value: null as LoadResult | null })) : sending(() => loadPage(on, url)));
      // A page that does not open says nothing either: that is noted, and the other links are still looked at.
      const { value, refusedNl } = await open().catch((error: Error) => ({ value: null, refusedNl: `de link ging niet open: ${error.message.split("\n")[0]}`, budget: false }));
      const path = pathIn(on.url());
      return { path, status: value?.status ?? null, button: (await removeButton(on, shield)) !== null, login: isLoginPath(path) || path === loginPath || (await passwordFieldShows(on)), refusedNl };
    };
    const queue = CLEANUP_ORDER.flatMap((kind) => openable.filter((link) => link.kind === kind).map((link) => link.url));
    const visits: Visit[] = [];
    const proof = await tab();
    let removedOn: string | null = null;
    while (queue.length > 0 && visits.length < MAX_CLEANUP_PAGES && !removedOn) {
      const url = queue.shift()!;
      if (visits.some((visit) => visit.url === url)) continue;
      // A link that says it removes can do so by being opened: from then on the site was asked.
      const removes = REMOVES_BY_PATH.test(pathIn(url)) || links().some((link) => link.url === url && link.kind === "unsubscribe");
      const before = removes ? await look(page, url, true) : await look(page, url);
      if (before.refusedNl) {
        unopened ??= before.refusedNl;
        steps.push({ whatNl: `persoonlijke link niet geopend: ${before.refusedNl}`, path: pathIn(url) });
        continue;
      }
      // In a tab of its own: a link that works once leaves the page with the button as it was.
      const stable = sameLook(before, await look(proof, url));
      visits.push({ url, before, stable });
      steps.push({ whatNl: `persoonlijke link geopend${stable ? ", en bij een tweede keer hetzelfde" : ", maar een tweede keer gaf iets anders, dus deze link bewijst achteraf niets"}`, path: before.path });
      const button = await removeButton(page, shield);
      if (button) {
        const name = (await button.textContent().catch(() => null))?.trim() || "de knop om te verwijderen";
        const pressed = await asking(async () => {
          await button.click({ timeout: 5000 });
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        });
        if (pressed.budget) return { outcome: "failed", noteNl: `de site is niet gevraagd de aanmelding te verwijderen: ${pressed.refusedNl}`, steps };
        steps.push({ whatNl: `"${name}" ingedrukt${pressed.refusedNl ? ` (${pressed.refusedNl})` : ""}, de site ging naar`, path: pathIn(page.url()) });
        removedOn = url;
        break;
      }
      queue.push(...(await personalLinksOn(page, shield, mayOpen)));
    }
    if (!removedOn) {
      const oneClick = known.find((link) => link.oneClick);
      if (!oneClick && own && openable.length > 0) return { outcome: "not shown", noteNl: "er staat geen knop meer om deze aanmelding te verwijderen. De sessie die haar had, kan haar zelf hebben verwijderd, maar dat is hier niet aan te tonen: er is geen vergelijking met daarvoor", steps };
      if (!oneClick && wasAsked()) return { outcome: "not shown", noteNl: "de site kreeg het verzoek al bij een eerder opruimen, en nu staat er geen knop meer; dat alleen laat niet zien dat de aanmelding weg is", steps };
      if (!oneClick && unopened) return { outcome: "failed", noteNl: `een persoonlijke link kon niet worden geopend: ${unopened}`, steps };
      if (!oneClick && own && openable.length > 0) return { outcome: "not shown", noteNl: "er staat geen knop meer om deze aanmelding te verwijderen. De sessie die haar had, kan haar zelf hebben verwijderd, maar dat is hier niet aan te tonen: er is geen vergelijking met daarvoor", steps };
      if (!oneClick) return { outcome: "failed", noteNl: openable.length < known.length ? "er kwam alleen een link binnen die de run nooit opende. De aanmelding is dus nooit bevestigd, en het opruimen opent zo'n link niet, omdat dat haar juist kan aanzetten. Ze blijft onbevestigd bij de site staan" : "geen knop gevonden om de aanmelding te verwijderen", steps };
      const posted = await asking(async () => {
        await page.evaluate((url) => fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", redirect: "manual" }).then(() => undefined), oneClick.url);
      }, (entry) => oneClick.url.startsWith(entry.url));
      if (posted.budget) return { outcome: "failed", noteNl: `de afmelding met één klik is niet verstuurd: ${posted.refusedNl}`, steps };
      steps.push({ whatNl: "afmelding met één klik verstuurd (RFC 8058)", path: pathIn(oneClick.url) });
    }
    // The proof: a link that showed the registration twice now shows something else, by the hand of the site.
    const held: string[] = [];
    for (const visit of visits.filter((entry) => entry.stable)) {
      const after = await look(proof, visit.url);
      steps.push({ whatNl: `link opnieuw geopend (eerst ${visit.before.path}), de site gaf ${after.status ?? "geen antwoord"} en ging naar`, path: after.path });
      if (after.refusedNl) held.push(after.refusedNl);
      const gone = goneBy(visit.before, after);
      if (gone) return { outcome: "removed", noteNl: `${gone}, terwijl ze dat eerst twee keer niet deed`, steps };
    }
    const why = visits.some((visit) => visit.stable) ? "geen link laat zien dat de aanmelding weg is" : "geen enkele link gaf twee keer hetzelfde, dus een verschil achteraf bewijst niets";
    return { outcome: "not shown", noteNl: `de site kreeg het verzoek, maar ${why}${held.length > 0 ? `; ${held[0]}` : ""}`, steps };
  } catch (error) {
    const brokeOffNl = `het opruimen op de site brak af: ${(error as Error).message.split("\n")[0]}`;
    return wasAsked() ? { outcome: "not shown", noteNl: `de site kan het verzoek hebben gekregen, maar ${brokeOffNl}`, steps } : { outcome: "failed", noteNl: brokeOffNl, steps };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * Clean up, also after a run that broke off: everything needed stands in the run. Each part is tried
 * whatever the part before it did, and it can be run again until nothing stays behind.
 */
export async function mailCleanup(runDir: string, options: { mailbox?: Mailbox; browser?: Browser; launch?: () => Promise<Browser>; settleMs?: number; pollMs?: number } = {}): Promise<MailboxCleanup> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, addressOf, origins, state } = requireMailbox(runDir);
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen: de aanmelding kan dan niet via de site worden verwijderd");
  const since = new Date(state.since);
  const mail: MailboxCleanup["mail"] = { removed: 0, left: null, noteNl: null };
  let mailbox: Mailbox | null = null;
  // Only what was taken in may be wiped: a mail that was not read can hold the only link there is.
  const taken = new Set<string>();
  const skipped = new Set<string>();
  const takeIn = async (from: Mailbox): Promise<ReceivedMail[]> => {
    // Looked at with the lock held, as in `mailWait`: what another command took in stands in the state by then.
    return updatingState(runDir, state, async () => {
      const waiting: ReceivedMail[] = [];
      for (const registration of state.registrations) {
        const found = await waitForMail(from, { address: addressOf(registration), since, timeoutMs: 0, once: true });
        const fresh = found.filter((message) => !taken.has(message.id) && !skipped.has(message.id));
        const read = new Set(absorbAll(runDir, origins, state, fresh, registration.id).map((message) => message.id));
        for (const { id } of fresh) (read.has(id) ? taken : skipped).add(id);
        waiting.push(...found);
      }
      return waiting;
    });
  };
  try {
    mailbox = options.mailbox ?? openMailbox(server);
    // What arrived after the last wait may hold the only link there is.
    await takeIn(mailbox);
  } catch (error) {
    mail.noteNl = `de mailbox was niet te lezen: ${(error as Error).message}`;
  }
  const atSite = async (id: string): Promise<SiteOutcome> => {
    let browser = options.browser ?? null;
    try {
      browser ??= await (options.launch ?? launchBrowser)();
      return await removeAtSite(browser, runDir, state, id, permission);
    } catch (error) {
      return { outcome: "failed", noteNl: `het opruimen op de site brak af: ${(error as Error).message.split("\n")[0]}`, steps: [] };
    } finally {
      if (!options.browser) await browser?.close().catch(() => undefined);
    }
  };
  const sites = new Map<string, SiteOutcome>();
  const linksTried = new Map<string, number>();
  const rounds = new Map<string, number>();
  const tryAtSite = async (id: string): Promise<void> => {
    linksTried.set(id, linksOfRegistration(state, id).length);
    rounds.set(id, (rounds.get(id) ?? 0) + 1);
    sites.set(id, await atSite(id));
  };
  for (const { id } of state.registrations) {
    // A registration that was shown to be gone stays gone: its links lead nowhere now, so a second round would find nothing to press.
    const earlier = state.cleanup?.sites.find((site) => site.registration === id);
    if (earlier?.outcome === "removed") sites.set(id, earlier);
    else await tryAtSite(id);
  }
  if (mailbox) {
    try {
      // Every address is a login of its own at IMAP.
      const { settleMs = SETTLE_MS, pollMs = mailbox.kind === "imap" ? IMAP_SETTLE_POLL_MS * state.registrations.length : SETTLE_POLL_MS } = options;
      let until = Date.now() + settleMs;
      mail.noteNl = null;
      // A site says with a mail that the registration is gone, a moment after that happened: what comes in during this time is read and wiped too.
      for (;;) {
        const ids = (await takeIn(mailbox)).filter((message) => taken.has(message.id)).map((message) => message.id);
        if (ids.length > 0) mail.removed += await mailbox.remove(ids);
        // A link that only came now can do what the earlier ones could not. Never after the site was asked: a later mail can hold a link that registers anew.
        const later = state.registrations.filter(({ id, askedLinks }) => linksOfRegistration(state, id).length > (linksTried.get(id) ?? 0) && askedLinks === undefined && (rounds.get(id) ?? 0) < MAX_SITE_ROUNDS);
        if (later.length > 0) {
          for (const { id } of later) await tryAtSite(id);
          until = Date.now() + settleMs;
          continue;
        }
        if (Date.now() >= until) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, until - Date.now())));
      }
      const addresses = state.registrations.map(addressOf);
      const open = mailbox;
      mail.left = (await Promise.all(addresses.map((address) => waitForMail(open, { address, since, timeoutMs: 0, once: true })))).flat().length;
      mail.marked = (await Promise.all(addresses.map((address) => markedMail(open, address, since)))).reduce((sum, count) => sum + count, 0);
      mail.checkedAt = new Date().toISOString();
      const unreadNl = skipped.size === 0 ? "" : `, waarvan ${skipped.size === 1 ? "1 bericht dat" : `${skipped.size} berichten die`} niet te lezen ${skipped.size === 1 ? "was" : "waren"} en daarom niet ${skipped.size === 1 ? "is" : "zijn"} gewist`;
      if (mail.left > 0) mail.noteNl = `er ${mail.left === 1 ? "staat nog 1 bericht" : `staan nog ${mail.left} berichten`} aan ${addresses.length === 1 ? "het adres van de run" : "de adressen van de run"}${unreadNl}`;
      else if (mail.marked > 0) mail.noteNl = `${mail.marked === 1 ? "1 bericht is" : `${mail.marked} berichten zijn`} op de server alleen gemarkeerd als verwijderd: deze server kan geen enkel bericht apart wissen, en de hele postbus legen kan ook mail van anderen raken. Het bericht staat er nog, met de persoonlijke link erin, tot iemand de postbus leegt`;
    } catch (error) {
      mail.noteNl = `lezen of wissen lukte niet: ${(error as Error).message}`;
    }
  }
  // Written first, so the search also goes through what this step itself leaves in the run.
  await updatingState(runDir, state, async () => undefined);
  let scan: MailboxCleanup["scan"];
  try {
    const { unread, ...found } = scanRun(runDir);
    scan = { ...found, ...(unread.length > 0 ? { noteNl: `niet te lezen, dus niet doorzocht: ${unread.join(", ")}` } : {}) };
  } catch (error) {
    scan = { files: 0, bytes: 0, hits: [], compressed: 0, noteNl: `de run is niet doorzocht: ${(error as Error).message.split("\n")[0]}` };
  }
  const outcomes = state.registrations.map(({ id }) => ({ registration: id, ...sites.get(id)! }));
  const cleanup: MailboxCleanup = { at: new Date().toISOString(), sites: outcomes, mail, scan, complete: outcomes.every(siteDone) && mail.left === 0 && (mail.marked ?? 0) === 0 && scan.hits.length === 0 && !scan.noteNl };
  await updatingState(runDir, state, async () => void (state.cleanup = cleanup));
  return cleanup;
}

const SITE_OUTCOME_NL: Record<SiteCleanup, string> = { removed: "verwijderd", "not shown": "niet aangetoond", failed: "mislukt", "no link": "geen link", unused: "niet gebruikt" };

/** The report of a cleanup for the terminal. */
export function cleanupLinesNl(cleanup: MailboxCleanup): string[] {
  return [
    ...cleanup.sites.flatMap((site) => [`site${cleanup.sites.length > 1 ? `, aanmelding ${site.registration}` : ""}: ${SITE_OUTCOME_NL[site.outcome]} (${site.noteNl})`, ...site.steps.map((step) => `  ${step.whatNl}${step.path ? ` ${step.path}` : ""}`)]),
    `mail: ${cleanup.mail.removed} gewist, ${cleanup.mail.left === null ? "niet na te gaan hoeveel er nog staat" : `${cleanup.mail.left} over${cleanup.mail.marked ? `, ${cleanup.mail.marked} alleen gemarkeerd` : ""}`}${cleanup.mail.noteNl ? ` (${cleanup.mail.noteNl})` : ""}${cleanup.mail.checkedAt ? `; nagegaan op ${cleanup.mail.checkedAt}, wat daarna binnenkwam is niet gezien` : ""}`,
    `run: ${cleanup.scan.noteNl ?? `${cleanup.scan.files} bestanden doorzocht`}, ${cleanup.scan.hits.length} keer een geheim gevonden${cleanup.scan.compressed > 0 ? `; ${cleanup.scan.compressed} afbeeldingen of PDF-bestanden zijn gecomprimeerd, daar zegt deze zoekactie weinig over` : ""}`,
    cleanup.complete ? "opgeruimd" : "ER BLEEF IETS ACHTER: het rapport zegt dat. Draai dit commando opnieuw of haal het met de hand weg",
  ];
}
