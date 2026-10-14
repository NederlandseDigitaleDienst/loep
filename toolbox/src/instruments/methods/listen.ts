import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256File } from "../../lib/canonical.ts";
import { ocr } from "./ocr.ts";
import { binary, binaryCommand, Unavailable, whisperModel } from "./registry.ts";

const run = promisify(execFile);

/** A piece of text with the time it is said or shown, in seconds from the start of the file. */
export interface Timed {
  from: number;
  to: number;
  text: string;
}

/** Only this much of a file is listened to and looked at. */
export const MAX_MEDIA_SECONDS = 600;
/** ffmpeg reads the file that was fetched and nothing else: a playlist inside it must not make it fetch on its own. */
const LOCAL_ONLY = ["-protocol_whitelist", "file,pipe"];
const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

async function needFfmpeg(): Promise<void> {
  const found = await binary("ffmpeg");
  if (!found.available) throw new Unavailable(found.hint ?? "ffmpeg ontbreekt");
}

// ---------------------------------------------------------------------------------- WebVTT

const clock = (text: string): number => {
  const parts = text.replace(",", ".").split(":").map(Number);
  return parts.reduce((sum, part) => sum * 60 + part, 0);
};
const CUE_TIMES = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&lrm;": "", "&rlm;": "" };

/** The cues of a WebVTT file (or SubRip, which differs in the comma of its times): time and text, without markup. Blocks that are not cues are skipped. */
export function parseWebVtt(source: string): Timed[] {
  const cues: Timed[] = [];
  for (const block of source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => line.includes("-->"));
    const times = at < 0 ? null : CUE_TIMES.exec(lines[at]!);
    if (!times) continue;
    const text = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity]!)
      .replace(/\s+/g, " ")
      .trim();
    cues.push({ from: clock(times[1]!), to: clock(times[2]!), text });
  }
  return cues;
}

// ------------------------------------------------------------------------------ the tracks

export interface MediaStreams {
  container: string;
  /** Null when the file does not say, as with a stream that was cut off. */
  durationSeconds: number | null;
  audio: { codec: string; channels: number | null; language: string | null }[];
  video: { codec: string; width: number; height: number; framesPerSecond: number | null }[];
  subtitles: { codec: string; language: string | null }[];
}

interface ProbedStream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: { language?: string };
}

/** What is in a media file according to ffprobe: how long it is and which tracks of sound, picture and subtitles it holds. */
export async function probeMedia(path: string): Promise<MediaStreams> {
  await needFfmpeg();
  const { stdout } = await run(binaryCommand("ffprobe"), ["-v", "error", ...LOCAL_ONLY, "-print_format", "json", "-show_format", "-show_streams", path], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  const probed = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: ProbedStream[] };
  const streams = probed.streams ?? [];
  const duration = Number(probed.format?.duration);
  const rate = (text: string | undefined): number | null => {
    const [count, per] = (text ?? "").split("/").map(Number);
    return count && per ? round(count / per) : null;
  };
  const language = (stream: ProbedStream): string | null => (stream.tags?.language && stream.tags.language !== "und" ? stream.tags.language : null);
  return {
    container: probed.format?.format_name ?? "unknown",
    durationSeconds: Number.isFinite(duration) ? round(duration) : null,
    audio: streams.filter((stream) => stream.codec_type === "audio").map((stream) => ({ codec: stream.codec_name ?? "unknown", channels: stream.channels ?? null, language: language(stream) })),
    // The cover of a piece of music is a picture, not a video.
    video: streams.filter((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic).map((stream) => ({ codec: stream.codec_name ?? "unknown", width: stream.width ?? 0, height: stream.height ?? 0, framesPerSecond: rate(stream.avg_frame_rate) })),
    subtitles: streams.filter((stream) => stream.codec_type === "subtitle").map((stream) => ({ codec: stream.codec_name ?? "unknown", language: language(stream) })),
  };
}

/** The cues of a subtitle track that is inside the file. Null when ffmpeg cannot turn it into text, as with subtitles that are pictures. */
export async function embeddedCues(path: string, index: number): Promise<Timed[] | null> {
  try {
    const { stdout } = await run(binaryCommand("ffmpeg"), ["-v", "error", ...LOCAL_ONLY, "-t", String(MAX_MEDIA_SECONDS), "-i", path, "-map", `0:s:${index}`, "-f", "webvtt", "-"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    return parseWebVtt(stdout);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------- the sound

export interface Sound {
  /** How much of the file was listened to. */
  seconds: number;
  /** Stretches of at least half a second below the noise floor. */
  silences: { from: number; to: number }[];
  soundSeconds: number;
  silentSeconds: number;
  /** Loudest and mean level in dB below full scale; null when the track holds no samples. */
  maxVolumeDb: number | null;
  meanVolumeDb: number | null;
}

const NOISE_FLOOR_DB = -40;
const MIN_SILENCE_SECONDS = 0.5;

/** Where the sound track is silent and where it is not, from `silencedetect`, and how loud it is. */
export async function soundOf(path: string, durationSeconds: number | null): Promise<Sound> {
  const { stderr } = await run(binaryCommand("ffmpeg"), ["-hide_banner", "-nostats", ...LOCAL_ONLY, "-t", String(MAX_MEDIA_SECONDS), "-i", path, "-vn", "-map", "0:a:0", "-af", `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${MIN_SILENCE_SECONDS},volumedetect`, "-f", "null", "-"], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  const silences: { from: number; to: number }[] = [];
  let open: number | null = null;
  let heard = 0;
  for (const line of stderr.split("\n")) {
    const start = /silence_start: (-?[\d.]+)/.exec(line);
    const end = /silence_end: (-?[\d.]+)/.exec(line);
    // The closing line says how far the sound went, also when the file does not give a duration.
    const reached = /\btime=(\d+:\d+:[\d.]+)/.exec(line);
    if (reached) heard = clock(reached[1]!);
    if (start) open = Math.max(0, Number(start[1]));
    if (end && open !== null) {
      silences.push({ from: round(open), to: round(Number(end[1])) });
      open = null;
    }
  }
  const seconds = round(Math.min(MAX_MEDIA_SECONDS, Math.max(heard, durationSeconds ?? 0, ...silences.map((silence) => silence.to))));
  if (open !== null) silences.push({ from: round(open), to: seconds });
  const silentSeconds = round(silences.reduce((sum, silence) => sum + silence.to - silence.from, 0));
  const level = (name: string): number | null => {
    const found = new RegExp(`${name}: (-?[\\d.]+|-inf) dB`).exec(stderr)?.[1];
    return found === undefined ? null : found === "-inf" ? -Infinity : Number(found);
  };
  const max = level("max_volume");
  return { seconds, silences, soundSeconds: round(Math.max(0, seconds - silentSeconds)), silentSeconds, maxVolumeDb: max === -Infinity ? -91 : max, meanVolumeDb: level("mean_volume") === -Infinity ? -91 : level("mean_volume") };
}

export interface Transcript {
  /** The language the speech was recognised in: the one that was asked for, or the one whisper chose. */
  language: string;
  /** Whether the language was given or left to whisper. */
  languageFrom: "page" | "detected";
  /** What is said, piece by piece. */
  segments: Timed[];
  /** What whisper wrote down for sound that is not speech, such as "[muziek]". */
  sounds: Timed[];
  words: number;
  text: string;
}

/** A piece that is nothing but a remark between brackets is a description of a sound, not something that was said. */
const BRACKETED = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪[^♪]*♪?/g;

/**
 * What is said in a file, with times, by whisper.cpp. The sound is first made into the form
 * whisper reads (one channel, 16 kHz). `language` is a two-letter code, or null to let whisper choose.
 */
export async function transcribe(path: string, workDir: string, language: string | null): Promise<Transcript> {
  await needFfmpeg();
  const whisper = await binary("whisper");
  if (!whisper.available) throw new Unavailable(whisper.hint ?? "whisper.cpp ontbreekt");
  const wav = join(workDir, "speech.wav");
  await run(binaryCommand("ffmpeg"), ["-v", "error", "-y", ...LOCAL_ONLY, "-t", String(MAX_MEDIA_SECONDS), "-i", path, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  const out = join(workDir, "speech");
  await run(binaryCommand("whisper"), ["-m", whisperModel(), "-l", language ?? "auto", "-np", "-oj", "-of", out, "-f", wav], { timeout: 9 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const written = JSON.parse(await readFile(`${out}.json`, "utf8")) as { result?: { language?: string }; transcription?: { offsets: { from: number; to: number }; text: string }[] };
  const segments: Timed[] = [];
  const sounds: Timed[] = [];
  for (const piece of written.transcription ?? []) {
    const timed = { from: round(piece.offsets.from / 1000), to: round(piece.offsets.to / 1000), text: piece.text.trim() };
    const said = timed.text.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
    if (words(said).length > 0) segments.push({ ...timed, text: said });
    else if (timed.text !== "") sounds.push(timed);
  }
  return { language: written.result?.language ?? language ?? "unknown", languageFrom: language ? "page" : "detected", segments, sounds, words: segments.reduce((sum, segment) => sum + words(segment.text).length, 0), text: segments.map((segment) => segment.text).join(" ") };
}

/** Sound that is neither silence nor speech: the stretches that are not silent with the pieces of speech taken out. */
export function soundWithoutSpeech(sound: Sound, speech: Timed[], minSeconds = 1): { from: number; to: number }[] {
  let parts: { from: number; to: number }[] = [];
  let at = 0;
  for (const silence of [...sound.silences, { from: sound.seconds, to: sound.seconds }]) {
    if (silence.from > at) parts.push({ from: at, to: silence.from });
    at = Math.max(at, silence.to);
  }
  for (const piece of speech) parts = parts.flatMap((part) => (piece.to <= part.from || piece.from >= part.to ? [part] : [{ from: part.from, to: piece.from }, { from: piece.to, to: part.to }].filter((rest) => rest.to > rest.from)));
  return parts.filter((part) => part.to - part.from >= minSeconds).map((part) => ({ from: round(part.from), to: round(part.to) }));
}

// ---------------------------------------------------------------------- comparing two texts

const NUMBER_WORDS: Record<string, string> = Object.fromEntries(
  [
    ["nul zero", 0], ["twee two", 2], ["drie three", 3], ["vier four", 4], ["vijf five", 5], ["zes six", 6], ["zeven seven", 7], ["acht eight", 8], ["negen nine", 9], ["tien ten", 10],
    ["elf eleven", 11], ["twaalf twelve", 12], ["dertien thirteen", 13], ["veertien fourteen", 14], ["vijftien fifteen", 15], ["zestien sixteen", 16], ["zeventien seventeen", 17], ["achttien eighteen", 18], ["negentien nineteen", 19],
    ["twintig twenty", 20], ["dertig thirty", 30], ["veertig forty", 40], ["vijftig fifty", 50], ["zestig sixty", 60], ["zeventig seventy", 70], ["tachtig eighty", 80], ["negentig ninety", 90], ["honderd hundred", 100], ["duizend thousand", 1000],
  ].flatMap(([names, value]) => (names as string).split(" ").map((name) => [name, String(value)])),
);
// "een" is far more often the article than the number: it stays a word, and a written "1" is read as that word.
NUMBER_WORDS["1"] = "een";

/** The words of a text in the form two texts are compared in: lower case, without accents and punctuation, a number always in digits. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => (NUMBER_WORDS[word] ?? word).normalize("NFKD").replace(/\p{M}/gu, ""));
}

/** Whether two words differ by no more than a recognition error: one letter in a word of four or more, two in a word of eight or more. */
export function nearly(first: string, second: string): boolean {
  if (first === second) return true;
  const allowed = Math.min(first.length, second.length) >= 8 ? 2 : Math.min(first.length, second.length) >= 4 ? 1 : 0;
  if (allowed === 0 || Math.abs(first.length - second.length) > allowed) return false;
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i++) {
    const row = [i];
    for (let j = 1; j <= second.length; j++) row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (first[i - 1] === second[j - 1] ? 0 : 1)));
    previous = row;
  }
  return previous[second.length]! <= allowed;
}

/** The longest run of pairs of equal words that keeps the order of both texts. */
function alignment(first: string[], second: string[]): [number, number][] {
  const width = second.length + 1;
  const table = new Uint16Array((first.length + 1) * width);
  for (let i = first.length - 1; i >= 0; i--) for (let j = second.length - 1; j >= 0; j--) table[i * width + j] = first[i] === second[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < first.length && j < second.length; ) {
    if (first[i] === second[j]) pairs.push([i++, j++]);
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

export interface SpeechComparison {
  spokenWords: number;
  otherWords: number;
  /** The share of the spoken words that the other text has too, in the same order; null when nothing was said. */
  coverage: number | null;
  /** The share of the words of the other text that were heard; null when it has no words. */
  heard: number | null;
  /** How much later (positive) or earlier the other text shows a word than it is said: in the middle, and at its worst but for a tenth. Null for a text without times. */
  offsetSeconds: { median: number; largest: number } | null;
  /** Pieces of speech of which less than half is in the other text. */
  uncovered: Timed[];
  /** Pieces of the other text of which less than half was heard. Empty for a text without times. */
  unheard: Timed[];
  /**
   * The word error rate of the other text, with the speech as it was recognised as the reference:
   * (substituted + omitted + inserted) / spoken words, counted on the same pairing. A word that
   * the pairing takes for the same (a letter off, split differently) is no error. The recognition
   * errs too, so this is an upper bound on how far the texts are apart. Null when nothing was said.
   */
  wordErrors: { substituted: number; omitted: number; inserted: number; rate: number } | null;
}

const MAX_WORDS = 4000;

interface Token {
  word: string;
  piece: number;
  time: number | null;
}

const tokensOf = (pieces: Timed[], timed: boolean): Token[] =>
  pieces.flatMap((piece, index) => {
    const found = words(piece.text.replace(BRACKETED, " "));
    // A word is placed inside its piece by its place among the words: closer than the start of the piece, which is all that is known.
    return found.map((word, at) => ({ word, piece: index, time: timed ? piece.from + ((piece.to - piece.from) * at) / found.length : null }));
  });

/**
 * Speech as it was recognised next to another text of the same words: subtitles with their
 * times, or the text of a page without. Words are paired in order. A word that is off by a
 * letter, or written as one word here and two there, counts as the same: that is how
 * recognition errs. These are counts for whoever judges, not a judgement.
 */
export function compareSpeech(speech: Timed[], other: Timed[] | string): SpeechComparison {
  const timed = typeof other !== "string";
  const pieces = timed ? other : [{ from: 0, to: 0, text: other }];
  const spoken = tokensOf(speech, true).slice(0, MAX_WORDS);
  const written = tokensOf(pieces, timed).slice(0, MAX_WORDS);
  const pairs = alignment(spoken.map((token) => token.word), written.map((token) => token.word));
  const all: [number, number][] = [];
  // Between two pairs that are certain lie the words that did not match exactly: there the near matches are looked for.
  const gaps = [...pairs, [spoken.length, written.length] as [number, number]];
  let fromSpoken = 0;
  let fromWritten = 0;
  for (const [toSpoken, toWritten] of gaps) {
    const left = spoken.slice(fromSpoken, toSpoken);
    const right = written.slice(fromWritten, toWritten);
    if (left.length > 0 && right.length > 0) {
      if (left.map((token) => token.word).join("") === right.map((token) => token.word).join("")) {
        // The same letters, split into words differently: every word on both sides has its match.
        const steps = Math.max(left.length, right.length);
        for (let step = 0; step < steps; step++) all.push([fromSpoken + Math.min(step, left.length - 1), fromWritten + Math.min(step, right.length - 1)]);
      } else {
        let next = 0;
        left.forEach((token, at) => {
          const found = right.findIndex((candidate, index) => index >= next && nearly(token.word, candidate.word));
          if (found < 0) return;
          all.push([fromSpoken + at, fromWritten + found]);
          next = found + 1;
        });
      }
    }
    if (toSpoken < spoken.length) all.push([toSpoken, toWritten]);
    fromSpoken = toSpoken + 1;
    fromWritten = toWritten + 1;
  }
  const spokenMatched = new Set(all.map(([index]) => index));
  const writtenMatched = new Set(all.map(([, index]) => index));
  const share = (tokens: Token[], matched: Set<number>, piece: number): number => {
    const own = tokens.map((token, index) => ({ token, index })).filter((entry) => entry.token.piece === piece);
    return own.length === 0 ? 1 : own.filter((entry) => matched.has(entry.index)).length / own.length;
  };
  // Between two pairs, a spoken word without a match stands against a written one as a substitution; what is left over on one side was omitted or inserted.
  const errors = { substituted: 0, omitted: 0, inserted: 0 };
  let lastSpoken = -1;
  let lastWritten = -1;
  for (const [atSpoken, atWritten] of [...all, [spoken.length, written.length] as [number, number]]) {
    const onlySpoken = Math.max(0, atSpoken - lastSpoken - 1);
    const onlyWritten = Math.max(0, atWritten - lastWritten - 1);
    const both = Math.min(onlySpoken, onlyWritten);
    errors.substituted += both;
    errors.omitted += onlySpoken - both;
    errors.inserted += onlyWritten - both;
    lastSpoken = Math.max(lastSpoken, atSpoken);
    lastWritten = Math.max(lastWritten, atWritten);
  }
  const differences = timed ? all.map(([s, w]) => written[w]!.time! - spoken[s]!.time!).sort((a, b) => a - b) : [];
  const sizes = differences.map(Math.abs).sort((a, b) => a - b);
  const largest = sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.9))];
  return {
    spokenWords: spoken.length,
    otherWords: written.length,
    coverage: spoken.length === 0 ? null : round(spokenMatched.size / spoken.length),
    heard: written.length === 0 ? null : round(writtenMatched.size / written.length),
    offsetSeconds: differences.length === 0 ? null : { median: round(differences[Math.floor(differences.length / 2)]!, 1), largest: round(differences.find((difference) => Math.abs(difference) === largest) ?? 0, 1) },
    uncovered: speech.filter((_, index) => share(spoken, spokenMatched, index) < 0.5),
    unheard: timed ? pieces.filter((_, index) => share(written, writtenMatched, index) < 0.5) : [],
    wordErrors: spoken.length === 0 ? null : { ...errors, rate: round((errors.substituted + errors.omitted + errors.inserted) / spoken.length) },
  };
}

// ----------------------------------------------------------------------------- the picture

export interface Flashes {
  /**
   * Flashes in the busiest second over at least a quarter of the picture, and in the busiest
   * second of any one part of it. A flash is a pair of opposing changes in luminance.
   */
  quarterOfPicture: { perSecond: number; atSeconds: number | null };
  anyPart: { perSecond: number; atSeconds: number | null };
  secondsMeasured: number;
  framesPerSecond: number;
  /** The picture is measured in this many parts. */
  parts: number;
}

export const FLASH_GRID = { columns: 16, rows: 9 };
export const FLASH_FRAMES_PER_SECOND = 25;
/** A change counts from a tenth of the largest luminance, when the darker of the two is below 0.8: the definition of a flash in WCAG. */
const FLASH_STEP = 0.1;
const FLASH_DARK_BELOW = 0.8;

/**
 * Count flashes in a series of small grey pictures, one byte per part, `parts` bytes per
 * picture. Per part the luminance is followed: every time it turns by at least a tenth, that
 * is a change; two changes are a flash. Then a window of one second slides over the film.
 * An approximation of the general flash threshold of WCAG 2.3.1: the area is taken as a share
 * of the picture, not of the field of view, and red flashes are not told apart.
 */
export function countFlashes(frames: Uint8Array, parts: number, framesPerSecond: number): Flashes {
  const count = Math.floor(frames.length / parts);
  // Per part: how many changes there were up to each picture.
  const changes = Array.from({ length: parts }, () => new Uint16Array(count + 1));
  for (let part = 0; part < parts; part++) {
    let direction = 0;
    let low = 0;
    let high = 0;
    let extreme = 0;
    const sums = changes[part]!;
    for (let frame = 0; frame < count; frame++) {
      const value = (frames[frame * parts + part]! / 255) ** 2.2;
      let changed = false;
      if (frame === 0) low = high = extreme = value;
      else if (direction === 0) {
        low = Math.min(low, value);
        high = Math.max(high, value);
        if (value - low >= FLASH_STEP && low < FLASH_DARK_BELOW) direction = 1;
        else if (high - value >= FLASH_STEP && value < FLASH_DARK_BELOW) direction = -1;
        if (direction !== 0) [changed, extreme] = [true, value];
      } else if (direction === 1) {
        if (value > extreme) extreme = value;
        else if (extreme - value >= FLASH_STEP && value < FLASH_DARK_BELOW) [changed, direction, extreme] = [true, -1, value];
      } else if (value < extreme) extreme = value;
      else if (value - extreme >= FLASH_STEP && extreme < FLASH_DARK_BELOW) [changed, direction, extreme] = [true, 1, value];
      sums[frame + 1] = sums[frame]! + (changed ? 1 : 0);
    }
  }
  const quarter = Math.max(1, Math.ceil(parts / 4));
  const best = { quarter: 0, quarterAt: null as number | null, any: 0, anyAt: null as number | null };
  const inWindow = new Array<number>(parts);
  for (let start = 0; start < count; start++) {
    const end = Math.min(count, start + framesPerSecond);
    for (let part = 0; part < parts; part++) inWindow[part] = Math.floor((changes[part]![end]! - changes[part]![start]!) / 2);
    const sorted = [...inWindow].sort((a, b) => b - a);
    if (sorted[0]! > best.any) [best.any, best.anyAt] = [sorted[0]!, start];
    if (sorted[quarter - 1]! > best.quarter) [best.quarter, best.quarterAt] = [sorted[quarter - 1]!, start];
  }
  const at = (frame: number | null): number | null => (frame === null ? null : round(frame / framesPerSecond, 1));
  return { quarterOfPicture: { perSecond: best.quarter, atSeconds: at(best.quarterAt) }, anyPart: { perSecond: best.any, atSeconds: at(best.anyAt) }, secondsMeasured: round(count / framesPerSecond, 1), framesPerSecond, parts };
}

/** A change of scene counts from this score of `scdet`, on its scale of 0 to 100. */
const SCENE_THRESHOLD = 10;

/**
 * One pass over the picture of a video: where the scene changes (`scdet`) and how often it
 * flashes. ffmpeg has a filter `photosensitivity`, but that gives a number without a unit
 * ("badness") and no flashes per second, so the luminance is counted here.
 */
export async function pictureOf(path: string, workDir: string): Promise<{ sceneChanges: number[]; flashes: Flashes }> {
  const raw = join(workDir, "luminance.raw");
  const graph = `[0:v:0]split[a][b];[a]scale=320:-2,scdet=threshold=${SCENE_THRESHOLD},metadata=mode=print:key=lavfi.scd.time:file=-[x];[b]fps=${FLASH_FRAMES_PER_SECOND},scale=${FLASH_GRID.columns}:${FLASH_GRID.rows}:flags=area:out_range=full,format=gray[y]`;
  const { stdout } = await run(binaryCommand("ffmpeg"), ["-v", "error", "-y", ...LOCAL_ONLY, "-t", String(MAX_MEDIA_SECONDS), "-i", path, "-an", "-filter_complex", graph, "-map", "[x]", "-f", "null", "-", "-map", "[y]", "-f", "rawvideo", raw], { timeout: 4 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  const sceneChanges = [...stdout.matchAll(/lavfi\.scd\.time=([\d.]+)/g)].map((time) => round(Number(time[1])));
  return { sceneChanges, flashes: countFlashes(new Uint8Array(await readFile(raw)), FLASH_GRID.columns * FLASH_GRID.rows, FLASH_FRAMES_PER_SECOND) };
}

/**
 * The moments to take a still picture at: just after each change of scene, and at even steps
 * when there are too few of those to show the film. Never more than `max`.
 */
export function stillTimes(durationSeconds: number, sceneChanges: number[], max: number): number[] {
  const last = Math.max(0, durationSeconds - 0.2);
  const clamp = (time: number): number => round(Math.min(last, Math.max(0, time)), 1);
  // A little after the change the new scene has been drawn in full.
  let times = [...new Set([clamp(0.5), ...sceneChanges.map((time) => clamp(time + 0.3))])].sort((a, b) => a - b);
  if (times.length > max) times = Array.from({ length: max }, (_, index) => times[Math.round((index * (times.length - 1)) / Math.max(1, max - 1))]!);
  // Fill the stretches without a picture, widest first, until there are enough to see what the film shows.
  const wanted = Math.min(max, Math.max(4, Math.ceil(durationSeconds / 20)));
  while (times.length < wanted) {
    const edges = [0, ...times, durationSeconds];
    let widest = 0;
    for (let index = 1; index < edges.length - 1; index++) if (edges[index + 1]! - edges[index]! > edges[widest + 1]! - edges[widest]!) widest = index;
    const middle = clamp((edges[widest]! + edges[widest + 1]!) / 2);
    if (times.includes(middle)) break;
    times = [...times, middle].sort((a, b) => a - b);
  }
  return times;
}

export interface Still {
  atSeconds: number;
  /** Path of the picture, absolute. */
  path: string;
  sha256: string;
  /** The text that recognition finds in the picture; null when it could not be read. */
  text: string | null;
  textConfidence: number | null;
}

const STILL_WIDTH = 960;

/** Take still pictures of a video at the given moments and read the text in each. */
export async function stills(path: string, dir: string, times: number[]): Promise<{ stills: Still[]; textNote: string | null }> {
  await mkdir(dir, { recursive: true });
  const note: { text: string | null } = { text: null };
  const taken = await Promise.all(
    times.map(async (time, index): Promise<Still | null> => {
      const picture = join(dir, `${String(index + 1).padStart(2, "0")}-${time.toFixed(1)}s.png`);
      try {
        await run(binaryCommand("ffmpeg"), ["-v", "error", "-y", ...LOCAL_ONLY, "-ss", String(time), "-i", path, "-frames:v", "1", "-vf", `scale='min(${STILL_WIDTH},iw)':-2`, picture], { timeout: 30_000 });
        const read = await ocr(picture).catch((error: Error) => {
          note.text = error instanceof Unavailable ? `tekst in beeld niet gelezen: ${error.message}` : "tekst in beeld niet gelezen: tekstherkenning gaf geen antwoord";
          return null;
        });
        return { atSeconds: time, path: picture, sha256: await sha256File(picture), text: read ? read.text : null, textConfidence: read?.confidence ?? null };
      } catch {
        return null;
      }
    }),
  );
  return { stills: taken.filter((still): still is Still => still !== null), textNote: note.text };
}

/** What is said around a moment: the piece of speech it falls in, or the nearest within two seconds. */
export function saidAt(speech: Timed[], atSeconds: number): string | null {
  const distance = (piece: Timed): number => (atSeconds < piece.from ? piece.from - atSeconds : atSeconds > piece.to ? atSeconds - piece.to : 0);
  const nearest = [...speech].sort((a, b) => distance(a) - distance(b))[0];
  return nearest && distance(nearest) <= 2 ? nearest.text : null;
}

/** The words read in a picture that are said nowhere in the film: what a viewer who cannot see the picture misses. */
export function notSpoken(inPicture: string, speech: Timed[]): string[] {
  const single = words(speech.map((piece) => piece.text).join(" "));
  // Recognition may write one word as two.
  const said = [...single, ...single.slice(1).map((word, index) => `${single[index]}${word}`)];
  return [...new Set(words(inPicture).filter((word) => word.length >= 3 && !said.some((other) => nearly(word, other))))];
}
