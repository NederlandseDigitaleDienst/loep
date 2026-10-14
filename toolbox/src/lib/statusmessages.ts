import type { Candidate } from "./verdict.ts";
import type { RunData } from "./rundata.ts";

/** A message that stood in a status region after a filled-in form was sent (4.1.3). */
export interface StatusMessage {
  text: string;
  /** The role of the region, "status" for an output element; null when only aria-live makes it a region. */
  role: string | null;
  ariaLive: string | null;
  where: string;
  /** How the region was before sending. */
  before: "verborgen" | "leeg" | "andere tekst" | "niet in de pagina" | "nieuw document";
  /** With "verborgen": how, for example "hidden op het gebied". */
  hiddenBefore: string | null;
  /** With "verborgen": the text the hidden region already held in its code. */
  textBefore: string | null;
  /** The focus stands on the region or in it. */
  focusInside: boolean;
}

/** What appeared after a filled-in form was sent, as `statusMessages` in the page reports it. */
export interface MessagesAfterSubmit {
  messages: StatusMessage[];
  /** Visible text that appeared outside every status region. */
  textOutsideRegions: string[];
  /** Where the focus stands after sending, as tag and text. */
  focusAfter: string | null;
}

/**
 * Why a message is a candidate for 4.1.3, or null when it is not. A region that was hidden is
 * the measured case: VoiceOver with Safari said nothing when a hidden region with role status
 * was shown (validatie/voiceover). A region added together with its message is read by part of
 * the assistive technology only, unless it is an alert. The role alone settles neither.
 */
export function whyCandidateNl(message: StatusMessage): string | null {
  if (message.focusInside) return null;
  if (message.before === "verborgen") return `het gebied (rol ${message.role ?? "geen"}${message.ariaLive ? `, aria-live ${message.ariaLive}` : ""}) was voor het versturen verborgen (${message.hiddenBefore}) en werd pas toen zichtbaar`;
  if (message.before === "niet in de pagina" && message.role !== "alert") return `het gebied (rol ${message.role ?? "geen"}${message.ariaLive ? `, aria-live ${message.ariaLive}` : ""}) kwam pas met de melding in de pagina`;
  return null;
}

/**
 * Candidates for 4.1.3 from the sweep: each message after sending a filled-in form whose region
 * was hidden or not in the page before, with the focus elsewhere. The judge listens to them with
 * `loep voiceover`: the role alone is no proof that the message is read. Ids start with "S" for
 * the sweep and are unique in the run.
 */
export function sweepCandidates(run: RunData): Candidate[] {
  const candidates: Candidate[] = [];
  for (const state of run.siteStates?.states ?? []) {
    if (!state.reached) continue;
    const after = run.stateEvidence?.[state.id]?.timeLimitsAfterSubmit;
    if (!after?.submitted || after.navigated || !after.messages) continue;
    const page = run.pages.find((entry) => entry.item.url === state.url)?.label ?? null;
    if (!page) continue;
    for (const message of after.messages.messages) {
      const why = whyCandidateNl(message);
      if (!why) continue;
      candidates.push({
        id: `S-K${String(candidates.length + 1).padStart(2, "0")}`,
        criterion: "4.1.3",
        page,
        where: `"${message.text.slice(0, 80)}" in ${message.where}, na versturen van het ingevulde formulier in toestand ${state.id} (${after.submitControl ?? "verzonden zonder knop"})`,
        evidence: state.files["timeLimitsAfterSubmit"] ? [state.files["timeLimitsAfterSubmit"]] : [],
        noteNl: `De melding verschijnt na versturen, maar ${why}; beluister haar met loep voiceover.`,
        support: "gemeten",
      });
    }
  }
  return candidates;
}
