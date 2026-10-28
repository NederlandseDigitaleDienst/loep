import { execFileSync } from "node:child_process";
import type { Purpose } from "./purpose.ts";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDERING } from "../browser/session.ts";
import { readJson, sha256, writeJson } from "./canonical.ts";
import type { LoginMark } from "./login.ts";
import type { ReadRequest } from "./reads.ts";
import type { WritePermission } from "./writes.ts";

const TOOLBOX_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface ManifestStep {
  command: string;
  /** When the step was done. */
  at: string;
  /** When the command began. A run from before this was recorded has steps without it. */
  startedAt?: string;
  /** Whole seconds between `startedAt` and `at`. */
  seconds?: number;
  [argument: string]: unknown;
}

export interface Manifest {
  /** `commit` is null when the toolbox did not run from a git repository, as from the plugin cache; `dirty` is then false. */
  toolbox: { commit: string | null; dirty: boolean; lockfileSha256: string; version: string };
  runtime: { node: string; platform: string; osRelease: string; arch: string };
  packages: Record<string, string>;
  browser: { name: string; version: string | null };
  rendering: typeof RENDERING;
  steps: ManifestStep[];
  /** The measuring methods of an interactive session with their versions, when a session asked for them. */
  tools?: unknown[];
  /** Set at `inventory` when the run may send requests that change something, to one origin of a test environment. */
  writes?: WritePermission;
  /** Set by `login` when a person logged in for this run: the role and what tells a logged-in page from the login screen. Never the session itself. */
  login?: LoginMark;
  /** Set by `check-site` when the site model names read requests: the POST requests, such as a question to a search service, that were let through. */
  reads?: ReadRequest[];
  /**
   * The seed of the random part of the sample, made at the first `inventory` of the run, so that nobody can know
   * before the evaluation starts which pages it picks. A run from before this was recorded has none.
   */
  seed?: string;
  /** Set with `purpose`: what the investigation is for (#318). A run without it is one to improve. */
  purpose?: Purpose;
}

function git(root: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * The commit the toolbox at `root` runs from, and whether its files differ from that commit.
 * Outside a git repository, as in the plugin cache, there is no commit and nothing to compare with:
 * the commit is then null and the toolbox is never called dirty. A copy that sits inside some other
 * repository, or in one without a first commit, is treated the same: its commit says nothing about this code.
 */
export function toolboxSource(root: string = TOOLBOX_ROOT): { commit: string | null; dirty: boolean } {
  const tracked = git(root, "ls-files", "--error-unmatch", "--", "package.json") !== null;
  const commit = tracked ? git(root, "rev-parse", "HEAD") : null;
  // A dirty tree means the commit does not describe the code that ran.
  return { commit, dirty: commit !== null && (git(root, "status", "--porcelain", "--", ".") ?? "") !== "" };
}

function installedVersion(name: string): string {
  const manifest = join(TOOLBOX_ROOT, "node_modules", name, "package.json");
  return existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version : "not installed";
}

/** Every package the toolbox runs with, so the report names each one that may have measured. Type definitions run nothing. */
function runtimePackages(): string[] {
  const dependencies = (JSON.parse(readFileSync(join(TOOLBOX_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {};
  return Object.keys(dependencies).filter((name) => !name.startsWith("@types/")).sort();
}

/** The version of this toolbox, from its package.json. */
export const toolboxVersion = (): string => (JSON.parse(readFileSync(join(TOOLBOX_ROOT, "package.json"), "utf8")) as { version: string }).version;

/**
 * Commands that measure nothing and write no tasks or procedures: they may work on a run of another version of loep.
 * Some only read; `render`, `statement`, `compare`, `decide`, `sign` and `seal` write a report, a statement, a comparison,
 * a decision, a signature or a seal from what the run holds, which is what a finished, sealed run needs after a release.
 */
/*
 * `recheck` and `check-recheck` measure, but nothing of the evaluation: they measure the site as it is now, after it, in a
 * folder of their own with a manifest of their own, and touch no walk, verdict or sweep of the run. A version check would
 * only force whoever retests a finding to keep an old toolbox. The appendix names both versions when they differ.
 */
export const MEASURES_NOTHING = ["pending", "estimate", "gaps", "feedback", "verify", "procedures", "render", "export", "statement", "compare", "decide", "sign", "seal", "recheck", "check-recheck"];

/**
 * The commands of the agent phases. They work on the evidence of the sweep and measure nothing of the site, so in a copy
 * made with `variant` (it holds variant.json) they may run under a newer version of loep: that is how a variant of the
 * code is measured on a frozen sweep. The sweep itself (`inventory`, `collect`, `contrast`, `states`, `documents` and the
 * rest) is never measured again by another version.
 */
export const AGENT_PHASES = ["tasks", "skip", "unskip", "check-walk", "check-verdict", "evaluate", "answer", "merge", "check-merge"];

/** What variant.json of a copy holds of the version of the sweep; see VariantRecord in commands/variants.ts. */
interface VariantVersions {
  from?: { run?: string; toolbox?: Partial<Manifest["toolbox"]> | null; browser?: Manifest["browser"] | null };
}

/** The code the sweep of a copy made with `variant` was measured with, when that differs from the code of the agent phases. */
export interface SweepToolchain {
  /** The run the sweep was copied from, by folder name. */
  run: string;
  toolbox: Manifest["toolbox"];
  /** The browser of the sweep; null when variant.json does not hold it (copies made before it was recorded). */
  browser: Manifest["browser"] | null;
}

/**
 * For a copy made with `variant`: the code the sweep was measured with, taken from variant.json, or null when the run is
 * no copy, when variant.json does not name that code, or when it is the code of `current`. The sweep files themselves
 * hold no version of the code that wrote them.
 */
export function sweepToolchain(runDir: string, current: Manifest["toolbox"]): SweepToolchain | null {
  const file = join(runDir, "variant.json");
  if (!existsSync(file)) return null;
  const from = (JSON.parse(readFileSync(file, "utf8")) as VariantVersions).from;
  const toolbox = from?.toolbox;
  if (!toolbox?.version) return null;
  if (toolbox.version === current.version && (toolbox.commit ?? null) === current.commit && (toolbox.dirty ?? false) === current.dirty) return null;
  return {
    run: from?.run ?? "",
    toolbox: { commit: toolbox.commit ?? null, dirty: toolbox.dirty ?? false, lockfileSha256: toolbox.lockfileSha256 ?? "no lockfile", version: toolbox.version },
    browser: from?.browser ?? null,
  };
}

/**
 * The version a command on this run is held to, or null when there is nothing to hold it to. In a copy made with `variant`
 * the sweep is of the run it was copied from: its commands are held to that version, and the agent phases to none.
 * Elsewhere the run holds the version of loep of its last step.
 */
function heldVersion(runDir: string, command: string): { version: string | null; sweep: string | null } {
  const read = <T>(name: string): T | null => (existsSync(join(runDir, name)) ? (JSON.parse(readFileSync(join(runDir, name), "utf8")) as T) : null);
  const last = read<Partial<Manifest>>("manifest.json")?.toolbox?.version ?? null;
  const variant = read<VariantVersions>("variant.json");
  if (!variant) return { version: last, sweep: null };
  const sweep = variant.from?.toolbox?.version ?? last;
  return { version: AGENT_PHASES.includes(command) ? null : sweep, sweep };
}

/**
 * Why this toolbox may not go on with the run, or null when it may. A run holds the version of loep of its last step.
 * Another version writes other tasks and procedures: the walks and verdicts of the run then stop counting and are
 * done again, and a session process of the other version measures beside them. Changing on purpose takes `--other-toolbox`.
 */
export function otherToolboxNl(runDir: string, command: string, allowed: boolean): string | null {
  if (allowed || MEASURES_NOTHING.includes(command)) return null;
  const { version: run, sweep } = heldVersion(runDir, command);
  const own = toolboxVersion();
  if (!run || run === own) return null;
  if (sweep) return `de veegronde van deze kopie is gemaakt met loep ${run}, en dit is loep ${own} (${TOOLBOX_ROOT}). Een kopie van variant gaat met een andere versie alleen verder met de fasen van de agents (${AGENT_PHASES.join(", ")}); de veegronde zelf meet alleen loep ${run} opnieuw. Gebruik de toolbox van loep ${run}, of geef bewust --other-toolbox mee`;
  return `deze run is gemaakt met loep ${run}, en dit is loep ${own} (${TOOLBOX_ROOT}). Een andere versie schrijft andere opdrachten en procedures: de rondgangen en oordelen van de run gelden dan niet meer en worden opnieuw gedaan. Gebruik de toolbox van loep ${run}. Stap je bewust over, geef dan --other-toolbox mee, en meet daarna opnieuw met --fresh`;
}

/** For an agent phase in a copy made with `variant` whose sweep is of another version: the line that says so, else null. */
export function frozenSweepNl(runDir: string, command: string): string | null {
  if (!AGENT_PHASES.includes(command)) return null;
  const { sweep } = heldVersion(runDir, command);
  const own = toolboxVersion();
  return sweep && sweep !== own ? `de veegronde van deze kopie is van loep ${sweep}; de fasen van de agents draaien met loep ${own} (variant.json)` : null;
}

export function toolchain(browserVersion: string | null): Omit<Manifest, "steps"> {
  const lockfile = join(TOOLBOX_ROOT, "package-lock.json");
  return {
    toolbox: {
      ...toolboxSource(),
      lockfileSha256: existsSync(lockfile) ? sha256(readFileSync(lockfile)) : "no lockfile",
      version: toolboxVersion(),
    },
    runtime: { node: process.version, platform: platform(), osRelease: release(), arch: arch() },
    packages: Object.fromEntries(runtimePackages().map((name) => [name, installedVersion(name)])),
    browser: { name: "chromium", version: browserVersion },
    rendering: RENDERING,
  };
}

/** The moment a command begins, in the form a step keeps it. */
export const stepStart = (): string => new Date().toISOString();

/**
 * Record what ran, with what, in the run directory. Steps accumulate; the toolchain is the latest.
 * A command takes `startedAt` with `stepStart()` as its first line, so its step says how long it took.
 */
export async function writeManifest(runDir: string, step: Omit<ManifestStep, "at" | "seconds">, browserVersion: string | null = null): Promise<void> {
  const path = join(runDir, "manifest.json");
  const previous = existsSync(path) ? await readJson<Manifest>(path) : null;
  const at = new Date();
  const began = typeof step.startedAt === "string" ? Date.parse(step.startedAt) : NaN;
  const timed = { ...step, at: at.toISOString(), ...(Number.isFinite(began) ? { seconds: Math.max(0, Math.round((at.getTime() - began) / 1000)) } : {}) } as ManifestStep;
  const manifest: Manifest = {
    // A manifest that `login` started holds no browser yet.
    ...toolchain(browserVersion ?? previous?.browser?.version ?? null),
    steps: [...(previous?.steps ?? []), timed],
    ...(previous?.tools ? { tools: previous.tools } : {}),
    ...(previous?.writes ? { writes: previous.writes } : {}),
    ...(previous?.login ? { login: previous.login } : {}),
    ...(previous?.reads ? { reads: previous.reads } : {}),
    ...(previous?.purpose ? { purpose: previous.purpose } : {}),
    ...(previous?.seed ? { seed: previous.seed } : step.command === "inventory" ? { seed: randomBytes(16).toString("hex") } : {}),
  };
  await writeJson(path, manifest);
}

/**
 * Record the measuring methods of a session with their versions and whether they can run
 * here. The list replaces the one that was there; the steps of the run are left as they are.
 */
export async function writeManifestTools(runDir: string, tools: unknown[]): Promise<void> {
  const path = join(runDir, "manifest.json");
  const previous = existsSync(path) ? await readJson<Manifest>(path) : null;
  await writeJson(path, { ...(previous ?? { ...toolchain(null), steps: [] }), tools });
}
