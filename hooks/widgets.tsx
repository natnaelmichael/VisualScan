import type { EngineInterface } from 'claude-code'

import type { Snapshot } from '../types'
import { bar, fmt, graphRows } from './core'
import { RASTER_KEY, currentCells, frameSize } from './player'
import { languagesLine, testsLine } from './project'
import { theme } from './theme'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/**
 * Each widget's size: `half` / `full` of the pane's width; `fill` is full
 * width and takes every row the other widgets leave.
 */
export type WidgetSize = 'half' | 'full' | 'fill'

export type WidgetDef = {
  id: string
  title: string | ((snap: Snapshot) => string)
  size: WidgetSize
  enabled: boolean
  /** How many body rows the widget draws at this inner width (not for `fill`). */
  lines?: (snap: Snapshot, inner: number) => number
  /** For `fill`: the most rows worth taking at this inner width (the content's aspect). */
  maxRows?: (inner: number) => number | undefined
  body: (ui: Elements, snap: Snapshot, inner: number, rows: number) => unknown
}

/** Rows a widget's frame adds to its body: top and bottom border, title. */
const CHROME_ROWS = 3

const GRAPH_ROWS = 4
const text = theme.text
const muted = theme.muted ?? theme.text

/** Every widget, in display order. Toggling and placement edit this list. */
export const WIDGETS: WidgetDef[] = [
  {
    id: 'model',
    title: 'Model',
    size: 'half',
    enabled: true,
    lines: snap => {
      const m = snap.model
      return 4 + (m ? 1 : 0) + (m?.effort ? 1 : 0) + (m?.maxOutput !== undefined ? 1 : 0) + (m?.priceIn !== undefined ? 1 : 0) + (snap.cost ? 1 : 0)
    },
    body: ({ Box, Text }, snap, inner) => {
      const m = snap.model
      const c = snap.context
      const t = snap.tokens
      const total = c?.total ?? m?.contextWindow
      const frac = total ? (c?.used ?? 0) / total : 0
      const b = bar(frac, Math.max(4, inner - 5))
      return (
        <Box flexDirection="column">
          <Text bold color={text} wrap="truncate">
            {m ? m.name : 'Loading model…'}
          </Text>
          {m && (
            <Text color={muted} wrap="truncate">
              {m.id}
            </Text>
          )}
          {m?.effort && (
            <Text color={text} wrap="truncate">
              Effort: {m.effort}
            </Text>
          )}
          {m?.maxOutput !== undefined && (
            <Text color={text} wrap="truncate">
              Max out: {fmt(m.maxOutput)}
            </Text>
          )}
          {m?.priceIn !== undefined && (
            <Text color={text} wrap="truncate">
              ${m.priceIn} / ${m.priceOut} per M
            </Text>
          )}
          <Text wrap="truncate">
            <Text color={theme.context.fill ?? text}>{b.filled}</Text>
            <Text color={theme.context.empty ?? muted}>{b.empty}</Text>
            <Text color={text}>{` ${Math.round(frac * 100)}%`}</Text>
          </Text>
          <Text color={muted} wrap="truncate">
            {fmt(c?.used)} / {fmt(total)} ctx
          </Text>
          {snap.cost && (
            <Text color={text} wrap="truncate">
              Cost: ${snap.cost.usd.toFixed(2)}
            </Text>
          )}
          <Text color={muted} wrap="truncate">
            {t.totals.requests} req · out {fmt(t.totals.output)}
          </Text>
        </Box>
      )
    },
  },
  {
    id: 'tokens',
    title: 'Tokens consumed / sec',
    size: 'half',
    enabled: true,
    lines: () => GRAPH_ROWS + 2,
    body: ({ Box, Text }, snap, inner) => {
      const t = snap.tokens
      const rows = graphRows(t.history, inner, GRAPH_ROWS)
      const barColor = theme.graph.bar ?? text
      const baseColor = theme.graph.baseline ?? muted
      return (
        <Box flexDirection="column">
          {rows.map((row, i) =>
            i === rows.length - 1 ? (
              <Text>
                {row.map(cell => (
                  <Text color={cell.isBaseline ? baseColor : barColor}>{cell.ch}</Text>
                ))}
              </Text>
            ) : (
              <Text color={barColor}>{row.map(cell => cell.ch).join('')}</Text>
            ),
          )}
          <Text color={text} wrap="truncate">
            now {fmt(t.inputPerSec)}/s · peak {fmt(t.inputPerSecPeak)}/s
          </Text>
          <Text color={muted} wrap="truncate">
            output {fmt(t.outputPerSec)}/s
          </Text>
        </Box>
      )
    },
  },
  {
    id: 'action',
    title: 'Current action:',
    size: 'half',
    enabled: true,
    lines: () => 1,
    body: ({ Text }, snap) => (
      <Text bold color={theme.action[snap.action.kind] ?? text} wrap="truncate">
        {snap.action.label}
      </Text>
    ),
  },
  {
    id: 'project',
    title: 'Project',
    size: 'half',
    enabled: true,
    lines: (snap, inner) => 1 + Math.max(1, Math.ceil(languagesLine(snap.project?.languages ?? null).length / inner)),
    body: ({ Box, Text }, snap) => (
      <Box flexDirection="column">
        <Text color={text} wrap="truncate">
          {testsLine(snap.project?.tests ?? null)}
        </Text>
        <Text color={text} wrap="wrap">
          {languagesLine(snap.project?.languages ?? null)}
        </Text>
      </Box>
    ),
  },
  {
    id: 'animation',
    title: snap => snap.animation?.name ?? 'Animation',
    size: 'fill',
    enabled: true,
    // Rows that make the piece span the full width at its own aspect.
    maxRows: inner => {
      const f = frameSize()
      return f ? Math.max(1, Math.round((inner * f.rows) / f.cols)) : undefined
    },
    body: (ui, snap, inner, rows) => {
      const { Text } = ui
      const anim = snap.animation
      if (anim?.status === 'error') {
        return (
          <Text color={muted} wrap="wrap">
            {anim.message ?? 'The animation could not play.'}
          </Text>
        )
      }
      if (!('Raster' in ui) || !ui.Raster) return <Text color={muted}>This surface can't draw animations.</Text>
      const { Raster } = ui
      return <Raster key={RASTER_KEY} columns={inner} rows={rows} cells={currentCells(inner, rows)} />
    },
  },
]

/** Outer width (border included) of a widget, in columns. */
export function widgetColumns(size: WidgetSize, paneColumns: number): number {
  return size === 'half' ? Math.floor(paneColumns / 2) : paneColumns
}

type Placed = { def: WidgetDef; outer: number; inner: number; rows: number }

/**
 * Lays the enabled widgets out in order: halves pair up side by side, a
 * full-width one takes its own row, and a `fill` one gets the rows left.
 */
export function layoutWidgets(snap: Snapshot, paneColumns: number, paneRows: number): Placed[][] {
  const rowsOf: Placed[][] = []
  let pending: Placed[] = []
  const flush = () => {
    if (!pending.length) return
    const h = Math.max(...pending.map(p => p.rows))
    rowsOf.push(pending.map(p => ({ ...p, rows: h })))
    pending = []
  }
  const fills: Placed[] = []
  for (const def of WIDGETS.filter(w => w.enabled)) {
    const outer = widgetColumns(def.size, paneColumns)
    const inner = Math.max(8, outer - 4) // border + one column of padding each side
    const placed: Placed = { def, outer, inner, rows: def.lines ? def.lines(snap, inner) : 1 }
    if (def.size === 'half') {
      pending.push(placed)
      if (pending.length === 2) flush()
    } else {
      flush()
      if (def.size === 'fill') fills.push(placed)
      rowsOf.push([placed])
    }
  }
  flush()
  // What the fixed rows use; the fill widgets share the rest (one row spare).
  const used = rowsOf.filter(r => r[0]!.def.size !== 'fill').reduce((n, r) => n + r[0]!.rows + CHROME_ROWS, 0)
  const spare = paneRows - used - 1 - fills.length * CHROME_ROWS
  for (const f of fills) {
    const share = Math.max(3, Math.floor(spare / Math.max(1, fills.length)))
    f.rows = Math.max(3, Math.min(share, f.def.maxRows?.(f.inner) ?? share))
  }
  return rowsOf
}

export function renderWidgets(ui: Elements, snap: Snapshot, paneColumns: number, paneRows: number) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" backgroundColor={theme.background}>
      {layoutWidgets(snap, paneColumns, paneRows).map((row, r) => (
        <Box key={`row-${r}`} flexDirection="row">
          {row.map(({ def, outer, inner, rows }) => (
            <Box
              key={def.id}
              width={outer}
              flexDirection="column"
              borderStyle={theme.widget.borderStyle}
              borderColor={theme.widget.borderColor ?? text}
              backgroundColor={theme.background}
              paddingX={1}
            >
              <Text bold color={theme.widget.titleColor ?? text} wrap="truncate">
                {typeof def.title === 'function' ? def.title(snap) : def.title}
              </Text>
              {def.body(ui, snap, inner, rows) as never}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
