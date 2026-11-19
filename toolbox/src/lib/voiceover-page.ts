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
  /** For `tab <n>`: how many times the key is pressed. */
  times?: number;
  note?: string;
}

export interface Unplayable {
  /** Counted from 1, as in the answer of `open`. */
  step: number;
  command: string;
  reason: string;
}

const IN_FRAME = "het element staat in een ingesloten venster; de proefpagina kan daar niet in";
/** How often `tab` presses the key at most, as in the session. */
const MAX_TABS = 50;
/** A chain that goes on after a frame element: the rest is in the document of that frame. A frame named by its id is not seen here; the test page says so when it plays the step. */
const throughFrame = (chain: string[] | null | undefined): boolean => (chain ?? []).slice(0, -1).some((segment) => /(^| > )i?frame(:nth-of-type\(\d+\))?$/.test(segment));

const SKIPPED_NOTE = "een meting zonder blijvend gevolg voor wat er wordt voorgelezen; in Safari niet herhaald";

/** Which steps of a state the test page can play in Safari, and which it cannot. One step it cannot play makes the state unreachable there. */
export function planSteps(steps: Step[], values: Record<string, string> = TEST_VALUES): { planned: PlannedStep[]; unplayable: Unplayable[] } {
  const planned: PlannedStep[] = [];
  const unplayable: Unplayable[] = [];
  for (const [index, step] of steps.entries()) {
    const base = { command: step.command, target: step.target, ...(step.locators ? { locators: step.locators } : {}) };
    const refuse = (reason: string): void => void unplayable.push({ step: index + 1, command: step.command, reason });
    const value = (kind: string | undefined): string | null => (kind !== undefined && kind in values ? values[kind]! : null);
    const before = planned.length;
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
        planned.push({ ...base, how: "key", value: name });
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
        planned.push({ ...base, how: "key", value: step.options.shift ? "Shift+Tab" : "Tab", times: Math.max(1, Math.min(MAX_TABS, Number(step.args[0] ?? 1) || 1)) });
        break;
      case "press":
        refuse("indrukken zonder loslaten is in de proefpagina niet na te doen");
        break;
      case "drag":
      case "swipe":
        refuse("slepen en vegen zijn in de proefpagina niet na te doen");
        break;
      case "back":
      case "goto":
        refuse("de toestand gaat naar een andere pagina; de proefpagina is één pagina");
        break;
      default:
        refuse("deze stap kent de proefpagina niet");
    }
    // Known before Safari is asked: an element inside a frame, or a key pressed while focus was in one.
    if (planned.length > before && planned[before]!.how !== "skip" && (throughFrame(step.target) || throughFrame(step.focus))) {
      planned.pop();
      refuse(IN_FRAME);
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
  const config = { url: input.url, hosts: input.hosts, strict: input.strict, noPopup: input.noPopup === true, noMailto: input.noMailto === true, steps: input.steps, ...PLAY_TIMES };
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
  guard: { kind: "method" | "scope" | "socket" | "form" | "popup" | "mailto" | "fragment"; method: string; url: string }[];
  /** Whether the page's own scripts worked in Safari, as far as the page can tell. */
  page?: Loaded;
}

export interface Loaded {
  /** Elements with a custom element name on the page, and how many of them nobody defined. */
  custom: number;
  undefined: number;
  /** The names of the ones not defined, at most eight. */
  names: string[];
  /** Scripts that did not load, at most five. `held`: kept out by the policy of the test page, in a run with a strict scope. */
  scripts: { url: string; module: boolean; held?: boolean }[];
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
      if (Array.isArray(value.steps) && Array.isArray(value.guard)) return { done: value.done === true, steps: value.steps, guard: value.guard, ...(value.page && Array.isArray(value.page.names) && Array.isArray(value.page.scripts) ? { page: value.page } : {}) };
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
  fragment: "link naar een plek die niet op de pagina staat, niet gevolgd",
};

/** One line per thing the page held back, for the answer to an agent. */
export const guardLines = (played: Played | null): string[] => (played?.guard ?? []).map((entry) => `${GUARD_NL[entry.kind] ?? entry.kind}: ${entry.method} ${entry.url.slice(0, 100)}`);

const few = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;

/**
 * Whether the page's own scripts worked in the test page, in one line for the answer to an agent:
 * `scripts` when every script came, `notLoaded` when one did not. A reading with little in it is
 * then no evidence about the site. A custom element nobody defined is no alarm by itself: a site
 * may use such names without defining them, or define them later.
 */
export function loadedLine(played: Played | null): { scripts?: string; notLoaded?: string } {
  const page = played?.page;
  if (!page) return {};
  const missing = page.undefined > 0 ? `${page.undefined} van de ${few(page.custom, "custom element", "custom elements")} ${page.undefined === 1 ? "is" : "zijn"} in Safari niet gedefinieerd (${page.names.join(", ")})` : null;
  if (page.scripts.length === 0) {
    if (missing) return { scripts: `Safari kon elk script van de pagina ophalen. ${missing}. Dat past bij een site die zulke namen gebruikt zonder ze te definiëren, en ook bij een component waarvan het script in Safari niet werkte. Mist de voorlezing wat \`speak\` op die plek wel voorleest, dan is dat geen bewijs over de site` };
    return { scripts: page.custom === 0 ? "Safari kon elk script van de pagina ophalen; de pagina heeft geen custom elements" : `Safari kon elk script van de pagina ophalen, en de ${few(page.custom, "custom element", "custom elements")} op de pagina ${page.custom === 1 ? "is" : "zijn"} gedefinieerd` };
  }
  const urls = (scripts: Loaded["scripts"]): string => scripts.map((script) => script.url).join(", ");
  const failed = page.scripts.filter((script) => !script.held);
  const held = page.scripts.filter((script) => script.held);
  const parts = [
    ...(missing ? [missing] : []),
    ...(failed.length > 0 ? [`Safari kon ${few(failed.length, "script", "scripts")} niet ophalen (${urls(failed)})`] : []),
    ...(held.length > 0 ? [`de proefpagina hield ${few(held.length, "script", "scripts")} van buiten de scope van de run tegen (${urls(held)})`] : []),
  ];
  const cors = failed.some((script) => script.module) ? " Een script van het type module haalt Safari voor de proefpagina alleen op als de site dat aan een andere origin toestaat (CORS)." : "";
  return { notLoaded: `${parts.join("; ")}. De scripts van de site werkten in de proefpagina niet allemaal. Wat VoiceOver hier niet voorlas of niet vond, is geen bewijs dat het op de site ontbreekt.${cors}` };
}

/**
 * Said in the answer when a step of the state is a Tab: the test page moved focus itself, by its
 * own reading of the tab order, and no key was pressed in Safari.
 */
export const imitatedLine = (planned: PlannedStep[]): { imitated?: string } =>
  planned.some((step) => step.how === "key" && /(^|\+)Tab$/.test(step.value ?? ""))
    ? { imitated: "Tab is in Safari niet ingedrukt. De proefpagina zette de focus zelf op het onderdeel dat volgens de opbouw van de pagina volgt. Waar de focus in een browser komt en of ze zichtbaar is, meet je met `tab` in je sessie en niet met deze voorlezing" }
    : {};
