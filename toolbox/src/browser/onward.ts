import type { Page, Request, Response } from "playwright";

/*
 * A browser without a protocol session to watch each step of a redirect gets a page that does nothing
 * but send it on, for a navigation that was fetched for it. That page is no part of the site: whatever reads a page or its answer
 * comes here first.
 */

/** What marks such a page, in a header for whoever sees the answer and on the page for whoever sees the page. */
export const ONWARD_HEADER = "x-loep-doorstuur";
const ONWARD_MARK = "data-loep-doorstuur";
/** What marks the empty answer to a navigation that loep refused: it looks like an answer of the site that leaves the page where it is, and is none. */
const NAVIGATION_REFUSED_HEADER = "x-loep-geweigerd";
export const REFUSED_ANSWER = { status: 204, headers: { [NAVIGATION_REFUSED_HEADER]: "1" }, body: "" };
/** Longer than any page of the sweep gets: what is said here is that the browser went on, or that nothing came. */
const ONWARD_TIMEOUT_MS = 45_000;

/** The page. Also without scripts, as in a sandboxed window. */
export const onwardPage = (target: string): string => {
  const quoted = target.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return `<!doctype html><html lang="nl" ${ONWARD_MARK}><title>Doorverwijzing</title><noscript><meta http-equiv="refresh" content="0; url=${quoted}"></noscript><script>location.replace(${JSON.stringify(target).replaceAll("<", "\\u003c")})</script></html>`;
};

/** Wait until the browser left such a page, for as long as this says. */
const leftOnwardPage = (page: Page, timeout: number): Promise<unknown> => page.waitForFunction((mark) => !document.documentElement.hasAttribute(mark), ONWARD_MARK, { timeout }).catch(() => undefined);

/** Whether the page stands on such a page now, and then wait until it left. */
export async function passOnwardPage(page: Page, timeout: number): Promise<void> {
  if (await page.evaluate((mark) => document.documentElement.hasAttribute(mark), ONWARD_MARK).catch(() => false)) await leftOnwardPage(page, timeout);
}

/** An answer that leaves the page where it is: no content, or a file to save. After that nothing more comes. */
const staysOnPage = (response: Response): boolean => !response.headers()[NAVIGATION_REFUSED_HEADER] && (response.status() === 204 || response.status() === 205 || /^attachment/i.test(response.headers()["content-disposition"] ?? ""));

const staysAfterOnward = (response: Response | null): response is Response => response !== null && staysOnPage(response);

/** A navigation that loep refused fails, wherever in the redirects it was refused. */
const throwIfRefused = (response: Response | null): void => {
  if (response?.headers()[NAVIGATION_REFUSED_HEADER]) throw new Error(`De navigatie is geweigerd bij ${response.url()}`);
};

/** Go to an address and on to where a page that sends the browser on leads: that last answer is the one that says something about the site. */
export async function gotoEnd(page: Page, url: string, options?: Parameters<Page["goto"]>[1]): Promise<Response | null> {
  let last: Response | null = null;
  let ended: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    ended = resolve;
  });
  let lost: string | null = null;
  const inMainFrame = (request: Request): boolean => {
    try {
      return request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      // A navigation that has no frame yet, in a window of its own.
      return false;
    }
  };
  const watch = (response: Response): void => {
    if (!inMainFrame(response.request())) return;
    last = response;
    if (staysOnPage(response) || response.headers()[NAVIGATION_REFUSED_HEADER]) ended();
  };
  // Firefox gives no answer for an empty one: the step after a page that sends the browser on just fails, and the navigation it came from never ends.
  const failed = (request: Request): void => {
    if (!last?.headers()[ONWARD_HEADER] || !inMainFrame(request)) return;
    lost = request.failure()?.errorText ?? "onbekend";
    ended();
  };
  page.on("response", watch);
  page.on("requestfailed", failed);
  try {
    const opening = page.goto(url, options);
    // The answer that ends it can come before the navigation is done with the page that sent it on, and then that navigation never ends.
    const first = await Promise.race([opening, stopped.then(() => null)]);
    if (first === null) opening.catch(() => undefined);
    throwIfRefused(last);
    if (first === null && staysAfterOnward(last)) {
      await page.evaluate((mark) => document.documentElement.removeAttribute(mark), ONWARD_MARK).catch(() => undefined);
      return last;
    }
    if (first === null && lost) throw new Error(`De navigatie kwam niet aan: ${lost}`);
    const answer = first ?? (await opening);
    if (!answer?.headers()[ONWARD_HEADER]) return answer;
    await Promise.race([leftOnwardPage(page, ONWARD_TIMEOUT_MS), stopped]);
    throwIfRefused(last);
    if (lost) throw new Error(`De navigatie kwam niet aan: ${lost}`);
    await page.evaluate((mark) => document.documentElement.removeAttribute(mark), ONWARD_MARK).catch(() => undefined);
    await page.waitForLoadState("load").catch(() => undefined);
    return last ?? answer;
  } finally {
    page.off("response", watch);
    page.off("requestfailed", failed);
  }
}
