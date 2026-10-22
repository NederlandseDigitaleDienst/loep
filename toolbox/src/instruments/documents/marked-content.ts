import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tool } from "../../lib/typst.ts";

/**
 * Poppler reads the text of a tag by its marked-content id (MCID), and ends that text at the
 * first EMC inside it, also the EMC of a marked-content sequence nested in it without an MCID
 * of its own. A generator that wraps a ligature in `/Span <</ActualText (fi)>> BDC ... EMC`
 * inside the text of a link so cuts the text of the link off at the ligature, while a
 * screen reader reads the whole word (#325). For reading the text of the tags, such nested
 * sequences are left out of a copy of the file: what they contain stays.
 */

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([...("()<>[]{}/%" as string)].map((char) => char.charCodeAt(0)));

interface Open {
  mcid: number | null;
  /** Whether this sequence is left out: it has no MCID and stands inside one that has. */
  dropped: boolean;
}

/** The nesting of marked content, carried from one content stream of a page to the next. */
export type MarkedStack = Open[];

/**
 * The content stream with every marked-content sequence that has no MCID and stands inside one
 * that has, taken out: its BDC or BMC with the operands, and its EMC. Text and drawing stay
 * as they were. `content` is read as latin1, byte for byte.
 */
export function flattenNestedMarkedContent(content: string, stack: MarkedStack = []): { content: string; removed: number } {
  const cuts: [number, number][] = [];
  let operandsFrom = -1;
  let operands: string[] = [];
  let removed = 0;
  let at = 0;
  const length = content.length;
  const code = (index: number): number => content.charCodeAt(index);
  while (at < length) {
    const char = code(at);
    if (WHITE.has(char)) {
      at++;
      continue;
    }
    const start = at;
    if (char === 0x25 /* % */) {
      while (at < length && code(at) !== 0x0a && code(at) !== 0x0d) at++;
      continue;
    }
    if (char === 0x28 /* ( */) {
      let depth = 0;
      for (; at < length; at++) {
        const inner = code(at);
        if (inner === 0x5c /* \ */) at++;
        else if (inner === 0x28) depth++;
        else if (inner === 0x29 && --depth === 0) break;
      }
      at++;
    } else if (char === 0x3c /* < */ && code(at + 1) === 0x3c) {
      // A dictionary is one operand, with what is nested in it.
      let depth = 0;
      for (; at < length; at++) {
        if (code(at) === 0x28) {
          let strings = 0;
          for (; at < length; at++) {
            const inner = code(at);
            if (inner === 0x5c) at++;
            else if (inner === 0x28) strings++;
            else if (inner === 0x29 && --strings === 0) break;
          }
        } else if (code(at) === 0x3c && code(at + 1) === 0x3c) {
          depth++;
          at++;
        } else if (code(at) === 0x3e && code(at + 1) === 0x3e) {
          at++;
          if (--depth === 0) break;
        }
      }
      at++;
    } else if (char === 0x3c) {
      while (at < length && code(at) !== 0x3e) at++;
      at++;
    } else if (char === 0x2f /* / */) {
      at++;
      while (at < length && !WHITE.has(code(at)) && !DELIMITERS.has(code(at))) at++;
    } else if (DELIMITERS.has(char)) {
      at++;
    } else {
      while (at < length && !WHITE.has(code(at)) && !DELIMITERS.has(code(at))) at++;
      const word = content.slice(start, at);
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) && word !== "true" && word !== "false" && word !== "null") {
        if (word === "BI") {
          // An inline image: its bytes run to EI between white space and are no operators.
          const end = /\sEI(?=\s|$)/g;
          end.lastIndex = content.indexOf("ID", at) + 2;
          const found = end.exec(content);
          at = found ? found.index + found[0].length : length;
        } else if (word === "BDC" || word === "BMC") {
          const properties = word === "BDC" ? (operands[1] ?? "") : "";
          const mcid = /\/MCID\s+(\d+)/.exec(properties.startsWith("<<") ? properties : "");
          const inside = stack.some((open) => open.mcid !== null && !open.dropped);
          const dropped = mcid === null && inside;
          stack.push({ mcid: mcid ? Number(mcid[1]) : null, dropped });
          if (dropped) {
            cuts.push([operandsFrom >= 0 ? operandsFrom : start, at]);
            removed++;
          }
        } else if (word === "EMC") {
          if (stack.pop()?.dropped) cuts.push([start, at]);
        }
        operands = [];
        operandsFrom = -1;
        continue;
      }
    }
    if (operandsFrom < 0) operandsFrom = start;
    operands.push(content.slice(start, at));
  }
  if (cuts.length === 0) return { content, removed: 0 };
  let out = "";
  let from = 0;
  for (const [cutFrom, cutTo] of cuts) {
    out += content.slice(from, cutFrom);
    from = cutTo;
  }
  return { content: out + content.slice(from), removed };
}

/**
 * A copy of the PDF in which the text of every tag can be read whole, or null when nothing in
 * it needs that or qpdf is not there. Made with qpdf in its form for editing (QDF), the content
 * streams of the pages rewritten, and written again by qpdf, which finds the new length of each
 * stream and the place of each object itself. (fix-qdf would do that too, but before qpdf 12 it
 * takes no file to write to.)
 */
export async function readableTagCopy(pdf: string, scratch: string, timeoutMs: number): Promise<{ path: string; removed: number } | null> {
  const qdf = join(scratch, "marked.qdf");
  const edited = join(scratch, "marked-edited.qdf");
  const copy = join(scratch, "marked.pdf");
  try {
    const made = await tool("qpdf", ["--qdf", "--object-streams=disable", pdf, qdf], timeoutMs);
    if (!made.found || !(await stat(qdf).catch(() => null))) return null;
    const text = await readFile(qdf, "latin1");
    const stacks = new Map<string, MarkedStack>();
    let out = "";
    let from = 0;
    let removed = 0;
    const marker = "%% Contents for page ";
    for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) {
      const page = text.slice(at + marker.length, text.indexOf("\n", at));
      const begin = text.indexOf("\nstream\n", at);
      const end = begin < 0 ? -1 : text.indexOf("\nendstream", begin + 8);
      if (begin < 0 || end < 0) break;
      const stack = stacks.get(page) ?? [];
      stacks.set(page, stack);
      const flattened = flattenNestedMarkedContent(text.slice(begin + 8, end), stack);
      removed += flattened.removed;
      out += text.slice(from, begin + 8) + flattened.content;
      from = end;
      at = end;
    }
    if (removed === 0) return null;
    await writeFile(edited, out + text.slice(from), "latin1");
    // qpdf ends with 3 when it had to find lengths and places itself, and still writes the file.
    const fixed = await tool("qpdf", [edited, copy], timeoutMs);
    if (!fixed.found || !(await stat(copy).catch(() => null))) return null;
    return { path: copy, removed };
  } finally {
    await rm(qdf, { force: true });
    await rm(edited, { force: true });
  }
}
