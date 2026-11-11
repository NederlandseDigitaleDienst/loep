import { copyFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, writeFileAtomic, writeJson } from "../lib/canonical.ts";
import { evaluationHash, type Evaluation } from "../lib/evaluation.ts";
import { deriveReport, REPORT_TEXT } from "../lib/report-markdown.ts";
import { renderOutside } from "./render.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";
import { SIGNED_DIR } from "./verify.ts";

/** What a publication says about one round, next to its report: what the index of the site is made from. */
export interface Publication {
  schema: "loep/publication/1";
  site: string;
  baseUrl: string;
  evaluatedAt: string;
  evaluationSha256: string;
  sealSha256: string | null;
  signed: boolean;
  signedAt: string | null;
  /** The function and organisation of the signer, as the report prints them. Never the name. */
  signedBy: string | null;
  status: { "2.1": string; "2.2": string };
  files: string[];
}

export interface PublishResult {
  /** The directory of this round: `<out>/<site>/<date>/`. */
  round: string;
  /** The index of the site, with every round in `<out>/<site>/`. */
  index: string;
  publication: Publication;
  /** What the reader should know: a PDF that is not there, a concept that is not signed. */
  notesNl: string[];
}

export const PUBLICATION_FILE = "publicatie.json";

/** The name of the directory of a site: its host and path, in letters, digits and hyphens. */
export function siteSlug(baseUrl: string): string {
  const url = new URL(baseUrl);
  return [url.hostname, ...url.pathname.split("/").filter(Boolean)].join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The directory of a round under the site: the date of the evaluation. A second evaluation on the
 * same day gets `-2`, `-3`; the same evaluation published again goes to the directory it had.
 */
async function roundDir(siteDir: string, date: string, hash: string): Promise<string> {
  for (let n = 1; ; n++) {
    const dir = join(siteDir, n === 1 ? date : `${date}-${n}`);
    const file = join(dir, PUBLICATION_FILE);
    if (!existsSync(file) || (await readJson<Publication>(file)).evaluationSha256 === hash) return dir;
  }
}

/**
 * Put the report of a run in a directory for publication, in a fixed layout: `<out>/<site>/<date>/`
 * with the report as one HTML page, the PDFs when `render` made them, and `publicatie.json`; and
 * `<out>/<site>/index.html` with every round published there. Only what the report already shows goes
 * in: no manifest, no answers, no observations, no sessions. Nothing in the run changes. Where the
 * directory goes online is for the organisation to decide.
 */
export async function publish(runDir: string, out: string, options: { site?: string } = {}): Promise<PublishResult> {
  const evaluation = await readEvaluation(resolve(runDir, "evaluation.json"));
  const signed = signatureIsCurrent(evaluation);
  const hash = evaluationHash(evaluation);
  const site = options.site ?? siteSlug(evaluation.site.baseUrl);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(site)) throw new Error(`--site "${site}" mag alleen kleine letters, cijfers en streepjes bevatten`);
  const siteDir = resolve(out, site);
  const dir = await roundDir(siteDir, evaluation.evaluatedAt.slice(0, 10), hash);
  const notesNl: string[] = [];

  await writeFileAtomic(join(dir, "index.html"), await renderOutside(runDir, "standalone"));
  const files = ["index.html"];
  // The PDFs that render made for this state of the run: the signed ones after signing, the concept before.
  const source = join(runDir, signed ? SIGNED_DIR : "report");
  for (const pdf of ["rapport.pdf", "rapport-kort.pdf"]) {
    if (!existsSync(join(source, pdf))) continue;
    await copyFile(join(source, pdf), join(dir, pdf));
    files.push(pdf);
  }
  if (!files.includes("rapport.pdf")) notesNl.push(`er staat geen rapport.pdf in ${source}: draai render, en publiceer daarna opnieuw als de pdf erbij moet`);
  if (!signed) notesNl.push("het rapport is niet afgetekend: het staat er als concept");

  const derived = deriveReport(evaluation);
  const signature = signed ? evaluation.signature! : null;
  const publication: Publication = {
    schema: "loep/publication/1",
    site: evaluation.site.name,
    baseUrl: evaluation.site.baseUrl,
    evaluatedAt: evaluation.evaluatedAt,
    evaluationSha256: hash,
    sealSha256: signature?.sealSha256 ?? null,
    signed,
    signedAt: signature?.signedAt ?? null,
    signedBy: signature ? `${signature.role} (${signature.organisation})` : null,
    status: { "2.1": derived.status["2.1"].status, "2.2": derived.status["2.2"].status },
    files,
  };
  await writeJson(join(dir, PUBLICATION_FILE), publication);
  const index = join(siteDir, "index.html");
  await writeFileAtomic(index, siteIndex(evaluation, await roundsOf(siteDir)));
  return { round: dir, index, publication, notesNl };
}

/** Every round published under a site, newest first, with its directory name. */
async function roundsOf(siteDir: string): Promise<{ dir: string; publication: Publication }[]> {
  const rounds: { dir: string; publication: Publication }[] = [];
  for (const entry of await readdir(siteDir, { withFileTypes: true })) {
    const file = join(siteDir, entry.name, PUBLICATION_FILE);
    if (entry.isDirectory() && existsSync(file)) rounds.push({ dir: entry.name, publication: JSON.parse(await readFile(file, "utf8")) as Publication });
  }
  return rounds.sort((a, b) => b.publication.evaluatedAt.localeCompare(a.publication.evaluatedAt) || b.dir.localeCompare(a.dir));
}

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateNl = (iso: string): string => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });

const statusNl = (status: string): string => (status === "geen" ? "geen status" : `status ${status}`);

/** The index of a site: one row per round, the newest first. A plain page that needs nothing from elsewhere. */
export function siteIndex(evaluation: Pick<Evaluation, "site">, rounds: { dir: string; publication: Publication }[]): string {
  const name = escape(evaluation.site.name);
  const rows = rounds.map(({ dir, publication }) => {
    const links = [`<a href="${dir}/">Rapport</a>`, ...(publication.files.includes("rapport.pdf") ? [`<a href="${dir}/rapport.pdf">pdf</a>`] : []), ...(publication.files.includes("rapport-kort.pdf") ? [`<a href="${dir}/rapport-kort.pdf">korte pdf</a>`] : [])];
    const signedNl = publication.signed && publication.signedAt ? `Afgetekend door ${escape(publication.signedBy ?? "")} op ${dateNl(publication.signedAt)}` : REPORT_TEXT.concept;
    return `<tr><th scope="row">${dateNl(publication.evaluatedAt)}</th><td>WCAG 2.1: ${statusNl(publication.status["2.1"])}<br>WCAG 2.2: ${statusNl(publication.status["2.2"])}</td><td>${signedNl}</td><td><code>${publication.evaluationSha256.slice(0, 12)}</code></td><td>${links.join(" · ")}</td></tr>`;
  });
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Toegankelijkheidsrapporten van ${name}</title>
<style>
:root { color-scheme: light dark; --text: #1a1a1a; --muted: #555; --line: #ccc; --link: #154273; --page: #fff; }
@media (prefers-color-scheme: dark) { :root { --text: #eee; --muted: #bbb; --line: #555; --link: #9cc3ef; --page: #161616; } }
body { margin: 0; padding: 1.5rem 1rem; font: 1rem/1.5 system-ui, sans-serif; color: var(--text); background: var(--page); }
main { max-width: 60rem; margin: 0 auto; }
h1, p { overflow-wrap: anywhere; hyphens: auto; }
a { color: var(--link); }
p { color: var(--muted); }
.rounds { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: .5rem .75rem .5rem 0; border-bottom: 1px solid var(--line); }
thead th { font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>Toegankelijkheidsrapporten van ${name}</h1>
<p>Onderzoek van <a href="${escape(evaluation.site.baseUrl)}">${escape(evaluation.site.baseUrl)}</a> volgens WCAG 2.2 en 2.1, niveau A en AA. Het nieuwste onderzoek staat bovenaan.</p>
<div class="rounds" role="region" aria-label="Onderzoeken" tabindex="0">
<table>
<thead><tr><th scope="col">Onderzocht op</th><th scope="col">Uitkomst</th><th scope="col">Aftekening</th><th scope="col">Kenmerk</th><th scope="col">Bestanden</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</div>
</main>
</body>
</html>
`;
}
