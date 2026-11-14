import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The groups of visitors a defect can hinder: the user needs of EN 301 549 clause 4.2.1 to
 * 4.2.10 (functional performance statements). Which groups a success criterion is about comes
 * from table B.2 of that standard; `toolbox/data/groups.json` says per criterion where its row
 * comes from. A group is not a disability: one person can belong to several.
 */
export const GROUP_IDS = ["no-vision", "low-vision", "no-color", "no-hearing", "low-hearing", "no-speech", "limited-manipulation", "limited-reach", "photosensitive", "cognitive"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/** A defect that hinders every visitor alike, such as a form that does not send, names this instead of a group. */
export const EVERYONE = "everyone";
export type AffectedGroup = GroupId | typeof EVERYONE;

export interface Group {
  id: GroupId;
  /** The clause of EN 301 549 that states the need. */
  clause: string;
  /** How a report names the group, as the object of a sentence: "mensen die niet zien". */
  labelNl: string;
  /** How people in this group use a site: what they rely on and what does not exist for them. */
  howNl: string;
}

export interface CriterionGroups {
  /** P in table B.2: the criterion is essential for this group. */
  primary: GroupId[];
  /** S in table B.2: the criterion also helps this group. */
  secondary: GroupId[];
  source: string;
}

interface GroupData {
  sourceNl: string;
  groups: Group[];
  criteria: Record<string, CriterionGroups>;
}

const data = JSON.parse(readFileSync(fileURLToPath(new URL("../../data/groups.json", import.meta.url)), "utf8")) as GroupData;

export const GROUPS: Group[] = data.groups;
export const GROUPS_SOURCE_NL = data.sourceNl;

const byId = new Map(GROUPS.map((group) => [group.id, group]));

export const isGroupId = (value: unknown): value is GroupId => typeof value === "string" && byId.has(value as GroupId);

/** The groups table B.2 names for a criterion; undefined for a criterion loep does not evaluate. */
export function groupsFor(criterionId: string): CriterionGroups | undefined {
  return data.criteria[criterionId];
}

export function groupLabelNl(group: AffectedGroup): string {
  return group === EVERYONE ? "alle bezoekers" : byId.get(group)!.labelNl;
}
