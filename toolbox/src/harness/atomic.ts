import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Write a file so that a crash leaves either the old one or the new one, never half of it. */
export function writeAtomic(path: string, content: string, mode: number = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, path);
}
