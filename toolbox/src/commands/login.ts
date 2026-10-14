import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium, type Page } from "playwright";
import { RENDERING } from "../browser/session.ts";
import { IDLE_SESSION_FILE, LOGIN_SESSION_FILE, loggedOutReasonNl, loginRefusalNl, loginSessionProblems, markOf, passwordFieldShows, readLoginFile, siteOriginOfRun, storeLoginSession, writeLoginFile, type LoginMark, type LoginSession } from "../lib/login.ts";
import { isLocalHost, writesForRun } from "../lib/writes.ts";

export interface LoginOptions {
  /** The run that gets the session. Left out, the session is only written to `out`. */
  run?: string | undefined;
  /** The login page. Left out, the address the inventory of the run started on. */
  url?: string | undefined;
  /** The role of the test account, in free words; never the name of a person. */
  role?: string | undefined;
  /** Also write the session file here: for a login on another machine than the one that examines. */
  out?: string | undefined;
  /** Take a session file that was made elsewhere instead of opening a browser. */
  from?: string | undefined;
  /**
   * A second login for the watch on the session (2.2.1): written to `idle-session.json` in the run,
   * which only that watch uses, and the manifest is left as it is. The same test account may be used.
   */
  idle?: boolean | undefined;
  /** For tests: no window, and what a person would do in it. */
  headless?: boolean;
  act?: (page: Page) => Promise<void>;
  say?: (line: string) => void;
}

export interface LoggedIn {
  mark: LoginMark;
  /** Where the session was written. */
  files: string[];
}

/** Said before anything is asked: what account to use, and where the role ends up. */
export const LOGIN_WARNING_NL = [
  "Gebruik een testaccount, nooit een echt account. Schermafbeeldingen van wat het account te zien krijgt komen in het rapport, en achter een inlog kan een klik iets wijzigen.",
  "Het wachtwoord typ je alleen in het browservenster. loep ziet en bewaart het niet; het bewaart alleen de sessie die na het inloggen overblijft.",
  `De sessie komt in ${LOGIN_SESSION_FILE} in de run, met leesrechten voor jou alleen. Dat bestand staat buiten het zegel en het rapport. Wie het heeft, is ingelogd: deel het niet en gooi het weg als het onderzoek klaar is.`,
  "De rol die je met --role opgeeft, komt in manifest.json en in het rapport. Geef een rol, zoals \"aanvrager\" of \"beheerder\", geen naam van een persoon en geen gebruikersnaam.",
];

const withoutQuery = (address: string): string => {
  const url = new URL(address);
  url.hash = "";
  url.search = "";
  return url.href;
};

const withoutHash = (address: string): string => {
  const url = new URL(address);
  url.hash = "";
  return url.href;
};

/** A run that was started already has to be allowed to hold a session; before the inventory nobody can tell yet. */
function refuseForRun(runDir: string | undefined, origin: string, say: (line: string) => void): void {
  if (!runDir) return;
  const site = siteOriginOfRun(runDir);
  if (site && site !== origin) throw new Error(`de sessie is voor ${origin} en deze run onderzoekt ${site}`);
  if (site) {
    const refusal = loginRefusalNl(origin, writesForRun(runDir));
    if (refusal) throw new Error(refusal);
  } else if (!isLocalHost(new URL(origin).hostname)) {
    say(`Let op: ${origin} is geen lokaal adres. inventory weigert deze run tenzij wie over de omgeving gaat verklaart dat het een testomgeving is: --test-environment ${origin} --declared-by "<naam>, <functie>". Vul die verklaring nooit zelf in.`);
  }
}

async function waitForEnter(): Promise<void> {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await lines.question("");
  } finally {
    lines.close();
  }
}

/**
 * Let a person log in and keep the session. A window opens on the login page; the person logs
 * in there, goes to a page that only shows when logged in and says so in the terminal. That
 * page and the login page are kept as what tells the two apart later, when a session runs out.
 */
export async function login(options: LoginOptions): Promise<LoggedIn> {
  const say = options.say ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const role = options.role?.trim() || null;
  if (role && /@/.test(role)) throw new Error("--role is een rol, zoals \"aanvrager\" of \"beheerder\": geen e-mailadres of gebruikersnaam. De rol komt in het rapport");
  if (!options.run && !options.out) throw new Error("login needs --run <run>, or --out <file> to write the session for another machine");

  if (options.from) {
    if (!options.run) throw new Error("login --from <bestand> zet een sessie in een run: geef ook --run <run>");
    const read = readLoginFile(options.from, siteOriginOfRun(options.run));
    refuseForRun(options.run, read.origin, say);
    const session: LoginSession = { ...read, role: role ?? read.role };
    const target = join(options.run, options.idle ? IDLE_SESSION_FILE : LOGIN_SESSION_FILE);
    if (options.idle) writeLoginFile(target, session);
    else await storeLoginSession(options.run, session);
    say(`sessie voor ${session.origin} overgenomen in ${target} (alleen voor jou leesbaar)`);
    return { mark: markOf(session), files: [target] };
  }

  const inventoryPath = options.run ? join(options.run, "inventory.json") : null;
  const start = options.url ?? (inventoryPath && existsSync(inventoryPath) ? (JSON.parse(readFileSync(inventoryPath, "utf8")) as { baseUrl: string }).baseUrl : undefined);
  if (!start) throw new Error("login needs --url <inlogpagina>: de run heeft nog geen inventaris waar het adres uit te halen is");
  if (!/^https?:\/\//.test(start)) throw new Error(`--url verwacht een adres met http:// of https://, niet "${start}"`);
  for (const line of LOGIN_WARNING_NL) say(line);
  refuseForRun(options.run, new URL(start).origin, say);

  const browser = await chromium.launch({ headless: options.headless ?? false }).catch((error: Error) => {
    throw new Error(
      `er is geen browservenster te openen op deze machine (${error.message.split("\n")[0]}). Log in op een machine met een scherm en neem het bestand over: ` +
        `daar "loep login --url ${start} --out <bestand>", hier "loep login --run <run> --from <bestand>"`,
    );
  });
  try {
    // No limits of an evaluation here: a person logs in, and that sends a form.
    const context = await browser.newContext({ viewport: RENDERING.viewport, locale: RENDERING.locale, timezoneId: RENDERING.timezoneId });
    const page = await context.newPage();
    // The login page is the last page that showed a password field, wherever the site sent the browser first.
    let loginUrl: string | null = null;
    const look = async (): Promise<void> => {
      if (await passwordFieldShows(page)) loginUrl = withoutQuery(page.url());
    };
    page.on("load", () => void look().catch(() => undefined));
    await page.goto(start, { waitUntil: "load" });
    await look();
    if (options.act) await options.act(page);
    else {
      say("");
      say(`Er is een browservenster geopend op ${start}.`);
      say("1. Log daar in met het testaccount.");
      say("2. Ga naar een pagina die alleen ingelogd te zien is, bijvoorbeeld het overzicht na het inloggen. Daar begint de inventaris.");
      say("3. Druk hier op Enter. Sluit het venster niet zelf.");
      await waitForEnter();
    }
    await page.waitForLoadState("load").catch(() => undefined);
    await look();
    const landingUrl = withoutHash(page.url());
    if (!/^https?:/.test(landingUrl)) throw new Error(`het venster toont geen pagina van een site (${landingUrl}); er is niets bewaard`);
    const origin = new URL(landingUrl).origin;
    refuseForRun(options.run, origin, () => undefined);
    const mark: LoginMark = { origin, loginUrl: loginUrl ?? withoutQuery(start), landingUrl, role, loggedInAt: new Date().toISOString() };
    if (await passwordFieldShows(page)) throw new Error(`op de aangewezen pagina (${landingUrl}) staat een wachtwoordveld: dat is het inlogscherm, of een pagina waaraan niet te zien is dat je bent ingelogd. Er is niets bewaard. Log in, ga naar een pagina zonder wachtwoordveld en probeer het opnieuw`);
    if (loggedOutReasonNl(mark, { asked: "about:blank", final: landingUrl, passwordField: false })) throw new Error(`de aangewezen pagina is de inlogpagina zelf (${landingUrl}). Er is niets bewaard. Log in en ga naar een pagina die alleen ingelogd te zien is`);
    const storageState = await context.storageState();
    // The same page without the session has to fall back: otherwise nobody can tell later that the session ran out.
    const anonymous = await browser.newContext({ viewport: RENDERING.viewport, locale: RENDERING.locale, timezoneId: RENDERING.timezoneId });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(landingUrl, { waitUntil: "load" });
      await visitor.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      if (!loggedOutReasonNl(mark, { asked: landingUrl, final: visitor.url(), passwordField: await passwordFieldShows(visitor) })) {
        throw new Error(`de aangewezen pagina (${landingUrl}) is ook zonder inlog te zien: ze leidt dan niet om naar de inlogpagina en toont geen wachtwoordveld. Er is niets bewaard. Wijs een pagina aan die alleen ingelogd bestaat, anders is later niet te merken dat de sessie is verlopen`);
      }
    } finally {
      await anonymous.close().catch(() => undefined);
    }
    const session: LoginSession = { schema: "loep/login-session/1", ...mark, storageState };
    const problems = loginSessionProblems(session);
    if (problems.length > 0) throw new Error(`er is geen bruikbare sessie: ${problems.join("; ")}`);
    const files: string[] = [];
    if (options.out) {
      writeLoginFile(options.out, session);
      files.push(resolve(options.out));
    }
    if (options.run && options.idle) {
      // The second session is for the watch alone: the manifest keeps the login the measurement uses.
      writeLoginFile(join(options.run, IDLE_SESSION_FILE), session);
      files.push(join(options.run, IDLE_SESSION_FILE));
    } else if (options.run) {
      await storeLoginSession(options.run, session);
      files.push(join(options.run, LOGIN_SESSION_FILE));
    }
    say(`ingelogd op ${origin}${role ? ` als ${role}` : ""}; de sessie staat in ${files.join(" en ")} (alleen voor jou leesbaar)`);
    say(`inlogpagina: ${mark.loginUrl}`);
    say(`aangewezen pagina: ${landingUrl}`);
    if (options.out && !options.run) say(`zet het bestand op de machine die onderzoekt in de run met: loep login --run <run> --from ${options.out}`);
    return { mark, files };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
