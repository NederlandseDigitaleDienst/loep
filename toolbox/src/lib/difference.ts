import { signatureIsCurrent } from "../commands/sign.ts";
import { pageIndex } from "./defects.ts";
import { evaluationHash, madeWith, OUTCOME_LABEL, type CriterionOutcome, type CriterionResult, type Evaluation, type ReportFinding } from "./evaluation.ts";

/**
 * Two evaluations of the same site side by side: what was found then and not now, what
 * stayed and what is new. Findings are linked by criterion, page and place, never by their
 * title: the wording comes from a language model and differs from run to run.
 *
 * The result is a working document for whoever repairs the site. It is not part of the
 * report: an earlier evaluation is often a concept nobody published, and a reader of the
 * report cannot look at it.
 */

const STOPWORDS = new Set(["de", "het", "een", "en", "van", "in", "op", "is", "zijn", "met", "voor", "niet", "geen", "te", "bij", "als", "die", "dat", "naar", "om", "aan", "nth", "type"]);

/** With a page in common a looser match of the place is enough than without one. */
export const SAME_PLACE_ON_SHARED_PAGE = 0.35;
/** Without a page in common only a part that returns on many pages can be the same place, so its description has to match firmly. */
export const SAME_PLACE_ELSEWHERE = 0.5;

/** One evaluation as the comparison reads it: its findings, and the address behind every page label. */
export interface Side {
  criteria: CriterionResult[];
  /** The address of a page label; a label without an address stands for itself. */
  urlOf: (label: string) => string;
}

const address = (url: string): string => url.replace(/#.*$/, "").replace(/\/+$/, "");

export function sideOf(evaluation: Evaluation): Side {
  const { labels } = pageIndex(evaluation);
  const urls = new Map<string, string>(evaluation.sample.items.map((item, index): [string, string] => [labels[index]!, address(item.url)]));
  for (const item of evaluation.documents?.items ?? []) urls.set(item.label, address(item.url));
  return { criteria: evaluation.criteria, urlOf: (label) => urls.get(label) ?? label };
}

interface Signature {
  finding: ReportFinding;
  pages: Set<string>;
  words: Set<string>;
}

/** The words that say where a finding is: its component, its places in words and selectors, and the elements it was measured on. Not its title. */
function placeOf(finding: ReportFinding, side: Side): Signature {
  const text = [finding.component ?? "", ...finding.locations.flatMap((location) => [location.where, location.heading ?? "", location.text ?? ""]), ...(finding.targets ?? []).map((target) => target.path.at(-1) ?? "")].join(" ").toLowerCase();
  const words = text.split(/[^a-z0-9à-ÿ]+/).filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  return { finding, pages: new Set(finding.locations.map((location) => side.urlOf(location.page))), words: new Set(words) };
}

/**
 * Link the findings of two evaluations: the same criterion, and a place described in the
 * same words. A word most findings share (the prefix of a design system, "content") says
 * little about the place, so every word weighs by how rare it is. The score is the shared
 * weight as a share of the shorter description: one evaluation may describe the same place
 * at much greater length than the other.
 */
export function matchFindings(current: Side, previous: Side): Map<ReportFinding, ReportFinding> {
  const now = current.criteria.flatMap((criterion) => criterion.findings).map((finding) => placeOf(finding, current));
  const then = previous.criteria.flatMap((criterion) => criterion.findings).map((finding) => placeOf(finding, previous));
  const all = [...now, ...then];
  const frequency = new Map<string, number>();
  for (const signature of all) for (const word of signature.words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const weight = (words: Iterable<string>): number => [...words].reduce((total, word) => total + Math.log(1 + all.length / frequency.get(word)!), 0);

  const candidates: { a: Signature; b: Signature; score: number }[] = [];
  for (const a of now) {
    for (const b of then) {
      if (a.finding.criterion !== b.finding.criterion) continue;
      const smaller = Math.min(weight(a.words), weight(b.words));
      if (smaller === 0) continue;
      const score = weight([...a.words].filter((word) => b.words.has(word))) / smaller;
      const sharedPage = [...a.pages].some((page) => b.pages.has(page));
      if (score >= (sharedPage ? SAME_PLACE_ON_SHARED_PAGE : SAME_PLACE_ELSEWHERE)) candidates.push({ a, b, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.a.finding.id.localeCompare(y.a.finding.id) || x.b.finding.id.localeCompare(y.b.finding.id));
  const matches = new Map<ReportFinding, ReportFinding>();
  const taken = new Set<ReportFinding>();
  for (const { a, b } of candidates) {
    if (matches.has(a.finding) || taken.has(b.finding)) continue;
    matches.set(a.finding, b.finding);
    taken.add(b.finding);
  }
  return matches;
}

/** Whether the other evaluation looked at the place of a finding, as far as the two evaluations say. */
export type Examined = "examined" | "notExamined" | "unknown";

export interface DifferenceItem {
  id: string;
  criterion: string;
  titleNl: string;
  severity: string;
  /** Page labels of the evaluation the finding is from. */
  pages: string[];
  /** The defect the finding belongs to in its own evaluation; null when that evaluation has no defects. */
  defectId: string | null;
  /** For a finding that stayed: its identifier in the previous evaluation. */
  previousId?: string;
  /** For a new finding: whether the place was examined then. For one that is gone: whether it was examined now. */
  examined?: Examined;
  examinedNl?: string;
}

export interface DifferenceSide {
  sha256: string;
  /** The toolbox that made the evaluation, with version and commit. */
  madeWithNl: string;
  evaluatedAt: string;
  /** Signed, with a signature that belongs to exactly this evaluation. */
  signed: boolean;
  signedAt: string | null;
  pages: number;
  findings: number;
  /** Null for an evaluation from before findings were grouped into defects. */
  defects: number | null;
}

export interface Difference {
  site: { name: string; baseUrl: string };
  previous: DifferenceSide;
  current: DifferenceSide;
  /** Criteria whose outcome changed. */
  outcomes: { criterion: string; titleNl: string; before: CriterionOutcome; after: CriterionOutcome }[];
  resolved: DifferenceItem[];
  remained: DifferenceItem[];
  fresh: DifferenceItem[];
  /** Defects counted from their findings: gone when every finding is gone, new when every finding is new. Null where an evaluation has no defects. */
  defects: { resolved: number | null; remained: number | null; fresh: number | null };
  pagesOnlyThen: string[];
  pagesOnlyNow: string[];
  /** What the comparison cannot say. */
  limitsNl: string[];
}

function describe(evaluation: Evaluation): DifferenceSide {
  const signed = signatureIsCurrent(evaluation);
  return {
    sha256: evaluationHash(evaluation),
    madeWithNl: madeWith(evaluation, true),
    evaluatedAt: evaluation.evaluatedAt,
    signed,
    signedAt: signed ? evaluation.signature!.signedAt : null,
    pages: evaluation.sample.items.length,
    findings: evaluation.criteria.reduce((total, criterion) => total + criterion.findings.length, 0),
    defects: evaluation.defects ? evaluation.defects.length : null,
  };
}

const JUDGED: CriterionOutcome[] = ["passed", "failed", "inapplicable"];

/** Whether the other evaluation looked at the place of this finding. */
function examinedIn(finding: ReportFinding, own: Evaluation, ownSide: Side, other: Evaluation, when: "toen" | "nu"): { examined: Examined; examinedNl: string } {
  const otherLabels = pageIndex(other).labels;
  const otherPages = new Map<string, string>(other.sample.items.flatMap((item, index) => [item.url, ...item.aliases].map((url): [string, string] => [address(url), otherLabels[index]!])));
  for (const item of other.documents?.items ?? []) otherPages.set(address(item.url), item.label);
  const shared = [...new Set(finding.locations.map((location) => ownSide.urlOf(location.page)))].filter((url) => otherPages.has(url));
  if (shared.length === 0) return { examined: "notExamined", examinedNl: `de pagina zat ${when} niet in de steekproef` };
  const outcome = other.criteria.find((criterion) => criterion.id === finding.criterion)?.outcome ?? "untested";
  if (!JUDGED.includes(outcome)) return { examined: "notExamined", examinedNl: `over dit criterium is ${when} geen oordeel gegeven (${OUTCOME_LABEL[outcome].toLowerCase()})` };
  // A place that only shows after something is opened: named by a state of the site model, or measured only after steps.
  const known = new Set(Object.values(own.measuredStates ?? {}).flat());
  const named = [...known].filter((state) => finding.locations.some((location) => location.where.includes(state)));
  const targets = finding.targets ?? [];
  const afterSteps = named.length > 0 || (targets.length > 0 && targets.every((target) => target.state !== null));
  if (afterSteps) {
    const measured = other.measuredStates;
    if (measured && named.length > 0) {
      const there = named.some((state) => shared.some((url) => measured[otherPages.get(url)!]?.includes(state)));
      return there ? { examined: "examined", examinedNl: `de pagina en de geopende toestand zijn ${when} ook gemeten` } : { examined: "notExamined", examinedNl: `de geopende toestand is ${when} niet gemeten` };
    }
    return { examined: "unknown", examinedNl: `de plek komt pas in beeld na een handeling (een venster, een menu, een ingevuld formulier); de andere evaluatie zegt niet of dat ${when} is geopend` };
  }
  if (targets.length === 0 && !own.chain) return { examined: "examined", examinedNl: `de pagina is ${when} ook onderzocht en het criterium is ${when} beoordeeld` };
  if (targets.length === 0) return { examined: "unknown", examinedNl: "de evaluatie legt niet vast op welk element de bevinding is gemeten" };
  return { examined: "examined", examinedNl: `de pagina is ${when} ook onderzocht en het criterium is ${when} beoordeeld` };
}

export function compareEvaluations(previous: Evaluation, current: Evaluation): Difference {
  const [then, now] = [sideOf(previous), sideOf(current)];
  const matches = matchFindings(now, then);
  const matchedThen = new Set(matches.values());
  const defectOf = (evaluation: Evaluation, id: string): string | null => evaluation.defects?.find((defect) => defect.findingIds.includes(id))?.id ?? null;
  const item = (finding: ReportFinding, evaluation: Evaluation): DifferenceItem => ({
    id: finding.id,
    criterion: finding.criterion,
    titleNl: finding.titleNl,
    severity: finding.severity,
    pages: [...new Set(finding.locations.map((location) => location.page))],
    defectId: defectOf(evaluation, finding.id),
  });
  const findingsNow = current.criteria.flatMap((criterion) => criterion.findings);
  const findingsThen = previous.criteria.flatMap((criterion) => criterion.findings);
  const remained = findingsNow.filter((finding) => matches.has(finding)).map((finding) => ({ ...item(finding, current), previousId: matches.get(finding)!.id }));
  const fresh = findingsNow.filter((finding) => !matches.has(finding)).map((finding) => ({ ...item(finding, current), ...examinedIn(finding, current, now, previous, "toen") }));
  const resolved = findingsThen.filter((finding) => !matchedThen.has(finding)).map((finding) => ({ ...item(finding, previous), ...examinedIn(finding, previous, then, current, "nu") }));

  const count = (evaluation: Evaluation, ids: Set<string>, mode: "every" | "some"): number | null => (evaluation.defects ? evaluation.defects.filter((defect) => defect.findingIds[mode]((id) => ids.has(id))).length : null);
  const pagesOf = (evaluation: Evaluation): Map<string, string> => new Map(evaluation.sample.items.map((item): [string, string] => [address(item.url), item.url]));
  const [urlsThen, urlsNow] = [pagesOf(previous), pagesOf(current)];
  const aliasesOf = (evaluation: Evaluation): Set<string> => new Set(evaluation.sample.items.flatMap((entry) => [entry.url, ...entry.aliases].map(address)));
  const [knownThen, knownNow] = [aliasesOf(previous), aliasesOf(current)];

  const limits = [
    "Bevindingen zijn gekoppeld op criterium, pagina en plek, niet op de titel. Een gebrek dat nu onder een ander criterium is gemeld, of waarvan de plek heel anders is beschreven, staat daardoor als opgelost en ook als nieuw.",
    "\"Opgelost\" betekent: toen gevonden en nu niet meer. Dat kan ook komen doordat deze meting het niet opnieuw zag. \"Nieuw\" betekent: nu gevonden en toen niet. Of het gebrek toen al op de site stond, is uit twee evaluaties niet op te maken; wel of de plek toen is onderzocht.",
    ...(previous.defects && current.defects ? [] : [`${previous.defects ? "De nieuwe" : current.defects ? "De vorige" : "Geen van beide"} evaluatie${previous.defects || current.defects ? " kent" : "s kent"} geen gebreken (bevindingen die bij elkaar horen). Daarom is op bevindingen vergeleken.`]),
    ...(previous.chain?.kind === current.chain?.kind ? [] : ["De twee evaluaties zijn met een andere werkwijze gemaakt. De vorige legt niet vast op welk element een bevinding is gemeten en welke vensters en menu's zijn geopend; waar dat nodig was om te zeggen of een plek toen is onderzocht, staat \"niet te bepalen\"."]),
  ];

  return {
    site: { name: current.site.name, baseUrl: current.site.baseUrl },
    previous: describe(previous),
    current: describe(current),
    outcomes: current.criteria.flatMap((criterion) => {
      const before = previous.criteria.find((entry) => entry.id === criterion.id)?.outcome ?? "untested";
      return before === criterion.outcome ? [] : [{ criterion: criterion.id, titleNl: criterion.titleNl, before, after: criterion.outcome }];
    }),
    resolved,
    remained,
    fresh,
    defects: {
      resolved: count(previous, new Set(resolved.map((entry) => entry.id)), "every"),
      remained: count(current, new Set(remained.map((entry) => entry.id)), "some"),
      fresh: count(current, new Set(fresh.map((entry) => entry.id)), "every"),
    },
    pagesOnlyThen: [...urlsThen].filter(([url]) => !knownNow.has(url)).map(([, url]) => url),
    pagesOnlyNow: [...urlsNow].filter(([url]) => !knownThen.has(url)).map(([, url]) => url),
    limitsNl: limits,
  };
}
