import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { sweepAtOnce } from "../lib/atonce.ts";
import { CALIBRATION, durationNl, type Estimate, type EstimateBasis, estimate, estimateTextNl, type Progress, type RowId, type Scheduling } from "../lib/estimate.ts";
import type { PageWork, SweepWork } from "../lib/estimate-sweep.ts";
import { knownCommit } from "../lib/evaluation.ts";
import type { ManifestStep } from "../lib/manifest.ts";
import { readProgress, type StepProgress, type SweepCommand } from "../lib/progress.ts";
import { BUDGETS } from "./instrument-tasks.ts";
import { loadAllProcedures } from "../lib/procedures.ts";
import { DOWN_EVENTS } from "../instruments/pointer.ts";
import { BLOCKER_VARIANTS } from "./modelsweep.ts";
import { MAX_DOWN_TARGETS, MAX_HOVER_TARGETS } from "./states.ts";
import { AGENT_PHASES, agentPhaseTimings, elapsedSeconds, sessionLimit, sessionLimits, stageTimings } from "../lib/timing.ts";
import { budgetEmptyNl, isLocalHost, writeBudgetNl, writeBudgets, writesForRun } from "../lib/writes.ts";
import { isReady, isSetUp, statusNl, type VoiceoverStatus } from "../lib/voiceover.ts";
import { DEFAULT_DAEMON_LIMITS } from "../session/safety.ts";

/** Agents at the same time when nobody says and no session process runs: what the workflow starts by default. */
const DEFAULT_AT_ONCE = 3;

export interface EstimateOptions {
  /**
   * Agents at the same time; without it the limit of the session process minus the session of whoever leads, or the default of the workflow.
   * Given, it is also the number of pages the sweep measures at once (`collect --at-once`); without it the sweep is reckoned one page at a time.
   */
  atOnce?: number | undefined;
  /** Count the phases with agents in groups that each wait for their slowest agent, as the workflow did before it had a pool. */
  groups?: boolean | undefined;
  /** The virtual Mac for VoiceOver, or null without one. Asked of lume by the command, not read from the run. */
  voiceover?: VoiceoverStatus | null | undefined;
  /** The moment the estimate is made, to tell a step that runs from one that stopped. */
  now?: Date | undefined;
}

/** A step whose progress has not moved for this long may have stopped: the estimate says so. A state of the model may take ten minutes. */
const STALE_AFTER_MS = 15 * 60_000;

/** A link or control as `collect` describes it, as far as the estimate reads it. */
type Operable = { tag?: string; text?: string; region?: string };

type InventoryPageRead = { slug: string; templateHash?: string; loadMs?: number; operable?: { links: number; controls: number }; counts?: Record<string, unknown> };

/**
 * What the sweep has to do per page of the sample, from the inventory and, once `collect` measured a
 * page, from its measurements: the links and controls with the blockers closed and how many of them no
 * earlier page had, its forms, whether it listens for a press, and the walks with the arrow keys that
 * `states` repeats.
 */
function sweepWork(runDir: string, pages: InventoryPageRead[], sample: { slug: string; templateHash?: string }[] | null, narrowPages: number, states: { model: number; captured: number }): SweepWork {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const templates = new Set<string>();
  const seenOperable = new Set<string>();
  let measured = 0;
  let counted = 0;
  const work: PageWork[] = (sample ?? pages).map((item) => {
    const page = bySlug.get(item.slug);
    const template = item.templateHash ?? page?.templateHash ?? item.slug;
    const newTemplate = !templates.has(template);
    templates.add(template);
    const facts = readIfThere<{ links?: Operable[]; controls?: Operable[]; counts?: Record<string, unknown>; listeners?: Record<string, Record<string, number>> }>(join(runDir, "pages", item.slug, "facts.json"));
    // The probes of states act on a control once, on the first page that has it: what this page adds.
    let newOperable: number | null = null;
    if (facts?.links && facts.controls) {
      newOperable = 0;
      for (const element of [...facts.links, ...facts.controls]) {
        const key = `${element.tag}|${String(element.text ?? "").slice(0, 40)}|${element.region}`;
        if (seenOperable.has(key)) continue;
        seenOperable.add(key);
        newOperable++;
      }
    }
    const walk = readIfThere<{ arrowReach?: unknown[] }>(join(runDir, "pages", item.slug, "probes", "tabwalk.json"));
    const links = facts?.links?.length ?? page?.operable?.links ?? null;
    const controls = facts?.controls?.length ?? page?.operable?.controls ?? null;
    if (facts?.links) measured++;
    else if (page?.operable) counted++;
    const forms = facts?.counts?.forms ?? page?.counts?.forms;
    return { loadSeconds: typeof page?.loadMs === "number" ? page.loadMs / 1000 : null, links, controls, forms: typeof forms === "number" ? forms : 0, newTemplate, arrowWalks: walk ? (walk.arrowReach ?? []).length : null, newOperable, pressable: facts?.listeners ? DOWN_EVENTS.some((event) => Object.keys(facts.listeners![event] ?? {}).length > 0) : null };
  });
  const limits = sessionLimits(runDir);
  return {
    pages: work,
    source: measured > 0 && measured + counted === work.length ? "collect" : counted + measured === work.length && work.length > 0 ? "inventory" : "typical",
    narrowPages,
    modelStates: states.model,
    capturedStates: states.captured,
    navigationDelaySeconds: (limits?.navigationDelayMs ?? DEFAULT_DAEMON_LIMITS.navigationDelayMs) / 1000,
    limits: { press: MAX_DOWN_TARGETS, hover: MAX_HOVER_TARGETS },
  };
}

/** A step of the sweep that runs: its progress, when no step of the same command was done after it began. */
function runningSteps(runDir: string, steps: ManifestStep[]): Partial<Record<SweepCommand, StepProgress>> {
  const running: Partial<Record<SweepCommand, StepProgress>> = {};
  for (const command of ["collect", "contrast", "states"] as const) {
    const progress = readProgress(runDir, command);
    if (!progress) continue;
    const began = Date.parse(progress.startedAt);
    if (steps.some((step) => step.command === command && Date.parse(step.at) >= began)) continue;
    running[command] = progress;
  }
  return running;
}

/** What the estimate says about the virtual Mac for VoiceOver, when there is one. */
export function voiceoverNoteNl(state: EstimateOptions["voiceover"]): string | null {
  const reading = "elke voorlezing door VoiceOver duurt ongeveer een minuut en ze gaan één voor één; die tijd valt binnen het budget van de agents en is niet apart meegeteld. Stop de virtuele Mac na de laatste fase met agents (loep audit voiceover stop --run <run>)";
  if (!state || !isSetUp(state)) return null;
  if (isReady(state)) return `de virtuele Mac met VoiceOver draait en is opgewarmd: beoordelaars, verifieerders en de afmaakronde lezen er zelf mee voor; ${reading}`;
  const failed = state.lastStart && !state.lastStart.ok ? ` De laatste start mislukte: ${state.lastStart.error ?? "onbekende reden"}.` : "";
  if (state.state === "stopped" && !state.starting) return `de virtuele Mac met VoiceOver is ingericht: start hem tegelijk met de veegronde (loep audit voiceover start --run <run>, 9 minuten, of 20 tot 30 met een herstart), dan kost het opstarten geen extra tijd. Kijk vóór de fase met agents met loep audit voiceover status of hij voorleest.${failed} ${reading}`;
  return `de virtuele Mac met VoiceOver ${statusNl(state)}. ${reading}`;
}

export interface RunEstimate extends Estimate {
  run: string;
  /** What this run has that the estimate does not count, and what about it differs from the calibration. */
  notesNl: string[];
}

const readIfThere = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

/** The steps after which an agent of the evaluation gets a fresh task: each writes the tasks of the weighing and the merge proposal again. */
const WRITES_AGENT_TASKS = ["evaluate", "merge", "weigh"];

/**
 * How long an agent after `evaluate` worked: from the step that last wrote its task to its last
 * answer that passed the check (the stamp), or else to `command` (`weigh`, `merge`) as the step that
 * took the answer in, or else to when the answer was written. The same reading as the explorer and
 * the gate: the time between two steps is the agent's. Null when the run does not say.
 */
function agentSeconds(runDir: string, steps: ManifestStep[], answer: string, command: string): number | null {
  const stamp = readIfThere<{ stampedAt?: string }>(join(runDir, "verdicts", answer.replace(/\.json$/, ".stamp.json")));
  const path = join(runDir, "verdicts", answer);
  const taken = steps.findLast((step) => step.command === command);
  const end = stamp?.stampedAt ? Date.parse(stamp.stampedAt) : taken ? Date.parse(taken.at) : existsSync(path) ? statSync(path).mtimeMs : NaN;
  if (!Number.isFinite(end)) return null;
  const start = steps.filter((step) => WRITES_AGENT_TASKS.includes(step.command) && Date.parse(step.at) < end).at(-1);
  return start ? Math.round((end - Date.parse(start.at)) / 1000) : null;
}

/**
 * The expected time of a run, from what the run already knows about the site, next to what
 * its steps and sessions say was measured. Reads the run and writes nothing.
 */
export function estimateRun(runDir: string, options: EstimateOptions = {}): RunEstimate {
  const inventory = readIfThere<{ baseUrl: string; pages: InventoryPageRead[]; totals?: Record<string, number> }>(join(runDir, "inventory.json"));
  if (!inventory) throw new Error("estimate rekent vanaf de inventaris: draai eerst inventory");
  const sample = readIfThere<{ items: { slug: string; templateHash?: string }[]; documents?: unknown[] }>(join(runDir, "sample.json"));
  const site = readIfThere<{ pageTypes?: unknown[]; blockers?: unknown[]; components?: unknown[]; processes?: unknown[] }>(join(runDir, "site.json"));
  const captured = readIfThere<{ states?: unknown[] }>(join(runDir, "site-states.json"));
  const index = readIfThere<{ walks?: unknown[]; tasks?: { finish?: unknown; judge?: { maxCommands?: number } }[]; finishDecided?: boolean }>(join(runDir, "tasks", "index.json"));
  // Only the steps and the toolchain are read from the manifest; what else it holds is not the estimate's to read.
  const manifest = readIfThere<{ steps?: ManifestStep[]; toolbox?: { commit?: string | null } }>(join(runDir, "manifest.json"));
  const steps = manifest?.steps ?? [];
  const evaluation = readIfThere<{ criteria?: { findings?: unknown[] }[]; weighing?: { status?: string }; merge?: { proposal?: { status?: string } } }>(join(runDir, "evaluation.json"));

  const limit = sessionLimit(runDir);
  const templates = new Set(inventory.pages.map((page) => page.templateHash).filter(Boolean)).size;
  const running = runningSteps(runDir, steps);
  // The sweep goes as many at once as it is told; without a number, as many as the step that runs, or the last one that went more than one at once.
  const sweptAtOnce = Object.values(running).at(-1)?.atOnce ?? steps.findLast((step) => ["collect", "contrast", "states"].includes(step.command) && typeof step.atOnce === "number")?.atOnce;
  const askedSweep = options.atOnce ?? (typeof sweptAtOnce === "number" ? sweptAtOnce : 1);
  const sweepTogether = sweepAtOnce(runDir, Math.max(1, Math.floor(askedSweep))).atOnce;
  const pageTypes = index?.walks ? index.walks.length : site?.pageTypes ? site.pageTypes.length : Math.max(1, templates);
  // Before the explorer, a state per page type stands in for the site model.
  const modelStates = site ? (site.blockers?.length ?? 0) + (site.components?.length ?? 0) + (site.processes?.length ?? 0) : pageTypes;
  const capturedStates = captured?.states ? captured.states.length : site ? (site.blockers?.length ?? 0) * BLOCKER_VARIANTS.length + (site.components?.length ?? 0) + (site.processes?.length ?? 0) : pageTypes;
  const basis: EstimateBasis = {
    pages: sample ? sample.items.length : inventory.pages.length,
    pagesSource: sample ? "sample" : "inventory",
    // Before the explorer named the page types, the pages that share a template stand in for them.
    pageTypes,
    pageTypesSource: index?.walks ? "tasks" : site?.pageTypes ? "site" : "inventory",
    criteria: index?.tasks ? index.tasks.length : loadAllProcedures().procedures.length,
    criteriaSource: index?.tasks ? "tasks" : "catalogue",
    // One session is that of whoever leads the audit.
    atOnce: options.atOnce ?? (limit ? Math.max(1, limit - 1) : DEFAULT_AT_ONCE),
    atOnceSource: options.atOnce ? "option" : limit ? "session" : "default",
    // The sweep measures as many at once as it is told; the skill tells it the number of agents the owner allows. Never more than the session process allows.
    ...(sweepTogether > 1 ? { sweepAtOnce: sweepTogether } : {}),
    sweep: sweepWork(runDir, inventory.pages, sample?.items ?? null, site?.pageTypes ? site.pageTypes.length : pageTypes, { model: modelStates, captured: capturedStates }),
    local: isLocalHost(new URL(inventory.baseUrl).hostname),
    scheduling: (options.groups ? "groups" : "pool") satisfies Scheduling,
    // Known only once every verifier is in: then the tasks say which criteria the evaluation itself left open.
    ...(index?.finishDecided && index.tasks ? { finishers: index.tasks.filter((task) => task.finish).length } : {}),
    // Known once the evaluation is there: the agents after it work through its findings.
    ...(evaluation?.criteria ? { findings: evaluation.criteria.reduce((total, criterion) => total + (criterion.findings?.length ?? 0), 0) } : {}),
  };

  const phases = agentPhaseTimings(runDir);
  const has = (command: string): boolean => steps.some((step) => step.command === command);
  const began = (phase: string): boolean => phases.some((entry) => entry.phase === phase);
  const done: RowId[] = ["inventory"];
  const lastCheck = steps.findLast((step) => step.command === "check-site");
  if (has("collect") || lastCheck?.ok === true) done.push("explore");
  for (const command of ["collect", "contrast", "states"] as const) if (has(command) && !running[command]) done.push(command);
  if (steps.findLast((step) => step.command === "gate")?.sufficient === true || began("walks")) done.push("gate");
  // A phase with agents is over when the next one began; the last one when the evaluation was made.
  const finished = has("evaluate");
  for (const [position, { id }] of AGENT_PHASES.entries()) {
    const later = AGENT_PHASES.slice(position + 1);
    if (began(id) && (finished || later.some((next) => began(next.id)))) done.push(id);
  }
  // The finishing round runs only when a criterion needs it: without one it is over when the evaluation is made.
  if (finished && !done.includes("finishers")) done.push("finishers");
  if (finished) done.push("report");
  // The weighing is done once its agent wrote its answer, or the evaluation holds one. An evaluation with findings and no task for it was made by a version without the step.
  const withoutWeighing = finished && basis.findings !== 0 && !existsSync(join(runDir, "tasks", "weeg", "taak.md"));
  if (existsSync(join(runDir, "verdicts", "weging.json")) || evaluation?.weighing?.status === "applied" || (finished && basis.findings === 0)) done.push("weighing");
  // `evaluate` always sets out the task of the merge proposal; the step counts as done in this run only once its agent answered.
  const merged = existsSync(join(runDir, "verdicts", "samenvoeg.json")) || evaluation?.merge?.proposal?.status === "applied";
  if (merged) done.push("merge");

  const first = steps[0];
  // A step that runs goes on until now; the run with it.
  const lastSeen = Math.max(...steps.map((step) => Date.parse(step.at)), ...phases.map((phase) => Date.parse(phase.endedAt)), ...(Object.keys(running).length > 0 ? [(options.now ?? new Date()).getTime()] : []));
  const progress: Progress = {
    stages: stageTimings(steps),
    phases,
    done,
    elapsedSeconds: finished ? elapsedSeconds(steps) : first ? Math.round((lastSeen - Date.parse(first.startedAt ?? first.at)) / 1000) : 0,
    running,
    ...(Object.keys(running).length > 0 ? { now: (options.now ?? new Date()).toISOString() } : {}),
    agentSteps: { weighing: done.includes("weighing") ? agentSeconds(runDir, steps, "weging.json", "weigh") : null, ...(merged ? { merge: agentSeconds(runDir, steps, "samenvoeg.json", "merge") } : {}) },
    ...(withoutWeighing ? { withoutWeighing } : {}),
  };

  const notesNl: string[] = [];
  const documents = sample?.documents?.length ?? 0;
  if (documents > 0) notesNl.push(`de steekproef heeft ${documents} ${documents === 1 ? "document" : "documenten"}; het inlezen daarvan is niet meegeteld`);
  const media = (inventory.totals?.video ?? 0) + (inventory.totals?.audio ?? 0);
  if (media > 0) notesNl.push(`de inventaris telt ${media} keer video of geluid; het uitschrijven daarvan is niet meegeteld`);
  if (basis.pageTypesSource === "inventory") notesNl.push("de site is nog niet verkend: het aantal paginatypen is geschat uit de pagina's met dezelfde opbouw en wordt scherper na explore");
  if (basis.pagesSource === "inventory") notesNl.push("de steekproef is nog niet getrokken: gerekend is met alle pagina's van de inventaris");
  // The time per agent was measured on the fixed budget of each role. A task with more room than that can take longer, and nothing says yet by how much.
  const roomier = (index?.tasks ?? []).filter((task) => (task.judge?.maxCommands ?? 0) > BUDGETS.judge.commands).length;
  if (roomier > 0) notesNl.push(`${roomier} van de ${index!.tasks!.length} beoordelaars ${roomier === 1 ? "heeft" : "hebben"} een ruimer budget dan het vaste van ${BUDGETS.judge.commands} commando's: de schatting rekent met de gemeten tijd per agent, niet met het budget per opdracht, en telt een verlenging niet mee`);
  if (basis.sweep!.source === "typical") notesNl.push("de inventaris telt de links en bedieningselementen per pagina nog niet: de veegronde is gerekend met een gewone pagina; draai inventory opnieuw met deze versie voor een schatting per pagina");
  const now = (options.now ?? new Date()).getTime();
  for (const [command, step] of Object.entries(running)) {
    const quiet = now - Date.parse(step.updatedAt);
    if (quiet > STALE_AFTER_MS) notesNl.push(`${command} schreef zijn voortgang ${durationNl(quiet / 1000)} geleden voor het laatst; loopt de stap nog? Zo niet, dan klopt de rest van ${command} in deze schatting niet`);
  }
  // What is left of the budget for sending, for whoever decides whether a criterion still waits on a message.
  const permission = writesForRun(runDir);
  // One note per grant: a site on this machine and a chat declared next to it each have a budget of their own.
  for (const budget of permission ? writeBudgets(runDir, permission, now) : []) {
    if (budget.left === 0) notesNl.push(budgetEmptyNl(budget));
    notesNl.push(`versturen: ${writeBudgetNl(budget)}`);
  }
  const voiceover = voiceoverNoteNl(options.voiceover);
  if (voiceover) notesNl.push(voiceover);
  // Without a known commit, as from the plugin, there is nothing to hold against the calibration.
  const commit = knownCommit(manifest?.toolbox);
  if (commit && !commit.startsWith(CALIBRATION.commit)) notesNl.push(`deze run is gemaakt met commit ${commit.slice(0, 7)}, de schatting is geijkt tot en met ${CALIBRATION.commit}: meet de toolbox sindsdien meer of minder, dan wijkt de veegronde af`);
  return { run: basename(resolve(runDir)), ...estimate(basis, progress), notesNl };
}

/** The estimate as text for a reader, or as JSON. */
export function estimateOutput(runDir: string, options: EstimateOptions & { json?: boolean | undefined } = {}): string {
  const result = estimateRun(runDir, options);
  return options.json ? `${JSON.stringify(result, null, 2)}\n` : estimateTextNl(result, result.run, result.notesNl);
}
