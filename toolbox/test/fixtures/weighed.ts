import assert from "node:assert/strict";
import type { Evaluation } from "../../src/lib/evaluation.ts";
import { EVERYONE, groupsFor } from "../../src/lib/groups.ts";
import { applyWeighing, criterionGroups, MEASURED_LIMIT, validateWeighing, type Affected, type Weighing, type WeighingProposal } from "../../src/lib/weighing.ts";

export const WEIGHED_TASKS = [
  { id: "aanvragen", nameNl: "Een vergunning aanvragen" },
  { id: "contact", nameNl: "Contact opnemen" },
];

/**
 * An evaluation with defects, weighed as the step would do it. The findings take turns, so the
 * report shows every case: a group stopped at a core task, a detour at every task, more effort
 * with a fact that is missing, a group that can not use a part no task needs, and no group
 * hindered. The first finding also costs everyone effort, and two findings at every task stop a
 * group together.
 */
export function weighed(evaluation: Evaluation): Evaluation {
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const TEXT = "Ze gaan met de schermlezer van kop naar kop door de pagina. Het onderdeel heeft geen naam, dus ze weten niet wat het is.";
  const entries = findings.map((finding, index): { finding: string } & Weighing => {
    const [first, second] = criterionGroups(finding.criterion);
    const turn = index % 4;
    if (turn === 3 && !MEASURED_LIMIT.has(finding.criterion)) return { finding: finding.id, task: null, affected: [], unaffected: groupsFor(finding.criterion)!.primary.map((group) => ({ group, sameNl: "Ze krijgen langs de eigen weg dezelfde tekst te horen of te zien." })) };
    // Every second time the turn of "more effort" comes, a group can not use the part and no task needs it.
    const beside = index % 8 === 6;
    return {
      finding: finding.id,
      task: turn === 0 ? "aanvragen" : turn === 1 ? "all" : null,
      ...(turn === 0 ? { blocksNl: "Zonder dit onderdeel is de aanvraag niet te versturen." } : {}),
      ...(beside ? { withoutNl: "Zonder dit onderdeel is de aanvraag nog te versturen en is contact nog op te nemen." } : {}),
      affected: [
        { group: first!, consequence: turn === 0 || beside ? "cannot" : turn === 1 ? "detour" : "effort", textNl: TEXT },
        // Next to everyone a group stands only when it is hit harder, so the first finding names one group and everyone.
        ...(second && index !== 0 ? [{ group: second, consequence: "effort", textNl: "Ze vergroten de pagina en volgen de focus. Het onderdeel valt weg tegen de achtergrond en kost tijd om te vinden" } satisfies Affected] : []),
        ...(index === 0 ? [{ group: EVERYONE, consequence: "effort", textNl: "Ze klikken op het onderdeel om verder te gaan. Er gebeurt pas bij de tweede klik iets." } satisfies Affected] : []),
      ],
      ...(turn === 2 && !beside ? { unsureNl: "Of dezelfde tekst ook elders op de pagina staat, is niet bekend." } : {}),
    };
  });
  // Two findings at every task that both give one group a detour or more effort: together they stop it.
  const everywhere = entries.filter((entry) => entry.task === "all");
  const shared = everywhere
    .flatMap((a, index) => everywhere.slice(index + 1).map((b) => ({ a, b, group: a.affected.map((entry) => entry.group).find((group) => b.affected.some((entry) => entry.group === group)) })))
    .find((pair) => pair.group !== undefined);
  const proposal: WeighingProposal = {
    tasks: WEIGHED_TASKS,
    findings: entries,
    together: shared ? [{ task: "all", group: shared.group!, findings: [shared.a.finding, shared.b.finding], stopsNl: "Na de eerste omweg stuiten ze op het tweede onderdeel, en daarna is er geen weg meer naar het formulier." }] : [],
  };
  assert.deepEqual(validateWeighing(proposal, evaluation), []);
  evaluation.weighing = { status: "applied", tasks: WEIGHED_TASKS, together: proposal.together, ...applyWeighing(evaluation, proposal) };
  return evaluation;
}
