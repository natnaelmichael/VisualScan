import { expect, test } from 'claude-code/testing'

import { Rate, Tracker, graphRows, toolAction } from './core'
import { lookupModel } from './models'

test('tools show their raw name, kinds kept for colour', async () => {
  expect(toolAction('Bash').label).toBe('Bash')
  expect(toolAction('mcp__github__create_issue').label).toBe('mcp__github__create_issue')
  expect(toolAction('Edit')).toEqual({ kind: 'codegen', label: 'Edit', tool: 'Edit' })
  expect(toolAction('WebSearch').label).toBe('WebSearch')
  expect(toolAction('Agent').kind).toBe('subagent')
})

test('action priority: compaction > tool > stream > inference > finished', async () => {
  const t = new Tracker()
  expect(t.action().label).toBe('Finished')
  t.turnActive = true
  expect(t.action().label).toBe('turn.step')
  t.stream = { kind: 'thinking' }
  expect(t.action().label).toBe('thinking')
  t.stream = { kind: 'responding' }
  expect(t.action().label).toBe('text')
  t.stream = { kind: 'tool', name: 'Write' }
  expect(t.action().label).toBe('Write')
  t.tools.set('a', 'Bash')
  expect(t.action().label).toBe('Bash')
  t.compacting = 1
  expect(t.action().label).toBe('session.compact')
  t.compacting = 0
  t.tools.clear()
  t.stream = null
  t.turnActive = false
  expect(t.action().label).toBe('Finished')
})

test('tokens spread over their span and average over the window', async () => {
  const r = new Rate()
  r.add(10_000, 12_000, 8_000) // 4000 in second 10, 4000 in second 11
  expect(r.buckets.get(10)).toBe(4000)
  expect(r.buckets.get(11)).toBe(4000)
  expect(r.perSec(11_500, 4)).toBe(2000)
  r.add(10_000, 12_000, -2_000) // estimate correction
  expect(r.buckets.get(10)).toBe(3000)
  expect(r.history(11_500, 3, 1)).toEqual([0, 3000, 3000])
})

test('models resolve through prefixes and suffixes', async () => {
  expect(lookupModel('claude-opus-5-5')?.name).toBe('Opus 5.5')
  expect(lookupModel('us.anthropic.claude-opus-5-5[1m]')?.name).toBe('Opus 5.5')
  expect(lookupModel('claude-opus-5')?.name).toBe('Opus 5')
  expect(lookupModel('claude-haiku-4-5-20251001')?.contextWindow).toBe(200_000)
})

test('the graph always draws, with a baseline for zero', async () => {
  const rows = graphRows([0, 50, 100], 4, 2).map(r => r.map(c => c.ch).join(''))
  // padded zero, zero, half, full: 2 rows tall
  expect(rows).toEqual(['   █', '▁▁██'])
  const flat = graphRows([], 5, 3)
  expect(flat[2]?.every(c => c.isBaseline)).toBe(true)
})

const PANE = {
  plugin: 'visualscan',
  component: 'Pane',
  requestId: 'visualscan',
  props: {
    title: 'VisualScan',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane shows the action box after a tool call', async ($, on) => {
  on('command.register', () => ({ value: { command: 'visualscan' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/tmp/vs-test-home' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 50_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, tokens: 5_000, percent: 0.5 }, rateLimits: [] },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'Current action:' }))?.text).toBe('Current action:')
  expect((await ui.find({ type: 'Text', text: /^(Finished|turn\.step|Bash)$/ }))?.text).toBeTruthy()
  // The model is known before any model request.
  expect((await ui.find({ type: 'Text', text: 'Opus 5.5' }))?.text).toBe('Opus 5.5')
  await ui.unmount()
})
