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
 * with a fact that is missing, and no group hindered. The first finding also hinders everyone.
 */
export function weighed(evaluation: Evaluation): Evaluation {
  const findings = evaluation.criteria.flatMap((criterion) => criterion.findings);
  const proposal: WeighingProposal = {
    tasks: WEIGHED_TASKS,
    findings: findings.map((finding, index): { finding: string } & Weighing => {
      const [first, second] = criterionGroups(finding.criterion);
      const turn = index % 4;
      if (turn === 3 && !MEASURED_LIMIT.has(finding.criterion)) return { finding: finding.id, task: null, affected: [], unaffected: groupsFor(finding.criterion)!.primary.map((group) => ({ group, sameNl: "Krijgt langs de eigen weg dezelfde tekst te horen of te zien." })) };
      return {
        finding: finding.id,
        task: turn === 0 ? "aanvragen" : turn === 1 ? "all" : null,
        ...(turn === 0 ? { blocksNl: "Zonder dit onderdeel is de aanvraag niet te versturen." } : {}),
        affected: [
          { group: first!, consequence: turn === 0 ? "cannot" : turn === 1 ? "detour" : "effort", textNl: "Ze gaan met de schermlezer van kop naar kop door de pagina. Het onderdeel heeft geen naam, dus ze weten niet wat het is." },
          ...(second ? [{ group: second, consequence: "effort", textNl: "Ze vergroten de pagina en volgen de focus. Het onderdeel valt weg tegen de achtergrond en kost tijd om te vinden." } satisfies Affected] : []),
          ...(index === 0 ? [{ group: EVERYONE, consequence: "detour", textNl: "Ze klikken op het onderdeel om verder te gaan. Er gebeurt niets, en ze moeten een andere weg zoeken." } satisfies Affected] : []),
        ],
        ...(turn === 2 ? { unsureNl: "Of dezelfde tekst ook elders op de pagina staat, is niet bekend." } : {}),
      };
    }),
  };
  assert.deepEqual(validateWeighing(proposal, evaluation), []);
  evaluation.weighing = { status: "applied", tasks: WEIGHED_TASKS, ...applyWeighing(evaluation, proposal) };
  return evaluation;
}
