import { homedir } from "node:os";
import { join } from "node:path";
import { addSite, readBacklog } from "./backlog.ts";

/*
 * The measurement before a release: loep on its own test sites, one with built-in defects and one that
 * should stay clean. Those are runs like any other, so they go through the regie and the skill, and a
 * person reads the reports that come out. What loep adds is a backlog of their own: a real owner's site
 * and a test site in one file would end up in one `loep run`, and the fixtures would turn up in the
 * overview of the sites under audit.
 *
 * The testsite has to be running. loep checks that before an agent starts: a regie of hours against a
 * server nobody started fails on its first page and reads like a broken site.
 */

export interface Fixture {
  slug: string;
  url: string;
  name: string;
  /** What this site is for the measurement, in the words of the backlog and of the report. */
  noteNl: string;
}

export const FIXTURES: Fixture[] = [
  { slug: "lindewaard", url: "http://127.0.0.1:4710/", name: "Lindewaard", noteNl: "de testsite met de ingebouwde gebreken; de meting telt hoeveel ervan in het dossier staan" },
  { slug: "berkenveen", url: "http://127.0.0.1:4711/", name: "Berkenveen", noteNl: "de schone tweeling; deze hoort geen bevinding te krijgen" },
];

/** Where a meting keeps its backlog, runs and state: never next to the sites of real owners. */
export function metingHome(): string {
  return process.env["LOEP_HOME"] ?? join(homedir(), "onderzoeken", "meting");
}

/** Whether the testsite answers, so that no agent starts against a server nobody started. */
export async function answering(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** The fixtures that do not answer, in the order of the list. */
export async function silent(fixtures: Fixture[] = FIXTURES): Promise<Fixture[]> {
  const silence: Fixture[] = [];
  for (const fixture of fixtures) if (!(await answering(fixture.url))) silence.push(fixture);
  return silence;
}

/** Put the fixtures in the backlog of a meting; one that is already there keeps its settings. */
export function prepareBacklog(path: string): { added: Fixture[] } {
  const known = new Set(readBacklog(path).sites.map((site) => site.slug));
  const added: Fixture[] = [];
  for (const fixture of FIXTURES) {
    if (known.has(fixture.slug)) continue;
    addSite(path, {
      url: fixture.url,
      slug: fixture.slug,
      name: fixture.name,
      organisation: "Testsite",
      purpose: "verbeteren",
      sending: { allow: false, max: null },
      alsoOrigins: [],
      neverOpen: [],
      login: null,
      atOnce: 2,
      mailbox: null,
      vendorTags: [],
      note: fixture.noteNl,
    });
    added.push(fixture);
  }
  return { added };
}
