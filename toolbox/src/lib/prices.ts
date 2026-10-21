/** Tokens of one agent or of a group of agents, by kind: each kind has its own price. */
export interface Tokens {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** Dollars per million tokens. */
export type Price = Tokens;

/**
 * The API prices per model, in dollars per million tokens, as validatie/verbruik/README.md counts
 * with them. Writing to the cache is the price for 5 minutes. A price changes; the date says when
 * these were read, and a usage file can bring its own (`prices` in `loep/verbruik/1`). Haiku has
 * none here: above 100,000 tokens in one turn it costs more, which totals per agent cannot tell.
 */
export const PRICES_SOURCE = { date: "2026-10-19", url: "https://platform.claude.com/docs/en/about-claude/pricing" } as const;
export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  // Half of Opus in every kind.
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
};

export const totalTokens = (tokens: Tokens): number => tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output;

export function costOf(tokens: Tokens, price: Price): number {
  return (tokens.input * price.input + tokens.cacheWrite * price.cacheWrite + tokens.cacheRead * price.cacheRead + tokens.output * price.output) / 1_000_000;
}
