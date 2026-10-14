import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDERING } from "../browser/session.ts";
import { readJson, sha256, writeJson } from "./canonical.ts";
import type { LoginMark } from "./login.ts";
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
  toolbox: { commit: string; dirty: boolean; lockfileSha256: string; version: string };
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
}

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", TOOLBOX_ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
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

export function toolchain(browserVersion: string | null): Omit<Manifest, "steps"> {
  const lockfile = join(TOOLBOX_ROOT, "package-lock.json");
  return {
    toolbox: {
      commit: git("rev-parse", "HEAD") ?? "no commit yet",
      // A dirty tree means the commit does not describe the code that ran.
      dirty: (git("status", "--porcelain", "--", ".") ?? "") !== "",
      lockfileSha256: existsSync(lockfile) ? sha256(readFileSync(lockfile)) : "no lockfile",
      version: (JSON.parse(readFileSync(join(TOOLBOX_ROOT, "package.json"), "utf8")) as { version: string }).version,
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
