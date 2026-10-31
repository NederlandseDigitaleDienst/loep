import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaReport, type MediaElement } from "../instruments/media.ts";
import { measuredBy, type MethodFailure, type MethodResult } from "../instruments/methods.ts";
import { compareSpeech, embeddedCues, MAX_MEDIA_SECONDS, notSpoken, parseWebVtt, pictureOf, probeMedia, saidAt, soundOf, soundWithoutSpeech, stills, stillTimes, transcribe, words, type Flashes, type MediaStreams, type Sound, type SpeechComparison, type Still, type Timed, type Transcript } from "../instruments/methods/listen.ts";
import { idOf, knownError, runMethod, sortRan, Unavailable, type Ran } from "../instruments/methods/registry.ts";
import { sha256File, writeFileAtomic } from "../lib/canonical.ts";
import { UsageError, type Context, type Handler, type Options, type Outcome } from "./commands.ts";
import { browsersOf, methodLines, short, withBackground, type Slow } from "./opinions.ts";
import { guardedDownload } from "./safety.ts";

const line = (element: MediaElement): string => {
  const facts = [
    element.attributes.autoplay ? "autoplay" : null,
    element.loop ? "loop" : null,
    element.attributes.controls ? "controls" : "geen controls",
    element.muted ? "gedempt" : `volume ${element.volume}`,
    element.durationSeconds === null ? "duur onbekend" : `${element.durationSeconds}s`,
    element.audioTrack === null ? "geluidsspoor onbekend" : element.audioTrack ? "geluidsspoor" : "geen geluidsspoor",
    element.playingAfterLoad ? (element.timeAdvances ? "speelt" : "speelt volgens de browser, tijd loopt niet") : "speelt niet",
    element.textTracks.length > 0 ? `sporen: ${element.textTracks.map((track) => `${track.kind} ${track.language || "?"}`).join(", ")}` : "geen tekstsporen",
    element.ownControls ? "eigen bediening zichtbaar" : element.pageControls.length > 0 ? `mogelijke knoppen: ${element.pageControls.map((control) => `${control.tag} "${control.text}" (${control.relation})`).join(", ")}` : "geen knop gevonden die het stopt of dempt",
  ].filter(Boolean);
  return `${element.tag} ${element.path.join(" >>> ")}${element.frame ? ` in venster ${element.frame}` : ""}: ${facts.join("; ")}`;
};

/**
 * Audio and video in the current state: every element, or the one given. Only reads: nothing
 * is started or stopped, so the knobs that may stop a sound are named, not tried. An agent
 * that wants to know tries one with `click` and asks again.
 */
export const media: Handler = async (context, _args, options) => {
  if (options.listen === true) return listen(context, options);
  const report = await mediaReport(context.surface.page, context.target ? { target: context.target.path } : {});
  if (context.target && report.elements.length === 0) throw new Error("dit element is geen audio of video");
  return {
    result: report,
    print: {
      elements: report.elements.length,
      media: report.elements.map(line),
      ...(report.framesNotInspected.length > 0 ? { framesNotInspected: report.framesNotInspected.map((frame) => frame.address) } : {}),
      note: report.elements.length > 0 ? "gelezen na het laden en na drie seconden; of het hier speelt hangt ook van de browser af, de code en het bestand niet" : "geen audio of video in deze toestand",
    },
  };
};

// ---------------------------------------------------------------------------------- listen

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_TRACK_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_MS = 30_000;
const TRACK_DOWNLOAD_MS = 8000;
const MAX_TRACKS = 6;
const MAX_STILLS = 8;
const MAX_SECTION_CHARS = 8000;
/** How long the command waits for listening and looking before it returns with what there is. */
const LISTEN_GRACE_MS = 20_000;
/**
 * Recognition gets words wrong. When at least this share of the spoken words is in the
 * subtitles, speech and subtitles are taken to agree; a difference below it is not a finding.
 */
export const SPEECH_MARGIN = 0.85;
/** What the word error rate in an answer is and is not: said with every answer that shows one. */
const WER_NOTE = "WER is de gangbare woordfoutmaat: (vervangen + weggelaten + ingevoegd) gedeeld door het aantal gesproken woorden, met de herkende spraak als referentie. De spraakherkenning maakt zelf fouten: het getal is een bovengrens voor het verschil tussen spraak en ondertitels, geen oordeel";
/** Subtitles that come this much earlier or later than the speech are out of step. */
export const OFFSET_MARGIN_SECONDS = 2;
/** Fewer words than this are not speech somebody would need subtitles for: recognition makes that much out of noise. */
const MIN_SPEECH_WORDS = 3;
/** A link near the element that may lead to its words as text or to a described version. */
const ALTERNATIVE_LINK = /transcri|uitgeschr|tekst|ondertitel|beschrijving|audiodescri|caption|description/i;
const FLASH_NOTE = "benadering van de drempel van 2.3.1 (aandeel van het beeld, niet van het gezichtsveld; rood niet apart), geen gecertificeerde analyse";

interface PageTrack {
  kind: string;
  language: string;
  label: string;
  src: string | null;
  /** Cues the page made itself, for a track that has no file. */
  cues: Timed[] | null;
}

interface ElementFacts {
  tag: string;
  src: string | null;
  sources: { src: string | null; type: string | null }[];
  tracks: PageTrack[];
  lang: string;
  section: { text: string; links: { text: string; href: string }[] };
}

/** What the page says about one audio or video element: where its file is, its tracks, its language and the text around it. Runs in the page; only reads. */
function elementFacts(context: Context, path: string[]): Promise<ElementFacts | null> {
  return context.surface.page.evaluate(
    ([chain, maxChars]) => {
      const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain as string[]);
      if (!element) return null;
      const absolute = (value: string | null): string | null => {
        if (!value) return null;
        try {
          return new URL(value, document.baseURI).href;
        } catch {
          return null;
        }
      };
      const empty = { src: null, sources: [], tracks: [], lang: "", section: { text: "", links: [] } };
      if (element.localName !== "audio" && element.localName !== "video") return { tag: element.localName, ...empty };
      const player = element as HTMLMediaElement;
      const fromFile = [...player.querySelectorAll("track")];
      const tracks = fromFile.map((track) => ({ kind: track.kind, language: track.srclang, label: track.label, src: absolute(track.getAttribute("src")), cues: null as { from: number; to: number; text: string }[] | null }));
      for (const track of player.textTracks) {
        if (fromFile.some((entry) => entry.track === track)) continue;
        tracks.push({ kind: track.kind, language: track.language, label: track.label, src: null, cues: [...(track.cues ?? [])].map((cue) => ({ from: cue.startTime, to: cue.endTime, text: (cue as VTTCue).text ?? "" })) });
      }
      // The text around the element: from the heading it stands under to the next heading of that level.
      const level = (node: Element): number | null => (/^h[1-6]$/.test(node.localName) ? Number(node.localName[1]) : node.getAttribute("role") === "heading" ? Number(node.getAttribute("aria-level") ?? 2) : null);
      const around: Element[] = [];
      let node: Element = player;
      for (let climb = 0; climb < 5 && node.parentElement; climb++) {
        const siblings = [...node.parentElement.children];
        const at = siblings.indexOf(node);
        let heading: number | null = null;
        for (let index = at - 1; index >= 0 && heading === null; index--) {
          around.unshift(siblings[index]!);
          heading = level(siblings[index]!);
        }
        for (let index = at + 1; index < siblings.length; index++) {
          const next = level(siblings[index]!);
          if (heading !== null && next !== null && next <= heading) break;
          around.push(siblings[index]!);
        }
        if (heading !== null || node.parentElement.matches("body,main,[role=main],article,section")) break;
        node = node.parentElement;
      }
      const texts: string[] = [];
      for (const part of around) {
        if (part.matches("script,style,template,audio,video")) continue;
        const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) if (!text.parentElement?.closest("script,style,template")) texts.push(text.nodeValue ?? "");
      }
      const links = around
        .flatMap((part) => [...(part.matches("a[href]") ? [part] : []), ...part.querySelectorAll("a[href]")])
        .slice(0, 10)
        .map((link) => ({ text: (link.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80), href: (link as HTMLAnchorElement).href }));
      return {
        tag: player.localName,
        src: absolute(player.currentSrc || player.getAttribute("src") || player.querySelector("source")?.getAttribute("src") || null),
        sources: [...player.querySelectorAll("source")].map((source) => ({ src: absolute(source.getAttribute("src")), type: source.getAttribute("type") })),
        tracks,
        lang: player.closest("[lang]")?.getAttribute("lang") ?? "",
        section: { text: texts.join(" ").replace(/\s+/g, " ").trim().slice(0, maxChars as number), links },
      };
    },
    [path, MAX_SECTION_CHARS] as const,
  );
}

interface TrackRead extends PageTrack {
  source: "track" | "script";
  /** Why the cues could not be read. */
  reason?: string;
  /** The file as it was fetched, next to the observation. */
  file?: string;
}

interface Decoded {
  streams: MediaStreams;
  sound: Sound | null;
  embedded: { codec: string; language: string | null; cues: Timed[] | null }[];
  sceneChanges: number[];
  flashes: Flashes | null;
  stills: (Omit<Still, "path"> & { image: string })[];
  stillsNote: string | null;
}

const seconds = (value: number): string => `${Math.round(value * 10) / 10}s`;
const percent = (share: number | null): string => (share === null ? "?" : `${Math.round(share * 100)}%`);
const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);
const stamp = (value: number): string => `${String(Math.floor(value / 3600)).padStart(2, "0")}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${(value % 60).toFixed(3).padStart(6, "0")}`;
const trackName = (track: { kind: string; language: string | null }): string => `${track.kind} ${track.language || "?"}`;
const some = <T>(items: T[], line: (item: T) => string, max = 3): string[] => [...items.slice(0, max).map(line), ...(items.length > max ? [`(+${items.length - max})`] : [])];
const piece = (timed: Timed): string => `${seconds(timed.from)}-${seconds(timed.to)} "${short(timed.text, 70)}"`;

/**
 * Listen to and look at one audio or video element: fetch its file under the rules of the
 * session, read its tracks, write out what is said, put that next to the subtitles and the
 * text around the element, and for a video take still pictures and count flashes. Facts for
 * whoever judges; the judgement is not made here.
 */
async function listen(context: Context, options: Options): Promise<Outcome> {
  const { surface, images, env } = context;
  if (!context.target) throw new UsageError("media --listen vraagt een ref van een audio- of video-element: media <ref> --listen");
  const started = Date.now();
  const facts = await elementFacts(context, context.target.path);
  if (!facts) throw new Error("het element is van de pagina verdwenen");
  if (facts.tag !== "audio" && facts.tag !== "video") throw new Error(`dit element is geen audio of video${facts.tag === "iframe" ? ": geef het nummer van de audio of video in het ingesloten venster (look en find tonen die)" : ""}`);
  const browsers = browsersOf(context);
  const place = context.target.path.join(" >>> ");
  const work = await mkdtemp(join(tmpdir(), "loep-media-"));
  const agent = await surface.page.evaluate(() => navigator.userAgent).catch(() => "");
  const headers = async (url: string): Promise<Record<string, string>> => {
    const cookies = await surface.context.cookies(url).catch(() => []);
    return { referer: surface.page.url(), ...(agent ? { "user-agent": agent } : {}), ...(cookies.length > 0 ? { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") } : {}) };
  };

  // The text tracks the page names: each file as the server sends it.
  const tracks = await runMethod("text-tracks", browsers, () =>
    Promise.all(
      facts.tracks.slice(0, MAX_TRACKS).map(async (track, index): Promise<TrackRead> => {
        if (track.src === null) return { ...track, source: "script" };
        const to = images.file(`-track-${index + 1}.vtt`);
        const fetched = await guardedDownload(env.scope, surface.guard, track.src, to, { resourceType: "texttrack", maxBytes: MAX_TRACK_BYTES, timeoutMs: TRACK_DOWNLOAD_MS, headers, blockade: env.blockade });
        if (!fetched.ok) return { ...track, source: "track", cues: null, reason: fetched.reason };
        return { ...track, source: "track", cues: parseWebVtt(await readFile(to, "utf8")), file: images.relative(to) };
      }),
    ),
  );
  const pageTracks = tracks.ok ? tracks.value.result : [];

  // The file itself.
  const file = join(work, "media");
  const blob = facts.src?.startsWith("blob:") || facts.src?.startsWith("mediastream:");
  const fetched =
    facts.src === null
      ? ({ ok: false, reason: "het element noemt geen bron (src of source)" } as const)
      : blob
        ? ({ ok: false, reason: "het adres is een blob-adres: de speler voedt het element zelf (streaming), er is geen bestand om op te halen" } as const)
        : await guardedDownload(env.scope, surface.guard, facts.src, file, { resourceType: "media", maxBytes: MAX_BYTES, timeoutMs: DOWNLOAD_MS, headers, blockade: env.blockade });
  let notRead: string | null = fetched.ok ? null : fetched.reason;
  let streams: MediaStreams | null = null;
  if (fetched.ok) {
    if (/mpegurl|dash\+xml/i.test(fetched.contentType ?? "") || /\.(m3u8|mpd)(\?|$)/i.test(fetched.url)) notRead = "het adres is een afspeellijst voor streaming (HLS of DASH), geen bestand";
    else {
      streams = await probeMedia(file).catch((error: Error) => {
        // Without ffmpeg the methods below say so themselves, each with how to install it.
        if (!(error instanceof Unavailable)) notRead = "het opgehaalde bestand is niet te lezen als audio of video";
        return null;
      });
    }
  }
  const fileRecord = fetched.ok ? { url: fetched.url, bytes: fetched.bytes, sha256: await sha256File(file), contentType: fetched.contentType, truncated: fetched.truncated } : null;
  const language = /^[a-z]{2,3}(?=-|$)/i.exec(facts.lang)?.[0]?.toLowerCase() ?? null;
  const frames = images.dir("frames");
  const transcriptPath = images.file("-transcript.vtt");

  // The temporary copy goes when nothing reads it any more.
  let readers = 0;
  const release = (): void => void (--readers <= 0 && rm(work, { recursive: true, force: true }).catch(() => undefined));
  const begun = new Set<string>();
  const reading = <T>(id: string, task: () => Promise<Ran<T>>): (() => Promise<Ran<T>>) => {
    readers++;
    return () => {
      begun.add(id);
      return task().finally(release);
    };
  };
  const slows: Slow[] = [];
  if (notRead === null && context.services?.jobs) {
    const detail = `${place}|${fileRecord?.sha256 ?? ""}|${language ?? "auto"}`;
    slows.push({
      id: "ffmpeg",
      detail,
      graceMs: LISTEN_GRACE_MS,
      work: reading("ffmpeg", () =>
        runMethod(
          "ffmpeg",
          browsers,
          async (): Promise<Decoded> => {
            const read = await probeMedia(file);
            const [sound, picture, embedded] = await Promise.all([
              read.audio.length > 0 ? soundOf(file, read.durationSeconds) : null,
              read.video.length > 0 ? pictureOf(file, work) : null,
              Promise.all(read.subtitles.slice(0, 3).map(async (track, index) => ({ ...track, cues: await embeddedCues(file, index) }))),
            ]);
            const duration = Math.min(MAX_MEDIA_SECONDS, read.durationSeconds ?? sound?.seconds ?? picture?.flashes.secondsMeasured ?? 0);
            const taken = picture ? await stills(file, frames.absolute, stillTimes(duration, picture.sceneChanges, MAX_STILLS)) : null;
            return { streams: read, sound, embedded, sceneChanges: picture?.sceneChanges ?? [], flashes: picture?.flashes ?? null, stills: (taken?.stills ?? []).map(({ path, ...still }) => ({ ...still, image: images.relative(path) })), stillsNote: taken?.textNote ?? null };
          },
          5 * 60_000,
        ),
      ),
    });
    if (streams === null || streams.audio.length > 0) {
      slows.push({
        id: "whisper",
        detail,
        graceMs: LISTEN_GRACE_MS,
        work: reading("whisper", () =>
          runMethod(
            "whisper",
            browsers,
            async (): Promise<Transcript> => {
              const heard = await transcribe(file, work, language);
              await writeFileAtomic(transcriptPath, `WEBVTT\n\n${heard.segments.map((segment) => `${stamp(segment.from)} --> ${stamp(segment.to)}\n${segment.text}\n`).join("\n")}`);
              return heard;
            },
            10 * 60_000,
          ),
        ),
      });
    }
  }
  // A slow download has used up the time a command may take: what is still running then comes with `wait`.
  const late = Date.now() - started > 10_000;
  const outcome = await withBackground(context, "media", late ? { ...options, wait: false } : options, slows.map((slow) => (late ? { ...slow, graceMs: 3000 } : slow)), (answers, pending) => {
    const ran = sortRan<unknown>(answers);
    const recognised = (ran.methods.find((method) => idOf(method) === "whisper")?.result as Transcript | undefined) ?? null;
    const decoded = (ran.methods.find((method) => idOf(method) === "ffmpeg")?.result as Decoded | undefined) ?? null;
    // Words that whisper places where the track is silent were not said: they are kept apart and not compared.
    const silent = (segment: Timed): boolean => (decoded?.sound?.silences ?? []).reduce((sum, silence) => sum + Math.max(0, Math.min(silence.to, segment.to) - Math.max(silence.from, segment.from)), 0) >= 0.8 * (segment.to - segment.from) && segment.to > segment.from;
    const inSilence = recognised ? recognised.segments.filter(silent) : [];
    const said = recognised ? recognised.segments.filter((segment) => !inSilence.includes(segment)) : [];
    const heard = recognised ? { ...recognised, segments: said, words: said.reduce((sum, segment) => sum + words(segment.text).length, 0), text: said.map((segment) => segment.text).join(" ") } : null;
    const unreliable = inSilence.length > 0 ? knownError("whisper", "speech-in-silence")! : null;
    const methods: MethodResult[] = [...ran.methods.filter((method) => idOf(method) === "whisper").map((method) => (unreliable ? { ...method, knownUnreliable: unreliable } : method)), ...(tracks.ok ? [tracks.value] : []), ...ran.methods.filter((method) => idOf(method) === "ffmpeg")];
    const failed: MethodFailure[] = [...ran.failed, ...(tracks.ok ? [] : [tracks.failure])];
    const known = decoded?.streams ?? streams;

    // Subtitles: the tracks of the page and those inside the file, each next to the speech.
    const subtitles = [
      ...pageTracks.filter((track) => (track.kind === "captions" || track.kind === "subtitles") && track.cues !== null).map((track) => ({ track: trackName(track), cues: track.cues! })),
      ...(decoded?.embedded ?? []).filter((track) => track.cues !== null).map((track) => ({ track: `in het bestand ${track.language ?? "?"}`, cues: track.cues! })),
    ];
    const speaks = heard !== null && heard.words >= MIN_SPEECH_WORDS;
    const comparisons: ({ track: string } & SpeechComparison)[] = heard ? subtitles.map((entry) => ({ track: entry.track, ...compareSpeech(heard.segments, entry.cues) })) : [];
    const best = [...comparisons].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0))[0] ?? null;
    const onPage = heard && speaks && facts.section.text !== "" ? compareSpeech(heard.segments, facts.section.text) : null;
    const differences: string[] = [];
    // Whether the file holds subtitles of its own is known once it has been read.
    if (speaks && subtitles.length === 0 && (decoded !== null || failed.some((failure) => idOf(failure) === "ffmpeg"))) {
      // Sound without picture needs its words as text, not as subtitles: there the text around the element is the other source.
      const soundOnly = known ? known.video.length === 0 : facts.tag === "audio";
      if (!soundOnly) differences.push(`whisper hoort spraak (${heard.words} woorden); het element heeft geen ondertitels`);
      else if ((onPage?.coverage ?? 0) < SPEECH_MARGIN) differences.push(`whisper hoort spraak (${heard.words} woorden); het element heeft geen ondertitels en ${onPage ? percent(onPage.coverage) : "niets"} ervan staat in de tekst rond het element`);
    }
    if (speaks && best) {
      if ((best.coverage ?? 1) < SPEECH_MARGIN) differences.push(`${percent(best.coverage)} van de gesproken woorden staat in de ondertitels (${best.track})`);
      if (best.offsetSeconds && Math.abs(best.offsetSeconds.median) > OFFSET_MARGIN_SECONDS) differences.push(`de ondertitels (${best.track}) komen ${seconds(Math.abs(best.offsetSeconds.median))} ${best.offsetSeconds.median > 0 ? "later" : "eerder"} dan de spraak`);
    }
    if (heard && best && best.otherWords >= MIN_SPEECH_WORDS && (best.heard ?? 1) < SPEECH_MARGIN) differences.push(`${percent(best.heard)} van de woorden in de ondertitels (${best.track}) is gehoord`);
    const measured = measuredBy(methods, differences, { failed, pending, noOpinion: decoded ? ["ffmpeg: leest het bestand, niet wat er gezegd wordt"] : [] });

    const otherSound = decoded?.sound && heard ? soundWithoutSpeech(decoded.sound, heard.segments) : null;
    const pictures = (decoded?.stills ?? []).map((still) => ({ ...still, said: heard ? saidAt(heard.segments, still.atSeconds) : null, notSpoken: heard && still.text ? notSpoken(still.text, heard.segments) : null }));
    const cut = [
      ...(fileRecord?.truncated === "size" ? [`alleen de eerste ${size(MAX_BYTES)} van het bestand opgehaald`] : fileRecord?.truncated === "time" ? [`het ophalen is na ${DOWNLOAD_MS / 1000} seconden gestopt: alleen het begin van het bestand (${size(fileRecord.bytes)})`] : []),
      ...((known?.durationSeconds ?? 0) > MAX_MEDIA_SECONDS ? [`alleen de eerste ${MAX_MEDIA_SECONDS / 60} minuten van ${Math.round(known!.durationSeconds! / 60)} beluisterd en bekeken`] : []),
    ];
    const result = {
      ...measured,
      element: { tag: facts.tag, src: facts.src, sources: facts.sources, lang: facts.lang },
      file: fileRecord,
      notRead,
      streams: known,
      tracks: pageTracks,
      comparisons,
      section: { ...facts.section, comparison: onPage },
      soundWithoutSpeech: otherSound,
      speechInSilence: inSilence,
      stills: pictures,
      flashes: decoded?.flashes ? { ...decoded.flashes, note: FLASH_NOTE } : null,
      limits: { maxSeconds: MAX_MEDIA_SECONDS, maxBytes: MAX_BYTES, cut },
      margins: { speech: SPEECH_MARGIN, offsetSeconds: OFFSET_MARGIN_SECONDS },
    };
    const flashes = decoded?.flashes;
    const nearby = facts.section.links.filter((link) => ALTERNATIVE_LINK.test(link.text));
    const print: Record<string, unknown> = {
      media: `${facts.tag}${known ? ` ${known.durationSeconds === null ? "duur onbekend" : seconds(known.durationSeconds)}; ${[...known.video.map((track) => `beeld ${track.codec} ${track.width}x${track.height}`), ...known.audio.map((track) => `geluid ${track.codec}${track.language ? ` ${track.language}` : ""}`), ...known.subtitles.map((track) => `ondertitels in het bestand${track.language ? ` ${track.language}` : ""}`)].join(", ") || "geen sporen"}` : ""}`,
      ...(notRead ? { notRead } : {}),
      ...(cut.length > 0 ? { cut } : {}),
      tracks: pageTracks.length === 0 ? "geen track bij het element" : pageTracks.map((track) => `${trackName(track)}: ${track.cues === null ? `niet gelezen, ${track.reason}` : `${track.cues.length} cues`}`),
      ...(heard ? { speech: heard.words === 0 ? `geen spraak herkend${heard.sounds.length > 0 ? `; whisper noteert ${[...new Set(heard.sounds.map((sound) => sound.text))].slice(0, 3).join(" ")}` : ""}` : `${heard.words} woorden in ${heard.segments.length} stukken (${heard.language}${heard.languageFrom === "detected" ? ", door whisper gekozen" : ""}): "${short(heard.text, 100)}"` } : {}),
      ...(decoded?.sound ? { sound: `${seconds(decoded.sound.soundSeconds)} geluid, ${seconds(decoded.sound.silentSeconds)} stil${otherSound ? `, ${seconds(otherSound.reduce((sum, part) => sum + part.to - part.from, 0))} geluid zonder spraak` : ""}; luidst ${decoded.sound.maxVolumeDb} dB` } : decoded && decoded.streams.audio.length === 0 ? { sound: "geen geluidsspoor in het bestand" } : {}),
      ...(comparisons.length > 0 ? { captions: comparisons.map((entry) => `${entry.track}: ${percent(entry.coverage)} van ${entry.spokenWords} gesproken woorden in de ondertitels, ${percent(entry.heard)} van de ondertitels gehoord${entry.offsetSeconds ? `, verschuiving ${entry.offsetSeconds.median}s (tot ${entry.offsetSeconds.largest}s)` : ""}${entry.wordErrors ? `, WER ${percent(entry.wordErrors.rate)} (${entry.wordErrors.substituted} vervangen, ${entry.wordErrors.omitted} weggelaten, ${entry.wordErrors.inserted} ingevoegd)` : ""}`), werNote: WER_NOTE } : {}),
      ...(best && best.uncovered.length > 0 ? { speechWithoutCaption: some(best.uncovered, piece) } : {}),
      ...(best && best.unheard.length > 0 ? { captionNotHeard: some(best.unheard, piece) } : {}),
      ...(onPage ? { pageText: `${percent(onPage.coverage)} van de gesproken woorden staat in de tekst rond het element (${onPage.otherWords} woorden)${onPage.uncovered.length > 0 ? `; niet: ${some(onPage.uncovered, piece, 2).join(" ")}` : ""}` } : {}),
      ...(nearby.length > 0 ? { linksNearby: some(nearby, (link) => `${link.text} -> ${link.href.slice(0, 80)}`) } : {}),
      // A picture that shows the same text as the one before it is named, its text is not printed again.
      ...(pictures.length > 0 ? { stills: pictures.map((still, index) => `${seconds(still.atSeconds)} ${still.image}${!still.text ? "" : still.text === pictures[index - 1]?.text ? " zelfde tekst" : ` tekst "${short(still.text, 80)}"${still.notSpoken && still.notSpoken.length > 0 ? ` niet uitgesproken: ${still.notSpoken.slice(0, 8).join(" ")}` : ""}`}${still.said && still.said !== pictures[index - 1]?.said ? ` gezegd "${short(still.said, 60)}"` : ""}`) } : {}),
      ...(decoded?.stillsNote ? { stillsNote: decoded.stillsNote } : {}),
      ...(flashes ? { flashes: `${flashes.quarterOfPicture.perSecond} per seconde over een kwart van het beeld${flashes.quarterOfPicture.atSeconds !== null ? ` (rond ${seconds(flashes.quarterOfPicture.atSeconds)})` : ""}, ${flashes.anyPart.perSecond} in een deel${flashes.anyPart.atSeconds !== null ? ` (rond ${seconds(flashes.anyPart.atSeconds)})` : ""}; benadering, geen gecertificeerde analyse` } : {}),
      ...(heard ? { transcript: images.relative(transcriptPath) } : {}),
      ...(inSilence.length > 0 ? { speechInSilence: some(inSilence, piece, 2) } : {}),
      ...methodLines(measured, unreliable ? [`whisper: ${unreliable}`] : []),
      ...(differences.length > 0 ? { disagree: differences } : {}),
    };
    return { result, print };
  });
  // A method whose answer was already there did not run: it does not hold the copy either.
  for (const slow of slows) if (!begun.has(slow.id)) release();
  if (slows.length === 0) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  return outcome;
}
