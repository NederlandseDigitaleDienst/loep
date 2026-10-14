import { Node as AriaNode } from "@siteimprove/alfa-aria";
import type { Page } from "playwright";
import type { MethodFailure, MethodResult } from "../methods.ts";
import { commonJsBundle, ensureHelpers, inCapsule, packageSource } from "./capsule.ts";
import { idOf, knownError, runMethod, sortRan, type BrowserVersions } from "./registry.ts";
import { alfaNodeAt, alfaPageOf, type AlfaPage } from "./rules.ts";

/** What one method says an element is called and what it is. */
export interface NameAnswer {
  role: string | null;
  name: string;
  /** The method says assistive technology does not get this element at all. */
  ignored?: boolean;
  /** States the method reports with the name, when it has them. */
  properties?: Record<string, unknown>;
  description?: string | null;
}

const squash = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

async function chromiumName(page: Page, where: string): Promise<NameAnswer> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression: `window.__loepm.resolveWhere(${JSON.stringify(where)})` });
    if (!result.objectId) throw new Error("het element is van de pagina verdwenen");
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const node = nodes[0];
    if (!node) throw new Error("de browser gaf geen toegankelijkheidsinformatie voor dit element");
    return {
      role: (node.role?.value as string | undefined) ?? null,
      name: squash(node.name?.value as string | undefined),
      description: (node.description?.value as string | undefined) ?? null,
      ...(node.ignored ? { ignored: true } : {}),
      properties: Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value.value])),
    };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function alfaName(page: Page, where: string, alfaPage: AlfaPage): Promise<NameAnswer> {
  const deep = await page.evaluate((place) => {
    const helpers = (window as unknown as { __loepm: { resolveWhere: (place: string) => Element | null; deepXPath: (element: Element) => string } }).__loepm;
    const element = helpers.resolveWhere(place);
    return element ? helpers.deepXPath(element) : null;
  }, where);
  const node = deep ? alfaNodeAt(alfaPage.document, deep) : null;
  if (!node) throw new Error("het element is niet teruggevonden in de kopie die Alfa van de pagina maakt");
  const aria = AriaNode.from(node, alfaPage.device);
  return { role: aria.role.map((role) => String(role.name)).getOr(null), name: squash(aria.name.map((name) => name.value).getOr("")) };
}

const AXE_NAME_BODY = `(where) => {
  const element = __loepm.resolveWhere(where);
  if (!element) throw new Error("het element is van de pagina verdwenen");
  axe.setup(document);
  try {
    return { role: axe.commons.aria.getRole(element) ?? null, name: axe.commons.text.accessibleText(element) ?? "" };
  } finally {
    axe.teardown();
  }
}`;

const DAA_BODY = `(where) => {
  const element = __loepm.resolveWhere(where);
  if (!element) throw new Error("het element is van de pagina verdwenen");
  return { role: __daa.getRole(element) ?? null, name: __daa.computeAccessibleName(element) ?? "", placeholder: element.getAttribute("placeholder") };
}`;

/** The first line of an aria snapshot: `- button "Name" [pressed]:` or `- text: ...`. */
export function parseSnapshotLine(snapshot: string): NameAnswer {
  const line = snapshot.split("\n")[0] ?? "";
  const found = /^- (?:'|")?([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
  if (!found || found[1] === "text") return { role: null, name: "" };
  return { role: found[1]!, name: squash((found[2] ?? "").replace(/\\(.)/g, "$1")) };
}

async function playwrightName(page: Page, where: string): Promise<NameAnswer> {
  // Playwright's own selector engine goes through open shadow roots; each level of the chain narrows the search.
  const selector = where.split(" >>> ").map((segment) => `css=${segment}`).join(" >> ");
  const snapshot = await page.locator(selector).first().ariaSnapshot({ timeout: 3000 });
  return parseSnapshotLine(snapshot);
}

const NAME_LIMIT_MS = 15_000;

export interface NamesRun {
  methods: MethodResult<NameAnswer>[];
  failed: MethodFailure[];
}

/**
 * The accessible name and role of one element by every method that works in this browser:
 * the browser's own accessibility tree and four separate implementations of the name computation.
 */
export async function namesOf(page: Page, where: string, browsers: BrowserVersions, share: { alfaPage?: AlfaPage } = {}): Promise<NamesRun> {
  await ensureHelpers(page);
  const inFrame = where.includes(" | ");
  const ran = [
    await runMethod("chromium", browsers, () => chromiumName(page, where), NAME_LIMIT_MS),
    await runMethod("alfa-aria", browsers, async () => alfaName(page, where, (share.alfaPage ??= await alfaPageOf(page))), NAME_LIMIT_MS),
    await runMethod("axe-name", browsers, async () => {
      if (inFrame) throw new Error("axe rekent een naam alleen uit voor een element van het document zelf, niet van een frame");
      const answer = await inCapsule<NameAnswer>(page, [packageSource("axe-core/axe.min.js")], AXE_NAME_BODY, where);
      return { role: answer.role, name: squash(answer.name) };
    }, NAME_LIMIT_MS),
    await runMethod("playwright", browsers, () => {
      if (inFrame) throw new Error("ariaSnapshot laat de inhoud van frames weg");
      return playwrightName(page, where);
    }, NAME_LIMIT_MS),
    await runMethod("dom-accessibility-api", browsers, async () => {
      const answer = await inCapsule<NameAnswer & { placeholder: string | null }>(page, [`var __daa = ${commonJsBundle("dom-accessibility-api", "dist/index.js")};`], DAA_BODY, where);
      return { role: answer.role, name: squash(answer.name), ...(answer.placeholder ? { properties: { placeholder: answer.placeholder } } : {}) };
    }, NAME_LIMIT_MS),
  ];
  return sortRan(ran);
}

/**
 * Role names that mean "no role worth naming". A browser's tree names every node; a name
 * computation gives nothing for a paragraph. Without this every paragraph would be a disagreement.
 */
const NO_ROLE = new Set(["", "generic", "none", "presentation", "paragraph", "statictext", "text", "labeltext", "div", "span", "genericcontainer", "layoutblockflow", "layouttablecell", "inlinetextbox", "ignored", "unknown", "group", "webarea"]);
/** Names a browser's tree uses for a role that ARIA calls something else. */
const ROLE_ALIASES: Record<string, string> = { image: "img", popupbutton: "combobox", menulistpopup: "listbox", textfield: "textbox", textarea: "textbox", searchfield: "searchbox", statictext: "", listmarker: "", checkbox: "checkbox", radiobutton: "radio", "tab group": "tablist", "disclosure triangle": "button", definition: "definition", imagebutton: "button" };

export function comparableRole(role: string | null): string | null {
  const lower = (role ?? "").toLowerCase();
  const aliased = ROLE_ALIASES[lower] ?? lower;
  return NO_ROLE.has(aliased) ? null : aliased;
}

export const sayName = (answer: NameAnswer): string => `${comparableRole(answer.role) ?? "-"} "${answer.name}"`;

export interface AnswerGroup {
  value: string;
  by: string[];
  /** Why the methods of this group are known to be unreliable for this answer, when they are. */
  knownUnreliable?: string;
}

/**
 * Group the methods by the answer they gave, in the order the methods ran. One group means
 * they agree. Nothing is counted or chosen: a group of one is as much an answer as a group of five.
 */
export function groupAnswers<T>(methods: MethodResult<T>[], say: (result: T) => string): AnswerGroup[] {
  const groups: AnswerGroup[] = [];
  for (const method of methods) {
    const value = say(method.result);
    const known = method.knownUnreliable;
    const group = groups.find((entry) => entry.value === value && entry.knownUnreliable === known);
    if (group) group.by.push(idOf(method));
    else groups.push({ value, by: [idOf(method)], ...(known ? { knownUnreliable: known } : {}) });
  }
  return groups;
}

/** Mark the name answers that are of a kind the method is known to get wrong. */
export function markKnownNames(methods: MethodResult<NameAnswer>[]): void {
  const others = (own: MethodResult<NameAnswer>): MethodResult<NameAnswer>[] => methods.filter((method) => method !== own);
  for (const method of methods) {
    const id = idOf(method);
    if (id === "axe-name" && comparableRole(method.result.role) === null && method.result.name !== "" && others(method).every((other) => other.result.name === "")) {
      method.knownUnreliable = knownError("axe-name", "name-without-role");
    }
    if (id === "dom-accessibility-api" && method.result.name === "" && typeof method.result.properties?.placeholder === "string" && others(method).some((other) => other.result.name === squash(method.result.properties!.placeholder as string))) {
      method.knownUnreliable = knownError("dom-accessibility-api", "placeholder");
    }
  }
}

/** Where the methods give another name or another role; empty when they all say the same. Answers marked as known unreliable do not count as a contradiction. */
export function nameDifferences(methods: MethodResult<NameAnswer>[]): string[] {
  const trusted = methods.filter((method) => !method.knownUnreliable);
  const groups = groupAnswers(trusted, sayName);
  return groups.length < 2 ? [] : groups.map((group) => `${group.by.join(", ")}: ${group.value}`);
}
