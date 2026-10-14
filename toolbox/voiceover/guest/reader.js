// Runs inside the virtual Mac, with the node that install.sh put in the home directory.
// loep starts it over ssh and reads the answer back from a file:
//
//   node reader.js versions <out.json>
//   node reader.js warmup <out.json>
//   node reader.js read <out.json> <url> <steps> [<name of a control to press> [played]]
//
// With "played" the page is a test page of loep that plays the steps of a state when it has
// loaded, and writes what it did into the fragment of its address (#loep-played=...). The reader
// waits for that before VoiceOver starts, and reads the address again at the end.
//
// The answer is one JSON object with `ok`; a failure has `error` and never a stack trace.
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const FOCUS_WEB = path.join(__dirname, "focus-web.applescript");
const WARM_MARKER = path.join(HOME, ".loep-voiceover-warm");
const OSASCRIPT_MS = 15_000;
const SAY_MS = 600_000;
const PAUSE_MS = 8_000;
const AFTER_PRESS_MS = 6_000;
const HINT_MS = 3_000;
const PLAYED_MS = 30_000;
const PLAYED_MARK = "#loep-played=";
const PREFERENCES = "de voorkeuren waarmee VoiceOver wordt geleverd";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (text) => String(text).split("\n")[0];
/** An error with its chain of causes on one line. */
const causes = (error) => {
  const parts = [];
  for (let e = error; e && parts.length < 5; e = e.cause) parts.push(firstLine(e.message || e));
  return parts.join(" <- ");
};
/** Run a program under a hard time limit; null when it failed or ran out of time. */
function run(file, args, timeout = OSASCRIPT_MS) {
  try {
    return execFileSync(file, args, { timeout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
const osascript = (...lines) => run("/usr/bin/osascript", lines.flatMap((line) => ["-e", line]));

function bootTime() {
  return /sec = (\d+)/.exec(run("/usr/sbin/sysctl", ["-n", "kern.boottime"]) ?? "")?.[1] ?? "unknown";
}

function versions() {
  return {
    macos: run("/usr/bin/sw_vers", ["-productVersion"]) ?? "unknown",
    build: run("/usr/bin/sw_vers", ["-buildVersion"]) ?? "unknown",
    safari: run("/usr/bin/defaults", ["read", "/Applications/Safari.app/Contents/Info", "CFBundleShortVersionString"]) ?? "unknown",
    node: process.version,
    language: firstLine(osascript('return user locale of (system info)') ?? "unknown"),
  };
}

/**
 * VoiceOver is driven with AppleScript and keys, the way a user and a script on the Mac drive
 * it: started with VoiceOverStarter, moved with its own commands, pressed with VO-Space, and
 * asked what it said last. It runs with the preferences it ships with. Guidepup was tried in
 * between and left out: after its start and its commands VoiceOver stayed silent at a status
 * message that it speaks when driven this way, and guidepup's lastSpokenPhrase() gives what
 * guidepup caught around its own commands, not what VoiceOver says by itself.
 */
const STARTER = "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter";
/** What VoiceOver said last; "" when it said nothing or gave no answer in time. */
const lastPhrase = () => (run("/usr/bin/osascript", ["-e", "with timeout of 4 seconds", "-e", 'tell application "VoiceOver" to get content of last phrase', "-e", "end timeout"], 8_000) ?? "").replace(/^missing value$/, "").replace(/\s+/g, " ").trim();
/** One of VoiceOver's own commands, such as "move right". */
const command = (name) => run("/usr/bin/osascript", ["-e", "with timeout of 10 seconds", "-e", `tell application "VoiceOver" to tell commander to perform command "${name}"`, "-e", "end timeout"]);
/** A VoiceOver key: the key code with Control-Option and any extra modifiers. */
const voKey = (code, extra = "") => run("/usr/bin/osascript", ["-e", "with timeout of 10 seconds", "-e", `tell application "System Events" to key code ${code} using {control down, option down${extra}}`, "-e", "end timeout"]);
const KEY = { space: 49, home: 115, down: 125, up: 126 };
/** How often a read steps into an item where "next" got no further. */
const MAX_STEPS_IN = 6;
/** The hint VoiceOver adds a moment after it lands on an item: no part of the page. */
const isHint = (phrase) => /^You are currently (on|in) /.test(phrase);

/** Do something that moves VoiceOver, and give the first thing it says after it: asked a few times a second, before the hint replaces it. */
async function saidAfter(act) {
  const before = lastPhrase();
  act();
  let phrase = before;
  for (const until = Date.now() + 2_500; Date.now() < until; await sleep(150)) {
    phrase = lastPhrase();
    if (phrase !== before && !isHint(phrase)) return phrase;
  }
  // Nothing new was said: VoiceOver stayed where it was, or the next item reads the same.
  return isHint(phrase) ? "" : phrase;
}

/** Start VoiceOver and wait until it answers with a sentence; one that does not answer is killed and started again. */
async function startVoiceOver(notes) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    run("/usr/bin/killall", ["VoiceOver"]);
    await sleep(1500);
    spawn(STARTER, [], { detached: true, stdio: "ignore" }).unref();
    for (let n = 0; n < 8; n += 1) {
      await sleep(2000);
      if (lastPhrase() !== "") return attempt;
    }
    notes.push(`start ${attempt}: VoiceOver gaf binnen 16 seconden geen zin terug`);
  }
  return 0;
}

async function stopVoiceOver() {
  run("/usr/bin/osascript", ["-e", "with timeout of 10 seconds", "-e", 'tell application "VoiceOver" to quit', "-e", "end timeout"]);
  await sleep(2000);
  run("/usr/bin/killall", ["VoiceOver"]);
  // VoiceOverStarter switches this on; left on, macOS starts VoiceOver itself at the next login.
  run("/usr/bin/defaults", ["write", "com.apple.universalaccess", "voiceOverOnOffKey", "-bool", "false"]);
}

/**
 * The first time speech goes to the sound output after a boot, the whole guest stands still
 * for about four minutes, sometimes a few seconds after the first sentence was said. When
 * that hits VoiceOver's own first sentence, VoiceOver and the window server can hang for
 * good. So speech is warmed up with `say` first: three sentences with a pause between them.
 */
async function warmup() {
  const says = [];
  for (let n = 0; n < 3; n += 1) {
    const started = Date.now();
    const said = run("/usr/bin/say", ["warming up"], SAY_MS) !== null;
    says.push({ seconds: Math.round((Date.now() - started) / 1000), said });
    const paused = Date.now();
    await sleep(PAUSE_MS);
    says[n].pauseSeconds = Math.round((Date.now() - paused) / 1000);
  }
  const notes = [];
  const attempts = await startVoiceOver(notes);
  const phrase = attempts > 0 ? lastPhrase() : null;
  await stopVoiceOver();
  if (attempts === 0) return { ok: false, error: "VoiceOver startte niet na de gesproken opwarming", says, notes };
  fs.writeFileSync(WARM_MARKER, `${bootTime()}\n`);
  return { ok: true, says, startAttempts: attempts, firstPhrase: phrase, notes, versions: versions() };
}

/** Open the address in Safari and wait until Safari says it has a page. */
async function openInSafari(url, notes) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    run("/usr/bin/open", ["-a", "Safari", url]);
    await sleep(5000);
    const title = osascript('tell application "Safari" to get name of front document');
    const at = osascript('tell application "Safari" to get URL of front document');
    if (title !== null && at !== null && at !== "" && !title.includes("Failed to open")) return { title, url: at };
    notes.push(`Safari had de pagina nog niet (poging ${attempt})`);
  }
  return null;
}

/** The address of the page in Safari now; null when Safari gives none. */
const addressNow = () => osascript('tell application "Safari" to get URL of front document');

/** Wait until the test page says it played every step it could, or the time is up; the address it had then. */
async function waitPlayed() {
  let address = null;
  for (const until = Date.now() + PLAYED_MS; Date.now() < until; await sleep(500)) {
    address = addressNow();
    const at = address ? address.indexOf(PLAYED_MARK) : -1;
    if (at !== -1 && /%22done%22%3Atrue|"done":true/.test(address.slice(at))) return address;
  }
  return address;
}

async function read(url, steps, press, played) {
  if (!fs.existsSync(WARM_MARKER) || fs.readFileSync(WARM_MARKER, "utf8").trim() !== bootTime()) return { ok: false, error: "de spraak van de virtuele Mac is sinds het opstarten niet opgewarmd: draai eerst loep voiceover start" };
  const notes = [];
  run("/usr/bin/killall", ["VoiceOver"]);
  osascript('tell application "Safari" to quit');
  await sleep(1500);
  const page = await openInSafari(url, notes);
  if (!page) return { ok: false, error: "Safari in de virtuele Mac kon de pagina niet openen", notes };
  const marks = played ? { start: await waitPlayed(), end: null } : null;
  // Keyboard focus to the web content before VoiceOver starts: its cursor follows keyboard
  // focus, so it starts in the page and not in the address bar.
  const focused = run("/usr/bin/osascript", [FOCUS_WEB], 60_000);
  if (focused === null || focused.startsWith("no web area")) return { ok: false, error: "de webinhoud van Safari is niet gevonden", notes };
  const attempts = await startVoiceOver(notes);
  if (attempts === 0) {
    await stopVoiceOver();
    return { ok: false, error: "VoiceOver startte niet", notes };
  }
  try {
    osascript('tell application "Safari" to activate');
    await sleep(3000);
    // Into the web content. Usually VoiceOver is there already ("... web content has keyboard
    // focus"); otherwise out to the level of the window, along its parts to the web area, and in.
    const way = [lastPhrase()];
    if (!/web content/.test(way[0])) {
      for (let n = 0; n < 3; n += 1) voKey(KEY.up, ", shift down");
      way.push(await saidAfter(() => voKey(KEY.home, ", shift down")));
      for (let n = 0; n < 12 && !/web content$/.test(way[way.length - 1]); n += 1) way.push(await saidAfter(() => command("move right")));
      if (!/web content$/.test(way[way.length - 1])) return { ok: false, error: `VoiceOver kwam niet bij de webinhoud; onderweg: ${way.filter((phrase) => phrase !== "").join(" | ")}`, notes };
      way.push(await saidAfter(() => voKey(KEY.down, ", shift down")));
    }
    // The first item of the page: the top of the web area.
    const spoken = [(await saidAfter(() => voKey(KEY.home))).replace(/^In .*? web content /, "")];
    let pressed = null;
    const pressIfNamed = async (index) => {
      if (!press || pressed || !spoken[index].toLowerCase().includes(press.toLowerCase())) return;
      // First let VoiceOver finish the hint it adds to the control, so that it is not taken for an answer to the press.
      await sleep(HINT_MS);
      const before = lastPhrase();
      voKey(KEY.space);
      // What VoiceOver said by itself after the press, without a command of ours in between:
      // asked a few times a second, because a later sentence replaces an earlier one.
      const heard = [];
      for (const until = Date.now() + AFTER_PRESS_MS; Date.now() < until; await sleep(150)) heard.push(lastPhrase());
      const after = [...new Set(heard)].filter((phrase) => phrase !== "" && phrase !== before && phrase !== spoken[index] && !isHint(phrase));
      pressed = { step: index + 1, control: spoken[index], spokenByItself: after };
    };
    await pressIfNamed(0);
    let ended = false;
    // Where "next" does not get further, a person steps into the item (VO-Shift-Down): an open
    // dialog, which VoiceOver keeps the cursor in, is one item until then.
    let stepsIn = 0;
    while (spoken.length < steps) {
      let phrase = await saidAfter(() => command("move right"));
      // At the end of the web content VoiceOver stays on the last item: it says nothing, or the same again.
      const lastSaid = spoken.findLast((entry) => entry !== "");
      const stuck = () => (phrase === "" && spoken[spoken.length - 1] === "") || (phrase !== "" && phrase === lastSaid);
      // Only into an item that holds others ("dialog with 4 items"), not into the title of a button at the end.
      if (stuck() && stepsIn < MAX_STEPS_IN && /with \d+ items?$/.test(lastSaid ?? "")) {
        stepsIn += 1;
        const inside = await saidAfter(() => voKey(KEY.down, ", shift down"));
        phrase = inside !== "" && inside !== lastSaid ? inside : await saidAfter(() => command("move right"));
        if (phrase !== "" && phrase !== lastSaid) notes.push(`stap ${spoken.length + 1}: in het onderdeel gestapt (VO-Shift-pijl-omlaag)`);
      }
      if (stuck()) {
        while (spoken.length > 1 && spoken[spoken.length - 1] === "") spoken.pop();
        ended = true;
        break;
      }
      spoken.push(phrase);
      await pressIfNamed(spoken.length - 1);
    }
    if (marks) marks.end = addressNow();
    return { ok: true, url: page.url, title: page.title, spoken, ended, way, startAttempts: attempts, preferences: PREFERENCES, ...(press ? { press: { asked: press, ...(pressed ?? { step: null }) } } : {}), ...(marks ? { marks } : {}), notes, versions: versions() };
  } catch (error) {
    return { ok: false, error: `VoiceOver gaf geen antwoord: ${causes(error)}`, notes };
  } finally {
    await stopVoiceOver();
    osascript('tell application "Safari" to quit');
  }
}

async function main() {
  const [command, out, ...rest] = process.argv.slice(2);
  let answer;
  try {
    if (command === "versions") answer = { ok: true, versions: versions() };
    else if (command === "warmup") answer = await warmup();
    else if (command === "read") answer = await read(rest[0], Math.max(1, Number(rest[1]) || 1), rest[2] || null, rest[3] === "played");
    else answer = { ok: false, error: `onbekend commando: ${command}` };
  } catch (error) {
    answer = { ok: false, error: causes(error) };
  }
  // Written next to the place and renamed, so loep never reads half an answer.
  fs.writeFileSync(`${out}.part`, JSON.stringify(answer));
  fs.renameSync(`${out}.part`, out);
  process.exit(answer.ok ? 0 : 1);
}

main();
