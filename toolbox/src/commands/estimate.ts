import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CALIBRATION, type Estimate, type EstimateBasis, estimate, estimateTextNl, type Progress, type RowId, type Scheduling } from "../lib/estimate.ts";
import { knownCommit } from "../lib/evaluation.ts";
import type { ManifestStep } from "../lib/manifest.ts";
import { BUDGETS } from "./instrument-tasks.ts";
import { loadAllProcedures } from "../lib/procedures.ts";
import { AGENT_PHASES, agentPhaseTimings, elapsedSeconds, sessionLimit, stageTimings } from "../lib/timing.ts";
import { isLocalHost } from "../lib/writes.ts";

/** Agents at the same time when nobody says and no session process runs: what the workflow starts by default. */
const DEFAULT_AT_ONCE = 3;

export interface EstimateOptions {
  /** Agents at the same time; without it the limit of the session process minus the session of whoever leads, or the default of the workflow. */
  atOnce?: number | undefined;
  /** Count the phases with agents in groups that each wait for their slowest agent, as the workflow did before it had a pool. */
  groups?: boolean | undefined;
  /** The virtual Mac for VoiceOver: set up and stopped, running, or not there (null). Asked of lume by the command, not read from the run. */
  voiceover?: "stopped" | "running" | null | undefined;
}

/** What the estimate says about the virtual Mac for VoiceOver, when there is one. */
export function voiceoverNoteNl(state: EstimateOptions["voiceover"]): string | null {
  const reading = "elke voorlezing door VoiceOver duurt ongeveer een minuut en ze gaan één voor één; die tijd valt binnen het budget van de agents en is niet apart meegeteld. Stop de virtuele Mac na de laatste fase met agents (loep voiceover stop)";
  if (state === "running") return `de virtuele Mac met VoiceOver draait: beoordelaars, verifieerders en de afmaakronde lezen er zelf mee voor; ${reading}`;
  if (state === "stopped") return `de virtuele Mac met VoiceOver is ingericht: start hem tegelijk met de veegronde (loep voiceover start, 9 tot 20 minuten), dan kost het opstarten geen extra tijd; ${reading}`;
  return null;
}

export interface RunEstimate extends Estimate {
  run: string;
  /** What this run has that the estimate does not count, and what about it differs from the calibration. */
  notesNl: string[];
}

const readIfThere = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

/**
 * The expected time of a run, from what the run already knows about the site, next to what
 * its steps and sessions say was measured. Reads the run and writes nothing.
 */
export function estimateRun(runDir: string, options: EstimateOptions = {}): RunEstimate {
  const inventory = readIfThere<{ baseUrl: string; pages: { templateHash?: string }[]; totals?: Record<string, number> }>(join(runDir, "inventory.json"));
  if (!inventory) throw new Error("estimate rekent vanaf de inventaris: draai eerst inventory");
  const sample = readIfThere<{ items: unknown[]; documents?: unknown[] }>(join(runDir, "sample.json"));
  const site = readIfThere<{ pageTypes?: unknown[] }>(join(runDir, "site.json"));
  const index = readIfThere<{ walks?: unknown[]; tasks?: { finish?: unknown; judge?: { maxCommands?: number } }[]; finishDecided?: boolean }>(join(runDir, "tasks", "index.json"));
  // Only the steps and the toolchain are read from the manifest; what else it holds is not the estimate's to read.
  const manifest = readIfThere<{ steps?: ManifestStep[]; toolbox?: { commit?: string | null } }>(join(runDir, "manifest.json"));
  const steps = manifest?.steps ?? [];

  const limit = sessionLimit(runDir);
  const templates = new Set(inventory.pages.map((page) => page.templateHash).filter(Boolean)).size;
  const basis: EstimateBasis = {
    pages: sample ? sample.items.length : inventory.pages.length,
    pagesSource: sample ? "sample" : "inventory",
    // Before the explorer named the page types, the pages that share a template stand in for them.
    pageTypes: index?.walks ? index.walks.length : site?.pageTypes ? site.pageTypes.length : Math.max(1, templates),
    pageTypesSource: index?.walks ? "tasks" : site?.pageTypes ? "site" : "inventory",
    criteria: index?.tasks ? index.tasks.length : loadAllProcedures().procedures.length,
    criteriaSource: index?.tasks ? "tasks" : "catalogue",
    // One session is that of whoever leads the audit.
    atOnce: options.atOnce ?? (limit ? Math.max(1, limit - 1) : DEFAULT_AT_ONCE),
    atOnceSource: options.atOnce ? "option" : limit ? "session" : "default",
    local: isLocalHost(new URL(inventory.baseUrl).hostname),
    scheduling: (options.groups ? "groups" : "pool") satisfies Scheduling,
    // Known only once every verifier is in: then the tasks say which criteria the evaluation itself left open.
    ...(index?.finishDecided && index.tasks ? { finishers: index.tasks.filter((task) => task.finish).length } : {}),
  };

  const phases = agentPhaseTimings(runDir);
  const has = (command: string): boolean => steps.some((step) => step.command === command);
  const began = (phase: string): boolean => phases.some((entry) => entry.phase === phase);
  const done: RowId[] = ["inventory"];
  const lastCheck = steps.findLast((step) => step.command === "check-site");
  if (has("collect") || lastCheck?.ok === true) done.push("explore");
  for (const command of ["collect", "contrast", "states"] as const) if (has(command)) done.push(command);
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

  const first = steps[0];
  const lastSeen = Math.max(...steps.map((step) => Date.parse(step.at)), ...phases.map((phase) => Date.parse(phase.endedAt)));
  const progress: Progress = {
    stages: stageTimings(steps),
    phases,
    done,
    elapsedSeconds: finished ? elapsedSeconds(steps) : first ? Math.round((lastSeen - Date.parse(first.startedAt ?? first.at)) / 1000) : 0,
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
