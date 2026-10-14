import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { confirmLogin, launchBrowser } from "../browser/session.ts";
import { readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { type Manifest, stepStart, writeManifest } from "../lib/manifest.ts";
import { TEMPLATES_DIR } from "../lib/procedures.ts";
import { agentLoginNl, loginForRun } from "../lib/login.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { frameAddress, readSiteModel, SITE_CHECK_FILE, SITE_MODEL_FILE, validateSiteModel, type ModelContext, type PageType, type Postcondition, type SiteCheck, type SiteModel } from "../lib/sitemodel.ts";
import { holds, loadRecipes, MAX_RECIPE_STEPS, replayEnv, replayFromClean, replaySteps } from "../session/recipe.ts";
import { openSurface, type Env } from "../session/surface.ts";
import { pageOperables } from "../instruments/operables.ts";
import { controlsBetweenWidths, MEASURED_WIDTHS, widthToTry, type WidthsForExplorer } from "../instruments/widths.ts";
import { mergeWidths, uncoveredOperables, type CountedPage } from "../lib/operables.ts";
import type { Recipe } from "../session/daemon.ts";
import type { Gate } from "./gate.ts";
import type { Inventory, InventoryPage } from "./inventory.ts";

/** Budget of the exploring agent's session. */
export const EXPLORE_MAX_COMMANDS = 200;
export const EXPLORE_MAX_MINUTES = 40;
export const EXPLORE_SESSION = "verken";

const isFrame = (page: InventoryPage): boolean => page.foundVia.length > 0 && page.foundVia.every((via) => via.startsWith("iframe:"));

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return values[key]!;
  });
}

export interface ExploreContext {
  baseUrl: string;
  proposedPageTypes: PageType[];
  /** Per proposed page type the widths the stylesheets of its first page name. Absent for an inventory from before they were read. */
  breakpoints?: { pageType: string; widths: number[] }[];
  frames: { address: string; copies: number; embeddedOn: string[]; title: string }[];
}

/** What the inventory knows that an explorer should not have to find out again: pages grouped by template, and the frames. */
export function exploreContext(inventory: Inventory): ExploreContext {
  const own = inventory.pages.filter((page) => !isFrame(page));
  const byTemplate = new Map<string, InventoryPage[]>();
  for (const page of own) byTemplate.set(page.templateHash, [...(byTemplate.get(page.templateHash) ?? []), page]);
  const groups = [...byTemplate.values()].sort((a, b) => a[0]!.url.localeCompare(b[0]!.url));
  const proposedPageTypes = groups.map((pages, index) => ({ id: `type-${index + 1}`, descriptionNl: "", representative: pages[0]!.url, pages: pages.map((page) => page.url) }));
  const frames = new Map<string, ExploreContext["frames"][number]>();
  for (const page of inventory.pages.filter(isFrame)) {
    const address = frameAddress(page.url);
    const entry = frames.get(address) ?? { address, copies: 0, embeddedOn: [], title: page.title };
    entry.copies++;
    for (const via of page.foundVia) if (!entry.embeddedOn.includes(via.slice("iframe:".length))) entry.embeddedOn.push(via.slice("iframe:".length));
    frames.set(address, entry);
  }
  const breakpoints = groups.flatMap((pages, index) => (pages[0]!.breakpoints ? [{ pageType: `type-${index + 1}`, widths: pages[0]!.breakpoints }] : []));
  return { baseUrl: inventory.baseUrl, proposedPageTypes, ...(breakpoints.length > 0 ? { breakpoints } : {}), frames: [...frames.values()].map((frame) => ({ ...frame, embeddedOn: frame.embeddedOn.sort() })).sort((a, b) => a.address.localeCompare(b.address)) };
}

/** Write the task for the exploring agent: a fixed prompt, filled in with what the inventory found and, in a later round, the gaps of the evidence gate. */
export async function explore(runDir: string): Promise<{ task: string; pages: number; frames: number; round: number }> {
  const startedAt = stepStart();
  const inventory = await readJson<Inventory>(join(runDir, "inventory.json"));
  const context = exploreContext(inventory);
  const absoluteRun = resolve(runDir);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const template = readFileSync(join(TEMPLATES_DIR, "verken.md"), "utf8");
  const contextPath = join("explore", "context.json");
  await writeJson(join(runDir, contextPath), context);

  const pageCount = context.proposedPageTypes.reduce((sum, type) => sum + type.pages.length, 0);
  const pageTypesSummary = [
    "Het voorstel in het kort:",
    "",
    "| Voorstel | Pagina's | Eerste pagina |",
    "|---|---|---|",
    ...context.proposedPageTypes.map((type) => `| ${type.id} | ${type.pages.length} | ${type.representative} |`),
  ].join("\n");
  const framesSummary =
    context.frames.length === 0
      ? "De inventaris vond geen ingesloten vensters. `frames` blijft dan een lege lijst."
      : ["De vensters:", "", "| Adres | Keer gevonden | Titel |", "|---|---|---|", ...context.frames.map((frame) => `| ${frame.address} | ${frame.copies} | ${frame.title.replaceAll("|", "/").slice(0, 60) || "(geen)"} |`)].join("\n");

  const breakpointsSummary = breakpointsNl(context);

  // A later round: the gate said what is missing. The explorer improves the model it made, it does not start over.
  const gatePath = join(runDir, "gate.json");
  const gate = existsSync(gatePath) && existsSync(join(runDir, SITE_MODEL_FILE)) ? await readJson<Gate>(gatePath) : null;
  const manifestPath = join(runDir, "manifest.json");
  const round = (existsSync(manifestPath) ? (await readJson<Manifest>(manifestPath)).steps.filter((step) => step.command === "explore").length : 0) + 1;
  // What the gate found that an explorer can do something about; a measurement the sweep still owes is not his to fix.
  const forExplorer = (gate && !gate.sufficient ? gate.gaps : []).filter((gap) => !SWEEP_ONLY_CHECKS.includes(gap.check));
  // And what the model itself lacks by today's rules, without replaying anything.
  const modelProblems = existsSync(join(runDir, SITE_MODEL_FILE)) ? await staticProblems(runDir, inventory) : [];
  const previous = !existsSync(join(runDir, SITE_MODEL_FILE))
    ? ""
    : [
        "## Dit is een vervolgronde",
        "",
        `Er is al een \`site.json\` (${join(absoluteRun, SITE_MODEL_FILE)}). Lees het bestaande model en pas het aan op de punten hieronder. Begin niet opnieuw: wat klopt, blijft staan. Recepten die al werken hoef je niet opnieuw op te nemen.`,
        "",
        ...(modelProblems.length > 0 ? ["De controle keurt het model nu af op:", "", ...modelProblems.map((problem) => `- ${problem}`), ""] : []),
        ...(forExplorer.length > 0 ? ["De bewijspoort vond na het meten deze gaten:", "", ...forExplorer.map((gap) => `- **${gap.check}**${gap.url ? `, ${gap.url}` : ""}${gap.state && gap.state !== "default" ? `, toestand ${gap.state}` : ""}: ${gap.missingNl}`), ""] : []),
        ...(modelProblems.length + forExplorer.length === 0 ? ["Er zijn geen open punten gemeld. Loop de werkwijze na op wat het model nog mist, met name stap 2b.", ""] : []),
        "Is een gat een eigenschap van de site zelf en geen gemis in het model (de site heeft echt een toetsenbordval, een onderdeel gaat echt niet open), leg dat dan vast in `acceptedGaps`: `{ \"check\": \"<naam van de controle>\", \"page\": \"<adres>\", \"reasonNl\": \"wat je zag\", \"observation\": \"<id van de waarneming die het toont, bijvoorbeeld verken-0042>\" }`.",
      ].join("\n");

  const taskPath = join("explore", "verken.md");
  // Every round its own session, and so its own budget and its own numbering of observations.
  const session = round === 1 ? EXPLORE_SESSION : `${EXPLORE_SESSION}${round}`;
  const prompt = fill(template, {
    site: new URL(inventory.baseUrl).hostname,
    baseUrl: inventory.baseUrl,
    run: absoluteRun,
    cli,
    context: join(absoluteRun, contextPath),
    output: join(absoluteRun, SITE_MODEL_FILE),
    check: `node ${cli} check-site --run ${absoluteRun}`,
    session,
    workDir: await makeWorkDir(runDir, session),
    maxCommands: String(EXPLORE_MAX_COMMANDS),
    maxMinutes: String(EXPLORE_MAX_MINUTES),
    pageCount: String(pageCount),
    frameCount: String(context.frames.length),
    pageTypesSummary,
    framesSummary,
    breakpoints: breakpointsSummary,
    previous,
    login: agentLoginNl(loginForRun(runDir)),
  });
  await writeFileAtomic(join(runDir, taskPath), prompt);
  await writeManifest(runDir, { command: "explore", startedAt, round, pages: pageCount, frames: context.frames.length, templateSha256: sha256(template) });
  return { task: join(absoluteRun, taskPath), pages: pageCount, frames: context.frames.length, round };
}

/**
 * The widths the stylesheets name, for the explorer: the layout changes there, so a control that
 * is on screen at neither 1280 nor 360 pixels can be there just above or below one of them.
 */
export function breakpointsNl(context: ExploreContext): string {
  const known = (context.breakpoints ?? []).filter((entry) => entry.widths.some((width) => width > 320 && width < 1280));
  if (known.length === 0) return "De inventaris vond in de stylesheets geen breedtes tussen 320 en 1280 pixels waarop de opmaak verandert.";
  const inRange = (widths: number[]): number[] => widths.filter((width) => width > 320 && width < 1280);
  const byList = new Map<string, string[]>();
  for (const entry of known) byList.set(inRange(entry.widths).join(", "), [...(byList.get(inRange(entry.widths).join(", ")) ?? []), entry.pageType]);
  const lines = [...byList].map(([widths, types]) => `- ${byList.size === 1 ? "Alle paginatypen" : types.join(", ")}: ${widths}`);
  return ["De stylesheets noemen deze breedtes tussen 320 en 1280 pixels; daar verandert de opmaak:", "", ...lines, "", "Een knop of menu dat je op 1280 en op 360 pixels niet ziet, kan net boven of net onder zo'n breedte wel bestaan. Open dan een pagina op zo'n breedte (`--width <breedte>`) en neem het recept daar op. `check-site` meldt na het tellen welke bedieningselementen alleen tussen de gemeten breedtes in beeld staan, met de breedte waarop je ze vindt."].join("\n");
}

/** Checks of the gate whose gaps are closed by running the sweep again, not by exploring. */
const SWEEP_ONLY_CHECKS = ["coverage", "sweep-complete", "sheets"];

async function modelContext(runDir: string, inventory: Inventory): Promise<ModelContext> {
  const recipes = await loadRecipes(runDir);
  return {
    pages: inventory.pages.filter((page) => !isFrame(page)).map((page) => page.url),
    frames: inventory.pages.filter(isFrame).map((page) => page.url),
    recipes: Object.fromEntries(Object.entries(recipes).map(([name, recipe]) => [name, { width: recipe.start?.width ?? 0, steps: recipe.steps.length, url: recipe.start?.url ?? "" }])),
    observations: await observationIds(runDir),
    media: Object.fromEntries(inventory.pages.filter((page) => !isFrame(page)).map((page) => [page.url, { audio: Number(page.counts.audio ?? 0), video: Number(page.counts.video ?? 0) }])),
  };
}

/** The problems of the model as it is on disk, by the validator alone. */
async function staticProblems(runDir: string, inventory: Inventory): Promise<string[]> {
  try {
    return validateSiteModel(JSON.parse(readFileSync(join(runDir, SITE_MODEL_FILE), "utf8")), await modelContext(runDir, inventory));
  } catch {
    return [`${SITE_MODEL_FILE} is geen geldige JSON`];
  }
}

async function observationIds(runDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const dir = join(runDir, "observations");
  if (!existsSync(dir)) return ids;
  for (const session of await readdir(dir)) {
    for (const file of await readdir(join(dir, session)).catch(() => [] as string[])) {
      const nr = /^(\d+)\.json$/.exec(file)?.[1];
      if (nr) ids.add(`${session}-${nr}`);
    }
  }
  return ids;
}

/** Where `check-site` keeps what it counted on every page type, for whoever wants to see why it reports a part as missing. */
export const OPERABLES_FILE = join("explore", "operables.json");
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 360, height: 740 };

/**
 * Count the forms and loose controls on the representative page of every page type, with
 * the blockers closed, in the default window and in a narrow one.
 */
export async function countOperables(env: Env, model: SiteModel, recipes: Record<string, Recipe>): Promise<{ counted: CountedPage[]; problems: string[]; widths: ({ pageType: string } & WidthsForExplorer)[] }> {
  const counted: CountedPage[] = [];
  const problems: string[] = [];
  const widths: ({ pageType: string } & WidthsForExplorer)[] = [];
  for (const type of model.pageTypes) {
    let surface: Awaited<ReturnType<typeof openSurface>>["surface"] | null = null;
    try {
      ({ surface } = await openSurface(env, { url: type.representative, ...WIDE, scheme: "light" }));
      for (const blocker of model.blockers) {
        if ((await holds(surface.page, blocker.postcondition)).holds) continue;
        const steps = recipes[blocker.recipe]!.steps;
        const leaves = steps.findIndex((step) => step.command === "goto");
        await replaySteps(env, surface, leaves === -1 ? steps : steps.slice(0, leaves), blocker.postcondition);
      }
      const wide = await pageOperables(surface.page);
      // The same scan of the widths in between as the sweep makes: a control that only shows there is tried at such a width.
      widths.push({ pageType: type.id, ...(await controlsBetweenWidths(surface.page).catch(() => ({ breakpoints: [], controls: [] }))) });
      await surface.page.setViewportSize(NARROW);
      await surface.page.waitForTimeout(300);
      counted.push({ pageType: type.id, url: type.representative, groups: mergeWidths(wide, await pageOperables(surface.page)) });
    } catch (error) {
      problems.push(`paginatype "${type.id}": op ${type.representative} was niet te tellen wat er te bedienen is: ${(error as Error).message.split("\n")[0]}`);
    } finally {
      await surface?.context.close().catch(() => undefined);
    }
  }
  return { counted, problems, widths };
}

/**
 * For each control that is only on screen between the measured widths and that no recipe was
 * recorded at such a width for: where it shows and the width to open the page at. A hint, not a
 * problem: the explorer decides whether it is a part of its own.
 */
export function widthHints(model: SiteModel, recipes: Record<string, Recipe>, scanned: ({ pageType: string } & WidthsForExplorer)[]): string[] {
  const recorded = [...model.components.map((entry) => ({ recipe: entry.recipe, pageTypes: entry.pageTypes as string[] | null })), ...model.processes.map((entry) => ({ recipe: entry.recipe, pageTypes: null }))]
    .map((entry) => ({ width: entry.recipe ? recipes[entry.recipe]?.start?.width : undefined, pageTypes: entry.pageTypes }))
    .filter((entry): entry is { width: number; pageTypes: string[] | null } => entry.width !== undefined);
  const byControl = new Map<string, { control: string; shownAt: number[]; pageTypes: string[] }>();
  for (const type of scanned) {
    for (const control of type.controls) {
      const [low, high] = [Math.min(...control.shownAt), Math.max(...control.shownAt)];
      if (recorded.some((entry) => entry.width >= low && entry.width <= high && (entry.pageTypes === null || entry.pageTypes.includes(type.pageType)))) continue;
      const entry = byControl.get(control.where) ?? { control: control.control, shownAt: control.shownAt, pageTypes: [] };
      entry.pageTypes.push(type.pageType);
      byControl.set(control.where, entry);
    }
  }
  return [...byControl.values()].map((entry) => {
    const [low, high] = [Math.min(...entry.shownAt), Math.max(...entry.shownAt)];
    const types = entry.pageTypes.length > 3 ? `${entry.pageTypes.slice(0, 3).join(", ")} en ${entry.pageTypes.length - 3} meer` : entry.pageTypes.join(", ");
    return `${entry.control} staat alleen ${low === high ? `op ${low}` : `tussen ${low} en ${high}`} pixels breed in beeld, op geen van ${MEASURED_WIDTHS.join(", ")} (paginatype ${types}). Open de pagina met --width ${widthToTry(entry.shownAt)} en bedien het daar; lukt dat niet, leg het dan vast met "recipe": null en zeg in notOpenedNl op welke breedte je het probeerde.`;
  });
}

/**
 * Validate the site model and replay every recipe from a clean page. An entry whose
 * recipe does not run, or whose postcondition does not hold afterwards, is refused. The
 * outcome is written next to the model; the sweep only accepts a model that passed.
 */
export async function checkSite(runDir: string, options: { navigationDelayMs?: number } = {}): Promise<SiteCheck> {
  const startedAt = stepStart();
  const path = join(runDir, SITE_MODEL_FILE);
  if (!existsSync(path)) throw new Error(`er is geen ${SITE_MODEL_FILE} in ${runDir}`);
  const inventory = await readJson<Inventory>(join(runDir, "inventory.json"));
  const recipes = await loadRecipes(runDir);
  const context = await modelContext(runDir, inventory);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    parsed = null;
    void error;
  }
  const problems = parsed === null ? [`${SITE_MODEL_FILE} is geen geldige JSON`] : validateSiteModel(parsed, context);
  const replays: SiteCheck["replays"] = [];
  const hintsNl: string[] = [];
  let operables: SiteCheck["operables"];

  if (problems.length === 0) {
    const model = (await readSiteModel(runDir)) as SiteModel;
    const entries: { kind: SiteCheck["replays"][number]["kind"]; id: string; recipe: string; postcondition: Postcondition }[] = [
      ...model.blockers.map((entry) => ({ kind: "blocker" as const, id: entry.id, recipe: entry.recipe, postcondition: entry.postcondition })),
      ...model.components.filter((entry) => entry.recipe !== null).map((entry) => ({ kind: "component" as const, id: entry.id, recipe: entry.recipe!, postcondition: entry.postcondition! })),
      ...model.processes.map((entry) => ({ kind: "process" as const, id: entry.id, recipe: entry.recipe, postcondition: entry.postcondition })),
    ];
    const browser = await launchBrowser();
    try {
      // In a run with a login: a recipe that fails because the session ran out says nothing about the model.
      await confirmLogin(browser);
      const env = await replayEnv(browser, runDir, options.navigationDelayMs === undefined ? {} : { navigationDelayMs: options.navigationDelayMs });
      for (const entry of entries) {
        const recipe = recipes[entry.recipe]!;
        let reasonNl: string | null = null;
        let before = "";
        let after = "";
        if (recipe.steps.length > MAX_RECIPE_STEPS) reasonNl = `het recept heeft ${recipe.steps.length} stappen, meer dan ${MAX_RECIPE_STEPS}; begin met een verse open en doe alleen wat nodig is`;
        else if (entry.kind === "blocker" && recipe.steps.some((step) => step.command === "goto")) reasonNl = "het recept van een blokkade gaat door naar een andere pagina; bewaar het direct na het sluiten, op de pagina waar je begon";
        else {
          const replay = await replayFromClean(env, recipe, entry.postcondition);
          await replay.surface?.context.close().catch(() => undefined);
          reasonNl = replay.reasonNl;
          before = replay.before?.detail ?? "";
          after = replay.after?.detail ?? "";
        }
        replays.push({ kind: entry.kind, id: entry.id, recipe: entry.recipe, ok: reasonNl === null, reasonNl, before, after });
        if (reasonNl !== null) problems.push(`${entry.kind} "${entry.id}" (recept ${entry.recipe}): ${reasonNl}`);
      }
      // What there is to operate on each page type, next to what the model says. Only with the blockers closing: otherwise their buttons are counted as parts of the page.
      if (replays.every((replay) => replay.kind !== "blocker" || replay.ok)) {
        const { counted, problems: notCounted, widths } = await countOperables(env, model, recipes);
        const compared = uncoveredOperables(model, recipes, counted);
        hintsNl.push(...widthHints(model, recipes, widths));
        await writeJson(join(runDir, OPERABLES_FILE), { note: "Wat check-site telde op de representatieve pagina van elk paginatype, met de blokkades gesloten: formulieren, losse bedieningsonderdelen en ingesloten vensters met iets om te bedienen, zonder gewone links. uncovered is wat geen recept van het sitemodel aanraakt. betweenWidths zegt per paginatype welke breedtes de stylesheets noemen en welke bedieningselementen alleen tussen 1280, 360 en 320 pixels in beeld staan, met de breedtes waarop.", pageTypes: counted, uncovered: compared.uncovered, betweenWidths: widths });
        operables = { counted: compared.counted, uncovered: compared.uncovered.length };
        problems.push(...notCounted, ...compared.uncovered.map((entry) => entry.problemNl));
      }
      await confirmLogin(browser);
    } finally {
      await browser.close();
    }
  }

  // A saved state that the model does not use is a recipe nobody checked. Once the model holds, such files are set aside, so `open --state` only knows states that work.
  const unusedRecipes: string[] = [];
  if (problems.length === 0) {
    const model = (await readSiteModel(runDir)) as SiteModel;
    const used = new Set([...model.blockers, ...model.components, ...model.processes].map((entry) => entry.recipe));
    for (const name of Object.keys(recipes).filter((candidate) => !used.has(candidate) && recipes[candidate]!.savedBy.startsWith(EXPLORE_SESSION))) {
      await mkdir(join(runDir, "recipes", "unused"), { recursive: true });
      await rename(join(runDir, "recipes", `${name}.json`), join(runDir, "recipes", "unused", `${name}.json`));
      unusedRecipes.push(name);
    }
  }
  const check: SiteCheck = { ok: problems.length === 0, siteSha256: await sha256File(path), checkedAt: new Date().toISOString(), problems, replays, unusedRecipes, ...(operables ? { operables } : {}), ...(hintsNl.length > 0 ? { hintsNl } : {}) };
  await writeJson(join(runDir, SITE_CHECK_FILE), check);
  await writeManifest(runDir, { command: "check-site", startedAt, ok: check.ok, problems: problems.length, replays: replays.length });
  return check;
}
