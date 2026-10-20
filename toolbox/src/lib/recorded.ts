/*
 * What a person states, a person states: an answer to an open point, a decision about a defect,
 * a signature, a declaration that a site is a test environment. Who types the command matters
 * less than what the person said. The agent that leads the evaluation may therefore record such
 * a statement itself, in the conversation, after the person said so in so many words and said
 * yes to a repetition of what is recorded. The record then says that it came about that way, and
 * its time is the moment of that yes: the agent records it right after.
 */

/** The one way of recording besides a person typing the command: by the agent, in the conversation. */
export const RECORDED_VIA = "gesprek";
export type RecordedVia = typeof RECORDED_VIA;

/** The value of `--recorded-via`, checked. Undefined when the flag was not given: the person typed the command. */
export function parseRecordedVia(value: string | undefined): RecordedVia | undefined {
  if (value === undefined) return undefined;
  if (value !== RECORDED_VIA) throw new Error(`--recorded-via kent één waarde, "${RECORDED_VIA}": voor wat de agent vastlegt na een uitdrukkelijke bevestiging van de gebruiker in het gesprek`);
  return value;
}

/** Date and time in the timezone the site is evaluated in. */
export function dateTimeNl(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

/** "vastgelegd in een gesprek, bevestigd op 12 oktober 2026 om 11:00"; null for a record the person typed. */
export function recordedNl(record: { recordedVia?: RecordedVia | undefined }, at: string): string | null {
  return record.recordedVia === RECORDED_VIA ? `vastgelegd in een gesprek, bevestigd op ${dateTimeNl(at)}` : null;
}
