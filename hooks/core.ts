import type { ActionKind } from '../types'

// ---------- Actions ----------

export type Action = { kind: ActionKind; label: string; tool?: string }

const CODEGEN = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const WEB = new Set(['WebSearch', 'WebFetch', 'web_search', 'web_fetch'])
const SUBAGENT = new Set(['Agent', 'Task'])

/**
 * The label shown for each non-tool state: the engine's own names.
 * `thinking` / `text` are the stream's chunk kinds, `turn.step` is a model
 * request waiting for its first chunk, `session.compact` the compaction
 * event. `Finished` is the one hand-written label. Tools show their raw name.
 */
export const RAW: Record<'thinking' | 'responding' | 'inference' | 'compaction' | 'finished', string> = {
  thinking: 'thinking',
  responding: 'text',
  inference: 'turn.step',
  compaction: 'session.compact',
  finished: 'Finished',
}

/** A tool shows its raw engine name; its kind is kept for colouring. */
export function toolAction(name: string): Action {
  if (CODEGEN.has(name)) return { kind: 'codegen', label: name, tool: name }
  if (WEB.has(name)) return { kind: 'websearch', label: name, tool: name }
  if (SUBAGENT.has(name)) return { kind: 'subagent', label: name, tool: name }
  return { kind: 'tool', label: name, tool: name }
}

type Stream = { kind: 'thinking' | 'responding' } | { kind: 'tool'; name: string }

/**
 * Tracks what the main loop is doing. Priority:
 * Compaction > running tool > what is streaming > Inference (turn active) > Finished.
 */
export class Tracker {
  compacting = 0
  tools = new Map<string, string>() // tool_use_id -> tool name, insertion-ordered
  stream: Stream | null = null
  turnActive = false

  action(): Action {
    if (this.compacting > 0) return { kind: 'compaction', label: RAW.compaction }
    if (this.tools.size > 0) {
      // The newest running call wins: a subagent's own tools beat its Agent call.
      const names = [...this.tools.values()]
      return toolAction(names[names.length - 1] ?? 'unknown')
    }
    if (this.stream) {
      if (this.stream.kind === 'tool') return toolAction(this.stream.name)
      return { kind: this.stream.kind, label: RAW[this.stream.kind] }
    }
    if (this.turnActive) return { kind: 'inference', label: RAW.inference }
    return { kind: 'finished', label: RAW.finished }
  }
}

// ---------- Token rate ----------

/** Tokens per 1-second bucket, with spreading over a time span. */
export class Rate {
  buckets = new Map<number, number>()

  /** Spread `tokens` evenly over [startMs, endMs). Negative tokens correct an estimate. */
  add(startMs: number, endMs: number, tokens: number): void {
    if (!tokens || !Number.isFinite(tokens)) return
    if (endMs <= startMs) {
      this.bump(Math.floor(startMs / 1000), tokens)
      return
    }
    const span = endMs - startMs
    for (let s = Math.floor(startMs / 1000); s * 1000 < endMs; s++) {
      const from = Math.max(startMs, s * 1000)
      const to = Math.min(endMs, (s + 1) * 1000)
      if (to > from) this.bump(s, (tokens * (to - from)) / span)
    }
  }

  private bump(sec: number, n: number): void {
    this.buckets.set(sec, Math.max(0, (this.buckets.get(sec) ?? 0) + n))
  }

  /** Average tokens/sec over the `windowSec` seconds ending at `nowMs`'s second. */
  perSec(nowMs: number, windowSec = 4): number {
    const now = Math.floor(nowMs / 1000)
    let sum = 0
    for (let s = now - windowSec + 1; s <= now; s++) sum += this.buckets.get(s) ?? 0
    return sum / windowSec
  }

  /** The smoothed rate for each of the last `n` seconds, oldest first. */
  history(nowMs: number, n = 60, windowSec = 4): number[] {
    const out: number[] = []
    for (let i = n - 1; i >= 0; i--) out.push(Math.round(this.perSec(nowMs - i * 1000, windowSec)))
    return out
  }

  prune(nowMs: number, keepSec = 180): void {
    const min = Math.floor(nowMs / 1000) - keepSec
    for (const s of this.buckets.keys()) if (s < min) this.buckets.delete(s)
  }
}

// ---------- Drawing helpers ----------

const BARS = '▁▂▃▄▅▆▇█'

export type GraphCell = { ch: string; isBaseline: boolean }

/**
 * A bar graph `rows` tall and `width` wide, newest value on the right, top
 * row first. It always draws: a zero shows a baseline in the bottom row, and
 * missing history on the left pads with zeros. Non-zero values show at least
 * two eighths, so they never look like the baseline.
 */
export function graphRows(values: number[], width: number, rows: number): GraphCell[][] {
  const w = Math.max(1, width)
  const vals = values.slice(-w)
  while (vals.length < w) vals.unshift(0)
  const max = Math.max(...vals, 1)
  const levels = rows * 8
  const heights = vals.map(v => (v <= 0 ? 0 : Math.max(2, Math.round((v / max) * levels))))
  const out: GraphCell[][] = []
  for (let r = rows - 1; r >= 0; r--) {
    out.push(
      heights.map(h => {
        const fill = Math.max(0, Math.min(8, h - r * 8))
        if (fill === 0) return r === 0 ? { ch: '▁', isBaseline: true } : { ch: ' ', isBaseline: false }
        return { ch: BARS[fill - 1] ?? '█', isBaseline: false }
      }),
    )
  }
  return out
}

export function bar(fraction: number, width: number): { filled: string; empty: string } {
  const f = Math.max(0, Math.min(1, fraction))
  const full = Math.round(f * width)
  return { filled: '█'.repeat(full), empty: '░'.repeat(width - full) }
}

export function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–'
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 1_000) return `${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`
  return `${Math.round(n)}`
}
