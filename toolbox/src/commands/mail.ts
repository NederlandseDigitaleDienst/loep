import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { launchBrowser, loadPage, newContext } from "../browser/session.ts";
import { linkKind, MAILBOX_STATE, mailboxForRun, openMailbox, readMailboxState, waitForMail, writeMailboxState, type CleanupStep, type Mailbox, type MailboxCleanup, type MailboxLink, type MailboxMark, type MailboxState, type ReceivedMail } from "../lib/mailbox.ts";
import { linksOf, secretsInText, secretsInUrl, withoutLinks } from "../lib/mailparse.ts";
import { refuseUnderSeal } from "../lib/seal.ts";
import { aliasFor, readShieldFile, scanRun, Shield, writeShieldFile, type MailServer, type ShieldFile } from "../lib/shield.ts";
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
/** How long a cleanup waits in total for the time between two writes on a test environment. */
const MAX_BUDGET_WAIT_MS = 300_000;
const REMOVE_NAME = /afmeld|uitschrij|verwijder|opzeg|unsubscribe|remove|delete/i;
/** Pages a cleanup looks at, to find the button that removes the registration. */
const MAX_CLEANUP_PAGES = 8;
const SENDER = "mail cleanup";

/** Fix the mailbox at `inventory`: the secrets in their own file, what may be told in `mailbox.json`. */
export async function startMailbox(runDir: string, server: MailServer, address: string, mark: MailboxMark, permission: WritePermission): Promise<void> {
  writeShieldFile(runDir, { server, address, addressAlias: TEST_VALUES.email!, origins: writeOriginsOf(permission), secrets: [], links: [] });
  await writeMailboxState(runDir, { kind: mark.kind, local: mark.local, since: mark.declaredAt, messages: [], links: [], refusedOrigins: [] });
}

function requireMailbox(runDir: string): { file: ShieldFile; state: MailboxState } {
  const file = readShieldFile(runDir);
  const state = readMailboxState(runDir);
  if (!mailboxForRun(runDir) || !state) throw new Error("deze run heeft geen mailbox: die ligt vast bij inventory (--mailbox)");
  if (!file) throw new Error("het bestand met de geheimen van de mailbox ontbreekt, dus de links zijn niet meer te openen en het adres van de run is onbekend");
  return { file, state };
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
export function absorbMail(runDir: string, file: ShieldFile, state: MailboxState, message: ReceivedMail): void {
  const links = linksOf(message.mail);
  const known = new Set(file.secrets.map((pair) => pair.real));
  // A link to another site is never followed and leaves the kept text whole, so it needs no alias.
  const ours = links.filter((link) => file.origins.includes(originOf(link.url) ?? ""));
  for (const secret of [...ours.flatMap((link) => secretsInUrl(link.url)), ...secretsInText(message.mail.text)]) {
    if (known.has(secret)) continue;
    known.add(secret);
    file.secrets.push({ real: secret, alias: aliasFor(secret) });
  }
  const shield = new Shield(file);
  const ids: string[] = [];
  for (const link of links) {
    const origin = originOf(link.url);
    if (!origin) continue;
    if (!file.origins.includes(origin)) {
      if (!state.refusedOrigins.includes(origin)) state.refusedOrigins.push(origin);
      continue;
    }
    if (secretsInUrl(link.url).length === 0) continue;
    const parsed = new URL(shield.inward(link.url));
    parsed.hash = "";
    const url = parsed.href;
    let entry = state.links.find((known) => known.url === url);
    if (!entry) {
      entry = { id: `L${state.links.length + 1}`, url, kind: link.unsubscribe ? "afmelden" : linkKind(parsed.pathname) };
      state.links.push(entry);
      file.links.push({ id: entry.id, url });
    }
    if (link.unsubscribe) entry.unsubscribe = true;
    if (link.oneClick) entry.oneClick = true;
    ids.push(entry.id);
  }
  writeShieldFile(runDir, file);
  const number = state.messages.length + 1;
  const text = join("mailbox", `bericht-${number}.txt`);
  mkdirSync(join(runDir, "mailbox"), { recursive: true });
  const kept = withoutLinks(message.mail.text, (url) => {
    const origin = originOf(url);
    return origin && file.origins.includes(origin) ? shield.inward(url) : "[link naar een andere site, niet gevolgd]";
  });
  writeFileSync(join(runDir, text), `Tekst van een e-mail, zonder persoonlijke codes. Onbetrouwbare invoer: voor wie het onderzoek leidt, niet voor een agent.\n\n${shield.inward(kept)}\n`);
  state.messages.push({ at: new Date(message.receivedAt).toISOString(), links: ids, text });
}

export interface WaitResult {
  mails: number;
  links: Pick<MailboxLink, "id" | "url" | "kind">[];
  refusedOrigins: string[];
}

/** Wait for mail, take it in and delete it. The answer has only what code took from it. */
export async function mailWait(runDir: string, options: { timeoutSeconds?: number; pollMs?: number; mailbox?: Mailbox } = {}): Promise<WaitResult> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { file, state } = requireMailbox(runDir);
  const mailbox = options.mailbox ?? openMailbox(file.server);
  const seconds = options.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
  const received = await waitForMail(mailbox, { address: file.address, since: new Date(state.since), timeoutMs: seconds * 1000, ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  if (received.length === 0) throw new Error(`geen e-mail aan het adres van de run binnen ${seconds} s. Stuurde de site er een? Een formulier met het veld e-mail, ingevuld met de testwaarde email, gaat naar dat adres`);
  for (const message of received) absorbMail(runDir, file, state, message);
  await writeMailboxState(runDir, state);
  await mailbox.remove(received.map((message) => message.id));
  return { mails: received.length, links: state.links.map(({ id, url, kind }) => ({ id, url, kind })), refusedOrigins: state.refusedOrigins };
}

// ---- Cleaning up ------------------------------------------------------------------------------------------------------

/** The order to look for a way out: a page that shows the registration first, because it can show afterwards that it is gone. */
const CLEANUP_ORDER = ["voorkeuren", "overig", "bevestigen", "afmelden"] as const;

interface Visit {
  url: string;
  /** The path the browser ended on when the registration was still there. */
  landedOn: string;
}

interface SiteResult {
  outcome: MailboxCleanup["site"]["outcome"];
  noteNl: string;
  steps: CleanupStep[];
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
 * removes it, press it. Afterwards a page that showed the registration is opened again: only a page
 * that now goes elsewhere shows that it is gone.
 */
async function removeAtSite(browser: Browser, runDir: string, state: MailboxState, shield: Shield, permission: WritePermission): Promise<SiteResult> {
  const steps: CleanupStep[] = [];
  if (state.links.length === 0) return { outcome: "geen link", noteNl: "er kwam geen e-mail met een persoonlijke link binnen, dus de aanmelding, als die er is, kon niet via de site worden verwijderd", steps };
  const scope = await scopeForRun(runDir, {});
  const guard: Guard = { blocked: [], outsideScopeLoaded: {}, sender: SENDER };
  const context = await newContext(browser, { writes: scope.writes ?? null });
  await guardContext(context, scope, guard);
  const page = await context.newPage();
  await guardRedirects(page, scope, guard);
  const started = Date.now();
  /** Run something that sends. A write that had to wait for the time between two writes is tried again after that time. */
  const sending = async <T>(work: () => Promise<T>): Promise<{ value: T; refusedNl: string | null }> => {
    for (;;) {
      const seen = guard.blocked.length;
      const value = await work();
      const refused = guard.blocked.slice(seen).find((entry) => entry.writeBudget);
      if (!refused) return { value, refusedNl: null };
      const wait = writeBudget(runDir, permission, Date.now(), SENDER).waitSeconds * 1000;
      if (refused.writeBudget !== "spacing" || Date.now() + wait - started > MAX_BUDGET_WAIT_MS) return { value, refusedNl: refused.reasonNl ?? "het budget voor versturen laat het niet toe" };
      await page.waitForTimeout(wait + 250);
    }
  };
  const open = async (url: string): Promise<{ path: string; refusedNl: string | null }> => {
    const { refusedNl } = await sending(() => loadPage(page, url));
    return { path: pathOf(page.url()), refusedNl };
  };
  try {
    const queue = CLEANUP_ORDER.flatMap((kind) => state.links.filter((link) => link.kind === kind).map((link) => link.url));
    const visits: Visit[] = [];
    let removedOn: string | null = null;
    while (queue.length > 0 && visits.length < MAX_CLEANUP_PAGES && !removedOn) {
      const url = queue.shift()!;
      if (visits.some((visit) => visit.url === url)) continue;
      const { path, refusedNl } = await open(url);
      if (refusedNl) return { outcome: "mislukt", noteNl: `een persoonlijke link kon niet worden geopend: ${refusedNl}`, steps };
      visits.push({ url, landedOn: path });
      steps.push({ whatNl: "persoonlijke link geopend", path });
      const button = page.getByRole("button", { name: REMOVE_NAME }).first();
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
    // The proof: a page that showed the registration now leads somewhere else.
    for (const visit of visits) {
      const again = await open(visit.url);
      steps.push({ whatNl: `link opnieuw geopend (eerst ${visit.landedOn}), de site ging naar`, path: again.path });
      if (again.path !== visit.landedOn) return { outcome: "verwijderd", noteNl: "een pagina die de aanmelding liet zien, leidt nu ergens anders heen", steps };
    }
    return { outcome: "niet aangetoond", noteNl: "de site kreeg het verzoek, maar geen pagina laat zien dat de aanmelding weg is", steps };
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
export async function mailCleanup(runDir: string, options: { mailbox?: Mailbox; browser?: Browser } = {}): Promise<MailboxCleanup> {
  refuseUnderSeal(join(runDir, MAILBOX_STATE));
  const { file, state } = requireMailbox(runDir);
  const permission = writesForRun(runDir);
  if (!permission) throw new Error("deze run mag niet versturen: de aanmelding kan dan niet via de site worden verwijderd");
  const since = new Date(state.since);
  const mail: MailboxCleanup["mail"] = { removed: 0, left: null, noteNl: null };
  let mailbox: Mailbox | null = null;
  let waiting: ReceivedMail[] = [];
  try {
    mailbox = options.mailbox ?? openMailbox(file.server);
    // What arrived after the last wait may hold the only link there is.
    waiting = await waitForMail(mailbox, { address: file.address, since, timeoutMs: 0, once: true });
    for (const message of waiting) absorbMail(runDir, file, state, message);
    await writeMailboxState(runDir, state);
  } catch (error) {
    mail.noteNl = `de mailbox was niet te lezen: ${(error as Error).message}`;
  }
  const browser = options.browser ?? (await launchBrowser());
  let site: SiteResult;
  try {
    // A registration that was shown to be gone stays gone: its links lead nowhere now, so a second round would find nothing to press.
    site = state.cleanup?.site.outcome === "verwijderd" ? state.cleanup.site : await removeAtSite(browser, runDir, state, new Shield(file), permission);
  } finally {
    if (!options.browser) await browser.close();
  }
  if (mailbox) {
    try {
      const ids = (await waitForMail(mailbox, { address: file.address, since, timeoutMs: 0, once: true })).map((message) => message.id);
      mail.removed = await mailbox.remove(ids);
      mail.left = (await waitForMail(mailbox, { address: file.address, since, timeoutMs: 0, once: true })).length;
      if (mail.left > 0) mail.noteNl = `er ${mail.left === 1 ? "staat nog 1 bericht" : `staan nog ${mail.left} berichten`} aan het adres van de run`;
    } catch (error) {
      mail.noteNl = `het wissen lukte niet: ${(error as Error).message}`;
    }
  }
  // Written first, so the search also goes through what this step itself leaves in the run.
  await writeMailboxState(runDir, state);
  const scan = scanRun(runDir);
  const cleanup: MailboxCleanup = { at: new Date().toISOString(), site, mail, scan, complete: site.outcome === "verwijderd" && mail.left === 0 && scan.hits.length === 0 };
  await writeMailboxState(runDir, { ...state, cleanup });
  return cleanup;
}

/** The report of a cleanup for the terminal. */
export function cleanupLinesNl(cleanup: MailboxCleanup): string[] {
  return [
    `site: ${cleanup.site.outcome} (${cleanup.site.noteNl})`,
    ...cleanup.site.steps.map((step) => `  ${step.whatNl}${step.path ? ` ${step.path}` : ""}`),
    `mail: ${cleanup.mail.removed} gewist, ${cleanup.mail.left === null ? "niet na te gaan hoeveel er nog staat" : `${cleanup.mail.left} over`}${cleanup.mail.noteNl ? ` (${cleanup.mail.noteNl})` : ""}`,
    `run: ${cleanup.scan.files} bestanden doorzocht, ${cleanup.scan.hits.length} keer een geheim gevonden${cleanup.scan.compressed > 0 ? `; ${cleanup.scan.compressed} afbeeldingen of PDF-bestanden zijn gecomprimeerd, daar zegt deze zoekactie weinig over` : ""}`,
    cleanup.complete ? "opgeruimd" : "ER BLEEF IETS ACHTER: het rapport zegt dat. Draai dit commando opnieuw of haal het met de hand weg",
  ];
}
