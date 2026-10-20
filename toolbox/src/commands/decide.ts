import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../lib/canonical.ts";
import { DECISION_KINDS, DECISION_LABEL_NL, DECISION_PRIVACY_NL, DECISION_WHAT_NL, DECISIONS_INDEX, decisionFile, readIndex, type Decision, type DecisionFile, type DecisionKind } from "../lib/decisions.ts";
import type { Defect } from "../lib/defects.ts";
import type { ReportFinding } from "../lib/evaluation.ts";
import type { RecordedVia } from "../lib/recorded.ts";
import { sortDefects } from "../lib/report-markdown.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";
import { sealHash } from "./verify.ts";

/*
 * What the organisation decides about each defect, recorded per defect. Without a decision the
 * command shows the defects, heaviest first, or one defect with what the report proposes. Who
 * decided and in what role is asked; nothing here is ever made up by an agent.
 */

const MIN_WHAT = 10;

export interface DecideOptions {
  run: string;
  defect?: string | undefined;
  decision?: string | undefined;
  what?: string | undefined;
  date?: string | undefined;
  alternative?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  recordedVia?: RecordedVia | undefined;
}

export interface DefectView {
  id: string;
  titleNl: string;
  severity: ReportFinding["severity"];
  owner: string;
  criteriaNl: string;
  pages: string[];
  /** What the report proposes, once per distinct text. */
  proposalsNl: string[];
  current: DecisionFile | null;
}

export interface DecideResult {
  /** Every defect of the evaluation, heaviest first; with --defect only that one. */
  defects: DefectView[];
  /** The file the decision was written to; null when nothing was recorded. */
  written: string | null;
  /** Defects without a decision after this one. */
  left: number;
}

const isDate = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

export async function decide(options: DecideOptions): Promise<DecideResult> {
  const evaluation = await readEvaluation(join(options.run, "evaluation.json"));
  if (!signatureIsCurrent(evaluation) || evaluation.signature!.sealSha256 !== (await sealHash(options.run))) {
    throw new Error("besluiten komen na het tekenen: het onderzoek is niet afgetekend, of het is na het tekenen veranderd. Laat eerst het rapport lezen en tekenen (sign)");
  }
  const defects = evaluation.defects;
  if (!defects || defects.length === 0) throw new Error("dit onderzoek heeft geen gebreken om over te besluiten");
  const findings = new Map(evaluation.criteria.flatMap((criterion) => criterion.findings).map((finding) => [finding.id, finding]));
  const read = async (id: string): Promise<DecisionFile | null> => (existsSync(join(options.run, decisionFile(id))) ? readJson<DecisionFile>(join(options.run, decisionFile(id))) : null);
  const view = async (defect: Defect): Promise<DefectView> => ({
    id: defect.id,
    titleNl: defect.titleNl,
    severity: defect.severity,
    owner: defect.owner,
    criteriaNl: [defect.mainCriterion, ...defect.alsoCriteria].join(", "),
    pages: defect.pages,
    proposalsNl: [...new Set(defect.findingIds.map((id) => findings.get(id)?.fixNl).filter((text): text is string => Boolean(text)))],
    current: await read(defect.id),
  });
  const all = await Promise.all(sortDefects(defects).map(view));
  const left = (views: DefectView[]): number => views.filter((entry) => entry.current === null).length;
  if (options.defect === undefined) {
    if (options.decision !== undefined) throw new Error("--decision hoort bij één gebrek: geef --defect <nummer>");
    return { defects: all, written: null, left: left(all) };
  }
  const defect = defects.find((entry) => entry.id === options.defect);
  if (!defect) throw new Error(`gebrek ${options.defect} staat niet in dit onderzoek (zonder --defect toont het commando de gebreken)`);
  const shown = all.find((entry) => entry.id === defect.id)!;
  if (options.decision === undefined) return { defects: [shown], written: null, left: left(all) };

  if (!(DECISION_KINDS as readonly string[]).includes(options.decision)) throw new Error(`--decision is een van: ${DECISION_KINDS.join(", ")}`);
  const kind = options.decision as DecisionKind;
  const what = (options.what ?? "").replace(/\s+/g, " ").trim();
  if (kind !== "onbesloten" && what.length < MIN_WHAT) throw new Error(`--what zegt ${DECISION_WHAT_NL[kind]}, in de woorden van wie besloot`);
  if (kind === "gepland" && options.date === undefined) throw new Error("bij gepland hoort een datum: --date jjjj-mm-dd, zoals de organisatie die noemt");
  if (options.date !== undefined && !(kind === "gepland" || kind === "opgelost")) throw new Error("--date hoort bij gepland (wanneer het klaar is) of opgelost (sinds wanneer)");
  if (options.date !== undefined && !isDate(options.date)) throw new Error(`--date is een datum als jjjj-mm-dd, niet "${options.date}"`);
  const alternative = (options.alternative ?? "").replace(/\s+/g, " ").trim();
  if (kind === "onevenredig" && alternative.length < MIN_WHAT) throw new Error("bij onevenredige last hoort het alternatief dat een bezoeker intussen heeft: --alternative");
  if (alternative && kind !== "onevenredig") throw new Error("--alternative hoort bij onevenredig");
  if (!options.name?.trim() || !options.role?.trim()) throw new Error(`--name en --role zeggen wie besloot en in welke functie: ${DECISION_PRIVACY_NL}`);

  const decision: Decision = {
    defect: { id: defect.id, titleNl: defect.titleNl, mainCriterion: defect.mainCriterion },
    decision: kind,
    whatNl: what || null,
    date: options.date ?? null,
    alternativeNl: alternative || null,
    name: options.name.trim(),
    role: options.role.trim(),
    decidedAt: new Date().toISOString(),
    ...(options.recordedVia ? { recordedVia: options.recordedVia } : {}),
    sealSha256: evaluation.signature!.sealSha256,
  };
  // A changed decision keeps the one before it.
  const earlier = shown.current;
  const file: DecisionFile = { ...decision, previous: earlier ? [(({ previous: _previous, ...rest }) => rest)(earlier), ...earlier.previous] : [] };
  const hash = await writeJson(join(options.run, decisionFile(defect.id)), file);
  const index = await readIndex(options.run);
  await writeJson(join(options.run, DECISIONS_INDEX), { files: { ...index, [`${defect.id}.json`]: hash } });
  shown.current = file;
  return { defects: [shown], written: decisionFile(defect.id), left: left(all) };
}

/** One line per defect for the listing: what it is and whether there is a decision. */
export function defectLineNl(view: DefectView): string {
  const decided = view.current ? `${DECISION_LABEL_NL[view.current.decision]}${view.current.date ? ` (${view.current.date})` : ""}` : "geen besluit";
  return `${view.id} [${view.severity}, ${view.owner}] ${view.titleNl} (${view.criteriaNl}): ${decided}`;
}
