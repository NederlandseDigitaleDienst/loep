import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page } from "playwright";
import type { MethodResult } from "../methods.ts";
import { ensureHelpers } from "./capsule.ts";
import { binary, binaryCommand, idOf, toolboxRequire, Unavailable, VNU_JAR } from "./registry.ts";

const run = promisify(execFile);

/** One message of a validator about the source as the server sent it. */
export interface SourceFinding {
  outcome: "failed" | "cantTell";
  /** The validator's own rule id, or for vnu, which has none, a name derived from the message. */
  rule: string;
  criteria: string[];
  line: number;
  column: number;
  message: string;
  extract?: string;
  /** A selector the validator gave or that could be read from the fragment. */
  selector?: string;
  /** The element in the page as it is now, when the selector still leads to one. */
  where?: string | null;
}

export interface SourceAnswer {
  findings: SourceFinding[];
  counts: { failed: number; cantTell: number };
}

/** vnu gives a message and no rule id. Messages are recognised by their wording; the first match names the rule. */
const VNU_RULES: [RegExp, string, string[]][] = [
  [/Duplicate ID|first occurrence of ID/, "duplicate-id", ["4.1.1"]],
  [/not allowed as child of element|must not appear as a descendant/, "content-model", ["4.1.1", "1.3.1"]],
  [/Stray end tag|Unclosed element|End tag .* seen|violates nesting rules|Stray start tag|open elements/, "nesting", ["4.1.1"]],
  [/Duplicate attribute/, "duplicate-attribute", ["4.1.1"]],
  [/attribute “(?:xml:)?lang”|language subtag|“lang” attribute/, "lang", ["3.1.1", "3.1.2"]],
  [/attribute “role”|“role” attribute|ARIA role/, "aria-role", ["4.1.2"]],
  [/attribute “aria-|“aria-\w+” attribute|is missing required attribute “aria-/, "aria-attribute", ["4.1.2"]],
  [/autocomplete/, "autocomplete", ["1.3.5"]],
  [/attribute “alt”|“alt” attribute/, "alt", ["1.1.1"]],
  [/heading|“h[1-6]”/, "heading", ["1.3.1"]],
  [/user-scalable|maximum-scale|viewport/, "viewport", ["1.4.4"]],
  [/Element “title”|child element “title”/, "title", ["2.4.2"]],
  [/“label”|attribute “for”/, "label", ["1.3.1", "4.1.2"]],
  [/“marquee”|“blink”/, "moving-element", ["2.2.2"]],
  [/obsolete/, "obsolete", []],
];

/** The success criteria behind html-validate's rules, as far as a rule is about one. */
const HTML_VALIDATE_CRITERIA: Record<string, string[]> = {
  "no-dup-id": ["4.1.1"], "no-dup-attr": ["4.1.1"], "close-order": ["4.1.1"], "close-attr": ["4.1.1"], "element-permitted-content": ["4.1.1", "1.3.1"], "element-permitted-parent": ["4.1.1", "1.3.1"],
  "element-permitted-occurrences": ["4.1.1"], "element-permitted-order": ["4.1.1"], "element-required-content": ["4.1.1", "1.3.1"], "element-required-ancestor": ["4.1.1", "1.3.1"],
  "wcag/h30": ["2.4.4"], "wcag/h32": ["3.2.2"], "wcag/h36": ["1.1.1"], "wcag/h37": ["1.1.1"], "wcag/h63": ["1.3.1"], "wcag/h67": ["1.1.1"], "wcag/h71": ["1.3.1"],
  "valid-autocomplete": ["1.3.5"], "input-missing-label": ["1.3.1", "4.1.2"], "empty-heading": ["1.3.1", "2.4.6"], "empty-title": ["2.4.2"], "meta-refresh": ["2.2.1"], "no-autoplay": ["1.4.2"],
  "aria-label-misuse": ["4.1.2"], "aria-hidden-body": ["4.1.2"], "hidden-focusable": ["4.1.2"], "no-abstract-role": ["4.1.2"], "unique-landmark": ["1.3.1"], "heading-level": ["1.3.1"], "area-alt": ["1.1.1"],
  "text-content": ["4.1.2"], "multiple-labeled-controls": ["1.3.1"], "attribute-allowed-values": ["4.1.1"], "deprecated": [],
};
const MOVING = /<(marquee|blink)>/;

interface HtmlValidateMessage {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
  selector: string | null;
}

const count = (findings: SourceFinding[]): SourceAnswer => ({ findings, counts: { failed: findings.filter((finding) => finding.outcome === "failed").length, cantTell: findings.filter((finding) => finding.outcome === "cantTell").length } });

/** html-validate on the source: its own parser, in this process. Only the rules about the HTML standard and about accessibility; none about style. */
export async function htmlValidate(source: string): Promise<SourceAnswer> {
  const { HtmlValidate } = toolboxRequire("html-validate") as { HtmlValidate: new (config: unknown) => { validateString: (source: string) => Promise<{ results: { messages: HtmlValidateMessage[] }[] }> } };
  const report = await new HtmlValidate({ root: true, extends: ["html-validate:standard", "html-validate:a11y"] }).validateString(source);
  const findings = (report.results[0]?.messages ?? []).map((message): SourceFinding => ({
    outcome: message.severity >= 2 ? "failed" : "cantTell",
    rule: message.ruleId,
    criteria: message.ruleId === "deprecated" && MOVING.test(message.message) ? ["2.2.2"] : (HTML_VALIDATE_CRITERIA[message.ruleId] ?? []),
    line: message.line,
    column: message.column,
    message: message.message.slice(0, 200),
    ...(message.selector ? { selector: message.selector } : {}),
  }));
  return count(findings);
}

interface VnuMessage {
  type: string;
  subType?: string;
  message: string;
  extract?: string;
  lastLine?: number;
  firstLine?: number;
  firstColumn?: number;
  lastColumn?: number;
}

const VNU_LIMIT_MS = 60_000;

/** The Nu Html Checker on a saved copy of the source. Needs Java; without it the method is unavailable. */
export async function vnu(sourcePath: string): Promise<SourceAnswer> {
  const java = await binary("java");
  if (!java.available) throw new Unavailable(java.hint ?? "Java ontbreekt");
  const { stdout } = await run(binaryCommand("java"), ["-jar", VNU_JAR, "--format", "json", "--stdout", "--exit-zero-always", sourcePath], { timeout: VNU_LIMIT_MS, maxBuffer: 32 * 1024 * 1024 });
  const messages = (JSON.parse(stdout) as { messages: VnuMessage[] }).messages;
  const findings = messages
    .filter((message) => message.type === "error" || message.subType === "warning")
    .map((message): SourceFinding => {
      const known = VNU_RULES.find(([pattern]) => pattern.test(message.message));
      const extract = (message.extract ?? "").replace(/\s+/g, " ").slice(0, 120);
      const id = /\bid="([^"]+)"/.exec(extract)?.[1];
      return {
        outcome: message.type === "error" ? "failed" : "cantTell",
        rule: known?.[1] ?? "other",
        criteria: known?.[2] ?? [],
        line: message.lastLine ?? message.firstLine ?? 0,
        column: message.firstColumn ?? 0,
        message: message.message.slice(0, 200),
        ...(extract ? { extract } : {}),
        ...(id ? { selector: `#${id}` } : {}),
      };
    });
  return count(findings);
}

/**
 * Where selectors lead in the page as it is now: the selectors given, and every id of the
 * page, because a finding of vnu can only be tied to an element through an id in its fragment.
 */
export async function sourcePlaces(page: Page, selectors: (string | undefined)[]): Promise<Map<string, string>> {
  await ensureHelpers(page);
  const wanted = [...new Set(selectors.filter((selector): selector is string => typeof selector === "string"))];
  const found = await page.evaluate((list) => {
    const helpers = (window as unknown as { __loepm: { where: (element: Element) => string | null } }).__loepm;
    const out: [string, string][] = [];
    const add = (selector: string): void => {
      try {
        const elements = document.querySelectorAll(selector);
        const place = elements.length === 1 ? helpers.where(elements[0]!) : null;
        if (place) out.push([selector, place]);
      } catch {
        // Not a selector this browser can read.
      }
    };
    for (const selector of list) add(selector);
    for (const element of document.querySelectorAll("[id]")) add(`#${CSS.escape(element.id)}`);
    return out;
  }, wanted);
  return new Map(found);
}

/** Tie the findings that carry a selector to an element of the page. The DOM may differ from the source; then there is no element. */
export function locateSourceFindings(methods: MethodResult<SourceAnswer>[], places: Map<string, string>): { withSelector: number; located: number; total: number } {
  const all = methods.flatMap((method) => method.result.findings);
  let located = 0;
  for (const finding of all) {
    if (!finding.selector) continue;
    finding.where = places.get(finding.selector) ?? null;
    if (finding.where) located++;
  }
  return { withSelector: all.filter((finding) => finding.selector).length, located, total: all.length };
}

export interface SourceLine {
  line: number;
  /** Per validator: the rules it reported on this line. */
  by: Record<string, string[]>;
  failedBy: string[];
  message: string;
  where: string | null;
}

/**
 * Lay the two validators next to each other per line of the source. A line that only one of
 * them reports as an error is a difference; the other may have no rule for it, or may read the source differently.
 */
export function compareSource(methods: MethodResult<SourceAnswer>[]): { lines: SourceLine[]; differences: string[] } {
  const lines = new Map<number, SourceLine>();
  for (const method of methods) {
    const id = idOf(method);
    for (const finding of method.result.findings) {
      const line = lines.get(finding.line) ?? { line: finding.line, by: {}, failedBy: [], message: finding.message, where: null };
      lines.set(finding.line, line);
      (line.by[id] ??= []).push(finding.rule);
      if (finding.outcome === "failed" && !line.failedBy.includes(id)) line.failedBy.push(id);
      line.where ??= finding.where ?? null;
    }
  }
  const sorted = [...lines.values()].sort((a, b) => a.line - b.line);
  const differences = methods.length < 2 ? [] : sorted.filter((line) => line.failedBy.length === 1).map((line) => `regel ${line.line}: alleen ${line.failedBy[0]} (${line.by[line.failedBy[0]!]!.join(", ")})`);
  return { lines: sorted, differences };
}
