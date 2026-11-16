import type { Color } from 'claude-code'

import type { ActionKind } from '../types'

// Every colour and border the widgets draw with lives here, so styling is
// one file. `undefined` falls back as noted on each field.
export type Theme = {
  /** Painted under the whole pane and inside every widget. */
  background?: Color
  /** Default colour for all text. */
  text?: Color
  /** Secondary text (ids, totals, the output line). */
  muted?: Color
  widget: {
    borderStyle: string
    borderColor?: Color
    titleColor?: Color // falls back to `text`
  }
  context: { fill?: Color; empty?: Color }
  graph: { bar?: Color; baseline?: Color }
  /** Per-action colour for the Current action label; falls back to `text`. */
  action: Partial<Record<ActionKind, Color>>
}

const BACKGROUND = '#000080' // BACKGROUND
const TEXT_PRIMARY = '#DAA520' // TEXT_PRIMARY
const TEXT_SECONDARY = '#FFFFFF'

export const theme: Theme = {
  background: BACKGROUND,
  text: TEXT_PRIMARY,
  muted: TEXT_SECONDARY,
  widget: { borderStyle: 'round', borderColor: TEXT_PRIMARY, titleColor: TEXT_PRIMARY },
  context: { fill: TEXT_PRIMARY, empty: TEXT_SECONDARY },
  graph: { bar: TEXT_PRIMARY, baseline: TEXT_SECONDARY },
  action: {},
}
