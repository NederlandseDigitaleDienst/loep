import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSample, CENSUS_LIMIT, chooseOnVariation, contentKindsOfType, extraPagesFor, MAX_EXTRA_PER_TYPE, seededOrder } from "../src/commands/sample.ts";
import { formPagesNl, parseSitemap, passwordPagesNl, type Inventory, type InventoryPage } from "../src/commands/inventory.ts";
import { progressLine, sayingItRuns } from "../src/instruments/limit.ts";
import { canonicalJson, sha256, slugForUrl, stableId } from "../src/lib/canonical.ts";
import { changedSinceCommit, complianceStatus, evaluationHash, knownCommit, resolveCriterion } from "../src/lib/evaluation.ts";
import { toolboxSource } from "../src/lib/manifest.ts";
import { loadProcedure, parseProcedure } from "../src/lib/procedures.ts";
import { Politeness } from "../src/session/safety.ts";
import type { SiteModel } from "../src/lib/sitemodel.ts";
import type { Finding, Verdict } from "../src/lib/verdict.ts";
import { compareCriterionIds, criteriaFor, criterionById, criterionIdFromAxeTag, en301549Clause } from "../src/lib/wcag.ts";
import { exampleEvaluation } from "./fixtures/example-evaluation.ts";

test("canonical JSON does not depend on key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } }), canonicalJson({ a: { c: 2, d: [3, { y: 2, z: 1 }] }, b: 1 }));
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(stableId("s", "a", "b"), stableId("s", "a", "b"));
  assert.notEqual(stableId("s", "ab", ""), stableId("s", "a", "b"));
});

test("slugs are stable, readable and unique per URL", () => {
  assert.match(slugForUrl("https://example.nl/"), /^home-[0-9a-f]{8}$/);
  assert.notEqual(slugForUrl("https://example.nl/over"), slugForUrl("https://example.nl/over/"));
});

test("WCAG data matches the standard", () => {
  assert.equal(criteriaFor("2.2").length, 55);
  assert.equal(criteriaFor("2.1").length, 50);
  assert.deepEqual(criterionById("4.1.1")?.versions, ["2.1"]);
  assert.equal(criterionById("1.1.1")?.titleNl, "Niet-tekstuele content");
  assert.equal(criterionIdFromAxeTag("wcag1410"), "1.4.10");
  assert.equal(criterionIdFromAxeTag("wcag2aa"), undefined);
  assert.equal(en301549Clause("2.4.11"), "9.2.4.11");
  assert.deepEqual(["1.4.10", "1.4.2", "1.3.1"].sort(compareCriterionIds), ["1.3.1", "1.4.2", "1.4.10"]);
});

test("sitemap locations are extracted", () => {
  assert.deepEqual(parseSitemap("<urlset><url><loc> https://a.nl/x?a=1&amp;b=2 </loc></url><url><loc>https://a.nl/y</loc></url></urlset>"), ["https://a.nl/x?a=1&b=2", "https://a.nl/y"]);
});

function page(index: number, template = "t", content = `c${index}`): InventoryPage {
  return { url: `https://a.nl/p${String(index).padStart(3, "0")}`, slug: `p${index}`, status: 200, title: `Pagina ${index}`, lang: "nl", templateHash: template, contentHash: content, foundVia: ["sitemap"], counts: {} };
}

function inventory(pages: InventoryPage[]): Inventory {
  return { baseUrl: "https://a.nl/", origin: "https://a.nl", sitemapUrls: pages.length, notFoundProbe: "https://a.nl/404", pages, skipped: [], totals: {} };
}

test("inventory says when pages show a password field and nobody logged in", () => {
  const withField = { ...page(2), counts: { passwordFields: 1 } };
  assert.equal(passwordPagesNl([page(1)], false), null, "no password field, nothing to say");
  assert.equal(passwordPagesNl([page(1), withField], true), null, "a run with a login has password fields on purpose");
  const one = passwordPagesNl([page(1), withField], false);
  assert.match(one!, /één pagina toont een wachtwoordveld \(https:\/\/a\.nl\/p002\)/);
  assert.match(one!, /loep login/);
  assert.match(passwordPagesNl([withField, { ...page(3), counts: { passwordFields: 2 } }], false)!, /2 pagina's tonen een wachtwoordveld \(https:\/\/a\.nl\/p002 en 1 meer\)/);
});

test("inventory says when pages have a form or a frame on another origin has one, and the run may not send", () => {
  // A search in the header is on every page: that alone says nothing.
  const search = (index: number): InventoryPage => ({ ...page(index), counts: { forms: 1 } });
  const contact = { ...page(3), counts: { forms: 2 } };
  const chat: InventoryPage = { ...page(4), url: "https://chat.b.nl/widget", foundVia: ["iframe:https://a.nl/p003"], counts: { forms: 1 } };
  assert.equal(formPagesNl([search(1), search(2)], "https://a.nl", false), null, "only the form every page has");
  assert.equal(formPagesNl([search(1), contact, chat], "https://a.nl", true), null, "a run that may send has nothing to fear");
  const both = formPagesNl([search(1), search(2), contact, chat], "https://a.nl", false)!;
  assert.match(both, /^let op: dit onderzoek mag niet versturen, en één pagina heeft een formulier dat niet op elke pagina staat \(https:\/\/a\.nl\/p003\), en één ingesloten venster op een ander adres heeft een formulier \(https:\/\/chat\.b\.nl\/widget\)\./);
  assert.match(both, /blijft open als "versturen niet toegestaan"/);
  assert.match(both, /--test-environment <origin> --declared-by "<naam>, <functie>"; voor een venster op een ander adres kan dat de origin van alleen dat venster zijn$/);
  // With only the frame, its origin is the one to declare.
  assert.match(formPagesNl([search(1), search(2), chat], "https://a.nl", false)!, /--test-environment https:\/\/chat\.b\.nl --declared-by/);
  // A frame on the site's own origin is a page like any other.
  assert.equal(formPagesNl([search(1), { ...chat, url: "https://a.nl/chat" }], "https://a.nl", false), null);
  assert.match(formPagesNl([page(1), contact, { ...page(5), counts: { forms: 3 } }], "https://a.nl", false)!, /2 pagina's hebben een formulier dat niet op elke pagina staat \(https:\/\/a\.nl\/p003 en 1 meer\)/);
});

test("a small site is evaluated in full and identical pages once", () => {
  const sample = buildSample(inventory([page(1), page(2), page(3, "t", "c2")]), "seed");
  assert.equal(sample.method, "census");
  assert.equal(sample.items.length, 2);
  assert.deepEqual(sample.items[1]!.aliases, ["https://a.nl/p003"]);
});

test("a large site gets a structured sample plus a seeded random tenth", () => {
  const pages = Array.from({ length: CENSUS_LIMIT + 40 }, (_, index) => page(index, `t${index % 7}`));
  const first = buildSample(inventory(pages), "seed");
  const again = buildSample(inventory([...pages].reverse()), "seed");
  const other = buildSample(inventory(pages), "another seed");
  assert.equal(first.method, "structured-plus-random");
  assert.deepEqual(first, again, "input order must not matter");
  assert.equal(first.items.filter((item) => item.kind === "structured").length, 7);
  assert.equal(first.items.filter((item) => item.kind === "random").length, 1);
  assert.notDeepEqual(first.items.filter((item) => item.kind === "random"), other.items.filter((item) => item.kind === "random"));
  assert.deepEqual(seededOrder(pages, "x").map((entry) => entry.url), seededOrder([...pages].reverse(), "x").map((entry) => entry.url));
});

test("every page type of the site model gets a page in the sample, also when it shares a template", () => {
  const pages = Array.from({ length: CENSUS_LIMIT + 40 }, (_, index) => page(index, "t"));
  const urls = pages.map((entry) => entry.url);
  const type = (id: string, members: string[]) => ({ id, descriptionNl: id, representative: members[0]!, pages: members });
  const model = { version: 1, baseUrl: "https://a.nl/", pageTypes: [type("overzicht", [urls[50]!]), type("artikel", urls.filter((_, index) => index !== 50))], blockers: [], components: [], processes: [], frames: [], notesNl: [] } as SiteModel;
  assert.equal(buildSample(inventory(pages), "seed").items.filter((item) => item.kind === "structured").length, 1, "one template, one structured page");
  const structured = buildSample(inventory(pages), "seed", model).items.filter((item) => item.kind === "structured");
  assert.deepEqual(structured.filter((item) => !isExtra(item)).map((item) => item.url), [urls[0], urls[50]]);
  assert.equal(structured.filter(isExtra).length, 2, "99 pages of one type: two extra pages, one per 40");
});

test("with a site model the page types decide the structured sample, not a template hash that differs per page", () => {
  // Every page its own template hash, as on a site that puts a build hash or a page id in the markup.
  const pages = Array.from({ length: CENSUS_LIMIT + 40 }, (_, index) => page(index, `t${index}`));
  const at = (path: string, index: number): InventoryPage => ({ ...page(index, `t${index}`), url: `https://a.nl${path}` });
  const extra = [at("/toegankelijkheid", 900), at("/blog/tags/toegankelijkheid", 901), at("/blog/2025/hoe-dit-helpt", 902), at("/404-toegankelijkheidsonderzoek", 903)];
  const all = [...pages, ...extra];
  const urls = pages.map((entry) => entry.url);
  const type = (id: string, members: string[], representative = members[0]!) => ({ id, descriptionNl: id, representative, pages: members });
  const model = { version: 1, baseUrl: "https://a.nl/", pageTypes: [type("overzicht", urls.slice(0, 10), urls[5]!), type("artikel", [...urls.slice(10), ...extra.slice(0, 3).map((entry) => entry.url)], urls[20]!)], blockers: [], components: [], processes: [], frames: [], notesNl: [] } as SiteModel;
  const sample = buildSample({ ...inventory(all), notFoundProbe: "https://a.nl/404-toegankelijkheidsonderzoek" }, "seed", model);
  const structured = sample.items.filter((item) => item.kind === "structured" && !isExtra(item));
  assert.deepEqual(structured.map((item) => [item.url, item.reason]).sort(), [
    ["https://a.nl/404-toegankelijkheidsonderzoek", "foutpagina (404)"],
    ["https://a.nl/toegankelijkheid", "toegankelijkheidsverklaring"],
    [urls[20]!, "eerste pagina van dit paginatype"],
    [urls[5]!, "eerste pagina van dit paginatype"],
  ].sort(), "one page per type (the representative), the statement once at the top of the site, no help page for a post that says 'helpt'");
  assert.equal(sample.items.filter(isExtra).length, 2, "93 articles: two extra pages; ten overview pages: none");
  assert.equal(sample.items.filter((item) => item.kind === "random").length, 1);
});

// A page type of the size of a knowledge base: most pages alike, a few with content of their own.
function knowledgeBase(size: number, offset = 0): InventoryPage[] {
  return Array.from({ length: size }, (_, index) => {
    const special: Record<number, Record<string, number>> = { 10: { tables: 1 }, 20: { tables: 2, video: 1 }, 30: { forms: 2 }, 50: { audio: 1 } };
    return { ...page(offset + index, `t${offset + index}`), counts: { images: 2, tables: 0, forms: 1, video: 0, audio: 0, headings: 5, lists: 3, ...special[index] }, words: index === 40 ? 3000 : 300 };
  });
}
const pageType = (id: string, members: string[]) => ({ id, descriptionNl: `type ${id}`, representative: members[0]!, pages: members });
const modelOf = (types: ReturnType<typeof pageType>[]): SiteModel => ({ version: 1, baseUrl: "https://a.nl/", pageTypes: types, blockers: [], components: [], processes: [], frames: [], notesNl: [] }) as unknown as SiteModel;
const isExtra = (item: { reason: string }): boolean => item.reason.startsWith("gekozen op variatie") || item.reason.startsWith("extra pagina van dit paginatype");

test("a large page type gets extra pages chosen on what their content adds, the same every time", () => {
  const pages = knowledgeBase(200);
  const model = modelOf([pageType("artikel", pages.map((entry) => entry.url))]);
  const first = buildSample(inventory(pages), "seed", model);
  assert.deepEqual(first, buildSample(inventory([...pages].reverse()), "seed", model), "input order must not matter");
  const extras = first.items.filter(isExtra);
  assert.equal(extras.length, MAX_EXTRA_PER_TYPE, "200 pages: one per 40, at most five");
  const at = (index: number): string => pages[index]!.url;
  // The page with a table and a video adds two kinds at once and goes first; the page with only a table then adds nothing.
  assert.deepEqual(
    extras.filter((item) => item.reason.startsWith("gekozen op variatie")).map((item) => [item.url, item.reason]).sort(),
    [
      [at(20), "gekozen op variatie: tabel, video"],
      [at(30), "gekozen op variatie: formulier"],
      [at(40), "gekozen op variatie: lange tekst"],
      [at(50), "gekozen op variatie: geluid"],
    ].sort(),
  );
  assert.ok(!extras.some((item) => item.url === at(10)), "a table that is already covered adds nothing");
  assert.match(extras.find((item) => item.reason.startsWith("extra pagina"))!.reason, /gekozen met seed seed: geen pagina voegt nog een soort inhoud toe/);
  // Another seed keeps the pages chosen on variation and only changes the tie-break.
  const other = buildSample(inventory(pages), "another seed", model);
  assert.deepEqual(other.items.filter((item) => item.reason.startsWith("gekozen op variatie")).map((item) => item.url).sort(), [at(20), at(30), at(40), at(50)].sort());
  // The random tenth stays a tenth of the structured part, the extra pages included.
  const structured = first.items.filter((item) => item.kind === "structured").length;
  assert.equal(first.items.filter((item) => item.kind === "random").length, Math.ceil(structured / 10));
  assert.match(first.note, /5 extra pagina's van grote paginatypen, gekozen op variatie in inhoud: één per 40 pagina's van het type, hooguit 5/);
  assert.deepEqual(first.pageTypes, [{ id: "artikel", descriptionNl: "type artikel", pages: 200, examined: first.items.length, reasonNl: `de voorbeeldpagina van de verkenner, 4 gekozen op variatie in inhoud, 1 extra gekozen met de seed, omdat geen pagina nog een soort inhoud toevoegde en ${first.items.filter((item) => item.kind === "random").length} willekeurig gekozen` }]);
});

test("the extra pages grow with the size of a page type", () => {
  assert.deepEqual([1, 39, 40, 79, 80, 197, 199, 200, 5000].map(extraPagesFor), [0, 0, 1, 1, 2, 4, 4, 5, 5]);
  // 562 pages in 11 types, the four largest 197, 145, 115 and 74, the other seven 31 together.
  const sizes = [197, 145, 115, 74, 5, 5, 5, 4, 4, 4, 4];
  let offset = 0;
  const types = sizes.map((size, index) => {
    const members = knowledgeBase(size, offset);
    offset += size;
    return { members, type: pageType(`type-${index + 1}`, members.map((entry) => entry.url)) };
  });
  const pages = types.flatMap((entry) => entry.members);
  assert.equal(pages.length, 562);
  const sample = buildSample(inventory(pages), "seed", modelOf(types.map((entry) => entry.type)));
  assert.deepEqual(sample.pageTypes!.map((type) => type.pages), sizes);
  assert.equal(sample.items.filter(isExtra).length, 4 + 3 + 2 + 1);
  const structured = sample.items.filter((item) => item.kind === "structured").length;
  assert.equal(structured, 11 + 10);
  assert.equal(sample.items.filter((item) => item.kind === "random").length, 3);
});

test("a small site, a site without a model and a fixed list get no extra pages", () => {
  const small = knowledgeBase(CENSUS_LIMIT);
  const census = buildSample(inventory(small), "seed", modelOf([pageType("artikel", small.map((entry) => entry.url))]));
  assert.equal(census.method, "census");
  assert.equal(census.items.length, CENSUS_LIMIT);
  assert.equal(census.pageTypes, undefined);
  const large = knowledgeBase(200);
  const without = buildSample(inventory(large), "seed");
  assert.equal(without.items.filter(isExtra).length, 0);
  assert.equal(without.pageTypes, undefined);
  const fixed = large.map((entry) => ({ ...entry, foundVia: ["fixed-list"] }));
  const listed = buildSample(inventory(fixed), "seed", modelOf([pageType("artikel", fixed.map((entry) => entry.url))]));
  assert.equal(listed.method, "fixed-list");
  assert.equal(listed.items.length, 200);
  assert.equal(listed.items.filter(isExtra).length, 0);
});

test("a kind of content counts where a page has more of it than the usual page of its type", () => {
  const kinds = contentKindsOfType(knowledgeBase(60));
  assert.deepEqual(kinds.get(page(0).url), [], "the usual page adds nothing, also with a search form and images in its header");
  assert.deepEqual(kinds.get(page(20).url), ["tabel", "video"]);
  assert.deepEqual(kinds.get(page(40).url), ["lange tekst"]);
  // An inventory from before the counts of images, headings and words adds nothing for them.
  const older = knowledgeBase(60).map(({ words: _words, ...entry }) => ({ ...entry, counts: { tables: entry.counts.tables } }));
  assert.deepEqual(contentKindsOfType(older).get(page(40).url), []);
  // Two pages that add as much: the seed decides, and what is covered already does not count.
  const tie = [{ url: "https://a.nl/a", kinds: ["tabel"] }, { url: "https://a.nl/b", kinds: ["tabel", "video"] }];
  const [pick] = chooseOnVariation(tie, ["video"], 1, "seed");
  assert.equal(pick!.candidate.url, seededOrder(tie, "seed")[0]!.url);
  assert.deepEqual(pick!.added, ["tabel"]);
});

const observation = { checkedNl: "Alle afbeeldingen", howNl: "Tabel images", observedNl: "37 van 37 hebben een naam", evidence: ["images"] };
const finding: Finding = { titleNl: "Logo zonder alt", observedNl: "Het logo heeft geen alt.", impactNl: "Schermlezer slaat het over.", fixNl: "Voeg alt toe.", severity: "hoog", owner: "techniek", component: null, locations: [{ page: "P01", where: "header img" }], pagesAffected: "P01", evidence: ["images"] };
const passed: Verdict = { criterion: "1.1.1", outcome: "passed", rule: "R4", summaryNl: "Alle 37 afbeeldingen hebben een passend tekstalternatief.", observations: [observation], findings: [] };

test("a criterion only gets an outcome from the verifier", () => {
  const criterion = criterionById("1.1.1")!;
  const base = { criterion, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  assert.equal(resolveCriterion({ ...base, verdicts: { a: passed, final: null } }, "X").outcome, "untested");
  const failed = { ...passed, outcome: "failed" as const, findings: [finding, finding] };
  const result = resolveCriterion({ ...base, verdicts: { a: passed, final: failed } }, "X");
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.rounds, { a: "passed", b: null, final: "failed" });
  assert.equal(new Set(result.findings.map((entry) => entry.id)).size, 2, "finding identifiers are unique");
});

test("two defects in one component get identifiers that do not read as one defect twice", () => {
  const criterion = criterionById("1.4.11")!;
  const base = { criterion, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  const inSearch = { ...finding, component: "zoekveld" };
  const twoDefects = { ...passed, criterion: "1.4.11", outcome: "failed" as const, findings: [{ ...inSearch, titleNl: "Vage pijl" }, { ...inSearch, titleNl: "Te donker kruisje" }] };
  const ids = resolveCriterion({ ...base, verdicts: { a: passed, final: twoDefects } }, "X").findings.map((entry) => entry.id);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every((id) => /^X-1\.4\.11-[0-9a-f]{4}$/.test(id)), `no suffix: ${ids.join(", ")}`);
  const sameDefectTwice = { ...twoDefects, findings: [inSearch, inSearch] };
  const twice = resolveCriterion({ ...base, verdicts: { a: passed, final: sameDefectTwice } }, "X").findings.map((entry) => entry.id);
  assert.equal(twice[1], `${twice[0]}-2`, "only the same title in the same place gets a suffix");
  const alone = resolveCriterion({ ...base, verdicts: { a: passed, final: { ...twoDefects, findings: [inSearch] } } }, "X").findings[0]!.id;
  assert.notEqual(alone, ids[0], "a finding alone in its place keeps the identifier of its place");
});

test("a recommendation comes only from a rule of the procedure, and never decides an outcome", () => {
  assert.deepEqual(loadProcedure("1.3.2").recommendationRules, ["A1"], "the cards rule of 1.3.2 is a recommendation, not a decision rule");
  assert.deepEqual(loadProcedure("1.1.1").recommendationRules, []);
  const base = loadProcedure("1.1.1");
  const text = (section: string): string => `---\nid: "1.1.1"\nversion: 1\nclass: oordeel\nevidence: [images]\n---\n${base.body}\n\n${section}\n`;
  assert.deepEqual(parseProcedure(text("## Aanbevelingen\n\n- A1. Een patroon.\n- A2. Nog een."), "1.1.1").recommendationRules, ["A1", "A2"]);
  assert.throws(() => parseProcedure(text("## Aanbevelingen\n\nGeen regels."), "1.1.1"), /has no rules/);
  assert.throws(() => parseProcedure(text("## Aanbevelingen\n\n- A1. Anders `failed`."), "1.1.1"), /names an outcome/);
  assert.throws(() => parseProcedure(text("## Aanbevelingen\n\n- A1. Dan voldoet niet de site."), "1.1.1"), /names an outcome/);
});

test("a recommendation goes into the evaluation with its own identifier, and leaves the outcome alone", () => {
  const criterion = criterionById("1.3.2")!;
  const base = { criterion, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  const recommendation = { rule: "A1", titleNl: "Datum na de titel", observedNl: "De datum staat in de code vóór de titel.", recommendationNl: "Zet de datum na de titel.", locations: [{ page: "P01", where: ".kaart", heading: "Nieuws" }], evidence: ["images"] };
  const withRecommendation = { ...passed, criterion: "1.3.2", recommendations: [recommendation] };
  const result = resolveCriterion({ ...base, verdicts: { a: withRecommendation, final: withRecommendation } }, "X");
  assert.equal(result.outcome, "passed");
  assert.equal(result.findings.length, 0);
  assert.match(result.recommendations![0]!.id, /^X-1\.3\.2-A[0-9a-f]{4}$/);
  assert.equal(result.recommendations![0]!.component, null);
  assert.equal(resolveCriterion({ ...base, verdicts: { a: passed, final: passed } }, "X").recommendations, undefined, "no field without a recommendation");
});

test("status follows the outcomes and needs a signature", () => {
  const evaluation = exampleEvaluation();
  assert.equal(complianceStatus(evaluation, "2.2").status, "geen");
  const signed = { ...evaluation, signature: { name: "N", role: "R", organisation: "O", signedAt: "2026-10-10", statementNl: "S", evaluationSha256: evaluationHash(evaluation), sealSha256: "5".repeat(64) } };
  assert.equal(complianceStatus(signed, "2.2").status, "C", "open questions mean the evaluation does not cover every requirement");
  assert.equal(evaluationHash(signed), evaluationHash(evaluation), "the signature is not part of what is signed");
  const decided = { ...signed, summary: { ...signed.summary, "2.2": { ...signed.summary["2.2"], cantTell: 0 } } };
  assert.equal(complianceStatus(decided, "2.2").status, "B");
  const clean = { ...decided, summary: { ...decided.summary, "2.2": { ...decided.summary["2.2"], failed: 0 } } };
  assert.equal(complianceStatus(clean, "2.2").status, "A");
});

test("a finding that recurs keeps its identifier, a new one does not take it", async () => {
  const { carryFindingIds } = await import("../src/lib/evaluation.ts");
  const criterion = criterionById("2.4.1")!;
  const base = { criterion, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  const skip: Finding = { ...finding, titleNl: 'Knop "Sla over" brengt je niet naar de inhoud', component: "skiplink", locations: [{ page: "P01", where: "header >>> button" }] };
  const reworded: Finding = { ...finding, titleNl: "De knop Sla over verplaatst de focus niet naar de inhoud", component: "skiplink in de kop", locations: [{ page: "P01", where: "nldd-skip-link >>> button" }] };
  const other: Finding = { ...finding, titleNl: "Hoofdgebied omvat ook het menu", component: null, locations: [{ page: "P02", where: "main" }] };
  const first = resolveCriterion({ ...base, verdicts: { a: null, final: { ...passed, criterion: "2.4.1", outcome: "failed", findings: [skip] } } }, "X");
  const second = resolveCriterion({ ...base, verdicts: { a: null, final: { ...passed, criterion: "2.4.1", outcome: "failed", findings: [other, reworded] } } }, "X");
  // Linked by criterion, page and place: the title was reworded, the place was not.
  const { matchFindings } = await import("../src/lib/difference.ts");
  const side = (criteria: (typeof first)[]) => ({ criteria, urlOf: (label: string) => label });
  const result = carryFindingIds([second], matchFindings(side([second]), side([first])));
  assert.deepEqual(result, { carried: 1, fresh: 1 });
  assert.equal(second.findings[1]!.id, first.findings[0]!.id);
  assert.notEqual(second.findings[0]!.id, first.findings[0]!.id);
});

test("two evaluations side by side: solved, stayed and new, linked by place and not by title", async () => {
  const { compareEvaluations } = await import("../src/lib/difference.ts");
  const { renderDifference } = await import("../src/commands/diff.ts");
  const previous = exampleEvaluation();
  const current = exampleEvaluation();
  // An evaluation records on which element a finding was measured; here that is the place the finding names, as the page loads.
  for (const evaluation of [previous, current]) for (const finding of evaluation.criteria.flatMap((criterion) => criterion.findings)) finding.targets = finding.locations.map((location) => ({ page: location.page, path: [location.where], state: null }));
  const failing = current.criteria.filter((criterion) => criterion.findings.length > 0);
  // The same place under another title stays; a finding that is gone is solved; one at a new place is new.
  const kept = failing[0]!.findings[0]!;
  kept.titleNl = "Een heel andere omschrijving van hetzelfde";
  kept.id = "VOOR-nieuw-kenmerk";
  const gone = failing[1]!.findings.shift()!;
  if (failing[1]!.findings.length === 0) failing[1]!.outcome = "passed";
  const added = { ...kept, id: "VOOR-erbij", titleNl: previous.criteria.find((criterion) => criterion.id === kept.criterion)!.findings[0]!.titleNl, component: "kaart op de contactpagina", locations: [{ page: "P02", where: "#kaart > iframe.plattegrond" }], targets: [{ page: "P02", path: ["#kaart > iframe.plattegrond"], state: null }] };
  failing[0]!.findings.push(added);
  const difference = compareEvaluations(previous, current);
  const before = previous.criteria.flatMap((criterion) => criterion.findings).length;
  assert.deepEqual(difference.resolved.map((item) => item.id), [gone.id]);
  assert.deepEqual(difference.fresh.map((item) => item.id), ["VOOR-erbij"], "the same title at another place is another finding");
  assert.equal(difference.remained.length, before - 1);
  assert.equal(difference.remained.find((item) => item.id === "VOOR-nieuw-kenmerk")!.previousId, previous.criteria.find((criterion) => criterion.id === kept.criterion)!.findings[0]!.id);
  // The page was examined both times and the criterion was judged: missed then or arisen since, which the two evaluations cannot tell apart.
  assert.equal(difference.fresh[0]!.examined, "examined");
  assert.equal(difference.resolved[0]!.examined, "examined");
  assert.deepEqual(difference.outcomes.map((row) => row.criterion), failing[1]!.outcome === "passed" ? [failing[1]!.id] : []);
  assert.equal(difference.previous.signed, false);

  const markdown = renderDifference(difference);
  assert.match(markdown, /^> \*\*Werkdocument, geen onderdeel van het rapport\.\*\*/m);
  assert.ok(markdown.includes(`\`${evaluationHash(previous).slice(0, 12)}\` | \`${evaluationHash(current).slice(0, 12)}\``), "both evaluations are named by hash");
  assert.ok(markdown.includes("| Afgetekend | nee, concept | nee, concept |"));
  assert.ok(markdown.includes("| Gemaakt met | loep 0.0.1, commit 000000000000 | loep 0.0.1, commit 000000000000 |"));
  assert.ok(!markdown.includes("\u2014"));

  // A page that was not in the sample then: the finding is found for the first time, not necessarily new on the site.
  const smaller = exampleEvaluation();
  smaller.sample.items = smaller.sample.items.filter((_item, index) => index !== 1);
  smaller.criteria.forEach((criterion) => (criterion.findings = criterion.findings.filter((entry) => entry.locations.every((location) => location.page === "P01"))));
  const again = compareEvaluations(smaller, current);
  assert.equal(again.fresh.find((item) => item.id === "VOOR-erbij")!.examined, "notExamined");
  assert.equal(again.pagesOnlyNow.length, 1);
});

test("the report names an earlier evaluation only when that one was signed, and never compares", async () => {
  const { renderMarkdown, deriveReport } = await import("../src/lib/report-markdown.ts");
  const plain = exampleEvaluation();
  assert.equal(deriveReport(plain).followsUpNl, null);
  assert.ok(!renderMarkdown(plain).includes("Heronderzoek"));
  const followUp = { ...exampleEvaluation(), followsUp: { evaluatedAt: "2026-04-02T09:00:00.000Z", sha256: "ab12cd34ef56ab12cd34ef56", signedAt: "2026-04-20T09:00:00.000Z" } };
  assert.ok(renderMarkdown(followUp).includes("- Heronderzoek: Dit is een heronderzoek. Het vorige onderzoek is van 2 april 2026, afgetekend op 20 april 2026, met kenmerk ab12cd34ef56."));
});

test("a difference between evaluations of two sites is refused", async () => {
  const { diff } = await import("../src/commands/diff.ts");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "loep-diff-"));
  const other = exampleEvaluation();
  other.site.baseUrl = "https://een-andere-site.example/";
  writeFileSync(join(dir, "a.json"), JSON.stringify(exampleEvaluation()));
  writeFileSync(join(dir, "b.json"), JSON.stringify(other));
  await assert.rejects(diff(join(dir, "a.json"), join(dir, "b.json"), dir), /andere site/);
  const same = await diff(join(dir, "a.json"), join(dir, "a.json"), dir);
  assert.equal(same.difference.resolved.length + same.difference.fresh.length, 0);
});

test("not fully measured without a deviation stays open: status C, with the split in the reason", () => {
  const evaluation = exampleEvaluation();
  const open = evaluation.criteria.filter((criterion) => criterion.outcome === "cantTell" && criterion.versions.includes("2.1"));
  const sign = (input: typeof evaluation) => ({ ...input, signature: { name: "A", role: "B", organisation: "C", signedAt: "2026-10-12T09:00:00.000Z", statementNl: "", evaluationSha256: evaluationHash(input), sealSha256: "5".repeat(64) } });
  const before = complianceStatus(sign(evaluation), "2.1");
  open[0]!.nothingFound = { coverageNl: "gemeten op 9 van 29 pagina's; geen verschil gevonden" };
  const after = complianceStatus(sign(evaluation), "2.1");
  assert.equal(after.status, "C");
  assert.equal(before.status, "C");
  assert.ok(!before.reasonNl.includes("niet alles gemeten"));
  assert.ok(after.reasonNl.includes(`Bij ${open.length} criteria kon niet worden vastgesteld of eraan is voldaan. Bij 1 daarvan is geen afwijking gevonden, maar is niet alles gemeten; bij ${open.length - 1} is de vraag echt open.`));
  // The verdict hands the field on only with "cantTell".
  const criterion = criterionById("1.4.3")!;
  const base = { criterion, procedure: null, provenance: { dossierSha256: null, verdictSha256: {} } };
  const nothingFound = { coverageNl: "gemeten op 9 van 29 pagina's; geen verschil gevonden" };
  assert.deepEqual(resolveCriterion({ ...base, verdicts: { a: null, final: { ...passed, criterion: "1.4.3", outcome: "cantTell", missingNl: ["veegronde mist: contrast op 320 pixels."], nothingFound } } }, "X").nothingFound, nothingFound);
  assert.equal(resolveCriterion({ ...base, verdicts: { a: null, final: { ...passed, criterion: "1.4.3", nothingFound } } }, "X").nothingFound, undefined);
});

test("a step that takes long says that it still runs, and a short one says nothing", async () => {
  assert.equal(progressLine("states", "toetsen", 2, 29, "P03"), "states toetsen 3/29 P03\n");
  assert.equal(progressLine("contrast", null, 0, 8, "https://site.nl/ licht 1200ms"), "contrast 1/8 https://site.nl/ licht 1200ms\n");
  const lines: string[] = [];
  const slow = await sayingItRuns("states aanwijzen 3/29 P03", () => new Promise<string>((resolve) => setTimeout(() => resolve("klaar"), 130)), 50, (line) => lines.push(line));
  assert.equal(slow, "klaar");
  assert.ok(lines.length >= 1 && lines.length <= 3, `${lines.length} lines in 130 ms at one per 50 ms`);
  assert.match(lines[0]!, /^states aanwijzen 3\/29 P03 loopt nog \(\d+s\)\n$/);
  const quick: string[] = [];
  await sayingItRuns("collect 1/1 https://site.nl/", async () => undefined, 50, (line) => quick.push(line));
  await assert.rejects(sayingItRuns("collect 1/1 https://site.nl/", async () => Promise.reject(new Error("mislukt")), 50, (line) => quick.push(line)), /mislukt/);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(quick, [], "nothing is said during a short step, and nothing after a step ended");
});

test("a toolbox outside a git repository has no commit and is never called dirty", () => {
  const plain = mkdtempSync(join(tmpdir(), "loep-nogit-"));
  writeFileSync(join(plain, "package.json"), "{}");
  assert.deepEqual(toolboxSource(plain), { commit: null, dirty: false });
  // A repository without a first commit: git status lists files, but there is no commit to compare them with.
  const empty = mkdtempSync(join(tmpdir(), "loep-nocommit-"));
  execFileSync("git", ["init", "-q", empty]);
  writeFileSync(join(empty, "package.json"), "{}");
  execFileSync("git", ["-C", empty, "add", "package.json"]);
  assert.deepEqual(toolboxSource(empty), { commit: null, dirty: false });
  // The toolbox in this repository has a commit.
  assert.match(toolboxSource().commit ?? "", /^[0-9a-f]{40}$/);
});

test("the placeholder an older run wrote for a missing commit is read as no commit", () => {
  assert.equal(knownCommit({ commit: "no commit yet" }), null);
  assert.equal(knownCommit({ commit: null }), null);
  assert.equal(knownCommit(undefined), null);
  assert.equal(knownCommit({ commit: "a".repeat(40) }), "a".repeat(40));
  assert.equal(changedSinceCommit({ commit: "no commit yet", dirty: true }), false);
  assert.equal(changedSinceCommit({ commit: null, dirty: true }), false);
  assert.equal(changedSinceCommit({ commit: "a".repeat(40), dirty: true }), true);
});

test("navigations to one host are spaced out, also when they are asked for at the same moment", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const politeness = new Politeness(400);
  const at = new Map<string, number>();
  const navigate = (name: string, url: string): void => void politeness.before(url).then(() => at.set(name, Date.now() - 1_000_000));
  // Chromium and the two second browsers open the same site at once; another host does not wait for them.
  navigate("chromium", "https://a.nl/");
  navigate("webkit", "https://a.nl/");
  navigate("firefox", "https://a.nl/other");
  navigate("elsewhere", "https://b.nl/");
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  for (let step = 0; step < 4; step++) {
    await settle();
    context.mock.timers.tick(200);
  }
  await settle();
  assert.deepEqual(Object.fromEntries(at), { chromium: 0, elsewhere: 0, webkit: 400, firefox: 800 });
  // A navigation nobody announced, such as a click on a link, starts the pause too.
  politeness.seen("https://b.nl/next");
  assert.equal(politeness.remaining("https://b.nl/"), 400);
});
