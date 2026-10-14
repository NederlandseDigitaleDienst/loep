import type { Page } from "playwright";
import type { MethodFailure, MethodResult } from "../methods.ts";
import { ensureHelpers } from "./capsule.ts";
import { idOf, knownError, runMethod, sortRan, type BrowserVersions } from "./registry.ts";

/** Below this many words a detector guesses; the answer is then "cannot tell", not a language. */
export const MIN_WORDS = 5;
/** From this many words on, two detectors that are sure of another language are a difference worth reporting. */
export const SURE_WORDS = 12;

export interface Detected {
  /** ISO 639-1 code, or null when the text is too short or the detector is not sure. */
  language: string | null;
  /** The detector's best guess, also when it is not sure enough to count. */
  guess: string | null;
  reliable: boolean;
  reason?: string;
}

export interface LanguagePiece {
  where: string;
  path?: string[];
  declared: string | null;
  ownAttribute: boolean;
  text: string;
  words: number;
}

type Detector = (text: string) => { language: string; reliable: boolean };
const detectors: Partial<Record<"eld" | "cld3", Promise<Detector>>> = {};

function detector(id: "eld" | "cld3"): Promise<Detector> {
  detectors[id] ??= (async (): Promise<Detector> => {
    if (id === "eld") {
      const { eld } = (await import("eld/large")) as unknown as { eld: { detect: (text: string) => { language: string; isReliable: () => boolean } } };
      return (text) => {
        const found = eld.detect(text);
        return { language: found.language, reliable: found.isReliable() };
      };
    }
    const { loadModule } = (await import("cld3-asm")) as unknown as { loadModule: () => Promise<{ create: (min: number, max: number) => { findLanguage: (text: string) => { language: string; is_reliable: boolean } } }> };
    const identifier = (await loadModule()).create(0, 1000);
    return (text) => {
      const found = identifier.findLanguage(text);
      return { language: found.language, reliable: found.is_reliable };
    };
  })();
  return detectors[id]!;
}

const primary = (code: string | null): string | null => (code ? code.toLowerCase().split(/[-_]/)[0]! || null : null);

function detect(run: Detector, piece: LanguagePiece): Detected {
  if (piece.words < MIN_WORDS) return { language: null, guess: null, reliable: false, reason: `te kort: ${piece.words} ${piece.words === 1 ? "woord" : "woorden"}` };
  const found = run(piece.text);
  const guess = primary(found.language === "und" ? null : found.language);
  if (!found.reliable || !guess) return { language: null, guess, reliable: false, reason: "de herkenning is niet zeker" };
  return { language: guess, guess, reliable: true };
}

export interface LanguageAnswer {
  /** The detected language per piece, in the order of the pieces. */
  detected: Detected[];
}

export type LanguageVerdict = "match" | "mismatch" | "cantTell" | "undeclared";

export interface PieceVerdict extends LanguagePiece {
  verdict: LanguageVerdict;
  /** What each method detected for this piece. */
  detected: Record<string, string | null>;
  reason?: string;
}

/** The declared language of the page or one element with the text it covers, and the pieces of the page that can be checked on their own. */
export async function languagePieces(page: Page, where: string | null, maxBlocks: number): Promise<{ subject: LanguagePiece; blocks: LanguagePiece[] }> {
  await ensureHelpers(page);
  const found = await page.evaluate(
    ([target, max]) => {
      const helpers = (window as unknown as { __loepm: { languageOf: (target: string | null) => LanguagePiece | null; languageBlocks: (max: number) => LanguagePiece[] } }).__loepm;
      return { subject: helpers.languageOf(target as string | null), blocks: target === null ? helpers.languageBlocks(max as number) : [] };
    },
    [where, maxBlocks] as const,
  );
  if (!found.subject) throw new Error("het element is van de pagina verdwenen");
  return { subject: found.subject, blocks: found.blocks };
}

/** Detect the language of every piece with both detectors, each on its own. */
export async function detectLanguages(pieces: LanguagePiece[], browsers: BrowserVersions): Promise<{ methods: MethodResult<LanguageAnswer>[]; failed: MethodFailure[] }> {
  const ran = [];
  for (const id of ["eld", "cld3"] as const) {
    ran.push(
      await runMethod(id, browsers, async () => {
        const run = await detector(id);
        return { detected: pieces.map((piece) => detect(run, piece)) };
      }),
    );
  }
  return sortRan(ran);
}

/**
 * Set the declared language of each piece against what was detected. A mismatch needs both
 * detectors to be sure and to say the same; anything less is "cannot tell".
 */
export function languageVerdicts(pieces: LanguagePiece[], methods: MethodResult<LanguageAnswer>[]): PieceVerdict[] {
  return pieces.map((piece, index) => ({ ...piece, ...verdictOf(piece.declared, methods.map((method) => ({ id: idOf(method), answer: method.result.detected[index]! }))) }));
}

/** The declared language of one piece against what each detector found: a mismatch needs both to be sure and to agree. */
function verdictOf(declaredLang: string | null, answers: { id: string; answer: Detected }[]): { verdict: LanguageVerdict; detected: Record<string, string | null>; reason?: string } {
  const detected = Object.fromEntries(answers.map(({ id, answer }) => [id, answer.language ?? null]));
  const declared = primary(declaredLang);
  const languages = [...new Set(answers.map(({ answer }) => answer.language))];
  let verdict: LanguageVerdict;
  let reason: string | undefined;
  if (answers.length === 0 || languages.includes(null)) {
    verdict = "cantTell";
    reason = answers.find(({ answer }) => answer.reason)?.answer.reason ?? "geen herkenning beschikbaar";
  } else if (languages.length > 1) {
    verdict = "cantTell";
    reason = `de methoden herkennen een andere taal: ${answers.map(({ id, answer }) => `${id} ${answer.language}`).join(", ")}`;
  } else if (!declared) verdict = "undeclared";
  else verdict = languages[0] === declared ? "match" : "mismatch";
  return { verdict, detected, ...(reason ? { reason } : {}) };
}

/**
 * The language of loose pieces of text, such as text alternatives and names, recorded by the
 * sweep: both detectors on each piece, with the same rules as `loep lang`. A detector that
 * cannot be loaded on this machine is left out, and the pieces are then "cannot tell".
 */
export async function languageOfPieces<T extends { text: string; words: number; declared: string | null }>(pieces: T[]): Promise<(T & { verdict: LanguageVerdict; detected: Record<string, string | null>; reason?: string })[]> {
  const loaded: { id: string; run: Detector }[] = [];
  for (const id of ["eld", "cld3"] as const) {
    const run = await detector(id).catch(() => null);
    if (run) loaded.push({ id, run });
  }
  return pieces.map((piece) => ({ ...piece, ...verdictOf(piece.declared, loaded.map(({ id, run }) => ({ id, answer: detect(run, { where: "", declared: piece.declared, ownAttribute: false, text: piece.text, words: piece.words }) }))) }));
}

/** Where the two detectors, both sure of themselves, name another language for the same piece. */
export function languageDifferences(pieces: LanguagePiece[], methods: MethodResult<LanguageAnswer>[]): string[] {
  const differences: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    // On a short piece two detectors that name another language are both guessing; the piece is "cannot tell" and that is all. The subject itself always counts.
    if (index > 0 && piece.words < SURE_WORDS) continue;
    const sure = methods.map((method) => ({ id: idOf(method), language: method.result.detected[index]?.language ?? null })).filter((answer) => answer.language !== null);
    if (new Set(sure.map((answer) => answer.language)).size > 1) differences.push(`${piece.where}: ${sure.map((answer) => `${answer.id} ${answer.language}`).join(", ")}`);
  }
  return differences;
}

/** eld takes Frisian for Dutch: on a piece declared as Frisian its answer is marked. */
export function markKnownLanguages(pieces: LanguagePiece[], methods: MethodResult<LanguageAnswer>[]): void {
  const eld = methods.find((method) => idOf(method) === "eld");
  if (eld && pieces.some((piece, index) => primary(piece.declared) === "fy" && eld.result.detected[index]?.guess === "nl")) eld.knownUnreliable = knownError("eld", "frisian");
}
