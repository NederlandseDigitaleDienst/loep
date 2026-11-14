import type { Defect } from "./defects.ts";
import { pageIndex } from "./defects.ts";
import type { Evaluation, ReportFinding } from "./evaluation.ts";
import { EVERYONE, GROUPS, groupsFor, isGroupId, type AffectedGroup, type GroupId } from "./groups.ts";
import { comparableText, quotedFragments, severityRank, type Severity } from "./verdict.ts";
import { criterionById } from "./wcag.ts";

/**
 * How heavy a finding is, and with it the defect it belongs to. The judgment per criterion says
 * that something fails the standard; that does not change here. This step records, per finding,
 * which groups of visitors it hinders, what happens to each of them, and whether they need the
 * part for a core task of the site. The severity follows from those facts by a fixed table, so
 * it can be checked and repeated. A defect has the highest severity among its findings.
 *
 * Three things can not be said here. That a finding hinders nobody: it either names a group and
 * what happens to it, or says for every group the criterion is essential for how that group
 * gets the same along its own way. That a group is small: the heaviest group counts. And that a
 * group can not finish a core task, or can finish it without the part, without saying why.
 *
 * Next to the findings the step may say that a group can not finish a core task because of
 * several findings together, none of which stops it alone. That changes no severity: the report
 * names it with the task.
 */

/** What happens to a group, the worst first. */
export const CONSEQUENCES = ["cannot", "detour", "effort"] as const;
export type Consequence = (typeof CONSEQUENCES)[number];

/** As a table says it after the name of a group. */
export const CONSEQUENCE_NL: Record<Consequence, string> = { cannot: "kan dit niet", detour: "alleen met een omweg", effort: "kost extra moeite" };
/** As a sentence ends that starts with the names of the groups: "Mensen die niet zien kunnen dit niet gebruiken". */
export const CONSEQUENCE_CLAUSE_NL: Record<Consequence, string> = { cannot: "kunnen dit niet gebruiken", detour: "kunnen dit alleen met een omweg gebruiken", effort: "kunnen dit gebruiken, maar het kost extra moeite" };

export interface Affected {
  group: AffectedGroup;
  consequence: Consequence;
  /** How this group works at this place and what then happens, in a few sentences that follow on the report's own sentence about the group. */
  textNl: string;
  /** Why this group, when table B.2 does not name it for the criterion of the finding. */
  whyGroupNl?: string;
}

export interface Unaffected {
  group: GroupId;
  /** How this group gets the same along its own way. */
  sameNl: string;
}

/** For a part on every page that every core task needs or has to pass: the main menu, a panel that takes the focus. */
export const TASK_ALL = "all";

/** Something a visitor comes to the site to do, or to find. */
export interface SiteTask {
  id: string;
  nameNl: string;
}

/** What the step recorded for one finding. */
export interface Weighing {
  /** The core task a visitor needs this part for or has to pass it for, or `TASK_ALL`; null when the task can be done without the part. */
  task: string | null;
  /** The groups the finding hinders. Empty only with `unaffected`. */
  affected: Affected[];
  /** Only when a group can not do this and `task` names a core task: why the task can not be finished without the part. */
  blocksNl?: string;
  /** Only when a group can not do this and `task` is null: how the core tasks still work without the part. */
  withoutNl?: string;
  /** Only without `affected`: every group the criterion is essential for, with how it gets the same. */
  unaffected?: Unaffected[];
  /** A fact the findings do not give and the choice depends on. */
  unsureNl?: string;
}

/** What a defect comes to from the weighings of its findings: per group the worst that happens to it, and the core task of the finding that gives the defect its severity. */
export interface DefectWeighing {
  task: string | null;
  affected: Affected[];
  /** Why the core task can not be finished, from the finding that makes the defect "blokkerend". */
  blocksNl?: string;
  /** How the core tasks still work without the part, from the finding that makes the defect "hoog". */
  withoutNl?: string;
}

/** Findings that stop a group at a core task together, while none of them does alone. */
export interface Together {
  /** The id of a core task, or `TASK_ALL`. */
  task: string;
  group: AffectedGroup;
  /** At least two findings, each with this task and a detour or more effort for this group. */
  findings: string[];
  /** Why the task can not be finished with these findings one after the other. */
  stopsNl: string;
}

export interface WeighingProposal {
  tasks: SiteTask[];
  findings: ({ finding: string } & Weighing)[];
  together?: Together[];
}

export interface WeighingRecord {
  /** "stale": there is a weighing, but it was validated against other findings or another task text, so it is not applied. */
  status: "not-run" | "stale" | "applied";
  templateSha256?: string;
  proposalSha256?: string;
  /** The core tasks of the site, as the step named them. */
  tasks?: SiteTask[];
  /** Per core task and group, the findings that stop the group together. */
  together?: Together[];
  /** Findings whose severity came out higher, lower or the same as the judge gave it. */
  raised?: number;
  lowered?: number;
  same?: number;
  /** Findings that show no consequence for any group. */
  noEffect?: number;
  unsure?: number;
}

/**
 * The severity of a finding, from what happens to the group it hits hardest. A group that can
 * not do something it needs for a core task: "blokkerend". A group that can not do something
 * else: "hoog". Only by a detour: "midden". With more effort: "laag". A finding without a
 * consequence stays a finding, on the lowest step.
 *
 * The core task decides only between the two highest steps. Measured on three weighings of one
 * evaluation, whether a part is needed for a core task was the least repeatable of the three
 * facts; a table in which it raised every step gave the same severity twice for 77 to 85 percent
 * of the defects, this one for 90 percent or more (validatie/weging/README.md).
 */
export function severityOf(weighing: Pick<Weighing, "task" | "affected">): Severity {
  const worst = CONSEQUENCES.find((consequence) => weighing.affected.some((entry) => entry.consequence === consequence));
  if (worst === "cannot") return weighing.task !== null ? "blokkerend" : "hoog";
  return worst === "detour" ? "midden" : "laag";
}

/**
 * Criteria with a limit that is measured: the standard itself says where the hindrance starts.
 * A contrast of 4.4 to 1 or a target of 20 pixels can not be argued to hinder no group.
 */
export const MEASURED_LIMIT = new Set(["1.4.3", "1.4.11", "2.3.1", "2.5.8"]);

/** Words that weigh a group by its size or call a consequence unimportant instead of saying what happens. */
const DISMISSALS: [RegExp, string][] = [
  [/\bniemand\b/i, "niemand"],
  [/\brandgeval/i, "randgeval"],
  [/\bbijza(?:ak|ken)/i, "bijzaak"],
  [/\bvalt (?:\S+ ){0,5}mee\b/i, "valt mee"],
  [/\bzeldza/i, "zeldzaam"],
  [/\bkleine(?:re)? groep/i, "kleine groep"],
  [/\bweinig (?:mensen|bezoekers|gebruikers)\b/i, "weinig mensen"],
  [/\bmeeste(?:n\b| (?:mensen|bezoekers|gebruikers)\b)/i, "de meeste mensen"],
];
/** What stands between double quotation marks is what the finding says, not what the step says about a group. */
const withoutQuotations = (text: string): string => text.replace(/["\u201c\u201e][^"\u201c\u201d\u201e]*["\u201d]/g, " ");

export const TASKS_MIN = 1;
export const TASKS_MAX = 8;
/** The name of a core task is a heading in the report. */
export const TASK_WORDS_MAX = 8;
export const WORDS_MIN = 4;
export const WORDS_MAX = 40;
/** The account per group is a few sentences, not one. */
export const TEXT_WORDS_MAX = 60;

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Everything a finding says. The judges' own quotations were checked against the observations. */
const findingText = (finding: ReportFinding): string =>
  [finding.titleNl, finding.observedNl, finding.impactNl, finding.fixNl, finding.component ?? "", finding.pagesAffected, ...finding.locations.flatMap((location) => [location.where, location.heading ?? "", location.text ?? ""])].join("\n");

/**
 * Per finding, the text a quotation may come from: what the step read about that finding. That
 * is the finding itself, the other findings of its defect (the input puts them next to it), the
 * title of the defect and of the criterion, the titles of the pages and documents they name, and
 * what the site is.
 */
function quotationSources(evaluation: Evaluation): Map<string, string> {
  const findings = findingsOf(evaluation);
  const { labels } = pageIndex(evaluation);
  const titles = new Map<string, string>([
    ...labels.map((label, index): [string, string] => [label, evaluation.sample.items[index]!.title ?? ""]),
    ...(evaluation.documents?.items ?? []).map((document): [string, string] => [document.label, document.title ?? ""]),
  ]);
  const site = [evaluation.site.name, evaluation.site.descriptionNl ?? ""];
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const places = evaluation.defects ? evaluation.defects.map((defect) => ({ titleNl: defect.titleNl, members: defect.findingIds.map((id) => byId.get(id)!) })) : findings.map((finding) => ({ titleNl: finding.titleNl, members: [finding] }));
  const sources = new Map<string, string>();
  for (const place of places) {
    const named = [...new Set(place.members.flatMap((finding) => finding.locations.map((location) => location.page)))].map((label) => titles.get(label) ?? "");
    const shared = [place.titleNl, ...place.members.map(findingText), ...named, ...site];
    for (const finding of place.members) sources.set(finding.id, comparableText([...shared, criterionById(finding.criterion)?.titleNl ?? ""].join("\n")));
  }
  return sources;
}

/**
 * A sentence for a reader: present, of a length a report can print, without a word that weighs
 * a group away, and with nothing between quotation marks that the finding does not say. The
 * step sees no page: what it quotes can only come from the finding.
 */
function sentenceProblems(value: unknown, at: string, source: string, longest = WORDS_MAX): string[] {
  if (typeof value !== "string" || words(value) < WORDS_MIN) return [`${at} is missing or shorter than ${WORDS_MIN} words`];
  const problems: string[] = [];
  if (words(value) > longest) problems.push(`${at} is longer than ${longest} words`);
  const said = withoutQuotations(value);
  for (const [pattern, word] of DISMISSALS) {
    if (pattern.test(said)) problems.push(`${at} says "${word}": write what happens to this group, not how many people it is or how little it matters; for something that works for no visitor use the group "${EVERYONE}"`);
  }
  for (const fragment of quotedFragments(value)) {
    if (!source.includes(fragment)) problems.push(`${at}: the quoted text "${fragment}" is not found literally in the input for this finding; quote only what the input says, or write it in your own words without quotation marks`);
  }
  return problems;
}

/** The groups table B.2 names for a criterion, those it is essential for first. */
export function criterionGroups(criterionId: string): GroupId[] {
  return [...(groupsFor(criterionId)?.primary ?? []), ...(groupsFor(criterionId)?.secondary ?? [])];
}

const findingsOf = (evaluation: Evaluation): ReportFinding[] => evaluation.criteria.flatMap((criterion) => criterion.findings);

/**
 * Check what the language model wrote down. It may name the core tasks of the site and, per
 * finding, the groups, what happens to them and the task. It decides nothing about a criterion
 * and no finding leaves the list. Refused: a finding left out or named twice, a group or a
 * consequence that does not exist, a finding without a group and without the account of why
 * no group is hindered, and a sentence that weighs a group away.
 */
export function validateWeighing(input: unknown, evaluation: Evaluation): string[] {
  if (!isObject(input) || !Array.isArray(input.tasks) || !Array.isArray(input.findings)) return ['the weighing must be a JSON object with a list "tasks" and a list "findings"'];
  const problems: string[] = [];
  const tasks = new Set<string>();
  if (input.tasks.length < TASKS_MIN || input.tasks.length > TASKS_MAX) problems.push(`tasks must name ${TASKS_MIN} to ${TASKS_MAX} core tasks of the site`);
  for (const [index, task] of input.tasks.entries()) {
    const at = `tasks[${index}]`;
    if (!isObject(task) || typeof task.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id)) {
      problems.push(`${at}: id must be a short name in lower case letters, digits and hyphens`);
      continue;
    }
    if (task.id === TASK_ALL) problems.push(`${at}: id "${TASK_ALL}" is the name for every core task together; give this task a name of its own`);
    if (tasks.has(task.id)) problems.push(`${at}: id "${task.id}" is used twice`);
    tasks.add(task.id);
    if (typeof task.nameNl !== "string" || words(task.nameNl) < 1 || words(task.nameNl) > TASK_WORDS_MAX) problems.push(`${at}: nameNl must say in 1 to ${TASK_WORDS_MAX} words what the visitor comes to do`);
  }
  const findings = new Map(findingsOf(evaluation).map((finding) => [finding.id, finding]));
  const sources = quotationSources(evaluation);
  const seen = new Map<string, number>();
  /** What each finding came to, for the check on what stops a group together. */
  const weighed = new Map<string, { task: unknown; affected: Map<string, unknown> }>();
  for (const [index, entry] of input.findings.entries()) {
    const at = `findings[${index}]`;
    if (!isObject(entry) || typeof entry.finding !== "string") {
      problems.push(`${at}: finding must be the id of a finding`);
      continue;
    }
    const finding = findings.get(entry.finding);
    if (!finding) {
      problems.push(`${at}: "${entry.finding}" is not a finding of this evaluation`);
      continue;
    }
    const name = `${at} (${finding.id})`;
    const source = sources.get(finding.id)!;
    if (seen.has(finding.id)) problems.push(`${name}: is already in findings[${seen.get(finding.id)}]; a finding is weighed once`);
    else seen.set(finding.id, index);
    if (entry.task !== null && entry.task !== TASK_ALL && !(typeof entry.task === "string" && tasks.has(entry.task))) problems.push(`${name}: task must be the id of one of the tasks, "${TASK_ALL}" for every core task, or null when the tasks can be done without this part`);
    if (entry.unsureNl !== undefined) problems.push(...sentenceProblems(entry.unsureNl, `${name}: unsureNl`, source));
    if (!Array.isArray(entry.affected)) {
      problems.push(`${name}: affected must be a list`);
      continue;
    }
    // The highest severity is a claim about the task, not about the part: it has to be made in so many words.
    const stops = entry.task !== null && entry.affected.some((affected) => isObject(affected) && affected.consequence === "cannot");
    if (stops) problems.push(...sentenceProblems(entry.blocksNl, `${name}: blocksNl (a group can not do this and task names a core task: say why that task can not be finished without this part, or set task to null when it can)`, source));
    else if (entry.blocksNl !== undefined) problems.push(`${name}: blocksNl is only for a finding where a group can not do something (cannot) and task names a core task`);
    // The step below the highest is a claim about the task as well: that it can be finished without the part.
    const beside = entry.task === null && entry.affected.some((affected) => isObject(affected) && affected.consequence === "cannot");
    if (beside) problems.push(...sentenceProblems(entry.withoutNl, `${name}: withoutNl (a group can not do this and task is null: say how the core tasks still work without this part, or name the task that stops)`, source));
    else if (entry.withoutNl !== undefined) problems.push(`${name}: withoutNl is only for a finding where a group can not do something (cannot) and task is null`);
    const allowed = new Set<string>([...criterionGroups(finding.criterion), EVERYONE]);
    const groups = new Set<string>();
    for (const [position, affected] of entry.affected.entries()) {
      const here = `${name}: affected[${position}]`;
      if (!isObject(affected) || !(isGroupId(affected.group) || affected.group === EVERYONE)) {
        problems.push(`${here}: group must be one of ${GROUPS.map((group) => group.id).join(", ")} or ${EVERYONE}`);
        continue;
      }
      if (groups.has(affected.group)) problems.push(`${here}: group "${affected.group}" is named twice; give a group its worst consequence once`);
      groups.add(affected.group);
      if (!(CONSEQUENCES as readonly unknown[]).includes(affected.consequence)) problems.push(`${here}: consequence must be one of ${CONSEQUENCES.join(", ")}`);
      problems.push(...sentenceProblems(affected.textNl, `${here}: textNl`, source, TEXT_WORDS_MAX));
      if (!allowed.has(affected.group)) problems.push(...sentenceProblems(affected.whyGroupNl, `${here}: whyGroupNl (${finding.criterion} does not name "${affected.group}"; say why it is hindered)`, source));
      else if (affected.whyGroupNl !== undefined) problems.push(`${here}: whyGroupNl is only for a group the criterion of the finding does not name`);
    }
    const consequenceOf = new Map<string, unknown>(entry.affected.filter(isObject).map((affected) => [String(affected.group), affected.consequence]));
    weighed.set(finding.id, { task: entry.task, affected: consequenceOf });
    // What goes wrong for everyone goes wrong for each group: a group stands next to it only when it is hit harder.
    if (consequenceOf.has(EVERYONE)) {
      const general = CONSEQUENCES.indexOf(consequenceOf.get(EVERYONE) as Consequence);
      for (const [group, consequence] of consequenceOf) {
        if (group !== EVERYONE && general !== -1 && CONSEQUENCES.indexOf(consequence as Consequence) >= general) problems.push(`${name}: "${group}" stands next to "${EVERYONE}" with the same or a lighter consequence; name a group next to "${EVERYONE}" only when it is hit harder`);
      }
    }
    const essential = groupsFor(finding.criterion)?.primary ?? [];
    if (entry.affected.length > 0) {
      if (entry.unaffected !== undefined) problems.push(`${name}: unaffected is only for a finding without affected groups`);
      continue;
    }
    // No group hindered: the claim is made per group, and not at all where the standard set a measured limit.
    if (MEASURED_LIMIT.has(finding.criterion)) {
      problems.push(`${name}: affected is empty, but ${finding.criterion} sets a measured limit; name the group and what happens to it`);
      continue;
    }
    if (!Array.isArray(entry.unaffected)) {
      problems.push(`${name}: affected is empty; name a group and what happens to it, or say under unaffected for each of ${essential.join(", ")} how that group gets the same along its own way`);
      continue;
    }
    const covered = new Set<string>();
    for (const [position, unaffected] of entry.unaffected.entries()) {
      const here = `${name}: unaffected[${position}]`;
      if (!isObject(unaffected) || !isGroupId(unaffected.group)) {
        problems.push(`${here}: group must be one of ${GROUPS.map((group) => group.id).join(", ")}`);
        continue;
      }
      if (covered.has(unaffected.group)) problems.push(`${here}: group "${unaffected.group}" is named twice`);
      covered.add(unaffected.group);
      problems.push(...sentenceProblems(unaffected.sameNl, `${here}: sameNl`, source));
    }
    for (const group of essential) if (!covered.has(group)) problems.push(`${name}: unaffected does not say how "${group}" gets the same, and ${finding.criterion} is essential for that group`);
  }
  for (const id of findings.keys()) if (!seen.has(id)) problems.push(`finding ${id} is not weighed; every finding must be named exactly once`);
  problems.push(...togetherProblems(input.together, tasks, weighed, sources));
  return problems;
}

/**
 * Check what the step says stops a group together. Each finding named has to be on the way to
 * that task and has to give that group a detour or more effort; a group that one finding stops
 * there already is in the report with that finding.
 */
function togetherProblems(input: unknown, tasks: Set<string>, weighed: Map<string, { task: unknown; affected: Map<string, unknown> }>, sources: Map<string, string>): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return ["together must be a list; leave it empty when no findings stop a group together"];
  const problems: string[] = [];
  const named = new Set<string>();
  const onTheWay = (task: unknown, to: string): boolean => task === to || task === TASK_ALL;
  const hits = (affected: Map<string, unknown>, group: string): unknown => affected.get(group) ?? affected.get(EVERYONE);
  for (const [index, entry] of input.entries()) {
    const at = `together[${index}]`;
    if (!isObject(entry) || !(typeof entry.task === "string" && (tasks.has(entry.task) || entry.task === TASK_ALL)) || !(isGroupId(entry.group) || entry.group === EVERYONE) || !Array.isArray(entry.findings)) {
      problems.push(`${at}: needs task (the id of one of the tasks, or "${TASK_ALL}"), group and a list findings`);
      continue;
    }
    const { task, group } = entry as { task: string; group: string };
    if (named.has(`${task} ${group}`)) problems.push(`${at}: task "${task}" and group "${group}" are named twice; put their findings in one entry`);
    named.add(`${task} ${group}`);
    const ids = [...new Set(entry.findings.filter((id): id is string => typeof id === "string"))];
    if (ids.length < 2 || ids.length !== entry.findings.length) problems.push(`${at}: findings must name at least two different findings`);
    for (const id of ids) {
      const finding = weighed.get(id);
      if (!finding) problems.push(`${at}: "${id}" is not a finding weighed here`);
      else if (!onTheWay(finding.task, task)) problems.push(`${at}: ${id} does not have task "${task}" or "${TASK_ALL}"; only findings on the way to this task count`);
      else if (hits(finding.affected, group) !== "detour" && hits(finding.affected, group) !== "effort") problems.push(`${at}: ${id} does not give "${group}" a detour or more effort`);
    }
    const stopped = [...weighed].find(([, finding]) => onTheWay(finding.task, task) && finding.task !== null && hits(finding.affected, group) === "cannot");
    if (stopped) problems.push(`${at}: ${stopped[0]} already stops "${group}" at this task by itself; the report says so there`);
    problems.push(...sentenceProblems(entry.stopsNl, `${at}: stopsNl (say why the task can not be finished with these findings one after the other)`, comparableText(ids.map((id) => sources.get(id) ?? "").join("\n"))));
  }
  return problems;
}

const heaviest = (severities: Severity[]): Severity => [...severities].sort((a, b) => severityRank(a) - severityRank(b))[0]!;

/** Put back what the judges gave, so grouping and weighing always start from their severities. */
export function clearWeighing(evaluation: Evaluation): void {
  for (const item of [...(evaluation.defects ?? []), ...findingsOf(evaluation)]) {
    if (item.judgedSeverity !== undefined) item.severity = item.judgedSeverity;
    delete item.judgedSeverity;
  }
  for (const item of [...(evaluation.defects ?? []), ...findingsOf(evaluation)]) delete item.weighing;
  evaluation.weighing = { status: "not-run" };
}

/**
 * Record a weighing that passed validation. A finding gets the severity of the table and keeps
 * what the judge gave next to it. A defect has the highest severity among its findings, as it
 * always had; the findings and the grouping stay what they were.
 */
export function applyWeighing(evaluation: Evaluation, proposal: WeighingProposal): Required<Pick<WeighingRecord, "raised" | "lowered" | "same" | "noEffect" | "unsure">> {
  clearWeighing(evaluation);
  const findings = new Map(findingsOf(evaluation).map((finding) => [finding.id, finding]));
  const counts = { raised: 0, lowered: 0, same: 0, noEffect: 0, unsure: 0 };
  for (const entry of proposal.findings) {
    const finding = findings.get(entry.finding)!;
    const weighing: Weighing = {
      task: entry.task,
      affected: entry.affected.map((affected) => ({ group: affected.group, consequence: affected.consequence, textNl: affected.textNl.trim(), ...(affected.whyGroupNl ? { whyGroupNl: affected.whyGroupNl.trim() } : {}) })),
      ...(entry.blocksNl ? { blocksNl: entry.blocksNl.trim() } : {}),
      ...(entry.withoutNl ? { withoutNl: entry.withoutNl.trim() } : {}),
      ...(entry.affected.length === 0 ? { unaffected: entry.unaffected!.map((unaffected) => ({ group: unaffected.group, sameNl: unaffected.sameNl.trim() })) } : {}),
      ...(entry.unsureNl ? { unsureNl: entry.unsureNl.trim() } : {}),
    };
    const severity = severityOf(weighing);
    counts[severityRank(severity) < severityRank(finding.severity) ? "raised" : severityRank(severity) > severityRank(finding.severity) ? "lowered" : "same"]++;
    if (weighing.affected.length === 0) counts.noEffect++;
    if (weighing.unsureNl) counts.unsure++;
    finding.judgedSeverity = finding.severity;
    finding.severity = severity;
    finding.weighing = weighing;
  }
  for (const defect of evaluation.defects ?? []) {
    defect.judgedSeverity = defect.severity;
    defect.severity = heaviest(defect.findingIds.map((id) => findings.get(id)!.severity));
    defect.weighing = defectWeighing(defect, findings);
  }
  return counts;
}

/** The weighing of a defect: its findings together. The main finding goes first, so at the same severity the defect is described in its words. */
function defectWeighing(defect: Pick<Defect, "findingIds" | "mainFindingId" | "severity">, findings: Map<string, ReportFinding>): DefectWeighing {
  const members = [defect.mainFindingId, ...defect.findingIds.filter((id) => id !== defect.mainFindingId)].map((id) => findings.get(id)!);
  const order: string[] = [EVERYONE, ...GROUPS.map((group) => group.id)];
  const worst = new Map<string, Affected>();
  for (const finding of members) {
    for (const affected of finding.weighing!.affected) {
      const earlier = worst.get(affected.group);
      if (!earlier || CONSEQUENCES.indexOf(affected.consequence) < CONSEQUENCES.indexOf(earlier.consequence)) worst.set(affected.group, affected);
    }
  }
  // Among the findings that give the defect its severity, one that names a core task decides: the defect then stands with that task.
  const heaviestMembers = members.filter((finding) => finding.severity === defect.severity);
  const deciding = (heaviestMembers.find((finding) => finding.weighing!.task !== null) ?? heaviestMembers[0]!).weighing!;
  return {
    task: deciding.task,
    affected: [...worst.values()].sort((a, b) => CONSEQUENCES.indexOf(a.consequence) - CONSEQUENCES.indexOf(b.consequence) || order.indexOf(a.group) - order.indexOf(b.group)),
    ...(deciding.blocksNl ? { blocksNl: deciding.blocksNl } : {}),
    ...(deciding.withoutNl ? { withoutNl: deciding.withoutNl } : {}),
  };
}

/**
 * What the step gets to read: every finding in full, under the defect it belongs to so the
 * other findings about the same place stand next to it, with the groups its criterion names and
 * what the site is for. Not the severity the judges gave: the step does not start from an
 * earlier weight. What the judge wrote about who is hindered (`impactNl`) is part of the finding
 * and is read, so the weighing is not independent of the judge.
 */
export function weighingInput(evaluation: Evaluation): Record<string, unknown> {
  const findings = new Map(findingsOf(evaluation).map((finding) => [finding.id, finding]));
  const { labels } = pageIndex(evaluation);
  const entry = (finding: ReportFinding): Record<string, unknown> => ({
    finding: finding.id,
    criterion: { id: finding.criterion, titleNl: criterionById(finding.criterion)?.titleNl ?? null, essentialFor: groupsFor(finding.criterion)?.primary ?? [], alsoHelps: groupsFor(finding.criterion)?.secondary ?? [] },
    titleNl: finding.titleNl,
    observedNl: finding.observedNl,
    impactNl: finding.impactNl,
    fixNl: finding.fixNl,
    component: finding.component,
    pagesAffected: finding.pagesAffected,
    where: finding.locations.map((location) => [location.page, location.where, location.heading ? `onder de kop "${location.heading}"` : null, location.text ? `tekst "${location.text}"` : null].filter(Boolean).join(", ")),
  });
  // An evaluation from before findings were grouped: every finding is a place of its own.
  const places = evaluation.defects ? evaluation.defects.map((defect) => ({ titleNl: defect.titleNl, pages: defect.pages, morePages: defect.morePages, findings: defect.findingIds.map((id) => entry(findings.get(id)!)) })) : [...findings.values()].map((finding) => ({ titleNl: finding.titleNl, pages: [...new Set(finding.locations.map((location) => location.page))], morePages: false, findings: [entry(finding)] }));
  return {
    site: { name: evaluation.site.name, descriptionNl: evaluation.site.descriptionNl ?? null },
    pages: Object.fromEntries(labels.map((label, index) => [label, { title: evaluation.sample.items[index]!.title || null, url: evaluation.sample.items[index]!.url }])),
    // A finding names a document by its label; what the document is, says its title or its address.
    documents: Object.fromEntries((evaluation.documents?.items ?? []).map((document) => [document.label, { kind: document.kind, title: document.title, url: document.url }])),
    places,
  };
}
