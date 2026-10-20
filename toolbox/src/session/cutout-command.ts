import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { PNG } from "pngjs";
import { sha256 } from "../lib/canonical.ts";
import { UsageError, type Options, type Outcome } from "./commands.ts";
import type { Images } from "./observations.ts";

/** The picture a cutout comes from: a PNG file inside the run, given relative to it (as the dossier and the answers name it) or in full. */
function pictureIn(runDir: string, given: string | undefined): { absolute: string; relative: string } {
  if (!given) throw new UsageError("cutout verwacht het pad van een schermafbeelding in de run, zoals het dossier of een eerder antwoord het noemt (pages/<pagina>/screenshot-light.png), en --at x,y,breedte,hoogte");
  const root = realpathSync(runDir);
  const candidate = isAbsolute(given) ? given : join(root, given);
  if (!existsSync(candidate)) throw new UsageError(`er is geen bestand ${given} in de run; geef het pad zoals het dossier of een eerder antwoord het noemt`);
  const absolute = realpathSync(candidate);
  if (!absolute.startsWith(`${root}${sep}`)) throw new UsageError(`${given} ligt buiten de run; cutout snijdt alleen uit een schermafbeelding van deze run`);
  if (!absolute.toLowerCase().endsWith(".png")) throw new UsageError(`${given} is geen png; cutout snijdt uit de schermafbeeldingen van de run, en die zijn png`);
  return { absolute, relative: relative(root, absolute) };
}

function boxOf(at: string | boolean | undefined, width: number, height: number, picture: string): { x: number; y: number; width: number; height: number } {
  const numbers = typeof at === "string" ? at.split(",").map((part) => Number(part.trim())) : [];
  if (numbers.length !== 4 || numbers.some((value) => !Number.isInteger(value)) || numbers[2]! < 1 || numbers[3]! < 1 || numbers[0]! < 0 || numbers[1]! < 0) {
    throw new UsageError(`cutout verwacht --at x,y,breedte,hoogte in hele pixels vanaf de linkerbovenhoek van de schermafbeelding, zoals --at 0,120,640,300; ${picture} is ${width} bij ${height} pixels`);
  }
  const [x, y, w, h] = numbers as [number, number, number, number];
  if (x + w > width || y + h > height) throw new UsageError(`het kader ${x},${y},${w},${h} valt buiten de schermafbeelding: ${picture} is ${width} bij ${height} pixels. Kies een kader binnen 0,0,${width},${height}`);
  return { x, y, width: w, height: h };
}

/**
 * A piece of a picture that is already in the run, such as a screenshot of the sweep, to look at
 * more closely. No page has to be open and nothing is measured on the site: the observation names
 * the picture it came from, with its sha256, and the box, so anyone can cut the same piece again.
 */
export async function cutoutOutcome(runDir: string, args: string[], options: Options, images: Images): Promise<Outcome> {
  const picture = pictureIn(runDir, args[0]);
  const bytes = await readFile(picture.absolute);
  let source: PNG;
  try {
    source = PNG.sync.read(bytes);
  } catch {
    throw new UsageError(`${picture.relative} is geen leesbare png`);
  }
  const box = boxOf(options.at, source.width, source.height, picture.relative);
  const piece = new PNG({ width: box.width, height: box.height });
  PNG.bitblt(source, piece, box.x, box.y, box.width, box.height, 0, 0);
  const path = images.image();
  await writeFile(path, PNG.sync.write(piece));
  return {
    result: { from: picture.relative, fromSha256: sha256(bytes), at: box, pictureSize: { width: source.width, height: source.height } },
    print: { image: images.relative(path), from: picture.relative, at: `${box.x},${box.y},${box.width},${box.height}`, size: `${box.width}x${box.height} uit ${source.width}x${source.height}` },
  };
}
