import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendRunLine, readJson, writeJson } from "./canonical.ts";
import { recogniseSearch, SEARCH_SERVICE_IDS, SEARCH_SERVICES, type SearchServiceId } from "./searchbody.ts";

/**
 * A request that only reads although its method is not GET: a question to a search service,
 * such as Typesense (`POST /multi_search`), Algolia (`POST /1/indexes/<index>/queries`) or a
 * GraphQL endpoint with only queries, or a list that filters, sorts or pages with a form posted
 * to its own page (`filterform`). Every other request that can change something stays held
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
  /**
   * The search terms of the run, for a rule of `searchterm` or `searchform`: added by loep when the rule is
   * approved (see `withRunTerms`), never written by the explorer, so a body passes only with
   * the terms loep itself types.
   */
  terms?: string[];
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

/** The lowercase words of a path segment by two cuts, both kept: on every non-alphanumeric ("SignIn" gives "signin"), and on case and digit changes too ("_update_by_query" and "deleteByQuery" give "update", "by" and "query"; "HTMLExport" gives "html" and "export"). */
const wordsOf = (segment: string): string[] =>
  [
    ...segment.toLowerCase().split(/[^a-z0-9]+/),
    ...segment
      .replace(/([a-z])(?=[A-Z0-9])|([A-Z])(?=[A-Z][a-z])|([0-9])(?=[A-Za-z])/g, "$1$2$3 ")
      .toLowerCase()
      .split(/[^a-z0-9]+/),
  ].filter(Boolean);

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

function pathProblems(path: string, where: string, closingSlash = false): string[] {
  if (!path.startsWith("/")) return [`${where}: path begint met een schuine streep, zoals "/multi_search"`];
  if (/[?#]/.test(path)) return [`${where}: path is het pad zonder query en zonder anker`];
  // A fixed rule matches the path exactly, so one closing slash is part of the path as the service has it ("/v1/").
  const segments = (closingSlash ? path.slice(1).replace(/\/$/, "") : path.slice(1)).split("/");
  if (segments.some((segment) => segment === "")) return [`${where}: path "${path}" heeft een leeg deel; schrijf het pad zoals het verzoek het had, zonder dubbele${closingSlash ? "" : " of afsluitende"} schuine streep`];
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

// The hosts of one Algolia application, as Algolia's REST API reference and its clients name them:
// <APPID>.algolia.net, <APPID>-dsn.algolia.net and the fallbacks <APPID>-1, -2 and -3.algolianet.com.
// A site can move its search from one to another without notice.
const ALGOLIA_HOST = /^([a-z0-9]+)(?:\.algolia\.net|-dsn\.algolia\.net|-[1-3]\.algolianet\.com)$/;

/** The id of the Algolia application whose host an origin is, in lower case; null for any other origin. */
function algoliaApplication(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.port === "" ? (ALGOLIA_HOST.exec(parsed.hostname.toLowerCase())?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

/** The two search endpoints of Algolia: all indices at once (with a literal `*`), or one index. */
const isAlgoliaSearchPath = (path: unknown): boolean => typeof path === "string" && (path === "/1/indexes/*/queries" || pathMatches("/1/indexes/*/query", path));

/** Whether a rule is for a search of an Algolia application and this origin is a host of the same application. */
function sameAlgoliaApplication(rule: Pick<ReadRequest, "origin" | "path" | "service">, origin: string): boolean {
  if (rule.service !== "algolia" || !isAlgoliaSearchPath(rule.path)) return false;
  const application = algoliaApplication(rule.origin);
  return application !== null && application === algoliaApplication(origin);
}

/**
 * Whether a rule covers this method and address; the query does not count. Origin and path fit
 * exactly, except for a rule on an Algolia search endpoint: that covers both search endpoints on
 * every host of the same application. Whether the request passes is still up to its body.
 */
export function readMatches(rule: Pick<ReadRequest, "method" | "origin" | "path" | "service">, method: string, url: string): boolean {
  if (method.toUpperCase() !== rule.method) return false;
  try {
    const parsed = new URL(url);
    if (parsed.origin === rule.origin && pathMatches(rule.path, parsed.pathname)) return true;
    return isAlgoliaSearchPath(parsed.pathname) && sameAlgoliaApplication(rule, parsed.origin);
  } catch {
    return false;
  }
}

/** Whether an address is on an origin the rule covers: where a redirect after a read may be followed. */
export function onReadOrigin(rule: Pick<ReadRequest, "origin" | "path" | "service">, url: string): boolean {
  try {
    const { origin } = new URL(url);
    return origin === rule.origin || sameAlgoliaApplication(rule, origin);
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

/**
 * A read rule of loep itself, the same in every run: a POST that an embedded player or window of another party makes
 * to fetch what it shows, such as the player of a video asking for that video. Unlike a rule of the site model it
 * does not look at the body: the address alone is the question. So a rule names one exact origin and one exact path,
 * without a wildcard, and never a path with a word that points at writing (`WRITE_WORDS`). The rules are data, in
 * `toolbox/data/fixed-reads.json`, with a case that passes and one that does not per rule in
 * `test/fixtures/fixed-reads-corpus.json`. A strict scope lets none of them through.
 */
export interface FixedRead {
  id: string;
  method: "POST";
  /** Scheme, host and port, exactly. */
  origin: string;
  /** The path, without query, exactly. */
  path: string;
  /**
   * Parameters of the query that have to stand exactly so, each once, for a service that names what it is asked to do
   * there (`{ "cat": "Summary" }`). Other parameters may stand next to them. Without it the query is not looked at.
   */
  query?: Record<string, string>;
  /** What the request asks for and why it changes nothing, for whoever signs the report. */
  reasonNl: string;
  /** Set by loep, never in a file: the rule came from an extra file for a test server on this machine, not from the rules of loep. */
  extra?: true;
}

export const FIXED_READ_FIELDS = ["id", "method", "origin", "path", "query", "reasonNl"] as const;

/** The problems of one fixed read rule, in Dutch: the checks of a rule of the site model, and narrower (no wildcard, https only). */
export function fixedReadProblems(value: unknown, where: string): string[] {
  if (!isRecord(value)) return [`${where} is geen object`];
  const problems: string[] = [];
  for (const key of Object.keys(value)) if (!(FIXED_READ_FIELDS as readonly string[]).includes(key)) problems.push(`${where}: een vaste leesregel kent geen veld "${key}"`);
  if (!isText(value.id)) problems.push(`${where}: id ontbreekt`);
  if (value.method !== "POST") problems.push(`${where}: method moet "POST" zijn`);
  let parsed: URL | null = null;
  try {
    parsed = isText(value.origin) ? new URL(value.origin) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || parsed.origin !== value.origin) problems.push(`${where}: origin is precies schema, host en poort, met https://`);
  if (!isText(value.path)) problems.push(`${where}: path ontbreekt`);
  else {
    if (value.path.split("/").includes("*")) problems.push(`${where}: een vaste leesregel noemt een exact pad, zonder jokerteken`);
    problems.push(...pathProblems(value.path, where, true));
  }
  if (value.query !== undefined) {
    const entries = isRecord(value.query) ? Object.entries(value.query) : [];
    if (entries.length === 0 || entries.some(([name, wanted]) => name.trim() === "" || !isText(wanted))) problems.push(`${where}: query noemt een of meer parameters, elk met de tekst die er precies moet staan, zoals { "cat": "Summary" }`);
  }
  if (!isText(value.reasonNl) || value.reasonNl.trim().split(/\s+/).length < 6) problems.push(`${where}: reasonNl ontbreekt of is te kort`);
  return problems;
}

/** Read and check the fixed rules: a rule that does not pass its own checks stops loep, it never passes anything. */
export function loadFixedReads(path = fileURLToPath(new URL("../../data/fixed-reads.json", import.meta.url)), problemsOf = fixedReadProblems): FixedRead[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as { rules?: unknown };
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const problems = rules.flatMap((rule, index) => problemsOf(rule, `vaste leesregel ${index + 1}`));
  const ids = rules.map((rule) => (rule as { id?: unknown }).id);
  if (new Set(ids).size !== ids.length) problems.push("twee vaste leesregels hebben hetzelfde id");
  if (problems.length > 0) throw new Error(`${path}: ${problems.join("; ")}`);
  return rules as FixedRead[];
}

/**
 * A file with fixed rules for a test server on this machine, next to the rules of loep: for a test or a measurement
 * on the fixture site, whose players and windows of another party are served from 127.0.0.1. The rules of loep itself
 * are not touched.
 */
export const EXTRA_FIXED_READS_ENV = "LOEP_EXTRA_FIXED_READS";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The problems of a rule of that file: the checks of a fixed rule, with http allowed, and only for a host on this machine. */
export function extraFixedReadProblems(value: unknown, where: string): string[] {
  if (!isRecord(value) || !isText(value.origin)) return fixedReadProblems(value, where);
  let host: string | null = null;
  try {
    host = new URL(value.origin).hostname;
  } catch {
    host = null;
  }
  const problems = fixedReadProblems({ ...value, origin: value.origin.replace(/^http:\/\//, "https://") }, where);
  if (host !== null && !LOOPBACK_HOSTS.has(host)) problems.push(`${where}: een extra vaste leesregel noemt alleen een testserver op deze machine (127.0.0.1, localhost of [::1]), niet ${host}`);
  return problems;
}

/**
 * The same file inside a run. sweep-check writes it there, so every command on that run reads the extra rules without
 * the variable, a session an agent starts too; a forgotten variable would hold back the start of the survey unseen.
 */
export const EXTRA_FIXED_READS_FILE = "fixed-reads-extra.json";

let fixedRules: FixedRead[] | null = null;
let runExtraPath: string | undefined;

/** Read the extra fixed rules of this run (EXTRA_FIXED_READS_FILE) from here on, when it has them. Set by the command line for every command with --run, and by the process of a session in `serve`. */
export function useRunFixedReads(runDir: string): void {
  const path = join(runDir, EXTRA_FIXED_READS_FILE);
  runExtraPath = existsSync(path) ? path : undefined;
  fixedRules = null;
}

/** The fixed read rules of loep, read once per process, with the extra rules of LOEP_EXTRA_FIXED_READS or else of the run. */
export const fixedReads = (): readonly FixedRead[] => {
  if (fixedRules) return fixedRules;
  const extraPath = process.env[EXTRA_FIXED_READS_ENV] || runExtraPath;
  const rules = [...loadFixedReads(), ...(extraPath ? loadFixedReads(extraPath, extraFixedReadProblems).map((rule) => ({ ...rule, extra: true as const })) : [])];
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error(`${extraPath}: een extra vaste leesregel heeft het id van een vaste leesregel van loep`);
  return (fixedRules = rules);
};

/** Replace the fixed rules in this process, for a test on the fixture site; null reads the file again. */
export function setFixedReads(rules: readonly FixedRead[] | null): void {
  fixedRules = rules === null ? null : [...rules];
}

/**
 * The fixed rule that covers this request, or null: POST to exactly its origin and path, with each parameter its
 * `query` names standing there once and exactly so; any other parameter of the query is not looked at. A
 * preflight of a browser (OPTIONS, asking whether a POST may follow) is covered too, as for a rule of the site model.
 */
export function fixedReadFor(method: string, url: string, headers: Record<string, string> = {}, rules: readonly FixedRead[] = fixedReads()): FixedRead | null {
  const upper = method.toUpperCase();
  const asked = upper === "OPTIONS" ? (headers["access-control-request-method"] ?? "").toUpperCase() : upper;
  if (asked !== "POST") return null;
  try {
    const parsed = new URL(url);
    const queryFits = (query: Record<string, string> | undefined): boolean => Object.entries(query ?? {}).every(([name, wanted]) => parsed.searchParams.getAll(name).length === 1 && parsed.searchParams.get(name) === wanted);
    return rules.find((rule) => rule.origin === parsed.origin && rule.path === parsed.pathname && queryFits(rule.query)) ?? null;
  } catch {
    return null;
  }
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
  const verdict = recogniseSearch(rule.service, body, pathOf(url), rule.terms);
  return verdict.search ? { rule, pass: true } : { rule, pass: false, reasonNl: `past bij leesverzoek "${rule.id}", maar de body is geen zoekvraag aan ${SEARCH_SERVICES[rule.service].nameNl}: ${verdict.reasonNl}` };
}

/** The pathname of an address, or undefined when it is none. */
export function pathOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
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

/** A request of the sweep that a fixed read rule of loep let through: noted without its query or body, for the report. */
export interface FixedReadPassed {
  at: string;
  /** The command that was running. */
  source: string;
  method: string;
  /** Origin and path, without query. */
  address: string;
  rule: string;
}

export const READS_FIXED_LOG = "reads-fixed.jsonl";

let current: ReadRequest[] = [];
let refusedLog: ((entry: Omit<RefusedRead, "at" | "source">) => void) | null = null;
let fixedLog: ((entry: Omit<FixedReadPassed, "at" | "source">) => void) | null = null;

/**
 * Give every browser context this process opens from here on the read requests of the run, where
 * to note a request a rule covered but whose body was no search, and where to note a request a
 * fixed read rule let through. Set by the command line before a command starts, and by a session
 * when it opens a page.
 */
export function setRunReads(rules: readonly ReadRequest[], log?: ((entry: Omit<RefusedRead, "at" | "source">) => void) | null, passed?: ((entry: Omit<FixedReadPassed, "at" | "source">) => void) | null): void {
  current = [...rules];
  if (log !== undefined) refusedLog = log;
  if (passed !== undefined) fixedLog = passed;
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
    appendRunLine(join(runDir, READS_REFUSED_LOG), `${JSON.stringify({ at: new Date().toISOString(), source, ...entry })}\n`);
  };
}

/** Note a request a fixed read rule let through with the log of the run, when there is one. */
export function noteFixedRead(entry: Omit<FixedReadPassed, "at" | "source">): void {
  fixedLog?.(entry);
}

/** A log of the requests of the sweep that a fixed read rule let through: one line per request, never the query or the body. */
export function fixedReadsLog(runDir: string, source: string): (entry: Omit<FixedReadPassed, "at" | "source">) => void {
  return (entry) => {
    mkdirSync(runDir, { recursive: true });
    appendRunLine(join(runDir, READS_FIXED_LOG), `${JSON.stringify({ at: new Date().toISOString(), source, ...entry })}\n`);
  };
}

/** The requests of the sweep of this run that a fixed read rule let through, as the reads of one observation, for `fixedReadsUsed`. */
export function fixedReadsOfSweep(runDir: string): { reads: { rule: string; fixed: true }[] } {
  const path = join(runDir, READS_FIXED_LOG);
  if (!existsSync(path)) return { reads: [] };
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  return { reads: lines.map((line) => ({ rule: (JSON.parse(line) as FixedReadPassed).rule, fixed: true as const })) };
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

/** A POST whose body loep took for a search question, held back because no rule covers its address: per address and service, how often, and the first observation. */
export interface HeldBackSearch {
  /** Origin and path, without query. */
  address: string;
  services: SearchServiceId[];
  count: number;
  observation: string;
}

type ObservedBlock = { kind: string; method: string; url: string; search?: readonly string[] };

/**
 * The search questions in these observations that were held back and that no rule of `rules`
 * covers. A session only marks a held-back POST as a search when no rule covered it, so what a
 * rule added later covers drops out here.
 */
export function heldBackSearches(observations: Iterable<{ id: string; blocked?: readonly ObservedBlock[] }>, rules: readonly ReadRequest[]): HeldBackSearch[] {
  const found = new Map<string, HeldBackSearch>();
  for (const observation of observations) {
    for (const entry of observation.blocked ?? []) {
      const services = (entry.search ?? []).filter((service): service is SearchServiceId => (SEARCH_SERVICE_IDS as readonly string[]).includes(service));
      if (entry.kind !== "method" || entry.method !== "POST" || services.length === 0 || readRuleFor(rules, entry.method, entry.url)) continue;
      const address = addressOf(entry.url);
      const key = `${address} ${services.join(",")}`;
      const seen = found.get(key);
      if (seen) seen.count++;
      else found.set(key, { address, services, count: 1, observation: observation.id });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}

/** A POST to an address a rule covers whose body loep did not take for a search question: per address and rule, how often, the first observation and its reason. */
export interface RefusedCoveredRead {
  address: string;
  rule: string;
  count: number;
  observation: string;
  /** Absent when the request was held back before the rule existed. */
  reasonNl?: string;
}

/**
 * The POSTs in these observations that a rule of `rules` covers but that were held back
 * because loep did not recognise the body. Only loep can let those through, with a new form in
 * `searchbody.ts`; a rule of the explorer cannot.
 */
export function refusedCoveredReads(observations: Iterable<{ id: string; blocked?: readonly (ObservedBlock & { reasonNl?: string })[] }>, rules: readonly ReadRequest[]): RefusedCoveredRead[] {
  const found = new Map<string, RefusedCoveredRead>();
  for (const observation of observations) {
    for (const entry of observation.blocked ?? []) {
      if (entry.kind !== "method" || entry.method !== "POST" || (entry.search ?? []).length > 0) continue;
      const rule = readRuleFor(rules, entry.method, entry.url);
      if (!rule) continue;
      const address = addressOf(entry.url);
      const key = `${address} ${rule.id}`;
      const seen = found.get(key);
      if (seen) {
        seen.count++;
        if (!seen.reasonNl && entry.reasonNl) seen.reasonNl = entry.reasonNl;
      } else found.set(key, { address, rule: rule.id, count: 1, observation: observation.id, ...(entry.reasonNl ? { reasonNl: entry.reasonNl } : {}) });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}

/** One held-back search in the words of the operator and the explorer. */
export const heldBackSearchNl = (entry: HeldBackSearch): string =>
  `POST ${entry.address}, zoekvraag aan ${entry.services.map((service) => SEARCH_SERVICES[service].nameNl).join(" of ")}: ${entry.count} keer tegengehouden, het eerst in waarneming ${entry.observation}`;

/** What a session says when it held back a search question that no rule covers. */
export const SEARCH_HELD_BACK_NL =
  "loep herkende de body als zoekvraag, maar geen leesverzoek van het sitemodel dekt dit adres: daarom is ze tegengehouden. De verkenner legt het adres vast in readRequests van site.json; na check-site gaat de zoekvraag door. Blijft daardoor iets open, noem dit adres dan in het punt `proef werkte niet:`";

type ReadText = { method: string; origin: string; path: string; query?: Record<string, string>; service?: string; reasonNl: string; /** A fixed rule of loep (`FixedRead`), not one of the site model. */ fixed?: true; /** A fixed rule for a test server on this machine (`FixedRead.extra`). */ extra?: true };

/** One rule in the words of a report: method, address, service and why it may pass. */
export const readNl = (rule: ReadText): string =>
  `${rule.method} ${rule.origin}${rule.path}${rule.query ? `?${new URLSearchParams(rule.query).toString()}` : ""}${rule.service && rule.service in SEARCH_SERVICES ? `, zoekvraag aan ${SEARCH_SERVICES[rule.service as SearchServiceId].nameNl}` : ""} (${rule.reasonNl.trim().replace(/\.$/, "")})`;

/**
 * The sentence for the report and the dossier. Null without rules: then the report says what it
 * always said. The rules of the site model and the fixed rules of loep that let a request through each get their own part.
 */
export const readsAllowedNl = (rules: readonly ReadText[]): string | null => {
  const model = rules.filter((rule) => !rule.fixed);
  const fixed = rules.filter((rule) => rule.fixed && !rule.extra);
  const extra = rules.filter((rule) => rule.fixed && rule.extra);
  const parts = [
    ...(model.length > 0
      ? [`${model.length === 1 ? "één adres is" : `${model.length} adressen zijn`} toegelaten voor leesverzoeken: ${model.map(readNl).join("; ")}. Een verzoek daarheen ging alleen door als loep de body herkende als zoekvraag aan die dienst; elk ander verzoek dat iets kan wijzigen is tegengehouden`]
      : []),
    ...(fixed.length > 0 ? [`${fixed.length === 1 ? "één vaste leesregel van loep liet" : `${fixed.length} vaste leesregels van loep lieten`} verzoeken door van een ingesloten speler of venster: ${fixed.map(readNl).join("; ")}`] : []),
    ...(extra.length > 0 ? [`${extra.length === 1 ? "één extra vaste leesregel voor een testserver op deze machine liet" : `${extra.length} extra vaste leesregels voor een testserver op deze machine lieten`} verzoeken door, uit een bestand naast de regels van loep (LOEP_EXTRA_FIXED_READS of ${EXTRA_FIXED_READS_FILE} in de run): ${extra.map(readNl).join("; ")}`] : []),
  ];
  // A part after a full stop starts a sentence: "één" then is "Eén".
  return parts.length === 0 ? null : parts.map((part, index) => (index > 0 ? part.replace(/^één/, "Eén") : part)).join(". ");
};

/** The fixed rules that let a request through in these observations of a session (or the sweep, see `fixedReadsOfSweep`), in the order of the file. */
export function fixedReadsUsed(observations: Iterable<{ reads?: readonly { rule: string; fixed?: true }[] }>, rules: readonly FixedRead[] = fixedReads()): FixedRead[] {
  const used = new Set<string>();
  for (const observation of observations) for (const entry of observation.reads ?? []) if (entry.fixed) used.add(entry.rule);
  return rules.filter((rule) => used.has(rule.id));
}

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
