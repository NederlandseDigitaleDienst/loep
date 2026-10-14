import { inflateRawSync } from "node:zlib";

/**
 * Reading office files with what Node has. An OOXML or ODF file is a zip archive of XML
 * parts: the archive is read from its central directory, and the XML with a small parser
 * that keeps element names as the file writes them, prefix included ("w:p", "text:h").
 */

/** No part of an office file is unpacked beyond this; a larger one is not read. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

export interface Zip {
  names: string[];
  /** The bytes of one part; null when the archive has no such part. Throws on a part that is too large or packed in a way that is not read. */
  read: (name: string) => Buffer | null;
  text: (name: string) => string | null;
}

export function openZip(bytes: Buffer): Zip {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("het bestand is geen zip-archief; een kantoorbestand van deze soort hoort dat te zijn");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, { method: number; packed: number; size: number; offset: number }>();
  for (let index = 0; index < count && at + 46 <= bytes.length; index++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) break;
    const nameLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    entries.set(name, { method: bytes.readUInt16LE(at + 10), packed: bytes.readUInt32LE(at + 20), size: bytes.readUInt32LE(at + 24), offset: bytes.readUInt32LE(at + 42) });
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  const read = (name: string): Buffer | null => {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.size > MAX_PART_BYTES) throw new Error(`het onderdeel ${name} is groter dan ${MAX_PART_BYTES / 1024 / 1024} MB en is niet gelezen`);
    const start = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
    const packed = bytes.subarray(start, start + entry.packed);
    if (entry.method === 0) return Buffer.from(packed);
    if (entry.method === 8) return inflateRawSync(packed, { maxOutputLength: MAX_PART_BYTES });
    throw new Error(`het onderdeel ${name} is ingepakt op een manier die niet wordt gelezen (methode ${entry.method})`);
  };
  return { names: [...entries.keys()], read, text: (name) => read(name)?.toString("utf8") ?? null };
}

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value: string): string =>
  value.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML part into a tree. White space with a line break in it is the layout of the file and is dropped; a single space between two elements is text. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  for (const token of source.matchAll(TOKEN)) {
    const [, cdata, closing, opening, attributes, selfClosing, chars] = token;
    const top = stack.at(-1)!;
    if (cdata !== undefined) top.children.push(cdata);
    else if (closing !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (opening !== undefined) {
      const node: XmlNode = { name: opening, attrs: {}, children: [] };
      for (const attribute of (attributes ?? "").matchAll(ATTRIBUTE)) node.attrs[attribute[1]!] = decode(attribute[2] ?? attribute[3] ?? "");
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (chars !== undefined && (chars.trim() !== "" || top.attrs["xml:space"] === "preserve" || (stack.length > 1 && !chars.includes("\n")))) top.children.push(decode(chars));
  }
  return root;
}

export const elements = (node: XmlNode): XmlNode[] => node.children.filter((child): child is XmlNode => typeof child !== "string");
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => (node ? elements(node).find((entry) => entry.name === name) : undefined);
export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] => (node ? elements(node).filter((entry) => entry.name === name) : []);

/** Every descendant with one of the names, in document order. `stopAt` names are not entered. */
export function* descendants(node: XmlNode, names: string[], stopAt: string[] = []): Generator<XmlNode> {
  for (const entry of elements(node)) {
    if (names.includes(entry.name)) yield entry;
    if (!stopAt.includes(entry.name)) yield* descendants(entry, names, stopAt);
  }
}

export const first = (node: XmlNode | undefined, name: string): XmlNode | undefined => (node ? descendants(node, [name]).next().value : undefined) as XmlNode | undefined;

/** All text below a node, in document order. */
export function allText(node: XmlNode | string): string {
  return typeof node === "string" ? node : node.children.map(allText).join("");
}
