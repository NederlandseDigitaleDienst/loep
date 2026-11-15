/**
 * `quick`: a measurement of a few minutes without a language model. It runs the steps of loep
 * that need no site model (inventory, sample, and in one session per page the rule engines in
 * light and dark, reflow and zoom) and writes what they point at per criterion.
 *
 * It stands apart from an evaluation. The inventory is kept small and nothing closes a banner,
 * so the run is marked (`quick.json`) and `explore` refuses it: an evaluation starts in a folder
 * of its own. Every step is the command a person would give, started as a process of its own, so
 * the safety of a session (nothing sent, the scope, the pace) holds here as it does there.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { stepStart, writeManifest } from "../lib/manifest.ts";
import { buildQuickSummary, compareQuick, confirmComparison, groupedChangesNl, pagePath, QUICK_MARK_FILE, QUICK_SCHEMES, quickComparisonMarkdown, quickSummaryMarkdown, coveringLayers, mediaProbe, orderProbe, spacingProbe, tabProbe, type LayoutAnswer, type QuickProbeFinding, type QuickComparison, type QuickMeasurement, type QuickPage, type QuickScheme, type QuickSummary, type RulesResult } from "../lib/quick.ts";
import { isOwnAddress, siteOrigins, type OriginSource } from "../lib/origins.ts";
import { readObservation } from "../session/observations.ts";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const SESSION = "quick";
/** Per page: open, look, rules, order, media, taborder, reflow, zoom and spacing in light; open and rules in dark. */
const COMMANDS_PER_PAGE = 11;
/** The Tab walk stops here: a page with hundreds of links would take minutes, and the first stops are the header and the menu every page has. */
const MAX_TAB_STOPS = 60;
const SPARE_COMMANDS = 10;
const MINUTES_PER_PAGE = 4;
const RETRY_DELAY_MS = 2_000;

export interface QuickOptions {
  /** The start address, for a new run. */
  url?: string | undefined;
  /** The run folder: new with `url`, or one that already has an inventory and a sample. */
  run: string;
  maxPages: number;
  /** A file with addresses, one per line. With `url`: exactly these pages, no sample. With a run that is there: only these of its sample. */
  urlsFile?: string | undefined;
  /** The summary.json of an earlier measurement to hold this one against. */
  baseline?: string | undefined;
  /** Count what only one engine reports as worse too. */
  strict?: boolean | undefined;
  /** Selectors of what to click after opening a page, such as the button that closes a cookie banner. One that is not there is passed by. */
  dismiss?: readonly string[] | undefined;
  /** For tests: runs a command of loep and gives what it printed. */
  loep?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  say?: (line: string) => void;
}

function runLoep(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function lastJsonLine(text: string): Record<string, unknown> | null {
  for (const line of text.trim().split("\n").reverse()) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch {
      // Not the line with the answer.
    }
  }
  return null;
}

const lastLine = (text: string): string => (text.trim().split("\n").filter(Boolean).at(-1) ?? "").replace(/^loep: /, "").slice(0, 500);

/** Whether a run was made by `quick`. */
export const isQuickRun = (runDir: string): boolean => existsSync(join(runDir, QUICK_MARK_FILE));

export async function quick(options: QuickOptions): Promise<{ summary: QuickSummary; comparison: QuickComparison | null }> {
  const startedAt = stepStart();
  const loep = options.loep ?? runLoep;
  const say = options.say ?? ((line: string) => void process.stderr.write(`quick: ${line}\n`));
  const run = options.run;
  const step = async (args: string[], whatNl: string): Promise<void> => {
    const result = await loep(args);
    if (result.code !== 0) throw new Error(`${whatNl} is mislukt: ${lastLine(result.stderr) || lastLine(result.stdout)}`);
  };

  if (options.url) {
    if (existsSync(join(run, "inventory.json"))) throw new Error(`${run} heeft al een inventaris; geef een nieuwe map op, of meet deze run met: quick --run ${run}`);
    say(`pagina's zoeken op ${options.url}, hooguit ${options.maxPages}`);
    // With a fixed list the pages are the same every time, which a comparison in a pipeline needs.
    await step(["inventory", options.url, "--out", run, "--max-pages", String(options.maxPages), ...(options.urlsFile ? ["--urls", options.urlsFile] : [])], "inventory");
    await step(["sample", "--run", run], "sample");
  } else {
    if (!existsSync(join(run, "sample.json"))) throw new Error(`${run} heeft geen steekproef; geef een adres op: quick <url> --out <run>`);
    // A run with a site model belongs to an evaluation: a quick measurement in it would leave observations there that no one judged.
    if (existsSync(join(run, "site.json"))) throw new Error(`${run} heeft een sitemodel en is dus van een onderzoek; een snelle meting krijgt een eigen map: quick <url> --out <run>`);
  }
  await writeJson(join(run, QUICK_MARK_FILE), { kind: "quick", startedAt, maxPages: options.maxPages });

  const inventory = await readJson<OriginSource & { baseUrl?: string; pages?: unknown[]; skipped?: { reason: string }[] }>(join(run, "inventory.json"));
  const sample = await readJson<{ items: { url: string }[] }>(join(run, "sample.json"));
  const only = !options.url && options.urlsFile ? readOnlyFile(options.urlsFile) : null;
  // A sample also holds the windows a page embeds from someone else. An evaluation drops them once the site model names them; here the origin decides.
  const own = siteOrigins(inventory);
  const urls = sample.items.map((item) => item.url).filter((url) => isOwnAddress(url, own) && (!only || only.includes(url)));
  if (urls.length === 0) throw new Error("de steekproef heeft geen pagina om te meten");

  const session = async (args: string[]): Promise<Record<string, unknown>> => {
    const result = await loep(["session", ...args, "--run", run, "--session", SESSION]);
    const answer = lastJsonLine(result.stdout);
    if (!answer) return { error: lastLine(result.stderr) || `session ${args[0]} gaf geen antwoord` };
    return answer;
  };

  const started = await session(["start", "--max-commands", String(urls.length * (COMMANDS_PER_PAGE + 2 * (options.dismiss?.length ?? 0)) * (options.baseline ? 2 : 1) + SPARE_COMMANDS), "--max-minutes", String(urls.length * MINUTES_PER_PAGE * (options.baseline ? 2 : 1) + 10), "--single-browser"]);
  if (typeof started.error === "string") throw new Error(`de browsersessie startte niet: ${started.error}`);

  const baseline = options.baseline ? await readJson<QuickSummary>(options.baseline) : null;
  if (baseline && (baseline.kind !== "quick" || !Array.isArray(baseline.counts) || baseline.counts.some((count) => typeof count.element !== "string" || typeof count.strong !== "boolean"))) throw new Error(`${options.baseline} is geen summary.json van een snelle meting`);

  const measurePage = async (url: string): Promise<QuickPage> => {
    const page: QuickPage = { url, title: null, httpStatus: null, screenshot: null, measurements: [], reflow: null, zoom: null, probes: [] };
    for (const scheme of QUICK_SCHEMES) page.measurements.push(await measure(page, scheme, session, run, options.dismiss ?? []));
    return page;
  };
  const summaryOf = (pages: readonly QuickPage[]): QuickSummary =>
    buildQuickSummary({
      site: inventory.baseUrl ?? inventory.origin ?? options.url ?? urls[0]!,
      startedAt,
      finishedAt: new Date().toISOString(),
      maxPages: options.maxPages,
      pagesFound: inventory.pages?.length ?? null,
      pageLimitReached: (inventory.skipped ?? []).some((entry) => /page limit/.test(entry.reason)),
      planned: urls.length,
      pages,
      dismiss: options.dismiss ?? [],
    });

  const pages: QuickPage[] = [];
  let summary: QuickSummary;
  let comparison: QuickComparison | null = null;
  try {
    for (const [index, url] of urls.entries()) {
      say(`pagina ${index + 1} van ${urls.length}: ${url}`);
      pages.push(await measurePage(url));
    }
    summary = summaryOf(pages);
    if (baseline) {
      comparison = compareQuick(baseline, summary, options.strict ?? false);
      // Before a pipeline stops on it: the pages that look worse or went unmeasured once more. Chance does not come twice.
      const doubted = new Set([...comparison.worse.map((change) => change.path), ...comparison.notMeasured]);
      if (doubted.size > 0) {
        const again: QuickPage[] = [];
        for (const page of pages) {
          if (!doubted.has(pagePath(page.url))) again.push(page);
          else {
            say(`nog een keer, om te bevestigen: ${page.url}`);
            again.push(await measurePage(page.url));
          }
        }
        comparison = confirmComparison(comparison, compareQuick(baseline, summaryOf(again), options.strict ?? false));
      }
    }
  } finally {
    await loep(["session", "stop", "--run", run]);
  }

  await mkdir(join(run, "quick"), { recursive: true });
  await writeJson(join(run, "quick", "summary.json"), summary);
  await writeFileAtomic(join(run, "quick", "samenvatting.md"), quickSummaryMarkdown(summary));
  await writeManifest(run, { command: "quick", startedAt, pages: summary.coverage.measured, maxPages: options.maxPages });
  if (comparison) {
    await writeJson(join(run, "quick", "verschil.json"), comparison);
    await writeFileAtomic(join(run, "quick", "verschil.md"), quickComparisonMarkdown(comparison));
  }
  return { summary, comparison };
}

const layoutOf = (answer: Record<string, unknown>): LayoutAnswer | null =>
  typeof answer.error === "string"
    ? null
    : {
        horizontalScroll: answer.horizontalScroll === true,
        offenders: typeof answer.offenders === "number" ? answer.offenders : 0,
        ...(Array.isArray(answer.first) ? { first: answer.first as string[] } : {}),
        ...(typeof answer.image === "string" ? { image: answer.image } : {}),
      };

async function measure(page: QuickPage, scheme: QuickScheme, session: (args: string[]) => Promise<Record<string, unknown>>, run: string, dismiss: readonly string[]): Promise<QuickMeasurement> {
  const failed = (reasonNl: string): QuickMeasurement => ({ scheme, observation: null, reasonNl, rules: null });
  const open = (): Promise<Record<string, unknown>> => session(["open", page.url, "--scheme", scheme]);
  let opened = await open();
  // A server error says nothing about the page: once more, as a sweep does.
  if (typeof opened.status === "number" && opened.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    opened = await open();
  }
  if (typeof opened.error === "string") return failed(`openen mislukt: ${opened.error}`);
  if (typeof opened.title === "string") page.title = opened.title;
  if (typeof opened.status === "number") page.httpStatus = opened.status;
  if (typeof opened.status === "number" && opened.status >= 500) return failed(`de site antwoordde met HTTP ${opened.status}, dus de pagina zelf is niet gemeten`);
  if (typeof opened.url === "string" && new URL(opened.url).origin !== new URL(page.url).origin) return failed(`de pagina verwees door naar ${opened.url}`);

  // A layer over the page, closed as its owner said. Where it is not there, the click fails and nothing is lost.
  for (const selector of dismiss) {
    const found = await session(["find", `css:${selector}`]);
    if (typeof found.error === "string") throw new Error(`--dismiss "${selector}": ${found.error}`);
    const total = typeof found.total === "number" ? found.total : 0;
    // More than one match is a mistake in the selector, and a measurement that goes on would measure the layer without saying why.
    if (total > 1) throw new Error(`--dismiss "${selector}" past op ${total} elementen op ${page.url}; geef een selector die alleen de knop aanwijst die de laag sluit`);
    // Not there, or there and hidden: the layer is closed already, as on every page after the first.
    if (total === 1 && !found.hidden) await session(["click", `css:${selector}`]);
  }

  /** What a probe recorded: the result of its observation, or null when it gave none. */
  const observed = async (args: string[]): Promise<Record<string, unknown> | null> => {
    const answer = await session(args);
    if (typeof answer.error === "string" || typeof answer.id !== "string") return null;
    return (await readObservation(run, answer.id)).result as Record<string, unknown>;
  };
  /** Most probes are one method: its result is what the probe reads. */
  const ofMethod = (result: Record<string, unknown> | null): Record<string, unknown> => ((result?.methods as { result?: Record<string, unknown> }[] | undefined)?.[0]?.result ?? {});

  if (scheme === "light") {
    const look = await session(["look", "--plain", "--max", "1"]);
    if (typeof look.image === "string") page.screenshot = look.image;
  }
  const rules = await session(["rules", "--wait"]);
  if (typeof rules.error === "string" || typeof rules.id !== "string") return failed(`meten mislukt: ${String(rules.error ?? "geen waarneming")}`);
  const result = (await readObservation(run, rules.id)).result as RulesResult;
  // Reflow and zoom change the window, so they come after the rules, and only once: a layout does not depend on the colours.
  if (scheme === "light") {
    // What reads the page as it stands comes first; then the Tab walk, and then the three that change the window.
    const probes: QuickProbeFinding[] = [...orderProbe(ofMethod(await observed(["order"]))), ...mediaProbe((await observed(["media"])) ?? {})];
    const walk = await observed(["taborder", "--max", String(MAX_TAB_STOPS)]);
    if (walk) {
      probes.push(...tabProbe(walk));
      page.covering = coveringLayers(walk);
    }
    page.reflow = layoutOf(await session(["reflow"]));
    page.zoom = layoutOf(await session(["zoom"]));
    probes.push(...spacingProbe(ofMethod(await observed(["spacing"]))));
    page.probes = probes;
  }
  return { scheme, observation: rules.id, reasonNl: null, rules: result };
}

/** The lines `quick` prints when it is done. */
export function quickDoneNl(run: string, summary: QuickSummary, comparison: QuickComparison | null = null): string {
  const strong = summary.signals.filter((signal) => signal.ground === "engines-agree" || signal.ground === "probe");
  const other = summary.signals.length - strong.length;
  return [
    `${summary.coverage.measured} van ${summary.coverage.planned} pagina's gemeten${summary.partial ? ", niet alles is gelukt" : ""}.`,
    strong.length > 0 ? `Aangewezen door meetprogramma's die het eens zijn of door een proef van loep: ${strong.map((signal) => signal.criterion).join(", ")}.` : "Geen criterium waar de meetprogramma's het over eens zijn of dat een proef van loep aanwijst.",
    ...(other > 0 ? [`Nog ${other} ${other === 1 ? "criterium vraagt" : "criteria vragen"} een tweede blik.`] : []),
    summary.backtest.textNl,
    `Samenvatting: ${join(run, "quick", "samenvatting.md")} en summary.json`,
    ...(comparison
      ? [
          comparison.ok
            ? `Vergeleken met de vorige meting: niets slechter${comparison.better.length > 0 ? `, ${comparison.better.length} beter` : ""}${comparison.unstable.length > 0 ? `. ${comparison.unstable.length} ${comparison.unstable.length === 1 ? "verschil is" : "verschillen zijn"} in een tweede meting niet bevestigd en ${comparison.unstable.length === 1 ? "telt" : "tellen"} niet` : ""}.`
            : `Vergeleken met de vorige meting, en bevestigd met een tweede meting van die pagina's: ${comparison.worse.length} slechter${comparison.notMeasured.length > 0 ? `, ${comparison.notMeasured.length} ${comparison.notMeasured.length === 1 ? "pagina" : "pagina's"} niet meer gemeten` : ""}. Zie ${join(run, "quick", "verschil.md")}`,
          ...groupedChangesNl(comparison.worse).slice(0, 10).map((line) => `  ${line}`),
          ...(comparison.weak.length > 0 ? [`Op ${new Set(comparison.weak.map((change) => change.path)).size} ${new Set(comparison.weak.map((change) => change.path)).size === 1 ? "pagina" : "pagina's"} is er een zwakke aanwijzing bij gekomen. Dat houdt niets tegen; met --strict telt het wel.`] : []),
        ]
      : []),
    "",
  ].join("\n");
}

/** The addresses in a file, one per line. */
const readOnlyFile = (path: string): string[] => readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
