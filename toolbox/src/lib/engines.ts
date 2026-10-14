import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Audit } from "@siteimprove/alfa-act";
import { Playwright } from "@siteimprove/alfa-playwright";
import alfaRules from "@siteimprove/alfa-rules";
import type { Page } from "playwright";
import { compareCriterionIds, criterionIdFromAxeTag } from "./wcag.ts";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MAX_NODES_PER_RULE = 100;

export type EngineOutcome = "failed" | "cantTell" | "passed" | "inapplicable";

export interface EngineNode {
  /** Selector chain (axe) or XPath (Alfa) that locates the element. */
  target: string;
  html?: string;
  message?: string;
}

export interface EngineResult {
  engine: "axe-core" | "alfa";
  rule: string;
  ruleUrl: string;
  outcome: EngineOutcome;
  criteria: string[];
  description: string;
  impact?: string | null;
  nodeCount: number;
  nodes: EngineNode[];
}

export interface EngineRun {
  status: Record<"axe-core" | "alfa", { ok: boolean; error?: string; version: string }>;
  summary: Record<string, number>;
  results: EngineResult[];
}

interface AxeNode {
  target: unknown[];
  html: string;
  failureSummary?: string;
  any: { message: string }[];
  all: { message: string }[];
  none: { message: string }[];
}

interface AxeRule {
  id: string;
  impact: string | null;
  tags: string[];
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

interface AxeResults {
  testEngine: { version: string };
  violations: AxeRule[];
  incomplete: AxeRule[];
  passes: AxeRule[];
  inapplicable: AxeRule[];
}

function axeTarget(target: unknown[]): string {
  // A nested array is a path through shadow roots; axe gives one selector per level.
  return target.map((part) => (Array.isArray(part) ? part.join(" >>> ") : String(part))).join(" | ");
}

function fromAxe(results: AxeResults): EngineResult[] {
  const convert = (rules: AxeRule[], outcome: EngineOutcome): EngineResult[] =>
    rules.map((rule) => ({
      engine: "axe-core" as const,
      rule: rule.id,
      ruleUrl: rule.helpUrl.split("?")[0]!,
      outcome,
      criteria: rule.tags.map(criterionIdFromAxeTag).filter((id): id is string => id !== undefined).sort(compareCriterionIds),
      description: rule.help,
      impact: rule.impact,
      nodeCount: rule.nodes.length,
      nodes: rule.nodes.slice(0, MAX_NODES_PER_RULE).map((node) => ({
        target: axeTarget(node.target),
        ...(outcome === "failed" || outcome === "cantTell"
          ? {
              // Comments carry no meaning and some libraries put a random marker in them on every load.
              html: node.html.replace(/<!--[\s\S]*?-->/g, "").slice(0, 400),
              message: [...node.any, ...node.all, ...node.none].map((check) => check.message).join(" ").slice(0, 600),
            }
          : {}),
      })),
    }));
  return [
    ...convert(results.violations, "failed"),
    ...convert(results.incomplete, "cantTell"),
    ...convert(results.passes, "passed"),
    ...convert(results.inapplicable, "inapplicable"),
  ];
}

interface AlfaOutcome {
  toJSON(): unknown;
}

interface AlfaJson {
  outcome: EngineOutcome;
  rule: { uri: string; requirements: { type: string; chapter?: string; title?: string }[] };
  target?: { type?: string; name?: string } | null;
  expectations?: [string, { type: string; error?: { message?: string }; value?: { message?: string } }][];
}

function alfaTarget(outcome: AlfaOutcome): string {
  const target = (outcome as unknown as { target?: { path?: () => string } }).target;
  try {
    return target?.path?.() ?? "document";
  } catch {
    return "document";
  }
}

function fromAlfa(outcomes: AlfaOutcome[]): EngineResult[] {
  const grouped = new Map<string, EngineResult>();
  for (const outcome of outcomes) {
    const json = outcome.toJSON() as unknown as AlfaJson;
    const rule = json.rule.uri.split("/").pop()!;
    const key = `${rule}:${json.outcome}`;
    let result = grouped.get(key);
    if (!result) {
      result = {
        engine: "alfa",
        rule,
        ruleUrl: json.rule.uri,
        outcome: json.outcome,
        criteria: json.rule.requirements
          .filter((requirement) => requirement.type === "criterion" && requirement.chapter)
          .map((requirement) => requirement.chapter!)
          .sort(compareCriterionIds),
        description: json.rule.requirements.map((requirement) => requirement.title).filter(Boolean).join("; "),
        nodeCount: 0,
        nodes: [],
      };
      grouped.set(key, result);
    }
    result.nodeCount++;
    if (json.outcome === "inapplicable" || result.nodes.length >= MAX_NODES_PER_RULE) continue;
    const messages = (json.expectations ?? [])
      .map(([, expectation]) => (expectation.type === "err" ? expectation.error?.message : undefined))
      .filter(Boolean);
    result.nodes.push({
      target: alfaTarget(outcome),
      ...(json.outcome === "failed" || json.outcome === "cantTell" ? { message: messages.join(" ").slice(0, 600) } : {}),
    });
  }
  return [...grouped.values()];
}

const OUTCOME_ORDER: EngineOutcome[] = ["failed", "cantTell", "passed", "inapplicable"];

/** Run both rule engines on the page as it is now and keep every outcome, including passes. */
export async function runEngines(page: Page): Promise<EngineRun> {
  const results: EngineResult[] = [];
  const status: EngineRun["status"] = {
    "axe-core": { ok: false, version: "unknown" },
    alfa: { ok: false, version: "unknown" },
  };

  try {
    await page.evaluate(AXE_SOURCE);
    const axe = (await page.evaluate(
      (tags) =>
        (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<unknown> } }).axe.run(document, {
          runOnly: { type: "tag", values: tags },
          resultTypes: ["violations", "incomplete", "passes", "inapplicable"],
        }),
      AXE_TAGS,
    )) as AxeResults;
    results.push(...fromAxe(axe));
    status["axe-core"] = { ok: true, version: axe.testEngine.version };
  } catch (error) {
    status["axe-core"] = { ok: false, version: "unknown", error: (error as Error).message.split("\n")[0]! };
  }

  try {
    const handle = await page.evaluateHandle(() => window.document);
    const alfaPage = await Playwright.toPage(handle);
    const outcomes: AlfaOutcome[] = [...(await Audit.of(alfaPage, alfaRules).evaluate())];
    results.push(...fromAlfa(outcomes));
    status.alfa = { ok: true, version: require("@siteimprove/alfa-rules/package.json").version as string };
  } catch (error) {
    status.alfa = { ok: false, version: "unknown", error: (error as Error).message.split("\n")[0]! };
  }

  results.sort(
    (a, b) =>
      OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) ||
      a.engine.localeCompare(b.engine) ||
      a.rule.localeCompare(b.rule),
  );
  const summary: Record<string, number> = {};
  for (const result of results) {
    const key = `${result.engine}:${result.outcome}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return { status, summary, results };
}
