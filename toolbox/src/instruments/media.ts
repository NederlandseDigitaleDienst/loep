import type { Frame, Page } from "playwright";

export interface MediaControl {
  tag: string;
  text: string;
  path: string[];
  /** Why this control is a candidate: its name, an aria-controls that points at the element, or its place in the same block. */
  relation: "naam" | "aria-controls" | "zelfde blok";
  /** What using it did to the element, when it was tried: "pauzeert", "dempt", "zet het volume lager", "start", "geen effect". Null: not tried. */
  effect: string | null;
}

export interface MediaElement {
  /** Address of the frame the element is in; null for the page itself. */
  frame: string | null;
  tag: "audio" | "video";
  path: string[];
  src: string | null;
  /** Whether the element is drawn. An audio element without `controls` never is. */
  visible: boolean;
  attributes: { autoplay: boolean; loop: boolean; controls: boolean; muted: boolean; preload: string | null };
  /** Not paused and not ended at the first reading, after the page had loaded. */
  playingAfterLoad: boolean;
  /** The playing time moved on between the two readings: it really plays in this browser. */
  timeAdvances: boolean;
  playingAfterSeconds: boolean;
  secondsBetweenReadings: number;
  currentTime: [number, number];
  muted: boolean;
  volume: number;
  /** Null when the browser does not know (not loaded, or a live stream). */
  durationSeconds: number | null;
  loop: boolean;
  /** Whether the file has sound: true, false, or null when the browser gave no way to tell. Whether that sound is silence is not measured. */
  audioTrack: boolean | null;
  textTracks: { kind: string; language: string; label: string }[];
  /** The browser's own controls are shown: the attribute is set and the element is drawn. */
  ownControls: boolean;
  /** Visible controls on the page that may pause, stop or mute it. */
  pageControls: MediaControl[];
  /**
   * Whether a visitor can pause, stop or mute it: true with own controls or a page control
   * that was seen to work, false when the candidates were tried and none worked or there are
   * none, null when candidates exist that were not tried.
   */
  canBePausedOrMuted: boolean | null;
  error: string | null;
}

export interface MediaReport {
  note: string;
  elements: MediaElement[];
  /** Frames whose media could not be read, by address. */
  framesNotInspected: { address: string; reason: string }[];
}

interface Reading {
  tag: "audio" | "video";
  path: string[];
  src: string | null;
  visible: boolean;
  attributes: MediaElement["attributes"];
  paused: boolean;
  ended: boolean;
  currentTime: number;
  muted: boolean;
  volume: number;
  duration: number | null;
  loop: boolean;
  audioTrack: boolean | null;
  textTracks: MediaElement["textTracks"];
  controls: Omit<MediaControl, "effect">[];
  error: string | null;
}

const WAIT_MS = 3000;
const MAX_CONTROLS_TRIED = 6;
const NOTE = "Elk audio- en video-element, ook in ingesloten vensters: gelezen na het laden en nog eens na drie seconden. Of het in deze browser speelt hangt ook van de browser af; de kenmerken in de code (autoplay, loop, controls, muted) en van het bestand (duur, geluidsspoor) niet. Of het geluidsspoor stil is, is niet gemeten.";

/** Read every audio and video element of one frame. Runs in the page; only reads. */
function readFrame(frame: Frame, only: string[] | null): Promise<Reading[]> {
  return frame.evaluate((wanted) => {
    type Library = {
      deepQueryAll: (selector: string) => HTMLElement[];
      isVisible: (element: Element) => boolean;
      hoverTargets: () => { ref: number; tag: string; text: string; ariaLabel: string | null; path: string[] }[];
      describe: (element: Element) => { path: string[] };
      registry: HTMLElement[];
    };
    const library = (window as unknown as { __loep: Library }).__loep;
    const NAMES = /pauz|pause|stop|demp|mute|geluid|sound|volume|afspelen|speel|play|audio|muziek|music/i;
    const media = library.deepQueryAll("audio,video") as HTMLMediaElement[];
    const controls = media.length > 0 ? library.hoverTargets().map((described) => ({ described, element: library.registry[described.ref]! })) : [];
    // The block an element sits in: a few levels up, as far as a player and its buttons are usually apart.
    const block = (element: Element): Element => {
      let current: Element = element;
      // A whole region of the page is not a block: everything on the page would be "near".
      for (let level = 0; level < 3 && current.parentElement && !current.parentElement.matches("body,main,[role=main],header,footer"); level++) current = current.parentElement;
      return current;
    };
    return media
      .map((element) => {
        const path = library.describe(element).path;
        const around = block(element);
        const extra = element as HTMLMediaElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean; audioTracks?: { length: number } };
        // An audio element that has loaded is sound. For a video the browser has to say so.
        const audioTrack =
          element.localName === "audio"
            ? element.readyState >= 1 ? true : null
            : extra.audioTracks !== undefined ? extra.audioTracks.length > 0
            : typeof extra.mozHasAudio === "boolean" ? extra.mozHasAudio
            : typeof extra.webkitAudioDecodedByteCount === "number" && element.readyState >= 2 && element.currentTime > 0 ? extra.webkitAudioDecodedByteCount > 0
            : null;
        return {
          tag: element.localName as "audio" | "video",
          path,
          src: element.currentSrc || element.getAttribute("src") || element.querySelector("source")?.getAttribute("src") || null,
          visible: library.isVisible(element),
          attributes: { autoplay: element.hasAttribute("autoplay"), loop: element.hasAttribute("loop"), controls: element.hasAttribute("controls"), muted: element.hasAttribute("muted"), preload: element.getAttribute("preload") },
          paused: element.paused,
          ended: element.ended,
          currentTime: Math.round(element.currentTime * 100) / 100,
          muted: element.muted,
          volume: element.volume,
          duration: Number.isFinite(element.duration) ? Math.round(element.duration * 100) / 100 : null,
          loop: element.loop,
          audioTrack,
          textTracks: [...element.textTracks].map((track) => ({ kind: track.kind, language: track.language, label: track.label })),
          controls: controls
            // A link goes somewhere, a region that holds the element is not a control of it: neither stops a sound.
            .filter(({ described, element: control }) => control !== element && !element.contains(control) && !control.contains(element) && described.tag !== "a" && !(control.getAttribute("tabindex") === "-1" && !control.matches("button,input,select,[role=button],[role=switch],[role=checkbox]")))
            .map(({ described, element: control }) => {
              const pointsAt = element.id !== "" && (control.getAttribute("aria-controls") ?? "").split(/\s+/).includes(element.id);
              const named = NAMES.test(`${described.text.slice(0, 60)} ${described.ariaLabel ?? ""} ${control.getAttribute("title") ?? ""}`);
              const relation = pointsAt ? "aria-controls" : named ? "naam" : around.contains(control) ? "zelfde blok" : null;
              return relation ? { tag: described.tag, text: (described.text || described.ariaLabel || "").slice(0, 60), path: described.path, relation: relation as "naam" | "aria-controls" | "zelfde blok" } : null;
            })
            .filter((control) => control !== null),
          error: element.error ? `fout ${element.error.code}${element.error.message ? `: ${element.error.message.slice(0, 80)}` : ""}` : null,
        };
      })
      .filter((reading) => wanted === null || reading.path.join(" >>> ") === wanted.join(" >>> "));
  }, only);
}

interface Quick {
  paused: boolean;
  muted: boolean;
  volume: number;
}

const quick = (frame: Frame, path: string[]): Promise<Quick | null> =>
  frame
    .evaluate((chain) => {
      const element = (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLMediaElement | null } }).__loep.resolve(chain);
      return element ? { paused: element.paused, muted: element.muted, volume: element.volume } : null;
    }, path)
    .catch(() => null);

/**
 * Use each candidate control once and see what it does to the element. This changes the page,
 * so it is only done where the page is thrown away afterwards.
 */
async function tryControls(frame: Frame, element: Reading): Promise<MediaControl[]> {
  const tried: MediaControl[] = [];
  // A browser may hold back sound that starts by itself until the visitor has done something. A pause
  // button can only be seen to work on something that plays, so the element is started here first.
  if (element.controls.length > 0 && element.paused) {
    await frame.page().mouse.click(1, 1).catch(() => undefined);
    await frame.evaluate((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLMediaElement | null } }).__loep.resolve(chain)?.play().catch(() => undefined), element.path).catch(() => undefined);
    await frame.page().waitForTimeout(300);
  }
  for (const control of element.controls) {
    if (tried.length >= MAX_CONTROLS_TRIED) {
      tried.push({ ...control, effect: null });
      continue;
    }
    const before = await quick(frame, element.path);
    const handle = (await frame.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), control.path)).asElement();
    const clicked = handle ? await handle.click({ timeout: 1500 }).then(() => true, () => false) : false;
    await frame.page().waitForTimeout(400);
    const after = await quick(frame, element.path);
    let effect = "geen effect";
    if (!clicked) effect = "niet aan te klikken";
    else if (!before || !after) effect = "het element is daarna niet meer te lezen";
    else if (!before.paused && after.paused) effect = "pauzeert";
    else if ((!before.muted && after.muted) || (before.volume > 0 && after.volume === 0)) effect = "dempt";
    else if (after.volume < before.volume) effect = "zet het volume lager";
    else if (before.paused && !after.paused) effect = "start";
    tried.push({ ...control, effect });
  }
  return tried;
}

const STOPS = new Set(["pauzeert", "dempt", "zet het volume lager"]);

/**
 * Every audio and video element on the page as it is now, in every frame that can be read:
 * what the code says, what the file is, whether it plays, and what a visitor can stop it
 * with (WCAG 1.2.x, 1.4.2, 2.2.2). With `tryControls` the candidate controls are used, which
 * changes the page. With `target` only that element is reported.
 */
export async function mediaReport(page: Page, options: { target?: string[]; tryControls?: boolean; waitMs?: number } = {}): Promise<MediaReport> {
  const waitMs = options.waitMs ?? WAIT_MS;
  const framesNotInspected: MediaReport["framesNotInspected"] = [];
  const first: { frame: Frame; readings: Reading[] }[] = [];
  for (const frame of page.frames()) {
    // A target is a place in the page itself.
    if (options.target && frame !== page.mainFrame()) continue;
    try {
      first.push({ frame, readings: await readFrame(frame, options.target ?? null) });
    } catch (error) {
      if (frame !== page.mainFrame() && frame.url() !== "about:blank") framesNotInspected.push({ address: frame.url(), reason: ((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 160) });
    }
  }
  if (first.every((entry) => entry.readings.length === 0)) return { note: NOTE, elements: [], framesNotInspected };
  await page.waitForTimeout(waitMs);
  const elements: MediaElement[] = [];
  for (const { frame, readings } of first) {
    const again = await readFrame(frame, options.target ?? null).catch(() => [] as Reading[]);
    for (const reading of readings) {
      const later = again.find((entry) => entry.path.join(" >>> ") === reading.path.join(" >>> ")) ?? reading;
      const ownControls = reading.attributes.controls && reading.visible;
      const pageControls = options.tryControls ? await tryControls(frame, later) : later.controls.map((control) => ({ ...control, effect: null }));
      const works = pageControls.some((control) => control.effect !== null && STOPS.has(control.effect));
      const untried = pageControls.some((control) => control.effect === null);
      elements.push({
        frame: frame === page.mainFrame() ? null : frame.url(),
        tag: reading.tag,
        path: reading.path,
        src: later.src ?? reading.src,
        visible: reading.visible,
        attributes: reading.attributes,
        playingAfterLoad: !reading.paused && !reading.ended,
        timeAdvances: later.currentTime > reading.currentTime || (later.loop && later.currentTime !== reading.currentTime && !later.paused),
        playingAfterSeconds: !later.paused && !later.ended,
        secondsBetweenReadings: waitMs / 1000,
        currentTime: [reading.currentTime, later.currentTime],
        muted: later.muted,
        volume: later.volume,
        durationSeconds: later.duration ?? reading.duration,
        loop: later.loop,
        audioTrack: later.audioTrack ?? reading.audioTrack,
        textTracks: later.textTracks,
        ownControls,
        pageControls,
        canBePausedOrMuted: ownControls || works ? true : untried ? null : false,
        error: later.error,
      });
    }
  }
  return { note: NOTE, elements, framesNotInspected };
}
