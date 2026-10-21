import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import { launchBrowser } from "../browser/session.ts";
import { withinTime } from "../instruments/limit.ts";
import { startListening, stopListening, type Heard } from "../instruments/methods/speech.ts";
import { EXTENSION, extensionOf, MIN_EXTENSION_REASON, type Extension } from "../lib/budget.ts";
import { canonicalJson, readJson, writeJson } from "../lib/canonical.ts";
import { COMMANDS, PUBLIC_COMMANDS, UsageError, type Context, type Options, type Outcome, type Spec } from "./commands.ts";
import { Jobs } from "./jobs.ts";
import { cleanModel } from "../lib/models.ts";
import { toolchain } from "../lib/manifest.ts";
import { budgetOutPointNl, writeBudget, writeBudgetNl, writesForRun, type WriteBudget } from "../lib/writes.ts";
import { loadSiteModel, STEP_NOT_FOUND_NL, type Postcondition, type SiteModel } from "../lib/sitemodel.ts";
import { Images, ObservationLog, observationId, readObservation, type Locators, type Observation, type StartState, type StateRecord, type Step, type TargetRecord } from "./observations.ts";
import { holds, POSTCONDITION_WAIT_MS } from "./recipe.ts";
import { toolsOutcome, waitOutcome, type Services } from "./opinions.ts";
import { SecondBrowsers } from "./second.ts";
import { Blockade, refusalNl } from "./blockade.ts";
import { documentOutcome } from "./document-command.ts";
import { sheetOutcome } from "./sheet.ts";
import { VOICEOVER_COMMAND_MS, voiceoverOutcome } from "./voiceover-command.ts";
import { DEFAULT_DAEMON_LIMITS, DEFAULT_SESSION_LIMITS, Politeness, type Blocked, type DaemonLimits, type Scope, type SessionLimits } from "./safety.ts";
import { find, homeOf, leftScope, openSurface, pageFacts, resolvePath, resolveRef, resolveStep, sayFrame, stateOf, syncRefs, tgs, toRecord, type Env, type Refused, type Surface, type TargetInfo } from "./surface.ts";

/** The code a session measured with: evaluate names a session that ran on other code than the rest of the run. */
const SESSION_TOOLBOX = (({ commit, dirty }) => ({ commit, dirty }))(toolchain(null).toolbox);

export interface Request {
  /** `command` is one command in a session; the other four manage sessions. */
  op: "start" | "stop" | "list" | "extend" | "command";
  /** `session extend --reason`: what is still to be measured. */
  reason?: string;
  session?: string;
  command?: string;
  args?: string[];
  options?: Options;
  limits?: Partial<SessionLimits>;
  /** `session start --model`: the model the agent says it runs on. Kept as given; nothing here can check it. */
  model?: string;
  /** `session start --max-sessions`: what the caller asked the process to allow. The limit is set when the process starts, so a process that runs already keeps its own. */
  maxSessions?: number;
  /** `session start --key`: the key the first start of a running session gave, so its owner can start it again. */
  key?: string;
}

/**
 * Why a second start of a running session is refused, and what to do. Two agents in one session
 * measure in each other's page and use one budget; the owner of the session has its key.
 */
export const ownedSessionNl = (name: string, wrongKey: boolean): string =>
  `geweigerd: sessie "${name}" loopt al en heeft een eigenaar${wrongKey ? ", en deze sleutel hoort er niet bij" : ""}. Een tweede start laat twee agents in één sessie meten. Startte jij deze sessie zelf en wil je hem voortzetten, geef dan de sleutel mee die session start je gaf: session start --session ${name} --key <sleutel>. Heb je die sleutel niet, dan meet een andere agent al onder deze sessienaam: meet niet verder en meld dat sessie "${name}" al in gebruik is`;

/**
 * What to do when the process has no room for another session. Fewer at the same time is what
 * protects the site, so waiting comes first and a higher limit last.
 */
export const tooManySessionsNl = (running: number, max: number): string =>
  `er lopen al ${running} sessies en dit sessieproces laat er hooguit ${max} tegelijk toe. Wacht tot een agent zijn sessie stopt, of stop een sessie die is blijven hangen (session list toont ze, session stop --session <naam> stopt er een). Start naast je eigen sessie hooguit ${Math.max(max - 1, 1)} ${max > 2 ? "agents" : "agent"} tegelijk. Meer kan alleen als de eigenaar van de site het toestaat: stop dan alle sessies (session stop) en start opnieuw met session start --max-sessions <aantal>`;

export interface Response {
  ok: boolean;
  print: Record<string, unknown>;
}

interface Session {
  name: string;
  log: ObservationLog;
  /** What the session may use now: what it started with plus its extensions. */
  limits: SessionLimits;
  /** Each time the agent added to its own budget, with the reason it gave. */
  extensions: Extension[];
  startedAt: number;
  /** The models the agents that started this session gave, in the order they were first given. */
  models: string[];
  /** What `session start` gave whoever started the session: a later start of the running session needs it. Not written to the run. */
  key: string;
  commands: number;
  surface: Surface | null;
  /** Commands of one session run one after another. */
  queue: Promise<unknown>;
  blockedTotal: number;
  /** The slow methods of this session that run in the background. */
  jobs: Jobs;
}

/** A saved state: how to get from a fresh page to the state a session was in. */
export interface Recipe extends StateRecord {
  name: string;
  savedBy: string;
  savedAt: string;
  url: string | null;
  domSha256: string | null;
}

/** What the work of one command hands back besides its outcome. */
interface Turn {
  target: TargetRecord | null;
  /** Refusals on a page that is gone by the time the record is written. */
  blocked: Blocked[];
  /** Set when the time limit passed: whatever the work still produces must be thrown away. */
  cancelled: boolean;
  /** Browser contexts the work opened, so they can be closed when it runs out of time. */
  contexts: BrowserContext[];
  /** Set when the command was given wrongly; such a command does not count against the budget. */
  usage: boolean;
}

/** Commands that only ask where things stand. They cost nothing of the budget and are answered also when it is used up. */
const isFree = (command: string): boolean => ["status", "find", "tools", "wait", "state"].includes(command);

const SESSION_NAME = /^[a-z0-9][a-z0-9_-]{0,30}$/;
const RECIPE_NAME = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const DEFAULT_START = { width: 1280, height: 800, scheme: "light" } as const;
const MAX_BLOCKED_PRINTED = 3;
const MAX_DIFFERENCES = 10;
/** Keys that differ between two runs of the same instrument on the same page without the page being different. */
const NOT_COMPARED = new Set(["ref", "reg", "doc", "focusRef", "modalRef", "focusScreenshot", "ms", "cached"]);

const firstLine = (error: unknown): string => ((error as Error).message ?? String(error)).split("\n")[0]!;

/** A result without the parts that are only names for things: reference numbers and file paths. */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !NOT_COMPARED.has(key)).map(([key, entry]) => [key, comparable(entry)]));
  return value;
}

/**
 * Two results of a command that measures with several methods are compared method by method,
 * over the methods both have: a replay runs no background methods, and which methods agree
 * follows from their answers.
 */
function sameMethods(before: unknown, after: unknown): [unknown, unknown] {
  type WithMethods = { methods: { method: string; implementation: string }[] };
  const has = (value: unknown): value is WithMethods => value !== null && typeof value === "object" && Array.isArray((value as WithMethods).methods);
  if (!has(before) || !has(after)) return [before, after];
  const key = (entry: { method: string; implementation: string }): string => `${entry.method}/${entry.implementation}`;
  const inBoth = new Set(before.methods.map(key).filter((name) => after.methods.some((entry) => key(entry) === name)));
  return [{ methods: before.methods.filter((entry) => inBoth.has(key(entry))) }, { methods: after.methods.filter((entry) => inBoth.has(key(entry))) }];
}

function differences(before: unknown, after: unknown, path = "", found: string[] = []): string[] {
  if (found.length >= MAX_DIFFERENCES) return found;
  if (canonicalJson(before) === canonicalJson(after)) return found;
  const bothObjects = before !== null && after !== null && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after);
  if (!bothObjects) {
    const show = (value: unknown): string => (JSON.stringify(value) ?? "undefined").slice(0, 60);
    found.push(`${path || "result"}: ${show(before)} -> ${show(after)}`);
    return found;
  }
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
  for (const key of keys) differences((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key, found);
  return found;
}

/**
 * The process behind `loep`: one browser, a browser context per named session, and the
 * limits that keep an agent from changing or overloading the site under test.
 */
export class Daemon {
  readonly runDir: string;
  readonly limits: DaemonLimits;
  private readonly env: Env;
  private readonly sessions = new Map<string, Session>();
  /** WebKit and Firefox, started the first time a method asks for them. */
  private readonly second: SecondBrowsers;
  private toolsRecorded = false;
  lastCommandAt = Date.now();

  private constructor(runDir: string, browser: Browser, scope: Scope, limits: DaemonLimits) {
    this.runDir = runDir;
    this.limits = limits;
    this.env = { browser, runDir, scope, limits, politeness: new Politeness(limits.navigationDelayMs), blockade: new Blockade(runDir) };
    this.second = new SecondBrowsers(this.env, runSteps);
  }

  static async create(runDir: string, scope: Scope, limits: Partial<DaemonLimits> = {}): Promise<Daemon> {
    return new Daemon(runDir, await launchBrowser(), scope, { ...DEFAULT_DAEMON_LIMITS, ...limits });
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.surface?.context.close().catch(() => undefined);
      // A process that ends in an orderly way ends its sessions; only a process that died leaves a session to be resumed.
      await this.writeSessionFile(session, true).catch(() => undefined);
    }
    this.sessions.clear();
    await this.second.close();
    await this.env.browser.close().catch(() => undefined);
  }

  async handle(request: Request): Promise<Response> {
    this.lastCommandAt = Date.now();
    try {
      if (request.op === "list") {
        const sending = this.writeBudget();
        return { ok: true, print: { sessions: [...this.sessions.values()].map((session) => this.budget(session)), scope: this.env.scope.hosts, ...(sending ? { writes: writeBudgetNl(sending) } : {}) } };
      }
      const name = request.session ?? "main";
      if (!SESSION_NAME.test(name)) throw new Error(`"${name}" is geen geldige sessienaam (kleine letters, cijfers, - en _)`);
      if (request.op === "start") {
        const response = await this.start(name, request.limits ?? {}, cleanModel(request.model), request.key);
        // Whoever counted on another limit starts more agents than there is room for, or fewer than the owner of the site allows.
        if (request.maxSessions !== undefined && request.maxSessions !== this.limits.maxSessions) {
          response.print.warning = `het sessieproces liep al en laat ${this.limits.maxSessions} sessies tegelijk toe, niet ${request.maxSessions}. Reken met ${this.limits.maxSessions}, of stop alle sessies (session stop) en start opnieuw met --max-sessions ${request.maxSessions}`;
        }
        return response;
      }
      if (request.op === "stop") return await this.stop(request.session);
      const session = this.sessions.get(name);
      if (!session) throw new Error(`sessie "${name}" is niet gestart; start hem met: session start --run <run> --session ${name}`);
      if (request.op === "extend") return await this.extend(session, request.reason);
      // One command at a time per session; other sessions carry on.
      const turn = session.queue.then(() => this.command(session, request.command ?? "", request.args ?? [], request.options ?? {}));
      session.queue = turn.catch(() => undefined);
      return await turn;
    } catch (error) {
      return { ok: false, print: { error: firstLine(error) } };
    }
  }

  /** What is left of the budget for sending of the run, read from the run each time: the sweep sends from processes of its own. Null for a run that may not send. */
  private writeBudget(): WriteBudget | null {
    if (!this.env.scope.writes) return null;
    const permission = writesForRun(this.runDir);
    return permission ? writeBudget(this.runDir, permission) : null;
  }

  private budget(session: Session): Record<string, unknown> {
    const minutes = (Date.now() - session.startedAt) / 60_000;
    return {
      session: session.name,
      commands: `${session.commands} van ${session.limits.maxCommands}`,
      minutes: `${Math.round(minutes * 10) / 10} van ${session.limits.maxMinutes}`,
      blocked: session.blockedTotal,
      ...(session.extensions.length > 0 ? { extended: `${session.extensions.length} van ${EXTENSION.max} keer` } : {}),
    };
  }

  /** What the session started with: its limits without what it added itself. */
  private original(session: Session): SessionLimits {
    return {
      maxCommands: session.limits.maxCommands - session.extensions.reduce((sum, entry) => sum + entry.commands, 0),
      maxMinutes: session.limits.maxMinutes - session.extensions.reduce((sum, entry) => sum + entry.minutes, 0),
    };
  }

  private used(session: Session): { commands: number; minutes: number; share: number } {
    const minutes = (Date.now() - session.startedAt) / 60_000;
    const share = Math.max(session.limits.maxCommands > 0 ? session.commands / session.limits.maxCommands : 1, session.limits.maxMinutes > 0 ? minutes / session.limits.maxMinutes : 1);
    return { commands: session.commands, minutes, share };
  }

  /** How the agent adds to its budget, or that it cannot any more. */
  private extendNl(session: Session): string {
    const left = EXTENSION.max - session.extensions.length;
    return left > 0 ? `session extend --session ${session.name} --reason "<wat er nog gemeten moet worden>" (kan nog ${left} keer)` : `verlengen kan niet meer (al ${EXTENSION.max} keer gedaan)`;
  }

  /** One line from 80 percent of the commands or the minutes: what is left, that it is time to decide, and how to get more. Null before that. */
  private warning(session: Session): string | null {
    const used = this.used(session);
    if (used.share < EXTENSION.warnAt) return null;
    const commands = Math.max(0, session.limits.maxCommands - used.commands);
    const minutes = Math.max(0, Math.round((session.limits.maxMinutes - used.minutes) * 10) / 10);
    return `nog ${commands} van ${session.limits.maxCommands} commando's en ${minutes} van ${session.limits.maxMinutes} minuten: rond nu af en kom tot een oordeel. Moet er nog iets gemeten worden: ${this.extendNl(session)}`;
  }

  /**
   * The agent adds to its own budget: half of what the session started with, in commands and in
   * minutes. At most twice, only once most of the budget is used, and only with a reason that
   * says what is still to be measured. Nothing else changes: the limits of the process (sessions
   * at the same time, the pause between requests, the time per command) stay what they were.
   */
  private async extend(session: Session, reason: string | undefined): Promise<Response> {
    // After whatever command of this session is still running: its count belongs to what was used.
    await session.queue;
    const reasonNl = (reason ?? "").replace(/\s+/g, " ").trim();
    if (session.extensions.length >= EXTENSION.max) throw new Error(`geweigerd: deze sessie is al ${EXTENSION.max} keer verlengd en meer kan niet. Kom tot een oordeel met wat er ligt en schrijf wat niet is gemeten in missingNl, elk punt met "budget op:" ervoor`);
    if (reasonNl.length < MIN_EXTENSION_REASON) throw new Error(`session extend verwacht --reason "<tekst>": zeg wat er nog gemeten moet worden en waar (minstens ${MIN_EXTENSION_REASON} tekens)`);
    const used = this.used(session);
    if (used.share < EXTENSION.warnAt) throw new Error(`verlengen kan vanaf ${Math.round(EXTENSION.warnAt * 100)} procent van het budget; deze sessie heeft ${used.commands} van ${session.limits.maxCommands} commando's en ${Math.round(used.minutes * 10) / 10} van ${session.limits.maxMinutes} minuten gebruikt. Ga door met meten`);
    const added = extensionOf({ commands: this.original(session).maxCommands, minutes: this.original(session).maxMinutes });
    session.extensions.push({ at: new Date().toISOString(), reasonNl, commands: added.commands, minutes: added.minutes, usedCommands: used.commands, usedMinutes: Math.round(used.minutes * 10) / 10 });
    session.limits = { maxCommands: session.limits.maxCommands + added.commands, maxMinutes: session.limits.maxMinutes + added.minutes };
    await this.writeSessionFile(session);
    return { ok: true, print: { ...this.budget(session), added: `${added.commands} commando's en ${added.minutes} minuten`, note: `verlengd om: ${reasonNl}. ${session.extensions.length < EXTENSION.max ? `Verlengen kan nog ${EXTENSION.max - session.extensions.length} keer.` : "Dit was de laatste verlenging: kom hierna tot een oordeel."}` } };
  }

  private async start(name: string, limits: Partial<SessionLimits>, model: string | null = null, key?: string): Promise<Response> {
    const existing = this.sessions.get(name);
    if (existing) {
      // A running session has one owner: whoever has its key. Anyone else would measure in its page and on its budget.
      if (key !== existing.key) throw new Error(ownedSessionNl(name, key !== undefined));
      if (model && !existing.models.includes(model)) {
        existing.models.push(model);
        await this.writeSessionFile(existing);
      }
      return { ok: true, print: { ...this.budget(existing), ...(existing.models.length > 0 ? { model: existing.models.join(", ") } : {}), key: existing.key, note: "de sessie liep al; je gaat verder met je eigen sessie", limits: { maxSessions: this.limits.maxSessions } } };
    }
    if (this.sessions.size >= this.limits.maxSessions) throw new Error(tooManySessionsNl(this.sessions.size, this.limits.maxSessions));
    const log = new ObservationLog(this.runDir, name);
    await log.init();
    // The budget belongs to the name of the session within the run, not to a process and not to one start:
    // whoever starts a session that existed before, after a stop or after the process went away, goes on with
    // what was used, the clock of the first start and the limits of the first start. A later start can lower a limit, never raise it.
    const filePath = join(this.runDir, log.relativeDir, "session.json");
    const earlier = existsSync(filePath) ? await readJson<{ startedAt?: string; commands?: number; blocked?: number; limits?: Partial<SessionLimits>; models?: unknown; extensions?: unknown }>(filePath).catch(() => null) : null;
    const resumed = earlier && earlier.startedAt ? earlier : null;
    const asked = { ...DEFAULT_SESSION_LIMITS, ...limits };
    // What the session added itself stays: a later start names the budget of the task, and that is compared with what the session started with.
    const extensions = resumed && Array.isArray(resumed.extensions) ? (resumed.extensions as Extension[]) : [];
    const added = { commands: extensions.reduce((sum, entry) => sum + entry.commands, 0), minutes: extensions.reduce((sum, entry) => sum + entry.minutes, 0) };
    const kept: SessionLimits = resumed
      ? {
          maxCommands: Math.min(resumed.limits?.maxCommands === undefined ? asked.maxCommands : resumed.limits.maxCommands - added.commands, limits.maxCommands ?? Number.POSITIVE_INFINITY) + added.commands,
          maxMinutes: Math.min(resumed.limits?.maxMinutes === undefined ? asked.maxMinutes : resumed.limits.maxMinutes - added.minutes, limits.maxMinutes ?? Number.POSITIVE_INFINITY) + added.minutes,
        }
      : asked;
    // Who starts the session says which model it runs on; a later start on another model is added, not put in its place.
    const models = (resumed && Array.isArray(resumed.models) ? resumed.models : []).map(cleanModel).filter((entry): entry is string => entry !== null);
    if (model && !models.includes(model)) models.push(model);
    const session: Session = { name, log, limits: kept, extensions, startedAt: resumed ? Date.parse(resumed.startedAt!) : Date.now(), models, key: randomBytes(4).toString("hex"), commands: resumed?.commands ?? 0, surface: null, queue: Promise.resolve(), blockedTotal: resumed?.blocked ?? 0, jobs: new Jobs() };
    this.sessions.set(name, session);
    await this.writeSessionFile(session);
    if (!this.toolsRecorded) {
      // Which methods a session can measure with, and in which version, belongs in the manifest of the run.
      this.toolsRecorded = true;
      await toolsOutcome(this.runDir, this.second.versions).catch(() => undefined);
    }
    return {
      ok: true,
      print: {
        ...this.budget(session),
        key: session.key,
        model: models.length > 0 ? models.join(", ") : "niet opgegeven; geef het op met session start --model \"<naam en versie>\"",
        ...(resumed ? { note: `sessie bestond al: ${session.commands} van ${session.limits.maxCommands} gebruikt, ${Math.round(((Date.now() - session.startedAt) / 60_000) * 10) / 10} van ${session.limits.maxMinutes} minuten sinds de eerste start` } : {}),
        scope: this.env.scope.hosts,
        observations: `${log.relativeDir}/<nr>.json`,
        limits: { commandTimeoutSeconds: this.limits.commandTimeoutMs / 1000, navigationDelayMs: this.limits.navigationDelayMs, maxSessions: this.limits.maxSessions },
      },
    };
  }

  private async stop(name: string | undefined): Promise<Response> {
    const stopped: string[] = [];
    for (const session of [...this.sessions.values()]) {
      if (name && session.name !== name) continue;
      await session.queue;
      // What still runs in the background gets a moment to finish; its page goes with the session.
      await session.jobs.idle(5000);
      await this.second.closeSession(session.name);
      await session.surface?.context.close().catch(() => undefined);
      await this.writeSessionFile(session, true);
      this.sessions.delete(session.name);
      stopped.push(session.name);
    }
    if (name && stopped.length === 0) throw new Error(`sessie "${name}" loopt niet`);
    return { ok: true, print: { stopped, remaining: this.sessions.size } };
  }

  private async writeSessionFile(session: Session, stopped = false): Promise<void> {
    await writeJson(join(this.runDir, session.log.relativeDir, "session.json"), {
      session: session.name,
      startedAt: new Date(session.startedAt).toISOString(),
      ...(stopped ? { stoppedAt: new Date().toISOString() } : {}),
      ...(session.models.length > 0 ? { models: session.models } : {}),
      commands: session.commands,
      blocked: session.blockedTotal,
      limits: { ...session.limits, ...this.limits },
      ...(session.extensions.length > 0 ? { extensions: session.extensions } : {}),
      scope: this.env.scope,
      outsideScopeLoaded: session.surface?.guard.outsideScopeLoaded ?? {},
      toolbox: SESSION_TOOLBOX,
    });
  }

  /** Run one command of an agent, within its budget and time limit, and write the record. */
  private async command(session: Session, command: string, rawArgs: string[], options: Options): Promise<Response> {
    const known = ["open", "state", "replay", "status", "wait", "tools", "sheet", "document", "voiceover", ...PUBLIC_COMMANDS];
    if (!known.includes(command)) throw new Error(`onbekend commando "${command}"; kies uit: ${known.join(", ")}`);
    const minutes = (Date.now() - session.startedAt) / 60_000;
    const free = isFree(command);
    if (!free) {
      if (session.commands >= session.limits.maxCommands) throw new Error(`budget op: deze sessie heeft ${session.commands} van ${session.limits.maxCommands} commando's gebruikt; rond af met wat er ligt, of ${this.extendNl(session)}`);
      if (minutes >= session.limits.maxMinutes) throw new Error(`budget op: deze sessie loopt ${Math.round(minutes)} van ${session.limits.maxMinutes} minuten; rond af met wat er ligt, of ${this.extendNl(session)}`);
      session.commands++;
    }

    // While a command runs the agent may be acting on the page: what the page sends over a socket then is not known to be its own.
    if (session.surface) session.surface.guard.idle = false;
    const nr = session.log.reserve();
    const id = observationId(session.name, nr);
    const images = new Images(this.runDir, session.log.file(nr, ""));
    const started = Date.now();
    const before = stateOf(session.surface);
    // Filled in by the work below; it also has to be there when the work fails or runs out of time.
    const turn: Turn = { target: null, blocked: [], cancelled: false, contexts: [], usage: false };
    const multiplier = command === "replay" || (command === "open" && options.state) ? 4 : 1;
    // A reading by VoiceOver can wait for the one virtual Mac, and then takes most of a minute itself.
    const limitMs = command === "voiceover" ? Math.max(this.limits.commandTimeoutMs, VOICEOVER_COMMAND_MS) : this.limits.commandTimeoutMs * multiplier;
    const limited = await withinTime(limitMs, () => this.work(session, command, rawArgs, options, turn, before, images, id).catch((error: Error) => {
      if (error instanceof UsageError) turn.usage = true;
      throw error;
    }));
    // A command that was given wrongly did nothing; it is not charged.
    if (turn.usage && !free) session.commands--;

    // A command that ran out of time may still be busy with the page: the page cannot be trusted any more.
    const timedOut = !limited.ok && limited.reason.startsWith("geen antwoord binnen");
    if (timedOut) {
      turn.cancelled = true;
      for (const context of [session.surface?.context, ...turn.contexts]) await context?.close().catch(() => undefined);
      session.surface = null;
    }
    const surface = session.surface;
    let error = limited.ok ? null : `${limited.reason}${timedOut ? "; de pagina is gesloten, begin opnieuw met open" : ""}`;
    if (surface && !error) await leftScope(this.env, surface).catch((left: Error) => void (error = left.message));
    // A navigation that was refused halfway (a redirect out of the scope) leaves the browser's error page behind.
    if (surface && !error && surface.page.url().startsWith("chrome-error:")) error = "de navigatie is niet gelukt of geweigerd en de pagina is weg; begin opnieuw met open";
    const facts = surface ? await pageFacts(surface) : null;
    // Everything refused since the previous command, also what the page tried by itself in between.
    const blocked: Blocked[] = [...turn.blocked, ...(surface ? surface.guard.blocked.splice(0) : []), ...this.second.takeRefused(session.name)];
    session.blockedTotal += blocked.length;
    // What went through to a test environment where the run may write; nothing on any other site.
    const written = surface?.guard.passed?.splice(0) ?? [];
    // Messages played from a recording instead of sent.
    const replayed = surface?.guard.replays?.splice(0) ?? [];
    // Read requests of the site model that went through, such as a question to a search service.
    const read = surface?.guard.reads?.splice(0) ?? [];
    // Cloudflare's check whether the browser is a robot, which Cloudflare answers and the site never gets.
    const challenges = surface?.guard.challenges?.splice(0) ?? [];
    // An origin of the site that blocked the run while this command ran: from now on no session asks it anything.
    const blockades = this.env.blockade?.since(started) ?? [];
    const after = stateOf(surface);
    const observation: Observation = {
      id,
      nr,
      session: session.name,
      time: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      command,
      args: rawArgs,
      options,
      target: turn.target,
      state: command === "open" ? after : before,
      stateAfter: after.id !== before.id && command !== "open" ? after.id : null,
      page: toRecord(facts),
      result: limited.ok ? limited.value.result : null,
      images: await images.hashed(),
      blocked,
      ...(written.length > 0 ? { writes: written } : {}),
      ...(replayed.length > 0 ? { replays: replayed.map(({ noteNl: _noteNl, ...entry }) => entry) } : {}),
      ...(read.length > 0 ? { reads: read } : {}),
      ...(challenges.length > 0 ? { challenges } : {}),
      ...(blockades.length > 0 ? { blockades } : {}),
      popups: surface ? surface.popups.splice(0) : [],
      alerts: surface ? surface.alerts.splice(0) : [],
      error,
    };
    await session.log.write(observation);
    await this.writeSessionFile(session);
    const print: Record<string, unknown> = { id, ...(limited.ok && !error ? limited.value.print : { error }) };
    // The words a finding needs to say where the element is, ready to copy.
    if (!error && turn.target && (turn.target.heading || turn.target.around || turn.target.frame)) print.place = { ...(turn.target.frame ? { frame: sayFrame(turn.target.frame) } : {}), ...(turn.target.heading ? { heading: turn.target.heading } : {}), ...(turn.target.around ? { text: turn.target.around } : {}) };
    if (written.length > 0) print.written = [...written.slice(0, MAX_BLOCKED_PRINTED).map((entry) => `${entry.method} ${entry.path.slice(0, 100)}`), ...(written.length > MAX_BLOCKED_PRINTED ? [`(+${written.length - MAX_BLOCKED_PRINTED})`] : [])];
    if (replayed.length > 0) print.replayed = [...new Set(replayed.map((entry) => entry.noteNl))];
    if (read.length > 0) print.read = [...read.slice(0, MAX_BLOCKED_PRINTED).map((entry) => `${entry.method} ${entry.url.slice(0, 100)} (leesverzoek ${entry.rule})`), ...(read.length > MAX_BLOCKED_PRINTED ? [`(+${read.length - MAX_BLOCKED_PRINTED})`] : [])];
    if (challenges.length > 0) print.challenge = `${challenges.length} ${challenges.length === 1 ? "verzoek" : "verzoeken"} van de controle van Cloudflare tegen robots doorgelaten (${[...new Set(challenges.map((entry) => new URL(entry.url).hostname))].join(", ")}); de site krijgt die niet`;
    if (blocked.length > 0) print.blocked = [...blocked.slice(0, MAX_BLOCKED_PRINTED).map((entry) => `${entry.kind}: ${entry.method} ${entry.url.slice(0, 100)}${entry.search ? ` (zoekvraag: ${entry.search.join(", ")})` : ""}${entry.reasonNl ? ` (${entry.reasonNl})` : ""}`), ...(blocked.length > MAX_BLOCKED_PRINTED ? [`(+${blocked.length - MAX_BLOCKED_PRINTED})`] : [])];
    // A write the budget for sending held back: the agent hears why, and what to write when nothing more can be sent.
    const heldBack = blocked.find((entry) => entry.writeBudget === "out") ?? blocked.find((entry) => entry.writeBudget === "share") ?? blocked.find((entry) => entry.writeBudget === "spacing");
    if (heldBack) {
      const sending = this.writeBudget();
      print.sending =
        heldBack.writeBudget === "out" && sending
          ? `het budget voor versturen van deze run is op: ${sending.sent} van ${sending.max} verstuurd, door alle sessies en de veegronde samen. Er gaat niets meer weg. Wat daardoor niet te zien is, schrijf je als open punt: "${budgetOutPointNl(sending)}: <wat er pas na versturen te zien was>"`
          : heldBack.writeBudget === "share" && sending
            ? `${heldBack.reasonNl}. Er is niets verstuurd: haal de waarneming aan van de verzending die er al was (de veegronde of een eerdere sessie van dit criterium). Is wat je zoekt daar niet te zien, schrijf het dan als open punt: "${budgetOutPointNl(sending)}: <wat er pas na versturen te zien was>"`
            : `${heldBack.reasonNl ?? "te kort na de vorige verzending"}. Er is niets verstuurd: kijk of een eerdere waarneming of de veegronde laat zien wat je zoekt, en doe de handeling anders na die tijd opnieuw`;
    }
    const refusedByBlockade = blocked.find((entry) => entry.kind === "blockade");
    if (blockades.length > 0 || refusedByBlockade) print.blockade = blockades.length > 0 ? blockades.map(refusalNl).join(". ") : refusedByBlockade!.reasonNl;
    if (observation.popups.length > 0) print.popups = observation.popups;
    if (observation.alerts.length > 0) print.alerts = observation.alerts.map((alert) => `${alert.type}: ${alert.message.slice(0, 80)}`);
    // From 80 percent on every answer says so, in one line: the agent reads answers, not its status.
    const warning = this.warning(session);
    if (warning) print.budget = warning;
    // Until the next command nobody acts on the page, unless a method of this command still does in the background.
    if (session.surface && session.jobs.pending.running.length === 0) session.surface.guard.idle = true;
    return { ok: error === null, print };
  }

  /** What one command does, apart from the bookkeeping around it. */
  private async work(session: Session, command: string, rawArgs: string[], options: Options, turn: Turn, before: StateRecord, images: Images, id: string): Promise<Outcome> {
      if (command === "open") return this.open(session, rawArgs, options, turn);
      if (command === "status") {
        const status = { ...this.budget(session), state: before.id, steps: before.steps.length, url: session.surface?.page.url() ?? null, background: session.jobs.pending.running };
        return { result: status, print: { ...status, note: "minuten: kloktijd sinds de sessie met deze naam voor het eerst is gestart in deze run, ook tussen de commando's en ook na stoppen en opnieuw starten; status, find, state, tools en wait tellen niet mee als commando" } };
      }
      if (command === "state") return this.state(session, rawArgs);
      if (command === "replay") return this.replay(session, rawArgs, images, turn);
      if (command === "wait") return waitOutcome(session.jobs, options, this.limits.commandTimeoutMs - 5000);
      if (command === "tools") return toolsOutcome(this.runDir, this.second.versions);
      if (command === "sheet") return sheetOutcome(this.runDir, rawArgs, images);
      // A document of the sample is read from the run, not from a page: no page has to be open.
      if (command === "document") return documentOutcome(this.runDir, rawArgs, options, images);
      // VoiceOver in Safari in the virtual Mac reads the state this session is in; the page of the session itself is not touched.
      if (command === "voiceover") return voiceoverOutcome({ env: this.env, current: session.surface ? before : null, args: rawArgs, options, images, blocked: turn.blocked, resolveUrl: (address) => this.resolveUrl(address), loadRecipe: (name) => this.loadRecipe(name) });
      const surface = session.surface;
      if (!surface) throw new Error("er is nog geen pagina geopend; begin met: open <adres of paginalabel>");
      const { info, args, stepOptions } = await this.bind(surface, command, rawArgs, options);
      turn.target = info ? { ref: info.ref, path: info.path, tag: info.tag, role: info.role, text: info.text, heading: info.heading ?? null, around: info.around ?? null, ...(info.frame ? { frame: info.frame } : {}) } : null;
      const services: Services = { session: session.name, origin: id, state: before, jobs: session.jobs, second: this.limits.secondBrowsers ? this.second : null };
      return execute({ env: this.env, surface, images, target: info, services }, command, args, stepOptions);
  }

  /** Find the element a command points at, and take the reference number out of its arguments. */
  private async bind(surface: Surface, command: string, rawArgs: string[], options: Options): Promise<{ info: TargetInfo | null; args: string[]; stepOptions: Options }> {
    const spec = COMMANDS[command]!;
    // An element is pointed at by its number, or by a selector that matches exactly one element.
    const points = (value: string | boolean | undefined): value is string => typeof value === "string" && (/^\d+$/.test(value) || value.startsWith("css:"));
    const element = async (value: string | boolean | undefined): Promise<TargetInfo> => {
      try {
        if (typeof value === "string" && value.startsWith("css:")) {
          const found = await find(surface, "css", value.slice(4).trim(), 1).catch((error: Error) => {
            throw new Error(`ongeldige selector: ${firstLine(error)}`);
          });
          if (found.total === 0) throw new Error(`geen element voor ${value}`);
          if (found.total > 1) throw new Error(`${found.total} elementen voor ${value}; maak de selector preciezer of kies een nummer uit find`);
          return found.items[0]!;
        }
        if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${command} verwacht het nummer van een element (uit look of find) of css:<selector>, niet "${String(value ?? "")}"`);
        return await resolveRef(surface, Number(value));
      } catch (error) {
        throw new UsageError(firstLine(error));
      }
    };
    if (spec.target === "first-argument" || (spec.target === "optional-first-argument" && points(rawArgs[0]))) {
      return { info: await element(rawArgs[0]), args: rawArgs.slice(1), stepOptions: options };
    }
    if (spec.target === "option-from" && options.from !== undefined) {
      const { from, ...rest } = options;
      if (from === "focus") {
        // From where focus is now: inside a panel that was just opened, for example.
        const focused = (await pageFacts(surface))?.focus ?? null;
        if (!focused) throw new UsageError("--from focus: er heeft nu geen element focus; geef een ref of css:<selector>");
        return { info: focused, args: rawArgs, stepOptions: rest };
      }
      return { info: await element(from), args: rawArgs, stepOptions: rest };
    }
    await syncRefs(surface);
    return { info: null, args: rawArgs, stepOptions: options };
  }

  private async resolveUrl(address: string): Promise<string> {
    const samplePath = join(this.runDir, "sample.json");
    if (/^p\d+$/i.test(address) && existsSync(samplePath)) {
      // Page labels as in the dossier: P01 is the first page of the sample.
      const sample = await readJson<{ items: { url: string }[] }>(samplePath);
      const item = sample.items[Number(address.slice(1)) - 1];
      if (!item) throw new Error(`de steekproef heeft geen pagina ${address.toUpperCase()}`);
      return item.url;
    }
    let url: URL;
    try {
      url = new URL(address, this.env.scope.baseUrl ?? undefined);
    } catch {
      throw new Error(`"${address}" is geen adres en geen paginalabel`);
    }
    // Only a page of the web: never a file on this machine or an address that holds its own content (data:, blob:, javascript:).
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`"${address.slice(0, 120)}" is geen adres met http:// of https://; een sessie opent alleen pagina's van de site`);
    return url.href;
  }

  /** The site model of the run, when there is one that passed `check-site`; a session works without it too. */
  private async checkedModel(): Promise<SiteModel | null> {
    return loadSiteModel(this.runDir).catch(() => null);
  }

  /**
   * Open a page, or a saved state.
   *
   * - A page: in a run with a checked site model the blockers of the model are closed first,
   *   unless `--with-blockers` asks for the page as a first visitor gets it.
   * - A blocker state: its recipe, then on to the page that was asked for.
   * - A component or process state: its own recipe, which ends where it was recorded. Another
   *   page can only be asked for when the recipe never leaves its page; then its steps are done there.
   *
   * `reproduced` has one meaning: every step of the recipe was done again and the postcondition
   * that site.json gives for the state holds on the page that is open now. It is null for a
   * state that site.json does not describe.
   */
  private async open(session: Session, args: string[], options: Options, turn: Turn): Promise<Outcome> {
    const recipe = typeof options.state === "string" ? await this.loadRecipe(options.state) : null;
    if (!recipe && !args[0]) throw new Error("open verwacht een adres of paginalabel, of --state <naam>");
    if (options.scheme !== undefined && options.scheme !== "light" && options.scheme !== "dark") throw new Error("--scheme is light of dark");
    const size = (name: "width" | "height", fallback: number): number => {
      const value = Number(options[name] ?? fallback);
      if (!Number.isInteger(value) || value < 200 || value > 4000) throw new Error(`--${name} moet tussen 200 en 4000 liggen`);
      return value;
    };
    const model = await this.checkedModel();
    const blockers = model && options["with-blockers"] !== true ? model.blockers : [];
    const asked = args[0] ? await this.resolveUrl(args[0]) : null;
    const ownSteps = (steps: Step[]): Step[] => steps.slice(0, steps.findIndex((step) => step.command === "goto") === -1 ? steps.length : steps.findIndex((step) => step.command === "goto"));
    const blockerRecipes = new Map<string, Step[]>();
    for (const blocker of model?.blockers ?? []) blockerRecipes.set(blocker.id, ownSteps((await this.loadRecipe(blocker.recipe)).steps));
    const entry = recipe && model ? ([...model.blockers.map((item) => ({ recipe: item.recipe, postcondition: item.postcondition as Postcondition | null, part: "blocker" })), ...model.components.map((item) => ({ recipe: item.recipe, postcondition: item.postcondition, part: "component" })), ...model.processes.map((item) => ({ recipe: item.recipe, postcondition: item.postcondition as Postcondition | null, part: "process" }))].find((item) => item.recipe === recipe.name) ?? null) : null;
    const isBlocker = entry?.part === "blocker";
    const sameStep = (first: Step, second: Step): boolean => first.command === second.command && canonicalJson(first.args) === canonicalJson(second.args) && canonicalJson(first.target) === canonicalJson(second.target);
    // The steps of a component recipe that close a blocker first: those are not what opens the component.
    const prefix = recipe ? Math.max(0, ...[...blockerRecipes.values()].map((steps) => (steps.length <= recipe.steps.length && steps.every((step, index) => sameStep(step, recipe.steps[index]!)) ? steps.length : 0))) : 0;
    const leavesItsPage = recipe ? recipe.steps.some((step) => step.command === "goto") || (recipe.url !== null && recipe.start !== null && recipe.url.split("#")[0] !== recipe.start.url.split("#")[0]) : false;
    // A component or process state on another page than the one it was recorded on.
    const elsewhere = recipe !== null && !isBlocker && asked !== null && recipe.start !== null && asked !== recipe.start.url && asked !== recipe.url;
    // A recipe that site.json does not describe and that stays on its page is replayed first and the page opened after it: that is how a blocker recipe is used before there is a model.
    const legacy = elsewhere && entry === null && !leavesItsPage;
    if (elsewhere && !legacy && leavesItsPage) throw new Error(`toestand "${recipe.name}" is vastgelegd op ${recipe.url ?? recipe.start!.url} en gaat daar zelf naartoe; open hem zonder adres of paginalabel: open --state ${recipe.name}`);
    const transplant = elsewhere && !legacy;

    const start: StartState = {
      url: recipe && !transplant ? (recipe.start?.url ?? asked!) : asked!,
      width: size("width", recipe?.start?.width ?? DEFAULT_START.width),
      height: size("height", recipe?.start?.height ?? DEFAULT_START.height),
      scheme: (options.scheme as StartState["scheme"] | undefined) ?? recipe?.start?.scheme ?? DEFAULT_START.scheme,
    };
    // A fresh browser context for every open: a state is a sequence of steps from a clean page.
    await session.surface?.context.close().catch(() => undefined);
    session.surface = null;
    const { surface, load } = await openSurface(this.env, start, (context) => turn.contexts.push(context), session.name).catch((error: Error) => {
      turn.blocked.push(...((error as Refused).blocked ?? []));
      throw error;
    });
    if (turn.cancelled) {
      // The time limit passed while the page was loading; nobody is waiting for it any more.
      await surface.context.close().catch(() => undefined);
      throw new Error("te laat geladen");
    }
    session.surface = surface;
    let status = load.status;
    const matches: string[] = [];
    const closed: string[] = [];
    const notClosed: string[] = [];
    const scratch = await mkdtemp(join(tmpdir(), "loep-recipe-"));
    const run = async (steps: Step[], what: string): Promise<void> => {
      const failed = await runSteps(this.env, surface, steps, new Images(scratch, "step"), matches);
      if (failed) throw new Error(`${what} is niet te bereiken: stap ${failed.index + 1} (${failed.command}) ${failed.reason}`);
    };
    /** Close what the model says covers the page, where it is there. */
    const closeBlockers = async (): Promise<void> => {
      for (const blocker of blockers) {
        if ((await holds(surface.page, blocker.postcondition)).holds) continue;
        const failed = await runSteps(this.env, surface, blockerRecipes.get(blocker.id)!, new Images(scratch, "step"), matches);
        const gone = failed ? false : (await holds(surface.page, blocker.postcondition, POSTCONDITION_WAIT_MS)).holds;
        (gone ? closed : notClosed).push(blocker.id);
      }
    };
    let reproduced: boolean | null = null;
    let detail: string | null = null;
    try {
      if (!recipe) await closeBlockers();
      else if (transplant) {
        await closeBlockers();
        await run(recipe.steps.slice(prefix), `toestand "${recipe.name}" (vastgelegd op ${recipe.start!.url}) op deze pagina`).catch((error: Error) => {
          throw new Error(`${error.message}; open hem zonder adres of paginalabel: open --state ${recipe.name}`);
        });
      } else {
        await run(recipe.steps, `toestand "${recipe.name}"`);
        // A blocker state, or a recipe from before there was a model: the recipe first, then on to the page that was asked for.
        if ((isBlocker || legacy || (entry === null && !leavesItsPage)) && asked !== null && asked !== surface.page.url()) {
          status = ((await execute({ env: this.env, surface, images: new Images(this.runDir, "unused"), target: null }, "goto", [asked], {})).result as { status: number | null }).status;
          // A choice the site did not remember for this page: close the blocker here as well.
          if (isBlocker) await closeBlockers();
        }
      }
      if (recipe && entry?.postcondition) {
        const held = await holds(surface.page, entry.postcondition, POSTCONDITION_WAIT_MS);
        reproduced = held.holds;
        if (!held.holds) detail = held.detail;
        if (!held.holds && transplant) throw new Error(`toestand "${recipe.name}" is vastgelegd op ${recipe.start!.url} en is op deze pagina niet te bereiken (${held.detail}); open hem zonder adres of paginalabel: open --state ${recipe.name}`);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    const facts = await pageFacts(surface);
    const result = { status, url: facts?.url ?? load.finalUrl, title: facts?.title ?? null, contentType: load.contentType, viewport: { width: start.width, height: start.height }, scheme: start.scheme, state: recipe ? { name: recipe.name, reproduced, ...(detail ? { postcondition: detail } : {}) } : null, blockersClosed: closed, blockersNotClosed: notClosed, locators: matches, dialogs: facts?.dialogs ?? 0 };
    return {
      result,
      print: {
        status,
        url: result.url,
        title: result.title,
        ...(start.width !== DEFAULT_START.width || start.scheme !== DEFAULT_START.scheme ? { viewport: `${start.width}x${start.height}`, scheme: start.scheme } : {}),
        ...(recipe ? { state: recipe.name, reproduced } : {}),
        ...(recipe && reproduced === null ? { note: "site.json geeft voor deze toestand geen postconditie: de stappen zijn uitgevoerd, of de toestand klopt is niet nagerekend" } : {}),
        ...(detail ? { postcondition: `geldt niet: ${detail}` } : {}),
        ...(closed.length > 0 ? { blockersClosed: closed } : {}),
        ...(notClosed.length > 0 ? { blockersNotClosed: notClosed } : {}),
        ...(matches.length > 0 ? { locators: matches } : {}),
        ...(result.dialogs > 0 ? { dialogs: result.dialogs } : {}),
      },
    };
  }

  private recipePath(name: string): string {
    if (!RECIPE_NAME.test(name)) throw new Error(`"${name}" is geen geldige naam voor een toestand (kleine letters, cijfers, - en _)`);
    return join(this.runDir, "recipes", `${name}.json`);
  }

  private async loadRecipe(name: string): Promise<Recipe> {
    const path = this.recipePath(name);
    if (!existsSync(path)) throw new Error(`er is geen toestand "${name}" bewaard in deze run`);
    return readJson<Recipe>(path);
  }

  private async state(session: Session, args: string[]): Promise<Outcome> {
    const [action, name] = args;
    if (action === "list") {
      const dir = join(this.runDir, "recipes");
      const names = existsSync(dir) ? (await readdir(dir)).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort() : [];
      return { result: { states: names }, print: { states: names } };
    }
    if (action !== "save" || !name) throw new Error("gebruik: state save <naam> of state list");
    if (!session.surface) throw new Error("er is nog geen pagina geopend; er is geen toestand om te bewaren");
    const facts = await pageFacts(session.surface);
    const recipe: Recipe = { ...stateOf(session.surface), name, savedBy: session.name, savedAt: new Date().toISOString(), url: facts?.url ?? null, domSha256: facts?.domSha256 ?? null };
    await writeJson(this.recipePath(name), recipe);
    return { result: recipe, print: { saved: name, state: recipe.id, steps: recipe.steps.length, file: join("recipes", `${name}.json`) } };
  }

  /**
   * Repeat an earlier observation on a fresh page: the steps that led to its state, then
   * the same command on the same element, and compare what comes out.
   */
  private async replay(session: Session, args: string[], images: Images, turn: Turn): Promise<Outcome> {
    if (!args[0]) throw new Error("replay verwacht het nummer van een waarneming, bijvoorbeeld main-0007");
    const original = await readObservation(this.runDir, args[0]);
    if (!original.state.start || !(original.command === "open" || original.command in COMMANDS)) throw new Error(`waarneming ${original.id} (${original.command}) is geen handeling of meting op een pagina en is niet af te spelen`);
    if (original.error) throw new Error(`waarneming ${original.id} eindigde zelf in een fout en is niet af te spelen`);
    const { surface } = await openSurface(this.env, original.state.start, (context) => turn.contexts.push(context), session.name).catch((error: Error) => {
      turn.blocked.push(...((error as Refused).blocked ?? []));
      throw error;
    });
    const scratch = await mkdtemp(join(tmpdir(), "loep-replay-"));
    try {
      if (original.command === "open") {
        // Nothing to repeat but the loading itself: is the page still what it was?
        const domSame = (await pageFacts(surface))?.domSha256 === original.page?.domSha256;
        const result = { replayed: original.id, command: "open", verdict: domSame ? "same" : "different", resultSame: null, domSame, imageSame: null, differences: [] };
        return { result, print: { replay: original.id, verdict: result.verdict, domSame } };
      }
      const failed = await runSteps(this.env, surface, original.state.steps, new Images(scratch, "step"));
      if (failed) {
        const reason = `stap ${failed.index + 1} (${failed.command}) ${failed.reason}`;
        return { result: { replayed: original.id, verdict: "different", reason }, print: { replay: original.id, verdict: "different", reason } };
      }
      const spec = COMMANDS[original.command]!;
      const info = original.target ? await resolvePath(surface, original.target.path) : null;
      if (original.target && !info) {
        const reason = "het element van de waarneming is niet teruggevonden";
        return { result: { replayed: original.id, verdict: "different", reason }, print: { replay: original.id, verdict: "different", reason } };
      }
      const { from: _from, ...optionsWithoutRef } = original.options;
      const args = spec.target === "first-argument" || (spec.target === "optional-first-argument" && original.target) ? original.args.slice(1) : original.args;
      // The methods that run in this browser are repeated; nothing is started in the background or in another browser.
      const services: Services = { session: "replay", origin: original.id, state: original.state, jobs: null, second: null };
      const outcome = await execute({ env: this.env, surface, images, target: info, services }, original.command, args, spec.target === "option-from" ? optionsWithoutRef : original.options);
      const facts = await pageFacts(surface);
      const now = await images.hashed();
      const [was, is] = sameMethods(original.result, outcome.result);
      const found = differences(comparable(was), comparable(is));
      const resultSame = found.length === 0;
      const domSame = facts?.domSha256 === original.page?.domSha256;
      const imageSame = original.images.length === 0 ? null : original.images.length === now.length && original.images.every((image, index) => image.sha256 === now[index]!.sha256);
      const result = { replayed: original.id, command: original.command, verdict: resultSame ? "same" : "different", resultSame, domSame, imageSame, differences: found, result: outcome.result };
      return { result, print: { replay: original.id, verdict: result.verdict, resultSame, domSame, ...(imageSame === null ? {} : { imageSame }), ...(found.length > 0 ? { differences: found } : {}) } };
    } finally {
      turn.blocked.push(...surface.guard.blocked);
      await surface.context.close().catch(() => undefined);
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

/** The context a command runs in: the document of its element, or for a key the document that has focus. */
async function atHome(context: Context, spec: Spec): Promise<Context> {
  if (context.target) return { ...context, ...(await homeOf(context.surface, context.target)) };
  if (spec.target !== "focus") return context;
  const focus = (await pageFacts(context.surface))?.focus;
  return focus?.frame ? { ...context, surface: (await homeOf(context.surface, focus)).surface } : context;
}

/**
 * Run one command on a page and, when it changes the state, add it to the steps that describe
 * how the page got there. The command itself runs in the document of its element; the step
 * keeps the chain from the tab down, so it finds the element again from a fresh page.
 */
export async function execute(context: Context, command: string, args: string[], options: Options, recorded?: Locators | null): Promise<Outcome> {
  const spec = COMMANDS[command]!;
  const home = await atHome(context, spec);
  // Noted before the action: afterwards the element may be gone. A replayed step keeps what was noted when it was recorded.
  const changes = typeof spec.changes === "function" ? spec.changes(options) : spec.changes;
  const locators = !changes || !home.target ? null : recorded !== undefined ? recorded : await tgs<Locators | null>(home.surface, "locatorsFor", home.target.ref).catch(() => null);
  const outcome = await spec.run(home, args, options);
  if (changes) context.surface.steps.push({ command, ...(outcome.step ?? { args, options }), target: context.target?.path ?? null, ...(locators ? { locators } : {}) });
  return outcome;
}

/** Asked for by the sweep: what a simulated screen reader said by itself during the last step, the one that brings the page into its state. */
export interface LastStepSpeech {
  /** Per document that was listened in; stays empty when the step replaced the page or is not an action on the page. */
  heard: Heard[];
}

/** Execute recorded steps on a fresh page. Returns the first step that could not be done, or null. */
/** Whether an error is, or was caused by, a Playwright time-out: the step waited for the page and the page did not come. */
export function isTimeout(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) if (current.name === "TimeoutError") return true;
  return false;
}

export async function runSteps(env: Env, surface: Surface, steps: Step[], images: Images, matches?: string[], speech?: LastStepSpeech): Promise<{ index: number; command: string; reason: string; timedOut?: boolean } | null> {
  for (const [index, step] of steps.entries()) {
    const info = step.target ? await resolveStep(surface, { target: step.target, locators: step.locators ?? null }) : null;
    if (step.target && !info) return { index, command: step.command, reason: STEP_NOT_FOUND_NL };
    // The reader listens in the tab itself, and in the embedded frame the step acts in.
    const listening: Surface["page"][] = [];
    if (speech && index === steps.length - 1 && step.command !== "goto") {
      const inner = info?.frame ? ((await homeOf(surface, info).catch(() => null))?.surface.page ?? null) : null;
      for (const page of [surface.top.page, ...(inner ? [inner] : [])]) if (await startListening(page).then(() => true, () => false)) listening.push(page);
    }
    // Worth saying only when the selector chain did not lead to the element by itself.
    if (info && info.matchedBy !== "selector") matches?.push(`stap ${index + 1} (${step.command}): gevonden via ${info.matchedBy === "role-and-name" ? "rol en naam" : info.matchedBy === "structure" ? "de plek in de code, zonder id" : "de selector, al is het element anders dan bij het opnemen"}`);
    try {
      await execute({ env, surface, images, target: info }, step.command, step.args, step.options, step.locators ?? null);
      await leftScope(env, surface);
    } catch (error) {
      return { index, command: step.command, reason: firstLine(error), ...(isTimeout(error) ? { timedOut: true } : {}) };
    } finally {
      for (const page of listening) {
        const heard = await stopListening(page);
        if (heard) speech!.heard.push(heard);
      }
    }
  }
  return null;
}
