import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { extname, join, normalize, relative, sep } from "node:path";
import { parseArgs, promisify } from "node:util";
import type { Browser, Page } from "playwright";
import { INPAGE_PATH, launchBrowser, loadPage, newContext } from "../browser/session.ts";
import { pageContrast } from "../instruments/contrast.ts";
import { withinTime } from "../instruments/limit.ts";
import { ensureHelpers, inCapsule, packageSource } from "../instruments/methods/capsule.ts";
import { detectLanguages, languagePieces, languageVerdicts } from "../instruments/methods/lang.ts";
import { comparableRole, namesOf } from "../instruments/methods/names.ts";
import { idOf, packageVersion, TOOLBOX_ROOT, type BrowserVersions } from "../instruments/methods/registry.ts";
import { allFindings, ENGINE_IDS, engineOf, runRuleEngines, type EngineId } from "../instruments/methods/rules.ts";
import { TOOLBOX_VERSION } from "../instruments/methods.ts";
import {
  calibrate,
  calibrationMarkdown,
  CONTRAST_METHODS,
  languageSaid,
  LANGUAGE_METHODS,
  NAME_METHODS,
  nameSaid,
  OWN_MAPPINGS,
  strongest,
  type Answer,
  type CalibrationReport,
  type Catalogue,
  type InstrumentInfo,
  type NamedElement,
  type OwnMapping,
  type PageMeasurement,
  type Said,
  type Source,
  type TestCase,
} from "../lib/calibration.ts";
import { toolchain } from "../lib/manifest.ts";

const run = promisify(execFile);

/**
 * Where the test cases come from. W3C publishes the test cases of the ACT rules in this
 * repository, in one list (`testcases.json`) with one small page per case; the rules themselves
 * are written in act-rules/act-rules.github.io and copied here on every change. The commit and
 * the hash of the list are fixed, so a later measurement runs on the same cases.
 */
export const ACT_SOURCE = {
  repository: "w3c/wcag-act-rules",
  commit: "f39b7f81cee60efe1f23205a893e031a7a02821b",
  testcasesSha256: "49051da603afa6d28b94ef3e758146dafcbe72bade7202a24636bab3ea4c0036",
};

/** The part of the repository that W3C serves under this path; the test cases name their helper files with it. */
const ASSETS = "content-assets/wcag-act-rules";
const SERVED_UNDER = `/WAI/${ASSETS}/`;
/** The report of the maker of Alfa as W3C publishes it: which rule of Alfa stands for which ACT rule. */
const ALFA_REPORT = "_data/wcag-act-rules/implementations/alfa.json";
const DONE = ".complete";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/** The directory the test cases are kept in between runs: outside the repository. */
export function cacheDir(commit: string): string {
  const root = process.env.LOEP_ACT_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "loep", "act-rules");
  return join(root, commit);
}

/**
 * Fetch the test cases of one commit into the cache, with one request, and check the hash of
 * the list. Only what the measurement reads is unpacked: the list, the pages, their helper
 * files and the report of Alfa. A cache that is already complete is used as it is.
 */
export async function fetchTestcases(commit = ACT_SOURCE.commit, log: (line: string) => void = () => undefined): Promise<string> {
  const dir = cacheDir(commit);
  if (existsSync(join(dir, DONE))) return dir;
  const archive = `https://codeload.github.com/${ACT_SOURCE.repository}/tar.gz/${commit}`;
  log(`testgevallen ophalen: ${archive}`);
  const response = await fetch(archive);
  if (!response.ok) throw new Error(`de testgevallen zijn niet op te halen (${response.status} van ${archive})`);
  const work = `${dir}.tmp`;
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const packed = join(work, "archive.tar.gz");
  await writeFile(packed, Buffer.from(await response.arrayBuffer()));
  const top = `wcag-act-rules-${commit}`;
  await run("tar", ["-xzf", packed, "-C", work, "--strip-components=1", `${top}/${ASSETS}`, `${top}/${ALFA_REPORT}`, `${top}/LICENSE.md`], { maxBuffer: 16 * 1024 * 1024 });
  await rm(packed);
  const found = sha256(readFileSync(join(work, ASSETS, "testcases.json")));
  if (commit === ACT_SOURCE.commit && found !== ACT_SOURCE.testcasesSha256) {
    await rm(work, { recursive: true, force: true });
    throw new Error(`testcases.json heeft een andere hash dan vastgelegd (${found}); er is niets bewaard`);
  }
  await writeFile(join(work, DONE), `${new Date().toISOString()}\n`);
  await rm(dir, { recursive: true, force: true });
  await rename(work, dir);
  return dir;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xml": "application/xhtml+xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
};

export interface TestcaseServer {
  origin: string;
  /** The address of a file of the cached copy, given its path under the assets. */
  urlOf(relativePath: string): string;
  close(): Promise<void>;
}

/** The ports of the test site of the toolbox and of others who measure at the same time: never taken here. */
const PORTS_OF_OTHERS = new Set([4710, 4711, 4712, 4730, 4731, 4732]);

/**
 * Serve the cached copy on this machine, under the same path as W3C does: the test cases point
 * to their helper files with that path. Files only; a part of a file when the browser asks for
 * one, as it does for video and sound.
 */
export async function serveTestcases(dir: string): Promise<TestcaseServer> {
  const root = join(dir, ASSETS);
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = normalize(join(root, path.slice(SERVED_UNDER.length)));
    if (!path.startsWith(SERVED_UNDER) || path.includes("\0") || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("niet gevonden");
      return;
    }
    const size = statSync(file).size;
    const headers = { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-store" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range && (range[1] !== "" || range[2] !== "")) {
      const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start > end || start >= size) {
        response.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "content-length": size });
    createReadStream(file).pipe(response);
  });
  for (;;) {
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    if (!PORTS_OF_OTHERS.has((server.address() as AddressInfo).port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    urlOf: (relativePath) => `${origin}${SERVED_UNDER}${relativePath}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []));
}

/** What the cached copy holds, with the hashes that say which copy it is. Nothing of the home directory goes in. */
export function describeSource(dir: string, commit: string): { source: Source; testcases: TestCase[] } {
  const root = join(dir, ASSETS);
  const list = readFileSync(join(root, "testcases.json"));
  const parsed = JSON.parse(list.toString("utf8")) as { license?: string; testcases: TestCase[] };
  const served = [...filesUnder(join(root, "testcases")), ...(existsSync(join(root, "test-assets")) ? filesUnder(join(root, "test-assets")) : [])];
  const lines = served.map((file) => `${sha256(readFileSync(file))}  ${relative(root, file).split(sep).join("/")}`).sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1));
  return {
    testcases: parsed.testcases,
    source: {
      repository: ACT_SOURCE.repository,
      commit,
      archive: `https://codeload.github.com/${ACT_SOURCE.repository}/tar.gz/${commit}`,
      testcasesSha256: sha256(list),
      filesSha256: sha256(`${lines.join("\n")}\n`),
      files: served.length,
      licence: parsed.license ?? "niet opgegeven",
      testcases: parsed.testcases.length,
      pages: new Set(parsed.testcases.map((testcase) => testcase.testcaseId)).size,
      rules: new Set(parsed.testcases.map((testcase) => testcase.ruleId)).size,
    },
  };
}

/** Which rule of Alfa stands for which ACT rule, from the report that W3C publishes; Alfa itself does not carry it. */
export function alfaMapping(dir: string): { version: string; perRule: Record<string, string[]> } {
  const report = JSON.parse(readFileSync(join(dir, ALFA_REPORT), "utf8")) as { version?: string; actRuleMapping: { ruleId: string; procedureNames?: string[] }[] };
  const perRule: Record<string, string[]> = {};
  for (const entry of report.actRuleMapping) for (const rule of entry.procedureNames ?? []) (perRule[rule] ??= []).push(entry.ruleId);
  return { version: report.version ?? "onbekend", perRule };
}

const AXE_CATALOGUE = `async () => Object.fromEntries(axe.getRules().map((rule) => [rule.ruleId, rule.actIds ?? []]))`;
/** IBM names the ACT rule as a word, as a list, or as a list of objects whose keys are the ACT rules. A rule counts for the toolbox when its outcome is a violation of WCAG 2.2. */
const IBM_CATALOGUE = `async () => {
  const map = new ace.Checker().engine.ruleMap;
  return Object.fromEntries(Object.entries(map).map(([id, info]) => [id, {
    act: [].concat(info.act ?? []).flatMap((entry) => (typeof entry === "string" ? [entry] : entry && typeof entry === "object" ? Object.keys(entry) : [])),
    runs: (info.rulesets ?? []).some((set) => [].concat(set.id).includes("WCAG_2_2") && set.level === "VIOLATION"),
  }]));
}`;

/** What axe-core and the engine of IBM say in their own metadata about ACT rules; read once, on an empty page. */
async function staticCatalogues(page: Page): Promise<{ axe: Record<string, string[]>; ibm: Catalogue }> {
  await page.setContent("<!DOCTYPE html><html lang=\"en\"><head><title>leeg</title></head><body></body></html>");
  return {
    axe: await inCapsule<Record<string, string[]>>(page, [packageSource("axe-core/axe.min.js")], AXE_CATALOGUE),
    ibm: await inCapsule<Catalogue>(page, [packageSource("accessibility-checker-engine/ace.js")], IBM_CATALOGUE),
  };
}

const MAX_ELEMENTS = 60;
const PAGE_LIMIT_MS = 180_000;
/** A page that takes longer than this is named in the log, so a run that stalls says where. */
const SLOW_PAGE_MS = 30_000;

interface Wanted {
  names: boolean;
  contrast: boolean;
  language: string[];
}

interface Measured extends PageMeasurement {
  /** Per engine the rules that gave an outcome, with the ACT rules the engine names for them. */
  seen: Partial<Record<EngineId, Record<string, string[]>>>;
  refused: number;
}

/** The name and role of every element of the page by every name method; Chromium's tree says which element has which role. */
async function namedElements(page: Page, browsers: BrowserVersions): Promise<NamedElement[]> {
  await ensureHelpers(page);
  const places = await page.evaluate((max) => {
    const helpers = (window as unknown as { __loepm: { where: (element: Element) => string | null } }).__loepm;
    const skipped = new Set(["script", "style", "template", "noscript", "br", "source", "track", "param"]);
    return [...document.querySelectorAll("body *")]
      .filter((element) => !skipped.has(element.localName))
      .slice(0, max)
      .map((element) => ({ where: helpers.where(element), imageInput: element.matches('input[type="image" i]') }))
      .filter((entry): entry is { where: string; imageInput: boolean } => entry.where !== null);
  }, MAX_ELEMENTS);
  const share = {};
  const out: NamedElement[] = [];
  for (const place of places) {
    const ran = await namesOf(page, place.where, browsers, share);
    const chromium = ran.methods.find((method) => idOf(method) === "chromium");
    // Without the tree of Chromium nothing says what the element is: it is left out.
    if (!chromium) continue;
    out.push({
      role: comparableRole(chromium.result.role),
      ignored: chromium.result.ignored === true,
      imageInput: place.imageInput,
      names: Object.fromEntries(NAME_METHODS.map((id) => [id, ran.methods.find((method) => idOf(method) === id)?.result.name ?? null])),
    });
  }
  return out;
}

/** The language measurements of the toolbox on the page and on its parts, set against the two ACT rules about language. */
async function languageAnswers(page: Page, browsers: BrowserVersions, wanted: string[]): Promise<Record<string, Record<string, Answer>>> {
  const { subject, blocks } = await languagePieces(page, null, MAX_ELEMENTS);
  const pieces = [subject, ...blocks];
  const { methods } = await detectLanguages(pieces, browsers);
  const together = languageVerdicts(pieces, methods);
  const primary = (code: string | null): string | null => code?.toLowerCase().split(/[-_]/)[0] || null;
  /** One detector on its own: sure of another language than declared is a failure, not sure is doubt. */
  const alone = (id: string, index: number): Answer => {
    const method = methods.find((entry) => idOf(entry) === id);
    if (!method) return "error";
    const declared = primary(pieces[index]!.declared);
    if (!declared) return "inapplicable";
    const detected = method.result.detected[index]?.language ?? null;
    return detected === null ? "cantTell" : detected === declared ? "passed" : "failed";
  };
  const out: Record<string, Record<string, Answer>> = Object.fromEntries(LANGUAGE_METHODS.map((id) => [id, {}]));
  const parts = pieces.map((piece, index) => ({ piece, index })).filter(({ piece, index }) => index > 0 && piece.ownAttribute);
  for (const mapping of OWN_MAPPINGS.filter((entry) => wanted.includes(entry.act))) {
    const indexes = mapping.kind === "language-page" ? [0] : parts.map((part) => part.index);
    for (const id of LANGUAGE_METHODS) {
      const answers = indexes.map((index) => (id === "eld+cld3" ? languageSaid(together[index]!.verdict) : alone(id, index)));
      out[id]![mapping.act] = answers.includes("error") ? "error" : strongest(answers as Said[]);
    }
  }
  return out;
}

/** Open one test case and measure it with everything that can say something about it. */
async function measurePage(browser: Browser, url: string, origin: string, wanted: Wanted): Promise<Measured> {
  const browsers: BrowserVersions = { chromium: browser.version() };
  const context = await newContext(browser, { writes: null });
  const measured: Measured = { engines: {}, own: {}, seen: {}, refused: 0 };
  try {
    await context.addInitScript({ path: INPAGE_PATH });
    const page = await context.newPage();
    let navigations = 0;
    // Nothing leaves this machine: a test case that names a file elsewhere does not get it. And the page stays the
    // page: a test case that sends the visitor on after a while is measured as it was served.
    await context.route("**/*", (route) => {
      const request = route.request();
      if (!request.url().startsWith(`${origin}/`)) {
        measured.refused++;
        return request.isNavigationRequest() ? route.fulfill({ status: 204, body: "" }) : route.abort("blockedbyclient");
      }
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && ++navigations > 1) return route.fulfill({ status: 204, body: "" });
      return route.fallback();
    });
    await context.routeWebSocket(/.*/, (socket) => {
      measured.refused++;
      void socket.close();
    });
    try {
      await loadPage(page, url);
    } catch (error) {
      measured.loadError = (error as Error).message.split("\n")[0]!;
      return measured;
    }
    const rules = await runRuleEngines(page, browsers);
    for (const method of rules.methods) {
      const engine = engineOf(method);
      measured.seen[engine] = Object.fromEntries(Object.entries(method.result.rules).map(([rule, info]) => [rule, info.act]));
      measured.engines[engine] = {};
    }
    for (const failure of rules.failed) measured.engines[engineOf(failure)] = failure.reason;
    // What an engine itself does not count as a violation is left out, as the toolbox does everywhere.
    const perEngine = new Map<EngineId, Map<string, Said[]>>();
    for (const finding of allFindings(rules)) {
      const perRule = perEngine.get(finding.engine) ?? new Map<string, Said[]>();
      perEngine.set(finding.engine, perRule);
      perRule.set(finding.rule, [...(perRule.get(finding.rule) ?? []), finding.outcome]);
    }
    for (const [engine, perRule] of perEngine) measured.engines[engine] = Object.fromEntries([...perRule].map(([rule, outcomes]) => [rule, strongest(outcomes)]));

    const own = async (ids: string[], acts: string[], work: () => Promise<Record<string, Record<string, Answer>>>): Promise<void> => {
      const limited = await withinTime(60_000, work);
      for (const id of ids) measured.own[id] = limited.ok ? (limited.value[id] ?? {}) : Object.fromEntries(acts.map((act) => [act, "error" as const]));
    };
    const nameRules = OWN_MAPPINGS.filter((mapping) => mapping.kind === "name");
    if (wanted.names) {
      await own(NAME_METHODS, nameRules.map((mapping) => mapping.act), async () => {
        const elements = await namedElements(page, browsers);
        return Object.fromEntries(NAME_METHODS.map((id) => [id, Object.fromEntries(nameRules.map((mapping) => [mapping.act, nameSaid(elements, mapping, id)]))]));
      });
    }
    if (wanted.language.length > 0) await own(LANGUAGE_METHODS, wanted.language, () => languageAnswers(page, browsers, wanted.language));
    // Last: the contrast measurement presses Tab to see text that only shows with focus.
    if (wanted.contrast) {
      await own(CONTRAST_METHODS, ["afw4f7"], async () => {
        const outcomes = (await pageContrast(page)).measurements.map((entry) => (entry.outcome === "exempt" ? "inapplicable" : entry.outcome));
        return { pixels: { afw4f7: strongest(outcomes) } };
      });
    }
    return measured;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export interface CalibrateOptions {
  /** The directory with the cached copy of the test cases. */
  dir: string;
  commit?: string;
  /** Only the cases of these ACT rules. */
  only?: string[];
  concurrency?: number;
  log?: (line: string) => void;
}

/** Run the calibration on a cached copy of the test cases and give the report and the outcome per case. */
export async function runCalibration(options: CalibrateOptions): Promise<{ report: CalibrationReport; cases: ReturnType<typeof calibrate>["cases"] }> {
  const log = options.log ?? (() => undefined);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const started = Date.now();
  const described = describeSource(options.dir, options.commit ?? ACT_SOURCE.commit);
  const testcases = options.only ? described.testcases.filter((testcase) => options.only!.includes(testcase.ruleId)) : described.testcases;
  const alfa = alfaMapping(options.dir);
  const server = await serveTestcases(options.dir);
  const browser = await launchBrowser();
  const pages = new Map<string, PageMeasurement>();
  const seen: Partial<Record<EngineId, Record<string, string[]>>> = {};
  let refused = 0;
  let statics: { axe: Record<string, string[]>; ibm: Catalogue };
  try {
    const context = await newContext(browser, { writes: null });
    statics = await staticCatalogues(await context.newPage());
    await context.close();
    // One page can be a test case of more than one rule: it is measured once, with everything any of its rules asks for.
    const wantedOf = new Map<string, { path: string; wanted: Wanted }>();
    for (const testcase of testcases) {
      const entry = wantedOf.get(testcase.testcaseId) ?? { path: testcase.relativePath, wanted: { names: false, contrast: false, language: [] } };
      wantedOf.set(testcase.testcaseId, entry);
      const mapping = OWN_MAPPINGS.find((candidate) => candidate.act === testcase.ruleId);
      if (mapping?.kind === "name") entry.wanted.names = true;
      else if (mapping?.kind === "contrast") entry.wanted.contrast = true;
      else if (mapping && !entry.wanted.language.includes(mapping.act)) entry.wanted.language.push(mapping.act);
    }
    const queue = [...wantedOf.entries()];
    const total = queue.length;
    let done = 0;
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [id, entry] = next;
        const began = Date.now();
        const limited = await withinTime(PAGE_LIMIT_MS, () => measurePage(browser, server.urlOf(entry.path), server.origin, entry.wanted));
        if (Date.now() - began > SLOW_PAGE_MS) log(`${entry.path}: ${Math.round((Date.now() - began) / 1000)} seconden${limited.ok ? "" : `, ${limited.reason}`}`);
        if (limited.ok) {
          const { seen: found, refused: blocked, ...measurement } = limited.value;
          refused += blocked;
          for (const engine of ENGINE_IDS) seen[engine] = { ...(seen[engine] ?? {}), ...(found[engine] ?? {}) };
          pages.set(id, measurement);
        } else pages.set(id, { engines: {}, own: {}, loadError: limited.reason });
        if (++done % 50 === 0 || done === total) log(`${done} van ${total} pagina's gemeten, ${Math.round((Date.now() - started) / 1000)} seconden`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
  }
  // A rule that gave an outcome on any page is a rule the toolbox runs. axe-core, Alfa and QualWeb report every rule they ran.
  const ran = (engine: EngineId): string[] => Object.keys(seen[engine] ?? {});
  const catalogues: Record<EngineId, Catalogue> = {
    "axe-core": Object.fromEntries(Object.entries(statics.axe).map(([rule, act]) => [rule, { act, runs: ran("axe-core").includes(rule) }])),
    alfa: Object.fromEntries([...new Set([...ran("alfa"), ...Object.keys(alfa.perRule)])].map((rule) => [rule, { act: alfa.perRule[rule] ?? [], runs: ran("alfa").includes(rule) }])),
    ibm: statics.ibm,
    qualweb: Object.fromEntries(Object.entries(seen.qualweb ?? {}).map(([rule, act]) => [rule, { act, runs: true }])),
  };
  const counted = calibrate(testcases, pages, catalogues);
  const chain = toolchain(browser.version());
  const own = (id: string, version: string): InstrumentInfo => ({ id, kind: "own", version, mapping: "een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt" });
  const chromium = `chromium ${browser.version()}`;
  const instruments: InstrumentInfo[] = [
    { id: "axe-core", kind: "ruleset", version: packageVersion("axe-core"), mapping: "de metadata van het pakket zelf (actIds per regel)" },
    { id: "alfa", kind: "ruleset", version: packageVersion("@siteimprove/alfa-rules"), mapping: `het implementatierapport dat W3C publiceert (${ALFA_REPORT} op dezelfde commit, gemaakt met Alfa ${alfa.version}); het pakket zelf noemt geen ACT-regels` },
    { id: "ibm", kind: "ruleset", version: packageVersion("accessibility-checker-engine"), mapping: "de metadata van het pakket zelf (act per regel)" },
    { id: "qualweb", kind: "ruleset", version: packageVersion("@qualweb/act-rules"), mapping: "de metadata van het pakket zelf (mapping per regel)" },
    own("chromium", chromium),
    own("alfa-aria", packageVersion("@siteimprove/alfa-aria")),
    own("axe-name", packageVersion("axe-core")),
    own("playwright", packageVersion("playwright")),
    own("dom-accessibility-api", packageVersion("dom-accessibility-api")),
    own("pixels", `${TOOLBOX_VERSION} ${chromium}`),
    own("eld", packageVersion("eld")),
    own("cld3", packageVersion("cld3-asm")),
    own("eld+cld3", `${packageVersion("eld")} en ${packageVersion("cld3-asm")}`),
  ];
  const { cases, ...rest } = counted;
  const report: CalibrationReport = {
    kind: "calibration",
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    source: described.source,
    toolbox: chain.toolbox,
    browser: chromium,
    instruments,
    ownMappings: OWN_MAPPINGS as OwnMapping[],
    run: { seconds: Math.round((Date.now() - started) / 100) / 10, concurrency, pagesMeasured: pages.size, pagesNotLoaded: [...pages.values()].filter((page) => page.loadError).length, requestsRefused: refused, only: options.only ?? null },
    ...rest,
  };
  return { report, cases };
}

const USAGE = `loep calibrate [--out <dir>] [--only <ACT rule ids>] [--concurrency <n>] [--commit <sha>]

Measures every instrument of the toolbox against the test cases of the ACT rules of W3C and
writes uitkomst.json, uitkomst.md and gevallen.json. Not a step of an evaluation.

  --out <dir>          Where to write (default: validatie/ijkset/<today> in the repository)
  --only <ids>         Only the cases of these ACT rules, comma-separated; the outcome then says it is not complete
  --concurrency <n>    Pages measured at the same time (default 4)
  --commit <sha>       Another commit of ${ACT_SOURCE.repository} than the fixed one; its hash is recorded, not checked

The test cases are fetched once, with one request, into LOEP_ACT_CACHE (default ~/.cache/loep/act-rules)
and served from this machine. No page is asked anything outside this machine while it is measured.
`;

export async function cli(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, only: { type: "string" }, concurrency: { type: "string" }, commit: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const log = (line: string): void => void process.stderr.write(`${line}\n`);
  const commit = values.commit ?? ACT_SOURCE.commit;
  const dir = await fetchTestcases(commit, log);
  const only = values.only?.split(",").map((id) => id.trim()).filter(Boolean);
  const { report, cases } = await runCalibration({ dir, commit, ...(only && only.length > 0 ? { only } : {}), ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}), log });
  const out = values.out ?? join(TOOLBOX_ROOT, "..", "validatie", "ijkset", report.date);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "uitkomst.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(out, "uitkomst.md"), calibrationMarkdown(report));
  // One case per line, so two measurements can be laid next to each other.
  await writeFile(join(out, "gevallen.json"), `[\n${cases.map((entry) => JSON.stringify(entry)).join(",\n")}\n]\n`);
  for (const instrument of report.instruments) {
    const total = report.totals[instrument.id]!;
    if (total.judged > 0) process.stdout.write(`${instrument.id}: ${total.judged} gevallen, ${total.found} terecht gevonden, ${total.missed} gemist, ${total.falseAlarm} onterecht gemeld, ${total.unsureOnFailure + total.unsureOnOther} twijfel\n`);
  }
  process.stdout.write(`${report.run.pagesMeasured} pagina's in ${Math.round(report.run.seconds)} seconden; uitkomst in ${values.out ?? relative(join(TOOLBOX_ROOT, ".."), out)}\n`);
}
