import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { maskBytes, maskText } from "./secrets.ts";

/**
 * Canonical JSON: object keys sorted, two-space indent, trailing newline. Every
 * file the toolbox writes goes through here so that the same input always gives
 * the same bytes, and a hash of the file means something.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = sortKeys(entry);
    }
    return sorted;
  }
  return value;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Short, stable identifier derived from the parts that define a thing. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join("\u0000")).slice(0, 12)}`;
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

/**
 * Atomic write, so an interrupted run never leaves a truncated file behind. In a run with secrets what
 * is written goes through the mask first (`secrets.ts`): this is where a value that got past the
 * boundary stops, and is noted.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, typeof data === "string" ? maskText(path, data) : maskBytes(path, data));
  await rename(temporary, path);
}

/** Add a line to a log of a run, with the same mask. */
export function appendRunLine(path: string, line: string): void {
  appendFileSync(path, maskText(path, line));
}

export async function writeJson(path: string, value: unknown): Promise<string> {
  const text = maskText(path, canonicalJson(value));
  await writeFileAtomic(path, text);
  return sha256(text);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/**
 * The labels pages go by everywhere, by position in the sample: "P1", or "P01" when the
 * sample has ten pages or more. `minWidth` widens them to labels that are already in use.
 */
export function pageLabels(count: number, minWidth = 0): string[] {
  const width = Math.max(String(count).length, minWidth);
  return Array.from({ length: count }, (_item, index) => `P${String(index + 1).padStart(width, "0")}`);
}

/** Filesystem-safe slug for a URL path, stable and readable in a directory listing. */
export function slugForUrl(url: string): string {
  const { pathname, search } = new URL(url);
  const readable = (pathname + search)
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${readable || "home"}-${sha256(url).slice(0, 8)}`;
}
