import { appendFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Site } from "./backlog.ts";
import { runDirFor, siteDir, stateDir } from "./paths.ts";
import { regieArgs, regieEnv, regiePrompt } from "./regie.ts";
import { isSealed, readQuestion, startRegie } from "./run.ts";
import { readState, siteState, updateSite, type SiteState } from "./state.ts";
import { checkoutVersion, sameVersion, versionNl } from "./version.ts";

/*
 * One site, one regie. The state is written before the regie starts, so a killed lus still says what
 * was running, and again when it stops, with what it left behind. What the run holds decides the
 * phase, not the exit code of the regie: a regie can stop cleanly with a question or a report.
 */

export interface SiteRunOptions {
  site: Site;
  /** What a person did since the last stop; null on a first start. */
  resumeNl?: string | null | undefined;
  onStep?: ((step: string) => void) | undefined;
}

export const statePath = (): string => join(stateDir(), "state.json");
export const transcriptPath = (site: { slug: string }): string => join(siteDir(site.slug), "transcript.jsonl");
export const lockPath = (): string => join(stateDir(), "run.lock");

/** Keep the question of an earlier stop next to the new one: it says what a person answered. */
function archiveQuestion(dir: string): void {
  const path = join(dir, "vraag.md");
  if (!existsSync(path)) return;
  renameSync(path, join(dir, `vraag-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
}

export async function runSite(options: SiteRunOptions): Promise<SiteState> {
  const { site } = options;
  const dir = siteDir(site.slug);
  mkdirSync(dir, { recursive: true });
  const known = siteState(readState(statePath()), site.slug);
  // Een run hoort bij één checkout: de skill, de toolbox en de werkstroom zijn samen één versie, en een
  // tweede versie erover heen zou bewijs mengen dat bij verschillende code hoort.
  const version = checkoutVersion();
  if (known.version !== null && !sameVersion(known.version, version)) {
    throw new Error(`${site.slug} is begonnen in ${versionNl(known.version)} en deze checkout is ${versionNl(version)}; maak de run af in de versie waarin hij begon, of begin een nieuwe run`);
  }
  const run = known.run !== null && existsSync(known.run) ? known.run : runDirFor(site.slug);
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
  });
  const log = (message: string): void => appendFileSync(join(dir, "lus.log"), `${new Date().toISOString()} ${message}\n`);
  log(`regie start${options.resumeNl ? " (hervat)" : ""}: ${run}`);

  let result: Awaited<ReturnType<typeof startRegie>>;
  try {
    result = await startRegie({
      args: regieArgs(regiePrompt({ site, run, atOnce: site.atOnce, resumeNl: options.resumeNl }), run),
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

  const question = readQuestion(dir);
  const phase = question !== null ? "vraagt" : isSealed(run) ? "klaar" : "fout";
  log(`regie stopt (code ${String(result.code)}${result.signal ? `, signaal ${result.signal}` : ""}, laatste stap ${step ?? "geen"}); stand: ${phase}`);
  return updateSite(statePath(), site.slug, { phase, pid: null, step, question });
}

/** Standing still on purpose: the run is kept, and `resume` goes on from it. */
export function pauseSite(slug: string): void {
  updateSite(statePath(), slug, { phase: "gepauzeerd", pid: null });
}
