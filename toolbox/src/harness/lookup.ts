import type { Site } from "./backlog.ts";
import { readBacklog } from "./backlog.ts";
import { backlogPath } from "./paths.ts";
import { statePath } from "./runner.ts";
import { readState, siteState } from "./state.ts";

/*
 * A site of the backlog, read from the command line of a step: `loep audit answer voorbeeld.nl` does
 * what `loep audit answer --run <run>` does, with the run of that site at this moment. The step itself
 * keeps taking a run; only the person who types the line is spared the lookup. A word that names no
 * site of the backlog is left alone, so `--run <run>` and the other positionals stay what they were.
 *
 * The run can be null: a site that is in the backlog and has not begun. Whoever asks decides what that
 * means; the human steps of the backlog say it, with the command that begins a run.
 */

export interface SiteOnTheLine {
  site: Site;
  run: string | null;
}

export function siteForWord(word: string): SiteOnTheLine | null {
  const sites = sitesOfBacklog();
  const site = sites.find((entry) => entry.slug === word) ?? sites.find((entry) => entry.url === word || hostOf(entry.url) === word);
  if (!site) return null;
  return { site, run: siteState(readState(statePath()), site.slug).run };
}

/**
 * A backlog that does not read is a problem of the backlog, not of the step: `loep doctor` names it with
 * the line it is on. Swallowed here, so one typo in a file a person edits by hand leaves `inventory` and
 * the other steps of every site alone, and a word that names no site stays what it was.
 */
function sitesOfBacklog(): Site[] {
  try {
    return readBacklog(backlogPath()).sites;
  } catch {
    return [];
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
