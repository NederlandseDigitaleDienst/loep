import { pageLabels, stableId } from "./canonical.ts";
import type { Evaluation, ReportFinding } from "./evaluation.ts";
import { compareCriterionIds } from "./wcag.ts";

/**
 * One defect, one entry. The judgment is made per criterion, so one thing that is wrong on
 * a page comes back as a finding under every criterion it breaks. A defect is one place on
 * the site that has to be repaired; it points at every finding about that place. Findings
 * are never removed or rewritten here: the outcome per criterion stays what it was.
 */

export const MERGE_RULES_VERSION = 3;

export type MergeBasis = "duplicate" | "measurement" | "cause" | "element" | "component" | "proposal";

export interface Defect {
  /** Stable across re-evaluations as long as most of its findings stay together. */
  id: string;
  /** Title of the main finding: the defect as the worklist names it. */
  titleNl: string;
  mainCriterion: string;
  mainFindingId: string;
  /** The other criteria the defect breaks, in WCAG order: "raakt ook". */
  alsoCriteria: string[];
  /** The main finding first, then the others in WCAG order. */
  findingIds: string[];
  /** Page labels at which its findings point at a place, in sample order. Not read from the free text about affected pages. */
  pages: string[];
  /** A finding says the defect is on more pages than it points at; which ones is in the finding. */
  morePages: boolean;
  component: string | null;
  /** The element all its findings point at, when they name one in the same words. */
  element: string | null;
  /** The highest severity among its findings. */
  severity: ReportFinding["severity"];
  /** Who repairs the cause: the owner of the main finding. */
  owner: ReportFinding["owner"];
  /** Which rules joined the findings; empty for a defect with one finding. */
  mergedBy: MergeBasis[];
  /** Why the main criterion differs from the fixed precedence; only after a proposal. */
  mainReasonNl: string | null;
}

export interface MergeRecord {
  rulesVersion: number;
  /** The optional second step, in which a language model proposes what else belongs together. */
  proposal: { status: "not-run" } | { status: "applied"; templateSha256: string; proposalSha256: string; joined: number; mainOverridden: number };
}

export interface MergeProposal {
  defects: { findings: string[]; mainCriterion: string; reasonNl?: string }[];
}

// ---------------------------------------------------------------- places

const HTML_TAGS = new Set(
  "a abbr article aside audio b body button canvas details dialog div dl dt dd em fieldset figure figcaption footer form h1 h2 h3 h4 h5 h6 header html i iframe img input label legend li main nav ol option p picture section select small span strong summary svg table tbody td textarea th thead tr ul video".split(" "),
);
const QUALIFIER = String.raw`(?:#[\w-]+|\.[\w-]+|\[[^\]\s]+\]|:nth-(?:of-type|child)\(\d+\))`;
const SEGMENT = new RegExp(String.raw`^(?:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)${QUALIFIER}*|${QUALIFIER}+)$`, "i");
const CUSTOM_ELEMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/i;
const STRONG = /[#.[]|:nth-/;
/** Words after which a selector names the surroundings, not the element itself: "onder het zoekveld #search". */
const LANDMARK_WORDS = new Set(["in", "onder", "boven", "naast", "na", "binnen", "bij", "van", "voor", "achter", "tussen", "rond", "om", "op", "uit"]);
const FILE = /^[\w%-][\w%.-]*\.(?:png|jpe?g|webp|gif|svg|avif|pdf)$/i;
const SIBLING = /^[a-z][a-z0-9]*:nth-(?:of-type|child)\(\d+\)$/;
const RANGE_LIMIT = 50;

const squash = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();
/** ">" for a child, ">>>" for what lies inside a shadow root. */
const isJoin = (text: string | undefined): boolean => text === ">" || text === ">>>";

function normaliseSegment(segment: string): string {
  const lower = segment.toLowerCase();
  // An id identifies the element on its own: "input#search" and "#search" are the same place.
  const id = /#[\w-]+/.exec(lower);
  if (id) return `${id[0]}${lower.slice(id.index + id[0].length)}`;
  const tag = /^[a-z][a-z0-9-]*/.exec(lower)?.[0] ?? "";
  const rest = lower.slice(tag.length);
  const classes = (rest.match(/\.[\w-]+/g) ?? []).sort().join("");
  return `${tag}${classes}${rest.replace(/\.[\w-]+/g, "")}`;
}

interface Token {
  text: string;
  /** Opens a bracket or a quotation: what came before does not run on into it. */
  starts: boolean;
  opens: boolean;
  /** Closes a bracket that was opened in the prose, not one of the selector itself. */
  closes: boolean;
  /** Followed by punctuation: what comes after is a next item. */
  ends: boolean;
}

function tokenise(where: string): Token[] {
  return where
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const stripped = raw.replace(/^[("'‘“]+/, "");
      const trailing = /[,;:.!?'"’”]+$/;
      let text = stripped.replace(trailing, "");
      let closes = false;
      // A closing bracket belongs to the selector when it closes one of its own: ":nth-of-type(3)".
      while (text.endsWith(")") && (text.match(/\(/g) ?? []).length < (text.match(/\)/g) ?? []).length) {
        text = text.slice(0, -1).replace(trailing, "");
        closes = true;
      }
      return { text, starts: raw !== stripped, opens: raw.startsWith("("), closes, ends: !closes && text !== stripped };
    });
}

/** A bare word is a selector only when it is an HTML tag, or a custom element written next to a ">". */
const isSegment = (text: string, joined = false): boolean => SEGMENT.test(text) && (STRONG.test(text) || HTML_TAGS.has(text.toLowerCase()) || (joined && CUSTOM_ELEMENT.test(text)));
const isStrong = (text: string): boolean => SEGMENT.test(text) && STRONG.test(text);

/** "#choice_6_5_1 tot en met #choice_6_5_5" names every element in between. */
function expandRange(from: string, to: string): string[] {
  const [left, right] = [/^(.*?)(\d+)$/.exec(from), /^(.*?)(\d+)$/.exec(to)];
  if (!left || !right || left[1] !== right[1]) return [from, to];
  const [start, end] = [Number(left[2]), Number(right[2])];
  if (end <= start || end - start > RANGE_LIMIT) return [from, to];
  return Array.from({ length: end - start + 1 }, (_unused, index) => `${left[1]}${start + index}`);
}

/**
 * The elements a description of a place names, each as the set of selectors written for
 * it. A judge writes the place in free text, so this reads what is certain and leaves the
 * rest: a chain of segments joined by ">" or a space, a single segment with an id, class
 * or attribute, and the name of an image file. A selector in brackets right after another
 * is a second way of writing the same element; selectors in a list are separate elements.
 * A selector that only says where to look ("onder #search") is not the place and is left out.
 */
export function parseTargets(where: string): string[][] {
  const tokens = tokenise(where);
  const targets: string[][] = [];
  const all: string[] = [];
  let current: string[] | null = null;
  // Whether a list separator came by since the last selector, and whether we are in brackets that rename it.
  let separated = true;
  let renaming = false;
  const add = (keys: string[], alias: boolean): void => {
    if (alias && current) current.push(...keys.filter((key) => !current!.includes(key)));
    else for (const key of keys) targets.push((current = [key]));
    all.push(...keys);
    separated = false;
  };

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.opens) renaming = current !== null && !separated;
    const file = FILE.test(token.text);
    const chainStart = isStrong(token.text) || (isSegment(token.text, true) && isJoin(tokens[index + 1]?.text) && !token.ends && !token.closes);
    if (!file && !chainStart) {
      if (!renaming && (token.ends || /^(en|of)$/i.test(token.text))) separated = true;
      if (token.closes) renaming = false;
      index++;
      continue;
    }
    // A preposition shortly before it makes the selector a landmark, unless a bracket or punctuation set it apart.
    let landmark = false;
    for (let back = 1; back <= 3 && !token.starts && !file; back++) {
      const earlier = tokens[index - back];
      if (!earlier || earlier.ends || earlier.closes || isJoin(earlier.text)) break;
      if (LANDMARK_WORDS.has(earlier.text.toLowerCase())) landmark = true;
      if (landmark || earlier.starts) break;
    }
    const segments = [token.text];
    const joins: string[] = [];
    let last = token;
    let next = index + 1;
    while (!file && !last.ends && !last.closes) {
      const child = isJoin(tokens[next]?.text) && tokens[next + 1] && isSegment(tokens[next + 1]!.text, true) && !tokens[next + 1]!.starts;
      const descendant = tokens[next] && isSegment(tokens[next]!.text) && !tokens[next]!.starts;
      if (!child && !descendant) break;
      last = tokens[child ? next + 1 : next]!;
      // What lies inside a shadow root is still inside: the chain reads the same either way.
      joins.push(child ? " > " : " ");
      segments.push(last.text);
      next += child ? 2 : 1;
    }
    index = next;
    let keys = [file ? `file:${token.text.toLowerCase()}` : segments.map(normaliseSegment).reduce((chain, segment, position) => `${chain}${joins[position - 1]}${segment}`)];
    if (segments.length === 1 && SIBLING.test(keys[0]!)) {
      // "... > li:nth-of-type(1), li:nth-of-type(2)": the next one in the same row. On its own it says nothing.
      const chain = [...all].reverse().find((earlier) => earlier.includes(" > ") && earlier.slice(earlier.lastIndexOf(" > ") + 3).replace(/\d+/, "") === keys[0]!.replace(/\d+/, ""));
      keys = chain ? [`${chain.slice(0, chain.lastIndexOf(" > ") + 3)}${keys[0]}`] : [];
    } else if (!file && !segments.some((segment) => STRONG.test(segment))) keys = [];
    // A range of ids: this one "tot en met" the next.
    const rangeEnd = !last.ends && !last.closes && segments.length === 1 && /^(tot|t\/m)$/i.test(tokens[index]?.text ?? "") ? tokens.slice(index + 1, index + 4).find((candidate) => isStrong(candidate.text)) : undefined;
    if (rangeEnd && keys.length > 0) {
      keys = expandRange(keys[0]!, normaliseSegment(rangeEnd.text));
      last = rangeEnd;
      index = tokens.indexOf(rangeEnd) + 1;
    }
    // A frame holds another document. A finding that names it may be about the element or about what plays inside it.
    const frame = !file && keys.length === 1 && /^i?frame(?![a-z0-9-])/i.test(segments.at(-1)!);
    if (!landmark && keys.length > 0) add(keys, renaming);
    if (!landmark && frame) targets.at(-1)!.push(`frame:${keys[0]}`);
    if (last.ends) separated = true;
    if (last.closes) renaming = false;
  }
  return targets;
}

/** One element a finding is about: the ways it is written, and the pages it is named on. */
const isFrame = (target: { keys: string[] }): boolean => target.keys.some((key) => key.startsWith("frame:"));

interface Target {
  keys: string[];
  pages: string[];
  /** Named in prose only: it can match the same words on the same page, nothing else. */
  prose: boolean;
}

/** Scheme and window size are how something was measured, not where it is. */
const MEASURED_IN = /\(?\b(?:in het |in |bij )?(?:lichte?|donkere?|light|dark)(?: kleurenschema| schema| modus| thema)?\b\)?|\b\d{3,4}\s?(?:px|pixels?)(?: breed)?\b|\b(?:smal|breed) scherm\b/gi;
const withoutMeasuredIn = (text: string): string => squash(text.replace(MEASURED_IN, " ").replace(/\(\s*\)/g, " "));

const segmentsOf = (key: string): string[] => key.split(/ > | /);

/**
 * A segment written as the pattern of another: "div" for any "div:nth-of-type(n)", as a
 * judge writes a row of the same elements, and "div.play" for "div.icon.play".
 */
function covers(pattern: string, segment: string): boolean {
  if (pattern === segment || segment.startsWith(`${pattern}:nth-`)) return true;
  const parse = (text: string): { tag: string; classes: string[]; rest: string } | null => {
    const match = /^([a-z][a-z0-9-]*)?((?:\.[\w-]+)*)(.*)$/.exec(text);
    return match ? { tag: match[1] ?? "", classes: match[2]!.split(".").filter(Boolean), rest: match[3]! } : null;
  };
  const [left, right] = [parse(pattern), parse(segment)];
  if (!left || !right || left.classes.length === 0 || left.rest !== right.rest) return false;
  return (left.tag === "" || left.tag === right.tag) && left.classes.every((name) => right.classes.includes(name));
}

/** The same selector, or one written as the pattern of the other. */
function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^(file|path|text|frame):/.test(a) || /^(file|path|text|frame):/.test(b) || a.replace(/[^ >]+/g, "") !== b.replace(/[^ >]+/g, "")) return false;
  const [left, right] = [segmentsOf(a), segmentsOf(b)];
  return left.every((segment, index) => covers(segment, right[index]!)) || right.every((segment, index) => covers(segment, left[index]!));
}

/**
 * Where a finding points. With observations of the session the place is the element's own
 * selector chain and nothing has to be read from prose; until then it is read from `where`.
 * The same element named on three pages is one target with three pages.
 */
function targetsOf(finding: ReportFinding): Target[] {
  const named: { keys: string[]; page: string; prose: boolean }[] = [];
  if (finding.targets && finding.targets.length > 0) {
    for (const target of finding.targets) named.push({ keys: [`path:${target.path.join(" >>> ")}`, ...(target.path.length === 1 ? parseTargets(target.path[0]!).flat() : [])], page: target.page, prose: false });
  } else {
    for (const location of finding.locations) {
      const parsed = parseTargets(location.where);
      for (const keys of parsed) named.push({ keys, page: location.page, prose: false });
      if (parsed.length === 0) named.push({ keys: [`text:${location.page}:${withoutMeasuredIn(location.where)}`], page: location.page, prose: true });
    }
  }
  const targets: Target[] = [];
  for (const entry of named) {
    const known = targets.find((target) => target.keys.some((key) => entry.keys.some((other) => sameKey(key, other))));
    if (!known) targets.push({ keys: [...entry.keys], pages: [entry.page], prose: entry.prose });
    else {
      known.keys.push(...entry.keys.filter((key) => !known.keys.includes(key)));
      if (!known.pages.includes(entry.page)) known.pages.push(entry.page);
    }
  }
  return targets;
}

const rooted = (key: string): boolean => key.startsWith("#");

/**
 * Two selectors that may well be about the same element although the text differs: one
 * lies inside the other, one is the pattern of the other, or one is the tail of the other
 * written without its beginning.
 */
function related(a: string, b: string): boolean {
  if (sameKey(a, b)) return true;
  if (/^(file|path|text|frame):/.test(a) || /^(file|path|text|frame):/.test(b)) return false;
  const [left, right] = [segmentsOf(a), segmentsOf(b)];
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.every((segment, index) => covers(segment, long[index]!) || covers(long[index]!, segment))) return true;
  for (const [loose, other] of [[a, b], [b, a]] as const) {
    if (rooted(loose)) continue;
    const [part, whole] = [segmentsOf(loose), segmentsOf(other)];
    // The loose chain occurs somewhere inside the other, or starts where the other ends.
    for (let start = 0; start < whole.length; start++) {
      const overlap = Math.min(part.length, whole.length - start);
      if (overlap >= Math.min(2, part.length) && part.slice(0, overlap).every((segment, index) => segment === whole[start + index])) return true;
    }
  }
  return false;
}

/** The page labels of an evaluation, and which of them are pages of the site itself. */
export interface PageIndex {
  labels: string[];
  /** Without the embedded windows of other parties, which "alle pagina's" never means. */
  own: string[];
}

/** Page labels a finding names: where it points, and what it lists as affected. */
export function pagesOf(finding: ReportFinding, index: PageIndex): string[] {
  const { labels } = index;
  const pages = new Set(finding.locations.map((location) => location.page));
  // "alle behalve P15" and "niet de ingesloten video P15" name P15 to leave it out.
  const except = /\b(?:behalve|niet)\b[^;,.()]*?((?:P\d+(?:, | en )?)+)/.exec(finding.pagesAffected);
  const excluded = new Set(except?.[1]!.match(/P\d+/g) ?? []);
  const text = finding.pagesAffected.replace(except?.[0] ?? "", "");
  for (const range of text.matchAll(/\b(P\d+) (?:tot en met|t\/m) (P\d+)\b/g)) {
    const [from, to] = [labels.indexOf(range[1]!), labels.indexOf(range[2]!)];
    if (from >= 0 && to >= from) for (const label of labels.slice(from, to + 1)) pages.add(label);
  }
  for (const label of text.match(/\bP\d+\b/g) ?? []) pages.add(label);
  if (/\balle\b/i.test(text)) {
    const count = Number(/\d+/.exec(text)?.[0]);
    for (const label of count === labels.length ? labels : index.own) if (!excluded.has(label)) pages.add(label);
  }
  return labels.filter((label) => pages.has(label)).concat([...pages].filter((page) => !labels.includes(page)).sort());
}

// ---------------------------------------------------------------- rules

interface Member {
  finding: ReportFinding;
  targets: Target[];
  pages: string[];
  component: string | null;
  /** The colours the finding says it measured, each as six hexadecimal digits. */
  colours: Set<string>;
  /** The pairs of colours it says it measured, one on the other: "d9dee5/f5f7f9", in sorted order. */
  pairs: Set<string>;
}

const COLOUR = /#([0-9a-f]{6}|[0-9a-f]{3})(?![\w-])|\brgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)/gi;

/** The colours in a text in the order they stand, each as six hexadecimal digits, with where it ends. */
function colourTokens(text: string): { colour: string; start: number; end: number }[] {
  return [...text.matchAll(COLOUR)].map((match) => {
    const [, hex, red, green, blue] = match;
    const colour = hex ? (hex.length === 3 ? [...hex.toLowerCase()].map((digit) => digit + digit).join("") : hex.toLowerCase()) : [red, green, blue].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("");
    return { colour, start: match.index, end: match.index + match[0].length };
  });
}

/** Colours written as a judge takes them from a measurement: "#d9dee5", "#ddd" or "rgb(217, 222, 229)". */
const measuredColours = (text: string): Set<string> => new Set(colourTokens(text).map((token) => token.colour));

/**
 * Pairs of colours written as a measurement gives them, one on the other: "#d9dee5 op #f5f7f9".
 * Only two written colours with just "op", "tegen", "on", "against" or a slash between them are
 * a pair; a colour named in words ("#767676 op wit") cannot be compared and gives none.
 */
function measuredPairs(text: string): Set<string> {
  const tokens = colourTokens(text);
  const pairs = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1];
    if (next && /^\s*(?:op|tegen|on|against|\/)\s*$/i.test(text.slice(token.end, next.start)) && token.colour !== next.colour) pairs.add([token.colour, next.colour].sort().join("/"));
  }
  return pairs;
}

const normaliseComponent = (component: string | null): string | null => (component && squash(component) ? squash(component).replace(/^["'‘“]+|["'’”]+$/g, "") : null);

function member(finding: ReportFinding, index: PageIndex): Member {
  return { finding, targets: targetsOf(finding), pages: pagesOf(finding, index), component: normaliseComponent(finding.component), colours: measuredColours(finding.observedNl), pairs: measuredPairs(finding.observedNl) };
}

/**
 * Too little contrast is repaired in the style sheet, whatever else is wrong with the
 * element. So a finding about colour is only joined with other findings about colour: a
 * field without a label and the same field with a pale border are two things to do, and
 * the first does not cause the second.
 */
const COLOUR_CRITERIA = new Set(["1.4.1", "1.4.3", "1.4.11"]);
const sameKind = (a: Member, b: Member): boolean => COLOUR_CRITERIA.has(a.finding.criterion) === COLOUR_CRITERIA.has(b.finding.criterion);

const sharesPage = (a: Member, b: Member): boolean => a.pages.some((page) => b.pages.includes(page));

/**
 * Two findings name the same element: written the same way, on a page both name it on, or
 * on pages each finding says it applies to. A judge gives the same element on two or three
 * pages as examples, and not always the same ones.
 */
function sameTarget(target: Target, other: Target, from: Member, to: Member): boolean {
  // Two findings that meet only in a frame are not known to be about the same thing: "the frame has no
  // title" and "the player in it has single-key shortcuts" are repaired in different places. The rules
  // leave that pair alone; a proposal may still join them, with a reason.
  if (isFrame(target) || isFrame(other)) return false;
  if (!target.keys.some((key) => other.keys.some((candidate) => sameKey(key, candidate)))) return false;
  return target.pages.some((page) => other.pages.includes(page)) || (!target.prose && target.pages.some((page) => to.pages.includes(page)) && other.pages.some((page) => from.pages.includes(page)));
}

/** The elements of `a` that `b` names too. */
const namedBy = (a: Member, b: Member): Target[] => a.targets.filter((target) => b.targets.some((other) => sameTarget(target, other, a, b)));
const coverage = (a: Member, b: Member): number => (a.targets.length === 0 ? 0 : namedBy(a, b).length / a.targets.length);

/**
 * Same element: one finding names nothing but elements of the other, and those are more
 * than half of what the other names. The second half keeps a finding about one button from
 * dissolving into a finding about the whole header.
 */
function sameElement(a: Member, b: Member): number | null {
  const [forward, backward] = [coverage(a, b), coverage(b, a)];
  return Math.max(forward, backward) === 1 && Math.min(forward, backward) > 0.5 ? Math.min(forward, backward) : null;
}

/**
 * The same measurement on the same element: two findings about colour that cite an observation
 * of the same element and name the same measured colour. The element is the selector chain an
 * observation recorded, the same to the letter; on which page does not matter, because a part
 * that repeats has the same chain on every page it is on. What each judge called the component
 * does not count, and neither does what else the findings point at: a judge cites the same part
 * on other pages and the elements it compared it with. A selector read from prose is not
 * enough for this rule.
 */
function sameMeasurement(a: Member, b: Member): boolean {
  if (!COLOUR_CRITERIA.has(a.finding.criterion) || !COLOUR_CRITERIA.has(b.finding.criterion)) return false;
  if (![...a.colours].some((colour) => b.colours.has(colour))) return false;
  const theirs = new Set(observedKeys(b));
  return observedKeys(a).some((key) => theirs.has(key));
}

/** The selector chains observations recorded for a finding, without the frames it only stands in. */
const observedKeys = (entry: Member): string[] => entry.targets.filter((target) => !isFrame(target)).flatMap((target) => target.keys.filter((key) => key.startsWith("path:")));

/** A chain with the place among its siblings left out: the same place in every item of a list, a menu or a row of cards. */
const repeatedPlace = (key: string): string => key.replace(/:nth-(of-type|child)\(\d+\)/g, ":nth-$1(n)");

/**
 * The same cause: two findings about colour that name the same measured pair of colours, one on
 * the other, at the same element. That is what "the same cause" means here, and nothing more: one
 * colour in a style sheet that is too pale, which a designer changes in one place, whichever
 * criteria it breaks. The rule is strict on purpose:
 *
 * - Only colour. A field without a label and the same field with a pale border are two repairs.
 * - Both colours of a pair, written by both findings. One grey in common proves nothing: a site
 *   uses one grey in many places. A ratio alone ("1,2 op 1") is not a pair.
 * - The same element: a chain an observation recorded, the same apart from which item of a
 *   repeated part it is (the current item of a menu is another item on every page), or, when the
 *   judges named it so, the same component in the same words. A selector read from prose is not
 *   enough.
 *
 * The outcome per criterion does not change: the findings stay as they are, under their own
 * criterion. Only the work list for whoever repairs the site gets one line for them.
 */
function sameCause(a: Member, b: Member): boolean {
  if (!COLOUR_CRITERIA.has(a.finding.criterion) || !COLOUR_CRITERIA.has(b.finding.criterion)) return false;
  if (![...a.pairs].some((pair) => b.pairs.has(pair))) return false;
  if (a.component !== null && a.component === b.component) return true;
  const theirs = new Set(observedKeys(b).map(repeatedPlace));
  return observedKeys(a).some((key) => theirs.has(repeatedPlace(key)));
}

/** The same problem measured twice: once per colour scheme or window size, under the same criterion. */
function isDuplicate(a: Member, b: Member): boolean {
  const places = (entry: Member): string => entry.targets.map((target) => `${target.pages.join()}:${target.keys.join("|")}`).join("\n");
  return a.finding.criterion === b.finding.criterion && withoutMeasuredIn(a.finding.titleNl) === withoutMeasuredIn(b.finding.titleNl) && places(a) === places(b);
}

/** A selector that fixes one spot in the page: an id, or a chain that starts at one. Only these can show that two places differ. */
const pinned = (key: string): boolean => key.startsWith("#");

/** Words that describe any place and therefore none: sharing one of them says nothing. */
const PLACE_STOPWORDS = new Set(
  "pagina paginas onder boven naast tussen links rechts linksboven rechtsboven bovenaan onderaan direct eerste tweede derde laatste zelfde dezelfde hetzelfde alle elke ieder andere tekst link knop knoppen blok element onderdeel kopje koppen afbeelding plaatje heeft hebben wordt worden staat staan niet geen voor naar door over maar ook zijn deze deze dit die dat met van een het bij als nth-of-type nth type page section span class".split(" "),
);

function placeWords(entry: Member, pages: string[]): Set<string> {
  const where = entry.finding.locations.filter((location) => pages.includes(location.page)).map((location) => location.where);
  const text = [entry.finding.titleNl, entry.finding.component ?? "", ...where].join(" ").toLowerCase();
  // The first six letters, so "mobiel" and "mobiele", "tabblad" and "tabbladen" are one word.
  return new Set(text.split(/[^a-zà-ÿ]+/).filter((word) => word.length >= 4 && !PLACE_STOPWORDS.has(word)).map((word) => word.slice(0, 6)));
}

/**
 * Whether one finding can hold another in the same defect. This is the one definition of
 * "same place" that the fixed rules and the check on a proposal both use. On a page both
 * findings name, the other finding has to be about elements the holder names too, or about
 * something inside them. The same page alone is never enough:
 *
 * - Selectors decide when they can. An element counts as the holder's when it is the same
 *   element, a pattern of it, or a chain that runs through it. At least half of the elements
 *   the other finding names have to be the holder's; a finding that touches the holder in
 *   one element and is about four others is mostly about another place.
 * - When none of them is, and on the pages they share both findings pin every spot with an
 *   id, the places differ.
 * - Otherwise the place is written in prose, or as a class on one side and a chain on the
 *   other, and no rule can compare those. Then the other finding may not reach beyond the
 *   pages of the holder, and the two have to name the place with at least one word in common.
 *   That is a low bar, and it is all that prose allows; with observations of the session the
 *   first rule decides every case.
 *
 * Two cases need none of this: the same colour measured on the same element is the same defect,
 * and so is the same pair of colours at the same element or component (see `sameCause`).
 */
function holdsProblem(holder: Member, other: Member): string | null {
  const shared = holder.pages.filter((page) => other.pages.includes(page));
  if (shared.length === 0) return "share no page";
  if (sameMeasurement(holder, other) || sameCause(holder, other)) return null;
  const selectors = (entry: Member): Target[] => entry.targets.filter((target) => !target.prose);
  const mine = selectors(holder).flatMap((target) => target.keys);
  const theirs = selectors(other);
  const held = theirs.filter((target) => namedBy(other, holder).includes(target) || target.keys.some((key) => mine.some((candidate) => related(key, candidate))));
  if (held.length > 0) return held.length * 2 >= theirs.length ? null : "are mostly at different places";
  // The same words on the same page, for places that are written in prose on both sides.
  if (namedBy(other, holder).length > 0) return null;
  // A difference shows only where both findings pin every spot they name on the pages they share.
  const here = (entry: Member): Target[] => entry.targets.filter((target) => target.pages.some((page) => shared.includes(page)));
  const allPinned = (entry: Member): boolean => here(entry).length > 0 && here(entry).every((target) => !target.prose && target.keys.every(pinned));
  if (allPinned(holder) && allPinned(other)) return "point at different places";
  if (!other.pages.every((page) => holder.pages.includes(page))) return "are not shown to be at the same place: the second is on pages the first does not name";
  const words = placeWords(holder, shared);
  return [...placeWords(other, shared)].some((word) => words.has(word)) ? null : "are not shown to be at the same place: they name it in no common word";
}

/**
 * Why a set of findings cannot be one defect; empty when nothing speaks against it. One
 * finding has to hold the defect together: every other finding is at its place. A finding
 * about three buttons holds three findings about one button each, although those three are
 * about different buttons; without it they are three defects.
 */
function groupProblems(members: Member[]): string[] {
  if (members.length < 2) return [];
  const candidates = members.map((holder) => ({ holder, problems: members.filter((other) => other !== holder).flatMap((other) => (holdsProblem(holder, other) ? [`${holder.finding.id} and ${other.finding.id} ${holdsProblem(holder, other)}`] : [])) }));
  // Reported against the finding that comes closest to holding the defect, so the message names what has to go.
  const best = candidates.sort((a, b) => a.problems.length - b.problems.length)[0]!;
  return best.problems.length === 0 ? [] : [`no finding holds this defect together; closest is ${best.holder.finding.id}: ${best.problems.join("; ")}`];
}

// ---------------------------------------------------------------- main criterion

/**
 * Which criterion names the defect when it breaks several. The rule: the criterion whose
 * normative text is about the cause comes first, and the one that only describes what
 * follows from it comes last. Repairing the cause repairs the rest, so the worklist files
 * the defect there. In order:
 *
 * 1. Criteria about what is offered at all. 1.4.5: text set as an image is the cause of what
 *    that image then does under 1.1.1, 1.4.4 and 1.4.10. 2.4.4: for a link the wording of its
 *    name is the defect, and 2.5.3, 3.2.4 and 4.1.2 repeat it. 3.3.2: a field without a visible
 *    label also has no name (4.1.2) and no relation in code (1.3.1). 2.4.11: a focused element
 *    hidden behind something else is why its focus cannot be seen (2.4.7).
 * 2. Criteria about how it is built. 4.1.2: an element that is not the control it looks like
 *    cannot be reached by keyboard (2.1.1), has no name (1.1.1, 2.5.3) and no structure
 *    (1.3.1). Then 1.3.1 itself, before the criteria that only read that structure (2.4.6,
 *    2.4.1, 1.3.2), and 1.1.1 for what has no text alternative.
 * 3. Criteria about how it then behaves: keyboard and focus (2.1.1, 2.1.2, 2.4.3, 2.4.7), and
 *    layout under pressure, where a block that does not fit a narrow window (1.4.10) is the
 *    cause of what happens when text is enlarged or spaced (1.4.4, 1.4.12).
 * 4. Everything else in WCAG order.
 *
 * This order cannot see the content, so it is wrong in some cases; the proposal step may
 * override it per defect, and has to say why.
 */
export const MAIN_PRECEDENCE = ["1.4.5", "2.4.4", "3.3.2", "2.4.11", "4.1.2", "1.3.1", "1.1.1", "2.1.1", "2.1.2", "2.4.3", "2.4.7", "1.4.10", "1.4.4", "1.4.12"];

export function mainCriterion(criteria: string[]): string {
  const rank = (id: string): number => (MAIN_PRECEDENCE.includes(id) ? MAIN_PRECEDENCE.indexOf(id) : MAIN_PRECEDENCE.length);
  return [...new Set(criteria)].sort((a, b) => rank(a) - rank(b) || compareCriterionIds(a, b))[0]!;
}

// ---------------------------------------------------------------- defects

const SEVERITY_RANK: Record<ReportFinding["severity"], number> = { blokkerend: 0, hoog: 1, midden: 2, laag: 3 };

/**
 * Page labels as the dossiers number them. The findings refer to pages by these labels,
 * so the padding follows the widest label they use.
 */
export function pageIndex(evaluation: Evaluation): PageIndex {
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const used = findings.flatMap((finding) => finding.locations.map((location) => /^P(\d+)$/.exec(location.page)?.[1]?.length ?? 0));
  const labels = pageLabels(evaluation.sample.items.length, Math.max(0, ...used));
  return { labels, own: labels.filter((_label, index) => evaluation.sample.items[index]!.kind !== "embedded") };
}

function defectId(findingIds: string[]): string {
  // The finding that sorts first anchors the identifier, so a defect that gains a finding keeps it.
  const anchor = [...findingIds].sort()[0]!;
  return `${anchor.split("-")[0]}-G-${stableId("x", "defect", anchor).slice(2, 6)}`;
}

function buildDefect(members: Member[], mergedBy: MergeBasis[], { labels }: PageIndex, chosen?: { criterion: string; reasonNl: string | null }): Defect {
  const criterion = chosen?.criterion ?? mainCriterion(members.map((entry) => entry.finding.criterion));
  const order = (a: Member, b: Member): number => compareCriterionIds(a.finding.criterion, b.finding.criterion) || a.finding.id.localeCompare(b.finding.id);
  const main = members.filter((entry) => entry.finding.criterion === criterion).sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || order(a, b))[0]!;
  const others = members.filter((entry) => entry !== main).sort(order);
  const pages = new Set(members.flatMap((entry) => entry.finding.locations.map((location) => location.page)));
  // Only a signal that the list is not complete: the free text is not trusted for which pages.
  const morePages = members.some((entry) => entry.pages.length > new Set(entry.finding.locations.map((location) => location.page)).size || Number(/\b(\d+) (?:van|pagina)/.exec(entry.finding.pagesAffected)?.[1] ?? 0) > pages.size);
  // The element is named only when every finding names it in the same words.
  const common = members.map((entry) => entry.targets.filter((target) => !target.prose).flatMap((target) => target.keys.filter((key) => !key.startsWith("frame:")))).reduce((shared, keys) => shared.filter((key) => keys.some((other) => sameKey(key, other))));
  const findingIds = [main, ...others].map((entry) => entry.finding.id);
  return {
    id: defectId(findingIds),
    titleNl: main.finding.titleNl,
    mainCriterion: criterion,
    mainFindingId: main.finding.id,
    alsoCriteria: [...new Set(others.map((entry) => entry.finding.criterion))].filter((id) => id !== criterion).sort(compareCriterionIds),
    findingIds,
    pages: labels.filter((label) => pages.has(label)).concat([...pages].filter((page) => !labels.includes(page)).sort()),
    morePages,
    component: main.finding.component ?? others.find((entry) => entry.finding.component)?.finding.component ?? null,
    element: common.sort((a, b) => b.length - a.length || a.localeCompare(b))[0]?.replace(/^(path|file):/, "") ?? null,
    severity: members.map((entry) => entry.finding.severity).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0]!,
    owner: main.finding.owner,
    mergedBy,
    mainReasonNl: chosen?.reasonNl ?? null,
  };
}

function uniqueIds(defects: Defect[]): void {
  const used = new Set<string>();
  for (const defect of defects) {
    let id = defect.id;
    for (let suffix = 2; used.has(id); suffix++) id = `${defect.id}-${suffix}`;
    defect.id = id;
    used.add(id);
  }
}

const sortDefects = (defects: Defect[]): Defect[] => defects.sort((a, b) => compareCriterionIds(a.mainCriterion, b.mainCriterion) || a.mainFindingId.localeCompare(b.mainFindingId));

/**
 * The deterministic step. Pairs of findings are joined by the strongest rule first; a pair
 * is only joined when the defect that results still has a page all its findings share and
 * no two findings in it point at demonstrably different places.
 */
export function mergeFindings(evaluation: Evaluation): Defect[] {
  const index = pageIndex(evaluation);
  const members = evaluation.criteria.flatMap((criterion) => criterion.findings).map((finding) => member(finding, index));
  const pairs: { a: number; b: number; basis: MergeBasis; score: number }[] = [];
  for (const [a, left] of members.entries()) {
    for (const [offset, right] of members.slice(a + 1).entries()) {
      const b = a + 1 + offset;
      if (!sharesPage(left, right)) continue;
      const element = sameElement(left, right);
      if (isDuplicate(left, right)) pairs.push({ a, b, basis: "duplicate", score: 3 });
      // Decided by what was measured, before anything that depends on how a judge named or listed things.
      else if (sameMeasurement(left, right)) pairs.push({ a, b, basis: "measurement", score: 2.5 });
      else if (sameCause(left, right)) pairs.push({ a, b, basis: "cause", score: 2.4 });
      else if (!sameKind(left, right)) continue;
      else if (element !== null) pairs.push({ a, b, basis: "element", score: 2 + element });
      // The same named component on the same pages, with at least one element in common. The name alone
      // is not enough: headings and contrast in "zoekresultaten" are two things to repair.
      else if (left.component !== null && left.component === right.component && left.pages.join() === right.pages.join() && namedBy(left, right).length > 0) pairs.push({ a, b, basis: "component", score: 1 });
    }
  }
  // One criterion describes several elements in one finding, another has a finding per element. The
  // separate findings belong to the broad one when each names nothing outside it and together they
  // name more than half of it.
  for (const [b, broad] of members.entries()) {
    const inside = members.map((entry, a) => ({ entry, a })).filter(({ entry, a }) => a !== b && entry.finding.criterion !== broad.finding.criterion && sameKind(entry, broad) && sharesPage(entry, broad) && coverage(entry, broad) === 1);
    for (const criterion of new Set(inside.map(({ entry }) => entry.finding.criterion))) {
      const parts = inside.filter(({ entry }) => entry.finding.criterion === criterion);
      const named = new Set(parts.flatMap(({ entry }) => namedBy(broad, entry)));
      const share = named.size / broad.targets.length;
      if (share > 0.5) for (const { a } of parts) pairs.push({ a: Math.min(a, b), b: Math.max(a, b), basis: "element", score: 1 + share / 2 });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);

  const cluster = members.map((_entry, index) => index);
  const basis = new Map<number, Set<MergeBasis>>();
  for (const pair of pairs) {
    const [left, right] = [cluster[pair.a]!, cluster[pair.b]!];
    if (left === right) continue;
    const joined = members.filter((_entry, index) => cluster[index] === left || cluster[index] === right);
    if (groupProblems(joined).length > 0) continue;
    const [keep, drop] = [Math.min(left, right), Math.max(left, right)];
    for (const [index, value] of cluster.entries()) if (value === drop) cluster[index] = keep;
    basis.set(keep, new Set([...(basis.get(left) ?? []), ...(basis.get(right) ?? []), pair.basis]));
    basis.delete(drop);
  }

  const defects = [...new Set(cluster)].map((root) => buildDefect(members.filter((_entry, index) => cluster[index] === root), [...(basis.get(root) ?? [])].sort(), index));
  uniqueIds(sortDefects(defects));
  return defects;
}

/**
 * Give a defect the identifier it had in the previous evaluation when most of its findings
 * were together there too. Finding identifiers are carried first, so this compares like with like.
 */
export function carryDefectIds(defects: Defect[], previous: Defect[]): { carried: number; fresh: number } {
  const overlap = (a: Defect, b: Defect): number => {
    const shared = a.findingIds.filter((id) => b.findingIds.includes(id)).length;
    return shared / (a.findingIds.length + b.findingIds.length - shared);
  };
  const candidates = defects.flatMap((defect) => previous.map((earlier) => ({ defect, earlier, score: overlap(defect, earlier) }))).filter((candidate) => candidate.score >= 0.5);
  candidates.sort((a, b) => b.score - a.score || a.defect.id.localeCompare(b.defect.id) || a.earlier.id.localeCompare(b.earlier.id));
  const carried = new Map<Defect, string>();
  const taken = new Set<string>();
  for (const { defect, earlier } of candidates) {
    if (carried.has(defect) || taken.has(earlier.id)) continue;
    carried.set(defect, earlier.id);
    taken.add(earlier.id);
  }
  // A carried identifier goes first, so a new defect cannot take it.
  for (const [defect, id] of carried) defect.id = id;
  uniqueIds([...defects].sort((a, b) => Number(carried.has(b)) - Number(carried.has(a))));
  return { carried: carried.size, fresh: defects.length - carried.size };
}

// ---------------------------------------------------------------- proposal

const isText = (value: unknown, minimum = 1): value is string => typeof value === "string" && value.trim().length >= minimum;
const REASON_LENGTH = 20;

/**
 * Check what the language model proposed. It may only say that findings describe the same
 * defect at the same place, and which criterion names it. Everything else is refused: a
 * finding left out or named twice, a defect of the rules taken apart, findings that share
 * no page, findings at demonstrably different places, a main criterion none of them has.
 */
export function validateProposal(input: unknown, evaluation: Evaluation, deterministic: Defect[]): string[] {
  if (input === null || typeof input !== "object" || !Array.isArray((input as MergeProposal).defects)) return ['the proposal must be a JSON object with a list "defects"'];
  const pages = pageIndex(evaluation);
  const byId = new Map(evaluation.criteria.flatMap((criterion) => criterion.findings).map((finding) => [finding.id, member(finding, pages)]));
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const [index, group] of (input as MergeProposal).defects.entries()) {
    const at = `defects[${index}]`;
    if (group === null || typeof group !== "object" || !Array.isArray(group.findings) || group.findings.length === 0 || !group.findings.every((id) => typeof id === "string")) {
      problems.push(`${at}: findings must list at least one finding id`);
      continue;
    }
    const unknown = group.findings.filter((id) => !byId.has(id));
    for (const id of unknown) problems.push(`${at}: "${id}" is not a finding of this evaluation`);
    for (const id of group.findings) {
      if (seen.has(id)) problems.push(`${at}: ${id} is already in defects[${seen.get(id)}]; a finding belongs to one defect`);
      else seen.set(id, index);
    }
    if (unknown.length > 0) continue;
    const members = group.findings.map((id) => byId.get(id)!);
    if (!members.some((entry) => entry.finding.criterion === group.mainCriterion)) problems.push(`${at}: mainCriterion "${String(group.mainCriterion)}" is not the criterion of any of its findings`);
    problems.push(...groupProblems(members).map((problem) => `${at}: ${problem}; findings at different places are different defects`));
    const parts = deterministic.filter((defect) => defect.findingIds.some((id) => group.findings.includes(id)));
    const overridden = group.mainCriterion !== mainCriterion(members.map((entry) => entry.finding.criterion));
    if ((parts.length > 1 || overridden) && !isText(group.reasonNl, REASON_LENGTH)) {
      problems.push(`${at}: reasonNl must say ${parts.length > 1 ? "why these findings are the same defect at the same place" : "why this criterion names the cause"}`);
    }
  }
  for (const id of byId.keys()) if (!seen.has(id)) problems.push(`finding ${id} is in no defect; every finding must be named exactly once`);
  for (const defect of deterministic) {
    const groups = new Set(defect.findingIds.map((id) => seen.get(id)));
    if (groups.size > 1 && !groups.has(undefined)) problems.push(`${defect.findingIds.join(", ")} were joined by the fixed rules and must stay in one defect`);
  }
  return problems;
}

/** The defects after a proposal that passed validation. */
export function applyProposal(evaluation: Evaluation, deterministic: Defect[], proposal: MergeProposal): { defects: Defect[]; joined: number; mainOverridden: number } {
  const pages = pageIndex(evaluation);
  const byId = new Map(evaluation.criteria.flatMap((criterion) => criterion.findings).map((finding) => [finding.id, member(finding, pages)]));
  let joined = 0;
  let mainOverridden = 0;
  const defects = proposal.defects.map((group) => {
    const members = group.findings.map((id) => byId.get(id)!);
    const parts = deterministic.filter((defect) => defect.findingIds.some((id) => group.findings.includes(id)));
    const overridden = group.mainCriterion !== mainCriterion(members.map((entry) => entry.finding.criterion));
    if (parts.length > 1) joined++;
    if (overridden) mainOverridden++;
    const mergedBy = [...new Set([...parts.flatMap((defect) => defect.mergedBy), ...(parts.length > 1 ? (["proposal"] as const) : [])])].sort();
    return buildDefect(members, mergedBy, pages, { criterion: group.mainCriterion, reasonNl: overridden ? group.reasonNl!.trim() : null });
  });
  uniqueIds(sortDefects(defects));
  return { defects, joined, mainOverridden };
}

const clip = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length)} ...`);

/** What the proposal step gets to read: the defects of the rules with their findings, and nothing else. */
export function proposalInput(evaluation: Evaluation, deterministic: Defect[]): Record<string, unknown> {
  const findings = new Map(evaluation.criteria.flatMap((criterion) => criterion.findings).map((finding) => [finding.id, finding]));
  return {
    site: evaluation.site.name,
    pages: Object.fromEntries(pageIndex(evaluation).labels.map((label, index) => [label, evaluation.sample.items[index]!.title || evaluation.sample.items[index]!.url])),
    defects: deterministic.map((defect) => ({
      mainCriterion: defect.mainCriterion,
      joinedByRules: defect.findingIds.length > 1,
      findings: defect.findingIds.map((id) => {
        const finding = findings.get(id)!;
        // Enough to recognise the place and the problem; the full text stays in the evaluation.
        return { id, criterion: finding.criterion, titleNl: finding.titleNl, observedNl: clip(finding.observedNl, 240), component: finding.component, pagesAffected: clip(finding.pagesAffected, 80), where: finding.locations.map((location) => `${location.page}: ${clip(location.where, 200)}`) };
      }),
    })),
  };
}

