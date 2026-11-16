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
  /** The report the writer read, by the hash the task gave: a summary is held only to the report it was written from. */
  reportSha256?: string;
}

/** Why a summary that is there is not in the report. */
/** "unread": no second reader held it to the report yet; "refuted": the second reader found a sentence the report does not carry. */
export type SummaryStaleReason = "unchecked" | "report" | "task" | "unread" | "refuted";

/** What the second reader hands in: for each sentence of the summary where the report says it, or that it does not. */
export interface SummaryReading {
  reportSha256?: string;
  proposalSha256?: string;
  model?: string;
  sentences: { n: number; verdict: "gedragen" | "niet-gedragen"; quotes?: string[]; noteNl?: string }[];
}

/** What the evaluation says about the summary: in the report, or there and not used. */
export type SummaryRecord =
  | { status: "applied"; paragraphs: string[]; sources: string[][]; model?: string; readerModel?: string; templateSha256: string; proposalSha256: string; readingSha256: string }
  | { status: "stale"; reason: SummaryStaleReason };

export const SUMMARY_WORDS_MAX = 220;
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
  "gering", "geringe", "nauwelijks", "ruimschoots", "de meeste bezoekers", "bijna alle", "bijna iedereen", "prima", "zonder moeite", "eenvoudig te herstellen", "weinig van", "enkele details", "valt mee", "meevalt",
];
/** Words of how the evaluation was made: the reader of the summary does not know them. */
const PROCESS = ["veegronde", "afmaakronde", "rondgang", "beoordelaar", "verifieerder", "afmaker", "verkenner", "agent", "taalmodel", "de run", "bewijspoort", "dossier", "sessie"];
/**
 * Words about whether the report is signed. The summary is written before anyone signs and stands
 * in the signed report unchanged; the status next to it says whether it is provisional.
 */
const SIGNING = ["voorlopig", "concept", "afgetekend", "aftekent", "aftekenen", "aftekening", "ondertekend", "ondertekening"];

/** A paragraph that tells of a defect says who it hinders: a group as the report names it ("mensen die niet zien"), or "wie" with what they do. */
const PEOPLE = /(?<![\p{L}])(?:mensen|bezoekers|gebruikers|iedereen|wie)(?![\p{L}])/iu;
/** The norm by its name, version and level, as the report gives it: said once, so the reader knows against what the site was held. */
const NORM = /WCAG 2\.2\b[^.]*\bniveau A en AA\b/;

/** Numbers as words: a count the check cannot hold to the report. One that the report writes the same way, as "zes maanden", stays. */
const NUMBER_WORD = /(?<![\p{L}])(twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|twintig|dertig|veertig|vijftig|honderd|handvol|dozijn|tientallen|honderden|duizenden)(?:\s+([\p{L}]+))?/giu;

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?:])\s+/).filter(Boolean);

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
  const toldWithPeople = new Set<string>();
  const toldWithout = new Set<string>();
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
    for (const match of text.matchAll(NUMBER_WORD)) if (!reportText.toLowerCase().includes(match[0].toLowerCase())) problems.push(`${where}: "${match[0]}" is een aantal in letters dat zo niet in het rapport staat; schrijf het getal in cijfers, zoals het rapport`);
    for (const number of numbersOf(text)) if (!known.has(number)) problems.push(`${where}: het getal ${number} staat niet in het rapport; neem getallen letterlijk over en reken niets uit`);
    const sources = Array.isArray(paragraph.sources) ? paragraph.sources.filter((source): source is string => typeof source === "string") : [];
    if (sources.length === 0) problems.push(`${where}: sources is leeg; noem waar in het rapport de alinea op rust`);
    // A defect is told with who it hinders, once: where it is told, not again where the summary says what to repair first.
    for (const source of sources) if (defects.has(source)) (PEOPLE.test(text) ? toldWithPeople : toldWithout).add(source);
    for (const source of sources) {
      if (!defects.has(source) && !criteria.has(source) && !(source in SUMMARY_PARTS)) problems.push(`${where}: "${source}" in sources is geen gebrek of criterium van dit rapport en geen van ${Object.keys(SUMMARY_PARTS).join(", ")}`);
      used.add(source);
    }
  }
  const nobody = [...toldWithout].filter((id) => !toldWithPeople.has(id));
  if (nobody.length > 0) problems.push(`de samenvatting noemt bij ${nobody.length === 1 ? "het gebrek" : "de gebreken"} ${nobody.join(", ")} niet voor wie het geldt; zeg in een alinea die erop rust welke groep bezoekers het hindert, zoals het rapport dat doet`);
  if (words > SUMMARY_WORDS_MAX) problems.push(`de samenvatting heeft ${words} woorden; het zijn er hooguit ${SUMMARY_WORDS_MAX}`);

  const all = paragraphs.map((paragraph) => (typeof paragraph?.textNl === "string" ? paragraph.textNl : "")).join(" ");
  // The status is the one loep computed, by its letter; another letter is another claim.
  const statuses = summaryStatuses(evaluation).filter((status) => status !== "geen");
  const named = [...all.matchAll(/\bstatus\s+([A-D])\b/gi)].map((match) => match[1]!.toUpperCase());
  for (const letter of named) if (!statuses.includes(letter)) problems.push(`de samenvatting noemt status ${letter}; het rapport komt uit op ${statuses.length > 0 ? `status ${statuses.join(" en ")}` : "geen status"}`);
  for (const status of statuses) if (!named.includes(status)) problems.push(`de samenvatting noemt status ${status} niet; zeg welke status uit het rapport volgt`);
  // Status C comes from what was not established, never from how many criteria failed: the sentence that names it says so.
  if (statuses.includes("C") && named.includes("C")) {
    const naming = sentencesOf(all).filter((sentence) => /\bstatus\s+C\b/i.test(sentence));
    if (!naming.some((sentence) => /vastgesteld|onderzocht|dekt|(?<![\p{L}])open(?![\p{L}])/iu.test(sentence))) problems.push("de samenvatting zegt niet waardoor de status C is; zeg in de zin met de status dat ze komt door de criteria die niet zijn vastgesteld, niet door het aantal dat niet is gehaald");
  }
  if (!used.has("status")) problems.push('geen alinea rust op "status": de samenvatting zegt of de site voldoet en hoeveel criteria niet zijn gehaald');
  // Whether the site meets the norm is said as the evaluation has it, never rounder.
  const failed = evaluation.criteria.some((criterion) => criterion.outcome === "failed");
  const open = evaluation.criteria.some((criterion) => criterion.outcome === "cantTell" || criterion.outcome === "untested");
  if (!NORM.test(all)) problems.push('de samenvatting noemt de norm niet; zeg één keer in een zin "WCAG 2.2 niveau A en AA", zoals het rapport');
  if (failed && !/voldoet niet/i.test(all)) problems.push('het rapport keurt criteria af; de samenvatting zegt met de woorden "voldoet niet" dat de site niet voldoet');
  // Any sentence that says the site meets something, without "niet" and not about what was not established, says more than the report.
  if (failed || open) for (const sentence of sentencesOf(all)) if (/(?<![\p{L}])voldoe(?:t|n)(?![\p{L}])/iu.test(sentence) && !/(?<![\p{L}])niet(?![\p{L}])|vastgesteld/iu.test(sentence)) problems.push(`"${sentence.trim()}" zegt dat de site voldoet, en dat draagt het rapport niet`);
  // The two counts the reader decides on are the ones of the evaluation, each in a sentence that says what it counts.
  const tally = evaluation.summary["2.2"];
  const openCount = tally.cantTell + tally.untested;
  const counts = new Set([String(tally.total), String(tally.failed), String(openCount), "2.2"]);
  if (tally.failed > 0) {
    const telling = sentencesOf(all).filter((sentence) => /niet gehaald/i.test(sentence));
    if (telling.length === 0) problems.push(`de samenvatting zegt niet hoeveel criteria niet zijn gehaald; zeg het met de woorden "niet gehaald" en het getal ${tally.failed}`);
    for (const sentence of telling) {
      const numbers = numbersOf(sentence);
      const other = numbers.filter((number) => !counts.has(number));
      // The count belongs to the words right after it: "4 niet gehaald en 5 open" with the two turned around names both numbers and says something else.
      const before = numbersOf(sentence.slice(0, sentence.search(/niet gehaald/i))).at(-1);
      if (before !== String(tally.failed) || other.length > 0) problems.push(`de zin met "niet gehaald" noemt ${numbers.join(", ") || "geen getal"}; het rapport heeft ${tally.failed} criteria die niet zijn gehaald, ${openCount} open en ${tally.total} in totaal. Zet het getal ${tally.failed} vóór de woorden "niet gehaald"`);
    }
  }
  const openWord = /vastgesteld|(?<![\p{L}])open(?![\p{L}])/giu;
  const saysOpen = sentencesOf(all).some((sentence) => [...sentence.matchAll(openWord)].some((match) => numbersOf(sentence.slice(0, match.index)).at(-1) === String(openCount)));
  if (openCount > 0 && !saysOpen) problems.push(`de samenvatting noemt niet dat ${openCount} criteria niet zijn vastgesteld; zet het getal ${openCount} vóór de woorden "niet vastgesteld" of "open"`);
  // An open criterion stays open: the summary says what was not established.
  if (open && !used.has("open")) problems.push('het rapport heeft open criteria; een alinea zegt wat niet is vastgesteld, met "open" in sources');
  // A group that is stopped at a core task is the first thing a reader must hear.
  const stopping = new Set(stoppingDefects);
  if (stopping.size > 0 && ![...used].some((source) => stopping.has(source))) problems.push(`een groep bezoekers loopt vast bij een kerntaak; een alinea noemt dat, met in sources het gebrek waardoor (${[...stopping].slice(0, 4).join(", ")})`);
  return problems;
}

/** The sentences of a summary as the second reader gets them, in order. */
export const readingSentences = (proposal: SummaryProposal): string[] => proposal.paragraphs.flatMap((paragraph) => paragraph.textNl.trim().split(/(?<=[.!?])\s+/).filter(Boolean));

const QUOTE_MIN = 12;
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Hold a reading to the summary and the report: every sentence has a verdict, a sentence the report
 * carries comes with text that is literally in the report, one it does not carry says why.
 * `problems` are faults in the reading itself; `refuted` are the sentences the reader did not find in the report.
 */
export function validateReading(reading: unknown, sentences: readonly string[], reportText: string): { problems: string[]; refuted: { n: number; sentence: string; noteNl: string }[] } {
  const problems: string[] = [];
  const refuted: { n: number; sentence: string; noteNl: string }[] = [];
  const entries = (reading as SummaryReading | null)?.sentences;
  if (!Array.isArray(entries)) return { problems: ['het antwoord heeft geen lijst "sentences"'], refuted };
  const report = flat(reportText);
  const seen = new Set<number>();
  for (const entry of entries) {
    const n = entry?.n;
    if (!Number.isInteger(n) || n < 1 || n > sentences.length) {
      problems.push(`zin ${String(n)} bestaat niet; de samenvatting heeft de zinnen 1 tot en met ${sentences.length}`);
      continue;
    }
    if (seen.has(n)) problems.push(`zin ${n} staat er twee keer`);
    seen.add(n);
    if (entry.verdict === "gedragen") {
      const quotes = Array.isArray(entry.quotes) ? entry.quotes.filter((quote): quote is string => typeof quote === "string" && quote.trim() !== "") : [];
      if (quotes.length === 0) problems.push(`zin ${n}: gedragen, maar zonder stuk uit het rapport in quotes`);
      for (const quote of quotes) {
        if (flat(quote).length < QUOTE_MIN) problems.push(`zin ${n}: "${flat(quote)}" is te kort om een plek in het rapport aan te wijzen`);
        else if (!report.includes(flat(quote))) problems.push(`zin ${n}: "${flat(quote).slice(0, 80)}" staat niet letterlijk in het rapport; kopieer het stuk uit het rapport`);
      }
    } else if (entry.verdict === "niet-gedragen") {
      const noteNl = typeof entry.noteNl === "string" ? entry.noteNl.trim() : "";
      if (noteNl === "") problems.push(`zin ${n}: niet-gedragen, maar noteNl zegt niet wat er niet klopt`);
      refuted.push({ n, sentence: sentences[n - 1]!, noteNl });
    } else problems.push(`zin ${n}: verdict is "gedragen" of "niet-gedragen"`);
  }
  const missing = sentences.map((_sentence, index) => index + 1).filter((n) => !seen.has(n));
  if (missing.length > 0) problems.push(`${missing.length === 1 ? "zin" : "de zinnen"} ${missing.join(", ")} ${missing.length === 1 ? "heeft" : "hebben"} geen oordeel`);
  return { problems, refuted };
}

export function clearSummary(evaluation: Evaluation): void {
  delete evaluation.executiveSummary;
}
