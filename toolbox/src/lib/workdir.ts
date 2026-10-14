import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Where the agents of a run keep their own files: one folder per session. */
export const WORK_DIR = "werk";

/**
 * Make the folder of one session for its helper files and scripts, and return its absolute path.
 * Agents work side by side in one run. Two of them once wrote a helper script under the same
 * name in a shared folder, each with its own session in it; the second overwrote the first, and
 * one agent then measured under the other's session. Every task names this folder, so nothing
 * of one session lies where another agent writes. What is in it is sealed with the rest of the run.
 */
export async function makeWorkDir(runDir: string, session: string): Promise<string> {
  const dir = join(resolve(runDir), WORK_DIR, session);
  await mkdir(dir, { recursive: true });
  return dir;
}
