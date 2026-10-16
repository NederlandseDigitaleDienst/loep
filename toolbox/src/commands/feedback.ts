import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { madeWith, openCriteria, type CriterionResult, type Evaluation } from "../lib/evaluation.ts";
import { siteOrigins } from "../lib/origins.ts";
import { SHOWN_LABEL, shownOutcome } from "../lib/report-markdown.ts";
import { NOT_SENT, OPEN_POINT_KINDS, openPoint } from "../lib/verdict.ts";
import { compareCriterionIds } from "../lib/wcag.ts";

/*
 * What a finished run has to tell the makers of loep. A criterion that stayed open because of
 * loep itself (the sweep did not measure something, a probe stopped, a budget ran out, no verdict
 * came) is a fault in loep and not an outcome for the site. This writes one draft issue per
 * criterion and kind, with a title that stays the same from run to run, so whoever sends it can
 * first look whether the issue is already there. It sends nothing: an issue is public, and the
 * person who ran the evaluation decides what leaves the machine. The address, the name and the
 * organisation of the site are left out; the points themselves are written by an agent and are
 * shown to be read. A point "versturen niet toegestaan" gets no draft: the run measured all it
 * was allowed to, and whether it may send is the owner's choice. Those criteria are named apart.
 */

export const REPOSITORY = "NederlandseDigitaleDienst/loep";
/** The start of every title, so the issues of this command can be found together. */
export const TITLE_PREFIX = "Open door loep:";
/** A criterion without a verdict: the judge, the verifier or the finishing round was skipped. */
const UNTESTED = "niet beoordeeld";
/** A criterion that is open with no point at all, or with a point from before the kinds existed. */
const NO_KIND = "zonder soort";

export interface Draft {
  criterion: string;
  kind: string;
  title: string;
  labels: string[];
  bodyMd: string;
  /** Where the body was written with --out; null without. */
  file: string | null;
}

export interface Feedback {
  run: string;
  repository: string;
  madeWithNl: string;
  drafts: Draft[];
  /**
   * Open criteria with a point "versturen niet toegestaan": the run was not allowed to send.
   * That is a choice of the owner and no fault of loep, so it gets no draft; it is named so the
   * person who runs this knows one declaration at inventory would have closed them.
   */
  notSent: string[];
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A function that takes out of a text what says which site it is: every address, the host, the name and the organisation. */
export function redactor(site: Evaluation["site"]): (text: string) => string {
  // Every host of the site: a site on more than one origin is named by each of them.
  const hosts = siteOrigins(site).map((origin) => new URL(origin).hostname);
  const replacements: [RegExp, string][] = [[/\bhttps?:\/\/[^\s)>\]"']+/gi, "<adres>"]];
  // The longer names first, so docs.example.nl goes as a whole before example.nl.
  const hostNames = [...new Set(hosts.flatMap((host) => [host, host.replace(/^www\./, "")]))].sort((a, b) => b.length - a.length);
  for (const name of hostNames) replacements.push([new RegExp(escape(name), "gi"), "<site>"]);
  // The longer of the two first: a name that holds the organisation ("Gemeente Voorbeeldstad") goes as a whole.
  const names = [
    { text: site.name.trim(), by: "<site>" },
    { text: site.organisation?.trim() ?? "", by: "<organisatie>" },
  ].filter((name) => name.text.length >= 3);
  for (const name of names.sort((a, b) => b.text.length - a.text.length)) replacements.push([new RegExp(escape(name.text), "gi"), name.by]);
  return (text) => replacements.reduce((result, [pattern, by]) => result.replace(pattern, by), text);
}

/** The points of one criterion that are about loep and not about the site, per kind. */
function ownPointsByKind(criterion: CriterionResult): Map<string, string[]> {
  const byKind = new Map<string, string[]>();
  if (criterion.outcome === "untested") byKind.set(UNTESTED, []);
  for (const point of criterion.missingNl) {
    const parsed = openPoint(point);
    if (parsed.kind?.reader === "owner") continue;
    const kind = criterion.outcome === "untested" ? UNTESTED : (parsed.kind?.prefix ?? NO_KIND);
    byKind.set(kind, [...(byKind.get(kind) ?? []), parsed.textNl]);
  }
  if (byKind.size === 0) byKind.set(NO_KIND, []);
  return byKind;
}

const KIND_LABEL_NL: Record<string, string> = {
  ...Object.fromEntries(OPEN_POINT_KINDS.map((kind) => [kind.prefix, kind.labelNl])),
  [UNTESTED]: "er kwam geen oordeel, ook niet na twee pogingen",
  [NO_KIND]: "open zonder punt met een soort",
};

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function feedback(runDir: string, options: { out?: string | undefined } = {}): Feedback {
  const path = join(runDir, "evaluation.json");
  if (!existsSync(path)) throw new Error(`${runDir} heeft geen evaluation.json: draai eerst evaluate, dan is bekend welke criteria open zijn door loep zelf`);
  const evaluation = JSON.parse(readFileSync(path, "utf8")) as Evaluation;
  const redact = redactor(evaluation.site);
  const own = new Set(openCriteria(evaluation.criteria).evaluation);
  const drafts: Draft[] = [];
  for (const criterion of evaluation.criteria.filter((entry) => own.has(entry.id))) {
    for (const [kind, points] of ownPointsByKind(criterion)) {
      const lines = [
        `Een onderzoek met loep liet dit criterium open door loep zelf, niet door de site. Gemaakt met \`loep feedback\`; het adres, de naam en de organisatie van de site zijn weggelaten.`,
        "",
        `- Criterium: ${criterion.id} ${criterion.titleNl}, niveau ${criterion.level}, WCAG ${criterion.versions.join(" en ")}`,
        `- Soort: ${kind} (${KIND_LABEL_NL[kind] ?? kind})`,
        `- Uitkomst: ${SHOWN_LABEL[shownOutcome(criterion)]}`,
        `- Afmaakronde: ${criterion.rounds.finish ? "gehad" : "niet gehad"}`,
        `- Procedure: ${criterion.procedure ? `versie ${criterion.procedure.version}` : "geen"}`,
        `- ${madeWith(evaluation, true)}`,
      ];
      if (points.length > 0) lines.push("", "## Wat open bleef", "", ...points.map((point) => `- ${redact(point)}`));
      const draft: Draft = { criterion: criterion.id, kind, title: `${TITLE_PREFIX} ${criterion.id} ${kind}`, labels: ["bug"], bodyMd: `${lines.join("\n")}\n`, file: null };
      if (options.out) {
        mkdirSync(options.out, { recursive: true });
        draft.file = join(options.out, `${criterion.id}-${slug(kind)}.md`);
        writeFileSync(draft.file, draft.bodyMd);
      }
      drafts.push(draft);
    }
  }
  const open = openCriteria(evaluation.criteria);
  const notSent = [...open.owner, ...open.evaluation].filter((id) => evaluation.criteria.find((criterion) => criterion.id === id)!.missingNl.some((point) => openPoint(point).kind?.prefix === NOT_SENT)).sort(compareCriterionIds);
  return { run: basename(resolve(runDir)), repository: REPOSITORY, madeWithNl: madeWith(evaluation, true), drafts, notSent };
}

/** The drafts as a text to read: what to check first, then per draft the title and the body or where it is. */
export function feedbackTextNl(result: Feedback): string {
  // Not sending is the owner's choice: said once, so nobody takes it for a fault of loep or for work for a person.
  const notSent =
    result.notSent.length > 0
      ? `\nNiet terug te melden: ${result.notSent.length === 1 ? "criterium" : "criteria"} ${result.notSent.join(", ")} ${result.notSent.length === 1 ? "bleef" : "bleven"} ook open omdat het onderzoek niet mocht versturen. Dat is een keuze van de eigenaar van de site, geen fout in loep. Een testomgeving, verklaard bij inventory met --test-environment, laat een instrument het meten; LOEP gaps telt deze punten onder "${NOT_SENT}".\n`
      : "";
  if (result.drafts.length === 0) return `Niets terug te melden uit ${result.run}: geen criterium is open door loep zelf.\n${notSent}`;
  const criteria = new Set(result.drafts.map((draft) => draft.criterion)).size;
  const lines = [
    `Terug te melden aan ${result.repository} uit ${result.run} (${result.madeWithNl}): ${result.drafts.length} ${result.drafts.length === 1 ? "melding" : "meldingen"} bij ${criteria} ${criteria === 1 ? "criterium" : "criteria"}.`,
    "Een issue is openbaar. Het adres, de naam en de organisatie van de site zijn weggelaten, maar de punten zijn door een agent geschreven: lees ze voordat er iets wordt verstuurd.",
  ];
  for (const draft of result.drafts) lines.push("", `### ${draft.title}`, draft.file ? `Tekst: ${draft.file}` : `\n${draft.bodyMd.trimEnd()}`);
  return `${lines.join("\n")}\n${notSent}`;
}

export function feedbackOutput(runDir: string, options: { out?: string | undefined; json?: boolean | undefined } = {}): string {
  const result = feedback(runDir, { out: options.out });
  return options.json ? `${JSON.stringify(result, null, 2)}\n` : feedbackTextNl(result);
}
