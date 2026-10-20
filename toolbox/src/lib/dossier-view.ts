import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The dossier as an agent reads it: through a command instead of its own scripts. Nothing is
 * left out. A part is shown in a compact form (a list of rows with the same fields becomes a
 * table with one header), long parts come in numbered chunks, and every read is kept in the log
 * of the session, so check-verdict can tell whether the parts a criterion counts on were read in
 * full. Reading is not a measurement: it needs no browser, no started session and no budget.
 */

/** At most this many characters per chunk: well under what a shell hands back in one go (30.000). */
export const MAX_CHUNK = 20_000;
/** A part this small is shown in full in the overview. */
export const SMALL_PART = 600;
/** A value whose JSON is longer than this gets lines of its own. */
const INLINE = 80;

export interface DossierRead {
  /** The keys from the root of the dossier to the part that was shown. */
  path: string[];
  chunk: number;
  chunks: number;
}

/** What a read of the dossier keeps: which dossier, in which version, and what was shown of it. */
export interface DossierReadResult {
  dossier: string;
  dossierSha256: string;
  criterion: string;
  read: DossierRead[];
}

interface Line {
  text: string;
  /** The header lines of the containers this line is in, to repeat at the top of a later chunk. */
  context: string[];
  /** The rest of a line that was too long for one chunk. */
  continued?: boolean;
}

const json = (value: unknown): string => JSON.stringify(value);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const NUMBER = /^-?\d+(\.\d+)?$/;

/** A plain value: a string as it is, unless it could be read as something else. */
function scalar(value: unknown): string {
  if (typeof value !== "string") return json(value);
  if (value === "" || value.trim() !== value || /[\n\r\t]/.test(value) || ["null", "true", "false"].includes(value) || /^[[{"-]/.test(value) || NUMBER.test(value)) return json(value);
  return value;
}

const inline = (value: unknown): string => (isObject(value) || Array.isArray(value) ? json(value) : scalar(value));
const isTable = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.length > 0 && value.every(isObject);

function tableLines(rows: Record<string, unknown>[], indent: string, label: string, context: string[], out: Line[]): void {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const header = `${indent}${label}${rows.length} ${rows.length === 1 ? "rij" : "rijen"}, kolommen ${json(columns)}`;
  out.push({ text: header, context });
  const inner = [...context, header.trim()];
  for (const row of rows) out.push({ text: `${indent}  ${json(columns.map((column) => (column in row ? row[column] : null)))}`, context: inner });
}

function render(value: unknown, depth: number, context: string[], out: Line[]): void {
  const indent = "  ".repeat(depth);
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (isTable(entry)) tableLines(entry, indent, `${key}: `, context, out);
      else if ((isObject(entry) || Array.isArray(entry)) && json(entry).length > INLINE) {
        const header = `${indent}${key}:`;
        out.push({ text: header, context });
        render(entry, depth + 1, [...context, header.trim()], out);
      } else out.push({ text: `${indent}${key}: ${inline(entry)}`, context });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, position) => {
      if ((isObject(entry) || Array.isArray(entry)) && json(entry).length > INLINE) {
        const header = `${indent}- (${position})`;
        out.push({ text: header, context });
        render(entry, depth + 1, [...context, header.trim()], out);
      } else out.push({ text: `${indent}- ${inline(entry)}`, context });
    });
    return;
  }
  out.push({ text: `${indent}${scalar(value)}`, context });
}

/** The lines of one value of the dossier in the compact form. A list of rows with the same fields is a table: the field names once, then one JSON list per row. */
export function compactLines(value: unknown): Line[] {
  const out: Line[] = [];
  if (isTable(value)) tableLines(value, "", "", [], out);
  else if ((isObject(value) || Array.isArray(value)) && Object.keys(value).length === 0) out.push({ text: json(value), context: [] });
  else render(value, 0, [], out);
  return out;
}

/** The compact form in chunks of at most `max` characters, split between lines; a line longer than that is split itself. */
export function chunksOf(value: unknown, max = MAX_CHUNK): string[] {
  const lines: Line[] = [];
  for (const line of compactLines(value)) {
    if (line.text.length <= max) lines.push(line);
    else for (let at = 0; at < line.text.length; at += max) lines.push({ text: line.text.slice(at, at + max), context: line.context, ...(at > 0 ? { continued: true } : {}) });
  }
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (current.length > 0 && size + line.text.length + 1 > max) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    if (current.length === 0 && chunks.length > 0) {
      // A later chunk says where it goes on, so it can be read on its own.
      const lead = line.continued ? "(vervolg van de laatste regel van het vorige deel)" : line.context.length > 0 ? `(vervolg van: ${line.context.join(" > ")})` : "";
      if (lead) {
        current.push(lead.slice(0, 1000));
        size += Math.min(lead.length, 1000) + 1;
      }
    }
    current.push(line.text);
    size += line.text.length + 1;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current.join("\n"));
  return chunks;
}

/** The value at a path of keys, or undefined. */
export function valueAt(root: unknown, path: string[]): unknown {
  let value = root;
  for (const key of path) {
    if (Array.isArray(value) && /^\d+$/.test(key)) value = value[Number(key)];
    else if (isObject(value) && key in value) value = value[key];
    else return undefined;
  }
  return value;
}

/** Keys from a dotted name: a key with dots in it (a criterion, an address) is found as a whole. */
function keysFor(root: unknown, segments: string[]): string[] | null {
  if (segments.length === 0) return [];
  if (Array.isArray(root)) {
    if (!/^\d+$/.test(segments[0]!) || Number(segments[0]) >= root.length) return null;
    const rest = keysFor(root[Number(segments[0])], segments.slice(1));
    return rest ? [segments[0]!, ...rest] : null;
  }
  if (!isObject(root)) return null;
  for (let length = segments.length; length > 0; length--) {
    const key = segments.slice(0, length).join(".");
    if (!(key in root)) continue;
    const rest = keysFor(root[key], segments.slice(length));
    if (rest) return [key, ...rest];
  }
  return null;
}

/**
 * The path a name points at. The procedures write the parts of `evidence` short (`keyboard.walk`),
 * so a name that is not a part at the top is looked up under `evidence`.
 */
export function resolvePart(dossier: Record<string, unknown>, name: string): string[] | null {
  const segments = name.split(".").filter(Boolean);
  if (segments.length === 0) return null;
  const top = keysFor(dossier, segments);
  if (top) return top;
  const inEvidence = isObject(dossier.evidence) ? keysFor(dossier.evidence, segments) : null;
  return inEvidence ? ["evidence", ...inEvidence] : null;
}

/** The name an agent types for a path: a part of `evidence` without that word, unless a part at the top has the same name. */
export function nameOf(dossier: Record<string, unknown>, path: string[]): string {
  if (path[0] === "evidence" && path.length > 1 && !(path[1]! in dossier)) return path.slice(1).join(".");
  return path.join(".");
}

/** The parts of the dossier: everything at the top but `evidence`, and every part of `evidence`. */
export function partsOf(dossier: Record<string, unknown>): string[][] {
  const top = Object.keys(dossier).filter((key) => key !== "evidence").map((key) => [key]);
  const evidence = isObject(dossier.evidence) ? Object.keys(dossier.evidence).map((key) => ["evidence", key]) : [];
  return [...evidence, ...top];
}

/**
 * The parts this criterion counts on, which the judge reads in full: the parts of `evidence` (what
 * the procedure asks for) and, when the states of the site model were measured, `siteStates`.
 */
export function requiredParts(dossier: Record<string, unknown>): string[][] {
  return [...(isObject(dossier.evidence) ? Object.keys(dossier.evidence).map((key) => ["evidence", key]) : []), ...("siteStates" in dossier ? [["siteStates"]] : [])];
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((key, position) => key === b[position]);
const startsWith = (path: string[], prefix: string[]): boolean => prefix.length < path.length && prefix.every((key, position) => key === path[position]);

/**
 * How far a part has been read: every chunk of it shown, or every part inside it read in full.
 * Only reads of this version of the dossier count.
 */
export function readProgress(dossier: Record<string, unknown>, path: string[], reads: DossierRead[]): { read: number; of: number; complete: boolean } {
  const chunkCount = new Map<string, number>();
  const chunksAt = (at: string[]): number => {
    const key = JSON.stringify(at);
    if (!chunkCount.has(key)) chunkCount.set(key, chunksOf(valueAt(dossier, at)).length);
    return chunkCount.get(key)!;
  };
  const seen = (at: string[]): Set<number> => {
    const of = chunksAt(at);
    return new Set(reads.filter((read) => same(read.path, at) && read.chunks === of && read.chunk >= 1 && read.chunk <= of).map((read) => read.chunk));
  };
  const complete = (at: string[]): boolean => {
    if (seen(at).size === chunksAt(at)) return true;
    if (!reads.some((read) => startsWith(read.path, at))) return false;
    const value = valueAt(dossier, at);
    const children = Array.isArray(value) ? value.map((_, position) => String(position)) : isObject(value) ? Object.keys(value) : [];
    return children.length > 0 && children.every((key) => complete([...at, key]));
  };
  const done = complete(path);
  const of = chunksAt(path);
  return { read: done ? of : seen(path).size, of, complete: done };
}

/** Where a session keeps what it read of the dossier: next to its observations, one line of JSON per read. */
export const dossierReadsPath = (session: string): string => join("observations", session, "dossier-reads.jsonl");

/** Everything a session read of any dossier, oldest first. */
export function readsOfSession(runDir: string, session: string): Partial<DossierReadResult>[] {
  const path = join(runDir, dossierReadsPath(session));
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Partial<DossierReadResult>];
      } catch {
        return [];
      }
    });
}

/** What was read of one version of one dossier. A read of an earlier version does not count: the dossier changed since. */
export function dossierReads(entries: Partial<DossierReadResult>[], dossier: string, sha: string): DossierRead[] {
  return entries.filter((entry) => entry.dossier === dossier && entry.dossierSha256 === sha && Array.isArray(entry.read)).flatMap((entry) => entry.read!);
}

/**
 * What check-verdict says when a judge passes a criterion without having read every part the
 * criterion counts on in full with `dossier`. Empty when all of them were.
 */
export function unreadPartsProblems(dossier: Record<string, unknown>, reads: DossierRead[], session: string): string[] {
  const unread = requiredParts(dossier)
    .map((path) => ({ name: nameOf(dossier, path), ...readProgress(dossier, path, reads) }))
    .filter((entry) => !entry.complete);
  if (unread.length === 0) return [];
  return [
    `a "passed" outcome needs every part of the dossier this criterion counts on read in full with the command dossier in session "${session}"; not read in full: ${unread.map((entry) => `${entry.name} (${entry.read} of ${entry.of} ${entry.of === 1 ? "chunk" : "chunks"} read)`).join(", ")}. Read them with: ${unread.map((entry) => `loep dossier ${entry.name}`).join(", ")} (and each further chunk the answer names)`,
  ];
}
