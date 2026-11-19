/**
 * Whether the body of a POST is a question to a known search service, judged from its form
 * alone: deterministic, the same for every language a site is in, and per request. A body that
 * is not recognised is no search, whatever the address says. Each service has one entry in
 * `SEARCH_SERVICES`; what it accepts and refuses is in its tests, with bodies that look like a
 * search and change something.
 */

export const SEARCH_SERVICE_IDS = ["typesense", "algolia", "elasticsearch", "meilisearch", "graphql", "searchui", "searchterm", "searchform", "filterform", "wordpressajax"] as const;
/** The services recognised by the search terms of the run: a rule of these gets the terms when it is approved. */
export const TERM_SERVICES: readonly SearchServiceId[] = ["searchterm", "searchform"];
export type SearchServiceId = (typeof SEARCH_SERVICE_IDS)[number];

export type Verdict = { search: true } | { search: false; reasonNl: string };

export interface SearchService {
  id: SearchServiceId;
  nameNl: string;
  /** The form that is recognised, in the words of the explorer's task. */
  formNl: string;
  /**
   * `path` is the pathname of the address, for the services whose form depends on it. `terms` are
   * the search terms of the run, for the service that is recognised by the term alone.
   */
  recognise: (body: string, path?: string, terms?: readonly string[]) => Verdict;
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
// Client v5 (DocSearch 4) puts the search parameters inline in each request instead of in "params". Its searchSingleIndex sends them inline at the top of the body of POST /1/indexes/<index>/query.
const ALGOLIA_TOP = new Set(["requests", "strategy"]);
// The search parameters of SearchParamsObject in Algolia's OpenAPI spec (specs/common/schemas/SearchParams.yml and IndexSettings.yml#/indexSettingsAsSearchParams).
const ALGOLIA_SEARCH_PARAMS = [
  "advancedSyntax", "advancedSyntaxFeatures", "allowTyposOnNumericTokens", "alternativesAsExact", "analytics", "analyticsTags", "aroundLatLng", "aroundLatLngViaIP",
  "aroundPrecision", "aroundRadius", "attributeCriteriaComputedBy", "attributeCriteriaComputedByMinProximity", "attributesToHighlight", "attributesToRetrieve",
  "attributesToSnippet", "clickAnalytics", "decompoundQuery", "disableExactOnAttributes", "disableTypoToleranceOnAttributes", "distinct", "enableABTest",
  "enablePersonalization", "enableReRanking", "enableRules", "exactOnSingleWordQuery", "facetFilters", "facetingAfterDistinct", "facets", "filters", "getRankingInfo",
  "highlightPostTag", "highlightPreTag", "hitsPerPage", "ignorePlurals", "insideBoundingBox", "insidePolygon", "length", "maxValuesPerFacet", "minimumAroundRadius",
  "minProximity", "mode", "naturalLanguages", "numericFilters", "offset", "optionalFilters", "optionalWords", "page", "percentileComputation", "personalizationImpact",
  "query", "queryLanguages", "queryType", "ranking", "relevancyStrictness", "removeStopWords", "removeWordsIfNoResults", "renderingContent",
  "replaceSynonymsInHighlight", "reRankingApplyFilter", "responseFields", "restrictHighlightAndSnippetArrays", "restrictSearchableAttributes", "ruleContexts",
  "semanticSearch", "similarQuery", "snippetEllipsisText", "sortFacetValuesBy", "sumOrFiltersScores", "synonyms", "tagFilters", "typoTolerance", "userToken",
];
const ALGOLIA_REQUEST = new Set(["indexName", "params", "type", "facet", "facetQuery", "maxFacetHits", ...ALGOLIA_SEARCH_PARAMS]);

const ALGOLIA_SINGLE_INDEX = /^\/1\/indexes\/[^/]+\/query$/;
const ALGOLIA_INLINE = new Set(ALGOLIA_SEARCH_PARAMS);

function algolia(body: string, path?: string): Verdict {
  const json = jsonObject(body, "Algolia");
  if (!json.ok) return json.verdict;
  const value = json.value;
  if ("params" in value && !("requests" in value)) {
    const extra = outside(value, new Set(["params"]));
    if (extra) return no(`een zoekvraag aan één index van Algolia heeft alleen "params", niet "${extra}"`);
    return typeof value.params === "string" || isObject(value.params) ? yes : no('"params" van Algolia is tekst of een object');
  }
  if (path !== undefined && ALGOLIA_SINGLE_INDEX.test(path) && !("requests" in value)) {
    const other = outside(value, ALGOLIA_INLINE);
    if (other) return no(`een zoekvraag aan één index van Algolia heeft alleen zoekparameters, niet "${other}"`);
    if ("query" in value && typeof value.query !== "string") return no('"query" van Algolia is tekst');
    return Object.keys(value).length > 0 ? yes : no("een zoekvraag aan één index van Algolia noemt minstens één zoekparameter");
  }
  const extra = outside(value, ALGOLIA_TOP);
  if (extra) return no(`Algolia kent "${extra}" niet in een zoekvraag; alleen "requests" of "params"`);
  if (!Array.isArray(value.requests) || value.requests.length === 0) return no('een zoekvraag aan Algolia heeft "requests", een lijst van zoekvragen, of "params"');
  for (const request of value.requests) {
    if (!isObject(request)) return no('elke vraag in "requests" is een object');
    const other = outside(request, ALGOLIA_REQUEST);
    if (other) return no(`een vraag in "requests" bevat "${other}"; een zoekvraag aan Algolia heeft alleen "indexName", "params", "type", "facet", "facetQuery", "maxFacetHits" en zoekparameters`);
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

// Elastic Search UI (@elastic/search-ui): the driver hands its request state and query configuration to a connector, which a site
// often posts to a search endpoint of its own. ApiProxyConnector of @elastic/search-ui-elasticsearch-connector sends
// { "state", "queryConfig" } to /api/search and /api/autocomplete; a custom connector may name the first "requestState".
// The keys are those of RequestState, SearchQuery and AutocompleteQueryConfig in the types of @elastic/search-ui 1.24.
const SEARCH_UI_STATE = new Set(["current", "filters", "resultsPerPage", "searchTerm", "sortDirection", "sortField", "sortList", "sort"]);
const SEARCH_UI_QUERY = new Set([
  ...SEARCH_UI_STATE, "facets", "fuzziness", "disjunctiveFacets", "disjunctiveFacetsAnalyticsTags", "result_fields", "search_fields",
]);
const SEARCH_UI_AUTOCOMPLETE = new Set(["results", "suggestions"]);
const SEARCH_UI_FILTER = new Set(["field", "type", "values", "persistent"]);
const SEARCH_UI_RECORDS = ["facets", "result_fields", "search_fields"];

function searchUiState(value: unknown, allowed: ReadonlySet<string>, nameNl: string): string | null {
  if (!isObject(value)) return `"${nameNl}" van Search UI is een object`;
  const extra = outside(value, allowed);
  if (extra) return `Search UI kent "${extra}" niet in "${nameNl}"`;
  if ("searchTerm" in value && typeof value.searchTerm !== "string") return `"searchTerm" in "${nameNl}" is tekst`;
  const notNumber = ["current", "resultsPerPage"].find((key) => key in value && typeof value[key] !== "number");
  if (notNumber) return `"${notNumber}" in "${nameNl}" is een getal`;
  if ("filters" in value) {
    if (!Array.isArray(value.filters)) return `"filters" in "${nameNl}" is een lijst`;
    for (const filter of value.filters) {
      if (!isObject(filter) || typeof filter.field !== "string" || !Array.isArray(filter.values)) return `elk filter in "${nameNl}" is een object met "field" en "values"`;
      const other = outside(filter, SEARCH_UI_FILTER);
      if (other) return `een filter van Search UI kent "${other}" niet`;
    }
  }
  const notRecord = SEARCH_UI_RECORDS.find((key) => key in value && !isObject(value[key]));
  if (notRecord) return `"${notRecord}" in "${nameNl}" is een object`;
  return null;
}

function searchUi(body: string): Verdict {
  const json = jsonObject(body, "Search UI");
  if (!json.ok) return json.verdict;
  const value = json.value;
  const stateKey = ["state", "requestState"].find((key) => key in value);
  if (!stateKey || !("queryConfig" in value)) return no('een zoekvraag van Search UI heeft "state" of "requestState", en "queryConfig"');
  const extra = outside(value, new Set([stateKey, "queryConfig"]));
  if (extra) return no(`een zoekvraag van Search UI heeft alleen "${stateKey}" en "queryConfig", niet "${extra}"`);
  const state = searchUiState(value[stateKey], SEARCH_UI_STATE, stateKey);
  if (state) return no(state);
  const config = value.queryConfig;
  if (isObject(config) && Object.keys(config).some((key) => SEARCH_UI_AUTOCOMPLETE.has(key))) {
    const other = outside(config, SEARCH_UI_AUTOCOMPLETE);
    if (other) return no(`een vraag om aanvullingen van Search UI heeft alleen "results" en "suggestions" in "queryConfig", niet "${other}"`);
    if (config.results !== undefined) {
      const results = searchUiState(config.results, SEARCH_UI_QUERY, "queryConfig.results");
      if (results) return no(results);
    }
    if (config.suggestions !== undefined && !isObject(config.suggestions)) return no('"suggestions" in "queryConfig" is een object');
    return yes;
  }
  const query = searchUiState(config, SEARCH_UI_QUERY, "queryConfig");
  return query ? no(query) : yes;
}

// Any search service with a JSON body, such as Google Discovery Engine (`POST .../servingConfigs/<config>:searchLite`) or a
// `POST /api/v2/search` of its own: recognised only by the search term of the run standing in it, word for word, as a value.
// Its form says nothing else, so whatever could change something or carry more than a search term is refused.
const TERM_WRITE_KEYS = new Set([
  ...WRITE_KEYS, "mutation", "remove", "save", "patch", "put", "set", "unset", "replace", "merge", "commit", "submit", "send", "subscribe", "order", "payment",
  "email", "mail", "emailaddress", "e-mail", "password", "passwd", "wachtwoord", "token", "csrf", "phone", "telephone", "telefoon", "tel", "message", "bericht",
  "comment", "comments", "opmerking", "reactie", "feedback", "subject", "onderwerp", "firstname", "lastname", "voornaam", "achternaam", "naam", "address", "adres",
]);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const GRAPHQL_CHANGE = /\b(?:mutation|subscription)\b\s*[A-Za-z_({]/;

/** The key at any depth whose lower-cased name, without separators, is in `keys`; null when none is. */
function looseKeyAnywhere(value: unknown, keys: ReadonlySet<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = looseKeyAnywhere(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (keys.has(key.toLowerCase()) || keys.has(key.toLowerCase().replace(/[-_\s.]/g, ""))) return key;
    const found = looseKeyAnywhere(inner, keys);
    if (found) return found;
  }
  return null;
}

/** Every string value at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (isObject(value)) return Object.values(value).flatMap(stringsOf);
  return [];
}

const sameTerm = (value: string, term: string): boolean => value.trim().normalize("NFC").toLowerCase() === term.trim().normalize("NFC").toLowerCase();

function searchTerm(body: string, _path?: string, terms?: readonly string[]): Verdict {
  const known = (terms ?? []).filter((term) => term.trim() !== "");
  if (known.length === 0) return no("loep kent de zoekterm van deze run hier niet, en alleen daaraan is zo'n zoekvraag te herkennen");
  const parsed = parseJson(body);
  if (!parsed.ok) return no("de body is geen JSON, en een zoekvraag met de zoekterm in de body is dat wel");
  if (!isObject(parsed.value) && !Array.isArray(parsed.value)) return no("de body is geen JSON-object of -lijst");
  const write = looseKeyAnywhere(parsed.value, TERM_WRITE_KEYS);
  if (write) return no(`de body bevat "${write}", en dat wijst op een verzoek dat iets wijzigt of meer meestuurt dan een zoekterm`);
  const strings = stringsOf(parsed.value);
  if (strings.some((value) => EMAIL_LIKE.test(value))) return no("de body bevat iets dat op een e-mailadres lijkt, en een zoekvraag heeft dat niet");
  if (strings.some((value) => GRAPHQL_CHANGE.test(value))) return no("de body bevat een GraphQL-mutation of -subscription, en die wijzigt iets");
  if (!strings.some((value) => known.some((term) => sameTerm(value, term)))) return no("de zoekterm van de run staat niet letterlijk als waarde in de body");
  return yes;
}

/**
 * Fields a framework puts in every post of a page form, with no input of the visitor in them:
 * the state of ASP.NET WebForms, a token against forged posts, the id of a Drupal form.
 */
const FORM_STATE_KEY = /^(?:__[A-Za-z]+|__RequestVerificationToken|authenticity_token|_token|csrf_?token|csrfmiddlewaretoken|_csrf|form_build_id|form_id|form_token|_wpnonce)$/i;
/** The button that sent the form carries its own label, such as "Zoeken"; under these names that is all it is. */
const FORM_BUTTON_KEY = /^(?:submit|op|btn[\w-]*|button[\w-]*|zoek(?:en|knop)?|search(?:button|btn|submit)?|[\w$-]*\$(?:btn|button)[\w$-]*)$/i;
/** Longer than a filter, a sort order or a page number; a field this long, or with more words, that is not the term carries text of its own. */
const FORM_CHOICE_MAX = 64;
const FORM_CHOICE_WORDS = 4;
const FORM_FIELDS_MAX = 300;

/** The fields of a body sent as `application/x-www-form-urlencoded`, or null when it is not one. */
function urlEncodedFields(body: string): [string, string][] | null {
  if (!/^[^=&\s{[]+=[^&]*(?:&[^=&]+(?:=[^&]*)?)*&?$/.test(body.trim())) return null;
  try {
    return body
      .trim()
      .split("&")
      .filter((part) => part !== "")
      .map((part) => {
        const at = part.indexOf("=");
        const decode = (text: string): string => decodeURIComponent(text.replace(/\+/g, " "));
        return at === -1 ? [decode(part), ""] : [decode(part.slice(0, at)), decode(part.slice(at + 1))];
      });
  } catch {
    return null;
  }
}

/** The fields of a body sent as `multipart/form-data`, or null when it is not one; a file in it gives "file". */
function multipartFields(body: string): [string, string][] | "file" | null {
  const boundary = /^--([^\r\n]+)\r?\n/.exec(body)?.[1];
  if (!boundary) return null;
  const fields: [string, string][] = [];
  for (const part of body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith("--")) break;
    const split = /\r?\n\r?\n/.exec(part);
    if (!split) return null;
    const head = part.slice(0, split.index);
    const name = /content-disposition:\s*form-data;[^\r\n]*\bname="([^"]*)"/i.exec(head)?.[1];
    if (name === undefined) return null;
    if (/\bfilename="/i.test(head)) return "file";
    fields.push([name, part.slice(split.index + split[0].length).replace(/\r?\n$/, "")]);
  }
  return fields.length > 0 ? fields : null;
}

/**
 * A search form posted to a page of the site, such as one that shows its results on the page
 * that receives the post: the term of the run is the value of a field, and every other field
 * with a value is a short choice (a filter, a sort order, a page, the label of the button) or
 * state the framework adds. An empty field carries nothing, so a whole page sent as one form
 * (ASP.NET WebForms) passes as long as only the search was filled in.
 */
function searchForm(body: string, _path?: string, terms?: readonly string[]): Verdict {
  const known = (terms ?? []).filter((term) => term.trim() !== "");
  if (known.length === 0) return no("loep kent de zoekterm van deze run hier niet, en alleen daaraan is een zoekformulier te herkennen");
  if (parseJson(body).ok) return no("de body is JSON en geen formulier");
  const parsed = urlEncodedFields(body) ?? multipartFields(body);
  if (parsed === "file") return no("het formulier stuurt een bestand mee, en een zoekvraag doet dat niet");
  if (parsed === null) return no("de body is geen formulier (application/x-www-form-urlencoded of multipart/form-data)");
  if (parsed.length > FORM_FIELDS_MAX) return no(`het formulier heeft meer dan ${FORM_FIELDS_MAX} velden`);
  let term = false;
  for (const [key, value] of parsed) {
    if (EMAIL_LIKE.test(value)) return no(`het veld "${key}" bevat iets dat op een e-mailadres lijkt, en een zoekvraag heeft dat niet`);
    if (value.trim() === "" || FORM_STATE_KEY.test(key)) continue;
    if (known.some((candidate) => sameTerm(value, candidate))) {
      term = true;
      continue;
    }
    const bare = key.toLowerCase().replace(/[-_\s.]/g, "");
    const leaf = key.split(/[$:.[\]]/).filter(Boolean).pop()?.toLowerCase().replace(/[-_\s]/g, "") ?? bare;
    if (FORM_BUTTON_KEY.test(key) || FORM_BUTTON_KEY.test(leaf)) {
      if (value.length > FORM_CHOICE_MAX) return no(`de knop "${key}" heeft een waarde van meer dan ${FORM_CHOICE_MAX} tekens`);
      continue;
    }
    if (TERM_WRITE_KEYS.has(bare) || TERM_WRITE_KEYS.has(leaf)) return no(`het veld "${key}" is ingevuld, en dat wijst op een verzoek dat iets wijzigt of persoonsgegevens meestuurt`);
    if (value.length > FORM_CHOICE_MAX || value.trim().split(/\s+/).length > FORM_CHOICE_WORDS) return no(`het veld "${key}" is niet de zoekterm en heeft meer dan ${FORM_CHOICE_WORDS} woorden of ${FORM_CHOICE_MAX} tekens: dat is tekst van een bezoeker, geen keuze`);
  }
  if (!term) return no("de zoekterm van de run is niet de waarde van een veld in het formulier");
  return yes;
}

/**
 * What the name of a field has to say for it to count as a choice that only narrows, orders or
 * pages a list. This is the anchor of `filterform`: a search form is known by the term loep typed
 * itself, a filter has no such term, so the names of its fields have to tell. A poll, a consent or
 * a preference is a form of only choices too, and it records something: its fields are not named
 * like these.
 */
const FILTER_WORDS = new Set([
  "sort", "sortby", "sorteer", "sorteren", "sortering", "orderby", "volgorde", "richting", "direction", "asc", "desc",
  "filter", "filters", "facet", "facets", "categorie", "categorieen", "category", "categories", "thema", "themas", "theme", "type", "types", "soort", "tag", "tags",
  "jaar", "jaren", "year", "years", "maand", "month", "periode", "period", "datum", "date",
  "page", "pagina", "pager", "pagesize", "perpage", "limit", "offset", "aantal", "resultaten", "results",
]);
/** A name written in one piece, such as "ddljaar" for a dropdown: it counts when it ends in one of these. */
const FILTER_ENDINGS = ["sortering", "sorteren", "filter", "categorie", "category", "thema", "jaar", "year", "maand", "month", "periode", "datum", "pagina"];
/** What a choice or a button must not say: then the form does something, whatever its fields are called. */
const FORM_ACTION_WORDS = new Set([
  "verwijder", "verwijderen", "delete", "remove", "wis", "wissen", "opslaan", "bewaar", "bewaren", "save", "verstuur", "versturen", "verzend", "verzenden", "send",
  "stem", "stemmen", "vote", "bestel", "bestellen", "order", "betaal", "betalen", "pay", "aanmelden", "afmelden", "inschrijven", "uitschrijven", "subscribe", "unsubscribe",
  "akkoord", "accepteer", "accepteren", "accept", "weiger", "weigeren", "bevestig", "bevestigen", "confirm", "registreer", "registreren", "register", "login", "inloggen", "logout", "uitloggen",
  "wijzig", "wijzigen", "update", "create", "maak", "toevoegen", "add", "reageer", "reageren", "plaats", "plaatsen", "like", "volg", "volgen", "follow",
]);

/** The lowercase words of a name or a value: cut on everything that is no letter or digit, and on a change of case ("ddlJaar" gives "ddl" and "jaar"). */
const formWords = (text: string): string[] =>
  text
    .replace(/([a-z0-9])(?=[A-Z])/g, "$1 ")
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f]+/)
    .filter(Boolean);

/** The last part of the name of a field, where a framework writes the whole path of the control: `ctl00$Main$ddlJaar`, `filter[jaar]`. */
const leafOf = (key: string): string => key.split(/[$:.[\]]/).filter(Boolean).pop() ?? key;

const namesFilter = (key: string): boolean => {
  const words = [...formWords(leafOf(key)), ...formWords(key)];
  return words.some((word) => FILTER_WORDS.has(word) || FILTER_ENDINGS.some((ending) => word.length > ending.length && word.endsWith(ending)));
};

/**
 * A filter or a sort order posted to a page of the site, such as a list that loads the results for
 * another year with a POST to itself. There is no term of the run in it, so the form has to show
 * by itself that it only asks: every field with a value is state of the framework, a button, or a
 * short choice in a field named as a filter, a sort order or a page, and at least one such choice
 * is there. What the framework posts as the control that set it off (`__EVENTTARGET` of ASP.NET
 * WebForms) has to be such a field too: under that name any button of the page can be pressed.
 */
function filterForm(body: string): Verdict {
  const parsed = formOf(body);
  if (!Array.isArray(parsed)) return parsed;
  const fields = filterFields(parsed);
  if (!("choices" in fields)) return fields;
  if (fields.choices === 0) return no("het formulier heeft geen ingevuld veld dat als een filter, een sortering of een pagina heet");
  return yes;
}

/** The fields of a form body, or why it is no form a filter would send. */
function formOf(body: string): [string, string][] | Verdict {
  if (parseJson(body).ok) return no("de body is JSON en geen formulier");
  const parsed = urlEncodedFields(body) ?? multipartFields(body);
  if (parsed === "file") return no("het formulier stuurt een bestand mee, en een filter doet dat niet");
  if (parsed === null) return no("de body is geen formulier (application/x-www-form-urlencoded of multipart/form-data)");
  if (parsed.length > FORM_FIELDS_MAX) return no(`het formulier heeft meer dan ${FORM_FIELDS_MAX} velden`);
  return parsed;
}

/**
 * Whether every field with a value is state of the framework, a button, or a short choice in a
 * field named as a filter, a sort order or a page (or one of `names`), with the number of such
 * choices; otherwise why not.
 */
function filterFields(parsed: readonly [string, string][], names: ReadonlySet<string> = new Set()): { choices: number } | Verdict {
  let choices = 0;
  for (const [key, value] of parsed) {
    if (EMAIL_LIKE.test(value)) return no(`het veld "${key}" bevat iets dat op een e-mailadres lijkt, en een filter heeft dat niet`);
    if (value.trim() === "") continue;
    if (/^__EVENTTARGET$/i.test(key)) {
      if (!namesFilter(value)) return no(`het formulier is verstuurd door "${leafOf(value)}", en die naam wijst niet op een filter, een sortering of een pagina`);
      continue;
    }
    if (FORM_STATE_KEY.test(key)) continue;
    const acts = formWords(value).find((word) => FORM_ACTION_WORDS.has(word));
    if (acts) return no(`het veld "${key}" heeft de waarde "${acts}", en dat wijst op een verzoek dat iets doet`);
    const bare = key.toLowerCase().replace(/[-_\s.]/g, "");
    const leaf = leafOf(key).toLowerCase().replace(/[-_\s]/g, "");
    if (FORM_BUTTON_KEY.test(key) || FORM_BUTTON_KEY.test(leaf)) {
      if (value.length > FORM_CHOICE_MAX) return no(`de knop "${key}" heeft een waarde van meer dan ${FORM_CHOICE_MAX} tekens`);
      continue;
    }
    if (TERM_WRITE_KEYS.has(bare) || TERM_WRITE_KEYS.has(leaf)) return no(`het veld "${key}" is ingevuld, en dat wijst op een verzoek dat iets wijzigt of persoonsgegevens meestuurt`);
    if (!namesFilter(key) && !names.has(leaf)) return no(`het veld "${key}" is ingevuld en heet niet als een filter, een sortering of een pagina: loep kan niet zien dat het alleen iets opvraagt`);
    if (value.length > FORM_CHOICE_MAX || value.trim().split(/\s+/).length > FORM_CHOICE_WORDS) return no(`het veld "${key}" heeft meer dan ${FORM_CHOICE_WORDS} woorden of ${FORM_CHOICE_MAX} tekens: dat is tekst van een bezoeker, geen keuze`);
    choices += 1;
  }
  return { choices };
}

// WordPress sends what a plugin or theme asks for without a page load to one address, `/wp-admin/admin-ajax.php`,
// and the field `action` says which handler answers. That address serves every handler, also the ones that send a
// form, place a comment, log in or count a view, so the address says nothing and only the action can tell. This rule
// holds for the CMS and not for one site: an action passes only when one of its words asks for a list (filter, sort,
// page, load more, search) and none of them does something. Whatever else is filled in has to be what `filterform`
// accepts, so a filter that carries a name, an e-mail address or text of a visitor stays held back.
const WORDPRESS_AJAX_PATH = /(?:^|\/)wp-admin\/admin-ajax\.php$/;
/** The words of an action that ask for a list: at least one of these. */
const WORDPRESS_READ_ACTION_WORDS = new Set([
  "filter", "filters", "filteren", "facet", "facets", "facetwp", "sort", "sorteer", "sorteren", "page", "paged", "paginate", "pagination", "pagina",
  "load", "loadmore", "more", "meer", "laad", "fetch", "get", "query", "search", "zoek", "zoeken", "refresh", "results", "resultaten",
]);
/** The words of an action that do something, on top of what a choice of a filter must not say: one of these and it stays held back. */
const WORDPRESS_WRITE_ACTION_WORDS = new Set([
  ...FORM_ACTION_WORDS, "submit", "upload", "edit", "set", "reset", "insert", "import", "comment", "comments", "reactie", "review", "rate", "rating", "poll",
  "cart", "checkout", "basket", "winkelwagen", "booking", "reserve", "reserveer", "reservering", "afspraak", "appointment",
  "contact", "form", "formulier", "mail", "email", "newsletter", "nieuwsbrief", "signup", "signin", "signout", "password", "wachtwoord", "user", "account", "profile",
  "heartbeat", "view", "views", "count", "counter", "hit", "hits", "track", "tracking", "log", "stats", "statistics", "session", "cookie", "cookies", "consent", "dismiss", "notice",
]);
/** The fields that carry the nonce of WordPress against forged requests: state of the CMS, short and with no input of the visitor. */
const WORDPRESS_NONCE_KEY = /^(?:nonce|security|_ajax_nonce|_wpnonce|wpnonce)$/i;
/** Names WordPress itself gives to a choice of a list, as in its query variables. */
const WORDPRESS_FILTER_NAMES = new Set(["paged", "cat", "cats", "taxonomy", "term", "terms"]);

function wordpressAjax(body: string, path?: string): Verdict {
  if (path === undefined || !WORDPRESS_AJAX_PATH.test(path)) return no("het adres is niet /wp-admin/admin-ajax.php van WordPress");
  const parsed = formOf(body);
  if (!Array.isArray(parsed)) return parsed;
  const actions = parsed.filter(([key]) => key === "action");
  if (actions.length !== 1) return no('het verzoek heeft niet precies één veld "action", en daaraan alleen is te zien wat WordPress ermee doet');
  const action = actions[0]![1].trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(action)) return no('het veld "action" is geen korte naam van een handler');
  const words = formWords(action);
  const writes = words.find((word) => WORDPRESS_WRITE_ACTION_WORDS.has(word));
  if (writes) return no(`de actie "${action}" bevat "${writes}", en dat wijst op een verzoek dat iets doet`);
  if (!words.some((word) => WORDPRESS_READ_ACTION_WORDS.has(word))) return no(`de actie "${action}" noemt geen filter, sortering, pagina of zoekvraag: loep kan niet zien dat ze alleen iets opvraagt`);
  const rest: [string, string][] = [];
  for (const [key, value] of parsed) {
    if (key === "action") continue;
    if (WORDPRESS_NONCE_KEY.test(key)) {
      if (!/^[A-Za-z0-9]{0,32}$/.test(value)) return no(`het veld "${key}" is geen nonce van WordPress`);
      continue;
    }
    // WordPress names the direction of a sort order "order"; elsewhere that name points at an order.
    if (key === "order" && /^(?:asc|desc)$/i.test(value)) continue;
    rest.push([key, value]);
  }
  const fields = filterFields(rest, WORDPRESS_FILTER_NAMES);
  return "choices" in fields ? yes : fields;
}

export const SEARCH_SERVICES: Record<SearchServiceId, SearchService> = {
  typesense: { id: "typesense", nameNl: "Typesense", formNl: 'JSON met "searches", een lijst van zoekvragen (POST /multi_search)', recognise: typesense },
  algolia: { id: "algolia", nameNl: "Algolia", formNl: 'JSON met "requests", elk met "indexName" en "params" of met "indexName" en losse zoekparameters zoals "query" en "hitsPerPage", of met alleen "params", of losse zoekparameters aan POST /1/indexes/<index>/query', recognise: algolia },
  elasticsearch: { id: "elasticsearch", nameNl: "Elasticsearch of OpenSearch", formNl: 'een zoekvraag met "query", "aggs" of "suggest" zonder script (_search), of regels met telkens een kop en een zoekvraag (_msearch)', recognise: elasticsearch },
  meilisearch: { id: "meilisearch", nameNl: "Meilisearch", formNl: 'JSON met zoekparameters als "q" en "filter", of met "queries"', recognise: meilisearch },
  graphql: { id: "graphql", nameNl: "GraphQL", formNl: 'JSON met een document in "query" dat alleen query-bewerkingen heeft, geen mutation of subscription', recognise: graphql },
  searchui: { id: "searchui", nameNl: "Elastic Search UI", formNl: 'JSON met alleen "state" of "requestState" en "queryConfig", met de zoekterm, filters en paginering van Search UI (zoals POST /api/search)', recognise: searchUi },
  searchterm: {
    id: "searchterm",
    nameNl: "een zoekdienst met de zoekterm van de run in de body",
    formNl: "JSON waarin de zoekterm van de run (of de term die niets vindt) letterlijk als waarde staat, ook genest, zonder velden die iets wijzigen of persoonsgegevens dragen, zoals bij Google Discovery Engine (…:searchLite) of /api/v2/search",
    recognise: searchTerm,
  },
  searchform: {
    id: "searchform",
    nameNl: "een zoekformulier met de zoekterm van de run als veld",
    formNl: "een formulier (application/x-www-form-urlencoded of multipart/form-data) waarin de zoekterm van de run de waarde van een veld is. Verder alleen lege velden, korte keuzes zoals een filter, de sortering, de pagina of de tekst van de zoekknop, en velden die het framework zelf toevoegt (zoals __VIEWSTATE of een token tegen vervalste verzoeken). Geen bestand, geen e-mailadres en geen ingevuld veld dat iets wijzigt of persoonsgegevens draagt. Zoals een zoekfunctie die met een POST naar de eigen pagina de resultaten toont",
    recognise: searchForm,
  },
  filterform: {
    id: "filterform",
    nameNl: "een filter of sortering als formulier",
    formNl: "een formulier (application/x-www-form-urlencoded of multipart/form-data) zonder zoekterm, waarin elk ingevuld veld een korte keuze is in een veld dat als een filter, een sortering of een pagina heet (zoals jaar, categorie, sort of page), de tekst van een knop, of een veld dat het framework zelf toevoegt. Minstens één zo'n keuze. Geen bestand, geen e-mailadres, geen veld met een andere naam, en geen keuze of knop die iets doet (zoals stemmen, opslaan of verwijderen). Zoals een lijst die met een POST naar de eigen pagina de resultaten van een ander jaar laadt",
    recognise: filterForm,
  },
  wordpressajax: {
    id: "wordpressajax",
    nameNl: "een filter of sortering via admin-ajax.php van WordPress",
    formNl: 'een formulier aan /wp-admin/admin-ajax.php van WordPress met precies één veld "action", waarvan een woord om een lijst vraagt (zoals filter, sort, page, load_more of search) en geen woord iets doet (zoals submit, comment, vote, login, contact of view). Verder alleen de nonce van WordPress, lege velden en wat ook in een filter of sortering als formulier mag staan. Zoals een lijst die met action=filter de resultaten van een andere categorie laadt',
    recognise: wordpressAjax,
  },
};

/** Whether the body is a question to this service. An empty or very large body never is. `terms` are the search terms of the run (see `searchterm`). */
export function recogniseSearch(service: SearchServiceId, body: string | null, path?: string, terms?: readonly string[]): Verdict {
  if (body === null || body.trim() === "") return no("het verzoek heeft geen body");
  if (body.length > MAX_BODY) return no(`de body is groter dan ${MAX_BODY / 1024} kB`);
  return SEARCH_SERVICES[service].recognise(body, path, terms);
}

/** Every service that would take this body for a question to it; empty when none does. For the record of a request that was held back. */
export function searchServicesOf(body: string | null, path?: string, terms?: readonly string[]): SearchServiceId[] {
  return SEARCH_SERVICE_IDS.filter((id) => recogniseSearch(id, body, path, terms).search);
}
