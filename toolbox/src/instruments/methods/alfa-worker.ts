import { parentPort, workerData } from "node:worker_threads";
import { Audit } from "@siteimprove/alfa-act";
import { Node as AriaNode } from "@siteimprove/alfa-aria";
import type { Node as AlfaNode } from "@siteimprove/alfa-dom";
import alfaRules from "@siteimprove/alfa-rules";
import { Page } from "@siteimprove/alfa-web";
import { alfaDeepPath, alfaNodeAt } from "./rules.ts";

/** One outcome of an audit, as plain data: what the thread that asked needs of it. */
export interface AuditedOutcome {
  json: { outcome: string; rule: unknown; expectations?: unknown };
  hasTarget: boolean;
  /** The path of the target in loep's notation, null when there is none. */
  deep: string | null;
  /** Alfa's own path of the target. */
  path: string | null;
}

function pathsOf(target: unknown): { deep: string | null; path: string | null } {
  const node = (typeof (target as AlfaNode)?.parent === "function" ? target : [...(target as Iterable<AlfaNode>)][0]) as AlfaNode | undefined;
  if (!node) return { deep: null, path: null };
  let deep: string | null = null;
  let path: string | null = null;
  try {
    deep = alfaDeepPath(node);
  } catch {
    deep = null;
  }
  try {
    path = (node as unknown as { path(): string }).path();
  } catch {
    path = null;
  }
  return { deep, path };
}

const page = Page.from(workerData.page).getUnsafe();
if (workerData.deep !== undefined) {
  const node = alfaNodeAt(page.document, workerData.deep);
  if (!node) throw new Error("het element is niet teruggevonden in de kopie die Alfa van de pagina maakt");
  const aria = AriaNode.from(node, page.device);
  parentPort!.postMessage({ role: aria.role.map((role) => String(role.name)).getOr(null), name: aria.name.map((name) => name.value).getOr("") });
  process.exit(0);
}
const outcomes = [...(await Audit.of(page, alfaRules).evaluate())] as unknown as { toJSON(): AuditedOutcome["json"]; target?: unknown }[];
const audited: AuditedOutcome[] = outcomes.map((outcome) => {
  const { outcome: result, rule, expectations } = outcome.toJSON();
  const hasTarget = outcome.target !== undefined && outcome.target !== null;
  return { json: { outcome: result, rule, expectations }, hasTarget, ...(hasTarget ? pathsOf(outcome.target) : { deep: null, path: null }) };
});
parentPort!.postMessage(audited);
