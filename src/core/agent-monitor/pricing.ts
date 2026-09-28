/** USD per one million tokens. */
export interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * List prices as of 2025, by model family. A subscription does not bill these; the screen says
 * "API로 썼다면 약 N달러" so the number is understood as an estimate.
 */
const PRICES: Array<[RegExp, Price]> = [
  [/opus/i, { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  [/haiku/i, { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  [/sonnet|claude/i, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/gpt-5.*(mini|nano)|o4-mini|o3-mini/i, { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }],
  [/gpt-4\.1|o3/i, { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }],
  [/gpt|codex|chatgpt|o1/i, { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }],
]

const FALLBACK: Price = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }

export function priceFor(model: string): Price {
  for (const [pattern, price] of PRICES) {
    if (pattern.test(model)) return price
  }
  return FALLBACK
}

/** Estimated USD for one set of token counts. */
export function costOf(model: string, tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const price = priceFor(model)
  return (tokens.input * price.input + tokens.output * price.output + tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1_000_000
}
