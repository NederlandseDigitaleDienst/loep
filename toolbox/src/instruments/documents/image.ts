import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decode } from "jpeg-js";
import { PNG } from "pngjs";
import type { DocumentFacts, ImageFacts } from "../../lib/documents.ts";
import { ocr } from "../methods/ocr.ts";

/** A picture larger than this is not decoded: it would take more memory than a measurement may. */
const MAX_PIXELS = 50_000_000;

/** The picture of a PNG or JPEG file as a PNG, by the signature of the file, not its name. */
function decodePicture(bytes: Buffer): { format: ImageFacts["format"]; picture: PNG } {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    // The size is in the header chunk that follows the signature: checked before the whole picture is decoded.
    const pixels = bytes.length >= 24 ? bytes.readUInt32BE(16) * bytes.readUInt32BE(20) : 0;
    if (pixels > MAX_PIXELS) throw new Error(`de afbeelding is ${Math.round(pixels / 1_000_000)} miljoen pixels; de grens is ${MAX_PIXELS / 1_000_000} miljoen`);
    return { format: "png", picture: PNG.sync.read(bytes) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1_000_000 });
    const picture = new PNG({ width: jpeg.width, height: jpeg.height });
    picture.data = Buffer.from(jpeg.data);
    return { format: "jpeg", picture };
  }
  throw new Error("het bestand is geen png of jpg, ook al zegt de naam dat");
}

/**
 * Measure a picture file a page links to as a document: its size and the text recognition finds
 * in it. The picture is written as `picture` (a PNG) so the judge can look at it. Nothing here
 * judges whether the text in it could have been text.
 */
export async function measureImage(file: string, picturePath: string, scratch: string): Promise<{ facts: Partial<DocumentFacts>; text: string }> {
  const { format, picture } = decodePicture(await readFile(file));
  const png = PNG.sync.write(picture);
  await writeFile(picturePath, png);
  const notMeasuredNl: string[] = [];
  let recognised: { words: number; text: string } | null = null;
  try {
    // On a copy in the scratch directory: recognition writes an enlarged picture next to what it reads.
    const copy = join(scratch, "picture.png");
    await writeFile(copy, png);
    recognised = await ocr(copy);
  } catch (error) {
    notMeasuredNl.push(`tekstherkenning is niet beschikbaar (${((error as Error).message ?? String(error)).split("\n")[0]!.slice(0, 140)}); of de afbeelding tekst bevat, is niet nagegaan`);
  }
  const image: ImageFacts = { format, width: picture.width, height: picture.height, recognisedWords: recognised?.words ?? null, recognisedText: recognised?.text ?? null };
  return {
    facts: {
      pages: 1,
      image,
      // The file is the picture itself: there is nowhere in it to put a text alternative.
      images: [{ page: 1, alt: null, context: `het bestand zelf: een afbeelding van ${picture.width} bij ${picture.height} pixels` }],
      notMeasuredNl,
    },
    text: `=== pagina 1 ===\n${recognised ? recognised.text : ""}\n`,
  };
}
