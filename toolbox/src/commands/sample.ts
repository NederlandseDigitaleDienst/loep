import { join } from "node:path";
import { readJson, sha256, stableId, writeJson } from "../lib/canonical.ts";
import { countByKind, DOCUMENT_KINDS, documentLabels, kindsNl, READ_KINDS, siteDocuments, type DocumentKind, type InventoryDocument, type SampleDocument } from "../lib/documents.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { notFoundProbes, siteOrigins } from "../lib/origins.ts";
import { frameAddress, frameEntry, frameStanding, loadSiteModel, type SiteModel } from "../lib/sitemodel.ts";
import type { Inventory, InventoryPage } from "./inventory.ts";

export type SampleKind = "structured" | "random" | "embedded";

export interface SampleItem {
  id: string;
  url: string;
  slug: string;
  kind: SampleKind;
  /** Why this page is in the sample, in Dutch: it is printed in the report. */
  reason: string;
  templateHash: string;
  contentHash: string;
  title: string;
  status: number | null;
  /** Other URLs that serve byte-identical content; evaluated once, through this item. */
  aliases: string[];
  /** For an embedded window: the pages it stands on. The sweep measures it on the first. Absent in samples from before windows were measured in place. */
  embeddedOn?: string[];
}

/** One page type of the site model in the sample: how many pages it has, how many are examined and why those. */
export interface SamplePageType {
  id: string;
  descriptionNl: string;
  /** Unique pages of this type in the inventory. */
  pages: number;
  /** Pages of this type in the sample. */
  examined: number;
  /** Why these pages, in Dutch: it is printed in the report. */
  reasonNl: string;
}

export interface Sample {
  method: "census" | "structured-plus-random" | "fixed-list";
  seed: string;
  populationSize: number;
  note: string;
  items: SampleItem[];
  /** Only with a site model: the embedded frames that the model says do not count, and are therefore no page of the sample. `kindNl` and `reasonNl` are absent in older runs. */
  excludedFrames?: { address: string; descriptionNl: string; copies: number; kindNl?: string; reasonNl?: string }[];
  /** Documents of the site that are examined, each with its own label ("D01"). Absent when the site has none, and in older runs. */
  documents?: SampleDocument[];
  /** How many documents the inventory found on the site, and how many on other origins (counted only). */
  documentPopulation?: { onSite: number; byKind: Partial<Record<DocumentKind, number>>; elsewhere: number; notChosen: number; notChosenByKind: Partial<Record<DocumentKind, number>> };
  /** Only with a site model and a drawn sample: per page type how many pages there are and how many are examined. Absent in older runs. */
  pageTypes?: SamplePageType[];
}

/** Below this size every page is evaluated and no sampling error is introduced. */
export const CENSUS_LIMIT = 60;
const RANDOM_SHARE = 0.1;

/**
 * A page type of the site model gets one extra page per this many of its pages, and at most
 * MAX_EXTRA_PER_TYPE: the size of the sample grows with the size of the type (WCAG-EM 2.0 §6.3),
 * and the extra pages are chosen on variation in content instead of at random (§6.3.1).
 * docs/methode.md says why these numbers.
 */
export const PAGES_PER_EXTRA = 40;
export const MAX_EXTRA_PER_TYPE = 5;

/** How many pages a page type gets on top of the page that stands for it. */
export const extraPagesFor = (pagesOfType: number): number => Math.min(MAX_EXTRA_PER_TYPE, Math.floor(pagesOfType / PAGES_PER_EXTRA));

/** The kinds of content the inventory counts per page, in the order a reason names them. */
const CONTENT_KINDS: { key: string; labelNl: string }[] = [
  { key: "images", labelNl: "afbeeldingen" },
  { key: "tables", labelNl: "tabel" },
  { key: "forms", labelNl: "formulier" },
  { key: "video", labelNl: "video" },
  { key: "audio", labelNl: "geluid" },
  { key: "iframe", labelNl: "ingesloten venster" },
  { key: "headings", labelNl: "koppen" },
  { key: "lists", labelNl: "lijsten" },
  { key: "words", labelNl: "lange tekst" },
];

const countOf = (page: InventoryPage, key: string): number | undefined => {
  const value = key === "words" ? page.words : page.counts[key];
  return typeof value === "number" ? value : undefined;
};

/**
 * The kinds of content each page of one type has more of than the usual page of that type:
 * above the median and in the upper quarter. A table on one page in ten is a kind of its own;
 * a search form in the header of every page is not. An older inventory without a count adds nothing for it.
 */
export function contentKindsOfType(pages: InventoryPage[]): Map<string, string[]> {
  const thresholds = CONTENT_KINDS.flatMap(({ key, labelNl }) => {
    const values = pages.map((page) => countOf(page, key)).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
    if (values.length === 0) return [];
    return [{ key, labelNl, median: values[Math.floor((values.length - 1) / 2)]!, upperQuarter: values[Math.floor((values.length - 1) * 0.75)]! }];
  });
  return new Map(
    pages.map((page) => [
      page.url,
      thresholds
        .filter(({ key, median, upperQuarter }) => {
          const value = countOf(page, key);
          return value !== undefined && value > median && value >= upperQuarter;
        })
        .map(({ labelNl }) => labelNl),
    ]),
  );
}

/**
 * Greedy choice on variation: each time the page that adds the most kinds of content not yet covered,
 * and on a tie the first in the order of the seed. When no page adds anything new, the seed decides.
 */
export function chooseOnVariation<T extends { url: string; kinds: string[] }>(candidates: T[], covered: Iterable<string>, count: number, seed: string): { candidate: T; added: string[] }[] {
  const seen = new Set(covered);
  const left = seededOrder(candidates, seed);
  const picks: { candidate: T; added: string[] }[] = [];
  while (picks.length < count && left.length > 0) {
    let best = 0;
    let bestAdded: string[] = [];
    for (const [index, candidate] of left.entries()) {
      const added = candidate.kinds.filter((kind) => !seen.has(kind));
      if (added.length > bestAdded.length) [best, bestAdded] = [index, added];
    }
    const [candidate] = left.splice(best, 1);
    for (const kind of bestAdded) seen.add(kind);
    picks.push({ candidate: candidate!, added: bestAdded });
  }
  return picks;
}

const VARIATION_REASON = "gekozen op variatie: ";
const SEED_EXTRA_REASON = "extra pagina van dit paginatype";

/**
 * Whether a page with these addresses (its own first) counts for a type: by its own address, or,
 * when that is in no type, by the first alias that is in one. `buildSample` decides the same way.
 */
function countsFor(addresses: string[], members: Set<string>, typed: Set<string>): boolean {
  const [own, ...aliases] = addresses;
  if (typed.has(own!)) return members.has(own!);
  const alias = aliases.filter((address) => typed.has(address)).sort((a, b) => a.localeCompare(b))[0];
  return alias !== undefined && members.has(alias);
}

/** Per page type of the model: how many pages, how many in the sample, and why those. */
function pageTypeSummary(model: SiteModel, pages: InventoryPage[], items: SampleItem[]): SamplePageType[] {
  const unique = deduplicate(pages);
  const typed = new Set(model.pageTypes.flatMap((type) => type.pages));
  return model.pageTypes.map((type) => {
    const members = new Set(type.pages);
    const ofType = items.filter((item) => countsFor([item.url, ...item.aliases], members, typed));
    const isRepresentative = (item: SampleItem): boolean => item.url === type.representative || item.aliases.includes(type.representative);
    const extra = (prefix: string): number => ofType.filter((item) => item.reason.startsWith(prefix)).length;
    const variation = extra(VARIATION_REASON);
    const bySeed = extra(SEED_EXTRA_REASON);
    const random = ofType.filter((item) => item.kind === "random").length;
    const other = ofType.filter((item) => !isRepresentative(item) && item.kind !== "random" && !item.reason.startsWith(VARIATION_REASON) && !item.reason.startsWith(SEED_EXTRA_REASON));
    const parts = [
      ...(ofType.some(isRepresentative) ? ["de voorbeeldpagina van de verkenner"] : []),
      ...other.map((item) => item.reason),
      ...(variation > 0 ? [`${variation} gekozen op variatie in inhoud`] : []),
      ...(bySeed > 0 ? [`${bySeed} extra gekozen met de seed, omdat geen pagina nog een soort inhoud toevoegde`] : []),
      ...(random > 0 ? [`${random} willekeurig gekozen`] : []),
    ];
    const reasonNl = parts.length === 0 ? "geen pagina in de steekproef" : parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} en ${parts.at(-1)}`;
    return { id: type.id, descriptionNl: type.descriptionNl, pages: unique.filter((entry) => countsFor([entry.page.url, ...entry.aliases], members, typed)).length, examined: ofType.length, reasonNl };
  });
}

/** Pages that WCAG-EM asks for by name, recognised by the path of any of their addresses. */
const COMMON_PAGES: [RegExp, string][] = [
  [/^\/?$/, "startpagina"],
  [/contact/i, "contactpagina"],
  [/toegankelijkheid/i, "toegankelijkheidsverklaring"],
  [/zoek|search/i, "zoekpagina"],
  [/privacy|cookie/i, "juridische pagina"],
  [/sitemap/i, "sitemap"],
  [/\bhelp\b|veelgestelde|faq/i, "hulppagina"],
];

/** Deterministic order derived from the seed: the same seed always selects the same pages. */
export function seededOrder<T extends { url: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => sha256(`${seed}\u0000${a.url}`).localeCompare(sha256(`${seed}\u0000${b.url}`)));
}

/** Where the browser landed, or null when it stayed on the address or `finalUrl` is no address (a hand-edited inventory). */
const landingOf = (page: InventoryPage): URL | null => {
  if (page.finalUrl === undefined) return null;
  try {
    return new URL(page.finalUrl);
  } catch {
    return null;
  }
};

/**
 * Pages with the same content are one item. Its address is one the browser stays on, and of those
 * first one that another address of the group leads to: every measurement loads it, and an address
 * that redirects, to an anchor say, would start the sweep elsewhere or halfway down the page.
 * A page of an older inventory has no `finalUrl` and counts as staying on its address, so such a
 * group keeps its first address in the alphabet, as before.
 */
function deduplicate(pages: InventoryPage[]): { page: InventoryPage; aliases: string[] }[] {
  const byContent = new Map<string, InventoryPage[]>();
  for (const page of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    byContent.set(page.contentHash, [...(byContent.get(page.contentHash) ?? []), page]);
  }
  return [...byContent.values()].map((group) => {
    const landings = new Set(
      group.flatMap((page) => {
        const landed = landingOf(page);
        if (landed === null) return [];
        landed.hash = "";
        return [landed.href];
      }),
    );
    // Lower is better: stays and another address leads here, stays, redirects, redirects to an anchor.
    const rank = (page: InventoryPage): number => {
      const landed = landingOf(page);
      if (landed === null) return landings.has(page.url) ? 0 : 1;
      return landed.hash === "" ? 2 : 3;
    };
    const main = group.reduce((best, page) => (rank(page) < rank(best) ? page : best));
    return { page: main, aliases: group.filter((page) => page !== main).map((page) => page.url) };
  });
}

/** For every address of these pages the address the sample measures that page at: its own, or the one of its group. */
export function mainAddresses(pages: InventoryPage[]): Map<string, string> {
  return new Map(deduplicate(pages).flatMap((entry) => [entry.page.url, ...entry.aliases].map((address) => [address, entry.page.url] as const)));
}

const isFrame = (page: InventoryPage): boolean => page.foundVia.length > 0 && page.foundVia.every((via) => via.startsWith("iframe:"));

/**
 * What the site model says about frames: a frame that does not count (content the organisation
 * has no say over, a map with its essentials on the page as text, machinery that shows nothing)
 * is no page, and a frame that is embedded several times with a different query is one frame.
 */
export function applyFrameClasses(pages: InventoryPage[], model: SiteModel): { pages: InventoryPage[]; repeats: Map<string, string[]>; excluded: NonNullable<Sample["excludedFrames"]> } {
  const kept: InventoryPage[] = [];
  const firstByAddress = new Map<string, InventoryPage>();
  const repeats = new Map<string, string[]>();
  const excluded = new Map<string, NonNullable<Sample["excludedFrames"]>[number]>();
  for (const page of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    const entry = isFrame(page) ? frameEntry(model, page.url) : null;
    if (!entry) {
      kept.push(page);
      continue;
    }
    const standing = frameStanding(entry);
    if (!standing.counts) {
      const known = excluded.get(entry.address) ?? { address: entry.address, descriptionNl: entry.descriptionNl, copies: 0, kindNl: standing.labelNl, ...(entry.reasonNl ? { reasonNl: entry.reasonNl } : {}) };
      known.copies++;
      excluded.set(entry.address, known);
      continue;
    }
    const first = firstByAddress.get(frameAddress(page.url));
    if (first) repeats.set(first.url, [...(repeats.get(first.url) ?? []), page.url]);
    else {
      firstByAddress.set(frameAddress(page.url), page);
      kept.push(page);
    }
  }
  return { pages: kept, repeats, excluded: [...excluded.values()] };
}

export function buildSample(inventory: Inventory, seed: string, model: SiteModel | null = null, typeOf: Map<string, string> = new Map(), representatives: Map<string, string> = new Map()): Sample {
  if (model) {
    const framed = applyFrameClasses(inventory.pages, model);
    // Every page type of the model gets a page of its own, also when it shares a template with another type.
    const types = new Map(model.pageTypes.flatMap((type) => type.pages.map((url) => [url, type.id] as const)));
    const sample = buildSample({ ...inventory, pages: framed.pages }, seed, null, types, new Map(model.pageTypes.map((type) => [type.id, type.representative] as const)));
    for (const item of sample.items) item.aliases = [...item.aliases, ...(framed.repeats.get(item.url) ?? [])].sort();
    const copies = framed.excluded.reduce((sum, frame) => sum + frame.copies, 0);
    const note = copies > 0 ? ` ${copies} ingesloten ${copies === 1 ? "venster telt" : "vensters tellen"} volgens het sitemodel niet mee als pagina (${framed.excluded.map((frame) => `${frame.descriptionNl}: ${frame.kindNl}`).join("; ")}).` : "";
    // A census and a fixed list look at what they look at; only a drawn sample says per type what it took.
    const perType = sample.method === "structured-plus-random" ? { pageTypes: pageTypeSummary(model, framed.pages, sample.items) } : {};
    return { ...sample, note: `${sample.note}${note}`, excludedFrames: framed.excluded, ...perType };
  }
  const unique = deduplicate(inventory.pages);
  // The site model and the probes may name an address that is now an alias: they count for the item it belongs to.
  const mainOf = new Map(unique.flatMap((entry) => [entry.page.url, ...entry.aliases].map((address) => [address, entry.page.url] as const)));
  const toMain = (address: string): string => mainOf.get(address) ?? address;
  const typeOfEntry = (entry: { page: InventoryPage; aliases: string[] }): string | undefined => typeOf.get(entry.page.url) ?? entry.aliases.map((address) => typeOf.get(address)).find((type) => type !== undefined);
  // The page for a missing address on every origin of the site, and the origins themselves.
  const probes = new Set(notFoundProbes(inventory).map(toMain));
  const origins = siteOrigins(inventory);
  const toItem =(entry: { page: InventoryPage; aliases: string[] }, kind: SampleKind, reason: string): SampleItem => {
    const frameOf = entry.page.foundVia.filter((via) => via.startsWith("iframe:")).map((via) => via.slice("iframe:".length));
    const embedded = frameOf.length > 0 && frameOf.length === entry.page.foundVia.length;
    return embedded ? { ...build(entry, "embedded", `ingesloten venster op ${frameOf.join(", ")}`), embeddedOn: frameOf } : build(entry, kind, reason);
  };
  const build = (entry: { page: InventoryPage; aliases: string[] }, kind: SampleKind, reason: string): SampleItem => ({
    id: stableId("s", entry.page.url),
    url: entry.page.url,
    slug: entry.page.slug,
    kind,
    reason,
    templateHash: entry.page.templateHash,
    contentHash: entry.page.contentHash,
    title: entry.page.title,
    status: entry.page.status,
    aliases: entry.aliases,
  });

  if (inventory.pages.some((page) => page.foundVia.includes("fixed-list"))) {
    return {
      method: "fixed-list",
      seed,
      populationSize: unique.length,
      note: `De ${unique.length} pagina's zijn vooraf opgegeven. De rest van de site is niet bekeken, dus tellingen gelden alleen voor deze pagina's.`,
      items: unique.map((entry) => toItem(entry, "structured", "vooraf opgegeven pagina")),
    };
  }

  if (unique.length <= CENSUS_LIMIT) {
    return {
      method: "census",
      seed,
      populationSize: unique.length,
      note: `De site telt ${unique.length} unieke pagina's. Ze zijn allemaal onderzocht, dus er is geen steekproeffout.`,
      items: unique.map((entry) =>
        toItem(entry, "structured", probes.has(entry.page.url) ? "foutpagina (404)" : "volledige site onderzocht"),
      ),
    };
  }

  const chosen = new Map<string, SampleItem>();
  const seenTemplates = new Set<string>();
  const seenTypes = new Set<string>();
  // The page the explorer chose to stand for its type comes first, so that type is represented by that page.
  const first = new Set([...representatives.values()].map(toMain));
  const ordered = [...unique.filter((entry) => first.has(entry.page.url)), ...unique.filter((entry) => !first.has(entry.page.url))];
  // WCAG-EM asks for the start page, the contact page and the like once each, not for every page whose path holds the word:
  // per kind the page highest up in the site, so /toegankelijkheid and not a tag page or a blog post that names it.
  const depth = (url: string): number => new URL(url).pathname.split("/").filter(Boolean).length;
  const higher = (a: string, b: string): number => depth(a) - depth(b) || a.length - b.length || a.localeCompare(b);
  // On a site with more than one origin each origin keeps its own: the documentation on a subdomain has a start page of its own.
  const commonOf = new Map<string, string>();
  for (const group of origins.length > 1 ? origins : [null]) {
    for (const [pattern, label] of COMMON_PAGES) {
      // An alias counts too: /contact that redirects to /klantenservice is still the contact page.
      const candidates = unique.flatMap((entry) => {
        if (probes.has(entry.page.url) || entry.page.foundVia.every((via) => via.startsWith("iframe:")) || commonOf.has(entry.page.url)) return [];
        const matching = [entry.page.url, ...entry.aliases].filter((address) => {
          const url = new URL(address);
          return (group === null || url.origin === group) && pattern.test(url.pathname === "/" ? "" : url.pathname);
        });
        return matching.length > 0 ? [{ entry, address: matching.sort(higher)[0]! }] : [];
      });
      const best = candidates.sort((a, b) => higher(a.address, b.address))[0];
      if (best) commonOf.set(best.entry.page.url, group === null || group === origins[0] ? label : `${label} van ${new URL(group).hostname}`);
    }
  }
  for (const entry of ordered) {
    const type = typeOfEntry(entry);
    const common = commonOf.get(entry.page.url);
    const isFrame = entry.page.foundVia.every((via) => via.startsWith("iframe:"));
    if (isFrame) chosen.set(entry.page.url, toItem(entry, "embedded", "ingesloten venster"));
    else if (probes.has(entry.page.url)) chosen.set(entry.page.url, toItem(entry, "structured", "foutpagina (404)"));
    else if (common) chosen.set(entry.page.url, toItem(entry, "structured", common));
    // With a site model the page types say what is the same: a template hash that differs per page does not add one.
    else if (type !== undefined ? !seenTypes.has(type) : !seenTemplates.has(entry.page.templateHash)) chosen.set(entry.page.url, toItem(entry, "structured", "eerste pagina van dit paginatype"));
    seenTemplates.add(entry.page.templateHash);
    if (type !== undefined && chosen.has(entry.page.url)) seenTypes.add(type);
  }
  // A large page type gets extra pages, chosen on what their content adds to the pages of that type already in the sample.
  let extras = 0;
  const byType = new Map<string, typeof unique>();
  for (const entry of unique) {
    const type = typeOfEntry(entry);
    if (type !== undefined) byType.set(type, [...(byType.get(type) ?? []), entry]);
  }
  for (const members of byType.values()) {
    const wanted = extraPagesFor(members.length);
    if (wanted === 0) continue;
    const kindsOf = contentKindsOfType(members.map((entry) => entry.page));
    const covered = members.filter((entry) => chosen.has(entry.page.url)).flatMap((entry) => kindsOf.get(entry.page.url) ?? []);
    const pool = members
      .filter((entry) => !chosen.has(entry.page.url) && !probes.has(entry.page.url) && !entry.page.foundVia.every((via) => via.startsWith("iframe:")))
      .map((entry) => ({ ...entry, url: entry.page.url, kinds: kindsOf.get(entry.page.url) ?? [] }));
    for (const { candidate, added } of chooseOnVariation(pool, covered, wanted, seed)) {
      const reason = added.length > 0 ? `${VARIATION_REASON}${added.join(", ")}` : `${SEED_EXTRA_REASON}, gekozen met seed ${seed}: geen pagina voegt nog een soort inhoud toe`;
      chosen.set(candidate.url, toItem(candidate, "structured", reason));
      extras++;
    }
  }
  const structuredCount = chosen.size;
  const randomCount = Math.max(1, Math.ceil(structuredCount * RANDOM_SHARE));
  const remaining = seededOrder(unique.filter((entry) => !chosen.has(entry.page.url)).map((entry) => ({ ...entry, url: entry.page.url })), seed);
  for (const entry of remaining.slice(0, randomCount)) chosen.set(entry.page.url, toItem(entry, "random", `willekeurig gekozen met seed ${seed}`));

  return {
    method: "structured-plus-random",
    seed,
    populationSize: unique.length,
    note: `Uit ${unique.length} unieke pagina's zijn ${structuredCount} pagina's gericht gekozen (elk paginatype en de vaste pagina's${extras > 0 ? `, en ${extras} extra ${extras === 1 ? "pagina" : "pagina's"} van grote paginatypen, gekozen op variatie in inhoud: één per ${PAGES_PER_EXTRA} pagina's van het type, hooguit ${MAX_EXTRA_PER_TYPE}` : ""}) en ${randomCount} willekeurig, volgens WCAG-EM stap 3.`,
    items: [...chosen.values()].sort((a, b) => a.url.localeCompare(b.url)),
  };
}

/** Up to this many documents all are examined. */
export const DOCUMENT_CENSUS_LIMIT = 20;
/** Of each kind this many are chosen on purpose: the one most pages link to, and the newest. */
const STRUCTURED_PER_KIND = 2;

/** "het pdf-bestand", "het tekstbestand": a file of one kind in the reason for choosing it. */
const fileOfKindNl = (kind: DocumentKind): string => (kind === "text" ? "tekstbestand" : kind === "other" ? "bestand van een andere soort" : `${kind}-bestand`);

/**
 * Which documents are examined. Few: all of them. Many: per kind the document most pages
 * link to and the newest one, filled up to the limit with a random choice by the seed.
 */
export function chooseDocuments(found: InventoryDocument[], seed: string): SampleDocument[] {
  const sorted = [...found].sort((a, b) => a.url.localeCompare(b.url));
  const chosen = new Map<string, { document: InventoryDocument; reason: string }>();
  if (sorted.length <= DOCUMENT_CENSUS_LIMIT) for (const document of sorted) chosen.set(document.url, { document, reason: "alle documenten onderzocht" });
  else {
    const pages = (document: InventoryDocument): number => new Set(document.linkedFrom.map((link) => link.page)).size;
    for (const kind of DOCUMENT_KINDS) {
      const ofKind = sorted.filter((document) => document.kind === kind);
      const mostLinked = [...ofKind].sort((a, b) => pages(b) - pages(a) || a.url.localeCompare(b.url))[0];
      const newest = [...ofKind].filter((document) => document.lastModified).sort((a, b) => b.lastModified!.localeCompare(a.lastModified!) || a.url.localeCompare(b.url))[0];
      if (mostLinked) chosen.set(mostLinked.url, { document: mostLinked, reason: `gericht gekozen: het ${fileOfKindNl(kind)} waar de meeste pagina's naar linken` });
      if (newest && !chosen.has(newest.url) && [...chosen.values()].filter((entry) => entry.document.kind === kind).length < STRUCTURED_PER_KIND) chosen.set(newest.url, { document: newest, reason: `gericht gekozen: het nieuwste ${fileOfKindNl(kind)}` });
    }
    // The random part is taken from the kinds that are read: a file that cannot be opened teaches nothing more than its kind.
    const rest = seededOrder(sorted.filter((document) => !chosen.has(document.url) && READ_KINDS.includes(document.kind)), seed);
    for (const document of rest.slice(0, Math.max(0, DOCUMENT_CENSUS_LIMIT - chosen.size))) chosen.set(document.url, { document, reason: `willekeurig gekozen met seed ${seed}` });
  }
  const items = [...chosen.values()].sort((a, b) => a.document.url.localeCompare(b.document.url));
  const labels = documentLabels(items.length);
  return items.map(({ document, reason }, index) => ({ label: labels[index]!, url: document.url, kind: document.kind, slug: document.slug, reason, linkedFrom: document.linkedFrom, bytes: document.bytes, lastModified: document.lastModified }));
}

/**
 * Add the documents to a sample of pages. A site without documents keeps the sample it had, to the letter.
 * Only documents on the site are chosen: one that an older inventory listed although its address redirects to another host counts as elsewhere.
 */
export function withDocuments(sample: Sample, inventory: Inventory, seed: string): Sample {
  const { onSite: found, elsewhere } = siteDocuments(inventory);
  if (found.length === 0) return sample;
  const documents = chooseDocuments(found, seed);
  const notChosen = found.filter((document) => !documents.some((entry) => entry.url === document.url));
  const all = documents.length === found.length;
  const note =
    ` Op de site staan ${found.length} ${found.length === 1 ? "document" : "documenten"} (${kindsNl(countByKind(found))}). ` +
    (all ? `${found.length === 1 ? "Het is" : "Ze zijn allemaal"} in de steekproef opgenomen.` : `Daarvan zijn er ${documents.length} in de steekproef opgenomen: per soort het bestand waar de meeste pagina's naar linken en het nieuwste, en de rest willekeurig. ${notChosen.length} ${notChosen.length === 1 ? "document is" : "documenten zijn"} niet gekozen en niet onderzocht.`) +
    (elsewhere > 0 ? ` ${elsewhere} ${elsewhere === 1 ? "document staat" : "documenten staan"} op een ander domein en ${elsewhere === 1 ? "is" : "zijn"} niet onderzocht.` : "");
  return { ...sample, note: `${sample.note}${note}`, documents, documentPopulation: { onSite: found.length, byKind: countByKind(found), elsewhere, notChosen: notChosen.length, notChosenByKind: countByKind(notChosen) } };
}

export async function sample(runDir: string, seed: string): Promise<Sample> {
  const startedAt = stepStart();
  const inventory = await readJson<Inventory>(join(runDir, "inventory.json"));
  const model = await loadSiteModel(runDir);
  const result = withDocuments(buildSample(inventory, seed, model), inventory, seed);
  await writeJson(join(runDir, "sample.json"), result);
  await writeManifest(runDir, { command: "sample", startedAt, seed, method: result.method, items: result.items.length, ...(result.documents ? { documents: result.documents.length } : {}), ...(model ? { excludedFrames: result.excludedFrames?.length ?? 0 } : {}) });
  return result;
}
