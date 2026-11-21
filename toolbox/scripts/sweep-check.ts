/**
 * The regression check of the sweep on the fixture site, without a language model.
 *
 *   node scripts/sweep-check.ts [--out <dir>] [--at-once <n>] [--variant defect|clean] [--fixed-ports] [--allow-writes [--max-writes <n>]] [--disruptions | --only-disruptions] [--runs <dir>] [--update-baseline]
 *
 * --variant measures one variant only (the CI runs the two on two machines), --fixed-ports serves the
 * fixture on the ports of `just testsite` so the runs in <out>/runs stay usable as a frozen sweep,
 * --allow-writes makes each inventory as a measurement with permission to send makes it: to the site of the variant
 * and to Kijkpunt as a local test environment, each with a budget of its own (--max-writes, default 50 each), so the
 * form probe of the sweep really sends,
 * --runs reads runs that were measured before instead of measuring, --from-report takes the rows of
 * earlier reports (the artefacts of the two CI jobs), --update-baseline writes what was found to the baseline.
 * --disruptions serves the disruptions of fixtures/disruptions.ts, measures their pages too, as the command
 * line does (with the scope and the blockade of the run), and checks the outcome each case should have.
 * --only-disruptions measures only the pages the cases need (see sweepPlan), with every step and the same scope,
 * login and blockade as --disruptions, and checks the cases and the key on those pages only.
 *
 * On both variants of the fixture site (Lindewaard with the planted defects, Berkenveen as the
 * clean twin) it runs inventory, installs the fixed site model of fixtures/sweep/, runs check-site,
 * sample, collect, contrast, states and documents, and then looks per defect of the key whether the evidence
 * a script can see is in the dossier, at the place fixtures/evidence.ts names. On the twin the same
 * places must hold no such evidence. Each variant is measured logged in with the account of the
 * fixture (fixtures/login.ts), one after the other: a process holds the login of one run at a time.
 *
 * Writes sweep-check.md and sweep-check.json to --out, and fails when a defect the baseline found is
 * now missing, when the twin shows evidence the baseline did not have, when the sweep sent
 * anything to the fixture site (a write request or a chat message) that the permission of the run does not account for
 * (without --allow-writes: anything at all), or when it logged out.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Browser } from "playwright";
import { DEFECTS, type Defect } from "../fixtures/defects.ts";
import { entriesIn, logInOn, typeAccountKeepNotice } from "../fixtures/login.ts";
import { EVIDENCE, isAgentOnly, type Look, type ScriptEvidence } from "../fixtures/evidence.ts";
import { DEFAULT_PORTS, defaultOrigin, type LogEntry, type SiteKey, startFixture } from "../fixtures/serve.ts";
import { DISRUPTED_PAGES, DISRUPTIONS, GATE_CHECKS } from "../fixtures/disruptions.ts";
import { readBlockades, setRunBlockade } from "../src/session/blockade.ts";
import { setRunScope } from "../src/session/safety.ts";
import { launchBrowser } from "../src/browser/session.ts";
import { collect } from "../src/commands/collect.ts";
import { contrast } from "../src/commands/contrast.ts";
import { documents } from "../src/commands/documents.ts";
import { checkSite } from "../src/commands/explore.ts";
import { inventory } from "../src/commands/inventory.ts";
import { sample } from "../src/commands/sample.ts";
import { states } from "../src/commands/states.ts";
import { canonicalJson, pageLabels, sha256 } from "../src/lib/canonical.ts";
import { setRunLogin } from "../src/lib/login.ts";
import { EXTRA_FIXED_READS_ENV, EXTRA_FIXED_READS_FILE, setFixedReads } from "../src/lib/reads.ts";
import { decideWrites, recordWrites, setRunWrites, WRITES_LOG, writeAccess, writeOriginsOf, type PassedWrite, type WritePermission } from "../src/lib/writes.ts";

const TOOLBOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = join(TOOLBOX, "fixtures", "sweep");

/**
 * The pages the check measures: every page a defect of the key is on, once. Fewer than the whole
 * site, so the check stays short; the frames on them come along by themselves. The site model in
 * fixtures/sweep/site.json names exactly these.
 */
export const SWEEP_PAGES = ["/", "/afval.html", "/contact.html", "/inloggen.html", "/nieuws/", "/nieuws/nieuwe-fietsenstalling.html", "/openingstijden.html", "/producten.html", "/raadsvergadering.html", "/veelgestelde-vragen.html", "/vergunning.html", "/zoeken.html", "/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek", "/mijn/", "/mijn/aanvragen.html", "/mijn/gegevens.html"];

export type Variant = "defect" | "clean";
export const VARIANTS: Variant[] = ["defect", "clean"];

/** The pages of the site the cases of fixtures/disruptions.ts are on: their own, and for a window of Kijkpunt the page it is embedded in. */
export const DISRUPTION_CASE_PAGES = [...new Set(DISRUPTIONS.map((entry) => (entry.on === "site" ? entry.page : entry.via!)))];

/**
 * Pages of the key that --only-disruptions measures as well. The questionnaire on the page with questions comes with a
 * POST that only the fixed read rule lets through, and the scope of a run with disruptions once kept it out: the fast
 * check has to see that. The regional block on the page with opening hours is a GET to the other party that the same scope decides.
 */
export const KEY_PAGES_WITH_DISRUPTIONS = ["/veelgestelde-vragen.html", "/openingstijden.html"];

export type SweepStep = "login" | "inventory" | "check-site" | "sample" | "collect" | "collect-again" | "contrast" | "states" | "documents";
export type SweepMode = "plain" | "disruptions" | "only-disruptions";

/** What one variant measures and what the check then looks at. */
export interface SweepPlan {
  /** The fixed list of the inventory, and the pages the site model keeps. */
  pages: string[];
  steps: SweepStep[];
  /** Serve and arm the disruptions, measure with the scope and the blockade of the run, and check each case. */
  disruptions: boolean;
  /** Look for the evidence of the key on `pages` and compare it with the baseline; false: on every page, and the baseline can be written. */
  partial: boolean;
}

const STEPS: SweepStep[] = ["login", "inventory", "check-site", "sample", "collect", "contrast", "states", "documents"];

/**
 * The plan of a mode. Without disruptions the pages of the key and every step. With --disruptions their pages
 * as well, and collect twice. With --only-disruptions the same steps on the pages of the cases and of
 * KEY_PAGES_WITH_DISRUPTIONS only: every step, so that the evidence of the key on those pages is there as in the full run.
 */
export function sweepPlan(mode: SweepMode = "plain"): SweepPlan {
  const again = (steps: SweepStep[]): SweepStep[] => steps.flatMap((step) => (step === "collect" ? ["collect", "collect-again"] : [step]));
  if (mode === "plain") return { pages: SWEEP_PAGES, steps: STEPS, disruptions: false, partial: false };
  if (mode === "disruptions") return { pages: [...new Set([...SWEEP_PAGES, ...DISRUPTED_PAGES])], steps: again(STEPS), disruptions: true, partial: false };
  return { pages: [...new Set([...DISRUPTION_CASE_PAGES, ...KEY_PAGES_WITH_DISRUPTIONS])], steps: again(STEPS), disruptions: true, partial: true };
}

/**
 * The fixed site model and its recipes for one variant, with the addresses of the fixture as it
 * runs now. The two variants share the model; where they differ, an entry of the model names the
 * variants it holds for (`variants`), and a step names its element per variant (`target.defect`
 * and `target.clean`), because the clean twin is built differently around the same controls.
 */
export function installModel(run: string, variant: Variant, origins: { site: string; thirdParty: string }, disruptions = false, only?: string[]): void {
  const fill = (text: string): string => text.replaceAll("{wsOrigin}", origins.site.replace(/^http/, "ws")).replaceAll("{origin}", origins.site).replaceAll("{thirdParty}", origins.thirdParty);
  const model = JSON.parse(fill(readFileSync(join(MODEL_DIR, "site.json"), "utf8"))) as Record<string, unknown>;
  // With disruptions the model has the page types of their pages as well.
  if (disruptions) (model.pageTypes as unknown[]).push(...(JSON.parse(fill(readFileSync(join(MODEL_DIR, "disruptions.json"), "utf8"))) as { pageTypes: unknown[] }).pageTypes);
  // With fewer pages the model keeps only those, and the parts on the page types that are left: check-site wants every page of the model in the inventory.
  if (only) {
    const keep = new Set(only.map((path) => `${origins.site}${path}`));
    const types = (model.pageTypes as { id: string; representative: string; pages: string[] }[])
      .map((type) => ({ ...type, pages: type.pages.filter((page) => keep.has(page)) }))
      .filter((type) => type.pages.length > 0)
      .map((type) => (type.pages.includes(type.representative) ? type : { ...type, representative: type.pages[0]! }));
    const ids = new Set(types.map((type) => type.id));
    model.pageTypes = types;
    for (const key of ["components", "content"]) {
      model[key] = (model[key] as { pageTypes: string[] | string }[])
        .filter((entry) => !Array.isArray(entry.pageTypes) || entry.pageTypes.some((id) => ids.has(id)))
        .map((entry) => (Array.isArray(entry.pageTypes) ? { ...entry, pageTypes: entry.pageTypes.filter((id) => ids.has(id)) } : entry));
    }
  }
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

/**
 * How long the login of the check lasts on its server. Far longer than the half hour of the fixture: at one page
 * at a time a variant takes more than that, and the check is about the sweep, not about a session that ran out.
 */
export const CHECK_SESSION_SECONDS = 6 * 3600;

/**
 * The fixed read rules of the test server (fixtures/fixed-reads.json) with the address of the third party as it runs
 * now, written to `dir` and given to this process with LOEP_EXTRA_FIXED_READS. Each run gets a copy as well
 * (EXTRA_FIXED_READS_FILE), so a measurement on it uses them without the variable.
 */
export function useFixtureReads(dir: string, thirdParty: string): string {
  const path = join(dir, "fixed-reads.json");
  writeFileSync(path, readFileSync(join(TOOLBOX, "fixtures", "fixed-reads.json"), "utf8").replaceAll(defaultOrigin("thirdParty"), thirdParty));
  process.env[EXTRA_FIXED_READS_ENV] = path;
  setFixedReads(null);
  return path;
}

export type SweepTimes = Record<string, number>;

/**
 * The permission of a run of the sweep made for a measurement (--allow-writes): the site of the variant and
 * Kijkpunt, both on this machine, each with the local rules and a budget of its own, as
 * `inventory <site> --allow-writes --test-environment <kijkpunt> [--max-writes <n>]` gives it.
 */
export const sweepWrites = (origins: { site: string; thirdParty: string }, maxWrites?: string): WritePermission => decideWrites(`${origins.site}/`, { allowWrites: true, testEnvironment: origins.thirdParty, maxWrites })!;

/**
 * The steps of the plan on one variant: a login with the account of the fixture, inventory, the fixed model, check-site, sample, the steps of the sweep and documents.
 * With `writes` each step may send as the command line lets it in a run with that permission, and the manifest holds it.
 */
export async function sweepVariant(run: string, variant: Variant, origins: { site: string; thirdParty: string }, atOnce: number, plan: SweepPlan, disruptions?: { arm: (variant: Variant) => void }, writes: WritePermission | null = null): Promise<{ seconds: SweepTimes; checkProblems: string[] }> {
  const seconds: SweepTimes = {};
  const timed = async (name: SweepStep, step: () => Promise<unknown>): Promise<void> => {
    if (!plan.steps.includes(name)) return;
    // As the command line does per command: the writes of a step are logged under its name.
    if (writes) setRunWrites(writeAccess(run, writes, name));
    const started = Date.now();
    try {
      await step();
    } finally {
      seconds[name] = Math.round((Date.now() - started) / 1000);
    }
  };
  await timed("login", () => logInOn(origins.site, { run }, typeAccountKeepNotice));
  setRunLogin(run, writes ? { writes } : undefined);
  try {
    await timed("inventory", () => inventory({ baseUrl: `${origins.site}/`, out: run, maxPages: 50, fixedUrls: plan.pages.map((path) => `${origins.site}${path}`) }));
    if (writes) await recordWrites(run, writes);
    installModel(run, variant, origins, disruptions !== undefined, plan.pages);
    // As the command line has it for a command of the sweep: what did not arrive is noted, and a 429 is waited out.
    if (disruptions) {
      setRunScope(run);
      setRunBlockade(run);
    }
    let checkProblems: string[] = [];
    await timed("check-site", async () => {
      const check = await checkSite(run, { navigationDelayMs: 50 });
      if (!check.ok) checkProblems = check.problems;
    });
    if (checkProblems.length > 0) return { seconds, checkProblems };
    await timed("sample", () => sample(run, "toegankelijk"));
    disruptions?.arm(variant);
    await timed("collect", () => collect({ run, atOnce }));
    // The one more try for a page that missed a stylesheet, as the gate sends a run back to the sweep for it.
    await timed("collect-again", () => collect({ run, atOnce }));
    await timed("contrast", () => contrast(run, { atOnce }));
    await timed("states", () => states(run, { atOnce }));
    await timed("documents", () => documents(run));
    return { seconds, checkProblems: [] };
  } finally {
    setRunLogin(null);
    setRunWrites(null);
    // The next variant starts with its inventory: a 429 there belongs to its own run, not to this one.
    if (disruptions) {
      setRunScope(null);
      setRunBlockade(null);
    }
  }
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

/** The pages a defect is looked for on: what the table says, else the pages of the defect, with the start page for every page; of those, the ones measured. */
const pagesFor = (defect: Defect, entry: ScriptEvidence, measured: string[] = SWEEP_PAGES): string[] => (entry.pages ?? (defect.pages[0] === "*" ? ["/"] : defect.pages.filter((page) => SWEEP_PAGES.includes(page)))).filter((page) => measured.includes(page));

/** Path and query of an address, as defects.ts writes pages. */
const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/**
 * Look in both runs for the evidence of every defect, as fixtures/evidence.ts says where. With fewer pages measured
 * a defect is looked for on those of its pages only, and a defect on none of them is not measured (null).
 */
export async function evaluate(runs: Partial<Record<Variant, string>>, measuredPages: string[] = SWEEP_PAGES): Promise<Row[]> {
  const byId = new Map(EVIDENCE.map((entry) => [entry.defect, entry]));
  const missing = DEFECTS.filter((defect) => !byId.has(defect.id)).map((defect) => defect.id);
  if (missing.length > 0) throw new Error(`fixtures/evidence.ts noemt deze gebreken niet: ${missing.join(", ")}`);
  const scripted = DEFECTS.map((defect) => [defect, byId.get(defect.id)!] as const).filter((pair): pair is readonly [Defect, ScriptEvidence] => !isAgentOnly(pair[1]));
  // Started for the first page with a dossier: runs without pages (as in a test) need no browser.
  let browser: Browser | null = null;
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
        for (const path of pagesFor(defect, entry, measuredPages)) {
          const item = itemFor(path);
          if (!item) continue;
          const dir = join(run, "pages", item.slug);
          const key = `${variant} ${item.slug}`;
          if (!marks.has(key)) {
            const selectors = [...new Set(DEFECTS.flatMap((each) => [each.selector, placeOf(each.selector)]))];
            marks.set(key, existsSync(join(dir, "page.html")) ? await marksOf((browser ??= await launchBrowser()), dir, selectors) : { chains: {}, around: {}, failures: {} });
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
    await browser?.close();
  }
  return DEFECTS.map((defect) => {
    const entry = byId.get(defect.id)!;
    if (isAgentOnly(entry)) return { defect: defect.id, criterion: defect.criterion, kind: "agent", whereNl: entry.agentNl, found: null, missingOn: [], twin: null, twinOn: [] };
    const pages = pagesFor(defect, entry, measuredPages);
    const onDefect = found.defect.get(defect.id) ?? [];
    const onTwin = found.clean.get(defect.id) ?? [];
    const measured = runs.defect !== undefined && pages.length > 0;
    return {
      defect: defect.id,
      criterion: defect.criterion,
      kind: "script",
      whereNl: entry.whereNl,
      found: measured ? pages.every((page) => onDefect.includes(page)) : null,
      missingOn: measured ? pages.filter((page) => !onDefect.includes(page)) : [],
      twin: runs.clean !== undefined && pages.length > 0 ? onTwin.length > 0 : null,
      twinOn: onTwin,
    };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" }, runs: { type: "string" }, variant: { type: "string" }, "from-report": { type: "string", multiple: true }, "at-once": { type: "string", default: "1" }, "fixed-ports": { type: "boolean", default: false }, "allow-writes": { type: "boolean", default: false }, "max-writes": { type: "string" }, disruptions: { type: "boolean", default: false }, "only-disruptions": { type: "boolean", default: false }, "update-baseline": { type: "boolean", default: false } } });
  const out = resolve(values.out ?? join(tmpdir(), `loep-sweep-check-${process.pid}`));
  const atOnce = Number(values["at-once"]);
  if (!Number.isInteger(atOnce) || atOnce < 1) throw new Error("--at-once is een geheel aantal pagina's, 1 of meer");
  const plan = sweepPlan(values["only-disruptions"] ? "only-disruptions" : values.disruptions ? "disruptions" : "plain");
  if (values["max-writes"] !== undefined && !values["allow-writes"]) throw new Error("--max-writes hoort bij --allow-writes");
  if (plan.partial && (values["update-baseline"] || values["from-report"])) throw new Error("--only-disruptions meet maar een deel van de pagina's en kan de basislijn dus niet bijwerken; laat --update-baseline en --from-report weg");
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
    const fixture = await startFixture({ ports: fixturePorts(values["fixed-ports"]), logFile: join(out, "fixture-server.log"), sessionSeconds: CHECK_SESSION_SECONDS, ...(plan.disruptions ? { disruptions: { armed: false } } : {}) }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") throw new Error(`--fixed-ports: een van de poorten ${Object.values(DEFAULT_PORTS).join(", ")} is al in gebruik, bijvoorbeeld door just testsite; stop die eerst`);
      throw error;
    });
    try {
      // One variant after the other: the login of a run holds for the whole process.
      const extraReads = useFixtureReads(out, fixture.origins.thirdParty);
      for (const variant of measured) {
        try {
          const origins = { site: fixture.origins[variant], thirdParty: fixture.origins.thirdParty };
          const result = await sweepVariant(runs[variant]!, variant, origins, atOnce, plan, fixture.disruptions ?? undefined, values["allow-writes"] ? sweepWrites(origins, values["max-writes"]) : null);
          copyFileSync(extraReads, join(runs[variant]!, EXTRA_FIXED_READS_FILE));
          seconds[variant] = result.seconds;
          problems.push(...result.checkProblems.map((problem) => `${VARIANT_NL[variant]}: check-site: ${problem}`));
        } catch (error) {
          problems.push(`${VARIANT_NL[variant]}: ${(error as Error).message.split("\n")[0]}`);
        }
      }
      // The sweep only reads: a write request or a message over the chat socket is a failure in itself.
      // A login is not counted as sent: the check logs in once per variant, so any further one is the sweep sending the account.
      for (const variant of measured) {
        const logins = entriesIn(fixture.logFile, "login").filter((entry) => entry.site === variant).length;
        if (logins > 1) problems.push(`${VARIANT_NL[variant]}: er is ${logins} keer ingelogd op de testsite; alleen de toets logt in, één keer per variant`);
      }
      if (fixture.logouts() > 0) problems.push(`de veegronde logde ${fixture.logouts()} keer uit op de testsite; de drempel is 0`);
      problems.push(...writesOutsidePermission(fixture.writes(), fixture.origins, Object.values(runs)));
    } finally {
      await fixture.close();
    }
  }
  // With disruptions every case has to come out as fixtures/disruptions.ts says, also in runs that are read again.
  if (plan.disruptions && reports.length === 0 && problems.length === 0) for (const variant of measured) problems.push(...(await disruptionProblems(runs[variant]!)).map((problem) => `${VARIANT_NL[variant]}: ${problem}`));
  const rows = problems.length > 0 ? [] : reports.length > 0 ? mergeRows(reports.map((file) => (readJsonOrNull(resolve(file)) as Report | null)?.rows ?? [])) : await evaluate(runs, plan.pages);
  const baseline = readJsonOrNull(BASELINE) as Baseline | null;
  const outcome = compareWithBaseline(rows, baseline);
  const report: Report = { ok: problems.length === 0 && outcome.regressions.length === 0, problems, ...outcome, seconds, rows, ...(plan.partial ? { onlyDisruptions: true } : {}) };
  writeFileSync(join(out, "sweep-check.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, "sweep-check.md"), reportMarkdown(report));
  if (values["update-baseline"] && problems.length === 0) {
    writeFileSync(BASELINE, `${JSON.stringify(baselineOf(rows, baseline), null, 2)}\n`);
    process.stdout.write(`basislijn bijgewerkt: ${BASELINE}\n`);
  }
  process.stdout.write(`${summaryLine(report)}\nTabel: ${join(out, "sweep-check.md")}\n`);
  if (!report.ok && !values["update-baseline"]) process.exitCode = 1;
}

/**
 * Where a run with disruptions differs from what fixtures/disruptions.ts says each case should come to:
 * whether the page was measured, what its facts say about the stylesheet, what the gate makes of it, and
 * what blockades.json holds. Empty when every case came out as it should.
 */
export async function disruptionProblems(run: string): Promise<string[]> {
  const { gateChecks } = await import("../src/commands/gate.ts");
  const { loadRun } = await import("../src/lib/rundata.ts");
  const items = (readJsonOrNull(join(run, "sample.json"))?.items ?? []) as { id: string; url: string; slug: string }[];
  const checked = gateChecks(await loadRun(run));
  const blockades = readBlockades(run);
  const problems: string[] = [];
  if (blockades.some((entry) => entry.until === null || entry.reason !== "429")) problems.push(`blockades.json heeft een vermelding die de veegronde laat stoppen of pauzeren na storingen: ${JSON.stringify(blockades)}`);
  for (const disruption of DISRUPTIONS) {
    const say = (text: string): number => problems.push(`${disruption.id} (${disruption.page}): ${text}`);
    const thirdParty = disruption.on === "thirdParty";
    const item = items.find((entry) => pathOf(entry.url) === disruption.page && (new URL(entry.url).origin === new URL(items[0]!.url).origin) !== thirdParty);
    if (!item) {
      say("niet in de steekproef");
      continue;
    }
    const facts = readJsonOrNull(join(run, "pages", item.slug, "facts.json")) as { collectError?: string; notLoaded?: unknown[]; notLoadedAgain?: boolean } | null;
    if (disruption.expected.measured && (!facts || facts.collectError)) say(`niet gemeten${facts?.collectError ? `: ${facts.collectError}` : ""}`);
    const notLoaded = !facts?.notLoaded ? "none" : facts.notLoadedAgain ? "again" : "once";
    if (notLoaded !== disruption.expected.notLoaded) say(`facts.json zegt over de stylesheet "${notLoaded}", verwacht "${disruption.expected.notLoaded}"`);
    const said = [...checked.gaps.map((gap) => ({ gap, as: "gap" })), ...checked.limitations.map((gap) => ({ gap, as: "limitation" }))]
      .filter(({ gap }) => gap.url === item.url && (GATE_CHECKS as readonly string[]).includes(gap.check))
      .map(({ gap, as }) => `${gap.check} ${as}`);
    const expectedGate = disruption.expected.gate ? [`${disruption.expected.gate.check} ${disruption.expected.gate.as}`] : [];
    if (said.join(", ") !== expectedGate.join(", ")) say(`de poort zegt "${said.join(", ") || "niets"}", verwacht "${expectedGate.join(", ") || "niets"}"`);
    const own = blockades.filter((entry) => pathOf(entry.url) === disruption.page);
    const blockade = own.length === 0 ? "none" : own.length === 1 && own[0]!.reason === "429" && own[0]!.until !== null ? "429-paused" : JSON.stringify(own);
    if (blockade !== disruption.expected.blockade) say(`blockades.json geeft "${blockade}", verwacht "${disruption.expected.blockade}"`);
    // Past the robot check the window shows what it shows without it.
    if (thirdParty) {
      const tree = readDossierFile(join(run, "pages", item.slug, "aria.yaml")) as string | null;
      if (!tree?.includes("Ik ben geen robot")) say("het venster toont na de controle niet het vinkje");
    }
  }
  return problems;
}

const VARIANT_NL: Record<Variant, string> = { defect: "Lindewaard", clean: "Berkenveen" };

/**
 * What the fixture received that no run may account for. A run without permission accounts for nothing; a run
 * made with --allow-writes accounts for what its boundary let through, by origin, as writes.jsonl logs it. Each
 * line there is one request or frame that reached the fixture, so more received than logged was sent past the permission.
 */
export function writesOutsidePermission(received: LogEntry[], origins: Record<SiteKey, string>, runs: string[]): string[] {
  const logged = new Map<string, number>();
  for (const run of runs) {
    const permission = readJsonOrNull(join(run, "manifest.json"))?.writes as WritePermission | undefined;
    if (!permission || !existsSync(join(run, WRITES_LOG))) continue;
    const lines = readFileSync(join(run, WRITES_LOG), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as PassedWrite);
    // A registration of its own is no request; a frame over a socket is counted by the http(s) twin of its address.
    for (const line of lines.filter((entry) => entry.method !== "REGISTER")) {
      const origin = (line.origin ?? permission.origin).replace(/^ws(s?):/, "http$1:");
      if (!writeOriginsOf(permission).includes(origin)) continue;
      logged.set(origin, (logged.get(origin) ?? 0) + 1);
    }
  }
  const problems: string[] = [];
  for (const write of received) {
    const origin = origins[write.site];
    const left = logged.get(origin) ?? 0;
    if (left > 0) {
      logged.set(origin, left - 1);
      continue;
    }
    problems.push(`${{ ...VARIANT_NL, thirdParty: "Kijkpunt" }[write.site]}: de veegronde verstuurde iets naar de testsite${runs.some((run) => readJsonOrNull(join(run, "manifest.json"))?.writes) ? " buiten de toestemming van de run" : ""} (${write.kind} ${write.method ?? ""} ${write.path})`);
  }
  return problems;
}
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
  /** Measured with --only-disruptions: the cases were checked, and the key on their pages only. */
  onlyDisruptions?: true;
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
  // With --only-disruptions every case came out as it should, or there would be a problem; the key counts on the pages measured.
  const only = report.onlyDisruptions ? `Alleen de pagina's van de storingen zijn gemeten, en elk van de ${DISRUPTIONS.length} gevallen kwam uit zoals toolbox/fixtures/disruptions.ts zegt. ` : "";
  const scripted = report.rows.filter((row) => row.kind === "script" && (!report.onlyDisruptions || row.found !== null || row.twin !== null));
  const found = scripted.filter((row) => row.found).length;
  const twin = scripted.filter((row) => row.twin).length;
  const defect = scripted.some((row) => row.found !== null) ? `Lindewaard: ${found} van de ${scripted.length} gebreken die een script kan zien${report.onlyDisruptions ? " op die pagina's" : ""} staan in het dossier; ${report.rows.filter((row) => row.kind === "agent").length} kan alleen een agent zien.` : "Lindewaard is niet gemeten.";
  const clean = scripted.some((row) => row.twin !== null) ? `Berkenveen: ${twin === 0 ? "geen bewijs op de plekken van de gebreken" : `bewijs bij ${twin} gebreken`}.` : "Berkenveen is niet gemeten.";
  return `${only}${defect} ${clean} ${report.regressions.length === 0 ? "Geen achteruitgang tegenover de basislijn." : `${report.regressions.length} keer achteruit tegenover de basislijn.`}`;
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
