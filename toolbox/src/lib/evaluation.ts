import type { Sample } from "../commands/sample.ts";
import type { EvaluationDocuments } from "./documents.ts";
import { sha256, stableId } from "./canonical.ts";
import type { Defect, MergeRecord } from "./defects.ts";
import type { Manifest } from "./manifest.ts";
import type { RoleExtensions } from "./budget.ts";
import { MODEL_UNKNOWN, type RoleModels } from "./models.ts";
import type { RecordedVia } from "./recorded.ts";
import { openPoint, shadowPartOf, vendorElementsIn, WITHIN_REACH, type Recommendation, type Finding, type Observation, type Outcome, type Verdict } from "./verdict.ts";
import { compareCriterionIds, CRITERIA, en301549Clause, GUIDELINES, PRINCIPLES, understandingUrl, type Criterion, type WcagVersion } from "./wcag.ts";

/** "untested" means no verdict was reached at all; it is never rounded up to anything else. */
export type CriterionOutcome = Outcome | "untested";

export const OUTCOME_LABEL: Record<CriterionOutcome, string> = {
  passed: "Voldoet",
  failed: "Voldoet niet",
  inapplicable: "Niet van toepassing",
  cantTell: "Kan niet bepalen",
  untested: "Niet beoordeeld",
};

/** Whose components a site is built with, as whoever starts the evaluation says it: every element whose name starts with one of the prefixes is theirs. */
export interface Vendor {
  tagPrefixes: string[];
  /** What the report calls them, such as "designsysteem". */
  nameNl: string;
}

/**
 * The vendor's elements a finding touches: for every observation it cites the innermost one
 * around the element (a page built from components sits inside the vendor's page element
 * everywhere, which says nothing), and those its locations name. Read from recorded names.
 * It says where the finding is, not whose fault it is: the cause can lie in the component or
 * in how the site uses it.
 */
export function vendorTagsOf(finding: { locations: { where: string }[]; targets?: { path: string[] }[] }, vendor: Vendor): string[] {
  const ofVendor = (text: string): string[] => vendorNames(text, vendor);
  const innermost = (finding.targets ?? []).map((target) => ofVendor(target.path.join(" > ")).at(-1)).filter((name): name is string => name !== undefined);
  return [...new Set([...innermost, ...finding.locations.flatMap((location) => ofVendor(location.where))])].sort();
}

const vendorNames = (text: string, vendor: Vendor): string[] => vendorElementsIn(text, vendor.tagPrefixes);

/** The element a piece of a selector chain ends at, by name; null when the last step gives only an id or a class. */
const hostOf = (piece: string): string | null => /^[a-z][a-z0-9-]*/i.exec(piece.split(" > ").at(-1)!.trim())?.[0]?.toLowerCase() ?? null;

/**
 * Why the repair of a finding lies inside a component of the vendor, in Dutch; null when the
 * recorded names do not show that. Touching a component is not enough: a site built from
 * components touches one with every click, and where a defect shows does not say who repairs
 * it. What counts is that the advice is about the inside:
 *
 * - the advice names an element of the vendor, and an observation the finding cites lies in the
 *   shadow tree of that element (each piece of a selector chain after the first is inside the
 *   shadow root of the element the piece before it ends at);
 * - the advice names a part of that shadow tree itself (see `shadowPartOf`).
 *
 * An advice that names a component as the thing to use ("toon de fout met x-validation-list")
 * gives neither. An advice that also says what the site can do within its own reach leaves the
 * owner to the judge: then there is something for the site to do.
 */
export function vendorInsideReason(finding: { fixNl: string; locations: { where: string }[]; targets?: { path: string[] }[] }, vendor: Vendor): string | null {
  if (WITHIN_REACH.test(finding.fixNl)) return null;
  const hosts = new Set((finding.targets ?? []).flatMap((target) => target.path.slice(0, -1).map(hostOf)));
  const entered = vendorNames(finding.fixNl, vendor).find((name) => hosts.has(name));
  if (entered) return `de oplossing noemt ${entered} en de waarneming ligt in de schaduwboom van dat element`;
  const named = shadowPartOf(finding.fixNl, vendor.tagPrefixes, vendorTagsOf(finding, vendor));
  return named ? `de oplossing noemt ${named.part}, een deel in de schaduwboom van ${named.of}` : null;
}

/**
 * Record what a finding has to do with the vendor: the elements it touches, and the owner when
 * the repair lies inside one of them. The owner the judge named is kept next to it, so a report
 * can show both where they differ.
 */
export function markVendor(finding: ReportFinding, vendor: Vendor): void {
  const tags = vendorTagsOf(finding, vendor);
  if (tags.length > 0) finding.vendorTags = tags;
  const reason = vendorInsideReason(finding, vendor);
  if (!reason || finding.owner === "leverancier") return;
  finding.judgedOwner = finding.owner;
  finding.ownerReasonNl = reason;
  finding.owner = "leverancier";
}

export interface ReportFinding extends Omit<Finding, "owner"> {
  /** Who repairs it. What the judge named, unless the recorded names show that the repair lies inside a component of the vendor. */
  owner: string;
  /** The owner the judge named, when `owner` was set to the vendor because the code says so. Absent when they are the same. */
  judgedOwner?: string;
  /** Why `owner` differs from `judgedOwner`, as a clause a report can print. */
  ownerReasonNl?: string;
  /** The vendor's elements the finding touches; absent when there are none or no vendor was given. */
  vendorTags?: string[];
  /** Stable across re-evaluations as long as criterion, component and place stay the same. */
  id: string;
  criterion: string;
  /**
   * The elements the finding is about, taken from the session observations it cites: the page
   * label, the element's durable selector chain and the state it was observed in. With these,
   * grouping findings by element needs no reading of prose.
   */
  targets?: { page: string; path: string[]; state: string | null }[];
  /**
   * Whether the finding was seen a second time from a fresh page: by a verifier ("reproduced"),
   * or by the agent of the finishing round itself ("repeated"), after whom no verifier comes.
   * "unverified": seen once. Absent when no verification was done.
   */
  verification?: { status: "reproduced" | "unverified" | "repeated"; evidence: string[] };
}

/** The outcomes a person can record for an open point: there is nothing left to leave open. */
export const ANSWER_OUTCOMES = ["passed", "failed", "inapplicable"] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

/**
 * What a person established about one open point. The name of the person stands only in the
 * file of the run the answer was recorded in; an evaluation, and so a report, carries the role.
 */
export interface PointAnswer {
  /** The open point as the verdict has it, with its kind. */
  pointNl: string;
  /** What the person did or decided. */
  didNl: string;
  outcome: AnswerOutcome;
  role: string;
  answeredAt: string;
  /** Set when no person but an instrument of loep gave the answer: the watch on the session closes the point about its duration. */
  instrument?: true;
  /** How a person's answer came about: confirmed at a terminal, or recorded by the agent in the conversation. `answeredAt` is the moment of the confirmation. Absent in an answer from before this was kept, and in one of an instrument. */
  recordedVia?: RecordedVia;
}

/** Who or what established the outcome of a criterion: the verifier, the finishing round, or a person. */
export const ESTABLISHED_BY_NL = {
  verification: "de controle",
  finishing: "de aanvullende meting",
  person: "een persoon",
  sessionWatch: "de meting van de sessieduur",
} as const;
export type EstablishedBy = keyof typeof ESTABLISHED_BY_NL;

export interface Established {
  by: EstablishedBy;
  /** One sentence for a reader: how the outcome was established. */
  noteNl: string;
  /** With "finishing": where the agent measured, in its own words. */
  coverageNl?: string;
  /** The verdict that stood before the one that counts now: kept, so a reader sees what was replaced. Absent when the verifier's verdict counts. */
  before?: { roundNl: string; outcome: Outcome | null; summaryNl: string; missingNl: string[] };
}

/** A recommendation as the report has it: with an identifier of its own, under the criterion whose procedure gave it. It never counts for the outcome. */
export interface ReportRecommendation extends Recommendation {
  id: string;
  criterion: string;
  component: string | null;
}

export interface CriterionResult {
  id: string;
  titleNl: string;
  level: string;
  versions: WcagVersion[];
  principle: string;
  guideline: string;
  en301549: string;
  understandingUrl: string;
  outcome: CriterionOutcome;
  rule: string | null;
  summaryNl: string;
  observations: Observation[];
  findings: ReportFinding[];
  /** Recommendations under a rule of the procedure, with any outcome. Absent when there is none, and in an evaluation from before recommendations existed. */
  recommendations?: ReportRecommendation[];
  missingNl: string[];
  /**
   * With "cantTell": no deviation was found, but not everything was measured; `coverageNl` says
   * what was. The outcome stays "cantTell" and counts as open. Absent when the question is
   * really open, and in an evaluation from before this was kept.
   */
  nothingFound?: { coverageNl: string };
  /**
   * What each round concluded, so a reader can see how firm the verdict is: `a` is the judge,
   * `final` the verifier, `finish` the finishing round (present only for a criterion that had
   * one). `b` and `agreement` belonged to an older chain with a second judge. They are still
   * written, as null and "onvolledig", so the shape of the file does not change; the report
   * does not read them.
   */
  rounds: { a: Outcome | null; b: Outcome | null; final: Outcome | null; finish?: Outcome | null };
  /** Who or what established the outcome. Absent for a criterion without a verdict, and in an evaluation from before this was kept. */
  established?: Established;
  /** What a person recorded about the open points of this criterion, also when not every point is answered yet. Absent when there is none. */
  answers?: PointAnswer[];
  agreement: "eens" | "oneens" | "onvolledig";
  challengeNl: string | null;
  droppedNl: string[];
  /** Findings of the judge that the verifier did not keep, each with the reason. Absent when no verification was done. */
  dropped?: DroppedFinding[];
  procedure: { version: number; sha256: string; class: string; limitsNl: string | null } | null;
  provenance: { dossierSha256: string | null; verdictSha256: Record<string, string | null> };
  /**
   * The verdict that counts did not come because the model was not there (a limit or a failure of
   * the service): the last round that was given up on, was skipped with the kind "storing". The
   * report says so, and `feedback` drafts no issue, since it is no fault of loep. Absent otherwise.
   */
  outage?: true;
}

export const DROP_REASON_NL: Record<string, string> = {
  notReproduced: "niet bevestigd",
  wrongCriterion: "hoort bij een ander criterium",
  notSupported: "volgens de norm of de procedure geen fout",
};

export interface DroppedFinding {
  key: string;
  titleNl: string;
  locations: { page: string; where: string }[];
  reason: string;
  reasonNl: string;
  belongsTo: string | null;
}

/** The findings of the judge that are not in the final verdict, with what the verifier wrote about each. */
export function droppedFindings(judge: Verdict | null, final: Verdict | null): DroppedFinding[] {
  if (!judge || !final?.verification) return [];
  const result: DroppedFinding[] = [];
  judge.findings.forEach((finding, position) => {
    const key = finding.key ?? `F${position + 1}`;
    const check = final.verification!.findings.find((entry) => entry.key === key);
    if (!check || check.reproduced) return;
    result.push({ key, titleNl: finding.titleNl, locations: finding.locations, reason: check.dropped ?? "notReproduced", reasonNl: check.reasonNl ?? "", belongsTo: check.belongsTo ?? null });
  });
  return result;
}

export const droppedLine = (dropped: DroppedFinding): string =>
  `${dropped.titleNl} (${dropped.locations.map((location) => location.page).join(", ")}): ${DROP_REASON_NL[dropped.reason] ?? dropped.reason}${dropped.belongsTo ? ` (${dropped.belongsTo})` : ""}. ${dropped.reasonNl}`;

export interface Signature {
  name: string;
  role: string;
  organisation: string;
  signedAt: string;
  statementNl: string;
  /** Hash of the evaluation without its signature: what exactly was signed. */
  evaluationSha256: string;
  /** Hash of the seal the signer signed: evidence-index.json, which names every file of the run with its hash. */
  sealSha256: string;
  /** How the signature came about: "terminal", the signer typed the start of the seal back. An agent never signs. Absent in a signature from before this was kept. */
  recordedVia?: RecordedVia;
}

/** An embedded frame as the report names it under the scope, so whoever signs sees what was left out and why. */
export interface ScopeFrame {
  address: string;
  descriptionNl: string;
  /** What kind of frame it is, and what that means for the evaluation, in the words of the site model. */
  kindNl: string;
  standingNl: string;
  counts: boolean;
  reasonNl: string | null;
  /** The role of the person who decided the kind; null when the explorer did. */
  decidedBy: string | null;
}

export interface BrowserUse {
  name: string;
  engine: string;
  version: string | null;
  used: boolean;
  /** "alle metingen", or which kinds of measurement the browser repeated as a second opinion and how many. Empty for a browser that was not used. */
  usedForNl: string;
}

export interface Evaluation {
  schema: "loep/evaluation/1";
  /** `descriptionNl`: what the site is and who it is for, as the explorer wrote it down. Absent when the site model has none. */
  site: {
    name: string;
    baseUrl: string;
    /** Every origin of the site, the one of `baseUrl` first. Only when the site is spread over more than one (`inventory --also-origin`); read it with `siteOrigins`. */
    origins?: string[];
    organisation: string | null;
    descriptionNl?: string;
  };
  /** Whose components the site is built with; absent when nobody said. */
  vendor?: Vendor;
  evaluatedAt: string;
  method: { name: string; version: string; url: string; typeNl: string; deviationsNl: string[] };
  standards: { wcag: string[]; en301549: string };
  /** `frames`: what the site model says each embedded frame is, whether it counts and why. Absent without a site model, without frames, and in older evaluations. */
  scope: { includedNl: string[]; excludedNl: string[]; frames?: ScopeFrame[] };
  sample: Sample;
  baseline: { browsers: { name: string; version: string | null; engine: string }[]; assistiveTechnology: { name: string; version: string }[]; noteNl: string };
  /**
   * Every browser the toolbox can measure in: the version that ran in this run and what it was
   * used for. A browser that was not used has no version. A browser that ran in two versions
   * has a row for each. Absent in an evaluation from before this was kept.
   */
  browsers?: BrowserUse[];
  technologies: string[];
  toolchain: Omit<Manifest, "steps">;
  /** Every implementation that answered a measurement of an agent, read from the observations. Absent in an evaluation without sessions or from before this was kept. */
  instruments?: { implementation: string; version: string | null; licence: string | null; usedForNl: string[]; measurements: number }[];
  /**
   * `model` is what the operator named with `evaluate --model`. `models` is what each agent itself gave when it started
   * its session, counted per role; the toolbox cannot check either. `models` is absent in a run without sessions and in older evaluations.
   */
  /**
   * Machine-readable: the verdicts were drafted by a language model (EU AI Act, article 50), with
   * the models as they were reported and where a person comes in. Absent in older evaluations.
   */
  aiGenerated?: AiGenerated;
  /** When this version of loep was last measured as a whole, against what, and what came out; null when it never was. Absent in older evaluations. */
  versionAccuracy?: VersionAccuracy | null;
  judgment: {
    model: string;
    models?: RoleModels[];
    /** Per role: how many sessions there were and how many added to their own budget, and how often. Absent in a run without sessions and in older evaluations. */
    extensions?: RoleExtensions[];
    rounds: string[];
    promptTemplates: Record<string, string>;
  };
  criteria: CriterionResult[];
  summary: Record<WcagVersion, Record<CriterionOutcome, number> & { total: number }>;
  limitationsNl: string[];
  /**
   * How the judgment was reached: a walk-through, a judge with instruments and a verifier.
   * Absent only in an evaluation of an older chain; the report describes every evaluation as made this way.
   */
  chain?: EvaluationChain;
  /** Findings grouped into the things to repair. Absent in an evaluation from before this step existed. */
  defects?: Defect[];
  merge?: MergeRecord;
  /** Per page label, the states in which the page was measured besides the way it loads. */
  measuredStates?: Record<string, string[]>;
  /** The documents of the site: found, examined and not examined. Absent when the site has none, and in older evaluations. */
  documents?: EvaluationDocuments;
  /**
   * The earlier evaluation this one follows up, kept only when that one was signed: a reader
   * can look up a signed report, not a concept. What changed between the two is not in the
   * evaluation; `diff` writes that as a working document of its own.
   */
  followsUp?: { evaluatedAt: string; sha256: string; signedAt: string };
  /** Stands next to evaluation.json, outside the seal (`signed/signature.json`); attached when the evaluation is read. */
  signature: Signature | null;
}

export interface EvaluationChain {
  kind: "instruments";
  /** What the evidence gate found before anything was judged; null when the run has no gate result. */
  gate: { sufficient: boolean; checks: number; checksPassed: number; exploreRounds: number; acceptedNl: string[]; limitationsNl: string[]; /** The pictures an agent looked at after the fixed checks: how many sheets, and how many page types had none. Absent when nobody looked, and in older evaluations. */ review?: { sheets: number; pageTypesWithoutSheet: number } } | null;
  /** Whether requests that can change something were let through, and on what ground. */
  writes: { allowed: boolean; noteNl: string };
  /** POST requests that only read and were let through, such as a question to a search service. Absent when there were none, and in older evaluations. */
  reads?: { method: string; origin: string; path: string; /** The search service whose form a body had to have; absent in evaluations from before it was asked. */ service?: string; reasonNl: string }[];
}

/** The verdict of the judge (`a`), that of the verifier (`final`) and that of the finishing round, for a criterion that had one. */
export interface RoundVerdicts {
  a: Verdict | null;
  final: Verdict | null;
  finish?: Verdict | null;
  /** The verdict of the finishing round before the one that counts, when the round ran again with `tasks --again`: kept, and shown as what stood before. */
  finishBefore?: Verdict | null;
}

export interface CriterionInput {
  criterion: Criterion;
  verdicts: RoundVerdicts;
  /** What a person recorded about open points of the verdict that counts. */
  answers?: PointAnswer[];
  procedure: CriterionResult["procedure"];
  provenance: CriterionResult["provenance"];
  /** Open points about candidates other judges passed on to this criterion that no verdict of it ruled on (`unruledCrossPoints`). */
  unruledNl?: string[];
  /** A round of this criterion was given up on for a storing of the model, and no round after it gave a verdict. */
  outage?: boolean;
}

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The identifier of a finding: its criterion and a short hash of its place. With `byTitle`, the title is
 * part of the hash too, for findings of one criterion that share a place but are different defects.
 */
export function findingId(sitePrefix: string, criterion: string, finding: Finding, byTitle = false): string {
  const place = finding.component ? normalise(finding.component) : normalise(finding.locations[0]?.where ?? finding.titleNl);
  const anchor = byTitle ? `${place}\u0000${normalise(finding.titleNl)}` : place;
  return `${sitePrefix}-${criterion}-${stableId("x", criterion, anchor).slice(2, 6)}`;
}

const samePoint = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * What the answers of a person make of a verdict that was left open. A point that a person
 * found failing fails the criterion, like a finding does, whatever else is open. Otherwise the
 * criterion is settled only when every open point has an answer: then it passes, or is not
 * applicable when every answer says so. Until then it stays open with the points that are left.
 */
export function applyAnswers(missingNl: string[], answers: PointAnswer[]): { outcome: Outcome; remainingNl: string[]; counted: PointAnswer[] } {
  const counted = answers.filter((answer) => missingNl.some((point) => samePoint(point, answer.pointNl)));
  const remainingNl = missingNl.filter((point) => !counted.some((answer) => samePoint(point, answer.pointNl)));
  if (counted.some((answer) => answer.outcome === "failed")) return { outcome: "failed", remainingNl, counted };
  if (remainingNl.length > 0 || counted.length === 0) return { outcome: "cantTell", remainingNl, counted };
  return { outcome: counted.every((answer) => answer.outcome === "inapplicable") ? "inapplicable" : "passed", remainingNl, counted };
}

const rolesNl = (answers: PointAnswer[]): string => [...new Set(answers.map((answer) => answer.role))].join(", ");

/**
 * The only place where a criterion gets its outcome. The verdict of the verifier counts, and
 * that of the judge is not enough on its own. Where the evaluation itself left the question
 * open, the verdict of the finishing round takes its place; the earlier one is kept. Where a
 * verdict is still open, the answers of a person to its open points can settle it; that is
 * said with the outcome, because no instrument stands behind it.
 */
export function resolveCriterion(input: CriterionInput, sitePrefix: string): CriterionResult {
  const { criterion, verdicts } = input;
  const verified = verdicts.final;
  const finish = verdicts.finish ?? null;
  // The verdict of an agent that counts: the finishing round's when there is one.
  const final = finish ?? verified;
  const answered = final?.outcome === "cantTell" ? applyAnswers(final.missingNl ?? [], input.answers ?? []) : null;
  const byPerson = answered !== null && answered.outcome !== "cantTell";
  const reached: CriterionOutcome = byPerson ? answered.outcome : (final?.outcome ?? "untested");
  // A pass next to a candidate another judge passed on and nobody ruled on is no pass: that place was not looked at.
  const unruled = reached === "passed" || reached === "inapplicable" ? (input.unruledNl ?? []) : [];
  const outcome: CriterionOutcome = unruled.length > 0 ? "cantTell" : reached;
  const beforeFinish = verified ?? verdicts.a;
  const byWatch = byPerson && answered.counted.every((answer) => answer.instrument === true);
  const established: Established | null = !final
    ? null
    : byWatch
      ? {
          by: "sessionWatch",
          noteNl: "Vastgesteld door de meting van de sessieduur: het oordeel liet de duur van de sessie achter de inlog open, en een meting die een tweede inlog met rust liet, heeft die vastgesteld. De uitkomst staat in bijlage A.",
          before: { roundNl: finish ? "aanvullende meting" : "controle", outcome: final.outcome, summaryNl: final.summaryNl, missingNl: final.missingNl ?? [] },
        }
      : byPerson
      ? {
          by: "person",
          noteNl: `Vastgesteld door een persoon, niet door een instrument (functie: ${rolesNl(answered.counted)}). Het onderzoek liet ${answered.counted.length === 1 ? "één punt" : `${answered.counted.length} punten`} open; het antwoord daarop staat in bijlage A.`,
          before: { roundNl: finish ? "aanvullende meting" : "controle", outcome: final.outcome, summaryNl: final.summaryNl, missingNl: final.missingNl ?? [] },
        }
      : finish
        ? {
            by: "finishing",
            // A criterion that is still open after the finishing round was not established by it: the note says it stayed open.
            noteNl:
              finish.outcome === "cantTell"
                ? `Ook na een aanvullende meting niet vastgesteld: ${beforeFinish ? "het oordeel bleef eerst open door een beperking van het onderzoek, en een aparte beoordelaar heeft daarna gemeten wat ontbrak" : "de eerste beoordeling leverde geen geldig oordeel, en een aparte beoordelaar heeft daarna zelf gemeten"}, maar kon het criterium niet beoordelen. Wat open bleef, staat bij het criterium.`
                : beforeFinish
                  ? `Vastgesteld in een aanvullende meting: het oordeel bleef eerst open door een beperking van het onderzoek, en een aparte beoordelaar heeft daarna gemeten wat ontbrak. Daarna is het oordeel niet nog eens gecontroleerd${finish.outcome === "failed" ? "; elke bevinding is twee keer vastgelegd, de tweede keer vanaf een verse pagina" : ""}.`
                  : "Vastgesteld in een aanvullende meting: de eerste beoordeling leverde geen geldig oordeel. Daarna is het oordeel niet nog eens gecontroleerd.",
            ...(finish.finish?.coverageNl ? { coverageNl: finish.finish.coverageNl } : {}),
            ...(verdicts.finishBefore
              ? { before: { roundNl: "vorige aanvullende meting", outcome: verdicts.finishBefore.outcome, summaryNl: verdicts.finishBefore.summaryNl, missingNl: verdicts.finishBefore.missingNl ?? [] } }
              : beforeFinish
                ? { before: { roundNl: verified ? "controle" : "eerste beoordeling", outcome: beforeFinish.outcome, summaryNl: beforeFinish.summaryNl, missingNl: beforeFinish.missingNl ?? [] } }
                : {}),
          }
        : { by: "verification", noteNl: "Vastgesteld bij de controle: een tweede beoordelaar heeft het oordeel van de eerste beoordeling nagegaan." };
  const [principleKey, guidelineKey] = [criterion.id.split(".")[0]!, criterion.id.split(".").slice(0, 2).join(".")];
  const used = new Set<string>();
  const failedFindings = final?.outcome === "failed" ? final.findings : [];
  const byPlace = failedFindings.map((finding) => findingId(sitePrefix, criterion.id, finding));
  const findings: ReportFinding[] = failedFindings.map((finding, index) => {
    // Two findings in the same place are different defects: the title tells them apart, so neither reads as
    // the other one repeated. A suffix is left only for findings that share their title as well.
    const shared = byPlace.filter((id) => id === byPlace[index]).length > 1;
    const base = shared ? findingId(sitePrefix, criterion.id, finding, true) : byPlace[index]!;
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    // A judge may leave out an optional field; the report relies on every field being there.
    return { ...finding, component: finding.component ?? null, id, criterion: criterion.id };
  });
  // A recommendation is kept whatever the outcome: it is never part of it.
  const recommendations: ReportRecommendation[] = (final?.recommendations ?? []).map((entry) => {
    const place = entry.component ? normalise(entry.component) : normalise(entry.locations[0]?.where ?? entry.titleNl);
    const base = `${sitePrefix}-${criterion.id}-A${stableId("x", criterion.id, "recommendation", entry.rule, place, normalise(entry.titleNl)).slice(2, 6)}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    return { ...entry, component: entry.component ?? null, id, criterion: criterion.id };
  });
  return {
    id: criterion.id,
    titleNl: criterion.titleNl,
    level: criterion.level,
    versions: criterion.versions,
    principle: PRINCIPLES[principleKey] ?? principleKey,
    guideline: GUIDELINES[guidelineKey] ?? guidelineKey,
    en301549: en301549Clause(criterion.id),
    understandingUrl: understandingUrl(criterion),
    outcome,
    rule: final?.rule ?? null,
    // What a person established is said first: the summary of the agent was written while the question was open.
    summaryNl: unruled.length > 0
      ? `Niet vastgesteld: ${unruled.length === 1 ? "een waarneming die een andere beoordelaar doorgaf, is" : `${unruled.length} waarnemingen die een andere beoordelaar doorgaf, zijn`} door niemand beoordeeld. Het oordeel zonder die ${unruled.length === 1 ? "waarneming" : "waarnemingen"} was ${OUTCOME_LABEL[reached].toLowerCase()}: ${final!.summaryNl}`
      : byPerson
        ? `Een persoon heeft vastgesteld: ${OUTCOME_LABEL[outcome].toLowerCase()}. Dit is vastgesteld door een persoon, niet door een instrument. Het onderzoek zelf kwam niet verder dan: ${final!.summaryNl}`
        : (final?.summaryNl ?? (input.outage ? `Voor dit criterium is geen eindoordeel vastgesteld: ${OUTAGE_NL.toLowerCase()}` : "Voor dit criterium is geen eindoordeel vastgesteld.")),
    observations: final?.observations ?? [],
    findings,
    ...(recommendations.length > 0 ? { recommendations } : {}),
    missingNl: [...(answered ? answered.remainingNl : (final?.missingNl ?? [])), ...unruled],
    ...(outcome === "cantTell" && final?.nothingFound ? { nothingFound: { coverageNl: final.nothingFound.coverageNl } } : {}),
    rounds: { a: verdicts.a?.outcome ?? null, b: null, final: verified?.outcome ?? null, ...(finish ? { finish: finish.outcome } : {}) },
    ...(established ? { established } : {}),
    ...(answered && answered.counted.length > 0 ? { answers: answered.counted } : {}),
    agreement: "onvolledig",
    challengeNl: verified?.verification?.attackNl ?? null,
    droppedNl: droppedFindings(verdicts.a, verified).map(droppedLine),
    ...(verified?.verification ? { dropped: droppedFindings(verdicts.a, verified) } : {}),
    procedure: input.procedure,
    provenance: input.provenance,
    ...(input.outage && !byPerson ? { outage: true as const } : {}),
  };
}

/** A measurement of one version of loep as a whole, as `validatie/versies/<version>.json` has it. */
export interface VersionAccuracy {
  version: string;
  /** The date of the measurement, as YYYY-MM-DD. */
  measuredAt: string;
  /** What the outcomes were compared with: the judgment of a human expert, the key of the test site. */
  againstNl: string;
  /** What came out, in a sentence or two, with numbers. */
  resultNl: string;
}

/** What the report says when this version was never measured as a whole. */
export const VERSION_NOT_MEASURED_NL = "Deze versie van loep is niet vergeleken met het oordeel van een menselijke deskundige, en is niet als geheel gemeten op de testsite.";

/** The sentence about how accurate this version of loep is, for the report. */
export const versionAccuracyNl = (accuracy: VersionAccuracy | null | undefined, dateNl: (iso: string) => string): string =>
  accuracy ? `Deze versie van loep (${accuracy.version}) is het laatst als geheel gemeten op ${dateNl(accuracy.measuredAt)}, tegen ${accuracy.againstNl.replace(/\.$/, "")}. Uitkomst: ${accuracy.resultNl}` : VERSION_NOT_MEASURED_NL;

/** The problems of a file `validatie/versies/<version>.json`; empty when it can be shown. */
export function versionAccuracyProblems(value: unknown, version: string): string[] {
  if (value === null || typeof value !== "object") return ["not a JSON object"];
  const entry = value as Record<string, unknown>;
  const problems: string[] = [];
  if (entry.version !== version) problems.push(`version must be "${version}", the name of the file`);
  if (typeof entry.measuredAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.measuredAt)) problems.push("measuredAt must be a date as YYYY-MM-DD");
  for (const key of ["againstNl", "resultNl"]) if (typeof entry[key] !== "string" || (entry[key] as string).trim().length < 10) problems.push(`${key} must say it in a sentence`);
  return problems;
}

export interface AiGenerated {
  /** The models that drafted the verdicts, as the agents and whoever ran the evaluation gave them; nothing in the run confirms them. */
  models: string[];
  humanReview: {
    /** Where the signature of the person who stands for the report is kept, once there is one: outside the sealed evaluation. */
    signature: string;
    /** Criteria whose outcome a person established by answering an open point. */
    criteriaByPerson: string[];
  };
}

/** The mark that says the verdicts of this evaluation were drafted by a language model. */
export function aiGeneratedMark(judgment: { model: string; models?: RoleModels[] | undefined }, criteria: Pick<CriterionResult, "id" | "established">[]): AiGenerated {
  const models = [judgment.model, ...(judgment.models ?? []).flatMap((role) => role.models.map((entry) => entry.model))].filter((model) => model.trim() !== "" && model !== MODEL_UNKNOWN);
  return {
    models: [...new Set(models)].sort(),
    humanReview: { signature: "signed/signature.json", criteriaByPerson: criteria.filter((criterion) => criterion.established?.by === "person").map((criterion) => criterion.id) },
  };
}

/** What the report says of a criterion whose verdict did not come because the model was not there. */
export const OUTAGE_NL = "De beoordeling is door een storing van het model niet gedaan.";

/** How long a quote from a verdict may be in a limitation of the evaluation. */
export const QUOTE_LIMIT = 220;

/** The start of a text to quote: whole words, with an ellipsis when the text goes on. */
export function quoteStart(text: string, limit = QUOTE_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return endAtWord(trimmed.slice(0, limit + 1));
}

/** A text cut off at a fixed length, ended at the last whole word, with an ellipsis. */
function endAtWord(cut: string): string {
  const end = cut.lastIndexOf(" ");
  return `${(end > cut.length / 2 ? cut.slice(0, end) : cut.slice(0, -1)).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * An evaluation from before quotes were cut at a word has a quote cut off in the middle of one.
 * A quote of exactly the limit was cut there; it ends at its last whole word instead.
 */
export function closeCutQuote(limitation: string): string {
  const opening = 'Dit moet worden nagekeken: "';
  const start = limitation.lastIndexOf(opening);
  if (start === -1 || !limitation.endsWith('"')) return limitation;
  const quote = limitation.slice(start + opening.length, -1);
  return quote.length === QUOTE_LIMIT ? `${limitation.slice(0, start + opening.length)}${endAtWord(quote)}"` : limitation;
}

/**
 * The open criteria of an evaluation, split by what they wait for: the owner (a person, a choice,
 * or a declared test environment so that the run may send), or the evaluation itself. A point
 * "versturen niet toegestaan" is the owner's: the run measured all it was allowed to.
 */
export function openCriteria(criteria: Pick<CriterionResult, "id" | "outcome" | "missingNl">[]): { owner: string[]; evaluation: string[] } {
  const open = criteria.filter((criterion) => criterion.outcome === "cantTell" || criterion.outcome === "untested");
  // One point about the evaluation itself is enough: then the evaluation is what the criterion waits for.
  const own = (criterion: (typeof open)[number]): boolean => criterion.outcome === "untested" || criterion.missingNl.length === 0 || criterion.missingNl.some((point) => openPoint(point).kind?.reader !== "owner");
  return { owner: open.filter((criterion) => !own(criterion)).map((criterion) => criterion.id), evaluation: open.filter(own).map((criterion) => criterion.id) };
}

/**
 * Criterion ids for a list that counts across WCAG 2.1 and 2.2 together: an id in only one of
 * the two says which, so a count per version elsewhere in the report adds up. "2.5.2, 3.3.8
 * alleen in WCAG 2.2, 4.1.1 alleen in WCAG 2.1".
 */
export function idsAcrossVersionsNl(ids: string[], criteria: Pick<CriterionResult, "id" | "versions">[]): string {
  const versions = new Map(criteria.map((criterion) => [criterion.id, criterion.versions]));
  return ids
    .map((id) => {
      const own = versions.get(id) ?? [];
      return own.length === 1 ? `${id} alleen in WCAG ${own[0]}` : id;
    })
    .join(", ");
}

export function summarise(criteria: CriterionResult[]): Evaluation["summary"] {
  const count = (version: WcagVersion): Evaluation["summary"][WcagVersion] => {
    const relevant = criteria.filter((criterion) => criterion.versions.includes(version));
    const tally = { passed: 0, failed: 0, inapplicable: 0, cantTell: 0, untested: 0, total: relevant.length };
    for (const criterion of relevant) tally[criterion.outcome]++;
    return tally;
  };
  return { "2.1": count("2.1"), "2.2": count("2.2") };
}

export function allCriteriaSorted(): Criterion[] {
  return [...CRITERIA].sort((a, b) => compareCriterionIds(a.id, b.id));
}

/** Hash of everything that was evaluated, excluding the signature that refers to it. */
/** The name of the toolbox, as a report says where it came from. */
export const TOOL_NAME = "loep";
/** What a run from before 0.1.3 wrote as commit when the toolbox did not run from a git repository. */
const NO_COMMIT = "no commit yet";

/** The commit the toolbox ran from, or null when that is not known. Reads the placeholder of older runs as not known too. */
export function knownCommit(toolbox: { commit?: string | null } | null | undefined): string | null {
  const commit = toolbox?.commit;
  return commit && commit !== NO_COMMIT ? commit : null;
}

/** Whether the code that ran differs from its commit. Without a known commit there is nothing to differ from. */
export function changedSinceCommit(toolbox: { commit?: string | null; dirty?: boolean } | null | undefined): boolean {
  return knownCommit(toolbox) !== null && toolbox?.dirty === true;
}

/**
 * The toolbox and its version behind an evaluation: "loep 0.0.1". With the commit: "loep 0.0.1, commit 187eeba4c2d1".
 * A toolbox that did not run from a git repository has no commit to name, so the version stands alone.
 */
export function madeWith(evaluation: Evaluation, withCommit = false): string {
  const { version } = evaluation.toolchain.toolbox;
  const commit = knownCommit(evaluation.toolchain.toolbox);
  if (!withCommit || commit === null) return `${TOOL_NAME} ${version}`;
  return `${TOOL_NAME} ${version}, commit ${commit.slice(0, 12)}${changedSinceCommit(evaluation.toolchain.toolbox) ? " met niet vastgelegde wijzigingen" : ""}`;
}

export function evaluationHash(evaluation: Evaluation): string {
  const { signature: _signature, ...content } = evaluation;
  return sha256(JSON.stringify(content));
}

/** A, B and C are statuses of the model statement; "geen" means the evaluation cannot carry a status yet. The toolbox computes no status D. */
export type ComplianceStatus = "A" | "B" | "C" | "geen";

/**
 * The status the Dutch model statement allows for this evaluation, judged strictly.
 * Status A and B both require that the evaluation covers every requirement. A criterion
 * that could not be determined is not covered, so the honest status is then C: first
 * measures taken, further evaluation planned.
 */
export function complianceStatus(evaluation: Evaluation, version: WcagVersion): { status: ComplianceStatus; reasonNl: string } {
  const tally = evaluation.summary[version];
  if (!evaluation.signature) return { status: "geen", reasonNl: "Het rapport is een concept: niemand heeft ervoor getekend." };
  if (tally.untested > 0) return { status: "geen", reasonNl: `${tally.untested} criteria zijn niet beoordeeld; het onderzoek dekt niet alle eisen.` };
  if (tally.cantTell > 0) {
    // Not fully measured without a deviation is still open: it changes nothing about the status, only what the reader is told.
    const partly = evaluation.criteria.filter((criterion) => criterion.versions.includes(version) && criterion.outcome === "cantTell" && criterion.nothingFound).length;
    const split = partly === 0 ? "" : partly === tally.cantTell ? " Bij al deze criteria is geen afwijking gevonden, maar is niet alles gemeten." : ` Bij ${partly} daarvan is geen afwijking gevonden, maar is niet alles gemeten; bij ${tally.cantTell - partly} is de vraag echt open.`;
    return {
      status: "C",
      reasonNl: `Bij ${tally.cantTell} criteria kon niet worden vastgesteld of eraan is voldaan.${split} Het onderzoek dekt daardoor nog niet alle eisen. Status A en B zijn pas mogelijk als die criteria alsnog zijn onderzocht; tot die tijd past status C, met aanvullend onderzoek binnen zes maanden.`,
    };
  }
  if (tally.failed === 0) return { status: "A", reasonNl: "Aan alle criteria is aantoonbaar voldaan." };
  return { status: "B", reasonNl: `${tally.failed} criteria zijn niet gehaald. Status B vraagt per afwijking een maatregel met een datum.` };
}

/**
 * Give a finding the identifier it had in the previous evaluation when it is the same
 * finding: `same` links each finding to the earlier one at the same place under the same
 * criterion (see `matchFindings`). The wording comes from a language model and differs from
 * run to run; the identifier is what tickets and commits refer to, so it has to stay.
 */
export function carryFindingIds(criteria: CriterionResult[], same: Map<ReportFinding, ReportFinding>): { carried: number; fresh: number } {
  let carried = 0;
  let fresh = 0;
  for (const criterion of criteria) {
    for (const finding of criterion.findings) {
      const earlier = same.get(finding);
      if (earlier) {
        finding.id = earlier.id;
        carried++;
      } else fresh++;
    }
    // A new finding must not collide with an identifier that was carried over.
    const used = new Set(criterion.findings.filter((finding) => same.has(finding)).map((finding) => finding.id));
    for (const finding of criterion.findings.filter((entry) => !same.has(entry))) {
      let id = finding.id;
      for (let suffix = 2; used.has(id); suffix++) id = `${finding.id}-${suffix}`;
      finding.id = id;
      used.add(id);
    }
  }
  return { carried, fresh };
}
