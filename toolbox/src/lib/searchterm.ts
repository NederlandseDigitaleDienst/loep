/**
 * The search term of a run. A term that finds nothing leaves the list of results, the message
 * about their number and the focus after searching unjudged, so loep picks a word the site uses
 * itself: still a fixed value, never one an agent makes up.
 */

/** The term of a run that has none: older runs, and a site whose pages offer no word. */
export const SEARCH_FALLBACK = "test";
/** A term no site contains, to see what a site shows when nothing is found. */
export const SEARCH_NONE = "loepqzx";
/** The shortest word that counts: shorter ones are mostly function words and abbreviations. */
export const SEARCH_MIN_LETTERS = 5;
/** A term is one word of letters and digits, so whatever reaches a page stays a search term. */
export const SEARCH_TERM_FORM = /^[\p{L}\p{N}]{3,40}$/u;

/** Words of at least five letters that say nothing about a site, in Dutch and English. */
const STOPWORDS = new Set([
  // Dutch
  "alleen", "andere", "anders", "boven", "daarom", "doordat", "eerste", "elkaar", "hebben", "heeft", "hierbij", "hoeveel", "kunnen", "maken", "omdat", "onder", "pagina", "staat", "tegen", "terug", "tussen", "vanaf", "vanuit", "volgende", "waarom", "welke", "welkom", "wordt", "worden", "zonder", "zullen",
  // English
  "about", "above", "after", "again", "being", "below", "between", "could", "every", "first", "homepage", "other", "their", "there", "these", "those", "through", "under", "until", "website", "welcome", "where", "which", "while", "would", "should",
]);

/** How many words the inventory offers besides the term, for the explorer to try when the term finds nothing. */
export const SEARCH_ALTERNATIVES = 3;

/** The text of a page the term is chosen from: its title and main text. */
export interface SearchTermPage {
  text: string;
  status: number | null;
}

/**
 * The words of the inventory ranked as search terms, best first: the term and its alternatives.
 * The score is tf-idf summed over the pages: how often the word occurs on all pages together,
 * times the log of the number of pages over the number of pages with the word. A word on every
 * page, such as the name of the site or fixed navigation, then scores zero and is never chosen,
 * while a word that a part of the pages uses often scores high: that is what a search function
 * finds a list of results for. The term frequency is a count, not a share of the page: with a
 * share, the few words of a short page such as a login form weigh as much as a whole article,
 * and its labels win. A word must stand on at least two pages, else a search finds one result at
 * most. Words count from five letters, without digits, stopwords or words of the host names; pages
 * that did not load say nothing about the site. Ties go to the alphabet, so the same inventory
 * gives the same term.
 */
export function rankSearchTerms(pages: SearchTermPage[], hosts: readonly string[] = []): string[] {
  const fromHost = new Set(hosts.flatMap((host) => host.toLowerCase().match(/\p{L}+/gu) ?? []));
  const loaded = pages.filter((page) => page.status === null || (page.status >= 200 && page.status < 300));
  const occurrences = new Map<string, number>();
  const pagesWith = new Map<string, number>();
  for (const page of loaded) {
    const words = (page.text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => [...word].length >= SEARCH_MIN_LETTERS && !STOPWORDS.has(word) && !fromHost.has(word) && SEARCH_TERM_FORM.test(word));
    for (const word of words) occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
    for (const word of new Set(words)) pagesWith.set(word, (pagesWith.get(word) ?? 0) + 1);
  }
  return [...pagesWith]
    .filter(([, df]) => df >= 2 && df < loaded.length)
    .map(([word, df]): [string, number] => [word, occurrences.get(word)! * Math.log(loaded.length / df)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 1 + SEARCH_ALTERNATIVES)
    .map(([word]) => word);
}

/** Whether a page text contains the term as a whole word, ignoring case. */
export function textHasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}
