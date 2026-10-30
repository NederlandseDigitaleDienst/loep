/*
 * Reading a mail. A mail is untrusted input: this code takes a fixed set of things from it and
 * nothing in it is ever passed to a language model. It is parsed here and not by a library
 * because so little is needed: the headers, the text and the addresses of the links.
 */

export interface ParsedMail {
  /** Lower-case names, each with its values. */
  headers: Map<string, string[]>;
  /** The plain text parts, and else the text of the HTML parts. */
  text: string;
  html: string;
}

const MAX_DEPTH = 5;
const MAX_PARTS = 50;

function splitHead(raw: Buffer): { head: string; body: Buffer } {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return { head: raw.toString("latin1"), body: Buffer.alloc(0) };
  const useCrlf = crlf !== -1 && (lf === -1 || crlf < lf);
  const at = useCrlf ? crlf : lf;
  return { head: raw.subarray(0, at).toString("latin1"), body: raw.subarray(at + (useCrlf ? 4 : 2)) };
}

function parseHeaders(head: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return headers;
}

const parameter = (value: string, name: string): string | null => new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value)?.slice(1).find((part) => part !== undefined) ?? null;

function decodeTransfer(body: Buffer, encoding: string): Buffer {
  if (encoding === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (encoding !== "quoted-printable") return body;
  const text = body.toString("latin1").replace(/=\r?\n/g, "");
  return Buffer.from(text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
}

function decodeText(body: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return body.toString("utf8");
  }
}

function collect(raw: Buffer, into: { plain: string[]; html: string[]; parts: number }, depth: number): Map<string, string[]> {
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  if (depth > MAX_DEPTH || into.parts >= MAX_PARTS) return headers;
  into.parts++;
  const type = headers.get("content-type")?.[0] ?? "text/plain";
  const mediaType = type.split(";")[0]!.trim().toLowerCase();
  if (mediaType.startsWith("multipart/")) {
    const boundary = parameter(type, "boundary");
    if (!boundary) return headers;
    const marker = `--${boundary}`;
    const parts = body.toString("latin1").split(marker).slice(1);
    for (const part of parts) {
      if (part.startsWith("--")) break;
      collect(Buffer.from(part.replace(/^\r?\n/, ""), "latin1"), into, depth + 1);
    }
    return headers;
  }
  const decoded = decodeTransfer(body, (headers.get("content-transfer-encoding")?.[0] ?? "").trim().toLowerCase());
  const text = decodeText(decoded, parameter(type, "charset"));
  if (mediaType === "text/plain") into.plain.push(text);
  else if (mediaType === "text/html") into.html.push(text);
  return headers;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const MAX_CODE_POINT = 0x10ffff;

export const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole;
    // A number the mail made up stays as it stands: one mail may not stop the reading of the others.
    const code = decimal ? Number(decimal) : parseInt(hex!, 16);
    return code <= MAX_CODE_POINT ? String.fromCodePoint(code) : whole;
  });

const textOfHtml = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .trim();

/** Read a mail. A body that cannot be read leaves a mail with its headers and without text: who it is for is still known, and one mail never stops the others. */
export function parseMail(raw: Buffer): ParsedMail {
  const into = { plain: [] as string[], html: [] as string[], parts: 0 };
  let headers: Map<string, string[]>;
  try {
    headers = collect(raw, into, 0);
  } catch {
    return { headers: parseHeaders(splitHead(raw).head), text: "", html: "" };
  }
  const html = into.html.join("\n");
  return { headers, text: into.plain.length > 0 ? into.plain.join("\n") : textOfHtml(html), html };
}

const ADDRESS = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+/g;

/** Every address a mail says it was sent to, in lower case. */
export function recipientsOf(mail: ParsedMail): string[] {
  const fields = ["to", "cc", "bcc", "delivered-to", "x-original-to", "envelope-to"].flatMap((name) => mail.headers.get(name) ?? []);
  return fields.flatMap((field) => field.toLowerCase().match(ADDRESS) ?? []);
}

/** Whether a mail is for this address, and for this address exactly: a server that searches on part of an address finds more. */
export const isFor = (mail: ParsedMail, address: string): boolean => recipientsOf(mail).includes(address.toLowerCase());

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
/** Punctuation after an address in a sentence is no part of it. */
const trimUrl = (url: string): string => url.replace(/[.,;:!?)\]}>]+$/, "");

export interface MailLink {
  /** The whole address, as it stands in the mail. */
  url: string;
  /** It was named in the `List-Unsubscribe` header. */
  unsubscribe: boolean;
  /** The header says a mail client may POST there to unsubscribe in one click (RFC 8058). */
  oneClick: boolean;
}

/** Every http(s) address in a mail: in the text, in the HTML and in the header for unsubscribing. Other schemes are not links for this flow. */
export function linksOf(mail: ParsedMail): MailLink[] {
  const found = new Map<string, MailLink>();
  const add = (url: string, unsubscribe = false, oneClick = false): void => {
    const known = found.get(url);
    found.set(url, { url, unsubscribe: unsubscribe || (known?.unsubscribe ?? false), oneClick: oneClick || (known?.oneClick ?? false) });
  };
  for (const match of mail.text.match(URL_IN_TEXT) ?? []) add(trimUrl(match));
  for (const match of mail.html.matchAll(HREF)) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (/^https?:\/\//i.test(href)) add(href);
  }
  for (const match of decodeEntities(mail.html).match(URL_IN_TEXT) ?? []) add(trimUrl(match));
  const oneClick = (mail.headers.get("list-unsubscribe-post") ?? []).some((value) => /List-Unsubscribe=One-Click/i.test(value));
  for (const header of mail.headers.get("list-unsubscribe") ?? []) for (const match of header.matchAll(/<(https?:\/\/[^>]+)>/gi)) add(match[1]!, true, oneClick);
  return [...found.values()];
}

/** Words and short numbers: what says which page a link is for, not who it is for (/vacatures/product-owner-2026/). */
const PLAIN_PART = /^(?:[A-Za-z]?[a-z]{0,20}|\d{1,4})$/;
const isPlain = (value: string): boolean => value.split(/[-_.]/).every((part) => PLAIN_PART.test(part));
const MIN_SECRET = 6;

/**
 * Whether a part of an address may be a token. Taking too much costs little, because an alias is
 * swapped back on its way out; only a value that also stands in the text of pages, such as a plain
 * word or a date, would then change what a page shows. So those stay as they are.
 */
export function looksSecret(value: string): boolean {
  if (value.length < MIN_SECRET || isPlain(value)) return false;
  if (/^\d+$/.test(value)) return true;
  return !/^[\d\-:./]+$/.test(value);
}

export interface UrlSecret {
  /** The value as the site means it. */
  value: string;
  /** How it stands in the address: with its own percent-encoding, or a plus for a space. */
  spelled: string;
}

const decodedPart = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The parts of an address that may be a token: values in the query and the fragment, and parts of the path, each with how the address spells it. */
export function spelledSecretsInUrl(address: string): UrlSecret[] {
  const url = new URL(address);
  const path = url.pathname.split("/").map((spelled) => ({ value: decodedPart(spelled), spelled }));
  const pairs = (text: string, withKeys: boolean): UrlSecret[] =>
    text.split("&").flatMap((pair) => {
      const at = pair.indexOf("=");
      const key = at === -1 ? pair : pair.slice(0, at);
      const value = at === -1 ? "" : pair.slice(at + 1);
      return [{ value: decodedPart(value.replaceAll("+", " ")), spelled: value }, ...(withKeys ? [{ value: decodedPart(key.replaceAll("+", " ")), spelled: key }] : [])];
    });
  const found = [...path, ...pairs(url.search.slice(1), false), ...pairs(url.hash.slice(1), true)].filter((part) => looksSecret(part.value));
  return [...new Map(found.map((part) => [`${part.value}\n${part.spelled}`, part])).values()];
}

/** The parts of an address that may be a token, as the site means them. */
export const secretsInUrl = (address: string): string[] => [...new Set(spelledSecretsInUrl(address).map((part) => part.value))];

const PUNCTUATION = String.raw`[\s:=*_("'-]`;
/**
 * The word for a one-time code and the digits after it: right behind it, behind "is", or further on behind a
 * colon. Any other words in between make it another sentence, such as "deze code is geldig tot 2026".
 */
const ONE_TIME_CODE = new RegExp(String.raw`\b(?:(?:pin|sms|inlog|toegangs|verificatie|bevestigings|beveiligings|activatie)?code|token)\b(?:${PUNCTUATION}{0,6}|\s+(?:is|luidt)\b${PUNCTUATION}{0,6}|\D{0,20}[:=]${PUNCTUATION}{0,4})(\d{4,8})\b`, "gi");
/** A number goes on after this, or counts something: then it is no code. */
const NUMBER_GOES_ON = /^(?:[-./,:]\d|\s*(?:uur|u\b|min(?:uten|uut)?\b|sec(?:onden)?\b|dag(?:en)?\b|jaar\b|maand(?:en)?\b|euro\b|eur\b|€|%|[kmg]b\b|bytes?\b|tekens\b|cijfers\b|letters\b))/i;

const isDate = (year: number, month: number, day: number): boolean => year >= 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;

/** A year, or a date without separators, as 20261030 or 30102026. Such a number stands on any page of a site, so taking it for a code would change those pages. */
function isYearOrDate(digits: string): boolean {
  if (digits.length === 4) return isDate(Number(digits), 1, 1);
  if (digits.length !== 8) return false;
  const parts = (at: number[]): number[] => at.map((start, index) => Number(digits.slice(start, at[index + 1])));
  const [yearFirst, month, day] = parts([0, 4, 6, 8]);
  const [dayFirst, monthAfter, year] = parts([0, 2, 4, 8]);
  return isDate(yearFirst!, month!, day!) || isDate(year!, monthAfter!, dayFirst!);
}

/** A long token, or a one-time code after the word for it, that stands in the text of a mail outside a link. A year, a date or any other number that merely stands near that word is no code. */
export function secretsInText(text: string): string[] {
  const withoutLinks = text.replace(URL_IN_TEXT, " ");
  const tokens = (withoutLinks.match(/[A-Za-z0-9_-]{20,}/g) ?? []).filter((word) => /[0-9]/.test(word) && /[A-Za-z]/.test(word));
  const codes = [...withoutLinks.matchAll(ONE_TIME_CODE)].filter((match) => !isYearOrDate(match[1]!) && !NUMBER_GOES_ON.test(withoutLinks.slice(match.index + match[0].length, match.index + match[0].length + 16))).map((match) => match[1]!);
  return [...new Set([...tokens, ...codes])];
}

/** The text of a mail without the addresses in it, for what is kept of it in the run. */
export const withoutLinks = (text: string, keep: (url: string) => string): string => text.replace(URL_IN_TEXT, (url) => keep(url));
