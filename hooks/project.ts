// Pure helpers for the Project widget: test-output parsing, CI check runs,
// and lines of code per language. No `$` here, so all of it is testable.

import type { LanguageShare, TestResult } from '../types'

// ---------- Local test output ----------

const TEST_COMMAND = /\b(test|tests|pytest|jest|vitest|mocha|rspec|ctest|phpunit|unittest)\b/i

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command)
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

function toMs(value: string, unit: string): number {
  const n = Number(value)
  if (unit === 'ms') return Math.round(n)
  if (unit === 'm' || unit === 'min') return Math.round(n * 60_000)
  return Math.round(n * 1000)
}

function lastMatch(text: string, re: RegExp): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = g.exec(text))) last = m
  return last
}

function count(text: string, word: string): number {
  const m = new RegExp(`(\\d+) ${word}`).exec(text)
  return m ? Number(m[1]) : 0
}

/** Pass/total counts from a test runner's output, or null if none found. */
export function parseTestOutput(raw: string): { passed: number; total: number; durationMs?: number } | null {
  const text = raw.replace(ANSI, '')

  // bun test / claude plugin test: " 6 pass" " 0 fail" "Ran 6 tests across 1 file. [0.16s]"
  const bunPass = lastMatch(text, /^\s*(\d+) pass\s*$/m)
  if (bunPass) {
    const fail = lastMatch(text, /^\s*(\d+) fail\s*$/m)
    const passed = Number(bunPass[1])
    const failed = fail ? Number(fail[1]) : 0
    const time = lastMatch(text, /Ran \d+ tests?.*?\[(\d+(?:\.\d+)?)(ms|s)\]/)
    return { passed, total: passed + failed, durationMs: time ? toMs(time[1]!, time[2]!) : undefined }
  }

  // jest: "Tests:       1 failed, 5 passed, 6 total" ... "Time:        1.234 s"
  const jest = lastMatch(text, /Tests:\s+([^\n]*?)(\d+) total/)
  if (jest) {
    const time = lastMatch(text, /Time:\s+(\d+(?:\.\d+)?)\s*(ms|s)/)
    return {
      passed: count(jest[1] ?? '', 'passed'),
      total: Number(jest[2]),
      durationMs: time ? toMs(time[1]!, time[2]!) : undefined,
    }
  }

  // vitest: "Tests  1 failed | 5 passed (6)" ... "Duration  1.20s"
  const vitest = lastMatch(text, /Tests\s+([^\n]*?)\((\d+)\)/)
  if (vitest && /passed|failed/.test(vitest[1] ?? '')) {
    const time = lastMatch(text, /Duration\s+(\d+(?:\.\d+)?)(ms|s)/)
    return {
      passed: count(vitest[1] ?? '', 'passed'),
      total: Number(vitest[2]),
      durationMs: time ? toMs(time[1]!, time[2]!) : undefined,
    }
  }

  // pytest: "==== 5 passed, 1 failed in 0.12s ===="
  const pytest = lastMatch(text, /=+ ([^=\n]*?(?:passed|failed|error)[^=\n]*?) in (\d+(?:\.\d+)?)s/)
  if (pytest) {
    const s = pytest[1] ?? ''
    const passed = count(s, 'passed')
    const total = passed + count(s, 'failed') + count(s, 'errors?')
    return { passed, total, durationMs: toMs(pytest[2]!, 's') }
  }

  // cargo: "test result: ok. 5 passed; 1 failed; 0 ignored; ... finished in 0.01s" (summed)
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed;[^\n]*?finished in (\d+(?:\.\d+)?)s/g)]
  if (cargo.length) {
    let passed = 0
    let failed = 0
    let ms = 0
    for (const m of cargo) {
      passed += Number(m[1])
      failed += Number(m[2])
      ms += toMs(m[3]!, 's')
    }
    return { passed, total: passed + failed, durationMs: ms }
  }

  // mocha: "5 passing (120ms)" "1 failing"
  const mocha = lastMatch(text, /(\d+) passing \((\d+(?:\.\d+)?)(ms|s|m)\)/)
  if (mocha) {
    const fail = lastMatch(text, /(\d+) failing/)
    const passed = Number(mocha[1])
    return { passed, total: passed + (fail ? Number(fail[1]) : 0), durationMs: toMs(mocha[2]!, mocha[3]!) }
  }

  // go test -v: "--- PASS: TestX" / "--- FAIL: TestY"
  const goPass = (text.match(/^\s*--- PASS:/gm) ?? []).length
  const goFail = (text.match(/^\s*--- FAIL:/gm) ?? []).length
  if (goPass + goFail > 0) return { passed: goPass, total: goPass + goFail }

  return null
}

// ---------- GitHub CI ----------

/** `owner/repo` from a GitHub remote URL, or null. */
export function githubRepo(remote: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export type CheckRun = {
  status?: string
  conclusion?: string | null
  started_at?: string | null
  completed_at?: string | null
  output?: { title?: string | null; summary?: string | null } | null
}

const NOT_COUNTED = new Set(['skipped', 'neutral', 'cancelled', 'stale'])

/**
 * Turns the check runs of one commit into a result. Real test counts win
 * when a check's title or summary reports them ("12 passed, 1 failed");
 * otherwise it counts the checks themselves.
 */
export function summarizeCheckRuns(runs: CheckRun[]): TestResult | null {
  const counted = runs.filter(r => !(r.status === 'completed' && NOT_COUNTED.has(r.conclusion ?? '')))
  if (counted.length === 0) return null

  const running = counted.some(r => r.status !== 'completed')
  const starts = counted.map(r => Date.parse(r.started_at ?? '')).filter(Number.isFinite)
  const ends = counted.map(r => Date.parse(r.completed_at ?? '')).filter(Number.isFinite)
  const durationMs = !running && starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : undefined

  let tPassed = 0
  let tTotal = 0
  for (const r of counted) {
    const text = `${r.output?.title ?? ''}\n${r.output?.summary ?? ''}`
    const passed = /(\d+) (?:tests? )?passed/i.exec(text)
    if (!passed) continue
    const failed = /(\d+) (?:tests? )?failed/i.exec(text)
    const p = Number(passed[1])
    tPassed += p
    tTotal += p + (failed ? Number(failed[1]) : 0)
  }
  if (tTotal > 0) return { passed: tPassed, total: tTotal, durationMs, running, source: 'ci', unit: 'tests' }

  const passed = counted.filter(r => r.status === 'completed' && r.conclusion === 'success').length
  return { passed, total: counted.length, durationMs, running, source: 'ci', unit: 'checks' }
}

// ---------- Languages ----------

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  cs: 'C#', rb: 'Ruby', php: 'PHP', scala: 'Scala', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  ps1: 'PowerShell', lua: 'Lua', dart: 'Dart', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang',
  hs: 'Haskell', ml: 'OCaml', clj: 'Clojure', r: 'R', jl: 'Julia', m: 'Objective-C',
  mm: 'Objective-C++', sol: 'Solidity', zig: 'Zig', nim: 'Nim', vue: 'Vue', svelte: 'Svelte',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', sql: 'SQL',
}

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|out|target|\.next|coverage)\//

export function languageOf(path: string): string | undefined {
  if (VENDORED.test(path)) return undefined
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot < path.lastIndexOf('/')) return undefined
  return LANGUAGES[path.slice(dot + 1).toLowerCase()]
}

/** The top `n` languages from `wc -l` output, by share of counted lines. */
export function languageShares(wcOutput: string, n = 3): LanguageShare[] {
  const byLang = new Map<string, number>()
  for (const line of wcOutput.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!m) continue
    const path = m[2]!.trim()
    if (path === 'total') continue
    const lang = languageOf(path)
    if (lang) byLang.set(lang, (byLang.get(lang) ?? 0) + Number(m[1]))
  }
  const sum = [...byLang.values()].reduce((a, b) => a + b, 0)
  if (sum === 0) return []
  return [...byLang.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, lines]) => ({ name, lines, percent: Math.round((lines / sum) * 10_000) / 100 }))
}

// ---------- Lines ----------

export function testsLine(t: TestResult | null): string {
  if (!t) return 'Tests passed: –'
  const time = t.running ? 'running' : t.durationMs !== undefined ? `${t.durationMs} ms` : '– ms'
  return `Tests passed: ${t.passed}/${t.total} (${time})`
}

export function languagesLine(langs: LanguageShare[] | null): string {
  if (!langs || langs.length === 0) return 'Languages: –'
  return `Languages: ${langs.map(l => `${l.name}(${l.percent.toFixed(2)}%)`).join(', ')}`
}
