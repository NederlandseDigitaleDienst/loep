export const OUTCOMES = ["passed", "failed", "inapplicable", "cantTell"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Observation {
  checkedNl: string;
  howNl: string;
  observedNl: string;
  evidence: string[];
  /** Version 2: what follows from what was seen, so that nothing that is wrong stays behind as a remark. */
  ruling?: (typeof CANDIDATE_RULINGS)[number];
  /** With "finding": the key of the finding it supports. */
  finding?: string;
}

/**
 * Where a finding is. A selector alone cannot be traced back in a source that is not HTML, so a
 * location also carries words of the page itself: the heading it stands under, and the text of
 * the element or of the sentence around it.
 */
export interface Location {
  page: string;
  where: string;
  /** The nearest heading above the place, as the page has it. */
  heading?: string;
  /** The text of the element (a link text, a label) or of the sentence around it, as the page has it. */
  text?: string;
  /** The finding is about the page as a whole (its title, its language): there is no place on it to point at. */
  wholePage?: boolean;
}

/**
 * How bad a finding is, the worst first. "blokkerend": a function works for nobody, with or
 * without a disability. The other three weigh what a group of visitors cannot do. An
 * evaluation from before the highest step existed has only those three.
 */
export const SEVERITIES = ["blokkerend", "hoog", "midden", "laag"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** The place of a severity in the order of a work list: the worst first. */
export const severityRank = (severity: Severity): number => SEVERITIES.indexOf(severity);

export interface Finding {
  titleNl: string;
  observedNl: string;
  impactNl: string;
  fixNl: string;
  severity: Severity;
  owner: "content" | "design" | "techniek" | "leverancier";
  component: string | null;
  locations: Location[];
  pagesAffected: string;
  evidence: string[];
  /** Version 2: a short key ("F1" from the judge, "V1" from the verifier) so a candidate ruling and the verification can point at the finding. */
  key?: string;
}

/**
 * A recommendation: a pattern that makes the site better and that the norm does not require. It
 * never changes the outcome. Only a rule in the section "Aanbevelingen" of the procedure can give
 * it, so the agent cannot decide on its own that something is "only a recommendation": what a
 * decision rule calls wrong is a finding, and a finding that was dropped does not come back as a
 * recommendation.
 */
export interface Recommendation {
  /** The recommendation rule of the procedure it rests on, such as "A1". */
  rule: string;
  titleNl: string;
  observedNl: string;
  /** What to do, as a pattern to follow. */
  recommendationNl: string;
  component?: string | null;
  locations: Location[];
  evidence: string[];
}

export const CANDIDATE_RULINGS = ["finding", "noIssue", "otherCriterion", "open"] as const;

/** What the judge decided about one lead of the walk-through. */
export interface CandidateRuling {
  id: string;
  ruling: (typeof CANDIDATE_RULINGS)[number];
  reasonNl: string;
  /** With "finding": the key of the finding it became. */
  finding?: string;
  /** With "otherCriterion": the criterion it belongs to. */
  criterion?: string;
  /** Observations the ruling rests on. The verifier must give its own for every candidate it dismisses. */
  evidence?: string[];
}

/** Something seen while judging one criterion that belongs to another: handed to that criterion's judge as a candidate. */
export interface CrossCandidate {
  criterion: string;
  page: string;
  where: string;
  evidence: string[];
  noteNl: string;
}

/** Measurements whose methods contradicted each other in the same way, and the closer look that settled it. */
export interface Resolution {
  observations: string[];
  by: string[];
  howNl: string;
}

export const DROP_REASONS = ["notReproduced", "wrongCriterion", "notSupported"] as const;

/** What the verifier found when it tried to reproduce one finding of the judge from a fresh page. */
export interface FindingCheck {
  key: string;
  reproduced: boolean;
  /** Observations of the verifier's own session that show the finding again. */
  evidence: string[];
  /** Required when not reproduced. */
  dropped?: (typeof DROP_REASONS)[number];
  reasonNl?: string;
  /** With "wrongCriterion": where it does belong. */
  belongsTo?: string;
}

export interface Verification {
  judgeOutcome: Outcome;
  findings: FindingCheck[];
  /** After "passed", "inapplicable" or "cantTell": what was tried to bring the verdict down, and what came of it. */
  attackNl?: string;
  /** Observations of the verifier's own session made during that attempt. */
  attackEvidence?: string[];
}

export interface Verdict {
  criterion: string;
  outcome: Outcome;
  rule: string;
  summaryNl: string;
  observations: Observation[];
  findings: Finding[];
  /** Recommendations under a rule of the section "Aanbevelingen" of the procedure; next to any outcome, and they never change it. */
  recommendations?: Recommendation[];
  missingNl?: string[];
  /**
   * Only with "cantTell": nothing wrong was found, and all that is open is a limit of the
   * evaluation itself (coverage, budget, a probe). The outcome stays "cantTell" and never
   * counts as a pass; the report only shows it apart from a question that is really open.
   * `coverageNl` says what was measured.
   */
  nothingFound?: { coverageNl: string };
  /** Version 2, judge and verifier: one ruling per candidate of the walk-through for this criterion. */
  candidates?: CandidateRuling[];
  /** Version 2: required for a pass that cites a measurement whose methods disagreed. */
  resolved?: Resolution[];
  /** Version 2: what was seen that belongs to another criterion. */
  crossCandidates?: CrossCandidate[];
  /** Version 2, verifier only. */
  verification?: Verification;
  /** Finishing round only. */
  finish?: Finish;
}

/** What the finishing round did with one point that the verdict before it left open. */
export interface FinishedPoint {
  /** The number of the point as the task lists it, counted from 1. */
  point: number;
  settled: boolean;
  /** What was measured and where, or why the point stays open. */
  howNl: string;
  /** Observations of the finisher's own session. */
  evidence: string[];
}

/**
 * What the finishing round adds to its verdict: an account of every point that stood open, what
 * the verdict covers, every finding seen twice (the second time from a fresh page), and the
 * attempt behind every instrument that still did not work.
 */
export interface Finish {
  points: FinishedPoint[];
  /** Where was measured, with counts. */
  coverageNl: string;
  findings: { key: string; first: string[]; repeated: string[] }[];
  /** One entry per point "proef werkte niet:" or "niet bereikbaar:" in missingNl; `missing` is its place there, counted from 1. */
  attempts?: { missing: number; triedNl: string; evidence: string[] }[];
}

const isText = (value: unknown, minimum = 1): value is string => typeof value === "string" && value.trim().length >= minimum;

/**
 * The kinds of open point. A point in `missingNl` starts with the fixed words of its kind
 * and a colon ("veegronde mist: ..."), so the list stays a list of texts and a verdict from
 * before the kinds existed can still be read. `reader` says whose work the point is: the
 * owner of the site (something no instrument can establish, a choice, or what only shows after
 * sending in a run that may not send), the toolbox (coverage that was missing, a budget that
 * ran out, a probe that did not work), or the site itself (a part of it that did not load while
 * the rest did). Sending is the owner's choice: a run sends only after somebody declared a test
 * environment at inventory, and then an instrument measures the point. A part that was not
 * reachable is no fault of loep and no work for the owner: the evaluation is not finished, and
 * a new finishing round measures it once the part loads again.
 */
export const OPEN_POINT_KINDS = [
  { prefix: "mens nodig", reader: "owner", labelNl: "geen instrument kan dit vaststellen" },
  { prefix: "keuze nodig", reader: "owner", labelNl: "vraagt een keuze" },
  { prefix: "versturen niet toegestaan", reader: "owner", labelNl: "pas te meten als het onderzoek mag versturen" },
  { prefix: "veegronde mist", reader: "toolbox", labelNl: "dekking ontbrak" },
  { prefix: "budget op", reader: "toolbox", labelNl: "de tijd voor het meten was op" },
  { prefix: "proef werkte niet", reader: "toolbox", labelNl: "een proef werkte niet" },
  { prefix: "niet bereikbaar", reader: "site", labelNl: "een deel van de site was niet bereikbaar" },
] as const;
export type OpenPointKind = (typeof OPEN_POINT_KINDS)[number];
/** The kind of a point that stays open only because the run may not send: no person is needed, a declared test environment is. */
export const NOT_SENT = "versturen niet toegestaan";
/** The kind of a point about a part of the site that did not load on repeated tries while the rest did: open until a new finishing round measures it. */
export const UNREACHABLE = "niet bereikbaar";
/** The kinds a new finishing round may be asked for with `tasks --again`: what an instrument can measure once it works or the part loads again. */
export const KINDS_FOR_AGAIN = ["proef werkte niet", UNREACHABLE] as const;
/** The kinds of open point that stay only after a real attempt, described in `finish.attempts`. */
const KINDS_WITH_ATTEMPT: readonly string[] = ["proef werkte niet", UNREACHABLE];

/**
 * A point "niet bereikbaar" says what did not load (an address or the label of a page) and
 * when (a time of day), so the report can say it and a later round knows what to try again.
 */
export function unreachablePointProblems(point: string, at: string): string[] {
  const { kind, textNl } = openPoint(point);
  if (kind?.prefix !== UNREACHABLE) return [];
  const problems: string[] = [];
  if (!(/\bhttps?:\/\/\S+/i.test(textNl) || /\bP\d+\b/.test(textNl))) problems.push(`${at}: a point "${UNREACHABLE}:" names what did not load: the address of the page or the embedded frame, or the label of the page (P03)`);
  if (!/\b\d{1,2}[:.]\d{2}\b/.test(textNl)) problems.push(`${at}: a point "${UNREACHABLE}:" says when it did not load: the time of the first and the last try, such as "tussen 14:05 en 14:40"`);
  return problems;
}

/** Whether every open point is of the kind "versturen niet toegestaan": then one declaration at inventory is all the criterion waits for. */
export const waitsOnlyOnSending = (points: string[]): boolean => points.length > 0 && points.every((point) => openPoint(point).kind?.prefix === NOT_SENT);

/**
 * The origins named in points "versturen niet toegestaan", in the order they first appear: the
 * address an agent saw a message go to, or the address of the embedded frame it was in.
 */
export function notSentOrigins(points: string[]): string[] {
  const origins: string[] = [];
  for (const point of points) {
    if (openPoint(point).kind?.prefix !== NOT_SENT) continue;
    for (const [address] of point.matchAll(/\bhttps?:\/\/[^\s)>\]"',;]+/gi)) {
      try {
        const origin = new URL(address.replace(/[.:]+$/, "")).origin;
        if (!origins.includes(origin)) origins.push(origin);
      } catch {
        // Not an address after all.
      }
    }
  }
  return origins;
}

/** An open point split into its kind and its text. The kind is null for a point from before the kinds existed. */
export function openPoint(point: string): { kind: OpenPointKind | null; textNl: string } {
  const clean = point.replace(/\s+/g, " ").trim();
  const kind = OPEN_POINT_KINDS.find((entry) => clean.toLowerCase().startsWith(`${entry.prefix}:`)) ?? null;
  if (!kind) return { kind, textNl: clean };
  const text = clean.slice(kind.prefix.length + 1).trim();
  return { kind, textNl: `${text.charAt(0).toUpperCase()}${text.slice(1)}` };
}

/**
 * A run that may send to one origin has no point "versturen niet toegestaan" about that origin:
 * there the agent sends and measures. The point stays only for a message that goes elsewhere,
 * and then it names the address, so the report can say which declaration would have closed it,
 * or once the budget for sending of the run is used up, and then the point says so.
 */
export function notSentPointProblems(missingNl: unknown, permission: { origin: string } | null, budget: { sent: number; max: number } | null = null): string[] {
  if (!permission || !Array.isArray(missingNl)) return [];
  const usedUp = budget !== null && budget.sent >= budget.max;
  return missingNl.flatMap((point, position) => {
    if (typeof point !== "string" || openPoint(point).kind?.prefix !== NOT_SENT || notSentOrigins([point]).some((origin) => origin !== permission.origin)) return [];
    if (usedUp && SENDING_BUDGET_OUT.test(point)) return [];
    const budgetNl = budget ? ` The budget for sending of the run is ${usedUp ? "used up" : `not used up (${budget.sent} of ${budget.max} sent)`}${usedUp ? `: then the point says "het budget voor versturen van deze run is op (${budget.sent} van ${budget.max} verstuurd)"` : ""}` : "";
    return [`missingNl[${position}]: this run may send to ${permission.origin} (writes.allowed in the dossier), so "${NOT_SENT}:" is only for a message that goes to another origin, or for one that could not go because the budget for sending of the run is used up. Send it there and measure; or, when the message goes elsewhere, name in the point the address it goes to.${budgetNl}`];
  });
}

/** How a point "versturen niet toegestaan" says that the budget for sending of the run held the message back. */
const SENDING_BUDGET_OUT = /budget voor versturen/i;

interface ShapeContext {
  criterion: string;
  pageLabels: string[];
  /** Why a reference is not acceptable evidence, or null when it is. */
  refProblem: (ref: string) => string | null;
}

/**
 * The rules every verdict has to meet to keep the judgment honest: the right shape,
 * findings that point somewhere, and evidence references that actually exist.
 */
function validateShape(input: unknown, context: ShapeContext): string[] {
  const problems: string[] = [];
  if (input === null || typeof input !== "object") return ["the verdict is not a JSON object"];
  const verdict = input as Partial<Verdict>;

  if (verdict.criterion !== context.criterion) problems.push(`criterion must be "${context.criterion}"`);
  if (!OUTCOMES.includes(verdict.outcome as Outcome)) problems.push(`outcome must be one of ${OUTCOMES.join(", ")}`);
  if (!isText(verdict.rule) || !/^R\d+$/.test(verdict.rule)) problems.push('rule must name the decision rule that applied, such as "R2"');
  if (!isText(verdict.summaryNl, 20)) problems.push("summaryNl is missing or too short");

  const checkEvidence = (refs: unknown, at: string): void => {
    if (!Array.isArray(refs) || refs.length === 0) {
      problems.push(`${at}: evidence must list at least one reference`);
      return;
    }
    for (const ref of refs) {
      if (typeof ref !== "string") problems.push(`${at}: evidence reference is not text`);
      else {
        const problem = context.refProblem(ref);
        if (problem) problems.push(`${at}: ${problem}`);
      }
    }
  };

  const observations = Array.isArray(verdict.observations) ? verdict.observations : [];
  if (observations.length === 0) problems.push("observations: at least one is required");
  observations.forEach((observation, index) => {
    const at = `observations[${index}]`;
    if (!isText(observation.checkedNl, 5)) problems.push(`${at}: checkedNl is missing`);
    if (!isText(observation.howNl, 5)) problems.push(`${at}: howNl is missing`);
    if (!isText(observation.observedNl, 5)) problems.push(`${at}: observedNl is missing`);
    checkEvidence(observation.evidence, at);
  });

  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  if (verdict.outcome === "failed" && findings.length === 0) problems.push('a "failed" outcome needs at least one finding');
  if (verdict.outcome !== "failed" && findings.length > 0) problems.push(`a "${verdict.outcome}" outcome cannot carry findings; use "failed", or "cantTell" if the problem cannot be pointed at`);
  findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    for (const field of ["titleNl", "observedNl", "impactNl", "fixNl", "pagesAffected"] as const) {
      if (!isText(finding[field], 3)) problems.push(`${at}: ${field} is missing`);
    }
    if (!(SEVERITIES as readonly string[]).includes(finding.severity)) problems.push(`${at}: severity must be one of ${SEVERITIES.join(", ")}`);
    if (!["content", "design", "techniek", "leverancier"].includes(finding.owner)) problems.push(`${at}: owner must be content, design, techniek or leverancier`);
    if (!Array.isArray(finding.locations) || finding.locations.length === 0) problems.push(`${at}: at least one location is required`);
    for (const location of finding.locations ?? []) {
      if (!context.pageLabels.includes(location.page)) problems.push(`${at}: page "${location.page}" is not in the legend`);
      if (!isText(location.where, 3)) problems.push(`${at}: location.where is missing`);
    }
    checkEvidence(finding.evidence, at);
  });

  if (verdict.outcome === "cantTell" && !(Array.isArray(verdict.missingNl) && verdict.missingNl.some((item) => isText(item, 10)))) {
    problems.push('a "cantTell" outcome must say in missingNl what is needed to decide');
  }
  return problems;
}

/*
 * Version 2: judging with instruments.
 *
 * An agent acts and measures only through the session commands, and every statement points
 * at a recorded observation. Everything below is pure: the caller reads the observation log
 * and hands over what exists in it.
 */

/** Commands that show what is on the page without changing it. */
export const LOOK_COMMANDS = ["look", "crop", "ax", "style", "html", "find", "document"] as const;
/** Commands that read what the run stored instead of a page: their observation can be made again without a state to open. */
const STATELESS_COMMANDS = new Set<string>(["document"]);
/** Commands that measure. `paste`, `press` and `timers` act on the page, and so can `speak`, but their answer is the measurement. */
export const MEASURE_COMMANDS = ["contrast", "focus", "target", "reflow", "spacing", "zoom", "order", "name", "rules", "taborder", "lang", "source", "ocr", "motion", "timers", "paste", "press", "media", "forced", "distinct", "speak", "voiceover"] as const;
/** Older names of a command that still work in a session. */
export const COMMAND_ALIASES: Record<string, string> = { engines: "rules", tabwalk: "taborder" };
export const canonicalCommand = (command: string): string => COMMAND_ALIASES[command] ?? command;
const SHOWING = new Set<string>([...LOOK_COMMANDS, ...MEASURE_COMMANDS]);
/** Every word that can follow `session` on the command line as a command in a session (an agent types it as `loep <command>`): the commands that act, look, measure and record, with their older names. */
export const SESSION_COMMANDS: string[] = [...LOOK_COMMANDS, ...MEASURE_COMMANDS, ...Object.keys(COMMAND_ALIASES), "open", "click", "key", "tab", "type", "select", "hover", "scroll", "back", "state", "replay", "status", "tools", "wait", "sheet"];
// "loep" is also an ordinary word, so only the word with a command behind it counts as naming one.
const NAMES_A_COMMAND = new RegExp(`\\bloep (?:${SESSION_COMMANDS.join("|")})\\b`, "i");

/** `<session>-<number>`, as the session prints it with every command. */
export const OBSERVATION_ID = /^[a-z0-9][a-z0-9_-]{0,30}-\d{4,}$/;
export const sessionOfObservation = (id: string): string => id.replace(/-\d+$/, "");

/** What validation needs to know about one recorded observation. */
export interface ObservationRef {
  command: string;
  /** The command ended in an error: it shows nothing. */
  failed: boolean;
  /** The state it was made in starts at a fresh page, so it can be played again. */
  replayable: boolean;
  /** For a measurement: whether its methods agreed. Null for a command without methods. */
  agreement: "single" | "agree" | "disagree" | null;
  /** Where the methods contradicted each other; for the rule engines each line starts with a criterion. */
  differences: string[];
  /** Every method that answered marked its own answer as known-unreliable here. Information for whoever reads the index; a flag names one specific failure and does not disqualify the observation. */
  unreliable: boolean;
  /** For a command that typed into a field: the value it entered. Absent for every other command, and when the field was emptied. */
  entered?: string;
}

export type ObservationIndex = ReadonlyMap<string, ObservationRef>;

/** The part of an observation record (`observations/<session>/<nr>.json`) that the index is made of. */
export interface ObservationRecordLike {
  id: string;
  command: string;
  error: string | null;
  state: { start: unknown } | null;
  result: unknown;
}

export function indexObservations(records: Iterable<ObservationRecordLike>): Map<string, ObservationRef> {
  const index = new Map<string, ObservationRef>();
  for (const record of records) {
    const result = (record.result ?? {}) as { agreement?: unknown; differences?: unknown; methods?: unknown; entered?: unknown };
    const methods = Array.isArray(result.methods) ? (result.methods as { knownUnreliable?: unknown }[]) : [];
    const agreement = result.agreement === "single" || result.agreement === "agree" || result.agreement === "disagree" ? result.agreement : null;
    index.set(record.id, {
      command: canonicalCommand(record.command),
      failed: record.error !== null,
      replayable: record.state?.start != null || (STATELESS_COMMANDS.has(canonicalCommand(record.command)) && record.error === null),
      agreement,
      differences: Array.isArray(result.differences) ? result.differences.filter((line): line is string => typeof line === "string") : [],
      unreliable: methods.length > 0 && methods.every((method) => typeof method?.knownUnreliable === "string"),
      ...(canonicalCommand(record.command) === "type" && record.error === null && typeof result.entered === "string" && result.entered !== "" ? { entered: result.entered } : {}),
    });
  }
  return index;
}

interface InstrumentContext {
  criterion: string;
  /** Extractor names present in the dossier; empty when the judge worked without one. */
  evidenceNames: string[];
  pageLabels: string[];
  observations: ObservationIndex;
  /** Ids of the candidates of the walk-through that name this criterion. Each needs a ruling. */
  candidateIds: string[];
  /** Commands the procedure wants to see cited in a pass (`pass_observations` in its front matter). */
  passCommands: string[];
  /** Commands whose method agreement matters for this criterion (`decisive`, or else `pass_observations`). */
  decisiveCommands: string[];
  /** The recommendation rules of the procedure ("A1", "A2"). Without them a verdict gives no recommendations. */
  recommendationRules?: string[];
  /** Whether a path that a verdict cites exists in the run. Without it, no file counts as evidence. */
  fileExists?: (ref: string) => boolean;
  /** The text of a cited observation, a dossier part or the saved copy of a page (by its label), or null when the reference has none. Without it, quotations are not checked. */
  sourceText?: (ref: string) => string | null;
  /** Hosts of the site that is evaluated, one per origin (`siteHosts`): an address in an advice is one of the site itself. Without them, addresses are not checked. */
  siteHosts?: string[];
  /** Prefixes of the custom elements a vendor makes, as given at inventory. Without them nothing is known to be someone else's, and an advice is not checked for reaching into it. */
  vendorPrefixes?: string[];
}

export interface JudgeContext extends InstrumentContext {
  /** The session of this attempt of the judge: when given, a finding needs an observation of that session. */
  session?: string;
}

export interface VerificationContext extends InstrumentContext {
  /** The session the verifier worked in: reproduction counts only with its own observations. */
  session: string;
  /** The verdict of the judge, already validated. */
  judge: Verdict;
}

const CRITERION_ID = /^\d\.\d\.\d{1,2}$/;

function refProblem(ref: string, context: InstrumentContext): string | null {
  if (context.evidenceNames.includes(ref) || context.observations.has(ref)) return null;
  if (OBSERVATION_ID.test(ref)) return `observation "${ref}" is not in the observation log`;
  if (context.fileExists?.(ref)) return null;
  return `evidence "${ref}" is not an observation, not a part of the dossier (${context.evidenceNames.join(", ") || "none"}) and not an existing file in the run`;
}

/** A measurement contradicts itself for this criterion, unless every difference is about another criterion. */
function disagreesFor(ref: ObservationRef, criterion: string): boolean {
  if (ref.agreement !== "disagree") return false;
  const elsewhere = ref.differences.length > 0 && ref.differences.every((line) => /^\d\.\d\.\d{1,2}:/.test(line) && !line.startsWith(`${criterion}:`));
  return !elsewhere;
}

const QUOTE_PAIRS: [string, string][] = [["\u201c", "\u201d"], ["\u201e", "\u201d"], ["\u201e", "\u201c"], ["\u00ab", "\u00bb"], ["\u2018", "\u2019"], ['"', '"'], ["'", "'"]];
const MIN_QUOTE = 3;

/** Text as it is compared: one form for every kind of space, no invisible characters. */
export const comparableText = (text: string): string => text.normalize("NFC").replace(/[\u00ad\u200b-\u200d\ufeff]/g, "").replace(/[\s\u00a0\u2000-\u200a\u202f]+/g, " ").trim();

/**
 * The fragments a text puts between quotation marks, split where the writer left something out
 * with an ellipsis. Code is not a quotation: a span in backticks and an attribute value (`role="list"`) are skipped.
 */
export function quotedFragments(text: string): string[] {
  const plain = text.replace(/`[^`]*`/g, " ");
  const fragments: string[] = [];
  let position = 0;
  while (position < plain.length) {
    const before = plain[position - 1] ?? " ";
    const pair = QUOTE_PAIRS.filter(([open]) => plain.startsWith(open, position)).map(([, close]) => close);
    // A quotation opens after a space or a bracket; an apostrophe inside a word and an attribute value do not.
    if (pair.length === 0 || !/[\s(\[:;,>\/]/.test(before)) {
      position++;
      continue;
    }
    let end = -1;
    for (let at = position + 1; at < plain.length; at++) {
      // It closes before a space, punctuation or the end, so an apostrophe inside the quotation does not end it.
      if (pair.includes(plain[at]!) && /[\s.,;:!?)\]]/.test(plain[at + 1] ?? " ")) {
        end = at;
        break;
      }
    }
    if (end < 0) {
      position++;
      continue;
    }
    for (const part of plain.slice(position + 1, end).split(/\u2026|\.{3}/)) {
      const fragment = comparableText(part);
      if (fragment.length >= MIN_QUOTE) fragments.push(fragment);
    }
    position = end + 1;
  }
  return fragments;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1]!.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/** Every text in a recorded value, as it is and as the page shows it when the text is HTML: without tags, with entities read. */
export function searchableText(value: unknown): string {
  const strings: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") strings.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === "object") Object.values(node).forEach(visit);
  };
  visit(value);
  const raw = strings.join("\n");
  return comparableText(`${raw}\n${decodeEntities(raw.replace(/<[^>]*>/g, ""))}\n${decodeEntities(raw)}`);
}

/** Criteria whose repair changes how much room something takes: a fix for one width can break another. */
const SPACE_CRITERIA = ["1.4.4", "1.4.10", "1.4.12"];
/** Hosts an advice may point at besides the site itself: the standard it explains. */
const REFERENCE_HOSTS = /(^|\.)w3\.org$/;

const ELEMENT_NAME = /(?<![\w.#-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![\w-])/g;

/** The custom elements a text names that belong to the vendor, by the prefixes given at inventory. */
export function vendorElementsIn(text: string, tagPrefixes: string[]): string[] {
  const prefixes = tagPrefixes.map((prefix) => prefix.toLowerCase());
  return [...new Set([...text.toLowerCase().matchAll(ELEMENT_NAME)].map((match) => match[0]).filter((name) => prefixes.some((prefix) => name.startsWith(prefix))))];
}

/** How an advice says what the site can do itself, next to what only the vendor can change. */
export const WITHIN_REACH = /\bbinnen eigen bereik\b/i;

/**
 * What an advice names inside the shadow tree of an element of the vendor, or null. A site
 * cannot carry out such an advice: it does not write into a component it did not make. Two
 * things show it, and both need the vendor's elements to be known:
 *
 * - a selector that crosses the shadow root of such an element: "x-list >>> div";
 * - a class called after such an element ("list-item__action" for "x-list-item"), where the
 *   advice or the finding names that element: such a class exists only inside it.
 *
 * Naming a component as the thing to use, or an attribute to set on it, is neither.
 */
export function shadowPartOf(fix: string, tagPrefixes: string[], touched: string[] = []): { part: string; of: string } | null {
  for (const [, host, inner] of fix.matchAll(/([^\s`"'(]+)\s*>>>\s*([^\s`"')]+)/g)) {
    const name = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+/i.exec(host!)?.[0];
    if (name && vendorElementsIn(name, tagPrefixes).length > 0) return { part: `${host} >>> ${inner}`, of: name.toLowerCase() };
  }
  const prefixes = tagPrefixes.map((prefix) => prefix.toLowerCase()).sort((a, b) => b.length - a.length);
  const tags = [...new Set([...vendorElementsIn(fix, tagPrefixes), ...touched])];
  for (const [, name] of fix.matchAll(/\.([a-z][\w-]*)/gi)) {
    const of = tags.find((tag) => {
      const base = tag.slice(prefixes.find((prefix) => tag.startsWith(prefix))?.length ?? 0).replace(/^-/, "");
      return base.length > 0 && (name!.startsWith(`${base}__`) || name!.startsWith(`${base}--`) || (name === base && base.includes("-")));
    });
    if (of) return { part: `.${name}`, of };
  }
  return null;
}

/** Criteria whose findings depend on what was typed into a field: without the value nobody can repeat them. */
const INPUT_CRITERIA = ["3.3.1", "3.3.3", "3.3.4"];
/** As much of a long value as the command prints back. */
const ENTERED_SHOWN = 40;

/**
 * A finding about input says what was typed. "A text with spaces" cannot be repeated; the
 * value can. Checked against the observations of the type command the finding cites: each
 * value entered there has to stand in `observedNl` to the letter (the beginning of a long one).
 */
function inputProblems(finding: Partial<Finding>, at: string, context: InstrumentContext): string[] {
  if (!INPUT_CRITERIA.includes(context.criterion)) return [];
  const observed = comparableText(typeof finding.observedNl === "string" ? finding.observedNl : "");
  const problems: string[] = [];
  const told = new Set<string>();
  for (const ref of Array.isArray(finding.evidence) ? finding.evidence : []) {
    const entered = typeof ref === "string" ? context.observations.get(ref)?.entered : undefined;
    if (entered === undefined || told.has(entered)) continue;
    told.add(entered);
    const shown = comparableText(entered.slice(0, ENTERED_SHOWN));
    if (!observed.includes(shown)) problems.push(`${at}.observedNl: observation ${ref} typed "${shown}" into a field, and the finding does not say so. Name the value to the letter, and the field it went into, so that a reader can repeat it; "een tekst met spaties" is not enough`);
  }
  return problems;
}

/** Advice that would do harm when carried out to the letter. */
function adviceProblems(finding: Partial<Finding>, at: string, context: InstrumentContext): string[] {
  const fix = typeof finding.fixNl === "string" ? finding.fixNl : "";
  const problems: string[] = [];
  const overridden = /<(ul|ol|dl|table|h[1-6])\b[^>]*\srole\s*=/i.exec(fix);
  if (overridden) problems.push(`${at}.fixNl: the advice puts a role on <${overridden[1]!.toLowerCase()}>; that takes away what the element is (a list without items, a table without cells, a heading that is none). Keep the element and name or group it another way, such as aria-labelledby`);
  if (SPACE_CRITERIA.includes(context.criterion) && !/\b320\b/.test(fix)) problems.push(`${at}.fixNl: an advice about room names the narrowest width to measure again: say that the result must be measured at 320 pixels and at a width in between`);
  if (context.siteHosts && context.siteHosts.length > 0) {
    const own = context.siteHosts.map((host) => host.toLowerCase());
    for (const [, host] of fix.matchAll(/https?:\/\/([a-z0-9.-]+(?::\d+)?)/gi)) {
      const name = host!.toLowerCase().replace(/\.$/, "");
      if (!own.includes(name) && !REFERENCE_HOSTS.test(name)) problems.push(`${at}.fixNl: the address with "${name}" is not an address of this site; an example uses the site itself (${own.join(" or ")})`);
    }
  }
  // An advice inside someone else's shadow tree is an advice to the vendor. Kept narrow: only what is known to be the vendor's.
  if (context.vendorPrefixes && context.vendorPrefixes.length > 0 && finding.owner !== "leverancier" && !WITHIN_REACH.test(fix)) {
    const where = (Array.isArray(finding.locations) ? finding.locations : []).map((location) => (typeof location?.where === "string" ? location.where : "")).join(" ");
    const inside = shadowPartOf(fix, context.vendorPrefixes, vendorElementsIn(where, context.vendorPrefixes));
    if (inside) {
      problems.push(
        `${at}.fixNl: the advice names "${inside.part}", which lies inside the shadow tree of ${inside.of}. The site does not make that element and cannot change what is inside it. ` +
          `Either this is for the vendor (owner "leverancier"), or the advice also says what the site can do itself, in a sentence that starts with "Binnen eigen bereik:"`,
      );
    }
  }
  return problems;
}

/** Quotations in the fields a reader searches the page with, that no cited source contains literally. */
function quoteProblems(finding: Partial<Finding>, at: string, sourceText: (ref: string) => string | null): string[] {
  const pages = (Array.isArray(finding.locations) ? finding.locations : []).map((location) => location?.page);
  const refs = [...(Array.isArray(finding.evidence) ? finding.evidence : []), ...pages].filter((ref): ref is string => typeof ref === "string");
  let sources: string | null = null;
  const problems: string[] = [];
  const locations = Array.isArray(finding.locations) ? finding.locations : [];
  const quoting: [string, unknown][] = [["titleNl", finding.titleNl], ["observedNl", finding.observedNl], ...locations.map((location, position): [string, unknown] => [`locations[${position}].where`, location?.where])];
  // The heading and the text of a location are page text as a whole, with or without quotation marks.
  const literal: [string, unknown][] = locations.flatMap((location, position): [string, unknown][] => [[`locations[${position}].heading`, location?.heading], [`locations[${position}].text`, location?.text]]);
  const fields: [string, string[]][] = [
    ...quoting.map(([field, text]): [string, string[]] => [field, typeof text === "string" ? quotedFragments(text) : []]),
    ...literal.map(([field, text]): [string, string[]] => [field, typeof text === "string" ? text.split(/\u2026|\.{3}/).map(comparableText).filter((part) => part.length > 0) : []]),
  ];
  for (const [field, fragments] of fields) {
    for (const fragment of fragments) {
      sources ??= refs.map((ref) => sourceText(ref) ?? "").join("\n");
      if (!sources.includes(fragment)) problems.push(`${at}.${field}: the quoted text "${fragment}" is not found literally in an observation or dossier part this finding cites, nor in the saved copy of a page it names; copy the text exactly from the observation and cite that observation, mark what you leave out with "...", or drop the quotation marks if it is not text of the page`);
    }
  }
  return problems;
}

const normalisePlace = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** The places a finding or a recommendation points at: its component, and each page with its spot. */
export function placesOf(item: { component?: string | null; locations?: Location[] }): string[] {
  const places = (Array.isArray(item.locations) ? item.locations : []).filter((location) => typeof location?.where === "string").map((location) => `${location.page} ${normalisePlace(location.where)}`);
  return typeof item.component === "string" && item.component.trim() ? [`component ${normalisePlace(item.component)}`, ...places] : places;
}

/**
 * A recommendation comes only from the procedure: a rule of its section "Aanbevelingen", an
 * observation that shows it, and a place a reader can find. It never stands where this verdict has a finding:
 * one place is either wrong or open to improvement, not both.
 */
function recommendationProblems(verdict: Partial<Verdict>, context: InstrumentContext, showsOwn: (ref: string) => boolean, whose: string): string[] {
  const recommendations = verdict.recommendations;
  if (recommendations === undefined) return [];
  if (!Array.isArray(recommendations)) return ["recommendations must be a list"];
  const rules = context.recommendationRules ?? [];
  if (recommendations.length > 0 && rules.length === 0) return ["recommendations: the procedure of this criterion has no section \"Aanbevelingen\", so this verdict gives no recommendations. Something that is wrong is a finding; something that is not wrong needs no entry"];
  const findingPlaces = new Set((Array.isArray(verdict.findings) ? verdict.findings : []).flatMap(placesOf));
  const problems: string[] = [];
  recommendations.forEach((entry, position) => {
    const at = `recommendations[${position}]`;
    if (!rules.includes(entry?.rule)) problems.push(`${at}: rule must be a recommendation rule of the procedure (${rules.join(", ")}); a recommendation for which the procedure has no rule is not given`);
    for (const field of ["titleNl", "observedNl", "recommendationNl"] as const) if (!isText(entry?.[field], 10)) problems.push(`${at}: ${field} is missing`);
    const locations = Array.isArray(entry?.locations) ? entry.locations : [];
    if (locations.length === 0) problems.push(`${at}: at least one location is required`);
    locations.forEach((location, place) => {
      if (!context.pageLabels.includes(location?.page)) problems.push(`${at}.locations[${place}]: page "${location?.page}" is not in the legend`);
      if (!isText(location?.where, 3)) problems.push(`${at}.locations[${place}]: where is missing`);
      if (!(location?.wholePage === true || isText(location?.heading, 2) || isText(location?.text, 2))) problems.push(`${at}.locations[${place}]: give "heading" or "text" as the page has it, so a reader finds the place without the selector`);
    });
    const refs = Array.isArray(entry?.evidence) ? entry.evidence.filter((ref): ref is string => typeof ref === "string") : [];
    if (!refs.some(showsOwn)) problems.push(`${at}: a recommendation needs at least one observation${whose} of a look or measure command that shows it`);
    for (const ref of refs) {
      const problem = refProblem(ref, context);
      if (problem) problems.push(`${at}: ${problem}`);
    }
    if (context.sourceText) problems.push(...quoteProblems(entry as unknown as Partial<Finding>, at, context.sourceText));
    const shared = placesOf(entry).find((place) => findingPlaces.has(place));
    if (shared) problems.push(`${at}: this verdict has a finding at the same place (${shared}). A place that is wrong gets a finding and no recommendation; a recommendation is only for what no decision rule calls wrong`);
  });
  return problems;
}

/**
 * The rules that tie a verdict to the observation log.
 * `ownSession`: when given, only observations of that session count as showing a finding.
 */
function instrumentRules(verdict: Partial<Verdict>, context: InstrumentContext, ownSession: string | null, role: "judge" | "verifier" | "finisher" = ownSession !== null ? "verifier" : "judge"): string[] {
  // The verifier keeps the keys of the judge next to its own; the finisher writes a verdict of its own, like a judge.
  const verifier = role === "verifier";
  // Who comes after a judge dismisses a candidate only with an observation of its own.
  const second = role !== "judge";
  const problems: string[] = [];
  const index = context.observations;
  const shows = (ref: string): boolean => {
    const observation = index.get(ref);
    return !!observation && SHOWING.has(observation.command) && !observation.failed;
  };
  const own = (ref: string): boolean => ownSession === null || sessionOfObservation(ref) === ownSession;
  const whose = ownSession === null ? "" : ` of session "${ownSession}"`;

  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  const keyPattern = verifier ? /^[FV]\d+$/ : /^F\d+$/;
  const keys = new Set<string>();
  findings.forEach((finding, position) => {
    const at = `findings[${position}]`;
    if (typeof finding.key !== "string" || !keyPattern.test(finding.key)) problems.push(`${at}: key must be ${!verifier ? '"F1", "F2", ...' : 'the key of the judge ("F1") or a new one ("V1")'}`);
    else if (keys.has(finding.key)) problems.push(`${at}: key "${finding.key}" is used twice`);
    else keys.add(finding.key);
    const refs = Array.isArray(finding.evidence) ? finding.evidence.filter((ref): ref is string => typeof ref === "string") : [];
    if (!refs.some((ref) => shows(ref) && own(ref) && index.get(ref)!.replayable)) {
      problems.push(`${at}: a finding needs at least one observation${whose} of a look or measure command (${[...SHOWING].join(", ")}) that succeeded and was made in a state that starts with "open"`);
    }
    (Array.isArray(finding.locations) ? finding.locations : []).forEach((location, place) => {
      if (location?.wholePage === true || isText(location?.heading, 2) || isText(location?.text, 2)) return;
      problems.push(`${at}.locations[${place}]: a reader must be able to find the place without the selector; give "heading" (the nearest heading above, as the page has it) or "text" (the link text, the label or the sentence around it, as the page has it), which a command on the element prints under "place"; only for something about the page as a whole (its title, its language) set "wholePage": true`);
    });
    if (context.sourceText) problems.push(...quoteProblems(finding, at, context.sourceText));
    problems.push(...adviceProblems(finding, at, context));
    problems.push(...inputProblems(finding, at, context));
  });

  problems.push(...recommendationProblems(verdict, context, (ref) => shows(ref) && own(ref), whose));

  // Every open point says of what kind it is, and is written for a reader who does not know the toolbox.
  (Array.isArray(verdict.missingNl) ? verdict.missingNl : []).forEach((point, position) => {
    const at = `missingNl[${position}]`;
    if (typeof point !== "string") return void problems.push(`${at}: an open point is text`);
    const { kind, textNl } = openPoint(point);
    if (!kind) problems.push(`${at}: an open point starts with its kind and a colon: ${OPEN_POINT_KINDS.map((entry) => `"${entry.prefix}:" (${entry.labelNl})`).join(", ")}`);
    else if (!isText(textNl, 10)) problems.push(`${at}: say after "${kind.prefix}:" what is open and where`);
    else problems.push(...unreachablePointProblems(point, at));
    const said: string[] = [];
    if (textNl.split(/[\s,;()]+/).some((word) => index.has(word.replace(/[.:]+$/, "")))) said.push("the number of an observation (cite it in the evidence of an observation with ruling \"open\")");
    if (NAMES_A_COMMAND.test(textNl)) said.push("the name of a command");
    if (/\bR\d+\b/.test(textNl)) said.push("the number of a decision rule");
    if (/\b(ik|wij|mij|mijn)\b/i.test(textNl)) said.push("\"ik\" or \"wij\" (write in the third person)");
    if (said.length > 0) problems.push(`${at}: an open point is written for the owner of the site, in plain words; leave out ${said.join(", ")}`);
  });

  // Every observation says what follows from it. A defect that is only described reaches no work list.
  const hasOpenPoint = Array.isArray(verdict.missingNl) && verdict.missingNl.some((item) => isText(item, 10));
  (Array.isArray(verdict.observations) ? verdict.observations : []).forEach((observation, position) => {
    const at = `observations[${position}]`;
    if (!CANDIDATE_RULINGS.includes(observation.ruling as (typeof CANDIDATE_RULINGS)[number])) problems.push(`${at}: ruling says what follows from what was seen: "noIssue" (nothing wrong), "finding" (with the key of the finding in "finding"), "open" (with the point in missingNl) or "otherCriterion" (with an entry in crossCandidates)`);
    else if (observation.ruling === "finding" && !(typeof observation.finding === "string" && keys.has(observation.finding))) problems.push(`${at}: ruling "finding" names the key of a finding in this verdict; something that is wrong and gets no finding is "open", with the point in missingNl`);
    else if (observation.ruling === "open" && !hasOpenPoint) problems.push(`${at}: ruling "open" needs the point in missingNl, with the place, so it reaches the work list`);
    else if (observation.ruling === "otherCriterion" && !(Array.isArray(verdict.crossCandidates) && verdict.crossCandidates.length > 0)) problems.push(`${at}: ruling "otherCriterion" needs an entry in crossCandidates, so the judge of that criterion sees it`);
  });

  const cited = (Array.isArray(verdict.observations) ? verdict.observations : []).flatMap((observation) => (Array.isArray(observation.evidence) ? observation.evidence : [])).filter((ref): ref is string => typeof ref === "string");
  if (verdict.outcome === "passed") {
    const shown = cited.filter(shows);
    if (shown.length === 0) problems.push('a "passed" outcome needs at least one observation of a look or measure command among its observations; a pass that rests on the dossier alone is not checked against the site');
    for (const command of context.passCommands) {
      if (!shown.some((ref) => index.get(ref)!.command === canonicalCommand(command))) problems.push(`a "passed" outcome for this criterion must cite an observation of "${command}" (the procedure asks for it under "Bewijs bij goedkeuring")`);
    }
  }
  if (verdict.outcome === "passed" || verdict.outcome === "inapplicable") {
    const resolved = Array.isArray(verdict.resolved) ? verdict.resolved : [];
    const decisive = new Set(context.decisiveCommands.map(canonicalCommand));
    for (const ref of new Set(cited)) {
      const observation = index.get(ref);
      if (!observation || !decisive.has(observation.command) || !disagreesFor(observation, context.criterion)) continue;
      const resolution = resolved.find((entry) => Array.isArray(entry.observations) && entry.observations.includes(ref));
      const settled = resolution && isText(resolution.howNl, 10) && Array.isArray(resolution.by) && resolution.by.some((by) => !resolution.observations.includes(by) && shows(by) && !disagreesFor(index.get(by)!, context.criterion));
      if (!settled) problems.push(`observation "${ref}" has methods that disagree; a "${verdict.outcome}" outcome may only cite it with an entry in "resolved" that names a closer look or another measurement that settles it, otherwise the outcome is "cantTell" with the disagreement in missingNl`);
    }
  }

  const rulings = Array.isArray(verdict.candidates) ? verdict.candidates : [];
  const ruled = new Set<string>();
  rulings.forEach((ruling, position) => {
    const at = `candidates[${position}]`;
    if (!context.candidateIds.includes(ruling.id)) problems.push(`${at}: "${ruling.id}" is not a candidate for this criterion`);
    else if (ruled.has(ruling.id)) problems.push(`${at}: candidate "${ruling.id}" has two rulings`);
    ruled.add(ruling.id);
    if (!CANDIDATE_RULINGS.includes(ruling.ruling)) problems.push(`${at}: ruling must be one of ${CANDIDATE_RULINGS.join(", ")}`);
    if (!isText(ruling.reasonNl, 10)) problems.push(`${at}: reasonNl is missing`);
    if (ruling.ruling === "finding" && !(typeof ruling.finding === "string" && keys.has(ruling.finding))) problems.push(`${at}: a candidate that became a finding names the key of that finding`);
    if (ruling.ruling === "otherCriterion" && !(typeof ruling.criterion === "string" && CRITERION_ID.test(ruling.criterion) && ruling.criterion !== context.criterion)) problems.push(`${at}: a candidate for another criterion names that criterion`);
    if (ruling.ruling === "open" && (verdict.outcome === "passed" || verdict.outcome === "inapplicable")) problems.push(`${at}: a "${verdict.outcome}" outcome cannot leave a candidate open`);
  });
  for (const id of context.candidateIds) if (!ruled.has(id)) problems.push(`candidates: candidate "${id}" has no ruling`);
  if (second) {
    rulings.forEach((ruling, position) => {
      if (ruling.ruling === "noIssue" && !(Array.isArray(ruling.evidence) && ruling.evidence.some((ref) => shows(ref) && own(ref)))) {
        problems.push(`candidates[${position}]: dismissing a candidate is a small pass; "noIssue" needs a look or measure observation${whose} in evidence, otherwise the ruling is "open" with the candidate in missingNl`);
      }
    });
  }

  // "No deviation found, not fully measured" may be said only when nothing points the other way and no point asks for a person.
  if (verdict.nothingFound !== undefined) {
    const points = (Array.isArray(verdict.missingNl) ? verdict.missingNl : []).filter((point): point is string => typeof point === "string").map(openPoint);
    if (verdict.outcome !== "cantTell") problems.push(`nothingFound belongs to a "cantTell" outcome only; with "${String(verdict.outcome)}" leave it out`);
    if (!isText(verdict.nothingFound?.coverageNl, 20)) problems.push('nothingFound.coverageNl: say what was measured, with counts, such as "gemeten op 9 van 29 pagina\'s en in 4 van 12 toestanden; geen verschil gevonden"');
    if (!cited.some(shows)) problems.push("nothingFound needs at least one observation of a look or measure command among the observations: nothing was found only where somebody looked");
    if (rulings.some((ruling) => ruling.ruling === "open")) problems.push("nothingFound cannot stand next to a candidate that is left open");
    if (points.length === 0 || points.some((point) => !point.kind || point.kind.reader === "owner")) problems.push(`nothingFound is only for a verdict whose open points are all of the kinds ${OPEN_POINT_KINDS.filter((kind) => kind.reader !== "owner").map((kind) => `"${kind.prefix}:"`).join(", ")}; with a point a person has to look into the outcome is a plain "cantTell", so leave nothingFound out`);
  }

  (Array.isArray(verdict.crossCandidates) ? verdict.crossCandidates : []).forEach((cross, position) => {
    const at = `crossCandidates[${position}]`;
    if (!(typeof cross.criterion === "string" && CRITERION_ID.test(cross.criterion) && cross.criterion !== context.criterion)) problems.push(`${at}: criterion must be another criterion than this one`);
    if (!context.pageLabels.includes(cross.page)) problems.push(`${at}: page "${cross.page}" is not in the legend`);
    if (!isText(cross.where, 3)) problems.push(`${at}: where is missing`);
    if (!isText(cross.noteNl, 10)) problems.push(`${at}: noteNl is missing`);
    else if (cross.noteNl.trim().split(/\s+/).length > MAX_CANDIDATE_WORDS) problems.push(`${at}: noteNl is one sentence of at most ${MAX_CANDIDATE_WORDS} words`);
    if (!(Array.isArray(cross.evidence) && cross.evidence.some((ref) => shows(ref) && own(ref)))) problems.push(`${at}: needs at least one look or measure observation${whose} that shows it`);
  });
  return problems;
}

const shapeContext = (context: InstrumentContext): ShapeContext => ({ criterion: context.criterion, pageLabels: context.pageLabels, refProblem: (ref) => refProblem(ref, context) });

/** The verdict of the judge who works with instruments: the shape every verdict has, tied to the observation log. */
export function validateJudgeVerdict(input: unknown, context: JudgeContext): string[] {
  const problems = validateShape(input, shapeContext(context));
  if (input === null || typeof input !== "object") return problems;
  const verdict = input as Partial<Verdict>;
  if (verdict.verification !== undefined) problems.push("verification belongs in the verdict of the verifier, not of the judge");
  return [...problems, ...instrumentRules(verdict, context, context.session ?? null, "judge")];
}

/** Outcomes the verifier may reach from what the judge said. It never turns a failure into a pass; an open question it may settle either way. */
export const VERIFIED_OUTCOMES: Record<Outcome, Outcome[]> = {
  passed: ["passed", "failed", "cantTell"],
  inapplicable: ["inapplicable", "failed", "cantTell"],
  failed: ["failed", "cantTell"],
  cantTell: ["cantTell", "failed", "passed"],
};

/**
 * The final verdict, written by the verifier: every finding of the judge reproduced with
 * the verifier's own observations or dropped with a reason, and every pass attacked.
 */
export function validateVerification(input: unknown, context: VerificationContext): string[] {
  const problems = validateShape(input, shapeContext(context));
  if (input === null || typeof input !== "object") return problems;
  const verdict = input as Partial<Verdict>;
  problems.push(...instrumentRules(verdict, context, context.session));

  const index = context.observations;
  const ownShowing = (ref: unknown): boolean => {
    if (typeof ref !== "string" || sessionOfObservation(ref) !== context.session) return false;
    const observation = index.get(ref);
    return !!observation && SHOWING.has(observation.command) && !observation.failed;
  };
  const verification = verdict.verification;
  if (!verification || typeof verification !== "object") return [...problems, "verification: the final verdict must say what happened to every finding of the judge and how the verdict was attacked"];

  const judge = context.judge;
  if (verification.judgeOutcome !== judge.outcome) problems.push(`verification.judgeOutcome must be "${judge.outcome}", the outcome of the judge`);
  const allowed = VERIFIED_OUTCOMES[judge.outcome];
  if (OUTCOMES.includes(verdict.outcome as Outcome) && !allowed.includes(verdict.outcome as Outcome)) problems.push(`the judge said "${judge.outcome}"; the final outcome can only be ${allowed.join(", ")}`);

  const checks = Array.isArray(verification.findings) ? verification.findings : [];
  const finalKeys = new Set((Array.isArray(verdict.findings) ? verdict.findings : []).map((finding) => finding.key));
  const judgeKeys = judge.findings.map((finding, position) => finding.key ?? `F${position + 1}`);
  for (const key of judgeKeys) {
    const at = `verification.findings "${key}"`;
    const matching = checks.filter((check) => check.key === key);
    if (matching.length !== 1) {
      problems.push(`${at}: every finding of the judge needs exactly one entry`);
      continue;
    }
    const check = matching[0]!;
    if (check.reproduced === true) {
      if (!(Array.isArray(check.evidence) && check.evidence.some(ownShowing))) problems.push(`${at}: reproduced needs at least one look or measure observation of session "${context.session}"`);
      if (!finalKeys.has(key)) problems.push(`${at}: a reproduced finding stays in findings with the same key`);
    } else if (check.reproduced === false) {
      if (!DROP_REASONS.includes(check.dropped as (typeof DROP_REASONS)[number])) problems.push(`${at}: dropped must be one of ${DROP_REASONS.join(", ")}`);
      if (!isText(check.reasonNl, 20)) problems.push(`${at}: reasonNl must say why the finding was dropped`);
      if (check.dropped === "wrongCriterion" && !(typeof check.belongsTo === "string" && CRITERION_ID.test(check.belongsTo) && check.belongsTo !== context.criterion)) problems.push(`${at}: belongsTo must name the criterion the finding does belong to`);
      if (finalKeys.has(key)) problems.push(`${at}: a dropped finding cannot stay in findings`);
    } else problems.push(`${at}: reproduced must be true or false`);
  }
  for (const check of checks) if (!judgeKeys.includes(check.key)) problems.push(`verification.findings "${check.key}": the judge has no finding with this key; a finding of your own gets a key "V1" in findings and no entry here`);
  for (const key of finalKeys) if (typeof key === "string" && /^F\d+$/.test(key) && !judgeKeys.includes(key)) problems.push(`findings: "${key}" is not a finding of the judge; a finding of your own gets a key "V1"`);

  if (judge.outcome === "failed" && verdict.outcome === "cantTell" && checks.some((check) => check.reproduced === true)) problems.push('a reproduced finding makes the outcome "failed"');
  // Dropping a finding as notSupported is a reading of the norm. A new "keuze nodig:" next to it
  // hands that reading on to whoever signs the report; the judge's own choices may stay.
  const choices = (points: unknown): number => (Array.isArray(points) ? points.filter((point) => typeof point === "string" && openPoint(point).kind?.prefix === "keuze nodig").length : 0);
  if (judge.outcome === "failed" && verdict.outcome === "cantTell" && checks.some((check) => check.dropped === "notSupported") && choices(verdict.missingNl) > choices(judge.missingNl)) {
    problems.push('a finding dropped as notSupported is your own reading of the norm; a new "keuze nodig:" point next to it hands that reading to whoever signs. Keep the finding, or drop it and name in reasonNl the text of the norm or the procedure that allows it. "keuze nodig:" is only for a choice the norm or the procedure leaves to the owner of the site');
  }
  // A finding the verifier could not see again, or that belongs elsewhere, does not come back as a recommendation at the same place.
  const goneFindings = judge.findings.filter((finding, position) => checks.some((check) => check.key === (finding.key ?? `F${position + 1}`) && (check.dropped === "notReproduced" || check.dropped === "wrongCriterion")));
  const gonePlaces = new Map(goneFindings.flatMap((finding) => placesOf(finding).map((place): [string, string] => [place, finding.key ?? "?"])));
  (Array.isArray(verdict.recommendations) ? verdict.recommendations : []).forEach((entry, position) => {
    const place = placesOf(entry).find((candidate) => gonePlaces.has(candidate));
    if (place) problems.push(`recommendations[${position}]: finding ${gonePlaces.get(place)} of the judge at this place (${place}) was dropped; it does not come back as a recommendation. If it is wrong, keep it as a finding; if it was not seen again, leave it out`);
  });
  if (judge.outcome !== "failed") {
    if (!isText(verification.attackNl, 30)) problems.push(judge.outcome === "cantTell" ? "verification.attackNl: say what you tried to settle what the judge left open" : `verification.attackNl: say what you tried to find a counterexample against "${judge.outcome}"`);
    if (!(Array.isArray(verification.attackEvidence) && verification.attackEvidence.some(ownShowing))) problems.push(`verification.attackEvidence: attacking "${judge.outcome}" needs at least one look or measure observation of session "${context.session}"`);
  }
  else if (isText(verification.attackNl) || (Array.isArray(verification.attackEvidence) && verification.attackEvidence.length > 0)) {
    problems.push(`verification.attackNl and attackEvidence belong to a verdict the judge passed, called inapplicable or left open; after "${judge.outcome}" leave them out and put what you saw in observations`);
  }
  for (const ref of Array.isArray(verification.attackEvidence) ? verification.attackEvidence : []) {
    const problem = typeof ref === "string" ? refProblem(ref, context) : "evidence reference is not text";
    if (problem) problems.push(`verification.attackEvidence: ${problem}`);
  }
  return problems;
}

export interface FinishContext extends InstrumentContext {
  /** The session the finisher worked in: only its own observations settle a point or show a finding. */
  session: string;
  /** The points that stood open, as the task lists them, in that order. */
  openPoints: string[];
}

/**
 * How much more room the finishing round gets than a judge, in commands and in minutes. It has
 * to measure what the sweep left out, in enough places to cover the criterion, so it must not
 * end on its budget the way the round before it did. The one place this number stands: the
 * tasks take their budget from it and the estimate its time per agent.
 */
export const FINISH_FACTOR = 3.5;

/** The kinds of open point a finishing round may still leave: what asks a person or a choice, what only shows after sending in a run that may not send, an instrument that did not work after a real attempt, and a part of the site that did not load on repeated tries. */
export const KINDS_AFTER_FINISH = ["mens nodig", "keuze nodig", NOT_SENT, "proef werkte niet", UNREACHABLE] as const;
/** A real attempt is more than one try: at least this many observations of the finisher's own session. */
export const MIN_ATTEMPT_OBSERVATIONS = 2;

const observationNumber = (id: string): number => Number(/-(\d+)$/.exec(id)?.[1] ?? Number.NaN);

/**
 * The verdict of the finishing round: a verdict of its own, tied to the observation log like
 * that of a judge, that settles what the evaluation itself left open. It may not hand the
 * question back: a point about coverage or budget is refused, an instrument that did not work
 * needs the attempt, and a finding is shown twice, the second time from a fresh page, because
 * no verifier comes after it.
 */
export function validateFinish(input: unknown, context: FinishContext): string[] {
  const problems = validateShape(input, shapeContext(context));
  if (input === null || typeof input !== "object") return problems;
  const verdict = input as Partial<Verdict>;
  if (verdict.verification !== undefined) problems.push("verification belongs in the verdict of the verifier; the finishing round writes finish");
  if (verdict.nothingFound !== undefined) problems.push("nothingFound says that not everything was measured; the finishing round measures it and leaves the field out");
  problems.push(...instrumentRules(verdict, context, context.session, "finisher"));

  const index = context.observations;
  const own = (ref: unknown): ref is string => typeof ref === "string" && sessionOfObservation(ref) === context.session && index.has(ref);
  const ownShowing = (ref: unknown): ref is string => own(ref) && SHOWING.has(index.get(ref)!.command) && !index.get(ref)!.failed;
  const refs = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const checkRefs = (value: unknown, at: string): void => {
    for (const ref of refs(value)) {
      const problem = typeof ref === "string" ? refProblem(ref, context) : "evidence reference is not text";
      if (problem) problems.push(`${at}: ${problem}`);
    }
  };

  // What may stay open, and what may not.
  const missing = (Array.isArray(verdict.missingNl) ? verdict.missingNl : []).filter((point): point is string => typeof point === "string");
  const finish = verdict.finish;
  const attempts = Array.isArray(finish?.attempts) ? finish.attempts : [];
  missing.forEach((point, position) => {
    const kind = openPoint(point).kind;
    if (!kind) return; // the rules every verdict has already say so
    if (!(KINDS_AFTER_FINISH as readonly string[]).includes(kind.prefix)) {
      problems.push(`missingNl[${position}]: "${kind.prefix}:" cannot stay after the finishing round. This round exists to measure what was missing, with a budget of its own: measure it, and decide. Only ${KINDS_AFTER_FINISH.map((prefix) => `"${prefix}:"`).join(", ")} may stay`);
    } else if (KINDS_WITH_ATTEMPT.includes(kind.prefix) && attempts.filter((entry) => entry?.missing === position + 1).length !== 1) {
      problems.push(`missingNl[${position}]: ${kind.prefix === UNREACHABLE ? "a part of the site that did not load" : "an instrument that did not work"} stays open only after a real attempt: give one entry in finish.attempts with "missing": ${position + 1}`);
    }
  });

  if (!finish || typeof finish !== "object") return [...problems, "finish: the verdict of the finishing round says what happened to every point that stood open, what it covers and where every finding was seen twice"];

  attempts.forEach((attempt, position) => {
    const at = `finish.attempts[${position}]`;
    const point = typeof attempt?.missing === "number" ? missing[attempt.missing - 1] : undefined;
    if (point === undefined || !KINDS_WITH_ATTEMPT.includes(openPoint(point).kind?.prefix ?? "")) problems.push(`${at}: "missing" is the place in missingNl (counted from 1) of a point "proef werkte niet:" or "${UNREACHABLE}:"`);
    if (!isText(attempt?.triedNl, 40)) problems.push(`${at}: triedNl says what was tried, in which ways, and what the instrument answered`);
    if (new Set(refs(attempt?.evidence).filter(own)).size < MIN_ATTEMPT_OBSERVATIONS) problems.push(`${at}: a real attempt shows in the observation log: cite at least ${MIN_ATTEMPT_OBSERVATIONS} observations of session "${context.session}" (a command that failed counts), made in more than one way`);
    checkRefs(attempt?.evidence, at);
  });

  // Every point that stood open is accounted for.
  const points = Array.isArray(finish.points) ? finish.points : [];
  context.openPoints.forEach((_text, position) => {
    const at = `finish.points, point ${position + 1}`;
    const entries = points.filter((entry) => entry?.point === position + 1);
    if (entries.length !== 1) return void problems.push(`${at}: every point of the task needs exactly one entry`);
    const entry = entries[0]!;
    if (!isText(entry.howNl, 20)) problems.push(`${at}: howNl says what was measured and where, or why the point stays open`);
    if (entry.settled === true) {
      if (!refs(entry.evidence).some(ownShowing)) problems.push(`${at}: a settled point needs at least one look or measure observation of session "${context.session}"`);
    } else if (entry.settled === false) {
      if (missing.length === 0) problems.push(`${at}: a point that is not settled stands in missingNl, with its kind`);
      if (verdict.outcome === "passed" || verdict.outcome === "inapplicable") problems.push(`${at}: a "${verdict.outcome}" outcome settles every point that stood open`);
    } else problems.push(`${at}: settled must be true or false`);
    checkRefs(entry.evidence, at);
  });
  for (const entry of points) if (!(Number.isInteger(entry?.point) && entry.point >= 1 && entry.point <= context.openPoints.length)) problems.push(`finish.points: the task has no point ${String(entry?.point)}`);

  if (!isText(finish.coverageNl, 20)) problems.push('finish.coverageNl: say where was measured, with counts, such as "gemeten op 18 van de 18 paginatypen, breed en op 320 pixels, en in 5 geopende onderdelen"');

  // No verifier comes after this round: a finding is shown twice, the second time from a fresh page.
  const opens = [...index.entries()].filter(([id, ref]) => sessionOfObservation(id) === context.session && ref.command === "open" && !ref.failed).map(([id]) => observationNumber(id));
  const shown = Array.isArray(finish.findings) ? finish.findings : [];
  const keys = (Array.isArray(verdict.findings) ? verdict.findings : []).map((finding) => finding.key).filter((key): key is string => typeof key === "string");
  for (const key of keys) {
    const at = `finish.findings "${key}"`;
    const entries = shown.filter((entry) => entry?.key === key);
    if (entries.length !== 1) {
      problems.push(`${at}: every finding needs exactly one entry, with the observations that showed it first and the ones that showed it again`);
      continue;
    }
    const first = refs(entries[0]!.first).filter(ownShowing);
    const repeated = refs(entries[0]!.repeated).filter(ownShowing);
    if (first.length === 0) problems.push(`${at}: first needs a look or measure observation of session "${context.session}"`);
    if (repeated.length === 0) problems.push(`${at}: repeated needs a look or measure observation of session "${context.session}"`);
    // Seen again means: after a fresh `open`. What is read from a stored file has no page to open, and is read a second time.
    const again = repeated.some((later) =>
      first.some((earlier) => {
        const [from, to] = [observationNumber(earlier), observationNumber(later)];
        if (!(from < to)) return false;
        const stateless = STATELESS_COMMANDS.has(index.get(earlier)!.command) && STATELESS_COMMANDS.has(index.get(later)!.command);
        return stateless || opens.some((open) => from < open && open < to);
      }),
    );
    if (first.length > 0 && repeated.length > 0 && !again) problems.push(`${at}: the finding has to be seen again from a fresh page: an observation in repeated that was made after a new "open" that came after an observation in first. Nobody verifies this verdict, so one sighting is not enough`);
    checkRefs(entries[0]!.first, at);
    checkRefs(entries[0]!.repeated, at);
  }
  for (const entry of shown) if (!keys.includes(entry?.key)) problems.push(`finish.findings "${String(entry?.key)}": there is no finding with this key`);
  return problems;
}

/** One lead of the walk-through: something an auditor would notice. Not a finding. */
export interface Candidate {
  id: string;
  criterion: string;
  page: string;
  where: string;
  evidence: string[];
  noteNl: string;
  /** How strong the support is, so the judge knows what to measure again. */
  support: (typeof CANDIDATE_SUPPORT)[number];
}

/**
 * gemeten: an instrument measured it; bekeken: looked at closely (crop, code, tree);
 * afgeleid: inferred, for example from something missing in a list or from a partial measurement;
 * alleen beeld: seen on a screenshot only.
 */
export const CANDIDATE_SUPPORT = ["gemeten", "bekeken", "afgeleid", "alleen beeld"] as const;

export interface CandidateList {
  pageType: string;
  page: string;
  /** The states the page was walked in, each with the observation of the look that opened it. */
  states: { nameNl: string; evidence: string[] }[];
  candidates: Candidate[];
  /** What could not be walked, with the reason. */
  notWalkedNl: string[];
}

export interface CandidateContext {
  pageType: string;
  pageLabels: string[];
  /** Ids of the criteria that have a procedure. */
  criteria: string[];
  /** Every candidate id starts with this, so ids are unique in a run (for example the page label). */
  idPrefix: string;
  observations: ObservationIndex;
}

const MAX_CANDIDATE_WORDS = 40;

export function validateCandidates(input: unknown, context: CandidateContext): string[] {
  if (input === null || typeof input !== "object") return ["the candidate list is not a JSON object"];
  const list = input as Partial<CandidateList>;
  const problems: string[] = [];
  const index = context.observations;
  const showing = (refs: unknown): boolean => Array.isArray(refs) && refs.some((ref) => typeof ref === "string" && index.has(ref) && SHOWING.has(index.get(ref)!.command) && !index.get(ref)!.failed);
  const unknown = (refs: unknown): string[] => (Array.isArray(refs) ? refs.filter((ref) => typeof ref !== "string" || !index.has(ref)).map(String) : []);

  if (list.pageType !== context.pageType) problems.push(`pageType must be "${context.pageType}"`);
  if (!context.pageLabels.includes(list.page as string)) problems.push(`page "${String(list.page)}" is not in the legend`);
  const states = Array.isArray(list.states) ? list.states : [];
  if (states.length === 0) problems.push("states: name at least the state the page was first looked at in");
  states.forEach((state, position) => {
    if (!isText(state.nameNl, 3)) problems.push(`states[${position}]: nameNl is missing`);
    if (!showing(state.evidence)) problems.push(`states[${position}]: a walked state needs an observation of a look or measure command`);
    for (const ref of unknown(state.evidence)) problems.push(`states[${position}]: observation "${ref}" is not in the observation log`);
  });
  if (!Array.isArray(list.candidates)) problems.push("candidates must be a list; it may be empty");
  if (!Array.isArray(list.notWalkedNl)) problems.push("notWalkedNl must be a list; it may be empty");

  const ids = new Set<string>();
  (Array.isArray(list.candidates) ? list.candidates : []).forEach((candidate, position) => {
    const at = `candidates[${position}]`;
    if (typeof candidate.id !== "string" || !candidate.id.startsWith(`${context.idPrefix}-K`) || !/-K\d{2,}$/.test(candidate.id)) problems.push(`${at}: id must look like "${context.idPrefix}-K01"`);
    else if (ids.has(candidate.id)) problems.push(`${at}: id "${candidate.id}" is used twice`);
    ids.add(candidate.id);
    if (!context.criteria.includes(candidate.criterion)) problems.push(`${at}: "${candidate.criterion}" is not a criterion with a procedure`);
    if (!context.pageLabels.includes(candidate.page)) problems.push(`${at}: page "${candidate.page}" is not in the legend`);
    if (!isText(candidate.where, 3)) problems.push(`${at}: where is missing`);
    if (!isText(candidate.noteNl, 10)) problems.push(`${at}: noteNl is missing`);
    else if (candidate.noteNl.trim().split(/\s+/).length > MAX_CANDIDATE_WORDS) problems.push(`${at}: noteNl is one sentence of at most ${MAX_CANDIDATE_WORDS} words`);
    if (!CANDIDATE_SUPPORT.includes(candidate.support)) problems.push(`${at}: support must be one of ${CANDIDATE_SUPPORT.join(", ")}`);
    if (!showing(candidate.evidence)) problems.push(`${at}: a candidate needs at least one observation of a look or measure command that shows it`);
    for (const ref of unknown(candidate.evidence)) problems.push(`${at}: observation "${ref}" is not in the observation log`);
  });
  return problems;
}

/** Every observation id a verdict leans on, sorted: what a stamp binds the verdict to. */
export function citedObservations(verdict: Verdict, observations: ObservationIndex): string[] {
  const refs = [
    ...verdict.observations.flatMap((observation) => observation.evidence),
    ...verdict.findings.flatMap((finding) => finding.evidence),
    ...(verdict.resolved ?? []).flatMap((resolution) => [...resolution.observations, ...resolution.by]),
    ...(verdict.verification?.findings ?? []).flatMap((check) => check.evidence ?? []),
    ...(verdict.verification?.attackEvidence ?? []),
    ...(verdict.finish?.points ?? []).flatMap((point) => point.evidence ?? []),
    ...(verdict.finish?.findings ?? []).flatMap((entry) => [...(entry.first ?? []), ...(entry.repeated ?? [])]),
    ...(verdict.finish?.attempts ?? []).flatMap((attempt) => attempt.evidence ?? []),
  ];
  return [...new Set(refs.filter((ref) => observations.has(ref)))].sort();
}
