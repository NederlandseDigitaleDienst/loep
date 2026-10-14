import { join } from "node:path";
import { readJson, sha256, stableId, writeJson } from "../lib/canonical.ts";
import { countByKind, DOCUMENT_KINDS, documentLabels, kindsNl, READ_KINDS, type DocumentKind, type InventoryDocument, type SampleDocument } from "../lib/documents.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
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
}

/** Below this size every page is evaluated and no sampling error is introduced. */
export const CENSUS_LIMIT = 60;
const RANDOM_SHARE = 0.1;

/** Pages that WCAG-EM asks for by name, recognised by path or title. */
const COMMON_PAGES: [RegExp, string][] = [
  [/^\/?$/, "startpagina"],
  [/contact/i, "contactpagina"],
  [/toegankelijkheid/i, "toegankelijkheidsverklaring"],
  [/zoek|search/i, "zoekpagina"],
  [/privacy|cookie/i, "juridische pagina"],
  [/sitemap/i, "sitemap"],
  [/help|veelgestelde|faq/i, "hulppagina"],
];

/** Deterministic order derived from the seed: the same seed always selects the same pages. */
export function seededOrder<T extends { url: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => sha256(`${seed}\u0000${a.url}`).localeCompare(sha256(`${seed}\u0000${b.url}`)));
}

function deduplicate(pages: InventoryPage[]): { page: InventoryPage; aliases: string[] }[] {
  const byContent = new Map<string, InventoryPage[]>();
  for (const page of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    byContent.set(page.contentHash, [...(byContent.get(page.contentHash) ?? []), page]);
  }
  return [...byContent.values()].map(([first, ...rest]) => ({ page: first!, aliases: rest.map((page) => page.url) }));
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

export function buildSample(inventory: Inventory, seed: string, model: SiteModel | null = null, typeOf: Map<string, string> = new Map()): Sample {
  if (model) {
    const framed = applyFrameClasses(inventory.pages, model);
    // Every page type of the model gets a page of its own, also when it shares a template with another type.
    const types = new Map(model.pageTypes.flatMap((type) => type.pages.map((url) => [url, type.id] as const)));
    const sample = buildSample({ ...inventory, pages: framed.pages }, seed, null, types);
    for (const item of sample.items) item.aliases = [...item.aliases, ...(framed.repeats.get(item.url) ?? [])].sort();
    const copies = framed.excluded.reduce((sum, frame) => sum + frame.copies, 0);
    const note = copies > 0 ? ` ${copies} ingesloten ${copies === 1 ? "venster telt" : "vensters tellen"} volgens het sitemodel niet mee als pagina (${framed.excluded.map((frame) => `${frame.descriptionNl}: ${frame.kindNl}`).join("; ")}).` : "";
    return { ...sample, note: `${sample.note}${note}`, excludedFrames: framed.excluded };
  }
  const unique = deduplicate(inventory.pages);
  const toItem = (entry: { page: InventoryPage; aliases: string[] }, kind: SampleKind, reason: string): SampleItem => {
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
        toItem(entry, "structured", entry.page.url === inventory.notFoundProbe ? "foutpagina (404)" : "volledige site onderzocht"),
      ),
    };
  }

  const chosen = new Map<string, SampleItem>();
  const seenTemplates = new Set<string>();
  const seenTypes = new Set<string>();
  for (const entry of unique) {
    const type = typeOf.get(entry.page.url);
    const path = new URL(entry.page.url).pathname;
    const common = COMMON_PAGES.find(([pattern]) => pattern.test(path === "/" ? "" : path));
    const isFrame = entry.page.foundVia.every((via) => via.startsWith("iframe:"));
    if (isFrame) chosen.set(entry.page.url, toItem(entry, "embedded", "ingesloten venster"));
    else if (entry.page.url === inventory.notFoundProbe) chosen.set(entry.page.url, toItem(entry, "structured", "foutpagina (404)"));
    else if (common) chosen.set(entry.page.url, toItem(entry, "structured", common[1]));
    else if (!seenTemplates.has(entry.page.templateHash) || (type !== undefined && !seenTypes.has(type))) chosen.set(entry.page.url, toItem(entry, "structured", "eerste pagina van dit paginatype"));
    seenTemplates.add(entry.page.templateHash);
    if (type !== undefined && chosen.has(entry.page.url)) seenTypes.add(type);
  }
  const structuredCount = chosen.size;
  const randomCount = Math.max(1, Math.ceil(structuredCount * RANDOM_SHARE));
  const remaining = seededOrder(unique.filter((entry) => !chosen.has(entry.page.url)).map((entry) => ({ ...entry, url: entry.page.url })), seed);
  for (const entry of remaining.slice(0, randomCount)) chosen.set(entry.page.url, toItem(entry, "random", `willekeurig gekozen met seed ${seed}`));

  return {
    method: "structured-plus-random",
    seed,
    populationSize: unique.length,
    note: `Uit ${unique.length} unieke pagina's zijn ${structuredCount} pagina's gericht gekozen (elk paginatype en de vaste pagina's) en ${randomCount} willekeurig, volgens WCAG-EM stap 3.`,
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

/** Add the documents to a sample of pages. A site without documents keeps the sample it had, to the letter. */
export function withDocuments(sample: Sample, inventory: Inventory, seed: string): Sample {
  const found = inventory.documents ?? [];
  if (found.length === 0) return sample;
  const documents = chooseDocuments(found, seed);
  const notChosen = found.filter((document) => !documents.some((entry) => entry.url === document.url));
  const elsewhere = inventory.documentTotals?.elsewhere ?? 0;
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
