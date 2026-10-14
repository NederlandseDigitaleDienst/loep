/**
 * The one account of the part of the fixture that stands behind a login. It is test data: it
 * opens nothing but pages of the fixture itself, on this machine. Nothing in this file is served.
 */
export const ACCOUNT = { username: "inwoner", password: "eik-brug-2031" } as const;

/** The cookie that carries a session, and how long a session lasts unless the server is told otherwise. */
export const SESSION_COOKIE = "sessie";
export const DEFAULT_SESSION_SECONDS = 1800;

/** Where a visitor without a session is sent, and the two addresses that end a session: one says so, one does not. */
export const LOGIN_PAGE = "/inloggen.html";
export const ACCOUNT_HOME = "/mijn/";
export const LOGOUT_PATHS = ["/uitloggen", "/mijn/sessie-sluiten"];
