import { join } from "node:path";
import type { Frame, Page, Request, Response } from "playwright";
import { axInfo, call, handleFor } from "../browser/call.ts";
import { loadPage } from "../browser/session.ts";
import { isWriteOrigin, runWrites } from "../lib/writes.ts";
import { slugForUrl } from "../lib/canonical.ts";
import { REGULAR_PATH, type FormErrorState } from "../lib/rundata.ts";
import { contextState, SETTLE_MS, where, type Described } from "./activate.ts";
import { spokenByItself, startListening, stopListening } from "./methods/speech.ts";

interface Field extends Described {
  type: string | null;
  required: boolean;
  ariaInvalid: boolean;
  nativeInvalid: boolean;
  validationMessage: string | null;
  describedBy: string | null;
  autocomplete: string | null;
  value: string | null;
}

interface FormReport extends Described {
  fields: Field[];
  submit: Described | null;
}

export interface FormProbeOptions {
  /** Label of the page in dossiers and reports. */
  label: string;
  url: string;
  /** Directory that the screenshot paths in the result are relative to. */
  outDir: string;
  /** Trigger that revealed the form, or null when it is on the page itself. */
  openedVia: string | null;
  /** How many WebSocket messages the browser has held back so far. */
  socketMessagesBlocked: () => number;
  /**
   * Whether a submission really reaches the server: only on a test environment where the run
   * may write. Left out, the permission of the run decides for the origin of the page.
   */
  writes?: boolean;
  /**
   * Bring the page back to the page under test after a submission took it elsewhere, in the
   * state a probe expects (whatever covers the page closed). Left out, the page is loaded again.
   */
  restore?: (page: Page) => Promise<void>;
}

/** A value a server will accept, by the type of the field. */
const VALID_VALUES: Record<string, string> = { email: "test@example.com", tel: "0612345678", url: "https://example.com/", number: "12", date: "2000-01-31" };

type Attempt = FormErrorState["attempts"][number];
type Input = "leeg verstuurd" | "ongeldige invoer" | typeof REGULAR_PATH | "geldige testwaarden";
const NAVIGATION_WAIT_MS = 10_000;
const SHOT_NAMES: Record<Input, string> = { "leeg verstuurd": "leeg", "ongeldige invoer": "ongeldig", [REGULAR_PATH]: "gewoon", "geldige testwaarden": "geldig" };

/** The fixed test value for a field: by its type, and for a plain text field by what it says it expects. */
function validValue(field: Field): string {
  const byType = VALID_VALUES[field.type ?? ""];
  if (byType) return byType;
  const hint = (field.autocomplete ?? "").toLowerCase();
  for (const type of ["email", "tel", "url"]) if (hint.includes(type)) return VALID_VALUES[type]!;
  return hint.includes("postal-code") ? "1234 AB" : "Test";
}

/**
 * Fill in what the form asks for and empty the rest. Returns the required fields the probe has
 * no value for (a file to upload), so that a refusal by the form is not read as a silent failure.
 */
async function fillRegularPath(page: Page, fields: Field[]): Promise<string[]> {
  const unfilled: string[] = [];
  for (const field of fields) {
    const handle = await handleFor(page, field.ref);
    const type = field.type ?? "";
    const typed = ["input", "textarea"].includes(field.tag) ? !["checkbox", "radio", "file", "range", "color"].includes(type) : field.tag !== "select";
    if (!field.required) {
      if (typed) await handle?.fill("", { timeout: 2000 }).catch(() => undefined);
      continue;
    }
    if (type === "checkbox" || type === "radio") await handle?.check({ timeout: 2000 }).catch(() => undefined);
    else if (field.tag === "select") {
      // The first choice that is a choice: an empty value is the invitation to choose.
      await handle
        ?.evaluate((select) => {
          const element = select as unknown as HTMLSelectElement;
          if (element.value !== "") return;
          const option = [...element.options].find((entry) => entry.value !== "" && !entry.disabled);
          if (!option) return;
          element.value = option.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        })
        .catch(() => undefined);
    } else if (type === "file") unfilled.push(where(field));
    else if (typed) await handle?.fill(validValue(field), { timeout: 2000 }).catch(() => unfilled.push(where(field)));
  }
  return unfilled;
}

/**
 * One submission of one form. Null when the form or its submit control is not on the page
 * (any more). The page may be another page afterwards: `navigated` says so, and what is
 * recorded then is what that page shows.
 */
async function attemptSubmit(page: Page, input: Input, formIndex: number, state: FormErrorState, real: boolean, options: FormProbeOptions): Promise<Attempt | null> {
  const { url, outDir, openedVia, socketMessagesBlocked } = options;
  // Look the form up again: every call re-registers elements.
  const current = (await call<FormReport[]>(page, "formsReport"))[formIndex];
  if (!current?.submit) return null;
  const formRef = current.ref;
  if (input === "ongeldige invoer") {
    const before = await contextState(page);
    for (const field of current.fields) {
      if (!["input", "textarea"].includes(field.tag)) continue;
      const handle = await handleFor(page, field.ref);
      await handle?.fill(field.type === "email" ? "geen-emailadres" : field.type === "url" ? "geen adres" : "x").catch(() => undefined);
      await page.keyboard.press("Tab");
    }
    await page.waitForTimeout(SETTLE_MS);
    // Entering a value and leaving the field must not move the user somewhere else (WCAG 3.2.2).
    const after = await contextState(page);
    state.changeOnInput = before === after ? "geen: adres en vensters bleven gelijk na invullen en verlaten van elk veld" : `na invullen veranderde de context: ${after}`;
  }
  if (input === "geldige testwaarden") {
    for (const field of current.fields) {
      const handle = await handleFor(page, field.ref);
      if (field.type === "checkbox" && field.required) await handle?.check({ timeout: 2000 }).catch(() => undefined);
      if (!["input", "textarea"].includes(field.tag) || ["checkbox", "radio", "file"].includes(field.type ?? "")) continue;
      await handle?.fill(VALID_VALUES[field.type ?? ""] ?? "Test").catch(() => undefined);
    }
    await page.waitForTimeout(SETTLE_MS);
  }
  let unfilled: string[] = [];
  if (input === REGULAR_PATH) {
    unfilled = await fillRegularPath(page, current.fields);
    await page.waitForTimeout(SETTLE_MS);
  }
  const sent: { method: string; path: string; status: number }[] = [];
  /** Every request the submission set in motion that can carry the form: a write, another page, or a call by a script. */
  const tried: string[] = [];
  let writesTried = 0;
  let leaving: Request | null = null;
  let navigations = 0;
  let blocked = 0;
  const isWrite = (request: Request): boolean => request.method() !== "GET" && request.method() !== "HEAD";
  const onRequest = (request: Request): void => {
    if (isWrite(request)) writesTried++;
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) leaving = request;
    if (isWrite(request) || request.isNavigationRequest() || ["xhr", "fetch"].includes(request.resourceType())) {
      const target = new URL(request.url());
      // Never the query or the body: what was typed stays out of the record.
      tried.push(`${request.method()} ${target.origin === origin ? "" : target.origin}${target.pathname}`);
    }
  };
  const onResponse = (response: Response): void => {
    if (real && isWrite(response.request())) sent.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
  };
  const onNavigated = (frame: Frame): void => void (frame === page.mainFrame() && navigations++);
  // Only a request that could change something counts: leaving a page also cuts off whatever it was still fetching.
  const onFailed = (request: Request): void => void (isWrite(request) && blocked++);
  const document = (): Promise<number> => page.evaluate(() => performance.timeOrigin);
  const chunksBefore = new Set(await call<string[]>(page, "textChunks"));
  const valuesBefore = JSON.stringify((await call<Field[]>(page, "fieldStates", formRef)).map((field) => field.value));
  const addressBefore = page.url();
  const origin = new URL(addressBefore).origin;
  const liveBefore = new Set(await call<string[]>(page, "liveRegionTexts"));
  const documentBefore = await document();
  const socketMessagesBefore = socketMessagesBlocked();
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("framenavigated", onNavigated);
  page.on("requestfailed", onFailed);
  let navigated = false;
  let submitted = false;
  let unanswered = false;
  // A simulated screen reader listens from just before the click; it costs a few hundredths of a second per attempt.
  const listening = await startListening(page).then(() => true, () => false);
  try {
    const submit = await handleFor(page, current.submit.ref);
    submitted = (await submit?.click({ timeout: 2000 }).then(() => true).catch(() => false)) ?? false;
    await page.waitForTimeout(SETTLE_MS * 2);
    // The click counts as done when it set a request for another page in motion, also when that page is slow to come.
    if (leaving !== null) submitted = true;
    // A submission that asks for another page is waited for: reading a page that is being replaced fails.
    const pending = leaving as Request | null;
    if (pending && navigations === 0) {
      // A server that never answers must not hold the probe: the wait is limited. A page with a navigation
      // still under way cannot be read, so that navigation is then called off.
      const response = await Promise.race([pending.response().catch(() => null), new Promise<"late">((resolve) => setTimeout(() => resolve("late"), NAVIGATION_WAIT_MS))]);
      if (response === "late") {
        unanswered = true;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Page.stopLoading").catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      } else
      // "No content" is how a refused submission is answered; the page stays.
      if (response && response.status() !== 204 && navigations === 0) await page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame(), timeout: NAVIGATION_WAIT_MS }).catch(() => undefined);
    }
    if (navigations > 0) {
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_MS);
    }
    // An address that changed inside the same document (a hash, a script) leaves the form where it was.
    navigated = (await document()) !== documentBefore;
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("framenavigated", onNavigated);
    page.off("requestfailed", onFailed);
  }
  blocked += socketMessagesBlocked() - socketMessagesBefore;
  // Null when the submission replaced the page: the reader went with the page it listened to.
  const heard = listening ? await stopListening(page) : null;

  const fieldsAfter = await call<Field[]>(page, "fieldStates", formRef);
  const cdpAfter = await page.context().newCDPSession(page);
  const invalidFields: Attempt["invalidFields"] = [];
  for (const field of fieldsAfter.filter((entry) => entry.ariaInvalid || entry.nativeInvalid)) {
    const info = await axInfo(cdpAfter, field.ref);
    invalidFields.push({ name: info?.name ?? null, describedBy: info?.description || null, browserValidation: field.nativeInvalid ? field.validationMessage : null });
  }
  await cdpAfter.detach();
  const focus = await call<Described | null>(page, "focusState");
  const shot = join("states", `${slugForUrl(url)}-form${formIndex + 1}-${SHOT_NAMES[input]}${openedVia ? `-${slugForUrl(`https://x/${openedVia}`)}` : ""}.png`);
  await page.screenshot({ path: join(outDir, shot), animations: "disabled" });
  const chunksAfter = await call<string[]>(page, "textChunks");
  const newVisibleMessages = chunksAfter.filter((chunk) => !chunksBefore.has(chunk)).slice(0, 20);
  const liveRegionMessages = (await call<string[]>(page, "liveRegionTexts")).filter((chunk) => !liveBefore.has(chunk)).slice(0, 20);
  // Without a test environment every request that can change something is refused, whatever the page was told.
  const requestBlocked = blocked > 0 || (!real && writesTried > 0);
  const present = new Set(chunksAfter);
  const pageChanged = navigated || page.url() !== addressBefore || [...chunksBefore].some((chunk) => !present.has(chunk)) || JSON.stringify(fieldsAfter.map((field) => field.value)) !== valuesBefore;
  return {
    input,
    submitted,
    requestBlocked,
    ...(real ? { sent } : {}),
    navigated,
    ...(unanswered ? { failed: `de server gaf binnen ${NAVIGATION_WAIT_MS / 1000} seconden geen antwoord op het versturen` } : {}),
    ...(navigated ? { urlAfterSubmit: page.url(), titleAfterSubmit: await page.title() } : {}),
    invalidFields,
    newVisibleMessages,
    liveRegionMessages,
    ...(heard ? { spokenByItself: spokenByItself([heard]) } : {}),
    focusAfterSubmit: focus ? `${focus.tag} "${focus.text.slice(0, 40)}" [${focus.region ?? "-"}]` : null,
    screenshot: shot,
    outcome: outcomeOf({
      request: requestBlocked ? "tegengehouden" : tried.length > 0 ? "verstuurd" : "geen",
      requests: [...new Set(tried)].slice(0, 5),
      message: newVisibleMessages.length > 0 || liveRegionMessages.length > 0 || invalidFields.length > 0,
      pageChanged,
      unfilled,
    }),
  };
}

type Outcome = NonNullable<Attempt["outcome"]>;

/** Say in one sentence what a submission led to. Nothing at all is the signal: the visitor cannot tell whether the form was sent. */
export function outcomeOf(seen: Omit<Outcome, "nothing" | "nl" | "unfilled"> & { unfilled?: string[] }): Outcome {
  const { unfilled = [], ...signals } = seen;
  const nothing = signals.request === "geen" && !signals.message && !signals.pageChanged;
  const parts: string[] = [];
  const requests = signals.requests.length > 0 ? ` (${signals.requests.join(", ")})` : "";
  if (signals.request === "verstuurd") parts.push(`het verzoek ging weg${requests}`);
  if (signals.request === "tegengehouden") parts.push(`het formulier wilde versturen${requests}; de bewaking hield het verzoek tegen, dus het antwoord van de server is niet gezien en een melding hierna kan van het tegenhouden komen`);
  if (signals.message) parts.push("er verscheen een melding of een veld werd als ongeldig gemarkeerd");
  if (signals.pageChanged) parts.push("de pagina veranderde");
  if (nothing) parts.push("er gebeurde niets: geen verzoek, geen melding en geen verandering van de pagina");
  if (unfilled.length > 0) parts.push(`voor ${unfilled.length} verplicht(e) veld(en) had de proef geen waarde (${unfilled.join(", ")}), dus een weigering kan daaraan liggen`);
  return { ...signals, nothing, ...(unfilled.length > 0 ? { unfilled } : {}), nl: parts.join("; ") };
}

/**
 * Submit every visible form empty, with invalid input, and the way a visitor does: what the
 * form asks for filled in with the fixed test values and everything else left empty. Each
 * attempt records whether it had an outcome at all. A request that can change something never
 * leaves the browser, unless the page is on a test environment where the run may write: then
 * each submission is really sent, one more follows with every field filled in, and what the
 * server answered is recorded with it. A request that was held back still shows that the form
 * submits. A submission that takes the user
 * to another page (a search form does) is recorded with where it went, and the probe goes back.
 */
export async function probeForms(page: Page, options: FormProbeOptions): Promise<FormErrorState[]> {
  const { label, url, openedVia } = options;
  const restore = options.restore ?? (async (left: Page): Promise<void> => void (await loadPage(left, url)));
  const results: FormErrorState[] = [];
  const real = options.writes ?? isWriteOrigin(runWrites(), page.url());
  const allInputs = ["leeg verstuurd", "ongeldige invoer", REGULAR_PATH, ...(real ? ["geldige testwaarden"] : [])] as Input[];
  const reports = await call<FormReport[]>(page, "formsReport");
  for (const [formIndex, initial] of reports.entries()) {
    const cdp = await page.context().newCDPSession(page);
    const fields: FormErrorState["fields"] = [];
    for (const field of initial.fields) {
      const info = await axInfo(cdp, field.ref);
      fields.push({ role: info?.role ?? field.tag, name: info?.name ?? null, required: field.required, type: field.type, invalidBeforeInput: field.ariaInvalid });
    }
    await cdp.detach();
    const state: FormErrorState = {
      page: label,
      form: where(initial),
      openedVia,
      fields,
      submitControl: initial.submit ? `${initial.submit.tag} "${initial.submit.text.slice(0, 40)}"` : null,
      attempts: [],
    };
    // A form that marks nothing as required has no path of its own to try: submitting it empty is that path.
    const inputs = initial.fields.some((field) => field.required) ? allInputs : allInputs.filter((input) => input !== REGULAR_PATH);
    for (const input of inputs) {
      const attempt = await attemptSubmit(page, input, formIndex, state, real, options).catch((error: Error) => ({ threw: (error.message ?? String(error)).split("\n")[0]!, navigated: true }));
      if (attempt === null) break;
      if ("threw" in attempt) {
        // The page did something the probe did not survive, such as going elsewhere halfway. Say so and go on with the rest.
        state.attempts.push({ input, submitted: false, requestBlocked: false, navigated: true, invalidFields: [], newVisibleMessages: [], liveRegionMessages: [], focusAfterSubmit: null, screenshot: null, failed: attempt.threw });
      } else state.attempts.push(attempt);
      // The submission took the user to another page; the next attempt, or the next form, starts from the page under test again.
      if (attempt.navigated) {
        // A form that a trigger revealed is not there after a reload: what was not tried stays untried.
        if (openedVia !== null) {
          results.push(state);
          return results;
        }
        // No way back to the page: what was found so far is what there is.
        if (!(await restore(page).then(() => true, () => false))) {
          results.push(state);
          return results;
        }
      }
    }
    results.push(state);
  }
  return results;
}
