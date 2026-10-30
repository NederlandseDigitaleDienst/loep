import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./canonical.ts";
import { approvedSendsTo, connectionKind, sendsToMatches } from "./sitemodel.ts";
import { isOurMessage, isProtocolFrame } from "./writes.ts";

/**
 * Recordings of what a chat answered over a socket. A message an agent sends is made of the fixed
 * test values, so the second time the same message is sent, the server would get the same thing
 * again. The first one that passes is sent for real, and what the server answers in the window
 * after it is recorded. Every later send of the same message is not sent: the recorded answer is
 * played to the page, with the same time between the frames. The page handles it as it handles a
 * real answer, so what it shows, says and does with focus can be measured, while the recipient gets
 * one message instead of one per agent. What a server does later on its own, such as ending a
 * conversation after a while, is not in a recording: that takes a real send.
 *
 * Only a message with a test value in it is recorded and played: any other frame, such as one that
 * opens the chat, goes to the server as before. A recording is only played when it ran its whole
 * window, or when the server had been quiet for a while when it ended. One cut off earlier, because
 * the socket closed or the page sent the next message while the server was still answering, may miss
 * part of the answer: it is kept as incomplete, never played, and the next send of that message is
 * real. A chat that people answer, says nothing back for a long time: that silence is the answer,
 * and it is recorded when it lasted at least `RECORD_SILENCE_MS`. A silence cut off sooner, when the
 * socket closed right after the send, is not kept at all.
 *
 * A chat often opens its socket on an address with a token of its own per conversation
 * (/ws/chat/sTEEyUUqGuUpkriK), so the exact address says little. Which recording belongs to a send
 * is decided in one of two ways, and never by guessing which part of an address is a token:
 *
 * - With a `sendsTo` pattern in a site model that passed `check-site` (wss://host/ws/chat/*): a
 *   recording is played on an address under the same pattern, and not on another address of the
 *   origin. The explorer found the pattern by opening the part twice, and check-site checked it.
 * - Without one: a recording belongs to the declared origin, the kind of connection (websocket or
 *   HTTP) and the test values in the message, and the path does not count. That is safe because a
 *   run may send only to the test environment it was given, a recording stays with its origin, and a message is made of
 *   the fixed test values of loep, which no visitor types: the same test values to the same test
 *   environment is the same message, whichever part of that origin it went to.
 *
 * The replay notes which of the two it was looked up on (`matchedOn`), and so does the evaluation.
 */

/** One recording per message per `sendsTo` pattern, or on the declared origin, in the run: the first complete one wins. */
export const RECORDINGS_LOG = "opnames.jsonl";
/** Every send that was played from a recording instead of sent: when, by whom, and which recording. */
export const REPLAYS_LOG = "afgespeeld.jsonl";
/** How long after a real send the answer of the server is recorded, unless the page sends another message or the socket closes first. */
export const RECORD_WINDOW_MS = 30_000;
/** How long the server must have been quiet when a recording ends before its window, for the answer to count as whole. */
export const RECORD_QUIET_MS = 3_000;
/** How long a server must have said nothing after a send, for that silence to count as its answer. */
export const RECORD_SILENCE_MS = 10_000;

export interface RecordedFrame {
  /** Milliseconds after the send. */
  afterMs: number;
  text?: string;
  /** A binary frame, as base64. */
  base64?: string;
}

export interface SocketRecording {
  id: string;
  /** When the message was sent for real. */
  at: string;
  /** The session or command that sent it. */
  source: string;
  /** The http(s) origin of the socket. */
  origin: string;
  /** The path and query of the socket. */
  path: string;
  /** Which message it was: the test values in it, sorted (see `recordingKey`). */
  key: string;
  /** Over what it was sent; absent in recordings from before this was kept: a socket. */
  kind?: "websocket";
  /** The `sendsTo` pattern the address fell under, or `DECLARED_ORIGIN`. */
  matchedOn?: string;
  frames: RecordedFrame[];
  /** Cut off before its window ended, so it may miss part of the answer: kept for the dossier, never played. */
  incomplete?: true;
  /** How long the server was listened to after the send: for a recording without frames, how long it said nothing. */
  listenedMs?: number;
}

export interface PassedReplay {
  at: string;
  source: string;
  recording: string;
  path: string;
  key: string;
  /** What the recording was looked up on: the `sendsTo` pattern of the site model, or `DECLARED_ORIGIN`. */
  matchedOn: string;
  /** For a request over HTTP that was answered from a recording: its method. Absent for a message over a socket. */
  method?: string;
}

/** What a recording is looked up on when no `sendsTo` pattern of the site model covers the address. */
export const DECLARED_ORIGIN = "verklaarde origin";

/** The origin of a socket as its http(s) twin. */
function originOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  return parsed.origin;
}

/** The path and query of a socket. */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Which message a frame is: the test values in it, sorted. A frame without any, such as one that
 * says the chat was opened, is not a message of an agent and has no key: it is never played.
 */
/**
 * The key of a frame without a test value: its exact content. Pressing send on an empty field gives the
 * same frame every time, so the second press need not reach the service. A frame with a token in it
 * differs every time and simply goes to the server.
 */
export const frameKey = (message: string | Buffer): string => `frame:${sha256(message)}`;

export function recordingKey(message: string | Buffer, values: readonly string[]): string | null {
  const ours = values.filter((value) => isOurMessage(message, [value])).sort();
  return ours.length > 0 ? ours.join("|") : null;
}

function readLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        // A line cut off by a process that stopped halfway.
        return [];
      }
    });
}

const readAll = (runDir: string): Recording[] => readLines<Recording>(join(runDir, RECORDINGS_LOG));
/** The recordings of messages over a socket. */
export const readRecordings = (runDir: string): SocketRecording[] => readAll(runDir).filter((recording): recording is SocketRecording => recording.kind !== "http");
/** The recordings of requests over HTTP. */
export const readHttpRecordings = (runDir: string): HttpRecording[] => readAll(runDir).filter((recording): recording is HttpRecording => recording.kind === "http");
export const readReplays = (runDir: string): PassedReplay[] => readLines<PassedReplay>(join(runDir, REPLAYS_LOG));

/** What the server says after one real send, until the window ends. */
export interface Recorder {
  frame: (message: string | Buffer) => void;
  /** End the recording now, before its window ended: the page sent another message, or the socket closed. Unless the server had been quiet for `RECORD_QUIET_MS`, it is then incomplete and never played. */
  end: () => void;
}

export interface SocketRecordings {
  /** The complete recording of this message under the same `sendsTo` pattern or on the declared origin, or null when there is none yet or the message has no test value. `anyFrame`: a frame without a test value counts as well, by its exact content (see `frameKey`). */
  find: (url: string, message: string | Buffer, anyFrame?: boolean) => SocketRecording | null;
  /** Start recording what the server answers to a message that was sent for real; null for a frame without a test value, which is not recorded. */
  start: (url: string, message: string | Buffer, sender?: string, anyFrame?: boolean) => Recorder | null;
  /** Note that a send was played from a recording. */
  replayed: (url: string, recording: SocketRecording, sender?: string) => PassedReplay;
}

/** The `sendsTo` pattern an address falls under, the longest when several do, or `DECLARED_ORIGIN` when none does. */
export function matchedOnFor(sendsTo: readonly string[], address: string): string {
  return sendsTo.filter((pattern) => sendsToMatches(pattern, address)).sort((a, b) => b.length - a.length)[0] ?? DECLARED_ORIGIN;
}

export interface RecordingOptions {
  now?: () => number;
  windowMs?: number;
  quietMs?: number;
  /** The `sendsTo` patterns to look recordings up on; left out, those of a site model that passed `check-site` (see `approvedSendsTo`). */
  sendsTo?: readonly string[];
}

export function socketRecordings(runDir: string, source: string, values: readonly string[], options: RecordingOptions = {}): SocketRecordings {
  const { now = Date.now, windowMs = RECORD_WINDOW_MS, quietMs = RECORD_QUIET_MS } = options;
  const sendsTo = options.sendsTo ?? approvedSendsTo(runDir);
  const append = (file: string, entry: unknown): void => {
    mkdirSync(runDir, { recursive: true });
    // Appended at once and synchronously, as the log of writes is.
    appendFileSync(join(runDir, file), `${JSON.stringify(entry)}\n`);
  };
  const keyOf = (message: string | Buffer, anyFrame: boolean): string | null => recordingKey(message, values) ?? (anyFrame ? frameKey(message) : null);
  const find = (url: string, message: string | Buffer, anyFrame = false): SocketRecording | null => {
    const key = keyOf(message, anyFrame);
    if (key === null) return null;
    const origin = originOf(url);
    const kind = connectionKind(url);
    const matchedOn = matchedOnFor(sendsTo, url);
    // The address of a recording is kept as its http(s) twin; under a pattern for a socket it is asked as a socket again.
    const addressOf = (recording: SocketRecording): string => (kind === "websocket" ? `${recording.origin.replace(/^http/, "ws")}${recording.path}` : `${recording.origin}${recording.path}`);
    return readRecordings(runDir).find((recording) => !recording.incomplete && recording.origin === origin && (recording.kind ?? "websocket") === kind && recording.key === key && matchedOnFor(sendsTo, addressOf(recording)) === matchedOn) ?? null;
  };
  return {
    find,
    start: (url, message, sender = source, anyFrame = false) => {
      const key = keyOf(message, anyFrame);
      if (key === null) return null;
      const started = now();
      const frames: RecordedFrame[] = [];
      let ended = false;
      let lastFrameAt = started;
      const finish = (complete: boolean): void => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        const listenedMs = now() - started;
        // A silence is an answer only when it lasted; the first complete recording of a message counts, and one that ends later is not kept.
        if ((frames.length === 0 && listenedMs < RECORD_SILENCE_MS) || find(url, message, anyFrame)) return;
        const path = pathOf(url);
        append(RECORDINGS_LOG, { id: `${originOf(url)}${path}|${key}|${new Date(started).toISOString()}`, at: new Date(started).toISOString(), source: sender, origin: originOf(url), path, key, kind: "websocket", matchedOn: matchedOnFor(sendsTo, url), frames, listenedMs, ...(complete ? {} : { incomplete: true as const }) } satisfies SocketRecording);
      };
      // Ended before the window: whole only when the server had stopped answering a while ago.
      const end = (): void => finish(now() - lastFrameAt >= quietMs);
      const timer = setTimeout(() => finish(true), windowMs);
      timer.unref?.();
      return {
        frame: (reply) => {
          // A heartbeat of the server is no answer, and the live connection keeps sending its own.
          if (ended || isProtocolFrame(reply)) return;
          lastFrameAt = now();
          frames.push({ afterMs: lastFrameAt - started, ...(typeof reply === "string" ? { text: reply } : { base64: reply.toString("base64") }) });
        },
        end,
      };
    },
    replayed: (url, recording, sender = source) => {
      const entry: PassedReplay = { at: new Date(now()).toISOString(), source: sender, recording: recording.id, path: pathOf(url), key: recording.key, matchedOn: matchedOnFor(sendsTo, url) };
      append(REPLAYS_LOG, entry);
      return entry;
    },
  };
}

/** Play a recording to the page, with the same time between the frames. A socket that closed in between gets nothing more. */
export function playRecording(recording: SocketRecording, send: (message: string | Buffer) => void): void {
  for (const frame of recording.frames) {
    const timer = setTimeout(() => {
      try {
        send(frame.text ?? Buffer.from(frame.base64 ?? "", "base64"));
      } catch {
        // The page closed the socket.
      }
    }, frame.afterMs);
    timer.unref?.();
  }
}

/**
 * Recordings of what the test environment answered to a request over HTTP: a form that is sent, or a
 * script that sends with POST, PUT, PATCH or DELETE. The same reasoning as for a chat: an agent can only
 * type the fixed test values, so the second time the same form is sent the same way, the server would get
 * the same thing again. The first one is sent for real, and its answer is kept: the status, the headers that
 * decide what the browser does with it (the kind of content, where a redirect goes, never a cookie) and the
 * body. Every later send of the same request is answered in the browser with that answer, and nothing goes
 * to the server. After a redirect the browser goes on by itself, to the same page as the first time: that
 * page comes from the server, as it would for any visitor who opens it.
 *
 * Only a request with a test value in its body is recorded and answered; any other request goes to the
 * server and counts as before. The same request is one to the same `sendsTo` pattern, or without one to
 * the same path on the declared origin (two forms on one origin send to two addresses), with the same
 * method and the same body. The whole body counts, not only the test values in it: a choice in the form or a
 * hidden field can change what the server answers. A hidden field that changes per page load, such as a
 * CSRF token, makes every send different, so such a form is always sent for real.
 *
 * An answer is never played when a replay could show something else than the server would, or leave the
 * page without something it needs later (`answerRefusalNl`, and after a redirect `landingRefusalNl` in the
 * browser): a cookie in the answer, a token or one-time code in it, a status that says a session or the
 * server was the problem, a redirect that repeats the request (307, 308) or leaves the test environment,
 * and a page after the redirect that looks different without the cookies of the browser, because it shows
 * what the session holds (a message stored for the next page) or a token per visit. In doubt it is not
 * played: such a recording is kept with the reason, for the dossier, and the next send is real, with budget.
 */
export interface HttpRecording {
  id: string;
  at: string;
  source: string;
  /** The http(s) origin the request went to. */
  origin: string;
  /** The path and query of the request. */
  path: string;
  method: string;
  /** The test values in the body, sorted (see `httpSendOf`). */
  key: string;
  kind: "http";
  /** The hash of the body, without the boundary of a multipart body: the same request has the same body. */
  bodySha256: string;
  /** The `sendsTo` pattern the address fell under, or `DECLARED_ORIGIN`. */
  matchedOn: string;
  answer: RecordedAnswer;
  /** After a redirect: each address the browser asked for next and its status, ending at the page it landed on. Absent without a redirect. */
  chain?: { url: string; status: number }[];
  /** Why it is never played; absent when it may be. */
  refusedNl?: string;
}

export interface RecordedAnswer {
  status: number;
  /** Only the headers in `KEPT_HEADERS`. */
  headers: Record<string, string>;
  base64: string;
}

export type Recording = SocketRecording | HttpRecording;

/** The headers of an answer that are kept and given back: what decides how the browser shows the answer and where it goes next. A cookie never is. */
const KEPT_HEADERS = ["content-type", "location", "content-language", "content-disposition", "refresh"];
/** A larger answer is not kept: the log of recordings is read in full by every lookup. */
const MAX_ANSWER_BYTES = 1_000_000;

/** The kept headers of an answer. */
export const keptHeaders = (headers: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADERS.includes(name.toLowerCase())).map(([name, value]) => [name.toLowerCase(), value]));

/**
 * Which request a body makes: the test values in it, and the hash of the body. Null without a test
 * value: such a request is not recorded or answered. A form sends its fields encoded (a space as +,
 * @ as %40), so the body is also read decoded.
 */
export function httpSendOf(body: Buffer | null, contentType: string | undefined, values: readonly string[]): { key: string; bodySha256: string } | null {
  if (!body || body.length === 0) return null;
  const raw = body.toString("utf8");
  let decoded = "";
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    // Not encoded as a form.
  }
  const key = recordingKey(`${raw}\n${decoded}`, values);
  if (key === null) return null;
  // A multipart body has a boundary of its own per send.
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType ?? "")?.[1];
  return { key, bodySha256: sha256(boundary ? raw.split(boundary).join("") : raw) };
}

/** Statuses after which a replay would hide what went wrong: a session or login that was missing, too many requests, or a server that failed. */
const UNPLAYABLE_STATUS = new Set([401, 403, 407, 419, 429, 440]);
/** Content a token or code can be in that can be read; any other content cannot be judged. */
const TEXT_CONTENT = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|x-www-form-urlencoded)\b)/i;
/**
 * Signs of something an answer hands the page to use later, that a replay would hand over from another
 * session: a field or key named like a token, a session in an address, a one-time code. Broad on purpose:
 * an answer that matches is sent for real next time, which costs budget but shows nothing wrong.
 */
const SESSION_SIGNS: readonly RegExp[] = [
  // A field or meta element named like a CSRF token, a nonce or the state of a page (ASP.NET).
  /\bname\s*=\s*["']?[\w:.[\]-]*(?:csrf|xsrf|token|nonce|authenticity|verification|viewstate|eventvalidation|session|sessie)/i,
  // A key in JSON or a script named like one.
  /["'][\w-]*(?:csrf|xsrf|token|nonce|session|sessie|otp|verification)[\w-]*["']\s*:/i,
  // A session or one-time code in an address.
  /[?&;](?:jsessionid|phpsessid|sid|sessionid|session_id|token|code|state)=/i,
  // A one-time code in words.
  /\b(?:eenmalige|verificatie|bevestigings)\s*code\b|\bone[- ]time\b|\botp\b/i,
];

/**
 * Why an answer to a request over HTTP may not be played, in Dutch, or null when it may. `url` is the
 * address of the request, `origin` the test environment. What comes after a redirect is judged in the browser.
 */
export function answerRefusalNl(answer: { status: number; headers: Record<string, string>; body: Buffer }, url: string, origin: string): string | null {
  const headers = Object.fromEntries(Object.entries(answer.headers).map(([name, value]) => [name.toLowerCase(), value]));
  const { status } = answer;
  if (status === 307 || status === 308) return `de server stuurde het verzoek door met dezelfde methode (${status}); een afspeling zou het daarna toch versturen`;
  if (UNPLAYABLE_STATUS.has(status) || status >= 500) return `de server antwoordde met ${status}, dus met iets over de sessie, de toegang of zichzelf, niet over wat er werd verstuurd`;
  if (headers["set-cookie"]) return "het antwoord zet een cookie: een sessie of kenmerk dat de pagina daarna nodig kan hebben, en dat een afspeling niet zet";
  if (status >= 300 && status < 400) {
    const location = headers["location"];
    if (!location) return `het antwoord is een doorverwijzing (${status}) zonder adres`;
    let target: URL;
    try {
      target = new URL(location, url);
    } catch {
      return "het adres van de doorverwijzing is geen geldig adres";
    }
    if (target.origin !== origin) return `de doorverwijzing gaat naar ${target.origin}, buiten de testomgeving`;
    if (SESSION_SIGNS.some((sign) => sign.test(`${target.pathname}${target.search}`))) return "het adres van de doorverwijzing bevat een kenmerk van een sessie of een eenmalige code";
  }
  if (answer.body.length > MAX_ANSWER_BYTES) return "het antwoord is te groot om op te nemen";
  if (answer.body.length === 0) return null;
  if (!TEXT_CONTENT.test(headers["content-type"] ?? "")) return "het antwoord is geen tekst; of er een kenmerk van een sessie in staat, is niet na te gaan";
  const sign = SESSION_SIGNS.find((pattern) => pattern.test(answer.body.toString("utf8")));
  return sign ? "het antwoord bevat een CSRF-token, een eenmalige code of een kenmerk van een sessie" : null;
}

export interface HttpRecordings {
  /** The playable recording of this request, or null when there is none yet or the body has no test value. */
  find: (method: string, url: string, send: { key: string; bodySha256: string }) => HttpRecording | null;
  /** Keep the answer to a request that was sent for real; with `refusedNl` it is kept for the dossier and never played. */
  record: (entry: { method: string; url: string; send: { key: string; bodySha256: string }; answer: RecordedAnswer; chain?: HttpRecording["chain"]; refusedNl?: string | null; sender?: string | undefined; at: number }) => HttpRecording | null;
  /** Note that a request was answered from a recording. */
  replayed: (url: string, recording: HttpRecording, sender?: string) => PassedReplay;
}

export function httpRecordings(runDir: string, source: string, options: Pick<RecordingOptions, "now" | "sendsTo"> = {}): HttpRecordings {
  const { now = Date.now } = options;
  const sendsTo = options.sendsTo ?? approvedSendsTo(runDir);
  const append = (file: string, entry: unknown): void => {
    mkdirSync(runDir, { recursive: true });
    appendFileSync(join(runDir, file), `${JSON.stringify(entry)}\n`);
  };
  const find: HttpRecordings["find"] = (method, url, send) => {
    const origin = originOf(url);
    const path = pathOf(url);
    const matchedOn = matchedOnFor(sendsTo, url);
    return (
      readHttpRecordings(runDir).find(
        (recording) =>
          !recording.refusedNl &&
          recording.origin === origin &&
          recording.method === method &&
          recording.key === send.key &&
          recording.bodySha256 === send.bodySha256 &&
          matchedOnFor(sendsTo, `${recording.origin}${recording.path}`) === matchedOn &&
          // Without a pattern the path counts: two forms on one origin send to two addresses.
          (matchedOn !== DECLARED_ORIGIN || recording.path === path),
      ) ?? null
    );
  };
  return {
    find,
    record: ({ method, url, send, answer, chain, refusedNl, sender = source, at }) => {
      // The first playable recording of a request counts.
      if (!refusedNl && find(method, url, send)) return null;
      const path = pathOf(url);
      const started = new Date(at).toISOString();
      const recording: HttpRecording = { id: `${method} ${originOf(url)}${path}|${send.key}|${started}`, at: started, source: sender, origin: originOf(url), path, method, key: send.key, kind: "http", bodySha256: send.bodySha256, matchedOn: matchedOnFor(sendsTo, url), answer, ...(chain ? { chain } : {}), ...(refusedNl ? { refusedNl } : {}) };
      append(RECORDINGS_LOG, recording);
      return recording;
    },
    replayed: (url, recording, sender = source) => {
      const entry: PassedReplay = { at: new Date(now()).toISOString(), source: sender, recording: recording.id, path: pathOf(url), key: recording.key, matchedOn: matchedOnFor(sendsTo, url), method: recording.method };
      append(REPLAYS_LOG, entry);
      return entry;
    },
  };
}

/** One line for an agent and for the dossier: that a request over HTTP was answered from a recording, and what that does not show. */
export function httpReplayNl(recording: HttpRecording, matchedOn: string = recording.matchedOn): string {
  const landed = recording.chain?.at(-1);
  const answered = landed ? `een doorverwijzing (${recording.answer.status}) naar ${new URL(landed.url).pathname}` : `${recording.answer.status}`;
  const on = matchedOn === DECLARED_ORIGIN ? "de verklaarde origin van de testomgeving, de methode, het pad en de inhoud van de verzending, zonder patroon uit het sitemodel" : `het patroon ${matchedOn} uit het sitemodel, de methode en de inhoud van de verzending`;
  return `niet verstuurd maar beantwoord uit een opname: deze verzending (${recording.method} ${recording.path}) is om ${new Date(recording.at).toTimeString().slice(0, 5)} al eens echt verstuurd (${recording.source}), en het antwoord van toen (${answered}) is nu in de browser gegeven, zonder cookies${landed ? "; de browser volgde de doorverwijzing zelf en kreeg die pagina van de server" : ""}. Wat de pagina daarna toont, laat voorlezen en met de focus doet, is echt gemeten; dat de server de verzending opnieuw verwerkt, niet. De opname is gezocht op ${on}`;
}

/** One line for an agent and for the dossier: that a send was played from a recording, and what that does not show. */
export const replayNl = (recording: SocketRecording, matchedOn: string = recording.matchedOn ?? DECLARED_ORIGIN): string =>
  `${replayBodyNl(recording)}. ${matchedOnNl(matchedOn)}`;

/** On what a recording was looked up, in a sentence without a closing full stop. */
const matchedOnNl = (matchedOn: string): string =>
  matchedOn === DECLARED_ORIGIN ? "De opname is gezocht op de verklaarde origin van de testomgeving en de testwaarden in het bericht, zonder patroon uit het sitemodel" : `De opname is gezocht op het patroon ${matchedOn} uit het sitemodel en de testwaarden in het bericht`;

const replayBodyNl = (recording: SocketRecording): string =>
  recording.frames.length === 0
    ? `niet verstuurd maar afgespeeld: dit bericht is om ${new Date(recording.at).toTimeString().slice(0, 5)} al eens echt verstuurd (${recording.source}), en de server zei toen ${Math.round((recording.listenedMs ?? RECORD_WINDOW_MS) / 1000)} s lang niets terug; de pagina krijgt nu ook niets. Wat de pagina zelf doet na het versturen, is echt gemeten; een antwoord dat pas later komt, bijvoorbeeld van een mens, staat niet in een opname`
    : `niet verstuurd maar afgespeeld: dit bericht is om ${new Date(recording.at).toTimeString().slice(0, 5)} al eens echt verstuurd (${recording.source}), en wat de server toen antwoordde (${recording.frames.length} ${recording.frames.length === 1 ? "bericht" : "berichten"}) is nu met dezelfde tussentijden aan de pagina gegeven. Wat de pagina daarmee doet, is echt gemeten; wat de server pas later uit zichzelf doet, staat niet in een opname`;

/** What an agent hears in its task when the run may send: that a message sent before is played, and what that means for its verdict. */
export const REPLAY_TASK_NL =
  "Een bericht in een chat dat al eens echt is verstuurd, gaat niet nog een keer weg: wat de server toen antwoordde, wordt met dezelfde tussentijden aan de pagina gegeven, en dat telt niet mee voor het budget. Het antwoord van het commando zegt het dan onder `replayed`. Wat de pagina met dat antwoord doet (wat ze toont, laat voorlezen en waar de focus heen gaat), meet je gewoon. Wat de server pas later uit zichzelf doet, zoals een gesprek dat na een tijd afloopt, staat niet in een opname: daarvoor is een echte verzending nodig. Een formulier dat precies zo al eens is verstuurd (hetzelfde adres, dezelfde keuzes en testwaarden), gaat ook niet nog een keer weg: de browser krijgt het antwoord van toen, volgt zelf de doorverwijzing en toont de pagina die de server daarna geeft. Ook dat staat onder `replayed` en telt niet mee. Bevatte dat antwoord een kenmerk van een sessie, dan gaat het formulier wel echt weg";

/** For the evaluation, after what was allowed: how many messages and requests were recorded and how often a recording was played instead of a send, without a closing full stop. Null when neither happened. */
export function replaysNl(runDir: string): string | null {
  const passed = readReplays(runDir);
  const times = (count: number): string => (count === 1 ? "één keer" : `${count} keer`);
  const sentences: string[] = [];
  const recordings = readRecordings(runDir).filter((recording) => !recording.incomplete).length;
  const messages = passed.filter((entry) => entry.method === undefined);
  if (recordings > 0 || messages.length > 0) {
    const replays = messages.length;
    const matched = [...new Set(messages.map((entry) => entry.matchedOn ?? DECLARED_ORIGIN))].sort();
    const lookedUp = matched.length === 0 ? "" : `. Gezocht is op ${matched.map((on) => (on === DECLARED_ORIGIN ? "de verklaarde origin van de testomgeving" : `het patroon ${on} uit het sitemodel`)).join(" en op ")}, met de testwaarden in het bericht`;
    sentences.push(`Van ${recordings === 1 ? "één bericht" : `${recordings} berichten`} in een chat is het antwoord van de server opgenomen toen het echt werd verstuurd, ook als dat antwoord was dat er een tijd niets kwam. ${replays > 0 ? `Daarna is ${times(replays)} hetzelfde bericht niet opnieuw verstuurd, maar is de opname afgespeeld: de pagina kreeg het antwoord van toen, met dezelfde tussentijden. Wat de pagina ermee deed, is gemeten; wat de server later uit zichzelf zou doen, niet` : "Geen opname is afgespeeld"}${lookedUp}`);
  }
  const http = readHttpRecordings(runDir);
  const answered = passed.filter((entry) => entry.method !== undefined).length;
  if (http.length > 0 || answered > 0) {
    const refused = http.filter((recording) => recording.refusedNl).length;
    sentences.push(
      `Van ${http.length === 1 ? "één verzending" : `${http.length} verzendingen`} over HTTP (een formulier of een verzoek van een script) is het antwoord van de server opgenomen toen ${http.length === 1 ? "ze" : "ze elk"} echt werd verstuurd${refused > 0 ? `; ${refused === http.length ? (refused === 1 ? "dat antwoord is nooit" : "geen van die antwoorden is") : refused === 1 ? "één daarvan is nooit" : `${refused} daarvan zijn nooit`} gebruikt, omdat er een kenmerk van een sessie in stond of de pagina daarna een sessie vroeg, en dan ging de volgende verzending echt` : ""}. ${answered > 0 ? `Daarna is ${times(answered)} dezelfde verzending niet opnieuw verstuurd, maar in de browser beantwoord met de opname, zonder cookies; na een doorverwijzing haalde de browser de volgende pagina zelf bij de server. Wat de pagina daarna deed, is gemeten; dat de server de verzending opnieuw verwerkte, niet` : "Geen verzending is uit een opname beantwoord"}`,
    );
  }
  return sentences.length > 0 ? sentences.join(". ") : null;
}
