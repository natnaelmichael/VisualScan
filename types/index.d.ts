export type ActionKind =
  | 'inference'
  | 'thinking'
  | 'responding'
  | 'codegen'
  | 'websearch'
  | 'tool'
  | 'subagent'
  | 'compaction'
  | 'finished'

export type TestResult = {
  passed: number
  total: number
  durationMs?: number
  /** A CI run still going: the numbers so far. */
  running?: boolean
  source: 'ci' | 'local'
  /** `tests` when real test counts were found, `checks` for CI jobs/checks. */
  unit: 'tests' | 'checks'
}

export type LanguageShare = { name: string; lines: number; percent: number }

export type Snapshot = {
  version: 1
  updatedAt: number
  model: {
    id: string
    name: string
    effort?: string
    contextWindow?: number
    maxOutput?: number
    priceIn?: number
    priceOut?: number
  } | null
  context: { used?: number; total?: number; percent?: number } | null
  cost: { usd: number } | null
  tokens: {
    inputPerSec: number
    inputPerSecPeak: number
    outputPerSec: number
    history: number[]
    totals: { input: number; cacheRead: number; cacheWrite: number; output: number; requests: number }
  }
  action: { kind: ActionKind; label: string; tool?: string; since: number }
  project: { tests: TestResult | null; languages: LanguageShare[] | null }
}

declare module 'claude-code' {
  interface PluginState {
    visualscan: { snapshot: Shaped<Snapshot | null> }
  }
}
