import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./canonical.ts";
import { recogniseSearch, SEARCH_SERVICE_IDS, SEARCH_SERVICES, type SearchServiceId } from "./searchbody.ts";

/**
 * A request that only reads although its method is not GET: a question to a search service,
 * such as Typesense (`POST /multi_search`), Algolia (`POST /1/indexes/<index>/queries`) or a
 * GraphQL endpoint with only queries. Every other request that can change something stays held
 * back on a live site. The explorer records such a request in the site model, with the session
 * observation in which it was held back and in which loep recognised its body; `check-site`
 * tests the rule. A rule of a model that passed lets a request through only when method, origin
 * and path fit and its body, request by request, is a question to the service the rule names.
 */
export interface ReadRequest {
  id: string;
  /** Only POST: GET and HEAD pass anyway, and PUT, PATCH and DELETE change something by definition. */
  method: "POST";
  /** Scheme, host and port, as the browser has them: "https://zoek.example.nl". */
  origin: string;
  /** The path, without query. A segment that is only `*` stands for exactly one segment of any name, such as the name of an index. */
  path: string;
  /** The search service whose form the body has to have (see `SEARCH_SERVICES`). */
  service: SearchServiceId;
  /** What the request asks for and why it changes nothing, for whoever signs the report. */
  reasonNl: string;
  /** Id of the session observation in which the request was held back. */
  observation: string;
}

export const READ_FIELDS = ["id", "method", "origin", "path", "service", "reasonNl", "observation"] as const;

/** Words in a path that point at a request that changes or records something. A brake on top of the body: such a path is never a read. */
const WRITE_WORDS = new Set([
  "login", "logout", "signin", "signout", "signup", "register", "inloggen", "uitloggen", "registreren", "aanmelden", "afmelden",
  "contact", "submit", "send", "verstuur", "versturen", "subscribe", "unsubscribe", "newsletter", "nieuwsbrief",
  "order", "orders", "bestel", "bestellen", "checkout", "cart", "basket", "winkelwagen", "pay", "payment", "betaal", "betalen",
  "create", "update", "delete", "remove", "insert", "save", "opslaan", "wijzig", "wijzigen", "verwijder", "verwijderen", "upload",
  "comment", "comments", "reactie", "reageren", "feedback", "vote", "like", "rating", "review", "reviews",
  "collect", "track", "tracking", "event", "events", "beacon", "analytics", "log", "logs", "telemetry", "metrics",
  "mutation", "batch", "bulk", "doc", "documents", "settings",
]);

/** The lowercase words of a path segment: "_update_by_query" gives "update", "by" and "query". */
const wordsOf = (segment: string): string[] => segment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** A segment of a path as a browser sends it: letters, digits and the characters a path may carry, nothing that reads as a pattern. */
const SEGMENT = /^[A-Za-z0-9._~%!$&'()+,;=:@-]+$/;

const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The problems of one rule on its own, in Dutch, for the explorer. A rule may name one origin
 * and one path; a `*` stands for one whole segment, at most once and never as the last one, so
 * a rule can never open a whole origin or a whole branch of it.
 */
export function readRequestProblems(value: unknown, where: string): string[] {
  if (!isRecord(value)) return [`${where} is geen object`];
  const problems: string[] = [];
  for (const key of Object.keys(value)) if (!(READ_FIELDS as readonly string[]).includes(key)) problems.push(`${where}: een leesverzoek kent geen veld "${key}"`);
  if (value.method !== "POST") problems.push(`${where}: method moet "POST" zijn; GET en HEAD gaan al door, en PUT, PATCH en DELETE wijzigen altijd iets`);
  if (!isText(value.origin)) problems.push(`${where}: origin ontbreekt: schema, host en poort, zoals "https://zoek.example.nl"`);
  else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(value.origin);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) problems.push(`${where}: origin "${value.origin}" is geen adres met http:// of https://`);
    else if (parsed.origin !== value.origin || value.origin.includes("*")) problems.push(`${where}: origin is alleen schema, host en poort, zonder pad, jokerteken of schuine streep aan het eind: ${parsed.origin}`);
  }
  if (!isText(value.path)) problems.push(`${where}: path ontbreekt: het pad van het verzoek, zonder query`);
  else problems.push(...pathProblems(value.path, where));
  if (!(SEARCH_SERVICE_IDS as readonly unknown[]).includes(value.service)) problems.push(`${where}: service moet een van ${SEARCH_SERVICE_IDS.join(", ")} zijn: de zoekdienst die loep in de body van het verzoek herkende`);
  if (!isText(value.reasonNl) || value.reasonNl.trim().split(/\s+/).length < 6) problems.push(`${where}: reasonNl ontbreekt of is te kort: zeg in een hele zin wat het verzoek vraagt en waarom het niets wijzigt`);
  if (!isText(value.observation)) problems.push(`${where}: observation ontbreekt: het id van de waarneming waarin het verzoek is tegengehouden`);
  return problems;
}

function pathProblems(path: string, where: string): string[] {
  if (!path.startsWith("/")) return [`${where}: path begint met een schuine streep, zoals "/multi_search"`];
  if (/[?#]/.test(path)) return [`${where}: path is het pad zonder query en zonder anker`];
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "")) return [`${where}: path "${path}" heeft een leeg deel; schrijf het pad zoals het verzoek het had, zonder dubbele of afsluitende schuine streep`];
  const wild = segments.filter((segment) => segment === "*").length;
  const problems: string[] = [];
  if (segments.some((segment) => segment !== "*" && (!SEGMENT.test(segment) || segment.includes("*") || segment === "." || segment === ".."))) {
    problems.push(`${where}: path "${path}" mag alleen een jokerteken hebben als heel deel ("/1/indexes/*/queries"), geen ** of een deel van een naam`);
  }
  if (wild > 1) problems.push(`${where}: path "${path}" heeft meer dan één jokerteken; een leesverzoek noemt een smal pad, met hooguit één deel dat wisselt`);
  if (segments.at(-1) === "*") problems.push(`${where}: path "${path}" eindigt op een jokerteken en zet zo alles onder ${path.slice(0, -1)} open; het laatste deel van het pad staat er letterlijk`);
  const write = segments.filter((segment) => segment !== "*").flatMap(wordsOf).find((word) => WRITE_WORDS.has(word));
  if (write) problems.push(`${where}: path "${path}" bevat "${write}" en wijst op een verzoek dat iets wijzigt of vastlegt; dat blijft tegengehouden`);
  return problems;
}

/** Whether a path matches the path of a rule: the same segments, a `*` taking exactly one segment. */
export function pathMatches(pattern: string, pathname: string): boolean {
  const want = pattern.split("/");
  const have = pathname.split("/");
  return want.length === have.length && want.every((segment, index) => (segment === "*" ? have[index] !== "" : segment === have[index]));
}

/** Whether a rule covers this method and address; the query does not count. */
export function readMatches(rule: Pick<ReadRequest, "method" | "origin" | "path">, method: string, url: string): boolean {
  if (method.toUpperCase() !== rule.method) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === rule.origin && pathMatches(rule.path, parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * The rule whose method, origin and path cover this request, or null; the body is not looked
 * at here. A preflight of a browser (OPTIONS, asking whether a POST may follow) is covered too:
 * it carries no body and changes nothing, and without it the POST to a search service on another
 * origin never leaves. The POST that follows is judged on its own body.
 */
export function readRuleFor(rules: readonly ReadRequest[], method: string, url: string, headers: Record<string, string> = {}): ReadRequest | null {
  const asked = method.toUpperCase() === "OPTIONS" ? (headers["access-control-request-method"] ?? "").toUpperCase() : method;
  if (method.toUpperCase() === "OPTIONS" && asked !== "POST") return null;
  return rules.find((rule) => readMatches(rule, asked, url)) ?? null;
}

export type ReadDecision = { rule: ReadRequest; pass: true } | { rule: ReadRequest; pass: false; reasonNl: string };

/**
 * What the network filter does with a request that is not a GET. Null when no rule covers it:
 * then it is held back as any write. Otherwise it passes only when its body is a question to the
 * service of the rule; else it is held back, with the reason.
 */
export function readDecision(rules: readonly ReadRequest[], method: string, url: string, headers: Record<string, string>, body: string | null): ReadDecision | null {
  const rule = rules.length > 0 ? readRuleFor(rules, method, url, headers) : null;
  if (!rule) return null;
  if (method.toUpperCase() === "OPTIONS") return { rule, pass: true };
  const verdict = recogniseSearch(rule.service, body);
  return verdict.search ? { rule, pass: true } : { rule, pass: false, reasonNl: `past bij leesverzoek "${rule.id}", maar de body is geen zoekvraag aan ${SEARCH_SERVICES[rule.service].nameNl}: ${verdict.reasonNl}` };
}

/** A request that a rule covered and whose body was no search: held back, and noted without its body. */
export interface RefusedRead {
  at: string;
  /** The command that was running. */
  source: string;
  method: string;
  /** Origin and path, without query. */
  address: string;
  rule: string;
  reasonNl: string;
}

export const READS_REFUSED_LOG = "reads-refused.jsonl";

let current: ReadRequest[] = [];
let refusedLog: ((entry: Omit<RefusedRead, "at" | "source">) => void) | null = null;

/**
 * Give every browser context this process opens from here on the read requests of the run, and
 * where to note a request a rule covered but whose body was no search. Set by the command line
 * before a command starts, and by a session when it opens a page.
 */
export function setRunReads(rules: readonly ReadRequest[], log?: ((entry: Omit<RefusedRead, "at" | "source">) => void) | null): void {
  current = [...rules];
  if (log !== undefined) refusedLog = log;
}

export const runReads = (): ReadRequest[] => current;

/** Note a refused read with the log of the run, when there is one. */
export function noteRefusedRead(entry: Omit<RefusedRead, "at" | "source">): void {
  refusedLog?.(entry);
}

/** A log of refused reads in the run directory: one line per request, never the body. */
export function refusedReadsLog(runDir: string, source: string): (entry: Omit<RefusedRead, "at" | "source">) => void {
  return (entry) => {
    mkdirSync(runDir, { recursive: true });
    appendFileSync(join(runDir, READS_REFUSED_LOG), `${JSON.stringify({ at: new Date().toISOString(), source, ...entry })}\n`);
  };
}

/** Origin and path of an address, for a record that must not carry what was typed. */
export const addressOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0]!.slice(0, 300);
  }
};

type ReadText = { method: string; origin: string; path: string; service?: string; reasonNl: string };

/** One rule in the words of a report: method, address, service and why it may pass. */
export const readNl = (rule: ReadText): string =>
  `${rule.method} ${rule.origin}${rule.path}${rule.service && rule.service in SEARCH_SERVICES ? `, zoekvraag aan ${SEARCH_SERVICES[rule.service as SearchServiceId].nameNl}` : ""} (${rule.reasonNl.trim().replace(/\.$/, "")})`;

/**
 * The sentence for the report and the dossier. Null without rules: then the report says what it
 * always said.
 */
export const readsAllowedNl = (rules: readonly ReadText[]): string | null =>
  rules.length === 0
    ? null
    : `${rules.length === 1 ? "één adres is" : `${rules.length} adressen zijn`} toegelaten voor leesverzoeken: ${rules.map(readNl).join("; ")}. Een verzoek daarheen ging alleen door als loep de body herkende als zoekvraag aan die dienst; elk ander verzoek dat iets kan wijzigen is tegengehouden`;

/** The read requests that `check-site` let through for this run, from its manifest. Empty when there are none. */
export function readsForRun(runDir: string): ReadRequest[] {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as { reads?: ReadRequest[] }).reads ?? [];
}

/** Store the rules that passed `check-site` with the run, or take them away when there are none. */
export async function recordReads(runDir: string, rules: readonly ReadRequest[]): Promise<void> {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path) && rules.length === 0) return;
  const { reads: _previous, ...manifest } = existsSync(path) ? await readJson<Record<string, unknown>>(path) : ({} as Record<string, unknown>);
  await writeJson(path, rules.length > 0 ? { ...manifest, reads: rules } : manifest);
}
