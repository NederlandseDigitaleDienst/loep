/**
 * The regression check of the sweep on the fixture site, without a language model.
 *
 *   node scripts/sweep-check.ts [--out <dir>] [--at-once <n>] [--variant defect|clean] [--fixed-ports] [--runs <dir>] [--update-baseline]
 *
 * --variant measures one variant only (the CI runs the two on two machines), --fixed-ports serves the
 * fixture on the ports of `just testsite` so the runs in <out>/runs stay usable as a frozen sweep,
 * --runs reads runs that were measured before instead of measuring, --from-report takes the rows of
 * earlier reports (the artefacts of the two CI jobs), --update-baseline writes what was found to the baseline.
 *
 * On both variants of the fixture site (Lindewaard with the planted defects, Berkenveen as the
 * clean twin) it runs inventory, installs the fixed site model of fixtures/sweep/, runs check-site,
 * sample, collect, contrast and states, and then looks per defect of the key whether the evidence
 * a script can see is in the dossier, at the place fixtures/evidence.ts names. On the twin the same
 * places must hold no such evidence.
 *
 * Writes sweep-check.md and sweep-check.json to --out, and fails when a defect the baseline found is
 * now missing, when the twin shows evidence the baseline did not have, or when the sweep sent
 * anything to the fixture site (a write request or a chat message).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { DEFECTS, type Defect } from "../fixtures/defects.ts";
import { EVIDENCE, isAgentOnly, type Look, type ScriptEvidence } from "../fixtures/evidence.ts";
import { DEFAULT_PORTS, type SiteKey, startFixture } from "../fixtures/serve.ts";
import { launchBrowser } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { contrast } from "../src/commands/contrast.ts";
import { checkSite } from "../src/commands/explore.ts";
import { inventory } from "../src/commands/inventory.ts";
import { sample } from "../src/commands/sample.ts";
import { states } from "../src/commands/states.ts";
import { canonicalJson, pageLabels, sha256 } from "../src/lib/canonical.ts";

const TOOLBOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = join(TOOLBOX, "fixtures", "sweep");

/**
 * The pages the check measures: every page a defect of the key is on, once. Fewer than the whole
 * site, so the check stays short; the frames on them come along by themselves. The site model in
 * fixtures/sweep/site.json names exactly these.
 */
export const SWEEP_PAGES = ["/", "/afval.html", "/contact.html", "/inloggen.html", "/nieuws/", "/nieuws/nieuwe-fietsenstalling.html", "/openingstijden.html", "/producten.html", "/raadsvergadering.html", "/veelgestelde-vragen.html", "/vergunning.html", "/zoeken.html", "/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek"];

export type Variant = "defect" | "clean";
export const VARIANTS: Variant[] = ["defect", "clean"];

/**
 * The fixed site model and its recipes for one variant, with the addresses of the fixture as it
 * runs now. The two variants share the model; where they differ, an entry of the model names the
 * variants it holds for (`variants`), and a step names its element per variant (`target.defect`
 * and `target.clean`), because the clean twin is built differently around the same controls.
 */
export function installModel(run: string, variant: Variant, origins: { site: string; thirdParty: string }): void {
  const fill = (text: string): string => text.replaceAll("{wsOrigin}", origins.site.replace(/^http/, "ws")).replaceAll("{origin}", origins.site).replaceAll("{thirdParty}", origins.thirdParty);
  const model = JSON.parse(fill(readFileSync(join(MODEL_DIR, "site.json"), "utf8"))) as Record<string, unknown>;
  for (const [key, entries] of Object.entries(model)) {
    if (!Array.isArray(entries)) continue;
    model[key] = entries
      .filter((entry: { variants?: Variant[] }) => !entry?.variants || entry.variants.includes(variant))
      .map((entry) => {
        if (entry === null || typeof entry !== "object" || !("variants" in entry)) return entry;
        const { variants: _variants, ...rest } = entry as Record<string, unknown>;
        return rest;
      });
  }
  mkdirSync(join(run, "recipes"), { recursive: true });
  writeFileSync(join(run, "site.json"), `${JSON.stringify(model, null, 2)}\n`);
  for (const file of readdirSync(join(MODEL_DIR, "recipes")).filter((name) => name.endsWith(".json"))) {
    const template = JSON.parse(fill(readFileSync(join(MODEL_DIR, "recipes", file), "utf8"))) as { name: string; start: unknown; steps: { target: string[] | Record<Variant, string[]> | null }[] };
    const { name, start } = template;
    const steps = template.steps.map((step) => ({ ...step, target: step.target === null || Array.isArray(step.target) ? step.target : step.target[variant] }));
    // The same id a session gives a saved state: a hash of where it starts and what it does.
    const id = sha256(canonicalJson({ start, steps })).slice(0, 12);
    writeFileSync(join(run, "recipes", file), `${JSON.stringify({ id, name, savedBy: "sweep-check", savedAt: "2026-10-20T00:00:00.000Z", start, steps, url: null, domSha256: null }, null, 2)}\n`);
  }
}

/**
 * The ports the fixture listens on: free ones by default, so the check never collides with anything;
 * with fixed ports those of `just testsite`, so the addresses in the runs open again afterwards.
 */
export const fixturePorts = (fixed: boolean): Record<SiteKey, number> => (fixed ? { ...DEFAULT_PORTS } : { defect: 0, clean: 0, thirdParty: 0 });

export type SweepTimes = Record<string, number>;

/** inventory, the fixed model, check-site, sample and the three steps of the sweep, on one variant. */
export async function sweepVariant(run: string, variant: Variant, origins: { site: string; thirdParty: string }, atOnce: number): Promise<{ seconds: SweepTimes; checkProblems: string[] }> {
  const seconds: SweepTimes = {};
  const timed = async <T>(name: string, step: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await step();
    } finally {
      seconds[name] = Math.round((Date.now() - started) / 1000);
    }
  };
  await timed("inventory", () => inventory({ baseUrl: `${origins.site}/`, out: run, maxPages: 50, fixedUrls: SWEEP_PAGES.map((path) => `${origins.site}${path}`) }));
  installModel(run, variant, origins);
  const check = await timed("check-site", () => checkSite(run, { navigationDelayMs: 50 }));
  if (!check.ok) return { seconds, checkProblems: check.problems };
  await timed("sample", () => sample(run, "toegankelijk"));
  await timed("collect", () => collect({ run, atOnce }));
  await timed("contrast", () => contrast(run, { atOnce }));
  await timed("states", () => states(run, { atOnce }));
  return { seconds, checkProblems: [] };
}

/** Where one defect stands after the sweep on both variants. */
export interface Row {
  defect: string;
  criterion: string;
  /** script: a script can see it, and the table says where; agent: only an agent can. */
  kind: "script" | "agent";
  whereNl: string;
  /** On Lindewaard: true when every page held the evidence; null for a defect only an agent can see, or when Lindewaard was not measured. */
  found: boolean | null;
  /** The pages that did not hold it. */
  missingOn: string[];
  /** On Berkenveen: true when the same test found evidence on one of the pages; null for a defect only an agent can see, or when Berkenveen was not measured. */
  twin: boolean | null;
  twinOn: string[];
}

interface PageMarks {
  /** Per selector: the chains of the elements it matches and of everything within them, as the dossier writes chains. */
  chains: Record<string, string[]>;
  /** Per selector: the chains of the elements around them, up to but not including the body. */
  around: Record<string, string[]>;
  /** Per selector: engine, rule and criteria of every failed node that lies on such an element. */
  failures: Record<string, { rule: string; criteria: string[] }[]>;
}

const readJsonOrNull = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** A file of a dossier: parsed when it is JSON, else its text; null when it is not there. */
const readDossierFile = (path: string): any => {
  if (path.endsWith(".json")) return readJsonOrNull(path);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * For one page of a run: which elements of the saved page are the defect elements, and which
 * failures of the engines lie on them. Read from page.html in a browser without scripts, with the
 * chains made the way the in-page library makes them.
 */
async function marksOf(browser: Browser, dir: string, selectors: string[]): Promise<PageMarks> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setContent(readFileSync(join(dir, "page.html"), "utf8"), { waitUntil: "domcontentloaded" });
    const nodes = ["light", "dark"].flatMap((scheme) =>
      ((readJsonOrNull(join(dir, `engines-${scheme}.json`))?.results ?? []) as { engine: string; rule: string; outcome: string; criteria: string[]; nodes: { target: unknown }[] }[])
        .filter((result) => result.outcome === "failed")
        .flatMap((result) => result.nodes.map((node) => ({ rule: `${result.engine}:${result.rule}`, criteria: result.criteria, target: String(Array.isArray(node.target) ? node.target[node.target.length - 1] : node.target) }))),
    );
    return await page.evaluate(
      ({ selectors, nodes }) => {
        const chainOf = (element: Element): string => {
          const parts: string[] = [];
          let node: Element | null = element;
          while (node) {
            if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
              parts.unshift(`#${CSS.escape(node.id)}`);
              break;
            }
            const current: Element = node;
            const siblings = current.parentElement ? [...current.parentElement.children].filter((sibling) => sibling.localName === current.localName) : [];
            parts.unshift(siblings.length > 1 ? `${current.localName}:nth-of-type(${siblings.indexOf(current) + 1})` : current.localName);
            node = current.parentElement;
          }
          return parts.join(" > ");
        };
        const resolve = (target: string): Element | null => {
          try {
            if (target.startsWith("/")) return document.evaluate(target.replace(/\/@[\w:-]+$/, ""), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
            return document.querySelector(target);
          } catch {
            return null;
          }
        };
        const resolved = nodes.map((node) => ({ ...node, element: resolve(node.target) }));
        const chains: Record<string, string[]> = {};
        const around: Record<string, string[]> = {};
        const failures: Record<string, { rule: string; criteria: string[] }[]> = {};
        for (const selector of selectors) {
          const matched = [...document.querySelectorAll(selector)];
          chains[selector] = [...new Set(matched.flatMap((element) => [element, ...element.querySelectorAll("*")].map(chainOf)))];
          const ancestors = (element: Element): Element[] => (element.parentElement && element.parentElement !== document.body ? [element.parentElement, ...ancestors(element.parentElement)] : []);
          around[selector] = [...new Set(matched.flatMap(ancestors).map(chainOf))];
          failures[selector] = resolved.filter((node) => node.element?.nodeType === 1 && (node.element.matches(selector) || node.element.closest(selector) !== null)).map(({ rule, criteria }) => ({ rule, criteria }));
        }
        return { chains, around, failures };
      },
      { selectors, nodes },
    );
  } finally {
    await context.close();
  }
}

/**
 * The place of a defect without what makes it a defect: the selector without its `:not(...)`
 * parts. `#naam:not([autocomplete])` is the field `#naam`, which the twin also has.
 */
export const placeOf = (selector: string): string => selector.replace(/:not\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, "").trim() || selector;

/** The pages a defect is looked for on: what the table says, else the pages of the defect, with the start page for every page. */
const pagesFor = (defect: Defect, entry: ScriptEvidence): string[] => entry.pages ?? (defect.pages[0] === "*" ? ["/"] : defect.pages.filter((page) => SWEEP_PAGES.includes(page)));

/** Path and query of an address, as defects.ts writes pages. */
const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/** Look in both runs for the evidence of every defect, as fixtures/evidence.ts says where. */
export async function evaluate(runs: Partial<Record<Variant, string>>): Promise<Row[]> {
  const byId = new Map(EVIDENCE.map((entry) => [entry.defect, entry]));
  const missing = DEFECTS.filter((defect) => !byId.has(defect.id)).map((defect) => defect.id);
  if (missing.length > 0) throw new Error(`fixtures/evidence.ts noemt deze gebreken niet: ${missing.join(", ")}`);
  const scripted = DEFECTS.map((defect) => [defect, byId.get(defect.id)!] as const).filter((pair): pair is readonly [Defect, ScriptEvidence] => !isAgentOnly(pair[1]));
  const browser = await launchBrowser();
  const marks = new Map<string, PageMarks>();
  const found: Record<Variant, Map<string, string[]>> = { defect: new Map(), clean: new Map() };
  try {
    for (const variant of VARIANTS) {
      const run = runs[variant];
      if (run === undefined) continue;
      const items = (readJsonOrNull(join(run, "sample.json"))?.items ?? []) as { url: string; slug: string; aliases?: string[] }[];
      const labels = pageLabels(items.length);
      const itemFor = (path: string) => items.find((item) => [item.url, ...(item.aliases ?? [])].some((url) => pathOf(url) === path));
      for (const [defect, entry] of scripted) {
        const hits: string[] = [];
        for (const path of pagesFor(defect, entry)) {
          const item = itemFor(path);
          if (!item) continue;
          const dir = join(run, "pages", item.slug);
          const key = `${variant} ${item.slug}`;
          if (!marks.has(key)) {
            const selectors = [...new Set(DEFECTS.flatMap((each) => [each.selector, placeOf(each.selector)]))];
            marks.set(key, existsSync(join(dir, "page.html")) ? await marksOf(browser, dir, selectors) : { chains: {}, around: {}, failures: {} });
          }
          const mark = marks.get(key)!;
          // On the twin the defect element itself is often absent: there the test looks at the same place.
          const selector = variant === "defect" ? defect.selector : placeOf(defect.selector);
          const chains = new Set(mark.chains[selector] ?? []);
          const around = new Set(mark.around[selector] ?? []);
          const chainText = (chain: unknown): string | null => (Array.isArray(chain) ? (chain.length === 1 ? String(chain[0]) : null) : typeof chain === "string" ? chain : null);
          const look: Look = {
            page: (file) => readDossierFile(join(dir, file)),
            run: (file) => readDossierFile(join(run, file)),
            url: item.url,
            label: labels[items.indexOf(item)]!,
            at: (chain) => chains.has(chainText(chain) ?? ""),
            around: (chain) => around.has(chainText(chain) ?? ""),
            failed: (criteria) => (mark.failures[selector] ?? []).filter((failure) => failure.criteria.some((criterion) => criteria.includes(criterion))).map((failure) => failure.rule),
          };
          let holds = false;
          try {
            holds = entry.found(look);
          } catch {
            holds = false;
          }
          if (holds) hits.push(path);
        }
        found[variant].set(defect.id, hits);
      }
    }
  } finally {
    await browser.close();
  }
  return DEFECTS.map((defect) => {
    const entry = byId.get(defect.id)!;
    if (isAgentOnly(entry)) return { defect: defect.id, criterion: defect.criterion, kind: "agent", whereNl: entry.agentNl, found: null, missingOn: [], twin: null, twinOn: [] };
    const pages = pagesFor(defect, entry);
    const onDefect = found.defect.get(defect.id) ?? [];
    const onTwin = found.clean.get(defect.id) ?? [];
    const measured = runs.defect !== undefined;
    return {
      defect: defect.id,
      criterion: defect.criterion,
      kind: "script",
      whereNl: entry.whereNl,
      found: measured ? pages.every((page) => onDefect.includes(page)) : null,
      missingOn: measured ? pages.filter((page) => !onDefect.includes(page)) : [],
      twin: runs.clean !== undefined ? onTwin.length > 0 : null,
      twinOn: onTwin,
    };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" }, runs: { type: "string" }, variant: { type: "string" }, "from-report": { type: "string", multiple: true }, "at-once": { type: "string", default: "1" }, "fixed-ports": { type: "boolean", default: false }, "update-baseline": { type: "boolean", default: false } } });
  const out = resolve(values.out ?? join(tmpdir(), `loep-sweep-check-${process.pid}`));
  const atOnce = Number(values["at-once"]);
  if (!Number.isInteger(atOnce) || atOnce < 1) throw new Error("--at-once is een geheel aantal pagina's, 1 of meer");
  mkdirSync(out, { recursive: true });
  const runsDir = values.runs ? resolve(values.runs) : join(out, "runs");
  if (values.variant !== undefined && !VARIANTS.includes(values.variant as Variant)) throw new Error(`--variant is ${VARIANTS.join(" of ")}`);
  // One variant on its own: the CI measures the two on two machines at the same time.
  const measured = values.variant ? [values.variant as Variant] : VARIANTS;
  const runs: Partial<Record<Variant, string>> = Object.fromEntries(measured.map((variant) => [variant, join(runsDir, variant)]));
  const seconds: Record<Variant, SweepTimes> = { defect: {}, clean: {} };
  const problems: string[] = [];
  const reports = values["from-report"] ?? [];
  if (!values.runs && reports.length === 0) {
    rmSync(runsDir, { recursive: true, force: true });
    mkdirSync(runsDir, { recursive: true });
    const fixture = await startFixture({ ports: fixturePorts(values["fixed-ports"]), logFile: join(out, "fixture-server.log") }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") throw new Error(`--fixed-ports: een van de poorten ${Object.values(DEFAULT_PORTS).join(", ")} is al in gebruik, bijvoorbeeld door just testsite; stop die eerst`);
      throw error;
    });
    try {
      // The two variants at the same time: each its own browser and run.
      await Promise.all(
        measured.map(async (variant) => {
          try {
            const result = await sweepVariant(runs[variant]!, variant, { site: fixture.origins[variant], thirdParty: fixture.origins.thirdParty }, atOnce);
            seconds[variant] = result.seconds;
            problems.push(...result.checkProblems.map((problem) => `${VARIANT_NL[variant]}: check-site: ${problem}`));
          } catch (error) {
            problems.push(`${VARIANT_NL[variant]}: ${(error as Error).message.split("\n")[0]}`);
          }
        }),
      );
      // The sweep only reads: a write request or a message over the chat socket is a failure in itself.
      for (const write of fixture.writes()) problems.push(`${{ ...VARIANT_NL, thirdParty: "Kijkpunt" }[write.site]}: de veegronde verstuurde iets naar de testsite (${write.kind} ${write.method ?? ""} ${write.path})`);
    } finally {
      await fixture.close();
    }
  }
  const rows = problems.length > 0 ? [] : reports.length > 0 ? mergeRows(reports.map((file) => (readJsonOrNull(resolve(file)) as Report | null)?.rows ?? [])) : await evaluate(runs);
  const baseline = readJsonOrNull(BASELINE) as Baseline | null;
  const outcome = compareWithBaseline(rows, baseline);
  const report: Report = { ok: problems.length === 0 && outcome.regressions.length === 0, problems, ...outcome, seconds, rows };
  writeFileSync(join(out, "sweep-check.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, "sweep-check.md"), reportMarkdown(report));
  if (values["update-baseline"] && problems.length === 0) {
    writeFileSync(BASELINE, `${JSON.stringify(baselineOf(rows, baseline), null, 2)}\n`);
    process.stdout.write(`basislijn bijgewerkt: ${BASELINE}\n`);
  }
  process.stdout.write(`${summaryLine(report)}\nTabel: ${join(out, "sweep-check.md")}\n`);
  if (!report.ok && !values["update-baseline"]) process.exitCode = 1;
}

const VARIANT_NL: Record<Variant, string> = { defect: "Lindewaard", clean: "Berkenveen" };
const BASELINE = join(MODEL_DIR, "baseline.json");

/** What the check found the last time it was accepted: per defect whether its evidence was there, and whether the twin showed evidence. */
export interface Baseline {
  noteNl: string;
  defects: Record<string, { found: boolean | null; twin: boolean | null }>;
}

export interface Report {
  ok: boolean;
  /** A step that failed, or a site model that check-site refused: then nothing was compared. */
  problems: string[];
  /** A defect whose evidence the baseline had and the dossier now lacks, or evidence on the twin the baseline did not have. */
  regressions: string[];
  /** The other way round: found now, or gone from the twin. The baseline can be brought up to date. */
  improvements: string[];
  seconds: Record<Variant, SweepTimes>;
  rows: Row[];
}

/**
 * The rows of several reports as one: Lindewaard from the report that measured it, Berkenveen from
 * the one that measured that. For the reports of the two jobs of the CI, to bring the baseline up to date.
 */
export function mergeRows(reports: Row[][]): Row[] {
  const merged = new Map<string, Row>();
  for (const row of reports.flat()) {
    const known = merged.get(row.defect);
    if (!known) merged.set(row.defect, { ...row });
    else {
      if (row.found !== null) Object.assign(known, { found: row.found, missingOn: row.missingOn });
      if (row.twin !== null) Object.assign(known, { twin: row.twin, twinOn: row.twinOn });
    }
  }
  return [...merged.values()];
}

/** The baseline after this check: what was measured now, and for a variant that was not measured what the earlier baseline said. */
export function baselineOf(rows: Row[], previous: Baseline | null = null): Baseline {
  return {
    noteNl: "Wat de regressietoets van de veegronde (just sweep-check) vond toen deze basislijn werd vastgelegd. found: het bewijs stond in het dossier van Lindewaard; twin: dezelfde toets vond iets op Berkenveen; null: alleen een agent kan het zien. Bijwerken met de uitkomst van de CI: just sweep-check --from-report (twee keer) --update-baseline, zie toolbox/fixtures/README.md.",
    defects: Object.fromEntries(
      rows.map((row) => {
        const before = previous?.defects[row.defect];
        if (row.kind === "agent") return [row.defect, { found: null, twin: null }];
        return [row.defect, { found: row.found ?? before?.found ?? null, twin: row.twin ?? before?.twin ?? null }];
      }),
    ),
  };
}

export function compareWithBaseline(rows: Row[], baseline: Baseline | null): Pick<Report, "regressions" | "improvements"> {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const row of rows) {
    const before = baseline?.defects[row.defect];
    if (row.kind === "agent") continue;
    if (before?.found === true && row.found === false) regressions.push(`${row.defect}: het bewijs stond in de basislijn in het dossier en ontbreekt nu (${row.missingOn.join(", ")})`);
    if (row.twin === true && before?.twin !== true) regressions.push(`${row.defect}: op de tweeling staat nu bewijs dat de basislijn niet had (${row.twinOn.join(", ")})`);
    if (row.found === true && before?.found !== true) improvements.push(`${row.defect}: nu gevonden, in de basislijn niet`);
    if (row.twin === false && before?.twin === true) improvements.push(`${row.defect}: op de tweeling geen bewijs meer, in de basislijn wel`);
  }
  return { regressions, improvements };
}

export function summaryLine(report: Report): string {
  if (report.problems.length > 0) return `De veegronde op de testsite kon niet worden vergeleken: ${report.problems.length} ${report.problems.length === 1 ? "probleem" : "problemen"}.`;
  const scripted = report.rows.filter((row) => row.kind === "script");
  const found = scripted.filter((row) => row.found).length;
  const twin = scripted.filter((row) => row.twin).length;
  const defect = scripted.some((row) => row.found !== null) ? `Lindewaard: ${found} van de ${scripted.length} gebreken die een script kan zien staan in het dossier; ${report.rows.length - scripted.length} kan alleen een agent zien.` : "Lindewaard is niet gemeten.";
  const clean = scripted.some((row) => row.twin !== null) ? `Berkenveen: ${twin === 0 ? "geen bewijs op de plekken van de gebreken" : `bewijs bij ${twin} gebreken`}.` : "Berkenveen is niet gemeten.";
  return `${defect} ${clean} ${report.regressions.length === 0 ? "Geen achteruitgang tegenover de basislijn." : `${report.regressions.length} keer achteruit tegenover de basislijn.`}`;
}

const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export function reportMarkdown(report: Report): string {
  const lines = ["## Regressietoets van de veegronde op de testsite", "", summaryLine(report), ""];
  if (report.problems.length > 0) lines.push("### Problemen", "", ...report.problems.map((problem) => `- ${cell(problem)}`), "");
  if (report.regressions.length > 0) lines.push("### Achteruit tegenover de basislijn", "", ...report.regressions.map((line) => `- ${cell(line)}`), "");
  if (report.improvements.length > 0) lines.push("### Beter dan de basislijn", "", "Werk de basislijn bij met de uitkomst van de CI: `just sweep-check --from-report <lindewaard>/sweep-check.json --from-report <berkenveen>/sweep-check.json --update-baseline` (zie toolbox/fixtures/README.md).", "", ...report.improvements.map((line) => `- ${cell(line)}`), "");
  const times = VARIANTS.filter((variant) => Object.keys(report.seconds[variant]).length > 0).map((variant) => `${VARIANT_NL[variant]}: ${Object.entries(report.seconds[variant]).map(([step, value]) => `${step} ${value} s`).join(", ")}`);
  if (times.length > 0) lines.push(`Duur per stap. ${times.join(". ")}.`, "");
  if (report.rows.length > 0) {
    lines.push("| Gebrek | Criterium | Lindewaard | Berkenveen | Waar in het dossier |", "|---|---|---|---|---|");
    for (const row of report.rows) {
      const defect = row.kind === "agent" ? "niet door een script te zien" : row.found === null ? "niet gemeten" : row.found ? "gevonden" : `ontbreekt${row.missingOn.length > 0 ? ` (${row.missingOn.join(", ")})` : ""}`;
      const twin = row.kind === "agent" ? "" : row.twin === null ? "niet gemeten" : row.twin ? `bewijs op ${row.twinOn.join(", ")}` : "geen bewijs";
      lines.push(`| ${row.defect} | ${row.criterion} | ${defect} | ${twin} | ${cell(row.whereNl)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
