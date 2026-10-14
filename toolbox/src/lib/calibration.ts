import { ENGINE_IDS, flagOf, type EngineId, type Flag } from "../instruments/methods/rules.ts";

/**
 * Calibration against the test cases of the ACT rules: per instrument and per ACT rule how
 * often it finds a failure, misses it, or reports one that is not there. Everything in this
 * file counts; nothing here opens a page.
 */

/** What a test case says the outcome of its rule is. */
export type Expected = "passed" | "failed" | "inapplicable";
/** What an instrument says about a test case of one ACT rule. */
export type Said = "failed" | "cantTell" | "passed" | "inapplicable";
/** An instrument that has a mapping for the rule but could not run on the page. */
export type Answer = Said | "error";

export const EXPECTED: Expected[] = ["failed", "passed", "inapplicable"];

/** One row of testcases.json, as far as the calibration reads it. */
export interface TestCase {
  ruleId: string;
  ruleName: string;
  expected: Expected;
  testcaseId: string;
  relativePath: string;
  approved?: boolean;
}

/** The strongest of a set of outcomes: one failure makes the page fail, one doubt makes it doubtful. */
export function strongest(outcomes: Iterable<Said>): Said {
  const seen = new Set(outcomes);
  return seen.has("failed") ? "failed" : seen.has("cantTell") ? "cantTell" : seen.has("passed") ? "passed" : "inapplicable";
}

/** Per rule of an engine: which ACT rules it implements according to its maker, and whether the toolbox runs and counts it. */
export type Catalogue = Record<string, { act: string[]; runs: boolean }>;

export interface Mapped {
  /** The rules of the instrument that implement the ACT rule and that the toolbox runs. */
  rules: string[];
  /** Rules that implement it but that the toolbox does not run or does not count. */
  off: string[];
}

export function mappedRules(catalogue: Catalogue, act: string): Mapped {
  const rules: string[] = [];
  const off: string[] = [];
  for (const [rule, info] of Object.entries(catalogue)) if (info.act.includes(act)) (info.runs ? rules : off).push(rule);
  return { rules: rules.sort(), off: off.sort() };
}

/**
 * What an engine says about a page for one ACT rule: the strongest outcome of the rules that
 * implement it. A rule that gave no outcome on the page counts as not applicable. Null when
 * the engine has no rule for it: it then says nothing, which is not the same as missing it.
 */
export function engineSaid(perRule: Record<string, Said>, mapped: Mapped): Said | null {
  if (mapped.rules.length === 0) return null;
  return strongest(mapped.rules.map((rule) => perRule[rule] ?? "inapplicable"));
}

/** Where one answer on one test case lands. */
export type Cell = "found" | "missed" | "falseAlarm" | "rightlySilent" | "unsure" | "error";

export function cellOf(expected: Expected, answer: Answer): Cell {
  if (answer === "error") return "error";
  if (answer === "cantTell") return "unsure";
  if (expected === "failed") return answer === "failed" ? "found" : "missed";
  return answer === "failed" ? "falseAlarm" : "rightlySilent";
}

export interface Tally {
  /** Test cases of the rule, or of all rules in a total. */
  cases: number;
  /** The instrument has no rule for the ACT rule: it says nothing. */
  noOpinion: number;
  /** The instrument has a rule but did not run on the page. */
  error: number;
  /** Cases the instrument gave an answer on, doubt included. */
  judged: number;
  /** Of the judged cases: how many the test case calls failed. */
  failures: number;
  found: number;
  missed: number;
  /** "Cannot tell" on a case that is a failure: not found, and not passed either. */
  unsureOnFailure: number;
  falseAlarm: number;
  rightlySilent: number;
  /** "Cannot tell" on a case that is no failure. */
  unsureOnOther: number;
}

export const emptyTally = (): Tally => ({ cases: 0, noOpinion: 0, error: 0, judged: 0, failures: 0, found: 0, missed: 0, unsureOnFailure: 0, falseAlarm: 0, rightlySilent: 0, unsureOnOther: 0 });

/** Count one test case. `answer` null: the instrument has no rule for the ACT rule. */
export function count(tally: Tally, expected: Expected, answer: Answer | null): void {
  tally.cases++;
  if (answer === null) {
    tally.noOpinion++;
    return;
  }
  const cell = cellOf(expected, answer);
  if (cell === "error") {
    tally.error++;
    return;
  }
  tally.judged++;
  if (expected === "failed") tally.failures++;
  if (cell === "unsure") tally[expected === "failed" ? "unsureOnFailure" : "unsureOnOther"]++;
  else tally[cell]++;
}

export function addTally(into: Tally, from: Tally): void {
  for (const key of Object.keys(into) as (keyof Tally)[]) into[key] += from[key];
}

/** A share with the numbers it was made of: no percentage without its denominator. */
export interface Share {
  count: number;
  of: number;
  /** Null when there is nothing to divide by. */
  share: number | null;
}

export const shareOf = (count: number, of: number): Share => ({ count, of, share: of === 0 ? null : Math.round((count / of) * 1000) / 1000 });

export interface Rates {
  /** Of the failures the instrument judged: how many it reported as a failure. Doubt counts as not found. */
  hitRate: Share;
  /** Of everything the instrument reported as a failure: how many were none. */
  falseReports: Share;
  /** Of the cases that are no failure: how many the instrument reported as one. */
  falseAlarmRate: Share;
}

export function ratesOf(tally: Tally): Rates {
  return {
    hitRate: shareOf(tally.found, tally.failures),
    falseReports: shareOf(tally.falseAlarm, tally.found + tally.falseAlarm),
    falseAlarmRate: shareOf(tally.falseAlarm, tally.judged - tally.failures),
  };
}

// ----------------------------------------------------------------------- own measurements

/** How an own measurement of the toolbox answers an ACT rule. */
export type OwnKind = "contrast" | "language-page" | "language-parts" | "name";

export interface OwnMapping {
  act: string;
  kind: OwnKind;
  /** For a name: the roles the ACT rule is about. Which elements have such a role is read from the accessibility tree of Chromium. */
  roles?: string[];
  /** For a name: true when the rule is about `input type="image"` only, false when it leaves those out. */
  imageInput?: boolean;
  /** Why the ACT rule asks exactly what the measurement answers. */
  why: string;
}

/**
 * The ACT rules that an own measurement of the toolbox answers, and only where the rule asks
 * exactly what the measurement measures. Small on purpose: a measurement that only comes
 * close is left out, so its count cannot be read as a score.
 */
export const OWN_MAPPINGS: OwnMapping[] = [
  { act: "afw4f7", kind: "contrast", why: "de regel vraagt de contrastverhouding van zichtbare tekst tegen 4,5 op 1 of 3 op 1 voor grote tekst; dat is wat de contrastmeting op de pixels meet" },
  { act: "ucwvc8", kind: "language-page", why: "de regel vraagt of de taal van de pagina klopt met de taal die op het html-element is opgegeven; dat is de vraag van de taalherkenning voor de pagina" },
  { act: "off6ek", kind: "language-parts", why: "de regel vraagt of de taal van een element met een eigen lang-attribuut klopt met de tekst erin; dat is de vraag van de taalherkenning voor een deel" },
  { act: "97a4e1", kind: "name", roles: ["button"], imageInput: false, why: "de regel vraagt of een knop een toegankelijke naam heeft die niet leeg is" },
  { act: "59796f", kind: "name", roles: ["button"], imageInput: true, why: "de regel vraagt of een afbeeldingsknop een toegankelijke naam heeft die niet leeg is" },
  { act: "c487ae", kind: "name", roles: ["link"], why: "de regel vraagt of een link een toegankelijke naam heeft die niet leeg is" },
  { act: "ffd0e9", kind: "name", roles: ["heading"], why: "de regel vraagt of een kop een toegankelijke naam heeft die niet leeg is" },
  { act: "m6b1q3", kind: "name", roles: ["menuitem"], why: "de regel vraagt of een menu-item een toegankelijke naam heeft die niet leeg is" },
  { act: "e086e5", kind: "name", roles: ["checkbox", "combobox", "listbox", "menuitemcheckbox", "menuitemradio", "radio", "searchbox", "slider", "spinbutton", "switch", "textbox"], why: "de regel vraagt of een formulierveld een toegankelijke naam heeft die niet leeg is" },
];

/** The instruments an own mapping is answered by, in the names of the method registry. */
export const NAME_METHODS = ["chromium", "alfa-aria", "axe-name", "playwright", "dom-accessibility-api"];
export const LANGUAGE_METHODS = ["eld", "cld3", "eld+cld3"];
export const CONTRAST_METHODS = ["pixels"];
export const OWN_INSTRUMENTS = [...NAME_METHODS, ...CONTRAST_METHODS, ...LANGUAGE_METHODS];

export const ownInstrumentsOf = (kind: OwnKind): string[] => (kind === "name" ? NAME_METHODS : kind === "contrast" ? CONTRAST_METHODS : LANGUAGE_METHODS);

/** One element as the name measurement saw it. */
export interface NamedElement {
  /** The role in the accessibility tree of Chromium, in the spelling of ARIA; null when it has none worth naming. */
  role: string | null;
  /** Chromium leaves the element out of the tree it gives to assistive technology. */
  ignored: boolean;
  imageInput: boolean;
  /** Per method the name it computed; null when the method gave no answer for this element. */
  names: Record<string, string | null>;
}

/**
 * What one name method says about a page for one ACT rule on names. The elements the rule is
 * about are those with one of its roles in the tree of Chromium. A method fails the page when
 * it computes an empty name for one of them.
 */
export function nameSaid(elements: NamedElement[], mapping: OwnMapping, method: string): Answer {
  const about = elements.filter((element) => !element.ignored && element.role !== null && (mapping.roles ?? []).includes(element.role) && (mapping.imageInput === undefined || mapping.imageInput === element.imageInput));
  if (about.length === 0) return "inapplicable";
  const names = about.map((element) => element.names[method] ?? null);
  if (names.every((name) => name === null)) return "error";
  if (names.some((name) => name === "")) return "failed";
  return names.includes(null) ? "cantTell" : "passed";
}

/** What a language measurement says about one piece: the declared language against the detected one. */
export function languageSaid(verdict: "match" | "mismatch" | "cantTell" | "undeclared"): Said {
  return verdict === "mismatch" ? "failed" : verdict === "match" ? "passed" : verdict === "cantTell" ? "cantTell" : "inapplicable";
}

// ------------------------------------------------------------------------ the measurement

/** What was measured on one page, in the form the counting needs. */
export interface PageMeasurement {
  /** Per engine and per rule of that engine the strongest outcome on the page; a string when the engine did not run, with the reason. */
  engines: Partial<Record<EngineId, Record<string, Said> | string>>;
  /** Per own instrument and per ACT rule what it says. */
  own: Record<string, Record<string, Answer>>;
  /** The page did not load: nothing was measured. */
  loadError?: string;
}

export interface InstrumentInfo {
  id: string;
  kind: "ruleset" | "own";
  version: string;
  /** Where the tie between a rule of the instrument and an ACT rule comes from. */
  mapping: string;
}

export interface RuleRow {
  rule: string;
  name: string;
  approved: boolean;
  expected: Record<Expected, number>;
  /** Per instrument that has a rule for it: the rules and the count. Instruments without one are left out. */
  instruments: Record<string, { rules: string[]; off: string[]; tally: Tally }>;
}

export interface CaseRow {
  rule: string;
  id: string;
  expected: Expected;
  /** Per instrument with a rule for it what it said. */
  said: Record<string, Answer>;
}

/** What the toolbox calls the outcome of the engines together, and how often such a case is a failure. */
export interface FlagCount {
  cases: number;
  failures: number;
}

export interface Together {
  /** The engines laid next to each other here. */
  engines: EngineId[];
  /** Cases on which at least two of them gave an answer that is no doubt. */
  compared: number;
  unanimous: { cases: number; right: number };
  /** Cases on which at least one says failed and at least one says passed or not applicable. */
  split: { cases: number; majorityRight: number; majorityWrong: number; tie: number };
  /** Per engine: on how many split cases it gave an answer, and how often that was the right one. */
  rightWhenSplit: Partial<Record<EngineId, Share>>;
  /** In the words of the toolbox (`flagOf`): how often a case with that flag is a failure. */
  flags: Record<Flag, FlagCount>;
}

export interface Calibration {
  totals: Record<string, Tally & Rates>;
  /** The same totals over the rules W3C has approved only. */
  approvedTotals: Record<string, Tally & Rates>;
  rules: RuleRow[];
  cases: CaseRow[];
  together: { all: Together; sweep: Together };
  /** The cases on which the engines are split, with what each said. */
  disagreements: CaseRow[];
}

const definite = (answer: Answer | undefined): answer is "failed" | "passed" | "inapplicable" => answer === "failed" || answer === "passed" || answer === "inapplicable";

/** Lay the engines next to each other over all cases: how often they agree, and who is right when they do not. */
export function together(cases: CaseRow[], engines: EngineId[]): { summary: Together; split: CaseRow[] } {
  const flags = Object.fromEntries((["agree", "alone", "contradiction", "cantTell", "passed"] as Flag[]).map((flag) => [flag, { cases: 0, failures: 0 }])) as Record<Flag, FlagCount>;
  const summary: Together = { engines, compared: 0, unanimous: { cases: 0, right: 0 }, split: { cases: 0, majorityRight: 0, majorityWrong: 0, tie: 0 }, rightWhenSplit: {}, flags };
  const right: Partial<Record<EngineId, { count: number; of: number }>> = {};
  const split: CaseRow[] = [];
  for (const entry of cases) {
    const answers = engines.map((engine) => [engine, entry.said[engine]] as const).filter(([, answer]) => answer !== undefined && answer !== "error") as [EngineId, Said][];
    if (answers.length === 0) continue;
    // The toolbox reads "not applicable" as silence and flags what is left; the same reading is used here.
    const flag = flagOf(Object.fromEntries(answers.map(([engine, answer]) => [engine, answer === "inapplicable" ? "silent" : answer])));
    flags[flag].cases++;
    if (entry.expected === "failed") flags[flag].failures++;
    const sure = answers.filter(([, answer]) => definite(answer));
    if (sure.length < 2) continue;
    summary.compared++;
    const failed = sure.filter(([, answer]) => answer === "failed").length;
    const isFailure = entry.expected === "failed";
    if (failed === 0 || failed === sure.length) {
      summary.unanimous.cases++;
      if ((failed > 0) === isFailure) summary.unanimous.right++;
      continue;
    }
    summary.split.cases++;
    split.push(entry);
    if (failed * 2 === sure.length) summary.split.tie++;
    else if ((failed * 2 > sure.length) === isFailure) summary.split.majorityRight++;
    else summary.split.majorityWrong++;
    for (const [engine, answer] of sure) {
      const own = (right[engine] ??= { count: 0, of: 0 });
      own.of++;
      if ((answer === "failed") === isFailure) own.count++;
    }
  }
  for (const engine of engines) if (right[engine]) summary.rightWhenSplit[engine] = shareOf(right[engine]!.count, right[engine]!.of);
  return { summary, split };
}

/** The engines that run on every page of a sweep; the other two only run where an agent measures. */
export const SWEEP_ENGINES: EngineId[] = ["axe-core", "alfa"];

/**
 * Count everything. `pages` holds what was measured per test case id; a test case whose page
 * is missing counts as an error for every instrument that has a rule for it.
 */
export function calibrate(testcases: TestCase[], pages: Map<string, PageMeasurement>, catalogues: Record<EngineId, Catalogue>, ownMappings: OwnMapping[] = OWN_MAPPINGS): Calibration {
  const instruments = [...ENGINE_IDS, ...OWN_INSTRUMENTS];
  const totals = Object.fromEntries(instruments.map((id) => [id, emptyTally()]));
  const approvedTotals = Object.fromEntries(instruments.map((id) => [id, emptyTally()]));
  const rows = new Map<string, RuleRow>();
  const mapped = new Map<string, Mapped>();
  const cases: CaseRow[] = [];
  for (const testcase of testcases) {
    const approved = testcase.approved === true;
    const row = rows.get(testcase.ruleId) ?? { rule: testcase.ruleId, name: testcase.ruleName, approved, expected: { failed: 0, passed: 0, inapplicable: 0 }, instruments: {} };
    rows.set(testcase.ruleId, row);
    row.expected[testcase.expected]++;
    const page = pages.get(testcase.testcaseId);
    const said: Record<string, Answer> = {};
    const note = (instrument: string, answer: Answer | null, rules: Mapped): void => {
      for (const tally of [totals[instrument]!, ...(approved ? [approvedTotals[instrument]!] : [])]) count(tally, testcase.expected, answer);
      if (answer === null) return;
      const own = (row.instruments[instrument] ??= { rules: rules.rules, off: rules.off, tally: emptyTally() });
      count(own.tally, testcase.expected, answer);
      said[instrument] = answer;
    };
    for (const engine of ENGINE_IDS) {
      const key = `${engine}\n${testcase.ruleId}`;
      const rules = mapped.get(key) ?? mappedRules(catalogues[engine], testcase.ruleId);
      mapped.set(key, rules);
      if (rules.rules.length === 0) {
        note(engine, null, rules);
        // An engine whose only rules for this are switched off still gets a row, so the table shows why it is silent.
        if (rules.off.length > 0) row.instruments[engine] ??= { rules: [], off: rules.off, tally: emptyTally() };
        continue;
      }
      const answer = page?.engines[engine];
      note(engine, !page || page.loadError || answer === undefined || typeof answer === "string" ? "error" : engineSaid(answer, rules), rules);
    }
    const own = ownMappings.find((mapping) => mapping.act === testcase.ruleId);
    for (const instrument of OWN_INSTRUMENTS) {
      if (!own || !ownInstrumentsOf(own.kind).includes(instrument)) note(instrument, null, { rules: [], off: [] });
      else note(instrument, !page || page.loadError ? "error" : (page.own[instrument]?.[testcase.ruleId] ?? "error"), { rules: [own.kind], off: [] });
    }
    cases.push({ rule: testcase.ruleId, id: testcase.testcaseId, expected: testcase.expected, said });
  }
  const withRates = (tallies: Record<string, Tally>): Record<string, Tally & Rates> => Object.fromEntries(Object.entries(tallies).map(([id, tally]) => [id, { ...tally, ...ratesOf(tally) }]));
  const all = together(cases, ENGINE_IDS);
  const sweep = together(cases, SWEEP_ENGINES);
  return { totals: withRates(totals), approvedTotals: withRates(approvedTotals), rules: [...rows.values()], cases, together: { all: all.summary, sweep: sweep.summary }, disagreements: all.split };
}

// ------------------------------------------------------------------------------ in words

export interface Source {
  repository: string;
  commit: string;
  archive: string;
  testcasesSha256: string;
  /** One hash over every file that was served: the sorted lines "sha256  path", hashed again. */
  filesSha256: string;
  files: number;
  licence: string;
  /** What the cached copy held: test cases in the list, pages they point to, rules. */
  testcases: number;
  pages: number;
  rules: number;
}

export interface CalibrationReport extends Omit<Calibration, "cases"> {
  kind: "calibration";
  version: 1;
  date: string;
  source: Source;
  toolbox: { commit: string; dirty: boolean; version: string; lockfileSha256: string };
  browser: string;
  instruments: InstrumentInfo[];
  ownMappings: OwnMapping[];
  run: { seconds: number; concurrency: number; pagesMeasured: number; pagesNotLoaded: number; requestsRefused: number; only: string[] | null };
}

const percent = (share: Share): string => (share.share === null ? `geen (0 van ${share.of})` : `${(share.share * 100).toFixed(1).replace(".", ",")}% (${share.count} van ${share.of})`);
const FLAG_NL: Record<Flag, string> = { agree: "eens: twee of meer keuren af, geen keurt goed", alone: "alleen: één keurt af, de rest zwijgt", contradiction: "oneens: één keurt af wat een ander goedkeurt", cantTell: "onzeker: niemand keurt af, minstens één twijfelt", passed: "geen afkeuring" };
/** A table. The first `left` columns hold words, the others numbers and are set to the right. */
const table = (head: string[], rows: (string | number)[][], left = 1): string[] => [`| ${head.join(" | ")} |`, `|${head.map((_, index) => (index < left ? "---" : "---:")).join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)];

function totalsTable(report: CalibrationReport, totals: Record<string, Tally & Rates>, kind: "ruleset" | "own"): string[] {
  const rows = report.instruments
    .filter((instrument) => instrument.kind === kind && totals[instrument.id]!.judged > 0)
    .map((instrument) => {
      const total = totals[instrument.id]!;
      return [instrument.id, total.judged, total.failures, total.found, total.missed, total.unsureOnFailure, total.falseAlarm, total.unsureOnOther, total.noOpinion, total.error, percent(total.hitRate), percent(total.falseReports)];
    });
  return table(["Instrument", "Gevallen met een uitspraak", "waarvan een fout", "Terecht gevonden", "Gemist", "Twijfel bij een fout", "Onterecht gemeld", "Twijfel zonder fout", "Geen uitspraak", "Liep vast", "Trefkans", "Onterecht van alle meldingen"], rows);
}

function togetherLines(part: Together): string[] {
  const lines = [
    `Regelsets: ${part.engines.join(", ")}. Vergeleken zijn de ${part.compared} gevallen waarop minstens twee van hen een uitspraak deden die geen twijfel is.`,
    "",
    `- Eens: ${part.unanimous.cases} gevallen; in ${part.unanimous.right} daarvan klopt wat ze samen zeggen met de verwachte uitkomst.`,
    `- Oneens: ${part.split.cases} gevallen. De meerderheid had gelijk in ${part.split.majorityRight}, ongelijk in ${part.split.majorityWrong}; ${part.split.tie} keer staakten de stemmen.`,
    ...part.engines.filter((engine) => part.rightWhenSplit[engine]).map((engine) => `- ${engine} had gelijk in ${percent(part.rightWhenSplit[engine]!)} van de gevallen waarop het meedeed en de regelsets het oneens waren.`),
    "",
    ...table(["Zoals de toolbox het noemt", "Gevallen", "waarvan een fout", "Aandeel"], (Object.keys(part.flags) as Flag[]).map((flag) => [FLAG_NL[flag], part.flags[flag].cases, part.flags[flag].failures, percent(shareOf(part.flags[flag].failures, part.flags[flag].cases))])),
  ];
  return lines;
}

/** The calibration as a text a person reads. */
export function calibrationMarkdown(report: CalibrationReport): string {
  const sets = report.instruments.filter((instrument) => instrument.kind === "ruleset");
  const cell = (row: RuleRow, id: string): string => {
    const own = row.instruments[id];
    if (!own) return "";
    if (own.rules.length === 0) return "staat uit";
    const { tally } = own;
    return `${tally.found}/${tally.missed}/${tally.falseAlarm}${tally.unsureOnFailure + tally.unsureOnOther > 0 ? ` ?${tally.unsureOnFailure + tally.unsureOnOther}` : ""}${tally.error > 0 ? ` !${tally.error}` : ""}`;
  };
  const ruleRows = (ids: string[], rows: RuleRow[]): (string | number)[][] => rows.map((row) => [`${row.rule}${row.approved ? "" : " (voorstel)"}`, row.name.replaceAll("|", "/"), `${row.expected.failed}/${row.expected.passed}/${row.expected.inapplicable}`, ...ids.map((id) => cell(row, id))]);
  const ownIds = report.instruments.filter((instrument) => instrument.kind === "own").map((instrument) => instrument.id);
  const ownRows = report.rules.filter((row) => ownIds.some((id) => row.instruments[id]));
  const perRuleSplit = new Map<string, number>();
  for (const entry of report.disagreements) perRuleSplit.set(entry.rule, (perRuleSplit.get(entry.rule) ?? 0) + 1);
  const lines = [
    "# IJkmeting op de testgevallen van de ACT-regels",
    "",
    `Gemeten op ${report.date} met \`just calibrate\`. Per instrument en per ACT-regel: hoe vaak het een fout terecht vindt, mist of onterecht meldt. De cijfers per geval staan in \`gevallen.json\`, alles hieronder ook in \`uitkomst.json\`.`,
    "",
    "## Bron",
    "",
    `- Testgevallen: de repository \`${report.source.repository}\` op commit \`${report.source.commit}\`, opgehaald als ${report.source.archive}.`,
    `- \`testcases.json\`: sha256 \`${report.source.testcasesSha256}\`; ${report.source.testcases} gevallen bij ${report.source.rules} regels, op ${report.source.pages} verschillende pagina's.`,
    `- Alle ${report.source.files} bestanden die lokaal zijn geserveerd (de gevallen en hun hulpbestanden): sha256 \`${report.source.filesSha256}\` over de gesorteerde regels "sha256, twee spaties, pad".`,
    `- Licentie volgens de kop van \`testcases.json\`: ${report.source.licence}. De gevallen staan niet in deze repository; ze worden bij gebruik opgehaald.`,
    report.run.only ? `- Deze meting is beperkt tot de regels ${report.run.only.join(", ")} en is dus niet volledig.` : "- De meting is volledig: alle gevallen van de lijst.",
    "",
    "## Waarmee gemeten",
    "",
    `Toolbox op commit \`${report.toolbox.commit}\`${report.toolbox.dirty ? " (met niet vastgelegde wijzigingen)" : ""}, lockfile sha256 \`${report.toolbox.lockfileSha256}\`, ${report.browser}. ${report.run.pagesMeasured} pagina's gemeten in ${Math.round(report.run.seconds)} seconden met ${report.run.concurrency} tegelijk; ${report.run.pagesNotLoaded} laadden niet. ${report.run.requestsRefused} verzoeken naar buiten de lokale server zijn geweigerd.`,
    "",
    ...table(["Instrument", "Soort", "Versie", "Waar de koppeling met een ACT-regel vandaan komt"], report.instruments.map((instrument) => [instrument.id, instrument.kind === "ruleset" ? "regelset" : "eigen meting", instrument.version, instrument.mapping]), 9),
    "",
    "## Hoe er is geteld",
    "",
    "- Een testgeval is één pagina met de verwachte uitkomst van één regel: afgekeurd, geslaagd of niet van toepassing.",
    "- Een instrument keurt een geval af als één van zijn regels voor die ACT-regel op de pagina iets afkeurt. Zo leest de toolbox de regelsets ook: adviezen die een regelset zelf niet als overtreding telt, tellen niet mee.",
    "- Terecht gevonden: verwacht afgekeurd, en afgekeurd. Gemist: verwacht afgekeurd, en geslaagd of niet van toepassing. Onterecht gemeld: verwacht geslaagd of niet van toepassing, en afgekeurd.",
    "- Twijfel: het instrument zegt dat het niet kan beslissen. Dat is geen vondst en geen misser; in de trefkans telt het als niet gevonden.",
    "- Geen uitspraak: het instrument heeft volgens zijn maker geen regel voor die ACT-regel, of de toolbox zet die regel niet aan. Dat telt niet als gemist.",
    "- Trefkans: terecht gevonden, gedeeld door de fouten waarover het instrument een uitspraak deed. Onterecht van alle meldingen: onterecht gemeld, gedeeld door alles wat het instrument afkeurde.",
    "",
    "## Totaal per regelset",
    "",
    ...totalsTable(report, report.totals, "ruleset"),
    "",
    "Alleen de regels die W3C heeft goedgekeurd (de andere zijn voorstellen):",
    "",
    ...totalsTable(report, report.approvedTotals, "ruleset"),
    "",
    "## Totaal per eigen meting",
    "",
    ...totalsTable(report, report.totals, "own"),
    "",
    "De eigen metingen zijn alleen gekoppeld aan de regels in deze tabel. Bij een regel over een naam bepaalt de toegankelijkheidsboom van Chromium welke elementen de rol hebben waar de regel over gaat; daarna telt per methode of de naam leeg is.",
    "",
    ...table(["ACT-regel", "Eigen meting", "Waarom dezelfde vraag"], report.ownMappings.map((mapping) => [mapping.act, ownInstrumentsOf(mapping.kind).join(", "), mapping.why]), 9),
    "",
    "## De vier regelsets naast elkaar",
    "",
    ...togetherLines(report.together.all),
    "",
    "### De twee regelsets van de veegronde",
    "",
    ...togetherLines(report.together.sweep),
    "",
    "## Per ACT-regel, de regelsets",
    "",
    "In de kolom Gevallen: verwacht afgekeurd / geslaagd / niet van toepassing. Per regelset: terecht gevonden / gemist / onterecht gemeld, met `?` het aantal keren twijfel en met `!` het aantal keren dat de regelset vastliep. Leeg: de regelset heeft geen regel voor deze ACT-regel. Staat uit: de regelset heeft er een, maar de toolbox draait of telt die niet.",
    "",
    ...table(["ACT-regel", "Naam", "Gevallen", ...sets.map((instrument) => instrument.id), "Oneens"], ruleRows(sets.map((instrument) => instrument.id), report.rules).map((row, index) => [...row, perRuleSplit.get(report.rules[index]!.rule) ?? ""]), 2),
    "",
    "## Per ACT-regel, de eigen metingen",
    "",
    ...table(["ACT-regel", "Naam", "Gevallen", ...ownIds], ruleRows(ownIds, ownRows), 2),
    "",
    "## Welke regels van een regelset bij welke ACT-regel horen",
    "",
    ...table(["ACT-regel", ...sets.map((instrument) => instrument.id)], report.rules.filter((row) => sets.some((instrument) => row.instruments[instrument.id])).map((row) => [row.rule, ...sets.map((instrument) => {
      const own = row.instruments[instrument.id];
      return own ? [...own.rules, ...own.off.map((rule) => `${rule} (uit)`)].join(", ") : "";
    })]), 9),
    "",
  ];
  return `${lines.join("\n")}`;
}
