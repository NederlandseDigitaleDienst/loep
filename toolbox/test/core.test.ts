import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSample, CENSUS_LIMIT, seededOrder } from "../src/commands/sample.ts";
import { parseSitemap, type Inventory, type InventoryPage } from "../src/commands/inventory.ts";
import { progressLine, sayingItRuns } from "../src/instruments/limit.ts";
import { canonicalJson, sha256, slugForUrl, stableId } from "../src/lib/canonical.ts";
import { complianceStatus, evaluationHash, resolveCriterion } from "../src/lib/evaluation.ts";
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
  const structured = buildSample(inventory(pages), "seed", model).items.filter((item) => item.kind === "structured").map((item) => item.url);
  assert.deepEqual(structured, [urls[0], urls[50]]);
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
