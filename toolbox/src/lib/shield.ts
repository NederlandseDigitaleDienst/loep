import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { ignoreSecrets, MAILBOX_SECRETS_FILE } from "./login.ts";

/*
 * A personal link in an e-mail is a proof of access. It may not end up in anything of a run: the
 * report, the manifest, the evidence index, an observation, a network log, a saved page or a
 * screenshot. Blanking each of those afterwards would be a list that is never complete, so the
 * browser never gets the token in the first place. Everything a run records, it records on the
 * browser side of one boundary: a proxy on this machine that every request of the browser passes,
 * also what the browser asks by itself after a redirect (`browser/shielded.ts`). There the shield swaps.
 *
 * - A secret gets an alias of the same length (a real token for `loepmail3f9a...`). An agent, a
 *   page, the DOM, a screenshot and every log only ever see the alias.
 * - On the way out (`outward`) an alias in an address, a header or a body becomes the real value,
 *   only to an origin the run may send to.
 * - On the way back (`inward`) the real value in a header or a body becomes the alias.
 *
 * The real values stand in one file, `mailbox-secrets.json`: outside the seal, readable for its
 * owner only, ignored by git, like the session file of a login. `scanRun` looks for them in the
 * rest of the run, and `seal` refuses a run where it finds one.
 */

const SCHEMA = "loep/mailbox-secrets/1";

/** A value that may not be recorded, with what the browser sees instead. */
export interface SecretPair {
  real: string;
  alias: string;
  /** How the mail spelled it in an address, when that is not the value itself (`a%2fb`, `a+b`). An address goes back to the site spelled like this. */
  spelled?: string[];
}

/** Where the mailbox is. The user name and password are never here: they come from the environment or the keychain, for each command again. */
export interface MailServer {
  kind: "imap" | "mailpit";
  host: string;
  port: number;
  tls: boolean;
}

/** A personal link of a mail: the address as the browser knows it, with aliases in it. */
export interface ShieldedLink {
  id: string;
  url: string;
}

export interface ShieldFile {
  schema: typeof SCHEMA;
  server: MailServer;
  /** The address of the run, as the site gets it. */
  address: string;
  /** What the browser types instead: the fixed test value, so a form sees a normal address. */
  addressAlias: string;
  /** The origins the swap works for: those the run may send to. */
  origins: string[];
  secrets: SecretPair[];
  links: ShieldedLink[];
}

/** An alias has the length of its value, so a format that counts bytes stays whole, and is never shorter than this. */
const MIN_ALIAS = 16;

export function aliasFor(real: string): string {
  const length = Math.max(real.length, MIN_ALIAS);
  return `loepmail${randomBytes(length).toString("hex")}`.slice(0, length);
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

/**
 * The forms in which a value occurs in a page, an address or a body: as it is, percent-encoded in
 * either case, as a form sends it, HTML-escaped and as a number, and with an escaped slash or sign
 * as in JSON. Each with the same form of the other value.
 */
function spellings(from: string, to: string): [string, string][] {
  const found = new Map<string, string>([[from, to]]);
  // An alias has no character that gets another spelling: the first form of a value is the one that stands.
  for (const spell of SPELLINGS) {
    const spelled = spell(from);
    if (!found.has(spelled)) found.set(spelled, spell(to));
  }
  return [...found];
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

export class Shield {
  readonly origins: readonly string[];
  private readonly links: Map<string, string>;
  private readonly aliases: string[];
  private readonly toReal: [string, string][];
  private readonly toRealInUrl: [string, string][];
  private readonly toRealInForm: [string, string][];
  private readonly toAlias: [string, string][];
  private readonly addressSpellings: Buffer[];
  private readonly starts: Buffer[];

  constructor(file: Pick<ShieldFile, "address" | "addressAlias" | "origins" | "secrets" | "links">) {
    this.origins = file.origins;
    this.links = new Map(file.links.map((link) => [link.url, link.id]));
    this.aliases = file.secrets.map((pair) => pair.alias);
    // The longest first: a value inside another value may not break it up.
    const pairs = [...file.secrets, { real: file.address, alias: file.addressAlias }].sort((a, b) => b.real.length - a.real.length);
    this.toReal = pairs.flatMap((pair) => spellings(pair.alias, pair.real));
    this.toRealInUrl = pairs.flatMap((pair: SecretPair) => [[pair.alias, pair.spelled?.[0] ?? encodeURIComponent(pair.real)], [encodeURIComponent(pair.alias), pair.spelled?.[0] ?? encodeURIComponent(pair.real)]]);
    this.toRealInForm = pairs.flatMap((pair) => [[encodeURIComponent(pair.alias), formEncoded(pair.real)], [pair.alias, formEncoded(pair.real)]]);
    // The longest first here too: a spelling of a mail can hold the value itself.
    this.toAlias = pairs.flatMap((pair: SecretPair) => [...(pair.spelled ?? []).flatMap((spelled) => spellings(spelled, pair.alias)), ...spellings(pair.real, pair.alias)]).sort(([a], [b]) => b.length - a.length);
    this.starts = this.toAlias.map(([spelled]) => Buffer.from(spelled));
    this.addressSpellings = spellings(file.addressAlias, file.address).map(([spelled]) => Buffer.from(spelled));
  }

  /** Whether requests to this address go through the shield: only to an origin the run may send to. */
  covers(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "ws:") parsed.protocol = "http:";
      if (parsed.protocol === "wss:") parsed.protocol = "https:";
      return this.origins.includes(parsed.origin);
    } catch {
      return false;
    }
  }

  outward = (text: string): string => this.toReal.reduce((value, [from, to]) => value.replaceAll(from, to), text);
  /** The real values in an address, percent-encoded: a token with a + or a / in it must stay one value. */
  outwardUrl = (url: string): string => this.toRealInUrl.reduce((value, [from, to]) => value.replaceAll(from, to), url);
  inward = (text: string): string => this.toAlias.reduce((value, [from, to]) => value.replaceAll(from, to), text);
  outwardBytes = (data: Buffer): Buffer => this.toReal.reduce((value, [from, to]) => replaceBytes(value, from, to), data);
  /** The body of a form: a real value is encoded there, or a + becomes a space. */
  outwardForm = (data: Buffer): Buffer => this.toRealInForm.reduce((value, [from, to]) => replaceBytes(value, from, to), data);
  inwardBytes = (data: Buffer): Buffer => this.toAlias.reduce((value, [from, to]) => replaceBytes(value, from, to), data);

  /** How many bytes at the end of a piece of a stream can be the start of a value to swap: they have to wait for the next piece. */
  unfinishedTail(data: Buffer): number {
    let longest = 0;
    for (const start of this.starts) {
      for (let size = Math.min(start.length - 1, data.length); size > longest; size--) {
        if (data.subarray(data.length - size).equals(start.subarray(0, size))) {
          longest = size;
          break;
        }
      }
    }
    return longest;
  }

  /** The id of the personal link at this address, or null when it is none. Two links can differ only in their fragment, and a browser does not always name it. */
  linkId(url: string): string | null {
    const withoutHash = (address: string): string => {
      const parsed = new URL(address);
      parsed.hash = "";
      return parsed.href;
    };
    try {
      const exact = this.links.get(new URL(url).href);
      if (exact) return exact;
      const bare = withoutHash(url);
      for (const [link, id] of this.links) if (withoutHash(link) === bare) return id;
      return null;
    } catch {
      return null;
    }
  }

  /** Whether an address has an alias of a token in it. */
  carriesAlias(url: string): boolean {
    return this.aliases.some((alias) => url.includes(alias));
  }

  /** Whether a body has the address of the run in it: such a form makes the site send a mail. */
  mentionsAddress(body: Buffer | null): boolean {
    return body !== null && this.addressSpellings.some((spelled) => body.includes(spelled));
  }
}

const pathIn = (runDir: string): string => join(runDir, MAILBOX_SECRETS_FILE);

/** The secrets of a run, or null for a run without a mailbox. */
export function readShieldFile(runDir: string): ShieldFile | null {
  const path = pathIn(runDir);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ShieldFile;
  if (parsed.schema !== SCHEMA) throw new Error(`${path} is geen bestand met de geheimen van een mailbox van loep`);
  return parsed;
}

/** Write the secrets where only their owner can read them, in one step: a session process reads along. */
export function writeShieldFile(runDir: string, file: Omit<ShieldFile, "schema">): void {
  const path = pathIn(runDir);
  mkdirSync(dirname(path), { recursive: true });
  // Only a run with a mailbox: the .gitignore of any other run stays what it was.
  ignoreSecrets(runDir, [MAILBOX_SECRETS_FILE]);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schema: SCHEMA, ...file }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

const loaded = new Map<string, { stamp: string; shield: Shield }>();

/**
 * The shield of a run, read again when a command added secrets: the session process keeps running
 * while `mail wait` writes the links of a new mail. Null for a run without a mailbox; such a run
 * takes the paths it always took.
 */
export function shieldForRun(runDir: string): Shield | null {
  const path = pathIn(runDir);
  if (!existsSync(path)) return null;
  const { mtimeMs, size } = statSync(path);
  const stamp = `${mtimeMs}:${size}`;
  const known = loaded.get(runDir);
  if (known?.stamp === stamp) return known.shield;
  const shield = new Shield(readShieldFile(runDir)!);
  loaded.set(runDir, { stamp, shield });
  return shield;
}

// ---- Looking for what may not be there -----------------------------------------------------------------------------

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });

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

export interface ScanHit {
  /** The file, relative to the run. */
  file: string;
  /** Which secret, by its place in the list: never the secret. */
  secret: number;
}

export interface ScanResult {
  /** Files that were read byte by byte. */
  files: number;
  bytes: number;
  /** Where a secret was found, in the name or in the bytes of a file. */
  hits: ScanHit[];
  /** Files whose content is compressed, so the search through their bytes says little about text in them. */
  compressed: number;
}

/** Look for every secret of a run in every other file of the run, also in binary files and in file names. */
export function scanRun(runDir: string): ScanResult {
  const file = readShieldFile(runDir);
  const secrets = file ? [...file.secrets.map((pair) => pair.real), file.address] : [];
  const needles = secrets.map((secret) => searchedSpellings(secret).map((spelled) => Buffer.from(spelled)));
  const result: ScanResult = { files: 0, bytes: 0, hits: [], compressed: 0 };
  for (const path of walk(runDir)) {
    const name = relative(runDir, path).split(sep).join("/");
    if (name === MAILBOX_SECRETS_FILE || name === `${MAILBOX_SECRETS_FILE}.tmp`) continue;
    const data = readFileSync(path);
    result.files++;
    result.bytes += data.length;
    if (COMPRESSED.test(name)) result.compressed++;
    needles.forEach((forms, secret) => {
      if (forms.some((form) => data.includes(form) || name.includes(form.toString()))) result.hits.push({ file: name, secret });
    });
  }
  return result;
}

/** Why a run with secrets outside their file may not be sealed, in Dutch, or null when none was found. */
export function leakRefusalNl(scan: ScanResult): string | null {
  if (scan.hits.length === 0) return null;
  const files = [...new Set(scan.hits.map((hit) => hit.file))];
  return `niet verzegeld: een persoonlijke link of het adres van de mailbox staat in ${files.length === 1 ? "dit bestand" : `deze ${files.length} bestanden`} van de run: ${files.join(", ")}. Wie de run krijgt, krijgt dan toegang. Haal het eruit en meld het als fout in loep`;
}
