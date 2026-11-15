// Fixed specs per model, from Anthropic's model table (cached 2026-11-03).
// Prices are first-party USD per million tokens. Update when new models ship.
export type ModelSpec = {
  name: string
  contextWindow: number
  maxOutput: number
  priceIn: number
  priceOut: number
}

const M = 1_000_000
const K = 1_000

export const MODELS: Record<string, ModelSpec> = {
  'claude-fable-5-2': { name: 'Fable 5.2', contextWindow: M, maxOutput: 128 * K, priceIn: 8, priceOut: 40 },
  'claude-fable-5-1': { name: 'Fable 5.1', contextWindow: M, maxOutput: 128 * K, priceIn: 10, priceOut: 50 },
  'claude-fable-5': { name: 'Fable 5', contextWindow: M, maxOutput: 128 * K, priceIn: 10, priceOut: 50 },
  'claude-opus-5-5': { name: 'Opus 5.5', contextWindow: M, maxOutput: 128 * K, priceIn: 4, priceOut: 20 },
  'claude-opus-5': { name: 'Opus 5', contextWindow: M, maxOutput: 128 * K, priceIn: 5, priceOut: 25 },
  'claude-opus-4-8': { name: 'Opus 4.8', contextWindow: M, maxOutput: 128 * K, priceIn: 5, priceOut: 25 },
  'claude-opus-4-7': { name: 'Opus 4.7', contextWindow: M, maxOutput: 128 * K, priceIn: 5, priceOut: 25 },
  'claude-opus-4-6': { name: 'Opus 4.6', contextWindow: M, maxOutput: 128 * K, priceIn: 5, priceOut: 25 },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5', contextWindow: M, maxOutput: 128 * K, priceIn: 2, priceOut: 10 },
  'claude-sonnet-5': { name: 'Sonnet 5', contextWindow: M, maxOutput: 128 * K, priceIn: 2, priceOut: 10 },
  'claude-sonnet-4-6': { name: 'Sonnet 4.6', contextWindow: M, maxOutput: 128 * K, priceIn: 3, priceOut: 15 },
  'claude-haiku-5-5': { name: 'Haiku 5.5', contextWindow: M, maxOutput: 128 * K, priceIn: 0.1, priceOut: 0.5 },
  'claude-haiku-4-5': { name: 'Haiku 4.5', contextWindow: 200 * K, maxOutput: 64 * K, priceIn: 1, priceOut: 5 },
}

// Matches ids with provider prefixes, date suffixes or a [1m] tag,
// e.g. "us.anthropic.claude-opus-5-5", "claude-haiku-4-5-20251001".
export function lookupModel(id: string): ModelSpec | undefined {
  const clean = id.toLowerCase().replace(/\[.*?\]/g, '')
  let best: string | undefined
  for (const key of Object.keys(MODELS)) {
    if (clean.includes(key) && (!best || key.length > best.length)) best = key
  }
  return best ? MODELS[best] : undefined
}
