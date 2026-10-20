import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { screenReaderUse } from "../src/commands/evaluate.ts";
import { setupLines } from "../src/commands/voiceover.ts";
import { speechDifferences } from "../src/instruments/methods/speech.ts";
import { GUEST_VERSION, METHODS, toolStatus } from "../src/instruments/methods/registry.ts";
import { MEASURE_COMMANDS } from "../src/lib/verdict.ts";
import { addressFor, COPIED_FILES, framed, GuestQueue, job, LIMITS, read, readingOf, shutdown, SILENT_NOTE, start, VOICEOVER, VOICEOVER_NOTE, type Clock, type Guest, type GuestAnswer, type GuestState, type Versions } from "../src/lib/voiceover.ts";
import { guardLines, planSteps, playedOf, policyOf, testPage } from "../src/lib/voiceover-page.ts";
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

  const refused = planSteps([step("click"), step("tab", ["2"], {}, null), step("key", ["Shift+Tab"], {}, null), step("goto", ["https://example.test/b"], {}, null), step("press", [], { hold: true })]).unplayable;
  assert.deepEqual(refused.map((entry) => [entry.step, entry.command]), [[2, "tab"], [3, "key"], [4, "goto"], [5, "press"]]);
  assert.match(refused[0]!.reason, /Tab verplaatst de focus/);
  assert.match(refused[2]!.reason, /naar een andere pagina/);
});

test("the test page keeps the page and puts a base, a policy and the script at the top; the page's own base stays the base", () => {
  const page = testPage({ html: '<!doctype html><html lang="nl"><head><meta charset="windows-1252"><base href="/sub/"><title>T</title></head><body><a href="x">x</a></body></html>', url: "https://site.example/a/b.html", steps: [], hosts: ["site.example"], strict: false, noMailto: true });
  assert.match(page, /^<!doctype html><html lang="nl"><head><meta charset="utf-8"><base href="https:\/\/site\.example\/sub\/"><meta http-equiv="Content-Security-Policy" content="[^"]*form-action 'none'[^"]*"><script>\(function \(config\)/);
  assert.equal((page.match(/<base /g) ?? []).length, 1, "the page's own base is replaced by the resolved one");
  assert.match(page, /"noMailto":true/);
  assert.match(page, /<title>T<\/title><\/head><body><a href="x">x<\/a>/);
  // A step with text that could end the script cannot.
  assert.doesNotMatch(testPage({ html: "<p>x</p>", url: "https://site.example/", steps: [{ command: "select", how: "select", target: null, value: "</script><b>" }], hosts: [], strict: false }), /<\/script><b>/);
  assert.equal(policyOf(["site.example"], false), "connect-src http://site.example:* https://site.example:* ws://site.example:* wss://site.example:*; form-action 'none'; frame-src http://site.example:* https://site.example:*");
  assert.match(policyOf(["site.example"], true), /script-src 'unsafe-inline' 'unsafe-eval' http:\/\/site\.example:\* https:\/\/site\.example:\*/);
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
