import { readBacklog } from "./backlog.ts";
import { backlogPath } from "./paths.ts";
import { statePath } from "./runner.ts";
import { readState, siteState } from "./state.ts";

/*
 * A site of the backlog, read from the command line of a step: `loep audit answer voorbeeld.nl` does
 * what `loep audit answer --run <run>` does, with the run of that site at this moment. The step itself
 * keeps taking a run; only the person who types the line is spared the lookup. A word that names no
 * site of the backlog is left alone, so `--run <run>` and the other positionals stay what they were.
 */
export function runForSite(word: string): string | null {
  const sites = readBacklog(backlogPath()).sites;
  const site = sites.find((entry) => entry.slug === word) ?? sites.find((entry) => entry.url === word || hostOf(entry.url) === word);
  if (!site) return null;
  return siteState(readState(statePath()), site.slug).run;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
