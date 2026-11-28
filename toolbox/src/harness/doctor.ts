import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { chooseBackend } from "./backend.ts";
import { backlogPath, homeDir, pluginFile, toolboxCli, workflowFile } from "./paths.ts";
import { readBacklog } from "./backlog.ts";
import { checkoutVersion, versionNl } from "./version.ts";

/*
 * Everything a run needs, checked before it starts: a run that dies after two hours in a tunnel that
 * was logged out costs more than this list. The disk is on it because a sweep with screenshots filled
 * this machine once; below 15 GB nothing new starts.
 */

export interface Check {
  labelNl: string;
  ok: boolean;
  detailNl: string;
}

export const MIN_FREE_GB = 15;

const which = (name: string): string | null => {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

/** The free space of the disk under the home of loep, in whole GB, or null when it cannot be read. */
export function freeGb(path: string): number | null {
  try {
    const stats = statfsSync(existsSync(path) ? path : homedir());
    return Math.floor((stats.bsize * stats.bavail) / 1024 ** 3);
  } catch {
    return null;
  }
}

export interface DoctorOptions {
  /** Also ask the VLAM routes, which costs one request and no model call. */
  routes?: boolean | undefined;
}

/**
 * Whether VLAM answers, asked with `vlam-routes`: one request and no model call. A tunnel that was
 * logged out 24 hours ago stops every agent, and finding that out before a run of hours is cheaper.
 */
export function routesCheck(): Check {
  const routes = which("vlam-routes");
  if (routes === null) return { labelNl: "VLAM", ok: true, detailNl: "vlam-routes niet gevonden; de routes worden niet vooraf geproefd" };
  try {
    execFileSync(routes, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    return { labelNl: "VLAM", ok: true, detailNl: "de routes antwoorden" };
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const last = typeof stderr === "string" ? stderr.trim().split("\n").at(-1) : undefined;
    return { labelNl: "VLAM", ok: false, detailNl: `vlam-routes faalt${last ? `: ${last}` : ""}; meld je zo nodig opnieuw aan bij de tunnel` };
  }
}

export function doctor(options: DoctorOptions = {}): Check[] {
  const checks: Check[] = [];
  const node = process.versions.node;
  const [major = 0, minor = 0] = node.split(".").map(Number);
  checks.push({ labelNl: "node", ok: major > 22 || (major === 22 && minor >= 18), detailNl: `${node} (nodig: 22.18 of nieuwer)` });
  checks.push({ labelNl: "toolbox", ok: existsSync(toolboxCli), detailNl: toolboxCli });
  checks.push({ labelNl: "werkstroom", ok: existsSync(workflowFile), detailNl: workflowFile });
  checks.push({ labelNl: "plugin", ok: existsSync(pluginFile), detailNl: `versie ${versionNl(checkoutVersion())}` });

  // Which agent runs the regie: LOEP_REGIE, or the first that is installed. loep ships none of them.
  let chosen: ReturnType<typeof chooseBackend> | null = null;
  try {
    chosen = chooseBackend();
  } catch {
    chosen = null;
  }
  checks.push({
    labelNl: "regie",
    ok: chosen !== null,
    detailNl: chosen === null ? "geen agent gevonden; installeer Claude Code of opencode, of zet LOEP_REGIE" : `${chosen.backend} (${chosen.whyNl})`,
  });
  // The wrapper starts claude itself, so a vlam-claude without claude beside it starts nothing.
  if (chosen?.backend === "vlam-claude") {
    checks.push({ labelNl: "claude", ok: which("claude") !== null, detailNl: which("claude") ?? "niet gevonden; vlam-claude heeft het nodig" });
  }
  checks.push({ labelNl: "just", ok: which("just") !== null, detailNl: which("just") ?? "niet gevonden; loep dev meting start de testsites en de taken van de justfile" });
  const routes = which("vlam-routes");
  checks.push(options.routes === true ? routesCheck() : { labelNl: "VLAM", ok: routes !== null, detailNl: routes ?? "vlam-routes niet gevonden; de routes worden dan niet vooraf geproefd (loep run proeft ze)" });

  const free = freeGb(homeDir());
  checks.push({ labelNl: "schijf", ok: free === null ? false : free >= MIN_FREE_GB, detailNl: free === null ? `onbekend onder ${homeDir()}` : `${free} GB vrij (onder ${MIN_FREE_GB} GB begint loep niets nieuws)` });

  let backlogDetail: string;
  let backlogOk = true;
  try {
    const backlog = readBacklog(backlogPath());
    backlogDetail = backlog.sites.length === 0 ? `${backlogPath()} is leeg` : `${backlog.sites.length} ${backlog.sites.length === 1 ? "site" : "sites"} in ${backlogPath()}`;
    if (backlog.problems.length > 0) {
      backlogOk = false;
      backlogDetail += `; ${backlog.problems.length} ${backlog.problems.length === 1 ? "punt" : "punten"} om na te lopen: ${backlog.problems.map((problem) => `${problem.where}: ${problem.textNl}`).join("; ")}`;
    }
  } catch (error) {
    backlogOk = false;
    backlogDetail = error instanceof Error ? error.message : String(error);
  }
  checks.push({ labelNl: "backlog", ok: backlogOk, detailNl: backlogDetail });
  return checks;
}

export function doctorTextNl(checks: Check[]): string {
  const width = Math.max(...checks.map((check) => check.labelNl.length));
  const lines = checks.map((check) => `${check.ok ? "ok " : "LET OP"} ${check.labelNl.padEnd(width)}  ${check.detailNl}`);
  const bad = checks.filter((check) => !check.ok).length;
  lines.push("", bad === 0 ? "Alles wat een run nodig heeft is er." : `${bad} van ${checks.length} niet in orde.`);
  return `${lines.join("\n")}\n`;
}
