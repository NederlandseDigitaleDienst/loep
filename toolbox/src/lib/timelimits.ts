import type { MessagesAfterSubmit } from "./statusmessages.ts";
import type { PointAnswer } from "./evaluation.ts";

/**
 * What can be a time limit (WCAG 2.2.1), from what the sweep recorded per page and per state:
 * the timers with what each did, the meta refreshes, the cookies and the stored values. Nothing
 * here opens a browser; the measurement is `timeLimits` in `toolbox/src/instruments/timelimits.ts`.
 */

export type TimerEffect = "navigates" | "opensWindow" | "clearsForm" | "endsSession" | "removes" | "replaces" | "shows";

export interface TimerRecord {
  kind: "interval" | "timeout";
  delayMs: number;
  startedAtMs: number;
  fired: number;
  firstFiredAtMs: number | null;
  cleared: boolean;
  /** Set off by loep at the end of the measurement, because it had not gone off by itself yet. */
  forced: boolean;
  effects: { effect: TimerEffect; how?: string; to?: string | null; text?: string; names?: string[]; fieldsEmptied?: number }[];
  shownText?: string[];
  removedText?: string[];
  error?: string;
}

export interface CookieRow {
  name: string;
  domain: string;
  /** ISO time, or null for a cookie that ends with the browser. */
  expires: string | null;
  httpOnly: boolean;
  /** Belongs to the site under test (its host or a parent domain of it). */
  firstParty: boolean;
  /** Its name or httpOnly says it can carry a session. */
  sessionLike: boolean;
  /** Where it came from: the login of the run, closing a notice before measuring, or the page itself. */
  setBy: "login" | "notice" | "page";
}

/** What `timeLimits` writes per page (`probes/timelimits.json`) and per state (`timelimits.json`). */
export interface TimeLimitProbe {
  elapsedMs: number;
  shortTimeouts: number;
  dropped: number;
  fieldsFilledBeforeFiring: number;
  timers: TimerRecord[];
  metaRefresh: { content: string; seconds: number | null; url: string | null }[];
  storage: {
    atStart: { sessionStorage: string[] | null; localStorage: string[] | null };
    now: { sessionStorage: string[] | null; localStorage: string[] | null };
    writes: number;
    removals: number;
    clears: number;
    cookieWrites: number;
  };
  cookies: CookieRow[];
}

/**
 * What `timeLimitsAfterSubmit` writes for a state whose recipe fills in a form without sending it
 * (`timelimits-after-submit.json`): the form sent as a visitor sends it, and the timers that started then.
 */
export interface AfterSubmit {
  /** The form, by its tag and place. Null when none was found. */
  form: string | null;
  /** "get", "post" or "dialog", from the form or its button. */
  method: string | null;
  action: string | null;
  submitControl: string | null;
  submitted: boolean;
  /** Why it was not sent; null when it was. */
  notSubmittedNl: string | null;
  /** Sending loaded another document. */
  navigated: boolean;
  urlAfter: string | null;
  /** Requests that could change something which were held back, and the ones that went to the test environment of the run. */
  writesRefused: number;
  writesSent: number;
  /** The timers that started after sending: in a new document all of them. */
  startedAfterSubmit: TimerRecord[];
  /** The whole measurement after sending, as on any page. Null when nothing was sent. */
  probe: TimeLimitProbe | null;
  /** The messages that appeared on sending, with their region and the focus (4.1.3). Null when nothing was sent; absent in older runs. */
  messages?: MessagesAfterSubmit | null;
}

/**
 * The rule for what counts as a time limit. A timer is one when, after it went off, the page
 * navigated or reloaded, a window opened, a form was emptied, cookies or stored values were removed,
 * or text went away without other text in its place: then the user had until then to read or do
 * something. Not a limit: a repeating timer under a second that does none of the first four
 * (animation, keeping the interface up to date); a repeating timer that swaps text (moving content,
 * criterion 2.2.2); a timer under 20 seconds that only shows or swaps text (a loading animation that
 * shows a result: the user loses nothing); a timer that changed nothing visible; a timer the page
 * stopped before it went off. Something shown after 20 seconds or more counts: it can be the warning
 * that time runs out, so there is a limit behind it. 20 seconds is the time the norm gives the user
 * to answer a warning.
 */
export const TIMER_RULE_NL =
  "Een timer telt als mogelijke tijdslimiet als de pagina na het afgaan wegging of opnieuw laadde, er een venster openging, een formulier leeg werd, cookies of opgeslagen waarden verdwenen, of tekst verdween zonder dat er andere tekst voor in de plaats kwam. Geen limiet: een herhaalde timer onder een seconde die geen van de eerste vier deed (animatie, bijhouden van de interface), een herhaalde timer die tekst verwisselt (bewegende inhoud, criterium 2.2.2), een timer onder de 20 seconden die alleen iets toont of verwisselt (een laadanimatie die een uitkomst toont), een timer die niets zichtbaars veranderde, en een timer die de pagina zelf stopte voordat hij afging. Wat na 20 seconden of later verschijnt, telt wel: het kan de waarschuwing zijn dat de tijd afloopt.";

const EFFECT_NL: Record<TimerEffect, string> = {
  navigates: "gaat naar een andere pagina of laadt opnieuw",
  opensWindow: "opent een venster",
  clearsForm: "maakt een formulier leeg",
  endsSession: "verwijdert cookies of opgeslagen waarden (kan uitloggen)",
  removes: "neemt tekst weg",
  replaces: "verwisselt tekst",
  shows: "toont tekst",
};
const STRONG: TimerEffect[] = ["navigates", "opensWindow", "clearsForm", "endsSession"];
const SHOW_LIMIT_MS = 20_000;

export interface TimerJudgement {
  /** True: can be a time limit; false: not one by the rule; null: not known, it never went off. */
  limit: boolean | null;
  whyNl: string;
  effectsNl: string[];
}

export function judgeTimer(timer: TimerRecord): TimerJudgement {
  const effects = timer.effects.map((entry) => entry.effect);
  const effectsNl = timer.effects.map((entry) => `${EFFECT_NL[entry.effect]}${entry.to ? ` (${entry.to})` : ""}${entry.how && entry.effect === "opensWindow" ? ` (${entry.how})` : ""}`);
  const seconds = Math.round(timer.delayMs / 100) / 10;
  if (timer.fired === 0 && !timer.forced) return { limit: timer.cleared ? false : null, whyNl: timer.cleared ? "de pagina stopte de timer voordat hij afging" : "niet afgegaan tijdens de meting en niet door loep nagebootst", effectsNl };
  const strong = effects.filter((effect) => STRONG.includes(effect));
  if (strong.length > 0) return { limit: true, whyNl: `na ${seconds} s: ${strong.map((effect) => EFFECT_NL[effect]).join(", ")}`, effectsNl };
  if (timer.kind === "interval" && timer.delayMs < 1000) return { limit: false, whyNl: "herhaalde timer onder een seconde: animatie of bijhouden van de interface", effectsNl };
  if (timer.kind === "interval" && (effects.includes("removes") || effects.includes("replaces"))) return { limit: false, whyNl: "herhaalt zich en verwisselt tekst: bewegende inhoud, hoort bij criterium 2.2.2", effectsNl };
  if (effects.includes("removes")) return { limit: true, whyNl: `neemt na ${seconds} s tekst weg: ga na of de gebruiker die daarna nog nodig heeft`, effectsNl };
  if (effects.includes("shows") || effects.includes("replaces")) {
    return timer.delayMs < SHOW_LIMIT_MS
      ? { limit: false, whyNl: `toont na ${seconds} s iets, onder de 20 seconden: een vertraging, zoals laden`, effectsNl }
      : { limit: true, whyNl: `toont na ${seconds} s iets: kan de waarschuwing zijn dat de tijd afloopt`, effectsNl };
  }
  return { limit: false, whyNl: "veranderde niets zichtbaars", effectsNl };
}

/** One timer in words, by the rule of `judgeTimer`: for the dossier and for the `timers` command of a session. */
export function timerNl(timer: TimerRecord): { kind: string; delayMs: number; wentOff: string; whatHappenedNl: string[]; shownText?: string[]; removedText?: string[]; limit: string; whyNl: string } {
  const judged = judgeTimer(timer);
  return {
    kind: timer.kind === "interval" ? "herhaald (setInterval)" : "eenmalig (setTimeout)",
    delayMs: timer.delayMs,
    wentOff: timer.forced ? "door loep laten afgaan aan het eind van de meting" : timer.fired > 0 ? `vanzelf afgegaan${timer.kind === "interval" ? ` (${timer.fired} keer)` : ""}` : timer.cleared ? "door de pagina gestopt" : "niet afgegaan",
    whatHappenedNl: judged.effectsNl.length > 0 ? judged.effectsNl : ["niets zichtbaars"],
    ...(timer.shownText ? { shownText: timer.shownText } : {}),
    ...(timer.removedText ? { removedText: timer.removedText } : {}),
    limit: judged.limit === true ? "kan een tijdslimiet zijn" : judged.limit === false ? "geen tijdslimiet" : "onbekend",
    whyNl: judged.whyNl,
  };
}

const SESSION_NAME =/sess|(^|[^a-z])sid([^a-z]|$)|auth|token|login|jsession|asp\.?net|connect\.sid|laravel|csrf|xsrf|jwt/i;
export const looksLikeSession = (name: string, httpOnly: boolean): boolean => httpOnly || SESSION_NAME.test(name);

export const cookieFitsHost = (domain: string, host: string): boolean => {
  const bare = domain.replace(/^\./, "").toLowerCase();
  return host.toLowerCase() === bare || host.toLowerCase().endsWith(`.${bare}`);
};

// ---- The watch on the session --------------------------------------------------------------------------------

/** The words a judge writes in an open point about how long the session behind the login lasts. `evaluate` closes that point with the outcome of the watch. */
export const SESSION_POINT_MARK = "sessieduur achter de inlog";

/** The watch as `session-watch.json` has it, as far as the dossier and the evaluation read it. */
export interface WatchState {
  status: "running" | "expired" | "stopped" | "notRunning" | "failed";
  reasonNl: string | null;
  longestQuietAliveMinutes: number | null;
  checks: { quietMinutes: number; alive: boolean }[];
  expired: { at: string; quietMinutes: number; minutesAfterLogin: number | null; reasonNl: string } | null;
  warning: { minutesAfterStart: number; textNl: string; screenshot: string | null } | null;
  beforeExpiry: string | null;
  mainSessionExpiredAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  maxHours: number;
}

const HONEST_NL = "Elk nakijken is een verzoek met de sessie, en veel sites verlengen een sessie bij elk verzoek. De proef zegt daarom hoe lang de sessie stil mocht liggen, niet hoe lang ze in totaal geldig is.";

/** The watch in words for the dossier: one sentence that says what was seen, and what that rests on. */
export function watchNl(watch: WatchState | null): { status: string; conclusionNl: string; basisNl: string } {
  if (!watch) return { status: "notRunning", conclusionNl: "De sessieproef heeft niet gedraaid in deze run.", basisNl: "De duur van de sessie is daarom niet gemeten: een keuze van de eigenaar." };
  const warning = watch.warning ? `met een waarschuwing vooraf ("${watch.warning.textNl}")` : "zonder dat er vooraf een waarschuwing of een knop om te verlengen verscheen";
  switch (watch.status) {
    case "expired":
      return { status: "expired", conclusionNl: `De sessie verliep na een stilte van hooguit ${watch.expired!.quietMinutes} minuten${watch.expired!.minutesAfterLogin !== null ? `, ${watch.expired!.minutesAfterLogin} minuten na het inloggen` : ""}, ${warning}.`, basisNl: `Een tweede inlog met het testaccount is met rust gelaten en met oplopende tussenpozen nagekeken; ${watch.checks.length} keer nagekeken. ${HONEST_NL}` };
    case "stopped":
      return watch.longestQuietAliveMinutes === null
        ? { status: "stopped", conclusionNl: "De sessieproef stopte voordat de sessie één keer was nagekeken.", basisNl: watch.reasonNl ?? "" }
        : { status: "stopped", conclusionNl: `Binnen een stilte van ${watch.longestQuietAliveMinutes} minuten is de sessie niet verlopen.`, basisNl: `Een tweede inlog met het testaccount is met rust gelaten en ${watch.checks.length} keer nagekeken, met oplopende tussenpozen; de langste stilte waarna ze nog leefde was ${watch.longestQuietAliveMinutes} minuten. ${HONEST_NL}` };
    case "running":
      return { status: "running", conclusionNl: "De sessieproef loopt nog en stopt bij evaluate.", basisNl: `Schrijf voor de duur van de sessie een open punt dat begint met "keuze nodig: ${SESSION_POINT_MARK}". evaluate sluit dat punt met de uitkomst van de proef: verliep de sessie niet, dan voldoet dit deel, met de langste stilte als beperking; verliep ze wel, dan blijft het punt open met wat de proef zag. ${HONEST_NL}` };
    default:
      return { status: watch.status, conclusionNl: `De sessieproef heeft niet gedraaid: ${watch.reasonNl ?? "onbekende reden"}.`, basisNl: "De duur van de sessie is daarom niet gemeten: een keuze van de eigenaar." };
  }
}

/**
 * The answer of the watch to the open point about the session, for `evaluate`: only when the watch
 * finished without the session running out. A session that ran out leaves the point open: whether a
 * warning with a way to extend came, and whether it was in time, is for a person to judge.
 */
export function sessionWatchAnswers(watch: WatchState | null, missingNl: string[]): PointAnswer[] {
  if (!watch || watch.status !== "stopped" || watch.longestQuietAliveMinutes === null) return [];
  const { conclusionNl, basisNl } = watchNl(watch);
  return missingNl
    .filter((point) => point.toLowerCase().includes(SESSION_POINT_MARK))
    .map((pointNl) => ({ pointNl, didNl: `${conclusionNl} ${basisNl}`, outcome: "passed" as const, role: "sessieproef van loep", answeredAt: watch.stoppedAt ?? new Date().toISOString(), instrument: true }));
}
