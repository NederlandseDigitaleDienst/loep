import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ignoreSecrets, IDLE_SESSION_FILE, LOGIN_SESSION_FILE, RUN_SECRETS_FILE, siteOriginOfRun } from "./login.ts";
import { withLock } from "./writes.ts";

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
  /** And hosts with what lies under them, as a cookie has its domain. */
  domains?: string[];
  /** How it stands in an address, when that is not the value itself (`a%2fb`, `a+b`). An address goes back to the site spelled like this. */
  spelled?: string[];
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

/**
 * A pattern for a value in every spelling this file knows, also when each character is spelled in
 * its own way. It runs over bytes. What it does not find, and `docs/methode.md` says so: a value
 * escaped twice (`%252B`), in base64 or hex in a page (`scanRun` does look for those), with other
 * capitals, cut in two by a tag, or anything a site derives from it.
 */
function valuePattern(value: string): RegExp {
  return new RegExp([...value].map(characterPattern).join(""), "g");
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

/** In a binary body a value shorter than this can stand there by chance: a code of six digits is in any picture of a megabyte. */
export const MIN_BINARY_VALUE = 16;
const TEXT_TYPE = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|ecmascript|x-www-form-urlencoded|x-javascript)\b|image\/svg)/i;

/** Whether a body is binary, by its type, or without one by what it starts with. */
export function isBinaryBody(contentType: string | undefined, data: Buffer): boolean {
  if (contentType) return !TEXT_TYPE.test(contentType.trim());
  return data.subarray(0, 8192).includes(0);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

const reachOf = (secret: Pick<RunSecret, "origins" | "domains">, url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (secret.origins.includes(parsed.origin)) return true;
  const host = hostOf(parsed.href);
  return (secret.domains ?? []).some((domain) => {
    const bare = domain.replace(/^\./, "").toLowerCase();
    return host === bare || host.endsWith(`.${bare}`);
  });
};

export class Shield {
  readonly secrets: readonly RunSecret[];
  private readonly guarded: Map<string, string>;
  private readonly tokens: string[];
  private readonly toReal: [string, string][];
  private readonly toRealInUrl: [string, string][];
  private readonly toRealInForm: [string, string][];
  /** The longest first: a value inside another value may not break it up. */
  private readonly toAlias: { pattern: RegExp; alias: string; short: boolean; source: string; real: Buffer }[];
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
    this.toAlias = longestFirst.flatMap((secret) =>
      [secret.real, ...(secret.spelled ?? [])].map((value) => ({
        pattern: valuePattern(value),
        alias: secret.alias,
        short: secret.real.length < MIN_BINARY_VALUE,
        source: secret.source,
        real: Buffer.from(secret.real),
      })),
    );
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

  private swapped(data: Buffer, entries: Shield["toAlias"]): Buffer {
    if (entries.length === 0 || data.length === 0) return data;
    const before = data.toString("latin1");
    const after = entries.reduce((text, entry) => text.replace(entry.pattern, entry.alias), before);
    return after === before ? data : Buffer.from(after, "latin1");
  }

  inward = (text: string): string => this.swapped(Buffer.from(text), this.toAlias).toString();
  inwardBytes = (data: Buffer): Buffer => this.swapped(data, this.toAlias);

  /**
   * A body on its way back. In text every value is swapped. In a binary body only a value long enough
   * not to stand there by chance; a shorter one that does stand there stays, and is named, because
   * swapping it could break a picture and saying nothing would hide a possible leak.
   */
  inwardBody(data: Buffer, contentType: string | undefined): { data: Buffer; shortFound: string[] } {
    if (!isBinaryBody(contentType, data)) return { data: this.inwardBytes(data), shortFound: [] };
    const shortFound = [...new Set(this.toAlias.filter((entry) => entry.short && data.includes(entry.real)).map((entry) => entry.source))];
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
      const exact = this.guarded.get(new URL(url).href);
      if (exact) return exact;
      const bare = withoutHash(url);
      for (const [address, id] of this.guarded) if (withoutHash(address) === bare) return id;
      return null;
    } catch {
      return null;
    }
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
  return withLock(
    runDir,
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
        continue;
      }
      const entry: RunSecret = {
        real: secret.value,
        alias: secret.alias ?? aliasFor(secret.value),
        source: secret.source,
        origins: secret.origins ?? (site ? [site] : []),
        ...(secret.domains ? { domains: secret.domains } : {}),
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
  const safe: SecretEvent = { at: new Date().toISOString(), ...event, where: shield ? shield.inward(event.where) : event.where, noteNl: shield ? shield.inward(event.noteNl) : event.noteNl };
  appendFileSync(join(runDir, SECRET_EVENTS_FILE), `${JSON.stringify(safe)}\n`);
}

export function readSecretEvents(runDir: string): SecretEvent[] {
  const path = join(runDir, SECRET_EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SecretEvent);
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
/** Over a file this large the search for mixed spellings is left out: the fixed spellings still go through it. */
const MAX_PATTERN_FILE = 256 * 1024 * 1024;

export interface ScanHit {
  /** The file, relative to the run. */
  file: string;
  /** Which secret, by its place in the list: never the secret. */
  secret: number;
  source: string;
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

/** Files that hold real values on purpose. */
const holdsSecretsOnPurpose = (name: string): boolean => {
  const file = basename(name);
  return file === RUN_SECRETS_FILE || file === `${RUN_SECRETS_FILE}.tmp` || file === LOGIN_SESSION_FILE || file === IDLE_SESSION_FILE;
};

function searchFor(runDir: string, secrets: readonly { secret: RunSecret; index: number }[]): ScanResult {
  const result: ScanResult = { files: 0, bytes: 0, hits: [], compressed: 0 };
  const needles = secrets.map(({ secret, index }) => {
    const forms = [secret.real, ...(secret.spelled ?? [])];
    return {
      index,
      source: secret.source,
      short: secret.real.length < MIN_BINARY_VALUE,
      literal: [...new Set(forms.flatMap(searchedSpellings))].map((spelled) => Buffer.from(spelled)),
      patterns: forms.map(valuePattern),
    };
  });
  for (const path of walk(runDir)) {
    const name = relative(runDir, path).split(sep).join("/");
    if (holdsSecretsOnPurpose(name)) continue;
    const data = readFileSync(path);
    result.files++;
    result.bytes += data.length;
    const compressed = COMPRESSED.test(name);
    if (compressed) result.compressed++;
    const text = data.length <= MAX_PATTERN_FILE ? data.toString("latin1") : "";
    for (const needle of needles) {
      // A short value in a picture is chance, not a leak: it stands in any file of some size.
      if (needle.short && compressed) continue;
      const found = needle.literal.some((form) => data.includes(form) || name.includes(form.toString())) || needle.patterns.some((pattern) => text.search(pattern) !== -1);
      if (found) result.hits.push({ file: name, secret: needle.index, source: needle.source });
    }
  }
  return result;
}

/** Look for every secret of a run in every other file of the run, also in binary files and in file names. */
export function scanRun(runDir: string): ScanResult {
  const file = readSecretsFile(runDir);
  // A run without secrets has nothing to look for, and a seal reads every file already.
  if (!file) return { files: 0, bytes: 0, hits: [], compressed: 0 };
  return searchFor(runDir, file.secrets.map((secret, index) => ({ secret, index })));
}

/** Look for values that only just became known in what the run holds already. What is found is noted, and stays where it is. */
function lookBack(runDir: string, added: readonly RunSecret[]): void {
  if (added.length === 0) return;
  const all = readSecretsFile(runDir)!.secrets;
  const { hits } = searchFor(runDir, added.map((secret) => ({ secret, index: all.indexOf(all.find((entry) => entry.real === secret.real)!) })));
  for (const hit of hits) noteSecretEvent(runDir, { kind: "found-in-run", where: hit.file, source: hit.source, noteNl: "deze waarde stond al in de run toen ze bekend werd" });
}

/** Why a run with secrets outside their file may not be sealed, in Dutch, or null when none was found. */
export function leakRefusalNl(scan: ScanResult): string | null {
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
  if (holdsSecretsOnPurpose(path) || basename(path) === SECRET_EVENTS_FILE) return null;
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
  const safe = mask.shield.inward(text);
  if (safe !== text) noteMasked(mask.runDir, mask.where);
  return safe;
}

/** The same for bytes. A binary file only loses what cannot stand there by chance. */
export function maskBytes(path: string, data: Uint8Array): Uint8Array {
  const mask = maskFor(path);
  if (!mask) return data;
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const safe = mask.shield.inwardBody(bytes, COMPRESSED.test(path) ? "application/octet-stream" : undefined).data;
  if (safe !== bytes) noteMasked(mask.runDir, mask.where);
  return safe;
}

/** The same for a file that is already on disk, such as a download. */
export function maskFile(path: string): void {
  const data = readFileSync(path);
  const safe = maskBytes(path, data);
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
    `run: ${scan.files} bestanden doorzocht, ${scan.hits.length} keer een geheim gevonden${scan.hits.length > 0 ? `: ${[...new Set(scan.hits.map((hit) => `${hit.file} (${hit.source})`))].join(", ")}` : ""}`,
    ...readSecretEvents(runDir).map((event) => `${event.at} ${event.kind} ${event.where}${event.source ? ` (${event.source})` : ""}: ${event.noteNl}`),
  ];
}
