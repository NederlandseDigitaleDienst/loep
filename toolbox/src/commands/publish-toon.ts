import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { readJson } from "../lib/canonical.ts";
import { PUBLICATION_FILE, ROUNDS_FILE, roundsOf, writeSiteIndex, type Publication, type Rounds, type SiteOf } from "./publish.ts";

/** Runs the Toon CLI with these arguments and gives what it printed. */
export type ToonRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

const run = promisify(execFile);
export const runToon: ToonRunner = (args) => run("toon", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

export interface ToonTarget {
  /** `group/site`, as in the admin environment of Toon. */
  site: string;
  /** The admin origin, such as `https://beheer.toon.example.nl`. Without it, the host the user last logged in to. */
  host?: string;
  /** The address where the site is served, when it is not the admin origin without `beheer.`. */
  siteUrl?: string;
  /** Replace what visitors see. Without it, a preview on a path of its own. */
  live?: boolean;
  /** The name of the preview. */
  preview?: string;
  /** The user says that what is on a site loep cannot see (empty, or shielded) may be replaced. */
  replaceUnseen?: boolean;
}

export interface ToonResult {
  url: string;
  live: boolean;
  /** Rounds that were on the site and not in the directory, fetched before the site was replaced. */
  fetched: string[];
  notesNl: string[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

/** `toon` is also the name of another program: make sure this one is the CLI of Toon. */
async function checkToon(toon: ToonRunner): Promise<void> {
  const version = (await toon(["--version"])).stdout.trim();
  if (!version.startsWith("toon-cli")) throw new Error(`"toon" is hier niet de cli van Toon (het antwoordt "${version}"); installeer die met: uv tool install "git+https://github.com/DigiGilde/toon@beta#subdirectory=cli"`);
}

/** The admin origin from `toon whoami`, when the target names none. */
async function loggedInHost(toon: ToonRunner): Promise<string> {
  const { stdout, stderr } = await toon(["whoami"]).catch(() => ({ stdout: "", stderr: "" }));
  const host = /\bon (https?:\/\/\S+?)\s/.exec(`${stdout}${stderr} `)?.[1];
  if (!host) throw new Error("er is geen sessie bij Toon: log eerst zelf in met toon login --host <beheeradres>");
  return host.replace(/\/$/, "");
}

/** Where visitors find a site: the admin origin without `beheer.`, then the path of the site. */
export function siteAddress(host: string, site: string, preview?: string): string {
  const admin = new URL(host);
  if (!admin.hostname.startsWith("beheer.")) throw new Error(`uit ${host} is niet af te leiden waar de site staat; geef het adres met --toon-url`);
  return `${admin.protocol}//${admin.host.slice("beheer.".length)}/${site}/${preview ? `_preview/${preview}/` : ""}`;
}

/**
 * Compare the directory of a site with what the site shows now. Rounds that are online and not here are fetched, so the
 * new version keeps them. A site that shows something loep did not publish is never replaced; a site loep cannot see
 * (empty, or shielded) only when the user says so.
 */
async function reconcile(siteDir: string, url: string, live: boolean, replaceUnseen: boolean, fetcher: typeof fetch): Promise<{ fetched: string[]; notesNl: string[] }> {
  const notesNl: string[] = [];
  const list = await fetcher(new URL(ROUNDS_FILE, url), { redirect: "follow" });
  if (!list.ok) {
    if (list.status !== 404 && list.status !== 401 && list.status !== 403) throw new Error(`${url} gaf ${list.status} op ${ROUNDS_FILE}: probeer het later opnieuw`);
    const page = await fetcher(url, { redirect: "follow" });
    if (page.ok) {
      const foreign = `op ${url} staat iets wat niet met loep publish is gezet; dat zou verdwijnen. Kies een eigen site voor de rapporten`;
      if (live) throw new Error(foreign);
      notesNl.push(foreign);
    } else if (live && !replaceUnseen) {
      throw new Error(`loep ziet niets op ${url} (${page.status}): de site is leeg, of afgeschermd. Wat er staat, wordt vervangen. Staat er niets op wat moet blijven, geef dan --replace-unseen mee`);
    }
    return { fetched: [], notesNl };
  }
  const online = (await list.json()) as Rounds;
  if (online.schema !== "loep/rounds/1" || !Array.isArray(online.rounds)) throw new Error(`${new URL(ROUNDS_FILE, url)} is geen lijst van ronden van loep`);
  const here = new Map((await roundsOf(siteDir)).map(({ dir, publication }) => [dir, publication.evaluationSha256]));
  const fetched: string[] = [];
  for (const round of online.rounds) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$/.test(round.dir)) throw new Error(`${ROUNDS_FILE} op ${url} noemt een ronde "${round.dir}" die geen datum is`);
    const mine = here.get(round.dir);
    if (mine === round.evaluationSha256) continue;
    if (mine) throw new Error(`ronde ${round.dir} op ${url} is een ander onderzoek dan ronde ${round.dir} in ${siteDir}: zet ze niet over elkaar heen`);
    for (const file of [PUBLICATION_FILE, ...round.files.filter((name) => /^[a-z0-9-]+\.(html|pdf)$/.test(name))]) {
      const response = await fetcher(new URL(`${round.dir}/${file}`, url));
      if (!response.ok) throw new Error(`${round.dir}/${file} op ${url} gaf ${response.status}: zonder die ronde wordt de site niet vervangen`);
      await mkdir(join(siteDir, round.dir), { recursive: true });
      await writeFile(join(siteDir, round.dir, file), Buffer.from(await response.arrayBuffer()));
    }
    const publication = await readJson<Publication>(join(siteDir, round.dir, PUBLICATION_FILE));
    if (publication.evaluationSha256 !== round.evaluationSha256) throw new Error(`${round.dir}/${PUBLICATION_FILE} op ${url} hoort niet bij de lijst van ronden`);
    fetched.push(round.dir);
  }
  return { fetched, notesNl };
}

/**
 * Put the directory of a site on Toon: as a preview, or live when asked. The directory becomes the whole site, so
 * whatever was there goes; rounds published there before are fetched first and stay.
 */
export async function publishToToon(siteDir: string, site: SiteOf["site"], target: ToonTarget, toon: ToonRunner = runToon, fetcher: typeof fetch = fetch): Promise<ToonResult> {
  if (!SLUG.test(target.site)) throw new Error(`--toon "${target.site}" is geen groep/site, zoals team/rapporten`);
  if (!existsSync(join(siteDir, "index.html"))) throw new Error(`${siteDir} heeft geen index.html`);
  const live = target.live === true;
  if (live && target.preview) throw new Error("--live en --preview gaan niet samen: live vervangt de site, een preview staat ernaast");
  const preview = live ? undefined : (target.preview ?? `loep-${(await roundsOf(siteDir))[0]?.dir ?? "concept"}`);
  if (preview && !/^[a-z0-9][a-z0-9-]*$/.test(preview)) throw new Error(`--preview "${preview}" mag alleen kleine letters, cijfers en streepjes bevatten`);
  await checkToon(toon);
  const host = (target.host ?? (await loggedInHost(toon))).replace(/\/$/, "");
  const liveUrl = target.siteUrl ? target.siteUrl.replace(/\/?$/, "/") : siteAddress(host, target.site);
  const { fetched, notesNl } = await reconcile(siteDir, liveUrl, live, target.replaceUnseen === true, fetcher);
  if (fetched.length > 0) await writeSiteIndex(siteDir, { site });
  await toon(["publish", siteDir, "--host", host, "--site", target.site, ...(preview ? ["--preview", preview] : [])]);
  const url = preview ? `${liveUrl}_preview/${preview}/` : liveUrl;
  if (preview) notesNl.push(`dit is een preview; wat bezoekers zien op ${liveUrl} is niet veranderd. Live: hetzelfde commando met --live`);
  return { url, live, fetched, notesNl };
}
