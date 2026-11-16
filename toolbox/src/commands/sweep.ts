/**
 * `sweep`: the four commands of the sweep in their order, as one command. Someone who ran them by
 * hand could leave one out, and the gate then let a run through without its documents (#598 holds
 * such a run back; this takes the cause away). Each command stays as it is and can still be run alone.
 */
import { collect } from "./collect.ts";
import { contrast } from "./contrast.ts";
import { documents } from "./documents.ts";
import { states } from "./states.ts";

export const SWEEP_STEPS = ["collect", "contrast", "states", "documents"] as const;
export type SweepStep = (typeof SWEEP_STEPS)[number];

export interface SweepOptions {
  run: string;
  fresh?: boolean | undefined;
  atOnce?: number | undefined;
  /** Only for `collect` alone: the one page to measure. */
  only?: string | undefined;
}

/** One command of the sweep. Returns what it says when it is done, one line each. */
export async function sweepStep(step: SweepStep, options: SweepOptions): Promise<string[]> {
  const { run, fresh } = options;
  const atOnce = options.atOnce ? { atOnce: options.atOnce } : {};
  if (step === "collect") {
    await collect({ run, only: options.only, fresh, atOnce: options.atOnce });
    return [];
  }
  if (step === "contrast") {
    const all = (await contrast(run, { fresh, ...atOnce })).flatMap((page) => page.measurements);
    const count = (outcome: string): number => all.filter((entry) => entry.outcome === outcome).length;
    return [`${all.length} stukken tekst (standaardvenster en 320 breed, licht en donker): ${count("passed")} voldoende, ${count("failed")} onvoldoende, ${count("cantTell")} niet te meten, ${count("exempt")} uitgezonderd`];
  }
  if (step === "states") {
    const result = await states(run, { fresh, ...atOnce });
    const lines = [`${result.examined.triggers} triggers, ${result.dialogs.filter((dialog) => dialog.opened).length} opened something, ${result.examined.forms} forms, ${result.singleKeys.reactions.length} key reactions, ${result.hover.length} hover appearances`];
    // A limit that cut something off is said here too, not only in the dossier.
    const press = result.downEventCoverage;
    if (press) lines.push(`indrukproef: ${press.examined} van ${press.kindsFound} soorten bedieningselementen onderzocht${press.notExamined > 0 ? `, ${press.notExamined} niet (grens ${press.limit})` : ""}`);
    if (result.hoverCoverage?.kinds !== undefined) lines.push(`aanwijzen en focus: ${result.hoverCoverage.found} bedieningselementen in ${result.hoverCoverage.kinds} soorten, ${result.hoverCoverage.examined} aangewezen${result.hoverCoverage.notExamined > 0 ? `, ${result.hoverCoverage.notExamined} soorten niet (grens ${result.hoverCoverage.limit})` : ""}`);
    else if ((result.hoverCoverage?.notExamined ?? 0) > 0) lines.push(`aanwijzen en focus: ${result.hoverCoverage!.notExamined} van ${result.hoverCoverage!.found} bedieningselementen niet onderzocht (grens ${result.hoverCoverage!.limit})`);
    return lines;
  }
  const result = await documents(run);
  return [result.documents === 0 ? "geen documenten in de steekproef" : `${result.documents} documenten: ${result.read} ingelezen, ${result.notRead} van een soort die niet wordt ingelezen, ${result.failed} niet op te halen of te openen`];
}

/**
 * The whole sweep. A command that fails stops it, and the error names the command: what the
 * commands before it measured stays, and a second sweep measures only what is not valid yet.
 */
export async function sweep(options: SweepOptions, say: (line: string) => void, step: (step: SweepStep, options: SweepOptions) => Promise<string[]> = sweepStep): Promise<void> {
  if (options.only !== undefined) throw new Error("sweep meet de hele steekproef. Voor één pagina: collect --run <run> --only <deel van het adres>");
  for (const [position, name] of SWEEP_STEPS.entries()) {
    say(`veegronde, stap ${position + 1} van ${SWEEP_STEPS.length}: ${name}`);
    let lines: string[];
    try {
      lines = await step(name, options);
    } catch (error) {
      throw new Error(`de veegronde stopte bij ${name} (stap ${position + 1} van ${SWEEP_STEPS.length}): ${error instanceof Error ? error.message : String(error)}. Wat de stappen ervoor maten, blijft staan. Draai sweep opnieuw als de oorzaak weg is: het meet dan alleen wat nog niet geldig is`, { cause: error });
    }
    for (const line of lines) say(line);
  }
  say("veegronde klaar: collect, contrast, states en documents hebben gedraaid. Draai nu gate");
}
