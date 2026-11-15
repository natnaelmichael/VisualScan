import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import { Rate, Tracker } from './core'
import { lookupModel } from './models'
import { githubRepo, isTestCommand, languageShares, parseTestOutput, summarizeCheckRuns } from './project'
import type { CheckRun } from './project'
import type { LanguageShare, TestResult } from '../types'
import { theme } from './theme'
import { renderWidgets } from './widgets'

const PANE = 'visualscan'
const TICK_MS = 1000
const MIN_WRITE_GAP_MS = 250
const HISTORY_SEC = 60

const snapshot = atom({ plugin: 'visualscan', key: 'snapshot' } as const, null, {
  shape: 'snapshot-2',
})

// Working data. Starts over on reload; the snapshot atom keeps the last view.
const tracker = new Tracker()
const inputRate = new Rate()
const outputRate = new Rate()
const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 }
let peak = 0
let modelId: string | undefined
let effort: string | undefined
let lastContextTokens = 0
let usage: { context?: Snapshot['context']; cost?: Snapshot['cost'] } = {}
let actionLabel = ''
let actionSince = 0
let statePath: string | undefined
let cwd: string | undefined
let ciTests: TestResult | null = null
let localTests: TestResult | null = null
let languages: LanguageShare[] | null = null
let nextCiAt = 0
let nextLangAt = 0
let ciBusy = false
let langBusy = false

const CI_EVERY_MS = 30_000
const CI_WHILE_RUNNING_MS = 10_000
const LANG_EVERY_MS = 30_000
let lastWrite = 0

function build(now: number): Snapshot {
  const action = tracker.action()
  if (action.label !== actionLabel) {
    actionLabel = action.label
    actionSince = now
  }
  const inPerSec = inputRate.perSec(now)
  peak = Math.max(peak, inPerSec)
  const spec = modelId ? lookupModel(modelId) : undefined
  return {
    version: 1,
    updatedAt: now,
    model: modelId
      ? {
          id: modelId,
          name: spec?.name ?? modelId,
          effort,
          contextWindow: spec?.contextWindow,
          maxOutput: spec?.maxOutput,
          priceIn: spec?.priceIn,
          priceOut: spec?.priceOut,
        }
      : null,
    context: usage.context ?? null,
    cost: usage.cost ?? null,
    tokens: {
      inputPerSec: Math.round(inPerSec),
      inputPerSecPeak: Math.round(peak),
      outputPerSec: Math.round(outputRate.perSec(now)),
      history: inputRate.history(now, HISTORY_SEC),
      totals: { ...totals },
    },
    action: { kind: action.kind, label: action.label, tool: action.tool, since: actionSince },
    // GitHub CI first; the last local test run when the commit has no checks.
    project: { tests: ciTests ?? localTests, languages },
  }
}

/** Rebuild the view and the state file. `force` skips the write throttle (ticks). */
async function publish($: EngineInterface, force = false): Promise<void> {
  try {
    const now = await $.clock.now()
    const snap = build(now)
    await update($, snapshot, () => snap)
    if (statePath && (force || now - lastWrite >= MIN_WRITE_GAP_MS)) {
      lastWrite = now
      await $.fs.write(statePath, JSON.stringify(snap, null, 2))
    }
  } catch {
    // The pane must never break the session.
  }
}

/** Publish only when the action line changed (cheap to call per event). */
function onAction($: EngineInterface): void {
  if (tracker.action().label !== actionLabel) void publish($)
}

function paneArgs() {
  return { id: PANE, title: 'VisualScan', ...(theme.background ? { backgroundColor: theme.background } : {}) }
}

/** After a reload or restart: pick the model and totals back up at once. */
async function restore($: EngineInterface): Promise<void> {
  try {
    const prev = await read($, snapshot)
    if (prev) {
      modelId ??= prev.model?.id
      effort ??= prev.model?.effort
      Object.assign(totals, prev.tokens.totals)
      peak = Math.max(peak, prev.tokens.inputPerSecPeak)
    }
  } catch {
    // nothing stored yet
  }
  await loadModel($)
}

async function loadModel($: EngineInterface): Promise<void> {
  if (modelId) return
  try {
    const id = await $.session.model()
    if (id) modelId = id
  } catch {
    // filled in by the next model request
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Local test results from Bash output; a push or an edit refreshes CI / languages. */
async function observeTool($: EngineInterface, e: { tool: string }, ran: unknown, startedAt: number): Promise<void> {
  if (EDIT_TOOLS.has(e.tool)) nextLangAt = 0
  if (e.tool !== 'Bash') return
  const command = String((e as { command?: unknown }).command ?? '')
  if (/\bgit\s+(push|commit|checkout|switch|pull|merge|rebase|reset)\b/.test(command)) {
    nextCiAt = 0
    nextLangAt = 0
  }
  if (!isTestCommand(command)) return
  const result = (ran as { result?: { stdout?: string; stderr?: string } }).result
  const parsed = parseTestOutput(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`)
  if (!parsed) return
  const endedAt = await $.clock.now()
  localTests = {
    passed: parsed.passed,
    total: parsed.total,
    durationMs: parsed.durationMs ?? (startedAt ? endedAt - startedAt : undefined),
    source: 'local',
    unit: 'tests',
  }
  void publish($)
}

async function refreshCi($: EngineInterface, now: number): Promise<void> {
  if (ciBusy || now < nextCiAt) return
  ciBusy = true
  nextCiAt = now + CI_EVERY_MS
  try {
    const opts = cwd ? { cwd, timeoutMs: 15_000 } : { timeoutMs: 15_000 }
    const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], opts)
    const repo = remote.exitCode === 0 ? githubRepo(remote.stdout) : null
    const head = await $.process.run(['git', 'rev-parse', 'HEAD'], opts)
    const sha = head.exitCode === 0 ? head.stdout.trim() : ''
    if (!repo || !sha) {
      ciTests = null
      return
    }
    const res = await $.process.run(['gh', 'api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`], opts)
    if (res.exitCode !== 0) {
      ciTests = null // no gh, not signed in, or the commit isn't on GitHub
      return
    }
    const runs = (JSON.parse(res.stdout) as { check_runs?: CheckRun[] }).check_runs ?? []
    ciTests = summarizeCheckRuns(runs)
    if (ciTests?.running) nextCiAt = now + CI_WHILE_RUNNING_MS
  } catch {
    ciTests = null
  } finally {
    ciBusy = false
  }
}

async function refreshLanguages($: EngineInterface, now: number): Promise<void> {
  if (langBusy || now < nextLangAt) return
  langBusy = true
  nextLangAt = now + LANG_EVERY_MS
  try {
    const opts = cwd ? { cwd, timeoutMs: 20_000 } : { timeoutMs: 20_000 }
    let res = await $.process.run(['sh', '-c', 'git ls-files -z | xargs -0 wc -l'], opts)
    if (res.exitCode !== 0 || !res.stdout.trim()) {
      res = await $.process.run(
        ['sh', '-c', "find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -print0 | xargs -0 wc -l"],
        opts,
      )
    }
    languages = languageShares(res.stdout)
  } catch {
    // keep the last reading
  } finally {
    langBusy = false
  }
}

async function tick($: EngineInterface): Promise<void> {
  await loadModel($)
  try {
    const now = await $.clock.now()
    void refreshCi($, now)
    void refreshLanguages($, now)
  } catch {
    // next tick
  }
  try {
    const u = await $.session.usage()
    lastContextTokens = u.context.tokens ?? lastContextTokens
    usage = {
      context: { used: u.context.tokens, total: u.context.window, percent: u.context.percent },
      cost: u.cost ? { usd: u.cost.usd } : undefined,
    }
  } catch {
    // keep the last reading
  }
  try {
    const now = await $.clock.now()
    inputRate.prune(now)
    outputRate.prune(now)
  } catch {
    // pruning can wait for the next tick
  }
  await publish($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    await restore($)
    try {
      const home = await $.env.get('HOME')
      if (home) statePath = `${home}/.claude/visualscan/state.json`
    } catch {
      statePath = undefined
    }
    try {
      await $.command.register({ name: 'visualscan', description: 'Open the VisualScan pane' })
      $.clock.every(TICK_MS, () => void tick($))
    } catch {
      // the pane still draws from events
    }
    void $.ui.open(paneArgs())
    void tick($)
    return started
  })

  on('command.run', { command: 'visualscan' }, async $ => {
    await $.ui.open(paneArgs())
    return { text: 'VisualScan pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      tracker.turnActive = true
      tracker.stream = null
      onAction($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      tracker.turnActive = false
      tracker.stream = null
      tracker.tools.clear()
      void publish($)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = !e.agentId
    let sentAt = 0
    let firstAt = 0
    let estimate = 0
    try {
      sentAt = await $.clock.now()
      if (isMain) {
        modelId = e.model
        effort = typeof e.effort === 'string' ? e.effort : effort
        tracker.stream = null
        onAction($)
      }
    } catch {
      // observe only
    }

    for await (const chunk of next(e)) {
      try {
        if (!firstAt && chunk.kind !== 'engine') {
          firstAt = await $.clock.now()
          // Live estimate of what this request read; corrected at the stop chunk.
          estimate = lastContextTokens
          inputRate.add(sentAt, firstAt, estimate)
        }
        if (isMain) {
          if (chunk.kind === 'thinking') tracker.stream = { kind: 'thinking' }
          else if (chunk.kind === 'text') tracker.stream = { kind: 'responding' }
          else if (chunk.kind === 'tool') tracker.stream = { kind: 'tool', name: chunk.name }
          if (chunk.kind === 'thinking' || chunk.kind === 'text' || chunk.kind === 'tool') onAction($)
        }
        if (chunk.kind === 'stop' && chunk.usage) {
          const u = chunk.usage
          const stopAt = await $.clock.now()
          const consumed = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
          const readEnd = firstAt || stopAt
          inputRate.add(sentAt, readEnd, consumed - estimate)
          outputRate.add(readEnd, stopAt, u.output_tokens)
          totals.input += u.input_tokens
          totals.cacheRead += u.cache_read_input_tokens
          totals.cacheWrite += u.cache_creation_input_tokens
          totals.output += u.output_tokens
          totals.requests += 1
          if (isMain && u.model) modelId = u.model
          lastContextTokens = consumed + u.output_tokens
        }
      } catch {
        // observe only
      }
      yield chunk
    }

    if (isMain) {
      tracker.stream = null
      onAction($)
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `${e.tool}-${Math.random()}`
    tracker.tools.set(id, e.tool)
    onAction($)
    const startedAt = await $.clock.now().catch(() => 0)
    try {
      const ran = await next(e)
      try {
        await observeTool($, e, ran, startedAt)
      } catch {
        // observe only
      }
      return ran
    } finally {
      tracker.tools.delete(id)
      onAction($)
    }
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)
    tracker.compacting += 1
    onAction($)
    try {
      return await next(e)
    } finally {
      tracker.compacting -= 1
      void publish($)
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <ui.Text dimColor>VisualScan is warming up…</ui.Text>
    return renderWidgets(ui, snap, Math.max(40, e.props.bodyColumns ?? 80))
  })
}
