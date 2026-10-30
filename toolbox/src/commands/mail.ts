import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright";
import { launchBrowser, loadPage, newContext } from "../browser/session.ts";
import { linkKind, MAIL_ADDRESS_SOURCE, MAIL_CODE_SOURCE, MAIL_LINK_SOURCE, MAIL_PRIVATE, MAILBOX_STATE, mailboxForRun, markedMail, openMailbox, readMailboxState, waitForMail, writeMailboxState, type CleanupStep, type MailServer, type Mailbox, type MailboxCleanup, type MailboxLink, type MailboxMark, type MailboxState, type ReceivedMail } from "../lib/mailbox.ts";
import { linksOf, secretsInText, secretsInUrl, spelledSecretsInUrl, withoutLinks } from "../lib/mailparse.ts";
import { refuseUnderSeal } from "../lib/seal.ts";
import { keepPrivate, readPrivate, readSecretsFile, registerGuarded, registerSecret, registerSecrets, scanRun, shieldForRun, type NewSecret, type Shield } from "../lib/secrets.ts";
import { writeBudget, writeOriginsOf, writesForRun, type WritePermission } from "../lib/writes.ts";
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
  mail status --run <run>                What mailbox.json says, without opening the mailbox
`;

const DEFAULT_WAIT_SECONDS = 120;
/** How long a cleanup goes on looking after the registration is gone: a site confirms that with a mail, and that takes a moment. */
const SETTLE_MS = 20_000;
const SETTLE_POLL_MS = 2000;
/** How long a cleanup waits in total for the time between two writes on a test environment. */
const MAX_BUDGET_WAIT_MS = 300_000;
const REMOVE_NAME = /afmeld|uitschrij|verwijder|opzeg|unsubscribe|remove|delete/i;
/** Pages a cleanup looks at, to find the button that removes the registration. */
const MAX_CLEANUP_PAGES = 8;
const SENDER = "mail cleanup";

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

export interface WaitResult {
  mails: number;
  links: Pick<MailboxLink, "id" | "url" | "kind">[];
  refusedOrigins: string[];
}

/** Wait for mail, take it in and delete it. The answer has only what code took from it. */
export async function mailWait(runDir: string, options: { timeoutSeconds?: number; pollMs?: number; mailbox?: Mailbox } = {}): Promise<WaitResult> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, address, origins, state } = requireMailbox(runDir);
  const mailbox = options.mailbox ?? openMailbox(server);
  const seconds = options.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
  const received = await waitForMail(mailbox, { address, since: new Date(state.since), timeoutMs: seconds * 1000, ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  if (received.length === 0) throw new Error(`geen e-mail aan het adres van de run binnen ${seconds} s. Stuurde de site er een? Een formulier met het veld e-mail, ingevuld met de testwaarde email, gaat naar dat adres`);
  const taken = absorbAll(runDir, origins, state, received);
  await writeMailboxState(runDir, state);
  await mailbox.remove(taken.map((message) => message.id));
  return { mails: received.length, links: state.links.map(({ id, url, kind }) => ({ id, url, kind })), refusedOrigins: state.refusedOrigins };
}

// ---- Cleaning up ------------------------------------------------------------------------------------------------------

/** The order to look for a way out: a page that shows the registration first, because it can show afterwards that it is gone. */
const CLEANUP_ORDER = ["voorkeuren", "overig", "bevestigen", "afmelden"] as const;

/** What a personal link gave when it was opened. */
interface Look {
  /** The path the browser ended on. */
  path: string;
  status: number | null;
  /** Whether the button that removes the registration stands there. */
  button: boolean;
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
  if (after.refusedNl || after.status === null) return null;
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

const removeButton = (page: Page): Locator => page.getByRole("button", { name: REMOVE_NAME }).first();

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
async function removeAtSite(browser: Browser, runDir: string, state: MailboxState, shield: Shield, permission: WritePermission): Promise<SiteResult> {
  const steps: CleanupStep[] = [];
  if (state.links.length === 0) return { outcome: "geen link", noteNl: "er kwam geen e-mail met een persoonlijke link binnen, dus de aanmelding, als die er is, kon niet via de site worden verwijderd", steps };
  const scope = await scopeForRun(runDir, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: SENDER };
  const context = await newContext(browser, { writes: scope.writes ?? null });
  await guardContext(context, scope, guard);
  const tab = async (): Promise<Page> => {
    const opened = await context.newPage();
    await guardRedirects(opened, scope, guard);
    return opened;
  };
  const page = await tab();
  const started = Date.now();
  /**
   * Run something that sends. A write that had to wait for the time between two writes is tried again
   * after that time. A navigation that was held back ends in an error of the browser: that is the refusal, no failure.
   */
  const sending = async <T>(work: () => Promise<T>): Promise<{ value: T | null; refusedNl: string | null }> => {
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
        return { value, refusedNl: away ? `een doorverwijzing is tegengehouden (${away.kind})` : null };
      }
      const wait = writeBudget(runDir, permission, Date.now(), SENDER).waitSeconds * 1000;
      if (refused.writeBudget !== "spacing" || Date.now() + wait - started > MAX_BUDGET_WAIT_MS) return { value, refusedNl: refused.reasonNl ?? "het budget voor versturen laat het niet toe" };
      await page.waitForTimeout(wait + 250);
    }
  };
  const look = async (on: Page, url: string): Promise<Look> => {
    // A page that does not open says nothing either: that is noted, and the other links are still looked at.
    const { value, refusedNl } = await sending(() => loadPage(on, url)).catch((error: Error) => ({ value: null, refusedNl: `de link ging niet open: ${error.message.split("\n")[0]}` }));
    return { path: pathOf(on.url()), status: value?.status ?? null, button: await removeButton(on).isVisible().catch(() => false), refusedNl };
  };
  try {
    const queue = CLEANUP_ORDER.flatMap((kind) => state.links.filter((link) => link.kind === kind).map((link) => link.url));
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
      const button = removeButton(page);
      if (await button.isVisible().catch(() => false)) {
        const name = (await button.textContent().catch(() => null))?.trim() || "de knop om te verwijderen";
        const pressed = await sending(async () => {
          await button.click({ timeout: 5000 });
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        });
        if (pressed.refusedNl) return { outcome: "mislukt", noteNl: `de site is niet gevraagd de aanmelding te verwijderen: ${pressed.refusedNl}`, steps };
        steps.push({ whatNl: `"${name}" ingedrukt, de site ging naar`, path: pathOf(page.url()) });
        removedOn = url;
        break;
      }
      queue.push(...(await personalLinksOn(page, shield)));
    }
    if (!removedOn) {
      const oneClick = state.links.find((link) => link.oneClick);
      if (!oneClick) return { outcome: "mislukt", noteNl: "geen knop gevonden om de aanmelding te verwijderen", steps };
      const posted = await sending(async () => {
        await page.evaluate((url) => fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", redirect: "manual" }).then(() => undefined), oneClick.url);
      });
      if (posted.refusedNl) return { outcome: "mislukt", noteNl: `de afmelding met één klik is niet verstuurd: ${posted.refusedNl}`, steps };
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
    return { outcome: "mislukt", noteNl: `het opruimen op de site brak af: ${(error as Error).message.split("\n")[0]}`, steps };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Clean up, also after a run that broke off: everything needed stands in the run. Each part is tried
 * whatever the part before it did, and it can be run again until nothing stays behind.
 */
export async function mailCleanup(runDir: string, options: { mailbox?: Mailbox; browser?: Browser; settleMs?: number; pollMs?: number } = {}): Promise<MailboxCleanup> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { server, address, origins, state } = requireMailbox(runDir);
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen: de aanmelding kan dan niet via de site worden verwijderd");
  const since = new Date(state.since);
  const mail: MailboxCleanup["mail"] = { removed: 0, left: null, noteNl: null };
  let mailbox: Mailbox | null = null;
  let waiting: ReceivedMail[] = [];
  try {
    mailbox = options.mailbox ?? openMailbox(server);
    // What arrived after the last wait may hold the only link there is.
    waiting = await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true });
    absorbAll(runDir, origins, state, waiting);
    await writeMailboxState(runDir, state);
  } catch (error) {
    mail.noteNl = `de mailbox was niet te lezen: ${(error as Error).message}`;
  }
  const browser = options.browser ?? (await launchBrowser());
  let site: SiteResult;
  try {
    // A registration that was shown to be gone stays gone: its links lead nowhere now, so a second round would find nothing to press.
    site = state.cleanup?.site.outcome === "verwijderd" ? state.cleanup.site : await removeAtSite(browser, runDir, state, shieldForRun(runDir)!, permission);
  } finally {
    if (!options.browser) await browser.close();
  }
  if (mailbox) {
    try {
      const { settleMs = SETTLE_MS, pollMs = SETTLE_POLL_MS } = options;
      const until = Date.now() + settleMs;
      // A site says with a mail that the registration is gone, a moment after that happened: what comes in during this time is wiped too.
      for (;;) {
        const ids = (await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true })).map((message) => message.id);
        if (ids.length > 0) mail.removed += await mailbox.remove(ids);
        if (Date.now() >= until) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, until - Date.now())));
      }
      mail.left = (await waitForMail(mailbox, { address, since, timeoutMs: 0, once: true })).length;
      mail.marked = await markedMail(mailbox, address, since);
      mail.checkedAt = new Date().toISOString();
      if (mail.left > 0) mail.noteNl = `er ${mail.left === 1 ? "staat nog 1 bericht" : `staan nog ${mail.left} berichten`} aan het adres van de run`;
      else if (mail.marked > 0) mail.noteNl = `${mail.marked === 1 ? "1 bericht is" : `${mail.marked} berichten zijn`} op de server alleen gemarkeerd als verwijderd: deze server kan geen enkel bericht apart wissen, en de hele postbus legen kan ook mail van anderen raken. Het bericht staat er nog, met de persoonlijke link erin, tot iemand de postbus leegt`;
    } catch (error) {
      mail.noteNl = `het wissen lukte niet: ${(error as Error).message}`;
    }
  }
  // Written first, so the search also goes through what this step itself leaves in the run.
  await writeMailboxState(runDir, state);
  const scan = scanRun(runDir);
  const cleanup: MailboxCleanup = { at: new Date().toISOString(), site, mail, scan, complete: site.outcome === "verwijderd" && mail.left === 0 && (mail.marked ?? 0) === 0 && scan.hits.length === 0 };
  await writeMailboxState(runDir, { ...state, cleanup });
  return cleanup;
}

/** The report of a cleanup for the terminal. */
export function cleanupLinesNl(cleanup: MailboxCleanup): string[] {
  return [
    `site: ${cleanup.site.outcome} (${cleanup.site.noteNl})`,
    ...cleanup.site.steps.map((step) => `  ${step.whatNl}${step.path ? ` ${step.path}` : ""}`),
    `mail: ${cleanup.mail.removed} gewist, ${cleanup.mail.left === null ? "niet na te gaan hoeveel er nog staat" : `${cleanup.mail.left} over${cleanup.mail.marked ? `, ${cleanup.mail.marked} alleen gemarkeerd` : ""}`}${cleanup.mail.noteNl ? ` (${cleanup.mail.noteNl})` : ""}${cleanup.mail.checkedAt ? `; nagegaan op ${cleanup.mail.checkedAt}, wat daarna binnenkwam is niet gezien` : ""}`,
    `run: ${cleanup.scan.files} bestanden doorzocht, ${cleanup.scan.hits.length} keer een geheim gevonden${cleanup.scan.compressed > 0 ? `; ${cleanup.scan.compressed} afbeeldingen of PDF-bestanden zijn gecomprimeerd, daar zegt deze zoekactie weinig over` : ""}`,
    cleanup.complete ? "opgeruimd" : "ER BLEEF IETS ACHTER: het rapport zegt dat. Draai dit commando opnieuw of haal het met de hand weg",
  ];
}
