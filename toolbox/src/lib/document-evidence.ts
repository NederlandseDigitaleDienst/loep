import { KIND_NAME_NL, type DocumentFacts } from "./documents.ts";
import type { RunData } from "./rundata.ts";

/**
 * The documents of the sample for one criterion: per document only the facts that bear on
 * that criterion. EN 301 549 chapter 10 applies the WCAG criteria to documents that are no
 * web page. Like every extractor this counts and lists; it judges nothing.
 */

const LIMIT = 40;
const capped = <T>(items: T[]): { total: number; shown: T[]; notShown?: number } => ({ total: items.length, shown: items.slice(0, LIMIT), ...(items.length > LIMIT ? { notShown: items.length - LIMIT } : {}) });

/** Which failed rules of veraPDF bear on a criterion, by the words of the rule. Null: all of them. */
const UA_RULES: Record<string, RegExp | null> = {
  "1.1.1": /alternat|figure|formula|actualtext/i,
  "1.3.1": null,
  "1.3.2": /order|artifact|real content|tagged|structure/i,
  "2.4.2": /title/i,
  "2.4.4": /link/i,
  "2.4.6": /heading|H1|H2|H3|H4|H5|H6/,
  "3.1.1": /language|lang/i,
  "3.1.2": /language|lang/i,
  "4.1.2": /annot|widget|form|field|TU|Contents|link/i,
};

type Part = (facts: DocumentFacts) => Record<string, unknown>;

const pdfUa = (facts: DocumentFacts, criterion: string): Record<string, unknown> => {
  const ua = facts.pdf?.pdfUa;
  if (!ua) return {};
  if (!ua.available) return { pdfUa: { examined: false, reasonNl: ua.reasonNl } };
  const filter = criterion in UA_RULES ? UA_RULES[criterion]! : /$^/;
  const rules = ua.failedRules.filter((rule) => filter === null || filter.test(rule.description));
  return { pdfUa: { examined: true, compliant: ua.compliant, failedRulesInTotal: ua.failedRules.length, failedRulesForThisCriterion: rules.map((rule) => ({ rule: `${rule.clause}-${rule.test}`, times: rule.failedChecks, description: rule.description })) } };
};

const images: Part = (facts) => ({
  images: { total: facts.pdf?.counts.images ?? facts.images.length, withAlternative: facts.images.filter((image) => image.alt).length, decorative: facts.images.filter((image) => image.decorative).length, withoutAlternative: capped(facts.images.filter((image) => !image.alt && !image.decorative).map((image) => ({ page: image.page, context: image.context }))), alternatives: capped(facts.images.filter((image) => image.alt).map((image) => ({ page: image.page, alt: image.alt }))) },
  ...(facts.pdf ? { tagged: facts.pdf.tagged, imageObjectsInContent: facts.pdf.imageObjects, scanPages: facts.pdf.scanPages, ...(facts.pdf.scanNotCheckedNl ? { scanNotCheckedNl: facts.pdf.scanNotCheckedNl } : {}) } : {}),
});

const structure: Part = (facts) => ({
  ...(facts.pdf ? { tagged: facts.pdf.tagged, tags: facts.pdf.tags, tagTextRead: facts.pdf.tagTextRead, lists: facts.pdf.lists } : {}),
  headings: capped(facts.headings),
  tables: { total: facts.tables.length, withoutHeader: facts.tables.filter((table) => !table.hasHeader).length, rows: capped(facts.tables) },
  ...(facts.office ? { paragraphsThatLookLikeAHeading: capped(facts.office.fakeHeadings), lists: facts.office.lists, ...(facts.office.slides ? { slidesWithoutTitle: facts.office.slides.filter((slide) => !slide.title).map((slide) => slide.slide), slides: facts.office.slides.length } : {}), ...(facts.office.sheets ? { sheets: facts.office.sheets } : {}) } : {}),
  fields: { total: facts.fields.length, withoutName: facts.fields.filter((field) => !field.name).length },
});

const order: Part = (facts) => ({
  ...(facts.pdf ? { tagged: facts.pdf.tagged, orderPerPage: capped(facts.pdf.pageText.map((page) => ({ page: page.page, tagsAgainstContent: page.order }))), orderNote: "Per pagina is de tekst in de volgorde van de tags naast de tekst in de volgorde van de inhoud gelegd, op woorden. Dat is een benadering: 'gelijk' zegt niet dat de volgorde logisch is, 'verschilt' zegt niet dat ze fout is. Zonder tags leest hulpsoftware de volgorde van de inhoud." } : {}),
  ...(facts.office?.slides ? { slides: capped(facts.office.slides), orderNote: "Per dia de teksten in de volgorde waarin ze in het bestand staan; dat is de volgorde waarin hulpsoftware ze voorleest." } : {}),
  ...(facts.office && !facts.office.slides && !facts.office.sheets ? { orderNote: "Een tekstdocument leest in de volgorde van het bestand. Tekstvakken en zwevende kaders zijn niet apart gelezen." } : {}),
});

const imagesOfText: Part = (facts) => ({
  ...(facts.pdf ? { scanPages: facts.pdf.scanPages, pagesWithoutText: facts.pdf.pageText.filter((page) => page.characters < 20).map((page) => ({ page: page.page, recognisedWords: page.recognisedWords, scanOnly: page.scanOnly })), ...(facts.pdf.scanNotCheckedNl ? { scanNotCheckedNl: facts.pdf.scanNotCheckedNl } : {}), imageObjectsInContent: facts.pdf.imageObjects } : {}),
  images: capped(facts.images.map((image) => ({ page: image.page, alt: image.alt, context: image.context }))),
  note: "Of een afbeelding tekst bevat, is niet per afbeelding gemeten. Bekijk de pagina's met `document <label> --page n`.",
});

const title: Part = (facts) => ({ title: facts.title, fileName: decodeURIComponent(new URL(facts.url).pathname.split("/").pop() ?? ""), ...(facts.pdf ? { titleShownInTitleBar: facts.pdf.displayDocTitle } : {}), firstHeading: facts.headings[0]?.text ?? facts.office?.slides?.[0]?.title ?? null });

const links: Part = (facts) => ({ links: capped(facts.links), ...(facts.pdf ? { linkAnnotationsOnPages: facts.pdf.linkAnnotations, linksInTags: facts.pdf.counts.links, tagTextRead: facts.pdf.tagTextRead } : {}) });

const headings: Part = (facts) => ({
  headings: capped(facts.headings),
  ...(facts.pdf ? { bookmarks: facts.pdf.bookmarks } : {}),
  ...(facts.office?.slides ? { slideTitles: capped(facts.office.slides.map((slide) => ({ slide: slide.slide, title: slide.title }))) } : {}),
  ...(facts.office?.sheets ? { sheetNames: facts.office.sheets.map((sheet) => sheet.name) } : {}),
  fieldNames: capped(facts.fields.map((field) => ({ page: field.page, type: field.type, name: field.name }))),
});

const language: Part = (facts) => ({ language: facts.language, partsWithOwnLanguage: capped(facts.pdf?.languageParts ?? facts.office?.languageParts ?? []) });

const nameRoleValue: Part = (facts) => ({
  fields: { total: facts.fields.length, withoutName: capped(facts.fields.filter((field) => !field.name)), withName: capped(facts.fields.filter((field) => field.name)) },
  ...(facts.pdf ? { tagged: facts.pdf.tagged, encryption: facts.pdf.encryption, linkAnnotationsOnPages: facts.pdf.linkAnnotations, linksInTags: facts.pdf.counts.links } : {}),
});

const PARTS: Record<string, Part> = { "1.1.1": images, "1.3.1": structure, "1.3.2": order, "1.4.5": imagesOfText, "2.4.2": title, "2.4.4": links, "2.4.6": headings, "3.1.1": language, "3.1.2": language, "4.1.2": nameRoleValue };

export function documents(run: RunData, criterion: string): unknown {
  const all = run.documents ?? [];
  const population = run.sample.documentPopulation;
  const part = PARTS[criterion];
  return {
    documentsInSample: all.length,
    ...(population ? { documentsOnSite: population.onSite, notChosen: population.notChosen, onOtherOrigins: population.elsewhere } : {}),
    read: all.filter((document) => document.facts?.status === "read").map((document) => document.label),
    notRead: all.filter((document) => document.facts?.status !== "read").map((document) => ({ document: document.label, kind: document.item.kind, reasonNl: document.facts?.reasonNl ?? "het document is nog niet gemeten; draai documents" })),
    note:
      "Feiten uit de bestanden zelf, gelezen zonder kantoorpakket en zonder schermlezer. Een document dat niet is ingelezen is een open punt, geen goedkeuring. Een bevinding in een document wijst het document aan met zijn label (page), zegt in where de pagina, de dia of het blad, en neemt in text tekst uit het document over. Bekijk een document zelf met het commando document <label> [--page n] [--tags].",
    documents: all
      .filter((document) => document.facts?.status === "read")
      .map((document) => {
        const facts = document.facts!;
        return {
          document: document.label,
          kind: KIND_NAME_NL[facts.kind],
          title: facts.title,
          pages: facts.pages,
          linkTexts: [...new Set(document.item.linkedFrom.map((link) => link.text))].slice(0, 4),
          ...(part ? part(facts) : {}),
          ...pdfUa(facts, criterion),
          ...(criterion === "3.1.1" || criterion === "3.1.2" ? { textFile: facts.files.text } : {}),
          ...(facts.notMeasuredNl.length > 0 ? { notMeasuredNl: facts.notMeasuredNl } : {}),
          files: { text: facts.files.text, tagTree: facts.files.tagTree, pageImages: facts.files.pageImages },
        };
      }),
  };
}
