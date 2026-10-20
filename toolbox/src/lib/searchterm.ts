/**
 * The search term of a run. A term that finds nothing leaves the list of results, the message
 * about their number and the focus after searching unjudged, so loep picks a word the site uses
 * itself: still a fixed value, never one an agent makes up.
 */

/** The term of a run that has none: older runs, and a site whose titles offer no word. */
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

/**
 * The word on most pages of the inventory, counted in the titles of the pages that loaded: one
 * count per page, at least five letters, no stopword. Ties go to the alphabet, so the same
 * inventory gives the same term. Null when no title offers such a word.
 */
export function chooseSearchTerm(pages: { title: string; status: number | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const page of pages) {
    if (page.status !== null && (page.status < 200 || page.status >= 300)) continue;
    const words = new Set((page.title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => [...word].length >= SEARCH_MIN_LETTERS && !/^\p{N}+$/u.test(word) && !STOPWORDS.has(word) && SEARCH_TERM_FORM.test(word)));
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? null;
}

/** Whether a page text contains the term as a whole word, ignoring case. */
export function textHasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}
