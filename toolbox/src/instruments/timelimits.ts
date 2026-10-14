import type { Page, Request } from "playwright";
import { call, handleFor } from "../browser/call.ts";
import { runLoginState } from "../lib/login.ts";
import type { MessagesAfterSubmit } from "../lib/statusmessages.ts";
import { cookieFitsHost, looksLikeSession, type AfterSubmit, type CookieRow, type TimeLimitProbe } from "../lib/timelimits.ts";

const sameCookie = (a: { name: string; domain: string; path: string }, b: { name: string; domain: string; path: string }): boolean => a.name === b.name && a.domain === b.domain && a.path === b.path;

/**
 * What can be a time limit on this page as it is now (WCAG 2.2.1): every timer of a second or more
 * with what it did, the meta refreshes, the stored values, and the cookies of the browser without
 * their values. A timer that has not gone off yet is set off now, the shortest first, so a page that
 * logs out after twenty minutes shows that without waiting. That changes the page: call this last,
 * on a page that is thrown away afterwards. `seeded` are the cookies the sweep put in before loading,
 * from closing a notice; the cookies of the login are known from the run.
 */
export async function timeLimits(page: Page, seeded: { name: string; domain: string; path: string }[] = []): Promise<TimeLimitProbe> {
  const report = await call<Omit<TimeLimitProbe, "cookies">>(page, "timerReport", { fireWaiting: true });
  const host = new URL(page.url()).hostname;
  const login = runLoginState()?.cookies ?? [];
  const cookies: CookieRow[] = (await page.context().cookies()).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null,
    httpOnly: cookie.httpOnly,
    firstParty: cookieFitsHost(cookie.domain, host),
    sessionLike: looksLikeSession(cookie.name, cookie.httpOnly),
    setBy: login.some((known) => sameCookie(known, cookie)) ? "login" : seeded.some((known) => sameCookie(known, cookie)) ? "notice" : "page",
  }));
  return { ...report, cookies: cookies.sort((a, b) => `${a.domain} ${a.name}`.localeCompare(`${b.domain} ${b.name}`)) };
}

/** Time for what sending sets in motion: a message that comes, a request that is answered, a timer that is started. */
const AFTER_SUBMIT_MS = 1500;

interface SubmitTarget {
  form: { ref: number; tag: string; text: string; path: string[] };
  submit: { ref: number; tag: string; text: string } | null;
  method: string;
  action: string;
}

const isWrite = (request: Request): boolean => request.method() !== "GET" && request.method() !== "HEAD";

/**
 * Send the form a recipe filled in, and measure the timers as `timeLimits` does, now with the
 * ones that sending started apart (2.2.1). Only a form that stays on the page or asks with GET
 * is sent: a form that posts to another page is only sent where the run may write
 * (`mayWrite`). The browser context holds back every other write request on its own as well;
 * how many it held back is counted. `fields` are the selector chains of the steps that filled
 * the form in. Right after sending, before the timers are set off, the messages that appeared
 * are recorded with their region and the focus (4.1.3): the same sending serves both criteria.
 * Like `timeLimits` this changes the page: it is for a page that is thrown away.
 */
export async function timeLimitsAfterSubmit(page: Page, fields: string[][], mayWrite: (url: string) => boolean, seeded: { name: string; domain: string; path: string }[] = []): Promise<AfterSubmit> {
  const target = await call<SubmitTarget | null>(page, "submitTarget", fields);
  const notSent = (reasonNl: string): AfterSubmit => ({
    form: target ? `${target.form.tag} ${target.form.path.join(" >>> ")}` : null,
    method: target?.method ?? null,
    action: target?.action ?? null,
    submitControl: target?.submit ? `${target.submit.tag} "${target.submit.text.slice(0, 40)}"` : null,
    submitted: false,
    notSubmittedNl: reasonNl,
    navigated: false,
    urlAfter: null,
    writesRefused: 0,
    writesSent: 0,
    startedAfterSubmit: [],
    probe: null,
    messages: null,
  });
  if (!target) return notSent("er staat geen formulier om de velden die het recept invulde");
  if (target.method === "post" && !mayWrite(target.action)) {
    return notSent(`het formulier verstuurt met POST naar ${new URL(target.action).pathname}, een andere pagina, en de run mag daar niet versturen; het is niet verstuurd`);
  }
  let tried = 0;
  let refused = 0;
  const onRequest = (request: Request): void => void (isWrite(request) && tried++);
  const onFailed = (request: Request): void => void (isWrite(request) && refused++);
  page.on("request", onRequest);
  page.on("requestfailed", onFailed);
  const before = await page.evaluate(() => ({ document: performance.timeOrigin, now: performance.now() }));
  await call<number>(page, "markStatusRegions");
  try {
    const submit = target.submit ? await handleFor(page, target.submit.ref) : null;
    const clicked = (await submit?.click({ timeout: 3000 }).then(() => true).catch(() => false)) ?? false;
    if (!clicked) {
      const sent = await page
        .evaluate((ref) => {
          const form = (window as unknown as { __loep: { registry: Element[] } }).__loep.registry[ref] as HTMLFormElement | undefined;
          form?.requestSubmit();
          return form !== undefined;
        }, target.form.ref)
        .catch(() => false);
      if (!sent) return notSent("de knop om te versturen was niet aan te klikken en het formulier liet zich niet versturen");
    }
    await page.waitForTimeout(AFTER_SUBMIT_MS);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  } finally {
    page.off("request", onRequest);
    page.off("requestfailed", onFailed);
  }
  const after = await page.evaluate(() => performance.timeOrigin).catch(() => null);
  const navigated = after !== before.document;
  // Before the timers are set off: what they do afterwards is not what sending showed.
  const messages = await call<MessagesAfterSubmit>(page, "statusMessages").catch(() => null);
  const probe = await timeLimits(page, seeded);
  return {
    form: `${target.form.tag} ${target.form.path.join(" >>> ")}`,
    method: target.method,
    action: target.action,
    submitControl: target.submit ? `${target.submit.tag} "${target.submit.text.slice(0, 40)}"` : null,
    submitted: true,
    notSubmittedNl: null,
    navigated,
    urlAfter: page.url(),
    writesRefused: refused,
    writesSent: tried - refused,
    // In a new document every timer is one that sending brought; on the same page only the ones started after the click.
    startedAfterSubmit: navigated ? probe.timers : probe.timers.filter((timer) => timer.startedAtMs >= before.now),
    probe,
    messages,
  };
}
