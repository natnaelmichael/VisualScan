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

import { githubRepo, languageShares, languagesLine, parseTestOutput, summarizeCheckRuns, testsLine } from './project'

test('test output from common runners', async () => {
  expect(parseTestOutput(' 6 pass\n 0 fail\nRan 6 tests across 1 file. [0.16s]')).toEqual({ passed: 6, total: 6, durationMs: 160 })
  expect(parseTestOutput('Tests:       1 failed, 5 passed, 6 total\nTime:        1.234 s')).toEqual({ passed: 5, total: 6, durationMs: 1234 })
  expect(parseTestOutput(' Tests  1 failed | 5 passed (6)\n Duration  1.20s')).toEqual({ passed: 5, total: 6, durationMs: 1200 })
  expect(parseTestOutput('===== 5 passed, 1 failed in 0.12s =====')).toEqual({ passed: 5, total: 6, durationMs: 120 })
  expect(
    parseTestOutput('test result: ok. 3 passed; 0 failed; 0 ignored; finished in 0.01s\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; finished in 0.02s'),
  ).toEqual({ passed: 4, total: 5, durationMs: 30 })
  expect(parseTestOutput('  5 passing (120ms)\n  1 failing')).toEqual({ passed: 5, total: 6, durationMs: 120 })
  expect(parseTestOutput('hello world')).toBe(null)
})

test('CI checks: real test counts win, else checks are counted', async () => {
  const done = { status: 'completed', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:02Z' }
  expect(summarizeCheckRuns([{ ...done, conclusion: 'success' }, { ...done, conclusion: 'failure' }, { ...done, conclusion: 'skipped' }])).toEqual({
    passed: 1, total: 2, durationMs: 2000, running: false, source: 'ci', unit: 'checks',
  })
  expect(summarizeCheckRuns([{ ...done, conclusion: 'failure', output: { title: '12 passed, 1 failed' } }])?.unit).toBe('tests')
  expect(summarizeCheckRuns([{ status: 'in_progress' }])?.running).toBe(true)
  expect(githubRepo('https://github.com/natnaelmichael/VisualScan.git')).toBe('natnaelmichael/VisualScan')
  expect(githubRepo('git@github.com:a/b.git')).toBe('a/b')
})

test('the two lines read as asked', async () => {
  const wc = '  300 hooks/a.ts\n  100 hooks/b.tsx\n   50 run.sh\n   50 x.py\n 9999 README.md\n  500 node_modules/z.js\n 10999 total'
  const langs = languageShares(wc)
  expect(languagesLine(langs)).toBe('Languages: TypeScript(80.00%), Shell(10.00%), Python(10.00%)')
  expect(testsLine({ passed: 6, total: 6, durationMs: 160, source: 'local', unit: 'tests' })).toBe('Tests passed: 6/6 (160 ms)')
  expect(testsLine(null)).toBe('Tests passed: –')
})

import { frameToWords, parseEnv, relativeImports, resolveImport, slugFromUrl, wordsToBase64 } from './animation'
import { layoutWidgets } from './widgets'

test('ANIMATION_URL from .env, only ascii-magic piece pages', async () => {
  expect(parseEnv('# c\nANIMATION_URL="https://www.ascii-magic.com/ascii/world-map-pings"\nX=1 # note').ANIMATION_URL).toBe(
    'https://www.ascii-magic.com/ascii/world-map-pings',
  )
  expect(slugFromUrl('https://www.ascii-magic.com/ascii/world-map-pings')).toBe('world-map-pings')
  expect(slugFromUrl('https://ascii-magic.com/ascii/cpu-cores/')).toBe('cpu-cores')
  expect(slugFromUrl('https://evil.example/ascii/cpu-cores')).toBe(null)
  expect(slugFromUrl('https://www.ascii-magic.com/ascii/../x')).toBe(null)
})

test('piece imports resolve inside the library only', async () => {
  expect(relativeImports('import { Grid } from "../lib/kit.js";\nimport x from "../lib/scene.js"')).toEqual(['../lib/kit.js', '../lib/scene.js'])
  expect(resolveImport('pieces/a.js', '../lib/kit.js')).toBe('lib/kit.js')
  expect(resolveImport('lib/scene.js', './kit.js')).toBe('lib/kit.js')
  expect(resolveImport('pieces/a.js', '../../etc/passwd')).toBe(null)
})

test('frames shrink to fit, centre, and carry palette colours', async () => {
  const w = frameToWords({ text: 'ab\ncd', color: '0 \n  ' }, 4, 2, { '0': '#ff0000' }, 0x00ff00, 0x000080)
  // 2x2 centred in 4x2: columns 1..2
  expect(String.fromCodePoint(w[3]!, w[6]!)).toBe('ab')
  expect(w[4]).toBe(0xff0000) // 'a' coloured by key 0
  expect(w[7]).toBe(0x00ff00) // 'b' default ink
  expect(w[2]).toBe(0x000080) // background
  const small = frameToWords({ text: 'abcd\nefgh\nijkl\nmnop' }, 2, 2, {}, undefined, undefined)
  expect(small.length).toBe(12)
  expect(wordsToBase64(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
})

test('frames fill the width at their aspect and keep words whole', async () => {
  const text = 'edge requests 20' + ' '.repeat(14) + 'req/s 4244\n' + '•'.repeat(40) + '\n' + '•'.repeat(40) + '\n' + ' ● api   ● sync' + ' '.repeat(25)
  const cols = 30
  const w = frameToWords({ text }, cols, 3, {}, undefined, undefined)
  const row = (y: number) => Array.from({ length: cols }, (_, x) => String.fromCodePoint(w[(y * cols + x) * 3]!)).join('')
  expect(row(0)).toContain('edge requests 20')
  expect(row(0)).toContain('req/s 4244')
  expect(row(1)).toBe('•'.repeat(30)) // the picture spans the full width
  expect(row(2)).toContain('● api')
  // Scaled up, a text row is drawn once, not doubled.
  const big = frameToWords({ text: 'ab\n••' }, 4, 4, {}, undefined, undefined)
  const bigRow = (y: number) => Array.from({ length: 4 }, (_, x) => String.fromCodePoint(big[(y * 4 + x) * 3]!)).join('')
  expect([0, 1, 2, 3].map(bigRow).filter(r => r.includes('ab')).length).toBe(1)
  expect(bigRow(3)).toBe('••••')
})

test('the animation fills the rows the other widgets leave', async () => {
  const snap = {
    version: 1, updatedAt: 0, model: null, context: null, cost: null,
    tokens: { inputPerSec: 0, inputPerSecPeak: 0, outputPerSec: 0, history: [], totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 } },
    action: { kind: 'finished', label: 'Finished', since: 0 },
    project: { tests: null, languages: null },
    animation: null,
  } as const
  const rows = layoutWidgets(snap as never, 80, 50)
  expect(rows.map(r => r.map(p => p.def.id))).toEqual([['model', 'tokens'], ['action', 'project'], ['animation']])
  const used = rows.slice(0, 2).reduce((n, r) => n + r[0]!.rows + 3, 0)
  expect(rows[2]![0]!.rows).toBe(50 - used - 1 - 3)
  expect(rows[2]![0]!.inner).toBe(76)
})
