import type { Terminal } from "../../src/lib/recorded.ts";

/*
 * A person at an interactive terminal, played by a test. The commands take the terminal as an
 * argument; from the command line they always get the real one, where only an interactive stdin
 * counts. Every test that records a statement passes one of these, so that a test run in a real
 * terminal never waits for input.
 */

export interface PlayedTerminal extends Terminal {
  /** Everything that was shown to the person, in order. */
  asked: string[];
}

export function playedTerminal(answer: (textNl: string) => string): PlayedTerminal {
  const asked: string[] = [];
  return {
    interactive: true,
    asked,
    async ask(textNl) {
      asked.push(textNl);
      return answer(textNl);
    },
  };
}

/** A person who says yes: for answer and decide. */
export const saysYes = (): PlayedTerminal => playedTerminal(() => "ja");

/** A signer who reads the seal that is shown and types its first eight characters. */
export const typesSeal = (): PlayedTerminal => playedTerminal((textNl) => /^Zegel: ([0-9a-f]{64})$/m.exec(textNl)![1]!.slice(0, 8));

/** No interactive terminal, as for an agent: asking anything is a failure of the test. */
export const noTerminal: Terminal = {
  interactive: false,
  ask: () => Promise.reject(new Error("a command asked for input where there is no interactive terminal")),
};
