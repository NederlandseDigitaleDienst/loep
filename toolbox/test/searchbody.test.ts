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
