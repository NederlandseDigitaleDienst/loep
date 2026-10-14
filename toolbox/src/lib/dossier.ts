import { COUNT_UNIT_NL, EXTRACTORS } from "./extractors.ts";
import type { Procedure } from "./procedures.ts";
import type { RunData } from "./rundata.ts";
import { criterionById } from "./wcag.ts";
import { loginNl } from "./login.ts";
import { WRITES_BLOCKED_NL, writesAllowedNl } from "./writes.ts";

/** Everything the scripts gathered that bears on one criterion. Nothing here judges anything. */
export function buildDossier(run: RunData, procedure: Procedure): Record<string, unknown> {
  const criterion = criterionById(procedure.id)!;
  const evidence: Record<string, unknown> = {};
  for (const name of procedure.evidence) {
    // A run without documents gets the dossier it always had.
    if (name === "documents" && (run.documents ?? []).length === 0) continue;
    evidence[name] = EXTRACTORS[name]!(run, procedure.id);
  }
  const counted = run.inventory.pages.length;
  const zero = procedure.inapplicableIfZero.map((key) => ({ key, total: run.inventory.totals[key] ?? 0, onPages: run.inventory.pages.filter((page) => typeof page.counts[key] === "number" && (page.counts[key] as number) > 0).length, ofPages: counted }));
  return {
    criterion: { id: criterion.id, titleNl: criterion.titleNl, level: criterion.level },
    site: { baseUrl: run.inventory.baseUrl, pagesInSample: run.pages.length, sampleMethod: run.sample.method, sampleNote: run.sample.note },
    // Whether the run may submit: what only shows after sending is out of reach only when it may not.
    writes: run.writes
      ? { allowed: true, origin: run.writes.origin, declaredBy: run.writes.declaredBy ? run.writes.declaredBy.role : null, noteNl: writesAllowedNl(run.writes) }
      : { allowed: false, origin: null, declaredBy: null, noteNl: WRITES_BLOCKED_NL },
    // Only in a run with a login: the role of the test account, never who it is or how it got in.
    ...(run.login ? { login: { role: run.login.role, noteNl: `${loginNl(run.login)}.` } } : {}),
    legend: EXTRACTORS.legend!(run, procedure.id),
    // Only when the states of the site model were measured.
    ...(run.siteModel && run.siteStates ? { siteStates: EXTRACTORS.siteStates!(run, procedure.id) } : {}),
    ...(zero.length > 0
      ? { inventoryForApplicability: { note: "Tellingen over alle pagina's van de site. Alleen als alles nul is, kan 'niet van toepassing' overwogen worden.", unitNl: COUNT_UNIT_NL, counts: zero, allZero: zero.every((entry) => entry.total === 0) } }
      : {}),
    evidence,
  };
}
