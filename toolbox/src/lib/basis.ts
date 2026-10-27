import type { CriterionResult } from "./evaluation.ts";
import { canonicalCommand, MEASURE_COMMANDS, OBSERVATION_ID, type ObservationIndex } from "./verdict.ts";

/**
 * What an outcome rests on, derived from what its verdict cites and never given by an agent (#318):
 * an instrument (a measure command of the session, or the dossier of the sweep), what an agent saw
 * and did itself (look, crop, click and the like), a person, or nothing yet.
 */
export type Basis = "measured" | "observed" | "person" | "open";

export const BASIS_NL: Record<Basis, string> = {
  measured: "gemeten met een instrument",
  observed: "vastgesteld door een agent op eigen waarnemingen",
  person: "vastgesteld door een persoon",
  open: "open",
};

const MEASURING = new Set<string>(MEASURE_COMMANDS);

/** A reference rests on an instrument when it is a measure command of the session, or a part of the dossier that the sweep measured. */
function measuredRef(ref: string, index: ObservationIndex): boolean {
  if (!OBSERVATION_ID.test(ref)) return true;
  const observation = index.get(ref);
  return observation !== undefined && !observation.failed && MEASURING.has(canonicalCommand(observation.command));
}

/** What one examined place rests on: an instrument when one of its references does, else what the agent saw. */
export function placeBasis(evidence: unknown, index: ObservationIndex): "measured" | "observed" {
  const refs = (Array.isArray(evidence) ? evidence : []).filter((ref): ref is string => typeof ref === "string");
  return refs.some((ref) => measuredRef(ref, index)) ? "measured" : "observed";
}

/**
 * What the outcome of a criterion rests on. A failure is measured when one of its findings, or a
 * place it found a defect at, rests on an instrument. A pass, or not applicable, is measured when
 * every place it found in order does. What a person established is the person's.
 */
export function criterionBasis(criterion: Pick<CriterionResult, "outcome" | "observations" | "findings" | "established">, index: ObservationIndex): Basis {
  if (criterion.outcome === "cantTell" || criterion.outcome === "untested") return "open";
  if (criterion.established?.by === "person") return "person";
  if (criterion.outcome === "failed") {
    const grounds = [...criterion.findings.map((finding) => finding.evidence), ...criterion.observations.filter((observation) => observation.ruling === "finding").map((observation) => observation.evidence)];
    return grounds.some((evidence) => placeBasis(evidence, index) === "measured") ? "measured" : "observed";
  }
  const inOrder = criterion.observations.filter((observation) => observation.ruling === undefined || observation.ruling === "noIssue");
  return inOrder.length > 0 && inOrder.every((observation) => placeBasis(observation.evidence, index) === "measured") ? "measured" : "observed";
}
