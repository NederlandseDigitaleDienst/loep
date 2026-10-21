import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 *   run may send to one origin only, the test environment it was given, and a message is made of
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
  kind?: "websocket" | "http";
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

export const readRecordings = (runDir: string): SocketRecording[] => readLines<SocketRecording>(join(runDir, RECORDINGS_LOG));
export const readReplays = (runDir: string): PassedReplay[] => readLines<PassedReplay>(join(runDir, REPLAYS_LOG));

/** What the server says after one real send, until the window ends. */
export interface Recorder {
  frame: (message: string | Buffer) => void;
  /** End the recording now, before its window ended: the page sent another message, or the socket closed. Unless the server had been quiet for `RECORD_QUIET_MS`, it is then incomplete and never played. */
  end: () => void;
}

export interface SocketRecordings {
  /** The complete recording of this message under the same `sendsTo` pattern or on the declared origin, or null when there is none yet or the message has no test value. */
  find: (url: string, message: string | Buffer) => SocketRecording | null;
  /** Start recording what the server answers to a message that was sent for real; null for a frame without a test value, which is not recorded. */
  start: (url: string, message: string | Buffer, sender?: string) => Recorder | null;
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
  const find = (url: string, message: string | Buffer): SocketRecording | null => {
    const key = recordingKey(message, values);
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
    start: (url, message, sender = source) => {
      const key = recordingKey(message, values);
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
        if ((frames.length === 0 && listenedMs < RECORD_SILENCE_MS) || find(url, message)) return;
        const path = pathOf(url);
        append(RECORDINGS_LOG, { id: `${originOf(url)}${path}|${key}|${new Date(started).toISOString()}`, at: new Date(started).toISOString(), source: sender, origin: originOf(url), path, key, kind: connectionKind(url), matchedOn: matchedOnFor(sendsTo, url), frames, listenedMs, ...(complete ? {} : { incomplete: true as const }) } satisfies SocketRecording);
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
  "Een bericht in een chat dat al eens echt is verstuurd, gaat niet nog een keer weg: wat de server toen antwoordde, wordt met dezelfde tussentijden aan de pagina gegeven, en dat telt niet mee voor het budget. Het antwoord van het commando zegt het dan onder `replayed`. Wat de pagina met dat antwoord doet (wat ze toont, laat voorlezen en waar de focus heen gaat), meet je gewoon. Wat de server pas later uit zichzelf doet, zoals een gesprek dat na een tijd afloopt, staat niet in een opname: daarvoor is een echte verzending nodig";

/** For the evaluation, after what was allowed: how many messages were recorded and how often a recording was played instead of a send, without a closing full stop. Null when neither happened. */
export function replaysNl(runDir: string): string | null {
  const recordings = readRecordings(runDir).filter((recording) => !recording.incomplete).length;
  const passed = readReplays(runDir);
  const replays = passed.length;
  if (recordings === 0 && replays === 0) return null;
  const matched = [...new Set(passed.map((entry) => entry.matchedOn ?? DECLARED_ORIGIN))].sort();
  const lookedUp = matched.length === 0 ? "" : `. Gezocht is op ${matched.map((on) => (on === DECLARED_ORIGIN ? "de verklaarde origin van de testomgeving" : `het patroon ${on} uit het sitemodel`)).join(" en op ")}, met de testwaarden in het bericht`;
  const times = (count: number): string => (count === 1 ? "één keer" : `${count} keer`);
  return `Van ${recordings === 1 ? "één bericht" : `${recordings} berichten`} in een chat is het antwoord van de server opgenomen toen het echt werd verstuurd, ook als dat antwoord was dat er een tijd niets kwam. ${replays > 0 ? `Daarna is ${times(replays)} hetzelfde bericht niet opnieuw verstuurd, maar is de opname afgespeeld: de pagina kreeg het antwoord van toen, met dezelfde tussentijden. Wat de pagina ermee deed, is gemeten; wat de server later uit zichzelf zou doen, niet` : "Geen opname is afgespeeld"}${lookedUp}`;
}
