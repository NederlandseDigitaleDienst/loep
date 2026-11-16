/**
 * The summary for whoever leads the organisation: a few paragraphs at the top of the report, written
 * by a language model that read the report, and held to the report by this check. It is text for a
 * reader and no verdict: it adds no finding and takes none away. A summary that does not pass is
 * not in the report, which then opens as it did before there was one.
 */
import { complianceStatus, type Evaluation } from "./evaluation.ts";

/** What the agent hands in. */
export interface SummaryProposal {
  /** The paragraphs of the summary, each with what in the report it rests on. */
  paragraphs: { textNl: string; sources: string[] }[];
  /** The model that wrote it, as the writer gives it. */
  model?: string;
}

/** Why a summary that is there is not in the report. */
export type SummaryStaleReason = "unchecked" | "report" | "task";

/** What the evaluation says about the summary: in the report, or there and not used. */
export type SummaryRecord =
  | { status: "applied"; paragraphs: string[]; sources: string[][]; model?: string; templateSha256: string; proposalSha256: string }
  | { status: "stale"; reason: SummaryStaleReason };

export const SUMMARY_WORDS_MAX = 150;
export const SUMMARY_PARAGRAPHS_MIN = 2;
export const SUMMARY_PARAGRAPHS_MAX = 4;

/** Parts of the report a paragraph can rest on besides a defect or a criterion. */
export const SUMMARY_PARTS = {
  status: "de status en de aantallen criteria",
  vastlopen: "wie bij welke kerntaak vastloopt",
  groepen: "de gebreken per groep bezoekers en per kerntaak",
  "wat-nu": "de werklijst en wat nog uit te zoeken is",
  open: "wat het onderzoek niet heeft vastgesteld",
  beperkingen: "de beperkingen van het onderzoek",
} as const;

/** Words that make a failure sound smaller than the report says, or that speak for every visitor at once. */
const SOFTENING = [
  "over het algemeen", "in het algemeen", "grotendeels", "in grote lijnen", "goed toegankelijk", "redelijk toegankelijk", "formeel", "formele", "technisch gezien",
  "niemand", "geen last", "weinig last", "slechts", "alleen maar", "klein gebrek", "kleine gebreken", "kleinigheid", "cosmetisch", "nagenoeg", "vrijwel geheel", "bijna geheel",
];
/** Words of how the evaluation was made: the reader of the summary does not know them. */
const PROCESS = ["veegronde", "afmaakronde", "rondgang", "beoordelaar", "verifieerder", "afmaker", "verkenner", "agent", "taalmodel", "de run", "bewijspoort", "dossier", "sessie"];
/**
 * Words about whether the report is signed. The summary is written before anyone signs and stands
 * in the signed report unchanged; the status next to it says whether it is provisional.
 */
const SIGNING = ["voorlopig", "concept", "afgetekend", "aftekent", "aftekenen", "aftekening", "ondertekend", "ondertekening"];

const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
const hasPhrase = (text: string, phrase: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

/** The numbers in a text as someone reads them: "1.400" and "1400" are the same, a year or a percentage too. */
const numbersOf = (text: string): string[] => (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((number) => number.replace(/[.,](?=\d{3}(?:\D|$))/g, ""));

/** The status letters the evaluation leads to, one per version of WCAG; the same letter twice is one. */
export function summaryStatuses(evaluation: Evaluation): string[] {
  const signed: Evaluation = evaluation.signature === null ? { ...evaluation, signature: { name: "", role: "", organisation: "", signedAt: evaluation.evaluatedAt, statementNl: "", evaluationSha256: "", sealSha256: "" } } : evaluation;
  return [...new Set([complianceStatus(signed, "2.1").status, complianceStatus(signed, "2.2").status])];
}

/**
 * Hold a summary to the report it was written from. `reportText` is the text the agent read;
 * `stoppingDefects` are the defects by which a group is stopped at a core task, as the report names them.
 * Every problem is one line in Dutch that says what is wrong and what to do.
 */
export function validateSummary(proposal: unknown, evaluation: Evaluation, reportText: string, stoppingDefects: readonly string[] = []): string[] {
  const problems: string[] = [];
  const paragraphs = (proposal as SummaryProposal | null)?.paragraphs;
  if (!Array.isArray(paragraphs)) return ['het antwoord heeft geen lijst "paragraphs"'];
  if (paragraphs.length < SUMMARY_PARAGRAPHS_MIN || paragraphs.length > SUMMARY_PARAGRAPHS_MAX) problems.push(`de samenvatting heeft ${paragraphs.length} alinea's; het zijn er ${SUMMARY_PARAGRAPHS_MIN} tot ${SUMMARY_PARAGRAPHS_MAX}`);
  const defects = new Set((evaluation.defects ?? []).map((defect) => defect.id));
  const criteria = new Set(evaluation.criteria.map((criterion) => criterion.id));
  const known = new Set(numbersOf(reportText));
  const used = new Set<string>();
  let words = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    const where = `alinea ${index + 1}`;
    const text = typeof paragraph?.textNl === "string" ? paragraph.textNl.trim() : "";
    if (text === "") {
      problems.push(`${where}: geen tekst in textNl`);
      continue;
    }
    words += wordsOf(text).length;
    if (/[\n\r]/.test(text)) problems.push(`${where}: een alinea is één stuk tekst, zonder regeleinde`);
    if (/[—–]/.test(text)) problems.push(`${where}: gebruik geen gedachtestreepje; maak er twee zinnen van of gebruik een komma`);
    if (/[*#|`_<>[\]]|^\s*[-•]\s/.test(text)) problems.push(`${where}: schrijf lopende tekst, zonder opmaak, lijsttekens of code`);
    if (/[()]/.test(text)) problems.push(`${where}: schrijf zonder haakjes; wat erbij hoort, staat in de zin`);
    if (/https?:\/\/|www\./i.test(text)) problems.push(`${where}: noem geen adres; het rapport noemt de pagina's`);
    const criterion = /\b[1-4]\.\d\.\d{1,2}\b/.exec(text);
    if (criterion) problems.push(`${where}: noem een criterium in woorden, niet met het nummer ${criterion[0]}`);
    for (const phrase of SOFTENING) if (hasPhrase(text, phrase)) problems.push(`${where}: "${phrase}" maakt kleiner wat het rapport zegt, of spreekt voor alle bezoekers; zeg voor welke groep wat geldt`);
    for (const phrase of PROCESS) if (hasPhrase(text, phrase)) problems.push(`${where}: "${phrase}" is een woord van het onderzoek zelf; de lezer kent het niet`);
    for (const phrase of SIGNING) if (hasPhrase(text, phrase)) problems.push(`${where}: "${phrase}" gaat over het tekenen van het rapport; dat staat bij de status en verandert nog, de samenvatting niet`);
    for (const number of numbersOf(text)) if (!known.has(number)) problems.push(`${where}: het getal ${number} staat niet in het rapport; neem getallen letterlijk over en reken niets uit`);
    const sources = Array.isArray(paragraph.sources) ? paragraph.sources.filter((source): source is string => typeof source === "string") : [];
    if (sources.length === 0) problems.push(`${where}: sources is leeg; noem waar in het rapport de alinea op rust`);
    for (const source of sources) {
      if (!defects.has(source) && !criteria.has(source) && !(source in SUMMARY_PARTS)) problems.push(`${where}: "${source}" in sources is geen gebrek of criterium van dit rapport en geen van ${Object.keys(SUMMARY_PARTS).join(", ")}`);
      used.add(source);
    }
  }
  if (words > SUMMARY_WORDS_MAX) problems.push(`de samenvatting heeft ${words} woorden; het zijn er hooguit ${SUMMARY_WORDS_MAX}`);

  const all = paragraphs.map((paragraph) => (typeof paragraph?.textNl === "string" ? paragraph.textNl : "")).join(" ");
  // The status is the one loep computed, by its letter; another letter is another claim.
  const statuses = summaryStatuses(evaluation).filter((status) => status !== "geen");
  const named = [...all.matchAll(/\bstatus\s+([A-D])\b/g)].map((match) => match[1]!);
  for (const letter of named) if (!statuses.includes(letter)) problems.push(`de samenvatting noemt status ${letter}; het rapport komt uit op ${statuses.length > 0 ? `status ${statuses.join(" en ")}` : "geen status"}`);
  for (const status of statuses) if (!named.includes(status)) problems.push(`de samenvatting noemt status ${status} niet; zeg welke status uit het rapport volgt`);
  if (!used.has("status")) problems.push('geen alinea rust op "status": de samenvatting zegt of de site voldoet en hoeveel criteria niet zijn gehaald');
  // Whether the site meets the norm is said as the evaluation has it, never rounder.
  const failed = evaluation.criteria.some((criterion) => criterion.outcome === "failed");
  const open = evaluation.criteria.some((criterion) => criterion.outcome === "cantTell" || criterion.outcome === "untested");
  if (failed && !/voldoet niet/i.test(all)) problems.push('het rapport keurt criteria af; de samenvatting zegt met de woorden "voldoet niet" dat de site niet voldoet');
  if ((failed || open) && /voldoet (?:volledig |geheel |helemaal |wel )?aan/i.test(all)) problems.push('de samenvatting zegt dat de site voldoet, en dat draagt het rapport niet');
  // An open criterion stays open: the summary says what was not established.
  if (open && !used.has("open")) problems.push('het rapport heeft open criteria; een alinea zegt wat niet is vastgesteld, met "open" in sources');
  // A group that is stopped at a core task is the first thing a reader must hear.
  const stopping = new Set(stoppingDefects);
  if (stopping.size > 0 && ![...used].some((source) => stopping.has(source))) problems.push(`een groep bezoekers loopt vast bij een kerntaak; een alinea noemt dat, met in sources het gebrek waardoor (${[...stopping].slice(0, 4).join(", ")})`);
  return problems;
}

export function clearSummary(evaluation: Evaluation): void {
  delete evaluation.executiveSummary;
}
