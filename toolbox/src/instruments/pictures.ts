import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import { sha256 } from "../lib/canonical.ts";
import { ocr, type OcrAnswer } from "./methods/ocr.ts";
import { Unavailable } from "./methods/registry.ts";

/** A picture smaller than this on either side holds no text a person reads. */
const MIN_SIDE = 16;
/** At most this many pictures per page or state; the rest are named as not read. */
const MAX_PICTURES = 120;

/** What text recognition found in one picture, or why it did not read it. */
export type PictureOcr = Pick<OcrAnswer, "hasText" | "text" | "words" | "confidence" | "sparseWords"> | { notReadNl: string };

export interface PictureText {
  /** The element (img, svg, canvas, object) or "achtergrond" for an element with a background image. */
  kind: string;
  tag: string;
  where: string;
  region: string | null;
  src: string | null;
  /** The text alternative in the code: alt, aria-label or the title of a drawing. */
  alt: string | null;
  /** For a background image: the text of the element itself, which recognition reads along. */
  ownText: string;
  box: { x: number; y: number; width: number; height: number };
  /** Hash of the picture as it was drawn: the same picture on another page is read once. */
  sha256: string | null;
  crop: string | null;
  ocr: PictureOcr;
}

export interface PictureReport {
  pictures: PictureText[];
  /** Pictures read here; the others were read before under the same hash, or not read. */
  recognised: number;
  /** Set when text recognition is not available on this machine. */
  unavailableNl?: string;
}

/**
 * What recognition found per hash of a picture, kept for the whole sweep. A reading that is still
 * under way is there as a promise: a page measured at the same time waits for it instead of reading the picture again.
 * The promise gives null when recognition is not available on this machine: the page that waited then finds that out itself.
 */
export type PictureCache = Map<string, PictureOcr | Promise<PictureOcr | null>>;

/**
 * Set `recognised` of each report to what it would have been with one page after the other, in the
 * order given: a picture counts on the first report that has it, and a picture read before (`seen`)
 * counts on none. Pages measured at the same time read a shared picture once, but not always on the
 * page that comes first. Returns the indexes of the reports that changed; `seen` is extended.
 */
export function recountRecognised(reports: PictureReport[], seen: Set<string>): number[] {
  const changed: number[] = [];
  for (const [index, report] of reports.entries()) {
    // Without text recognition nothing is read and nothing is kept for a later page.
    if (report.unavailableNl) continue;
    let recognised = 0;
    for (const picture of report.pictures) {
      if (picture.sha256 === null || seen.has(picture.sha256)) continue;
      seen.add(picture.sha256);
      if (!("notReadNl" in picture.ocr)) recognised++;
    }
    if (recognised !== report.recognised) {
      report.recognised = recognised;
      changed.push(index);
    }
  }
  return changed;
}

/**
 * Every picture on the page as it is now, cut out as it is drawn and read with text recognition
 * (WCAG 1.4.5): images, drawings, canvases and elements with a background image. The same picture
 * is read once in a sweep. Nothing is judged: a text in a logo is listed like a text in a banner.
 */
export async function picturesWithText(page: Page, dir: string, relative: string, cache: PictureCache): Promise<PictureReport> {
  type Found = { kind: string; tag: string; path: string[]; region: string | null; src: string | null; alt: string | null; ownText: string; box: PictureText["box"] };
  const found = await call<Found[]>(page, "pictures");
  const pictures: PictureText[] = [];
  let recognised = 0;
  let unavailableNl: string | undefined;
  const work = await mkdtemp(join(tmpdir(), "loep-pictures-"));
  try {
    for (const [index, picture] of found.entries()) {
      const base = { kind: picture.kind, tag: picture.tag, where: picture.path.join(" >>> "), region: picture.region, src: picture.src, alt: picture.alt, ownText: picture.ownText, box: picture.box };
      if (index >= MAX_PICTURES) {
        pictures.push({ ...base, sha256: null, crop: null, ocr: { notReadNl: `niet gelezen: meer dan ${MAX_PICTURES} afbeeldingen op deze pagina` } });
        continue;
      }
      if (picture.box.width < MIN_SIDE || picture.box.height < MIN_SIDE) {
        pictures.push({ ...base, sha256: null, crop: null, ocr: { notReadNl: `kleiner dan ${MIN_SIDE} pixels: daar past geen leesbare tekst in` } });
        continue;
      }
      const handle = (await page.evaluateHandle((chain) => (window as unknown as { __loep: { resolve: (chain: string[]) => HTMLElement | null } }).__loep.resolve(chain), picture.path)).asElement();
      const shot = handle ? await handle.screenshot({ animations: "disabled", timeout: 3000 }).catch(() => null) : null;
      if (!shot) {
        pictures.push({ ...base, sha256: null, crop: null, ocr: { notReadNl: "de afbeelding was niet uit te snijden (niet in beeld te brengen of van de pagina verdwenen)" } });
        continue;
      }
      const hash = sha256(shot);
      const name = `${hash.slice(0, 16)}.png`;
      if (!existsSync(join(dir, name))) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, name), shot);
      }
      let read: PictureOcr | undefined = (await cache.get(hash)) ?? undefined;
      if (!read && unavailableNl) read = { notReadNl: unavailableNl };
      if (!read) {
        const path = join(work, name);
        await writeFile(path, shot);
        const reading = ocr(path, { sparse: true }).then(
          (answer): PictureOcr => ({ hasText: answer.hasText, text: answer.text, words: answer.words, confidence: answer.confidence, ...(answer.sparseWords !== undefined ? { sparseWords: answer.sparseWords } : {}) }),
          (error: Error): PictureOcr => {
            if (error instanceof Unavailable) unavailableNl = `tekstherkenning is op deze machine niet beschikbaar: ${error.message}`;
            return { notReadNl: unavailableNl ?? `tekstherkenning gaf geen antwoord: ${(error.message ?? String(error)).split("\n")[0]}` };
          },
        );
        // Whoever asks for the same picture in the meantime waits for this reading.
        cache.set(hash, reading.then((answer) => (unavailableNl ? null : answer)));
        read = await reading;
        if (unavailableNl) cache.delete(hash);
        else {
          cache.set(hash, read);
          if (!("notReadNl" in read)) recognised++;
        }
      }
      pictures.push({ ...base, sha256: hash, crop: `${relative}/${name}`, ocr: read });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return { pictures, recognised, ...(unavailableNl ? { unavailableNl } : {}) };
}
