import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 */

/** One recording per message per origin, in the run: the first one that ends wins. */
export const RECORDINGS_LOG = "opnames.jsonl";
/** Every send that was played from a recording instead of sent: when, by whom, and which recording. */
export const REPLAYS_LOG = "afgespeeld.jsonl";
/** How long after a real send the answer of the server is recorded, unless the page sends another message or the socket closes first. */
export const RECORD_WINDOW_MS = 30_000;

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
  path: string;
  /** Which message it was: the test values in it, sorted, or for a message without one, such as an empty one, the hash of the frame (see `recordingKey`). */
  key: string;
  frames: RecordedFrame[];
}

export interface PassedReplay {
  at: string;
  source: string;
  recording: string;
  path: string;
  key: string;
}

/** The origin of a socket as its http(s) twin. */
function originOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  return parsed.origin;
}

/**
 * Which message a frame is: the test values in it, sorted. A frame without any, such as an empty
 * message, is only the same message when it is the same frame to the byte: it may also be something
 * else the page says, such as that the chat was opened, and that has another answer.
 */
export function recordingKey(message: string | Buffer, values: readonly string[]): string {
  const ours = values.filter((value) => isOurMessage(message, [value])).sort();
  if (ours.length > 0) return ours.join("|");
  return `frame:${createHash("sha256").update(typeof message === "string" ? `t${message}` : Buffer.concat([Buffer.from("b"), message])).digest("hex").slice(0, 16)}`;
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
  /** End the recording now: the page sent another message, or the socket closed. */
  end: () => void;
}

export interface SocketRecordings {
  /** The recording of this message on the origin of this socket, or null when there is none yet. */
  find: (url: string, message: string | Buffer) => SocketRecording | null;
  /** Start recording what the server answers to a message that was sent for real. */
  start: (url: string, message: string | Buffer, sender?: string) => Recorder;
  /** Note that a send was played from a recording. */
  replayed: (url: string, recording: SocketRecording, sender?: string) => PassedReplay;
}

export function socketRecordings(runDir: string, source: string, values: readonly string[], now: () => number = Date.now, windowMs = RECORD_WINDOW_MS): SocketRecordings {
  const append = (file: string, entry: unknown): void => {
    mkdirSync(runDir, { recursive: true });
    // Appended at once and synchronously, as the log of writes is.
    appendFileSync(join(runDir, file), `${JSON.stringify(entry)}\n`);
  };
  const find = (url: string, message: string | Buffer): SocketRecording | null => {
    const origin = originOf(url);
    const key = recordingKey(message, values);
    return readRecordings(runDir).find((recording) => recording.origin === origin && recording.key === key) ?? null;
  };
  return {
    find,
    start: (url, message, sender = source) => {
      const started = now();
      const frames: RecordedFrame[] = [];
      let ended = false;
      const end = (): void => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        // The first recording of a message counts; one that ends later is not kept.
        if (find(url, message)) return;
        const parsed = new URL(url);
        const key = recordingKey(message, values);
        append(RECORDINGS_LOG, { id: `${originOf(url)}|${key}|${new Date(started).toISOString()}`, at: new Date(started).toISOString(), source: sender, origin: originOf(url), path: parsed.pathname, key, frames } satisfies SocketRecording);
      };
      const timer = setTimeout(end, windowMs);
      timer.unref?.();
      return {
        frame: (reply) => {
          // A heartbeat of the server is no answer, and the live connection keeps sending its own.
          if (ended || isProtocolFrame(reply)) return;
          frames.push({ afterMs: now() - started, ...(typeof reply === "string" ? { text: reply } : { base64: reply.toString("base64") }) });
        },
        end,
      };
    },
    replayed: (url, recording, sender = source) => {
      const entry: PassedReplay = { at: new Date(now()).toISOString(), source: sender, recording: recording.id, path: new URL(url).pathname, key: recording.key };
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
export const replayNl = (recording: SocketRecording): string =>
  `niet verstuurd maar afgespeeld: dit bericht is om ${new Date(recording.at).toTimeString().slice(0, 5)} al eens echt verstuurd (${recording.source}), en wat de server toen antwoordde (${recording.frames.length} ${recording.frames.length === 1 ? "bericht" : "berichten"}) is nu met dezelfde tussentijden aan de pagina gegeven. Wat de pagina daarmee doet, is echt gemeten; wat de server pas later uit zichzelf doet, staat niet in een opname`;

/** What an agent hears in its task when the run may send: that a message sent before is played, and what that means for its verdict. */
export const REPLAY_TASK_NL =
  "Een bericht in een chat dat al eens echt is verstuurd, gaat niet nog een keer weg: wat de server toen antwoordde, wordt met dezelfde tussentijden aan de pagina gegeven, en dat telt niet mee voor het budget. Het antwoord van het commando zegt het dan onder `replayed`. Wat de pagina met dat antwoord doet (wat ze toont, laat voorlezen en waar de focus heen gaat), meet je gewoon. Wat de server pas later uit zichzelf doet, zoals een gesprek dat na een tijd afloopt, staat niet in een opname: daarvoor is een echte verzending nodig";

/** For the evaluation, after what was allowed: how many messages were recorded and how often a recording was played instead of a send, without a closing full stop. Null when neither happened. */
export function replaysNl(runDir: string): string | null {
  const recordings = readRecordings(runDir).length;
  const replays = readReplays(runDir).length;
  if (recordings === 0 && replays === 0) return null;
  const times = (count: number): string => (count === 1 ? "één keer" : `${count} keer`);
  return `Van ${recordings === 1 ? "één bericht" : `${recordings} berichten`} in een chat is het antwoord van de server opgenomen toen het echt werd verstuurd. ${replays > 0 ? `Daarna is ${times(replays)} hetzelfde bericht niet opnieuw verstuurd, maar is de opname afgespeeld: de pagina kreeg het antwoord van toen, met dezelfde tussentijden. Wat de pagina ermee deed, is gemeten; wat de server later uit zichzelf zou doen, niet` : "Geen opname is afgespeeld"}`;
}
