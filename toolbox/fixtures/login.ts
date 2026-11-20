#!/usr/bin/env node
/**
 * Logging in on the fixture site with its own account. The code does here what a person does in
 * the window of `loep login`: that is allowed only because the site and the account are the
 * fixture's own, on this machine. For any other site a person logs in, never the code.
 *
 *   node fixtures/login.ts --run <run> [--url <origin>]   put a session in a run; by default for the site of its inventory
 *   node fixtures/login.ts --logouts <log>                how often the server ended a session; fails above zero
 *
 * The password stays in account.ts. It is typed in the browser and written nowhere: the session
 * file holds the cookie, and the server logs a login without its body.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Page } from "playwright";
import { login, type LoggedIn } from "../src/commands/login.ts";
import { siteOriginOfRun } from "../src/lib/login.ts";
import { ACCOUNT, ACCOUNT_HOME, LOGIN_PAGE } from "./account.ts";
import type { LogEntry } from "./serve.ts";

/** The role the reports name; never the user name. */
export const ROLE = "aanvrager met lopende zaken";

/** What a person does in the window. */
export const typeAccount = async (page: Page): Promise<void> => {
  // The cookie notice lies over the page and keeps the keyboard, as it does for a visitor.
  await page.getByRole("button", { name: "Weigeren" }).click();
  await page.fill("#gebruikersnaam", ACCOUNT.username);
  await page.fill("#wachtwoord", ACCOUNT.password);
  await Promise.all([page.waitForURL(`**${ACCOUNT_HOME}`), page.press("#wachtwoord", "Enter")]);
};

/**
 * The same, and then the choice in the cookie notice forgotten again, in the cookie and in the
 * storage where the site keeps it: the sweep and a measurement have to meet the notice the way a
 * first visitor does, because defects of the key are on it.
 */
export const typeAccountKeepNotice = async (page: Page): Promise<void> => {
  await typeAccount(page);
  await page.context().clearCookies({ name: "cookiekeuze" });
  await page.evaluate(() => localStorage.removeItem("cookiekeuze"));
};

/** Log in on the fixture at `origin` for a run or a session file. Refuses every host but the one the fixture binds to. */
export function logInOn(origin: string, target: { run?: string; out?: string }, act: (page: Page) => Promise<void> = typeAccount, say: (line: string) => void = () => undefined): Promise<LoggedIn> {
  if (new URL(origin).hostname !== "127.0.0.1") throw new Error(`${origin} is niet de testsite: de code logt alleen in op 127.0.0.1, waar de testsite draait. Op elke andere site logt een mens in met loep login`);
  return login({ ...target, url: `${new URL(origin).origin}${LOGIN_PAGE}`, role: ROLE, headless: true, say, act });
}

/** How often the server of the fixture ended a session, read from its log. */
export const logoutsIn = (logFile: string): LogEntry[] =>
  readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry)
    .filter((entry) => entry.kind === "logout");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { run: { type: "string" }, url: { type: "string" }, logouts: { type: "string" } } });
  if (values.logouts) {
    const logouts = logoutsIn(values.logouts);
    process.stdout.write(`${logouts.length === 0 ? "Niemand is uitgelogd" : `${logouts.length} keer uitgelogd: ${logouts.map((entry) => `${entry.time} ${entry.path}`).join(", ")}`} (drempel: 0).\n`);
    if (logouts.length > 0) process.exitCode = 1;
  } else {
    if (!values.run) throw new Error("geef --run <run>, of --logouts <log>");
    const origin = values.url ?? siteOriginOfRun(values.run);
    if (!origin) throw new Error("de run heeft nog geen inventaris: geef --url met het adres van de testsite, bijvoorbeeld http://127.0.0.1:4710");
    const { mark, files } = await logInOn(origin, { run: values.run }, typeAccountKeepNotice);
    process.stdout.write(`ingelogd op ${mark.origin} als ${ROLE}; de sessie staat in ${files.join(" en ")}\n`);
  }
}
