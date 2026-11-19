import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { measuredBy, type Measured, type MethodResult } from "../instruments/methods.ts";
import type { SpokenBy } from "../instruments/methods/speech.ts";

/**
 * VoiceOver as a second source next to `speak`: a real screen reader in a virtual Mac that
 * lume runs, driven inside that Mac with AppleScript and keys, and from here over ssh. Optional: nothing
 * else in the toolbox needs it, and a run without the virtual Mac works as before.
 *
 * The virtual Mac is kept warm during an evaluation. The first time speech goes to the sound
 * output after a boot, the whole guest stands still for about four minutes; `start` takes
 * that with a spoken warm-up before VoiceOver, and boots again when the warm-up fails.
 */

const run = promisify(execFile);

/** What the guest is, as far as a command needs to know. */
export type GuestState = "running" | "stopped" | "absent" | "no-lume";

/** The virtual Mac as the commands use it; a test puts a guest of its own in its place. */
export interface Guest {
  state(): Promise<GuestState>;
  /** Start the virtual Mac without a window and return at once; it keeps running after this process ends. */
  boot(): Promise<void>;
  /** Run a shell command in the guest under a time limit. What it printed, or null when the guest gave no answer. */
  exec(command: string, seconds: number): Promise<string | null>;
  /** Pull the plug: only when a clean shutdown in the guest did not work. */
  halt(): Promise<void>;
  /** Whether this process can reach the guest at all, asked when the guest gives no answer over ssh. A guest without it is not asked. */
  reach?(): Promise<Reach>;
}

/** What a connection from this process to the ssh port of the guest gives, and what lume says of the guest at that moment. */
export interface Reach {
  state: GuestState;
  /** The address `lume get` gives; null when it gives none. */
  address: string | null;
  /** "open" when the connection was made, "timeout", or the code of the error, such as EHOSTUNREACH or ECONNREFUSED. Null without an address. */
  port22: string | null;
}

/**
 * The host keeps this process from the guest: lume says the guest runs, and a connection to it
 * ends at once with "No route to host". macOS does that to a process without access to the
 * local network; the same guest answers a process that has it (#657).
 */
export const hostRefuses = (reach: Reach | undefined): reach is Reach => reach?.state === "running" && reach.port22 === "EHOSTUNREACH";

/** What the commands of lume and a connection to the guest are made with; a test passes its own. */
export interface LumeTools {
  lume(args: string[], options: { timeout: number }): Promise<{ stdout: string }>;
  /** Try a TCP connection: "open", "timeout", or the code of the error. */
  connect(address: string, port: number, seconds: number): Promise<string>;
}

export function connectTo(address: string, port: number, seconds: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: address, port });
    const done = (result: string): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(seconds * 1000, () => done("timeout"));
    socket.once("connect", () => done("open"));
    socket.once("error", (error) => done((error as NodeJS.ErrnoException).code ?? "error"));
  });
}

const LUME_TOOLS: LumeTools = { lume: (args, options) => run("lume", args, options), connect: connectTo };

export const VM_NAME = (): string => process.env.LOEP_VOICEOVER_VM ?? "loep-voiceover";
export const GUEST_DIR = "loep-voiceover";
const GUEST_FILES = fileURLToPath(new URL("../../voiceover/guest/", import.meta.url));
/** The files `start` copies into the guest every time, so the guest runs the code of this version of the toolbox. */
export const COPIED_FILES = ["reader.js", "focus-web.applescript"];
const guestFile = (name: string): Buffer => readFileSync(join(GUEST_FILES, name));
const BEGIN = "@@LOEP-BEGIN@@";
const END = "@@LOEP-END@@";

/** The text between the two marks. `lume ssh` drops the first lines of what a command prints now and then, so every answer is framed. */
export function framed(output: string): string | null {
  const start = output.lastIndexOf(BEGIN);
  const end = output.lastIndexOf(END);
  return start === -1 || end < start ? null : output.slice(start + BEGIN.length, end).replace(/^\n/, "").replace(/\n$/, "");
}

/** The virtual Mac through the lume command. */
export function lumeGuest(name = VM_NAME(), tools: LumeTools = LUME_TOOLS): Guest {
  /** What `lume get` says: the state, and the address of a guest that has one. */
  const get = async (): Promise<{ state: GuestState; address: string | null }> => {
    try {
      const { stdout } = await tools.lume(["get", name, "--format", "json"], { timeout: 20_000 });
      const found = (JSON.parse(stdout) as { status?: string; ipAddress?: string | null }[])[0];
      return { state: found?.status === "running" ? "running" : "stopped", address: found?.ipAddress || null };
    } catch (error) {
      return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "no-lume" : "absent", address: null };
    }
  };
  return {
    async state() {
      return (await get()).state;
    },
    async reach() {
      const { state, address } = await get();
      return { state, address, port22: address ? await tools.connect(address, 22, 5) : null };
    },
    async boot() {
      const logs = stateDir();
      mkdirSync(logs, { recursive: true });
      const log = openSync(join(logs, `${name}.log`), "a");
      // Detached and with its own output: lume run stays in the foreground for as long as the virtual Mac runs.
      spawn("lume", ["run", name, "--no-display"], { detached: true, stdio: ["ignore", log, log] }).unref();
    },
    async exec(command, seconds) {
      // The output goes through a file in the guest and comes back between two marks; a hard limit on our side as well.
      const wrapped = `( ${command} ) > /tmp/loep-voiceover-out.txt 2>&1; echo; echo; echo '${BEGIN}'; cat /tmp/loep-voiceover-out.txt; echo '${END}'`;
      try {
        const { stdout } = await run("lume", ["ssh", name, "-t", String(seconds), wrapped], { timeout: (seconds + 10) * 1000, maxBuffer: 16 * 1024 * 1024 });
        return framed(stdout);
      } catch (error) {
        // A command in the guest that ends with an error still printed its answer.
        return framed(String((error as { stdout?: string }).stdout ?? ""));
      }
    },
    async halt() {
      await run("lume", ["stop", name], { timeout: 60_000 }).catch(() => undefined);
    },
  };
}

/** The clock of a command; a test passes one that does not wait. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export interface Versions {
  macos: string;
  build: string;
  safari: string;
  node: string;
  language: string;
}

/** What reader.js in the guest answers. */
export interface GuestAnswer {
  ok: boolean;
  error?: string;
  notes?: string[];
  versions?: Versions;
  /** warmup: how long each spoken sentence took; the one that took minutes is where the guest stood still. */
  says?: { seconds: number; said: boolean; pauseSeconds?: number }[];
  startAttempts?: number;
  /** Which preferences VoiceOver ran with, in Dutch. */
  preferences?: string;
  /** read */
  url?: string;
  title?: string;
  spoken?: string[];
  ended?: boolean;
  way?: string[];
  press?: { asked: string; step: number | null; control?: string; spokenByItself?: string[] };
  /** For a test page: the address of the page in Safari before VoiceOver started and at the end; the page writes what it played into it. */
  marks?: { start: string | null; end: string | null };
}

/** `queueSeconds`: how long a reading waits for the virtual Mac before it gives up; `staleLockSeconds`: when a lock of another process counts as left behind. */
export const LIMITS = { boots: 3, desktopSeconds: 240, calmSeconds: 600, calmLoad: 3, warmupSeconds: 900, readSeconds: 300, shutdownSeconds: 180, pollSeconds: 4, queueSeconds: 600, staleLockSeconds: 420 };

const quoted = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** Wait until `check` gives something, asking every few seconds; null when the time is up. */
async function until<T>(clock: Clock, seconds: number, everySeconds: number, check: () => Promise<T | null>): Promise<T | null> {
  const deadline = clock.now() + seconds * 1000;
  for (;;) {
    const found = await check();
    if (found !== null) return found;
    if (clock.now() >= deadline) return null;
    await clock.sleep(everySeconds * 1000);
  }
}

/** Put a small file in the directory of loep in the guest. It travels inside the command: `lume ssh` passes no input on. */
export async function putFile(guest: Guest, path: string, content: Buffer): Promise<boolean> {
  const target = `"$HOME/${GUEST_DIR}/${path}"`;
  return (await guest.exec(`mkdir -p "$(dirname ${target})" && echo ${content.toString("base64")} | base64 -D > ${target} && echo copied`, 30))?.trim() === "copied";
}

/**
 * Run reader.js in the guest, loose from the ssh connection, and wait for its answer file.
 * The guest can stand still for minutes while it works; then the questions go unanswered and
 * the job goes on.
 */
export async function job(guest: Guest, clock: Clock, args: string[], seconds: number): Promise<GuestAnswer> {
  const out = `/tmp/loep-voiceover-${clock.now()}.json`;
  const started = await guest.exec(`cd "$HOME/${GUEST_DIR}" && rm -f ${out} && (nohup ./node/bin/node reader.js ${[args[0]!, out, ...args.slice(1)].map(quoted).join(" ")} >/dev/null 2>&1 &) ; echo started`, 30);
  if (started?.trim() !== "started") return { ok: false, error: "de virtuele Mac nam het commando niet aan" };
  const answer = await until(clock, seconds, LIMITS.pollSeconds, async () => {
    const text = await guest.exec(`cat ${out} 2>/dev/null`, 8);
    if (!text) return null;
    try {
      return JSON.parse(text) as GuestAnswer;
    } catch {
      return null;
    }
  });
  if (answer) return answer;
  await guest.exec("pkill -f reader.js; killall VoiceOver; true", 20);
  return { ok: false, error: `geen antwoord van de virtuele Mac binnen ${seconds} seconden` };
}

/** Shut the guest down from the inside; pull the plug only when that does not work. Returns how it ended. */
export async function shutdown(guest: Guest, clock: Clock = realClock): Promise<"clean" | "forced" | "was-stopped"> {
  if ((await guest.state()) !== "running") return "was-stopped";
  // VoiceOver off first, and not to be started by macOS at the next login.
  await guest.exec("pkill -f reader.js; killall VoiceOver; defaults write com.apple.universalaccess voiceOverOnOffKey -bool false; sudo shutdown -h now", 20);
  const stopped = await until(clock, LIMITS.shutdownSeconds, 3, async () => ((await guest.state()) === "running" ? null : true));
  if (stopped) return "clean";
  await guest.halt();
  return "forced";
}

export interface Started {
  ok: boolean;
  /** How many times the virtual Mac was booted. */
  boots: number;
  seconds: number;
  versions?: Versions;
  /** Per boot what happened, in Dutch. */
  attempts: string[];
  error?: string;
}

/** The first number of `{ sec = 1794713662, usec = 745489 } Sat Nov 14 ...`: the seconds, not the microseconds. */
export const FIRST_NUMBER = `sed 's/^[^0-9]*\\([0-9]*\\).*/\\1/'`;
/** The second the guest booted: for saying since when it runs. It moves when the clock of the guest is set, so it does not tell one boot from another. */
const BOOT_SECONDS = `sysctl -n kern.boottime | ${FIRST_NUMBER}`;
/**
 * What tells this boot from every other: the id macOS gives a boot, which stays the same until the
 * next one. The warm-up in reader.js writes the same to a file. The boot second was used before,
 * and a guest whose clock was set after the warm-up then counted as not warmed up (#596); it is
 * the fallback where the id is not there.
 */
const BOOT_ID = `(sysctl -n kern.bootsessionuuid 2>/dev/null || ${BOOT_SECONDS})`;
/** Where the warm-up leaves the id of the boot it warmed up. */
const WARM_MARK = `"$HOME/.loep-voiceover-warm-boot"`;

/** Whether the guest was warmed up since it booted: then VoiceOver can start at once. */
async function isWarm(guest: Guest): Promise<boolean> {
  return (await guest.exec(`[ "$(cat ${WARM_MARK} 2>/dev/null)" = "$(${BOOT_ID})" ] && echo warm`, 15))?.trim() === "warm";
}

/** Where `start` leaves word of itself on this machine: a start that runs, and how the last one ended. */
export const stateDir = (): string => join(homedir(), ".cache", "loep", "voiceover");
const startingFile = (dir: string, name: string): string => join(dir, `${name}.starting.json`);
const lastStartFile = (dir: string, name: string): string => join(dir, `${name}.last-start.json`);

export interface StartRecord {
  ok: boolean;
  at: string;
  error?: string;
}

/** Around a `start`: while it runs a file with its process, after it how it ended. A start in the background that fails is then still seen. */
export async function recordedStart(run: () => Promise<Started>, name = VM_NAME(), dir = stateDir(), now: () => Date = () => new Date()): Promise<Started> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(startingFile(dir, name), `${JSON.stringify({ pid: process.pid, since: now().toISOString() })}\n`);
  let started: Started = { ok: false, boots: 0, seconds: 0, attempts: [], error: "de start brak af" };
  try {
    started = await run();
    return started;
  } catch (error) {
    started = { ...started, error: `de start brak af: ${(error as Error).message}` };
    throw error;
  } finally {
    const record: StartRecord = { ok: started.ok, at: now().toISOString(), ...(started.error ? { error: started.error } : {}) };
    writeFileSync(lastStartFile(dir, name), `${JSON.stringify(record)}\n`);
    rmSync(startingFile(dir, name), { force: true });
  }
}

/** What `voiceover status` knows: what lume says, and for a running guest whether it was warmed up since it booted. */
export interface VoiceoverStatus {
  state: GuestState;
  /** Only for a running guest that answered: warmed up since it booted. */
  warm?: boolean;
  /** Only for a running guest that answered. */
  bootedAt?: string;
  /** Only for a running guest that is not warm: why. No mark of a warm-up, or a mark of another boot. Kept so the cause can be found afterwards. */
  notWarm?: "noMark" | "otherBoot";
  /** Only for a running guest that gave no answer, and that the host keeps this process from. */
  refused?: Reach;
  /** A `start` that still runs. */
  starting?: { pid: number; since: string };
  lastStart?: StartRecord;
}

export const readRecord = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

export async function voiceoverStatus(guest: Guest = lumeGuest(), name = VM_NAME(), dir = stateDir()): Promise<VoiceoverStatus> {
  const state = await guest.state();
  const starting = readRecord<{ pid: number; since: string }>(startingFile(dir, name));
  const lastStart = readRecord<StartRecord>(lastStartFile(dir, name));
  const status: VoiceoverStatus = { state, ...(starting && alive(starting.pid) ? { starting } : {}), ...(lastStart ? { lastStart } : {}) };
  if (state !== "running") return status;
  const answer = (await guest.exec(`echo "$(${BOOT_SECONDS}) $(${BOOT_ID}) $(cat ${WARM_MARK} 2>/dev/null)"`, 15))?.trim().split(/\s+/);
  const booted = Number(answer?.[0]);
  if (!Number.isFinite(booted) || booted <= 0) {
    // Not while a start runs: a guest that boots has no network yet, and a connection to it fails the same way.
    const reach = answer || status.starting ? undefined : await guest.reach?.();
    return hostRefuses(reach) ? { ...status, refused: reach } : status;
  }
  const [, boot, mark] = answer!;
  const warm = boot !== undefined && mark === boot;
  return { ...status, warm, bootedAt: new Date(booted * 1000).toISOString(), ...(warm ? {} : { notWarm: mark === undefined ? ("noMark" as const) : ("otherBoot" as const) }) };
}

/** A `start` that still runs on this machine, or null. */
export function runningStart(name = VM_NAME(), dir = stateDir()): { pid: number; since: string } | null {
  const starting = readRecord<{ pid: number; since: string }>(startingFile(dir, name));
  return starting && alive(starting.pid) ? starting : null;
}

/** Set up on this machine: lume is there and so is the virtual Mac. */
export const isSetUp = (status: VoiceoverStatus): boolean => status.state === "running" || status.state === "stopped";
/** VoiceOver can read aloud now. */
export const isReady = (status: VoiceoverStatus): boolean => status.state === "running" && status.warm === true;

const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
/** Why the guest is out of reach and where to look, after "niet bereikbaar: ". */
const refusedNl = (reach: Reach): string =>
  `een verbinding naar poort 22 van ${reach.address} geeft "No route to host", terwijl lume meldt dat de virtuele Mac draait. De host weigert dus het verkeer naar de virtuele Mac. Kijk onder Systeeminstellingen > Privacy en beveiliging > Lokaal netwerk of het programma waarin loep draait daar aan staat`;
/** What the port of ssh said for a guest that gave no answer, after "geen antwoord over ssh binnen ... seconden". */
const reachNl = (reach: Reach | undefined): string =>
  !reach ? "" : reach.address === null ? "; lume geeft geen adres voor de virtuele Mac" : reach.port22 === "open" ? `; poort 22 van ${reach.address} neemt wel een verbinding aan` : reach.port22 === "timeout" ? `; poort 22 van ${reach.address} neemt binnen 5 seconden geen verbinding aan` : `; een verbinding naar poort 22 van ${reach.address} geeft ${reach.port22}`;
const START_HINT = "loep voiceover start, op de achtergrond: 9 minuten, of 20 tot 30 met een herstart";

/** The state in one sentence that follows "de virtuele Mac met VoiceOver". */
export function statusNl(status: VoiceoverStatus): string {
  if (status.state === "no-lume") return "is er niet: lume staat niet op deze machine (zie docs/voiceover.md)";
  if (status.state === "absent") return "is er niet op deze machine (just voiceover-setup richt hem in)";
  if (isReady(status)) return `draait sinds ${hhmm(status.bootedAt!)} en is opgewarmd: VoiceOver leest voor`;
  if (status.starting) return `wordt gestart sinds ${hhmm(status.starting.since)} (loep voiceover start, proces ${status.starting.pid}): dat duurt 9 minuten, of 20 tot 30 met een herstart`;
  const failed = status.lastStart && !status.lastStart.ok ? `; de laatste start, om ${hhmm(status.lastStart.at)}, mislukte: ${status.lastStart.error ?? "onbekende reden"}` : "";
  if (status.state === "stopped") return `is ingericht maar draait niet${failed}. Start hem met ${START_HINT}`;
  if (status.refused) return `draait maar is vanuit dit proces niet bereikbaar: ${refusedNl(status.refused)}`;
  if (!status.bootedAt) return `draait maar geeft geen antwoord: hij start nog op of hangt${failed}. Draai ${START_HINT}; die start hem zo nodig opnieuw`;
  const why = status.notWarm === "otherBoot" ? " (het merkteken van de opwarming is van een eerdere start)" : status.notWarm === "noMark" ? " (er is geen merkteken van een opwarming)" : "";
  return `draait sinds ${hhmm(status.bootedAt)} maar is niet opgewarmd${why}, dus VoiceOver leest niet voor${failed}. Draai ${START_HINT}; die warmt hem op of start hem opnieuw`;
}

/** How long after a start that failed no new one is tried by itself: a guest that cannot warm up is not booted again at every look. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/**
 * Whether a look at the state should warm the guest up by itself: it runs and answers, was not
 * warmed up, no start runs, and none failed just now. That is the cheap case, about a minute
 * without a boot. A guest that is stopped is for whoever leads the run: that takes 9 to 30 minutes.
 */
export function warmUpDue(status: VoiceoverStatus, now: Date = new Date()): boolean {
  if (status.state !== "running" || !status.bootedAt || status.warm !== false || status.starting) return false;
  return !(status.lastStart && !status.lastStart.ok && now.getTime() - new Date(status.lastStart.at).getTime() < RETRY_AFTER_MS);
}

/** Leave word that a start runs, for a start that was just set off in another process: a second look does not set off a second one. */
export function markStarting(pid: number, name = VM_NAME(), dir = stateDir(), now: Date = new Date()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(startingFile(dir, name), `${JSON.stringify({ pid, since: now.toISOString() })}\n`);
}

/** For whoever leads a phase with agents: a warning when the virtual Mac is set up but VoiceOver cannot read; null otherwise. */
export function voiceoverWarningNl(status: VoiceoverStatus, warming = false): string | null {
  if (!isSetUp(status) || isReady(status)) return null;
  // Set off by the look itself: said, so whoever leads knows the first agents may still work without.
  if (warming) return `LET OP: de virtuele Mac met VoiceOver ${statusNl(status).split(". Draai ")[0]}. loep warmt hem nu op de achtergrond op, meestal in een minuut; tot dan lezen agents niet voor met VoiceOver`;
  return `LET OP: de virtuele Mac met VoiceOver ${statusNl(status)}. Zonder hem lezen beoordelaars, verifieerders en de afmaakronde niet voor met VoiceOver; het onderzoek gaat verder zoals zonder`;
}

/**
 * Wait for the desktop of the guest, and tell three ends apart: the Dock runs, the guest answers
 * but the Dock does not run, and the guest gives no answer over ssh at all. For the last one the
 * port of ssh is tried. A guest that ran already has its network, so the host keeping this process
 * from it is seen at once, and the wait ends there. A guest booted here has no network at first,
 * and a connection to the address of its last boot then fails the same way: it gets the whole wait
 * a boot may take before that is concluded.
 */
async function awaitDesktop(guest: Guest, clock: Clock, bootedHere: boolean): Promise<{ found: "desktop" | "no-dock" | "no-answer" | "refused"; reach?: Reach }> {
  const deadline = clock.now() + LIMITS.desktopSeconds * 1000;
  let answered = false;
  for (let first = true; ; first = false) {
    const answer = await guest.exec("pgrep -x Dock >/dev/null && echo desktop", 10);
    if (answer?.trim() === "desktop") return { found: "desktop" };
    if (answer !== null) answered = true;
    const late = clock.now() >= deadline;
    if (answered && late) return { found: "no-dock" };
    if (!answered && (late || (first && !bootedHere))) {
      const reach = await guest.reach?.();
      if (hostRefuses(reach)) return { found: "refused", reach };
      if (late) return { found: "no-answer", ...(reach ? { reach } : {}) };
    }
    await clock.sleep(3000);
  }
}

/**
 * Boot the virtual Mac and warm it up, at most three boots. Each boot: wait for the desktop,
 * wait until the guest is calm, copy the files, speak three sentences, start and stop
 * VoiceOver once. A boot whose warm-up fails is shut down and done again.
 */
export async function start(guest: Guest, progress: (line: string) => void, clock: Clock = realClock, files: (name: string) => Buffer = guestFile): Promise<Started> {
  const began = clock.now();
  const elapsed = (): number => Math.round((clock.now() - began) / 1000);
  const say = (line: string): void => progress(`[${String(elapsed()).padStart(4)} s] ${line}`);
  const attempts: string[] = [];
  const state = await guest.state();
  if (state === "no-lume") return { ok: false, boots: 0, seconds: 0, attempts, error: "lume staat niet op deze machine: zie docs/voiceover.md en draai just voiceover-setup" };
  if (state === "absent") return { ok: false, boots: 0, seconds: 0, attempts, error: `de virtuele Mac ${VM_NAME()} bestaat niet: draai just voiceover-setup` };
  if (state === "running" && (await isWarm(guest))) {
    say("de virtuele Mac draait al en is opgewarmd");
    const versions = (await job(guest, clock, ["versions"], 60)).versions;
    return { ok: true, boots: 0, seconds: elapsed(), attempts: ["draaide al en was opgewarmd"], ...(versions ? { versions } : {}) };
  }
  let running = state === "running";
  for (let boot = 1; boot <= LIMITS.boots; boot++) {
    const fail = async (reason: string): Promise<void> => {
      attempts.push(`start ${boot}: ${reason}`);
      say(`${reason}; de virtuele Mac wordt afgesloten${boot < LIMITS.boots ? " en opnieuw gestart" : ""}`);
      const how = await shutdown(guest, clock);
      if (how === "forced") say("afsluiten in de gast lukte niet: de virtuele Mac is hard gestopt");
      running = false;
    };
    const bootedHere = !running;
    if (!running) {
      say(`start ${boot} van hooguit ${LIMITS.boots}: de virtuele Mac start`);
      await guest.boot();
      running = true;
    } else say("de virtuele Mac draait al maar is niet opgewarmd");
    const desktop = await awaitDesktop(guest, clock, bootedHere);
    if (desktop.found === "refused") {
      // Not a matter of this boot: the guest is left as it is, and no other boot is tried.
      const error = `de virtuele Mac is vanuit dit proces niet bereikbaar: ${refusedNl(desktop.reach!)}. De virtuele Mac draait nog, want opnieuw starten lost dit niet op. Staat het programma daar al aan, sluit hem dan af met loep voiceover stop en start opnieuw`;
      attempts.push(`start ${boot}: de host weigert het verkeer naar de virtuele Mac`);
      say(error);
      return { ok: false, boots: boot, seconds: elapsed(), attempts, error };
    }
    if (desktop.found === "no-answer") {
      await fail(`geen antwoord over ssh binnen ${LIMITS.desktopSeconds} seconden${reachNl(desktop.reach)}`);
      continue;
    }
    if (desktop.found === "no-dock") {
      await fail(`geen bureaublad binnen ${LIMITS.desktopSeconds} seconden (logt de virtuele Mac automatisch in?)`);
      continue;
    }
    say("ingelogd; wachten tot de virtuele Mac rustig is (load onder de 3, meestal 4 minuten)");
    const calm = await until(clock, LIMITS.calmSeconds, 8, async () => {
      const load = Number((await guest.exec("sysctl -n vm.loadavg", 8))?.split(/\s+/)[1]);
      return Number.isFinite(load) && load < LIMITS.calmLoad ? true : null;
    });
    if (!calm) say(`na ${LIMITS.calmSeconds} seconden nog niet rustig; toch verder`);
    let copied = true;
    for (const name of COPIED_FILES) copied = (await putFile(guest, name, files(name))) && copied;
    const installed = copied && (await guest.exec(`[ -x "$HOME/${GUEST_DIR}/node/bin/node" ] && echo installed`, 15))?.trim() === "installed";
    if (!installed) {
      await shutdown(guest, clock);
      return { ok: false, boots: boot, seconds: elapsed(), attempts, error: copied ? "node staat niet in de virtuele Mac: draai just voiceover-setup" : "de bestanden konden niet naar de virtuele Mac worden gekopieerd" };
    }
    say("gesproken opwarming: drie zinnen met say, daarna VoiceOver één keer aan en uit (kan 5 minuten duren: de virtuele Mac staat bij de eerste spraak ruim 4 minuten stil)");
    const warm = await job(guest, clock, ["warmup"], LIMITS.warmupSeconds);
    const stalls = (warm.says ?? []).map((entry, index) => (entry.seconds >= 60 ? `zin ${index + 1} duurde ${entry.seconds} s` : null)).filter((line): line is string => line !== null);
    if (warm.ok) {
      attempts.push(`start ${boot}: opgewarmd${stalls.length > 0 ? ` (${stalls.join(", ")})` : ""}, VoiceOver startte bij poging ${warm.startAttempts ?? "?"}`);
      say(`opgewarmd${stalls.length > 0 ? `: ${stalls.join(", ")}` : ""}; VoiceOver startte bij poging ${warm.startAttempts ?? "?"}`);
      return { ok: true, boots: boot, seconds: elapsed(), attempts, ...(warm.versions ? { versions: warm.versions } : {}) };
    }
    // Why it failed, as far as the guest could tell: how long each sentence took and what every start of VoiceOver said.
    const told = [...(warm.says ?? []).map((entry, index) => `zin ${index + 1}: ${entry.seconds} s`), ...(warm.notes ?? [])];
    await fail(`opwarmen mislukt: ${warm.error ?? "onbekende reden"}${told.length > 0 ? ` (${told.join("; ")})` : ""}`);
  }
  return { ok: false, boots: LIMITS.boots, seconds: elapsed(), attempts, error: `de virtuele Mac kwam in ${LIMITS.boots} starts niet tot een werkende VoiceOver` };
}

export const VOICEOVER = "voiceover";
/** What silence after a press covers. The press is the keys VO-Space, and VoiceOver is asked what it said for six seconds. */
export const SILENT_NOTE = "VoiceOver zei 6 seconden lang na VO-spatie niets uit zichzelf, met de voorkeuren waarmee het wordt geleverd. De aanwijzing die VoiceOver bij een onderdeel geeft (\"You are currently on ...\") telt niet mee; een bericht dat later komt is niet gehoord";
export const VOICEOVER_NOTE = "echte schermlezer (VoiceOver) in een virtuele Mac met Safari, met de voorkeuren waarmee VoiceOver wordt geleverd; rollen en toestanden worden in het Engels uitgesproken, ook op een Nederlandse pagina. NVDA en JAWS zeggen het anders";
const PRINCIPLE = "een echte schermlezer: VoiceOver in Safari in een virtuele Mac, bediend met zijn eigen commando's en toetsen (AppleScript); de zin is wat VoiceOver zelf als laatst uitgesproken opgeeft";

/** What VoiceOver gives for a walk: the shape of the answer of `speak`, with what only a real reader has. */
export interface VoiceOverAnswer extends SpokenBy {
  /** The language VoiceOver speaks roles and states in. */
  language: string;
  /** Whether VoiceOver came to the end of the page before the steps were used up. */
  ended: boolean;
  /** With --press: the step where the control was, and what VoiceOver said by itself after the press. */
  pressed?: { step: number | null; asked: string; control?: string; spokenByItself?: string[] };
}

export interface Reading {
  result: Measured<VoiceOverAnswer> & { probe: "walk" | "after-action"; url: string; title: string; source: Versions & { reader: "VoiceOver"; virtualMachine: string; preferences: string } };
  print: Record<string, unknown>;
  /** For a test page: what its address said before VoiceOver started and at the end. */
  marks?: { start: string | null; end: string | null };
}

export const versionLine = (versions: Versions): string => `macOS ${versions.macos} (${versions.build}), Safari ${versions.safari}, node ${versions.node}`;
const short = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** The answer of the guest in the shape `speak` gives: every reader side by side in `methods`, and a short print. */
export function readingOf(answer: GuestAnswer, ms: number): Reading {
  if (!answer.ok || !answer.spoken || !answer.versions) throw new Error(`VoiceOver gaf geen antwoord: ${answer.error ?? "onbekende reden"}`);
  const { versions } = answer;
  const pressed = answer.press ? { step: answer.press.step, asked: answer.press.asked, ...(answer.press.control !== undefined ? { control: answer.press.control } : {}), ...(answer.press.spokenByItself ? { spokenByItself: answer.press.spokenByItself } : {}) } : undefined;
  const method: MethodResult<VoiceOverAnswer> = {
    method: "screen-reader",
    implementation: VOICEOVER,
    version: versionLine(versions),
    principle: PRINCIPLE,
    ms,
    result: { spoken: answer.spoken, simulated: false, language: versions.language.startsWith("en") ? "en" : versions.language, ended: answer.ended === true, ...(pressed ? { pressed } : {}) },
  };
  const after = pressed?.spokenByItself ?? [];
  return {
    ...(answer.marks ? { marks: answer.marks } : {}),
    result: { ...measuredBy([method]), probe: pressed ? "after-action" : "walk", url: (answer.url ?? "").split("#loep-played=")[0]!, title: answer.title ?? "", source: { reader: "VoiceOver", virtualMachine: VM_NAME(), preferences: answer.preferences ?? "onbekend", ...versions } },
    print: {
      steps: answer.spoken.map((phrase, index) => `${index + 1} ${phrase === "" ? "(niets uitgesproken)" : short(phrase, 160)}`),
      ...(answer.ended ? { ended: "VoiceOver was aan het eind van de pagina voordat de stappen op waren" } : {}),
      ...(pressed ? (pressed.step === null ? { pressed: `geen onderdeel met "${pressed.asked}" in de naam gevonden binnen de stappen` } : { pressed: `stap ${pressed.step}: ${short(pressed.control ?? "", 120)}`, ...(after.length > 0 ? { spoken: after.map((phrase) => short(phrase, 200)) } : { silent: "er werd niets uit zichzelf uitgesproken", silentNote: SILENT_NOTE }) }) : {}),
      reader: `VoiceOver, ${versionLine(versions)}`,
      readerNote: VOICEOVER_NOTE,
    },
  };
}

export interface ReadOptions {
  /** An address the guest can reach, or a file on this machine: that is copied into the guest and opened there. */
  url: string;
  steps: number;
  /** Part of the name of a control: when a step comes to it, VoiceOver presses it and what is said by itself is kept. */
  press?: string;
  /** A test page that plays steps: the reader waits until the page says it is done before VoiceOver starts, and reads its address again at the end. */
  played?: boolean;
}

/** Where the guest finds the page: the address itself, or the copy of a local file. Throws on an address the guest cannot reach. */
export async function addressFor(guest: Guest, url: string, readLocal: (path: string) => Buffer = (path) => readFileSync(path)): Promise<string> {
  if (/^https?:\/\/(localhost|127\.|\[::1\])/i.test(url)) throw new Error("localhost van deze machine is in de virtuele Mac een andere machine: geef een bestand (een pad of file://) of een adres dat de virtuele Mac kan bereiken");
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("file://") ? fileURLToPath(url) : url;
  const name = basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!(await putFile(guest, `pages/${name}`, readLocal(path)))) throw new Error("het bestand kon niet naar de virtuele Mac worden gekopieerd");
  const home = (await guest.exec('echo "$HOME"', 10))?.trim();
  if (!home) throw new Error("de virtuele Mac gaf geen antwoord");
  return `file://${home}/${GUEST_DIR}/pages/${name}`;
}

/** Let VoiceOver in the running, warmed-up virtual Mac read a page: into the web content, and step by step what it says. */
export async function read(guest: Guest, options: ReadOptions, clock: Clock = realClock, readLocal?: (path: string) => Buffer, files: (name: string) => Buffer = guestFile): Promise<Reading> {
  const state = await guest.state();
  if (state !== "running") throw new Error(state === "stopped" ? "de virtuele Mac draait niet: draai eerst loep voiceover start" : "er is geen virtuele Mac voor VoiceOver: zie docs/voiceover.md");
  const address = await addressFor(guest, options.url, readLocal);
  // The reader of this version of the toolbox, also when the virtual Mac was started by another.
  for (const name of COPIED_FILES) if (!(await putFile(guest, name, files(name)))) throw new Error("de bestanden konden niet naar de virtuele Mac worden gekopieerd");
  const began = clock.now();
  const answer = await job(guest, clock, ["read", address, String(options.steps), ...(options.press || options.played ? [options.press ?? ""] : []), ...(options.played ? ["played"] : [])], LIMITS.readSeconds);
  return readingOf(answer, clock.now() - began);
}

/** How long a reading waited for the virtual Mac, and how many readings went before it. */
export interface Waited {
  seconds: number;
  ahead: number;
}

/** The lock that holds the one virtual Mac for one reading, also against another process of loep. */
export const lockFile = (name = VM_NAME()): string => join(stateDir(), `${name}.lock`);

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * There is one virtual Mac and VoiceOver reads one page at a time. Readings of the agents of a
 * session process go one after another, in the order they came; a lock file keeps a reading of
 * another process (a second run, or `loep voiceover read` by hand) out at the same time. Each
 * reading hears how long it waited and how many went before it.
 */
export class GuestQueue {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly file: string;
  private readonly clock: Clock;
  private readonly maxWaitSeconds: number;

  constructor(options: { file?: string; clock?: Clock; maxWaitSeconds?: number } = {}) {
    this.file = options.file ?? lockFile();
    this.clock = options.clock ?? realClock;
    this.maxWaitSeconds = options.maxWaitSeconds ?? LIMITS.queueSeconds;
  }

  /** Readings waiting or running now in this process. */
  get length(): number {
    return this.queued;
  }

  async turn<T>(work: () => Promise<T>): Promise<{ value: T; waited: Waited }> {
    const began = this.clock.now();
    let ahead = this.queued;
    this.queued += 1;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    try {
      await previous;
      if (await this.lock(began)) ahead += 1;
      try {
        const waited = { seconds: Math.round((this.clock.now() - began) / 1000), ahead };
        return { value: await work(), waited };
      } finally {
        rmSync(this.file, { force: true });
      }
    } finally {
      this.queued -= 1;
      release();
    }
  }

  /** Take the lock file; true when another process held it first. Gives up after the longest wait. */
  private async lock(began: number): Promise<boolean> {
    mkdirSync(dirname(this.file), { recursive: true });
    let other = false;
    for (;;) {
      if ((this.clock.now() - began) / 1000 > this.maxWaitSeconds) throw new Error(`de virtuele Mac was na ${Math.round(this.maxWaitSeconds / 60)} minuten nog bezet${other ? " door een ander proces" : ""}; probeer het later opnieuw`);
      try {
        const handle = openSync(this.file, "wx");
        writeSync(handle, `${process.pid} ${this.clock.now()}\n`);
        closeSync(handle);
        return other;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const [pid, since] = (() => {
        try {
          return readFileSync(this.file, "utf8").trim().split(" ").map(Number);
        } catch {
          return [Number.NaN, Number.NaN];
        }
      })();
      // A lock of a process that is gone, or older than any reading takes, was left behind.
      if (!Number.isFinite(pid) || !alive(pid!) || this.clock.now() - (since ?? 0) > LIMITS.staleLockSeconds * 1000) {
        rmSync(this.file, { force: true });
        continue;
      }
      other = true;
      await this.clock.sleep(2000);
    }
  }
}
