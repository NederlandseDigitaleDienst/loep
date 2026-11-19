import { execFile, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { enterUser, inUse, leaveUser, type InUse } from "../lib/voiceover-users.ts";
import { COPIED_FILES, GUEST_DIR, GuestQueue, isReady, lumeGuest, markStarting, putFile, read, realClock, recordedStart, shutdown, start, statusNl, VM_NAME, voiceoverStatus, type Clock, type Guest } from "../lib/voiceover.ts";
import { otherSessionProcesses, type SessionProcess } from "../session/client.ts";

const run = promisify(execFile);
const GUEST_FILES = fileURLToPath(new URL("../../voiceover/guest/", import.meta.url));

export const VOICEOVER_USAGE = `loep voiceover <command>

  start [--run <run>]                    Boot the virtual Mac and warm it up: three spoken sentences, then VoiceOver on and off
                                         once. A boot whose warm-up fails is shut down and done again, at most three boots.
                                         Progress with times on stderr; 9 minutes, 20 to 30 with a restart. Leave it running during an evaluation.
                                         Leaves word on this machine while it runs and how it ended, for status. --run enters
                                         the run as a user of the virtual Mac until stop --run, or until it writes nothing for 6 hours
  status                                 Whether VoiceOver can read aloud now: the virtual Mac runs and was warmed up since it booted.
                                         Also a start that still runs, and the last start that failed. Exit 0 when it can read, 1 when not
  read --url <address or file> [--steps <n>] [--press <name>] [--out <file>]
                                         Open the page in Safari in the virtual Mac, go into the web content, and give what
                                         VoiceOver says per step (default 15). A file on this machine is copied into the virtual
                                         Mac. With --press: when a step comes to a control with that text in its name, VoiceOver
                                         presses it, and what it says by itself afterwards is kept. Prints compact JSON in the
                                         shape of session speak; --out keeps the full answer, with every version. After a press
                                         VoiceOver is listened to for six seconds. Waits while another reading uses the virtual Mac.
                                         In an evaluation an agent reads with the session command voiceover instead
  stop [--run <run>] [--force]           Shut the virtual Mac down. Refuses while another run is entered by start --run, a start
                                         still runs, or another run on this machine still has sessions: there is one virtual Mac, and
                                         that run may still read with it. --run takes your own run out, and its sessions do not count;
                                         --force shuts down anyway
  setup                                  Check lume and the virtual Mac, and set up inside it what can be set without a person;
                                         says per step what is done and what you have to do yourself (just voiceover-setup)

Optional: nothing else in the toolbox needs it. See docs/voiceover.md
`;

const DEFAULT_STEPS = 15;
const MAX_STEPS = 60;
/** The public image the virtual Mac is made from, and what it is given of this machine. */
const IMAGE = "macos-tahoe-vanilla:latest";
const CPUS = "4";
const MEMORY = "6GB";

/** `loep voiceover start`: exit 0 when VoiceOver is ready to read. With a run, the run is entered as a user first. */
export async function voiceoverStart(flags: { run?: string | undefined } = {}, guest: Guest = lumeGuest()): Promise<number> {
  if (flags.run) enterUser(flags.run);
  const started = await recordedStart(() => start(guest, (line) => process.stderr.write(`${line}\n`)));
  process.stdout.write(`${JSON.stringify({ ok: started.ok, boots: started.boots, seconds: started.seconds, attempts: started.attempts, ...(started.versions ? { versions: started.versions } : {}), ...(started.error ? { error: started.error } : {}) })}\n`);
  return started.ok ? 0 : 1;
}

export interface ReadFlags {
  url?: string;
  steps?: string;
  press?: string;
  out?: string;
}

/** `loep voiceover read`: prints what an agent reads; --out keeps the whole answer. */
export async function voiceoverRead(flags: ReadFlags, guest: Guest = lumeGuest()): Promise<number> {
  if (!flags.url) throw new Error("voiceover read verwacht --url <adres of bestand>");
  const steps = Number(flags.steps ?? DEFAULT_STEPS);
  if (!Number.isInteger(steps) || steps < 1) throw new Error("--steps moet een heel getal van 1 of meer zijn");
  // The same lock as the readings of a session: one reading at a time on the one virtual Mac.
  const { value: reading, waited } = await new GuestQueue().turn(() => read(guest, { url: flags.url!, steps: Math.min(MAX_STEPS, steps), ...(flags.press ? { press: flags.press } : {}) }));
  if (flags.out) writeFileSync(flags.out, `${JSON.stringify({ ...reading.result, waited }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...reading.print, ...(waited.seconds > 0 ? { waited: `${waited.seconds} s gewacht op de virtuele Mac` } : {}) })}\n`);
  return 0;
}

/** Set off `loep voiceover start` as a process of its own and go on: for a look at the state that finds the guest running but not warmed up. */
export function startInBackground(run?: string): void {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../cli.ts", import.meta.url)), "voiceover", "start", ...(run ? ["--run", run] : [])], { detached: true, stdio: "ignore" });
  child.unref();
  if (child.pid) markStarting(child.pid);
}

/** `loep voiceover status`: exit 0 when VoiceOver can read aloud now. */
export async function voiceoverStatusCommand(guest: Guest = lumeGuest()): Promise<number> {
  const status = await voiceoverStatus(guest);
  process.stdout.write(`${JSON.stringify({ ready: isReady(status), ...status, text: `de virtuele Mac met VoiceOver ${statusNl(status)}` })}\n`);
  return isReady(status) ? 0 : 1;
}

export interface StopFlags {
  /** Shut down although another run is entered or still holds sessions, or a start still runs. */
  force?: boolean | undefined;
  /** The run of the caller: it is taken out as a user, and its own sessions do not keep the virtual Mac up. */
  run?: string | undefined;
}

/** Why `voiceover stop` leaves the virtual Mac up because another run holds sessions, and what to do. */
export function stopRefusedNl(others: SessionProcess[]): string {
  const known = others.filter((other) => other.run !== null);
  const runs = known.length > 0 ? ` Het gaat om ${known.map((other) => `${other.run} (${other.sessions ?? "onbekend aantal"} ${other.sessions === 1 ? "sessie" : "sessies"})`).join(" en ")}.` : "";
  return `geweigerd: de virtuele Mac blijft aan. Op deze machine ${others.length === 1 ? "heeft een ander onderzoek" : `hebben ${others.length} andere onderzoeken`} nog sessies lopen, en ${others.length === 1 ? "dat kan" : "die kunnen"} VoiceOver nog nodig hebben.${runs} Het onderzoek dat als laatste klaar is, stopt de virtuele Mac. Is het je eigen run, geef die dan mee: loep voiceover stop --run <run>. Weet je zeker dat geen onderzoek hem nog gebruikt, stop hem dan met: loep voiceover stop --force`;
}

/** Why `voiceover stop` leaves the virtual Mac up because another run is entered or a start runs, and what to do. */
export function inUseNl({ users, starting }: InUse): string {
  const runs = users.length === 0 ? "" : `${users.length === 1 ? "een ander onderzoek gebruikt" : `${users.length} andere onderzoeken gebruiken`} hem nog (${users.map((user) => user.run).join(" en ")})`;
  const start = starting ? `een start loopt nog (proces ${starting.pid})` : "";
  return `geweigerd: de virtuele Mac blijft aan, want ${[runs, start].filter(Boolean).join(" en ")}. Het onderzoek dat als laatste klaar is, stopt de virtuele Mac. Is het je eigen run, geef die dan mee: loep voiceover stop --run <run>. Een onderzoek dat 6 uur niets schreef, telt niet meer mee. Weet je zeker dat niemand hem nog gebruikt, stop hem dan met: loep voiceover stop --force`;
}

/**
 * `loep voiceover stop`: there is one virtual Mac per machine, so a run that is done does not shut
 * it down while another run is entered as a user, a start runs, or the session process of another
 * run still holds sessions. The entries are looked at first: they also cover a run that holds no
 * session now, as during the sweep. With --run the own run is taken out first, also when the
 * virtual Mac stays up.
 */
export async function voiceoverStop(flags: StopFlags = {}, guest: Guest = lumeGuest(), others: () => Promise<SessionProcess[]> = () => otherSessionProcesses(flags.run), check: () => InUse = () => inUse(flags.run)): Promise<number> {
  if (flags.run) leaveUser(flags.run);
  if (!flags.force && (await guest.state()) === "running") {
    const found = check();
    const sessions = found.users.length > 0 || found.starting ? [] : await others();
    if (found.users.length > 0 || found.starting || sessions.length > 0) {
      process.stdout.write(`${JSON.stringify({ ok: false, stopped: "niet gestopt", error: sessions.length > 0 ? stopRefusedNl(sessions) : inUseNl(found) })}\n`);
      return 1;
    }
  }
  const how = await shutdown(guest);
  process.stdout.write(`${JSON.stringify({ ok: true, stopped: how === "clean" ? "netjes afgesloten" : how === "forced" ? "afsluiten in de gast lukte niet: hard gestopt" : "de virtuele Mac draaide niet" })}\n`);
  return 0;
}

/** One line of a step of the setup, as provision.sh and install.sh in the guest print them. */
export interface SetupLine {
  done: boolean;
  step: string;
  text: string;
}

/** The lines "DONE <step>: ..." and "TODO <step>: ..." in what a script in the guest printed. */
export function setupLines(output: string): SetupLine[] {
  return [...output.matchAll(/^(DONE|TODO) ([a-z-]+): (.*)$/gm)].map((match) => ({ done: match[1] === "DONE", step: match[2]!, text: match[3]! }));
}

const SIP_STEPS = (name: string): string[] => [
  `lume run ${name} --recovery-mode true   (opent een venster met de herstelmodus)`,
  "kies Options en klik op Continue; kies daarna een taal",
  "LET OP: in het venster met vier keuzes klik je niets aan. Klik niet op Ga door (Continue): dat start een herinstallatie van macOS",
  "is dat toch gebeurd, sluit het installatieprogramma dan af met ⌘Q (Command-Q)",
  "open in de menubalk bovenaan Utilities > Terminal (Nederlands: Hulpprogramma's > Terminal)",
  "typ: csrutil disable   en antwoord y; gebruiker lume, wachtwoord lume",
  "typ: shutdown -h now   en draai daarna just voiceover-setup opnieuw",
];

/** Run a script of ours in the guest, loose from the connection, and give back what it printed; null when it did not finish in time. */
async function script(guest: Guest, clock: Clock, name: string, argument: string, seconds: number): Promise<string | null> {
  const log = `/tmp/loep-voiceover-${name}.log`;
  await guest.exec(`cd "$HOME/${GUEST_DIR}" && rm -f ${log} ${log}.end && (nohup sh -c 'bash ${name} ${argument} > ${log} 2>&1; echo $? > ${log}.end' >/dev/null 2>&1 &); echo started`, 30);
  const deadline = clock.now() + seconds * 1000;
  while (clock.now() < deadline) {
    if ((await guest.exec(`cat ${log}.end 2>/dev/null`, 8))?.trim()) return guest.exec(`cat ${log}`, 15);
    await clock.sleep(5000);
  }
  return null;
}

/**
 * `loep voiceover setup`: what can be done without a person, step by step, and for the rest
 * what the person has to do. Nothing is installed or set on this machine except the virtual
 * Mac itself, which lume keeps in its own directory.
 */
export async function voiceoverSetup(name = VM_NAME(), clock: Clock = realClock): Promise<number> {
  const say = (mark: "klaar" | "zelf doen" | "bezig", text: string): void => void process.stdout.write(`${mark.padEnd(9)} ${text}\n`);
  const lume = async (args: string[], timeout = 30_000): Promise<string | null> => run("lume", args, { timeout }).then((found) => found.stdout, () => null);

  if ((await lume(["--version"])) === null) {
    say("zelf doen", "lume staat niet op deze machine. lume (MIT) draait de virtuele Mac; alleen op een Mac met Apple-chip. Installeer het zelf, zie https://github.com/trycua/cua, en draai dit opnieuw");
    return 1;
  }
  say("klaar", `lume ${(await lume(["--version"]))!.trim()}`);
  const telemetry = (await lume(["config", "telemetry", "status"])) ?? "";
  if (/Telemetry enabled: true/.test(telemetry)) say("zelf doen", "lume meldt gebruik aan de maker; zet dat uit met: lume config telemetry disable");
  else say("klaar", "lume meldt geen gebruik aan de maker (telemetrie uit)");

  const guest = lumeGuest(name);
  if ((await guest.state()) === "absent") {
    say("bezig", `het beeld ${IMAGE} ophalen als ${name}: 20 GB, daarna 25 GB op schijf`);
    const pulled = await new Promise<number | null>((resolve) => spawn("lume", ["pull", IMAGE, name], { stdio: ["ignore", "ignore", "inherit"] }).on("close", resolve).on("error", () => resolve(null)));
    if (pulled !== 0) {
      say("zelf doen", `het ophalen mislukte; probeer zelf: lume pull ${IMAGE} ${name}`);
      return 1;
    }
  }
  await lume(["set", name, "--cpu", CPUS, "--memory", MEMORY]);
  say("klaar", `virtuele Mac ${name}: ${CPUS} kernen, ${MEMORY} geheugen`);

  const wasRunning = (await guest.state()) === "running";
  if (!wasRunning) {
    say("bezig", "de virtuele Mac start");
    await guest.boot();
  }
  let up = false;
  for (let waited = 0; waited < 180 && !up; waited += 3) {
    up = (await guest.exec("echo up", 10))?.trim() === "up";
    if (!up) await clock.sleep(3000);
  }
  if (!up) {
    say("zelf doen", "de virtuele Mac geeft geen antwoord over ssh (gebruiker lume, wachtwoord lume). Is het een ander beeld, zet dan Remote Login aan in de virtuele Mac");
    return 1;
  }
  let copied = true;
  for (const file of [...COPIED_FILES, "provision.sh", "install.sh"]) copied = (await putFile(guest, file, readFileSync(join(GUEST_FILES, file)))) && copied;
  if (!copied) {
    say("zelf doen", "de bestanden konden niet naar de virtuele Mac worden gekopieerd");
    return 1;
  }
  let ok = true;
  for (const [file, argument, seconds] of [["provision.sh", "lume", 120], ["install.sh", "", 400]] as const) {
    if (file === "install.sh") say("bezig", "node in de virtuele Mac zetten");
    const lines = setupLines((await script(guest, clock, file, argument, seconds)) ?? "");
    for (const line of lines) say(line.done ? "klaar" : "zelf doen", `in de virtuele Mac, ${line.step}: ${line.text}`);
    if (lines.some((line) => !line.done && line.step === "sip")) for (const step of SIP_STEPS(name)) say("zelf doen", `  ${step}`);
    if (lines.length === 0) say("zelf doen", `${file} gaf geen antwoord binnen ${seconds} seconden`);
    ok = lines.length > 0 && lines.every((line) => line.done);
    if (!ok) break;
  }
  say("bezig", "de virtuele Mac wordt afgesloten");
  await shutdown(guest, clock);
  if (ok) say("klaar", "de virtuele Mac is ingericht. Meten: loep voiceover start, dan loep voiceover read --url <adres>, en aan het eind loep voiceover stop");
  return ok ? 0 : 1;
}
