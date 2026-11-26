import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Site } from "./backlog.ts";
import { freeGb, MIN_FREE_GB } from "./doctor.ts";
import { homeDir, reportsDir, runDirFor, siteDir, stateDir, toolboxCli } from "./paths.ts";
import { continueNl, regieArgs, regieEnv, regiePrompt } from "./regie.ts";
import { isSealed, readQuestion, runSnapshot, startRegie } from "./run.ts";
import { readState, siteState, updateSite, type SiteState } from "./state.ts";
import { checkoutVersion, sameVersion, versionNl } from "./version.ts";

/*
 * One site, one regie. The state is written before the regie starts, so a killed lus still says what
 * was running, and again when it stops, with what it left behind. What the run holds decides the
 * phase, not the exit code of the regie: a regie can stop cleanly with a question or a report.
 *
 * A regie can also stop with nothing: it reports that the explorer is at work and ends its turn. A
 * `claude -p` then simply ends. That is a half-done run and not a failure of loep, so lus starts the
 * next turn itself, as long as the run grew and the count stays under MAX_CONTINUES.
 */

export const MAX_CONTINUES = 20;

export interface SiteRunOptions {
  site: Site;
  /** What a person did since the last stop; null on a first start. */
  resumeNl?: string | null | undefined;
  /**
   * Leave the run that is there and start another one next to it. A run belongs to one checkout, so a
   * site that began in another version can only go on in that version; what is left is a new run.
   */
  newRun?: boolean | undefined;
  /**
   * A person resumes the site: the count of turns starts again. A run that used up its turns ends as
   * "fout", and once somebody looked at it and resumed, it deserves the same twenty turns again.
   */
  byPerson?: boolean | undefined;
  onStep?: ((step: string) => void) | undefined;
}

export const statePath = (): string => join(stateDir(), "state.json");
export const transcriptPath = (site: { slug: string }): string => join(siteDir(site.slug), "transcript.jsonl");
export const lockPath = (): string => join(stateDir(), "run.lock");

/** What is wrong with the free space, or null when a run may begin. */
export function spaceProblemNl(free: number | null): string | null {
  // The floor can be moved for a machine that is tight and whose owner watches it; the tests set it to zero.
  const given = Number(process.env["LUS_MIN_FREE_GB"] ?? MIN_FREE_GB);
  // A floor that is no number would make every comparison false, and so be no floor.
  const floor = Number.isFinite(given) ? given : MIN_FREE_GB;
  return free !== null && free < floor ? `er is ${free} GB vrij; onder ${floor} GB begint lus geen run. Maak ruimte, of zie lus doctor` : null;
}

/** The run folder of today, or the next one when today already has one: a second run is not the first. */
function freeRunDir(slug: string): string {
  const base = runDirFor(slug);
  if (!existsSync(base)) return base;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${base}-${attempt}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * The report, out of the run: loep copies it to the reports folder under a name with the site and the
 * day, and lus passes the slug, because a report of 127.0.0.1:4710 says less than one of lindewaard. A
 * run without an evaluation has nothing to hand out, and a handout that fails is said in the log and
 * not a reason to call a sealed run a failure.
 */
export function handOut(slug: string, run: string): string[] {
  if (!existsSync(join(run, "evaluation.json"))) return [];
  const result = spawnSync("node", [toolboxCli, "handout", "--run", run, "--out", reportsDir(), "--name", slug], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").filter((line) => line.startsWith("/"));
}

/** Keep the question of an earlier stop next to the new one: it says what a person answered. */
function archiveQuestion(dir: string): void {
  const path = join(dir, "vraag.md");
  if (!existsSync(path)) return;
  renameSync(path, join(dir, `vraag-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
}

export async function runSite(options: SiteRunOptions): Promise<SiteState> {
  const { site } = options;
  // A run of hours writes gigabytes; a disk that fills up costs the run and the reports.
  const problem = spaceProblemNl(freeGb(homeDir()));
  if (problem !== null) throw new Error(problem);
  const dir = siteDir(site.slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The transcript holds everything the regie saw, also what a command printed; nobody else on the machine reads it.
  chmodSync(stateDir(), 0o700);
  const recorded = siteState(readState(statePath()), site.slug);
  // A run that is gone from disk is no run to go on with: what is left is a new one, in this version.
  const fresh = options.newRun === true || recorded.run === null || !existsSync(recorded.run);
  const known = fresh ? siteState({ sites: {} }, site.slug) : recorded;
  // A run belongs to one checkout: the skill, the toolbox and the workflow are one version together, and
  // a second version on top would mix evidence that belongs to different code.
  const version = checkoutVersion();
  if (known.version !== null && !sameVersion(known.version, version)) {
    throw new Error(`${site.slug} is begonnen in ${versionNl(known.version)} en deze checkout is ${versionNl(version)}; maak de run af in de versie waarin hij begon, of begin een nieuwe run: lus run --only ${site.slug} --new`);
  }
  const run = fresh ? freeRunDir(site.slug) : known.run!;
  mkdirSync(run, { recursive: true });
  archiveQuestion(dir);

  let step: string | null = null;
  updateSite(statePath(), site.slug, {
    phase: "loopt",
    run,
    pid: process.pid,
    startedAt: known.startedAt ?? new Date().toISOString(),
    step: null,
    question: null,
    version: known.version ?? version,
    humanNl: null,
    ...(fresh ? { continues: 0, handouts: [] } : {}),
  });
  const log = (message: string): void => appendFileSync(join(dir, "lus.log"), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  // A run that is already there goes on from where it stands, also when nobody says what happened: a
  // lus that was killed, or a regie that stopped with an error. Without this the regie would begin the
  // skill at the first step, in a run that has one behind it.
  let resumeNl = options.resumeNl ?? (fresh ? null : continueNl(run));
  log(`regie start${resumeNl ? " (hervat)" : ""}: ${run}`);

  let continues = options.byPerson === true ? 0 : known.continues;
  for (;;) {
    const before = runSnapshot(run);
    let result: Awaited<ReturnType<typeof startRegie>>;
    try {
      result = await startRegie({
        args: regieArgs(regiePrompt({ site, run, atOnce: site.atOnce, resumeNl }), run),
        env: regieEnv(),
        cwd: dir,
        transcript: transcriptPath(site),
        onStep: (found) => {
          if (found === step) return;
          step = found;
          options.onStep?.(found);
        },
      });
    } catch (error) {
      log(`de regie startte niet: ${error instanceof Error ? error.message : String(error)}`);
      return updateSite(statePath(), site.slug, { phase: "fout", pid: null, step: "start" });
    }
    if (result.interrupted) {
      // Somebody stopped lus: no next turn and no next site. The run stays for resume.
      log(`regie onderbroken (code ${String(result.code)}${result.signal ? `, signaal ${result.signal}` : ""}, laatste stap ${step ?? "geen"}); de run blijft staan`);
      return updateSite(statePath(), site.slug, { phase: "gepauzeerd", pid: null, step, continues });
    }

    const question = readQuestion(dir);
    const sealed = isSealed(run);
    const grew = runSnapshot(run) !== before;
    log(`regie stopt (code ${String(result.code)}${result.signal ? `, signaal ${result.signal}` : ""}, laatste stap ${step ?? "geen"})`);
    const half = question === null && !sealed;
    const space = half && grew ? spaceProblemNl(freeGb(homeDir())) : null;
    if (space !== null) log(`geen volgende beurt: ${space}`);
    if (half && grew && space === null && continues < MAX_CONTINUES) {
      continues += 1;
      resumeNl = continueNl(run);
      log(`de run is niet af en er is geen vraag: beurt ${continues} van ${MAX_CONTINUES}`);
      updateSite(statePath(), site.slug, { continues, step });
      continue;
    }
    if (half && !grew) log("de run is niet veranderd; nog een beurt zou hetzelfde kosten");
    const phase = question !== null ? "vraagt" : sealed ? "klaar" : "fout";
    const handouts = phase === "klaar" ? handOut(site.slug, run) : [];
    for (const file of handouts) log(`rapport: ${file}`);
    if (phase === "klaar" && handouts.length === 0) log("geen rapport om uit te geven: de run heeft geen evaluation.json, of handout faalde");
    log(`stand: ${phase}`);
    return updateSite(statePath(), site.slug, { phase, pid: null, step, question, handouts, continues: phase === "klaar" || phase === "vraagt" ? 0 : continues });
  }
}

/**
 * A run that finished before lus handed reports out has none in its state; `run` and `meting` fill that
 * in without starting a regie. The copy is a second copy of the same report, and the state then knows it.
 */
export function handOutMissing(slug: string, known: SiteState): string[] {
  if (known.phase !== "klaar" || known.run === null || known.handouts.length > 0) return [];
  const handouts = handOut(slug, known.run);
  if (handouts.length > 0) updateSite(statePath(), slug, { handouts });
  return handouts;
}

/** Standing still on purpose: the run is kept, and `resume` goes on from it. */
export function pauseSite(slug: string): void {
  updateSite(statePath(), slug, { phase: "gepauzeerd", pid: null });
}
