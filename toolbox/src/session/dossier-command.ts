import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, sha256 } from "../lib/canonical.ts";
import { underSeal } from "../lib/seal.ts";
import { chunksOf, dossierReads, dossierReadsPath, nameOf, partsOf, readProgress, readsOfSession, requiredParts, resolvePart, SMALL_PART, valueAt, type DossierRead, type DossierReadResult } from "../lib/dossier-view.ts";

/** What `dossier` hands back: a line of JSON, the text under it, and what was shown, for the log of the session. */
export interface DossierAnswer {
  print: Record<string, unknown>;
  text: string;
  result: DossierReadResult;
}

interface IndexTask {
  criterion: string;
  dossier: string;
  judge: { session: string };
  verify?: { session: string } | null;
  finish?: { session: string } | null;
}

const MAX_KEYS_SHOWN = 12;
const thousands = (value: number): string => value.toLocaleString("nl-NL");

/** The dossier a session reads: that of the task the session belongs to, or of the criterion it names. */
async function dossierFor(runDir: string, session: string, criterion: string | undefined): Promise<{ criterion: string; dossier: string }> {
  const indexPath = join(runDir, "tasks", "index.json");
  const tasks = existsSync(indexPath) ? ((await readJson<{ tasks?: IndexTask[] }>(indexPath)).tasks ?? []) : [];
  if (criterion !== undefined) {
    const task = tasks.find((entry) => entry.criterion === criterion);
    const dossier = task?.dossier ?? join("tasks", criterion, "dossier.json");
    if (!existsSync(join(runDir, dossier))) throw new Error(`er is geen dossier voor ${criterion} in deze run`);
    return { criterion, dossier };
  }
  const own = tasks.find((entry) => [entry.judge.session, entry.verify?.session, entry.finish?.session].includes(session));
  if (!own) throw new Error(`sessie "${session}" hoort bij geen opdracht met een dossier; geef het criterium op met --criterion <nummer>`);
  return { criterion: own.criterion, dossier: own.dossier };
}

/** The keys inside a part, as the overview names them. */
function insideOf(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "rij" : "rijen"}`;
  if (value === null || typeof value !== "object") return "";
  const entries = Object.entries(value as Record<string, unknown>);
  const say = ([key, entry]: [string, unknown]): string => (Array.isArray(entry) ? `${key} (${entry.length})` : entry !== null && typeof entry === "object" ? `${key} (${Object.keys(entry).length})` : key);
  if (entries.length <= MAX_KEYS_SHOWN) return entries.map(say).join(", ");
  return `${[...entries.slice(0, MAX_KEYS_SHOWN - 2).map(say), "...", ...entries.slice(-2).map(say)].join(", ")} (${entries.length} sleutels)`;
}

/**
 * `dossier`: the parts of the dossier with their size and, for the parts the criterion counts on,
 * how far this session has read them; the small parts in full. `dossier <part> [chunk]`: one
 * part, one page or state in it (`legend.P03`), or anything deeper, in the compact form, in chunks.
 */
export async function dossierAnswer(runDir: string, session: string, args: string[], criterionAsked: string | undefined): Promise<DossierAnswer> {
  const { criterion, dossier: relative } = await dossierFor(runDir, session, criterionAsked);
  const text = await readFile(join(runDir, relative), "utf8");
  const dossier = JSON.parse(text) as Record<string, unknown>;
  const head = { dossier: relative, dossierSha256: sha256(text), criterion };

  if (args.length === 0) {
    const earlier = dossierReads(readsOfSession(runDir, session), relative, head.dossierSha256);
    const required = requiredParts(dossier).map((path) => JSON.stringify(path));
    const shown: DossierRead[] = [];
    const counted: string[] = [];
    const lookup: string[] = [];
    const small: string[] = [];
    for (const path of partsOf(dossier)) {
      const value = valueAt(dossier, path);
      const chunks = chunksOf(value);
      const name = nameOf(dossier, path);
      const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (chunks.length === 1 && size <= SMALL_PART) {
        shown.push({ path, chunk: 1, chunks: 1 });
        small.push(`${name}:\n${chunks[0]!.split("\n").map((line) => `  ${line}`).join("\n")}`);
        if (required.includes(JSON.stringify(path))) counted.push(`  ${name}: ${thousands(size)} tekens, hieronder voluit`);
        continue;
      }
      const inside = insideOf(value);
      const sizeNl = `${thousands(size)} tekens in ${chunks.length} ${chunks.length === 1 ? "deel" : "delen"}`;
      if (required.includes(JSON.stringify(path))) {
        const progress = readProgress(dossier, path, earlier);
        counted.push(`  ${name}: ${sizeNl}, ${progress.complete ? "helemaal gelezen" : `gelezen ${progress.read} van ${progress.of}`}${inside ? `. Bevat: ${inside}` : ""}`);
      } else lookup.push(`  ${name}: ${sizeNl}${inside ? `. Bevat: ${inside}` : ""}`);
    }
    const lines = [
      `Dossier voor ${criterion}. Lees een onderdeel met: loep dossier <onderdeel> [deel]. Dieper kan met een punt: een pagina (legend.P03), een rij (rows.4) of een veld.`,
      "",
      "Telt voor dit criterium. Lees deze helemaal; een oordeel \"passed\" kan pas als dat in deze sessie is gebeurd:",
      ...(counted.length > 0 ? counted : ["  (geen)"]),
      "",
      "Zoek op waar je het nodig hebt, per pagina of toestand:",
      ...(lookup.length > 0 ? lookup : ["  (geen)"]),
      ...(small.length > 0 ? ["", "Klein, hier voluit:", ...small] : []),
    ];
    const result: DossierReadResult = { ...head, read: shown };
    return { result, print: { dossier: relative, criterion, note: "overzicht; de onderdelen staan hieronder" }, text: lines.join("\n") };
  }

  const name = args[0]!;
  const path = resolvePart(dossier, name);
  if (!path) throw new Error(`het dossier heeft geen onderdeel "${name}"; kies uit: ${partsOf(dossier).map((part) => nameOf(dossier, part)).join(", ")}`);
  const chunks = chunksOf(valueAt(dossier, path));
  const chunk = args[1] === undefined ? 1 : Number(args[1]);
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > chunks.length) throw new Error(`${nameOf(dossier, path)} heeft ${chunks.length} ${chunks.length === 1 ? "deel" : "delen"}; geef een deel van 1 tot en met ${chunks.length}`);
  const shownName = nameOf(dossier, path);
  const result: DossierReadResult = { ...head, read: [{ path, chunk, chunks: chunks.length }] };
  return {
    result,
    print: {
      dossier: shownName,
      part: `deel ${chunk} van ${chunks.length}`,
      ...(chunk < chunks.length ? { next: `loep dossier ${shownName} ${chunk + 1}` } : {}),
      ...(chunks[chunk - 1]!.includes(", kolommen [") ? { note: "een rij in een tabel is een JSON-lijst met de waarden in de volgorde van de kolommen" } : {}),
    },
    text: chunks[chunk - 1]!,
  };
}

/** Keep what was shown in the log of the session, so check-verdict can see which parts were read in full. */
export function recordDossierRead(runDir: string, session: string, result: DossierReadResult): void {
  const path = join(runDir, dossierReadsPath(session));
  // Reading the dossier of a sealed run is reading; the log of what was read is sealed as it was.
  if (underSeal(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`);
}
