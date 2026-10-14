import type { Frame, Page } from "playwright";

/**
 * One attempt of a page to put something on the clipboard, recorded inside the page where it
 * was made (see `clipboardWrites` in inpage.js). The clipboard of the machine is never read:
 * what was written is known because the page said so when it asked.
 */
export interface ClipboardWrite {
  /** How the page wrote: the two methods of `navigator.clipboard`, the old copy command, or a copy event without one. */
  kind: "writeText" | "write" | "execCommand" | "copy-event";
  /** The first 500 characters of the text; null when the page wrote something that is not text. */
  text: string | null;
  /** The length of the whole text. */
  length: number | null;
  /** For `write`: the kinds of data the page offered. */
  types?: string[];
  /** Whether the browser took it; null while the browser has not answered yet. */
  ok: boolean | null;
  /** The name of the error the browser refused with. */
  error: string | null;
}

type Library = { __loep?: { clipboardWrites?: () => ClipboardWrite[] } };
const read = (frame: Frame): Promise<ClipboardWrite[]> => frame.evaluate(() => (window as unknown as Library).__loep?.clipboardWrites?.() ?? []).catch(() => []);

/** Where the record of every frame stands now, to tell afterwards what an action added. */
export async function clipboardMark(page: Page): Promise<Map<Frame, number>> {
  const mark = new Map<Frame, number>();
  for (const frame of page.frames()) mark.set(frame, (await read(frame)).length);
  return mark;
}

/** What the page, and every frame in it that can be read, wrote to the clipboard since the mark. */
export async function clipboardSince(page: Page, mark: Map<Frame, number>): Promise<ClipboardWrite[]> {
  const writes: ClipboardWrite[] = [];
  for (const frame of page.frames()) {
    const all = await read(frame);
    const before = mark.get(frame) ?? 0;
    // A shorter record is the record of a new document in the same frame: all of it is new.
    writes.push(...(all.length >= before ? all.slice(before) : all));
  }
  return writes;
}

/** An error with which a browser says the page may not use the clipboard, as opposed to a mistake of the page. */
export const refusedByBrowser = (write: ClipboardWrite): boolean => write.ok === false && (write.error === "NotAllowedError" || write.error === "SecurityError");

const SHOWN = 60;

/** One write as a session prints it. */
export function clipboardLine(write: ClipboardWrite): string {
  if (refusedByBrowser(write)) return `geweigerd door de browser (${write.error})`;
  if (write.ok === false) return `mislukt (${write.error ?? "onbekende fout"})`;
  const how = write.kind === "copy-event" ? " (kopieergebeurtenis, of de browser het aannam is niet te zien)" : write.kind === "execCommand" ? " (met het oude kopieercommando)" : "";
  const state = write.ok === null ? "gevraagd, de browser heeft nog niet geantwoord" : "gekopieerd";
  if (write.text === null) return `${state}${how}, geen tekst${write.types?.length ? ` (${write.types.join(", ")})` : ""}`;
  if (write.length === 0) return `${state}${how}, 0 tekens: het klembord is leeg gemaakt`;
  const start = write.text.replace(/\s+/g, " ").trim();
  return `${state}${how}, ${write.length} tekens, ${start.length > SHOWN || (write.length ?? 0) > write.text.length ? "begint met" : "tekst"} "${start.slice(0, SHOWN)}"`;
}

/** Words with which a control or a message says that something is copied. */
export const COPY_WORDS = /klembord|clipboard|kopi[eë]|\bcop(?:y|ied)\b/i;
/** A control that, by its name or title, copies something. */
export const COPIES_BY_NAME = /kopi[eë]|\bcop(?:y|ied)\b/i;
export const NOTHING_WRITTEN_NL = "niets naar het klembord geschreven";

/**
 * What an action did to the clipboard, for the answer of a command: a line per write, or the
 * statement that nothing was written when the page itself speaks of copying. Null when the
 * clipboard did not come up at all.
 */
export function clipboardReport(writes: ClipboardWrite[], texts: string[]): string | string[] | null {
  if (writes.length === 0) return texts.some((text) => COPY_WORDS.test(text)) ? NOTHING_WRITTEN_NL : null;
  const lines = writes.map(clipboardLine);
  return lines.length === 1 ? lines[0]! : lines;
}
