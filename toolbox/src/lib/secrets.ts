import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { realHosts } from "./origins.ts";
import { cookieFits, ignoreSecrets, IDLE_SESSION_FILE, LOGIN_SESSION_FILE, RUN_SECRETS_FILE, siteOriginOfRun } from "./login.ts";
import { SEAL_INDEX } from "./seal.ts";
import { isLocalHost, withLock } from "./writes.ts";

/*
 * Every value of a run that may not be recorded, whatever it is and wherever it came from, stands in
 * one register. A source adds a value with one call, `registerSecret`, and names its kind; nothing
 * here knows what a kind means. Blanking values from each file afterwards would be a list that is
 * never complete, so the browser never gets them: everything a run records, it records on the browser
 * side of one boundary, a proxy on this machine that every request of the browser passes
 * (`browser/boundary.ts`). A run without a value in the register has no boundary and takes the paths
 * it always took.
 *
 * - A secret gets an alias of the same length. An agent, a page, the DOM, a screenshot and every log
 *   only ever see the alias.
 * - On the way out (`outward`) an alias in an address, a header or a body becomes the real value, only
 *   towards where that value belongs.
 * - On the way back (`inward`) the real value in a header or a body becomes the alias.
 * - Whatever gets past that is caught where a run writes a file (`maskText`, `maskBytes`), and looked
 *   for in the whole run (`scanRun`, and `lookBack` for a value that only just became known). What
 *   is found there is noted for whoever leads the evaluation (`noteSecretEvent`), never just blanked.
 *
 * The real values stand in one file, `secrets.json`: outside the seal, readable for its owner only,
 * ignored by git, like the session file of a login.
 */

const SCHEMA = "loep/secrets/1";
/** What happened around the secrets of a run. No value is ever in here: names of files, kinds and addresses with aliases. */
export const SECRET_EVENTS_FILE = "secret-events.jsonl";

/** A value that may not be recorded, with what the browser sees instead. */
export interface RunSecret {
  real: string;
  alias: string;
  /** Which source added it. A word of that source; this file only stores and reports it. */
  source: string;
  /** Where the real value may go: exact origins. */
  origins: string[];
  /** And hosts as a cookie names them: `.example.nl` is that domain and what lies under it, `app.example.nl` is that host alone. */
  domains?: string[];
  /** As a cookie with `Secure`: towards `domains` only over https, or on this machine. */
  secure?: boolean;
  /** How it stands in an address, when that is not the value itself (`a%2fb`, `a+b`). An address goes back to the site spelled like this. */
  spelled?: string[];
  /** For a value a site keeps renewing: what it is the value of. A new value takes this place and keeps the alias. */
  slot?: string;
  /** The values this one replaced, the latest first. None goes to a site any more, but a page can still show one, so they are still swapped on the way in and looked for. */
  previous?: string[];
  /** For a value that can stand somewhere by chance: how often it stood in a file when it became known. Only more than that counts. */
  chance?: Record<string, number>;
  /** The browser context a renewed value belongs to. */
  context?: string;
  /** That context is closed: nothing asks for this alias any more, so this place can go first. */
  ended?: boolean;
  at: string;
}

/** An address that is worth something by itself. The URL has aliases in it, so it may be told; opening it counts as sending. */
export interface GuardedAddress {
  id: string;
  url: string;
}

export interface SecretsFile {
  schema: typeof SCHEMA;
  secrets: RunSecret[];
  guarded: GuardedAddress[];
  /** What a source wants to keep outside the seal and the report, under its own name. */
  private: Record<string, unknown>;
}

export interface NewSecret {
  value: string;
  source: string;
  /** Where the real value may go; without one, the site of the run. */
  origins?: string[];
  domains?: string[];
  secure?: boolean;
  spelled?: string;
  /** What the browser sees, when that has to be something in particular. */
  alias?: string;
}

/** An alias has the length of its value, so a format that counts bytes stays whole, and is never shorter than this. */
const MIN_ALIAS = 16;

export function aliasFor(real: string): string {
  const length = Math.max(real.length, MIN_ALIAS);
  return `loepsecret${randomBytes(length).toString("hex")}`.slice(0, length);
}

const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const escapeEach = (text: string, escaped: (code: number) => string): string => text.replace(/[^A-Za-z0-9_-]/g, (character) => escaped(character.charCodeAt(0)));
const lowerHex = (text: string): string => text.replace(/%[0-9A-F]{2}/g, (byte) => byte.toLowerCase());
/** As a form sends it: a space is a plus, and more characters are encoded than in an address. */
const formEncoded = (text: string): string => new URLSearchParams({ a: text }).toString().slice(2);

const SPELLINGS: ((text: string) => string)[] = [
  encodeURIComponent,
  (text) => lowerHex(encodeURIComponent(text)),
  formEncoded,
  (text) => lowerHex(formEncoded(text)),
  escapeHtml,
  // Some templates write one sign as a number (Go: `&#43;`), others every sign.
  (text) => text.replaceAll("+", "&#43;"),
  (text) => escapeEach(text, (code) => `&#${code};`),
  (text) => escapeEach(text, (code) => `&#x${code.toString(16)};`),
  (text) => escapeEach(text, (code) => `&#x${code.toString(16).toUpperCase()};`),
  (text) => text.replaceAll("/", "\\/"),
  (text) => escapeEach(text, (code) => `\\u${code.toString(16).padStart(4, "0")}`),
  (text) => escapeEach(text, (code) => `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`),
];

/** The forms of a value, each with the same form of the other value. */
function spellings(from: string, to: string): [string, string][] {
  const found = new Map<string, string>([[from, to]]);
  for (const spell of SPELLINGS) {
    const spelled = spell(from);
    if (!found.has(spelled)) found.set(spelled, spell(to));
  }
  return [...found];
}

const NAMED_ENTITIES: Record<string, string[]> = { "&": ["amp"], "<": ["lt"], ">": ["gt"], '"': ["quot"], "'": ["apos"], "+": ["plus"], "/": ["sol"], "=": ["equals"], "@": ["commat"], ".": ["period"], ":": ["colon"], "?": ["quest"], "%": ["percnt"], _: ["lowbar"], "-": ["hyphen", "dash"], " ": ["nbsp"] };

const eitherCase = (hex: string): string => hex.replace(/[a-f]/gi, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
/** A piece of text as this file sees it: every pattern runs over bytes, one character per byte. */
const asBytes = (text: string): string => Buffer.from(text).toString("latin1");

/**
 * Every way one character of a value can stand in a page, an address or a body. Each character has
 * its own choice, so a value that a template escaped in part is still the same value.
 */
function characterPattern(character: string): string {
  const code = character.codePointAt(0)!;
  const bytes = [...Buffer.from(character)].map((byte) => byte.toString(16).padStart(2, "0"));
  const forms = [
    escapeRegExp(asBytes(character)),
    bytes.map((byte) => `%${eitherCase(byte)}`).join(""),
    `&#0*${code};?`,
    `&#[xX]0*${eitherCase(code.toString(16))};?`,
    `\\\\[uU]${eitherCase(code.toString(16).padStart(4, "0"))}`,
    ...(code < 0x100 ? [`\\\\[xX]${eitherCase(code.toString(16).padStart(2, "0"))}`] : []),
    ...(/[^A-Za-z0-9]/.test(character) ? [`\\\\${escapeRegExp(character)}`] : []),
    ...(character === " " ? ["\\+"] : []),
    ...(NAMED_ENTITIES[character] ?? []).map((name) => `&${name};`),
  ];
  return `(?:${forms.join("|")})`;
}

/** In a binary body a value shorter than this can stand there by chance: a code of six digits is in any picture of a megabyte. */
export const MIN_BINARY_VALUE = 16;
/** Anything shorter, and any short number, can also stand in a text by chance, as a piece of something else. */
const MIN_RANDOM_VALUE = 8;
const standsByChance = (value: string): boolean => value.length < MIN_RANDOM_VALUE || (value.length < MIN_BINARY_VALUE && /^\d+$/.test(value));
/** Words and numbers, as a part of an address on a site can be (`update-q4`): a mail can have it as a token, and the site as the name of a page. */
const isReadable = (value: string): boolean => /^[a-z0-9-]+$/.test(value) && value.split("-").every((part) => /^(?:[a-z]*|\d*)$/.test(part) || part.length <= 3);

/**
 * Where a value that can stand somewhere by chance counts as that value. Not inside a longer word,
 * number, hash or slug, not as a piece of a decimal, a time or a date, and not as the port of an
 * address. A percent-escape before it counts as a separator: the letters of `%3D` belong to the sign.
 */
const WORD_BEFORE = String.raw`(?:(?<=%[0-9A-Fa-f]{2})|(?<![0-9A-Za-z_-]))(?<![0-9][.,:])(?<!\/\/[^\s/?#"'<>]*:)`;
const WORD_AFTER = String.raw`(?![0-9A-Za-z_-])(?![.,:][0-9])`;

/** The characters of a value in one pattern. A token of some kilobytes as one pattern is more than the compiler of a pattern can take: from about 1500 characters it throws. */
const MAX_PIECE = 512;

/** A value as patterns of one piece each: the first finds where it may start, and each next one has to follow at once. */
class ValuePattern {
  private readonly first: RegExp;
  private readonly rest: RegExp[];

  constructor(pieces: readonly string[]) {
    this.first = new RegExp(pieces[0] ?? "(?!)", "g");
    this.rest = pieces.slice(1).map((piece) => new RegExp(piece, "y"));
  }

  /** Where the whole value ends when it starts at this match of the first piece, or null when it is not the value. */
  private endOf(text: string, match: RegExpMatchArray): number | null {
    let end = match.index! + match[0].length;
    for (const piece of this.rest) {
      piece.lastIndex = end;
      if (!piece.test(text)) return null;
      end = piece.lastIndex;
    }
    return end;
  }

  replace(text: string, to: string): string {
    if (this.rest.length === 0) return text.replace(this.first, () => to);
    let kept = 0;
    let result = "";
    for (const match of text.matchAll(this.first)) {
      const end = match.index >= kept ? this.endOf(text, match) : null;
      if (end === null) continue;
      result += text.slice(kept, match.index) + to;
      kept = end;
    }
    return kept === 0 ? text : result + text.slice(kept);
  }

  count(text: string): number {
    return [...text.matchAll(this.first)].filter((match) => this.endOf(text, match) !== null).length;
  }

  found(text: string): boolean {
    if (this.rest.length === 0) return text.search(this.first) !== -1;
    for (const match of text.matchAll(this.first)) if (this.endOf(text, match) !== null) return true;
    return false;
  }
}

/** A site that renews a cookie with every answer makes a new shield each time, with one new value: the patterns of the others are not made again. */
const madePatterns = new Map<string, ValuePattern>();
const MAX_MADE_PATTERNS = 1024;

/**
 * A pattern for a value in every spelling this file knows, also when each character is spelled in
 * its own way. It runs over bytes. What it does not find, and `docs/methode.md` says so: a value
 * escaped twice (`%252B`), in base64 or hex in a page (`scanRun` does look for those), with other
 * capitals, cut in two by a tag, or anything a site derives from it. With `asWord` a value only counts
 * as a word of its own: replacing it anywhere else would change numbers, times and hashes that merely hold it.
 */
function valuePattern(value: string, asWord: boolean): ValuePattern {
  const key = `${asWord ? "w" : "-"}${value}`;
  const known = madePatterns.get(key);
  if (known) return known;
  const characters = [...value];
  const pieces = Array.from({ length: Math.ceil(characters.length / MAX_PIECE) }, (_, index) => characters.slice(index * MAX_PIECE, (index + 1) * MAX_PIECE).map(characterPattern).join(""));
  const made = new ValuePattern(pieces.map((piece, index) => `${asWord && index === 0 ? WORD_BEFORE : ""}${piece}${asWord && index === pieces.length - 1 ? WORD_AFTER : ""}`));
  if (madePatterns.size >= MAX_MADE_PATTERNS) madePatterns.clear();
  madePatterns.set(key, made);
  return made;
}

function replaceBytes(data: Buffer, from: string, to: string): Buffer {
  const needle = Buffer.from(from);
  let at = data.indexOf(needle);
  if (at === -1) return data;
  const parts: Buffer[] = [];
  const replacement = Buffer.from(to);
  let start = 0;
  while (at !== -1) {
    parts.push(data.subarray(start, at), replacement);
    start = at + needle.length;
    at = data.indexOf(needle, start);
  }
  parts.push(data.subarray(start));
  return Buffer.concat(parts);
}

const TEXT_TYPE = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|ecmascript|x-www-form-urlencoded|x-javascript)\b|image\/svg)/i;

/** Whether a body is binary, by its type, or without one by what it starts with. */
export function isBinaryBody(contentType: string | undefined, data: Buffer): boolean {
  if (contentType) return !TEXT_TYPE.test(contentType.trim());
  return data.subarray(0, 8192).includes(0);
}

/** Data and code: a number there is a number, and only what stands between quotes can be text. */
const DATA_TYPE = /^(?:application\/(?:[\w.+-]*\+)?(?:json|javascript|ecmascript|x-javascript)\b|text\/(?:javascript|css)\b)/i;
/** What stands between quotes, or backticks in a script. Unrolled, so a string of many megabytes (a recording keeps a body as base64) does not fill the stack of the pattern. */
const QUOTED = /"[^"\\\n]*(?:\\.[^"\\\n]*)*"|'[^'\\\n]*(?:\\.[^'\\\n]*)*'|`[^`\\]*(?:\\[\s\S][^`\\]*)*`/g;

/**
 * Whether a text is data, by its type or, without a type that says so, by its shape. There a value
 * that can stand somewhere by chance only counts between quotes: an alias in the place of a number breaks the JSON around it.
 */
function isData(contentType: string | undefined, text: string): boolean {
  if (contentType && DATA_TYPE.test(contentType.trim())) return true;
  const [start, end] = [text.trimStart()[0], text.trimEnd().at(-1)];
  return (start === "{" && end === "}") || (start === "[" && end === "]");
}

/** The kind of a file of a run, by its name: for the same rules as a body with that type. */
function typeOfFile(path: string): string | undefined {
  if (COMPRESSED.test(path)) return "application/octet-stream";
  if (/\.(?:json|jsonl|map)$/i.test(path)) return "application/json";
  if (/\.m?js$/i.test(path)) return "text/javascript";
  return /\.css$/i.test(path) ? "text/css" : undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

const reachOf = (secret: Pick<RunSecret, "origins" | "domains" | "secure">, url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(realHosts(url));
  } catch {
    return false;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (secret.origins.includes(parsed.origin)) return true;
  const host = hostOf(parsed.href);
  if (secret.secure && parsed.protocol !== "https:" && !isLocalHost(host)) return false;
  return (secret.domains ?? []).some((domain) => cookieFits(domain, host));
};

/** Everything that stands for one value in a page or a file: the value, how an address spells it, and what it replaced. */
const formsOf = (secret: RunSecret): string[] => [secret.real, ...(secret.spelled ?? []), ...(secret.previous ?? [])];

export class Shield {
  readonly secrets: readonly RunSecret[];
  private readonly guarded: Map<string, string>;
  private readonly tokens: string[];
  private readonly toReal: [string, string][];
  private readonly toRealInUrl: [string, string][];
  private readonly toRealInForm: [string, string][];
  private readonly toRealInJson: [string, string][];
  /** The longest first: a value inside another value may not break it up. */
  private readonly toAlias: { pattern: ValuePattern; alias: string; short: boolean; asWord: boolean; source: string }[];
  private readonly guardedAliases: string[];
  private readonly within = new Map<string, Shield>();

  constructor(file: Pick<SecretsFile, "secrets"> & Partial<Pick<SecretsFile, "guarded">>) {
    this.secrets = file.secrets;
    this.guarded = new Map((file.guarded ?? []).map((address) => [address.url, address.id]));
    this.tokens = file.secrets.map((secret) => secret.alias);
    const longestFirst = [...file.secrets].sort((a, b) => b.real.length - a.real.length);
    this.toReal = longestFirst.flatMap((secret) => spellings(secret.alias, secret.real));
    this.toRealInUrl = longestFirst.flatMap((secret): [string, string][] => [
      [secret.alias, secret.spelled?.[0] ?? encodeURIComponent(secret.real)],
      [encodeURIComponent(secret.alias), secret.spelled?.[0] ?? encodeURIComponent(secret.real)],
    ]);
    this.toRealInForm = longestFirst.flatMap((secret): [string, string][] => [
      [encodeURIComponent(secret.alias), formEncoded(secret.real)],
      [secret.alias, formEncoded(secret.real)],
    ]);
    this.toRealInJson = longestFirst.map((secret) => [secret.alias, JSON.stringify(secret.real).slice(1, -1)]);
    this.toAlias = longestFirst.flatMap((secret) =>
      formsOf(secret).map((value) => {
        const asWord = standsByChance(secret.real);
        return { pattern: valuePattern(value, asWord), alias: secret.alias, short: secret.real.length < MIN_BINARY_VALUE, asWord, source: secret.source };
      }),
    );
    this.guardedAliases = this.tokens.filter((alias) => (file.guarded ?? []).some((address) => address.url.includes(alias)));
  }

  /** Whether the boundary has to swap for this address: some value may go there. */
  covers(url: string): boolean {
    return this.secrets.some((secret) => reachOf(secret, url));
  }

  /** This shield with only the values that may go to this address. What goes out is swapped with this one. */
  reaching(url: string): Shield {
    const host = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return url;
      }
    })();
    let shield = this.within.get(host);
    if (!shield) {
      shield = new Shield({ secrets: this.secrets.filter((secret) => reachOf(secret, url)) });
      this.within.set(host, shield);
    }
    return shield;
  }

  /** Whether an address holds an alias of a value that may not go there. */
  outOfReach(url: string): boolean {
    return this.secrets.some((secret) => url.includes(secret.alias) && !reachOf(secret, url));
  }

  // As a function: a real value is no pattern, and `$&` or `$$` in one would change it.
  outward = (text: string): string => this.toReal.reduce((value, [from, to]) => value.replaceAll(from, () => to), text);
  /** The real values in an address, percent-encoded: a token with a + or a / in it must stay one value. */
  outwardUrl = (url: string): string => this.toRealInUrl.reduce((value, [from, to]) => value.replaceAll(from, () => to), url);
  outwardBytes = (data: Buffer): Buffer => this.toReal.reduce((value, [from, to]) => replaceBytes(value, from, to), data);
  /** The body of a form: a real value is encoded there, or a + becomes a space. */
  outwardForm = (data: Buffer): Buffer => this.toRealInForm.reduce((value, [from, to]) => replaceBytes(value, from, to), data);
  /** A JSON body: a real value with a quote in it stays one string. */
  outwardJson = (data: Buffer): Buffer => this.toRealInJson.reduce((value, [from, to]) => replaceBytes(value, from, to), data);

  private swapped(data: Buffer, entries: Shield["toAlias"], contentType?: string): Buffer {
    if (entries.length === 0 || data.length === 0) return data;
    const before = data.toString("latin1");
    const swap = (text: string, some: Shield["toAlias"]): string => some.reduce((value, entry) => entry.pattern.replace(value, entry.alias), text);
    const words = entries.filter((entry) => entry.asWord);
    const rest = swap(before, entries.filter((entry) => !entry.asWord));
    const after = words.length > 0 && isData(contentType, rest) ? rest.replace(QUOTED, (quoted) => swap(quoted, words)) : swap(rest, words);
    return after === before ? data : Buffer.from(after, "latin1");
  }

  inward = (text: string, contentType?: string): string => this.swapped(Buffer.from(text), this.toAlias, contentType).toString();
  inwardBytes = (data: Buffer, contentType?: string): Buffer => this.swapped(data, this.toAlias, contentType);

  /**
   * A body on its way back. In text every value is swapped. In a binary body only a value long enough
   * not to stand there by chance; a shorter one that does stand there stays, and is named, because
   * swapping it could break a picture and saying nothing would hide a possible leak.
   */
  inwardBody(data: Buffer, contentType: string | undefined): { data: Buffer; shortFound: string[] } {
    if (!isBinaryBody(contentType, data)) return { data: this.inwardBytes(data, contentType), shortFound: [] };
    const text = data.toString("latin1");
    const shortFound = [...new Set(this.toAlias.filter((entry) => entry.short && entry.pattern.found(text)).map((entry) => entry.source))];
    return { data: this.swapped(data, this.toAlias.filter((entry) => !entry.short)), shortFound };
  }

  /** The id of the guarded address at this address, or null when it is none. Two addresses can differ only in their fragment, and a browser does not always name it. */
  guardedId(url: string): string | null {
    const withoutHash = (address: string): string => {
      const parsed = new URL(address);
      parsed.hash = "";
      return parsed.href;
    };
    try {
      const real = realHosts(url);
      const exact = this.guarded.get(new URL(real).href);
      if (exact) return exact;
      const bare = withoutHash(real);
      for (const [address, id] of this.guarded) if (withoutHash(address) === bare) return id;
      return null;
    } catch {
      return null;
    }
  }

  /** Whether an address is a guarded one, or leads the code of one to the site in another way: a site keeps that code in links of its own. */
  touchesGuarded(url: string): boolean {
    return this.guardedId(url) !== null || this.guardedAliases.some((alias) => url.includes(alias));
  }

  /** Whether an address has an alias in it. */
  carriesAlias(url: string): boolean {
    return this.tokens.some((alias) => url.includes(alias));
  }

  /** Whether a body has the alias of a value of this source in it. */
  mentions(body: Buffer | null, source: string): boolean {
    if (body === null) return false;
    return this.secrets.filter((secret) => secret.source === source).some((secret) => spellings(secret.alias, secret.real).some(([spelled]) => body.includes(spelled)));
  }

  hasSource(source: string): boolean {
    return this.secrets.some((secret) => secret.source === source);
  }
}

const pathIn = (runDir: string): string => join(runDir, RUN_SECRETS_FILE);

/** The register of a run, or null for a run without secrets. */
export function readSecretsFile(runDir: string): SecretsFile | null {
  const path = pathIn(runDir);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretsFile;
  if (parsed.schema !== SCHEMA) throw new Error(`${path} is geen register van geheimen van loep`);
  return parsed;
}

/** Write the register where only its owner can read it, in one step: a session process reads along. */
function writeSecretsFile(runDir: string, file: SecretsFile): void {
  const path = pathIn(runDir);
  mkdirSync(dirname(path), { recursive: true });
  // Only a run with secrets: the .gitignore of any other run stays what it was.
  ignoreSecrets(runDir, [RUN_SECRETS_FILE]);
  // A recheck has the register of its run by a link, and that link stays one.
  const target = existsSync(path) ? realpathSync(path) : path;
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
}

const emptyFile = (): SecretsFile => ({ schema: SCHEMA, secrets: [], guarded: [], private: {} });

function changing<T>(runDir: string, work: (file: SecretsFile) => T): T {
  mkdirSync(runDir, { recursive: true });
  // Where the register really is: a recheck has it by a link, and shares its lock with the run.
  const path = pathIn(runDir);
  return withLock(
    existsSync(path) ? dirname(realpathSync(path)) : runDir,
    () => {
      const file = readSecretsFile(runDir) ?? emptyFile();
      const before = JSON.stringify(file);
      const result = work(file);
      if (JSON.stringify(file) !== before) writeSecretsFile(runDir, file);
      return result;
    },
    "secrets.lock",
  );
}

/**
 * Add values to the register of a run, in one step, and look for the new ones in what the run holds
 * already: a value can have come in before it was known. A value that is there gets what is new about it.
 */
export function registerSecrets(runDir: string, found: readonly NewSecret[]): void {
  if (found.length === 0) return;
  const site = siteOriginOfRun(runDir);
  const added = changing(runDir, (file) => {
    const fresh: RunSecret[] = [];
    for (const secret of found) {
      const known = file.secrets.find((entry) => entry.real === secret.value);
      if (known) {
        if (secret.spelled !== undefined && secret.spelled !== secret.value && !known.spelled?.includes(secret.spelled)) known.spelled = [...(known.spelled ?? []), secret.spelled];
        known.origins = [...new Set([...known.origins, ...(secret.origins ?? [])])];
        if (secret.domains) known.domains = [...new Set([...(known.domains ?? []), ...secret.domains])];
        if (known.secure) known.secure = secret.secure === true;
        continue;
      }
      const entry: RunSecret = {
        real: secret.value,
        alias: secret.alias ?? aliasFor(secret.value),
        source: secret.source,
        origins: secret.origins ?? (site ? [site] : []),
        ...(secret.domains ? { domains: secret.domains } : {}),
        ...(secret.secure ? { secure: true } : {}),
        ...(secret.spelled !== undefined && secret.spelled !== secret.value ? { spelled: [secret.spelled] } : {}),
        at: new Date().toISOString(),
      };
      file.secrets.push(entry);
      fresh.push(entry);
    }
    return fresh;
  });
  lookBack(runDir, added);
}

/** What a site that keeps renewing a value is remembered by: its last values per place, for this many places. */
export const MAX_PREVIOUS = 8;
export const MAX_SLOTS = 32;

/**
 * Values a site hands out right now, each in the place of the one it had there (`slot`). This runs on
 * the proxy for every answer of a site that renews its cookies, so it stays small: the place keeps its
 * alias, which is what the browser holds, the register keeps a fixed number of old values, and nothing
 * looks through the run, because a value that only now comes out of the site cannot stand there yet.
 */
export function renewSecrets(runDir: string, renewed: readonly (NewSecret & { slot: string; context: string })[]): void {
  if (renewed.length === 0) return;
  changing(runDir, (file) => {
    for (const secret of renewed) {
      if (file.secrets.some((entry) => entry.real === secret.value)) continue;
      const place = file.secrets.find((entry) => entry.slot === secret.slot);
      if (place) {
        place.previous = [place.real, ...(place.previous ?? [])].filter((value) => value !== secret.value).slice(0, MAX_PREVIOUS);
        place.real = secret.value;
        place.origins = [...new Set([...place.origins, ...(secret.origins ?? [])])];
        if (secret.domains) place.domains = [...new Set([...(place.domains ?? []), ...secret.domains])];
        if (secret.secure) place.secure = true;
        else delete place.secure;
        continue;
      }
      file.secrets.push({ real: secret.value, alias: aliasFor(secret.value), source: secret.source, origins: secret.origins ?? [], ...(secret.domains ? { domains: secret.domains } : {}), ...(secret.secure ? { secure: true } : {}), slot: secret.slot, context: secret.context, at: new Date().toISOString() });
      // A place of a context that is open is what its browser holds. Only a context that makes more than the limit by itself loses one.
      const places = file.secrets.filter((entry) => entry.slot !== undefined);
      const own = places.filter((entry) => entry.context === secret.context);
      const gone = places.length > MAX_SLOTS ? (places.find((entry) => entry.ended) ?? (own.length > MAX_SLOTS ? own[0] : undefined)) : undefined;
      if (gone) file.secrets.splice(file.secrets.indexOf(gone), 1);
    }
  });
}

/** A browser context closed: what the site renewed for it is kept, and is the first to make room. */
export function endContextSecrets(runDir: string, context: string): void {
  if (!existsSync(pathIn(runDir))) return;
  changing(runDir, (file) => {
    for (const entry of file.secrets) if (entry.context === context) entry.ended = true;
  });
}

/** Add one value. All a new kind of secret needs. */
export function registerSecret(runDir: string, value: string, details: Omit<NewSecret, "value">): void {
  registerSecrets(runDir, [{ value, ...details }]);
}

/** Add addresses that are worth something by themselves. */
export function registerGuarded(runDir: string, addresses: readonly GuardedAddress[]): void {
  changing(runDir, (file) => {
    for (const address of addresses) if (!file.guarded.some((known) => known.id === address.id)) file.guarded.push(address);
  });
}

/** Keep something of a source outside the seal and the report. */
export function keepPrivate(runDir: string, source: string, value: unknown): void {
  changing(runDir, (file) => {
    file.private[source] = value;
  });
}

export const readPrivate = <T>(runDir: string, source: string): T | null => (readSecretsFile(runDir)?.private[source] as T | undefined) ?? null;

const loaded = new Map<string, { stamp: string; shield: Shield }>();

/** What tells one version of a file from the next. A new version is a new file, so also a value of the same length, written in the same tick, counts. */
function stampOf(path: string): string | null {
  try {
    const { mtimeMs, size, ino } = statSync(path);
    return `${mtimeMs}:${size}:${ino}`;
  } catch {
    return null;
  }
}

/**
 * The shield of a run, read again when a command added secrets: the session process keeps running
 * while another command adds what it found. Null for a run without secrets; such a run takes the paths
 * it always took.
 */
export function shieldForRun(runDir: string): Shield | null {
  const stamp = stampOf(pathIn(runDir));
  if (stamp === null) return null;
  const known = loaded.get(runDir);
  if (known?.stamp === stamp) return known.shield;
  const file = readSecretsFile(runDir)!;
  if (file.secrets.length === 0) return null;
  const shield = new Shield(file);
  loaded.set(runDir, { stamp, shield });
  return shield;
}

// ---- What happened ---------------------------------------------------------------------------------------------------

export interface SecretEvent {
  at: string;
  /**
   * `found-in-run`: a value stood in the run when it was registered. `masked`: a value was replaced
   * while a file was written. `short-in-binary`: a short value stands in a binary answer and stayed.
   * `refused`: the boundary did not pass something on. `unreachable`: the site was not reached,
   * also when its certificate does not hold.
   */
  kind: "found-in-run" | "masked" | "short-in-binary" | "refused" | "unreachable";
  /** The file or the address, with aliases. */
  where: string;
  source?: string;
  noteNl: string;
}

/** Note what whoever leads the evaluation has to see. Nothing that could hold a value goes in here unswapped. */
export function noteSecretEvent(runDir: string, event: Omit<SecretEvent, "at">): void {
  const shield = shieldForRun(runDir);
  const safe: SecretEvent = { at: new Date().toISOString(), ...event, where: realHosts(shield ? shield.inward(event.where) : event.where), noteNl: shield ? shield.inward(event.noteNl) : event.noteNl };
  appendFileSync(join(runDir, SECRET_EVENTS_FILE), `${JSON.stringify(safe)}\n`);
}

export function readSecretEvents(runDir: string): SecretEvent[] {
  const path = join(runDir, SECRET_EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SecretEvent);
}

// ---- Looking for what may not be there -----------------------------------------------------------------------------

const isGone = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

/** What stands in a folder now. A run is written to while this reads it, so what is gone by now was simply not there. */
function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (isGone(error)) return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

/**
 * What a secret looks like in the bytes of a file: as it is, percent-encoded, HTML-escaped, as hex,
 * and as base64 from each of the three positions it can start at (a recording keeps a body as base64).
 */
export function searchedSpellings(real: string): string[] {
  const forms = new Set(spellings(real, real).map(([spelled]) => spelled));
  const bytes = Buffer.from(real);
  forms.add(bytes.toString("hex"));
  for (const offset of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64").replace(/=+$/, "");
    // Leave out the characters that also hold bits of the bytes before and after the value.
    const start = [0, 2, 3][offset]!;
    const end = (offset + bytes.length) % 3 === 0 ? encoded.length : encoded.length - 1;
    forms.add(encoded.slice(start, end));
  }
  return [...forms];
}

/** Pictures and PDF files keep what they show compressed: a search through their bytes does not show the text in them. */
const COMPRESSED = /\.(?:png|jpe?g|webp|gif|pdf|gz|zip)$/i;
/** Over a file this large the search for mixed spellings is left out: the fixed spellings still go through it, piece by piece, and a read of one file has a limit. */
const MAX_PATTERN_FILE = 256 * 1024 * 1024;
const LARGE_FILE_PIECE = 64 * 1024 * 1024;

/** Whether any of these byte strings stands in a large file. Each piece overlaps the one before by the longest of them, so a value across two pieces counts. */
function largeFileHolds(path: string, forms: readonly Buffer[]): boolean {
  const overlap = Math.max(0, ...forms.map((form) => form.length));
  const piece = Buffer.alloc(LARGE_FILE_PIECE + overlap);
  const descriptor = openSync(path, "r");
  try {
    let kept = 0;
    for (;;) {
      const read = readSync(descriptor, piece, kept, LARGE_FILE_PIECE, null);
      if (read === 0) return false;
      const filled = piece.subarray(0, kept + read);
      if (forms.some((form) => filled.includes(form))) return true;
      kept = Math.min(overlap, filled.length);
      filled.copy(piece, 0, filled.length - kept);
    }
  } finally {
    closeSync(descriptor);
  }
}

export interface ScanHit {
  /** The file, relative to the run. */
  file: string;
  /** Which secret, by its place in the list: never the secret. */
  secret: number;
  source: string;
  /** For a value that can stand somewhere by chance: how often it stands here. */
  count?: number;
}

export interface ScanResult {
  /** Files that were read byte by byte. */
  files: number;
  bytes: number;
  /** Where a secret was found, in the name or in the bytes of a file. */
  hits: ScanHit[];
  /** Files whose content is compressed, so the search through their bytes says little about text in them. */
  compressed: number;
  /** Files that are there and could not be read, so nothing is known about what they hold. */
  unread: string[];
}

/** Files that hold real values on purpose. */
const holdsSecretsOnPurpose = (name: string): boolean => {
  const file = basename(name);
  return file === RUN_SECRETS_FILE || file === `${RUN_SECRETS_FILE}.tmp` || file === LOGIN_SESSION_FILE || file === IDLE_SESSION_FILE;
};

function searchFor(runDir: string, secrets: readonly { secret: RunSecret; index: number }[]): ScanResult {
  const result: ScanResult = { files: 0, bytes: 0, hits: [], compressed: 0, unread: [] };
  const needles = secrets.map(({ secret, index }) => {
    const forms = formsOf(secret);
    const asWord = standsByChance(secret.real);
    return {
      index,
      source: secret.source,
      short: secret.real.length < MIN_BINARY_VALUE,
      asWord,
      counted: asWord || isReadable(secret.real),
      chance: secret.chance ?? {},
      // Only looked for where it would be replaced: as base64 or hex such a value would match pieces of anything.
      literal: asWord || isReadable(secret.real) ? [] : [...new Set(forms.flatMap(searchedSpellings))].map((spelled) => Buffer.from(spelled)),
      patterns: forms.map((form) => valuePattern(form, asWord)),
    };
  });
  const searchFile = (path: string, name: string): void => {
    const { size } = statSync(path);
    const large = size > MAX_PATTERN_FILE;
    const compressed = COMPRESSED.test(name);
    if (large) {
      // As in a picture: in this many bytes a short value stands by chance.
      for (const needle of needles.filter((candidate) => !candidate.short && candidate.literal.length > 0)) if (largeFileHolds(path, needle.literal) || needle.literal.some((form) => name.includes(form.toString()))) result.hits.push({ file: name, secret: needle.index, source: needle.source });
    } else {
      const data = readFileSync(path);
      const text = data.toString("latin1");
      const binary = compressed || isBinaryBody(undefined, data);
      // The same rule as where a run writes: what would not be replaced there is no leak here, or a seal would refuse a number.
      const wordText = !binary && needles.some((needle) => needle.asWord) && isData(typeOfFile(name), text) ? (text.match(QUOTED) ?? []).join("\n") : text;
      for (const needle of needles) {
        // A short value in a picture is chance, not a leak: it stands in any file of some size.
        if (needle.short && binary) continue;
        if (needle.counted) {
          const body = needle.asWord ? wordText : text;
          const count = needle.patterns.reduce((sum, pattern) => sum + pattern.count(body) + pattern.count(name), 0);
          if (count > (needle.chance[name] ?? 0)) result.hits.push({ file: name, secret: needle.index, source: needle.source, count });
        } else if (needle.literal.some((form) => data.includes(form) || name.includes(form.toString())) || needle.patterns.some((pattern) => pattern.found(text))) result.hits.push({ file: name, secret: needle.index, source: needle.source });
      }
    }
    result.files++;
    result.bytes += size;
    if (compressed) result.compressed++;
  };
  for (const path of walk(runDir)) {
    const name = relative(runDir, path).split(sep).join("/");
    if (holdsSecretsOnPurpose(name)) continue;
    try {
      searchFile(path, name);
    } catch (error) {
      if (!isGone(error)) result.unread.push(name);
    }
  }
  return result;
}

/** Look for every secret of a run in every other file of the run, also in binary files and in file names. */
export function scanRun(runDir: string): ScanResult {
  const file = readSecretsFile(runDir);
  // A run without secrets has nothing to look for, and a seal reads every file already.
  if (!file) return { files: 0, bytes: 0, hits: [], compressed: 0, unread: [] };
  return searchFor(runDir, file.secrets.map((secret, index) => ({ secret, index })));
}

/**
 * Look for values that only just became known in what the run holds already. What is found is noted,
 * and stays where it is. A value that can stand somewhere by chance, such as `2517` in a postcode or
 * `update-q4` in an address of the site, cannot be told from a leak here, so how often it stands where is remembered: only more than that counts from now on.
 */
function lookBack(runDir: string, added: readonly RunSecret[]): void {
  if (added.length === 0) return;
  const all = readSecretsFile(runDir)!.secrets;
  const { hits, unread } = searchFor(runDir, added.map((secret) => ({ secret, index: all.findIndex((entry) => entry.real === secret.real) })));
  const counted = hits.filter((hit) => hit.count !== undefined);
  if (counted.length > 0) {
    changing(runDir, (file) => {
      for (const hit of counted) {
        const entry = file.secrets.find((known) => known.real === all[hit.secret]!.real);
        if (entry) entry.chance = { ...entry.chance, [hit.file]: hit.count! };
      }
    });
  }
  for (const hit of hits) noteSecretEvent(runDir, { kind: "found-in-run", where: hit.file, source: hit.source, noteNl: hit.count === undefined ? "deze waarde stond al in de run toen ze bekend werd" : "deze waarde stond al in de run toen ze bekend werd; dat kan toeval zijn, zoals een postcode of de naam van een pagina, en is niet te onderscheiden van een lek" });
  for (const file of unread) noteSecretEvent(runDir, { kind: "found-in-run", where: file, noteNl: "dit bestand was niet te lezen toen deze waarde bekend werd, dus het is er niet op nagekeken" });
}

/** Why a run with secrets outside their file may not be sealed, in Dutch, or null when none was found. */
export function leakRefusalNl(scan: ScanResult): string | null {
  if (scan.unread.length > 0) return `niet verzegeld: ${scan.unread.join(", ")} is niet te lezen, dus er is niet nagegaan of er een geheim in staat. Maak het leesbaar of haal het weg`;
  if (scan.hits.length === 0) return null;
  const files = [...new Set(scan.hits.map((hit) => hit.file))];
  const sources = [...new Set(scan.hits.map((hit) => hit.source))];
  return `niet verzegeld: een geheim (${sources.join(", ")}) staat in ${files.length === 1 ? "dit bestand" : `deze ${files.length} bestanden`} van de run: ${files.join(", ")}. Wie de run krijgt, krijgt dan toegang. Haal het eruit en meld het als fout in loep`;
}

// ---- Where a run writes ----------------------------------------------------------------------------------------------

const registers = new Map<string, { stamp: string; valid: boolean }>();

/** Whether a folder holds a register of loep. A file of that name can be anything: only the schema says that it is one. */
function holdsRegister(dir: string): boolean {
  const stamp = stampOf(pathIn(dir));
  if (stamp === null) return false;
  const known = registers.get(dir);
  if (known?.stamp === stamp) return known.valid;
  let valid = false;
  try {
    valid = readSecretsFile(dir) !== null;
  } catch {
    // Somebody else's file, or a broken one: no register, and no reason for a write to fail.
  }
  registers.set(dir, { stamp, valid });
  return valid;
}

/** What only the root of a run has. */
const isRunRoot = (dir: string): boolean => existsSync(join(dir, "manifest.json")) || existsSync(join(dir, "inventory.json"));

/** The run a path lies in, when that run has secrets: the nearest folder at or above it with a register, up to the root of the run. */
function secretRunOf(path: string): string | null {
  let dir = dirname(resolve(path));
  for (;;) {
    if (holdsRegister(dir)) return dir;
    if (isRunRoot(dir)) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function maskFor(path: string): { runDir: string; shield: Shield; where: string } | null {
  // The seal index is hashes and sizes of what was already written: swapping anything there breaks the seal. `seal` refuses a run with a leak before it writes the index.
  if (holdsSecretsOnPurpose(path) || basename(path) === SECRET_EVENTS_FILE || basename(path) === SEAL_INDEX) return null;
  const runDir = secretRunOf(path);
  const shield = runDir ? shieldForRun(runDir) : null;
  return runDir && shield ? { runDir, shield, where: relative(runDir, resolve(path)).split(sep).join("/") } : null;
}

const noteMasked = (runDir: string, where: string): void => noteSecretEvent(runDir, { kind: "masked", where, noteNl: "een bekend geheim kwam tot aan het wegschrijven en is daar vervangen; de grens had het moeten tegenhouden" });

/**
 * The text as it may stand in this file of a run. The second layer, like `::add-mask::` in GitHub
 * Actions: whatever passes through a place that writes is swapped there and noted, however it got
 * past the boundary. Outside a run with secrets the text stays as it is.
 */
export function maskText(path: string, text: string): string {
  const mask = maskFor(path);
  if (!mask) return text;
  const safe = realHosts(text);
  const masked = mask.shield.inward(safe, typeOfFile(path));
  if (masked !== safe) noteMasked(mask.runDir, mask.where);
  return masked;
}

/** The same for bytes. A binary file only loses what cannot stand there by chance. */
export function maskBytes(path: string, data: Uint8Array, contentType?: string): Uint8Array {
  const mask = maskFor(path);
  if (!mask) return data;
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const type = contentType ?? typeOfFile(path);
  const named = isBinaryBody(type, bytes) ? bytes : Buffer.from(realHosts(bytes.toString("latin1")), "latin1");
  const safe = mask.shield.inwardBody(named, type).data;
  if (safe !== named) noteMasked(mask.runDir, mask.where);
  return safe;
}

/** The same for a file that is already on disk, such as a download, with the type it came with when that is known. */
export function maskFile(path: string, contentType?: string): void {
  if (!maskFor(path)) return;
  const data = readFileSync(path);
  const safe = maskBytes(path, data, contentType);
  if (safe !== data && !Buffer.from(safe).equals(data)) writeFileSync(path, safe);
}

// ---- For whoever leads the evaluation --------------------------------------------------------------------------------

/** What the report says about the secrets of a run. Nothing for a run without. */
export function secretLimitationsNl(runDir: string): string[] {
  const file = readSecretsFile(runDir);
  if (!file || file.secrets.length === 0) return [];
  const sources = [...new Set(file.secrets.map((secret) => secret.source))].sort().join(", ");
  const base = `Geheimen: deze run kende geheimen (${sources}). De browser kreeg alleen vervangingen; de echte waarden staan niet in dit rapport of in het bewijs. Wat een site uit zo'n waarde afleidt, zoals een hash, herkent loep niet.`;
  const events = readSecretEvents(runDir);
  if (events.length === 0) return [base];
  const count = (kind: SecretEvent["kind"]): number => events.filter((event) => event.kind === kind).length;
  const parts = [
    count("found-in-run") > 0 ? `${count("found-in-run")} keer stond een waarde al in de run voordat ze bekend was` : null,
    count("masked") > 0 ? `${count("masked")} keer is een waarde pas bij het wegschrijven vervangen` : null,
    count("short-in-binary") > 0 ? `${count("short-in-binary")} keer staat een korte code in een binair antwoord en is die niet vervangen, omdat zo'n code er ook toevallig kan staan` : null,
    count("refused") > 0 ? `${count("refused")} keer weigerde de grens iets` : null,
    count("unreachable") > 0 ? `${count("unreachable")} keer was een site niet te bereiken of hield haar certificaat geen stand` : null,
  ].filter(Boolean);
  return [base, `Voor wie het onderzoek leidt: ${parts.join("; ")}. De plekken staan in ${SECRET_EVENTS_FILE}; loep secrets --run <run> toont ze.`];
}

/** What `loep secrets` prints: counts per source and what happened, without a single value. */
export function secretsLinesNl(runDir: string): string[] {
  const file = readSecretsFile(runDir);
  if (!file || file.secrets.length === 0) return ["deze run kent geen geheimen, en heeft dus geen grens"];
  const bySource = new Map<string, number>();
  for (const secret of file.secrets) bySource.set(secret.source, (bySource.get(secret.source) ?? 0) + 1);
  const scan = scanRun(runDir);
  return [
    ...[...bySource].sort().map(([source, count]) => `${source}: ${count}`),
    `run: ${scan.files} bestanden doorzocht, ${scan.hits.length} keer een geheim gevonden${scan.hits.length > 0 ? `: ${[...new Set(scan.hits.map((hit) => `${hit.file} (${hit.source})`))].join(", ")}` : ""}${scan.unread.length > 0 ? `; niet te lezen: ${scan.unread.join(", ")}` : ""}`,
    ...readSecretEvents(runDir).map((event) => `${event.at} ${event.kind} ${event.where}${event.source ? ` (${event.source})` : ""}: ${event.noteNl}`),
  ];
}
