import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR } from "./procedures.ts";

/**
 * Parts of a task that hold for more than one role, written once. A part may hold a later one:
 * the tools hold the rules for the work folder, so those come last.
 */
const INCLUDES: [key: string, file: string][] = [
  ["tools", "gereedschap.md"],
  ["findingRules", "bevinding.md"],
  ["workRules", "werkmap.md"],
];

/**
 * The template of a task with its shared parts inserted, before any placeholder is filled, so
 * the hash of a template covers them.
 */
export function readTemplate(name: string): string {
  return INCLUDES.reduce(
    (text, [key, file]) => text.replaceAll(`{{${key}}}`, () => readFileSync(join(TEMPLATES_DIR, file), "utf8").trim()),
    readFileSync(join(TEMPLATES_DIR, `${name}.md`), "utf8"),
  );
}
