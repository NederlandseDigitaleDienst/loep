import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Step } from "../session/observations.ts";
import { TEST_VALUES } from "../session/safety.ts";

/**
 * A test page for VoiceOver: a page of the site, fetched once with GET, with a script at the top
 * that keeps it from sending anything and plays the steps of a state in Safari. The site's own
 * scripts, styles and pictures are loaded by Safari itself through `<base href>`.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("../../voiceover/test-page.js", import.meta.url)), "utf8");
/** The function itself, without the comment above it, which is for whoever reads the file. */
const SCRIPT = SOURCE.slice(SOURCE.indexOf("(function (config)")).trim();

/** How the script in the page plays a step. */
export type How = "click" | "fill" | "select" | "key" | "hover" | "scroll" | "focus" | "spacing" | "skip";

export interface PlannedStep {
  command: string;
  how: How;
  target: string[] | null;
  locators?: Step["locators"];
  /** The test value to fill in, the option to choose, the key to press or where to scroll. */
  value?: string;
  /** For `speak --type`: what is done after filling in, as in the session (leave with Tab, or send with Enter). */
  after?: "Tab" | "Enter";
  note?: string;
}

export interface Unplayable {
  /** Counted from 1, as in the answer of `open`. */
  step: number;
  command: string;
  reason: string;
}

const SKIPPED_NOTE = "een meting zonder blijvend gevolg voor wat er wordt voorgelezen; in Safari niet herhaald";

/** Which steps of a state the test page can play in Safari, and which it cannot. One step it cannot play makes the state unreachable there. */
export function planSteps(steps: Step[]): { planned: PlannedStep[]; unplayable: Unplayable[] } {
  const planned: PlannedStep[] = [];
  const unplayable: Unplayable[] = [];
  for (const [index, step] of steps.entries()) {
    const base = { command: step.command, target: step.target, ...(step.locators ? { locators: step.locators } : {}) };
    const refuse = (reason: string): void => void unplayable.push({ step: index + 1, command: step.command, reason });
    const value = (kind: string | undefined): string | null => (kind !== undefined && kind in TEST_VALUES ? TEST_VALUES[kind]! : null);
    switch (step.command) {
      case "click":
        planned.push({ ...base, how: "click" });
        break;
      case "type":
      case "paste": {
        const filled = value(step.args[0]);
        if (filled === null) refuse(`onbekende testwaarde "${step.args[0] ?? ""}"`);
        else planned.push({ ...base, how: "fill", value: filled });
        break;
      }
      case "speak": {
        if (step.options.click === true) planned.push({ ...base, how: "click" });
        else {
          const filled = value(typeof step.options.type === "string" ? step.options.type : undefined);
          if (filled === null) refuse("een stap van speak zonder --click of een bekende testwaarde");
          else planned.push({ ...base, how: "fill", value: filled, after: step.options.submit === true ? "Enter" : "Tab" });
        }
        break;
      }
      case "select":
        planned.push({ ...base, how: "select", value: step.args.join(" ").trim() });
        break;
      case "key": {
        const name = step.args[0] ?? "";
        if (/(^|\+)Tab$/.test(name)) refuse("Tab verplaatst de focus zoals de browser dat doet; de proefpagina kan dat niet nadoen");
        else planned.push({ ...base, how: "key", value: name });
        break;
      }
      case "hover":
        planned.push({ ...base, how: "hover" });
        break;
      case "scroll":
        planned.push({ ...base, how: "scroll", ...(step.target ? {} : { value: step.args[0] ?? "down" }) });
        break;
      case "focus":
        planned.push({ ...base, how: "focus" });
        break;
      case "spacing":
        planned.push(step.options.keep === true ? { ...base, how: "spacing" } : { ...base, how: "skip", note: SKIPPED_NOTE });
        break;
      case "reflow":
      case "zoom":
      case "taborder":
      case "tabwalk":
      case "forced":
        planned.push({ ...base, how: "skip", note: SKIPPED_NOTE });
        break;
      case "tab":
        refuse("Tab verplaatst de focus zoals de browser dat doet; de proefpagina kan dat niet nadoen");
        break;
      case "press":
        refuse("indrukken zonder loslaten is in de proefpagina niet na te doen");
        break;
      case "back":
      case "goto":
        refuse("de toestand gaat naar een andere pagina; de proefpagina is één pagina");
        break;
      default:
        refuse("deze stap kent de proefpagina niet");
    }
  }
  return { planned, unplayable };
}

export interface TestPageInput {
  /** The page as the server sent it. */
  html: string;
  /** Where it came from, after redirects: the base for every address in it. */
  url: string;
  steps: PlannedStep[];
  /** The hosts of the run: nothing goes anywhere else. */
  hosts: string[];
  /** Strict scope: also scripts, styles, pictures and fonts only from these hosts. */
  strict: boolean;
  /** A new window does not open; the page gets null from window.open. */
  noPopup?: boolean;
  /** An e-mail address does not hand over to the mail program. */
  noMailto?: boolean;
}

/** The fixed times of the script in the page, in milliseconds: after loading, between steps, and how long an element is looked for. */
export const PLAY_TIMES = { startMs: 1000, settleMs: 450, findMs: 3000 };

const attribute = (text: string): string => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The policy of the page: only the hosts of the run to send to and to frame, and no form goes anywhere. */
export function policyOf(hosts: string[], strict: boolean): string {
  // A host of the run carries its port when that is not 80 or 443 (see scopeHost); without one, only the usual port of each scheme.
  const web = hosts.flatMap((host) => [`http://${host}`, `https://${host}`]);
  const sockets = hosts.flatMap((host) => [`ws://${host}`, `wss://${host}`]);
  const parts = [`connect-src ${[...web, ...sockets].join(" ") || "'none'"}`, "form-action 'none'", `frame-src ${web.join(" ") || "'none'"}`];
  if (strict) {
    const own = web.join(" ");
    parts.push(`script-src 'unsafe-inline' 'unsafe-eval' ${own}`, `style-src 'unsafe-inline' ${own}`, `img-src data: blob: ${own}`, `font-src data: ${own}`, `media-src data: blob: ${own}`);
  }
  return parts.join("; ");
}

/** Build the test page: the page itself, with at the top a base address, the policy and the script. */
export function testPage(input: TestPageInput): string {
  const ownBase = /<base\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(input.html)?.[1];
  let base = input.url;
  try {
    base = new URL(ownBase ?? input.url, input.url).href;
  } catch {
    // An unreadable base of the page itself: the address of the page is the base.
  }
  const config = { hosts: input.hosts, noPopup: input.noPopup === true, noMailto: input.noMailto === true, steps: input.steps, ...PLAY_TIMES };
  const head = `<meta charset="utf-8"><base href="${attribute(base)}"><meta http-equiv="Content-Security-Policy" content="${attribute(policyOf(input.hosts, input.strict))}"><script>${SCRIPT}(${JSON.stringify(config).replace(/</g, "\\u003c")});</script>`;
  // The page's own base is replaced by the one above, which already holds it: the first base counts.
  const html = input.html.replace(/<base\b[^>]*>/gi, "");
  for (const opening of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const found = opening.exec(html);
    if (found) return `${html.slice(0, found.index + found[0].length)}${head}${html.slice(found.index + found[0].length)}`;
  }
  return `${head}${html}`;
}

/** The text of a page from its bytes: in the character set the server or the page names, else UTF-8. */
export function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const named = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(named).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** What the script in the page wrote into the address: which steps it played and what it held back. */
export interface Played {
  done: boolean;
  steps: { i: number; c: string; ok: boolean; note: string | null }[];
  guard: { kind: "method" | "scope" | "socket" | "form" | "popup" | "mailto"; method: string; url: string }[];
}

/** Read back what the page wrote into its address; null when there is nothing (readable). */
export function playedOf(address: string | null | undefined): Played | null {
  const mark = "#loep-played=";
  const at = address?.indexOf(mark) ?? -1;
  if (!address || at === -1) return null;
  const raw = address.slice(at + mark.length);
  for (const text of [raw, (() => { try { return decodeURIComponent(raw); } catch { return ""; } })()]) {
    try {
      const value = JSON.parse(text) as Played;
      if (Array.isArray(value.steps) && Array.isArray(value.guard)) return { done: value.done === true, steps: value.steps, guard: value.guard };
    } catch {
      // Not this form; try the other.
    }
  }
  return null;
}

const GUARD_NL: Record<Played["guard"][number]["kind"], string> = {
  method: "verzoek tegengehouden",
  scope: "buiten de scope tegengehouden",
  socket: "bericht over een websocket tegengehouden",
  form: "formulier niet verstuurd",
  popup: "nieuw venster niet geopend",
  mailto: "e-mailprogramma niet geopend",
};

/** One line per thing the page held back, for the answer to an agent. */
export const guardLines = (played: Played | null): string[] => (played?.guard ?? []).map((entry) => `${GUARD_NL[entry.kind] ?? entry.kind}: ${entry.method} ${entry.url.slice(0, 100)}`);
