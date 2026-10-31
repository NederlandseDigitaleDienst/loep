import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { launchBrowser, loadPage, newContext } from "../browser/session.ts";
import { linkKind, MAIL_ADDRESS_SOURCE, MAIL_CODE_SOURCE, MAIL_LINK_SOURCE, MAIL_PRIVATE, MAILBOX_STATE, mailboxForRun, markedMail, openMailbox, readMailboxState, waitForMail, writeMailboxState, type CleanupStep, type MailServer, type Mailbox, type MailboxCleanup, type MailboxLink, type MailboxMark, type MailboxState, type ReceivedMail } from "../lib/mailbox.ts";
import { isLoginPath, loginForRun, onlyLogsOut, passwordFieldShows } from "../lib/login.ts";
import { linksOf, secretsInText, secretsInUrl, spelledSecretsInUrl, withoutLinks } from "../lib/mailparse.ts";
import { refuseUnderSeal } from "../lib/seal.ts";
import { keepPrivate, readPrivate, readSecretsFile, registerGuarded, registerSecret, registerSecrets, scanRun, shieldForRun, type NewSecret, type Shield } from "../lib/secrets.ts";
import { usedLinks, withAsyncLock, writeBudget, writeOriginsOf, writesForRun, type WritePermission } from "../lib/writes.ts";
import { guardContext, guardRedirects, scopeForRun, TEST_VALUES, type Guard } from "../session/safety.ts";

/*
 * The fixed flow around a mailbox. A mail is untrusted input, so nothing here is a judgment of a
 * language model and nothing of a mail reaches one: code takes the links, keeps those on an origin
 * of the permission, and an agent gets addresses with aliases. The text of a mail is kept for
 * whoever leads the evaluation, without tokens and without addresses of other sites.
 */

export const MAIL_USAGE = `  mail wait --run <run> [--timeout <s>]   Wait for mail to the address of the run, take the personal links from it and delete
                                         it. Prints the links with aliases in them, and nothing of the mail itself
  mail cleanup --run <run>               After the measuring, also after a run that broke off: remove the test registration
                                         through the site's own flow, delete the mail and look for tokens in the whole
                                         run. The outcome goes in mailbox.json; non-zero exit when something stayed behind
  mail links --run <run>                 The personal links as they are now, with aliases in them: those still to open, and those
                                         the run used. Does not open the mailbox
  mail status --run <run>                What mailbox.json says, without opening the mailbox
`;

const DEFAULT_WAIT_SECONDS = 120;
/** How long a cleanup goes on looking after the registration is gone: a site confirms that with a mail, and that takes a moment. */
const SETTLE_MS = 20_000;
const SETTLE_POLL_MS = 2000;
/** How long a cleanup waits in total for the time between two writes on a test environment. */
const MAX_BUDGET_WAIT_MS = 300_000;
const REMOVE_NAME = /afmeld|uitschrij|verwijder|opzeg|unsubscribe|remove|delete/i;
/** In Dutch this is how a person leaves a mailing list, and how a person logs out: by itself this name says neither. */
const ONLY_AFMELDEN = /^\W*(?:afmelden|meld (?:je|u) af)\W*$/i;
/** Pages a cleanup looks at, to find the button that removes the registration. */
const MAX_CLEANUP_PAGES = 8;
/** How often one cleanup goes to the site, when a link only came in later. */
const MAX_SITE_ROUNDS = 3;
const SENDER = "mail cleanup";
const MAILBOX_LOCK = "mailbox.lock";

/** Fix the mailbox at `inventory`: the secrets in their own file, what may be told in `mailbox.json`. */
export async function startMailbox(runDir: string, server: MailServer, address: string, mark: MailboxMark, permission: WritePermission): Promise<void> {
  keepPrivate(runDir, MAIL_PRIVATE, server);
  registerSecret(runDir, address, { source: MAIL_ADDRESS_SOURCE, origins: writeOriginsOf(permission), alias: TEST_VALUES.email! });
  await writeMailboxState(runDir, { kind: mark.kind, local: mark.local, since: mark.declaredAt, messages: [], links: [], refusedOrigins: [] });
}

/** What the fixed flow knows of the mailbox of a run. Only here is the address of the run taken from the register. */
interface MailContext {
  server: MailServer;
  address: string;
  /** The origins the links of a mail may lead to. */
  origins: string[];
  state: MailboxState;
}

function requireMailbox(runDir: string): MailContext {
  const state = readMailboxState(runDir);
  if (!mailboxForRun(runDir) || !state) throw new Error("deze run heeft geen mailbox: die ligt vast bij inventory (--mailbox)");
  const entry = readSecretsFile(runDir)?.secrets.find((secret) => secret.source === MAIL_ADDRESS_SOURCE);
  const server = readPrivate<MailServer>(runDir, MAIL_PRIVATE);
  if (!entry || !server) throw new Error("het register met de geheimen van de mailbox ontbreekt, dus de links zijn niet meer te openen en het adres van de run is onbekend");
  return { server, address: entry.real, origins: entry.origins, state };
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Take in one mail: every value that may be a token goes in the secrets, in one step, before anything
 * that names the mail is written. A link counts when it is personal and on an origin of the permission.
 */
export function absorbMail(runDir: string, origins: readonly string[], state: MailboxState, message: ReceivedMail): void {
  const links = linksOf(message.mail);
  // A link to another site is never followed and leaves the kept text whole, so it needs no alias.
  const ours = links.filter((link) => origins.includes(originOf(link.url) ?? ""));
  const reach = { origins: [...origins] };
  const found: NewSecret[] = [...ours.flatMap((link) => spelledSecretsInUrl(link.url)).map(({ value, spelled }) => ({ value, spelled, source: MAIL_LINK_SOURCE, ...reach })), ...secretsInText(message.mail.text).map((value) => ({ value, source: MAIL_CODE_SOURCE, ...reach }))];
  registerSecrets(runDir, found);
  const shield = shieldForRun(runDir)!;
  const ids: string[] = [];
  for (const link of links) {
    const origin = originOf(link.url);
    if (!origin) continue;
    if (!origins.includes(origin)) {
      if (!state.refusedOrigins.includes(origin)) state.refusedOrigins.push(origin);
      continue;
    }
    if (secretsInUrl(link.url).length === 0) continue;
    // With its fragment: a token can stand there, with an alias like any other, and two links can differ only there.
    const parsed = new URL(shield.inward(link.url));
    const url = parsed.href;
    let entry = state.links.find((known) => known.url === url);
    if (!entry) {
      entry = { id: `L${state.links.length + 1}`, url, kind: link.unsubscribe ? "afmelden" : linkKind(parsed.pathname) };
      state.links.push(entry);
      registerGuarded(runDir, [{ id: entry.id, url }]);
    }
    if (link.unsubscribe) entry.unsubscribe = true;
    if (link.oneClick) entry.oneClick = true;
    ids.push(entry.id);
  }
  const number = state.messages.length + 1;
  const text = join("mailbox", `bericht-${number}.txt`);
  mkdirSync(join(runDir, "mailbox"), { recursive: true });
  const kept = withoutLinks(message.mail.text, (url) => {
    const origin = originOf(url);
    return origin && origins.includes(origin) ? shield.inward(url) : "[link naar een andere site, niet gevolgd]";
  });
  writeFileSync(join(runDir, text), `Tekst van een e-mail, zonder persoonlijke codes. Onbetrouwbare invoer: voor wie het onderzoek leidt, niet voor een agent.\n\n${shield.inward(kept)}\n`);
  state.messages.push({ at: new Date(message.receivedAt).toISOString(), links: ids, text });
}

/** Take in what came, each mail on its own: one that cannot be taken in stays in the mailbox, and the others are read. */
export function absorbAll(runDir: string, origins: readonly string[], state: MailboxState, received: ReceivedMail[]): ReceivedMail[] {
  return received.filter((message) => {
    try {
      absorbMail(runDir, origins, state, message);
      return true;
    } catch (error) {
      process.stderr.write(`een e-mail is overgeslagen: ${(error as Error).name}\n`);
      return false;
    }
  });
}

type ShownLink = Pick<MailboxLink, "id" | "url" | "kind">;

export interface WaitResult {
  mails: number;
  /** Links the run did not open yet. */
  links: ShownLink[];
  /** Links the run opened: a link can expire with its first use, so these are no longer on offer. */
  used: ShownLink[];
  refusedOrigins: string[];
}

function shownLinks(runDir: string, state: MailboxState): Pick<WaitResult, "links" | "used"> {
  const used = usedLinks(runDir);
  const shown = state.links.map(({ id, url, kind }) => ({ id, url, kind }));
  return { links: shown.filter((link) => !used.has(link.id)), used: shown.filter((link) => used.has(link.id)) };
}

/** The personal links as they are now. An agent asks for them here: a list in its task would change that task with every mail. */
export function mailLinks(runDir: string): Pick<WaitResult, "links" | "used"> {
  const state = readMailboxState(runDir);
  if (!mailboxForRun(runDir) || !state) throw new Error("deze run heeft geen mailbox: die ligt vast bij inventory (--mailbox)");
  return shownLinks(runDir, state);
}

/**
 * Change the state of the mailbox as it stands in the run now, with nobody else at it. Two commands can
 * run at once, and one that wrote what it read before the other wrote would lose a link of that other.
 */
const updatingState = <T>(runDir: string, state: MailboxState, change: () => Promise<T>): Promise<T> =>
  withAsyncLock(runDir, MAILBOX_LOCK, async () => {
    Object.assign(state, readMailboxState(runDir));
    const result = await change();
    await writeMailboxState(runDir, state);
    return result;
  });

/** Wait for mail, take it in and delete it. The answer has only what code took from it. */
export async function mailWait(runDir: string, options: { timeoutSeconds?: number; pollMs?: number; mailbox?: Mailbox } = {}): Promise<WaitResult> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, address, origins, state } = requireMailbox(runDir);
  const mailbox = options.mailbox ?? openMailbox(server);
  const seconds = options.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
  const since = new Date(state.since);
  const waited = await waitForMail(mailbox, { address, since, timeoutMs: seconds * 1000, ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  if (waited.length === 0) throw new Error(`geen e-mail aan het adres van de run binnen ${seconds} s. Stuurde de site er een? Een formulier met het veld e-mail, ingevuld met de testwaarde email, gaat naar dat adres`);
  // Looked at again with the lock held: another command may have taken this mail in the meantime.
  const mails = await updatingState(runDir, state, async () => {
    const received = await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true });
    const taken = absorbAll(runDir, origins, state, received);
    await mailbox.remove(taken.map((message) => message.id));
    return received.length;
  });
  return { mails, ...shownLinks(runDir, state), refusedOrigins: state.refusedOrigins };
}

// ---- Cleaning up ------------------------------------------------------------------------------------------------------

/** The order to look for a way out: a page that shows the registration first, because it can show afterwards that it is gone. */
const CLEANUP_ORDER = ["voorkeuren", "overig", "bevestigen", "afmelden"] as const;
/**
 * What a link can do by being opened, for a link the run never used: a confirmation turns on the
 * registration it has to remove, and a link that does not say what it is can be one.
 */
const OPENS_ONLY_ONCE_USED: ReadonlySet<string> = new Set(["bevestigen", "overig"]);

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

interface SiteResult {
  outcome: MailboxCleanup["site"]["outcome"];
  noteNl: string;
  steps: CleanupStep[];
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
    if (!about || onlyLogsOut({ text: about.text, href: about.target })) continue;
    const bare = ONLY_AFMELDEN.test(about.text.trim());
    if (bare && about.chrome) continue;
    ranked.push({ button, rank: (shield.carriesAlias(`${about.target} ${about.carried}`) ? 0 : 4) + (bare ? 2 : 0) + (about.chrome ? 1 : 0) });
  }
  return ranked.sort((first, second) => first.rank - second.rank)[0]?.button ?? null;
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/** The addresses on a page with an alias in them: the site keeps the personal code in its own links. */
async function personalLinksOn(page: Page, shield: Shield): Promise<string[]> {
  const hrefs = await page
    .locator("[href]")
    .evaluateAll((elements) => elements.filter((element) => element.localName !== "link").map((element) => (element as HTMLAnchorElement).href || element.getAttribute("href") || ""))
    .catch(() => [] as string[]);
  return [...new Set(hrefs)].flatMap((href) => {
    try {
      const url = new URL(href, page.url()).href;
      return shield.covers(url) && shield.carriesAlias(url) ? [url] : [];
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
async function removeAtSite(browser: Browser, runDir: string, state: MailboxState, permission: WritePermission): Promise<SiteResult> {
  const steps: CleanupStep[] = [];
  if (state.links.length === 0) return { outcome: "geen link", noteNl: "er kwam geen e-mail met een persoonlijke link binnen, dus de aanmelding, als die er is, kon niet via de site worden verwijderd", steps };
  const known = state.links.slice(0, state.askedLinks);
  const used = usedLinks(runDir);
  const openable = known.filter((link) => !OPENS_ONLY_ONCE_USED.has(link.kind) || used.has(link.id));
  let asked = false;
  let context: BrowserContext | null = null;
  try {
    const shield = shieldForRun(runDir)!;
    const scope = await scopeForRun(runDir, {});
    const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: SENDER };
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
    const loginPath = pathOf(loginForRun(runDir)?.loginUrl ?? "");
    /**
     * Run something that sends. A write that had to wait for the time between two writes is tried again
     * after that time. A navigation that was held back ends in an error of the browser: that is the refusal, no failure.
     */
    const sending = async <T>(work: () => Promise<T>): Promise<{ value: T | null; refusedNl: string | null; budget: boolean }> => {
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
        const refused = held.find((entry) => entry.writeBudget);
        if (!refused) {
          // A redirect out of the scope is held back too: the page that stays then says nothing about the site.
          const away = held.find((entry) => entry.resourceType === "document");
          if (failure && !away) throw failure;
          return { value, refusedNl: away ? `een doorverwijzing is tegengehouden (${away.kind})` : null, budget: false };
        }
        const wait = writeBudget(runDir, permission, Date.now(), SENDER).waitSeconds * 1000;
        if (refused.writeBudget !== "spacing" || Date.now() + wait - started > MAX_BUDGET_WAIT_MS) return { value, refusedNl: refused.reasonNl ?? "het budget voor versturen laat het niet toe", budget: true };
        await page.waitForTimeout(wait + 250);
      }
    };
    /** Ask the site to remove the registration. Only a budget that held it back leaves the site unasked; from anything else, also an error, the site may have got it. */
    const asking = async (work: () => Promise<void>): ReturnType<typeof sending<void>> => {
      const first = state.askedLinks === undefined;
      if (first) await updatingState(runDir, state, async () => void (state.askedLinks = state.links.length));
      asked = true;
      const result = await sending(work);
      if (result.budget) {
        asked = false;
        if (first) await updatingState(runDir, state, async () => void delete state.askedLinks);
      }
      return result;
    };
    const look = async (on: Page, url: string): Promise<Look> => {
      // A page that does not open says nothing either: that is noted, and the other links are still looked at.
      const { value, refusedNl } = await sending(() => loadPage(on, url)).catch((error: Error) => ({ value: null, refusedNl: `de link ging niet open: ${error.message.split("\n")[0]}`, budget: false }));
      const path = pathOf(on.url());
      return { path, status: value?.status ?? null, button: (await removeButton(on, shield)) !== null, login: isLoginPath(path) || path === loginPath || (await passwordFieldShows(on)), refusedNl };
    };
    const queue = CLEANUP_ORDER.flatMap((kind) => openable.filter((link) => link.kind === kind).map((link) => link.url));
    const visits: Visit[] = [];
    const proof = await tab();
    let removedOn: string | null = null;
    while (queue.length > 0 && visits.length < MAX_CLEANUP_PAGES && !removedOn) {
      const url = queue.shift()!;
      if (visits.some((visit) => visit.url === url)) continue;
      const before = await look(page, url);
      if (before.refusedNl) return { outcome: "mislukt", noteNl: `een persoonlijke link kon niet worden geopend: ${before.refusedNl}`, steps };
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
        if (pressed.budget) return { outcome: "mislukt", noteNl: `de site is niet gevraagd de aanmelding te verwijderen: ${pressed.refusedNl}`, steps };
        steps.push({ whatNl: `"${name}" ingedrukt${pressed.refusedNl ? ` (${pressed.refusedNl})` : ""}, de site ging naar`, path: pathOf(page.url()) });
        removedOn = url;
        break;
      }
      queue.push(...(await personalLinksOn(page, shield)));
    }
    if (!removedOn) {
      const oneClick = known.find((link) => link.oneClick);
      if (!oneClick) return { outcome: "mislukt", noteNl: openable.length < known.length ? "er kwam alleen een link binnen die de run nooit opende. De aanmelding is dus nooit bevestigd, en het opruimen opent zo'n link niet, omdat dat haar juist kan aanzetten. Ze blijft onbevestigd bij de site staan" : "geen knop gevonden om de aanmelding te verwijderen", steps };
      const posted = await asking(async () => {
        await page.evaluate((url) => fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", redirect: "manual" }).then(() => undefined), oneClick.url);
      });
      if (posted.budget) return { outcome: "mislukt", noteNl: `de afmelding met één klik is niet verstuurd: ${posted.refusedNl}`, steps };
      steps.push({ whatNl: "afmelding met één klik verstuurd (RFC 8058)", path: pathOf(oneClick.url) });
    }
    // The proof: a link that showed the registration twice now shows something else, by the hand of the site.
    const held: string[] = [];
    for (const visit of visits.filter((entry) => entry.stable)) {
      const after = await look(proof, visit.url);
      steps.push({ whatNl: `link opnieuw geopend (eerst ${visit.before.path}), de site gaf ${after.status ?? "geen antwoord"} en ging naar`, path: after.path });
      if (after.refusedNl) held.push(after.refusedNl);
      const gone = goneBy(visit.before, after);
      if (gone) return { outcome: "verwijderd", noteNl: `${gone}, terwijl ze dat eerst twee keer niet deed`, steps };
    }
    const why = visits.some((visit) => visit.stable) ? "geen link laat zien dat de aanmelding weg is" : "geen enkele link gaf twee keer hetzelfde, dus een verschil achteraf bewijst niets";
    return { outcome: "niet aangetoond", noteNl: `de site kreeg het verzoek, maar ${why}${held.length > 0 ? `; ${held[0]}` : ""}`, steps };
  } catch (error) {
    const brokeOffNl = `het opruimen op de site brak af: ${(error as Error).message.split("\n")[0]}`;
    return asked ? { outcome: "niet aangetoond", noteNl: `de site kan het verzoek hebben gekregen, maar ${brokeOffNl}`, steps } : { outcome: "mislukt", noteNl: brokeOffNl, steps };
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
  const { server, address, origins, state } = requireMailbox(runDir);
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen: de aanmelding kan dan niet via de site worden verwijderd");
  const since = new Date(state.since);
  const mail: MailboxCleanup["mail"] = { removed: 0, left: null, noteNl: null };
  let mailbox: Mailbox | null = null;
  // Only what was taken in may be wiped: a mail that was not read can hold the only link there is.
  const taken = new Set<string>();
  const skipped = new Set<string>();
  const takeIn = async (from: Mailbox): Promise<ReceivedMail[]> => {
    const waiting = await waitForMail(from, { address, since, timeoutMs: 0, once: true });
    const fresh = waiting.filter((message) => !taken.has(message.id) && !skipped.has(message.id));
    if (fresh.length === 0) return waiting;
    await updatingState(runDir, state, async () => {
      const read = new Set(absorbAll(runDir, origins, state, fresh).map((message) => message.id));
      for (const { id } of fresh) (read.has(id) ? taken : skipped).add(id);
    });
    return waiting;
  };
  try {
    mailbox = options.mailbox ?? openMailbox(server);
    // What arrived after the last wait may hold the only link there is.
    await takeIn(mailbox);
  } catch (error) {
    mail.noteNl = `de mailbox was niet te lezen: ${(error as Error).message}`;
  }
  const atSite = async (): Promise<SiteResult> => {
    let browser = options.browser ?? null;
    try {
      browser ??= await (options.launch ?? launchBrowser)();
      return await removeAtSite(browser, runDir, state, permission);
    } catch (error) {
      return { outcome: "mislukt", noteNl: `het opruimen op de site brak af: ${(error as Error).message.split("\n")[0]}`, steps: [] };
    } finally {
      if (!options.browser) await browser?.close().catch(() => undefined);
    }
  };
  // A registration that was shown to be gone stays gone: its links lead nowhere now, so a second round would find nothing to press.
  let site = state.cleanup?.site.outcome === "verwijderd" ? state.cleanup.site : await atSite();
  let linksTried = state.links.length;
  let rounds = 1;
  if (mailbox) {
    try {
      const { settleMs = SETTLE_MS, pollMs = SETTLE_POLL_MS } = options;
      let until = Date.now() + settleMs;
      mail.noteNl = null;
      // A site says with a mail that the registration is gone, a moment after that happened: what comes in during this time is read and wiped too.
      for (;;) {
        const ids = (await takeIn(mailbox)).filter((message) => taken.has(message.id)).map((message) => message.id);
        if (ids.length > 0) mail.removed += await mailbox.remove(ids);
        // A link that only came now can do what the earlier ones could not. Never after the site was asked: a later mail can hold a link that registers anew.
        if (state.links.length > linksTried && state.askedLinks === undefined && rounds < MAX_SITE_ROUNDS) {
          linksTried = state.links.length;
          rounds++;
          site = await atSite();
          until = Date.now() + settleMs;
          continue;
        }
        if (Date.now() >= until) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, until - Date.now())));
      }
      mail.left = (await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true })).length;
      mail.marked = await markedMail(mailbox, address, since);
      mail.checkedAt = new Date().toISOString();
      const unreadNl = skipped.size === 0 ? "" : `, waarvan ${skipped.size === 1 ? "1 bericht dat" : `${skipped.size} berichten die`} niet te lezen ${skipped.size === 1 ? "was" : "waren"} en daarom niet ${skipped.size === 1 ? "is" : "zijn"} gewist`;
      if (mail.left > 0) mail.noteNl = `er ${mail.left === 1 ? "staat nog 1 bericht" : `staan nog ${mail.left} berichten`} aan het adres van de run${unreadNl}`;
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
  const cleanup: MailboxCleanup = { at: new Date().toISOString(), site, mail, scan, complete: site.outcome === "verwijderd" && mail.left === 0 && (mail.marked ?? 0) === 0 && scan.hits.length === 0 && !scan.noteNl };
  await updatingState(runDir, state, async () => void (state.cleanup = cleanup));
  return cleanup;
}

/** The report of a cleanup for the terminal. */
export function cleanupLinesNl(cleanup: MailboxCleanup): string[] {
  return [
    `site: ${cleanup.site.outcome} (${cleanup.site.noteNl})`,
    ...cleanup.site.steps.map((step) => `  ${step.whatNl}${step.path ? ` ${step.path}` : ""}`),
    `mail: ${cleanup.mail.removed} gewist, ${cleanup.mail.left === null ? "niet na te gaan hoeveel er nog staat" : `${cleanup.mail.left} over${cleanup.mail.marked ? `, ${cleanup.mail.marked} alleen gemarkeerd` : ""}`}${cleanup.mail.noteNl ? ` (${cleanup.mail.noteNl})` : ""}${cleanup.mail.checkedAt ? `; nagegaan op ${cleanup.mail.checkedAt}, wat daarna binnenkwam is niet gezien` : ""}`,
    `run: ${cleanup.scan.noteNl ?? `${cleanup.scan.files} bestanden doorzocht`}, ${cleanup.scan.hits.length} keer een geheim gevonden${cleanup.scan.compressed > 0 ? `; ${cleanup.scan.compressed} afbeeldingen of PDF-bestanden zijn gecomprimeerd, daar zegt deze zoekactie weinig over` : ""}`,
    cleanup.complete ? "opgeruimd" : "ER BLEEF IETS ACHTER: het rapport zegt dat. Draai dit commando opnieuw of haal het met de hand weg",
  ];
}
