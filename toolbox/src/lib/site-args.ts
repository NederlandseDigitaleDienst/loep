/*
 * A step of an investigation takes the site of the backlog where it takes a run: `loep audit answer
 * voorbeeld.nl`. To find that word on a command line, the words that are the value of an option have to
 * be left out: `loep audit tasks --only P1` names no site, and `loep audit collect --at-once 3
 * voorbeeld.nl` names one, after the value of `--at-once`.
 */

export interface WordInLine {
  /** Where the word stands in the arguments the caller got, so the caller can replace it. */
  at: number;
  word: string;
}

/**
 * The words of a command line that are not an option and not the value of one: the command itself, and
 * what a person typed after it. A `--` ends the options: what follows is taken as a word, as `parseArgs`
 * does.
 */
export function positionalsOf(args: string[], valueFlags: ReadonlySet<string>): WordInLine[] {
  const words: WordInLine[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === "--") {
      for (let rest = at + 1; rest < args.length; rest += 1) words.push({ at: rest, word: args[rest]! });
      return words;
    }
    // `--name=value` carries its own value; `--name value` and `-n value` do not.
    if (arg.startsWith("--")) {
      const name = arg.slice(2).split("=")[0]!;
      if (!arg.includes("=") && valueFlags.has(name)) at += 1;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      if (valueFlags.has(arg.slice(1))) at += 1;
      continue;
    }
    words.push({ at, word: arg });
  }
  return words;
}
