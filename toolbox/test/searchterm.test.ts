import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Browser } from "playwright";
import { startFixture } from "../fixtures/serve.ts";
import { inventory } from "../src/commands/inventory.ts";
import { rankSearchTerms, SEARCH_ALTERNATIVES, SEARCH_FALLBACK, SEARCH_NONE, textHasTerm, type SearchTermPage } from "../src/lib/searchterm.ts";
import { searchTermForRun } from "../src/lib/sitemodel.ts";
import { TEST_VALUES, testValuesForRun } from "../src/session/safety.ts";

const page = (text: string, status: number | null = 200): SearchTermPage => ({ text, status });

test("the search term has the highest tf-idf: a word on every page scores zero, a word that some pages use often scores high", () => {
  const site = [
    page("Afval - Gemeente Voorbeeld. Restafval en papier: de afvalkalender zegt wanneer. Afvalkalender per wijk."),
    page("Openingstijden - Gemeente Voorbeeld. De afvalkalender en de milieustraat."),
    page("Paspoort aanvragen - Gemeente Voorbeeld. Een paspoort vraagt u aan op afspraak."),
    page("Rijbewijs - Gemeente Voorbeeld. Neem uw paspoort mee."),
  ];
  // "gemeente" and "voorbeeld" stand on every page; "afvalkalender" stands three times on two of four pages, "paspoort" three times on two.
  const ranked = rankSearchTerms(site);
  assert.ok(!ranked.includes("gemeente") && !ranked.includes("voorbeeld"), ranked.join());
  assert.deepEqual(ranked.slice(0, 2), ["afvalkalender", "paspoort"]);
  // A word on one page only finds one result at most: never a term.
  assert.ok(!ranked.includes("rijbewijs") && !ranked.includes("milieustraat"));
  // The count weighs, not the share of the page: the two words of a short login page do not beat a word that two articles use often.
  const filler = (prefix: string): string => Array.from({ length: 20 }, (_, index) => `${prefix}${String.fromCharCode(97 + index)}`).join(" ");
  const articles = [page("Inloggen wachtwoord"), page("Inloggen wachtwoord"), page(`Station station station ${filler("fietsa")}`), page(`Station station ${filler("treinb")}`), page("Overig")];
  assert.equal(rankSearchTerms(articles)[0], "station");
  // Fewer pages with the word give a higher idf at the same count.
  assert.equal(rankSearchTerms([page("Fietsen wandelen"), page("Fietsen wandelen"), page("Fietsen"), page("Overig")])[0], "wandelen");
});

test("words from the host, stopwords, short words and numbers are no term; pages that did not load do not count; ties go to the alphabet", () => {
  assert.deepEqual(rankSearchTerms([page("Voorbeeldstad parkeren"), page("Voorbeeldstad parkeren"), page("Overig")], ["www.voorbeeldstad.nl"]), ["parkeren"]);
  assert.deepEqual(rankSearchTerms([page("Welkom over 2026 en 12345 meer"), page("Welkom over 2026 en 12345 meer"), page("Overig")]), []);
  assert.deepEqual(rankSearchTerms([page("Pagina niet gevonden zoeken", 404), page("Pagina niet gevonden zoeken", 404), page("Parkeren zwemmen"), page("Parkeren zwemmen"), page("Overig")]), ["parkeren", "zwemmen"]);
  assert.deepEqual(rankSearchTerms([]), []);
  // The term and at most three alternatives.
  const many = rankSearchTerms([page("aaaaa bbbbb ccccc ddddd eeeee"), page("aaaaa bbbbb ccccc ddddd eeeee"), page("Overig")]);
  assert.deepEqual(many, ["aaaaa", "bbbbb", "ccccc", "ddddd"]);
  assert.equal(many.length, 1 + SEARCH_ALTERNATIVES);
});

test("on both test sites the inventory chooses a word the search page finds, not the name of the site", { timeout: 600_000 }, async (context) => {
  const scratch = mkdtempSync(join(tmpdir(), "loep-searchterm-sites-"));
  const fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(scratch, "server.log") });
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch().catch(() => null);
    if (!browser) return context.skip("no browser available");
    for (const site of ["defect", "clean"] as const) {
      const origin = fixture.origins[site];
      const found = await inventory({ baseUrl: `${origin}/`, out: join(scratch, site), maxPages: 50 });
      const terms = [found.searchTerm!, ...(found.searchTermAlternatives ?? [])];
      assert.ok(found.searchTerm, `${site}: a term`);
      assert.ok(terms.length > 1, `${site}: alternatives`);
      for (const term of terms) assert.ok(!["berkenveen", "lindewaard", "gemeente"].includes(term), `${site}: ${terms.join()}`);
      const tab = await browser.newPage();
      await tab.goto(`${origin}/zoeken.html?q=${encodeURIComponent(found.searchTerm!)}`);
      const said = (await tab.locator(".zoek-aantal").textContent()) ?? "";
      assert.match(said, /^[1-9]\d* resulta(at|ten) voor/, `${site}: "${found.searchTerm}" finds something: ${said}`);
      await tab.close();
    }
  } finally {
    await browser?.close();
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
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
