import type { Page } from "playwright";
import type { MethodFailure, MethodResult } from "../methods.ts";
import { ensureHelpers } from "./capsule.ts";
import { idOf, methodById, versionOf, type BrowserVersions } from "./registry.ts";
import { engineOf, knownFor, type EngineId, type Finding, type RulesRun } from "./rules.ts";

/** The rules with which each engine answers a question about one element. */
export const CONTRAST_RULES: Record<EngineId, string[]> = { "axe-core": ["color-contrast"], alfa: ["sia-r69"], ibm: ["text_contrast_sufficient"], qualweb: ["QW-ACT-R37"] };
export const TARGET_RULES: Partial<Record<EngineId, string[]>> = { "axe-core": ["target-size"], alfa: ["sia-r113"], ibm: ["target_spacing_sufficient"] };

export type Verdict = "failed" | "cantTell" | "passed" | "silent" | "exempt";

/** What a rule engine said about one element, for one question. `silent` means it has a rule for the question and said nothing about this element. */
export interface EngineOpinion {
  verdict: Verdict;
  findings: (Pick<Finding, "rule" | "outcome" | "where" | "message" | "data"> & { relation: "same" | "inside" })[];
}

const worst = (outcomes: string[]): Verdict => (outcomes.includes("failed") ? "failed" : outcomes.includes("cantTell") ? "cantTell" : outcomes.includes("passed") ? "passed" : "silent");

/**
 * Take from a run of the rule engines what each said about one element, with the rules that
 * answer one question. Each engine that has such a rule becomes a method of its own.
 */
export async function engineOpinions(page: Page, run: RulesRun, where: string, rules: Partial<Record<EngineId, string[]>>, browsers: BrowserVersions, includeInside: boolean): Promise<{ methods: MethodResult<EngineOpinion>[]; failed: MethodFailure[] }> {
  await ensureHelpers(page);
  const methods: MethodResult<EngineOpinion>[] = [];
  for (const method of run.methods) {
    const engine = engineOf(method);
    const wanted = rules[engine];
    if (!wanted) continue;
    const candidates = method.result.findings.filter((finding) => wanted.includes(finding.rule) && finding.where !== null);
    const places = [...new Set(candidates.map((finding) => finding.where!))];
    const relations = await page.evaluate(([target, list]) => (window as unknown as { __loepm: { relate: (target: string, places: string[]) => ("same" | "inside" | null)[] } }).__loepm.relate(target as string, list as string[]), [where, places] as const);
    const relationOf = new Map(places.map((place, index) => [place, relations[index] ?? null]));
    const findings = candidates
      .map((finding) => ({ rule: finding.rule, outcome: finding.outcome, where: finding.where, ...(finding.message ? { message: finding.message } : {}), ...(finding.data ? { data: finding.data } : {}), relation: relationOf.get(finding.where!) ?? null }))
      .filter((finding): finding is EngineOpinion["findings"][number] => finding.relation === "same" || (includeInside && finding.relation === "inside"));
    const known = findings.map((finding) => knownFor({ engine, rule: finding.rule }, run)).find(Boolean);
    const spec = methodById(engine);
    methods.push({ method: spec.method, implementation: spec.implementation, version: method.version, principle: spec.principle, ms: 0, result: { verdict: worst(findings.map((finding) => finding.outcome)), findings }, ...(known ? { knownUnreliable: known } : {}) });
  }
  // An engine that crashed in the run has no opinion; it is passed on as a failure.
  return { methods, failed: run.failed.filter((failure) => rules[engineOf(failure)] !== undefined) };
}

export interface ComputedPiece {
  text: string;
  where: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  outcome: "passed" | "failed" | "cantTell";
  notes?: string[];
  backgroundAssumed?: boolean;
}

/** Contrast of the text in an element from computed styles alone. */
export async function computedContrast(page: Page, where: string): Promise<{ pieces: ComputedPiece[] }> {
  await ensureHelpers(page);
  const pieces = await page.evaluate((target) => (window as unknown as { __loepm: { computedContrast: (target: string) => ComputedPiece[] | null } }).__loepm.computedContrast(target), where);
  if (!pieces) throw new Error("het element is van de pagina verdwenen");
  return { pieces };
}

export interface ContrastSummary {
  id: string;
  verdict: Verdict;
  /** The lowest ratio the method gave for the element, when it gives one. */
  ratio: number | null;
  known?: string;
}

interface PixelText {
  ratio: number | null;
  outcome: string;
}

/** Bring what each method found for the text of an element to one line: a verdict and the lowest ratio. */
export function contrastSummary(method: MethodResult): ContrastSummary {
  const id = idOf(method);
  const known = method.knownUnreliable;
  const lowest = (ratios: (number | null | undefined)[]): number | null => {
    const numbers = ratios.filter((ratio): ratio is number => typeof ratio === "number" && Number.isFinite(ratio));
    return numbers.length > 0 ? Math.min(...numbers) : null;
  };
  let summary: ContrastSummary;
  if (id === "pixels") {
    const text = ((method.result as { text?: PixelText[] }).text ?? []) as PixelText[];
    const outcomes = text.map((entry) => entry.outcome);
    summary = { id, verdict: outcomes.length === 0 ? "silent" : outcomes.every((outcome) => outcome === "exempt") ? "exempt" : worst(outcomes), ratio: lowest(text.map((entry) => entry.ratio)) };
  } else if (id === "chromium-backgrounds") {
    const sample = method.result as BackgroundSample;
    summary = { id, verdict: sample.outcome, ratio: sample.ratio };
  } else if (id === "computed-style") {
    const pieces = (method.result as { pieces: ComputedPiece[] }).pieces;
    summary = { id, verdict: worst(pieces.map((piece) => piece.outcome)), ratio: lowest(pieces.map((piece) => piece.ratio)) };
  } else {
    const opinion = method.result as EngineOpinion;
    summary = { id, verdict: opinion.verdict, ratio: lowest(opinion.findings.map((finding) => (finding.data?.ratio as number | undefined) ?? null)) };
  }
  return known ? { ...summary, known } : summary;
}

/** Above this ratio every requirement of WCAG is met with room to spare; a difference between two methods up there changes nothing. */
const WELL_ABOVE = 7.5;
/** Two ratios are the same measurement when they differ less than this; anti-aliasing and rounding stay within it. */
const sameRatio = (first: number, second: number): boolean => Math.min(first, second) >= WELL_ABOVE || Math.abs(first - second) <= Math.max(0.3, 0.1 * Math.min(first, second));

/**
 * Where the methods contradict each other: one fails what another passes, or two give a
 * ratio that is not the same measurement. "Cannot tell" and "says nothing" contradict
 * nobody, and neither does an answer marked as known unreliable.
 */
export function verdictDifferences(summaries: { id: string; verdict: Verdict; ratio?: number | null; known?: string; noOpinion?: string }[]): string[] {
  const trusted = summaries.filter((summary) => !summary.known && !summary.noOpinion && (summary.verdict === "failed" || summary.verdict === "passed"));
  const differences: string[] = [];
  const failed = trusted.filter((summary) => summary.verdict === "failed").map((summary) => summary.id);
  const passed = trusted.filter((summary) => summary.verdict === "passed").map((summary) => summary.id);
  if (failed.length > 0 && passed.length > 0) differences.push(`failed: ${failed.join(", ")}; passed: ${passed.join(", ")}`);
  const withRatio = trusted.filter((summary): summary is typeof summary & { ratio: number } => typeof summary.ratio === "number");
  const apart = withRatio.filter((summary) => withRatio.some((other) => !sameRatio(summary.ratio, other.ratio)));
  if (apart.length > 0) differences.push(`ratio: ${withRatio.map((summary) => `${summary.id} ${summary.ratio}`).join(", ")}`);
  return differences;
}

/**
 * Why a method has no opinion, when it has none: it said nothing about the element, or it
 * could not tell. Such a method is listed and never counts as a dissent.
 */
export function withoutOpinion(summary: { verdict: Verdict; noOpinion?: string }): string | null {
  if (summary.noOpinion) return summary.noOpinion;
  if (summary.verdict === "silent") return "zegt niets over dit element";
  if (summary.verdict === "cantTell") return "kan het niet bepalen";
  return null;
}

/** The background colours Chromium itself finds behind the text of an element, and the contrast of the text colour against each. */
export interface BackgroundSample {
  where: string;
  foreground: string;
  backgrounds: string[];
  /** The lowest contrast against any of the backgrounds; null when Chromium gives no colour, as over a picture. */
  ratio: number | null;
  required: number;
  outcome: "passed" | "failed" | "cantTell";
}

export async function chromiumBackgrounds(page: Page, where: string): Promise<BackgroundSample> {
  await ensureHelpers(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("DOM.getDocument", { depth: 0 });
    const { result } = await cdp.send("Runtime.evaluate", { expression: `window.__loepm.resolveWhere(${JSON.stringify(where)})` });
    if (!result.objectId) throw new Error("het element is van de pagina verdwenen");
    const { nodeId } = await cdp.send("DOM.requestNode", { objectId: result.objectId });
    const sampled = await cdp.send("CSS.getBackgroundColors", { nodeId });
    const backgrounds = sampled.backgroundColors ?? [];
    const computed = await page.evaluate(([target, colours]) => (window as unknown as { __loepm: { contrastAgainst: (target: string, colours: string[]) => { foreground: string; ratios: number[]; required: number } | null } }).__loepm.contrastAgainst(target as string, colours as string[]), [where, backgrounds] as const);
    if (!computed) throw new Error("het element is van de pagina verdwenen");
    const ratio = computed.ratios.length > 0 ? Math.min(...computed.ratios) : null;
    return { where, foreground: computed.foreground, backgrounds, ratio, required: computed.required, outcome: ratio === null ? "cantTell" : ratio >= computed.required ? "passed" : "failed" };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export interface FocusStyles {
  own: Record<string, string>;
  ancestors: { where: string; style: Record<string, string> }[];
  generated: Record<string, Record<string, string>>;
  focused: boolean;
  focusVisible: boolean;
}

export async function focusStyles(page: Page, where: string): Promise<FocusStyles | null> {
  await ensureHelpers(page);
  return page.evaluate((target) => (window as unknown as { __loepm: { focusStyles: (target: string) => FocusStyles | null } }).__loepm.focusStyles(target), where);
}

export interface StyleChange {
  /** Properties of the element itself that differ with focus. */
  changed: Record<string, [string, string]>;
  /** Ancestors whose style differs with focus, as with :focus-within. */
  ancestors: { where: string; changed: string[] }[];
  generated: string[];
  /** Whether any of it is a change a user could see. */
  visibleChange: boolean;
  focusVisible: boolean;
}

const diff = (before: Record<string, string>, after: Record<string, string>): Record<string, [string, string]> =>
  Object.fromEntries(Object.keys(after).filter((name) => before[name] !== after[name]).map((name) => [name, [before[name] ?? "", after[name]!] as [string, string]]));

/** What changed in the computed style between the element without and with focus. */
export function styleChange(before: FocusStyles, after: FocusStyles): StyleChange {
  const changed = diff(before.own, after.own);
  // An outline that is declared but has no width or no style draws nothing.
  const outlineDrawn = after.own["outline-style"] !== "none" && Number.parseFloat(after.own["outline-width"] ?? "0") > 0;
  const outlineOnly = Object.keys(changed).every((name) => name.startsWith("outline"));
  const ancestors = after.ancestors
    .map((ancestor, index) => ({ where: ancestor.where, changed: Object.keys(diff(before.ancestors[index]?.style ?? {}, ancestor.style)) }))
    .filter((ancestor) => ancestor.changed.length > 0);
  const generated = Object.keys(after.generated).filter((pseudo) => Object.keys(diff(before.generated[pseudo] ?? {}, after.generated[pseudo]!)).length > 0);
  const ownVisible = Object.keys(changed).length > 0 && !(outlineOnly && !outlineDrawn);
  return { changed, ancestors, generated, visibleChange: ownVisible || ancestors.length > 0 || generated.length > 0, focusVisible: after.focusVisible };
}

/** A method of the toolbox itself, in the form of the record. */
export async function ownMethod<T>(id: string, browsers: BrowserVersions, result: T, ms: number): Promise<MethodResult<T>> {
  const spec = methodById(id);
  return { method: spec.method, implementation: spec.implementation, version: await versionOf(spec, browsers), principle: spec.principle, ms, result };
}
