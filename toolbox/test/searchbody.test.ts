import assert from "node:assert/strict";
import { test } from "node:test";
import { graphqlOperations, MAX_BODY, recogniseSearch, SEARCH_SERVICE_IDS, searchServicesOf, type SearchServiceId } from "../src/lib/searchbody.ts";

const json = (value: unknown): string => JSON.stringify(value);
const lines = (...values: unknown[]): string => `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;

/**
 * Per service: bodies that are a question to it, and bodies that are not, with a word of the
 * reason. The refusals include bodies that look like a search and ask to change something.
 */
const CASES: Record<SearchServiceId, { search: [string, string][]; not: [string, string, RegExp][] }> = {
  typesense: {
    search: [
      ["multi_search", json({ searches: [{ collection: "producten", q: "afval", query_by: "titel" }] })],
      ["two questions and a union", json({ union: true, searches: [{ collection: "a", q: "x" }, { preset: "standaard", q: "y" }] })],
    ],
    not: [
      ["documents to import", json({ documents: [{ id: "1", titel: "x" }] }), /kent "documents" niet/],
      ["an empty list", json({ searches: [] }), /lijst van zoekvragen/],
      ["an action inside a search", json({ searches: [{ collection: "a", q: "x", action: "upsert" }] }), /bevat "action"/],
      ["a search without anything to search", json({ searches: [{ per_page: 10 }] }), /noemt geen van/],
      ["not JSON", "q=afval", /geen JSON/],
    ],
  },
  algolia: {
    search: [
      ["multiple queries", json({ requests: [{ indexName: "gemeente", params: "query=afval&hitsPerPage=10" }] })],
      ["a facet question", json({ requests: [{ indexName: "gemeente", type: "facet", facet: "soort", params: "query=a" }] })],
      ["one index", json({ params: "query=afval" })],
      [
        "client v5 with inline parameters (DocSearch 4)",
        json({
          requests: [
            {
              query: "test",
              indexName: "docs",
              attributesToRetrieve: ["hierarchy.lvl0", "content", "type", "url"],
              attributesToSnippet: ["hierarchy.lvl1:10", "content:10"],
              snippetEllipsisText: "…",
              highlightPreTag: "<mark>",
              highlightPostTag: "</mark>",
              hitsPerPage: 20,
              clickAnalytics: false,
              facetFilters: ["language:nl"],
            },
          ],
        }),
      ],
    ],
    not: [
      ["a batch that adds objects", json({ requests: [{ action: "addObject", indexName: "gemeente", body: { titel: "x" } }] }), /bevat "action"/],
      ["an object to save", json({ objectID: "1", titel: "x" }), /kent "objectID" niet/],
      ["settings next to params", json({ params: "query=a", searchableAttributes: ["titel"] }), /alleen "params"/],
      ["a request without index", json({ requests: [{ params: "query=a" }] }), /"indexName"/],
      ["an object next to inline parameters", json({ requests: [{ indexName: "g", query: "a", objectID: "1", body: { titel: "x" } }] }), /bevat "objectID"/],
      ["an index setting next to inline parameters", json({ requests: [{ indexName: "g", query: "a", searchableAttributes: ["titel"] }] }), /bevat "searchableAttributes"/],
      ["another type", json({ requests: [{ indexName: "g", type: "delete", params: "" }] }), /"default" of "facet"/],
    ],
  },
  elasticsearch: {
    search: [
      ["_search with a query", json({ query: { match: { titel: "afval" } }, size: 10, from: 0 })],
      ["_search with aggregations only", json({ size: 0, aggs: { soorten: { terms: { field: "soort" } } } })],
      ["_msearch", lines({ index: "producten" }, { query: { match_all: {} } }, {}, { query: { term: { soort: "a" } } })],
    ],
    not: [
      ["update by query", json({ query: { match_all: {} }, script: { source: "ctx._source.x = 1" } }), /kent "script" niet/],
      ["a script in a query", json({ query: { script_score: { query: { match_all: {} }, script: { source: "1" } } } }), /bevat "script"/],
      ["a document to index", json({ titel: "x", soort: "a" }), /kent "titel" niet/],
      ["a GraphQL request", json({ query: "{ a }" }), /"query" van een zoekvraag aan Elasticsearch is een object/],
      ["an update of a document", json({ doc: { titel: "x" } }), /kent "doc" niet/],
      ["_bulk", lines({ index: { _index: "producten", _id: "1" } }, { query: { match_all: {} } }), /naam van een index, geen object/],
      ["_bulk with a delete", lines({ delete: { _index: "producten", _id: "1" } }, { query: { match_all: {} } }), /bevat "delete"/],
      ["half an _msearch", `${json({ index: "producten" })}\nnot json\n`, /regel 2 van de body is geen JSON/],
    ],
  },
  meilisearch: {
    search: [
      ["search", json({ q: "afval", limit: 20, filter: "soort = a" })],
      ["multi-search", json({ queries: [{ indexUid: "producten", q: "afval" }, { indexUid: "nieuws", q: "afval" }] })],
    ],
    not: [
      ["settings", json({ searchableAttributes: ["titel"] }), /kent "searchableAttributes" niet/],
      ["documents to add", json([{ id: 1, titel: "x" }]), /geen JSON-object/],
      ["a query without index", json({ queries: [{ q: "afval" }] }), /"indexUid"/],
      ["only paging", json({ limit: 10 }), /heeft q, filter/],
    ],
  },
  graphql: {
    search: [
      ["a named query", json({ query: "query Zoek($q: String!) { zoek(term: $q) { titel url } }", variables: { q: "afval" }, operationName: "Zoek" })],
      ["the short form", json({ query: "{ zoek(term: \"afval\") { titel } }" })],
      ["a query with a fragment", json({ query: "query { zoek { ...Velden } } fragment Velden on Resultaat { titel }" })],
      ["a field called mutation", json({ query: "query { mutation { id } }" })],
      ["the word in a string and a comment", json({ query: "# mutation { wis }\nquery { zoek(term: \"} mutation { wis\") { titel } }" })],
      ["a batch of queries", json([{ query: "{ a }" }, { query: "query B { b }" }])],
      ["a default value with an object", json({ query: "query Z($f: Filter = {soort: \"a\"}) @cached(ttl: 60) { zoek(filter: $f) { titel } }" })],
    ],
    not: [
      ["a mutation", json({ query: "mutation { verwijder(id: 1) { id } }" }), /bevat een mutation/],
      ["a query and a mutation", json({ query: "query A { a } mutation B { wis }", operationName: "A" }), /bevat een mutation/],
      ["a subscription", json({ query: "subscription { berichten { tekst } }" }), /bevat een subscription/],
      ["a mutation in a batch", json([{ query: "{ a }" }, { query: "mutation { b }" }]), /bevat een mutation/],
      ["a persisted query without document", json({ extensions: { persistedQuery: { version: 1, sha256Hash: "abc" } } }), /zonder document/],
      ["a schema definition", json({ query: "type Query { a: String }" }), /"type" is geen begin/],
      ["an unclosed string", json({ query: "query { a(b: \"x) }" }), /niet te lezen/],
      ["an unclosed brace", json({ query: "query { a { b }" }), /accolade is niet gesloten/],
      ["the raw document", "query { a }", /geen JSON/],
    ],
  },
  searchui: {
    search: [
      [
        "a list with filters on the site's own /api/search",
        json({
          requestState: { current: 1, filters: [{ field: "content_type", values: ["pro:newsDocument"], type: "all" }], resultsPerPage: 20, searchTerm: "", sortList: [{ field: "date", direction: "desc" }] },
          queryConfig: {
            filters: [{ field: "content_type", values: ["pro:newsDocument"], type: "all" }],
            result_fields: { url: { raw: {} }, meta_description: { raw: {}, snippet: { size: 140, fallback: true } } },
            disjunctiveFacets: ["information_type"],
            facets: { information_type: { type: "value", size: 100 }, date: { type: "range", ranges: [{ from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z", name: "past007Days" }] } },
            current: 1,
            resultsPerPage: 20,
            searchTerm: "",
          },
        }),
      ],
      ["ApiProxyConnector", json({ state: { searchTerm: "afval", current: 1 }, queryConfig: { search_fields: { title: { weight: 3 } }, searchTerm: "afval" } })],
      ["autocomplete", json({ state: { searchTerm: "afv" }, queryConfig: { results: { resultsPerPage: 5, result_fields: { title: { snippet: { size: 100 } } } }, suggestions: { types: { documents: { fields: ["title"] } }, size: 4 } } })],
    ],
    not: [
      ["a document next to the state", json({ state: { searchTerm: "a" }, queryConfig: {}, document: { titel: "x" } }), /niet "document"/],
      ["an unknown key in the query", json({ requestState: {}, queryConfig: { index: "nieuws", delete: true } }), /kent "index" niet/],
      ["a form", json({ naam: "Test", email: "test@example.com" }), /heeft "state" of "requestState"/],
      ["no query config", json({ state: { searchTerm: "a" } }), /"queryConfig"/],
      ["a search term that is not text", json({ state: { searchTerm: { $set: 1 } }, queryConfig: {} }), /is tekst/],
      ["a filter with another key", json({ state: { filters: [{ field: "a", values: [], action: "remove" }] }, queryConfig: {} }), /kent "action" niet/],
      ["other keys next to autocomplete", json({ state: {}, queryConfig: { results: {}, update: {} } }), /niet "update"/],
    ],
  },
  // Recognised only with the terms of the run; see the tests below.
  searchterm: {
    search: [],
    not: [["any body without the terms of the run", json({ query: "afval" }), /kent de zoekterm van deze run hier niet/]],
  },
  searchform: {
    search: [],
    not: [["any form without the terms of the run", "q=afval", /kent de zoekterm van deze run hier niet/]],
  },
  // Recognised by the names of its fields; see the tests below.
  filterform: {
    search: [["a year chosen in a list", "jaar=2025"]],
    not: [["a form with a field that is no filter", "q=afval", /heet niet als een filter/]],
  },
  // Recognised only on the address of WordPress; see the tests below.
  wordpressajax: {
    search: [],
    not: [["any form on another address", "action=alm_get_posts&paged=2", /niet \/wp-admin\/admin-ajax\.php/]],
  },
};

for (const service of SEARCH_SERVICE_IDS) {
  test(`the body of a question to ${service} is recognised, and a body that changes something is not`, () => {
    for (const [name, body] of CASES[service].search) assert.deepEqual(recogniseSearch(service, body), { search: true }, `${service}: ${name}`);
    for (const [name, body, reason] of CASES[service].not) {
      const verdict = recogniseSearch(service, body);
      assert.equal(verdict.search, false, `${service}: ${name} must not count as a search`);
      if (!verdict.search) assert.match(verdict.reasonNl, reason, `${service}: ${name}`);
    }
  });
}

test("a body is a question to the one service whose form it has, and an empty or huge body to none", () => {
  assert.deepEqual(searchServicesOf(json({ searches: [{ collection: "a", q: "x" }] })), ["typesense"]);
  assert.deepEqual(searchServicesOf(json({ requests: [{ indexName: "g", params: "query=a" }] })), ["algolia"]);
  assert.deepEqual(searchServicesOf(json({ query: { match_all: {} } })), ["elasticsearch"]);
  assert.deepEqual(searchServicesOf(json({ q: "afval" })), ["meilisearch"]);
  assert.deepEqual(searchServicesOf(json({ query: "{ a }" })), ["graphql"]);
  assert.deepEqual(searchServicesOf(json({ requestState: { searchTerm: "a" }, queryConfig: { searchTerm: "a" } })), ["searchui"]);
  assert.deepEqual(searchServicesOf("naam=Test&email=test%40example.com"), []);
  assert.deepEqual(searchServicesOf(null), []);
  assert.deepEqual(recogniseSearch("meilisearch", ""), { search: false, reasonNl: "het verzoek heeft geen body" });
  assert.equal(recogniseSearch("meilisearch", json({ q: "x".repeat(MAX_BODY) })).search, false);
});

test("Algolia: search parameters inline at the top of the body count only on the query path of one index", () => {
  const path = "/1/indexes/nldesignsystem/query";
  const inline = json({ query: "test", hitsPerPage: 20, attributesToRetrieve: ["url"], facetFilters: [["language:nl"]] });
  assert.deepEqual(recogniseSearch("algolia", inline, path), { search: true });
  assert.deepEqual(recogniseSearch("algolia", json({ query: "" }), path), { search: true });
  assert.deepEqual(searchServicesOf(inline, path), ["algolia"]);
  assert.deepEqual(recogniseSearch("algolia", json({ params: "query=a" }), path), { search: true });
  assert.deepEqual(recogniseSearch("algolia", json({ requests: [{ indexName: "g", query: "a" }] }), "/1/indexes/*/queries"), { search: true });
  // Not on another path, nor without one.
  for (const other of [undefined, "/", "/1/indexes/x/queries", "/1/indexes/*/queries", "/1/indexes/x/facets/f/query", "/1/indexes/x/y/query", "/1/indexes/x/query/extra", "/api/graphql"]) {
    assert.equal(recogniseSearch("algolia", inline, other).search, false, `path ${other}`);
  }
  assert.deepEqual(searchServicesOf(json({ query: "test", hitsPerPage: 20 }), "/search"), []);
  assert.deepEqual(searchServicesOf(json({ query: "{ a }" }), path).sort(), ["algolia", "graphql"]);
  // Refused on the query path: a key that is no search parameter, a write, and odd shapes.
  const refused: [string, string, RegExp][] = [
    ["an object to save", json({ objectID: "1", titel: "x" }), /niet "objectID"/],
    ["a search parameter next to an object", json({ query: "a", objectID: "1" }), /niet "objectID"/],
    ["an index setting", json({ query: "a", searchableAttributes: ["titel"] }), /niet "searchableAttributes"/],
    ["an empty object", "{}", /minstens één zoekparameter/],
    ["a query that is no text", json({ query: { match_all: {} } }), /"query" van Algolia is tekst/],
    ["a number as query", json({ query: 5 }), /"query" van Algolia is tekst/],
    ["a list", json([{ query: "a" }]), /geen JSON-object/],
    ["not JSON", "query=a", /geen JSON/],
    ["a write word inside", json({ action: "addObject", query: "a" }), /niet "action"/],
  ];
  for (const [name, body, reason] of refused) {
    const verdict = recogniseSearch("algolia", body, path);
    assert.equal(verdict.search, false, name);
    if (!verdict.search) assert.match(verdict.reasonNl, reason, name);
  }
});

test("a GraphQL document is read by its tokens, not by a word", () => {
  assert.deepEqual(graphqlOperations("query A { a } fragment F on T { b } { c }"), ["query", "query"]);
  // A description belongs to a schema, not to a request; the word inside it is never read as an operation.
  assert.match(String(graphqlOperations('"""Beschrijving met mutation { }"""\nquery { a }')), /is geen begin van een bewerking of fragment/);
  assert.deepEqual(graphqlOperations("mutation{a}"), ["mutation"]);
  assert.match(String(graphqlOperations("query { a } %")), /het teken "%"/);
  assert.equal(graphqlOperations(""), "het document heeft geen bewerking");
});

const TERMS = ["afvalkalender", "loepqzx"];

test("a JSON body with the search term of the run as a value, also nested, is a search by its term", () => {
  // The form of Google Discovery Engine (POST .../servingConfigs/default_search:searchLite).
  const discovery = json({ servingConfig: "projects/1/locations/global/collections/default_collection/engines/e/servingConfigs/default_search", query: "afvalkalender", pageSize: 10, offset: 0, contentSearchSpec: { snippetSpec: { returnSnippet: true } } });
  assert.deepEqual(recogniseSearch("searchterm", discovery, "/v1alpha/projects/1/locations/global/collections/default_collection/engines/e/servingConfigs/default_search:searchLite", TERMS), { search: true });
  // Nested, in another case and with a trailing space, as for POST /api/v2/search and /api/v2/suggest.
  assert.deepEqual(recogniseSearch("searchterm", json({ request: { filters: [{ field: "text", values: ["Afvalkalender "] }] }, size: 5 }), "/api/v2/search", TERMS), { search: true });
  assert.deepEqual(recogniseSearch("searchterm", json([{ prefix: "afvalkalender" }]), "/api/v2/suggest", TERMS), { search: true });
  assert.deepEqual(recogniseSearch("searchterm", json({ q: "loepqzx" }), "/api/v2/search", TERMS), { search: true }, "the term that finds nothing is a term of the run too");
  assert.ok(searchServicesOf(discovery, "/x:searchLite", TERMS).includes("searchterm"));
});

test("a JSON body without the search term of the run, or one that may change something, is no search by its term", () => {
  const refused = (body: string, reason: RegExp, terms: readonly string[] | undefined = TERMS): void => {
    const verdict = recogniseSearch("searchterm", body, "/api/v2/search", terms);
    assert.equal(verdict.search, false, body);
    if (!verdict.search) assert.match(verdict.reasonNl, reason, body);
  };
  refused(json({ query: "parkeren" }), /staat niet letterlijk/);
  refused(json({ query: "afvalkalender ophalen" }), /staat niet letterlijk/, TERMS);
  refused(json({ query: "afvalkal" }), /staat niet letterlijk/);
  refused(json({ query: "afvalkalender" }), /kent de zoekterm/, []);
  assert.equal(recogniseSearch("searchterm", json({ query: "afvalkalender" }), "/api/v2/search").search, false, "without terms");
  refused(json({ query: "afvalkalender", action: "delete" }), /bevat "action"/);
  refused(json({ search: { q: "afvalkalender" }, documents: [{ id: 1 }] }), /bevat "documents"/);
  refused(json({ subject: "afvalkalender", body: "vraag" }), /bevat "subject"/);
  refused(json({ q: "afvalkalender", user: { E_mail: "x" } }), /bevat "E_mail"/);
  refused(json({ q: "afvalkalender", from: "test@example.com" }), /e-mailadres/);
  refused(json({ query: "mutation { wis(term: \"afvalkalender\") { id } }", variables: { term: "afvalkalender" } }), /mutation/);
  refused("q=afvalkalender", /geen JSON/);
  refused(json("afvalkalender"), /geen JSON-object of -lijst/);
});

test("form-encoded search parameters keep working as they did, and the terms change no other service", () => {
  const algolia = json({ requests: [{ indexName: "gemeente", params: "query=afvalkalender&hitsPerPage=10" }] });
  assert.deepEqual(recogniseSearch("algolia", algolia, "/1/indexes/*/queries", TERMS), { search: true });
  assert.deepEqual(searchServicesOf(algolia, "/1/indexes/*/queries", TERMS), ["algolia"], "a form-encoded string holding the term is not the term as a value");
  assert.deepEqual(searchServicesOf(json({ params: "query=afvalkalender" }), "/1/indexes/g/query", TERMS), ["algolia"]);
  // Since #570 a form with the term of the run as a field is a search form; a rule in readRequests still has to name its address.
  assert.deepEqual(searchServicesOf("q=afvalkalender&page=1", "/zoeken", TERMS), ["searchform"]);
  assert.deepEqual(searchServicesOf("q=afvalkalender&page=1", "/zoeken"), [], "without terms nothing changes");
  assert.deepEqual(searchServicesOf(json({ q: "afvalkalender" }), "/indexes/a/search"), ["meilisearch"], "without terms nothing changes");
  assert.deepEqual(searchServicesOf(json({ q: "afvalkalender" }), "/indexes/a/search", TERMS), ["meilisearch", "searchterm"]);
});

test("a search form posted to a page: the term of the run is a field, everything else is empty, a short choice, a button or state of the framework (#570)", () => {
  const TERMS = ["afvalkalender", "loepqzx"];
  const form = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();
  const yes = (name: string, body: string): void => assert.deepEqual(recogniseSearch("searchform", body, "/zoeken", TERMS), { search: true }, name);
  const not = (name: string, body: string, reason: RegExp): void => {
    const verdict = recogniseSearch("searchform", body, "/zoeken", TERMS);
    assert.equal(verdict.search, false, `${name} must not count as a search`);
    if (!verdict.search) assert.match(verdict.reasonNl, reason, name);
  };
  yes("a plain search form", form({ q: "afvalkalender" }));
  yes("with filters, a sort order, a page and the button", form({ zoekterm: "Afvalkalender", type: "nieuws", thema: "Afval en grondstoffen", sort: "datum", page: "2", submit: "Zoeken" }));
  yes("the term that finds nothing", form({ keyword: "loepqzx" }));
  yes("Drupal, with its form id and token", form({ keys: "afvalkalender", form_build_id: "form-abc123", form_id: "search_block_form", op: "Zoeken" }));
  // ASP.NET WebForms posts the whole page as one form: the newsletter field next to the search is there, empty.
  yes(
    "ASP.NET WebForms, with the state of the page and an empty newsletter field",
    form({ __VIEWSTATE: "x".repeat(4000), __VIEWSTATEGENERATOR: "CA0B0334", __EVENTVALIDATION: "y".repeat(500), __EVENTTARGET: "", "ctl00$Header$txtZoek": "afvalkalender", "ctl00$Header$btnZoek": "Zoek", "ctl00$Footer$txtEmail": "" }),
  );
  yes("multipart/form-data", '--b1\r\nContent-Disposition: form-data; name="q"\r\n\r\nafvalkalender\r\n--b1\r\nContent-Disposition: form-data; name="type"\r\n\r\nalles\r\n--b1--\r\n');

  not("a contact form with the term in it", form({ q: "afvalkalender", naam: "Test", bericht: "Hallo" }), /het veld "naam" is ingevuld/);
  not("a newsletter sign-up next to the search, filled in", form({ "ctl00$Header$txtZoek": "afvalkalender", "ctl00$Footer$txtEmail": "test@example.nl" }), /e-mailadres/);
  not("a login form", form({ q: "afvalkalender", password: "geheim" }), /het veld "password" is ingevuld/);
  not("a field with free text that is not the term", form({ q: "afvalkalender", toelichting: "Ik wil graag een afspraak maken over mijn container" }), /is niet de zoekterm en heeft meer dan 4 woorden of 64 tekens: dat is tekst van een bezoeker/);
  not("a form without the term", form({ q: "iets anders" }), /zoekterm van de run is niet de waarde van een veld/);
  not("a file", '--b1\r\nContent-Disposition: form-data; name="q"\r\n\r\nafvalkalender\r\n--b1\r\nContent-Disposition: form-data; name="bijlage"; filename="a.pdf"\r\n\r\n%PDF\r\n--b1--\r\n', /bestand/);
  not("JSON", json({ q: "afvalkalender" }), /JSON en geen formulier/);
  not("plain text", "afvalkalender", /geen formulier/);
  not("a button with a long value", form({ q: "afvalkalender", submit: "x".repeat(80) }), /knop "submit"/);
  // The term only passes as a whole value, not inside a longer one.
  not("the term inside a longer value", form({ vraag: "afvalkalender 2026" }), /zoekterm van de run is niet de waarde/);
});

test("a filter or sort order posted to a page: every field with a value is named as a filter, a sort order or a page, and nothing in it does something (#595)", () => {
  const form = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();
  const yes = (name: string, body: string): void => assert.deepEqual(recogniseSearch("filterform", body, "/agenda"), { search: true }, name);
  const not = (name: string, body: string, reason: RegExp): void => {
    const verdict = recogniseSearch("filterform", body, "/agenda");
    assert.equal(verdict.search, false, `${name} must not count as a filter`);
    if (!verdict.search) assert.match(verdict.reasonNl, reason, name);
  };
  yes("a year", form({ jaar: "2025" }));
  yes("a sort order and a page, with the button", form({ sort: "datum-aflopend", page: "2", submit: "Toon" }));
  yes("a category and a theme, with empty fields next to them", form({ categorie: "Nieuws", thema: "Wonen en bouwen", zoekterm: "", email: "" }));
  yes("Drupal, with its form id and token", form({ "filter[jaar]": "2024", form_build_id: "form-abc123", form_id: "views_exposed_form", op: "Toepassen" }));
  // ASP.NET WebForms: the dropdown posts the page itself, and names itself as what set the post off.
  yes(
    "ASP.NET WebForms, a dropdown that posts the page",
    form({ __VIEWSTATE: "x".repeat(4000), __EVENTVALIDATION: "y".repeat(500), __EVENTTARGET: "ctl00$Main$ddlJaar", __EVENTARGUMENT: "", "ctl00$Main$ddlJaar": "2025", "ctl00$Main$ddlSortering": "Datum", "ctl00$Footer$txtEmail": "" }),
  );
  yes("a name in one piece", form({ ddljaar: "2025" }));
  yes("multipart/form-data", '--b1\r\nContent-Disposition: form-data; name="periode"\r\n\r\n2025-Q1\r\n--b1--\r\n');

  // A form of only choices that records something: its fields are not named as a filter.
  not("a poll", form({ poll: "3", form_id: "poll_view_voting", op: "Stem" }), /heeft de waarde "stem"|heet niet als een filter/);
  not("a poll without a telling button", form({ keuze: "3", submit: "OK" }), /het veld "keuze" is ingevuld en heet niet als een filter/);
  not("a cookie consent", form({ consent: "all" }), /heet niet als een filter/);
  not("a preference", form({ nieuwsbrief: "ja" }), /heet niet als een filter/);
  // Named as a filter, and still doing something.
  not("a button that deletes", form({ jaar: "2025", submit: "Verwijderen" }), /heeft de waarde "verwijderen"/);
  not("a choice that does something", form({ type: "delete" }), /heeft de waarde "delete"/);
  not("ASP.NET WebForms, another button of the page set the post off", form({ __EVENTTARGET: "ctl00$Main$btnVerwijder", "ctl00$Main$ddlJaar": "2025" }), /verstuurd door "btnVerwijder", en die naam wijst niet op een filter/);
  // Only state and a button: nothing was chosen, so nothing says it is a filter. A logout is such a post.
  not("only a token and a button", form({ _token: "abc", submit: "Verder" }), /geen ingevuld veld dat als een filter/);
  not("an e-mail address", form({ jaar: "2025", "ctl00$Footer$txtEmail": "test@example.nl" }), /e-mailadres/);
  not("a field that carries personal data", form({ jaar: "2025", naam: "Test" }), /het veld "naam" is ingevuld/);
  not("text of a visitor in a field named as a filter", form({ filter: "ik wil graag weten wanneer de container wordt opgehaald" }), /meer dan 4 woorden of 64 tekens/);
  not("a file", '--b1\r\nContent-Disposition: form-data; name="jaar"\r\n\r\n2025\r\n--b1\r\nContent-Disposition: form-data; name="bijlage"; filename="a.pdf"\r\n\r\n%PDF\r\n--b1--\r\n', /bestand/);
  not("JSON", json({ jaar: "2025" }), /JSON en geen formulier/);
  // A search form is not a filter: the term is a field of another name, and only the term of the run lets it through.
  not("a search form", form({ q: "afvalkalender", page: "1" }), /het veld "q" is ingevuld en heet niet als een filter/);
  assert.deepEqual(searchServicesOf(form({ jaar: "2025", sort: "datum" }), "/agenda"), ["filterform"]);
});

test("a list of WordPress loaded through admin-ajax.php: the action is one of a fixed list of handlers that only read, and every other field is a choice of a filter (#630)", () => {
  const form = (fields: [string, string][]): string => new URLSearchParams(fields).toString();
  const AJAX = "/wp-admin/admin-ajax.php";
  const yes = (name: string, body: string, path = AJAX): void => assert.deepEqual(recogniseSearch("wordpressajax", body, path), { search: true }, name);
  const not = (name: string, body: string, reason: RegExp, path = AJAX): void => {
    const verdict = recogniseSearch("wordpressajax", body, path);
    assert.equal(verdict.search, false, `${name} must not count as a read`);
    if (!verdict.search) assert.match(verdict.reasonNl, reason, name);
  };
  yes("the next page of Ajax Load More, with a nonce", form([["action", "alm_get_posts"], ["paged", "2"], ["nonce", "a1b2c3d4e5"]]));
  yes("only the action", form([["action", "alm_get_posts"]]));
  yes("with the sort order of WordPress", form([["action", "alm_get_posts"], ["paged", "2"], ["orderby", "date"], ["order", "DESC"], ["security", "0f1e2d3c4b"]]));
  yes("with terms of a taxonomy, and empty fields", form([["action", "alm_get_posts"], ["taxonomy", "onderwerp"], ["term[]", "wonen"], ["term[]", "zorg"], ["s", ""]]));
  yes("WordPress in a subdirectory", form([["action", "alm_get_posts"], ["jaar", "2025"]]), "/nieuws/wp-admin/admin-ajax.php");
  // The filter of the page itself is no read to admin-ajax.php: the action is a field filterform does not know.
  assert.equal(recogniseSearch("filterform", form([["action", "alm_get_posts"], ["paged", "2"]]), AJAX).search, false);
  assert.deepEqual(searchServicesOf(form([["action", "alm_get_posts"], ["paged", "2"]]), AJAX), ["wordpressajax"]);
  assert.deepEqual(searchServicesOf(form([["action", "alm_get_posts"], ["paged", "2"]]), "/agenda"), []);

  // The words of an action say nothing: only an action on the list passes, exactly as it is written.
  for (const action of ["filter", "load_more_posts", "get_results", "facetwp_refresh", "contact_form_submit", "heartbeat", "publish_get_posts", "trash_load_posts", "approve_get_items", "savepost_load_more", "sendmail_get_results", "save2_get_posts", "ALM_GET_POSTS", "alm_get_posts ", " alm_get_posts", "alm_get_posts_save"]) {
    not(`the action "${action}"`, form([["action", action], ["paged", "2"]]), /staat niet in de lijst/);
  }
  not("no action", form([["paged", "2"]]), /precies één veld "action"/);
  not("two actions", form([["action", "alm_get_posts"], ["action", "vote"]]), /precies één veld "action"/);
  not("an action as an array", form([["paged", "2"], ["action[]", "alm_get_posts"]]), /precies één veld "action"/);
  not("an action of another case next to it", form([["action", "alm_get_posts"], ["Action", "vote"]]), /precies één veld "action"/);
  // PHP cuts a name off at NUL and turns a space or a dot into an underscore: such a name may reach the plugin as another field.
  not("NUL in a name", "action=alm_get_posts&action%00filter=submit_comment", /heeft een teken dat PHP anders kan lezen/);
  not("a dot in a name", "action=alm_get_posts&post.status=trash", /heeft een teken dat PHP anders kan lezen/);
  not("a space in a name", "action=alm_get_posts&post+status=trash", /heeft een teken dat PHP anders kan lezen/);
  not("a control character in a name, encoded", "action=alm_get_posts&paged%0A=2", /heeft een teken dat PHP anders kan lezen/);
  // A field that may tell the handler what to do holds the request back, whatever its value.
  for (const key of ["op", "submit", "task", "do", "method", "_method", "__task", "__data", "Submit", "args[op]"]) {
    not(`the field "${key}"`, form([["action", "alm_get_posts"], [key, "trash"]]), /kan zeggen wat de handler doet/);
  }
  not("a steering field with an empty value", form([["action", "alm_get_posts"], ["op", ""]]), /kan zeggen wat de handler doet/);
  // Only a form as application/x-www-form-urlencoded: PHP reads the boundary of multipart from the header, loep cannot.
  not("multipart/form-data", '--b1\r\nContent-Disposition: form-data; name="action"\r\n\r\nalm_get_posts\r\n--b1--\r\n', /geen formulier als application\/x-www-form-urlencoded/);
  not("JSON", json({ action: "alm_get_posts" }), /JSON en geen formulier/);
  // The other fields are held to what a filter may carry.
  not("a name next to a filter", form([["action", "alm_get_posts"], ["cat", "3"], ["naam", "Test"]]), /het veld "naam" is ingevuld/);
  not("an e-mail address", form([["action", "alm_get_posts"], ["cat", "3"], ["mail", "test@example.nl"]]), /e-mailadres/);
  not("a field that is no filter", form([["action", "alm_get_posts"], ["bericht_id", "12"]]), /heet niet als een filter/);
  not("a choice that does something", form([["action", "alm_get_posts"], ["type", "delete"]]), /heeft de waarde "delete"/);
  not("text of a visitor", form([["action", "alm_get_posts"], ["filter", "ik wil graag weten wanneer de container komt"]]), /meer dan 4 woorden/);
  not("a nonce that carries more", form([["action", "alm_get_posts"], ["nonce", "abc def@example.nl"]]), /e-mailadres|geen nonce/);
  not("order with another value than a direction", form([["action", "alm_get_posts"], ["order", "12"]]), /het veld "order" is ingevuld/);
  // Another address: a POST to the page itself or to the REST API of WordPress is not this rule.
  not("the REST API", form([["action", "alm_get_posts"]]), /niet \/wp-admin\/admin-ajax\.php/, "/wp-json/wp/v2/posts");
  not("a look-alike path", form([["action", "alm_get_posts"]]), /niet \/wp-admin\/admin-ajax\.php/, "/wp-admin/admin-ajax.php.bak");
});
