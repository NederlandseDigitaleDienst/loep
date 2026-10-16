import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, sha256, sha256File } from "./canonical.ts";
import { readMatches, readRequestProblems, type ReadRequest } from "./reads.ts";

/**
 * The site model: what an exploring agent found out about a site before anything is
 * measured. Which pages share a type, what lies over a page and how to close it, which
 * parts only show after an action and how to open them, and which frames are whose.
 * Every way of getting somewhere is a saved state of the session (a recipe), and every
 * claim that something opened or closed is a condition a script can check.
 */
export const SITE_MODEL_VERSION = 1;

export const POSTCONDITION_KINDS = ["gone", "not-covering", "visible", "expanded", "dialog-open", "text-visible", "url-contains", "value"] as const;
export type PostconditionKind = (typeof POSTCONDITION_KINDS)[number];

/**
 * - gone: no visible element matches `selector`
 * - not-covering: what matches `selector` covers less than a small share of the window
 * - visible: a visible element matches `selector`
 * - expanded: an element matching `selector` has aria-expanded="true", or is an open <details>
 * - dialog-open: a dialog is visible (one matching `selector`, when given)
 * - text-visible: `text` is part of the visible text of the page
 * - url-contains: the address of the page contains `text`
 * - value: a field matching `selector` has a value; with `text`, that value
 *
 * With `frame` the condition is checked in the document of that embedded frame instead of the page around it.
 */
export interface Postcondition {
  kind: PostconditionKind;
  selector?: string;
  text?: string;
  /** Address of an embedded frame, as `frames` has it. */
  frame?: string;
}

export interface PageType {
  id: string;
  descriptionNl: string;
  /** The page the explorer looked at for this type; one of `pages`. */
  representative: string;
  pages: string[];
}

export const BLOCKER_KINDS = ["cookie-banner", "modal", "overlay", "other"] as const;

export interface Blocker {
  id: string;
  kind: (typeof BLOCKER_KINDS)[number];
  descriptionNl: string;
  /** Name of the saved state that dismisses it: only the steps needed for that, from a clean page. */
  recipe: string;
  postcondition: Postcondition;
}

export const COMPONENT_TYPES = ["menu", "submenu", "dialog", "accordion", "tabs", "carousel", "form", "player", "search", "chat", "tooltip", "other"] as const;

export interface ViewportCondition {
  /** The component only exists at or below this window width, in CSS pixels. */
  maxWidth?: number;
  /** The component only exists at or above this window width. */
  minWidth?: number;
}

export interface Component {
  id: string;
  type: (typeof COMPONENT_TYPES)[number];
  descriptionNl: string;
  /** Ids of the page types it occurs on. */
  pageTypes: string[];
  viewport: ViewportCondition | null;
  /** Name of the saved state in which it is open; null when the explorer could not open it. */
  recipe: string | null;
  postcondition: Postcondition | null;
  /** Required without a recipe: what was tried and why it did not open. */
  notOpenedNl?: string;
  /** Requests the component needs that an evaluation never sends or may not send: a write request, or a host outside the run. */
  blockedRequests?: BlockedRequest[];
  /** For a component that is an embedded window with something to operate: the address of that window, as `frames` has it. */
  frame?: string;
}

export interface BlockedRequest {
  method: string;
  /** Host and path, without query. */
  address: string;
}

export const CONTENT_KINDS = ["video", "audio", "moving", "map", "other"] as const;

/** Content that is there without any action and that a judge has to know about: a player, a block that changes by itself. */
export interface PresentContent {
  id: string;
  kind: (typeof CONTENT_KINDS)[number];
  descriptionNl: string;
  pageTypes: string[];
}

export interface Process {
  id: string;
  descriptionNl: string;
  /** Name of the saved state at the end of the process: a search done, a form filled in but not sent. */
  recipe: string;
  postcondition: Postcondition;
}

/**
 * What an embedded frame is, by who has a say over it. That decides whether it is part of what
 * is evaluated:
 *
 * - own-content: content of the organisation itself, in a player of its own or one it chose. Counts.
 * - vendor-component: a part the organisation chose from a vendor, such as a captcha, a chat or a payment screen. Counts; the vendor is the one to repair it.
 * - outside-control: content the organisation has no say over. Exempt: it is named and kept out of the verdict.
 * - map: a map of which the essential, such as an address, also stands on the page as text. Exempt.
 * - no-content: machinery that shows a visitor nothing, such as a measuring pixel or an empty helper frame. Nothing to evaluate.
 */
export const FRAME_CLASSES = ["own-content", "vendor-component", "outside-control", "map", "no-content"] as const;
export type FrameClass = (typeof FRAME_CLASSES)[number];

export interface FrameStanding {
  /** Whether what is in the frame is evaluated as part of the page. */
  counts: boolean;
  /** The class in the words of the report. */
  labelNl: string;
  /** What that means for the evaluation, in the words of the report. */
  standingNl: string;
  /** Who repairs a defect in it, when that is not the organisation. */
  owner: "leverancier" | null;
}

export const FRAME_STANDING: Record<FrameClass, FrameStanding> = {
  "own-content": { counts: true, labelNl: "eigen inhoud in een eigen of gekozen speler", standingNl: "Telt mee in het onderzoek", owner: null },
  "vendor-component": { counts: true, labelNl: "gekozen onderdeel van een leverancier", standingNl: "Telt mee in het onderzoek; herstel ligt bij de leverancier", owner: "leverancier" },
  "outside-control": { counts: false, labelNl: "inhoud waar de organisatie geen zeggenschap over heeft", standingNl: "Uitgezonderd: benoemd en buiten het oordeel gehouden", owner: null },
  map: { counts: false, labelNl: "kaart waarvan het wezenlijke ook als tekst op de pagina staat", standingNl: "Uitgezonderd: benoemd en buiten het oordeel gehouden", owner: null },
  "no-content": { counts: false, labelNl: "techniek die de bezoeker niets toont", standingNl: "Er is niets in te onderzoeken", owner: null },
};

/**
 * The classes of a site model from before frames were told apart by who has a say over them.
 * Such a model is still read, with what its classes meant then. It is not accepted again: an
 * earlier class does not say which of the present ones it is.
 */
const EARLIER_STANDING: Record<string, FrameStanding> = {
  own: { counts: true, labelNl: "inhoud van de site zelf", standingNl: "Telt mee in het onderzoek", owner: null },
  embedded: { counts: true, labelNl: "inhoud van een andere partij", standingNl: "Telt mee in het onderzoek", owner: null },
  "third-party": { counts: false, labelNl: "techniek van een andere partij", standingNl: "Telt niet mee in het onderzoek", owner: null },
};

export function frameStanding(frame: { class: string }): FrameStanding {
  return FRAME_STANDING[frame.class as FrameClass] ?? EARLIER_STANDING[frame.class] ?? { counts: false, labelNl: `onbekende soort "${frame.class}"`, standingNl: "Telt niet mee in het onderzoek", owner: null };
}

export interface FrameEntry {
  /** Origin and path of the frame, without query: copies that differ only in their query are one frame. */
  address: string;
  class: FrameClass;
  descriptionNl: string;
  /** Why it is of this class, in plain words, for whoever signs the report. Absent in models from before this was asked. */
  reasonNl?: string;
  /** Set by a person who decided the class, against or in place of the explorer: who that is, by role. */
  decidedBy?: string;
}

/** A gap the evidence gate reports that the explorer confirmed as a property of the site, not of the collecting. */
export interface AcceptedGap {
  check: string;
  /** Address of the page the gap is on. */
  page: string;
  reasonNl: string;
  /** Id of the session observation that shows it. */
  observation: string;
}

export interface SiteModel {
  version: number;
  baseUrl: string;
  /**
   * What kind of website this is, for a reader who has never seen it: whose it is, who uses
   * it, what a visitor can do there and what stands out for an evaluation. Facts the explorer
   * saw, no judgement. Absent in models from before this was asked.
   */
  descriptionNl?: string;
  pageTypes: PageType[];
  blockers: Blocker[];
  components: Component[];
  processes: Process[];
  /** Players and self-moving content that show without an action. Absent in models from before this was asked. */
  content?: PresentContent[];
  frames: FrameEntry[];
  /** What the explorer saw but could not open or classify, in free text. */
  notesNl: string[];
  acceptedGaps?: AcceptedGap[];
  /**
   * Requests that only read although they are a POST, such as a question to a search service.
   * Let through once `check-site` passed the model; every other write stays held back. Absent in models from before this was asked.
   */
  readRequests?: ReadRequest[];
}

/** What the validator needs to know about the run the model belongs to. */
export interface ModelContext {
  /** Addresses of the pages of the site itself, as the inventory recorded them. */
  pages: string[];
  /** Addresses of the frames the inventory found, with their query. */
  frames: string[];
  /** Names of the saved states in the run, with the window width each starts at. */
  recipes: Record<string, { width: number; steps: number; url: string }>;
  /** Ids of session observations that exist; null when not checked. */
  observations?: Set<string> | null;
  /** Per page address: how many audio and video elements the inventory counted there. Absent when not checked. */
  media?: Record<string, { audio: number; video: number }>;
  /** Per observation that a read request names: the requests it held back or let through as a read. Absent when not checked. */
  requestsSeen?: Record<string, { method: string; url: string; /** The search services whose form loep recognised in the body. */ search?: string[] }[]>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Origin and path of a frame: the part of its address that says which frame it is. */
export function frameAddress(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export function frameEntry(model: SiteModel, url: string): FrameEntry | null {
  let address: string;
  try {
    address = frameAddress(url);
  } catch {
    return null;
  }
  return model.frames.find((frame) => frame.address === address) ?? null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function checkPostcondition(value: unknown, where: string, problems: string[]): void {
  if (!isRecord(value)) return void problems.push(`${where}: postcondition ontbreekt of is geen object`);
  if (!POSTCONDITION_KINDS.includes(value.kind as PostconditionKind)) return void problems.push(`${where}: postcondition.kind moet een van ${POSTCONDITION_KINDS.join(", ")} zijn`);
  const kind = value.kind as PostconditionKind;
  const needsSelector = kind === "gone" || kind === "not-covering" || kind === "visible" || kind === "expanded" || kind === "value";
  const needsText = kind === "text-visible" || kind === "url-contains";
  if (needsSelector && !isText(value.selector)) problems.push(`${where}: postcondition "${kind}" vraagt een selector`);
  if (needsText && !isText(value.text)) problems.push(`${where}: postcondition "${kind}" vraagt een text`);
  if (value.selector !== undefined && !isText(value.selector)) problems.push(`${where}: postcondition.selector moet tekst zijn`);
  if (value.frame !== undefined && !isText(value.frame)) problems.push(`${where}: postcondition.frame is het adres van een venster uit frames`);
  for (const key of Object.keys(value)) if (!["kind", "selector", "text", "frame"].includes(key)) problems.push(`${where}: postcondition kent geen veld "${key}"`);
}

/**
 * Check the form of a site model and that it fits the run: every page in exactly one
 * type, every frame classified, every recipe present. Returns the problems, in Dutch,
 * because the explorer reads them. Whether a recipe does what it claims is checked
 * separately, by replaying it.
 */
export function validateSiteModel(value: unknown, context: ModelContext): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ["site.json is geen JSON-object"];
  const model = value as Partial<SiteModel> & Record<string, unknown>;
  if (model.version !== SITE_MODEL_VERSION) problems.push(`version moet ${SITE_MODEL_VERSION} zijn`);
  if (!isText(model.baseUrl)) problems.push("baseUrl ontbreekt");
  for (const key of ["pageTypes", "blockers", "components", "processes", "frames", "notesNl"] as const) {
    if (!Array.isArray(model[key])) problems.push(`${key} ontbreekt of is geen lijst (een lege lijst mag)`);
  }
  for (const key of Object.keys(model)) if (!["version", "baseUrl", "descriptionNl", "pageTypes", "blockers", "components", "processes", "content", "frames", "notesNl", "acceptedGaps", "readRequests"].includes(key)) problems.push(`onbekend veld "${key}"`);
  problems.push(...descriptionProblems(model.descriptionNl));
  if (problems.length > 0) return problems;

  const ids = new Set<string>();
  const checkId = (id: unknown, where: string): void => {
    if (typeof id !== "string" || !ID.test(id)) return void problems.push(`${where}: id moet bestaan uit kleine letters, cijfers en streepjes`);
    if (ids.has(id)) problems.push(`${where}: id "${id}" komt twee keer voor`);
    ids.add(id);
  };
  const checkRecipe = (name: unknown, where: string): { width: number; steps: number; url: string } | null => {
    if (!isText(name)) {
      problems.push(`${where}: recipe ontbreekt`);
      return null;
    }
    const recipe = context.recipes[name];
    if (!recipe) {
      problems.push(`${where}: er is geen bewaarde toestand "${name}" in recipes/; bewaar hem met state save ${name}`);
      return null;
    }
    if (recipe.steps === 0) problems.push(`${where}: toestand "${name}" heeft geen stappen en opent of sluit dus niets`);
    return recipe;
  };

  // Page types: every page of the site in exactly one type.
  const typeIds = new Set<string>();
  const assigned = new Map<string, string>();
  for (const [index, type] of model.pageTypes!.entries()) {
    const where = `pageTypes[${index}]`;
    if (!isRecord(type)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    checkId(type.id, where);
    typeIds.add(String(type.id));
    if (!isText(type.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    if (!Array.isArray(type.pages) || type.pages.length === 0) {
      problems.push(`${where}: pages ontbreekt of is leeg`);
      continue;
    }
    if (!type.pages.includes(type.representative)) problems.push(`${where}: representative moet een van de pages zijn`);
    for (const page of type.pages as unknown[]) {
      if (typeof page !== "string" || !context.pages.includes(page)) problems.push(`${where}: "${String(page)}" is geen pagina van deze run (neem het adres letterlijk over uit de opdracht)`);
      else if (assigned.has(page)) problems.push(`${where}: ${page} staat ook in paginatype "${assigned.get(page)}"`);
      else assigned.set(page, String(type.id));
    }
  }
  const unassigned = context.pages.filter((page) => !assigned.has(page));
  if (unassigned.length > 0) problems.push(`${unassigned.length} pagina's staan in geen enkel paginatype: ${unassigned.slice(0, 5).join(", ")}${unassigned.length > 5 ? " ..." : ""}`);

  for (const [index, blocker] of model.blockers!.entries()) {
    const where = `blockers[${index}]`;
    if (!isRecord(blocker)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    checkId(blocker.id, where);
    if (!BLOCKER_KINDS.includes(blocker.kind as never)) problems.push(`${where}: kind moet een van ${BLOCKER_KINDS.join(", ")} zijn`);
    if (!isText(blocker.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    checkRecipe(blocker.recipe, where);
    checkPostcondition(blocker.postcondition, where, problems);
  }

  for (const [index, component] of model.components!.entries()) {
    const where = `components[${index}]`;
    if (!isRecord(component)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    checkId(component.id, where);
    if (!COMPONENT_TYPES.includes(component.type as never)) problems.push(`${where}: type moet een van ${COMPONENT_TYPES.join(", ")} zijn`);
    if (!isText(component.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    if (!Array.isArray(component.pageTypes) || component.pageTypes.length === 0) problems.push(`${where}: pageTypes ontbreekt of is leeg`);
    else for (const type of component.pageTypes as unknown[]) if (!typeIds.has(String(type))) problems.push(`${where}: paginatype "${String(type)}" bestaat niet`);
    const viewport = component.viewport;
    if (viewport !== null && !isRecord(viewport)) problems.push(`${where}: viewport is null of een object met maxWidth of minWidth`);
    if (isRecord(viewport)) {
      for (const [key, limit] of Object.entries(viewport)) {
        if (!["maxWidth", "minWidth"].includes(key) || typeof limit !== "number" || !Number.isInteger(limit) || limit < 200 || limit > 4000) problems.push(`${where}: viewport.${key} moet maxWidth of minWidth zijn, een geheel getal tussen 200 en 4000`);
      }
    }
    if (component.blockedRequests !== undefined && !(Array.isArray(component.blockedRequests) && component.blockedRequests.every((request) => isRecord(request) && isText(request.method) && isText(request.address)))) problems.push(`${where}: blockedRequests is een lijst van { method, address }`);
    if (component.frame !== undefined && !(model.frames as unknown[]).some((frame) => isRecord(frame) && frame.address === component.frame)) problems.push(`${where}: frame "${String(component.frame)}" staat niet in frames; neem het adres daar letterlijk over`);
    if ((model.frames as unknown[]).some((frame) => isRecord(frame) && frame.address === component.frame && frame.class === "no-content")) problems.push(`${where}: het venster ${String(component.frame)} heeft iets om te bedienen en is dus geen no-content; deel het in als own-content of vendor-component`);
    if (component.recipe === null) {
      if (!isText(component.notOpenedNl)) problems.push(`${where}: zonder recipe is notOpenedNl verplicht: wat is geprobeerd en waarom het niet openging`);
      if (component.postcondition !== null) problems.push(`${where}: zonder recipe is postcondition null`);
      continue;
    }
    const recipe = checkRecipe(component.recipe, where);
    checkPostcondition(component.postcondition, where, problems);
    const inFrame = isRecord(component.postcondition) ? component.postcondition.frame : undefined;
    if (isText(inFrame) && !(model.frames as unknown[]).some((frame) => isRecord(frame) && frame.address === inFrame)) problems.push(`${where}: postcondition.frame "${inFrame}" staat niet in frames; neem het adres daar letterlijk over`);
    if (recipe && isRecord(viewport)) {
      if (typeof viewport.maxWidth === "number" && recipe.width > viewport.maxWidth) problems.push(`${where}: toestand "${String(component.recipe)}" is bewaard op ${recipe.width} pixels breed, maar het onderdeel bestaat volgens viewport alleen tot ${viewport.maxWidth}`);
      if (typeof viewport.minWidth === "number" && recipe.width < viewport.minWidth) problems.push(`${where}: toestand "${String(component.recipe)}" is bewaard op ${recipe.width} pixels breed, maar het onderdeel bestaat volgens viewport pas vanaf ${viewport.minWidth}`);
    }
  }

  for (const [index, process] of model.processes!.entries()) {
    const where = `processes[${index}]`;
    if (!isRecord(process)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    checkId(process.id, where);
    if (!isText(process.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    checkRecipe(process.recipe, where);
    checkPostcondition(process.postcondition, where, problems);
  }

  // Players and moving content that are there without an action.
  const contentKinds = new Map<string, Set<string>>();
  for (const [index, content] of (Array.isArray(model.content) ? model.content : []).entries()) {
    const where = `content[${index}]`;
    if (!isRecord(content)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    checkId(content.id, where);
    if (!CONTENT_KINDS.includes(content.kind as never)) problems.push(`${where}: kind moet een van ${CONTENT_KINDS.join(", ")} zijn`);
    if (!isText(content.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    if (!Array.isArray(content.pageTypes) || content.pageTypes.length === 0) problems.push(`${where}: pageTypes ontbreekt of is leeg`);
    else {
      for (const type of content.pageTypes as unknown[]) {
        if (!typeIds.has(String(type))) problems.push(`${where}: paginatype "${String(type)}" bestaat niet`);
        contentKinds.set(String(type), (contentKinds.get(String(type)) ?? new Set()).add(String(content.kind)));
      }
    }
  }
  if (model.content !== undefined && !Array.isArray(model.content)) problems.push("content is een lijst");
  // What the inventory counted has to be in the model: a page with a player whose type names no player.
  for (const [page, counted] of Object.entries(context.media ?? {})) {
    const type = assigned.get(page);
    if (!type) continue;
    for (const kind of ["audio", "video"] as const) {
      if (counted[kind] > 0 && !contentKinds.get(type)?.has(kind)) problems.push(`op ${page} staat ${counted[kind]} keer <${kind}>, maar content noemt voor paginatype "${type}" geen ${kind}; neem het op in content`);
    }
  }

  // Frames: every frame the inventory found has to be classified, once per address.
  const classified = new Set<string>();
  for (const [index, frame] of model.frames!.entries()) {
    const where = `frames[${index}]`;
    if (!isRecord(frame)) {
      problems.push(`${where} is geen object`);
      continue;
    }
    if (typeof frame.class === "string" && frame.class in EARLIER_STANDING) problems.push(`${where}: class "${frame.class}" is de indeling van een eerder sitemodel en zegt niet wie er zeggenschap over het venster heeft; kies opnieuw uit ${FRAME_CLASSES.map((name) => `${name} (${FRAME_STANDING[name].labelNl})`).join(", ")}, en geef de reden in reasonNl`);
    else if (!FRAME_CLASSES.includes(frame.class as FrameClass)) problems.push(`${where}: class moet een van ${FRAME_CLASSES.join(", ")} zijn`);
    if (!isText(frame.descriptionNl)) problems.push(`${where}: descriptionNl ontbreekt`);
    if (!isText(frame.reasonNl)) problems.push(`${where}: reasonNl ontbreekt: waarom het venster van deze soort is, in gewone woorden, voor wie het rapport tekent`);
    if (frame.decidedBy !== undefined && !isText(frame.decidedBy)) problems.push(`${where}: decidedBy is de rol van de persoon die de soort heeft bepaald, of ontbreekt`);
    for (const key of Object.keys(frame)) if (!["address", "class", "descriptionNl", "reasonNl", "decidedBy"].includes(key)) problems.push(`${where}: een venster kent geen veld "${key}"`);
    let address: string | null = null;
    try {
      address = isText(frame.address) ? frameAddress(frame.address) : null;
    } catch {
      address = null;
    }
    if (address === null) problems.push(`${where}: address is geen adres`);
    else if (address !== frame.address) problems.push(`${where}: address is het adres zonder query en zonder anker: ${address}`);
    else if (classified.has(address)) problems.push(`${where}: ${address} staat twee keer in frames`);
    else classified.add(address);
  }
  const found = [...new Set(context.frames.map(frameAddress))].sort();
  for (const address of found) if (!classified.has(address)) problems.push(`het venster ${address} is niet ingedeeld in frames`);

  if (!(model.notesNl as unknown[]).every((note) => typeof note === "string")) problems.push("notesNl is een lijst van teksten");

  if (model.acceptedGaps !== undefined) {
    if (!Array.isArray(model.acceptedGaps)) problems.push("acceptedGaps is een lijst");
    else {
      for (const [index, gap] of model.acceptedGaps.entries()) {
        const where = `acceptedGaps[${index}]`;
        if (!isRecord(gap) || !isText(gap.check) || !isText(gap.page) || !isText(gap.reasonNl) || !isText(gap.observation)) {
          problems.push(`${where}: check, page, reasonNl en observation zijn verplicht`);
          continue;
        }
        if (!context.pages.includes(gap.page as string)) problems.push(`${where}: "${String(gap.page)}" is geen pagina van deze run`);
        if (context.observations && !context.observations.has(gap.observation as string)) problems.push(`${where}: waarneming ${String(gap.observation)} bestaat niet in deze run`);
      }
    }
  }

  // Requests that only read: each one narrow, with its reason and the observation that shows it.
  if (model.readRequests !== undefined) {
    if (!Array.isArray(model.readRequests)) problems.push("readRequests is een lijst");
    else {
      const seenRules = new Set<string>();
      for (const [index, rule] of (model.readRequests as unknown[]).entries()) {
        const where = `readRequests[${index}]`;
        const own = readRequestProblems(rule, where);
        if (isRecord(rule)) checkId(rule.id, where);
        problems.push(...own);
        if (own.length > 0) continue;
        const read = rule as ReadRequest;
        const key = `${read.origin}${read.path}`;
        if (seenRules.has(key)) problems.push(`${where}: ${read.method} ${key} staat twee keer in readRequests`);
        seenRules.add(key);
        if (context.observations && !context.observations.has(read.observation)) problems.push(`${where}: waarneming ${read.observation} bestaat niet in deze run`);
        else if (context.requestsSeen) {
          const seen = (context.requestsSeen[read.observation] ?? []).filter((request) => readMatches(read, request.method, request.url));
          if (seen.length === 0) problems.push(`${where}: in waarneming ${read.observation} is geen ${read.method} naar ${read.origin}${read.path} tegengehouden; geef het id van het commando waarvan het antwoord dit verzoek onder blocked noemt`);
          else if (!seen.some((request) => (request.search ?? []).includes(read.service))) {
            const found = [...new Set(seen.flatMap((request) => request.search ?? []))];
            problems.push(`${where}: loep herkende de body van dat verzoek in waarneming ${read.observation} niet als zoekvraag aan ${read.service}${found.length > 0 ? ` (wel als ${found.join(", ")})` : ""}; een verzoek waarvan loep de body niet herkent, blijft tegengehouden en kan geen leesverzoek worden`);
          }
        }
        // A request that may pass is not also a request a component cannot do without.
        for (const component of model.components as unknown[]) {
          if (!isRecord(component) || !Array.isArray(component.blockedRequests)) continue;
          for (const blocked of component.blockedRequests as unknown[]) {
            if (isRecord(blocked) && typeof blocked.method === "string" && typeof blocked.address === "string" && readMatches(read, blocked.method, `${new URL(read.origin).protocol}//${blocked.address}`)) {
              problems.push(`components: onderdeel "${String(component.id)}" noemt ${blocked.method} ${blocked.address} onder blockedRequests, maar ${where} laat dat verzoek door; haal het weg uit blockedRequests`);
            }
          }
        }
      }
    }
  }
  return problems;
}

/**
 * The read requests of a model that passed `check-site` and has not changed since; empty
 * otherwise. Read at the moment a browser context is made, so a session that started before
 * the check gets them as soon as the check passed, and loses them as soon as the model changes.
 * Every rule is tested again: what is let through never rests on a file alone.
 */
export function approvedReads(runDir: string): ReadRequest[] {
  const path = join(runDir, SITE_MODEL_FILE);
  const checkPath = join(runDir, SITE_CHECK_FILE);
  if (!existsSync(path) || !existsSync(checkPath)) return [];
  try {
    const raw = readFileSync(path);
    const check = JSON.parse(readFileSync(checkPath, "utf8")) as Partial<SiteCheck>;
    if (check.ok !== true || check.siteSha256 !== sha256(raw)) return [];
    const rules = (JSON.parse(raw.toString("utf8")) as { readRequests?: unknown }).readRequests;
    return Array.isArray(rules) ? (rules as unknown[]).filter((rule): rule is ReadRequest => readRequestProblems(rule, "").length === 0) : [];
  } catch {
    return [];
  }
}

export const DESCRIPTION_MIN_WORDS = 40;
export const DESCRIPTION_MAX_WORDS = 140;
/** Text that was left standing where a description should be. */
const PLACEHOLDER = /lorem ipsum|\btodo\b|\btbd\b|\bxxx+\b|\{\{|\}\}|<[^>]+>|\.\.\.|…|hier komt|vul (hier )?in|nog in te vullen|beschrijving van de site/i;

/** The description of the site has to be there, of a length a reader gets through, and written. */
export function descriptionProblems(value: unknown): string[] {
  if (!isText(value)) return ["descriptionNl ontbreekt: drie tot zes zinnen over wat voor website dit is"];
  const words = value.trim().split(/\s+/).length;
  const problems: string[] = [];
  if (words < DESCRIPTION_MIN_WORDS || words > DESCRIPTION_MAX_WORDS) problems.push(`descriptionNl telt ${words} woorden; het moeten er tussen ${DESCRIPTION_MIN_WORDS} en ${DESCRIPTION_MAX_WORDS} zijn`);
  const placeholder = PLACEHOLDER.exec(value)?.[0];
  if (placeholder) problems.push(`descriptionNl bevat tekst die op een invulplek lijkt ("${placeholder}"); schrijf de beschrijving uit`);
  return problems;
}

/** The explorer's description of the site, for the report. Null when the run has no site model or an older one without it. */
export async function siteDescription(runDir: string): Promise<string | null> {
  const description = (await readSiteModel(runDir))?.descriptionNl;
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

export const SITE_MODEL_FILE = "site.json";
export const SITE_CHECK_FILE = "site-check.json";

/** What `check-site` recorded: the model as it was when every recipe was replayed. */
export interface SiteCheck {
  ok: boolean;
  siteSha256: string;
  checkedAt: string;
  problems: string[];
  replays: { kind: "blocker" | "component" | "process"; id: string; recipe: string; ok: boolean; reasonNl: string | null; before: string; after: string }[];
  /** Saved states of the explorer that the model does not use; moved to recipes/unused when the model passed. */
  unusedRecipes?: string[];
  /** How many forms and groups of controls were counted on the page types, and how many of them no recipe of the model touches. Absent when it was not counted. */
  operables?: { counted: number; uncovered: number };
  /** Controls that are only on screen between the measured widths, with the width to try them at. Hints for the explorer, not problems. */
  hintsNl?: string[];
}

/**
 * The site model of a run, for the sweep. Null when the run has none: then the sweep does
 * what it always did. A model that is there but was not checked, or changed since, is
 * refused: the sweep must not act on recipes nobody replayed.
 */
export async function loadSiteModel(runDir: string): Promise<SiteModel | null> {
  const path = join(runDir, SITE_MODEL_FILE);
  if (!existsSync(path)) return null;
  const checkPath = join(runDir, SITE_CHECK_FILE);
  if (!existsSync(checkPath)) throw new Error(`${SITE_MODEL_FILE} is niet gecontroleerd; draai eerst: check-site --run ${runDir}`);
  const check = await readJson<SiteCheck>(checkPath);
  if (check.siteSha256 !== (await sha256File(path))) throw new Error(`${SITE_MODEL_FILE} is gewijzigd na de laatste controle; draai opnieuw: check-site --run ${runDir}`);
  if (!check.ok) throw new Error(`${SITE_MODEL_FILE} is afgekeurd door check-site (${check.problems.length} problemen); herstel het model eerst`);
  return readJson<SiteModel>(path);
}

/** The model without the guarantee that it was checked: for commands that only read what it says. */
export async function readSiteModel(runDir: string): Promise<SiteModel | null> {
  const path = join(runDir, SITE_MODEL_FILE);
  return existsSync(path) ? readJson<SiteModel>(path) : null;
}
