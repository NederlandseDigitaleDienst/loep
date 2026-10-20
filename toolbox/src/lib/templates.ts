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

/**
 * What a task keeps for when it is needed: the explanation of every command and the skeleton of
 * the verdict. A template marks such a part with `<!-- naslag: <title> -->` and `<!-- /naslag -->`;
 * it goes to a reference file next to the task, and the task itself (the core) says where to find it.
 * The core is what an agent reads at the start, and so reads again with every turn.
 */
const NASLAG = /<!-- naslag: (.+?) -->\n([\s\S]*?)<!-- \/naslag -->/g;
const CUT = "\u0000";

export function splitNaslag(text: string): { core: string; naslag: string | null } {
  const parts: string[] = [];
  const core = text
    .replace(NASLAG, (_, title: string, body: string) => {
      parts.push(`## ${title}\n\n${body.trim()}\n`);
      return CUT;
    })
    .replace(new RegExp(`\\n*${CUT}\\n*`, "g"), "\n\n");
  return { core, naslag: parts.length > 0 ? parts.join("\n") : null };
}

/** The reference file of a task: next to it, with "-naslag" in its name. */
export const naslagOf = (prompt: string): string => prompt.replace(/\.md$/, "-naslag.md");
