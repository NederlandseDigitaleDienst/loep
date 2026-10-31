import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pageLabels, readJson, sha256, sha256File, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import type { Evaluation, ReportFinding } from "../lib/evaluation.ts";
import { agentLoginNl, LOGIN_SESSION_FILE, loginForRun, RUN_SECRETS_FILE } from "../lib/login.ts";
import { stepStart, toolboxVersion, writeManifest } from "../lib/manifest.ts";
import { loadAllProcedures } from "../lib/procedures.ts";
import { readsForRun } from "../lib/reads.ts";
import { dateNl, deriveRechecks, rechecksMarkdownLines, REPORT_TEXT } from "../lib/report-markdown.ts";
import { SITE_CHECK_FILE, SITE_MODEL_FILE } from "../lib/sitemodel.ts";
import { readTemplate } from "../lib/templates.ts";
import { canonicalCommand, LOOK_COMMANDS, MEASURE_COMMANDS, OBSERVATION_ID, sessionOfObservation } from "../lib/verdict.ts";
import { criterionById } from "../lib/wcag.ts";
import { makeWorkDir } from "../lib/workdir.ts";
import { fill, loadObservations } from "./instrument-tasks.ts";
import { RECHECKS_DIR } from "./verify.ts";

/*
 * A recheck measures one finding, or every finding of one criterion, again on the site as it is
 * now, after the evaluation: the step of the verifier, done later. It changes nothing of the
 * evaluation. Everything it writes stands in `rechecks/<finding or criterion>/<moment>/`, which
 * the seal does not cover, so a sealed and signed run stays valid. That folder is a small run of
 * its own for the session of the agent: copies of what a session needs to find the site and its
 * states (inventory, sample, site model, recipes), a manifest with the toolbox of today, and no
 * permission to send. The agent's observations land there, never among those of the evaluation.
 */

export { RECHECKS_DIR };
export const RECHECK_OUTCOMES = ["nog aanwezig", "opgelost", "niet na te gaan"] as const;
export type RecheckOutcome = (typeof RECHECK_OUTCOMES)[number];
/** One finding to measure again is a small task; each further finding of the criterion adds to it. */
export const RECHECK_BUDGET = { commands: 15, perFinding: 10, minutes: 20, minutesPerFinding: 5 };

const ORDER = "opdracht.json";
const TASK = "opdracht.md";
const OUTPUT = "uitkomst.json";
const STAMP = "uitkomst.stamp.json";
/** What a session needs of the run to find the site, its pages by label and its saved states. */
const COPIED_FILES = ["inventory.json", "sample.json", SITE_MODEL_FILE, SITE_CHECK_FILE];
const SHOWING = new Set<string>([...LOOK_COMMANDS, ...MEASURE_COMMANDS]);

/** Where the defect was seen during the evaluation: the page, the window and whether a state had to be made first. */
export interface RecheckPlace {
  url: string;
  width: number | null;
  scheme: string | null;
  inState: boolean;
  /** The observation of the evaluation it comes from; null when it comes from the location of the finding alone. */
  observation: string | null;
}

export interface RecheckOrder {
  schema: "loep/recheck/1";
  /** The finding id or the criterion that was asked for; also the name of the folder above the moment. */
  target: string;
  criterion: string;
  findings: { id: string; titleNl: string; evidence: string[]; places: RecheckPlace[] }[];
  session: string;
  createdAt: string;
  toolboxVersion: string;
  evaluation: { evaluatedAt: string; sha256: string; toolboxVersion: string };
  maxCommands: number;
  maxMinutes: number;
}

export interface RecheckEntry {
  finding: string;
  outcome: RecheckOutcome;
  whereNl: string;
  observedNl: string;
  reasonNl?: string;
  evidence: string[];
}

export interface RecheckResult {
  session: string;
  findings: RecheckEntry[];
}

const momentOf = (date: Date): string => date.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
const withoutHash = (url: string): string => url.replace(/#.*$/, "");
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

interface RecordLike {
  id: string;
  command: string;
  error: string | null;
  time?: string;
  page?: { url: string; viewport?: { width: number }; scheme?: string } | null;
  state: { steps?: unknown[] } | null;
}

/** The places of a finding, from the observations of the evaluation it cites, or else from the pages of its locations. */
function placesOf(runDir: string, finding: ReportFinding, records: ReadonlyMap<string, RecordLike>): RecheckPlace[] {
  const places: RecheckPlace[] = [];
  for (const ref of finding.evidence) {
    const page = records.get(ref)?.page;
    if (!page?.url) continue;
    const record = records.get(ref)!;
    places.push({ url: withoutHash(page.url), width: page.viewport?.width ?? null, scheme: page.scheme ?? null, inState: (record.state?.steps?.length ?? 0) > 0, observation: ref });
  }
  if (places.length > 0) return places;
  const samplePath = join(runDir, "sample.json");
  if (!existsSync(samplePath)) return [];
  const items = (JSON.parse(readFileSync(samplePath, "utf8")) as { items: { url: string }[] }).items;
  const labels = pageLabels(items.length);
  return [...new Set(finding.locations.map((location) => location.page))].flatMap((label) => {
    const at = labels.indexOf(label);
    return at === -1 ? [] : [{ url: withoutHash(items[at]!.url), width: null, scheme: null, inState: false, observation: null }];
  });
}

const placeNl = (place: RecheckPlace): string =>
  [place.url, place.width !== null ? `${place.width} pixels breed` : null, place.scheme === "dark" ? "donker kleurschema" : null, place.inState ? "in een toestand (zie state.steps in de waarneming)" : null].filter(Boolean).join(", ");

function findingBlock(runDir: string, finding: ReportFinding, places: RecheckPlace[]): string {
  const observationPaths = finding.evidence.filter((ref) => OBSERVATION_ID.test(ref)).map((ref) => `\`${join(resolve(runDir), "observations", sessionOfObservation(ref), `${ref.slice(ref.lastIndexOf("-") + 1)}.json`)}\``);
  return [
    `### ${finding.id}: ${finding.titleNl}`,
    "",
    `- Wat toen werd gezien: ${finding.observedNl}`,
    `- Plekken: ${finding.locations.map((location) => `${location.page} (${location.where})`).join("; ") || "geen"}`,
    `- Hoeveel pagina's: ${finding.pagesAffected}`,
    `- Waar het gebrek toen werd gemeten: ${places.length > 0 ? places.map(placeNl).join("; ") : "niet bekend uit de waarnemingen; zoek de plek op met de plekken hierboven"}`,
    `- De waarnemingen van toen: ${observationPaths.length > 0 ? observationPaths.join(", ") : "geen uit een sessie; de bevinding rust op het dossier van het onderzoek"}`,
  ].join("\n");
}

export interface RecheckWritten {
  /** The folder of this recheck, relative to the run. */
  dir: string;
  task: string;
  session: string;
  findings: string[];
}

/**
 * Write the task for one agent that measures a finding (or every finding of a criterion) again on
 * the site as it is now. Writes only in its own folder under `rechecks/`; the run itself, sealed or
 * not, is only read.
 */
export async function recheck(runDir: string, what: { finding?: string | undefined; criterion?: string | undefined }, now = new Date()): Promise<RecheckWritten> {
  const startedAt = stepStart();
  if ((what.finding === undefined) === (what.criterion === undefined)) throw new Error("recheck needs --finding <id> or --criterion <id>, one of the two");
  const evaluationPath = join(runDir, "evaluation.json");
  if (!existsSync(evaluationPath)) throw new Error("deze run heeft nog geen evaluatie: natoetsen kan pas na evaluate, op een bevinding uit het onderzoek");
  const evaluation = await readJson<Evaluation>(evaluationPath);
  const all = evaluation.criteria.flatMap((criterion) => criterion.findings);
  let findings: ReportFinding[];
  if (what.finding !== undefined) {
    const found = all.find((finding) => finding.id === what.finding);
    if (!found) throw new Error(`de evaluatie heeft geen bevinding ${what.finding}; de nummers staan in het rapport en in evaluation.json`);
    findings = [found];
  } else {
    if (!criterionById(what.criterion!)) throw new Error(`--criterion: "${what.criterion}" is geen succescriterium`);
    findings = all.filter((finding) => finding.criterion === what.criterion);
    if (findings.length === 0) throw new Error(`criterium ${what.criterion} heeft geen bevindingen in deze evaluatie. Natoetsen meet een bevinding opnieuw; of een criterium voldoet, zegt pas een nieuw onderzoek`);
  }
  const criterionId = findings[0]!.criterion;
  const criterion = criterionById(criterionId)!;
  const procedure = loadAllProcedures().procedures.find((entry) => entry.id === criterionId);
  if (!procedure) throw new Error(`er is geen procedure voor criterium ${criterionId}`);

  const target = what.finding ?? what.criterion!;
  const dir = join(RECHECKS_DIR, target, momentOf(now));
  const workspace = resolve(runDir, dir);
  if (existsSync(workspace)) throw new Error(`${dir} bestaat al; wacht een seconde en probeer het opnieuw`);
  mkdirSync(workspace, { recursive: true });
  for (const name of COPIED_FILES) if (existsSync(join(runDir, name))) copyFileSync(join(runDir, name), join(workspace, name));
  if (existsSync(join(runDir, "recipes"))) cpSync(join(runDir, "recipes"), join(workspace, "recipes"), { recursive: true });
  // The session of a person who logged in is used where it lies, never copied: it is a secret.
  // The secrets of the run hold here too: the same register, not a copy of it.
  for (const name of [LOGIN_SESSION_FILE, RUN_SECRETS_FILE]) if (existsSync(join(runDir, name))) symlinkSync(relative(workspace, resolve(runDir, name)), join(workspace, name));
  const login = loginForRun(runDir);
  const reads = readsForRun(runDir);
  // Its own manifest: the toolbox of today, the login and the read requests of the run, and no permission to send.
  await writeJson(join(workspace, "manifest.json"), { steps: [], ...(login ? { login } : {}), ...(reads.length > 0 ? { reads } : {}) });
  await writeManifest(workspace, { command: "recheck", startedAt, target, findings: findings.map((finding) => finding.id) });

  const records = loadObservations(runDir).records as unknown as Map<string, RecordLike>;
  const session = `n-${criterionId.replaceAll(".", "")}`;
  const maxCommands = RECHECK_BUDGET.commands + RECHECK_BUDGET.perFinding * findings.length;
  const maxMinutes = RECHECK_BUDGET.minutes + RECHECK_BUDGET.minutesPerFinding * (findings.length - 1);
  const order: RecheckOrder = {
    schema: "loep/recheck/1",
    target,
    criterion: criterionId,
    findings: findings.map((finding) => ({ id: finding.id, titleNl: finding.titleNl, evidence: finding.evidence, places: placesOf(runDir, finding, records) })),
    session,
    createdAt: now.toISOString(),
    toolboxVersion: toolboxVersion(),
    evaluation: { evaluatedAt: evaluation.evaluatedAt, sha256: await sha256File(evaluationPath), toolboxVersion: evaluation.toolchain.toolbox.version },
    maxCommands,
    maxMinutes,
  };
  await writeJson(join(workspace, ORDER), order);
  const cli = resolve(new URL("../cli.ts", import.meta.url).pathname);
  const task = join(dir, TASK);
  await writeFileAtomic(
    join(runDir, task),
    fill(readTemplate("natoets"), {
      id: criterion.id,
      title: criterion.titleNl,
      level: criterion.level,
      evaluatedOn: dateNl(evaluation.evaluatedAt),
      findings: findings.map((finding, at) => findingBlock(runDir, finding, order.findings[at]!.places)).join("\n\n"),
      firstFinding: findings[0]!.id,
      run: workspace,
      mainRun: resolve(runDir),
      cli,
      session,
      login: agentLoginNl(login),
      workDir: await makeWorkDir(workspace, session),
      workName: session,
      maxCommands: String(maxCommands),
      maxMinutes: String(maxMinutes),
      output: join(workspace, OUTPUT),
      check: `node ${cli} check-recheck --run ${resolve(runDir)} --${what.finding !== undefined ? "finding" : "criterion"} ${target} --at ${momentOf(now)}`,
      procedure: procedure.body,
    }),
  );
  return { dir, task, session, findings: findings.map((finding) => finding.id) };
}

/** The folder of a recheck: the one at the moment asked for, or else the latest. */
function recheckDir(runDir: string, target: string, at: string | undefined): string {
  const base = join(runDir, RECHECKS_DIR, target);
  const moments = existsSync(base) ? readdirSync(base).filter((name) => existsSync(join(base, name, ORDER))).sort() : [];
  const moment = at ?? moments.at(-1);
  if (!moment || !moments.includes(moment)) throw new Error(at ? `er is geen nameting ${target} op ${at}; er zijn: ${moments.join(", ") || "geen"}` : `er is geen nameting voor ${target}; schrijf er een met recheck`);
  return join(base, moment);
}

const sameWindow = (place: RecheckPlace, record: RecordLike): boolean =>
  !!record.page?.url &&
  withoutHash(record.page.url) === place.url &&
  (place.width === null || record.page.viewport?.width === place.width) &&
  (place.scheme === null || record.page.scheme === place.scheme) &&
  (!place.inState || (record.state?.steps?.length ?? 0) > 0);

/** What is wrong with the outcome of a recheck, against its order and the observations of its own session. Empty when it holds. */
export function validateRecheck(input: unknown, order: RecheckOrder, records: ReadonlyMap<string, RecordLike>): string[] {
  if (input === null || typeof input !== "object") return ["the outcome must be a JSON object with session and findings"];
  const result = input as Partial<RecheckResult>;
  const problems: string[] = [];
  if (result.session !== order.session) problems.push(`session must be "${order.session}", the session of this recheck`);
  const entries = Array.isArray(result.findings) ? result.findings : [];
  if (!Array.isArray(result.findings)) problems.push("findings must be a list with one entry per finding of the task");
  for (const finding of order.findings) {
    const count = entries.filter((entry) => entry?.finding === finding.id).length;
    if (count !== 1) problems.push(`finding ${finding.id} must have exactly one entry, it has ${count}`);
  }
  entries.forEach((entry, position) => {
    const at = `findings[${position}]`;
    const ordered = order.findings.find((finding) => finding.id === entry?.finding);
    if (!ordered) return void problems.push(`${at}: "${entry?.finding}" is not a finding of this recheck (${order.findings.map((finding) => finding.id).join(", ")})`);
    if (!RECHECK_OUTCOMES.includes(entry.outcome)) problems.push(`${at}.outcome must be one of: ${RECHECK_OUTCOMES.join(", ")}`);
    for (const field of ["whereNl", "observedNl"] as const) if (typeof entry[field] !== "string" || entry[field].trim() === "") problems.push(`${at}.${field} must say ${field === "whereNl" ? "where you measured" : "what your own measurement shows now"}`);
    for (const field of ["observedNl", "reasonNl"] as const) if (typeof entry[field] === "string" && words(entry[field]) > 60) problems.push(`${at}.${field} has ${words(entry[field])} words; at most 60`);
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    if (evidence.length === 0) problems.push(`${at}.evidence must name at least one observation of your own session ${order.session}`);
    const own: RecordLike[] = [];
    for (const ref of evidence) {
      const record = typeof ref === "string" ? records.get(ref) : undefined;
      if (typeof ref !== "string" || sessionOfObservation(ref) !== order.session) problems.push(`${at}.evidence: ${String(ref)} is not an observation of session ${order.session}; an observation of the evaluation says how the site was then, not how it is now`);
      else if (!record) problems.push(`${at}.evidence: ${ref} does not exist in the observations of this recheck`);
      else if (record.time !== undefined && Date.parse(record.time) < Date.parse(order.createdAt)) problems.push(`${at}.evidence: ${ref} was made before this recheck was written`);
      else own.push(record);
    }
    const showing = own.filter((record) => SHOWING.has(canonicalCommand(record.command)) && record.error === null);
    if ((entry.outcome === "nog aanwezig" || entry.outcome === "opgelost") && own.length > 0 && showing.length === 0) problems.push(`${at}: "${entry.outcome}" needs at least one observation of a look or measure command that did not fail`);
    if (entry.outcome === "opgelost" && showing.length > 0 && ordered.places.length > 0 && !showing.some((record) => ordered.places.some((place) => sameWindow(place, record)))) {
      problems.push(`${at}: "opgelost" needs a measurement at the same place where the defect was seen: ${ordered.places.map(placeNl).join("; ")}. That the defect is gone shows only where it was`);
    }
    if (entry.outcome === "niet na te gaan" && (typeof entry.reasonNl !== "string" || entry.reasonNl.trim().length < 15)) problems.push(`${at}.reasonNl must say why the finding cannot be checked now`);
  });
  return problems;
}

/**
 * Check the outcome of a recheck. When it holds, a stamp with its hash and the hashes of the
 * observations it cites is written next to it: only a stamped outcome counts in the appendix.
 */
export async function checkRecheck(runDir: string, target: string, at?: string): Promise<{ dir: string; problems: string[] }> {
  const dir = recheckDir(runDir, target, at);
  const order = await readJson<RecheckOrder>(join(dir, ORDER));
  if (!existsSync(join(dir, OUTPUT))) return { dir, problems: [`${relative(runDir, join(dir, OUTPUT))} is not there yet`] };
  const text = readFileSync(join(dir, OUTPUT), "utf8");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return { dir, problems: [`cannot read ${OUTPUT}: ${(error as Error).message}`] };
  }
  const observations = loadObservations(dir);
  const problems = validateRecheck(input, order, observations.records as unknown as Map<string, RecordLike>);
  if (problems.length === 0) {
    const cited = [...new Set((input as RecheckResult).findings.flatMap((entry) => entry.evidence))].sort();
    await writeJson(join(dir, STAMP), { outputSha256: sha256(text), observations: Object.fromEntries(cited.map((id) => [id, observations.sha(id)])), checkedAt: new Date().toISOString() });
  }
  return { dir, problems };
}

export interface CheckedRecheck {
  finding: string;
  titleNl: string;
  criterion: string;
  outcome: RecheckOutcome;
  /** Where the agent says it measured, in its own words. */
  whereNl: string;
  observedNl: string;
  reasonNl: string | null;
  /** The observations of the recheck it cites, and the windows they were made in. */
  evidence: string[];
  places: RecheckPlace[];
  /** When the agent measured: the latest of the observations it cites, as the instrument recorded it. */
  measuredAt: string;
  toolboxVersion: string;
  evaluationToolboxVersion: string;
}

/** Every recheck of the run whose outcome passed its check and is unchanged since, and how many did not. */
export function loadRechecks(runDir: string): { checked: CheckedRecheck[]; unchecked: number } {
  const root = join(runDir, RECHECKS_DIR);
  const checked: CheckedRecheck[] = [];
  let unchecked = 0;
  const folders = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const target of existsSync(root) ? folders(root) : []) {
    const base = join(root, target);
    for (const moment of folders(base)) {
      const dir = join(base, moment);
      if (!existsSync(join(dir, ORDER))) continue;
      const order = JSON.parse(readFileSync(join(dir, ORDER), "utf8")) as RecheckOrder;
      const stamp = existsSync(join(dir, STAMP)) ? (JSON.parse(readFileSync(join(dir, STAMP), "utf8")) as { outputSha256: string; observations: Record<string, string | null> }) : null;
      const text = existsSync(join(dir, OUTPUT)) ? readFileSync(join(dir, OUTPUT), "utf8") : null;
      const observations = loadObservations(dir);
      const holds = stamp !== null && text !== null && stamp.outputSha256 === sha256(text) && Object.entries(stamp.observations).every(([id, hash]) => observations.sha(id) === hash);
      if (!holds) {
        unchecked++;
        continue;
      }
      const result = JSON.parse(text!) as RecheckResult;
      for (const entry of result.findings) {
        const cited = entry.evidence.map((id) => observations.records.get(id) as unknown as RecordLike | undefined).filter((record): record is RecordLike => record !== undefined);
        const times = cited.map((record) => record.time).filter((time): time is string => typeof time === "string").sort();
        const places = cited.flatMap((record): RecheckPlace[] => (record.page?.url ? [{ url: withoutHash(record.page.url), width: record.page.viewport?.width ?? null, scheme: record.page.scheme ?? null, inState: (record.state?.steps?.length ?? 0) > 0, observation: record.id }] : []));
        checked.push({
          finding: entry.finding,
          titleNl: order.findings.find((finding) => finding.id === entry.finding)?.titleNl ?? "",
          criterion: order.criterion,
          outcome: entry.outcome,
          whereNl: entry.whereNl,
          observedNl: entry.observedNl,
          reasonNl: entry.reasonNl ?? null,
          evidence: entry.evidence,
          places,
          measuredAt: times.at(-1) ?? order.createdAt,
          toolboxVersion: order.toolboxVersion,
          evaluationToolboxVersion: order.evaluation.toolboxVersion,
        });
      }
    }
  }
  checked.sort((a, b) => a.finding.localeCompare(b.finding) || a.measuredAt.localeCompare(b.measuredAt));
  return { checked, unchecked };
}

/**
 * The working file with the rechecks, next to them in the run. A signed report has the same
 * rechecks in its appendix C (`render`); both are made by `deriveRechecks`. It says that these are
 * measurements after the evaluation, outside the seal and the signature, and that a finding that is
 * gone does not make its criterion pass.
 */
export function rechecksMarkdown(evaluation: Evaluation, loaded: { checked: CheckedRecheck[]; unchecked: number }): string {
  const derived = deriveRechecks(evaluation, loaded);
  const lines = [
    `# Bijlage: nametingen na het onderzoek`,
    "",
    `Site: ${evaluation.site.name}. Onderzoek van ${dateNl(evaluation.evaluatedAt)}, gemaakt met loep ${evaluation.toolchain.toolbox.version}.`,
    "",
    REPORT_TEXT.rechecks.intro,
    "",
    "Dit is een werkbestand in de map van de run. Is het onderzoek afgetekend, dan zet render dezelfde nametingen in bijlage C van het afgetekende rapport.",
    "",
    ...(derived ? rechecksMarkdownLines(derived, false) : ["Er zijn nog geen nametingen die de controle haalden."]),
  ];
  if (!derived && loaded.unchecked > 0) lines.push("", `${loaded.unchecked === 1 ? "Eén nameting haalde" : `${loaded.unchecked} nametingen haalden`} de controle niet, of ${loaded.unchecked === 1 ? "is" : "zijn"} daarna veranderd, en ${loaded.unchecked === 1 ? "staat" : "staan"} hier niet.`);
  return `${lines.join("\n")}\n`;
}

/** Write the working file with the rechecks next to them, in `rechecks/nametingen.md`. The report and the evaluation are not touched. */
export async function renderRechecks(runDir: string): Promise<{ path: string; checked: number; unchecked: number }> {
  const evaluation = await readJson<Evaluation>(join(runDir, "evaluation.json"));
  const loaded = loadRechecks(runDir);
  const path = join(runDir, RECHECKS_DIR, "nametingen.md");
  mkdirSync(join(runDir, RECHECKS_DIR), { recursive: true });
  await writeFileAtomic(path, rechecksMarkdown(evaluation, loaded));
  return { path, checked: loaded.checked.length, unchecked: loaded.unchecked };
}
