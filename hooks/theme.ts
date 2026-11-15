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

const NAVY = '#000080' // NAVY
const GOLDENROD = '#DAA520' // goldenrod
const WHITE = '#FFFFFF'

export const theme: Theme = {
  background: NAVY,
  text: GOLDENROD,
  muted: WHITE,
  widget: { borderStyle: 'round', borderColor: GOLDENROD, titleColor: GOLDENROD },
  context: { fill: GOLDENROD, empty: WHITE },
  graph: { bar: GOLDENROD, baseline: WHITE },
  action: {},
}
