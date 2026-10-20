import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFixture, type FixtureServer } from "../fixtures/serve.ts";
import { compareSpeech, countFlashes, nearly, notSpoken, parseWebVtt, pictureOf, probeMedia, saidAt, soundOf, soundWithoutSpeech, stillTimes, words } from "../src/instruments/methods/listen.ts";
import { binary, binaryCommand, modelOf, modelSha256, whisperModel } from "../src/instruments/methods/registry.ts";
import { Daemon } from "../src/session/daemon.ts";
import { SPEECH_MARGIN } from "../src/session/media-command.ts";
import type { Observation } from "../src/session/observations.ts";
import { guardedDownload, type Blocked, type Guard, type Scope } from "../src/session/safety.ts";

let fixture: FixtureServer;
let run: string;
let daemon: Daemon;

before(async () => {
  run = mkdtempSync(join(tmpdir(), "loep-listen-"));
  fixture = await startFixture({ ports: { defect: 0, clean: 0, thirdParty: 0 }, logFile: join(run, "server.log") });
  daemon = await Daemon.create(run, { hosts: [new URL(fixture.origins.clean).host, new URL(fixture.origins.defect).host], baseUrl: `${fixture.origins.clean}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
});

after(async () => {
  delete process.env.LOEP_WHISPER;
  await daemon.close();
  await fixture.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await daemon.handle({ op: "command", session: "main", command, args: args.map(String), options });
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

interface Listened {
  agreement: string;
  differences: string[];
  methods: { implementation: string; result: unknown }[];
  failed: { implementation: string; kind: string; reason: string }[];
  file: { bytes: number; sha256: string; truncated: string | null } | null;
  tracks: { kind: string; language: string; cues: { from: number; to: number; text: string }[] | null }[];
  comparisons: { track: string; spokenWords: number; coverage: number | null; heard: number | null; offsetSeconds: { median: number } | null; wordErrors: { substituted: number; omitted: number; inserted: number; rate: number } | null }[];
  section: { text: string; comparison: { coverage: number | null } | null };
  stills: { atSeconds: number; image: string; sha256: string; text: string | null; said: string | null }[];
  flashes: { quarterOfPicture: { perSecond: number }; note: string } | null;
}

function observation(id: string): Observation & { result: Listened } {
  const [session, nr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  return JSON.parse(readFileSync(join(run, "observations", session, `${nr}.json`), "utf8")) as Observation & { result: Listened };
}

test("WebVTT is read as cues: time and text, without header, notes, numbers and markup", () => {
  const cues = parseWebVtt("﻿WEBVTT - titel\r\n\r\nNOTE dit is geen cue\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n1\r\n00:01.000 --> 00:03.500 align:start\r\n<v Voorzitter>Welkom <i>allemaal</i></v>\r\nop twee regels &amp; meer\r\n\r\n01:00:02.000 --> 01:00:04.250\r\n[applaus]\r\n");
  assert.deepEqual(cues, [
    { from: 1, to: 3.5, text: "Welkom allemaal op twee regels & meer" },
    { from: 3602, to: 3604.25, text: "[applaus]" },
  ]);
  // SubRip writes its times with a comma.
  assert.deepEqual(parseWebVtt("1\n00:00:01,000 --> 00:00:02,000\nHallo\n"), [{ from: 1, to: 2, text: "Hallo" }]);
  assert.deepEqual(parseWebVtt("WEBVTT\n"), []);
});

test("two texts are compared word by word, with room for what recognition gets wrong", () => {
  assert.deepEqual(words("De Raad stemt: 14 vóór, vijf tegen!"), ["de", "raad", "stemt", "14", "voor", "5", "tegen"]);
  assert.equal(nearly("begroting", "begrooting"), true);
  assert.equal(nearly("raad", "rood"), false);
  assert.equal(nearly("de", "die"), false);
  const speech = [
    { from: 0, to: 3, text: "Welkom bij de Raads vergadering van donderdag 12 maart." },
    { from: 3, to: 7, text: "Op het scherm staat de ajenda en de begroting." },
    { from: 7, to: 10, text: "Dit stuk staat in geen enkele ondertitel hoor." },
  ];
  const cues = [
    { from: 1, to: 4, text: "Welkom bij de raadsvergadering van donderdag twaalf maart." },
    { from: 4, to: 8, text: "Op het scherm staat de agenda en de begroting." },
    { from: 8, to: 9, text: "[muziek]" },
  ];
  const compared = compareSpeech(speech, cues);
  // A word split in two, a number in digits and a wrong letter all count as the same word; the third piece has no subtitle.
  assert.equal(compared.spokenWords, 26);
  assert.equal(compared.coverage, 0.69);
  assert.equal(compared.heard, 1);
  assert.deepEqual(compared.uncovered.map((piece) => piece.from), [7]);
  assert.deepEqual(compared.unheard, []);
  assert.equal(compared.offsetSeconds?.median, 1);
  // The word error rate on the same pairing, with the speech as reference: the eight words of the third piece are in no subtitle, nothing was replaced or added.
  assert.deepEqual(compared.wordErrors, { substituted: 0, omitted: 8, inserted: 0, rate: 0.31 });
  // A word that was replaced, one that was left out and one that was added, on eleven spoken words.
  const said = [{ from: 0, to: 5, text: "De raad stemt vandaag over de nieuwe begroting van volgend jaar" }];
  assert.deepEqual(compareSpeech(said, [{ from: 0, to: 5, text: "De raad praat vandaag over nieuwe begroting van het volgend jaar" }]).wordErrors, { substituted: 1, omitted: 1, inserted: 1, rate: 0.27 });
  assert.deepEqual(compareSpeech(said, said).wordErrors, { substituted: 0, omitted: 0, inserted: 0, rate: 0 });
  assert.equal(compareSpeech([], cues).wordErrors, null);
  // Against a text without times there is a share and no shift.
  const onPage = compareSpeech(speech.slice(0, 2), "Voorzitter: Welkom bij de raadsvergadering van donderdag twaalf maart. Op het scherm staat de agenda en de begroting.");
  assert.equal(onPage.coverage, 1);
  assert.equal(onPage.offsetSeconds, null);
  assert.equal(compareSpeech([], cues).coverage, null);
  assert.ok(compareSpeech(speech.slice(0, 2), "Een heel andere tekst over het ophalen van afval in de wijk.").coverage! < 0.3);
  assert.equal(saidAt(speech, 5), speech[1]!.text);
  assert.equal(saidAt(speech, 14), null);
  assert.deepEqual(notSpoken("Raadsvergadering 12 maart Begroting aangenomen", speech), ["aangenomen"]);
});

test("flashes are counted per part of the picture in the busiest second", () => {
  const parts = 8;
  const fps = 25;
  // Three seconds: the left half turns from dark to light and back every four pictures, the right half stays grey.
  const frames = new Uint8Array(parts * fps * 3);
  for (let frame = 0; frame < fps * 3; frame++) for (let part = 0; part < parts; part++) frames[frame * parts + part] = part < 4 ? (frame % 4 < 2 ? 235 : 16) : 128;
  const flashing = countFlashes(frames, parts, fps);
  assert.equal(flashing.quarterOfPicture.perSecond, 6);
  assert.equal(flashing.anyPart.perSecond, 6);
  assert.equal(flashing.secondsMeasured, 3);
  // One part in eight is less than a quarter of the picture.
  const small = frames.map((value, index) => (index % parts === 0 ? value : 128));
  assert.equal(countFlashes(small, parts, fps).quarterOfPicture.perSecond, 0);
  assert.equal(countFlashes(small, parts, fps).anyPart.perSecond, 6);
  // A slow fade and a change of less than a tenth of the luminance are not flashes.
  const calm = new Uint8Array(parts * fps * 3).map((_, index) => 100 + (Math.floor(index / parts) % 2) * 8);
  assert.equal(countFlashes(calm, parts, fps).anyPart.perSecond, 0);
  const fade = new Uint8Array(parts * fps * 3).map((_, index) => Math.floor(index / parts) * 3);
  assert.equal(countFlashes(fade, parts, fps).anyPart.perSecond, 0);
});

test("still pictures follow the changes of scene and fill what is left", () => {
  assert.deepEqual(stillTimes(12, [], 8), [0.5, 3.4, 6.3, 9.2]);
  assert.deepEqual(stillTimes(12, [4, 8], 8), [0.5, 4.3, 6.3, 8.3]);
  const many = stillTimes(600, Array.from({ length: 40 }, (_, index) => 10 + index * 14), 8);
  assert.equal(many.length, 8);
  assert.deepEqual(many, [...many].sort((a, b) => a - b));
  // Sound that is not silence and not speech.
  const sound = { seconds: 10, silences: [{ from: 6, to: 8 }], soundSeconds: 8, silentSeconds: 2, maxVolumeDb: -3, meanVolumeDb: -20 };
  assert.deepEqual(soundWithoutSpeech(sound, [{ from: 0, to: 3, text: "hallo" }]), [{ from: 3, to: 6 }, { from: 8, to: 10 }]);
});

test("a file is fetched under the rules of the session, or not at all", async () => {
  const guard: Guard = { blocked: [], outsideScopeLoaded: {} };
  const inside: Scope = { hosts: [new URL(fixture.origins.clean).host], baseUrl: null, strict: false };
  const to = join(run, "fetched");
  const whole = await guardedDownload(inside, guard, `${fixture.origins.clean}/media/raadsvergadering.vtt`, to, { resourceType: "texttrack", maxBytes: 1_000_000, timeoutMs: 5000 });
  assert.deepEqual(whole.ok && [whole.bytes, whole.truncated], [statSync(to).size, null]);
  assert.match(readFileSync(to, "utf8"), /^WEBVTT/);
  const part = await guardedDownload(inside, guard, `${fixture.origins.clean}/media/raadsvergadering.webm`, to, { resourceType: "media", maxBytes: 1000, timeoutMs: 5000 });
  assert.deepEqual(part.ok && [part.bytes, part.truncated, statSync(to).size], [1000, "size", 1000]);
  assert.deepEqual(await guardedDownload(inside, guard, `${fixture.origins.clean}/media/bestaat-niet.webm`, to, { resourceType: "media", maxBytes: 1000, timeoutMs: 5000 }), { ok: false, reason: "de server antwoordt met 404" });
  assert.match(((await guardedDownload(inside, guard, "blob:http://127.0.0.1/abc", to, { resourceType: "media", maxBytes: 1000, timeoutMs: 5000 })) as { reason: string }).reason, /^het adres begint met blob:/);
  assert.deepEqual(guard.blocked, []);
  // A host outside the scope: a text track is refused as the browser refuses it, and so is everything under a strict scope. Nothing is sent.
  const elsewhere: Scope = { hosts: ["voorbeeld.invalid"], baseUrl: null, strict: false };
  const track = await guardedDownload(elsewhere, guard, `${fixture.origins.thirdParty}/media/x.vtt`, to, { resourceType: "texttrack", maxBytes: 1000, timeoutMs: 5000 });
  assert.deepEqual(track, { ok: false, reason: "127.0.0.1 ligt buiten de scope van de run" });
  const strict = await guardedDownload({ ...elsewhere, strict: true }, guard, `${fixture.origins.clean}/media/raadsvergadering.webm`, to, { resourceType: "media", maxBytes: 1000, timeoutMs: 5000 });
  assert.equal(strict.ok, false);
  assert.deepEqual((guard.blocked as Blocked[]).map((entry) => [entry.kind, entry.method, entry.resourceType]), [["scope", "GET", "texttrack"], ["scope", "GET", "media"]]);
  // Media a page names may come from elsewhere when the scope is not strict, and is counted.
  const named = await guardedDownload(elsewhere, guard, `${fixture.origins.clean}/media/raadsvergadering.webm`, to, { resourceType: "media", maxBytes: 1000, timeoutMs: 5000 });
  assert.equal(named.ok, true);
  assert.deepEqual(guard.outsideScopeLoaded, { "127.0.0.1": 1 });
});

test("ffmpeg reads the tracks, the silence and the flashes of a file it made itself", async (context) => {
  if (!(await binary("ffmpeg")).available) return context.skip("geen ffmpeg op deze machine");
  const dir = mkdtempSync(join(tmpdir(), "loep-listen-made-"));
  try {
    const make = (name: string, picture: string): string => {
      const path = join(dir, name);
      // One and a half seconds of a tone, then silence, under three seconds of picture.
      execFileSync(binaryCommand("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", picture, "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5,apad=whole_dur=3", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", "-shortest", path]);
      return path;
    };
    const flashing = make("flashing.mp4", "color=c=black:s=160x90:r=25:d=3,geq=lum='if(lt(mod(N,4),2),235,16)':cb=128:cr=128");
    const calm = make("calm.mp4", "color=c=gray:s=160x90:r=25:d=3");
    const streams = await probeMedia(flashing);
    assert.deepEqual([streams.video.map((track) => [track.codec, track.width, track.height]), streams.audio.map((track) => track.codec), streams.subtitles], [[["mpeg4", 160, 90]], ["aac"], []]);
    assert.ok(Math.abs(streams.durationSeconds! - 3) < 0.2);
    const sound = await soundOf(flashing, streams.durationSeconds);
    assert.equal(sound.silences.length, 1);
    assert.ok(Math.abs(sound.silences[0]!.from - 1.5) < 0.2 && Math.abs(sound.soundSeconds - 1.5) < 0.2, JSON.stringify(sound));
    const seen = await pictureOf(flashing, dir);
    assert.ok(seen.flashes.quarterOfPicture.perSecond >= 5, JSON.stringify(seen.flashes));
    assert.equal((await pictureOf(calm, dir)).flashes.anyPart.perSecond, 0);
    await assert.rejects(probeMedia(join(dir, "bestaat-niet.mp4")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media --listen without speech recognition still reads the tracks and the file", async (context) => {
  if (!(await binary("ffmpeg")).available) return context.skip("geen ffmpeg op deze machine");
  process.env.LOEP_WHISPER = join(run, "geen-whisper");
  try {
    await loep("open", [`${fixture.origins.clean}/raadsvergadering.html`]);
    const video = Number(((await loep("find", ["css:video"])).found as string[])[0]!.split(" ")[0]);
    const listened = await loep("media", [video], { listen: true, wait: true });
    assert.equal(listened.media, "video 11.9s; beeld vp8 640x360, geluid opus");
    assert.deepEqual(listened.tracks, ["captions nl: 3 cues"]);
    assert.equal(listened.speech, undefined);
    assert.equal(listened.captions, undefined);
    assert.match((listened.noAnswer as string[])[0]!, /^whisper: niet beschikbaar, installeer whisper\.cpp/);
    assert.match(listened.flashes as string, /^0 per seconde over een kwart van het beeld.*benadering, geen gecertificeerde analyse$/);
    const record = observation(listened.id);
    assert.deepEqual(record.result.failed.map((failure) => [failure.implementation, failure.kind]), [["whisper.cpp", "unavailable"]]);
    assert.equal(record.result.tracks[0]!.cues![0]!.text, "Welkom bij de raadsvergadering van donderdag twaalf maart.");
    assert.match(record.result.flashes!.note, /geen gecertificeerde analyse/);
    // The pictures and the subtitle file are kept with the observation, each with its hash.
    assert.equal(record.result.stills.length, 4);
    for (const still of record.result.stills) assert.equal(record.images.find((image) => image.path === still.image)?.sha256, still.sha256);
    assert.ok(record.images.some((image) => image.path.endsWith("-track-1.vtt")));
    assert.equal(record.result.file!.truncated, null);
    assert.deepEqual(record.blocked, []);
    const tools = await loep("tools");
    assert.ok((tools.unavailable as string[]).some((line) => line.startsWith("whisper: installeer whisper.cpp")));
    // An element that is not audio or video, and the command without an element.
    const heading = Number(((await loep("find", ["css:h1"])).found as string[])[0]!.split(" ")[0]);
    assert.match(String((await daemon.handle({ op: "command", session: "main", command: "media", args: [String(heading)], options: { listen: true } })).print.error), /geen audio of video/);
    assert.match(String((await daemon.handle({ op: "command", session: "main", command: "media", args: [], options: { listen: true } })).print.error), /vraagt een ref/);
  } finally {
    delete process.env.LOEP_WHISPER;
  }
});

test("the sha256 of a model file is that of the file as it is now, and is read back from the version of a measurement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-model-"));
  try {
    const path = join(dir, "ggml-test.bin");
    writeFileSync(path, "abc");
    assert.equal(await modelSha256(path), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Another file under the same name is another model.
    writeFileSync(path, "abcd");
    assert.equal(await modelSha256(path), createHash("sha256").update("abcd").digest("hex"));
    assert.deepEqual(modelOf(`1.9.5 ggml-test.bin sha256:${"a".repeat(64)}`), { name: "ggml-test.bin", sha256: "a".repeat(64) });
    // A measurement from before the hash was kept names the model only.
    assert.equal(modelOf("1.7.6 ggml-small.bin"), null);
    assert.equal(modelOf(null), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media --listen sets the speech next to the subtitles and the text of the page", async (context) => {
  if (!(await binary("ffmpeg")).available) return context.skip("geen ffmpeg op deze machine");
  if (!(await binary("whisper")).available) return context.skip("geen whisper.cpp of geen model op deze machine");
  const find = async (query: string): Promise<number> => Number(((await loep("find", [query])).found as string[])[0]!.split(" ")[0]);
  // The clean variant: subtitles and a written text that say what is said.
  await loep("open", [`${fixture.origins.clean}/raadsvergadering.html`]);
  const good = await loep("media", [await find("css:video")], { listen: true, wait: true });
  assert.equal(good.methods, "2 agree, 1 geen uitspraak");
  assert.equal(good.disagree, undefined);
  assert.ok(JSON.stringify(good).length < 1800, `media --listen printed ${JSON.stringify(good).length} characters`);
  const record = observation(good.id).result;
  assert.deepEqual(record.methods.map((method) => method.implementation), ["whisper.cpp", "loep", "ffmpeg"]);
  // The measurement that listened names the model and carries the sha256 of the file it was.
  const model = modelOf((record.methods[0] as unknown as { version: string }).version);
  assert.ok(model, JSON.stringify(record.methods[0]));
  assert.equal(model.name, whisperModel().split(/[\\/]/).at(-1));
  assert.equal(model.sha256, createHash("sha256").update(readFileSync(whisperModel())).digest("hex"));
  assert.ok(record.comparisons[0]!.coverage! >= SPEECH_MARGIN && record.comparisons[0]!.heard! >= SPEECH_MARGIN, JSON.stringify(record.comparisons));
  assert.ok(Math.abs(record.comparisons[0]!.offsetSeconds!.median) < 1);
  // The word error rate stands next to the counts, with what it is: an upper bound, not a judgement.
  const errors = record.comparisons[0]!.wordErrors!;
  assert.equal(errors.rate, Math.round(((errors.substituted + errors.omitted + errors.inserted) / record.comparisons[0]!.spokenWords) * 100) / 100);
  assert.ok(errors.rate <= 1 - SPEECH_MARGIN, JSON.stringify(errors));
  assert.match((good.captions as string[])[0]!, /, WER \d+% \(\d+ vervangen, \d+ weggelaten, \d+ ingevoegd\)$/);
  assert.match(good.werNote as string, /bovengrens .* geen oordeel$/);
  assert.ok(record.section.comparison!.coverage! >= SPEECH_MARGIN);
  assert.ok(record.stills.every((still) => existsSync(join(run, still.image)) && still.said !== null));
  assert.match(readFileSync(join(run, good.transcript as string), "utf8"), /^WEBVTT\n\n00:00:00\.000 --> /);
  // The variant with defects: the same kind of video without subtitles and without a written text.
  await loep("open", [`${fixture.origins.defect}/raadsvergadering.html`]);
  const bad = await loep("media", [await find("css:video")], { listen: true, wait: true });
  assert.equal(bad.tracks, "geen track bij het element");
  assert.equal(bad.methods, "2 disagree, 1 geen uitspraak");
  assert.match((bad.disagree as string[])[0]!, /^whisper hoort spraak \(\d+ woorden\); het element heeft geen ondertitels$/);
  assert.ok(observation(bad.id).result.section.comparison!.coverage! < 0.5);
  // A sound fragment: with its words written out below it there is nothing to differ about, without them there is.
  await loep("open", [`${fixture.origins.clean}/nieuws/nieuwe-fietsenstalling.html`]);
  const written = await loep("media", [await find("css:audio")], { listen: true, wait: true });
  assert.equal(written.methods, "2 agree, 1 geen uitspraak");
  assert.match(written.pageText as string, /^\d+% van de gesproken woorden staat in de tekst rond het element/);
  await loep("open", [`${fixture.origins.defect}/nieuws/nieuwe-fietsenstalling.html`]);
  const bare = await loep("media", [await find("css:audio")], { listen: true, wait: true });
  assert.match((bare.disagree as string[])[0]!, /het element heeft geen ondertitels en \d+% ervan staat in de tekst rond het element$/);
  // Sound that plays by itself and is not speech.
  await loep("open", [`${fixture.origins.defect}/`]);
  const melody = await loep("media", [await find("css:audio")], { listen: true, wait: true });
  assert.match(melody.speech as string, /^geen spraak herkend/);
  assert.match(melody.sound as string, /^6s geluid, 0s stil, 6s geluid zonder spraak/);
  // Nothing was sent to the site.
  assert.deepEqual(fixture.writes(), []);
});
