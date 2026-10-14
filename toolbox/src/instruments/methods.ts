import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One way of measuring something, with enough to say later which code produced the number. */
export interface MethodResult<T = unknown> {
  /** What is measured and how, e.g. "pixel-screenshot" or "rule-engine". */
  method: string;
  /** The code that did it, e.g. "loep" or "axe-core". */
  implementation: string;
  version: string;
  result: T;
  /** The principle the method works on, in a few words: what makes it independent of the others. */
  principle?: string;
  /** How long the method took. Zero when the answer came from the cache. */
  ms?: number;
  /** Set when this answer is of a kind this method is known to get wrong: the reason, in Dutch. */
  knownUnreliable?: string;
}

/** A method that gave no answer: it crashed, ran out of time, or needs something this machine does not have. */
export interface MethodFailure {
  method: string;
  implementation: string;
  version: string;
  kind: "failed" | "timeout" | "unavailable";
  /** Why, in Dutch. For an unavailable method this includes how to install what is missing. */
  reason: string;
  ms?: number;
}

/**
 * The result of a measuring instrument: every independent method that ran, side by side.
 * With one method there is nothing to compare; with more, disagreement is a signal to whoever reads it.
 * No answer is dropped or averaged: `methods` holds them all.
 */
export interface Measured<T = unknown> {
  methods: MethodResult<T>[];
  /** Over the methods that gave an opinion: "none" when no method did, "single" when one did. */
  agreement: "none" | "single" | "agree" | "disagree";
  differences: string[];
  /**
   * Methods that ran and have no opinion on this question here: they could not tell, or what
   * they measure does not apply. They are listed, with the reason, and never count as a dissent.
   */
  noOpinion: string[];
  /** Methods that should have answered and did not. */
  failed: MethodFailure[];
  /** Methods still running in the background: `wait`, or the same command again, picks them up. */
  pending: string[];
}

export const TOOLBOX_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string }).version;

/** Put the methods that ran next to each other. `differences` lists where they contradict each other; empty means they agree. */
export function measuredBy<T>(methods: MethodResult<T>[], differences: string[] = [], rest: { failed?: MethodFailure[]; pending?: string[]; noOpinion?: string[] } = {}): Measured<T> {
  const noOpinion = rest.noOpinion ?? [];
  const opinions = methods.length - noOpinion.length;
  return { methods, agreement: opinions < 1 ? "none" : opinions < 2 ? "single" : differences.length === 0 ? "agree" : "disagree", differences, noOpinion, failed: rest.failed ?? [], pending: rest.pending ?? [] };
}

/** The line for a printed summary: how many methods ran, whether they agree, and how many did not answer (yet). */
export const agreementLine = (measured: Measured): string =>
  `${measured.methods.length - measured.noOpinion.length} ${measured.agreement === "none" ? "met een uitspraak" : measured.agreement}${measured.noOpinion.length > 0 && measured.agreement !== "none" ? `, ${measured.noOpinion.length} geen uitspraak` : ""}${measured.failed.length > 0 ? `, ${measured.failed.length} zonder antwoord` : ""}${measured.pending.length > 0 ? `, ${measured.pending.length} loopt nog` : ""}`;
