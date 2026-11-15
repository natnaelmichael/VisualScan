import type { EngineInterface } from 'claude-code'

import type { Snapshot } from '../types'
import { bar, fmt, graphRows } from './core'
import { languagesLine, testsLine } from './project'
import { theme } from './theme'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** Each widget's size, as a fraction of the pane's width. */
export type WidgetSize = 'half' | 'full'

export type WidgetDef = {
  id: string
  title: string
  size: WidgetSize
  enabled: boolean
  body: (ui: Elements, snap: Snapshot, inner: number) => unknown
}

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
]

/** Outer width (border included) of a widget, in columns. */
export function widgetColumns(size: WidgetSize, paneColumns: number): number {
  return size === 'full' ? paneColumns : Math.floor(paneColumns / 2)
}

export function renderWidgets(ui: Elements, snap: Snapshot, paneColumns: number) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row" flexWrap="wrap" backgroundColor={theme.background}>
      {WIDGETS.filter(w => w.enabled).map(w => {
        const outer = widgetColumns(w.size, paneColumns)
        const inner = Math.max(8, outer - 4) // border + one column of padding each side
        return (
          <Box
            key={w.id}
            width={outer}
            flexDirection="column"
            borderStyle={theme.widget.borderStyle}
            borderColor={theme.widget.borderColor ?? text}
            backgroundColor={theme.background}
            paddingX={1}
          >
            <Text bold color={theme.widget.titleColor ?? text} wrap="truncate">
              {w.title}
            </Text>
            {w.body(ui, snap, inner) as never}
          </Box>
        )
      })}
    </Box>
  )
}
