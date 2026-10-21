import type { Step } from "../session/observations.ts";
import { pageTypeOf, type Component, type SiteModel } from "./sitemodel.ts";

/**
 * What there is to operate on a page, laid next to what the site model says about it. The
 * in-page library counts the forms and loose controls of a page; a recipe of the model
 * touches elements. A group of controls no recipe touches, and no component accounts for,
 * is a part of the site the model does not have. That is decided here, by code, so it does
 * not depend on somebody noticing it in a picture.
 */

export const OPERABLE_KINDS = ["form", "search", "player", "tabs", "slider", "select", "field", "choice", "disclosure", "button", "frame"] as const;
export type OperableKind = (typeof OPERABLE_KINDS)[number];

/** One thing a visitor operates, as `operables` of the in-page library groups it. */
export interface OperableGroup {
  /** What makes it one group on its page: the form, the row of tabs, the player, or the kind of control and the chain of element names it stands in. */
  key: string;
  kind: OperableKind;
  /** Selector chain of the form, the row of tabs or the player; for loose controls that of the first one. */
  path: string;
  /** Nearest region of the page, as in the facts: "main", "nav:Hoofdmenu". */
  region: string | null;
  /** False for what stands outside the main content: header, navigation and footer, which return on every page. */
  inMain: boolean;
  /** Visible names of the first controls in it. */
  text: string;
  members: { path: string; structural: string; kind: string }[];
  /** Only there in the narrow window, such as the button a menu sits behind. */
  onlyNarrow?: boolean;
  /** For an embedded window with controls of its own: its address without query, as `frames` of the site model has it, and how many controls it holds. */
  frame?: string;
  controls?: number;
}

/** An element that looks operable but has no role and no Tab stop, as `looksOperable` of the in-page library finds it. */
export interface LooksOperable {
  path: string;
  text: string;
  region: string | null;
  /** Why it looks operable: "click-listener", "press-listener", "onclick", "cursor: pointer", a data attribute. */
  signals: string[];
  /** The opening tag: for an empty div often the class name is the only thing that says what it is. */
  html: string;
}

/** The groups of one page type, counted on its representative page. */
export interface CountedPage {
  pageType: string;
  url: string;
  groups: OperableGroup[];
  /** What looks operable there in the default window without presenting itself as a control. Not counted in `groups`: nothing says what it is. */
  looksOperable?: LooksOperable[];
}

/** The groups of a page in the default window, with what only the narrow window adds. */
export function mergeWidths(wide: OperableGroup[], narrow: OperableGroup[]): OperableGroup[] {
  const merged = wide.map((group) => ({ ...group, members: [...group.members] }));
  for (const group of narrow) {
    const known = merged.find((candidate) => candidate.key === group.key);
    if (!known) {
      merged.push({ ...group, onlyNarrow: true });
      continue;
    }
    for (const member of group.members) if (!known.members.some((other) => other.structural === member.structural)) known.members.push(member);
  }
  return merged;
}

/** An element a recipe of the model operates, and the page it was on at that step. */
export interface Touch {
  url: string;
  path: string;
  structural: string | null;
  /** Page types the component says it occurs on; empty for a process. */
  declaredTypes: string[];
}

/** The part of a saved state this needs. */
export interface RecipeSteps {
  start: { url: string } | null;
  steps: Step[];
}

/**
 * Every element the recipes of components and processes operate. The page of a step is the
 * start of the recipe or the last address it went to; a click that leads elsewhere is not
 * followed, so what comes after it counts for the page before.
 */
export function modelTouches(model: SiteModel, recipes: Record<string, RecipeSteps>): Touch[] {
  const touches: Touch[] = [];
  for (const entry of [...model.components, ...model.processes]) {
    const recipe = entry.recipe === null ? undefined : recipes[entry.recipe];
    if (!recipe?.start) continue;
    let url = recipe.start.url;
    for (const step of recipe.steps) {
      if (step.command === "goto" && step.args[0]) {
        try {
          url = new URL(step.args[0], url).href;
        } catch {
          // Kept on the page before.
        }
      }
      if (step.target) touches.push({ url, path: step.target.join(" >>> "), structural: step.locators?.structural?.join(" >>> ") ?? null, declaredTypes: "pageTypes" in entry ? entry.pageTypes : [] });
    }
  }
  return touches;
}

/** Which kinds of controls a component that could not be opened accounts for, by its type. */
const KINDS_OF_TYPE: Record<Component["type"], OperableKind[]> = {
  form: ["form", "search", "field", "choice", "select", "slider"],
  search: ["search", "form", "field"],
  player: ["player"],
  accordion: ["disclosure"],
  tabs: ["tabs"],
  menu: ["disclosure", "button"],
  submenu: ["disclosure", "button"],
  dialog: ["disclosure", "button"],
  carousel: ["button"],
  chat: ["disclosure", "button", "field"],
  tooltip: ["disclosure", "button"],
  other: ["button", "slider", "select", "field", "choice", "disclosure"],
};

const KIND_NL: Record<OperableKind, string> = {
  form: "een formulier",
  search: "een zoekformulier",
  player: "een speler met knoppen",
  tabs: "een rij tabbladen",
  slider: "een schuifregelaar",
  select: "een keuzelijst",
  field: "een invoerveld",
  choice: "een keuzevak of keuzerondje",
  disclosure: "een uitklapper",
  button: "een knop",
  frame: "een ingesloten venster met iets om te bedienen",
};

export interface Uncovered {
  /** Null for a block outside the main content, which counts once for the whole site. */
  pageType: string | null;
  url: string;
  group: OperableGroup;
  /** What is missing, in Dutch: the explorer reads this. */
  problemNl: string;
}

/**
 * Lay what was counted next to the model. A group is accounted for when a recipe touches
 * one of its controls on a page of that type, or on a page type the component says it
 * occurs on; when a component without a recipe of a fitting type names the page type; or,
 * for a player that only has the controls of the browser, when `content` names it. An
 * embedded window with controls of its own is such a group too: that it is classified under
 * `frames` says whose it is, not that somebody looked at what the visitor has to do there; it
 * is accounted for by a component that names its address in `frame`. What
 * stands outside the main content is one group for the whole site, however many page types
 * show it, and a recipe on any page accounts for it.
 */
export function uncoveredOperables(model: SiteModel, recipes: Record<string, RecipeSteps>, counted: CountedPage[]): { counted: number; uncovered: Uncovered[] } {
  const touches = modelTouches(model, recipes);
  const touched = (group: OperableGroup, pageType: string | null): boolean =>
    touches.some((touch) => (pageType === null || touch.declaredTypes.includes(pageType) || pageTypeOf(model, touch.url) === pageType) && group.members.some((member) => member.path === touch.path || (touch.structural !== null && member.structural === touch.structural)));
  const withoutRecipe = (group: OperableGroup, pageType: string | null): boolean => model.components.some((component) => component.recipe === null && (pageType === null || component.pageTypes.includes(pageType)) && KINDS_OF_TYPE[component.type]?.includes(group.kind));
  const named = (group: OperableGroup, pageType: string | null): boolean => group.kind === "player" && group.members.every((member) => member.kind === "player") && (model.content ?? []).some((content) => (content.kind === "video" || content.kind === "audio") && (pageType === null || content.pageTypes.includes(pageType)));
  // An embedded window is accounted for by the component that names its address, opened or not.
  const asFrame = (group: OperableGroup, pageType: string | null): boolean => group.kind === "frame" && model.components.some((component) => component.frame === group.frame && (pageType === null || component.pageTypes.includes(pageType)));
  const covered = (group: OperableGroup, pageType: string | null): boolean => (group.kind === "frame" ? asFrame(group, pageType) : touched(group, pageType) || withoutRecipe(group, pageType) || named(group, pageType));

  const uncovered: Uncovered[] = [];
  let total = 0;
  // Header, navigation and footer: the same block on every page is one thing to capture.
  const siteWide = new Map<string, { url: string; group: OperableGroup }>();
  for (const page of counted) {
    for (const group of page.groups) {
      if (group.inMain) {
        total++;
        if (!covered(group, page.pageType)) uncovered.push({ pageType: page.pageType, url: page.url, group, problemNl: problemNl(group, page.pageType, page.url) });
        continue;
      }
      const key = `${group.kind} ${group.region ?? ""} ${group.text}`;
      const known = siteWide.get(key);
      if (!known) siteWide.set(key, { url: page.url, group: { ...group, members: [...group.members] } });
      else for (const member of group.members) if (!known.group.members.some((other) => other.path === member.path && other.structural === member.structural)) known.group.members.push(member);
    }
  }
  for (const { url, group } of siteWide.values()) {
    total++;
    if (!covered(group, null)) uncovered.push({ pageType: null, url, group, problemNl: problemNl(group, null, url) });
  }
  return { counted: total, uncovered };
}

function problemNl(group: OperableGroup, pageType: string | null, url: string): string {
  if (group.kind === "frame") {
    const on = pageType === null ? `buiten de inhoud, op elke pagina waar dit venster staat (geteld op ${url})` : `paginatype "${pageType}" (${url})`;
    return `${on}: ${KIND_NL.frame} (${group.frame}, ${group.controls ?? 1} ${group.controls === 1 ? "bedieningselement" : "bedieningselementen"}, "${group.text}") op ${group.path}${group.region ? `, in ${group.region}` : ""} staat niet als onderdeel in het sitemodel. Dat het venster onder frames is ingedeeld, is niet genoeg: het staat in de pagina en de bezoeker moet het gebruiken. Leg het vast als onderdeel met "frame": "${group.frame}" en dit paginatype in pageTypes: met een recept als je het kunt bedienen, anders met recipe null en in notOpenedNl waarom niet.`;
  }
  const many = group.members.length > 1 ? ` (${group.members.length} bedieningselementen)` : "";
  const place = `${group.path}${group.region ? `, in ${group.region}` : ""}`;
  const where = pageType === null ? `buiten de inhoud, op elke pagina waar dit blok staat (geteld op ${url})` : `paginatype "${pageType}" (${url})`;
  return `${where}: ${KIND_NL[group.kind]}${many} met de tekst "${group.text}" op ${place}${group.onlyNarrow ? " (alleen op een smal scherm)" : ""} staat niet in het sitemodel: geen recept van een onderdeel of proces raakt het aan. Leg het vast als onderdeel of proces met een recept dat het bedient; lukt dat niet, dan als onderdeel met recipe null en in notOpenedNl wat je probeerde.`;
}
