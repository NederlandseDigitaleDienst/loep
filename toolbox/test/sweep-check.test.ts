import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFECTS } from "../fixtures/defects.ts";
import { EVIDENCE, isAgentOnly } from "../fixtures/evidence.ts";
import { DISRUPTED_PAGES, DISRUPTIONS, GATE_CHECKS } from "../fixtures/disruptions.ts";
import { DEFAULT_PORTS } from "../fixtures/serve.ts";
import { baselineOf, compareWithBaseline, evaluate, fixturePorts, installModel, KEY_PAGES_WITH_DISRUPTIONS, mergeRows, placeOf, reportMarkdown, summaryLine, SWEEP_PAGES, sweepPlan, type Report, type Row } from "../scripts/sweep-check.ts";

const row = (defect: string, found: boolean | null, twin: boolean | null): Row => ({ defect, criterion: defect.split("-")[0]!, kind: found === null ? "agent" : "script", whereNl: "probes/x.json", found, missingOn: found === false ? ["/"] : [], twin, twinOn: twin ? ["/"] : [] });

test("every defect of the key has one entry in the table of evidence, and a defect a script can measure is never left to an agent", () => {
  assert.deepEqual(EVIDENCE.map((entry) => entry.defect).sort(), DEFECTS.map((defect) => defect.id).sort());
  const measurable = new Set(DEFECTS.filter((defect) => defect.class === "measurable").map((defect) => defect.id));
  assert.deepEqual(EVIDENCE.filter((entry) => isAgentOnly(entry) && measurable.has(entry.defect)).map((entry) => entry.defect), []);
  for (const entry of EVIDENCE) {
    if (isAgentOnly(entry)) continue;
    for (const page of entry.pages ?? []) assert.ok(SWEEP_PAGES.includes(page), `${entry.defect}: ${page} is not measured by the check`);
  }
});

test("on the twin a defect is looked for at its place: the selector without what makes it a defect", () => {
  assert.equal(placeOf("#naam:not([autocomplete])"), "#naam");
  assert.equal(placeOf("table.rooster:not(:has(th))"), "table.rooster");
  assert.equal(placeOf(".tabs:not([role]) div.tab"), ".tabs div.tab");
  assert.equal(placeOf(".pagina ~ .mobiel-menu"), ".pagina ~ .mobiel-menu");
});

test("the check fails when evidence the baseline had is gone or the twin shows new evidence, not when it gets better", () => {
  const baseline = baselineOf([row("1.1.1-a", true, false), row("1.4.12-b", false, false), row("2.4.1-c", true, true), row("1.2.1-d", null, null)]);
  const same = compareWithBaseline([row("1.1.1-a", true, false), row("1.4.12-b", false, false), row("2.4.1-c", true, true), row("1.2.1-d", null, null)], baseline);
  assert.deepEqual(same, { regressions: [], improvements: [] });
  const worse = compareWithBaseline([row("1.1.1-a", false, true), row("1.4.12-b", false, false), row("2.4.1-c", true, true), row("1.2.1-d", null, null)], baseline);
  assert.equal(worse.regressions.length, 2);
  assert.match(worse.regressions[0]!, /^1\.1\.1-a: het bewijs stond in de basislijn/);
  assert.match(worse.regressions[1]!, /^1\.1\.1-a: op de tweeling/);
  const better = compareWithBaseline([row("1.1.1-a", true, false), row("1.4.12-b", true, false), row("2.4.1-c", true, false), row("1.2.1-d", null, null)], baseline);
  assert.deepEqual(better.regressions, []);
  assert.equal(better.improvements.length, 2);
  // Without a baseline nothing can go back, but evidence on the twin always fails.
  assert.deepEqual(compareWithBaseline([row("1.1.1-a", false, true)], null).regressions.length, 1);
});

test("the table says per defect found, missing or not for a script, and names the pages", () => {
  const report: Report = { ok: false, problems: [], regressions: ["1.4.12-b: weg"], improvements: [], seconds: { defect: { collect: 10 }, clean: {} }, rows: [row("1.1.1-a", true, false), row("1.4.12-b", false, true), row("1.2.1-d", null, null)] };
  const markdown = reportMarkdown(report);
  assert.match(markdown, /\| 1\.1\.1-a \| 1\.1\.1 \| gevonden \| geen bewijs \|/);
  assert.match(markdown, /\| 1\.4\.12-b \| 1\.4\.12 \| ontbreekt \(\/\) \| bewijs op \/ \|/);
  assert.match(markdown, /\| 1\.2\.1-d \| 1\.2\.1 \| niet door een script te zien \|  \|/);
  assert.match(markdown, /### Achteruit tegenover de basislijn\n\n- 1\.4\.12-b: weg/);
  assert.match(markdown, /Lindewaard: collect 10 s/);
});

test("the fixed site model is filled in per variant: addresses, the entries of one variant and the element of a step", () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-sweep-check-"));
  try {
    for (const variant of ["defect", "clean"] as const) {
      const run = join(dir, variant);
      installModel(run, variant, { site: "http://127.0.0.1:1", thirdParty: "http://127.0.0.1:2" });
      const text = readFileSync(join(run, "site.json"), "utf8");
      assert.doesNotMatch(text, /\{origin\}|\{thirdParty\}|"variants"/);
      const model = JSON.parse(text) as { pageTypes: { pages: string[] }[]; content: { id: string }[] };
      assert.deepEqual(model.pageTypes.flatMap((type) => type.pages).sort(), SWEEP_PAGES.map((path) => `http://127.0.0.1:1${path}`).sort(), "the model names exactly the pages of the check");
      assert.equal(model.content.some((entry) => entry.id === "melodie"), variant === "defect");
      for (const file of readdirSync(join(run, "recipes"))) {
        const recipe = JSON.parse(readFileSync(join(run, "recipes", file), "utf8")) as { id: string; steps: { target: unknown }[] };
        assert.match(recipe.id, /^[0-9a-f]{12}$/);
        for (const step of recipe.steps) assert.ok(step.target === null || Array.isArray(step.target), `${file}: a step names one element`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the reports of the two jobs make one table: Lindewaard from the one, Berkenveen from the other", () => {
  const lindewaard = [{ ...row("1.1.1-a", true, null), twinOn: [] }];
  const berkenveen = [{ ...row("1.1.1-a", null, false), kind: "script" as const }];
  assert.deepEqual(mergeRows([lindewaard, berkenveen]).map(({ defect, found, twin }) => ({ defect, found, twin })), [{ defect: "1.1.1-a", found: true, twin: false }]);
  // A variant that was not measured keeps what the baseline said.
  const baseline = baselineOf([row("1.1.1-a", true, true)]);
  assert.deepEqual(baselineOf(berkenveen, baseline).defects["1.1.1-a"], { found: true, twin: false });
});

test("the check serves the fixture on free ports, and with --fixed-ports on those of just testsite, so a run opens again afterwards", () => {
  assert.deepEqual(fixturePorts(false), { defect: 0, clean: 0, thirdParty: 0 });
  assert.deepEqual(fixturePorts(true), { defect: 4710, clean: 4711, thirdParty: 4712 });
  assert.deepEqual(fixturePorts(true), DEFAULT_PORTS);
});

test("--only-disruptions measures the pages of every case and of the questionnaire, with every step of the full run", () => {
  const only = sweepPlan("only-disruptions");
  const full = sweepPlan("disruptions");
  assert.deepEqual(sweepPlan("plain"), { pages: SWEEP_PAGES, steps: ["login", "inventory", "check-site", "sample", "collect", "contrast", "states", "documents"], disruptions: false, partial: false });
  assert.deepEqual(full.steps, ["login", "inventory", "check-site", "sample", "collect", "collect-again", "contrast", "states", "documents"]);
  assert.deepEqual([...full.pages].sort(), [...new Set([...SWEEP_PAGES, ...DISRUPTED_PAGES])].sort());
  assert.ok(!full.partial && full.disruptions);
  // The same steps as the full run, so that the evidence of the key on these pages is made the same way.
  assert.deepEqual(only.steps, full.steps);
  assert.equal(only.partial, true);
  assert.ok(only.pages.includes("/veelgestelde-vragen.html"), "the questionnaire of 4.1.2, which the scope of a run with disruptions once kept out");
  assert.equal(only.disruptions, true, "the cases are served, armed and checked");
  for (const disruption of DISRUPTIONS) {
    if (disruption.expected.gate) assert.ok((GATE_CHECKS as readonly string[]).includes(disruption.expected.gate.check), disruption.id);
    if (disruption.on === "site") {
      assert.ok(only.pages.includes(disruption.page), `${disruption.id}: its page is measured`);
      continue;
    }
    // A window of Kijkpunt comes along with the page of the site it is on.
    assert.ok(disruption.via && only.pages.includes(disruption.via), `${disruption.id}: the page with the window is measured`);
    for (const site of ["lindewaard", "berkenveen"]) {
      const file = disruption.via === "/" ? "index.html" : disruption.via.slice(1);
      assert.match(readFileSync(join(import.meta.dirname, "..", "fixtures", "sites", site, file), "utf8"), new RegExp(`<iframe[^>]+src="[^"]*${disruption.page}"`), `${disruption.id}: ${site}${disruption.via} embeds the window`);
    }
  }
  assert.deepEqual(only.pages.filter((page) => !DISRUPTED_PAGES.includes(page)).sort(), ["/", ...KEY_PAGES_WITH_DISRUPTIONS].sort(), "of the pages of the key the start page, for the window, and the questionnaire");
  const dir = mkdtempSync(join(tmpdir(), "loep-sweep-check-"));
  try {
    for (const variant of ["defect", "clean"] as const) {
      const run = join(dir, variant);
      installModel(run, variant, { site: "http://127.0.0.1:1", thirdParty: "http://127.0.0.1:2" }, true, only.pages);
      const model = JSON.parse(readFileSync(join(run, "site.json"), "utf8")) as { pageTypes: { id: string; representative: string; pages: string[] }[]; components: { pageTypes: string[] | string }[]; content: { pageTypes: string[] }[] };
      assert.deepEqual(model.pageTypes.flatMap((type) => type.pages).sort(), only.pages.map((path) => `http://127.0.0.1:1${path}`).sort(), "check-site wants every page of the inventory in the model, and no other");
      for (const type of model.pageTypes) assert.ok(type.pages.includes(type.representative), type.id);
      const ids = new Set(model.pageTypes.map((type) => type.id));
      for (const entry of [...model.components, ...model.content]) if (Array.isArray(entry.pageTypes)) assert.ok(entry.pageTypes.length > 0 && entry.pageTypes.every((id) => ids.has(id)), JSON.stringify(entry));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const report: Report = { ok: true, problems: [], regressions: [], improvements: [], seconds: { defect: {}, clean: {} }, rows: [row("4.1.2-vragenlijst", true, false), { ...row("1.1.1-a", null, null), kind: "script" }, row("1.2.1-d", null, null)], onlyDisruptions: true };
  assert.match(summaryLine(report), new RegExp(`elk van de ${DISRUPTIONS.length} gevallen.*Lindewaard: 1 van de 1 gebreken die een script kan zien op die pagina's staan in het dossier; 1 kan alleen een agent zien`));
});

