import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoginMark } from "../lib/login.ts";
import { isLocalHost } from "../lib/writes.ts";
import { GuestQueue, LIMITS, lumeGuest, read, realClock, type Clock, type Guest, type Waited } from "../lib/voiceover.ts";
import { decodePage, guardLines, planSteps, playedOf, testPage, type Played } from "../lib/voiceover-page.ts";
import { UsageError, type Options, type Outcome } from "./commands.ts";
import type { Images, StateRecord } from "./observations.ts";
import { guardedDownload, testValuesForRun, type Blocked, type Guard } from "./safety.ts";
import type { Env } from "./surface.ts";

const DEFAULT_STEPS = 15;
const MAX_STEPS = 60;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_MS = 30_000;
const DEFAULT_WIDTH = 1280;

/** The time limit of the command: the longest wait for the virtual Mac, the reading itself, and the fetch and copy around it. */
export const VOICEOVER_COMMAND_MS = (LIMITS.queueSeconds + LIMITS.readSeconds + 120) * 1000;

/** What an agent hears when there is no VoiceOver to read with: the rest works as it did. */
export const UNAVAILABLE_NL = "VoiceOver is niet beschikbaar: de virtuele Mac draait niet. Werk verder zoals zonder VoiceOver: wat de nagebootste schermlezer (speak) niet kan vaststellen, blijft een open punt. Dit commando kostte niets";

/** Said with every answer: whose reading this is, and what it does not say. */
export const VOICEOVER_SESSION_NOTE = "dit is wat VoiceOver met Safari zei; NVDA en JAWS kunnen het anders doen. Noem in je oordeel dat het VoiceOver met Safari was";

/** One virtual Mac per machine: the readings of every session of this process wait in one queue. */
let shared: GuestQueue | null = null;
const queue = (): GuestQueue => (shared ??= new GuestQueue());

/** For tests: a guest, a queue and a clock of their own in place of the virtual Mac, for every session of the process. */
export const VOICEOVER_FOR_TESTS: { guest: Guest | null; queue: GuestQueue | null; clock: Clock | null } = { guest: null, queue: null, clock: null };

export interface VoiceOverRequest {
  env: Env;
  /** The state the session is in now, or null when no page is open. */
  current: StateRecord | null;
  args: string[];
  options: Options;
  images: Images;
  /** Refusals of the one fetch of the page go with the record of the command. */
  blocked: Blocked[];
  /** The address of a page label or a relative address. */
  resolveUrl: (address: string) => Promise<string>;
  /** A saved state by its name. */
  loadRecipe: (name: string) => Promise<StateRecord>;
  guest?: Guest;
  queue?: GuestQueue;
  clock?: Clock;
}

/**
 * `voiceover`: let VoiceOver with Safari in the virtual Mac read the page in a state.
 *
 * The page is fetched once with GET under the rules of the session. A test page made from it
 * plays the steps of the state in Safari, with the site's own scripts, and keeps everything
 * from being sent. Then VoiceOver walks it from the top, and with --press presses a control and
 * keeps what it says by itself. Readings of every agent go through the one virtual Mac one
 * after another; the answer says how long this one waited.
 */
export async function voiceoverOutcome(request: VoiceOverRequest): Promise<Outcome> {
  const { env, options } = request;
  const steps = Number(options.steps ?? DEFAULT_STEPS);
  if (!Number.isInteger(steps) || steps < 1) throw new UsageError("--steps moet een heel getal van 1 of meer zijn");
  if (options.press !== undefined && (typeof options.press !== "string" || options.press.trim() === "")) throw new UsageError('--press verwacht de naam met de rol erbij, zoals --press "Verstuur button"');
  if (runLoginMark()) throw new UsageError("VoiceOver werkt niet achter een inlog: de virtuele Mac heeft de sessie van het testaccount niet. Dit commando kostte niets");

  // Which state: a saved one, a page with nothing done on it, or where the session is now.
  const state: StateRecord & { name: string | null } =
    typeof options.state === "string"
      ? { ...(await request.loadRecipe(options.state)), name: options.state }
      : request.args[0]
        ? { id: "", start: { url: await request.resolveUrl(request.args[0]), width: DEFAULT_WIDTH, height: 800, scheme: "light" }, steps: [], name: null }
        : request.current?.start
          ? { ...request.current, name: null }
          : (() => {
              throw new UsageError("er is geen pagina geopend: open eerst een pagina of toestand, of geef een paginalabel of --state <naam>");
            })();
  const start = state.start!;
  const { planned, unplayable } = planSteps(state.steps, testValuesForRun(env.runDir));
  if (unplayable.length > 0) throw new UsageError(`deze toestand is in Safari niet na te spelen: ${unplayable.map((entry) => `stap ${entry.step} (${entry.command}) ${entry.reason}`).join("; ")}. Open een toestand zonder zo'n stap, of lees zonder handelingen vooraf. Dit commando kostte niets`);

  const own = request.guest ?? VOICEOVER_FOR_TESTS.guest;
  // The scripts of the page come from the site itself; a site on this machine is another machine for the virtual Mac.
  if (!own && isLocalHost(new URL(start.url).hostname)) throw new UsageError("deze site draait op deze machine; de virtuele Mac kan haar niet bereiken. Dit commando kostte niets");
  const guest = own ?? lumeGuest();
  if ((await guest.state()) !== "running") throw new UsageError(UNAVAILABLE_NL);

  // The page itself, once, with GET, inside the scope; every hop of a redirect is asked again.
  const guard: Guard = { blocked: [], outsideScopeLoaded: {} };
  const scratch = await mkdtemp(join(tmpdir(), "loep-voiceover-"));
  let html: string;
  let fetched: string;
  let sha256: string;
  try {
    await env.politeness.before(start.url);
    const downloaded = await guardedDownload(env.scope, guard, start.url, join(scratch, "page.html"), { resourceType: "document", maxBytes: MAX_PAGE_BYTES, timeoutMs: FETCH_MS, blockade: env.blockade });
    request.blocked.push(...guard.blocked);
    if (!downloaded.ok) throw new Error(`de pagina kon niet worden opgehaald: ${downloaded.reason}`);
    if (downloaded.truncated) throw new Error("de pagina is groter dan 5 MB of kwam niet op tijd binnen");
    if (downloaded.contentType && !/html/i.test(downloaded.contentType)) throw new UsageError(`dit adres geeft geen HTML maar ${downloaded.contentType}: VoiceOver leest hier alleen webpagina's`);
    const bytes = await readFile(join(scratch, "page.html"));
    sha256 = createHash("sha256").update(bytes).digest("hex");
    html = decodePage(bytes, downloaded.contentType);
    fetched = downloaded.url;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const noPopup = options["no-popup"] === true;
  const noMailto = options["no-mailto"] === true;
  const page = testPage({ html, url: fetched, steps: planned, hosts: env.scope.hosts, strict: env.scope.strict, noPopup, noMailto });
  // The test page is kept with the observation: what Safari got is part of the evidence.
  const file = request.images.file("-proefpagina.html");
  await writeFile(file, page);

  const press = typeof options.press === "string" ? options.press.trim() : undefined;
  const { value: reading, waited } = await (request.queue ?? VOICEOVER_FOR_TESTS.queue ?? queue()).turn(() => read(guest, { url: file, steps: Math.min(MAX_STEPS, steps), ...(press ? { press } : {}), played: true }, request.clock ?? VOICEOVER_FOR_TESTS.clock ?? realClock));
  const before = playedOf(reading.marks?.start);
  const after = playedOf(reading.marks?.end) ?? before;
  const reached = before !== null && before.done && before.steps.length === planned.length && before.steps.every((step) => step.ok);
  const changed = [...(noPopup ? ["window.open en links met target=_blank zijn vervangen: een nieuw venster opent niet"] : []), ...(noMailto ? ["een mailto-adres opent het e-mailprogramma niet"] : [])];
  const differs = [...(start.width !== DEFAULT_WIDTH ? [`de toestand is vastgelegd op ${start.width} pixels breed; Safari las in zijn eigen venster`] : []), ...(start.scheme === "dark" ? ["de toestand is vastgelegd in het donkere kleurenschema; Safari las in het lichte"] : [])];
  const testPageRecord = {
    source: fetched,
    sourceSha256: sha256,
    file: request.images.relative(file),
    state: { name: state.name, id: state.id, start, steps: state.steps.length },
    plan: planned.map((step) => ({ command: step.command, how: step.how, ...(step.note ? { note: step.note } : {}) })),
    played: before,
    heldBack: after?.guard ?? [],
    reached,
    changed,
    differs,
    sent: "niets: alleen GET en HEAD binnen de scope, en geen formulier, beacon of bericht over een websocket",
  };
  return { result: { ...reading.result, testPage: testPageRecord, waited }, print: printOf(reading.print, waited, state.name, planned.length, before, after, reached, changed, differs) };
}

function printOf(reading: Record<string, unknown>, waited: Waited, name: string | null, planned: number, before: Played | null, after: Played | null, reached: boolean, changed: string[], differs: string[]): Record<string, unknown> {
  const failed = before?.steps.find((step) => !step.ok);
  const held = guardLines(after);
  return {
    state: `${name ? `toestand ${name}` : "de toestand van je sessie"}: ${planned === 0 ? "de pagina zonder handelingen vooraf" : before === null ? `${planned} stappen; of Safari ze speelde, kwam niet terug` : `${before.steps.filter((step) => step.ok).length} van ${planned} stappen in Safari gespeeld`}`,
    ...(planned > 0 && !reached ? { notReached: failed ? `stap ${failed.i} (${failed.c}): ${failed.note ?? "mislukt"}. VoiceOver las de pagina in een andere toestand dan gevraagd: gebruik dit niet als bewijs voor die toestand` : "niet zeker dat de toestand in Safari is bereikt: gebruik dit niet als bewijs voor die toestand" } : {}),
    ...reading,
    ...(held.length > 0 ? { heldBack: held } : {}),
    ...(changed.length > 0 ? { changed } : {}),
    ...(differs.length > 0 ? { differs } : {}),
    waited: waited.seconds === 0 ? "niet gewacht op de virtuele Mac" : `${waited.seconds} s gewacht op de virtuele Mac (${waited.ahead} ${waited.ahead === 1 ? "voorlezing" : "voorlezingen"} ging${waited.ahead === 1 ? "" : "en"} voor)`,
    note: VOICEOVER_SESSION_NOTE,
  };
}
