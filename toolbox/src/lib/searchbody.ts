/**
 * Whether the body of a POST is a question to a known search service, judged from its form
 * alone: deterministic, the same for every language a site is in, and per request. A body that
 * is not recognised is no search, whatever the address says. Each service has one entry in
 * `SEARCH_SERVICES`; what it accepts and refuses is in its tests, with bodies that look like a
 * search and change something.
 */

export const SEARCH_SERVICE_IDS = ["typesense", "algolia", "elasticsearch", "meilisearch", "graphql"] as const;
export type SearchServiceId = (typeof SEARCH_SERVICE_IDS)[number];

export type Verdict = { search: true } | { search: false; reasonNl: string };

export interface SearchService {
  id: SearchServiceId;
  nameNl: string;
  /** The form that is recognised, in the words of the explorer's task. */
  formNl: string;
  recognise: (body: string) => Verdict;
}

/** Larger than any question to a search service; a body this large is not looked into. */
export const MAX_BODY = 256 * 1024;

const yes: Verdict = { search: true };
const no = (reasonNl: string): Verdict => ({ search: false, reasonNl });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parseJson(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The first key at any depth that is in `keys`, or null. */
function keyAnywhere(value: unknown, keys: ReadonlySet<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = keyAnywhere(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (keys.has(key)) return key;
    const found = keyAnywhere(inner, keys);
    if (found) return found;
  }
  return null;
}

const outside = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string | null => Object.keys(value).find((key) => !allowed.has(key)) ?? null;

/** Keys that ask a service to change or add something; never part of a question. */
const WRITE_KEYS = new Set(["action", "actions", "document", "documents", "import", "upsert", "update", "delete", "insert", "create", "doc", "script"]);

function jsonObject(body: string, nameNl: string): { ok: true; value: Record<string, unknown> } | { ok: false; verdict: Verdict } {
  const parsed = parseJson(body);
  if (!parsed.ok) return { ok: false, verdict: no(`de body is geen JSON, en een zoekvraag aan ${nameNl} is dat wel`) };
  if (!isObject(parsed.value)) return { ok: false, verdict: no(`de body is geen JSON-object, en een zoekvraag aan ${nameNl} is dat wel`) };
  return { ok: true, value: parsed.value };
}

// Typesense: POST /multi_search with { "searches": [ { "collection", "q", "query_by", ... } ] }.
const TYPESENSE_TOP = new Set(["searches", "union"]);
const TYPESENSE_MARKS = ["q", "query_by", "filter_by", "collection", "preset", "vector_query"];

function typesense(body: string): Verdict {
  const json = jsonObject(body, "Typesense");
  if (!json.ok) return json.verdict;
  const extra = outside(json.value, TYPESENSE_TOP);
  if (extra) return no(`Typesense kent "${extra}" niet in een zoekvraag; alleen "searches"`);
  const searches = json.value.searches;
  if (!Array.isArray(searches) || searches.length === 0) return no('een zoekvraag aan Typesense heeft "searches", een lijst van zoekvragen');
  for (const search of searches) {
    if (!isObject(search)) return no('elke zoekvraag in "searches" is een object');
    if (!TYPESENSE_MARKS.some((key) => key in search)) return no(`een zoekvraag in "searches" noemt geen van ${TYPESENSE_MARKS.join(", ")}`);
    const write = keyAnywhere(search, WRITE_KEYS);
    if (write) return no(`de zoekvraag bevat "${write}", en dat vraagt om iets te wijzigen`);
  }
  return yes;
}

// Algolia: POST /1/indexes/*/queries with { "requests": [ { "indexName", "params" } ] }, or POST /1/indexes/<index>/query with { "params" }.
const ALGOLIA_TOP = new Set(["requests", "strategy"]);
const ALGOLIA_REQUEST = new Set(["indexName", "params", "query", "type", "facet", "facetQuery", "maxFacetHits"]);

function algolia(body: string): Verdict {
  const json = jsonObject(body, "Algolia");
  if (!json.ok) return json.verdict;
  const value = json.value;
  if ("params" in value && !("requests" in value)) {
    const extra = outside(value, new Set(["params"]));
    if (extra) return no(`een zoekvraag aan één index van Algolia heeft alleen "params", niet "${extra}"`);
    return typeof value.params === "string" || isObject(value.params) ? yes : no('"params" van Algolia is tekst of een object');
  }
  const extra = outside(value, ALGOLIA_TOP);
  if (extra) return no(`Algolia kent "${extra}" niet in een zoekvraag; alleen "requests" of "params"`);
  if (!Array.isArray(value.requests) || value.requests.length === 0) return no('een zoekvraag aan Algolia heeft "requests", een lijst van zoekvragen, of "params"');
  for (const request of value.requests) {
    if (!isObject(request)) return no('elke vraag in "requests" is een object');
    const other = outside(request, ALGOLIA_REQUEST);
    if (other) return no(`een vraag in "requests" bevat "${other}"; een zoekvraag aan Algolia heeft alleen ${[...ALGOLIA_REQUEST].join(", ")}`);
    if (typeof request.indexName !== "string") return no('elke vraag in "requests" noemt de index in "indexName"');
    if (request.type !== undefined && request.type !== "default" && request.type !== "facet") return no(`"type" van een vraag aan Algolia is "default" of "facet", niet ${JSON.stringify(request.type)}`);
  }
  return yes;
}

// Elasticsearch and OpenSearch: POST /<index>/_search with a search body, or POST /_msearch with lines of header and search body.
const ES_BODY = new Set([
  "query", "aggs", "aggregations", "size", "from", "sort", "_source", "fields", "highlight", "post_filter", "suggest", "track_total_hits", "track_scores",
  "min_score", "search_after", "collapse", "timeout", "explain", "stored_fields", "docvalue_fields", "knn", "rescore", "pit", "indices_boost", "version",
  "seq_no_primary_term", "terminate_after", "profile", "stats",
]);
const ES_MARKS = ["query", "aggs", "aggregations", "suggest", "knn"];
const ES_HEADER = new Set(["index", "search_type", "preference", "routing", "request_cache", "allow_no_indices", "expand_wildcards", "ignore_unavailable", "allow_partial_search_results"]);
const SCRIPT = new Set(["script", "scripts"]);

function searchBody(value: unknown): string | null {
  if (!isObject(value)) return "een zoekvraag aan Elasticsearch is een JSON-object";
  const extra = outside(value, ES_BODY);
  if (extra) return `Elasticsearch kent "${extra}" niet in een zoekvraag`;
  if (!ES_MARKS.some((key) => key in value)) return `een zoekvraag aan Elasticsearch heeft ${ES_MARKS.join(", ")} of een daarvan`;
  const notObject = ["query", "aggs", "aggregations", "suggest", "post_filter"].find((key) => key in value && !isObject(value[key]));
  if (notObject) return `"${notObject}" van een zoekvraag aan Elasticsearch is een object`;
  const script = keyAnywhere(value, SCRIPT);
  if (script) return `de zoekvraag bevat "${script}", en een script kan iets wijzigen`;
  return null;
}

function elasticsearch(body: string): Verdict {
  const whole = parseJson(body);
  if (whole.ok) {
    const problem = searchBody(whole.value);
    return problem ? no(problem) : yes;
  }
  // _msearch: one header and one search body per question, each on its own line.
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0 || lines.length % 2 !== 0) return no("de body is geen JSON en geen reeks regels met telkens een kop en een zoekvraag (_msearch)");
  for (const [index, line] of lines.entries()) {
    const parsed = parseJson(line);
    if (!parsed.ok) return no(`regel ${index + 1} van de body is geen JSON`);
    if (index % 2 === 0) {
      if (!isObject(parsed.value)) return no(`regel ${index + 1} is de kop van een zoekvraag en dus een object`);
      const extra = outside(parsed.value, ES_HEADER);
      if (extra) return no(`de kop op regel ${index + 1} bevat "${extra}"; dat hoort niet bij een zoekvraag (_bulk gebruikt die vorm om te schrijven)`);
      const target = parsed.value.index;
      if (target !== undefined && typeof target !== "string" && !(Array.isArray(target) && target.every((name) => typeof name === "string"))) return no(`"index" in de kop op regel ${index + 1} is de naam van een index, geen object`);
    } else {
      const problem = searchBody(parsed.value);
      if (problem) return no(`regel ${index + 1}: ${problem}`);
    }
  }
  return yes;
}

// Meilisearch: POST /indexes/<index>/search with search parameters, or POST /multi-search with { "queries": [...] }.
const MEILI_PARAMS = new Set([
  "q", "offset", "limit", "page", "hitsPerPage", "filter", "facets", "attributesToRetrieve", "attributesToCrop", "cropLength", "cropMarker", "attributesToHighlight",
  "highlightPreTag", "highlightPostTag", "showMatchesPosition", "showRankingScore", "showRankingScoreDetails", "rankingScoreThreshold", "sort", "matchingStrategy",
  "attributesToSearchOn", "hybrid", "vector", "retrieveVectors", "locales", "distinct",
]);
const MEILI_MARKS = ["q", "filter", "facets", "sort", "vector", "hybrid"];

function meiliQuery(value: unknown, multi: boolean): string | null {
  if (!isObject(value)) return "een zoekvraag aan Meilisearch is een JSON-object";
  const allowed = multi ? new Set([...MEILI_PARAMS, "indexUid", "federationOptions"]) : MEILI_PARAMS;
  const extra = outside(value, allowed);
  if (extra) return `Meilisearch kent "${extra}" niet in een zoekvraag`;
  if (multi && typeof value.indexUid !== "string") return 'elke vraag in "queries" noemt de index in "indexUid"';
  if (!MEILI_MARKS.some((key) => key in value)) return `een zoekvraag aan Meilisearch heeft ${MEILI_MARKS.join(", ")} of een daarvan`;
  return null;
}

function meilisearch(body: string): Verdict {
  const json = jsonObject(body, "Meilisearch");
  if (!json.ok) return json.verdict;
  if ("queries" in json.value) {
    const extra = outside(json.value, new Set(["queries", "federation"]));
    if (extra) return no(`Meilisearch kent "${extra}" niet naast "queries"`);
    if (!Array.isArray(json.value.queries) || json.value.queries.length === 0) return no('"queries" is een lijst van zoekvragen');
    for (const query of json.value.queries) {
      const problem = meiliQuery(query, true);
      if (problem) return no(problem);
    }
    return yes;
  }
  const problem = meiliQuery(json.value, false);
  return problem ? no(problem) : yes;
}

// GraphQL: { "query": "<document>", "variables", "operationName" }, or a list of those. Only documents whose operations are all queries.
const GRAPHQL_REQUEST = new Set(["query", "variables", "operationName", "extensions"]);

type Token = { kind: "name" | "punct" | "string" | "number"; text: string };

/** The tokens of a GraphQL document, or the reason it is not one. Strings, block strings and comments are read as such, so a word inside them is never taken for an operation. */
export function graphqlTokens(source: string): Token[] | string {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at]!;
    if (char === "﻿" || char === "," || /\s/.test(char)) {
      at++;
      continue;
    }
    if (char === "#") {
      while (at < source.length && source[at] !== "\n" && source[at] !== "\r") at++;
      continue;
    }
    if (source.startsWith('"""', at)) {
      let end = at + 3;
      for (;;) {
        const close = source.indexOf('"""', end);
        if (close === -1) return "een tekst tussen drie aanhalingstekens is niet afgesloten";
        if (source[close - 1] === "\\") {
          end = close + 3;
          continue;
        }
        end = close + 3;
        break;
      }
      tokens.push({ kind: "string", text: source.slice(at, end) });
      at = end;
      continue;
    }
    if (char === '"') {
      let end = at + 1;
      while (end < source.length && source[end] !== '"') {
        if (source[end] === "\n" || source[end] === "\r") return "een tekst tussen aanhalingstekens loopt door over een regel";
        end += source[end] === "\\" ? 2 : 1;
      }
      if (end >= source.length) return "een tekst tussen aanhalingstekens is niet afgesloten";
      tokens.push({ kind: "string", text: source.slice(at, end + 1) });
      at = end + 1;
      continue;
    }
    if (source.startsWith("...", at)) {
      tokens.push({ kind: "punct", text: "..." });
      at += 3;
      continue;
    }
    if ("!$&()[]{}:=@|".includes(char)) {
      tokens.push({ kind: "punct", text: char });
      at++;
      continue;
    }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(source.slice(at))?.[0];
    if (name) {
      tokens.push({ kind: "name", text: name });
      at += name.length;
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at))?.[0];
    if (number) {
      tokens.push({ kind: "number", text: number });
      at += number.length;
      continue;
    }
    return `het teken "${char}" hoort niet in een GraphQL-document`;
  }
  return tokens;
}

/** The operation types of the definitions of a document (`query` for the short form), or the reason it cannot be read. Fragments are skipped. */
export function graphqlOperations(source: string): string[] | string {
  const tokens = graphqlTokens(source);
  if (typeof tokens === "string") return tokens;
  const isPunct = (index: number, text: string): boolean => tokens[index]?.kind === "punct" && tokens[index]!.text === text;
  // From an opening brace to just past the brace that closes it.
  const skipBlock = (start: number): number | string => {
    let depth = 0;
    for (let index = start; index < tokens.length; index++) {
      if (isPunct(index, "{")) depth++;
      if (isPunct(index, "}")) depth--;
      if (depth === 0) return index + 1;
    }
    return "een accolade is niet gesloten";
  };
  // Name, variables and directives up to the selection set, then the selection set itself.
  const skipDefinition = (start: number): number | string => {
    let parens = 0;
    for (let index = start; index < tokens.length; index++) {
      if (isPunct(index, "(")) parens++;
      if (isPunct(index, ")")) parens--;
      if (parens === 0 && isPunct(index, "{")) return skipBlock(index);
    }
    return "een definitie heeft geen selectie tussen accolades";
  };
  const operations: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    let next: number | string;
    if (isPunct(index, "{")) {
      operations.push("query");
      next = skipBlock(index);
    } else if (token.kind === "name" && (token.text === "query" || token.text === "mutation" || token.text === "subscription")) {
      operations.push(token.text);
      next = skipDefinition(index + 1);
    } else if (token.kind === "name" && token.text === "fragment") next = skipDefinition(index + 1);
    else return `"${token.text}" is geen begin van een bewerking of fragment`;
    if (typeof next === "string") return next;
    index = next;
  }
  return operations.length > 0 ? operations : "het document heeft geen bewerking";
}

function graphqlRequest(value: unknown): string | null {
  if (!isObject(value)) return "een GraphQL-verzoek is een JSON-object";
  const extra = outside(value, GRAPHQL_REQUEST);
  if (extra) return `een GraphQL-verzoek kent "${extra}" niet`;
  if (typeof value.query !== "string" || value.query.trim() === "") return 'zonder document in "query" (zoals bij een bewaarde bewerking) is niet te zien wat het verzoek doet';
  const operations = graphqlOperations(value.query);
  if (typeof operations === "string") return `het document is niet te lezen: ${operations}`;
  const changing = operations.find((operation) => operation !== "query");
  if (changing) return `het document bevat een ${changing}, en dat ${changing === "mutation" ? "wijzigt iets" : "houdt een verbinding open om gegevens te sturen"}`;
  return null;
}

function graphql(body: string): Verdict {
  const parsed = parseJson(body);
  if (!parsed.ok) return no("de body is geen JSON; een GraphQL-verzoek als POST is dat wel");
  const requests = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  if (requests.length === 0) return no("de lijst met GraphQL-verzoeken is leeg");
  for (const request of requests) {
    const problem = graphqlRequest(request);
    if (problem) return no(problem);
  }
  return yes;
}

export const SEARCH_SERVICES: Record<SearchServiceId, SearchService> = {
  typesense: { id: "typesense", nameNl: "Typesense", formNl: 'JSON met "searches", een lijst van zoekvragen (POST /multi_search)', recognise: typesense },
  algolia: { id: "algolia", nameNl: "Algolia", formNl: 'JSON met "requests", elk met "indexName" en "params", of met alleen "params"', recognise: algolia },
  elasticsearch: { id: "elasticsearch", nameNl: "Elasticsearch of OpenSearch", formNl: 'een zoekvraag met "query", "aggs" of "suggest" zonder script (_search), of regels met telkens een kop en een zoekvraag (_msearch)', recognise: elasticsearch },
  meilisearch: { id: "meilisearch", nameNl: "Meilisearch", formNl: 'JSON met zoekparameters als "q" en "filter", of met "queries"', recognise: meilisearch },
  graphql: { id: "graphql", nameNl: "GraphQL", formNl: 'JSON met een document in "query" dat alleen query-bewerkingen heeft, geen mutation of subscription', recognise: graphql },
};

/** Whether the body is a question to this service. An empty or very large body never is. */
export function recogniseSearch(service: SearchServiceId, body: string | null): Verdict {
  if (body === null || body.trim() === "") return no("het verzoek heeft geen body");
  if (body.length > MAX_BODY) return no(`de body is groter dan ${MAX_BODY / 1024} kB`);
  return SEARCH_SERVICES[service].recognise(body);
}

/** Every service that would take this body for a question to it; empty when none does. For the record of a request that was held back. */
export function searchServicesOf(body: string | null): SearchServiceId[] {
  return SEARCH_SERVICE_IDS.filter((id) => recogniseSearch(id, body).search);
}
