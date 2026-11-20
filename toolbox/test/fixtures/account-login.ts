import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SESSION_COOKIE } from "../../fixtures/account.ts";
import { LOGIN_SESSION_FILE, RUN_SECRETS_FILE, type LoginSession } from "../../src/lib/login.ts";

/** Logging in on the fixture for a test: the code does what a person does in the window of `login`, see fixtures/login.ts. */
export { logInOn, ROLE, typeAccount } from "../../fixtures/login.ts";

/** The value of the session cookie in a session file: what must stand nowhere else. */
export const tokenOf = (path: string): string => (JSON.parse(readFileSync(path, "utf8")) as LoginSession).storageState.cookies.find((cookie) => cookie.name === SESSION_COOKIE)!.value;

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every file of a run that holds the given text, apart from the two files that are there to hold it. */
export const filesHolding = (dir: string, text: string): string[] => walk(dir).filter((path) => !path.endsWith(LOGIN_SESSION_FILE) && !path.endsWith(RUN_SECRETS_FILE) && readFileSync(path).includes(text));
