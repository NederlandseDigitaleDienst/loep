import type { Page } from "playwright";
import { call } from "../browser/call.ts";
import { languageOfPieces, MIN_WORDS, type LanguageVerdict } from "./methods/lang.ts";

/** One piece of text with the language that holds for it in the code and what the two detectors found. */
export interface LanguagePieceFound {
  /** "alt", "aria-label", "title", "aria-description", "svg-title", "value", "placeholder", or "tekst" for a block of visible text. */
  kind: string;
  text: string;
  words: number;
  /** The lang that holds for the element: its own attribute or that of the nearest element around it. */
  declared: string | null;
  tag: string;
  region: string | null;
  path: string[];
  verdict: LanguageVerdict;
  detected: Record<string, string | null>;
  reason?: string;
}

export interface LanguagesFound {
  /** The detectors judge a piece from this many words on; a shorter piece is read by a person. */
  minWords: number;
  /** Text alternatives and names that are no visible text. */
  textAlternatives: LanguagePieceFound[];
  /** In a state of the site model: the blocks of visible text, with what the opened component shows among them. */
  textBlocks?: LanguagePieceFound[];
}

/**
 * The language of what assistive technology reads and a sighted user does not see as text (text
 * alternatives, aria-label, titles), and in a state also of the visible text: each piece with the
 * lang that holds for it and what two detectors found (WCAG 3.1.2). Nothing is judged.
 */
export async function languagesOf(page: Page, options: { blocks: boolean }): Promise<LanguagesFound> {
  type Piece = Omit<LanguagePieceFound, "verdict" | "detected" | "reason">;
  const alternatives = await languageOfPieces(await call<Piece[]>(page, "textAlternatives"));
  const blocks = options.blocks ? await languageOfPieces(await call<Piece[]>(page, "textBlocksWithLang", 300)) : null;
  return { minWords: MIN_WORDS, textAlternatives: alternatives, ...(blocks ? { textBlocks: blocks } : {}) };
}
