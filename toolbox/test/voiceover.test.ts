import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { screenReaderUse } from "../src/commands/evaluate.ts";
import { setupLines } from "../src/commands/voiceover.ts";
import { speechDifferences } from "../src/instruments/methods/speech.ts";
import { GUEST_VERSION, METHODS, toolStatus } from "../src/instruments/methods/registry.ts";
import { MEASURE_COMMANDS } from "../src/lib/verdict.ts";
import { addressFor, connectTo, COPIED_FILES, FIRST_NUMBER, framed, GuestQueue, hostRefuses, isReady, job, LIMITS, lumeGuest, read, readingOf, markStarting, recordedStart, shutdown, SILENT_NOTE, start, statusNl, VOICEOVER, VOICEOVER_NOTE, voiceoverStatus, warmUpDue, voiceoverWarningNl, type Clock, type Guest, type GuestAnswer, type GuestState, type Reach, type Versions } from "../src/lib/voiceover.ts";
import { guardLines, loadedLine, planSteps, playedOf, policyOf, testPage } from "../src/lib/voiceover-page.ts";
import type { Step } from "../src/session/observations.ts";

// These tests run without a virtual Mac and without lume: the guest is played by a small
// object that answers the shell commands the way the real one does.

const VERSIONS: Versions = { macos: "26.4", build: "25E246", safari: "26.4", node: "v24.21.0", language: "en_US" };

/** A clock that does not wait: every sleep moves the time on. */
function fakeClock(): Clock & { slept: number } {
  let time = 1_000_000;
  const clock = { slept: 0, now: () => time, sleep: async (ms: number) => void ((time += ms), (clock.slept += ms)) };
  return clock;
}

interface Plan {
  state?: GuestState;
  /** Per boot the answer of the warm-up; a boot beyond the list warms up fine. */
  warmups?: GuestAnswer[];
  read?: GuestAnswer;
  installed?: boolean;
  /** Whether a shutdown in the guest stops it; otherwise only pulling the plug does. */
  shutsDown?: boolean;
  /** Boots after which the guest never shows a desktop. */
  noDesktopOnBoot?: number[];
}

/** A guest that keeps what was asked of it. */
function fakeGuest(plan: Plan = {}) {
  const guest = {
    state: plan.state ?? ("stopped" as GuestState),
    boots: 0,
    halts: 0,
    commands: [] as string[],
    files: new Map<string, string>(),
    answers: new Map<string, string>(),
    warm: false,
  };
  const api: Guest = {
    state: async () => guest.state,
    boot: async () => void ((guest.boots += 1), (guest.state = "running"), (guest.warm = false)),
    halt: async () => void ((guest.halts += 1), (guest.state = "stopped")),
    exec: async (command) => {
      guest.commands.push(command);
      if (guest.state !== "running") return null;
      if (command.includes("pgrep -x Dock")) return plan.noDesktopOnBoot?.includes(guest.boots) ? "" : "desktop";
      if (command.startsWith("sysctl -n vm.loadavg")) return "{ 1.20 4.00 3.00 }";
      if (command.includes(".loep-voiceover-warm")) return guest.warm ? "warm" : "";
      if (command.includes("base64 -D")) {
        const [, content, path] = /echo (\S+) \| base64 -D > "\$HOME\/loep-voiceover\/([^"]+)"/.exec(command)!;
        guest.files.set(path!, Buffer.from(content!, "base64").toString("utf8"));
        return "copied";
      }
      if (command.includes("node/bin/node\" ] && echo installed")) return plan.installed === false ? "" : "installed";
      if (command.includes("sudo shutdown -h now")) {
        if (plan.shutsDown !== false) guest.state = "stopped";
        return "";
      }
      if (command.includes("reader.js")) {
        const out = /rm -f (\S+\.json)/.exec(command)?.[1];
        if (!out) return "";
        const answer = command.includes("'warmup'") ? (plan.warmups?.[guest.boots - 1] ?? { ok: true, says: [{ seconds: 2, said: true }, { seconds: 232, said: true }, { seconds: 1, said: true }], startAttempts: 1, versions: VERSIONS }) : command.includes("'versions'") ? { ok: true, versions: VERSIONS } : (plan.read ?? { ok: false, error: "geen plan" });
        if (command.includes("'warmup'") && answer.ok) guest.warm = true;
        guest.answers.set(out, JSON.stringify(answer));
        return "started";
      }
      if (command.startsWith("cat /tmp/loep-voiceover-")) return guest.answers.get(/cat (\S+)/.exec(command)![1]!) ?? "";
      if (command === 'echo "$HOME"') return "/Users/lume";
      return "";
    },
  };
  return { guest, api };
}

const files = (name: string): Buffer => Buffer.from(`content of ${name}`);

test("what the guest printed is read between the two marks, also when lume ssh dropped the first lines", () => {
  assert.equal(framed("\n\n@@LOEP-BEGIN@@\n{\"ok\":true}\n@@LOEP-END@@\n"), '{"ok":true}');
  // The first lines, with the opening mark in them, are gone: there is no answer, and the caller asks again.
  assert.equal(framed('{"ok":true}\n@@LOEP-END@@\n'), null);
  assert.equal(framed(""), null);
  assert.equal(framed("@@LOEP-BEGIN@@\n@@LOEP-END@@\n"), "");
  assert.equal(framed("noise @@LOEP-BEGIN@@\nline one\nline two\n@@LOEP-END@@"), "line one\nline two");
});

test("start boots, waits, copies the files of this version, warms up and says which sentence took the standstill", async () => {
  const { guest, api } = fakeGuest();
  const lines: string[] = [];
  const started = await start(api, (line) => lines.push(line), fakeClock(), files);
  assert.equal(started.ok, true);
  assert.equal(started.boots, 1);
  assert.deepEqual(started.versions, VERSIONS);
  assert.equal(guest.boots, 1);
  assert.equal(guest.state, "running", "the virtual Mac stays up after a good start");
  for (const name of COPIED_FILES) assert.equal(guest.files.get(name), `content of ${name}`);
  assert.match(started.attempts[0]!, /start 1: opgewarmd \(zin 2 duurde 232 s\), VoiceOver startte bij poging 1/);
  // Progress carries the time since the start, on every line.
  for (const line of lines) assert.match(line, /^\[ *\d+ s\] /);
  // The order: desktop, calm, files, warm-up.
  const order = ["pgrep -x Dock", "vm.loadavg", "base64 -D", "'warmup'"].map((part) => guest.commands.findIndex((command) => command.includes(part)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((index) => index !== -1));
});

test("a boot whose warm-up fails is shut down and done again, at most three boots", async () => {
  const failed: GuestAnswer = { ok: false, error: "VoiceOver startte niet na de gesproken opwarming" };
  const second = fakeGuest({ warmups: [failed] });
  const lines: string[] = [];
  const started = await start(second.api, (line) => lines.push(line), fakeClock(), files);
  assert.equal(started.ok, true);
  assert.equal(started.boots, 2);
  assert.equal(second.guest.boots, 2);
  assert.equal(second.guest.halts, 0, "the first boot was shut down from the inside");
  assert.match(started.attempts[0]!, /start 1: opwarmen mislukt: VoiceOver startte niet/);
  assert.match(started.attempts[1]!, /start 2: opgewarmd/);
  assert.ok(lines.some((line) => line.includes("wordt afgesloten en opnieuw gestart")));

  const never = fakeGuest({ warmups: [failed, failed, failed, failed] });
  const gaveUp = await start(never.api, () => undefined, fakeClock(), files);
  assert.equal(gaveUp.ok, false);
  assert.equal(never.guest.boots, LIMITS.boots);
  assert.equal(never.guest.state, "stopped", "after the last failed boot the virtual Mac is left stopped");
  assert.match(gaveUp.error!, /kwam in 3 starts niet tot een werkende VoiceOver/);
});

test("a guest that does not shut down from the inside gets its plug pulled, and a boot without a desktop counts as failed", async () => {
  const stuck = fakeGuest({ warmups: [{ ok: false, error: "geen antwoord van de virtuele Mac binnen 900 seconden" }], shutsDown: false });
  const started = await start(stuck.api, () => undefined, fakeClock(), files);
  assert.equal(started.ok, true);
  assert.equal(stuck.guest.halts, 1);

  const blank = fakeGuest({ noDesktopOnBoot: [1] });
  const after = await start(blank.api, () => undefined, fakeClock(), files);
  assert.equal(after.ok, true);
  assert.equal(after.boots, 2);
  assert.match(after.attempts[0]!, /geen bureaublad binnen/);

  assert.equal(await shutdown(fakeGuest({ state: "stopped" }).api, fakeClock()), "was-stopped");
});

test("start says what is missing instead of booting: no lume, no virtual Mac, nothing installed in it", async () => {
  const noLume = await start(fakeGuest({ state: "no-lume" }).api, () => undefined, fakeClock(), files);
  assert.equal(noLume.ok, false);
  assert.match(noLume.error!, /lume staat niet op deze machine.*just voiceover-setup/);
  const absent = fakeGuest({ state: "absent" });
  assert.match((await start(absent.api, () => undefined, fakeClock(), files)).error!, /bestaat niet: draai just voiceover-setup/);
  assert.equal(absent.guest.boots, 0);
  const bare = fakeGuest({ installed: false });
  const started = await start(bare.api, () => undefined, fakeClock(), files);
  assert.match(started.error!, /node staat niet in de virtuele Mac: draai just voiceover-setup/);
  assert.equal(bare.guest.state, "stopped");
});

test("a virtual Mac that is up and warmed up is not booted or warmed up again", async () => {
  const { guest, api } = fakeGuest({ state: "running" });
  guest.warm = true;
  const started = await start(api, () => undefined, fakeClock(), files);
  assert.equal(started.ok, true);
  assert.equal(started.boots, 0);
  assert.equal(guest.boots, 0);
  assert.ok(!guest.commands.some((command) => command.includes("'warmup'")));
  assert.deepEqual(started.versions, VERSIONS);
});

test("a job that never answers ends with a reason and cleans up in the guest", async () => {
  const { guest, api } = fakeGuest({ state: "running" });
  // The reader is started and writes nothing.
  const silent: Guest = { ...api, exec: async (command, seconds) => (command.startsWith("cat /tmp/loep-voiceover-") ? null : api.exec(command, seconds)) };
  const clock = fakeClock();
  const answer = await job(silent, clock, ["read", "https://example.test/", "3"], 20);
  assert.deepEqual(answer, { ok: false, error: "geen antwoord van de virtuele Mac binnen 20 seconden" });
  assert.ok(clock.slept >= 20_000);
  assert.ok(guest.commands.at(-1)!.includes("killall VoiceOver"));
});

const READ: GuestAnswer = {
  ok: true,
  url: "file:///Users/lume/loep-voiceover/pages/proef.html",
  title: "Proef VoiceOver",
  spoken: ["heading level 1 Proef VoiceOver", "Verstuur button", "E-mailadres", "E-mailadres Vul een geldig e-mailadres in invalid data edit text", "Vul een geldig e-mailadres in", "Toon bedankje button", ""],
  ended: false,
  way: ["Proef VoiceOver web content", "In Proef VoiceOver web content heading level 1 Proef VoiceOver"],
  startAttempts: 1,
  preferences: "de voorkeuren waarmee VoiceOver wordt geleverd",
  press: { asked: "bedankje", step: 6, control: "Toon bedankje button", spokenByItself: [] },
  versions: VERSIONS,
};

test("the answer of read has the shape of speak: every reader in methods, with VoiceOver named as a real one and its versions", () => {
  const { result, print } = readingOf({ ...READ, press: undefined }, 35_000);
  assert.equal(result.probe, "walk");
  assert.equal(result.agreement, "single");
  assert.deepEqual(result.differences, []);
  assert.deepEqual(result.failed, []);
  assert.equal(result.methods.length, 1);
  const method = result.methods[0]!;
  assert.equal(method.method, "screen-reader");
  assert.equal(method.implementation, VOICEOVER);
  assert.equal(method.version, "macOS 26.4 (25E246), Safari 26.4, node v24.21.0");
  assert.equal(method.ms, 35_000);
  assert.equal(method.result.simulated, false);
  assert.equal(method.result.language, "en");
  assert.deepEqual(method.result.spoken, READ.spoken);
  // The record says which preferences VoiceOver ran with.
  assert.deepEqual(result.source, { reader: "VoiceOver", virtualMachine: "loep-voiceover", preferences: "de voorkeuren waarmee VoiceOver wordt geleverd", ...VERSIONS });
  assert.equal(readingOf({ ...READ, press: undefined, preferences: undefined }, 1).result.source.preferences, "onbekend");
  // The print has the keys of speak --steps: steps, reader, readerNote.
  assert.deepEqual(Object.keys(print), ["steps", "reader", "readerNote"]);
  assert.deepEqual((print.steps as string[]).slice(0, 2), ["1 heading level 1 Proef VoiceOver", "2 Verstuur button"]);
  assert.equal((print.steps as string[])[6], "7 (niets uitgesproken)");
  assert.equal(print.reader, "VoiceOver, macOS 26.4 (25E246), Safari 26.4, node v24.21.0");
  assert.equal(print.readerNote, VOICEOVER_NOTE);
  assert.match(VOICEOVER_NOTE, /Engels/);
});

test("with a press the answer says where the control was and what was spoken by itself, or that nothing was", () => {
  const silent = readingOf(READ, 1);
  assert.equal(silent.result.probe, "after-action");
  assert.equal(silent.print.pressed, "stap 6: Toon bedankje button");
  assert.equal(silent.print.silent, "er werd niets uit zichzelf uitgesproken");
  // The answer says itself what silence after a press covers: which press, how long, and that a hint is no answer.
  assert.equal(silent.print.silentNote, SILENT_NOTE);
  assert.match(SILENT_NOTE, /6 seconden lang na VO-spatie/);
  assert.equal(silent.print.spoken, undefined);
  assert.deepEqual(silent.result.methods[0]!.result.pressed, { step: 6, asked: "bedankje", control: "Toon bedankje button", spokenByItself: [] });

  const spoke = readingOf({ ...READ, press: { ...READ.press!, spokenByItself: ["Bedankt, uw bericht is verzonden"] } }, 1);
  assert.deepEqual(spoke.print.spoken, ["Bedankt, uw bericht is verzonden"]);
  assert.equal(spoke.print.silent, undefined);
  assert.equal(spoke.print.silentNote, undefined);

  const absent = readingOf({ ...READ, press: { asked: "afrekenen", step: null } }, 1);
  assert.match(String(absent.print.pressed), /geen onderdeel met "afrekenen" in de naam gevonden/);
  assert.equal(readingOf({ ...READ, press: undefined, ended: true }, 1).print.ended, "VoiceOver was aan het eind van de pagina voordat de stappen op waren");
});

test("a failed answer of the guest is an error that says why, never an empty reading", () => {
  assert.throws(() => readingOf({ ok: false, error: "Safari in de virtuele Mac kon de pagina niet openen" }, 1), /VoiceOver gaf geen antwoord: Safari in de virtuele Mac kon de pagina niet openen/);
  assert.throws(() => readingOf({ ok: true }, 1), /VoiceOver gaf geen antwoord/);
});

test("VoiceOver and the simulated reader can be laid side by side with the comparison speak already has", () => {
  const voiceOver = readingOf({ ...READ, press: undefined, spoken: ["Verstuur button", "E-mailadres Vul een geldig e-mailadres in invalid data edit text"] }, 1).result.methods[0]!;
  const simulated = { implementation: "@guidepup/virtual-screen-reader", result: { spoken: ["button, Verstuur", "textbox, E-mailadres, Vul een geldig e-mailadres in, invalid"], simulated: true } };
  const differences = speechDifferences([simulated, voiceOver]);
  // Same words in another order are the same; the second item differs in how each reader words role and state.
  assert.equal(differences.length, 1);
  assert.match(differences[0]!, /^stap 2: @guidepup\/virtual-screen-reader ".*", voiceover ".*invalid data edit text"$/);
});

test("read copies a local file into the guest, passes an address on, and refuses localhost of this machine", async () => {
  const { guest, api } = fakeGuest({ state: "running", read: { ...READ, press: undefined } });
  const local = (path: string): Buffer => Buffer.from(`<title>${path}</title>`);
  assert.equal(await addressFor(api, "/tmp/mijn pagina.html", local), "file:///Users/lume/loep-voiceover/pages/mijn_pagina.html");
  assert.equal(guest.files.get("pages/mijn_pagina.html"), "<title>/tmp/mijn pagina.html</title>");
  assert.equal(await addressFor(api, "file:///tmp/a.html", local), "file:///Users/lume/loep-voiceover/pages/a.html");
  assert.equal(await addressFor(api, "https://example.test/x?y=1", local), "https://example.test/x?y=1");
  for (const own of ["http://localhost:4710/", "http://127.0.0.1:4710/a", "http://[::1]/"]) await assert.rejects(addressFor(api, own, local), /localhost van deze machine is in de virtuele Mac een andere machine/);

  const reading = await read(api, { url: "/tmp/proef.html", steps: 7, press: "bedankje" }, fakeClock(), local, files);
  assert.equal(guest.files.get("reader.js"), "content of reader.js", "read brings the reader of this version along");
  assert.equal(reading.result.title, "Proef VoiceOver");
  // The reader in the guest gets the address in the guest, the steps and the name to press, each as one quoted word.
  const started = guest.commands.find((command) => command.includes("'read'"))!;
  assert.match(started, /'read' '\/tmp\/loep-voiceover-\d+\.json' 'file:\/\/\/Users\/lume\/loep-voiceover\/pages\/proef\.html' '7' 'bedankje'/);
});

test("read without a running virtual Mac says what to do first", async () => {
  await assert.rejects(read(fakeGuest({ state: "stopped" }).api, { url: "https://example.test/", steps: 3 }, fakeClock()), /draai eerst loep voiceover start/);
  await assert.rejects(read(fakeGuest({ state: "no-lume" }).api, { url: "https://example.test/", steps: 3 }, fakeClock()), /er is geen virtuele Mac voor VoiceOver/);
});

test("the lines of the setup scripts are read as done or to do", () => {
  const lines = setupLines("noise\nDONE sudo: zonder wachtwoord voor lume\nTODO sip: System Integrity Protection staat aan; zet het uit\nDONE permissions: rechten gezet\n");
  assert.deepEqual(lines, [
    { done: true, step: "sudo", text: "zonder wachtwoord voor lume" },
    { done: false, step: "sip", text: "System Integrity Protection staat aan; zet het uit" },
    { done: true, step: "permissions", text: "rechten gezet" },
  ]);
  assert.deepEqual(setupLines(""), []);
});

test("VoiceOver is a second method for speech, optional: without the virtual Mac it is listed as missing and the rest answers", async () => {
  const method = METHODS.find((entry) => entry.id === VOICEOVER)!;
  assert.deepEqual(method.questions, ["speech"]);
  assert.equal(method.implementation, VOICEOVER);
  assert.equal(method.method, "screen-reader", "the method of the record readingOf writes, so the report finds it in the register");
  assert.ok(METHODS.findIndex((entry) => entry.id === "virtual-screen-reader") < METHODS.indexOf(method), "after the simulated reader: the register keeps its order");
  assert.ok((MEASURE_COMMANDS as readonly string[]).includes("voiceover"), "a reading by VoiceOver counts as a measurement in a verdict");
  const before = process.env.LOEP_VOICEOVER;
  process.env.LOEP_VOICEOVER = "off";
  try {
    const status = (await toolStatus({}, () => true)).find((entry) => entry.id === VOICEOVER)!;
    assert.equal(status.available, false);
    assert.equal(status.version, GUEST_VERSION);
    assert.match(status.hint!, /virtuele Mac draait niet.*zonder werkt de rest/);
  } finally {
    if (before === undefined) delete process.env.LOEP_VOICEOVER;
    else process.env.LOEP_VOICEOVER = before;
  }
  const guestFile = (name: string): string => fileURLToPath(new URL(`../voiceover/guest/${name}`, import.meta.url));
  for (const name of [...COPIED_FILES, "provision.sh", "install.sh"]) assert.ok(existsSync(guestFile(name)), name);
  assert.match(readFileSync(guestFile("install.sh"), "utf8"), /^NODE_VERSION=v\d+\.\d+\.\d+$/m);
  // The reader drives VoiceOver itself and needs no package in the guest: what it loads is part of node.
  const required = [...readFileSync(guestFile("reader.js"), "utf8").matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]!);
  assert.ok(required.length > 0);
  for (const name of required) assert.match(name, /^node:/, name);
  // After a press it asks VoiceOver itself and presses with the keys a user presses.
  const reader = readFileSync(guestFile("reader.js"), "utf8");
  assert.match(reader, /get content of last phrase/);
  assert.match(reader, /voKey\(KEY\.space\)/);
});

test("the report names VoiceOver with its versions only when an agent read with it", () => {
  const none = screenReaderUse([{ implementation: "axe-core", version: "4.10.0", measurements: 3 }]);
  assert.deepEqual(none.assistiveTechnology, []);
  assert.match(none.limitationNl, /niet getest met hulpsoftware/);
  const used = screenReaderUse([{ implementation: "voiceover", version: "macOS 26.4 (25E246), Safari 26.4, node v24.21.0", measurements: 2 }]);
  assert.deepEqual(used.assistiveTechnology, [{ name: "VoiceOver met Safari, in een virtuele Mac", version: "macOS 26.4 (25E246), Safari 26.4, node v24.21.0" }]);
  assert.match(used.limitationNl, /2 keer: VoiceOver met Safari.*NVDA of JAWS anders/);
  assert.match(used.noteNl, /NVDA en JAWS zijn niet getest/);
});

const fakeTime = (): Clock & { hooks: (() => void)[] } => {
  let time = 5_000_000;
  const clock = { hooks: [] as (() => void)[], now: () => time, sleep: async (ms: number) => void ((time += ms), clock.hooks.shift()?.()) };
  return clock;
};

test("readings wait for each other in the order they came, and each hears how long and behind how many", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-vo-queue-"));
  try {
    const clock = fakeTime();
    const queue = new GuestQueue({ file: join(dir, "vm.lock"), clock });
    const order: string[] = [];
    let release: (() => void) | null = null;
    const first = queue.turn(async () => {
      order.push("first begins");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first ends");
      return 1;
    });
    const second = queue.turn(async () => {
      order.push("second");
      return 2;
    });
    assert.equal(queue.length, 2);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    // The reading takes 45 seconds on the clock.
    await clock.sleep(45_000);
    (release as () => void)();
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(order, ["first begins", "first ends", "second"]);
    assert.deepEqual(one.waited, { seconds: 0, ahead: 0 });
    assert.deepEqual(two.waited, { seconds: 45, ahead: 1 });
    assert.equal(queue.length, 0);
    assert.ok(!existsSync(join(dir, "vm.lock")), "the lock is given back after each reading");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reading of another process holds the virtual Mac until it is done; a lock left behind is taken over, and too long a wait gives up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-vo-lock-"));
  const file = join(dir, "vm.lock");
  try {
    // Another process that lives (this one stands in for it) is reading.
    const clock = fakeTime();
    writeFileSync(file, `${process.pid} ${clock.now()}\n`);
    clock.hooks.push(() => undefined, () => rmSync(file, { force: true }));
    const after = await new GuestQueue({ file, clock }).turn(async () => "read");
    assert.equal(after.value, "read");
    assert.deepEqual(after.waited, { seconds: 4, ahead: 1 });

    // A process that is gone left its lock behind: taken over at once.
    writeFileSync(file, `2147483646 ${clock.now()}\n`);
    assert.deepEqual((await new GuestQueue({ file, clock }).turn(async () => "read")).waited, { seconds: 0, ahead: 0 });

    // Held for longer than the longest wait.
    writeFileSync(file, `${process.pid} ${clock.now()}\n`);
    await assert.rejects(new GuestQueue({ file, clock, maxWaitSeconds: 60 }).turn(async () => "never"), /na 1 minuten nog bezet door een ander proces/);
    assert.ok(existsSync(file), "the lock of the other process stays");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const step = (command: string, args: string[] = [], options: Record<string, string | boolean> = {}, target: string[] | null = ["main", "button"]): Step => ({ command, args, options, target });

test("the steps of a state become steps the test page plays; a step it cannot play in Safari is named", () => {
  const { planned, unplayable } = planSteps([step("click"), step("select", ["Compliment"]), step("type", ["text"]), step("speak", [], { type: "email", submit: true }), step("key", ["Escape"], {}, null), step("scroll", ["down"], {}, null), step("reflow", [], {}, null), step("spacing", [], { keep: true }, null)]);
  assert.deepEqual(unplayable, []);
  assert.deepEqual(planned.map((entry) => entry.how), ["click", "select", "fill", "fill", "key", "scroll", "skip", "spacing"]);
  assert.equal(planned[1]!.value, "Compliment");
  assert.equal(planned[2]!.value, "Testbericht van loep (toegankelijkheidsonderzoek), niet beantwoorden");
  assert.deepEqual([planned[3]!.value, planned[3]!.after], ["loep-test@example.com", "Enter"]);
  assert.match(planned[6]!.note!, /in Safari niet herhaald/);

  // Tab is a key the test page plays itself: `tab 2` twice, `tab --shift` backwards.
  const tabs = planSteps([step("tab", ["2"], {}, null), step("tab", [], { shift: true }, null), step("key", ["Shift+Tab"], {}, null), step("tab", ["900"], {}, null)]);
  assert.deepEqual(tabs.unplayable, []);
  assert.deepEqual(tabs.planned.map((entry) => [entry.how, entry.value, entry.times]), [["key", "Tab", 2], ["key", "Shift+Tab", 1], ["key", "Shift+Tab", undefined], ["key", "Tab", 50]]);

  const refused = planSteps([step("click"), step("goto", ["https://example.test/b"], {}, null), step("press", [], { hold: true })]).unplayable;
  assert.deepEqual(refused.map((entry) => [entry.step, entry.command]), [[2, "goto"], [3, "press"]]);
  assert.match(refused[0]!.reason, /naar een andere pagina/);
});

test("a step in an embedded frame is refused before Safari is asked; a measurement there is skipped as anywhere", () => {
  const inFrame = ["html > body > main > iframe:nth-of-type(2)", "html > body > button"];
  const { planned, unplayable } = planSteps([step("click", [], {}, inFrame), { ...step("key", ["Enter"], {}, null), focus: inFrame }, step("reflow", [], {}, inFrame), step("click", [], {}, ["html > body > iframe"]), step("focus", [], {}, ["html > body > frame", "html > body > a"])]);
  assert.deepEqual(unplayable.map((entry) => [entry.step, entry.command]), [[1, "click"], [2, "key"], [5, "focus"]]);
  assert.match(unplayable[0]!.reason, /ingesloten venster/);
  // The frame element itself is in the page, and so is a click on it.
  assert.deepEqual(planned.map((entry) => entry.how), ["skip", "click"]);
});

test("the test page keeps the page and puts a base, a policy and the script at the top; the page's own base stays the base", () => {
  const page = testPage({ html: '<!doctype html><html lang="nl"><head><meta charset="windows-1252"><base href="/sub/"><title>T</title></head><body><a href="x">x</a></body></html>', url: "https://site.example/a/b.html", steps: [], hosts: ["site.example"], strict: false, noMailto: true });
  assert.match(page, /^<!doctype html><html lang="nl"><head><meta charset="utf-8"><base href="https:\/\/site\.example\/sub\/"><meta http-equiv="Content-Security-Policy" content="[^"]*form-action 'none'[^"]*"><script>\(function \(config\)/);
  assert.equal((page.match(/<base /g) ?? []).length, 1, "the page's own base is replaced by the resolved one");
  assert.match(page, /"noMailto":true/);
  assert.match(page, /<title>T<\/title><\/head><body><a href="x">x<\/a>/);
  // A step with text that could end the script cannot.
  assert.doesNotMatch(testPage({ html: "<p>x</p>", url: "https://site.example/", steps: [{ command: "select", how: "select", target: null, value: "</script><b>" }], hosts: [], strict: false }), /<\/script><b>/);
  assert.equal(policyOf(["site.example"], false), "connect-src http://site.example https://site.example ws://site.example wss://site.example; form-action 'none'; frame-src http://site.example https://site.example");
  // Another port is another host: only that port, never every port of the name.
  assert.equal(policyOf(["site.example:8443"], false), "connect-src http://site.example:8443 https://site.example:8443 ws://site.example:8443 wss://site.example:8443; form-action 'none'; frame-src http://site.example:8443 https://site.example:8443");
  assert.match(policyOf(["site.example"], true), /script-src 'unsafe-inline' 'unsafe-eval' http:\/\/site\.example https:\/\/site\.example/);
});

test("what the page wrote into its address is read back, encoded or not", () => {
  const value = { v: 1, done: true, steps: [{ i: 1, c: "click", ok: true, note: null }], guard: [{ kind: "method", method: "POST", url: "https://site.example/submit" }] };
  const encoded = `file:///Users/lume/p.html#loep-played=${encodeURIComponent(JSON.stringify(value))}`;
  assert.deepEqual(playedOf(encoded), { done: true, steps: value.steps, guard: value.guard });
  assert.deepEqual(playedOf(`file:///p.html#loep-played=${JSON.stringify(value)}`)?.steps, value.steps);
  assert.equal(playedOf("file:///p.html"), null);
  assert.equal(playedOf(null), null);
  assert.equal(playedOf("file:///p.html#loep-played=%7Bnot"), null);
  assert.deepEqual(guardLines(playedOf(encoded)), ["verzoek tegengehouden: POST https://site.example/submit"]);
});

/** A guest for the status: what lume says, and what the guest answers to the question when it booted and when it was warmed up. */
function statusGuest(state: GuestState, answer: string | null): Guest {
  return { state: async () => state, boot: async () => undefined, halt: async () => undefined, exec: async () => answer };
}

test("what the page says about its own scripts becomes one line: all there, or what is missing and that the reading proves nothing", () => {
  const played = (page: object): ReturnType<typeof playedOf> => playedOf(`file:///p.html#loep-played=${encodeURIComponent(JSON.stringify({ done: true, steps: [], guard: [], page }))}`);
  assert.deepEqual(loadedLine(played({ custom: 12, undefined: 0, names: [], scripts: [] })), { scripts: "Safari kon elk script van de pagina ophalen, en de 12 custom elements op de pagina zijn gedefinieerd" });
  const missing = loadedLine(played({ custom: 12, undefined: 3, names: ["app-button", "app-list"], scripts: [{ url: "https://site.example/app.js", module: false }, { url: "https://site.example/more.js", module: false }] })).notLoaded!;
  assert.match(missing, /^3 van de 12 custom elements zijn in Safari niet gedefinieerd \(app-button, app-list\); Safari kon 2 scripts niet ophalen \(https:\/\/site\.example\/app\.js, https:\/\/site\.example\/more\.js\)\. /);
  assert.doesNotMatch(missing, /CORS/);
  // Elements nobody defined while every script came: a site may use such names as they are. No alarm, but it is said.
  const plain = loadedLine(played({ custom: 4, undefined: 4, names: ["app-root", "app-header"], scripts: [] }));
  assert.equal(plain.notLoaded, undefined);
  assert.match(plain.scripts!, /^Safari kon elk script van de pagina ophalen\. 4 van de 4 custom elements zijn in Safari niet gedefinieerd \(app-root, app-header\)\. /);
  // A script the policy of a strict run kept out is not one Safari failed to fetch.
  const held = loadedLine(played({ custom: 0, undefined: 0, names: [], scripts: [{ url: "https://elders.example/lib.js", module: true, held: true }] })).notLoaded!;
  assert.match(held, /^de proefpagina hield 1 script van buiten de scope van de run tegen \(https:\/\/elders\.example\/lib\.js\)\. /);
  assert.doesNotMatch(held, /niet ophalen|CORS/);
  // An answer of a test page of before this was written: nothing is said.
  assert.deepEqual(loadedLine(playedOf('file:///p.html#loep-played={"done":true,"steps":[],"guard":[]}')), {});
  assert.deepEqual(loadedLine(null), {});
});

test("status: VoiceOver reads only when the virtual Mac runs and was warmed up since this boot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voiceover-status-"));
  try {
    const ready = await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8 6AF54551-C4D8"), "vm", dir);
    assert.deepEqual([isReady(ready), ready.warm, ready.bootedAt], [true, true, "2025-11-15T08:00:00.000Z"]);
    assert.equal(voiceoverWarningNl(ready), null);
    assert.match(statusNl(ready), /^draait sinds \d\d:\d\d en is opgewarmd/);
    // Warmed up before the last boot: the mark is of another boot, so it does not count. Why is kept, so the cause can be found.
    const cold = await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8 11111111-AAAA"), "vm", dir);
    assert.deepEqual([isReady(cold), cold.notWarm], [false, "otherBoot"]);
    assert.match(voiceoverWarningNl(cold) ?? "", /^LET OP: de virtuele Mac met VoiceOver draait sinds \d\d:\d\d maar is niet opgewarmd \(het merkteken van de opwarming is van een eerdere start\).*loep voiceover start/);
    // Never warmed up: no mark at all.
    const unmarked = await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8"), "vm", dir);
    assert.deepEqual([isReady(unmarked), unmarked.notWarm], [false, "noMark"]);
    assert.match(statusNl(unmarked), /niet opgewarmd \(er is geen merkteken van een opwarming\)/);
    // The clock of the guest was set after the warm-up, so the boot second moved: the boot is the same, and it still counts as warmed up (#596).
    const clockSet = await voiceoverStatus(statusGuest("running", "1763193603 6AF54551-C4D8 6AF54551-C4D8"), "vm", dir);
    assert.deepEqual([isReady(clockSet), clockSet.notWarm], [true, undefined]);
    // Running, but no answer over ssh: still booting or stuck.
    assert.match(statusNl(await voiceoverStatus(statusGuest("running", null), "vm", dir)), /geeft geen antwoord: hij start nog op of hangt/);
    // Not set up: no warning, since a run without VoiceOver is as it was.
    assert.equal(voiceoverWarningNl(await voiceoverStatus(statusGuest("absent", null), "vm", dir)), null);
    assert.equal(voiceoverWarningNl(await voiceoverStatus(statusGuest("no-lume", null), "vm", dir)), null);
    assert.match(voiceoverWarningNl(await voiceoverStatus(statusGuest("stopped", null), "vm", dir)) ?? "", /is ingericht maar draait niet\. Start hem met loep voiceover start/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status: a start in the background leaves word while it runs, and a failed start is still seen afterwards", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voiceover-status-"));
  try {
    let during: Awaited<ReturnType<typeof voiceoverStatus>> | null = null;
    const failed = await recordedStart(async () => {
      during = await voiceoverStatus(statusGuest("running", null), "vm", dir);
      return { ok: false, boots: 3, seconds: 1500, attempts: [], error: "opwarmen mislukt na drie starts" };
    }, "vm", dir);
    assert.equal(failed.ok, false);
    assert.equal(during!.starting?.pid, process.pid);
    assert.match(statusNl(during!), /wordt gestart sinds \d\d:\d\d \(loep voiceover start, proces \d+\)/);
    const after = await voiceoverStatus(statusGuest("stopped", null), "vm", dir);
    assert.equal(after.starting, undefined);
    assert.deepEqual([after.lastStart?.ok, after.lastStart?.error], [false, "opwarmen mislukt na drie starts"]);
    assert.match(voiceoverWarningNl(after) ?? "", /de laatste start, om \d\d:\d\d, mislukte: opwarmen mislukt na drie starts/);
    // A start that throws is recorded as failed too.
    await assert.rejects(recordedStart(async () => { throw new Error("lume weg"); }, "vm", dir));
    assert.match((await voiceoverStatus(statusGuest("stopped", null), "vm", dir)).lastStart?.error ?? "", /de start brak af: lume weg/);
    // A start file left by a process that is gone does not count as a start that runs.
    writeFileSync(join(dir, "vm.starting.json"), JSON.stringify({ pid: 2 ** 22 + 12345, since: "2026-11-15T08:00:00Z" }));
    assert.equal((await voiceoverStatus(statusGuest("stopped", null), "vm", dir)).starting, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a look at the state warms a running guest up by itself, once, and not right after a start that failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voiceover-status-"));
  try {
    const cold = await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8 11111111-AAAA"), "vm", dir);
    assert.equal(warmUpDue(cold), true);
    assert.match(voiceoverWarningNl(cold, true) ?? "", /niet opgewarmd \(het merkteken van de opwarming is van een eerdere start\), dus VoiceOver leest niet voor\. loep warmt hem nu op de achtergrond op, meestal in een minuut; tot dan lezen agents niet voor met VoiceOver$/);
    // A start that runs, set off by another look: not a second one.
    markStarting(process.pid, "vm", dir);
    assert.equal(warmUpDue(await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8 11111111-AAAA"), "vm", dir)), false);
    rmSync(join(dir, "vm.starting.json"));
    // Warm, stopped, or not answering: nothing to warm up from here. A stopped guest takes a boot, and that is for whoever leads.
    assert.equal(warmUpDue(await voiceoverStatus(statusGuest("running", "1763193600 6AF54551-C4D8 6AF54551-C4D8"), "vm", dir)), false);
    assert.equal(warmUpDue(await voiceoverStatus(statusGuest("stopped", null), "vm", dir)), false);
    assert.equal(warmUpDue(await voiceoverStatus(statusGuest("running", null), "vm", dir)), false);
    // A start failed ten minutes ago: not again by itself. After half an hour it is.
    const failedAt = new Date("2026-11-15T20:00:00Z");
    const afterFailure = { ...cold, lastStart: { ok: false, at: failedAt.toISOString(), error: "opwarmen mislukt" } };
    assert.equal(warmUpDue(afterFailure, new Date(failedAt.getTime() + 10 * 60_000)), false);
    assert.equal(warmUpDue(afterFailure, new Date(failedAt.getTime() + 31 * 60_000)), true);
    assert.equal(warmUpDue({ ...cold, lastStart: { ok: true, at: failedAt.toISOString() } }, new Date(failedAt.getTime() + 60_000)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the boot second is the seconds of kern.boottime, as reader.js writes it, not the microseconds after it", async () => {
  const { execFileSync } = await import("node:child_process");
  const line = "{ sec = 1794713662, usec = 745489 } Sat Nov 14 19:34:22 2026";
  assert.equal(execFileSync("sh", ["-c", `echo '${line}' | ${FIRST_NUMBER}`], { encoding: "utf8" }).trim(), "1794713662");
  // reader.js reads it with the first match of /sec = (\d+)/.
  assert.equal(/sec = (\d+)/.exec(line)?.[1], "1794713662");
});

/** A guest lume calls running that gives no answer over ssh, with what the port of ssh says from this process. */
function silentGuest(reach: Omit<Reach, "state">) {
  const guest = { state: "running" as GuestState, boots: 0, halts: 0, commands: [] as string[], reaches: 0 };
  const api: Guest = {
    state: async () => guest.state,
    boot: async () => void ((guest.boots += 1), (guest.state = "running")),
    halt: async () => void ((guest.halts += 1), (guest.state = "stopped")),
    exec: async (command) => (guest.commands.push(command), null),
    reach: async () => ((guest.reaches += 1), { state: guest.state, ...reach }),
  };
  return { guest, api };
}

test("start: a guest the host keeps this process from ends the start at once, with the setting to look at, and is not booted again", async () => {
  const refused = { address: "192.0.2.7", port22: "EHOSTUNREACH" };
  // Running already: nothing to wait for.
  const ran = silentGuest(refused);
  const clock = fakeClock();
  const lines: string[] = [];
  const started = await start(ran.api, (line) => lines.push(line), clock, () => Buffer.from(""));
  assert.equal(started.ok, false);
  assert.match(started.error!, /niet bereikbaar/);
  assert.match(started.error!, /poort 22 van 192\.0\.2\.7 geeft "No route to host"/);
  assert.match(started.error!, /Privacy en beveiliging > Lokaal netwerk/);
  assert.doesNotMatch(started.error!, /bureaublad|automatisch in/);
  assert.equal(clock.slept, 0, "no wait for a desktop that cannot be seen");
  assert.equal(ran.guest.boots, 0);
  assert.equal(ran.guest.halts, 0, "the guest is fine and stays up");
  assert.ok(!ran.guest.commands.some((command) => command.includes("shutdown")));
  assert.deepEqual(started.attempts, ["start 1: de host weigert het verkeer naar de virtuele Mac"]);
  assert.ok(lines.some((line) => line.includes("Lokaal netwerk")));

  assert.match(started.error!, /loep voiceover stop/, "the way out when the setting is on and the guest hangs");

  // Booted here: a guest that boots has no network yet, so it gets the whole wait a boot may take.
  const booted = silentGuest(refused);
  booted.guest.state = "stopped";
  const second = fakeClock();
  const again = await start(booted.api, () => undefined, second, () => Buffer.from(""));
  assert.match(again.error!, /Lokaal netwerk/);
  assert.equal(booted.guest.boots, 1, "one boot, not three");
  assert.equal(booted.guest.halts, 0);
  assert.equal(second.slept, LIMITS.desktopSeconds * 1000);
  assert.equal(booted.guest.reaches, 1, "the port is not tried before the guest had time to come up");
});

test("start: a guest booted here that has no route for its first minutes and then comes up is warmed up, not called refused", async () => {
  const { guest, api } = fakeGuest();
  const clock = fakeClock();
  let up = Infinity;
  let reaches = 0;
  const slow: Guest = {
    ...api,
    boot: async () => (await api.boot(), void (up = clock.now() + 150_000)),
    exec: async (command, seconds) => (clock.now() < up ? null : api.exec(command, seconds)),
    reach: async () => ((reaches += 1), { state: guest.state, address: "192.0.2.7", port22: clock.now() < up ? "EHOSTUNREACH" : "open" }),
  };
  const started = await start(slow, () => undefined, clock, files);
  assert.equal(started.ok, true, started.error);
  assert.equal(guest.boots, 1);
  assert.equal(reaches, 0);
});

test("start: a guest that gives no answer over ssh is not called a guest without a desktop, and what port 22 said is told", async () => {
  for (const [reach, told] of [
    [{ address: "192.0.2.7", port22: "open" }, /geen antwoord over ssh binnen 240 seconden; poort 22 van 192\.0\.2\.7 neemt wel een verbinding aan/],
    [{ address: "192.0.2.7", port22: "ECONNREFUSED" }, /geen antwoord over ssh binnen 240 seconden; een verbinding naar poort 22 van 192\.0\.2\.7 geeft ECONNREFUSED/],
    [{ address: "192.0.2.7", port22: "timeout" }, /geen antwoord over ssh binnen 240 seconden; poort 22 van 192\.0\.2\.7 neemt binnen 5 seconden geen verbinding aan/],
    [{ address: null, port22: null }, /geen antwoord over ssh binnen 240 seconden; lume geeft geen adres voor de virtuele Mac/],
  ] as const) {
    const { guest, api } = silentGuest(reach);
    const started = await start(api, () => undefined, fakeClock(), () => Buffer.from(""));
    assert.equal(started.ok, false);
    assert.equal(started.attempts.length, LIMITS.boots, "another boot can help here, so it is tried");
    for (const attempt of started.attempts) {
      assert.match(attempt, told);
      assert.doesNotMatch(attempt, /bureaublad/);
    }
    assert.equal(guest.boots, LIMITS.boots - 1);
  }
  // No route to a guest lume does not call running is not the host refusing.
  assert.equal(hostRefuses({ state: "stopped", address: "192.0.2.7", port22: "EHOSTUNREACH" }), false);
  // A guest that answers but shows no Dock keeps the message about the desktop, and the port is not tried.
  const { guest, api } = fakeGuest({ noDesktopOnBoot: [1, 2, 3] });
  const started = await start(api, () => undefined, fakeClock(), () => Buffer.from(""));
  assert.match(started.attempts[0]!, /geen bureaublad binnen 240 seconden/);
  assert.equal(guest.boots, LIMITS.boots);
});

test("the guest of lume tries port 22 of the address lume get gives, and passes on what the connection said", async () => {
  const asked: string[] = [];
  const tools = (get: string, connect: string) => ({
    lume: async () => ({ stdout: get }),
    connect: async (address: string, port: number) => (asked.push(`${address}:${port}`), connect),
  });
  const running = JSON.stringify([{ name: "vm", status: "running", ipAddress: "192.0.2.7" }]);
  const reach = await lumeGuest("vm", tools(running, "EHOSTUNREACH")).reach!();
  assert.deepEqual(reach, { state: "running", address: "192.0.2.7", port22: "EHOSTUNREACH" });
  assert.equal(hostRefuses(reach), true);
  assert.deepEqual(asked, ["192.0.2.7:22"]);
  assert.equal(await lumeGuest("vm", tools(running, "open")).state(), "running");
  // A guest without an address: nothing to connect to.
  assert.deepEqual(await lumeGuest("vm", tools(JSON.stringify([{ name: "vm", status: "stopped", ipAddress: null }]), "open")).reach!(), { state: "stopped", address: null, port22: null });
  assert.equal(asked.length, 1);
});

test("a connection says open for a port that listens and gives the code of the error for one that does not", async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  assert.equal(await connectTo("127.0.0.1", port, 5), "open");
  server.close();
  await once(server, "close");
  assert.equal(await connectTo("127.0.0.1", port, 5), "ECONNREFUSED");
});

test("status: a running guest the host keeps this process from is said to be out of reach, with the setting to look at", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-voiceover-"));
  try {
    const status = await voiceoverStatus(silentGuest({ address: "192.0.2.7", port22: "EHOSTUNREACH" }).api, "vm", dir);
    assert.deepEqual(status.refused, { state: "running", address: "192.0.2.7", port22: "EHOSTUNREACH" });
    assert.equal(isReady(status), false);
    assert.match(statusNl(status), /^draait maar is vanuit dit proces niet bereikbaar: .*Privacy en beveiliging > Lokaal netwerk/);
    // While a start runs the guest may still boot: the port says nothing then.
    markStarting(process.pid, "vm", dir);
    const starting = await voiceoverStatus(silentGuest({ address: "192.0.2.7", port22: "EHOSTUNREACH" }).api, "vm", dir);
    assert.equal(starting.refused, undefined);
    assert.match(statusNl(starting), /^wordt gestart/);
    rmSync(join(dir, "vm.starting.json"));
    // Silent for another reason: as before.
    const silent = await voiceoverStatus(silentGuest({ address: "192.0.2.7", port22: "open" }).api, "vm", dir);
    assert.equal(silent.refused, undefined);
    assert.match(statusNl(silent), /geeft geen antwoord: hij start nog op of hangt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
