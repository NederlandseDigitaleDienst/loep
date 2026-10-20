import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chooseSearchTerm, SEARCH_FALLBACK, SEARCH_NONE, textHasTerm } from "../src/lib/searchterm.ts";
import { searchTermForRun } from "../src/lib/sitemodel.ts";
import { TEST_VALUES, testValuesForRun } from "../src/session/safety.ts";

const page = (title: string, status: number | null = 200): { title: string; status: number | null } => ({ title, status });

test("the search term is the word on most page titles: five letters or more, no stopword, ties to the alphabet", () => {
  assert.equal(chooseSearchTerm([page("Afval en afvalkalender - Gemeente Voorbeeld"), page("Paspoort aanvragen - Gemeente Voorbeeld"), page("Afvalkalender 2026")]), "afvalkalender");
  // A word counts once per page, however often the title repeats it.
  assert.equal(chooseSearchTerm([page("Paspoort paspoort paspoort"), page("Rijbewijs"), page("Rijbewijs verlengen")]), "rijbewijs");
  // Stopwords, short words and numbers are no term; a tie goes to the alphabet, so the same inventory gives the same term.
  assert.equal(chooseSearchTerm([page("Welkom op de homepage over 2026 en meer"), page("Welkom bij zorg en hulp")]), null);
  assert.equal(chooseSearchTerm([page("Zwemmen"), page("Bibliotheek")]), "bibliotheek");
  // A page that did not load says nothing about the site.
  assert.equal(chooseSearchTerm([page("Pagina niet gevonden", 404), page("Pagina niet gevonden", 404), page("Parkeren")]), "parkeren");
  assert.equal(chooseSearchTerm([]), null);
});

test("a page text has the term as a whole word, whatever its case", () => {
  assert.ok(textHasTerm("Over de Afvalkalender van 2026.", "afvalkalender"));
  assert.ok(!textHasTerm("De afvalkalenders staan hier.", "afvalkalender"));
  assert.ok(!textHasTerm("Niets hierover.", "afvalkalender"));
});

test("a run searches with the explorer's term, else with the inventory's, else with test; search-none finds nothing", () => {
  const run = mkdtempSync(join(tmpdir(), "loep-searchterm-"));
  try {
    // An old run without a term, or without any file: the fixed term from before.
    assert.equal(searchTermForRun(run), SEARCH_FALLBACK);
    writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://site.nl/", pages: [] }));
    assert.equal(searchTermForRun(run), "test");
    writeFileSync(join(run, "inventory.json"), JSON.stringify({ baseUrl: "https://site.nl/", pages: [], searchTerm: "afvalkalender" }));
    assert.equal(searchTermForRun(run), "afvalkalender");
    // The explorer's word, when it has the form of one; a sentence or the term that finds nothing is not used.
    writeFileSync(join(run, "site.json"), JSON.stringify({ searchTerm: { term: "paspoort", page: "https://site.nl/" } }));
    assert.equal(searchTermForRun(run), "paspoort");
    writeFileSync(join(run, "site.json"), JSON.stringify({ searchTerm: { term: "twee woorden", page: "https://site.nl/" } }));
    assert.equal(searchTermForRun(run), "afvalkalender");
    writeFileSync(join(run, "site.json"), JSON.stringify({ searchTerm: { term: SEARCH_NONE, page: "https://site.nl/" } }));
    assert.equal(searchTermForRun(run), "afvalkalender");
    // A session types the term of its run; the other values stay the fixed ones.
    const values = testValuesForRun(run);
    assert.deepEqual([values.search, values["search-none"], values.text], ["afvalkalender", "loepqzx", TEST_VALUES.text]);
    assert.equal(TEST_VALUES.search, "test");
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});
