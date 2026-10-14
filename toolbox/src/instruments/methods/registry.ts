import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withinTime } from "../limit.ts";
import { TOOLBOX_VERSION, type MethodFailure, type MethodResult } from "../methods.ts";

const require = createRequire(import.meta.url);
export const TOOLBOX_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const run = promisify(execFile);

/** The measurable questions; a command of the session answers one of them with every method that can. */
export type Question = "name" | "rules" | "contrast" | "focus" | "target" | "taborder" | "lang" | "source" | "ocr" | "motion" | "media" | "reflow" | "spacing" | "forced" | "distinct" | "speech";

export interface MethodSpec {
  /** Short name, unique among the methods: what a printed summary calls the method. */
  id: string;
  questions: Question[];
  /** What is measured and how; goes into the record as `method`. */
  method: string;
  /** The code that does it; goes into the record as `implementation`. */
  implementation: string;
  /** The principle it works on, in Dutch: what makes it a second opinion and not a repetition. */
  principle: string;
  /** Where the version comes from: an installed package, a binary, the toolbox itself, the browser that runs it, or a virtual machine whose versions each measurement records. */
  source: { package: string } | { binary: BinaryName } | { browser: "chromium" | "webkit" | "firefox" } | { guest: "voiceover" } | "toolbox";
  /** Too slow to wait for: runs as a background job of the session. */
  background?: boolean;
  licence: string;
}

const spec = (id: string, questions: Question[], method: string, implementation: string, source: MethodSpec["source"], licence: string, principle: string, background = false): MethodSpec => ({ id, questions, method, implementation, principle, source, licence, ...(background ? { background } : {}) });

/** The programs a method may need that are not part of the installation of the toolbox. */
export type BinaryName = "java" | "tesseract" | "ffmpeg" | "whisper";

/** Every method the session can run, in the order a summary lists them. */
export const METHODS: MethodSpec[] = [
  spec("chromium", ["name"], "browser-accessibility-tree", "chromium", { browser: "chromium" }, "BSD-3-Clause", "de boom die Chromium aan hulpsoftware geeft (CDP)"),
  spec("alfa-aria", ["name"], "accname-computation", "@siteimprove/alfa-aria", { package: "@siteimprove/alfa-aria" }, "MIT", "eigen uitwerking van de accname-specificatie op een kopie van de DOM, buiten de browser"),
  spec("axe-name", ["name"], "accname-computation", "axe-core", { package: "axe-core" }, "MPL-2.0", "eigen uitwerking van de accname-specificatie, in de pagina"),
  spec("playwright", ["name"], "accname-computation", "playwright ariaSnapshot", { package: "playwright" }, "Apache-2.0", "eigen uitwerking van Playwright, in de pagina"),
  spec("dom-accessibility-api", ["name"], "accname-computation", "dom-accessibility-api", { package: "dom-accessibility-api" }, "MIT", "eigen uitwerking van de accname-specificatie, in de pagina"),
  spec("webkit", ["name"], "browser-accessibility-tree", "webkit", { browser: "webkit" }, "LGPL-2.1 en BSD-2-Clause", "de boom die WebKit aan hulpsoftware geeft, via een niet-openbare ingang van Playwright", true),
  spec("axe-core", ["rules", "contrast", "target"], "rule-engine", "axe-core", { package: "axe-core" }, "MPL-2.0", "DOM-regels, geïnjecteerd in elk frame"),
  spec("alfa", ["rules", "contrast", "target"], "rule-engine", "alfa", { package: "@siteimprove/alfa-rules" }, "MIT", "ACT-regels op een kopie van de DOM, buiten de browser"),
  spec("ibm", ["rules", "contrast", "target"], "rule-engine", "accessibility-checker-engine", { package: "accessibility-checker-engine" }, "Apache-2.0", "DOM-regels van IBM met eigen contrast- en naamberekening"),
  spec("qualweb", ["rules", "contrast"], "rule-engine", "qualweb", { package: "@qualweb/act-rules" }, "ISC", "ACT-regels en WCAG-technieken, eigen naam- en contrastberekening"),
  spec("pixels", ["contrast"], "pixel-screenshot", "loep", "toolbox", "EUPL-1.2", "kleuren gemeten op de pixels van een schermafbeelding"),
  spec("computed-style", ["contrast"], "computed-style", "loep", "toolbox", "EUPL-1.2", "som met de berekende tekstkleur en de eerste dekkende achtergrondkleur"),
  spec("chromium-backgrounds", ["contrast"], "background-sampling", "chromium", { browser: "chromium" }, "BSD-3-Clause", "de achtergrondkleuren die Chromium zelf achter de tekst bepaalt (CDP CSS.getBackgroundColors)"),
  spec("image-text", ["contrast"], "ocr-pixels", "tesseract", { binary: "tesseract" }, "Apache-2.0", "tekst in een afbeelding gevonden met tekstherkenning, kleuren gemeten op de pixels binnen het kader van elke regel", true),
  spec("image-box", ["contrast"], "pointed-pixels", "loep", "toolbox", "EUPL-1.2", "kleuren gemeten op de pixels binnen een kader dat de agent in het beeld aanwees"),
  spec("pixel-diff", ["focus"], "pixel-diff", "loep", "toolbox", "EUPL-1.2", "schermafbeelding zonder en met focus vergeleken"),
  spec("style-change", ["focus"], "computed-style-change", "loep", "toolbox", "EUPL-1.2", "berekende outline, box-shadow, rand en achtergrond zonder en met focus vergeleken"),
  spec("layout-box", ["target"], "layout-box", "loep", "toolbox", "EUPL-1.2", "maten en afstanden uit de layout van Chromium"),
  spec("chromium-tab", ["taborder"], "keyboard-walk", "chromium", { browser: "chromium" }, "BSD-3-Clause", "echte Tab-aanslagen in Chromium"),
  spec("tabbable", ["taborder"], "static-tab-order", "tabbable", { package: "tabbable" }, "MIT", "voorspelling uit de DOM, zonder toetsaanslag"),
  spec("webkit-tab", ["taborder"], "keyboard-walk", "webkit", { browser: "webkit" }, "LGPL-2.1 en BSD-2-Clause", "echte Tab-aanslagen in WebKit, op dezelfde toestand opnieuw afgespeeld", true),
  spec("firefox-tab", ["taborder"], "keyboard-walk", "firefox", { browser: "firefox" }, "MPL-2.0", "echte Tab-aanslagen in Firefox, op dezelfde toestand opnieuw afgespeeld", true),
  spec("eld", ["lang"], "language-detection", "eld", { package: "eld" }, "Apache-2.0", "statistiek op n-grammen van de tekst"),
  spec("cld3", ["lang"], "language-detection", "cld3-asm", { package: "cld3-asm" }, "MIT", "neuraal model van Chromium (CLD3) op de tekst"),
  spec("vnu", ["source"], "source-validation", "vnu-jar", { binary: "java" }, "MIT", "de HTML-parser van het W3C op de bron zoals de server die stuurt", true),
  spec("html-validate", ["source"], "source-validation", "html-validate", { package: "html-validate" }, "MIT", "eigen parser in Node op de bron zoals de server die stuurt"),
  spec("tesseract", ["ocr"], "ocr", "tesseract", { binary: "tesseract" }, "Apache-2.0", "tekstherkenning op de pixels van de afbeelding", true),
  spec("alt-text", ["ocr"], "browser-accessibility-tree", "chromium", { browser: "chromium" }, "BSD-3-Clause", "de tekst die hulpsoftware voor de afbeelding krijgt"),
  spec("animation-api", ["motion"], "animation-api", "loep", "toolbox", "EUPL-1.2", "wat de pagina zelf als animatie opgeeft: getAnimations(), marquee, autoplay"),
  spec("screenshot-diff", ["motion"], "screenshot-diff", "loep", "toolbox", "EUPL-1.2", "schermafbeeldingen over een paar seconden vergeleken"),
  spec("whisper", ["media"], "speech-recognition", "whisper.cpp", { binary: "whisper" }, "MIT", "spraakherkenning op het geluid van het bestand zelf", true),
  spec("text-tracks", ["media"], "text-track", "loep", "toolbox", "EUPL-1.2", "de ondertitels die de pagina bij het element opgeeft, gelezen uit het bestand zoals de server het stuurt"),
  spec("ffmpeg", ["media"], "media-decoding", "ffmpeg", { binary: "ffmpeg" }, "LGPL-2.1-or-later of GPL-2.0-or-later, naar de bouw", "het bestand gedecodeerd: sporen, stilte, beelden en de helderheid per beeld", true),
  spec("overflow-geometry", ["reflow"], "overflow-geometry", "loep", "toolbox", "EUPL-1.2", "wat voorbij de rand van het venster steekt of is afgekapt, uit de layout van Chromium op 320 pixels breed of op de helft van het venster (200%)"),
  spec("webkit-overflow", ["reflow"], "overflow-geometry", "webkit", { browser: "webkit" }, "LGPL-2.1 en BSD-2-Clause", "dezelfde meting uit de layout van WebKit, op dezelfde toestand opnieuw afgespeeld", true),
  spec("forced-text-spacing", ["spacing"], "forced-text-spacing", "loep", "toolbox", "EUPL-1.2", "de tekstafstand van WCAG 1.4.12 afgedwongen in Chromium: wat daarna is afgekapt of opzij schuift"),
  spec("webkit-spacing", ["spacing"], "forced-text-spacing", "webkit", { browser: "webkit" }, "LGPL-2.1 en BSD-2-Clause", "dezelfde tekstafstand afgedwongen in WebKit, op dezelfde toestand opnieuw afgespeeld", true),
  spec("colour-mode", ["forced"], "colour-mode-emulation", "loep", "toolbox", "EUPL-1.2", "de pagina opnieuw bekeken met geforceerde kleuren of meer contrast, nagebootst door Chromium: welke grens, focusaanduiding of tekening verdwijnt; geen eis van WCAG"),
  spec("vision-pixels", ["distinct"], "vision-emulation-pixels", "loep", "toolbox", "EUPL-1.2", "kleurverschil tussen twee elementen als contrastverhouding, gemeten op de pixels, gewoon en met de kleurenblindheid die Chromium nabootst (CDP Emulation.setEmulatedVisionDeficiency)"),
  spec("virtual-screen-reader", ["speech"], "screen-reader-simulation", "@guidepup/virtual-screen-reader", { package: "@guidepup/virtual-screen-reader" }, "MIT", "nagebootste schermlezer in de pagina: zegt wat volgens de ARIA-standaard wordt voorgelezen, geen echte schermlezer"),
  // Optional: only when the virtual Mac runs. Its own command (voiceover), because it reads in Safari and not in the browser of the session.
  spec("voiceover", ["speech"], "screen-reader", "voiceover", { guest: "voiceover" }, "macOS en VoiceOver van Apple", "een echte schermlezer: VoiceOver met Safari in een virtuele Mac, bediend met zijn eigen commando's en toetsen"),
];

export const methodById = (id: string): MethodSpec => {
  const found = METHODS.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown method ${id}`);
  return found;
};

const packageVersions = new Map<string, string>();

/** Version of an installed package, read from the installation itself. */
export function packageVersion(name: string): string {
  let version = packageVersions.get(name);
  if (version === undefined) {
    const manifest = join(TOOLBOX_ROOT, "node_modules", name, "package.json");
    version = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version : "not installed";
    packageVersions.set(name, version);
  }
  return version;
}

export interface Binary {
  available: boolean;
  version: string;
  /** One line that says how to install what is missing. */
  hint: string | null;
  /** For tesseract: the language data it will use. */
  languages?: string;
}

/** The command for an external binary. An environment variable can point somewhere else, also to nowhere. */
const COMMANDS = {
  java: ["LOEP_JAVA", "java"],
  tesseract: ["LOEP_TESSERACT", "tesseract"],
  ffmpeg: ["LOEP_FFMPEG", "ffmpeg"],
  ffprobe: ["LOEP_FFPROBE", "ffprobe"],
  whisper: ["LOEP_WHISPER", "whisper-cli"],
} as const;
export const binaryCommand = (name: BinaryName | "ffprobe"): string => process.env[COMMANDS[name][0]] ?? COMMANDS[name][1];

/** The model whisper.cpp recognises speech with: where the environment says, or else the usual place in the home directory. */
export const whisperModel = (): string => process.env.LOEP_WHISPER_MODEL ?? join(homedir(), ".cache", "whisper", "ggml-small.bin");

const modelHashes = new Map<string, Promise<string>>();

/**
 * The sha256 of a model file. The name of a model says little: "ggml-small.bin" is whatever
 * file stands there. Read once per file as it is now (path, size and time of change); a model
 * of half a gigabyte takes about a second.
 */
export function modelSha256(path: string): Promise<string> {
  const stat = statSync(path);
  const key = `${path}|${stat.size}|${stat.mtimeMs}`;
  let found = modelHashes.get(key);
  if (!found) {
    found = new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
    });
    modelHashes.set(key, found);
    found.catch(() => modelHashes.delete(key));
  }
  return found;
}

/** How the version of whisper names its model: the file name and the sha256 of the file. `modelOf` reads them back. */
const MODEL_IN_VERSION = / (\S+) sha256:([0-9a-f]{64})$/;

/** The model in the version of a measurement that listened: its file name and sha256. Null for a version without one, as before the hash was kept. */
export function modelOf(version: string | null | undefined): { name: string; sha256: string } | null {
  const found = MODEL_IN_VERSION.exec(version ?? "");
  return found ? { name: found[1]!, sha256: found[2]! } : null;
}

export const VNU_JAR = join(TOOLBOX_ROOT, "node_modules", "vnu-jar", "build", "dist", "vnu.jar");
const HINTS = {
  java: "installeer een Java-runtime van versie 11 of hoger, bijvoorbeeld: brew install temurin",
  tesseract: "installeer Tesseract met de Nederlandse taaldata, bijvoorbeeld: brew install tesseract tesseract-lang",
  ffmpeg: "installeer ffmpeg (met ffprobe), bijvoorbeeld: brew install ffmpeg",
  whisper: "installeer whisper.cpp, bijvoorbeeld: brew install whisper-cpp",
};
const MODEL_HINT = "het model voor spraakherkenning ontbreekt: zet ggml-small.bin (huggingface.co/ggerganov/whisper.cpp) in ~/.cache/whisper of wijs een model aan met LOEP_WHISPER_MODEL";
const probed = new Map<string, Promise<Binary>>();

async function probe(name: BinaryName, command: string): Promise<Binary> {
  try {
    if (name === "java") {
      // Java prints its version on the error stream.
      const { stderr, stdout } = await run(command, ["-version"], { timeout: 10_000 });
      const java = /version "([^"]+)"/.exec(`${stderr}${stdout}`)?.[1] ?? "unknown";
      if (!existsSync(VNU_JAR)) return { available: false, version: `java ${java}`, hint: "vnu.jar ontbreekt: draai npm ci in de toolbox" };
      return { available: true, version: `${packageVersion("vnu-jar")} java ${java}`, hint: null };
    }
    if (name === "ffmpeg") {
      const { stdout } = await run(command, ["-version"], { timeout: 10_000 });
      await run(binaryCommand("ffprobe"), ["-version"], { timeout: 10_000 });
      return { available: true, version: /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? "unknown", hint: null };
    }
    if (name === "whisper") {
      const found = await run(command, ["--version"], { timeout: 10_000 });
      const whisper = /version:?\s*v?([\w.-]+)/.exec(`${found.stdout}${found.stderr}`)?.[1] ?? "unknown";
      if (!existsSync(whisperModel())) return { available: false, version: whisper, hint: MODEL_HINT };
      // Every measurement that listens carries this version: the name of the model and the sha256 of the file it was.
      return { available: true, version: `${whisper} ${basename(whisperModel())} sha256:${await modelSha256(whisperModel())}`, hint: null };
    }
    const { stdout, stderr } = await run(command, ["--version"], { timeout: 10_000 });
    const version = /tesseract\s+v?([\w.-]+)/.exec(`${stdout}${stderr}`)?.[1] ?? "unknown";
    const listed = (await run(command, ["--list-langs"], { timeout: 10_000 })).stdout.split("\n").map((line) => line.trim());
    const languages = ["nld", "eng"].filter((language) => listed.includes(language));
    if (languages.length === 0) return { available: false, version, hint: "Tesseract heeft geen taaldata voor Nederlands of Engels: brew install tesseract-lang" };
    return { available: true, version, hint: null, languages: languages.join("+") };
  } catch {
    return { available: false, version: "not installed", hint: HINTS[name] };
  }
}

/** Whether an external binary is there, and which version; asked once per command path. */
export function binary(name: BinaryName): Promise<Binary> {
  const command = binaryCommand(name);
  const key = `${name}:${command}${name === "ffmpeg" ? `:${binaryCommand("ffprobe")}` : name === "whisper" ? `:${whisperModel()}` : ""}`;
  let found = probed.get(key);
  if (!found) {
    found = probe(name, command);
    probed.set(key, found);
  }
  return found;
}

/** Versions of the browsers a session has running; a method that runs in one carries that version. */
export type BrowserVersions = Partial<Record<"chromium" | "webkit" | "firefox", string>>;

/** The version of a browser that this Playwright installs, for when the browser itself is not running to ask. */
function bundledBrowserVersion(name: string): string {
  try {
    const list = (JSON.parse(readFileSync(join(TOOLBOX_ROOT, "node_modules", "playwright-core", "browsers.json"), "utf8")) as { browsers: { name: string; browserVersion?: string }[] }).browsers;
    return list.find((browser) => browser.name === name)?.browserVersion ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Said for the version of a method in a virtual machine: macOS, Safari and VoiceOver are in each measurement. */
export const GUEST_VERSION = "per meting";

/**
 * Whether the virtual Mac for VoiceOver runs; asked of lume at most once a minute. An
 * environment variable can say it without asking: LOEP_VOICEOVER=off for never.
 */
let guestKnown: { at: number; running: boolean } | null = null;
export async function guestRunning(): Promise<boolean> {
  if (process.env.LOEP_VOICEOVER === "off") return false;
  if (guestKnown && Date.now() - guestKnown.at < 60_000) return guestKnown.running;
  const { lumeGuest } = await import("../../lib/voiceover.ts");
  const running = (await lumeGuest().state().catch(() => "no-lume")) === "running";
  guestKnown = { at: Date.now(), running };
  return running;
}

export async function versionOf(method: MethodSpec, browsers: BrowserVersions = {}): Promise<string> {
  const source = method.source;
  if (source === "toolbox") return `${TOOLBOX_VERSION}${browsers.chromium ? ` chromium ${browsers.chromium}` : ""}`;
  if ("package" in source) return packageVersion(source.package);
  if ("binary" in source) return (await binary(source.binary)).version;
  if ("guest" in source) return GUEST_VERSION;
  return browsers[source.browser] ?? bundledBrowserVersion(source.browser);
}

/**
 * Answers that a method is known to get wrong, as data. A method's answer that matches an
 * entry stays in the record and in the print, marked "bekend onbetrouwbaar hier".
 */
export interface KnownError {
  method: string;
  /** Which situation; matched by the code that knows the situation, by this key. */
  key: string;
  reason: string;
}

export const KNOWN_ERRORS: KnownError[] = [
  { method: "alfa", key: "light-dark", reason: "Alfa leest een kleur met light-dark() als zwart en kan contrast daarmee ten onrechte goedkeuren" },
  { method: "qualweb", key: "QW-WCAG-T17", reason: "QualWeb QW-WCAG-T17 geeft voor hetzelfde veld de ene keer geslaagd en de andere keer afgekeurd" },
  { method: "ibm", key: "labelledby-concatenation", reason: "IBM plakt de delen van aria-labelledby zonder spatie aan elkaar" },
  { method: "axe-name", key: "name-without-role", reason: "axe geeft voor een element zonder rol de tekstinhoud terug als naam" },
  { method: "axe-core", key: "contrast-truncated", reason: "axe kapt de contrastwaarde af waar andere afronden (2,84 tegenover 2,85)" },
  { method: "dom-accessibility-api", key: "placeholder", reason: "dom-accessibility-api telt placeholder niet mee als naam" },
  { method: "webkit-tab", key: "alt-tab", reason: "WebKit slaat met Tab links en knoppen over; de wandeling gebruikt daarom Option+Tab" },
  { method: "eld", key: "frisian", reason: "eld ziet Fries als Nederlands" },
  { method: "whisper", key: "speech-in-silence", reason: "whisper schrijft bij stilte soms woorden uit die niet gezegd zijn; die stukken zijn niet vergeleken" },
  { method: "alfa", key: "live-state", reason: "Alfa rekent op een kopie van de DOM en ziet niet dat de aanwijzer op het element staat of dat het focus heeft" },
];

export const knownError = (method: string, key: string): string | undefined => KNOWN_ERRORS.find((entry) => entry.method === method && entry.key === key)?.reason;

/** For tests: methods that must fail the next time they run, to prove that the others still answer. */
export const INJECTED_FAULTS = new Set<string>();

export type Ran<T> = { ok: true; value: MethodResult<T> } | { ok: false; failure: MethodFailure };

const DEFAULT_LIMIT_MS = 30_000;

/**
 * Run one method on its own: its own try, its own time limit, its own clock. Whatever goes
 * wrong becomes a failure entry and never an exception, so the other methods still answer.
 */
export async function runMethod<T>(id: string, browsers: BrowserVersions, work: () => Promise<T>, limitMs = DEFAULT_LIMIT_MS): Promise<Ran<T>> {
  const method = methodById(id);
  const identity = { method: method.method, implementation: method.implementation, version: await versionOf(method, browsers).catch(() => "unknown") };
  const started = Date.now();
  const limited = await withinTime(limitMs, async () => {
    if (INJECTED_FAULTS.has(id)) throw new Error("opzettelijke fout in een test");
    return work();
  });
  const ms = Date.now() - started;
  if (limited.ok) return { ok: true, value: { ...identity, principle: method.principle, ms, result: limited.value } };
  const unavailable = limited.reason.startsWith(UNAVAILABLE);
  return { ok: false, failure: { ...identity, kind: unavailable ? "unavailable" : limited.reason.startsWith("geen antwoord binnen") ? "timeout" : "failed", reason: unavailable ? limited.reason.slice(UNAVAILABLE.length) : limited.reason, ms } };
}

const UNAVAILABLE = "niet beschikbaar: ";

/** Thrown by a method that cannot run on this machine; `hint` says what to install. */
export class Unavailable extends Error {
  constructor(hint: string) {
    super(`${UNAVAILABLE}${hint}`);
  }
}

/** Split what a set of methods produced into answers and failures, in the order given. */
export function sortRan<T>(ran: Ran<T>[]): { methods: MethodResult<T>[]; failed: MethodFailure[] } {
  const methods: MethodResult<T>[] = [];
  const failed: MethodFailure[] = [];
  for (const entry of ran) {
    if (entry.ok) methods.push(entry.value);
    else failed.push(entry.failure);
  }
  return { methods, failed };
}

/** The short name of the method behind an answer or a failure. */
export function idOf(entry: { method: string; implementation: string }): string {
  return METHODS.find((candidate) => candidate.method === entry.method && candidate.implementation === entry.implementation)?.id ?? entry.implementation;
}

export interface ToolStatus {
  id: string;
  questions: Question[];
  method: string;
  implementation: string;
  version: string;
  licence: string;
  principle: string;
  available: boolean;
  hint: string | null;
}

/** Every method with its version and whether it can run here. `browserInstalled` says whether a browser build is on this machine. */
export async function toolStatus(browsers: BrowserVersions, browserInstalled: (name: "chromium" | "webkit" | "firefox") => boolean): Promise<ToolStatus[]> {
  const out: ToolStatus[] = [];
  for (const method of METHODS) {
    let available = true;
    let hint: string | null = null;
    const source = method.source;
    if (source !== "toolbox" && "binary" in source) {
      const found = await binary(source.binary);
      available = found.available;
      hint = found.hint;
    } else if (source !== "toolbox" && "browser" in source) {
      available = browserInstalled(source.browser);
      if (!available) hint = `installeer de browser: npx playwright install ${source.browser}`;
    } else if (source !== "toolbox" && "guest" in source) {
      available = await guestRunning();
      if (!available) hint = "de virtuele Mac draait niet (loep voiceover start); zonder werkt de rest";
    } else if (source !== "toolbox" && packageVersion(source.package) === "not installed") {
      available = false;
      hint = "draai npm ci in de toolbox";
    }
    out.push({ id: method.id, questions: method.questions, method: method.method, implementation: method.implementation, version: await versionOf(method, browsers), licence: method.licence, principle: method.principle, available, hint });
  }
  return out;
}

export { require as toolboxRequire };
