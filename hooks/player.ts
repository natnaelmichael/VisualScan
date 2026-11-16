// The Animation widget's player: picks the piece (ANIMATION_URL), makes sure
// its files are on disk (bundled default, else downloaded once into a
// cache), runs it in a sandboxed Node process and paints each frame into
// the pane's Raster with $.ui.blit.

import type { EngineInterface } from 'claude-code'

import type { AnimationState } from '../types'
import {
  ASCII_BASE,
  DEFAULT_ANIMATION_URL,
  blankCells,
  frameToWords,
  hexColor,
  parseEnv,
  relativeImports,
  resolveImport,
  slugFromUrl,
  wordsToBase64,
} from './animation'
import type { Frame } from './animation'
import { theme } from './theme'

export const RASTER_KEY = 'animation'
const MAX_FPS = 15
const ENV_CHECK_MS = 5000

type Meta = { name: string; cols?: number; rows?: number; fps: number; palette: Record<string, string> }

let state: AnimationState | null = null
let meta: Meta | null = null
let lastFrame: Frame | null = null
let raster: { cols: number; rows: number } | null = null
let generation = 0
let nextEnvCheck = 0
let paneId = ''
let onChange: () => void = () => {}

const ink = () => hexColor(typeof theme.text === 'string' ? theme.text : undefined)
const background = () => hexColor(typeof theme.background === 'string' ? theme.background : undefined)

export function animationState(): AnimationState | null {
  return state
}

function setState(next: AnimationState): void {
  state = next
  onChange()
}

/** Cells for the Raster at the size the widget is drawn at now. */
export function currentCells(cols: number, rows: number): string {
  raster = { cols, rows }
  if (!lastFrame) return blankCells(cols, rows, ink(), background())
  return wordsToBase64(frameToWords(lastFrame, cols, rows, meta?.palette ?? {}, ink(), background()))
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

/** Process env first, then the project's .env, then the mod's own .env, then the default. */
async function resolveUrl($: EngineInterface, cwd: string | undefined): Promise<string> {
  try {
    const fromEnv = await $.env.get('ANIMATION_URL')
    if (fromEnv) return fromEnv
  } catch {
    // not set
  }
  for (const dir of [cwd, $.plugin.root]) {
    if (!dir) continue
    const text = await readText($, `${dir}/.env`)
    const url = text ? parseEnv(text).ANIMATION_URL : undefined
    if (url) return url
  }
  return DEFAULT_ANIMATION_URL
}

/** Downloads `rel` (e.g. "pieces/x.js") and everything it imports, into `cache`. */
async function download($: EngineInterface, cache: string, rel: string, seen = new Set<string>()): Promise<void> {
  if (seen.has(rel)) return
  seen.add(rel)
  const dest = `${cache}/${rel}`
  let source = await readText($, dest)
  if (source === null) {
    const res = await $.process.run(
      ['curl', '-fsSL', '--max-time', '20', '--proto', '=https', '--create-dirs', '-o', dest, `${ASCII_BASE}${rel}`],
      { timeoutMs: 30_000 },
    )
    if (res.exitCode !== 0) throw new Error(`download failed: ${rel}`)
    source = await readText($, dest)
    if (source === null) throw new Error(`download unreadable: ${rel}`)
  }
  for (const spec of relativeImports(source)) {
    const dep = resolveImport(rel, spec)
    if (!dep) throw new Error(`unsupported import in ${rel}: ${spec}`)
    await download($, cache, dep, seen)
  }
}

/** The folder holding pieces/<slug>.js and its imports: bundled, else the download cache. */
async function pieceDir($: EngineInterface, slug: string, cache: string): Promise<string> {
  const bundled = `${$.plugin.root}/ascii`
  if ((await readText($, `${bundled}/pieces/${slug}.js`)) !== null) return bundled
  await download($, cache, `pieces/${slug}.js`)
  return cache
}

async function realPath($: EngineInterface, path: string): Promise<string> {
  try {
    const res = await $.process.run(['realpath', path], { timeoutMs: 5000 })
    const out = res.stdout.trim()
    return res.exitCode === 0 && out ? out : path
  } catch {
    return path
  }
}

async function play($: EngineInterface, url: string, cache: string): Promise<void> {
  const gen = ++generation
  meta = null
  lastFrame = null
  const slug = slugFromUrl(url)
  if (!slug) {
    setState({ url, slug: null, status: 'error', message: 'ANIMATION_URL must be an ascii-magic.com/ascii/<piece> page' })
    return
  }
  setState({ url, slug, status: 'loading' })

  let dir: string
  try {
    dir = await pieceDir($, slug, cache)
  } catch (e) {
    if (gen === generation) setState({ url, slug, status: 'error', message: String((e as Error).message ?? e) })
    return
  }
  if (gen !== generation) return

  // Node's sandbox checks real paths: resolve links (the mod may be reached through one).
  dir = await realPath($, dir)
  const runner = await realPath($, `${$.plugin.root}/hooks/ascii-runner.mjs`)
  const argv = ['node', '--permission', `--allow-fs-read=${dir}`, `--allow-fs-read=${runner}`, runner, dir, slug, String(MAX_FPS)]
  let buffer = ''
  try {
    for await (const chunk of $.process.spawn({ argv, cwd: dir })) {
      if (gen !== generation) break // a newer piece took over: leaving the loop ends this child
      if (chunk.stream !== 'stdout') continue
      buffer += chunk.text
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.trim()) await onLine($, line, url, slug)
      }
    }
  } catch (e) {
    if (gen === generation) setState({ url, slug, status: 'error', message: `could not start node: ${String((e as Error).message ?? e)}` })
    return
  }
  if (gen === generation && state?.status !== 'error') setState({ url, slug, name: (meta as Meta | null)?.name, status: 'error', message: 'the piece stopped' })
}

async function onLine($: EngineInterface, line: string, url: string, slug: string): Promise<void> {
  let msg: { type?: string; [k: string]: unknown }
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'meta') {
    meta = {
      name: String(msg.name ?? slug),
      cols: Number(msg.cols) || undefined,
      rows: Number(msg.rows) || undefined,
      fps: Number(msg.fps) || 10,
      palette: (msg.palette as Record<string, string>) ?? {},
    }
    setState({ url, slug, name: meta.name, status: 'playing' })
  } else if (msg.type === 'frame' && typeof msg.text === 'string') {
    lastFrame = { text: msg.text, color: typeof msg.color === 'string' ? msg.color : undefined }
    if (!raster) return
    try {
      await $.ui.blit({ requestId: paneId, key: RASTER_KEY, cells: currentCells(raster.cols, raster.rows) })
    } catch {
      // pane closed or resizing: the next render repaints
    }
  } else if (msg.type === 'error') {
    setState({ url, slug, name: meta?.name, status: 'error', message: String(msg.message ?? 'piece error') })
  }
}

/** Starts the player; call from session.start. `changed` runs when the state changes. */
export async function startAnimation(
  $: EngineInterface,
  opts: { cwd?: string; cache: string; pane: string; changed: () => void },
): Promise<void> {
  paneId = opts.pane
  onChange = opts.changed
  const url = await resolveUrl($, opts.cwd)
  void play($, url, opts.cache)
}

/** From the 1 s tick: picks up an edited .env and switches pieces. */
export async function checkAnimationUrl($: EngineInterface, now: number, opts: { cwd?: string; cache: string }): Promise<void> {
  if (now < nextEnvCheck) return
  nextEnvCheck = now + ENV_CHECK_MS
  const url = await resolveUrl($, opts.cwd)
  if (url !== state?.url) void play($, url, opts.cache)
}
