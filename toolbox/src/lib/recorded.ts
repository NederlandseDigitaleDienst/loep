import { createInterface } from "node:readline/promises";

/*
 * What a person states, a person states: an answer to an open point, a decision about a defect,
 * a signature, a declaration that a site is a test environment. Every such record says how it
 * came about, in so many words; a missing way never means "the person typed it".
 *
 * - `terminal`: the person confirmed it at an interactive terminal, by typing it back.
 * - `gesprek`: the agent recorded it in the conversation, after an express confirmation of the
 *   person. The record keeps that confirmation word for word and the summary that was confirmed.
 *
 * An answer and a decision may come about either way. A signature and the declaration for
 * sending may not be recorded by an agent: they ask a person at a terminal to type back part
 * of what is recorded (the seal, the origin), and are refused without an interactive terminal.
 */

export const RECORDED_VIA = ["terminal", "gesprek"] as const;
export type RecordedVia = (typeof RECORDED_VIA)[number];

/** How a record came about, as it is kept with the record. */
export type Recording = { recordedVia: "terminal" } | { recordedVia: "gesprek"; confirmationNl: string; summaryNl: string };

/** What a record may carry about how it came about; absent in a record from before this was kept. */
export interface Recorded {
  recordedVia?: RecordedVia | undefined;
  confirmationNl?: string | undefined;
  summaryNl?: string | undefined;
}

/**
 * Where a person types a confirmation. The commands take it as an argument, so a test can play
 * the person; a run from the command line always gets `processTerminal()`, and with that only an
 * interactive stdin counts. There is deliberately no environment variable or flag to get around it.
 */
export interface Terminal {
  /** Whether a person can type an answer here. */
  interactive: boolean;
  /** Show the text and return the line the person typed. */
  ask(textNl: string): Promise<string>;
}

export function processTerminal(): Terminal {
  return {
    interactive: process.stdin.isTTY === true,
    async ask(textNl) {
      const lines = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await lines.question(textNl);
      } finally {
        lines.close();
      }
    },
  };
}

/** The value of `--recorded-via`, checked. Undefined when the flag was not given. */
export function parseRecordedVia(value: string | undefined): RecordedVia | undefined {
  if (value === undefined) return undefined;
  if (!(RECORDED_VIA as readonly string[]).includes(value)) throw new Error(`--recorded-via is "terminal" (de persoon bevestigt in een interactieve terminal) of "gesprek" (de assistent legt vast na een uitdrukkelijke bevestiging in het gesprek, met --confirmation en --summary), niet "${value}"`);
  return value as RecordedVia;
}

const MIN_SUMMARY = 10;
const oneLine = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** Said when a person has to run a command at a terminal: what an agent may not record. */
export const HUMAN_AT_TERMINAL_NL = "Een mens moet dit zelf draaien, in een interactieve terminal: in een eigen terminalvenster, of met `! <commando>` in Claude Code";

export interface RecordingFlags {
  recordedVia?: string | undefined;
  /** `--confirmation`: what the person said in the conversation, word for word. */
  confirmation?: string | undefined;
  /** `--summary`: the summary the person confirmed. */
  summary?: string | undefined;
}

/**
 * How an answer or a decision comes about. In the conversation it needs the literal confirmation
 * and the summary that was confirmed; otherwise a person confirms it at an interactive terminal,
 * and without one it is refused. Nothing is written before this returns.
 */
export async function recordStatement(command: string, flags: RecordingFlags, shownNl: string, terminal: Terminal): Promise<Recording> {
  const via = parseRecordedVia(flags.recordedVia);
  const confirmationNl = oneLine(flags.confirmation);
  const summaryNl = oneLine(flags.summary);
  if (via === "gesprek") {
    if (!confirmationNl || summaryNl.length < MIN_SUMMARY) {
      throw new Error(`${command} met --recorded-via gesprek vraagt wat de gebruiker letterlijk zei (--confirmation "<letterlijke tekst>") en de samenvatting die de gebruiker bevestigde (--summary "<samenvatting>"); zonder die twee wordt niets vastgelegd`);
    }
    return { recordedVia: "gesprek", confirmationNl, summaryNl };
  }
  if (flags.confirmation !== undefined || flags.summary !== undefined) throw new Error("--confirmation en --summary horen bij --recorded-via gesprek");
  if (!terminal.interactive) {
    throw new Error(`${command} legt vast wat een persoon verklaart, en zegt hoe: in een interactieve terminal, of in een gesprek. Er is hier geen interactieve terminal. ${HUMAN_AT_TERMINAL_NL}; of de assistent legt het vast met --recorded-via gesprek --confirmation "<letterlijke bevestiging>" --summary "<bevestigde samenvatting>"`);
  }
  const typed = await terminal.ask(`${shownNl}\nKlopt dit? Typ ja om het vast te leggen: `);
  if (typed.trim().toLowerCase() !== "ja") throw new Error("niet bevestigd: er is niets vastgelegd");
  return { recordedVia: "terminal" };
}

/**
 * For what an agent may never record (a signature, the declaration for sending): a person at an
 * interactive terminal sees what is recorded and types back part of it. Refused in a
 * conversation and without an interactive terminal.
 */
export async function confirmByTyping(command: string, shownNl: string, expected: string, whatNl: string, terminal: Terminal): Promise<{ recordedVia: "terminal" }> {
  if (!terminal.interactive) throw new Error(`${command} legt de assistent nooit vast: het vraagt een bevestiging van een mens in een interactieve terminal, en die is er hier niet. ${HUMAN_AT_TERMINAL_NL}. Er is niets vastgelegd`);
  const typed = await terminal.ask(`${shownNl}\nTyp ter bevestiging ${whatNl}: `);
  if (typed.trim() !== expected) throw new Error(`niet bevestigd: dat is niet ${whatNl}. Er is niets vastgelegd`);
  return { recordedVia: "terminal" };
}

/** Date and time in the timezone the site is evaluated in. */
export function dateTimeNl(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

/** "vastgelegd in een gesprek, bevestigd op 12 oktober 2026 om 11:00" or "bevestigd in een terminal op ..."; null for a record from before the way was kept. */
export function recordedNl(record: Recorded, at: string): string | null {
  if (record.recordedVia === "gesprek") return `vastgelegd in een gesprek, bevestigd op ${dateTimeNl(at)}`;
  if (record.recordedVia === "terminal") return `bevestigd in een terminal op ${dateTimeNl(at)}`;
  return null;
}
