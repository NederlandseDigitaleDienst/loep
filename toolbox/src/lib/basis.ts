import type { CriterionResult } from "./evaluation.ts";
import { canonicalCommand, MEASURE_COMMANDS, OBSERVATION_ID, openPoint, type ObservationIndex } from "./verdict.ts";

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

/**
 * A place where the run shows that an instrument was missing (#318): an outcome that rests on what
 * an agent saw where the procedure names an instrument for it, or an open point a person settled
 * that an agent or an instrument could have. Its key (criterion and instrument, or criterion and
 * kind of point) stays the same from run to run, so the same gap on another site counts up.
 */
export interface InstrumentGap {
  key: string;
  criterion: string;
  kind: "instrument" | "automation";
  /** The measure commands the procedure names, for a gap in an instrument; the kind of point, for one in automation. */
  what: string[];
  whatNl: string;
  /** How many places or answers in this run show it. */
  count: number;
}

/** What a person settles on purpose, and is no gap: a choice of the owner, a login, a screen reader other than VoiceOver. */
const PERSON_BY_DESIGN = /\binlog|wachtwoord|NVDA|JAWS|TalkBack|Narrator|andere schermlezer/i;

export function instrumentGaps(criteria: CriterionResult[], commandsFor: (criterion: string) => string[], index: ObservationIndex): InstrumentGap[] {
  const gaps: InstrumentGap[] = [];
  for (const criterion of criteria) {
    const instruments = [...new Set(commandsFor(criterion.id).map(canonicalCommand).filter((command) => MEASURING.has(command)))].sort();
    if (instruments.length > 0 && (criterion.basis === "observed" || criterionBasis(criterion, index) === "observed")) {
      const places = criterion.observations.filter((observation) => placeBasis(observation.evidence, index) === "observed").length;
      gaps.push({ key: `${criterion.id}:${instruments.join("+")}`, criterion: criterion.id, kind: "instrument", what: instruments, whatNl: `de uitkomst rust op wat een agent zelf zag, terwijl de procedure ${instruments.map((command) => `\`${command}\``).join(" en ")} noemt`, count: Math.max(1, places) });
    }
    const byPerson = (criterion.answers ?? []).filter((answer) => !answer.instrument && openPoint(answer.pointNl).kind?.prefix !== "keuze nodig" && !PERSON_BY_DESIGN.test(answer.pointNl));
    const byKind = new Map<string, number>();
    for (const answer of byPerson) byKind.set(openPoint(answer.pointNl).kind?.prefix ?? "zonder soort", (byKind.get(openPoint(answer.pointNl).kind?.prefix ?? "zonder soort") ?? 0) + 1);
    for (const [kind, count] of byKind) {
      gaps.push({ key: `${criterion.id}:${kind}`, criterion: criterion.id, kind: "automation", what: [kind], whatNl: `een persoon stelde vast wat een agent of instrument had kunnen vaststellen (${kind})`, count });
    }
  }
  return gaps;
}
