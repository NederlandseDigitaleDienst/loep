import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./canonical.ts";

/** The roles an agent has in a run. Each starts a session of its own, except the reviewer of the gate, who only reads sheets. */
export type AgentRole = "explorer" | "walk" | "judge" | "verifier" | "finisher" | "gate";

export const ROLE_NL: Record<AgentRole, string> = { explorer: "verkenner", walk: "rondgang", judge: "beoordelaar", verifier: "verifieerder", finisher: "afmaakronde", gate: "poort" };
const ROLE_ORDER: AgentRole[] = ["explorer", "gate", "walk", "judge", "verifier", "finisher"];

/** What an agent writes when it does not know which model it runs on. */
export const MODEL_UNKNOWN = "onbekend";
const MAX_MODEL_LENGTH = 120;

/** What the agents of one role said about the model they ran on. */
export interface RoleModels {
  role: AgentRole;
  roleNl: string;
  /** Sessions of this role (for the gate: answer files), with or without a model. */
  agents: number;
  /** Each model that was given and by how many agents, the most named first. `onbekend` is what an agent says that does not know. */
  models: { model: string; agents: number }[];
  /** Agents that gave nothing at all. */
  notGiven: number;
}

/** The name of a model as an agent gave it, or null when it gave none. A placeholder copied from the task (`<...>`) is not a name. */
export function cleanModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_MODEL_LENGTH);
  if (text === "" || text.startsWith("<")) return null;
  return text.toLowerCase() === MODEL_UNKNOWN ? MODEL_UNKNOWN : text;
}

/**
 * The role of the agent behind a session, read from the name the toolbox gave the session:
 * `verken` for the explorer, `r-` for a walk-through, `b-` for a judge, `v-` for a verifier,
 * `a-` for the finishing round.
 * Any other session (one started by hand) belongs to no role.
 */
export function roleOfSession(name: string): AgentRole | null {
  if (/^verken\d*$/.test(name)) return "explorer";
  if (name.startsWith("r-")) return "walk";
  if (name.startsWith("b-")) return "judge";
  if (name.startsWith("v-")) return "verifier";
  if (name.startsWith("a-")) return "finisher";
  return null;
}

/**
 * Count per role which models the agents of a run gave and how often: from the session file of
 * every session, and from the answers of the gate. The toolbox cannot check any of it; it keeps
 * what each agent said. Roles without an agent are left out, so a run without sessions gives an empty list.
 */
export async function reportedModels(runDir: string): Promise<RoleModels[]> {
  const given = new Map<AgentRole, (string | null)[]>();
  const add = (role: AgentRole, model: string | null): void => void given.set(role, [...(given.get(role) ?? []), model]);
  const sessions = join(runDir, "observations");
  for (const name of existsSync(sessions) ? (await readdir(sessions)).sort() : []) {
    const role = roleOfSession(name);
    const file = join(sessions, name, "session.json");
    if (!role || !existsSync(file)) continue;
    const session = await readJson<{ models?: unknown }>(file).catch(() => null);
    const models = (Array.isArray(session?.models) ? session.models : []).map(cleanModel).filter((model): model is string => model !== null);
    // A session that was started again on another model counts once for each.
    if (models.length === 0) add(role, null);
    else for (const model of new Set(models)) add(role, model);
  }
  const gate = join(runDir, "gate");
  for (const name of existsSync(gate) ? (await readdir(gate)).sort() : []) {
    if (!/^answers(-\d+)?\.json$/.test(name)) continue;
    const answers = await readJson<{ model?: unknown }>(join(gate, name)).catch(() => null);
    if (answers !== null && typeof answers === "object") add("gate", cleanModel(answers.model));
  }
  return ROLE_ORDER.filter((role) => given.has(role)).map((role) => {
    const entries = given.get(role)!;
    const counts = new Map<string, number>();
    for (const model of entries) if (model !== null) counts.set(model, (counts.get(model) ?? 0) + 1);
    return {
      role,
      roleNl: ROLE_NL[role],
      agents: entries.length,
      models: [...counts.entries()].map(([model, agents]) => ({ model, agents })).sort((a, b) => b.agents - a.agents || a.model.localeCompare(b.model)),
      notGiven: entries.filter((model) => model === null).length,
    };
  });
}

/**
 * The identifier of a model inside what an agent wrote, or the text itself when it holds none.
 * Agents describe one model in many ways ("Name 1.2 (name-1-2[1m])", "name-1-2[1m] (Name 1.2)");
 * the identifier, a hyphenated token with a digit, is the part they share.
 */
export function modelKey(text: string): string {
  const tokens = text.match(/[a-z][a-z0-9.]*(?:-[a-z0-9.]+)+(?:\[[a-z0-9]+\])?/gi) ?? [];
  return (tokens.find((token) => /\d/.test(token)) ?? text.replace(/\s+/g, " ").trim()).toLowerCase();
}

/** How the report says what the agents gave: one line per role, or one line when every agent named the same model, and whether the operator named another. */
export function modelsNl(operator: string, roles: RoleModels[] | undefined): { perRoleNl: string[]; differsNl: string | null } | null {
  if (!roles || roles.length === 0) return null;
  const times = (count: number): string => `${count} keer`;
  // Different spellings of one model count as one.
  const merged = roles.map((entry) => {
    const counts = new Map<string, number>();
    for (const item of entry.models) {
      const key = item.model === MODEL_UNKNOWN ? MODEL_UNKNOWN : modelKey(item.model);
      counts.set(key, (counts.get(key) ?? 0) + item.agents);
    }
    return { ...entry, models: [...counts.entries()].map(([model, agents]) => ({ model, agents })).sort((a, b) => b.agents - a.agents || a.model.localeCompare(b.model)) };
  });
  const named = merged.flatMap((entry) => entry.models).filter((item) => item.model !== MODEL_UNKNOWN);
  const distinct = new Set(merged.flatMap((entry) => entry.models).map((item) => item.model));
  const everyoneSame = distinct.size === 1 && !distinct.has(MODEL_UNKNOWN) && merged.every((entry) => entry.notGiven === 0);
  const perRoleNl = everyoneSame
    ? [`Alle rollen: ${[...distinct][0]} (${times(named.reduce((sum, item) => sum + item.agents, 0))})`]
    : merged.map((entry) => {
        const parts = [...entry.models.map((item) => `${item.model} (${times(item.agents)})`), ...(entry.notGiven > 0 ? [`niet opgegeven (${times(entry.notGiven)})`] : [])];
        return `${entry.roleNl[0]!.toUpperCase()}${entry.roleNl.slice(1)}: ${parts.join(", ")}`;
      });
  const others = named.filter((item) => item.model !== modelKey(operator));
  // Without a name from the operator there is nothing to differ from.
  const differsNl =
    cleanModel(operator) === null || operator.trim().toLowerCase() === "niet opgegeven" || others.length === 0
      ? null
      : `De uitvoerder gaf ${operator.trim()} op. Dat verschilt van wat de agents opgaven: ${[...new Set(others.map((item) => item.model))].sort().join(", ")} (${times(others.reduce((sum, item) => sum + item.agents, 0))} van de ${named.reduce((sum, item) => sum + item.agents, 0)} opgaven met een naam).`;
  return { perRoleNl, differsNl };
}
