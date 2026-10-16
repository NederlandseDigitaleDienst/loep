import { LANE_LABEL_NL, runningStep, slowestLane, SWEEP_COEFFICIENTS, sweepPlans, type RunningStep, type SweepWork } from "./estimate-sweep.ts";
import type { StepProgress, SweepCommand } from "./progress.ts";
import type { AgentPhaseId, AgentPhaseTiming, StageTiming, StepStage } from "./timing.ts";
import { FINISH_FACTOR } from "./verdict.ts";

/**
 * What the estimate was calibrated on. The numbers below belong to this code: `collect` and
 * `states` became slower between the measurements because the toolbox measures more, so an
 * estimate is only as good as the distance between this commit and the one that runs.
 */
export const CALIBRATION = {
  toolboxVersion: "0.0.1",
  commit: "5051033",
  date: "2026-10-13",
  runs: [
    { name: "meting-v2", date: "2026-10-10", site: "lokale testsite", pages: 20, pageTypes: 15, atOnce: 10 },
    { name: "tweeling-v2", date: "2026-10-10", site: "lokale testsite (schone tweeling)", pages: 20, pageTypes: 16, atOnce: 10 },
    { name: "klein-2", date: "2026-10-11", site: "lokale testsite, 17 criteria", pages: 20, pageTypes: 8, atOnce: 8 },
    { name: "nerds-v2", date: "2026-10-10", site: "nerds.digitaledienst.overheid.nl", pages: 29, pageTypes: 11, atOnce: 8 },
    { name: "nerds-v3", date: "2026-10-11", site: "nerds.digitaledienst.overheid.nl", pages: 29, pageTypes: 18, atOnce: 8 },
    { name: "nerds-v4", date: "2026-10-13", site: "nerds.digitaledienst.overheid.nl", pages: 29, pageTypes: 18, atOnce: 8 },
  ],
} as const;

/**
 * Every number the estimate uses, with where it comes from. All times are minutes. "Local" is a
 * site on this machine (the test site), "remote" any other; with one site of each kind the
 * difference is as much the weight of the pages as the distance. Per run the measured value is
 * given in the order of `CALIBRATION.runs`: meting-v2, tweeling-v2, klein-2, nerds-v2, nerds-v3, nerds-v4.
 */
export const COEFFICIENTS = {
  /** One explorer, from its task to the last `check-site`: 8.9, 8.1, 17.1, 6.0, 11.6, 8.2 (median 8.5, mean 10.0). Not tied to the size of the site in these runs. */
  exploreMinutes: 10,
  /**
   * The sweep, per page from what the run knows of each page and laid out as `--at-once` runs it; see
   * `lib/estimate-sweep.ts`. The calibration runs above reckoned it with a fixed time per page:
   * `collect` 0.83 minutes local and 1.14 remote, `contrast` 0.065 and 0.1, `states` 0.6 and 0.84.
   * That held for the sites they were made on and not for a site with many more links per page, a
   * slow one, or `states` with the groups at the same time: there the slowest group sets the pace.
   */
  sweep: SWEEP_COEFFICIENTS,
  /** The gate with the agent that looks at the sheets, from the first to the last verdict: 1.4, 0.9, 1.3, 2.4, 2.7, 1.2. The two highest sent the explorer back once. */
  gateMinutes: 1.5,
  /**
   * One agent from start to result, the reading before its session and the writing after it
   * included: the stop of its session minus the start of its group. Walks 5.6 and 4.8 local,
   * 6.1, 6.9, 7.5 remote. Judges 4.0 local, 4.8 and 4.6 remote. Verifiers 2.7 and 3.1 local,
   * 3.7, 3.8, 3.8 remote. tweeling-v2 was interrupted for hours while judging and is left out there.
   */
  agentMinutes: {
    walks: { local: 5.2, remote: 7.2 },
    judges: { local: 4.0, remote: 4.7 },
    verifiers: { local: 2.9, remote: 3.8 },
    /** Not measured: no run was made with a finishing round yet. Reckoned as a judge times the room the round gets (`FINISH_FACTOR`). */
    finishers: { local: 4.0 * FINISH_FACTOR, remote: 4.7 * FINISH_FACTOR },
  },
  /**
   * The share of the criteria that needs a finishing round. Nobody knows it before the verifiers
   * are in. The one run it was counted on (nerds-v4) left 8 of 55 criteria open through the
   * evaluation itself: 15 percent. The estimate reckons with that and shows the band from none
   * to twice as many. After the sweep was made to measure more, fewer are expected.
   */
  finishShare: { low: 0, expected: 0.15, high: 0.3 },
  /**
   * With a pool a phase takes `agentMinutes × (agents ÷ at once + tail)`: the tail is how long the
   * last agents run on after the average. From replaying the measured agents of nerds-v3, nerds-v4
   * and meting-v2 through a pool: walks 0.5, 0.5, 0.5; judges 1.3, 1.0, 1.1; verifiers 0.5, 0.4, 1.2.
   * No run was made with the pool yet, so this is calculated and not measured.
   */
  poolTail: { walks: 0.5, judges: 1.0, verifiers: 0.75, finishers: 1.0 },
  /**
   * The slowest agent of a group against the average agent, with 8 and 10 at once: walks 1.1, 1.13,
   * 1.12; judges 1.9, 1.67, 1.78; verifiers 2.3, 1.84, 1.6. A phase in groups takes
   * `agentMinutes × slowestOfGroup × groups`; that is how the six runs were made. With no more
   * agents than run at once it is also what a pool takes.
   */
  slowestOfGroup: { walks: 1.12, judges: 1.75, verifiers: 1.75, finishers: 1.75 },
  /** `evaluate`, `render` and `seal`: 0.1 to 0.3 for `evaluate`; the other two leave no step and take less than a minute together. */
  reportMinutes: 1,
  /** Whoever leads the audit between the steps, and the round of the workflow that asks what is open: total minus the parts, 3.5, 1.8, 4.3, 2.7 and 3.5 in the runs that were not interrupted. */
  betweenMinutes: 3.5,
  /**
   * Tokens per agent of the workflow: 16.6 million (nerds-v3) and 16.9 million (nerds-v4) for 134
   * agents each, as the workflow reported them. The runs themselves hold no token counts, so
   * this cannot be recomputed from their files. Without the explorer, the gate and whoever leads.
   */
  tokensPerAgent: 125_000,
  /** The workflow asks the toolbox what is open once per phase and once at the end; each time is a small agent, and the 134 above count them: 18 + 56 + 56 + 4. A finishing round adds one. */
  statusRounds: 4,
  /**
   * The range around what is still to come. Not a statistic: six runs on two sites carry none.
   * Between two versions `collect` took a third longer and `states` twice as long on the same
   * site, and a phase with agents differed up to 15 percent between two equal runs. Slower is
   * more likely than faster (a second attempt, the gate sending the explorer back, a slow site).
   */
  margin: { low: 0.75, high: 1.4 },
  tokensMargin: { low: 0.85, high: 1.2 },
} as const;

/** What a run with this code is not calibrated for, said with every estimate. A slow site is, once the inventory timed its pages. */
export const NOT_COVERED_NL = [
  "documenten van de site (pdf, Office): het ophalen en inlezen is in geen van de gemeten runs meegeteld",
  "video en geluid: uitschrijven en beluisteren is niet gemeten",
  "veel bevindingen: een verifieerder krijgt tijd per bevinding, en de gemeten sites hadden er weinig per criterium",
  "een site achter een inlog, en een tweede ronde van de veegronde nadat de poort gaten vond",
] as const;

/** Said when the inventory did not time the pages: the sweep is then reckoned with a load as on the calibration sites. */
export const SLOW_SITE_NOT_COVERED_NL = "een trage site: deze inventaris heeft de laadtijd van de pagina's niet gemeten, dus de veegronde is gerekend met een laadtijd zoals op de gemeten sites. Draai inventory opnieuw met deze versie om de laadtijd mee te tellen";

/** Said when it is: what was counted, and what the load of a page in the inventory does not say. */
export const SLOW_SITE_NOTE = "een site die tijdens het onderzoek trager wordt dan bij de inventaris, of die meer pagina's tegelijk slecht verdraagt";

export type Scheduling = "pool" | "groups";
export type RowId = "inventory" | "explore" | "collect" | "contrast" | "states" | "gate" | AgentPhaseId | "report" | "between";

/** What the estimate is computed from, and where each number was read. */
export interface EstimateBasis {
  pages: number;
  pagesSource: "sample" | "inventory";
  pageTypes: number;
  pageTypesSource: "tasks" | "site" | "inventory";
  criteria: number;
  criteriaSource: "tasks" | "catalogue";
  atOnce: number;
  atOnceSource: "option" | "session" | "default";
  /** Pages (passes, groups of probes) the sweep measures at the same time, when more than one: the number given with `--at-once`, or the one the sweep of the run used. Absent is one. */
  sweepAtOnce?: number;
  /** What the sweep has to do per page. Absent: so many typical pages. */
  sweep?: SweepWork;
  local: boolean;
  scheduling: Scheduling;
  /** The criteria that get a finishing round, once the tasks say so. Absent while nobody knows: then the estimate reckons with a share of the criteria and shows a band. */
  finishers?: number;
}

/** What the run says is done, and how long it took. */
export interface Progress {
  stages: Partial<Record<StepStage, StageTiming>>;
  phases: AgentPhaseTiming[];
  /** The parts that are over. A phase with agents is over when the next one began. */
  done: RowId[];
  /** Seconds from the begin of the first step to the last thing the run recorded. */
  elapsedSeconds: number;
  /** A step of the sweep that runs, with how far it says it is. */
  running?: Partial<Record<SweepCommand, StepProgress>>;
  /** When the estimate is made: a step that runs went on since it last wrote its progress. */
  now?: string;
}

export interface EstimateRow {
  id: RowId;
  labelNl: string;
  /** Null for the inventory: it is over before there is anything to estimate from. */
  estimatedSeconds: number | null;
  measuredSeconds: number | null;
  status: "done" | "running" | "todo";
  /** Measured from the step before, in a run without begin times. */
  derived: boolean;
  /** What is still to come of this part, by the estimate. */
  remainingSeconds: number;
  noteNl?: string;
  /** For a part whose size nobody knows yet: the least and the most it is expected to take. */
  bandSeconds?: [number, number];
}

export interface Estimate {
  basis: EstimateBasis;
  rows: EstimateRow[];
  totals: {
    estimatedSeconds: number;
    estimatedRange: [number, number];
    measuredSeconds: number;
    remainingSeconds: number;
    remainingRange: [number, number];
    finished: boolean;
  };
  tokens: { agents: number; estimated: number; range: [number, number] };
  /** How the sweep was reckoned: from what per page, how many at once, and per step the seconds of each lane as it runs next to the others. */
  sweep: {
    source: SweepWork["source"];
    atOnce: number;
    /** The mean and the slowest load of a page in the inventory; null when it did not time them. */
    loadSeconds: { mean: number; most: number } | null;
    steps: Record<SweepCommand, { seconds: number; atOnce: number; lanes: Record<string, number> }>;
  };
  calibration: typeof CALIBRATION;
  notCoveredNl: readonly string[];
}

const LABEL_NL: Record<RowId, string> = {
  inventory: "inventaris",
  explore: "verkennen (één agent, check-site)",
  collect: "collect",
  contrast: "contrast",
  states: "states",
  gate: "poort (gate, bladen bekijken)",
  walks: "rondgangen",
  judges: "beoordelen",
  verifiers: "verifiëren",
  finishers: "afmaakronde",
  report: "rapport (evaluate, render, seal)",
  between: "tussen de stappen",
};

/** Minutes one phase with agents takes for `agents` agents with `atOnce` at a time. */
export function phaseMinutes(phase: AgentPhaseId, agents: number, basis: Pick<EstimateBasis, "atOnce" | "local" | "scheduling">): number {
  if (agents <= 0) return 0;
  const each = COEFFICIENTS.agentMinutes[phase][basis.local ? "local" : "remote"];
  const atOnce = Math.max(1, basis.atOnce);
  const slowest = COEFFICIENTS.slowestOfGroup[phase];
  // One agent is one agent; a single group ends with its slowest one.
  if (agents === 1) return each;
  if (basis.scheduling === "groups") return each * slowest * Math.ceil(agents / atOnce);
  return agents <= atOnce ? each * slowest : each * (agents / atOnce + COEFFICIENTS.poolTail[phase]);
}

/** The work of the sweep when nothing was counted per page: so many typical pages, one per page type with a template of its own. */
export function typicalSweep(basis: Pick<EstimateBasis, "pages" | "pageTypes">): SweepWork {
  const typical = SWEEP_COEFFICIENTS.typicalPage;
  return {
    pages: Array.from({ length: basis.pages }, (_, index) => ({ loadSeconds: null, links: typical.links, controls: typical.controls, forms: typical.forms, newTemplate: index < basis.pageTypes, arrowWalks: null, newOperable: null, pressable: null })),
    source: "typical",
    narrowPages: basis.pageTypes,
    modelStates: basis.pageTypes,
    capturedStates: basis.pageTypes,
    navigationDelaySeconds: 1,
    limits: { press: 600, hover: 400 },
  };
}

const AGENTS_OF = (basis: EstimateBasis): Record<AgentPhaseId, number> => ({ walks: basis.pageTypes, judges: basis.criteria, verifiers: basis.criteria, finishers: basis.finishers ?? Math.ceil(basis.criteria * COEFFICIENTS.finishShare.expected) });
const PHASE_IDS: readonly RowId[] = ["walks", "judges", "verifiers", "finishers"];

/**
 * The expected time per part and in total. A part that is over shows what was measured and
 * has nothing left; a phase that runs has left what its open agents take. Pure: the same
 * basis and progress give the same estimate.
 */
export function estimate(basis: EstimateBasis, progress: Progress = { stages: {}, phases: [], done: [], elapsedSeconds: 0 }): Estimate {
  const agents = AGENTS_OF(basis);
  const ranFinishers = progress.phases.some((phase) => phase.phase === "finishers");
  // A run that is over without a finishing round had none: nothing is estimated for it and it gets no row.
  const noFinish = progress.done.includes("report") && !ranFinishers && basis.finishers === undefined;
  if (noFinish) agents.finishers = 0;
  // Until the tasks say how many criteria need the round, its size is a band and not a number.
  const finishUnknown = basis.finishers === undefined && !noFinish && !ranFinishers;
  const finishBand = finishUnknown
    ? ([COEFFICIENTS.finishShare.low, COEFFICIENTS.finishShare.high].map((share) => Math.round(phaseMinutes("finishers", Math.ceil(basis.criteria * share), basis) * 60)) as [number, number])
    : null;
  const work = basis.sweep ?? typicalSweep(basis);
  const plans = sweepPlans(work, basis.sweepAtOnce ?? 1, basis.local);
  const running: Partial<Record<SweepCommand, RunningStep>> = Object.fromEntries(
    Object.entries(progress.running ?? {}).map(([command, step]) => [command, runningStep(plans[command as SweepCommand], step, progress.now)]),
  );
  const minutes: Record<Exclude<RowId, "inventory">, number> = {
    explore: COEFFICIENTS.exploreMinutes,
    collect: plans.collect.seconds / 60,
    contrast: plans.contrast.seconds / 60,
    states: plans.states.seconds / 60,
    gate: COEFFICIENTS.gateMinutes,
    walks: phaseMinutes("walks", agents.walks, basis),
    judges: phaseMinutes("judges", agents.judges, basis),
    verifiers: phaseMinutes("verifiers", agents.verifiers, basis),
    finishers: phaseMinutes("finishers", agents.finishers, basis),
    report: COEFFICIENTS.reportMinutes,
    between: COEFFICIENTS.betweenMinutes,
  };
  const rows: EstimateRow[] = [];
  const phaseOf = (id: RowId): AgentPhaseTiming | undefined => progress.phases.find((phase) => phase.phase === id);
  for (const id of ["inventory", "explore", "collect", "contrast", "states", "gate", "walks", "judges", "verifiers", "finishers", "report"] as const) {
    if (id === "finishers" && noFinish) continue;
    const estimatedSeconds = id === "inventory" ? null : Math.round(minutes[id] * 60);
    const phase = phaseOf(id);
    const stage = PHASE_IDS.includes(id) ? undefined : progress.stages[id as StepStage];
    const done = progress.done.includes(id);
    const measuredSeconds = phase?.seconds ?? stage?.seconds ?? null;
    let remainingSeconds = done || estimatedSeconds === null ? 0 : estimatedSeconds;
    let status: EstimateRow["status"] = done ? "done" : "todo";
    let noteNl: string | undefined;
    if (!done && phase) {
      const open = Math.max(0, agents[phase.phase] - phase.stopped);
      status = "running";
      remainingSeconds = Math.round(phaseMinutes(phase.phase, open, basis) * 60);
      noteNl = `${phase.stopped} van ${agents[phase.phase]} klaar`;
    }
    const sweepStep = id === "collect" || id === "contrast" || id === "states" ? id : null;
    const ongoing = sweepStep && !done ? running[sweepStep] : undefined;
    if (ongoing) {
      status = "running";
      remainingSeconds = ongoing.remainingSeconds;
      noteNl = runningNoteNl(sweepStep!, ongoing);
    } else if (sweepStep === "states" && !done && plans.states.atOnce > 1) {
      const slowest = slowestLane(plans.states);
      if (slowest) noteNl = `de traagste groep, ${LANE_LABEL_NL[slowest.id]}, bepaalt de duur`;
    }
    if (id === "inventory" && measuredSeconds === null) continue;
    if (id === "finishers" && !phase) {
      const share = COEFFICIENTS.finishShare;
      if (finishBand) noteNl = `aantal vooraf onbekend: gerekend met ${agents.finishers} van ${basis.criteria} criteria, ${durationNl(finishBand[0])} (geen) tot ${durationNl(finishBand[1])} (${Math.ceil(basis.criteria * share.high)}); niet gemeten`;
      else if (agents.finishers === 0) noteNl = "niet nodig: geen criterium bleef open door het onderzoek zelf";
      else noteNl = `${agents.finishers} criteria bleven open door het onderzoek zelf; niet gemeten`;
    }
    rows.push({ id, labelNl: LABEL_NL[id], estimatedSeconds, measuredSeconds: ongoing ? ongoing.elapsedSeconds : done || phase ? measuredSeconds : null, status, derived: done && (stage?.derived ?? false), remainingSeconds, ...(noteNl ? { noteNl } : {}), ...(id === "finishers" && finishBand && !done ? { bandSeconds: finishBand } : {}) });
  }
  // What nobody's step is: the share of it that is still to come follows the share of the work that is.
  const workEstimated = rows.reduce((sum, row) => sum + (row.estimatedSeconds ?? 0), 0);
  const workRemaining = rows.reduce((sum, row) => sum + row.remainingSeconds, 0);
  const finished = progress.done.includes("report");
  const betweenEstimated = Math.round(minutes.between * 60);
  const measuredParts = rows.reduce((sum, row) => sum + (row.measuredSeconds ?? 0), 0);
  rows.push({
    id: "between",
    labelNl: LABEL_NL.between,
    estimatedSeconds: betweenEstimated,
    measuredSeconds: finished ? Math.max(0, progress.elapsedSeconds - measuredParts) : null,
    status: finished ? "done" : workRemaining < workEstimated ? "running" : "todo",
    derived: false,
    remainingSeconds: workEstimated === 0 ? 0 : Math.round((betweenEstimated * workRemaining) / workEstimated),
  });
  const estimatedSeconds = workEstimated + betweenEstimated;
  const remainingSeconds = rows.reduce((sum, row) => sum + row.remainingSeconds, 0);
  // The margin holds for what is counted; a part of unknown size widens it by its own band, from nothing to its most.
  const band = rows.find((row) => row.bandSeconds && row.remainingSeconds > 0);
  const [less, more] = band ? [band.remainingSeconds - band.bandSeconds![0], band.bandSeconds![1] - band.remainingSeconds] : [0, 0];
  const range = (seconds: number): [number, number] => [Math.round((seconds - less) * COEFFICIENTS.margin.low), Math.round((seconds + more) * COEFFICIENTS.margin.high)];
  const usual = agents.walks + agents.judges + agents.verifiers + COEFFICIENTS.statusRounds;
  const agentCount = usual + agents.finishers + (agents.finishers > 0 ? 1 : 0);
  // An agent of the finishing round is reckoned at as many times the tokens as it gets room; not measured.
  const tokens = Math.round((usual + (agents.finishers > 0 ? 1 : 0) + agents.finishers * FINISH_FACTOR) * COEFFICIENTS.tokensPerAgent);
  return {
    basis,
    rows,
    totals: { estimatedSeconds, estimatedRange: range(estimatedSeconds), measuredSeconds: progress.elapsedSeconds, remainingSeconds, remainingRange: range(remainingSeconds), finished },
    tokens: { agents: agentCount, estimated: tokens, range: [Math.round(tokens * COEFFICIENTS.tokensMargin.low), Math.round(tokens * COEFFICIENTS.tokensMargin.high)] },
    sweep: {
      source: work.source,
      atOnce: basis.sweepAtOnce ?? 1,
      loadSeconds: loadSecondsOf(work),
      steps: Object.fromEntries((["collect", "contrast", "states"] as const).map((command) => [command, { seconds: plans[command].seconds, atOnce: plans[command].atOnce, lanes: Object.fromEntries(plans[command].lanes.map((lane) => [lane.id, Math.round(lane.parts.reduce((total, part) => total + part.units.reduce((a, b) => a + b, 0), 0) * plans[command].slowdown)])) }])) as Estimate["sweep"]["steps"],
    },
    calibration: CALIBRATION,
    notCoveredNl: loadSecondsOf(work) ? [...NOT_COVERED_NL, SLOW_SITE_NOTE] : [SLOW_SITE_NOT_COVERED_NL, ...NOT_COVERED_NL],
  };
}

/** The load of the pages as the inventory timed them; null when it timed none or not all. */
function loadSecondsOf(work: SweepWork): { mean: number; most: number } | null {
  const loads = work.pages.map((page) => page.loadSeconds);
  if (loads.length === 0 || loads.some((load) => load === null)) return null;
  const known = loads as number[];
  return { mean: Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10, most: Math.round(Math.max(...known) * 10) / 10 };
}

const decimalNl = (value: number): string => String(value).replace(".", ",");

/** Where a step of the sweep that runs is, as a reader wants to know it. */
function runningNoteNl(command: SweepCommand, step: RunningStep): string {
  const parts: string[] = [];
  if (step.pages) parts.push(`${step.pages.done} van ${step.pages.total} pagina's`);
  else parts.push(`${step.lanesDone} van ${step.lanes} ${command === "contrast" ? "rondes" : "groepen"} klaar`);
  const slowest = step.slowest;
  if (!step.pages && slowest) parts.push(`${LANE_LABEL_NL[slowest.id] ?? slowest.id} ${slowest.part ? `bij ${slowest.part === "pages" ? "pagina" : slowest.part} ${slowest.done} van ${slowest.total}` : "nog niet begonnen"}`);
  if (step.pace !== null) parts.push(step.pace >= 1 ? `${decimalNl(step.pace)} keer zo lang als geschat` : `in ${Math.round(step.pace * 100)} procent van de geschatte tijd`);
  else parts.push("nog geen tempo: gerekend met de schatting");
  return parts.join("; ");
}

/** What the sweep was reckoned from, in one line. */
function sweepBasisNl(result: Estimate): string {
  const work = result.basis.sweep;
  const from = { inventory: "de tellingen van de inventaris", collect: "de metingen van collect", typical: "een gewone pagina" }[result.sweep.source];
  const operable = work && result.sweep.source !== "typical" ? work.pages.map((page) => (page.links ?? 0) + (page.controls ?? 0)) : [];
  const counts = operable.length > 0 ? `, ${Math.min(...operable)} tot ${Math.max(...operable)} links en bedieningselementen per pagina` : "";
  const load = result.sweep.loadSeconds ? `, laadtijd gemiddeld ${decimalNl(result.sweep.loadSeconds.mean)} s (traagste ${decimalNl(result.sweep.loadSeconds.most)} s)` : ", laadtijd niet gemeten";
  return `Veegronde per pagina gerekend uit ${from}${counts}${load}.`;
}

/** "45 s", "33 min" or "3 u 05": a time as a reader says it. */
export function durationNl(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} u ${String(minutes % 60).padStart(2, "0")}`;
}

const millionsNl = (tokens: number): string => (tokens / 1_000_000).toFixed(1).replace(".", ",");

/** The estimate as a short table for a reader. `runName` is how the run is called, not its path. */
export function estimateTextNl(result: Estimate, runName: string, notesNl: string[] = []): string {
  const { basis, totals } = result;
  const source = { sample: "steekproef", inventory: "inventaris", tasks: "opdrachten", site: "sitemodel", catalogue: "catalogus", option: "opgegeven", session: "sessieproces", default: "standaard" } as const;
  const lines = [
    `Duur van ${runName}: ${basis.pages} pagina's (${source[basis.pagesSource]}), ${basis.pageTypes} paginatypen (${source[basis.pageTypesSource]}), ${basis.criteria} criteria (${source[basis.criteriaSource]}),`,
    `${basis.atOnce} agents tegelijk (${source[basis.atOnceSource]}), ${basis.scheduling === "pool" ? "in een pool" : "in groepen"}, ${(basis.sweepAtOnce ?? 1) > 1 ? `veegronde ${basis.sweepAtOnce} tegelijk, ` : ""}${basis.local ? "site op deze machine" : "site elders"}`,
    sweepBasisNl(result),
    "",
  ];
  const table = [["onderdeel", "geschat", "gemeten", ""]];
  for (const row of result.rows) {
    const measured = row.measuredSeconds === null ? "" : `${row.derived ? "~" : ""}${durationNl(row.measuredSeconds)}`;
    const state = row.status === "done" ? `klaar${row.noteNl && row.measuredSeconds === null ? `, ${row.noteNl}` : ""}` : row.status === "running" ? `loopt${row.noteNl ? `, ${row.noteNl}` : ""}, nog ${durationNl(row.remainingSeconds)}` : (row.noteNl ?? "");
    table.push([row.labelNl, row.estimatedSeconds === null ? "" : durationNl(row.estimatedSeconds), measured, state]);
  }
  table.push(["totaal", durationNl(totals.estimatedSeconds), totals.measuredSeconds > 0 ? durationNl(totals.measuredSeconds) : "", totals.finished ? "klaar" : ""]);
  const widths = [0, 1, 2].map((column) => Math.max(...table.map((cells) => cells[column]!.length)));
  for (const cells of table) lines.push(`${cells[0]!.padEnd(widths[0]!)}  ${cells[1]!.padStart(widths[1]!)}  ${cells[2]!.padStart(widths[2]!)}  ${cells[3]}`.trimEnd());
  lines.push("");
  const percent = `${Math.round((1 - COEFFICIENTS.margin.low) * 100)} procent korter tot ${Math.round((COEFFICIENTS.margin.high - 1) * 100)} procent langer`;
  if (totals.finished) {
    const [low, high] = totals.estimatedRange;
    const difference = totals.measuredSeconds - totals.estimatedSeconds;
    lines.push(`Geschat ${durationNl(totals.estimatedSeconds)} (marge ${durationNl(low)} tot ${durationNl(high)}), gemeten ${durationNl(totals.measuredSeconds)}: ${durationNl(Math.abs(difference))} ${difference >= 0 ? "langer" : "korter"} dan geschat, ${totals.measuredSeconds >= low && totals.measuredSeconds <= high ? "binnen" : "buiten"} de marge.`);
  } else {
    const [low, high] = totals.remainingRange;
    // A part of unknown size makes the margin wider than the percentages: from none of it to its most.
    const unknown = result.rows.some((row) => row.bandSeconds && row.remainingSeconds > 0) ? ", en de afmaakronde van niets tot haar meeste" : "";
    lines.push(`Nog te gaan: ongeveer ${durationNl(totals.remainingSeconds)} (marge ${durationNl(low)} tot ${durationNl(high)}: ${percent}${unknown}).`);
    if (totals.measuredSeconds > 0) lines.push(`Tot nu toe ${durationNl(totals.measuredSeconds)}; het geheel komt daarmee op ongeveer ${durationNl(totals.measuredSeconds + totals.remainingSeconds)}.`);
  }
  if (result.rows.some((row) => row.derived)) lines.push("~ gemeten vanaf de stap ervoor: deze run legde het begin van een stap nog niet vast.");
  lines.push(`Tokens voor de ${result.tokens.agents} agents van de werkstroom: ongeveer ${millionsNl(result.tokens.estimated)} miljoen (marge ${millionsNl(result.tokens.range[0])} tot ${millionsNl(result.tokens.range[1])}), zonder de verkenner, de poort en wie het onderzoek leidt.`);
  for (const note of notesNl) lines.push(`Let op: ${note}`);
  lines.push("");
  const calibration = result.calibration;
  lines.push(`Geijkt op ${calibration.runs.length} runs op twee sites (${calibration.runs.map((run) => run.name).join(", ")}), gemaakt met loep ${calibration.toolboxVersion} tot en met commit ${calibration.commit} van ${calibration.date}. De veegronde werd tussen die runs trager omdat de toolbox meer ging meten: de schatting hoort bij deze versie. Zes runs op twee sites is weinig; de marge is een keuze en geen statistiek.`);
  if (basis.scheduling === "pool") lines.push("De fasen met agents zijn gerekend met een pool die steeds het volle aantal agents laat lopen. Zo is nog geen run gemeten: de zes runs liepen in groepen (reken die na met --groups).");
  lines.push(`Niet gedekt: ${result.notCoveredNl.join("; ")}.`);
  return `${lines.join("\n")}\n`;
}
