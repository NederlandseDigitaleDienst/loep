import { Audit } from "@siteimprove/alfa-act";
import { Attribute, Document, Element, Shadow, type Node as AlfaNode } from "@siteimprove/alfa-dom";
import { Playwright } from "@siteimprove/alfa-playwright";
import alfaRules from "@siteimprove/alfa-rules";
import type { Page } from "playwright";
import { compareCriterionIds, criterionById, criterionIdFromAxeTag } from "../../lib/wcag.ts";
import type { MethodFailure, MethodResult } from "../methods.ts";
import { ownWorld } from "../../browser/world.ts";
import { axeSource, exportsOnThis, inOwnCapsule, packageSource } from "./capsule.ts";
import { knownError, runMethod, sortRan, toolboxRequire, type BrowserVersions } from "./registry.ts";

export type EngineId = "axe-core" | "alfa" | "ibm" | "qualweb";
export const ENGINE_IDS: EngineId[] = ["axe-core", "alfa", "ibm", "qualweb"];
export type RuleOutcome = "failed" | "cantTell" | "passed" | "inapplicable";

/** One outcome of one rule on one element, in the form every engine is brought to. */
export interface Finding {
  rule: string;
  outcome: RuleOutcome;
  /** Where the element is, in the toolbox's own notation; null when the outcome is about no element or the element was not found. */
  where: string | null;
  /**
   * How the engine's own pointer was tied to an element: "exact", "partial" (the frame was found, a
   * frame of another origin could not be entered), "none" (not found), "rule" (the outcome has no element).
   */
  match: "exact" | "partial" | "none" | "rule";
  /** The engine's own pointer, kept when it could not be tied to an element exactly. */
  locator?: string;
  message?: string;
  html?: string;
  /** Numbers the engine gave with the outcome, such as a contrast ratio. */
  data?: Record<string, unknown>;
  /** The engine itself does not count this as a WCAG violation: a recommendation. */
  advisory?: boolean;
}

export interface RuleInfo {
  criteria: string[];
  /** Ids of the ACT rules this rule implements, when the engine says so. */
  act: string[];
  title?: string;
  url?: string;
}

export interface EngineAnswer {
  rules: Record<string, RuleInfo>;
  findings: Finding[];
  counts: Record<RuleOutcome, number>;
  /** Outcomes about an element, and how many of those could be tied to an element of the page. */
  matching: { withElement: number; exact: number; partial: number; unmatched: number };
  notes?: string[];
}

export interface RulesRun {
  methods: MethodResult<EngineAnswer>[];
  failed: MethodFailure[];
  /** False when the page was not the same after the engines as before: one of them left something behind. */
  domUnchanged: boolean;
  /** The page uses light-dark() in its styles; some engines misread such colours. */
  usesLightDark: boolean;
  /** What the pointer was on and what had focus while the engines ran. An engine that works on a copy of the DOM does not see either. */
  live: { hover: string | null; focus: string | null };
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MAX_MESSAGE = 300;
const MAX_HTML = 200;

function summarise(rules: Record<string, RuleInfo>, findings: Finding[], notes: string[] = []): EngineAnswer {
  const counts: Record<RuleOutcome, number> = { failed: 0, cantTell: 0, passed: 0, inapplicable: 0 };
  const matching = { withElement: 0, exact: 0, partial: 0, unmatched: 0 };
  for (const finding of findings) {
    counts[finding.outcome]++;
    if (finding.match === "rule") continue;
    matching.withElement++;
    if (finding.match === "exact") matching.exact++;
    else if (finding.match === "partial") matching.partial++;
    else matching.unmatched++;
  }
  return { rules, findings, counts, matching, ...(notes.length > 0 ? { notes } : {}) };
}

interface RawAxe {
  rules: Record<string, { tags: string[]; act: string[]; url: string; title: string }>;
  findings: Finding[];
}

const AXE_BODY = `async (tags) => {
  const results = await axe.run(document, { runOnly: { type: "tag", values: tags }, rules: { "frame-tested": { enabled: true } }, resultTypes: ["violations", "incomplete", "passes", "inapplicable"] });
  const meta = Object.fromEntries(axe.getRules().map((rule) => [rule.ruleId, rule]));
  const rules = {};
  const findings = [];
  const add = (list, outcome) => {
    for (const rule of list) {
      rules[rule.id] = { tags: rule.tags, act: meta[rule.id]?.actIds ?? [], url: rule.helpUrl.split("?")[0], title: rule.help };
      if (rule.nodes.length === 0) {
        findings.push({ rule: rule.id, outcome, where: null, match: "rule" });
        continue;
      }
      for (const node of rule.nodes) {
        const found = __loepm.byAxeTarget(node.target);
        const finding = { rule: rule.id, outcome, where: found.where, match: found.where === null ? "none" : found.partial ? "partial" : "exact" };
        if (finding.match !== "exact") finding.locator = JSON.stringify(node.target);
        const checks = [...node.any, ...node.all, ...node.none];
        if (outcome === "failed" || outcome === "cantTell") {
          finding.message = checks.map((check) => check.message).join(" ").slice(0, ${MAX_MESSAGE});
          finding.html = node.html.replace(/<!--[\\s\\S]*?-->/g, "").slice(0, ${MAX_HTML});
        }
        const contrast = checks.find((check) => check.id === "color-contrast")?.data;
        if (contrast && contrast.contrastRatio !== undefined) finding.data = { ratio: contrast.contrastRatio, foreground: contrast.fgColor, background: contrast.bgColor, required: Number.parseFloat(contrast.expectedContrastRatio) || null, ...(contrast.messageKey ? { reason: contrast.messageKey } : {}) };
        else if (contrast && contrast.messageKey) finding.data = { reason: contrast.messageKey };
        const size = checks.find((check) => check.id === "target-size")?.data;
        if (size && size.width !== undefined) finding.data = { width: size.width, height: size.height, minimum: size.minSize, ...(size.messageKey ? { reason: size.messageKey } : {}) };
        findings.push(finding);
      }
    }
  };
  add(results.violations, "failed");
  add(results.incomplete, "cantTell");
  add(results.passes, "passed");
  add(results.inapplicable, "inapplicable");
  return { rules, findings };
}`;

/**
 * axe-core on the page and on every frame in it, each in loep's own world (#155). axe only looks inside
 * a frame when its own script is there too, so the script is put into each frame for as long as the run lasts.
 */
async function runAxe(page: Page): Promise<EngineAnswer> {
  const source = axeSource();
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  const prepared: typeof frames = [];
  for (const frame of frames) {
    const ok = await ownWorld(frame)
      .evaluate(`(function () { ${source}\n; return true; })()`)
      .then(() => true, () => false);
    if (ok) prepared.push(frame);
  }
  try {
    const raw = await inOwnCapsule<RawAxe>(page, [source], AXE_BODY, AXE_TAGS);
    const rules: Record<string, RuleInfo> = {};
    for (const [id, rule] of Object.entries(raw.rules)) {
      rules[id] = { criteria: rule.tags.map(criterionIdFromAxeTag).filter((criterion): criterion is string => criterion !== undefined).sort(compareCriterionIds), act: rule.act, title: rule.title, url: rule.url };
    }
    const untested = raw.findings.filter((finding) => finding.rule === "frame-tested" && finding.outcome !== "passed" && finding.match !== "rule").length;
    return summarise(rules, raw.findings, [`${prepared.length} van ${frames.length} frames geïnjecteerd`, ...(untested > 0 ? [`${untested} frames niet getest door axe`] : [])]);
  } finally {
    for (const frame of prepared) {
      await ownWorld(frame)
        .evaluate(() => void delete (window as unknown as { axe?: unknown }).axe)
        .catch(() => undefined);
    }
  }
}

/** Alfa's copy of the page: a snapshot of the DOM, shadow roots and frames included, with the computed layout. */
export type AlfaPage = Awaited<ReturnType<typeof Playwright.toPage>>;

/** Alfa's copy, made in loep's own world (#155): Alfa reads the page through a handle, and each function it runs on that handle runs there. */
export async function alfaPageOf(page: Page): Promise<AlfaPage> {
  const world = ownWorld(page);
  const on = (value: string) => ({ evaluate: (fn: unknown, options?: unknown) => world.evaluate(`(${String(fn)})(${value}${options === undefined ? "" : `, ${JSON.stringify(options)}`})`) });
  const document = { ...on("window.document"), evaluateHandle: async () => on("window") };
  return Playwright.toPage(document as unknown as Parameters<typeof Playwright.toPage>[0]);
}

/**
 * The path of a node in Alfa's copy of the page, with every shadow root and every frame it
 * crosses named. Alfa's own XPath leaves those out, so "/button[1]" could be anywhere.
 */
export function alfaDeepPath(node: AlfaNode): string | null {
  const steps: string[] = [];
  let current: AlfaNode = node;
  if (Attribute.isAttribute(current)) {
    const owner = current.owner;
    if (owner.isNone()) return null;
    current = owner.getUnsafe();
  }
  for (;;) {
    let next: AlfaNode | null;
    if (Element.isElement(current)) {
      const element: Element = current;
      const parent = element.parent();
      const same = parent.isSome() ? [...parent.getUnsafe().children()].filter((child) => Element.isElement(child) && child.name === element.name) : [element];
      steps.unshift(`${element.name}[${same.indexOf(element) + 1}]`);
      next = parent.getOr(null);
      if (next === null) break;
    } else if (Shadow.isShadow(current)) {
      next = current.host.getOr(null);
      if (next === null) return null;
      steps.unshift("#shadow");
    } else if (Document.isDocument(current)) {
      next = current.frame.getOr(null);
      if (next === null) break;
      steps.unshift("#document");
    } else {
      next = current.parent().getOr(null);
      if (next === null) return null;
    }
    current = next;
  }
  return `/${steps.join("/")}`;
}

/** The node in Alfa's copy at the end of a deep path as the in-page helper writes it. */
export function alfaNodeAt(root: AlfaNode, deepPath: string): AlfaNode | null {
  let current: AlfaNode = root;
  for (const step of deepPath.split("/").filter(Boolean)) {
    if (step === "#shadow") {
      const shadow = Element.isElement(current) ? current.shadow : null;
      if (!shadow || shadow.isNone()) return null;
      current = shadow.getUnsafe();
    } else if (step === "#document") {
      const content = Element.isElement(current) ? current.content : null;
      if (!content || content.isNone()) return null;
      current = content.getUnsafe();
    } else {
      const [, name, nth] = /^(.+?)\[(\d+)\]$/.exec(step) ?? [];
      const next = [...current.children()].filter((child) => Element.isElement(child) && child.name === name)[Number(nth) - 1];
      if (!next) return null;
      current = next;
    }
  }
  return current;
}

interface AlfaJson {
  outcome: RuleOutcome;
  rule: { uri: string; requirements: { type: string; chapter?: string; title?: string }[] };
  expectations?: [string, { type: string; error?: Record<string, unknown>; value?: Record<string, unknown> }][];
}

async function runAlfa(page: Page, alfaPage: AlfaPage): Promise<EngineAnswer> {
  const outcomes = [...(await Audit.of(alfaPage, alfaRules).evaluate())] as unknown as { toJSON(): unknown; target?: unknown }[];
  const rules: Record<string, RuleInfo> = {};
  const findings: (Finding & { deep?: string | null })[] = [];
  for (const outcome of outcomes) {
    const json = outcome.toJSON() as AlfaJson;
    const rule = json.rule.uri.split("/").pop()!;
    rules[rule] ??= {
      criteria: json.rule.requirements.filter((requirement) => requirement.type === "criterion" && requirement.chapter).map((requirement) => requirement.chapter!).sort(compareCriterionIds),
      act: [],
      url: json.rule.uri,
    };
    if (json.outcome === "inapplicable" || outcome.target === undefined || outcome.target === null) {
      findings.push({ rule, outcome: json.outcome, where: null, match: "rule" });
      continue;
    }
    // Some rules judge a group of nodes together; the first of them stands for the group.
    const target = outcome.target as AlfaNode | Iterable<AlfaNode>;
    const node = typeof (target as AlfaNode).parent === "function" ? (target as AlfaNode) : ([...(target as Iterable<AlfaNode>)][0] ?? null);
    let deep: string | null = null;
    try {
      deep = node ? alfaDeepPath(node) : null;
    } catch {
      deep = null;
    }
    const finding: Finding & { deep?: string | null } = { rule, outcome: json.outcome, where: null, match: "none", deep };
    const expectations = (json.expectations ?? []).map(([, expectation]) => expectation);
    if (json.outcome === "failed" || json.outcome === "cantTell") {
      finding.message = expectations.map((expectation) => (expectation.type === "err" ? (expectation.error?.message as string | undefined) : undefined)).filter(Boolean).join(" ").slice(0, MAX_MESSAGE);
    }
    const pairings = expectations.flatMap((expectation) => ((expectation.error ?? expectation.value)?.pairings as { contrast: number }[] | undefined) ?? []);
    if (pairings.length > 0) finding.data = { ratio: Math.max(...pairings.map((pairing) => pairing.contrast)) };
    findings.push(finding);
  }
  // One trip to the page for all the paths: there each becomes a place in the toolbox's notation.
  const paths = [...new Set(findings.map((finding) => finding.deep).filter((deep): deep is string => typeof deep === "string"))];
  const places = await ownWorld(page).evaluate(
    (list: string[]) => {
      const helpers = (window as unknown as { __loepm: { byDeepXPath: (path: string) => Element | null; where: (element: Element) => string | null } }).__loepm;
      return list.map((path) => {
        const element = helpers.byDeepXPath(path);
        return element ? helpers.where(element) : null;
      });
    },
    paths,
  );
  const placeOf = new Map(paths.map((path, index) => [path, places[index] ?? null]));
  for (const finding of findings) {
    if (finding.match === "rule") continue;
    const deep = finding.deep;
    delete finding.deep;
    finding.where = deep ? (placeOf.get(deep) ?? null) : null;
    finding.match = finding.where ? "exact" : "none";
    if (!finding.where) finding.locator = deep ?? "(geen pad)";
  }
  return summarise(rules, findings);
}

const IBM_BODY = `async () => {
  const checker = new ace.Checker();
  const report = await checker.check(document, ["WCAG_2_2"]);
  const map = checker.engine.ruleMap;
  const rules = {};
  const findings = [];
  for (const result of report.results) {
    if (!rules[result.ruleId]) {
      const info = map[result.ruleId] ?? {};
      const sets = (info.rulesets ?? []).filter((set) => [].concat(set.id).includes("WCAG_2_2"));
      const act = [].concat(info.act ?? []).flatMap((entry) => (typeof entry === "string" ? [entry] : entry && typeof entry === "object" ? Object.keys(entry) : []));
      rules[result.ruleId] = { criteria: [...new Set(sets.flatMap((set) => [].concat(set.num)))], act };
    }
    const outcome = result.value[1] === "PASS" ? "passed" : result.value[1] === "FAIL" ? "failed" : "cantTell";
    const where = result.node ? __loepm.where(result.node) : null;
    const finding = { rule: result.ruleId, outcome, where, match: where ? "exact" : "none" };
    if (!where) finding.locator = result.path?.dom ?? "";
    if (result.value[0] !== "VIOLATION") finding.advisory = true;
    if (outcome !== "passed") {
      finding.message = String(result.message ?? "").slice(0, ${MAX_MESSAGE});
      finding.html = String(result.snippet ?? "").slice(0, ${MAX_HTML});
    }
    if (result.ruleId === "text_contrast_sufficient" && Array.isArray(result.messageArgs) && result.messageArgs.length >= 5) {
      finding.data = { ratio: Number(result.messageArgs[0]), foreground: result.messageArgs[3], background: result.messageArgs[4] };
    }
    if (result.ruleId === "target_spacing_sufficient") finding.data = { reason: result.reasonId };
    findings.push(finding);
  }
  return { rules, findings };
}`;

async function runIbm(page: Page): Promise<EngineAnswer> {
  const raw = await inOwnCapsule<{ rules: Record<string, RuleInfo>; findings: Finding[] }>(page, [packageSource("accessibility-checker-engine/ace.js")], IBM_BODY);
  for (const rule of Object.values(raw.rules)) rule.criteria.sort(compareCriterionIds);
  return summarise(raw.rules, raw.findings);
}

/** Attributes QualWeb writes on the elements of the page while it runs. They are taken away again afterwards. */
const QUALWEB_ATTRIBUTES = ["qw-selector", "qw-css-rules", "_documentSelector"];

const QUALWEB_BODY = `async (translation) => {
  // QualWeb gives a CSS pointer that names neither the frame nor the shadow root an element is
  // in. Every pointer it hands out is noted here together with the element it was made for.
  // The same pointer can exist in the page and in a frame. A result is made by asking an
  // element first for its HTML and then for its pointer, so the pair of the two is noted as well.
  const elementsByPointer = new Map();
  const elementsByPair = new Map();
  const note = (map, key, element) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(element);
  };
  const strip = (html) => html.replace(/ (?:qw-selector|qw-css-rules|_documentSelector)="[^"]*"/g, "");
  const prototype = Object.getPrototypeOf(window.qwPage.createQWElement(document.documentElement));
  const original = prototype.getElementSelector;
  const originalHtml = prototype.getElementHtmlCode;
  let last = null;
  prototype.getElementHtmlCode = function (...parameters) {
    const html = originalHtml.apply(this, parameters);
    last = { element: this.element, html: strip(String(html ?? "")) };
    return html;
  };
  prototype.getElementSelector = function () {
    const pointer = original.call(this);
    note(elementsByPointer, pointer, this.element);
    if (last && last.element === this.element) note(elementsByPair, pointer + "\\n" + last.html, this.element);
    return pointer;
  };
  const openingTag = (element) => {
    const clone = element.cloneNode(false);
    for (const name of ${JSON.stringify(QUALWEB_ATTRIBUTES)}) clone.removeAttribute(name);
    const html = clone.outerHTML;
    return html.slice(0, html.indexOf(">") + 1);
  };
  try {
    const reports = [new ACTRulesRunner({}, translation).configure({}).test({}).getReport(), new WCAGTechniquesRunner({}, translation).configure({}).test({}).getReport()];
    const rules = {};
    const findings = [];
    for (const report of reports) {
      for (const assertion of Object.values(report.assertions)) {
        const isAct = (assertion.metadata.type ?? []).includes("ACTRule");
        rules[assertion.code] = { criteria: (assertion.metadata["success-criteria"] ?? []).map((criterion) => criterion.name), act: isAct && assertion.mapping ? [assertion.mapping] : [], title: assertion.name, url: assertion.metadata.url };
        if (!assertion.results || assertion.results.length === 0) {
          findings.push({ rule: assertion.code, outcome: assertion.metadata.outcome === "warning" ? "cantTell" : assertion.metadata.outcome, where: null, match: "rule" });
          continue;
        }
        for (const result of assertion.results) {
          const outcome = result.verdict === "warning" ? "cantTell" : result.verdict;
          const elements = result.elements && result.elements.length > 0 ? result.elements : [null];
          for (const entry of elements) {
            if (!entry) {
              findings.push({ rule: assertion.code, outcome, where: null, match: "rule", ...(outcome === "failed" || outcome === "cantTell" ? { message: String(result.description ?? "").slice(0, ${MAX_MESSAGE}) } : {}) });
              continue;
            }
            const html = strip(String(entry.htmlCode ?? ""));
            let candidates = [...(elementsByPair.get(entry.pointer + "\\n" + html) ?? elementsByPointer.get(entry.pointer) ?? [])].filter((element) => element.isConnected);
            if (candidates.length > 1) candidates = candidates.filter((element) => html.startsWith(openingTag(element)));
            const where = candidates.length === 1 ? __loepm.where(candidates[0]) : null;
            const finding = { rule: assertion.code, outcome, where, match: where ? "exact" : "none" };
            if (!where) finding.locator = (candidates.length > 1 ? "(" + candidates.length + " kandidaten) " : "") + entry.pointer;
            if (outcome === "failed" || outcome === "cantTell") {
              finding.message = String(result.description ?? "").slice(0, ${MAX_MESSAGE});
              finding.html = html.slice(0, ${MAX_HTML});
            }
            const ratio = /(\\d+(?:\\.\\d+)?)\\s*:\\s*1|ratio of (\\d+(?:\\.\\d+)?)/.exec(String(result.description ?? ""));
            if (ratio) finding.data = { ratio: Number(ratio[1] ?? ratio[2]) };
            if (result.resultCode) finding.data = { ...(finding.data ?? {}), code: result.resultCode };
            findings.push(finding);
          }
        }
      }
    }
    return { rules, findings };
  } finally {
    prototype.getElementSelector = original;
    prototype.getElementHtmlCode = originalHtml;
    __loepm.removeAttributes(${JSON.stringify(QUALWEB_ATTRIBUTES)});
  }
}`;

let qualwebTranslation: unknown;

async function runQualweb(page: Page): Promise<EngineAnswer> {
  qualwebTranslation ??= (toolboxRequire("@qualweb/locale") as { LocaleFetcher: { transform: (options: unknown) => unknown } }).LocaleFetcher.transform({ translate: "en", fallback: "en" });
  const libraries = ["@qualweb/qw-page", "@qualweb/util", "@qualweb/locale", "@qualweb/act-rules", "@qualweb/wcag-techniques"].map((name) => exportsOnThis(packageSource(name)));
  const raw = await inOwnCapsule<{ rules: Record<string, RuleInfo>; findings: Finding[] }>(page, libraries, QUALWEB_BODY, qualwebTranslation);
  for (const rule of Object.values(raw.rules)) rule.criteria.sort(compareCriterionIds);
  return summarise(raw.rules, raw.findings, ["schrijft tijdens het draaien attributen in de DOM; die zijn daarna weer weggehaald"]);
}

const snapshotOf = (page: Page): Promise<string | null> =>
  ownWorld(page)
    .evaluate(() => (window as unknown as { __loep: { contentSnapshot: () => string } }).__loep.contentSnapshot())
    .catch(() => null);

const ENGINE_LIMIT_MS = 45_000;

/**
 * Run every rule engine on the page as it is now, one after the other, each on its own: a
 * crash or a timeout of one leaves the answers of the others standing. QualWeb goes last,
 * because it writes into the DOM while it runs.
 */
export async function runRuleEngines(page: Page, browsers: BrowserVersions, share: { alfaPage?: AlfaPage } = {}, between: () => Promise<void> = async () => undefined): Promise<RulesRun> {
  const before = await snapshotOf(page);
  const usesLightDark = await ownWorld(page)
    .evaluate(() => {
      const uses = (text: string | null): boolean => text !== null && text.includes("light-dark(");
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) if (uses(rule.cssText)) return true;
        } catch {
          // A stylesheet of another origin cannot be read.
        }
      }
      return [...document.querySelectorAll("[style]")].some((element) => uses(element.getAttribute("style")));
    })
    .catch(() => false);
  const live = await ownWorld(page)
    .evaluate(() => (window as unknown as { __loepm: { liveState: () => { hover: string | null; focus: string | null } } }).__loepm.liveState())
    .catch(() => ({ hover: null, focus: null }));
  // An engine may scroll or move focus while it runs. `between` puts the page back in the state it was in, so each engine sees the same.
  const ran = [];
  ran.push(await runMethod("axe-core", browsers, () => runAxe(page), ENGINE_LIMIT_MS));
  await between();
  ran.push(await runMethod("alfa", browsers, async () => runAlfa(page, (share.alfaPage ??= await alfaPageOf(page))), ENGINE_LIMIT_MS));
  ran.push(await runMethod("ibm", browsers, () => runIbm(page), ENGINE_LIMIT_MS));
  await between();
  ran.push(await runMethod("qualweb", browsers, () => runQualweb(page), ENGINE_LIMIT_MS));
  await between();
  const after = await snapshotOf(page);
  return { ...sortRan(ran), domUnchanged: before === after, usesLightDark, live };
}

export const engineOf = (method: { implementation: string }): EngineId => (method.implementation === "accessibility-checker-engine" ? "ibm" : (method.implementation as EngineId));

/** A finding with the engine that made it and what the rule is about. */
export interface Located extends Finding {
  engine: EngineId;
  criteria: string[];
  act: string[];
}

/** Every finding of every engine in one list. Recommendations that an engine itself does not count for WCAG are left out. */
export function allFindings(run: RulesRun, includeAdvisory = false): Located[] {
  const out: Located[] = [];
  for (const method of run.methods) {
    const engine = engineOf(method);
    for (const finding of method.result.findings) {
      if (finding.advisory && !includeAdvisory) continue;
      const rule = method.result.rules[finding.rule];
      out.push({ ...finding, engine, criteria: rule?.criteria ?? [], act: rule?.act ?? [] });
    }
  }
  return out;
}

type Verdict = "failed" | "cantTell" | "passed" | "silent";

const verdictOf = (outcomes: Set<RuleOutcome> | undefined): Verdict => (!outcomes ? "silent" : outcomes.has("failed") ? "failed" : outcomes.has("cantTell") ? "cantTell" : outcomes.has("passed") ? "passed" : "silent");

/**
 * What the engines together say: "agree" when at least two fail it and none passes it,
 * "alone" when one engine fails it and the others say nothing, "contradiction" when one
 * fails what another passes, "cantTell" when nobody fails it and somebody is not sure.
 */
export type Flag = "agree" | "alone" | "contradiction" | "cantTell" | "passed";

export function flagOf(verdicts: Record<string, Verdict | string>): Flag {
  const values = Object.values(verdicts);
  const failed = values.filter((value) => value === "failed").length;
  const passed = values.filter((value) => value === "passed").length;
  if (failed > 0 && passed > 0) return "contradiction";
  if (failed > 1) return "agree";
  if (failed === 1) return "alone";
  return values.includes("cantTell") ? "cantTell" : "passed";
}

export interface ElementGroup {
  criterion: string;
  where: string;
  verdicts: Record<EngineId, Verdict>;
  /** Per engine that failed it or could not tell: the rules that said so. */
  rules: Partial<Record<EngineId, string[]>>;
  flag: Flag;
  message: string | null;
  /** Engines whose answer here is of a kind they are known to get wrong, with the reason. */
  knownUnreliable?: { engine: EngineId; reason: string }[];
}

export interface CriterionGroup {
  criterion: string;
  verdicts: Record<EngineId, Verdict>;
  /** Number of elements each engine failed. */
  failedElements: Record<EngineId, number>;
  flag: Flag;
}

export interface Grouped {
  criteria: CriterionGroup[];
  elements: ElementGroup[];
  /** Failed or uncertain outcomes about an element that could not be found on the page, per engine. */
  unlocated: Partial<Record<EngineId, number>>;
}

/** The known systematic errors that apply to a finding on this page. */
export function knownFor(finding: { engine: EngineId; rule: string; where?: string | null }, run: RulesRun): string | undefined {
  if (finding.engine === "alfa" && finding.where && (finding.where === run.live.hover || finding.where === run.live.focus) && ["sia-r69", "sia-r66", "sia-r65", "sia-r62"].includes(finding.rule)) return knownError("alfa", "live-state");
  if (finding.engine === "alfa" && run.usesLightDark && ["sia-r69", "sia-r66"].includes(finding.rule)) return knownError("alfa", "light-dark");
  if (finding.engine === "qualweb" && finding.rule === "QW-WCAG-T17") return knownError("qualweb", "QW-WCAG-T17");
  return undefined;
}

/**
 * Lay the outcomes of the engines next to each other, per success criterion and per element.
 * Only criteria of level A and AA count. Nothing is decided here: an element that one engine
 * fails and another passes is listed with both.
 */
export function groupFindings(run: RulesRun, only: { criterion?: string; places?: Set<string> } = {}): Grouped {
  const engines = run.methods.map(engineOf);
  const perCriterion = new Map<string, Map<EngineId, Set<RuleOutcome>>>();
  const failedPlaces = new Map<string, Map<EngineId, Set<string>>>();
  const perElement = new Map<string, { criterion: string; where: string; outcomes: Map<EngineId, Set<RuleOutcome>>; rules: Map<EngineId, Set<string>>; message: string | null; known: Map<EngineId, string> }>();
  const unlocated: Partial<Record<EngineId, number>> = {};
  for (const finding of allFindings(run)) {
    if (only.places && !(finding.where !== null && only.places.has(finding.where))) continue;
    if ((finding.outcome === "failed" || finding.outcome === "cantTell") && finding.match !== "rule" && finding.where === null) unlocated[finding.engine] = (unlocated[finding.engine] ?? 0) + 1;
    for (const criterion of finding.criteria) {
      const known = criterionById(criterion);
      if (!known || known.level === "AAA") continue;
      if (only.criterion && criterion !== only.criterion) continue;
      const outcomes = perCriterion.get(criterion) ?? new Map<EngineId, Set<RuleOutcome>>();
      perCriterion.set(criterion, outcomes);
      if (!outcomes.has(finding.engine)) outcomes.set(finding.engine, new Set());
      outcomes.get(finding.engine)!.add(finding.outcome);
      if (finding.where === null) continue;
      if (finding.outcome === "failed") {
        const places = failedPlaces.get(criterion) ?? new Map<EngineId, Set<string>>();
        failedPlaces.set(criterion, places);
        if (!places.has(finding.engine)) places.set(finding.engine, new Set());
        places.get(finding.engine)!.add(finding.where);
      }
      const key = `${criterion}\n${finding.where}`;
      const element = perElement.get(key) ?? { criterion, where: finding.where, outcomes: new Map(), rules: new Map(), message: null, known: new Map<EngineId, string>() };
      perElement.set(key, element);
      if (!element.outcomes.has(finding.engine)) element.outcomes.set(finding.engine, new Set());
      element.outcomes.get(finding.engine)!.add(finding.outcome);
      if (finding.outcome === "failed" || finding.outcome === "cantTell") {
        if (!element.rules.has(finding.engine)) element.rules.set(finding.engine, new Set());
        element.rules.get(finding.engine)!.add(finding.rule);
        element.message ??= finding.message ?? null;
      }
      const reason = knownFor(finding, run);
      if (reason) element.known.set(finding.engine, reason);
    }
  }
  const verdicts = (outcomes: Map<EngineId, Set<RuleOutcome>>): Record<EngineId, Verdict> => Object.fromEntries(engines.map((engine) => [engine, verdictOf(outcomes.get(engine))])) as Record<EngineId, Verdict>;
  const criteria = [...perCriterion.entries()]
    .map(([criterion, outcomes]) => {
      const own = verdicts(outcomes);
      return { criterion, verdicts: own, failedElements: Object.fromEntries(engines.map((engine) => [engine, failedPlaces.get(criterion)?.get(engine)?.size ?? 0])) as Record<EngineId, number>, flag: flagOf(own) };
    })
    .sort((a, b) => compareCriterionIds(a.criterion, b.criterion));
  const elements = [...perElement.values()]
    .map((element) => {
      const own = verdicts(element.outcomes);
      return { criterion: element.criterion, where: element.where, verdicts: own, rules: Object.fromEntries([...element.rules.entries()].map(([engine, rules]) => [engine, [...rules].sort()])), flag: flagOf(own), message: element.message, ...(element.known.size > 0 ? { knownUnreliable: [...element.known.entries()].map(([engine, reason]) => ({ engine, reason })) } : {}) };
    })
    .filter((element) => only.places !== undefined || element.flag !== "passed")
    .sort((a, b) => compareCriterionIds(a.criterion, b.criterion) || a.where.localeCompare(b.where));
  return { criteria, elements, unlocated };
}

/** The share of outcomes about an element that could be tied to an element of the page, per engine and in total. */
export function matchShare(run: RulesRun): { perEngine: Record<string, string>; total: { withElement: number; exact: number; partial: number; unmatched: number } } {
  const total = { withElement: 0, exact: 0, partial: 0, unmatched: 0 };
  const perEngine: Record<string, string> = {};
  for (const method of run.methods) {
    const matching = method.result.matching;
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += matching[key];
    perEngine[engineOf(method)] = `${matching.exact}/${matching.withElement}${matching.partial > 0 ? ` (+${matching.partial} deels)` : ""}`;
  }
  return { perEngine, total };
}
