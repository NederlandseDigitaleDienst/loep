import type { StepProgress, SweepCommand } from "./progress.ts";

/**
 * The sweep (`collect`, `contrast`, `states`) reckoned per page, from what the run knows about each
 * page: how long it takes to load, and how much there is to operate on it. A step is laid out the
 * way the command does its work with `--at-once`: `collect` takes the pages n at a time, `contrast`
 * runs its four passes over all pages, at most four at once, and `states` its five groups of probes
 * at the same time, with the pages within a group spread over the same n browsers, except the forms
 * and buttons, which go page after page. A step takes as long as its slowest lane, and `states` no
 * less than all its work shared over its browsers.
 *
 * Every time is seconds. A page costs the loads the command does for it, each as long as the page
 * took to load in the inventory, plus the work of the command on the page, which grows with the
 * links and other controls on it. The probes of `states` that press and point at controls stop at
 * their limits: after that a page costs its loads only.
 */

/** What one page of the sample asks of the sweep, as far as the run knows it. */
export interface PageWork {
  /** Seconds the page took to load and settle in the inventory; null when the inventory did not time it. */
  loadSeconds: number | null;
  /** Links and other controls on the page; null when nobody counted them. */
  links: number | null;
  controls: number | null;
  forms: number;
  /** The first page of the sample with its template (the components it is built from). Its links are new to `contrast`; on a later page with the same template most were measured already. */
  newTemplate: boolean;
  /** Walks with the arrow keys that `collect` found on the page; null before `collect`. */
  arrowWalks: number | null;
  /**
   * Links and controls no earlier page of the sample had, keyed as the probes of `states` key them (element,
   * text, region), from the measurements of `collect`; null before `collect`. These are what the pointer and
   * press probes act on: the rest they saw already.
   */
  newOperable: number | null;
  /** Whether the page listens for a press (mousedown, pointerdown, touchstart), as `collect` found; null before `collect`. Only such a page gets the press probe. */
  pressable: boolean | null;
}

export interface SweepWork {
  pages: PageWork[];
  /** Where the counts per page come from: the inventory, the measurements of `collect`, or nowhere (a typical page). */
  source: "inventory" | "collect" | "typical";
  /** Pages measured again in the narrow window by the pointer probes: one per page type. */
  narrowPages: number;
  /** States of the site model (blockers, components, processes): `states` probes keys, pointer and press in each. */
  modelStates: number;
  /** States `collect` captures: each blocker in four variants (light, dark, narrow, narrow and dark), each component and process once. */
  capturedStates: number;
  /** Seconds between two navigations to the site while more than one page, pass or group runs. */
  navigationDelaySeconds: number;
  /** The limits of the probes of `states` over all pages: kinds of control pressed, and controls pointed at. */
  limits: { press: number; hover: number };
}

/**
 * Every number of the sweep model, with where it comes from: five sweeps measured in the week of
 * 2026-10-16, on a site elsewhere (223 pages one at a time, 19 pages six at a time), on a second site
 * elsewhere (11 pages) and on the local test site (19 pages, one and four at a time); see
 * `docs/methode.md`. The time of a load is not in here: it is read per page from the inventory.
 */
export const SWEEP_COEFFICIENTS = {
  /** A load when the inventory did not time it: the test site loads and settles in about half a second, the site elsewhere that was measured in 0.84. */
  loadSeconds: { local: 0.5, remote: 1 },
  /** A page when nothing was counted: about what the test site has. */
  typicalPage: { links: 30, controls: 15, forms: 2 },
  collect: {
    /** Loads per page: light, dark, three sizes, 320 wide, narrow, between the widths, skip link, motion, text spacing. */
    loads: 11,
    perPage: 2,
    /**
     * A link is walked to with Tab three times (light, dark, narrow), with a picture of its focus each time.
     * Per page of a sequential `collect`: 1.19 seconds per link on 83 pages elsewhere (r² 0.97, 30 to 176
     * links a page), 1.21 on the 19 pages of the test site. Other controls weigh less: many are no stop of their own.
     */
    perLink: 1.15,
    perControl: 0.2,
    /** A state of the site model is opened by its recipe and measured with less than a page: this share of the mean page. 14 seconds a state on the test site, about 55 elsewhere. */
    capturedStateShare: 0.45,
  },
  contrast: {
    /** One page in one pass, besides its load: 0.36 seconds at 320 wide on 223 pages elsewhere. */
    perPage: 0.4,
    /**
     * In the two passes in the default window every link and button is measured under the pointer and with
     * focus, on the first page it stands on: 0.15 seconds each on pages with a template of their own (223 pages
     * elsewhere, 14.5 seconds a page in each pass), about a third of that on a page whose template came before.
     */
    perOperable: 0.15,
    laterTemplateShare: 0.3,
  },
  states: {
    /**
     * Forms and buttons: each page twice in the default window (forms, settings) and once narrow, and each
     * button that is new once on a fresh page. On the test site 6 seconds a page in the default window with
     * two or three forms, 1 narrow, and 10 for a button; 7, 22 and 84 buttons on runs of 19, 19 and 223 pages.
     */
    forms: { perPage: 1.5, perForm: 1.6, narrowPerPage: 0.5, triggerShare: 0.15, perTrigger: 9 },
    /** The single keys on every page; a page loads again after a key that did something. 7 seconds a page on the test site, where many keys do something; less elsewhere. */
    keys: { perPage: 4.5 },
    /** The single keys in every state of the model, opened by its recipe: 7 and 10 seconds on the test site. */
    keysInStates: { perState: 8 },
    /**
     * Pointing at and pressing controls, on the links and controls a page adds to the pages before it: the
     * press probe pressed nearly exactly those on two sites elsewhere (122 of 123 on the first page, 49 of 49,
     * 47 of 50, 74 of 74 and so on until its limit; 85 presses for 81 new on another site, the narrow window
     * and the states included). Before `collect` counted them, all of the first page are new and a third of
     * each page after it (574 new of 1497 on 19 pages, 81 of 183, 116 of 893 on the test site). Half of the
     * new ones are pointed at (the test site: 27 of 52 on its
     * first page). A press takes about a second, and a fresh page when it did something; pointing about 1.2.
     * Only a page that listens for a press is pressed on.
     */
    pointer: { perPage: 0.5, newShare: { first: 1, later: 0.3 }, hoverPerNew: 0.5, perHover: 1.2, perPress: 1, freshAfterPress: 0.2, perState: 6 },
    /** Each walk with the arrow keys again, on a fresh page; before `collect` a page is reckoned to have this many walks. */
    arrows: { perWalk: 3, walksPerPage: 0.3 },
    /**
     * The groups whose pages run at the same time, over the browsers of `--at-once` that all groups share
     * (issue 60). The forms and buttons go page after page: a button is operated only on the first page it
     * stands on, and a setting is changed once. The states of the site model go one after the other in every group.
     */
    groupsWithPagesAtOnce: ["keys", "pointer", "arrows"],
  },
  /**
   * How much slower one page, pass or group gets when more run at once: `1 + (at once − 1) × slowdown`.
   * The browsers share this machine and the site. From the run elsewhere with six at once: `states` took
   * 30 minutes for a slowest group reckoned at 24, `contrast` 5 for 4. On the test site the groups of
   * `states` took as long with four at once as with one, and `collect` was even faster per page.
   */
  slowdown: { collect: 0.1, contrast: 0.08, states: 0.06 },
} as const;

/** The labels of the lanes as a reader knows them. */
export const LANE_LABEL_NL: Record<string, string> = {
  pages: "pagina's",
  siteStates: "toestanden uit het sitemodel",
  light: "licht",
  dark: "donker",
  "light-320": "licht 320 breed",
  "dark-320": "donker 320 breed",
  forms: "formulieren en knoppen",
  keys: "toetsen",
  keysInStates: "toetsen in toestanden",
  pointer: "aanwijzen en indrukken",
  arrows: "pijltoetsen",
};

/** One part of a lane: the seconds of each of its pages or states, in order. The id is how the command names the part in its progress. */
export interface PlanPart {
  id: string;
  units: number[];
  /** The part goes over the states of the site model, which a group opens one after the other, also when its pages run at the same time. */
  ofStates?: boolean;
}

export interface PlanLane {
  id: string;
  parts: PlanPart[];
}

/** A step of the sweep laid out as the command runs it. */
export interface StepPlan {
  command: SweepCommand;
  /**
   * `pages`: the units of the first lane are taken `atOnce` at a time (collect), and the lanes after it
   * follow one after the other. `lanes`: whole lanes run `atOnce` at a time (contrast, states).
   */
  spread: "pages" | "lanes";
  lanes: PlanLane[];
  atOnce: number;
  /** Each unit is this much slower for running next to others. */
  slowdown: number;
  /**
   * The step lasts at least this long: for `collect` and `contrast` the navigations, which are spaced with more
   * than one at once; for `states` all the work of its groups shared over the browsers they share.
   */
  floorSeconds: number;
  seconds: number;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const laneSeconds = (lane: PlanLane): number => sum(lane.parts.map((part) => sum(part.units)));

/**
 * When the last job is done with `lanes` working at the same time, each taking the next job in order
 * as soon as it is free. `busy` is what lanes that already run still have to do.
 */
export function makespan(jobs: number[], lanes: number, busy: number[] = []): number {
  const free = [...busy];
  while (free.length < Math.max(1, Math.floor(lanes))) free.push(0);
  for (const job of jobs) {
    let first = 0;
    for (let index = 1; index < free.length; index++) if (free[index]! < free[first]!) first = index;
    free[first]! += job;
  }
  return Math.max(0, ...free);
}

const slower = (command: SweepCommand, atOnce: number): number => 1 + (Math.max(1, atOnce) - 1) * SWEEP_COEFFICIENTS.slowdown[command];

/** A lane whose units are spread over `atOnce`, each the slower for it: the pages of `collect`, and the states it captures after them. */
const spreadSeconds = (lane: PlanLane, plan: Pick<StepPlan, "atOnce" | "slowdown">): number => makespan(lane.parts.flatMap((part) => part.units).map((unit) => unit * plan.slowdown), plan.atOnce);

function layout(plan: Omit<StepPlan, "seconds">): StepPlan {
  const time = plan.spread === "pages" ? sum(plan.lanes.map((lane) => spreadSeconds(lane, plan))) : makespan(plan.lanes.map((lane) => laneSeconds(lane) * plan.slowdown), plan.atOnce);
  return { ...plan, seconds: Math.round(Math.max(time, plan.floorSeconds)) };
}

/** The pages with what is not known filled in from a typical page, and the time of a load. */
function known(work: SweepWork, local: boolean): { load: number; links: number; controls: number; operable: number; page: PageWork }[] {
  const typical = SWEEP_COEFFICIENTS.typicalPage;
  return work.pages.map((page) => {
    const links = page.links ?? typical.links;
    const controls = page.controls ?? typical.controls;
    return { load: page.loadSeconds ?? SWEEP_COEFFICIENTS.loadSeconds[local ? "local" : "remote"], links, controls, operable: links + controls, page };
  });
}

/** The three steps of the sweep for this work, `atOnce` at a time. */
export function sweepPlans(work: SweepWork, atOnce: number, local: boolean): Record<SweepCommand, StepPlan> {
  const pages = known(work, local);
  const delay = Math.max(1, atOnce) > 1 ? work.navigationDelaySeconds : 0;
  const meanLoad = pages.length > 0 ? sum(pages.map((page) => page.load)) / pages.length : SWEEP_COEFFICIENTS.loadSeconds[local ? "local" : "remote"];
  const c = SWEEP_COEFFICIENTS;

  const collectPage = (page: (typeof pages)[number]): number => c.collect.loads * page.load + c.collect.perPage + c.collect.perLink * page.links + c.collect.perControl * page.controls;
  const meanPage = pages.length > 0 ? sum(pages.map(collectPage)) / pages.length : c.collect.loads * meanLoad + c.collect.perPage;
  const collectAtOnce = Math.max(1, Math.min(atOnce, pages.length || 1));
  const collect = layout({
    command: "collect",
    spread: "pages",
    lanes: [
      { id: "pages", parts: [{ id: "pages", units: pages.map(collectPage) }] },
      { id: "siteStates", parts: [{ id: "siteStates", units: Array.from({ length: work.capturedStates }, () => c.collect.capturedStateShare * meanPage) }] },
    ],
    atOnce: collectAtOnce,
    slowdown: slower("collect", collectAtOnce),
    floorSeconds: pages.length * c.collect.loads * delay,
  });

  const passes = ["light", "dark", "light-320", "dark-320"];
  const contrastAtOnce = Math.max(1, Math.min(atOnce, passes.length));
  const contrast = layout({
    command: "contrast",
    spread: "lanes",
    // In the default window every link and button is measured under the pointer and with focus; at 320 wide only the text.
    lanes: passes.map((id) => ({ id, parts: [{ id: "pages", units: pages.map((page) => page.load + c.contrast.perPage + (id.includes("-") ? 0 : c.contrast.perOperable * page.operable * (page.page.newTemplate ? 1 : c.contrast.laterTemplateShare))) }] })),
    atOnce: contrastAtOnce,
    slowdown: slower("contrast", contrastAtOnce),
    floorSeconds: pages.length * passes.length * delay,
  });

  // What the pointer and press probes reach, page by page, until their limits: the controls a page adds to the pages before it.
  const s = c.states;
  const fresh = (page: (typeof pages)[number], index: number): number => page.page.newOperable ?? page.operable * (index === 0 ? s.pointer.newShare.first : s.pointer.newShare.later);
  const reach = (wanted: number[], start: number): { counts: number[]; left: number } => {
    let left = start;
    const counts = wanted.map((want) => {
      const taken = Math.min(left, want);
      left -= taken;
      return taken;
    });
    return { counts, left };
  };
  const pressable = (page: (typeof pages)[number]): boolean => page.page.pressable !== false;
  // In the order the probe goes: every page, then one page per page type narrow, where a control is a kind of its own and the count goes on.
  const narrow = pages.slice(0, Math.min(work.narrowPages, pages.length));
  const freshNarrow = narrow.map((page, index) => (index === 0 ? page.operable : fresh(page, index)));
  const hoverPages = reach(pages.map((page, index) => fresh(page, index) * s.pointer.hoverPerNew), work.limits.hover);
  const hoverNarrow = reach(freshNarrow.map((count) => count * s.pointer.hoverPerNew), hoverPages.left);
  const pressPages = reach(pages.map((page, index) => (pressable(page) ? fresh(page, index) : 0)), work.limits.press);
  const pressNarrow = reach(narrow.map((page, index) => (pressable(page) ? freshNarrow[index]! : 0)), pressPages.left);
  const hover = (page: { load: number }, hovers: number): number => page.load + s.pointer.perPage + hovers * s.pointer.perHover;
  // A page that does not listen for a press is passed by without loading it.
  const press = (page: (typeof pages)[number], presses: number): number => (pressable(page) ? page.load + s.pointer.perPage + presses * (s.pointer.perPress + s.pointer.freshAfterPress * page.load) : 0);
  const triggers = (page: (typeof pages)[number], index: number): number => page.controls * s.forms.triggerShare * (index === 0 ? 1 : s.pointer.newShare.later);
  const groups: PlanLane[] = [
    {
      id: "forms",
      parts: [
        { id: "formulieren en knoppen", units: pages.map((page, index) => 2 * page.load + s.forms.perPage + s.forms.perForm * page.page.forms + triggers(page, index) * (page.load + s.forms.perTrigger)) },
        { id: "knoppen smal", units: pages.map((page) => page.load + s.forms.narrowPerPage) },
      ],
    },
    { id: "keys", parts: [{ id: "toetsen", units: pages.map((page) => page.load + s.keys.perPage) }] },
    { id: "keysInStates", parts: [{ id: "toetsen in toestand", units: Array.from({ length: work.modelStates }, () => meanLoad + s.keysInStates.perState), ofStates: true }] },
    {
      id: "pointer",
      parts: [
        { id: "aanwijzen", units: pages.map((page, index) => hover(page, hoverPages.counts[index]!)) },
        { id: "aanwijzen smal", units: narrow.map((page, index) => hover(page, hoverNarrow.counts[index]!)) },
        { id: "indrukken", units: pages.map((page, index) => press(page, pressPages.counts[index]!)) },
        { id: "indrukken smal", units: narrow.map((page, index) => press(page, pressNarrow.counts[index]!)) },
        { id: "aanwijzen en indrukken in toestand", units: Array.from({ length: work.modelStates }, () => 2 * meanLoad + s.pointer.perState), ofStates: true },
      ],
    },
    { id: "arrows", parts: [{ id: "pijltoetsen", units: pages.map((page) => (page.page.arrowWalks ?? s.arrows.walksPerPage) * (page.load + s.arrows.perWalk)) }] },
  ];
  // With more than one at once the five groups start together and share n browsers with the pages within them:
  // a part over pages of a group in `groupsWithPagesAtOnce` lasts as its pages spread over the n browsers. All
  // the work shared over the browsers is the least the step takes, however the groups fall.
  const browsers = Math.max(1, Math.floor(atOnce));
  const together = new Set<string>(s.groupsWithPagesAtOnce);
  const spread = browsers === 1 ? groups : groups.map((group) => (together.has(group.id) ? { ...group, parts: group.parts.map((part) => (part.ofStates ? part : { ...part, units: [makespan(part.units, browsers)] })) } : group));
  // The slowdown was measured with the groups at the same time, at most five. More browsers for the pages within them were not seen to
  // slow a page further: on ten pages of the test site `states` took 104 seconds with four at once and 92 with eight.
  const statesSlowdown = slower("states", Math.min(browsers, groups.length));
  const states = layout({
    command: "states",
    spread: "lanes",
    lanes: spread,
    atOnce: browsers,
    slowdown: statesSlowdown,
    floorSeconds: browsers === 1 ? 0 : (sum(groups.map(laneSeconds)) * statesSlowdown) / browsers,
  });
  return { collect, contrast, states };
}

/** The lane of a plan that takes longest, with its seconds as it runs next to the others. */
export function slowestLane(plan: StepPlan): { id: string; seconds: number } | null {
  const lanes = plan.spread === "pages" ? [] : plan.lanes.map((lane) => ({ id: lane.id, seconds: Math.round(laneSeconds(lane) * plan.slowdown) }));
  return lanes.reduce<{ id: string; seconds: number } | null>((slowest, lane) => (!slowest || lane.seconds > slowest.seconds ? lane : slowest), null);
}

/** What a running step still has to do, by the pace it kept so far. */
export interface RunningStep {
  /** Seconds from its start to its last update. */
  elapsedSeconds: number;
  remainingSeconds: number;
  /** The measured time against what the plan gave for the same work: above 1 the step is slower than reckoned. Null before anything is done. */
  pace: number | null;
  lanesDone: number;
  lanes: number;
  /** The lane that holds the step up longest, and where it is. */
  slowest: { id: string; part: string | null; done: number; total: number; remainingSeconds: number } | null;
  /** Pages done of all, for `collect`; null for the other steps. */
  pages: { done: number; total: number } | null;
}

/** Below this the pace of a lane says more about its first page than about the lane. */
const PACE_AFTER_SECONDS = 30;

/**
 * Carry on a step that runs from where its progress says it is: each lane at the pace it kept against
 * the plan, and the lanes laid out as the command runs them. A lane that has not begun goes as planned:
 * the groups of `states` and the passes of `contrast` differ too much to take each other's pace. Only
 * the states `collect` captures after its pages follow the pace of the pages. `now` is when the estimate
 * is made: the work since the last update of the progress is taken off what is left.
 */
export function runningStep(plan: StepPlan, progress: StepProgress, now?: string): RunningStep {
  const updated = Date.parse(progress.updatedAt);
  const quiet = now ? Math.max(0, (Date.parse(now) - updated) / 1000) : 0;
  const lanes = plan.lanes.map((lane) => {
    const state = progress.lanes[lane.id];
    const total = laneSeconds(lane);
    if (!state?.startedAt) return { lane, total, done: 0, elapsed: 0, started: false, ended: false, at: null as { part: string; done: number; total: number } | null };
    const ended = state.endedAt !== null;
    // A part the progress names is done as far as it says, also before the last one it names: parts of a group can run
    // at the same time, such as pointing and pressing. A part before the last one named that it does not name is done; one after it is not begun.
    const named = lane.parts.map((part) => state.parts[part.id]);
    const last = named.findLastIndex((entry) => entry !== undefined);
    let done = 0;
    for (const [index, part] of lane.parts.entries()) {
      const entry = named[index];
      if (ended || (index < last && !entry)) done += sum(part.units);
      else if (entry && entry.total > 0) {
        // The command may count a part over more units than the plan has (a page without arrow walks is passed by): take the share.
        const share = Math.min(1, entry.done / entry.total);
        done += part.units.length === entry.total ? sum(part.units.slice(0, entry.done)) : sum(part.units) * share;
      }
    }
    const lastPart = last >= 0 ? lane.parts[last]!.id : null;
    const at = lastPart ? { part: lastPart, done: state.parts[lastPart]!.done, total: state.parts[lastPart]!.total } : null;
    const elapsed = Math.max(0, ((ended ? Date.parse(state.endedAt!) : updated) - Date.parse(state.startedAt)) / 1000);
    return { lane, total, done: ended ? total : Math.min(done, total), elapsed, started: true, ended, at };
  });
  const paced = lanes.filter((entry) => entry.started && entry.done > 0 && (entry.ended || entry.elapsed >= PACE_AFTER_SECONDS));
  // Seconds on the clock per planned second: the slowdown of running next to others, and for pages that are spread, divided over them.
  const planPace = plan.spread === "pages" ? plan.slowdown / plan.atOnce : plan.slowdown;
  const stepPace = paced.length > 0 ? sum(paced.map((entry) => entry.elapsed)) / sum(paced.map((entry) => entry.done)) : null;
  const ratio = stepPace === null ? 1 : stepPace / planPace;
  const left = lanes.map((entry) => {
    if (entry.ended) return { entry, seconds: 0 };
    if (paced.includes(entry)) return { entry, seconds: (entry.total - entry.done) * (entry.elapsed / entry.done) };
    // A lane that has not begun, or has only just: as planned; after the pages of collect at their pace.
    if (plan.spread === "pages") return { entry, seconds: spreadSeconds({ ...entry.lane, parts: [{ id: "rest", units: entry.lane.parts.flatMap((part) => part.units) }] }, plan) * (1 - entry.done / (entry.total || 1)) * ratio };
    return { entry, seconds: (entry.total - entry.done) * planPace };
  });
  let remaining: number;
  if (plan.spread === "pages") remaining = sum(left.map((entry) => entry.seconds));
  else {
    const busy = left.filter((entry) => entry.entry.started && !entry.entry.ended).map((entry) => entry.seconds);
    const waiting = left.filter((entry) => !entry.entry.started).map((entry) => entry.seconds);
    remaining = makespan(waiting, plan.atOnce, busy);
  }
  const open = left.filter((entry) => !entry.entry.ended);
  const holding = open.reduce<(typeof open)[number] | null>((slowest, entry) => (!slowest || entry.seconds > slowest.seconds ? entry : slowest), null);
  const pagesLane = plan.spread === "pages" ? progress.lanes.pages?.parts.pages : undefined;
  return {
    elapsedSeconds: Math.round(Math.max(0, (updated - Date.parse(progress.startedAt)) / 1000 + quiet)),
    remainingSeconds: Math.round(Math.max(0, remaining - quiet)),
    pace: stepPace === null ? null : Math.round(ratio * 100) / 100,
    lanesDone: lanes.filter((entry) => entry.ended).length,
    lanes: lanes.length,
    slowest: holding ? { id: holding.entry.lane.id, part: holding.entry.at?.part ?? null, done: holding.entry.at?.done ?? 0, total: holding.entry.at?.total ?? 0, remainingSeconds: Math.round(holding.seconds) } : null,
    pages: plan.spread === "pages" ? { done: pagesLane?.done ?? 0, total: pagesLane?.total ?? plan.lanes[0]?.parts[0]?.units.length ?? 0 } : null,
  };
}
