import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Page } from "playwright";
import { readJson, writeJson } from "./canonical.ts";
import { looksSecret } from "./mailparse.ts";
import { registerSecrets, renewSecrets, shieldForRun, type NewSecret } from "./secrets.ts";
import { isLocalHost, writeOriginsOf, writesForRun, type WritePermission } from "./writes.ts";

/**
 * A site behind a login. A person logs in, in a browser on a screen; the toolbox takes over
 * the session that leaves behind (cookies and stored values). The password never reaches the
 * toolbox or an agent. The session is a secret: it stands in one file of the run that is left
 * out of the seal, the report and every dossier. What may be told about it (that there was a
 * login, in which role, which page shows it) stands in the manifest.
 */

/** The file of a run that holds the session. Never sealed, never read into evidence. */
export const LOGIN_SESSION_FILE = "login-session.json";
/**
 * A second session of the same kind, made with `login --idle`, that only the watch on the session
 * uses (`watch-session`): the measurement keeps its own session busy, this one stays quiet. The
 * same rules hold: outside the seal, readable for its owner only, never read by an agent.
 */
export const IDLE_SESSION_FILE = "idle-session.json";
/** The register of the secrets of a run, with the real values behind their aliases (see `secrets.ts`). */
export const RUN_SECRETS_FILE = "secrets.json";
const SCHEMA = "loep/login-session/1";

/** Cookies and stored values the way Playwright keeps them (`storageState`). */
export interface StorageState {
  cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None" }[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

/** What may be told about a login, and what tells a logged-in page from the login screen. Nothing here is a secret. */
export interface LoginMark {
  /** The origin of the site the session is for. */
  origin: string;
  /** The login page as the person opened it, without query. */
  loginUrl: string;
  /** The page the person pointed at after logging in: it shows only with a session. */
  landingUrl: string;
  /** The role of the test account, in the words of who logged in. Never the name of a person. */
  role: string | null;
  loggedInAt: string;
}

export interface LoginSession extends LoginMark {
  schema: typeof SCHEMA;
  storageState: StorageState;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const originOf = (address: unknown): string | null => {
  try {
    const url = new URL(String(address));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/** Whether a cookie is sent to a host: the host itself or a domain above it. */
const cookieFits = (domain: string, hostname: string): boolean => {
  const bare = domain.replace(/^\./, "").toLowerCase();
  return hostname.toLowerCase() === bare || hostname.toLowerCase().endsWith(`.${bare}`);
};

/**
 * Everything that is wrong with a session file, in Dutch; empty when it can be used. With
 * `origin` the session must be for that site: a file made for another site is refused.
 */
export function loginSessionProblems(value: unknown, origin?: string | null): string[] {
  if (!isRecord(value) || value.schema !== SCHEMA) return [`dit is geen sessiebestand van loep (verwacht "schema": "${SCHEMA}"); maak het met loep login`];
  const problems: string[] = [];
  const own = originOf(value.origin);
  if (!own) problems.push("origin ontbreekt of is geen adres met http:// of https://");
  for (const key of ["loginUrl", "landingUrl"] as const) if (originOf(value[key]) === null) problems.push(`${key} ontbreekt of is geen adres`);
  if (typeof value.loggedInAt !== "string" || Number.isNaN(Date.parse(value.loggedInAt))) problems.push("loggedInAt ontbreekt of is geen tijdstip");
  if (value.role !== null && typeof value.role !== "string") problems.push("role is geen tekst");
  const state = value.storageState;
  if (!isRecord(state) || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) return [...problems, "storageState heeft niet de vorm van Playwright (cookies en origins)"];
  const cookies = state.cookies as unknown[];
  const origins = state.origins as unknown[];
  if (cookies.some((cookie) => !isRecord(cookie) || typeof cookie.name !== "string" || typeof cookie.value !== "string" || typeof cookie.domain !== "string")) problems.push("een cookie heeft geen naam, waarde of domein");
  if (origins.some((entry) => !isRecord(entry) || typeof entry.origin !== "string" || !Array.isArray(entry.localStorage))) problems.push("een origin heeft geen adres of geen lijst localStorage");
  if (problems.length > 0) return problems;
  const stored = (origins as StorageState["origins"]).filter((entry) => entry.localStorage.length > 0);
  if (cookies.length === 0 && stored.length === 0) return ["het bestand is leeg: geen cookie en geen opgeslagen waarde. Er is dan niet ingelogd"];
  const host = new URL(own!).hostname;
  if (!(cookies as StorageState["cookies"]).some((cookie) => cookieFits(cookie.domain, host)) && !stored.some((entry) => entry.origin === own)) problems.push(`geen cookie en geen opgeslagen waarde hoort bij ${own}`);
  if (origin && own !== origin) problems.push(`de sessie is voor ${own} en deze run onderzoekt ${origin}`);
  return problems;
}

/** The part of a session that may be told. */
export const markOf = (session: LoginMark): LoginMark => ({ origin: session.origin, loginUrl: session.loginUrl, landingUrl: session.landingUrl, role: session.role, loggedInAt: session.loggedInAt });

/** The files of a run that hold a secret. Never in a commit, a task for an agent or a message. */
export const SECRET_FILES: readonly string[] = [LOGIN_SESSION_FILE, IDLE_SESSION_FILE];

/**
 * Put a `.gitignore` in the run that keeps its secret files out of git, for whoever keeps the
 * run in a repository. A line that is missing is added; what is there stays, so a run that is
 * already sealed does not change when nothing is missing.
 */
export function ignoreSecrets(runDir: string, names: readonly string[] = SECRET_FILES): void {
  const path = join(runDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(existing.split("\n").map((line) => line.trim().replace(/^\//, "")));
  const missing = names.filter((name) => !lines.has(name));
  if (missing.length === 0) return;
  mkdirSync(runDir, { recursive: true });
  const lead = existing === "" ? "# Sessiebestanden van een inlog: wie ze heeft, is ingelogd. Nooit in een commit.\n" : existing.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${existing}${lead}${missing.map((name) => `${name}\n`).join("")}`);
}

/** Write a session where only its owner can read it. */
export function writeLoginFile(path: string, session: LoginSession): void {
  mkdirSync(dirname(path), { recursive: true });
  // A session in a run: whoever keeps the run in a repository does not commit it by accident.
  if (SECRET_FILES.includes(basename(path))) ignoreSecrets(dirname(path));
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  // The mode above only counts for a new file: a file that was there keeps the rights it had.
  chmodSync(path, 0o600);
}

/** Read a session file and refuse one that cannot be used. */
export function readLoginFile(path: string, origin?: string | null): LoginSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is niet te lezen als JSON; maak het sessiebestand opnieuw met loep login`);
  }
  const problems = loginSessionProblems(parsed, origin);
  if (problems.length > 0) throw new Error(`${path} is geen bruikbaar sessiebestand: ${problems.join("; ")}`);
  return parsed as LoginSession;
}

/** What the manifest of a run says about its login. Null for a run without. */
export function loginForRun(runDir: string): LoginMark | null {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, "utf8")) as { login?: LoginMark }).login ?? null;
}

/** The site a run is about, when its inventory was made. */
export function siteOriginOfRun(runDir: string): string | null {
  const path = join(runDir, "inventory.json");
  return existsSync(path) ? ((JSON.parse(readFileSync(path, "utf8")) as { origin?: string }).origin ?? null) : null;
}

// ---- A session as a secret ----------------------------------------------------------------------------------------

export const SESSION_COOKIE_SOURCE = "sessie-cookie";
export const SESSION_STORAGE_SOURCE = "sessie-opslag";

/** The strings in a stored value that may be a token. A JSON value keeps its shape, so a page can still read it. */
function storedSecrets(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      const leaves = (node: unknown): string[] => (typeof node === "string" ? [node] : typeof node === "object" && node !== null ? Object.values(node).flatMap(leaves) : []);
      return leaves(parsed).filter(looksSecret);
    }
  } catch {
    // No JSON: the value as a whole.
  }
  return looksSecret(value) ? [value] : [];
}

function sessionSecrets(state: StorageState, origin: string): NewSecret[] {
  return [
    ...state.cookies.filter((cookie) => looksSecret(cookie.value)).map((cookie): NewSecret => ({ value: cookie.value, source: SESSION_COOKIE_SOURCE, origins: [origin], domains: [cookie.domain] })),
    ...state.origins.flatMap((entry) => entry.localStorage.flatMap((item) => storedSecrets(item.value).map((value): NewSecret => ({ value, source: SESSION_STORAGE_SOURCE, origins: [entry.origin] })))),
  ];
}

/**
 * Put the values of the sessions of a run in the register, so that a session is no more than any other
 * secret: what was noted about it holds for every value, whatever the source. Done again for each
 * context, also for a run that was made before this existed. A run without a session stays one without
 * secrets.
 */
export function registerSessionSecrets(runDir: string): void {
  for (const name of [LOGIN_SESSION_FILE, IDLE_SESSION_FILE]) {
    const path = join(runDir, name);
    if (!existsSync(path)) continue;
    const session = JSON.parse(readFileSync(path, "utf8")) as Partial<LoginSession>;
    // A file that cannot be used says so where it is read for use.
    if (session.storageState?.cookies && session.storageState.origins && session.origin) registerSecrets(runDir, sessionSecrets(session.storageState, session.origin));
  }
}

/** A session in which every value is its alias. A browser of a run starts with this; the boundary fills in the real values towards the site. */
export function sessionWithAliases(runDir: string, state: StorageState): StorageState {
  const shield = shieldForRun(runDir);
  if (!shield) return state;
  return {
    cookies: state.cookies.map((cookie) => ({ ...cookie, value: shield.inward(cookie.value) })),
    origins: state.origins.map((entry) => ({ ...entry, localStorage: entry.localStorage.map((item) => ({ ...item, value: shield.inward(item.value) })) })),
  };
}

/**
 * A site renews a session as it likes, some with every answer: in a run with a session what looks like
 * a token in a `Set-Cookie` is a secret from now on, before the browser gets it. It takes the place of
 * the value the cookie had, so the register does not grow with every answer.
 */
export function renewSessionSecrets(runDir: string, headers: { "set-cookie"?: string | string[] | undefined }, url: URL): void {
  const cookies = [headers["set-cookie"] ?? []].flat();
  if (cookies.length === 0 || !shieldForRun(runDir)?.hasSource(SESSION_COOKIE_SOURCE)) return;
  renewSecrets(
    runDir,
    cookies.flatMap((cookie) => {
      const [, name, value = ""] = /^([^=;]+)=([^;]*)/.exec(cookie) ?? [];
      const domain = /;\s*domain=([^;]+)/i.exec(cookie)?.[1]?.trim();
      return name && looksSecret(value) ? [{ value, source: SESSION_COOKIE_SOURCE, origins: [url.origin], ...(domain ? { domains: [domain] } : {}), slot: `cookie ${domain ?? url.origin} ${name.trim()}` }] : [];
    }),
  );
}

/** The run the login of this process is for. */
export const runOfLogin = (): string | null => current?.runDir ?? null;

/** Put a session in a run: the secret in its own file, what may be told in the manifest. */
export async function storeLoginSession(runDir: string, session: LoginSession): Promise<void> {
  writeLoginFile(join(runDir, LOGIN_SESSION_FILE), session);
  const path = join(runDir, "manifest.json");
  const manifest = existsSync(path) ? await readJson<Record<string, unknown>>(path) : ({ steps: [] } as Record<string, unknown>);
  await writeJson(path, { ...manifest, login: markOf(session) });
}

/**
 * Why a run with a login may not go on, in Dutch; null when it may. Behind a login nearly
 * every click changes something and every screenshot shows what belongs to the account, so a
 * site that is not on this machine is only examined on a test environment that somebody who
 * is in charge of it declared to be one.
 */
export function loginRefusalNl(origin: string, writes: WritePermission | null): string | null {
  if (isLocalHost(new URL(origin).hostname)) return null;
  if (writes && !writes.local && writes.declaredBy && writeOriginsOf(writes).includes(origin)) return null;
  return (
    `deze run heeft een inlogsessie voor ${origin}, en dat is geen lokaal adres. Achter een inlog verandert bijna elke klik iets en tonen schermafbeeldingen gegevens van het account. ` +
    `Een ingelogde site wordt daarom alleen onderzocht op een verklaarde testomgeving: begin de run met inventory <adres> --out <run> --test-environment ${origin} --declared-by "<naam>, <functie>". ` +
    "Die verklaring komt van wie over de omgeving gaat; vul haar nooit zelf in"
  );
}

/** The sentence for the report, the dossier and the tasks of the agents. It names the role, never a user name. */
export const loginNl = (mark: LoginMark): string =>
  `Er is ingelogd met een testaccount${mark.role ? ` (rol: ${mark.role})` : ""}. Het inloggen zelf is door een mens gedaan en is niet onderzocht; het wachtwoord is niet bij het onderzoek bewaard. Onderzocht is wat dit account te zien krijgt: wat alleen een andere rol ziet, is niet onderzocht`;

/**
 * What an agent has to know in a run with a login, for its task file. Empty for a run
 * without: a task of such a run is then byte for byte what it was.
 */
export const agentLoginNl = (mark: LoginMark | null | undefined): string =>
  mark
    ? `\n\n**Deze site wordt onderzocht achter een inlog.** Elke \`open\` begint ingelogd met een testaccount${mark.role ? ` (rol: ${mark.role})` : ""}. Een mens heeft ingelogd; jij krijgt geen wachtwoord en hebt er geen nodig. Log nooit uit: klik niet op uitloggen of afmelden en open zo'n adres niet. Het gereedschap weigert het, en uitloggen beëindigt de sessie voor iedereen die na jou komt. Meldt een commando dat de inlogsessie is verlopen, stop dan en meld dat aan wie het onderzoek leidt: alleen een mens kan opnieuw inloggen. Probeer niet zelf in te loggen en vul nergens een gebruikersnaam of wachtwoord in. Gegevens van het account die je op het scherm ziet (een naam, een adres, een nummer) neem je niet over in je uitvoer: beschrijf de plek, niet de gegevens.`
    : "";

export const NOT_LOGGED_IN_NL = "Er is niet ingelogd. Wat achter een inlog staat, is niet onderzocht.";

// ---- Logging out -------------------------------------------------------------------------------------------------

const LOGOUT_WORDS = /(?:^|[^\p{L}])(uitloggen|uitlog|log[ -]?uit|afmelden|meld (?:je|u) af|log[ -]?out|log[ -]?off|sign[ -]?out|sign[ -]?off)(?:$|[^\p{L}])/iu;
const LOGOUT_IN_ADDRESS = /(?:^|[^a-z])(log[-_]?out|sign[-_]?out|log[-_]?off|sign[-_]?off|uitloggen|uitlog|afmelden)(?:$|[^a-z])/i;
/** A longer name is a sentence about logging out, such as a question in a list, not the control that does it. */
export const MAX_LOGOUT_NAME = 40;

/**
 * Whether a link or button logs out. The rule: its address has a part that says so (logout,
 * log-out, signout, sign-out, logoff, uitloggen, uitlog, afmelden), or its name is at most
 * forty characters and holds one of the words uitloggen, log uit, afmelden, meld je af,
 * logout, log out, log off, sign out. Such a control is never followed or activated in a run
 * with a login: one click ends the session for everything that comes after.
 */
export function isLogout(control: { href?: string | null; text?: string | null }): boolean {
  const text = (control.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length > 0 && text.length <= MAX_LOGOUT_NAME && LOGOUT_WORDS.test(text)) return true;
  if (!control.href) return false;
  try {
    const url = new URL(control.href, "http://x.invalid");
    return LOGOUT_IN_ADDRESS.test(decodeURIComponent(url.pathname)) || [...url.searchParams].some(([key, value]) => LOGOUT_IN_ADDRESS.test(key) || LOGOUT_IN_ADDRESS.test(value));
  } catch {
    return false;
  }
}

export const LOGOUT_REFUSED_NL = "dit logt uit, en de run is ingelogd: het is niet gedaan. Uitloggen beëindigt de sessie voor alles wat hierna komt";

// ---- The login of the run this process works on -----------------------------------------------------------------

export class LoginExpired extends Error {}

interface Current {
  runDir: string;
  /** The session as last read, with the time the file was written: a new login is picked up without a restart. */
  read: { mtimeMs: number; session: LoginSession } | null;
  /** Addresses that log out although nothing in them says so: the inventory found them by the name of the link. */
  logoutUrls: Set<string>;
  inventoryMtimeMs: number;
  /** Set when a page fell back to the login screen; holds until somebody logs in again. */
  expired: { mtimeMs: number; message: string } | null;
  /** Whether the manifest says that somebody logged in for this run; undefined until it was asked. */
  madeWithLogin?: boolean;
  /** The permission `inventory` was started with: it is in the manifest only when that command is done. */
  writes?: WritePermission | null;
}

let current: Current | null = null;

/**
 * Tell every browser context this process opens from here on which run it works for. A run
 * with a session file starts each context logged in; a run without one is left exactly as it
 * was. Set once, by the command line or the session process; null takes it away.
 */
export function setRunLogin(runDir: string | null, decided?: { writes: WritePermission | null }): void {
  current = runDir === null ? null : { runDir, read: null, logoutUrls: new Set(), inventoryMtimeMs: -1, expired: null, ...(decided ? { writes: decided.writes } : {}) };
}

const sessionPath = (runDir: string): string => join(runDir, LOGIN_SESSION_FILE);

/** The session of the run, read again when somebody logged in anew. Throws when the run may not use it. */
function runSession(): LoginSession | null {
  if (!current) return null;
  const path = sessionPath(current.runDir);
  if (!existsSync(path)) {
    // Asked of the manifest once: a run without a login stays one for as long as no session file appears.
    current.madeWithLogin ??= loginForRun(current.runDir) !== null;
    if (current.madeWithLogin) throw new Error(`deze run is met een inlog gemaakt, maar het sessiebestand ${LOGIN_SESSION_FILE} ontbreekt. Laat een mens opnieuw inloggen: loep login --run ${current.runDir}`);
    return null;
  }
  const mtimeMs = statSync(path).mtimeMs;
  if (current.read?.mtimeMs !== mtimeMs) {
    const session = readLoginFile(path, siteOriginOfRun(current.runDir));
    const refusal = loginRefusalNl(session.origin, current.writes === undefined ? writesForRun(current.runDir) : current.writes);
    if (refusal) throw new Error(refusal);
    current.read = { mtimeMs, session };
  }
  return current.read.session;
}

/** Cookies and stored values to start a browser context with; undefined for a run without a login. */
export const runLoginState = (): StorageState | undefined => runSession()?.storageState;

/** What tells a logged-in page from the login screen, for the run this process works on. */
export const runLoginMark = (): LoginMark | null => {
  const session = runSession();
  return session ? markOf(session) : null;
};

const withoutHash = (address: string): string => {
  const url = new URL(address);
  url.hash = "";
  return url.href;
};

/** Remember an address that logs out, found by the name of its link. */
export function noteLogoutUrl(address: string): void {
  current?.logoutUrls.add(withoutHash(address));
}

/** Whether a request would log the run out: by what its address says, or because the inventory found it under a link that says so. */
export function logsOut(address: string): boolean {
  if (!current || !existsSync(sessionPath(current.runDir))) return false;
  const inventory = join(current.runDir, "inventory.json");
  const mtimeMs = existsSync(inventory) ? statSync(inventory).mtimeMs : -1;
  if (mtimeMs !== current.inventoryMtimeMs) {
    current.inventoryMtimeMs = mtimeMs;
    if (mtimeMs !== -1) for (const known of (JSON.parse(readFileSync(inventory, "utf8")) as { logoutLinks?: string[] }).logoutLinks ?? []) current.logoutUrls.add(known);
  }
  try {
    return isLogout({ href: address }) || current.logoutUrls.has(withoutHash(address));
  } catch {
    return false;
  }
}

/** The `Cookie` header of the session for a request that is made outside the browser; null when there is nothing to send. */
export function loginCookieHeader(address: string): string | null {
  const state = runLoginState();
  if (!state) return null;
  const url = new URL(address);
  const now = Date.now() / 1000;
  const fitting = state.cookies.filter((cookie) => cookieFits(cookie.domain, url.hostname) && url.pathname.startsWith(cookie.path || "/") && (!cookie.secure || url.protocol === "https:") && (cookie.expires === -1 || cookie.expires > now));
  return fitting.length > 0 ? fitting.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") : null;
}

// ---- A session that ran out -------------------------------------------------------------------------------------

const samePage = (first: string, second: string): boolean => {
  try {
    const [a, b] = [new URL(first), new URL(second)];
    return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
};

/**
 * Why a page that was asked for looks like the login screen, in Dutch; null when it does
 * not. The rule: the browser ended up on the address of the login page while another page
 * was asked, or the page shows a password field. The login page itself says nothing either way.
 */
export function loggedOutReasonNl(mark: Pick<LoginMark, "loginUrl">, seen: { asked: string; final: string; passwordField: boolean }): string | null {
  if (samePage(seen.asked, mark.loginUrl)) return null;
  if (samePage(seen.final, mark.loginUrl)) return "de site leidde om naar de inlogpagina";
  if (seen.passwordField) return "de pagina toont een wachtwoordveld";
  return null;
}

/** Whether a password field shows on the page, through shadow roots. */
export const passwordFieldShows = (page: Page): Promise<boolean> =>
  page
    .locator('input[type="password"]:visible')
    .count()
    .then((count) => count > 0, () => false);

function expire(address: string, reasonNl: string): never {
  const path = sessionPath(current!.runDir);
  const message = `de inlogsessie is verlopen: ${address} viel terug op het inlogscherm (${reasonNl}). Wat al gemeten is, blijft staan. Laat een mens opnieuw inloggen met loep login --run ${current!.runDir} en geef dit commando daarna opnieuw`;
  current!.expired = { mtimeMs: existsSync(path) ? statSync(path).mtimeMs : -1, message };
  throw new LoginExpired(message);
}

/** Stop when the session of the run ran out earlier in this process and nobody logged in since. */
export function throwIfLoginExpired(): void {
  if (!current?.expired) return;
  const path = sessionPath(current.runDir);
  if (existsSync(path) && statSync(path).mtimeMs !== current.expired.mtimeMs) {
    current.expired = null;
    return;
  }
  throw new LoginExpired(current.expired.message);
}

/** Open the page that only shows with a session, on a page that may be navigated: why it is the login screen, or null when the session holds. */
export async function landingFellBack(page: Page, mark: LoginMark): Promise<string | null> {
  await page.goto(mark.landingUrl, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  return loggedOutReasonNl(mark, { asked: mark.landingUrl, final: page.url(), passwordField: await passwordFieldShows(page) });
}

/** Stop with a `LoginExpired` when the page that only shows with a session is the login screen. */
export async function confirmLoginOn(page: Page, mark: LoginMark): Promise<void> {
  const reason = await landingFellBack(page, mark);
  if (reason) expire(mark.landingUrl, reason);
}

/**
 * After a page of a run with a login has loaded: see whether it is the login screen. A page
 * that looks like it is not yet proof (a page to change a password has a password field too),
 * so the page that the person pointed at when logging in is opened: when that one falls back
 * as well, the session ran out and a `LoginExpired` is thrown. Returns true when the page
 * was used for that check and the caller has to load its own address again.
 */
export async function watchLogin(page: Page, asked: string): Promise<boolean> {
  const mark = runLoginMark();
  if (!mark) return false;
  const suspicion = loggedOutReasonNl(mark, { asked, final: page.url(), passwordField: await passwordFieldShows(page) });
  if (!suspicion) return false;
  if (samePage(asked, mark.landingUrl) || (await landingFellBack(page, mark))) expire(asked, suspicion);
  return true;
}
