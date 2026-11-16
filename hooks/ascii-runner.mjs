// Plays one ASCII Magic piece and prints its frames as JSON lines on stdout.
// Run by the VisualScan mod under Node's permission model:
//   node --permission --allow-fs-read=<pieceDir> --allow-fs-read=<this file> ascii-runner.mjs <pieceDir> <slug> <maxFps>
// so the piece's code can read only its own folder: no network, no writes,
// no child processes.
//
// Lines: {"type":"meta",name,cols,rows,fps,palette}, then {"type":"frame",text,color?}
// per frame, or {"type":"error",message} once before exiting.

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const write = obj => process.stdout.write(JSON.stringify(obj) + '\n')
process.stdout.on('error', () => process.exit(0))

const [dir, slug, maxFpsArg] = process.argv.slice(2)

try {
  if (!dir || !slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('usage: ascii-runner.mjs <pieceDir> <slug> <maxFps>')
  const mod = await import(pathToFileURL(path.join(dir, 'pieces', `${slug}.js`)).href)
  const meta = mod.meta ?? {}
  let create = mod.default
  if (typeof create !== 'function') throw new Error(`piece "${slug}" has no default create()`)

  // Pieces with settings take them in create(values): use each one's default.
  if (meta.params) {
    const values = {}
    for (const [k, d] of Object.entries(meta.params)) values[k] = d.default
    const inner = create
    create = () => inner(values)
  }

  const draw = create()
  const fps = Math.max(1, Math.min(Number(meta.fps) || 10, Number(maxFpsArg) || 30))
  write({ type: 'meta', name: meta.name ?? slug, cols: meta.cols, rows: meta.rows, fps, palette: meta.palette ?? {} })

  const start = performance.now()
  const tick = () => {
    try {
      const f = draw((performance.now() - start) / 1000)
      write(typeof f === 'string' ? { type: 'frame', text: f } : { type: 'frame', text: f.text, color: f.color })
    } catch (e) {
      write({ type: 'error', message: String(e?.message ?? e) })
      process.exit(1)
    }
  }
  tick()
  setInterval(tick, 1000 / fps)
} catch (e) {
  write({ type: 'error', message: String(e?.message ?? e) })
  process.exit(1)
}
