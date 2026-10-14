import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { ACCOUNT, SESSION_COOKIE } from "../../fixtures/account.ts";
import { login, type LoggedIn } from "../../src/commands/login.ts";
import { LOGIN_SESSION_FILE, type LoginSession } from "../../src/lib/login.ts";

/**
 * Logging in on the fixture for a test. The code does here what a person does in the window
 * of `login`: that is allowed because the site and the account are the fixture's own, on this
 * machine. For any other site a person logs in.
 */

export const ROLE = "aanvrager met lopende zaken";

/** What a person does in the window. */
export const typeAccount = async (page: Page): Promise<void> => {
  // The cookie notice lies over the page and keeps the keyboard, as it does for a visitor.
  await page.getByRole("button", { name: "Weigeren" }).click();
  await page.fill("#gebruikersnaam", ACCOUNT.username);
  await page.fill("#wachtwoord", ACCOUNT.password);
  await Promise.all([page.waitForURL("**/mijn/"), page.press("#wachtwoord", "Enter")]);
};

export const logInOn = (origin: string, target: { run?: string; out?: string }, act: (page: Page) => Promise<void> = typeAccount): Promise<LoggedIn> =>
  login({ ...target, url: `${origin}/inloggen.html`, role: ROLE, headless: true, say: () => undefined, act });

/** The value of the session cookie in a session file: what must stand nowhere else. */
export const tokenOf = (path: string): string => (JSON.parse(readFileSync(path, "utf8")) as LoginSession).storageState.cookies.find((cookie) => cookie.name === SESSION_COOKIE)!.value;

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every file of a run that holds the given text, apart from the session file itself. */
export const filesHolding = (dir: string, text: string): string[] => walk(dir).filter((path) => !path.endsWith(LOGIN_SESSION_FILE) && readFileSync(path).includes(text));
